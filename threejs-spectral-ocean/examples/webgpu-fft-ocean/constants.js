import * as THREE from 'three/webgpu';

export const TAU = Math.PI * 2;
export const OCEAN_STORAGE_TEXTURES_PER_CASCADE = 17;

export const OCEAN_QUALITY_TIERS = Object.freeze( {
	ultra: Object.freeze( {
		name: 'ultra',
		resolution: 512,
		cascadeCount: 3,
		packedFieldCount: 4,
		textureType: THREE.HalfFloatType,
		target: 'desktop-discrete',
		targetSimulationMs: [ 2.5, 4.0 ],
		storageBudgetMiB: 104
	} ),
	high: Object.freeze( {
		name: 'high',
		resolution: 256,
		cascadeCount: 3,
		packedFieldCount: 4,
		textureType: THREE.HalfFloatType,
		target: 'desktop-integrated',
		targetSimulationMs: [ 1.5, 3.0 ],
		storageBudgetMiB: 28
	} ),
	medium: Object.freeze( {
		name: 'medium',
		resolution: 256,
		cascadeCount: 2,
		packedFieldCount: 4,
		textureType: THREE.HalfFloatType,
		target: 'balanced',
		targetSimulationMs: [ 1.2, 2.4 ],
		storageBudgetMiB: 22
	} ),
	low: Object.freeze( {
		name: 'low',
		resolution: 128,
		cascadeCount: 1,
		packedFieldCount: 4,
		textureType: THREE.HalfFloatType,
		target: 'mobile-or-budgeted-webgpu',
		targetSimulationMs: [ 0.7, 2.0 ],
		storageBudgetMiB: 8
	} )
} );

export const OCEAN_DEBUG_MODES = Object.freeze( {
	final: 0,
	height: 1,
	displacement: 2,
	slopes: 3,
	jacobian: 4,
	foam: 5,
	normal: 6
} );

export const PACKED_FIELD_LAYOUT = Object.freeze( {
	horizontalDisplacement: 0,
	heightAndCrossDerivative: 1,
	heightSlopes: 2,
	horizontalDerivatives: 3
} );

export const DEFAULT_OCEAN_CONFIG = Object.freeze( {
	quality: 'high',
	resolution: 256,
	patchLengthsMeters: Object.freeze( [ 250, 17, 5 ] ),
	boundaryFactor: 6,
	depthMeters: 500,
	gravity: 9.81,
	choppiness: 1.3,
	foamRecovery: 0.22,
	foamThreshold: 0.4,
	foamScale: 2.5,
	seed: 0x1f2e3d4c,
	surfaceSizeMeters: 400,
	sunDirection: Object.freeze( [ -0.42, 0.62, 0.66 ] ),
	local: Object.freeze( {
		windSpeed: 11.5,
		fetchMeters: 65000,
		directionDegrees: 18,
		peakEnhancement: 3.3,
		scale: 0.86,
		directionality: 0.74,
		swell: 0.18,
		shortWaveFade: 0.017
	} ),
	swell: Object.freeze( {
		windSpeed: 18.0,
		fetchMeters: 420000,
		directionDegrees: 62,
		peakEnhancement: 7.2,
		scale: 0.38,
		directionality: 0.91,
		swell: 0.86,
		shortWaveFade: 0.006
	} )
} );

export function chooseOceanTier( renderer, requested = 'high', {
	explicitFallbackWhenWebGPUUnavailable = false
} = {} ) {
	const capabilities = validateOceanCapabilities( renderer, OCEAN_QUALITY_TIERS[ requested ] ?? OCEAN_QUALITY_TIERS.high );
	const webgpu = capabilities.nativeStorage === true;

	if ( webgpu !== true && explicitFallbackWhenWebGPUUnavailable !== true ) {
		throw new Error( 'WebGPU backend required for the canonical FFT ocean path. Only request fallback teaching when the user explicitly asks how to apply fallback when WebGPU is unavailable.' );
	}

	const tierName = webgpu ? requested : 'low';
	const tier = OCEAN_QUALITY_TIERS[ tierName ];

	if ( ! tier ) {
		throw new Error( `Unknown ocean quality tier "${ requested }".` );
	}

	return {
		...tier,
		dynamicFft: webgpu,
		source: webgpu ? 'webgpu-tsl-compute' : 'fallback-teaching-static',
		capabilities
	};
}

export function mergeOceanConfig( options = {} ) {
	const quality = options.quality ?? DEFAULT_OCEAN_CONFIG.quality;
	const tier = OCEAN_QUALITY_TIERS[ quality ] ?? OCEAN_QUALITY_TIERS.high;
	const patchLengthsMeters = options.patchLengthsMeters ?? options.patchLengths ?? DEFAULT_OCEAN_CONFIG.patchLengthsMeters;

	return {
		...DEFAULT_OCEAN_CONFIG,
		...tier,
		...options,
		quality,
		patchLengthsMeters: [ ...patchLengthsMeters ].slice( 0, options.cascadeCount ?? tier.cascadeCount ),
		sunDirection: new THREE.Vector3( ...( options.sunDirection ?? DEFAULT_OCEAN_CONFIG.sunDirection ) ).normalize(),
		local: { ...DEFAULT_OCEAN_CONFIG.local, ...options.local },
		swell: { ...DEFAULT_OCEAN_CONFIG.swell, ...options.swell }
	};
}

