const installedAt = performance.now();
const events = [];
const originalConsoleError = console.error.bind( console );

function messageOf( value ) {

	if ( value instanceof Error ) return `${ value.name }: ${ value.message }`;
	if ( typeof value === 'string' ) return value;
	try {

		return JSON.stringify( value );

	} catch {

		return String( value );

	}

}

function record( kind, value ) {

	events.push( Object.freeze( {
		kind,
		message: messageOf( value ),
		atMs: performance.now()
	} ) );

}

addEventListener( 'error', ( event ) => record( 'page-error', event.error ?? event.message ) );
addEventListener( 'unhandledrejection', ( event ) => record( 'unhandled-rejection', event.reason ) );
console.error = ( ...values ) => {

	record( 'console-error', values.map( messageOf ).join( ' ' ) );
	originalConsoleError( ...values );

};

window.__THREEJS_PHYSICAL_OBSERVER__ = Object.freeze( {
	installedAt,
	record,
	snapshot() {

		return Object.freeze( {
			installedAt,
			capturedAt: performance.now(),
			events: events.map( ( event ) => ( { ...event } ) )
		} );

	}
} );
