import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { encodeRgbaPng } from '../../../scripts/lib/png-rgba.mjs';
import { classifyGpuStageAttribution, classifyPerformanceTrace, writeIncompleteV2RuntimeBundle } from './src/runtime-v2-bundle.js';

const DISTINCT_IMAGE_MEAN_RGB_BYTE_GATE = 1;
const GOVERNOR_MEAN_VISUAL_ERROR_GATE = 8;
const GOVERNOR_EDGE_P95_VISUAL_ERROR_GATE = 32;

function captureRecord( filename, capture ) {

	return {
		filename,
		target: capture.target,
		width: capture.width,
		height: capture.height,
		bytesPerPixel: capture.bytesPerPixel,
		bytesPerRow: capture.bytesPerRow,
		sourceBytesPerRow: capture.sourceBytesPerRow,
		sourceByteLength: capture.sourceByteLength,
		transportByteLength: capture.transportByteLength,
		sourceLayout: capture.sourceLayout,
		format: capture.format,
		colorEncoding: capture.colorEncoding
	};

}

async function captureAndWrite( session, captures, filename, target ) {

	await session.controllerCall( 'renderOnce' );
	const capture = await session.capturePixels( target );
	await writeFile( resolve( session.outputDir, filename ), encodeRgbaPng( capture ) );
	captures.push( captureRecord( filename, capture ) );
	return capture;

}

function meanRgbByteDifference( a, b ) {

	if ( a.width !== b.width || a.height !== b.height ) throw new Error( 'Diagnostic comparison dimensions differ.' );
	let total = 0;
	let samples = 0;
	for ( let index = 0; index < a.data.length; index += 4 ) {

		for ( let channel = 0; channel < 3; channel ++ ) total += Math.abs( a.data[ index + channel ] - b.data[ index + channel ] );
		samples += 3;

	}
	return total / samples;

}

function percentile( values, quantile ) {

	const sorted = [ ...values ].sort( ( a, b ) => a - b );
	const position = ( sorted.length - 1 ) * quantile;
	const lower = Math.floor( position );
	const upper = Math.ceil( position );
	return lower === upper ? sorted[ lower ] : sorted[ lower ] + ( sorted[ upper ] - sorted[ lower ] ) * ( position - lower );

}

function tierVisualErrorMetrics( reference, candidate ) {

	if ( reference.width !== candidate.width || reference.height !== candidate.height ) throw new Error( 'Tier comparison dimensions differ.' );
	const edgeDifferences = [];
	for ( let y = 1; y < reference.height - 1; y ++ ) for ( let x = 1; x < reference.width - 1; x ++ ) {

		const center = ( y * reference.width + x ) * 4;
		const neighbors = [ center - 4, center + 4, center - reference.width * 4, center + reference.width * 4 ];
		let gradient = 0;
		for ( const neighbor of neighbors ) for ( let channel = 0; channel < 3; channel ++ ) gradient = Math.max( gradient, Math.abs( reference.data[ center + channel ] - reference.data[ neighbor + channel ] ) );
		if ( gradient < 8 ) continue;
		const difference = (
			Math.abs( reference.data[ center ] - candidate.data[ center ] ) +
			Math.abs( reference.data[ center + 1 ] - candidate.data[ center + 1 ] ) +
			Math.abs( reference.data[ center + 2 ] - candidate.data[ center + 2 ] )
		) / 3;
		edgeDifferences.push( difference );

	}
	if ( edgeDifferences.length === 0 ) throw new Error( 'Tier comparison reference edge mask is empty.' );
	return {
		meanRgbByteDifference: meanRgbByteDifference( reference, candidate ),
		edgeMaskPixels: edgeDifferences.length,
		edgeMeanRgbByteDifference: edgeDifferences.reduce( ( sum, value ) => sum + value, 0 ) / edgeDifferences.length,
		edgeP95RgbByteDifference: percentile( edgeDifferences, 0.95 )
	};

}

