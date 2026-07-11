import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const ENVIRONMENT_CHANNEL_FIELDS = Object.freeze( [
	'airVelocityMps',
	'airDensityKgPerM3',
	'airPressurePa',
	'temperatureK',
	'specificHumidityKgPerKg',
	'turbulenceStatistics',
	'precipitationMassFluxKgPerM2S',
	'precipitationPhase',
	'precipitationVelocityMps',
	'mediumMaterialVelocityMps'
] );

const PRECIPITATION_CHANNEL_FIELDS = Object.freeze( [
	'emittedMassFluxKgPerM2S',
	'phase',
	'emissionVelocityMps',
	'airborneInventory'
] );

const WATER_CHANNEL_FIELDS = Object.freeze( [
	'freeSurfacePoint',
	'freeSurfaceNormal',
	'geometricNormalVelocityMps',
	'surfacePointVelocityMps',
	'materialCurrentVelocityMps',
	'waterColumnDepthMeters',
	'densityKgPerM3',
	'materialAccelerationMps2',
	'pressurePa',
	'bathymetryPoint',
	'wetDryState'
] );

const WATER_REQUIRED_FIELDS = Object.freeze( [
	'freeSurfacePoint',
	'freeSurfaceNormal',
	'geometricNormalVelocityMps'
] );

const WATER_OPTIONAL_FIELDS = Object.freeze( WATER_CHANNEL_FIELDS.filter( ( id ) => ! WATER_REQUIRED_FIELDS.includes( id ) ) );

const ENVIRONMENT_SPECS = Object.freeze( [
	channelSpec( 'airVelocityMps', 'Vec3', 'rank-1[3]', 'metre-per-second', 'polar-vector', 'intensive', 0.05 ),
	channelSpec( 'airDensityKgPerM3', 'scalar', 'rank-0', 'kilogram-per-cubic-metre', 'scalar', 'intensive', 0.01 ),
	channelSpec( 'airPressurePa', 'scalar', 'rank-0', 'pascal', 'scalar', 'intensive', 5 ),
	channelSpec( 'temperatureK', 'scalar', 'rank-0', 'kelvin', 'scalar', 'intensive', 0.1 ),
	channelSpec( 'specificHumidityKgPerKg', 'scalar', 'rank-0', 'kilogram-per-kilogram', 'scalar', 'intensive', 0.0001 ),
	channelSpec( 'turbulenceStatistics', 'structured-statistics', 'structured', 'square-metre-per-square-second', 'structured', 'intensive', 0.05 ),
	channelSpec( 'precipitationMassFluxKgPerM2S', 'scalar', 'rank-0', 'kilogram-per-square-metre-second', 'scalar', 'intensive', 0.001 ),
	channelSpec( 'precipitationPhase', 'phase-mass-fractions', 'structured', 'dimensionless', 'structured', 'intensive', 0.000001 ),
	channelSpec( 'precipitationVelocityMps', 'Vec3', 'rank-1[3]', 'metre-per-second', 'polar-vector', 'intensive', 0.02 ),
	channelSpec( 'mediumMaterialVelocityMps', 'Vec3', 'rank-1[3]', 'metre-per-second', 'polar-vector', 'intensive', 0.05 )
] );

const PRECIPITATION_SPECS = Object.freeze( [
	channelSpec( 'emittedMassFluxKgPerM2S', 'scalar', 'rank-0', 'kilogram-per-square-metre-second', 'scalar', 'intensive', 0.001, 'interval-average' ),
	channelSpec( 'phase', 'phase-mass-fractions', 'structured', 'dimensionless', 'structured', 'intensive', 0.000001, 'interval-average' ),
	channelSpec( 'emissionVelocityMps', 'Vec3', 'rank-1[3]', 'metre-per-second', 'polar-vector', 'intensive', 0.02, 'interval-average' ),
	channelSpec( 'airborneInventory', 'MassInventory', 'tagged-union', 'kilogram', 'structured', 'extensive', 0.000001, 'state-over-interval' )
] );

const WATER_SPECS = Object.freeze( [
	channelSpec( 'freeSurfacePoint', 'Vec3', 'rank-1[3]', 'metre', 'structured', 'geometric', 0.002 ),
	channelSpec( 'freeSurfaceNormal', 'Vec3', 'rank-1[3]', 'dimensionless', 'covector', 'geometric', 0.002 ),
	channelSpec( 'geometricNormalVelocityMps', 'scalar', 'rank-0', 'metre-per-second', 'scalar', 'geometric', 0 ),
	channelSpec( 'surfacePointVelocityMps', 'Vec3', 'rank-1[3]', 'metre-per-second', 'polar-vector', 'geometric', 0.003 ),
	channelSpec( 'materialCurrentVelocityMps', 'Vec3', 'rank-1[3]', 'metre-per-second', 'polar-vector', 'intensive', 0.004 ),
	channelSpec( 'waterColumnDepthMeters', 'scalar', 'rank-0', 'metre', 'scalar', 'geometric', 0.005 ),
	channelSpec( 'densityKgPerM3', 'scalar', 'rank-0', 'kilogram-per-cubic-metre', 'scalar', 'intensive', 0.5 ),
	channelSpec( 'materialAccelerationMps2', 'Vec3', 'rank-1[3]', 'metre-per-second-squared', 'polar-vector', 'intensive', 0.02 ),
	channelSpec( 'pressurePa', 'scalar', 'rank-0', 'pascal', 'scalar', 'intensive', 10 ),
	channelSpec( 'bathymetryPoint', 'Vec3', 'rank-1[3]', 'metre', 'structured', 'geometric', 0.01 ),
	channelSpec( 'wetDryState', 'wet-dry-state', 'categorical', 'dimensionless', 'structured', 'categorical', 0 )
] );

function channelSpec( id, valueType, tensorRankAndShape, unit, basisBehavior, quantityClass, errorBound, timeSemantics = 'instant' ) {

	return Object.freeze( {
		id, valueType, tensorRankAndShape, unit, basisBehavior, quantityClass,
		samplingMeasure: id.startsWith( 'freeSurface' ) || WATER_CHANNEL_FIELDS.includes( id ) ? 'point' : 'area',
		errorBound, timeSemantics
	} );

}

function requireHelper( helpers, name ) {

	assert.equal( typeof helpers?.[ name ], 'function', `provider/water fixture requires helper ${ name }` );
	return helpers[ name ];

}

function helperSet( helpers ) {

	return {
		clone: requireHelper( helpers, 'clone' ),
		evidence: requireHelper( helpers, 'evidence' ),
		fixtureDurationSeconds: requireHelper( helpers, 'fixtureDurationSeconds' ),
		fixtureError: requireHelper( helpers, 'fixtureError' ),
		fixtureInstant: requireHelper( helpers, 'fixtureInstant' ),
		fixtureInterval: requireHelper( helpers, 'fixtureInterval' ),
		requireAbiRecord: requireHelper( helpers, 'requireAbiRecord' ),
		typedAbsence: requireHelper( helpers, 'typedAbsence' )
	};

}

function instantTime( clone, typedAbsence, instant, authority ) {

	return {
		kind: 'instant',
		instant: clone( instant ),
		interval: typedAbsence( 'not-applicable', authority, 'timeless', 'inactive PhysicsTime interval arm' )
	};

}

function intervalTime( clone, typedAbsence, interval, authority ) {

	return {
		kind: 'interval',
		instant: typedAbsence( 'not-applicable', authority, 'timeless', 'inactive PhysicsTime instant arm' ),
		interval: clone( interval )
	};

}

function makeSupport( h, fields ) {

	return {
		supportId: fields.supportId,
		kind: fields.kind,
		physicsFrameId: fields.physicsFrameId,
		physicsOriginEpoch: fields.physicsOriginEpoch,
		transformRevision: fields.transformRevision,
		chartId: fields.chartId,
		geometry: fields.geometry,
		orientation: fields.orientation,
		measureUnit: fields.measureUnit,
		representedMeasure: h.evidence( fields.measure, fields.measureUnit, 'Derived', fields.measureSource ),
		error: h.fixtureError( fields.measureUnit, fields.measureError, `${ fields.supportId }-support` )
	};

}

function makeFilter( h, fields ) {

	return {
		filterId: fields.filterId,
		supportMeasure: fields.supportMeasure,
		kernelOrTransferFunction: fields.kernelOrTransferFunction,
		spatialBandwidth: fields.spatialBandwidth,
		temporalBandwidth: fields.temporalBandwidth,
		phaseSemantics: fields.phaseSemantics,
		normalization: fields.normalization,
		causality: fields.causality,
		error: h.fixtureError( 'ratio', fields.errorBound, `${ fields.filterId }-filter` )
	};

}

function makeValidity( h, interval, owner ) {

	return {
		status: 'valid',
		domain: 'closed fixture support, time, frame, origin epoch, transform revision, filter, and state version',
		validTime: intervalTime( h.clone, h.typedAbsence, interval, owner ),
		staleAfter: h.fixtureDurationSeconds( 1 / 60, 'one coordination interval staleness gate' ),
		reason: h.typedAbsence( 'not-applicable', owner, 'timeless', 'valid channel has no failure reason' ),
		acceptanceGate: 'all requested channels are atomically valid within one coordination interval'
	};

}

function makeAbsentMirror( h, owner ) {

	const absent = ( reason = 'unavailable' ) => h.typedAbsence( reason, owner, 'timeless', 'no host/device mirror is represented' );
	return {
		kind: 'absent',
		sourceStateVersion: absent(),
		mirrorStateVersion: absent(),
		availableAt: absent(),
		age: absent(),
		error: absent(),
		synchronization: absent()
	};

}

function makeResidency( h, fields ) {

	const host = fields.kind === 'cpu';
	return {
		kind: fields.kind,
		deviceId: host ? h.typedAbsence( 'not-applicable', fields.owner, 'timeless', 'host-owned snapshot' ) : fields.deviceId,
		queueId: host ? h.typedAbsence( 'not-applicable', fields.owner, 'timeless', 'host-owned snapshot' ) : fields.queueId,
		bindingIdentity: fields.bindingIdentity,
		sameQueueAvailability: fields.availability,
		hostVisibility: host ? 'host-visible' : 'not-host-visible',
		mirror: makeAbsentMirror( h, fields.owner ),
		readbackPolicy: host ? 'forbidden' : 'diagnostic-delayed-only'
	};

}

function makeLatency( h, fields ) {

	return {
		productionDelay: h.fixtureDurationSeconds( fields.productionDelaySeconds, `${ fields.owner } production delay` ),
		consumerAvailability: fields.consumerAvailability,
		maximumStaleness: h.fixtureDurationSeconds( fields.maximumStalenessSeconds, `${ fields.owner } maximum staleness` ),
		hostVisibleDelay: fields.hostVisible ? h.fixtureDurationSeconds( fields.productionDelaySeconds, `${ fields.owner } host visibility` ) : h.typedAbsence( 'unavailable', fields.owner, 'timeless', 'authoritative GPU state has no frame-critical host visibility' ),
		clockMappingRevision: fields.clockMappingRevision,
		error: h.fixtureError( 'second', 0.000001, `${ fields.owner } latency mapping` )
	};

}

function makeDescriptor( h, fields ) {

	const validity = makeValidity( h, fields.validityInterval, fields.owner );
	const perChannelError = Object.fromEntries( fields.specs.map( ( spec ) => {

		const error = h.fixtureError( spec.unit, spec.errorBound, `${ fields.signalId }-${ spec.id }` );
		error.errorId = `${ fields.signalId }/error/${ spec.id }`;
		error.quantityOrChannelId = spec.id;
		return [ spec.id, error ];

	} ) );
	for ( const [ channelId, error ] of Object.entries( fields.errorOverrides ?? {} ) ) {

		perChannelError[ channelId ] = h.clone( error );
		perChannelError[ channelId ].errorId = `${ fields.signalId }/error/${ channelId }`;
		perChannelError[ channelId ].quantityOrChannelId = channelId;

	}
	const channels = Object.fromEntries( fields.specs.map( ( spec ) => {

		const declaredSupport = fields.supportByChannel?.[ spec.id ] ?? fields.support;
		const declaredFilter = fields.filterByChannel?.[ spec.id ] ?? fields.filter;
		return [ spec.id, {
		channelId: spec.id,
		valueType: spec.valueType,
		tensorRankAndShape: spec.tensorRankAndShape,
		unit: spec.unit,
		basisBehavior: spec.basisBehavior,
		quantityClass: spec.quantityClass,
		samplingMeasure: declaredSupport.kind === 'global' ? 'none' : declaredSupport.kind,
		declaredSupport: h.clone( declaredSupport ),
		declaredFilter: h.clone( declaredFilter ),
		timeSemantics: spec.timeSemantics,
		validity: h.clone( validity ),
		errorRef: perChannelError[ spec.id ].errorId
	} ];

	} ) );
	return {
		signalId: fields.signalId,
		providerId: fields.providerId,
		schemaId: fields.schemaId,
		contextId: fields.contextId,
		owner: fields.owner,
		consumers: fields.consumers,
		channels,
		physicsFrameId: fields.physicsFrameId,
		physicsOriginEpoch: fields.physicsOriginEpoch,
		transformRevision: fields.transformRevision,
		chartId: fields.chartId,
		clockId: fields.clockId,
		samplePhase: fields.samplePhase,
		representedFootprint: h.clone( fields.support ),
		filter: h.clone( fields.filter ),
		validity,
		perChannelError,
		residency: makeResidency( h, fields.residency ),
		cadence: {
			kind: fields.cadenceKind,
			clockId: fields.clockId,
			intervalOrTrigger: h.fixtureDurationSeconds( fields.cadenceSeconds, `${ fields.owner } cadence` ),
			samplePhase: fields.samplePhase,
			jitterBound: h.fixtureDurationSeconds( 0.000001, `${ fields.owner } cadence jitter` ),
			maximumBurst: h.evidence( 1, 'execution', 'Gated', `${ fields.owner } immutable snapshot publication` ),
			evidence: fields.cadenceEvidence
		},
		latency: makeLatency( h, fields.latency ),
		stateVersion: fields.stateVersion,
		resourceGeneration: fields.resourceGeneration === null ? {
			kind: 'absent',
			generation: h.typedAbsence( 'not-applicable', fields.owner, 'timeless', 'host snapshot has no GPU resource generation' )
		} : { kind: 'present', generation: fields.resourceGeneration },
		missingChannelPolicy: 'report-absent'
	};

}

function makeSampledChannel( h, descriptor, channelId, value, actualPhysicsTime ) {

	const channel = descriptor.channels[ channelId ];
	assert.ok( channel, `descriptor ${ descriptor.signalId } has no channel ${ channelId }` );
	return {
		channelId,
		value: h.clone( value ),
		unit: channel.unit,
		actualPhysicsTime: h.clone( actualPhysicsTime ),
		actualSupport: h.clone( channel.declaredSupport ),
		actualFilter: h.clone( channel.declaredFilter ),
		validity: 'valid',
		error: h.clone( descriptor.perChannelError[ channelId ] ),
		stateVersion: descriptor.stateVersion
	};

}

function absenceAt( h, owner, time, channelId ) {

	return h.typedAbsence( 'not-requested', owner, h.clone( time ), `${ channelId } was omitted explicitly by the canonical fixture request` );

}

function vectorNorm( value ) {

	return Math.hypot( ...value );

}

function vectorL1Norm( value ) {

	return value.reduce( ( sum, component ) => sum + Math.abs( component ), 0 );

}

function dot( left, right ) {

	return left.reduce( ( sum, value, index ) => sum + value * right[ index ], 0 );

}

function canonicalJson( value ) {

	if ( Array.isArray( value ) ) return `[${ value.map( canonicalJson ).join( ',' ) }]`;
	if ( value && typeof value === 'object' ) return `{${ Object.keys( value ).sort().map( ( key ) => `${ JSON.stringify( key ) }:${ canonicalJson( value[ key ] ) }` ).join( ',' ) }}`;
	return JSON.stringify( value );

}

function sha256Canonical( value ) {

	return `sha256:${ createHash( 'sha256' ).update( canonicalJson( value ) ).digest( 'hex' ) }`;

}

function canonicalUtf8Bytes( value ) {

	return new TextEncoder().encode( canonicalJson( value ) ).byteLength;

}

function sha256CanonicalExcluding( value, excludedKeys ) {

	const copy = structuredClone( value );
	for ( const key of excludedKeys ) delete copy[ key ];
	return sha256Canonical( copy );

}

function quantityValue( quantity, label ) {

	assert.ok( quantity && typeof quantity === 'object', `${ label } must be a labelled quantity` );
	assert.equal( typeof quantity.value, 'number', `${ label }.value must be numeric` );
	assert.ok( Number.isFinite( quantity.value ), `${ label }.value must be finite` );
	return quantity.value;

}

function quantityValueIn( quantity, expectedUnit, label ) {

	assert.equal( quantity?.unit, expectedUnit, `${ label }.unit must be ${ expectedUnit }` );
	return quantityValue( quantity, label );

}

function durationSeconds( interval ) {

	return quantityValue( interval.endExclusive.timeSecondsDerived, 'interval.endExclusive.timeSecondsDerived' ) - quantityValue( interval.start.timeSecondsDerived, 'interval.start.timeSecondsDerived' );

}

function sortedKeys( value ) {

	return Object.keys( value ).sort();

}

function assertSetEqual( actual, expected, label ) {

	assert.deepEqual( [ ...new Set( actual ) ].sort(), [ ...new Set( expected ) ].sort(), label );

}

function assertNear( actual, expected, tolerance, label ) {

	assert.ok( Number.isFinite( actual ), `${ label } actual value is not finite` );
	assert.ok( Number.isFinite( expected ), `${ label } expected value is not finite` );
	assert.ok( Math.abs( actual - expected ) <= tolerance, `${ label }: ${ actual } is not within ${ tolerance } of ${ expected }` );

}

function contextFields( route ) {

	const context = route?.physicsContext;
	assert.ok( context && typeof context === 'object', 'provider/water fixture requires route.physicsContext' );
	const clockRegistry = context.physicsClockRegistry;
	const clocks = clockRegistry?.clocksById;
	assert.ok( clocks && typeof clocks === 'object', 'provider/water fixture requires physicsClockRegistry.clocksById' );
	const clockId = clockRegistry.coordinationClockId;
	assert.ok( clocks[ clockId ], `coordination clock ${ clockId } is not registered` );
	const frame = context.physicsFrameRegistry?.framesById?.[ context.physicsRootFrameId ];
	assert.ok( frame, `physics root frame ${ context.physicsRootFrameId } is not registered` );
	return {
		context,
		clocks,
		clockId,
		physicsFrameId: context.physicsRootFrameId,
		physicsOriginEpoch: context.physicsOriginEpoch,
		transformRevision: frame.transformRevision
	};

}

