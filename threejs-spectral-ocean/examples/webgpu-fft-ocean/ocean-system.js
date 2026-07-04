import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

import {
	PACKED_FIELD_LAYOUT,
	createBitReverseTexture,
	createButterflyTexture,
	createCascadeDescriptors,
	createStorageTexture,
	estimateOceanStorageMiB,
	mergeOceanConfig,
	validateOceanCapabilities,
	validateOceanConfig
} from './constants.js';
import {
	createBitReverseNode,
	createCenterAndAssembleNode,
	createClearTextureNode,
	createEvolutionNode,
	createFftStageNode,
	createSpectrumInitNode
} from './compute-kernels.js';
import { validateFftOceanSelfTests } from './validation.js';

async function submitCompute( renderer, nodes ) {
	const previousRenderTarget = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
	try {
		if ( Array.isArray( nodes ) ) {
			await renderer.computeAsync( nodes );
		} else {
			await renderer.computeAsync( nodes );
		}
	} finally {
		if ( typeof renderer.setRenderTarget === 'function' ) {
			renderer.setRenderTarget( previousRenderTarget );
		}
	}
}

function makeTextureSet( resolution, textureType, cascadeIndex ) {
	return {
		h0: createStorageTexture( resolution, { type: textureType, filter: THREE.NearestFilter, label: `ocean-h0-${ cascadeIndex }` } ),
		gaussianDebug: createStorageTexture( resolution, { type: textureType, filter: THREE.NearestFilter, label: `ocean-gaussian-${ cascadeIndex }` } ),
		spectrumDebug: createStorageTexture( resolution, { type: textureType, filter: THREE.NearestFilter, label: `ocean-spectrum-${ cascadeIndex }` } ),
		maskDebug: createStorageTexture( resolution, { type: textureType, filter: THREE.NearestFilter, label: `ocean-mask-${ cascadeIndex }` } ),
		frequencyA: Object.values( PACKED_FIELD_LAYOUT ).map( ( field ) => createStorageTexture( resolution, { type: textureType, filter: THREE.NearestFilter, label: `ocean-frequency-a-${ cascadeIndex }-${ field }` } ) ),
		frequencyB: Object.values( PACKED_FIELD_LAYOUT ).map( ( field ) => createStorageTexture( resolution, { type: textureType, filter: THREE.NearestFilter, label: `ocean-frequency-b-${ cascadeIndex }-${ field }` } ) ),
		displacement: createStorageTexture( resolution, { type: textureType, filter: THREE.LinearFilter, label: `ocean-displacement-${ cascadeIndex }` } ),
		derivatives: createStorageTexture( resolution, { type: textureType, filter: THREE.LinearFilter, label: `ocean-derivatives-${ cascadeIndex }` } ),
		crossJacobianFoam: createStorageTexture( resolution, { type: textureType, filter: THREE.LinearFilter, label: `ocean-cross-jacobian-foam-${ cascadeIndex }` } ),
		foamHistory: [
			createStorageTexture( resolution, { type: textureType, filter: THREE.LinearFilter, label: `ocean-foam-history-${ cascadeIndex }-0` } ),
			createStorageTexture( resolution, { type: textureType, filter: THREE.LinearFilter, label: `ocean-foam-history-${ cascadeIndex }-1` } )
		]
	};
}

function makeFftPlan( cascade, fieldIndex, resources ) {
	const resolution = cascade.resolution;
	const logResolution = Math.log2( resolution );
	const sourceFrequency = resources.textures.frequencyA[ fieldIndex ];
	const scratchFrequency = resources.textures.frequencyB[ fieldIndex ];
	let source = sourceFrequency;
	let destination = scratchFrequency;

	const bitReverseX = createBitReverseNode( resolution, 0, {
		inputTex: source,
		outputTex: destination,
		bitReverseTex: resources.bitReverseTexture
	} );
	source = destination;
	destination = destination === sourceFrequency ? scratchFrequency : sourceFrequency;

	const horizontalStages = [];
	for ( let stage = 0; stage < logResolution; stage += 1 ) {
		horizontalStages.push( createFftStageNode( resolution, stage, 0, {
			inputTex: source,
			outputTex: destination,
			butterflyTex: resources.butterflyTexture
		} ) );
		source = destination;
		destination = destination === sourceFrequency ? scratchFrequency : sourceFrequency;
	}

	const bitReverseY = createBitReverseNode( resolution, 1, {
		inputTex: source,
		outputTex: destination,
		bitReverseTex: resources.bitReverseTexture
	} );
	source = destination;
	destination = destination === sourceFrequency ? scratchFrequency : sourceFrequency;

	const verticalStages = [];
	for ( let stage = 0; stage < logResolution; stage += 1 ) {
		verticalStages.push( createFftStageNode( resolution, stage, 1, {
			inputTex: source,
			outputTex: destination,
			butterflyTex: resources.butterflyTexture
		} ) );
		source = destination;
		destination = destination === sourceFrequency ? scratchFrequency : sourceFrequency;
	}

	return {
		fieldIndex,
		bitReverseX,
		horizontalStages,
		bitReverseY,
		verticalStages,
		finalTexture: source
	};
}