function diagnosticMosaic( entries ) {

	const width = entries[ 0 ].width;
	const height = entries[ 0 ].height;
	if ( entries.some( ( entry ) => entry.width !== width || entry.height !== height ) ) throw new Error( 'Diagnostic mosaic inputs must share dimensions.' );
	const data = new Uint8Array( width * height * 4 );
	const halfWidth = Math.ceil( width / 2 );
	const halfHeight = Math.ceil( height / 2 );

	for ( let y = 0; y < height; y ++ ) for ( let x = 0; x < width; x ++ ) {

		const column = x >= halfWidth ? 1 : 0;
		const row = y >= halfHeight ? 1 : 0;
		const source = entries[ row * 2 + column ];
		const tileWidth = column === 0 ? halfWidth : width - halfWidth;
		const tileHeight = row === 0 ? halfHeight : height - halfHeight;
		const localX = column === 0 ? x : x - halfWidth;
		const localY = row === 0 ? y : y - halfHeight;
		const sourceX = Math.min( width - 1, Math.floor( localX * width / tileWidth ) );
		const sourceY = Math.min( height - 1, Math.floor( localY * height / tileHeight ) );
		const sourceOffset = ( sourceY * width + sourceX ) * 4;
		const targetOffset = ( y * width + x ) * 4;
		data.set( source.data.subarray( sourceOffset, sourceOffset + 4 ), targetOffset );

	}
	return { width, height, data };

}

