import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertCheckedJsonSchema, loadCheckedEvidenceSchemas } from './checked-json-schema.js';
import { validateUnifiedV2ArtifactBundle } from './evidence-bundle-v2.js';
import {
	NORMATIVE_JSON_PATHS,
	STANDARD_IMAGE_PATHS,
	assertEvidenceManifestContract,
	canonicalSha256,
	routeStateDigest
} from './evidence-manifest-contract.js';
import { validateCorrectnessCaptureSession } from './physical-session-validator.js';

const RAW_IMAGE_PATHS = Object.freeze( [
	...STANDARD_IMAGE_PATHS,
	'diagnostic.normal.png',
	'diagnostic.emissive.png',
	'odd-size.final.png'
] );
const MANIFEST_PATH = 'evidence-manifest.json';
const SESSION_PATH = 'capture-session.json';
const WRITE_LEDGER_PATH = 'capture-write-ledger.json';

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

function jsonBytes( value ) {

	return Buffer.from( `${ JSON.stringify( value, null, 2 ) }\n` );

}

function jsonSafe( value ) {

	if ( value === undefined ) return null;
	return JSON.parse( JSON.stringify( value ) );

}

function parseFinalizedCorrectnessSession( suppliedSession, sessionBytes ) {

	let parsedSession;
	try {

		parsedSession = JSON.parse( sessionBytes.toString( 'utf8' ) );

	} catch ( error ) {

		throw new Error( `Finalized capture-session.json is invalid JSON: ${ error.message }` );

	}
	const canonicalBytes = jsonBytes( parsedSession );
	if ( canonicalBytes.equals( sessionBytes ) === false ) throw new Error( 'Finalized capture-session.json is not the canonical two-space JSON document emitted by the shared capture runner.' );

	const enumerableSession = jsonSafe( suppliedSession );
	if ( canonicalSha256( enumerableSession ) !== canonicalSha256( parsedSession ) ) throw new Error( 'Supplied in-memory capture session canonically drifted from finalized capture-session.json.' );
	if ( jsonBytes( enumerableSession ).equals( sessionBytes ) === false ) throw new Error( 'Supplied in-memory capture session enumerable serialization drifted from finalized capture-session.json.' );

	validateCorrectnessCaptureSession( parsedSession );
	return parsedSession;

}

function requireSha256( value, label ) {

	if ( /^sha256:[0-9a-f]{64}$/.test( value ?? '' ) === false ) throw new Error( `${ label } must be a sha256: digest.` );
	return value;

}

function requireChoice( choices, value, label ) {

	if ( choices.includes( value ) === false ) throw new Error( `${ label } must be one of ${ choices.join( ', ' ) }.` );
	return value;

}

function normalizeSeed( value ) {

	if ( typeof value === 'string' && /^0x[0-9a-f]{8}$/.test( value ) ) return value;
	if ( Number.isInteger( value ) && value >= 0 && value <= 0xffffffff ) return `0x${ ( value >>> 0 ).toString( 16 ).padStart( 8, '0' ) }`;
	throw new Error( 'Raw capture route requires a uint32 seed.' );

}

function captureRoute( session ) {

	const state = session.finalRuntime?.metrics ?? session.route?.finalState ?? session.route?.observedState ?? {};
	const route = {
		path: state.tier === 'webgpu-correctness'
			? '/demos/webgpu-validation-harness/tier/webgpu-correctness/'
			: '/demos/webgpu-validation-harness/',
		scenario: state.scenario ?? 'browser-capture',
		mechanism: null,
		mode: state.mode ?? 'final',
		tier: state.tier ?? 'webgpu-correctness',
		camera: state.camera ?? 'design',
		seed: normalizeSeed( state.seedHex ?? state.seed ?? 1 ),
		timeSeconds: {
			value: state.timeSeconds ?? 0,
			unit: 'seconds',
			label: 'Measured',
			source: 'final LabController correctness-capture state'
		}
	};
	route.stateDigest = routeStateDigest( route );
	return route;

}

