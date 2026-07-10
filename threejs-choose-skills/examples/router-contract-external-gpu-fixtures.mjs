import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const OWNERSHIP_FIELDS = [
	'stepping',
	'constraintAssemblyAndSolve',
	'collisionDetection',
	'contactManifoldLifecycle',
	'forceImpulseAccumulation',
	'committedStatePublication'
];

const REQUIRED_RECOVERY_GATES = [ 'finite-state', 'conservation', 'constraint', 'error-bound' ];
const REQUIRED_RESTART_GATES = [ 'finite-domain', 'loss-accounting', 'conservation-error' ];

function cloneValue( value ) {

	return structuredClone( value );

}

function canonicalValue( value ) {

	if ( Array.isArray( value ) ) return value.map( canonicalValue );
	if ( value && typeof value === 'object' ) return Object.fromEntries( Object.keys( value ).sort().map( ( key ) => [ key, canonicalValue( value[ key ] ) ] ) );
	return value;

}

function digest( value ) {

	return `sha256:${ createHash( 'sha256' ).update( JSON.stringify( canonicalValue( value ) ) ).digest( 'hex' ) }`;

}

function digestWithout( value, field ) {

	const payload = cloneValue( value );
	delete payload[ field ];
	return digest( payload );

}

function quantity( value, unit, label, source ) {

	return { value, unit, label, source };

}

function absence( h, reason, authority, provenance ) {

	if ( typeof h?.typedAbsence === 'function' ) return h.typedAbsence( reason, authority, 'timeless', provenance );
	return { kind: 'absent', reason, authority, schemaId: 'typed-absence-v1', effectiveTime: 'timeless', provenance };

}

function isAbsence( h, value ) {

	if ( typeof h?.isTypedAbsence === 'function' ) return h.isTypedAbsence( value );
	return value?.kind === 'absent' && value.schemaId === 'typed-absence-v1' && typeof value.authority === 'string' && value.authority.length > 0;

}

function validateAbiRecord( h, name, value, label ) {

	if ( typeof h?.requireAbiRecord === 'function' ) h.requireAbiRecord( value, name, label );
	else if ( typeof h?.validateAbiRecord === 'function' ) h.validateAbiRecord( name, value, label );

}

function exactSet( actual, expected, label ) {

	assert.deepEqual( [ ...new Set( actual ) ].sort(), [ ...new Set( expected ) ].sort(), label );
	assert.equal( actual.length, new Set( actual ).size, `${ label } contains duplicates` );

}

function assertNonEmptyString( value, label ) {

	assert.equal( typeof value, 'string', `${ label } must be a string` );
	assert.ok( value.length > 0, `${ label } must be nonempty` );

}

function instantSeconds( instant, label ) {

	const seconds = instant?.timeSecondsDerived?.value;
	assert.ok( Number.isFinite( seconds ), `${ label } lacks a finite derived time` );
	return seconds;

}

function intervalKey( interval ) {

	return JSON.stringify( canonicalValue( interval ) );

}

function assertSameInterval( actual, expected, label ) {

	assert.equal( intervalKey( actual ), intervalKey( expected ), `${ label } interval mismatch` );

}

function assertIntervalTiling( intervals, requested, label ) {

	assert.ok( Array.isArray( intervals ) && intervals.length > 0, `${ label } has no native intervals` );
	assert.equal( intervalKey( intervals[ 0 ].start ), intervalKey( requested.start ), `${ label } starts at the wrong instant` );
	assert.equal( intervalKey( intervals.at( - 1 ).endExclusive ), intervalKey( requested.endExclusive ), `${ label } ends at the wrong instant` );
	for ( let i = 0; i < intervals.length; i ++ ) {

		const interval = intervals[ i ];
		assert.equal( interval.clockId, requested.clockId, `${ label } changes clock` );
		assert.equal( interval.intervalMappingRevision, requested.intervalMappingRevision, `${ label } changes mapping revision` );
		assert.ok( instantSeconds( interval.endExclusive, `${ label }[${ i }].endExclusive` ) > instantSeconds( interval.start, `${ label }[${ i }].start` ), `${ label } contains an empty/reversed interval` );
		if ( i > 0 ) assert.equal( intervalKey( intervals[ i - 1 ].endExclusive ), intervalKey( interval.start ), `${ label } has a gap or overlap` );

	}

}

function graphDependencies( route ) {

	return route.physicsGraph?.dependencies ?? [];

}

function graphDependencyCompletions( route ) {

	return route.physicsGraph?.executionLedger?.dependencyCompletions ?? [];

}

function dependencyFixture( route ) {

	const dependency = graphDependencies( route ).find( ( entry ) => entry.consumerStageId === 'correct-body' ) ?? graphDependencies( route )[ 0 ];
	assert.ok( dependency, 'external fixture requires one graph dependency' );
	const completion = graphDependencyCompletions( route ).find( ( entry ) => entry.dependencyId === dependency.dependencyId );
	assert.ok( completion, `external fixture cannot resolve completion for ${ dependency.dependencyId }` );
	return {
		dependencyRef: { dependencyId: dependency.dependencyId, requiredCompletionVersion: completion.receiptDigest },
		completionRef: { completionId: completion.completionId, dependencyId: completion.dependencyId, receiptDigest: completion.receiptDigest }
	};

}

function allInteractionEntries( route ) {

	return ( route.physicsInteractions ?? [] ).flatMap( ( exchange ) => [ ...( exchange.interactions ?? [] ), ...( exchange.reactions ?? [] ) ].map( ( record ) => ( { exchange, record } ) ) );

}

function allInteractionRecords( route ) {

	return allInteractionEntries( route ).map( ( entry ) => entry.record );

}

function interactionApplicationLedgers( route ) {

	return Object.values( route.physicsInteractionApplicationLedgers ?? {} );

}

function resourceGenerationValue( descriptor ) {

	return descriptor?.resourceGeneration?.generation ?? descriptor?.resourceGeneration;

}

function findSignal( route, signalId ) {

	return Object.values( route.physicsSignals ?? {} ).find( ( descriptor ) => descriptor.signalId === signalId );

}

function commitTransaction( route, transactionId ) {

	return route.physicsCommitTransactions?.[ transactionId ] ?? route.physicsGraph?.commitTransactions?.find( ( entry ) => entry.commitTransactionId === transactionId );

}

function routeCommitGroups( route ) {

	return route.physicsGraph?.commitGroups ?? [];

}

function completeReceiptDigest( receipt ) {

	receipt.contentDigest = digestWithout( receipt, 'contentDigest' );
	return receipt;

}

function interactionUnitSignature( payloadTag ) {

	if ( payloadTag === 'momentumTransfer' ) return {
		timeSemantics: 'interval-integrated',
		linearMomentum: 'kilogram-metre-per-second',
		angularMomentum: 'kilogram-square-metre-per-second',
		referencePoint: 'metre'
	};
	if ( payloadTag === 'pointImpulse' ) return {
		timeSemantics: 'interval-integrated',
		linearImpulse: 'kilogram-metre-per-second',
		applicationPoint: 'metre'
	};
	throw new Error( `external fixture has no dimensional signature for ${ payloadTag }` );

}

function makeCapabilities( route, signal, dependencyRef, prefix ) {

	const cadence = cloneValue( signal.cadence );
	const residency = cloneValue( signal.residency );
	const errorDescriptorRef = Object.values( signal.perChannelError )[ 0 ].errorId;
	const adapterBoundary = { ownedStateEquations: [ 'body-state' ], signalDescriptors: [ signal ] };
	const capabilities = new Map();
	for ( const record of allInteractionRecords( route ) ) {

		const direction = classifyBoundaryInteraction( adapterBoundary, record );
		if ( direction === null ) continue;
		const footprintKind = record.footprint.kind;
		const targetEquation = direction === 'ingress' ? record.targetStateEquation : 'not-applicable';
		const signatureKey = [ direction, record.role, record.payload.tag, record.physicsFrameId, footprintKind, targetEquation ].join( '|' );
		if ( capabilities.has( signatureKey ) ) continue;
		const capabilityToken = signatureKey.replace( /[^a-zA-Z0-9]+/g, '-' ).replace( /^-|-$/g, '' ).toLowerCase();
		capabilities.set( signatureKey, {
			capabilityId: `${ prefix }-${ capabilityToken}`,
			direction,
			role: record.role,
			payloadTag: record.payload.tag,
			frameId: record.physicsFrameId,
			unitSignature: interactionUnitSignature( record.payload.tag ),
			footprintKinds: [ footprintKind ],
			cadence: cloneValue( cadence ),
			batchBounds: {
				maximumRecords: quantity( 16, 'record', 'Gated', 'external-boundary-contract' ),
				maximumLogicalBytes: quantity( 16384, 'byte', 'Gated', 'external-boundary-contract' ),
				layoutRevision: `${ record.payload.tag }-batch-v1`
			},
			exactOnceSupport: 'required-ledger',
			reactionAtomicity: 'same-commit-transaction',
			residency: cloneValue( residency ),
			dependencyRef: cloneValue( dependencyRef ),
			errorDescriptorRef,
			targetEquationId: direction === 'ingress' ? record.targetStateEquation : { kind: 'absent', reason: 'not-applicable', authority: signal.providerId, schemaId: 'typed-absence-v1', effectiveTime: 'timeless', provenance: 'egress does not apply state inside the external solver' }
		} );

	}
	assert.ok( capabilities.size > 0, 'external fixture has no interaction capabilities to publish' );
	return [ ...capabilities.values() ];

}

