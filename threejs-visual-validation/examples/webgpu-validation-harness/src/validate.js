import { resolve } from 'node:path';

import { writeDefaultEvidenceBundle } from './harness.js';
import { runSelfTest } from './self-test.js';

function getOutputDirectory() {

	const index = process.argv.indexOf( '--out' );

	if ( index !== -1 && process.argv[ index + 1 ] ) {

		return resolve( process.argv[ index + 1 ] );

	}

	return resolve( 'artifacts/visual-validation/webgpu-validation-harness-demo/r185/node-schema-fixture/seed-0001' );

}

function hasFlag( name ) {

	return process.argv.includes( name );

}

function getOptionValue( name ) {

	const index = process.argv.indexOf( name );
	return index !== -1 ? process.argv[ index + 1 ] : null;

}

try {

	const artifactDir = getOutputDirectory();
	const bundle = await writeDefaultEvidenceBundle( artifactDir, {
		strict: hasFlag( '--strict' ),
		fixture: getOptionValue( '--fixture' )
	} );
	const selfTest = await runSelfTest();

	console.log( JSON.stringify( {
		artifactDir,
		sceneId: bundle.sceneId,
		requiredArtifacts: bundle.requiredArtifacts,
		requiredImages: bundle.requiredImages,
		summary: bundle.summary,
		selfTest,
	}, null, 2 ) );

} catch ( error ) {

	console.error( error.message );
	process.exitCode = 1;

}
