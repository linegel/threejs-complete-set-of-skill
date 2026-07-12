import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { validateVersionedArtifactBundle } from './schema/dispatcher.js';

async function writePreUnifiedV2Fixture() {

	const directory = await mkdtemp( join( tmpdir(), 'threejs-pre-unified-v2-dispatch-' ) );
	await writeFile( join( directory, 'evidence-manifest.json' ), `${ JSON.stringify( {
		schemaVersion: 2,
		bundleKind: 'browser-capture-incomplete',
		publishable: false,
		claimVerdicts: {
			visualCorrectness: 'PASS',
			mechanismCorrectness: 'INSUFFICIENT_EVIDENCE',
			performanceCompliance: 'INSUFFICIENT_EVIDENCE',
			gpuAttribution: 'INSUFFICIENT_EVIDENCE',
			lifecycleStability: 'PASS'
		}
	}, null, 2 ) }\n` );
	return directory;

}

test( 'pre-unified v2 bundle kinds remain readable but categorically nonpublishable', async () => {

	const result = await validateVersionedArtifactBundle( await writePreUnifiedV2Fixture() );
	assert.equal( result.schemaVersion, 2 );
	assert.equal( result.protocol, 'legacy-v2' );
	assert.equal( result.bundleKind, 'legacy-v2' );
	assert.equal( result.publishable, false );
	assert.equal( result.canonicalAcceptanceEligible, false );
	assert.deepEqual( result.captureProfiles, [] );
	assert.match( result.migrationWarning, /recaptured as a ledgered raw session/ );
	assert( result.validationErrors.some( ( error ) => error === 'missing visual-contract.json' ) );

} );

test( 'acceptance mode adds an explicit recapture failure to pre-unified v2 evidence', async () => {

	const result = await validateVersionedArtifactBundle( await writePreUnifiedV2Fixture(), {
		requireRequiredClaimsPass: true
	} );
	assert.equal( result.publishable, false );
	assert( result.validationErrors.some( ( error ) => /cannot satisfy canonical acceptance/.test( error ) ) );

} );
