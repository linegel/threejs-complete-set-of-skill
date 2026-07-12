export const OFFSHORE_BOUNDARY_DECISION = Object.freeze( {
	problemId: 'phase-resolved-offshore-nearshore-handoff',
	axes: Object.freeze( [ 'phaseParity', 'outgoingPreservation', 'dimensionalTruth', 'reflectionControl', 'mobileCost' ] ),
	selectedCandidateId: 'incoming-characteristic-injection',
	candidates: Object.freeze( [
		Object.freeze( { id: 'elevation-dirichlet', family: 'strong elevation-only Dirichlet boundary', scores: [ 4, 1, 2, 1, 5 ], hardGate: 'fail:missing-discharge-and-outgoing-characteristic' } ),
		Object.freeze( { id: 'copied-fft-ghosts', family: 'copy offshore FFT elevation and displacement into coastal ghosts', scores: [ 4, 1, 1, 1, 4 ], hardGate: 'fail:choppy-displacement-is-not-wave-discharge' } ),
		Object.freeze( { id: 'relaxation-wavemaker', family: 'interior relaxation-zone wavemaker', scores: [ 4, 3, 4, 3, 2 ], hardGate: 'fail:unnecessary-active-domain-and-calibration-cost' } ),
		Object.freeze( { id: 'phase-averaged-action', family: 'wave-action boundary with local phase synthesis', scores: [ 1, 4, 5, 4, 4 ], hardGate: 'fail:instantaneous-phase-contract' } ),
		Object.freeze( { id: 'two-way-modal-projection', family: 'bidirectional coastal-to-periodic modal projection', scores: [ 5, 5, 4, 5, 1 ], hardGate: 'fail:unrequired-offshore-reflection-ownership' } ),
		Object.freeze( { id: 'incoming-characteristic-injection', family: 'Airy elevation/discharge mapped to incoming SWE characteristic', scores: [ 5, 5, 5, 5, 5 ], hardGate: 'pass' } )
	] )
} );

function requireFinite( value, label ) {

	if ( ! Number.isFinite( value ) ) throw new Error( `${ label } must be finite` );
	return value;

}

function requireVector2( value, label ) {

	if ( ! Array.isArray( value ) || value.length !== 2 || value.some( ( component ) => ! Number.isFinite( component ) ) ) throw new Error( `${ label } must be a finite two-vector` );
	return Object.freeze( [ value[ 0 ], value[ 1 ] ] );

}

function gcd( a, b ) {

	a = Math.abs( a );
	b = Math.abs( b );
	while ( b !== 0 ) [ a, b ] = [ b, a % b ];
	return a;

}

export function validateBoundaryPhysicsInstant( instant, label = 'phaseReferenceInstant' ) {

	if ( instant?.recordType !== 'PhysicsInstant' ) throw new Error( `${ label } must be a PhysicsInstant` );
	if ( typeof instant.clockId !== 'string' || instant.clockId.length === 0 ) throw new Error( `${ label }.clockId must be nonempty` );
	if ( ! Number.isSafeInteger( instant.tick ) ) throw new Error( `${ label }.tick must be a safe integer` );
	const numerator = instant.rationalSubstep?.numerator;
	const denominator = instant.rationalSubstep?.denominator;
	if ( ! Number.isSafeInteger( numerator ) || ! Number.isSafeInteger( denominator ) || denominator <= 0 || numerator < 0 || numerator >= denominator || gcd( numerator, denominator ) !== 1 ) throw new Error( `${ label }.rationalSubstep is not canonical` );
	if ( typeof instant.clockMappingRevision !== 'string' || instant.clockMappingRevision.length === 0 ) throw new Error( `${ label }.clockMappingRevision must be nonempty` );
	if ( typeof instant.discontinuityEpoch !== 'string' || instant.discontinuityEpoch.length === 0 ) throw new Error( `${ label }.discontinuityEpoch must be nonempty` );
	if ( instant.timeSecondsDerived?.unit !== 's' || instant.timeSecondsDerived?.label !== 'Derived' ) throw new Error( `${ label }.timeSecondsDerived must be a Derived second quantity` );
	requireFinite( instant.timeSecondsDerived.value, `${ label }.timeSecondsDerived.value` );
	return true;

}

