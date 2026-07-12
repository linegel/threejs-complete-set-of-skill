import { numericDatum } from './physical-evidence-common.js';
import {
	getRouteLock,
	MECHANISM_ROUTE_LOCKS,
	routeRequiresPerformanceProfile,
	SCENARIO_ROUTE_LOCKS,
	TIER_ROUTE_LOCKS
} from './route-locks.js';

function planRecord( kind, id ) {

	const lock = getRouteLock( kind, id );
	return Object.freeze( {
		key: `${ kind }/${ id }`,
		kind,
		id,
		startup: lock.startup,
		runtimeProfile: routeRequiresPerformanceProfile( lock ) ? 'performance' : 'correctness'
	} );

}

export const PHYSICAL_ROUTE_PLAN = Object.freeze( [
	...Object.keys( SCENARIO_ROUTE_LOCKS ).map( ( id ) => planRecord( 'scenario', id ) ),
	...Object.keys( MECHANISM_ROUTE_LOCKS ).map( ( id ) => planRecord( 'mechanism', id ) ),
	...Object.keys( TIER_ROUTE_LOCKS ).map( ( id ) => planRecord( 'tier', id ) )
] );

export const HARDWARE_PERFORMANCE_ROUTE_PLAN = Object.freeze( [
	planRecord( 'tier', 'target-performance' ),
	planRecord( 'tier', 'governor-stress' )
] );

export const HARDWARE_PERFORMANCE_CONTRACT = Object.freeze( {
	frameTarget: numericDatum( 16.67, 'ms', 'Gated', '60 Hz current-adapter release target' ),
	cpuP95Maximum: numericDatum( 14.67, 'ms', 'Gated', 'frame target minus 2 ms host and presentation reserve' ),
	gpuP95Maximum: numericDatum( 14.67, 'ms', 'Gated', 'frame target minus 2 ms host and presentation reserve' ),
	presentationP95Maximum: numericDatum( 20, 'ms', 'Gated', 'foreground 60 Hz cadence jitter gate' ),
	deadlineThreshold: numericDatum( 25.005, 'ms', 'Gated', '1.5 times the 16.67 ms frame target' ),
	maximumDeadlineMissRatio: numericDatum( 0.01, 'ratio', 'Gated', 'sustained foreground presentation gate' ),
	governorWindowCount: numericDatum( 6, 'window', 'Gated', 'fixed hardware governor stress trace' ),
	governorFramesPerWindow: numericDatum( 30, 'frame', 'Gated', 'fixed hardware governor percentile population' ),
	governorTarget: numericDatum( 1000 / 60 - 2, 'ms', 'Gated', '60 Hz frame period minus 2 ms host and presentation reserve' ),
	governorHysteresis: numericDatum( 2, 'ms', 'Gated', 'upgrade margin below the governor target' ),
	governorMinimumResidence: numericDatum( 2, 'window', 'Gated', 'minimum residence before a tier transition' ),
	governorCooldown: numericDatum( 2, 'window', 'Gated', 'post-transition cooldown' ),
	minimumGovernorTransitions: numericDatum( 1, 'transition', 'Gated', 'governor stress must exercise a real tier change' ),
	viewport: Object.freeze( {
		width: numericDatum( 1920, 'pixel', 'Gated', 'hardware performance capture contract' ),
		height: numericDatum( 1080, 'pixel', 'Gated', 'hardware performance capture contract' ),
		dpr: numericDatum( 1, 'ratio', 'Gated', 'hardware performance capture contract' )
	} ),
	idleRefreshMinimumDuration: numericDatum( 2000, 'ms', 'Gated', 'idle-rAF refresh measurement contract' ),
	coldMinimumDuration: numericDatum( 2000, 'ms', 'Gated', 'cold performance segment contract' ),
	sustainedWindowMinimumDuration: numericDatum( 30000, 'ms', 'Gated', 'sustained performance segment contract' ),
	sustainedWindowMinimumSamples: numericDatum( 120, 'sample', 'Gated', 'sustained performance segment contract' ),
	maximumPresentationGap: numericDatum( 100, 'ms', 'Gated', 'foreground physical-browser continuity gate' ),
	minimumPresentationCoverage: numericDatum( 0.95, 'ratio', 'Gated', 'foreground physical-browser continuity gate' ),
	minimumSustainedWindows: numericDatum( 2, 'window', 'Gated', 'sustained performance segment contract' )
} );

if ( PHYSICAL_ROUTE_PLAN.length !== 19 ) throw new Error( `Physical evidence plan must contain exactly 19 routes; received ${ PHYSICAL_ROUTE_PLAN.length }.` );
