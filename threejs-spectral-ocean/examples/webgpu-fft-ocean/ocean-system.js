import * as THREE from 'three/webgpu';
import {
	Fn,
	float,
	instanceIndex,
	textureStore,
	uvec2,
	uniform,
	vec4
} from 'three/tsl';

import {
	PACKED_FIELD_LAYOUT,
	OCEAN_COMPUTE_BINDING_REQUIREMENTS,
	WEBGPU_REQUIRED_ROUTE_MESSAGE,
	createBitReverseTexture,
	createButterflyTexture,
	createCascadeDescriptors,
	createStorageTexture,
	estimateOceanStorageMiB,
	mergeOceanConfig,
	validateOceanCapabilities,
	validateOceanComputeLayouts,
	validateOceanConfig
} from './constants.js';
import {
	createBitReverseNode,
	createCenterAndAssembleNode,
	createClearTextureNode,
	createDerivativesAssemblyNode,
	createDisplacementAssemblyNode,
	createEvolutionNode,
	createFftFixtureNode,
	createFftStageNode,
	createFoamHistoryNode,
	createJacobianAssemblyNode,
	createSpectrumInitNode
} from './compute-kernels.js';
import { validateFftOceanSelfTests } from './validation.js';

function submitCompute( renderer, nodes ) {
	const previousRenderTarget = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
	try {
		if ( renderer.initialized !== true ) throw new Error( 'Renderer must be initialized before ocean compute submission.' );
		renderer.compute( nodes );
	} finally {
		if ( typeof renderer.setRenderTarget === 'function' ) {
			renderer.setRenderTarget( previousRenderTarget );
		}
	}
}

