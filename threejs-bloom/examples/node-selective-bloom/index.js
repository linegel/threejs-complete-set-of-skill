import * as THREE from 'three/webgpu';
import {
	color,
	emissive,
	float,
	luminance,
	mrt,
	output,
	pass,
	renderOutput,
	vec3,
	vec4
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export const DEBUG_MODES = Object.freeze( {
	COMBINED: 'combined',
	EMISSIVE_ONLY: 'emissive-only',
	BLOOM_ONLY: 'bloom-only',
	NO_POST_BASELINE: 'no-post-baseline',
	FALSE_COLOR_LUMINANCE: 'false-color-luminance',
	RESOLUTION_SCALE_OVERLAY: 'resolution-scale-overlay',
	TRANSPARENT_EMITTER: 'transparent-emitter'
} );

export const QUALITY_TIERS = Object.freeze( {
	full: {
		name: 'full',
		bloomScale: 0.5,
		sceneScale: 1,
		pixelRatioCap: 2,
		contributionMode: 'mrt-emissive',
		dynamicContribution: true,
		maxSparkCount: 18
	},
	balanced: {
		name: 'balanced',
		bloomScale: 0.33,
		sceneScale: 1,
		pixelRatioCap: 1.5,
		contributionMode: 'mrt-emissive',
		dynamicContribution: true,
		maxSparkCount: 10
	},
	reduced: {
		name: 'reduced',
		bloomScale: 0.25,
		sceneScale: 1,
		pixelRatioCap: 1,
		contributionMode: 'disabled-in-reduced-tier',
		dynamicContribution: false,
		maxSparkCount: 6
	}
} );

export const BLOOM_CONTROLS = Object.freeze( {
	strength: 0.55,
	radius: 0.35,
	threshold: 0.9,
	smoothWidth: 0.08
} );

export const EMISSIVE_TIERS = Object.freeze( {
	ordinaryLitSurface: 0,
	practicalLampFilament: 4,
	persistentLaser: 8,
	projectileCore: 16,
	shortSparkFlash: 32
} );

const GEOMETRY_BUDGETS = Object.freeze( {
	sceneRenderCount: 1,
	mrtTargets: [ 'output', 'emissive' ],
	extraSceneTraversalsForBloom: 0,
	temporaryWholeSceneOverridesPerFrame: 0,
	bloomMipCount: 5,
	outputTransformOwners: 1
} );

const REQUIRED_DEBUG_MODES = Object.freeze( [
	DEBUG_MODES.COMBINED,
	DEBUG_MODES.EMISSIVE_ONLY,
	DEBUG_MODES.BLOOM_ONLY,
	DEBUG_MODES.NO_POST_BASELINE,
	DEBUG_MODES.FALSE_COLOR_LUMINANCE,
	DEBUG_MODES.RESOLUTION_SCALE_OVERLAY,
	DEBUG_MODES.TRANSPARENT_EMITTER
] );

function isFiniteNumber( value ) {

	return Number.isFinite( value );

}

export function validateBloomConfig( {
	controls = BLOOM_CONTROLS,
	quality = QUALITY_TIERS.full,
	budgets = GEOMETRY_BUDGETS,
	debugModes = DEBUG_MODES,
	outputTransformOwners
} = {} ) {

	const errors = [];
	const mergedControls = { ...BLOOM_CONTROLS, ...controls };
	const mergedQuality = { ...QUALITY_TIERS.full, ...quality };
	const mergedBudgets = { ...GEOMETRY_BUDGETS, ...budgets };
	const transformOwnerCount = outputTransformOwners ?? mergedBudgets.outputTransformOwners;
	const debugModeValues = Object.values( debugModes );

	if ( ! isFiniteNumber( mergedControls.strength ) || mergedControls.strength < 0 || mergedControls.strength > 4 ) {
		errors.push( 'strength must be finite and in [0, 4].' );
	}
	if ( ! isFiniteNumber( mergedControls.radius ) || mergedControls.radius < 0 || mergedControls.radius > 1 ) {
		errors.push( 'radius must be finite and in [0, 1].' );
	}
	if ( ! isFiniteNumber( mergedControls.threshold ) || mergedControls.threshold < 0 || mergedControls.threshold > 32 ) {
		errors.push( 'threshold must be finite and in [0, 32] scene-linear HDR units.' );
	}
	if ( ! isFiniteNumber( mergedControls.smoothWidth ) || mergedControls.smoothWidth < 0 || mergedControls.smoothWidth > 4 ) {
		errors.push( 'smoothWidth must be finite and in [0, 4].' );
	}
	if ( ! isFiniteNumber( mergedQuality.bloomScale ) || mergedQuality.bloomScale <= 0 || mergedQuality.bloomScale > 1 ) {
		errors.push( 'tier bloomScale must be > 0 and <= 1.' );
	}
	if ( mergedBudgets.sceneRenderCount !== 1 ) {
		errors.push( 'sceneRenderCount must stay 1 for MRT-selective bloom.' );
	}
	if ( mergedBudgets.extraSceneTraversalsForBloom !== 0 ) {
		errors.push( 'extraSceneTraversalsForBloom must stay 0.' );
	}
	if ( transformOwnerCount !== 1 ) {
		errors.push( 'exactly one output transform owner is required.' );
	}

	for ( const mode of REQUIRED_DEBUG_MODES ) {
		if ( ! debugModeValues.includes( mode ) ) {
			errors.push( `missing debug mode ${ mode }.` );
		}
	}

	if ( errors.length > 0 ) {
		throw new Error( `Invalid bloom config:\n- ${ errors.join( '\n- ' ) }` );
	}

	return {
		pass: true,
		controls: mergedControls,
		quality: mergedQuality,
		budgets: mergedBudgets,
		debugModes: debugModeValues
	};

}

function createSeededRandom( seed ) {

	let state = seed >>> 0;

	return function seededRandom() {

		state += 0x6D2B79F5;
		let t = state;
		t = Math.imul( t ^ t >>> 15, t | 1 );
		t ^= t + Math.imul( t ^ t >>> 7, t | 61 );

		return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;

	};

}

function nodeStandardMaterial( {
	name,
	baseColor,
	roughness = 0.55,
	metalness = 0,
	emissiveColor = null,
	emissiveIntensity = 0
} ) {

	const material = new THREE.MeshStandardNodeMaterial( {
		name,
		roughness,
		metalness
	} );

	material.colorNode = color( baseColor );

	if ( emissiveColor !== null && emissiveIntensity > 0 ) {

		material.emissiveNode = color( emissiveColor ).mul( float( emissiveIntensity ) );

	}

	return material;

}

function nodeSpriteMaterial( {
	name,
	emissiveColor,
	emissiveIntensity,
	alpha = 0.62
} ) {

	const material = new THREE.SpriteNodeMaterial( {
		name,
		transparent: true,
		depthWrite: false,
		depthTest: true,
		blending: THREE.AdditiveBlending
	} );

	material.colorNode = color( emissiveColor ).mul( float( emissiveIntensity ) );
	material.opacityNode = float( alpha );
	material.emissiveNode = color( emissiveColor ).mul( float( emissiveIntensity ) );
	material.mrtNode = mrt( {
		emissive: vec4( color( emissiveColor ).mul( float( emissiveIntensity ) ), alpha ),
		transparentEmitter: vec4( color( emissiveColor ).mul( float( emissiveIntensity ) ), alpha )
	} );
	material.userData.transparentEmitterPolicy = {
		id: 'transparent-emitter',
		transparent: true,
		depthWrite: false,
		depthTest: true,
		alpha,
		bloomContribution: 'material-level mrtNode emissive override'
	};

	return material;

}

function createAuthoredScene( seed, quality ) {

	const random = createSeededRandom( seed );
	const scene = new THREE.Scene();
	scene.name = 'MRT selective bloom scene';
	scene.background = new THREE.Color( 0x05070a );

	const camera = new THREE.PerspectiveCamera( 45, 1, 0.1, 80 );
	camera.name = 'Bloom demo camera';
	camera.position.set( 5.8, 3.2, 7.4 );
	camera.lookAt( 0, 0.8, 0 );

	const root = new THREE.Group();
	root.name = 'Authored luminance hierarchy';
	scene.add( root );

	const floorMaterial = nodeStandardMaterial( {
		name: 'ordinary lit surface, no emissive MRT contribution',
		baseColor: 0x607080,
		roughness: 0.82,
		metalness: 0
	} );
	const floor = new THREE.Mesh( new THREE.BoxGeometry( 9, 0.08, 5.5 ), floorMaterial );
	floor.name = 'ordinary-lit-floor-no-bloom-membership';
	floor.position.y = - 0.05;
	root.add( floor );

	const metalMaterial = nodeStandardMaterial( {
		name: 'bright metal, still no emissive MRT contribution',
		baseColor: 0xd9e2e8,
		roughness: 0.38,
		metalness: 0.8
	} );
	const metalBlock = new THREE.Mesh( new THREE.BoxGeometry( 1.1, 1.1, 1.1 ), metalMaterial );
	metalBlock.name = 'bright-metal-does-not-bloom-by-threshold-alone';
	metalBlock.position.set( - 2.35, 0.55, - 0.65 );
	root.add( metalBlock );

	const lampMaterial = nodeStandardMaterial( {
		name: 'practical lamp filament emissive tier',
		baseColor: 0x32230f,
		emissiveColor: 0xffb45e,
		emissiveIntensity: EMISSIVE_TIERS.practicalLampFilament,
		roughness: 0.45
	} );
	const lampGeometry = new THREE.SphereGeometry( 0.18, 32, 16 );

	for ( let i = 0; i < 4; i ++ ) {

		const lamp = new THREE.Mesh( lampGeometry, lampMaterial );
		lamp.name = `practical-lamp-filament-${ i }`;
		lamp.position.set( - 2.8 + i * 1.85, 1.05 + ( i % 2 ) * 0.35, - 1.75 );
		root.add( lamp );

	}

	const laserMaterial = nodeStandardMaterial( {
		name: 'persistent laser emissive tier',
		baseColor: 0x071c24,
		emissiveColor: 0x46d9ff,
		emissiveIntensity: EMISSIVE_TIERS.persistentLaser,
		roughness: 0.2
	} );
	const laser = new THREE.Mesh( new THREE.CylinderGeometry( 0.035, 0.035, 4.7, 16 ), laserMaterial );
	laser.name = 'persistent-laser-authored-emissive';
	laser.rotation.z = Math.PI * 0.5;
	laser.position.set( 0.2, 1.45, 0.25 );
	root.add( laser );

	const projectileMaterial = nodeStandardMaterial( {
		name: 'projectile core emissive tier',
		baseColor: 0x2c0815,
		emissiveColor: 0xff386c,
		emissiveIntensity: EMISSIVE_TIERS.projectileCore,
		roughness: 0.35
	} );
	const projectile = new THREE.Mesh( new THREE.SphereGeometry( 0.32, 48, 24 ), projectileMaterial );
	projectile.name = 'projectile-core-authored-emissive';
	projectile.position.set( 1.95, 0.78, 0.55 );
	root.add( projectile );

	const transparentEmitterMaterial = nodeSpriteMaterial( {
		name: 'transparent-emitter sprite material-level bloom contribution',
		emissiveColor: 0x80f7ff,
		emissiveIntensity: EMISSIVE_TIERS.projectileCore,
		alpha: 0.58
	} );
	const transparentEmitter = new THREE.Sprite( transparentEmitterMaterial );
	transparentEmitter.name = 'transparent-emitter-alpha-depthWrite-false';
	transparentEmitter.position.set( 2.35, 1.2, 0.15 );
	transparentEmitter.scale.set( 0.75, 0.75, 1 );
	root.add( transparentEmitter );

	const sparkMaterial = nodeStandardMaterial( {
		name: 'short spark flash emissive tier',
		baseColor: 0x3b1604,
		emissiveColor: 0xfff1b8,
		emissiveIntensity: EMISSIVE_TIERS.shortSparkFlash,
		roughness: 0.25
	} );
	const sparkGeometry = new THREE.IcosahedronGeometry( 0.055, 1 );
	const sparkCount = Math.min( quality.maxSparkCount, 18 );

	for ( let i = 0; i < sparkCount; i ++ ) {

		const spark = new THREE.Mesh( sparkGeometry, sparkMaterial );
		const angle = random() * Math.PI * 2;
		const radius = 0.25 + random() * 0.75;
		const height = - 0.35 + random() * 0.7;
		spark.name = `short-spark-flash-${ i }`;
		spark.position.set(
			projectile.position.x + Math.cos( angle ) * radius,
			projectile.position.y + height,
			projectile.position.z + Math.sin( angle ) * radius
		);
		spark.userData.phase = random() * Math.PI * 2;
		root.add( spark );

	}

	const ambientLight = new THREE.HemisphereLight( 0xaec9ff, 0x15120d, 0.45 );
	scene.add( ambientLight );

	const keyLight = new THREE.DirectionalLight( 0xffffff, 2.4 );
	keyLight.position.set( 3.5, 4.5, 2.25 );
	scene.add( keyLight );

	const rimLight = new THREE.PointLight( 0x7ab6ff, 8, 8 );
	rimLight.position.set( - 2.8, 2.1, 1.8 );
	scene.add( rimLight );

	return {
		scene,
		camera,
		root,
		animated: {
			projectile,
			laser,
			transparentEmitter,
			sparks: root.children.filter( ( child ) => child.name.startsWith( 'short-spark-flash-' ) )
		}
	};

}

export function selectBloomPipelineMode( {
	isWebGPUBackend = false,
	requestedTier = 'auto'
} = {} ) {

	if ( isWebGPUBackend !== true ) {
		throw new Error( 'WebGPU backend required for the canonical node selective bloom path. If the user explicitly asks how to apply fallback when WebGPU is unavailable, route to threejs-compatibility-fallbacks.' );
	}

	const tierName = requestedTier === 'auto' ? 'full' : requestedTier;
	const tier = QUALITY_TIERS[ tierName ] || QUALITY_TIERS.full;
	const dynamicMrt = isWebGPUBackend === true && tier.dynamicContribution === true && tier.name !== 'reduced';

	return {
		...tier,
		dynamicMrt,
		liveBloom: dynamicMrt,
		isWebGPUBackend,
		contributionPolicy: dynamicMrt ? 'mrt-emissive' : 'disabled-in-reduced-tier',
		budgetReason: dynamicMrt ? [] : [ 'dynamic MRT emissive bloom disabled for reduced WebGPU tier' ]
	};

}

function selectQualityTier( renderer, requestedTier ) {

	return selectBloomPipelineMode( {
		isWebGPUBackend: renderer.backend.isWebGPUBackend === true,
		requestedTier
	} );

}

function buildOutputNode( mode, nodes ) {

	const { sceneColor, emissiveContribution, bloomOutput, falseColorLuminance, resolutionScaleOverlay, transparentEmitterContribution } = nodes;

	switch ( mode ) {

		case DEBUG_MODES.EMISSIVE_ONLY:
			return renderOutput( emissiveContribution );

		case DEBUG_MODES.BLOOM_ONLY:
			return renderOutput( bloomOutput );

		case DEBUG_MODES.NO_POST_BASELINE:
			return renderOutput( sceneColor );

		case DEBUG_MODES.FALSE_COLOR_LUMINANCE:
			return renderOutput( falseColorLuminance );

		case DEBUG_MODES.RESOLUTION_SCALE_OVERLAY:
			return renderOutput( resolutionScaleOverlay );

		case DEBUG_MODES.TRANSPARENT_EMITTER:
			return renderOutput( transparentEmitterContribution );

		case DEBUG_MODES.COMBINED:
		default:
			return renderOutput( sceneColor.add( bloomOutput ) );

	}

}

function applyBloomControls( bloomPass, controls ) {

	bloomPass.strength.value = controls.strength;
	bloomPass.radius.value = controls.radius;
	bloomPass.threshold.value = controls.threshold;
	bloomPass.smoothWidth.value = controls.smoothWidth;

}

function updateAuthoredAnimation( animated, timeSeconds, dynamicContribution ) {

	if ( dynamicContribution === false ) {

		return;

	}

	const orbit = timeSeconds * 0.8;

	animated.projectile.position.x = 1.75 + Math.cos( orbit ) * 0.32;
	animated.projectile.position.z = 0.45 + Math.sin( orbit ) * 0.2;
	animated.laser.rotation.y = Math.sin( timeSeconds * 0.7 ) * 0.12;
	animated.transparentEmitter.scale.setScalar( 0.65 + Math.sin( timeSeconds * 2.3 ) * 0.08 );

	for ( let i = 0; i < animated.sparks.length; i ++ ) {

		const spark = animated.sparks[ i ];
		const phase = spark.userData.phase;
		const pulse = 0.75 + Math.sin( timeSeconds * 5.0 + phase ) * 0.25;
		spark.scale.setScalar( pulse );

	}

}

function disposeObjectTree( object ) {

	const geometries = new Set();
	const materials = new Set();

	object.traverse( ( child ) => {

		if ( child.geometry ) geometries.add( child.geometry );

		if ( child.material ) {

			if ( Array.isArray( child.material ) ) {

				for ( const material of child.material ) materials.add( material );

			} else {

				materials.add( child.material );

			}

		}

	} );

	for ( const geometry of geometries ) geometry.dispose();
	for ( const material of materials ) material.dispose();

}

export async function createNodeSelectiveBloomExample( {
	canvas,
	seed = 0xB1004D,
	quality: requestedQuality = 'auto',
	width = 1280,
	height = 720,
	pixelRatio = 1,
	controls: controlOverrides = {},
	debugMode = DEBUG_MODES.COMBINED
} = {} ) {

	// Build order 1: WebGPURenderer with HDR HalfFloat output buffers.
	const renderer = new THREE.WebGPURenderer( {
		canvas,
		antialias: true,
		outputBufferType: THREE.HalfFloatType
	} );
	renderer.toneMapping = THREE.AgXToneMapping;
	renderer.toneMappingExposure = 1;

	// Build order 2: initialize, then capability-gate the quality tier.
	await renderer.init();

	const quality = selectQualityTier( renderer, requestedQuality );
	const controls = { ...BLOOM_CONTROLS, ...controlOverrides };
	validateBloomConfig( { controls, quality } );
	const sceneBundle = createAuthoredScene( seed, quality );
	const { scene, camera, animated } = sceneBundle;

	// Build order 3: one RenderPipeline owns the post graph.
	const renderPipeline = new THREE.RenderPipeline( renderer );
	renderPipeline.outputColorTransform = false;

	// Build order 4: one scene pass writes both scene color and emissive MRT targets.
	const scenePass = pass( scene, camera );
	scenePass.setResolutionScale( quality.sceneScale );
	if ( quality.dynamicMrt === true ) {

		scenePass.setMRT( mrt( {
			output,
			emissive,
			transparentEmitter: vec4( 0, 0, 0, 0 )
		} ) );

	}

	// Build order 5: downstream nodes read the shared MRT textures, not a second scene render.
	const sceneColor = scenePass.getTextureNode( 'output' );
	const emissiveContribution = quality.dynamicMrt === true
		? scenePass.getTextureNode( 'emissive' )
		: sceneColor.mul( float( 0 ) );

	// Build order 6: built-in BloomNode consumes the emissive contribution texture node.
	const bloomPass = quality.liveBloom === true
		? bloom( emissiveContribution, controls.strength, controls.radius, controls.threshold )
		: null;
	if ( bloomPass !== null ) {

		bloomPass.smoothWidth.value = controls.smoothWidth;
		bloomPass.setResolutionScale( quality.bloomScale );

	}
	const bloomOutput = bloomPass === null ? sceneColor.mul( float( 0 ) ) : bloomPass.getTextureNode();
	const transparentEmitterContribution = quality.dynamicMrt === true
		? scenePass.getTextureNode( 'transparentEmitter' )
		: sceneColor.mul( float( 0 ) );
	const preToneMapLuminance = luminance( sceneColor.rgb );
	const falseColorLuminance = vec4(
		preToneMapLuminance,
		preToneMapLuminance.mul( float( 0.35 ) ),
		preToneMapLuminance.mul( float( 0.08 ) ),
		1
	);
	const resolutionScaleOverlay = sceneColor.mul( float( 0.65 ) ).add( vec4( vec3( float( quality.bloomScale ) ), 1 ).mul( float( 0.35 ) ) );

	const pipelineNodes = {
		sceneColor,
		emissiveContribution,
		bloomOutput,
		falseColorLuminance,
		resolutionScaleOverlay,
		transparentEmitterContribution
	};

	// Build order 7: one explicit renderOutput owner performs tone mapping and output conversion.
	renderPipeline.outputNode = buildOutputNode( debugMode, pipelineNodes );
	renderPipeline.needsUpdate = true;

	function resize( nextWidth = width, nextHeight = height, nextPixelRatio = pixelRatio ) {

		width = nextWidth;
		height = nextHeight;
		pixelRatio = Math.min( nextPixelRatio, quality.pixelRatioCap );

		renderer.setPixelRatio( pixelRatio );
		renderer.setSize( width, height, false );
		scenePass.setSize( width, height );
		if ( bloomPass !== null ) bloomPass.setSize( width, height );

		camera.aspect = width / height;
		camera.updateProjectionMatrix();

	}

	function setBloomControls( nextControls = {} ) {

		Object.assign( controls, nextControls );
		if ( bloomPass === null ) return;
		applyBloomControls( bloomPass, controls );

		if ( typeof nextControls.resolutionScale === 'number' ) {

			bloomPass.setResolutionScale( nextControls.resolutionScale );
			bloomPass.setSize( width, height );

		}

	}

	function setDebugMode( mode ) {

		debugMode = mode;
		renderPipeline.outputNode = buildOutputNode( debugMode, pipelineNodes );
		renderPipeline.needsUpdate = true;

	}

	async function compileAsync() {

		// Build order deviation: the reference says compile after MRT configuration
		// when first-frame stutter matters. The example exposes it as an opt-in hook
		// so tests can instantiate without requiring a browser GPU compile.
		await scenePass.compileAsync( renderer );

	}

	function frame( timeSeconds = 0 ) {

		updateAuthoredAnimation( animated, timeSeconds, quality.dynamicContribution );
		renderPipeline.render();

	}

	function start() {

		renderer.setAnimationLoop( ( timeMilliseconds ) => {

			frame( timeMilliseconds * 0.001 );

		} );

	}

	function stop() {

		renderer.setAnimationLoop( null );

	}

	function dispose() {

		stop();
		bloomPass?.dispose?.();
		scenePass.dispose();
		renderPipeline.dispose();
		disposeObjectTree( scene );
		renderer.dispose();

	}

	resize( width, height, pixelRatio );

	return {
		renderer,
		renderPipeline,
		scene,
		camera,
		scenePass,
		bloomPass,
		quality,
		controls,
		debugModes: DEBUG_MODES,
		budgets: GEOMETRY_BUDGETS,
		resize,
		setBloomControls,
		setDebugMode,
		compileAsync,
		frame,
		start,
		stop,
		dispose
	};

}
