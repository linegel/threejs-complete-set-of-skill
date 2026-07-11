export const EXPOSURE_EXAMPLE_CONTRACT = Object.freeze( {
	runtimeMeter: 'stratified weighted-log or percentile-clipped weighted-log',
	adaptationDomain: 'EV/log2',
	exactFullPixelReduction: 'not selected by the checked-in tiers; the runtime meter evaluates the declared stratified sample set',
	luminancePyramid: 'not-implemented',
	histogram: 'implemented as clear + sampled fixed-point weighted global-atomic bins + weighted prefix/percentile bounds + clipped floating-weight reduction',
	temporalMeterSource: 'not-implemented; source is the raw scene pass',
	bloomFeedbackPolicy: 'not-applicable; this example has no bloom node',
	claimBoundary: 'The executable graph implements the selected sampled meter, GPU EV state, tone-map variants, and identity/creative tone-mapped-linear LUTs. Device performance remains insufficient evidence until a named-adapter capture succeeds.'
} );

export const METER_MODES = Object.freeze( {
	FIXED: 'fixed-shot',
	WEIGHTED_LOG: 'weighted-log',
	HISTOGRAM: 'histogram-percentile'
} );

export const EXPOSURE_QUALITY_TIERS = Object.freeze( {
	'full-histogram': Object.freeze( {
		meterMode: METER_MODES.HISTOGRAM,
		meterCadenceHz: 30,
		lut: 'creative'
	} ),
	'balanced-log-reduction': Object.freeze( {
		meterMode: METER_MODES.WEIGHTED_LOG,
		meterCadenceHz: 30,
		lut: 'identity'
	} ),
	'minimum-fixed-shot': Object.freeze( {
		meterMode: METER_MODES.FIXED,
		meterCadenceHz: 0,
		lut: 'identity'
	} )
} );

export const NUMERIC_PROVENANCE = Object.freeze( {
	METER_WIDTH: 'Authored example grid; validate estimator error against an exact meter.',
	METER_HEIGHT: 'Authored example grid; validate estimator error against an exact meter.',
	METER_SAMPLE_COUNT: 'Derived as METER_WIDTH * METER_HEIGHT.',
	WORKGROUP_SIZE: 'Authored r185 baseline; gate by compile and target measurement.',
	METER_CADENCE_HZ: 'Authored example cadence; measure estimator latency and dispatch cost.',
	KEY_CALIBRATION: 'Authored scene/exposure calibration.',
	MIN_EXPOSURE_EV: 'Authored example clamp, not a camera/device limit.',
	MAX_EXPOSURE_EV: 'Authored example clamp, not a camera/device limit.',
	TAU_BRIGHT_SCENE_SECONDS: 'Authored adaptation time constant when exposure decreases.',
	TAU_DARK_SCENE_SECONDS: 'Authored adaptation time constant when exposure increases.',
	MAX_ADAPTATION_DELTA_SECONDS: 'Authored pause/catch-up clamp.',
	DEFAULT_RENDER_DELTA_SECONDS: 'Authored example timestep used only when the caller supplies none.',
	LUMINANCE_EPSILON: 'Authored numerical floor in scene-linear units.',
	WEIGHT_EPSILON: 'Authored dimensionless empty-mask threshold.',
	TIME_EPSILON_SECONDS: 'Authored positive time-denominator guard in seconds.',
	MAX_METER_LUMINANCE: 'Derived finite upper gate for the fixed HalfFloatType meter source.',
	CENTER_WEIGHT_SLOPE: 'Authored shot-meter policy.',
	CENTER_WEIGHT_MIN: 'Authored shot-meter policy.',
	LOW_LIGHT_CUTOFF: 'Authored scene-scale policy.',
	LOW_LIGHT_WEIGHT: 'Authored scene-scale policy.',
	HISTOGRAM_BINS: 'Authored sampled global-atomic histogram resolution.',
	HISTOGRAM_MIN_LOG2: 'Authored runtime histogram EV-window minimum.',
	HISTOGRAM_MAX_LOG2: 'Authored runtime histogram EV-window maximum.',
	HISTOGRAM_LOW_PERCENTILE: 'Authored lower clipping percentile for sampled fixed-point meter weight.',
	HISTOGRAM_HIGH_PERCENTILE: 'Authored upper clipping percentile for sampled fixed-point meter weight.',
	HISTOGRAM_WEIGHT_SCALE: 'Derived fixed-point weight scale; METER_SAMPLE_COUNT * scale is proven below u32 max.',
	HISTOGRAM_EXTRA_COUNTERS: 'Derived underflow and overflow counter count.',
	HISTOGRAM_STATE_UINTS: 'Derived from two uvec4 histogram-state records.',
	EXPOSURE_PARTIAL_FLOATS: 'Derived from one vec4<f32>.',
	EXPOSURE_STATE_FLOATS: 'Derived from one vec4<f32>.',
	EXPOSURE_STATE_UINTS: 'Derived from one vec4<u32>.',
	LINEAR_SRGB_LUMINANCE_COEFFICIENTS: 'Derived from Three.js r185 ColorManagement.',
	INACTIVE_LOG_LUMINANCE_SENTINEL: 'Derived finite sentinel outside the log2 range of the fixed HalfFloatType meter source.'
} );

