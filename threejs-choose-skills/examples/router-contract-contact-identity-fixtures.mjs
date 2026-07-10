import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const MATERIAL_LAW_KEYS = [
	'contactLaw',
	'frictionLaw',
	'restitutionLaw',
	'complianceDampingLaw',
	'adhesionCohesionLaw',
	'permeabilityPorosityLaw',
	'wettingContactAngleLaw',
	'dragRoughnessLaw',
	'phaseChangeLaw'
];

const GENERATION_ID_KEYS = [ 'namespaceKind', 'namespaceId', 'stableId', 'generation' ];
const LAW_KEYS = [ 'lawId', 'lawVersion', 'model', 'parameterSchemaVersion', 'parameters', 'validityRegime', 'provenanceDigest' ];

function clone( value ) {

	return structuredClone( value );

}

function canonicalize( value ) {

	if ( Array.isArray( value ) ) return value.map( canonicalize );
	if ( value !== null && typeof value === 'object' ) return Object.fromEntries(
		Object.keys( value ).sort().map( ( key ) => [ key, canonicalize( value[ key ] ) ] )
	);
	return value;

}

function digest( value ) {

	return `sha256:${ createHash( 'sha256' ).update( JSON.stringify( canonicalize( value ) ) ).digest( 'hex' ) }`;

}

function exactKeys( value, keys, label ) {

	assert.ok( value !== null && typeof value === 'object' && ! Array.isArray( value ), `${ label } must be a mapping` );
	assert.deepEqual( Object.keys( value ).sort(), [ ...keys ].sort(), `${ label } has non-canonical fields` );

}

function nonempty( value, label ) {

	assert.equal( typeof value, 'string', `${ label } must be a string` );
	assert.notEqual( value.trim(), '', `${ label } must be non-empty` );

}

function isAbsence( value ) {

	return value !== null && typeof value === 'object' && ! Array.isArray( value ) && value.kind === 'absent';

}

function idKey( identity ) {

	return `${ identity.namespaceKind }|${ identity.namespaceId }|${ identity.stableId }|g${ identity.generation }`;

}

function sameIdentity( left, right ) {

	return JSON.stringify( canonicalize( left ) ) === JSON.stringify( canonicalize( right ) );

}

function quantityValue( quantity, expectedUnit, label ) {

	exactKeys( quantity, [ 'value', 'unit', 'label', 'source' ], label );
	assert.equal( quantity.unit, expectedUnit, `${ label } has the wrong unit` );
	assert.equal( typeof quantity.value, 'number', `${ label }.value must be numeric` );
	assert.ok( Number.isFinite( quantity.value ), `${ label }.value must be finite` );
	return quantity.value;

}

function vector( value, length, label ) {

	assert.ok( Array.isArray( value ) && value.length === length, `${ label } must contain ${ length } components` );
	for ( const component of value ) assert.ok( typeof component === 'number' && Number.isFinite( component ), `${ label } has a non-finite component` );
	return value;

}

function dot( left, right ) {

	return left.reduce( ( sum, value, index ) => sum + value * right[ index ], 0 );

}

function cross( left, right ) {

	return [
		left[ 1 ] * right[ 2 ] - left[ 2 ] * right[ 1 ],
		left[ 2 ] * right[ 0 ] - left[ 0 ] * right[ 2 ],
		left[ 0 ] * right[ 1 ] - left[ 1 ] * right[ 0 ]
	];

}

function add( left, right ) {

	return left.map( ( value, index ) => value + right[ index ] );

}

function subtract( left, right ) {

	return left.map( ( value, index ) => value - right[ index ] );

}

function mat3MultiplyVector( matrix, value ) {

	return [
		matrix[ 0 ] * value[ 0 ] + matrix[ 1 ] * value[ 1 ] + matrix[ 2 ] * value[ 2 ],
		matrix[ 3 ] * value[ 0 ] + matrix[ 4 ] * value[ 1 ] + matrix[ 5 ] * value[ 2 ],
		matrix[ 6 ] * value[ 0 ] + matrix[ 7 ] * value[ 1 ] + matrix[ 8 ] * value[ 2 ]
	];

}

function quaternionToMat3( quaternion ) {

	const [ x, y, z, w ] = quaternion;
	return [
		1 - 2 * ( y * y + z * z ), 2 * ( x * y - z * w ), 2 * ( x * z + y * w ),
		2 * ( x * y + z * w ), 1 - 2 * ( x * x + z * z ), 2 * ( y * z - x * w ),
		2 * ( x * z - y * w ), 2 * ( y * z + x * w ), 1 - 2 * ( x * x + y * y )
	];

}

function intervalIdentity( interval ) {

	const instant = ( value ) => `${ value.clockId }:${ value.tick }+${ value.rationalSubstep.numerator }/${ value.rationalSubstep.denominator }@${ value.clockMappingRevision }#${ value.discontinuityEpoch }`;
	return `[${ instant( interval.start ) },${ instant( interval.endExclusive ) })`;

}

function norm( value ) {

	return Math.sqrt( dot( value, value ) );

}

function assertNear( actual, expected, tolerance, label ) {

	assert.ok( Math.abs( actual - expected ) <= tolerance, `${ label }: expected ${ expected }, received ${ actual }` );

}

function determinant3( matrix ) {

	return matrix[ 0 ] * ( matrix[ 4 ] * matrix[ 8 ] - matrix[ 5 ] * matrix[ 7 ] )
		- matrix[ 1 ] * ( matrix[ 3 ] * matrix[ 8 ] - matrix[ 5 ] * matrix[ 6 ] )
		+ matrix[ 2 ] * ( matrix[ 3 ] * matrix[ 7 ] - matrix[ 4 ] * matrix[ 6 ] );

}

function symmetricEigenvalues3( matrix ) {

	const a = [
		[ matrix[ 0 ], matrix[ 1 ], matrix[ 2 ] ],
		[ matrix[ 3 ], matrix[ 4 ], matrix[ 5 ] ],
		[ matrix[ 6 ], matrix[ 7 ], matrix[ 8 ] ]
	];
	for ( let sweep = 0; sweep < 24; sweep ++ ) {

		let p = 0;
		let q = 1;
		for ( const [ i, j ] of [ [ 0, 1 ], [ 0, 2 ], [ 1, 2 ] ] ) if ( Math.abs( a[ i ][ j ] ) > Math.abs( a[ p ][ q ] ) ) [ p, q ] = [ i, j ];
		if ( Math.abs( a[ p ][ q ] ) < 1e-14 ) break;
		const angle = 0.5 * Math.atan2( 2 * a[ p ][ q ], a[ q ][ q ] - a[ p ][ p ] );
		const c = Math.cos( angle );
		const s = Math.sin( angle );
		const app = c * c * a[ p ][ p ] - 2 * s * c * a[ p ][ q ] + s * s * a[ q ][ q ];
		const aqq = s * s * a[ p ][ p ] + 2 * s * c * a[ p ][ q ] + c * c * a[ q ][ q ];
		for ( let k = 0; k < 3; k ++ ) if ( k !== p && k !== q ) {

			const akp = c * a[ k ][ p ] - s * a[ k ][ q ];
			const akq = s * a[ k ][ p ] + c * a[ k ][ q ];
			a[ k ][ p ] = a[ p ][ k ] = akp;
			a[ k ][ q ] = a[ q ][ k ] = akq;

		}
		a[ p ][ p ] = app;
		a[ q ][ q ] = aqq;
		a[ p ][ q ] = a[ q ][ p ] = 0;

	}
	return [ a[ 0 ][ 0 ], a[ 1 ][ 1 ], a[ 2 ][ 2 ] ].sort( ( left, right ) => left - right );

}

function generationIdentity( registry, namespaceKind, stableId, generation ) {

	return {
		namespaceKind,
		namespaceId: registry.namespacesByKind[ namespaceKind ].namespaceId,
		stableId,
		generation
	};

}

function validateGenerationIdentity( identity, namespaceKind, registry, label ) {

	exactKeys( identity, GENERATION_ID_KEYS, label );
	assert.equal( identity.namespaceKind, namespaceKind, `${ label } belongs to the wrong namespace kind` );
	assert.equal( identity.namespaceId, registry.namespacesByKind[ namespaceKind ].namespaceId, `${ label } does not resolve in the active identity registry` );
	nonempty( identity.stableId, `${ label }.stableId` );
	assert.doesNotMatch( identity.stableId, /(?:^|[-_:])(slot|draw-index|gpu-index)(?:$|[-_:])/i, `${ label } encodes a transient slot` );
	assert.ok( Number.isInteger( identity.generation ) && identity.generation >= 0, `${ label }.generation must be a nonnegative integer` );
	assert.ok( identity.generation < registry.namespacesByKind[ namespaceKind ].allocationCursor, `${ label }.generation exceeds the namespace allocation cursor` );

}

function validateInteractionId( interactionId, registry, label ) {

	nonempty( interactionId, label );
	assert.ok( interactionId.startsWith( `${ registry.namespacesByKind.interaction.namespaceId }/` ), `${ label } does not resolve in the interaction namespace` );
	assert.doesNotMatch( interactionId, /(?:^|[-_:])(slot|draw-index|gpu-index)(?:$|[-_:])/i, `${ label } encodes a transient slot` );

}

function versionedLaw( lawId, lawVersion, model, parameters ) {

	const value = {
		lawId,
		lawVersion,
		model,
		parameterSchemaVersion: `${ lawId }/parameters-v1`,
		parameters,
		validityRegime: `${ model } calibrated regime v1`,
		provenanceDigest: `sha256:${ lawId }-${ lawVersion}`
	};
	return value;

}

function validateVersionedLaw( value, label ) {

	assert.ok( ! isAbsence( value ), `${ label } is absent` );
	exactKeys( value, LAW_KEYS, label );
	for ( const key of [ 'lawId', 'lawVersion', 'model', 'parameterSchemaVersion', 'validityRegime', 'provenanceDigest' ] ) nonempty( value[ key ], `${ label }.${ key}` );
	assert.match( value.lawVersion, /(?:^|[-@/])v(?:ersion-)?\d+(?:$|[-@/.])/i, `${ label }.lawVersion is not explicitly versioned` );
	assert.ok( value.parameters !== null && typeof value.parameters === 'object' && ! Array.isArray( value.parameters ), `${ label }.parameters must be a mapping` );
	assert.match( value.provenanceDigest, /^sha256:/, `${ label }.provenanceDigest is not a collision-resistant digest` );

}

function helperInterface( h, needsSchema = false ) {

	assert.ok( h !== null && typeof h === 'object', 'contact/identity fixtures require helper object h' );
	for ( const key of [ 'typedAbsence', 'evidence', 'fixtureError' ] ) assert.equal( typeof h[ key ], 'function', `helper h.${ key } is required` );
	if ( needsSchema ) assert.equal( typeof h.requireAbiRecord, 'function', 'helper h.requireAbiRecord is required for executable schema validation' );
	return h;

}

function makeSignalDescriptor( h, route, fields ) {

	const descriptor = clone( route.physicsSignals.bodyState );
	const baseChannel = clone( Object.values( descriptor.channels )[ 0 ] );
	const channel = ( definition ) => ( {
		...clone( baseChannel ),
		channelId: definition.channelId,
		valueType: definition.valueType,
		tensorRankAndShape: definition.tensorRankAndShape,
		unit: definition.unit,
		basisBehavior: definition.basisBehavior,
		quantityClass: definition.quantityClass,
		samplingMeasure: definition.samplingMeasure,
		declaredSupport: clone( descriptor.representedFootprint ),
		declaredFilter: clone( descriptor.filter ),
		errorRef: `${ fields.signalId }/error/${ definition.channelId}`
	} );
	descriptor.signalId = fields.signalId;
	descriptor.providerId = fields.providerId;
	descriptor.schemaId = fields.schemaId;
	descriptor.contextId = route.physicsContext.contextId;
	descriptor.owner = fields.owner;
	descriptor.consumers = [ ...fields.consumers ];
	descriptor.channels = Object.fromEntries( fields.channels.map( ( definition ) => [ definition.channelId, channel( definition ) ] ) );
	descriptor.physicsFrameId = route.physicsContext.physicsRootFrameId;
	descriptor.physicsOriginEpoch = route.physicsContext.physicsOriginEpoch;
	descriptor.transformRevision = route.physicsContext.physicsFrameRegistry.framesById[ route.physicsContext.physicsRootFrameId ].transformRevision;
	descriptor.clockId = fields.interval.clockId;
	descriptor.samplePhase = fields.samplePhase ?? 'interval-start';
	descriptor.representedFootprint.supportId = `${ fields.signalId }/support`;
	descriptor.representedFootprint.physicsFrameId = descriptor.physicsFrameId;
	descriptor.representedFootprint.physicsOriginEpoch = descriptor.physicsOriginEpoch;
	descriptor.representedFootprint.transformRevision = descriptor.transformRevision;
	descriptor.filter.filterId = `${ fields.signalId }/filter`;
	descriptor.filter.supportMeasure = descriptor.representedFootprint.kind;
	descriptor.validity.validTime = { kind: 'interval', instant: h.typedAbsence( 'not-applicable', fields.owner ), interval: clone( fields.interval ) };
	descriptor.cadence.kind = 'fixed';
	descriptor.cadence.clockId = descriptor.clockId;
	descriptor.cadence.samplePhase = descriptor.samplePhase;
	descriptor.latency.clockMappingRevision = fields.interval.intervalMappingRevision;
	descriptor.latency.maximumStaleness = clone( descriptor.validity.staleAfter );
	descriptor.perChannelError = Object.fromEntries( fields.channels.map( ( definition ) => {

		const error = h.fixtureError( definition.unit, definition.errorBound, `${ fields.signalId }-${ definition.channelId}` );
		error.errorId = `${ fields.signalId }/error/${ definition.channelId }`;
		error.quantityOrChannelId = definition.channelId;
		error.validity = clone( descriptor.validity );
		return [ definition.channelId, error ];

	} ) );
	descriptor.channels = Object.fromEntries( fields.channels.map( ( definition ) => [ definition.channelId, {
		...clone( baseChannel ),
		channelId: definition.channelId,
		valueType: definition.valueType,
		tensorRankAndShape: definition.tensorRankAndShape,
		unit: definition.unit,
		basisBehavior: definition.basisBehavior,
		quantityClass: definition.quantityClass,
		samplingMeasure: definition.samplingMeasure,
		declaredSupport: clone( descriptor.representedFootprint ),
		declaredFilter: clone( descriptor.filter ),
		validity: clone( descriptor.validity ),
		errorRef: descriptor.perChannelError[ definition.channelId ].errorId
	} ] ) );
	descriptor.stateVersion = fields.stateVersion;
	descriptor.resourceGeneration = { kind: 'present', generation: `${ fields.signalId }/resource-g${ fields.resourceGeneration}` };
	return descriptor;

}

function sampledChannel( h, descriptor, interval, stateVersion, fields ) {

	return {
		channelId: fields.channelId,
		value: clone( fields.value ),
		unit: fields.unit,
		actualPhysicsTime: { kind: 'instant', instant: clone( interval.start ), interval: h.typedAbsence( 'not-applicable', descriptor.owner ) },
		actualSupport: clone( descriptor.representedFootprint ),
		actualFilter: clone( descriptor.filter ),
		validity: 'valid',
		error: clone( descriptor.perChannelError[ fields.channelId ] ),
		stateVersion
	};

}

function signalDescriptorRef( descriptor ) {

	return { signalId: descriptor.signalId, descriptorStateVersion: descriptor.stateVersion, schemaId: descriptor.schemaId, contextId: descriptor.contextId };

}

function materialState( h, route, fields ) {

	const channelDefinitions = fields.channels.map( ( channel ) => ( {
		channelId: channel.channelId,
		valueType: channel.valueType,
		tensorRankAndShape: channel.tensorRankAndShape,
		unit: channel.unit,
		basisBehavior: channel.basisBehavior,
		quantityClass: channel.quantityClass,
		samplingMeasure: 'point',
		errorBound: channel.errorBound
	} ) );
	const descriptor = makeSignalDescriptor( h, route, {
		signalId: fields.signalId,
		providerId: 'provider-namespace-v1/physics-material-state-owner@g2',
		schemaId: 'physics/material-state/v1',
		owner: 'physics-material-state-owner',
		consumers: [ 'contact-solver-owner', '$threejs-water-optics', 'route-physics-coordinator' ],
		stateVersion: fields.stateVersion,
		resourceGeneration: fields.resourceGeneration,
		interval: fields.interval,
		channels: channelDefinitions
	} );
	const samples = Object.fromEntries( fields.channels.map( ( channel ) => [ channel.channelId, sampledChannel( h, descriptor, fields.interval, fields.stateVersion, channel ) ] ) );
	const absent = ( reason = 'not-requested' ) => h.typedAbsence( reason, descriptor.owner );
	return {
		descriptor,
		materialStateId: fields.materialStateId,
		physicsMaterialId: clone( fields.physicsMaterialId ),
		owner: descriptor.owner,
		stateVersion: fields.stateVersion,
		sampleInstant: clone( fields.interval.start ),
		validityInterval: clone( fields.interval ),
		physicsFrameId: descriptor.physicsFrameId,
		physicsOriginEpoch: descriptor.physicsOriginEpoch,
		transformRevision: descriptor.transformRevision,
		temperatureK: samples.temperatureK ?? absent(),
		liquidSaturation: samples.liquidSaturation ?? absent(),
		iceMassFraction: samples.iceMassFraction ?? absent(),
		phaseMassFractions: samples.phaseMassFractions ?? absent(),
		damageOrCompactionState: samples.damageOrCompactionState ?? absent(),
		constitutiveInputs: clone( fields.constitutiveInputs ),
		validity: clone( descriptor.validity ),
		error: Object.fromEntries( Object.entries( descriptor.perChannelError ).map( ( [ channelId, error ] ) => [ channelId, clone( error ) ] ) )
	};

}

function materialRecord( h, id, recordVersion, density, laws, provenanceId ) {

	return {
		physicsMaterialId: clone( id ),
		recordVersion,
		densityKgPerM3: h.evidence( density, 'kilogram-per-cubic-metre', 'Measured', `${ provenanceId }-density` ),
		contactLaw: laws.contactLaw ?? h.typedAbsence( 'unsupported', 'physics-material-owner' ),
		frictionLaw: laws.frictionLaw ?? h.typedAbsence( 'unsupported', 'physics-material-owner' ),
		restitutionLaw: laws.restitutionLaw ?? h.typedAbsence( 'unsupported', 'physics-material-owner' ),
		complianceDampingLaw: laws.complianceDampingLaw ?? h.typedAbsence( 'unsupported', 'physics-material-owner' ),
		adhesionCohesionLaw: laws.adhesionCohesionLaw ?? h.typedAbsence( 'unsupported', 'physics-material-owner' ),
		permeabilityPorosityLaw: laws.permeabilityPorosityLaw ?? h.typedAbsence( 'unsupported', 'physics-material-owner' ),
		wettingContactAngleLaw: laws.wettingContactAngleLaw ?? h.typedAbsence( 'unsupported', 'physics-material-owner' ),
		dragRoughnessLaw: laws.dragRoughnessLaw ?? h.typedAbsence( 'unsupported', 'physics-material-owner' ),
		thermalConductivityWPerMK: h.typedAbsence( 'unsupported', 'physics-material-owner' ),
		specificHeatJPerKgK: h.typedAbsence( 'unsupported', 'physics-material-owner' ),
		emissivitySpectrum: h.typedAbsence( 'unsupported', 'physics-material-owner' ),
		phaseChangeLaw: laws.phaseChangeLaw ?? h.typedAbsence( 'unsupported', 'physics-material-owner' ),
		uncertainty: { errorModelRevision: `${ provenanceId }-uncertainty-v1`, correlation: 'bounded-correlated-by-property', propertyErrorRefs: [ `${ provenanceId }-density-error` ] },
		provenance: { sourceId: provenanceId, sourceRevision: `${ provenanceId }-source-v1`, contentDigest: `sha256:${ provenanceId}-source-v1` }
	};

}

