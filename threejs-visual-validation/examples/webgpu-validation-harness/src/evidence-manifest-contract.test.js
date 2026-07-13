import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	assertEvidenceManifestContract,
	canonicalSha256,
	NORMATIVE_JSON_PATHS,
	routeStateDigest,
	STANDARD_IMAGE_PATHS,
	validateEvidenceManifestContract,
	visualReviewDigest
} from './evidence-manifest-contract.js';
import { createOfflinePromotionBinding, resolveOfflinePromotionManifest } from './offline-promotion.js';

const hash = ( label ) => canonicalSha256( { label } );
const numeric = ( value, unit, label, source ) => ( { value, unit, label, source } );

function route() {

	const record = {
		path: '/demos/webgpu-validation-harness/tier/release/',
		scenario: 'browser-capture',
		mechanism: null,
		mode: 'final',
		tier: 'release',
		camera: 'design',
		seed: '0x00000001',
		timeSeconds: numeric( 2, 'seconds', 'Authored', 'release visual contract' )
	};
	record.stateDigest = routeStateDigest( record );
	return record;

}

function claims( performance = true ) {

	return {
		visualCorrectness: 'PASS',
		mechanismCorrectness: 'PASS',
		performanceCompliance: performance ? 'PASS' : 'NOT_CLAIMED',
		gpuAttribution: performance ? 'PASS' : 'NOT_CLAIMED',
		lifecycleStability: 'PASS',
		visualError: 'PASS'
	};

}

function selfManifestFile() {

	return {
		path: 'evidence-manifest.json',
		status: 'self-excluded',
		kind: 'evidence-manifest',
		reason: 'The manifest cannot bind its own final serialized bytes.'
	};

}

function session( profile, rootRoute, sourceClosureHash, buildRevision ) {

	const physical = profile !== 'correctness';
	const sessionId = `webgpu-validation-harness:${ profile }:release`;
	return {
		sessionId,
		profile,
		automationSurface: physical ? 'codex-in-app-browser' : 'playwright-headless-chromium',
		adapterClass: 'hardware',
		adapterIdentity: { kind: 'gpu-adapter', digest: physical ? hash( 'physical-adapter' ) : hash( 'headless-hardware-adapter' ) },
		deviceIdentity: { kind: 'gpu-device', digest: physical ? hash( 'physical-device' ) : hash( 'headless-hardware-device' ) },
		browserIdentity: { kind: 'browser', digest: physical ? hash( 'physical-browser' ) : hash( 'headless-browser' ) },
		osIdentity: { kind: 'operating-system', digest: physical ? hash( 'physical-os' ) : hash( 'headless-os' ) },
		refreshIdentity: { kind: 'display-refresh', digest: physical ? hash( 'physical-refresh' ) : hash( 'headless-refresh' ) },
		colorIdentity: { kind: 'color-pipeline', digest: physical ? hash( 'physical-color' ) : hash( 'headless-color' ) },
		limitationsDigest: physical ? hash( 'physical-limitations' ) : hash( 'headless-limitations' ),
		threeRevision: '0.185.1',
		sourceClosureHash,
		buildRevision,
		startedAt: '2026-07-12T12:00:00Z',
		finishedAt: '2026-07-12T12:01:00Z',
		routePath: rootRoute.path,
		routeDigest: canonicalSha256( rootRoute ),
		stateDigest: rootRoute.stateDigest,
		document: {
			kind: 'capture-session-document',
			path: `sessions/${ profile }.capture-session.json`,
			sha256: hash( `${ profile }-document` ),
			byteLength: 2048
		},
		writeLedger: {
			kind: 'capture-session-write-ledger',
			path: `sessions/${ profile }.write-ledger.json`,
			sha256: hash( `${ profile }-write-ledger` ),
			byteLength: 1024
		},
		rendererInitialized: true,
		isWebGPUBackend: true,
		timestampQuerySupported: profile === 'performance'
	};

}

function sessionFiles( sessions ) {

	return sessions.flatMap( ( captureSession ) => [
		{
			path: captureSession.document.path,
			status: 'captured',
			kind: captureSession.document.kind,
			sha256: captureSession.document.sha256,
			byteLength: captureSession.document.byteLength
		},
		{
			path: captureSession.writeLedger.path,
			status: 'captured',
			kind: captureSession.writeLedger.kind,
			sha256: captureSession.writeLedger.sha256,
			byteLength: captureSession.writeLedger.byteLength
		}
	] );

}

