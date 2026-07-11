import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateArtifactBundle } from '../../../threejs-visual-validation/examples/webgpu-validation-harness/src/schema/artifact-schemas.js';
import { decodeGeneratedRgbaPng } from '../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js';
import {
	ARTIFACT_CONTRACT_VERSION,
	ARTIFACT_NUMERIC_PROVENANCE,
	ARTIFACT_RELATIVE_DIR,
	DIAGNOSTIC_IMAGES,
	REQUIRED_IMAGES,
	SCENE_ID
} from './artifact-config.js';
import { IMAGE_PIPELINE_EXAMPLE_CONTRACT } from './pipelineConfig.js';
import { runSelfTest } from './validateImagePipelineConfig.js';

const here = dirname( fileURLToPath( import.meta.url ) );
const repoRoot = resolve( here, '../../..' );
const defaultArtifactDir = resolve( repoRoot, ARTIFACT_RELATIVE_DIR );

function parseArgs( argv ) {

	const options = { artifactDir: defaultArtifactDir, requireArtifacts: false };

	for ( let i = 0; i < argv.length; i ++ ) {

		const arg = argv[ i ];
		if ( arg === '--artifact-dir' ) options.artifactDir = resolve( argv[ ++ i ] );
		else if ( arg === '--require-artifacts' ) options.requireArtifacts = true;
		else throw new Error( `Unknown argument: ${ arg }` );

	}

	return options;

}

function assert( condition, message ) {

	if ( ! condition ) throw new Error( message );

}

async function readJson( path ) {

	return JSON.parse( await readFile( path, 'utf8' ) );

}

function imagePixel( image, x, y ) {

	const scanlineLength = 1 + image.width * 4;
	const offset = y * scanlineLength + 1 + x * 4;
	return [ image.raw[ offset ], image.raw[ offset + 1 ], image.raw[ offset + 2 ] ];

}

function luminance( pixel ) {

	return pixel[ 0 ] * 0.2126 + pixel[ 1 ] * 0.7152 + pixel[ 2 ] * 0.0722;

}

function imageStatistics( image ) {

	let min = Infinity;
	let max = - Infinity;
	let sum = 0;
	let sumSquared = 0;
	let count = 0;
	const quantizedColors = new Set();
	const quantizedLuminance = new Set();

	for ( let y = 0; y < image.height; y ++ ) {

		for ( let x = 0; x < image.width; x ++ ) {

			const pixel = imagePixel( image, x, y );
			const value = luminance( pixel );
			min = Math.min( min, value );
			max = Math.max( max, value );
			sum += value;
			sumSquared += value * value;
			count ++;
			quantizedColors.add( `${ pixel[ 0 ] >> 4 },${ pixel[ 1 ] >> 4 },${ pixel[ 2 ] >> 4 }` );
			quantizedLuminance.add( Math.round( value / 4 ) );

		}

	}

	const mean = sum / count;
	return {
		range: max - min,
		mean,
		variance: sumSquared / count - mean * mean,
		quantizedColorCount: quantizedColors.size,
		quantizedLuminanceCount: quantizedLuminance.size
	};

}

async function meanRgbDifference( pathA, pathB ) {

	const imageA = decodeGeneratedRgbaPng( await readFile( pathA ) );
	const imageB = decodeGeneratedRgbaPng( await readFile( pathB ) );
	assert( imageA.width === imageB.width && imageA.height === imageB.height, 'Compared PNGs must have matching dimensions.' );

	const scanlineLength = 1 + imageA.width * 4;
	let sum = 0;
	let count = 0;

	for ( let y = 0; y < imageA.height; y ++ ) {

		const rowOffset = y * scanlineLength;
		for ( let x = 0; x < imageA.width; x ++ ) {

			const pixelOffset = rowOffset + 1 + x * 4;
			for ( let channel = 0; channel < 3; channel ++ ) {

				sum += Math.abs( imageA.raw[ pixelOffset + channel ] - imageB.raw[ pixelOffset + channel ] );
				count ++;

			}

		}

	}

	return sum / count;

}

