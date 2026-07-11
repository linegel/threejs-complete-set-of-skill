import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Scene } from 'three/webgpu';
import { emissive, mrt, normalView, output, pass } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import { composeFinalGraph } from './composeFinalGraph.js';
import {
	IMAGE_PIPELINE_EXAMPLE_CONTRACT,
	IMAGE_PIPELINE_NUMERIC_PROVENANCE,
	createCapabilityTier,
	createDefaultImagePipelineConfig,
	createFeatureDemoImagePipelineConfig,
	estimateMrtLogicalBytes,
	evaluateSeparatedLightingAoComposite
} from './pipelineConfig.js';

const EXAMPLE_ROOT = new URL( './', import.meta.url );

function fail( message ) {

	throw new Error( message );

}

function collectReachableNodes( rootNode ) {

	if ( ! rootNode || typeof rootNode.traverse !== 'function' ) {

		fail( 'Live graph validation requires a node output with traverse().' );

	}

	const reachable = new Set();
	rootNode.traverse( ( node ) => reachable.add( node ) );
	return reachable;

}

function diagnosticModesForConfig( config ) {

	const modes = [
		'final',
		'no-post baseline',
		'scene HDR',
		'depth raw',
		'linear depth',
		'pre-tone-map HDR',
		'post-tone-map output',
		'authored AO split scaffold',
		'debug baseline AO final-color multiply'
	];

	if ( config.requiredMRT.includes( 'normal' ) ) modes.push( 'normal' );
	if ( config.requiredMRT.includes( 'emissive' ) ) modes.push( 'emissive' );
	if ( config.requiredMRT.includes( 'velocity' ) ) modes.push( 'velocity' );
	if ( config.features.gtao ) modes.push( 'AO.r' );
	if ( config.features.selectiveBloom ) modes.push( 'bloom contribution' );
	return modes;

}

export function validateImagePipelineGraph( config, graph ) {

	const outputNode = graph?.renderPipeline?.outputNode ?? graph?.outputNode;
	const finalOutputNode = graph?.finalOutputNode ?? outputNode;
	const reachable = collectReachableNodes( outputNode );
	const finalReachable = finalOutputNode === outputNode
		? reachable
		: collectReachableNodes( finalOutputNode );
	const passNodes = [ ...reachable ].filter( ( node ) => node?.isPassNode === true );

	if ( passNodes.length !== config.sceneRenderCount ) {

		fail( `Live graph reaches ${ passNodes.length } scene passes; config declares ${ config.sceneRenderCount }.` );

	}

	if ( config.features.gtao ) {

		if ( ! graph?.aoTextureNode || ! finalReachable.has( graph.aoTextureNode ) ) {

			fail( 'GTAO-enabled final graph must consume the actual GTAO texture node.' );

		}

	}
	if ( config.features.selectiveBloom ) {

		if ( ! graph?.bloomTextureNode || ! finalReachable.has( graph.bloomTextureNode ) ) {

			fail( 'Selective-bloom final graph must consume the actual BloomNode texture.' );

		}

	}

	return {
		pass: true,
		scenePassCount: passNodes.length,
		aoTextureReachableFromFinal: config.features.gtao,
		bloomTextureReachableFromFinal: config.features.selectiveBloom
	};

}

function validateClaimBoundary( config ) {

	if ( config.contract.profile !== 'minimal-public-api-baseline' ) fail( 'Example profile claim boundary is missing.' );
	if ( ! /not[- ]measured/.test( config.contract.mrtDecisionEvidence ) ) fail( 'MRT demo must not claim measured selection.' );
	if ( ! config.contract.directIndirectSeparation.includes( 'not-implemented' ) ) fail( 'AO split scaffold boundary is missing.' );

	for ( const unsupported of [ 'temporal', 'exposure', 'gradingLut', 'adaptiveDpr', 'transientAliasing' ] ) {

		if ( config.features[ unsupported ] === true ) {

			fail( `This example cannot enable ${ unsupported }; its claim boundary marks that feature unimplemented.` );

		}

	}
	if ( config.temporal.enabled === true ) fail( 'Temporal output is unsupported until an executable reset/reseed owner exists.' );

	if ( config.lutDomain !== null ) fail( 'No LUT exists in this example; lutDomain must remain null.' );
	return config.contract;

}

