import { NoToneMapping, Vector2 } from 'three/webgpu';
import {
	Fn,
	If,
	Loop,
	atomicAdd,
	atomicLoad,
	atomicStore,
	ceil,
	clamp,
	dot,
	exp,
	exp2,
	float,
	floor,
	instanceIndex,
	invocationLocalIndex,
	log2,
	max,
	min,
	mrt,
	pass,
	premultiplyAlpha,
	renderOutput,
	saturate,
	storage,
	texture3D,
	toneMapping,
	unpremultiplyAlpha,
	uint,
	uniform,
	uvec4,
	vec2,
	vec3,
	vec4,
	workgroupArray,
	workgroupBarrier
} from 'three/tsl';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import {
	CENTER_WEIGHT_MIN,
	CENTER_WEIGHT_SLOPE,
	DEFAULT_RENDER_DELTA_SECONDS,
	HISTOGRAM_BINS,
	HISTOGRAM_EXTRA_COUNTERS,
	HISTOGRAM_HIGH_PERCENTILE,
	HISTOGRAM_LOW_PERCENTILE,
	HISTOGRAM_MAX_LOG2,
	HISTOGRAM_MIN_LOG2,
	HISTOGRAM_WEIGHT_SCALE,
	INACTIVE_LOG_LUMINANCE_SENTINEL,
	KEY_CALIBRATION,
	LINEAR_SRGB_LUMINANCE_COEFFICIENTS,
	LUMINANCE_EPSILON,
	LOW_LIGHT_CUTOFF,
	LOW_LIGHT_WEIGHT,
	MAX_METER_LUMINANCE,
	MAX_EXPOSURE_EV,
	METER_HEIGHT,
	METER_SAMPLE_COUNT,
	METER_WIDTH,
	MIN_EXPOSURE_EV,
	TAU_BRIGHT_SCENE_SECONDS,
	TAU_DARK_SCENE_SECONDS,
	TIME_EPSILON_SECONDS,
	WEIGHT_EPSILON,
	WORKGROUP_SIZE
} from './constants.js';

export const EXPOSURE_PARTIAL_STRUCT = `
struct ExposurePartial {
  weightedLogSum: f32,
  weightSum: f32,
  minLogLuminance: f32,
  maxLogLuminance: f32,
}
`;

export const EXPOSURE_STATE_STRUCT = `
struct ExposureFloatState {
  keyLuminance: f32,
  targetEV: f32,
  currentEV: f32,
  invalidSeconds: f32,
}

struct ExposureUintState {
  valid: u32,
  sourceFrameIndex: u32,
  stateFrameIndex: u32,
  flags: u32,
}
`;

export const EXPOSURE_STATE_BUFFER_LAYOUT = Object.freeze( {
	floatState: 'vec4<f32>(keyLuminance, targetEV, currentEV, invalidSeconds)',
	uintState: 'uvec4<u32>(valid, sourceFrameIndex, stateFrameIndex, flags)'
} );

export const exposureReadbackPolicy = Object.freeze( {
	getArrayBufferAsync: 'read the separate float or uint ExposureState buffer only at telemetry cadence',
	byteRanges: {
		floatState: '0..16',
		uintState: '0..16'
	},
	staleTelemetry: 'mark CPU telemetry stale; never alter GPU targetEV/currentEV from readback state'
} );

function isPowerOfTwo( value ) {

	return Number.isInteger( value ) && value > 0 && ( value & ( value - 1 ) ) === 0;

}

export function assertStratifiedReductionShape( sampleCount, workgroupSize ) {

	if ( ! isPowerOfTwo( workgroupSize ) ) {

		throw new Error( 'The executable binary reduction requires an authored power-of-two workgroupSize.' );

	}

	if ( sampleCount % workgroupSize !== 0 ) {

		throw new Error( 'The executable meter requires sampleCount to be divisible by workgroupSize; it has no inactive-lane source guard.' );

	}

	const partialCount = sampleCount / workgroupSize;

	if ( partialCount > workgroupSize ) {

		throw new Error( 'The executable aggregate is one workgroup only; use the reference hierarchical algorithm for larger partial sets.' );

	}

	return { partialCount, aggregatePasses: 1 };

}

