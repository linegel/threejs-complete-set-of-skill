import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { validateUnifiedV2ArtifactBundle } from './evidence-bundle-v2.js';
import { writeUnifiedV2ContractFixture } from './unified-v2-fixture.js';

async function fixture() {

	const directory = await mkdtemp( join( tmpdir(), 'threejs-unified-evidence-test-' ) );
	await writeUnifiedV2ContractFixture( directory );
	return directory;

}

test( 'canonical v2 artifact validation consumes the checked manifest contract', async () => {

	const directory = await fixture();
	const result = await validateUnifiedV2ArtifactBundle( directory );
	assert.equal( result.schemaVersion, 2 );
	assert.equal( result.bundleKind, 'contract-fixture' );
	assert.equal( result.publishable, false );
	assert.deepEqual( result.captureProfiles, [] );

} );

test( 'canonical v2 artifact validation rejects schema and semantic drift', async () => {

	for ( const [ name, mutate, expected ] of [
		[ 'schema', ( manifest ) => { manifest.automationSurface = 'chrome'; }, /unknown property/ ],
		[ 'semantic', ( manifest ) => { manifest.route.mode = 'normal'; }, /semantic contract failed/ ]
	] ) {

		const directory = await fixture();
		const path = join( directory, 'evidence-manifest.json' );
		const manifest = JSON.parse( await readFile( path, 'utf8' ) );
		mutate( manifest );
		await writeFile( path, `${ JSON.stringify( manifest, null, 2 ) }\n` );
		await assert.rejects( validateUnifiedV2ArtifactBundle( directory ), expected, name );

	}

} );
