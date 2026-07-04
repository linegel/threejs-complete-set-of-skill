export const METER_WIDTH = 64;
export const METER_HEIGHT = 36;
export const WORKGROUP_SIZE = 128;
export const HISTOGRAM_BINS = 64;
export const MIDDLE_GRAY = 0.18;
export const MIN_EXPOSURE = 0.45;
export const MAX_EXPOSURE = 1.85;
export const SPEED_UP = 3.2;
export const SPEED_DOWN = 1.1;
export const STALE_TIMEOUT_SECONDS = 1.0;
export const EXPOSURE_PARTIAL_FLOATS = 4;
export const EXPOSURE_STATE_FLOATS = 8;
export const LINEAR_SRGB_LUMINANCE_COEFFICIENTS = Object.freeze( [ 0.2126, 0.7152, 0.0722 ] );

export function luminanceLinearSRGB( rgb, coefficients = LINEAR_SRGB_LUMINANCE_COEFFICIENTS ) {

	return rgb[ 0 ] * coefficients[ 0 ] + rgb[ 1 ] * coefficients[ 1 ] + rgb[ 2 ] * coefficients[ 2 ];

}

export function dispatchCount( pixelCount, workgroupSize = WORKGROUP_SIZE ) {

	return Math.ceil( pixelCount / workgroupSize );

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

export function exposureTargetForAverage( averageLuminance, {
	middleGray = MIDDLE_GRAY,
	minExposure = MIN_EXPOSURE,
	maxExposure = MAX_EXPOSURE,
	exposureCompensationEv = 0
} = {} ) {

	const safeAverage = Math.max( averageLuminance, 0.0001 );
	const target = middleGray / safeAverage * ( 2 ** exposureCompensationEv );
	return Math.min( Math.max( target, minExposure ), maxExposure );

}

export function adaptExposure( current, target, deltaSeconds, {
	speedUp = SPEED_UP,
	speedDown = SPEED_DOWN
} = {} ) {

	const speed = target > current ? speedUp : speedDown;
	const amount = 1 - Math.exp( - Math.max( deltaSeconds, 0 ) * speed );
	return current + ( target - current ) * amount;

}

export function holdLastValidTelemetry( state, readback ) {

	if ( readback?.valid === true ) {

		return {
			...state,
			average: readback.average,
			target: readback.target,
			staleSeconds: 0,
			valid: true
		};

	}

	return {
		...state,
		staleSeconds: state.staleSeconds + ( readback?.deltaSeconds ?? 0 ),
		valid: false
	};

}

export function estimateExposureStorageBytes( pixelCount = METER_WIDTH * METER_HEIGHT, {
	workgroupSize = WORKGROUP_SIZE,
	histogramBins = HISTOGRAM_BINS
} = {} ) {

	const partialCount = dispatchCount( pixelCount, workgroupSize );
	return {
		partialCount,
		partialsBytes: partialCount * EXPOSURE_PARTIAL_FLOATS * 4,
		stateBytes: EXPOSURE_STATE_FLOATS * 4,
		histogramBytes: histogramBins * 4,
		totalBytes: partialCount * EXPOSURE_PARTIAL_FLOATS * 4 + EXPOSURE_STATE_FLOATS * 4 + histogramBins * 4
	};

}

export function histogramBinForLuminance( luminance, {
	minLog = -12,
	maxLog = 4,
	histogramBins = HISTOGRAM_BINS
} = {} ) {

	const logValue = Math.log2( Math.max( luminance, 0.0001 ) );
	const normalized = ( logValue - minLog ) / ( maxLog - minLog );
	return Math.min( histogramBins - 1, Math.max( 0, Math.floor( normalized * histogramBins ) ) );

}

export function weightedLogAverage( samples ) {

	let logSum = 0;
	let weightSum = 0;

	for ( const sample of samples ) {

		const mask = sample.sceneMask * sample.uiMask * sample.skyMask;
		const weight = mask * sample.centerWeight * ( sample.luminance > 0.002 ? 1 : 0.15 );
		logSum += Math.log( Math.max( sample.luminance, 0.0001 ) ) * weight;
		weightSum += weight;

	}

	return Math.exp( logSum / Math.max( weightSum, 0.0001 ) );

}