function validateNumericProvenance( config ) {

	for ( const [ name, classification ] of Object.entries( IMAGE_PIPELINE_NUMERIC_PROVENANCE ) ) {

		if ( ! /^(Authored|Derived|Gated|Measured)/.test( classification ) ) {

			fail( `Numeric provenance ${ name } lacks an allowed classification.` );

		}

	}

	if ( config.numericProvenance !== IMAGE_PIPELINE_NUMERIC_PROVENANCE ) {

		fail( 'Config must expose the canonical numeric-provenance registry.' );

	}

	return IMAGE_PIPELINE_NUMERIC_PROVENANCE;

}

export function validateImagePipelineConfig( config = createDefaultImagePipelineConfig(), graph = null ) {

	validateClaimBoundary( config );
	validateNumericProvenance( config );

	if ( config.sceneRenderCount !== 1 ) fail( 'Example baseline requires one primary scene pass.' );
	if ( config.toneMapOwner !== 'renderOutput' || config.outputTransformOwner !== 'renderOutput' ) fail( 'Tone map and output conversion must share renderOutput ownership.' );
	if ( config.toneMappingMode !== 'NeutralToneMapping' ) fail( 'Executable example must exercise NeutralToneMapping.' );
	if ( config.outputColorTransform !== false ) fail( 'Explicit renderOutput ownership requires outputColorTransform false.' );
	if ( config.requiredMRT[ 0 ] !== 'output' ) fail( 'First selected MRT output must be scene HDR output.' );
	if ( config.requiredMRT.includes( 'depth' ) ) fail( 'Depth is the PassNode depth texture, not an MRT color output.' );
	if ( config.requiredMRT.includes( 'velocity' ) ) fail( 'Velocity is unsupported while the temporal path is quarantined.' );
	if ( new Set( config.requiredMRT ).size !== config.requiredMRT.length ) fail( 'Selected MRT outputs must be unique.' );
	if ( ! Number.isFinite( config.resolutionScales.scene ) || config.resolutionScales.scene <= 0 ) fail( 'Scene resolution scale must be finite and positive.' );

	for ( const mrtName of config.requiredMRT ) {

		if ( ! config.producers[ mrtName ] ) fail( `Selected MRT "${ mrtName }" has no producer.` );
		if ( ! config.consumers[ mrtName ]?.length ) fail( `Selected MRT "${ mrtName }" has no consumer.` );
		if ( ! config.colorDomains[ mrtName ] ) fail( `Selected MRT "${ mrtName }" has no domain.` );
		if ( ! Number.isFinite( config.memory.bytesPerPixelBySignal[ mrtName ] ) ) fail( `Selected MRT "${ mrtName }" has no physical byte classification.` );

	}

	if ( config.features.selectiveBloom && config.requiredMRT.includes( 'emissive' ) === false ) {

		fail( 'Selective bloom requires a selected emissive MRT.' );

	}

	const estimatedBytes = estimateMrtLogicalBytes( config );
	if ( estimatedBytes > config.memory.memoryBudget ) fail( 'Authored logical MRT budget gate exceeded.' );
	if ( ! config.memory.accountingStatus.includes( 'lower bound' ) ) fail( 'Memory estimate must identify its logical lower-bound status.' );

	if ( ! config.resize.updatesRendererPixelRatio || ! config.resize.updatesRendererSize ) {

		fail( 'Resize path must update renderer pixel ratio and size.' );

	}

	if ( ! config.disposal.disposesRenderPipeline || ! config.disposal.disposesTargets ) {

		fail( 'Disposal path must own graph and target teardown.' );

	}

	const liveGraph = graph ? validateImagePipelineGraph( config, graph ) : null;

	return {
		pass: true,
		claimBoundary: config.contract,
		sceneRenderCount: config.sceneRenderCount,
		toneMapOwner: config.toneMapOwner,
		outputTransformOwner: config.outputTransformOwner,
		requiredMRT: config.requiredMRT,
		estimatedBytes,
		estimatedBytesStatus: config.memory.accountingStatus,
		diagnosticModes: diagnosticModesForConfig( config ),
		liveGraph
	};

}