export const METER_WIDTH = 64;
export const METER_HEIGHT = 36;
export const METER_SAMPLE_COUNT = METER_WIDTH * METER_HEIGHT;
export const WORKGROUP_SIZE = 128;
export const METER_CADENCE_HZ = 30;

export const KEY_CALIBRATION = 0.18;
export const MIN_EXPOSURE_EV = - 4;
export const MAX_EXPOSURE_EV = 4;
export const TAU_BRIGHT_SCENE_SECONDS = 0.25;
export const TAU_DARK_SCENE_SECONDS = 1.0;
export const MAX_ADAPTATION_DELTA_SECONDS = 0.1;
export const DEFAULT_RENDER_DELTA_SECONDS = 1 / 60;
export const LUMINANCE_EPSILON = 0.0001;
export const WEIGHT_EPSILON = 0.000001;
export const TIME_EPSILON_SECONDS = 0.000001;
export const MAX_METER_LUMINANCE = 65504;

export const CENTER_WEIGHT_SLOPE = 0.9;
export const CENTER_WEIGHT_MIN = 0.35;
export const LOW_LIGHT_CUTOFF = 0.002;
export const LOW_LIGHT_WEIGHT = 0.15;

export const HISTOGRAM_BINS = 64;
export const HISTOGRAM_MIN_LOG2 = - 12;
export const HISTOGRAM_MAX_LOG2 = 4;
export const HISTOGRAM_LOW_PERCENTILE = 0.02;
export const HISTOGRAM_HIGH_PERCENTILE = 0.98;
export const HISTOGRAM_WEIGHT_SCALE = 65535;
export const HISTOGRAM_EXTRA_COUNTERS = 2;
export const HISTOGRAM_STATE_UINTS = 8;
export const HISTOGRAM_MAX_WEIGHT_SUM = METER_SAMPLE_COUNT * HISTOGRAM_WEIGHT_SCALE;

if ( HISTOGRAM_MAX_WEIGHT_SUM > 0xffffffff ) throw new Error( 'Histogram fixed-point weight sum exceeds u32 capacity.' );

export const EXPOSURE_PARTIAL_FLOATS = 4;
export const EXPOSURE_STATE_FLOATS = 4;
export const EXPOSURE_STATE_UINTS = 4;
export const LINEAR_SRGB_LUMINANCE_COEFFICIENTS = Object.freeze( [ 0.2126, 0.7152, 0.0722 ] );
export const INACTIVE_LOG_LUMINANCE_SENTINEL = 1024;

export function luminanceLinearSRGB( rgb, coefficients = LINEAR_SRGB_LUMINANCE_COEFFICIENTS ) {

	return rgb[ 0 ] * coefficients[ 0 ] + rgb[ 1 ] * coefficients[ 1 ] + rgb[ 2 ] * coefficients[ 2 ];

}

export function dispatchCount( sampleCount, workgroupSize = WORKGROUP_SIZE ) {

	return Math.ceil( sampleCount / workgroupSize );

}

export function reducePassCount( partialCount, workgroupSize = WORKGROUP_SIZE ) {

	let passes = 0;
	let count = Math.max( 1, partialCount );
	while ( count > 1 ) {

		count = Math.ceil( count / workgroupSize );
		passes += 1;

	}

	return passes;

}