function limitationsForRawCorrectness() {

	return [
		{
			id: 'visual-review-pending',
			status: 'ACTIVE',
			statement: 'The deterministic readbacks have not yet received the separate authored visual review required for release promotion.',
			affectedClaims: [ 'visualCorrectness' ]
		},
		{
			id: 'physical-route-not-joined',
			status: 'ACTIVE',
			statement: 'The immutable Codex in-app Browser physical-route session has not been joined to this raw correctness lane.',
			affectedClaims: [ 'visualCorrectness', 'mechanismCorrectness' ]
		},
		{
			id: 'hardware-performance-not-claimed',
			status: 'ACTIVE',
			statement: 'This Playwright correctness lane does not claim physical-browser cadence or hardware GPU performance.',
			affectedClaims: [ 'performanceCompliance', 'gpuAttribution' ]
		}
	];

}

function currentWriteIndex( session ) {

	if ( Array.isArray( session.artifactWrites ) === false ) throw new Error( 'Finalized capture session has no immutable artifact write ledger.' );
	const index = new Map();
	for ( const record of session.artifactWrites ) {

		if ( typeof record?.path !== 'string' || record.path.length === 0 || index.has( record.path ) ) throw new Error( `Capture write ledger has an invalid or duplicate path ${ record?.path ?? '<missing>' }.` );
		index.set( record.path, record );

	}
	if ( index.has( MANIFEST_PATH ) ) throw new Error( 'The browser hook must not write evidence-manifest.json; raw-session finalization owns that self-excluded file.' );
	return index;

}

async function requireCurrentWrite( outputDir, writeIndex, path ) {

	const record = writeIndex.get( path );
	if ( record?.contentBinding !== 'sha256-byte-length-immutable-buffer-v1' ) throw new Error( `Current capture did not content-bind ${ path }.` );
	const bytes = await readFile( join( outputDir, path ) );
	if ( record.byteLength !== bytes.byteLength || record.sha256 !== sha256( bytes ) ) throw new Error( `Current capture binding drifted for ${ path }.` );
	return { record, bytes };

}

function selfManifestFile() {

	return {
		path: MANIFEST_PATH,
		status: 'self-excluded',
		kind: 'evidence-manifest',
		reason: 'The evidence manifest cannot bind its own final serialized bytes.'
	};

}

function capturedFile( path, kind, binding ) {

	return {
		path,
		status: 'captured',
		kind,
		sha256: binding.sha256,
		byteLength: binding.byteLength
	};

}

function capturedImage( path, binding, hookResult ) {

	const role = path.slice( 0, - '.png'.length );
	if ( path !== 'diagnostics.mosaic.png' ) return {
		path,
		status: 'captured',
		kind: 'direct-capture',
		role,
		mediaType: 'image/png',
		sha256: binding.sha256,
		byteLength: binding.byteLength
	};
	const derived = hookResult?.standardOutputs?.find( ( output ) => output.filename === path );
	const sourceCaptures = derived?.sourceCaptures ?? [
		'final.design.png',
		'no-post.design.png',
		'diagnostic.normal.png',
		'diagnostic.emissive.png'
	];
	return {
		path,
		status: 'captured',
		kind: 'derived-image',
		role,
		mediaType: 'image/png',
		sha256: binding.sha256,
		byteLength: binding.byteLength,
		derivation: {
			method: 'deterministic four-route diagnostic contact sheet',
			implementation: 'capture-hook.mjs',
			parametersDigest: canonicalSha256( derived?.derivation ?? { sourceCaptures } )
		},
		sourceCaptures
	};

}

function rawClaimVerdicts( session ) {

	const candidate = session.hookResult?.bundle?.claimVerdicts ?? {};
	const mechanismCorrectness = requireChoice(
		[ 'PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE' ],
		candidate.mechanismCorrectness ?? 'INSUFFICIENT_EVIDENCE',
		'mechanism correctness verdict'
	);
	const lifecycleStability = requireChoice(
		[ 'PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE' ],
		candidate.lifecycleStability ?? 'INSUFFICIENT_EVIDENCE',
		'lifecycle stability verdict'
	);
	return {
		visualCorrectness: 'INSUFFICIENT_EVIDENCE',
		mechanismCorrectness,
		performanceCompliance: 'NOT_CLAIMED',
		gpuAttribution: 'NOT_CLAIMED',
		lifecycleStability,
		visualError: 'PASS'
	};

}

function identity( kind, value ) {

	return { kind, digest: canonicalSha256( jsonSafe( value ) ) };

}

