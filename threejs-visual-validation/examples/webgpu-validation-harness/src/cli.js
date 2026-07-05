import { resolve } from 'node:path';

import { writeDefaultEvidenceBundle } from './harness.js';

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

const artifactDir = getOutputDirectory();
const result = await writeDefaultEvidenceBundle( artifactDir, {
	strict: hasFlag( '--strict' ),
	fixture: getOptionValue( '--fixture' )
} );

console.log( JSON.stringify( {
	artifactDir,
	sceneId: result.sceneId,
	requiredArtifacts: result.requiredArtifacts,
	requiredImages: result.requiredImages,
	summary: result.summary
}, null, 2 ) );
