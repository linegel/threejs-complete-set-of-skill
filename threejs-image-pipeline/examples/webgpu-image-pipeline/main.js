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
import { pass, mrt, output, normalView, emissive } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

import { composeFinalGraph } from './composeFinalGraph.js';
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
	const configOnlyValidation = validateImagePipelineConfig( config );
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

	const normalTex = scenePass.getTextureNode( 'normal' );
	const emissiveTex = scenePass.getTextureNode( 'emissive' );
	const depthTex = scenePass.getTextureNode( 'depth' );
	const gtao = ao( depthTex, normalTex, camera );
	const bloomPass = bloom( emissiveTex );

	gtao.resolutionScale = config.resolutionScales.ao;
	bloomPass.setResolutionScale( config.resolutionScales.bloom );

	const graph = composeFinalGraph( {
		config,
		scenePass,
		gtao,
		bloomPass,
		traaFactory: ( { hdrComposite, depthTex: temporalDepthTex, velocityNode, camera: temporalCamera } ) => traa( hdrComposite, temporalDepthTex, velocityNode, temporalCamera ),
		velocityNode: options.velocityNode,
		camera
	} );
	// Debug-only albedo capture stays out of the production MRT and final graph.
	const debugAlbedoPass = {
		getTextureNode: () => graph.hdrColor,
		dispose: () => {}
	};

	renderPipeline.outputColorTransform = false;
	renderPipeline.outputNode = graph.finalOutputNode;
	const configValidation = validateImagePipelineConfig( config, {
		renderPipeline,
		finalOutputNode: graph.finalOutputNode,
		aoTextureNode: graph.aoTextureNode
	} );

	await scenePass.compileAsync?.( renderer );

	const diagnostics = {
		mode: 'final',
		modes: [
			'final',
			'no-post baseline',
			'scene HDR',
			'depth raw',
			'linear depth',
			'normal',
			'emissive',
			'albedo',
			'AO.r',
			'lighting-aware AO composite',
			'bloom contribution',
			'pre-tone-map HDR',
			'debug baseline AO final-color multiply',
			'final output'
		],
		views: {
			'final': graph.finalNode,
			'no-post baseline': graph.hdrColor,
			'scene HDR': graph.hdrColor,
			'depth raw': depthTex,
			'linear depth': depthTex,
			'normal': normalTex,
			'emissive': emissiveTex,
			'albedo': debugAlbedoPass.getTextureNode(),
			'AO.r': graph.indirectVisibility,
			'lighting-aware AO composite': graph.lightingAwareAoComposite,
			'bloom contribution': graph.bloomTextureNode,
			'pre-tone-map HDR': graph.hdrComposite,
			'debug baseline AO final-color multiply': graph.debugFinalColorMultiplyBaseline,
			'final output': graph.finalNode
		},
		activeView: graph.finalNode,
		configValidation,
		configOnlyValidation,
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
		renderPipeline.outputNode = mode === 'final' || mode === 'final output' ? graph.finalOutputNode : diagnostics.activeView;
		renderPipeline.needsUpdate = true;
		return diagnostics.activeView;

	}

	function render() {

		mesh.rotation.y += 0.005;
		renderPipeline.render();

	}

	function dispose() {

		mesh.geometry.dispose();
		material.dispose();
		scenePass.dispose?.();
		debugAlbedoPass.dispose?.();
		gtao.dispose?.();
		bloomPass.dispose?.();
		graph.temporal?.dispose?.();
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
