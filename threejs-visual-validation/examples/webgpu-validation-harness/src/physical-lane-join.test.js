import assert from 'node:assert/strict';
import { test } from 'node:test';

import { laneIdentityBindingDigest, validateEvidenceLaneJoin } from './physical-lane-join.js';

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

	return {
		schemaVersion: 1,
		publishable: false,
		rawEvidenceManifestFinalized: true,
		rewriteRawEvidenceManifest: false,
		rawBundleDirectory: '/external/raw-session',
		releaseBundleDirectory: '/external/release-candidate',
		performanceClaims: true,
		correctness: lane( 'correctness', 'correctness', 'codex-in-app-browser', 0 ),
		physicalRoute: lane( 'physicalRoute', 'physical-route', 'codex-in-app-browser', 1 ),
		hardwarePerformance: lane( 'hardwarePerformance', 'performance', 'codex-in-app-browser', 2 )
	};

}

test( 'offline promotion hook requires three distinct matching lanes for performance claims', () => {

	assert.deepEqual( validateEvidenceLaneJoin( joined() ), {
		status: 'READY_FOR_OFFLINE_PROMOTION_REVIEW',
		publishable: false,
		performanceClaims: true,
		laneCount: 3,
		sourceClosureHash: HASHES[ 3 ],
		buildRevision: HASHES[ 4 ],
		threeRevision: '0.185.1',
		rawBundleDirectory: '/external/raw-session',
		releaseBundleDirectory: '/external/release-candidate'
	} );

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
		[ 'raw join publishable', ( value ) => { value.publishable = true; }, /nonpublishable promotion input/ ],
		[ 'wrong Three revision', ( value ) => { value.correctness.threeRevision = '0.184.0'; }, /wrong Three revision/ ],
		[ 'invalid capture interval', ( value ) => { value.physicalRoute.finishedAt = '2026-07-11T00:00:00.000Z'; }, /invalid capture interval/ ],
		[ 'raw manifest rewrite', ( value ) => { value.rewriteRawEvidenceManifest = true; }, /preserve the finalized raw/ ],
		[ 'release reuses raw directory', ( value ) => { value.releaseBundleDirectory = value.rawBundleDirectory; }, /separate release-bundle/ ]
	];
	for ( const [ name, mutate, pattern ] of mutations ) {

		const value = joined();
		mutate( value );
		assert.throws( () => validateEvidenceLaneJoin( value ), pattern, name );

	}

} );