function assertRgbEqual( actual, expected, label ) {

	for ( let index = 0; index < expected.length; index += 1 ) {

		if ( Math.abs( actual[ index ] - expected[ index ] ) > Number.EPSILON * 16 ) {

			fail( `${ label } changed at channel ${ index }.` );

		}

	}

}

export function validateSeparatedLightingEquationOnly() {

	// [Authored numeric fixture] This validates the equation, not scene signals.
	const pixelTerms = {
		direct: [ 1.2, 0.7, 0.35 ],
		indirect: [ 0.4, 0.25, 0.12 ],
		emissive: [ 3.5, 2.1, 0.8 ],
		atmosphere: [ 0.18, 0.22, 0.31 ],
		ui: [ 0.9, 0.9, 0.9 ]
	};
	const aoForcedZero = evaluateSeparatedLightingAoComposite( pixelTerms, 0 );
	const aoForcedOne = evaluateSeparatedLightingAoComposite( pixelTerms, 1 );

	assertRgbEqual( aoForcedZero.direct, pixelTerms.direct, 'Direct light' );
	assertRgbEqual( aoForcedZero.emissive, pixelTerms.emissive, 'Emissive light' );
	assertRgbEqual( aoForcedZero.atmosphere, pixelTerms.atmosphere, 'Atmosphere' );
	assertRgbEqual( aoForcedZero.ui, pixelTerms.ui, 'UI overlay' );
	assertRgbEqual( aoForcedZero.indirect, [ 0, 0, 0 ], 'Indirect light under zero visibility' );

	const delta = aoForcedOne.color.map( ( value, index ) => value - aoForcedZero.color[ index ] );
	assertRgbEqual( delta, pixelTerms.indirect, 'Visibility equation' );

	return {
		pass: true,
		proofBoundary: 'numeric separated-lighting equation only; browser scene uses authored split scaffold'
	};

}

function createLiveGraphFixture( { duplicateScenePass = false, omitAo = true } = {} ) {

	const scene = new Scene();
	const camera = new PerspectiveCamera();
	const scenePass = pass( scene, camera );
	const hdrColor = scenePass.getTextureNode( 'output' );
	const aoTextureNode = scenePass.getTextureNode( 'depth' );
	let composite = omitAo ? hdrColor : hdrColor.mul( aoTextureNode.r );

	if ( duplicateScenePass ) {

		const duplicate = pass( new Scene(), new PerspectiveCamera() );
		composite = composite.add( duplicate.getTextureNode( 'output' ) );

	}

	return {
		renderPipeline: { outputNode: composite },
		finalOutputNode: composite,
		aoTextureNode
	};

}

