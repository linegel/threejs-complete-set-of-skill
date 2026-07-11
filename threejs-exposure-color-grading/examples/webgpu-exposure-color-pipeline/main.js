import {
	ACESFilmicToneMapping,
	AgXToneMapping,
	AmbientLight,
	BoxGeometry,
	Color,
	ColorManagement,
	DirectionalLight,
	HalfFloatType,
	LinearSRGBColorSpace,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	NeutralToneMapping,
	NoColorSpace,
	NoToneMapping,
	PlaneGeometry,
	PerspectiveCamera,
	RenderPipeline,
	Scene,
	SphereGeometry,
	StorageBufferAttribute,
	Vector2,
	WebGPURenderer
} from 'three/webgpu';
import {
	bypass,
	color,
	exp2,
	float,
	pass,
	screenUV,
	toneMapping,
	unpremultiplyAlpha,
	uint,
	vec3,
	vec4
} from 'three/tsl';

import {
	EXPOSURE_EXAMPLE_CONTRACT,
	EXPOSURE_QUALITY_TIERS,
	DEFAULT_RENDER_DELTA_SECONDS,
	HISTOGRAM_BINS,
	HISTOGRAM_EXTRA_COUNTERS,
	KEY_CALIBRATION,
	MAX_ADAPTATION_DELTA_SECONDS,
	METER_CADENCE_HZ,
	METER_HEIGHT,
	METER_SAMPLE_COUNT,
	METER_WIDTH,
	METER_MODES,
	NUMERIC_PROVENANCE,
	WORKGROUP_SIZE,
	dispatchCount,
	estimateExposureStorageBytes,
	reducePassCount,
	resolveExposureTier,
	stratifiedJitterForMeterUpdate
} from './constants.js';
import { createDebugViewRegistry } from './debug-views.js';
import { createExposureOutputGraph, createExposureReductionNodes } from './exposure-nodes.js';
import { DEFAULT_LUT_SIZE, assertExampleLutSize, createLutTexture } from './lut.js';

export { createExposureColorStage } from './stage.js';

const AUTHORED_SCENE = Object.freeze( {
	background: 0x05070a,
	cameraFovDegrees: 50,
	cameraNear: 0.1,
	cameraFar: 100,
	cameraY: 1.4,
	cameraZ: 5,
	keyLightColor: 0xffdfb8,
	keyLightIntensity: 4,
	keyLightPosition: [ 3, 5, 4 ],
	ambientLightColor: 0x91abd8,
	ambientLightIntensity: 0.75,
	materialColor: 0x8fb9ff,
	materialEmissive: 0x080604,
	roughness: 0.35,
	metalness: 0,
	boxEdge: 1.25,
	boxY: 0,
	groundSize: 12,
	groundY: - 0.625,
	groundColor: 0x172235,
	emitterRadius: 0.24,
	emitterPosition: [ 1.35, 0.1, - 0.25 ],
	emitterColor: 0x22060c,
	emitterEmissive: 0xff2f56,
	emitterIntensity: 10,
	rotationRadiansPerSecond: 0.24
} );

export const EXPOSURE_MECHANISM_ROUTES = Object.freeze( {
	'log-luminance-reduction': Object.freeze( { tier: 'balanced-log-reduction', mode: 'meter-source', scenario: 'emitter', toneMappingVariant: 'Neutral', lutVariant: 'identity' } ),
	'histogram-and-percentiles': Object.freeze( { tier: 'full-histogram', mode: 'histogram', scenario: 'emitter', toneMappingVariant: 'Neutral', lutVariant: 'creative' } ),
	adaptation: Object.freeze( { tier: 'balanced-log-reduction', mode: 'adaptation', scenario: 'bright-window', toneMappingVariant: 'Neutral', lutVariant: 'identity' } ),
	'metering-masks': Object.freeze( { tier: 'full-histogram', mode: 'meter-mask', scenario: 'masked-ui', toneMappingVariant: 'Neutral', lutVariant: 'creative' } ),
	'tone-mapping': Object.freeze( { tier: 'balanced-log-reduction', mode: 'tone-map', scenario: 'swatches', toneMappingVariant: 'AgX', lutVariant: 'identity' } ),
	'lut-grading': Object.freeze( { tier: 'full-histogram', mode: 'lut', scenario: 'swatches', toneMappingVariant: 'Neutral', lutVariant: 'creative' } )
} );

