import assert from 'node:assert/strict';
import test from 'node:test';

import { buildValidationResourceLedger } from './resource-ledger.js';

test( 'resource ledger records exact color, depth, and capture allocations', () => {

	const ledger = buildValidationResourceLedger( {
		sceneWidth: 1200,
		sceneHeight: 800,
		captureWidth: 1200,
		captureHeight: 800
	} );
	assert.deepEqual( ledger.renderTargets.map( ( target ) => target.name ), [ 'output', 'normal', 'emissive', 'depth', 'capture-target' ] );
	assert.equal( ledger.renderTargets.find( ( target ) => target.name === 'depth' ).format, 'depth32float' );
	assert.equal( ledger.renderTargets.reduce( ( sum, target ) => sum + target.bytes, 0 ), 30_720_000 );

} );

test( 'resource ledger separates scaled scene targets from the full capture target', () => {

	const ledger = buildValidationResourceLedger( {
		sceneWidth: 600,
		sceneHeight: 400,
		captureWidth: 1200,
		captureHeight: 800
	} );
	assert.equal( ledger.renderTargets.find( ( target ) => target.name === 'output' ).bytes, 1_920_000 );
	assert.equal( ledger.renderTargets.find( ( target ) => target.name === 'capture-target' ).bytes, 3_840_000 );
	assert.equal( ledger.renderTargets.reduce( ( sum, target ) => sum + target.bytes, 0 ), 10_560_000 );

} );

test( 'resource ledger rejects fractional and missing dimensions', () => {

	assert.throws( () => buildValidationResourceLedger( { sceneWidth: 1.5, sceneHeight: 1, captureWidth: 1, captureHeight: 1 } ), /sceneWidth/ );
	assert.throws( () => buildValidationResourceLedger( { sceneWidth: 1, sceneHeight: 1, captureWidth: 0, captureHeight: 1 } ), /captureWidth/ );

} );
