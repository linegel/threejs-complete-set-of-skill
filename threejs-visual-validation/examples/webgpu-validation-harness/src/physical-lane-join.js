import { createHash } from 'node:crypto';

import { CORRECTNESS_PROFILE, HARDWARE_PERFORMANCE_PROFILE, PHYSICAL_ROUTE_PROFILE, stableStringify } from './physical-evidence-common.js';
import { CORRECTNESS_SESSION_PATH, CORRECTNESS_WRITE_LEDGER_PATH } from './correctness-write-ledger.js';
import { validateCorrectnessCaptureSession } from './physical-session-validator.js';

const SHA256 = /^sha256:[a-f0-9]{64}$/;

const PORTABLE_JOIN_KEYS = Object.freeze( [
	'correctness',
	'hardwarePerformance',
	'performanceClaims',
	'physicalRoute',
	'publishable',
	'rawEvidenceManifestFinalized',
	'rewriteRawEvidenceManifest',
	'schemaVersion'
] );

const LANE_CONTRACTS = Object.freeze( {
	correctness: Object.freeze( { profile: CORRECTNESS_PROFILE, automationSurface: 'playwright-headless-chromium', adapterClasses: Object.freeze( [ 'hardware', 'software' ] ) } ),
	physicalRoute: Object.freeze( { profile: PHYSICAL_ROUTE_PROFILE, automationSurface: 'codex-in-app-browser', adapterClasses: Object.freeze( [ 'hardware' ] ) } ),
	hardwarePerformance: Object.freeze( { profile: HARDWARE_PERFORMANCE_PROFILE, automationSurface: 'codex-in-app-browser', adapterClasses: Object.freeze( [ 'hardware' ] ) } )
} );

const IMMUTABLE_IDENTITY_FIELDS = Object.freeze( [
	'adapterIdentityDigest',
	'browserIdentityDigest',
	'deviceIdentityDigest',
	'osIdentityDigest',
	'refreshIdentityDigest',
	'colorIdentityDigest',
	'limitationsDigest',
	'routeDigest',
	'stateDigest',
	'routeStateDigest',
	'captureSessionDocumentHash',
	'captureSessionWriteLedgerHash',
	'sourceClosureHash',
	'buildRevision'
] );

function stableHash( value ) {

	return `sha256:${ createHash( 'sha256' ).update( stableStringify( value ) ).digest( 'hex' ) }`;

}

function uniqueSignatures( values ) {

	return [ ...new Set( values.map( ( value ) => stableStringify( value ) ) ) ].sort().map( ( value ) => JSON.parse( value ) );

}

export function physicalEnvironmentIdentities( record ) {

	const routes = record.routes ?? [];
	const refreshHz = record.refresh?.hz?.value;
	if ( Number.isFinite( refreshHz ) === false || refreshHz <= 0 ) throw new Error( 'Physical environment identity requires a positive measured refresh rate.' );
	return Object.freeze( {
		adapter: stableHash( record.adapter?.identity ),
		browser: stableHash( record.browser ),
		device: stableHash( {
			adapter: record.adapter?.identity,
			backendContracts: uniqueSignatures( routes.map( ( route ) => ( {
				isWebGPUBackend: route.backend?.isWebGPUBackend,
				initialized: route.backend?.initialized,
				deviceIdentityVerified: route.backend?.deviceIdentityVerified
			} ) ) )
		} ),
		os: stableHash( {
			platform: record.browser?.platform,
			userAgentDataPlatform: record.browser?.userAgentDataPlatform
		} ),
		refresh: stableHash( {
			method: 'foreground-idle-request-animation-frame',
			nominalHz: Math.round( refreshHz )
		} ),
		color: stableHash( {
			readbackContracts: uniqueSignatures( routes.map( ( route ) => ( {
				resourceFormat: route.readback?.resourceFormat,
				copyFormat: route.readback?.format,
				colorManaged: route.readback?.colorManaged,
				outputColorSpace: route.readback?.outputColorSpace,
				encoding: route.readback?.encoding,
				origin: route.readback?.origin
			} ) ) )
		} )
	} );

}

