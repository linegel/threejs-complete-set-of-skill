import { AO_DEBUG_MODES, AO_MECHANISMS, AO_SCENARIOS, AO_TIERS } from './main.js';

const SCENARIO_FOR_MECHANISM = Object.freeze( {
	'scalar-gtao': 'wall-receiver',
	'bilateral-denoise-and-halo': 'thin-silhouette',
	'temporal-ao': 'moving-occluder',
	'bent-normal-wall': 'bent-normal-wall',
	'indirect-only-application': 'emissive-direct',
	'depth-conventions': 'sky-edge'
} );

const AO_MODE_VALUES = Object.freeze( Object.values( AO_DEBUG_MODES ) );
const AO_CAMERAS = Object.freeze( [ 'near', 'design', 'far' ] );

function optionalQueryValue( query, name ) {

	const value = query.get( name );
	return value === null ? null : value;

}

function parseSeed( value ) {

	if ( value === null ) return 0x00000001;
	if ( value.trim() === '' ) throw new Error( 'AO seed query must be an unsigned 32-bit integer.' );
	const seed = Number( value );
	if ( ! Number.isInteger( seed ) || seed < 0 || seed > 0xffffffff ) throw new Error( 'AO seed query must be an unsigned 32-bit integer.' );
	return seed;

}

function parseTime( value ) {

	if ( value === null ) return 0;
	if ( value.trim() === '' ) throw new Error( 'AO time query must be finite.' );
	const time = Number( value );
	if ( ! Number.isFinite( time ) ) throw new Error( 'AO time query must be finite.' );
	return time;

}

export function resolveAORoute( pathname, search = '' ) {

	const parts = String( pathname ).split( '/' ).filter( Boolean );
	const mechanismIndex = parts.lastIndexOf( 'mechanism' );
	const tierIndex = parts.lastIndexOf( 'tier' );
	const mechanism = mechanismIndex >= 0 ? parts[ mechanismIndex + 1 ] : null;
	const pathTier = tierIndex >= 0 ? parts[ tierIndex + 1 ] : null;
	if ( mechanismIndex >= 0 && ! mechanism ) throw new Error( 'AO mechanism route is missing an id.' );
	if ( tierIndex >= 0 && ! pathTier ) throw new Error( 'AO tier route is missing an id.' );
	if ( mechanism !== null && ! AO_MECHANISMS.includes( mechanism ) ) throw new Error( `Unknown AO mechanism route: ${ mechanism }` );
	if ( pathTier !== null && AO_TIERS[ pathTier ] === undefined ) throw new Error( `Unknown AO tier route: ${ pathTier }` );

	const query = new URLSearchParams( String( search ) );
	const queryMechanism = optionalQueryValue( query, 'mechanism' );
	const queryTier = optionalQueryValue( query, 'tier' );
	const queryScenario = optionalQueryValue( query, 'scenario' );
	const queryMode = optionalQueryValue( query, 'mode' );
	const queryCamera = optionalQueryValue( query, 'camera' );
	if ( queryMechanism !== null && ! AO_MECHANISMS.includes( queryMechanism ) ) throw new Error( `Unknown AO mechanism query: ${ queryMechanism }` );
	if ( queryTier !== null && AO_TIERS[ queryTier ] === undefined ) throw new Error( `Unknown AO tier query: ${ queryTier }` );
	if ( queryScenario !== null && ! AO_SCENARIOS.includes( queryScenario ) ) throw new Error( `Unknown AO scenario query: ${ queryScenario }` );
	if ( queryMode !== null && ! AO_MODE_VALUES.includes( queryMode ) ) throw new Error( `Unknown AO mode query: ${ queryMode }` );
	if ( queryCamera !== null && ! AO_CAMERAS.includes( queryCamera ) ) throw new Error( `Unknown AO camera query: ${ queryCamera }` );

	const resolvedMechanism = mechanism ?? queryMechanism;
	const mechanismLocked = resolvedMechanism !== null;
	return {
		mechanism: resolvedMechanism,
		tier: pathTier ?? queryTier ?? 'ultra',
		scenario: mechanismLocked ? SCENARIO_FOR_MECHANISM[ resolvedMechanism ] : queryScenario ?? 'wall-receiver',
		mode: mechanismLocked ? resolvedMechanism : queryMode ?? AO_DEBUG_MODES.final,
		seed: parseSeed( optionalQueryValue( query, 'seed' ) ),
		camera: queryCamera ?? 'design',
		time: parseTime( optionalQueryValue( query, 'time' ) )
	};

}