async function validateSourceContracts() {

	const mainSource = await readFile( resolve( here, 'main.js' ), 'utf8' );
	const composeSource = await readFile( resolve( here, 'composeFinalGraph.js' ), 'utf8' );
	const browserSource = await readFile( resolve( here, 'browser-app.js' ), 'utf8' );
	const captureSource = await readFile( resolve( here, 'capture.mjs' ), 'utf8' );
	const artifactConfigSource = await readFile( resolve( here, 'artifact-config.js' ), 'utf8' );
	const skillSource = await readFile( resolve( here, '../../SKILL.md' ), 'utf8' );
	const readmeSource = await readFile( resolve( here, 'README.md' ), 'utf8' );

	assert( mainSource.includes( 'trackTimestamp: true' ), 'Browser fixture must request timestamps before classifying GPU timing.' );
	assert( mainSource.includes( 'fixtureMeshes' ), 'Browser fixture must expose its actual mesh lifecycle set.' );
	assert( mainSource.includes( "config.requiredMRT.includes( 'normal' )" ), 'main.js must construct optional MRT outputs conditionally.' );
	assert( ! mainSource.includes( "getTextureNode( 'albedo' )" ), 'main.js must not fabricate an albedo diagnostic.' );
	assert( composeSource.includes( "scenePass.getLinearDepthNode( 'depth' )" ), 'Linear-depth diagnostic must use the r185 PassNode helper.' );
	assert( composeSource.indexOf( 'const temporal =' ) < composeSource.indexOf( 'const hdrComposite =' ), 'Temporal scaffold must precede bloom composition.' );
	assert( composeSource.includes( 'stableSceneHdr.rgb.add( bloomTextureNode.rgb )' ), 'Bloom graph must add RGB without changing alpha.' );
	assert( composeSource.includes( 'stableSceneHdr.a' ), 'Bloom graph must preserve stable scene alpha.' );
	assert( mainSource.includes( 'graph.normalTex.xyz.mul( 0.5 ).add( 0.5 )' ), 'Normal diagnostics must remap signed components into display range.' );
	assert( mainSource.includes( 'graph.linearDepth.oneMinus()' ), 'Linear-depth diagnostics must use an explicit visualization transfer.' );
	assert( mainSource.includes( 'compressHdrForInspection' ), 'HDR/emissive/bloom diagnostics must use an explicit inspection transform.' );
	assert( mainSource.includes( 'diagnostics.mode === mode' ), 'Repeated timing samples must not rebuild an unchanged output graph.' );
	assert( browserSource.includes( 'claimBoundary: app.diagnostics.claimBoundary' ), 'Browser evidence must carry the executable claim boundary.' );
	assert( browserSource.includes( "temporal: 'unsupported; no executable reset/reseed owner'" ), 'Browser evidence must reject temporal reconstruction proof.' );
	assert( browserSource.includes( "exposure: 'not implemented'" ), 'Browser evidence must reject exposure proof.' );
	assert( browserSource.includes( 'resolveTimestampsAsync' ), 'GPU timing must use the r185 timestamp resolver when available.' );
	assert( browserSource.includes( 'captureTarget.texture.colorSpace = NoColorSpace' ), 'Explicitly encoded output/data diagnostics must use a no-color RGBA8 readback target.' );
	assert( ! captureSource.includes( 'velocity.static.png' ), 'Capture harness still requests an unimplemented velocity artifact.' );
	assert( ! captureSource.includes( 'albedo.static.png' ), 'Capture harness still requests an unimplemented albedo artifact.' );
	assert( ! captureSource.includes( 'temporal.t000.png' ), 'Capture harness still labels authored motion as temporal evidence.' );
	assert( ! artifactConfigSource.includes( 'images/temporal.t000.png' ), 'Artifact contract still requires unimplemented temporal evidence.' );
	assert( ! skillSource.includes( 'maximum-performance' ), 'SKILL frontmatter still makes an unprovable maximum-performance claim.' );
	assert( readmeSource.includes( 'Browser artifacts from older' ), 'README must quarantine stale browser claims.' );
	assert( Object.keys( ARTIFACT_NUMERIC_PROVENANCE ).length > 0, 'Artifact numeric provenance is missing.' );

	return {
		pass: true,
		claimBoundary: IMAGE_PIPELINE_EXAMPLE_CONTRACT,
		artifactContractVersion: ARTIFACT_CONTRACT_VERSION,
		numericProvenance: ARTIFACT_NUMERIC_PROVENANCE
	};

}

