import { numericEvidence } from './decision-record.js';

const axisNames = [ 'truthFidelity', 'targetCost', 'integrationSimplicity', 'determinism', 'recovery', 'evidenceFeasibility' ];

const weights = Object.freeze( Object.fromEntries( axisNames.map( ( axis ) => [ axis, numericEvidence( 1, 'weight', 'Authored', 'frozen physics decision policy v1' ) ] ) ) );
const hardGates = Object.freeze( {
	truthError: numericEvidence( 1, 'pass-fail', 'Gated', 'observable truth contract' ),
	targetMemory: numericEvidence( 1, 'pass-fail', 'Gated', 'named target memory contract' ),
	updateLatency: numericEvidence( 1, 'pass-fail', 'Gated', 'interaction latency contract' )
} );

function candidate( candidateId, algorithmFamily, scores, failures = [] ) {

	return {
		candidateId,
		algorithmFamily,
		scores: Object.fromEntries( axisNames.map( ( axis, index ) => [ axis, scores[ index ] ] ) ),
		hardGateResults: Object.fromEntries( Object.keys( hardGates ).map( ( gate ) => [ gate, failures.includes( gate ) ? 'fail' : 'pass' ] ) ),
		pros: [ `${ algorithmFamily } has a distinct causal mechanism for this fixture` ],
		cons: [ `${ algorithmFamily } retains workload-specific cost or fidelity risk` ],
		assumptions: [ `${ algorithmFamily } inputs and ownership are frozen before scoring` ],
		evidence: [ `${ algorithmFamily } score is authored and remains provisional until oracle or in-app Browser evidence` ]
	};

}

function decision( problemId, observable, selectedCandidateId, candidates ) {

	return {
		problemId,
		decisionRevision: `${ problemId }-decision-v1`,
		observable,
		frozenWeights: structuredClone( weights ),
		tieBreakOrder: [ 'truthFidelity', 'evidenceFeasibility', 'targetCost', 'determinism', 'recovery', 'integrationSimplicity' ],
		hardGates: structuredClone( hardGates ),
		candidates,
		selectedCandidateId,
		status: 'provisional'
	};

}

export const decisionFixtures = Object.freeze( [
	decision( 'static-product-query', 'Exact ray, overlap, and closest-point queries over a static product assembly without dynamic response.', 'analytic-query-provider', [
		candidate( 'analytic-query-provider', 'analytic primitives plus static BVH', [ 5, 5, 5, 5, 5, 5 ] ),
		candidate( 'authored-kinematic', 'authored kinematic transforms', [ 2, 4, 4, 5, 4, 4 ], [ 'truthError' ] ),
		candidate( 'cpu-rigid-solver', 'local CPU rigid-body solver', [ 4, 3, 3, 4, 4, 4 ] ),
		candidate( 'gpu-specialist', 'GPU bounded contact solver', [ 4, 2, 2, 3, 3, 2 ] ),
		candidate( 'external-engine', 'external general rigid-body engine', [ 4, 2, 2, 3, 4, 3 ] ),
		candidate( 'offline-recorded', 'offline recorded transforms', [ 1, 4, 3, 5, 5, 2 ], [ 'truthError', 'updateLatency' ] )
	] ),
	decision( 'tower-authored-motion', 'Visible deterministic oar, rigging, cloth, and mechanism motion with no force-response claim.', 'authored-kinematic', [
		candidate( 'analytic-query-provider', 'analytic query provider', [ 2, 5, 4, 5, 5, 4 ], [ 'truthError' ] ),
		candidate( 'authored-kinematic', 'semantic authored kinematic rig', [ 5, 5, 5, 5, 5, 5 ] ),
		candidate( 'cpu-rigid-solver', 'local CPU rigid-body solver', [ 3, 3, 2, 4, 4, 3 ] ),
		candidate( 'gpu-specialist', 'GPU articulated solver', [ 3, 2, 1, 3, 3, 2 ] ),
		candidate( 'external-engine', 'external articulated engine', [ 3, 2, 2, 3, 4, 3 ] ),
		candidate( 'offline-recorded', 'offline baked animation', [ 4, 5, 4, 5, 5, 4 ] )
	] ),
	decision( 'dynamic-skiff-coupling', 'A bounded skiff and persistent nearshore water exchange equal-and-opposite force, torque, work, and moving-boundary momentum on the GPU.', 'gpu-specialist', [
		candidate( 'analytic-query-provider', 'analytic hydrostatic query provider', [ 2, 5, 4, 5, 5, 4 ], [ 'truthError' ] ),
		candidate( 'authored-kinematic', 'one-way authored skiff motion', [ 1, 5, 5, 5, 5, 4 ], [ 'truthError' ] ),
		candidate( 'cpu-rigid-solver', 'CPU body solver with GPU water staging', [ 4, 2, 2, 4, 4, 3 ], [ 'updateLatency' ] ),
		candidate( 'gpu-specialist', 'bounded GPU rigid-body and SWE coupling solver', [ 5, 4, 3, 4, 4, 4 ] ),
		candidate( 'external-engine', 'external rigid body with shared-resource water adapter', [ 5, 3, 2, 4, 5, 3 ] ),
		candidate( 'offline-recorded', 'offline fluid-structure playback', [ 5, 1, 2, 5, 5, 2 ], [ 'updateLatency' ] )
	] ),
	decision( 'dense-rigid-assembly', 'General rigid bodies, convex contacts, joints, CCD, sleeping, and persistent manifolds with a mature feature set.', 'external-engine', [
		candidate( 'analytic-query-provider', 'analytic query provider', [ 1, 4, 4, 5, 5, 3 ], [ 'truthError' ] ),
		candidate( 'authored-kinematic', 'authored kinematic assembly', [ 1, 4, 4, 5, 5, 3 ], [ 'truthError' ] ),
		candidate( 'cpu-rigid-solver', 'new local CPU general rigid solver', [ 4, 3, 1, 4, 2, 2 ] ),
		candidate( 'gpu-specialist', 'new general GPU rigid solver', [ 4, 3, 1, 3, 2, 2 ] ),
		candidate( 'external-engine', 'external mature rigid-body engine adapter', [ 5, 4, 4, 4, 5, 4 ] ),
		candidate( 'offline-recorded', 'offline rigid-body playback', [ 3, 4, 3, 5, 5, 3 ], [ 'updateLatency' ] )
	] ),
	decision( 'overturning-breaker-reference', 'High-fidelity overturning breaker and aeration reference where live direct manipulation is not required.', 'offline-recorded', [
		candidate( 'analytic-query-provider', 'analytic wave surface', [ 1, 5, 5, 5, 5, 4 ], [ 'truthError' ] ),
		candidate( 'authored-kinematic', 'authored mesh deformation', [ 2, 4, 4, 5, 5, 3 ], [ 'truthError' ] ),
		candidate( 'cpu-rigid-solver', 'real-time CPU particle fluid', [ 3, 1, 1, 3, 2, 1 ], [ 'truthError', 'targetMemory', 'updateLatency' ] ),
		candidate( 'gpu-specialist', 'real-time GPU particle fluid', [ 4, 1, 1, 3, 2, 2 ], [ 'truthError', 'targetMemory' ] ),
		candidate( 'external-engine', 'remote real-time CFD service', [ 5, 1, 1, 3, 3, 1 ], [ 'updateLatency' ] ),
		candidate( 'offline-recorded', 'offline CFD volume or surface playback', [ 5, 4, 4, 5, 5, 5 ] )
	] )
] );

