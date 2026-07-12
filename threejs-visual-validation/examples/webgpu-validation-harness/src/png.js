import {
	compareRgbaPngs,
	decodeRgbaPng,
	encodeRgbaPng,
	inspectRgbaPng
} from '../../../../scripts/lib/png-rgba.mjs';

export function createRgbaPng( width, height, pixelAt ) {

	if ( ! Number.isInteger( width ) || ! Number.isInteger( height ) || width <= 0 || height <= 0 ) {

		throw new Error( 'PNG dimensions must be positive integers.' );

	}
	if ( typeof pixelAt !== 'function' ) throw new TypeError( 'PNG pixel callback is required.' );
	const data = new Uint8Array( width * height * 4 );
	for ( let y = 0; y < height; y ++ ) for ( let x = 0; x < width; x ++ ) {

		data.set( pixelAt( x, y ), ( y * width + x ) * 4 );

	}
	return encodeRgbaPng( { width, height, data } );

}

export function createDiagnosticPng( width = 96, height = 64, mode = 'final' ) {

	const modeHash = [ ...mode ].reduce( ( sum, char ) => sum + char.charCodeAt( 0 ), 0 );
	return createRgbaPng( width, height, ( x, y ) => {

		const grid = ( ( Math.floor( x / 8 ) + Math.floor( y / 8 ) ) % 2 ) * 22;
		return [
			( 48 + x * 3 + modeHash + grid ) % 256,
			( 72 + y * 4 + modeHash * 2 ) % 256,
			( 96 + x + y * 2 + modeHash * 3 ) % 256,
			255
		];

	} );

}

export function decodeGeneratedRgbaPng( buffer ) {

	const { width, height, raw } = decodeRgbaPng( buffer );
	return { width, height, raw };

}

export function decodeGeneratedRgbaPixels( buffer ) {

	const { width, height, pixels } = decodeRgbaPng( buffer );
	return { width, height, pixels };

}

export function compareGeneratedRgbaPngs( baselineBuffer, candidateBuffer ) {

	return compareRgbaPngs( baselineBuffer, candidateBuffer );

}

export function assertNonBlankGeneratedPng( buffer, pathLabel = 'PNG' ) {

	const { width, height, min, max, opaquePixels } = inspectRgbaPng( buffer, pathLabel );
	return { width, height, min, max, opaquePixels };

}
