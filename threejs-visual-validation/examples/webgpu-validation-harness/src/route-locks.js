const CORRECTNESS_STARTUP = Object.freeze( {
	tier: 'webgpu-correctness',
	mode: 'final',
	camera: 'design',
	seed: 1,
	timeSeconds: 0,
	width: 1200,
	height: 800,
	dpr: 1
} );

const PERFORMANCE_STARTUP = Object.freeze( {
	...CORRECTNESS_STARTUP,
	tier: 'target-performance',
	width: 1920,
	height: 1080
} );

function startup( base, overrides ) {

	return Object.freeze( { ...base, ...overrides } );

}

export const SCENARIO_ROUTE_LOCKS = Object.freeze( {
	'browser-capture': startup( CORRECTNESS_STARTUP, { scenario: 'browser-capture' } ),
	'pipeline-graph-inspector': startup( CORRECTNESS_STARTUP, { scenario: 'pipeline-graph-inspector', mode: 'normal' } ),
	'resource-ledger': startup( CORRECTNESS_STARTUP, { scenario: 'resource-ledger', mode: 'normal' } ),
	'timing-and-governor': startup( PERFORMANCE_STARTUP, { scenario: 'timing-and-governor' } ),
	'lifecycle-and-leaks': startup( CORRECTNESS_STARTUP, { scenario: 'lifecycle-and-leaks' } ),
	'visual-error-metrics': startup( CORRECTNESS_STARTUP, { scenario: 'visual-error-metrics', mode: 'normal' } ),
	'mutation-gallery': startup( CORRECTNESS_STARTUP, { scenario: 'mutation-gallery', tier: 'schema-fixture', mode: 'normal' } ),
	'artifact-inspector': startup( CORRECTNESS_STARTUP, { scenario: 'artifact-inspector', mode: 'emissive' } )
} );

export const MECHANISM_ROUTE_LOCKS = Object.freeze( {
	'aligned-readback': startup( CORRECTNESS_STARTUP, { scenario: 'browser-capture' } ),
	'claim-verdicts': startup( CORRECTNESS_STARTUP, { scenario: 'artifact-inspector', mode: 'emissive' } ),
	'gpu-timestamps': startup( PERFORMANCE_STARTUP, { scenario: 'timing-and-governor' } ),
	'resource-inventory': startup( CORRECTNESS_STARTUP, { scenario: 'resource-ledger', mode: 'normal' } ),
	'visual-errors': startup( CORRECTNESS_STARTUP, { scenario: 'visual-error-metrics', mode: 'normal' } ),
	'lifecycle-trend': startup( CORRECTNESS_STARTUP, { scenario: 'lifecycle-and-leaks' } )
} );

export const TIER_ROUTE_LOCKS = Object.freeze( {
	'schema-fixture': startup( CORRECTNESS_STARTUP, { scenario: 'mutation-gallery', tier: 'schema-fixture', mode: 'normal' } ),
	'webgpu-correctness': startup( CORRECTNESS_STARTUP, { scenario: 'browser-capture' } ),
	'target-performance': startup( PERFORMANCE_STARTUP, { scenario: 'timing-and-governor' } ),
	'governor-stress': startup( PERFORMANCE_STARTUP, { scenario: 'timing-and-governor', tier: 'governor-stress', mode: 'normal' } ),
	release: startup( PERFORMANCE_STARTUP, { scenario: 'browser-capture', tier: 'release' } )
} );

export const PERFORMANCE_TIER_IDS = Object.freeze( [ 'target-performance', 'governor-stress' ] );

const ROUTE_LOCK_TABLES = Object.freeze( {
	scenario: SCENARIO_ROUTE_LOCKS,
	mechanism: MECHANISM_ROUTE_LOCKS,
	tier: TIER_ROUTE_LOCKS
} );

const STARTUP_QUERY_FIELDS = Object.freeze( [ 'scenario', 'tier', 'mode', 'camera', 'seed', 'timeSeconds', 'width', 'height', 'dpr' ] );

export function getRouteLock( kind, id ) {

	const table = ROUTE_LOCK_TABLES[ kind ] ?? null;
	if ( table === null ) throw new Error( `Unknown route-lock kind "${ kind }".` );
	if ( Object.hasOwn( table, id ) === false ) throw new Error( `Unknown ${ kind } route "${ id }".` );
	return Object.freeze( { kind, id, startup: table[ id ] } );

}

