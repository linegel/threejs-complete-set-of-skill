import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function argument( name, fallback = null ) {

	const index = process.argv.indexOf( name );
	return index >= 0 ? process.argv[ index + 1 ] : fallback;

}

const defaultArtifactDir = fileURLToPath( new URL( '../../../artifacts/visual-validation/browser-fallback-harness/', import.meta.url ) );
const artifactDir = resolve( argument( '--artifacts', process.env.FALLBACK_EVIDENCE_DIR ?? defaultArtifactDir ) );
const summaryPath = resolve( artifactDir, 'capture-summary.json' );

try {

	await access( summaryPath );

} catch {

	console.error( JSON.stringify( { status: 'INSUFFICIENT_EVIDENCE', reason: `Missing ${ summaryPath }` }, null, 2 ) );
	process.exit( 2 );

}

const summary = JSON.parse( await readFile( summaryPath, 'utf8' ) );
assert.equal( summary.schemaVersion, 2 );
assert.equal( summary.labId, 'browser-fallback-harness' );
assert.equal( summary.target.tested, true );
assert.equal( summary.target.webgpu, false );
assert.match( summary.canonicalEvidence.sha256, /^[a-f0-9]{64}$/ );
assert.deepEqual( summary.branches.map( ( branch ) => branch.id ), [ 'precomputed-static', 'cpu-offline', 'feature-removed', 'maintained-legacy' ] );

for ( const branch of summary.branches ) {

	assert.equal( branch.before.explicitRequest, false );
	assert.notEqual( branch.before.result?.details?.activated, true );
	assert.equal( branch.after.explicitRequest, true );
	assert.equal( branch.after.result.details.activated, true );
	assert.equal( branch.after.compatibilityRuntime.isWebGPUBackend, false );
	assert.equal( branch.screenshots.length, 3 );
	for ( const filename of branch.screenshots ) assert.ok( ( await stat( resolve( artifactDir, filename ) ) ).size > 0 );
	const hashes = Object.values( branch.pixelHashes );
	assert.ok( hashes.every( ( hash ) => /^[a-f0-9]{64}$/.test( hash ) ) );
	assert.ok( new Set( hashes ).size > 1, `${ branch.id } diagnostics are identical` );

}

console.log( JSON.stringify( { status: 'PASS', labId: summary.labId, branchCount: summary.branches.length }, null, 2 ) );
