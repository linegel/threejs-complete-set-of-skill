import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createRgbaPng } from './png.js';
import { writeDefaultEvidenceBundle } from './harness.js';
import { readJson, validateArtifactBundle } from './schema/artifact-schemas.js';

async function expectRejects( label, fn, pattern ) {

	try {

		await fn();

	} catch ( error ) {

		if ( pattern.test( error.message ) ) {

			return { label, rejected: true, message: error.message };

		}

		throw new Error( `${ label } rejected with unexpected message: ${ error.message }` );

	}

	throw new Error( `${ label } unexpectedly passed.` );

}

async function writeJson( path, data ) {

	await writeFile( path, `${ JSON.stringify( data, null, 2 ) }\n` );

}

async function makeBundle() {

	const dir = await mkdtemp( join( tmpdir(), 'threejs-visual-validation-' ) );
	await writeDefaultEvidenceBundle( dir );
	return dir;

}

async function testFinalOnlyContractRejects() {

	const dir = await makeBundle();

	try {

		const contractPath = join( dir, 'visual-contract.json' );
		const contract = await readJson( contractPath );
		contract.requiredImages = [ 'images/final.design.png' ];
		await writeJson( contractPath, contract );

		return await expectRejects(
			'final-only visual contract',
			() => validateArtifactBundle( dir ),
			/final-only|no-post/,
		);

	} finally {

		await rm( dir, { recursive: true, force: true } );

	}

}

async function testBlankPngRejects() {

	const dir = await makeBundle();

	try {

		const blank = createRgbaPng( 16, 16, () => [ 0, 0, 0, 255 ] );
		await writeFile( join( dir, 'images/no-post.design.png' ), blank );

		return await expectRejects(
			'blank no-post PNG',
			() => validateArtifactBundle( dir ),
			/blank|flat/,
		);

	} finally {

		await rm( dir, { recursive: true, force: true } );

	}

}

async function testGpuTimingLabelRejects() {

	const dir = await makeBundle();

	try {

		const timingsPath = join( dir, 'timings.json' );
		const timings = JSON.parse( await readFile( timingsPath, 'utf8' ) );
		timings.gpuTimingLabel = '0 ms';
		await writeJson( timingsPath, timings );

		return await expectRejects(
			'unlabelled CPU-only GPU timing',
			() => validateArtifactBundle( dir ),
			/CPU-only proxy/,
		);

	} finally {

		await rm( dir, { recursive: true, force: true } );

	}

}

async function testGpuTimingTimestampRejects() {

	const dir = await makeBundle();

	try {

		const timingsPath = join( dir, 'timings.json' );
		const timings = JSON.parse( await readFile( timingsPath, 'utf8' ) );
		timings.gpuTimingUnavailable = false;
		timings.gpuTimingLabel = 'GPU timestamp';
		timings.gpuFrameMs = { median: 0, p95: 0, unit: 'ms' };
		timings.renderTimestampMs = null;
		await writeJson( timingsPath, timings );

		return await expectRejects(
			'GPU timing without render timestamp',
			() => validateArtifactBundle( dir ),
			/renderTimestampMs/,
		);

	} finally {

		await rm( dir, { recursive: true, force: true } );

	}

}

async function testManifestRequiredFieldRejects( field ) {

	const dir = await makeBundle();

	try {

		const manifestPath = join( dir, 'evidence-manifest.json' );
		const manifest = await readJson( manifestPath );
		delete manifest[ field ];
		await writeJson( manifestPath, manifest );

		return await expectRejects(
			`missing manifest ${ field }`,
			() => validateArtifactBundle( dir ),
			new RegExp( field ),
		);

	} finally {

		await rm( dir, { recursive: true, force: true } );

	}

}

async function testStaleReducedTierRejects() {

	const dir = await makeBundle();

	try {

		const manifestPath = join( dir, 'evidence-manifest.json' );
		const manifest = await readJson( manifestPath );
		manifest.qualityTier = 'reduced-precomputed';
		await writeJson( manifestPath, manifest );

		return await expectRejects(
			'stale reduced quality tier',
			() => validateArtifactBundle( dir ),
			/qualityTier/,
		);

	} finally {

		await rm( dir, { recursive: true, force: true } );

	}

}

async function testManualCameraRejects() {

	const dir = await makeBundle();

	try {

		const manifestPath = join( dir, 'evidence-manifest.json' );
		const manifest = await readJson( manifestPath );
		manifest.camera.manuallyOrbited = true;
		await writeJson( manifestPath, manifest );

		return await expectRejects(
			'manual camera evidence',
			() => validateArtifactBundle( dir ),
			/manually orbited|fixed camera/,
		);

	} finally {

		await rm( dir, { recursive: true, force: true } );

	}

}

async function testLeakDeltaRejects() {

	const dir = await makeBundle();

	try {

		const leakPath = join( dir, 'leak-loop.json' );
		const leakLoop = await readJson( leakPath );
		leakLoop.loops[ 0 ].deltas.textures = 1;
		leakLoop.loops[ 0 ].thresholds.textures = 0;
		await writeJson( leakPath, leakLoop );

		return await expectRejects(
			'leak delta over threshold',
			() => validateArtifactBundle( dir ),
			/delta textures exceeded threshold/,
		);

	} finally {

		await rm( dir, { recursive: true, force: true } );

	}

}

async function testMissingLeakLoopRejects() {

	const dir = await makeBundle();

	try {

		const leakPath = join( dir, 'leak-loop.json' );
		const leakLoop = await readJson( leakPath );
		leakLoop.loops = leakLoop.loops.filter( ( loop ) => loop.name !== 'dpr-change' );
		await writeJson( leakPath, leakLoop );

		return await expectRejects(
			'missing DPR leak loop',
			() => validateArtifactBundle( dir ),
			/dpr-change/,
		);

	} finally {

		await rm( dir, { recursive: true, force: true } );

	}

}

async function testReadbackStrideRejects() {

	const dir = await makeBundle();

	try {

		const targetsPath = join( dir, 'render-targets.json' );
		const renderTargets = await readJson( targetsPath );
		const target = renderTargets.targets[ 0 ];
		target.readback.bytesPerRow = target.readback.byteLength / target.height;
		await writeJson( targetsPath, renderTargets );

		return await expectRejects(
			'fractional readback stride',
			() => validateArtifactBundle( dir ),
			/readback\.bytesPerRow|padded row/,
		);

	} finally {

		await rm( dir, { recursive: true, force: true } );

	}

}

export async function runSelfTest() {

	return {
		pass: true,
		rejections: [
			await testFinalOnlyContractRejects(),
			await testBlankPngRejects(),
			await testGpuTimingLabelRejects(),
			await testGpuTimingTimestampRejects(),
			await testManifestRequiredFieldRejects( 'browser' ),
			await testManifestRequiredFieldRejects( 'os' ),
			await testManifestRequiredFieldRejects( 'assets' ),
			await testStaleReducedTierRejects(),
			await testManualCameraRejects(),
			await testLeakDeltaRejects(),
			await testMissingLeakLoopRejects(),
			await testReadbackStrideRejects(),
		],
	};

}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) {

	try {

		console.log( JSON.stringify( await runSelfTest(), null, 2 ) );

	} catch ( error ) {

		console.error( error.message );
		process.exitCode = 1;

	}

}
