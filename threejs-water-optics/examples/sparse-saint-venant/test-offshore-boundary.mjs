import assert from 'node:assert/strict';
import {
	OFFSHORE_BOUNDARY_DECISION,
	assessCharacteristicCompatibility,
	createPhaseResolvedOffshoreDonor,
	finiteDepthAngularFrequency,
	injectIncomingCharacteristic,
	selectIncomingBoundaryModes,
	validateBoundarySampleInstant
} from './offshore-boundary.js';

const instant = ( tick, seconds ) => Object.freeze( {
	clockId: 'coastal-clock', tick,
	rationalSubstep: Object.freeze( { numerator: 0, denominator: 1 } ),
	clockMappingRevision: 'clock-map-v1', discontinuityEpoch: 'continuous-v1',
	timeSecondsDerived: Object.freeze( { value: seconds, unit: 's', label: 'Derived', source: 'fixture fixed-rational clock' } )
} );

assert.ok( OFFSHORE_BOUNDARY_DECISION.candidates.length >= 5 );
assert.equal( new Set( OFFSHORE_BOUNDARY_DECISION.candidates.map( ( candidate ) => candidate.family ) ).size, OFFSHORE_BOUNDARY_DECISION.candidates.length );
assert.equal( OFFSHORE_BOUNDARY_DECISION.selectedCandidateId, 'incoming-characteristic-injection' );
assert.equal( OFFSHORE_BOUNDARY_DECISION.candidates.find( ( candidate ) => candidate.id === OFFSHORE_BOUNDARY_DECISION.selectedCandidateId ).hardGate, 'pass' );

const gravityMps2 = 9.80665;
const depthMeters = 1;
const k = 0.1;
const omega = finiteDepthAngularFrequency( { wavenumberRadPerMeter: k, depthMeters, gravityMps2 } );
const phaseReferenceInstant = instant( 0, 0 );
const donor = createPhaseResolvedOffshoreDonor( {
	phaseReferenceInstant,
	depthMeters,
	gravityMps2,
	meanCurrentMps: [ 0.3, 0 ],
	modes: [
		{ modeId: 'normal-swell', waveVectorRadPerMeter: [ k, 0 ], amplitudeMeters: 0.08, phaseAtReferenceRadians: 0, intrinsicAngularFrequencyRadPerSecond: omega },
		{ modeId: 'oblique-swell', waveVectorRadPerMeter: [ k, 0.04 ], amplitudeMeters: 0.025, phaseAtReferenceRadians: 0.4, intrinsicAngularFrequencyRadPerSecond: finiteDepthAngularFrequency( { wavenumberRadPerMeter: Math.hypot( k, 0.04 ), depthMeters, gravityMps2 } ) }
	]
} );

const referenceSample = donor.evaluate( [ 0, 0 ], phaseReferenceInstant, [ 'normal-swell' ] );
assert.ok( Math.abs( referenceSample.elevationMeters - 0.08 ) < 1e-12 );
assert.ok( Math.abs( referenceSample.waveDischargeM2ps[ 0 ] - omega / k * 0.08 ) < 1e-12 );
assert.equal( referenceSample.waveDischargeM2ps[ 1 ], 0 );
assert.equal( referenceSample.elevationRateMps, 0 );

const elapsed = 0.37;
const shiftedSample = donor.evaluate( [ 0, 0 ], instant( 37, elapsed ), [ 'normal-swell' ] );
const absoluteOmega = omega + k * 0.3;
assert.ok( Math.abs( shiftedSample.elevationMeters - 0.08 * Math.cos( absoluteOmega * elapsed ) ) < 1e-12, 'uniform-current Doppler phase drifted' );
assert.ok( Math.abs( shiftedSample.elevationRateMps - 0.08 * absoluteOmega * Math.sin( -absoluteOmega * elapsed ) ) < 1e-12 );

