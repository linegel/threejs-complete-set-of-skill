import {
	COASTAL_CRAB_SPEC,
	CRAB_MORPHOLOGY_PROFILES,
	CRAB_REPRESENTATION_DECISION,
	validateCoastalCrabSpec
} from '../../crab/crab-spec.js';
import { crabRigIdentity, createCoastalCrabRig } from '../../crab/crab-rig.js';
import {
	crabGaitHash,
	createCrabGaitState,
	createFlatCrabSupportProvider,
	replayCrabGait,
	stepCrabGait,
	validateOneWayCrabWaterInteraction
} from '../../crab/crab-gait.js';

function assert( condition, message ) {

	if ( ! condition ) throw new Error( message );

}

validateCoastalCrabSpec();
assert( CRAB_REPRESENTATION_DECISION.candidates.length >= 5, 'crab decision compares fewer than five representations' );
assert( new Set( CRAB_REPRESENTATION_DECISION.candidates.map( ( candidate ) => candidate.family ) ).size === CRAB_REPRESENTATION_DECISION.candidates.length, 'crab decision families are not distinct' );
assert( CRAB_REPRESENTATION_DECISION.selectedCandidateId === 'closed-segmented-rigid-reference', 'crab selected representation drifted' );

const rigs = CRAB_MORPHOLOGY_PROFILES.map( ( profile ) => createCoastalCrabRig( profile.id ) );
assert( rigs.every( ( rig ) => rig.usedSlots === 40 && rig.capacity === 48 && rig.packedCapacity === 64 ), 'crab rig capacity contract failed' );
assert( new Set( rigs.map( crabRigIdentity ) ).size === 1, 'morphology profiles changed crab slot/material-zone identity' );
assert( rigs[ 0 ].slots.filter( ( slot ) => slot.family === 'body' ).length === 2, 'crab body slot count failed' );
assert( rigs[ 0 ].slots.filter( ( slot ) => slot.family === 'eye' ).length === 2, 'crab eye slot count failed' );
assert( rigs[ 0 ].slots.filter( ( slot ) => slot.family === 'walking-leg' ).length === 24, 'crab walking-leg slot count failed' );
assert( rigs[ 0 ].slots.filter( ( slot ) => slot.family === 'claw' ).length === 12, 'crab claw slot count failed' );
assert( rigs[ 0 ].slots.every( ( slot ) => /^closed-/.test( slot.geometry ) ), 'crab has an open or diagnostic-only production segment' );
for ( const side of [ 'L', 'R' ] ) {

	assert( rigs[ 0 ].slots.find( ( slot ) => slot.id === `claw.${ side }.fixed-finger` )?.parentId === `claw.${ side }.palm`, `crab ${ side } fixed finger does not branch from its palm` );
	assert( rigs[ 0 ].slots.find( ( slot ) => slot.id === `claw.${ side }.hinged-finger` )?.parentId === `claw.${ side }.palm`, `crab ${ side } hinged finger does not branch from its palm` );

}

const support = createFlatCrabSupportProvider( { slopeRadians: 0.15, waterDepthMeters: 0.04 } );
const gait = createCrabGaitState( { supportProvider: support } );
let minimumStance = 8;
let maximumIkResidual = 0;
for ( let tick = 0; tick < 128; tick += 1 ) {

	const pose = stepCrabGait( gait, { behavior: tick >= 96 ? 'threat' : 'lateral-walk' } );
	minimumStance = Math.min( minimumStance, pose.stanceCount );
	for ( const leg of pose.legs ) maximumIkResidual = Math.max( maximumIkResidual, leg.upperLengthResidualMeters, leg.lowerLengthResidualMeters );
	assert( pose.legs.every( ( leg ) => leg.supportId === 'support:coast-plane' && leg.identityGeneration === 1 ), 'crab lost support identity' );

}
assert( minimumStance >= 4, `crab planted only ${ minimumStance } feet` );
assert( maximumIkResidual <= 1e-12, `crab IK length residual ${ maximumIkResidual } m exceeded the f64 gate` );
assert( support.describe().batchCount === 128 && support.describe().sampleCount === 1024, 'crab support queries were not one eight-foot batch per tick' );
assert( gait.lastPose.clawAngleDegrees === COASTAL_CRAB_SPEC.claws.threatAngleDegrees, 'crab threat claw angle failed' );

const replayA = replayCrabGait( 128 );
const replayB = replayCrabGait( 128 );
const hashA = crabGaitHash( replayA );
assert( hashA === crabGaitHash( replayB ), 'crab fixed-step replay is nondeterministic' );
validateOneWayCrabWaterInteraction( { surfaceDifferenceMeters: 0.0015, normalDifferenceDegrees: 0.75, trajectoryHashBefore: hashA, trajectoryHashAfter: crabGaitHash( replayB ) } );

for ( const [ label, mutate, pattern ] of [
	[ 'slot capacity', ( spec ) => { spec.capacity.usedSlots = 41; }, /slot-capacity/ ],
	[ 'profile count', ( spec ) => { spec.profiles.pop(); }, /five unique/ ],
	[ 'water depth', ( spec ) => { spec.habitat.maximumWaterDepthMeters = 0.2; }, /water-depth/ ],
	[ 'slope', ( spec ) => { spec.habitat.maximumSlopeDegrees = 40; }, /slope/ ],
	[ 'fixed step', ( spec ) => { spec.locomotion.fixedTimeStepSeconds = 1 / 30; }, /1\/60/ ],
	[ 'hinge', ( spec ) => { spec.claws.hingeAxis = [ 1, 0, 0 ]; }, /hinge/ ]
] ) {

	const spec = structuredClone( COASTAL_CRAB_SPEC );
	mutate( spec );
	let rejected = false;
	try { validateCoastalCrabSpec( spec ); } catch ( error ) { rejected = pattern.test( error.message ); }
	assert( rejected, `crab ${ label } mutation survived` );

}

for ( const [ label, values, pattern ] of [
	[ 'surface feedback', { surfaceDifferenceMeters: 0.003, normalDifferenceDegrees: 0.5, trajectoryHashBefore: hashA, trajectoryHashAfter: hashA }, /surface/ ],
	[ 'normal feedback', { surfaceDifferenceMeters: 0.001, normalDifferenceDegrees: 1.2, trajectoryHashBefore: hashA, trajectoryHashAfter: hashA }, /normal/ ],
	[ 'trajectory mutation', { surfaceDifferenceMeters: 0.001, normalDifferenceDegrees: 0.5, trajectoryHashBefore: hashA, trajectoryHashAfter: 'changed' }, /trajectory/ ]
] ) {

	let rejected = false;
	try { validateOneWayCrabWaterInteraction( values ); } catch ( error ) { rejected = pattern.test( error.message ); }
	assert( rejected, `crab ${ label } mutation survived` );

}

console.log( `coastal crab gates passed: 6 representations, 5 profiles, 40 slots, 128 ticks, minimum stance ${ minimumStance }, hash ${ hashA }, 9 rejection controls` );
