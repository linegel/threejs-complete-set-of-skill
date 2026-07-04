export const COLOR_DOMAINS = {
	SCENE_LINEAR_HDR: 'scene-linear HDR',
	TONE_MAPPED_LINEAR: 'tone-mapped linear',
	DISPLAY_REFERRED_SRGB: 'display-referred sRGB',
	DATA_NO_COLOR: 'data/no-color'
};

export function createDefaultImagePipelineConfig( overrides = {} ) {

	return {
		sceneRenderCount: 1,
		toneMapOwner: 'renderOutput',
		outputTransformOwner: 'renderOutput',
		outputColorTransform: false,
		lutDomain: COLOR_DOMAINS.DISPLAY_REFERRED_SRGB,
		requiredMRT: [ 'output', 'normal', 'emissive' ],
		producers: {
			output: 'scene-pass',
			normal: 'scene-pass',
			emissive: 'scene-pass',
			depth: 'scene-pass'
		},
		consumers: {
			output: [ 'lighting-composite', 'no-post-diagnostic', 'exposure-meter' ],
			normal: [ 'GTAONode', 'normal-diagnostic' ],
			emissive: [ 'BloomNode', 'emissive-diagnostic' ],
			depth: [ 'GTAONode', 'depth-diagnostic' ]
		},
		colorDomains: {
			output: COLOR_DOMAINS.SCENE_LINEAR_HDR,
			normal: COLOR_DOMAINS.DATA_NO_COLOR,
			emissive: COLOR_DOMAINS.SCENE_LINEAR_HDR,
			depth: COLOR_DOMAINS.DATA_NO_COLOR,
			final: COLOR_DOMAINS.DISPLAY_REFERRED_SRGB
		},
		resolutionScales: {
			scene: 1,
			ao: 0.5,
			bloom: 0.5,
			diagnostics: 1
		},
		temporal: {
			enabled: false,
			velocityConvention: null,
			jitterOwner: null,
			resetEvents: []
		},
		memory: {
			width: 1920,
			height: 1080,
			hdrAttachmentBytes: 1920 * 1080 * 8,
			dataAttachmentBytes: 1920 * 1080 * 8,
			memoryBudget: 256 * 1024 * 1024
		},
		disablePaths: {
			ao: 'indirect visibility = 1.0, direct/emissive unchanged',
			bloom: 'emissive contribution bypassed',
			temporal: 'current frame only, no history sampling',
			grading: 'identity display-referred transform'
		},
		resize: {
			updatesRenderer: true,
			updatesScenePass: true,
			resetsTemporalHistory: true
		},
		disposal: {
			disposesRenderPipeline: true,
			disposesPassNodes: true,
			disposesTargets: true
		},
		...overrides
	};

}

export function createCapabilityTier( renderer, options = {} ) {

	const backend = renderer.backend ?? {};
	const initialized = renderer.initialized === true;
	const isPrimaryBackend = backend.isWebGPUBackend === true;
	const hasFeature = typeof renderer.hasFeature === 'function' && initialized;
	const requiredMRT = options.requiredMRT ?? 3;
	const requiredStorage = options.requiredStorage === true;
	const outputBufferType = typeof renderer.getOutputBufferType === 'function' ? renderer.getOutputBufferType() : null;
	const timestampQuery = hasFeature ? renderer.hasFeature( 'timestamp-query' ) === true : false;
	const memoryBudget = options.memoryBudget ?? 256 * 1024 * 1024;
	const budgetReason = [];

	if ( initialized === false ) throw new Error( 'Renderer must be initialized before image-pipeline capability checks.' );
	if ( isPrimaryBackend === false ) throw new Error( 'WebGPU backend required for the canonical image pipeline. If the user explicitly asks how to apply fallback when WebGPU is unavailable, route to threejs-compatibility-fallbacks.' );
	if ( requiredStorage && typeof renderer.computeAsync !== 'function' ) budgetReason.push( 'computeAsync unavailable' );
	if ( outputBufferType === null ) budgetReason.push( 'output buffer type unavailable' );

	return {
		tier: budgetReason.length === 0 ? 'full' : 'budgeted',
		backend: 'WebGPU',
		requiredMRT,
		requiredStorage,
		timestampQuery,
		outputBufferType,
		memoryBudget,
		budgetReason
	};

}

function cloneRgb( value = [ 0, 0, 0 ] ) {

	return value.map( ( component ) => Number( component ) );

}

function scaleRgb( value, scalar ) {

	return value.map( ( component ) => component * scalar );

}

function addRgb( ...values ) {

	return values.reduce( ( total, value ) => total.map( ( component, index ) => component + value[ index ] ), [ 0, 0, 0 ] );

}

export function evaluateLightingAwareAoComposite( pixelTerms, indirectVisibility ) {

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
