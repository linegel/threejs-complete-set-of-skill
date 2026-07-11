export function scenarioHref( scenarioId, pageHref ) {

	if ( typeof scenarioId !== 'string' || scenarioId.length === 0 ) {

		throw new TypeError( 'scenarioId must be a non-empty string.' );

	}

	return new URL( `./scenario/${ encodeURIComponent( scenarioId ) }/`, pageHref ).href;

}
