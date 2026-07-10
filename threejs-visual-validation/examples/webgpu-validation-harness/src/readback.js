const WEBGPU_BYTES_PER_ROW_ALIGNMENT = 256;

function requirePositiveInteger( value, label ) {

	if ( Number.isInteger( value ) === false || value <= 0 ) {

		throw new Error( `${ label } must be a positive integer.` );

	}

}

export function getAlignedReadbackLayout( width, height, bytesPerTexel = 4 ) {

	requirePositiveInteger( width, 'readback width' );
	requirePositiveInteger( height, 'readback height' );
	requirePositiveInteger( bytesPerTexel, 'readback bytesPerTexel' );

	const rowBytes = width * bytesPerTexel;
	const bytesPerRow = Math.ceil( rowBytes / WEBGPU_BYTES_PER_ROW_ALIGNMENT ) * WEBGPU_BYTES_PER_ROW_ALIGNMENT;
	const minimumByteLength = bytesPerRow * ( height - 1 ) + rowBytes;
	const fullyPaddedByteLength = bytesPerRow * height;

	return {
		width,
		height,
		bytesPerTexel,
		rowBytes,
		bytesPerRow,
		minimumByteLength,
		fullyPaddedByteLength,
		alignment: WEBGPU_BYTES_PER_ROW_ALIGNMENT
	};

}

export function validateAlignedReadbackLayout( layout ) {

	if ( layout === null || typeof layout !== 'object' ) throw new Error( 'readback layout must be an object.' );
	const expected = getAlignedReadbackLayout( layout.width, layout.height, layout.bytesPerTexel );

	for ( const key of [ 'rowBytes', 'bytesPerRow', 'minimumByteLength', 'fullyPaddedByteLength', 'alignment' ] ) {

		if ( Number.isInteger( layout[ key ] ) === false ) throw new Error( `readback.${ key } must be an integer.` );
		if ( layout[ key ] !== expected[ key ] ) throw new Error( `readback.${ key } does not match the 256-byte aligned WebGPU layout.` );

	}

	return true;

}

/**
 * Converts renderer readback containing padded WebGPU rows into a tightly
 * packed byte array. r185 backends can expose either the minimum copy length
 * (last row tight) or a fully padded final row; both layouts are valid.
 */
export function unpackAlignedReadback( source, width, height, bytesPerTexel = 4 ) {

	if ( ArrayBuffer.isView( source ) === false ) throw new Error( 'readback source must be an ArrayBuffer view.' );
	const layout = getAlignedReadbackLayout( width, height, bytesPerTexel );
	const bytes = new Uint8Array( source.buffer, source.byteOffset, source.byteLength );

	if ( bytes.byteLength !== layout.minimumByteLength && bytes.byteLength !== layout.fullyPaddedByteLength ) {

		throw new Error( `readback byte length ${ bytes.byteLength } is incompatible with integer row stride ${ layout.bytesPerRow }.` );

	}

	const packed = new Uint8Array( layout.rowBytes * height );
	for ( let y = 0; y < height; y ++ ) {

		const sourceOffset = y * layout.bytesPerRow;
		const targetOffset = y * layout.rowBytes;
		packed.set( bytes.subarray( sourceOffset, sourceOffset + layout.rowBytes ), targetOffset );

	}

	return { pixels: packed, layout, sourceByteLength: bytes.byteLength };

}

export const WEBGPU_READBACK_ALIGNMENT = WEBGPU_BYTES_PER_ROW_ALIGNMENT;
