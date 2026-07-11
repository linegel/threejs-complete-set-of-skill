import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const QUALITY_CONTEXT_OWNER = 'route-physics-coordinator';
const QUALITY_REQUEST_ID = 'quality-request-43';
const QUALITY_TRANSITION_ID = 'quality-transition-43';
const SOURCE_QUALITY_STATE_ID = 'mobile-quality-v3';
const DESTINATION_QUALITY_STATE_ID = 'mobile-quality-v4-budgeted';
const SOURCE_QUALITY_EPOCH = 'quality-epoch-3';
const DESTINATION_QUALITY_EPOCH = 'quality-epoch-4';
const SOURCE_LEASE_ID = 'quality-source-state-lease';
const DESTINATION_LEASE_ID = 'quality-destination-state-lease';
const MIGRATION_LEDGER_ID = 'quality-migration-overlap-memory-ledger-43';
const CONSERVATIVE_MAP_ID = 'quality-conservative-map-43';
const ERROR_LEDGER_ID = 'quality-migration-error-ledger-43';
const ALLOCATION_REQUEST_ID = 'quality-allocation-request-43';
const REQUEST_ADMISSION_ID = 'quality-request-admission-43';
const ALLOCATION_ADMISSION_ID = 'quality-allocation-admission-43';
const SOURCE_ACTIVE_CELL_COUNT = 65536;
const DESTINATION_ACTIVE_CELL_COUNT = 32768;
const WATER_COMPONENT_SLOTS_PER_CELL = 6;
const WATER_BYTES_PER_COMPONENT_SLOT = 16;
const WATER_AUXILIARY_BYTES_PER_CELL = 16;
const WATER_SOURCE_CORE_LOGICAL_BYTES = SOURCE_ACTIVE_CELL_COUNT * WATER_COMPONENT_SLOTS_PER_CELL * WATER_BYTES_PER_COMPONENT_SLOT;
const WATER_DESTINATION_CORE_LOGICAL_BYTES = DESTINATION_ACTIVE_CELL_COUNT * WATER_COMPONENT_SLOTS_PER_CELL * WATER_BYTES_PER_COMPONENT_SLOT;
const WATER_SOURCE_AUXILIARY_LOGICAL_BYTES = SOURCE_ACTIVE_CELL_COUNT * WATER_AUXILIARY_BYTES_PER_CELL;
const WATER_DESTINATION_AUXILIARY_LOGICAL_BYTES = DESTINATION_ACTIVE_CELL_COUNT * WATER_AUXILIARY_BYTES_PER_CELL;
const WATER_SOURCE_LOGICAL_BYTES = WATER_SOURCE_CORE_LOGICAL_BYTES + WATER_SOURCE_AUXILIARY_LOGICAL_BYTES;
const WATER_DESTINATION_LOGICAL_BYTES = WATER_DESTINATION_CORE_LOGICAL_BYTES + WATER_DESTINATION_AUXILIARY_LOGICAL_BYTES;
const RIGID_BODY_STATE_COUNT = 1;
const RIGID_BODY_STATE_STRIDE_BYTES = 256;
const CONTACT_WARM_START_COUNT = 1024;
const CONTACT_WARM_START_STRIDE_BYTES = 64;
const RIGID_BODY_CORE_LOGICAL_BYTES = RIGID_BODY_STATE_COUNT * RIGID_BODY_STATE_STRIDE_BYTES;
const CONTACT_WARM_START_LOGICAL_BYTES = CONTACT_WARM_START_COUNT * CONTACT_WARM_START_STRIDE_BYTES;
const RIGID_BODY_SOURCE_LOGICAL_BYTES = RIGID_BODY_CORE_LOGICAL_BYTES + CONTACT_WARM_START_LOGICAL_BYTES;
const RIGID_BODY_DESTINATION_LOGICAL_BYTES = RIGID_BODY_CORE_LOGICAL_BYTES + CONTACT_WARM_START_LOGICAL_BYTES;
const MIGRATION_SCRATCH_LOGICAL_BYTES = 480 * 1024;
const REPRESENTED_AREA_SQUARE_METRES = 32768;
const DEVICE_CAPACITY_BYTES = 64 * 1024 * 1024;
const REQUIRED_HEADROOM_BYTES = 8 * 1024 * 1024;
const STATE_EQUATION_BY_SIGNAL_ID = Object.freeze( {
	'water-surface-state': 'water-state',
	'rigid-body-state': 'body-state'
} );
const EXTERNAL_INVENTORY_KEYS = Object.freeze( [
	'physicsExternalSolverAdaptersById'
] );

function canonicalJson( value ) {

	if ( Array.isArray( value ) ) return `[${ value.map( canonicalJson ).join( ',' ) }]`;
	if ( value !== null && typeof value === 'object' ) return `{${ Object.keys( value ).sort().map( ( key ) => `${ JSON.stringify( key ) }:${ canonicalJson( value[ key ] ) }` ).join( ',' ) }}`;
	return JSON.stringify( value );

}

function fallbackDigest( value ) {

	return `sha256:${ createHash( 'sha256' ).update( canonicalJson( value ) ).digest( 'hex' ) }`;

}

function digestRecordWithout( api, record, omittedKey ) {

	const payload = api.clone( record );
	delete payload[ omittedKey ];
	return api.digest( payload );

}

function qualityApi( h ) {

	for ( const key of [ 'typedAbsence', 'evidence', 'fixtureDurationSeconds', 'fixtureError' ] ) assert.equal( typeof h?.[ key ], 'function', `quality fixture helper h.${ key} is required` );
	return {
		clone: h.clone ?? structuredClone,
		absent: h.typedAbsence,
		evidence: h.evidence,
		duration: h.fixtureDurationSeconds,
		error: h.fixtureError,
		digest: h.sha256Canonical ?? fallbackDigest,
		requireRecord: h.requireAbiRecord ?? ( ( value ) => value ),
		isAbsent: h.isTypedAbsence ?? ( ( value ) => value !== null && typeof value === 'object' && value.kind === 'absent' )
	};

}

function sortedUnique( values, label ) {

	const sorted = [ ...values ].sort();
	assert.equal( new Set( sorted ).size, sorted.length, `${ label } contains duplicate values` );
	return sorted;

}

function quantityValue( quantity, label ) {

	assert.ok( quantity !== null && typeof quantity === 'object' && Object.hasOwn( quantity, 'value' ), `${ label } must be labelled quantitative evidence` );
	assert.ok( typeof quantity.value === 'number' && Number.isFinite( quantity.value ), `${ label }.value must be finite` );
	return quantity.value;

}

function rootFrame( route ) {

	const context = route.physicsContext;
	return context.physicsFrameRegistry.framesById[ context.physicsRootFrameId ];

}

function targetViewKeys( route ) {

	const fromExecution = route.frameExecutionRecord?.requiredTargetViewKeys;
	if ( Array.isArray( fromExecution ) && fromExecution.length > 0 ) return sortedUnique( fromExecution, 'frameExecutionRecord.requiredTargetViewKeys' );
	const fromPlans = Object.keys( route.physicsPresentationRenderPlansByTarget ?? {} );
	assert.ok( fromPlans.length > 0, 'quality transition requires at least one route-owned target/view' );
	return sortedUnique( fromPlans, 'physicsPresentationRenderPlansByTarget' );

}

function qualityInterval( api, route ) {

	const interval = route.physicsGraph?.coordinationInterval ?? route.physicsCoordinationAdvanceRecords?.at( - 1 )?.interval;
	assert.ok( interval, 'quality transition requires a route-owned coordination interval' );
	return api.clone( interval );

}

function retirementInstant( api, route, commitInstant ) {

	const end = route.physicsCostLedger?.measurementInterval?.endExclusive;
	if ( end?.timeSecondsDerived?.value > commitInstant.timeSecondsDerived.value ) return api.clone( end );
	const presented = route.frameExecutionRecord?.targetExecutions && Object.values( route.frameExecutionRecord.targetExecutions ).map( ( target ) => target.presentedTimestamp ).find( ( instant ) => instant?.timeSecondsDerived?.value > commitInstant.timeSecondsDerived.value );
	assert.ok( presented, 'quality fixture requires a route-owned instant after the quality commit for retirement evidence' );
	return api.clone( presented );

}

function signalById( route, signalId ) {

	const signal = Object.values( route.physicsSignals ?? {} ).find( ( candidate ) => candidate.signalId === signalId );
	assert.ok( signal, `quality transition cannot resolve route signal ${ signalId }` );
	return signal;

}

function signalResourceGeneration( signal ) {

	assert.equal( signal.resourceGeneration?.kind, 'present', `quality source signal ${ signal.signalId } lacks an authoritative resource generation` );
	assert.ok( typeof signal.resourceGeneration.generation === 'string' && signal.resourceGeneration.generation.length > 0, `quality source signal ${ signal.signalId } has an invalid resource generation` );
	return signal.resourceGeneration.generation;

}

function configuredFramesInFlight( route, targets ) {

	const configured = route.frameExecutionRecord?.cohortAdmission?.configuredMaximumFramesInFlightByTarget;
	assert.ok( configured && typeof configured === 'object', 'quality allocation requires route-owned frame-cohort capacity admission' );
	assert.deepEqual( Object.keys( configured ).sort(), [ ...targets ].sort(), 'quality allocation target scope differs from frame-cohort capacity scope' );
	const counts = targets.map( ( target ) => configured[ target ] );
	assert.ok( counts.every( ( count ) => Number.isSafeInteger( count ) && count > 0 ), 'quality allocation has an invalid configured frames-in-flight count' );
	for ( const slot of route.frameExecutionRecord.slotAdmissions ?? [] ) {

		const target = `${ slot.presentationTargetId }/${ slot.viewId }`;
		if ( targets.includes( target ) ) assert.equal( slot.configuredMaximumFramesInFlight, configured[ target ], `quality allocation frame capacity disagrees with slot admission ${ slot.slotAdmissionId }` );

	}
	return Math.max( ...counts );

}

function routeGpuGenerationAuthority( route ) {

	const execution = route.frameExecutionRecord;
	assert.ok( execution && typeof execution.backendGeneration === 'string' && typeof execution.deviceLossGeneration === 'string', 'quality transition requires authoritative frame backend/device-loss generations' );
	return { backendGeneration: execution.backendGeneration, deviceLossGeneration: execution.deviceLossGeneration };

}

function generationTuple( route, signal, resourceGeneration ) {

	const frameGeneration = routeGpuGenerationAuthority( route );
	assert.ok( typeof signal.residency?.deviceId === 'string' && signal.residency.deviceId.length > 0, `quality signal ${ signal.signalId } lacks a GPU device identity` );
	return {
		deviceId: signal.residency.deviceId,
		backendGeneration: frameGeneration.backendGeneration,
		deviceLossGeneration: frameGeneration.deviceLossGeneration,
		resourceGeneration
	};

}

function sourceStateGeneration( route, version ) {

	const signal = signalById( route, version.signalId );
	assert.equal( signal.stateVersion, version.stateVersion, `quality source state ${ version.signalId } does not identify the route signal's committed state version` );
	return {
		signalId: version.signalId,
		stateVersion: version.stateVersion,
		...generationTuple( route, signal, signalResourceGeneration( signal ) )
	};

}

function completedStageExecutionForSignal( route, signalId ) {

	const stageIds = new Set( ( route.physicsGraph?.stages ?? [] )
		.filter( ( stage ) => stage.writes.some( ( write ) => write.signalId === signalId && write.disposition === 'transaction-prepared' ) )
		.map( ( stage ) => stage.stageId ) );
	const execution = ( route.physicsGraph?.executionLedger?.stageExecutions ?? [] )
		.filter( ( candidate ) => stageIds.has( candidate.stageId ) && candidate.status === 'completed' )
		.sort( ( a, b ) => a.executionSequence - b.executionSequence ).at( - 1 );
	assert.ok( execution, `quality completion cannot resolve a completed transaction-prepared writer for ${ signalId }` );
	const dependencyCompletion = ( route.physicsGraph.executionLedger.dependencyCompletions ?? [] )
		.find( ( candidate ) => candidate.producerExecutionId === execution.executionId && candidate.status === 'completed' );
	assert.ok( dependencyCompletion && ! ( dependencyCompletion.producerRelease?.kind === 'absent' ), `quality completion cannot resolve a producer release for ${ execution.executionId }` );
	return { execution, dependencyCompletion };

}

function interactionApplicationsForEquation( route, stateEquationId ) {

	const applications = Object.values( route.physicsInteractionApplicationLedgers ?? {} )
		.filter( ( ledger ) => ledger.targetStateEquation === stateEquationId && ledger.disposition === 'committed' )
		.sort( ( a, b ) => a.applicationLedgerId.localeCompare( b.applicationLedgerId ) );
	assert.ok( applications.length > 0, `quality completion cannot resolve committed coupling applications for ${ stateEquationId }` );
	const executionIds = [ ...new Set( applications.map( ( ledger ) => ledger.stageExecutionId ) ) ];
	assert.equal( executionIds.length, 1, `quality coupling applications for ${ stateEquationId } span unrelated executions` );
	const execution = route.physicsGraph.executionLedger.stageExecutions.find( ( candidate ) => candidate.executionId === executionIds[ 0 ] );
	assert.ok( execution && execution.status === 'completed', `quality coupling application execution ${ executionIds[ 0 ] } is unresolved or incomplete` );
	const dependencyCompletion = route.physicsGraph.executionLedger.dependencyCompletions.find( ( candidate ) => candidate.producerExecutionId === execution.executionId && candidate.status === 'completed' );
	assert.ok( dependencyCompletion && ! ( dependencyCompletion.producerRelease?.kind === 'absent' ), `quality coupling completion cannot resolve a producer release for ${ execution.executionId }` );
	return { applications, execution, dependencyCompletion };

}

function routeExternalAdapterRecords( route ) {

	const inventory = route.physicsExternalSolverAdaptersById;
	assert.ok( inventory !== null && typeof inventory === 'object' && ! Array.isArray( inventory ), 'quality external completion authority must be the keyed route.physicsExternalSolverAdaptersById inventory' );
	const adapters = [];
	for ( const [ key, adapter ] of Object.entries( inventory ) ) {

		assert.ok( adapter && typeof adapter === 'object', `quality route external adapter ${ key } is not a record` );
		assert.equal( key, adapter.adapterId, `quality route external adapter key ${ key } differs from adapterId` );
		assert.ok( typeof adapter.boundaryRevision === 'string' && adapter.boundaryRevision.length > 0, `quality route external adapter ${ key } lacks a boundary revision` );
		assert.ok( Array.isArray( adapter.ownedStateEquations ) && adapter.ownedStateEquations.length > 0, `quality route external adapter ${ key } owns no state equation` );
		assert.ok( Array.isArray( adapter.stepReceipts ), `quality route external adapter ${ key } lacks step receipts` );
		adapters.push( adapter );

	}
	return adapters.sort( ( a, b ) => `${ a.adapterId }|${ a.boundaryRevision }`.localeCompare( `${ b.adapterId }|${ b.boundaryRevision }` ) );

}

function externalReceiptConsumers( route, sourceStateVersions ) {

	const sourceKeys = new Set( sourceStateVersions.map( ( ref ) => `${ ref.signalId }|${ ref.stateVersion }` ) );
	const consumers = [];
	for ( const adapter of routeExternalAdapterRecords( route ) ) for ( const receipt of adapter.stepReceipts ) {

		const matchedStateVersions = ( receipt.inputStateVersions ?? [] ).filter( ( ref ) => sourceKeys.has( `${ ref.signalId }|${ ref.stateVersion }` ) );
		if ( matchedStateVersions.length === 0 ) continue;
		assert.equal( receipt.status, 'completed', `quality source retirement is blocked by incomplete external receipt ${ adapter.adapterId }/${ receipt.receiptId }` );
		consumers.push( { adapter, receipt, matchedStateVersions } );

	}
	return consumers.sort( ( a, b ) => `${ a.adapter.adapterId }|${ a.receipt.receiptId }`.localeCompare( `${ b.adapter.adapterId }|${ b.receipt.receiptId }` ) );

}

function qualityValidity( api, owner, domain ) {

	return {
		status: 'valid',
		domain,
		validTime: 'timeless',
		staleAfter: api.absent( 'not-applicable', owner ),
		reason: api.absent( 'not-applicable', owner ),
		acceptanceGate: 'quality-state descriptor admitted by conservation, error, capacity, and safe-boundary gates'
	};

}

function migrationSupport( api, route, suffix, representedAreaSquareMetres ) {

	const context = route.physicsContext;
	const frame = rootFrame( route );
	return {
		supportId: `quality-migration-${ suffix}-support`,
		kind: 'area',
		physicsFrameId: context.physicsRootFrameId,
		physicsOriginEpoch: context.physicsOriginEpoch,
		transformRevision: frame.transformRevision,
		chartId: api.absent( 'not-applicable', QUALITY_CONTEXT_OWNER ),
		geometry: `coastal active-domain footprint ${ suffix}`,
		orientation: 'physics-root-frame oriented area',
		measureUnit: 'square-metre',
		representedMeasure: api.evidence( representedAreaSquareMetres, 'square-metre', 'Derived', 'quality-active-domain-cell-measures' ),
		error: api.error( 'square-metre', 1e-6, `quality-${ suffix }-support` )
	};

}

function migrationFilter( api ) {

	return {
		filterId: 'quality-migration-area-weighted-restriction-filter-v1',
		supportMeasure: 'area',
		kernelOrTransferFunction: 'finite-volume area-weighted restriction with unit DC response',
		spatialBandwidth: api.evidence( 2, 'metre', 'Derived', 'destination-cell-footprint' ),
		temporalBandwidth: api.absent( 'not-applicable', QUALITY_CONTEXT_OWNER ),
		phaseSemantics: 'phase-resolved',
		normalization: 'sum of nonnegative source-cell weights equals one for every destination cell',
		causality: 'instantaneous',
		error: api.error( 'ratio', 1e-7, 'quality-migration-filter' )
	};

}

function stateInventory( api, stateVersionSuffix ) {

	const isMigrationDestination = stateVersionSuffix.endsWith( '-provisional' );
	const committedStateVersionSuffix = stateVersionSuffix.replace( /-provisional$/, '' );
	return {
		stateEquations: [ 'body-state', 'water-state' ],
		coherentStateVersion: `quality-coherent-state-${ committedStateVersionSuffix}`,
		publicationDisposition: isMigrationDestination ? 'committed-only-after-atomic-quality-transition' : 'committed',
		stateVersions: [
			{ signalId: 'water-surface-state', stateVersion: `water-${ committedStateVersionSuffix}` },
			{ signalId: 'rigid-body-state', stateVersion: `body-${ committedStateVersionSuffix}` }
		],
		migrationProvisionalStateVersions: isMigrationDestination ? [
			{ signalId: 'water-surface-state', stateVersion: `water-${ stateVersionSuffix}` },
			{ signalId: 'rigid-body-state', stateVersion: `body-${ stateVersionSuffix}` }
		] : [],
		conservedInventories: {
			'water-volume': api.evidence( 327680, 'cubic-metre', 'Derived', 'represented-area-times-ten-metre-mean-depth' ),
			'linear-momentum-x': api.evidence( 0, 'newton-second', 'Derived', 'closed-body-water-system' ),
			'linear-momentum-y': api.evidence( 0, 'newton-second', 'Derived', 'closed-body-water-system' ),
			'linear-momentum-z': api.evidence( 0, 'newton-second', 'Derived', 'closed-body-water-system' ),
			'angular-momentum-x': api.evidence( 0, 'newton-metre-second', 'Derived', 'closed-body-water-system-about-physics-root-origin' ),
			'angular-momentum-y': api.evidence( 0, 'newton-metre-second', 'Derived', 'closed-body-water-system-about-physics-root-origin' ),
			'angular-momentum-z': api.evidence( 0, 'newton-metre-second', 'Derived', 'closed-body-water-system-about-physics-root-origin' ),
			'total-mechanical-energy': api.evidence( 5242880, 'joule', 'Derived', 'resolved-kinetic-plus-potential-energy-reduction' )
		},
		eventQueues: {
			'body-water-exchange': { streamId: 'body-water-exchange', nextSequence: 1005, queuePartition: 'pre-boundary-drained-post-boundary-preserved' }
		},
		exactOnceLedgers: {
			'body-water-exchange': { ledgerVersion: 'delivery-ledger-v42', cursorAfter: 1005 }
		},
		stableEntityGenerations: [ 'hull#g4', 'water#g2' ]
	};

}

