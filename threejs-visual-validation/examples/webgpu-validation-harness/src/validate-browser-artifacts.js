import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import { validateVersionedArtifactBundle } from './schema/dispatcher.js';

function option( name, fallback ) {

	const index = process.argv.indexOf( name );
	return index === -1 ? fallback : process.argv[ index + 1 ];

}

const defaultDirectory = 'artifacts/visual-validation/webgpu-validation-harness/current';
const artifactDir = resolve( option( '--artifacts', process.env.LAB_EVIDENCE_DIR ?? defaultDirectory ) );

try {

	await access( artifactDir );

} catch {

	throw new Error( `INSUFFICIENT_EVIDENCE: native browser bundle is missing at ${ artifactDir }.` );

}

const result = await validateVersionedArtifactBundle( artifactDir );
if ( result.schemaVersion !== 2 || result.bundleKind !== 'browser-capture' || result.publishable !== true ) {

	throw new Error( 'INSUFFICIENT_EVIDENCE: canonical artifact validation requires a publishable browser-capture bundle; fixtures, schema-v1 bundles, and browser-capture-incomplete bundles cannot satisfy acceptance.' );

}

for ( const [ claim, verdict ] of Object.entries( result.claimVerdicts ) ) {

	if ( verdict !== 'PASS' ) throw new Error( `INSUFFICIENT_EVIDENCE: ${ claim } verdict is ${ verdict }, expected PASS.` );

}

console.log( JSON.stringify( {
	artifactDir,
	schemaVersion: result.schemaVersion,
	bundleKind: result.bundleKind,
	publishable: result.publishable,
	claimVerdicts: result.claimVerdicts
}, null, 2 ) );
