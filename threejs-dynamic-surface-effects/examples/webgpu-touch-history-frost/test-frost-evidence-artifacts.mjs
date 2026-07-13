import assert from 'node:assert/strict';

import { numericDatum, NumericLabel } from '../../../labs/runtime/numeric-evidence.mjs';
import { buildFrostNormativeArtifacts, FROST_NORMATIVE_JSON_PATHS } from './frost-evidence-artifacts.mjs';

const M = ( value, unit = 'count' ) => numericDatum( value, unit, NumericLabel.MEASURED, 'Frost evidence fixture' );
const G = ( value, unit = 'count' ) => numericDatum( value, unit, NumericLabel.GATED, 'Frost evidence fixture gate' );
const digest = `sha256:${ '1'.repeat( 64 ) }`;

const runtime = {
	metrics: {
		nativeWebGPU: true,
		threeRevision: '185',
		scenario: 'touch-history-frost',
		mechanism: 'history-and-deposit',
		tier: 'full',
		rendererBackendEvidence: { deviceIdentityVerified: true },
		deviceLostObserved: false,
		uncapturedErrors: [],
		deviceErrors: [],
		timestampQueriesActive: false
	},
	pipeline: {
		owners: {
			renderer: 'threejs-dynamic-surface-effects',
			scenePass: 'host-scene',
			history: 'threejs-dynamic-surface-effects',
			finalPipeline: 'threejs-dynamic-surface-effects',
			toneMap: 'RenderOutputNode',
			outputTransform: 'RenderOutputNode'
		},
		signals: [ 'history-read', 'pointer-deposit', 'history-write' ],
		sceneSubmissions: [ { id: 'shared-scene-pass', count: 1 } ],
		finalToneMapOwner: 'RenderOutputNode',
		finalOutputTransformOwner: 'RenderOutputNode'
	},
	resources: {
		graph: { updatePolicy: 'full-field' },
		dispatch: { x: 150, y: 100 },
		historyRead: { width: 1200, height: 800 },
		historyWrite: { width: 1200, height: 800 },
		storageBytes: { historyRead: 7680000, historyWrite: 7680000 },
		residentStorageBytes: 15360000
	}
};

const captures = Array.from( { length: 27 }, ( _, index ) => ( {
	target: `recipe-${ index }`,
	width: index === 13 ? 641 : 1200,
	height: index === 13 ? 359 : 800,
	evidence: {
		artifactTarget: { captureTargetId: `frost-capture-target-${ index + 1 }` },
		execution: { computeDispatchDelta: 1, renderSubmissionDelta: 1 },
		transaction: {
			transactionId: `frost-capture-${ index + 1 }`,
			restorationVerdict: 'PASS',
			entryStateDigest: digest,
			restoredStateDigest: digest
		}
	}
} ) );

const lifecycleEvidence = {
	verdict: 'PASS',
	operations: [ 'create', 'render', 'resize', 'mode', 'tier', 'dispose' ],
	cycles: M( 50, 'cycle-count' ),
	cycleSnapshots: Array.from( { length: 50 }, ( _, cycle ) => ( {
		rowType: 'settled-lifecycle-cycle-v2',
		disposeStatus: 'PASS',
		cycle: M( cycle, 'cycle-index' ),
		beforeRendererBytes: M( 1024, 'bytes' ),
		afterRendererBytes: M( 0, 'bytes' ),
		targetBytes: M( 0, 'bytes' ),
		storageBytes: M( 1024, 'bytes' ),
		retainedTargetBytes: M( 0, 'bytes' ),
		retainedStorageBytes: M( 0, 'bytes' ),
		retainedListenerCount: M( 0 ),
		retainedControlCount: M( 0 ),
		retainedMaterialCount: M( 0 ),
		postDisposeErrorCount: M( 0 ),
		settleAnimationFrames: M( 2, 'animation-frame-count' ),
		rendererStateDisposition: 'OWNED_RENDERER_DISPOSED',
		rendererStateBeforeDigest: digest,
		rendererStateAfterDigest: digest,
		deviceLossObserved: false
	} ) ),
	before: { targetBytes: M( 0, 'bytes' ), storageBytes: M( 1024, 'bytes' ) },
	after: { targetBytes: M( 0, 'bytes' ), storageBytes: M( 0, 'bytes' ) },
	gates: { targetBytes: G( 0, 'bytes' ), storageBytes: G( 0, 'bytes' ) },
	trend: { targetBytesPerCycle: M( 0, 'bytes-per-cycle' ), storageBytesPerCycle: M( 0, 'bytes-per-cycle' ) },
	deviceErrors: [],
	limitations: []
};

const visualDifferences = {
	verdict: 'PASS',
	metrics: {
		diagnosticRgbRanges: {
			previous: M( 77, 'rgb-byte-range' ),
			deposit: M( 156, 'rgb-byte-range' ),
			next: M( 77, 'rgb-byte-range' ),
			mask: M( 255, 'rgb-byte-range' )
		}
	}
};
const coverageEvidence = {
	verdict: 'PASS',
	probes: [ { boundsChecked: true, workgroupCount: [ 81, 45, 1 ] } ]
};
const routeMatrixEvidence = {
	verdict: 'PASS',
	routes: Array.from( { length: 10 }, ( _, index ) => ( {
		recipeId: `route-${ index }`,
		kind: index === 0 ? 'canonical' : ( index < 7 ? 'mechanism' : 'tier' ),
		path: `/route-${ index }/`,
		locks: { scenario: true, mechanism: index > 0 && index < 7, tier: index >= 7 },
		startup: { scenario: 'touch-history-frost', mechanism: 'refraction-and-fresnel', tier: 'balanced', mode: 'final' },
		transactionId: `frost-capture-${ index + 18 }`,
		normalizedRgbaSha256: digest,
		rgbRangeBytes: 64
	} ) )
};

const artifacts = buildFrostNormativeArtifacts( {
	runtime, captures, visualDifferences, coverageEvidence, routeMatrixEvidence, lifecycleEvidence
} );
assert.deepEqual( Object.keys( artifacts ), FROST_NORMATIVE_JSON_PATHS );
assert.equal( artifacts[ 'pipeline-graph.json' ].computeDispatches[ 0 ].workgroups.values[ 0 ], 150 );
assert.equal( artifacts[ 'storage-resources.json' ].totalResidentBytes.value, 15360000 );
assert.equal( artifacts[ 'leak-loop.json' ].cycleSnapshots.length, 50 );
assert.equal( artifacts[ 'mechanism-metrics.json' ].verdict, 'PASS' );
assert.equal( artifacts[ 'mechanism-metrics.json' ].transactionalRouteStateMatrix.length, 10 );

const brokenLifecycle = structuredClone( lifecycleEvidence );
brokenLifecycle.cycleSnapshots[ 4 ].retainedStorageBytes.value = 1;
assert.throws( () => buildFrostNormativeArtifacts( {
	 runtime, captures, visualDifferences, coverageEvidence, routeMatrixEvidence, lifecycleEvidence: brokenLifecycle
} ), /retained lab-owned GPU resources/ );

console.log( 'frost normative evidence artifact contract passed' );
