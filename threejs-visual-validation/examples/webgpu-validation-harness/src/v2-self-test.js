import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateVersionedArtifactBundle } from './schema/dispatcher.js';
import { writeUnifiedV2ContractFixture } from './unified-v2-fixture.js';

async function mutation( id, expected, mutate ) {

	const directory = await mkdtemp( join( tmpdir(), `threejs-unified-v2-${ id }-` ) );
	await writeUnifiedV2ContractFixture( directory );
	const manifestPath = join( directory, 'evidence-manifest.json' );
	const manifest = JSON.parse( await readFile( manifestPath, 'utf8' ) );
	await mutate( manifest, directory );
	await writeFile( manifestPath, `${ JSON.stringify( manifest, null, 2 ) }\n` );
	try {

		await validateVersionedArtifactBundle( directory );

	} catch ( error ) {

		if ( expected.test( error.message ) === false ) throw new Error( `${ id } rejected for the wrong reason: ${ error.message }` );
		return { id, verdict: 'PASS', detected: error.message, retainedFixture: directory };

	}
	throw new Error( `${ id } mutation unexpectedly passed; retained fixture: ${ directory }.` );

}

export async function runV2MutationSuite() {

	const results = await Promise.all( [
		mutation( 'fixture-publishable', /contract-fixture|Publishable evidence|must equal false/, ( manifest ) => { manifest.publishable = true; } ),
		mutation( 'fixture-pass-claim', /Contract fixture cannot claim PASS|forbidden schema/, ( manifest ) => { manifest.claimVerdicts.visualCorrectness = 'PASS'; } ),
		mutation( 'fixture-promotion-forgery', /NOT_ELIGIBLE|one schema branch|must equal/, ( manifest ) => { manifest.promotion.status = 'APPROVED'; } ),
		mutation( 'route-state-digest', /semantic contract failed/, ( manifest ) => { manifest.route.camera = 'near'; } ),
		mutation( 'unknown-manifest-field', /unknown property/, ( manifest ) => { manifest.browserLauncher = 'chrome'; } ),
		mutation( 'legacy-browser-bundle-kind', /allowed enum value/, ( manifest ) => { manifest.bundleKind = 'browser-capture'; } ),
		mutation( 'crossed-correctness-capture-lane', /playwright-headless-chromium|must equal/, ( manifest ) => {

			manifest.bundleKind = 'raw-capture-session';
			manifest.captureSessions = [ {
				sessionId: 'webgpu-validation-harness:correctness:mutation',
				profile: 'correctness',
				automationSurface: 'codex-in-app-browser'
			} ];

		} ),
		mutation( 'unconfined-ledger-path', /does not match|parent traversal/, ( manifest ) => {

			manifest.files.push( {
				path: '../escape.json',
				status: 'not-applicable',
				kind: 'supplementary-json',
				reason: 'mutation'
			} );

		} )
	] );
	return { schemaVersion: 2, mutationCount: results.length, results };

}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) console.log( JSON.stringify( await runV2MutationSuite(), null, 2 ) );