const fixtureFactories = {
	valid: () => ( { config: createDefaultImagePipelineConfig(), graph: createLiveGraphFixture() } ),
	'duplicate-scene-render': () => ( {
		config: createDefaultImagePipelineConfig( { sceneRenderCount: 2 } ),
		graph: createLiveGraphFixture( { duplicateScenePass: true } )
	} ),
	'duplicate-scene-pass-graph': () => ( {
		config: createDefaultImagePipelineConfig(),
		graph: createLiveGraphFixture( { duplicateScenePass: true } )
	} ),
	'missing-final-ao-graph': () => ( {
		config: createFeatureDemoImagePipelineConfig(),
		graph: createLiveGraphFixture( { omitAo: true } )
	} ),
	'duplicate-output-owner': () => ( {
		config: createDefaultImagePipelineConfig( { outputTransformOwner: 'second-output-owner' } )
	} ),
	'double-output-transform': () => ( {
		config: createDefaultImagePipelineConfig( { outputColorTransform: true } )
	} ),
	'missing-velocity-convention': () => ( {
		config: createDefaultImagePipelineConfig( {
			requiredMRT: [ 'output', 'normal', 'emissive', 'velocity' ],
			features: { temporal: true },
			producers: { velocity: 'scene-pass' },
			consumers: { velocity: [ 'TRAANode' ] },
			colorDomains: { velocity: 'data/no-color' },
			temporal: { enabled: true }
		} )
	} ),
	'undeclared-mrt-consumer': () => ( {
		config: createFeatureDemoImagePipelineConfig( { consumers: { normal: [] } } )
	} ),
	'depth-in-mrt': () => ( {
		config: createDefaultImagePipelineConfig( {
			requiredMRT: [ 'output', 'normal', 'emissive', 'depth' ],
			memory: { bytesPerPixelBySignal: { depth: 4 } }
		} )
	} ),
	'false-exposure-claim': () => ( {
		config: createDefaultImagePipelineConfig( { features: { exposure: true } } )
	} )
};

