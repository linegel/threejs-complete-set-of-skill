import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createRgbaPng } from './png.js';

function option( name, fallback ) {

	const index = process.argv.indexOf( name );
	return index === -1 ? fallback : process.argv[ index + 1 ];

}

async function getPlaywright() {

	try {

		return await import( 'playwright' );

	} catch {

		throw new Error( 'Playwright is required by the root browser toolchain before running capture.' );

	}

}

function encodeCapturePng( capture ) {

	const pixels = Buffer.from( capture.base64, 'base64' );
	const expected = capture.width * capture.height * 4;
	if ( pixels.byteLength !== expected ) throw new Error( `Capture payload ${ pixels.byteLength } != ${ expected } bytes.` );
	return createRgbaPng( capture.width, capture.height, ( x, y ) => {

		const offset = ( y * capture.width + x ) * 4;
		return [ pixels[ offset ], pixels[ offset + 1 ], pixels[ offset + 2 ], pixels[ offset + 3 ] ];

	} );

}

function encodeDiagnosticMosaic( captures ) {

	const entries = [ captures.final, captures.noPost, captures.normal, captures.emissive ];
	const width = captures.final.width;
	const height = captures.final.height;
	const decoded = entries.map( ( entry ) => Buffer.from( entry.base64, 'base64' ) );
	return createRgbaPng( width, height, ( x, y ) => {

		const column = x >= width / 2 ? 1 : 0;
		const row = y >= height / 2 ? 1 : 0;
		const index = row * 2 + column;
		const localX = Math.min( width - 1, Math.floor( ( x % Math.ceil( width / 2 ) ) * 2 ) );
		const localY = Math.min( height - 1, Math.floor( ( y % Math.ceil( height / 2 ) ) * 2 ) );
		const offset = ( localY * width + localX ) * 4;
		const pixels = decoded[ index ];
		return [ pixels[ offset ], pixels[ offset + 1 ], pixels[ offset + 2 ], pixels[ offset + 3 ] ];

	} );

}

async function capture( page, configuration ) {

	return page.evaluate( async ( next ) => {

		const controller = window.__THREEJS_LAB__;
		if ( controller === undefined ) throw new Error( 'window.__THREEJS_LAB__ is unavailable.' );
		if ( next.width !== undefined ) await controller.resize( next.width, next.height, next.dpr );
		if ( next.tier !== undefined ) await controller.setTier( next.tier );
		if ( next.camera !== undefined ) await controller.setCamera( next.camera );
		if ( next.seed !== undefined ) await controller.setSeed( next.seed );
		if ( next.time !== undefined ) await controller.setTime( next.time );
		if ( next.step !== undefined ) await controller.step( next.step );
		if ( next.reset !== undefined ) await controller.resetHistory( next.reset );
		await controller.setMode( next.mode );
		await controller.renderOnce();
		const result = await controller.capturePixels( next.mode );
		let binary = '';
		const chunkSize = 0x8000;
		for ( let offset = 0; offset < result.pixels.length; offset += chunkSize ) {

			binary += String.fromCharCode( ...result.pixels.subarray( offset, offset + chunkSize ) );

		}
		return {
			width: result.width,
			height: result.height,
			format: result.format,
			readbackLayout: result.readbackLayout,
			sourceByteLength: result.sourceByteLength,
			base64: btoa( binary )
		};

	}, configuration );

}

const url = option( '--url', 'http://127.0.0.1:4173/threejs-visual-validation/examples/webgpu-validation-harness/' );
const outputDir = resolve( option( '--out', '/tmp/threejs-visual-validation-browser-capture' ) );
const { chromium } = await getPlaywright();
const browser = await chromium.launch( {
	headless: true,
	args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--disable-gpu-sandbox' ]
} );

try {

	const page = await browser.newPage( { viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 } );
	await page.goto( url, { waitUntil: 'networkidle' } );
	await page.waitForFunction( () => document.documentElement.dataset.ready === 'true' );
	await mkdir( resolve( outputDir, 'images' ), { recursive: true } );

	const common = { width: 1200, height: 800, dpr: 1, tier: 'webgpu-correctness', camera: 'design', seed: 0x00000001, time: 0 };
	const final = await capture( page, { ...common, mode: 'final' } );
	const noPost = await capture( page, { ...common, mode: 'no-post' } );
	const normal = await capture( page, { ...common, mode: 'normal' } );
	const emissive = await capture( page, { ...common, mode: 'emissive' } );

	const captures = {
		'final.design.png': final,
		'no-post.design.png': noPost,
		'camera.near.png': await capture( page, { ...common, camera: 'near', mode: 'final' } ),
		'camera.design.png': await capture( page, { ...common, mode: 'final' } ),
		'camera.far.png': await capture( page, { ...common, camera: 'far', mode: 'final' } ),
		'seed-0001.final.png': await capture( page, { ...common, seed: 0x00000001, mode: 'final' } ),
		'seed-9e3779b9.final.png': await capture( page, { ...common, seed: 0x9e3779b9, mode: 'final' } ),
		'temporal.t000.png': await capture( page, { ...common, reset: 'browser-capture', time: 0, mode: 'final' } ),
		'temporal.t001.png': await capture( page, { ...common, step: 1 / 60, mode: 'final' } )
	};

	for ( const [ name, result ] of Object.entries( captures ) ) {

		await writeFile( resolve( outputDir, 'images', name ), encodeCapturePng( result ) );

	}
	await writeFile( resolve( outputDir, 'images', 'diagnostics.mosaic.png' ), encodeDiagnosticMosaic( { final, noPost, normal, emissive } ) );

	const oddSize = await capture( page, { width: 641, height: 359, dpr: 1, tier: 'webgpu-correctness', camera: 'design', seed: 0x00000001, time: 0, mode: 'final' } );
	const runtime = await page.evaluate( async () => {

		const controller = window.__THREEJS_LAB__;
		return {
			pipeline: controller.describePipeline(),
			resources: controller.describeResources(),
			metrics: controller.getMetrics(),
			gpuTiming: typeof controller.resolveGpuTimings === 'function' ? await controller.resolveGpuTimings() : { verdict: 'INSUFFICIENT_EVIDENCE', reason: 'subject exposes no timing resolver' }
		};

	} );
	runtime.captureSource = 'render-target readback';
	runtime.oddSizeReadback = { width: oddSize.width, height: oddSize.height, layout: oddSize.readbackLayout, sourceByteLength: oddSize.sourceByteLength };
	runtime.acceptanceStatus = 'incomplete-until-v2-artifact-assembly-and-lifecycle-run';
	await writeFile( resolve( outputDir, 'runtime-snapshot.json' ), `${ JSON.stringify( runtime, null, 2 ) }\n` );

	console.log( JSON.stringify( { outputDir, source: 'render-target readback', gpuTiming: runtime.gpuTiming, acceptanceStatus: runtime.acceptanceStatus }, null, 2 ) );

} finally {

	await browser.close();

}
