import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertRendererBackendDeviceIdentity,
	parseRenderTimestampUid,
	summarizeTimestampBatch,
	timestampResolutionPolicy
} from './browser-subject-adapter.js';

test( 'renderer identity requires the exact device retained by the initialized backend', () => {

	const requestedDevice = {};
	assert.equal( assertRendererBackendDeviceIdentity( requestedDevice, requestedDevice ), requestedDevice );
	assert.throws( () => assertRendererBackendDeviceIdentity( requestedDevice, {} ), /exact requested GPUDevice/ );
	assert.throws( () => assertRendererBackendDeviceIdentity( requestedDevice, null ), /actual GPUDevice/ );

} );

test( 'timestamp populations are resolved once per sustained batch', () => {

	assert.equal( timestampResolutionPolicy.mappingCadence, 'once-per-batch' );
	const batch = summarizeTimestampBatch( {
		entries: [
			{ uid: 'r:2:41:f10', stage: 'final-output', durationMs: 1 },
			{ uid: 'r:1:17:f10', stage: 'scene-mrt', durationMs: 3 },
			{ uid: 'r:4:41:f11', stage: 'final-output', durationMs: 2 },
			{ uid: 'r:3:17:f11', stage: 'scene-mrt', durationMs: 4 }
		],
		resolvedLastFrameTotalMs: 6
	} );
	assert.deepEqual( batch.totalSamples, [ 4, 6 ] );
	assert.deepEqual( batch.stageSamples[ 'scene-mrt' ], [ 3, 4 ] );
	assert.deepEqual( batch.stageSamples[ 'final-output' ], [ 1, 2 ] );
	assert.deepEqual( batch.stageContextIds, { 'final-output': 41, 'scene-mrt': 17 } );
	assert.equal( batch.resolveCount, 1 );
	assert.equal( batch.lastFrameResolveResidualMs, 0 );
	assert.equal( batch.independentPerFrameTotalsAvailable, false );
	assert.equal( batch.rows[ 0 ].sceneUid, 'r:1:17:f10' );
	assert.equal( batch.rows[ 0 ].outputUid, 'r:2:41:f10' );
	assert.equal( batch.rows[ 0 ].residualMs, null );
	assert.deepEqual( parseRenderTimestampUid( 'r:123:45:f67' ), { uid: 'r:123:45:f67', frameCall: 123, contextId: 45, frameId: 67 } );
	assert.throws( () => parseRenderTimestampUid( 'r:scene:f67' ), /does not match Three r185/ );

} );

test( 'timestamp attribution rejects ordering, stage, frame, and context forgeries', () => {

	const base = [
		{ uid: 'r:1:17:f10', stage: 'scene-mrt', durationMs: 3 },
		{ uid: 'r:2:41:f10', stage: 'final-output', durationMs: 1 },
		{ uid: 'r:3:17:f11', stage: 'scene-mrt', durationMs: 4 },
		{ uid: 'r:4:41:f11', stage: 'final-output', durationMs: 2 }
	];
	assert.throws( () => summarizeTimestampBatch( {
		entries: base.map( ( entry, index ) => index === 1 ? { ...entry, uid: 'r:2:17:f10', stage: 'scene-mrt' } : entry ),
		resolvedLastFrameTotalMs: 6
	} ), /duplicates stage|exactly one/ );
	assert.throws( () => summarizeTimestampBatch( {
		entries: base.map( ( entry, index ) => index === 3 ? { ...entry, uid: 'r:4:99:f11' } : entry ),
		resolvedLastFrameTotalMs: 6
	} ), /changed render-context identity/ );
	assert.throws( () => summarizeTimestampBatch( {
		entries: base.map( ( entry ) => entry.uid.endsWith( 'f11' ) ? { ...entry, uid: entry.uid.replace( 'f11', 'f12' ) } : entry ),
		resolvedLastFrameTotalMs: 6
	} ), /frame IDs must be contiguous/ );
	assert.throws( () => summarizeTimestampBatch( {
		entries: base.map( ( entry ) => entry.stage === 'final-output' ? { ...entry, uid: entry.uid.replace( ':41:', ':17:' ) } : entry ),
		resolvedLastFrameTotalMs: 6
	} ), /two distinct stable render contexts/ );

} );
