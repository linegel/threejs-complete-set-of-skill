import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

import { createRgbaPng } from '../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js';

function args( values ) {

	const repoRoot = resolve( dirname( fileURLToPath( import.meta.url ) ), '../../..' );
	const result = {
		url: process.env.LAB_URL ?? null,
		repoRoot,
		output: resolve( repoRoot, 'artifacts/visual-validation/webgpu-exposure-color-pipeline-v2' ),
		profile: 'correctness'
	};
	for ( let index = 0; index < values.length; index += 1 ) {

		if ( values[ index ] === '--url' ) result.url = values[ ++ index ];
		else if ( values[ index ] === '--output' ) result.output = resolve( values[ ++ index ] );
		else if ( values[ index ] === '--profile' ) result.profile = values[ ++ index ];
		else throw new Error( `Unknown capture argument "${ values[ index ] }".` );

	}
	if ( ! [ 'correctness', 'performance' ].includes( result.profile ) ) throw new Error( `Unknown capture profile "${ result.profile }".` );
	return result;

}

function pngFromCapture( capture ) {

	const pixels = Uint8Array.from( capture.pixels );
	return createRgbaPng( capture.width, capture.height, ( x, y ) => {

		const offset = y * capture.bytesPerRow + x * 4;
		return [ pixels[ offset ], pixels[ offset + 1 ], pixels[ offset + 2 ], pixels[ offset + 3 ] ];

	} );

}

const options = args( process.argv.slice( 2 ) );
let server = null;
let browser = null;

