import { createHash } from 'node:crypto';

import { unpackAlignedRows } from '../../../labs/runtime/aligned-readback.mjs';
import { encodeRgbaPng } from '../../../scripts/lib/png-rgba.mjs';
import {
	computeCaptureSourceClosure,
	validateCaptureSourceClosure
} from './src/capture-source-closure.js';
import {
	DIAGNOSTIC_MOSAIC_RECIPE,
	DIAGNOSTIC_MOSAIC_SOURCES,
	reconstructDiagnosticMosaic as reconstructNamedDiagnosticMosaic
} from './src/diagnostic-mosaic.js';
import {
	classifyGpuStageAttribution,
	classifyMechanismProof,
	classifyPerformanceTrace,
	writeIncompleteV2RuntimeBundle
} from './src/runtime-v2-bundle.js';

const DISTINCT_IMAGE_MEAN_RGB_BYTE_GATE = 1;
export { DIAGNOSTIC_MOSAIC_RECIPE, DIAGNOSTIC_MOSAIC_SOURCES };

export const outputPlan = Object.freeze( [
	{ id: 'final.design', status: 'CAPTURED', filename: 'final.design.png' },
	{ id: 'no-post.design', status: 'CAPTURED', filename: 'no-post.design.png' },
	{
		id: 'diagnostics.mosaic',
		status: 'CAPTURED',
		filename: 'diagnostics.mosaic.png',
		sourceCaptures: [ 'final.design.png', 'no-post.design.png', 'diagnostic.normal.png', 'diagnostic.emissive.png' ]
	},
	{ id: 'camera.near', status: 'CAPTURED', filename: 'camera.near.png' },
	{ id: 'camera.design', status: 'CAPTURED', filename: 'camera.design.png' },
	{ id: 'camera.far', status: 'CAPTURED', filename: 'camera.far.png' },
	{ id: 'seed-0001.final', status: 'CAPTURED', filename: 'seed-0001.final.png' },
	{ id: 'seed-9e3779b9.final', status: 'CAPTURED', filename: 'seed-9e3779b9.final.png' },
	{ id: 'temporal.t000', status: 'CAPTURED', filename: 'temporal.t000.png' },
	{ id: 'temporal.t001', status: 'CAPTURED', filename: 'temporal.t001.png' }
] );

export const recomputeCaptureSourceClosure = computeCaptureSourceClosure;
export { validateCaptureSourceClosure };

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

export function captureRecord( filename, capture ) {

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
		requestedLayout: capture.transport?.rendererCopy?.requestedLayout ?? null,
		transportLayout: capture.transport?.layout ?? null,
		normalizedLayout: capture.normalized?.layout ?? null,
		normalizedBytesPerRow: capture.normalized?.bytesPerRow ?? null,
		normalizedByteLength: capture.normalized?.byteLength ?? null,
		controllerNormalized: capture.controllerNormalized ?? null,
		format: capture.format,
		colorEncoding: capture.colorEncoding,
		pngSha256: capture.png.sha256,
		transportSha256: capture.transport.artifact.sha256,
		normalizedSha256: capture.normalized.artifact.sha256
	};

}