async function validateDiagnosticArtifacts( artifactDir, manifest ) {

	const statistics = {};
	for ( const imagePath of DIAGNOSTIC_IMAGES ) {

		const path = resolve( artifactDir, imagePath );
		assert( existsSync( path ), `Artifact bundle is missing ${ imagePath }.` );
		statistics[ imagePath ] = imageStatistics( decodeGeneratedRgbaPng( await readFile( path ) ) );

	}

	const gates = manifest.thresholds.falsifiability;
	for ( const imagePath of DIAGNOSTIC_IMAGES ) {

		assert(
			statistics[ imagePath ].range >= gates.minimumDiagnosticRange,
			`${ imagePath } lacks signal range (${ statistics[ imagePath ].range.toFixed( 3 ) }).`
		);

	}

	assert(
		statistics[ 'images/normal.static.png' ].quantizedColorCount >= gates.minimumNormalUniqueColors,
		`Normal diagnostic has too few quantized colors (${ statistics[ 'images/normal.static.png' ].quantizedColorCount }).`
	);
	assert(
		statistics[ 'images/linear-depth.static.png' ].quantizedLuminanceCount >= gates.minimumDepthUniqueValues,
		`Linear-depth diagnostic has too few quantized values (${ statistics[ 'images/linear-depth.static.png' ].quantizedLuminanceCount }).`
	);

	const diagnosticFinalDifference = await meanRgbDifference(
		resolve( artifactDir, 'images/final.design.png' ),
		resolve( artifactDir, 'images/diagnostics.mosaic.png' )
	);
	const postFinalDifference = await meanRgbDifference(
		resolve( artifactDir, 'images/final.design.png' ),
		resolve( artifactDir, 'images/no-post.design.png' )
	);
	const crossSignalPairs = [
		[ 'images/normal.static.png', 'images/linear-depth.static.png' ],
		[ 'images/emissive.static.png', 'images/bloom.static.png' ],
		[ 'images/AO.static.png', 'images/linear-depth.static.png' ],
		[ 'images/pre-tone-map.static.png', 'images/emissive.static.png' ]
	];
	const crossSignalDifferences = {};
	for ( const [ left, right ] of crossSignalPairs ) {

		const difference = await meanRgbDifference( resolve( artifactDir, left ), resolve( artifactDir, right ) );
		crossSignalDifferences[ `${ left } != ${ right }` ] = difference;
		assert( difference >= gates.minimumCrossSignalDifference, `${ left} and ${ right } are semantically indistinguishable (${ difference.toFixed( 3 ) }).` );

	}

	assert(
		diagnosticFinalDifference >= gates.diagnosticFinalMeanDifference,
		`Diagnostic mosaic is too similar to final (${ diagnosticFinalDifference.toFixed( 3 ) }).`
	);
	assert(
		postFinalDifference >= gates.postFinalMeanDifference,
		`Final and no-post captures do not falsify active post composition (${ postFinalDifference.toFixed( 3 ) }).`
	);

	return { statistics, diagnosticFinalDifference, postFinalDifference, crossSignalDifferences };

}

