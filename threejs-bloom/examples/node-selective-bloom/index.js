import * as THREE from 'three/webgpu';
import {
	color,
	emissive,
	float,
	luminance,
	materialReference,
	mrt,
	output,
	pass,
	renderOutput,
	vec3,
	vec4
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const LAB_ID = 'node-selective-bloom';

export const DEBUG_MODES = Object.freeze( {
	COMBINED: 'combined',
	EMISSIVE_ONLY: 'emissive-only',
	BLOOM_ONLY: 'bloom-only',
	NO_POST_BASELINE: 'no-post-baseline',
	FALSE_COLOR_LUMINANCE: 'false-color-luminance',
	RESOLUTION_SCALE_OVERLAY: 'resolution-scale-overlay',
	TRANSPARENT_EMITTER: 'transparent-emitter'
} );

export const BLOOM_MECHANISMS = Object.freeze( [
	'threshold-and-knee',
	'point-spread-function',
	'emissive-hierarchy',
	'transparent-emitters',
	'depth-and-occlusion',
	'shared-emissive-integration'
] );

export const BLOOM_SCENARIOS = BLOOM_MECHANISMS;

export const QUALITY_TIERS = Object.freeze( {
	full: {
		name: 'full',
		bloomScale: 0.5,
		sceneScale: 1,
		pixelRatioCap: 2,
		contributionMode: 'mrt-emissive',
		dynamicContribution: true,
		maxPulseCount: 18
	},
	balanced: {
		name: 'balanced',
		bloomScale: 0.33,
		sceneScale: 1,
		pixelRatioCap: 1.5,
		contributionMode: 'mrt-emissive',
		dynamicContribution: true,
		maxPulseCount: 10
	},
	mobile: {
		name: 'mobile',
		bloomScale: 0.25,
		sceneScale: 1,
		pixelRatioCap: 1,
		contributionMode: 'mrt-emissive',
		dynamicContribution: true,
		maxPulseCount: 6
	},
	'reduced-readable-base': {
		name: 'reduced-readable-base',
		bloomScale: 0.25,
		sceneScale: 1,
		pixelRatioCap: 1,
		contributionMode: 'disabled-in-reduced-tier',
		dynamicContribution: false,
		maxPulseCount: 6
	}
} );

export const BLOOM_CONTROLS = Object.freeze( {
	strength: 0.55,
	radius: 0.35,
	threshold: 0.9,
	smoothWidth: 0.08
} );

export const BLOOM_STAGE_KINDS = Object.freeze( {
	BASE: 'base',
	SELECTIVE: 'selective',
	BLOOM: 'bloom'
} );

export const BLOOM_ACCEPTANCE_THRESHOLDS = Object.freeze( {
	brightNonEmissiveRatioMaximum: 0.01,
	psfNormalizedIncreaseTolerance: 1e-3,
	transparentOcclusionRatioMaximum: 0.02,
	noPostSilhouetteContrastMinimum: 0.1
} );

export const EMISSIVE_TIERS = Object.freeze( {
	ordinaryLitSurface: 0,
	practicalLampFilament: 4,
	luminousInstrumentBar: 8,
	calibrationSource: 16,
	pulsedReferenceMarker: 32
} );

export function calculateBloomDrawingBufferSize( width, height, pixelRatio, pixelRatioCap ) {

	if ( ! Number.isInteger( width ) || ! Number.isInteger( height ) || width < 1 || height < 1 ) throw new Error( 'Bloom drawing-buffer dimensions must be positive integers.' );
	if ( ! Number.isFinite( pixelRatio ) || pixelRatio <= 0 || ! Number.isFinite( pixelRatioCap ) || pixelRatioCap <= 0 ) throw new Error( 'Bloom drawing-buffer pixel ratios must be positive.' );
	const effectiveDpr = Math.min( pixelRatio, pixelRatioCap );
	return {
		effectiveDpr,
		width: Math.max( 1, Math.floor( width * effectiveDpr ) ),
		height: Math.max( 1, Math.floor( height * effectiveDpr ) )
	};

}

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

function metricClaim( measured, pass, details ) {

	if ( measured !== true ) return { verdict: 'INSUFFICIENT_EVIDENCE', provenance: 'Measured', ...details };
	return { verdict: pass === true ? 'PASS' : 'FAIL', provenance: 'Measured', ...details };

}

function finitePositiveDenominatorRatio( numerator, denominator ) {

	if ( ! Number.isFinite( numerator ) || ! Number.isFinite( denominator ) || denominator <= 0 ) return null;
	return numerator / denominator;

}

function sameStrictOrdering( before, after ) {

	if ( ! Array.isArray( before ) || ! Array.isArray( after ) || before.length < 2 || before.length !== after.length ) return null;
	if ( before.some( ( value ) => ! Number.isFinite( value ) ) || after.some( ( value ) => ! Number.isFinite( value ) ) ) return null;
	for ( let i = 0; i < before.length; i ++ ) {

		for ( let j = i + 1; j < before.length; j ++ ) {

			const beforeSign = Math.sign( before[ i ] - before[ j ] );
			const afterSign = Math.sign( after[ i ] - after[ j ] );
			if ( beforeSign === 0 || afterSign === 0 || beforeSign !== afterSign ) return false;

		}

	}
	return true;

}

function psfMonotonicOutsideCore( ringEnergies, tolerance ) {

	if ( ! Array.isArray( ringEnergies ) || ringEnergies.length < 3 || ringEnergies.some( ( value ) => ! Number.isFinite( value ) || value < 0 ) ) return null;
	const normalization = Math.max( ringEnergies[ 0 ], 1e-12 );
	for ( let i = 2; i < ringEnergies.length; i ++ ) {

		if ( ringEnergies[ i ] / normalization > ringEnergies[ i - 1 ] / normalization + tolerance ) return false;

	}
	return true;

}

/**
 * Evaluate measured bloom fixture probes without manufacturing an aggregate
 * pass. Every missing probe remains claim-specific INSUFFICIENT_EVIDENCE.
 */
export function computeBloomAcceptanceMetrics( measurements = {} ) {

	const thresholds = BLOOM_ACCEPTANCE_THRESHOLDS;
	const nonEmissiveRatio = finitePositiveDenominatorRatio( measurements.brightMetalBloomEnergy, measurements.projectileEmitterBloomEnergy );
	const hierarchyPreserved = sameStrictOrdering( measurements.hierarchyPreBloom, measurements.hierarchyPostBloom );
	const psfMonotonic = psfMonotonicOutsideCore( measurements.psfRingEnergies, thresholds.psfNormalizedIncreaseTolerance );
	const occlusionRatio = finitePositiveDenominatorRatio( measurements.occludedTransparentEnergy, measurements.visibleTransparentControlEnergy );

	return {
		schemaVersion: 2,
		claims: {
			nonEmissiveIsolation: metricClaim( nonEmissiveRatio !== null, nonEmissiveRatio <= thresholds.brightNonEmissiveRatioMaximum, {
				value: nonEmissiveRatio,
				gate: { comparison: '<=', value: thresholds.brightNonEmissiveRatioMaximum, provenance: 'Authored' }
			} ),
			emitterHierarchy: metricClaim( hierarchyPreserved !== null, hierarchyPreserved === true, {
				value: hierarchyPreserved,
				gate: { comparison: 'strict-pair-order-preserved', value: true, provenance: 'Authored' }
			} ),
			pointSpreadFalloff: metricClaim( psfMonotonic !== null, psfMonotonic === true, {
				value: psfMonotonic,
				gate: { comparison: 'outer-rings-nonincreasing-with-normalized-tolerance', value: thresholds.psfNormalizedIncreaseTolerance, provenance: 'Authored' }
			} ),
			transparentOcclusion: metricClaim( occlusionRatio !== null, occlusionRatio <= thresholds.transparentOcclusionRatioMaximum, {
				value: occlusionRatio,
				gate: { comparison: '<=', value: thresholds.transparentOcclusionRatioMaximum, provenance: 'Authored' }
			} ),
			noPostReadability: metricClaim( Number.isFinite( measurements.noPostSilhouetteContrast ), measurements.noPostSilhouetteContrast >= thresholds.noPostSilhouetteContrastMinimum, {
				value: measurements.noPostSilhouetteContrast ?? null,
				gate: { comparison: '>=', value: thresholds.noPostSilhouetteContrastMinimum, provenance: 'Authored' }
			} )
		}
	};

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
	material.userData.transparentEmitterMask = 0;

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

	const premultipliedEmission = color( emissiveColor )
		.mul( float( emissiveIntensity ) )
		.mul( float( alpha ) );

	material.premultipliedAlpha = true;
	material.colorNode = color( 0x000000 );
	material.opacityNode = float( alpha );
	material.emissiveNode = premultipliedEmission;
	material.userData.transparentEmitterPolicy = {
		id: 'transparent-emitter',
		transparent: true,
		depthWrite: false,
		depthTest: true,
		alpha,
		premultipliedAlpha: true,
		bloomContribution: 'regular premultiplied emissiveNode with scene MRT MaterialBlending'
	};
	material.userData.transparentEmitterMask = 1;

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

	const luminousBarMaterial = nodeStandardMaterial( {
		name: 'luminous instrument bar emissive tier',
		baseColor: 0x071c24,
		emissiveColor: 0x46d9ff,
		emissiveIntensity: EMISSIVE_TIERS.luminousInstrumentBar,
		roughness: 0.2
	} );
	const luminousBar = new THREE.Mesh( new THREE.CylinderGeometry( 0.035, 0.035, 4.7, 16 ), luminousBarMaterial );
	luminousBar.name = 'luminous-instrument-bar-authored-emissive';
	luminousBar.rotation.z = Math.PI * 0.5;
	luminousBar.position.set( 0.2, 1.45, 0.25 );
	root.add( luminousBar );

	const calibrationSourceMaterial = nodeStandardMaterial( {
		name: 'calibration source emissive tier',
		baseColor: 0x2c0815,
		emissiveColor: 0xff386c,
		emissiveIntensity: EMISSIVE_TIERS.calibrationSource,
		roughness: 0.35
	} );
	const calibrationSource = new THREE.Mesh( new THREE.SphereGeometry( 0.32, 48, 24 ), calibrationSourceMaterial );
	calibrationSource.name = 'calibration-source-authored-emissive';
	calibrationSource.position.set( 1.95, 0.78, 0.55 );
	root.add( calibrationSource );

	const transparentEmitterMaterial = nodeSpriteMaterial( {
		name: 'transparent-emitter sprite material-level bloom contribution',
		emissiveColor: 0x80f7ff,
		emissiveIntensity: EMISSIVE_TIERS.calibrationSource,
		alpha: 0.58
	} );
	const transparentEmitters = [ 0, 1 ].map( ( index ) => {

		const transparentEmitter = new THREE.Sprite( transparentEmitterMaterial );
		transparentEmitter.name = `transparent-emitter-overlap-${ index }`;
		transparentEmitter.position.set( 2.28 + index * 0.14, 1.18 + index * 0.08, 0.15 - index * 0.02 );
		transparentEmitter.scale.set( 0.75, 0.75, 1 );
		root.add( transparentEmitter );
		return transparentEmitter;

	} );

	const markerMaterial = nodeStandardMaterial( {
		name: 'pulsed reference marker emissive tier',
		baseColor: 0x3b1604,
		emissiveColor: 0xfff1b8,
		emissiveIntensity: EMISSIVE_TIERS.pulsedReferenceMarker,
		roughness: 0.25
	} );
	const markerGeometry = new THREE.IcosahedronGeometry( 0.055, 1 );
	const markerCount = 18;

	for ( let i = 0; i < markerCount; i ++ ) {

		const marker = new THREE.Mesh( markerGeometry, markerMaterial );
		const angle = random() * Math.PI * 2;
		const radius = 0.25 + random() * 0.75;
		const height = - 0.35 + random() * 0.7;
		marker.name = `pulsed-reference-marker-${ i }`;
		marker.position.set(
			calibrationSource.position.x + Math.cos( angle ) * radius,
			calibrationSource.position.y + height,
			calibrationSource.position.z + Math.sin( angle ) * radius
		);
		marker.userData.phase = random() * Math.PI * 2;
		marker.userData.poolIndex = i;
		marker.visible = i < quality.maxPulseCount;
		root.add( marker );

	}

	const scenarioGroups = new Map( [
		[ 'emissive-hierarchy', root ],
		[ 'shared-emissive-integration', root ]
	] );

	const thresholdGroup = new THREE.Group();
	thresholdGroup.name = 'bloom-scenario:threshold-and-knee';
	const thresholdValues = [ 0.25, 0.5, 1, 2, 4, 8, 16, 24, 32 ];
	for ( let i = 0; i < thresholdValues.length; i ++ ) {

		const intensity = thresholdValues[ i ];
		const sample = new THREE.Mesh( new THREE.SphereGeometry( 0.18, 24, 12 ), nodeStandardMaterial( {
			name: `threshold-calibration-${ intensity }`,
			baseColor: 0x13080a,
			emissiveColor: 0xff5577,
			emissiveIntensity: intensity,
			roughness: 0.4
		} ) );
		sample.position.set( - 3.2 + i * 0.8, 0.8, 0 );
		thresholdGroup.add( sample );

	}
	scene.add( thresholdGroup );
	scenarioGroups.set( 'threshold-and-knee', thresholdGroup );

	const psfGroup = new THREE.Group();
	psfGroup.name = 'bloom-scenario:point-spread-function';
	const psfImpulse = new THREE.Mesh( new THREE.PlaneGeometry( 0.035, 0.035 ), nodeStandardMaterial( {
		name: 'psf-unit-impulse',
		baseColor: 0x000000,
		emissiveColor: 0xffffff,
		emissiveIntensity: EMISSIVE_TIERS.pulsedReferenceMarker,
		roughness: 1
	} ) );
	psfImpulse.position.set( 0, 1, 0 );
	psfGroup.add( psfImpulse );
	scene.add( psfGroup );
	scenarioGroups.set( 'point-spread-function', psfGroup );

	const transparentGroup = new THREE.Group();
	transparentGroup.name = 'bloom-scenario:transparent-emitters';
	const transparentFixtureMaterial = nodeSpriteMaterial( {
		name: 'transparent-overlap-fixture',
		emissiveColor: 0x80f7ff,
		emissiveIntensity: EMISSIVE_TIERS.calibrationSource,
		alpha: 0.55
	} );
	for ( let i = 0; i < 2; i ++ ) {

		const sprite = new THREE.Sprite( transparentFixtureMaterial );
		sprite.position.set( - 0.25 + i * 0.35, 1 + i * 0.12, - i * 0.03 );
		sprite.scale.setScalar( 1.3 );
		sprite.name = `transparent-overlap-order-${ i }`;
		transparentGroup.add( sprite );

	}
	scene.add( transparentGroup );
	scenarioGroups.set( 'transparent-emitters', transparentGroup );

	const depthGroup = new THREE.Group();
	depthGroup.name = 'bloom-scenario:depth-and-occlusion';
	const occluder = new THREE.Mesh( new THREE.BoxGeometry( 1.1, 2.2, 0.35 ), nodeStandardMaterial( {
		name: 'opaque-occluder',
		baseColor: 0x59636d,
		roughness: 0.8
	} ) );
	occluder.position.set( 0, 1, 0 );
	depthGroup.add( occluder );
	const behindEmitter = new THREE.Sprite( transparentFixtureMaterial );
	behindEmitter.position.set( 0, 1, - 0.6 );
	behindEmitter.scale.setScalar( 1.15 );
	behindEmitter.name = 'transparent-emitter-behind-opaque-occluder';
	depthGroup.add( behindEmitter );
	const visibleEmitter = new THREE.Sprite( transparentFixtureMaterial );
	visibleEmitter.position.set( 1.4, 1, 0.2 );
	visibleEmitter.scale.setScalar( 0.8 );
	visibleEmitter.name = 'transparent-emitter-visible-control';
	depthGroup.add( visibleEmitter );
	scene.add( depthGroup );
	scenarioGroups.set( 'depth-and-occlusion', depthGroup );

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
		scenarioGroups,
		animated: {
			calibrationSource,
			luminousBar,
			transparentEmitters,
			markers: root.children.filter( ( child ) => child.name.startsWith( 'pulsed-reference-marker-' ) )
		}
	};

}