class WebGPUFftOceanCascade {
	constructor( descriptor, shared, config ) {
		this.index = descriptor.index;
		this.patchLength = descriptor.patchLength;
		this.descriptor = descriptor;
		this.resources = {
			...shared,
			textures: makeTextureSet( descriptor.resolution, config.textureType, descriptor.index )
		};
		this.currentFoamHistory = 0;
		this.initNode = createSpectrumInitNode( descriptor, {
			h0: this.resources.textures.h0,
			gaussianDebug: this.resources.textures.gaussianDebug,
			spectrumDebug: this.resources.textures.spectrumDebug,
			maskDebug: this.resources.textures.maskDebug
		} );
		this.clearFoamNodes = this.resources.textures.foamHistory.map( ( texture, index ) => (
			createClearTextureNode( texture, descriptor.resolution, [ 1, 0, 1, 1 ], `ocean:foam-clear:${ descriptor.index }:${ index }` )
		) );
		this.evolutionNodes = Object.values( PACKED_FIELD_LAYOUT ).map( ( fieldIndex ) => (
			createEvolutionNode( descriptor, fieldIndex, {
				h0: this.resources.textures.h0,
				outputTex: this.resources.textures.frequencyA[ fieldIndex ],
				time: shared.timeUniform
			} )
		) );
		this.fftPlans = Object.values( PACKED_FIELD_LAYOUT ).map( ( fieldIndex ) => makeFftPlan( descriptor, fieldIndex, this.resources ) );
		this.assemblyNodes = [
			this.makeAssemblyNode( 0 ),
			this.makeAssemblyNode( 1 )
		];
	}

	makeAssemblyNode( previousIndex ) {
		const nextIndex = 1 - previousIndex;
		const textures = this.resources.textures;
		const final = this.fftPlans.map( ( plan ) => plan.finalTexture );

		return createCenterAndAssembleNode( this.descriptor, {
			field0: final[ PACKED_FIELD_LAYOUT.horizontalDisplacement ],
			field1: final[ PACKED_FIELD_LAYOUT.heightAndCrossDerivative ],
			field2: final[ PACKED_FIELD_LAYOUT.heightSlopes ],
			field3: final[ PACKED_FIELD_LAYOUT.horizontalDerivatives ],
			previousFoam: textures.foamHistory[ previousIndex ],
			displacement: textures.displacement,
			derivatives: textures.derivatives,
			crossJacobianFoam: textures.crossJacobianFoam,
			foamHistory: textures.foamHistory[ nextIndex ],
			dt: this.resources.dtUniform
		} );
	}

	get displacementTexture() {
		return this.resources.textures.displacement;
	}

	get derivativesTexture() {
		return this.resources.textures.derivatives;
	}

	get crossJacobianFoamTexture() {
		return this.resources.textures.crossJacobianFoam;
	}

