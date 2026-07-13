import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { numericDatum, NumericLabel } from '../../../labs/runtime/numeric-evidence.mjs';
import {
	capturedEvidenceFile,
	capturedEvidenceImage,
	createRawCaptureSessionReference,
	createRawEvidenceManifest,
	selfExcludedManifestFile
} from '../../../scripts/lib/raw-evidence-manifest.mjs';
import { canonicalSha256 } from '../../../scripts/lib/evidence-manifest-contract.mjs';
import { REQUIRED_EVIDENCE_JSON, validateEvidenceBundle } from '../../../scripts/lib/evidence-v2.mjs';
import { FROST_NORMATIVE_JSON_PATHS } from './frost-evidence-artifacts.mjs';

const SESSION_PATH = 'capture-session.json';
const WRITE_LEDGER_PATH = 'capture-write-ledger.json';
const MANIFEST_PATH = 'evidence-manifest.json';

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

function jsonBytes( value ) {

	return Buffer.from( `${ JSON.stringify( value, null, 2 ) }\n` );

}

function binding( path, bytes, kind ) {

	return Object.freeze( { kind, path, sha256: sha256( bytes ), byteLength: bytes.byteLength } );

}

function writeIndex( session ) {

	if ( ! Array.isArray( session.artifactWrites ) ) throw new Error( 'Frost capture session has no artifact write ledger.' );
	const index = new Map();
	for ( const record of session.artifactWrites ) {

		if ( typeof record?.path !== 'string' || index.has( record.path ) ) throw new Error( `Frost capture has an invalid or duplicate write ${ record?.path ?? '<missing>' }.` );
		index.set( record.path, record );

	}
	return index;

}

async function verifiedWrite( outputDir, index, path ) {

	const record = index.get( path );
	if ( record?.contentBinding !== 'sha256-byte-length-immutable-buffer-v1' ) throw new Error( `Frost capture did not immutably bind ${ path }.` );
	const bytes = await readFile( join( outputDir, path ) );
	if ( record.sha256 !== sha256( bytes ) || record.byteLength !== bytes.byteLength ) throw new Error( `Frost capture write ${ path } drifted on disk.` );
	return { record, bytes };

}

function frostRoute( session ) {

	const state = session.route?.finalState ?? session.finalRuntime?.metrics ?? {};
	return {
		path: '/demos/webgpu-touch-history-frost/',
		scenario: state.scenario ?? 'touch-history-frost',
		mechanism: session.finalRuntime?.metrics?.mechanism ?? 'history-and-deposit',
		mode: state.mode ?? 'final',
		tier: state.tier ?? 'full',
		camera: state.camera ?? 'design',
		seed: `0x${ ( ( state.seed ?? 1 ) >>> 0 ).toString( 16 ).padStart( 8, '0' ) }`,
		timeSeconds: numericDatum( state.timeSeconds ?? 0, 'seconds', NumericLabel.MEASURED, 'final correctness capture route state' )
	};

}

function frostLimitations() {

	return [
		{
			id: 'visual-review-pending',
			status: 'ACTIVE',
			statement: 'The raw correctness bundle has direct image inspection notes but not the separate physical-route release review.',
			affectedClaims: [ 'visualCorrectness' ]
		},
		{
			id: 'hardware-performance-not-claimed',
			status: 'ACTIVE',
			statement: 'The Playwright correctness lane does not claim named-hardware GPU timing or presentation cadence.',
			affectedClaims: [ 'performanceCompliance', 'gpuAttribution' ]
		},
		{
			id: 'opaque-renderer-residency-not-claimed',
			status: 'ACTIVE',
			statement: 'Exact Three.js renderer-internal pipeline and cache byte residency is unavailable and remains unclaimed.',
			affectedClaims: [ 'lifecycleStability' ]
		}
	];

}

function imageRole( path ) {

	return path.slice( 0, - '.png'.length ).replaceAll( '/', '.' ).replaceAll( '_', '-' );

}