export function createExposureReductionNodes( {
	hdrTextureNode,
	meterMaskNode = null,
	meterWidth = METER_WIDTH,
	meterHeight = METER_HEIGHT,
	sampleCount = METER_SAMPLE_COUNT,
	workgroupSize = WORKGROUP_SIZE,
	partialBuffer,
	exposureFloatStateBuffer,
	exposureUintStateBuffer,
	histogramBuffer = null,
	histogramPrefixBuffer = null,
	histogramStateBuffer = null,
	useHistogram = false,
	meterRegionMin = new Vector2( 0, 0 ),
	meterRegionMax = new Vector2( 1, 1 ),
	uiExclusionMin = new Vector2( 2, 2 ),
	uiExclusionMax = new Vector2( 2, 2 ),
	deltaSeconds = DEFAULT_RENDER_DELTA_SECONDS
} ) {

	if ( sampleCount !== meterWidth * meterHeight ) {

		throw new Error( 'sampleCount must equal meterWidth * meterHeight for the stratified grid.' );

	}

	const { partialCount } = assertStratifiedReductionShape( sampleCount, workgroupSize );
	const partials = storage( partialBuffer, 'vec4', partialCount );
	const floatState = storage( exposureFloatStateBuffer, 'vec4', 1 );
	const uintState = storage( exposureUintStateBuffer, 'uvec4', 1 );
	if ( useHistogram && ( ! histogramBuffer || ! histogramPrefixBuffer || ! histogramStateBuffer ) ) {

		throw new Error( 'Histogram mode requires counter, prefix, and state storage buffers.' );

	}
	const histogramCounterCount = HISTOGRAM_BINS + HISTOGRAM_EXTRA_COUNTERS;
	const histogram = useHistogram
		? storage( histogramBuffer, 'uint', histogramCounterCount ).toAtomic()
		: null;
	const histogramPrefix = useHistogram
		? storage( histogramPrefixBuffer, 'uint', HISTOGRAM_BINS )
		: null;
	const histogramState = useHistogram
		? storage( histogramStateBuffer, 'uvec4', 2 )
		: null;
	const deltaSecondsNode = uniform( deltaSeconds, 'float' ).setName( 'exposureDeltaSeconds' );
	const meterJitterNode = uniform( new Vector2( 0.5, 0.5 ), 'vec2' ).setName( 'meterJitterWithinCell' );
	const sourceFrameIndexNode = uniform( 0, 'uint' ).setName( 'meterSourceFrameIndex' );
	const meterRegionMinNode = uniform( meterRegionMin.clone(), 'vec2' ).setName( 'meterRegionMin' );
	const meterRegionMaxNode = uniform( meterRegionMax.clone(), 'vec2' ).setName( 'meterRegionMax' );
	const uiExclusionMinNode = uniform( uiExclusionMin.clone(), 'vec2' ).setName( 'uiExclusionMin' );
	const uiExclusionMaxNode = uniform( uiExclusionMax.clone(), 'vec2' ).setName( 'uiExclusionMax' );
	const luminanceCoefficients = vec3( ...LINEAR_SRGB_LUMINANCE_COEFFICIENTS );

	const regionMaskForUv = ( sampleUv ) => {

		const insideRegion = sampleUv.x.greaterThanEqual( meterRegionMinNode.x )
			.and( sampleUv.x.lessThanEqual( meterRegionMaxNode.x ) )
			.and( sampleUv.y.greaterThanEqual( meterRegionMinNode.y ) )
			.and( sampleUv.y.lessThanEqual( meterRegionMaxNode.y ) );
		const insideUi = sampleUv.x.greaterThanEqual( uiExclusionMinNode.x )
			.and( sampleUv.x.lessThanEqual( uiExclusionMaxNode.x ) )
			.and( sampleUv.y.greaterThanEqual( uiExclusionMinNode.y ) )
			.and( sampleUv.y.lessThanEqual( uiExclusionMaxNode.y ) );
		return insideRegion.and( insideUi.not() ).select( 1, 0 );

	};

	let clearHistogram = null;
	let binHistogram = null;
	let buildHistogramPrefix = null;
	let resolveHistogramPercentiles = null;

	if ( useHistogram ) {

		clearHistogram = Fn( () => {

			atomicStore( histogram.element( instanceIndex ), uint( 0 ) );

		} )().compute( histogramCounterCount, [ Math.min( 64, histogramCounterCount ) ] );

		binHistogram = Fn( () => {

			const sampleIndex = instanceIndex;
			const cellX = sampleIndex.mod( uint( meterWidth ) );
			const cellY = sampleIndex.div( uint( meterWidth ) );
			const sampleUv = vec2(
				float( cellX ).add( meterJitterNode.x ).div( float( meterWidth ) ),
				float( cellY ).add( meterJitterNode.y ).div( float( meterHeight ) )
			);
			const hdrSample = hdrTextureNode.sample( sampleUv ).rgb;
			const textureMaskSample = meterMaskNode ? meterMaskNode.sample( sampleUv ).r : float( 1 );
			const rawMaskSample = textureMaskSample.mul( regionMaskForUv( sampleUv ) );
			const rawLuminance = dot( hdrSample, luminanceCoefficients );
			const finiteLuminance = rawLuminance.equal( rawLuminance )
				.and( rawLuminance.greaterThanEqual( 0 ) )
				.and( rawLuminance.lessThanEqual( MAX_METER_LUMINANCE ) );
			const finiteMask = rawMaskSample.equal( rawMaskSample )
				.and( rawMaskSample.greaterThanEqual( 0 ) )
				.and( rawMaskSample.lessThanEqual( 1 ) );
			const safeLuminance = max( rawLuminance, LUMINANCE_EPSILON );
			const logLuminance = log2( safeLuminance );
			const distanceFromCenter = sampleUv.sub( vec2( 0.5 ) ).length();
			const centerWeight = clamp(
				float( 1 ).sub( distanceFromCenter.mul( CENTER_WEIGHT_SLOPE ) ),
				CENTER_WEIGHT_MIN,
				1
			);
			const lowLightWeight = safeLuminance.greaterThan( LOW_LIGHT_CUTOFF ).select( 1, LOW_LIGHT_WEIGHT );
			const weight = saturate( rawMaskSample ).mul( centerWeight ).mul( lowLightWeight );
			const accepted = finiteLuminance.and( finiteMask ).and( weight.greaterThan( WEIGHT_EPSILON ) );
			const weightUnits = uint( floor( weight.mul( HISTOGRAM_WEIGHT_SCALE ).add( 0.5 ) ) );
			const normalizedLog = logLuminance.sub( HISTOGRAM_MIN_LOG2 )
				.div( HISTOGRAM_MAX_LOG2 - HISTOGRAM_MIN_LOG2 );
			const binIndex = uint( clamp( floor( normalizedLog.mul( HISTOGRAM_BINS ) ), 0, HISTOGRAM_BINS - 1 ) );

			If( accepted, () => {

				atomicAdd( histogram.element( binIndex ), weightUnits );
				If( logLuminance.lessThan( HISTOGRAM_MIN_LOG2 ), () => {

					atomicAdd( histogram.element( uint( HISTOGRAM_BINS ) ), weightUnits );

				} );
				If( logLuminance.greaterThan( HISTOGRAM_MAX_LOG2 ), () => {

					atomicAdd( histogram.element( uint( HISTOGRAM_BINS + 1 ) ), weightUnits );

				} );

			} );

		} )().compute( sampleCount, [ workgroupSize ] );

		buildHistogramPrefix = Fn( () => {

			const running = uint( 0 ).toVar( 'histogramRunningCount' );
			Loop( {
				start: uint( 0 ),
				end: uint( HISTOGRAM_BINS ),
				type: 'uint',
				condition: '<',
				name: 'histogramPrefixBin'
			}, ( { histogramPrefixBin } ) => {

				running.addAssign( atomicLoad( histogram.element( histogramPrefixBin ) ) );
				histogramPrefix.element( histogramPrefixBin ).assign( running );

			} );
			const underflow = atomicLoad( histogram.element( uint( HISTOGRAM_BINS ) ) );
			const overflow = atomicLoad( histogram.element( uint( HISTOGRAM_BINS + 1 ) ) );
			histogramState.element( uint( 0 ) ).assign( uvec4(
				running,
				uint( 0 ),
				uint( HISTOGRAM_BINS - 1 ),
				running.greaterThan( uint( 0 ) ).select( uint( 1 ), uint( 0 ) )
			) );
			histogramState.element( uint( 1 ) ).assign( uvec4(
				underflow,
				overflow,
				running,
				uint( 0 )
			) );

		} )().compute( 1, [ 1 ] );

		resolveHistogramPercentiles = Fn( () => {

			const previous = histogramState.element( uint( 0 ) );
			const total = previous.x;
			const lowRank = uint( max( ceil( float( total ).mul( HISTOGRAM_LOW_PERCENTILE ) ), 1 ) );
			const highRank = uint( max( ceil( float( total ).mul( HISTOGRAM_HIGH_PERCENTILE ) ), float( lowRank ) ) );
			const lowBin = uint( 0 ).toVar( 'histogramLowBin' );
			const highBin = uint( HISTOGRAM_BINS - 1 ).toVar( 'histogramHighBin' );
			const lowFound = uint( 0 ).toVar( 'histogramLowFound' );
			const highFound = uint( 0 ).toVar( 'histogramHighFound' );
			Loop( {
				start: uint( 0 ),
				end: uint( HISTOGRAM_BINS ),
				type: 'uint',
				condition: '<',
				name: 'histogramPercentileBin'
			}, ( { histogramPercentileBin } ) => {

				const prefixCount = histogramPrefix.element( histogramPercentileBin );
				If( lowFound.equal( uint( 0 ) ).and( prefixCount.greaterThanEqual( lowRank ) ), () => {

					lowBin.assign( histogramPercentileBin );
					lowFound.assign( uint( 1 ) );

				} );
				If( highFound.equal( uint( 0 ) ).and( prefixCount.greaterThanEqual( highRank ) ), () => {

					highBin.assign( histogramPercentileBin );
					highFound.assign( uint( 1 ) );

				} );

			} );
			histogramState.element( uint( 0 ) ).assign( uvec4(
				total,
				lowBin,
				highBin,
				lowFound.equal( uint( 1 ) ).and( highFound.equal( uint( 1 ) ) ).select( uint( 1 ), uint( 0 ) )
			) );

		} )().compute( 1, [ 1 ] );

	}

	const reduceHdrToPartials = Fn( () => {

		const sampleIndex = instanceIndex;
		const localIndex = invocationLocalIndex;
		const partialIndex = sampleIndex.div( uint( workgroupSize ) );
		const cellX = sampleIndex.mod( uint( meterWidth ) );
		const cellY = sampleIndex.div( uint( meterWidth ) );
		const sampleUv = vec2(
			float( cellX ).add( meterJitterNode.x ).div( float( meterWidth ) ),
			float( cellY ).add( meterJitterNode.y ).div( float( meterHeight ) )
		);
		const hdrSample = hdrTextureNode.sample( sampleUv ).rgb;
		const textureMaskSample = meterMaskNode ? meterMaskNode.sample( sampleUv ).r : float( 1 );
		const rawMaskSample = textureMaskSample.mul( regionMaskForUv( sampleUv ) );
		const distanceFromCenter = sampleUv.sub( vec2( 0.5 ) ).length();
		const centerWeight = clamp(
			float( 1 ).sub( distanceFromCenter.mul( CENTER_WEIGHT_SLOPE ) ),
			CENTER_WEIGHT_MIN,
			1
		);
		const rawLuminance = dot( hdrSample, luminanceCoefficients );
		const finiteLuminance = rawLuminance.equal( rawLuminance )
			.and( rawLuminance.greaterThanEqual( 0 ) )
			.and( rawLuminance.lessThanEqual( MAX_METER_LUMINANCE ) );
		const finiteMask = rawMaskSample.equal( rawMaskSample )
			.and( rawMaskSample.greaterThanEqual( 0 ) )
			.and( rawMaskSample.lessThanEqual( 1 ) );
		const luminance = float( LUMINANCE_EPSILON ).toVar( 'finiteMeterLuminance' );
		const maskSample = float( 0 ).toVar( 'finiteMeterMask' );
		If( finiteLuminance, () => luminance.assign( max( rawLuminance, LUMINANCE_EPSILON ) ) );
		If( finiteMask, () => maskSample.assign( rawMaskSample ) );
		const logLuminance = log2( luminance );
		const lowLightWeight = luminance.greaterThan( LOW_LIGHT_CUTOFF ).select( 1, LOW_LIGHT_WEIGHT );
		const weight = saturate( maskSample ).mul( centerWeight ).mul( lowLightWeight );
		let accepted = finiteLuminance.and( finiteMask ).and( weight.greaterThan( WEIGHT_EPSILON ) );
		if ( useHistogram ) {

			const range = histogramState.element( uint( 0 ) );
			const normalizedLog = logLuminance.sub( HISTOGRAM_MIN_LOG2 )
				.div( HISTOGRAM_MAX_LOG2 - HISTOGRAM_MIN_LOG2 );
			const binIndex = uint( clamp( floor( normalizedLog.mul( HISTOGRAM_BINS ) ), 0, HISTOGRAM_BINS - 1 ) );
			accepted = accepted.and( binIndex.greaterThanEqual( range.y ) ).and( binIndex.lessThanEqual( range.z ) );

		}
		const acceptedWeight = accepted.select( weight, float( 0 ) );
		const localPartials = workgroupArray( 'vec4', workgroupSize );

		localPartials.element( localIndex ).assign( vec4(
			logLuminance.mul( acceptedWeight ),
			acceptedWeight,
			accepted.select( logLuminance, INACTIVE_LOG_LUMINANCE_SENTINEL ),
			accepted.select( logLuminance, - INACTIVE_LOG_LUMINANCE_SENTINEL )
		) );
		workgroupBarrier();

		Loop( { start: uint( workgroupSize / 2 ), end: uint( 0 ), type: 'uint', condition: '>', update: '>>= 1', name: 'stride' }, ( { stride } ) => {

			If( localIndex.lessThan( stride ), () => {

				const a = localPartials.element( localIndex );
				const b = localPartials.element( localIndex.add( stride ) );
				a.assign( vec4(
					a.x.add( b.x ),
					a.y.add( b.y ),
					min( a.z, b.z ),
					max( a.w, b.w )
				) );

			} );
			workgroupBarrier();

		} );

		If( localIndex.equal( uint( 0 ) ), () => {

			partials.element( partialIndex ).assign( localPartials.element( uint( 0 ) ) );

		} );

	} )().compute( sampleCount, [ workgroupSize ] );

	const reducePartialsToAggregate = Fn( () => {

		const reduceIndex = instanceIndex;
		const localIndex = invocationLocalIndex;
		const localPartials = workgroupArray( 'vec4', workgroupSize );
		// Use control flow rather than select(): WGSL select evaluates both value
		// operands, which would still form an out-of-range storage-buffer read for
		// inactive lanes when partialCount < workgroupSize.
		const sample = vec4(
			0,
			0,
			INACTIVE_LOG_LUMINANCE_SENTINEL,
			- INACTIVE_LOG_LUMINANCE_SENTINEL
		).toVar( 'aggregatePartialSample' );
		If( reduceIndex.lessThan( uint( partialCount ) ), () => {

			sample.assign( partials.element( reduceIndex ) );

		} );

		localPartials.element( localIndex ).assign( sample );
		workgroupBarrier();

		Loop( { start: uint( workgroupSize / 2 ), end: uint( 0 ), type: 'uint', condition: '>', update: '>>= 1', name: 'stride' }, ( { stride } ) => {

			If( localIndex.lessThan( stride ), () => {

				const a = localPartials.element( localIndex );
				const b = localPartials.element( localIndex.add( stride ) );
				a.assign( vec4(
					a.x.add( b.x ),
					a.y.add( b.y ),
					min( a.z, b.z ),
					max( a.w, b.w )
				) );

			} );
			workgroupBarrier();

		} );

		If( localIndex.equal( uint( 0 ) ), () => {

			partials.element( uint( 0 ) ).assign( localPartials.element( uint( 0 ) ) );

		} );

	} )().compute( workgroupSize, [ workgroupSize ] );

	const resolveMeterTarget = Fn( () => {

		const aggregate = partials.element( uint( 0 ) );
		const previousFloat = floatState.element( uint( 0 ) );
		const previousUint = uintState.element( uint( 0 ) );
		const valid = aggregate.y.greaterThan( WEIGHT_EPSILON );
		const keyLuminance = exp2( aggregate.x.div( max( aggregate.y, WEIGHT_EPSILON ) ) );
		const targetEv = clamp(
			log2( float( KEY_CALIBRATION ).div( max( keyLuminance, LUMINANCE_EPSILON ) ) ),
			MIN_EXPOSURE_EV,
			MAX_EXPOSURE_EV
		);

		floatState.element( uint( 0 ) ).assign( vec4(
			valid.select( keyLuminance, previousFloat.x ),
			valid.select( targetEv, previousFloat.y ),
			previousFloat.z,
			previousFloat.w
		) );
		uintState.element( uint( 0 ) ).assign( uvec4(
			valid.select( uint( 1 ), uint( 0 ) ),
			sourceFrameIndexNode,
			previousUint.z,
			previousUint.w
		) );

	} )().compute( 1, [ 1 ] );

	const adaptExposureState = Fn( () => {

		const previousFloat = floatState.element( uint( 0 ) );
		const previousUint = uintState.element( uint( 0 ) );
		const targetEv = previousFloat.y;
		const currentEv = previousFloat.z;
		const tau = targetEv.lessThan( currentEv )
			.select( TAU_BRIGHT_SCENE_SECONDS, TAU_DARK_SCENE_SECONDS );
		const safeDeltaSeconds = max( deltaSecondsNode, 0 );
		const alpha = float( 1 ).sub(
			exp( safeDeltaSeconds.div( max( tau, TIME_EPSILON_SECONDS ) ).negate() )
		);
		const adaptedEv = currentEv.add( targetEv.sub( currentEv ).mul( alpha ) );
		const valid = previousUint.x.equal( uint( 1 ) );
		const invalidSeconds = valid.select( float( 0 ), previousFloat.w.add( safeDeltaSeconds ) );

		floatState.element( uint( 0 ) ).assign( vec4(
			previousFloat.x,
			targetEv,
			adaptedEv,
			invalidSeconds
		) );
		uintState.element( uint( 0 ) ).assign( uvec4(
			previousUint.x,
			previousUint.y,
			previousUint.z.add( uint( 1 ) ),
			previousUint.w
		) );

	} )().compute( 1, [ 1 ] );

	return {
		structs: [ EXPOSURE_PARTIAL_STRUCT, EXPOSURE_STATE_STRUCT ],
		layout: EXPOSURE_STATE_BUFFER_LAYOUT,
		partials,
		state: { floatState, uintState },
		floatState,
		uintState,
		histogram,
		histogramPrefix,
		histogramState,
		clearHistogram,
		binHistogram,
		buildHistogramPrefix,
		resolveHistogramPercentiles,
		reduceHdrToPartials,
		reducePartialsToAggregate,
		resolveMeterTarget,
		adaptExposureState,
		deltaSecondsNode,
		meterJitterNode,
		sourceFrameIndexNode,
		meterRegionMinNode,
		meterRegionMaxNode,
		uiExclusionMinNode,
		uiExclusionMaxNode,
		meterDispatchOrder: useHistogram
			? [ 'clearHistogram', 'binHistogram', 'buildHistogramPrefix', 'resolveHistogramPercentiles', 'reduceHdrToPartials', 'reducePartialsToAggregate', 'resolveMeterTarget' ]
			: [ 'reduceHdrToPartials', 'reducePartialsToAggregate', 'resolveMeterTarget' ]
	};

}