function makeStepReceipt( route, signal, adapterId, receiptId, completionRef ) {

	const adapterBoundary = { ownedStateEquations: [ 'body-state' ], signalDescriptors: [ signal ] };
	const crossing = allInteractionEntries( route ).map( ( entry ) => ( { ...entry, direction: classifyBoundaryInteraction( adapterBoundary, entry.record ) } ) ).filter( ( entry ) => entry.direction !== null );
	assert.ok( crossing.length > 0, 'external fixture requires at least one boundary interaction' );
	const ingress = crossing.filter( ( entry ) => entry.direction === 'ingress' ).map( ( entry ) => entry.record );
	const egressEntries = crossing.filter( ( entry ) => entry.direction === 'egress' );
	const egress = egressEntries.map( ( entry ) => entry.record );
	const ingressIds = new Set( ingress.map( ( record ) => record.interactionId ) );
	const applications = interactionApplicationLedgers( route ).filter( ( ledger ) => ingressIds.has( ledger.interactionId ) );
	const interval = cloneValue( route.physicsGraph.coordinationAdvance.interval );
	const egressByExchangeId = Map.groupBy( egressEntries, ( entry ) => entry.exchange.exchangeId );
	const receipt = {
		receiptId,
		adapterId,
		coordinationAdvanceId: route.physicsGraph.coordinationAdvance.coordinationAdvanceId,
		externalStepSequence: route.physicsGraph.coordinationAdvance.coordinationSequence,
		requestedInterval: interval,
		actualNativeExecutionIntervals: [ cloneValue( interval ) ],
		inputStateVersions: [
			{ signalId: 'rigid-body-state', stateVersion: 'body-41' },
			{ signalId: 'water-surface-state', stateVersion: 'water-42' }
		],
		inputApplicationLedgerIds: applications.map( ( ledger ) => ledger.applicationLedgerId ).sort(),
		outputPreparedVersions: [ {
			stateEquationId: 'body-state',
			signalId: 'rigid-body-state',
			preparedStateVersion: 'body-42/prepared',
			resourceGeneration: 'body-generation-42',
			commitTransactionId: 'coordination-commit-transaction-42',
			commitGroupId: 'coupled-commit'
		} ],
		emittedInteractionSequenceRanges: [ ...egressByExchangeId.entries() ].map( ( [ exchangeId, entries ] ) => {

			const records = entries.map( ( entry ) => entry.record ).sort( ( left, right ) => left.provenance.producerSequence - right.provenance.producerSequence );
			return {
				exchangeId,
				producerId: adapterId,
				firstSequence: records[ 0 ].provenance.producerSequence,
				lastSequenceInclusive: records.at( - 1 ).provenance.producerSequence,
				interactionIds: records.map( ( record ) => record.interactionId ),
				exactOnceKeys: records.map( ( record ) => record.exactOnceKey )
			};

		} ),
		dependencyCompletionRefs: [ cloneValue( completionRef ) ],
		status: 'completed',
		contentDigest: 'pending'
	};
	return completeReceiptDigest( receipt );

}

function makeSharedResourceSynchronization( route, signal, dependencyRef ) {

	const bodyGeneration = resourceGenerationValue( signal );
	return {
		authorityBySignalOrStateEquation: { 'body-state': 'external-solver', [ signal.signalId ]: 'external-solver' },
		transport: 'shared-resource',
		resourceProtocol: {
			handleAndLayoutKinds: {
				handleKind: 'GPUBuffer', layoutRevision: 'rigid-body-storage-layout-v3',
				deviceId: signal.residency.deviceId, backendGeneration: 'backend-generation-1'
			},
			producerAccessAndConsumerAccess: { producer: 'storage-read-write', consumer: 'storage-read', transition: 'shader-write-to-shader-read' },
			generationAndSubresourceFields: {
				resourceGeneration: bodyGeneration, subresource: { byteOffset: 0, byteLength: 256 }, aliasingPolicy: 'exclusive-authoritative'
			},
			acquireDependency: cloneValue( dependencyRef ),
			releaseOrCompletionToken: { kind: 'same-queue-completion-token', tokenId: 'external-body-shared-release-42', queueSubmissionEpoch: 42 },
			lifecycleAndRetirementOwner: signal.providerId
		},
		transferProtocol: {
			serializationLayoutAndDigest: { mode: 'not-used-shared-resource', boundaryRevision: 'external-boundary-v4' },
			endianPrecisionAndQuantization: { mode: 'native-device-layout', scalarFormat: 'float32', quantization: 'none' },
			sequenceAndExactOnceKeys: { mode: 'resource-generation-plus-application-ledger', resourceGeneration: bodyGeneration },
			maximumBytesCadenceLatencyAndStaleness: { mode: 'not-copied', maximumStaleness: cloneValue( signal.latency.maximumStaleness ) }
		},
		hostVisibilityProof: 'not-host-visible'
	};

}

function makeCopySynchronization( route, signal, dependencyRef, receipt ) {

	const layoutPayload = {
		layoutRevision: 'rigid-body-copy-layout-v2',
		fields: [ 'entityId', 'positionMeters', 'orientationQuaternion', 'linearVelocityMps', 'angularVelocityRadPerS' ],
		endianness: 'little', scalarFormat: 'float32', quantization: 'none'
	};
	return {
		authorityBySignalOrStateEquation: { 'body-state': 'external-solver', [ signal.signalId ]: 'external-solver' },
		transport: 'device-copy',
		resourceProtocol: {
			handleAndLayoutKinds: { sourceHandleKind: 'GPUBuffer', destinationHandleKind: 'mapped-staging-buffer', layoutRevision: layoutPayload.layoutRevision },
			producerAccessAndConsumerAccess: { producer: 'copy-source', consumer: 'mapped-read-then-external-ingress', transition: 'copy-source-to-map-read' },
			generationAndSubresourceFields: { sourceResourceGeneration: resourceGenerationValue( signal ), copyGeneration: 'body-copy-generation-42', subresource: { byteOffset: 0, byteLength: 256 } },
			acquireDependency: cloneValue( dependencyRef ),
			releaseOrCompletionToken: { kind: 'device-completion-plus-map-token', tokenId: 'external-body-copy-map-42', deviceCompletionEpoch: 42, mapCompletionEpoch: 43 },
			lifecycleAndRetirementOwner: signal.providerId
		},
		transferProtocol: {
			serializationLayoutAndDigest: { ...layoutPayload, contentDigest: digest( layoutPayload ) },
			endianPrecisionAndQuantization: { endianness: 'little', scalarFormat: 'float32', accumulationFormat: 'float64', quantization: 'none' },
			sequenceAndExactOnceKeys: {
				receiptId: receipt.receiptId,
				inputApplicationLedgerIds: cloneValue( receipt.inputApplicationLedgerIds ),
				emittedInteractionSequenceRanges: cloneValue( receipt.emittedInteractionSequenceRanges )
			},
			maximumBytesCadenceLatencyAndStaleness: {
				maximumBytesPerStep: quantity( 4096, 'byte', 'Gated', 'external-copy-boundary' ),
				maximumLatency: cloneValue( signal.latency.maximumStaleness ),
				maximumStaleness: cloneValue( signal.latency.maximumStaleness )
			}
		},
		hostVisibilityProof: 'device-completion-plus-copy-map'
	};

}

function makeAdapter( h, route, transport ) {

	const signal = findSignal( route, 'rigid-body-state' );
	assert.ok( signal, 'external fixture requires rigid-body-state' );
	const clockRegistry = route.physicsContext.physicsClockRegistry;
	const contextClock = clockRegistry.clocksById[ signal.clockId ]
		?? clockRegistry.clocksById[ clockRegistry.coordinationClockId ]
		?? Object.values( clockRegistry.clocksById ).find( ( clock ) => clock.clockId === signal.clockId );
	assert.ok( contextClock, `external fixture cannot resolve context clock ${ signal.clockId }` );
	const { dependencyRef, completionRef } = dependencyFixture( route );
	const suffix = transport === 'shared-resource' ? 'shared' : 'copy';
	const receipt = makeStepReceipt( route, signal, signal.providerId, `external-body-step-${ suffix }-42`, completionRef );
	return {
		adapterId: signal.providerId,
		externalSolverIdVersion: 'external-rigid-body-solver/build-2026.07.10',
		contextId: route.physicsContext.contextId,
		boundaryRevision: `external-body-boundary-${ suffix }-v4`,
		ownedStateEquations: [ 'body-state' ],
		ownership: Object.fromEntries( OWNERSHIP_FIELDS.map( ( field ) => [ field, 'external-solver' ] ) ),
		supportedFramesCharts: [ signal.physicsFrameId ],
		unitConversion: {
			sourceUnitSystemId: 'external-body-SI-y-up-v2', destinationUnitSystemId: 'canonical-SI',
			perQuantityAffineOrLinearMaps: { length: { scale: 1, offset: 0 }, time: { scale: 1, offset: 0 }, mass: { scale: 1, offset: 0 } },
			handednessAndAxialConvention: { ingress: 'right-handed-y-up-polar-and-axial-preserved', egress: 'inverse-of-ingress' },
			conversionError: cloneValue( signal.perChannelError )
		},
		clockMapping: {
			externalClockId: 'external-body-clock', contextClockId: signal.clockId, mappingRevision: 'external-body-clock-map-v2',
			mappingDescriptorRef: {
				clockId: signal.clockId,
				mappingRevision: contextClock.mappingRevision,
				discontinuityEpoch: contextClock.discontinuityEpoch
			},
			maximumAgeAndMappingError: { maximumAge: cloneValue( signal.latency.maximumStaleness ), error: cloneValue( signal.latency.error ) }
		},
		stepSemantics: 'fixed',
		signalDescriptors: [ cloneValue( signal ) ],
		interactionCapabilities: makeCapabilities( route, signal, dependencyRef, `external-body-${ suffix }` ),
		stepReceipts: [ receipt ],
		residencySynchronization: transport === 'shared-resource' ? makeSharedResourceSynchronization( route, signal, dependencyRef ) : makeCopySynchronization( route, signal, dependencyRef, receipt ),
		precisionDeterminism: {
			scalarFormatsAndAccumulationMode: { state: 'float32', constraintReduction: 'float64-compensated' },
			reductionOrdering: 'deterministic-tree',
			solverSeedAndStreamIdentity: { kind: 'present', streams: { constraintOrdering: { seed: 'body-constraint-seed-7', cursor: 42 } } },
			replayEquivalenceGate: 'bounded-observable-error'
		},
		errorModel: { signalErrors: cloneValue( signal.perChannelError ), couplingErrorGate: 'body-water-momentum' },
		checkpointRollback: {
			support: 'checkpoint-and-replay',
			checkpointFormatAndDigest: { kind: 'present', format: 'external-body-checkpoint-v2', digestAlgorithm: 'sha256' },
			cadenceAndMaximumRollback: { kind: 'present', cadence: cloneValue( signal.cadence ), maximumRollback: cloneValue( route.physicsGraph.catchUpPolicy.maximumDebt ) },
			includedStateVersionsInventoriesAndCursors: { kind: 'present', stateEquations: [ 'body-state' ], inventories: [ 'body-water-momentum' ], cursors: [ 'interaction-application', 'event', 'stable-id', 'rng' ] },
			restoreOrderingAndValidationGates: { kind: 'present', order: [ 'freeze', 'restore', 'replay', 'validate', 'atomic-publish' ], gates: REQUIRED_RECOVERY_GATES }
		},
		failurePolicy: {
			detectionAndTimeout: { timeout: quantity( 50, 'millisecond', 'Gated', 'external-solver-watchdog' ), detection: 'heartbeat-and-step-receipt-deadline' },
			freezeCommitGroups: [ 'coupled-commit' ], priorCommittedStateDisposition: 'preserve',
			queuedInteractionEventDisposition: 'retain-for-replay',
			recoveryOwnerAndPlan: { kind: 'present', owner: signal.providerId, recoveryId: 'gpu-body-recovery' },
			degradedPublication: 'forbidden'
		}
	};

}

