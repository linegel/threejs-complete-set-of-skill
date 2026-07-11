import * as THREE from 'three/webgpu';

export const TAU = Math.PI * 2;
export const CAPILLARY_SURFACE_TENSION_OVER_DENSITY = 7.28e-5;
export const OCEAN_BASE_STORAGE_TEXTURES_PER_CASCADE = 15;
export const OCEAN_COMBINED_STORAGE_TEXTURES = 0;

export const OCEAN_MECHANISM_ROUTES = Object.freeze( [
	'spectrum-and-fft',
	'dispersion-and-cascades',
	'derivatives-and-jacobian',
	'whitecaps-and-foam',
	'above-and-below-surface',
	'cpu-query-parity'
] );

export const OCEAN_COMPUTE_BINDING_REQUIREMENTS = Object.freeze( {
	spectrumInitialization: 4,
	evolution: 2,
	fftStage: 2,
	portableDisplacementAssembly: 3,
	portableDerivativeAssembly: 3,
	portableJacobianAssembly: 3,
	foamReaction: 3,
	fusedAssembly: 7
} );

export const OCEAN_EXAMPLE_CLAIM_BOUNDARY = Object.freeze( {
	classification: 'numerical-integration-scaffold',
	proves: Object.freeze( [
		'explicit unnormalized inverse-DFT convention and CPU fixtures',
		'dimensional spectrum-to-wavevector coefficient construction',
		'r185 StorageTexture compute graph construction',
		'exact resolved-band choppy-surface tangent formula in the material',
		'native-resolution per-cascade displacement, derivative, and Lagrangian foam histories'
	] ),
	doesNotProve: Object.freeze( [
		'GPU coefficients equal the CPU mirror within a measured tolerance',
		'half-float FFT precision is acceptable',
		'multicascade surface and foam GPU readback matches the CPU oracle',
		'full scene-depth refraction, receiver caustics, or below-surface volumetric transport',
		'sustained performance, mobile thermal behavior, or production resource lifetime'
	] )
} );