export function createExposureOutputGraph( {
	hdrColor,
	lutTexture,
	lutSize,
	lutIntensity = float( 1 ),
	mapping,
	outputColorSpace,
	exposureState
} ) {

	const currentExposureEv = exposureState.floatState.element( uint( 0 ) ).z;
	const adaptedExposure = exp2( currentExposureEv );
	// Tone maps and LUTs are nonlinear. Work in straight RGB, then repremultiply
	// before RenderOutputNode performs its own output-domain alpha cycle.
	const straightHdr = unpremultiplyAlpha( hdrColor );
	const exposedStraightHdr = vec4(
		straightHdr.rgb.mul( adaptedExposure ),
		straightHdr.a
	);
	const postToneMapLinear = toneMapping( mapping, 1, exposedStraightHdr );
	const gradedStraight = lut3D(
		vec4( saturate( postToneMapLinear.rgb ), hdrColor.a.clamp( 0, 1 ) ),
		texture3D( lutTexture ),
		lutSize,
		lutIntensity
	);
	const finalOutputNode = renderOutput(
		premultiplyAlpha( gradedStraight ),
		NoToneMapping,
		outputColorSpace
	);
	return {
		straightHdr,
		exposedStraightHdr,
		postToneMapLinear,
		gradedStraight,
		finalOutputNode
	};

}

export function createExposureOutputNode( options ) {

	return createExposureOutputGraph( options ).finalOutputNode;

}

export const apiSkeletonImports = Object.freeze( {
	Fn,
	atomicAdd,
	atomicLoad,
	atomicStore,
	exp2,
	log2,
	mrt,
	pass,
	premultiplyAlpha,
	renderOutput,
	storage,
	texture3D,
	toneMapping,
	unpremultiplyAlpha,
	instanceIndex,
	invocationLocalIndex,
	workgroupArray,
	workgroupBarrier,
	lut3D
} );
