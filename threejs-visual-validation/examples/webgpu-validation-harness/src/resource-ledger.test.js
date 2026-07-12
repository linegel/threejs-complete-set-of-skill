import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	FloatType,
	HalfFloatType,
	InterleavedBuffer,
	InterleavedBufferAttribute,
	PerspectiveCamera,
	PlaneGeometry,
	ReadbackBuffer,
	RenderTarget,
	Scene,
	SphereGeometry,
	SRGBColorSpace,
	UnsignedByteType,
	WebGPURenderer
} from 'three/webgpu';
import { emissive, mrt, normalView, output, pass } from 'three/tsl';

import {
	buildValidationResourceLedger,
	emptyValidationResourceLedger,
	validateValidationResourceLedger
} from './resource-ledger.js';

function testCanvas() {

	return {
		width: 1,
		height: 1,
		style: {},
		addEventListener() {},
		removeEventListener() {},
		getContext() { return null; }
	};

}

function registerGeometryMemory( renderer, geometry ) {

	for ( const attribute of Object.values( geometry.attributes ) ) renderer.info.createAttribute( attribute );
	if ( geometry.index !== null ) renderer.info.createIndexAttribute( geometry.index );

}

function createRuntimeFixture( { sceneWidth = 1200, sceneHeight = 800, captureWidth = 1200, captureHeight = 800, registerMemory = true } = {} ) {

	const renderer = new WebGPURenderer( { canvas: testCanvas(), outputBufferType: HalfFloatType } );
	const scenePass = pass( new Scene(), new PerspectiveCamera() );
	scenePass.setMRT( mrt( { output, normal: normalView, emissive } ) );
	scenePass.setSize( sceneWidth, sceneHeight );
	scenePass.getTexture( 'normal' );
	scenePass.getTexture( 'emissive' );
	scenePass.renderTarget.depthTexture.type = FloatType;
	// r185 fills the PassNode depth extent during renderer texture setup. The
	// unit fixture mirrors that post-render state before registering memory.
	scenePass.renderTarget.depthTexture.image.width = sceneWidth;
	scenePass.renderTarget.depthTexture.image.height = sceneHeight;
	const captureTarget = new RenderTarget( captureWidth, captureHeight, { type: UnsignedByteType, depthBuffer: false } );
	captureTarget.texture.colorSpace = SRGBColorSpace;
	captureTarget.texture.name = 'validation-capture-rgba8';
	const geometries = [ new BoxGeometry( 1, 1, 1 ), new PlaneGeometry( 2, 2, 2, 2 ), new SphereGeometry( 1, 8, 6 ) ];
	geometries[ 0 ].name = 'subject-geometry';
	geometries[ 1 ].name = 'ground-geometry';
	geometries[ 2 ].name = 'marker-geometry';

	const readback = new ReadbackBuffer( 4096 );
	readback.name = 'validation-readback-4096';
	renderer.backend.timestampQueryPool.render = {
		type: 'render',
		maxQueries: 8,
		isDisposed: false,
		querySet: { label: 'queryset_global_timestamp_render' },
		resolveBuffer: { label: 'buffer_timestamp_resolve_render', size: 64 },
		resultBuffer: { label: 'buffer_timestamp_result_render', size: 64 }
	};
	if ( registerMemory ) {

		for ( const texture of [ ...scenePass.renderTarget.textures, scenePass.renderTarget.depthTexture, captureTarget.texture ] ) renderer.info.createTexture( texture );
		for ( const geometry of geometries ) registerGeometryMemory( renderer, geometry );
		renderer.info.createReadbackBuffer( readback );

	}
	return { renderer, scenePass, captureTarget, geometries, readback };

}

function buildLedger( fixture, previousLedger = null ) {

	return buildValidationResourceLedger( { ...fixture, previousLedger } );

}

