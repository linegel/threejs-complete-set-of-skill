import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { encodeRgbaPng } from '../../../../scripts/lib/png-rgba.mjs';
import { validateUnifiedV2ArtifactBundle } from './evidence-bundle-v2.js';
import { canonicalSha256, NORMATIVE_JSON_PATHS } from './evidence-manifest-contract.js';
import { correctnessCaptureRequest, parseCorrectnessCaptureArgs } from './capture-correctness.js';
import { RAW_IMAGE_PATHS, finalizeRawCorrectnessCapture } from './raw-capture-manifest.js';

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

function png( index, width, height ) {

	const data = new Uint8Array( width * height * 4 );
	for ( let y = 0; y < height; y ++ ) for ( let x = 0; x < width; x ++ ) {

		const offset = ( y * width + x ) * 4;
		data.set( [
			( x + index * 17 ) & 0xff,
			( y * 3 + index * 29 ) & 0xff,
			( ( x >> 3 ) ^ ( y >> 3 ) ^ ( index * 31 ) ) & 0xff,
			255
		], offset );

	}
	return encodeRgbaPng( { width, height, data } );

}

async function createRawSessionFixture() {

	const outputDir = await mkdtemp( join( tmpdir(), 'threejs-raw-capture-manifest-' ) );
	const artifactWrites = [];
	let sequence = 0;
	const write = async ( path, bytes, kind = 'hook-artifact' ) => {

		const payload = Buffer.isBuffer( bytes ) ? bytes : Buffer.from( bytes );
		await writeFile( join( outputDir, path ), payload );
		artifactWrites.push( {
			sequence: ++ sequence,
			path,
			kind,
			existedBefore: false,
			contentBinding: 'sha256-byte-length-immutable-buffer-v1',
			sha256: sha256( payload ),
			byteLength: payload.byteLength
		} );

	};
	for ( const path of NORMATIVE_JSON_PATHS ) {

		if ( path === 'evidence-manifest.json' ) continue;
		const artifact = path === 'pipeline-graph.json' ? {
			schemaVersion: 2,
			owners: { renderer: 'validation-subject', renderPipeline: 'validation-subject' },
			signals: [],
			sceneSubmissions: [],
			computeDispatches: [],
			resources: [],
			finalToneMapOwner: 'renderOutput',
			finalOutputTransformOwner: 'renderOutput'
		} : { schemaVersion: 2 };
		await write( path, `${ JSON.stringify( artifact ) }\n` );

	}
	for ( const [ index, path ] of RAW_IMAGE_PATHS.entries() ) {

		const [ width, height ] = path === 'odd-size.final.png' ? [ 641, 359 ] : [ 1200, 800 ];
		await write( path, png( index, width, height ), path === 'diagnostics.mosaic.png' ? 'hook-artifact' : 'capture-png' );

	}
	await write( 'capture-boundary.json', `${ JSON.stringify( { schemaVersion: 2, publishable: false } ) }\n` );
	const sourceClosureHash = canonicalSha256( { source: 'raw-capture-test' } );
	const buildRevision = canonicalSha256( { build: 'raw-capture-test' } );
	const metrics = {
		initialized: true,
		nativeWebGPU: true,
		rendererBackendEvidence: {
			isWebGPUBackend: true,
			deviceIdentityVerified: true,
			deviceIdentitySource: 'strict identity equality between requested GPUDevice and renderer.backend.device after renderer.init()'
		},
		rendererDeviceGeneration: 1,
		adapter: { features: [ 'timestamp-query' ] },
		rendererState: { outputColorSpace: 'srgb', toneMapping: 'NeutralToneMapping' },
		scenario: 'browser-capture',
		mode: 'final',
		tier: 'webgpu-correctness',
		camera: 'design',
		seed: 1,
		seedHex: '0x00000001',
		timeSeconds: 0
	};
	const session = {
		labId: 'webgpu-validation-harness',
		profile: 'correctness',
		automationSurface: 'playwright-headless-chromium',
		adapterClass: 'software',
		adapterIdentity: { vendor: 'fixture', architecture: 'software' },
		browser: { name: 'Chromium', version: 'fixture', platform: 'fixture-os' },
		sourceClosureHash,
		buildRevision,
		startedAt: '2026-07-12T12:00:00.000Z',
		finishedAt: '2026-07-12T12:01:00.000Z',
		finalRuntime: { metrics },
		artifactWrites,
		hookResult: {
			bundle: {
				claimVerdicts: {
					mechanismCorrectness: 'PASS',
					lifecycleStability: 'PASS'
				}
			},
			standardOutputs: [ {
				filename: 'diagnostics.mosaic.png',
				sourceCaptures: [ 'final.design.png', 'no-post.design.png', 'diagnostic.normal.png', 'diagnostic.emissive.png' ],
				derivation: { algorithm: 'quadrant-copy' }
			} ]
		}
	};
	artifactWrites.push( {
		sequence: ++ sequence,
		path: 'capture-session.json',
		kind: 'capture-session-record',
		existedBefore: false,
		contentBinding: 'self-excluded-finalized-offline',
		sha256: null,
		byteLength: null
	} );
	const sessionBytes = Buffer.from( `${ JSON.stringify( session, null, 2 ) }\n` );
	await writeFile( join( outputDir, 'capture-session.json' ), sessionBytes );
	Object.defineProperty( session, 'finalizedCaptureSessionFile', {
		value: {
			path: 'capture-session.json',
			contentBinding: 'finalized-file-hash-for-offline-promotion',
			sha256: sha256( sessionBytes ),
			byteLength: sessionBytes.byteLength
		}
	} );
	return { outputDir, session };

}