export function canonicalUrlForRoute( baseUrl, kind, id ) {

	const lock = getRouteLock( kind, id );
	const url = new URL( baseUrl );
	for ( const [ key, value ] of Object.entries( lock.startup ) ) url.searchParams.set( key, value );
	url.searchParams.set( 'lockKind', kind );
	url.searchParams.set( 'lockId', id );
	return url;

}

export function resolveRouteLockFromParameters( parameters ) {

	if ( parameters === null || typeof parameters?.get !== 'function' ) throw new Error( 'Route parameters must be URLSearchParams-compatible.' );
	const lockKind = parameters.get( 'lockKind' );
	const lockId = parameters.get( 'lockId' );
	if ( ( lockKind === null ) !== ( lockId === null ) ) throw new Error( 'Route lock kind and id must be supplied together.' );
	const scenarioId = parameters.get( 'scenario' );
	const lock = lockKind === null ? ( scenarioId === null ? null : getRouteLock( 'scenario', scenarioId ) ) : getRouteLock( lockKind, lockId );
	if ( lock === null ) return null;
	for ( const key of STARTUP_QUERY_FIELDS ) {

		const supplied = parameters.get( key );
		if ( supplied === null ) continue;
		if ( String( lock.startup[ key ] ) !== supplied ) throw new Error( `Route ${ lock.kind }/${ lock.id } is locked to ${ key }="${ lock.startup[ key ] }".` );

	}
	return lock;

}

export function routeRequiresPerformanceProfile( lock ) {

	if ( lock === null ) return false;
	return PERFORMANCE_TIER_IDS.includes( lock.startup.tier ) || ( lock.kind === 'mechanism' && lock.id === 'gpu-timestamps' );

}

export function createLockedController( controller, lock ) {

	if ( controller === null || typeof controller !== 'object' ) throw new Error( 'Locked route requires a controller.' );
	const routeLock = getRouteLock( lock.kind, lock.id );
	const startup = routeLock.startup;

	return new Proxy( controller, {
		get( target, property, receiver ) {

			if ( property === 'routeLock' ) return routeLock;
			const value = Reflect.get( target, property, receiver );
			if ( typeof value !== 'function' ) return value;

			if ( property === 'setTier' && startup.tier !== undefined ) {

				return async ( id ) => {

					if ( id !== startup.tier ) throw new Error( `Tier route is locked to "${ startup.tier }".` );
					return value.call( target, id );

				};

			}

			if ( property === 'setScenario' && startup.scenario !== undefined ) {

				return async ( id ) => {

					if ( id !== startup.scenario ) throw new Error( `Route is locked to scenario "${ startup.scenario }".` );
					return value.call( target, id );

				};

			}

			if ( property === 'setMode' && startup.mode !== undefined ) {

				return async ( id ) => {

					if ( id !== startup.mode ) throw new Error( `Route is locked to mode "${ startup.mode }".` );
					return value.call( target, id );

				};

			}

			if ( property === 'setCamera' && startup.camera !== undefined ) {

				return async ( id ) => {

					if ( id !== startup.camera ) throw new Error( `Route is locked to camera "${ startup.camera }".` );
					return value.call( target, id );

				};

			}

			if ( property === 'setSeed' && startup.seed !== undefined ) {

				return async ( seed ) => {

					if ( seed !== startup.seed ) throw new Error( `Route is locked to seed "${ startup.seed }".` );
					return value.call( target, seed );

				};

			}

			if ( property === 'setTime' && startup.timeSeconds !== undefined ) {

				return async ( seconds ) => {

					if ( seconds !== startup.timeSeconds ) throw new Error( `Route is locked to time "${ startup.timeSeconds }".` );
					return value.call( target, seconds );

				};

			}

			if ( property === 'step' && startup.timeSeconds !== undefined ) {

				return async ( deltaSeconds ) => {

					if ( deltaSeconds !== 0 ) throw new Error( `Route time is locked to "${ startup.timeSeconds }".` );
					return value.call( target, deltaSeconds );

				};

			}

			if ( property === 'resize' && startup.width !== undefined ) {

				return async ( width, height, dpr ) => {

					if ( width !== startup.width || height !== startup.height || dpr !== startup.dpr ) throw new Error( `Route viewport is locked to ${ startup.width }x${ startup.height } at DPR ${ startup.dpr }.` );
					return value.call( target, width, height, dpr );

				};

			}

			return value.bind( target );

		}
	} );

}
