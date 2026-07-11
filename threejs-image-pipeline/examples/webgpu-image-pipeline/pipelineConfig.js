export const COLOR_DOMAINS = Object.freeze( {
	SCENE_LINEAR_HDR: 'scene-linear working color',
	TONE_MAPPED_LINEAR: 'tone-mapped linear working primaries',
	DISPLAY_ENCODED: 'display/output encoded',
	DATA_NO_COLOR: 'data/no-color'
} );

export const IMAGE_PIPELINE_EXAMPLE_CONTRACT = Object.freeze( {
	profile: 'minimal-public-api-baseline',
	mrtDecisionEvidence: 'default output-only; optional normal/emissive feature fixture is not measured',
	directIndirectSeparation: 'not-implemented; AO uses an authored split scaffold',
	temporal: 'not-implemented; configuration enabling temporal is rejected',
	exposure: 'not-implemented in this example',
	gradingLut: 'not-implemented in this example',
	alphaPolicy: 'opaque fixture; AO and bloom composition preserve pass alpha',
	toneMapping: 'NeutralToneMapping through renderOutput context',
	outputConversion: 'renderOutput context',
	adaptiveDpr: 'controller not implemented; resize/setPixelRatio mechanics only',
	transientAliasing: 'not implemented; built-in private targets are persistent',
	performance: 'no device budget proof; static bytes are logical accounting fixtures'
} );

export const IMAGE_PIPELINE_NUMERIC_PROVENANCE = Object.freeze( {
	SCENE_RENDER_COUNT: 'Authored baseline architecture.',
	SCENE_SCALE: 'Authored feature-demo scale.',
	AO_SCALE: 'Authored feature-demo scale.',
	BLOOM_SCALE: 'Authored feature-demo scale.',
	AO_INDIRECT_FRACTION: 'Authored scaffold because direct/indirect lighting is not separated.',
	ACCOUNTING_WIDTH: 'Authored static accounting fixture, not the runtime canvas.',
	ACCOUNTING_HEIGHT: 'Authored static accounting fixture, not the runtime canvas.',
	RGBA16F_BYTES_PER_PIXEL: 'Derived from four half-float channels.',
	RG16F_BYTES_PER_PIXEL: 'Derived from two half-float channels.',
	MEMORY_BUDGET_BYTES: 'Authored validator gate, not measured physical allocation.'
} );

const SCENE_RENDER_COUNT = 1;
const SCENE_SCALE = 1;
const AO_SCALE = 0.5;
const BLOOM_SCALE = 0.5;
const AO_INDIRECT_FRACTION = 0.25;
const ACCOUNTING_WIDTH = 1920;
const ACCOUNTING_HEIGHT = 1080;
const RGBA16F_BYTES_PER_PIXEL = 8;
const RG16F_BYTES_PER_PIXEL = 4;
const MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;

function mergeNested( base, overrides, key ) {

	return { ...base[ key ], ...( overrides[ key ] ?? {} ) };

}

