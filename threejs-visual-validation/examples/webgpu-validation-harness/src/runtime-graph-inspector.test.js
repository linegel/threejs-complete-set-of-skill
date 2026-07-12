import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	BoxGeometry,
	FloatType,
	HalfFloatType,
	PerspectiveCamera,
	RenderPipeline,
	RenderTarget,
	Scene,
	SRGBColorSpace,
	UnsignedByteType,
	WebGPURenderer
} from 'three/webgpu';
import { emissive as mrtEmissive, mrt, normalView, output as mrtOutput, pass, renderOutput, vec4 } from 'three/tsl';

import { buildValidationResourceLedger } from './resource-ledger.js';
import { inspectNodeIdentityGraph, inspectRuntimeGraph } from './runtime-graph-inspector.js';

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

function createGraphFixture() {

	const renderer = new WebGPURenderer( { canvas: testCanvas(), outputBufferType: HalfFloatType } );
	const scenePass = pass( new Scene(), new PerspectiveCamera() );
	scenePass.setMRT( mrt( { output: mrtOutput, normal: normalView, emissive: mrtEmissive } ) );
	scenePass.setSize( 64, 48 );
	scenePass.getTexture( 'normal' );
	scenePass.getTexture( 'emissive' );
	scenePass.renderTarget.depthTexture.type = FloatType;
	scenePass.renderTarget.depthTexture.image.width = 64;
	scenePass.renderTarget.depthTexture.image.height = 48;
	const output = scenePass.getTextureNode( 'output' );
	const normal = scenePass.getTextureNode( 'normal' );
	const emissive = scenePass.getTextureNode( 'emissive' );
	const depth = scenePass.getTextureNode( 'depth' );
	output.name = 'signal-output';
	normal.name = 'signal-normal';
	emissive.name = 'signal-emissive';
	depth.name = 'signal-depth';
	const routeRoots = {
		final: renderOutput( vec4( output.rgb.add( emissive.rgb.mul( 0.12 ) ), output.a ) ),
		'no-post': renderOutput( output ),
		normal: renderOutput( normal ),
		emissive: renderOutput( emissive ),
		depth: renderOutput( vec4( depth, depth, depth, 1 ) )
	};
	const selectedRoute = 'final';
	const signalNodes = { output, normal, emissive, depth };
	const signalProducers = { output: 'scene-pass', normal: 'scene-pass', emissive: 'scene-pass', depth: 'scene-pass' };
	const routeSignalContract = {
		final: [ 'output', 'emissive' ],
		'no-post': [ 'output' ],
		normal: [ 'normal' ],
		emissive: [ 'emissive' ],
		depth: [ 'depth' ]
	};
	const captureTarget = new RenderTarget( 64, 48, { type: UnsignedByteType, depthBuffer: false } );
	captureTarget.texture.name = 'validation-capture-rgba8';
	captureTarget.texture.colorSpace = SRGBColorSpace;
	const geometries = [ new BoxGeometry( 1, 1, 1 ) ];
	for ( const texture of [ ...scenePass.renderTarget.textures, scenePass.renderTarget.depthTexture, captureTarget.texture ] ) renderer.info.createTexture( texture );
	for ( const attribute of Object.values( geometries[ 0 ].attributes ) ) renderer.info.createAttribute( attribute );
	renderer.info.createIndexAttribute( geometries[ 0 ].index );
	const resourceLedger = buildValidationResourceLedger( { renderer, scenePass, captureTarget, geometries } );
	const renderPipeline = new RenderPipeline( renderer );
	renderPipeline.outputColorTransform = false;
	renderPipeline.outputNode = routeRoots.final;
	renderPipeline._update();
	const readbackSinks = [ {
		id: 'final-rgba8-readback',
		resourceId: captureTarget.texture.uuid,
		owner: 'validation-capture',
		method: 'renderer.readRenderTargetPixelsAsync',
		resourceFormat: 'rgba8unorm-srgb',
		transportFormat: 'rgba8unorm',
		observedByteLength: 64 * 48 * 4
	} ];
	return {
		selectedRoute,
		renderPipeline,
		routeRoots,
		signalNodes,
		signalProducers,
		routeSignalContract,
		resourceLedger,
		readbackSinks
	};

}

