export const WEBGPU_BYTES_PER_ROW_ALIGNMENT = 256;

function requireInteger( value, label, minimum ) {
	if ( Number.isSafeInteger( value ) === false || value < minimum ) {
		throw new RangeError( `${ label } must be a safe integer >= ${ minimum }.` );
	}
	return value;
}

function safeProduct( left, right, label ) {
	const value = left * right;
	if ( Number.isSafeInteger( value ) === false ) {
		throw new RangeError( `${ label } exceeds the safe integer range.` );
	}
	return value;
}

export function minimumAlignedBytesPerRow(
	width,
	bytesPerTexel = 4
) {
	requireInteger( width, 'width', 1 );
	requireInteger( bytesPerTexel, 'bytesPerTexel', 1 );
	const logicalRowBytes = safeProduct( width, bytesPerTexel, 'logicalRowBytes' );
	const aligned = Math.ceil(
		logicalRowBytes / WEBGPU_BYTES_PER_ROW_ALIGNMENT
	) * WEBGPU_BYTES_PER_ROW_ALIGNMENT;
	return requireInteger( aligned, 'aligned bytesPerRow', logicalRowBytes );
}

export function unpackAlignedReadback( source, options = {} ) {
	if ( ArrayBuffer.isView( source ) === false ) {
		throw new TypeError( 'source must be an ArrayBuffer view.' );
	}
	const {
		width,
		height,
		bytesPerTexel = 4,
		bytesPerRow,
		viewOffset = 0,
		copyOffset = 0
	} = options;
	requireInteger( width, 'width', 1 );
	requireInteger( height, 'height', 1 );
	requireInteger( bytesPerTexel, 'bytesPerTexel', 1 );
	requireInteger( bytesPerRow, 'bytesPerRow', 1 );
	requireInteger( viewOffset, 'viewOffset', 0 );
	requireInteger( copyOffset, 'copyOffset', 0 );

	const logicalRowBytes = safeProduct( width, bytesPerTexel, 'logicalRowBytes' );
	if ( bytesPerRow < logicalRowBytes ) {
		throw new RangeError( 'bytesPerRow is smaller than the logical row payload.' );
	}
	if ( bytesPerRow % WEBGPU_BYTES_PER_ROW_ALIGNMENT !== 0 ) {
		throw new RangeError(
			`bytesPerRow must be aligned to ${ WEBGPU_BYTES_PER_ROW_ALIGNMENT } bytes.`
		);
	}
	if ( copyOffset % bytesPerTexel !== 0 ) {
		throw new RangeError( 'copyOffset must be aligned to bytesPerTexel.' );
	}

	const precedingRowsBytes = safeProduct( height - 1, bytesPerRow, 'precedingRowsBytes' );
	const minimumCopyBytes = precedingRowsBytes + logicalRowBytes;
	const requiredSourceBytes = viewOffset + minimumCopyBytes;
	requireInteger( minimumCopyBytes, 'minimumCopyBytes', 1 );
	requireInteger( requiredSourceBytes, 'required source span', minimumCopyBytes );
	if ( source.byteLength < requiredSourceBytes ) {
		throw new RangeError(
			`source has ${ source.byteLength } bytes; ${ requiredSourceBytes } are required.`
		);
	}

	const packedByteLength = safeProduct( logicalRowBytes, height, 'packedByteLength' );
	const bytes = new Uint8Array( source.buffer, source.byteOffset, source.byteLength );
	const pixels = new Uint8Array( packedByteLength );

	for ( let y = 0; y < height; y ++ ) {
		const sourceRow = viewOffset + y * bytesPerRow;
		const packedRow = y * logicalRowBytes;
		pixels.set(
			bytes.subarray( sourceRow, sourceRow + logicalRowBytes ),
			packedRow
		);
	}

	return {
		pixels,
		layout: {
			width,
			height,
			bytesPerTexel,
			logicalRowBytes,
			bytesPerRow,
			alignment: WEBGPU_BYTES_PER_ROW_ALIGNMENT,
			viewOffset,
			copyOffset,
			minimumCopyBytes
		},
		sourceByteLength: source.byteLength
	};
}