export async function captureLab( session ) {

	const captures = [];
	await mkdir( resolve( session.outputDir, 'images' ), { recursive: true } );
	await session.controllerCall( 'setScenario', 'browser-capture' );
	await session.controllerCall( 'setTier', 'webgpu-correctness' );
	await session.controllerCall( 'resize', 1200, 800, 1 );
	await session.controllerCall( 'setCamera', 'design' );
	await session.controllerCall( 'setSeed', 0x00000001 );
	await session.controllerCall( 'setTime', 0 );

	const final = await captureAndWrite( session, captures, 'images/final.design.png', 'final' );
	const noPost = await captureAndWrite( session, captures, 'images/no-post.design.png', 'no-post' );
	const normal = await captureAndWrite( session, captures, 'images/diagnostic.normal.png', 'normal' );
	const emissive = await captureAndWrite( session, captures, 'images/diagnostic.emissive.png', 'emissive' );
	const diagnosticDifference = Math.min(
		meanRgbByteDifference( final, normal ),
		meanRgbByteDifference( final, emissive )
	);
	if ( diagnosticDifference <= DISTINCT_IMAGE_MEAN_RGB_BYTE_GATE ) throw new Error( 'Diagnostic outputs are not materially distinct from final output.' );
	await writeFile(
		resolve( session.outputDir, 'images/diagnostics.mosaic.png' ),
		encodeRgbaPng( diagnosticMosaic( [ final, noPost, normal, emissive ] ) )
	);
	captures.push( { filename: 'images/diagnostics.mosaic.png', target: 'final/no-post/normal/emissive', width: final.width, height: final.height, source: 'four actual output-node captures' } );

	for ( const camera of [ 'near', 'design', 'far' ] ) {

		await session.controllerCall( 'setCamera', camera );
		await captureAndWrite( session, captures, `images/camera.${ camera }.png`, 'final' );

	}

	await session.controllerCall( 'setCamera', 'design' );
	for ( const seed of [ 0x00000001, 0x9e3779b9 ] ) {

		await session.controllerCall( 'setSeed', seed );
		await session.controllerCall( 'setTime', 0 );
		const seedName = seed === 0x00000001 ? '0001' : seed.toString( 16 ).padStart( 8, '0' );
		await captureAndWrite( session, captures, `images/seed-${ seedName }.final.png`, 'final' );

	}

	await session.controllerCall( 'setSeed', 0x00000001 );
	await session.controllerCall( 'resetHistory', 'correctness-capture' );
	await session.controllerCall( 'setTime', 0 );
	await captureAndWrite( session, captures, 'images/temporal.t000.png', 'final' );
	await session.controllerCall( 'step', 1 / 60 );
	await captureAndWrite( session, captures, 'images/temporal.t001.png', 'final' );

	await session.controllerCall( 'resize', 641, 359, 1 );
	const odd = await captureAndWrite( session, captures, 'images/odd-size.final.png', 'final' );
	if ( odd.width !== 641 || odd.height !== 359 ) throw new Error( `Odd-size capture drifted to ${ odd.width }x${ odd.height }.` );

	let performanceTrace = null;
	let governorTrace = null;
	if ( session.profile === 'performance' ) {

		await session.controllerCall( 'resize', session.profileConfig.width, session.profileConfig.height, session.profileConfig.dpr );
		await session.controllerCall( 'setTier', 'target-performance' );
		await session.controllerCall( 'setCamera', 'design' );
		await session.controllerCall( 'setSeed', 0x00000001 );
		await session.controllerCall( 'setTime', 0 );
		await captureAndWrite( session, captures, 'images/final.performance.png', 'final' );
		performanceTrace = await session.controllerCall( 'runPerformanceProfile', {
			warmupFrames: 30,
			sampleFrames: 120,
			presentationFrames: 120
		} );
		governorTrace = await session.controllerCall( 'runGovernorStressProfile', {
			windowCount: 6,
			framesPerWindow: 30
		} );
		await session.controllerCall( 'setTier', 'target-performance' );
		const targetTier = await captureAndWrite( session, captures, 'images/tier.target-performance.png', 'final' );
		await session.controllerCall( 'setTier', 'governor-stress' );
		const governorTier = await captureAndWrite( session, captures, 'images/tier.governor-stress.png', 'final' );
		governorTrace.visualErrorByTier = {
			'target-performance': { meanRgbByteDifference: 0, edgeMaskPixels: 0, edgeMeanRgbByteDifference: 0, edgeP95RgbByteDifference: 0 },
			'governor-stress': tierVisualErrorMetrics( targetTier, governorTier )
		};
		governorTrace.visualErrorGates = {
			meanRgbByteDifference: GOVERNOR_MEAN_VISUAL_ERROR_GATE,
			edgeP95RgbByteDifference: GOVERNOR_EDGE_P95_VISUAL_ERROR_GATE
		};

	}

	await session.controllerCall( 'resize', session.profileConfig.width, session.profileConfig.height, session.profileConfig.dpr );
	await session.controllerCall( 'setTier', session.profile === 'performance' ? 'target-performance' : 'webgpu-correctness' );
	await session.controllerCall( 'setCamera', 'design' );
	await session.controllerCall( 'setSeed', 0x00000001 );
	await session.controllerCall( 'setTime', 0 );
	await session.controllerCall( 'setMode', 'final' );
	await session.controllerCall( 'renderOnce' );
	const lifecycle = await session.page.evaluate( async () => (
		window.__THREEJS_LAB_LIFECYCLE__( 50 )
	) );

	const runtime = {
		metrics: await session.controllerCall( 'getMetrics' ),
		pipeline: await session.controllerCall( 'describePipeline' ),
		resources: await session.controllerCall( 'describeResources' ),
		gpuTiming: await session.controllerCall( 'resolveGpuTimings' ),
		performanceTrace,
		governorTrace,
		lifecycle
	};
	const performanceCompliance = classifyPerformanceTrace( performanceTrace, {
		cpuP95: 1000 / 60 - 2,
		gpuP95: 1000 / 60 - 2,
		deadlineMissRatio: 0.01
	} );
	const gpuAttribution = classifyGpuStageAttribution( performanceTrace );
	const boundary = {
		schemaVersion: 2,
		bundleKind: 'browser-capture-session',
		labId: session.lab.id,
		status: 'incomplete',
		publishable: false,
		sourceHash: session.lab.sourceHash,
		evidenceContract: 'v2',
		reason: performanceTrace === null
			? 'Real render-target captures and a 50-cycle lifecycle run exist; acceptance still requires mechanism completeness, sustained timing, GPU-stage attribution, and visual sign-off.'
			: 'Real render-target captures, a sustained attributed CPU/GPU/cadence trace, a measured governor stress run, and a 50-cycle lifecycle run exist; acceptance still requires mechanism completeness and visual sign-off.',
		claimVerdicts: {
			nativeWebGPUCorrectness: 'PASS',
			renderTargetReadback: 'PASS',
			mechanismCorrectness: 'INSUFFICIENT_EVIDENCE',
			performanceCompliance,
			gpuTimestampAvailability: runtime.gpuTiming.verdict,
			gpuAttribution,
			lifecycleStability: lifecycle === null ? 'INSUFFICIENT_EVIDENCE' : 'PASS'
		},
		diagnosticDifference: {
			value: diagnosticDifference,
			unit: 'mean-rgb-byte-difference',
			label: 'Measured',
			source: 'render-target output-node comparison'
		},
		captures,
		runtime
	};
	const bundle = await writeIncompleteV2RuntimeBundle( session, {
		captures,
		runtime,
		diagnosticDifference: boundary.diagnosticDifference.value
	} );
	await writeFile( resolve( session.outputDir, 'capture-boundary.json' ), `${ JSON.stringify( boundary, null, 2 ) }\n` );
	return { status: 'incomplete', publishable: false, captures, gpuTiming: runtime.gpuTiming, bundle };

}

export default captureLab;