function qualityState( api, route, fields ) {

	const error = api.error( 'metre', fields.surfaceErrorMetres, `${ fields.qualityStateId }-surface-error` );
	const committedStateVersionSuffix = fields.stateVersionSuffix.replace( /-provisional$/, '' );
	return {
		qualityStateId: fields.qualityStateId,
		contextId: route.physicsContext.contextId,
		owner: QUALITY_CONTEXT_OWNER,
		qualityEpoch: fields.qualityEpoch,
		equationsAndConstitutiveLawVersions: [
			{ equationId: 'water-state', version: 'coastal-shallow-water-v5' },
			{ equationId: 'body-state', version: 'rigid-body-se3-v3' },
			{ constitutiveLawId: 'water-hull-coupling', version: 'water-hull-coupling-v2' }
		],
		discretizationAndActiveDomain: {
			gridId: fields.gridId,
			activeDomainId: 'coastal-active-domain-v42',
			cellCount: api.evidence( fields.cellCount, 'cell', 'Derived', `${ fields.gridId }-active-cell-table` ),
			minimumCellWidth: api.evidence( fields.minimumCellWidthMetres, 'metre', 'Derived', `${ fields.gridId }-geometry` )
		},
		representedBandsFootprintsAndFilters: [
			{ bandId: 'coastal-gravity-band', lowerWavelength: api.evidence( fields.minimumCellWidthMetres * 4, 'metre', 'Gated', 'dispersion-error-contract' ), footprintId: `quality-migration-${ fields.gridId }-support`, filterId: 'quality-migration-area-weighted-restriction-filter-v1' }
		],
		boundaryTreatment: 'wet-dry finite-volume boundary policy v5',
		nativeStepAndCouplingControls: {
			nativeStepPolicy: 'CFL-and-wet-dry-error-bounded',
			maximumCourantNumber: api.evidence( 0.45, 'ratio', 'Gated', 'coastal-water-stability-contract' ),
			couplingIterationBound: api.evidence( 3, 'iteration', 'Gated', 'body-water-added-mass-contract' )
		},
		stateVariablesAndInventories: stateInventory( api, fields.stateVersionSuffix ),
		stochasticStreamsAndCursors: {
			'water-subgrid-stream': { algorithm: 'philox4x32-10', streamId: 'water-subgrid-stream', seedDigest: 'sha256:water-subgrid-seed-42', cursor: api.evidence( 4096, 'sample', 'Derived', 'quality-transition-source-cursor' ) }
		},
		stableIdPolicy: {
			entityNamespaceRevision: route.physicsContext.idNamespaces.registryRevision,
			generationPreservation: 'identity-without-reallocation',
			stableEntityGenerations: [ 'hull#g4', 'water#g2' ]
		},
		contactAndWarmStartState: { stateVersion: 'contact-warm-start-v42', manifoldGenerationDigest: 'sha256:contact-manifolds-v42', mappingPolicy: 'feature-ID-preserving-map' },
		presentationRepresentation: { representationId: fields.presentationRepresentationId, displacementSource: `water-${ committedStateVersionSuffix}`, stableBindingId: 'water-surface-binding' },
		physicalAndVisualErrorBounds: [ error ],
		hotTransientTrafficAndSynchronizationCosts: { physicsCostLedgerId: route.physicsCostLedger.ledgerId, qualityState: fields.qualityStateId },
		validity: qualityValidity( api, QUALITY_CONTEXT_OWNER, 'coastal body-water route target matrix' )
	};

}

function completionToken( api, route, fields ) {

	const absent = () => api.absent( 'not-applicable', QUALITY_CONTEXT_OWNER );
	const generation = routeGpuGenerationAuthority( route );
	return {
		tokenId: fields.tokenId,
		consumerKey: fields.consumerKey,
		consumerKind: fields.consumerKind,
		executionId: fields.executionId ?? absent(),
		presentationTargetId: fields.presentationTargetId ?? absent(),
		viewId: fields.viewId ?? absent(),
		snapshotId: fields.snapshotId ?? absent(),
		queueSubmissionEpoch: fields.queueSubmissionEpoch ?? absent(),
		backendGeneration: generation.backendGeneration,
		deviceLossGeneration: generation.deviceLossGeneration,
		completionSemantics: fields.completionSemantics
	};

}

function authoritativePresentationCompletionTokens( api, route, sourceStateVersions, targets ) {

	const candidate = route.physicsPresentationCandidate;
	assert.ok( candidate, 'quality retirement requires a route-owned presentation candidate' );
	const leasesById = new Map( candidate.resourceLeases.map( ( lease ) => [ lease.leaseId, lease ] ) );
	const tokens = [];
	for ( const sourceVersion of sourceStateVersions ) {

		const pair = candidate.presentedStatePairs.find( ( candidatePair ) => candidatePair.signalId === sourceVersion.signalId );
		assert.ok( pair, `quality retirement cannot resolve presentation pair for ${ sourceVersion.signalId }` );
		const leaseId = pair.currentPresented.stateHandle.leaseId;
		const lease = leasesById.get( leaseId );
		assert.ok( lease, `quality retirement cannot resolve candidate lease ${ leaseId }` );
		for ( const targetViewKey of targets ) {

			const [ presentationTargetId, viewId ] = targetViewKey.split( '/' );
			const expected = lease.reuseProhibitedUntil.presentationConsumers.find( ( token ) => token.presentationTargetId === presentationTargetId && token.viewId === viewId );
			const actual = route.frameExecutionRecord.targetExecutions[ targetViewKey ]?.completionTokens?.find( ( token ) => token.tokenId === expected?.tokenId );
			assert.ok( expected && actual, `quality retirement cannot resolve actual presentation completion for ${ leaseId } at ${ targetViewKey }` );
			assert.deepEqual( actual, expected, `quality retirement presentation completion for ${ leaseId } differs from its authoritative lease join` );
			tokens.push( api.clone( actual ) );

		}

	}
	return tokens.sort( ( a, b ) => String( a.tokenId ).localeCompare( String( b.tokenId ) ) );

}

function externalConsumerScope( api, consumers, activeAdapters ) {

	const scope = {
		authorityBoundary: 'route-owned external adapters with completed step receipts that consume exact source state versions; detached validation variants have no live lease authority',
		inspectedInventoryKeys: [ ...EXTERNAL_INVENTORY_KEYS ],
		activeAdapterKeys: activeAdapters.map( ( adapter ) => `${ adapter.adapterId }|${ adapter.boundaryRevision }` ).sort(),
		adapterSelectionPolicy: 'only keyed adapters in route.physicsExternalSolverAdaptersById have live lease authority; detached transport variants and validation bundles do not',
		matchedConsumerKeys: consumers.map( ( consumer ) => `external:${ consumer.adapter.adapterId }:${ consumer.receipt.receiptId }` ).sort(),
		disposition: consumers.length > 0 ? 'included-in-completion-join' : 'excluded-no-authoritative-route-owned-external-consumer',
		reason: consumers.length > 0 ? 'every matched completed external receipt has one completion token' : 'no route-owned completed external step receipt consumes an exact source quality-state version'
	};
	scope.scopeDigest = api.digest( scope );
	return scope;

}

function consumerCompletionJoin( api, route, targets, sourceState ) {

	const simulationConsumers = sourceState.stateVariablesAndInventories.stateVersions.map( ( version ) => {

		const { execution, dependencyCompletion } = completedStageExecutionForSignal( route, version.signalId );
		const sourceGeneration = sourceStateGeneration( route, version );
		return completionToken( api, route, {
			tokenId: `quality-simulation-${ version.signalId }-${ execution.executionId }`,
			consumerKey: `simulation:${ version.signalId }:${ execution.executionId }`,
			consumerKind: 'simulation',
			executionId: execution.executionId,
			queueSubmissionEpoch: dependencyCompletion.producerRelease.submissionEpoch,
			completionSemantics: {
				kind: 'physics-stage-completion', status: 'completed', signalId: version.signalId, stateVersion: version.stateVersion,
				sourceGeneration,
				coordinationAdvanceId: execution.coordinationAdvanceId, stageExecutionId: execution.executionId,
				completionReceiptDigest: execution.completionReceiptDigest,
				dependencyCompletionId: dependencyCompletion.completionId,
				dependencyReceiptDigest: dependencyCompletion.receiptDigest,
				producerReleaseCompletionToken: dependencyCompletion.producerRelease.completionToken
			}
		} );

	} );
	const couplingConsumers = sourceState.stateVariablesAndInventories.stateVersions.map( ( version ) => {

		const stateEquationId = STATE_EQUATION_BY_SIGNAL_ID[ version.signalId ];
		assert.ok( stateEquationId, `quality completion has no state-equation mapping for ${ version.signalId }` );
		const { applications, execution, dependencyCompletion } = interactionApplicationsForEquation( route, stateEquationId );
		const sourceGeneration = sourceStateGeneration( route, version );
		return completionToken( api, route, {
			tokenId: `quality-coupling-${ version.signalId }-${ execution.executionId }`,
			consumerKey: `coupling:${ version.signalId }:${ execution.executionId }`,
			consumerKind: 'coupling',
			executionId: execution.executionId,
			queueSubmissionEpoch: dependencyCompletion.producerRelease.submissionEpoch,
			completionSemantics: {
				kind: 'interaction-application-completion', status: 'completed', signalId: version.signalId, stateEquationId,
				sourceGeneration,
				stageExecutionId: execution.executionId, completionReceiptDigest: execution.completionReceiptDigest,
				applicationLedgerIds: applications.map( ( ledger ) => ledger.applicationLedgerId ),
				applicationReceiptDigests: applications.map( ( ledger ) => ledger.receiptDigest ),
				dependencyCompletionId: dependencyCompletion.completionId,
				dependencyReceiptDigest: dependencyCompletion.receiptDigest,
				producerReleaseCompletionToken: dependencyCompletion.producerRelease.completionToken
			}
		} );

	} );
	const activeExternalAdapters = routeExternalAdapterRecords( route );
	const externalReceiptMatches = externalReceiptConsumers( route, sourceState.stateVariablesAndInventories.stateVersions );
	const externalConsumers = externalReceiptMatches.map( ( match ) => completionToken( api, route, {
		tokenId: `quality-external-${ match.adapter.adapterId }-${ match.receipt.receiptId }`,
		consumerKey: `external:${ match.adapter.adapterId }:${ match.receipt.receiptId }`,
		consumerKind: 'external',
		completionSemantics: {
			kind: 'external-step-receipt', status: 'completed', adapterId: match.adapter.adapterId, boundaryRevision: match.adapter.boundaryRevision,
			receiptId: match.receipt.receiptId, receiptContentDigest: match.receipt.contentDigest,
			matchedInputStateVersions: api.clone( match.matchedStateVersions ),
			matchedSourceGenerationTuples: match.matchedStateVersions.map( ( version ) => {

				const signal = signalById( route, version.signalId );
				return generationTuple( route, signal, signalResourceGeneration( signal ) );

			} )
		}
	} ) );
	const presentationConsumers = authoritativePresentationCompletionTokens( api, route, sourceState.stateVariablesAndInventories.stateVersions, targets );
	const requiredConsumerKeys = sortedUnique( [ ...simulationConsumers, ...couplingConsumers, ...externalConsumers, ...presentationConsumers ].map( ( token ) => token.consumerKey ), 'quality completion join consumer keys' );
	const join = {
		joinId: 'quality-source-state-retirement-join-43',
		leaseId: SOURCE_LEASE_ID,
		requiredConsumerKeys,
		simulationConsumers,
		couplingConsumers,
		externalConsumers,
		presentationConsumers,
		joinPredicate: 'all-required-consumers-complete-or-loss-invalidated',
		deviceLossRetirementPath: 'invalidate only the matching backend, device-loss, and resource generations'
	};
	join.joinDigest = api.digest( join );
	return { join, externalScope: externalConsumerScope( api, externalReceiptMatches, activeExternalAdapters ) };

}

function allocationSpecs( sourceState, destinationState ) {

	const sourceVersions = new Map( sourceState.stateVariablesAndInventories.stateVersions.map( ( version ) => [ version.signalId, version.stateVersion ] ) );
	const destinationVersions = new Map( destinationState.stateVariablesAndInventories.migrationProvisionalStateVersions.map( ( version ) => [ version.signalId, version.stateVersion ] ) );
	const waterComponents = ( generationRole ) => {

		const source = generationRole === 'source';
		const cellCount = source ? SOURCE_ACTIVE_CELL_COUNT : DESTINATION_ACTIVE_CELL_COUNT;
		return [
			{ componentId: 'conserved-depth-momentum-bed-and-boundary-state', elementCount: cellCount * WATER_COMPONENT_SLOTS_PER_CELL, strideBytes: WATER_BYTES_PER_COMPONENT_SLOT, logicalBytes: source ? WATER_SOURCE_CORE_LOGICAL_BYTES : WATER_DESTINATION_CORE_LOGICAL_BYTES },
			{ componentId: 'sparse-tile-page-active-list-halo-and-wet-mask', elementCount: cellCount, strideBytes: WATER_AUXILIARY_BYTES_PER_CELL, logicalBytes: source ? WATER_SOURCE_AUXILIARY_LOGICAL_BYTES : WATER_DESTINATION_AUXILIARY_LOGICAL_BYTES }
		];

	};
	const bodyComponents = () => [
		{ componentId: 'rigid-body-se3-state', elementCount: RIGID_BODY_STATE_COUNT, strideBytes: RIGID_BODY_STATE_STRIDE_BYTES, logicalBytes: RIGID_BODY_CORE_LOGICAL_BYTES },
		{ componentId: 'contact-manifold-and-warm-start-cache', elementCount: CONTACT_WARM_START_COUNT, strideBytes: CONTACT_WARM_START_STRIDE_BYTES, logicalBytes: CONTACT_WARM_START_LOGICAL_BYTES }
	];
	return [
		{ signalId: 'water-surface-state', stateEquationId: 'water-state', generationRole: 'source', stateVersion: sourceVersions.get( 'water-surface-state' ), componentLayouts: waterComponents( 'source' ), logicalBytes: WATER_SOURCE_LOGICAL_BYTES, format: 'coastal-water-core-plus-sparse-support-v1' },
		{ signalId: 'water-surface-state', stateEquationId: 'water-state', generationRole: 'destination', stateVersion: destinationVersions.get( 'water-surface-state' ), componentLayouts: waterComponents( 'destination' ), logicalBytes: WATER_DESTINATION_LOGICAL_BYTES, format: 'coastal-water-core-plus-sparse-support-v1' },
		{ signalId: 'rigid-body-state', stateEquationId: 'body-state', generationRole: 'source', stateVersion: sourceVersions.get( 'rigid-body-state' ), componentLayouts: bodyComponents(), logicalBytes: RIGID_BODY_SOURCE_LOGICAL_BYTES, format: 'rigid-body-state-plus-contact-warm-start-v1' },
		{ signalId: 'rigid-body-state', stateEquationId: 'body-state', generationRole: 'destination', stateVersion: destinationVersions.get( 'rigid-body-state' ), componentLayouts: bodyComponents(), logicalBytes: RIGID_BODY_DESTINATION_LOGICAL_BYTES, format: 'rigid-body-state-plus-contact-warm-start-v1' }
	];

}

function allocationResidency( api, signal, generationRole, resourceId ) {

	const residency = api.clone( signal.residency );
	if ( generationRole === 'destination' ) {

		residency.bindingIdentity = resourceId;
		residency.sameQueueAvailability = 'after admitted conservative-map dispatch and atomic quality publication';

	}
	return residency;

}

function memoryAllocation( api, route, fields ) {

	const signal = signalById( route, fields.signalId );
	const sourceGeneration = signalResourceGeneration( signal );
	const resourceGeneration = fields.generationRole === 'source' ? sourceGeneration : `quality-${ fields.signalId }-generation-43`;
	const resourceId = fields.generationRole === 'source' ? signal.residency.bindingIdentity : `quality-${ fields.signalId }-destination-resource-43`;
	const residency = allocationResidency( api, signal, fields.generationRole, resourceId );
	const physicalBytes = fields.logicalBytes * fields.framesInFlight;
	const componentLayouts = fields.componentLayouts.map( ( component ) => ( {
		componentId: component.componentId,
		elementCount: api.evidence( component.elementCount, 'element', 'Derived', `${ fields.signalId }-${ fields.generationRole }-${ component.componentId }-layout` ),
		stride: api.evidence( component.strideBytes, 'byte', 'Derived', `${ fields.signalId }-${ fields.generationRole }-${ component.componentId }-layout` ),
		logicalBytes: api.evidence( component.logicalBytes, 'byte', 'Derived', `${ fields.signalId }-${ fields.generationRole }-${ component.componentId }-layout` )
	} ) );
	const frameSlotSubresources = Array.from( { length: fields.framesInFlight }, ( _, slotIndex ) => ( {
		slotIndex: api.evidence( slotIndex, 'slot', 'Derived', 'route-frame-cohort-allocation-layout' ),
		byteOffset: api.evidence( slotIndex * fields.logicalBytes, 'byte', 'Derived', 'quality-allocation-contiguous-slot-layout' ),
		byteLength: api.evidence( fields.logicalBytes, 'byte', 'Derived', 'quality-allocation-contiguous-slot-layout' )
	} ) );
	const leaseIdsAndCompletionJoins = fields.generationRole === 'source'
		? [ { leaseId: SOURCE_LEASE_ID, completionJoinId: fields.retirementJoin.joinId, completionJoinDigest: fields.retirementJoin.joinDigest } ]
		: [ { leaseId: DESTINATION_LEASE_ID, completionJoinId: 'destination-active-lifetime', completionJoinDigest: 'sha256:destination-active-lifetime' } ];
	return {
		allocationId: `quality-${ fields.signalId }-${ fields.generationRole }-allocation-43`,
		resourceId,
		owner: signal.owner,
		semantic: 'solver-state',
		residency,
		deviceBackendResourceGenerations: generationTuple( route, signal, resourceGeneration ),
		encodingFormatAndExtent: {
			generationRole: fields.generationRole,
			signalId: fields.signalId,
			stateEquationId: fields.stateEquationId,
			stateVersion: fields.stateVersion,
			format: fields.format,
			activeDomainId: 'coastal-active-domain-v42',
			componentLayouts,
			frameSlotSubresources
		},
		elementCountStrideAndLogicalBytes: {
			componentLayouts: api.clone( componentLayouts ),
			elementCount: api.evidence( fields.logicalBytes, 'byte-element', 'Derived', `${ fields.signalId }-${ fields.generationRole }-packed-allocation-layout` ),
			stride: api.evidence( 1, 'byte-per-byte-element', 'Derived', `${ fields.signalId }-${ fields.generationRole }-packed-allocation-layout` ),
			logicalBytes: api.evidence( fields.logicalBytes, 'byte', 'Derived', `${ fields.signalId }-${ fields.generationRole }-quality-layout` )
		},
		physicalAllocatedBytes: api.evidence( physicalBytes, 'byte', 'Measured', 'quality-allocation-admission-trace' ),
		liveInterval: { begin: 'quality-prepare-43', commitBoundary: 'quality-step-boundary-43', endExclusive: fields.generationRole === 'source' ? 'all-source-consumers-completed' : 'destination-state-retirement', coversQualityCommit: true },
		framesInFlightMultiplier: api.evidence( fields.framesInFlight, 'frame', 'Gated', 'route-frame-cohort-admission' ),
		sharingScope: 'context-shared',
		targetViewKeys: fields.targets,
		workKey: 'quality-migration-work',
		aliasGroupAndNonoverlapProof: api.absent( 'not-applicable', signal.owner ),
		leaseIdsAndCompletionJoins,
		evidenceRef: 'sha256:quality-allocation-admission-trace-43'
	};

}

