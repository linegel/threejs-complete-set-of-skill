import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	correctnessLaneReference,
	laneIdentityBindingDigest,
	physicalEnvironmentIdentities,
	physicalLaneReference,
	validateEvidenceLaneJoin
} from './physical-lane-join.js';
import { createCorrectnessCaptureSessionFixture } from './correctness-capture-session.fixture.js';

const HASHES = Array.from( { length: 40 }, ( _, index ) => `sha256:${ index.toString( 16 ).padStart( 64, '0' ) }` );

function lane( name, profile, automationSurface, hashIndex ) {

	const reference = {
		lane: name,
		profile,
		automationSurface,
		sessionId: `${ name }-session`,
		sessionSha256: HASHES[ hashIndex ],
		startedAt: `2026-07-12T0${ hashIndex }:00:00.000Z`,
		finishedAt: `2026-07-12T0${ hashIndex }:01:00.000Z`,
		adapterClass: 'hardware',
		adapterIdentityDigest: name === 'correctness' ? HASHES[ 5 ] : HASHES[ 6 ],
		browserIdentityDigest: name === 'correctness' ? HASHES[ 6 ] : HASHES[ 7 ],
		deviceIdentityType: 'gpu-adapter-backend-generation-v1',
		deviceIdentityDigest: name === 'correctness' ? HASHES[ 18 ] : HASHES[ 19 ],
		osIdentityType: 'browser-platform-v1',
		osIdentityDigest: name === 'correctness' ? HASHES[ 20 ] : HASHES[ 21 ],
		refreshIdentityType: 'foreground-idle-raf-v1',
		refreshIdentityDigest: HASHES[ 22 + hashIndex ],
		colorIdentityType: 'capture-resource-copy-output-v1',
		colorIdentityDigest: HASHES[ 25 + hashIndex ],
		limitationsDigest: HASHES[ 28 + hashIndex ],
		routeDigest: HASHES[ 8 + hashIndex ],
		stateDigest: HASHES[ 11 + hashIndex ],
		routeStateDigest: HASHES[ 15 + hashIndex ],
		captureSessionDocumentHash: HASHES[ 8 + hashIndex ],
		captureSessionWriteLedgerHash: HASHES[ 11 + hashIndex ],
		sourceClosureHash: HASHES[ 3 ],
		buildRevision: HASHES[ 4 ],
		threeRevision: '0.185.1',
		finalized: true,
		publishable: false
	};
	reference.identityBindingDigest = laneIdentityBindingDigest( reference );
	return reference;

}

function joined() {

	const value = {
		schemaVersion: 2,
		publishable: false,
		rawEvidenceManifestFinalized: true,
		rewriteRawEvidenceManifest: false,
		performanceClaims: true,
		correctness: lane( 'correctness', 'correctness', 'playwright-headless-chromium', 0 ),
		physicalRoute: lane( 'physicalRoute', 'physical-route', 'codex-in-app-browser', 1 ),
		hardwarePerformance: lane( 'hardwarePerformance', 'performance', 'codex-in-app-browser', 2 )
	};
	value.correctness.adapterClass = 'software';
	value.correctness.identityBindingDigest = laneIdentityBindingDigest( value.correctness );
	return value;

}

function correctnessCaptureRecord() {

	return createCorrectnessCaptureSessionFixture();

}

function correctnessBinding( kind, path, hash ) {

	return { kind, path, sha256: hash, byteLength: 1234 };

}
test( 'offline promotion hook requires three distinct matching lanes for performance claims', () => {

	assert.deepEqual( validateEvidenceLaneJoin( joined() ), {
		status: 'READY_FOR_OFFLINE_PROMOTION_REVIEW',
		publishable: false,
		performanceClaims: true,
		laneCount: 3,
		sourceClosureHash: HASHES[ 3 ],
		buildRevision: HASHES[ 4 ],
		threeRevision: '0.185.1'
	} );

} );

