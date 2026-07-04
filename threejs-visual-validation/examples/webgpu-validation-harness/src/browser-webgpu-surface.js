import { Scene, PerspectiveCamera } from 'three';
import { WebGPURenderer, RenderPipeline, HalfFloatType } from 'three/webgpu';
import { pass, mrt, output, normalView, emissive, renderOutput } from 'three/tsl';

export const r185NodePipelineImports = {
	WebGPURenderer,
	RenderPipeline,
	HalfFloatType,
	pass,
	mrt,
	output,
	normalView,
	emissive,
	renderOutput
};

export async function createValidationRenderer( canvas, parameters = {} ) {

	const renderer = new WebGPURenderer( {
		canvas,
		antialias: false,
		outputBufferType: HalfFloatType,
		trackTimestamp: true,
		...parameters
	} );

	await renderer.init();

	return renderer;

}

export function createMinimalPipelineSurface( renderer ) {

	const scene = new Scene();
	const camera = new PerspectiveCamera( 50, 1, 0.1, 100 );
	const renderPipeline = new RenderPipeline( renderer );
	const scenePass = pass( scene, camera );

	scenePass.setMRT( mrt( {
		output,
		normal: normalView,
		emissive
	} ) );

	const hdrColor = scenePass.getTextureNode( 'output' );
	renderPipeline.outputColorTransform = false;
	renderPipeline.outputNode = renderOutput( hdrColor );

	return {
		scene,
		camera,
		renderPipeline,
		scenePass,
		colorNode: hdrColor,
		normalNode: scenePass.getTextureNode( 'normal' ),
		emissiveNode: scenePass.getTextureNode( 'emissive' ),
		depthNode: scenePass.getTextureNode( 'depth' )
	};

}

export async function collectRendererInfo( renderer, THREE ) {

	const backend = renderer.backend ?? {};
	const device = backend.device ?? null;

	return {
		threeRevision: THREE.REVISION,
		renderer: 'WebGPURenderer',
		isPrimaryBackend: backend.isWebGPUBackend === true,
		coordinateSystem: renderer.coordinateSystem ?? null,
		initialized: renderer.initialized === true,
		outputBufferType: typeof renderer.getOutputBufferType === 'function' ? renderer.getOutputBufferType() : null,
		compatibilityMode: Object.hasOwn( backend, 'compatibilityMode' ) ? backend.compatibilityMode : null,
		trackTimestamp: Object.hasOwn( backend, 'trackTimestamp' ) ? backend.trackTimestamp : null,
		features: device?.features ? [ ...device.features ] : null,
		limits: device?.limits ? { ...device.limits } : null,
		unavailableReason: device ? null : 'renderer.backend.device is unavailable in this execution environment',
		info: structuredClone( renderer.info )
	};

}

export async function resolveTimestampEvidence( renderer ) {

	try {

		const renderTimestampMs = await renderer.resolveTimestampsAsync('render');
		const computeTimestampMs = await renderer.resolveTimestampsAsync('compute');

		if ( Number.isFinite( renderTimestampMs ) === false ) {

			throw new Error( 'renderer.resolveTimestampsAsync("render") did not return a timestamp.' );

		}

		return {
			gpuTimingUnavailable: false,
			gpuTimingLabel: 'GPU timestamp',
			renderTimestampMs,
			computeTimestampMs: Number.isFinite( computeTimestampMs ) ? computeTimestampMs : null,
			rendererInfoRenderTimestampMs: renderer.info.render.timestamp ?? null,
			rendererInfoComputeTimestampMs: renderer.info.compute.timestamp ?? null
		};

	} catch ( error ) {

		return {
			gpuTimingUnavailable: true,
			gpuTimingLabel: 'CPU-only proxy',
			unavailableReason: error.message
		};

	}

}