function scratchMemoryAllocation( api, route, targets ) {

	const signal = signalById( route, 'water-surface-state' );
	const resourceId = 'quality-migration-scratch-resource-43';
	const residency = allocationResidency( api, signal, 'destination', resourceId );
	return {
		allocationId: 'quality-migration-scratch-allocation-43',
		resourceId,
		owner: QUALITY_CONTEXT_OWNER,
		semantic: 'named',
		residency,
		deviceBackendResourceGenerations: generationTuple( route, signal, 'quality-migration-scratch-generation-43' ),
		encodingFormatAndExtent: {
			generationRole: 'scratch',
			signalId: 'quality-state-migration',
			stateEquationId: 'quality-transition-map',
			stateVersion: QUALITY_TRANSITION_ID,
			format: 'bounded-pairwise-reduction-and-prefix-scan-scratch-v1',
			activeDomainId: 'coastal-active-domain-v42',
			componentLayouts: [ { componentId: 'pairwise-conservation-reduction-and-sparse-prefix-scan', elementCount: api.evidence( MIGRATION_SCRATCH_LOGICAL_BYTES / 16, 'vec4f', 'Derived', 'quality-migration-scratch-layout' ), stride: api.evidence( 16, 'byte', 'Derived', 'quality-migration-scratch-layout' ), logicalBytes: api.evidence( MIGRATION_SCRATCH_LOGICAL_BYTES, 'byte', 'Derived', 'quality-migration-scratch-layout' ) } ],
			frameSlotSubresources: [ { slotIndex: api.evidence( 0, 'slot', 'Derived', 'single-event-migration-scratch' ), byteOffset: api.evidence( 0, 'byte', 'Derived', 'single-event-migration-scratch' ), byteLength: api.evidence( MIGRATION_SCRATCH_LOGICAL_BYTES, 'byte', 'Derived', 'single-event-migration-scratch' ) } ]
		},
		elementCountStrideAndLogicalBytes: {
			componentLayouts: [ { componentId: 'pairwise-conservation-reduction-and-sparse-prefix-scan', elementCount: api.evidence( MIGRATION_SCRATCH_LOGICAL_BYTES / 16, 'vec4f', 'Derived', 'quality-migration-scratch-layout' ), stride: api.evidence( 16, 'byte', 'Derived', 'quality-migration-scratch-layout' ), logicalBytes: api.evidence( MIGRATION_SCRATCH_LOGICAL_BYTES, 'byte', 'Derived', 'quality-migration-scratch-layout' ) } ],
			elementCount: api.evidence( MIGRATION_SCRATCH_LOGICAL_BYTES / 16, 'vec4f', 'Derived', 'quality-migration-scratch-layout' ),
			stride: api.evidence( 16, 'byte', 'Derived', 'quality-migration-scratch-layout' ),
			logicalBytes: api.evidence( MIGRATION_SCRATCH_LOGICAL_BYTES, 'byte', 'Derived', 'quality-migration-scratch-layout' )
		},
		physicalAllocatedBytes: api.evidence( MIGRATION_SCRATCH_LOGICAL_BYTES, 'byte', 'Measured', 'quality-allocation-admission-trace' ),
		liveInterval: { begin: 'after-quality-allocation-admission', commitBoundary: 'quality-step-boundary-43', endExclusive: 'atomic-quality-publication-complete', coversQualityCommit: true },
		framesInFlightMultiplier: api.evidence( 1, 'event-allocation', 'Gated', 'one-admitted-migration-at-a-time' ),
		sharingScope: 'context-shared',
		targetViewKeys: targets,
		workKey: 'quality-migration-work',
		aliasGroupAndNonoverlapProof: api.absent( 'not-applicable', QUALITY_CONTEXT_OWNER ),
		leaseIdsAndCompletionJoins: [ { leaseId: 'quality-migration-scratch-lease', completionJoinId: 'quality-map-dispatch-completion', completionJoinDigest: 'sha256:quality-map-dispatch-completion-43' } ],
		evidenceRef: 'sha256:quality-allocation-admission-trace-43'
	};

}

function memoryLifetimeDagDigest( api, allocations ) {

	return api.digest( allocations.map( ( allocation ) => ( {
		allocationId: allocation.allocationId,
		resourceId: allocation.resourceId,
		deviceBackendResourceGenerations: allocation.deviceBackendResourceGenerations,
		liveInterval: allocation.liveInterval,
		frameSlotSubresources: allocation.encodingFormatAndExtent.frameSlotSubresources,
		leaseIdsAndCompletionJoins: allocation.leaseIdsAndCompletionJoins
	} ) ) );

}

function migrationMemoryLedger( api, route, interval, targets, retirementJoin, sourceState, destinationState, framesInFlight ) {

	const allocations = [ ...allocationSpecs( sourceState, destinationState ).map( ( spec ) => memoryAllocation( api, route, { ...spec, targets, retirementJoin, framesInFlight } ) ), scratchMemoryAllocation( api, route, targets ) ];
	const logicalBytes = allocations.reduce( ( total, allocation ) => total + quantityValue( allocation.elementCountStrideAndLogicalBytes.logicalBytes, `${ allocation.allocationId }.logicalBytes` ), 0 );
	const physicalBytes = allocations.reduce( ( total, allocation ) => total + quantityValue( allocation.physicalAllocatedBytes, `${ allocation.allocationId }.physicalAllocatedBytes` ), 0 );
	return {
		memoryLedgerId: MIGRATION_LEDGER_ID,
		contextId: route.physicsContext.contextId,
		measurementInterval: api.clone( interval ),
		qualityEpoch: SOURCE_QUALITY_EPOCH,
		category: 'migration-overlap',
		allocations,
		logicalBytesByResidency: { gpu: api.evidence( logicalBytes, 'byte', 'Derived', 'all-source-and-destination-logical-layouts' ) },
		physicalAllocatedBytesByResidency: { gpu: api.evidence( physicalBytes, 'byte', 'Measured', 'quality-allocation-admission-trace' ) },
		maximumSimultaneouslyLiveBytes: { gpu: api.evidence( physicalBytes, 'byte', 'Measured', 'quality-allocation-lifetime-sweep-including-frame-cohort-slots' ) },
		sharedBytesByWorkKey: { 'quality-migration-work': api.evidence( logicalBytes, 'byte', 'Derived', 'all-source-and-destination-logical-layouts' ) },
		perViewBytesByTargetView: Object.fromEntries( targets.map( ( key ) => [ key, api.evidence( 0, 'byte', 'Derived', 'context-shared-quality-state' ) ] ) ),
		lifetimeDagDigest: memoryLifetimeDagDigest( api, allocations ),
		allocationTraceRef: 'sha256:quality-allocation-admission-trace-43',
		status: 'measured'
	};

}

function activeExternalAdapterForEquation( route, stateEquationId ) {

	const matches = routeExternalAdapterRecords( route ).filter( ( adapter ) => adapter.ownedStateEquations.includes( stateEquationId ) );
	assert.equal( matches.length, 1, `quality migration requires exactly one route-owned external adapter for ${ stateEquationId }` );
	return matches[ 0 ];

}

function completedDependency( api, route, fields ) {

	const completion = {
		completionId: fields.completionId,
		dependencyId: fields.dependencyId,
		coordinationAdvanceId: route.physicsGraph.coordinationAdvance.coordinationAdvanceId,
		producerExecutionId: fields.producerExecutionId,
		consumerExecutionId: 'quality-transition-atomic-commit-43',
		payloadAndVersion: fields.payloadAndVersion,
		producerResidency: api.clone( fields.allocation.residency ),
		consumerResidency: api.clone( fields.allocation.residency ),
		resourceIdentityAndSubresource: { resourceId: fields.allocation.resourceId, resourceGeneration: fields.allocation.deviceBackendResourceGenerations.resourceGeneration, subresources: api.clone( fields.allocation.encodingFormatAndExtent.frameSlotSubresources ) },
		accessTransition: fields.accessTransition,
		deviceBackendResourceGenerations: api.clone( fields.allocation.deviceBackendResourceGenerations ),
		producerRelease: { submissionEpoch: fields.submissionEpoch, completionToken: fields.completionToken },
		consumerAcquire: { waitToken: fields.completionToken, firstUse: 'quality-transition-atomic-commit-43' },
		externalFenceOrHostVisibility: api.absent( 'not-applicable', fields.owner ),
		status: 'completed',
		receiptDigest: 'pending'
	};
	completion.receiptDigest = digestRecordWithout( api, completion, 'receiptDigest' );
	return completion;

}

function compactDependencyCompletion( api, completion ) {

	const residencyIdentity = ( residency ) => ( { kind: residency.kind, deviceId: residency.deviceId, queueId: residency.queueId, bindingIdentity: residency.bindingIdentity } );
	return {
		completionId: completion.completionId,
		dependencyId: completion.dependencyId,
		coordinationAdvanceId: completion.coordinationAdvanceId,
		producerExecutionId: completion.producerExecutionId,
		consumerExecutionId: completion.consumerExecutionId,
		payloadAndVersion: api.clone( completion.payloadAndVersion ),
		producerResidencyIdentity: residencyIdentity( completion.producerResidency ),
		consumerResidencyIdentity: residencyIdentity( completion.consumerResidency ),
		resourceIdentityAndSubresource: api.clone( completion.resourceIdentityAndSubresource ),
		accessTransition: completion.accessTransition,
		deviceBackendResourceGenerations: api.clone( completion.deviceBackendResourceGenerations ),
		producerRelease: api.clone( completion.producerRelease ),
		consumerAcquire: api.clone( completion.consumerAcquire ),
		status: completion.status,
		receiptDigest: completion.receiptDigest
	};

}

function compactExternalReceipt( api, receipt ) {

	return {
		receiptId: receipt.receiptId,
		adapterId: receipt.adapterId,
		coordinationAdvanceId: receipt.coordinationAdvanceId,
		externalStepSequence: receipt.externalStepSequence,
		requestedInterval: api.clone( receipt.requestedInterval ),
		actualNativeExecutionIntervals: api.clone( receipt.actualNativeExecutionIntervals ),
		inputStateVersions: api.clone( receipt.inputStateVersions ),
		inputApplicationLedgerIds: api.clone( receipt.inputApplicationLedgerIds ),
		outputPreparedVersions: api.clone( receipt.outputPreparedVersions ),
		emittedInteractionSequenceRanges: api.clone( receipt.emittedInteractionSequenceRanges ),
		dependencyCompletionRefs: api.clone( receipt.dependencyCompletionRefs ),
		status: receipt.status,
		contentDigest: receipt.contentDigest
	};

}

function migrationCompletionBundle( api, route, interval, memoryLedger ) {

	const allocation = ( role, signalId ) => memoryLedger.allocations.find( ( candidate ) => candidate.encodingFormatAndExtent.generationRole === role && candidate.encodingFormatAndExtent.signalId === signalId );
	const waterSource = allocation( 'source', 'water-surface-state' );
	const waterDestination = allocation( 'destination', 'water-surface-state' );
	const bodySource = allocation( 'source', 'rigid-body-state' );
	const bodyDestination = allocation( 'destination', 'rigid-body-state' );
	assert.ok( waterSource && waterDestination && bodySource && bodyDestination, 'quality migration completion cannot resolve its equation-specific allocations' );
	const gpuToken = 'quality-water-map-gpu-completion-token-43';
	const gpuCompletion = completedDependency( api, route, {
		completionId: 'quality-water-map-dependency-completion-43', dependencyId: 'quality-water-map-to-atomic-commit', producerExecutionId: 'quality-water-conservative-map-dispatch-43',
		payloadAndVersion: { source: { signalId: 'water-surface-state', stateVersion: waterSource.encodingFormatAndExtent.stateVersion, resourceGeneration: waterSource.deviceBackendResourceGenerations.resourceGeneration }, destination: { signalId: 'water-surface-state', stateVersion: waterDestination.encodingFormatAndExtent.stateVersion, resourceGeneration: waterDestination.deviceBackendResourceGenerations.resourceGeneration }, mapId: CONSERVATIVE_MAP_ID },
		allocation: waterDestination, accessTransition: 'storage-write-to-atomic-quality-commit-read', submissionEpoch: 'quality-map-submit-43', completionToken: gpuToken, owner: '$threejs-water-optics'
	} );
	const adapter = activeExternalAdapterForEquation( route, 'body-state' );
	const externalReceipt = {
		receiptId: 'quality-external-body-migration-receipt-43',
		adapterId: adapter.adapterId,
		coordinationAdvanceId: route.physicsGraph.coordinationAdvance.coordinationAdvanceId,
		externalStepSequence: 43,
		requestedInterval: api.clone( interval ),
		actualNativeExecutionIntervals: [ api.clone( interval ) ],
		inputStateVersions: [ { signalId: 'rigid-body-state', stateVersion: bodySource.encodingFormatAndExtent.stateVersion } ],
		inputApplicationLedgerIds: [],
		outputPreparedVersions: [ { stateEquationId: 'body-state', signalId: 'rigid-body-state', preparedStateVersion: bodyDestination.encodingFormatAndExtent.stateVersion, resourceGeneration: bodyDestination.deviceBackendResourceGenerations.resourceGeneration, commitTransactionId: QUALITY_TRANSITION_ID, commitGroupId: 'quality-transition-43' } ],
		emittedInteractionSequenceRanges: [],
		dependencyCompletionRefs: [],
		status: 'completed',
		contentDigest: 'pending'
	};
	externalReceipt.contentDigest = digestRecordWithout( api, externalReceipt, 'contentDigest' );
	const externalCompletion = completedDependency( api, route, {
		completionId: 'quality-external-body-dependency-completion-43', dependencyId: 'quality-external-body-to-atomic-commit', producerExecutionId: 'quality-external-body-migration-step-43',
		payloadAndVersion: { adapterId: adapter.adapterId, boundaryRevision: adapter.boundaryRevision, externalReceiptId: externalReceipt.receiptId, externalReceiptDigest: externalReceipt.contentDigest, source: { signalId: 'rigid-body-state', stateVersion: bodySource.encodingFormatAndExtent.stateVersion, resourceGeneration: bodySource.deviceBackendResourceGenerations.resourceGeneration }, destination: { signalId: 'rigid-body-state', stateVersion: bodyDestination.encodingFormatAndExtent.stateVersion, resourceGeneration: bodyDestination.deviceBackendResourceGenerations.resourceGeneration } },
		allocation: bodyDestination, accessTransition: 'external-shared-resource-write-to-atomic-quality-commit-read', submissionEpoch: 'quality-external-step-43', completionToken: externalReceipt.contentDigest, owner: adapter.adapterId
	} );
	return {
		gpuCompletion,
		externalCompletion,
		externalReceipt,
		dependencyRefs: {
			gpu: { dependencyId: gpuCompletion.dependencyId, requiredCompletionVersion: gpuCompletion.receiptDigest },
			external: { dependencyId: externalCompletion.dependencyId, requiredCompletionVersion: externalCompletion.receiptDigest }
		},
		atomicCommitJoin: { requiredCompletionIds: [ gpuCompletion.completionId, externalCompletion.completionId ], requiredReceiptDigests: [ gpuCompletion.receiptDigest, externalCompletion.receiptDigest ], predicate: 'both-equation-migrations-completed-before-atomic-quality-publication' }
	};

}

function migrationTrafficRecords( api, route, interval, targets, memoryLedger, completionRefs ) {

	return memoryLedger.allocations.map( ( allocation ) => {

		const layout = allocation.encodingFormatAndExtent;
		const isSource = layout.generationRole === 'source';
		const isDestination = layout.generationRole === 'destination';
		const migrationAccess = isSource ? 'source-read' : isDestination ? 'destination-write' : 'scratch-read-write';
		const dependencyRef = layout.stateEquationId === 'body-state' ? completionRefs.external : completionRefs.gpu;
		const trafficBytes = quantityValue( allocation.elementCountStrideAndLogicalBytes.logicalBytes, `${ allocation.allocationId }.logicalBytes` ) * ( migrationAccess === 'scratch-read-write' ? 2 : 1 );
		const residencyIdentity = { residencyKind: allocation.residency.kind, deviceId: allocation.residency.deviceId, queueId: allocation.residency.queueId, bindingIdentity: allocation.residency.bindingIdentity };
		return {
			trafficRecordId: `quality-migration-${ layout.signalId }-${ migrationAccess }-43`,
			contextId: route.physicsContext.contextId,
			producer: isSource ? allocation.owner : CONSERVATIVE_MAP_ID,
			consumers: isSource ? [ CONSERVATIVE_MAP_ID ] : isDestination ? [ allocation.owner, QUALITY_CONTEXT_OWNER ] : [ CONSERVATIVE_MAP_ID ],
			direction: 'same-residency',
			resourceIdAndVersion: { resourceId: allocation.resourceId, signalId: layout.signalId, stateEquationId: layout.stateEquationId, stateVersion: layout.stateVersion, resourceGeneration: allocation.deviceBackendResourceGenerations.resourceGeneration, migrationAccess },
			sourceAndDestinationResidency: { source: residencyIdentity, destination: api.clone( residencyIdentity ) },
			deviceBackendResourceGenerations: api.clone( allocation.deviceBackendResourceGenerations ),
			logicalBytesPerOccurrence: api.evidence( trafficBytes, 'byte', 'Derived', migrationAccess === 'scratch-read-write' ? 'one-full-scratch-write-plus-one-full-scratch-read' : 'one-active-frame-slot-migration-access' ),
			physicalBytesPerOccurrence: api.evidence( trafficBytes, 'byte', 'Measured', 'quality-migration-traffic-counters-43' ),
			occurrenceCount: api.evidence( 1, 'occurrence', 'Derived', 'one admitted quality migration per request' ),
			cadenceBasis: 'event-driven',
			dirtyFraction: api.evidence( 1, 'ratio', 'Derived', 'quality migration visits the complete admitted state extent' ),
			measurementInterval: api.clone( interval ),
			accessAndResourceTransition: isSource ? { before: 'source-authoritative-read', after: 'source-remains-authoritative-until-commit', completionDependencyRef: api.clone( dependencyRef ) } : isDestination ? { before: 'destination-provisional-write', after: 'destination-commit-candidate', completionDependencyRef: api.clone( dependencyRef ) } : { before: 'scratch-uninitialized', after: 'scratch-residuals-consumed-by-atomic-commit-gate', completionDependencyRef: api.clone( dependencyRef ) },
			passDispatchOrExternalBoundary: layout.stateEquationId === 'body-state' ? 'route-owned-external-body-quality-migration' : CONSERVATIVE_MAP_ID,
			dependencyRefs: [ { dependencyId: ALLOCATION_ADMISSION_ID, requiredCompletionVersion: `${ ALLOCATION_ADMISSION_ID }/admitted` } ],
			readbackMapBehavior: 'none',
			workKey: 'quality-migration-work',
			sharingScope: 'shared',
			targetViewKeys: targets,
			measuredCountersRef: 'sha256:quality-migration-traffic-counters-43'
		};

	} );

}

function trafficTotals( trafficRecords ) {

	const total = ( records, field ) => records.reduce( ( sum, record ) => sum + quantityValue( record.physicalBytesPerOccurrence, `${ record.trafficRecordId }.physicalBytesPerOccurrence` ) * quantityValue( record.occurrenceCount, `${ record.trafficRecordId }.occurrenceCount` ), 0 );
	const sourceReads = trafficRecords.filter( ( record ) => record.resourceIdAndVersion.migrationAccess === 'source-read' );
	const destinationWrites = trafficRecords.filter( ( record ) => record.resourceIdAndVersion.migrationAccess === 'destination-write' );
	const scratchReadWrites = trafficRecords.filter( ( record ) => record.resourceIdAndVersion.migrationAccess === 'scratch-read-write' );
	return { sourceReadBytes: total( sourceReads ), destinationWriteBytes: total( destinationWrites ), scratchReadWriteBytes: total( scratchReadWrites ), totalBytes: total( trafficRecords ) };

}

function lifetimeAndRetirementPlanDigest( api, targets, framesInFlight, memoryLedger ) {

	return api.digest( {
		affectedTargetsViews: targets,
		framesInFlight,
		memoryLedgerId: memoryLedger.memoryLedgerId,
		lifetimeDagDigest: memoryLedger.lifetimeDagDigest,
		allocations: memoryLedger.allocations.map( ( allocation ) => ( {
			allocationId: allocation.allocationId,
			resourceId: allocation.resourceId,
			deviceBackendResourceGenerations: allocation.deviceBackendResourceGenerations,
			liveInterval: allocation.liveInterval,
			leaseIdsAndCompletionJoins: allocation.leaseIdsAndCompletionJoins
		} ) )
	} );

}

function capacityBreakdown( api, route, memoryLedger ) {

	const bytesForRole = ( role ) => memoryLedger.allocations.filter( ( allocation ) => allocation.encodingFormatAndExtent.generationRole === role ).reduce( ( total, allocation ) => total + quantityValue( allocation.physicalAllocatedBytes, `${ allocation.allocationId }.physicalAllocatedBytes` ), 0 );
	const baselineRouteHotBytes = quantityValue( route.physicsCostLedger.hotState.maximumSimultaneouslyLiveBytes.gpu, 'route baseline hot-state bytes' );
	const sourceAlreadyResidentBytes = bytesForRole( 'source' );
	const incrementalDestinationBytes = bytesForRole( 'destination' );
	const transientScratchBytes = bytesForRole( 'scratch' );
	assert.ok( sourceAlreadyResidentBytes <= baselineRouteHotBytes, 'quality source generation does not fit inside the measured route hot-state baseline it claims to replace' );
	return {
		baselineRouteHotBytes,
		sourceAlreadyResidentBytes,
		incrementalDestinationBytes,
		transientScratchBytes,
		deviceDemandBytes: baselineRouteHotBytes + incrementalDestinationBytes + transientScratchBytes,
		migrationOverlapBytes: sourceAlreadyResidentBytes + incrementalDestinationBytes,
		transitionLedgerPeakBytes: sourceAlreadyResidentBytes + incrementalDestinationBytes + transientScratchBytes
	};

}

