import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	assertCanonicalCaptureLane,
	assertRecipeCaptureMetadata,
	captureFrozenRecipeEvidence,
	captureRecord,
	createTierVisualEvidence,
	derivedMosaicCaptureRecord,
	DIAGNOSTIC_MOSAIC_RECIPE,
	DIAGNOSTIC_MOSAIC_SOURCES,
	DIRECT_CAPTURE_RECIPE_ORDER,
	outputPlan,
	reconstructDiagnosticMosaic,
	runLockedMechanismAndLifecycleProfiles,
	TIER_VISUAL_EDGE_SEARCH_RADIUS_PIXELS,
	TIER_VISUAL_ERROR_GATES,
	TIER_VISUAL_EVIDENCE_FILENAME,
	tierVisualErrorMetrics
} from '../capture-hook.mjs';
import {
	CORRECTNESS_CAPTURE_RECIPES,
	correctnessCaptureRecipeDigest,
	getCorrectnessCaptureRecipe
} from './correctness-capture-recipes.js';

test( 'canonical correctness capture is Playwright-only and cannot impersonate physical or performance evidence', () => {

	assert.equal( assertCanonicalCaptureLane( { profile: 'correctness', automationSurface: 'playwright-headless-chromium' } ), true );
	assert.throws( () => assertCanonicalCaptureLane( { profile: 'correctness', automationSurface: 'codex-in-app-browser' } ), /shared Playwright/ );
	assert.throws( () => assertCanonicalCaptureLane( { profile: 'performance', automationSurface: 'playwright-headless-chromium' } ), /physical-route and performance/ );

} );

function solidReadback( width, height, rgba ) {

	const data = new Uint8Array( width * height * 4 );
	for ( let offset = 0; offset < data.length; offset += 4 ) data.set( rgba, offset );
	return { width, height, data };

}

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

function edgeReadback( width = 4, height = 4, delta = 0 ) {

	const data = new Uint8Array( width * height * 4 );
	for ( let y = 0; y < height; y ++ ) for ( let x = 0; x < width; x ++ ) {

		const offset = ( y * width + x ) * 4;
		data.set( [ Math.min( 255, ( x < width / 2 ? 16 : 224 ) + delta ), Math.min( 255, ( y < height / 2 ? 24 : 216 ) + delta ), 64 + delta, 255 ], offset );

	}
	return { width, height, data };

}

function verticalEdgeReadback( width = 12, height = 8, boundary = 6, rightColor = [ 224, 216, 64, 255 ] ) {

	const data = new Uint8Array( width * height * 4 );
	for ( let y = 0; y < height; y ++ ) for ( let x = 0; x < width; x ++ ) data.set(
		x < boundary ? [ 16, 24, 64, 255 ] : rightColor,
		( y * width + x ) * 4
	);
	return { width, height, data };

}

function paddedRows( compact, width, height ) {

	const rowBytes = width * 4;
	const bytesPerRow = Math.ceil( rowBytes / 256 ) * 256;
	const data = new Uint8Array( bytesPerRow * height );
	for ( let row = 0; row < height; row ++ ) data.set( compact.subarray( row * rowBytes, ( row + 1 ) * rowBytes ), row * bytesPerRow );
	return { data, bytesPerRow, rowBytes };

}

function capturePixelsForRecipe( recipe ) {

	if ( recipe.id === 'odd-size.final' ) return solidReadback( 641, 359, [ 30, 40, 50, 255 ] );
	if ( recipe.id === 'tier.target-performance.final' ) return edgeReadback( 1920, 1080 );
	if ( recipe.id === 'tier.governor-stress.final' ) return edgeReadback( 1920, 1080, 2 );
	if ( recipe.id === 'diagnostic.normal' ) return solidReadback( 4, 4, [ 220, 20, 20, 255 ] );
	if ( recipe.id === 'diagnostic.emissive' ) return solidReadback( 4, 4, [ 20, 220, 20, 255 ] );
	if ( [ 'final.design', 'no-post.design' ].includes( recipe.id ) ) return solidReadback( 4, 4, recipe.id === 'final.design' ? [ 20, 30, 40, 255 ] : [ 30, 40, 50, 255 ] );
	return solidReadback( 2, 2, [ 40, 50, 60, 255 ] );

}