function instantSeconds( instant, label ) {

	validateBoundaryPhysicsInstant( instant, label );
	return instant.timeSecondsDerived.value;

}

export function finiteDepthAngularFrequency( {
	wavenumberRadPerMeter,
	depthMeters,
	gravityMps2 = 9.80665,
	surfaceTensionNpm = 0,
	densityKgPerM3 = 1025
} ) {

	const k = requireFinite( wavenumberRadPerMeter, 'wavenumberRadPerMeter' );
	const depth = requireFinite( depthMeters, 'depthMeters' );
	const gravity = requireFinite( gravityMps2, 'gravityMps2' );
	const tension = requireFinite( surfaceTensionNpm, 'surfaceTensionNpm' );
	const density = requireFinite( densityKgPerM3, 'densityKgPerM3' );
	if ( k <= 0 || depth <= 0 || gravity <= 0 || tension < 0 || density <= 0 ) throw new Error( 'finite-depth dispersion inputs lie outside their physical domain' );
	return Math.sqrt( ( gravity * k + tension / density * k ** 3 ) * Math.tanh( k * depth ) );

}

function validateMode( mode, environment, index ) {

	const waveVector = requireVector2( mode?.waveVectorRadPerMeter, `modes[${ index }].waveVectorRadPerMeter` );
	const k = Math.hypot( waveVector[ 0 ], waveVector[ 1 ] );
	if ( k <= 0 ) throw new Error( `modes[${ index }] cannot be DC` );
	const amplitudeMeters = requireFinite( mode.amplitudeMeters, `modes[${ index }].amplitudeMeters` );
	if ( amplitudeMeters < 0 ) throw new Error( `modes[${ index }].amplitudeMeters must be nonnegative` );
	const omega = requireFinite( mode.intrinsicAngularFrequencyRadPerSecond, `modes[${ index }].intrinsicAngularFrequencyRadPerSecond` );
	if ( omega <= 0 ) throw new Error( `modes[${ index }] intrinsic frequency must be positive` );
	const expectedOmega = finiteDepthAngularFrequency( { wavenumberRadPerMeter: k, ...environment } );
	const relativeDispersionError = Math.abs( omega - expectedOmega ) / expectedOmega;
	if ( relativeDispersionError > environment.dispersionRelativeErrorGate ) throw new Error( `modes[${ index }] finite-depth dispersion mismatch ${ relativeDispersionError } exceeds gate ${ environment.dispersionRelativeErrorGate }` );
	return Object.freeze( {
		modeId: String( mode.modeId ?? `mode-${ index }` ),
		waveVectorRadPerMeter: waveVector,
		wavenumberRadPerMeter: k,
		amplitudeMeters,
		phaseAtReferenceRadians: requireFinite( mode.phaseAtReferenceRadians ?? 0, `modes[${ index }].phaseAtReferenceRadians` ),
		intrinsicAngularFrequencyRadPerSecond: omega,
		relativeDispersionError
	} );

}

export function assessCharacteristicCompatibility( mode, outwardNormal, depthMeters, gravityMps2 = 9.80665 ) {

	const normal = requireVector2( outwardNormal, 'outwardNormal' );
	const normalLength = Math.hypot( normal[ 0 ], normal[ 1 ] );
	if ( Math.abs( normalLength - 1 ) > 1e-9 ) throw new Error( 'outwardNormal must be unit length' );
	const direction = mode.waveVectorRadPerMeter.map( ( component ) => component / mode.wavenumberRadPerMeter );
	const outwardDirectionCosine = direction[ 0 ] * normal[ 0 ] + direction[ 1 ] * normal[ 1 ];
	const phaseSpeedMps = mode.intrinsicAngularFrequencyRadPerSecond / mode.wavenumberRadPerMeter;
	const incomingNormalImpedanceMps = Math.max( 0, -outwardDirectionCosine * phaseSpeedMps );
	const shallowWaterSpeedMps = Math.sqrt( gravityMps2 * depthMeters );
	const reflectionAmplitudeEstimate = incomingNormalImpedanceMps > 0
		? Math.abs( shallowWaterSpeedMps - incomingNormalImpedanceMps ) / ( shallowWaterSpeedMps + incomingNormalImpedanceMps )
		: 1;
	return Object.freeze( { outwardDirectionCosine, phaseSpeedMps, incomingNormalImpedanceMps, shallowWaterSpeedMps, reflectionAmplitudeEstimate } );

}