export function laneIdentityBindingDigest( reference ) {

	return stableHash( {
		lane: reference.lane,
		profile: reference.profile,
		automationSurface: reference.automationSurface,
		adapterClass: reference.adapterClass,
		adapterIdentityDigest: reference.adapterIdentityDigest,
		browserIdentityDigest: reference.browserIdentityDigest,
		deviceIdentityType: reference.deviceIdentityType,
		deviceIdentityDigest: reference.deviceIdentityDigest,
		osIdentityType: reference.osIdentityType,
		osIdentityDigest: reference.osIdentityDigest,
		refreshIdentityType: reference.refreshIdentityType,
		refreshIdentityDigest: reference.refreshIdentityDigest,
		colorIdentityType: reference.colorIdentityType,
		colorIdentityDigest: reference.colorIdentityDigest,
		limitationsDigest: reference.limitationsDigest,
		routeDigest: reference.routeDigest,
		stateDigest: reference.stateDigest,
		routeStateDigest: reference.routeStateDigest,
		captureSessionDocumentHash: reference.captureSessionDocumentHash,
		captureSessionWriteLedgerHash: reference.captureSessionWriteLedgerHash,
		sourceClosureHash: reference.sourceClosureHash,
		buildRevision: reference.buildRevision,
		threeRevision: reference.threeRevision,
		startedAt: reference.startedAt,
		finishedAt: reference.finishedAt
	} );

}

function assertLaneReference( reference, lane ) {

	if ( reference === null || typeof reference !== 'object' || Array.isArray( reference ) ) throw new Error( `Evidence lane ${ lane } is missing.` );
	const contract = LANE_CONTRACTS[ lane ];
	if ( reference.lane !== lane || reference.profile !== contract.profile || reference.automationSurface !== contract.automationSurface ) throw new Error( `Evidence lane ${ lane } is swapped or cross-bound to the wrong capture surface.` );
	if ( reference.finalized !== true ) throw new Error( `Evidence lane ${ lane } is not finalized.` );
	if ( reference.publishable !== false ) throw new Error( `Raw ${ lane } session must remain nonpublishable before the offline three-lane join.` );
	for ( const key of [ 'sessionSha256', ...IMMUTABLE_IDENTITY_FIELDS, 'identityBindingDigest' ] ) if ( SHA256.test( reference[ key ] ?? '' ) === false ) throw new Error( `Evidence lane ${ lane } has no valid ${ key }.` );
	if ( typeof reference.sessionId !== 'string' || reference.sessionId.length === 0 ) throw new Error( `Evidence lane ${ lane } has no sessionId.` );
	if ( reference.threeRevision !== '0.185.1' ) throw new Error( `Evidence lane ${ lane } has the wrong Three revision.` );
	for ( const key of [ 'deviceIdentityType', 'osIdentityType', 'refreshIdentityType', 'colorIdentityType' ] ) if ( typeof reference[ key ] !== 'string' || reference[ key ].length === 0 ) throw new Error( `Evidence lane ${ lane } has no typed ${ key }.` );
	const startedAt = Date.parse( reference.startedAt );
	const finishedAt = Date.parse( reference.finishedAt );
	if ( Number.isFinite( startedAt ) === false || Number.isFinite( finishedAt ) === false || finishedAt < startedAt ) throw new Error( `Evidence lane ${ lane } has an invalid capture interval.` );
	if ( contract.adapterClasses.includes( reference.adapterClass ) === false ) throw new Error( `Evidence lane ${ lane } has an invalid adapter class.` );
	if ( reference.identityBindingDigest !== laneIdentityBindingDigest( reference ) ) throw new Error( `Evidence lane ${ lane } immutable identity binding is stale or swapped.` );
	return reference;

}