async function recipeCaptureMetadata( recipe, overrides = {} ) {

	const pixels = capturePixelsForRecipe( recipe );
	const normalized = paddedRows( pixels.data, pixels.width, pixels.height );
	const normalizedPath = `normalized-readbacks/${ recipe.id }.rgba8.padded.bin`;
	const stateDigest = `sha256:${ 'b'.repeat( 64 ) }`;
	const sequence = CORRECTNESS_CAPTURE_RECIPES.findIndex( ( entry ) => entry.id === recipe.id ) + 1;
	const passScale = recipe.expectedSceneScale;
	const sceneWidth = Math.round( pixels.width * passScale );
	const sceneHeight = Math.round( pixels.height * passScale );
	const resource = ( semantic, width, height ) => ( { id: `${ semantic }-target`, semantic, width, height, format: 'rgba8unorm', bytes: width * height * 4 } );
	const evidence = {
		recipe: {
			id: recipe.id,
			schemaVersion: recipe.schemaVersion,
			digest: await correctnessCaptureRecipeDigest( recipe.id ),
			captureFilename: recipe.capture.filename,
			target: recipe.capture.target
		},
		transaction: {
			status: 'COMMITTED',
			transactionId: `capture-${ sequence }`,
			sequence,
			recipeId: recipe.id,
			entryStateDigest: stateDigest,
			restoredStateDigest: stateDigest,
			restorationVerdict: 'PASS'
		},
		effectiveState: recipe.effectiveState,
		passScale,
		resources: {
			entry: {},
			effective: {
				renderTargets: [
					resource( 'capture-target', pixels.width, pixels.height ),
					resource( 'output', sceneWidth, sceneHeight ),
					resource( 'normal', sceneWidth, sceneHeight ),
					resource( 'emissive', sceneWidth, sceneHeight )
				]
			},
			restored: {}
		}
	};
	const metadata = {
		target: recipe.id,
		width: pixels.width,
		height: pixels.height,
		bytesPerPixel: 4,
		bytesPerRow: pixels.width * 4,
		sourceBytesPerRow: normalized.bytesPerRow,
		sourceByteLength: normalized.data.byteLength,
		transportByteLength: normalized.data.byteLength,
		sourceLayout: 'padded',
		format: 'rgba8unorm',
		colorEncoding: 'srgb',
		png: { path: recipe.capture.filename, sha256: sha256( pixels.data ), byteLength: pixels.data.byteLength },
		transport: {
			artifact: { path: `transport-readbacks/${ recipe.id }.bin`, sha256: sha256( normalized.data ), byteLength: normalized.data.byteLength },
			rendererCopy: { requestedLayout: { alignmentBytes: 256 } },
			layout: { width: pixels.width, height: pixels.height, rowBytes: normalized.rowBytes, bytesPerRow: normalized.bytesPerRow }
		},
		normalized: {
			artifact: { path: normalizedPath, sha256: sha256( normalized.data ), byteLength: normalized.data.byteLength },
			layout: { width: pixels.width, height: pixels.height, rowBytes: normalized.rowBytes, bytesPerRow: normalized.bytesPerRow },
			bytesPerRow: normalized.bytesPerRow,
			byteLength: normalized.data.byteLength,
			compactRgbaSha256: sha256( pixels.data ),
			compactByteLength: pixels.data.byteLength
		},
		evidence,
		_testNormalizedBytes: normalized.data
	};
	return { ...metadata, ...overrides };

}

function fakeRecipeSession() {

	const artifacts = new Map();
	const recipeCalls = [];
	const controllerCalls = [];
	return {
		recipeCalls,
		controllerCalls,
		artifacts,
		async writeRecipeCapture( filename, recipeId ) {

			recipeCalls.push( { filename, recipeId } );
			const metadata = await recipeCaptureMetadata( getCorrectnessCaptureRecipe( recipeId ) );
			artifacts.set( metadata.normalized.artifact.path, metadata._testNormalizedBytes );
			const { _testNormalizedBytes, ...publicMetadata } = metadata;
			return publicMetadata;

		},
		async readArtifact( path ) { return artifacts.get( path ); },
		async writeArtifact( path, bytes ) { artifacts.set( path, bytes ); },
		async controllerCall( method ) {

			controllerCalls.push( method );
			throw new Error( `Unexpected controller call ${ method } during direct recipe capture.` );

		}
	};

}

async function retainedTierCapture( id ) {

	const recipe = getCorrectnessCaptureRecipe( id );
	const metadata = await recipeCaptureMetadata( recipe );
	const pixels = capturePixelsForRecipe( recipe );
	return { filename: recipe.capture.filename, recipeId: recipe.id, width: pixels.width, height: pixels.height, data: pixels.data, metadata };

}