function captureSessionReference( session, route, limitations, document, writeLedger ) {

	const metrics = session.finalRuntime?.metrics ?? session.runtime?.metrics ?? {};
	if ( metrics.initialized !== true || metrics.nativeWebGPU !== true || metrics.rendererBackendEvidence?.isWebGPUBackend !== true ) throw new Error( 'Raw capture finalization requires initialized native WebGPU proof from the final runtime snapshot.' );
	const profile = requireChoice( [ 'correctness', 'physical-route', 'performance' ], session.profile, 'capture profile' );
	const adapterClass = requireChoice( [ 'hardware', 'software', 'unknown' ], session.adapterClass, 'adapter class' );
	const sourceClosureHash = requireSha256( session.sourceClosureHash ?? session.sourceHash, 'capture source closure hash' );
	const buildRevision = requireSha256( session.buildRevision, 'capture build revision' );
	const timestampFeatures = metrics.adapter?.features ?? metrics.adapterIdentity?.features ?? [];
	return {
		sessionId: `${ session.labId }:${ profile }:${ sourceClosureHash.slice( 'sha256:'.length, 'sha256:'.length + 16 ) }`,
		profile,
		automationSurface: session.automationSurface,
		adapterClass,
		adapterIdentity: identity( 'gpu-adapter', session.adapterIdentity ?? metrics.adapterIdentity ?? metrics.adapter ),
		deviceIdentity: identity( 'gpu-device', {
			adapterIdentity: session.adapterIdentity ?? metrics.adapterIdentity ?? metrics.adapter,
			rendererBackendEvidence: metrics.rendererBackendEvidence,
			rendererDeviceGeneration: metrics.rendererDeviceGeneration
		} ),
		browserIdentity: identity( 'browser', session.browser ),
		osIdentity: identity( 'operating-system', { platform: session.browser?.platform ?? 'unavailable' } ),
		refreshIdentity: identity( 'display-refresh', { status: 'unmeasured-correctness-lane' } ),
		colorIdentity: identity( 'color-pipeline', metrics.rendererState ),
		limitationsDigest: canonicalSha256( limitations ),
		threeRevision: '0.185.1',
		sourceClosureHash,
		buildRevision,
		startedAt: session.startedAt,
		finishedAt: session.finishedAt,
		routePath: route.path,
		routeDigest: canonicalSha256( route ),
		stateDigest: route.stateDigest,
		document,
		writeLedger,
		rendererInitialized: true,
		isWebGPUBackend: true,
		timestampQuerySupported: Array.isArray( timestampFeatures ) && timestampFeatures.includes( 'timestamp-query' )
	};

}

function promotionNotEligible() {

	return {
		status: 'NOT_ELIGIBLE',
		binding: null,
		bindingDigest: null,
		visualSignoff: {
			status: 'NOT_REVIEWED',
			reviewer: null,
			reviewedAt: null,
			reviewDigest: null,
			reviewedImages: [],
			notes: []
		}
	};

}