function buildPrecipitationGraphLineage( h, route, fields ) {

	const context = route.physicsContext;
	const graphId = 'provider-precipitation-graph-v4';
	const graphRevision = 'provider-precipitation-graph-revision-v4';
	const coordinationAdvanceId = 'provider-precipitation-advance-42-44-v4';
	const commitGroupId = 'provider-precipitation-commit-group-v4';
	const commitTransactionId = 'provider-precipitation-commit-transaction-v4';
	const coordinationInterval = h.fixtureInterval( fields.clocks, fields.clockId, 42, 44 );
	const intervalNPlusOne = h.fixtureInterval( fields.clocks, fields.clockId, 43, 44 );
	const cpuResidency = h.clone( fields.precipitationDescriptor.residency );
	const noResource = ( authority, reason ) => h.typedAbsence( 'not-applicable', authority, 'timeless', reason );
	const executionRule = ( source ) => ( {
		activation: 'per-advance', partition: 'single', maximumActivationsPerAdvance: h.evidence( 1, 'activation', 'Gated', source ),
		maximumExecutionsPerActivation: h.evidence( 1, 'execution', 'Gated', source ), nativeSubcycleSelection: 'fixed-count', ordering: 'monotonic-interval-then-native-sequence'
	} );
	const makeRead = ( readId, signalId, stateVersionRule, disposition, time, samplePhase, dependencyId, owner ) => ( {
		readId, signalId, requiredStateVersionRule: 'exact-named-version', requiredDisposition: disposition, requestedTime: h.clone( time ), samplePhase,
		maximumStaleness: h.fixtureDurationSeconds( 1 / 60, `${ readId } maximum staleness` ),
		dependencyId: dependencyId ?? noResource( owner, `${ readId } resolves an already committed predecessor without a same-advance edge` ),
		consumerTolerance: { stateVersionRule, validity: 'valid', unitAndSupport: 'exact descriptor match' }
	} );
	const makeWrite = ( writeId, signalId, producedTime, claimId, owner ) => ( {
		writeId, signalId, producedStateVersionRule: 'execution-derived-unique-version', disposition: 'transaction-prepared', producedTime: h.clone( producedTime ),
		commitGroupId, stateAdvanceClaimId: claimId ?? noResource( owner, `${ writeId } is a commit token and does not advance a physical equation` ), publicationEligibility: 'transaction-commit-only'
	} );
	const intervalNTime = intervalTime( h.clone, h.typedAbsence, fields.intervalN, 'causal-cloud-microphysics-provider' );
	const intervalNPlusOneTime = intervalTime( h.clone, h.typedAbsence, intervalNPlusOne, '$threejs-rain-snow-and-wet-surfaces' );
	const coordinationTime = intervalTime( h.clone, h.typedAbsence, coordinationInterval, 'route-physics-coordinator' );
	const stageSpecs = [
		{
			stageId: 'publish-cloud-emission-interval-n-v4', stageKind: 'sample-forcing', owner: 'causal-cloud-microphysics-provider', interval: fields.intervalN, samplePhase: 'interval-end',
			reads: [ makeRead( 'cloud-emission-read-environment-v4', fields.environmentDescriptor.signalId, fields.environmentDescriptor.stateVersion, 'committed', instantTime( h.clone, h.typedAbsence, fields.environmentSnapshot.sampleInstant, 'project-environment-coordinator' ), 'interval-start', null, 'causal-cloud-microphysics-provider' ) ],
			writes: [ makeWrite( 'cloud-emission-write-v4', fields.precipitationDescriptor.signalId, intervalNTime, 'cloud-emission-claim-v4', 'causal-cloud-microphysics-provider' ) ], nativeStepRule: 'fixed'
		},
		{
			stageId: 'consume-cloud-emission-interval-n-plus-one-v4', stageKind: 'solve-subcycles', owner: '$threejs-rain-snow-and-wet-surfaces', interval: intervalNPlusOne, samplePhase: 'substep-stage',
			reads: [ makeRead( 'precipitation-transport-read-emission-v4', fields.precipitationDescriptor.signalId, `${ fields.precipitationDescriptor.stateVersion }/prepared`, 'transaction-prepared', intervalNTime, 'substep-stage', 'dependency-cloud-emission-to-transport-v4', '$threejs-rain-snow-and-wet-surfaces' ) ],
			writes: [ makeWrite( 'precipitation-transport-write-v4', 'precipitation-transport-state', intervalNPlusOneTime, 'precipitation-transport-claim-v4', '$threejs-rain-snow-and-wet-surfaces' ) ], nativeStepRule: 'fixed'
		},
		{
			stageId: 'commit-precipitation-control-volume-v4', stageKind: 'commit', owner: 'route-physics-coordinator', interval: coordinationInterval, samplePhase: 'interval-end',
			reads: [
				makeRead( 'precipitation-commit-read-emission-v4', fields.precipitationDescriptor.signalId, `${ fields.precipitationDescriptor.stateVersion }/prepared`, 'transaction-prepared', intervalNTime, 'interval-end', 'dependency-cloud-emission-to-commit-v4', 'route-physics-coordinator' ),
				makeRead( 'precipitation-commit-read-transport-v4', 'precipitation-transport-state', 'precipitation-transport-state-v4/prepared', 'transaction-prepared', intervalNPlusOneTime, 'interval-end', 'dependency-transport-to-commit-v4', 'route-physics-coordinator' )
			],
			writes: [ makeWrite( 'precipitation-commit-token-write-v4', 'precipitation-commit-token', coordinationTime, null, 'route-physics-coordinator' ) ], nativeStepRule: 'event'
		},
		{
			stageId: 'publish-precipitation-candidate-v4', stageKind: 'publish-presentation', owner: 'route-physics-coordinator', interval: coordinationInterval, samplePhase: 'analytic-at-request',
			reads: [ makeRead( 'precipitation-candidate-read-token-v4', 'precipitation-commit-token', 'precipitation-commit-token-v4/prepared', 'transaction-prepared', coordinationTime, 'analytic-at-request', 'dependency-commit-to-candidate-v4', 'route-physics-coordinator' ) ],
			writes: [], nativeStepRule: 'analytic'
		}
	];
	const stages = stageSpecs.map( ( spec ) => ( {
		stageId: spec.stageId, stageKind: spec.stageKind, owner: spec.owner, clockId: fields.clockId, executionInterval: h.clone( spec.interval ), samplePhase: spec.samplePhase,
		reads: spec.reads, writes: spec.writes, immutableSubstepParameters: { parameterRecordId: `${ spec.stageId }-parameters`, version: 'provider-precipitation-parameters-v4' },
		nativeStepRule: spec.nativeStepRule, executionRule: executionRule( `${ spec.stageId } execution bound` ), executionResidency: h.clone( cpuResidency ),
		failurePolicy: 'reject complete coordination advance and preserve prior committed precipitation inventories'
	} ) );
	const edgeSpecs = [
		[ 'cloud-emission-to-transport-v4', stages[ 0 ], stages[ 1 ], fields.precipitationDescriptor.signalId, `${ fields.precipitationDescriptor.stateVersion }/prepared`, 'dependency-cloud-emission-to-transport-v4' ],
		[ 'cloud-emission-to-commit-v4', stages[ 0 ], stages[ 2 ], fields.precipitationDescriptor.signalId, `${ fields.precipitationDescriptor.stateVersion }/prepared`, 'dependency-cloud-emission-to-commit-v4' ],
		[ 'transport-to-commit-v4', stages[ 1 ], stages[ 2 ], 'precipitation-transport-state', 'precipitation-transport-state-v4/prepared', 'dependency-transport-to-commit-v4' ],
		[ 'commit-to-candidate-v4', stages[ 2 ], stages[ 3 ], 'precipitation-commit-token', 'precipitation-commit-token-v4/prepared', 'dependency-commit-to-candidate-v4' ]
	];
	const edges = edgeSpecs.map( ( [ edgeId, producer, consumer, signalId, stateVersion, dependencyId ] ) => ( {
		edgeId, producerStageId: producer.stageId, consumerStageId: consumer.stageId, payload: { kind: 'state-version-ref', signalId },
		requiredVersionAndPhase: { signalId, stateVersion, disposition: 'transaction-prepared', samplePhase: consumer.samplePhase }, interpolationExtrapolation: 'not-used',
		maximumStaleness: h.fixtureDurationSeconds( 0, `${ edgeId } exact-boundary handoff` ),
		latency: { productionDelay: h.fixtureDurationSeconds( 0, `${ edgeId } production delay` ), consumerAvailability: `completed dependency ${ dependencyId }`, maximumStaleness: h.fixtureDurationSeconds( 0, `${ edgeId } exact-boundary staleness` ), hostVisibleDelay: h.fixtureDurationSeconds( 0, `${ edgeId } CPU visibility` ), clockMappingRevision: coordinationInterval.intervalMappingRevision, error: h.fixtureError( 'second', 0, `${ edgeId } latency` ) },
		barrier: { dependencyId, requiredCompletionVersion: 'completion-v1' }, absencePolicy: 'block'
	} ) );
	const dependencies = edgeSpecs.map( ( [ , producer, consumer, signalId, stateVersion, dependencyId ] ) => ( {
		dependencyId, kind: 'cpu-data', producerStageId: producer.stageId, consumerStageId: consumer.stageId, payloadSchemaAndVersionRule: { signalId, stateVersion },
		producerResidencyRule: 'immutable host prepared publication', consumerResidencyRule: 'same host process immutable read', resourceSubresourceRule: noResource( 'route-physics-coordinator', `${ dependencyId } has no GPU subresource` ),
		accessTransitionRule: 'producer immutable write completion before consumer read', generationCompatibilityRule: noResource( 'route-physics-coordinator', `${ dependencyId } has no GPU generation` ),
		releaseAcquireProtocol: { release: 'producer execution receipt', acquire: 'consumer first read after exact receipt' }, externalFenceOrHostVisibilityRule: { hostVisibility: 'producer completion receipt in same process' }, completionSemantics: 'one completion instance per exact producer/consumer execution pair'
	} ) );
	const executionSpecs = [
		[ stages[ 0 ], fields.intervalN, [], [ { writeId: 'cloud-emission-write-v4', preparedVersion: `${ fields.precipitationDescriptor.stateVersion }/prepared`, contentDigest: sha256Canonical( fields.precipitationSnapshot ) } ], [ 'cloud-emission-claim-v4' ] ],
		[ stages[ 1 ], intervalNPlusOne, [ { readId: 'precipitation-transport-read-emission-v4', stateVersion: `${ fields.precipitationDescriptor.stateVersion }/prepared`, requestedTime: h.clone( intervalNTime ) } ], [ { writeId: 'precipitation-transport-write-v4', preparedVersion: 'precipitation-transport-state-v4/prepared', contentDigest: sha256Canonical( fields.massClosure ) } ], [ 'precipitation-transport-claim-v4' ] ],
		[ stages[ 2 ], coordinationInterval, [ { readId: 'precipitation-commit-read-emission-v4', stateVersion: `${ fields.precipitationDescriptor.stateVersion }/prepared`, requestedTime: h.clone( intervalNTime ) }, { readId: 'precipitation-commit-read-transport-v4', stateVersion: 'precipitation-transport-state-v4/prepared', requestedTime: h.clone( intervalNPlusOneTime ) } ], [ { writeId: 'precipitation-commit-token-write-v4', preparedVersion: 'precipitation-commit-token-v4/prepared', contentDigest: sha256Canonical( { interval: coordinationInterval, status: 'prepared' } ) } ], [] ],
		[ stages[ 3 ], coordinationInterval, [ { readId: 'precipitation-candidate-read-token-v4', stateVersion: 'precipitation-commit-token-v4/prepared', requestedTime: h.clone( coordinationTime ) } ], [], [] ]
	];
	const stageExecutions = executionSpecs.map( ( [ stage, executionInterval, readResolutions, writeResolutions, claimIds ], executionSequence ) => ( {
		executionId: `${ coordinationAdvanceId }/${ stage.stageId }`, coordinationAdvanceId, stageId: stage.stageId, executionSequence, executionInterval: h.clone( executionInterval ), coordinationCoverageInterval: h.clone( coordinationInterval ),
		coordinationClockMappingProof: 'identity map on physics-fixed clock with exact rational endpoints', subcycleIndex: noResource( stage.owner, 'single execution has no subcycle index' ), couplingLoopId: noResource( stage.owner, 'acyclic precipitation transport has no coupling loop' ), iterationIndex: noResource( stage.owner, 'acyclic precipitation transport has no iteration index' ),
		readResolutions, writeResolutions, dependencyCompletions: [], stateAdvanceClaimIds: claimIds, interactionApplicationLedgerIds: [], status: 'completed', completionReceiptDigest: `sha256:${ coordinationAdvanceId }-${ stage.stageId }-completion`
	} ) );
	const executionByStage = new Map( stageExecutions.map( ( execution ) => [ execution.stageId, execution ] ) );
	const dependencyCompletions = edgeSpecs.map( ( [ edgeId, producer, consumer, signalId, stateVersion, dependencyId ] ) => {

		const producerExecution = executionByStage.get( producer.stageId );
		const consumerExecution = executionByStage.get( consumer.stageId );
		const completionId = `completion-${ edgeId}`;
		const completion = {
			completionId, dependencyId, coordinationAdvanceId, producerExecutionId: producerExecution.executionId, consumerExecutionId: consumerExecution.executionId,
			payloadAndVersion: { signalId, stateVersion }, producerResidency: h.clone( cpuResidency ), consumerResidency: h.clone( cpuResidency ),
			resourceIdentityAndSubresource: noResource( 'route-physics-coordinator', 'CPU immutable record has no GPU subresource' ), accessTransition: 'immutable-producer-write-to-consumer-read',
			deviceBackendResourceGenerations: noResource( 'route-physics-coordinator', 'CPU immutable record has no device generation' ), producerRelease: { completionReceiptDigest: producerExecution.completionReceiptDigest },
			consumerAcquire: { firstUseExecutionId: consumerExecution.executionId, requiredProducerReceiptDigest: producerExecution.completionReceiptDigest }, externalFenceOrHostVisibility: { proof: 'same-process immutable record visible after producer completion receipt' },
			status: 'completed', receiptDigest: `sha256:${ completionId }`
		};
		consumerExecution.dependencyCompletions.push( { completionId, dependencyId, receiptDigest: completion.receiptDigest } );
		return completion;

	} );
	const stateAdvanceClaims = [
		{
			claimId: 'cloud-emission-claim-v4', contextId: context.contextId, coordinationAdvanceId, owner: 'causal-cloud-microphysics-provider', stateEquationId: 'cloud-precipitation-emission-state', kind: 'state-advance',
			inputCommittedVersions: [ { signalId: fields.environmentDescriptor.signalId, stateVersion: fields.environmentDescriptor.stateVersion } ], outputPreparedVersion: { signalId: fields.precipitationDescriptor.signalId, stateVersion: `${ fields.precipitationDescriptor.stateVersion }/prepared` },
			applicationInterval: h.clone( fields.intervalN ), nativeExecutionIds: [ stageExecutions[ 0 ].executionId ], interactionApplicationLedgerIds: [], exactOnceAdvanceKey: `${ coordinationAdvanceId }|cloud-emission|42-43`
		},
		{
			claimId: 'precipitation-transport-claim-v4', contextId: context.contextId, coordinationAdvanceId, owner: '$threejs-rain-snow-and-wet-surfaces', stateEquationId: 'airborne-precipitation-control-volume-state', kind: 'state-advance',
			inputCommittedVersions: [ { signalId: fields.precipitationDescriptor.signalId, stateVersion: `${ fields.precipitationDescriptor.stateVersion }/prepared` } ], outputPreparedVersion: { signalId: 'precipitation-transport-state', stateVersion: 'precipitation-transport-state-v4/prepared' },
			applicationInterval: h.clone( intervalNPlusOne ), nativeExecutionIds: [ stageExecutions[ 1 ].executionId ], interactionApplicationLedgerIds: [], exactOnceAdvanceKey: `${ coordinationAdvanceId }|precipitation-transport|43-44`
		}
	];
	const preparedPublications = [
		[ 'prepared-cloud-emission-v4', 'causal-cloud-microphysics-provider', fields.precipitationDescriptor.signalId, 'cloud-precipitation-emission-state', `${ fields.precipitationDescriptor.stateVersion }/prepared`, fields.precipitationDescriptor.stateVersion, stageExecutions[ 0 ].writeResolutions[ 0 ].contentDigest, edges[ 1 ].barrier ],
		[ 'prepared-precipitation-transport-v4', '$threejs-rain-snow-and-wet-surfaces', 'precipitation-transport-state', 'airborne-precipitation-control-volume-state', 'precipitation-transport-state-v4/prepared', 'precipitation-transport-state-v4', stageExecutions[ 1 ].writeResolutions[ 0 ].contentDigest, edges[ 2 ].barrier ],
		[ 'prepared-precipitation-token-v4', 'route-physics-coordinator', 'precipitation-commit-token', 'precipitation-commit-token-state', 'precipitation-commit-token-v4/prepared', 'precipitation-commit-token-v4', stageExecutions[ 2 ].writeResolutions[ 0 ].contentDigest, edges[ 3 ].barrier ]
	].map( ( [ preparedPublicationId, owner, signalId, stateEquation, provisionalStateVersion, preparedStateVersion, contentDigest, dependencyRef ] ) => ( {
		preparedPublicationId, commitGroupId, stateEquationOwner: owner, signalOrStateEquationId: stateEquation, provisionalVersion: { signalId, stateVersion: provisionalStateVersion }, preparedVersion: { signalId, stateVersion: preparedStateVersion },
		contentDigest, ownerApproval: `${ owner }@provider-precipitation-v4`, prepareDependencyRefs: [ h.clone( dependencyRef ) ], visibility: 'transaction-private'
	} ) );
	const committedPublications = preparedPublications.map( ( publication ) => ( { signalId: publication.preparedVersion.signalId, stateVersion: publication.preparedVersion.stateVersion, stateEquation: publication.signalOrStateEquationId } ) );
	const publicationLineage = preparedPublications.map( ( publication ) => ( {
		provisionalVersion: h.clone( publication.provisionalVersion ), committedVersion: h.clone( publication.preparedVersion ), contentDigest: publication.contentDigest,
		semanticEquivalenceProof: 'exact-copy', ownerApproval: publication.ownerApproval, publicationInstant: h.clone( coordinationInterval.endExclusive )
	} ) );
	const commitGroup = {
		commitGroupId, owner: 'route-physics-coordinator', interval: h.clone( coordinationInterval ), provisionalVersions: preparedPublications.map( ( publication ) => h.clone( publication.provisionalVersion ) ),
		preparedPublications, committedPublications, publicationLineage,
		stateEquationOwners: Object.fromEntries( preparedPublications.map( ( publication ) => [ publication.signalOrStateEquationId, publication.stateEquationOwner ] ) ),
		conservationAndErrorGates: [ { gate: 'precipitation-control-volume-mass-residual', result: 'accepted' }, { gate: 'sole-cloud-emission-authority', result: 'accepted' } ], atomicity: 'all-or-none', failureDisposition: 'preserve-prior-commit', commitTransactionId
	};
	const publicationSetDigest = sha256Canonical( committedPublications );
	const preparedToCommittedPublicationMap = preparedPublications.map( ( publication ) => ( {
		preparedPublicationId: publication.preparedPublicationId, preparedVersion: h.clone( publication.preparedVersion ), preparedContentDigest: publication.contentDigest,
		committedVersion: h.clone( publication.preparedVersion ), committedContentDigest: publication.contentDigest
	} ) );
	const commitReceipt = {
		receiptId: 'provider-precipitation-commit-receipt-v4', commitTransactionId, publicationInstant: h.clone( coordinationInterval.endExclusive ), preparedToCommittedPublicationMap,
		committedPublications, priorToCommittedVersionMap: committedPublications.map( ( publication ) => ( { priorVersion: { signalId: publication.signalId, stateVersion: `${ publication.stateVersion }/prior` }, committedVersion: { signalId: publication.signalId, stateVersion: publication.stateVersion } } ) ),
		publicationSetDigest, registryRevisionBeforeAfter: { before: 'provider-precipitation-registry-v3', after: 'provider-precipitation-registry-v4' }, dependencyCompletionRefs: stageExecutions[ 2 ].dependencyCompletions,
		conservationAndErrorGateResults: [ { gate: 'precipitation-control-volume-mass-residual', status: 'accepted' }, { gate: 'sole-cloud-emission-authority', status: 'accepted' } ], status: 'committed', receiptDigest: 'pending'
	};
	commitReceipt.receiptDigest = sha256CanonicalExcluding( commitReceipt, [ 'receiptDigest' ] );
	const commitTransaction = {
		commitTransactionId, coordinationAdvanceId, contextId: context.contextId, interval: h.clone( coordinationInterval ), commitGroupIds: [ commitGroupId ], preparedPublicationIds: preparedPublications.map( ( publication ) => publication.preparedPublicationId ),
		conservationErrorAndResourceGates: [ { gate: 'precipitation-control-volume-mass-residual', status: 'accepted' }, { gate: 'CPU immutable state bytes', status: 'accepted' } ], priorCommittedVersions: commitReceipt.priorToCommittedVersionMap.map( ( entry ) => entry.priorVersion ),
		publicationSetDigest, atomicPublicationProtocol: 'prepare-validate-single-registry-swap', status: 'committed', receipt: commitReceipt
	};
	const coordinationAdvance = {
		coordinationAdvanceId, graphId, contextId: context.contextId, coordinationSequence: 42, catchUpBatchId: noResource( 'route-physics-coordinator', 'provider fixture has no catch-up batch' ), predecessorAdvanceId: noResource( 'route-physics-coordinator', 'first provider fixture advance' ), predecessorReceiptDigest: noResource( 'route-physics-coordinator', 'first provider fixture advance' ),
		interval: h.clone( coordinationInterval ), debtBefore: h.fixtureDurationSeconds( 0, 'provider fixture has no catch-up debt' ), debtAfter: h.fixtureDurationSeconds( 0, 'provider fixture has no catch-up debt' ), stageExecutionIds: stageExecutions.map( ( execution ) => execution.executionId ),
		stateAdvanceClaimIds: stateAdvanceClaims.map( ( claim ) => claim.claimId ), commitTransactionIds: [ commitTransactionId ], status: 'committed', receiptDigest: 'pending'
	};
	coordinationAdvance.receiptDigest = sha256CanonicalExcluding( coordinationAdvance, [ 'receiptDigest' ] );
	const executionLedger = {
		ledgerId: 'provider-precipitation-execution-ledger-v4', graphId, graphRevision, coordinationInterval: h.clone( coordinationInterval ), coordinationAdvanceId, stageExecutions, dependencyCompletions, stateAdvanceClaims,
		interactionApplicationLedgers: [], loopResults: [], commitReceipts: [ commitReceipt ], catchUpDebtBeforeAfter: { before: h.fixtureDurationSeconds( 0, 'provider fixture debt' ), after: h.fixtureDurationSeconds( 0, 'provider fixture debt' ) },
		discontinuityEpoch: coordinationInterval.start.discontinuityEpoch, physicsCostLedgerId: 'provider-precipitation-cost-ledger-v4'
	};
	const graph = {
		graphId, contextId: context.contextId, coordinationInterval: h.clone( coordinationInterval ), coordinationAdvance, catchUpBatch: noResource( 'route-physics-coordinator', 'provider fixture has no catch-up batch' ), stages, edges, dependencies, loopMacros: [], commitGroups: [ commitGroup ], commitTransactions: [ commitTransaction ], originRebaseTransactions: [],
		catchUpPolicy: { owner: 'route-physics-coordinator', debtClockId: fields.clockId, maximumDebt: h.fixtureDurationSeconds( 0, 'provider fixture blocks debt' ), maximumCoordinationAdvancesPerPresentationOpportunity: h.evidence( 1, 'advance', 'Gated', 'provider fixture catch-up bound' ), maximumNativeExecutionsPerOpportunity: h.evidence( 4, 'execution', 'Gated', 'provider fixture catch-up bound' ), debtDisposition: 'block-presentation', discontinuityOnDrop: 'required', externalDeadlinePolicy: 'reject-advance', errorAndResourceGates: [ 'mass residual', 'immutability', 'CPU memory' ] },
		discontinuityPolicy: { owner: 'route-physics-coordinator', action: 'reject rather than skip either n or n+1 control-volume interval' }, executionLedger
	};
	const timeCohort = {
		timeCohortId: 'provider-precipitation-time-cohort-v4', presentationClockId: fields.clockId, presentationOpportunitySequence: 44,
		previousRequestedPresentationInstant: h.clone( intervalNPlusOne.start ), currentRequestedPresentationInstant: h.clone( intervalNPlusOne.endExclusive ), requestedPresentationInstant: h.clone( intervalNPlusOne.endExclusive ),
		requiredContextIds: [ context.contextId ], requiredDiscontinuityEpochs: { [ context.contextId ]: coordinationInterval.endExclusive.discontinuityEpoch }, maximumInterContextSkew: h.fixtureDurationSeconds( 0, 'one-context provider fixture' ), maximumCandidateAge: h.fixtureDurationSeconds( 1 / 60, 'provider candidate maximum age' ),
		admissionPolicy: 'exact-instant', cohortSpecificationDigest: sha256Canonical( { contextId: context.contextId, instant: intervalNPlusOne.endExclusive, sequence: 44 } )
	};
	const candidate = {
		candidateId: 'provider-precipitation-candidate-v4', contextId: context.contextId, presentationEpoch: 'provider-precipitation-presentation-epoch-v4', timeCohortId: timeCohort.timeCohortId, requestedPresentationInstant: h.clone( timeCohort.requestedPresentationInstant ), physicsOriginEpoch: context.physicsOriginEpoch,
		commitProvenance: { provenanceId: 'provider-precipitation-candidate-provenance-v4', contextId: context.contextId, coordinationAdvanceIds: [ coordinationAdvanceId ], commitTransactionIds: [ commitTransactionId ], commitReceiptIdsAndDigests: [ { receiptId: commitReceipt.receiptId, receiptDigest: commitReceipt.receiptDigest } ], committedStateVersions: h.clone( committedPublications ), physicsOriginTransactionId: noResource( 'route-physics-coordinator', 'no physics-origin rebase in provider fixture' ), qualityTransitionId: noResource( 'route-physics-coordinator', 'no quality transition in provider fixture' ), closedPublicationSetDigest: publicationSetDigest },
		candidateScope: 'committed-state-brackets-leases-and-events', presentedStatePairs: [], resourceLeases: [],
		eventSequenceRanges: [ { rangeId: 'precipitation-transport-event-range-v4', producerId: '$threejs-rain-snow-and-wet-surfaces', consumerId: 'shared-presentation-views', streamId: 'precipitation-control-volume-events-v4', firstSequence: 1, lastSequenceInclusive: 1, sourceStateVersion: 'precipitation-transport-state-v4', interval: h.clone( intervalNPlusOne ), cursorBefore: 1, cursorAfter: 2, payloadDigest: sha256Canonical( fields.massClosure ) } ]
	};
	const serializedByteCounts = {
		environmentForcingSnapshot: canonicalUtf8Bytes( fields.environmentSnapshot ),
		precipitationEmissionSnapshot: canonicalUtf8Bytes( fields.precipitationSnapshot ),
		precipitationTransportState: canonicalUtf8Bytes( fields.massClosure ),
		commitToken: canonicalUtf8Bytes( { interval: coordinationInterval, status: 'committed', publicationSetDigest } ),
		candidate: canonicalUtf8Bytes( candidate )
	};
	const hotLogicalBytes = serializedByteCounts.environmentForcingSnapshot + serializedByteCounts.precipitationEmissionSnapshot + serializedByteCounts.precipitationTransportState;
	const peakTransientLogicalBytes = hotLogicalBytes + serializedByteCounts.commitToken + serializedByteCounts.candidate;
	const perStageLogicalBytes = {
		'publish-cloud-emission-interval-n-v4': { read: serializedByteCounts.environmentForcingSnapshot, written: serializedByteCounts.precipitationEmissionSnapshot },
		'consume-cloud-emission-interval-n-plus-one-v4': { read: serializedByteCounts.precipitationEmissionSnapshot, written: serializedByteCounts.precipitationTransportState },
		'commit-precipitation-control-volume-v4': { read: serializedByteCounts.precipitationEmissionSnapshot + serializedByteCounts.precipitationTransportState, written: serializedByteCounts.commitToken },
		'publish-precipitation-candidate-v4': { read: serializedByteCounts.commitToken, written: serializedByteCounts.candidate }
	};
	const worstBurstLogicalBytes = Object.values( perStageLogicalBytes ).reduce( ( total, bytes ) => total + bytes.read + bytes.written, 0 );
	const makeMemoryLedger = ( category, bytes ) => {

		const allocationId = `provider-precipitation-${ category}-allocation-v4`;
		const allocations = bytes === 0 ? [] : [ {
			allocationId, resourceId: `provider-precipitation-${ category}-state-v4`, owner: 'route-physics-coordinator', semantic: category === 'hot-state' ? 'solver-state' : 'named', residency: h.clone( cpuResidency ),
			deviceBackendResourceGenerations: noResource( 'route-physics-coordinator', 'CPU provider state has no device generation' ), encodingFormatAndExtent: { layout: 'canonical provider records plus SoA batch', byteExtent: bytes },
			elementCountStrideAndLogicalBytes: { elementCount: h.evidence( bytes, 'byte-element', 'Derived', 'provider record layout' ), stride: h.evidence( 1, 'byte', 'Derived', 'byte-addressed accounting' ), logicalBytes: h.evidence( bytes, 'byte', 'Derived', 'provider record layout' ) },
			physicalAllocatedBytes: h.evidence( bytes, 'byte', 'Measured', 'provider fixture allocation trace' ), liveInterval: { begin: 'coordination-advance-begin', endExclusive: 'candidate-publication-complete' }, framesInFlightMultiplier: h.evidence( 1, 'frame', 'Measured', 'provider fixture trace' ), sharingScope: 'context-shared', targetViewKeys: [],
			workKey: 'provider-precipitation-shared-work-v4', aliasGroupAndNonoverlapProof: noResource( 'route-physics-coordinator', 'provider fixture does not alias allocations' ), leaseIdsAndCompletionJoins: [], evidenceRef: 'sha256:provider-precipitation-allocation-trace-v4'
		} ];
		return {
			memoryLedgerId: `provider-precipitation-${ category}-memory-ledger-v4`, contextId: context.contextId, measurementInterval: h.clone( coordinationInterval ), qualityEpoch: 'provider-precipitation-quality-epoch-v4', category, allocations,
			logicalBytesByResidency: { cpu: h.evidence( bytes, 'byte', 'Derived', 'provider record layout' ) }, physicalAllocatedBytesByResidency: { cpu: h.evidence( bytes, 'byte', 'Measured', 'provider fixture allocation trace' ) }, maximumSimultaneouslyLiveBytes: { cpu: h.evidence( bytes, 'byte', 'Measured', 'provider fixture allocation lifetime sweep' ) },
			sharedBytesByWorkKey: { 'provider-precipitation-shared-work-v4': h.evidence( bytes, 'byte', 'Derived', 'provider record layout' ) }, perViewBytesByTargetView: {}, lifetimeDagDigest: `sha256:provider-precipitation-${ category}-lifetime-dag-v4`, allocationTraceRef: 'sha256:provider-precipitation-allocation-trace-v4', status: 'measured'
		};

	};
	const hotState = makeMemoryLedger( 'hot-state', hotLogicalBytes );
	const peakTransient = makeMemoryLedger( 'peak-transient', peakTransientLogicalBytes );
	const migrationOverlap = makeMemoryLedger( 'migration-overlap', 0 );
	const stageExecutionCounts = Object.fromEntries( stages.map( ( stage ) => [ stage.stageId, h.evidence( 1, 'execution', 'Measured', 'provider precipitation trace v4' ) ] ) );
	const cadenceTraceTotals = {
		traceTotalsId: 'provider-precipitation-trace-totals-v4', traceRef: 'sha256:provider-precipitation-trace-v4', measurementInterval: h.clone( coordinationInterval ), exactDuration: h.fixtureDurationSeconds( durationSeconds( coordinationInterval ), 'exact provider coordination interval endpoints' ),
		coordinationAdvanceCount: h.evidence( 1, 'advance', 'Measured', 'provider precipitation trace v4' ), catchUpBatchCount: h.evidence( 0, 'batch', 'Measured', 'provider precipitation trace v4' ), stageExecutionCounts,
		nativeSubcycleCounts: { '$threejs-rain-snow-and-wet-surfaces': h.evidence( 1, 'subcycle', 'Measured', 'provider precipitation trace v4' ) }, couplingIterationCounts: {}, interactionApplicationCounts: {}, presentedFrameCounts: {},
		workOccurrenceCounts: { 'provider-precipitation-shared-work-v4': h.evidence( 4, 'occurrence', 'Measured', 'one occurrence per provider graph stage' ) }, trafficOccurrenceAndLogicalByteTotals: {}, droppedCoordinationIntervals: [], exactTotalsDigest: 'pending'
	};
	cadenceTraceTotals.exactTotalsDigest = sha256CanonicalExcluding( cadenceTraceTotals, [ 'exactTotalsDigest' ] );
	const qualityStateAndEpoch = { qualityStateId: 'provider-precipitation-quality-v4', qualityEpoch: 'provider-precipitation-quality-epoch-v4' };
	const harness = {
		harnessId: 'provider-precipitation-cost-harness-v4',
		target: { deviceId: 'fixture-cpu-provider-target', osAndBrowserBuild: 'fixture-node-runtime', gpuAdapterAndDriver: noResource( 'route-physics-coordinator', 'CPU-only provider fixture' ), backendAndDeviceGeneration: 'provider-process-v4', displayModeAndMeasuredRefresh: noResource( 'route-physics-coordinator', 'no display' ), powerSourceAndGovernor: 'fixture-process', thermalStartAndStabilizationPolicy: 'not-claimed' },
		viewport: { cssExtent: noResource( 'route-physics-coordinator', 'no viewport' ), dpr: noResource( 'route-physics-coordinator', 'no DPR' ), physicalExtent: noResource( 'route-physics-coordinator', 'no render extent' ) },
		workload: { routeAndSceneRevision: 'sha256:provider-precipitation-fixture-v4', contextGraphAndRegistryRevisions: { graphRevision }, resourceAndPipelineGraphDigest: 'sha256:provider-precipitation-resources-v4', presentationTargetsAndViews: [], seedCameraInputAndEventTrace: 'sha256:provider-precipitation-input-v4', qualityStateAndEpoch },
		protocol: { warmupAndCompilationState: 'warm', coldTransitionAndSustainedSegments: 'one exact coordination interval', sampleAndQuantilePolicy: 'every execution', cpuClockAndGpuQueryCoverage: { cpu: 'monotonic', gpu: noResource( 'route-physics-coordinator', 'CPU-only provider fixture' ) }, counterAvailabilityAndUncertainty: 'logical bytes', visibilityPowerAndAutomationControls: 'headless deterministic fixture' }, harnessDigest: 'pending'
	};
	harness.harnessDigest = sha256CanonicalExcluding( harness, [ 'harnessDigest' ] );
	const composedGateSet = {
		gateSetId: 'provider-precipitation-composed-gates-v4', harnessId: harness.harnessId, qualityStateAndEpoch, frozenBeforeTraceDigest: 'sha256:provider-gates-frozen-v4', cpuCriticalPathP95: h.evidence( 0.001, 'second', 'Gated', 'provider latency gate' ), gpuCriticalPathP95: noResource( 'route-physics-coordinator', 'CPU-only provider fixture' ), externalTailP95: noResource( 'route-physics-coordinator', 'no external tail' ), presentedIntervalP95: h.evidence( 0.02, 'second', 'Gated', 'provider service gate' ), deadlineMissRatio: h.evidence( 0, 'ratio', 'Gated', 'provider deterministic gate' ), updateLatencyByStateEquation: { precipitation: h.evidence( 0.02, 'second', 'Gated', 'provider update gate' ) }, hotStateBytes: h.evidence( hotLogicalBytes, 'byte', 'Gated', 'provider memory gate' ), peakTransientBytes: h.evidence( peakTransientLogicalBytes, 'byte', 'Gated', 'provider memory gate' ), migrationOverlapBytes: h.evidence( 0, 'byte', 'Gated', 'no migration' ), logicalTrafficPerOpportunity: h.evidence( worstBurstLogicalBytes, 'byte', 'Gated', 'provider traffic gate' ), uploadCopyMapBytesPerOpportunity: h.evidence( 0, 'byte', 'Gated', 'zero-copy gate' ), allocationAndCompilationChurn: { allocations: h.evidence( 0, 'allocation', 'Gated', 'steady provider gate' ) }, sustainedDriftAndQualityResidence: { drift: h.evidence( 0, 'ratio', 'Gated', 'deterministic provider gate' ) }, numericalAndVisualErrorGateRefs: [ 'precipitation-control-volume-mass-residual' ]
	};
	const opportunityRow = {
		opportunityKey: { presentationClockId: fields.clockId, presentationOpportunitySequence: 'provider-opportunity-v4' }, opportunityInterval: h.clone( coordinationInterval ), catchUpBatchId: noResource( 'route-physics-coordinator', 'no catch-up batch' ), coordinationAdvanceIds: [ coordinationAdvanceId ], stageExecutionCounts: h.clone( stageExecutionCounts ), nativeSubcycleCounts: h.clone( cadenceTraceTotals.nativeSubcycleCounts ), couplingIterationCounts: {}, interactionApplicationCounts: {}, presentedFrameCounts: {}, workOccurrenceCounts: h.clone( cadenceTraceTotals.workOccurrenceCounts ), trafficOccurrenceAndLogicalByteTotals: {}, queueDispatchPassAndBarrierCounts: { dispatches: h.evidence( stages.length, 'execution', 'Derived', 'one execution per stage' ), submissions: h.evidence( 0, 'submission', 'Measured', 'CPU provider path' ), passBreaks: h.evidence( 0, 'pass-break', 'Measured', 'CPU provider path' ), barriers: h.evidence( dependencies.length, 'dependency', 'Derived', 'provider graph' ) }, cpuCriticalPath: { duration: h.evidence( 0.00008, 'second', 'Measured', 'provider trace' ), nodePath: stages.map( ( stage ) => stage.stageId ) }, gpuCriticalPath: noResource( 'route-physics-coordinator', 'CPU-only provider fixture' ), externalTail: noResource( 'route-physics-coordinator', 'no external tail' ), presentedIntervalAndDeadlineMiss: { interval: h.evidence( durationSeconds( coordinationInterval ), 'second', 'Measured', 'provider interval' ), deadlineMiss: false }, hotStatePeakTransientAndMigrationBytes: { hotState: h.evidence( hotLogicalBytes, 'byte', 'Derived', 'provider layouts' ), peakTransient: h.evidence( peakTransientLogicalBytes, 'byte', 'Derived', 'provider layouts' ), migrationOverlap: h.evidence( 0, 'byte', 'Derived', 'no migration' ) }, numericalAndVisualGateResults: [ { gateId: 'precipitation-control-volume-mass-residual', status: 'pass' } ], qualityStateAndEpoch, rowDigest: 'pending'
	};
	opportunityRow.rowDigest = sha256CanonicalExcluding( opportunityRow, [ 'rowDigest' ] );
	const opportunityTable = { opportunityTableId: 'provider-opportunity-table-v4', harnessId: harness.harnessId, measurementInterval: h.clone( coordinationInterval ), storage: 'inline', inlineRows: [ h.clone( opportunityRow ) ], resource: noResource( 'route-physics-coordinator', 'inline table' ), exactRowCount: h.evidence( 1, 'opportunity', 'Measured', 'provider trace' ), tableDigest: 'pending' };
	opportunityTable.tableDigest = sha256CanonicalExcluding( opportunityTable, [ 'tableDigest' ] );
	const composedTrace = { composedTraceId: 'provider-composed-trace-v4', harnessId: harness.harnessId, gateSetId: composedGateSet.gateSetId, opportunityTableId: opportunityTable.opportunityTableId, cadenceTraceTotalsId: cadenceTraceTotals.traceTotalsId, cpuCriticalPathDistribution: { p50: h.clone( opportunityRow.cpuCriticalPath.duration ), p95: h.clone( opportunityRow.cpuCriticalPath.duration ) }, gpuCriticalPathDistribution: noResource( 'route-physics-coordinator', 'CPU-only provider fixture' ), externalTailDistribution: noResource( 'route-physics-coordinator', 'no external tail' ), presentedIntervalAndDeadlineMissDistribution: { p95: h.clone( opportunityRow.presentedIntervalAndDeadlineMiss.interval ), missRatio: h.evidence( 0, 'ratio', 'Measured', 'provider trace' ) }, memoryTrafficAllocationAndThermalDistributions: { hotState: h.evidence( hotLogicalBytes, 'byte', 'Derived', 'provider layouts' ), peakTransient: h.evidence( peakTransientLogicalBytes, 'byte', 'Derived', 'provider layouts' ) }, gateResults: { cpu: 'pass', memory: 'pass', traffic: 'pass', error: 'pass' }, status: 'measured-valid' };
	const witness = { witnessId: 'provider-catch-up-witness-v4', maximizedObjectiveDimensions: [ 'cpu-critical-path', 'presented-interval', 'hot-traffic', 'peak-live-bytes', 'numerical-error' ], opportunityRow: h.clone( opportunityRow ), repetitionAndSustainedProtocol: { repetitions: h.evidence( 1, 'opportunity', 'Measured', 'provider fixture' ) }, composedMeasuredDistributions: { cpuP95: h.clone( opportunityRow.cpuCriticalPath.duration ) }, derivedUpperBoundsAndAssumptions: { policy: 'one advance and zero debt' }, witnessDigest: 'pending' };
	witness.witnessDigest = sha256CanonicalExcluding( witness, [ 'witnessDigest' ] );
	const worstPermittedCatchUpCost = { catchUpCostId: 'provider-worst-catch-up-v4', harnessId: harness.harnessId, gateSetId: composedGateSet.gateSetId, catchUpPolicyIdentity: { graphId, graphRevision, policyDigest: sha256Canonical( graph.catchUpPolicy ), debtClockId: graph.catchUpPolicy.debtClockId, maximumDebt: h.clone( graph.catchUpPolicy.maximumDebt ), maximumCoordinationAdvancesPerPresentationOpportunity: h.clone( graph.catchUpPolicy.maximumCoordinationAdvancesPerPresentationOpportunity ), maximumNativeExecutionsPerOpportunity: h.clone( graph.catchUpPolicy.maximumNativeExecutionsPerOpportunity ), debtDisposition: graph.catchUpPolicy.debtDisposition }, admissibleScheduleModel: { integerVariables: [ 'stage-executions' ], constraintsDigest: 'sha256:provider-catch-up-constraints-v4', objectiveDimensions: h.clone( witness.maximizedObjectiveDimensions ) }, frontierWitnesses: [ witness ], frontierCoverage: { method: 'exhaustive-enumeration', proofRef: 'sha256:provider-frontier-proof-v4', coveredObjectiveDimensions: h.clone( witness.maximizedObjectiveDimensions ), uncoveredObjectiveDimensions: [], componentwiseDominationDigest: 'sha256:provider-domination-v4' }, gateResults: { cpu: 'pass', presentation: 'pass', traffic: 'pass', memory: 'pass', error: 'pass' }, requiredDisposition: 'admit' };
	const costLedger = {
		ledgerId: 'provider-precipitation-cost-ledger-v4', contextId: context.contextId, graphId, graphRevision, measurementInterval: h.clone( coordinationInterval ), measurementClockId: fields.clockId, qualityEpoch: 'provider-precipitation-quality-epoch-v4', presentationTargetsAndViews: [], measurementProtocolRefs: [ 'sha256:provider-precipitation-protocol-v4', 'sha256:provider-precipitation-trace-v4' ], cadenceTraceTotals, status: 'active',
		harness, composedGateSet, opportunityTable, composedTrace, qualityState: 'provider-precipitation-quality-v4', graphStageCosts: stages.map( ( stage ) => ( { stageId: stage.stageId, cpuP95: h.evidence( 0.02, 'millisecond', 'Measured', 'provider precipitation trace v4' ), gpuP95: noResource( stage.owner, 'CPU provider stage has no GPU timing' ), sampleCount: h.evidence( 1, 'sample', 'Measured', 'provider precipitation trace v4' ) } ) ),
		coordinationIntervalsPerSecond: { exactMean: h.evidence( 1 / durationSeconds( coordinationInterval ), 'interval-per-second', 'Derived', 'one interval divided by exact endpoint duration' ) }, stageExecutionsPerCoordinationInterval: Object.fromEntries( stages.map( ( stage ) => [ stage.stageId, h.evidence( 1, 'execution-per-interval', 'Measured', 'provider precipitation trace v4' ) ] ) ),
		stageExecutionsPerSecond: Object.fromEntries( stages.map( ( stage ) => [ stage.stageId, h.evidence( 1 / durationSeconds( coordinationInterval ), 'execution-per-second', 'Derived', 'one execution divided by exact endpoint duration' ) ] ) ), coordinationIntervalsPerPresentedFrame: noResource( 'route-physics-coordinator', 'provider fixture has no presented frame'), subcyclesAndCouplingIterationsPerPresentedFrame: noResource( 'route-physics-coordinator', 'provider fixture has no presented frame' ), executionsPerPresentedFrame: noResource( 'route-physics-coordinator', 'provider fixture has no presented frame' ),
		worstPermittedCatchUpCost,
		hotBytesReadWrittenPerExecution: Object.fromEntries( stages.map( ( stage ) => [ stage.stageId, { read: h.evidence( perStageLogicalBytes[ stage.stageId ].read, 'byte', 'Derived', 'canonical UTF-8 bytes of exact stage inputs' ), written: h.evidence( perStageLogicalBytes[ stage.stageId ].written, 'byte', 'Derived', 'canonical UTF-8 bytes of exact stage outputs' ) } ] ) ), solverDispatches: [], sparseActiveDomainCosts: [], contactCosts: [], externalAdapterCosts: [], queueSubmissionsAndPassBreaks: { submissions: h.evidence( 0, 'submission', 'Measured', 'CPU provider trace' ), breaks: h.evidence( 0, 'break', 'Measured', 'CPU provider trace' ) }, dependencyCriticalPaths: [ { path: 'cloud-emission-n-to-rain-transport-n-plus-one-to-atomic-commit', p95: h.evidence( 0.08, 'millisecond', 'Measured', 'provider precipitation trace v4' ) } ],
		tileGpuTraffic: { attachmentStoreLoadResolveBytes: h.evidence( 0, 'byte', 'Derived', 'CPU provider path' ), tileSpillEvidence: 'not-applicable CPU provider path', renderComputePassBreaks: h.evidence( 0, 'break', 'Measured', 'CPU provider trace' ) }, bindingAndDeviceLimits: [], cpuWork: stages.map( ( stage ) => ( { task: stage.stageId, p95: h.evidence( 0.02, 'millisecond', 'Measured', 'provider precipitation trace v4' ) } ) ), allocationGcAndCompilation: [ { category: 'steady-provider-advance', allocations: h.evidence( 0, 'allocation-per-advance', 'Measured', 'preallocated provider record pools' ) } ], uploadsCopiesMaps: [], hostCompletionsReadbacksPerPresentedFrame: h.evidence( 0, 'readback-per-frame', 'Measured', 'provider fixture has no GPU path' ), synchronization: [ { kind: 'cpu-data-dependency', p95: h.evidence( 0, 'millisecond', 'Measured', 'same-process immutable handoff' ) } ], multiviewAndFramesInFlightMultipliers: { viewCount: h.evidence( 0, 'view', 'Measured', 'provider fixture has no render target' ), framesInFlight: h.evidence( 0, 'frame', 'Measured', 'provider fixture has no frame slot' ), resourceMultiplier: h.evidence( 1, 'ratio', 'Derived', 'route-shared provider state' ), workMultiplier: h.evidence( 1, 'ratio', 'Derived', 'route-shared provider state' ) },
		workAttribution: [ { workKey: 'provider-precipitation-shared-work-v4', owner: 'route-physics-coordinator', scope: 'shared', targetViewKeys: [], coordinationAdvanceIds: [ coordinationAdvanceId ], stageExecutionPassOrDispatchIds: stageExecutions.map( ( execution ) => execution.executionId ), occurrenceCount: h.evidence( 4, 'occurrence', 'Measured', 'provider precipitation trace v4' ), cpuTime: h.evidence( 0.08, 'millisecond', 'Measured', 'provider precipitation trace v4' ), gpuTime: noResource( 'route-physics-coordinator', 'CPU provider path'), externalLatency: noResource( 'route-physics-coordinator', 'local provider path' ), trafficRecordIds: [], memoryAllocationIds: [ ...hotState.allocations, ...peakTransient.allocations ].map( ( allocation ) => allocation.allocationId ), attributionRule: 'count-shared-once', attributionDigest: 'sha256:provider-precipitation-shared-work-attribution-v4' } ], sharedWorkKeys: [ 'provider-precipitation-shared-work-v4' ], perViewWorkKeys: {}, hotState, peakTransient, migrationOverlap, qualityCostEvidence: [], qualityMigrationCostEvidence: [], thermalPowerState: { state: 'fixture-not-thermally-significant', duration: h.fixtureDurationSeconds( durationSeconds( coordinationInterval ), 'provider fixture interval' ) }
	};
	return { graph, timeCohort, candidate, costLedger, intervalNPlusOne };

}

