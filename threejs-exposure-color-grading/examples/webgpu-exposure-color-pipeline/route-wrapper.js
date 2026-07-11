const encoded = document.documentElement.dataset.labRoute;
if ( ! encoded ) throw new Error( 'Exposure route wrapper is missing data-lab-route.' );
const route = JSON.parse( encoded );
for ( const key of [ 'tier', 'mode', 'scenario', 'toneMappingVariant', 'lutVariant' ] ) {

	if ( typeof route[ key ] !== 'string' || route[ key ].length === 0 ) throw new Error( `Exposure route wrapper is missing locked ${ key }.` );

}
globalThis.__LAB_LOCKED_ROUTE__ = Object.freeze( route );
await import( './browser-app.js' );
