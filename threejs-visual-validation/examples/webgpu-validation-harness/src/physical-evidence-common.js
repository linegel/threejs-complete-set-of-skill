export const PHYSICAL_EVIDENCE_SCHEMA_VERSION = 1;
export const CORRECTNESS_PROFILE = 'correctness';
export const PHYSICAL_ROUTE_PROFILE = 'physical-route';
export const HARDWARE_PERFORMANCE_PROFILE = 'performance';

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