export function buildProviderWaterBundle( helpers, route ) {

	const h = helperSet( helpers );
	const c = contextFields( route );
	const sampleInstant = h.fixtureInstant( c.clocks, c.clockId, 42 );
	const sampleTime = instantTime( h.clone, h.typedAbsence, sampleInstant, 'provider-fixture-coordinator' );
	const evaluationInterval = h.fixtureInterval( c.clocks, c.clockId, 42, 43 );
	const validityInterval = h.fixtureInterval( c.clocks, c.clockId, 42, 44 );
	const evaluationTime = intervalTime( h.clone, h.typedAbsence, evaluationInterval, 'provider-fixture-coordinator' );
	const noChart = h.typedAbsence( 'not-applicable', 'provider-fixture-coordinator', 'timeless', 'fixture support has no chart parameterization' );

	const environmentSupport = makeSupport( h, {
		supportId: 'environment-forcing-support-v7', kind: 'area', physicsFrameId: c.physicsFrameId,
		physicsOriginEpoch: c.physicsOriginEpoch, transformRevision: c.transformRevision, chartId: h.clone( noChart ),
		geometry: 'oriented horizontal receiver patch, 10 metre by 10 metre', orientation: 'positive flux points from atmosphere to receiver',
		measureUnit: 'square-metre', measure: 100, measureSource: '10 metre by 10 metre fixture patch', measureError: 0.000001
	} );
	const environmentFilter = makeFilter( h, {
		filterId: 'environment-forcing-filter-v7', supportMeasure: 'area', kernelOrTransferFunction: 'uniform physical-area average with Jacobian-bearing quadrature',
		spatialBandwidth: 'wavelengths at or above 2 metre', temporalBandwidth: 'one coordination-interval box average', phaseSemantics: 'phase-resolved',
		normalization: 'physical-area weights sum to representedMeasure; no unit-normalized extensive kernel', causality: 'causal', errorBound: 0.000001
	} );
	const commonCpuResidency = ( owner, bindingIdentity ) => ( {
		kind: 'cpu', owner, bindingIdentity, availability: 'immutable host snapshot latched before its consumer stage',
		deviceId: null, queueId: null
	} );
	const descriptorCommon = {
		contextId: c.context.contextId, physicsFrameId: c.physicsFrameId, physicsOriginEpoch: c.physicsOriginEpoch,
		transformRevision: c.transformRevision, clockId: c.clockId, validityInterval, cadenceSeconds: 1 / 60,
		latency: { productionDelaySeconds: 0, maximumStalenessSeconds: 1 / 60, hostVisible: true, clockMappingRevision: sampleInstant.clockMappingRevision }
	};
	const environmentDescriptor = makeDescriptor( h, {
		...descriptorCommon,
		signalId: 'environment-forcing-snapshot', providerId: 'project-environment-coordinator', schemaId: 'physics/environment-forcing/v1',
		owner: 'project-environment-coordinator', consumers: [ '$threejs-rain-snow-and-wet-surfaces', '$threejs-water-optics' ],
		specs: ENVIRONMENT_SPECS, support: environmentSupport, filter: environmentFilter, chartId: h.clone( noChart ),
		samplePhase: 'interval-start', cadenceKind: 'fixed', cadenceEvidence: 'one immutable forcing latch per coordination interval',
		residency: commonCpuResidency( 'project-environment-coordinator', 'environment-forcing-host-snapshot-v7' ),
		latency: { ...descriptorCommon.latency, owner: 'project-environment-coordinator', consumerAvailability: 'latched graph dependency environment-forcing-v7' },
		stateVersion: 'environment-forcing-state-v7', resourceGeneration: null
	} );
	// A cloud-owned PrecipitationEmissionSnapshot is the sole precipitation
	// authority in this fixture. The already-latched environment snapshot may
	// carry wind/thermodynamic forcing, but its precipitation arms remain typed
	// absence so a rain consumer cannot integrate the same flux twice.
	const environmentAbsent = [
		'airPressurePa',
		'specificHumidityKgPerKg',
		'turbulenceStatistics',
		'precipitationMassFluxKgPerM2S',
		'precipitationPhase',
		'precipitationVelocityMps',
		'mediumMaterialVelocityMps'
	];
	const environmentValues = {
		airVelocityMps: [ 5, 0.5, 1 ],
		airDensityKgPerM3: 1.225,
		temperatureK: 289.15
	};
	const environmentForcingSnapshot = {
		descriptor: environmentDescriptor,
		sampleInstant: h.clone( sampleInstant ),
		...Object.fromEntries( ENVIRONMENT_CHANNEL_FIELDS.map( ( id ) => [
			id,
			environmentAbsent.includes( id ) ? absenceAt( h, 'project-environment-coordinator', sampleTime, id ) : makeSampledChannel( h, environmentDescriptor, id, environmentValues[ id ], sampleTime )
		] ) ),
		validity: h.clone( environmentDescriptor.validity ),
		error: h.fixtureError( 'normalized-consumer-tolerance-ratio', 0.5, 'environment-forcing atomic bundle correlation bound' ),
		absentChannels: environmentAbsent
	};
	const forcingSnapshotDigestBeforeEmission = sha256Canonical( environmentForcingSnapshot );

	const precipitationDescriptor = makeDescriptor( h, {
		...descriptorCommon,
		signalId: 'precipitation-emission-snapshot', providerId: 'causal-cloud-microphysics-provider', schemaId: 'physics/precipitation-emission/v1',
		owner: 'causal-cloud-microphysics-provider', consumers: [ '$threejs-rain-snow-and-wet-surfaces' ],
		specs: PRECIPITATION_SPECS, support: environmentSupport, filter: environmentFilter, chartId: h.clone( noChart ),
		samplePhase: 'interval-end', cadenceKind: 'fixed', cadenceEvidence: 'emission interval precedes one acyclic precipitation transport edge',
		residency: commonCpuResidency( 'causal-cloud-microphysics-provider', 'precipitation-emission-host-snapshot-v4' ),
		latency: { ...descriptorCommon.latency, owner: 'causal-cloud-microphysics-provider', consumerAvailability: 'completed emission stage dependency precipitation-emission-v4' },
		stateVersion: 'precipitation-emission-state-v4', resourceGeneration: null
	} );
	const emittedFlux = 0.2;
	const representedArea = 100;
	const elapsedSeconds = durationSeconds( evaluationInterval );
	const emittedMass = emittedFlux * representedArea * elapsedSeconds;
	const initialAirborneMass = 2;
	const inventoryAtNPlusOneBoundary = initialAirborneMass + emittedMass;
	const depositedMass = 0.2;
	const evaporatedMass = 0.05;
	const sublimatedMass = 0.02;
	const advectiveInflowMass = 0;
	const advectiveOutflowMass = 0;
	const finalAirborneMass = inventoryAtNPlusOneBoundary + advectiveInflowMass - advectiveOutflowMass - depositedMass - evaporatedMass - sublimatedMass;
	const phase = { liquidMassFraction: 0.75, iceMassFraction: 0.25 };
	const airborneInventory = {
		kind: 'total-mass',
		totalMassKg: h.evidence( inventoryAtNPlusOneBoundary, 'kilogram', 'Derived', 'airborne inventory at the n to n+1 boundary after interval-n emission and before interval-n+1 transport sinks' ),
		densityField: h.typedAbsence( 'not-applicable', 'causal-cloud-microphysics-provider', 'timeless', 'fixture publishes exact total airborne mass' )
	};
	const precipitationValues = {
		emittedMassFluxKgPerM2S: emittedFlux,
		phase,
		emissionVelocityMps: [ 0, - 2, 0 ],
		airborneInventory
	};
	const precipitationEmissionSnapshot = {
		descriptor: precipitationDescriptor,
		emissionInterval: h.clone( evaluationInterval ),
		...Object.fromEntries( PRECIPITATION_CHANNEL_FIELDS.map( ( id ) => [ id, makeSampledChannel( h, precipitationDescriptor, id, precipitationValues[ id ], evaluationTime ) ] ) ),
		transportDelay: h.fixtureDurationSeconds( 0, 'emission interval end is the next consumer interval start' ),
		destinationFootprint: h.clone( environmentSupport ),
		conservationGroupId: 'precipitation-mass-conservation-v4'
	};
	assert.ok( route.physicsSignals && typeof route.physicsSignals === 'object', 'provider/water fixture requires route.physicsSignals inventory' );
	for ( const [ routeKey, descriptor ] of [ [ 'environmentForcing', environmentDescriptor ], [ 'precipitationEmission', precipitationDescriptor ] ] ) {

		if ( route.physicsSignals[ routeKey ] ) assert.deepEqual( route.physicsSignals[ routeKey ], descriptor, `route physics signal ${ routeKey } conflicts with provider fixture` );
		else route.physicsSignals[ routeKey ] = h.clone( descriptor );

	}
	const forcingSnapshotDigestAfterEmission = sha256Canonical( environmentForcingSnapshot );
	const precipitationTransportProof = {
		proofId: 'precipitation-emission-n-to-n-plus-one-v4',
		graphId: 'provider-precipitation-graph-v4',
		coordinationAdvanceId: 'provider-precipitation-advance-42-44-v4',
		producerStageId: 'publish-cloud-emission-interval-n-v4',
		consumerStageId: 'consume-cloud-emission-interval-n-plus-one-v4',
		producerInterval: h.clone( evaluationInterval ),
		consumerInterval: h.fixtureInterval( c.clocks, c.clockId, 43, 44 ),
		graphDependencyId: 'dependency-cloud-emission-to-transport-v4',
		commitTransactionId: 'provider-precipitation-commit-transaction-v4',
		candidateId: 'provider-precipitation-candidate-v4',
		physicsCostLedgerId: 'provider-precipitation-cost-ledger-v4',
		ordering: 'producer interval n completes before consumer interval n+1 starts',
		producerStateVersion: `${ precipitationDescriptor.stateVersion }/prepared`,
		consumerInputStateVersion: `${ precipitationDescriptor.stateVersion }/prepared`,
		transportDelay: h.clone( precipitationEmissionSnapshot.transportDelay ),
		forcingSnapshotDigestBeforeEmission,
		forcingSnapshotDigestAfterEmission
	};
	const precipitationMassClosure = {
		controlVolumeId: 'precipitation-air-column-over-environment-support-v4',
		intervalN: h.clone( evaluationInterval ),
		intervalNPlusOne: h.fixtureInterval( c.clocks, c.clockId, 43, 44 ),
		inventoryAtNStartKg: h.evidence( initialAirborneMass, 'kilogram', 'Derived', 'airborne control-volume inventory at interval-n start' ),
		emittedMassDuringNKg: h.evidence( emittedMass, 'kilogram', 'Derived', 'interval-n mass flux times represented area times interval duration' ),
		emittedLiquidMassKg: h.evidence( emittedMass * phase.liquidMassFraction, 'kilogram', 'Derived', 'emitted mass times liquid mass fraction' ),
		emittedIceMassKg: h.evidence( emittedMass * phase.iceMassFraction, 'kilogram', 'Derived', 'emitted mass times ice mass fraction' ),
		inventoryAtNPlusOneBoundaryKg: h.evidence( inventoryAtNPlusOneBoundary, 'kilogram', 'Derived', 'interval-n initial inventory plus the sole cloud emission source' ),
		advectiveInflowDuringNPlusOneKg: h.evidence( advectiveInflowMass, 'kilogram', 'Derived', 'closed fixture lateral inflow' ),
		advectiveOutflowDuringNPlusOneKg: h.evidence( advectiveOutflowMass, 'kilogram', 'Derived', 'closed fixture lateral outflow' ),
		depositedDuringNPlusOneKg: h.evidence( depositedMass, 'kilogram', 'Derived', 'interval-n+1 receiver deposition ledger' ),
		evaporatedDuringNPlusOneKg: h.evidence( evaporatedMass, 'kilogram', 'Derived', 'interval-n+1 liquid-to-vapour phase-change ledger' ),
		sublimatedDuringNPlusOneKg: h.evidence( sublimatedMass, 'kilogram', 'Derived', 'interval-n+1 ice-to-vapour phase-change ledger' ),
		inventoryAtNPlusOneEndKg: h.evidence( finalAirborneMass, 'kilogram', 'Derived', 'closed interval-n+1 control-volume inventory' ),
		numericalResidualKg: h.evidence( 0, 'kilogram', 'Derived', 'additive correction in the interval-n+1 inventory equation after all named boundary/source/sink terms' ),
		maximumResidualKg: h.evidence( 1e-12, 'kilogram', 'Gated', 'provider fixture conservation gate' ),
		intervalNFormula: 'inventoryAtNPlusOneBoundary = inventoryAtNStart + emittedDuringN',
		intervalNPlusOneFormula: 'inventoryAtNPlusOneEnd = inventoryAtNPlusOneBoundary + advectiveInflow - advectiveOutflow - deposited - evaporated - sublimated + numericalResidual'
	};

	const waterChartId = 'water-surface-chart-v6';
	const implicitWaterChartId = 'water-implicit-level-set-chart-v2';
	const waterChartDescriptor = {
		chartId: waterChartId,
		owner: '$threejs-water-optics',
		anchorPhysicsFrameId: c.physicsFrameId,
		physicsOriginEpoch: c.physicsOriginEpoch,
		transformRevision: c.transformRevision,
		chartRevision: 'water-surface-chart-revision-v6',
		coordinateUnitsAndRanges: {
			u: { unit: 'metre', range: h.evidence( [ - 16, 16 ], 'metre', 'Gated', 'water fixture chart domain' ) },
			v: { unit: 'metre', range: h.evidence( [ - 16, 16 ], 'metre', 'Gated', 'water fixture chart domain' ) }
		},
		forwardMap: { mapId: 'water-chart-to-physics-r-u-v-t-v6', revision: 'water-fixed-chart-r-u-v-t-v6' },
		inverseMap: { mapId: 'water-physics-to-chart-newton-v6', residualGate: h.evidence( 0.000001, 'metre', 'Gated', 'water chart inverse residual' ) },
		jacobian: { mapId: 'water-chart-jacobian-v6', orientation: 'positive-upward-normal' },
		metricTensor: { mapId: 'water-first-fundamental-form-v6', unit: 'square-metre' },
		orientation: 'u cross v follows exterior free-surface normal',
		validityDomain: 'single 32 metre by 32 metre patch at the fixture evaluation interval',
		singularitiesAndSeams: 'none inside the registered fixture chart',
		curvatureAndLinearizationError: h.fixtureError( 'metre', 0.001, 'registered water chart linearization' )
	};
	const implicitWaterChartDescriptor = {
		chartId: implicitWaterChartId,
		owner: '$threejs-water-optics',
		anchorPhysicsFrameId: c.physicsFrameId,
		physicsOriginEpoch: c.physicsOriginEpoch,
		transformRevision: c.transformRevision,
		chartRevision: 'water-implicit-level-set-chart-revision-v2',
		coordinateUnitsAndRanges: {
			x: { unit: 'metre', range: h.evidence( [ - 16, 16 ], 'metre', 'Gated', 'implicit water fixture chart domain' ) },
			y: { unit: 'metre', range: h.evidence( [ - 8, 8 ], 'metre', 'Gated', 'implicit water fixture chart domain' ) },
			z: { unit: 'metre', range: h.evidence( [ - 16, 16 ], 'metre', 'Gated', 'implicit water fixture chart domain' ) }
		},
		forwardMap: { mapId: 'water-implicit-level-set-zero-set-v2', revision: 'water-implicit-level-set-remap-v2' },
		inverseMap: { mapId: 'water-implicit-closest-zero-set-v2', residualGate: h.evidence( 0.000001, 'metre', 'Gated', 'implicit chart inverse residual' ) },
		jacobian: { mapId: 'water-implicit-level-set-gradient-v2', orientation: 'gradient points from liquid into exterior' },
		metricTensor: { mapId: 'water-implicit-ambient-euclidean-metric-v2', unit: 'square-metre' },
		orientation: 'right-handed ambient xyz with exterior normal from level-set gradient',
		validityDomain: 'single regular zero-set patch with nonzero gradient at the fixture query',
		singularitiesAndSeams: 'reject where gradient norm or closest-point uniqueness gate fails',
		curvatureAndLinearizationError: h.fixtureError( 'metre', 0.001, 'registered implicit water chart linearization' )
	};
	const chartRegistry = c.context.chartRegistry;
	assert.ok( chartRegistry?.chartsById && typeof chartRegistry.chartsById === 'object', 'provider/water fixture requires physicsContext.chartRegistry.chartsById' );
	assert.equal( chartRegistry.anchorFrameRegistryRevision, c.context.physicsFrameRegistry.registryRevision, 'chart registry must anchor the active frame-registry revision' );
	const chartRegistryRevisionBefore = chartRegistry.registryRevision;
	const contextVersionBeforeChartRegistration = c.context.contextVersion;
	const chartSetDigestBefore = sha256Canonical( chartRegistry.chartsById );
	const providerCharts = { [ waterChartId ]: waterChartDescriptor, [ implicitWaterChartId ]: implicitWaterChartDescriptor };
	let chartSetChanged = false;
	for ( const [ chartId, descriptor ] of Object.entries( providerCharts ) ) {

		if ( chartRegistry.chartsById[ chartId ] ) assert.deepEqual( chartRegistry.chartsById[ chartId ], descriptor, `registered chart ${ chartId } conflicts with provider fixture` );
		else {

			chartRegistry.chartsById[ chartId ] = h.clone( descriptor );
			chartSetChanged = true;

		}

	}
	if ( chartSetChanged ) {

		chartRegistry.registryRevision = `${ chartRegistryRevisionBefore }+provider-water-charts-v1`;
		c.context.contextVersion = `${ contextVersionBeforeChartRegistration }+provider-water-charts-v1`;

	}
	const chartRegistration = {
		contextVersionBefore: contextVersionBeforeChartRegistration,
		contextVersionAfter: c.context.contextVersion,
		chartRegistryRevisionBefore,
		chartRegistryRevisionAfter: chartRegistry.registryRevision,
		anchorFrameRegistryRevision: chartRegistry.anchorFrameRegistryRevision,
		registeredChartIds: Object.keys( providerCharts ).sort(),
		chartSetDigestBefore,
		chartSetDigestAfter: sha256Canonical( chartRegistry.chartsById ),
		atomicPublication: chartSetChanged ? 'context-and-chart-registry-revisions-advanced-together' : 'already-registered-identical-set'
	};
	const waterEvaluationLocations = {
		freeSurface: { evaluationLocationId: 'water-free-surface-r-u-v-t-v6', pointMeters: [ 4, 0.75, - 2 ], equationUse: 'r(u,v,t), tangent derivatives, and exterior normal' },
		materialCurrentAtSurface: { evaluationLocationId: 'water-material-current-at-free-surface-v6', pointMeters: [ 4, 0.75, - 2 ], equationUse: 'material fluid velocity evaluated at the free-surface query point' },
		columnAtQuery: { evaluationLocationId: 'water-column-at-query-v6', pointMeters: [ 4, 0, - 2 ], equationUse: 'gravity-aligned water-column depth and wet/dry classification at query xz' },
		pressureAtQuery: { evaluationLocationId: 'water-pressure-at-query-v6', pointMeters: [ 4, 0, - 2 ], equationUse: 'gauge pressure evaluated 0.75 metre below the sampled free surface' },
		bathymetryAlongGravityRay: { evaluationLocationId: 'water-bathymetry-gravity-ray-v6', pointMeters: [ 4, - 3.75, - 2 ], equationUse: 'first bed intersection along the declared downward gravity ray' },
		implicitFreeSurface: { evaluationLocationId: 'water-implicit-zero-set-point-v2', pointMeters: [ - 3, 0.2, 5 ], equationUse: 'phi(x,t)=0 point and gradient-normal evaluation' },
		implicitMaterialCurrentAtSurface: { evaluationLocationId: 'water-implicit-material-current-point-v2', pointMeters: [ - 3, 0.2, 5 ], equationUse: 'material velocity at the implicit zero-set point' }
	};
	const makeEvaluationSupport = ( supportId, chartId, location, orientation ) => makeSupport( h, {
		supportId, kind: 'point', physicsFrameId: c.physicsFrameId, physicsOriginEpoch: c.physicsOriginEpoch,
		transformRevision: c.transformRevision, chartId,
		geometry: { kind: 'physics-frame-point-metres', evaluationLocationId: location.evaluationLocationId, pointMeters: h.clone( location.pointMeters ), equationUse: location.equationUse },
		orientation, measureUnit: 'sample-count', measure: 1, measureSource: `${ location.evaluationLocationId } exact query`, measureError: 0
	} );
	const waterSupport = makeSupport( h, {
		supportId: 'water-surface-query-support-v6', kind: 'point', physicsFrameId: c.physicsFrameId,
		physicsOriginEpoch: c.physicsOriginEpoch, transformRevision: c.transformRevision, chartId: waterChartId,
		geometry: { kind: 'physics-frame-point-metres', evaluationLocationId: waterEvaluationLocations.columnAtQuery.evaluationLocationId, pointMeters: h.clone( waterEvaluationLocations.columnAtQuery.pointMeters ), equationUse: 'bundle query anchor; each channel declares its equation-specific evaluation support' }, orientation: 'free-surface normal points from liquid into exterior',
		measureUnit: 'sample-count', measure: 1, measureSource: 'one canonical provider query point', measureError: 0
	} );
	const freeSurfaceSupport = makeEvaluationSupport( 'water-free-surface-support-v6', waterChartId, waterEvaluationLocations.freeSurface, 'exterior normal points from liquid into air' );
	const materialCurrentSupport = makeEvaluationSupport( 'water-material-current-support-v6', waterChartId, waterEvaluationLocations.materialCurrentAtSurface, 'physical polar velocity at the free-surface point' );
	const columnSupport = makeEvaluationSupport( 'water-column-support-v6', waterChartId, waterEvaluationLocations.columnAtQuery, 'positive depth follows the declared downward gravity ray' );
	const pressureSupport = makeEvaluationSupport( 'water-pressure-support-v6', waterChartId, waterEvaluationLocations.pressureAtQuery, 'pressure is scalar at the query point' );
	const bathymetrySupport = makeEvaluationSupport( 'water-bathymetry-support-v6', waterChartId, waterEvaluationLocations.bathymetryAlongGravityRay, 'bed point is the first downward gravity-ray intersection' );
	const waterSupportByChannel = {
		freeSurfacePoint: freeSurfaceSupport,
		freeSurfaceNormal: freeSurfaceSupport,
		geometricNormalVelocityMps: freeSurfaceSupport,
		surfacePointVelocityMps: freeSurfaceSupport,
		materialCurrentVelocityMps: materialCurrentSupport,
		waterColumnDepthMeters: columnSupport,
		densityKgPerM3: pressureSupport,
		materialAccelerationMps2: materialCurrentSupport,
		pressurePa: pressureSupport,
		bathymetryPoint: bathymetrySupport,
		wetDryState: columnSupport
	};
	const waterFilter = makeFilter( h, {
		filterId: 'water-surface-query-filter-v6', supportMeasure: 'point', kernelOrTransferFunction: 'phase-resolved reconstruction with declared 0.25 metre shortest retained wavelength',
		spatialBandwidth: 'wavelengths at or above 0.25 metre', temporalBandwidth: 'instantaneous fixed-chart derivative at the query instant',
		phaseSemantics: 'phase-resolved', normalization: 'unit response at the query point', causality: 'instantaneous', errorBound: 0.000001
	} );
	const pressureSemanticsId = 'water-pressure-semantics-v3';
	const pressureFilter = makeFilter( h, {
		filterId: 'water-pressure-query-filter-v6', supportMeasure: 'point',
		kernelOrTransferFunction: { kind: 'point-pressure-evaluation', pressureSemanticsRef: pressureSemanticsId, evaluationLocationId: waterEvaluationLocations.pressureAtQuery.evaluationLocationId },
		spatialBandwidth: 'point evaluation at the declared pressure location', temporalBandwidth: 'instantaneous at datum reference-compatible sample instant',
		phaseSemantics: 'not-applicable', normalization: 'unit response at the pressure evaluation point', causality: 'instantaneous', errorBound: 0.000001
	} );
	const surfacePointVelocity = [ 0.3, 0.4, 0 ];
	const freeSurfaceNormal = [ 0, 1, 0 ];
	const materialCurrentVelocity = [ 0.8, 0.1, 0.2 ];
	const geometricNormalVelocity = dot( surfacePointVelocity, freeSurfaceNormal );
	const surfaceVelocityErrorBound = 0.003;
	const normalErrorBound = 0.002;
	const numericalProjectionErrorBound = 0.000001;
	const velocityGainL1 = vectorL1Norm( freeSurfaceNormal );
	const normalGainL1 = vectorL1Norm( surfacePointVelocity );
	const bilinearProjectionErrorBound = 3 * surfaceVelocityErrorBound * normalErrorBound;
	const geometricNormalVelocityErrorBound = velocityGainL1 * surfaceVelocityErrorBound + normalGainL1 * normalErrorBound + bilinearProjectionErrorBound + numericalProjectionErrorBound;
	const geometricNormalVelocityError = h.fixtureError( 'metre-per-second', geometricNormalVelocityErrorBound, 'water fixed-chart velocity/normal projection error ledger' );
	const waterPressureSemantics = {
		pressureSemanticsId,
		channelId: 'pressurePa',
		unit: 'pascal',
		convention: 'gauge',
		evaluationLocationId: waterEvaluationLocations.pressureAtQuery.evaluationLocationId,
		datum: {
			datumId: 'mean-sea-level-atmospheric-pressure-v3',
			absolutePressurePa: h.evidence( 101325, 'pascal', 'Authored', 'fixture pressure datum' ),
			referenceInstant: h.clone( sampleInstant ),
			physicsFrameId: c.physicsFrameId,
			physicsOriginEpoch: c.physicsOriginEpoch,
			transformRevision: c.transformRevision
		}
	};
	const waterDescriptor = makeDescriptor( h, {
		...descriptorCommon,
		signalId: 'water-surface-provider-sample', providerId: 'water-surface-provider', schemaId: 'physics/water-surface-sample/v1',
		owner: '$threejs-water-optics', consumers: [ '$threejs-procedural-motion-systems', 'route-physics-coordinator' ],
		specs: WATER_SPECS, support: waterSupport, filter: waterFilter, supportByChannel: waterSupportByChannel,
		filterByChannel: { pressurePa: pressureFilter }, chartId: waterChartId,
		samplePhase: 'analytic-at-request', cadenceKind: 'analytic-on-demand', cadenceEvidence: 'batched ordered-resource provider request at the exact registered instant',
		residency: {
			kind: 'gpu', owner: '$threejs-water-optics', deviceId: 'fixture-webgpu-device', queueId: 'default-queue',
			bindingIdentity: 'water-surface-provider-soa-binding-v6', availability: 'same queue after water provider evaluation dependency'
		},
		latency: { ...descriptorCommon.latency, owner: '$threejs-water-optics', hostVisible: false, consumerAvailability: 'same-queue water-provider-evaluation-v6' },
		stateVersion: 'water-surface-sample-state-v6', resourceGeneration: 'water-surface-resource-generation-v6',
		errorOverrides: { geometricNormalVelocityMps: geometricNormalVelocityError }
	} );
	const surfaceParameterization = {
		parameterizationId: 'water-fixed-chart-parameterization-v6',
		chartId: waterChartId,
		parameterizationRevision: 'water-fixed-chart-r-u-v-t-v6',
		physicsFrameId: c.physicsFrameId,
		physicsOriginEpoch: c.physicsOriginEpoch,
		transformRevision: c.transformRevision,
		coordinateMap: { kind: 'explicit-r-u-v-t', revision: 'water-fixed-chart-r-u-v-t-v6', parameterCoordinates: [ 'u-metre', 'v-metre' ], timeCoordinate: c.clockId },
		gaugeConvention: 'fixed-chart-coordinates',
		validityDomainAndSeams: { domain: 'single 32 metre by 32 metre patch', seams: 'none inside fixture query support' },
		error: h.fixtureError( 'metre', 0.001, 'water fixed-chart parameterization truncation' )
	};
	const waterAbsent = [ 'materialAccelerationMps2', 'bathymetryPoint' ];
	const waterValues = {
		freeSurfacePoint: [ 4, 0.75, - 2 ],
		freeSurfaceNormal,
		geometricNormalVelocityMps: geometricNormalVelocity,
		surfacePointVelocityMps: surfacePointVelocity,
		materialCurrentVelocityMps: materialCurrentVelocity,
		waterColumnDepthMeters: 4.5,
		densityKgPerM3: 1025,
		pressurePa: 1025 * 9.81 * 0.75,
		wetDryState: 'wet'
	};
	const waterSurfaceSample = {
		descriptor: waterDescriptor,
		sampleInstant: h.clone( sampleInstant ),
		surfaceParameterization,
		...Object.fromEntries( WATER_CHANNEL_FIELDS.map( ( id ) => [
			id,
			waterAbsent.includes( id ) ? absenceAt( h, '$threejs-water-optics', sampleTime, id ) : makeSampledChannel( h, waterDescriptor, id, waterValues[ id ], sampleTime )
		] ) ),
		representedFootprint: h.clone( waterSupport ),
		filter: h.clone( waterFilter ),
		validity: h.clone( waterDescriptor.validity ),
		error: h.fixtureError( 'normalized-consumer-tolerance-ratio', 0.5, 'water-surface atomic bundle correlation bound' ),
		absentChannels: waterAbsent
	};
	const implicitWaterDescriptor = h.clone( waterDescriptor );
	implicitWaterDescriptor.signalId = 'water-implicit-surface-provider-sample';
	implicitWaterDescriptor.providerId = 'water-implicit-level-set-provider';
	implicitWaterDescriptor.chartId = implicitWaterChartId;
	implicitWaterDescriptor.representedFootprint = makeEvaluationSupport( 'water-implicit-query-support-v2', implicitWaterChartId, waterEvaluationLocations.implicitFreeSurface, 'implicit free-surface exterior normal' );
	const implicitMaterialSupport = makeEvaluationSupport( 'water-implicit-material-current-support-v2', implicitWaterChartId, waterEvaluationLocations.implicitMaterialCurrentAtSurface, 'physical material velocity at the implicit free-surface point' );
	for ( const channel of Object.values( implicitWaterDescriptor.channels ) ) {

		channel.declaredSupport = h.clone( implicitWaterDescriptor.representedFootprint );
		channel.declaredFilter = h.clone( waterFilter );

	}
	for ( const channelId of [ 'materialCurrentVelocityMps', 'materialAccelerationMps2' ] ) implicitWaterDescriptor.channels[ channelId ].declaredSupport = h.clone( implicitMaterialSupport );
	implicitWaterDescriptor.stateVersion = 'water-implicit-surface-state-v2';
	implicitWaterDescriptor.resourceGeneration.generation = 'water-implicit-surface-resource-generation-v2';
	implicitWaterDescriptor.residency.bindingIdentity = 'water-implicit-surface-soa-binding-v2';
	const implicitNormalVelocityError = h.fixtureError( 'metre-per-second', 0.002, 'implicit level-set normal-speed residual' );
	implicitNormalVelocityError.quantityOrChannelId = 'geometricNormalVelocityMps';
	implicitWaterDescriptor.perChannelError.geometricNormalVelocityMps = implicitNormalVelocityError;
	implicitWaterDescriptor.channels.geometricNormalVelocityMps.errorRef = implicitNormalVelocityError.errorId;
	const implicitWaterAbsent = [ 'surfacePointVelocityMps', 'materialAccelerationMps2', 'pressurePa', 'bathymetryPoint' ];
	const implicitWaterValues = {
		freeSurfacePoint: [ - 3, 0.2, 5 ],
		freeSurfaceNormal: [ 0, 1, 0 ],
		geometricNormalVelocityMps: 0.2,
		materialCurrentVelocityMps: [ 0.2, 0, 0.1 ],
		waterColumnDepthMeters: 1.5,
		densityKgPerM3: 1000,
		wetDryState: 'wet'
	};
	const implicitWaterSurfaceSample = {
		descriptor: implicitWaterDescriptor,
		sampleInstant: h.clone( sampleInstant ),
		surfaceParameterization: {
			parameterizationId: 'water-implicit-level-set-parameterization-v2',
			chartId: implicitWaterChartId,
			parameterizationRevision: 'water-implicit-level-set-remap-v2',
			physicsFrameId: c.physicsFrameId,
			physicsOriginEpoch: c.physicsOriginEpoch,
			transformRevision: c.transformRevision,
			coordinateMap: { kind: 'implicit-level-set-remap', revision: 'water-implicit-level-set-remap-v2', zeroSet: 'phi(x,t)=0', normalSpeedSource: '-partial_t(phi)/norm(gradient(phi))' },
			gaugeConvention: 'named-remap',
			validityDomainAndSeams: { domain: 'registered water chart fixture patch', seams: 'level-set remap remains single-valued at query point' },
			error: h.fixtureError( 'metre', 0.001, 'implicit level-set remap residual' )
		},
		...Object.fromEntries( WATER_CHANNEL_FIELDS.map( ( id ) => [
			id,
			implicitWaterAbsent.includes( id ) ? absenceAt( h, 'water-implicit-level-set-provider', sampleTime, id ) : makeSampledChannel( h, implicitWaterDescriptor, id, implicitWaterValues[ id ], sampleTime )
		] ) ),
		representedFootprint: h.clone( implicitWaterDescriptor.representedFootprint ),
		filter: h.clone( waterFilter ),
		validity: h.clone( implicitWaterDescriptor.validity ),
		error: h.fixtureError( 'normalized-consumer-tolerance-ratio', 0.5, 'implicit water atomic bundle correlation bound' ),
		absentChannels: implicitWaterAbsent
	};
	const parameterizationBindings = {
		[ surfaceParameterization.parameterizationId ]: {
			parameterizationId: surfaceParameterization.parameterizationId,
			parameterizationRevision: surfaceParameterization.parameterizationRevision,
			coordinateMapRevision: surfaceParameterization.coordinateMap.revision,
			chartId: surfaceParameterization.chartId,
			chartRevision: waterChartDescriptor.chartRevision,
			chartForwardMapRevision: waterChartDescriptor.forwardMap.revision,
			descriptorSignalId: waterDescriptor.signalId,
			descriptorStateVersion: waterDescriptor.stateVersion,
			contextVersion: c.context.contextVersion,
			chartRegistryRevision: chartRegistry.registryRevision
		},
		[ implicitWaterSurfaceSample.surfaceParameterization.parameterizationId ]: {
			parameterizationId: implicitWaterSurfaceSample.surfaceParameterization.parameterizationId,
			parameterizationRevision: implicitWaterSurfaceSample.surfaceParameterization.parameterizationRevision,
			coordinateMapRevision: implicitWaterSurfaceSample.surfaceParameterization.coordinateMap.revision,
			chartId: implicitWaterSurfaceSample.surfaceParameterization.chartId,
			chartRevision: implicitWaterChartDescriptor.chartRevision,
			chartForwardMapRevision: implicitWaterChartDescriptor.forwardMap.revision,
			descriptorSignalId: implicitWaterDescriptor.signalId,
			descriptorStateVersion: implicitWaterDescriptor.stateVersion,
			contextVersion: c.context.contextVersion,
			chartRegistryRevision: chartRegistry.registryRevision
		}
	};

	const errorPropagationLedger = {
		ledgerId: 'water-geometric-normal-velocity-error-ledger-v6',
		contextId: c.context.contextId,
		outputSignalOrInteractionId: 'water-surface-provider-sample/geometricNormalVelocityMps',
		outputStateVersion: waterDescriptor.stateVersion,
		evaluationInterval: h.clone( evaluationInterval ),
		inputErrors: [
			{ errorId: waterDescriptor.perChannelError.surfacePointVelocityMps.errorId, channelId: 'surfacePointVelocityMps', bound: h.clone( waterDescriptor.perChannelError.surfacePointVelocityMps.boundOrStatistic ) },
			{ errorId: waterDescriptor.perChannelError.freeSurfaceNormal.errorId, channelId: 'freeSurfaceNormal', bound: h.clone( waterDescriptor.perChannelError.freeSurfaceNormal.boundOrStatistic ) }
		],
		transformsFiltersInterpolations: [ { operationId: 'fixed-chart-normal-projection-v6', formula: 'dot(surfacePointVelocityMps, freeSurfaceNormal)', filterId: waterFilter.filterId, localNumericalErrorBound: h.evidence( numericalProjectionErrorBound, 'metre-per-second', 'Derived', 'bounded floating projection implementation' ) } ],
		correlationAssumptions: [ { inputs: [ 'surfacePointVelocityMps', 'freeSurfaceNormal' ], model: 'bounded-adversarial', consequence: 'triangle combination, no independence discount' } ],
		operatorOrGainBounds: [
			{ inputErrorId: waterDescriptor.perChannelError.surfacePointVelocityMps.errorId, gain: h.evidence( velocityGainL1, 'ratio', 'Derived', 'L-infinity dual norm gain ||n||_1' ), outputContribution: h.evidence( velocityGainL1 * surfaceVelocityErrorBound, 'metre-per-second', 'Derived', '||n||_1 times componentwise L-infinity velocity error' ) },
			{ inputErrorId: waterDescriptor.perChannelError.freeSurfaceNormal.errorId, gain: h.evidence( normalGainL1, 'metre-per-second', 'Derived', 'L-infinity dual norm gain ||v||_1' ), outputContribution: h.evidence( normalGainL1 * normalErrorBound, 'metre-per-second', 'Derived', '||v||_1 times componentwise L-infinity normal error' ) }
		],
		modeledApproximationTerms: [ { termId: 'velocity-normal-bilinear-cross-term-v6', bound: h.evidence( bilinearProjectionErrorBound, 'metre-per-second', 'Derived', 'three components times e_velocity_Linf times e_normal_Linf' ) } ],
		numericalTerms: [ { termId: 'projection-roundoff-v6', bound: h.evidence( numericalProjectionErrorBound, 'metre-per-second', 'Derived', 'bounded floating projection implementation' ) } ],
		combinationRule: 'linf-dot-v2: ||n||_1 e_velocity_Linf + ||v||_1 e_normal_Linf + 3 e_velocity_Linf e_normal_Linf + e_numerical',
		outputError: h.clone( waterDescriptor.perChannelError.geometricNormalVelocityMps ),
		acceptanceGate: { maximumError: h.evidence( 0.006, 'metre-per-second', 'Gated', 'water provider consumer tolerance' ), passed: geometricNormalVelocityErrorBound <= 0.006 },
		provenance: { providerAdapterBuild: 'water-provider-fixture-v6', equationRevision: 'fixed-chart-normal-projection-v1', arithmetic: 'finite IEEE-754 binary64 fixture evaluation' }
	};
	const errorPropagationLedgersById = { [ errorPropagationLedger.ledgerId ]: errorPropagationLedger };
	assert.ok( route.physicsErrorPropagationLedgers && typeof route.physicsErrorPropagationLedgers === 'object', 'provider/water fixture requires route.physicsErrorPropagationLedgers inventory' );
	if ( route.physicsErrorPropagationLedgers[ errorPropagationLedger.ledgerId ] ) assert.deepEqual( route.physicsErrorPropagationLedgers[ errorPropagationLedger.ledgerId ], errorPropagationLedger, 'route contains a conflicting provider error ledger' );
	else route.physicsErrorPropagationLedgers[ errorPropagationLedger.ledgerId ] = h.clone( errorPropagationLedger );
	const requestRequiredChannels = [ 'freeSurfacePoint', 'freeSurfaceNormal', 'geometricNormalVelocityMps', 'surfacePointVelocityMps', 'materialCurrentVelocityMps' ];
	const requestOptionalChannels = WATER_CHANNEL_FIELDS.filter( ( id ) => ! requestRequiredChannels.includes( id ) );
	const waterSampleRequest = {
		requestId: 'water-surface-sample-request-v6',
		contextId: waterDescriptor.contextId,
		providerId: waterDescriptor.providerId,
		signalId: waterDescriptor.signalId,
		schemaId: waterDescriptor.schemaId,
		requestedPhysicsTime: h.clone( sampleTime ),
		requiredChannels: requestRequiredChannels,
		optionalChannels: requestOptionalChannels,
		queryFrameId: waterDescriptor.physicsFrameId,
		physicsOriginEpoch: waterDescriptor.physicsOriginEpoch,
		transformRevision: waterDescriptor.transformRevision,
		chartId: waterDescriptor.chartId,
		querySupport: h.clone( waterSupport ),
		requestedFilter: h.clone( waterFilter ),
		tolerancesByChannel: WATER_CHANNEL_FIELDS.map( ( channelId ) => ( {
			channelId,
			norm: waterDescriptor.perChannelError[ channelId ].norm,
			maximumError: h.evidence( quantityValue( waterDescriptor.perChannelError[ channelId ].boundOrStatistic, `${ channelId } descriptor error` ) * 2 + Number.EPSILON, waterDescriptor.channels[ channelId ].unit, 'Gated', `${ channelId } provider-request tolerance` ),
			maximumAge: h.fixtureDurationSeconds( 1 / 60, `${ channelId } provider-request maximum age` ),
			requiredValidity: [ 'valid' ]
		} ) ),
		maximumStaleness: h.clone( waterDescriptor.latency.maximumStaleness ),
		acceptableResidency: [ 'gpu' ],
		acceptableLatency: h.clone( waterDescriptor.latency ),
		batchExtent: {
			sampleCount: h.evidence( 1, 'sample', 'Derived', 'one fixture query point' ),
			layout: 'structure-of-arrays in descriptor channel order',
			maximumLogicalBytes: h.evidence( 256, 'byte', 'Gated', 'fixture request layout bound' )
		},
		responseMode: 'values',
		exactOnceKey: 'water-request-sequence-6'
	};
	const responseChannels = Object.fromEntries( WATER_CHANNEL_FIELDS.filter( ( id ) => ! waterAbsent.includes( id ) ).map( ( id ) => [ id, h.clone( waterSurfaceSample[ id ] ) ] ) );
	const responseAbsentChannels = Object.fromEntries( waterAbsent.map( ( id ) => [ id, h.clone( waterSurfaceSample[ id ] ) ] ) );
	const waterSampleResponseEnvelope = {
		requestId: waterSampleRequest.requestId,
		descriptorRef: {
			signalId: waterDescriptor.signalId,
			descriptorStateVersion: waterDescriptor.stateVersion,
			schemaId: waterDescriptor.schemaId,
			contextId: waterDescriptor.contextId
		},
		requestedPhysicsTime: h.clone( sampleTime ),
		actualBundleTime: h.clone( sampleTime ),
		resultStateVersion: waterDescriptor.stateVersion,
		resourceGeneration: h.clone( waterDescriptor.resourceGeneration ),
		channels: responseChannels,
		absentChannels: responseAbsentChannels,
		representedSupport: h.clone( waterSupport ),
		actualFilter: h.clone( waterFilter ),
		latency: h.clone( waterDescriptor.latency ),
		residency: h.clone( waterDescriptor.residency ),
		validity: h.clone( waterDescriptor.validity ),
		error: h.clone( waterSurfaceSample.error ),
		errorPropagationLedgerRef: errorPropagationLedger.ledgerId,
		provenance: {
			providerAdapterBuild: 'water-provider-fixture-v6', requestBatchExtent: h.evidence( 1, 'sample', 'Derived', 'water request batch extent' ), responseMode: waterSampleRequest.responseMode, exactOnceKey: waterSampleRequest.exactOnceKey,
			pressureSemanticsRef: pressureSemanticsId, pressureEvaluationLocationId: waterEvaluationLocations.pressureAtQuery.evaluationLocationId,
			interpolationExtrapolationPolicy: { policy: 'exact-analytic-evaluation', interpolation: 'not-used', extrapolation: 'forbidden', errorLedgerRef: errorPropagationLedger.ledgerId },
			providerDependency: { dependencyId: 'water-provider-evaluation-v6', completionSemantics: 'same-queue ordered-resource response after exact analytic evaluation', hostReadback: 'forbidden' }
		}
	};
	waterPressureSemantics.bindings = {
		descriptor: { signalId: waterDescriptor.signalId, stateVersion: waterDescriptor.stateVersion, channelId: 'pressurePa', declaredFilterId: waterDescriptor.channels.pressurePa.declaredFilter.filterId, pressureSemanticsRef: pressureSemanticsId },
		sample: { sampleInstant: h.clone( waterSurfaceSample.sampleInstant ), stateVersion: waterSurfaceSample.pressurePa.stateVersion, channelId: waterSurfaceSample.pressurePa.channelId, actualFilterId: waterSurfaceSample.pressurePa.actualFilter.filterId, pressureSemanticsRef: pressureSemanticsId },
		responseEnvelope: { requestId: waterSampleResponseEnvelope.requestId, resultStateVersion: waterSampleResponseEnvelope.resultStateVersion, channelId: waterSampleResponseEnvelope.channels.pressurePa.channelId, pressureSemanticsRef: waterSampleResponseEnvelope.provenance.pressureSemanticsRef }
	};
	const precipitationGraphLineage = buildPrecipitationGraphLineage( h, route, {
		clocks: c.clocks,
		clockId: c.clockId,
		intervalN: evaluationInterval,
		environmentDescriptor,
		environmentSnapshot: environmentForcingSnapshot,
		precipitationDescriptor,
		precipitationSnapshot: precipitationEmissionSnapshot,
		massClosure: precipitationMassClosure
	} );

	return {
		environmentForcingSnapshot,
		forcingImmutability: {
			beforeEmissionDigest: forcingSnapshotDigestBeforeEmission,
			afterEmissionDigest: forcingSnapshotDigestAfterEmission
		},
		precipitationEmissionSnapshot,
		precipitationMassClosure,
		precipitationTransportProof,
		precipitationGraphLineage,
		waterChartDescriptor,
		implicitWaterChartDescriptor,
		chartRegistration,
		parameterizationBindings,
		waterEvaluationLocations,
		waterSurfaceSample,
		waterPressureSemantics,
		implicitWaterSurfaceSample,
		waterSampleRequest,
		waterSampleResponseEnvelope,
		errorPropagationLedgersById,
		fixtureMetadata: {
			contextId: c.context.contextId,
			clockId: c.clockId,
			physicsFrameId: c.physicsFrameId,
			physicsOriginEpoch: c.physicsOriginEpoch,
			transformRevision: c.transformRevision,
			evaluationInterval: h.clone( evaluationInterval ),
			performanceEvidenceScope: {
				precipitationCpuPath: 'complete graph/cost lineage for this fixture',
				waterGpuProviderPath: 'semantic/provider-envelope evidence only; composed route PhysicsCostLedger remains the performance authority',
				forbiddenInference: 'do not infer GPU dispatch, batch scaling, active-tile, halo, or target performance from the one-sample analytic provider fixture'
			},
			geometricNormalVelocityErrorInputs: {
				surfaceVelocityErrorBound,
				normalErrorBound,
				numericalProjectionErrorBound,
				bilinearProjectionErrorBound,
				velocityGainL1,
				normalGainL1
			}
		}
	};

}