export function isPowerOfTwo( value ) {
	return Number.isInteger( value ) && value > 0 && ( value & ( value - 1 ) ) === 0;
}

export function validateOceanConfig( config ) {
	const errors = [];
	const resolution = config.resolution;
	const patchLengths = config.patchLengthsMeters ?? config.patchLengths ?? [];
	const cascadeCount = config.cascadeCount ?? patchLengths.length;

	if ( ! isPowerOfTwo( resolution ) ) {
		errors.push( `resolution must be a positive power of two, got ${ resolution }` );
	}

	if ( cascadeCount < 1 || cascadeCount > 3 ) {
		errors.push( `cascadeCount must be 1, 2, or 3, got ${ cascadeCount }` );
	}

	if ( patchLengths.length !== cascadeCount ) {
		errors.push( `patchLengthsMeters must contain exactly ${ cascadeCount } entries` );
	}

	for ( const [ index, length ] of patchLengths.entries() ) {
		if ( ! Number.isFinite( length ) || length <= 0 ) {
			errors.push( `patchLengthsMeters[${ index }] must be positive and finite` );
		}
		if ( index > 0 && length >= patchLengths[ index - 1 ] ) {
			errors.push( `patchLengthsMeters must be strictly descending from large to small patches; index ${ index - 1 }=${ patchLengths[ index - 1 ] }, index ${ index }=${ length }` );
		}
	}

	if ( ! Number.isFinite( config.boundaryFactor ) || config.boundaryFactor <= 1 ) {
		errors.push( 'boundaryFactor must be finite and greater than 1' );
	}

	if ( ! Number.isFinite( config.depthMeters ) || config.depthMeters <= 0 ) {
		errors.push( 'depthMeters must be finite and positive' );
	}

	if ( ! Number.isFinite( config.gravity ) || config.gravity <= 0 ) {
		errors.push( 'gravity must be finite and positive' );
	}

	if ( ! Number.isFinite( config.choppiness ) || config.choppiness < 0 ) {
		errors.push( 'choppiness must be finite and non-negative' );
	}

	if ( ! [ THREE.HalfFloatType, THREE.FloatType ].includes( config.textureType ) ) {
		errors.push( 'textureType must be HalfFloatType or FloatType for storage writes' );
	}

	const descriptors = errors.length === 0 ? createCascadeDescriptors( config ) : [];
	for ( const descriptor of descriptors ) {
		if ( ! ( descriptor.cutoffLow < descriptor.cutoffHigh ) ) {
			errors.push( `cascade ${ descriptor.index } has inverted cutoff interval [${ descriptor.cutoffLow }, ${ descriptor.cutoffHigh }]` );
		}
	}
	for ( let index = 1; index < descriptors.length; index += 1 ) {
		if ( descriptors[ index - 1 ].cutoffHigh > descriptors[ index ].cutoffLow + 1e-9 ) {
			errors.push( `cascade ${ index - 1 } overlaps cascade ${ index }` );
		}
	}

	const estimatedStorageMiB = estimateOceanStorageMiB( config );
	if ( Number.isFinite( config.storageBudgetMiB ) && estimatedStorageMiB > config.storageBudgetMiB ) {
		errors.push( `estimated storage ${ estimatedStorageMiB.toFixed( 2 ) } MiB exceeds tier budget ${ config.storageBudgetMiB } MiB` );
	}

	if ( errors.length > 0 ) {
		throw new Error( `Invalid WebGPU FFT ocean config:\n- ${ errors.join( '\n- ' ) }` );
	}

	return true;
}

export function createCascadeDescriptors( config ) {
	const patchLengths = config.patchLengthsMeters ?? config.patchLengths;
	const boundaryFactor = config.boundaryFactor;
	const handoff = ( index ) => ( TAU / patchLengths[ index ] ) * boundaryFactor;

	return patchLengths.map( ( patchLength, index ) => ( {
		index,
		resolution: config.resolution,
		patchLength,
		cutoffLow: index === 0 ? 1e-4 : handoff( index ),
		cutoffHigh: index === patchLengths.length - 1 ? 9999 : handoff( index + 1 ),
		seed: ( config.seed + index * 1013 ) >>> 0,
		gravity: config.gravity,
		depthMeters: config.depthMeters,
		choppiness: config.choppiness,
		foamRecovery: config.foamRecovery,
		foamThreshold: config.foamThreshold,
		foamScale: config.foamScale,
		local: { ...config.local },
		swell: { ...config.swell }
	} ) );
}

