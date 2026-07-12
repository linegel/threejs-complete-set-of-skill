import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { assertCheckedJsonSchema, loadCheckedEvidenceSchemas } from './checked-json-schema.js';
import { assertEvidenceManifestContract } from './evidence-manifest-contract.js';
import { assertLabelledNumerics } from './numeric-evidence.js';
import { resolveConfinedPath } from './path-confinement.js';
import { assertNonBlankGeneratedPng, compareGeneratedRgbaPngs, decodeGeneratedRgbaPixels } from './png.js';

const PNG_SIGNATURE = Buffer.from( [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] );
const CORRECTNESS_IMAGE_DIMENSIONS = Object.freeze( {
	'final.design.png': [ 1200, 800 ],
	'no-post.design.png': [ 1200, 800 ],
	'diagnostics.mosaic.png': [ 1200, 800 ],
	'camera.near.png': [ 1200, 800 ],
	'camera.design.png': [ 1200, 800 ],
	'camera.far.png': [ 1200, 800 ],
	'seed-0001.final.png': [ 1200, 800 ],
	'seed-9e3779b9.final.png': [ 1200, 800 ],
	'temporal.t000.png': [ 1200, 800 ],
	'temporal.t001.png': [ 1200, 800 ],
	'diagnostic.normal.png': [ 1200, 800 ],
	'diagnostic.emissive.png': [ 1200, 800 ],
	'odd-size.final.png': [ 641, 359 ]
} );
const REQUIRED_DISTINCT_IMAGE_PAIRS = Object.freeze( [
	[ 'final.design.png', 'diagnostics.mosaic.png', 0.01 ],
	[ 'final.design.png', 'no-post.design.png', 0.001 ],
	[ 'final.design.png', 'diagnostic.normal.png', 0.01 ],
	[ 'final.design.png', 'diagnostic.emissive.png', 0.01 ],
	[ 'diagnostic.normal.png', 'diagnostic.emissive.png', 0.01 ],
	[ 'seed-0001.final.png', 'seed-9e3779b9.final.png', 0.001 ],
	[ 'temporal.t000.png', 'temporal.t001.png', 0.001 ],
	[ 'camera.near.png', 'camera.design.png', 0.001 ],
	[ 'camera.design.png', 'camera.far.png', 0.001 ],
	[ 'camera.near.png', 'camera.far.png', 0.001 ]
] );

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

				const artifact = JSON.parse( bytes.toString( 'utf8' ) );
				if ( entry.kind === 'normative-json' ) assertLabelledNumerics( artifact );

			} catch ( error ) {

				throw new Error( `${ entry.path } is ledgered as JSON but fails parsing or numeric provenance: ${ error.message }` );

			}

		}

	}

	const pipelineBytes = capturedFiles.get( 'pipeline-graph.json' );
	if ( pipelineBytes !== undefined ) {

		const graph = JSON.parse( pipelineBytes.toString( 'utf8' ) );
		assertCheckedJsonSchema( schemas.runtimeGraph, graph, 'pipeline-graph.json' );

	}

	const decodedImages = new Map();
	const correctnessImages = manifest.bundleKind === 'release-bundle' || manifest.captureSessions.some( ( session ) => session.profile === 'correctness' );
	for ( const image of manifest.images ) {

		if ( image.status !== 'captured' ) continue;
		const bytes = await readBoundFile( artifactDir, image, `image ledger entry ${ image.path }` );
		if ( bytes.subarray( 0, PNG_SIGNATURE.length ).equals( PNG_SIGNATURE ) === false ) throw new Error( `${ image.path } is not a PNG byte stream.` );
		const inspection = assertNonBlankGeneratedPng( bytes, image.path );
		if ( correctnessImages && CORRECTNESS_IMAGE_DIMENSIONS[ image.path ] ) {

			const [ width, height ] = CORRECTNESS_IMAGE_DIMENSIONS[ image.path ];
			if ( inspection.width !== width || inspection.height !== height ) throw new Error( `${ image.path } must be ${ width }x${ height }; received ${ inspection.width }x${ inspection.height }.` );

		}
		const decoded = decodeGeneratedRgbaPixels( bytes );
		decodedImages.set( image.path, { bytes, ...decoded, pixelSha256: sha256( decoded.pixels ) } );
		const fileEntry = manifest.files.find( ( entry ) => entry.path === image.path );
		if ( fileEntry !== undefined && ( fileEntry.status !== 'captured' || fileEntry.sha256 !== image.sha256 || fileEntry.byteLength !== image.byteLength ) ) throw new Error( `${ image.path } has contradictory file and image ledger bindings.` );

	}
	for ( const [ baselinePath, candidatePath, minimumDifferingRatio ] of REQUIRED_DISTINCT_IMAGE_PAIRS ) {

		const baseline = decodedImages.get( baselinePath );
		const candidate = decodedImages.get( candidatePath );
		if ( baseline === undefined || candidate === undefined ) continue;
		if ( baseline.pixelSha256 === candidate.pixelSha256 ) throw new Error( `${ candidatePath } aliases decoded pixels from ${ baselinePath }.` );
		const comparison = compareGeneratedRgbaPngs( baseline.bytes, candidate.bytes );
		if ( comparison.ratio < minimumDifferingRatio || comparison.maxChannelDelta < 8 ) throw new Error( `${ candidatePath } does not differ materially from ${ baselinePath }.` );

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