function checkpointContent( checkpoint ) {

	const payload = cloneValue( checkpoint );
	delete payload.contentDigest;
	return payload;

}

function completeCheckpointDigest( checkpoint ) {

	checkpoint.contentDigest = digest( checkpointContent( checkpoint ) );
	return checkpoint;

}

function completeRangeDigest( range ) {

	range.contentDigest = digestWithout( range, 'contentDigest' );
	return range;

}

function completeAtomicGroupDigest( group ) {

	group.contentDigest = digestWithout( group, 'contentDigest' );
	return group;

}

function gpuResidency( signal ) {

	return {
		deviceId: signal.residency.deviceId,
		backendGeneration: 'backend-generation-1',
		deviceLossGeneration: 'device-loss-generation-1',
		bindings: [ {
			signalId: signal.signalId, logicalStateVersion: signal.stateVersion,
			resourceGeneration: resourceGenerationValue( signal ), layoutRevision: 'rigid-body-storage-layout-v3',
			subresource: { byteOffset: 0, byteLength: 256 }, access: 'storage-read-write', aliasingPolicy: 'exclusive-authoritative'
		} ]
	};

}

function invalidatedGenerations( residency ) {

	return [
		{ kind: 'backend', deviceId: residency.deviceId, generation: residency.backendGeneration },
		{ kind: 'device-loss', deviceId: residency.deviceId, generation: residency.deviceLossGeneration },
		...residency.bindings.map( ( binding ) => ( { kind: 'resource', signalId: binding.signalId, generation: binding.resourceGeneration } ) )
	];

}

function checkpointPolicy( route, signal ) {

	return {
		cadence: cloneValue( signal.cadence ), checkpointResidency: 'cpu',
		maximumRollback: cloneValue( route.physicsGraph.catchUpPolicy.maximumDebt ),
		maximumRecoveryError: cloneValue( Object.values( signal.perChannelError )[ 0 ] )
	};

}

function checkpointCursors( route ) {

	return {
		stableIdAllocation: Object.fromEntries( Object.entries( route.physicsContext.idNamespaces.namespacesByKind ).map( ( [ key, value ] ) => [ key, value.allocationCursor ] ) ),
		rngStreams: { 'body-constraint-order': { streamId: 'body-constraint-seed-7', cursor: 42 } },
		eventStreams: { 'body-water-exchange': 1003 },
		interactionApplicationLedgers: { 'body-water-exchange/body-state': 1003 }
	};

}

function recoveryValidationGates() {

	return REQUIRED_RECOVERY_GATES.map( ( gate ) => ( { gate, status: 'accepted', evidenceDigest: `sha256:${ gate }-gpu-recovery` } ) );

}

function restartValidationGates() {

	return REQUIRED_RESTART_GATES.map( ( gate ) => ( { gate, status: 'accepted', evidenceDigest: `sha256:${ gate }-gpu-restart` } ) );

}

function makeRestoreRecovery( h, route, signal, atomicGroups ) {

	const interval = cloneValue( route.physicsGraph.coordinationAdvance.interval );
	const residency = gpuResidency( signal );
	const applications = interactionApplicationLedgers( route ).filter( ( ledger ) => ledger.targetStateEquation === 'body-state' ).sort( ( a, b ) => a.cursorBefore - b.cursorBefore );
	const checkpoint = completeCheckpointDigest( {
		checkpointId: 'gpu-body-checkpoint-41', contentDigest: 'pending', contextVersion: route.physicsContext.contextVersion,
		graphAndMaterialRegistryVersions: [
			{ kind: 'graph', id: route.physicsGraph.graphId, version: route.physicsGraph.executionLedger.graphRevision },
			{ kind: 'physics-material-registry', id: route.physicsContext.physicsMaterialRegistry.registryId, version: route.physicsContext.physicsMaterialRegistry.registryVersion }
		],
		frameClockAndMappingRevisions: [
			{ kind: 'frame-registry', id: route.physicsContext.physicsFrameRegistry.registryId, version: route.physicsContext.physicsFrameRegistry.registryRevision },
			{ kind: 'clock-registry', id: route.physicsContext.physicsClockRegistry.registryId, version: route.physicsContext.physicsClockRegistry.registryRevision },
			{ kind: 'clock-mapping', id: signal.clockId, version: interval.intervalMappingRevision }
		],
		committedVersions: [ { signalId: signal.signalId, stateVersion: 'body-41' } ],
		checkpointInstant: cloneValue( interval.start ), physicsOriginEpoch: route.physicsContext.physicsOriginEpoch,
		resourceGenerations: [ { signalId: signal.signalId, checkpointResourceGeneration: 'cpu-checkpoint-body-41', sourceResourceGeneration: 'body-generation-41' } ],
		conservedInventories: { 'body-water-momentum': { linearMomentumNs: [ 0, 0, 0 ], angularMomentumNms: [ 0, 0, 0 ], inventoryEpoch: 'body-41' } },
		stableIdRngEventAndLedgerCursors: checkpointCursors( route )
	} );
	const replayRange = completeRangeDigest( {
		rangeId: 'gpu-body-replay-1003-1004', streamId: 'body-water-exchange', producerId: 'water-provider', consumerId: signal.providerId,
		firstSequence: applications[ 0 ].cursorBefore, lastSequenceInclusive: applications.at( - 1 ).cursorBefore,
		cursorBefore: applications[ 0 ].cursorBefore, cursorAfter: applications.at( - 1 ).cursorAfter,
		interactionApplicationLedgerIds: applications.map( ( ledger ) => ledger.applicationLedgerId ),
		exactOnceKeys: applications.map( ( ledger ) => ledger.exactOnceKey ), contentDigest: 'pending'
	} );
	const publication = {
		signalId: signal.signalId, stateEquationId: 'body-state', logicalStateVersion: signal.stateVersion,
		resourceGeneration: 'body-generation-recovered-43', applicationLedgerCursors: { 'body-water-exchange/body-state': replayRange.cursorAfter }
	};
	const group = completeAtomicGroupDigest( {
		commitGroupId: 'gpu-body-recovery-commit-43', contextId: route.physicsContext.contextId,
		mode: 'atomic-all-or-none', status: 'committed', deviceLossGeneration: 'device-loss-generation-2',
		publications: [ publication ], validationGateNames: cloneValue( REQUIRED_RECOVERY_GATES ), contentDigest: 'pending'
	} );
	atomicGroups[ group.commitGroupId ] = group;
	const targetResidency = {
		deviceId: 'fixture-webgpu-device-restored', backendGeneration: 'backend-generation-2', deviceLossGeneration: group.deviceLossGeneration,
		bindings: [ {
			signalId: signal.signalId, logicalStateVersion: signal.stateVersion, resourceGeneration: publication.resourceGeneration,
			layoutRevision: 'rigid-body-storage-layout-v3', subresource: { byteOffset: 0, byteLength: 256 }, access: 'storage-read-write', aliasingPolicy: 'exclusive-authoritative'
		} ],
		atomicPublicationCommitGroupId: group.commitGroupId
	};
	return {
		recoveryId: 'gpu-body-restore-replay-43', contextId: route.physicsContext.contextId, owner: signal.owner,
		authoritativeSignalIds: [ signal.signalId ], recoveryMode: 'restore-and-replay', authoritativeResidency: residency,
		checkpointPolicy: checkpointPolicy( route, signal ), latestCheckpoint: checkpoint, replayLogCoverage: interval,
		restoreTransaction: {
			freezeCommitGroupIds: [ 'coupled-commit' ], invalidateDeviceAndResourceGenerations: invalidatedGenerations( residency ),
			retireLostPresentationLeasesBy: residency.deviceLossGeneration, restoreCheckpointId: checkpoint.checkpointId,
			restoreTargetResidency: targetResidency, replayInterval: cloneValue( interval ), replayInteractionEventRanges: [ replayRange ],
			restoreLedgerCursorsBeforeReplay: cloneValue( checkpoint.stableIdRngEventAndLedgerCursors ),
			validationGates: recoveryValidationGates(), atomicPublicationCommitGroupId: group.commitGroupId,
			publishedDeviceLossGeneration: group.deviceLossGeneration
		},
		restartTransaction: absence( h, 'not-applicable', signal.owner, 'restore-and-replay selects the restore transaction arm' ),
		unrecoverablePolicy: 'block-route'
	};

}

