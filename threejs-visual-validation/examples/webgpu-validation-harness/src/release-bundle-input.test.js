import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createValidationHarnessPreparedReleaseInputs,
	releaseRouteFromPhysicalRecord
} from './release-bundle-input.js';
import { computeCaptureSourceClosure } from './capture-source-closure.js';
import { createCorrectnessCaptureSessionFixture } from './correctness-capture-session.fixture.js';
import {
	CORRECTNESS_SESSION_PATH,
	CORRECTNESS_WRITE_LEDGER_PATH,
	createCorrectnessWriteLedger
} from './correctness-write-ledger.js';
import {
	correctnessLaneReference,
	laneIdentityBindingDigest,
	physicalLaneReference,
	validateEvidenceLaneJoin
} from './physical-lane-join.js';
import { PHYSICAL_ROUTE_PLAN } from './in-app-evidence-plan.js';
import {
	createHardwarePerformanceSessionFixture,
	createPhysicalRouteSessionFixture
} from './physical-session.fixture.js';
import { hashPhysicalRecord } from './physical-session-validator.js';
import {
	finalizeImportedPhysicalRecord,
	verifyImportedPhysicalRecordBytes
} from './verified-physical-record.js';

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

function routeRecord( plan ) {

	const { width, height, dpr, ...state } = plan.startup;
	return {
		key: plan.key,
		kind: plan.kind,
		id: plan.id,
		startup: structuredClone( plan.startup ),
		state: { ...state, viewport: { width, height, dpr } },
		backend: { initialized: true, isWebGPUBackend: true, deviceIdentityVerified: true },
		readback: {
			resourceFormat: 'rgba16float',
			format: 'rgba8unorm',
			colorManaged: true,
			outputColorSpace: 'srgb',
			encoding: 'png',
			origin: 'top-left'
		}
	};

}

function finalizeWrapperBytes( input ) {

	const record = structuredClone( input );
	record.publishable = false;
	record.acceptanceStatus = 'incomplete';
	record.serving.ledgerSha256 = hashPhysicalRecord( record.serving.entries );
	return Buffer.from( `${ JSON.stringify( finalizeImportedPhysicalRecord( record ), null, 2 ) }\n` );

}

function capturedBinding( path, kind, bytes ) {

	return { path, status: 'captured', kind, sha256: sha256( bytes ), byteLength: bytes.byteLength };

}

function setCurrentCorrectnessIdentity( record, closure ) {

	record.sourceHash = closure.sourceHash;
	record.sourceClosureHash = closure.sourceHash;
	record.sourceClosure = structuredClone( closure );
	record.buildRevision = closure.buildRevision;
	return record;

}