test( 'node inspector records r185 public-child edges, UUIDs, and types', () => {

	const fixture = createGraphFixture();
	const graph = inspectNodeIdentityGraph( fixture.renderPipeline._quadMesh.material.fragmentNode );
	assert.equal( graph.traversalApi, 'Three.js r185 Node.getChildren()' );
	assert.ok( graph.nodes.length > 1 );
	assert.ok( graph.edges.length > 0 );
	assert.ok( graph.nodes.every( ( node ) => typeof node.uuid === 'string' && typeof node.type === 'string' ) );
	assert.ok( graph.edges.every( ( edge ) => typeof edge.fromUuid === 'string' && typeof edge.toUuid === 'string' && Number.isInteger( edge.childIndex ) ) );
	assert.equal( graph.renderOutputNodeCount, 1 );

} );

test( 'runtime graph proves exact signal identity reachability and the selected compiled fragment root', () => {

	const fixture = createGraphFixture();
	const evidence = inspectRuntimeGraph( fixture );
	const present = evidence.sceneSubmissions.find( ( submission ) => submission.id === 'final-output' );
	assert.equal( evidence.schemaVersion, 2 );
	assert.deepEqual( evidence.signals.map( ( signal ) => signal.id ), [ 'depth', 'emissive', 'normal', 'output' ] );
	assert.deepEqual( present.routes.find( ( route ) => route.id === 'final' ).reachableSignals, [ 'emissive', 'output' ] );
	assert.deepEqual( present.routes.find( ( route ) => route.id === 'normal' ).reachableSignals, [ 'normal' ] );
	assert.deepEqual( present.routes.find( ( route ) => route.id === 'depth' ).reachableSignals, [ 'depth' ] );
	assert.equal( present.selectedRouteRootUuid, fixture.routeRoots.final.uuid );
	assert.equal( present.compiledFragmentRoot.rootUuid, fixture.renderPipeline._quadMesh.material.fragmentNode.uuid );
	assert.equal( present.compiledFragmentRoot.renderOutputNodeCount, 1 );
	assert.equal( evidence.signals.find( ( signal ) => signal.id === 'depth' ).reachable, false );
	assert.equal( evidence.signals.find( ( signal ) => signal.id === 'depth' ).consumers.includes( 'depth' ), true );

} );

test( 'runtime graph conforms exactly to the checked runtime-graph v2 schema surface', () => {

	const fixture = createGraphFixture();
	const evidence = inspectRuntimeGraph( fixture );
	const schema = JSON.parse( readFileSync( new URL( '../../../../labs/schema/runtime-graph.schema.json', import.meta.url ), 'utf8' ) );
	assert.equal( schema.additionalProperties, false );
	assert.equal( evidence.schemaVersion, schema.properties.schemaVersion.const );
	assert.deepEqual( Object.keys( evidence ).sort(), Object.keys( schema.properties ).sort() );
	for ( const required of schema.required ) assert.ok( Object.hasOwn( evidence, required ) );
	for ( const signal of evidence.signals ) assert.deepEqual( Object.keys( signal ).sort(), [ 'consumers', 'encoding', 'id', 'producer', 'reachable' ] );
	assert.ok( evidence.sceneSubmissions.every( ( submission ) => schema.$defs.pass.properties.kind.enum.includes( submission.kind ) ) );
	assert.ok( evidence.resources.every( ( resource ) => resource.residentBytes.unit === 'bytes' && [ 'Derived', 'Measured' ].includes( resource.residentBytes.label ) ) );

} );

test( 'runtime graph keeps produced signals, route reachability, allocations, and readback sinks separate', () => {

	const evidence = inspectRuntimeGraph( createGraphFixture() );
	const present = evidence.sceneSubmissions.find( ( submission ) => submission.id === 'final-output' );
	assert.ok( evidence.resources.length > 5 );
	assert.equal( present.readbackSinks.length, 1 );
	assert.equal( evidence.resources.some( ( resource ) => resource.id === present.readbackSinks[ 0 ].resourceId ), true );
	assert.deepEqual( present.classifications, {
		producedSignals: 'node-identity-producers',
		routeReachability: 'Node.getChildren()-identity-reachability',
		allocatedResources: 'validated-resource-ledger-identity-closure',
		readbackSinks: 'observed-capture-readbacks'
	} );
	assert.equal( Object.hasOwn( evidence.signals[ 0 ], 'resourceId' ), false );
	assert.equal( Object.hasOwn( evidence.resources[ 0 ], 'nodeUuid' ), false );

} );