test( 'shared Playwright correctness sessions produce a separately typed lane reference', () => {

	const document = correctnessBinding( 'capture-session-document', 'capture-session.json', HASHES[ 0 ] );
	const writeLedger = correctnessBinding( 'capture-session-write-ledger', 'capture-write-ledger.json', HASHES[ 1 ] );
	const reference = correctnessLaneReference( correctnessCaptureRecord(), document, writeLedger );
	assert.equal( reference.lane, 'correctness' );
	assert.equal( reference.automationSurface, 'playwright-headless-chromium' );
	assert.equal( reference.finalized, true );
	assert.equal( reference.captureSessionDocumentHash, document.sha256 );
	assert.equal( reference.captureSessionWriteLedgerHash, writeLedger.sha256 );
	assert.throws( () => correctnessLaneReference( correctnessCaptureRecord(), document, { ...writeLedger, sha256: 'sha256:short' } ), /write-ledger binding has no valid/ );
	assert.throws( () => correctnessLaneReference( correctnessCaptureRecord(), { ...document, path: 'other.json' }, writeLedger ), /exact capture-session document/ );
	assert.throws( () => physicalLaneReference( correctnessCaptureRecord(), HASHES[ 0 ] ), /physical-route or performance/ );

} );

test( 'physical environment identities ignore route membership but retain adapter, refresh, and color contracts', () => {

	function record( profile, routeKey ) {

		return {
			profile,
			automationSurface: 'codex-in-app-browser',
			startedAt: '2026-07-12T01:00:00.000Z',
			finishedAt: '2026-07-12T01:01:00.000Z',
			adapter: { adapterClass: 'hardware', identity: { vendor: 'Apple', device: 'M-series' } },
			browser: { webdriver: false, headless: false, platform: 'macOS', userAgentDataPlatform: 'macOS', userAgent: 'Chromium' },
			refresh: { hz: { value: 59.98 } },
			immutableBuild: { sourceClosureHash: HASHES[ 3 ], buildRevision: HASHES[ 4 ], threeRevision: '0.185.1' },
			routeOrder: [ routeKey ],
			routes: [ {
				key: routeKey,
				backend: { isWebGPUBackend: true, initialized: true, deviceIdentityVerified: true },
				readback: { resourceFormat: 'rgba8unorm-srgb', format: 'rgba8unorm', colorManaged: true, outputColorSpace: 'srgb', encoding: 'srgb', origin: 'top-left' }
			} ],
			limitations: [],
			serving: { status: 'FINALIZED_EXACT_STATIC_BYTES', ledgerSha256: HASHES[ 9 ] }
		};

	}
	const physical = record( 'physical-route', 'scenario/browser-capture' );
	const performance = record( 'performance', 'tier/target-performance' );
	assert.deepEqual( physicalEnvironmentIdentities( physical ), physicalEnvironmentIdentities( performance ) );
	const physicalReference = physicalLaneReference( physical, HASHES[ 0 ] );
	const performanceReference = physicalLaneReference( performance, HASHES[ 1 ] );
	for ( const field of [ 'adapterIdentityDigest', 'browserIdentityDigest', 'deviceIdentityDigest', 'osIdentityDigest', 'refreshIdentityDigest', 'colorIdentityDigest' ] ) {

		assert.equal( physicalReference[ field ], performanceReference[ field ], field );

	}
	performance.refresh.hz.value = 120;
	assert.notEqual( physicalEnvironmentIdentities( physical ).refresh, physicalEnvironmentIdentities( performance ).refresh );
	performance.refresh.hz.value = 59.98;
	performance.routes[ 0 ].readback.outputColorSpace = 'display-p3';
	assert.notEqual( physicalEnvironmentIdentities( physical ).color, physicalEnvironmentIdentities( performance ).color );

} );

