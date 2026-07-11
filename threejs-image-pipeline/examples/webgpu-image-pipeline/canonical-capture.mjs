import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

import { createRgbaPng } from '../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js';
import { labViteAliases } from '../../../scripts/lib/vite-lab-config.mjs';

function parseArgs( values ) {

	const repoRoot = resolve( dirname( fileURLToPath( import.meta.url ) ), '../../..' );
	const options = {
		url: process.env.LAB_URL ?? null,
		repoRoot,
		output: resolve( repoRoot, 'artifacts/visual-validation/webgpu-image-pipeline-v2' ),
		profile: 'correctness'
	};
	for ( let index = 0; index < values.length; index += 1 ) {

		if ( values[ index ] === '--url' ) options.url = values[ ++ index ];
		else if ( values[ index ] === '--output' ) options.output = resolve( values[ ++ index ] );
		else if ( values[ index ] === '--profile' ) options.profile = values[ ++ index ];
		else throw new Error( `Unknown capture argument "${ values[ index ] }".` );

	}
	if ( ! [ 'correctness', 'performance' ].includes( options.profile ) ) throw new Error( `Unknown capture profile "${ options.profile }".` );
	return options;

}

function encode( capture ) {

	if ( ! Number.isInteger( capture.bytesPerRow ) || capture.bytesPerRow < capture.width * 4 ) throw new Error( `Invalid WebGPU row stride ${ capture.bytesPerRow }.` );
	const pixels = Uint8Array.from( capture.pixels );
	return createRgbaPng( capture.width, capture.height, ( x, y ) => {

		const offset = y * capture.bytesPerRow + x * 4;
		return [ pixels[ offset ], pixels[ offset + 1 ], pixels[ offset + 2 ], pixels[ offset + 3 ] ];

	} );

}

function encodeMosaic( captures ) {

	if ( captures.length === 0 ) throw new Error( 'Diagnostic mosaic requires real captures.' );
	const width = captures[ 0 ].width;
	const height = captures[ 0 ].height;
	if ( captures.some( ( capture ) => capture.width !== width || capture.height !== height ) ) throw new Error( 'Diagnostic mosaic inputs have inconsistent dimensions.' );
	const columns = 3;
	const rows = Math.ceil( captures.length / columns );
	const sources = captures.map( ( capture ) => ( { ...capture, bytes: Uint8Array.from( capture.pixels ) } ) );
	return createRgbaPng( width, height, ( x, y ) => {

		const column = Math.min( columns - 1, Math.floor( x * columns / width ) );
		const row = Math.min( rows - 1, Math.floor( y * rows / height ) );
		const source = sources[ Math.min( sources.length - 1, row * columns + column ) ];
		const tileX0 = Math.floor( column * width / columns );
		const tileX1 = Math.floor( ( column + 1 ) * width / columns );
		const tileY0 = Math.floor( row * height / rows );
		const tileY1 = Math.floor( ( row + 1 ) * height / rows );
		const sourceX = Math.min( width - 1, Math.floor( ( x - tileX0 ) * width / Math.max( 1, tileX1 - tileX0 ) ) );
		const sourceY = Math.min( height - 1, Math.floor( ( y - tileY0 ) * height / Math.max( 1, tileY1 - tileY0 ) ) );
		const offset = sourceY * source.bytesPerRow + sourceX * 4;
		return [ source.bytes[ offset ], source.bytes[ offset + 1 ], source.bytes[ offset + 2 ], source.bytes[ offset + 3 ] ];

	} );

}

async function writeJson( path, value ) {

	await writeFile( path, `${ JSON.stringify( value, null, 2 ) }\n` );

}

const options = parseArgs( process.argv.slice( 2 ) );
const viewport = options.profile === 'performance' ? { width: 1920, height: 1080 } : { width: 1200, height: 800 };
let server = null;
let browser = null;