test( 'direct and derived mosaic capture records retain their PNG hashes', () => {

	const sha = `sha256:${ '1'.repeat( 64 ) }`;
	const evidence = { recipe: { id: 'final.design' } };
	const direct = captureRecord( 'final.design.png', {
		target: 'final', width: 2, height: 2, bytesPerPixel: 4, bytesPerRow: 8,
		sourceBytesPerRow: 256, sourceByteLength: 264, transportByteLength: 264,
		sourceLayout: 'padded', format: 'rgba8', colorEncoding: 'srgb',
		png: { sha256: sha },
		transport: { artifact: { sha256: sha }, rendererCopy: { requestedLayout: { alignment: 256 } }, layout: { layout: 'padded', bytesPerRow: 256 } },
		normalized: { artifact: { sha256: sha }, layout: { format: 'rgba8unorm' }, bytesPerRow: 256, byteLength: 512 },
		evidence
	} );
	assert.equal( direct.pngSha256, sha );
	assert.deepEqual( direct.requestedLayout, { alignment: 256 } );
	assert.equal( direct.normalizedByteLength, 512 );
	assert.equal( direct.evidence, evidence );
	assert.equal( derivedMosaicCaptureRecord( { width: 2, height: 2, file: { sha256: sha } } ).pngSha256, sha );

} );

test( 'frozen correctness recipes capture in exact order without public state mutation and retain evidence', async () => {

	const session = fakeRecipeSession();
	const result = await captureFrozenRecipeEvidence( session );
	assert.equal( outputPlan.length, 10 );
	assert.equal( Object.isFrozen( TIER_VISUAL_ERROR_GATES ), true );
	assert.deepEqual( TIER_VISUAL_ERROR_GATES, { meanRgbByteDifference: 8, edgeP95RgbByteDifference: 32 } );
	assert.deepEqual( DIRECT_CAPTURE_RECIPE_ORDER, CORRECTNESS_CAPTURE_RECIPES.map( ( recipe ) => recipe.id ) );
	assert.deepEqual( session.recipeCalls, CORRECTNESS_CAPTURE_RECIPES.map( ( recipe ) => ( {
		filename: recipe.capture.filename,
		recipeId: recipe.id
	} ) ) );
	assert.deepEqual( session.controllerCalls, [] );
	assert.equal( result.captures.length, 15 );
	assert.equal( result.captures.filter( ( capture ) => capture.evidence !== undefined ).length, 14 );
	assert.equal( result.captures[ 0 ].evidence, result.retained.get( 'final.design.png' ).metadata.evidence );
	const standardFilenames = new Set( outputPlan.map( ( entry ) => entry.filename ) );
	for ( const supplemental of [
		'diagnostic.normal.png',
		'diagnostic.emissive.png',
		'odd-size.final.png',
		'tier.target-performance.final.png',
		'tier.governor-stress.final.png'
	] ) assert.equal( standardFilenames.has( supplemental ), false );
	const tierDocument = JSON.parse( String( session.artifacts.get( TIER_VISUAL_EVIDENCE_FILENAME ) ) );
	assert.equal( tierDocument.verdict, 'PASS' );
	assert.equal( tierDocument.gates.meanRgbByteDifference.value, 8 );
	assert.equal( tierDocument.gates.edgeP95RgbByteDifference.value, 32 );
	assert.equal( tierDocument.metrics.meanRgbByteDifference.value, 2 );
	assert.equal( tierDocument.metrics.edgeP95RgbByteDifference.value, 2 );
	assert.match( tierDocument.bindingSha256, /^sha256:[0-9a-f]{64}$/ );
	assert.notEqual( tierDocument.binding.reference.transaction.transactionId, tierDocument.binding.candidate.transaction.transactionId );
	assert.notEqual( tierDocument.binding.reference.normalized.artifact.path, tierDocument.binding.candidate.normalized.artifact.path );
	assert.deepEqual( tierDocument.binding.reference.resources.sceneMrt.map( ( entry ) => [ entry.semantic, entry.width, entry.height ] ), [
		[ 'output', 1920, 1080 ],
		[ 'normal', 1920, 1080 ],
		[ 'emissive', 1920, 1080 ]
	] );
	assert.deepEqual( tierDocument.binding.candidate.resources.sceneMrt.map( ( entry ) => [ entry.semantic, entry.width, entry.height ] ), [
		[ 'output', 960, 540 ],
		[ 'normal', 960, 540 ],
		[ 'emissive', 960, 540 ]
	] );

} );

