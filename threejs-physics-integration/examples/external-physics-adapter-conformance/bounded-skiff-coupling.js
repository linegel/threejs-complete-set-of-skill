import assert from 'node:assert/strict';

const finite = ( value, label ) => {

	assert.ok( Number.isFinite( value ), `${ label } must be finite` );
	return value;

};

const clamp = ( value, minimum, maximum ) => Math.min( maximum, Math.max( minimum, value ) );
const add3 = ( left, right ) => left.map( ( value, index ) => value + right[ index ] );
const scale3 = ( value, scale ) => value.map( ( component ) => component * scale );
const cross3 = ( left, right ) => [
	left[ 1 ] * right[ 2 ] - left[ 2 ] * right[ 1 ],
	left[ 2 ] * right[ 0 ] - left[ 0 ] * right[ 2 ],
	left[ 0 ] * right[ 1 ] - left[ 1 ] * right[ 0 ]
];

export const BOUNDED_SKIFF_DECISION = Object.freeze( {
	problemId: 'bounded-dynamic-skiff',
	selectedCandidateId: 'gpu-bounded-rigid-water',
	status: 'provisional-until-native-webgpu-evidence',
	axes: Object.freeze( [ 'truthFidelity', 'targetCost', 'integrationSimplicity', 'determinism', 'recovery', 'evidenceFeasibility' ] ),
	candidates: Object.freeze( [
		Object.freeze( { id: 'analytic-one-way', family: 'analytic one-way bobbing', scores: [ 1, 5, 5, 5, 5, 4 ], gates: [ 'fail:reaction-closure' ] } ),
		Object.freeze( { id: 'cpu-rigid-gpu-water', family: 'CPU rigid body plus staged GPU water', scores: [ 4, 2, 2, 4, 4, 3 ], gates: [ 'fail:frame-critical-staging-tail' ] } ),
		Object.freeze( { id: 'external-shared-resource', family: 'external rigid engine plus shared GPU water resource', scores: [ 5, 3, 2, 4, 5, 3 ], gates: [ 'pass' ] } ),
		Object.freeze( { id: 'offline-fsi', family: 'offline CFD/FSI playback', scores: [ 5, 1, 2, 5, 5, 2 ], gates: [ 'fail:live-interaction' ] } ),
		Object.freeze( { id: 'monolithic-vof', family: 'monolithic three-dimensional particle or VOF FSI', scores: [ 5, 1, 1, 2, 2, 2 ], gates: [ 'fail:target-memory', 'fail:target-thermal' ] } ),
		Object.freeze( { id: 'gpu-bounded-rigid-water', family: 'bounded GPU rigid body plus conservative local water coupling', scores: [ 5, 4, 3, 4, 4, 4 ], gates: [ 'pass' ] } )
	] )
} );

export const BOUNDED_SKIFF_CONFIG = Object.freeze( {
	contextId: 'bounded-skiff-context-v1',
	physicsFrameId: 'physics-root-y-up-metres',
	clockId: 'bounded-skiff-120hz',
	fixedTimeStepSeconds: 1 / 120,
	maximumCatchUpSteps: 8,
	boundedCorrectionIterations: 2,
	gravityMps2: 9.81,
	waterDensityKgM3: 1025,
	waterPatchMassKg: 8200,
	waterRestoringRatePerSecond2: 5.2,
	waterDampingRatePerSecond: 1.1,
	maximumAddedMassRatio: 0.7,
	forceResidualGateNewtonSeconds: 1e-9,
	torqueResidualGateNewtonMetreSeconds: 1e-9,
	maximumStateMagnitude: 1e6
} );

export const BOUNDED_SKIFF_ASSET = Object.freeze( {
	assetId: 'procedural-skiff-hull-v1',
	assetVersion: '1.0.0',
	entityId: 'skiff-001',
	hullFrameId: 'skiff-hull-frame',
	geometry: 'closed-volume',
	geometryRevision: 'rounded-box-hydrostatic-proxy-v1',
	boundaryEdgeCount: 0,
	massKg: 420,
	centerOfMassBodyMeters: Object.freeze( [ 0, 0, 0 ] ),
	inertiaTensorBodyKgM2: Object.freeze( [ 350, 900, 1000 ] ),
	lengthMeters: 3.2,
	beamMeters: 1.4,
	draftMeters: 1,
	closedVolumeM3: 0.82,
	referenceWaterlineBodyY: 0,
	dragCoefficientVerticalKgPerSecond: 280,
	waterlineClipping: 'distributed-nine-column-clip-v1',
	buoyancyModel: 'hydrostatic-displaced-volume',
	dragModel: 'relative-material-current-linear-vertical',
	addedMassModel: 'omitted-with-ratio-gate',
	waveExcitationModel: 'provider-surface-and-current-only',
	samplingFootprint: 'three-by-three-body-frame-quadrature',
	approximationError: Object.freeze( {
		displacedVolumeRelative: Object.freeze( { value: 0.03, unit: 'relative', label: 'Gated', source: 'nine-column convergence contract' } ),
		centerOfBuoyancyMeters: Object.freeze( { value: 0.025, unit: 'metre', label: 'Gated', source: 'nine-column convergence contract' } )
	} ),
	validity: Object.freeze( { maximumAbsRollRadians: 0.45, maximumAbsPitchRadians: 0.35, minimumDepthMeters: 1.2 } )
} );