function allocationRequest( api, route, targets, framesInFlight, memoryLedger, trafficRecords ) {

	const capacity = capacityBreakdown( api, route, memoryLedger );
	const traffic = trafficTotals( trafficRecords );
	return {
		allocationRequestId: ALLOCATION_REQUEST_ID,
		affectedTargetsViews: targets,
		requestedHotBytesByResidency: { gpu: api.evidence( capacity.incrementalDestinationBytes, 'byte', 'Derived', 'destination-quality-state-layout-times-frame-cohort' ) },
		requestedTransientPeakBytesByResidency: { gpu: api.evidence( capacity.transientScratchBytes, 'byte', 'Derived', 'migration-scratch-allocation-layout' ) },
		migrationOverlapBytesByResidency: { gpu: api.evidence( capacity.migrationOverlapBytes, 'byte', 'Derived', 'simultaneous-source-and-destination-frame-cohort-lifetimes-excluding-separate-scratch' ) },
		requestedBindingsTexturesBuffersAndAttachments: { storageBindings: api.evidence( memoryLedger.allocations.length, 'binding', 'Derived', 'one storage binding per migrated allocation' ) },
		requestedTrafficBytesPerCoordinationIntervalAndSecond: {
			trafficRecords,
			sourceReadBytesPerMigration: api.evidence( traffic.sourceReadBytes, 'byte', 'Derived', 'source-read-traffic-record-sum' ),
			destinationWriteBytesPerMigration: api.evidence( traffic.destinationWriteBytes, 'byte', 'Derived', 'destination-write-traffic-record-sum' ),
			scratchReadWriteBytesPerMigration: api.evidence( traffic.scratchReadWriteBytes, 'byte', 'Derived', 'scratch-read-write-traffic-record-sum' ),
			totalBytesPerMigration: api.evidence( traffic.totalBytes, 'byte', 'Derived', 'all-migration-traffic-record-sum' ),
			steadyPerSecond: api.evidence( 0, 'byte-per-second', 'Derived', 'quality migration is event-driven rather than steady traffic' )
		},
		requestedCpuGpuAndExternalWork: { gpuDispatches: api.evidence( 1, 'dispatch', 'Derived', 'water-map-and-shared-scratch-dispatch' ), cpuTasks: api.evidence( 1, 'task', 'Derived', 'admission-and-atomic-publication-plan' ), externalSteps: api.evidence( 1, 'step', 'Derived', 'route-owned-external-body-state-migration' ) },
		maximumFramesInFlightAndMultiviewMultiplier: { maximumFramesInFlight: api.evidence( framesInFlight, 'frame', 'Gated', 'route-frame-cohort-admission' ), targetViewCount: api.evidence( targets.length, 'target-view', 'Derived', 'request target/view scope' ) },
		thermalPowerEnvelope: {
			status: 'within-gate', evidenceRef: 'sha256:quality-sustained-thermal-trace-43',
			deviceCapacityDemand: {
				baselineRouteHotBytes: api.evidence( capacity.baselineRouteHotBytes, 'byte', 'Measured', 'active-physics-cost-ledger-hot-state-lifetime-sweep' ),
				sourceAlreadyResidentBytes: api.evidence( capacity.sourceAlreadyResidentBytes, 'byte', 'Derived', 'source-allocation-subset-of-active-hot-state' ),
				incrementalDestinationBytes: api.evidence( capacity.incrementalDestinationBytes, 'byte', 'Derived', 'destination-allocation-sum' ),
				transientScratchBytes: api.evidence( capacity.transientScratchBytes, 'byte', 'Derived', 'scratch-allocation-sum' ),
				totalDeviceDemandBytes: api.evidence( capacity.deviceDemandBytes, 'byte', 'Derived', 'baseline-plus-incremental-destination-plus-scratch-without-double-counting-resident-source' )
			}
		},
		lifetimeAndRetirementPlanDigest: lifetimeAndRetirementPlanDigest( api, targets, framesInFlight, memoryLedger )
	};

}

function admissionRequirements( api ) {

	return [
		{ requirementId: 'quality-requirement-physical-error', kind: 'physical-error', bound: api.evidence( 0.02, 'metre', 'Gated', 'coastal-surface-error-contract' ), evidenceRef: 'sha256:quality-migration-convergence-43', failureDisposition: 'hold-current' },
		{ requirementId: 'quality-requirement-conservation', kind: 'conservation', bound: api.evidence( 1e-7, 'ratio', 'Gated', 'inventory-conservation-contract' ), evidenceRef: 'sha256:quality-conservation-proof-43', failureDisposition: 'hold-current' },
		{ requirementId: 'quality-requirement-memory', kind: 'memory', bound: api.evidence( DEVICE_CAPACITY_BYTES, 'byte', 'Gated', 'named-fixture-device-allocation-gate-not-a-portable-mobile-budget' ), evidenceRef: 'sha256:quality-allocation-admission-trace-43', failureDisposition: 'hold-current' },
		{ requirementId: 'quality-requirement-safe-boundary', kind: 'safe-boundary', bound: 'after committed coordination advance with no live provisional state', evidenceRef: 'sha256:coordination-commit-receipt-42', failureDisposition: 'hold-current' }
	];

}

function resetAction( api, targetViewKey ) {

	const [ presentationTargetId, viewId ] = targetViewKey.split( '/' );
	return {
		actionId: `quality-reset-${ presentationTargetId }-${ viewId }-43`,
		owner: '$threejs-image-pipeline',
		historyKey: `${ targetViewKey }/quality-dependent-history`,
		presentationTargetId,
		viewId,
		causeEpochs: [ SOURCE_QUALITY_EPOCH, DESTINATION_QUALITY_EPOCH ],
		affectedRegion: { kind: 'full-frame', fullFrame: { reason: 'quality migration changes discretization and resource generation' }, entitySet: api.absent( 'not-applicable', '$threejs-image-pipeline' ), physicsBounds: api.absent( 'not-applicable', '$threejs-image-pipeline' ), screenMask: api.absent( 'not-applicable', '$threejs-image-pipeline' ) },
		policy: 'reset',
		capabilityGate: 'reset before any destination-generation temporal read',
		dependencies: [ ALLOCATION_ADMISSION_ID, CONSERVATIVE_MAP_ID ],
		executionStrategy: 'clear destination history after atomic quality publication and before render-plan admission',
		resourceLeaseId: api.absent( 'not-applicable', '$threejs-image-pipeline' ),
		inputHistoryLeaseRef: api.absent( 'unavailable', '$threejs-image-pipeline' ),
		expectedInputHistoryGeneration: `history-${ SOURCE_QUALITY_EPOCH}`,
		expectedOutputHistoryGeneration: `history-${ DESTINATION_QUALITY_EPOCH}`,
		expectedPolicyResult: 'destination history generation starts empty at the new quality epoch'
	};

}

function buildQualityStateMap( api, route, sourceState, destinationState, interval, migrationCompletion ) {

	const sourceInventory = sourceState.stateVariablesAndInventories;
	const destinationInventory = destinationState.stateVariablesAndInventories;
	const stableIdRngEventAndLedgerMap = {
		stableEntityGenerations: { source: sourceInventory.stableEntityGenerations, destination: destinationInventory.stableEntityGenerations, operator: 'identity' },
		rngStreams: {
			'water-subgrid-stream': {
				sourceStreamId: sourceState.stochasticStreamsAndCursors[ 'water-subgrid-stream' ].streamId,
				destinationStreamId: destinationState.stochasticStreamsAndCursors[ 'water-subgrid-stream' ].streamId,
				sourceSeedDigest: sourceState.stochasticStreamsAndCursors[ 'water-subgrid-stream' ].seedDigest,
				destinationSeedDigest: destinationState.stochasticStreamsAndCursors[ 'water-subgrid-stream' ].seedDigest,
				sourceCursor: sourceState.stochasticStreamsAndCursors[ 'water-subgrid-stream' ].cursor,
				destinationCursor: destinationState.stochasticStreamsAndCursors[ 'water-subgrid-stream' ].cursor,
				operator: 'copy-exact'
			}
		},
		eventCursors: {
			'body-water-exchange': { source: sourceInventory.eventQueues[ 'body-water-exchange' ], destination: destinationInventory.eventQueues[ 'body-water-exchange' ], operator: 'copy-exact' }
		},
		exactOnceLedgers: {
			'body-water-exchange': { source: sourceInventory.exactOnceLedgers[ 'body-water-exchange' ], destination: destinationInventory.exactOnceLedgers[ 'body-water-exchange' ], operator: 'copy-exact' }
		}
	};
	const residuals = Object.fromEntries( Object.keys( sourceInventory.conservedInventories ).map( ( commodityId ) => [ commodityId, api.evidence( 0, sourceInventory.conservedInventories[ commodityId ].unit, 'Measured', 'quality-migration-conservation-reduction-43' ) ] ) );
	return {
		mapId: CONSERVATIVE_MAP_ID,
		contextId: route.physicsContext.contextId,
		sourceQualityStateId: sourceState.qualityStateId,
		destinationQualityStateId: destinationState.qualityStateId,
		sourceStateVersions: api.clone( sourceInventory.stateVersions ),
		destinationProvisionalVersions: api.clone( destinationInventory.migrationProvisionalStateVersions ),
		restrictionOrProlongationOperator: {
			operatorId: 'finite-volume-area-weighted-restriction-v1', kind: 'conservative-restriction', sourceGridId: sourceState.discretizationAndActiveDomain.gridId, destinationGridId: destinationState.discretizationAndActiveDomain.gridId, executionOrder: 'fixed cell-ID order with pairwise reductions',
			perStateEquationExecution: {
				'water-state': { owner: '$threejs-water-optics', executionKind: 'gpu-same-queue-dispatch', completionId: migrationCompletion.gpuCompletion.completionId, receiptDigest: migrationCompletion.gpuCompletion.receiptDigest },
				'body-state': { owner: activeExternalAdapterForEquation( route, 'body-state' ).adapterId, executionKind: 'route-owned-external-adapter-step', completionId: migrationCompletion.externalCompletion.completionId, receiptDigest: migrationCompletion.externalCompletion.receiptDigest, externalReceiptId: migrationCompletion.externalReceipt.receiptId, externalReceiptDigest: migrationCompletion.externalReceipt.contentDigest }
			}
		},
		sourceMeasure: migrationSupport( api, route, sourceState.discretizationAndActiveDomain.gridId, REPRESENTED_AREA_SQUARE_METRES ),
		destinationMeasure: migrationSupport( api, route, destinationState.discretizationAndActiveDomain.gridId, REPRESENTED_AREA_SQUARE_METRES ),
		conservedCommodities: Object.keys( sourceInventory.conservedInventories ).sort(),
		positivityAndConstraintPreservation: [ { gate: 'water-depth-nonnegative', status: 'accepted', minimum: api.evidence( 0, 'metre', 'Gated', 'wet-dry-positivity-contract' ) }, { gate: 'finite-rigid-body-state', status: 'accepted' } ],
		boundaryAndActiveDomainTreatment: 'identical active-domain mask; boundary flux inventory is transferred before restriction',
		introducedFilter: migrationFilter( api ),
		stableIdRngEventAndLedgerMap,
		contactWarmStartMap: { sourceStateVersion: 'contact-warm-start-v42', destinationStateVersion: 'contact-warm-start-v42', operator: 'feature-ID-preserving-map', invalidatedManifolds: [] },
		residuals,
		errorPropagationLedgerRef: ERROR_LEDGER_ID,
		acceptanceGate: { status: 'accepted', conservationResidualDigest: 'sha256:quality-conservation-residuals-43', positivityGate: 'accepted', errorGate: 'accepted', evaluationInterval: api.clone( interval ) }
	};

}

function buildErrorLedger( api, route, sourceState, destinationState, interval ) {

	return {
		ledgerId: ERROR_LEDGER_ID,
		contextId: route.physicsContext.contextId,
		outputSignalOrInteractionId: 'quality-state-migration',
		outputStateVersion: DESTINATION_QUALITY_EPOCH,
		evaluationInterval: api.clone( interval ),
		inputErrors: api.clone( sourceState.physicalAndVisualErrorBounds ),
		transformsFiltersInterpolations: [ CONSERVATIVE_MAP_ID, 'quality-migration-area-weighted-restriction-filter-v1' ],
		correlationAssumptions: 'source discretization and restriction truncation use bounded-adversarial combination',
		operatorOrGainBounds: [ api.evidence( 1, 'ratio', 'Gated', 'unit-DC-conservative-restriction' ) ],
		modeledApproximationTerms: [ api.evidence( 0.009, 'metre', 'Derived', 'destination-cell-width-times-validated-order-bound' ) ],
		numericalTerms: [ api.evidence( 0.001, 'metre', 'Measured', 'quality-migration-convergence-43' ) ],
		combinationRule: 'triangle bound no larger than destination signed-off error',
		outputError: api.clone( destinationState.physicalAndVisualErrorBounds[ 0 ] ),
		acceptanceGate: { status: 'accepted', bound: api.clone( destinationState.physicalAndVisualErrorBounds[ 0 ].boundOrStatistic ) },
		provenance: { transitionId: QUALITY_TRANSITION_ID, mapId: CONSERVATIVE_MAP_ID, traceRef: 'sha256:quality-migration-convergence-43' }
	};

}

function aggregateCostAllocation( api, route, role, allocations, targets ) {

	assert.ok( allocations.length > 0, `quality cost projection has no ${ role } allocations` );
	const logicalBytes = allocations.reduce( ( total, allocation ) => total + quantityValue( allocation.elementCountStrideAndLogicalBytes.logicalBytes, `${ allocation.allocationId }.logicalBytes` ), 0 );
	const physicalBytes = allocations.reduce( ( total, allocation ) => total + quantityValue( allocation.physicalAllocatedBytes, `${ allocation.allocationId }.physicalAllocatedBytes` ), 0 );
	const residency = api.clone( allocations[ 0 ].residency );
	residency.bindingIdentity = `quality-migration-${ role }-resource-set-43`;
	const generationAuthority = routeGpuGenerationAuthority( route );
	return {
		allocationId: `quality-migration-${ role }-cost-projection-allocation-43`,
		resourceId: `quality-migration-${ role }-resource-set-43`,
		owner: QUALITY_CONTEXT_OWNER,
		semantic: 'named',
		residency,
		deviceBackendResourceGenerations: {
			deviceId: residency.deviceId,
			backendGeneration: generationAuthority.backendGeneration,
			deviceLossGeneration: generationAuthority.deviceLossGeneration,
			resourceGeneration: `quality-migration-${ role }-resource-set-generation-43`,
			constituentGenerationTuples: allocations.map( ( allocation ) => api.clone( allocation.deviceBackendResourceGenerations ) )
		},
		encodingFormatAndExtent: { generationRole: role, format: 'equation-specific-resource-set-projection-v1', frameSlotSubresources: allocations.flatMap( ( allocation ) => allocation.encodingFormatAndExtent.frameSlotSubresources.map( ( slot ) => ( { allocationId: allocation.allocationId, signalId: allocation.encodingFormatAndExtent.signalId, ...api.clone( slot ) } ) ) ), constituentAllocations: allocations.map( ( allocation ) => ( { allocationId: allocation.allocationId, resourceId: allocation.resourceId, signalId: allocation.encodingFormatAndExtent.signalId, stateEquationId: allocation.encodingFormatAndExtent.stateEquationId, stateVersion: allocation.encodingFormatAndExtent.stateVersion, physicalAllocatedBytes: api.clone( allocation.physicalAllocatedBytes ) } ) ) },
		elementCountStrideAndLogicalBytes: { elementCount: api.evidence( logicalBytes, 'byte-element', 'Derived', `quality-${ role }-cost-projection-layout` ), stride: api.evidence( 1, 'byte-per-byte-element', 'Derived', `quality-${ role }-cost-projection-layout` ), logicalBytes: api.evidence( logicalBytes, 'byte', 'Derived', `quality-${ role }-cost-projection-layout` ) },
		physicalAllocatedBytes: api.evidence( physicalBytes, 'byte', 'Measured', 'quality-allocation-admission-trace' ),
		liveInterval: { begin: 'quality-prepare-43', commitBoundary: 'quality-step-boundary-43', endExclusive: role === 'source' ? 'all-source-consumers-completed' : 'destination-state-retirement', coversQualityCommit: true },
		framesInFlightMultiplier: api.clone( allocations[ 0 ].framesInFlightMultiplier ),
		sharingScope: 'context-shared',
		targetViewKeys: targets,
		workKey: 'physics-shared-work',
		aliasGroupAndNonoverlapProof: api.absent( 'not-applicable', QUALITY_CONTEXT_OWNER ),
		leaseIdsAndCompletionJoins: [ ...new Map( allocations.flatMap( ( allocation ) => allocation.leaseIdsAndCompletionJoins ).map( ( ref ) => [ canonicalJson( ref ), api.clone( ref ) ] ) ).values() ],
		evidenceRef: 'sha256:quality-allocation-admission-trace-43'
	};

}

function projectedMemoryLedger( api, route, category, allocations, targets ) {

	const logicalBytes = allocations.reduce( ( total, allocation ) => total + quantityValue( allocation.elementCountStrideAndLogicalBytes.logicalBytes, `${ allocation.allocationId }.logicalBytes` ), 0 );
	const physicalBytes = allocations.reduce( ( total, allocation ) => total + quantityValue( allocation.physicalAllocatedBytes, `${ allocation.allocationId }.physicalAllocatedBytes` ), 0 );
	return {
		memoryLedgerId: `quality-${ category }-cost-projection-ledger-43`,
		contextId: route.physicsContext.contextId,
		measurementInterval: api.clone( route.physicsCostLedger.measurementInterval ),
		qualityEpoch: SOURCE_QUALITY_EPOCH,
		category,
		allocations,
		logicalBytesByResidency: { gpu: api.evidence( logicalBytes, 'byte', 'Derived', `quality-${ category }-cost-projection-layout` ) },
		physicalAllocatedBytesByResidency: { gpu: api.evidence( physicalBytes, 'byte', 'Measured', 'quality-allocation-admission-trace' ) },
		maximumSimultaneouslyLiveBytes: { gpu: api.evidence( physicalBytes, 'byte', 'Measured', 'quality-allocation-lifetime-sweep-including-frame-slots' ) },
		sharedBytesByWorkKey: { 'physics-shared-work': api.evidence( logicalBytes, 'byte', 'Derived', `quality-${ category }-cost-projection-layout` ) },
		perViewBytesByTargetView: Object.fromEntries( targets.map( ( target ) => [ target, api.evidence( 0, 'byte', 'Derived', 'context-shared-quality-migration' ) ] ) ),
		lifetimeDagDigest: memoryLifetimeDagDigest( api, allocations ),
		allocationTraceRef: 'sha256:quality-allocation-admission-trace-43',
		status: 'measured'
	};

}

function projectQualityMigrationIntoCostLedger( api, route, memoryLedger, trafficRecords, targets ) {

	const cost = route.physicsCostLedger;
	const byRole = ( role ) => memoryLedger.allocations.filter( ( allocation ) => allocation.encodingFormatAndExtent.generationRole === role );
	const sourceProjection = aggregateCostAllocation( api, route, 'source', byRole( 'source' ), targets );
	const destinationProjection = aggregateCostAllocation( api, route, 'destination', byRole( 'destination' ), targets );
	const scratchProjection = api.clone( byRole( 'scratch' )[ 0 ] );
	scratchProjection.allocationId = 'quality-migration-scratch-cost-projection-allocation-43';
	scratchProjection.workKey = 'physics-shared-work';
	cost.migrationOverlap = projectedMemoryLedger( api, route, 'migration-overlap', [ sourceProjection, destinationProjection ], targets );
	cost.peakTransient = projectedMemoryLedger( api, route, 'peak-transient', [ scratchProjection ], targets );
	const costTraffic = trafficRecords.map( ( traffic ) => {

		const projected = api.clone( traffic );
		projected.trafficRecordId = `${ traffic.trafficRecordId }-cost-trace`;
		projected.measurementInterval = api.clone( cost.measurementInterval );
		projected.occurrenceCount = api.evidence( 1, 'occurrence', 'Measured', 'quality-allocation-admission-trace' );
		projected.workKey = 'physics-shared-work';
		return projected;

	} );
	cost.uploadsCopiesMaps = [ ...cost.uploadsCopiesMaps.filter( ( traffic ) => ! traffic.trafficRecordId.endsWith( '-cost-trace' ) ), ...costTraffic ];
	for ( const traffic of costTraffic ) cost.cadenceTraceTotals.trafficOccurrenceAndLogicalByteTotals[ traffic.trafficRecordId ] = {
		occurrenceCount: api.clone( traffic.occurrenceCount ),
		logicalByteTotal: api.evidence( quantityValue( traffic.logicalBytesPerOccurrence, `${ traffic.trafficRecordId }.logicalBytesPerOccurrence` ), 'byte', 'Derived', 'one-event-occurrence-times-logical-bytes' )
	};
	const sharedAttribution = cost.workAttribution.find( ( row ) => row.workKey === 'physics-shared-work' );
	assert.ok( sharedAttribution, 'quality cost projection cannot resolve the route shared-work attribution' );
	sharedAttribution.trafficRecordIds = cost.uploadsCopiesMaps.map( ( traffic ) => traffic.trafficRecordId );
	sharedAttribution.memoryAllocationIds = [ ...cost.hotState.allocations, ...cost.peakTransient.allocations, ...cost.migrationOverlap.allocations ].map( ( allocation ) => allocation.allocationId );
	sharedAttribution.attributionDigest = digestRecordWithout( api, sharedAttribution, 'attributionDigest' );
	if ( ! cost.measurementProtocolRefs.includes( 'sha256:quality-allocation-admission-trace-43' ) ) cost.measurementProtocolRefs.push( 'sha256:quality-allocation-admission-trace-43' );
	const memoryGate = cost.composedGateSet.migrationOverlapBytes;
	memoryGate.value = DEVICE_CAPACITY_BYTES;
	memoryGate.source = 'named-fixture-device-allocation-gate-not-a-portable-mobile-budget';
	cost.cadenceTraceTotals.exactTotalsDigest = digestRecordWithout( api, cost.cadenceTraceTotals, 'exactTotalsDigest' );

}

