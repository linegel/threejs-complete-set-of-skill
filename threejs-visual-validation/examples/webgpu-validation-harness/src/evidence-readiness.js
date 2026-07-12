import { access, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	canonicalRawBundleDirectory,
	canonicalReleaseBundleDirectory,
	resolveValidationBundleDirectory,
	VALIDATION_HARNESS_LAB_ID
} from './artifact-paths.js';
import { readUnifiedEvidenceManifest } from './evidence-bundle-v2.js';
import { physicalLaneReference } from './physical-lane-join.js';
import { stableStringify } from './physical-evidence-common.js';
import { hashPhysicalRecord, validateHardwarePerformanceSession, validatePhysicalRouteSession } from './physical-session-validator.js';
import { validateVersionedArtifactBundle } from './schema/dispatcher.js';

const REQUIRED_RELEASE_CLAIMS = Object.freeze( [
	'visualCorrectness',
	'mechanismCorrectness',
	'performanceCompliance',
	'gpuAttribution',
	'lifecycleStability',
	'visualError'
] );
const REQUIRED_CORRECTNESS_CLAIMS = Object.freeze( [
	'mechanismCorrectness',
	'lifecycleStability',
	'visualError'
] );

function issue( code, input, message ) {

	return Object.freeze( { code, input, message } );

}

function inputSummary( input, path, status, details = {} ) {

	return Object.freeze( { input, path, status, ...details } );

}

function allClaimsPass( verdicts, requiredClaims ) {

	return requiredClaims.every( ( claim ) => verdicts?.[ claim ] === 'PASS' );

}

function isWithin( path, parent ) {

	const rel = relative( parent, path );
	return rel === '' || ( rel.startsWith( '..' ) === false && isAbsolute( rel ) === false );

}

async function pathExists( path ) {

	try {

		await access( path );
		return true;

	} catch {

		return false;

	}

}

async function inspectBundle( input, path, expected ) {

	if ( await pathExists( path ) === false ) return inputSummary( input, path, 'MISSING' );
	try {

		const validation = await validateVersionedArtifactBundle( path );
		if ( validation.migrationWarning ) return inputSummary( input, path, 'LEGACY_RECAPTURE_REQUIRED', {
			schemaVersion: validation.schemaVersion,
			protocol: validation.protocol,
			message: validation.migrationWarning
		} );
		const { manifest } = await readUnifiedEvidenceManifest( path );
		if ( manifest.labId !== VALIDATION_HARNESS_LAB_ID ) throw new Error( `Bundle belongs to ${ manifest.labId ?? '<missing-lab>' }.` );
		if ( validation.bundleKind !== expected.bundleKind ) throw new Error( `Expected ${ expected.bundleKind }, received ${ validation.bundleKind }.` );
		if ( expected.profile && validation.captureProfiles.includes( expected.profile ) === false ) throw new Error( `Bundle omits the ${ expected.profile } capture profile.` );
		for ( const profile of expected.requiredProfiles ?? [] ) if ( validation.captureProfiles.includes( profile ) === false ) throw new Error( `Bundle omits the ${ profile } capture profile.` );
		for ( const surface of expected.requiredAutomationSurfaces ?? [] ) if ( validation.automationSurfaces.includes( surface ) === false ) throw new Error( `Bundle omits the ${ surface } automation surface.` );
		if ( expected.publishable !== undefined && validation.publishable !== expected.publishable ) throw new Error( `Expected publishable=${ expected.publishable }, received ${ validation.publishable }.` );
		const requiredClaims = expected.requiredClaims ?? [];
		const claimsPass = allClaimsPass( validation.claimVerdicts, requiredClaims );
		const captureSession = expected.profile
			? manifest.captureSessions.find( ( session ) => session.profile === expected.profile )
			: null;
		const adapterClass = captureSession?.adapterClass ?? null;
		const hardwareRequired = expected.hardwareRequired === true;
		const hardwareReady = hardwareRequired === false || adapterClass === 'hardware';
		const promotionReady = expected.promotionStatuses === undefined || expected.promotionStatuses.includes( manifest.promotion?.status );
		const status = claimsPass && hardwareReady && promotionReady ? expected.readyStatus : 'INSUFFICIENT_EVIDENCE';
		return inputSummary( input, path, status, {
			schemaVersion: validation.schemaVersion,
			bundleKind: validation.bundleKind,
			publishable: validation.publishable,
			captureProfiles: [ ...validation.captureProfiles ],
			automationSurfaces: [ ...validation.automationSurfaces ],
			adapterClass,
			claimVerdicts: { ...validation.claimVerdicts },
			promotionStatus: manifest.promotion?.status ?? null,
			sourceClosureHash: manifest.sourceClosureHash,
			buildRevision: manifest.buildRevision,
			threeRevision: manifest.threeRevision,
			message: claimsPass === false
				? `Required claims are not all PASS: ${ requiredClaims.filter( ( claim ) => validation.claimVerdicts?.[ claim ] !== 'PASS' ).join( ', ' ) }.`
				: hardwareReady === false
					? `The ${ expected.profile } lane must be captured on a hardware adapter before release assembly.`
					: promotionReady === false
						? `Promotion status ${ manifest.promotion?.status ?? '<missing>' } is not eligible for this input.`
						: null
		} );

	} catch ( error ) {

		return inputSummary( input, path, 'INVALID', { message: error.message } );

	}

}

