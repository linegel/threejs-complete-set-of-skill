import {
	createCapabilityTier,
	createDefaultImagePipelineConfig,
	evaluateLightingAwareAoComposite
} from './pipelineConfig.js';
import { PerspectiveCamera, Scene } from 'three/webgpu';
import { pass, mrt, output, normalView, emissive, renderOutput } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import { composeFinalGraph } from './composeFinalGraph.js';

function fail( message ) {

	throw new Error( message );

}

function collectReachableNodes( rootNode ) {

	if ( ! rootNode || typeof rootNode.traverse !== 'function' ) {

		fail( 'Live graph validation requires a RenderPipeline.outputNode with node.traverse().' );

	}

	const reachable = new Set();

	rootNode.traverse( ( node ) => {

		reachable.add( node );

	} );

	return reachable;

}

export function validateImagePipelineGraph( config, graph ) {

	const outputNode = graph?.renderPipeline?.outputNode ?? graph?.outputNode;
	const finalOutputNode = graph?.finalOutputNode ?? outputNode;
	const aoTextureNode = graph?.aoTextureNode;
	const reachable = collectReachableNodes( outputNode );
	const finalReachable = finalOutputNode === outputNode ? reachable : collectReachableNodes( finalOutputNode );
	const passNodes = [ ...reachable ].filter( ( node ) => node?.isPassNode === true );

	if ( passNodes.length !== 1 ) {

		fail( `Live output node graph must reach exactly one PassNode, got ${ passNodes.length }.` );

	}

	if ( config.sceneRenderCount !== passNodes.length ) {

		fail( `Config sceneRenderCount ${ config.sceneRenderCount } disagrees with live graph PassNode count ${ passNodes.length }.` );

	}

	if ( ! aoTextureNode ) {

		fail( 'Live graph validation requires the GTAO texture node used by the final composite.' );

	}

	if ( ! finalReachable.has( aoTextureNode ) ) {

		fail( 'Final non-debug output graph must consume the GTAO texture node.' );

	}

	return {
		pass: true,
		scenePassCount: passNodes.length,
		aoTextureReachableFromFinal: true
	};

}

export function validateImagePipelineConfig( config = createDefaultImagePipelineConfig(), graph = null ) {

	if ( config.sceneRenderCount !== 1 ) {

		fail( 'Image pipeline must use exactly one scene render by default.' );

	}

	if ( ! config.toneMapOwner || ! config.outputTransformOwner ) {

		fail( 'Both toneMapOwner and outputTransformOwner are required.' );

	}

	if ( config.outputTransformOwner === 'renderOutput' && config.outputColorTransform !== false ) {

		fail( 'renderOutput() output ownership requires RenderPipeline.outputColorTransform = false.' );

	}

	if ( config.outputTransformOwner === 'RenderPipeline.outputColorTransform' && config.outputColorTransform !== true ) {

		fail( 'RenderPipeline output ownership requires outputColorTransform = true.' );

	}

	if ( config.toneMapOwner !== config.outputTransformOwner && config.outputColorTransform !== false ) {

		fail( 'Split output ownership requires RenderPipeline.outputColorTransform = false.' );

	}

	if ( config.toneMapOwner === 'RenderPipeline' && config.outputTransformOwner === 'renderOutput' ) {

		fail( 'Tone mapping and output conversion cannot be split across RenderPipeline and renderOutput().' );

	}

	for ( const consumerName of Object.keys( config.consumers ) ) {

		if ( ! config.producers[ consumerName ] ) {

			fail( `Consumer list "${ consumerName }" has no matching producer.` );

		}

		if ( ! config.colorDomains[ consumerName ] ) {

			fail( `Consumer list "${ consumerName }" has no matching color/domain declaration.` );

		}

	}

	for ( const mrtName of config.requiredMRT ) {

		if ( ! config.producers[ mrtName ] ) {

			fail( `MRT "${ mrtName }" is missing a producer.` );

		}

		if ( ! Array.isArray( config.consumers[ mrtName ] ) || config.consumers[ mrtName ].length === 0 ) {

			fail( `MRT "${ mrtName }" is missing declared consumers.` );

		}

		if ( ! config.colorDomains[ mrtName ] ) {

			fail( `MRT "${ mrtName }" is missing a color/domain declaration.` );

		}

	}

	if ( config.temporal.enabled === true ) {

		if ( ! config.temporal.velocityConvention ) {

			fail( 'Temporal mode requires a velocity convention.' );

		}

		if ( ! config.temporal.jitterOwner ) {

			fail( 'Temporal mode requires a jitter owner.' );

		}

	}

	const estimatedBytes = config.requiredMRT.length * config.memory.hdrAttachmentBytes;

	if ( estimatedBytes > config.memory.memoryBudget ) {

		fail( `Estimated MRT memory ${ estimatedBytes } exceeds budget ${ config.memory.memoryBudget }.` );

	}

	if ( config.resize.updatesRenderer !== true || config.resize.updatesScenePass !== true ) {

		fail( 'Resize path must update renderer and scene pass.' );

	}

	if ( config.disposal.disposesRenderPipeline !== true || config.disposal.disposesTargets !== true ) {

		fail( 'Disposal path must own RenderPipeline and target teardown.' );

	}

	const aoComposite = validateAoCompositeContract();
	const liveGraph = graph ? validateImagePipelineGraph( config, graph ) : null;

	return {
		pass: true,
		sceneRenderCount: config.sceneRenderCount,
		toneMapOwner: config.toneMapOwner,
		outputTransformOwner: config.outputTransformOwner,
		requiredMRT: config.requiredMRT,
		estimatedBytes,
		aoComposite,
		liveGraph
	};

}