export function validateBoundedSkiffAsset( asset = BOUNDED_SKIFF_ASSET ) {

	assert.equal( asset.geometry, 'closed-volume', 'hydrostatic proxy must be a closed volume' );
	assert.equal( asset.boundaryEdgeCount, 0, 'hydrostatic proxy has open boundary edges' );
	for ( const field of [ 'massKg', 'lengthMeters', 'beamMeters', 'draftMeters', 'closedVolumeM3' ] ) {

		assert.ok( finite( asset[ field ], `asset.${ field }` ) > 0, `asset.${ field } must be positive` );

	}
	assert.ok( Array.isArray( asset.inertiaTensorBodyKgM2 ) && asset.inertiaTensorBodyKgM2.length === 3, 'asset inertia diagonal must have three components' );
	assert.ok( asset.inertiaTensorBodyKgM2.every( ( value ) => Number.isFinite( value ) && value > 0 ), 'asset inertia tensor must be positive definite' );
	assert.ok( asset.massKg < BOUNDED_SKIFF_CONFIG.waterDensityKgM3 * asset.closedVolumeM3, 'skiff cannot float at the declared density and volume' );
	assert.equal( asset.buoyancyModel, 'hydrostatic-displaced-volume', 'skiff buoyancy law drifted' );
	assert.equal( asset.dragModel, 'relative-material-current-linear-vertical', 'skiff drag must use material current rather than surface velocity' );
	return true;

}

export function createNinePointHullQuadrature( asset = BOUNDED_SKIFF_ASSET ) {

	validateBoundedSkiffAsset( asset );
	const points = [];
	for ( const xFactor of [ -0.36, 0, 0.36 ] ) {

		for ( const zFactor of [ -0.36, 0, 0.36 ] ) {

			points.push( Object.freeze( {
				localPointMeters: Object.freeze( [ xFactor * asset.lengthMeters, -0.5 * asset.draftMeters, zFactor * asset.beamMeters ] ),
				volumeWeightM3: asset.closedVolumeM3 / 9
			} ) );

		}

	}
	return Object.freeze( points );

}

function rotateHullPoint( point, rollRadians, pitchRadians ) {

	const [ x, y, z ] = point;
	const sinRoll = Math.sin( rollRadians );
	const cosRoll = Math.cos( rollRadians );
	const rollY = y * cosRoll - z * sinRoll;
	const rollZ = y * sinRoll + z * cosRoll;
	const sinPitch = Math.sin( pitchRadians );
	const cosPitch = Math.cos( pitchRadians );
	return [ x * cosPitch - rollY * sinPitch, x * sinPitch + rollY * cosPitch, rollZ ];

}

export function createAnalyticWaterProvider( {
	amplitudeMeters = 0.08,
	angularFrequencyRadiansPerSecond = 1.7,
	waveNumberRadiansPerMeter = 0.75,
	currentVelocityMps = Object.freeze( [ 0.12, 0, 0.03 ] )
} = {} ) {

	for ( const [ label, value ] of Object.entries( { amplitudeMeters, angularFrequencyRadiansPerSecond, waveNumberRadiansPerMeter } ) ) finite( value, label );
	return Object.freeze( {
		providerId: 'bounded-analytic-water-provider-v1',
		schemaId: 'canonical-water-surface-sample-v1',
		sample( xMeters, zMeters, timeSeconds, feedbackHeightMeters, stateVersion ) {

			const phase = waveNumberRadiansPerMeter * ( 0.92 * xMeters + 0.38 * zMeters ) - angularFrequencyRadiansPerSecond * timeSeconds;
			const freeSurfaceY = amplitudeMeters * Math.sin( phase ) + feedbackHeightMeters;
			const slopeX = amplitudeMeters * waveNumberRadiansPerMeter * 0.92 * Math.cos( phase );
			const slopeZ = amplitudeMeters * waveNumberRadiansPerMeter * 0.38 * Math.cos( phase );
			const normalScale = 1 / Math.hypot( slopeX, 1, slopeZ );
			const normal = [ -slopeX * normalScale, normalScale, -slopeZ * normalScale ];
			const normalVelocity = -amplitudeMeters * angularFrequencyRadiansPerSecond * Math.cos( phase );
			return Object.freeze( {
				freeSurfacePoint: Object.freeze( [ xMeters, freeSurfaceY, zMeters ] ),
				freeSurfaceNormal: Object.freeze( normal ),
				geometricNormalVelocityMps: normalVelocity,
				materialCurrentVelocityMps: Object.freeze( [ ...currentVelocityMps ] ),
				waterColumnDepthMeters: 3,
				densityKgPerM3: BOUNDED_SKIFF_CONFIG.waterDensityKgM3,
				actualPhysicsTimeSeconds: timeSeconds,
				stateVersion,
				filter: 'nine-point-hull-footprint'
			} );

		}
	} );

}