	get debugTextures() {
		return {
			gaussianSeedField: this.resources.textures.gaussianDebug,
			inBandSpectrum: this.resources.textures.spectrumDebug,
			inBandMask: this.resources.textures.maskDebug,
			sourceSpectra: {
				gaussianSeedField: this.resources.textures.gaussianDebug,
				combinedSpectrum: this.resources.textures.spectrumDebug,
				inBandMask: this.resources.textures.maskDebug
			},
			timeEvolvedFrequencyMagnitude: this.resources.textures.frequencyA,
			packedRealImagFields: this.resources.textures.frequencyA,
			packedScratchFields: this.resources.textures.frequencyB,
			spatialDisplacement: this.resources.textures.displacement,
			spatialHeight: this.resources.textures.displacement,
			spatialDerivatives: this.resources.textures.derivatives,
			heightSlopes: this.resources.textures.derivatives,
			horizontalDerivatives: this.resources.textures.derivatives,
			crossDerivativeJacobianFoam: this.resources.textures.crossJacobianFoam,
			crossDerivative: this.resources.textures.crossJacobianFoam,
			jacobianDeterminant: this.resources.textures.crossJacobianFoam,
			foamCoverage: this.resources.textures.crossJacobianFoam,
			foamHistory: this.resources.textures.foamHistory[ this.currentFoamHistory ],
			resolvedNormal: this.resources.textures.derivatives,
			subGridNormalContribution: null,
			finalWithoutFoam: null,
			finalWithoutDetail: null
		};
	}

	dispose() {
		const textures = this.resources.textures;
		const disposeTexture = ( texture ) => texture?.dispose?.();
		disposeTexture( textures.h0 );
		disposeTexture( textures.gaussianDebug );
		disposeTexture( textures.spectrumDebug );
		disposeTexture( textures.maskDebug );
		textures.frequencyA.forEach( disposeTexture );
		textures.frequencyB.forEach( disposeTexture );
		disposeTexture( textures.displacement );
		disposeTexture( textures.derivatives );
		disposeTexture( textures.crossJacobianFoam );
		textures.foamHistory.forEach( disposeTexture );
		for ( const node of [
			this.initNode,
			...this.clearFoamNodes,
			...this.evolutionNodes,
			...this.assemblyNodes,
			...this.fftPlans.flatMap( ( plan ) => [ plan.bitReverseX, plan.bitReverseY, ...plan.horizontalStages, ...plan.verticalStages ] )
		] ) {
			node?.dispose?.();
		}
	}
}

export class WebGPUFftOcean {
	constructor( renderer, options = {} ) {
		this.renderer = renderer;
		this.config = mergeOceanConfig( options );
		validateOceanConfig( this.config );
		this.capabilities = validateOceanCapabilities( renderer, this.config );
		this.explicitFallbackWhenWebGPUUnavailable = options.explicitFallbackWhenWebGPUUnavailable === true;
		if ( this.capabilities.nativeStorage !== true && this.explicitFallbackWhenWebGPUUnavailable !== true ) {
			throw new Error( 'WebGPU backend required for the canonical FFT ocean path. Only set explicitFallbackWhenWebGPUUnavailable when the user explicitly asks how to apply fallback when WebGPU is unavailable.' );
		}
		this.fallbackTeachingActive = false;
		this.initialized = false;
		this.timeUniform = uniform( 0 );
		this.dtUniform = uniform( 1 / 60 );
		this.butterflyTexture = null;
		this.bitReverseTexture = null;
		this.cascades = [];
		if ( this.capabilities.nativeStorage === true ) {
			this.createNativeResources();
		}
		this.diagnostics = {
			tier: this.config.quality,
			format: this.config.textureType === THREE.FloatType ? 'rgba32float' : 'rgba16float',
			estimatedStorageMiB: estimateOceanStorageMiB( this.config ),
			dispatchesPerFrame: this.config.cascadeCount * ( 4 + 4 * ( 2 + 2 * Math.log2( this.config.resolution ) ) + 1 ),
			capabilities: this.capabilities
		};
	}

	createNativeResources() {
		if ( this.cascades.length > 0 ) return;

		this.butterflyTexture = createButterflyTexture( this.config.resolution );
		this.bitReverseTexture = createBitReverseTexture( this.config.resolution );
		const shared = {
			butterflyTexture: this.butterflyTexture,
			bitReverseTexture: this.bitReverseTexture,
			timeUniform: this.timeUniform,
			dtUniform: this.dtUniform
		};
		this.cascades = createCascadeDescriptors( this.config ).map( ( descriptor ) => new WebGPUFftOceanCascade( descriptor, shared, this.config ) );
	}

