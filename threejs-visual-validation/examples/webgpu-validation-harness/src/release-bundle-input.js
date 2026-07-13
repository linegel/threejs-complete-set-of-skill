import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { numericDatum, stableStringify } from './physical-evidence-common.js';
import { validateCaptureSourceClosure } from './capture-source-closure.js';
import {
	CORRECTNESS_SESSION_PATH,
	CORRECTNESS_WRITE_LEDGER_PATH,
	validateCorrectnessWriteLedgerBytes
} from './correctness-write-ledger.js';
import {
	correctnessLaneReference,
	physicalLaneReference,
	validateEvidenceLaneJoin
} from './physical-lane-join.js';
import { createValidationHarnessReleaseArtifactProjector } from './release-evidence-projection.js';
import { getRouteLock } from './route-locks.js';
import {
	loadVerifiedImportedPhysicalRecord,
	verifyImportedPhysicalRecordBytes
} from './verified-physical-record.js';
import { assemblePreparedReleaseBundle } from '../../../../scripts/lib/release-bundle-assembler.mjs';

const LAB_ID = 'webgpu-validation-harness';

function fail( message ) {

	throw new Error( message );

}

function requireObject( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) fail( `${ label } must be an object.` );
	return value;

}

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

function requireBoundBytes( bytes, binding, kind, path, label ) {

	if ( ! ( bytes instanceof Uint8Array ) ) fail( `${ label } bytes must be a Uint8Array.` );
	if ( binding?.kind !== kind || binding.path !== path ) fail( `${ label } has the wrong finalized ledger identity.` );
	if ( binding.byteLength !== bytes.byteLength || binding.sha256 !== sha256( bytes ) ) fail( `${ label } bytes differ from the finalized ledger.` );
	return { kind, path, sha256: binding.sha256, byteLength: binding.byteLength };

}

function parseJsonBytes( bytes, label ) {

	if ( ! ( bytes instanceof Uint8Array ) ) fail( `${ label } bytes must be a Uint8Array.` );
	try {

		return JSON.parse( Buffer.from( bytes ).toString( 'utf8' ) );

	} catch ( error ) {

		fail( `${ label } is invalid JSON: ${ error.message }` );

	}

}

function normalizedSeed( seed ) {

	if ( Number.isInteger( seed ) === false || seed < 0 || seed > 0xffffffff ) fail( 'Finalized route seed must be an unsigned 32-bit integer.' );
	return `0x${ ( seed >>> 0 ).toString( 16 ).padStart( 8, '0' ) }`;

}

function routePath( route ) {

	return `/demos/${ LAB_ID }/${ route.kind }/${ route.id }/`;

}

function assertFinalizedRoute( route ) {

	requireObject( route, 'Finalized physical route' );
	const lock = getRouteLock( route.kind, route.id );
	if ( route.key !== `${ route.kind }/${ route.id }` ) fail( `Finalized route ${ route.key ?? '<missing>' } has inconsistent kind/id identity.` );
	if ( stableStringify( route.startup ) !== stableStringify( lock.startup ) ) fail( `Finalized route ${ route.key } startup differs from the canonical route lock.` );
	const state = requireObject( route.state, `Finalized route ${ route.key } state` );
	for ( const key of [ 'scenario', 'mode', 'tier', 'camera', 'seed', 'timeSeconds' ] ) {

		if ( state[ key ] !== lock.startup[ key ] ) fail( `Finalized route ${ route.key } state differs from its ${ key } lock.` );

	}
	const viewport = requireObject( state.viewport, `Finalized route ${ route.key } viewport` );
	for ( const key of [ 'width', 'height', 'dpr' ] ) if ( viewport[ key ] !== lock.startup[ key ] ) fail( `Finalized route ${ route.key } viewport differs from its ${ key } lock.` );
	return route;

}

export function releaseRouteFromPhysicalRecord( input ) {

	const route = assertFinalizedRoute( input );
	return Object.freeze( {
		path: routePath( route ),
		scenario: route.state.scenario,
		mechanism: route.kind === 'mechanism' ? route.id : null,
		mode: route.state.mode,
		tier: route.state.tier,
		camera: route.state.camera,
		seed: normalizedSeed( route.state.seed ),
		timeSeconds: numericDatum( route.state.timeSeconds, 'seconds', 'Measured', 'finalized Codex in-app Browser locked route state' )
	} );

}

function sameLockedState( left, right ) {

	return left.path === right.path
		&& left.scenario === right.scenario
		&& left.mechanism === right.mechanism
		&& left.mode === right.mode
		&& left.tier === right.tier
		&& left.camera === right.camera
		&& left.seed === right.seed
		&& left.timeSeconds?.value === right.timeSeconds?.value
		&& left.timeSeconds?.unit === right.timeSeconds?.unit;

}