test( 'resource ledger derives required target identities, formats, and bytes from actual Three.js objects', () => {

	const fixture = createRuntimeFixture();
	const ledger = buildLedger( fixture );
	assert.deepEqual( ledger.renderTargets.map( ( target ) => target.semantic ), [ 'output', 'normal', 'emissive', 'depth', 'capture-target' ] );
	assert.equal( new Set( ledger.renderTargets.map( ( target ) => target.textureUuid ) ).size, 5 );
	assert.deepEqual( ledger.renderTargets.map( ( target ) => target.format ), [ 'rgba16float', 'rgba16float', 'rgba16float', 'depth32float', 'rgba8unorm-srgb' ] );
	assert.equal( ledger.renderTargets.find( ( target ) => target.semantic === 'capture-target' ).textureName, 'validation-capture-rgba8' );
	assert.equal( ledger.renderTargets.find( ( target ) => target.semantic === 'output' ).targetUuid, null );
	assert.equal( ledger.renderTargets.find( ( target ) => target.semantic === 'output' ).targetIdentityAvailability, 'NOT_EXPOSED_BY_THREE_RENDER_TARGET' );
	assert.equal( ledger.trackedRenderTargetBytes, 30_720_000 );
	assert.equal( ledger.classSummaries.renderTargets.verdict, 'PASS' );
	assert.equal( ledger.sceneMrt.type, 'MRTNode' );
	assert.deepEqual( ledger.sceneMrt.outputs.map( ( mrtOutput ) => mrtOutput.semantic ), [ 'emissive', 'normal', 'output' ] );
	assert.equal( ledger.opaqueRendererInternalResidency.status, 'NOT_CLAIMED' );

} );

test( 'resource ledger inventories actual geometry attributes, indices, and renderer memory-map bytes', () => {

	const ledger = buildLedger( createRuntimeFixture() );
	assert.equal( ledger.geometries.length, 3 );
	assert.ok( ledger.geometries.every( ( geometry ) => geometry.attributeViews.some( ( attribute ) => attribute.slot === 'position' ) ) );
	assert.ok( ledger.geometries.every( ( geometry ) => geometry.indexView !== null ) );
	assert.ok( ledger.geometryAllocations.every( ( allocation ) => allocation.runtimeMemory.status === 'MEASURED' ) );
	assert.equal( ledger.trackedGeometryBytes, ledger.geometryAllocations.reduce( ( total, allocation ) => total + allocation.logicalBytes, 0 ) );
	assert.equal( ledger.classSummaries.geometryAllocations.runtimeMemoryCompleteness, 'COMPLETE' );
	assert.equal( ledger.classSummaries.geometryAllocations.verdict, 'PASS' );

} );

test( 'resource ledger keeps query-set residency unclaimed and uses actual timestamp-buffer sizes', () => {

	const ledger = buildLedger( createRuntimeFixture() );
	assert.deepEqual( ledger.transientResources.timestampQuerySets.map( ( resource ) => resource.id ), [ 'queryset_global_timestamp_render' ] );
	assert.equal( ledger.transientResources.timestampQuerySets[ 0 ].byteAccounting, 'NOT_CLAIMED' );
	assert.equal( Object.hasOwn( ledger.transientResources.timestampQuerySets[ 0 ], 'logicalBytes' ), false );
	assert.deepEqual( ledger.transientResources.timestampBuffers.map( ( resource ) => resource.id ), [
		'buffer_timestamp_resolve_render',
		'buffer_timestamp_result_render'
	] );
	assert.deepEqual( ledger.transientResources.timestampBuffers.map( ( resource ) => resource.component ), [ 'resolve-buffer', 'result-buffer' ] );
	assert.equal( ledger.transientResources.timestampBuffers.reduce( ( total, resource ) => total + resource.logicalBytes, 0 ), 128 );
	assert.equal( ledger.transientResources.readbackBuffers[ 0 ].id, 'validation-readback-4096' );
	assert.equal( ledger.transientResources.readbackBuffers[ 0 ].runtimeMemory.bytes, 4096 );
	assert.equal( ledger.classSummaries.timestampQuerySets.verdict, 'NOT_CLAIMED' );
	assert.equal( ledger.classSummaries.timestampBuffers.verdict, 'PASS' );
	assert.equal( ledger.classSummaries.readbackBuffers.verdict, 'PASS' );

} );

