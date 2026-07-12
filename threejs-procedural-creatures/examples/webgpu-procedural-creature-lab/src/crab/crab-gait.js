import { solveTwoBoneIK } from '../core/locomotion/ik.js';
import { COASTAL_CRAB_SPEC, CRAB_GAIT_GROUPS, validateCoastalCrabSpec } from './crab-spec.js';

const DT = 1 / 60;
const LEG_IDS = Object.freeze( [ 'L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4' ] );
const GROUP_BY_LEG = Object.freeze( Object.fromEntries( [ ...CRAB_GAIT_GROUPS.A.map( ( id ) => [ id, 0 ] ), ...CRAB_GAIT_GROUPS.B.map( ( id ) => [ id, 1 ] ) ] ) );

function homeForLeg( legId ) {

	const side = legId[ 0 ] === 'L' ? 1 : -1;
	const ordinal = Number( legId[ 1 ] );
	return [ -0.0675 + ( ordinal - 1 ) * 0.045, 0, side * 0.21 ];

}

function hipForLeg( legId ) {

	const side = legId[ 0 ] === 'L' ? 1 : -1;
	const ordinal = Number( legId[ 1 ] );
	return [ -0.0675 + ( ordinal - 1 ) * 0.045, 0.052, side * 0.052 ];

}

function createLegState( legId ) {

	const home = homeForLeg( legId );
	return {
		legId,
		group: GROUP_BY_LEG[ legId ],
		homeLocal: home,
		footWorld: [ ...home ],
		swingStart: [ ...home ],
		swingTarget: [ ...home ],
		planted: true,
		supportId: 'support:coast-plane',
		featureId: `support-feature:${ legId }`,
		identityGeneration: 1,
		upperLengthMeters: 0.066,
		lowerLengthMeters: 0.066
	};

}

export function createFlatCrabSupportProvider( { slopeRadians = 0, waterDepthMeters = 0.04 } = {} ) {

	let batchCount = 0;
	let sampleCount = 0;
	return {
		providerId: 'coastal-crab-support-v1',
		sampleBatch( requests, tick ) {

			batchCount += 1;
			sampleCount += requests.length;
			const normal = [ -Math.sin( slopeRadians ), Math.cos( slopeRadians ), 0 ];
			return requests.map( ( request ) => Object.freeze( {
				requestId: request.requestId,
				point: Object.freeze( [ request.x, Math.tan( slopeRadians ) * request.x, request.z ] ),
				normal: Object.freeze( normal ),
				pointVelocityMps: Object.freeze( [ 0, 0, 0 ] ),
				supportId: 'support:coast-plane',
				featureId: `support-feature:${ request.legId }`,
				identityGeneration: 1,
				waterDepthMeters,
				actualTick: tick,
				stateVersion: `support-state-${ tick }`,
				errorMeters: 0
			} ) );

		},
		describe: () => Object.freeze( { batchCount, sampleCount } )
	};

}

export function createCrabGaitState( { spec = COASTAL_CRAB_SPEC, supportProvider = createFlatCrabSupportProvider() } = {} ) {

	validateCoastalCrabSpec( spec );
	return {
		spec,
		supportProvider,
		tick: 0,
		timeSeconds: 0,
		rootPositionMeters: [ 0, 0, 0 ],
		activeGroup: 0,
		blockIndex: 0,
		legs: LEG_IDS.map( createLegState ),
		behavior: 'lateral-walk',
		clawAngleDegrees: spec.claws.restAngleDegrees,
		lastPose: null
	};

}

function beginSwingBlock( state, activeGroup ) {

	const predictedRootEndX = state.rootPositionMeters[ 0 ] + state.spec.locomotion.speedMps * DT * state.spec.locomotion.swingTicks;
	for ( const leg of state.legs ) {

		if ( leg.group !== activeGroup ) continue;
		leg.swingStart = [ ...leg.footWorld ];
		leg.swingTarget = [ predictedRootEndX + leg.homeLocal[ 0 ], leg.footWorld[ 1 ], leg.homeLocal[ 2 ] ];
		leg.planted = false;

	}

}

function sampleLegPose( state, leg, supportSample, blockPhase ) {

	if ( leg.group === state.activeGroup ) {

		const lift = Math.sin( Math.PI * blockPhase ) * state.spec.locomotion.swingHeightMeters;
		leg.footWorld[ 0 ] = leg.swingStart[ 0 ] + ( leg.swingTarget[ 0 ] - leg.swingStart[ 0 ] ) * blockPhase;
		leg.footWorld[ 1 ] = supportSample.point[ 1 ] + lift;
		leg.footWorld[ 2 ] = leg.swingStart[ 2 ] + ( leg.swingTarget[ 2 ] - leg.swingStart[ 2 ] ) * blockPhase;
		leg.planted = blockPhase >= 1;

	} else {

		leg.planted = true;

	}
	const side = leg.legId[ 0 ] === 'L' ? 1 : -1;
	const hip = hipForLeg( leg.legId );
	const coxaEnd = [ hip[ 0 ], hip[ 1 ] - 0.004, side * 0.088 ];
	const footBody = [ leg.footWorld[ 0 ] - state.rootPositionMeters[ 0 ], leg.footWorld[ 1 ] - state.rootPositionMeters[ 1 ], leg.footWorld[ 2 ] ];
	const ik = solveTwoBoneIK( coxaEnd, footBody, leg.upperLengthMeters, leg.lowerLengthMeters, [ 0.35, 0.25, side ] );
	return Object.freeze( {
		legId: leg.legId,
		group: leg.group,
		planted: leg.planted,
		hip: Object.freeze( hip ),
		coxaEnd: Object.freeze( coxaEnd ),
		knee: Object.freeze( [ ...ik.knee ] ),
		footBody: Object.freeze( [ ...ik.foot ] ),
		footWorld: Object.freeze( [ ...leg.footWorld ] ),
		supportId: supportSample.supportId,
		featureId: supportSample.featureId,
		identityGeneration: supportSample.identityGeneration,
		upperLengthResidualMeters: Math.abs( ik.segments.upperLength - leg.upperLengthMeters ),
		lowerLengthResidualMeters: Math.abs( ik.segments.lowerLength - leg.lowerLengthMeters )
	} );

}