export function createRealImagePipelineGraph( config = createDefaultImagePipelineConfig() ) {

	const scene = new Scene();
	const camera = new PerspectiveCamera();
	const scenePass = pass( scene, camera );
	const outputs = { output };
	if ( config.requiredMRT.includes( 'normal' ) ) outputs.normal = normalView;
	if ( config.requiredMRT.includes( 'emissive' ) ) outputs.emissive = emissive;
	scenePass.setMRT( mrt( outputs ) );

	const depthTex = scenePass.getTextureNode( 'depth' );
	const normalTex = config.requiredMRT.includes( 'normal' ) ? scenePass.getTextureNode( 'normal' ) : null;
	const emissiveTex = config.requiredMRT.includes( 'emissive' ) ? scenePass.getTextureNode( 'emissive' ) : null;
	const gtao = config.features.gtao ? ao( depthTex, normalTex, camera ) : null;
	const bloomPass = config.features.selectiveBloom ? bloom( emissiveTex ) : null;
	const graph = composeFinalGraph( { config, scenePass, gtao, bloomPass, camera } );

	return {
		renderPipeline: { outputNode: graph.finalOutputNode },
		finalOutputNode: graph.finalOutputNode,
		aoTextureNode: graph.aoTextureNode,
		bloomTextureNode: graph.bloomTextureNode,
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
	return validateImagePipelineConfig( config, realGraph );

}

export function runValidationFixture( fixtureName ) {

	const factory = fixtureFactories[ fixtureName ];
	if ( ! factory ) fail( `Unknown fixture "${ fixtureName }".` );
	const fixture = factory();
	return validateImagePipelineConfig( fixture.config, fixture.graph ?? null );

}

function validateSourceContracts() {

	const mainSource = readFileSync( new URL( 'main.js', EXAMPLE_ROOT ), 'utf8' );
	const composeSource = readFileSync( new URL( 'composeFinalGraph.js', EXAMPLE_ROOT ), 'utf8' );
	const readmeSource = readFileSync( new URL( 'README.md', EXAMPLE_ROOT ), 'utf8' );

	if ( ! mainSource.includes( 'renderer.toneMapping = NeutralToneMapping' ) ) fail( 'main.js must exercise a nontrivial tone mapper.' );
	if ( ! mainSource.includes( "config.requiredMRT.includes( 'normal' )" ) ) fail( 'main.js must build MRT conditionally.' );
	if ( ! mainSource.includes( "scenePass.getLinearDepthNode( 'depth' )" ) && ! composeSource.includes( "scenePass.getLinearDepthNode( 'depth' )" ) ) fail( 'Linear-depth diagnostic must use the r185 helper.' );
	if ( ! mainSource.includes( 'renderer.setPixelRatio( safeDpr )' ) ) fail( 'Resize must apply DPR to renderer.' );
	if ( composeSource.indexOf( 'const temporal =' ) > composeSource.indexOf( 'const hdrComposite =' ) ) fail( 'Temporal resolve must precede bloom composite.' );
	if ( ! composeSource.includes( 'authoredAoSplitComposite' ) ) fail( 'AO split scaffold must be named honestly.' );
	if ( ! composeSource.includes( 'stableSceneHdr.rgb.add( bloomTextureNode.rgb )' ) || ! composeSource.includes( 'stableSceneHdr.a' ) ) fail( 'Bloom composition must preserve stable scene alpha.' );
	if ( ! composeSource.includes( 'hdrColor.a' ) ) fail( 'AO diagnostics/composition must preserve source alpha.' );
	if ( readmeSource.includes( 'previousUV = currentUV - velocity.xy * 0.5' ) ) fail( 'README still omits the r185 velocity Y flip.' );
	if ( ! readmeSource.includes( 'Claim boundary' ) ) fail( 'README must state its executable claim boundary.' );

	return { pass: true };

}

export function runSelfTest() {

	const valid = runValidationFixture( 'valid' );
	const featureDemo = validateImagePipelineConfig( createFeatureDemoImagePipelineConfig() );
	const fullScaleBytes = estimateMrtLogicalBytes( createDefaultImagePipelineConfig() );
	const halfScaleBytes = estimateMrtLogicalBytes( createDefaultImagePipelineConfig( { resolutionScales: { scene: 0.5 } } ) );
	if ( halfScaleBytes * 4 !== fullScaleBytes ) fail( 'Logical MRT accounting must follow pixel area under exact half scale.' );
	const equationOnly = validateSeparatedLightingEquationOnly();
	const invalidFixtures = Object.keys( fixtureFactories ).filter( ( name ) => name !== 'valid' );

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
		backend: {
			isWebGPUBackend: true,
			device: { limits: { maxColorAttachments: 8, maxColorAttachmentBytesPerSample: 32 } }
		},
		hasFeature: ( name ) => name === 'timestamp-query',
		getOutputBufferType: () => 'HalfFloatType'
	};
	const capability = createCapabilityTier( fakeRenderer, {
		selectedMrt: valid.requiredMRT,
		bytesPerPixelBySignal: createDefaultImagePipelineConfig().memory.bytesPerPixelBySignal
	} );
	if ( capability.status !== 'capability-gated-not-performance-proven' ) fail( 'Capability boundary is incorrect.' );

	return {
		valid,
		featureDemoOptIn: featureDemo,
		invalidFixtures,
		capability,
		equationOnly,
		claimBoundary: IMAGE_PIPELINE_EXAMPLE_CONTRACT,
		sourceContracts: validateSourceContracts()
	};

}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) {

	const fixtureIndex = process.argv.indexOf( '--fixture' );
	const expectInvalidIndex = process.argv.indexOf( '--expect-invalid' );
	const realGraph = process.argv.includes( '--real-graph' );

	try {

		const result = expectInvalidIndex !== - 1
			? process.argv.slice( expectInvalidIndex + 1 ).map( ( fixture ) => {

				try {

					runValidationFixture( fixture );
					fail( `Fixture "${ fixture }" unexpectedly passed.` );

				} catch ( error ) {

					if ( error.message.includes( 'unexpectedly passed' ) ) throw error;
					return { fixture, rejected: true, message: error.message };

				}

			} )
			: realGraph
				? runRealGraphValidation()
				: fixtureIndex === - 1
					? runSelfTest()
					: runValidationFixture( process.argv[ fixtureIndex + 1 ] );

		console.log( JSON.stringify( result, null, 2 ) );

	} catch ( error ) {

		console.error( error.message );
		process.exitCode = 1;

	}

}