function fixture() {

	const sourceClosure = computeCaptureSourceClosure();
	const identity = {
		sourceClosure,
		sourceClosureHash: sourceClosure.sourceHash,
		buildRevision: sourceClosure.buildRevision
	};
	const physicalWrapperBytes = finalizeWrapperBytes( createPhysicalRouteSessionFixture( identity ) );
	const performanceWrapperBytes = finalizeWrapperBytes( createHardwarePerformanceSessionFixture( identity ) );
	const verifiedPhysical = verifyImportedPhysicalRecordBytes( physicalWrapperBytes, { expectedProfile: 'physical-route' } );
	const verifiedPerformance = verifyImportedPhysicalRecordBytes( performanceWrapperBytes, { expectedProfile: 'performance' } );
	const correctnessRecord = setCurrentCorrectnessIdentity( createCorrectnessCaptureSessionFixture(), sourceClosure );
	const correctnessDocumentBytes = Buffer.from( `${ JSON.stringify( correctnessRecord, null, 2 ) }\n` );
	const correctnessDocumentLedgerEntry = capturedBinding(
		CORRECTNESS_SESSION_PATH,
		'capture-session-document',
		correctnessDocumentBytes
	);
	const correctnessWriteLedger = createCorrectnessWriteLedger( correctnessRecord, correctnessDocumentLedgerEntry );
	const correctnessWriteLedgerBytes = correctnessWriteLedger.bytes;
	const correctnessWriteLedgerEntry = capturedBinding(
		CORRECTNESS_WRITE_LEDGER_PATH,
		'capture-session-write-ledger',
		correctnessWriteLedgerBytes
	);
	const strictLaneJoin = {
		schemaVersion: 2,
		publishable: false,
		rawEvidenceManifestFinalized: true,
		rewriteRawEvidenceManifest: false,
		performanceClaims: true,
		correctness: structuredClone( correctnessLaneReference( correctnessRecord, correctnessDocumentLedgerEntry, correctnessWriteLedgerEntry ) ),
		physicalRoute: structuredClone( physicalLaneReference( verifiedPhysical.record, verifiedPhysical.sourceDocumentSha256 ) ),
		hardwarePerformance: structuredClone( physicalLaneReference( verifiedPerformance.record, verifiedPerformance.sourceDocumentSha256 ) )
	};
	const rawRoute = releaseRouteFromPhysicalRecord( verifiedPhysical.record.routes.find( ( route ) => route.key === 'tier/webgpu-correctness' ) );
	const rawManifest = {
		labId: 'webgpu-validation-harness',
		sourceClosureHash: sourceClosure.sourceHash,
		buildRevision: sourceClosure.buildRevision,
		threeRevision: '0.185.1',
		route: rawRoute,
		captureSessions: [ {
			profile: 'correctness',
			document: {
				kind: correctnessDocumentLedgerEntry.kind,
				path: correctnessDocumentLedgerEntry.path,
				sha256: correctnessDocumentLedgerEntry.sha256,
				byteLength: correctnessDocumentLedgerEntry.byteLength
			},
			writeLedger: {
				kind: correctnessWriteLedgerEntry.kind,
				path: correctnessWriteLedgerEntry.path,
				sha256: correctnessWriteLedgerEntry.sha256,
				byteLength: correctnessWriteLedgerEntry.byteLength
			}
		} ],
		claimVerdicts: {
			visualCorrectness: 'INSUFFICIENT_EVIDENCE',
			mechanismCorrectness: 'PASS',
			performanceCompliance: 'NOT_CLAIMED',
			gpuAttribution: 'NOT_CLAIMED',
			lifecycleStability: 'PASS',
			visualError: 'PASS'
		}
	};
	const strictLaneJoinBytes = Buffer.from( `${ JSON.stringify( strictLaneJoin, null, 2 ) }\n` );
	const tierVisualEvidenceBytes = Buffer.from( '{"schemaVersion":1}\n' );
	return {
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
		tierVisualEvidenceLedgerEntry: capturedBinding( 'tier-visual-evidence.json', 'supplementary-json', tierVisualEvidenceBytes )
	};

}

test( 'physical route conversion preserves canonical route locks and mechanism identity', () => {

	const scenario = releaseRouteFromPhysicalRecord( routeRecord( PHYSICAL_ROUTE_PLAN[ 0 ] ) );
	const mechanismPlan = PHYSICAL_ROUTE_PLAN.find( ( route ) => route.key === 'mechanism/gpu-timestamps' );
	const mechanism = releaseRouteFromPhysicalRecord( routeRecord( mechanismPlan ) );
	assert.equal( scenario.path, '/demos/webgpu-validation-harness/scenario/browser-capture/' );
	assert.equal( scenario.mechanism, null );
	assert.equal( mechanism.mechanism, 'gpu-timestamps' );
	assert.equal( mechanism.tier, 'target-performance' );
	assert.equal( mechanism.seed, '0x00000001' );
	assert.equal( mechanism.timeSeconds.label, 'Measured' );
	const stale = routeRecord( mechanismPlan );
	stale.state.tier = 'governor-stress';
	assert.throws( () => releaseRouteFromPhysicalRecord( stale ), /tier lock/ );

} );

test( 'prepared harness input retains exact three-lane bytes and complete route coverage', () => {

	const input = fixture();
	const prepared = createValidationHarnessPreparedReleaseInputs( input );
	assert.equal( validateEvidenceLaneJoin( input.strictLaneJoin ).laneCount, 3 );
	assert.equal( prepared.routes.length, 18 );
	assert.deepEqual( prepared.captureSessions.map( ( session ) => session.profile ), [ 'physical-route', 'performance' ] );
	assert.equal( prepared.captureSessions[ 0 ].routeSetPaths.length, 19 );
	assert.deepEqual( prepared.captureSessions[ 1 ].routeSetPaths, [
		'/demos/webgpu-validation-harness/tier/target-performance/',
		'/demos/webgpu-validation-harness/tier/governor-stress/'
	] );
	assert.equal( prepared.supplementaryArtifacts.length, 5 );
	assert.deepEqual( prepared.supplementaryArtifacts[ 0 ].bytes, input.physicalWrapperBytes );
	assert.deepEqual( prepared.supplementaryArtifacts[ 2 ].bytes, input.performanceWrapperBytes );
	assert.equal( prepared.supplementaryArtifacts[ 4 ].bytes, input.strictLaneJoinBytes );
	assert.deepEqual( new Set( Object.values( prepared.claimVerdicts ) ), new Set( [ 'PASS' ] ) );
	assert.equal( typeof prepared.projectEvidenceArtifacts, 'function' );

} );

