export const CRAB_REPRESENTATION_DECISION = Object.freeze( {
	problemId: 'shipping-procedural-coastal-crab',
	selectedCandidateId: 'closed-segmented-rigid-reference',
	axes: Object.freeze( [ 'topologyTruth', 'motionFit', 'mobileCost', 'generatedAuthoring', 'evidenceFeasibility' ] ),
	candidates: Object.freeze( [
		Object.freeze( { id: 'slot-sdf-shells', family: 'per-slot snapped SDF shells', scores: [ 1, 3, 2, 4, 3 ], hardGate: 'fail:coincident-production-sheets' } ),
		Object.freeze( { id: 'unified-field-skin', family: 'unified extracted field skin', scores: [ 3, 3, 2, 3, 2 ], hardGate: 'fail:unnecessary-blend-and-weight-complexity' } ),
		Object.freeze( { id: 'dynamic-extraction', family: 'runtime dynamic field extraction', scores: [ 4, 2, 1, 3, 1 ], hardGate: 'fail:target-cost' } ),
		Object.freeze( { id: 'imported-gltf', family: 'imported glTF skinned crab', scores: [ 5, 5, 4, 1, 4 ], hardGate: 'fail:procedural-source-contract' } ),
		Object.freeze( { id: 'offline-vat', family: 'offline baked or VAT crab', scores: [ 4, 3, 4, 2, 3 ], hardGate: 'fail:support-relative-gait' } ),
		Object.freeze( { id: 'closed-segmented-rigid-reference', family: 'closed segmented rigid-reference rig', scores: [ 5, 5, 5, 5, 5 ], hardGate: 'pass' } )
	] )
} );

export const CRAB_GAIT_GROUPS = Object.freeze( {
	A: Object.freeze( [ 'L1', 'L3', 'R2', 'R4' ] ),
	B: Object.freeze( [ 'R1', 'R3', 'L2', 'L4' ] )
} );

export const CRAB_MORPHOLOGY_PROFILES = Object.freeze( [
	Object.freeze( { id: 'ochre-rock', carapaceLengthScale: 1, carapaceWidthScale: 1, legScale: 1, clawScale: 1, lobeAmplitude: 0.035, shellColor: '#b94f2f', membraneColor: '#301a18' } ),
	Object.freeze( { id: 'blue-sand', carapaceLengthScale: 0.94, carapaceWidthScale: 1.08, legScale: 1.04, clawScale: 0.86, lobeAmplitude: 0.025, shellColor: '#426f83', membraneColor: '#17272d' } ),
	Object.freeze( { id: 'mangrove-red', carapaceLengthScale: 1.06, carapaceWidthScale: 0.96, legScale: 0.93, clawScale: 1.18, lobeAmplitude: 0.045, shellColor: '#9f3025', membraneColor: '#2c1714' } ),
	Object.freeze( { id: 'pale-reef', carapaceLengthScale: 0.9, carapaceWidthScale: 0.92, legScale: 0.9, clawScale: 0.92, lobeAmplitude: 0.02, shellColor: '#d49b72', membraneColor: '#47352e' } ),
	Object.freeze( { id: 'night-shore', carapaceLengthScale: 1.03, carapaceWidthScale: 1.04, legScale: 1.08, clawScale: 1.05, lobeAmplitude: 0.03, shellColor: '#3f394d', membraneColor: '#17151d' } )
] );

export const COASTAL_CRAB_SPEC = Object.freeze( {
	schemaVersion: 'coastal-crab-v1',
	name: 'segmented coastal crab',
	seed: 0x43524142,
	dimensionsMeters: Object.freeze( {
		carapaceLength: 0.180,
		carapaceWidth: 0.125,
		carapaceHeight: 0.052,
		totalLegSpan: 0.420
	} ),
	habitat: Object.freeze( { minimumWaterDepthMeters: 0, maximumWaterDepthMeters: 0.100, maximumSlopeDegrees: 28 } ),
	locomotion: Object.freeze( { type: 'lateral-octopod', speedMps: 0.12, stepTriggerMeters: 0.065, swingHeightMeters: 0.018, fixedTimeStepSeconds: 1 / 60, swingTicks: 32 } ),
	claws: Object.freeze( { hingeAxis: Object.freeze( [ 0, 1, 0 ] ), restAngleDegrees: 8, threatAngleDegrees: 42 } ),
	capacity: Object.freeze( { usedSlots: 40, singleCrabSlots: 48, packedProfileSlots: 64 } ),
	profiles: CRAB_MORPHOLOGY_PROFILES
} );

export function validateCoastalCrabSpec( spec = COASTAL_CRAB_SPEC ) {

	const dimensions = spec?.dimensionsMeters;
	for ( const field of [ 'carapaceLength', 'carapaceWidth', 'carapaceHeight', 'totalLegSpan' ] ) {

		if ( ! Number.isFinite( dimensions?.[ field ] ) || dimensions[ field ] <= 0 ) throw new Error( `crab.dimensionsMeters.${ field } must be finite and positive` );

	}
	if ( spec.habitat.minimumWaterDepthMeters !== 0 || spec.habitat.maximumWaterDepthMeters !== 0.1 ) throw new Error( 'crab habitat water-depth envelope drifted' );
	if ( spec.habitat.maximumSlopeDegrees !== 28 ) throw new Error( 'crab habitat slope gate drifted' );
	if ( spec.locomotion.fixedTimeStepSeconds !== 1 / 60 ) throw new Error( 'crab gait fixed step must be 1/60 s' );
	if ( spec.locomotion.speedMps !== 0.12 || spec.locomotion.stepTriggerMeters !== 0.065 || spec.locomotion.swingHeightMeters !== 0.018 ) throw new Error( 'crab gait dimensional contract drifted' );
	if ( spec.capacity.usedSlots !== 40 || spec.capacity.singleCrabSlots !== 48 || spec.capacity.packedProfileSlots !== 64 ) throw new Error( 'crab slot-capacity contract drifted' );
	if ( spec.capacity.usedSlots > spec.capacity.singleCrabSlots || spec.capacity.singleCrabSlots > spec.capacity.packedProfileSlots ) throw new Error( 'crab slot capacities are not nested' );
	if ( ! Array.isArray( spec.profiles ) || spec.profiles.length !== 5 || new Set( spec.profiles.map( ( profile ) => profile.id ) ).size !== 5 ) throw new Error( 'crab requires five unique morphology profiles' );
	if ( spec.claws.restAngleDegrees !== 8 || spec.claws.threatAngleDegrees !== 42 || spec.claws.hingeAxis.join( ',' ) !== '0,1,0' ) throw new Error( 'crab claw hinge contract drifted' );
	const members = [ ...CRAB_GAIT_GROUPS.A, ...CRAB_GAIT_GROUPS.B ];
	if ( members.length !== 8 || new Set( members ).size !== 8 ) throw new Error( 'crab alternating tetrapod groups do not partition eight walking legs' );
	return true;

}
