import {
	ClampToEdgeWrapping,
	Data3DTexture,
	LinearFilter,
	NoColorSpace,
	RGBAFormat,
	UnsignedByteType
} from 'three/webgpu';

export const DEFAULT_LUT_SIZE = 32;

export function createIdentityLutData( size = DEFAULT_LUT_SIZE ) {

	const data = new Uint8Array( size * size * size * 4 );
	let write = 0;

	for ( let b = 0; b < size; b += 1 ) {

		for ( let g = 0; g < size; g += 1 ) {

			for ( let r = 0; r < size; r += 1 ) {

				data[ write ] = Math.round( r / ( size - 1 ) * 255 );
				data[ write + 1 ] = Math.round( g / ( size - 1 ) * 255 );
				data[ write + 2 ] = Math.round( b / ( size - 1 ) * 255 );
				data[ write + 3 ] = 255;
				write += 4;

			}

		}

	}

	return data;

}

export function createIdentityLutTexture( size = DEFAULT_LUT_SIZE ) {

	const texture = new Data3DTexture( createIdentityLutData( size ), size, size, size );
	texture.name = `identity-lut-${ size }`;
	texture.format = RGBAFormat;
	texture.type = UnsignedByteType;
	texture.colorSpace = NoColorSpace;
	texture.minFilter = LinearFilter;
	texture.magFilter = LinearFilter;
	texture.wrapS = ClampToEdgeWrapping;
	texture.wrapT = ClampToEdgeWrapping;
	texture.wrapR = ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.unpackAlignment = 1;
	texture.needsUpdate = true;
	texture.userData.domain = {
		input: 'post-tone-map linear',
		output: 'post-tone-map linear',
		toneMapDependency: 'after toneMapping(), before renderOutput()'
	};

	return texture;

}

export function sampleIdentityLutNearest( data, size, rgb ) {

	const r = Math.round( Math.min( Math.max( rgb[ 0 ], 0 ), 1 ) * ( size - 1 ) );
	const g = Math.round( Math.min( Math.max( rgb[ 1 ], 0 ), 1 ) * ( size - 1 ) );
	const b = Math.round( Math.min( Math.max( rgb[ 2 ], 0 ), 1 ) * ( size - 1 ) );
	const index = ( ( b * size * size ) + ( g * size ) + r ) * 4;

	return [
		data[ index ] / 255,
		data[ index + 1 ] / 255,
		data[ index + 2 ] / 255
	];

}