test( 'runtime graph rejects aliased produced-signal identities', () => {

	const fixture = createGraphFixture();
	fixture.signalNodes.emissive = fixture.signalNodes.output;
	assert.throws( () => inspectRuntimeGraph( fixture ), /aliases another produced signal node/ );

} );

test( 'runtime graph rejects an omitted required signal', () => {

	const fixture = createGraphFixture();
	delete fixture.signalNodes.depth;
	delete fixture.signalProducers.depth;
	assert.throws( () => inspectRuntimeGraph( fixture ), /Required signal depth is omitted/ );

} );

test( 'runtime graph rejects route-root aliasing', () => {

	const fixture = createGraphFixture();
	fixture.routeRoots.emissive = fixture.routeRoots.normal;
	assert.throws( () => inspectRuntimeGraph( fixture ), /aliases another fixed route output root/ );

} );

test( 'runtime graph rejects fixed-route reachability that differs from its contract', () => {

	const fixture = createGraphFixture();
	fixture.routeSignalContract.final = [ 'output' ];
	assert.throws( () => inspectRuntimeGraph( fixture ), /reachable signals do not match/ );

} );

test( 'runtime graph rejects a required signal with no fixed diagnostic route', () => {

	const fixture = createGraphFixture();
	delete fixture.routeRoots.depth;
	delete fixture.routeSignalContract.depth;
	assert.throws( () => inspectRuntimeGraph( fixture ), /Required signal depth is not reachable/ );

} );

test( 'runtime graph rejects a live pipeline whose selected output identity drifted', () => {

	const fixture = createGraphFixture();
	fixture.renderPipeline.outputNode = fixture.routeRoots.normal;
	assert.throws( () => inspectRuntimeGraph( fixture ), /outputNode does not equal the selected/ );

} );

test( 'runtime graph rejects multiple RenderOutputNode owners in a fixed route', () => {

	const fixture = createGraphFixture();
	fixture.routeRoots.final = renderOutput( fixture.routeRoots.final );
	fixture.renderPipeline.outputNode = fixture.routeRoots.final;
	fixture.renderPipeline.needsUpdate = true;
	fixture.renderPipeline._update();
	assert.throws( () => inspectRuntimeGraph( fixture ), /must contain exactly one RenderOutputNode/ );

} );

test( 'runtime graph rejects an undeclared second PassNode in the selected route', () => {

	const fixture = createGraphFixture();
	const extraPass = pass( new Scene(), new PerspectiveCamera() );
	const extraOutput = extraPass.getTextureNode( 'output' );
	fixture.routeRoots.final = renderOutput( vec4( fixture.signalNodes.output.rgb.add( fixture.signalNodes.emissive.rgb ).add( extraOutput.rgb ), 1 ) );
	fixture.renderPipeline.outputNode = fixture.routeRoots.final;
	fixture.renderPipeline.needsUpdate = true;
	fixture.renderPipeline._update();
	assert.throws( () => inspectRuntimeGraph( fixture ), /reaches an undeclared PassNode/ );

} );

test( 'runtime graph rejects a fabricated or incomplete resource ledger', () => {

	const fixture = createGraphFixture();
	fixture.resourceLedger = structuredClone( fixture.resourceLedger );
	fixture.resourceLedger.renderTargets = [];
	assert.throws( () => inspectRuntimeGraph( fixture ), /must contain exactly/ );

} );

test( 'runtime graph rejects a readback sink with no allocated resource identity', () => {

	const fixture = createGraphFixture();
	fixture.readbackSinks[ 0 ].resourceId = 'unallocated-texture';
	assert.throws( () => inspectRuntimeGraph( fixture ), /must bind the validated capture-target/ );

} );

test( 'runtime graph rejects readback metadata that conflates sRGB resource and raw transport formats', () => {

	const fixture = createGraphFixture();
	fixture.readbackSinks[ 0 ].transportFormat = 'rgba8unorm-srgb';
	assert.throws( () => inspectRuntimeGraph( fixture ), /distinguish the sRGB resource from raw RGBA8/ );

} );
