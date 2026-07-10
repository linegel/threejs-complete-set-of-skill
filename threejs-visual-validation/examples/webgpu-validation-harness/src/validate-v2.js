import { resolve } from 'node:path';

import { validateVersionedArtifactBundle } from './schema/dispatcher.js';
import { runV2MutationSuite } from './v2-self-test.js';
import { writeV2ContractFixture } from './v2-fixture.js';

function option( name, fallback ) {

	const index = process.argv.indexOf( name );
	return index === -1 ? fallback : process.argv[ index + 1 ];

}

const artifactDir = resolve( option( '--out', '/tmp/threejs-visual-validation-v2-contract-fixture' ) );
const fixtureResult = await writeV2ContractFixture( artifactDir );
const dispatchedResult = await validateVersionedArtifactBundle( artifactDir );
const mutationResult = await runV2MutationSuite();

console.log( JSON.stringify( {
	artifactDir,
	fixtureClassification: fixtureResult.bundleKind,
	publishable: fixtureResult.publishable,
	dispatchedSchemaVersion: dispatchedResult.schemaVersion,
	claimVerdicts: fixtureResult.claimVerdicts,
	mutationCount: mutationResult.mutationCount,
	mutations: mutationResult.results.map( ( result ) => ( { id: result.id, verdict: result.verdict } ) )
}, null, 2 ) );