export async function finalizeRawCorrectnessCapture( session, outputDir ) {

	if ( typeof outputDir !== 'string' || outputDir.length === 0 ) throw new Error( 'Raw correctness finalization requires its output directory.' );
	const sessionBinding = session?.finalizedCaptureSessionFile;
	if ( sessionBinding?.path !== SESSION_PATH || sessionBinding.contentBinding !== 'finalized-file-hash-for-offline-promotion' ) throw new Error( 'Finalized shared capture-session binding is unavailable.' );
	const sessionBytes = await readFile( join( outputDir, SESSION_PATH ) );
	if ( sessionBinding.sha256 !== sha256( sessionBytes ) || sessionBinding.byteLength !== sessionBytes.byteLength ) throw new Error( 'Finalized capture-session bytes drifted before raw manifest assembly.' );
	const finalizedSessionBinding = {
		path: SESSION_PATH,
		contentBinding: 'finalized-file-hash-for-offline-promotion',
		sha256: sha256( sessionBytes ),
		byteLength: sessionBytes.byteLength
	};
	const finalizedSession = parseFinalizedCorrectnessSession( session, sessionBytes );
	const writeIndex = currentWriteIndex( finalizedSession );

	const route = captureRoute( finalizedSession );
	const limitations = limitationsForRawCorrectness();
	const sourceClosureHash = requireSha256( finalizedSession.sourceClosureHash ?? finalizedSession.sourceHash, 'capture source closure hash' );
	const suffix = sourceClosureHash.slice( 'sha256:'.length, 'sha256:'.length + 16 );
	const sessionId = `${ finalizedSession.labId }:correctness:${ suffix }`;
	const finalizedWrites = finalizedSession.artifactWrites.map( ( record ) => record.path === SESSION_PATH ? {
		sequence: record.sequence,
		path: SESSION_PATH,
		kind: 'capture-session-record',
		contentBinding: 'finalized-file-hash-for-offline-promotion',
		sha256: finalizedSessionBinding.sha256,
		byteLength: finalizedSessionBinding.byteLength
	} : jsonSafe( record ) );
	const writeLedgerDocument = {
		schemaVersion: 2,
		labId: finalizedSession.labId,
		sessionId,
		profile: finalizedSession.profile,
		sourceClosureHash,
		buildRevision: finalizedSession.buildRevision,
		entries: finalizedWrites
	};
	const writeLedgerBytes = jsonBytes( writeLedgerDocument );
	await writeFile( join( outputDir, WRITE_LEDGER_PATH ), writeLedgerBytes );
	const writeLedgerBinding = {
		kind: 'capture-session-write-ledger',
		path: WRITE_LEDGER_PATH,
		sha256: sha256( writeLedgerBytes ),
		byteLength: writeLedgerBytes.byteLength
	};
	const documentBinding = {
		kind: 'capture-session-document',
		path: SESSION_PATH,
		sha256: finalizedSessionBinding.sha256,
		byteLength: finalizedSessionBinding.byteLength
	};

	const normative = [];
	for ( const path of NORMATIVE_JSON_PATHS ) {

		if ( path === MANIFEST_PATH ) {

			normative.push( selfManifestFile() );
			continue;

		}
		const { record } = await requireCurrentWrite( outputDir, writeIndex, path );
		normative.push( capturedFile( path, 'normative-json', record ) );

	}
	const images = [];
	for ( const path of RAW_IMAGE_PATHS ) {

		const { record } = await requireCurrentWrite( outputDir, writeIndex, path );
		images.push( capturedImage( path, record, finalizedSession.hookResult ) );

	}
	const consumed = new Set( [ ...NORMATIVE_JSON_PATHS, ...RAW_IMAGE_PATHS, SESSION_PATH ] );
	const supplemental = [];
	for ( const [ path, record ] of writeIndex ) {

		if ( consumed.has( path ) ) continue;
		if ( path.endsWith( '.png' ) ) throw new Error( `Current capture emitted undeclared image ${ path }.` );
		if ( path.endsWith( '.json' ) ) supplemental.push( capturedFile( path, 'supplementary-json', record ) );
		else if ( path.startsWith( 'transport-readbacks/' ) || path.startsWith( 'normalized-readbacks/' ) ) supplemental.push( capturedFile( path, 'raw-readback', record ) );
		else throw new Error( `Current capture emitted an unclassified artifact ${ path }.` );

	}
	const captureSession = captureSessionReference(
		finalizedSession,
		route,
		limitations,
		documentBinding,
		writeLedgerBinding
	);
	if ( captureSession.sessionId !== sessionId ) throw new Error( 'Capture-session identity changed during raw manifest assembly.' );
	const manifest = {
		schemaVersion: 2,
		labId: finalizedSession.labId,
		bundleId: `${ finalizedSession.labId }:raw-correctness:${ suffix }:v2`,
		bundleKind: 'raw-capture-session',
		publishable: false,
		skill: 'threejs-visual-validation',
		threeRevision: '0.185.1',
		sourceClosureHash,
		buildRevision: finalizedSession.buildRevision,
		route,
		limitations,
		claimVerdicts: rawClaimVerdicts( finalizedSession ),
		captureSessions: [ captureSession ],
		files: [
			...normative,
			capturedFile( SESSION_PATH, 'capture-session-document', finalizedSessionBinding ),
			capturedFile( WRITE_LEDGER_PATH, 'capture-session-write-ledger', writeLedgerBinding ),
			...supplemental
		],
		images,
		promotion: promotionNotEligible()
	};
	const schemas = await loadCheckedEvidenceSchemas();
	assertCheckedJsonSchema( schemas.evidenceManifest, manifest, 'raw evidence-manifest.json' );
	assertEvidenceManifestContract( manifest );
	await writeFile( join( outputDir, MANIFEST_PATH ), jsonBytes( manifest ) );
	return validateUnifiedV2ArtifactBundle( outputDir );

}

export { RAW_IMAGE_PATHS };
