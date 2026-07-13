import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const FALLBACK_CAPTURE_POLICY = 'explicit-fallback-harness';
const here = dirname( fileURLToPath( import.meta.url ) );
const repoRoot = resolve( here, '../../..' );

function argument( name, fallback = null ) {

	const index = process.argv.indexOf( name );
	return index >= 0 ? process.argv[ index + 1 ] : fallback;

}

function sha256( value ) {

	return createHash( 'sha256' ).update( value ).digest( 'hex' );

}

const profile = argument( '--profile', 'correctness' );
if ( ! [ 'correctness', 'performance' ].includes( profile ) ) throw new Error( `Unknown capture profile ${ profile }.` );
const canonicalEvidencePath = resolve( argument(
	'--canonical-evidence',
	process.env.FALLBACK_CANONICAL_EVIDENCE
		?? resolve( repoRoot, 'artifacts/visual-validation/webgpu-bounded-water/correctness/evidence-manifest.json' )
) );
const defaultEvidenceDir = resolve( repoRoot, 'artifacts/visual-validation/browser-fallback-harness', profile );
const outputDir = resolve( argument( '--output', process.env.FALLBACK_EVIDENCE_DIR ?? defaultEvidenceDir ) );

await capture();

async function capture() {

	const canonicalEvidence = await readFile( canonicalEvidencePath ).catch( () => {

		throw new Error( `INSUFFICIENT_EVIDENCE: fallback comparison requires accepted bounded-water evidence at ${ canonicalEvidencePath }.` );

	} );
	const server = await createServer( {
		root: repoRoot,
		appType: 'mpa',
		logLevel: 'error',
		server: { host: '127.0.0.1', port: 0, strictPort: false }
	} );
	await server.listen();
	const baseUrl = server.resolvedUrls?.local?.[ 0 ];
	if ( ! baseUrl ) throw new Error( 'Fallback capture server did not expose a local URL.' );
	const { chromium } = await import( 'playwright' );
	const browser = await chromium.launch( { headless: true } );
	const viewport = profile === 'performance' ? { width: 1920, height: 1080 } : { width: 1200, height: 800 };
	const page = await browser.newPage( { viewport, deviceScaleFactor: 1 } );
	// Teaching capture must exercise the unavailable-WebGPU path on hosts that still
	// have native WebGPU. Force the probe onto the WebGL backend (not a silent
	// production fallback path — only this lab-owned capture surface).
	await page.addInitScript( () => {
		globalThis.__FALLBACK_FORCE_WEBGL_PROBE__ = true;
	} );
	const routeRoot = new URL( 'threejs-compatibility-fallbacks/examples/browser-fallback-harness/', baseUrl.endsWith( '/' ) ? baseUrl : `${ baseUrl }/` );
	await mkdir( outputDir, { recursive: true } );

	try {

		await page.goto( new URL( 'scenario/blocked-default/', routeRoot ).href, { waitUntil: 'networkidle' } );
		await page.waitForFunction( () => globalThis.labController?.getMetrics );
		const blocker = await page.evaluate( () => globalThis.labController.getMetrics() );
		if ( blocker.liveCapabilities?.tested !== true ) throw new Error( 'Backend capability probe did not complete.' );
		if ( blocker.liveCapabilities.webgpu !== false ) throw new Error( 'Capture target has native WebGPU; compatibility teaching remains inactive.' );
		await page.screenshot( { path: resolve( outputDir, 'blocked-default.page.png' ) } );

		const branchIds = [ 'precomputed-static', 'cpu-offline', 'feature-removed', 'maintained-legacy' ];
		const branches = [];
		for ( const branchId of branchIds ) {

			await page.goto( new URL( `scenario/${ branchId }/`, routeRoot ).href, { waitUntil: 'networkidle' } );
			await page.waitForFunction( () => globalThis.labController?.getMetrics );
			const before = await page.evaluate( () => globalThis.labController.getMetrics() );
			if ( before.explicitRequest !== false || before.result?.details?.activated === true ) throw new Error( `${ branchId } activated before explicit request.` );
			await page.getByRole( 'button', { name: 'Explicitly request this fallback teaching' } ).click();
			await page.waitForFunction( () => globalThis.labController?.getMetrics().explicitRequest === true );
			await page.waitForFunction( () => globalThis.labController?.getMetrics().result?.details?.activated === true );
			const after = await page.evaluate( () => globalThis.labController.getMetrics() );
			if ( after.compatibilityRuntime?.isWebGPUBackend !== false ) throw new Error( `${ branchId } did not initialize the isolated compatibility backend.` );

			const screenshots = [];
			for ( const target of [ 'canonical-reference', 'selected-branch', 'error-map' ] ) {

				const filename = `${ branchId }.${ target }.png`;
				await page.locator( `canvas[data-target="${ target }"]` ).screenshot( { path: resolve( outputDir, filename ) } );
				screenshots.push( filename );

			}
			const pixels = await page.evaluate( async () => {

				const result = {};
				for ( const target of [ 'canonical-reference', 'selected-branch', 'error-map' ] ) {

					const capture = await globalThis.labController.capturePixels( target );
					result[ target ] = { width: capture.width, height: capture.height, pixels: Array.from( capture.pixels ) };

				}
				return result;

			} );
			branches.push( {
				id: branchId,
				before,
				after,
				screenshots,
				pixelHashes: Object.fromEntries( Object.entries( pixels ).map( ( [ target, capture ] ) => [ target, sha256( Buffer.from( capture.pixels ) ) ] ) )
			} );

		}

		const summary = {
			schemaVersion: 2,
			labId: 'browser-fallback-harness',
			capturePolicy: FALLBACK_CAPTURE_POLICY,
			profile,
			viewport,
			capturedAt: new Date().toISOString(),
			target: blocker.liveCapabilities,
			canonicalEvidence: { path: resolve( canonicalEvidencePath ), sha256: sha256( canonicalEvidence ) },
			blocker,
			branches
		};
		await writeFile( resolve( outputDir, 'capture-summary.json' ), `${ JSON.stringify( summary, null, 2 ) }\n` );
		console.log( JSON.stringify( { status: 'CAPTURED', outputDir, branches: branchIds }, null, 2 ) );

	} finally {

		await browser.close();
		await server.close();

	}

}
