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
// Authored fixture limits, not detected device capabilities.
const DEFAULT_MAX_EDGE = 128;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Creates bounded RGBA8 transform data. Pass the actual device dimension limit
 * and the caller's upload budget when admitting this texture to a GPU graph.
 * @param {number} size
 * @param {{maxTextureDimension3D?: number, maxBytes?: number}} [options]
 * @returns {Data3DTexture}
 */
export function createIdentity3DLut( size, options = {} ) {

	if ( ! Number.isSafeInteger( size ) || size < 2 ) {

		throw new RangeError( 'Identity LUT edge must be a safe integer greater than one.' );

	}
	if ( options === null || typeof options !== 'object' || Array.isArray( options ) ) {

		throw new TypeError( 'Identity LUT options must be an object.' );

	}
	const { maxTextureDimension3D = DEFAULT_MAX_EDGE, maxBytes = DEFAULT_MAX_BYTES } = options;
	if ( ! Number.isSafeInteger( maxTextureDimension3D ) || maxTextureDimension3D < 1 ||
		! Number.isSafeInteger( maxBytes ) || maxBytes < 1 ) {

		throw new RangeError( 'Identity LUT limits must be positive safe integers.' );

	}
	if ( size > maxTextureDimension3D ) {

		throw new RangeError( 'Identity LUT exceeds the texture dimension limit.' );

	}
	const voxelCount = size ** 3;
	const byteCount = voxelCount * CHANNELS;
	if ( ! Number.isSafeInteger( voxelCount ) || ! Number.isSafeInteger( byteCount ) ) {

		throw new RangeError( 'Identity LUT byte count must be a safe integer.' );

	}
	if ( byteCount > maxBytes ) {

		throw new RangeError( 'Identity LUT exceeds the byte budget.' );

	}
	const data = new Uint8Array( byteCount );
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
	texture.userData.logicalBytes = byteCount;
	texture.userData.maxQuantizationError = 0.5 / MAX_CODE;
	texture.userData.domain = Object.freeze( {
		input: 'tone-mapped linear working primaries',
		output: 'tone-mapped linear working primaries',
		legalRange: Object.freeze( [ 0, 1 ] ),
		interpolation: 'trilinear',
		placement: 'after toneMapping(), before renderOutput()'
	} );

	return texture;

}