export function selectIncomingBoundaryModes( modes, {
	outwardNormal,
	depthMeters,
	gravityMps2 = 9.80665,
	reflectionAmplitudeGate = 0.05,
	minimumIncomingCosine = 1e-4
} ) {

	if ( ! Array.isArray( modes ) || modes.length === 0 ) throw new Error( 'boundary mode selection requires at least one mode' );
	const selected = [];
	const rejected = [];
	for ( const mode of modes ) {

		const compatibility = assessCharacteristicCompatibility( mode, outwardNormal, depthMeters, gravityMps2 );
		let reason = null;
		if ( compatibility.outwardDirectionCosine >= -minimumIncomingCosine ) reason = 'not-incoming';
		else if ( compatibility.reflectionAmplitudeEstimate > reflectionAmplitudeGate ) reason = 'reflection-gate';
		const record = Object.freeze( { mode, compatibility, reason } );
		if ( reason === null ) selected.push( record ); else rejected.push( record );

	}
	return Object.freeze( { selected: Object.freeze( selected ), rejected: Object.freeze( rejected ), reflectionAmplitudeGate } );

}

export function createPhaseResolvedOffshoreDonor( {
	phaseReferenceInstant,
	modes,
	meanCurrentMps = [ 0, 0 ],
	depthMeters,
	gravityMps2 = 9.80665,
	surfaceTensionNpm = 0,
	densityKgPerM3 = 1025,
	dispersionRelativeErrorGate = 1e-6,
	stateVersion = 'offshore-state-v1'
} ) {

	validateBoundaryPhysicsInstant( phaseReferenceInstant );
	if ( ! Array.isArray( modes ) || modes.length === 0 ) throw new Error( 'phase-resolved donor requires at least one mode' );
	const current = requireVector2( meanCurrentMps, 'meanCurrentMps' );
	const environment = Object.freeze( { depthMeters, gravityMps2, surfaceTensionNpm, densityKgPerM3, dispersionRelativeErrorGate } );
	const validatedModes = Object.freeze( modes.map( ( mode, index ) => validateMode( mode, environment, index ) ) );
	const referenceSeconds = instantSeconds( phaseReferenceInstant, 'phaseReferenceInstant' );
	return Object.freeze( {
		recordType: 'PhaseResolvedOffshoreBoundaryDonor',
		phaseReferenceInstant,
		meanCurrentMps: current,
		depthMeters,
		gravityMps2,
		stateVersion,
		modes: validatedModes,
		evaluate( pointMeters, sampleInstant, selectedModeIds = null ) {

			const point = requireVector2( pointMeters, 'pointMeters' );
			const elapsedSeconds = instantSeconds( sampleInstant, 'sampleInstant' ) - referenceSeconds;
			const idFilter = selectedModeIds === null ? null : new Set( selectedModeIds );
			let elevationMeters = 0;
			let xWaveDischargeM2ps = 0;
			let zWaveDischargeM2ps = 0;
			let elevationRateMps = 0;
			let representedModeCount = 0;
			for ( const mode of validatedModes ) {

				if ( idFilter !== null && ! idFilter.has( mode.modeId ) ) continue;
				const [ kx, kz ] = mode.waveVectorRadPerMeter;
				const absoluteOmega = mode.intrinsicAngularFrequencyRadPerSecond + kx * current[ 0 ] + kz * current[ 1 ];
				const phase = kx * point[ 0 ] + kz * point[ 1 ] + mode.phaseAtReferenceRadians - absoluteOmega * elapsedSeconds;
				const elevation = mode.amplitudeMeters * Math.cos( phase );
				const dischargeScale = mode.intrinsicAngularFrequencyRadPerSecond / mode.wavenumberRadPerMeter ** 2 * elevation;
				elevationMeters += elevation;
				xWaveDischargeM2ps += dischargeScale * kx;
				zWaveDischargeM2ps += dischargeScale * kz;
				elevationRateMps += absoluteOmega * mode.amplitudeMeters * Math.sin( phase );
				representedModeCount += 1;

			}
			return Object.freeze( {
				recordType: 'PhaseResolvedBoundarySample',
				sampleInstant,
				stateVersion,
				elevationMeters,
				waveDischargeM2ps: Object.freeze( [ xWaveDischargeM2ps, zWaveDischargeM2ps ] ),
				elevationRateMps,
				representedModeCount,
				meanCurrentMps: current
			} );

		}
	} );

}