function makeRestartRecovery( h, route, signal, atomicGroups ) {

	const residency = gpuResidency( signal );
	const applications = interactionApplicationLedgers( route ).filter( ( ledger ) => ledger.targetStateEquation === 'body-state' );
	const absenceValue = () => absence( h, 'unavailable', signal.owner, 'discontinuous restart has no coherent checkpoint/replay proof' );
	const lostLedger = {
		complete: true,
		lostCommittedVersions: [ { signalId: signal.signalId, stateVersion: signal.stateVersion } ],
		lostConservedInventories: [ 'body-water-momentum' ],
		lostInteractionApplicationLedgerIds: applications.map( ( ledger ) => ledger.applicationLedgerId ).sort(),
		lostInteractionEventRanges: [ { streamId: 'body-water-exchange', firstSequence: 1003, lastSequenceInclusive: 1004 } ],
		lostStableIdRngEventAndLedgerCursors: checkpointCursors( route ),
		contentDigest: 'pending'
	};
	lostLedger.contentDigest = digestWithout( lostLedger, 'contentDigest' );
	const restartedState = {
		signalId: signal.signalId, stateEquationId: 'body-state', logicalStateVersion: 'body-restart-43',
		resourceGeneration: 'body-restart-generation-43', initialization: 'declared-rest-state-with-zero-momentum',
		provenance: { owner: signal.owner, policyVersion: 'body-discontinuous-restart-v2', inputDigest: lostLedger.contentDigest }
	};
	const group = completeAtomicGroupDigest( {
		commitGroupId: 'gpu-body-restart-commit-43', contextId: route.physicsContext.contextId,
		mode: 'atomic-all-or-none', status: 'committed', deviceLossGeneration: 'device-loss-generation-2',
		publications: [ cloneValue( restartedState ) ], validationGateNames: cloneValue( REQUIRED_RESTART_GATES ), contentDigest: 'pending'
	} );
	atomicGroups[ group.commitGroupId ] = group;
	return {
		recoveryId: 'gpu-body-discontinuous-restart-43', contextId: route.physicsContext.contextId, owner: signal.owner,
		authoritativeSignalIds: [ signal.signalId ], recoveryMode: 'discontinuous-restart', authoritativeResidency: residency,
		checkpointPolicy: checkpointPolicy( route, signal ), latestCheckpoint: absenceValue(), replayLogCoverage: absenceValue(), restoreTransaction: absenceValue(),
		restartTransaction: {
			freezeCommitGroupIds: [ 'coupled-commit' ], invalidateDeviceAndResourceGenerations: invalidatedGenerations( residency ),
			affectedStateEquationsAndSignals: [ { stateEquationId: 'body-state', signalId: signal.signalId } ],
			lostInventoriesInteractionsAndEvents: lostLedger,
			restartInitialStateAndProvenance: { states: [ restartedState ], provenance: cloneValue( restartedState.provenance ) },
			newDiscontinuityEpoch: 'time-continuity-2',
			resetActions: [ { actionId: 'gpu-restart-reset-rigid-body-state', signalId: signal.signalId, scope: 'all-dependent-physics-and-presentation-history', policy: 'clear-before-first-use', owner: signal.owner } ],
			validationGates: restartValidationGates(), atomicPublicationCommitGroupId: group.commitGroupId,
			publishedDeviceLossGeneration: group.deviceLossGeneration
		},
		unrecoverablePolicy: 'execute-declared-restart'
	};

}

export function buildExternalGpuFixtureBundle( h, route ) {

	assert.ok( route?.physicsContext && route?.physicsGraph, 'external/GPU fixture requires a canonical physical route' );
	const signal = findSignal( route, 'rigid-body-state' );
	assert.ok( signal, 'external/GPU fixture requires rigid-body-state' );
	const gpuAtomicCommitGroupsById = {};
	return {
		externalAdapterVariants: {
			sharedResource: makeAdapter( h, route, 'shared-resource' ),
			copyBoundary: makeAdapter( h, route, 'device-copy' )
		},
		gpuRecoveries: {
			restoreReplay: makeRestoreRecovery( h, route, signal, gpuAtomicCommitGroupsById ),
			discontinuousRestart: makeRestartRecovery( h, route, signal, gpuAtomicCommitGroupsById )
		},
		gpuAtomicCommitGroupsById
	};

}

function classifyBoundaryInteraction( adapter, record ) {

	if ( adapter.ownedStateEquations.includes( record.targetStateEquation ) ) return 'ingress';
	const signalOwners = new Set( adapter.signalDescriptors.map( ( descriptor ) => descriptor.owner ) );
	if ( signalOwners.has( record.sourceOwner ) ) return 'egress';
	return null;

}

function capabilityMatches( h, capability, record, direction ) {

	if ( capability.direction !== direction || capability.role !== record.role || capability.payloadTag !== record.payload.tag ) return false;
	if ( capability.frameId !== record.physicsFrameId || ! capability.footprintKinds.includes( record.footprint.kind ) ) return false;
	if ( direction === 'ingress' ) return ! isAbsence( h, capability.targetEquationId ) && capability.targetEquationId === record.targetStateEquation;
	return isAbsence( h, capability.targetEquationId ) || capability.targetEquationId === record.targetStateEquation;

}

function validateCapabilityAndReceipt( h, route, adapter ) {

	const crossing = allInteractionRecords( route ).map( ( record ) => ( { record, direction: classifyBoundaryInteraction( adapter, record ) } ) ).filter( ( entry ) => entry.direction !== null );
	assert.ok( crossing.length > 0, 'external adapter has no boundary interactions' );
	const usedCapabilityIds = new Set();
	for ( const { record, direction } of crossing ) {

		const matches = adapter.interactionCapabilities.filter( ( capability ) => capabilityMatches( h, capability, record, direction ) );
		assert.equal( matches.length, 1, `${ adapter.boundaryRevision } ${ record.interactionId } must match exactly one directional capability` );
		const capability = matches[ 0 ];
		usedCapabilityIds.add( capability.capabilityId );
		assert.deepEqual( capability.unitSignature, interactionUnitSignature( record.payload.tag ), `${ capability.capabilityId } has the wrong dimensional signature` );
		assert.equal( capability.exactOnceSupport, 'required-ledger', `${ capability.capabilityId } cannot satisfy exact-once delivery` );
		assert.equal( capability.reactionAtomicity, 'same-commit-transaction', `${ capability.capabilityId } permits a half reaction commit` );
		assert.ok( graphDependencies( route ).some( ( dependency ) => dependency.dependencyId === capability.dependencyRef.dependencyId ), `${ capability.capabilityId } dependency does not resolve` );

	}
	exactSet( [ ...usedCapabilityIds ], adapter.interactionCapabilities.map( ( capability ) => capability.capabilityId ), `${ adapter.boundaryRevision } has unused or duplicate capabilities` );
	assert.equal( adapter.stepReceipts.length, 1, `${ adapter.boundaryRevision } must expose exactly one fixture step receipt` );
	const receipt = adapter.stepReceipts[ 0 ];
	assert.equal( receipt.adapterId, adapter.adapterId, 'step receipt adapter mismatch' );
	assert.equal( receipt.coordinationAdvanceId, route.physicsGraph.coordinationAdvance.coordinationAdvanceId, 'step receipt coordination advance mismatch' );
	assertSameInterval( receipt.requestedInterval, route.physicsGraph.coordinationAdvance.interval, 'external step receipt' );
	assertIntervalTiling( receipt.actualNativeExecutionIntervals, receipt.requestedInterval, 'external native execution' );
	assert.equal( receipt.status, 'completed', 'canonical external step did not complete' );
	const completionByDependency = new Map( graphDependencyCompletions( route ).map( ( completion ) => [ completion.dependencyId, completion ] ) );
	const requiredDependencyIds = [ ...new Set( adapter.interactionCapabilities.map( ( capability ) => capability.dependencyRef.dependencyId ) ) ];
	exactSet( receipt.dependencyCompletionRefs.map( ( ref ) => ref.dependencyId ), requiredDependencyIds, 'external receipt dependency completion closure' );
	for ( const ref of receipt.dependencyCompletionRefs ) {

		const completion = completionByDependency.get( ref.dependencyId );
		assert.ok( completion, `external receipt dependency ${ ref.dependencyId } does not resolve` );
		assert.deepEqual( ref, { completionId: completion.completionId, dependencyId: completion.dependencyId, receiptDigest: completion.receiptDigest }, `external receipt dependency ${ ref.dependencyId } mismatches exact completion` );

	}
	const ingressRecords = crossing.filter( ( entry ) => entry.direction === 'ingress' ).map( ( entry ) => entry.record );
	const ingressIds = new Set( ingressRecords.map( ( record ) => record.interactionId ) );
	const expectedApplications = interactionApplicationLedgers( route ).filter( ( ledger ) => ingressIds.has( ledger.interactionId ) );
	exactSet( receipt.inputApplicationLedgerIds, expectedApplications.map( ( ledger ) => ledger.applicationLedgerId ), 'external step exact-once application ledger closure' );
	for ( const ledgerId of receipt.inputApplicationLedgerIds ) {

		const ledger = expectedApplications.find( ( entry ) => entry.applicationLedgerId === ledgerId );
		assert.ok( ledger && ledger.disposition === 'committed', `${ ledgerId } is not a committed application` );
		const interaction = ingressRecords.find( ( record ) => record.interactionId === ledger.interactionId );
		assert.equal( ledger.exactOnceKey, interaction.exactOnceKey, `${ ledgerId } exact-once key mismatch` );

	}
	const expectedEgress = crossing.filter( ( entry ) => entry.direction === 'egress' ).map( ( entry ) => entry.record );
	const emittedIds = receipt.emittedInteractionSequenceRanges.flatMap( ( range ) => range.interactionIds );
	exactSet( emittedIds, expectedEgress.map( ( record ) => record.interactionId ), 'external egress sequence range closure' );
	for ( const range of receipt.emittedInteractionSequenceRanges ) {

		assert.ok( Number.isInteger( range.firstSequence ) && Number.isInteger( range.lastSequenceInclusive ) && range.firstSequence <= range.lastSequenceInclusive, 'external egress range is not closed and ordered' );
		const records = expectedEgress.filter( ( record ) => range.interactionIds.includes( record.interactionId ) );
		exactSet( range.exactOnceKeys, records.map( ( record ) => record.exactOnceKey ), 'external egress exact-once keys' );
		assert.deepEqual( records.map( ( record ) => record.provenance.producerSequence ).sort( ( a, b ) => a - b ), Array.from( { length: range.lastSequenceInclusive - range.firstSequence + 1 }, ( _, index ) => range.firstSequence + index ), 'external egress range omits or invents sequences' );

	}
	assert.equal( receipt.contentDigest, digestWithout( receipt, 'contentDigest' ), 'external step receipt content digest mismatch' );

}

