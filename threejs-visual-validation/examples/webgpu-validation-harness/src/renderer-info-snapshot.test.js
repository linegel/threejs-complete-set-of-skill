import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyGpuAdapterSnapshot, snapshotGpuAdapter, snapshotRendererInfo } from './renderer-info-snapshot.js';

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

test( 'GPU adapter snapshot retains allowlisted identity, features, and limits', () => {

	const snapshot = snapshotGpuAdapter( {
		info: { vendor: 'NVIDIA', architecture: 'Ada', device: '', description: 'NVIDIA RTX 5090', ignored: 'nope' },
		features: new Set( [ 'timestamp-query', 'texture-compression-bc' ] ),
		limits: { maxTextureDimension2D: 8192, maxStorageTexturesPerShaderStage: 4, ignored: 99 }
	} );
	assert.deepEqual( snapshot.info, { vendor: 'NVIDIA', architecture: 'Ada', description: 'NVIDIA RTX 5090' } );
	assert.deepEqual( snapshot.features, [ 'texture-compression-bc', 'timestamp-query' ] );
	assert.deepEqual( snapshot.limits, { maxTextureDimension2D: 8192, maxStorageTexturesPerShaderStage: 4 } );
	assert.match( snapshot.identitySource, /canonical renderer device request/ );
	assert.equal( snapshot.adapterClass, 'hardware' );
	assert.throws( () => snapshotGpuAdapter( null ), /GPU adapter/ );

} );

test( 'GPU adapter classification keeps software timing diagnostic-only', () => {

	assert.equal( classifyGpuAdapterSnapshot( { info: { description: 'Google SwiftShader Vulkan' } } ), 'software' );
	assert.equal( classifyGpuAdapterSnapshot( { info: { description: 'Apple M4' } } ), 'hardware' );
	assert.equal( classifyGpuAdapterSnapshot( { info: {} } ), 'unknown' );
	assert.throws( () => classifyGpuAdapterSnapshot( null ), /snapshot must be an object/ );

} );

test( 'GPU adapter classification fails virtual, basic, mock, and vague identities closed', () => {

	const classify = ( description ) => classifyGpuAdapterSnapshot( { info: { description } } );
	for ( const identity of [
		'Microsoft Basic Render Driver (WARP)',
		'Google SwiftShader',
		'llvmpipe',
		'softpipe',
		'swrast',
		'null adapter',
		'mock adapter'
	] ) assert.equal( classify( identity ), 'software', identity );
	for ( const identity of [ 'VMware SVGA 3D', 'VirtualBox GPU', 'Parallels Display Adapter', 'virgl', 'gfxstream', 'virtio GPU' ] ) assert.equal( classify( identity ), 'virtual', identity );
	for ( const identity of [ 'unknown', 'Unexposed adapter', 'Mystery GPU', '' ] ) assert.equal( classify( identity ), 'unknown', identity );
	for ( const identity of [ 'Apple M4 Max', 'NVIDIA RTX 5090', 'AMD Radeon RX 7900', 'Intel Arc A770', 'Qualcomm Adreno 750', 'ARM Mali-G715' ] ) assert.equal( classify( identity ), 'hardware', identity );

} );