export function injectIncomingCharacteristic( {
	donorSample,
	interiorElevationMeters,
	interiorWaveDischargeM2ps,
	outwardNormal,
	characteristicDepthMeters,
	gravityMps2 = 9.80665
} ) {

	if ( donorSample?.recordType !== 'PhaseResolvedBoundarySample' ) throw new Error( 'incoming characteristic requires a phase-resolved donor sample' );
	const normal = requireVector2( outwardNormal, 'outwardNormal' );
	if ( Math.abs( Math.hypot( ...normal ) - 1 ) > 1e-9 ) throw new Error( 'outwardNormal must be unit length' );
	const interiorDischarge = requireVector2( interiorWaveDischargeM2ps, 'interiorWaveDischargeM2ps' );
	const interiorElevation = requireFinite( interiorElevationMeters, 'interiorElevationMeters' );
	const depth = requireFinite( characteristicDepthMeters, 'characteristicDepthMeters' );
	if ( depth <= 0 ) throw new Error( 'characteristicDepthMeters must be positive' );
	const waveSpeedMps = Math.sqrt( gravityMps2 * depth );
	const tangent = [ -normal[ 1 ], normal[ 0 ] ];
	const donorNormalDischarge = donorSample.waveDischargeM2ps[ 0 ] * normal[ 0 ] + donorSample.waveDischargeM2ps[ 1 ] * normal[ 1 ];
	const interiorNormalDischarge = interiorDischarge[ 0 ] * normal[ 0 ] + interiorDischarge[ 1 ] * normal[ 1 ];
	const interiorTangentDischarge = interiorDischarge[ 0 ] * tangent[ 0 ] + interiorDischarge[ 1 ] * tangent[ 1 ];
	const incomingCharacteristicM2ps = donorNormalDischarge - waveSpeedMps * donorSample.elevationMeters;
	const outgoingCharacteristicM2ps = interiorNormalDischarge + waveSpeedMps * interiorElevation;
	const boundaryElevationMeters = ( outgoingCharacteristicM2ps - incomingCharacteristicM2ps ) / ( 2 * waveSpeedMps );
	const boundaryNormalDischargeM2ps = ( outgoingCharacteristicM2ps + incomingCharacteristicM2ps ) / 2;
	const boundaryWaveDischargeM2ps = Object.freeze( [
		normal[ 0 ] * boundaryNormalDischargeM2ps + tangent[ 0 ] * interiorTangentDischarge,
		normal[ 1 ] * boundaryNormalDischargeM2ps + tangent[ 1 ] * interiorTangentDischarge
	] );
	return Object.freeze( {
		recordType: 'IncomingCharacteristicBoundaryState',
		boundaryElevationMeters,
		boundaryWaveDischargeM2ps,
		waveSpeedMps,
		incomingCharacteristicM2ps,
		outgoingCharacteristicM2ps,
		incomingResidualM2ps: boundaryNormalDischargeM2ps - waveSpeedMps * boundaryElevationMeters - incomingCharacteristicM2ps,
		outgoingResidualM2ps: boundaryNormalDischargeM2ps + waveSpeedMps * boundaryElevationMeters - outgoingCharacteristicM2ps,
		preservedInteriorTangentDischargeM2ps: interiorTangentDischarge
	} );

}