	async allocateStorageTextures() {
		if ( this.capabilities.nativeStorage !== true ) {
			if ( this.explicitFallbackWhenWebGPUUnavailable !== true ) {
				throw new Error( 'WebGPU backend required for the canonical FFT ocean path.' );
			}
			this.useExplicitFallbackTeachingTier( {
				resolution: 128,
				cascades: 1,
				source: 'fallback-teaching-static',
				dynamicFft: false
			} );
			return;
		}

		this.createNativeResources();
		const validation = this.validate( { resolution: Math.min( 16, this.config.resolution ) } );
		this.diagnostics.validation = validation;
		if ( validation.selfTests.pass !== true ) {
			throw new Error( 'WebGPU FFT ocean validation gate failed before storage allocation.' );
		}

		for ( const cascade of this.cascades ) {
			await submitCompute( this.renderer, cascade.initNode );
			await submitCompute( this.renderer, cascade.clearFoamNodes );
		}
		this.initialized = true;
	}

	useExplicitFallbackTeachingTier( tier ) {
		this.fallbackTeachingActive = true;
		this.diagnostics.tier = 'fallback-teaching-static';
		this.diagnostics.fallbackTeachingReason = `${ this.capabilities.missingRequirementReason.join( '; ' ) || 'native storage unavailable' }; no alternate shader backend is created.`;
		this.diagnostics.fallbackTeachingTier = tier;
	}

	async update( timeSeconds, dtSeconds = 1 / 60 ) {
		if ( this.fallbackTeachingActive ) return;
		if ( ! this.initialized ) await this.allocateStorageTextures();

		this.timeUniform.value = timeSeconds;
		this.dtUniform.value = dtSeconds;
		const logResolution = Math.log2( this.config.resolution );

		for ( const cascade of this.cascades ) {
			await submitCompute( this.renderer, cascade.evolutionNodes );
			await submitCompute( this.renderer, cascade.fftPlans.map( ( plan ) => plan.bitReverseX ) );
			for ( let stage = 0; stage < logResolution; stage += 1 ) {
				await submitCompute( this.renderer, cascade.fftPlans.map( ( plan ) => plan.horizontalStages[ stage ] ) );
			}
			await submitCompute( this.renderer, cascade.fftPlans.map( ( plan ) => plan.bitReverseY ) );
			for ( let stage = 0; stage < logResolution; stage += 1 ) {
				await submitCompute( this.renderer, cascade.fftPlans.map( ( plan ) => plan.verticalStages[ stage ] ) );
			}
			await submitCompute( this.renderer, cascade.assemblyNodes[ cascade.currentFoamHistory ] );
			cascade.currentFoamHistory = 1 - cascade.currentFoamHistory;
		}
	}

	validate( options = {} ) {
		const selfTests = validateFftOceanSelfTests( options );
		return {
			pass: selfTests.pass,
			config: true,
			selfTests,
			gpuReadback: {
				pass: null,
				status: 'pending-browser-webgpu',
				requiredForBrowserAcceptance: true,
				fixtures: [ 'DC', 'one-bin-x', 'one-bin-y', 'derivative-sign', 'jacobian-determinant' ],
				nodes: [ 'createBitReverseNode', 'createFftStageNode', 'createCenterAndAssembleNode' ],
				reason: 'StorageTexture readback is browser/backend-specific; run in a WebGPU browser harness for pixel error capture.'
			}
		};
	}

	get materialCascades() {
		return this.cascades.map( ( cascade ) => ( {
			patchLength: cascade.patchLength,
			displacementTexture: cascade.displacementTexture,
			derivativesTexture: cascade.derivativesTexture,
			crossJacobianFoamTexture: cascade.crossJacobianFoamTexture
		} ) );
	}

	getDebugTextures() {
		return {
			capabilityTier: this.diagnostics,
			butterfly: this.butterflyTexture,
			bitReverse: this.bitReverseTexture,
			cascades: this.cascades.map( ( cascade ) => cascade.debugTextures )
		};
	}

	dispose() {
		this.cascades.forEach( ( cascade ) => cascade.dispose() );
		this.butterflyTexture?.dispose?.();
		this.bitReverseTexture?.dispose?.();
	}
}

export async function createWebGPUFftOcean( renderer, options = {} ) {
	if ( renderer && typeof renderer.init === 'function' ) {
		await renderer.init();
	}

	const ocean = new WebGPUFftOcean( renderer, options );
	await ocean.allocateStorageTextures();
	return ocean;
}

export async function createOceanRenderer( parameters = {} ) {
	const renderer = new THREE.WebGPURenderer( {
		antialias: false,
		outputBufferType: THREE.HalfFloatType,
		...parameters
	} );
	await renderer.init();
	return {
		renderer,
		isWebGPUBackend: renderer.backend.isWebGPUBackend === true
	};
}