function collisionFilter( id, layer, belongsToMask, collidesWithMask ) {

	return {
		filterId: id,
		filterVersion: `${ id }-v1`,
		layerId: layer,
		belongsToMask,
		collidesWithMask,
		explicitPairExclusions: [],
		explicitPairInclusions: [],
		role: 'solid',
		selfCollisionPolicy: 'disabled',
		resolverOrdering: 'exclusions-then-inclusions-then-masks'
	};

}

function colliderProxy( h, route, fields ) {

	const state = fields.state;
	return {
		colliderId: clone( fields.colliderId ),
		entityId: clone( fields.entityId ),
		shapeId: clone( fields.shapeId ),
		contextId: route.physicsContext.contextId,
		shapeFrameId: state.bodyFrameId,
		physicsFrameId: state.physicsFrameId,
		physicsOriginEpoch: state.physicsOriginEpoch,
		transformRevision: state.transformRevision,
		shapeRepresentation: fields.shapeRepresentation,
		shapeDefinitionRef: { definitionId: `${ fields.shapeName }-definition`, definitionVersion: `${ fields.shapeName }-definition-v3`, representation: fields.shapeRepresentation, resourceGeneration: `${ fields.shapeName }-geometry-g4`, contentDigest: `sha256:${ fields.shapeName }-geometry-g4` },
		topologyRevision: `${ fields.shapeName }-topology-v3`,
		poseSignalRef: { signalId: state.descriptor.signalId, descriptorStateVersion: state.descriptor.stateVersion, schemaId: state.descriptor.schemaId, contextId: state.descriptor.contextId },
		poseStateVersion: state.stateVersion,
		validityInterval: clone( state.validityInterval ),
		updateCadence: clone( state.descriptor.cadence ),
		sweptBounds: { boundsKind: 'oriented-box-swept-by-twist', sampleInstant: clone( state.sampleInstant ), interval: clone( state.validityInterval ), sourceSignalId: state.descriptor.signalId, sourceStateVersion: state.stateVersion, physicsFrameId: state.physicsFrameId, physicsOriginEpoch: state.physicsOriginEpoch, transformRevision: state.transformRevision, topologyRevision: `${ fields.shapeName }-topology-v3`, conservative: true, boundsRevision: `${ fields.shapeName }-swept-bounds-v2` },
		oneSidedness: 'two-sided',
		closedness: fields.closedness,
		collisionMode: 'continuous-with-named-sweep',
		featureIdPolicy: { policyId: `${ fields.shapeName }-features`, policyVersion: `${ fields.shapeName }-features-v2`, topologyRevision: `${ fields.shapeName }-topology-v3`, namespaceId: route.physicsContext.idNamespaces.namespacesByKind.feature.namespaceId, stability: 'stable-within-topology-revision', topologyChangePolicy: 'publish-remap-and-increment-generation' },
		conservativeInflationMeters: h.evidence( 0.002, 'metre', 'Gated', `${ fields.shapeName }-ccd-gate` ),
		physicsMaterialId: clone( fields.physicsMaterialId ),
		collisionGroups: collisionFilter( `${ fields.shapeName }-collision-filter`, fields.layer, fields.belongsToMask, fields.collidesWithMask ),
		approximationError: h.fixtureError( 'metre', 0.001, `${ fields.shapeName }-collider-approximation` ),
		residency: clone( state.descriptor.residency )
	};

}

function rigidBodyProperties( h, fields ) {

	return {
		entityId: clone( fields.entityId ),
		owner: fields.owner,
		massKg: h.evidence( fields.massKg, 'kilogram', 'Gated', `${ fields.name }-mass-properties-v1` ),
		centerOfMassBodyMeters: h.evidence( clone( fields.centerOfMassBodyMeters ), 'metre', 'Gated', `${ fields.name }-mass-properties-v1` ),
		inertiaTensorBodyKgM2: h.evidence( clone( fields.inertiaTensorBodyKgM2 ), 'kilogram-square-metre', 'Gated', `${ fields.name }-mass-properties-v1` ),
		bodyFrameId: fields.bodyFrameId,
		colliderIds: fields.colliderIds.map( clone ),
		physicsMaterialIds: fields.physicsMaterialIds.map( clone ),
		stateEquation: { equationId: `${ fields.name }-rigid-state-equation`, equationVersion: `${ fields.name }-rigid-state-equation-v4`, integrator: fields.motionMode === 'static' ? 'static-constraint' : 'symplectic-se3', constraintSetVersion: `${ fields.name }-constraints-v2` },
		forceTorqueApplicationOwner: fields.owner,
		error: { mass: h.fixtureError( 'kilogram', fields.massKg * 1e-6, `${ fields.name }-mass-error` ), inertia: h.fixtureError( 'kilogram-square-metre', Math.max( ...fields.inertiaTensorBodyKgM2 ) * 1e-5, `${ fields.name }-inertia-error` ) }
	};

}

function rigidBodyState( h, route, fields ) {

	const descriptor = makeSignalDescriptor( h, route, {
		signalId: fields.signalId,
		providerId: fields.providerId,
		schemaId: 'physics/rigid-body-state/v1',
		owner: fields.owner,
		consumers: [ 'contact-solver-owner', '$threejs-water-optics', 'route-physics-coordinator' ],
		stateVersion: fields.stateVersion,
		resourceGeneration: fields.resourceGeneration,
		interval: fields.interval,
		channels: [
			{ channelId: 'centerOfMassPositionMeters', valueType: 'Vec3', tensorRankAndShape: 'point', unit: 'metre', basisBehavior: 'structured', quantityClass: 'geometric', samplingMeasure: 'point', errorBound: 1e-5 },
			{ channelId: 'bodyToPhysicsRotation', valueType: 'Quaternion', tensorRankAndShape: 'quaternion', unit: 'unit-quaternion', basisBehavior: 'structured', quantityClass: 'geometric', samplingMeasure: 'point', errorBound: 1e-8 },
			{ channelId: 'angularVelocityRadPerS', valueType: 'Vec3', tensorRankAndShape: 'polar-vector', unit: 'radian-per-second', basisBehavior: 'axial-vector', quantityClass: 'intensive', samplingMeasure: 'point', errorBound: 1e-5 },
			{ channelId: 'linearVelocityMps', valueType: 'Vec3', tensorRankAndShape: 'polar-vector', unit: 'metre-per-second', basisBehavior: 'polar-vector', quantityClass: 'intensive', samplingMeasure: 'point', errorBound: 1e-5 }
		]
	} );
	const channel = ( channelId, value, unit, errorBound ) => sampledChannel( h, descriptor, fields.interval, fields.stateVersion, { channelId, value, unit, errorBound } );
	return {
		descriptor,
		entityId: clone( fields.entityId ),
		owner: fields.owner,
		stateVersion: fields.stateVersion,
		sampleInstant: clone( fields.interval.start ),
		validityInterval: clone( fields.interval ),
		physicsFrameId: descriptor.physicsFrameId,
		physicsOriginEpoch: descriptor.physicsOriginEpoch,
		transformRevision: descriptor.transformRevision,
		bodyFrameId: fields.bodyFrameId,
		centerOfMassPositionMeters: channel( 'centerOfMassPositionMeters', fields.positionMeters, 'metre', 1e-5 ),
		bodyToPhysicsRotation: channel( 'bodyToPhysicsRotation', fields.rotation, 'unit-quaternion', 1e-8 ),
		twist: {
			ordering: 'angular-then-linear-at-reference-point',
			angularVelocityRadPerS: channel( 'angularVelocityRadPerS', fields.angularVelocityRadPerS, 'radian-per-second', 1e-5 ),
			linearVelocityMps: channel( 'linearVelocityMps', fields.linearVelocityMps, 'metre-per-second', 1e-5 ),
			referencePoint: { kind: 'center-of-mass', pointMeters: clone( fields.positionMeters ), physicsFrameId: descriptor.physicsFrameId, physicsOriginEpoch: descriptor.physicsOriginEpoch, transformRevision: descriptor.transformRevision, sampleInstant: clone( fields.interval.start ) }
		},
		acceleration: h.typedAbsence( 'not-requested', fields.owner ),
		motionMode: fields.motionMode,
		committedDisposition: 'committed-publication',
		error: { pose: h.fixtureError( 'metre', 1e-5, `${ fields.signalId }-pose-error` ), twist: h.fixtureError( 'metre-per-second', 1e-5, `${ fields.signalId }-twist-error` ) }
	};

}

function materialPairSelection( h, fields ) {

	const selection = {
		selectionId: fields.selectionId,
		interactionId: clone( fields.interactionId ),
		applicationInterval: clone( fields.interval ),
		orderedPhysicsMaterialIds: [ clone( fields.materialA.physicsMaterialId ), clone( fields.materialB.physicsMaterialId ) ],
		orderedMaterialRecordVersions: [ fields.materialA.recordVersion, fields.materialB.recordVersion ],
		orderedMaterialStateIdsAndVersions: [
			{ materialStateId: fields.materialStateA.materialStateId, stateVersion: fields.materialStateA.stateVersion },
			{ materialStateId: fields.materialStateB.materialStateId, stateVersion: fields.materialStateB.stateVersion }
		],
		materialStateSampleInstants: [ clone( fields.materialStateA.sampleInstant ), clone( fields.materialStateB.sampleInstant ) ],
		contactFrameId: fields.contactFrameId,
		resolverId: fields.resolver.resolverId,
		resolverVersion: fields.resolver.resolverVersion,
		selectedLawRefsAndParameters: fields.selectedLaws.map( clone ),
		approximationErrors: [],
		selectionDigest: '',
		latching: 'immutable-for-application-interval'
	};
	const digestInput = clone( selection );
	delete digestInput.selectionDigest;
	selection.selectionDigest = digest( digestInput );
	return selection;

}

function contactDescriptor( h, route, interval, stateVersion ) {

	return makeSignalDescriptor( h, route, {
		signalId: 'signal-namespace-v1/contact-manifold-vessel-quay@g5',
		providerId: 'provider-namespace-v1/contact-solver@g3',
		schemaId: 'physics/contact-manifold/v1',
		owner: 'contact-solver-owner',
		consumers: [ 'route-physics-coordinator', '$threejs-procedural-motion-systems' ],
		stateVersion,
		resourceGeneration: 5,
		interval,
		channels: [
			{ channelId: 'signedSeparationMeters', valueType: 'scalar-per-point', tensorRankAndShape: 'point-scalar-array', unit: 'metre', basisBehavior: 'scalar', quantityClass: 'geometric', samplingMeasure: 'area', errorBound: 1e-5 },
			{ channelId: 'relativePointVelocityMps', valueType: 'Vec3-per-point', tensorRankAndShape: 'point-vector-array', unit: 'metre-per-second', basisBehavior: 'polar-vector', quantityClass: 'intensive', samplingMeasure: 'area', errorBound: 1e-4 }
		]
	} );

}

function pointVelocityDerivation( state, pointMeters, localDeformationVelocityMps = [ 0, 0, 0 ] ) {

	const referencePointMeters = state.twist.referencePoint.pointMeters;
	const leverArmMeters = subtract( pointMeters, referencePointMeters );
	const linearVelocityMps = state.twist.linearVelocityMps.value;
	const angularVelocityRadPerS = state.twist.angularVelocityRadPerS.value;
	const angularContributionMps = cross( angularVelocityRadPerS, leverArmMeters );
	const pointVelocityMps = add( add( linearVelocityMps, angularContributionMps ), localDeformationVelocityMps );
	return {
		stateVersion: state.stateVersion,
		bodyFrameId: state.bodyFrameId,
		sampleInstant: clone( state.sampleInstant ),
		physicsFrameId: state.physicsFrameId,
		physicsOriginEpoch: state.physicsOriginEpoch,
		transformRevision: state.transformRevision,
		referencePointKind: state.twist.referencePoint.kind,
		referencePointMeters: clone( referencePointMeters ),
		leverArmMeters,
		linearVelocityMps: clone( linearVelocityMps ),
		angularVelocityRadPerS: clone( angularVelocityRadPerS ),
		angularContributionMps,
		localDeformationVelocityMps: clone( localDeformationVelocityMps ),
		pointVelocityMps
	};

}

function makeContactManifold( h, route, fields ) {

	const stateVersion = 'contact-manifold-vessel-quay-v12';
	const descriptor = contactDescriptor( h, route, fields.interval, stateVersion );
	const pointIds = fields.points.map( ( point ) => point.persistentPointId );
	const relativePointVelocityMps = fields.points.map( ( point ) => {

		const bodyA = pointVelocityDerivation( fields.stateA, point.pointMeters, point.localDeformationVelocityAMps ?? [ 0, 0, 0 ] );
		const bodyB = pointVelocityDerivation( fields.stateB, point.pointMeters, point.localDeformationVelocityBMps ?? [ 0, 0, 0 ] );
		return {
			persistentPointId: clone( point.persistentPointId ),
			valueMps: subtract( bodyA.pointVelocityMps, bodyB.pointVelocityMps ),
			bodyA,
			bodyB,
			formula: 'vRel=(vA+omegaA-cross-rA+deformationA)-(vB+omegaB-cross-rB+deformationB)',
			sampleInstant: clone( fields.interval.start ),
			physicsFrameId: descriptor.physicsFrameId,
			physicsOriginEpoch: descriptor.physicsOriginEpoch,
			transformRevision: descriptor.transformRevision
		};

	} );
	return {
		descriptor,
		manifoldId: clone( fields.manifoldId ),
		contextId: route.physicsContext.contextId,
		owner: 'contact-solver-owner',
		solverIdAndRevision: 'deterministic-pgs-contact-solver-v6/laws-v4',
		lifecycle: 'persist',
		validityInterval: clone( fields.interval ),
		sampleInstant: clone( fields.interval.start ),
		physicsFrameId: route.physicsContext.physicsRootFrameId,
		physicsOriginEpoch: route.physicsContext.physicsOriginEpoch,
		transformRevision: descriptor.transformRevision,
		bodyA: { entityId: clone( fields.entityA ), colliderId: clone( fields.colliderA.colliderId ), shapeId: clone( fields.colliderA.shapeId ), featureIds: [ clone( fields.featureA ) ], stateVersion: fields.stateA.stateVersion },
		bodyB: { entityId: clone( fields.entityB ), colliderId: clone( fields.colliderB.colliderId ), shapeId: clone( fields.colliderB.shapeId ), featureIds: [ clone( fields.featureB ) ], stateVersion: fields.stateB.stateVersion },
		materialA: { physicsMaterialId: clone( fields.materialA.physicsMaterialId ), materialStateId: fields.materialStateA.materialStateId, materialStateVersion: fields.materialStateA.stateVersion, sampleInstant: clone( fields.interval.start ) },
		materialB: { physicsMaterialId: clone( fields.materialB.physicsMaterialId ), materialStateId: fields.materialStateB.materialStateId, materialStateVersion: fields.materialStateB.stateVersion, sampleInstant: clone( fields.interval.start ) },
		materialPairSelection: clone( fields.materialPairSelection ),
		normalConvention: 'A-to-B',
		manifoldPatch: {
			referencePointMeters: [ 2.05, 0.495, - 0.975 ],
			tangentBasis: { normal: [ 1, 0, 0 ], tangentU: [ 0, 0, 1 ], tangentV: [ 0, - 1, 0 ], handedness: 'right-handed', orthonormalityTolerance: h.evidence( 1e-9, 'ratio', 'Gated', 'contact-frame-gate' ) },
			patchAreaM2: h.evidence( 0.04, 'square-metre', 'Derived', 'contact-point-area-weights' ),
			points: fields.points.map( clone )
		},
		signedSeparationMeters: fields.points.map( ( point, index ) => ( { persistentPointId: clone( point.persistentPointId ), value: h.evidence( - 0.001 - index * 0.0001, 'metre', 'Measured', 'contact-narrowphase-v6' ), error: h.fixtureError( 'metre', 1e-5, 'contact-separation-error' ) } ) ),
		separationConvention: 'positive-separated-zero-touching-negative-penetrating',
		timeOfImpact: h.typedAbsence( 'not-applicable', 'contact-solver-owner' ),
		relativePointVelocityMps,
		constitutivePairLaw: { pairSelectionId: fields.materialPairSelection.selectionId, selectionDigest: fields.materialPairSelection.selectionDigest, selectedLawRefsAndParameters: clone( fields.materialPairSelection.selectedLawRefsAndParameters ) },
		frictionAdhesionState: { owner: 'contact-solver-owner', solverIdAndRevision: 'deterministic-pgs-contact-solver-v6/laws-v4', manifoldId: clone( fields.manifoldId ), stateVersion, persistentPointIds: pointIds.map( clone ), frictionStateRevision: 'contact-friction-state-v9' },
		warmStartImpulses: { owner: 'contact-solver-owner', solverIdAndRevision: 'deterministic-pgs-contact-solver-v6/laws-v4', manifoldId: clone( fields.manifoldId ), stateVersion, pointImpulses: fields.points.map( ( point ) => ( { persistentPointId: clone( point.persistentPointId ), normalImpulseNs: h.evidence( 1.2, 'newton-second', 'Measured', 'contact-solver-previous-committed-step' ), tangentImpulseNs: h.evidence( [ 0.1, - 0.02 ], 'newton-second', 'Measured', 'contact-solver-previous-committed-step' ) } ) ) },
		emittedInteractionIds: [ clone( fields.interactionId ) ],
		validity: clone( descriptor.validity ),
		error: { separation: h.fixtureError( 'metre', 1e-5, 'contact-manifold-separation' ), normal: h.fixtureError( 'radian', 1e-4, 'contact-manifold-normal' ), patchArea: h.fixtureError( 'square-metre', 1e-6, 'contact-manifold-area' ) },
		resetMigrationPolicy: { policyId: 'contact-manifold-reset-migration', policyVersion: 'contact-manifold-reset-migration-v3', compatibleMigration: 'same-shape-generation-topology-law-time-and-quality-epoch', otherwise: 'invalidate-warm-start-and-begin-new-generation' }
	};

}