export async function finalizeFrostRawEvidence( session, outputDir ) {

	if ( session?.labId !== 'webgpu-touch-history-frost' ) throw new Error( 'Frost finalizer received another lab session.' );
	const sessionFile = session.finalizedCaptureSessionFile;
	if ( sessionFile?.path !== SESSION_PATH ) throw new Error( 'Frost finalizer requires the finalized capture-session binding.' );
	const sessionBytes = await readFile( join( outputDir, SESSION_PATH ) );
	if ( sessionFile.sha256 !== sha256( sessionBytes ) || sessionFile.byteLength !== sessionBytes.byteLength ) throw new Error( 'Frost capture-session bytes drifted before finalization.' );
	const finalizedSession = JSON.parse( sessionBytes.toString( 'utf8' ) );
	if ( canonicalSha256( finalizedSession ) !== canonicalSha256( JSON.parse( JSON.stringify( session ) ) ) ) throw new Error( 'In-memory Frost session differs from its finalized document.' );
	const index = writeIndex( finalizedSession );
	const sourceClosureHash = finalizedSession.sourceClosureHash ?? finalizedSession.sourceHash;
	const suffix = sourceClosureHash.slice( 'sha256:'.length, 'sha256:'.length + 16 );
	const sessionId = `${ finalizedSession.labId }:correctness:${ suffix }`;
	const finalizedWrites = finalizedSession.artifactWrites.map( ( record ) => record.path === SESSION_PATH ? {
		sequence: record.sequence,
		path: SESSION_PATH,
		kind: 'capture-session-record',
		contentBinding: 'finalized-file-hash-for-offline-promotion',
		sha256: sessionFile.sha256,
		byteLength: sessionFile.byteLength
	} : structuredClone( record ) );
	const ledgerDocument = {
		schemaVersion: 2,
		labId: finalizedSession.labId,
		sessionId,
		profile: finalizedSession.profile,
		sourceClosureHash,
		buildRevision: finalizedSession.buildRevision,
		entries: finalizedWrites
	};
	const ledgerBytes = jsonBytes( ledgerDocument );
	await writeFile( join( outputDir, WRITE_LEDGER_PATH ), ledgerBytes );
	const documentBinding = binding( SESSION_PATH, sessionBytes, 'capture-session-document' );
	const ledgerBinding = binding( WRITE_LEDGER_PATH, ledgerBytes, 'capture-session-write-ledger' );

	if ( JSON.stringify( finalizedSession.hookResult?.normativeArtifacts ) !== JSON.stringify( FROST_NORMATIVE_JSON_PATHS ) ) throw new Error( 'Frost hook did not emit the frozen normative artifact set.' );
	const normative = [];
	for ( const path of REQUIRED_EVIDENCE_JSON ) {

		if ( path === MANIFEST_PATH ) {

			normative.push( selfExcludedManifestFile() );
			continue;

		}
		const { record } = await verifiedWrite( outputDir, index, path );
		normative.push( capturedEvidenceFile( path, 'normative-json', record ) );

	}
	const images = [];
	for ( const [ path, record ] of index ) {

		if ( path.endsWith( '.png' ) === false ) continue;
		await verifiedWrite( outputDir, index, path );
		if ( path === 'diagnostics.mosaic.png' ) {

			const derived = finalizedSession.hookResult.standardOutputs.find( ( output ) => output.filename === path );
			images.push( capturedEvidenceImage( {
				path,
				role: imageRole( path ),
				binding: record,
				kind: 'derived-image',
				sourceCaptures: derived.sourceCaptures,
				derivation: {
					method: 'deterministic four-route Frost diagnostic mosaic',
					implementation: 'threejs-dynamic-surface-effects/examples/webgpu-touch-history-frost/capture-hook.mjs',
					parametersDigest: canonicalSha256( derived.derivation )
				}
			} ) );

		} else images.push( capturedEvidenceImage( { path, role: imageRole( path ), binding: record } ) );

	}
	const supplemental = [];
	for ( const [ path, record ] of index ) {

		if ( path === SESSION_PATH || path.endsWith( '.png' ) || FROST_NORMATIVE_JSON_PATHS.includes( path ) ) continue;
		if ( path.endsWith( '.bin' ) ) {

			await verifiedWrite( outputDir, index, path );
			supplemental.push( capturedEvidenceFile( path, 'raw-readback', record ) );
			continue;

		}
		throw new Error( `Frost capture emitted an undeclared artifact ${ path }.` );

	}
	const route = frostRoute( finalizedSession );
	const limitations = frostLimitations();
	const captureSession = createRawCaptureSessionReference( {
		session: finalizedSession,
		route: { ...route, stateDigest: canonicalSha256( route ) },
		limitations,
		document: documentBinding,
		writeLedger: ledgerBinding
	} );
	if ( captureSession.sessionId !== sessionId ) throw new Error( 'Frost capture-session identity drifted during finalization.' );
	const manifest = createRawEvidenceManifest( {
		labId: finalizedSession.labId,
		skill: 'threejs-dynamic-surface-effects',
		sourceClosureHash,
		buildRevision: finalizedSession.buildRevision,
		route,
		limitations,
		claimVerdicts: {
			visualCorrectness: 'INSUFFICIENT_EVIDENCE',
			mechanismCorrectness: 'PASS',
			performanceCompliance: 'NOT_CLAIMED',
			gpuAttribution: 'NOT_CLAIMED',
			lifecycleStability: 'PASS',
			visualError: 'PASS'
		},
		captureSession,
		files: [
			...normative,
			capturedEvidenceFile( SESSION_PATH, 'capture-session-document', documentBinding ),
			capturedEvidenceFile( WRITE_LEDGER_PATH, 'capture-session-write-ledger', ledgerBinding ),
			...supplemental
		],
		images
	} );
	await writeFile( join( outputDir, MANIFEST_PATH ), jsonBytes( manifest ) );
	const validation = validateEvidenceBundle( outputDir );
	if ( validation.valid === false || validation.protocol !== 'unified-v2' ) throw new AggregateError( validation.errors.map( ( error ) => new Error( error ) ), 'Frost unified-v2 raw bundle validation failed.' );
	return validation;

}