try {

	let url = options.url;
	if ( ! url ) {

		server = await createServer( {
			root: options.repoRoot,
			logLevel: 'error',
			resolve: { alias: labViteAliases( options.repoRoot ), dedupe: [ 'three' ] },
			server: { host: '127.0.0.1', port: 0, strictPort: false }
		} );
		await server.listen();
		const base = server.resolvedUrls?.local?.[ 0 ];
		if ( ! base ) throw new Error( 'Vite did not expose a local URL for image-pipeline capture.' );
		url = new URL( 'threejs-image-pipeline/examples/webgpu-image-pipeline/index.html?tier=full&mode=final', base ).href;

	}
	const { chromium } = await import( 'playwright' );
	browser = await chromium.launch( {
		headless: true,
		args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--disable-gpu-sandbox' ]
	} );
	const page = await browser.newPage( { viewport, deviceScaleFactor: 1 } );
	const browserErrors = [];
	page.on( 'pageerror', ( error ) => browserErrors.push( String( error.stack ?? error.message ) ) );
	page.on( 'console', ( message ) => {

		if ( message.type() === 'error' ) browserErrors.push( message.text() );

	} );
	await page.goto( url, { waitUntil: 'networkidle' } );
	await page.waitForFunction( () => window.__labController?.ready );
	await page.evaluate( () => window.__labController.ready() );
	const imageDirectory = resolve( options.output, 'images' );
	await mkdir( imageDirectory, { recursive: true } );

	async function capture( mode, filename ) {

		const pixels = await page.evaluate( ( selectedMode ) => window.__labController.capturePixels( selectedMode ), mode );
		await page.evaluate( () => window.__canonicalImagePipeline.app.renderer.backend.device.queue.onSubmittedWorkDone() );
		if ( browserErrors.length > 0 ) throw new Error( `Image-pipeline browser validation failed:\n${ browserErrors.join( '\n' ) }` );
		await writeFile( resolve( imageDirectory, filename ), encode( pixels ) );
		return pixels;

	}

	await page.evaluate( async () => {

		await window.__labController.setTime( 0 );
		await window.__labController.renderOnce();
		await window.__labController.renderOnce();

	} );
	const diagnosticCaptures = [];
	for ( const [ mode, filename ] of [
		[ 'final', 'final.design.png' ],
		[ 'no-post', 'no-post.design.png' ],
		[ 'output', 'output.png' ],
		[ 'depth', 'depth.raw.png' ],
		[ 'view-z', 'depth.view-z.png' ],
		[ 'linear-depth', 'depth.linear-view-z.png' ],
		[ 'normal', 'normal.png' ],
		[ 'emissive', 'emissive.png' ],
		[ 'ao', 'ao.diagnostic-only.png' ],
		[ 'bloom', 'bloom.png' ],
		[ 'exposure', 'exposure.png' ]
	] ) {

		const result = await capture( mode, filename );
		if ( ! [ 'final', 'no-post' ].includes( mode ) ) diagnosticCaptures.push( result );

	}
	await writeFile( resolve( imageDirectory, 'diagnostics.mosaic.png' ), encodeMosaic( diagnosticCaptures ) );

	for ( const camera of [ 'near', 'design', 'far' ] ) {

		await page.evaluate( ( id ) => window.__labController.setCamera( id ), camera );
		await capture( 'final', `camera.${ camera }.png` );

	}
	await page.evaluate( () => window.__labController.setCamera( 'design' ) );
	await page.evaluate( async () => { await window.__labController.setSeed( 1 ); await window.__labController.setTime( 0 ); } );
	await capture( 'final', 'seed-0001.final.png' );
	await page.evaluate( () => window.__labController.setSeed( 0x9e3779b9 ) );
	await capture( 'final', 'seed-9e3779b9.final.png' );
	await page.evaluate( () => window.__labController.setSeed( 1 ) );

	await page.evaluate( async () => {

		await window.__labController.setTime( 0 );
		await window.__labController.renderOnce();
		await window.__labController.renderOnce();

	} );
	await capture( 'velocity', 'velocity.static.png' );
	await page.evaluate( () => window.__labController.setTime( 1 ) );
	await capture( 'velocity', 'velocity.moving-positive-x.png' );

	await page.evaluate( async () => {

		await window.__labController.setMode( 'temporal-resolved' );

	} );
	await capture( 'temporal-resolved', 'temporal.t000.png' );
	await page.evaluate( () => window.__labController.step( 1 / 60 ) );
	await capture( 'temporal-resolved', 'temporal.t001.png' );
	await page.evaluate( async () => {

		for ( let frame = 0; frame < 10; frame += 1 ) await window.__labController.step( 1 / 60 );

	} );
	await capture( 'temporal-current', 'temporal.current.png' );
	await capture( 'temporal-history', 'temporal.history.png' );
	await capture( 'temporal-resolved', 'temporal.resolved.png' );
	const pipelineBeforeReset = await page.evaluate( () => window.__labController.describePipeline() );

	await page.evaluate( () => window.__labController.resetHistory( 'capture-camera-cut' ) );
	await capture( 'temporal-current', 'temporal.after-reset.current.png' );
	await capture( 'temporal-resolved', 'temporal.after-reset.resolved.png' );

	await page.setViewportSize( { width: 641, height: 359 } );
	await page.waitForFunction( () => innerWidth === 641 && innerHeight === 359 );
	await capture( 'final', 'odd-641x359.final.png' );
	await page.setViewportSize( viewport );
	await page.waitForFunction( ( extent ) => innerWidth === extent.width && innerHeight === extent.height, viewport );
	// The resize rebuilds TRAA and exposure storage. Initialize the new resource
	// generation before any diagnostic storage readback.
	await page.evaluate( async () => {

		await window.__labController.renderOnce();
		await window.__labController.renderOnce();

	} );

	const evidence = await page.evaluate( async () => ( {
		pipeline: window.__labController.describePipeline(),
		resources: window.__labController.describeResources(),
		metrics: window.__labController.getMetrics(),
		exposureReadback: await window.__labController.getExposureReadback()
	} ) );
	await writeJson( resolve( options.output, 'capture-contract.json' ), {
		schemaVersion: 2,
		profile: options.profile,
		url,
		viewport: { ...viewport, dpr: 1 },
		oddExtent: { width: 641, height: 359, dpr: 1 },
		velocityFixture: { staticTime: 0, movingTime: 1, expectedNdcXSign: 'positive' },
		temporalResetCause: 'capture-camera-cut',
		verdict: 'INSUFFICIENT_EVIDENCE until this bundle passes validation on a named native-WebGPU adapter'
	} );
	await writeJson( resolve( options.output, 'pipeline-before-reset.json' ), pipelineBeforeReset );
	await writeJson( resolve( options.output, 'pipeline-graph.json' ), evidence.pipeline );
	await writeJson( resolve( options.output, 'resident-resources.json' ), evidence.resources );
	await writeJson( resolve( options.output, 'renderer-info.json' ), evidence.metrics.rendererInfo );
	await writeJson( resolve( options.output, 'mechanism-metrics.json' ), { ...evidence.metrics, captureProfile: options.profile } );
	await writeJson( resolve( options.output, 'exposure-readback.json' ), evidence.exposureReadback );

} finally {

	await browser?.close();
	await server?.close();

}