async function replaceImageAndRebind( outputDir, path, bytes ) {

	await writeFile( join( outputDir, path ), bytes );
	const manifestPath = join( outputDir, 'evidence-manifest.json' );
	const manifest = JSON.parse( await readFile( manifestPath, 'utf8' ) );
	const image = manifest.images.find( ( entry ) => entry.path === path );
	image.sha256 = sha256( bytes );
	image.byteLength = bytes.byteLength;
	await writeFile( manifestPath, `${ JSON.stringify( manifest, null, 2 ) }\n` );

}

async function replaceFileAndRebind( outputDir, path, bytes ) {

	await writeFile( join( outputDir, path ), bytes );
	const manifestPath = join( outputDir, 'evidence-manifest.json' );
	const manifest = JSON.parse( await readFile( manifestPath, 'utf8' ) );
	const file = manifest.files.find( ( entry ) => entry.path === path );
	file.sha256 = sha256( bytes );
	file.byteLength = bytes.byteLength;
	await writeFile( manifestPath, `${ JSON.stringify( manifest, null, 2 ) }\n` );

}

test( 'offline raw finalization binds the current correctness session without claiming publication', async () => {

	const { outputDir, session } = await createRawSessionFixture();
	const result = await finalizeRawCorrectnessCapture( session, outputDir );
	assert.equal( result.bundleKind, 'raw-capture-session' );
	assert.equal( result.publishable, false );
	assert.deepEqual( result.captureProfiles, [ 'correctness' ] );
	assert.equal( result.claimVerdicts.visualCorrectness, 'INSUFFICIENT_EVIDENCE' );
	assert.equal( result.claimVerdicts.mechanismCorrectness, 'PASS' );
	assert.equal( result.claimVerdicts.performanceCompliance, 'NOT_CLAIMED' );
	const manifest = JSON.parse( await readFile( join( outputDir, 'evidence-manifest.json' ), 'utf8' ) );
	assert.equal( manifest.files.find( ( file ) => file.path === 'evidence-manifest.json' ).status, 'self-excluded' );
	assert.equal( manifest.captureSessions[ 0 ].adapterClass, 'software' );
	assert.equal( manifest.images.find( ( image ) => image.path === 'diagnostics.mosaic.png' ).kind, 'derived-image' );

} );