test( 'resource ledger rejects guessed timestamp-buffer sizes', () => {

	const fixture = createRuntimeFixture();
	delete fixture.renderer.backend.timestampQueryPool.render.resolveBuffer.size;
	assert.throws( () => buildLedger( fixture ), /resolve-buffer\.size must be a positive integer/ );

} );

test( 'resource ledger counts a shared BufferAttribute allocation once across bindings', () => {

	const fixture = createRuntimeFixture();
	const shared = fixture.geometries[ 0 ].getAttribute( 'position' );
	fixture.geometries[ 1 ].setAttribute( 'sharedPosition', shared );
	const ledger = buildLedger( fixture );
	const allocation = ledger.geometryAllocations.find( ( record ) => record.id === `buffer-attribute:${ shared.id }` );
	assert.equal( allocation.bindings.length, 2 );
	assert.equal( ledger.geometryAllocations.filter( ( record ) => record.id === allocation.id ).length, 1 );

} );

test( 'resource ledger accepts interleaved attribute views as one UUID-backed allocation', () => {

	const fixture = createRuntimeFixture( { registerMemory: false } );
	const geometry = new BufferGeometry();
	geometry.name = 'interleaved-fixture';
	const interleaved = new InterleavedBuffer( new Float32Array( [
		0, 0, 0, 0, 1, 0,
		1, 0, 0, 0, 1, 0,
		0, 1, 0, 0, 1, 0
	] ), 6 );
	const position = new InterleavedBufferAttribute( interleaved, 3, 0 );
	const normal = new InterleavedBufferAttribute( interleaved, 3, 3 );
	geometry.setAttribute( 'position', position );
	geometry.setAttribute( 'normal', normal );
	geometry.setIndex( new BufferAttribute( new Uint16Array( [ 0, 1, 2 ] ), 1 ) );
	fixture.geometries = [ geometry ];
	for ( const texture of [ ...fixture.scenePass.renderTarget.textures, fixture.scenePass.renderTarget.depthTexture, fixture.captureTarget.texture ] ) fixture.renderer.info.createTexture( texture );
	fixture.renderer.info.createAttribute( position );
	fixture.renderer.info.createIndexAttribute( geometry.index );
	fixture.renderer.info.createReadbackBuffer( fixture.readback );
	const ledger = buildLedger( fixture );
	const interleavedAllocation = ledger.geometryAllocations.find( ( allocation ) => allocation.id === `interleaved-buffer:${ interleaved.uuid }` );
	assert.equal( interleavedAllocation.bindings.length, 2 );
	assert.equal( interleavedAllocation.logicalBytes, interleaved.array.byteLength );
	assert.equal( interleavedAllocation.runtimeMemory.status, 'MEASURED' );
	assert.equal( ledger.geometryAllocations.length, 2 );

} );

test( 'resource ledger exposes non-resident runtime identities as insufficient instead of inventing memory bytes', () => {

	const ledger = buildLedger( createRuntimeFixture( { registerMemory: false } ) );
	assert.ok( ledger.renderTargets.every( ( target ) => target.runtimeMemory.status === 'NOT_RESIDENT' ) );
	assert.equal( ledger.classSummaries.renderTargets.runtimeMemoryCompleteness, 'PARTIAL' );
	assert.equal( ledger.classSummaries.renderTargets.verdict, 'INSUFFICIENT_EVIDENCE' );
	assert.equal( ledger.rendererInfoMemory.status, 'MEASURED' );

} );

