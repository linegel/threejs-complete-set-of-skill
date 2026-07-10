export const MECHANISM_ROUTE_LOCKS = Object.freeze( {
	'aligned-readback': Object.freeze( { scenario: 'browser-capture', mode: 'final' } ),
	'claim-verdicts': Object.freeze( { scenario: 'artifact-inspector', mode: 'emissive' } ),
	'gpu-timestamps': Object.freeze( { scenario: 'timing-and-governor', mode: 'final' } ),
	'resource-inventory': Object.freeze( { scenario: 'resource-ledger', mode: 'normal' } ),
	'visual-errors': Object.freeze( { scenario: 'visual-error-metrics', mode: 'normal' } ),
	'lifecycle-trend': Object.freeze( { scenario: 'lifecycle-and-leaks', mode: 'final' } )
} );

export const TIER_ROUTE_LOCKS = Object.freeze( {
	'schema-fixture': Object.freeze( { scenario: 'mutation-gallery', tier: 'schema-fixture', mode: 'normal' } ),
	'webgpu-correctness': Object.freeze( { scenario: 'browser-capture', tier: 'webgpu-correctness', mode: 'final' } ),
	'target-performance': Object.freeze( { scenario: 'timing-and-governor', tier: 'target-performance', mode: 'final' } ),
	'governor-stress': Object.freeze( { scenario: 'timing-and-governor', tier: 'governor-stress', mode: 'normal' } ),
	release: Object.freeze( { scenario: 'browser-capture', tier: 'release', mode: 'final' } )
} );

export function getRouteLock( kind, id ) {

	const table = kind === 'mechanism' ? MECHANISM_ROUTE_LOCKS : kind === 'tier' ? TIER_ROUTE_LOCKS : null;
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

			return value.bind( target );

		}
	} );

}