/**
 * Attach one complete admitted physical-quality migration to the route. All
 * records needed by validation remain in route-owned ABI inventories.
 */
export function buildQualityTransitionBundle( h, route ) {

	const api = qualityApi( h );
	assert.ok( route?.physicsContext && route?.physicsGraph && route?.physicsCostLedger, 'quality fixture requires the canonical physical route, graph, and cost ledger' );
	const targets = targetViewKeys( route );
	const interval = qualityInterval( api, route );
	const commitInstant = api.clone( interval.endExclusive );
	const sourceState = qualityState( api, route, { qualityStateId: SOURCE_QUALITY_STATE_ID, qualityEpoch: SOURCE_QUALITY_EPOCH, gridId: 'coastal-grid-full-v3', cellCount: SOURCE_ACTIVE_CELL_COUNT, minimumCellWidthMetres: 0.5, surfaceErrorMetres: 0.01, stateVersionSuffix: '42', presentationRepresentationId: 'coastal-displacement-full-v3' } );
	const destinationState = qualityState( api, route, { qualityStateId: DESTINATION_QUALITY_STATE_ID, qualityEpoch: DESTINATION_QUALITY_EPOCH, gridId: 'coastal-grid-budgeted-v4', cellCount: DESTINATION_ACTIVE_CELL_COUNT, minimumCellWidthMetres: 1, surfaceErrorMetres: 0.02, stateVersionSuffix: '43-provisional', presentationRepresentationId: 'coastal-displacement-budgeted-v4' } );
	const framesInFlight = configuredFramesInFlight( route, targets );
	const completion = consumerCompletionJoin( api, route, targets, sourceState );
	const retirementJoin = completion.join;
	const memoryLedger = migrationMemoryLedger( api, route, interval, targets, retirementJoin, sourceState, destinationState, framesInFlight );
	const migrationCompletion = migrationCompletionBundle( api, route, interval, memoryLedger );
	const scratchAllocation = memoryLedger.allocations.find( ( allocation ) => allocation.encodingFormatAndExtent.generationRole === 'scratch' );
	scratchAllocation.leaseIdsAndCompletionJoins = [ { leaseId: 'quality-migration-scratch-lease', completionJoinId: migrationCompletion.gpuCompletion.completionId, completionJoinDigest: migrationCompletion.gpuCompletion.receiptDigest } ];
	memoryLedger.lifetimeDagDigest = memoryLifetimeDagDigest( api, memoryLedger.allocations );
	const trafficRecords = migrationTrafficRecords( api, route, interval, targets, memoryLedger, migrationCompletion.dependencyRefs );
	const requestedAllocation = allocationRequest( api, route, targets, framesInFlight, memoryLedger, trafficRecords );
	const overlapBytes = quantityValue( requestedAllocation.migrationOverlapBytesByResidency.gpu, 'quality source/destination migration overlap bytes' );
	const requestEvidence = [
		api.evidence( 13.8, 'millisecond', 'Measured', 'mobile-sustained-quality-controller-trace-43' ),
		api.evidence( overlapBytes, 'byte', 'Derived', 'quality-source-plus-destination-frame-cohort-layouts' )
	];
	const protectedInvariants = [ 'conserved-inventories', 'exact-once-interaction-application', 'stable-entity-generations', 'stochastic-stream-identity', 'event-cursor-continuity', 'signed-off-surface-error' ];
	const requirements = admissionRequirements( api );
	const request = {
		requestId: QUALITY_REQUEST_ID,
		requesterId: 'shared-render-quality-governor',
		requestSequence: 43,
		observedInterval: api.clone( interval ),
		affectedTargetsViews: targets,
		pressureClass: 'gpu',
		requestedDirection: 'reduce-cost',
		rankedCandidateControls: [ 'coastal-water-grid-density' ],
		evidenceRecords: requestEvidence,
		protectedInvariants,
		latencyOrDeadlineGate: api.duration( 0.05, 'quality-request-deadline' ),
		requestedAllocation,
		admissionRequirements: requirements
	};
	const requestAdmission = {
		admissionId: REQUEST_ADMISSION_ID,
		requestId: request.requestId,
		coordinatorId: QUALITY_CONTEXT_OWNER,
		currentQualityStateId: sourceState.qualityStateId,
		currentQualityEpoch: sourceState.qualityEpoch,
		selectedCandidateQualityStateId: destinationState.qualityStateId,
		hysteresisAndMinimumResidenceResults: [ { gate: 'downgrade-persistence', status: 'accepted', evidenceRef: 'sha256:mobile-sustained-quality-controller-trace-43' }, { gate: 'minimum-residence', status: 'accepted', evidenceRef: 'sha256:quality-residence-trace-43' } ],
		admissionRequirementResults: requirements.map( ( requirement ) => ( { requirementId: requirement.requirementId, status: 'accepted', evidenceRef: requirement.evidenceRef } ) ),
		safeCommitBoundary: { kind: 'instant', instant: api.clone( commitInstant ), interval: api.absent( 'not-applicable', QUALITY_CONTEXT_OWNER ) },
		allocationRequestDigest: api.digest( requestedAllocation ),
		status: 'admitted',
		reason: { code: 'all-hysteresis-resource-conservation-and-boundary-gates-accepted' }
	};
	const capacity = capacityBreakdown( api, route, memoryLedger );
	const storageBindingLimit = route.physicsCostLedger.bindingAndDeviceLimits.find( ( limit ) => limit.limit === 'storage-bindings' );
	assert.ok( storageBindingLimit, 'quality allocation requires the active target storage-binding limit' );
	const allocationAdmission = {
		allocationAdmissionId: ALLOCATION_ADMISSION_ID,
		allocationRequestId: requestedAllocation.allocationRequestId,
		transitionId: QUALITY_TRANSITION_ID,
		allocatorOwner: 'route-resource-allocator',
		targetDeviceBackendGenerations: memoryLedger.allocations.map( ( allocation ) => api.clone( allocation.deviceBackendResourceGenerations ) ),
		grantedBytesByResidencyAndLifetime: {
			gpuMigrationOverlap: api.clone( requestedAllocation.migrationOverlapBytesByResidency.gpu ),
			gpuDestinationHot: api.clone( requestedAllocation.requestedHotBytesByResidency.gpu ),
			gpuTransientScratch: api.clone( requestedAllocation.requestedTransientPeakBytesByResidency.gpu ),
			gpuTransitionLedgerPeak: api.clone( memoryLedger.maximumSimultaneouslyLiveBytes.gpu ),
			gpuTotalDeviceDemand: api.evidence( capacity.deviceDemandBytes, 'byte', 'Derived', 'measured-baseline-plus-incremental-destination-plus-scratch' )
		},
		grantedBindingsTexturesBuffersAndAttachments: { storageBindings: api.clone( requestedAllocation.requestedBindingsTexturesBuffersAndAttachments.storageBindings ) },
		grantedTrafficAndWorkEnvelope: {
			trafficRecordIds: trafficRecords.map( ( record ) => record.trafficRecordId ),
			sourceReadBytesPerMigration: api.clone( requestedAllocation.requestedTrafficBytesPerCoordinationIntervalAndSecond.sourceReadBytesPerMigration ),
			destinationWriteBytesPerMigration: api.clone( requestedAllocation.requestedTrafficBytesPerCoordinationIntervalAndSecond.destinationWriteBytesPerMigration ),
			scratchReadWriteBytesPerMigration: api.clone( requestedAllocation.requestedTrafficBytesPerCoordinationIntervalAndSecond.scratchReadWriteBytesPerMigration ),
			totalBytesPerMigration: api.clone( requestedAllocation.requestedTrafficBytesPerCoordinationIntervalAndSecond.totalBytesPerMigration ),
			gpuDispatches: api.clone( requestedAllocation.requestedCpuGpuAndExternalWork.gpuDispatches ),
			externalSteps: api.clone( requestedAllocation.requestedCpuGpuAndExternalWork.externalSteps )
		},
		allocationLeaseIds: [ SOURCE_LEASE_ID, DESTINATION_LEASE_ID, 'quality-migration-scratch-lease' ],
		simultaneousOldNewPeakProof: api.clone( memoryLedger ),
		limitHeadroomAndThermalGateResults: [
			{ gate: 'gpu-allocation-capacity', demand: api.evidence( capacity.deviceDemandBytes, 'byte', 'Derived', 'measured-baseline-plus-incremental-destination-plus-scratch' ), baselineRouteHotBytes: api.evidence( capacity.baselineRouteHotBytes, 'byte', 'Measured', 'active-physics-cost-ledger-hot-state-lifetime-sweep' ), sourceAlreadyResidentBytes: api.evidence( capacity.sourceAlreadyResidentBytes, 'byte', 'Derived', 'source-allocation-subset-of-active-hot-state' ), incrementalDestinationBytes: api.evidence( capacity.incrementalDestinationBytes, 'byte', 'Derived', 'destination-allocation-sum' ), transientScratchBytes: api.evidence( capacity.transientScratchBytes, 'byte', 'Derived', 'scratch-allocation-sum' ), requiredHeadroom: api.evidence( REQUIRED_HEADROOM_BYTES, 'byte', 'Gated', 'named-fixture-device-headroom-gate-not-a-portable-mobile-budget' ), capacity: api.evidence( DEVICE_CAPACITY_BYTES, 'byte', 'Measured', 'named-fixture-device-initialized-adapter-allocation-probe' ), status: 'accepted' },
			{ gate: 'storage-binding-capacity', demand: api.clone( requestedAllocation.requestedBindingsTexturesBuffersAndAttachments.storageBindings ), requiredHeadroom: api.clone( storageBindingLimit.requiredHeadroom ), capacity: api.clone( storageBindingLimit.deviceLimit ), status: 'accepted' },
			{ gate: 'sustained-thermal-state', status: 'accepted', evidenceRef: 'sha256:quality-sustained-thermal-trace-43' }
		],
		retirementJoinRefs: [ api.clone( retirementJoin ) ],
		status: 'admitted',
		receiptDigest: 'pending'
	};
	allocationAdmission.receiptDigest = digestRecordWithout( api, allocationAdmission, 'receiptDigest' );
	const conservativeMap = buildQualityStateMap( api, route, sourceState, destinationState, interval, migrationCompletion );
	const errorLedger = buildErrorLedger( api, route, sourceState, destinationState, interval );
	const resetPlan = targets.map( ( target ) => resetAction( api, target ) );
	const completedTokens = [ ...retirementJoin.simulationConsumers, ...retirementJoin.couplingConsumers, ...retirementJoin.externalConsumers, ...retirementJoin.presentationConsumers ];
	const transition = {
		transitionId: QUALITY_TRANSITION_ID,
		contextId: route.physicsContext.contextId,
		requestId: request.requestId,
		requestSequence: request.requestSequence,
		affectedTargetsViews: api.clone( request.affectedTargetsViews ),
		affectedControls: api.clone( request.rankedCandidateControls ),
		sourceEvidenceDigest: api.digest( request.evidenceRecords ),
		fromState: sourceState.qualityStateId,
		toState: destinationState.qualityStateId,
		fromQualityEpoch: sourceState.qualityEpoch,
		toQualityEpoch: destinationState.qualityEpoch,
		triggerEvidence: { pressureRecords: api.clone( request.evidenceRecords ), errorRecords: api.clone( sourceState.physicalAndVisualErrorBounds ) },
		requestAdmission,
		protectedInvariants: api.clone( request.protectedInvariants ),
		prepare: {
			allocationAdmission,
			allocateCompilePopulate: [ `after-${ ALLOCATION_ADMISSION_ID }:allocate-destination-generation`, `after-${ ALLOCATION_ADMISSION_ID }:compile-conservative-map`, `after-${ ALLOCATION_ADMISSION_ID }:populate-provisional-destination` ],
			sourceStateVersion: sourceState.stateVariablesAndInventories.coherentStateVersion,
			eventQueuePartition: 'drain sequences through 1004 before boundary; preserve next sequence 1005 in destination queue',
			predictedPeakResources: api.clone( memoryLedger ),
			failurePolicy: 'keep-old-state'
		},
		commitAtStepBoundary: {
			commitInstant,
			conservativeMap: [ conservativeMap ],
			idRngEventCursorMap: api.clone( conservativeMap.stableIdRngEventAndLedgerMap ),
			contactWarmStartAction: 'migrate',
			authoritativeEmitterByStateEquationOrSourceChannel: Object.fromEntries( destinationState.stateVariablesAndInventories.stateEquations.map( ( equationId ) => [ equationId, 'exactly-one-owner-and-representation' ] ) ),
			residualAndErrorGate: {
				status: 'accepted',
				mapId: conservativeMap.mapId,
				errorPropagationLedgerRef: errorLedger.ledgerId,
				residualDigest: 'sha256:quality-conservation-residuals-43',
				migrationCompletion: {
					gpuCompletion: compactDependencyCompletion( api, migrationCompletion.gpuCompletion ),
					externalCompletion: compactDependencyCompletion( api, migrationCompletion.externalCompletion ),
					externalReceipt: compactExternalReceipt( api, migrationCompletion.externalReceipt ),
					atomicCommitJoin: api.clone( migrationCompletion.atomicCommitJoin )
				},
				provisionalToCommittedVersions: conservativeMap.destinationProvisionalVersions.map( ( provisionalVersion, index ) => ( { provisionalVersion, committedVersion: destinationState.stateVariablesAndInventories.stateVersions[ index ] } ) )
			},
			atomicPublication: 'required'
		},
		retireAfterCompletion: {
			oldResourceLeases: [ SOURCE_LEASE_ID ],
			completionJoin: retirementJoin,
			oldEventQueueDrain: 'source queue drained through sequence 1004; destination resumes at sequence 1005',
			retirementEvidence: { completedConsumerKeys: api.clone( retirementJoin.requiredConsumerKeys ), completedTokenIds: completedTokens.map( ( token ) => token.tokenId ).sort(), retirementInstant: retirementInstant( api, route, commitInstant ), resolution: 'all-required-consumers-complete', externalConsumerScope: api.clone( completion.externalScope ) }
		},
		resetPlan,
		rollback: 'discard destination generation and preserve source authority, inventories, cursors, and quality epoch'
	};
	const physicsQualityRequests = { [ request.requestId ]: request };
	const physicsQualityStates = { [ sourceState.qualityStateId ]: sourceState, [ destinationState.qualityStateId ]: destinationState };
	const physicsQualityTransitions = [ transition ];
	route.physicsQualityRequests = physicsQualityRequests;
	route.physicsQualityStates = physicsQualityStates;
	route.physicsQualityTransitions = physicsQualityTransitions;
	route.physicsErrorPropagationLedgers ??= {};
	route.physicsErrorPropagationLedgers[ errorLedger.ledgerId ] = errorLedger;
	projectQualityMigrationIntoCostLedger( api, route, memoryLedger, trafficRecords, targets );
	return { physicsQualityRequests, physicsQualityStates, physicsQualityTransitions, physicsErrorPropagationLedgers: route.physicsErrorPropagationLedgers };

}

function requireRecord( api, value, name, label ) {

	return api.requireRecord( value, name, label ) ?? value;

}