function hydrostaticHull( h, fields ) {

	return {
		entityId: clone( fields.entityId ),
		hullFrameId: fields.hullFrameId,
		geometry: 'closed-volume',
		geometryRevision: 'vessel-hydro-hull-geometry-v7',
		displacedVolumeQuery: {
			queryId: 'vessel-displaced-volume-query',
			queryVersion: 'vessel-displaced-volume-query-v5',
			algorithm: 'oriented-closed-triangle-volume-with-clipped-waterline-quadrature',
			geometryEligibilityGate: {
				passed: true,
				orientation: 'outward',
				boundaryEdgeCount: 0,
				nonManifoldEdgeCount: 0,
				signedVolumeM3: h.evidence( 18, 'cubic-metre', 'Measured', 'hydro-hull-geometry-validation-v7' ),
				contentDigest: 'sha256:vessel-hydro-hull-geometry-v7'
			},
			outputUnits: 'cubic-metre-and-metre-moments',
			waterSignalId: fields.waterDescriptor.signalId,
			waterStateVersion: fields.waterDescriptor.stateVersion,
			waterResourceGeneration: clone( fields.waterDescriptor.resourceGeneration ),
			sampleInstant: clone( fields.sampleInstant ),
			physicsFrameId: fields.waterDescriptor.physicsFrameId,
			physicsOriginEpoch: fields.waterDescriptor.physicsOriginEpoch,
			transformRevision: fields.waterDescriptor.transformRevision,
			waterSupportId: fields.waterDescriptor.representedFootprint.supportId,
			waterFilterRevision: fields.waterDescriptor.filter.filterId
		},
		waterlineClipping: { algorithmId: 'exact-predicate-polygon-waterline-clipping', algorithmVersion: 'waterline-clipping-v4', coplanarPolicy: 'symbolic-perturbation-with-owned-sign', toleranceMeters: h.evidence( 1e-6, 'metre', 'Gated', 'hydro-waterline-gate' ) },
		buoyancyModel: 'hydrostatic',
		dragModel: versionedLaw( 'vessel-quadratic-drag', 'vessel-quadratic-drag-v4', 'anisotropic-quadratic-drag', {
			fluidVelocityChannel: 'materialCurrentVelocityMps',
			bodyVelocityChannel: 'RigidBodyState.twist.linearVelocityMps-at-quadrature-point',
			relativeVelocityDefinition: 'materialCurrentVelocityMps-minus-body-point-velocity',
			forbiddenSubstitutes: [ 'surfacePointVelocityMps', 'geometricNormalVelocityMps' ],
			coefficientTableVersion: 'vessel-drag-coefficients-v3'
		} ),
		addedMassModel: h.typedAbsence( 'not-requested', '$threejs-water-optics' ),
		waveExcitationModel: h.typedAbsence( 'not-requested', '$threejs-water-optics' ),
		samplingFootprint: clone( fields.samplingFootprint ),
		approximationError: { displacedVolume: h.fixtureError( 'cubic-metre', 1e-4, 'vessel-hydro-volume-error' ), force: h.fixtureError( 'newton', 0.5, 'vessel-hydro-force-error' ) },
		validity: { geometryRevision: 'vessel-hydro-hull-geometry-v7', waterSignalId: fields.waterDescriptor.signalId, waterStateVersion: fields.waterDescriptor.stateVersion, waterResourceGeneration: clone( fields.waterDescriptor.resourceGeneration ), sampleInstant: clone( fields.sampleInstant ), validityInterval: clone( fields.validityInterval ), physicsFrameId: fields.waterDescriptor.physicsFrameId, physicsOriginEpoch: fields.waterDescriptor.physicsOriginEpoch, transformRevision: fields.waterDescriptor.transformRevision, waterSupportId: fields.waterDescriptor.representedFootprint.supportId, waterStateFilterRevision: fields.waterDescriptor.filter.filterId, regime: 'subcritical-displacement-and-calibrated-drag-Reynolds-range', duplicateForcePolicy: 'added-mass-and-wave-excitation-absent-so-water-solver-cannot-double-apply' }
	};

}

function versionedSampler( samplerId, samplerVersion, descriptor, interval, topologyRevision, outputChannel, semantics ) {

	return {
		samplerId,
		samplerVersion,
		inputSignalId: descriptor.signalId,
		inputStateVersion: descriptor.stateVersion,
		sampleInstant: clone( interval.start ),
		validityInterval: clone( interval ),
		physicsFrameId: descriptor.physicsFrameId,
		physicsOriginEpoch: descriptor.physicsOriginEpoch,
		transformRevision: descriptor.transformRevision,
		topologyRevision,
		outputChannel,
		semantics
	};

}

function makeDeformingBoundaryFixtures( h, route, fields ) {

	const registry = route.physicsContext.idNamespaces;
	const supportProxyId = generationIdentity( registry, 'support', 'vessel-deforming-support', 6 );
	const fluidBoundaryProxyId = generationIdentity( registry, 'support', 'vessel-fluid-boundary', 7 );
	const remapFromFeature = generationIdentity( registry, 'feature', 'vessel-deforming-panel', 7 );
	const remapToFeature = generationIdentity( registry, 'feature', 'vessel-deforming-panel', 8 );
	const deformationStateVersion = 'vessel-deformation-state-v42';
	const topologyRevision = 'vessel-deforming-topology-v9';
	const deformationDescriptor = makeSignalDescriptor( h, route, {
		signalId: 'signal-namespace-v1/vessel-deforming-support@g6',
		providerId: 'provider-namespace-v1/vessel-deformation-owner@g4',
		schemaId: 'physics/deforming-support-state/v1',
		owner: '$threejs-procedural-motion-systems',
		consumers: [ '$threejs-water-optics', 'contact-solver-owner', 'route-physics-coordinator' ],
		stateVersion: deformationStateVersion,
		resourceGeneration: 6,
		interval: fields.interval,
		channels: [
			{ channelId: 'materialPointPositionMeters', valueType: 'Vec3', tensorRankAndShape: 'point', unit: 'metre', basisBehavior: 'structured', quantityClass: 'geometric', samplingMeasure: 'area', errorBound: 1e-4 },
			{ channelId: 'materialPointVelocityMps', valueType: 'Vec3', tensorRankAndShape: 'polar-vector', unit: 'metre-per-second', basisBehavior: 'polar-vector', quantityClass: 'intensive', samplingMeasure: 'area', errorBound: 1e-3 },
			{ channelId: 'surfaceNormalAndJacobian', valueType: 'normal-jacobian-bundle', tensorRankAndShape: 'structured', unit: 'metre-squared', basisBehavior: 'structured', quantityClass: 'geometric', samplingMeasure: 'area', errorBound: 1e-4 }
		]
	} );
	const positionSampler = versionedSampler( 'vessel-deforming-position-sampler', 'vessel-deforming-position-sampler-v4', deformationDescriptor, fields.interval, topologyRevision, 'materialPointPositionMeters', 'material-point-position-at-requested-parameter-and-instant' );
	const velocitySampler = versionedSampler( 'vessel-deforming-velocity-sampler', 'vessel-deforming-velocity-sampler-v5', deformationDescriptor, fields.interval, topologyRevision, 'materialPointVelocityMps', 'physical-material-point-velocity-including-rigid-translation-omega-cross-r-and-local-deformation' );
	const normalAndJacobianSampler = versionedSampler( 'vessel-deforming-differential-sampler', 'vessel-deforming-differential-sampler-v4', deformationDescriptor, fields.interval, topologyRevision, 'surfaceNormalAndJacobian', 'oriented-normal-and-surface-measure-jacobian-from-the-same-deformation-state' );
	const supportFeatureRemap = {
		remapId: 'vessel-deforming-feature-remap-v9',
		remapVersion: 'vessel-deforming-feature-remap-v9',
		fromTopologyRevision: 'vessel-deforming-topology-v8',
		toTopologyRevision: topologyRevision,
		mapping: [ { fromFeatureId: remapFromFeature, toFeatureId: remapToFeature } ],
		contentDigest: 'sha256:vessel-deforming-feature-remap-v9'
	};
	const deformingSupportProxy = {
		supportProxyId,
		contextId: route.physicsContext.contextId,
		owner: deformationDescriptor.owner,
		deformationSignalRef: { signalId: deformationDescriptor.signalId, descriptorStateVersion: deformationDescriptor.stateVersion, schemaId: deformationDescriptor.schemaId, contextId: deformationDescriptor.contextId },
		deformationStateVersion,
		physicsFrameId: deformationDescriptor.physicsFrameId,
		physicsOriginEpoch: deformationDescriptor.physicsOriginEpoch,
		transformRevision: deformationDescriptor.transformRevision,
		validityInterval: clone( fields.interval ),
		topologyRevision,
		positionSampler,
		velocitySampler,
		normalAndJacobianSampler,
		conservativeSweptBounds: { boundsKind: 'deforming-surface-swept-aabb', sampleInstant: clone( fields.interval.start ), interval: clone( fields.interval ), sourceSignalId: deformationDescriptor.signalId, sourceStateVersion: deformationStateVersion, physicsFrameId: deformationDescriptor.physicsFrameId, physicsOriginEpoch: deformationDescriptor.physicsOriginEpoch, transformRevision: deformationDescriptor.transformRevision, topologyRevision, conservative: true, boundsRevision: 'vessel-deforming-bounds-v5' },
		topologyChangePolicy: 'versioned-remap-at-boundary',
		supportFeatureRemap,
		collisionFilter: collisionFilter( 'vessel-deforming-support-filter', 'dynamic-boundary', '0x00000004', '0x00000008' ),
		physicsMaterialId: clone( fields.hullMaterial.physicsMaterialId ),
		approximationError: h.fixtureError( 'metre', 1e-4, 'vessel-deforming-support-approximation' ),
		residency: clone( deformationDescriptor.residency )
	};
	const boundaryCondition = {
		descriptorId: 'vessel-fluid-boundary-condition',
		descriptorVersion: 'vessel-fluid-boundary-condition-v6',
		normalCondition: 'no-penetration',
		tangentialCondition: 'navier-slip',
		thermalCondition: h.typedAbsence( 'not-requested', '$threejs-procedural-motion-systems' ),
		speciesConditions: [],
		roughnessAndPermeabilityLawRef: clone( fields.hullMaterial.dragRoughnessLaw ),
		wetDryActivationRule: versionedLaw( 'vessel-boundary-wet-dry-activation', 'vessel-boundary-wet-dry-activation-v3', 'threshold-with-hysteresis', { wetThresholdMeters: h.evidence( 0.002, 'metre', 'Gated', 'vessel-boundary-wet-dry-gate' ), dryThresholdMeters: h.evidence( 0.001, 'metre', 'Gated', 'vessel-boundary-wet-dry-gate' ) } ),
		twoWayReactionPolicy: 'required',
		compatibilityAndStabilityGate: { gateId: 'vessel-fluid-boundary-stability-gate', gateVersion: 'vessel-fluid-boundary-stability-gate-v4', compatible: true, maximumBoundaryCourant: h.evidence( 0.5, 'ratio', 'Gated', 'vessel-fluid-boundary-stability-gate' ), reactionApplication: 'exact-once-through-named-surface-exchange' }
	};
	const fluidBoundaryProxy = {
		fluidBoundaryProxyId,
		contextId: route.physicsContext.contextId,
		owner: deformationDescriptor.owner,
		physicsFrameId: deformationDescriptor.physicsFrameId,
		physicsOriginEpoch: deformationDescriptor.physicsOriginEpoch,
		transformRevision: deformationDescriptor.transformRevision,
		validityInterval: clone( fields.interval ),
		supportGeometryRef: { supportProxyId: clone( supportProxyId ), topologyRevision, deformationStateVersion, contentDigest: 'sha256:vessel-fluid-boundary-geometry-v9' },
		geometryStateVersion: deformationStateVersion,
		positionSampler: clone( positionSampler ),
		materialVelocitySampler: clone( velocitySampler ),
		normalAndMeasureSampler: clone( normalAndJacobianSampler ),
		conservativeSweptBounds: clone( deformingSupportProxy.conservativeSweptBounds ),
		boundaryCondition,
		collisionFilter: collisionFilter( 'vessel-fluid-boundary-filter', 'fluid-solid-boundary', '0x00000008', '0x00000004' ),
		physicsMaterialSelection: clone( fields.materialPairSelection ),
		reactionExchangeId: fields.reactionExchangeId,
		updateCadence: clone( deformationDescriptor.cadence ),
		topologyRevisionAndRemap: { topologyRevision, remapVersion: supportFeatureRemap.remapVersion, supportProxyId: clone( supportProxyId ), featureRemapDigest: supportFeatureRemap.contentDigest },
		approximationError: h.fixtureError( 'metre', 1e-4, 'vessel-fluid-boundary-approximation' ),
		residency: clone( deformationDescriptor.residency )
	};
	return { deformationDescriptor, deformingSupportProxy, fluidBoundaryProxy };

}

function attachContactInteractionLineage( h, route, descriptor, interactionId, applicationPointMeters ) {

	const interval = clone( route.physicsGraph.coordinationAdvance.interval );
	const targetOwner = '$threejs-procedural-motion-systems';
	const targetStateEquation = 'body-state';
	const claim = route.physicsGraph.executionLedger.stateAdvanceClaims.find( ( candidate ) => candidate.owner === targetOwner && candidate.stateEquationId === targetStateEquation );
	assert.ok( claim, 'contact interaction cannot resolve the body state-advance claim' );
	const execution = route.physicsGraph.executionLedger.stageExecutions.find( ( candidate ) => candidate.stageId === 'correct-body' );
	assert.ok( execution && claim.nativeExecutionIds.includes( execution.executionId ), 'contact interaction cannot resolve the body correction execution' );
	const commitGroup = route.physicsGraph.commitGroups.find( ( candidate ) => candidate.stateEquationOwners[ targetStateEquation ] === targetOwner );
	assert.ok( commitGroup, 'contact interaction cannot resolve the body commit group' );
	const transaction = route.physicsGraph.commitTransactions.find( ( candidate ) => candidate.commitGroupIds.includes( commitGroup.commitGroupId ) );
	assert.ok( transaction?.status === 'committed', 'contact interaction cannot resolve a committed transaction' );
	const sequence = 2001;
	const exchangeId = 'vessel-quay-contact-exchange';
	const exactOnceKey = `${ intervalIdentity( interval ) }|stage=emit-body-water|producer=contact-solver-owner|sequence=${ sequence }|interaction=${ interactionId }`;
	const linearImpulseNs = [ 0, 2, 0 ];
	const footprint = {
		footprintId: 'vessel-quay-contact-point-footprint', kind: 'point', physicsFrameId: descriptor.physicsFrameId,
		physicsOriginEpoch: descriptor.physicsOriginEpoch, transformRevision: descriptor.transformRevision,
		chartId: h.typedAbsence( 'not-applicable', 'contact-solver-owner' ), supportGeometry: { pointMeters: clone( applicationPointMeters ), featureRevision: 'vessel-quay-feature-pair-v1' },
		orientation: h.typedAbsence( 'not-applicable', 'contact-solver-owner' ), measureUnit: 'one', representedMeasure: h.evidence( 1, 'one', 'Derived', 'one discrete contact point' ),
		distributionKind: 'point', kernel: h.typedAbsence( 'not-applicable', 'contact-solver-owner' ), kernelUnit: 'one', normalizationTarget: 'none',
		normalizationIntegral: h.evidence( 1, 'one', 'Derived', 'discrete Dirac application convention' ), quadrature: { pointMeters: clone( applicationPointMeters ), physicalWeight: h.evidence( 1, 'one', 'Derived', 'discrete contact point' ), error: h.fixtureError( 'metre', 1e-5, 'contact-point-quadrature' ) },
		referencePointMeters: clone( applicationPointMeters ), approximationError: h.fixtureError( 'metre', 1e-5, 'contact-point-footprint' )
	};
	const record = {
		interactionId, exactOnceKey, role: 'source', sourceOwner: 'contact-solver-owner', sourceEntityId: 'quay-static@g3',
		sourceStateVersions: [ 'quay-rigid-state-v12', 'wet-granite-state-v17' ], targetOwner, targetEntityId: 'vessel-alpha@g7',
		targetStateVersionExpected: claim.inputCommittedVersions.find( ( ref ) => ref.signalId === claim.outputPreparedVersion.signalId )?.stateVersion ?? claim.inputCommittedVersions[ 0 ].stateVersion,
		targetStateEquation, applicationInterval: clone( interval ), physicsFrameId: descriptor.physicsFrameId, physicsOriginEpoch: descriptor.physicsOriginEpoch,
		transformRevision: descriptor.transformRevision, footprint,
		payload: { tag: 'pointImpulse', timeSemantics: 'interval-integrated', linearImpulseNs, applicationPointMeters: clone( applicationPointMeters ) },
		signConvention: 'positive-source-to-receiver', applicationLedgerKey: `apply|${ exactOnceKey }`, partitionMembership: h.typedAbsence( 'not-applicable', 'contact-solver-owner' ),
		reactionGroupId: h.typedAbsence( 'not-applicable', 'contact-solver-owner' ), reactionToInteractionIds: [], conservationGroupIds: [ 'vessel-quay-contact-momentum' ],
		validity: { status: 'valid', descriptorStateVersion: descriptor.stateVersion, interval: clone( interval ) }, error: { impulse: h.fixtureError( 'newton-second', 1e-5, 'contact-solver-impulse' ) },
		provenance: { adapterRevision: 'contact-solver-route-adapter-v1', stageId: 'emit-body-water', producerId: 'contact-solver-owner', producerSequence: sequence }
	};
	const zeroMomentum = [ 0, 0, 0 ];
	const conservation = {
		conservationGroupId: 'vessel-quay-contact-momentum', contextId: route.physicsContext.contextId, interval: clone( interval ), participants: [ targetOwner ],
		referencePhysicsFrameId: descriptor.physicsFrameId, physicsOriginEpoch: descriptor.physicsOriginEpoch, transformRevision: descriptor.transformRevision,
		angularMomentumReference: { kind: 'fixed-inertial-point', pointAtStartMeters: [ 0, 0, 0 ], trajectoryAndVelocity: h.typedAbsence( 'not-applicable', 'route-physics-coordinator' ), transportTerms: h.typedAbsence( 'not-applicable', 'route-physics-coordinator' ) },
		commodities: [ 'linear-momentum' ], explicitConstraints: [], initialInventory: { linearMomentumNs: zeroMomentum }, finalInventory: { linearMomentumNs: clone( linearImpulseNs ) },
		externalSources: { linearMomentumNs: clone( linearImpulseNs ) }, boundaryFluxes: { linearMomentumNs: zeroMomentum }, modeledInternalTransfers: { byInteractionId: {} },
		modeledConversions: { linearMomentumNs: zeroMomentum }, modeledDissipation: {}, numericalResidual: { linearMomentumNs: zeroMomentum },
		residualNorms: { linearMomentumNs: h.evidence( 0, 'newton-second', 'Derived', 'closed one-way contact momentum ledger' ) },
		acceptanceBounds: { linearMomentumNs: h.evidence( 1e-9, 'newton-second', 'Gated', 'contact momentum closure gate' ) }
	};
	const applicationLedgerId = 'application-vessel-quay-contact-42';
	const overlapSeconds = interval.endExclusive.timeSecondsDerived.value - interval.start.timeSecondsDerived.value;
	const ledger = {
		applicationLedgerId, contextId: route.physicsContext.contextId, exchangeId, interactionId, exactOnceKey, targetOwner, targetEntityId: record.targetEntityId,
		targetStateEquation, targetStateVersionExpected: record.targetStateVersionExpected, coordinationAdvanceId: route.physicsGraph.coordinationAdvance.coordinationAdvanceId,
		stageExecutionId: execution.executionId, nativeSubcycleIndex: h.typedAbsence( 'not-applicable', targetOwner ), payloadTimeSemantics: 'interval-integrated',
		declaredApplicationInterval: clone( interval ), executionOverlapInterval: clone( interval ), overlapMeasureSeconds: h.evidence( overlapSeconds, 'second', 'Derived', 'exact contact/application interval intersection' ),
		appliedPayloadAmount: { linearImpulseNs: clone( linearImpulseNs ), applicationPointMeters: clone( applicationPointMeters ) }, applicationFraction: h.evidence( 1, 'ratio', 'Derived', 'single committed integral application' ),
		cursorBefore: sequence, cursorAfter: sequence + 1, targetPreparedVersion: claim.outputPreparedVersion.stateVersion, commitTransactionId: transaction.commitTransactionId,
		disposition: 'committed', replayEpoch: 'contact-application-42', replaySourceLedgerId: h.typedAbsence( 'not-applicable', 'route-physics-coordinator' ), applicationContentDigest: 'pending', receiptDigest: 'pending'
	};
	const contentPayload = clone( ledger ); delete contentPayload.applicationContentDigest; delete contentPayload.receiptDigest;
	ledger.applicationContentDigest = digest( contentPayload );
	ledger.receiptDigest = digest( { applicationLedgerId, applicationContentDigest: ledger.applicationContentDigest, disposition: ledger.disposition, replayEpoch: ledger.replayEpoch, cursorAfter: ledger.cursorAfter, targetPreparedVersion: ledger.targetPreparedVersion, commitTransactionId: ledger.commitTransactionId } );
	const exchange = {
		exchangeId, contextId: route.physicsContext.contextId, applicationInterval: clone( interval ), physicsFrameId: descriptor.physicsFrameId, physicsOriginEpoch: descriptor.physicsOriginEpoch, transformRevision: descriptor.transformRevision,
		mode: 'one-way', participants: [ 'contact-solver-owner', targetOwner ], sourceDescriptors: [ signalDescriptorRef( descriptor ) ], interactions: [ record ], reactions: [], physicalImpactParents: [], physicalImpactPartitions: [], reactionGroups: [], conservationGroups: [ conservation ],
		couplingLoopId: h.typedAbsence( 'not-applicable', 'route-physics-coordinator' ), stabilityGate: { omittedFeedbackUpperBound: h.evidence( 1e-6, 'newton-second', 'Gated', 'static-quay one-way contact fixture' ), validityRegime: 'static prescribed quay with body-only impulse response' }, convergence: 'not-applicable',
		batchLedger: { batchId: 'vessel-quay-contact-batch-42', exchangeId, producerId: 'contact-solver-owner', publishedSequenceRange: { firstSequence: sequence, lastSequence: sequence }, perConsumerCursor: { [ targetOwner ]: sequence + 1 }, acceptedRejectedLateDuplicate: { accepted: h.evidence( 1, 'record', 'Measured', 'contact application ledger' ), rejected: h.evidence( 0, 'record', 'Measured', 'contact application ledger' ), late: h.evidence( 0, 'record', 'Measured', 'contact application ledger' ), duplicate: h.evidence( 0, 'record', 'Measured', 'contact application ledger' ) }, overflowPolicy: 'block', overflowSequenceRanges: [], lostCommodities: {}, deferredCommodities: {}, exactOnceApplicationLedgerVersion: 'contact-application-ledger-v42', applicationLedgerIds: [ applicationLedgerId ] }
	};
	route.physicsInteractions.push( exchange );
	route.physicsInteractionApplicationLedgers[ applicationLedgerId ] = clone( ledger );
	route.physicsGraph.executionLedger.interactionApplicationLedgers.push( clone( ledger ) );
	execution.interactionApplicationLedgerIds.push( applicationLedgerId );
	claim.interactionApplicationLedgerIds.push( applicationLedgerId );
	for ( const loop of route.physicsGraph.loopMacros ) loop.perIterationLedger.find( ( row ) => row.accepted ).interactionApplicationLedgerIds.push( applicationLedgerId );
	const totals = route.physicsCostLedger.cadenceTraceTotals;
	totals.interactionApplicationCounts.pointImpulse = h.evidence( totals.coordinationAdvanceCount.value, 'application', 'Measured', totals.coordinationAdvanceCount.source );
	const totalsPayload = clone( totals ); delete totalsPayload.exactTotalsDigest; totals.exactTotalsDigest = digest( totalsPayload );
	return { exchangeId, interactionId, applicationLedgerId, exactOnceKey, claimId: claim.claimId, stageExecutionId: execution.executionId, commitTransactionId: transaction.commitTransactionId, commitReceiptId: transaction.receipt.receiptId, commitReceiptDigest: transaction.receipt.receiptDigest };

}