function directImage( path, index ) {

	return {
		path,
		status: 'captured',
		kind: 'direct-capture',
		role: path.slice( 0, - '.png'.length ),
		mediaType: 'image/png',
		sha256: hash( `image-${ index }-${ path }` ),
		byteLength: 4096 + index
	};

}

function releaseImages( pipelineGraphDigest ) {

	const images = STANDARD_IMAGE_PATHS.map( ( path, index ) => directImage( path, index ) );
	for ( const path of [ 'no-post.design.png', 'temporal.t000.png', 'temporal.t001.png' ] ) {

		const index = images.findIndex( ( image ) => image.path === path );
		images[ index ] = {
			path,
			status: 'not-applicable',
			kind: 'not-applicable',
			role: path.slice( 0, - '.png'.length ),
			notApplicableProof: {
				reason: `${ path } is structurally absent from the non-temporal runtime graph.`,
				pipelineGraphPath: 'pipeline-graph.json',
				pipelineGraphDigest
			}
		};

	}
	const normal = directImage( 'diagnostic.normal.png', 10 );
	const emissive = directImage( 'diagnostic.emissive.png', 11 );
	const mosaic = images.find( ( image ) => image.path === 'diagnostics.mosaic.png' );
	mosaic.kind = 'derived-image';
	mosaic.derivation = {
		method: 'deterministic diagnostic contact sheet',
		implementation: 'capture-hook.mjs',
		parametersDigest: hash( 'diagnostic-mosaic-recipe' )
	};
	mosaic.sourceCaptures = [ normal.path, emissive.path ];
	return [ ...images, normal, emissive ];

}

function bindPromotion( manifest ) {

	const binding = createOfflinePromotionBinding( manifest );
	const visualSignoff = {
		status: 'APPROVED',
		reviewer: 'graphics-reviewer',
		reviewedAt: '2026-07-12T12:00:00Z',
		reviewedImages: STANDARD_IMAGE_PATHS.filter( ( path ) => manifest.images.find( ( image ) => image.path === path )?.status === 'captured' ),
		notes: [ 'Every applicable standard image was inspected against its named mechanism.' ]
	};
	visualSignoff.reviewDigest = visualReviewDigest( visualSignoff );
	manifest.promotion = {
		status: 'APPROVED',
		binding,
		bindingDigest: canonicalSha256( binding ),
		visualSignoff
	};
	return manifest;

}

function releaseManifest( { performance = true } = {} ) {

	const rootRoute = route();
	const sourceClosureHash = hash( 'source-closure' );
	const buildRevision = hash( 'build-revision' );
	const sessions = [
		session( 'correctness', rootRoute, sourceClosureHash, buildRevision ),
		session( 'physical-route', rootRoute, sourceClosureHash, buildRevision )
	];
	if ( performance ) sessions.push( session( 'performance', rootRoute, sourceClosureHash, buildRevision ) );
	const normativeFiles = NORMATIVE_JSON_PATHS.map( ( path, index ) => path === 'evidence-manifest.json' ? selfManifestFile() : {
		path,
		status: 'captured',
		kind: 'normative-json',
		sha256: hash( `normative-${ index }-${ path }` ),
		byteLength: 1024 + index
	} );
	const manifest = {
		schemaVersion: 2,
		labId: 'webgpu-validation-harness',
		bundleId: `webgpu-validation-harness:release:${ performance ? 'performance' : 'correctness' }:v2`,
		bundleKind: 'release-bundle',
		publishable: true,
		skill: 'threejs-visual-validation',
		threeRevision: '0.185.1',
		sourceClosureHash,
		buildRevision,
		route: rootRoute,
		limitations: [],
		claimVerdicts: claims( performance ),
		captureSessions: sessions,
		files: [ ...normativeFiles, ...sessionFiles( sessions ) ],
		images: [],
		promotion: null
	};
	manifest.images = releaseImages( manifest.files.find( ( file ) => file.path === 'pipeline-graph.json' ).sha256 );
	return bindPromotion( manifest );

}

