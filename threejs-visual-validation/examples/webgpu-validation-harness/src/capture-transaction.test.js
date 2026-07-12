import assert from 'node:assert/strict';
import test from 'node:test';

import { createFailClosedCaptureCoordinator } from './capture-transaction.js';

function deferred() {

	let resolve;
	let reject;
	const promise = new Promise( ( onResolve, onReject ) => {

		resolve = onResolve;
		reject = onReject;

	} );
	return { promise, resolve, reject };

}

function fixture( overrides = {} ) {

	let state = { tier: 'webgpu-correctness', generation: 7 };
	const events = [];
	const coordinator = createFailClosedCaptureCoordinator( {
		async snapshotState( context ) {

			events.push( `snapshot:${ context.phase ?? 'entry' }` );
			return { ...state };

		},
		async digestState( value ) {

			return `digest:${ value.tier }:${ value.generation }`;

		},
		async restoreState( entry ) {

			events.push( 'restore' );
			state = { ...entry };

		},
		async settleRestoration() {

			events.push( 'settle' );

		},
		async verifyRestoration( evidence ) {

			events.push( 'verify' );
			return evidence.entryStateDigest === evidence.restoredStateDigest;

		},
		async onPoison() {

			events.push( 'poison' );

		},
		...overrides
	} );
	return {
		coordinator,
		events,
		getState: () => ( { ...state } ),
		setState: ( next ) => { state = { ...next }; }
	};

}

test( 'capture transactions restore entry state and report deterministic evidence', async () => {

	const subject = fixture();
	const result = await subject.coordinator.run( { id: 'camera.near' }, async () => {

		subject.events.push( 'capture' );
		subject.setState( { tier: 'target-performance', generation: 7 } );
		return { pixels: new Uint8Array( [ 1, 2, 3, 4 ] ) };

	} );

	assert.deepEqual( subject.getState(), { tier: 'webgpu-correctness', generation: 7 } );
	assert.deepEqual( subject.events, [ 'snapshot:entry', 'capture', 'restore', 'settle', 'snapshot:restored', 'verify' ] );
	assert.deepEqual( result.transaction, {
		schemaVersion: 1,
		status: 'COMMITTED',
		transactionId: 'capture-1',
		sequence: 1,
		recipeId: 'camera.near',
		entryStateDigest: 'digest:webgpu-correctness:7',
		restoredStateDigest: 'digest:webgpu-correctness:7',
		restorationVerdict: 'PASS',
		phaseVerdicts: {
			capture: 'PASS',
			restore: 'PASS',
			settle: 'PASS',
			verify: 'PASS'
		}
	} );
	assert.equal( Object.isFrozen( result.transaction ), true );
	assert.equal( subject.coordinator.status().poisoned, null );

} );

test( 'active transactions reject interleaved controller operations', async () => {

	const subject = fixture();
	const release = deferred();
	const capture = subject.coordinator.run( { id: 'final.design' }, async () => {

		subject.events.push( 'capture-wait' );
		await release.promise;
		return { pixels: new Uint8Array( 4 ) };

	} );
	await Promise.resolve();
	await Promise.resolve();
	assert.throws( () => subject.coordinator.assertAvailable( 'setTier' ), /capture transaction capture-1 is active/ );
	await assert.rejects( subject.coordinator.run( { id: 'camera.far' }, async () => ( {} ) ), /capture transaction capture-1 is active/ );
	release.resolve();
	await capture;
	assert.equal( subject.coordinator.assertAvailable( 'setTier' ), true );

} );

test( 'capture failures restore state and keep the controller usable', async () => {

	const subject = fixture();
	const failure = new Error( 'readback failed' );
	await assert.rejects( subject.coordinator.run( { id: 'odd-size.final' }, async () => {

		subject.setState( { tier: 'governor-stress', generation: 7 } );
		throw failure;

	} ), ( error ) => error === failure );
	assert.deepEqual( subject.getState(), { tier: 'webgpu-correctness', generation: 7 } );
	assert.equal( subject.coordinator.status().poisoned, null );
	assert.equal( subject.coordinator.assertAvailable( 'setMode' ), true );

} );

test( 'unproven restoration poisons future operations while allowing explicit disposal', async () => {

	const subject = fixture( {
		async verifyRestoration() { return false; }
	} );
	await assert.rejects( subject.coordinator.run( { id: 'tier.target-performance.final' }, async () => ( { pixels: new Uint8Array( 4 ) } ) ), /verifier did not return true/ );
	assert.match( subject.coordinator.status().poisoned.reason, /verifier did not return true/ );
	assert.throws( () => subject.coordinator.assertAvailable( 'capture' ), /controller is poisoned/ );
	assert.equal( subject.coordinator.assertAvailable( 'dispose', { allowPoisoned: true } ), true );

} );

test( 'capture and restoration failures preserve deterministic AggregateError order', async () => {

	const restoreFailure = new Error( 'restore render failed' );
	const captureFailure = new Error( 'normalization failed' );
	const subject = fixture( {
		async settleRestoration() { throw restoreFailure; }
	} );
	await assert.rejects( subject.coordinator.run( { id: 'diagnostic.normal' }, async () => {

		throw captureFailure;

	} ), ( error ) => {

		assert.equal( error instanceof AggregateError, true );
		assert.equal( error.errors[ 0 ], captureFailure );
		assert.equal( error.errors[ 1 ], restoreFailure );
		return true;

	} );
	assert.match( subject.coordinator.status().poisoned.reason, /restore render failed/ );

} );

test( 'recipe and dependency validation fail before mutation', async () => {

	assert.throws( () => createFailClosedCaptureCoordinator( {} ), /snapshotState must be a function/ );
	const subject = fixture();
	await assert.rejects( subject.coordinator.run( { id: '' }, async () => ( {} ) ), /recipe ID is required/ );
	await assert.rejects( subject.coordinator.run( null, async () => ( {} ) ), /recipe object/ );
	assert.deepEqual( subject.events, [] );

	const invalidSnapshot = createFailClosedCaptureCoordinator( {
		async snapshotState() { return null; },
		async digestState() { return 'digest'; },
		async restoreState() {},
		async settleRestoration() {},
		async verifyRestoration() { return true; }
	} );
	await assert.rejects( invalidSnapshot.run( { id: 'final.design' }, async () => ( {} ) ), /entry snapshot must be an object/ );

} );