export function createDefaultImagePipelineConfig( overrides = {} ) {

	const base = {
		contract: IMAGE_PIPELINE_EXAMPLE_CONTRACT,
		numericProvenance: IMAGE_PIPELINE_NUMERIC_PROVENANCE,
		sceneRenderCount: SCENE_RENDER_COUNT,
		toneMapOwner: 'renderOutput',
		toneMappingMode: 'NeutralToneMapping',
		outputTransformOwner: 'renderOutput',
		outputColorTransform: false,
		lutDomain: null,
		requiredMRT: [ 'output' ],
		mrtSelection: {
			status: IMAGE_PIPELINE_EXAMPLE_CONTRACT.mrtDecisionEvidence,
			output: 'required scene color',
			normal: 'disabled by default; optional feature-fixture choice for GTAONode',
			emissive: 'disabled by default; optional feature-fixture choice for selective BloomNode',
			velocity: 'unsupported because the executable temporal reset/reseed path is absent'
		},
		features: {
			gtao: false,
			selectiveBloom: false,
			temporal: false,
			exposure: false,
			gradingLut: false,
			adaptiveDpr: false,
			transientAliasing: false
		},
		producers: {
			output: 'scene-pass',
			normal: 'scene-pass',
			emissive: 'scene-pass',
			depth: 'scene-pass-depth-texture'
		},
		consumers: {
			output: [ 'authored-AO-split-scaffold', 'no-post-diagnostic' ],
			normal: [ 'GTAONode', 'normal-diagnostic' ],
			emissive: [ 'BloomNode', 'emissive-diagnostic' ],
			depth: [ 'GTAONode', 'depth-diagnostic' ]
		},
		colorDomains: {
			output: COLOR_DOMAINS.SCENE_LINEAR_HDR,
			normal: COLOR_DOMAINS.DATA_NO_COLOR,
			emissive: COLOR_DOMAINS.SCENE_LINEAR_HDR,
			depth: COLOR_DOMAINS.DATA_NO_COLOR,
			final: COLOR_DOMAINS.DISPLAY_ENCODED
		},
		resolutionScales: {
			scene: SCENE_SCALE,
			ao: AO_SCALE,
			bloom: BLOOM_SCALE,
			diagnostics: SCENE_SCALE
		},
		aoIndirectFraction: AO_INDIRECT_FRACTION,
		temporal: {
			enabled: false,
			velocityConvention: null,
			jitterOwner: null,
			resetStrategy: null,
			resetEvents: []
		},
		memory: {
			width: ACCOUNTING_WIDTH,
			height: ACCOUNTING_HEIGHT,
			bytesPerPixelBySignal: {
				output: RGBA16F_BYTES_PER_PIXEL,
				normal: RGBA16F_BYTES_PER_PIXEL,
				emissive: RGBA16F_BYTES_PER_PIXEL,
				velocity: RG16F_BYTES_PER_PIXEL
			},
			memoryBudget: MEMORY_BUDGET_BYTES,
			accountingStatus: 'logical color-attachment lower bound; excludes depth, alignment, private effects, MSAA, and physical allocator behavior'
		},
		disablePaths: {
			ao: 'authored split visibility = one; final-color multiply remains diagnostic only',
			bloom: 'bloom contribution bypassed',
			temporal: 'current scene radiance only; no velocity/history allocation',
			exposure: 'not implemented here; route to exposure example/skill',
			grading: 'not implemented; no LUT-domain claim'
		},
		resize: {
			updatesRendererPixelRatio: true,
			updatesRendererSize: true,
			updatesScenePass: true,
			resetsTemporalHistory: false
		},
		disposal: {
			disposesRenderPipeline: true,
			disposesPassNodes: true,
			disposesTargets: true
		}
	};

	const config = {
		...base,
		...overrides,
		mrtSelection: mergeNested( base, overrides, 'mrtSelection' ),
		features: mergeNested( base, overrides, 'features' ),
		producers: mergeNested( base, overrides, 'producers' ),
		consumers: mergeNested( base, overrides, 'consumers' ),
		colorDomains: mergeNested( base, overrides, 'colorDomains' ),
		resolutionScales: mergeNested( base, overrides, 'resolutionScales' ),
		temporal: mergeNested( base, overrides, 'temporal' ),
		memory: {
			...base.memory,
			...( overrides.memory ?? {} ),
			bytesPerPixelBySignal: {
				...base.memory.bytesPerPixelBySignal,
				...( overrides.memory?.bytesPerPixelBySignal ?? {} )
			}
		},
		disablePaths: mergeNested( base, overrides, 'disablePaths' ),
		resize: mergeNested( base, overrides, 'resize' ),
		disposal: mergeNested( base, overrides, 'disposal' )
	};

	for ( const optionalSignal of [ 'normal', 'emissive', 'velocity', 'albedo' ] ) {

		if ( config.requiredMRT.includes( optionalSignal ) === false ) {

			delete config.producers[ optionalSignal ];
			delete config.consumers[ optionalSignal ];
			delete config.colorDomains[ optionalSignal ];

		}

	}

	return config;

}

export function createFeatureDemoImagePipelineConfig( overrides = {} ) {

	return createDefaultImagePipelineConfig( {
		...overrides,
		requiredMRT: overrides.requiredMRT ?? [ 'output', 'normal', 'emissive' ],
		features: {
			...( overrides.features ?? {} ),
			gtao: overrides.features?.gtao ?? true,
			selectiveBloom: overrides.features?.selectiveBloom ?? true
		},
		preset: 'explicit-unmeasured-feature-fixture'
	} );

}

