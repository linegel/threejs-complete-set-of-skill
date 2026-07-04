import {
	BoxGeometry,
	Color,
	HalfFloatType,
	Mesh,
	MeshStandardNodeMaterial,
	NeutralToneMapping,
	NoColorSpace,
	NoToneMapping,
	PerspectiveCamera,
	RenderPipeline,
	Scene,
	StorageBufferAttribute,
	WebGPURenderer
} from 'three/webgpu';
import {
	emissive,
	mrt,
	normalView,
	output,
	pass,
	toneMapping
} from 'three/tsl';

import {
	HISTOGRAM_BINS,
	METER_HEIGHT,
	METER_WIDTH,
	WORKGROUP_SIZE,
	dispatchCount,
	estimateExposureStorageBytes,
	reducePassCount
} from './constants.js';
import { createDebugViewRegistry } from './debug-views.js';
import { createExposureOutputNode, createExposureReductionNodes } from './exposure-nodes.js';
import { createIdentityLutTexture } from './lut.js';

export async function createExposureColorPipeline( canvas, options = {} ) {

	const renderer = new WebGPURenderer( {
		canvas,
		antialias: false,
		outputBufferType: HalfFloatType,
		trackTimestamp: true
	} );
	renderer.toneMapping = NoToneMapping;
	renderer.toneMappingExposure = 1;
	await renderer.init();
	if ( renderer.backend.isWebGPUBackend !== true ) {

		throw new Error( 'WebGPU backend unavailable for the canonical exposure path; route fallback teaching to threejs-compatibility-fallbacks.' );

	}

	const scene = new Scene();
	scene.background = new Color( 0x05070a );

	const camera = new PerspectiveCamera( 50, 1, 0.1, 100 );
	camera.position.set( 0, 1.4, 5 );
	camera.lookAt( 0, 0, 0 );

	const material = new MeshStandardNodeMaterial( {
		color: new Color( 0x8fb9ff ),
		emissive: new Color( 0x302010 ),
		roughness: 0.35,
		metalness: 0.0
	} );
	const mesh = new Mesh( new BoxGeometry( 1.25, 1.25, 1.25 ), material );
	scene.add( mesh );

	const renderPipeline = new RenderPipeline( renderer );
	const scenePass = pass( scene, camera );
	scenePass.setMRT( mrt( {
		output,
		normal: normalView,
		emissive
	} ) );

	const hdrColor = scenePass.getTextureNode( 'output' );
	const depth = scenePass.getTextureNode( 'depth' );
	const normal = scenePass.getTextureNode( 'normal' );
	const lutTexture = createIdentityLutTexture( options.lutSize ?? 32 );
	lutTexture.colorSpace = NoColorSpace;

	const pixelCount = METER_WIDTH * METER_HEIGHT;
	const workgroupSize = options.workgroupSize ?? WORKGROUP_SIZE;
	const dispatches = dispatchCount( pixelCount, workgroupSize );
	const reducePasses = reducePassCount( dispatches, workgroupSize );
	const storageBytes = estimateExposureStorageBytes( pixelCount, {
		workgroupSize,
		histogramBins: HISTOGRAM_BINS
	} );
	const partialBuffer = options.partialBuffer ?? new StorageBufferAttribute( storageBytes.partialCount, 4, Float32Array );
	const exposureFloatStateBuffer = options.exposureFloatStateBuffer ?? new StorageBufferAttribute( 1, 4, Float32Array );
	const exposureUintStateBuffer = options.exposureUintStateBuffer ?? new StorageBufferAttribute( 1, 4, Uint32Array );
	const histogramBuffer = options.histogramBuffer ?? new StorageBufferAttribute( HISTOGRAM_BINS, 1, Uint32Array );
	exposureFloatStateBuffer.array.set( [ 0.18, 1, 1, 0 ] );
	exposureUintStateBuffer.array.set( [ 1, HISTOGRAM_BINS, 0, 0 ] );

	const exposureNodes = createExposureReductionNodes( {
		hdrTextureNode: hdrColor,
		meterMaskNode: options.meterMask ?? null,
		meterWidth: METER_WIDTH,
		meterHeight: METER_HEIGHT,
		pixelCount,
		workgroupSize,
		partialBuffer,
		exposureFloatStateBuffer,
		exposureUintStateBuffer,
		histogramBuffer,
		histogramBins: HISTOGRAM_BINS
	} );

	const finalNode = createExposureOutputNode( {
		hdrColor,
		lutTexture,
		lutSize: lutTexture.image.width,
		mapping: options.toneMapping ?? NeutralToneMapping,
		outputColorSpace: renderer.outputColorSpace,
		exposureState: exposureNodes.state
	} );
	const postToneMapLinear = toneMapping( options.toneMapping ?? NeutralToneMapping, 1, hdrColor.mul( exposureNodes.state.floatState.element( 0 ).z ) );

	renderPipeline.outputColorTransform = false;
	renderPipeline.outputNode = finalNode;

	const diagnostics = {
		debugViews: createDebugViewRegistry( {
			'meter source HDR': hdrColor,
			'meter mask': options.meterMask ?? null,
			'partial logSum weightSum': exposureNodes.partials,
			'aggregate average': exposureNodes.state,
			'adapted exposure': exposureNodes.state,
			'post exposure before tone map': hdrColor,
			'post-tone-map linear': postToneMapLinear,
			'LUT output': finalNode,
			'final output': finalNode
		} ),
		depth,
		normal,
		storageBuffers: {
			partialBuffer,
			exposureFloatStateBuffer,
			exposureUintStateBuffer,
			histogramBuffer
		},
		ownership: {
			dynamicExposureOwner: 'ExposureState storage buffer',
			toneMapOwner: 'toneMapping() node',
			outputTransformOwner: 'renderOutput(..., NoToneMapping, renderer.outputColorSpace)'
		},
		storageBytes,
		dispatchCount: dispatches,
		reducePassCount: reducePasses
	};

	function render( deltaSeconds = 1 / 60 ) {

		exposureNodes.deltaSecondsNode.value = deltaSeconds;
		mesh.rotation.y += 0.004;
		renderer.compute( exposureNodes.reduceHdrToPartials );
		renderer.compute( exposureNodes.reducePartialsToAggregate );
		renderer.compute( exposureNodes.resolveExposureState );
		renderPipeline.render();

	}

	function dispose() {

		mesh.geometry.dispose();
		material.dispose();
		lutTexture.dispose();
		partialBuffer.dispose?.();
		exposureFloatStateBuffer.dispose?.();
		exposureUintStateBuffer.dispose?.();
		histogramBuffer.dispose?.();
		renderPipeline.dispose?.();
		renderer.dispose();

	}

	return {
		renderer,
		renderPipeline,
		scenePass,
		scene,
		camera,
		diagnostics,
		render,
		dispose
	};

}