function validateMemoryLedger( api, route, transition, request, sourceState, destinationState ) {

	const allocation = transition.prepare.allocationAdmission;
	const predicted = requireRecord( api, transition.prepare.predictedPeakResources, 'PhysicsMemoryLedger', 'qualityTransition.prepare.predictedPeakResources' );
	const admitted = requireRecord( api, allocation.simultaneousOldNewPeakProof, 'PhysicsMemoryLedger', 'qualityTransition.prepare.allocationAdmission.simultaneousOldNewPeakProof' );
	assert.deepEqual( admitted, predicted, 'allocation admission and prepare disagree on the simultaneous old/new peak proof' );
	assert.equal( predicted.category, 'migration-overlap', 'quality prepare must use a migration-overlap memory ledger' );
	assert.deepEqual( predicted.measurementInterval, request.observedInterval, 'quality migration memory proof covers another request interval' );
	assert.equal( predicted.qualityEpoch, transition.fromQualityEpoch, 'migration memory proof is not anchored to the source quality epoch' );
	const expectedSpecs = [ ...allocationSpecs( sourceState, destinationState ), {
		signalId: 'quality-state-migration',
		stateEquationId: 'quality-transition-map',
		generationRole: 'scratch',
		stateVersion: QUALITY_TRANSITION_ID,
		componentLayouts: [ { componentId: 'pairwise-conservation-reduction-and-sparse-prefix-scan', elementCount: MIGRATION_SCRATCH_LOGICAL_BYTES / 16, strideBytes: 16, logicalBytes: MIGRATION_SCRATCH_LOGICAL_BYTES } ],
		logicalBytes: MIGRATION_SCRATCH_LOGICAL_BYTES,
		format: 'bounded-pairwise-reduction-and-prefix-scan-scratch-v1'
	} ];
	const key = ( role, signalId ) => `${ role }|${ signalId }`;
	const expectedByKey = new Map( expectedSpecs.map( ( spec ) => [ key( spec.generationRole, spec.signalId ), spec ] ) );
	const actualKeys = predicted.allocations.map( ( record ) => key( record.encodingFormatAndExtent.generationRole, record.encodingFormatAndExtent.signalId ) ).sort();
	assert.deepEqual( actualKeys, [ ...expectedByKey.keys() ].sort(), 'migration memory proof must cover source/destination state generations and named migration scratch exactly once' );
	assert.equal( new Set( predicted.allocations.map( ( record ) => record.allocationId ) ).size, predicted.allocations.length, 'migration memory proof contains duplicate allocation IDs' );
	const framesInFlight = quantityValue( request.requestedAllocation.maximumFramesInFlightAndMultiviewMultiplier.maximumFramesInFlight, 'requested maximum frames in flight' );
	assert.equal( framesInFlight, configuredFramesInFlight( route, request.affectedTargetsViews ), 'quality request frame multiplier differs from authoritative frame-cohort admission' );
	assert.equal( request.requestedAllocation.lifetimeAndRetirementPlanDigest, lifetimeAndRetirementPlanDigest( api, request.affectedTargetsViews, framesInFlight, predicted ), 'quality request lifetime/retirement digest does not cover the exact allocation generations, intervals, and completion joins' );
	let logicalBytes = 0;
	let physicalBytes = 0;
	let sourcePhysicalBytes = 0;
	let destinationPhysicalBytes = 0;
	let scratchPhysicalBytes = 0;
	const leaseIds = [];
	for ( const [ index, record ] of predicted.allocations.entries() ) {

		requireRecord( api, record, 'PhysicsMemoryAllocationRecord', `quality migration allocation ${ index }` );
		const layout = record.encodingFormatAndExtent;
		const spec = expectedByKey.get( key( layout.generationRole, layout.signalId ) );
		assert.ok( spec, `${ record.allocationId } is not a mapped water/body source/destination allocation` );
		assert.equal( layout.stateEquationId, spec.stateEquationId, `${ record.allocationId } changes state-equation ownership` );
		assert.equal( layout.stateVersion, spec.stateVersion, `${ record.allocationId } does not bind the exact mapped state version` );
		assert.equal( layout.format, spec.format, `${ record.allocationId } uses an unadmitted state layout` );
		assert.equal( record.liveInterval.coversQualityCommit, true, `${ record.allocationId } is not live across the quality commit` );
		assert.deepEqual( record.targetViewKeys, request.affectedTargetsViews, `${ record.allocationId } target/view scope differs from the admitted request` );
		const isScratch = layout.generationRole === 'scratch';
		const signal = signalById( route, isScratch ? 'water-surface-state' : layout.signalId );
		assert.equal( record.owner, isScratch ? QUALITY_CONTEXT_OWNER : signal.owner, `${ record.allocationId } is charged to the wrong owner` );
		const expectedResourceGeneration = isScratch ? 'quality-migration-scratch-generation-43' : layout.generationRole === 'source' ? signalResourceGeneration( signal ) : `quality-${ layout.signalId }-generation-43`;
		const expectedResourceId = isScratch ? 'quality-migration-scratch-resource-43' : layout.generationRole === 'source' ? signal.residency.bindingIdentity : `quality-${ layout.signalId }-destination-resource-43`;
		assert.deepEqual( record.residency, allocationResidency( api, signal, isScratch ? 'destination' : layout.generationRole, expectedResourceId ), `${ record.allocationId } does not bind the exact residency identity` );
		assert.equal( record.resourceId, expectedResourceId, `${ record.allocationId } does not resolve to the actual source or admitted destination resource` );
		assert.deepEqual( record.deviceBackendResourceGenerations, generationTuple( route, signal, expectedResourceGeneration ), `${ record.allocationId } has a non-authoritative device/backend/loss/resource generation tuple` );
		const expectedComponentsById = new Map( spec.componentLayouts.map( ( component ) => [ component.componentId, component ] ) );
		assert.deepEqual( layout.componentLayouts.map( ( component ) => component.componentId ).sort(), [ ...expectedComponentsById.keys() ].sort(), `${ record.allocationId } component-layout closure differs from its admitted state layout` );
		let componentLogicalBytes = 0;
		for ( const component of layout.componentLayouts ) {

			const expectedComponent = expectedComponentsById.get( component.componentId );
			const componentElementCount = quantityValue( component.elementCount, `${ record.allocationId }.${ component.componentId }.elementCount` );
			const componentStride = quantityValue( component.stride, `${ record.allocationId }.${ component.componentId }.stride` );
			const componentBytes = quantityValue( component.logicalBytes, `${ record.allocationId }.${ component.componentId }.logicalBytes` );
			assert.equal( componentElementCount, expectedComponent.elementCount, `${ record.allocationId } ${ component.componentId } element count drifted` );
			assert.equal( componentStride, expectedComponent.strideBytes, `${ record.allocationId } ${ component.componentId } stride drifted` );
			assert.equal( componentBytes, expectedComponent.logicalBytes, `${ record.allocationId } ${ component.componentId } logical bytes drifted` );
			assert.equal( componentBytes, componentElementCount * componentStride, `${ record.allocationId } ${ component.componentId } element count × stride does not close` );
			componentLogicalBytes += componentBytes;

		}
		assert.equal( componentLogicalBytes, spec.logicalBytes, `${ record.allocationId } component layouts do not close to admitted logical bytes` );
		const allocationMultiplier = isScratch ? 1 : framesInFlight;
		assert.equal( layout.frameSlotSubresources.length, allocationMultiplier, `${ record.allocationId } frame-slot subresource count differs from admission` );
		for ( const [ slotIndex, slot ] of layout.frameSlotSubresources.entries() ) {

			assert.equal( quantityValue( slot.slotIndex, `${ record.allocationId }.frameSlotSubresources[${ slotIndex }].slotIndex` ), slotIndex, `${ record.allocationId } frame-slot index drifted` );
			assert.equal( quantityValue( slot.byteOffset, `${ record.allocationId }.frameSlotSubresources[${ slotIndex }].byteOffset` ), slotIndex * spec.logicalBytes, `${ record.allocationId } frame-slot byte offset drifted` );
			assert.equal( quantityValue( slot.byteLength, `${ record.allocationId }.frameSlotSubresources[${ slotIndex }].byteLength` ), spec.logicalBytes, `${ record.allocationId } frame-slot byte length drifted` );

		}
		assert.deepEqual( record.elementCountStrideAndLogicalBytes.componentLayouts, layout.componentLayouts, `${ record.allocationId } packed and semantic component layouts disagree` );
		const recordLogicalBytes = quantityValue( record.elementCountStrideAndLogicalBytes.logicalBytes, `${ record.allocationId }.logicalBytes` );
		const strideBytes = quantityValue( record.elementCountStrideAndLogicalBytes.stride, `${ record.allocationId }.stride` );
		const elementCount = quantityValue( record.elementCountStrideAndLogicalBytes.elementCount, `${ record.allocationId }.elementCount` );
		assert.equal( strideBytes, isScratch ? 16 : 1, `${ record.allocationId } packed stride differs from its admitted representation` );
		assert.equal( elementCount, isScratch ? MIGRATION_SCRATCH_LOGICAL_BYTES / 16 : recordLogicalBytes, `${ record.allocationId } packed element count does not close to logical bytes` );
		assert.equal( recordLogicalBytes, elementCount * strideBytes, `${ record.allocationId } element count × stride does not close to logical bytes` );
		assert.equal( recordLogicalBytes, spec.logicalBytes, `${ record.allocationId } logical bytes differ from the admitted state layout` );
		assert.equal( quantityValue( record.framesInFlightMultiplier, `${ record.allocationId }.framesInFlightMultiplier` ), allocationMultiplier, `${ record.allocationId } omits its admitted allocation multiplier` );
		const recordPhysicalBytes = quantityValue( record.physicalAllocatedBytes, `${ record.allocationId }.physicalAllocatedBytes` );
		assert.equal( recordPhysicalBytes, recordLogicalBytes * allocationMultiplier, `${ record.allocationId } physical bytes omit the admitted replication` );
		const expectedLease = isScratch
			? { leaseId: 'quality-migration-scratch-lease', completionJoinId: transition.commitAtStepBoundary.residualAndErrorGate.migrationCompletion.gpuCompletion.completionId, completionJoinDigest: transition.commitAtStepBoundary.residualAndErrorGate.migrationCompletion.gpuCompletion.receiptDigest }
			: layout.generationRole === 'source'
			? { leaseId: SOURCE_LEASE_ID, completionJoinId: transition.retireAfterCompletion.completionJoin.joinId, completionJoinDigest: transition.retireAfterCompletion.completionJoin.joinDigest }
			: { leaseId: DESTINATION_LEASE_ID, completionJoinId: 'destination-active-lifetime', completionJoinDigest: 'sha256:destination-active-lifetime' };
		assert.deepEqual( record.leaseIdsAndCompletionJoins, [ expectedLease ], `${ record.allocationId } does not bind the exact generation lifetime/retirement join` );
		logicalBytes += recordLogicalBytes;
		physicalBytes += recordPhysicalBytes;
		if ( layout.generationRole === 'source' ) sourcePhysicalBytes += recordPhysicalBytes;
		if ( layout.generationRole === 'destination' ) destinationPhysicalBytes += recordPhysicalBytes;
		if ( layout.generationRole === 'scratch' ) scratchPhysicalBytes += recordPhysicalBytes;
		leaseIds.push( ...record.leaseIdsAndCompletionJoins.map( ( ref ) => ref.leaseId ) );

	}
	assert.equal( new Set( predicted.allocations.map( ( record ) => record.resourceId ) ).size, predicted.allocations.length, 'quality migration aliases distinct source/destination allocations to one resource identity' );
	assert.equal( new Set( predicted.allocations.map( ( record ) => canonicalJson( record.deviceBackendResourceGenerations ) ) ).size, predicted.allocations.length, 'quality migration aliases distinct source/destination allocations to one generation tuple' );
	assert.equal( quantityValue( predicted.logicalBytesByResidency.gpu, 'quality migration logical bytes' ), logicalBytes, 'migration logical byte inventory does not close' );
	assert.equal( quantityValue( predicted.physicalAllocatedBytesByResidency.gpu, 'quality migration physical bytes' ), physicalBytes, 'migration physical byte inventory does not close' );
	assert.equal( quantityValue( predicted.maximumSimultaneouslyLiveBytes.gpu, 'quality migration maximum live bytes' ), physicalBytes, 'migration maximum-live inventory must include every source/destination frame slot' );
	assert.equal( predicted.lifetimeDagDigest, memoryLifetimeDagDigest( api, predicted.allocations ), 'migration lifetime DAG digest does not cover exact generations, frame-slot subresources, intervals, and completion joins' );
	assert.equal( quantityValue( predicted.sharedBytesByWorkKey[ 'quality-migration-work' ], 'quality migration shared work bytes' ), logicalBytes, 'migration shared-work logical bytes do not close to the allocation set' );
	assert.equal( quantityValue( request.requestedAllocation.migrationOverlapBytesByResidency.gpu, 'requested migration overlap bytes' ), sourcePhysicalBytes + destinationPhysicalBytes, 'quality request does not reserve exact simultaneous old/new frame-cohort capacity' );
	assert.equal( quantityValue( request.requestedAllocation.requestedHotBytesByResidency.gpu, 'requested destination hot bytes' ), destinationPhysicalBytes, 'quality request destination hot bytes disagree with the destination frame cohort' );
	assert.equal( quantityValue( request.requestedAllocation.requestedTransientPeakBytesByResidency.gpu, 'requested migration scratch bytes' ), scratchPhysicalBytes, 'quality request transient peak differs from the explicit scratch allocation' );
	assert.equal( quantityValue( allocation.grantedBytesByResidencyAndLifetime.gpuMigrationOverlap, 'granted migration overlap bytes' ), sourcePhysicalBytes + destinationPhysicalBytes, 'allocation admission does not grant the exact simultaneous old/new frame cohort' );
	assert.equal( quantityValue( allocation.grantedBytesByResidencyAndLifetime.gpuDestinationHot, 'granted destination hot bytes' ), destinationPhysicalBytes, 'allocation admission destination hot bytes disagree with the memory proof' );
	assert.equal( quantityValue( allocation.grantedBytesByResidencyAndLifetime.gpuTransientScratch, 'granted migration scratch bytes' ), scratchPhysicalBytes, 'allocation admission scratch grant differs from the memory proof' );
	assert.equal( quantityValue( allocation.grantedBytesByResidencyAndLifetime.gpuTransitionLedgerPeak, 'granted transition ledger peak bytes' ), physicalBytes, 'allocation admission transition peak omits old/new/scratch bytes' );
	assert.deepEqual( Object.keys( predicted.perViewBytesByTargetView ).sort(), [ ...request.affectedTargetsViews ].sort(), 'migration memory ledger target/view closure differs from the request' );
	assert.ok( Object.values( predicted.perViewBytesByTargetView ).every( ( quantity ) => quantityValue( quantity, 'quality migration per-view bytes' ) === 0 ), 'context-shared migration state is double-counted as per-view memory' );
	assert.deepEqual( sortedUnique( allocation.allocationLeaseIds, 'quality allocation lease IDs' ), [ ...new Set( leaseIds ) ].sort(), 'allocation admission lease closure differs from the memory ledger' );
	assert.equal( allocation.retirementJoinRefs.length, 1, 'quality allocation admission must carry the one source-generation retirement join' );
	assert.deepEqual( allocation.retirementJoinRefs[ 0 ], transition.retireAfterCompletion.completionJoin, 'quality allocation admission and retirement phase use different source-generation joins' );
	assert.deepEqual( allocation.targetDeviceBackendGenerations, predicted.allocations.map( ( record ) => record.deviceBackendResourceGenerations ), 'quality allocation admission omits or invents a resource-generation tuple' );
	assert.equal( quantityValue( request.requestedAllocation.requestedBindingsTexturesBuffersAndAttachments.storageBindings, 'requested quality storage bindings' ), predicted.allocations.length, 'quality request binding count differs from mapped allocation count' );
	assert.deepEqual( allocation.grantedBindingsTexturesBuffersAndAttachments.storageBindings, request.requestedAllocation.requestedBindingsTexturesBuffersAndAttachments.storageBindings, 'quality admission binding grant differs from the request' );
	assert.equal( allocation.receiptDigest, digestRecordWithout( api, allocation, 'receiptDigest' ), 'quality allocation admission receipt digest does not cover its exact grants, generation tuples, and retirement joins' );

	const trafficEnvelope = request.requestedAllocation.requestedTrafficBytesPerCoordinationIntervalAndSecond;
	const trafficRecords = trafficEnvelope.trafficRecords;
	assert.ok( Array.isArray( trafficRecords ), 'quality migration request must carry explicit source-read and destination-write TrafficRecords' );
	assert.equal( new Set( trafficRecords.map( ( record ) => record.trafficRecordId ) ).size, trafficRecords.length, 'quality migration traffic contains duplicate record IDs' );
	const trafficKeys = [];
	for ( const [ index, traffic ] of trafficRecords.entries() ) {

		requireRecord( api, traffic, 'TrafficRecord', `quality migration traffic ${ index }` );
		const ref = traffic.resourceIdAndVersion;
		const role = ref.migrationAccess === 'source-read' ? 'source' : ref.migrationAccess === 'destination-write' ? 'destination' : ref.migrationAccess === 'scratch-read-write' ? 'scratch' : undefined;
		assert.ok( role, `${ traffic.trafficRecordId } has no exact source, destination, or scratch access role` );
		const memory = predicted.allocations.find( ( record ) => record.encodingFormatAndExtent.generationRole === role && record.encodingFormatAndExtent.signalId === ref.signalId );
		assert.ok( memory, `${ traffic.trafficRecordId } does not resolve to one mapped allocation` );
		trafficKeys.push( `${ ref.migrationAccess }|${ ref.signalId }` );
		assert.deepEqual( [ ref.resourceId, ref.stateEquationId, ref.stateVersion, ref.resourceGeneration ], [ memory.resourceId, memory.encodingFormatAndExtent.stateEquationId, memory.encodingFormatAndExtent.stateVersion, memory.deviceBackendResourceGenerations.resourceGeneration ], `${ traffic.trafficRecordId } does not bind its allocation state/resource version` );
		assert.deepEqual( traffic.deviceBackendResourceGenerations, memory.deviceBackendResourceGenerations, `${ traffic.trafficRecordId } generation tuple differs from its allocation` );
		const residencyIdentity = { residencyKind: memory.residency.kind, deviceId: memory.residency.deviceId, queueId: memory.residency.queueId, bindingIdentity: memory.residency.bindingIdentity };
		assert.deepEqual( traffic.sourceAndDestinationResidency, { source: residencyIdentity, destination: residencyIdentity }, `${ traffic.trafficRecordId } residency identity differs from its allocation` );
		assert.equal( traffic.direction, 'same-residency', `${ traffic.trafficRecordId } invents an inter-residency transfer` );
		assert.deepEqual( traffic.measurementInterval, request.observedInterval, `${ traffic.trafficRecordId } covers another request interval` );
		assert.equal( traffic.workKey, 'quality-migration-work', `${ traffic.trafficRecordId } is not charged to the migration work key` );
		const memoryLogicalBytes = quantityValue( memory.elementCountStrideAndLogicalBytes.logicalBytes, `${ memory.allocationId }.logicalBytes` );
		const expectedTrafficBytes = memoryLogicalBytes * ( role === 'scratch' ? 2 : 1 );
		assert.equal( quantityValue( traffic.logicalBytesPerOccurrence, `${ traffic.trafficRecordId }.logicalBytesPerOccurrence` ), expectedTrafficBytes, `${ traffic.trafficRecordId } logical traffic differs from its declared access pattern` );
		assert.equal( quantityValue( traffic.physicalBytesPerOccurrence, `${ traffic.trafficRecordId }.physicalBytesPerOccurrence` ), expectedTrafficBytes, `${ traffic.trafficRecordId } measured traffic differs from its declared access pattern` );
		assert.equal( quantityValue( traffic.occurrenceCount, `${ traffic.trafficRecordId }.occurrenceCount` ), 1, `${ traffic.trafficRecordId } must occur exactly once for this admitted migration` );
		assert.equal( quantityValue( traffic.dirtyFraction, `${ traffic.trafficRecordId }.dirtyFraction` ), 1, `${ traffic.trafficRecordId } does not cover its complete admitted extent` );
		assert.deepEqual( traffic.dependencyRefs, [ { dependencyId: ALLOCATION_ADMISSION_ID, requiredCompletionVersion: `${ ALLOCATION_ADMISSION_ID }/admitted` } ], `${ traffic.trafficRecordId } is not ordered after allocation admission` );

	}
	assert.deepEqual( trafficKeys.sort(), [ 'destination-write|rigid-body-state', 'destination-write|water-surface-state', 'scratch-read-write|quality-state-migration', 'source-read|rigid-body-state', 'source-read|water-surface-state' ], 'quality migration traffic must include source reads, destination writes, and scratch read/write traffic exactly once' );
	const traffic = trafficTotals( trafficRecords );
	assert.equal( quantityValue( trafficEnvelope.sourceReadBytesPerMigration, 'requested source-read traffic' ), traffic.sourceReadBytes, 'quality request source-read traffic total does not close' );
	assert.equal( quantityValue( trafficEnvelope.destinationWriteBytesPerMigration, 'requested destination-write traffic' ), traffic.destinationWriteBytes, 'quality request destination-write traffic total does not close' );
	assert.equal( quantityValue( trafficEnvelope.scratchReadWriteBytesPerMigration, 'requested scratch read/write traffic' ), traffic.scratchReadWriteBytes, 'quality request scratch traffic total does not close' );
	assert.equal( quantityValue( trafficEnvelope.totalBytesPerMigration, 'requested total migration traffic' ), traffic.totalBytes, 'quality request total migration traffic does not close' );
	assert.deepEqual( allocation.grantedTrafficAndWorkEnvelope.trafficRecordIds, trafficRecords.map( ( record ) => record.trafficRecordId ), 'quality admission traffic-record closure differs from the request' );
	assert.deepEqual( allocation.grantedTrafficAndWorkEnvelope.sourceReadBytesPerMigration, trafficEnvelope.sourceReadBytesPerMigration, 'quality admission omits requested source-read traffic' );
	assert.deepEqual( allocation.grantedTrafficAndWorkEnvelope.destinationWriteBytesPerMigration, trafficEnvelope.destinationWriteBytesPerMigration, 'quality admission omits requested destination-write traffic' );
	assert.deepEqual( allocation.grantedTrafficAndWorkEnvelope.scratchReadWriteBytesPerMigration, trafficEnvelope.scratchReadWriteBytesPerMigration, 'quality admission omits requested scratch traffic' );
	assert.deepEqual( allocation.grantedTrafficAndWorkEnvelope.totalBytesPerMigration, trafficEnvelope.totalBytesPerMigration, 'quality admission total traffic differs from the request' );
	assert.deepEqual( allocation.grantedTrafficAndWorkEnvelope.gpuDispatches, request.requestedAllocation.requestedCpuGpuAndExternalWork.gpuDispatches, 'quality admission work envelope differs from the request' );
	assert.deepEqual( allocation.grantedTrafficAndWorkEnvelope.externalSteps, request.requestedAllocation.requestedCpuGpuAndExternalWork.externalSteps, 'quality admission external work envelope differs from the request' );
	assert.equal( quantityValue( request.requestedAllocation.requestedCpuGpuAndExternalWork.externalSteps, 'requested external quality migration steps' ), 1, 'externally owned body state lacks one admitted migration step' );
	const capacityGate = allocation.limitHeadroomAndThermalGateResults.find( ( result ) => result.gate === 'gpu-allocation-capacity' );
	assert.ok( capacityGate && capacityGate.status === 'accepted', 'quality allocation omits an accepted capacity/headroom gate' );
	const capacity = capacityBreakdown( api, route, predicted );
	assert.equal( quantityValue( capacityGate.baselineRouteHotBytes, 'quality baseline route hot bytes' ), capacity.baselineRouteHotBytes, 'quality capacity gate does not use the active measured route baseline' );
	assert.equal( quantityValue( capacityGate.sourceAlreadyResidentBytes, 'quality source already-resident bytes' ), sourcePhysicalBytes, 'quality capacity gate source subset differs from exact source allocations' );
	assert.equal( quantityValue( capacityGate.incrementalDestinationBytes, 'quality incremental destination bytes' ), destinationPhysicalBytes, 'quality capacity gate destination increment differs from exact destination allocations' );
	assert.equal( quantityValue( capacityGate.transientScratchBytes, 'quality transient scratch bytes' ), scratchPhysicalBytes, 'quality capacity gate scratch increment differs from exact scratch allocation' );
	assert.equal( quantityValue( capacityGate.demand, 'quality capacity demand' ), capacity.deviceDemandBytes, 'quality capacity gate demand must be baseline plus incremental destination plus scratch without double-counting the resident source' );
	assert.equal( quantityValue( allocation.grantedBytesByResidencyAndLifetime.gpuTotalDeviceDemand, 'granted total device demand' ), capacity.deviceDemandBytes, 'quality allocation admission does not grant the exact baseline-inclusive device demand' );
	assert.equal( quantityValue( capacityGate.requiredHeadroom, 'quality capacity headroom' ), REQUIRED_HEADROOM_BYTES, 'quality capacity gate changes the compact-device headroom reserve' );
	assert.equal( quantityValue( capacityGate.capacity, 'quality device capacity' ), DEVICE_CAPACITY_BYTES, 'quality capacity gate is not tied to the named compact-device capacity probe' );
	assert.ok( capacity.deviceDemandBytes + REQUIRED_HEADROOM_BYTES <= DEVICE_CAPACITY_BYTES, 'measured route baseline plus destination frame slots, scratch, and headroom exceed compact-device capacity' );
	const bindingGate = allocation.limitHeadroomAndThermalGateResults.find( ( result ) => result.gate === 'storage-binding-capacity' );
	assert.ok( bindingGate && bindingGate.status === 'accepted', 'quality allocation omits storage-binding admission' );
	assert.ok( quantityValue( bindingGate.demand, 'quality storage binding demand' ) + quantityValue( bindingGate.requiredHeadroom, 'quality storage binding headroom' ) <= quantityValue( bindingGate.capacity, 'quality storage binding capacity' ), 'quality migration exceeds storage-binding capacity/headroom' );

}

