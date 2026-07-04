import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from( [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] );

let crcTable = null;

function getCrcTable() {

	if ( crcTable !== null ) return crcTable;

	crcTable = new Uint32Array( 256 );

	for ( let n = 0; n < 256; n ++ ) {

		let c = n;

		for ( let k = 0; k < 8; k ++ ) {

			c = ( c & 1 ) ? ( 0xedb88320 ^ ( c >>> 1 ) ) : ( c >>> 1 );

		}

		crcTable[ n ] = c >>> 0;

	}

	return crcTable;

}

function crc32( buffer ) {

	const table = getCrcTable();
	let crc = 0xffffffff;

	for ( const byte of buffer ) {

		crc = table[ ( crc ^ byte ) & 0xff ] ^ ( crc >>> 8 );

	}

	return ( crc ^ 0xffffffff ) >>> 0;

}

function chunk( type, data ) {

	const typeBuffer = Buffer.from( type, 'ascii' );
	const length = Buffer.alloc( 4 );
	const crc = Buffer.alloc( 4 );
	const body = Buffer.concat( [ typeBuffer, data ] );

	length.writeUInt32BE( data.length, 0 );
	crc.writeUInt32BE( crc32( body ), 0 );

	return Buffer.concat( [ length, typeBuffer, data, crc ] );

}

export function createRgbaPng( width, height, pixelAt ) {

	if ( ! Number.isInteger( width ) || ! Number.isInteger( height ) || width <= 0 || height <= 0 ) {

		throw new Error( 'PNG dimensions must be positive integers.' );

	}

	const scanlineLength = 1 + width * 4;
	const raw = Buffer.alloc( scanlineLength * height );

	for ( let y = 0; y < height; y ++ ) {

		const rowOffset = y * scanlineLength;
		raw[ rowOffset ] = 0;

		for ( let x = 0; x < width; x ++ ) {

			const [ r, g, b, a ] = pixelAt( x, y );
			const pixelOffset = rowOffset + 1 + x * 4;
			raw[ pixelOffset + 0 ] = r;
			raw[ pixelOffset + 1 ] = g;
			raw[ pixelOffset + 2 ] = b;
			raw[ pixelOffset + 3 ] = a;

		}

	}

	const header = Buffer.alloc( 13 );
	header.writeUInt32BE( width, 0 );
	header.writeUInt32BE( height, 4 );
	header[ 8 ] = 8;
	header[ 9 ] = 6;
	header[ 10 ] = 0;
	header[ 11 ] = 0;
	header[ 12 ] = 0;

	return Buffer.concat( [
		PNG_SIGNATURE,
		chunk( 'IHDR', header ),
		chunk( 'IDAT', deflateSync( raw ) ),
		chunk( 'IEND', Buffer.alloc( 0 ) )
	] );

}

export function createDiagnosticPng( width = 96, height = 64, mode = 'final' ) {

	const modeHash = [ ...mode ].reduce( ( sum, char ) => sum + char.charCodeAt( 0 ), 0 );

	return createRgbaPng( width, height, ( x, y ) => {

		const grid = ( ( Math.floor( x / 8 ) + Math.floor( y / 8 ) ) % 2 ) * 22;
		const r = ( 48 + x * 3 + modeHash + grid ) % 256;
		const g = ( 72 + y * 4 + modeHash * 2 ) % 256;
		const b = ( 96 + x + y * 2 + modeHash * 3 ) % 256;
		return [ r, g, b, 255 ];

	} );

}

