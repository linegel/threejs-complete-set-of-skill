import {
	ClampToEdgeWrapping,
	Data3DTexture,
	LinearFilter,
	NoColorSpace,
	RGBAFormat,
	UnsignedByteType
} from 'three/webgpu';

const CHANNELS = 4;
const MAX_CODE = 255;

export function createIdentity3DLut( size ) {

	if ( ! Number.isSafeInteger( size ) || size < 2 ) {

		throw new RangeError( 'Identity LUT edge must be a safe integer greater than one.' );

	}
	const voxelCount = size ** 3;
	const data = new Uint8Array( voxelCount * CHANNELS );
	let offset = 0;

	// x/red varies fastest, followed by y/green and z/blue.
	for ( let blue = 0; blue < size; blue += 1 ) {

		for ( let green = 0; green < size; green += 1 ) {

			for ( let red = 0; red < size; red += 1 ) {

				data[ offset ] = Math.round( red / ( size - 1 ) * MAX_CODE );
				data[ offset + 1 ] = Math.round( green / ( size - 1 ) * MAX_CODE );
				data[ offset + 2 ] = Math.round( blue / ( size - 1 ) * MAX_CODE );
				data[ offset + 3 ] = MAX_CODE;
				offset += CHANNELS;

			}

		}

	}

	const texture = new Data3DTexture( data, size, size, size );
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
	texture.userData.domain = Object.freeze( {
		input: 'tone-mapped linear working primaries',
		output: 'tone-mapped linear working primaries',
		legalRange: Object.freeze( [ 0, 1 ] ),
		interpolation: 'trilinear',
		placement: 'after toneMapping(), before renderOutput()'
	} );

	return texture;

}
