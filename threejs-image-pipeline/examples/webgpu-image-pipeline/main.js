import {
	BoxGeometry,
	Color,
	HalfFloatType,
	Mesh,
	MeshStandardNodeMaterial,
	PerspectiveCamera,
	RenderPipeline,
	Scene,
	WebGPURenderer
} from 'three/webgpu';
import { pass, mrt, output, normalView, emissive, renderOutput } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

import { createDefaultImagePipelineConfig, createCapabilityTier } from './pipelineConfig.js';
import { validateImagePipelineConfig } from './validateImagePipelineConfig.js';

export async function createWebGpuImagePipeline( canvas, options = {} ) {

	const renderer = new WebGPURenderer( {
		canvas,
		antialias: false,
		outputBufferType: HalfFloatType,
		trackTimestamp: true
	} );

	await renderer.init();

	const config = createDefaultImagePipelineConfig( options.config );
	const configValidation = validateImagePipelineConfig( config );
	const tier = createCapabilityTier( renderer, {
		requiredMRT: config.requiredMRT.length,
		requiredStorage: false,
		memoryBudget: config.memory.memoryBudget
	} );

	const scene = new Scene();
	scene.background = new Color( 0x06080c );

	const camera = new PerspectiveCamera( 50, 1, 0.1, 100 );
	camera.position.set( 0, 1.3, 5.5 );
	camera.lookAt( 0, 0, 0 );

	const material = new MeshStandardNodeMaterial( {
		color: new Color( 0x76a9ff ),
		emissive: new Color( 0x07101f ),
		roughness: 0.42,
		metalness: 0
	} );

	const mesh = new Mesh( new BoxGeometry( 1.4, 1.4, 1.4 ), material );
	scene.add( mesh );

	const renderPipeline = new RenderPipeline( renderer );
	const scenePass = pass( scene, camera );
	scenePass.setResolutionScale( config.resolutionScales.scene );

	scenePass.setMRT( mrt( {
		output,
		normal: normalView,
		emissive
	} ) );

	const hdrColor = scenePass.getTextureNode( 'output' );
	const normalTex = scenePass.getTextureNode( 'normal' );
	const emissiveTex = scenePass.getTextureNode( 'emissive' );
	const depthTex = scenePass.getTextureNode( 'depth' );
	const gtao = ao( depthTex, normalTex, camera );
	const bloomPass = bloom( emissiveTex );

	gtao.resolutionScale = config.resolutionScales.ao;
	bloomPass.setResolutionScale( config.resolutionScales.bloom );

	const indirectVisibility = gtao.getTextureNode().r;
	const debugFinalColorMultiplyBaseline = hdrColor.mul( indirectVisibility );
	const aoPreservedDirect = hdrColor;
	const hdrComposite = aoPreservedDirect.add( bloomPass.getTextureNode() );

	const temporal = options.temporal === true && options.velocityNode ? traa( hdrComposite, depthTex, options.velocityNode, camera ) : null;
	const finalNode = temporal ? temporal.getTextureNode() : hdrComposite;

	renderPipeline.outputColorTransform = false;
	renderPipeline.outputNode = renderOutput( finalNode );

	await scenePass.compileAsync?.( renderer );

	const diagnostics = {
		mode: 'final',
		modes: [
			'final',
			'scene HDR',
			'depth raw',
			'linear depth',
			'normal',
			'emissive',
			'AO.r',
			'bloom contribution',
			'pre-tone-map HDR',
			'debug baseline AO final-color multiply',
			'final output'
		],
		views: {
			'final': finalNode,
			'scene HDR': hdrColor,
			'depth raw': depthTex,
			'linear depth': depthTex,
			'normal': normalTex,
			'emissive': emissiveTex,
			'AO.r': indirectVisibility,
			'bloom contribution': bloomPass.getTextureNode(),
			'pre-tone-map HDR': hdrComposite,
			'debug baseline AO final-color multiply': debugFinalColorMultiplyBaseline,
			'final output': finalNode
		},
		activeView: finalNode,
		configValidation,
		tier
	};

	function resize( width, height, dpr = globalThis.devicePixelRatio ?? 1 ) {

		const pixelWidth = Math.max( 1, Math.floor( width * dpr ) );
		const pixelHeight = Math.max( 1, Math.floor( height * dpr ) );

		camera.aspect = width / Math.max( 1, height );
		camera.updateProjectionMatrix();
		renderer.setSize( width, height, false );
		scenePass.setSize?.( pixelWidth, pixelHeight );

	}

	function setDebugMode( mode ) {

		if ( ! diagnostics.views[ mode ] ) {

			throw new Error( `Unknown image-pipeline debug mode "${ mode }".` );

		}

		diagnostics.mode = mode;
		diagnostics.activeView = diagnostics.views[ mode ];
		return diagnostics.activeView;

	}

	function render() {

		mesh.rotation.y += 0.005;
		renderPipeline.render();

	}

	function dispose() {

		mesh.geometry.dispose();
		material.dispose();
		renderPipeline.dispose?.();
		renderer.dispose();

	}

	return {
		renderer,
		scene,
		camera,
		renderPipeline,
		scenePass,
		diagnostics,
		resize,
		setDebugMode,
		render,
		dispose
	};

}
