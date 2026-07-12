export const FALLBACK_MECHANISM_IDS = Object.freeze( [
	'explicit-activation-gate',
	'ordered-degradation-trace',
	'bounded-water-loss-oracle',
	'invariant-ledger',
	'force-webgl-branch-isolation',
	'maintenance-acceptance'
] );

export function resolveFallbackMechanismId( { metadataId = null, search = '' } = {} ) {

	const parameters = new URLSearchParams( search );
	const queryIds = parameters.getAll( 'mechanism' );
	if ( queryIds.length > 1 ) throw new RangeError( 'Fallback mechanism route is duplicated.' );
	const queryId = queryIds[ 0 ] ?? null;
	if ( metadataId !== null && queryId !== null && metadataId !== queryId ) {

		throw new RangeError( `Fallback mechanism route conflict: ${ metadataId } versus ${ queryId }.` );

	}
	const id = metadataId ?? queryId;
	if ( id === null ) return null;
	if ( ! FALLBACK_MECHANISM_IDS.includes( id ) ) throw new RangeError( `Unknown fallback mechanism: ${ id }` );
	return id;

}