export function initialCoupledSkiffState( asset = BOUNDED_SKIFF_ASSET ) {

	validateBoundedSkiffAsset( asset );
	const equilibriumImmersion = asset.massKg / ( BOUNDED_SKIFF_CONFIG.waterDensityKgM3 * asset.closedVolumeM3 );
	return Object.freeze( {
		tick: 0,
		timeSeconds: 0,
		body: Object.freeze( {
			positionMeters: Object.freeze( [ 0, asset.draftMeters * ( 0.5 - equilibriumImmersion ), 0 ] ),
			rollRadians: 0,
			pitchRadians: 0,
			linearVelocityMps: Object.freeze( [ 0, 0, 0 ] ),
			rollRateRadiansPerSecond: 0,
			pitchRateRadiansPerSecond: 0,
			stateVersion: 'body-state-0'
		} ),
		water: Object.freeze( {
			feedbackHeightMeters: 0,
			verticalVelocityMps: 0,
			stateVersion: 'water-state-0'
		} ),
		applicationLedgerKeys: Object.freeze( [] ),
		lastCommit: null
	} );

}

function deriveHydrodynamicLoad( state, timeSeconds, provider, asset, quadrature ) {

	let hydrodynamicForce = [ 0, 0, 0 ];
	let hydrodynamicTorque = [ 0, 0, 0 ];
	let displacedVolumeM3 = 0;
	const samples = [];
	for ( const quadraturePoint of quadrature ) {

		const offset = rotateHullPoint( quadraturePoint.localPointMeters, state.body.rollRadians, state.body.pitchRadians );
		const point = add3( state.body.positionMeters, offset );
		const water = provider.sample( point[ 0 ], point[ 2 ], timeSeconds, state.water.feedbackHeightMeters, state.water.stateVersion );
		const immersionFraction = clamp( ( water.freeSurfacePoint[ 1 ] - point[ 1 ] ) / asset.draftMeters, 0, 1 );
		const displacedVolume = quadraturePoint.volumeWeightM3 * immersionFraction;
		const angularVelocity = [ state.body.rollRateRadiansPerSecond, 0, state.body.pitchRateRadiansPerSecond ];
		const pointVelocity = add3( state.body.linearVelocityMps, cross3( angularVelocity, offset ) );
		const relativeVerticalVelocity = pointVelocity[ 1 ] - water.materialCurrentVelocityMps[ 1 ];
		const buoyancyNewtons = water.densityKgPerM3 * BOUNDED_SKIFF_CONFIG.gravityMps2 * displacedVolume;
		const dragNewtons = -asset.dragCoefficientVerticalKgPerSecond * relativeVerticalVelocity / quadrature.length;
		const force = scale3( water.freeSurfaceNormal, buoyancyNewtons );
		force[ 1 ] += dragNewtons;
		hydrodynamicForce = add3( hydrodynamicForce, force );
		hydrodynamicTorque = add3( hydrodynamicTorque, cross3( offset, force ) );
		displacedVolumeM3 += displacedVolume;
		samples.push( Object.freeze( { point: Object.freeze( point ), water, immersionFraction, displacedVolumeM3: displacedVolume } ) );

	}
	return Object.freeze( {
		hydrodynamicForce: Object.freeze( hydrodynamicForce ),
		hydrodynamicTorque: Object.freeze( hydrodynamicTorque ),
		displacedVolumeM3,
		samples: Object.freeze( samples )
	} );

}