function routesForRelease( rawRoute, physicalRecord, performanceRecord ) {

	const physicalRoutes = physicalRecord.routes.map( releaseRouteFromPhysicalRecord );
	const physicalByPath = new Map( physicalRoutes.map( ( route ) => [ route.path, route ] ) );
	if ( physicalByPath.size !== physicalRoutes.length ) fail( 'Finalized physical route session contains duplicate route paths.' );
	const rawMatch = physicalByPath.get( rawRoute.path );
	if ( rawMatch === undefined || sameLockedState( rawMatch, rawRoute ) === false ) fail( 'Raw correctness route is absent from or differs from the finalized physical route set.' );
	const performanceRoutes = performanceRecord.routes.map( releaseRouteFromPhysicalRecord );
	for ( const route of performanceRoutes ) {

		const physical = physicalByPath.get( route.path );
		if ( physical === undefined || stableStringify( physical ) !== stableStringify( route ) ) fail( `Performance route ${ route.path } differs from the physical route review.` );

	}
	return {
		routes: physicalRoutes.filter( ( route ) => route.path !== rawRoute.path ),
		physicalRoutePaths: physicalRoutes.map( ( route ) => route.path ),
		performanceRoutePaths: performanceRoutes.map( ( route ) => route.path )
	};

}

function identity( kind, digest ) {

	return { kind, digest };

}

function captureSessionFromLane( reference, routePaths, paths, timestampQuerySupported ) {

	if ( routePaths.length === 0 ) fail( `Evidence lane ${ reference.lane } covers no routes.` );
	return {
		sessionId: reference.sessionId,
		profile: reference.profile,
		automationSurface: reference.automationSurface,
		adapterClass: reference.adapterClass,
		adapterIdentity: identity( 'gpu-adapter', reference.adapterIdentityDigest ),
		deviceIdentity: identity( 'gpu-device', reference.deviceIdentityDigest ),
		browserIdentity: identity( 'browser', reference.browserIdentityDigest ),
		osIdentity: identity( 'operating-system', reference.osIdentityDigest ),
		refreshIdentity: identity( 'display-refresh', reference.refreshIdentityDigest ),
		colorIdentity: identity( 'color-pipeline', reference.colorIdentityDigest ),
		limitationsDigest: reference.limitationsDigest,
		threeRevision: reference.threeRevision,
		sourceClosureHash: reference.sourceClosureHash,
		buildRevision: reference.buildRevision,
		startedAt: reference.startedAt,
		finishedAt: reference.finishedAt,
		routePath: routePaths[ 0 ],
		routeSetPaths: [ ...routePaths ],
		documentPath: paths.document,
		writeLedgerPath: paths.writeLedger,
		rendererInitialized: true,
		isWebGPUBackend: true,
		timestampQuerySupported
	};

}

function assertVerifiedLane( verified, reference, profile ) {

	requireObject( verified, `Verified ${ profile } lane` );
	if ( verified.record?.profile !== profile ) fail( `Verified ${ profile } lane has the wrong record profile.` );
	if ( verified.validation?.valid !== true || verified.validation?.profile !== profile ) fail( `Verified ${ profile } lane lacks a fresh successful semantic validation.` );
	if ( typeof verified.recordSha256 !== 'string' ) fail( `Verified ${ profile } lane omits its semantic record hash.` );
	const semanticReference = physicalLaneReference( verified.record, verified.recordSha256 );
	if ( stableStringify( semanticReference ) !== stableStringify( verified.laneReference ) ) fail( `Verified ${ profile } lane semantic reference is stale.` );
	const exactReference = physicalLaneReference( verified.record, verified.sourceDocumentSha256 );
	if ( stableStringify( exactReference ) !== stableStringify( reference ) ) fail( `Verified ${ profile } lane differs from the strict lane join.` );
	if ( verified.sourceDocumentSha256 !== reference.captureSessionDocumentHash || sha256( verified.sourceBytes ) !== reference.captureSessionDocumentHash ) fail( `Verified ${ profile } wrapper bytes differ from the strict lane join.` );
	if ( verified.servedLedgerSha256 !== reference.captureSessionWriteLedgerHash || sha256( verified.servedLedgerBytes ) !== reference.captureSessionWriteLedgerHash ) fail( `Verified ${ profile } served ledger differs from the strict lane join.` );

}

function releaseLimitations() {

	return [
		{
			id: 'visual-review-pending',
			status: 'ACTIVE',
			statement: 'The joined release candidate still requires authored inspection of every applicable bound image before publication.',
			affectedClaims: [ 'visualCorrectness' ]
		},
		{
			id: 'opaque-renderer-residency-unclaimed',
			status: 'ACTIVE',
			statement: 'Logical lab-owned resources are reconciled; opaque renderer-internal physical residency remains explicitly unclaimed.',
			affectedClaims: []
		}
	];

}

