import assert from 'node:assert/strict';

const OWNERSHIP_FIELDS = Object.freeze( [
	'stepping', 'constraintAssemblyAndSolve', 'collisionDetection',
	'contactManifoldLifecycle', 'forceImpulseAccumulation',
	'committedStatePublication'
] );

const ADAPTER_KEYS = Object.freeze( [
	'adapterId', 'externalSolverIdVersion', 'contextId', 'boundaryRevision',
	'ownedStateEquations', 'ownership', 'supportedFramesCharts', 'unitConversion',
	'clockMapping', 'stepSemantics', 'signalDescriptors',
	'interactionCapabilities', 'stepReceipts', 'residencySynchronization',
	'precisionDeterminism', 'errorModel', 'checkpointRollback', 'failurePolicy'
] );

function exactKeys( value, keys, label ) {

	assert.ok( value && typeof value === 'object' && ! Array.isArray( value ), `${ label } must be an object` );
	assert.deepEqual( Object.keys( value ).sort(), [ ...keys ].sort(), `${ label } has missing or unknown fields` );

}

function uniqueStrings( values, label ) {

	assert.ok( Array.isArray( values ) && values.length > 0, `${ label } must be nonempty` );
	assert.ok( values.every( ( value ) => typeof value === 'string' && value.length > 0 ), `${ label } contains an invalid string` );
	assert.equal( values.length, new Set( values ).size, `${ label } contains duplicates` );

}