try {

	let url = options.url;
	if ( ! url ) {

		server = await createServer( { root: options.repoRoot, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } } );
		await server.listen();
		const base = server.resolvedUrls?.local?.[ 0 ];
		if ( ! base ) throw new Error( 'Vite did not expose a local URL for exposure capture.' );
		url = new URL( 'threejs-exposure-color-grading/examples/webgpu-exposure-color-pipeline/index.html?tier=full-histogram&mode=final', base ).href;

	}
	const { chromium } = await import( 'playwright' );
	browser = await chromium.launch( {
		headless: true,
		args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--disable-gpu-sandbox' ]
	} );
	const viewport = options.profile === 'performance' ? { width: 1920, height: 1080 } : { width: 1200, height: 800 };
	const page = await browser.newPage( { viewport, deviceScaleFactor: 1 } );
	const browserErrors = [];
	page.on( 'pageerror', ( error ) => browserErrors.push( String( error.stack ?? error.message ) ) );
	page.on( 'console', ( message ) => {

		if ( message.type() === 'error' ) browserErrors.push( message.text() );

	} );
	await page.goto( url, { waitUntil: 'networkidle' } );
	await page.waitForFunction( () => window.__labController?.ready );
	await page.evaluate( () => window.__labController.ready() );
	await mkdir( resolve( options.output, 'images' ), { recursive: true } );
	const modes = [
		[ 'final', 'final.design.png' ],
		[ 'meter-source', 'meter-source.png' ],
		[ 'histogram', 'histogram-percentiles.png' ],
		[ 'adaptation', 'adaptation.png' ],
		[ 'meter-mask', 'meter-mask.png' ],
		[ 'tone-map', 'tone-map.png' ],
		[ 'lut', 'lut.png' ]
	];
	for ( const [ mode, name ] of modes ) {

		const capture = await page.evaluate( ( selectedMode ) => window.__labController.capturePixels( selectedMode ), mode );
		await page.evaluate( () => window.__exposureLab.app.renderer.backend.device.queue.onSubmittedWorkDone() );
		await writeFile( resolve( options.output, 'images', name ), pngFromCapture( capture ) );

	}
	if ( browserErrors.length > 0 ) throw new Error( `Exposure browser validation failed:\n${ browserErrors.join( '\n' ) }` );
	await page.evaluate( async () => { await window.__labController.setScenario( 'emitter' ); await window.__labController.setSeed( 1 ); } );
	const baselineSeedCapture = await page.evaluate( () => window.__labController.capturePixels( 'final' ) );
	await writeFile( resolve( options.output, 'images/seed-0001.final.png' ), pngFromCapture( baselineSeedCapture ) );
	await page.evaluate( () => window.__labController.setSeed( 0x9e3779b9 ) );
	const stressSeedCapture = await page.evaluate( () => window.__labController.capturePixels( 'final' ) );
	await writeFile( resolve( options.output, 'images/seed-9e3779b9.final.png' ), pngFromCapture( stressSeedCapture ) );
	await page.evaluate( async () => {

		await window.__labController.setSeed( 1 );
		await window.__labController.setScenario( 'emitter' );
		await window.__labController.resetMeterState( 'mask-baseline' );
		for ( let frame = 0; frame < 8; frame += 1 ) await window.__labController.step( 1 / 60 );

	} );
	const maskBaselineCapture = await page.evaluate( () => window.__labController.capturePixels( 'final' ) );
	await writeFile( resolve( options.output, 'images/mask-baseline.final.png' ), pngFromCapture( maskBaselineCapture ) );
	const maskBaselineReadback = await page.evaluate( () => window.__labController.getExposureReadback() );
	await page.evaluate( async () => {

		await window.__labController.setScenario( 'masked-ui' );
		await window.__labController.resetMeterState( 'masked-ui' );
		for ( let frame = 0; frame < 8; frame += 1 ) await window.__labController.step( 1 / 60 );

	} );
	const maskedUiCapture = await page.evaluate( () => window.__labController.capturePixels( 'final' ) );
	await writeFile( resolve( options.output, 'images/masked-ui.final.png' ), pngFromCapture( maskedUiCapture ) );
	const maskedUiReadback = await page.evaluate( () => window.__labController.getExposureReadback() );
	await page.evaluate( async () => {

		await window.__labController.setScenario( 'gray-card' );
		await window.__labController.setMode( 'final' );
		for ( let frame = 0; frame < 180; frame += 1 ) await window.__labController.step( 1 / 60 );

	} );
	const grayCapture = await page.evaluate( () => window.__labController.capturePixels( 'final' ) );
	await writeFile( resolve( options.output, 'images/gray-card.final.png' ), pngFromCapture( grayCapture ) );
	const grayReadback = await page.evaluate( () => window.__labController.getExposureReadback() );
	await page.evaluate( async () => {

		await window.__labController.setScenario( 'bright-window' );
		for ( let frame = 0; frame < 60; frame += 1 ) await window.__labController.step( 1 / 60 );

	} );
	const brightCapture = await page.evaluate( () => window.__labController.capturePixels( 'final' ) );
	await writeFile( resolve( options.output, 'images/adaptation.bright.png' ), pngFromCapture( brightCapture ) );
	const brightReadback = await page.evaluate( () => window.__labController.getExposureReadback() );
	await page.evaluate( async () => {

		await window.__labController.setScenario( 'gray-card' );
		for ( let frame = 0; frame < 180; frame += 1 ) await window.__labController.step( 1 / 60 );

	} );
	const recoveryCapture = await page.evaluate( () => window.__labController.capturePixels( 'final' ) );
	await writeFile( resolve( options.output, 'images/adaptation.recovery.png' ), pngFromCapture( recoveryCapture ) );
	const recoveryReadback = await page.evaluate( () => window.__labController.getExposureReadback() );
	await writeFile( resolve( options.output, 'exposure-readback.json' ), `${ JSON.stringify( {
		profile: options.profile,
		fixture: 'scene-linear-unlit-0.18-gray-card',
		cpuOracle: { keyLuminance: 0.18, targetEV: 0 },
		gray: grayReadback,
		bright: brightReadback,
		recovery: recoveryReadback,
		maskBaseline: maskBaselineReadback,
		maskedUi: maskedUiReadback
	}, null, 2 ) }\n` );
	const [ pipeline, resources, metrics ] = await page.evaluate( () => [
		window.__labController.describePipeline(),
		window.__labController.describeResources(),
		window.__labController.getMetrics()
	] );
	await writeFile( resolve( options.output, 'pipeline-graph.json' ), `${ JSON.stringify( pipeline, null, 2 ) }\n` );
	await writeFile( resolve( options.output, 'storage-resources.json' ), `${ JSON.stringify( resources, null, 2 ) }\n` );
	await writeFile( resolve( options.output, 'mechanism-metrics.json' ), `${ JSON.stringify( { ...metrics, captureProfile: options.profile }, null, 2 ) }\n` );
	await writeFile( resolve( options.output, 'capture-contract.json' ), `${ JSON.stringify( {
		schemaVersion: 2,
		profile: options.profile,
		url,
		viewport: { ...viewport, dpr: 1 },
		calibrationFixture: 'scene-linear-unlit-0.18-gray-card',
		performanceVerdict: 'INSUFFICIENT_EVIDENCE until named-adapter timestamps are accepted'
	}, null, 2 ) }\n` );

} finally {

	await browser?.close();
	await server?.close();

}