async function inspectPhysicalRecord( input, path, expectedProfile ) {

	if ( path === null ) return inputSummary( input, null, 'NOT_PROVIDED' );
	if ( isAbsolute( path ) === false ) return inputSummary( input, path, 'INVALID', { message: 'Physical evidence record paths must be absolute.' } );
	if ( await pathExists( path ) === false ) return inputSummary( input, path, 'MISSING' );
	try {

		const parsed = JSON.parse( await readFile( path, 'utf8' ) );
		const record = parsed.record ?? parsed;
		if ( record.profile !== expectedProfile ) throw new Error( `Expected profile ${ expectedProfile }, received ${ record.profile ?? '<missing>' }.` );
		const validation = expectedProfile === 'physical-route'
			? validatePhysicalRouteSession( record )
			: validateHardwarePerformanceSession( record );
		const recordSha256 = hashPhysicalRecord( record );
		if ( parsed.recordSha256 === undefined || parsed.laneReference === undefined ) throw new Error( 'Physical record must be finalized by physical:import before readiness inspection.' );
		if ( parsed.recordSha256 !== recordSha256 ) throw new Error( 'Imported recordSha256 no longer binds the physical record.' );
		const expectedReference = physicalLaneReference( record, recordSha256 );
		if ( stableStringify( parsed.laneReference ) !== stableStringify( expectedReference ) ) throw new Error( 'Imported laneReference no longer binds the physical record.' );
		return inputSummary( input, path, 'READY', {
			profile: expectedProfile,
			automationSurface: record.automationSurface,
			adapterClass: record.adapter?.adapterClass ?? null,
			recordSha256,
			sourceClosureHash: record.immutableBuild?.sourceClosureHash ?? null,
			buildRevision: record.immutableBuild?.buildRevision ?? null,
			threeRevision: record.immutableBuild?.threeRevision ?? null,
			validation
		} );

	} catch ( error ) {

		return inputSummary( input, path, 'INVALID', { message: error.message } );

	}

}

function inputBlocker( input ) {

	const messages = {
		correctness: 'Capture a current-source hardware correctness lane with the pinned Playwright runner.',
		physicalRoute: 'Import a finalized immutable physical-route session from the Codex in-app Browser.',
		hardwarePerformance: 'Import a finalized named-hardware performance session with timestamp attribution.',
		releaseCandidate: 'Assemble the three immutable lanes into a separate nonpublishable release candidate.',
		releaseBundle: 'Promote an approved, hash-bound release bundle into the tracked canonical bundle path.'
	};
	const prefixes = {
		correctness: 'CORRECTNESS',
		physicalRoute: 'PHYSICAL_ROUTE',
		hardwarePerformance: 'HARDWARE_PERFORMANCE',
		releaseCandidate: 'RELEASE_CANDIDATE',
		releaseBundle: 'RELEASE_BUNDLE'
	};
	return issue( `${ prefixes[ input.input ] }_${ input.status }`, input.input, input.message ?? messages[ input.input ] );

}

export function deriveHarnessAcceptanceReadiness( inputs ) {

	const releaseAccepted = inputs.releaseBundle.status === 'ACCEPTED';
	if ( releaseAccepted ) return Object.freeze( {
		status: 'ACCEPTED',
		accepted: true,
		blockers: Object.freeze( [] ),
		nextAction: null
	} );

	const laneInputs = [ inputs.correctness, inputs.physicalRoute, inputs.hardwarePerformance ];
	const lanesReady = laneInputs.every( ( input ) => input.status === 'READY' );
	const laneIdentityFields = [ 'sourceClosureHash', 'buildRevision', 'threeRevision' ];
	const lanesMatch = lanesReady && laneIdentityFields.every( ( field ) => {

		const values = new Set( laneInputs.map( ( input ) => input[ field ] ) );
		return values.size === 1 && values.has( null ) === false && values.has( undefined ) === false;

	} );
	const candidateReady = inputs.releaseCandidate.status === 'AWAITING_VISUAL_REVIEW';
	let status = 'INCOMPLETE';
	let blockers;
	let nextAction;
	if ( candidateReady ) {

		status = 'AWAITING_VISUAL_REVIEW';
		blockers = [ issue( 'AUTHORED_VISUAL_REVIEW_REQUIRED', 'releaseCandidate', 'Directly inspect every applicable bound image and attach an approved digest-bound review.' ) ];
		nextAction = 'Complete authored visual review, promote the candidate, then validate the tracked release bundle.';

	} else if ( lanesReady && lanesMatch === false ) {

		status = 'INCOMPLETE';
		blockers = [ issue( 'LANE_IDENTITY_MISMATCH', 'laneJoin', 'Correctness, physical-route, and hardware-performance evidence must bind the same source closure, build revision, and Three revision.' ) ];
		nextAction = blockers[ 0 ].message;

	} else if ( lanesReady ) {

		status = 'READY_FOR_RELEASE_ASSEMBLY';
		blockers = [ inputBlocker( inputs.releaseCandidate ) ];
		nextAction = 'Assemble the immutable lane records and current correctness artifacts into a separate nonpublishable release candidate.';

	} else {

		blockers = laneInputs.filter( ( input ) => input.status !== 'READY' ).map( inputBlocker );
		nextAction = blockers[ 0 ]?.message ?? 'Collect the missing evidence lanes.';

	}
	if ( inputs.releaseBundle.status !== 'MISSING' ) blockers.push( inputBlocker( inputs.releaseBundle ) );
	return Object.freeze( {
		status,
		accepted: false,
		blockers: Object.freeze( blockers ),
		nextAction
	} );

}