export function validateExternalSolverAdapterBoundary( adapter, externalCost ) {

	exactKeys( adapter, ADAPTER_KEYS, 'adapter' );
	for ( const field of [ 'adapterId', 'externalSolverIdVersion', 'contextId', 'boundaryRevision' ] ) assert.ok( typeof adapter[ field ] === 'string' && adapter[ field ].length > 0, `adapter.${ field } is empty` );
	uniqueStrings( adapter.ownedStateEquations, 'adapter.ownedStateEquations' );
	exactKeys( adapter.ownership, OWNERSHIP_FIELDS, 'adapter.ownership' );
	for ( const [ field, owner ] of Object.entries( adapter.ownership ) ) {

		assert.ok( typeof owner === 'string' && owner.length > 0, `adapter.ownership.${ field } is empty` );
		assert.ok( ! /implicit|default|unknown|shared/i.test( owner ), `adapter.ownership.${ field } is not an exact owner` );

	}
	uniqueStrings( adapter.supportedFramesCharts, 'adapter.supportedFramesCharts' );
	assert.equal( adapter.unitConversion.destinationUnitSystemId, 'canonical-SI', 'adapter does not convert to canonical SI' );
	for ( const quantity of [ 'length', 'mass', 'time', 'force', 'torque', 'linearImpulse', 'angularImpulse' ] ) {

		const map = adapter.unitConversion.perQuantityAffineOrLinearMaps[ quantity ];
		assert.ok( map && Number.isFinite( map.scale ) && Number.isFinite( map.offset ), `adapter unit map ${ quantity } is absent or invalid` );

	}
	assert.equal( adapter.unitConversion.handednessAndAxialConvention.properRotation, true, 'adapter frame map is not a proper rotation' );
	assert.equal( adapter.unitConversion.handednessAndAxialConvention.axialConvention, 'explicit', 'adapter axial-vector convention is implicit' );
	for ( const field of [ 'externalClockId', 'contextClockId', 'mappingRevision', 'mappingDescriptorRef', 'maximumAgeAndMappingError' ] ) assert.ok( adapter.clockMapping[ field ], `adapter.clockMapping.${ field } is absent` );
	assert.ok( [ 'analytic', 'fixed', 'adaptive', 'event', 'remote-stream' ].includes( adapter.stepSemantics ), 'adapter.stepSemantics is invalid' );
	assert.ok( Array.isArray( adapter.signalDescriptors ) && adapter.signalDescriptors.length > 0, 'adapter has no signal descriptors' );
	assert.ok( adapter.signalDescriptors.every( ( descriptor ) => descriptor.providerId === adapter.adapterId && descriptor.contextId === adapter.contextId ), 'adapter signal authority crosses provider/context' );
	assert.ok( adapter.signalDescriptors.every( ( descriptor ) => adapter.supportedFramesCharts.includes( descriptor.physicsFrameId ) ), 'adapter omits a signal frame from supportedFramesCharts' );
	assert.ok( Array.isArray( adapter.interactionCapabilities ) && adapter.interactionCapabilities.length > 0, 'adapter has no interaction capabilities' );
	assert.equal( adapter.interactionCapabilities.length, new Set( adapter.interactionCapabilities.map( ( capability ) => capability.capabilityId ) ).size, 'adapter capability IDs repeat' );
	const capabilitySignatures = adapter.interactionCapabilities.map( ( capability ) => [
		capability.direction, capability.role, capability.payloadTag,
		capability.targetEquationId, capability.frameId,
		[ ...( capability.footprintKinds ?? [] ) ].sort().join( ',' )
	].join( '|' ) );
	assert.equal( capabilitySignatures.length, new Set( capabilitySignatures ).size, 'adapter has ambiguous directional capabilities' );
	for ( const capability of adapter.interactionCapabilities ) {

		assert.ok( [ 'ingress', 'egress' ].includes( capability.direction ), `${ capability.capabilityId } has invalid direction` );
		assert.ok( adapter.supportedFramesCharts.includes( capability.frameId ), `${ capability.capabilityId } frame is unsupported` );
		assert.ok( capability.unitSignature && typeof capability.unitSignature === 'object', `${ capability.capabilityId } lacks a dimensional signature` );
		assert.equal( capability.exactOnceSupport, 'required-ledger', `${ capability.capabilityId } lacks exact-once support` );
		assert.equal( capability.reactionAtomicity, 'same-commit-transaction', `${ capability.capabilityId } can half-commit a reaction` );
		assert.ok( capability.dependencyRef?.dependencyId && capability.errorDescriptorRef, `${ capability.capabilityId } lacks dependency/error authority` );

	}
	assert.ok( Array.isArray( adapter.stepReceipts ) && adapter.stepReceipts.length > 0, 'adapter has no step receipt' );
	for ( const receipt of adapter.stepReceipts ) {

		assert.equal( receipt.adapterId, adapter.adapterId, `${ receipt.receiptId } belongs to another adapter` );
		assert.equal( receipt.status, 'completed', `${ receipt.receiptId } is not completed` );
		assert.ok( receipt.inputApplicationLedgerIds.length > 0, `${ receipt.receiptId } has no exact-once ingress ledgers` );
		assert.equal( receipt.inputApplicationLedgerIds.length, new Set( receipt.inputApplicationLedgerIds ).size, `${ receipt.receiptId } repeats an ingress ledger` );
		assert.deepEqual( [ ...new Set( receipt.outputPreparedVersions.map( ( output ) => output.stateEquationId ) ) ].sort(), [ ...adapter.ownedStateEquations ].sort(), `${ receipt.receiptId } does not prepare every owned state equation` );
		assert.equal( new Set( receipt.outputPreparedVersions.map( ( output ) => output.commitTransactionId ) ).size, 1, `${ receipt.receiptId } splits its atomic output` );
		assert.ok( receipt.dependencyCompletionRefs.length > 0, `${ receipt.receiptId } has no dependency completion` );

	}
	const synchronization = adapter.residencySynchronization;
	assert.ok( [ 'shared-resource', 'device-copy', 'host-staging', 'network-message' ].includes( synchronization.transport ), 'adapter transport is invalid' );
	assert.deepEqual( Object.keys( synchronization.authorityBySignalOrStateEquation ).sort(), [ ...adapter.ownedStateEquations, ...adapter.signalDescriptors.map( ( descriptor ) => descriptor.signalId ) ].sort(), 'adapter synchronization authority map is incomplete' );
	assert.ok( Object.values( synchronization.authorityBySignalOrStateEquation ).every( ( owner ) => owner === 'external-solver' || owner === adapter.adapterId ), 'adapter synchronization authority is implicit or conflicting' );
	assert.ok( synchronization.resourceProtocol.acquireDependency?.dependencyId, 'adapter has no acquire dependency' );
	assert.ok( synchronization.resourceProtocol.releaseOrCompletionToken?.kind, 'adapter has no completion token' );
	if ( synchronization.transport === 'shared-resource' ) {

		assert.equal( synchronization.hostVisibilityProof, 'not-host-visible', 'shared GPU state falsely claims host visibility' );
		assert.ok( synchronization.resourceProtocol.generationAndSubresourceFields.resourceGeneration, 'shared GPU state has no resource generation' );

	} else {

		assert.ok( /completion|fence/.test( synchronization.hostVisibilityProof ), 'copied/external state lacks completion/fence host visibility proof' );
		assert.ok( synchronization.transferProtocol.serializationLayoutAndDigest.contentDigest, 'copied/external state lacks a content digest' );
		assert.ok( synchronization.transferProtocol.sequenceAndExactOnceKeys, 'copied/external state lacks sequence/exact-once keys' );

	}
	assert.ok( [ 'deterministic-tree', 'declared-nondeterministic-with-error' ].includes( adapter.precisionDeterminism.reductionOrdering ), 'adapter reduction ordering is undefined' );
	assert.ok( adapter.errorModel && Object.keys( adapter.errorModel ).length > 0, 'adapter error model is empty' );
	assert.ok( [ 'none', 'checkpoint', 'checkpoint-and-replay' ].includes( adapter.checkpointRollback.support ), 'adapter checkpoint policy is invalid' );
	if ( adapter.checkpointRollback.support === 'checkpoint-and-replay' ) {

		for ( const field of [ 'checkpointFormatAndDigest', 'cadenceAndMaximumRollback', 'includedStateVersionsInventoriesAndCursors', 'restoreOrderingAndValidationGates' ] ) assert.ok( adapter.checkpointRollback[ field ], `adapter checkpoint/replay omits ${ field }` );

	}
	assert.ok( adapter.failurePolicy.freezeCommitGroups.length > 0, 'adapter failure freezes no commit group' );
	assert.equal( adapter.failurePolicy.degradedPublication, 'forbidden', 'adapter permits uncontracted degraded publication' );
	assert.ok( adapter.failurePolicy.detectionAndTimeout?.timeout, 'adapter failure has no detection timeout' );
	assert.ok( adapter.failurePolicy.recoveryOwnerAndPlan, 'adapter failure has no recovery owner/plan' );
	assert.equal( externalCost?.adapterId, adapter.adapterId, 'external cost references another adapter' );
	assert.equal( externalCost?.completeDependencyTail, true, 'adapter omits complete external-tail cost evidence' );
	for ( const segment of [ 'enqueue', 'conversion', 'queueWait', 'transport', 'remoteSolve', 'completion', 'deserialization', 'atomicCommit' ] ) assert.ok( Object.hasOwn( externalCost.segments, segment ), `adapter external cost omits ${ segment }` );
	return true;

}

export const canonicalAdapterKeys = ADAPTER_KEYS;