function assertTypedAbsence( h, value, label ) {

	h.requireAbiRecord( value, 'TypedAbsence', label );
	assert.deepEqual( sortedKeys( value ), [ 'authority', 'effectiveTime', 'kind', 'provenance', 'reason', 'schemaId' ], `${ label } has noncanonical TypedAbsence keys` );
	assert.equal( value.kind, 'absent', `${ label } is not a TypedAbsence` );
	assert.equal( value.schemaId, 'typed-absence-v1', `${ label } has stale TypedAbsence schema` );

}

function assertDescriptorClosure( h, descriptor, route, label ) {

	h.requireAbiRecord( descriptor, 'PhysicsSignalDescriptor', label );
	assert.equal( descriptor.contextId, route.physicsContext.contextId, `${ label } context mismatch` );
	const frame = route.physicsContext.physicsFrameRegistry.framesById[ descriptor.physicsFrameId ];
	assert.ok( frame, `${ label } physics frame is not registered` );
	assert.equal( descriptor.physicsOriginEpoch, route.physicsContext.physicsOriginEpoch, `${ label } origin epoch mismatch` );
	assert.equal( descriptor.transformRevision, frame.transformRevision, `${ label } transform revision mismatch` );
	assert.ok( route.physicsContext.physicsClockRegistry.clocksById[ descriptor.clockId ], `${ label } clock is not registered` );
	assertSetEqual( sortedKeys( descriptor.channels ), sortedKeys( descriptor.perChannelError ), `${ label } channel/error key closure failed` );
	for ( const [ channelId, channel ] of Object.entries( descriptor.channels ) ) {

		h.requireAbiRecord( channel, 'PhysicsChannelDescriptor', `${ label }.channels.${ channelId }` );
		h.requireAbiRecord( descriptor.perChannelError[ channelId ], 'PhysicsErrorDescriptor', `${ label }.perChannelError.${ channelId }` );
		assert.equal( channel.channelId, channelId, `${ label } channel map key mismatch` );
		assert.equal( channel.errorRef, descriptor.perChannelError[ channelId ].errorId, `${ label } unresolved errorRef for ${ channelId }` );
		assert.equal( descriptor.perChannelError[ channelId ].quantityOrChannelId, channelId, `${ label } error quantity/channel identity mismatch for ${ channelId }` );
		h.requireAbiRecord( channel.declaredSupport, 'PhysicsSupportDescriptor', `${ label }.channels.${ channelId }.declaredSupport` );
		h.requireAbiRecord( channel.declaredFilter, 'PhysicsFilterDescriptor', `${ label }.channels.${ channelId }.declaredFilter` );
		assert.equal( channel.declaredSupport.physicsFrameId, descriptor.physicsFrameId, `${ label } support frame drift for ${ channelId }` );
		assert.equal( channel.declaredSupport.physicsOriginEpoch, descriptor.physicsOriginEpoch, `${ label } support origin drift for ${ channelId }` );
		assert.equal( channel.declaredSupport.transformRevision, descriptor.transformRevision, `${ label } support transform drift for ${ channelId }` );
		assert.deepEqual( channel.declaredSupport.chartId, descriptor.chartId, `${ label } support chart drift for ${ channelId }` );

	}
	if ( descriptor.resourceGeneration.kind === 'present' ) {

		assert.notEqual( descriptor.residency.kind, 'cpu', `${ label } CPU descriptor cannot claim a GPU resource generation` );
		assert.equal( typeof descriptor.resourceGeneration.generation, 'string', `${ label } resource generation must be versioned` );

	} else {

		assert.equal( descriptor.residency.kind, 'cpu', `${ label } absent resource generation is only used by this fixture's CPU snapshots` );
		assertTypedAbsence( h, descriptor.resourceGeneration.generation, `${ label }.resourceGeneration.generation` );

	}

}

