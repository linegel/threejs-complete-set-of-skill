import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateArtifactBundle } from '../../../threejs-visual-validation/examples/webgpu-validation-harness/src/schema/artifact-schemas.js';
import { decodeGeneratedRgbaPng } from '../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js';
import { ARTIFACT_RELATIVE_DIR, REQUIRED_IMAGES, SCENE_ID } from './artifact-config.js';
import { runSelfTest } from './validateImagePipelineConfig.js';

const here = dirname( fileURLToPath( import.meta.url ) );
const repoRoot = resolve( here, '../../..' );
const defaultArtifactDir = resolve( repoRoot, ARTIFACT_RELATIVE_DIR );
const supplementalFalsifiabilityImages = [
	'images/velocity.static.png',
	'images/velocity.motion.png',
	'images/AO.static.png',
	'images/bloom.static.png',
	'images/normal.static.png',
	'images/albedo.static.png'
];

function parseArgs( argv ) {

	const options = {
		artifactDir: defaultArtifactDir,
		requireArtifacts: false
	};

	for ( let i = 0; i < argv.length; i ++ ) {

		const arg = argv[ i ];

		if ( arg === '--artifact-dir' ) {

			options.artifactDir = resolve( argv[ ++ i ] );

		} else if ( arg === '--require-artifacts' ) {

			options.requireArtifacts = true;

		} else {

			throw new Error( `Unknown argument: ${ arg }` );

		}

	}

	return options;

}

async function readJson( path ) {

	return JSON.parse( await readFile( path, 'utf8' ) );

}

function assert( condition, message ) {

	if ( ! condition ) throw new Error( message );

}

function imagePixel( image, x, y ) {

	const scanlineLength = 1 + image.width * 4;
	const offset = y * scanlineLength + 1 + x * 4;
	return [
		image.raw[ offset ],
		image.raw[ offset + 1 ],
		image.raw[ offset + 2 ],
		image.raw[ offset + 3 ]
	];

}

function luminance( pixel ) {

	return pixel[ 0 ] * 0.2126 + pixel[ 1 ] * 0.7152 + pixel[ 2 ] * 0.0722;

}

function quantizedUniqueRgbCount( image ) {

	const colors = new Set();

	for ( let y = 0; y < image.height; y ++ ) {

		for ( let x = 0; x < image.width; x ++ ) {

			const pixel = imagePixel( image, x, y );
			colors.add( `${ pixel[ 0 ] >> 4 },${ pixel[ 1 ] >> 4 },${ pixel[ 2 ] >> 4 }` );

		}

	}

	return colors.size;

}

function lowerHalfVariance( image ) {

	const values = [];
	const startY = Math.floor( image.height * 0.42 );
	const endY = Math.floor( image.height * 0.88 );
	const startX = Math.floor( image.width * 0.12 );
	const endX = Math.floor( image.width * 0.88 );

	for ( let y = startY; y < endY; y ++ ) {

		for ( let x = startX; x < endX; x ++ ) {

			values.push( luminance( imagePixel( image, x, y ) ) );

		}

	}

	const mean = values.reduce( ( sum, value ) => sum + value, 0 ) / values.length;
	const variance = values.reduce( ( sum, value ) => sum + ( value - mean ) ** 2, 0 ) / values.length;
	return variance;

}

function meanVelocityNorm( image ) {

	let sum = 0;
	let count = 0;

	for ( let y = 0; y < image.height; y ++ ) {

		for ( let x = 0; x < image.width; x ++ ) {

			const pixel = imagePixel( image, x, y );
			sum += Math.hypot( pixel[ 0 ] - 128, pixel[ 1 ] - 128 );
			count ++;

		}

	}

	return sum / count;

}

function bloomOutsideMean( image ) {

	let minX = image.width;
	let minY = image.height;
	let maxX = - 1;
	let maxY = - 1;

	for ( let y = 0; y < image.height; y ++ ) {

		for ( let x = 0; x < image.width; x ++ ) {

			if ( luminance( imagePixel( image, x, y ) ) > 18 ) {

				minX = Math.min( minX, x );
				minY = Math.min( minY, y );
				maxX = Math.max( maxX, x );
				maxY = Math.max( maxY, y );

			}

		}

	}

	assert( maxX >= minX && maxY >= minY, 'Bloom diagnostic has no bright emissive-region pixels.' );

	const pad = 18;
	minX = Math.max( 0, minX - pad );
	minY = Math.max( 0, minY - pad );
	maxX = Math.min( image.width - 1, maxX + pad );
	maxY = Math.min( image.height - 1, maxY + pad );

	let outsideSum = 0;
	let outsideCount = 0;

	for ( let y = 0; y < image.height; y ++ ) {

		for ( let x = 0; x < image.width; x ++ ) {

			if ( x >= minX && x <= maxX && y >= minY && y <= maxY ) continue;
			outsideSum += luminance( imagePixel( image, x, y ) );
			outsideCount ++;

		}

	}

	return outsideSum / Math.max( 1, outsideCount );

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

			for ( let c = 0; c < 3; c ++ ) {

				sum += Math.abs( imageA.raw[ pixelOffset + c ] - imageB.raw[ pixelOffset + c ] );
				count ++;

			}

		}

	}

	return sum / count;

}