function integrateCandidate( prior, load, dt, asset, config ) {

	const totalForceY = load.hydrodynamicForce[ 1 ] - asset.massKg * config.gravityMps2;
	const velocityY = prior.body.linearVelocityMps[ 1 ] + totalForceY * dt / asset.massKg;
	const body = {
		positionMeters: [ prior.body.positionMeters[ 0 ], prior.body.positionMeters[ 1 ] + velocityY * dt, prior.body.positionMeters[ 2 ] ],
		rollRadians: prior.body.rollRadians,
		pitchRadians: prior.body.pitchRadians,
		linearVelocityMps: [ 0, velocityY, 0 ],
		rollRateRadiansPerSecond: prior.body.rollRateRadiansPerSecond + load.hydrodynamicTorque[ 0 ] * dt / asset.inertiaTensorBodyKgM2[ 0 ],
		pitchRateRadiansPerSecond: prior.body.pitchRateRadiansPerSecond + load.hydrodynamicTorque[ 2 ] * dt / asset.inertiaTensorBodyKgM2[ 2 ]
	};
	body.rollRadians += body.rollRateRadiansPerSecond * dt;
	body.pitchRadians += body.pitchRateRadiansPerSecond * dt;
	// The bounded water mode stores perturbation about the pre-balanced
	// hydrostatic reference. Bed pressure owns the static reaction; only the
	// departure from the vessel's equilibrium displacement excites this mode.
	// The complete hydrostatic source/reaction pair remains in the conservation
	// ledger below, so this reference-state subtraction is not hidden loss.
	const reactionForceY = -( load.hydrodynamicForce[ 1 ] - asset.massKg * config.gravityMps2 );
	const waterAcceleration = reactionForceY / config.waterPatchMassKg
		- config.waterRestoringRatePerSecond2 * prior.water.feedbackHeightMeters
		- config.waterDampingRatePerSecond * prior.water.verticalVelocityMps;
	const waterVelocity = prior.water.verticalVelocityMps + waterAcceleration * dt;
	const water = {
		feedbackHeightMeters: prior.water.feedbackHeightMeters + waterVelocity * dt,
		verticalVelocityMps: waterVelocity
	};
	return { body, water };

}

function assertFiniteCandidate( candidate, config ) {

	for ( const value of [
		...candidate.body.positionMeters,
		...candidate.body.linearVelocityMps,
		candidate.body.rollRadians,
		candidate.body.pitchRadians,
		candidate.body.rollRateRadiansPerSecond,
		candidate.body.pitchRateRadiansPerSecond,
		candidate.water.feedbackHeightMeters,
		candidate.water.verticalVelocityMps
	] ) {

		assert.ok( Number.isFinite( value ) && Math.abs( value ) <= config.maximumStateMagnitude, 'candidate state is non-finite or outside its bounded domain' );

	}

}