export async function inspectHarnessAcceptanceReadiness( options = {} ) {

	const correctnessPath = options.correctnessPath === null || options.correctnessPath === undefined
		? canonicalRawBundleDirectory( 'correctness' )
		: resolveValidationBundleDirectory( { override: options.correctnessPath } );
	const releaseCandidatePath = options.releaseCandidatePath === null || options.releaseCandidatePath === undefined
		? null
		: resolve( options.releaseCandidatePath );
	const releasePath = options.releasePath === null || options.releasePath === undefined
		? canonicalReleaseBundleDirectory()
		: resolveValidationBundleDirectory( { override: options.releasePath } );
	const inputs = {
		correctness: await inspectBundle( 'correctness', correctnessPath, {
			bundleKind: 'raw-capture-session',
			profile: 'correctness',
			publishable: false,
			hardwareRequired: true,
			requiredClaims: REQUIRED_CORRECTNESS_CLAIMS,
			readyStatus: 'READY'
		} ),
		physicalRoute: await inspectPhysicalRecord( 'physicalRoute', options.physicalRoutePath ?? null, 'physical-route' ),
		hardwarePerformance: await inspectPhysicalRecord( 'hardwarePerformance', options.performancePath ?? null, 'performance' ),
		releaseCandidate: releaseCandidatePath === null
			? inputSummary( 'releaseCandidate', null, 'NOT_PROVIDED' )
			: isWithin( releaseCandidatePath, VALIDATION_HARNESS_REPOSITORY_ROOT )
				? inputSummary( 'releaseCandidate', releaseCandidatePath, 'INVALID', { message: 'The nonpublishable release candidate must remain outside the repository.' } )
				: await inspectBundle( 'releaseCandidate', releaseCandidatePath, {
				bundleKind: 'release-bundle',
				publishable: false,
				requiredProfiles: [ 'correctness', 'physical-route', 'performance' ],
				requiredAutomationSurfaces: [ 'playwright-headless-chromium', 'codex-in-app-browser' ],
				requiredClaims: REQUIRED_RELEASE_CLAIMS,
				promotionStatuses: [ 'PENDING_VISUAL_SIGNOFF' ],
				readyStatus: 'AWAITING_VISUAL_REVIEW'
			} ),
		releaseBundle: await inspectBundle( 'releaseBundle', releasePath, {
			bundleKind: 'release-bundle',
			publishable: true,
			requiredProfiles: [ 'correctness', 'physical-route', 'performance' ],
			requiredAutomationSurfaces: [ 'playwright-headless-chromium', 'codex-in-app-browser' ],
			requiredClaims: REQUIRED_RELEASE_CLAIMS,
			promotionStatuses: [ 'APPROVED' ],
			readyStatus: 'ACCEPTED'
		} )
	};
	const readiness = deriveHarnessAcceptanceReadiness( inputs );
	return Object.freeze( {
		schemaVersion: 1,
		labId: VALIDATION_HARNESS_LAB_ID,
		status: readiness.status,
		accepted: readiness.accepted,
		inputs: Object.freeze( inputs ),
		blockers: readiness.blockers,
		nextAction: readiness.nextAction
	} );

}

function argument( argv, name ) {

	const index = argv.indexOf( name );
	return index === -1 ? null : argv[ index + 1 ];

}

function parseArguments( argv ) {

	const names = new Set( [ '--correctness', '--physical-route', '--performance', '--release-candidate', '--release' ] );
	for ( let index = 0; index < argv.length; index += 2 ) {

		const name = argv[ index ];
		if ( names.has( name ) === false ) throw new Error( `Unknown evidence-readiness option ${ name }.` );
		if ( argv[ index + 1 ] === undefined || argv[ index + 1 ].startsWith( '--' ) ) throw new Error( `${ name } requires a path.` );

	}
	return {
		correctnessPath: argument( argv, '--correctness' ),
		physicalRoutePath: argument( argv, '--physical-route' ),
		performancePath: argument( argv, '--performance' ),
		releaseCandidatePath: argument( argv, '--release-candidate' ),
		releasePath: argument( argv, '--release' )
	};

}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const result = await inspectHarnessAcceptanceReadiness( parseArguments( process.argv.slice( 2 ) ) );
	process.stdout.write( `${ JSON.stringify( result, null, 2 ) }\n` );

}
