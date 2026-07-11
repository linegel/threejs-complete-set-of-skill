import { BLOOM_MECHANISMS, BLOOM_SCENARIOS, DEBUG_MODES, QUALITY_TIERS } from './index.js';

const BLOOM_CAMERAS = Object.freeze( [ 'near', 'design', 'far' ] );
const BLOOM_MODE_VALUES = Object.freeze( Object.values( DEBUG_MODES ) );

function queryValue( query, name ) {

	const value = query.get( name );
	return value === null ? null : value;

}

function parseSeed( value ) {

	if ( value === null ) return 0x00000001;
	if ( value.trim() === '' ) throw new Error( 'Bloom seed query must be an unsigned 32-bit integer.' );
	const seed = Number( value );
	if ( ! Number.isInteger( seed ) || seed < 0 || seed > 0xffffffff ) throw new Error( 'Bloom seed query must be an unsigned 32-bit integer.' );
	return seed;

}

function parseTime( value ) {

	if ( value === null ) return 0;
	if ( value.trim() === '' ) throw new Error( 'Bloom time query must be finite.' );
	const time = Number( value );
	if ( ! Number.isFinite( time ) ) throw new Error( 'Bloom time query must be finite.' );
	return time;

}

function parseBooleanFlag( value, name ) {

	if ( value === null ) return false;
	if ( value !== '0' && value !== '1' ) throw new Error( `Bloom ${ name } query must be 0 or 1.` );
	return value === '1';

}

export function resolveBloomRoute( pathname, search = '' ) {

	const parts = String( pathname ).split( '/' ).filter( Boolean );
	const mechanismIndex = parts.lastIndexOf( 'mechanism' );
	const tierIndex = parts.lastIndexOf( 'tier' );
	const pathMechanism = mechanismIndex >= 0 ? parts[ mechanismIndex + 1 ] : null;
	const pathTier = tierIndex >= 0 ? parts[ tierIndex + 1 ] : null;
	if ( mechanismIndex >= 0 && ! pathMechanism ) throw new Error( 'Bloom mechanism route is missing an id.' );
	if ( tierIndex >= 0 && ! pathTier ) throw new Error( 'Bloom tier route is missing an id.' );
	if ( pathMechanism !== null && ! BLOOM_MECHANISMS.includes( pathMechanism ) ) throw new Error( `Unknown bloom mechanism route: ${ pathMechanism }` );
	if ( pathTier !== null && QUALITY_TIERS[ pathTier ] === undefined ) throw new Error( `Unknown bloom tier route: ${ pathTier }` );

	const query = new URLSearchParams( String( search ) );
	const queryMechanism = queryValue( query, 'mechanism' );
	const queryTier = queryValue( query, 'tier' );
	const queryScenario = queryValue( query, 'scenario' );
	const queryMode = queryValue( query, 'mode' );
	const queryCamera = queryValue( query, 'camera' );
	if ( queryMechanism !== null && ! BLOOM_MECHANISMS.includes( queryMechanism ) ) throw new Error( `Unknown bloom mechanism query: ${ queryMechanism }` );
	if ( queryTier !== null && QUALITY_TIERS[ queryTier ] === undefined ) throw new Error( `Unknown bloom tier query: ${ queryTier }` );
	if ( queryScenario !== null && ! BLOOM_SCENARIOS.includes( queryScenario ) ) throw new Error( `Unknown bloom scenario query: ${ queryScenario }` );
	if ( queryMode !== null && ! BLOOM_MODE_VALUES.includes( queryMode ) ) throw new Error( `Unknown bloom mode query: ${ queryMode }` );
	if ( queryCamera !== null && ! BLOOM_CAMERAS.includes( queryCamera ) ) throw new Error( `Unknown bloom camera query: ${ queryCamera }` );

	const mechanism = pathMechanism ?? queryMechanism;
	const tier = pathTier ?? queryTier ?? 'full';
	const validationRequested = parseBooleanFlag( queryValue( query, 'validation' ), 'validation' );
	return {
		mechanism,
		tier,
		scenario: mechanism ?? queryScenario ?? 'shared-emissive-integration',
		mode: mechanism ?? queryMode ?? DEBUG_MODES.COMBINED,
		seed: parseSeed( queryValue( query, 'seed' ) ),
		camera: queryCamera ?? 'design',
		time: parseTime( queryValue( query, 'time' ) ),
		validationDiagnostics: mechanism === 'transparent-emitters' || validationRequested
	};

}