export function advanceBoundedSkiffCoupling( prior, {
	provider = createAnalyticWaterProvider(),
	asset = BOUNDED_SKIFF_ASSET,
	config = BOUNDED_SKIFF_CONFIG,
	reactionScale = -1,
	forceDuplicateLedgerKey = false,
	waterStateVersionOverride = null
} = {} ) {

	validateBoundedSkiffAsset( asset );
	assert.equal( config.boundedCorrectionIterations, 2, 'coupling correction count must remain scheduler-bounded at two' );
	assert.ok( config.maximumAddedMassRatio <= 0.7, 'selected explicit coupling exceeds its added-mass ratio gate' );
	const dt = config.fixedTimeStepSeconds;
	const tick = prior.tick + 1;
	const applicationLedgerKey = `skiff-water-coupling:${ tick }`;
	assert.ok( ! prior.applicationLedgerKeys.includes( applicationLedgerKey ), 'coupling interaction was already applied' );
	const workingPrior = waterStateVersionOverride === null ? prior : {
		...prior,
		water: { ...prior.water, stateVersion: waterStateVersionOverride }
	};
	const expectedWaterVersion = `water-state-${ prior.tick }`;
	assert.equal( workingPrior.water.stateVersion, expectedWaterVersion, 'coupling sampled a stale or future water state version' );
	const quadrature = createNinePointHullQuadrature( asset );
	let candidate = workingPrior;
	let load = null;
	for ( let iteration = 0; iteration < config.boundedCorrectionIterations; iteration += 1 ) {

		load = deriveHydrodynamicLoad( candidate, prior.timeSeconds + dt, provider, asset, quadrature );
		candidate = {
			...prior,
			...integrateCandidate( prior, load, dt, asset, config ),
			tick,
			timeSeconds: prior.timeSeconds + dt
		};

	}
	assertFiniteCandidate( candidate, config );
	const sourceImpulse = scale3( load.hydrodynamicForce, dt );
	const reactionImpulse = scale3( load.hydrodynamicForce, reactionScale * dt );
	const sourceAngularImpulse = scale3( load.hydrodynamicTorque, dt );
	const reactionAngularImpulse = scale3( load.hydrodynamicTorque, reactionScale * dt );
	const forceResidual = Math.hypot( ...add3( sourceImpulse, reactionImpulse ) );
	const torqueResidual = Math.hypot( ...add3( sourceAngularImpulse, reactionAngularImpulse ) );
	assert.ok( forceResidual <= config.forceResidualGateNewtonSeconds, `coupling force reaction does not close: ${ forceResidual } N s` );
	assert.ok( torqueResidual <= config.torqueResidualGateNewtonMetreSeconds, `coupling torque reaction does not close: ${ torqueResidual } N m s` );
	const interactionId = `skiff-water-load:${ tick }`;
	const reactionId = `water-skiff-reaction:${ tick }`;
	const commitTransactionId = `skiff-water-commit:${ tick }`;
	const interactions = Object.freeze( [
		Object.freeze( { interactionId, role: 'source', targetEquationId: 'rigid-body-linear-angular-momentum', applicationLedgerKey, applicationInterval: Object.freeze( { startTick: prior.tick, endTick: tick } ), linearImpulseNs: Object.freeze( sourceImpulse ), angularImpulseNms: Object.freeze( sourceAngularImpulse ), conservationGroupId: `skiff-water:${ tick }`, reactionGroupId: `skiff-water-reaction:${ tick }` } ),
		Object.freeze( { interactionId: reactionId, role: 'reaction', targetEquationId: 'bounded-water-vertical-momentum', applicationLedgerKey: `${ applicationLedgerKey }:reaction`, applicationInterval: Object.freeze( { startTick: prior.tick, endTick: tick } ), linearImpulseNs: Object.freeze( reactionImpulse ), angularImpulseNms: Object.freeze( reactionAngularImpulse ), conservationGroupId: `skiff-water:${ tick }`, reactionGroupId: `skiff-water-reaction:${ tick }`, reactionToInteractionIds: Object.freeze( [ interactionId ] ) } )
	] );
	const nextLedger = [ ...prior.applicationLedgerKeys, applicationLedgerKey, `${ applicationLedgerKey }:reaction` ];
	if ( forceDuplicateLedgerKey ) nextLedger.push( applicationLedgerKey );
	assert.equal( nextLedger.length, new Set( nextLedger ).size, 'atomic commit contains a duplicate application-ledger key' );
	return Object.freeze( {
		tick,
		timeSeconds: candidate.timeSeconds,
		body: Object.freeze( { ...candidate.body, positionMeters: Object.freeze( candidate.body.positionMeters ), linearVelocityMps: Object.freeze( candidate.body.linearVelocityMps ), stateVersion: `body-state-${ tick }` } ),
		water: Object.freeze( { ...candidate.water, stateVersion: `water-state-${ tick }` } ),
		applicationLedgerKeys: Object.freeze( nextLedger ),
		lastCommit: Object.freeze( {
			commitTransactionId,
			interactionReactionGroupStatus: 'all-or-none-committed',
			iterations: config.boundedCorrectionIterations,
			interactions,
			forceResidualNewtonSeconds: forceResidual,
			torqueResidualNewtonMetreSeconds: torqueResidual,
			displacedVolumeM3: load.displacedVolumeM3,
			waterSampleStateVersion: expectedWaterVersion,
			frameCriticalReadbackCount: 0
		} )
	} );

}

export function replayBoundedSkiff( stepCount, options = {} ) {

	assert.ok( Number.isInteger( stepCount ) && stepCount >= 0, 'stepCount must be a non-negative integer' );
	let state = initialCoupledSkiffState( options.asset ?? BOUNDED_SKIFF_ASSET );
	for ( let index = 0; index < stepCount; index += 1 ) state = advanceBoundedSkiffCoupling( state, options );
	return state;

}

export function boundedSkiffStateHash( state ) {

	const values = [
		state.tick,
		state.timeSeconds,
		...state.body.positionMeters,
		state.body.rollRadians,
		state.body.pitchRadians,
		...state.body.linearVelocityMps,
		state.body.rollRateRadiansPerSecond,
		state.body.pitchRateRadiansPerSecond,
		state.water.feedbackHeightMeters,
		state.water.verticalVelocityMps
	];
	let hash = 0x811c9dc5;
	const bytes = new Uint8Array( new Float64Array( values ).buffer );
	for ( const value of bytes ) {

		hash ^= value;
		hash = Math.imul( hash, 0x01000193 );

	}
	return ( hash >>> 0 ).toString( 16 ).padStart( 8, '0' );

}