async function validateSourceContracts() {

	const mainSource = await readFile( resolve( here, 'main.js' ), 'utf8' );
	const skillSource = await readFile( resolve( here, '../../SKILL.md' ), 'utf8' );
	const readmeSource = await readFile( resolve( here, 'README.md' ), 'utf8' );

	assert( ! mainSource.includes( 'options.temporal === true ? traa' ), 'main.js still enables TRAA directly from options.temporal.' );
	assert( mainSource.includes( 'config.temporal.enabled === true ? traa' ), 'main.js must drive TRAA from validated config.temporal.enabled.' );
	assert( ! mainSource.includes( "getTextureNode( 'albedo' )" ), 'main.js still reads albedo from the production MRT.' );
	assert( mainSource.includes( 'Debug-only albedo capture' ), 'main.js must label albedo as a debug-only diagnostic pass.' );
	assert( mainSource.includes( 'scenePass.dispose?.()' ), 'main.js disposal must call scenePass.dispose?.().' );
	assert( mainSource.includes( 'debugAlbedoPass.dispose?.()' ), 'main.js disposal must call debugAlbedoPass.dispose?.().' );
	assert( mainSource.includes( 'gtao.dispose?.()' ), 'main.js disposal must call gtao.dispose?.().' );
	assert( mainSource.includes( 'bloomPass.dispose?.()' ), 'main.js disposal must call bloomPass.dispose?.().' );
	assert( mainSource.includes( 'temporal?.dispose?.()' ), 'main.js disposal must call temporal?.dispose?.().' );
	assert( ! skillSource.includes( 'requiredMRT: 3' ), 'SKILL.md still documents requiredMRT: 3.' );
	assert( skillSource.includes( 'Trap: rgba8unorm renderTargetPixelByteCost is 8, not 4' ), 'SKILL.md must document the rgba8unorm byte-cost trap.' );
	assert( ! skillSource.includes( 'precomputed LUTs, static variants' ), 'SKILL.md still teaches reduced-tier fallback assets inside the flagship skill.' );
	assert( readmeSource.includes( 'current-minus-previous NDC' ), 'README.md must document r185 VelocityNode as current-minus-previous NDC.' );
	assert( readmeSource.includes( 'Trap: rgba8unorm renderTargetPixelByteCost is 8, not 4' ), 'README.md must document the rgba8unorm byte-cost trap.' );

	return { pass: true };

}

async function validateFalsifiabilityArtifacts( artifactDir ) {

	for ( const imagePath of supplementalFalsifiabilityImages ) {

		assert( existsSync( resolve( artifactDir, imagePath ) ), `Artifact bundle is missing ${ imagePath }.` );

	}

	const aoImage = decodeGeneratedRgbaPng( await readFile( resolve( artifactDir, 'images/AO.static.png' ) ) );
	const velocityStatic = decodeGeneratedRgbaPng( await readFile( resolve( artifactDir, 'images/velocity.static.png' ) ) );
	const velocityMotion = decodeGeneratedRgbaPng( await readFile( resolve( artifactDir, 'images/velocity.motion.png' ) ) );
	const normalImage = decodeGeneratedRgbaPng( await readFile( resolve( artifactDir, 'images/normal.static.png' ) ) );
	const albedoImage = decodeGeneratedRgbaPng( await readFile( resolve( artifactDir, 'images/albedo.static.png' ) ) );
	const bloomImage = decodeGeneratedRgbaPng( await readFile( resolve( artifactDir, 'images/bloom.static.png' ) ) );

	const aoVariance = lowerHalfVariance( aoImage );
	const staticVelocity = meanVelocityNorm( velocityStatic );
	const motionVelocity = meanVelocityNorm( velocityMotion );
	const normalUnique = quantizedUniqueRgbCount( normalImage );
	const albedoUnique = quantizedUniqueRgbCount( albedoImage );
	const bloomOutside = bloomOutsideMean( bloomImage );
	const temporalDifference = await meanRgbDifference(
		resolve( artifactDir, 'images/temporal.t000.png' ),
		resolve( artifactDir, 'images/temporal.t001.png' )
	);

	assert( aoVariance > 0.5, `AO channel lacks contact-region variance (${ aoVariance.toFixed( 3 ) }).` );
	assert( staticVelocity < 3, `Static velocity control is not near zero (${ staticVelocity.toFixed( 3 ) }).` );
	assert( motionVelocity > 4, `Motion velocity channel is too weak (${ motionVelocity.toFixed( 3 ) }).` );
	assert( temporalDifference > 2, `temporal.t000 and temporal.t001 are too similar (${ temporalDifference.toFixed( 3 ) }).` );
	assert( bloomOutside < 8, `Bloom diagnostic leaks outside the emissive region (${ bloomOutside.toFixed( 3 ) }).` );
	assert( normalUnique >= 24, `Normal diagnostic has too few unique colors (${ normalUnique }).` );
	assert( albedoUnique >= 12, `Albedo diagnostic has too few unique colors (${ albedoUnique }).` );

	return {
		aoVariance,
		staticVelocity,
		motionVelocity,
		temporalDifference,
		bloomOutside,
		normalUnique,
		albedoUnique
	};

}

