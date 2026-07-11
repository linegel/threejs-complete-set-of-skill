import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	ARTIFACT_RELATIVE_DIR,
	CAPTURE_PROFILE,
	FIXED_SEED
} from './artifact-config.js';
import { createRgbaPng } from '../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js';

const here = dirname( fileURLToPath( import.meta.url ) );
const repoRoot = resolve( here, '../../..' );
const artifactDir = resolve( repoRoot, ARTIFACT_RELATIVE_DIR );
const pagePath = '/threejs-image-pipeline/examples/webgpu-image-pipeline/index.html';

const DIAGNOSTIC_MOSAIC_MODES = Object.freeze( [
	'normal',
	'emissive',
	'linear depth',
	'AO.r',
	'bloom contribution',
	'pre-tone-map HDR'
] );

const mimeTypes = new Map( [
	[ '.html', 'text/html; charset=utf-8' ],
	[ '.js', 'text/javascript; charset=utf-8' ],
	[ '.mjs', 'text/javascript; charset=utf-8' ],
	[ '.json', 'application/json; charset=utf-8' ],
	[ '.png', 'image/png' ],
	[ '.css', 'text/css; charset=utf-8' ]
] );

function parseArgs( argv ) {

	const options = { headed: false, port: 0 };

	for ( let i = 0; i < argv.length; i ++ ) {

		const arg = argv[ i ];
		if ( arg === '--headed' ) options.headed = true;
		else if ( arg === '--port' ) options.port = Number( argv[ ++ i ] );
		else throw new Error( `Unknown argument: ${ arg }` );

	}

	return options;

}

function serveStatic( root ) {

	const server = createServer( ( request, response ) => {

		const url = new URL( request.url ?? '/', 'http://127.0.0.1' );
		const decoded = decodeURIComponent( url.pathname );
		const normalized = decoded === '/' ? pagePath : decoded;
		const path = resolve( root, `.${ normalized }` );

		if ( ! path.startsWith( root ) || ! existsSync( path ) ) {

			response.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
			response.end( 'not found' );
			return;

		}

		response.writeHead( 200, { 'content-type': mimeTypes.get( extname( path ) ) ?? 'application/octet-stream' } );
		createReadStream( path ).pipe( response );

	} );

	return server;

}

async function writeJson( path, value ) {

	await writeFile( path, `${ JSON.stringify( value, null, 2 ) }\n` );

}

async function captureRgba( page, state ) {

	const capture = await page.evaluate(
		async ( nextState ) => window.__imagePipelineValidation.capturePixels( nextState ),
		state
	);
	const pixels = Uint8Array.from( capture.pixels );
	const rowBytes = capture.width * CAPTURE_PROFILE.readbackBytesPerTexel;
	const bytesPerRow = Number.isFinite( capture.bytesPerRow ) ? capture.bytesPerRow : rowBytes;

	if ( ! Number.isInteger( bytesPerRow ) || bytesPerRow < rowBytes ) {

		throw new Error( `Invalid capture stride ${ bytesPerRow } for ${ capture.width }x${ capture.height } readback.` );

	}

	return { width: capture.width, height: capture.height, bytesPerRow, pixels };

}

function sampleCapturePixel( capture, x, y ) {

	const sourceY = capture.height - 1 - y;
	const offset = sourceY * capture.bytesPerRow + x * CAPTURE_PROFILE.readbackBytesPerTexel;
	return Array.from( capture.pixels.subarray( offset, offset + CAPTURE_PROFILE.readbackBytesPerTexel ) );

}

async function captureImage( page, imagePath, state ) {

	const capture = await captureRgba( page, state );
	const png = createRgbaPng( capture.width, capture.height, ( x, y ) => sampleCapturePixel( capture, x, y ) );
	await writeFile( resolve( artifactDir, imagePath ), png );

}

async function captureDiagnosticMosaic( page, imagePath, baseState ) {

	const captures = [];

	for ( const mode of DIAGNOSTIC_MOSAIC_MODES ) {

		captures.push( await captureRgba( page, { ...baseState, mode } ) );

	}

	const width = captures[ 0 ].width;
	const height = captures[ 0 ].height;
	const columns = Math.ceil( Math.sqrt( captures.length ) );
	const rows = Math.ceil( captures.length / columns );
	const tileWidth = Math.floor( width / columns );
	const tileHeight = Math.floor( height / rows );
	const png = createRgbaPng( width, height, ( x, y ) => {

		const tileX = Math.min( columns - 1, Math.floor( x / tileWidth ) );
		const tileY = Math.min( rows - 1, Math.floor( y / tileHeight ) );
		const tileIndex = tileY * columns + tileX;
		const capture = captures[ tileIndex ];
		const localWidth = tileX === columns - 1 ? width - tileWidth * ( columns - 1 ) : tileWidth;
		const localHeight = tileY === rows - 1 ? height - tileHeight * ( rows - 1 ) : tileHeight;
		const localX = x - tileX * tileWidth;
		const localY = y - tileY * tileHeight;
		const sourceX = Math.min( capture.width - 1, Math.floor( localX * capture.width / localWidth ) );
		const sourceY = Math.min( capture.height - 1, Math.floor( localY * capture.height / localHeight ) );

		return sampleCapturePixel( capture, sourceX, sourceY );

	} );

	await writeFile( resolve( artifactDir, imagePath ), png );

}