test( 'prepared harness input rejects source, join, byte, and claim substitutions', () => {

	const mutations = [
		[ 'source identity', ( value ) => { value.rawManifest.sourceClosureHash = `sha256:${ '0'.repeat( 64 ) }`; }, /sourceClosureHash differs/ ],
		[ 'strict join bytes', ( value ) => { value.strictLaneJoinBytes = Buffer.from( '{}\n' ); }, /join bytes differ/ ],
		[ 'non-JSON physical wrapper', ( value ) => { value.physicalWrapperBytes = Buffer.from( 'substituted bytes' ); }, /wrapper is invalid JSON/ ],
		[ 'forged physical validation', ( value ) => {

			const wrapper = JSON.parse( value.physicalWrapperBytes );
			wrapper.validation.routeCount = 999;
			value.physicalWrapperBytes = Buffer.from( `${ JSON.stringify( wrapper, null, 2 ) }\n` );

		}, /validation summary no longer matches/ ],
		[ 'correctness document binding', ( value ) => { value.rawManifest.captureSessions[ 0 ].document.sha256 = `sha256:${ '0'.repeat( 64 ) }`; }, /document binding differs/ ],
		[ 'correctness ledger substitution', ( value ) => {

			value.correctnessWriteLedgerBytes = Buffer.from( '{"schemaVersion":2,"entries":[]}\n' );
			value.correctnessWriteLedgerEntry = capturedBinding( CORRECTNESS_WRITE_LEDGER_PATH, 'capture-session-write-ledger', value.correctnessWriteLedgerBytes );

		}, /write-ledger bytes differ from the validated capture session/ ],
		[ 'strict correctness ledger hash', ( value ) => {

			value.strictLaneJoin.correctness.captureSessionWriteLedgerHash = `sha256:${ '0'.repeat( 64 ) }`;
			value.strictLaneJoin.correctness.identityBindingDigest = laneIdentityBindingDigest( value.strictLaneJoin.correctness );
			value.strictLaneJoinBytes = Buffer.from( `${ JSON.stringify( value.strictLaneJoin, null, 2 ) }\n` );

		}, /exact correctness document and write ledger/ ],
		[ 'mechanism claim', ( value ) => { value.rawManifest.claimVerdicts.mechanismCorrectness = 'INSUFFICIENT_EVIDENCE'; }, /does not pass mechanismCorrectness/ ]
	];
	for ( const [ name, mutate, pattern ] of mutations ) {

		const value = fixture();
		mutate( value );
		assert.throws( () => createValidationHarnessPreparedReleaseInputs( value ), pattern, name );

	}

} );

test( 'prepared harness input rejects stale current-source closure and a release performance route', () => {

	const stale = fixture();
	const record = JSON.parse( stale.correctnessDocumentBytes );
	record.sourceClosure.files[ 0 ].byteLength += 1;
	stale.correctnessDocumentBytes = Buffer.from( `${ JSON.stringify( record, null, 2 ) }\n` );
	stale.correctnessDocumentLedgerEntry = capturedBinding( CORRECTNESS_SESSION_PATH, 'capture-session-document', stale.correctnessDocumentBytes );
	const staleLedger = createCorrectnessWriteLedger( record, stale.correctnessDocumentLedgerEntry );
	stale.correctnessWriteLedgerBytes = staleLedger.bytes;
	stale.correctnessWriteLedgerEntry = capturedBinding( CORRECTNESS_WRITE_LEDGER_PATH, 'capture-session-write-ledger', stale.correctnessWriteLedgerBytes );
	assert.throws( () => createValidationHarnessPreparedReleaseInputs( stale ), /source closure does not match current canonical source/ );

	const releaseRoute = PHYSICAL_ROUTE_PLAN.find( ( route ) => route.key === 'tier/release' );
	const forged = fixture();
	const wrapper = JSON.parse( forged.performanceWrapperBytes );
	wrapper.record.routeOrder.push( releaseRoute.key );
	wrapper.record.routes.push( routeRecord( releaseRoute ) );
	forged.performanceWrapperBytes = Buffer.from( `${ JSON.stringify( wrapper, null, 2 ) }\n` );
	assert.throws( () => createValidationHarnessPreparedReleaseInputs( forged ), /route count|route order|exactly 2 routes/ );

} );
