import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runLifecycleProfile } from './subject-adapter.js';

function createController( calls, cycle ) {

	let disposed = false;
	return {
		async ready() { calls.push( [ cycle, 'ready' ] ); },
		async setScenario() {},
		async setMode( id ) { calls.push( [ cycle, 'mode', id ] ); },
		async setTier( id ) { calls.push( [ cycle, 'tier', id ] ); },
		async setSeed() {},
		async setCamera() {},
		async setTime() {},
		async step() {},
		async resetHistory( cause ) { calls.push( [ cycle, 'reset', cause ] ); },
		async resize( width, height, dpr ) { calls.push( [ cycle, 'resize', width, height, dpr ] ); },
		async renderOnce() { calls.push( [ cycle, 'render' ] ); },
		async capturePixels() {},
		describePipeline() { return {}; },
		describeResources() { return { resident: disposed ? [] : [ 'target' ] }; },
		getMetrics() { return { disposed, deviceErrors: [] }; },
		async dispose() {

			disposed = true;
			return { queueSettlement: { status: 'PASS' } };

		}
	};

}

test( 'shared lifecycle runner preserves harness defaults and fresh controllers', async () => {

	const calls = [];
	const result = await runLifecycleProfile( ( cycle ) => createController( calls, cycle ), {
		cycles: 50,
		settle: async () => ( { observedAnimationFrames: 2, queueSettled: true, delayedErrors: [] } )
	} );

	assert.equal( result.snapshots.length, 50 );
	assert.deepEqual( result.snapshots[ 0 ].plan, {
		width: 641,
		height: 359,
		dpr: 1.5,
		tier: 'governor-stress',
		mode: 'normal',
		resetCause: 'lifecycle-cycle-0'
	} );
	assert.equal( result.snapshots.every( ( snapshot ) => snapshot.dispose.completed ), true );
	assert.equal( result.snapshots.every( ( snapshot ) => snapshot.settle.queueSettled ), true );
	assert.deepEqual( result.snapshots[ 0 ].resourcesAfterDispose, { resident: [] } );
	assert.equal( calls.filter( ( call ) => call[ 1 ] === 'render' ).length, 50 );

} );

test( 'shared lifecycle runner accepts lab-specific cycle plans and rejects weak loops', async () => {

	await assert.rejects( runLifecycleProfile( () => createController( [], 0 ), { cycles: 49 } ), /\[50, 100\]/ );
	const result = await runLifecycleProfile( ( cycle ) => createController( [], cycle ), {
		cycles: 50,
		planCycle: ( cycle ) => ( {
			width: 320,
			height: 180,
			dpr: 1,
			tier: cycle % 2 === 0 ? 'full' : 'balanced',
			mode: 'final',
			resetCause: `custom-${ cycle }`
		} ),
		settle: async () => ( { observedAnimationFrames: 2, queueSettled: true, delayedErrors: [] } )
	} );
	assert.equal( result.snapshots[ 1 ].plan.tier, 'balanced' );
	assert.equal( result.snapshots[ 49 ].plan.resetCause, 'custom-49' );

} );