function assertSampledChannelClosure( h, sampled, descriptor, channelId, expectedTime, expectedSupport, expectedFilter, label ) {

	h.requireAbiRecord( sampled, 'SampledChannel', label );
	const declared = descriptor.channels[ channelId ];
	assert.ok( declared, `${ label } has no descriptor channel` );
	assert.equal( sampled.channelId, channelId, `${ label } channelId mismatch` );
	assert.equal( sampled.unit, declared.unit, `${ label } unit mismatch` );
	assert.deepEqual( sampled.actualPhysicsTime, expectedTime, `${ label } actual time mismatch` );
	assert.deepEqual( sampled.actualSupport, expectedSupport, `${ label } actual support mismatch` );
	assert.deepEqual( sampled.actualFilter, expectedFilter, `${ label } actual filter mismatch` );
	assert.equal( sampled.stateVersion, descriptor.stateVersion, `${ label } state version mismatch` );
	assert.equal( sampled.validity, 'valid', `${ label } must be valid in the positive fixture` );
	assert.deepEqual( sampled.error, descriptor.perChannelError[ channelId ], `${ label } sampled error does not resolve to descriptor authority` );

}

function assertSnapshotFieldClosure( h, snapshot, descriptor, channelFields, absentFields, expectedTime, expectedSupport, expectedFilter, label ) {

	assertSetEqual( descriptor.channels ? sortedKeys( descriptor.channels ) : [], channelFields, `${ label } descriptor channel inventory mismatch` );
	assertSetEqual( snapshot.absentChannels, absentFields, `${ label } absentChannels inventory mismatch` );
	for ( const channelId of channelFields ) {

		const value = snapshot[ channelId ];
		if ( absentFields.includes( channelId ) ) assertTypedAbsence( h, value, `${ label }.${ channelId }` );
		else assertSampledChannelClosure( h, value, descriptor, channelId, expectedTime, descriptor.channels[ channelId ].declaredSupport ?? expectedSupport, descriptor.channels[ channelId ].declaredFilter ?? expectedFilter, `${ label }.${ channelId }` );

	}

}

