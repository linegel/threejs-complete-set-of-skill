export function scenarioHref( scenarioId, pageHref ) {

	if ( typeof scenarioId !== 'string' || scenarioId.length === 0 ) {

		throw new TypeError( 'scenarioId must be a non-empty string.' );

	}

	const labUrl = new URL( pageHref );
	const scenarioMarker = '/scenario/';
	const scenarioIndex = labUrl.pathname.lastIndexOf( scenarioMarker );

	if ( scenarioIndex >= 0 ) {

		labUrl.pathname = labUrl.pathname.slice( 0, scenarioIndex + 1 );

	} else if ( ! labUrl.pathname.endsWith( '/' ) ) {

		labUrl.pathname += '/';

	}

	labUrl.search = '';
	labUrl.hash = '';

	return new URL( `scenario/${ encodeURIComponent( scenarioId ) }/`, labUrl ).href;

}