function assertRgbEqual( actual, expected, label ) {

	for ( let index = 0; index < 3; index += 1 ) {

		if ( Math.abs( actual[ index ] - expected[ index ] ) > 1e-9 ) {

			fail( `${ label } changed at channel ${ index }: expected ${ expected[ index ] }, got ${ actual[ index ] }.` );

		}

	}

}

export function validateAoCompositeContract() {

	const pixelTerms = {
		direct: [ 1.2, 0.7, 0.35 ],
		indirect: [ 0.4, 0.25, 0.12 ],
		emissive: [ 3.5, 2.1, 0.8 ],
		atmosphere: [ 0.18, 0.22, 0.31 ],
		ui: [ 0.9, 0.9, 0.9 ]
	};
	const aoForcedZero = evaluateLightingAwareAoComposite( pixelTerms, 0 );
	const aoForcedOne = evaluateLightingAwareAoComposite( pixelTerms, 1 );

	assertRgbEqual( aoForcedZero.direct, pixelTerms.direct, 'Direct light' );
	assertRgbEqual( aoForcedZero.emissive, pixelTerms.emissive, 'Emissive light' );
	assertRgbEqual( aoForcedZero.atmosphere, pixelTerms.atmosphere, 'Atmosphere' );
	assertRgbEqual( aoForcedZero.ui, pixelTerms.ui, 'UI overlay' );
	assertRgbEqual( aoForcedZero.indirect, [ 0, 0, 0 ], 'Indirect light under zero AO' );

	const removedByAo = aoForcedOne.color.map( ( component, index ) => component - aoForcedZero.color[ index ] );
	assertRgbEqual( removedByAo, pixelTerms.indirect, 'AO visibility must remove only indirect light' );

	return {
		pass: true,
		aoForcedZeroPreserves: [ 'direct', 'emissive', 'atmosphere', 'ui' ],
		aoForcedZeroRemoves: [ 'indirect' ]
	};

}

const fixtureFactories = {
	valid: () => ( { config: createDefaultImagePipelineConfig(), graph: createLiveGraphFixture() } ),
	'duplicate-scene-render': () => ( { config: createDefaultImagePipelineConfig( { sceneRenderCount: 2 } ), graph: createLiveGraphFixture() } ),
	'duplicate-scene-pass-graph': () => ( { config: createDefaultImagePipelineConfig(), graph: createLiveGraphFixture( { duplicateScenePass: true } ) } ),
	'missing-final-ao-graph': () => ( { config: createDefaultImagePipelineConfig(), graph: createLiveGraphFixture( { omitAoFromFinal: true } ) } ),
	'duplicate-output-owner': () => ( { config: createDefaultImagePipelineConfig( {
		toneMapOwner: 'RenderPipeline',
		outputTransformOwner: 'renderOutput',
		outputColorTransform: true
	} ) } ),
	'double-output-transform': () => ( { config: createDefaultImagePipelineConfig( {
		outputColorTransform: true
	} ) } ),
	'missing-velocity-convention': () => ( { config: createDefaultImagePipelineConfig( {
		requiredMRT: [ 'output', 'normal', 'emissive', 'velocity' ],
		producers: {
			output: 'scene-pass',
			normal: 'scene-pass',
			emissive: 'scene-pass',
			depth: 'scene-pass',
			velocity: 'scene-pass'
		},
		consumers: {
			output: [ 'lighting-composite' ],
			normal: [ 'GTAONode' ],
			emissive: [ 'BloomNode' ],
			depth: [ 'GTAONode' ],
			velocity: [ 'TRAANode' ]
		},
		colorDomains: {
			output: 'scene-linear HDR',
			normal: 'data/no-color',
			emissive: 'scene-linear HDR',
			depth: 'data/no-color',
			velocity: 'data/no-color',
			final: 'display-referred sRGB'
		},
		temporal: {
			enabled: true,
			velocityConvention: null,
			jitterOwner: null,
			resetEvents: [ 'resize' ]
		}
	} ) } ),
	'undeclared-mrt-consumer': () => ( { config: createDefaultImagePipelineConfig( {
		consumers: {
			output: [ 'lighting-composite' ],
			normal: [],
			emissive: [ 'BloomNode' ],
			depth: [ 'GTAONode' ]
		}
	} ) } )
};