function makeTextureSet( resolution, config, cascadeIndex ) {
	const textureType = config.textureType;
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
		foamHistory: config.enablePerCascadeFoamHistory ? [
			createStorageTexture( resolution, { type: textureType, filter: THREE.LinearFilter, label: `ocean-foam-history-${ cascadeIndex }-0` } ),
			createStorageTexture( resolution, { type: textureType, filter: THREE.LinearFilter, label: `ocean-foam-history-${ cascadeIndex }-1` } )
		] : []
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

function createReadbackPatternNode( textureTarget, resolution, name ) {
	const kernel = Fn( ( { outputTex } ) => {
		const x = instanceIndex.mod( resolution );
		const y = instanceIndex.div( resolution );
		const cell = uvec2( x, y );
		textureStore( outputTex, cell, vec4( float( y.mul( resolution ).add( x ) ), float( x ), float( y ), 1.0 ) ).toWriteOnly();
	} );

	return kernel( { outputTex: textureTarget } ).compute( resolution * resolution, [ 64 ] ).setName( name );
}

function readPixel( readback, x, y, width, height ) {
	const tightElements = width * height * 4;
	const bytesPerTexel = readback.BYTES_PER_ELEMENT * 4;
	const paddedElementsPerRow = Math.ceil( ( width * bytesPerTexel ) / 256 ) * 256 / readback.BYTES_PER_ELEMENT;
	const elementsPerRow = readback.length === tightElements ? width * 4 : paddedElementsPerRow;
	const offset = y * elementsPerRow + x * 4;
	return [
		readback[ offset ],
		readback[ offset + 1 ],
		readback[ offset + 2 ],
		readback[ offset + 3 ]
	];
}

function maxPixelError( actual, expected ) {
	let error = 0;
	for ( let index = 0; index < expected.length; index += 1 ) {
		error = Math.max( error, Math.abs( actual[ index ] - expected[ index ] ) );
	}
	return error;
}

function complexProduct( a, b ) {
	return [ a[ 0 ] * b[ 0 ] - a[ 1 ] * b[ 1 ], a[ 0 ] * b[ 1 ] + a[ 1 ] * b[ 0 ] ];
}

function complexExponential( angle ) {
	return [ Math.cos( angle ), Math.sin( angle ) ];
}

function expectedFftFixturePixel( fixture, x, y, resolution ) {
	const phase = ( kx, ky ) => complexExponential( 2 * Math.PI * ( kx * x + ky * y ) / resolution );
	const sum = ( coefficients ) => coefficients.reduce( ( value, coefficient ) => {
		const contribution = complexProduct( coefficient.value, phase( coefficient.x, coefficient.y ) );
		return [ value[ 0 ] + contribution[ 0 ], value[ 1 ] + contribution[ 1 ] ];
	}, [ 0, 0 ] );

	if ( fixture === 'dc-and-axis' ) {
		return [ 1, 0, ...phase( 1, 0 ) ];
	}
	if ( fixture === 'oblique-pair' ) {
		return [
			...complexProduct( [ 0.5, - 0.25 ], phase( 1, 2 ) ),
			...complexProduct( [ - 0.375, 0.625 ], phase( 2, 1 ) )
		];
	}
	if ( fixture === 'hermitian-cosines' ) {
		return [
			...sum( [ { x: 1, y: 0, value: [ 0.5, 0 ] }, { x: resolution - 1, y: 0, value: [ 0.5, 0 ] } ] ),
			...sum( [ { x: 0, y: 1, value: [ 0.5, 0 ] }, { x: 0, y: resolution - 1, value: [ 0.5, 0 ] } ] )
		];
	}
	throw new Error( `Unknown FFT fixture "${ fixture }".` );
}

function fullTextureError( readback, width, height, expectedPixel ) {
	let maximum = 0;
	for ( let y = 0; y < height; y += 1 ) {
		for ( let x = 0; x < width; x += 1 ) {
			maximum = Math.max( maximum, maxPixelError( readPixel( readback, x, y, width, height ), expectedPixel( x, y ) ) );
		}
	}
	return maximum;
}

function pendingGpuReadback( reason ) {
	return {
		pass: null,
		status: 'pending-browser-webgpu',
		scope: 'complete-2d-fft-suite-defined-not-executed',
		requiredForBrowserAcceptance: true,
		fixtures: [ 'dc-and-axis', 'oblique-pair', 'hermitian-cosines', 'bit-reversal-x', 'fft-stage-0-x', 'assembly-fields', 'foam-reaction' ],
		nodes: [ 'createBitReverseNode', 'createFftStageNode', 'complete-2d-fft', 'assembly-mode-dependent', 'createFoamHistoryNode' ],
		reason
	};
}

class WebGPUFftOceanCascade {
	constructor( descriptor, shared, config ) {
		this.index = descriptor.index;
		this.patchLength = descriptor.patchLength;
		this.descriptor = descriptor;
		this.resources = {
			...shared,
			textures: makeTextureSet( descriptor.resolution, config, descriptor.index )
		};
		this.currentFoamHistory = 0;
		this.initNode = createSpectrumInitNode( descriptor, {
			h0: this.resources.textures.h0,
			gaussianDebug: this.resources.textures.gaussianDebug,
			spectrumDebug: this.resources.textures.spectrumDebug,
			maskDebug: this.resources.textures.maskDebug
		} );
		this.clearFoamNodes = this.resources.textures.foamHistory.map( ( texture, index ) => (
			createClearTextureNode( texture, descriptor.resolution, [ 0, 0, 1, 1 ], `ocean:foam-clear:${ descriptor.index }:${ index }` )
		) );
		this.evolutionNodes = Object.values( PACKED_FIELD_LAYOUT ).map( ( fieldIndex ) => (
			createEvolutionNode( descriptor, fieldIndex, {
				h0: this.resources.textures.h0,
				outputTex: this.resources.textures.frequencyA[ fieldIndex ],
				time: shared.timeUniform
			} )
		) );
		this.fftPlans = Object.values( PACKED_FIELD_LAYOUT ).map( ( fieldIndex ) => makeFftPlan( descriptor, fieldIndex, this.resources ) );
		this.assemblyNodes = this.makeAssemblyNodes( shared.assemblyMode );
		this.foamNodes = config.enablePerCascadeFoamHistory ? [ this.makeFoamNode( 0 ), this.makeFoamNode( 1 ) ] : [];
	}

	makeAssemblyNodes( assemblyMode ) {
		const textures = this.resources.textures;
		const final = this.fftPlans.map( ( plan ) => plan.finalTexture );
		const targets = {
			field0: final[ PACKED_FIELD_LAYOUT.horizontalDisplacement ],
			field1: final[ PACKED_FIELD_LAYOUT.heightAndCrossDerivative ],
			field2: final[ PACKED_FIELD_LAYOUT.heightSlopes ],
			field3: final[ PACKED_FIELD_LAYOUT.horizontalDerivatives ],
			displacement: textures.displacement,
			derivatives: textures.derivatives,
			crossJacobianFoam: textures.crossJacobianFoam
		};

		if ( assemblyMode === 'fused-7-storage-textures' ) {
			return [ createCenterAndAssembleNode( this.descriptor, targets ) ];
		}

		return [
			createDisplacementAssemblyNode( this.descriptor, {
				field0: targets.field0,
				field1: targets.field1,
				displacement: targets.displacement
			} ),
			createDerivativesAssemblyNode( this.descriptor, {
				field2: targets.field2,
				field3: targets.field3,
				derivatives: targets.derivatives
			} ),
			createJacobianAssemblyNode( this.descriptor, {
				field1: targets.field1,
				field3: targets.field3,
				crossJacobianFoam: targets.crossJacobianFoam
			} )
		];
	}

	makeFoamNode( previousIndex ) {
		const nextIndex = 1 - previousIndex;
		const textures = this.resources.textures;
		return createFoamHistoryNode( this.descriptor, {
			crossJacobian: textures.crossJacobianFoam,
			previousFoam: textures.foamHistory[ previousIndex ],
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
				timeEvolvedPackedComplexFields: this.resources.textures.frequencyA,
			packedRealImagFields: this.resources.textures.frequencyA,
			packedScratchFields: this.resources.textures.frequencyB,
			spatialDisplacement: this.resources.textures.displacement,
			spatialHeight: this.resources.textures.displacement,
			spatialDerivatives: this.resources.textures.derivatives,
			heightSlopes: this.resources.textures.derivatives,
			horizontalDerivatives: this.resources.textures.derivatives,
				crossDerivativeAndPerCascadeJacobian: this.resources.textures.crossJacobianFoam,
			crossDerivative: this.resources.textures.crossJacobianFoam,
			jacobianDeterminant: this.resources.textures.crossJacobianFoam,
				foamHistory: this.resources.textures.foamHistory[ this.currentFoamHistory ] ?? null,
				resolvedNormalInputs: {
					heightSlopesAndHorizontalDiagonalDerivatives: this.resources.textures.derivatives,
					horizontalCrossDerivative: this.resources.textures.crossJacobianFoam
				}
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
			...this.foamNodes,
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
		if ( this.capabilities.nativeStorage !== true ) {
			throw new Error( WEBGPU_REQUIRED_ROUTE_MESSAGE );
		}
		this.computeLayoutGate = validateOceanComputeLayouts( this.capabilities );
		this.initialized = false;
		this.disposed = false;
		this.accepted = false;
		this.gpuReadback = pendingGpuReadback( 'Browser WebGPU storage texture readback has not run yet.' );
		this.timeUniform = uniform( 0 );
		this.dtUniform = uniform( 1 / 60 );
		this.butterflyTexture = null;
		this.bitReverseTexture = null;
		this.cascades = [];
		this.createNativeResources();
		this.diagnostics = {
			tier: this.config.quality,
			format: this.config.textureType === THREE.FloatType ? 'rgba32float' : 'rgba16float',
			estimatedStorageMiB: estimateOceanStorageMiB( this.config ),
			dispatchesPerFrame: this.config.cascadeCount * (
				4 + 4 * ( 2 + 2 * Math.log2( this.config.resolution ) ) +
				( this.capabilities.assemblyMode === 'fused-7-storage-textures' ? 1 : 3 ) +
				( this.config.enablePerCascadeFoamHistory ? 1 : 0 )
			),
			capabilities: this.capabilities,
			computeLayoutGate: this.computeLayoutGate,
			compiledLayoutGate: { status: 'pending-first-webgpu-submission', compiledNodeNames: [] }
		};
	}

	createNativeResources() {
		if ( this.disposed ) throw new Error( 'WebGPUFftOcean has been disposed.' );
		if ( this.cascades.length > 0 ) return;

		this.butterflyTexture = createButterflyTexture( this.config.resolution );
		this.bitReverseTexture = createBitReverseTexture( this.config.resolution );
		const shared = {
			butterflyTexture: this.butterflyTexture,
			bitReverseTexture: this.bitReverseTexture,
			timeUniform: this.timeUniform,
			dtUniform: this.dtUniform,
			assemblyMode: this.capabilities.assemblyMode
		};
		this.cascades = createCascadeDescriptors( this.config ).map( ( descriptor ) => new WebGPUFftOceanCascade( descriptor, shared, this.config ) );
	}

	async allocateStorageTextures() {
		if ( this.disposed ) throw new Error( 'WebGPUFftOcean has been disposed.' );
		if ( this.capabilities.nativeStorage !== true ) {
			throw new Error( WEBGPU_REQUIRED_ROUTE_MESSAGE );
		}

		this.createNativeResources();
		const validation = this.validate( { resolution: Math.min( 16, this.config.resolution ) } );
		this.diagnostics.validation = validation;
		if ( validation.selfTests.pass !== true ) {
			throw new Error( 'WebGPU FFT ocean validation gate failed before storage allocation.' );
		}

		for ( const cascade of this.cascades ) {
			await submitCompute( this.renderer, cascade.initNode );
			if ( cascade.clearFoamNodes.length > 0 ) {
				await submitCompute( this.renderer, cascade.clearFoamNodes );
			}
		}
		this.diagnostics.compiledLayoutGate = {
			status: 'initialization-layout-submitted-to-webgpu-compiler',
			adapterLimit: this.computeLayoutGate.adapterLimit,
			assemblyMode: this.computeLayoutGate.assemblyMode,
			compiledNodeNames: [
				...this.cascades.map( ( cascade ) => cascade.initNode.name ),
				...this.cascades.flatMap( ( cascade ) => cascade.clearFoamNodes.map( ( node ) => node.name ) )
			]
		};
		this.gpuReadback = await this.runBrowserGpuReadbackFixtures();
		if ( this.gpuReadback.pass === false ) {
			throw new Error( `WebGPU FFT ocean readback validation failed: ${ JSON.stringify( this.gpuReadback.errors ) }` );
		}
		this.initialized = true;
		this.accepted = false;
	}

	async update( timeSeconds, dtSeconds = 1 / 60 ) {
		if ( this.disposed ) throw new Error( 'WebGPUFftOcean has been disposed.' );
		if ( ! Number.isFinite( timeSeconds ) || ! Number.isFinite( dtSeconds ) || dtSeconds < 0 ) {
			throw new Error( 'Ocean update requires finite timeSeconds and non-negative finite dtSeconds.' );
		}
		if ( ! this.initialized ) await this.allocateStorageTextures();

		this.timeUniform.value = timeSeconds;
		this.dtUniform.value = dtSeconds;
		const logResolution = Math.log2( this.config.resolution );

		for ( const cascade of this.cascades ) {
			const orderedNodes = [
				...cascade.evolutionNodes,
				...cascade.fftPlans.map( ( plan ) => plan.bitReverseX )
			];
			for ( let stage = 0; stage < logResolution; stage += 1 ) {
				orderedNodes.push( ...cascade.fftPlans.map( ( plan ) => plan.horizontalStages[ stage ] ) );
			}
			orderedNodes.push( ...cascade.fftPlans.map( ( plan ) => plan.bitReverseY ) );
			for ( let stage = 0; stage < logResolution; stage += 1 ) {
				orderedNodes.push( ...cascade.fftPlans.map( ( plan ) => plan.verticalStages[ stage ] ) );
			}
			orderedNodes.push( ...cascade.assemblyNodes );
			if ( cascade.foamNodes.length > 0 ) {
				orderedNodes.push( cascade.foamNodes[ cascade.currentFoamHistory ] );
			}
			// Three.js iterates compute-node arrays in order inside one compute pass; each FFT
			// stage reads only the prior stage's texture and writes the ping-pong target.
			await submitCompute( this.renderer, orderedNodes );
			if ( cascade.foamNodes.length > 0 ) {
				cascade.currentFoamHistory = 1 - cascade.currentFoamHistory;
			}
		}
		this.diagnostics.compiledLayoutGate = {
			status: 'all-selected-runtime-layouts-submitted-to-webgpu-compiler',
			adapterLimit: this.computeLayoutGate.adapterLimit,
			assemblyMode: this.computeLayoutGate.assemblyMode,
			compiledNodeNames: this.describeDispatches().frameNodes
		};
	}

	async runBrowserGpuReadbackFixtures() {
		const copyTextureToBuffer = this.renderer?.backend?.copyTextureToBuffer;
		if ( typeof copyTextureToBuffer !== 'function' ) {
			return pendingGpuReadback( 'renderer.backend.copyTextureToBuffer is unavailable in this Node-level environment.' );
		}

		const resolution = 8;
		const fixtureConfig = mergeOceanConfig( {
			quality: 'low',
			resolution,
			cascadeCount: 1,
			patchLengthsMeters: [ 64 ],
			textureType: THREE.FloatType
		} );
		const cascade = createCascadeDescriptors( fixtureConfig )[ 0 ];
		const butterflyTexture = createButterflyTexture( resolution );
		const bitReverseTexture = createBitReverseTexture( resolution );
		const input = createStorageTexture( resolution, { type: THREE.FloatType, filter: THREE.NearestFilter, label: 'ocean-readback-input' } );
		const output = createStorageTexture( resolution, { type: THREE.FloatType, filter: THREE.NearestFilter, label: 'ocean-readback-output' } );
		const scratch = createStorageTexture( resolution, { type: THREE.FloatType, filter: THREE.NearestFilter, label: 'ocean-readback-scratch' } );
		const field3 = createStorageTexture( resolution, { type: THREE.FloatType, filter: THREE.NearestFilter, label: 'ocean-readback-field3' } );
		const previousFoam = createStorageTexture( resolution, { type: THREE.FloatType, filter: THREE.NearestFilter, label: 'ocean-readback-previous-foam' } );
		const displacement = createStorageTexture( resolution, { type: THREE.FloatType, filter: THREE.NearestFilter, label: 'ocean-readback-displacement' } );
		const derivatives = createStorageTexture( resolution, { type: THREE.FloatType, filter: THREE.NearestFilter, label: 'ocean-readback-derivatives' } );
		const crossJacobianFoam = createStorageTexture( resolution, { type: THREE.FloatType, filter: THREE.NearestFilter, label: 'ocean-readback-cross-jacobian-foam' } );
		const foamHistory = createStorageTexture( resolution, { type: THREE.FloatType, filter: THREE.NearestFilter, label: 'ocean-readback-foam-history' } );
		const errors = {};
		const fixtureNodes = [];
		const registerNode = ( node ) => {
			fixtureNodes.push( ...( Array.isArray( node ) ? node : [ node ] ) );
			return node;
		};

		try {
			const fixtureResources = { textures: { frequencyA: [ input ], frequencyB: [ scratch ] }, bitReverseTexture, butterflyTexture };
			const fullFftPlan = makeFftPlan( cascade, 0, fixtureResources );
			const fullFftNodes = [
				fullFftPlan.bitReverseX,
				...fullFftPlan.horizontalStages,
				fullFftPlan.bitReverseY,
				...fullFftPlan.verticalStages
			];
			fixtureNodes.push( ...fullFftNodes );
			for ( const fixture of [ 'dc-and-axis', 'oblique-pair', 'hermitian-cosines' ] ) {
				const fixtureNode = createFftFixtureNode( input, resolution, fixture );
				fixtureNodes.push( fixtureNode );
				await submitCompute( this.renderer, [ fixtureNode, ...fullFftNodes ] );
				const transformed = await copyTextureToBuffer.call( this.renderer.backend, fullFftPlan.finalTexture, 0, 0, resolution, resolution, 0 );
				errors[ `fullFft:${ fixture }` ] = fullTextureError(
					transformed,
					resolution,
					resolution,
					( x, y ) => expectedFftFixturePixel( fixture, x, y, resolution )
				);
			}

			await submitCompute( this.renderer, registerNode( createReadbackPatternNode( input, resolution, 'ocean:readback:pattern' ) ) );
			await submitCompute( this.renderer, registerNode( createBitReverseNode( resolution, 0, {
				inputTex: input,
				outputTex: output,
				bitReverseTex: bitReverseTexture
			} ) ) );
			const bitReverse = await copyTextureToBuffer.call( this.renderer.backend, output, 0, 0, resolution, resolution, 0 );
			errors.bitReverseX = maxPixelError( readPixel( bitReverse, 1, 0, resolution, resolution ), [ 4, 4, 0, 1 ] );

			await submitCompute( this.renderer, registerNode( createClearTextureNode( input, resolution, [ 1, 0, 0, 0 ], 'ocean:readback:fft-clear' ) ) );
			await submitCompute( this.renderer, registerNode( createFftStageNode( resolution, 0, 0, {
				inputTex: input,
				outputTex: output,
				butterflyTex: butterflyTexture
			} ) ) );
			const fftStage = await copyTextureToBuffer.call( this.renderer.backend, output, 0, 0, resolution, resolution, 0 );
			errors.fftStageEven = maxPixelError( readPixel( fftStage, 0, 0, resolution, resolution ), [ 2, 0, 0, 0 ] );
			errors.fftStageOdd = maxPixelError( readPixel( fftStage, 1, 0, resolution, resolution ), [ 0, 0, 0, 0 ] );

			await submitCompute( this.renderer, registerNode( [
				createClearTextureNode( input, resolution, [ 2, 3, 0, 0 ], 'ocean:readback:assembly-field0' ),
				createClearTextureNode( output, resolution, [ 4, 5, 0, 0 ], 'ocean:readback:assembly-field1' ),
				createClearTextureNode( scratch, resolution, [ 6, 7, 0, 0 ], 'ocean:readback:assembly-field2' ),
				createClearTextureNode( field3, resolution, [ - 0.1, - 0.2, 0, 0 ], 'ocean:readback:assembly-field3' ),
				createClearTextureNode( previousFoam, resolution, [ 0, 0, 1, 1 ], 'ocean:readback:assembly-previous-foam' )
			] ) );
			const assemblyTargets = {
				field0: input,
				field1: output,
				field2: scratch,
				field3,
				displacement,
				derivatives,
				crossJacobianFoam
			};
			const assemblyFixtureNodes = this.capabilities.assemblyMode === 'fused-7-storage-textures'
				? [ createCenterAndAssembleNode( cascade, assemblyTargets ) ]
				: [
					createDisplacementAssemblyNode( cascade, { field0: input, field1: output, displacement } ),
					createDerivativesAssemblyNode( cascade, { field2: scratch, field3, derivatives } ),
					createJacobianAssemblyNode( cascade, { field1: output, field3, crossJacobianFoam } )
				];
			await submitCompute( this.renderer, registerNode( assemblyFixtureNodes ) );
			await submitCompute( this.renderer, registerNode( createFoamHistoryNode( cascade, {
				crossJacobian: crossJacobianFoam,
				previousFoam,
				foamHistory,
				dt: this.dtUniform
			} ) ) );
			const assembled = await copyTextureToBuffer.call( this.renderer.backend, displacement, 0, 0, resolution, resolution, 0 );
			const assembledDerivatives = await copyTextureToBuffer.call( this.renderer.backend, derivatives, 0, 0, resolution, resolution, 0 );
			const assembledCross = await copyTextureToBuffer.call( this.renderer.backend, crossJacobianFoam, 0, 0, resolution, resolution, 0 );
			const assembledFoam = await copyTextureToBuffer.call( this.renderer.backend, foamHistory, 0, 0, resolution, resolution, 0 );
			const fixtureJacobian = ( 1 - 1.3 * 0.1 ) * ( 1 - 1.3 * 0.2 ) - ( 1.3 * 5 ) ** 2;
			const sourceRate = Math.max( ( cascade.foamThreshold - fixtureJacobian ) * cascade.foamScale, 0 );
			const decayRate = Math.max( cascade.foamRecovery, 1e-6 );
			const reactionRate = sourceRate + decayRate;
			const equilibrium = sourceRate / reactionRate;
			const fixtureCoverage = equilibrium * ( 1 - Math.exp( - reactionRate * this.dtUniform.value ) );
			errors.assemblyDisplacement = maxPixelError( readPixel( assembled, 0, 0, resolution, resolution ), [ 2.6, 4, 3.9, 1 ] );
			errors.assemblyDerivatives = maxPixelError( readPixel( assembledDerivatives, 0, 0, resolution, resolution ), [ 6, 7, - 0.13, - 0.26 ] );
			errors.assemblyCrossJacobian = maxPixelError( readPixel( assembledCross, 0, 0, resolution, resolution ), [ 6.5, fixtureJacobian, 0, 0 ] );
			errors.foamReaction = maxPixelError( readPixel( assembledFoam, 0, 0, resolution, resolution ), [ fixtureCoverage, sourceRate, fixtureJacobian, 1 ] );
		} finally {
			fixtureNodes.forEach( ( node ) => node.dispose?.() );
			for ( const texture of [
				butterflyTexture,
				bitReverseTexture,
				input,
				output,
				scratch,
				field3,
				previousFoam,
				displacement,
				derivatives,
				crossJacobianFoam,
				foamHistory
			] ) {
				texture.dispose?.();
			}
		}

		const pass = Object.values( errors ).every( ( error ) => error <= 1e-3 );
			return {
				pass,
				status: pass ? 'passed-browser-webgpu' : 'failed-browser-webgpu',
				scope: 'complete-2d-fft-and-assembly-kernel-suite',
				assemblyMode: this.capabilities.assemblyMode,
			requiredForBrowserAcceptance: true,
			fixtures: [ 'dc-and-axis', 'oblique-pair', 'hermitian-cosines', 'bit-reversal-x', 'fft-stage-0-x', 'assembly-fields', 'foam-reaction' ],
			nodes: [ 'createFftFixtureNode', 'createBitReverseNode', 'createFftStageNode', 'createCenterAndAssembleNode', 'createFoamHistoryNode' ],
			errors
		};
	}

	validate( options = {} ) {
		const selfTests = validateFftOceanSelfTests( options );
		return {
			pass: selfTests.pass === false || this.gpuReadback.pass === false ? false : null,
			accepted: false,
			status: selfTests.pass === false || this.gpuReadback.pass === false ? 'failed' : 'scaffold-unaccepted-full-gpu-suite-missing',
			config: true,
			selfTests,
			gpuReadback: this.gpuReadback,
			missingAcceptanceEvidence: [
				'complete 2D GPU FFT fixtures for all packed lanes and Nyquist cases',
				'GPU coefficient identity/statistics against the CPU u32-seeded reference',
				'float-versus-half precision error',
				'multicascade surface and native per-cascade foam GPU readback',
				'sustained target-device performance and real lifecycle loops'
			]
		};
	}

	get materialCascades() {
		if ( this.disposed ) throw new Error( 'WebGPUFftOcean has been disposed.' );
		return this.cascades.map( ( cascade ) => ( {
			index: cascade.index,
			patchLength: cascade.patchLength,
			cutoffLow: cascade.descriptor.cutoffLow,
			cutoffHigh: cascade.descriptor.cutoffHigh,
			displacementTexture: cascade.displacementTexture,
			derivativesTexture: cascade.derivativesTexture,
			crossJacobianFoamTexture: cascade.crossJacobianFoamTexture,
			foamHistoryTexture: cascade.resources.textures.foamHistory[ cascade.currentFoamHistory ] ?? null,
			spectrumTexture: cascade.resources.textures.spectrumDebug,
			maskTexture: cascade.resources.textures.maskDebug,
			fftHeightTexture: cascade.fftPlans[ PACKED_FIELD_LAYOUT.heightAndCrossDerivative ].finalTexture
		} ) );
	}

	get combinedSurface() {
		if ( this.disposed ) throw new Error( 'WebGPUFftOcean has no live foam state.' );
		const preserved = this.cascades.filter( ( cascade ) => cascade.resources.textures.foamHistory.length > 0 );
		const omitted = this.cascades.filter( ( cascade ) => ! preserved.includes( cascade ) );
		return {
			kind: omitted.length === 0 ? 'native-per-cascade-foam-history' : 'instantaneous-foam-no-history',
			cascades: preserved.map( ( cascade ) => ( {
				index: cascade.index,
				patchLength: cascade.patchLength,
				foamHistoryTexture: cascade.resources.textures.foamHistory[ cascade.currentFoamHistory ] ?? null
			} ) ),
			filterContract: {
				composition: 'native-resolution-per-cascade-union',
				preservedCascadeIndices: preserved.map( ( cascade ) => cascade.index ),
				omittedCascadeIndices: omitted.map( ( cascade ) => cascade.index )
			}
		};
	}

	getDebugTextures() {
		return {
			capabilityTier: this.diagnostics,
			butterfly: this.butterflyTexture,
			bitReverse: this.bitReverseTexture,
			cascades: this.cascades.map( ( cascade ) => cascade.debugTextures ),
			foamState: this.combinedSurface
		};
	}

	describeResources() {
		const textures = [];
		const register = ( texture, owner ) => {
			if ( ! texture?.image ) return;
			const bytesPerChannel = texture.type === THREE.FloatType ? 4 : 2;
			const bytesPerTexel = 4 * bytesPerChannel;
			textures.push( {
				name: texture.name,
				owner,
				kind: 'storage-texture',
				format: texture.type === THREE.FloatType ? 'rgba32float' : 'rgba16float',
				width: texture.image.width,
				height: texture.image.height,
				bytesPerTexel,
				bytes: texture.image.width * texture.image.height * bytesPerTexel,
				residency: 'allocated-live'
			} );
		};
		for ( const cascade of this.cascades ) {
			for ( const value of Object.values( cascade.resources.textures ) ) for ( const texture of ( Array.isArray( value ) ? value : [ value ] ) ) register( texture, `cascade-${ cascade.index }` );
		}
		const dataTextures = [ this.butterflyTexture, this.bitReverseTexture ].filter( Boolean ).map( ( texture ) => ( {
			name: texture.name,
			owner: 'fft-plan',
			kind: 'data-texture',
			format: 'rgba32float',
			width: texture.image.width,
			height: texture.image.height,
			bytesPerTexel: 16,
			bytes: texture.image.data?.byteLength ?? 0,
			residency: 'allocated-live'
		} ) );
		const resources = [ ...textures, ...dataTextures ];
		return { resources, textures, dataTextures, totalBytes: resources.reduce( ( total, resource ) => total + resource.bytes, 0 ), peakLiveBytes: resources.reduce( ( total, resource ) => total + resource.bytes, 0 ) };
	}

	describeDispatches() {
		const perCascade = this.cascades.map( ( cascade ) => ( {
			id: `cascade-${ cascade.index }`,
			evolution: cascade.evolutionNodes.length,
			fft: cascade.fftPlans.reduce( ( total, plan ) => total + 2 + plan.horizontalStages.length + plan.verticalStages.length, 0 ),
			assembly: cascade.assemblyNodes.length,
			foamHistory: cascade.foamNodes.length > 0 ? 1 : 0
		} ) );
		const frameNodes = [];
		for ( const cascade of this.cascades ) {
			frameNodes.push( ...cascade.evolutionNodes.map( ( node ) => node.name ) );
			frameNodes.push( ...cascade.fftPlans.map( ( plan ) => plan.bitReverseX.name ) );
			for ( let stage = 0; stage < Math.log2( this.config.resolution ); stage += 1 ) frameNodes.push( ...cascade.fftPlans.map( ( plan ) => plan.horizontalStages[ stage ].name ) );
			frameNodes.push( ...cascade.fftPlans.map( ( plan ) => plan.bitReverseY.name ) );
			for ( let stage = 0; stage < Math.log2( this.config.resolution ); stage += 1 ) frameNodes.push( ...cascade.fftPlans.map( ( plan ) => plan.verticalStages[ stage ].name ) );
			frameNodes.push( ...cascade.assemblyNodes.map( ( node ) => node.name ) );
			if ( cascade.foamNodes.length > 0 ) frameNodes.push( cascade.foamNodes[ cascade.currentFoamHistory ].name );
		}
		return {
			perCascade,
			foamComposition: 'native-resolution-per-cascade',
			totalPerFrame: this.diagnostics.dispatchesPerFrame,
			storageTextureBindings: OCEAN_COMPUTE_BINDING_REQUIREMENTS,
			layoutGate: this.computeLayoutGate,
			compiledLayoutGate: this.diagnostics.compiledLayoutGate,
			frameNodes
		};
	}

	dispose() {
		if ( this.disposed ) return;
		this.cascades.forEach( ( cascade ) => cascade.dispose() );
		this.butterflyTexture?.dispose?.();
		this.bitReverseTexture?.dispose?.();
		this.cascades = [];
		this.butterflyTexture = null;
		this.bitReverseTexture = null;
		this.initialized = false;
		this.disposed = true;
	}
}

export async function createWebGPUFftOcean( renderer, options = {} ) {
	if ( renderer && typeof renderer.init === 'function' ) {
		await renderer.init();
	}

	const ocean = new WebGPUFftOcean( renderer, options );
	await ocean.allocateStorageTextures();
	await ocean.update( 0, 0 );
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