function contractFixture() {

	const fixtureRoute = route();
	return {
		schemaVersion: 2,
		labId: 'webgpu-validation-harness',
		bundleId: 'webgpu-validation-harness:contract-fixture:v2',
		bundleKind: 'contract-fixture',
		publishable: false,
		skill: 'threejs-visual-validation',
		threeRevision: '0.185.1',
		sourceClosureHash: hash( 'fixture-source' ),
		buildRevision: hash( 'fixture-build' ),
		route: fixtureRoute,
		limitations: [],
		claimVerdicts: {
			visualCorrectness: 'INSUFFICIENT_EVIDENCE',
			mechanismCorrectness: 'INSUFFICIENT_EVIDENCE',
			performanceCompliance: 'NOT_CLAIMED',
			gpuAttribution: 'NOT_CLAIMED',
			lifecycleStability: 'INSUFFICIENT_EVIDENCE'
		},
		captureSessions: [],
		files: [ selfManifestFile() ],
		images: [],
		promotion: {
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
		}
	};

}

function rawSoftwarePerformanceSession() {

	const fixture = contractFixture();
	const captureSession = session( 'performance', fixture.route, fixture.sourceClosureHash, fixture.buildRevision );
	captureSession.adapterClass = 'software';
	captureSession.adapterIdentity.digest = hash( 'software-diagnostic-adapter' );
	captureSession.timestampQuerySupported = false;
	return {
		...fixture,
		bundleId: 'webgpu-validation-harness:raw-performance:software:v2',
		bundleKind: 'raw-capture-session',
		captureSessions: [ captureSession ],
		files: [ selfManifestFile(), ...sessionFiles( [ captureSession ] ) ]
	};

}

function messages( manifest ) {

	return validateEvidenceManifestContract( manifest ).join( '\n' );

}

test( 'canonical hashing is key-order independent and rejects unsupported values', () => {

	assert.equal( canonicalSha256( { b: 2, a: 1 } ), canonicalSha256( { a: 1, b: 2 } ) );
	assert.throws( () => canonicalSha256( { invalid: Number.NaN } ), /non-finite/ );

} );

test( 'accepts a complete offline joined release and a truthful contract fixture', () => {

	const release = releaseManifest();
	assert.deepEqual( validateEvidenceManifestContract( release ), [] );
	assert.equal( assertEvidenceManifestContract( release ), release );
	assert.deepEqual( validateEvidenceManifestContract( contractFixture() ), [] );
	assert.deepEqual( validateEvidenceManifestContract( rawSoftwarePerformanceSession() ), [], 'Raw software evidence remains diagnostic and nonpublishable.' );

} );

test( 'rejects duplicate file paths, image paths, and image roles', () => {

	for ( const mutate of [
		( record ) => record.files.push( structuredClone( record.files[ 0 ] ) ),
		( record ) => record.images.push( structuredClone( record.images[ 0 ] ) ),
		( record ) => { record.images[ 1 ].role = record.images[ 0 ].role; }
	] ) {

		const record = releaseManifest();
		mutate( record );
		assert.match( messages( record ), /duplicates/ );

	}

} );

test( 'closes derived-image sources and rejects missing, self, and N/A references', () => {

	for ( const [ source, pattern ] of [
		[ 'missing.png', /does not resolve/ ],
		[ 'diagnostics.mosaic.png', /self-reference/ ],
		[ 'temporal.t000.png', /references N\/A image/ ],
		[ 'visual-contract.json', /non-image evidence kind/ ]
	] ) {

		const record = releaseManifest();
		record.images.find( ( image ) => image.path === 'diagnostics.mosaic.png' ).sourceCaptures = [ source ];
		assert.match( messages( record ), pattern );

	}

} );

test( 'closes visual review against captured images and recomputes its digest', () => {

	const missing = releaseManifest();
	missing.promotion.visualSignoff.reviewedImages.push( 'missing.png' );
	assert.match( messages( missing ), /does not resolve/ );

	const notApplicable = releaseManifest();
	notApplicable.promotion.visualSignoff.reviewedImages.push( 'temporal.t000.png' );
	assert.match( messages( notApplicable ), /references N\/A image/ );

	const staleDigest = releaseManifest();
	staleDigest.promotion.visualSignoff.notes[ 0 ] = 'Changed after review.';
	assert.match( messages( staleDigest ), /Visual signoff review does not match/ );

} );