function createLiveGraphFixture( options = {} ) {

	const scene = new Scene();
	const camera = new PerspectiveCamera();
	const scenePass = pass( scene, camera );
	const hdrColor = scenePass.getTextureNode( 'output' );
	const aoTextureNode = scenePass.getTextureNode( 'depth' );
	const indirectVisibility = aoTextureNode.r;
	let composite = options.omitAoFromFinal === true ? hdrColor : hdrColor.mul( indirectVisibility );

	if ( options.duplicateScenePass === true ) {

		const duplicatePass = pass( new Scene(), new PerspectiveCamera() );
		composite = composite.add( duplicatePass.getTextureNode( 'output' ) );

	}

	const finalOutputNode = renderOutput( composite );

	return {
		renderPipeline: { outputNode: finalOutputNode },
		finalOutputNode,
		aoTextureNode
	};

}

export function createRealImagePipelineGraph( config = createDefaultImagePipelineConfig() ) {

	const scene = new Scene();
	const camera = new PerspectiveCamera( 50, 1, 0.1, 100 );
	const scenePass = pass( scene, camera );
	scenePass.setResolutionScale( config.resolutionScales.scene );

	scenePass.setMRT( mrt( {
		output,
		normal: normalView,
		emissive
	} ) );

	const normalTex = scenePass.getTextureNode( 'normal' );
	const emissiveTex = scenePass.getTextureNode( 'emissive' );
	const depthTex = scenePass.getTextureNode( 'depth' );
	const gtao = ao( depthTex, normalTex, camera );
	const bloomPass = bloom( emissiveTex );

	gtao.resolutionScale = config.resolutionScales.ao;
	bloomPass.setResolutionScale( config.resolutionScales.bloom );

	const graph = composeFinalGraph( {
		config,
		scenePass,
		gtao,
		bloomPass,
		camera
	} );

	return {
		renderPipeline: { outputNode: graph.finalOutputNode },
		finalOutputNode: graph.finalOutputNode,
		aoTextureNode: graph.aoTextureNode,
		scene,
		camera,
		scenePass,
		gtao,
		bloomPass,
		graph
	};

}

export function runRealGraphValidation() {

	const config = createDefaultImagePipelineConfig();
	const realGraph = createRealImagePipelineGraph( config );
	const validation = validateImagePipelineConfig( config, realGraph );

	return {
		validation,
		constructorEscape: null
	};

}

export function runValidationFixture( fixtureName ) {

	const factory = fixtureFactories[ fixtureName ];

	if ( ! factory ) {

		fail( `Unknown fixture "${ fixtureName }".` );

	}

	const fixture = factory();
	return validateImagePipelineConfig( fixture.config, fixture.graph ?? null );

}

export function runSelfTest() {

	const valid = runValidationFixture( 'valid' );
	const aoComposite = validateAoCompositeContract();
	const invalidFixtures = [
		'duplicate-scene-render',
		'duplicate-scene-pass-graph',
		'missing-final-ao-graph',
		'duplicate-output-owner',
		'double-output-transform',
		'missing-velocity-convention',
		'undeclared-mrt-consumer'
	];

	for ( const fixture of invalidFixtures ) {

		try {

			runValidationFixture( fixture );
			fail( `Fixture "${ fixture }" unexpectedly passed.` );

		} catch ( error ) {

			if ( error.message.includes( 'unexpectedly passed' ) ) throw error;

		}

	}

	const fakeRenderer = {
		initialized: true,
		backend: { isWebGPUBackend: true },
		hasFeature: ( name ) => name === 'timestamp-query',
		getOutputBufferType: () => 'HalfFloatType',
		computeAsync: async () => {}
	};

	const tier = createCapabilityTier( fakeRenderer, { requiredMRT: 3, requiredStorage: true } );

	if ( tier.tier !== 'full' || tier.timestampQuery !== true || tier.budgetReason.length !== 0 ) {

		fail( 'Capability tier validation failed for full fake renderer.' );

	}

	return { valid, invalidFixtures, tier, aoComposite };

}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) {

	const fixtureIndex = process.argv.indexOf( '--fixture' );
	const expectInvalidIndex = process.argv.indexOf( '--expect-invalid' );
	const realGraph = process.argv.includes( '--real-graph' );

	try {

		const result = expectInvalidIndex !== -1
			? process.argv.slice( expectInvalidIndex + 1 ).map( ( fixture ) => {

				try {

					runValidationFixture( fixture );
					fail( `Fixture "${ fixture }" unexpectedly passed.` );

				} catch ( error ) {

					if ( error.message.includes( 'unexpectedly passed' ) ) throw error;
					return { fixture, rejected: true, message: error.message };

				}

			} )
			: realGraph === true
				? runRealGraphValidation()
				: fixtureIndex === -1
				? runSelfTest()
				: runValidationFixture( process.argv[ fixtureIndex + 1 ] );

		console.log( JSON.stringify( result, null, 2 ) );

	} catch ( error ) {

		console.error( error.message );
		process.exitCode = 1;

	}

}
