import { access } from 'node:fs/promises';
import { resolveValidationBundleDirectory } from './artifact-paths.js';
import { validateVersionedArtifactBundle } from './schema/dispatcher.js';

function option( name, fallback ) {

	const index = process.argv.indexOf( name );
	return index === -1 ? fallback : process.argv[ index + 1 ];

}

const bundle = option( '--bundle', 'release' );
const profile = option( '--profile', 'correctness' );
const artifactDir = resolveValidationBundleDirectory( {
	override: option( '--artifacts', process.env.LAB_EVIDENCE_DIR ?? null ),
	bundle,
	profile
} );

try {

	await access( artifactDir );

} catch {

	throw new Error( `INSUFFICIENT_EVIDENCE: native browser bundle is missing at ${ artifactDir }.` );

}

const result = await validateVersionedArtifactBundle( artifactDir );
if ( result.migrationWarning ) throw new Error( `INSUFFICIENT_EVIDENCE: ${ result.migrationWarning }` );
if ( bundle === 'raw' && ( result.bundleKind !== 'raw-capture-session' || result.captureProfiles.includes( profile ) === false ) ) throw new Error( `INSUFFICIENT_EVIDENCE: raw ${ profile } path does not contain the requested immutable capture lane.` );
if ( bundle === 'release' && ( result.schemaVersion !== 2 || result.bundleKind !== 'release-bundle' || result.publishable !== true ) ) {

	throw new Error( 'INSUFFICIENT_EVIDENCE: canonical artifact validation requires a publishable offline-joined release bundle; fixtures, schema-v1 bundles, and raw capture sessions cannot satisfy acceptance.' );

}

for ( const [ claim, verdict ] of bundle === 'release' ? Object.entries( result.claimVerdicts ) : [] ) {

	if ( verdict !== 'PASS' ) throw new Error( `INSUFFICIENT_EVIDENCE: ${ claim } verdict is ${ verdict }, expected PASS.` );

}

console.log( JSON.stringify( {
	artifactDir,
	schemaVersion: result.schemaVersion,
	bundleKind: result.bundleKind,
	publishable: result.publishable,
	captureProfiles: result.captureProfiles,
	automationSurfaces: result.automationSurfaces,
	claimVerdicts: result.claimVerdicts
}, null, 2 ) );