export function stepCrabGait( state, { behavior = state.behavior } = {} ) {

	const nextTick = state.tick + 1;
	const swingTicks = state.spec.locomotion.swingTicks;
	const nextBlock = Math.floor( ( nextTick - 1 ) / swingTicks );
	const activeGroup = nextBlock % 2;
	if ( nextBlock !== state.blockIndex || state.tick === 0 ) {

		state.blockIndex = nextBlock;
		state.activeGroup = activeGroup;
		beginSwingBlock( state, activeGroup );

	}
	state.rootPositionMeters[ 0 ] += state.spec.locomotion.speedMps * DT;
	const localTick = ( ( nextTick - 1 ) % swingTicks ) + 1;
	const blockPhase = localTick / swingTicks;
	const supportRequests = state.legs.map( ( leg ) => ( {
		requestId: `crab-foot:${ nextTick }:${ leg.legId }`,
		legId: leg.legId,
		x: leg.group === state.activeGroup ? leg.swingTarget[ 0 ] : leg.footWorld[ 0 ],
		z: leg.group === state.activeGroup ? leg.swingTarget[ 2 ] : leg.footWorld[ 2 ],
		requestedTick: nextTick
	} ) );
	const supportSamples = state.supportProvider.sampleBatch( supportRequests, nextTick );
	if ( ! Array.isArray( supportSamples ) || supportSamples.length !== state.legs.length ) throw new Error( 'crab support provider must return one atomic eight-foot batch' );
	const legs = state.legs.map( ( leg, index ) => sampleLegPose( state, leg, supportSamples[ index ], blockPhase ) );
	state.tick = nextTick;
	state.timeSeconds = nextTick * DT;
	state.behavior = behavior;
	state.clawAngleDegrees = behavior === 'threat' ? state.spec.claws.threatAngleDegrees : state.spec.claws.restAngleDegrees;
	state.lastPose = Object.freeze( {
		tick: nextTick,
		timeSeconds: state.timeSeconds,
		rootPositionMeters: Object.freeze( [ ...state.rootPositionMeters ] ),
		activeGroup: state.activeGroup,
		legs: Object.freeze( legs ),
		stanceCount: legs.filter( ( leg ) => leg.planted ).length,
		swingCount: legs.filter( ( leg ) => ! leg.planted ).length,
		behavior,
		clawAngleDegrees: state.clawAngleDegrees,
		supportStateVersion: supportSamples[ 0 ].stateVersion
	} );
	return state.lastPose;

}

export function replayCrabGait( tickCount, options = {} ) {

	const state = createCrabGaitState( options );
	for ( let tick = 0; tick < tickCount; tick += 1 ) stepCrabGait( state, options );
	return state;

}

export function crabGaitHash( state ) {

	const pose = state.lastPose;
	const values = [ pose.tick, ...pose.rootPositionMeters, pose.activeGroup, pose.clawAngleDegrees ];
	for ( const leg of pose.legs ) values.push( ...leg.hip, ...leg.coxaEnd, ...leg.knee, ...leg.footBody, leg.planted ? 1 : 0 );
	let hash = 0x811c9dc5;
	for ( const byte of new Uint8Array( new Float64Array( values ).buffer ) ) {

		hash ^= byte;
		hash = Math.imul( hash, 0x01000193 );

	}
	return ( hash >>> 0 ).toString( 16 ).padStart( 8, '0' );

}

export function validateOneWayCrabWaterInteraction( {
	surfaceDifferenceMeters,
	normalDifferenceDegrees,
	trajectoryHashBefore,
	trajectoryHashAfter
} ) {

	if ( trajectoryHashBefore !== trajectoryHashAfter ) throw new Error( 'one-way crab route changed the authoritative crab trajectory' );
	if ( ! Number.isFinite( surfaceDifferenceMeters ) || surfaceDifferenceMeters > 0.002 ) throw new Error( 'one-way crab omitted-feedback surface gate failed' );
	if ( ! Number.isFinite( normalDifferenceDegrees ) || normalDifferenceDegrees > 1 ) throw new Error( 'one-way crab omitted-feedback normal gate failed' );
	return Object.freeze( {
		mode: 'one-way',
		authoritativeSource: 'crab-gait',
		reactionEmitted: false,
		trajectoryInvariant: true,
		omittedFeedbackGate: Object.freeze( { surfaceDifferenceMeters: 0.002, normalDifferenceDegrees: 1 } )
	} );

}