const TONE_MAPPING_VARIANTS = Object.freeze( {
	Neutral: NeutralToneMapping,
	AgX: AgXToneMapping,
	ACES: ACESFilmicToneMapping
} );

export function resolveExposureMechanismRoute( routeId ) {

	const route = EXPOSURE_MECHANISM_ROUTES[ routeId ];
	if ( ! route ) throw new Error( `Unknown exposure mechanism route "${ routeId }".` );
	return route;

}

function resolveToneMapping( value = 'Neutral' ) {

	if ( typeof value === 'number' ) return value;
	const mapping = TONE_MAPPING_VARIANTS[ value ];
	if ( mapping === undefined ) throw new Error( `Unknown tone-mapping variant "${ value }".` );
	return mapping;

}

export async function createExposureColorPipeline( canvas, options = {} ) {

	const renderer = new WebGPURenderer( {
		canvas,
		antialias: false,
		outputBufferType: HalfFloatType,
		trackTimestamp: true
	} );
	renderer.toneMapping = NoToneMapping;
	// [Derived ownership invariant] Explicit EV and toneMapping() nodes own
	// exposure/tone mapping, so the renderer calibration stays neutral.
	renderer.toneMappingExposure = 1;
	await renderer.init();

	if ( renderer.backend.isWebGPUBackend !== true ) {

		throw new Error( 'Native WebGPU is required for this exposure path; route explicit fallback teaching to threejs-compatibility-fallbacks.' );

	}
	if ( ColorManagement.workingColorSpace !== LinearSRGBColorSpace ) {

		throw new Error( 'This example freezes linear-sRGB luminance coefficients; a different working space requires coefficients derived from its registered primaries.' );

	}
	const tierId = options.tier ?? 'full-histogram';
	const tier = resolveExposureTier( tierId );
	const meterMode = options.meterMode ?? tier.meterMode;
	if ( ! Object.values( METER_MODES ).includes( meterMode ) ) throw new Error( `Unknown meter mode "${ meterMode }".` );
	const toneMappingVariant = options.toneMappingVariant ?? 'Neutral';
	const toneMappingValue = resolveToneMapping( options.toneMapping ?? toneMappingVariant );
	const lutVariant = options.lutVariant ?? tier.lut;

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
		roughness: AUTHORED_SCENE.roughness,
		metalness: AUTHORED_SCENE.metalness
	} );
	material.colorNode = color( AUTHORED_SCENE.materialColor );
	material.emissiveNode = color( AUTHORED_SCENE.materialEmissive );
	const mesh = new Mesh(
		new BoxGeometry( AUTHORED_SCENE.boxEdge, AUTHORED_SCENE.boxEdge, AUTHORED_SCENE.boxEdge ),
		material
	);
	mesh.position.y = AUTHORED_SCENE.boxY;

	const groundMaterial = new MeshStandardNodeMaterial( { roughness: 0.9, metalness: 0 } );
	groundMaterial.colorNode = color( AUTHORED_SCENE.groundColor );
	groundMaterial.emissiveNode = color( 0x000000 );
	const ground = new Mesh(
		new PlaneGeometry( AUTHORED_SCENE.groundSize, AUTHORED_SCENE.groundSize ),
		groundMaterial
	);
	ground.rotation.x = - Math.PI / 2;
	ground.position.y = AUTHORED_SCENE.groundY;

	const emitterMaterial = new MeshStandardNodeMaterial( { roughness: 0.24, metalness: 0 } );
	emitterMaterial.colorNode = color( AUTHORED_SCENE.emitterColor );
	emitterMaterial.emissiveNode = color( AUTHORED_SCENE.emitterEmissive ).mul( AUTHORED_SCENE.emitterIntensity );
	const emitter = new Mesh(
		new SphereGeometry( AUTHORED_SCENE.emitterRadius, 32, 16 ),
		emitterMaterial
	);
	emitter.position.fromArray( AUTHORED_SCENE.emitterPosition );
	const grayCardMaterial = new MeshBasicNodeMaterial();
	grayCardMaterial.colorNode = vec3( KEY_CALIBRATION );
	const grayCard = new Mesh( new PlaneGeometry( 12, 8 ), grayCardMaterial );
	grayCard.position.set( 0, 0, - 0.5 );
	grayCard.visible = false;
	const brightWindowMaterial = new MeshStandardNodeMaterial( { roughness: 1, metalness: 0 } );
	brightWindowMaterial.colorNode = color( 0x111111 );
	brightWindowMaterial.emissiveNode = color( 0xffffff ).mul( 16 );
	const brightWindow = new Mesh( new PlaneGeometry( 1.25, 2.4 ), brightWindowMaterial );
	brightWindow.position.set( 1.1, 0.35, - 0.35 );
	brightWindow.visible = false;
	const maskedUiMaterial = new MeshBasicNodeMaterial();
	maskedUiMaterial.colorNode = vec3( 24, 18, 6 );
	const maskedUiPanel = new Mesh( new PlaneGeometry( 0.8, 0.4 ), maskedUiMaterial );
	maskedUiPanel.position.set( 2.6, - 2.0, 0.15 );
	maskedUiPanel.visible = false;

	const fixtureMeshes = [ mesh, ground, emitter, grayCard, brightWindow, maskedUiPanel ];
	scene.add( ...fixtureMeshes );

	const renderPipeline = new RenderPipeline( renderer );
	const scenePass = pass( scene, camera );
	const hdrColor = scenePass.getTextureNode( 'output' );
	const lutSize = assertExampleLutSize(
		options.lutSize ?? DEFAULT_LUT_SIZE,
		renderer.backend.device.limits.maxTextureDimension3D
	);
	const lutTexture = createLutTexture( lutSize, { variant: lutVariant } );
	lutTexture.colorSpace = NoColorSpace;

	const workgroupSize = options.workgroupSize ?? WORKGROUP_SIZE;
	const meterCadenceHz = options.meterCadenceHz ?? tier.meterCadenceHz ?? METER_CADENCE_HZ;

	if ( ! Number.isFinite( meterCadenceHz ) || meterCadenceHz < 0 || ( meterMode !== METER_MODES.FIXED && meterCadenceHz === 0 ) ) {

		throw new Error( 'meterCadenceHz must be nonnegative and positive for an active meter.' );

	}

	const dispatches = dispatchCount( METER_SAMPLE_COUNT, workgroupSize );
	const reducePasses = reducePassCount( dispatches, workgroupSize );
	const useHistogram = meterMode === METER_MODES.HISTOGRAM;
	const storageBytes = estimateExposureStorageBytes( METER_SAMPLE_COUNT, { workgroupSize, includeHistogram: useHistogram } );
	const partialBuffer = options.partialBuffer
		?? new StorageBufferAttribute( storageBytes.partialCount, 4, Float32Array );
	const exposureFloatStateBuffer = options.exposureFloatStateBuffer
		?? new StorageBufferAttribute( 1, 4, Float32Array );
	const exposureUintStateBuffer = options.exposureUintStateBuffer
		?? new StorageBufferAttribute( 1, 4, Uint32Array );
	const histogramBuffer = useHistogram
		? options.histogramBuffer ?? new StorageBufferAttribute( HISTOGRAM_BINS + HISTOGRAM_EXTRA_COUNTERS, 1, Uint32Array )
		: null;
	const histogramPrefixBuffer = useHistogram
		? options.histogramPrefixBuffer ?? new StorageBufferAttribute( HISTOGRAM_BINS, 1, Uint32Array )
		: null;
	const histogramStateBuffer = useHistogram
		? options.histogramStateBuffer ?? new StorageBufferAttribute( 2, 4, Uint32Array )
		: null;

	exposureFloatStateBuffer.array.set( [ KEY_CALIBRATION, 0, 0, 0 ] );
	exposureUintStateBuffer.array.set( [ 1, 0, 0, 0 ] );

	const exposureNodes = createExposureReductionNodes( {
		hdrTextureNode: hdrColor,
		meterMaskNode: options.meterMask ?? null,
		meterWidth: METER_WIDTH,
		meterHeight: METER_HEIGHT,
		sampleCount: METER_SAMPLE_COUNT,
		workgroupSize,
		partialBuffer,
		exposureFloatStateBuffer,
		exposureUintStateBuffer,
		histogramBuffer,
		histogramPrefixBuffer,
		histogramStateBuffer,
		useHistogram,
		meterRegionMin: options.meterRegionMin ?? new Vector2( 0, 0 ),
		meterRegionMax: options.meterRegionMax ?? new Vector2( 1, 1 ),
		uiExclusionMin: options.uiExclusionMin ?? new Vector2( 0.72, 0 ),
		uiExclusionMax: options.uiExclusionMax ?? new Vector2( 1, 0.22 )
	} );

	const outputGraph = createExposureOutputGraph( {
		hdrColor,
		lutTexture,
		lutSize: lutTexture.image.width,
		mapping: toneMappingValue,
		outputColorSpace: renderer.outputColorSpace,
		exposureState: exposureNodes.state
	} );
	const finalNode = outputGraph.finalOutputNode;
	const currentExposureEv = exposureNodes.state.floatState.element( uint( 0 ) ).z;
	const straightHdr = unpremultiplyAlpha( hdrColor );
	const postToneMapLinear = toneMapping(
		toneMappingValue,
		1,
		vec4( straightHdr.rgb.mul( exp2( currentExposureEv ) ), straightHdr.a )
	);
	const compressHdr = vec4( hdrColor.rgb.div( hdrColor.rgb.add( 1 ) ), 1 );
	const adaptationDisplay = currentExposureEv.sub( - 4 ).div( 8 ).clamp( 0, 1 );
	const meterRegionVisible = screenUV.x.greaterThanEqual( exposureNodes.meterRegionMinNode.x )
		.and( screenUV.x.lessThanEqual( exposureNodes.meterRegionMaxNode.x ) )
		.and( screenUV.y.greaterThanEqual( exposureNodes.meterRegionMinNode.y ) )
		.and( screenUV.y.lessThanEqual( exposureNodes.meterRegionMaxNode.y ) );
	const uiExcludedVisible = screenUV.x.greaterThanEqual( exposureNodes.uiExclusionMinNode.x )
		.and( screenUV.x.lessThanEqual( exposureNodes.uiExclusionMaxNode.x ) )
		.and( screenUV.y.greaterThanEqual( exposureNodes.uiExclusionMinNode.y ) )
		.and( screenUV.y.lessThanEqual( exposureNodes.uiExclusionMaxNode.y ) );
	const meterMaskDisplay = vec4(
		meterRegionVisible.and( uiExcludedVisible.not() ).select( vec3( 1 ), vec3( 0 ) ),
		1
	);
	const histogramDisplay = useHistogram
		? vec4( vec3(
			screenUV.x.greaterThanEqual( float( exposureNodes.histogramState.element( uint( 0 ) ).y ).div( HISTOGRAM_BINS ) )
				.and( screenUV.x.lessThanEqual( float( exposureNodes.histogramState.element( uint( 0 ) ).z.add( uint( 1 ) ) ).div( HISTOGRAM_BINS ) ) )
				.select( 1, 0 )
		), 1 )
		: vec4( vec3( 0 ), 1 );
	const modeNodes = Object.freeze( {
		final: finalNode,
		'meter-source': compressHdr,
		histogram: bypass( histogramDisplay, hdrColor ),
		adaptation: bypass( vec4( vec3( adaptationDisplay ), 1 ), hdrColor ),
		'meter-mask': bypass( meterMaskDisplay, hdrColor ),
		'tone-map': vec4( postToneMapLinear.rgb, 1 ),
		lut: vec4( outputGraph.gradedStraight.rgb, 1 )
	} );

	renderPipeline.outputColorTransform = false;
	renderPipeline.outputNode = finalNode;
	renderPipeline.needsUpdate = true;

	const diagnostics = {
		contract: EXPOSURE_EXAMPLE_CONTRACT,
		numericProvenance: NUMERIC_PROVENANCE,
		authoredSceneProvenance: 'Every AUTHORED_SCENE number is an authored visual fixture value, not a performance or camera recommendation.',
		debugViews: createDebugViewRegistry( {
			'meter source HDR': hdrColor,
			'meter mask': options.meterMask ?? null,
			'partial weightedLogSum weightSum': exposureNodes.partials,
			'histogram bins and underflow overflow': exposureNodes.histogram,
			'histogram prefix and percentile interval': exposureNodes.histogramState,
			'key luminance and target EV': exposureNodes.state,
			'adapted exposure EV': exposureNodes.state,
			'post exposure before tone map': vec4( straightHdr.rgb.mul( exp2( currentExposureEv ) ), straightHdr.a ),
			'post-tone-map linear': postToneMapLinear,
			'LUT output': outputGraph.gradedStraight,
			'final output': finalNode
		} ),
		storageBuffers: {
			partialBuffer,
			exposureFloatStateBuffer,
			exposureUintStateBuffer,
			histogramBuffer,
			histogramPrefixBuffer,
			histogramStateBuffer
		},
		ownership: {
			dynamicExposureOwner: 'ExposureFloatState.currentEV',
			toneMapOwner: 'toneMapping() node',
			outputTransformOwner: 'renderOutput(..., NoToneMapping, renderer.outputColorSpace)'
		},
		meter: {
			estimator: meterMode,
			tier: tierId,
			samples: METER_SAMPLE_COUNT,
			grid: [ METER_WIDTH, METER_HEIGHT ],
			cadenceHz: meterCadenceHz,
			workgroupSize,
			dispatchOrder: exposureNodes.meterDispatchOrder,
			dispatchesWhenMetered: exposureNodes.meterDispatchOrder.length + 1,
			dispatchesWhenReusingTarget: 1
		},
		grading: {
			toneMappingVariant,
			lutVariant,
			lutDomain: lutTexture.userData.domain
		},
		storageBytes,
		dispatchCount: dispatches,
		reducePassCount: reducePasses
	};

	const meterEnabled = meterMode !== METER_MODES.FIXED;
	const meterIntervalSeconds = meterEnabled ? 1 / meterCadenceHz : Infinity;
	let meterAccumulatorSeconds = meterEnabled ? meterIntervalSeconds : 0;
	let renderFrameIndex = 0;
	let meterUpdateIndex = 0;
	let currentMode = 'final';
	let currentScenario = 'emitter';
	let currentSeed = 1;
	const dispatchCounts = { adaptation: 0, meterStages: 0, meterUpdates: 0 };

	function setSeed( seed ) {

		if ( seed !== 1 && seed !== 0x9e3779b9 ) throw new Error( `Unsupported exposure seed ${ seed }.` );
		currentSeed = seed >>> 0;
		let hash = currentSeed;
		hash ^= hash >>> 16;
		hash = Math.imul( hash, 0x7feb352d );
		hash ^= hash >>> 15;
		hash = Math.imul( hash, 0x846ca68b );
		hash ^= hash >>> 16;
		const unit = ( hash >>> 0 ) / 0xffffffff;
		mesh.rotation.y = ( unit - 0.5 ) * 0.8;
		emitter.position.set( 1.0 + unit * 0.8, 0.02 + unit * 0.24, - 0.4 + unit * 0.5 );
		mesh.updateMatrixWorld( true );
		emitter.updateMatrixWorld( true );
		return currentSeed;

	}

	function setScenario( scenario ) {

		const known = [ 'emitter', 'gray-card', 'swatches', 'bright-window', 'masked-ui' ];
		if ( ! known.includes( scenario ) ) throw new Error( `Unknown exposure scenario "${ scenario }".` );
		mesh.visible = scenario !== 'gray-card';
		ground.visible = scenario !== 'gray-card';
		emitter.visible = scenario === 'emitter' || scenario === 'swatches' || scenario === 'masked-ui';
		grayCard.visible = scenario === 'gray-card';
		brightWindow.visible = scenario === 'bright-window';
		maskedUiPanel.visible = scenario === 'masked-ui';
		if ( scenario === 'masked-ui' ) {

			setMeterRegion( {
				regionMin: [ 0, 0 ],
				regionMax: [ 1, 1 ],
				exclusionMin: [ 0.72, 0 ],
				exclusionMax: [ 1, 0.22 ]
			} );

		}
		currentScenario = scenario;
		return currentScenario;

	}

	function setMode( mode ) {

		const node = modeNodes[ mode ];
		if ( ! node ) throw new Error( `Unknown exposure mode "${ mode }".` );
		if ( currentMode !== mode || renderPipeline.outputNode !== node ) {

			currentMode = mode;
			renderPipeline.outputNode = node;
			renderPipeline.needsUpdate = true;

		}
		return currentMode;

	}
	if ( options.mode ) setMode( options.mode );
	setScenario( options.scenario ?? 'emitter' );
	setSeed( options.seed ?? 1 );

	function render( deltaSeconds = DEFAULT_RENDER_DELTA_SECONDS ) {

		const safeDeltaSeconds = Math.min(
			Math.max( Number.isFinite( deltaSeconds ) ? deltaSeconds : 0, 0 ),
			MAX_ADAPTATION_DELTA_SECONDS
		);
		renderFrameIndex += 1;
		mesh.rotation.y += AUTHORED_SCENE.rotationRadiansPerSecond * safeDeltaSeconds;
		exposureNodes.deltaSecondsNode.value = safeDeltaSeconds;
		meterAccumulatorSeconds += safeDeltaSeconds;
		const meterThisFrame = meterEnabled && meterAccumulatorSeconds >= meterIntervalSeconds;

		// Adapt from the last completed meter target before presenting this frame.
		// This avoids sampling an uninitialized PassNode texture during startup.
		renderer.compute( exposureNodes.adaptExposureState );
		dispatchCounts.adaptation += 1;
		renderPipeline.render();

		if ( meterThisFrame ) {

			meterAccumulatorSeconds %= meterIntervalSeconds;
			meterUpdateIndex += 1;
			const jitter = stratifiedJitterForMeterUpdate( meterUpdateIndex );
			exposureNodes.meterJitterNode.value.set( jitter[ 0 ], jitter[ 1 ] );
			exposureNodes.sourceFrameIndexNode.value = renderFrameIndex;
			const meterDispatches = useHistogram
				? [
					exposureNodes.clearHistogram,
					exposureNodes.binHistogram,
					exposureNodes.buildHistogramPrefix,
					exposureNodes.resolveHistogramPercentiles,
					exposureNodes.reduceHdrToPartials,
					exposureNodes.reducePartialsToAggregate,
					exposureNodes.resolveMeterTarget
				]
				: [
					exposureNodes.reduceHdrToPartials,
					exposureNodes.reducePartialsToAggregate,
					exposureNodes.resolveMeterTarget
				];
			renderer.compute( meterDispatches );
			dispatchCounts.meterStages += meterDispatches.length;
			dispatchCounts.meterUpdates += 1;

		}

	}

	function resetMeterState( cause ) {

		if ( typeof cause !== 'string' || cause.length === 0 ) throw new Error( 'Exposure meter reset requires a nonempty cause.' );
		exposureFloatStateBuffer.array.set( [ KEY_CALIBRATION, 0, 0, 0 ] );
		exposureUintStateBuffer.array.set( [ 1, 0, 0, 0 ] );
		partialBuffer.array.fill( 0 );
		histogramBuffer?.array.fill( 0 );
		histogramPrefixBuffer?.array.fill( 0 );
		histogramStateBuffer?.array.fill( 0 );
		for ( const buffer of [ partialBuffer, exposureFloatStateBuffer, exposureUintStateBuffer, histogramBuffer, histogramPrefixBuffer, histogramStateBuffer ] ) {

			if ( buffer ) buffer.needsUpdate = true;

		}
		meterAccumulatorSeconds = meterEnabled ? meterIntervalSeconds : 0;
		renderFrameIndex = 0;
		meterUpdateIndex = 0;
		return { cause, state: 'authored-calibration', nextMeterUpdate: meterEnabled ? 1 : null };

	}

	async function readbackExposureState() {

		const read = async ( attribute, Type ) => attribute
			? Array.from( new Type( await renderer.getArrayBufferAsync( attribute ) ) )
			: null;
		const [ floatState, uintState, partials, histogramCounters, histogramPrefix, histogramState ] = await Promise.all( [
			read( exposureFloatStateBuffer, Float32Array ),
			read( exposureUintStateBuffer, Uint32Array ),
			read( partialBuffer, Float32Array ),
			read( histogramBuffer, Uint32Array ),
			read( histogramPrefixBuffer, Uint32Array ),
			read( histogramStateBuffer, Uint32Array )
		] );
		return {
			floatState,
			uintState,
			partials,
			histogramCounters,
			histogramPrefix,
			histogramState,
			dispatchCounts: { ...dispatchCounts },
			policy: 'diagnostic readback only; never feeds GPU exposure state'
		};

	}

	function resize( width, height, dpr = 1 ) {

		if ( ! Number.isFinite( width ) || ! Number.isFinite( height ) || width <= 0 || height <= 0 ) throw new Error( 'Exposure viewport dimensions must be finite and positive.' );
		if ( ! Number.isFinite( dpr ) || dpr <= 0 ) throw new Error( 'Exposure DPR must be finite and positive.' );
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setPixelRatio( dpr );
		renderer.setSize( Math.floor( width ), Math.floor( height ), false );

	}

	function setMeterRegion( { regionMin, regionMax, exclusionMin, exclusionMax } ) {

		if ( regionMin ) exposureNodes.meterRegionMinNode.value.fromArray( regionMin );
		if ( regionMax ) exposureNodes.meterRegionMaxNode.value.fromArray( regionMax );
		if ( exclusionMin ) exposureNodes.uiExclusionMinNode.value.fromArray( exclusionMin );
		if ( exclusionMax ) exposureNodes.uiExclusionMaxNode.value.fromArray( exclusionMax );
		return {
			regionMin: exposureNodes.meterRegionMinNode.value.toArray(),
			regionMax: exposureNodes.meterRegionMaxNode.value.toArray(),
			exclusionMin: exposureNodes.uiExclusionMinNode.value.toArray(),
			exclusionMax: exposureNodes.uiExclusionMaxNode.value.toArray()
		};

	}

	function describePipeline() {

		return {
			owners: {
				renderer: 'exposure-lab',
				primaryScenePass: 'scenePass',
				exposureState: 'ExposureFloatState.currentEV',
				toneMap: 'toneMapping() node',
				outputTransform: 'renderOutput() node'
			},
			sceneSubmissions: [ { id: 'scenePass', kind: 'lit-scene', count: 1 } ],
			computeDispatches: [ 'adaptExposureState', ...exposureNodes.meterDispatchOrder ],
			dispatchCounts: { ...dispatchCounts },
			meterMode,
			tier: tierId,
			mode: currentMode,
			scenario: currentScenario,
			seed: currentSeed,
			finalToneMapOwner: 'toneMapping() node',
			finalOutputTransformOwner: 'renderOutput() node'
		};

	}

	function describeResources() {

		return {
			storageBytes,
			resources: [
				{ id: 'exposure-partials', bytes: storageBytes.partialsBytes, type: 'storage-buffer' },
				{ id: 'exposure-state', bytes: storageBytes.stateBytes, type: 'storage-buffer' },
				...( useHistogram ? [
					{ id: 'histogram-counters', bytes: storageBytes.histogramBytes, type: 'atomic-storage-buffer' },
					{ id: 'histogram-prefix', bytes: storageBytes.histogramPrefixBytes, type: 'storage-buffer' },
					{ id: 'histogram-state', bytes: storageBytes.histogramStateBytes, type: 'storage-buffer' }
				] : [] ),
				{ id: lutTexture.name, bytes: lutSize ** 3 * 4, type: 'texture3d-rgba8' }
			]
		};

	}

	function dispose() {

		for ( const fixtureMesh of fixtureMeshes ) {

			fixtureMesh.geometry.dispose();
			fixtureMesh.material.dispose();

		}
		lutTexture.dispose();
		partialBuffer.dispose?.();
		exposureFloatStateBuffer.dispose?.();
		exposureUintStateBuffer.dispose?.();
		histogramBuffer?.dispose?.();
		histogramPrefixBuffer?.dispose?.();
		histogramStateBuffer?.dispose?.();
		scenePass.dispose?.();
		renderPipeline.dispose?.();
		renderer.dispose();

	}

	return {
		renderer,
		renderPipeline,
		scenePass,
		scene,
		camera,
		fixtureMeshes,
		diagnostics,
		tierId,
		meterMode,
		resize,
		setSeed,
		setMode,
		setScenario,
		setMeterRegion,
		resetMeterState,
		readbackExposureState,
		describePipeline,
		describeResources,
		render,
		dispose
	};

}