async function validateImagePipelineArtifacts( artifactDir, requireArtifacts ) {

	if ( ! existsSync( resolve( artifactDir, 'visual-contract.json' ) ) ) {

		return null;

	}

	const bundle = await validateArtifactBundle( artifactDir );
	const manifest = await readJson( resolve( artifactDir, 'evidence-manifest.json' ) );
	const contract = await readJson( resolve( artifactDir, 'visual-contract.json' ) );

	assert( manifest.sceneId === SCENE_ID, `Unexpected sceneId ${ manifest.sceneId }.` );
	assert( manifest.backend.isPrimaryBackend === true, 'Artifact bundle did not record a primary WebGPU backend.' );
	assert( manifest.postStack.scenePasses === 1, 'Image pipeline evidence must record one scene pass.' );
	assert( manifest.postStack.mrtOutputs.includes( 'velocity' ), 'Image pipeline evidence must include velocity MRT.' );
	assert( ! manifest.postStack.mrtOutputs.includes( 'albedo' ), 'Image pipeline evidence must not record albedo as a production MRT.' );
	assert( manifest.postStack.debugOnlyAlbedo, 'Image pipeline evidence must record albedo as a debug-only capture.' );
	assert( manifest.colorPipeline.outputColorTransform === false, 'Image pipeline evidence must keep RenderPipeline.outputColorTransform disabled for renderOutput ownership.' );

	for ( const imagePath of [ ...REQUIRED_IMAGES, ...supplementalFalsifiabilityImages ] ) {

		assert( contract.requiredImages.includes( imagePath ), `visual-contract.json is missing ${ imagePath }.` );

	}

	const diagnosticDifference = await meanRgbDifference(
		resolve( artifactDir, 'images/final.design.png' ),
		resolve( artifactDir, 'images/diagnostics.mosaic.png' )
	);
	assert( diagnosticDifference > 6, `diagnostics.mosaic.png is too similar to final.design.png (${ diagnosticDifference.toFixed( 3 ) }).` );

	const falsifiability = requireArtifacts === true ? await validateFalsifiabilityArtifacts( artifactDir ) : null;

	return { bundle, falsifiability };

}

async function main() {

	const options = parseArgs( process.argv.slice( 2 ) );
	const graph = runSelfTest();
	const sourceContracts = await validateSourceContracts();
	const artifact = options.requireArtifacts === true
		? await validateImagePipelineArtifacts( options.artifactDir, true )
		: null;

	if ( options.requireArtifacts && artifact === null ) {

		throw new Error( `Artifact directory not found: ${ options.artifactDir }` );

	}

	console.log( JSON.stringify( {
		pass: true,
		graph: {
			requiredMRT: graph.valid.requiredMRT,
			diagnosticModes: graph.valid.diagnosticModes,
			estimatedBytes: graph.valid.estimatedBytes,
			invalidFixtures: graph.invalidFixtures
		},
		sourceContracts,
		artifactDir: options.artifactDir,
		artifactValidated: artifact !== null,
		artifacts: artifact
	}, null, 2 ) );

}

main().catch( ( error ) => {

	console.error( error.message );
	process.exitCode = 1;

} );