function validateAtomicExternalOutput( route, adapter ) {

	const receipt = adapter.stepReceipts[ 0 ];
	exactSet( receipt.outputPreparedVersions.map( ( output ) => output.stateEquationId ), adapter.ownedStateEquations, 'external prepared output state-equation closure' );
	const transactionIds = new Set( receipt.outputPreparedVersions.map( ( output ) => output.commitTransactionId ) );
	assert.equal( transactionIds.size, 1, 'external outputs are split across commit transactions' );
	for ( const output of receipt.outputPreparedVersions ) {

		const transaction = commitTransaction( route, output.commitTransactionId );
		assert.ok( transaction && transaction.status === 'committed', `${ output.stateEquationId } commit transaction is absent or uncommitted` );
		const group = routeCommitGroups( route ).find( ( entry ) => entry.commitGroupId === output.commitGroupId );
		assert.ok( group && group.commitTransactionId === transaction.commitTransactionId, `${ output.stateEquationId } commit group does not belong to the transaction` );
		assert.equal( group.atomicity, 'all-or-none', `${ output.stateEquationId } commit group is not atomic` );
		assert.ok( Object.hasOwn( group.stateEquationOwners, output.stateEquationId ), `${ output.stateEquationId } is absent from commit-group ownership` );
		const prepared = group.preparedPublications.filter( ( publication ) => publication.preparedVersion.signalId === output.signalId && publication.preparedVersion.stateVersion === output.preparedStateVersion );
		assert.equal( prepared.length, 1, `${ output.stateEquationId } prepared version does not resolve exactly once` );
		const promotions = transaction.receipt.preparedToCommittedPublicationMap.filter( ( promotion ) => promotion.preparedVersion.signalId === output.signalId && promotion.preparedVersion.stateVersion === output.preparedStateVersion );
		assert.equal( promotions.length, 1, `${ output.stateEquationId } lacks one atomic prepared-to-committed promotion` );

	}

}

function validateTransportBoundary( route, adapter ) {

	const sync = adapter.residencySynchronization;
	const signal = adapter.signalDescriptors[ 0 ];
	exactSet( Object.keys( sync.authorityBySignalOrStateEquation ), [ ...adapter.ownedStateEquations, ...adapter.signalDescriptors.map( ( descriptor ) => descriptor.signalId ) ], `${ adapter.boundaryRevision } authority map closure` );
	for ( const authority of Object.values( sync.authorityBySignalOrStateEquation ) ) assert.ok( authority === 'external-solver' || authority === adapter.adapterId, `${ adapter.boundaryRevision } has an implicit/conflicting residency authority` );
	const resource = sync.resourceProtocol;
	assert.deepEqual( resource.acquireDependency, adapter.interactionCapabilities[ 0 ].dependencyRef, `${ adapter.boundaryRevision } acquire dependency mismatch` );
	assertNonEmptyString( resource.lifecycleAndRetirementOwner, `${ adapter.boundaryRevision }.lifecycleAndRetirementOwner` );
	assert.ok( resource.releaseOrCompletionToken && typeof resource.releaseOrCompletionToken === 'object', `${ adapter.boundaryRevision } has no release/completion token` );
	if ( sync.transport === 'shared-resource' ) {

		assert.equal( resource.handleAndLayoutKinds.deviceId, signal.residency.deviceId, 'shared-resource device mismatch' );
		assert.equal( resource.generationAndSubresourceFields.resourceGeneration, resourceGenerationValue( signal ), 'shared-resource generation mismatch' );
		assertNonEmptyString( resource.handleAndLayoutKinds.backendGeneration, 'shared-resource backend generation' );
		assert.ok( resource.generationAndSubresourceFields.subresource?.byteLength > 0, 'shared-resource subresource is not bounded' );
		assert.equal( sync.hostVisibilityProof, 'not-host-visible', 'shared GPU resource falsely claims host visibility' );
		assert.equal( sync.transferProtocol.serializationLayoutAndDigest.mode, 'not-used-shared-resource', 'shared resource silently crosses a copy boundary' );

	} else {

		assert.ok( [ 'device-copy', 'host-staging', 'network-message' ].includes( sync.transport ), 'unsupported copy boundary transport' );
		const layout = sync.transferProtocol.serializationLayoutAndDigest;
		const layoutPayload = cloneValue( layout );
		delete layoutPayload.contentDigest;
		assert.equal( layout.contentDigest, digest( layoutPayload ), 'copy boundary serialization digest mismatch' );
		assert.equal( sync.hostVisibilityProof, 'device-completion-plus-copy-map', 'copy boundary visibility is not proven by completion plus map' );
		assert.equal( resource.releaseOrCompletionToken.kind, 'device-completion-plus-map-token', 'copy boundary uses submission as host visibility proof' );
		assert.ok( resource.releaseOrCompletionToken.mapCompletionEpoch > resource.releaseOrCompletionToken.deviceCompletionEpoch, 'copy map completion does not follow device completion' );
		const sequence = sync.transferProtocol.sequenceAndExactOnceKeys;
		const receipt = adapter.stepReceipts[ 0 ];
		assert.equal( sequence.receiptId, receipt.receiptId, 'copy sequence schema references another receipt' );
		exactSet( sequence.inputApplicationLedgerIds, receipt.inputApplicationLedgerIds, 'copy ingress exact-once keys' );
		assert.deepEqual( sequence.emittedInteractionSequenceRanges, receipt.emittedInteractionSequenceRanges, 'copy egress sequence schema mismatch' );

	}

}

function validateSupportedFrameChartClosure( h, adapter, label ) {

	assert.ok( adapter.supportedFramesCharts.length > 0, `${ label }.supportedFramesCharts must be nonempty` );
	const requiredFrameChartIds = [];
	for ( const descriptor of adapter.signalDescriptors ) {

		requiredFrameChartIds.push( descriptor.physicsFrameId );
		if ( ! isAbsence( h, descriptor.chartId ) ) requiredFrameChartIds.push( descriptor.chartId );

	}
	for ( const capability of adapter.interactionCapabilities ) requiredFrameChartIds.push( capability.frameId );
	for ( const id of requiredFrameChartIds ) assertNonEmptyString( id, `${ label } required frame/chart ID` );
	exactSet( adapter.supportedFramesCharts, requiredFrameChartIds, `${ label } supported frame/chart closure` );

}

export function validateExternalSolverAdapterFixture( h, route, adapter, label = 'externalSolverAdapter' ) {

	validateAbiRecord( h, 'ExternalSolverAdapter', adapter, label );
	exactSet( Object.keys( adapter.ownership ), OWNERSHIP_FIELDS, `${ label } ownership-field closure` );
	for ( const field of OWNERSHIP_FIELDS ) {

		assertNonEmptyString( adapter.ownership[ field ], `${ label }.ownership.${ field }` );
		assert.ok( ! /implicit|default|unknown/i.test( adapter.ownership[ field ] ), `${ label }.ownership.${ field } is implicit` );

	}
	assert.ok( adapter.ownedStateEquations.length > 0, `${ label } owns no state equation` );
	exactSet( adapter.ownedStateEquations, adapter.ownedStateEquations, `${ label } state-equation ownership` );
	assert.ok( adapter.signalDescriptors.every( ( descriptor ) => descriptor.providerId === adapter.adapterId && descriptor.contextId === adapter.contextId ), `${ label } descriptors cross provider/context authority` );
	validateSupportedFrameChartClosure( h, adapter, label );
	assert.equal( adapter.unitConversion.destinationUnitSystemId, 'canonical-SI', `${ label } does not convert at the canonical SI boundary` );
	assert.equal( adapter.checkpointRollback.support, 'checkpoint-and-replay', `${ label } lacks the declared rollback/replay contract` );
	for ( const field of [ 'checkpointFormatAndDigest', 'cadenceAndMaximumRollback', 'includedStateVersionsInventoriesAndCursors', 'restoreOrderingAndValidationGates' ] ) assert.ok( ! isAbsence( h, adapter.checkpointRollback[ field ] ), `${ label }.checkpointRollback.${ field } is absent` );
	assert.equal( adapter.failurePolicy.degradedPublication, 'forbidden', `${ label } permits an uncontracted degraded publication` );
	assert.ok( adapter.failurePolicy.freezeCommitGroups.length > 0, `${ label } failure policy freezes no commit group` );
	validateCapabilityAndReceipt( h, route, adapter );
	validateAtomicExternalOutput( route, adapter );
	validateTransportBoundary( route, adapter );
	for ( const receipt of adapter.stepReceipts ) validateAbiRecord( h, 'ExternalSolverStepReceipt', receipt, `${ label}.stepReceipts.${ receipt.receiptId }` );
	return true;

}