test( 'recipe capture metadata rejects identity drift and uncommitted restoration', async () => {

	const recipe = getCorrectnessCaptureRecipe( 'camera.near' );
	const good = await recipeCaptureMetadata( recipe );
	assert.equal( await assertRecipeCaptureMetadata( recipe.capture.filename, recipe, good ), true );
	await assert.rejects(
		assertRecipeCaptureMetadata( recipe.capture.filename, recipe, { ...good, evidence: { ...good.evidence, recipe: { ...good.evidence.recipe, id: 'camera.far' } } } ),
		/recipe evidence ID/
	);
	await assert.rejects(
		assertRecipeCaptureMetadata( recipe.capture.filename, recipe, { ...good, evidence: { ...good.evidence, recipe: { ...good.evidence.recipe, captureFilename: 'camera.far.png' } } } ),
		/evidence filename/
	);
	await assert.rejects(
		assertRecipeCaptureMetadata( recipe.capture.filename, recipe, { ...good, evidence: { ...good.evidence, transaction: { ...good.evidence.transaction, status: 'ABORTED' } } } ),
		/not COMMITTED/
	);
	await assert.rejects(
		assertRecipeCaptureMetadata( recipe.capture.filename, recipe, { ...good, evidence: { ...good.evidence, transaction: { ...good.evidence.transaction, restorationVerdict: 'FAIL' } } } ),
		/restoration did not PASS/
	);
	await assert.rejects(
		assertRecipeCaptureMetadata( recipe.capture.filename, recipe, { ...good, evidence: { ...good.evidence, transaction: { ...good.evidence.transaction, restoredStateDigest: `sha256:${ 'c'.repeat( 64 ) }` } } } ),
		/did not restore/
	);

} );

test( 'tier visual evidence rejects copied provenance and resource-scale drift', async () => {

	const reference = await retainedTierCapture( 'tier.target-performance.final' );
	const candidate = await retainedTierCapture( 'tier.governor-stress.final' );
	assert.equal( createTierVisualEvidence( reference, candidate ).verdict, 'PASS' );
	const evidence = candidate.metadata.evidence;
	assert.throws( () => createTierVisualEvidence( reference, {
		...candidate,
		metadata: {
			...candidate.metadata,
			evidence: {
				...evidence,
				transaction: { ...evidence.transaction, transactionId: reference.metadata.evidence.transaction.transactionId }
			}
		}
	} ), /distinct transactions/ );
	assert.throws( () => createTierVisualEvidence( reference, {
		...candidate,
		metadata: { ...candidate.metadata, normalized: { ...candidate.metadata.normalized, artifact: { ...candidate.metadata.normalized.artifact, path: reference.metadata.normalized.artifact.path } } }
	} ), /separate normalized artifact paths/ );
	assert.throws( () => createTierVisualEvidence( reference, {
		...candidate,
		metadata: { ...candidate.metadata, evidence: { ...evidence, passScale: 1 } }
	} ), /pass scale/ );
	const resources = evidence.resources.effective.renderTargets;
	assert.throws( () => createTierVisualEvidence( reference, {
		...candidate,
		metadata: {
			...candidate.metadata,
			evidence: {
				...evidence,
				resources: {
					...evidence.resources,
					effective: {
						...evidence.resources.effective,
						renderTargets: resources.map( ( resource ) => resource.semantic === 'normal' ? { ...resource, width: 1920 } : resource )
					}
				}
			}
		}
	} ), /normal extent/ );

} );

test( 'mechanism and lifecycle profiles start only from the locked route state', async () => {

	const calls = [];
	const lockedState = { scenario: 'browser-capture', mode: 'final', tier: 'webgpu-correctness', camera: 'design', seed: 1, timeSeconds: 0 };
	const metrics = { ...lockedState, viewport: { width: 1200, height: 800, dpr: 1 } };
	const session = {
		lockedState,
		profileConfig: { width: 1200, height: 800, dpr: 1 },
		async controllerCall( method ) {

			calls.push( method );
			if ( method === 'getMetrics' ) return metrics;
			if ( method === 'runMechanismReachabilityProfile' ) return { verdict: 'PASS' };
			throw new Error( `Unexpected controller call ${ method }.` );

		},
		page: {
			async evaluate( callback, cycles ) {

				calls.push( `lifecycle:${ cycles }` );
				return { cycles };

			}
		}
	};
	const result = await runLockedMechanismAndLifecycleProfiles( session );
	assert.deepEqual( calls, [ 'getMetrics', 'runMechanismReachabilityProfile', 'getMetrics', 'lifecycle:50', 'getMetrics' ] );
	assert.deepEqual( result.lifecycle, { cycles: 50 } );
	assert.equal( calls.some( ( method ) => /^(?:set|step|resize)/.test( method ) ), false );

	const driftingSession = {
		...session,
		async controllerCall( method ) {

			if ( method === 'getMetrics' ) return { ...metrics, tier: 'target-performance' };
			throw new Error( 'Mechanism profile must not run after state drift.' );

		}
	};
	await assert.rejects( runLockedMechanismAndLifecycleProfiles( driftingSession ), /does not match locked/ );

} );

