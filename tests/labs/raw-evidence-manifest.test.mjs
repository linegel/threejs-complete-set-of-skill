import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	capturedEvidenceFile,
	capturedEvidenceImage,
	createRawCaptureSessionReference,
	createRawEvidenceManifest,
	selfExcludedManifestFile
} from '../../scripts/lib/raw-evidence-manifest.mjs';
import { canonicalSha256, routeStateDigest } from '../../scripts/lib/evidence-manifest-contract.mjs';

const hash = ( value ) => canonicalSha256( value );
const binding = ( id ) => ( { sha256: hash( id ), byteLength: 100 + id.length } );

function fixture() {

	const route = {
		path: '/demos/example-lab/',
		scenario: 'example',
		mechanism: 'history',
		mode: 'final',
		tier: 'full',
		camera: 'design',
		seed: '0x00000001',
		timeSeconds: { value: 0, unit: 'seconds', label: 'Measured', source: 'fixture route' }
	};
	route.stateDigest = routeStateDigest( route );
	const sourceClosureHash = hash( 'source' );
	const buildRevision = hash( 'build' );
	const limitations = [ {
		id: 'performance-not-claimed',
		status: 'ACTIVE',
		statement: 'The correctness lane does not claim hardware performance.',
		affectedClaims: [ 'performanceCompliance', 'gpuAttribution' ]
	} ];
	const document = { kind: 'capture-session-document', path: 'capture-session.json', ...binding( 'session' ) };
	const writeLedger = { kind: 'capture-session-write-ledger', path: 'capture-write-ledger.json', ...binding( 'ledger' ) };
	const session = {
		labId: 'example-lab',
		profile: 'correctness',
		automationSurface: 'playwright-headless-chromium',
		adapterClass: 'unknown',
		adapterIdentity: { source: 'fixture' },
		browser: { name: 'Chromium', platform: 'MacIntel' },
		sourceClosureHash,
		buildRevision,
		startedAt: '2026-07-13T10:00:00.000Z',
		finishedAt: '2026-07-13T10:01:00.000Z',
		finalRuntime: {
			metrics: {
				initialized: true,
				nativeWebGPU: true,
				rendererBackendEvidence: { isWebGPUBackend: true },
				rendererDeviceGeneration: 1,
				timestampQueriesActive: false
			},
			pipeline: { finalToneMapOwner: 'owner', finalOutputTransformOwner: 'owner' }
		}
	};
	const captureSession = createRawCaptureSessionReference( { session, route, limitations, document, writeLedger } );
	const files = [
		capturedEvidenceFile( 'visual-contract.json', 'normative-json', binding( 'visual' ) ),
		selfExcludedManifestFile(),
		capturedEvidenceFile( 'capture-session.json', 'capture-session-document', binding( 'session' ) ),
		capturedEvidenceFile( 'capture-write-ledger.json', 'capture-session-write-ledger', binding( 'ledger' ) )
	];
	const images = [ capturedEvidenceImage( {
		path: 'final.design.png',
		role: 'final.design',
		binding: binding( 'final' )
	} ) ];
	return { route, sourceClosureHash, buildRevision, limitations, captureSession, files, images };

}

test( 'raw evidence manifest factory binds one native correctness session without promotion', () => {

	const input = fixture();
	const manifest = createRawEvidenceManifest( {
		labId: 'example-lab',
		skill: 'threejs-example',
		...input,
		claimVerdicts: {
			visualCorrectness: 'INSUFFICIENT_EVIDENCE',
			mechanismCorrectness: 'PASS',
			performanceCompliance: 'NOT_CLAIMED',
			gpuAttribution: 'NOT_CLAIMED',
			lifecycleStability: 'PASS',
			visualError: 'PASS'
		}
	} );
	assert.equal( manifest.bundleKind, 'raw-capture-session' );
	assert.equal( manifest.publishable, false );
	assert.equal( manifest.promotion.status, 'NOT_ELIGIBLE' );
	assert.equal( manifest.captureSessions[ 0 ].automationSurface, 'playwright-headless-chromium' );
	assert.equal( manifest.route.stateDigest, routeStateDigest( manifest.route ) );

} );

test( 'raw evidence factory rejects source drift, unsupported verdicts, and non-WebGPU sessions', () => {

	const input = fixture();
	const claims = {
		visualCorrectness: 'INSUFFICIENT_EVIDENCE',
		mechanismCorrectness: 'PASS',
		performanceCompliance: 'NOT_CLAIMED',
		gpuAttribution: 'NOT_CLAIMED',
		lifecycleStability: 'PASS'
	};
	assert.throws( () => createRawEvidenceManifest( {
		labId: 'example-lab', skill: 'threejs-example', ...input,
		sourceClosureHash: hash( 'drift' ), claimVerdicts: claims
	} ), /differs from the manifest source closure/ );
	assert.throws( () => createRawEvidenceManifest( {
		labId: 'example-lab', skill: 'threejs-example', ...input,
		claimVerdicts: { ...claims, lifecycleStability: 'MAYBE' }
	} ), /missing or invalid/ );
	const session = {
		labId: 'example-lab', profile: 'correctness', automationSurface: 'playwright-headless-chromium',
		adapterClass: 'unknown', sourceClosureHash: input.sourceClosureHash, buildRevision: input.buildRevision,
		finalRuntime: { metrics: { initialized: true, nativeWebGPU: false, rendererBackendEvidence: { isWebGPUBackend: false } } }
	};
	assert.throws( () => createRawCaptureSessionReference( {
		session, route: input.route, limitations: input.limitations,
		document: { kind: 'capture-session-document' }, writeLedger: { kind: 'capture-session-write-ledger' }
	} ), /initialized native WebGPU/ );

} );