export function estimateOceanStorageMiB( config ) {
	const bytesPerChannel = config.textureType === THREE.FloatType ? 4 : 2;
	const texels = config.resolution * config.resolution;
	const totalBytes = texels * 4 * bytesPerChannel * countOceanStorageTextures( config );
	return totalBytes / ( 1024 * 1024 );
}

export function countOceanStorageTextures( config ) {
	return OCEAN_STORAGE_TEXTURES_PER_CASCADE * config.cascadeCount;
}

export function validateOceanCapabilities( renderer, config = {} ) {
	const backend = renderer?.backend ?? null;
	const isWebGPUBackend = backend?.isWebGPUBackend === true;
	const initialized = renderer?.initialized === true || typeof renderer?.init !== 'function';
	const hasFeature = typeof renderer?.hasFeature === 'function' && initialized;
	const textureType = config.textureType ?? THREE.HalfFloatType;
	const missingRequirementReason = [];

	if ( isWebGPUBackend === false ) missingRequirementReason.push( 'WebGPU backend required' );
	if ( initialized === false ) missingRequirementReason.push( 'renderer not initialized' );
	if ( typeof renderer?.computeAsync !== 'function' ) missingRequirementReason.push( 'renderer.computeAsync unavailable' );
	if ( typeof THREE.StorageTexture !== 'function' ) missingRequirementReason.push( 'StorageTexture constructor unavailable' );
	if ( ! [ THREE.HalfFloatType, THREE.FloatType ].includes( textureType ) ) missingRequirementReason.push( 'unsupported storage texture type' );

	const float32Filterable = hasFeature ? renderer.hasFeature( 'float32-filterable' ) === true : null;
	const timestampQuery = hasFeature ? renderer.hasFeature( 'timestamp-query' ) === true : null;
	const filterableSamplingStrategy = textureType === THREE.FloatType && float32Filterable !== true
		? 'sample nearest or resolve into HalfFloatType filterable texture'
		: 'filter storage outputs directly after validation';

	return {
		nativeStorage: missingRequirementReason.length === 0,
		isWebGPUBackend,
		initialized,
		textureType,
		float32Filterable,
		timestampQuery,
		filterableSamplingStrategy,
		missingRequirementReason
	};
}

export function createStorageTexture( resolution, {
	type = THREE.HalfFloatType,
	filter = THREE.LinearFilter,
	label = 'ocean-storage'
} = {} ) {
	const texture = new THREE.StorageTexture( resolution, resolution );
	texture.name = label;
	texture.format = THREE.RGBAFormat;
	texture.type = type;
	texture.colorSpace = THREE.NoColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.minFilter = filter;
	texture.magFilter = filter;
	texture.generateMipmaps = false;
	texture.mipmapsAutoUpdate = false;
	texture.needsUpdate = true;
	return texture;
}

export function createButterflyTexture( resolution ) {
	const logResolution = Math.log2( resolution );
	const data = new Float32Array( resolution * logResolution * 4 );

	for ( let stage = 0; stage < logResolution; stage += 1 ) {
		const span = 1 << ( stage + 1 );
		const halfSpan = span >> 1;
		for ( let coordinate = 0; coordinate < resolution; coordinate += 1 ) {
			const local = coordinate & ( span - 1 );
			const offset = local & ( halfSpan - 1 );
			const base = coordinate - local;
			const inputA = base + offset;
			const inputB = inputA + halfSpan;
			const branchSign = local >= halfSpan ? -1 : 1;
			const angle = TAU * offset / span;
			const write = ( stage * resolution + coordinate ) * 4;
			data[ write ] = Math.cos( angle ) * branchSign;
			data[ write + 1 ] = Math.sin( angle ) * branchSign;
			data[ write + 2 ] = inputA / Math.max( resolution - 1, 1 );
			data[ write + 3 ] = inputB / Math.max( resolution - 1, 1 );
		}
	}

	const texture = new THREE.DataTexture( data, resolution, logResolution, THREE.RGBAFormat, THREE.FloatType );
	texture.name = `ocean-butterfly-${ resolution }`;
	texture.colorSpace = THREE.NoColorSpace;
	texture.minFilter = THREE.NearestFilter;
	texture.magFilter = THREE.NearestFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}

export function createBitReverseTexture( resolution ) {
	const logResolution = Math.log2( resolution );
	const data = new Float32Array( resolution * 4 );

	for ( let index = 0; index < resolution; index += 1 ) {
		let value = index;
		let reversed = 0;
		for ( let bit = 0; bit < logResolution; bit += 1 ) {
			reversed = ( reversed << 1 ) | ( value & 1 );
			value >>= 1;
		}
		data[ index * 4 ] = reversed / Math.max( resolution - 1, 1 );
	}

	const texture = new THREE.DataTexture( data, resolution, 1, THREE.RGBAFormat, THREE.FloatType );
	texture.name = `ocean-bit-reverse-${ resolution }`;
	texture.colorSpace = THREE.NoColorSpace;
	texture.minFilter = THREE.NearestFilter;
	texture.magFilter = THREE.NearestFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}