test( 'resource ledger rejects texture identity aliasing', () => {

	const ledger = structuredClone( buildLedger( createRuntimeFixture() ) );
	ledger.renderTargets.find( ( target ) => target.semantic === 'emissive' ).textureUuid = ledger.renderTargets.find( ( target ) => target.semantic === 'normal' ).textureUuid;
	assert.throws( () => validateValidationResourceLedger( ledger ), /aliases runtime identity/ );

} );

test( 'resource ledger rejects MRT output-node aliasing independently of texture names', () => {

	const fixture = createRuntimeFixture();
	fixture.scenePass.setMRT( mrt( { output, normal: normalView, emissive: normalView } ) );
	assert.throws( () => buildLedger( fixture ), /MRT .* output aliases/ );

} );

test( 'resource ledger rejects omitted required MRT attachments', () => {

	const fixture = createRuntimeFixture();
	fixture.scenePass.renderTarget.textures = fixture.scenePass.renderTarget.textures.filter( ( texture ) => texture.name !== 'normal' );
	assert.throws( () => buildLedger( fixture ), /omits required normal/ );

} );

test( 'resource ledger rejects semantic type and format drift', () => {

	const fixture = createRuntimeFixture();
	fixture.scenePass.getTexture( 'normal' ).type = UnsignedByteType;
	assert.throws( () => buildLedger( fixture ), /normal texture type\/format drifted/ );

} );

test( 'resource ledger rejects renderer memory-map mismatches', () => {

	const fixture = createRuntimeFixture();
	const capture = fixture.captureTarget.texture;
	fixture.renderer.info.memoryMap.set( capture, fixture.renderer.info.memoryMap.get( capture ) + 4 );
	assert.throws( () => buildLedger( fixture ), /memoryMap bytes .* do not match/ );

} );

test( 'resource ledger rejects a peak below the current live allocation', () => {

	const ledger = structuredClone( buildLedger( createRuntimeFixture() ) );
	ledger.trackedPeakLiveBytes = ledger.trackedLiveBytes - 1;
	assert.throws( () => validateValidationResourceLedger( ledger ), /peak live bytes/ );

} );

test( 'resource ledger rejects contradictory live and disposed liveness', () => {

	const ledger = structuredClone( buildLedger( createRuntimeFixture() ) );
	ledger.renderTargets[ 0 ].liveness = 'disposed';
	ledger.renderTargets[ 0 ].liveBytes = 0;
	assert.throws( () => validateValidationResourceLedger( ledger ), /Live resource ledger contains a non-live .* identity/ );

} );

test( 'resource ledger rejects nested geometry-allocation liveness drift', () => {

	const ledger = structuredClone( buildLedger( createRuntimeFixture() ) );
	ledger.geometryAllocations[ 0 ].liveness = 'disposed';
	ledger.geometryAllocations[ 0 ].liveBytes = 0;
	assert.throws( () => validateValidationResourceLedger( ledger ), /Live resource ledger contains a non-live .* identity/ );

} );

test( 'resource ledger rejects forged class verdicts and subtotals', () => {

	const incomplete = buildLedger( createRuntimeFixture( { registerMemory: false } ) );
	incomplete.classSummaries.renderTargets.verdict = 'PASS';
	assert.throws( () => validateValidationResourceLedger( incomplete ), /classSummaries\.renderTargets\.verdict/ );

	const subtotal = structuredClone( buildLedger( createRuntimeFixture() ) );
	subtotal.trackedGeometryBytes --;
	assert.throws( () => validateValidationResourceLedger( subtotal ), /trackedGeometryBytes/ );

} );

test( 'resource ledger carries the observed peak across smaller live generations', () => {

	const larger = buildLedger( createRuntimeFixture() );
	const smaller = buildLedger( createRuntimeFixture( { sceneWidth: 600, sceneHeight: 400, captureWidth: 600, captureHeight: 400 } ), larger );
	assert.ok( smaller.trackedLiveBytes < larger.trackedLiveBytes );
	assert.equal( smaller.trackedPeakLiveBytes, larger.trackedPeakLiveBytes );

} );

