export const PHYSICAL_EVIDENCE_SCHEMA_VERSION = 1;
export const CORRECTNESS_PROFILE = 'correctness';
export const PHYSICAL_ROUTE_PROFILE = 'physical-route';
export const HARDWARE_PERFORMANCE_PROFILE = 'performance';

export function idleRefreshMeasurementComplete( timestamps, minimumDurationMs, minimumIntervals = 120 ) {

	if ( Array.isArray( timestamps ) === false ) throw new Error( 'Idle-refresh completion requires a timestamp array.' );
	if ( Number.isFinite( minimumDurationMs ) === false || minimumDurationMs <= 0 ) throw new Error( 'Idle-refresh minimum duration must be finite and positive.' );
	if ( Number.isInteger( minimumIntervals ) === false || minimumIntervals < 1 ) throw new Error( 'Idle-refresh minimum interval count must be a positive integer.' );
	if ( timestamps.length < minimumIntervals + 1 ) return false;
	const first = timestamps[ 0 ];
	const last = timestamps.at( -1 );
	if ( Number.isFinite( first ) === false || Number.isFinite( last ) === false || last < first ) throw new Error( 'Idle-refresh timestamp endpoints are invalid.' );
	return last - first >= minimumDurationMs;

}

export function requireCaptureTargetResourceFormat( resources ) {

	const renderTargets = resources?.renderTargets;
	if ( Array.isArray( renderTargets ) === false ) throw new Error( 'Physical readback evidence requires a render-target inventory.' );
	const matches = renderTargets.filter( ( target ) => target?.semantic === 'capture-target' );
	if ( matches.length !== 1 ) throw new Error( `Physical readback evidence requires exactly one semantic capture target; found ${ matches.length }.` );
	if ( matches[ 0 ].format !== 'rgba8unorm-srgb' ) throw new Error( `Physical capture target must use rgba8unorm-srgb; received ${ matches[ 0 ].format ?? '<missing>' }.` );
	return matches[ 0 ].format;

}

export function stableStringify( value ) {

	if ( value === null || typeof value !== 'object' ) return JSON.stringify( value );
	if ( Array.isArray( value ) ) return `[${ value.map( stableStringify ).join( ',' ) }]`;
	return `{${ Object.keys( value ).sort().map( ( key ) => `${ JSON.stringify( key ) }:${ stableStringify( value[ key ] ) }` ).join( ',' ) }}`;

}

export async function sha256Hex( value ) {

	const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode( typeof value === 'string' ? value : stableStringify( value ) );
	const digest = await crypto.subtle.digest( 'SHA-256', bytes );
	return `sha256:${ [ ...new Uint8Array( digest ) ].map( ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' ) }`;

}

export function numericDatum( value, unit, label, source ) {

	return Object.freeze( { value, unit, label, source } );

}
