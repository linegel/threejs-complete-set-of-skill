import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { encodeRgbaPng } from '../../../scripts/lib/png-rgba.mjs';

const DISTINCT_IMAGE_MEAN_RGB_BYTE_GATE = 1;

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
	await session.controllerCall( 'setTier', session.profile === 'performance' ? 'target-performance' : 'webgpu-correctness' );
	await session.controllerCall( 'setCamera', 'design' );
	await session.controllerCall( 'setSeed', 0x00000001 );
	await session.controllerCall( 'setTime', 0 );

	if ( session.profile === 'performance' ) {

		await captureAndWrite( session, captures, 'images/final.performance.png', 'final' );

	} else {

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
	}

	await session.controllerCall( 'resize', session.profileConfig.width, session.profileConfig.height, session.profileConfig.dpr );
	await session.controllerCall( 'setCamera', 'design' );
	await session.controllerCall( 'setSeed', 0x00000001 );
	await session.controllerCall( 'setTime', 0 );
	await session.controllerCall( 'setMode', 'final' );
	await session.controllerCall( 'renderOnce' );

	const runtime = {
		metrics: await session.controllerCall( 'getMetrics' ),
		pipeline: await session.controllerCall( 'describePipeline' ),
		resources: await session.controllerCall( 'describeResources' ),
		gpuTiming: await session.controllerCall( 'resolveGpuTimings' )
	};
	const boundary = {
		schemaVersion: 2,
		bundleKind: 'browser-capture-session',
		labId: session.lab.id,
		status: 'incomplete',
		publishable: false,
		sourceHash: session.lab.sourceHash,
		evidenceContract: 'v2',
		reason: 'Real render-target captures exist; acceptance still requires fourteen assembled v2 artifacts, 50-100 lifecycle cycles, timestamp sufficiency, artifact validation, and visual sign-off.',
		claimVerdicts: {
			nativeWebGPUCorrectness: 'PASS',
			renderTargetReadback: 'PASS',
			mechanismCorrectness: 'INSUFFICIENT_EVIDENCE',
			performanceCompliance: 'INSUFFICIENT_EVIDENCE',
			gpuTimestampAvailability: runtime.gpuTiming.verdict,
			gpuAttribution: 'INSUFFICIENT_EVIDENCE',
			lifecycleStability: 'INSUFFICIENT_EVIDENCE'
		},
		diagnosticDifference: {
			value: session.profile === 'performance' ? null : Math.min(
				meanRgbByteDifference( await session.capturePixels( 'final' ), await session.capturePixels( 'normal' ) ),
				meanRgbByteDifference( await session.capturePixels( 'final' ), await session.capturePixels( 'emissive' ) )
			),
			unit: 'mean-rgb-byte-difference',
			label: 'Measured',
			source: 'render-target output-node comparison'
		},
		captures,
		runtime
	};
	await writeFile( resolve( session.outputDir, 'evidence-manifest.incomplete.json' ), `${ JSON.stringify( boundary, null, 2 ) }\n` );
	return { status: 'incomplete', publishable: false, captures, gpuTiming: runtime.gpuTiming };

}

export default captureLab;
