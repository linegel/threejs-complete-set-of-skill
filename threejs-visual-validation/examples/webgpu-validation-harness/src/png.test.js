import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertNonBlankGeneratedPng,
	createRgbaPng,
	decodeGeneratedRgbaPixels,
	decodeGeneratedRgbaPng
} from './png.js';

function usefulPng() {

	return createRgbaPng( 16, 12, ( x, y ) => [ x * 12, y * 16, ( x ^ y ) * 8, 255 ] );

}

test( 'PNG evidence decoding verifies dimensions, filters, CRCs, and terminal chunk closure', () => {

	const png = usefulPng();
	assert.deepEqual( decodeGeneratedRgbaPixels( png ).pixels.length, 16 * 12 * 4 );
	assert.deepEqual( assertNonBlankGeneratedPng( png, 'useful.png' ), {
		width: 16,
		height: 12,
		min: 0,
		max: 180,
		opaquePixels: 192
	} );
	const corrupt = Buffer.from( png );
	corrupt[ corrupt.length - 8 ] ^= 1;
	assert.throws( () => decodeGeneratedRgbaPng( corrupt ), /CRC mismatch/ );
	assert.throws( () => decodeGeneratedRgbaPng( png.subarray( 0, png.length - 12 ) ), /missing IHDR, IDAT, or IEND|truncated/ );
	assert.throws( () => decodeGeneratedRgbaPng( Buffer.concat( [ png, Buffer.from( [ 0 ] ) ] ) ), /trailing bytes/ );

} );

test( 'flat or transparent PNGs cannot satisfy visual evidence', () => {

	const flat = createRgbaPng( 16, 12, () => [ 20, 20, 20, 255 ] );
	const transparent = createRgbaPng( 16, 12, ( x, y ) => [ x * 12, y * 16, 0, 0 ] );
	assert.throws( () => assertNonBlankGeneratedPng( flat, 'flat.png' ), /blank or effectively flat/ );
	assert.throws( () => assertNonBlankGeneratedPng( transparent, 'transparent.png' ), /blank or effectively flat/ );

} );
