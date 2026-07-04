import * as THREE from 'three/webgpu';
import {
	ambientOcclusion,
	builtinAOContext,
	materialAO,
	mrt,
	normalView,
	output,
	pass,
	vec3,
	vec4,
	velocity
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

export const AO_DEBUG_MODES = Object.freeze( {
	final: 'final',
	rawAO: 'raw-ao',
	denoisedAO: 'denoised-ao',
	normal: 'normal',
	depth: 'depth',
	disabled: 'disabled'
} );

function createScene() {
	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x0f1418 );

	const camera = new THREE.PerspectiveCamera( 55, 16 / 9, 0.1, 80 );
	camera.position.set( 2.6, 1.8, 4.2 );
	camera.lookAt( 0, 0.65, 0 );

	const receiverMaterial = new THREE.MeshStandardNodeMaterial( {
		color: 0x90988f,
		roughness: 0.72,
		metalness: 0.0
	} );
	receiverMaterial.aoNode = materialAO;

	const wallMaterial = new THREE.MeshStandardNodeMaterial( {
		color: 0x8793a0,
		roughness: 0.82,
		metalness: 0.0
	} );
	wallMaterial.aoNode = materialAO;

	const receiver = new THREE.Mesh( new THREE.PlaneGeometry( 5, 5 ), receiverMaterial );
	receiver.rotation.x = - Math.PI / 2;
	receiver.name = 'ao-fixture-wall-receiver-floor';
	scene.add( receiver );

	const wall = new THREE.Mesh( new THREE.BoxGeometry( 0.22, 1.8, 3.2 ), wallMaterial );
	wall.position.set( -0.9, 0.9, -0.35 );
	wall.name = 'ao-fixture-wall-receiver-wall';
	scene.add( wall );

	const block = new THREE.Mesh( new THREE.BoxGeometry( 0.9, 0.9, 0.9 ), new THREE.MeshStandardNodeMaterial( {
		color: 0xb7a57a,
		roughness: 0.65,
		metalness: 0.0
	} ) );
	block.position.set( 0.35, 0.45, 0.1 );
	block.name = 'ao-fixture-contact-block';
	scene.add( block );

	const emissive = new THREE.Mesh( new THREE.SphereGeometry( 0.18, 32, 16 ), new THREE.MeshStandardNodeMaterial( {
		color: 0xffd7a0,
		emissive: 0xffb45a,
		emissiveIntensity: 2.0,
		roughness: 0.2
	} ) );
	emissive.position.set( 1.2, 0.45, -0.45 );
	emissive.name = 'ao-fixture-emissive-object';
	scene.add( emissive );

	const sun = new THREE.DirectionalLight( 0xffffff, 3.0 );
	sun.position.set( 3, 5, 2 );
	scene.add( sun );
	scene.add( new THREE.HemisphereLight( 0xbfd7ff, 0x1d241e, 1.4 ) );

	return { scene, camera };
}

function configureGTAO( gtaoNode, {
	resolutionScale = 0.5,
	radius = 0.5,
	samples = 16,
	thickness = 0.35,
	distanceExponent = 1.6,
	distanceFallOff = 0.35
} = {} ) {
	gtaoNode.resolutionScale = resolutionScale;
	gtaoNode.radius.value = radius;
	gtaoNode.samples.value = samples;
	gtaoNode.thickness.value = thickness;
	gtaoNode.distanceExponent.value = distanceExponent;
	gtaoNode.distanceFallOff.value = distanceFallOff;
}