function validateGpuResidencyClosure( recovery, signal ) {

	const residency = recovery.authoritativeResidency;
	exactSet( recovery.authoritativeSignalIds, residency.bindings.map( ( binding ) => binding.signalId ), `${ recovery.recoveryId } authoritative residency closure` );
	assert.ok( residency.bindings.every( ( binding ) => binding.signalId === signal.signalId && binding.logicalStateVersion === signal.stateVersion ), `${ recovery.recoveryId } residency does not bind the current logical state` );
	assertNonEmptyString( residency.backendGeneration, `${ recovery.recoveryId }.backendGeneration` );
	assertNonEmptyString( residency.deviceLossGeneration, `${ recovery.recoveryId }.deviceLossGeneration` );

}

function validateInvalidationAndNewResidency( recovery, invalidations, targetBindings, publishedDeviceLossGeneration ) {

	const lost = recovery.authoritativeResidency;
	const keys = new Set( invalidations.map( ( entry ) => `${ entry.kind }|${ entry.signalId ?? entry.deviceId }|${ entry.generation }` ) );
	assert.ok( keys.has( `backend|${ lost.deviceId }|${ lost.backendGeneration }` ), `${ recovery.recoveryId } does not invalidate the lost backend generation` );
	assert.ok( keys.has( `device-loss|${ lost.deviceId }|${ lost.deviceLossGeneration }` ), `${ recovery.recoveryId } does not invalidate the device-loss generation` );
	for ( const binding of lost.bindings ) assert.ok( keys.has( `resource|${ binding.signalId }|${ binding.resourceGeneration }` ), `${ recovery.recoveryId } does not invalidate ${ binding.resourceGeneration }` );
	exactSet( targetBindings.map( ( binding ) => binding.signalId ), recovery.authoritativeSignalIds, `${ recovery.recoveryId } new-residency signal closure` );
	for ( const binding of targetBindings ) {

		const old = lost.bindings.find( ( entry ) => entry.signalId === binding.signalId );
		assert.notEqual( binding.resourceGeneration, old.resourceGeneration, `${ recovery.recoveryId } reuses a lost resource generation` );

	}
	assert.notEqual( publishedDeviceLossGeneration, lost.deviceLossGeneration, `${ recovery.recoveryId } does not advance the device-loss generation` );

}

function validateGateSet( gates, required, label ) {

	exactSet( gates.map( ( gate ) => gate.gate ), required, `${ label } validation-gate closure` );
	assert.ok( gates.every( ( gate ) => gate.status === 'accepted' && typeof gate.evidenceDigest === 'string' && gate.evidenceDigest.length > 0 ), `${ label } contains a failed/unproven validation gate` );

}

function validateAtomicGpuPublication( bundle, recovery, groupId, generation, expectedPublications, requiredGates ) {

	const group = bundle.gpuAtomicCommitGroupsById[ groupId ];
	assert.ok( group, `${ recovery.recoveryId } atomic publication group does not resolve` );
	assert.equal( group.mode, 'atomic-all-or-none', `${ recovery.recoveryId } publication is not atomic` );
	assert.equal( group.status, 'committed', `${ recovery.recoveryId } publication is not committed` );
	assert.equal( group.deviceLossGeneration, generation, `${ recovery.recoveryId } publication generation mismatch` );
	exactSet( group.publications.map( ( publication ) => publication.signalId ), recovery.authoritativeSignalIds, `${ recovery.recoveryId } atomic publication signal closure` );
	assert.deepEqual( group.publications, expectedPublications, `${ recovery.recoveryId } transaction/publication payload mismatch` );
	exactSet( group.validationGateNames, requiredGates, `${ recovery.recoveryId } atomic publication gate closure` );
	assert.equal( group.contentDigest, digestWithout( group, 'contentDigest' ), `${ recovery.recoveryId } atomic publication digest mismatch` );

}

function validateCheckpoint( h, recovery, route, signal ) {

	const checkpoint = recovery.latestCheckpoint;
	validateAbiRecord( h, 'GpuCheckpointState', checkpoint, `${ recovery.recoveryId }.latestCheckpoint` );
	exactSet( checkpoint.committedVersions.map( ( version ) => version.signalId ), recovery.authoritativeSignalIds, `${ recovery.recoveryId } checkpoint committed-version closure` );
	exactSet( checkpoint.resourceGenerations.map( ( generation ) => generation.signalId ), recovery.authoritativeSignalIds, `${ recovery.recoveryId } checkpoint resource-generation closure` );
	assert.ok( checkpoint.graphAndMaterialRegistryVersions.some( ( ref ) => ref.id === route.physicsGraph.graphId && ref.version === route.physicsGraph.executionLedger.graphRevision ), `${ recovery.recoveryId } checkpoint omits graph revision` );
	assert.ok( checkpoint.graphAndMaterialRegistryVersions.some( ( ref ) => ref.id === route.physicsContext.physicsMaterialRegistry.registryId && ref.version === route.physicsContext.physicsMaterialRegistry.registryVersion ), `${ recovery.recoveryId } checkpoint omits material registry revision` );
	for ( const kind of [ 'frame-registry', 'clock-registry', 'clock-mapping' ] ) assert.ok( checkpoint.frameClockAndMappingRevisions.some( ( ref ) => ref.kind === kind ), `${ recovery.recoveryId } checkpoint omits ${ kind } revision` );
	assert.equal( checkpoint.contextVersion, route.physicsContext.contextVersion, `${ recovery.recoveryId } checkpoint context version mismatch` );
	assert.equal( checkpoint.physicsOriginEpoch, route.physicsContext.physicsOriginEpoch, `${ recovery.recoveryId } checkpoint origin epoch mismatch` );
	exactSet( Object.keys( checkpoint.stableIdRngEventAndLedgerCursors ), [ 'stableIdAllocation', 'rngStreams', 'eventStreams', 'interactionApplicationLedgers' ], `${ recovery.recoveryId } checkpoint cursor closure` );
	assert.ok( Object.keys( checkpoint.conservedInventories ).length > 0, `${ recovery.recoveryId } checkpoint omits conserved inventories` );
	for ( const generation of checkpoint.resourceGenerations ) assert.notEqual( generation.checkpointResourceGeneration, recovery.authoritativeResidency.bindings.find( ( binding ) => binding.signalId === generation.signalId ).resourceGeneration, `${ recovery.recoveryId } checkpoint aliases a lost GPU resource` );
	assert.equal( checkpoint.contentDigest, digest( checkpointContent( checkpoint ) ), `${ recovery.recoveryId } checkpoint digest mismatch` );
	assert.ok( instantSeconds( checkpoint.checkpointInstant, `${ recovery.recoveryId }.checkpointInstant` ) <= instantSeconds( recovery.replayLogCoverage.start, `${ recovery.recoveryId }.replayStart` ), `${ recovery.recoveryId } checkpoint occurs after replay begins` );
	assert.equal( recovery.checkpointPolicy.checkpointResidency, 'cpu', `${ recovery.recoveryId } fixture checkpoint is not failure-isolated CPU state` );
	assert.equal( signal.signalId, recovery.authoritativeSignalIds[ 0 ], `${ recovery.recoveryId } checkpoint signal mismatch` );

}

function validateReplayRanges( route, recovery ) {

	const transaction = recovery.restoreTransaction;
	const ranges = [ ...transaction.replayInteractionEventRanges ].sort( ( a, b ) => a.firstSequence - b.firstSequence );
	assert.ok( ranges.length > 0, `${ recovery.recoveryId } replays no exact-once range` );
	const seenLedgerIds = new Set();
	for ( let i = 0; i < ranges.length; i ++ ) {

		const range = ranges[ i ];
		assert.ok( Number.isInteger( range.firstSequence ) && Number.isInteger( range.lastSequenceInclusive ) && range.firstSequence <= range.lastSequenceInclusive, `${ recovery.recoveryId } has an invalid replay range` );
		assert.equal( range.cursorBefore, range.firstSequence, `${ recovery.recoveryId } replay cursor does not start at the range boundary` );
		assert.equal( range.cursorAfter, range.lastSequenceInclusive + 1, `${ recovery.recoveryId } replay cursor does not end after the closed range` );
		if ( i > 0 ) assert.ok( ranges[ i - 1 ].lastSequenceInclusive < range.firstSequence, `${ recovery.recoveryId } replay ranges overlap` );
		for ( const ledgerId of range.interactionApplicationLedgerIds ) {

			assert.ok( ! seenLedgerIds.has( ledgerId ), `${ recovery.recoveryId } replays ${ ledgerId } twice` );
			seenLedgerIds.add( ledgerId );
			const ledger = route.physicsInteractionApplicationLedgers[ ledgerId ];
			assert.ok( ledger, `${ recovery.recoveryId } replay ledger ${ ledgerId } does not resolve` );
			assert.ok( ledger.cursorBefore >= range.firstSequence && ledger.cursorBefore <= range.lastSequenceInclusive, `${ recovery.recoveryId } replay ledger ${ ledgerId } lies outside the declared range` );

		}
		exactSet( range.exactOnceKeys, range.interactionApplicationLedgerIds.map( ( id ) => route.physicsInteractionApplicationLedgers[ id ].exactOnceKey ), `${ recovery.recoveryId } replay exact-once keys` );
		assert.equal( range.contentDigest, digestWithout( range, 'contentDigest' ), `${ recovery.recoveryId } replay range digest mismatch` );

	}
	const expected = interactionApplicationLedgers( route ).filter( ( ledger ) => ledger.targetStateEquation === 'body-state' ).map( ( ledger ) => ledger.applicationLedgerId );
	exactSet( [ ...seenLedgerIds ], expected, `${ recovery.recoveryId } replay application closure` );
	const restoredCursor = transaction.restoreLedgerCursorsBeforeReplay.interactionApplicationLedgers[ 'body-water-exchange/body-state' ];
	assert.equal( restoredCursor, ranges[ 0 ].cursorBefore, `${ recovery.recoveryId } did not restore the pre-range application cursor` );

}

