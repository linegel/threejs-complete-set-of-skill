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

try {

	const artifactDir = getOutputDirectory();
	const bundle = await writeDefaultEvidenceBundle( artifactDir );
	const selfTest = await runSelfTest();

	console.log( JSON.stringify( {
		artifactDir,
		sceneId: bundle.sceneId,
		requiredArtifacts: bundle.requiredArtifacts,
		requiredImages: bundle.requiredImages,
		selfTest,
	}, null, 2 ) );

} catch ( error ) {

	console.error( error.message );
	process.exitCode = 1;

}