test( 'raw finalization rejects a browser hook that prewrites the manifest', async () => {

	const { outputDir, session } = await createRawSessionFixture();
	session.artifactWrites.push( {
		sequence: session.artifactWrites.length + 1,
		path: 'evidence-manifest.json',
		kind: 'hook-artifact',
		contentBinding: 'sha256-byte-length-immutable-buffer-v1',
		sha256: canonicalSha256( { stale: true } ),
		byteLength: 1
	} );
	await assert.rejects( finalizeRawCorrectnessCapture( session, outputDir ), /must not write evidence-manifest/ );

} );

test( 'the correctness wrapper forwards only the deterministic capture lane', () => {

	assert.equal( parseCorrectnessCaptureArgs( [] ).profile, 'correctness' );
	assert.equal( parseCorrectnessCaptureArgs( [ '--profile', 'correctness', '--target', 'presentation' ] ).target, 'presentation' );
	const request = correctnessCaptureRequest( parseCorrectnessCaptureArgs( [] ) );
	assert.equal( request.browserEntryOverride, 'threejs-visual-validation/examples/webgpu-validation-harness/tier/webgpu-correctness/index.html' );
	assert.deepEqual( request.captureState, {
		tier: 'webgpu-correctness',
		mode: 'final',
		camera: 'design',
		seed: 1,
		timeSeconds: 0,
		scenario: 'browser-capture'
	} );
	assert.throws( () => parseCorrectnessCaptureArgs( [ '--profile', 'performance' ] ), /immutable Codex in-app Browser/ );
	assert.throws( () => parseCorrectnessCaptureArgs( [ '--profile' ] ), /requires a value/ );

} );

test( 'raw image mutations reject flat, pixel-aliased, and corrupt evidence after hash rebinding', async () => {

	{

		const { outputDir, session } = await createRawSessionFixture();
		await finalizeRawCorrectnessCapture( session, outputDir );
		const flat = encodeRgbaPng( {
			width: 1200,
			height: 800,
			data: new Uint8Array( 1200 * 800 * 4 ).fill( 32 )
		} );
		await replaceImageAndRebind( outputDir, 'final.design.png', flat );
		await assert.rejects( validateUnifiedV2ArtifactBundle( outputDir ), /blank or effectively flat/ );

	}
	{

		const { outputDir, session } = await createRawSessionFixture();
		await finalizeRawCorrectnessCapture( session, outputDir );
		const final = await readFile( join( outputDir, 'final.design.png' ) );
		await replaceImageAndRebind( outputDir, 'diagnostics.mosaic.png', final );
		await assert.rejects( validateUnifiedV2ArtifactBundle( outputDir ), /aliases decoded pixels/ );

	}
	{

		const { outputDir, session } = await createRawSessionFixture();
		await finalizeRawCorrectnessCapture( session, outputDir );
		const corrupt = Buffer.from( await readFile( join( outputDir, 'final.design.png' ) ) );
		corrupt[ corrupt.length - 8 ] ^= 1;
		await replaceImageAndRebind( outputDir, 'final.design.png', corrupt );
		await assert.rejects( validateUnifiedV2ArtifactBundle( outputDir ), /CRC mismatch/ );

	}

} );

test( 'a rehashed bare numeric claim cannot bypass recursive provenance', async () => {

	const { outputDir, session } = await createRawSessionFixture();
	await finalizeRawCorrectnessCapture( session, outputDir );
	const forged = Buffer.from( `${ JSON.stringify( { schemaVersion: 2, claimedGpuMs: 0 } ) }\n` );
	await replaceFileAndRebind( outputDir, 'visual-contract.json', forged );
	await assert.rejects( validateUnifiedV2ArtifactBundle( outputDir ), /unlabelled numeric value/ );

} );
