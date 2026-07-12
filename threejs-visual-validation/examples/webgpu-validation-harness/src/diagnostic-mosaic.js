export const DIAGNOSTIC_MOSAIC_RECIPE = 'quadrant-nearest-v1';

export const DIAGNOSTIC_MOSAIC_SOURCES = Object.freeze( [
	'final.design.png',
	'no-post.design.png',
	'diagnostic.normal.png',
	'diagnostic.emissive.png'
] );

function sourceEntry( sources, filename ) {

	const entry = sources instanceof Map ? sources.get( filename ) : sources?.[ filename ];
	if ( entry === undefined ) throw new Error( `Diagnostic mosaic is missing named source ${ filename }.` );
	if ( Number.isInteger( entry.width ) === false || Number.isInteger( entry.height ) === false || ArrayBuffer.isView( entry.data ) === false ) throw new Error( `Diagnostic mosaic source ${ filename } is not a retained RGBA readback.` );
	if ( entry.data.byteLength !== entry.width * entry.height * 4 ) throw new Error( `Diagnostic mosaic source ${ filename } byte length does not match its extent.` );
	return entry;

}

export function reconstructDiagnosticMosaic( sources, { hashPixels = null } = {} ) {

	if ( hashPixels !== null && typeof hashPixels !== 'function' ) throw new TypeError( 'Diagnostic mosaic hashPixels option must be a function.' );
	const entries = DIAGNOSTIC_MOSAIC_SOURCES.map( ( filename ) => sourceEntry( sources, filename ) );
	const width = entries[ 0 ].width;
	const height = entries[ 0 ].height;
	if ( entries.some( ( entry ) => entry.width !== width || entry.height !== height ) ) throw new Error( 'Diagnostic mosaic inputs must share dimensions.' );
	const data = new Uint8Array( width * height * 4 );
	const halfWidth = Math.ceil( width / 2 );
	const halfHeight = Math.ceil( height / 2 );

	for ( let y = 0; y < height; y ++ ) for ( let x = 0; x < width; x ++ ) {

		const column = x >= halfWidth ? 1 : 0;
		const row = y >= halfHeight ? 1 : 0;
		const source = entries[ row * 2 + column ];
		const tileWidth = column === 0 ? halfWidth : width - halfWidth;
		const tileHeight = row === 0 ? halfHeight : height - halfHeight;
		const localX = column === 0 ? x : x - halfWidth;
		const localY = row === 0 ? y : y - halfHeight;
		const sourceX = Math.min( width - 1, Math.floor( localX * width / tileWidth ) );
		const sourceY = Math.min( height - 1, Math.floor( localY * height / tileHeight ) );
		const sourceOffset = ( sourceY * width + sourceX ) * 4;
		const targetOffset = ( y * width + x ) * 4;
		data.set( source.data.subarray( sourceOffset, sourceOffset + 4 ), targetOffset );

	}
	const quadrants = entries.map( ( source, index ) => {

		const column = index % 2;
		const row = Math.floor( index / 2 );
		return Object.freeze( {
			source: DIAGNOSTIC_MOSAIC_SOURCES[ index ],
			...( hashPixels === null ? {} : { sourceCompactRgbaSha256: hashPixels( source.data ) } ),
			outputRect: {
				x: column === 0 ? 0 : halfWidth,
				y: row === 0 ? 0 : halfHeight,
				width: column === 0 ? halfWidth : width - halfWidth,
				height: row === 0 ? halfHeight : height - halfHeight
			},
			sampling: 'nearest-floor'
		} );

	} );
	return { width, height, data, recipe: { algorithm: DIAGNOSTIC_MOSAIC_RECIPE, quadrants } };

}