function validateRestoreRecovery( h, route, bundle, recovery, signal ) {

	assert.ok( ! isAbsence( h, recovery.latestCheckpoint ) && ! isAbsence( h, recovery.replayLogCoverage ) && ! isAbsence( h, recovery.restoreTransaction ), `${ recovery.recoveryId } restore arm is incomplete` );
	assert.ok( isAbsence( h, recovery.restartTransaction ), `${ recovery.recoveryId } selects both recovery arms` );
	validateCheckpoint( h, recovery, route, signal );
	const transaction = recovery.restoreTransaction;
	assert.equal( transaction.restoreCheckpointId, recovery.latestCheckpoint.checkpointId, `${ recovery.recoveryId } restores another checkpoint` );
	assertSameInterval( transaction.replayInterval, recovery.replayLogCoverage, `${ recovery.recoveryId } replay coverage` );
	assert.equal( transaction.retireLostPresentationLeasesBy, recovery.authoritativeResidency.deviceLossGeneration, `${ recovery.recoveryId } does not retire leases from the lost generation` );
	assert.ok( transaction.freezeCommitGroupIds.includes( 'coupled-commit' ), `${ recovery.recoveryId } does not freeze the affected commit group` );
	validateInvalidationAndNewResidency( recovery, transaction.invalidateDeviceAndResourceGenerations, transaction.restoreTargetResidency.bindings, transaction.publishedDeviceLossGeneration );
	assert.equal( transaction.restoreTargetResidency.deviceLossGeneration, transaction.publishedDeviceLossGeneration, `${ recovery.recoveryId } target/published loss generation mismatch` );
	assert.notEqual( transaction.restoreTargetResidency.backendGeneration, recovery.authoritativeResidency.backendGeneration, `${ recovery.recoveryId } reuses the lost backend generation` );
	validateReplayRanges( route, recovery );
	validateGateSet( transaction.validationGates, REQUIRED_RECOVERY_GATES, recovery.recoveryId );
	const expectedPublications = transaction.restoreTargetResidency.bindings.map( ( binding ) => ( {
		signalId: binding.signalId, stateEquationId: 'body-state', logicalStateVersion: binding.logicalStateVersion,
		resourceGeneration: binding.resourceGeneration,
		applicationLedgerCursors: { 'body-water-exchange/body-state': transaction.replayInteractionEventRanges.at( - 1 ).cursorAfter }
	} ) );
	validateAtomicGpuPublication( bundle, recovery, transaction.atomicPublicationCommitGroupId, transaction.publishedDeviceLossGeneration, expectedPublications, REQUIRED_RECOVERY_GATES );
	assert.equal( transaction.restoreTargetResidency.atomicPublicationCommitGroupId, transaction.atomicPublicationCommitGroupId, `${ recovery.recoveryId } target residency bypasses atomic publication` );
	assert.equal( recovery.unrecoverablePolicy, 'block-route', `${ recovery.recoveryId } invents an unproven fallback` );

}

function validateRestartRecovery( h, route, bundle, recovery, signal ) {

	assert.ok( isAbsence( h, recovery.latestCheckpoint ) && isAbsence( h, recovery.replayLogCoverage ) && isAbsence( h, recovery.restoreTransaction ), `${ recovery.recoveryId } restart arm retains restore state` );
	assert.ok( ! isAbsence( h, recovery.restartTransaction ), `${ recovery.recoveryId } has no restart transaction` );
	assert.equal( recovery.unrecoverablePolicy, 'execute-declared-restart', `${ recovery.recoveryId } policy does not authorize the declared restart` );
	const transaction = recovery.restartTransaction;
	assert.ok( transaction.freezeCommitGroupIds.includes( 'coupled-commit' ), `${ recovery.recoveryId } does not freeze the affected commit group` );
	const affected = transaction.affectedStateEquationsAndSignals;
	exactSet( affected.map( ( entry ) => entry.signalId ), recovery.authoritativeSignalIds, `${ recovery.recoveryId } affected-signal closure` );
	assert.ok( affected.every( ( entry ) => entry.stateEquationId === 'body-state' ), `${ recovery.recoveryId } affected equation mismatch` );
	const states = transaction.restartInitialStateAndProvenance.states;
	validateInvalidationAndNewResidency( recovery, transaction.invalidateDeviceAndResourceGenerations, states, transaction.publishedDeviceLossGeneration );
	const loss = transaction.lostInventoriesInteractionsAndEvents;
	assert.equal( loss.complete, true, `${ recovery.recoveryId } loss ledger is incomplete` );
	exactSet( loss.lostCommittedVersions.map( ( version ) => version.signalId ), recovery.authoritativeSignalIds, `${ recovery.recoveryId } lost committed-version closure` );
	assert.ok( loss.lostConservedInventories.includes( 'body-water-momentum' ), `${ recovery.recoveryId } omits lost conserved inventory` );
	const expectedApplications = interactionApplicationLedgers( route ).filter( ( ledger ) => ledger.targetStateEquation === 'body-state' ).map( ( ledger ) => ledger.applicationLedgerId );
	exactSet( loss.lostInteractionApplicationLedgerIds, expectedApplications, `${ recovery.recoveryId } lost application-ledger closure` );
	assert.ok( loss.lostInteractionEventRanges.length > 0, `${ recovery.recoveryId } omits lost event ranges` );
	exactSet( Object.keys( loss.lostStableIdRngEventAndLedgerCursors ), [ 'stableIdAllocation', 'rngStreams', 'eventStreams', 'interactionApplicationLedgers' ], `${ recovery.recoveryId } lost cursor closure` );
	assert.equal( loss.contentDigest, digestWithout( loss, 'contentDigest' ), `${ recovery.recoveryId } loss-ledger digest mismatch` );
	const priorEpochs = new Set( Object.values( route.physicsContext.physicsClockRegistry.clocksById ).map( ( clock ) => clock.discontinuityEpoch ) );
	assert.ok( ! priorEpochs.has( transaction.newDiscontinuityEpoch ), `${ recovery.recoveryId } does not advance the discontinuity epoch` );
	exactSet( transaction.resetActions.map( ( action ) => action.signalId ), recovery.authoritativeSignalIds, `${ recovery.recoveryId } reset-plan signal closure` );
	assert.ok( transaction.resetActions.every( ( action ) => action.policy === 'clear-before-first-use' && /all-dependent/.test( action.scope ) ), `${ recovery.recoveryId } reset plan is not complete-before-use` );
	assert.ok( states.every( ( state ) => state.provenance?.inputDigest === loss.contentDigest ), `${ recovery.recoveryId } restart state lacks loss-ledger provenance` );
	for ( const state of states ) {

		const lostVersion = loss.lostCommittedVersions.find( ( version ) => version.signalId === state.signalId );
		assert.notEqual( state.logicalStateVersion, lostVersion.stateVersion, `${ recovery.recoveryId } reuses the lost logical state version` );

	}
	validateGateSet( transaction.validationGates, REQUIRED_RESTART_GATES, recovery.recoveryId );
	validateAtomicGpuPublication( bundle, recovery, transaction.atomicPublicationCommitGroupId, transaction.publishedDeviceLossGeneration, states, REQUIRED_RESTART_GATES );
	assert.equal( signal.signalId, recovery.authoritativeSignalIds[ 0 ], `${ recovery.recoveryId } restart signal mismatch` );

}

export function validateAuthoritativeGpuRecoveryFixture( h, route, bundle, recovery, label = 'authoritativeGpuRecovery' ) {

	validateAbiRecord( h, 'AuthoritativeGpuStateRecovery', recovery, label );
	assert.equal( recovery.contextId, route.physicsContext.contextId, `${ label } context mismatch` );
	assert.ok( recovery.authoritativeSignalIds.length > 0, `${ label } has no authoritative signal` );
	exactSet( recovery.authoritativeSignalIds, recovery.authoritativeSignalIds, `${ label } authoritative signal IDs` );
	const signal = findSignal( route, recovery.authoritativeSignalIds[ 0 ] );
	assert.ok( signal && signal.owner === recovery.owner, `${ label } owner does not own the authoritative signal` );
	validateGpuResidencyClosure( recovery, signal );
	if ( recovery.recoveryMode === 'restore-and-replay' ) validateRestoreRecovery( h, route, bundle, recovery, signal );
	else if ( recovery.recoveryMode === 'discontinuous-restart' ) validateRestartRecovery( h, route, bundle, recovery, signal );
	else assert.fail( `${ label } has unknown recovery mode ${ recovery.recoveryMode }` );
	return true;

}

export function validateExternalGpuFixtureBundle( h, route, bundle ) {

	validateExternalSolverAdapterFixture( h, route, bundle.externalAdapterVariants.sharedResource, 'externalAdapterVariants.sharedResource' );
	validateExternalSolverAdapterFixture( h, route, bundle.externalAdapterVariants.copyBoundary, 'externalAdapterVariants.copyBoundary' );
	validateAuthoritativeGpuRecoveryFixture( h, route, bundle, bundle.gpuRecoveries.restoreReplay, 'gpuRecoveries.restoreReplay' );
	validateAuthoritativeGpuRecoveryFixture( h, route, bundle, bundle.gpuRecoveries.discontinuousRestart, 'gpuRecoveries.discontinuousRestart' );
	exactSet(
		Object.keys( bundle.gpuAtomicCommitGroupsById ),
		[
			bundle.gpuRecoveries.restoreReplay.restoreTransaction.atomicPublicationCommitGroupId,
			bundle.gpuRecoveries.discontinuousRestart.restartTransaction.atomicPublicationCommitGroupId
		],
		'GPU recovery atomic commit-group inventory closure'
	);
	return true;

}