export function physicalLaneReference( record, sessionSha256 ) {

	if ( ! [ PHYSICAL_ROUTE_PROFILE, HARDWARE_PERFORMANCE_PROFILE ].includes( record?.profile ) ) throw new Error( 'Physical lane reference requires a validated physical-route or performance record.' );
	const lane = record.profile === PHYSICAL_ROUTE_PROFILE ? 'physicalRoute' : 'hardwarePerformance';
	const environment = physicalEnvironmentIdentities( record );
	const reference = {
		lane,
		profile: record.profile,
		automationSurface: record.automationSurface,
		sessionId: `${ record.profile }:${ record.startedAt ?? 'unknown-start' }`,
		sessionSha256,
		startedAt: record.startedAt,
		finishedAt: record.finishedAt,
		adapterClass: record.adapter?.adapterClass,
		adapterIdentityDigest: environment.adapter,
		browserIdentityDigest: environment.browser,
		deviceIdentityType: 'gpu-adapter-backend-contract-v1',
		deviceIdentityDigest: environment.device,
		osIdentityType: 'browser-platform-v1',
		osIdentityDigest: environment.os,
		refreshIdentityType: 'nominal-foreground-idle-raf-v1',
		refreshIdentityDigest: environment.refresh,
		colorIdentityType: 'capture-resource-copy-output-contract-v1',
		colorIdentityDigest: environment.color,
		limitationsDigest: stableHash( record.limitations ?? [] ),
		routeDigest: stableHash( record.routeOrder ),
		stateDigest: stableHash( record.routes?.map( ( route ) => ( { key: route.key, startup: route.startup, state: route.state } ) ) ),
		routeStateDigest: stableHash( { routeOrder: record.routeOrder, states: record.routes?.map( ( route ) => ( { key: route.key, startup: route.startup, state: route.state } ) ) } ),
		captureSessionDocumentHash: sessionSha256,
		captureSessionWriteLedgerHash: record.serving?.ledgerSha256,
		sourceClosureHash: record.immutableBuild?.sourceClosureHash,
		buildRevision: record.immutableBuild?.buildRevision,
		threeRevision: record.immutableBuild?.threeRevision,
		finalized: record.serving?.status === 'FINALIZED_EXACT_STATIC_BYTES',
		publishable: false
	};
	reference.identityBindingDigest = laneIdentityBindingDigest( reference );
	return Object.freeze( reference );

}

function requireExactCaptureBinding( binding, kind, path, label ) {

	if ( binding?.kind !== kind || binding.path !== path ) throw new Error( `Correctness lane requires the exact ${ label } binding.` );
	if ( SHA256.test( binding.sha256 ?? '' ) === false ) throw new Error( `Correctness lane ${ label } binding has no valid SHA-256 digest.` );
	if ( Number.isSafeInteger( binding.byteLength ) === false || binding.byteLength <= 0 ) throw new Error( `Correctness lane ${ label } binding has no positive byte length.` );
	return binding;

}

export function correctnessLaneReference( record, documentBinding, writeLedgerBinding ) {

	validateCorrectnessCaptureSession( record );
	const document = requireExactCaptureBinding( documentBinding, 'capture-session-document', CORRECTNESS_SESSION_PATH, 'capture-session document' );
	const writeLedger = requireExactCaptureBinding( writeLedgerBinding, 'capture-session-write-ledger', CORRECTNESS_WRITE_LEDGER_PATH, 'capture-session write-ledger' );
	const sessionSha256 = document.sha256;
	const state = {
		locked: record.route?.lockedState,
		observed: record.route?.observedState,
		final: record.route?.finalState
	};
	const reference = {
		lane: 'correctness',
		profile: CORRECTNESS_PROFILE,
		automationSurface: 'playwright-headless-chromium',
		sessionId: `${ CORRECTNESS_PROFILE }:${ record.startedAt }:${ sessionSha256.slice( - 12 ) }`,
		sessionSha256,
		startedAt: record.startedAt,
		finishedAt: record.finishedAt,
		adapterClass: record.adapterClass,
		adapterIdentityDigest: stableHash( record.adapterIdentity ),
		browserIdentityDigest: stableHash( record.browser ),
		deviceIdentityType: 'gpu-adapter-backend-generation-v1',
		deviceIdentityDigest: stableHash( {
			adapter: record.adapterIdentity,
			backend: record.runtime?.metrics?.backend ?? record.runtime?.metrics?.backendKind,
			nativeWebGPU: record.runtime?.metrics?.nativeWebGPU,
			deviceGeneration: record.runtime?.metrics?.rendererDeviceGeneration ?? null
		} ),
		osIdentityType: 'browser-platform-v1',
		osIdentityDigest: stableHash( { platform: record.browser?.platform, userAgent: record.browser?.userAgent } ),
		refreshIdentityType: 'not-measured-correctness-v1',
		refreshIdentityDigest: stableHash( { verdict: 'NOT_CLAIMED', profile: CORRECTNESS_PROFILE } ),
		colorIdentityType: 'capture-resource-copy-output-v1',
		colorIdentityDigest: stableHash( record.writtenCaptures?.map( ( capture ) => ( {
			path: capture.png?.path,
			format: capture.format,
			colorEncoding: capture.colorEncoding,
			origin: capture.origin,
			transport: capture.transport?.layout,
			normalized: {
				bytesPerRow: capture.normalized?.bytesPerRow,
				origin: capture.normalized?.origin,
				orientationTransform: capture.normalized?.orientationTransform
			}
		} ) ) ),
		limitationsDigest: stableHash( {
			note: record.note ?? null,
			hookReason: record.hookResult?.reason ?? record.hookResult?.note ?? null
		} ),
		routeDigest: stableHash( record.route ),
		stateDigest: stableHash( state ),
		routeStateDigest: stableHash( { route: record.route, state } ),
		captureSessionDocumentHash: document.sha256,
		captureSessionWriteLedgerHash: writeLedger.sha256,
		sourceClosureHash: record.sourceClosureHash,
		buildRevision: record.buildRevision,
		threeRevision: record.threeRevision,
		finalized: true,
		publishable: false
	};
	reference.identityBindingDigest = laneIdentityBindingDigest( reference );
	return Object.freeze( reference );

}