function assertPhaseClosure( phase, label ) {

	assert.deepEqual( sortedKeys( phase ), [ 'iceMassFraction', 'liquidMassFraction' ], `${ label } must carry exact phase mass fractions` );
	assert.ok( phase.liquidMassFraction >= 0 && phase.iceMassFraction >= 0, `${ label } has a negative phase mass fraction` );
	assertNear( phase.liquidMassFraction + phase.iceMassFraction, 1, 1e-12, `${ label } mass fractions do not close` );

}

function assertChannelValueShape( value, spec, label ) {

	if ( spec.valueType === 'scalar' ) assert.ok( typeof value === 'number' && Number.isFinite( value ), `${ label } must be a finite scalar` );
	else if ( spec.valueType === 'Vec3' ) assert.ok( Array.isArray( value ) && value.length === 3 && value.every( Number.isFinite ), `${ label } must be a finite Vec3` );
	else assert.ok( value !== undefined && value !== null, `${ label } structured value is missing` );

}

function assertDescriptorSpecClosure( descriptor, specs, snapshot, label ) {

	assertSetEqual( sortedKeys( descriptor.channels ), specs.map( ( spec ) => spec.id ), `${ label } descriptor channel/spec inventory mismatch` );
	for ( const spec of specs ) {

		const channel = descriptor.channels[ spec.id ];
		const error = descriptor.perChannelError[ spec.id ];
		assert.equal( channel.valueType, spec.valueType, `${ label}.${ spec.id } valueType drift` );
		assert.equal( channel.tensorRankAndShape, spec.tensorRankAndShape, `${ label}.${ spec.id } tensor shape drift` );
		assert.equal( channel.unit, spec.unit, `${ label}.${ spec.id } descriptor unit must be canonical ${ spec.unit }` );
		assert.equal( channel.basisBehavior, spec.basisBehavior, `${ label}.${ spec.id } basis behavior drift` );
		assert.equal( channel.quantityClass, spec.quantityClass, `${ label}.${ spec.id } quantity class drift` );
		assert.equal( channel.timeSemantics, spec.timeSemantics, `${ label}.${ spec.id } time semantics drift` );
		assert.equal( error.boundOrStatistic.unit, spec.unit, `${ label}.${ spec.id } error unit must be canonical ${ spec.unit }` );
		const sampled = snapshot?.[ spec.id ];
		if ( sampled && sampled.kind !== 'absent' ) {

			assert.equal( sampled.unit, spec.unit, `${ label}.${ spec.id } sampled unit must be canonical ${ spec.unit }` );
			assertChannelValueShape( sampled.value, spec, `${ label}.${ spec.id }.value` );

		}

	}

}

function validateEnvironmentForcing( h, bundle, route ) {

	const snapshot = bundle.environmentForcingSnapshot;
	h.requireAbiRecord( snapshot, 'EnvironmentForcingSnapshot', 'environmentForcingSnapshot' );
	assertDescriptorClosure( h, snapshot.descriptor, route, 'environmentForcingSnapshot.descriptor' );
	assertDescriptorSpecClosure( snapshot.descriptor, ENVIRONMENT_SPECS, snapshot, 'environmentForcingSnapshot' );
	const expectedTime = instantTime( h.clone, h.typedAbsence, snapshot.sampleInstant, 'provider-fixture-coordinator' );
	assertSnapshotFieldClosure( h, snapshot, snapshot.descriptor, ENVIRONMENT_CHANNEL_FIELDS, snapshot.absentChannels, expectedTime, snapshot.descriptor.representedFootprint, snapshot.descriptor.filter, 'environmentForcingSnapshot' );
	assertSetEqual( snapshot.absentChannels, [
		'airPressurePa',
		'specificHumidityKgPerKg',
		'turbulenceStatistics',
		'precipitationMassFluxKgPerM2S',
		'precipitationPhase',
		'precipitationVelocityMps',
		'mediumMaterialVelocityMps'
	], 'environment forcing canonical absent set drifted' );
	assert.equal( snapshot.temperatureK.unit, 'kelvin', 'environment temperature must be kelvin' );
	for ( const channelId of [ 'precipitationMassFluxKgPerM2S', 'precipitationPhase', 'precipitationVelocityMps' ] ) assertTypedAbsence( h, snapshot[ channelId ], `environmentForcingSnapshot.${ channelId }` );
	assert.equal( snapshot.descriptor.owner, 'project-environment-coordinator', 'environment owner cannot become a second precipitation-emission authority' );
	assert.equal( bundle.precipitationEmissionSnapshot.descriptor.owner, 'causal-cloud-microphysics-provider', 'cloud microphysics must be the sole precipitation-emission authority' );
	assert.deepEqual( route.physicsSignals.environmentForcing, snapshot.descriptor, 'environment forcing descriptor is not installed in route.physicsSignals' );
	assert.notDeepEqual( snapshot.airVelocityMps.value, bundle.waterSurfaceSample.materialCurrentVelocityMps.value, 'atmospheric wind cannot alias water material current' );

}

function validatePrecipitationEmission( h, bundle, route ) {

	const snapshot = bundle.precipitationEmissionSnapshot;
	h.requireAbiRecord( snapshot, 'PrecipitationEmissionSnapshot', 'precipitationEmissionSnapshot' );
	assertDescriptorClosure( h, snapshot.descriptor, route, 'precipitationEmissionSnapshot.descriptor' );
	assertDescriptorSpecClosure( snapshot.descriptor, PRECIPITATION_SPECS, snapshot, 'precipitationEmissionSnapshot' );
	assert.equal( snapshot.descriptor.owner, 'causal-cloud-microphysics-provider', 'precipitation emission owner must be causal cloud microphysics' );
	assert.deepEqual( route.physicsSignals.precipitationEmission, snapshot.descriptor, 'precipitation emission descriptor is not installed in route.physicsSignals' );
	const expectedTime = intervalTime( h.clone, h.typedAbsence, snapshot.emissionInterval, 'provider-fixture-coordinator' );
	for ( const channelId of PRECIPITATION_CHANNEL_FIELDS ) assertSampledChannelClosure( h, snapshot[ channelId ], snapshot.descriptor, channelId, expectedTime, snapshot.destinationFootprint, snapshot.descriptor.filter, `precipitationEmissionSnapshot.${ channelId }` );
	assert.deepEqual( snapshot.destinationFootprint, snapshot.descriptor.representedFootprint, 'precipitation destination support does not close to descriptor support' );
	assertPhaseClosure( snapshot.phase.value, 'precipitation emission phase' );
	h.requireAbiRecord( snapshot.airborneInventory.value, 'MassInventory', 'precipitationEmissionSnapshot.airborneInventory.value' );
	assert.equal( snapshot.airborneInventory.value.kind, 'total-mass', 'canonical fixture uses a total-mass airborne inventory' );
	assertTypedAbsence( h, snapshot.airborneInventory.value.densityField, 'precipitationEmissionSnapshot.airborneInventory.value.densityField' );
	const closure = bundle.precipitationMassClosure;
	for ( const field of [ 'inventoryAtNStartKg', 'emittedMassDuringNKg', 'emittedLiquidMassKg', 'emittedIceMassKg', 'inventoryAtNPlusOneBoundaryKg', 'advectiveInflowDuringNPlusOneKg', 'advectiveOutflowDuringNPlusOneKg', 'depositedDuringNPlusOneKg', 'evaporatedDuringNPlusOneKg', 'sublimatedDuringNPlusOneKg', 'inventoryAtNPlusOneEndKg', 'numericalResidualKg', 'maximumResidualKg' ] ) quantityValueIn( closure[ field ], 'kilogram', `precipitationMassClosure.${ field }` );
	const flux = snapshot.emittedMassFluxKgPerM2S.value;
	const area = quantityValue( snapshot.destinationFootprint.representedMeasure, 'precipitation destination representedMeasure' );
	const elapsed = durationSeconds( snapshot.emissionInterval );
	const emitted = flux * area * elapsed;
	assert.deepEqual( closure.intervalN, snapshot.emissionInterval, 'precipitation mass closure names another emission interval' );
	assert.deepEqual( closure.intervalN.endExclusive, closure.intervalNPlusOne.start, 'precipitation mass-closure intervals are not adjacent' );
	assertNear( quantityValue( closure.emittedMassDuringNKg, 'precipitationMassClosure.emittedMassDuringNKg' ), emitted, 1e-12, 'precipitation emitted mass is not flux times area times time' );
	assertNear( quantityValue( closure.emittedLiquidMassKg, 'precipitationMassClosure.emittedLiquidMassKg' ) + quantityValue( closure.emittedIceMassKg, 'precipitationMassClosure.emittedIceMassKg' ), emitted, 1e-12, 'precipitation phase masses do not close to emitted mass' );
	assertNear( quantityValue( closure.emittedLiquidMassKg, 'precipitationMassClosure.emittedLiquidMassKg' ), emitted * snapshot.phase.value.liquidMassFraction, 1e-12, 'liquid emitted mass does not match its mass fraction' );
	assertNear( quantityValue( closure.emittedIceMassKg, 'precipitationMassClosure.emittedIceMassKg' ), emitted * snapshot.phase.value.iceMassFraction, 1e-12, 'ice emitted mass does not match its mass fraction' );
	const maximumResidual = quantityValue( closure.maximumResidualKg, 'precipitationMassClosure.maximumResidualKg' );
	const intervalNStart = quantityValue( closure.inventoryAtNStartKg, 'precipitationMassClosure.inventoryAtNStartKg' );
	const boundary = quantityValue( closure.inventoryAtNPlusOneBoundaryKg, 'precipitationMassClosure.inventoryAtNPlusOneBoundaryKg' );
	assertNear( boundary, intervalNStart + emitted, maximumResidual, 'interval-n precipitation emission does not close to the n+1 boundary inventory' );
	const inflow = quantityValue( closure.advectiveInflowDuringNPlusOneKg, 'precipitationMassClosure.advectiveInflowDuringNPlusOneKg' );
	const outflow = quantityValue( closure.advectiveOutflowDuringNPlusOneKg, 'precipitationMassClosure.advectiveOutflowDuringNPlusOneKg' );
	const deposited = quantityValue( closure.depositedDuringNPlusOneKg, 'precipitationMassClosure.depositedDuringNPlusOneKg' );
	const evaporated = quantityValue( closure.evaporatedDuringNPlusOneKg, 'precipitationMassClosure.evaporatedDuringNPlusOneKg' );
	const sublimated = quantityValue( closure.sublimatedDuringNPlusOneKg, 'precipitationMassClosure.sublimatedDuringNPlusOneKg' );
	const residual = quantityValue( closure.numericalResidualKg, 'precipitationMassClosure.numericalResidualKg' );
	assert.ok( Math.abs( residual ) <= maximumResidual, 'precipitation numerical residual exceeds its declared gate' );
	const reconstructedEnd = boundary + inflow - outflow - deposited - evaporated - sublimated + residual;
	assertNear( quantityValue( closure.inventoryAtNPlusOneEndKg, 'precipitationMassClosure.inventoryAtNPlusOneEndKg' ), reconstructedEnd, maximumResidual, 'interval-n+1 precipitation transport inventory does not close' );
	assertNear( quantityValue( snapshot.airborneInventory.value.totalMassKg, 'airborne inventory totalMassKg' ), boundary, maximumResidual, 'published airborne inventory differs from the declared n+1 boundary state' );
	const forcingDigest = sha256Canonical( bundle.environmentForcingSnapshot );
	assert.equal( bundle.forcingImmutability.beforeEmissionDigest, forcingDigest, 'forcing snapshot differs from its pre-emission digest' );
	assert.equal( bundle.forcingImmutability.afterEmissionDigest, forcingDigest, 'precipitation emission mutated the already latched forcing snapshot' );
	const proof = bundle.precipitationTransportProof;
	assert.deepEqual( proof.producerInterval, snapshot.emissionInterval, 'precipitation transport proof names another producer interval' );
	assert.equal( proof.producerStateVersion, `${ snapshot.descriptor.stateVersion }/prepared`, 'precipitation transport proof has stale producer state' );
	assert.equal( proof.consumerInputStateVersion, `${ snapshot.descriptor.stateVersion }/prepared`, 'precipitation consumer does not read the immutable producer version' );
	assert.equal( proof.producerInterval.clockId, proof.consumerInterval.clockId, 'precipitation n-to-n+1 proof mixes clocks' );
	assert.deepEqual( proof.producerInterval.endExclusive, proof.consumerInterval.start, 'precipitation consumer interval does not begin at the producer interval boundary' );
	assert.equal( proof.transportDelay.kind, 'seconds', 'canonical n-to-n+1 transport delay must use seconds' );
	assertNear( quantityValue( proof.transportDelay.seconds, 'precipitation transport delay' ), 0, 0, 'canonical n-to-n+1 fixture requires zero boundary delay' );
	assert.match( proof.ordering, /producer interval n completes before consumer interval n\+1 starts/, 'precipitation transport proof lacks explicit n-to-n+1 ordering' );
	assert.equal( proof.forcingSnapshotDigestBeforeEmission, forcingDigest, 'precipitation proof has stale pre-emission forcing digest' );
	assert.equal( proof.forcingSnapshotDigestAfterEmission, forcingDigest, 'precipitation proof has stale post-emission forcing digest' );

}

function validatePrecipitationGraphLineage( h, bundle ) {

	const lineage = bundle.precipitationGraphLineage;
	assert.ok( lineage && typeof lineage === 'object', 'precipitation graph lineage is missing' );
	const graph = lineage.graph;
	h.requireAbiRecord( graph, 'PhysicsGraph', 'precipitationGraphLineage.graph' );
	h.requireAbiRecord( graph.coordinationAdvance, 'PhysicsCoordinationAdvanceRecord', 'precipitationGraphLineage.graph.coordinationAdvance' );
	const proof = bundle.precipitationTransportProof;
	assert.equal( graph.graphId, proof.graphId, 'precipitation proof does not resolve its PhysicsGraph' );
	assert.equal( graph.coordinationAdvance.coordinationAdvanceId, proof.coordinationAdvanceId, 'precipitation proof does not resolve its coordination advance' );
	const stagesById = new Map();
	for ( const [ index, stage ] of graph.stages.entries() ) {

		h.requireAbiRecord( stage, 'PhysicsGraphStage', `precipitationGraphLineage.graph.stages[${ index }]` );
		assert.ok( ! stagesById.has( stage.stageId ), `precipitation graph duplicates stage ${ stage.stageId }` );
		stagesById.set( stage.stageId, stage );

	}
	assert.deepEqual( [ stagesById.get( proof.producerStageId )?.stageKind, stagesById.get( proof.consumerStageId )?.stageKind ], [ 'sample-forcing', 'solve-subcycles' ], 'precipitation graph producer/consumer stage kinds drifted' );
	assert.deepEqual( stagesById.get( proof.producerStageId ).executionInterval, proof.producerInterval, 'precipitation producer stage interval differs from proof' );
	assert.deepEqual( stagesById.get( proof.consumerStageId ).executionInterval, proof.consumerInterval, 'precipitation consumer stage interval differs from proof' );
	assert.deepEqual( proof.producerInterval.endExclusive, proof.consumerInterval.start, 'precipitation graph does not hand interval n to adjacent n+1' );
	const edgesById = new Map();
	for ( const [ index, edge ] of graph.edges.entries() ) {

		h.requireAbiRecord( edge, 'PhysicsGraphEdge', `precipitationGraphLineage.graph.edges[${ index }]` );
		assert.ok( stagesById.has( edge.producerStageId ) && stagesById.has( edge.consumerStageId ), `precipitation edge ${ edge.edgeId } has unresolved stages` );
		edgesById.set( edge.edgeId, edge );

	}
	const transportEdge = edgesById.get( 'cloud-emission-to-transport-v4' );
	assert.ok( transportEdge, 'precipitation graph lacks the cloud-emission-to-transport edge' );
	assert.deepEqual( [ transportEdge.producerStageId, transportEdge.consumerStageId, transportEdge.barrier.dependencyId, transportEdge.requiredVersionAndPhase.stateVersion ], [ proof.producerStageId, proof.consumerStageId, proof.graphDependencyId, proof.consumerInputStateVersion ], 'precipitation transport edge differs from the proof' );
	const dependenciesById = new Map();
	for ( const [ index, dependency ] of graph.dependencies.entries() ) {

		h.requireAbiRecord( dependency, 'PhysicsDependency', `precipitationGraphLineage.graph.dependencies[${ index }]` );
		dependenciesById.set( dependency.dependencyId, dependency );

	}
	const transportDependency = dependenciesById.get( proof.graphDependencyId );
	assert.ok( transportDependency, 'precipitation transport dependency template is unresolved' );
	assert.deepEqual( [ transportDependency.producerStageId, transportDependency.consumerStageId ], [ proof.producerStageId, proof.consumerStageId ], 'precipitation dependency binds another execution pair' );
	const ledger = graph.executionLedger;
	h.requireAbiRecord( ledger, 'PhysicsExecutionLedger', 'precipitationGraphLineage.graph.executionLedger' );
	const executionsById = new Map();
	const executionsByStage = new Map();
	for ( const [ index, execution ] of ledger.stageExecutions.entries() ) {

		h.requireAbiRecord( execution, 'PhysicsStageExecution', `precipitationGraphLineage.graph.executionLedger.stageExecutions[${ index }]` );
		executionsById.set( execution.executionId, execution );
		executionsByStage.set( execution.stageId, execution );

	}
	assertSetEqual( graph.coordinationAdvance.stageExecutionIds, [ ...executionsById.keys() ], 'precipitation coordination advance/stage execution closure failed' );
	const completionsByDependency = new Map();
	for ( const [ index, completion ] of ledger.dependencyCompletions.entries() ) {

		h.requireAbiRecord( completion, 'PhysicsDependencyCompletion', `precipitationGraphLineage.graph.executionLedger.dependencyCompletions[${ index }]` );
		assert.ok( dependenciesById.has( completion.dependencyId ), `precipitation completion ${ completion.completionId } has no template` );
		assert.ok( executionsById.has( completion.producerExecutionId ) && executionsById.has( completion.consumerExecutionId ), `precipitation completion ${ completion.completionId } has unresolved executions` );
		assert.ok( ! completionsByDependency.has( completion.dependencyId ), `precipitation dependency ${ completion.dependencyId } has more than one completion in the one-execution fixture` );
		completionsByDependency.set( completion.dependencyId, completion );

	}
	const transportCompletion = completionsByDependency.get( proof.graphDependencyId );
	assert.ok( transportCompletion, 'precipitation transport has no concrete dependency completion' );
	assert.deepEqual( [ transportCompletion.producerExecutionId, transportCompletion.consumerExecutionId, transportCompletion.payloadAndVersion.stateVersion ], [ executionsByStage.get( proof.producerStageId ).executionId, executionsByStage.get( proof.consumerStageId ).executionId, proof.consumerInputStateVersion ], 'precipitation transport completion does not close the exact execution/version edge' );
	for ( const [ index, claim ] of ledger.stateAdvanceClaims.entries() ) h.requireAbiRecord( claim, 'StateAdvanceClaim', `precipitationGraphLineage.graph.executionLedger.stateAdvanceClaims[${ index }]` );
	assertSetEqual( graph.coordinationAdvance.stateAdvanceClaimIds, ledger.stateAdvanceClaims.map( ( claim ) => claim.claimId ), 'precipitation coordination advance/state claim closure failed' );
	assert.deepEqual( ledger.stateAdvanceClaims.map( ( claim ) => claim.applicationInterval ), [ proof.producerInterval, proof.consumerInterval ], 'precipitation state claims do not separately own n and n+1 intervals' );
	assert.equal( graph.commitTransactions.length, 1, 'precipitation graph must have one atomic commit transaction' );
	const transaction = graph.commitTransactions[ 0 ];
	h.requireAbiRecord( transaction, 'PhysicsCommitTransaction', 'precipitationGraphLineage.graph.commitTransactions[0]' );
	assert.equal( transaction.commitTransactionId, proof.commitTransactionId, 'precipitation proof does not resolve its commit transaction' );
	assert.equal( transaction.status, 'committed', 'precipitation transaction is not committed' );
	h.requireAbiRecord( transaction.receipt, 'PhysicsCommitReceipt', 'precipitationGraphLineage.graph.commitTransactions[0].receipt' );
	assert.equal( transaction.receipt.publicationSetDigest, transaction.publicationSetDigest, 'precipitation receipt publication set differs from transaction' );
	assertSetEqual( graph.coordinationAdvance.commitTransactionIds, [ transaction.commitTransactionId ], 'precipitation coordination advance/commit closure failed' );
	h.requireAbiRecord( lineage.timeCohort, 'PresentationTimeCohort', 'precipitationGraphLineage.timeCohort' );
	h.requireAbiRecord( lineage.candidate, 'PhysicsPresentationCandidate', 'precipitationGraphLineage.candidate' );
	assert.deepEqual( [ lineage.candidate.candidateId, lineage.candidate.timeCohortId, lineage.candidate.requestedPresentationInstant ], [ proof.candidateId, lineage.timeCohort.timeCohortId, lineage.timeCohort.requestedPresentationInstant ], 'precipitation candidate/cohort lineage drifted' );
	assertSetEqual( lineage.candidate.commitProvenance.commitTransactionIds, [ transaction.commitTransactionId ], 'precipitation candidate omits its commit transaction' );
	assert.equal( lineage.candidate.commitProvenance.closedPublicationSetDigest, transaction.publicationSetDigest, 'precipitation candidate publication-set digest differs from commit' );
	h.requireAbiRecord( lineage.costLedger, 'PhysicsCostLedger', 'precipitationGraphLineage.costLedger' );
	assert.deepEqual( [ lineage.costLedger.ledgerId, lineage.costLedger.graphId, lineage.costLedger.graphRevision ], [ proof.physicsCostLedgerId, graph.graphId, ledger.graphRevision ], 'precipitation cost ledger is not bound to the executed graph revision' );
	assertSetEqual( lineage.costLedger.graphStageCosts.map( ( record ) => record.stageId ), graph.stages.map( ( stage ) => stage.stageId ), 'precipitation cost ledger stage inventory does not close' );
	assertSetEqual( sortedKeys( lineage.costLedger.cadenceTraceTotals.stageExecutionCounts ), graph.stages.map( ( stage ) => stage.stageId ), 'precipitation cost trace stage-count inventory does not close' );
	assertNear( quantityValue( lineage.costLedger.hostCompletionsReadbacksPerPresentedFrame, 'precipitation cost readbacks' ), 0, 0, 'precipitation provider fixture requires zero GPU readback' );
	assert.deepEqual( graph.executionLedger.physicsCostLedgerId, lineage.costLedger.ledgerId, 'precipitation execution ledger points to another cost ledger' );

}