export function exposureTargetEvForKey( keyLuminance, {
	keyCalibration = KEY_CALIBRATION,
	minExposureEv = MIN_EXPOSURE_EV,
	maxExposureEv = MAX_EXPOSURE_EV,
	exposureCompensationEv = 0
} = {} ) {

	const safeKey = Math.max( keyLuminance, LUMINANCE_EPSILON );
	const targetEv = Math.log2( keyCalibration / safeKey ) + exposureCompensationEv;
	return Math.min( Math.max( targetEv, minExposureEv ), maxExposureEv );

}

export function exposureMultiplierFromEv( exposureEv ) {

	return 2 ** exposureEv;

}

export function adaptExposureEv( currentEv, targetEv, deltaSeconds, {
	tauBrightSceneSeconds = TAU_BRIGHT_SCENE_SECONDS,
	tauDarkSceneSeconds = TAU_DARK_SCENE_SECONDS
} = {} ) {

	const tau = targetEv < currentEv ? tauBrightSceneSeconds : tauDarkSceneSeconds;
	const alpha = 1 - Math.exp( - Math.max( deltaSeconds, 0 ) / Math.max( tau, Number.EPSILON ) );
	return currentEv + ( targetEv - currentEv ) * alpha;

}

export function holdLastValidTelemetry( state, readback ) {

	if ( readback?.valid === true ) {

		return {
			...state,
			keyLuminance: readback.keyLuminance,
			targetEv: readback.targetEv,
			invalidSeconds: 0,
			valid: true
		};

	}

	return {
		...state,
		invalidSeconds: state.invalidSeconds + ( readback?.deltaSeconds ?? 0 ),
		valid: false
	};

}

export function estimateExposureStorageBytes( sampleCount = METER_SAMPLE_COUNT, {
	workgroupSize = WORKGROUP_SIZE,
	includeHistogram = false,
	histogramBins = HISTOGRAM_BINS
} = {} ) {

	const partialCount = dispatchCount( sampleCount, workgroupSize );
	const partialsBytes = partialCount * EXPOSURE_PARTIAL_FLOATS * Float32Array.BYTES_PER_ELEMENT;
	const stateBytes = EXPOSURE_STATE_FLOATS * Float32Array.BYTES_PER_ELEMENT
		+ EXPOSURE_STATE_UINTS * Uint32Array.BYTES_PER_ELEMENT;

	const histogramCounterCount = includeHistogram ? histogramBins + HISTOGRAM_EXTRA_COUNTERS : 0;
	const histogramBytes = histogramCounterCount * Uint32Array.BYTES_PER_ELEMENT;
	const histogramPrefixBytes = includeHistogram ? histogramBins * Uint32Array.BYTES_PER_ELEMENT : 0;
	const histogramStateBytes = includeHistogram ? HISTOGRAM_STATE_UINTS * Uint32Array.BYTES_PER_ELEMENT : 0;

	return {
		partialCount,
		partialsBytes,
		stateBytes,
		histogramCounterCount,
		histogramBytes,
		histogramPrefixBytes,
		histogramStateBytes,
		totalBytes: partialsBytes + stateBytes + histogramBytes + histogramPrefixBytes + histogramStateBytes
	};

}

export function histogramPercentileWindow( luminances, {
	weights = null,
	lowPercentile = HISTOGRAM_LOW_PERCENTILE,
	highPercentile = HISTOGRAM_HIGH_PERCENTILE,
	minLog = HISTOGRAM_MIN_LOG2,
	maxLog = HISTOGRAM_MAX_LOG2,
	histogramBins = HISTOGRAM_BINS
} = {} ) {

	if ( ! ( lowPercentile >= 0 && highPercentile <= 1 && lowPercentile < highPercentile ) ) {

		throw new Error( 'Histogram percentiles must satisfy 0 <= low < high <= 1.' );

	}

	const bins = new Uint32Array( histogramBins );
	let underflow = 0;
	let overflow = 0;
	for ( let index = 0; index < luminances.length; index += 1 ) {

		const luminance = luminances[ index ];
		const weight = weights ? weights[ index ] : 1;
		const weightUnits = Math.max( 0, Math.min( HISTOGRAM_WEIGHT_SCALE, Math.round( weight * HISTOGRAM_WEIGHT_SCALE ) ) );
		const logValue = Math.log2( Math.max( luminance, LUMINANCE_EPSILON ) );
		if ( logValue < minLog ) underflow += weightUnits;
		if ( logValue > maxLog ) overflow += weightUnits;
		bins[ histogramBinForLuminance( luminance, { minLog, maxLog, histogramBins } ) ] += weightUnits;

	}

	const total = bins.reduce( ( sum, value ) => sum + value, 0 );
	const lowRank = Math.max( 1, Math.ceil( total * lowPercentile ) );
	const highRank = Math.max( lowRank, Math.ceil( total * highPercentile ) );
	let prefix = 0;
	let lowBin = 0;
	let highBin = histogramBins - 1;
	let lowFound = false;
	for ( let bin = 0; bin < histogramBins; bin += 1 ) {

		prefix += bins[ bin ];
		if ( lowFound === false && prefix >= lowRank ) {

			lowBin = bin;
			lowFound = true;

		}
		if ( prefix >= highRank ) {

			highBin = bin;
			break;

		}

	}

	return { bins, total, lowBin, highBin, underflow, overflow, weightScale: HISTOGRAM_WEIGHT_SCALE };

}