export async function createWebGPUNodeGTAO( {
	canvas,
	enableAO = true,
	enableDenoise = true,
	enableTemporal = false,
	width = 1280,
	height = 720,
	dpr = 1
} = {} ) {
	const renderer = new THREE.WebGPURenderer( {
		canvas,
		antialias: enableTemporal === false,
		outputBufferType: THREE.HalfFloatType
	} );
	renderer.setPixelRatio( dpr );
	renderer.setSize( width, height, false );
	await renderer.init();

	const { scene, camera } = createScene();
	camera.aspect = width / height;
	camera.updateProjectionMatrix();

	const renderPipeline = new THREE.RenderPipeline( renderer );
	const scenePass = pass( scene, camera );
	const mrtOutputs = {
		output,
		normal: normalView
	};

	if ( enableTemporal === true ) {
		mrtOutputs.velocity = velocity;
	}

	scenePass.setMRT( mrt( mrtOutputs ) );

	const sceneColor = scenePass.getTextureNode( 'output' );
	const sceneDepth = scenePass.getTextureNode( 'depth' );
	const sceneNormal = scenePass.getTextureNode( 'normal' );
	const velocityNode = enableTemporal === true ? scenePass.getTextureNode( 'velocity' ) : null;
	const gtaoNode = ao( sceneDepth, sceneNormal, camera );
	configureGTAO( gtaoNode );

	if ( enableTemporal === true ) {
		gtaoNode.useTemporalFiltering = true;
	}

	const rawAO = gtaoNode.getTextureNode();
	const denoisedAO = enableDenoise === true ? denoise( rawAO, sceneDepth, sceneNormal, camera ) : rawAO;
	const visibility = denoisedAO.r;
	const materialContextOutput = builtinAOContext( visibility, sceneColor );
	const temporallyFilteredOutput = enableTemporal === true
		? traa( materialContextOutput, sceneDepth, velocityNode, camera )
		: materialContextOutput;

	const debugOutputs = {
		[ AO_DEBUG_MODES.final ]: temporallyFilteredOutput,
		[ AO_DEBUG_MODES.rawAO ]: vec4( vec3( rawAO.r ), 1 ),
		[ AO_DEBUG_MODES.denoisedAO ]: vec4( vec3( visibility ), 1 ),
		[ AO_DEBUG_MODES.normal ]: vec4( sceneNormal.mul( 0.5 ).add( 0.5 ), 1 ),
		[ AO_DEBUG_MODES.depth ]: vec4( vec3( sceneDepth ), 1 ),
		[ AO_DEBUG_MODES.disabled ]: sceneColor
	};
	const lightingContract = {
		application: 'builtinAOContext',
		materialSlot: materialAO,
		lightingProperty: ambientOcclusion,
		excludes: [ 'direct-light', 'emissive', 'ui', 'bloom-fed-highlights' ]
	};
	let debugMode = enableAO === true ? AO_DEBUG_MODES.final : AO_DEBUG_MODES.disabled;

	function setPipelineOutput( mode ) {
		debugMode = mode;
		renderPipeline.outputNode = debugOutputs[ debugMode ] ?? debugOutputs[ AO_DEBUG_MODES.final ];
		renderPipeline.needsUpdate = true;
	}

	setPipelineOutput( debugMode );

	function setAOEnabled( enabled ) {
		setPipelineOutput( enabled === true ? AO_DEBUG_MODES.final : AO_DEBUG_MODES.disabled );
	}

	function setDebugMode( mode ) {
		setPipelineOutput( mode );
	}

	function resize( nextWidth, nextHeight, nextDpr = renderer.getPixelRatio() ) {
		renderer.setPixelRatio( nextDpr );
		renderer.setSize( nextWidth, nextHeight, false );
		camera.aspect = nextWidth / nextHeight;
		camera.updateProjectionMatrix();
	}

	function render() {
		renderPipeline.render();
	}

	function dispose() {
		gtaoNode.dispose?.();
		denoisedAO.dispose?.();
		scenePass.dispose?.();
		renderPipeline.dispose();
		renderer.dispose();
	}

	return {
		renderer,
		renderPipeline,
		scenePass,
		scene,
		camera,
		gtaoNode,
		rawAO,
		denoisedAO,
		lightingContract,
		get debugMode() {
			return debugMode;
		},
		render,
		resize,
		setAOEnabled,
		setDebugMode,
		dispose
	};
}