function validateWaterSurface( h, bundle, route ) {

	const sample = bundle.waterSurfaceSample;
	h.requireAbiRecord( sample, 'WaterSurfaceSample', 'waterSurfaceSample' );
	h.requireAbiRecord( sample.surfaceParameterization, 'WaterSurfaceParameterization', 'waterSurfaceSample.surfaceParameterization' );
	assertDescriptorClosure( h, sample.descriptor, route, 'waterSurfaceSample.descriptor' );
	assertDescriptorSpecClosure( sample.descriptor, WATER_SPECS, sample, 'waterSurfaceSample' );
	h.requireAbiRecord( route.physicsContext.chartRegistry, 'PhysicsChartRegistry', 'physicsContext.chartRegistry' );
	const registeredChart = route.physicsContext.chartRegistry.chartsById[ sample.surfaceParameterization.chartId ];
	assert.ok( registeredChart, `water parameterization chart ${ sample.surfaceParameterization.chartId } is not registered` );
	h.requireAbiRecord( registeredChart, 'PhysicsChartDescriptor', `physicsContext.chartRegistry.chartsById.${ sample.surfaceParameterization.chartId }` );
	assert.deepEqual( registeredChart, bundle.waterChartDescriptor, 'water fixture chart differs from registered chart authority' );
	assert.equal( registeredChart.anchorPhysicsFrameId, sample.descriptor.physicsFrameId, 'water chart anchor frame mismatch' );
	assert.equal( registeredChart.physicsOriginEpoch, sample.descriptor.physicsOriginEpoch, 'water chart origin epoch mismatch' );
	assert.equal( registeredChart.transformRevision, sample.descriptor.transformRevision, 'water chart transform revision mismatch' );
	assert.equal( route.physicsContext.chartRegistry.registryRevision, bundle.chartRegistration.chartRegistryRevisionAfter, 'water chart registry revision differs from atomic provider registration' );
	assert.equal( route.physicsContext.contextVersion, bundle.chartRegistration.contextVersionAfter, 'water Context version differs from atomic chart registration' );
	assert.equal( bundle.chartRegistration.chartSetDigestAfter, sha256Canonical( route.physicsContext.chartRegistry.chartsById ), 'water registered chart-set digest is stale' );
	const expectedTime = instantTime( h.clone, h.typedAbsence, sample.sampleInstant, 'provider-fixture-coordinator' );
	assertSnapshotFieldClosure( h, sample, sample.descriptor, WATER_CHANNEL_FIELDS, sample.absentChannels, expectedTime, sample.representedFootprint, sample.filter, 'waterSurfaceSample' );
	for ( const required of WATER_REQUIRED_FIELDS ) assert.ok( ! sample.absentChannels.includes( required ), `mandatory water channel ${ required } cannot be absent` );
	assertSetEqual( sample.absentChannels, [ 'materialAccelerationMps2', 'bathymetryPoint' ], 'water canonical absent set drifted' );
	assert.ok( WATER_OPTIONAL_FIELDS.includes( 'surfacePointVelocityMps' ) && WATER_OPTIONAL_FIELDS.includes( 'materialCurrentVelocityMps' ), 'water velocity classification drifted' );
	assert.equal( sample.surfaceParameterization.chartId, sample.descriptor.chartId, 'water parameterization chart does not match descriptor chart' );
	assert.equal( sample.surfaceParameterization.physicsFrameId, sample.descriptor.physicsFrameId, 'water parameterization frame mismatch' );
	assert.equal( sample.surfaceParameterization.physicsOriginEpoch, sample.descriptor.physicsOriginEpoch, 'water parameterization origin epoch mismatch' );
	assert.equal( sample.surfaceParameterization.transformRevision, sample.descriptor.transformRevision, 'water parameterization transform revision mismatch' );
	assert.equal( sample.surfaceParameterization.gaugeConvention, 'fixed-chart-coordinates', 'projection fixture requires the exact fixed-chart velocity gauge' );
	const parameterizationBinding = bundle.parameterizationBindings[ sample.surfaceParameterization.parameterizationId ];
	assert.ok( parameterizationBinding, 'water parameterization has no immutable registry binding' );
	assert.deepEqual( [ parameterizationBinding.parameterizationRevision, parameterizationBinding.coordinateMapRevision, parameterizationBinding.chartForwardMapRevision ], [ sample.surfaceParameterization.parameterizationRevision, sample.surfaceParameterization.coordinateMap.revision, registeredChart.forwardMap.revision ], 'water parameterization/map/chart revisions do not close' );
	assert.deepEqual( [ parameterizationBinding.contextVersion, parameterizationBinding.chartRegistryRevision ], [ route.physicsContext.contextVersion, route.physicsContext.chartRegistry.registryRevision ], 'water parameterization binding uses stale Context/chart-registry revisions' );
	assert.equal( sample.surfaceParameterization.parameterizationRevision, sample.surfaceParameterization.coordinateMap.revision, 'water parameterization revision differs from coordinate-map revision' );
	assert.equal( sample.surfaceParameterization.coordinateMap.revision, registeredChart.forwardMap.revision, 'water coordinate-map revision differs from registered chart forward map' );
	const expectedLocationByChannel = {
		freeSurfacePoint: 'freeSurface', freeSurfaceNormal: 'freeSurface', geometricNormalVelocityMps: 'freeSurface', surfacePointVelocityMps: 'freeSurface',
		materialCurrentVelocityMps: 'materialCurrentAtSurface', waterColumnDepthMeters: 'columnAtQuery', densityKgPerM3: 'pressureAtQuery',
		materialAccelerationMps2: 'materialCurrentAtSurface', pressurePa: 'pressureAtQuery', bathymetryPoint: 'bathymetryAlongGravityRay', wetDryState: 'columnAtQuery'
	};
	for ( const [ channelId, locationKey ] of Object.entries( expectedLocationByChannel ) ) assert.equal( sample.descriptor.channels[ channelId ].declaredSupport.geometry.evaluationLocationId, bundle.waterEvaluationLocations[ locationKey ].evaluationLocationId, `water ${ channelId } uses the wrong equation-specific evaluation location` );
	const normal = sample.freeSurfaceNormal.value;
	const surfaceVelocity = sample.surfacePointVelocityMps.value;
	const materialCurrent = sample.materialCurrentVelocityMps.value;
	const geometricSpeed = sample.geometricNormalVelocityMps.value;
	assertNear( vectorNorm( normal ), 1, 1e-12, 'water free-surface normal is not unit length' );
	assertNear( geometricSpeed, dot( surfaceVelocity, normal ), 1e-12, 'geometric normal velocity is not the fixed-chart surface velocity projection' );
	assert.notDeepEqual( surfaceVelocity, materialCurrent, 'surface-point velocity aliases material current' );
	assert.ok( Math.abs( geometricSpeed - dot( materialCurrent, normal ) ) > 0.1, 'fixture no longer distinguishes interface motion from material current' );
	if ( sample.wetDryState.value === 'wet' ) {

		assert.ok( ! sample.absentChannels.includes( 'waterColumnDepthMeters' ), 'wet query cannot omit represented depth in this fixture' );
		assert.ok( sample.waterColumnDepthMeters.value >= 0, 'wet water depth cannot be negative' );

	} else if ( sample.wetDryState.value === 'dry' ) assertTypedAbsence( h, sample.waterColumnDepthMeters, 'dry waterSurfaceSample.waterColumnDepthMeters' );
	else assert.fail( `water wetDryState ${ sample.wetDryState.value } is not canonical` );
	assert.equal( sample.pressurePa.unit, 'pascal', 'water pressure channel must use pascal' );
	assert.equal( sample.descriptor.channels.pressurePa.unit, 'pascal', 'water pressure descriptor must use pascal' );
	assert.equal( bundle.waterPressureSemantics.channelId, sample.pressurePa.channelId, 'water pressure semantics refer to another channel' );
	assert.equal( bundle.waterPressureSemantics.unit, 'pascal', 'water pressure semantics unit must be pascal' );
	assert.equal( sample.pressurePa.actualFilter.kernelOrTransferFunction.pressureSemanticsRef, bundle.waterPressureSemantics.pressureSemanticsId, 'water sample pressure filter does not reference the pressure convention/datum' );
	assert.equal( bundle.waterSampleResponseEnvelope.provenance.pressureSemanticsRef, bundle.waterPressureSemantics.pressureSemanticsId, 'water response envelope does not reference the pressure convention/datum' );
	assert.equal( sample.descriptor.channels.pressurePa.declaredFilter.kernelOrTransferFunction.pressureSemanticsRef, bundle.waterPressureSemantics.pressureSemanticsId, 'water descriptor does not reference the pressure convention/datum' );
	assert.deepEqual( bundle.waterPressureSemantics.bindings.descriptor.pressureSemanticsRef, bundle.waterPressureSemantics.bindings.sample.pressureSemanticsRef, 'water pressure descriptor/sample bindings disagree' );
	assert.deepEqual( bundle.waterPressureSemantics.bindings.sample.pressureSemanticsRef, bundle.waterPressureSemantics.bindings.responseEnvelope.pressureSemanticsRef, 'water pressure sample/envelope bindings disagree' );
	assert.ok( [ 'absolute', 'gauge' ].includes( bundle.waterPressureSemantics.convention ), 'water pressure convention must be absolute or gauge' );
	if ( bundle.waterPressureSemantics.convention === 'gauge' ) {

		const datum = bundle.waterPressureSemantics.datum;
		assert.ok( datum && typeof datum === 'object', 'gauge water pressure requires a typed datum' );
		assert.equal( typeof datum.datumId, 'string', 'gauge water pressure datum requires an ID' );
		assert.equal( datum.physicsFrameId, sample.descriptor.physicsFrameId, 'gauge pressure datum frame mismatch' );
		assert.equal( datum.physicsOriginEpoch, sample.descriptor.physicsOriginEpoch, 'gauge pressure datum origin epoch mismatch' );
		assert.equal( datum.transformRevision, sample.descriptor.transformRevision, 'gauge pressure datum transform revision mismatch' );
		assert.equal( datum.absolutePressurePa.unit, 'pascal', 'gauge pressure absolute datum must use pascal' );
		assert.deepEqual( datum.referenceInstant, sample.sampleInstant, 'gauge pressure datum referenceInstant differs from sample instant' );
		assert.ok( quantityValue( datum.absolutePressurePa, 'water gauge pressure absolute datum' ) > 0, 'gauge pressure absolute datum must be positive' );
		const surfaceY = bundle.waterEvaluationLocations.freeSurface.pointMeters[ 1 ];
		const pressureY = bundle.waterEvaluationLocations.pressureAtQuery.pointMeters[ 1 ];
		const expectedGaugePressure = sample.densityKgPerM3.value * 9.81 * ( surfaceY - pressureY );
		assertNear( sample.pressurePa.value, expectedGaugePressure, quantityValue( sample.pressurePa.error.boundOrStatistic, 'water pressure error' ), 'gauge pressure does not match its declared evaluation location/datum convention' );

	}

}

function validateImplicitWaterSurface( h, bundle, route ) {

	const sample = bundle.implicitWaterSurfaceSample;
	h.requireAbiRecord( sample, 'WaterSurfaceSample', 'implicitWaterSurfaceSample' );
	h.requireAbiRecord( sample.surfaceParameterization, 'WaterSurfaceParameterization', 'implicitWaterSurfaceSample.surfaceParameterization' );
	assertDescriptorClosure( h, sample.descriptor, route, 'implicitWaterSurfaceSample.descriptor' );
	assertDescriptorSpecClosure( sample.descriptor, WATER_SPECS, sample, 'implicitWaterSurfaceSample' );
	const registeredChart = route.physicsContext.chartRegistry.chartsById[ sample.surfaceParameterization.chartId ];
	assert.ok( registeredChart, `implicit water chart ${ sample.surfaceParameterization.chartId } is not registered` );
	assert.deepEqual( registeredChart, bundle.implicitWaterChartDescriptor, 'implicit water sample does not resolve the registered chart authority' );
	const parameterizationBinding = bundle.parameterizationBindings[ sample.surfaceParameterization.parameterizationId ];
	assert.ok( parameterizationBinding, 'implicit water parameterization has no immutable registry binding' );
	assert.deepEqual( [ parameterizationBinding.parameterizationRevision, parameterizationBinding.coordinateMapRevision, parameterizationBinding.chartForwardMapRevision ], [ sample.surfaceParameterization.parameterizationRevision, sample.surfaceParameterization.coordinateMap.revision, registeredChart.forwardMap.revision ], 'implicit water parameterization/map/chart revisions do not close' );
	assert.deepEqual( [ parameterizationBinding.contextVersion, parameterizationBinding.chartRegistryRevision ], [ route.physicsContext.contextVersion, route.physicsContext.chartRegistry.registryRevision ], 'implicit water parameterization binding uses stale Context/chart-registry revisions' );
	assert.equal( sample.surfaceParameterization.parameterizationRevision, sample.surfaceParameterization.coordinateMap.revision, 'implicit parameterization revision differs from coordinate-map revision' );
	assert.equal( sample.surfaceParameterization.coordinateMap.revision, registeredChart.forwardMap.revision, 'implicit coordinate-map revision differs from chart forward map' );
	const expectedTime = instantTime( h.clone, h.typedAbsence, sample.sampleInstant, 'provider-fixture-coordinator' );
	assertSnapshotFieldClosure( h, sample, sample.descriptor, WATER_CHANNEL_FIELDS, sample.absentChannels, expectedTime, sample.representedFootprint, sample.filter, 'implicitWaterSurfaceSample' );
	assertSetEqual( sample.absentChannels, [ 'surfacePointVelocityMps', 'materialAccelerationMps2', 'pressurePa', 'bathymetryPoint' ], 'implicit water canonical absent set drifted' );
	assert.ok( sample.absentChannels.includes( 'surfacePointVelocityMps' ), 'implicit water positive must explicitly omit full fixed-coordinate velocity' );
	assertTypedAbsence( h, sample.surfacePointVelocityMps, 'implicitWaterSurfaceSample.surfacePointVelocityMps' );
	assert.ok( ! sample.absentChannels.includes( 'geometricNormalVelocityMps' ), 'implicit water positive must publish geometric normal speed' );
	assert.equal( sample.geometricNormalVelocityMps.validity, 'valid', 'implicit water normal speed must be valid' );
	assert.equal( sample.surfaceParameterization.gaugeConvention, 'named-remap', 'implicit water sample must serialize its named remap gauge' );
	assert.match( sample.surfaceParameterization.coordinateMap.kind, /implicit-level-set/, 'implicit water sample must serialize its level-set map' );
	assert.equal( sample.descriptor.channels.freeSurfacePoint.declaredSupport.geometry.evaluationLocationId, bundle.waterEvaluationLocations.implicitFreeSurface.evaluationLocationId, 'implicit surface equation uses the wrong evaluation location' );
	assert.equal( sample.descriptor.channels.materialCurrentVelocityMps.declaredSupport.geometry.evaluationLocationId, bundle.waterEvaluationLocations.implicitMaterialCurrentAtSurface.evaluationLocationId, 'implicit material-current equation uses the wrong evaluation location' );
	assertNear( vectorNorm( sample.freeSurfaceNormal.value ), 1, 1e-12, 'implicit water normal is not unit length' );
	assert.ok( Math.abs( sample.geometricNormalVelocityMps.value - dot( sample.materialCurrentVelocityMps.value, sample.freeSurfaceNormal.value ) ) > 0.1, 'implicit interface normal speed was inferred from material current' );

}

function validateWaterSampleRequest( h, bundle ) {

	const request = bundle.waterSampleRequest;
	const response = bundle.waterSampleResponseEnvelope;
	const descriptor = bundle.waterSurfaceSample.descriptor;
	h.requireAbiRecord( request, 'PhysicsSampleRequest', 'waterSampleRequest' );
	assert.equal( request.requestId, response.requestId, 'water request/response ID mismatch' );
	assert.equal( request.contextId, descriptor.contextId, 'water request context mismatch' );
	assert.equal( request.providerId, descriptor.providerId, 'water request provider mismatch' );
	assert.equal( request.signalId, descriptor.signalId, 'water request signal mismatch' );
	assert.equal( request.schemaId, descriptor.schemaId, 'water request schema mismatch' );
	assert.deepEqual( request.requestedPhysicsTime, response.requestedPhysicsTime, 'water request time differs from response request time' );
	assert.ok( Array.isArray( request.requiredChannels ), 'water request requiredChannels must be an array' );
	assert.ok( Array.isArray( request.optionalChannels ), 'water request optionalChannels must be an array' );
	assert.equal( new Set( request.requiredChannels ).size, request.requiredChannels.length, 'water request duplicates a required channel' );
	assert.equal( new Set( request.optionalChannels ).size, request.optionalChannels.length, 'water request duplicates an optional channel' );
	for ( const channelId of request.requiredChannels ) assert.ok( ! request.optionalChannels.includes( channelId ), `water request channel ${ channelId } is both required and optional` );
	assertSetEqual( [ ...request.requiredChannels, ...request.optionalChannels ], sortedKeys( descriptor.channels ), 'water request channel masks do not close to descriptor discovery' );
	for ( const channelId of request.requiredChannels ) assert.ok( Object.hasOwn( response.channels, channelId ), `water response omitted required channel ${ channelId }` );
	for ( const channelId of request.optionalChannels ) assert.notEqual( Object.hasOwn( response.channels, channelId ), Object.hasOwn( response.absentChannels, channelId ), `water response optional channel ${ channelId } must select exactly one present/absent arm` );
	assert.equal( request.queryFrameId, descriptor.physicsFrameId, 'water request query frame mismatch' );
	assert.equal( request.physicsOriginEpoch, descriptor.physicsOriginEpoch, 'water request origin epoch mismatch' );
	assert.equal( request.transformRevision, descriptor.transformRevision, 'water request transform revision mismatch' );
	assert.equal( request.chartId, descriptor.chartId, 'water request chart mismatch' );
	assert.deepEqual( request.querySupport, descriptor.representedFootprint, 'water request support mismatch' );
	assert.deepEqual( request.requestedFilter, descriptor.filter, 'water request filter mismatch' );
	assert.deepEqual( request.maximumStaleness, descriptor.latency.maximumStaleness, 'water request staleness gate does not close to descriptor latency' );
	assert.deepEqual( request.acceptableLatency, descriptor.latency, 'water request latency gate does not close to descriptor latency' );
	assert.ok( Array.isArray( request.acceptableResidency ) && request.acceptableResidency.includes( descriptor.residency.kind ), 'water request rejects the response residency' );
	assert.equal( request.responseMode, response.provenance.responseMode, 'water response mode differs from request' );
	assert.equal( request.exactOnceKey, response.provenance.exactOnceKey, 'water request exact-once key was not preserved' );
	assert.equal( quantityValue( request.batchExtent.sampleCount, 'waterSampleRequest.batchExtent.sampleCount' ), quantityValue( response.provenance.requestBatchExtent, 'waterSampleResponseEnvelope.provenance.requestBatchExtent' ), 'water response batch extent differs from request' );
	assertSetEqual( request.tolerancesByChannel.map( ( tolerance ) => tolerance.channelId ), sortedKeys( descriptor.channels ), 'water request tolerance inventory mismatch' );
	for ( const [ index, tolerance ] of request.tolerancesByChannel.entries() ) {

		h.requireAbiRecord( tolerance, 'PhysicsChannelTolerance', `waterSampleRequest.tolerancesByChannel[${ index }]` );
		const error = descriptor.perChannelError[ tolerance.channelId ];
		assert.ok( error, `water request tolerance ${ tolerance.channelId } is unresolved` );
		assert.equal( tolerance.norm, error.norm, `water request tolerance norm mismatch for ${ tolerance.channelId }` );
		assert.equal( tolerance.maximumError.unit, descriptor.channels[ tolerance.channelId ].unit, `water request tolerance unit mismatch for ${ tolerance.channelId }` );
		assert.ok( quantityValue( tolerance.maximumError, `${ tolerance.channelId } maximumError` ) >= quantityValue( error.boundOrStatistic, `${ tolerance.channelId } provider error` ), `water request tolerance is below provider error for ${ tolerance.channelId }` );
		assert.ok( tolerance.requiredValidity.includes( 'valid' ), `water request tolerance does not accept valid ${ tolerance.channelId }` );
		assert.ok( quantityValue( tolerance.maximumAge.seconds, `${ tolerance.channelId } maximumAge` ) <= quantityValue( request.maximumStaleness.seconds, 'water request maximumStaleness' ), `water request tolerance age exceeds bundle staleness for ${ tolerance.channelId }` );

	}

}

