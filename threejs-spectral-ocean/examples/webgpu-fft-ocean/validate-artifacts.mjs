import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateEvidenceBundle } from '../../../scripts/lib/evidence-v2.mjs';
import { REPO_ROOT, buildDemoRegistry } from '../../../scripts/lib/lab-registry.mjs';

const labId = 'webgpu-fft-ocean';
const artifactDir = resolve(
	process.env.LAB_ARTIFACT_DIR ?? resolve( REPO_ROOT, 'artifacts', 'visual-validation', labId, 'correctness' )
);
const registry = buildDemoRegistry();
const lab = registry.demos.find( ( entry ) => entry.id === labId );
if ( ! lab ) throw new Error( `${ labId } is absent from the demo registry.` );

const validation = validateEvidenceBundle( artifactDir, { requireRequiredClaimsPass: true } );
const errors = [ ...validation.errors ];
const evidencePath = resolve( artifactDir, 'evidence-manifest.json' );
let evidence = null;
try {
	evidence = JSON.parse( readFileSync( evidencePath, 'utf8' ) );
} catch ( error ) {
	if ( ! errors.some( ( message ) => message.includes( 'evidence-manifest.json' ) ) ) {
		errors.push( `evidence-manifest.json is unreadable: ${ error.message }` );
	}
}

if ( evidence ) {
	if ( evidence.labId !== labId ) errors.push( `evidence labId ${ evidence.labId } does not match ${ labId }` );
	if ( evidence.sourceHash !== lab.sourceHash ) {
		errors.push( `evidence sourceHash ${ evidence.sourceHash ?? '(missing)' } does not match registry ${ lab.sourceHash }` );
	}
}

if ( errors.length > 0 ) {
	console.error( JSON.stringify( {
		pass: false,
		verdict: 'INSUFFICIENT_EVIDENCE',
		labId,
		artifactDir,
		expectedSourceHash: lab.sourceHash,
		errors
	}, null, 2 ) );
	process.exitCode = 1;
} else {
	console.log( JSON.stringify( {
		pass: true,
		verdict: 'PASS',
		acceptanceStatus: lab.status,
		labId,
		artifactDir,
		sourceHash: lab.sourceHash
	}, null, 2 ) );
}
