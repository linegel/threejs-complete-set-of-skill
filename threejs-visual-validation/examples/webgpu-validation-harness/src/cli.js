import { resolve } from 'node:path';

import { writeDefaultEvidenceBundle } from './harness.js';

function getOutputDirectory() {

	const index = process.argv.indexOf( '--out' );

	if ( index !== -1 && process.argv[ index + 1 ] ) {

		return resolve( process.argv[ index + 1 ] );

	}

	return resolve( 'artifacts/visual-validation/webgpu-validation-harness-demo/r185/node-schema-fixture/seed-0001' );

}

const artifactDir = getOutputDirectory();
const result = await writeDefaultEvidenceBundle( artifactDir );

console.log( JSON.stringify( {
	artifactDir,
	sceneId: result.sceneId,
	requiredArtifacts: result.requiredArtifacts,
	requiredImages: result.requiredImages
}, null, 2 ) );