export function validateEvidenceLaneJoin( join ) {

	if ( join === null || typeof join !== 'object' || Array.isArray( join ) || join.schemaVersion !== 2 ) throw new Error( 'Offline evidence lane join schema v2 is invalid.' );
	const keys = Object.keys( join ).sort();
	if ( stableStringify( keys ) !== stableStringify( PORTABLE_JOIN_KEYS ) ) throw new Error( 'Offline evidence lane join must contain the exact portable top-level fields.' );
	if ( join.publishable !== false ) throw new Error( 'The lane join is a nonpublishable promotion input, not a publishable raw bundle.' );
	if ( join.rawEvidenceManifestFinalized !== true || join.rewriteRawEvidenceManifest !== false ) throw new Error( 'Offline lane join must preserve the finalized raw evidence manifest byte-for-byte.' );
	const correctness = assertLaneReference( join.correctness, 'correctness' );
	const physicalRoute = assertLaneReference( join.physicalRoute, 'physicalRoute' );
	const hardwarePerformance = join.performanceClaims === true
		? assertLaneReference( join.hardwarePerformance, 'hardwarePerformance' )
		: ( join.hardwarePerformance === null || join.hardwarePerformance === undefined ? null : assertLaneReference( join.hardwarePerformance, 'hardwarePerformance' ) );
	const references = [ correctness, physicalRoute, ...( hardwarePerformance === null ? [] : [ hardwarePerformance ] ) ];
	const sessionIds = new Set( references.map( ( reference ) => reference.sessionId ) );
	const sessionHashes = new Set( references.map( ( reference ) => reference.sessionSha256 ) );
	const captureDocumentHashes = new Set( references.map( ( reference ) => reference.captureSessionDocumentHash ) );
	const writeLedgerHashes = new Set( references.map( ( reference ) => reference.captureSessionWriteLedgerHash ) );
	const routeDigests = new Set( references.map( ( reference ) => reference.routeDigest ) );
	const routeStateDigests = new Set( references.map( ( reference ) => reference.routeStateDigest ) );
	if ( sessionIds.size !== references.length || sessionHashes.size !== references.length || captureDocumentHashes.size !== references.length || writeLedgerHashes.size !== references.length || routeDigests.size !== references.length || routeStateDigests.size !== references.length ) throw new Error( 'Offline evidence lanes must reference distinct capture sessions, write ledgers, and route plans.' );
	for ( const reference of references.slice( 1 ) ) {

		if ( reference.sourceClosureHash !== correctness.sourceClosureHash || reference.buildRevision !== correctness.buildRevision || reference.threeRevision !== correctness.threeRevision ) throw new Error( 'Offline evidence lanes cross source, build, or Three revision boundaries.' );

	}
	return Object.freeze( {
		status: 'READY_FOR_OFFLINE_PROMOTION_REVIEW',
		publishable: false,
		performanceClaims: join.performanceClaims === true,
		laneCount: references.length,
		sourceClosureHash: correctness.sourceClosureHash,
		buildRevision: correctness.buildRevision,
		threeRevision: correctness.threeRevision
	} );

}
