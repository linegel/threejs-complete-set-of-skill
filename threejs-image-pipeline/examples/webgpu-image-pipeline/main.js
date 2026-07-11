import {
	AmbientLight,
	BoxGeometry,
	Color,
	DirectionalLight,
	HalfFloatType,
	Mesh,
	MeshStandardNodeMaterial,
	NeutralToneMapping,
	PlaneGeometry,
	PerspectiveCamera,
	RenderPipeline,
	Scene,
	SphereGeometry,
	WebGPURenderer
} from 'three/webgpu';
import {
	emissive,
	float,
	mrt,
	normalView,
	output,
	pass,
	vec3,
	vec4
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import { composeFinalGraph } from './composeFinalGraph.js';
import {
	createCapabilityTier,
	createDefaultImagePipelineConfig,
	createFeatureDemoImagePipelineConfig,
	estimateMrtLogicalBytes
} from './pipelineConfig.js';
import { validateImagePipelineConfig } from './validateImagePipelineConfig.js';

const AUTHORED_SCENE = Object.freeze( {
	background: 0x070b14,
	cameraFovDegrees: 50,
	cameraNear: 0.1,
	cameraFar: 100,
	cameraY: 1.3,
	cameraZ: 5.5,
	keyLightColor: 0xffdfb5,
	keyLightIntensity: 4,
	keyLightPosition: [ 3, 5, 4 ],
	ambientLightColor: 0x8ea9d6,
	ambientLightIntensity: 0.8,
	materialColor: 0x4f8fe8,
	materialEmissive: 0x030814,
	roughness: 0.42,
	metalness: 0,
	boxEdge: 1.4,
	boxY: 0.05,
	groundSize: 12,
	groundY: - 0.66,
	groundColor: 0x182436,
	emitterRadius: 0.28,
	emitterPosition: [ 1.45, 0.15, - 0.15 ],
	emitterColor: 0x2a0710,
	emitterEmissive: 0xff315f,
	emitterIntensity: 9,
	rotationRadiansPerSecond: 0.3
} );

export async function createWebGpuImagePipeline( canvas, options = {} ) {

	const renderer = new WebGPURenderer( {
		canvas,
		antialias: false,
		outputBufferType: HalfFloatType,
		trackTimestamp: true
	} );
	renderer.toneMapping = NeutralToneMapping;

	await renderer.init();
	if ( renderer.backend.isWebGPUBackend !== true ) {

		throw new Error( 'Native WebGPU is required for this image-pipeline example.' );

	}

	const config = options.preset === 'feature-demo'
		? createFeatureDemoImagePipelineConfig( options.config ?? {} )
		: createDefaultImagePipelineConfig( options.config ?? {} );
	const configOnlyValidation = validateImagePipelineConfig( config );
	const capability = createCapabilityTier( renderer, {
		selectedMrt: config.requiredMRT,
		bytesPerPixelBySignal: config.memory.bytesPerPixelBySignal
	} );

	const scene = new Scene();
	scene.background = new Color( AUTHORED_SCENE.background );

	const ambientLight = new AmbientLight(
		AUTHORED_SCENE.ambientLightColor,
		AUTHORED_SCENE.ambientLightIntensity
	);
	const keyLight = new DirectionalLight(
		AUTHORED_SCENE.keyLightColor,
		AUTHORED_SCENE.keyLightIntensity
	);
	keyLight.position.fromArray( AUTHORED_SCENE.keyLightPosition );
	scene.add( ambientLight, keyLight );

	const camera = new PerspectiveCamera(
		AUTHORED_SCENE.cameraFovDegrees,
		1,
		AUTHORED_SCENE.cameraNear,
		AUTHORED_SCENE.cameraFar
	);
	camera.position.set( 0, AUTHORED_SCENE.cameraY, AUTHORED_SCENE.cameraZ );
	camera.lookAt( 0, 0, 0 );

	const material = new MeshStandardNodeMaterial( {
		color: new Color( AUTHORED_SCENE.materialColor ),
		emissive: new Color( AUTHORED_SCENE.materialEmissive ),
		roughness: AUTHORED_SCENE.roughness,
		metalness: AUTHORED_SCENE.metalness
	} );
	const mesh = new Mesh(
		new BoxGeometry( AUTHORED_SCENE.boxEdge, AUTHORED_SCENE.boxEdge, AUTHORED_SCENE.boxEdge ),
		material
	);
	mesh.position.y = AUTHORED_SCENE.boxY;

	const groundMaterial = new MeshStandardNodeMaterial( {
		color: new Color( AUTHORED_SCENE.groundColor ),
		roughness: 0.88,
		metalness: 0
	} );
	const ground = new Mesh(
		new PlaneGeometry( AUTHORED_SCENE.groundSize, AUTHORED_SCENE.groundSize ),
		groundMaterial
	);
	ground.rotation.x = - Math.PI / 2;
	ground.position.y = AUTHORED_SCENE.groundY;

	const emitterMaterial = new MeshStandardNodeMaterial( {
		color: new Color( AUTHORED_SCENE.emitterColor ),
		emissive: new Color( AUTHORED_SCENE.emitterEmissive ),
		emissiveIntensity: AUTHORED_SCENE.emitterIntensity,
		roughness: 0.28,
		metalness: 0.05
	} );
	const emitter = new Mesh(
		new SphereGeometry( AUTHORED_SCENE.emitterRadius, 32, 16 ),
		emitterMaterial
	);
	emitter.position.fromArray( AUTHORED_SCENE.emitterPosition );

	const fixtureMeshes = [ mesh, ground, emitter ];
	scene.add( ...fixtureMeshes );

	const renderPipeline = new RenderPipeline( renderer );
	const scenePass = pass( scene, camera );
	scenePass.setResolutionScale( config.resolutionScales.scene );

	const mrtOutputs = { output };
	if ( config.requiredMRT.includes( 'normal' ) ) mrtOutputs.normal = normalView;
	if ( config.requiredMRT.includes( 'emissive' ) ) mrtOutputs.emissive = emissive;
	scenePass.setMRT( mrt( mrtOutputs ) );

	const hdrTex = scenePass.getTextureNode( 'output' );
	const normalTex = config.requiredMRT.includes( 'normal' )
		? scenePass.getTextureNode( 'normal' )
		: null;
	const emissiveTex = config.requiredMRT.includes( 'emissive' )
		? scenePass.getTextureNode( 'emissive' )
		: null;
	const depthTex = scenePass.getTextureNode( 'depth' );
	const gtao = config.features.gtao ? ao( depthTex, normalTex, camera ) : null;
	const bloomSource = config.features.selectiveBloom ? emissiveTex : hdrTex;
	const bloomPass = config.features.selectiveBloom ? bloom( bloomSource ) : null;

	if ( gtao ) gtao.resolutionScale = config.resolutionScales.ao;
	if ( bloomPass ) bloomPass.setResolutionScale( config.resolutionScales.bloom );

	const graph = composeFinalGraph( {
		config,
		scenePass,
		gtao,
		bloomPass
	} );

	renderPipeline.outputColorTransform = false;
	renderPipeline.outputNode = graph.finalOutputNode;
	renderPipeline.needsUpdate = true;

	const configValidation = validateImagePipelineConfig( config, {
		renderPipeline,
		finalOutputNode: graph.finalOutputNode,
		aoTextureNode: graph.aoTextureNode,
		bloomTextureNode: graph.bloomTextureNode
	} );

	await scenePass.compileAsync( renderer );

	const compressHdrForInspection = ( value ) => vec4(
		value.rgb.div( value.rgb.add( 1 ) ),
		float( 1 )
	);
	const diagnosticViews = {
		final: graph.finalOutputNode,
		'final output': graph.finalOutputNode,
		'no-post baseline': graph.noPostOutputNode,
		'scene HDR': compressHdrForInspection( graph.hdrColor ),
		'depth raw': vec4( vec3( graph.depthTex ), 1 ),
		'linear depth': vec4( vec3( graph.linearDepth.oneMinus() ), 1 ),
		'pre-tone-map HDR': compressHdrForInspection( graph.hdrComposite ),
		'post-tone-map output': graph.finalOutputNode,
		'authored AO split scaffold': graph.authoredAoSplitComposite,
		'debug baseline AO final-color multiply': graph.debugFinalColorMultiplyBaseline
	};

	if ( graph.normalTex ) diagnosticViews.normal = vec4( graph.normalTex.xyz.mul( 0.5 ).add( 0.5 ), 1 );
	if ( graph.emissiveTex ) diagnosticViews.emissive = compressHdrForInspection( graph.emissiveTex );
	if ( graph.aoTextureNode ) diagnosticViews[ 'AO.r' ] = vec4( vec3( graph.indirectVisibility ), 1 );
	if ( graph.bloomTextureNode ) diagnosticViews[ 'bloom contribution' ] = compressHdrForInspection( graph.bloomTextureNode );

	const diagnostics = {
		mode: 'final',
		modes: Object.keys( diagnosticViews ),
		views: diagnosticViews,
		activeView: graph.finalOutputNode,
		claimBoundary: config.contract,
		numericProvenance: {
			...config.numericProvenance,
			AUTHORED_SCENE: 'Authored visual fixture values; not performance constants.'
		},
		configValidation,
		configOnlyValidation,
		capability,
		resourceOwnership: {
			pass: 'scenePass',
			effects: [ gtao ? 'GTAONode' : null, bloomPass ? 'BloomNode' : null ].filter( Boolean ),
			presentation: 'RenderPipeline',
			disposal: 'idempotent app.dispose() owns fixture meshes/materials, effects, scenePass, RenderPipeline, and renderer'
		}
	};

	let viewport = { width: 1, height: 1, dpr: 1 };
	let authoredTimeSeconds = 0;

	function resize( width, height, dpr = globalThis.devicePixelRatio ?? 1 ) {

		const safeWidth = Math.max( 1, Math.floor( width ) );
		const safeHeight = Math.max( 1, Math.floor( height ) );
		const safeDpr = Math.max( Number.EPSILON, Number( dpr ) || 1 );

		viewport = { width: safeWidth, height: safeHeight, dpr: safeDpr };
		camera.aspect = safeWidth / safeHeight;
		camera.updateProjectionMatrix();
		renderer.setPixelRatio( safeDpr );
		renderer.setSize( safeWidth, safeHeight, false );

	}

	function getViewport() {

		return { ...viewport };

	}

	function setSceneResolutionScale( scale ) {

		if ( ! Number.isFinite( scale ) || scale <= 0 ) throw new Error( 'Scene resolution scale must be finite and positive.' );
		scenePass.setResolutionScale( scale );
		return scenePass.getResolutionScale();

	}

	function setTime( seconds ) {

		authoredTimeSeconds = Math.max( 0, Number( seconds ) || 0 );
		mesh.rotation.y = AUTHORED_SCENE.rotationRadiansPerSecond * authoredTimeSeconds;
		mesh.updateMatrixWorld( true );
		return authoredTimeSeconds;

	}

	function estimateTargetBytes() {

		return estimateMrtLogicalBytes( config, {
			width: viewport.width * viewport.dpr,
			height: viewport.height * viewport.dpr,
			scale: scenePass.getResolutionScale()
		} );

	}

	function setDebugMode( mode ) {

		if ( ! diagnostics.views[ mode ] ) {

			throw new Error( `Unknown or unimplemented image-pipeline debug mode "${ mode }".` );

		}

		const nextView = diagnostics.views[ mode ];
		if ( diagnostics.mode === mode && renderPipeline.outputNode === nextView ) return nextView;
		diagnostics.mode = mode;
		diagnostics.activeView = nextView;
		renderPipeline.outputNode = nextView;
		renderPipeline.needsUpdate = true;
		return diagnostics.activeView;

	}

	function render( deltaSeconds = 0 ) {

		if ( Number.isFinite( deltaSeconds ) && deltaSeconds > 0 ) {

			authoredTimeSeconds += deltaSeconds;
			mesh.rotation.y = AUTHORED_SCENE.rotationRadiansPerSecond * authoredTimeSeconds;

		}

		renderPipeline.render();

	}

	let disposed = false;
	function dispose() {

		if ( disposed ) return false;
		disposed = true;
		for ( const fixtureMesh of fixtureMeshes ) {

			fixtureMesh.geometry.dispose();
			fixtureMesh.material.dispose();

		}
		gtao?.dispose?.();
		bloomPass?.dispose?.();
		scenePass.dispose?.();
		renderPipeline.dispose?.();
		renderer.dispose();
		return true;

	}

	return {
		renderer,
		scene,
		camera,
		renderPipeline,
		scenePass,
		diagnostics,
		fixtureMeshes,
		resize,
		getViewport,
		setSceneResolutionScale,
		setTime,
		estimateTargetBytes,
		setDebugMode,
		render,
		dispose
	};

}