test( 'disposed ledger retains every observed identity while zeroing live bytes', () => {

	const fixture = createRuntimeFixture();
	const live = buildLedger( fixture );
	fixture.renderer.info.dispose();
	const disposed = emptyValidationResourceLedger( { renderer: fixture.renderer, previousLedger: live } );
	assert.equal( disposed.state, 'disposed' );
	assert.equal( disposed.trackedLiveBytes, 0 );
	assert.equal( disposed.trackedRenderTargetBytes, 0 );
	assert.equal( disposed.trackedGeometryBytes, 0 );
	assert.equal( disposed.trackedTransientBytes, 0 );
	assert.equal( disposed.trackedPeakLiveBytes, live.trackedPeakLiveBytes );
	assert.equal( disposed.predecessorIdentityClosureDigest, live.identityClosureDigest );
	assert.equal( disposed.identityClosureDigest, live.identityClosureDigest );
	assert.deepEqual( disposed.renderTargets.map( ( target ) => target.textureUuid ), live.renderTargets.map( ( target ) => target.textureUuid ) );
	assert.deepEqual( disposed.geometries.map( ( geometry ) => geometry.uuid ), live.geometries.map( ( geometry ) => geometry.uuid ) );
	assert.ok( disposed.renderTargets.every( ( target ) => target.liveness === 'disposed' && target.liveBytes === 0 ) );
	assert.equal( disposed.disposalObservation.memoryMapSize, 0 );
	assert.equal( disposed.disposalObservation.memoryTotalBytes, 0 );
	assert.equal( disposed.opaqueRendererInternalResidency.status, 'NOT_CLAIMED' );
	const forgedRuntimeMemory = structuredClone( disposed );
	forgedRuntimeMemory.renderTargets[ 0 ].runtimeMemory = forgedRuntimeMemory.renderTargets[ 0 ].lastLiveRuntimeMemory;
	assert.throws( () => validateValidationResourceLedger( forgedRuntimeMemory ), /runtime memory unavailable after disposal|invalid live runtime-memory|must make runtime memory unavailable/ );
	const forgedIdentity = structuredClone( disposed );
	forgedIdentity.renderTargets[ 0 ].textureUuid = 'forged-texture-uuid';
	assert.throws( () => validateValidationResourceLedger( forgedIdentity ), /drifted from the predecessor digest/ );
	assert.throws( () => emptyValidationResourceLedger( { renderer: fixture.renderer, previousLedger: disposed } ), /requires an exact live predecessor/ );

} );

test( 'disposed ledger refuses to synthesize zero while runtime resources remain resident', () => {

	const fixture = createRuntimeFixture();
	const live = buildLedger( fixture );
	assert.throws( () => emptyValidationResourceLedger( { renderer: fixture.renderer, previousLedger: live } ), /still exposes live memory/ );

} );

test( 'disposed ledger cannot manufacture an unrelated empty inventory', () => {

	assert.throws( () => emptyValidationResourceLedger(), /actual WebGPURenderer/ );
	const fixture = createRuntimeFixture();
	const live = buildLedger( fixture );
	fixture.renderer.info.dispose();
	const disposed = emptyValidationResourceLedger( { renderer: fixture.renderer, previousLedger: live } );
	disposed.renderTargets = [];
	disposed.geometries = [];
	disposed.geometryAllocations = [];
	disposed.transientResources.timestampQuerySets = [];
	disposed.transientResources.timestampBuffers = [];
	disposed.transientResources.readbackBuffers = [];
	assert.throws( () => validateValidationResourceLedger( disposed ), /must contain exactly|retain the identities/ );

} );

test( 'resource ledger rejects descriptor-only dimensions in place of runtime objects', () => {

	assert.throws( () => buildValidationResourceLedger( { sceneWidth: 1200, sceneHeight: 800, captureWidth: 1200, captureHeight: 800 } ), /renderer must be an actual WebGPURenderer/ );

} );
