import {
	ClampToEdgeWrapping,
	Data3DTexture,
	LinearFilter,
	NoColorSpace,
	RGBAFormat,
	UnsignedByteType
} from 'three/webgpu';

export const DEFAULT_LUT_SIZE = 32;
export const MAX_EXAMPLE_LUT_SIZE = 128;
export const LUT_NUMERIC_PROVENANCE = Object.freeze( {
	DEFAULT_LUT_SIZE: 'Authored example baseline; select by measured ramp/swatch error.',
	MAX_EXAMPLE_LUT_SIZE: 'Authored CPU/resident-memory guard for this example, further limited by the WebGPU device.',
	CHANNEL_COUNT: 'Derived RGBA storage.',
	UNSIGNED_BYTE_MAX: 'Derived UnsignedByteType code range.'
} );

const CHANNEL_COUNT = 4;
const UNSIGNED_BYTE_MAX = 255;

export function assertExampleLutSize( size, deviceLimit = MAX_EXAMPLE_LUT_SIZE ) {

	const effectiveLimit = Math.min( MAX_EXAMPLE_LUT_SIZE, deviceLimit );
	if ( ! Number.isSafeInteger( size ) || size < 2 || size > effectiveLimit ) {

		throw new Error( `LUT edge must be a safe integer in [2, ${ effectiveLimit }].` );

	}
	return size;

}

export function createIdentityLutData( size = DEFAULT_LUT_SIZE ) {

	assertExampleLutSize( size );
	const data = new Uint8Array( size * size * size * CHANNEL_COUNT );
	let write = 0;

	for ( let b = 0; b < size; b += 1 ) {

		for ( let g = 0; g < size; g += 1 ) {

			for ( let r = 0; r < size; r += 1 ) {

				data[ write ] = Math.round( r / ( size - 1 ) * UNSIGNED_BYTE_MAX );
				data[ write + 1 ] = Math.round( g / ( size - 1 ) * UNSIGNED_BYTE_MAX );
				data[ write + 2 ] = Math.round( b / ( size - 1 ) * UNSIGNED_BYTE_MAX );
				data[ write + 3 ] = UNSIGNED_BYTE_MAX;
				write += CHANNEL_COUNT;

			}

		}

	}

	return data;

}

export function createIdentityLutTexture( size = DEFAULT_LUT_SIZE ) {

	assertExampleLutSize( size );
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
		workingPrimaries: 'Three.js ColorManagement.workingColorSpace',
		transfer: 'linear',
		legalRange: [ 0, 1 ],
		interpolation: 'trilinear via LinearFilter',
		toneMapDependency: 'after toneMapping(), before renderOutput()'
	};

	return texture;

}

export function createCreativeLutData( size = DEFAULT_LUT_SIZE, {
	warmth = 0.08,
	shadowCyan = 0.035,
	saturation = 1.04
} = {} ) {

	assertExampleLutSize( size );
	const identity = createIdentityLutData( size );
	const data = new Uint8Array( identity.length );
	for ( let index = 0; index < identity.length; index += CHANNEL_COUNT ) {

		const r = identity[ index ] / UNSIGNED_BYTE_MAX;
		const g = identity[ index + 1 ] / UNSIGNED_BYTE_MAX;
		const b = identity[ index + 2 ] / UNSIGNED_BYTE_MAX;
		const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
		const satR = luma + ( r - luma ) * saturation;
		const satG = luma + ( g - luma ) * saturation;
		const satB = luma + ( b - luma ) * saturation;
		const shadowWeight = 1 - Math.min( 1, luma * 2 );
		data[ index ] = Math.round( Math.min( 1, Math.max( 0, satR + warmth * luma ) ) * UNSIGNED_BYTE_MAX );
		data[ index + 1 ] = Math.round( Math.min( 1, Math.max( 0, satG + shadowCyan * shadowWeight * 0.5 ) ) * UNSIGNED_BYTE_MAX );
		data[ index + 2 ] = Math.round( Math.min( 1, Math.max( 0, satB + shadowCyan * shadowWeight - warmth * luma * 0.35 ) ) * UNSIGNED_BYTE_MAX );
		data[ index + 3 ] = UNSIGNED_BYTE_MAX;

	}
	return data;

}

export function createLutTexture( size = DEFAULT_LUT_SIZE, {
	variant = 'identity',
	creative = {}
} = {} ) {

	if ( variant !== 'identity' && variant !== 'creative' ) throw new Error( `Unknown LUT variant "${ variant }".` );
	const data = variant === 'creative'
		? createCreativeLutData( size, creative )
		: createIdentityLutData( size );
	const texture = new Data3DTexture( data, size, size, size );
	texture.name = `${ variant }-lut-${ size }`;
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
		workingPrimaries: 'Three.js ColorManagement.workingColorSpace',
		transfer: 'linear',
		legalRange: [ 0, 1 ],
		interpolation: 'trilinear via LinearFilter',
		toneMapDependency: 'after toneMapping(), before renderOutput()',
		variant
	};
	return texture;

}

function identityTexel( data, size, r, g, b ) {

	const index = ( ( b * size * size ) + ( g * size ) + r ) * CHANNEL_COUNT;

	return [
		data[ index ] / UNSIGNED_BYTE_MAX,
		data[ index + 1 ] / UNSIGNED_BYTE_MAX,
		data[ index + 2 ] / UNSIGNED_BYTE_MAX
	];

}

function mix( a, b, t ) {

	return a + ( b - a ) * t;

}

export function sampleIdentityLutTrilinear( data, size, rgb ) {

	const scaled = rgb.map( ( channel ) => Math.min( Math.max( channel, 0 ), 1 ) * ( size - 1 ) );
	const lower = scaled.map( Math.floor );
	const upper = lower.map( ( value ) => Math.min( value + 1, size - 1 ) );
	const fraction = scaled.map( ( value, index ) => value - lower[ index ] );
	const output = [ 0, 0, 0 ];

	for ( let channel = 0; channel < output.length; channel += 1 ) {

		const c000 = identityTexel( data, size, lower[ 0 ], lower[ 1 ], lower[ 2 ] )[ channel ];
		const c100 = identityTexel( data, size, upper[ 0 ], lower[ 1 ], lower[ 2 ] )[ channel ];
		const c010 = identityTexel( data, size, lower[ 0 ], upper[ 1 ], lower[ 2 ] )[ channel ];
		const c110 = identityTexel( data, size, upper[ 0 ], upper[ 1 ], lower[ 2 ] )[ channel ];
		const c001 = identityTexel( data, size, lower[ 0 ], lower[ 1 ], upper[ 2 ] )[ channel ];
		const c101 = identityTexel( data, size, upper[ 0 ], lower[ 1 ], upper[ 2 ] )[ channel ];
		const c011 = identityTexel( data, size, lower[ 0 ], upper[ 1 ], upper[ 2 ] )[ channel ];
		const c111 = identityTexel( data, size, upper[ 0 ], upper[ 1 ], upper[ 2 ] )[ channel ];
		const c00 = mix( c000, c100, fraction[ 0 ] );
		const c10 = mix( c010, c110, fraction[ 0 ] );
		const c01 = mix( c001, c101, fraction[ 0 ] );
		const c11 = mix( c011, c111, fraction[ 0 ] );
		const c0 = mix( c00, c10, fraction[ 1 ] );
		const c1 = mix( c01, c11, fraction[ 1 ] );
		output[ channel ] = mix( c0, c1, fraction[ 2 ] );

	}

	return output;

}
