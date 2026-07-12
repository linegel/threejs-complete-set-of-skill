import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { buildImmutablePhysicalSurface } from './immutable-physical-build.js';

test( 'immutable build finalizes a validated sibling staging directory atomically', async () => {

	const outputRoot = await mkdtemp( join( tmpdir(), 'threejs-immutable-build-test-' ) );
	const first = await buildImmutablePhysicalSurface( { outputRoot, logLevel: 'silent' } );
	const second = await buildImmutablePhysicalSurface( { outputRoot, logLevel: 'silent' } );
	assert.equal( first.directory, second.directory );
	assert.equal( first.manifest.bundleHash, second.manifest.bundleHash );
	assert.equal( first.manifestFileSha256, second.manifestFileSha256 );
	const entries = await readdir( outputRoot );
	assert.deepEqual( entries, [ first.directory.split( '/' ).at( -1 ) ] );
	assert.equal( entries.some( ( entry ) => entry.includes( '.staging-' ) ), false );

} );
