import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { deriveHarnessAcceptanceReadiness, inspectHarnessAcceptanceReadiness } from './evidence-readiness.js';

function input( name, status, message = null ) {

	return {
		input: name,
		path: `/evidence/${ name }`,
		status,
		message,
		sourceClosureHash: 'sha256:source',
		buildRevision: 'sha256:build',
		threeRevision: '0.185.1'
	};

}

function inputs( overrides = {} ) {

	return {
		correctness: input( 'correctness', 'READY' ),
		physicalRoute: input( 'physicalRoute', 'READY' ),
		hardwarePerformance: input( 'hardwarePerformance', 'READY' ),
		releaseCandidate: input( 'releaseCandidate', 'NOT_PROVIDED' ),
		releaseBundle: input( 'releaseBundle', 'MISSING' ),
		...overrides
	};

}

test( 'readiness requires every immutable lane before release assembly', () => {

	const result = deriveHarnessAcceptanceReadiness( inputs( {
		correctness: input( 'correctness', 'LEGACY_RECAPTURE_REQUIRED', 'Legacy evidence requires recapture.' ),
		physicalRoute: input( 'physicalRoute', 'NOT_PROVIDED' ),
		hardwarePerformance: input( 'hardwarePerformance', 'NOT_PROVIDED' )
	} ) );
	assert.equal( result.status, 'INCOMPLETE' );
	assert.equal( result.accepted, false );
	assert.deepEqual( result.blockers.map( ( blocker ) => blocker.code ), [
		'CORRECTNESS_LEGACY_RECAPTURE_REQUIRED',
		'PHYSICAL_ROUTE_NOT_PROVIDED',
		'HARDWARE_PERFORMANCE_NOT_PROVIDED'
	] );
	assert.equal( result.nextAction, 'Legacy evidence requires recapture.' );

} );

test( 'readiness distinguishes release assembly from authored visual review', () => {

	const assembly = deriveHarnessAcceptanceReadiness( inputs() );
	assert.equal( assembly.status, 'READY_FOR_RELEASE_ASSEMBLY' );
	assert.deepEqual( assembly.blockers.map( ( blocker ) => blocker.code ), [ 'RELEASE_CANDIDATE_NOT_PROVIDED' ] );

	const review = deriveHarnessAcceptanceReadiness( inputs( {
		releaseCandidate: input( 'releaseCandidate', 'AWAITING_VISUAL_REVIEW' )
	} ) );
	assert.equal( review.status, 'AWAITING_VISUAL_REVIEW' );
	assert.deepEqual( review.blockers.map( ( blocker ) => blocker.code ), [ 'AUTHORED_VISUAL_REVIEW_REQUIRED' ] );

} );

test( 'readiness rejects cross-source lane joins before assembly', () => {

	const crossed = input( 'hardwarePerformance', 'READY' );
	crossed.sourceClosureHash = 'sha256:other-source';
	const result = deriveHarnessAcceptanceReadiness( inputs( { hardwarePerformance: crossed } ) );
	assert.equal( result.status, 'INCOMPLETE' );
	assert.deepEqual( result.blockers.map( ( blocker ) => blocker.code ), [ 'LANE_IDENTITY_MISMATCH' ] );

} );

test( 'only a validated approved release bundle marks the harness accepted', () => {

	const result = deriveHarnessAcceptanceReadiness( inputs( {
		releaseBundle: input( 'releaseBundle', 'ACCEPTED' )
	} ) );
	assert.equal( result.status, 'ACCEPTED' );
	assert.equal( result.accepted, true );
	assert.deepEqual( result.blockers, [] );
	assert.equal( result.nextAction, null );

} );

test( 'an invalid canonical release remains an explicit blocker', () => {

	const result = deriveHarnessAcceptanceReadiness( inputs( {
		correctness: input( 'correctness', 'INVALID', 'Readback hash mismatch.' ),
		releaseBundle: input( 'releaseBundle', 'INVALID', 'Promotion digest is stale.' )
	} ) );
	assert.deepEqual( result.blockers.map( ( blocker ) => blocker.code ), [
		'CORRECTNESS_INVALID',
		'RELEASE_BUNDLE_INVALID'
	] );

} );

test( 'candidate readiness confines external candidates without a missing root import', async () => {

	const directory = await mkdtemp( join( tmpdir(), 'threejs-readiness-candidate-' ) );
	const result = await inspectHarnessAcceptanceReadiness( {
		correctnessPath: join( directory, 'missing-correctness' ),
		releaseCandidatePath: join( directory, 'missing-candidate' ),
		releasePath: join( directory, 'missing-release' )
	} );
	assert.equal( result.inputs.releaseCandidate.status, 'MISSING' );
	assert.equal( result.accepted, false );

} );
