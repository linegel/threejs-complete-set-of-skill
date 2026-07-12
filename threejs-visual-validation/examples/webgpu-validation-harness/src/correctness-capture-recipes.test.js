import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CORRECTNESS_CAPTURE_RECIPE_IDS,
	CORRECTNESS_CAPTURE_RECIPES,
	correctnessCaptureRecipeDigest,
	correctnessCaptureRecipeSetDigest,
	getCorrectnessCaptureRecipe,
	verifyCorrectnessCaptureRecipeDigest
} from './correctness-capture-recipes.js';

const EXPECTED_IDS = [
	'final.design',
	'no-post.design',
	'diagnostic.normal',
	'diagnostic.emissive',
	'camera.near',
	'camera.design',
	'camera.far',
	'seed-0001.final',
	'seed-9e3779b9.final',
	'temporal.t000',
	'temporal.t001',
	'odd-size.final',
	'tier.target-performance.final',
	'tier.governor-stress.final'
];

test( 'correctness capture recipes freeze every independently executable state', () => {

	assert.deepEqual( CORRECTNESS_CAPTURE_RECIPE_IDS, EXPECTED_IDS );
	assert.equal( Object.isFrozen( CORRECTNESS_CAPTURE_RECIPES ), true );
	assert.equal( new Set( CORRECTNESS_CAPTURE_RECIPE_IDS ).size, EXPECTED_IDS.length );

	for ( const id of EXPECTED_IDS ) {

		const capture = getCorrectnessCaptureRecipe( id );
		assert.equal( capture.schemaVersion, 1 );
		assert.equal( capture.id, id );
		assert.deepEqual( capture.parentRoute, { kind: 'tier', id: 'webgpu-correctness' } );
		assert.deepEqual( capture.transaction, {
			owner: 'validation-subject',
			scope: 'subject-internal',
			restorePolicy: 'restore-entry-state',
			parentRouteMutationAllowed: false
		} );
		assert.equal( capture.capture.filename, `${ id }.png` );
		assert.equal( capture.capture.readback, 'render-target-rgba8' );
		assert.equal( Object.isFrozen( capture ), true );
		assert.equal( Object.isFrozen( capture.capture ), true );
		assert.equal( Object.isFrozen( capture.effectiveState ), true );
		assert.equal( Object.isFrozen( capture.effectiveState.viewport ), true );
		assert.equal( Object.isFrozen( capture.effectiveState.timeline.stepSeconds ), true );
		assert.equal( capture.effectiveState.seed >= 0 && capture.effectiveState.seed <= 0xffffffff, true );
		assert.equal( Number.isFinite( capture.effectiveState.timeSeconds ), true );

	}

} );

test( 'camera, seed, temporal, and odd-size recipes declare exact state without sequence leakage', () => {

	assert.equal( getCorrectnessCaptureRecipe( 'camera.near' ).effectiveState.camera, 'near' );
	assert.equal( getCorrectnessCaptureRecipe( 'camera.design' ).effectiveState.camera, 'design' );
	assert.equal( getCorrectnessCaptureRecipe( 'camera.far' ).effectiveState.camera, 'far' );
	assert.equal( getCorrectnessCaptureRecipe( 'seed-0001.final' ).effectiveState.seed, 0x00000001 );
	assert.equal( getCorrectnessCaptureRecipe( 'seed-9e3779b9.final' ).effectiveState.seed, 0x9e3779b9 );

	const temporal0 = getCorrectnessCaptureRecipe( 'temporal.t000' ).effectiveState;
	const temporal1 = getCorrectnessCaptureRecipe( 'temporal.t001' ).effectiveState;
	assert.deepEqual( temporal0.timeline, {
		initialTimeSeconds: 0,
		resetHistoryCause: 'correctness-capture',
		stepSeconds: []
	} );
	assert.equal( temporal0.timeSeconds, 0 );
	assert.deepEqual( temporal1.timeline, {
		initialTimeSeconds: 0,
		resetHistoryCause: 'correctness-capture',
		stepSeconds: [ 1 / 60 ]
	} );
	assert.equal( temporal1.timeSeconds, 1 / 60 );

	const odd = getCorrectnessCaptureRecipe( 'odd-size.final' ).effectiveState;
	assert.deepEqual( odd.viewport, { width: 641, height: 359, dpr: 1 } );
	assert.equal( odd.mode, 'final' );
	assert.equal( odd.camera, 'design' );
	assert.equal( odd.seed, 1 );
	assert.equal( odd.timeSeconds, 0 );

} );

test( 'tier visual recipes keep the parent route locked and restore their explicit effective state', () => {

	const expected = [
		[ 'tier.target-performance.final', 'target-performance', 1 ],
		[ 'tier.governor-stress.final', 'governor-stress', 0.5 ]
	];
	for ( const [ id, tier, expectedSceneScale ] of expected ) {

		const capture = getCorrectnessCaptureRecipe( id );
		assert.deepEqual( capture.parentRoute, { kind: 'tier', id: 'webgpu-correctness' } );
		assert.equal( capture.transaction.parentRouteMutationAllowed, false );
		assert.equal( capture.transaction.restorePolicy, 'restore-entry-state' );
		assert.deepEqual( capture.effectiveState, {
			scenario: 'timing-and-governor',
			tier,
			mode: 'final',
			camera: 'design',
			seed: 1,
			timeSeconds: 0,
			viewport: { width: 1920, height: 1080, dpr: 1 },
			timeline: { initialTimeSeconds: 0, resetHistoryCause: null, stepSeconds: [] }
		} );
		assert.equal( capture.capture.target, 'final' );
		assert.equal( capture.expectedSceneScale, expectedSceneScale );

	}

} );

test( 'recipe lookup and canonical digest verification fail closed', async () => {

	assert.throws( () => getCorrectnessCaptureRecipe( 'tier.release.final' ), /Unknown correctness capture recipe/ );
	assert.throws( () => getCorrectnessCaptureRecipe( null ), /Unknown correctness capture recipe/ );

	const digest = await correctnessCaptureRecipeDigest( 'tier.governor-stress.final' );
	assert.equal( digest, 'sha256:004f28366d2e556f7bda7ced3149b882b832acc985c091230a26e4fb7c4a70b0' );
	assert.equal( await correctnessCaptureRecipeDigest( 'tier.target-performance.final' ), 'sha256:900ab77c934cd65feda5656071234eb15bd40982c4cdb3acec962a75ba295c0f' );
	assert.equal( await correctnessCaptureRecipeDigest( 'tier.governor-stress.final' ), digest );
	assert.equal( await verifyCorrectnessCaptureRecipeDigest( 'tier.governor-stress.final', digest ), true );
	await assert.rejects( verifyCorrectnessCaptureRecipeDigest( 'tier.governor-stress.final', `sha256:${ '0'.repeat( 64 ) }` ), /digest mismatch/ );
	await assert.rejects( verifyCorrectnessCaptureRecipeDigest( 'tier.governor-stress.final', 'sha256:short' ), /must be a sha256/ );

	const setDigest = await correctnessCaptureRecipeSetDigest();
	assert.equal( setDigest, 'sha256:5e35f385ef14d0f2742697b12daed9d1ec70e5b6205d5cdbcc38e74a5252cd10' );
	assert.equal( await correctnessCaptureRecipeSetDigest(), setDigest );

} );