export function estimateMrtLogicalBytes( config, {
	width = config.memory.width,
	height = config.memory.height,
	scale = config.resolutionScales.scene
} = {} ) {

	const physicalWidth = Math.floor( width * scale );
	const physicalHeight = Math.floor( height * scale );
	const pixelCount = physicalWidth * physicalHeight;
	return config.requiredMRT.reduce( ( total, signal ) => {

		const bytesPerPixel = config.memory.bytesPerPixelBySignal[ signal ];

		if ( ! Number.isFinite( bytesPerPixel ) ) {

			throw new Error( `No physical-format byte classification for MRT signal "${ signal }".` );

		}

		return total + pixelCount * bytesPerPixel;

	}, 0 );

}

export function createCapabilityTier( renderer, options = {} ) {

	const backend = renderer.backend ?? {};
	const initialized = renderer.initialized === true;
	const isPrimaryBackend = backend.isWebGPUBackend === true;
	const hasFeature = typeof renderer.hasFeature === 'function' && initialized;
	const selectedMrt = options.selectedMrt ?? [];
	const bytesPerPixelBySignal = options.bytesPerPixelBySignal ?? {};
	const limits = backend.device?.limits ?? null;
	const outputBufferType = typeof renderer.getOutputBufferType === 'function'
		? renderer.getOutputBufferType()
		: null;
	const timestampQuery = hasFeature ? renderer.hasFeature( 'timestamp-query' ) === true : false;
	const blockers = [];

	if ( initialized === false ) throw new Error( 'Renderer must be initialized before image-pipeline capability checks.' );
	if ( isPrimaryBackend === false ) throw new Error( 'Native WebGPU is required for the canonical image pipeline.' );
	if ( outputBufferType === null ) blockers.push( 'output buffer type unavailable' );
	if ( selectedMrt.length === 0 || selectedMrt[ 0 ] !== 'output' ) blockers.push( 'selected MRT must include output' );
	const selectedBytesPerSample = selectedMrt.reduce(
		( total, signal ) => total + ( bytesPerPixelBySignal[ signal ] ?? 0 ),
		0
	);
	if ( limits === null ) blockers.push( 'WebGPU device limits unavailable' );
	else {

		if ( selectedMrt.length > limits.maxColorAttachments ) blockers.push( 'selected MRT exceeds maxColorAttachments' );
		if ( selectedBytesPerSample > limits.maxColorAttachmentBytesPerSample ) blockers.push( 'selected MRT exceeds maxColorAttachmentBytesPerSample' );

	}

	return {
		backend: 'WebGPU',
		selectedMrt,
		selectedBytesPerSample,
		limitEvidence: limits ? {
			maxColorAttachments: limits.maxColorAttachments,
			maxColorAttachmentBytesPerSample: limits.maxColorAttachmentBytesPerSample
		} : null,
		timestampQuery,
		outputBufferType,
		status: blockers.length === 0 ? 'capability-gated-not-performance-proven' : 'blocked',
		blockers,
		performanceEvidence: 'not measured by createCapabilityTier'
	};

}

function cloneRgb( value = [ 0, 0, 0 ] ) {

	return value.map( ( component ) => Number( component ) );

}

function scaleRgb( value, scalar ) {

	return value.map( ( component ) => component * scalar );

}

function addRgb( ...values ) {

	return values.reduce(
		( total, value ) => total.map( ( component, index ) => component + value[ index ] ),
		[ 0, 0, 0 ]
	);

}

// Numeric oracle for the composition equation only. It does not prove that the
// browser scene exposes physically separated lighting terms.
export function evaluateSeparatedLightingAoComposite( pixelTerms, indirectVisibility ) {

	const visibility = Math.min( Math.max( Number( indirectVisibility ), 0 ), 1 );
	const direct = cloneRgb( pixelTerms.direct );
	const indirect = scaleRgb( cloneRgb( pixelTerms.indirect ), visibility );
	const emissive = cloneRgb( pixelTerms.emissive );
	const atmosphere = cloneRgb( pixelTerms.atmosphere );
	const ui = cloneRgb( pixelTerms.ui );

	return {
		direct,
		indirect,
		emissive,
		atmosphere,
		ui,
		color: addRgb( direct, indirect, emissive, atmosphere, ui )
	};

}