const externalTimeout = Object.freeze( { value: 50, unit: 'millisecond', label: 'Gated', source: 'external adapter watchdog contract' } );

export const externalAdapterFixture = Object.freeze( {
	adapterId: 'external-rigid-body-adapter',
	externalSolverIdVersion: 'fixture-rigid-solver/build-2026.07.13',
	contextId: 'physics-context-fixture',
	boundaryRevision: 'external-rigid-boundary-v1',
	ownedStateEquations: [ 'rigid-body-linear-angular-momentum' ],
	ownership: {
		stepping: 'external-solver',
		constraintAssemblyAndSolve: 'external-solver',
		collisionDetection: 'external-solver',
		contactManifoldLifecycle: 'external-solver',
		forceImpulseAccumulation: 'external-solver',
		committedStatePublication: 'external-solver'
	},
	supportedFramesCharts: [ 'physics-root-frame' ],
	unitConversion: {
		sourceUnitSystemId: 'fixture-si',
		destinationUnitSystemId: 'canonical-SI',
		perQuantityAffineOrLinearMaps: Object.fromEntries( [ 'length', 'mass', 'time', 'force', 'torque', 'linearImpulse', 'angularImpulse' ].map( ( quantity ) => [ quantity, { scale: 1, offset: 0 } ] ) ),
		handednessAndAxialConvention: { properRotation: true, axialConvention: 'explicit', ingress: 'right-handed-y-up', egress: 'exact-inverse' },
		conversionError: { maximumRoundTrip: { value: 1e-9, unit: 'relative', label: 'Gated', source: 'adapter conversion oracle' } }
	},
	clockMapping: {
		externalClockId: 'external-fixed-clock', contextClockId: 'coordination-clock', mappingRevision: 'clock-map-v1',
		mappingDescriptorRef: { clockId: 'coordination-clock', mappingRevision: 'fixed-36hz-v1', discontinuityEpoch: 'continuity-1' },
		maximumAgeAndMappingError: { maximumAge: { value: 1 / 36, unit: 'second', label: 'Gated', source: 'coordination contract' }, maximumError: { value: 1e-9, unit: 'second', label: 'Gated', source: 'clock mapping oracle' } }
	},
	stepSemantics: 'fixed',
	signalDescriptors: [ { signalId: 'rigid-body-state', providerId: 'external-rigid-body-adapter', contextId: 'physics-context-fixture', physicsFrameId: 'physics-root-frame' } ],
	interactionCapabilities: [
		{ capabilityId: 'wrench-ingress', direction: 'ingress', role: 'reaction', payloadTag: 'wrenchRate', targetEquationId: 'rigid-body-linear-angular-momentum', frameId: 'physics-root-frame', footprintKinds: [ 'area' ], unitSignature: { force: 'newton', torque: 'newton-metre' }, exactOnceSupport: 'required-ledger', reactionAtomicity: 'same-commit-transaction', dependencyRef: { dependencyId: 'water-to-body-fence', requiredCompletionVersion: 'completion-42' }, errorDescriptorRef: 'wrench-error-v1' },
		{ capabilityId: 'moving-boundary-egress', direction: 'egress', role: 'source', payloadTag: 'movingBoundary', targetEquationId: 'water-boundary-momentum', frameId: 'physics-root-frame', footprintKinds: [ 'area' ], unitSignature: { position: 'metre', velocity: 'metre-per-second' }, exactOnceSupport: 'required-ledger', reactionAtomicity: 'same-commit-transaction', dependencyRef: { dependencyId: 'body-to-water-fence', requiredCompletionVersion: 'completion-42' }, errorDescriptorRef: 'boundary-error-v1' }
	],
	stepReceipts: [ {
		receiptId: 'external-step-42', adapterId: 'external-rigid-body-adapter', status: 'completed',
		inputApplicationLedgerIds: [ 'wrench-application-1003' ],
		outputPreparedVersions: [ { stateEquationId: 'rigid-body-linear-angular-momentum', signalId: 'rigid-body-state', preparedStateVersion: 'body-42-prepared', commitTransactionId: 'coupled-commit-42' } ],
		dependencyCompletionRefs: [ { dependencyId: 'water-to-body-fence', completionId: 'water-to-body-42', receiptDigest: 'sha256:water-to-body-42' } ]
	} ],
	residencySynchronization: {
		authorityBySignalOrStateEquation: { 'rigid-body-linear-angular-momentum': 'external-solver', 'rigid-body-state': 'external-solver' },
		transport: 'shared-resource',
		resourceProtocol: {
			acquireDependency: { dependencyId: 'water-to-body-fence', requiredCompletionVersion: 'completion-42' },
			releaseOrCompletionToken: { kind: 'same-queue-completion-token', tokenId: 'external-release-42' },
			generationAndSubresourceFields: { resourceGeneration: 'body-resource-generation-42', subresource: { byteOffset: 0, byteLength: 256 } }
		},
		transferProtocol: { serializationLayoutAndDigest: { mode: 'not-used-shared-resource' }, sequenceAndExactOnceKeys: { resourceGeneration: 'body-resource-generation-42' } },
		hostVisibilityProof: 'not-host-visible'
	},
	precisionDeterminism: { reductionOrdering: 'deterministic-tree', scalarFormatsAndAccumulationMode: { state: 'float32', reduction: 'float64-compensated' }, solverSeedAndStreamIdentity: { seed: 7, cursor: 42 }, replayEquivalenceGate: 'bounded-observable-error' },
	errorModel: { state: 'rigid-state-error-v1', coupling: 'body-water-coupling-error-v1' },
	checkpointRollback: {
		support: 'checkpoint-and-replay', checkpointFormatAndDigest: { format: 'rigid-checkpoint-v1', digest: 'sha256:fixture' },
		cadenceAndMaximumRollback: { cadence: 'every-36-steps', maximumRollback: { value: 1, unit: 'second', label: 'Gated', source: 'recovery contract' } },
		includedStateVersionsInventoriesAndCursors: { states: [ 'rigid-body-state' ], inventories: [ 'momentum' ], cursors: [ 'interaction', 'event', 'rng', 'stable-id' ] },
		restoreOrderingAndValidationGates: { order: [ 'freeze', 'restore', 'replay', 'validate', 'atomic-publish' ], gates: [ 'finite-state', 'conservation', 'constraint', 'error-bound' ] }
	},
	failurePolicy: {
		detectionAndTimeout: { timeout: externalTimeout, detection: 'heartbeat-and-step-receipt-deadline' },
		freezeCommitGroups: [ 'coupled-commit' ], priorCommittedStateDisposition: 'preserve', queuedInteractionEventDisposition: 'retain-for-replay',
		recoveryOwnerAndPlan: { owner: 'external-rigid-body-adapter', plan: 'checkpoint-replay-v1' }, degradedPublication: 'forbidden'
	}
} );

export const externalAdapterCostFixture = Object.freeze( {
	adapterId: 'external-rigid-body-adapter',
	completeDependencyTail: true,
	segments: {
		enqueue: { status: 'unmeasured' }, conversion: { status: 'unmeasured' }, queueWait: { status: 'unmeasured' },
		transport: { status: 'unmeasured' }, remoteSolve: { status: 'unavailable' }, completion: { status: 'unmeasured' },
		deserialization: { status: 'not-applicable-shared-resource' }, atomicCommit: { status: 'unmeasured' }
	},
	claimStatus: 'insufficient-evidence'
} );