export function decodeGeneratedRgbaPng( buffer ) {

	if ( buffer.subarray( 0, PNG_SIGNATURE.length ).equals( PNG_SIGNATURE ) === false ) {

		throw new Error( 'Expected PNG signature.' );

	}

	let offset = PNG_SIGNATURE.length;
	let width = 0;
	let height = 0;
	const idatChunks = [];

	while ( offset < buffer.length ) {

		const length = buffer.readUInt32BE( offset );
		const type = buffer.toString( 'ascii', offset + 4, offset + 8 );
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		const data = buffer.subarray( dataStart, dataEnd );

		if ( type === 'IHDR' ) {

			width = data.readUInt32BE( 0 );
			height = data.readUInt32BE( 4 );

			if ( data[ 8 ] !== 8 || data[ 9 ] !== 6 || data[ 10 ] !== 0 || data[ 11 ] !== 0 || data[ 12 ] !== 0 ) {

				throw new Error( 'Only non-interlaced 8-bit RGBA PNGs are supported by this harness check.' );

			}

		} else if ( type === 'IDAT' ) {

			idatChunks.push( data );

		} else if ( type === 'IEND' ) {

			break;

		}

		offset = dataEnd + 4;

	}

	const raw = inflateSync( Buffer.concat( idatChunks ) );
	const expectedLength = height * ( 1 + width * 4 );

	if ( raw.length !== expectedLength ) {

		throw new Error( `Unexpected PNG payload length: ${ raw.length } !== ${ expectedLength }.` );

	}

	return { width, height, raw };

}

export function decodeGeneratedRgbaPixels( buffer ) {

	const { width, height, raw } = decodeGeneratedRgbaPng( buffer );
	const bytesPerPixel = 4;
	const rowBytes = width * bytesPerPixel;
	const scanlineLength = 1 + rowBytes;
	const pixels = Buffer.alloc( rowBytes * height );

	for ( let y = 0; y < height; y ++ ) {

		const rowOffset = y * scanlineLength;
		const filter = raw[ rowOffset ];
		const sourceOffset = rowOffset + 1;
		const targetOffset = y * rowBytes;
		const previousOffset = targetOffset - rowBytes;

		for ( let x = 0; x < rowBytes; x ++ ) {

			const source = raw[ sourceOffset + x ];
			const left = x >= bytesPerPixel ? pixels[ targetOffset + x - bytesPerPixel ] : 0;
			const up = y > 0 ? pixels[ previousOffset + x ] : 0;
			const upLeft = y > 0 && x >= bytesPerPixel ? pixels[ previousOffset + x - bytesPerPixel ] : 0;
			let value;

			if ( filter === 0 ) {

				value = source;

			} else if ( filter === 1 ) {

				value = source + left;

			} else if ( filter === 2 ) {

				value = source + up;

			} else if ( filter === 3 ) {

				value = source + Math.floor( ( left + up ) / 2 );

			} else if ( filter === 4 ) {

				const p = left + up - upLeft;
				const pa = Math.abs( p - left );
				const pb = Math.abs( p - up );
				const pc = Math.abs( p - upLeft );
				const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
				value = source + predictor;

			} else {

				throw new Error( `Unsupported PNG row filter ${ filter }.` );

			}

			pixels[ targetOffset + x ] = value & 0xff;

		}

	}

	return { width, height, pixels };

}

export function assertNonBlankGeneratedPng( buffer, pathLabel = 'PNG' ) {

	const { width, height, raw } = decodeGeneratedRgbaPng( buffer );
	const scanlineLength = 1 + width * 4;
	let min = 255;
	let max = 0;
	let opaquePixels = 0;

	for ( let y = 0; y < height; y ++ ) {

		const rowOffset = y * scanlineLength;

		if ( raw[ rowOffset ] !== 0 ) {

			throw new Error( `${ pathLabel } uses an unsupported PNG row filter.` );

		}

		for ( let x = 0; x < width; x ++ ) {

			const pixelOffset = rowOffset + 1 + x * 4;
			const r = raw[ pixelOffset + 0 ];
			const g = raw[ pixelOffset + 1 ];
			const b = raw[ pixelOffset + 2 ];
			const a = raw[ pixelOffset + 3 ];

			min = Math.min( min, r, g, b );
			max = Math.max( max, r, g, b );
			if ( a > 0 ) opaquePixels ++;

		}

	}

	if ( opaquePixels === 0 || max - min < 8 ) {

		throw new Error( `${ pathLabel } is blank or effectively flat.` );

	}

	return { width, height, min, max, opaquePixels };

}
