import assert from 'node:assert/strict';
import { test } from 'node:test';

import { snapshotRendererInfo } from './renderer-info-snapshot.js';

test( 'renderer info snapshot preserves counters and records unsafe values', () => {

	const shared = { calls: 7, timestamp: 1.25 };
	const info = {
		memory: {
			geometries: 3,
			textures: 4,
			destroyTexture() {}
		},
		render: shared,
		compute: shared,
		invalid: Number.POSITIVE_INFINITY
	};
	info.self = info;

	const snapshot = snapshotRendererInfo( info );
	assert.deepEqual( snapshot.memory, { geometries: 3, textures: 4 } );
	assert.deepEqual( snapshot.render, { calls: 7, timestamp: 1.25 } );
	assert.equal( snapshot.compute, undefined );
	assert.equal( snapshot.invalid, null );
	assert.doesNotThrow( () => JSON.stringify( snapshot ) );
	assert.deepEqual( snapshot.serialization.omissions, [
		{ path: '$.memory.destroyTexture', reason: 'unsupported-function' },
		{ path: '$.compute', reason: 'cycle-or-shared-reference' },
		{ path: '$.invalid', reason: 'non-finite-number' },
		{ path: '$.self', reason: 'cycle-or-shared-reference' }
	] );

} );

test( 'renderer info snapshot never invokes accessors or transports binary data', () => {

	let getterCalls = 0;
	const info = { bytes: new Uint8Array( [ 1, 2, 3 ] ) };
	Object.defineProperty( info, 'dangerous', {
		enumerable: true,
		get() {

			getterCalls ++;
			throw new Error( 'getter must not execute' );

		}
	} );

	const snapshot = snapshotRendererInfo( info );
	assert.equal( getterCalls, 0 );
	assert.equal( snapshot.bytes, undefined );
	assert.equal( snapshot.dangerous, undefined );
	assert.deepEqual( snapshot.serialization.omissions, [
		{ path: '$.bytes', reason: 'binary-data' },
		{ path: '$.dangerous', reason: 'accessor' }
	] );

} );

test( 'renderer info snapshot rejects invalid roots and depth policies', () => {

	assert.throws( () => snapshotRendererInfo( null ), /renderer\.info must be an object/ );
	assert.throws( () => snapshotRendererInfo( {}, { maximumDepth: 0 } ), /positive integer/ );

} );
