import { mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateVersionedArtifactBundle } from './schema/dispatcher.js';
import { runV2MutationSuite } from './v2-self-test.js';
import { writeUnifiedV2ContractFixture } from './unified-v2-fixture.js';

function option( name, fallback ) {

	const index = process.argv.indexOf( name );
	return index === -1 ? fallback : process.argv[ index + 1 ];

}

const requestedOutput = option( '--out', null );
const artifactDir = requestedOutput === null
	? await mkdtemp( join( tmpdir(), 'threejs-visual-validation-v2-contract-fixture-' ) )
	: resolve( requestedOutput );
const fixture = await writeUnifiedV2ContractFixture( artifactDir );
const dispatchedResult = await validateVersionedArtifactBundle( artifactDir );
const mutationResult = await runV2MutationSuite();

console.log( JSON.stringify( {
	artifactDir,
	fixtureClassification: fixture.bundleKind,
	publishable: fixture.publishable,
	dispatchedSchemaVersion: dispatchedResult.schemaVersion,
	claimVerdicts: fixture.claimVerdicts,
	mutationCount: mutationResult.mutationCount,
	mutations: mutationResult.results.map( ( result ) => ( { id: result.id, verdict: result.verdict } ) )
}, null, 2 ) );