function mutated( bundle, mutator ) {

	const result = cloneValue( bundle );
	mutator( result );
	return result;

}

export const rejectImplicitEngineDefault = ( bundle ) => mutated( bundle, ( value ) => { value.externalAdapterVariants.sharedResource.ownership.stepping = 'implicit-engine-default'; } );
export const rejectHalfCommit = ( bundle ) => mutated( bundle, ( value ) => {

	const receipt = value.externalAdapterVariants.sharedResource.stepReceipts[ 0 ];
	receipt.outputPreparedVersions = [];
	completeReceiptDigest( receipt );

} );
export const rejectAmbiguousCapability = ( bundle ) => mutated( bundle, ( value ) => { value.externalAdapterVariants.sharedResource.interactionCapabilities.push( { ...cloneValue( value.externalAdapterVariants.sharedResource.interactionCapabilities[ 0 ] ), capabilityId: 'ambiguous-ingress-copy' } ); } );
export const rejectMissingExactOnce = ( bundle ) => mutated( bundle, ( value ) => { value.externalAdapterVariants.sharedResource.interactionCapabilities[ 0 ].exactOnceSupport = 'unsupported'; } );
export const rejectMissingSupportedFrameCoverage = ( bundle ) => mutated( bundle, ( value ) => { value.externalAdapterVariants.sharedResource.supportedFramesCharts = []; } );
export const rejectReceiptDependencyMismatch = ( bundle ) => mutated( bundle, ( value ) => { value.externalAdapterVariants.sharedResource.stepReceipts[ 0 ].dependencyCompletionRefs[ 0 ].receiptDigest = 'sha256:wrong-dependency-completion'; } );
export const rejectSharedResourceGenerationMismatch = ( bundle ) => mutated( bundle, ( value ) => { value.externalAdapterVariants.sharedResource.residencySynchronization.resourceProtocol.generationAndSubresourceFields.resourceGeneration = 'stale-resource-generation'; } );
export const rejectCopyDigestMismatch = ( bundle ) => mutated( bundle, ( value ) => { value.externalAdapterVariants.copyBoundary.residencySynchronization.transferProtocol.serializationLayoutAndDigest.contentDigest = 'sha256:wrong-copy-layout'; } );
export const rejectCopySequenceMismatch = ( bundle ) => mutated( bundle, ( value ) => { value.externalAdapterVariants.copyBoundary.residencySynchronization.transferProtocol.sequenceAndExactOnceKeys.inputApplicationLedgerIds.pop(); } );
export const rejectSubmissionOnlyHostVisibility = ( bundle ) => mutated( bundle, ( value ) => { value.externalAdapterVariants.copyBoundary.residencySynchronization.resourceProtocol.releaseOrCompletionToken.kind = 'submission-promise'; } );
export const rejectDuplicateApplicationLedger = ( bundle ) => mutated( bundle, ( value ) => { const ids = value.externalAdapterVariants.sharedResource.stepReceipts[ 0 ].inputApplicationLedgerIds; ids.push( ids[ 0 ] ); } );
export const rejectNonAtomicExternalOutput = ( bundle ) => mutated( bundle, ( value ) => {

	const receipt = value.externalAdapterVariants.sharedResource.stepReceipts[ 0 ];
	receipt.outputPreparedVersions[ 0 ].commitGroupId = 'forcing-commit';
	completeReceiptDigest( receipt );

} );

export const rejectPartialCheckpoint = ( bundle ) => mutated( bundle, ( value ) => { value.gpuRecoveries.restoreReplay.latestCheckpoint.committedVersions = []; } );
export const rejectCheckpointDigestMismatch = ( bundle ) => mutated( bundle, ( value ) => { value.gpuRecoveries.restoreReplay.latestCheckpoint.contentDigest = 'sha256:partial-checkpoint'; } );
export const rejectDoubleReplay = ( bundle ) => mutated( bundle, ( value ) => { const range = value.gpuRecoveries.restoreReplay.restoreTransaction.replayInteractionEventRanges[ 0 ]; range.interactionApplicationLedgerIds.push( range.interactionApplicationLedgerIds[ 0 ] ); } );
export const rejectOverlappingReplayRanges = ( bundle ) => mutated( bundle, ( value ) => { const range = cloneValue( value.gpuRecoveries.restoreReplay.restoreTransaction.replayInteractionEventRanges[ 0 ] ); range.rangeId = 'overlapping-range'; value.gpuRecoveries.restoreReplay.restoreTransaction.replayInteractionEventRanges.push( range ); } );
export const rejectReplayCursorGap = ( bundle ) => mutated( bundle, ( value ) => { value.gpuRecoveries.restoreReplay.restoreTransaction.restoreLedgerCursorsBeforeReplay.interactionApplicationLedgers[ 'body-water-exchange/body-state' ] --; } );
export const rejectLostGenerationReuse = ( bundle ) => mutated( bundle, ( value ) => { const recovery = value.gpuRecoveries.restoreReplay; recovery.restoreTransaction.restoreTargetResidency.bindings[ 0 ].resourceGeneration = recovery.authoritativeResidency.bindings[ 0 ].resourceGeneration; } );
export const rejectRestoredGenerationNotAdvanced = ( bundle ) => mutated( bundle, ( value ) => { const recovery = value.gpuRecoveries.restoreReplay; recovery.restoreTransaction.publishedDeviceLossGeneration = recovery.authoritativeResidency.deviceLossGeneration; } );
export const rejectRecoveryConservationGateMissing = ( bundle ) => mutated( bundle, ( value ) => { value.gpuRecoveries.restoreReplay.restoreTransaction.validationGates = value.gpuRecoveries.restoreReplay.restoreTransaction.validationGates.filter( ( gate ) => gate.gate !== 'conservation' ); } );
export const rejectAtomicRecoveryPublicationMissing = ( bundle ) => mutated( bundle, ( value ) => { delete value.gpuAtomicCommitGroupsById[ value.gpuRecoveries.restoreReplay.restoreTransaction.atomicPublicationCommitGroupId ]; } );
export const rejectRestartArmCheckpointPresent = ( bundle ) => mutated( bundle, ( value ) => { value.gpuRecoveries.discontinuousRestart.latestCheckpoint = cloneValue( value.gpuRecoveries.restoreReplay.latestCheckpoint ); } );
export const rejectRestartLossLedgerIncomplete = ( bundle ) => mutated( bundle, ( value ) => { value.gpuRecoveries.discontinuousRestart.restartTransaction.lostInventoriesInteractionsAndEvents.complete = false; } );
export const rejectRestartEpochNotAdvanced = ( bundle ) => mutated( bundle, ( value ) => { value.gpuRecoveries.discontinuousRestart.restartTransaction.newDiscontinuityEpoch = 'time-continuity-1'; } );
export const rejectRestartResetPlanEmpty = ( bundle ) => mutated( bundle, ( value ) => { value.gpuRecoveries.discontinuousRestart.restartTransaction.resetActions = []; } );
export const rejectRestartPolicyBlockRoute = ( bundle ) => mutated( bundle, ( value ) => { value.gpuRecoveries.discontinuousRestart.unrecoverablePolicy = 'block-route'; } );
export const rejectRestartAtomicPublicationPartial = ( bundle ) => mutated( bundle, ( value ) => { const id = value.gpuRecoveries.discontinuousRestart.restartTransaction.atomicPublicationCommitGroupId; value.gpuAtomicCommitGroupsById[ id ].publications = []; } );

export const externalGpuRejectMutations = Object.freeze( {
	implicitEngineDefault: rejectImplicitEngineDefault,
	halfCommit: rejectHalfCommit,
	ambiguousCapability: rejectAmbiguousCapability,
	missingExactOnce: rejectMissingExactOnce,
	missingSupportedFrameCoverage: rejectMissingSupportedFrameCoverage,
	receiptDependencyMismatch: rejectReceiptDependencyMismatch,
	sharedResourceGenerationMismatch: rejectSharedResourceGenerationMismatch,
	copyDigestMismatch: rejectCopyDigestMismatch,
	copySequenceMismatch: rejectCopySequenceMismatch,
	submissionOnlyHostVisibility: rejectSubmissionOnlyHostVisibility,
	duplicateApplicationLedger: rejectDuplicateApplicationLedger,
	nonAtomicExternalOutput: rejectNonAtomicExternalOutput,
	partialCheckpoint: rejectPartialCheckpoint,
	checkpointDigestMismatch: rejectCheckpointDigestMismatch,
	doubleReplay: rejectDoubleReplay,
	overlappingReplayRanges: rejectOverlappingReplayRanges,
	replayCursorGap: rejectReplayCursorGap,
	lostGenerationReuse: rejectLostGenerationReuse,
	restoredGenerationNotAdvanced: rejectRestoredGenerationNotAdvanced,
	recoveryConservationGateMissing: rejectRecoveryConservationGateMissing,
	atomicRecoveryPublicationMissing: rejectAtomicRecoveryPublicationMissing,
	restartArmCheckpointPresent: rejectRestartArmCheckpointPresent,
	restartLossLedgerIncomplete: rejectRestartLossLedgerIncomplete,
	restartEpochNotAdvanced: rejectRestartEpochNotAdvanced,
	restartResetPlanEmpty: rejectRestartResetPlanEmpty,
	restartPolicyBlockRoute: rejectRestartPolicyBlockRoute,
	restartAtomicPublicationPartial: rejectRestartAtomicPublicationPartial
} );
