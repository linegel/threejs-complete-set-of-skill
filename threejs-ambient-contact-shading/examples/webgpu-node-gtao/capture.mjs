import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const here = dirname( fileURLToPath( import.meta.url ) );
const root = resolve( here, '../../..' );
const outputDir = resolve( process.env.LAB_ARTIFACT_DIR ?? resolve( root, 'artifacts/visual-validation/webgpu-node-gtao' ) );
const profileIndex = process.argv.indexOf( '--profile' );
const profile = profileIndex >= 0 ? process.argv[ profileIndex + 1 ] : 'correctness';
if ( ! [ 'correctness', 'performance' ].includes( profile ) ) throw new Error( `Unknown capture profile: ${ profile }` );

await mkdir( outputDir, { recursive: true } );
const server = await createServer( { root, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } } );
let browser;

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

try {

	await server.listen();
	const base = server.resolvedUrls?.local?.[ 0 ];
	if ( ! base ) throw new Error( 'Vite did not expose a local URL.' );
	browser = await chromium.launch( {
		headless: true,
		args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--disable-gpu-sandbox' ]
	} );
	const page = await browser.newPage( { viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 } );
	const browserErrors = [];
	page.on( 'pageerror', ( error ) => browserErrors.push( String( error.stack ?? error.message ) ) );
	await page.goto( new URL( 'threejs-ambient-contact-shading/examples/webgpu-node-gtao/index.html?capture=1', base ).href, { waitUntil: 'load' } );
	await page.waitForFunction( () => window.__LAB_CONTROLLER__ !== undefined || window.__LAB_ERROR__ !== undefined );
	const blocker = await page.evaluate( () => window.__LAB_ERROR__ ?? null );
	if ( blocker ) throw new Error( blocker );
	await page.evaluate( async () => window.__LAB_READY__ );

	await page.evaluate( async () => {

		const controller = window.__LAB_CONTROLLER__;
		await controller.resize( 1200, 800, 1 );
		await controller.setTier( 'ultra' );
		await controller.setScenario( 'wall-receiver' );
		await controller.setMode( 'final' );
		await controller.setCamera( 'design' );
		await controller.setSeed( 1 );
		await controller.setTime( 0 );

	} );

	const warmupFrames = profile === 'performance' ? 30 : 4;
	const cpuSubmissionSamples = await page.evaluate( async ( count ) => {

		const controller = window.__LAB_CONTROLLER__;
		const values = [];
		for ( let index = 0; index < count; index ++ ) {

			const start = performance.now();
			await controller.renderOnce();
			values.push( performance.now() - start );

		}
		return values;

	}, warmupFrames );

	const readbacks = [];
	async function captureRaw( id, target ) {

		const result = await page.evaluate( async ( captureTarget ) => {

			const capture = await window.__LAB_CONTROLLER__.capturePixels( captureTarget );
			let binary = '';
			for ( let offset = 0; offset < capture.data.length; offset += 0x8000 ) {

				binary += String.fromCharCode( ...capture.data.subarray( offset, offset + 0x8000 ) );

			}
			return { ...capture, data: undefined, base64: btoa( binary ) };

		}, target );
		const bytes = Buffer.from( result.base64, 'base64' );
		const filename = `${ id }.raw`;
		await writeFile( resolve( outputDir, filename ), bytes );
		readbacks.push( {
			id,
			target,
			file: filename,
			width: result.width,
			height: result.height,
			componentType: result.componentType,
			format: result.format,
			colorEncoding: result.colorEncoding,
			readbackRoute: result.readbackRoute,
			bytesPerTexel: { value: result.bytesPerTexel, unit: 'bytes/texel', label: 'Measured', source: 'WebGPU render-target readback metadata' },
			bytesPerRow: { value: result.bytesPerRow, unit: 'bytes', label: 'Measured', source: 'integer 256-byte-aligned WebGPU copy stride' },
			packedRowBytes: { value: result.packedRowBytes, unit: 'bytes', label: 'Measured', source: 'packed raw artifact row width' },
			byteLength: { value: bytes.byteLength, unit: 'bytes', label: 'Measured', source: 'written raw artifact' },
			sha256: sha256( bytes )
		} );

	}

	for ( const [ id, target ] of [
		[ 'final-lit-display', 'lit-output' ],
		[ 'no-ao-baseline-display', 'baseline-output' ],
		[ 'raw-gtao', 'raw-ao' ],
		[ 'reconstructed-gtao', 'denoised-ao' ],
		[ 'gbuffer-normal', 'normal' ],
		[ 'gbuffer-velocity', 'velocity' ]
	] ) await captureRaw( id, target );

	await page.evaluate( async () => window.__LAB_CONTROLLER__.resize( 641, 359, 1 ) );
	await captureRaw( 'odd-641x359-raw-gtao', 'raw-ao' );
	await page.evaluate( async () => window.__LAB_CONTROLLER__.resize( 1200, 800, 1 ) );

	const runtime = await page.evaluate( () => {

		const controller = window.__LAB_CONTROLLER__;
		const safe = ( value ) => JSON.parse( JSON.stringify( value, ( key, entry ) => typeof entry === 'bigint' ? entry.toString() : entry ) );
		return { metrics: safe( controller.getMetrics() ), pipeline: safe( controller.describePipeline() ), resources: safe( controller.describeResources() ) };

	} );
	if ( runtime.metrics.backend !== 'webgpu' ) throw new Error( 'Capture did not prove a native WebGPU backend.' );

	await writeFile( resolve( outputDir, 'renderer-info.json' ), `${ JSON.stringify( {
		schemaVersion: 2,
		renderer: 'WebGPURenderer',
		backend: { isWebGPUBackend: true },
		threeRevision: runtime.metrics.threeRevision,
		info: runtime.metrics.rendererInfo
	}, null, 2 ) }\n` );
	await writeFile( resolve( outputDir, 'pipeline-graph.json' ), `${ JSON.stringify( { schemaVersion: 2, candidate: true, ...runtime.pipeline }, null, 2 ) }\n` );
	await writeFile( resolve( outputDir, 'render-targets.json' ), `${ JSON.stringify( { schemaVersion: 2, readbacks }, null, 2 ) }\n` );
	await writeFile( resolve( outputDir, 'resident-resources.json' ), `${ JSON.stringify( { schemaVersion: 2, candidate: true, ...runtime.resources }, null, 2 ) }\n` );
	await writeFile( resolve( outputDir, 'mechanism-metrics.json' ), `${ JSON.stringify( {
		schemaVersion: 2,
		candidate: true,
		labId: 'webgpu-node-gtao',
		...runtime.metrics.acceptanceMetrics
	}, null, 2 ) }\n` );
	await writeFile( resolve( outputDir, 'capture-status.json' ), `${ JSON.stringify( {
		schemaVersion: 2,
		labId: 'webgpu-node-gtao',
		profile,
		captureKind: 'raw-render-target-candidate',
		claimVerdicts: {
			visualCorrectness: 'INSUFFICIENT_EVIDENCE',
			mechanismCorrectness: 'INSUFFICIENT_EVIDENCE',
			performanceCompliance: 'INSUFFICIENT_EVIDENCE',
			gpuAttribution: 'INSUFFICIENT_EVIDENCE',
			lifecycleStability: 'INSUFFICIENT_EVIDENCE'
		},
		cpuSubmissionSamples: { values: cpuSubmissionSamples, unit: 'ms', label: 'Measured', source: 'performance.now around render submission; not GPU completion' },
		gpuTimingVerdict: 'INSUFFICIENT_EVIDENCE',
		browserErrors,
		readbacks: readbacks.map( ( entry ) => entry.file ),
		resources: runtime.resources,
		note: 'No page screenshot is used as WebGPU proof. Raw readbacks require later color-managed PNG derivation and full v2 evidence capture.'
	}, null, 2 ) }\n` );
	console.log( JSON.stringify( { labId: 'webgpu-node-gtao', profile, outputDir: relative( root, outputDir ), rawReadbacks: readbacks.length, verdict: 'INSUFFICIENT_EVIDENCE' }, null, 2 ) );

} finally {

	await browser?.close();
	await server.close();

}