function validateResponseAndErrorLedger( h, bundle, route ) {

	const response = bundle.waterSampleResponseEnvelope;
	const sample = bundle.waterSurfaceSample;
	const descriptor = sample.descriptor;
	validateWaterSampleRequest( h, bundle );
	h.requireAbiRecord( response, 'PhysicsSampleResponseEnvelope', 'waterSampleResponseEnvelope' );
	h.requireAbiRecord( response.descriptorRef, 'PhysicsSignalDescriptorRef', 'waterSampleResponseEnvelope.descriptorRef' );
	assert.deepEqual( response.descriptorRef, {
		signalId: descriptor.signalId,
		descriptorStateVersion: descriptor.stateVersion,
		schemaId: descriptor.schemaId,
		contextId: descriptor.contextId
	}, 'water response descriptor ref is stale or unresolved' );
	const expectedTime = instantTime( h.clone, h.typedAbsence, sample.sampleInstant, 'provider-fixture-coordinator' );
	assert.deepEqual( response.requestedPhysicsTime, expectedTime, 'water response requested time mismatch' );
	assert.deepEqual( response.actualBundleTime, expectedTime, 'water response actual bundle time mismatch' );
	assert.equal( response.resultStateVersion, descriptor.stateVersion, 'water response state version mismatch' );
	assert.deepEqual( response.resourceGeneration, descriptor.resourceGeneration, 'water response resource generation mismatch' );
	assert.deepEqual( response.representedSupport, sample.representedFootprint, 'water response support mismatch' );
	assert.deepEqual( response.actualFilter, sample.filter, 'water response filter mismatch' );
	assert.deepEqual( response.latency, descriptor.latency, 'water response latency mismatch' );
	assert.deepEqual( response.residency, descriptor.residency, 'water response residency mismatch' );
	assert.deepEqual( response.validity, sample.validity, 'water response validity mismatch' );
	assert.deepEqual( response.error, sample.error, 'water response aggregate error mismatch' );
	assert.deepEqual( response.provenance.interpolationExtrapolationPolicy, { policy: 'exact-analytic-evaluation', interpolation: 'not-used', extrapolation: 'forbidden', errorLedgerRef: response.errorPropagationLedgerRef }, 'water analytic provider interpolation/extrapolation policy is ambiguous' );
	assert.equal( response.provenance.providerDependency.hostReadback, 'forbidden', 'water GPU provider response may not require host readback' );
	assertSetEqual( sortedKeys( response.channels ), WATER_CHANNEL_FIELDS.filter( ( id ) => ! sample.absentChannels.includes( id ) ), 'water response present channel closure failed' );
	assertSetEqual( sortedKeys( response.absentChannels ), sample.absentChannels, 'water response absent channel closure failed' );
	assert.equal( new Set( [ ...sortedKeys( response.channels ), ...sortedKeys( response.absentChannels ) ] ).size, WATER_CHANNEL_FIELDS.length, 'water response channel arms overlap or omit a descriptor channel' );
	for ( const [ channelId, channel ] of Object.entries( response.channels ) ) assert.deepEqual( channel, sample[ channelId ], `water response channel ${ channelId } differs from the canonical sample` );
	for ( const [ channelId, absence ] of Object.entries( response.absentChannels ) ) {

		assertTypedAbsence( h, absence, `waterSampleResponseEnvelope.absentChannels.${ channelId }` );
		assert.deepEqual( absence, sample[ channelId ], `water response absence ${ channelId } differs from the canonical sample` );

	}
	const ledgers = bundle.errorPropagationLedgersById;
	assert.deepEqual( sortedKeys( ledgers ), [ response.errorPropagationLedgerRef ], 'water response error ledger ref must resolve exactly once' );
	const ledger = ledgers[ response.errorPropagationLedgerRef ];
	h.requireAbiRecord( ledger, 'ErrorPropagationLedger', `errorPropagationLedgersById.${ response.errorPropagationLedgerRef }` );
	assert.equal( ledger.contextId, descriptor.contextId, 'water error ledger context mismatch' );
	assert.equal( ledger.outputSignalOrInteractionId, `${ descriptor.signalId }/geometricNormalVelocityMps`, 'water error ledger output ID mismatch' );
	assert.equal( ledger.outputStateVersion, descriptor.stateVersion, 'water error ledger output version mismatch' );
	assert.deepEqual( ledger.evaluationInterval, bundle.fixtureMetadata.evaluationInterval, 'water error ledger evaluation interval mismatch' );
	assert.deepEqual( ledger.outputError, descriptor.perChannelError.geometricNormalVelocityMps, 'water error ledger output does not own the descriptor channel error' );
	assert.deepEqual( ledger.outputError, sample.geometricNormalVelocityMps.error, 'water error ledger output does not own the sampled channel error' );
	const errorById = new Map( Object.values( descriptor.perChannelError ).map( ( error ) => [ error.errorId, error ] ) );
	for ( const input of ledger.inputErrors ) {

		assert.ok( errorById.has( input.errorId ), `water error ledger input ${ input.errorId } is unresolved` );
		assert.deepEqual( input.bound, errorById.get( input.errorId ).boundOrStatistic, `water error ledger input bound ${ input.errorId } drifted` );

	}
	const surfaceVelocityError = quantityValue( descriptor.perChannelError.surfacePointVelocityMps.boundOrStatistic, 'surfacePointVelocityMps error' );
	const normalError = quantityValue( descriptor.perChannelError.freeSurfaceNormal.boundOrStatistic, 'freeSurfaceNormal error' );
	const numericalError = bundle.fixtureMetadata.geometricNormalVelocityErrorInputs.numericalProjectionErrorBound;
	const velocityGain = vectorL1Norm( sample.freeSurfaceNormal.value );
	const normalGain = vectorL1Norm( sample.surfacePointVelocityMps.value );
	const bilinearError = 3 * surfaceVelocityError * normalError;
	const contributionByInputId = new Map( ledger.operatorOrGainBounds.map( ( contribution ) => [ contribution.inputErrorId, contribution ] ) );
	const velocityContribution = contributionByInputId.get( descriptor.perChannelError.surfacePointVelocityMps.errorId );
	const normalContribution = contributionByInputId.get( descriptor.perChannelError.freeSurfaceNormal.errorId );
	assert.ok( velocityContribution && normalContribution && contributionByInputId.size === 2, 'water error ledger must contain exactly the two projection gain contributions' );
	assertNear( quantityValue( velocityContribution.gain, 'water velocity-error gain' ), velocityGain, 1e-15, 'water velocity-error gain is not ||normal||_1' );
	assertNear( quantityValue( velocityContribution.outputContribution, 'water velocity-error contribution' ), velocityGain * surfaceVelocityError, 1e-15, 'water velocity-error contribution does not equal gain times input bound' );
	assertNear( quantityValue( normalContribution.gain, 'water normal-error gain' ), normalGain, 1e-15, 'water normal-error gain is not ||velocity||_1' );
	assertNear( quantityValue( normalContribution.outputContribution, 'water normal-error contribution' ), normalGain * normalError, 1e-15, 'water normal-error contribution does not equal gain times input bound' );
	assert.equal( ledger.modeledApproximationTerms.length, 1, 'water error ledger must contain exactly one bilinear cross term' );
	assertNear( quantityValue( ledger.modeledApproximationTerms[ 0 ].bound, 'water bilinear projection term' ), bilinearError, 1e-15, 'water bilinear projection term does not close' );
	assert.equal( ledger.numericalTerms.length, 1, 'water error ledger must contain exactly one numerical projection term' );
	assertNear( quantityValue( ledger.numericalTerms[ 0 ].bound, 'water numerical projection term' ), numericalError, 1e-15, 'water numerical projection term drifted' );
	const computedBound = velocityGain * surfaceVelocityError + normalGain * normalError + bilinearError + numericalError;
	const publishedBound = quantityValue( ledger.outputError.boundOrStatistic, 'geometricNormalVelocityMps output error' );
	assertNear( publishedBound, computedBound, 1e-15, 'water error ledger output bound is not computed from its inputs' );
	assert.equal( ledger.outputError.combinationRule, 'triangle', 'water error descriptor must preserve adversarial triangle combination' );
	assert.equal( ledger.combinationRule, 'linf-dot-v2: ||n||_1 e_velocity_Linf + ||v||_1 e_normal_Linf + 3 e_velocity_Linf e_normal_Linf + e_numerical', 'water error ledger combination rule drifted' );
	const maximumError = quantityValue( ledger.acceptanceGate.maximumError, 'water error ledger acceptance maximum' );
	assert.equal( ledger.acceptanceGate.passed, publishedBound <= maximumError, 'water error ledger acceptance result does not follow its bound' );
	assert.ok( ledger.acceptanceGate.passed, 'positive water error ledger exceeds its consumer tolerance' );
	assert.deepEqual( route.physicsErrorPropagationLedgers[ response.errorPropagationLedgerRef ], ledger, 'water response error ledger is unresolved or differs in the route inventory' );

}

export function validateProviderWaterBundle( helpers, bundle, route ) {

	const h = helperSet( helpers );
	assert.ok( bundle && typeof bundle === 'object', 'provider/water bundle must be a mapping' );
	validateEnvironmentForcing( h, bundle, route );
	validatePrecipitationEmission( h, bundle, route );
	validatePrecipitationGraphLineage( h, bundle, route );
	validateWaterSurface( h, bundle, route );
	validateImplicitWaterSurface( h, bundle, route );
	validateResponseAndErrorLedger( h, bundle, route );
	return bundle;

}

function mutateBundle( helpers, bundle, mutate ) {

	const clone = requireHelper( helpers, 'clone' );
	const copy = clone( bundle );
	mutate( copy );
	return copy;

}

export function implicitZeroForAbsentWaterPressure( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => {

		const sample = copy.implicitWaterSurfaceSample;
		const descriptor = sample.descriptor;
		const template = sample.materialCurrentVelocityMps;
		sample.surfacePointVelocityMps = {
			...template,
			channelId: 'surfacePointVelocityMps',
			value: [ 0, 0, 0 ],
			unit: descriptor.channels.surfacePointVelocityMps.unit,
			actualSupport: structuredClone( descriptor.channels.surfacePointVelocityMps.declaredSupport ),
			actualFilter: structuredClone( descriptor.channels.surfacePointVelocityMps.declaredFilter ),
			error: structuredClone( descriptor.perChannelError.surfacePointVelocityMps )
		};
		sample.absentChannels = sample.absentChannels.filter( ( channelId ) => channelId !== 'surfacePointVelocityMps' );

	} );

}

export function missingDescriptorChannelError( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { delete copy.waterSurfaceSample.descriptor.perChannelError.pressurePa; } );

}

export function staleResponseResourceGeneration( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSampleResponseEnvelope.resourceGeneration.generation = 'stale-water-resource-generation'; } );

}

export function mismatchedWaterChannelTime( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.freeSurfaceNormal.actualPhysicsTime.instant.tick += 1; } );

}

export function mismatchedWaterChannelSupport( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.freeSurfaceNormal.actualSupport.supportId = 'unrelated-support'; } );

}

export function mismatchedWaterChannelFilter( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.freeSurfaceNormal.actualFilter.filterId = 'unrelated-filter'; } );

}

export function mismatchedWaterChannelUnit( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.geometricNormalVelocityMps.unit = 'metre'; } );

}

export function mismatchedWaterChannelStateVersion( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.geometricNormalVelocityMps.stateVersion = 'stale-water-state'; } );

}

export function mismatchedWaterParameterizationRevision( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.surfaceParameterization.parameterizationRevision = 'stale-parameterization-revision'; } );

}

export function duplicateEnvironmentPrecipitationAuthority( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => {

		const snapshot = copy.environmentForcingSnapshot;
		for ( const [ channelId, value ] of [ [ 'precipitationMassFluxKgPerM2S', 0.2 ], [ 'precipitationPhase', { liquidMassFraction: 0.75, iceMassFraction: 0.25 } ], [ 'precipitationVelocityMps', [ 0, - 7, 0 ] ] ] ) {

			const template = snapshot.temperatureK;
			snapshot[ channelId ] = {
				...template,
				channelId,
				value,
				unit: snapshot.descriptor.channels[ channelId ].unit,
				actualSupport: structuredClone( snapshot.descriptor.channels[ channelId ].declaredSupport ),
				actualFilter: structuredClone( snapshot.descriptor.channels[ channelId ].declaredFilter ),
				error: structuredClone( snapshot.descriptor.perChannelError[ channelId ] )
			};

		}
		snapshot.absentChannels = snapshot.absentChannels.filter( ( channelId ) => ! [ 'precipitationMassFluxKgPerM2S', 'precipitationPhase', 'precipitationVelocityMps' ].includes( channelId ) );

	} );

}

export function mismatchedEnvironmentDescriptorUnit( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.environmentForcingSnapshot.descriptor.channels.temperatureK.unit = 'degree-celsius'; } );

}

export function mismatchedPrecipitationDescriptorUnit( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.precipitationEmissionSnapshot.descriptor.channels.emittedMassFluxKgPerM2S.unit = 'kilogram-per-second'; } );

}

export function mismatchedWaterDescriptorUnit( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.descriptor.channels.pressurePa.unit = 'kilopascal'; } );

}

export function omittedWaterProjectionBilinearBound( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => {

		const ledger = Object.values( copy.errorPropagationLedgersById )[ 0 ];
		const omitted = ledger.modeledApproximationTerms[ 0 ].bound.value;
		ledger.modeledApproximationTerms = [];
		ledger.outputError.boundOrStatistic.value -= omitted;
		copy.waterSurfaceSample.descriptor.perChannelError.geometricNormalVelocityMps.boundOrStatistic.value -= omitted;
		copy.waterSurfaceSample.geometricNormalVelocityMps.error.boundOrStatistic.value -= omitted;
		copy.waterSampleResponseEnvelope.channels.geometricNormalVelocityMps.error.boundOrStatistic.value -= omitted;

	} );

}

export function waterProjectionAcceptanceBoundBelowPublishedError( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => {

		const ledger = Object.values( copy.errorPropagationLedgersById )[ 0 ];
		ledger.acceptanceGate.maximumError.value = ledger.outputError.boundOrStatistic.value / 2;

	} );

}

export function stalePressureDatumReferenceInstant( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterPressureSemantics.datum.referenceInstant.tick += 1; } );

}

export function stalePressureSemanticsEnvelopeReference( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSampleResponseEnvelope.provenance.pressureSemanticsRef = 'stale-pressure-semantics'; } );

}

export function mismatchedEquationEvaluationLocation( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.descriptor.channels.materialCurrentVelocityMps.declaredSupport.geometry.evaluationLocationId = copy.waterEvaluationLocations.columnAtQuery.evaluationLocationId; } );

}

export function staleChartRegistryBinding( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.parameterizationBindings[ copy.waterSurfaceSample.surfaceParameterization.parameterizationId ].chartRegistryRevision = 'stale-chart-registry'; } );

}

export function missingGraphDependencyTemplate( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.precipitationGraphLineage.graph.dependencies = copy.precipitationGraphLineage.graph.dependencies.filter( ( dependency ) => dependency.dependencyId !== copy.precipitationTransportProof.graphDependencyId ); } );

}

export function staleGraphDependencyCompletionPayload( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.precipitationGraphLineage.graph.executionLedger.dependencyCompletions.find( ( completion ) => completion.dependencyId === copy.precipitationTransportProof.graphDependencyId ).payloadAndVersion.stateVersion = 'stale-emission-state'; } );

}

export function stalePrecipitationCandidateCommitDigest( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.precipitationGraphLineage.candidate.commitProvenance.closedPublicationSetDigest = 'sha256:stale-publication-set'; } );

}

export function missingPrecipitationCostStage( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.precipitationGraphLineage.costLedger.graphStageCosts.pop(); } );

}

export function structuralMissingWaterParameterizationMap( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { delete copy.waterSurfaceSample.surfaceParameterization.coordinateMap; } );

}

export function structuralMissingPrecipitationEmissionInterval( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { delete copy.precipitationEmissionSnapshot.emissionInterval; } );

}

export function structuralMissingResponseDescriptorRef( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { delete copy.waterSampleResponseEnvelope.descriptorRef; } );

}

export function nonclosingPrecipitationPhaseFractions( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.precipitationEmissionSnapshot.phase.value.iceMassFraction = 0.4; } );

}

export function nonclosingPrecipitationMassInventory( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.precipitationEmissionSnapshot.airborneInventory.value.totalMassKg.value += 0.1; } );

}

export function nonclosingPrecipitationTransportLedger( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.precipitationMassClosure.inventoryAtNPlusOneEndKg.value += 0.1; } );

}

export function mismatchedWaterNormalProjection( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.geometricNormalVelocityMps.value += 0.2; } );

}

export function aliasedWaterSurfaceAndMaterialVelocity( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.materialCurrentVelocityMps.value = copy.waterSurfaceSample.surfacePointVelocityMps.value.slice(); } );

}

export function unresolvedWaterErrorLedgerReference( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSampleResponseEnvelope.errorPropagationLedgerRef = 'missing-error-ledger'; } );

}

export function underestimatedWaterProjectionError( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => {

		const ledger = Object.values( copy.errorPropagationLedgersById )[ 0 ];
		ledger.outputError.boundOrStatistic.value = 0;

	} );

}

export function mismatchedWaterAbsenceInventory( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.absentChannels = copy.waterSurfaceSample.absentChannels.filter( ( id ) => id !== 'materialAccelerationMps2' ); } );

}

export function malformedWaterTypedAbsence( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.materialAccelerationMps2.schemaId = 'typed-absence-v0'; } );

}

export function unregisteredWaterChartReference( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.surfaceParameterization.chartId = 'unregistered-water-chart'; } );

}

export function overlappingWaterRequestChannelMasks( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSampleRequest.optionalChannels.push( copy.waterSampleRequest.requiredChannels[ 0 ] ); } );

}

export function staleWaterRequestProviderIdentity( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSampleRequest.providerId = 'stale-water-provider'; } );

}

export function insufficientWaterRequestTolerance( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => {

		const tolerance = copy.waterSampleRequest.tolerancesByChannel.find( ( entry ) => entry.channelId === 'freeSurfacePoint' );
		tolerance.maximumError.value = 0;

	} );

}

export function driftedWaterRequestExactOnceKey( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSampleRequest.exactOnceKey = 'unmatched-water-request-sequence'; } );

}

export function mutatedLatchedForcingAfterEmission( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.environmentForcingSnapshot.temperatureK.value += 1; } );

}

export function nonadjacentPrecipitationTransportIntervals( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.precipitationTransportProof.consumerInterval.start.tick += 1; } );

}

export function implicitWaterMissingGeometricNormalSpeed( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.implicitWaterSurfaceSample.geometricNormalVelocityMps = copy.implicitWaterSurfaceSample.surfacePointVelocityMps; } );

}

export function dryWaterPublishesPositiveDepth( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { copy.waterSurfaceSample.wetDryState.value = 'dry'; } );

}

export function gaugeWaterPressureWithoutDatum( helpers, bundle ) {

	return mutateBundle( helpers, bundle, ( copy ) => { delete copy.waterPressureSemantics.datum; } );

}

export const providerWaterRejectMutations = Object.freeze( {
	implicitZeroForAbsentWaterPressure,
	missingDescriptorChannelError,
	staleResponseResourceGeneration,
	mismatchedWaterChannelTime,
	mismatchedWaterChannelSupport,
	mismatchedWaterChannelFilter,
	mismatchedWaterChannelUnit,
	mismatchedWaterChannelStateVersion,
	mismatchedWaterParameterizationRevision,
	duplicateEnvironmentPrecipitationAuthority,
	mismatchedEnvironmentDescriptorUnit,
	mismatchedPrecipitationDescriptorUnit,
	mismatchedWaterDescriptorUnit,
	omittedWaterProjectionBilinearBound,
	waterProjectionAcceptanceBoundBelowPublishedError,
	stalePressureDatumReferenceInstant,
	stalePressureSemanticsEnvelopeReference,
	mismatchedEquationEvaluationLocation,
	staleChartRegistryBinding,
	missingGraphDependencyTemplate,
	staleGraphDependencyCompletionPayload,
	stalePrecipitationCandidateCommitDigest,
	missingPrecipitationCostStage,
	structuralMissingWaterParameterizationMap,
	structuralMissingPrecipitationEmissionInterval,
	structuralMissingResponseDescriptorRef,
	nonclosingPrecipitationPhaseFractions,
	nonclosingPrecipitationMassInventory,
	nonclosingPrecipitationTransportLedger,
	mismatchedWaterNormalProjection,
	aliasedWaterSurfaceAndMaterialVelocity,
	unresolvedWaterErrorLedgerReference,
	underestimatedWaterProjectionError,
	mismatchedWaterAbsenceInventory,
	malformedWaterTypedAbsence,
	unregisteredWaterChartReference,
	overlappingWaterRequestChannelMasks,
	staleWaterRequestProviderIdentity,
	insufficientWaterRequestTolerance,
	driftedWaterRequestExactOnceKey,
	mutatedLatchedForcingAfterEmission,
	nonadjacentPrecipitationTransportIntervals,
	implicitWaterMissingGeometricNormalSpeed,
	dryWaterPublishesPositiveDepth,
	gaugeWaterPressureWithoutDatum
} );

export {
	validateEnvironmentForcing,
	validateImplicitWaterSurface,
	validatePrecipitationEmission,
	validatePrecipitationGraphLineage,
	validateResponseAndErrorLedger,
	validateWaterSampleRequest,
	validateWaterSurface
};