function validateMigrationCompletion( api, route, transition ) {

	const memoryLedger = transition.prepare.predictedPeakResources;
	const interval = memoryLedger.measurementInterval;
	const expected = migrationCompletionBundle( api, route, interval, memoryLedger );
	for ( const [ name, completion ] of [ [ 'gpuCompletion', expected.gpuCompletion ], [ 'externalCompletion', expected.externalCompletion ] ] ) requireRecord( api, completion, 'PhysicsDependencyCompletion', `quality migration ${ name}` );
	requireRecord( api, expected.externalReceipt, 'ExternalSolverStepReceipt', 'quality migration external body receipt' );
	const recorded = transition.commitAtStepBoundary.residualAndErrorGate.migrationCompletion;
	assert.deepEqual( recorded.gpuCompletion, compactDependencyCompletion( api, expected.gpuCompletion ), 'quality atomic commit carries a stale or incomplete GPU migration completion' );
	assert.deepEqual( recorded.externalCompletion, compactDependencyCompletion( api, expected.externalCompletion ), 'quality atomic commit carries a stale or incomplete external migration completion' );
	assert.deepEqual( recorded.externalReceipt, compactExternalReceipt( api, expected.externalReceipt ), 'quality atomic commit carries a stale or non-route-owned external migration receipt' );
	assert.deepEqual( recorded.atomicCommitJoin, expected.atomicCommitJoin, 'quality atomic commit does not join both equation migration completions' );
	for ( const completion of [ expected.gpuCompletion, expected.externalCompletion ] ) {

		assert.equal( completion.receiptDigest, digestRecordWithout( api, completion, 'receiptDigest' ), `quality migration completion ${ completion.completionId } has a stale receipt digest` );
		assert.equal( completion.producerRelease.completionToken, completion.consumerAcquire.waitToken, `quality migration completion ${ completion.completionId } has no exact release/acquire token handoff` );
		assert.equal( completion.consumerAcquire.firstUse, completion.consumerExecutionId, `quality migration completion ${ completion.completionId } does not gate the atomic commit's first use` );

	}
	assert.equal( expected.externalReceipt.contentDigest, digestRecordWithout( api, expected.externalReceipt, 'contentDigest' ), 'quality external body migration receipt digest is stale' );
	assert.equal( expected.externalReceipt.status, 'completed', 'quality external body migration did not complete' );
	assert.deepEqual( expected.externalReceipt.inputStateVersions, [ { signalId: 'rigid-body-state', stateVersion: route.physicsSignals.bodyState?.stateVersion ?? signalById( route, 'rigid-body-state' ).stateVersion } ], 'quality external body migration reads another source state' );
	assert.equal( expected.externalReceipt.outputPreparedVersions[ 0 ].resourceGeneration, expected.externalCompletion.deviceBackendResourceGenerations.resourceGeneration, 'quality external body receipt and dependency completion disagree on destination generation' );
	const trafficRecords = route.physicsQualityRequests[ transition.requestId ].requestedAllocation.requestedTrafficBytesPerCoordinationIntervalAndSecond.trafficRecords;
	for ( const traffic of trafficRecords ) {

		const expectedRef = traffic.resourceIdAndVersion.stateEquationId === 'body-state' ? expected.dependencyRefs.external : expected.dependencyRefs.gpu;
		assert.deepEqual( traffic.accessAndResourceTransition.completionDependencyRef, expectedRef, `quality traffic ${ traffic.trafficRecordId } does not resolve the equation-correct completion gate` );

	}
	return expected;

}

function validateQualityStateMap( api, route, transition, sourceState, destinationState ) {

	const maps = transition.commitAtStepBoundary.conservativeMap;
	assert.equal( maps.length, 1, 'canonical quality transition requires exactly one coherent conservative state map' );
	const map = requireRecord( api, maps[ 0 ], 'ConservativeStateMap', 'qualityTransition.commitAtStepBoundary.conservativeMap[0]' );
	const migrationCompletion = validateMigrationCompletion( api, route, transition );
	assert.equal( map.contextId, transition.contextId, 'conservative map context mismatch' );
	assert.deepEqual( [ map.sourceQualityStateId, map.destinationQualityStateId ], [ sourceState.qualityStateId, destinationState.qualityStateId ], 'conservative map quality-state endpoints mismatch' );
	assert.deepEqual( map.restrictionOrProlongationOperator.perStateEquationExecution, {
		'water-state': { owner: '$threejs-water-optics', executionKind: 'gpu-same-queue-dispatch', completionId: migrationCompletion.gpuCompletion.completionId, receiptDigest: migrationCompletion.gpuCompletion.receiptDigest },
		'body-state': { owner: migrationCompletion.externalReceipt.adapterId, executionKind: 'route-owned-external-adapter-step', completionId: migrationCompletion.externalCompletion.completionId, receiptDigest: migrationCompletion.externalCompletion.receiptDigest, externalReceiptId: migrationCompletion.externalReceipt.receiptId, externalReceiptDigest: migrationCompletion.externalReceipt.contentDigest }
	}, 'quality conservative map omits or changes per-equation execution ownership/completion' );
	for ( const [ state, measure, label ] of [ [ sourceState, map.sourceMeasure, 'source' ], [ destinationState, map.destinationMeasure, 'destination' ] ] ) {

		const representedArea = quantityValue( measure.representedMeasure, `quality ${ label } represented area` );
		const activeCells = quantityValue( state.discretizationAndActiveDomain.cellCount, `quality ${ label } active cells` );
		const minimumCellWidth = quantityValue( state.discretizationAndActiveDomain.minimumCellWidth, `quality ${ label } minimum cell width` );
		assert.equal( representedArea, REPRESENTED_AREA_SQUARE_METRES, `quality ${ label } measure does not cover the admitted active domain` );
		assert.ok( representedArea >= activeCells * minimumCellWidth * minimumCellWidth, `quality ${ label } cell count/minimum width cannot fit inside its represented area` );

	}
	assert.deepEqual( map.destinationMeasure.representedMeasure, map.sourceMeasure.representedMeasure, 'quality migration source/destination measures differ' );
	assert.equal( sourceState.stateVariablesAndInventories.publicationDisposition, 'committed', 'quality migration source is not the committed authoritative state' );
	assert.equal( destinationState.stateVariablesAndInventories.publicationDisposition, 'committed-only-after-atomic-quality-transition', 'destination descriptor permits authority before the atomic quality commit' );
	assert.equal( transition.prepare.sourceStateVersion, sourceState.stateVariablesAndInventories.coherentStateVersion, 'quality prepare reads another coherent source-state version' );
	assert.deepEqual( map.sourceStateVersions, sourceState.stateVariablesAndInventories.stateVersions, 'conservative map omits or invents a source state version' );
	assert.deepEqual( map.destinationProvisionalVersions, destinationState.stateVariablesAndInventories.migrationProvisionalStateVersions, 'conservative map omits or invents a destination provisional version' );
	assert.ok( map.destinationProvisionalVersions.length > 0 && map.destinationProvisionalVersions.every( ( version ) => /provisional/.test( version.stateVersion ) ), 'quality prepare fails to keep destination versions in a provisional namespace' );
	const expectedPromotion = map.destinationProvisionalVersions.map( ( provisionalVersion, index ) => ( { provisionalVersion, committedVersion: destinationState.stateVariablesAndInventories.stateVersions[ index ] } ) );
	assert.deepEqual( transition.commitAtStepBoundary.residualAndErrorGate.provisionalToCommittedVersions, expectedPromotion, 'quality atomic commit omits or changes provisional-to-committed lineage' );
	assert.ok( destinationState.stateVariablesAndInventories.stateVersions.every( ( version ) => ! /provisional/.test( version.stateVersion ) ), 'destination quality state exposes a provisional version after commit' );
	const sourceInventories = sourceState.stateVariablesAndInventories.conservedInventories;
	const destinationInventories = destinationState.stateVariablesAndInventories.conservedInventories;
	assert.deepEqual( Object.keys( sourceInventories ).sort(), map.conservedCommodities, 'conservative map commodity closure differs from the source inventory' );
	assert.deepEqual( Object.keys( destinationInventories ).sort(), map.conservedCommodities, 'conservative map commodity closure differs from the destination inventory' );
	for ( const commodityId of map.conservedCommodities ) {

		assert.deepEqual( destinationInventories[ commodityId ], sourceInventories[ commodityId ], `quality migration silently changes ${ commodityId }` );
		assert.equal( quantityValue( map.residuals[ commodityId ], `${ commodityId } residual` ), 0, `quality migration has an unaccepted ${ commodityId } residual` );

	}
	assert.equal( map.acceptanceGate.status, 'accepted', 'conservative state map was not accepted' );
	assert.equal( transition.commitAtStepBoundary.contactWarmStartAction, 'migrate', 'contact warm-start migration was not declared' );
	assert.equal( map.contactWarmStartMap.operator, 'feature-ID-preserving-map', 'contact warm-start state is not mapped by feature identity' );
	assert.deepEqual( sourceState.stableIdPolicy, destinationState.stableIdPolicy, 'stable-ID policy changed across quality migration' );
	assert.deepEqual( map.stableIdRngEventAndLedgerMap.stableEntityGenerations.source, sourceState.stateVariablesAndInventories.stableEntityGenerations, 'stable source entity generations do not resolve through the conservative map' );
	assert.deepEqual( map.stableIdRngEventAndLedgerMap.stableEntityGenerations.destination, destinationState.stateVariablesAndInventories.stableEntityGenerations, 'stable destination entity generations do not resolve through the conservative map' );
	const rngMap = map.stableIdRngEventAndLedgerMap.rngStreams[ 'water-subgrid-stream' ];
	assert.equal( rngMap.operator, 'copy-exact', 'quality migration changes RNG stream semantics' );
	assert.deepEqual( [ rngMap.destinationStreamId, rngMap.destinationSeedDigest, rngMap.destinationCursor ], [ rngMap.sourceStreamId, rngMap.sourceSeedDigest, rngMap.sourceCursor ], 'quality migration resets or forks RNG identity/cursor' );
	for ( const [ streamId, cursorMap ] of Object.entries( map.stableIdRngEventAndLedgerMap.eventCursors ) ) {

		assert.equal( cursorMap.operator, 'copy-exact', `event stream ${ streamId } has no exact cursor map` );
		assert.deepEqual( cursorMap.destination, cursorMap.source, `event stream ${ streamId } loses or replays events at quality commit` );

	}
	for ( const [ ledgerId, ledgerMap ] of Object.entries( map.stableIdRngEventAndLedgerMap.exactOnceLedgers ) ) {

		assert.equal( ledgerMap.operator, 'copy-exact', `exact-once ledger ${ ledgerId } has no exact migration` );
		assert.deepEqual( ledgerMap.destination, ledgerMap.source, `exact-once ledger ${ ledgerId } loses its version/cursor` );

	}
	assert.deepEqual( transition.commitAtStepBoundary.idRngEventCursorMap, map.stableIdRngEventAndLedgerMap, 'atomic commit publishes a different ID/RNG/event/exact-once map than the conservative state map' );
	const errorLedger = route.physicsErrorPropagationLedgers[ map.errorPropagationLedgerRef ];
	assert.ok( errorLedger, `conservative state map cannot resolve error ledger ${ map.errorPropagationLedgerRef }` );
	requireRecord( api, errorLedger, 'ErrorPropagationLedger', `physicsErrorPropagationLedgers.${ map.errorPropagationLedgerRef}` );
	assert.equal( errorLedger.contextId, transition.contextId, 'quality migration error ledger context mismatch' );
	assert.equal( errorLedger.provenance.mapId, map.mapId, 'quality migration error ledger is not bound to its map' );
	assert.deepEqual( errorLedger.inputErrors, sourceState.physicalAndVisualErrorBounds, 'quality migration error ledger omits source errors' );
	assert.deepEqual( errorLedger.outputError, destinationState.physicalAndVisualErrorBounds[ 0 ], 'quality migration error ledger does not bound the destination error' );
	assert.equal( errorLedger.combinationRule, 'triangle bound no larger than destination signed-off error', 'quality migration uses an undeclared or nonconservative error combination rule' );
	const gainBound = Math.max( ...errorLedger.operatorOrGainBounds.map( ( bound ) => quantityValue( bound, 'quality migration operator gain bound' ) ) );
	const propagatedInputBound = Math.max( ...errorLedger.inputErrors.map( ( error ) => quantityValue( error.boundOrStatistic, `quality migration input error ${ error.errorId}` ) ) ) * gainBound;
	const modeledBound = errorLedger.modeledApproximationTerms.reduce( ( sum, term ) => sum + quantityValue( term, 'quality migration modeled approximation term' ), 0 );
	const numericalBound = errorLedger.numericalTerms.reduce( ( sum, term ) => sum + quantityValue( term, 'quality migration numerical term' ), 0 );
	const outputBound = quantityValue( errorLedger.outputError.boundOrStatistic, 'quality migration output error bound' );
	assert.ok( propagatedInputBound + modeledBound + numericalBound <= outputBound + Number.EPSILON, 'quality migration propagated input, model, and numerical errors exceed the destination signed-off bound' );
	assert.deepEqual( errorLedger.acceptanceGate.bound, errorLedger.outputError.boundOrStatistic, 'quality migration acceptance gate is not the signed-off destination bound' );
	assert.equal( errorLedger.acceptanceGate.status, 'accepted', 'quality migration error propagation was not accepted' );

}

function validateRetirementAndReset( api, route, transition, targets, sourceState ) {

	const retirement = transition.retireAfterCompletion;
	const join = requireRecord( api, retirement.completionJoin, 'ConsumerCompletionJoin', 'qualityTransition.retireAfterCompletion.completionJoin' );
	const authoritative = consumerCompletionJoin( api, route, targets, sourceState );
	assert.deepEqual( retirement.oldResourceLeases, [ SOURCE_LEASE_ID ], 'quality transition retires an unexpected lease set' );
	assert.equal( join.leaseId, SOURCE_LEASE_ID, 'quality completion join protects another lease' );
	assert.equal( join.joinPredicate, 'all-required-consumers-complete-or-loss-invalidated', 'quality completion join has a weaker predicate' );
	const digestPayload = { ...join };
	delete digestPayload.joinDigest;
	assert.equal( join.joinDigest, api.digest( digestPayload ), 'quality completion join digest does not cover its immutable consumer closure' );
	for ( const field of [ 'leaseId', 'joinPredicate', 'deviceLossRetirementPath' ] ) assert.deepEqual( join[ field ], authoritative.join[ field ], `quality retirement join ${ field } differs from authoritative route state` );
	for ( const arm of [ 'simulationConsumers', 'couplingConsumers', 'externalConsumers', 'presentationConsumers' ] ) assert.deepEqual( join[ arm ], authoritative.join[ arm ], `quality retirement ${ arm } do not resolve to authoritative route records` );
	assert.deepEqual( join.requiredConsumerKeys, authoritative.join.requiredConsumerKeys, 'quality retirement required-consumer closure differs from authoritative route records' );
	assert.equal( join.joinDigest, authoritative.join.joinDigest, 'quality retirement join digest differs from authoritative route records' );
	assert.deepEqual( retirement.retirementEvidence.externalConsumerScope, authoritative.externalScope, 'quality retirement external-consumer inclusion/exclusion proof differs from the authoritative adapter inventory' );
	const externalScopePayload = { ...retirement.retirementEvidence.externalConsumerScope };
	delete externalScopePayload.scopeDigest;
	assert.equal( retirement.retirementEvidence.externalConsumerScope.scopeDigest, api.digest( externalScopePayload ), 'quality external-consumer scope digest does not cover its authority boundary and matched receipts' );
	const arms = [ [ 'simulation', join.simulationConsumers ], [ 'coupling', join.couplingConsumers ], [ 'external', join.externalConsumers ], [ 'presentation', join.presentationConsumers ] ];
	assert.ok( join.simulationConsumers.length > 0 && join.couplingConsumers.length > 0, 'quality retirement join must cover active simulation and coupling consumers' );
	assert.deepEqual( [ ...new Set( join.presentationConsumers.map( ( token ) => `${ token.presentationTargetId }/${ token.viewId }` ) ) ].sort(), targets, 'quality retirement join presentation scope differs from the request' );
	const generation = routeGpuGenerationAuthority( route );
	const sourceVersionsBySignal = new Map( sourceState.stateVariablesAndInventories.stateVersions.map( ( version ) => [ version.signalId, version ] ) );
	const tokens = [];
	for ( const [ kind, arm ] of arms ) for ( const token of arm ) {

		requireRecord( api, token, 'CompletionTokenRef', `quality completion token ${ token.tokenId}` );
		assert.equal( token.consumerKind, kind, `quality completion token ${ token.tokenId } appears in the wrong join arm` );
		assert.deepEqual( [ token.backendGeneration, token.deviceLossGeneration ], [ generation.backendGeneration, generation.deviceLossGeneration ], `quality completion token ${ token.tokenId } uses a non-authoritative backend/device-loss generation` );
		if ( kind !== 'presentation' ) assert.equal( token.completionSemantics.status, 'completed', `quality completion token ${ token.tokenId } is not backed by a terminal receipt` );
		if ( kind === 'simulation' || kind === 'coupling' ) {

			const sourceVersion = sourceVersionsBySignal.get( token.completionSemantics.signalId );
			assert.ok( sourceVersion, `quality ${ kind } token ${ token.tokenId } names a non-source signal` );
			assert.equal( token.executionId, token.completionSemantics.stageExecutionId, `quality ${ kind } token ${ token.tokenId } does not expose its exact stage execution` );
			assert.deepEqual( token.completionSemantics.sourceGeneration, sourceStateGeneration( route, sourceVersion ), `quality ${ kind } token ${ token.tokenId } does not bind the exact source state/resource generation` );

		} else if ( kind === 'external' ) {

			const matched = token.completionSemantics.matchedInputStateVersions;
			const tuples = token.completionSemantics.matchedSourceGenerationTuples;
			assert.ok( Array.isArray( matched ) && matched.length > 0, `quality external token ${ token.tokenId } has no exact matched source version` );
			assert.equal( tuples.length, matched.length, `quality external token ${ token.tokenId } generation closure differs from its matched inputs` );
			for ( const [ index, version ] of matched.entries() ) {

				const sourceVersion = sourceVersionsBySignal.get( version.signalId );
				assert.deepEqual( version, sourceVersion, `quality external token ${ token.tokenId } consumes a non-source state version` );
				const expected = sourceStateGeneration( route, sourceVersion );
				assert.deepEqual( tuples[ index ], { deviceId: expected.deviceId, backendGeneration: expected.backendGeneration, deviceLossGeneration: expected.deviceLossGeneration, resourceGeneration: expected.resourceGeneration }, `quality external token ${ token.tokenId } has a stale source resource generation` );

			}

		}
		else {

			const targetKey = `${ token.presentationTargetId }/${ token.viewId }`;
			const execution = route.frameExecutionRecord.targetExecutions[ targetKey ];
			assert.ok( execution?.status === 'completed' && execution.completionTokens.some( ( candidate ) => candidate.tokenId === token.tokenId && api.digest( candidate ) === api.digest( token ) ), `quality presentation token ${ token.tokenId } does not resolve to a completed target execution` );

		}
		tokens.push( token );

	}
	assert.equal( new Set( tokens.map( ( token ) => token.tokenId ) ).size, tokens.length, 'quality completion join contains duplicate token IDs' );
	assert.deepEqual( sortedUnique( join.requiredConsumerKeys, 'quality required consumer keys' ), sortedUnique( tokens.map( ( token ) => token.consumerKey ), 'quality completion token keys' ), 'quality completion join omits or invents a consumer' );
	assert.deepEqual( sortedUnique( retirement.retirementEvidence.completedConsumerKeys, 'quality completed consumer keys' ), sortedUnique( join.requiredConsumerKeys, 'quality join consumer keys' ), 'quality source state retires before every required consumer completes' );
	assert.deepEqual( sortedUnique( retirement.retirementEvidence.completedTokenIds, 'quality completed token IDs' ), sortedUnique( tokens.map( ( token ) => token.tokenId ), 'quality join token IDs' ), 'quality retirement evidence does not close every completion token' );
	assert.equal( retirement.retirementEvidence.resolution, 'all-required-consumers-complete', 'quality retirement has no terminal all-consumer resolution' );
	assert.ok( retirement.retirementEvidence.retirementInstant.timeSecondsDerived.value > transition.commitAtStepBoundary.commitInstant.timeSecondsDerived.value, 'quality source state retires at or before the commit boundary' );
	assert.equal( new Set( transition.resetPlan.map( ( action ) => action.actionId ) ).size, transition.resetPlan.length, 'quality reset plan contains duplicate action IDs' );
	assert.deepEqual( transition.resetPlan.map( ( action ) => `${ action.presentationTargetId }/${ action.viewId }` ).sort(), targets, 'quality reset plan target/view closure mismatch' );
	for ( const action of transition.resetPlan ) {

		requireRecord( api, action, 'ScopedResetAction', `quality reset action ${ action.actionId}` );
		assert.deepEqual( action.causeEpochs, [ transition.fromQualityEpoch, transition.toQualityEpoch ], `quality reset action ${ action.actionId } is not scoped to the exact epoch transition` );
		assert.equal( action.expectedInputHistoryGeneration, `history-${ transition.fromQualityEpoch}`, `quality reset action ${ action.actionId } reads another quality generation` );
		assert.equal( action.expectedOutputHistoryGeneration, `history-${ transition.toQualityEpoch}`, `quality reset action ${ action.actionId } publishes another quality generation` );
		assert.equal( action.policy, 'reset', `quality reset action ${ action.actionId } lacks a conservative history reset` );

	}

}