test( 'rejects missing, cross-lane, and swapped capture sessions', () => {

	const missing = releaseManifest();
	missing.captureSessions = missing.captureSessions.filter( ( entry ) => entry.profile !== 'physical-route' );
	assert.match( messages( missing ), /missing the physical-route capture lane/ );

	const crossed = releaseManifest();
	crossed.captureSessions.find( ( entry ) => entry.profile === 'correctness' ).automationSurface = 'codex-in-app-browser';
	assert.match( messages( crossed ), /crosses capture lanes/ );

	const swapped = releaseManifest();
	[ swapped.captureSessions[ 0 ], swapped.captureSessions[ 1 ] ] = [ swapped.captureSessions[ 1 ], swapped.captureSessions[ 0 ] ];
	assert.match( messages( swapped ), /Promotion binding capture-session set differs/ );

} );

test( 'binds capture-session document and write-ledger references to captured files', () => {

	const hashSwap = releaseManifest();
	const captureSession = hashSwap.captureSessions[ 0 ];
	[ captureSession.document.sha256, captureSession.writeLedger.sha256 ] = [ captureSession.writeLedger.sha256, captureSession.document.sha256 ];
	assert.match( messages( hashSwap ), /SHA-256 does not match/ );

	const unavailable = releaseManifest();
	const referenced = unavailable.captureSessions[ 0 ].document.path;
	unavailable.files.find( ( file ) => file.path === referenced ).status = 'not-applicable';
	assert.match( messages( unavailable ), /non-captured file-ledger entry/ );

	const reused = releaseManifest();
	reused.captureSessions[ 1 ].document = structuredClone( reused.captureSessions[ 0 ].document );
	assert.match( messages( reused ), /reuses another session document path/ );

} );

test( 'recomputes every promotion digest instead of trusting authored hashes', () => {

	for ( const [ field, mutate ] of [
		[ 'manifest core', ( record ) => { record.promotion.binding.manifestCoreDigest = hash( 'forged' ); } ],
		[ 'route', ( record ) => { record.promotion.binding.routeDigest = hash( 'forged' ); } ],
		[ 'limitations', ( record ) => { record.promotion.binding.limitationsDigest = hash( 'forged' ); } ],
		[ 'claim verdicts', ( record ) => { record.promotion.binding.claimVerdictsDigest = hash( 'forged' ); } ],
		[ 'capture-session set', ( record ) => { record.promotion.binding.captureSessionSetDigest = hash( 'forged' ); } ],
		[ 'artifact ledger', ( record ) => { record.promotion.binding.artifactLedgerDigest = hash( 'forged' ); } ],
		[ 'image ledger', ( record ) => { record.promotion.binding.imageLedgerDigest = hash( 'forged' ); } ],
		[ 'binding', ( record ) => { record.promotion.bindingDigest = hash( 'forged' ); } ]
	] ) {

		const record = releaseManifest();
		mutate( record );
		assert.match( messages( record ), new RegExp( field.replace( '-', '[- ]' ), 'i' ) );

	}

} );

test( 'requires release, session, hardware, browser, route, and binding identities to agree', () => {

	for ( const [ mutate, pattern ] of [
		[ ( record ) => { record.captureSessions[ 0 ].sourceClosureHash = hash( 'other-source' ); }, /source closure differs/ ],
		[ ( record ) => { record.captureSessions[ 0 ].buildRevision = hash( 'other-build' ); }, /build revision differs/ ],
		[ ( record ) => { record.captureSessions[ 0 ].threeRevision = '0.184.0'; }, /Three\.js revision differs/ ],
		[ ( record ) => { record.captureSessions[ 0 ].finishedAt = '2026-07-12T11:59:00Z'; }, /capture interval is invalid/ ],
		[ ( record ) => { record.captureSessions[ 0 ].routePath = '/demos/another-lab/'; }, /route path is not a member of the release route set/ ],
		[ ( record ) => { record.captureSessions[ 0 ].stateDigest = hash( 'other-state' ); }, /state digest differs/ ],
		[ ( record ) => { record.promotion.binding.claimVerdicts.visualCorrectness = 'FAIL'; }, /claim verdicts differ/ ],
		[ ( record ) => { record.captureSessions.find( ( entry ) => entry.profile === 'performance' ).adapterIdentity.digest = hash( 'another-adapter' ); }, /different hardware adapters/ ],
		[ ( record ) => { record.captureSessions.find( ( entry ) => entry.profile === 'performance' ).browserIdentity.digest = hash( 'another-browser' ); }, /different physical browsers/ ]
		,[ ( record ) => { record.captureSessions.find( ( entry ) => entry.profile === 'performance' ).deviceIdentity.digest = hash( 'another-device' ); }, /different GPU devices/ ]
		,[ ( record ) => { record.captureSessions.find( ( entry ) => entry.profile === 'performance' ).colorIdentity.digest = hash( 'another-color' ); }, /different color pipelines/ ]
	] ) {

		const record = releaseManifest();
		mutate( record );
		assert.match( messages( record ), pattern );

	}

} );