async function validateImagePipelineArtifacts( artifactDir ) {

	if ( ! existsSync( resolve( artifactDir, 'visual-contract.json' ) ) ) return null;

	const bundle = await validateArtifactBundle( artifactDir );
	const manifest = await readJson( resolve( artifactDir, 'evidence-manifest.json' ) );
	const contract = await readJson( resolve( artifactDir, 'visual-contract.json' ) );
	const targets = await readJson( resolve( artifactDir, 'render-targets.json' ) );
	const timings = await readJson( resolve( artifactDir, 'timings.json' ) );

	assert( manifest.sceneId === SCENE_ID, `Unexpected sceneId ${ manifest.sceneId }.` );
	assert( manifest.contractVersion === ARTIFACT_CONTRACT_VERSION, 'Artifact manifest is stale.' );
	assert( contract.contractVersion === ARTIFACT_CONTRACT_VERSION, 'Visual contract is stale.' );
	assert( contract.claimBoundary.profile === IMAGE_PIPELINE_EXAMPLE_CONTRACT.profile, 'Artifact claim boundary does not match the executable example.' );
	assert( manifest.backend.isPrimaryBackend === true, 'Artifact bundle did not record native WebGPU.' );
	assert( manifest.postStack.scenePasses === 1, 'Image-pipeline evidence must record one primary scene render.' );
	assert(
		JSON.stringify( manifest.postStack.mrtOutputs ) === JSON.stringify( [ 'output', 'normal', 'emissive' ] ),
		`Unexpected authored MRT selection: ${ JSON.stringify( manifest.postStack.mrtOutputs ) }.`
	);
	assert( manifest.postStack.mrtOutputs.includes( 'depth' ) === false, 'Depth must not be an MRT color output.' );
	assert( manifest.postStack.mrtOutputs.includes( 'velocity' ) === false, 'Default artifact graph must not claim velocity.' );
	assert( manifest.postStack.mrtOutputs.includes( 'albedo' ) === false, 'Default artifact graph must not claim albedo.' );
	assert( manifest.postStack.temporal.startsWith( 'unsupported' ), 'Artifact must not claim temporal reconstruction.' );
	assert( manifest.postStack.exposure === 'not implemented', 'Artifact must not claim exposure.' );
	assert( manifest.colorPipeline.lutDomain === null, 'Artifact must not claim LUT grading.' );
	assert( manifest.colorPipeline.outputColorTransform === false, 'renderOutput ownership requires RenderPipeline.outputColorTransform=false.' );
	assert( targets.accountingStatus.includes( 'lower bound' ) || targets.accountingStatus.includes( 'lower-bound' ), 'Target accounting must be labelled as a lower bound.' );
	assert( targets.performanceGate?.state === 'INSUFFICIENT_EVIDENCE', 'Incomplete physical memory evidence must block performance promotion.' );
	assert( timings.performanceGate?.state === 'INSUFFICIENT_EVIDENCE', 'Unnamed/incomplete GPU timing must block performance promotion.' );
	assert( timings.measurementContract !== undefined, 'Timing evidence lacks its measurement boundary.' );
	assert( contract.performancePromotion?.state === 'INSUFFICIENT_EVIDENCE', 'Feature artifact must not promote itself to a measured performance tier.' );
	assert(
		artifactBudgetResult( bundle, 'gpuFrameMs.median' )?.state === 'SKIP',
		'Shared optional GPU budget evaluation must remain SKIP under insufficient evidence.'
	);
	assert( artifactBudgetResult( bundle, 'totalGpuMemoryBytes' ) === null, 'Incomplete memory lower bounds must not produce an automated PASS.' );

	for ( const imagePath of [ ...REQUIRED_IMAGES, ...DIAGNOSTIC_IMAGES ] ) {

		assert( contract.requiredImages.includes( imagePath ), `visual-contract.json is missing ${ imagePath }.` );

	}
	for ( const staleImage of [ 'images/velocity.static.png', 'images/albedo.static.png', 'images/temporal.t000.png' ] ) {

		assert( contract.requiredImages.includes( staleImage ) === false, `visual-contract.json still requires stale ${ staleImage }.` );

	}

	const diagnostics = await validateDiagnosticArtifacts( artifactDir, manifest );
	return { bundle, diagnostics };

}

function artifactBudgetResult( bundle, name ) {

	return bundle.summary.budgets.results.find( ( result ) => result.name === name ) ?? null;

}

async function main() {

	const options = parseArgs( process.argv.slice( 2 ) );
	const graph = runSelfTest();
	const sourceContracts = await validateSourceContracts();
	const artifactPresent = existsSync( resolve( options.artifactDir, 'visual-contract.json' ) );
	const artifact = options.requireArtifacts
		? await validateImagePipelineArtifacts( options.artifactDir )
		: null;

	if ( options.requireArtifacts && artifact === null ) {

		throw new Error( `Artifact directory not found: ${ options.artifactDir }` );

	}

	console.log( JSON.stringify( {
		pass: true,
		validationScope: 'static graph/source contracts',
		graph: {
			requiredMRT: graph.valid.requiredMRT,
			diagnosticModes: graph.valid.diagnosticModes,
			estimatedBytes: graph.valid.estimatedBytes,
			invalidFixtures: graph.invalidFixtures
		},
		sourceContracts,
		artifactDir: options.artifactDir,
		artifactGate: artifact !== null
			? { state: 'PASS', required: true }
			: { state: artifactPresent ? 'NOT_RUN' : 'ABSENT', required: false, promotion: 'INSUFFICIENT_EVIDENCE' },
		artifactValidated: artifact !== null,
		artifacts: artifact
	}, null, 2 ) );

}

main().catch( ( error ) => {

	console.error( error.message );
	process.exitCode = 1;

} );