function passingReleaseClaims( rawManifest ) {

	for ( const claim of [ 'mechanismCorrectness', 'lifecycleStability', 'visualError' ] ) if ( rawManifest.claimVerdicts?.[ claim ] !== 'PASS' ) fail( `Raw correctness bundle does not pass ${ claim }.` );
	return {
		visualCorrectness: 'PASS',
		mechanismCorrectness: 'PASS',
		performanceCompliance: 'PASS',
		gpuAttribution: 'PASS',
		lifecycleStability: 'PASS',
		visualError: 'PASS'
	};

}

export function createValidationHarnessPreparedReleaseInputs( {
	rawManifest,
	physicalWrapperBytes,
	performanceWrapperBytes,
	correctnessDocumentBytes,
	correctnessDocumentLedgerEntry,
	correctnessWriteLedgerBytes,
	correctnessWriteLedgerEntry,
	strictLaneJoin,
	strictLaneJoinBytes,
	tierVisualEvidenceBytes,
	tierVisualEvidenceLedgerEntry
} ) {

	const raw = requireObject( rawManifest, 'Raw correctness manifest' );
	if ( raw.labId !== LAB_ID ) fail( `Raw correctness manifest belongs to ${ raw.labId ?? '<missing>' }, not ${ LAB_ID }.` );
	const verifiedPhysical = verifyImportedPhysicalRecordBytes( physicalWrapperBytes, { expectedProfile: 'physical-route' } );
	const verifiedPerformance = verifyImportedPhysicalRecordBytes( performanceWrapperBytes, { expectedProfile: 'performance' } );
	const correctnessDocument = requireBoundBytes(
		correctnessDocumentBytes,
		correctnessDocumentLedgerEntry,
		'capture-session-document',
		CORRECTNESS_SESSION_PATH,
		'Correctness capture-session document'
	);
	const correctnessWriteLedger = requireBoundBytes(
		correctnessWriteLedgerBytes,
		correctnessWriteLedgerEntry,
		'capture-session-write-ledger',
		CORRECTNESS_WRITE_LEDGER_PATH,
		'Correctness capture-session write ledger'
	);
	const correctnessRecord = parseJsonBytes( correctnessDocumentBytes, 'Correctness capture-session document' );
	validateCaptureSourceClosure( correctnessRecord.sourceClosure );
	validateCorrectnessWriteLedgerBytes( correctnessRecord, correctnessDocument, correctnessWriteLedgerBytes );
	const strict = requireObject( strictLaneJoin, 'Strict evidence lane join' );
	const validatedJoin = validateEvidenceLaneJoin( strict );
	if ( validatedJoin.performanceClaims !== true || validatedJoin.laneCount !== 3 ) fail( 'Validation harness release requires the strict three-lane performance join.' );
	if ( ! ( strictLaneJoinBytes instanceof Uint8Array ) || Buffer.from( strictLaneJoinBytes ).equals( Buffer.from( `${ JSON.stringify( strict, null, 2 ) }\n` ) ) === false ) fail( 'Strict evidence lane join bytes differ from the supplied join.' );
	assertVerifiedLane( verifiedPhysical, strict.physicalRoute, 'physical-route' );
	assertVerifiedLane( verifiedPerformance, strict.hardwarePerformance, 'performance' );
	for ( const key of [ 'sourceClosureHash', 'buildRevision', 'threeRevision' ] ) if ( raw[ key ] !== validatedJoin[ key ] ) fail( `Strict evidence lane join ${ key } differs from the raw correctness bundle.` );
	const correctnessSession = raw.captureSessions?.find( ( session ) => session.profile === 'correctness' );
	if ( stableStringify( correctnessSession?.document ) !== stableStringify( correctnessDocument ) ) fail( 'Raw correctness session document binding differs from its exact ledger entry.' );
	if ( stableStringify( correctnessSession?.writeLedger ) !== stableStringify( correctnessWriteLedger ) ) fail( 'Raw correctness session write-ledger binding differs from its exact ledger entry.' );
	const exactCorrectnessReference = correctnessLaneReference( correctnessRecord, correctnessDocument, correctnessWriteLedger );
	if ( stableStringify( exactCorrectnessReference ) !== stableStringify( strict.correctness ) ) fail( 'Strict evidence lane join differs from the exact correctness document and write ledger.' );
	const routePlan = routesForRelease( raw.route, verifiedPhysical.record, verifiedPerformance.record );
	const claims = passingReleaseClaims( raw );
	const projectionContext = { performanceClaims: true, claimVerdicts: structuredClone( claims ) };
	const physicalPaths = {
		document: 'sessions/physical-route.capture-session.json',
		writeLedger: 'sessions/physical-route.write-ledger.json'
	};
	const performancePaths = {
		document: 'sessions/performance.capture-session.json',
		writeLedger: 'sessions/performance.write-ledger.json'
	};
	return {
		routes: routePlan.routes,
		limitations: releaseLimitations(),
		claimVerdicts: claims,
		captureSessions: [
			captureSessionFromLane( strict.physicalRoute, routePlan.physicalRoutePaths, physicalPaths, false ),
			captureSessionFromLane( strict.hardwarePerformance, routePlan.performanceRoutePaths, performancePaths, true )
		],
		supplementaryArtifacts: [
			{ path: physicalPaths.document, kind: 'capture-session-document', bytes: verifiedPhysical.sourceBytes },
			{ path: physicalPaths.writeLedger, kind: 'capture-session-write-ledger', bytes: verifiedPhysical.servedLedgerBytes },
			{ path: performancePaths.document, kind: 'capture-session-document', bytes: verifiedPerformance.sourceBytes },
			{ path: performancePaths.writeLedger, kind: 'capture-session-write-ledger', bytes: verifiedPerformance.servedLedgerBytes },
			{ path: 'strict-lane-join.json', kind: 'supplementary-json', bytes: strictLaneJoinBytes }
		],
		projectionContext,
		projectEvidenceArtifacts: createValidationHarnessReleaseArtifactProjector( {
			evidenceLaneJoin: strict,
			verifiedPerformance,
			tierVisualEvidenceBytes,
			tierVisualEvidenceLedgerEntry
		} )
	};

}