export function buildContactIdentityBundle( h, route ) {

	helperInterface( h );
	assert.ok( route?.physicsContext?.idNamespaces, 'canonical route is missing PhysicsIdentityRegistry' );
	assert.ok( route?.physicsSignals?.bodyState, 'canonical route is missing rigid-body descriptor template' );
	const registry = clone( route.physicsContext.idNamespaces );
	const interval = clone( route.physicsGraph.coordinationAdvance.interval );
	const entityA = generationIdentity( registry, 'entity', 'vessel-alpha', 7 );
	const entityB = generationIdentity( registry, 'entity', 'quay-static', 3 );
	const colliderAId = generationIdentity( registry, 'collider', 'vessel-alpha-hydro-collider', 5 );
	const colliderBId = generationIdentity( registry, 'collider', 'quay-contact-collider', 2 );
	const shapeA = generationIdentity( registry, 'shape', 'vessel-alpha-hull', 4 );
	const shapeB = generationIdentity( registry, 'shape', 'quay-contact-block', 2 );
	const featureA = generationIdentity( registry, 'feature', 'vessel-keel-contact-patch', 9 );
	const featureB = generationIdentity( registry, 'feature', 'quay-ramp-contact-patch', 5 );
	const pointA = generationIdentity( registry, 'feature', 'vessel-quay-contact-point-a', 11 );
	const pointB = generationIdentity( registry, 'feature', 'vessel-quay-contact-point-b', 12 );
	const manifoldId = generationIdentity( registry, 'contactManifold', 'vessel-quay-manifold', 6 );
	const interactionId = `${ registry.namespacesByKind.interaction.namespaceId }/vessel-quay-contact-impulse@g8`;
	const hullMaterialId = generationIdentity( registry, 'physicsMaterial', 'marine-aluminium-hull', 4 );
	const rockMaterialId = generationIdentity( registry, 'physicsMaterial', 'quay-granite', 3 );
	const waterMaterialId = generationIdentity( registry, 'physicsMaterial', 'coastal-seawater', 5 );
	const hullMaterial = materialRecord( h, hullMaterialId, 'marine-aluminium-record-v4', 2700, {
		contactLaw: versionedLaw( 'hull-unilateral-contact', 'hull-unilateral-contact-v3', 'Signorini-complementarity', { penetrationToleranceMeters: h.evidence( 1e-5, 'metre', 'Gated', 'contact-law-gate' ) } ),
		frictionLaw: versionedLaw( 'hull-anisotropic-friction', 'hull-anisotropic-friction-v4', 'regularized-Coulomb', { coefficientTableVersion: 'hull-friction-coefficients-v2' } ),
		restitutionLaw: versionedLaw( 'hull-impact-restitution', 'hull-impact-restitution-v2', 'velocity-dependent-Poisson', { curveVersion: 'hull-restitution-curve-v2' } ),
		complianceDampingLaw: versionedLaw( 'hull-compliance', 'hull-compliance-v3', 'Kelvin-Voigt-normal-compliance', { stiffnessNPerM: h.evidence( 5e7, 'newton-per-metre', 'Gated', 'hull-contact-calibration' ) } ),
		dragRoughnessLaw: versionedLaw( 'hull-drag-roughness', 'hull-drag-roughness-v4', 'equivalent-sand-grain-roughness', { roughnessMeters: h.evidence( 2e-4, 'metre', 'Measured', 'hull-surface-survey' ) } )
	}, 'marine-aluminium-material' );
	const rockMaterial = materialRecord( h, rockMaterialId, 'quay-granite-record-v3', 2650, {
		contactLaw: versionedLaw( 'granite-unilateral-contact', 'granite-unilateral-contact-v2', 'Signorini-complementarity', { penetrationToleranceMeters: h.evidence( 1e-5, 'metre', 'Gated', 'contact-law-gate' ) } ),
		frictionLaw: versionedLaw( 'granite-friction', 'granite-friction-v5', 'regularized-Coulomb', { coefficientTableVersion: 'wet-granite-friction-v3' } ),
		restitutionLaw: versionedLaw( 'granite-restitution', 'granite-restitution-v2', 'velocity-dependent-Poisson', { curveVersion: 'granite-restitution-curve-v1' } ),
		complianceDampingLaw: versionedLaw( 'granite-compliance', 'granite-compliance-v2', 'Kelvin-Voigt-normal-compliance', { stiffnessNPerM: h.evidence( 9e7, 'newton-per-metre', 'Gated', 'granite-contact-calibration' ) } )
	}, 'quay-granite-material' );
	const waterMaterial = materialRecord( h, waterMaterialId, 'coastal-seawater-record-v5', 1025, {
		dragRoughnessLaw: versionedLaw( 'seawater-viscous-drag', 'seawater-viscous-drag-v5', 'temperature-salinity-viscosity', { propertyTableVersion: 'seawater-properties-35psu-v3' } ),
		wettingContactAngleLaw: versionedLaw( 'seawater-hull-wetting', 'seawater-hull-wetting-v2', 'dynamic-contact-angle', { calibrationVersion: 'marine-aluminium-wetting-v2' } )
	}, 'coastal-seawater-material' );
	const priorMaterialRegistry = clone( route.physicsContext.physicsMaterialRegistry );
	const materialMap = {
		...priorMaterialRegistry.materials,
		...Object.fromEntries( [ hullMaterial, rockMaterial, waterMaterial ].map( ( material ) => [ idKey( material.physicsMaterialId ), material ] ) )
	};
	const pairResolver = {
		resolverId: 'ordered-contact-material-pair-resolver',
		resolverVersion: 'ordered-contact-material-pair-resolver-v4',
		participantOrdering: 'ordered-A-B-with-contact-frame',
		explicitPairOverrides: {
			...priorMaterialRegistry.pairLawResolver.explicitPairOverrides,
			[`${ idKey( hullMaterialId ) }=>${ idKey( rockMaterialId ) }`]: 'hull-granite-pair-law-v4',
			[`${ idKey( hullMaterialId ) }=>${ idKey( waterMaterialId ) }`]: 'hull-seawater-boundary-law-v5'
		},
		perLawCompositionRules: { rulesVersion: 'contact-law-composition-v4', friction: 'named-asymmetric-wet-interface-rule', restitution: 'named-velocity-dependent-rule', compliance: 'series-normal-compliance' },
		missingPairPolicy: 'block',
		deterministicSelectionDigestRule: 'sha256-canonical-ordered-ids-record-versions-state-versions-contact-frame-and-law-versions'
	};
	const physicsMaterialRegistry = {
		registryId: route.physicsContext.physicsMaterialRegistry.registryId,
		owner: route.physicsContext.physicsMaterialRegistry.owner,
		registryVersion: `${ priorMaterialRegistry.registryVersion }+contact-materials-v1`,
		materials: materialMap,
		materialStateDescriptors: clone( priorMaterialRegistry.materialStateDescriptors ),
		pairLawResolver: pairResolver,
		renderBindings: h.typedAbsence( 'not-requested', 'physics-material-owner' )
	};
	const scalarStateChannel = ( channelId, value, unit, errorBound ) => ( { channelId, value, unit, errorBound, valueType: 'scalar', tensorRankAndShape: 'scalar', basisBehavior: 'scalar', quantityClass: 'intensive' } );
	const materialStateA = materialState( h, route, { materialStateId: 'marine-aluminium-state@g2', signalId: 'signal-namespace-v1/marine-aluminium-material-state@g2', stateVersion: 'marine-aluminium-state-v11', resourceGeneration: 11, physicsMaterialId: hullMaterialId, interval, channels: [ scalarStateChannel( 'temperatureK', 289, 'kelvin', 0.2 ), scalarStateChannel( 'liquidSaturation', 0.08, 'ratio', 0.01 ) ], constitutiveInputs: { salinityExposure: h.evidence( 0.02, 'kilogram-per-kilogram', 'Measured', 'hull-material-state-survey' ) } } );
	const materialStateB = materialState( h, route, { materialStateId: 'wet-granite-state@g4', signalId: 'signal-namespace-v1/wet-granite-material-state@g4', stateVersion: 'wet-granite-state-v17', resourceGeneration: 17, physicsMaterialId: rockMaterialId, interval, channels: [ scalarStateChannel( 'temperatureK', 288, 'kelvin', 0.3 ), scalarStateChannel( 'liquidSaturation', 0.64, 'ratio', 0.02 ) ], constitutiveInputs: { porePressurePa: h.evidence( 1200, 'pascal', 'Measured', 'quay-material-state-survey' ) } } );
	const waterMaterialState = materialState( h, route, { materialStateId: 'coastal-seawater-state@g5', signalId: 'signal-namespace-v1/coastal-seawater-material-state@g5', stateVersion: 'coastal-seawater-state-v21', resourceGeneration: 21, physicsMaterialId: waterMaterialId, interval, channels: [ scalarStateChannel( 'temperatureK', 286, 'kelvin', 0.2 ), scalarStateChannel( 'liquidSaturation', 1, 'ratio', 0 ) ], constitutiveInputs: { salinity: h.evidence( 0.035, 'kilogram-per-kilogram', 'Measured', 'coastal-seawater-state' ) } } );
	const physicsMaterialStates = [ materialStateA, materialStateB, waterMaterialState ];
	physicsMaterialRegistry.materialStateDescriptors.push( ...physicsMaterialStates.map( ( state ) => signalDescriptorRef( state.descriptor ) ) );
	route.physicsContext.physicsMaterialRegistry = physicsMaterialRegistry;
	for ( const [ index, state ] of physicsMaterialStates.entries() ) route.physicsSignals[ `contactMaterialState${ index }` ] = state.descriptor;
	const stateA = rigidBodyState( h, route, { entityId: entityA, owner: '$threejs-procedural-motion-systems', signalId: 'signal-namespace-v1/rigid-body-vessel-alpha@g7', providerId: 'provider-namespace-v1/rigid-state-owner@g4', stateVersion: 'vessel-rigid-state-v42', resourceGeneration: 7, interval, bodyFrameId: 'body-frame-1', positionMeters: [ 2, 0.5, - 1 ], rotation: [ 0, 0, 0, 1 ], angularVelocityRadPerS: [ 0, 0.3, 0 ], linearVelocityMps: [ 1, 0, 0 ], motionMode: 'dynamic' } );
	const stateB = rigidBodyState( h, route, { entityId: entityB, owner: '$threejs-procedural-motion-systems', signalId: 'signal-namespace-v1/rigid-body-quay-static@g3', providerId: 'provider-namespace-v1/rigid-state-owner@g4', stateVersion: 'quay-rigid-state-v12', resourceGeneration: 3, interval, bodyFrameId: route.physicsContext.physicsRootFrameId, positionMeters: [ 2.1, 0.49, - 1 ], rotation: [ 0, 0, 0, 1 ], angularVelocityRadPerS: [ 0, 0, 0 ], linearVelocityMps: [ 0, 0, 0 ], motionMode: 'static' } );
	route.physicsSignals.contactRigidBodyA = stateA.descriptor;
	route.physicsSignals.contactRigidBodyB = stateB.descriptor;
	const colliderA = colliderProxy( h, route, { colliderId: colliderAId, entityId: entityA, shapeId: shapeA, state: stateA, shapeRepresentation: 'convex', shapeName: 'vessel-hull', closedness: 'watertight-with-gate', physicsMaterialId: hullMaterialId, layer: 'dynamic-solid', belongsToMask: '0x00000001', collidesWithMask: '0x00000002' } );
	const colliderB = colliderProxy( h, route, { colliderId: colliderBId, entityId: entityB, shapeId: shapeB, state: stateB, shapeRepresentation: 'mesh', shapeName: 'quay-block', closedness: 'closed', physicsMaterialId: rockMaterialId, layer: 'static-solid', belongsToMask: '0x00000002', collidesWithMask: '0x00000001' } );
	const propertiesA = rigidBodyProperties( h, { entityId: entityA, owner: '$threejs-procedural-motion-systems', name: 'vessel-alpha', massKg: 10800, centerOfMassBodyMeters: [ 0, 0, 0 ], inertiaTensorBodyKgM2: [ 9000, 0, 0, 0, 14000, 0, 0, 0, 16000 ], bodyFrameId: stateA.bodyFrameId, colliderIds: [ colliderAId ], physicsMaterialIds: [ hullMaterialId ], motionMode: 'dynamic' } );
	const propertiesB = rigidBodyProperties( h, { entityId: entityB, owner: '$threejs-procedural-motion-systems', name: 'quay-static', massKg: 50000, centerOfMassBodyMeters: clone( stateB.centerOfMassPositionMeters.value ), inertiaTensorBodyKgM2: [ 30000, 0, 0, 0, 40000, 0, 0, 0, 50000 ], bodyFrameId: stateB.bodyFrameId, colliderIds: [ colliderBId ], physicsMaterialIds: [ rockMaterialId ], motionMode: 'static' } );
	const combinedFrictionLaw = versionedLaw( 'hull-granite-wet-interface-friction', 'hull-granite-wet-interface-friction-v4', 'ordered-asymmetric-regularized-Coulomb', { ordering: 'hull-A-to-granite-B', coefficientTableVersion: 'hull-granite-wet-friction-v3' } );
	const pairSelection = materialPairSelection( h, { selectionId: 'vessel-quay-material-pair-selection-v4', interactionId, interval, materialA: hullMaterial, materialB: rockMaterial, materialStateA, materialStateB, contactFrameId: route.physicsContext.physicsRootFrameId, resolver: pairResolver, selectedLaws: [ hullMaterial.contactLaw, rockMaterial.contactLaw, combinedFrictionLaw ] } );
	const points = [
		{ persistentPointId: pointA, pointMeters: [ 2.05, 0.495, - 1 ], localDeformationVelocityAMps: [ 0, 0, 0 ], localDeformationVelocityBMps: [ 0, 0, 0 ], featurePair: { featureA: clone( featureA ), featureB: clone( featureB ) }, areaWeightM2: h.evidence( 0.02, 'square-metre', 'Derived', 'contact-patch-quadrature-v2' ) },
		{ persistentPointId: pointB, pointMeters: [ 2.05, 0.495, - 0.95 ], localDeformationVelocityAMps: [ 0, 0, 0 ], localDeformationVelocityBMps: [ 0, 0, 0 ], featurePair: { featureA: clone( featureA ), featureB: clone( featureB ) }, areaWeightM2: h.evidence( 0.02, 'square-metre', 'Derived', 'contact-patch-quadrature-v2' ) }
	];
	const manifold = makeContactManifold( h, route, { interval, manifoldId, interactionId, entityA, entityB, colliderA, colliderB, stateA, stateB, featureA, featureB, materialA: hullMaterial, materialB: rockMaterial, materialStateA, materialStateB, materialPairSelection: pairSelection, points } );
	const waterDescriptor = route.physicsSignals.waterSurface;
	const waterValidityInterval = waterDescriptor.validity.validTime.interval;
	const hull = hydrostaticHull( h, {
		entityId: entityA,
		hullFrameId: stateA.bodyFrameId,
		waterDescriptor,
		sampleInstant: waterValidityInterval.start,
		validityInterval: waterValidityInterval,
		samplingFootprint: waterDescriptor.representedFootprint
	} );
	const fluidReactionExchange = route.physicsInteractions.find( ( exchange ) => exchange.exchangeId === 'body-water-exchange' ) ?? route.physicsInteractions[ 0 ];
	const fluidReactionExchangeId = fluidReactionExchange.exchangeId;
	const fluidInteractionId = fluidReactionExchange.interactions[ 0 ].interactionId;
	const coupledBoundaryLaw = versionedLaw( 'hull-seawater-two-way-boundary', 'hull-seawater-two-way-boundary-v5', 'no-penetration-navier-slip-two-way-reaction', { ordering: 'hull-boundary-A-to-water-B', reactionClosure: 'exact-once-surface-exchange', stabilityGateVersion: 'vessel-fluid-boundary-stability-gate-v4' } );
	const fluidMaterialPairSelection = materialPairSelection( h, { selectionId: 'vessel-water-boundary-material-pair-selection-v5', interactionId: fluidInteractionId, interval, materialA: hullMaterial, materialB: waterMaterial, materialStateA, materialStateB: waterMaterialState, contactFrameId: route.physicsContext.physicsRootFrameId, resolver: pairResolver, selectedLaws: [ hullMaterial.dragRoughnessLaw, waterMaterial.dragRoughnessLaw, coupledBoundaryLaw ] } );
	const boundaryFixtures = makeDeformingBoundaryFixtures( h, route, { interval, hullMaterial, materialPairSelection: fluidMaterialPairSelection, reactionExchangeId: fluidReactionExchangeId } );
	route.physicsSignals.contactManifold = manifold.descriptor;
	route.physicsSignals.deformingSupport = boundaryFixtures.deformationDescriptor;
	const contactInteractionLineage = attachContactInteractionLineage( h, route, manifold.descriptor, interactionId, manifold.manifoldPatch.referencePointMeters );
	return {
		identityRegistry: registry,
		physicsMaterialRegistry,
		physicsMaterialStates,
		colliderProxies: [ colliderA, colliderB ],
		rigidBodyProperties: [ propertiesA, propertiesB ],
		rigidBodyStates: [ stateA, stateB ],
		contactManifoldRecords: [ manifold ],
		hydrostaticHullProperties: [ hull ],
		deformationSignalDescriptors: [ boundaryFixtures.deformationDescriptor ],
		deformingSupportProxies: [ boundaryFixtures.deformingSupportProxy ],
		fluidBoundaryProxies: [ boundaryFixtures.fluidBoundaryProxy ],
		contactInteractionLineage,
		contactOwnership: { manifoldLifecycleOwner: manifold.owner, frictionAdhesionStateOwner: manifold.frictionAdhesionState.owner, warmStartOwner: manifold.warmStartImpulses.owner, emittedImpulseOwner: manifold.owner },
		identityCompactionProofs: [ { namespaceKind: 'entity', stableIdentity: clone( entityA ), before: { identitySlotMap: { [ idKey( entityA ) ]: 17 }, slotMapVersion: 'entity-slots-v41' }, after: { identitySlotMap: { [ idKey( entityA ) ]: 3 }, slotMapVersion: 'entity-slots-v42' } } ],
		identityReallocationProofs: [ { namespaceKind: 'shape', retiredIdentity: { ...clone( shapeA ), generation: 3 }, currentIdentity: clone( shapeA ), retirementDigest: registry.namespacesByKind.shape.retiredGenerationDigest } ]
	};

}