export function selectBloomPipelineMode( {
	isWebGPUBackend = false,
	requestedTier = 'auto'
} = {} ) {

	if ( isWebGPUBackend !== true ) {
		throw new Error( 'WebGPU backend required for the canonical node selective bloom path.' );
	}

	const tierName = requestedTier === 'auto' ? 'full' : requestedTier;
	const tier = QUALITY_TIERS[ tierName ];
	if ( tier === undefined ) throw new Error( `Unknown bloom tier: ${ requestedTier }` );
	const dynamicMrt = isWebGPUBackend === true && tier.dynamicContribution === true && tier.name !== 'reduced-readable-base';

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

const BLOOM_MODE_FOR_MECHANISM = Object.freeze( {
	'threshold-and-knee': DEBUG_MODES.COMBINED,
	'point-spread-function': DEBUG_MODES.BLOOM_ONLY,
	'emissive-hierarchy': DEBUG_MODES.COMBINED,
	'transparent-emitters': DEBUG_MODES.EMISSIVE_ONLY,
	'depth-and-occlusion': DEBUG_MODES.COMBINED,
	'shared-emissive-integration': DEBUG_MODES.EMISSIVE_ONLY
} );

function resolveBloomDebugMode( requestedMode, validationDiagnostics ) {

	if ( BLOOM_MECHANISMS.includes( requestedMode ) ) {

		if ( requestedMode === 'transparent-emitters' && validationDiagnostics === true ) return DEBUG_MODES.TRANSPARENT_EMITTER;
		return BLOOM_MODE_FOR_MECHANISM[ requestedMode ];

	}
	if ( ! Object.values( DEBUG_MODES ).includes( requestedMode ) ) throw new Error( `Unknown bloom mode: ${ requestedMode }` );
	return requestedMode;

}

function assertBloomModeAvailable( mode, quality, validationDiagnostics ) {

	if ( quality.liveBloom !== true && [ DEBUG_MODES.EMISSIVE_ONLY, DEBUG_MODES.BLOOM_ONLY, DEBUG_MODES.TRANSPARENT_EMITTER ].includes( mode ) ) {

		throw new Error( `Bloom mode ${ mode } is unavailable in tier ${ quality.name } because bloom is bypassed.` );

	}
	if ( mode === DEBUG_MODES.TRANSPARENT_EMITTER && validationDiagnostics !== true ) {

		throw new Error( 'transparent-emitter diagnostic requires validationDiagnostics=true.' );

	}

}

export function selectBloomStageKind( { quality = QUALITY_TIERS.full, mode = DEBUG_MODES.COMBINED } = {} ) {

	if ( quality === undefined || typeof quality !== 'object' ) throw new Error( 'Bloom stage selection requires a quality tier.' );
	if ( ! Object.values( DEBUG_MODES ).includes( mode ) ) throw new Error( `Unknown bloom mode: ${ mode }` );
	if ( quality.dynamicContribution === false || quality.liveBloom === false ) return BLOOM_STAGE_KINDS.BASE;
	if ( [ DEBUG_MODES.NO_POST_BASELINE, DEBUG_MODES.FALSE_COLOR_LUMINANCE, DEBUG_MODES.RESOLUTION_SCALE_OVERLAY ].includes( mode ) ) return BLOOM_STAGE_KINDS.BASE;
	if ( [ DEBUG_MODES.EMISSIVE_ONLY, DEBUG_MODES.TRANSPARENT_EMITTER ].includes( mode ) ) return BLOOM_STAGE_KINDS.SELECTIVE;
	return BLOOM_STAGE_KINDS.BLOOM;

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
			if ( transparentEmitterContribution === null ) throw new Error( 'transparent-emitter diagnostic requires validationDiagnostics=true.' );
			return renderOutput( transparentEmitterContribution );

		case DEBUG_MODES.COMBINED:
		default:
			return renderOutput( vec4( sceneColor.rgb.add( bloomOutput.rgb ), sceneColor.a ) );

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

	animated.calibrationSource.position.x = 1.75 + Math.cos( orbit ) * 0.32;
	animated.calibrationSource.position.z = 0.45 + Math.sin( orbit ) * 0.2;
	animated.luminousBar.rotation.y = Math.sin( timeSeconds * 0.7 ) * 0.12;

	for ( let i = 0; i < animated.transparentEmitters.length; i ++ ) {

		const transparentEmitter = animated.transparentEmitters[ i ];
		transparentEmitter.scale.setScalar( 0.65 + Math.sin( timeSeconds * 2.3 + i * 0.4 ) * 0.08 );

	}

	for ( let i = 0; i < animated.markers.length; i ++ ) {

		const marker = animated.markers[ i ];
		const phase = marker.userData.phase;
		const pulse = 0.75 + Math.sin( timeSeconds * 5.0 + phase ) * 0.25;
		marker.scale.setScalar( pulse );

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

export function calculateBloomPyramidInventory( width, height, scale ) {

	if ( ! Number.isInteger( width ) || ! Number.isInteger( height ) || width < 1 || height < 1 ) throw new Error( 'Bloom inventory dimensions must be positive integers.' );
	if ( ! Number.isFinite( scale ) || scale <= 0 || scale > 1 ) throw new Error( 'Bloom inventory scale must be in (0, 1].' );
	let mipWidth = Math.floor( width * scale );
	let mipHeight = Math.floor( height * scale );
	const bright = { id: 'bright-pass', width: mipWidth, height: mipHeight, format: 'rgba16float', bytes: 8 * mipWidth * mipHeight };
	const mips = [];
	for ( let level = 0; level < 5; level ++ ) {

		mips.push( {
			level,
			width: mipWidth,
			height: mipHeight,
			horizontalBytes: 8 * mipWidth * mipHeight,
			verticalBytes: 8 * mipWidth * mipHeight
		} );
		mipWidth = Math.floor( mipWidth / 2 );
		mipHeight = Math.floor( mipHeight / 2 );

	}
	const internalBytes = bright.bytes + mips.reduce( ( sum, mip ) => sum + mip.horizontalBytes + mip.verticalBytes, 0 );
	return {
		bright,
		mips,
		internalBytes,
		fullscreenDrawCount: 12,
		minimumBaseDimension: Math.floor( scale * Math.min( width, height ) ),
		deepestLevelValid: Math.floor( scale * Math.min( width, height ) ) >= 16
	};

}

export function calculateBloomStageResourceInventory( width, height, scale, {
	stageKind = BLOOM_STAGE_KINDS.BLOOM,
	validationDiagnostics = false
} = {} ) {

	if ( ! Object.values( BLOOM_STAGE_KINDS ).includes( stageKind ) ) throw new Error( `Unknown bloom stage kind: ${ stageKind }` );
	if ( ! Number.isInteger( width ) || ! Number.isInteger( height ) || width < 1 || height < 1 ) throw new Error( 'Bloom stage resource dimensions must be positive integers.' );
	const fullPixels = width * height;
	const hasSelectiveMRT = stageKind !== BLOOM_STAGE_KINDS.BASE;
	const pyramid = stageKind === BLOOM_STAGE_KINDS.BLOOM ? calculateBloomPyramidInventory( width, height, scale ) : null;
	const bloomInternal = pyramid === null ? [] : [
		{ id: 'bright-pass', width: pyramid.bright.width, height: pyramid.bright.height },
		...pyramid.mips.flatMap( ( mip ) => [
			{ id: `horizontal-${ mip.level }`, width: mip.width, height: mip.height },
			{ id: `vertical-${ mip.level }`, width: mip.width, height: mip.height }
		] )
	].map( ( resource ) => ( {
		...resource,
		format: 'rgba16float',
		logicalBytes: 8 * resource.width * resource.height,
		provenance: 'Derived',
		physicalResidency: 'INSUFFICIENT_EVIDENCE'
	} ) );
	const productionAttachments = [
		{ id: 'output', format: 'rgba16float', logicalBytes: 8 * fullPixels, provenance: 'Derived' },
		...( hasSelectiveMRT ? [ { id: 'emissive', format: 'rgba16float', logicalBytes: 8 * fullPixels, provenance: 'Derived' } ] : [] ),
		{ id: 'scene-depth', format: 'depth24plus', logicalBytes: null, provenance: 'Measured', byteVerdict: 'INSUFFICIENT_EVIDENCE' }
	];
	const validationOnlyAttachments = hasSelectiveMRT && validationDiagnostics === true
		? [ { id: 'transparentEmitter', format: 'rgba16float', logicalBytes: 8 * fullPixels, provenance: 'Derived' } ]
		: [];
	const knownLogicalBytesLowerBound = [ ...productionAttachments, ...validationOnlyAttachments, ...bloomInternal ]
		.reduce( ( sum, resource ) => sum + ( Number.isFinite( resource.logicalBytes ) ? resource.logicalBytes : 0 ), 0 );

	return {
		physicalSize: [ width, height ],
		stageKind,
		productionAttachments,
		validationOnlyAttachments,
		bloomInternal,
		derivedPyramid: pyramid,
		knownLogicalBytesLowerBound,
		logicalAllocatedBytes: { value: null, provenance: 'Measured', verdict: 'INSUFFICIENT_EVIDENCE', reason: 'depth24plus physical bytes and backend padding require adapter evidence' },
		physicalResidentBytes: { value: null, provenance: 'Measured', verdict: 'INSUFFICIENT_EVIDENCE' }
	};

}

export function inferBloomPaddedLayout( byteLength, width, height ) {

	for ( const bytesPerTexel of [ 1, 2, 4, 8, 16 ] ) {

		const rowBytes = width * bytesPerTexel;
		const bytesPerRow = Math.ceil( rowBytes / 256 ) * 256;
		const expected = height === 1 ? rowBytes : ( height - 1 ) * bytesPerRow + rowBytes;
		if ( expected === byteLength ) return { bytesPerTexel, rowBytes, bytesPerRow };

	}
	throw new Error( `Cannot infer an integer WebGPU row stride for bloom target ${ width }x${ height } and ${ byteLength } bytes.` );

}

async function captureBloomTarget( renderer, renderTarget, textureIndex = 0 ) {

	const width = renderTarget.width;
	const height = renderTarget.height;
	const pixels = await renderer.readRenderTargetPixelsAsync( renderTarget, 0, 0, width, height, textureIndex );
	const source = new Uint8Array( pixels.buffer, pixels.byteOffset, pixels.byteLength );
	const layout = inferBloomPaddedLayout( source.byteLength, width, height );
	const packed = new Uint8Array( layout.rowBytes * height );
	for ( let y = 0; y < height; y ++ ) {

		packed.set( source.subarray( y * layout.bytesPerRow, y * layout.bytesPerRow + layout.rowBytes ), y * layout.rowBytes );

	}
	return {
		width,
		height,
		bytesPerTexel: layout.bytesPerTexel,
		bytesPerRow: layout.bytesPerRow,
		packedRowBytes: layout.rowBytes,
		componentType: pixels.constructor.name,
		data: packed
	};

}

function bloomTextureIndex( renderTarget, name ) {

	const index = renderTarget.textures.findIndex( ( texture ) => texture.name === name );
	if ( index < 0 ) throw new Error( `Bloom render target does not contain texture ${ name }.` );
	return index;

}

function reseedMarkers( animated, seed ) {

	const random = createSeededRandom( seed );
	for ( const marker of animated.markers ) {

		const angle = random() * Math.PI * 2;
		const radius = 0.25 + random() * 0.75;
		const height = - 0.35 + random() * 0.7;
		marker.position.set(
			animated.calibrationSource.position.x + Math.cos( angle ) * radius,
			animated.calibrationSource.position.y + height,
			animated.calibrationSource.position.z + Math.sin( angle ) * radius
		);
		marker.userData.phase = random() * Math.PI * 2;

	}

}

/**
 * Renderer-independent selective-bloom graph factory. The host owns renderer,
 * RenderPipeline, final ordering, tone mapping, and output conversion.
 */
export function createSelectiveBloomStage( {
	scene,
	camera,
	controls = BLOOM_CONTROLS,
	tier = QUALITY_TIERS.full,
	validationDiagnostics = false,
	stageKind = BLOOM_STAGE_KINDS.BLOOM
} ) {

	if ( scene?.isScene !== true ) throw new Error( 'createSelectiveBloomStage requires a Scene.' );
	if ( camera?.isCamera !== true ) throw new Error( 'createSelectiveBloomStage requires a Camera.' );
	if ( ! Object.values( BLOOM_STAGE_KINDS ).includes( stageKind ) ) throw new Error( `Unknown bloom stage kind: ${ stageKind }` );
	validateBloomConfig( { controls, quality: tier } );

	let selectiveScenePass = null;
	let selectiveSceneColor = null;
	let emissiveContribution = null;
	let transparentEmitterContribution = null;
	let baseScenePass = null;
	let baseSceneColor = null;
	let bloomPass = null;
	let bloomOutput = null;

	if ( stageKind === BLOOM_STAGE_KINDS.BASE ) {

		baseScenePass = pass( scene, camera, { samples: 0 } );
		baseSceneColor = baseScenePass.getTextureNode( 'output' );

	} else {

		selectiveScenePass = pass( scene, camera, { samples: 0 } );
		const mrtOutputs = { output, emissive };
		if ( validationDiagnostics === true ) {

			mrtOutputs.transparentEmitter = emissive.mul( materialReference( 'userData.transparentEmitterMask', 'float' ) );

		}
		const sceneMRT = mrt( mrtOutputs );
		const materialBlend = new THREE.BlendMode( THREE.MaterialBlending );
		sceneMRT.setBlendMode( 'emissive', materialBlend );
		if ( validationDiagnostics === true ) sceneMRT.setBlendMode( 'transparentEmitter', materialBlend );
		selectiveScenePass.setMRT( sceneMRT );
		selectiveSceneColor = selectiveScenePass.getTextureNode( 'output' );
		emissiveContribution = selectiveScenePass.getTextureNode( 'emissive' );
		transparentEmitterContribution = validationDiagnostics === true
			? selectiveScenePass.getTextureNode( 'transparentEmitter' )
			: null;

		if ( stageKind === BLOOM_STAGE_KINDS.BLOOM ) {

			bloomPass = bloom( emissiveContribution, controls.strength, controls.radius, controls.threshold );
			bloomPass.smoothWidth.value = controls.smoothWidth;
			bloomPass.setResolutionScale( tier.bloomScale );
			bloomOutput = bloomPass.getTextureNode();

		}

	}

	const scenePass = selectiveScenePass ?? baseScenePass;
	const sceneColor = selectiveSceneColor ?? baseSceneColor;

	return {
		stageKind,
		scenePass,
		sceneColor,
		selectiveScenePass,
		baseScenePass,
		selectiveSceneColor,
		emissiveContribution,
		transparentEmitterContribution,
		baseSceneColor,
		bloomPass,
		bloomOutput,
		validationDiagnostics,
		setTier( nextTier ) {

			bloomPass?.setResolutionScale( nextTier.bloomScale );

		},
		applyControls( nextControls ) {

			if ( bloomPass !== null ) applyBloomControls( bloomPass, nextControls );

		},
		dispose() {

			bloomPass?.dispose();
			selectiveScenePass?.dispose();
			baseScenePass?.dispose();

		}
	};

}

export async function createNodeSelectiveBloomExample( {
	canvas,
	seed = 0x00000001,
	quality: requestedQuality = 'full',
	width = 1200,
	height = 800,
	pixelRatio = 1,
	controls: controlOverrides = {},
	debugMode: initialDebugMode = DEBUG_MODES.COMBINED,
	scenario: initialScenario = 'shared-emissive-integration',
	validationDiagnostics = false
} = {} ) {

	if ( ! Number.isInteger( seed ) || seed < 0 || seed > 0xffffffff ) throw new Error( 'Bloom seed must be an unsigned 32-bit integer.' );
	const renderer = new THREE.WebGPURenderer( {
		canvas,
		antialias: false,
		outputBufferType: THREE.HalfFloatType
	} );
	renderer.toneMapping = THREE.AgXToneMapping;
	renderer.toneMappingExposure = 1;
	await renderer.init();
	if ( renderer.backend.isWebGPUBackend !== true ) throw new Error( 'threejs-bloom requires native WebGPU.' );

	let quality = selectQualityTier( renderer, requestedQuality );
	const controls = { ...BLOOM_CONTROLS, ...controlOverrides };
	validateBloomConfig( { controls, quality } );
	if ( ! BLOOM_SCENARIOS.includes( initialScenario ) ) throw new Error( `Unknown bloom scenario: ${ initialScenario }` );
	let debugMode = resolveBloomDebugMode( initialDebugMode, validationDiagnostics );
	assertBloomModeAvailable( debugMode, quality, validationDiagnostics );
	const sceneBundle = createAuthoredScene( seed, quality );
	const { scene, camera, animated, scenarioGroups } = sceneBundle;
	const renderPipeline = new THREE.RenderPipeline( renderer );
	renderPipeline.outputColorTransform = false;
	const presentationTarget = new THREE.RenderTarget( 1, 1, {
		type: THREE.UnsignedByteType,
		depthBuffer: false
	} );
	presentationTarget.texture.colorSpace = renderer.outputColorSpace;
	presentationTarget.texture.name = 'node-selective-bloom-presentation-rgba8';

	let stage = createSelectiveBloomStage( {
		scene,
		camera,
		controls,
		tier: quality,
		validationDiagnostics,
		stageKind: selectBloomStageKind( { quality, mode: debugMode } )
	} );

	let scenarioId = initialScenario;
	let mechanismId = BLOOM_MECHANISMS.includes( initialDebugMode ) ? initialDebugMode : null;
	let currentSeed = seed >>> 0;
	let timeSeconds = 0;
	let lastResetCause = 'initialization';
	let running = false;

	function physicalDimensions( nextQuality = quality ) {

		return calculateBloomDrawingBufferSize( width, height, pixelRatio, nextQuality.pixelRatioCap );

	}

	function validateBloomExtent( nextQuality, stageKind ) {

		if ( stageKind !== BLOOM_STAGE_KINDS.BLOOM ) return;
		const physical = physicalDimensions( nextQuality );
		if ( calculateBloomPyramidInventory( physical.width, physical.height, nextQuality.bloomScale ).deepestLevelValid !== true ) {

			throw new Error( `Bloom tier ${ nextQuality.name } violates the fixed five-level minimum-dimension gate.` );

		}

	}

	function replaceStageForCurrentState() {

		const nextKind = selectBloomStageKind( { quality, mode: debugMode } );
		validateBloomExtent( quality, nextKind );
		if ( stage.stageKind === nextKind ) {

			stage.setTier( quality );
			return false;

		}
		stage.dispose();
		stage = createSelectiveBloomStage( {
			scene,
			camera,
			controls,
			tier: quality,
			validationDiagnostics,
			stageKind: nextKind
		} );
		return true;

	}

	function activeNodes() {

		const sceneColor = stage.sceneColor;
		const zero = sceneColor.mul( float( 0 ) );
		const activeBloom = stage.bloomOutput ?? zero;
		const activeEmissive = stage.emissiveContribution ?? zero;
		const preToneMapLuminance = luminance( sceneColor.rgb );
		const falseColorLuminance = vec4(
			preToneMapLuminance,
			preToneMapLuminance.mul( float( 0.35 ) ),
			preToneMapLuminance.mul( float( 0.08 ) ),
			1
		);
		const resolutionScaleOverlay = sceneColor.mul( float( 0.65 ) ).add( vec4( vec3( float( quality.bloomScale ) ), 1 ).mul( float( 0.35 ) ) );
		return {
			sceneColor,
			emissiveContribution: activeEmissive,
			bloomOutput: activeBloom,
			falseColorLuminance,
			resolutionScaleOverlay,
			transparentEmitterContribution: stage.transparentEmitterContribution
		};

	}

	function rebuildOutput() {

		assertBloomModeAvailable( debugMode, quality, validationDiagnostics );
		renderPipeline.outputNode = buildOutputNode( debugMode, activeNodes() );
		renderPipeline.needsUpdate = true;

	}

	async function setScenario( id ) {

		if ( ! BLOOM_SCENARIOS.includes( id ) ) throw new Error( `Unknown bloom scenario: ${ id }` );
		scenarioId = id;
		for ( const group of new Set( scenarioGroups.values() ) ) group.visible = false;
		scenarioGroups.get( id ).visible = true;
		if ( id === 'point-spread-function' ) {

			camera.position.set( 0, 1, 7 );
			camera.lookAt( 0, 1, 0 );

		} else {

			camera.position.set( 5.8, 3.2, 7.4 );
			camera.lookAt( 0, 0.8, 0 );

		}
		camera.updateMatrixWorld();

	}

	async function setMode( mode ) {

		const nextMode = resolveBloomDebugMode( mode, validationDiagnostics );
		assertBloomModeAvailable( nextMode, quality, validationDiagnostics );
		if ( BLOOM_MECHANISMS.includes( mode ) ) {

			await setScenario( mode );
			mechanismId = mode;

		} else mechanismId = null;
		debugMode = nextMode;
		replaceStageForCurrentState();
		rebuildOutput();

	}

	async function setTier( id ) {

		const nextQuality = selectQualityTier( renderer, id );
		assertBloomModeAvailable( debugMode, nextQuality, validationDiagnostics );
		validateBloomExtent( nextQuality, selectBloomStageKind( { quality: nextQuality, mode: debugMode } ) );
		quality = nextQuality;
		replaceStageForCurrentState();
		for ( const marker of animated.markers ) marker.visible = marker.userData.poolIndex < quality.maxPulseCount;
		const physical = physicalDimensions();
		renderer.setPixelRatio( physical.effectiveDpr );
		renderer.setSize( width, height, false );
		rebuildOutput();

	}

	async function setSeed( nextSeed ) {

		if ( ! Number.isInteger( nextSeed ) || nextSeed < 0 || nextSeed > 0xffffffff ) throw new Error( 'Bloom seed must be an unsigned 32-bit integer.' );
		currentSeed = nextSeed >>> 0;
		reseedMarkers( animated, currentSeed );

	}

	async function setCamera( id ) {

		if ( id === 'near' ) camera.position.set( 3.7, 2.2, 5 );
		else if ( id === 'design' ) camera.position.set( 5.8, 3.2, 7.4 );
		else if ( id === 'far' ) camera.position.set( 8.7, 5, 11 );
		else throw new Error( `Unknown bloom camera: ${ id }` );
		camera.lookAt( 0, 0.8, 0 );
		camera.updateMatrixWorld();

	}

	async function setTime( seconds ) {

		if ( ! Number.isFinite( seconds ) ) throw new Error( 'Bloom time must be finite.' );
		timeSeconds = seconds;
		updateAuthoredAnimation( animated, timeSeconds, quality.dynamicContribution );

	}

	async function step( deltaSeconds ) {

		if ( ! Number.isFinite( deltaSeconds ) || deltaSeconds < 0 ) throw new Error( 'Bloom deltaSeconds must be finite and nonnegative.' );
		await setTime( timeSeconds + deltaSeconds );

	}

	async function resetHistory( cause ) {

		lastResetCause = String( cause );

	}

	async function resize( nextWidth = width, nextHeight = height, nextPixelRatio = pixelRatio ) {

		if ( ! Number.isInteger( nextWidth ) || ! Number.isInteger( nextHeight ) || nextWidth < 1 || nextHeight < 1 ) throw new Error( 'Bloom resize dimensions must be positive integers.' );
		if ( ! Number.isFinite( nextPixelRatio ) || nextPixelRatio <= 0 ) throw new Error( 'Bloom DPR must be positive.' );
		width = nextWidth;
		height = nextHeight;
		pixelRatio = nextPixelRatio;
		const physical = physicalDimensions();
		validateBloomExtent( quality, stage.stageKind );
		renderer.setPixelRatio( physical.effectiveDpr );
		renderer.setSize( width, height, false );
		presentationTarget.setSize( renderer.domElement.width, renderer.domElement.height );
		camera.aspect = width / height;
		camera.updateProjectionMatrix();

	}

	function setBloomControls( nextControls = {} ) {

		const candidate = { ...controls, ...nextControls };
		validateBloomConfig( { controls: candidate, quality } );
		if ( typeof nextControls.resolutionScale === 'number' ) {

			if ( nextControls.resolutionScale <= 0 || nextControls.resolutionScale > 1 ) throw new Error( 'Bloom resolutionScale must be in (0, 1].' );
			quality = { ...quality, bloomScale: nextControls.resolutionScale };
			validateBloomExtent( quality, stage.stageKind );

		}
		Object.assign( controls, nextControls );
		stage.applyControls( controls );
		stage.setTier( quality );

	}

	async function compileAsync() {

		await stage.scenePass.compileAsync( renderer );
		renderPipeline.render();

	}

	async function renderOnce() {

		renderPipeline.render();

	}

	function frame( nextTimeSeconds = 0 ) {

		updateAuthoredAnimation( animated, nextTimeSeconds, quality.dynamicContribution );
		timeSeconds = nextTimeSeconds;
		renderPipeline.render();

	}

	function start() {

		running = true;
		renderer.setAnimationLoop( ( timeMilliseconds ) => frame( timeMilliseconds * 0.001 ) );

	}

	function stop() {

		running = false;
		renderer.setAnimationLoop( null );

	}

	async function capturePixels( target = 'scene-output' ) {

		if ( target === 'presentation' ) {

			const previousTarget = renderer.getRenderTarget();
			try {

				renderer.setRenderTarget( presentationTarget );
				renderPipeline.render();

			} finally {

				renderer.setRenderTarget( previousTarget );

			}
			return {
				...await captureBloomTarget( renderer, presentationTarget, 0 ),
				target,
				format: 'rgba8unorm',
				outputColorSpace: renderer.outputColorSpace,
				bytesPerPixel: 4
			};

		}
		await renderOnce();
		if ( target === 'scene-output' ) {

			return captureBloomTarget( renderer, stage.scenePass.renderTarget, bloomTextureIndex( stage.scenePass.renderTarget, 'output' ) );

		}
		if ( target === 'emissive' ) {

			if ( stage.selectiveScenePass === null ) throw new Error( `emissive readback is unavailable for ${ stage.stageKind } stage.` );
			return captureBloomTarget( renderer, stage.selectiveScenePass.renderTarget, bloomTextureIndex( stage.selectiveScenePass.renderTarget, 'emissive' ) );

		}
		if ( target === 'transparent-emitter' ) {

			if ( validationDiagnostics !== true || stage.selectiveScenePass === null ) throw new Error( 'transparent-emitter readback requires an active validation selective stage.' );
			return captureBloomTarget( renderer, stage.selectiveScenePass.renderTarget, bloomTextureIndex( stage.selectiveScenePass.renderTarget, 'transparentEmitter' ) );

		}
		if ( target === 'bloom' ) {

			if ( stage.bloomPass === null ) throw new Error( `bloom readback is unavailable for ${ stage.stageKind } stage.` );
			return captureBloomTarget( renderer, stage.bloomPass._renderTargetsHorizontal[ 0 ], 0 );

		}
		if ( target === 'bright-pass' ) {

			if ( stage.bloomPass === null ) throw new Error( `bright-pass readback is unavailable for ${ stage.stageKind } stage.` );
			return captureBloomTarget( renderer, stage.bloomPass._renderTargetBright, 0 );

		}
		throw new Error( `Unknown bloom capture target: ${ target }` );

	}

	function describePipeline() {

		const hasSelectiveMRT = stage.selectiveScenePass !== null;
		const bloomReachable = stage.stageKind === BLOOM_STAGE_KINDS.BLOOM && [ DEBUG_MODES.COMBINED, DEBUG_MODES.BLOOM_ONLY ].includes( debugMode );
		return {
			schemaVersion: 2,
			owners: {
				renderer: 'node-selective-bloom',
				pipeline: 'node-selective-bloom',
				emissive: hasSelectiveMRT ? 'selective-scene-mrt' : null,
				toneMap: 'renderOutput',
				outputTransform: 'renderOutput'
			},
			stageKind: stage.stageKind,
			sceneSubmissionCount: 1,
			productionMRT: hasSelectiveMRT ? [ 'output', 'emissive' ] : [ 'output' ],
			validationOnlyMRT: hasSelectiveMRT && validationDiagnostics === true ? [ 'transparentEmitter' ] : [],
			passes: {
				baseScene: stage.stageKind === BLOOM_STAGE_KINDS.BASE,
				selectiveScene: hasSelectiveMRT,
				bloomHighPass: bloomReachable,
				bloomBlurPasses: bloomReachable ? 10 : 0,
				bloomComposite: bloomReachable
			},
			bloomReachable,
			bloomPreToneMap: bloomReachable,
			finalToneMapOwner: 'renderOutput',
			finalOutputTransformOwner: 'renderOutput'
		};

	}

	function describeResources() {

		const physical = physicalDimensions();
		return calculateBloomStageResourceInventory( physical.width, physical.height, quality.bloomScale, {
			stageKind: stage.stageKind,
			validationDiagnostics
		} );

	}

	function getMetrics() {

		return {
			labId: LAB_ID,
			backend: renderer.backend.isWebGPUBackend === true ? 'webgpu' : 'unsupported',
			threeRevision: THREE.REVISION,
			tier: quality.name,
			scenario: scenarioId,
			mode: debugMode,
			mechanism: mechanismId,
			seed: currentSeed,
			timeSeconds,
			lastResetCause,
			running,
			stageKind: stage.stageKind,
			acceptanceMetrics: computeBloomAcceptanceMetrics(),
			gpuTiming: { verdict: 'INSUFFICIENT_EVIDENCE', samples: [] },
			rendererInfo: renderer.info
		};

	}

	async function dispose() {

		stop();
		stage.dispose();
		renderPipeline.dispose();
		presentationTarget.dispose();
		disposeObjectTree( scene );
		renderer.dispose();

	}

	await resize( width, height, pixelRatio );
	await setScenario( initialScenario );
	await setMode( initialDebugMode );

	return {
		get labId() { return LAB_ID; },
		ready: async () => {},
		setScenario,
		setMode,
		setTier,
		setSeed,
		setCamera,
		setTime,
		step,
		resetHistory,
		resize,
		renderOnce,
		capturePixels,
		describePipeline,
		describeResources,
		getMetrics,
		dispose,
		setBloomControls,
		setDebugMode: setMode,
		compileAsync,
		frame,
		start,
		stop,
		renderer,
		renderPipeline,
		scene,
		camera,
		controls,
		debugModes: DEBUG_MODES,
		budgets: GEOMETRY_BUDGETS,
		get quality() {

			return quality;

		},
		get stage() {

			return stage;

		},
		get selectiveScenePass() {

			return stage.selectiveScenePass;

		},
		get baseScenePass() {

			return stage.baseScenePass;

		},
		get bloomPass() {

			return stage.bloomPass;

		}
	};

}