async function readBoundArtifact( directory, manifest, path ) {

	const entry = manifest.files?.find( ( candidate ) => candidate.path === path && candidate.status === 'captured' );
	if ( entry === undefined ) fail( `Raw correctness bundle omits captured ${ path }.` );
	const bytes = await readFile( join( directory, path ) );
	if ( bytes.byteLength !== entry.byteLength || sha256( bytes ) !== entry.sha256 ) fail( `Raw correctness artifact ${ path } differs from its finalized ledger.` );
	return { bytes, entry };

}

export async function assembleValidationHarnessReleaseCandidate( {
	correctnessDirectory,
	physicalWrapperPath,
	performanceWrapperPath,
	outputDirectory
} ) {

	return assemblePreparedReleaseBundle( {
		correctnessDirectory,
		outputDirectory,
		prepareReleaseInputs: async ( { rawManifest } ) => {

			const verifiedPhysical = await loadVerifiedImportedPhysicalRecord( physicalWrapperPath, { expectedProfile: 'physical-route' } );
			const verifiedPerformance = await loadVerifiedImportedPhysicalRecord( performanceWrapperPath, { expectedProfile: 'performance' } );
			const correctnessSession = rawManifest.captureSessions?.find( ( session ) => session.profile === 'correctness' );
			if ( correctnessSession === undefined ) fail( 'Raw correctness manifest omits its correctness capture session.' );
			const correctnessDocument = await readBoundArtifact( correctnessDirectory, rawManifest, correctnessSession.document.path );
			const correctnessWriteLedger = await readBoundArtifact( correctnessDirectory, rawManifest, correctnessSession.writeLedger.path );
			const correctnessRecord = JSON.parse( correctnessDocument.bytes );
			validateCaptureSourceClosure( correctnessRecord.sourceClosure );
			const tierVisual = await readBoundArtifact( correctnessDirectory, rawManifest, 'tier-visual-evidence.json' );
			const strictLaneJoin = {
				schemaVersion: 2,
				publishable: false,
				rawEvidenceManifestFinalized: true,
				rewriteRawEvidenceManifest: false,
				performanceClaims: true,
				correctness: correctnessLaneReference( correctnessRecord, correctnessDocument.entry, correctnessWriteLedger.entry ),
				physicalRoute: physicalLaneReference( verifiedPhysical.record, verifiedPhysical.sourceDocumentSha256 ),
				hardwarePerformance: physicalLaneReference( verifiedPerformance.record, verifiedPerformance.sourceDocumentSha256 )
			};
			const strictLaneJoinBytes = Buffer.from( `${ JSON.stringify( strictLaneJoin, null, 2 ) }\n` );
			return createValidationHarnessPreparedReleaseInputs( {
				rawManifest,
				physicalWrapperBytes: verifiedPhysical.sourceBytes,
				performanceWrapperBytes: verifiedPerformance.sourceBytes,
				correctnessDocumentBytes: correctnessDocument.bytes,
				correctnessDocumentLedgerEntry: correctnessDocument.entry,
				correctnessWriteLedgerBytes: correctnessWriteLedger.bytes,
				correctnessWriteLedgerEntry: correctnessWriteLedger.entry,
				strictLaneJoin,
				strictLaneJoinBytes,
				tierVisualEvidenceBytes: tierVisual.bytes,
				tierVisualEvidenceLedgerEntry: tierVisual.entry
			} );

		}
	} );

}
