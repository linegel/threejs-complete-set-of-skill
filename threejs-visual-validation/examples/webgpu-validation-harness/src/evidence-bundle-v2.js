import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { assertCheckedJsonSchema, loadCheckedEvidenceSchemas } from './checked-json-schema.js';
import { assertEvidenceManifestContract } from './evidence-manifest-contract.js';
import { resolveConfinedPath } from './path-confinement.js';

const PNG_SIGNATURE = Buffer.from( [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] );

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

async function readBoundFile( artifactDir, entry, label ) {

	const path = await resolveConfinedPath( artifactDir, entry.path, { label } );
	const bytes = await readFile( path );
	if ( bytes.byteLength !== entry.byteLength ) throw new Error( `${ label } byte length differs from its manifest ledger.` );
	if ( sha256( bytes ) !== entry.sha256 ) throw new Error( `${ label } SHA-256 differs from its manifest ledger.` );
	return bytes;

}

export async function readUnifiedEvidenceManifest( artifactDir ) {

	const path = await resolveConfinedPath( artifactDir, 'evidence-manifest.json', { label: 'evidence manifest' } );
	const bytes = await readFile( path );
	let manifest;
	try {

		manifest = JSON.parse( bytes.toString( 'utf8' ) );

	} catch ( error ) {

		throw new Error( `evidence-manifest.json is invalid JSON: ${ error.message }` );

	}
	return { manifest, bytes, sha256: sha256( bytes ) };

}

export async function validateUnifiedV2ArtifactBundle( artifactDir ) {

	const { manifest, sha256: manifestSha256 } = await readUnifiedEvidenceManifest( artifactDir );
	const schemas = await loadCheckedEvidenceSchemas();
	assertCheckedJsonSchema( schemas.evidenceManifest, manifest, 'evidence-manifest.json' );
	assertEvidenceManifestContract( manifest );

	const capturedFiles = new Map();
	for ( const entry of manifest.files ) {

		if ( entry.status !== 'captured' ) continue;
		const bytes = await readBoundFile( artifactDir, entry, `file ledger entry ${ entry.path }` );
		capturedFiles.set( entry.path, bytes );
		if ( entry.kind === 'normative-json' || entry.kind === 'supplementary-json' || entry.kind === 'capture-session-document' || entry.kind === 'capture-session-write-ledger' ) {

			try {

				JSON.parse( bytes.toString( 'utf8' ) );

			} catch ( error ) {

				throw new Error( `${ entry.path } is ledgered as JSON but cannot be parsed: ${ error.message }` );

			}

		}

	}

	const pipelineBytes = capturedFiles.get( 'pipeline-graph.json' );
	if ( pipelineBytes !== undefined ) {

		const graph = JSON.parse( pipelineBytes.toString( 'utf8' ) );
		assertCheckedJsonSchema( schemas.runtimeGraph, graph, 'pipeline-graph.json' );

	}

	for ( const image of manifest.images ) {

		if ( image.status !== 'captured' ) continue;
		const bytes = await readBoundFile( artifactDir, image, `image ledger entry ${ image.path }` );
		if ( bytes.subarray( 0, PNG_SIGNATURE.length ).equals( PNG_SIGNATURE ) === false ) throw new Error( `${ image.path } is not a PNG byte stream.` );
		const fileEntry = manifest.files.find( ( entry ) => entry.path === image.path );
		if ( fileEntry !== undefined && ( fileEntry.status !== 'captured' || fileEntry.sha256 !== image.sha256 || fileEntry.byteLength !== image.byteLength ) ) throw new Error( `${ image.path } has contradictory file and image ledger bindings.` );

	}

	return Object.freeze( {
		schemaVersion: 2,
		bundleKind: manifest.bundleKind,
		publishable: manifest.publishable,
		labId: manifest.labId,
		bundleId: manifest.bundleId,
		claimVerdicts: Object.freeze( { ...manifest.claimVerdicts } ),
		captureProfiles: Object.freeze( manifest.captureSessions.map( ( session ) => session.profile ) ),
		automationSurfaces: Object.freeze( [ ...new Set( manifest.captureSessions.map( ( session ) => session.automationSurface ) ) ] ),
		manifestSha256
	} );

}