async function validateBundle() {

	const child = spawn(
		process.execPath,
		[ resolve( here, 'validate-image-pipeline-artifacts.mjs' ), '--require-artifacts', '--artifact-dir', artifactDir ],
		{ cwd: repoRoot, stdio: 'inherit' }
	);
	const [ code ] = await once( child, 'exit' );
	if ( code !== 0 ) throw new Error( 'image-pipeline artifact validation failed' );

}

async function main() {

	const options = parseArgs( process.argv.slice( 2 ) );
	const { chromium } = await import( 'playwright' );
	const server = serveStatic( repoRoot );

	server.listen( options.port, '127.0.0.1' );
	await once( server, 'listening' );

	const address = server.address();
	const baseUrl = `http://127.0.0.1:${ address.port }`;
	const browser = await chromium.launch( {
		headless: ! options.headed,
		args: [
			'--enable-unsafe-webgpu',
			'--enable-features=Vulkan,UseSkiaRenderer',
			'--disable-gpu-sandbox'
		]
	} );

	try {

		await mkdir( resolve( artifactDir, 'images' ), { recursive: true } );
		const context = await browser.newContext( {
			viewport: CAPTURE_PROFILE.viewport,
			deviceScaleFactor: CAPTURE_PROFILE.dpr
		} );
		const page = await context.newPage();

		page.on( 'console', ( message ) => {

			if ( message.type() === 'error' ) console.error( message.text() );

		} );

		await page.goto( `${ baseUrl }${ pagePath }`, { waitUntil: 'networkidle' } );
		await page.waitForFunction( () => window.__imagePipelineValidation !== undefined, null, { timeout: 30000 } );

		const pageState = await page.evaluate( () => ( {
			ready: window.__imagePipelineValidation.ready,
			error: window.__imagePipelineValidation.error ?? null
		} ) );
		if ( pageState.ready !== true ) throw new Error( pageState.error ?? 'Image-pipeline validation page did not become ready.' );

		await page.evaluate( () => {

			document.getElementById( 'status' ).style.display = 'none';

		} );

		const captures = [
			[ 'images/final.design.png', { mode: 'final', camera: 'design', timeSeconds: 0, frame: 0 } ],
			[ 'images/no-post.design.png', { mode: 'no-post', camera: 'design', timeSeconds: 0, frame: 0 } ],
			[ 'images/diagnostics.mosaic.png', { mode: 'diagnostics', camera: 'design', timeSeconds: 0, frame: 0 } ],
			[ 'images/camera.near.png', { mode: 'final', camera: 'near', timeSeconds: 0, frame: 0 } ],
			[ 'images/camera.design.png', { mode: 'final', camera: 'design', timeSeconds: 0, frame: 0 } ],
			[ 'images/camera.far.png', { mode: 'final', camera: 'far', timeSeconds: 0, frame: 0 } ],
			// Legacy filenames required by the shared schema. These are authored
			// deterministic time variants, not random-seed or temporal-AA proof.
			[ 'images/seed-0001.final.png', { mode: 'final', camera: 'design', timeSeconds: 0.25, frame: 8, variantLabel: 'authored-time-0.25' } ],
			[ 'images/seed-stress.final.png', { mode: 'final', camera: 'design', timeSeconds: 1.1, frame: 33, variantLabel: 'authored-time-1.1' } ],
			[ 'images/AO.static.png', { mode: 'AO.r', camera: 'design', timeSeconds: 0, frame: 0 } ],
			[ 'images/bloom.static.png', { mode: 'bloom contribution', camera: 'design', timeSeconds: 0, frame: 0 } ],
			[ 'images/normal.static.png', { mode: 'normal', camera: 'design', timeSeconds: 0, frame: 0 } ],
			[ 'images/emissive.static.png', { mode: 'emissive', camera: 'design', timeSeconds: 0, frame: 0 } ],
			[ 'images/linear-depth.static.png', { mode: 'linear depth', camera: 'design', timeSeconds: 0, frame: 0 } ],
			[ 'images/pre-tone-map.static.png', { mode: 'pre-tone-map HDR', camera: 'design', timeSeconds: 0, frame: 0 } ]
		];

		for ( const [ imagePath, state ] of captures ) {

			if ( imagePath === 'images/diagnostics.mosaic.png' ) await captureDiagnosticMosaic( page, imagePath, state );
			else await captureImage( page, imagePath, state );

		}

		const evidence = await page.evaluate( () => window.__imagePipelineValidation.getEvidence() );
		await writeJson( resolve( artifactDir, 'visual-contract.json' ), evidence.visualContract );
		await writeJson( resolve( artifactDir, 'evidence-manifest.json' ), evidence.evidenceManifest );
		await writeJson( resolve( artifactDir, 'renderer-info.json' ), evidence.rendererInfo );
		await writeJson( resolve( artifactDir, 'render-targets.json' ), evidence.renderTargets );
		await writeJson( resolve( artifactDir, 'storage-resources.json' ), evidence.storageResources );
		await writeJson( resolve( artifactDir, 'timings.json' ), evidence.timings );
		await writeJson( resolve( artifactDir, 'leak-loop.json' ), evidence.leakLoop );

		await validateBundle();
		console.log( `Image-pipeline evidence written to ${ artifactDir } (seed label ${ FIXED_SEED })` );

	} finally {

		await browser.close().catch( () => {} );
		await new Promise( ( resolveClose ) => server.close( resolveClose ) );

	}

}

main().catch( ( error ) => {

	console.error( error.message );
	process.exitCode = 1;

} );