export function percentileClippedWeightedLogAverage( samples, options = {} ) {

	const accepted = samples.filter( ( sample ) => {

		const mask = sample.sceneMask * sample.uiMask * sample.skyMask;
		return Number.isFinite( sample.luminance ) && sample.luminance >= 0 && mask > WEIGHT_EPSILON;

	} );
	const floatWeights = accepted.map( ( sample ) => {

		const mask = sample.sceneMask * sample.uiMask * sample.skyMask;
		const lowLightWeight = sample.luminance > LOW_LIGHT_CUTOFF ? 1 : LOW_LIGHT_WEIGHT;
		return Math.min( 1, Math.max( 0, mask * sample.centerWeight * lowLightWeight ) );

	} );
	const window = histogramPercentileWindow(
		accepted.map( ( sample ) => sample.luminance ),
		{ ...options, weights: floatWeights }
	);
	const clipped = accepted.filter( ( sample ) => {

		const bin = histogramBinForLuminance( sample.luminance, options );
		return bin >= window.lowBin && bin <= window.highBin;

	} );
	return {
		keyLuminance: weightedLogAverage( clipped ),
		window,
		acceptedCount: accepted.length,
		clippedCount: clipped.length
	};

}

export function resolveExposureTier( tierId ) {

	const tier = EXPOSURE_QUALITY_TIERS[ tierId ];
	if ( ! tier ) throw new Error( `Unknown exposure tier "${ tierId }".` );
	return tier;

}

// CPU oracle for the executable sampled histogram bin mapping.
export function histogramBinForLuminance( luminance, {
	minLog = HISTOGRAM_MIN_LOG2,
	maxLog = HISTOGRAM_MAX_LOG2,
	histogramBins = HISTOGRAM_BINS
} = {} ) {

	const logValue = Math.log2( Math.max( luminance, LUMINANCE_EPSILON ) );
	const normalized = ( logValue - minLog ) / ( maxLog - minLog );
	return Math.min( histogramBins - 1, Math.max( 0, Math.floor( normalized * histogramBins ) ) );

}

export function weightedLogAverage( samples ) {

	let weightedLogSum = 0;
	let weightSum = 0;

	for ( const sample of samples ) {

		const mask = sample.sceneMask * sample.uiMask * sample.skyMask;
		const lowLightWeight = sample.luminance > LOW_LIGHT_CUTOFF ? 1 : LOW_LIGHT_WEIGHT;
		const weight = mask * sample.centerWeight * lowLightWeight;
		weightedLogSum += Math.log2( Math.max( sample.luminance, LUMINANCE_EPSILON ) ) * weight;
		weightSum += weight;

	}

	return 2 ** ( weightedLogSum / Math.max( weightSum, LUMINANCE_EPSILON ) );

}

function halton( index, base ) {

	let fraction = 1;
	let result = 0;
	let value = index;

	while ( value > 0 ) {

		fraction /= base;
		result += fraction * ( value % base );
		value = Math.floor( value / base );

	}

	return result;

}

export function stratifiedJitterForMeterUpdate( meterUpdateIndex ) {

	const sequenceIndex = Math.max( 0, Math.floor( meterUpdateIndex ) ) + 1;
	return [ halton( sequenceIndex, 2 ), halton( sequenceIndex, 3 ) ];

}