function validateIdentityRegistryAndProofs( h, bundle ) {

	h.requireAbiRecord( bundle.identityRegistry, 'PhysicsIdentityRegistry', 'contactIdentity.identityRegistry' );
	for ( const [ kind, namespace ] of Object.entries( bundle.identityRegistry.namespacesByKind ) ) {

		h.requireAbiRecord( namespace, 'IdentityNamespaceDescriptor', `contactIdentity.identityRegistry.${ kind}` );
		assert.equal( namespace.generationPolicy, 'monotonically-increment-on-reuse', `identity namespace ${ kind } can recycle without a generation increment` );
		assert.ok( Number.isInteger( namespace.allocationCursor ) && namespace.allocationCursor >= 0, `identity namespace ${ kind } has an invalid allocation cursor` );
		assert.match( namespace.retiredGenerationDigest, /^sha256:/, `identity namespace ${ kind } lacks a retired-generation digest` );

	}
	for ( const [ index, proof ] of bundle.identityCompactionProofs.entries() ) {

		validateGenerationIdentity( proof.stableIdentity, proof.namespaceKind, bundle.identityRegistry, `identityCompactionProofs[${ index }].stableIdentity` );
		const key = idKey( proof.stableIdentity );
		assert.deepEqual( Object.keys( proof.before.identitySlotMap ), [ key ], `identityCompactionProofs[${ index }] before map is not closed` );
		assert.deepEqual( Object.keys( proof.after.identitySlotMap ), [ key ], `identityCompactionProofs[${ index }] after map is not closed` );
		assert.notEqual( proof.before.identitySlotMap[ key ], proof.after.identitySlotMap[ key ], `identityCompactionProofs[${ index }] does not exercise slot movement` );
		assert.notEqual( proof.before.slotMapVersion, proof.after.slotMapVersion, `identityCompactionProofs[${ index }] did not publish a new slot-map version` );

	}
	for ( const [ index, proof ] of bundle.identityReallocationProofs.entries() ) {

		validateGenerationIdentity( proof.retiredIdentity, proof.namespaceKind, bundle.identityRegistry, `identityReallocationProofs[${ index }].retiredIdentity` );
		validateGenerationIdentity( proof.currentIdentity, proof.namespaceKind, bundle.identityRegistry, `identityReallocationProofs[${ index }].currentIdentity` );
		assert.equal( proof.retiredIdentity.stableId, proof.currentIdentity.stableId, `identityReallocationProofs[${ index }] does not represent reuse of one stable key` );
		assert.ok( proof.currentIdentity.generation > proof.retiredIdentity.generation, `identityReallocationProofs[${ index }] recycled an ID without incrementing generation` );
		assert.equal( proof.retirementDigest, bundle.identityRegistry.namespacesByKind[ proof.namespaceKind ].retiredGenerationDigest, `identityReallocationProofs[${ index }] is not covered by the retirement digest` );

	}

}

function validateSignalDescriptorClosure( h, route, descriptor, label ) {

	h.requireAbiRecord( descriptor, 'PhysicsSignalDescriptor', label );
	assert.equal( descriptor.contextId, route.physicsContext.contextId, `${ label } belongs to another physics context` );
	const frame = route.physicsContext.physicsFrameRegistry.framesById[ descriptor.physicsFrameId ];
	assert.ok( frame, `${ label } references an unregistered physics frame` );
	assert.equal( descriptor.physicsOriginEpoch, route.physicsContext.physicsOriginEpoch, `${ label } uses another physics-origin epoch` );
	assert.equal( descriptor.transformRevision, frame.transformRevision, `${ label } uses a stale frame transform` );
	assert.ok( route.physicsContext.physicsClockRegistry.clocksById[ descriptor.clockId ], `${ label } references an unregistered clock` );
	assert.equal( descriptor.cadence.clockId, descriptor.clockId, `${ label } cadence uses another clock` );
	assert.equal( descriptor.cadence.samplePhase, descriptor.samplePhase, `${ label } cadence/sample phase is ambiguous` );
	assert.equal( descriptor.validity.validTime.kind, 'interval', `${ label } must publish interval validity` );
	assert.equal( descriptor.validity.validTime.interval.clockId, descriptor.clockId, `${ label } validity uses another clock` );
	assert.equal( descriptor.latency.clockMappingRevision, descriptor.validity.validTime.interval.intervalMappingRevision, `${ label } latency uses another clock mapping` );
	assert.deepEqual( descriptor.latency.maximumStaleness, descriptor.validity.staleAfter, `${ label } has two staleness authorities` );
	h.requireAbiRecord( descriptor.representedFootprint, 'PhysicsSupportDescriptor', `${ label }.representedFootprint` );
	h.requireAbiRecord( descriptor.filter, 'PhysicsFilterDescriptor', `${ label }.filter` );
	assert.equal( descriptor.representedFootprint.physicsFrameId, descriptor.physicsFrameId, `${ label } support frame drifted` );
	assert.equal( descriptor.representedFootprint.physicsOriginEpoch, descriptor.physicsOriginEpoch, `${ label } support origin drifted` );
	assert.equal( descriptor.representedFootprint.transformRevision, descriptor.transformRevision, `${ label } support transform drifted` );
	assert.equal( descriptor.filter.supportMeasure, descriptor.representedFootprint.kind, `${ label } filter/support measure mismatch` );
	assert.deepEqual( Object.keys( descriptor.channels ).sort(), Object.keys( descriptor.perChannelError ).sort(), `${ label } channel/error inventory does not close` );
	for ( const [ channelId, channel ] of Object.entries( descriptor.channels ) ) {

		const channelLabel = `${ label }.channels.${ channelId }`;
		h.requireAbiRecord( channel, 'PhysicsChannelDescriptor', channelLabel );
		const error = descriptor.perChannelError[ channelId ];
		h.requireAbiRecord( error, 'PhysicsErrorDescriptor', `${ label }.perChannelError.${ channelId }` );
		assert.equal( channel.channelId, channelId, `${ channelLabel } map key and channel ID differ` );
		assert.deepEqual( channel.declaredSupport, descriptor.representedFootprint, `${ channelLabel } invents another support authority` );
		assert.deepEqual( channel.declaredFilter, descriptor.filter, `${ channelLabel } invents another filter authority` );
		assert.deepEqual( channel.validity, descriptor.validity, `${ channelLabel } invents another validity authority` );
		assert.equal( channel.errorRef, error.errorId, `${ channelLabel } error reference does not resolve` );
		assert.equal( error.quantityOrChannelId, channelId, `${ channelLabel } error names another channel` );
		assert.deepEqual( error.validity, descriptor.validity, `${ channelLabel } error validity is not descriptor-owned` );

	}
	const routeDescriptors = Object.values( route.physicsSignals ).filter( ( candidate ) => candidate.signalId === descriptor.signalId );
	assert.equal( routeDescriptors.length, 1, `${ label } must resolve exactly once in route.physicsSignals` );
	assert.deepEqual( routeDescriptors[ 0 ], descriptor, `${ label } differs from the route-owned descriptor` );

}