const outwardNormal = [ -1, 0 ];
const selection = selectIncomingBoundaryModes( donor.modes, { outwardNormal, depthMeters, gravityMps2, reflectionAmplitudeGate: 0.08 } );
assert.equal( selection.selected.length, 2 );
assert.equal( selection.rejected.length, 0 );
const compatibility = assessCharacteristicCompatibility( donor.modes[ 0 ], outwardNormal, depthMeters, gravityMps2 );
assert.ok( compatibility.reflectionAmplitudeEstimate < 0.002 );

const waveSpeed = Math.sqrt( gravityMps2 * depthMeters );
const interiorElevationMeters = 0.02;
const interiorOutgoingNormalDischarge = waveSpeed * interiorElevationMeters;
const boundary = injectIncomingCharacteristic( {
	donorSample: referenceSample,
	interiorElevationMeters,
	interiorWaveDischargeM2ps: [ -interiorOutgoingNormalDischarge, 0.017 ],
	outwardNormal,
	characteristicDepthMeters: depthMeters,
	gravityMps2
} );
assert.ok( Math.abs( boundary.incomingResidualM2ps ) < 1e-12 );
assert.ok( Math.abs( boundary.outgoingResidualM2ps ) < 1e-12 );
assert.ok( Math.abs( boundary.preservedInteriorTangentDischargeM2ps + 0.017 ) < 1e-12 );
assert.ok( Math.abs( boundary.outgoingCharacteristicM2ps - 2 * waveSpeed * interiorElevationMeters ) < 1e-12 );

const outgoingMode = Object.freeze( { ...donor.modes[ 0 ], modeId: 'outgoing', waveVectorRadPerMeter: Object.freeze( [ -k, 0 ] ) } );
const grazingMode = Object.freeze( { ...donor.modes[ 0 ], modeId: 'grazing', waveVectorRadPerMeter: Object.freeze( [ 0.01, k ] ), wavenumberRadPerMeter: Math.hypot( 0.01, k ), intrinsicAngularFrequencyRadPerSecond: finiteDepthAngularFrequency( { wavenumberRadPerMeter: Math.hypot( 0.01, k ), depthMeters, gravityMps2 } ) } );
const rejected = selectIncomingBoundaryModes( [ outgoingMode, grazingMode ], { outwardNormal, depthMeters, gravityMps2, reflectionAmplitudeGate: 0.08 } );
assert.deepEqual( rejected.rejected.map( ( entry ) => entry.reason ), [ 'not-incoming', 'reflection-gate' ] );

assert.throws( () => validateBoundarySampleInstant( { ...phaseReferenceInstant, rationalSubstep: { numerator: 2, denominator: 2 } } ), /canonical/ );
assert.throws( () => createPhaseResolvedOffshoreDonor( { phaseReferenceInstant, depthMeters, gravityMps2, modes: [ { waveVectorRadPerMeter: [ 0, 0 ], amplitudeMeters: 1, intrinsicAngularFrequencyRadPerSecond: 1 } ] } ), /DC/ );
assert.throws( () => createPhaseResolvedOffshoreDonor( { phaseReferenceInstant, depthMeters, gravityMps2, modes: [ { waveVectorRadPerMeter: [ k, 0 ], amplitudeMeters: 1, intrinsicAngularFrequencyRadPerSecond: omega * 1.2 } ] } ), /dispersion mismatch/ );
assert.throws( () => injectIncomingCharacteristic( { donorSample: referenceSample, interiorElevationMeters: 0, interiorWaveDischargeM2ps: [ 0, 0 ], outwardNormal: [ 2, 0 ], characteristicDepthMeters: 1 } ), /unit length/ );

console.log( `offshore boundary oracle passed: ${ OFFSHORE_BOUNDARY_DECISION.candidates.length } architectures, ${ selection.selected.length } incoming modes, reflection ${ compatibility.reflectionAmplitudeEstimate.toExponential( 3 ) }, 4 rejection controls` );
