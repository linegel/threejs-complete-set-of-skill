import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BoxGeometry,
	FloatType,
	HalfFloatType,
	PerspectiveCamera,
	PlaneGeometry,
	RenderTarget,
	Scene,
	SRGBColorSpace,
	UnsignedByteType,
	WebGPURenderer
} from 'three/webgpu';
import { emissive, mrt, normalView, output, pass } from 'three/tsl';

import {
	assertRendererBackendDeviceIdentity,
	createValidationResourceLedgerObserver,
	parseRenderTimestampUid,
	summarizeTimestampBatch,
	timestampResolutionPolicy
} from './browser-subject-adapter.js';

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

function createResourceObserverFixture() {

	const renderer = new WebGPURenderer( { canvas: testCanvas(), outputBufferType: HalfFloatType } );
	const scenePass = pass( new Scene(), new PerspectiveCamera() );
	scenePass.setMRT( mrt( { output, normal: normalView, emissive } ) );
	scenePass.setSize( 1200, 800 );
	scenePass.getTexture( 'normal' );
	scenePass.getTexture( 'emissive' );
	scenePass.renderTarget.depthTexture.type = FloatType;
	scenePass.renderTarget.depthTexture.image.width = 1200;
	scenePass.renderTarget.depthTexture.image.height = 800;
	const captureTarget = new RenderTarget( 1200, 800, { type: UnsignedByteType, depthBuffer: false } );
	captureTarget.texture.colorSpace = SRGBColorSpace;
	captureTarget.texture.name = 'validation-capture-rgba8';
	const geometries = [ new BoxGeometry( 1, 1, 1 ), new PlaneGeometry( 2, 2 ) ];
	return {
		renderer,
		observer: createValidationResourceLedgerObserver( { renderer, scenePass, captureTarget, geometries } )
	};

}

test( 'renderer identity requires the exact device retained by the initialized backend', () => {

	const requestedDevice = {};
	assert.equal( assertRendererBackendDeviceIdentity( requestedDevice, requestedDevice ), requestedDevice );
	assert.throws( () => assertRendererBackendDeviceIdentity( requestedDevice, {} ), /exact requested GPUDevice/ );
	assert.throws( () => assertRendererBackendDeviceIdentity( requestedDevice, null ), /actual GPUDevice/ );

} );

test( 'timestamp populations are resolved once per sustained batch', () => {

	assert.equal( timestampResolutionPolicy.mappingCadence, 'once-per-batch' );
	const batch = summarizeTimestampBatch( {
		entries: [
			{ uid: 'r:2:41:f10', stage: 'final-output', durationMs: 1 },
			{ uid: 'r:1:17:f10', stage: 'scene-mrt', durationMs: 3 },
			{ uid: 'r:4:41:f11', stage: 'final-output', durationMs: 2 },
			{ uid: 'r:3:17:f11', stage: 'scene-mrt', durationMs: 4 }
		],
		resolvedLastFrameTotalMs: 6
	} );
	assert.deepEqual( batch.totalSamples, [ 4, 6 ] );
	assert.deepEqual( batch.stageSamples[ 'scene-mrt' ], [ 3, 4 ] );
	assert.deepEqual( batch.stageSamples[ 'final-output' ], [ 1, 2 ] );
	assert.deepEqual( batch.stageContextIds, { 'final-output': 41, 'scene-mrt': 17 } );
	assert.equal( batch.resolveCount, 1 );
	assert.equal( batch.lastFrameResolveResidualMs, 0 );
	assert.equal( batch.independentPerFrameTotalsAvailable, false );
	assert.equal( batch.rows[ 0 ].sceneUid, 'r:1:17:f10' );
	assert.equal( batch.rows[ 0 ].outputUid, 'r:2:41:f10' );
	assert.equal( batch.rows[ 0 ].residualMs, null );
	assert.deepEqual( parseRenderTimestampUid( 'r:123:45:f67' ), { uid: 'r:123:45:f67', frameCall: 123, contextId: 45, frameId: 67 } );
	assert.throws( () => parseRenderTimestampUid( 'r:scene:f67' ), /does not match Three r185/ );

} );

test( 'timestamp attribution rejects ordering, stage, frame, and context forgeries', () => {

	const base = [
		{ uid: 'r:1:17:f10', stage: 'scene-mrt', durationMs: 3 },
		{ uid: 'r:2:41:f10', stage: 'final-output', durationMs: 1 },
		{ uid: 'r:3:17:f11', stage: 'scene-mrt', durationMs: 4 },
		{ uid: 'r:4:41:f11', stage: 'final-output', durationMs: 2 }
	];
	assert.throws( () => summarizeTimestampBatch( {
		entries: base.map( ( entry, index ) => index === 1 ? { ...entry, uid: 'r:2:17:f10', stage: 'scene-mrt' } : entry ),
		resolvedLastFrameTotalMs: 6
	} ), /duplicates stage|exactly one/ );
	assert.throws( () => summarizeTimestampBatch( {
		entries: base.map( ( entry, index ) => index === 3 ? { ...entry, uid: 'r:4:99:f11' } : entry ),
		resolvedLastFrameTotalMs: 6
	} ), /changed render-context identity/ );
	assert.throws( () => summarizeTimestampBatch( {
		entries: base.map( ( entry ) => entry.uid.endsWith( 'f11' ) ? { ...entry, uid: entry.uid.replace( 'f11', 'f12' ) } : entry ),
		resolvedLastFrameTotalMs: 6
	} ), /frame IDs must be contiguous/ );
	assert.throws( () => summarizeTimestampBatch( {
		entries: base.map( ( entry ) => entry.stage === 'final-output' ? { ...entry, uid: entry.uid.replace( ':41:', ':17:' ) } : entry ),
		resolvedLastFrameTotalMs: 6
	} ), /two distinct stable render contexts/ );

} );

test( 'resource observer retains the exact live predecessor and reports zero live bytes after disposal', () => {

	const { renderer, observer } = createResourceObserverFixture();
	const firstLive = observer.describeLive();
	const latestLive = observer.describeLive();
	assert.equal( latestLive.identityClosureDigest, firstLive.identityClosureDigest );
	assert.equal( latestLive.trackedRenderTargetBytes, 30_720_000 );
	assert.equal( observer.current(), latestLive );

	renderer.info.dispose();
	const disposed = observer.describeDisposed();
	assert.equal( disposed.state, 'disposed' );
	assert.equal( disposed.predecessorIdentityClosureDigest, latestLive.identityClosureDigest );
	assert.equal( disposed.identityClosureDigest, latestLive.identityClosureDigest );
	assert.deepEqual( disposed.renderTargets.map( ( target ) => target.textureUuid ), latestLive.renderTargets.map( ( target ) => target.textureUuid ) );
	assert.deepEqual( disposed.geometries.map( ( geometry ) => geometry.uuid ), latestLive.geometries.map( ( geometry ) => geometry.uuid ) );
	assert.equal( disposed.trackedRenderTargetBytes, 0 );
	assert.equal( disposed.trackedGeometryBytes, 0 );
	assert.equal( disposed.trackedTransientBytes, 0 );
	assert.equal( disposed.trackedLiveBytes, 0 );
	assert.equal( disposed.disposalObservation.memoryMapSize, 0 );
	assert.equal( disposed.disposalObservation.memoryTotalBytes, 0 );
	assert.equal( observer.describeDisposed(), disposed );
	assert.throws( () => observer.describeLive(), /after disposal/ );

} );
