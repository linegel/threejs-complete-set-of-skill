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