function validateMaterials( h, route, bundle ) {

	const registry = bundle.physicsMaterialRegistry;
	h.requireAbiRecord( registry, 'PhysicsMaterialRegistry', 'contactIdentity.physicsMaterialRegistry' );
	assert.deepEqual( route.physicsContext.physicsMaterialRegistry, registry, 'contact material registry is a sidecar rather than route authority' );
	h.requireAbiRecord( registry.pairLawResolver, 'PhysicsMaterialPairResolver', 'contactIdentity.physicsMaterialRegistry.pairLawResolver' );
	assert.equal( registry.pairLawResolver.participantOrdering, 'ordered-A-B-with-contact-frame', 'material pair resolver lost A/B ordering' );
	for ( const [ key, material ] of Object.entries( registry.materials ) ) {

		h.requireAbiRecord( material, 'PhysicsMaterialRecord', `contactIdentity.materials.${ key}` );
		const generationBearing = material.physicsMaterialId !== null && typeof material.physicsMaterialId === 'object' && ! Array.isArray( material.physicsMaterialId );
		if ( generationBearing ) {

			validateGenerationIdentity( material.physicsMaterialId, 'physicsMaterial', bundle.identityRegistry, `contactIdentity.materials.${ key}.physicsMaterialId` );
			assert.equal( key, idKey( material.physicsMaterialId ), `material registry key ${ key } does not name its record ID` );

		} else assert.equal( key, material.physicsMaterialId, `legacy material registry key ${ key } does not name its record ID` );
		nonempty( material.recordVersion, `contactIdentity.materials.${ key}.recordVersion` );
		if ( ! isAbsence( material.densityKgPerM3 ) ) assert.ok( quantityValue( material.densityKgPerM3, 'kilogram-per-cubic-metre', `contactIdentity.materials.${ key}.densityKgPerM3` ) > 0, `contactIdentity.materials.${ key} density must be positive` );
		for ( const lawKey of MATERIAL_LAW_KEYS ) if ( ! isAbsence( material[ lawKey ] ) ) {

			if ( generationBearing ) validateVersionedLaw( material[ lawKey ], `contactIdentity.materials.${ key}.${ lawKey}` );
			else nonempty( material[ lawKey ], `contactIdentity.materials.${ key}.${ lawKey}` );

		}
		for ( const quantityKey of [ 'thermalConductivityWPerMK', 'specificHeatJPerKgK' ] ) if ( ! isAbsence( material[ quantityKey ] ) ) assert.ok( material[ quantityKey ].value > 0, `contactIdentity.materials.${ key}.${ quantityKey } must be positive` );
		if ( generationBearing ) {

			assert.ok( material.uncertainty !== null && typeof material.uncertainty === 'object', `contactIdentity.materials.${ key} lacks typed uncertainty` );
			assert.match( material.provenance.contentDigest, /^sha256:/, `contactIdentity.materials.${ key} lacks provenance digest` );

		} else {

			nonempty( material.uncertainty, `contactIdentity.materials.${ key}.uncertainty` );
			nonempty( material.provenance, `contactIdentity.materials.${ key}.provenance` );

		}

	}
	for ( const [ pairKey, pairLawVersion ] of Object.entries( registry.pairLawResolver.explicitPairOverrides ) ) {

		const materialKeys = Object.keys( registry.materials );
		const resolvedPairs = [];
		for ( const materialAKey of materialKeys ) for ( const materialBKey of materialKeys ) if ( pairKey === `${ materialAKey }=>${ materialBKey }` || pairKey === `${ materialAKey }|${ materialBKey }` ) resolvedPairs.push( [ materialAKey, materialBKey ] );
		assert.equal( resolvedPairs.length, 1, `material override ${ pairKey } must resolve one ordered pair` );
		nonempty( pairLawVersion, `material override ${ pairKey }` );

	}
	const stateIds = new Set();
	const descriptorRefs = [];
	for ( const [ index, state ] of bundle.physicsMaterialStates.entries() ) {

		const label = `contactIdentity.physicsMaterialStates[${ index }]`;
		h.requireAbiRecord( state, 'PhysicsMaterialState', label );
		assert.ok( ! stateIds.has( state.materialStateId ), `${ label } repeats material-state identity` );
		stateIds.add( state.materialStateId );
		const material = registry.materials[ idKey( state.physicsMaterialId ) ];
		assert.ok( material && sameIdentity( material.physicsMaterialId, state.physicsMaterialId ), `${ label } material identity does not resolve through the route registry` );
		validateSignalDescriptorClosure( h, route, state.descriptor, `${ label }.descriptor` );
		assert.equal( state.owner, state.descriptor.owner, `${ label } owner differs from descriptor authority` );
		assert.equal( state.stateVersion, state.descriptor.stateVersion, `${ label } state version differs from descriptor authority` );
		assert.deepEqual( state.sampleInstant, state.validityInterval.start, `${ label } sample instant differs from its validity bracket` );
		assert.deepEqual( state.validityInterval, state.descriptor.validity.validTime.interval, `${ label } validity interval differs from descriptor authority` );
		for ( const key of [ 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision' ] ) assert.equal( state[ key ], state.descriptor[ key ], `${ label }.${ key } differs from descriptor authority` );
		assert.deepEqual( state.validity, state.descriptor.validity, `${ label } validity has another authority` );
		assert.deepEqual( state.error, state.descriptor.perChannelError, `${ label } error map has another authority` );
		for ( const channelId of [ 'temperatureK', 'liquidSaturation', 'iceMassFraction', 'phaseMassFractions', 'damageOrCompactionState' ] ) {

			const sampled = state[ channelId ];
			if ( state.descriptor.channels[ channelId ] ) validateSampledChannel( h, sampled, state, channelId, `${ label }.${ channelId }` );
			else h.requireAbiRecord( sampled, 'TypedAbsence', `${ label }.${ channelId }` );

		}
		descriptorRefs.push( signalDescriptorRef( state.descriptor ) );

	}
	assert.deepEqual( registry.materialStateDescriptors.slice( - descriptorRefs.length ), descriptorRefs, 'route material-state descriptor inventory does not close over contact states' );

}

function validateSampledChannel( h, channel, state, channelId, label ) {

	h.requireAbiRecord( channel, 'SampledChannel', label );
	const descriptorChannel = state.descriptor.channels[ channelId ];
	assert.ok( descriptorChannel, `${ label } has no declared descriptor channel` );
	assert.equal( channel.channelId, channelId, `${ label } has the wrong channel ID` );
	assert.equal( channel.unit, descriptorChannel.unit, `${ label } unit differs from the descriptor` );
	assert.equal( channel.stateVersion, state.stateVersion, `${ label } is not sampled from the enclosing state version` );
	assert.equal( channel.actualPhysicsTime.kind, 'instant', `${ label } must be instant-sampled` );
	assert.deepEqual( channel.actualPhysicsTime.instant, state.sampleInstant, `${ label } sample time differs from the enclosing state` );
	assert.deepEqual( channel.actualSupport, descriptorChannel.declaredSupport, `${ label } actual support differs from declared support` );
	assert.deepEqual( channel.actualFilter, descriptorChannel.declaredFilter, `${ label } actual filter differs from declared filter` );
	assert.equal( channel.validity, state.descriptor.validity.status, `${ label } validity differs from descriptor authority` );
	assert.deepEqual( channel.error, state.descriptor.perChannelError[ channelId ], `${ label } error differs from descriptor authority` );

}

function validateProperRotation( rotation, label ) {

	if ( rotation.length === 4 ) {

		vector( rotation, 4, label );
		assertNear( norm( rotation ), 1, 1e-8, `${ label } quaternion norm` );
		return;

	}
	vector( rotation, 9, label );
	const rows = [ rotation.slice( 0, 3 ), rotation.slice( 3, 6 ), rotation.slice( 6, 9 ) ];
	for ( let index = 0; index < 3; index ++ ) {

		assertNear( norm( rows[ index ] ), 1, 1e-8, `${ label } row ${ index } norm` );
		for ( let other = index + 1; other < 3; other ++ ) assertNear( dot( rows[ index ], rows[ other ] ), 0, 1e-8, `${ label } row orthogonality` );

	}
	assertNear( determinant3( rotation ), 1, 1e-8, `${ label } determinant` );

}

function validateRigidBodies( h, route, bundle ) {

	const colliders = new Map( bundle.colliderProxies.map( ( collider ) => [ idKey( collider.colliderId ), collider ] ) );
	const materials = bundle.physicsMaterialRegistry.materials;
	const states = new Map( bundle.rigidBodyStates.map( ( state ) => [ idKey( state.entityId ), state ] ) );
	for ( const [ index, collider ] of bundle.colliderProxies.entries() ) {

		const label = `contactIdentity.colliderProxies[${ index }]`;
		h.requireAbiRecord( collider, 'ColliderProxy', label );
		validateGenerationIdentity( collider.colliderId, 'collider', bundle.identityRegistry, `${ label }.colliderId` );
		validateGenerationIdentity( collider.entityId, 'entity', bundle.identityRegistry, `${ label }.entityId` );
		validateGenerationIdentity( collider.shapeId, 'shape', bundle.identityRegistry, `${ label }.shapeId` );
		assert.equal( collider.contextId, route.physicsContext.contextId, `${ label } belongs to another context` );
		const state = states.get( idKey( collider.entityId ) );
		assert.ok( state, `${ label } has no rigid-body state` );
		assert.equal( collider.shapeFrameId, state.bodyFrameId, `${ label } shape frame does not resolve through its body pose` );
		assert.equal( collider.physicsFrameId, state.physicsFrameId, `${ label } physics frame differs from its pose state` );
		assert.equal( collider.physicsOriginEpoch, state.physicsOriginEpoch, `${ label } origin epoch differs from its pose state` );
		assert.equal( collider.transformRevision, state.transformRevision, `${ label } transform revision differs from its pose state` );
		assert.equal( collider.poseSignalRef.signalId, state.descriptor.signalId, `${ label } pose descriptor ref resolves to another signal` );
		assert.equal( collider.poseSignalRef.descriptorStateVersion, state.descriptor.stateVersion, `${ label } pose descriptor version is stale` );
		assert.equal( collider.poseSignalRef.schemaId, state.descriptor.schemaId, `${ label } pose descriptor schema is stale` );
		assert.equal( collider.poseSignalRef.contextId, state.descriptor.contextId, `${ label } pose descriptor context is stale` );
		assert.equal( collider.poseStateVersion, state.stateVersion, `${ label } pose state version is stale` );
		assert.deepEqual( collider.validityInterval, state.validityInterval, `${ label } pose and collider validity intervals differ` );
		assert.deepEqual( collider.updateCadence, state.descriptor.cadence, `${ label } update cadence differs from pose authority` );
		assert.deepEqual( collider.sweptBounds.sampleInstant, state.sampleInstant, `${ label } swept bounds use another sample instant` );
		assert.deepEqual( collider.sweptBounds.interval, state.validityInterval, `${ label } swept bounds cover another interval` );
		assert.equal( collider.sweptBounds.sourceSignalId, state.descriptor.signalId, `${ label } swept bounds use another signal` );
		assert.equal( collider.sweptBounds.sourceStateVersion, state.stateVersion, `${ label } swept bounds were built from another state version` );
		for ( const key of [ 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision' ] ) assert.equal( collider.sweptBounds[ key ], state[ key ], `${ label } swept-bounds ${ key } differs from pose authority` );
		assert.equal( collider.sweptBounds.topologyRevision, collider.topologyRevision, `${ label } swept bounds use stale topology` );
		assert.equal( collider.sweptBounds.conservative, true, `${ label } swept bounds are not conservative` );
		assert.ok( materials[ idKey( collider.physicsMaterialId ) ], `${ label } physics material does not resolve` );
		assert.ok( quantityValue( collider.conservativeInflationMeters, 'metre', `${ label }.conservativeInflationMeters` ) >= 0, `${ label } conservative inflation is negative` );
		assert.equal( collider.featureIdPolicy.topologyRevision, collider.topologyRevision, `${ label } feature policy is stale for its topology` );

	}
	for ( const [ index, state ] of bundle.rigidBodyStates.entries() ) {

		const label = `contactIdentity.rigidBodyStates[${ index }]`;
		h.requireAbiRecord( state, 'RigidBodyState', label );
		validateGenerationIdentity( state.entityId, 'entity', bundle.identityRegistry, `${ label }.entityId` );
		validateSignalDescriptorClosure( h, route, state.descriptor, `${ label }.descriptor` );
		assert.equal( state.descriptor.owner, state.owner, `${ label } owner disagrees with its descriptor` );
		assert.equal( state.descriptor.stateVersion, state.stateVersion, `${ label } state version disagrees with its descriptor` );
		assert.equal( state.descriptor.physicsFrameId, state.physicsFrameId, `${ label } frame disagrees with its descriptor` );
		assert.equal( state.descriptor.physicsOriginEpoch, state.physicsOriginEpoch, `${ label } origin epoch disagrees with its descriptor` );
		assert.equal( state.descriptor.transformRevision, state.transformRevision, `${ label } transform revision disagrees with its descriptor` );
		assert.deepEqual( state.sampleInstant, state.validityInterval.start, `${ label } sample instant is outside the serialized validity bracket` );
		assert.ok( route.physicsContext.physicsFrameRegistry.framesById[ state.bodyFrameId ], `${ label } body frame does not resolve` );
		validateSampledChannel( h, state.centerOfMassPositionMeters, state, 'centerOfMassPositionMeters', `${ label }.centerOfMassPositionMeters` );
		validateSampledChannel( h, state.bodyToPhysicsRotation, state, 'bodyToPhysicsRotation', `${ label }.bodyToPhysicsRotation` );
		validateProperRotation( state.bodyToPhysicsRotation.value, `${ label }.bodyToPhysicsRotation.value` );
		assert.equal( state.twist.ordering, 'angular-then-linear-at-reference-point', `${ label } twist ordering is ambiguous` );
		validateSampledChannel( h, state.twist.angularVelocityRadPerS, state, 'angularVelocityRadPerS', `${ label }.twist.angularVelocityRadPerS` );
		validateSampledChannel( h, state.twist.linearVelocityMps, state, 'linearVelocityMps', `${ label }.twist.linearVelocityMps` );
		h.requireAbiRecord( state.twist.referencePoint, 'SpatialReferencePoint', `${ label }.twist.referencePoint` );
		assert.equal( state.twist.referencePoint.kind, 'center-of-mass', `${ label } fixture twist must be referenced at center of mass` );
		assert.deepEqual( state.twist.referencePoint.pointMeters, state.centerOfMassPositionMeters.value, `${ label } twist reference point is not the published center of mass` );
		for ( const key of [ 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision', 'sampleInstant' ] ) assert.deepEqual( state.twist.referencePoint[ key ], state[ key ], `${ label } twist reference ${ key } disagrees with state` );

	}
	for ( const [ index, properties ] of bundle.rigidBodyProperties.entries() ) {

		const label = `contactIdentity.rigidBodyProperties[${ index }]`;
		h.requireAbiRecord( properties, 'RigidBodyProperties', label );
		validateGenerationIdentity( properties.entityId, 'entity', bundle.identityRegistry, `${ label }.entityId` );
		assert.ok( states.has( idKey( properties.entityId ) ), `${ label } has no matching dynamic state` );
		const state = states.get( idKey( properties.entityId ) );
		assert.ok( quantityValue( properties.massKg, 'kilogram', `${ label }.massKg` ) > 0, `${ label } mass must be positive` );
		vector( properties.centerOfMassBodyMeters.value, 3, `${ label }.centerOfMassBodyMeters.value` );
		const inertia = vector( properties.inertiaTensorBodyKgM2.value, 9, `${ label }.inertiaTensorBodyKgM2.value` );
		assertNear( inertia[ 1 ], inertia[ 3 ], 1e-10, `${ label } inertia symmetry xy` );
		assertNear( inertia[ 2 ], inertia[ 6 ], 1e-10, `${ label } inertia symmetry xz` );
		assertNear( inertia[ 5 ], inertia[ 7 ], 1e-10, `${ label } inertia symmetry yz` );
		const eigenvalues = symmetricEigenvalues3( inertia );
		assert.ok( eigenvalues[ 0 ] >= - 1e-10, `${ label } inertia tensor is not positive semidefinite` );
		assert.ok( eigenvalues[ 2 ] <= eigenvalues[ 0 ] + eigenvalues[ 1 ] + 1e-8 * Math.max( 1, eigenvalues[ 2 ] ), `${ label } inertia violates the rigid-body triangle inequality` );
		assert.equal( properties.forceTorqueApplicationOwner, properties.owner, `${ label } force/torque equation has another owner` );
		assert.equal( properties.bodyFrameId, state.bodyFrameId, `${ label } body frame differs from its state` );
		const bodyFrame = route.physicsContext.physicsFrameRegistry.framesById[ properties.bodyFrameId ];
		assert.ok( bodyFrame, `${ label } body frame does not resolve` );
		assert.ok( bodyFrame.parentFrameId === route.physicsContext.physicsRootFrameId || bodyFrame.frameId === route.physicsContext.physicsRootFrameId, `${ label } fixture COM closure requires a direct physics-root child` );
		const rotation = state.bodyToPhysicsRotation.value.length === 4 ? quaternionToMat3( state.bodyToPhysicsRotation.value ) : state.bodyToPhysicsRotation.value;
		const expectedCenterOfMass = add( bodyFrame.parentFromFrameTranslationMeters, mat3MultiplyVector( rotation, properties.centerOfMassBodyMeters.value ) );
		for ( let component = 0; component < 3; component ++ ) assertNear( state.centerOfMassPositionMeters.value[ component ], expectedCenterOfMass[ component ], 1e-10, `${ label } center of mass frame conversion component ${ component }` );
		for ( const colliderId of properties.colliderIds ) assert.ok( colliders.has( idKey( colliderId ) ), `${ label } has an unresolved collider` );
		for ( const materialId of properties.physicsMaterialIds ) assert.ok( materials[ idKey( materialId ) ], `${ label } has an unresolved material` );

	}

}

function validateMaterialPairSelection( h, route, bundle, manifold, label ) {

	const selection = manifold.materialPairSelection;
	h.requireAbiRecord( selection, 'PhysicsMaterialPairSelection', `${ label }.materialPairSelection` );
	assert.deepEqual( selection.applicationInterval, manifold.validityInterval, `${ label } pair law is not latched over the manifold interval` );
	assert.deepEqual( selection.orderedPhysicsMaterialIds, [ manifold.materialA.physicsMaterialId, manifold.materialB.physicsMaterialId ], `${ label } material-pair order does not follow A/B` );
	const materials = bundle.physicsMaterialRegistry.materials;
	assert.deepEqual( selection.orderedMaterialRecordVersions, [ materials[ idKey( manifold.materialA.physicsMaterialId ) ].recordVersion, materials[ idKey( manifold.materialB.physicsMaterialId ) ].recordVersion ], `${ label } material record versions are stale` );
	assert.deepEqual( selection.orderedMaterialStateIdsAndVersions, [ { materialStateId: manifold.materialA.materialStateId, stateVersion: manifold.materialA.materialStateVersion }, { materialStateId: manifold.materialB.materialStateId, stateVersion: manifold.materialB.materialStateVersion } ], `${ label } material-state versions are not latched in A/B order` );
	assert.deepEqual( selection.materialStateSampleInstants, [ manifold.materialA.sampleInstant, manifold.materialB.sampleInstant ], `${ label } material-state sample instants are not latched` );
	assert.equal( selection.contactFrameId, manifold.physicsFrameId, `${ label } pair law is selected in another contact frame` );
	assert.equal( selection.resolverId, bundle.physicsMaterialRegistry.pairLawResolver.resolverId, `${ label } pair resolver does not resolve` );
	assert.equal( selection.resolverVersion, bundle.physicsMaterialRegistry.pairLawResolver.resolverVersion, `${ label } pair resolver version is stale` );
	assert.equal( selection.latching, 'immutable-for-application-interval', `${ label } material pair can mutate during its application interval` );
	for ( const [ index, law ] of selection.selectedLawRefsAndParameters.entries() ) validateVersionedLaw( law, `${ label }.materialPairSelection.selectedLawRefsAndParameters[${ index }]` );
	const digestInput = clone( selection );
	delete digestInput.selectionDigest;
	assert.equal( selection.selectionDigest, digest( digestInput ), `${ label } material-pair digest does not cover the latched inputs` );
	assert.equal( route.physicsContext.contextId, manifold.contextId, `${ label } belongs to another context` );
	assert.equal( selection.interactionId, manifold.emittedInteractionIds[ 0 ], `${ label } pair selection is not latched to the emitted interaction` );

}

function validatePointVelocityDerivation( derivation, state, point, localDeformationVelocityMps, label ) {

	assert.equal( derivation.stateVersion, state.stateVersion, `${ label } uses another body state` );
	assert.equal( derivation.bodyFrameId, state.bodyFrameId, `${ label } uses another body frame` );
	assert.deepEqual( derivation.sampleInstant, state.sampleInstant, `${ label } uses another sample instant` );
	for ( const key of [ 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision' ] ) assert.equal( derivation[ key ], state[ key ], `${ label }.${ key } differs from body state` );
	assert.equal( derivation.referencePointKind, 'center-of-mass', `${ label } angular term is not referenced at the center of mass` );
	assert.deepEqual( derivation.referencePointMeters, state.centerOfMassPositionMeters.value, `${ label } reference point differs from the published center of mass` );
	const leverArm = subtract( point, state.centerOfMassPositionMeters.value );
	assert.deepEqual( derivation.leverArmMeters, leverArm, `${ label } lever arm is not point minus center of mass` );
	assert.deepEqual( derivation.linearVelocityMps, state.twist.linearVelocityMps.value, `${ label } linear term differs from body twist` );
	assert.deepEqual( derivation.angularVelocityRadPerS, state.twist.angularVelocityRadPerS.value, `${ label } angular term differs from body twist` );
	const angularContribution = cross( state.twist.angularVelocityRadPerS.value, leverArm );
	assert.deepEqual( derivation.angularContributionMps, angularContribution, `${ label } angular contribution is not omega cross r` );
	assert.deepEqual( derivation.localDeformationVelocityMps, localDeformationVelocityMps, `${ label } local deformation term differs from the sampled support velocity` );
	assert.deepEqual( derivation.pointVelocityMps, add( add( state.twist.linearVelocityMps.value, angularContribution ), localDeformationVelocityMps ), `${ label } point velocity does not close` );

}

function resolveInteractionLineage( route, interactionId, label ) {

	const matches = [];
	for ( const exchange of route.physicsInteractions ) for ( const record of [ ...exchange.interactions, ...exchange.reactions ] ) if ( record.interactionId === interactionId ) matches.push( { exchange, record } );
	assert.equal( matches.length, 1, `${ label } must resolve exactly one route InteractionRecord` );
	const { exchange, record } = matches[ 0 ];
	const ledgers = Object.values( route.physicsInteractionApplicationLedgers ).filter( ( ledger ) => ledger.exchangeId === exchange.exchangeId && ledger.interactionId === interactionId );
	assert.equal( ledgers.length, 1, `${ label } must resolve exactly one exact-once application ledger` );
	const ledger = ledgers[ 0 ];
	assert.equal( ledger.exactOnceKey, record.exactOnceKey, `${ label } application ledger uses another exact-once key` );
	assert.equal( ledger.disposition, 'committed', `${ label } application was not committed` );
	assert.deepEqual( ledger.appliedPayloadAmount, Object.fromEntries( Object.entries( record.payload ).filter( ( [ key ] ) => ! [ 'tag', 'timeSemantics' ].includes( key ) ) ), `${ label } committed payload differs from the interaction` );
	const graphLedger = route.physicsGraph.executionLedger.interactionApplicationLedgers.filter( ( candidate ) => candidate.applicationLedgerId === ledger.applicationLedgerId );
	assert.equal( graphLedger.length, 1, `${ label } execution ledger does not close over the application` );
	assert.deepEqual( graphLedger[ 0 ], ledger, `${ label } route and execution application ledgers differ` );
	const execution = route.physicsGraph.executionLedger.stageExecutions.find( ( candidate ) => candidate.executionId === ledger.stageExecutionId );
	assert.ok( execution?.interactionApplicationLedgerIds.includes( ledger.applicationLedgerId ), `${ label } stage execution does not claim the application` );
	const claim = route.physicsGraph.executionLedger.stateAdvanceClaims.find( ( candidate ) => candidate.owner === ledger.targetOwner && candidate.stateEquationId === ledger.targetStateEquation && candidate.interactionApplicationLedgerIds.includes( ledger.applicationLedgerId ) );
	assert.ok( claim?.nativeExecutionIds.includes( execution.executionId ), `${ label } state-advance claim does not own the execution` );
	const transaction = route.physicsGraph.commitTransactions.find( ( candidate ) => candidate.commitTransactionId === ledger.commitTransactionId );
	assert.equal( transaction?.status, 'committed', `${ label } application does not resolve a committed transaction` );
	assert.ok( transaction.commitGroupIds.some( ( groupId ) => route.physicsGraph.commitGroups.some( ( group ) => group.commitGroupId === groupId && group.stateEquationOwners[ ledger.targetStateEquation ] === ledger.targetOwner ) ), `${ label } transaction does not own the target state equation` );
	assert.ok( exchange.batchLedger.applicationLedgerIds.includes( ledger.applicationLedgerId ), `${ label } batch ledger omits the application` );
	return { exchange, record, ledger, execution, claim, transaction };

}

function validateContacts( h, route, bundle ) {

	const colliders = new Map( bundle.colliderProxies.map( ( collider ) => [ idKey( collider.colliderId ), collider ] ) );
	const states = new Map( bundle.rigidBodyStates.map( ( state ) => [ idKey( state.entityId ), state ] ) );
	for ( const [ index, manifold ] of bundle.contactManifoldRecords.entries() ) {

		const label = `contactIdentity.contactManifoldRecords[${ index }]`;
		h.requireAbiRecord( manifold, 'ContactManifoldRecord', label );
		validateGenerationIdentity( manifold.manifoldId, 'contactManifold', bundle.identityRegistry, `${ label }.manifoldId` );
		validateSignalDescriptorClosure( h, route, manifold.descriptor, `${ label }.descriptor` );
		assert.equal( manifold.descriptor.owner, manifold.owner, `${ label } owner differs from descriptor owner` );
		assert.equal( manifold.descriptor.contextId, manifold.contextId, `${ label } context differs from descriptor context` );
		assert.equal( manifold.descriptor.physicsFrameId, manifold.physicsFrameId, `${ label } frame differs from descriptor frame` );
		assert.equal( manifold.descriptor.physicsOriginEpoch, manifold.physicsOriginEpoch, `${ label } epoch differs from descriptor epoch` );
		assert.equal( manifold.descriptor.transformRevision, manifold.transformRevision, `${ label } transform differs from descriptor transform` );
		assert.deepEqual( manifold.sampleInstant, manifold.validityInterval.start, `${ label } sample instant is not bracketed by validity` );
		assert.equal( manifold.normalConvention, 'A-to-B', `${ label } normal convention is not A-to-B` );
		assert.equal( manifold.separationConvention, 'positive-separated-zero-touching-negative-penetrating', `${ label } separation sign is ambiguous` );
		for ( const [ side, body ] of [ [ 'A', manifold.bodyA ], [ 'B', manifold.bodyB ] ] ) {

			validateGenerationIdentity( body.entityId, 'entity', bundle.identityRegistry, `${ label }.body${ side }.entityId` );
			validateGenerationIdentity( body.colliderId, 'collider', bundle.identityRegistry, `${ label }.body${ side }.colliderId` );
			validateGenerationIdentity( body.shapeId, 'shape', bundle.identityRegistry, `${ label }.body${ side }.shapeId` );
			const collider = colliders.get( idKey( body.colliderId ) );
			assert.ok( collider, `${ label }.body${ side} collider does not resolve` );
			assert.ok( sameIdentity( collider.entityId, body.entityId ) && sameIdentity( collider.shapeId, body.shapeId ), `${ label }.body${ side} collider/shape/entity tuple is inconsistent` );
			assert.equal( states.get( idKey( body.entityId ) ).stateVersion, body.stateVersion, `${ label }.body${ side} uses a stale state version` );
			for ( const featureId of body.featureIds ) validateGenerationIdentity( featureId, 'feature', bundle.identityRegistry, `${ label }.body${ side}.featureId` );

		}
		validateMaterialPairSelection( h, route, bundle, manifold, label );
		const materialStates = new Map( bundle.physicsMaterialStates.map( ( state ) => [ state.materialStateId, state ] ) );
		for ( const [ side, materialRef ] of [ [ 'A', manifold.materialA ], [ 'B', manifold.materialB ] ] ) {

			assert.ok( bundle.physicsMaterialRegistry.materials[ idKey( materialRef.physicsMaterialId ) ], `${ label }.material${ side } does not resolve in the route registry` );
			const state = materialStates.get( materialRef.materialStateId );
			assert.ok( state, `${ label }.material${ side } state does not resolve` );
			assert.ok( sameIdentity( state.physicsMaterialId, materialRef.physicsMaterialId ), `${ label }.material${ side } state belongs to another material` );
			assert.equal( state.stateVersion, materialRef.materialStateVersion, `${ label }.material${ side } state version is stale` );
			assert.deepEqual( state.sampleInstant, materialRef.sampleInstant, `${ label }.material${ side } sample instant is stale` );

		}
		const basis = manifold.manifoldPatch.tangentBasis;
		const tolerance = quantityValue( basis.orthonormalityTolerance, 'ratio', `${ label }.manifoldPatch.tangentBasis.orthonormalityTolerance` );
		const normal = vector( basis.normal, 3, `${ label }.normal` );
		const tangentU = vector( basis.tangentU, 3, `${ label }.tangentU` );
		const tangentV = vector( basis.tangentV, 3, `${ label }.tangentV` );
		for ( const [ name, axis ] of [ [ 'normal', normal ], [ 'tangentU', tangentU ], [ 'tangentV', tangentV ] ] ) assertNear( norm( axis ), 1, tolerance, `${ label } ${ name} norm` );
		assertNear( dot( normal, tangentU ), 0, tolerance, `${ label } normal/tangentU orthogonality` );
		assertNear( dot( normal, tangentV ), 0, tolerance, `${ label } normal/tangentV orthogonality` );
		assertNear( dot( tangentU, tangentV ), 0, tolerance, `${ label } tangent orthogonality` );
		assertNear( dot( cross( tangentU, tangentV ), normal ), 1, tolerance, `${ label } tangent basis handedness` );
		assert.equal( basis.handedness, 'right-handed', `${ label } tangent basis handedness is not declared` );
		const pointKeys = manifold.manifoldPatch.points.map( ( point ) => idKey( point.persistentPointId ) );
		assert.equal( new Set( pointKeys ).size, pointKeys.length, `${ label } repeats persistent contact-point identity` );
		let weightSum = 0;
		for ( const [ pointIndex, point ] of manifold.manifoldPatch.points.entries() ) {

			validateGenerationIdentity( point.persistentPointId, 'feature', bundle.identityRegistry, `${ label }.manifoldPatch.points[${ pointIndex }].persistentPointId` );
			vector( point.pointMeters, 3, `${ label }.manifoldPatch.points[${ pointIndex }].pointMeters` );
			assert.ok( manifold.bodyA.featureIds.some( ( id ) => sameIdentity( id, point.featurePair.featureA ) ), `${ label } point ${ pointIndex} has foreign feature A` );
			assert.ok( manifold.bodyB.featureIds.some( ( id ) => sameIdentity( id, point.featurePair.featureB ) ), `${ label } point ${ pointIndex} has foreign feature B` );
			weightSum += quantityValue( point.areaWeightM2, 'square-metre', `${ label }.manifoldPatch.points[${ pointIndex }].areaWeightM2` );

		}
		assertNear( weightSum, quantityValue( manifold.manifoldPatch.patchAreaM2, 'square-metre', `${ label }.manifoldPatch.patchAreaM2` ), 1e-12, `${ label } contact patch area closure` );
		for ( const [ field, rows ] of [ [ 'signedSeparationMeters', manifold.signedSeparationMeters ], [ 'relativePointVelocityMps', manifold.relativePointVelocityMps ] ] ) {

			const rowKeys = rows.map( ( row ) => idKey( row.persistentPointId ) ).sort();
			assert.deepEqual( rowKeys, [ ...pointKeys ].sort(), `${ label }.${ field } does not close over the persistent points` );

		}
		for ( const [ pointIndex, point ] of manifold.manifoldPatch.points.entries() ) {

			const row = manifold.relativePointVelocityMps.find( ( candidate ) => sameIdentity( candidate.persistentPointId, point.persistentPointId ) );
			assert.ok( row, `${ label } point ${ pointIndex } has no relative-velocity row` );
			const stateA = states.get( idKey( manifold.bodyA.entityId ) );
			const stateB = states.get( idKey( manifold.bodyB.entityId ) );
			const localA = point.localDeformationVelocityAMps ?? [ 0, 0, 0 ];
			const localB = point.localDeformationVelocityBMps ?? [ 0, 0, 0 ];
			validatePointVelocityDerivation( row.bodyA, stateA, point.pointMeters, localA, `${ label }.relativePointVelocityMps[${ pointIndex }].bodyA` );
			validatePointVelocityDerivation( row.bodyB, stateB, point.pointMeters, localB, `${ label }.relativePointVelocityMps[${ pointIndex }].bodyB` );
			assert.deepEqual( row.valueMps, subtract( row.bodyA.pointVelocityMps, row.bodyB.pointVelocityMps ), `${ label } relative velocity is not vA(point)-vB(point)` );
			assert.equal( row.formula, 'vRel=(vA+omegaA-cross-rA+deformationA)-(vB+omegaB-cross-rB+deformationB)', `${ label } relative-velocity convention is ambiguous` );
			assert.deepEqual( row.sampleInstant, manifold.sampleInstant, `${ label } relative velocity uses another instant` );
			for ( const key of [ 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision' ] ) assert.equal( row[ key ], manifold[ key ], `${ label } relative-velocity ${ key } differs from manifold` );

		}
		for ( const stateKey of [ 'frictionAdhesionState', 'warmStartImpulses' ] ) {

			const state = manifold[ stateKey ];
			assert.equal( state.owner, manifold.owner, `${ label }.${ stateKey } has a second owner` );
			assert.equal( state.solverIdAndRevision, manifold.solverIdAndRevision, `${ label }.${ stateKey } comes from another solver revision` );
			assert.ok( sameIdentity( state.manifoldId, manifold.manifoldId ), `${ label }.${ stateKey } belongs to another manifold` );
			assert.equal( state.stateVersion, manifold.descriptor.stateVersion, `${ label }.${ stateKey } is stale` );

		}
		assert.deepEqual( manifold.warmStartImpulses.pointImpulses.map( ( row ) => idKey( row.persistentPointId ) ).sort(), [ ...pointKeys ].sort(), `${ label } warm start does not close over persistent points` );
		for ( const [ interactionIndex, interactionId ] of manifold.emittedInteractionIds.entries() ) {

			const interactionLabel = `${ label }.emittedInteractionIds[${ interactionIndex }]`;
			validateInteractionId( interactionId, bundle.identityRegistry, interactionLabel );
			const lineage = resolveInteractionLineage( route, interactionId, interactionLabel );
			assert.equal( lineage.exchange.exchangeId, bundle.contactInteractionLineage.exchangeId, `${ interactionLabel } resolves another SurfaceExchange` );
			assert.equal( lineage.ledger.applicationLedgerId, bundle.contactInteractionLineage.applicationLedgerId, `${ interactionLabel } resolves another application ledger` );
			assert.equal( lineage.record.exactOnceKey, bundle.contactInteractionLineage.exactOnceKey, `${ interactionLabel } resolves another exact-once key` );
			assert.equal( lineage.claim.claimId, bundle.contactInteractionLineage.claimId, `${ interactionLabel } resolves another state-advance claim` );
			assert.equal( lineage.execution.executionId, bundle.contactInteractionLineage.stageExecutionId, `${ interactionLabel } resolves another stage execution` );
			assert.equal( lineage.transaction.commitTransactionId, bundle.contactInteractionLineage.commitTransactionId, `${ interactionLabel } resolves another commit transaction` );
			assert.equal( lineage.transaction.receipt.receiptId, bundle.contactInteractionLineage.commitReceiptId, `${ interactionLabel } resolves another commit receipt` );
			assert.equal( lineage.transaction.receipt.receiptDigest, bundle.contactInteractionLineage.commitReceiptDigest, `${ interactionLabel } commit receipt digest is stale` );

		}

	}
	assert.equal( new Set( Object.values( bundle.contactOwnership ) ).size, 1, 'contact lifecycle, friction state, warm start, and impulse emission must have one exclusive owner' );

}

function validateHydrostatics( h, route, bundle ) {

	const states = new Map( bundle.rigidBodyStates.map( ( state ) => [ idKey( state.entityId ), state ] ) );
	const waterDescriptor = route.physicsSignals.waterSurface;
	for ( const [ index, hull ] of bundle.hydrostaticHullProperties.entries() ) {

		const label = `contactIdentity.hydrostaticHullProperties[${ index }]`;
		h.requireAbiRecord( hull, 'HydrostaticHullProperties', label );
		validateGenerationIdentity( hull.entityId, 'entity', bundle.identityRegistry, `${ label }.entityId` );
		const state = states.get( idKey( hull.entityId ) );
		assert.ok( state, `${ label } has no rigid-body state` );
		assert.equal( hull.hullFrameId, state.bodyFrameId, `${ label } hull frame differs from its rigid-body state` );
		assert.equal( hull.geometry, 'closed-volume', `${ label } is not a closed-volume hydrostatic hull` );
		const gate = hull.displacedVolumeQuery.geometryEligibilityGate;
		assert.equal( gate.passed, true, `${ label } geometry eligibility gate failed` );
		assert.equal( gate.orientation, 'outward', `${ label } hull orientation is not outward` );
		assert.equal( gate.boundaryEdgeCount, 0, `${ label } hull is not watertight` );
		assert.equal( gate.nonManifoldEdgeCount, 0, `${ label } hull is non-manifold` );
		assert.ok( quantityValue( gate.signedVolumeM3, 'cubic-metre', `${ label }.signedVolumeM3` ) > 0, `${ label } signed volume is not positive` );
		assert.match( gate.contentDigest, /^sha256:/, `${ label } geometry gate is not bound to immutable geometry` );
		validateVersionedLaw( hull.dragModel, `${ label }.dragModel` );
		assert.equal( hull.dragModel.parameters.fluidVelocityChannel, 'materialCurrentVelocityMps', `${ label } drag must consume the water material-current velocity` );
		assert.notEqual( hull.dragModel.parameters.fluidVelocityChannel, 'surfacePointVelocityMps', `${ label } drag consumes geometric surface-point velocity` );
		assert.match( hull.dragModel.parameters.relativeVelocityDefinition, /^materialCurrentVelocityMps-minus-body-point-velocity$/, `${ label } drag relative velocity is not equation-specific` );
		assert.ok( isAbsence( hull.addedMassModel ) && isAbsence( hull.waveExcitationModel ), `${ label } fixture must not duplicate added-mass or wave-excitation forces owned by the water solver` );
		const query = hull.displacedVolumeQuery;
		assert.equal( query.waterSignalId, waterDescriptor.signalId, `${ label } volume query uses another water signal` );
		assert.equal( query.waterStateVersion, waterDescriptor.stateVersion, `${ label } volume query uses a stale water state` );
		assert.deepEqual( query.waterResourceGeneration, waterDescriptor.resourceGeneration, `${ label } volume query uses another water resource generation` );
		assert.deepEqual( query.sampleInstant, waterDescriptor.validity.validTime.interval.start, `${ label } volume query uses another water instant` );
		for ( const key of [ 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision' ] ) assert.equal( query[ key ], waterDescriptor[ key ], `${ label } volume-query ${ key } differs from water state` );
		assert.equal( query.waterSupportId, waterDescriptor.representedFootprint.supportId, `${ label } volume query uses another water support` );
		assert.equal( query.waterFilterRevision, waterDescriptor.filter.filterId, `${ label } volume query uses another water filter` );
		assert.deepEqual( hull.samplingFootprint, waterDescriptor.representedFootprint, `${ label } sampling footprint differs from water descriptor` );
		assert.equal( hull.validity.geometryRevision, hull.geometryRevision, `${ label } validity uses another hull geometry` );
		assert.equal( hull.validity.waterSignalId, query.waterSignalId, `${ label } validity uses another water signal` );
		assert.equal( hull.validity.waterStateVersion, query.waterStateVersion, `${ label } validity uses another water state` );
		assert.deepEqual( hull.validity.waterResourceGeneration, query.waterResourceGeneration, `${ label } validity uses another water resource generation` );
		assert.deepEqual( hull.validity.sampleInstant, query.sampleInstant, `${ label } validity uses another water instant` );
		assert.deepEqual( hull.validity.validityInterval, waterDescriptor.validity.validTime.interval, `${ label } validity interval differs from water state` );
		for ( const key of [ 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision' ] ) assert.equal( hull.validity[ key ], query[ key ], `${ label } validity ${ key } differs from query` );
		assert.equal( hull.validity.waterSupportId, query.waterSupportId, `${ label } validity uses another support` );
		assert.equal( hull.validity.waterStateFilterRevision, query.waterFilterRevision, `${ label } validity uses another filter` );

	}

}

function validateVersionedSampler( sampler, descriptor, expectedTopologyRevision, expectedOutputChannel, label ) {

	exactKeys( sampler, [ 'samplerId', 'samplerVersion', 'inputSignalId', 'inputStateVersion', 'sampleInstant', 'validityInterval', 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision', 'topologyRevision', 'outputChannel', 'semantics' ], label );
	for ( const key of [ 'samplerId', 'samplerVersion', 'inputSignalId', 'inputStateVersion', 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision', 'topologyRevision', 'outputChannel', 'semantics' ] ) nonempty( sampler[ key ], `${ label }.${ key}` );
	assert.match( sampler.samplerVersion, /-v\d+$/, `${ label } is not explicitly versioned` );
	assert.equal( sampler.inputSignalId, descriptor.signalId, `${ label } samples another deformation signal` );
	assert.equal( sampler.inputStateVersion, descriptor.stateVersion, `${ label } samples a stale state version` );
	assert.deepEqual( sampler.sampleInstant, descriptor.validity.validTime.interval.start, `${ label } samples at another instant` );
	assert.deepEqual( sampler.validityInterval, descriptor.validity.validTime.interval, `${ label } has a different validity interval` );
	assert.equal( sampler.physicsFrameId, descriptor.physicsFrameId, `${ label } evaluates in another frame` );
	assert.equal( sampler.physicsOriginEpoch, descriptor.physicsOriginEpoch, `${ label } evaluates in another origin epoch` );
	assert.equal( sampler.transformRevision, descriptor.transformRevision, `${ label } evaluates under another transform revision` );
	assert.equal( sampler.topologyRevision, expectedTopologyRevision, `${ label } samples another topology revision` );
	assert.equal( sampler.outputChannel, expectedOutputChannel, `${ label } publishes the wrong physical channel` );
	assert.ok( descriptor.channels[ sampler.outputChannel ], `${ label } output channel is not declared by the input signal` );

}

function validateBoundaryMaterialSelection( h, route, bundle, boundary, label ) {

	const selection = boundary.physicsMaterialSelection;
	h.requireAbiRecord( selection, 'PhysicsMaterialPairSelection', `${ label }.physicsMaterialSelection` );
	const exchangeMatches = route.physicsInteractions.filter( ( exchange ) => exchange.exchangeId === boundary.reactionExchangeId );
	assert.equal( exchangeMatches.length, 1, `${ label } reaction exchange must resolve exactly once` );
	const exchange = exchangeMatches[ 0 ];
	assert.ok( exchange.reactions.length > 0, `${ label } required two-way reaction exchange has no reaction records` );
	const interactionMatches = [ ...exchange.interactions, ...exchange.reactions ].filter( ( record ) => record.interactionId === selection.interactionId );
	assert.equal( interactionMatches.length, 1, `${ label } material selection must resolve exactly one record in its reaction exchange` );
	const lineage = resolveInteractionLineage( route, selection.interactionId, `${ label }.physicsMaterialSelection.interactionId` );
	assert.equal( lineage.exchange.exchangeId, boundary.reactionExchangeId, `${ label } selected interaction resolves in another exchange` );
	assert.deepEqual( selection.applicationInterval, boundary.validityInterval, `${ label } material selection is not latched over the boundary interval` );
	assert.equal( selection.latching, 'immutable-for-application-interval', `${ label } material selection can mutate within the boundary interval` );
	assert.equal( selection.contactFrameId, boundary.physicsFrameId, `${ label } material selection uses another boundary frame` );
	assert.equal( selection.resolverId, bundle.physicsMaterialRegistry.pairLawResolver.resolverId, `${ label } material resolver does not resolve` );
	assert.equal( selection.resolverVersion, bundle.physicsMaterialRegistry.pairLawResolver.resolverVersion, `${ label } material resolver version is stale` );
	assert.equal( selection.orderedPhysicsMaterialIds.length, 2, `${ label } material selection must contain an ordered boundary/fluid pair` );
	const materials = selection.orderedPhysicsMaterialIds.map( ( materialId, index ) => {

		validateGenerationIdentity( materialId, 'physicsMaterial', bundle.identityRegistry, `${ label }.physicsMaterialSelection.orderedPhysicsMaterialIds[${ index }]` );
		const material = bundle.physicsMaterialRegistry.materials[ idKey( materialId ) ];
		assert.ok( material, `${ label } material ${ index } does not resolve` );
		return material;

	} );
	assert.deepEqual( selection.orderedMaterialRecordVersions, materials.map( ( material ) => material.recordVersion ), `${ label } material record versions are stale` );
	assert.equal( selection.orderedMaterialStateIdsAndVersions.length, 2, `${ label } lacks a state/version latch for one material` );
	assert.equal( selection.materialStateSampleInstants.length, 2, `${ label } lacks a sample-instant latch for one material` );
	const statesById = new Map( bundle.physicsMaterialStates.map( ( state ) => [ state.materialStateId, state ] ) );
	for ( const [ index, stateRef ] of selection.orderedMaterialStateIdsAndVersions.entries() ) {

		const state = statesById.get( stateRef.materialStateId );
		assert.ok( state, `${ label } material state ${ index } does not resolve` );
		assert.equal( state.stateVersion, stateRef.stateVersion, `${ label } material state ${ index } version is stale` );
		assert.ok( sameIdentity( state.physicsMaterialId, selection.orderedPhysicsMaterialIds[ index ] ), `${ label } material state ${ index } belongs to another material` );
		assert.deepEqual( selection.materialStateSampleInstants[ index ], state.sampleInstant, `${ label } material state ${ index } was sampled at another instant` );

	}
	for ( const [ index, law ] of selection.selectedLawRefsAndParameters.entries() ) validateVersionedLaw( law, `${ label }.physicsMaterialSelection.selectedLawRefsAndParameters[${ index }]` );
	const digestInput = clone( selection );
	delete digestInput.selectionDigest;
	assert.equal( selection.selectionDigest, digest( digestInput ), `${ label } material selection digest does not cover its latch` );

}

function validateDeformingAndFluidBoundaryProxies( h, route, bundle ) {

	const descriptors = new Map( bundle.deformationSignalDescriptors.map( ( descriptor ) => [ descriptor.signalId, descriptor ] ) );
	const supportProxies = new Map();
	for ( const [ index, descriptor ] of bundle.deformationSignalDescriptors.entries() ) validateSignalDescriptorClosure( h, route, descriptor, `contactIdentity.deformationSignalDescriptors[${ index }]` );
	for ( const [ index, proxy ] of bundle.deformingSupportProxies.entries() ) {

		const label = `contactIdentity.deformingSupportProxies[${ index }]`;
		h.requireAbiRecord( proxy, 'DeformingSupportProxy', label );
		validateGenerationIdentity( proxy.supportProxyId, 'support', bundle.identityRegistry, `${ label }.supportProxyId` );
		assert.equal( proxy.contextId, route.physicsContext.contextId, `${ label } belongs to another context` );
		const descriptor = descriptors.get( proxy.deformationSignalRef.signalId );
		assert.ok( descriptor, `${ label } deformation signal does not resolve` );
		assert.equal( proxy.deformationSignalRef.descriptorStateVersion, descriptor.stateVersion, `${ label } descriptor ref is stale` );
		assert.equal( proxy.deformationSignalRef.schemaId, descriptor.schemaId, `${ label } descriptor schema does not match` );
		assert.equal( proxy.deformationSignalRef.contextId, descriptor.contextId, `${ label } descriptor context does not match` );
		assert.equal( proxy.deformationStateVersion, descriptor.stateVersion, `${ label } deformation state version is stale` );
		assert.equal( proxy.owner, descriptor.owner, `${ label } owner differs from deformation-state owner` );
		for ( const key of [ 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision' ] ) assert.equal( proxy[ key ], descriptor[ key ], `${ label }.${ key } differs from deformation descriptor` );
		assert.deepEqual( proxy.validityInterval, descriptor.validity.validTime.interval, `${ label } validity differs from deformation descriptor` );
		validateVersionedSampler( proxy.positionSampler, descriptor, proxy.topologyRevision, 'materialPointPositionMeters', `${ label }.positionSampler` );
		validateVersionedSampler( proxy.velocitySampler, descriptor, proxy.topologyRevision, 'materialPointVelocityMps', `${ label }.velocitySampler` );
		assert.match( proxy.velocitySampler.semantics, /material-point-velocity.*rigid-translation-omega-cross-r.*local-deformation/, `${ label } velocity sampler omits part of material-point motion` );
		validateVersionedSampler( proxy.normalAndJacobianSampler, descriptor, proxy.topologyRevision, 'surfaceNormalAndJacobian', `${ label }.normalAndJacobianSampler` );
		assert.deepEqual( proxy.conservativeSweptBounds.sampleInstant, descriptor.validity.validTime.interval.start, `${ label } swept bounds use another instant` );
		assert.deepEqual( proxy.conservativeSweptBounds.interval, descriptor.validity.validTime.interval, `${ label } swept bounds cover another interval` );
		assert.equal( proxy.conservativeSweptBounds.sourceSignalId, descriptor.signalId, `${ label } swept bounds use another signal` );
		assert.equal( proxy.conservativeSweptBounds.sourceStateVersion, proxy.deformationStateVersion, `${ label } swept bounds use stale deformation state` );
		for ( const key of [ 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision' ] ) assert.equal( proxy.conservativeSweptBounds[ key ], descriptor[ key ], `${ label } swept-bounds ${ key } differs from deformation state` );
		assert.equal( proxy.conservativeSweptBounds.topologyRevision, proxy.topologyRevision, `${ label } swept bounds use stale topology` );
		assert.equal( proxy.conservativeSweptBounds.conservative, true, `${ label } swept bounds are not conservative` );
		assert.equal( proxy.topologyChangePolicy, 'versioned-remap-at-boundary', `${ label } topology changes lack a boundary remap` );
		assert.ok( ! isAbsence( proxy.supportFeatureRemap ), `${ label } versioned topology change lacks a feature remap` );
		const remap = proxy.supportFeatureRemap;
		assert.equal( remap.toTopologyRevision, proxy.topologyRevision, `${ label } feature remap targets stale topology` );
		assert.match( remap.contentDigest, /^sha256:/, `${ label } feature remap is not immutable` );
		for ( const [ rowIndex, row ] of remap.mapping.entries() ) {

			validateGenerationIdentity( row.fromFeatureId, 'feature', bundle.identityRegistry, `${ label }.supportFeatureRemap.mapping[${ rowIndex }].fromFeatureId` );
			validateGenerationIdentity( row.toFeatureId, 'feature', bundle.identityRegistry, `${ label }.supportFeatureRemap.mapping[${ rowIndex }].toFeatureId` );
			assert.equal( row.fromFeatureId.stableId, row.toFeatureId.stableId, `${ label } remap row ${ rowIndex } changes stable feature key` );
			assert.ok( row.toFeatureId.generation > row.fromFeatureId.generation, `${ label } remap row ${ rowIndex } reuses a feature without a generation increment` );

		}
		assert.ok( bundle.physicsMaterialRegistry.materials[ idKey( proxy.physicsMaterialId ) ], `${ label } material does not resolve` );
		supportProxies.set( idKey( proxy.supportProxyId ), proxy );

	}
	for ( const [ index, boundary ] of bundle.fluidBoundaryProxies.entries() ) {

		const label = `contactIdentity.fluidBoundaryProxies[${ index }]`;
		h.requireAbiRecord( boundary, 'FluidBoundaryProxy', label );
		validateGenerationIdentity( boundary.fluidBoundaryProxyId, 'support', bundle.identityRegistry, `${ label }.fluidBoundaryProxyId` );
		assert.equal( boundary.contextId, route.physicsContext.contextId, `${ label } belongs to another context` );
		const support = supportProxies.get( idKey( boundary.supportGeometryRef.supportProxyId ) );
		assert.ok( support, `${ label } support geometry does not resolve` );
		assert.equal( boundary.owner, support.owner, `${ label } boundary state has another owner` );
		for ( const key of [ 'physicsFrameId', 'physicsOriginEpoch', 'transformRevision', 'validityInterval' ] ) assert.deepEqual( boundary[ key ], support[ key ], `${ label }.${ key } differs from support proxy` );
		assert.equal( boundary.supportGeometryRef.topologyRevision, support.topologyRevision, `${ label } support geometry topology is stale` );
		assert.equal( boundary.supportGeometryRef.deformationStateVersion, support.deformationStateVersion, `${ label } support geometry state is stale` );
		assert.equal( boundary.geometryStateVersion, support.deformationStateVersion, `${ label } boundary geometry state is stale` );
		const supportDescriptor = descriptors.get( support.deformationSignalRef.signalId );
		assert.ok( supportDescriptor, `${ label } support deformation descriptor does not resolve` );
		validateVersionedSampler( boundary.positionSampler, supportDescriptor, support.topologyRevision, 'materialPointPositionMeters', `${ label }.positionSampler` );
		validateVersionedSampler( boundary.materialVelocitySampler, supportDescriptor, support.topologyRevision, 'materialPointVelocityMps', `${ label }.materialVelocitySampler` );
		assert.match( boundary.materialVelocitySampler.semantics, /material-point-velocity/, `${ label } has no material-point velocity boundary channel` );
		assert.doesNotMatch( boundary.materialVelocitySampler.semantics, /coordinate-rate-only/, `${ label } substitutes coordinate rate for physical material velocity` );
		validateVersionedSampler( boundary.normalAndMeasureSampler, supportDescriptor, support.topologyRevision, 'surfaceNormalAndJacobian', `${ label }.normalAndMeasureSampler` );
		assert.deepEqual( boundary.conservativeSweptBounds, support.conservativeSweptBounds, `${ label } and support disagree on conservative swept bounds` );
		h.requireAbiRecord( boundary.boundaryCondition, 'BoundaryConditionDescriptor', `${ label }.boundaryCondition` );
		const condition = boundary.boundaryCondition;
		nonempty( condition.descriptorVersion, `${ label }.boundaryCondition.descriptorVersion` );
		assert.match( condition.descriptorVersion, /-v\d+$/, `${ label } boundary condition is not versioned` );
		if ( ! isAbsence( condition.roughnessAndPermeabilityLawRef ) ) validateVersionedLaw( condition.roughnessAndPermeabilityLawRef, `${ label }.boundaryCondition.roughnessAndPermeabilityLawRef` );
		if ( ! isAbsence( condition.wetDryActivationRule ) ) validateVersionedLaw( condition.wetDryActivationRule, `${ label }.boundaryCondition.wetDryActivationRule` );
		assert.equal( condition.compatibilityAndStabilityGate.compatible, true, `${ label } boundary compatibility/stability gate failed` );
		assert.equal( condition.twoWayReactionPolicy, 'required', `${ label } fixture must publish a two-way reaction` );
		assert.deepEqual( boundary.updateCadence, supportDescriptor.cadence, `${ label } update cadence differs from deformation-state authority` );
		validateBoundaryMaterialSelection( h, route, bundle, boundary, label );
		assert.equal( boundary.topologyRevisionAndRemap.topologyRevision, support.topologyRevision, `${ label } topology revision is stale` );
		assert.equal( boundary.topologyRevisionAndRemap.remapVersion, support.supportFeatureRemap.remapVersion, `${ label } feature remap version is stale` );
		assert.equal( boundary.topologyRevisionAndRemap.featureRemapDigest, support.supportFeatureRemap.contentDigest, `${ label } feature remap digest is stale` );
		assert.ok( sameIdentity( boundary.topologyRevisionAndRemap.supportProxyId, support.supportProxyId ), `${ label } topology remap belongs to another support` );

	}

}

export function validateContactIdentityBundle( h, route, bundle ) {

	helperInterface( h, true );
	assert.ok( bundle !== null && typeof bundle === 'object', 'contact/identity bundle must be a mapping' );
	validateIdentityRegistryAndProofs( h, bundle );
	validateMaterials( h, route, bundle );
	validateRigidBodies( h, route, bundle );
	validateContacts( h, route, bundle );
	validateHydrostatics( h, route, bundle );
	validateDeformingAndFluidBoundaryProxies( h, route, bundle );
	return bundle;

}

function mutate( bundle, mutation ) {

	const copy = clone( bundle );
	mutation( copy );
	return copy;

}

export const contactIdentityRejectMutations = Object.freeze( {
	'slot-used-as-id': ( bundle ) => mutate( bundle, ( copy ) => { copy.colliderProxies[ 0 ].colliderId = 17; } ),
	'recycle-without-generation': ( bundle ) => mutate( bundle, ( copy ) => { copy.identityReallocationProofs[ 0 ].currentIdentity.generation = copy.identityReallocationProofs[ 0 ].retiredIdentity.generation; } ),
	'unversioned-material-law': ( bundle ) => mutate( bundle, ( copy ) => { copy.physicsMaterialRegistry.materials[ Object.keys( copy.physicsMaterialRegistry.materials )[ 0 ] ].contactLaw.lawVersion = 'latest'; } ),
	'non-positive-material-density': ( bundle ) => mutate( bundle, ( copy ) => { copy.physicsMaterialRegistry.materials[ Object.keys( copy.physicsMaterialRegistry.materials )[ 0 ] ].densityKgPerM3.value = 0; } ),
	'collider-pose-version-mismatch': ( bundle ) => mutate( bundle, ( copy ) => { copy.colliderProxies[ 0 ].poseStateVersion = 'stale-pose-v41'; } ),
	'non-positive-rigid-mass': ( bundle ) => mutate( bundle, ( copy ) => { copy.rigidBodyProperties[ 0 ].massKg.value = 0; } ),
	'non-psd-rigid-inertia': ( bundle ) => mutate( bundle, ( copy ) => { copy.rigidBodyProperties[ 0 ].inertiaTensorBodyKgM2.value[ 0 ] = - 1; } ),
	'improper-rigid-rotation': ( bundle ) => mutate( bundle, ( copy ) => { copy.rigidBodyStates[ 0 ].bodyToPhysicsRotation.value[ 3 ] = 0.5; } ),
	'twist-reference-point-mismatch': ( bundle ) => mutate( bundle, ( copy ) => { copy.rigidBodyStates[ 0 ].twist.referencePoint.pointMeters[ 0 ] += 1; } ),
	'material-pair-order-mismatch': ( bundle ) => mutate( bundle, ( copy ) => { copy.contactManifoldRecords[ 0 ].materialPairSelection.orderedPhysicsMaterialIds.reverse(); } ),
	'material-pair-not-latched': ( bundle ) => mutate( bundle, ( copy ) => { copy.contactManifoldRecords[ 0 ].materialPairSelection.latching = 'mutable'; } ),
	'structural-contact-normal-convention-mismatch': ( bundle ) => mutate( bundle, ( copy ) => { copy.contactManifoldRecords[ 0 ].normalConvention = 'B-to-A'; } ),
	'contact-tangent-basis-not-orthonormal': ( bundle ) => mutate( bundle, ( copy ) => { copy.contactManifoldRecords[ 0 ].manifoldPatch.tangentBasis.tangentV = [ 1, 0, 0 ]; } ),
	'contact-patch-area-mismatch': ( bundle ) => mutate( bundle, ( copy ) => { copy.contactManifoldRecords[ 0 ].manifoldPatch.patchAreaM2.value *= 2; } ),
	'contact-relative-point-velocity-not-derived': ( bundle ) => mutate( bundle, ( copy ) => { copy.contactManifoldRecords[ 0 ].relativePointVelocityMps[ 0 ].valueMps[ 0 ] += 0.25; } ),
	'unresolved-contact-interaction': ( bundle ) => mutate( bundle, ( copy ) => { copy.contactManifoldRecords[ 0 ].emittedInteractionIds[ 0 ] = 'interaction-namespace-v1/unresolved-contact@g9'; copy.contactManifoldRecords[ 0 ].materialPairSelection.interactionId = 'interaction-namespace-v1/unresolved-contact@g9'; } ),
	'contact-warm-start-owner-mismatch': ( bundle ) => mutate( bundle, ( copy ) => { copy.contactManifoldRecords[ 0 ].warmStartImpulses.owner = 'geometry-provider'; } ),
	'duplicate-contact-owner': ( bundle ) => mutate( bundle, ( copy ) => { copy.contactOwnership.emittedImpulseOwner = 'support-sampler'; } ),
	'route-material-registry-sidecar': ( bundle ) => mutate( bundle, ( copy ) => { copy.physicsMaterialRegistry.registryVersion = 'materials-v6-sidecar'; } ),
	'non-watertight-hydro-hull': ( bundle ) => mutate( bundle, ( copy ) => { copy.hydrostaticHullProperties[ 0 ].displacedVolumeQuery.geometryEligibilityGate.boundaryEdgeCount = 2; } ),
	'hull-drag-uses-surface-point-velocity': ( bundle ) => mutate( bundle, ( copy ) => { copy.hydrostaticHullProperties[ 0 ].dragModel.parameters.fluidVelocityChannel = 'surfacePointVelocityMps'; } ),
	'hydrostatic-water-state-version-stale': ( bundle ) => mutate( bundle, ( copy ) => { copy.hydrostaticHullProperties[ 0 ].displacedVolumeQuery.waterStateVersion = 'water-stale-v40'; } ),
	'missing-velocity': ( bundle ) => mutate( bundle, ( copy ) => { copy.deformingSupportProxies[ 0 ].velocitySampler = clone( copy.fluidBoundaryProxies[ 0 ].boundaryCondition.thermalCondition ); } ),
	'sampler-instant-stale': ( bundle ) => mutate( bundle, ( copy ) => { copy.deformingSupportProxies[ 0 ].positionSampler.sampleInstant = clone( copy.deformingSupportProxies[ 0 ].validityInterval.endExclusive ); } ),
	'stale-remap': ( bundle ) => mutate( bundle, ( copy ) => { copy.deformingSupportProxies[ 0 ].supportFeatureRemap.toTopologyRevision = 'vessel-deforming-topology-v8'; } ),
	'unlatched-material-selection': ( bundle ) => mutate( bundle, ( copy ) => { copy.fluidBoundaryProxies[ 0 ].physicsMaterialSelection.latching = 'mutable-within-interval'; } )
} );

export const buildContactIdentityFixtures = buildContactIdentityBundle;
export const validateContactIdentityFixtures = validateContactIdentityBundle;