export const OCEAN_QUALITY_TIERS = Object.freeze( {
	ultra: Object.freeze( {
		name: 'ultra',
		resolution: 512,
		cascadeCount: 3,
		packedFieldCount: 4,
		textureType: THREE.HalfFloatType,
		target: 'unmeasured-current-adapter',
		storageBudgetMiB: 104
	} ),
	high: Object.freeze( {
		name: 'high',
		resolution: 256,
		cascadeCount: 3,
		packedFieldCount: 4,
		textureType: THREE.HalfFloatType,
		target: 'unmeasured-current-adapter',
		storageBudgetMiB: 28
	} ),
	medium: Object.freeze( {
		name: 'medium',
		resolution: 256,
		cascadeCount: 2,
		packedFieldCount: 4,
		textureType: THREE.HalfFloatType,
		target: 'unmeasured-current-adapter',
		storageBudgetMiB: 22
	} ),
	low: Object.freeze( {
		name: 'low',
		resolution: 128,
		cascadeCount: 1,
		packedFieldCount: 4,
		textureType: THREE.HalfFloatType,
		target: 'unmeasured-current-adapter',
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
	normal: 6,
	'spectrum-fft': 7,
	'cascade-bands': 8,
	'underwater-optics': 9,
	'cpu-query': 10,
	'no-post': 11,
	diagnostics: 12
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
	capillarySurfaceTensionOverDensity: CAPILLARY_SURFACE_TENSION_OVER_DENSITY,
	choppiness: 1.3,
	foamRecovery: 0.22,
	foamThreshold: 0.4,
	foamScale: 2.5,
	enablePerCascadeFoamHistory: true,
	seed: 0x1f2e3d4c,
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

export const WEBGPU_REQUIRED_ROUTE_MESSAGE = 'WebGPU backend required for the FFT-ocean numerical integration scaffold.';

export function chooseOceanTier( renderer, requested = 'high' ) {
	const capabilities = validateOceanCapabilities( renderer, OCEAN_QUALITY_TIERS[ requested ] ?? OCEAN_QUALITY_TIERS.high );
	const webgpu = capabilities.nativeStorage === true;

	if ( webgpu !== true ) {
		throw new Error( WEBGPU_REQUIRED_ROUTE_MESSAGE );
	}

	const tier = OCEAN_QUALITY_TIERS[ requested ];

	if ( ! tier ) {
		throw new Error( `Unknown ocean quality tier "${ requested }".` );
	}

	return {
		...tier,
		dynamicFft: true,
		source: 'webgpu-tsl-compute',
		capabilities
	};
}

export function mergeOceanConfig( options = {} ) {
	const quality = options.quality ?? DEFAULT_OCEAN_CONFIG.quality;
	const tier = OCEAN_QUALITY_TIERS[ quality ] ?? OCEAN_QUALITY_TIERS.high;
	const patchLengthsMeters = options.patchLengthsMeters ?? options.patchLengths ?? DEFAULT_OCEAN_CONFIG.patchLengthsMeters;

	const resolvedPatchLengths = [ ...patchLengthsMeters ].slice( 0, options.cascadeCount ?? tier.cascadeCount );
	return {
		...DEFAULT_OCEAN_CONFIG,
		...tier,
		...options,
		quality,
		patchLengthsMeters: resolvedPatchLengths,
		sunDirection: new THREE.Vector3( ...( options.sunDirection ?? DEFAULT_OCEAN_CONFIG.sunDirection ) ).normalize(),
		local: { ...DEFAULT_OCEAN_CONFIG.local, ...options.local },
		swell: { ...DEFAULT_OCEAN_CONFIG.swell, ...options.swell }
	};
}

export function isPowerOfTwo( value ) {
	return Number.isInteger( value ) && value > 0 && ( value & ( value - 1 ) ) === 0;
}

export function hashOceanSeedUint32( x, y, seed, salt ) {
	let state = (
		Math.imul( x >>> 0, 0x9e3779b9 ) ^
		Math.imul( y >>> 0, 0x85ebca6b ) ^
		( seed >>> 0 ) ^
		Math.imul( salt >>> 0, 0xc2b2ae35 )
	) >>> 0;
	state = ( state ^ ( state >>> 16 ) ) >>> 0;
	state = Math.imul( state, 0x7feb352d ) >>> 0;
	state = ( state ^ ( state >>> 15 ) ) >>> 0;
	state = Math.imul( state, 0x846ca68b ) >>> 0;
	state = ( state ^ ( state >>> 16 ) ) >>> 0;
	return state;
}

export function hashOceanSeedUnit( x, y, seed, salt ) {
	return ( ( hashOceanSeedUint32( x, y, seed, salt ) >>> 8 ) + 0.5 ) / 0x1000000;
}

export function validateOceanConfig( config ) {
	const errors = [];
	const resolution = config.resolution;
	const patchLengths = config.patchLengthsMeters ?? config.patchLengths ?? [];
	const cascadeCount = config.cascadeCount ?? patchLengths.length;

	if ( ! OCEAN_QUALITY_TIERS[ config.quality ] ) {
		errors.push( `unknown quality tier "${ config.quality }"` );
	}

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

	if ( ! Number.isFinite( config.capillarySurfaceTensionOverDensity ) || config.capillarySurfaceTensionOverDensity < 0 ) {
		errors.push( 'capillarySurfaceTensionOverDensity must be finite and non-negative' );
	}

	if ( ! Number.isFinite( config.choppiness ) || config.choppiness < 0 ) {
		errors.push( 'choppiness must be finite and non-negative' );
	}
	if ( ! Number.isFinite( config.foamRecovery ) || config.foamRecovery <= 0 ) {
		errors.push( 'foamRecovery must be finite and positive' );
	}
	if ( ! Number.isFinite( config.foamThreshold ) || ! Number.isFinite( config.foamScale ) || config.foamScale < 0 ) {
		errors.push( 'foamThreshold and non-negative foamScale must be finite' );
	}
	if ( ! Number.isInteger( config.seed ) || config.seed < 0 || config.seed > 0xffffffff ) {
		errors.push( 'seed must be a uint32 integer' );
	}

	if ( typeof config.enablePerCascadeFoamHistory !== 'boolean' ) {
		errors.push( 'enablePerCascadeFoamHistory must be boolean' );
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
		cutoffHigh: Math.min(
			index === patchLengths.length - 1 ? Infinity : handoff( index + 1 ),
			Math.PI * config.resolution / patchLength
		),
		seed: ( config.seed + index * 1013 ) >>> 0,
		gravity: config.gravity,
		capillarySurfaceTensionOverDensity: config.capillarySurfaceTensionOverDensity,
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
	const perCascade = OCEAN_BASE_STORAGE_TEXTURES_PER_CASCADE + ( config.enablePerCascadeFoamHistory ? 2 : 0 );
	return perCascade * config.cascadeCount + OCEAN_COMBINED_STORAGE_TEXTURES;
}

export function validateOceanCapabilities( renderer, config = {} ) {
	const backend = renderer?.backend ?? null;
	const isWebGPUBackend = backend?.isWebGPUBackend === true;
	const initialized = renderer?.initialized === true;
	const hasFeature = typeof renderer?.hasFeature === 'function' && initialized;
	const textureType = config.textureType ?? THREE.HalfFloatType;
	const missingRequirementReason = [];
	const maxStorageTexturesPerShaderStage = backend?.device?.limits?.maxStorageTexturesPerShaderStage ?? null;
	const requiredPortableStorageTextures = Math.max( ...Object.entries( OCEAN_COMPUTE_BINDING_REQUIREMENTS )
		.filter( ( [ name ] ) => name !== 'fusedAssembly' )
		.map( ( [ , count ] ) => count ) );

	if ( isWebGPUBackend === false ) missingRequirementReason.push( 'WebGPU backend required' );
	if ( initialized === false ) missingRequirementReason.push( 'renderer not initialized' );
	if ( typeof renderer?.compute !== 'function' ) missingRequirementReason.push( 'renderer.compute submission unavailable' );
	if ( typeof THREE.StorageTexture !== 'function' ) missingRequirementReason.push( 'StorageTexture constructor unavailable' );
	if ( ! [ THREE.HalfFloatType, THREE.FloatType ].includes( textureType ) ) missingRequirementReason.push( 'unsupported storage texture type' );
	if ( maxStorageTexturesPerShaderStage === null ) {
		missingRequirementReason.push( 'maxStorageTexturesPerShaderStage unavailable after renderer initialization' );
	} else if ( maxStorageTexturesPerShaderStage < requiredPortableStorageTextures ) {
		missingRequirementReason.push( `portable ocean graph requires ${ requiredPortableStorageTextures } storage textures but device limit is ${ maxStorageTexturesPerShaderStage }` );
	}

	const float32Filterable = hasFeature ? renderer.hasFeature( 'float32-filterable' ) === true : null;
	const timestampQuery = hasFeature ? renderer.hasFeature( 'timestamp-query' ) === true : null;
	if ( textureType === THREE.FloatType && float32Filterable !== true ) {
		missingRequirementReason.push( 'FloatType sampled outputs require the float32-filterable feature' );
	}
	const assemblyMode = maxStorageTexturesPerShaderStage !== null && maxStorageTexturesPerShaderStage >= 7
		? 'fused-7-storage-textures'
		: 'portable-split-3-storage-textures';
	const filterableSamplingStrategy = 'filter storage outputs directly after capability validation';

	return {
		nativeStorage: missingRequirementReason.length === 0,
		isWebGPUBackend,
		initialized,
		textureType,
		float32Filterable,
		timestampQuery,
		maxStorageTexturesPerShaderStage,
		requiredPortableStorageTextures,
		assemblyMode,
		filterableSamplingStrategy,
		missingRequirementReason
	};
}

export function validateOceanComputeLayouts( capabilities ) {
	const limit = capabilities?.maxStorageTexturesPerShaderStage;
	if ( ! Number.isInteger( limit ) || limit < 1 ) throw new Error( 'Initialized adapter storage-texture limit is unavailable.' );
	const selected = Object.fromEntries( Object.entries( OCEAN_COMPUTE_BINDING_REQUIREMENTS )
		.filter( ( [ name ] ) => name !== 'fusedAssembly' || capabilities.assemblyMode === 'fused-7-storage-textures' ) );
	const overLimit = Object.entries( selected ).filter( ( [ , count ] ) => count > limit );
	if ( overLimit.length > 0 ) {
		throw new Error( `Ocean compute layout exceeds adapter storage-texture limit ${ limit }: ${ overLimit.map( ( [ name, count ] ) => `${ name }=${ count }` ).join( ', ' ) }.` );
	}
	return Object.freeze( {
		status: 'declared-layouts-gated-before-node-construction',
		adapterLimit: limit,
		assemblyMode: capabilities.assemblyMode,
		selectedBindings: Object.freeze( selected ),
		maximumSelectedBindings: Math.max( ...Object.values( selected ) )
	} );
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