/** Validate both quality semantic invariants against route-owned records. */
export function validateQualityTransitionBundle( h, route ) {

	const api = qualityApi( h );
	assert.ok( route.physicsQualityRequests && ! Array.isArray( route.physicsQualityRequests ), 'physicsQualityRequests must be a keyed route inventory' );
	assert.ok( route.physicsQualityStates && ! Array.isArray( route.physicsQualityStates ), 'physicsQualityStates must be a keyed route inventory' );
	assert.ok( Array.isArray( route.physicsQualityTransitions ), 'physicsQualityTransitions must be an array' );
	if ( route.physicsQualityTransitions.length === 0 ) {

		assert.deepEqual( route.physicsQualityRequests, {}, 'a route without admitted quality migration cannot retain quality requests' );
		assert.deepEqual( route.physicsQualityStates, {}, 'a route without admitted quality migration cannot retain quality states' );
		return true;

	}
	const requestSequences = Object.values( route.physicsQualityRequests ).map( ( request ) => request.requestSequence );
	assert.ok( requestSequences.every( Number.isSafeInteger ), 'quality request sequences must be structural integers' );
	assert.equal( new Set( requestSequences ).size, requestSequences.length, 'quality request inventory reuses a request sequence' );
	assert.equal( new Set( route.physicsQualityTransitions.map( ( transition ) => transition.transitionId ) ).size, route.physicsQualityTransitions.length, 'quality transition inventory contains duplicate transition IDs' );
	assert.deepEqual( route.physicsQualityTransitions.map( ( transition ) => transition.requestId ).sort(), Object.keys( route.physicsQualityRequests ).sort(), 'quality request/transition inventory closure mismatch' );
	assert.deepEqual( sortedUnique( route.physicsQualityTransitions.flatMap( ( transition ) => [ transition.fromState, transition.toState ] ), 'quality transition endpoint states' ), Object.keys( route.physicsQualityStates ).sort(), 'quality state inventory contains an orphan or omits a transition endpoint' );
	for ( const [ key, request ] of Object.entries( route.physicsQualityRequests ) ) {

		requireRecord( api, request, 'QualityChangeRequest', `physicsQualityRequests.${ key}` );
		assert.equal( key, request.requestId, `physicsQualityRequests key ${ key } does not match requestId` );
		requireRecord( api, request.requestedAllocation, 'QualityAllocationRequest', `physicsQualityRequests.${ key }.requestedAllocation` );
		for ( const [ index, requirement ] of request.admissionRequirements.entries() ) requireRecord( api, requirement, 'QualityAdmissionRequirement', `physicsQualityRequests.${ key }.admissionRequirements[${ index }]` );

	}
	for ( const [ key, state ] of Object.entries( route.physicsQualityStates ) ) {

		requireRecord( api, state, 'PhysicsQualityStateDescriptor', `physicsQualityStates.${ key}` );
		assert.equal( key, state.qualityStateId, `physicsQualityStates key ${ key } does not match qualityStateId` );
		assert.equal( state.contextId, route.physicsContext.contextId, `quality state ${ key } belongs to another PhysicsContext` );

	}
	for ( const [ index, transition ] of route.physicsQualityTransitions.entries() ) {

		requireRecord( api, transition, 'QualityTransition', `physicsQualityTransitions[${ index }]` );
		const request = route.physicsQualityRequests[ transition.requestId ];
		const sourceState = route.physicsQualityStates[ transition.fromState ];
		const destinationState = route.physicsQualityStates[ transition.toState ];
		assert.ok( request && sourceState && destinationState, `quality transition ${ transition.transitionId } has unresolved request/state endpoints` );
		assert.equal( transition.contextId, route.physicsContext.contextId, `quality transition ${ transition.transitionId } context mismatch` );
		assert.equal( transition.requestSequence, request.requestSequence, 'quality transition request sequence differs from the admitted request' );
		assert.deepEqual( transition.affectedTargetsViews, request.affectedTargetsViews, 'quality transition widens or changes request target/view scope' );
		assert.deepEqual( transition.affectedControls, request.rankedCandidateControls, 'quality transition changes the ranked request controls' );
		assert.equal( transition.sourceEvidenceDigest, api.digest( request.evidenceRecords ), 'quality transition source evidence digest does not identify the request evidence' );
		assert.deepEqual( transition.triggerEvidence.pressureRecords, request.evidenceRecords, 'quality transition trigger evidence is not the admitted request evidence' );
		assert.deepEqual( transition.triggerEvidence.errorRecords, sourceState.physicalAndVisualErrorBounds, 'quality transition trigger errors are not the source-state signed-off errors' );
		assert.deepEqual( transition.protectedInvariants, request.protectedInvariants, 'quality transition weakens or changes protected invariants' );
		assert.deepEqual( [ transition.fromQualityEpoch, transition.toQualityEpoch ], [ sourceState.qualityEpoch, destinationState.qualityEpoch ], 'quality transition epoch endpoints do not match state descriptors' );
		const requestAdmission = requireRecord( api, transition.requestAdmission, 'QualityRequestAdmission', `quality transition ${ transition.transitionId } requestAdmission` );
		assert.deepEqual( [ requestAdmission.requestId, requestAdmission.currentQualityStateId, requestAdmission.currentQualityEpoch, requestAdmission.selectedCandidateQualityStateId ], [ request.requestId, sourceState.qualityStateId, sourceState.qualityEpoch, destinationState.qualityStateId ], 'quality request admission does not identify the exact request/source/destination state' );
		assert.equal( requestAdmission.status, 'admitted', 'quality work exists without an admitted QualityRequestAdmission' );
		assert.equal( requestAdmission.coordinatorId, QUALITY_CONTEXT_OWNER, 'quality request admission is not owned by the route physics coordinator' );
		assert.equal( requestAdmission.safeCommitBoundary.kind, 'instant', 'quality request admission lacks an exact safe commit instant' );
		assert.deepEqual( requestAdmission.safeCommitBoundary.instant, transition.commitAtStepBoundary.commitInstant, 'quality commit does not occur at the admitted safe step boundary' );
		assert.deepEqual( transition.commitAtStepBoundary.commitInstant, request.observedInterval.endExclusive, 'quality commit does not close the exact observed coordination interval' );
		assert.equal( requestAdmission.allocationRequestDigest, api.digest( request.requestedAllocation ), 'quality request admission uses another allocation request' );
		assert.deepEqual( requestAdmission.admissionRequirementResults.map( ( result ) => result.requirementId ).sort(), request.admissionRequirements.map( ( requirement ) => requirement.requirementId ).sort(), 'quality request admission requirement closure mismatch' );
		assert.ok( requestAdmission.admissionRequirementResults.every( ( result ) => result.status === 'accepted' ), 'quality request admission contains a failed requirement' );
		for ( const result of requestAdmission.admissionRequirementResults ) {

			const requirement = request.admissionRequirements.find( ( candidate ) => candidate.requirementId === result.requirementId );
			assert.equal( result.evidenceRef, requirement.evidenceRef, `quality request admission result ${ result.requirementId } cites evidence from another requirement` );

		}
		assert.ok( requestAdmission.hysteresisAndMinimumResidenceResults.length > 0 && requestAdmission.hysteresisAndMinimumResidenceResults.every( ( result ) => result.status === 'accepted' ), 'quality request admission lacks accepted hysteresis/minimum-residence results' );
		assert.deepEqual( request.requestedAllocation.affectedTargetsViews, request.affectedTargetsViews, 'quality allocation request widens or narrows target/view scope' );
		const allocation = requireRecord( api, transition.prepare.allocationAdmission, 'QualityAllocationAdmission', `quality transition ${ transition.transitionId } allocationAdmission` );
		assert.deepEqual( [ allocation.allocationRequestId, allocation.transitionId, allocation.status ], [ request.requestedAllocation.allocationRequestId, transition.transitionId, 'admitted' ], 'quality work exists without the exact admitted allocation' );
		assert.ok( transition.prepare.allocateCompilePopulate.length > 0 && transition.prepare.allocateCompilePopulate.every( ( operation ) => operation.startsWith( `after-${ allocation.allocationAdmissionId }:` ) ), 'quality allocate/compile/populate work is not sequenced after allocation admission' );
		validateMemoryLedger( api, route, transition, request, sourceState, destinationState );
		validateQualityStateMap( api, route, transition, sourceState, destinationState );
		const expectedEmitters = destinationState.stateVariablesAndInventories.stateEquations;
		assert.deepEqual( Object.keys( transition.commitAtStepBoundary.authoritativeEmitterByStateEquationOrSourceChannel ).sort(), [ ...expectedEmitters ].sort(), 'quality transition has missing or extra authoritative state-equation emitters' );
		assert.ok( Object.values( transition.commitAtStepBoundary.authoritativeEmitterByStateEquationOrSourceChannel ).every( ( value ) => value === 'exactly-one-owner-and-representation' ), 'quality transition admits more than one emitter for a state equation/source channel' );
		assert.equal( transition.commitAtStepBoundary.atomicPublication, 'required', 'quality migration does not publish state/epoch/emitter authority atomically' );
		validateRetirementAndReset( api, route, transition, sortedUnique( request.affectedTargetsViews, 'quality request target/views' ), sourceState );

	}
	return true;

}

function canonicalTransition( route ) {

	assert.ok( Array.isArray( route.physicsQualityTransitions ) && route.physicsQualityTransitions.length > 0, 'quality reject mutation requires a built quality transition bundle' );
	return route.physicsQualityTransitions[ 0 ];

}

function refreshAllocationRequestAdmissionDigest( route ) {

	const transition = canonicalTransition( route );
	const request = route.physicsQualityRequests[ transition.requestId ];
	transition.requestAdmission.allocationRequestDigest = fallbackDigest( request.requestedAllocation );

}

function refreshAllocationAdmissionReceiptDigest( route ) {

	const allocation = canonicalTransition( route ).prepare.allocationAdmission;
	const payload = structuredClone( allocation );
	delete payload.receiptDigest;
	allocation.receiptDigest = fallbackDigest( payload );

}

function refreshRetirementJoinCopies( route ) {

	const transition = canonicalTransition( route );
	const join = transition.retireAfterCompletion.completionJoin;
	const payload = structuredClone( join );
	delete payload.joinDigest;
	join.joinDigest = fallbackDigest( payload );
	const allocation = transition.prepare.allocationAdmission;
	allocation.retirementJoinRefs = [ structuredClone( join ) ];
	for ( const ledger of [ transition.prepare.predictedPeakResources, allocation.simultaneousOldNewPeakProof ] ) for ( const record of ledger.allocations ) {

		if ( record.encodingFormatAndExtent.generationRole !== 'source' ) continue;
		record.leaseIdsAndCompletionJoins = [ { leaseId: SOURCE_LEASE_ID, completionJoinId: join.joinId, completionJoinDigest: join.joinDigest } ];

	}
	for ( const ledger of [ transition.prepare.predictedPeakResources, allocation.simultaneousOldNewPeakProof ] ) ledger.lifetimeDagDigest = fallbackDigest( ledger.allocations.map( ( record ) => ( { allocationId: record.allocationId, resourceId: record.resourceId, deviceBackendResourceGenerations: record.deviceBackendResourceGenerations, liveInterval: record.liveInterval, frameSlotSubresources: record.encodingFormatAndExtent.frameSlotSubresources, leaseIdsAndCompletionJoins: record.leaseIdsAndCompletionJoins } ) ) );
	const request = route.physicsQualityRequests[ transition.requestId ];
	const framesInFlight = request.requestedAllocation.maximumFramesInFlightAndMultiviewMultiplier.maximumFramesInFlight.value;
	request.requestedAllocation.lifetimeAndRetirementPlanDigest = fallbackDigest( {
		affectedTargetsViews: request.affectedTargetsViews,
		framesInFlight,
		memoryLedgerId: transition.prepare.predictedPeakResources.memoryLedgerId,
		lifetimeDagDigest: transition.prepare.predictedPeakResources.lifetimeDagDigest,
		allocations: transition.prepare.predictedPeakResources.allocations.map( ( record ) => ( {
			allocationId: record.allocationId,
			resourceId: record.resourceId,
			deviceBackendResourceGenerations: record.deviceBackendResourceGenerations,
			liveInterval: record.liveInterval,
			leaseIdsAndCompletionJoins: record.leaseIdsAndCompletionJoins
		} ) )
	} );
	refreshAllocationRequestAdmissionDigest( route );
	refreshAllocationAdmissionReceiptDigest( route );

}

export function rejectDoubleEmitter( route ) {

	canonicalTransition( route ).commitAtStepBoundary.authoritativeEmitterByStateEquationOrSourceChannel[ 'water-state/secondary-representation' ] = 'exactly-one-owner-and-representation';

}

export function rejectEarlyRetire( route ) {

	canonicalTransition( route ).retireAfterCompletion.retirementEvidence.completedConsumerKeys.pop();

}

export function rejectSilentInventoryLoss( route ) {

	route.physicsQualityStates[ DESTINATION_QUALITY_STATE_ID ].stateVariablesAndInventories.conservedInventories[ 'water-volume' ].value -= 1;

}

export function rejectWorkBeforeAdmission( route ) {

	canonicalTransition( route ).prepare.allocationAdmission.status = 'rejected';

}

export function rejectScopeWidening( route ) {

	canonicalTransition( route ).affectedTargetsViews.push( 'unrequested-target/unrequested-view' );

}

export function rejectInsufficientOverlapCapacity( route ) {

	const granted = canonicalTransition( route ).prepare.allocationAdmission.grantedBytesByResidencyAndLifetime.gpuMigrationOverlap;
	granted.value = Math.max( 0, granted.value - 1 );

}

export function rejectRequestEvidenceSwap( route ) {

	route.physicsQualityRequests[ QUALITY_REQUEST_ID ].evidenceRecords[ 0 ].source = 'unadmitted-replacement-trace';

}

export function rejectMissingErrorLedger( route ) {

	delete route.physicsErrorPropagationLedgers[ ERROR_LEDGER_ID ];

}

export function rejectRngCursorReset( route ) {

	canonicalTransition( route ).commitAtStepBoundary.conservativeMap[ 0 ].stableIdRngEventAndLedgerMap.rngStreams[ 'water-subgrid-stream' ].destinationCursor.value = 0;

}

export function rejectEventCursorReset( route ) {

	canonicalTransition( route ).commitAtStepBoundary.conservativeMap[ 0 ].stableIdRngEventAndLedgerMap.eventCursors[ 'body-water-exchange' ].destination.nextSequence = 0;

}

export function rejectExactOnceCursorReset( route ) {

	canonicalTransition( route ).commitAtStepBoundary.conservativeMap[ 0 ].stableIdRngEventAndLedgerMap.exactOnceLedgers[ 'body-water-exchange' ].destination.cursorAfter = 0;

}

export function rejectResetEpochMismatch( route ) {

	canonicalTransition( route ).resetPlan[ 0 ].causeEpochs[ 1 ] = 'quality-epoch-unrelated';

}

export function rejectDestinationResourceAlias( route ) {

	const transition = canonicalTransition( route );
	const sourceBinding = signalById( route, 'water-surface-state' ).residency.bindingIdentity;
	for ( const ledger of [ transition.prepare.predictedPeakResources, transition.prepare.allocationAdmission.simultaneousOldNewPeakProof ] ) {

		const destination = ledger.allocations.find( ( record ) => record.encodingFormatAndExtent.generationRole === 'destination' && record.encodingFormatAndExtent.signalId === 'water-surface-state' );
		destination.residency.bindingIdentity = sourceBinding;

	}
	const request = route.physicsQualityRequests[ transition.requestId ];
	const traffic = request.requestedAllocation.requestedTrafficBytesPerCoordinationIntervalAndSecond.trafficRecords.find( ( record ) => record.resourceIdAndVersion.migrationAccess === 'destination-write' && record.resourceIdAndVersion.signalId === 'water-surface-state' );
	traffic.sourceAndDestinationResidency.source.bindingIdentity = sourceBinding;
	traffic.sourceAndDestinationResidency.destination.bindingIdentity = sourceBinding;
	refreshAllocationRequestAdmissionDigest( route );
	refreshAllocationAdmissionReceiptDigest( route );

}

export function rejectStaleCompletionGeneration( route ) {

	canonicalTransition( route ).retireAfterCompletion.completionJoin.simulationConsumers[ 0 ].completionSemantics.sourceGeneration.resourceGeneration = 'stale-source-resource-generation';
	refreshRetirementJoinCopies( route );

}

export function rejectDetachedExternalAuthority( route ) {

	route.physicsExternalSolverAdaptersById = {};

}

export function rejectMissingSourceReadTraffic( route ) {

	const transition = canonicalTransition( route );
	const request = route.physicsQualityRequests[ transition.requestId ];
	const envelope = request.requestedAllocation.requestedTrafficBytesPerCoordinationIntervalAndSecond;
	const removedIndex = envelope.trafficRecords.findIndex( ( record ) => record.resourceIdAndVersion.migrationAccess === 'source-read' && record.resourceIdAndVersion.signalId === 'water-surface-state' );
	assert.ok( removedIndex >= 0, 'quality missing-source-read reject fixture cannot resolve its canonical water source-read record' );
	const [ removed ] = envelope.trafficRecords.splice( removedIndex, 1 );
	const removedBytes = removed.physicalBytesPerOccurrence.value * removed.occurrenceCount.value;
	envelope.sourceReadBytesPerMigration.value -= removedBytes;
	envelope.totalBytesPerMigration.value -= removedBytes;
	const granted = transition.prepare.allocationAdmission.grantedTrafficAndWorkEnvelope;
	granted.trafficRecordIds = envelope.trafficRecords.map( ( record ) => record.trafficRecordId );
	granted.sourceReadBytesPerMigration = structuredClone( envelope.sourceReadBytesPerMigration );
	granted.totalBytesPerMigration = structuredClone( envelope.totalBytesPerMigration );
	refreshAllocationRequestAdmissionDigest( route );
	refreshAllocationAdmissionReceiptDigest( route );

}

export function rejectOverCapacityEnvelope( route ) {

	const allocation = canonicalTransition( route ).prepare.allocationAdmission;
	const capacityGate = allocation.limitHeadroomAndThermalGateResults.find( ( result ) => result.gate === 'gpu-allocation-capacity' );
	capacityGate.capacity.value = capacityGate.demand.value + capacityGate.requiredHeadroom.value - 1;
	refreshAllocationAdmissionReceiptDigest( route );

}

export const qualityTransitionRejectMutations = Object.freeze( {
	'double-emitter': rejectDoubleEmitter,
	'early-retire': rejectEarlyRetire,
	'silent-inventory-loss': rejectSilentInventoryLoss,
	'work-before-admission': rejectWorkBeforeAdmission,
	'scope-widening': rejectScopeWidening,
	'insufficient-overlap-capacity': rejectInsufficientOverlapCapacity,
	'request-evidence-swap': rejectRequestEvidenceSwap,
	'missing-error-ledger': rejectMissingErrorLedger,
	'rng-cursor-reset': rejectRngCursorReset,
	'event-cursor-reset': rejectEventCursorReset,
	'exact-once-cursor-reset': rejectExactOnceCursorReset,
	'reset-epoch-mismatch': rejectResetEpochMismatch,
	'destination-resource-alias': rejectDestinationResourceAlias,
	'stale-completion-generation': rejectStaleCompletionGeneration,
	'detached-external-authority': rejectDetachedExternalAuthority,
	'missing-source-read-traffic': rejectMissingSourceReadTraffic,
	'over-capacity-envelope': rejectOverCapacityEnvelope
} );