test( 'the reference-tier edge mask is measured even when its visual error is zero', () => {

	const pixels = new Uint8Array( 4 * 4 * 4 );
	for ( let y = 0; y < 4; y ++ ) for ( let x = 0; x < 4; x ++ ) {

		const offset = ( y * 4 + x ) * 4;
		pixels.set( [ x < 2 ? 0 : 255, y < 2 ? 0 : 255, 32, 255 ], offset );

	}
	const metrics = tierVisualErrorMetrics( { width: 4, height: 4, data: pixels }, { width: 4, height: 4, data: pixels } );
	assert.ok( metrics.edgeMaskPixels > 0 );
	assert.equal( metrics.meanRgbByteDifference, 0 );
	assert.equal( metrics.edgeP95RgbByteDifference, 0 );

} );

test( 'tier edge comparison tolerates one reduced-resolution texel of phase shift but rejects a removed edge', () => {

	assert.equal( TIER_VISUAL_EDGE_SEARCH_RADIUS_PIXELS, 2 );
	const reference = verticalEdgeReadback();
	const shifted = verticalEdgeReadback( 12, 8, 8 );
	const removed = verticalEdgeReadback( 12, 8, 12 );
	const shiftedMetrics = tierVisualErrorMetrics( reference, shifted );
	const removedMetrics = tierVisualErrorMetrics( reference, removed );
	assert.equal( shiftedMetrics.edgeP95RgbByteDifference, 0 );
	assert.ok( shiftedMetrics.meanRgbByteDifference > 0 );
	assert.ok( removedMetrics.edgeP95RgbByteDifference > TIER_VISUAL_ERROR_GATES.edgeP95RgbByteDifference );

} );

test( 'diagnostic mosaic is reconstructed exactly from named retained readbacks', () => {

	const colors = [ [ 255, 0, 0, 255 ], [ 0, 255, 0, 255 ], [ 0, 0, 255, 255 ], [ 255, 255, 0, 255 ] ];
	const sources = new Map( DIAGNOSTIC_MOSAIC_SOURCES.map( ( filename, index ) => [ filename, solidReadback( 3, 3, colors[ index ] ) ] ) );
	const mosaic = reconstructDiagnosticMosaic( sources );
	assert.equal( mosaic.recipe.algorithm, DIAGNOSTIC_MOSAIC_RECIPE );
	assert.deepEqual( mosaic.recipe.quadrants.map( ( quadrant ) => quadrant.outputRect ), [
		{ x: 0, y: 0, width: 2, height: 2 },
		{ x: 2, y: 0, width: 1, height: 2 },
		{ x: 0, y: 2, width: 2, height: 1 },
		{ x: 2, y: 2, width: 1, height: 1 }
	] );
	const pixel = ( x, y ) => [ ...mosaic.data.subarray( ( y * 3 + x ) * 4, ( y * 3 + x + 1 ) * 4 ) ];
	assert.deepEqual( pixel( 0, 0 ), colors[ 0 ] );
	assert.deepEqual( pixel( 2, 0 ), colors[ 1 ] );
	assert.deepEqual( pixel( 0, 2 ), colors[ 2 ] );
	assert.deepEqual( pixel( 2, 2 ), colors[ 3 ] );

} );

test( 'diagnostic mosaic rejects missing, mismatched, and malformed sources', () => {

	const sources = Object.fromEntries( DIAGNOSTIC_MOSAIC_SOURCES.map( ( filename ) => [ filename, solidReadback( 2, 2, [ 0, 0, 0, 255 ] ) ] ) );
	const missing = { ...sources };
	delete missing[ DIAGNOSTIC_MOSAIC_SOURCES[ 1 ] ];
	assert.throws( () => reconstructDiagnosticMosaic( missing ), /missing named source/ );
	assert.throws( () => reconstructDiagnosticMosaic( { ...sources, [ DIAGNOSTIC_MOSAIC_SOURCES[ 2 ] ]: solidReadback( 3, 2, [ 0, 0, 0, 255 ] ) } ), /share dimensions/ );
	assert.throws( () => reconstructDiagnosticMosaic( { ...sources, [ DIAGNOSTIC_MOSAIC_SOURCES[ 3 ] ]: { width: 2, height: 2, data: new Uint8Array( 4 ) } } ), /byte length/ );

} );