test( 'offline promotion hook rejects missing, swapped, cross-source, and raw-publishable lanes', () => {

	const mutations = [
		[ 'missing physical route', ( value ) => { value.physicalRoute = null; }, /physicalRoute is missing/ ],
		[ 'missing conditional hardware', ( value ) => { value.hardwarePerformance = null; }, /hardwarePerformance is missing/ ],
		[ 'swapped lanes', ( value ) => { [ value.correctness, value.physicalRoute ] = [ value.physicalRoute, value.correctness ]; }, /swapped or cross-bound/ ],
		[ 'cross-source lane', ( value ) => {

			value.hardwarePerformance.sourceClosureHash = HASHES[ 0 ];
			value.hardwarePerformance.identityBindingDigest = laneIdentityBindingDigest( value.hardwarePerformance );

		}, /cross source/ ],
		[ 'duplicate session', ( value ) => { value.hardwarePerformance.sessionSha256 = value.physicalRoute.sessionSha256; }, /distinct capture sessions/ ],
		[ 'swapped adapter digest', ( value ) => { value.physicalRoute.adapterIdentityDigest = value.correctness.adapterIdentityDigest; }, /identity binding is stale or swapped/ ],
		[ 'swapped browser digest', ( value ) => { value.correctness.browserIdentityDigest = value.physicalRoute.browserIdentityDigest; }, /identity binding is stale or swapped/ ],
		[ 'swapped device digest', ( value ) => { value.physicalRoute.deviceIdentityDigest = value.correctness.deviceIdentityDigest; }, /identity binding is stale or swapped/ ],
		[ 'swapped OS digest', ( value ) => { value.correctness.osIdentityDigest = value.hardwarePerformance.osIdentityDigest; }, /identity binding is stale or swapped/ ],
		[ 'swapped refresh digest', ( value ) => { value.hardwarePerformance.refreshIdentityDigest = value.physicalRoute.refreshIdentityDigest; }, /identity binding is stale or swapped/ ],
		[ 'swapped color digest', ( value ) => { value.correctness.colorIdentityDigest = value.physicalRoute.colorIdentityDigest; }, /identity binding is stale or swapped/ ],
		[ 'swapped limitations digest', ( value ) => { value.physicalRoute.limitationsDigest = value.hardwarePerformance.limitationsDigest; }, /identity binding is stale or swapped/ ],
		[ 'swapped state digest', ( value ) => { value.hardwarePerformance.stateDigest = value.physicalRoute.stateDigest; }, /identity binding is stale or swapped/ ],
		[ 'swapped route-state digest', ( value ) => { value.correctness.routeStateDigest = value.physicalRoute.routeStateDigest; }, /identity binding is stale or swapped/ ],
		[ 'swapped capture document hash', ( value ) => { value.physicalRoute.captureSessionDocumentHash = value.hardwarePerformance.captureSessionDocumentHash; }, /identity binding is stale or swapped/ ],
		[ 'swapped write ledger hash', ( value ) => { value.correctness.captureSessionWriteLedgerHash = value.physicalRoute.captureSessionWriteLedgerHash; }, /identity binding is stale or swapped/ ],
		[ 'raw session publishable', ( value ) => { value.hardwarePerformance.publishable = true; }, /must remain nonpublishable/ ],
		[ 'unknown correctness adapter', ( value ) => {

			value.correctness.adapterClass = 'unknown';
			value.correctness.identityBindingDigest = laneIdentityBindingDigest( value.correctness );

		}, /correctness has an invalid adapter class/ ],
		[ 'software physical adapter', ( value ) => {

			value.physicalRoute.adapterClass = 'software';
			value.physicalRoute.identityBindingDigest = laneIdentityBindingDigest( value.physicalRoute );

		}, /physicalRoute has an invalid adapter class/ ],
		[ 'raw join publishable', ( value ) => { value.publishable = true; }, /nonpublishable promotion input/ ],
		[ 'wrong Three revision', ( value ) => { value.correctness.threeRevision = '0.184.0'; }, /wrong Three revision/ ],
		[ 'invalid capture interval', ( value ) => { value.physicalRoute.finishedAt = '2026-07-11T00:00:00.000Z'; }, /invalid capture interval/ ],
		[ 'raw manifest rewrite', ( value ) => { value.rewriteRawEvidenceManifest = true; }, /preserve the finalized raw/ ],
		[ 'legacy host paths', ( value ) => { value.rawBundleDirectory = '/capture-machine/raw'; }, /exact portable top-level fields/ ],
		[ 'unknown extension field', ( value ) => { value.note = 'not bound by schema'; }, /exact portable top-level fields/ ],
		[ 'missing required field', ( value ) => { delete value.physicalRoute; }, /exact portable top-level fields/ ]
	];
	for ( const [ name, mutate, pattern ] of mutations ) {

		const value = joined();
		mutate( value );
		assert.throws( () => validateEvidenceLaneJoin( value ), pattern, name );

	}

} );