async function captureAndWrite( session, captures, filename, target ) {

	const metadata = await session.writeCapture( filename, target );
	captures.push( captureRecord( filename, metadata ) );
	const normalizedBytes = await session.readArtifact( metadata.normalized.artifact.path );
	const compact = unpackAlignedRows( {
		source: normalizedBytes,
		width: metadata.width,
		height: metadata.height,
		bytesPerPixel: 4,
		bytesPerRow: metadata.normalized.bytesPerRow
	} );
	if ( sha256( compact ) !== metadata.normalized.compactRgbaSha256 ) throw new Error( `${ filename } normalized readback hash drifted before mosaic construction.` );
	return { filename, width: metadata.width, height: metadata.height, data: compact, metadata };

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

export function tierVisualErrorMetrics( reference, candidate ) {

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

export function reconstructDiagnosticMosaic( sources ) {

	return reconstructNamedDiagnosticMosaic( sources, { hashPixels: sha256 } );

}

async function writeDerivedMosaic( session, mosaic ) {

	const png = encodeRgbaPng( mosaic );
	const rowBytes = mosaic.width * 4;
	const bytesPerRow = Math.ceil( rowBytes / 256 ) * 256;
	const padded = new Uint8Array( bytesPerRow * mosaic.height );
	for ( let row = 0; row < mosaic.height; row ++ ) padded.set(
		mosaic.data.subarray( row * rowBytes, ( row + 1 ) * rowBytes ),
		row * bytesPerRow
	);
	const pngPath = 'diagnostics.mosaic.png';
	const rawPath = 'normalized-readbacks/diagnostics.mosaic.rgba8.padded.bin';
	const packedPath = 'normalized-readbacks/diagnostics.mosaic.rgba8.compact.bin';
	await session.writeArtifact( pngPath, png );
	await session.writeArtifact( rawPath, padded );
	await session.writeArtifact( packedPath, mosaic.data );
	return {
		id: 'diagnostics.mosaic',
		status: 'CAPTURED',
		filename: pngPath,
		width: mosaic.width,
		height: mosaic.height,
		sourceCaptures: [ 'final.design.png', 'no-post.design.png', 'diagnostic.normal.png', 'diagnostic.emissive.png' ],
		derivation: mosaic.recipe,
		file: { path: pngPath, sha256: sha256( png ), byteLength: png.byteLength },
		pixelEvidence: {
			png: {
				path: pngPath,
				sha256: sha256( png ),
				byteLength: png.byteLength,
				derivedFromPackedRgbaSha256: sha256( mosaic.data )
			},
			normalized: {
				rawArtifact: { path: rawPath, sha256: sha256( padded ), byteLength: padded.byteLength },
				packedArtifact: { path: packedPath, sha256: sha256( mosaic.data ), byteLength: mosaic.data.byteLength },
				packedRgbaSha256: sha256( mosaic.data ),
				packedByteLength: mosaic.data.byteLength,
				paddedBytesPerRow: bytesPerRow,
				width: mosaic.width,
				height: mosaic.height,
				rowBytes,
				bytesPerRow,
				origin: 'top-left',
				paddingVerifiedZero: true
			}
		}
	};

}

export function derivedMosaicCaptureRecord( mosaicOutput ) {

	return {
		filename: 'diagnostics.mosaic.png',
		target: 'final/no-post/normal/emissive',
		width: mosaicOutput.width,
		height: mosaicOutput.height,
		source: 'four actual output-node captures',
		pngSha256: mosaicOutput.file.sha256
	};

}

export function assertCanonicalCaptureLane( session ) {

	if ( session?.profile !== 'correctness' || session?.automationSurface !== 'playwright-headless-chromium' ) {

		throw new Error( 'Deterministic correctness capture requires the shared Playwright headless Chromium runner; physical-route and performance evidence use the immutable Codex in-app Browser runner.' );

	}
	return true;

}

export async function captureLab( session ) {

	assertCanonicalCaptureLane( session );
	const sourceClosure = computeCaptureSourceClosure();
	const captures = [];
	await session.controllerCall( 'setScenario', 'browser-capture' );
	await session.controllerCall( 'setTier', 'webgpu-correctness' );
	await session.controllerCall( 'resize', 1200, 800, 1 );
	await session.controllerCall( 'setCamera', 'design' );
	await session.controllerCall( 'setSeed', 0x00000001 );
	await session.controllerCall( 'setTime', 0 );

	const final = await captureAndWrite( session, captures, 'final.design.png', 'final' );
	const noPost = await captureAndWrite( session, captures, 'no-post.design.png', 'no-post' );
	const normal = await captureAndWrite( session, captures, 'diagnostic.normal.png', 'normal' );
	const emissive = await captureAndWrite( session, captures, 'diagnostic.emissive.png', 'emissive' );
	const diagnosticDifferences = {
		normal: meanRgbByteDifference( final, normal ),
		emissive: meanRgbByteDifference( final, emissive )
	};
	const diagnosticDifference = Math.min( diagnosticDifferences.normal, diagnosticDifferences.emissive );
	if ( diagnosticDifference <= DISTINCT_IMAGE_MEAN_RGB_BYTE_GATE ) throw new Error( 'Diagnostic outputs are not materially distinct from final output.' );
	const mosaicOutput = await writeDerivedMosaic( session, reconstructDiagnosticMosaic( new Map( [
		[ final.filename, final ],
		[ noPost.filename, noPost ],
		[ normal.filename, normal ],
		[ emissive.filename, emissive ]
	] ) ) );
	captures.push( derivedMosaicCaptureRecord( mosaicOutput ) );

	for ( const camera of [ 'near', 'design', 'far' ] ) {

		await session.controllerCall( 'setCamera', camera );
		await captureAndWrite( session, captures, `camera.${ camera }.png`, 'final' );

	}

	await session.controllerCall( 'setCamera', 'design' );
	for ( const seed of [ 0x00000001, 0x9e3779b9 ] ) {

		await session.controllerCall( 'setSeed', seed );
		await session.controllerCall( 'setTime', 0 );
		const seedName = seed === 0x00000001 ? '0001' : seed.toString( 16 ).padStart( 8, '0' );
		await captureAndWrite( session, captures, `seed-${ seedName }.final.png`, 'final' );

	}

	await session.controllerCall( 'setSeed', 0x00000001 );
	await session.controllerCall( 'resetHistory', 'correctness-capture' );
	await session.controllerCall( 'setTime', 0 );
	await captureAndWrite( session, captures, 'temporal.t000.png', 'final' );
	await session.controllerCall( 'step', 1 / 60 );
	await captureAndWrite( session, captures, 'temporal.t001.png', 'final' );

	await session.controllerCall( 'resize', 641, 359, 1 );
	const odd = await captureAndWrite( session, captures, 'odd-size.final.png', 'final' );
	if ( odd.width !== 641 || odd.height !== 359 ) throw new Error( `Odd-size capture drifted to ${ odd.width }x${ odd.height }.` );

	const performanceTrace = null;
	const governorTrace = null;

	await session.controllerCall( 'resize', session.profileConfig.width, session.profileConfig.height, session.profileConfig.dpr );
	await session.controllerCall( 'setTier', 'webgpu-correctness' );
	await session.controllerCall( 'setCamera', 'design' );
	await session.controllerCall( 'setSeed', 0x00000001 );
	await session.controllerCall( 'setTime', 0 );
	await session.controllerCall( 'setMode', 'final' );
	await session.controllerCall( 'renderOnce' );
	const mechanismProof = await session.controllerCall( 'runMechanismReachabilityProfile' );
	const lifecycle = await session.page.evaluate( async () => window.__THREEJS_LAB_LIFECYCLE__( 50 ) );

	const runtime = {
		metrics: await session.controllerCall( 'getMetrics' ),
		pipeline: await session.controllerCall( 'describePipeline' ),
		resources: await session.controllerCall( 'describeResources' ),
		gpuTiming: await session.controllerCall( 'resolveGpuTimings' ),
		performanceTrace,
		governorTrace,
		mechanismProof,
		lifecycle
	};
	const performanceCompliance = classifyPerformanceTrace( performanceTrace, {
		cpuP95: 1000 / 60 - 2,
		gpuP95: 1000 / 60 - 2,
		deadlineMissRatio: 0.01
	}, runtime.metrics.adapterClass );
	const gpuAttribution = classifyGpuStageAttribution( performanceTrace );
	const mechanismCorrectness = classifyMechanismProof( mechanismProof, diagnosticDifferences, runtime.pipeline );
	const boundary = {
		schemaVersion: 2,
		bundleKind: 'browser-capture-session',
		labId: session.lab.id,
		status: 'incomplete',
		publishable: false,
		sourceHash: session.lab.sourceHash,
		evidenceContract: 'v2',
		reason: performanceTrace === null
			? 'Native readbacks, runtime mechanism proof, and 50 lifecycle cycles exist; hardware performance and GPU attribution are not claimed by the correctness profile.'
			: runtime.metrics.adapterClass === 'software'
				? 'Native readbacks, runtime mechanism proof, attributed software-adapter diagnostics, governor diagnostics, and 50 lifecycle cycles exist; software timing cannot support hardware performance acceptance.'
				: 'Native readbacks, runtime mechanism proof, hardware timing, governor evidence, and 50 lifecycle cycles were captured; release promotion and direct visual sign-off remain separate.',
		claimVerdicts: {
			nativeWebGPUCorrectness: 'PASS',
			renderTargetReadback: 'PASS',
			mechanismCorrectness,
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
		diagnosticDifferences,
		captures,
		runtime
	};
	const bundle = await writeIncompleteV2RuntimeBundle( session, {
		captures,
		runtime,
		diagnosticDifference,
		diagnosticDifferences,
		sourceClosure
	} );
	await session.writeArtifact( 'capture-boundary.json', `${ JSON.stringify( boundary, null, 2 ) }\n` );
	return {
		status: 'incomplete',
		publishable: false,
		captures,
		gpuTiming: runtime.gpuTiming,
		bundle,
		sourceClosure,
		standardOutputs: [ mosaicOutput ]
	};

}

export default captureLab;