test( 'contract fixtures cannot claim PASS or promotion eligibility', () => {

	const passing = contractFixture();
	passing.claimVerdicts.visualCorrectness = 'PASS';
	assert.match( messages( passing ), /cannot claim PASS/ );

	const eligible = contractFixture();
	eligible.promotion.status = 'PENDING_VISUAL_SIGNOFF';
	assert.match( messages( eligible ), /cannot claim promotion eligibility/ );

} );

test( 'publishable releases require all normative files and ten structurally proven image slots', () => {

	const missingNormative = releaseManifest();
	missingNormative.files = missingNormative.files.filter( ( file ) => file.path !== 'visual-errors.json' );
	assert.match( messages( missingNormative ), /missing captured normative artifact/ );

	const missingImage = releaseManifest();
	missingImage.images = missingImage.images.filter( ( image ) => image.path !== 'camera.far.png' );
	assert.match( messages( missingImage ), /missing standard image record/ );

	const staleNaProof = releaseManifest();
	staleNaProof.images.find( ( image ) => image.path === 'temporal.t000.png' ).notApplicableProof.pipelineGraphDigest = hash( 'stale-graph' );
	assert.match( messages( staleNaProof ), /N\/A proof digest differs/ );

} );

test( 'publishable final and diagnostics must be captured and hash-distinct', () => {

	const aliased = releaseManifest();
	aliased.images.find( ( image ) => image.path === 'diagnostics.mosaic.png' ).sha256 = aliased.images.find( ( image ) => image.path === 'final.design.png' ).sha256;
	assert.match( messages( aliased ), /identical hashes/ );

	const notApplicable = releaseManifest();
	const diagnostic = notApplicable.images.find( ( image ) => image.path === 'diagnostics.mosaic.png' );
	Object.assign( diagnostic, {
		status: 'not-applicable',
		kind: 'not-applicable',
		notApplicableProof: {
			reason: 'Diagnostics are structurally absent.',
			pipelineGraphPath: 'pipeline-graph.json',
			pipelineGraphDigest: notApplicable.files.find( ( file ) => file.path === 'pipeline-graph.json' ).sha256
		}
	} );
	assert.match( messages( notApplicable ), /requires captured final and diagnostic images/ );

} );

test( 'assert helper aggregates semantic failures', () => {

	const invalid = releaseManifest();
	invalid.route.stateDigest = hash( 'forged-state' );
	assert.throws( () => assertEvidenceManifestContract( invalid ), AggregateError );

} );

test( 'offline promotion resolves the checked release manifest rather than a parallel browser bundle', async () => {

	const pending = releaseManifest();
	pending.publishable = false;
	pending.promotion = {
		status: 'PENDING_VISUAL_SIGNOFF',
		binding: pending.promotion.binding,
		bindingDigest: pending.promotion.bindingDigest,
		visualSignoff: { status: 'PENDING', reviewer: null, reviewedAt: null, reviewDigest: null, reviewedImages: [], notes: [] }
	};
	const result = await resolveOfflinePromotionManifest( pending, {
		status: 'APPROVED',
		reviewer: 'graphics-reviewer',
		reviewedAt: '2026-07-12T12:30:00Z',
		reviewedImages: STANDARD_IMAGE_PATHS.filter( ( path ) => pending.images.find( ( image ) => image.path === path )?.status === 'captured' ),
		notes: [ 'Every applicable standard image was inspected directly.' ]
	} );
	assert.equal( result.status, 'APPROVED' );
	assert.equal( result.publishable, true );
	assert.deepEqual( validateEvidenceManifestContract( result.manifest ), [] );

} );
