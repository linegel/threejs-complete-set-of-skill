import { readFileSync } from 'node:fs';
import {
	DataTexture,
	FloatType,
	RGBAFormat,
	StorageBufferAttribute
} from 'three/webgpu';
import { texture } from 'three/tsl';

import {
	EXPOSURE_EXAMPLE_CONTRACT,
	EXPOSURE_PARTIAL_FLOATS,
	EXPOSURE_STATE_FLOATS,
	EXPOSURE_STATE_UINTS,
	HISTOGRAM_BINS,
	HISTOGRAM_MAX_WEIGHT_SUM,
	HISTOGRAM_WEIGHT_SCALE,
	KEY_CALIBRATION,
	MAX_EXPOSURE_EV,
	METER_HEIGHT,
	METER_SAMPLE_COUNT,
	METER_WIDTH,
	MIN_EXPOSURE_EV,
	NUMERIC_PROVENANCE,
	TAU_BRIGHT_SCENE_SECONDS,
	TAU_DARK_SCENE_SECONDS,
	WORKGROUP_SIZE,
	adaptExposureEv,
	dispatchCount,
	estimateExposureStorageBytes,
	exposureMultiplierFromEv,
	exposureTargetEvForKey,
	histogramBinForLuminance,
	histogramPercentileWindow,
	holdLastValidTelemetry,
	percentileClippedWeightedLogAverage,
	reducePassCount,
	stratifiedJitterForMeterUpdate,
	weightedLogAverage
} from './constants.js';
import {
	EXPOSURE_DEBUG_VIEWS,
	createCheckpointList,
	createDebugViewRegistry
} from './debug-views.js';
import {
	EXPOSURE_PARTIAL_STRUCT,
	EXPOSURE_STATE_BUFFER_LAYOUT,
	EXPOSURE_STATE_STRUCT,
	apiSkeletonImports,
	assertStratifiedReductionShape,
	createExposureReductionNodes,
	exposureReadbackPolicy
} from './exposure-nodes.js';
import { createExposureColorPipeline } from './main.js';
import {
	DEFAULT_LUT_SIZE,
	LUT_NUMERIC_PROVENANCE,
	MAX_EXAMPLE_LUT_SIZE,
	assertExampleLutSize,
	createIdentityLutData,
	sampleIdentityLutTrilinear
} from './lut.js';

const EXAMPLE_ROOT = new URL( './', import.meta.url );

function assert( condition, message ) {

	if ( ! condition ) throw new Error( message );

}

function readExampleSource( path ) {

	return readFileSync( new URL( path, EXAMPLE_ROOT ), 'utf8' );

}

function expectRejects( callback, message ) {

	try {

		callback();

	} catch ( error ) {

		return error.message;

	}

	throw new Error( message );

}

function near( actual, expected, tolerance, message ) {

	assert( Math.abs( actual - expected ) <= tolerance, `${ message }: expected ${ expected }, got ${ actual }.` );

}

function createValidationTextureNode() {

	// [Authored fixture] One scene-linear key-colored texel.
	const data = new Float32Array( [ KEY_CALIBRATION, KEY_CALIBRATION, KEY_CALIBRATION, 1 ] );
	const map = new DataTexture( data, 1, 1, RGBAFormat, FloatType );
	map.needsUpdate = true;
	return texture( map );

}

function validateClaimBoundary() {

	assert(
		EXPOSURE_EXAMPLE_CONTRACT.runtimeMeter === 'stratified weighted-log or percentile-clipped weighted-log',
		'Runtime meter must identify both implemented sampled estimators.'
	);
	assert( EXPOSURE_EXAMPLE_CONTRACT.adaptationDomain === 'EV/log2', 'Runtime adaptation must identify EV/log2 state.' );
	assert(
		EXPOSURE_EXAMPLE_CONTRACT.exactFullPixelReduction.includes( 'not selected by the checked-in tiers' )
		&& EXPOSURE_EXAMPLE_CONTRACT.exactFullPixelReduction.includes( 'declared stratified sample set' ),
		'Example must distinguish its sampled estimators from an exact full-pixel reduction.'
	);
	assert( EXPOSURE_EXAMPLE_CONTRACT.luminancePyramid === 'not-implemented', 'Example must not claim a luminance pyramid.' );
	for ( const stage of [ 'implemented', 'clear', 'sampled fixed-point weighted global-atomic bins', 'weighted prefix/percentile bounds', 'clipped floating-weight reduction' ] ) {

		assert( EXPOSURE_EXAMPLE_CONTRACT.histogram.includes( stage ), `Histogram contract must identify the ${ stage } stage.` );

	}
	assert( EXPOSURE_EXAMPLE_CONTRACT.temporalMeterSource.includes( 'not-implemented' ), 'Example must not claim a temporal meter source.' );

	return EXPOSURE_EXAMPLE_CONTRACT;

}

function validateNumericProvenance() {

	const requiredAuthored = [
		'METER_WIDTH',
		'METER_HEIGHT',
		'WORKGROUP_SIZE',
		'METER_CADENCE_HZ',
		'KEY_CALIBRATION',
		'MIN_EXPOSURE_EV',
		'MAX_EXPOSURE_EV',
		'TAU_BRIGHT_SCENE_SECONDS',
		'TAU_DARK_SCENE_SECONDS',
		'MAX_ADAPTATION_DELTA_SECONDS',
		'DEFAULT_RENDER_DELTA_SECONDS',
		'HISTOGRAM_BINS'
	];

	for ( const name of requiredAuthored ) {

		assert( NUMERIC_PROVENANCE[ name ]?.startsWith( 'Authored' ), `Numeric provenance missing Authored classification for ${ name }.` );

	}

	assert( NUMERIC_PROVENANCE.EXPOSURE_PARTIAL_FLOATS.startsWith( 'Derived' ), 'Partial layout must be Derived.' );
	assert( NUMERIC_PROVENANCE.METER_SAMPLE_COUNT.startsWith( 'Derived' ), 'Meter sample count must be Derived.' );
	assert( NUMERIC_PROVENANCE.HISTOGRAM_BINS.includes( 'sampled global-atomic histogram' ), 'Histogram-bin provenance must describe the executable sampled histogram.' );
	assert( NUMERIC_PROVENANCE.HISTOGRAM_MIN_LOG2.includes( 'runtime histogram' ), 'Histogram lower-bound provenance must describe the executable window.' );
	assert( NUMERIC_PROVENANCE.HISTOGRAM_MAX_LOG2.includes( 'runtime histogram' ), 'Histogram upper-bound provenance must describe the executable window.' );
	assert( NUMERIC_PROVENANCE.INACTIVE_LOG_LUMINANCE_SENTINEL.startsWith( 'Derived' ), 'Inactive-lane sentinel must be Derived.' );
	assert( NUMERIC_PROVENANCE.LINEAR_SRGB_LUMINANCE_COEFFICIENTS.startsWith( 'Derived' ), 'Luminance coefficients must be Derived.' );
	assert( LUT_NUMERIC_PROVENANCE.DEFAULT_LUT_SIZE.startsWith( 'Authored' ), 'LUT size must be Authored.' );
	assert( LUT_NUMERIC_PROVENANCE.MAX_EXAMPLE_LUT_SIZE.startsWith( 'Authored' ), 'Example LUT allocation guard must be Authored.' );

	return { requiredAuthored, lutSize: DEFAULT_LUT_SIZE };

}

function validateKeyCalibration() {

	const targetEv = exposureTargetEvForKey( KEY_CALIBRATION );
	near( targetEv, 0, Number.EPSILON, 'Authored key should converge to target EV zero' );
	near( exposureMultiplierFromEv( targetEv ), 1, Number.EPSILON, 'Target EV zero should produce exposure multiplier one' );
	return { targetEv, exposureMultiplier: exposureMultiplierFromEv( targetEv ) };

}

function validateAsymmetricEvAdaptation() {

	// [Authored fixture] Equal stop distances isolate the two time constants.
	const currentEv = 0;
	const brightSceneTargetEv = - 2;
	const darkSceneTargetEv = 2;
	const deltaSeconds = 0.25;
	const towardBrightScene = adaptExposureEv( currentEv, brightSceneTargetEv, deltaSeconds );
	const towardDarkScene = adaptExposureEv( currentEv, darkSceneTargetEv, deltaSeconds );

	assert( towardBrightScene < currentEv && towardBrightScene > brightSceneTargetEv, 'Bright-scene adaptation must be monotonic.' );
	assert( towardDarkScene > currentEv && towardDarkScene < darkSceneTargetEv, 'Dark-scene adaptation must be monotonic.' );
	assert( Math.abs( towardBrightScene ) > Math.abs( towardDarkScene ), 'Authored bright-scene time constant must reduce exposure faster.' );
	assert( TAU_BRIGHT_SCENE_SECONDS < TAU_DARK_SCENE_SECONDS, 'Asymmetric time-constant names/direction are inconsistent.' );

	return { towardBrightScene, towardDarkScene };

}

function validateFailedReadbackIsolation() {

	const previous = {
		keyLuminance: 0.22,
		targetEv: - 0.3,
		currentEv: - 0.2,
		invalidSeconds: 0.1,
		valid: true
	};
	const next = holdLastValidTelemetry( previous, { valid: false, deltaSeconds: 0.2 } );

	near( next.keyLuminance, previous.keyLuminance, Number.EPSILON, 'Failed readback must hold key luminance' );
	near( next.targetEv, previous.targetEv, Number.EPSILON, 'Failed readback must hold target EV' );
	near( next.currentEv, previous.currentEv, Number.EPSILON, 'Failed readback must not alter GPU-current EV mirror' );
	assert( next.valid === false && next.invalidSeconds > previous.invalidSeconds, 'Failed readback should mark CPU telemetry stale.' );

	return next;

}

function validateIdentityLut() {

	const size = DEFAULT_LUT_SIZE;
	const data = createIdentityLutData( size );
	// [Authored fixture] Deliberately off-grid to exercise trilinear interpolation.
	const sample = [ 0.237, 0.553, 0.907 ];
	const output = sampleIdentityLutTrilinear( data, size, sample );
	const tolerance = 1 / 255; // [Derived] Conservative RGBA8 code-step bound.

	for ( let index = 0; index < sample.length; index += 1 ) {

		near( output[ index ], sample[ index ], tolerance, `Identity LUT channel ${ index }` );

	}
	for ( const invalidSize of [ 1, 1.5, MAX_EXAMPLE_LUT_SIZE + 1 ] ) {

		expectRejects( () => assertExampleLutSize( invalidSize ), `Invalid LUT size ${ invalidSize } passed.` );

	}

	return { size, sample, output, tolerance };

}

function validateOutputOwnership( config ) {

	if ( config.outputTransformOwner === 'renderOutput' && config.outputColorTransform !== false ) {

		throw new Error( 'RenderPipeline.outputColorTransform must be false when renderOutput owns conversion.' );

	}

	if ( config.rendererToneMappingExposure !== 1 || config.dynamicExposureOwner !== 'ExposureFloatState.currentEV' ) {

		throw new Error( 'Dynamic exposure must have one EV owner and neutral renderer calibration.' );

	}

	return true;

}

function validateUiExclusionMask() {

	const samples = [
		{ luminance: KEY_CALIBRATION, sceneMask: 1, uiMask: 1, skyMask: 1, centerWeight: 1 },
		{ luminance: 8, sceneMask: 1, uiMask: 0, skyMask: 1, centerWeight: 1 }
	];
	const average = weightedLogAverage( samples );
	near( average, KEY_CALIBRATION, Number.EPSILON, 'UI overlay must not affect metered luminance' );
	return { average };

}

function validateReductionShapeAndStorage() {

	const weightedLogStorage = estimateExposureStorageBytes( METER_SAMPLE_COUNT );
	const histogramStorage = estimateExposureStorageBytes( METER_SAMPLE_COUNT, { includeHistogram: true } );
	const groups = dispatchCount( METER_SAMPLE_COUNT, WORKGROUP_SIZE );
	const shape = assertStratifiedReductionShape( METER_SAMPLE_COUNT, WORKGROUP_SIZE );

	assert( METER_SAMPLE_COUNT === METER_WIDTH * METER_HEIGHT, 'Meter sample count must be derived from grid dimensions.' );
	assert( weightedLogStorage.partialCount === groups, 'Storage partial count must match dispatchCount.' );
	assert( shape.partialCount === groups, 'Executable reduction shape must match storage.' );
	assert( reducePassCount( groups, WORKGROUP_SIZE ) === 1, 'Authored grid should fit the single aggregate workgroup.' );
	assert(
		weightedLogStorage.totalBytes === weightedLogStorage.partialsBytes + weightedLogStorage.stateBytes,
		'Weighted-log mode must not allocate histogram storage.'
	);
	assert(
		histogramStorage.histogramBytes > 0
		&& histogramStorage.histogramPrefixBytes > 0
		&& histogramStorage.histogramStateBytes > 0,
		'Histogram mode must allocate counter, prefix, and percentile-state storage.'
	);
	assert(
		histogramStorage.totalBytes === histogramStorage.partialsBytes
			+ histogramStorage.stateBytes
			+ histogramStorage.histogramBytes
			+ histogramStorage.histogramPrefixBytes
			+ histogramStorage.histogramStateBytes,
		'Histogram storage total must equal every declared buffer contribution.'
	);

	const invalidShapes = [
		expectRejects(
			() => assertStratifiedReductionShape( METER_SAMPLE_COUNT + 1, WORKGROUP_SIZE ),
			'Non-divisible sample count unexpectedly passed.'
		),
		expectRejects(
			() => assertStratifiedReductionShape( METER_SAMPLE_COUNT, WORKGROUP_SIZE - 1 ),
			'Non-power-of-two workgroup unexpectedly passed.'
		)
	];

	return { weightedLogStorage, histogramStorage, invalidShapes };

}

function validateOfflineHistogramBoundary() {

	for ( const luminance of [ 0, 0.0001, KEY_CALIBRATION, 1, 1000 ] ) {

		const bin = histogramBinForLuminance( luminance );
		assert( bin >= 0 && bin < HISTOGRAM_BINS, `Offline histogram bin out of bounds for ${ luminance }.` );

	}

	return { status: EXPOSURE_EXAMPLE_CONTRACT.histogram, bins: HISTOGRAM_BINS };

}

function validateWeightedHistogramOracle() {

	const samples = Array.from( { length: 128 }, ( _, index ) => ( {
		luminance: index === 127 ? 64 : KEY_CALIBRATION,
		sceneMask: 1,
		uiMask: 1,
		skyMask: 1,
		centerWeight: index === 127 ? 0.01 : 1
	} ) );
	const result = percentileClippedWeightedLogAverage( samples );
	near( result.keyLuminance, KEY_CALIBRATION, 1e-6, 'Weighted percentile meter should reject the low-weight highlight outlier' );
	const weights = [ 1, 0.25, 0.5 ];
	const window = histogramPercentileWindow( [ KEY_CALIBRATION, 1, 2 ], { weights } );
	const expectedTotal = weights.reduce( ( sum, weight ) => sum + Math.round( weight * HISTOGRAM_WEIGHT_SCALE ), 0 );
	assert( window.total === expectedTotal, 'CPU histogram total must use the same fixed-point weights as the GPU path.' );
	assert( HISTOGRAM_MAX_WEIGHT_SUM < 0x100000000, 'Fixed-point histogram lacks a u32 overflow proof.' );
	return {
		keyLuminance: result.keyLuminance,
		lowBin: result.window.lowBin,
		highBin: result.window.highBin,
		weightedTotal: window.total,
		weightScale: HISTOGRAM_WEIGHT_SCALE,
		maxWeightSum: HISTOGRAM_MAX_WEIGHT_SUM
	};

}

function validateStratifiedJitter() {

	const samples = [ 0, 1, 2, 3, 4, 5, 6, 7 ].map( stratifiedJitterForMeterUpdate );

	for ( const jitter of samples ) {

		assert( jitter.every( ( value ) => value >= 0 && value < 1 ), 'Stratified jitter escaped its meter cell.' );

	}

	assert( new Set( samples.map( ( value ) => value.join( ',' ) ) ).size === samples.length, 'Jitter sequence repeated in the validation prefix.' );
	assert( samples.some( ( value ) => value[ 0 ] < 0.5 ) && samples.some( ( value ) => value[ 0 ] >= 0.5 ), 'Meter-update jitter prefix aliases one horizontal half-cell.' );
	return samples;

}

function validateClampRange() {

	near( exposureTargetEvForKey( 1e9 ), MIN_EXPOSURE_EV, Number.EPSILON, 'Bright source should clamp to minimum EV' );
	near( exposureTargetEvForKey( 1e-12 ), MAX_EXPOSURE_EV, Number.EPSILON, 'Dark source should clamp to maximum EV' );
	return { minEv: MIN_EXPOSURE_EV, maxEv: MAX_EXPOSURE_EV };

}

function validateApiSkeletonImports() {

	const required = [
		'Fn',
		'exp2',
		'log2',
		'mrt',
		'pass',
		'premultiplyAlpha',
		'renderOutput',
		'storage',
		'texture3D',
		'toneMapping',
		'unpremultiplyAlpha',
		'workgroupArray',
		'workgroupBarrier',
		'lut3D'
	];

	for ( const name of required ) assert( apiSkeletonImports[ name ], `Missing API skeleton import: ${ name }.` );
	assert( typeof createExposureColorPipeline === 'function', 'main.js must export createExposureColorPipeline().' );
	return { required };

}

function validateExposureStructContracts() {

	const partialFields = [ 'weightedLogSum', 'weightSum', 'minLogLuminance', 'maxLogLuminance' ];
	const floatFields = [ 'keyLuminance', 'targetEV', 'currentEV', 'invalidSeconds' ];
	const uintFields = [ 'valid', 'sourceFrameIndex', 'stateFrameIndex', 'flags' ];

	for ( const field of [ ...partialFields, ...floatFields, ...uintFields ] ) {

		assert( `${ EXPOSURE_PARTIAL_STRUCT }${ EXPOSURE_STATE_STRUCT }`.includes( `${ field }:` ), `Exposure structs are missing ${ field }.` );

	}

	assert( partialFields.length === EXPOSURE_PARTIAL_FLOATS, 'Partial float count is inconsistent.' );
	assert( floatFields.length === EXPOSURE_STATE_FLOATS, 'Float state count is inconsistent.' );
	assert( uintFields.length === EXPOSURE_STATE_UINTS, 'Uint state count is inconsistent.' );
	assert( EXPOSURE_STATE_BUFFER_LAYOUT.floatState.includes( 'targetEV, currentEV' ), 'Float layout must expose EV state.' );
	assert( EXPOSURE_STATE_BUFFER_LAYOUT.uintState.includes( 'sourceFrameIndex, stateFrameIndex' ), 'Uint layout must expose scheduling evidence.' );

	return { partialFields, floatFields, uintFields };

}

function validateReadbackPolicy() {

	assert( exposureReadbackPolicy.byteRanges.floatState === '0..16', 'Float readback range must match its separate vec4 buffer.' );
	assert( exposureReadbackPolicy.byteRanges.uintState === '0..16', 'Uint readback range must match its separate uvec4 buffer.' );
	assert( exposureReadbackPolicy.staleTelemetry.includes( 'never alter GPU' ), 'Readback policy must isolate GPU exposure state.' );
	return exposureReadbackPolicy;

}

function validateReductionNodeConstruction() {

	const storage = estimateExposureStorageBytes( METER_SAMPLE_COUNT );
	const histogramStorage = estimateExposureStorageBytes( METER_SAMPLE_COUNT, { includeHistogram: true } );
	const hdrTextureNode = createValidationTextureNode();
	const meterMaskNode = createValidationTextureNode();
	const exposureFloatStateBuffer = new StorageBufferAttribute( 1, 4, Float32Array );
	const exposureUintStateBuffer = new StorageBufferAttribute( 1, 4, Uint32Array );
	const nodes = createExposureReductionNodes( {
		hdrTextureNode,
		meterMaskNode,
		sampleCount: METER_SAMPLE_COUNT,
		workgroupSize: WORKGROUP_SIZE,
		partialBuffer: new StorageBufferAttribute( storage.partialCount, 4, Float32Array ),
		exposureFloatStateBuffer,
		exposureUintStateBuffer
	} );

	assert( nodes.structs.length === 2, 'Reduction node contract must expose partial and state structs.' );
	assert( nodes.partials && nodes.floatState && nodes.uintState, 'Reduction node contract must expose typed storage nodes.' );
	assert( nodes.histogram === null && nodes.histogramPrefix === null && nodes.histogramState === null, 'Weighted-log mode must leave histogram nodes unbound.' );
	assert( nodes.resolveMeterTarget && nodes.adaptExposureState, 'Target resolve and per-frame EV adaptation must be separate nodes.' );
	assert( exposureFloatStateBuffer.array instanceof Float32Array, 'Float state must use Float32Array storage.' );
	assert( exposureUintStateBuffer.array instanceof Uint32Array, 'Uint state must use Uint32Array storage.' );

	const histogramStateRecords = histogramStorage.histogramStateBytes
		/ ( EXPOSURE_STATE_UINTS * Uint32Array.BYTES_PER_ELEMENT );
	assert( Number.isInteger( histogramStateRecords ) && histogramStateRecords > 0, 'Histogram-state byte count must define whole uvec4 records.' );
	const histogramNodes = createExposureReductionNodes( {
		hdrTextureNode,
		meterMaskNode,
		sampleCount: METER_SAMPLE_COUNT,
		workgroupSize: WORKGROUP_SIZE,
		partialBuffer: new StorageBufferAttribute( histogramStorage.partialCount, 4, Float32Array ),
		exposureFloatStateBuffer: new StorageBufferAttribute( 1, 4, Float32Array ),
		exposureUintStateBuffer: new StorageBufferAttribute( 1, 4, Uint32Array ),
		histogramBuffer: new StorageBufferAttribute( histogramStorage.histogramCounterCount, 1, Uint32Array ),
		histogramPrefixBuffer: new StorageBufferAttribute( HISTOGRAM_BINS, 1, Uint32Array ),
		histogramStateBuffer: new StorageBufferAttribute( histogramStateRecords, 4, Uint32Array ),
		useHistogram: true
	} );
	const expectedHistogramDispatchOrder = [
		'clearHistogram',
		'binHistogram',
		'buildHistogramPrefix',
		'resolveHistogramPercentiles',
		'reduceHdrToPartials',
		'reducePartialsToAggregate',
		'resolveMeterTarget'
	];
	assert( histogramNodes.histogram && histogramNodes.histogramPrefix && histogramNodes.histogramState, 'Histogram mode must expose all three storage-node classes.' );
	for ( const stage of expectedHistogramDispatchOrder ) assert( histogramNodes[ stage ], `Histogram node graph is missing ${ stage }.` );
	assert(
		JSON.stringify( histogramNodes.meterDispatchOrder ) === JSON.stringify( expectedHistogramDispatchOrder ),
		'Histogram dispatch order must clear, bin, scan, resolve bounds, then perform the clipped weighted-log reduction.'
	);

	return {
		structs: nodes.structs.length,
		hasStorageNodes: true,
		hasComputeNodes: true,
		histogramDispatchOrder: histogramNodes.meterDispatchOrder,
		floatStateType: exposureFloatStateBuffer.array.constructor.name,
		uintStateType: exposureUintStateBuffer.array.constructor.name
	};

}

function assertSourceContracts() {

	const nodeSource = readExampleSource( 'exposure-nodes.js' );
	const mainSource = readExampleSource( 'main.js' );
	const readmeSource = readExampleSource( 'README.md' );
	const normalizedReadmeSource = readmeSource.replace( /\s+/g, ' ' );
	const referenceSource = readFileSync( new URL( '../../references/scene-referred-color-pipeline.md', EXAMPLE_ROOT ), 'utf8' );

	const requiredNodeTokens = [
		'log2( luminance )',
		'exp2( aggregate.x.div',
		'resolveMeterTarget',
		'adaptExposureState',
		'currentExposureEv',
		'exp2( currentExposureEv )',
		"workgroupArray( 'vec4', workgroupSize )",
		'assertStratifiedReductionShape'
	];

	for ( const token of requiredNodeTokens ) assert( nodeSource.includes( token ), `Node source missing ${ token }.` );
	for ( const token of [
		'atomicStore( histogram.element',
		'atomicAdd( histogram.element',
		'histogramPrefix.element',
		'resolveHistogramPercentiles',
		'accepted = accepted.and( binIndex.greaterThanEqual'
	] ) assert( nodeSource.includes( token ), `Histogram source missing ${ token }.` );
	assert( ! nodeSource.includes( 'currentExposure = exposureState.floatState.element( 0 ).z' ), 'Runtime source still treats state.z as linear exposure.' );
	assert( nodeSource.includes( "toVar( 'aggregatePartialSample' )" ), 'Aggregate reduction must not form inactive-lane out-of-bounds storage reads through select().' );
	assert( nodeSource.includes( 'unpremultiplyAlpha( hdrColor )' ), 'Nonlinear exposure/tone/LUT operations must receive straight RGB.' );
	assert( nodeSource.includes( 'premultiplyAlpha( gradedStraight )' ), 'The graded straight color must be premultiplied before renderOutput().' );
	assert( nodeSource.includes( 'straightHdr.rgb.mul( adaptedExposure )' ), 'Exposure must operate on RGB without changing alpha.' );
	assert( nodeSource.includes( 'const acceptedWeight = accepted.select( weight, float( 0 ) )' ), 'Rejected percentile samples still contribute to weighted sums.' );
	assert( nodeSource.includes( 'weight.mul( HISTOGRAM_WEIGHT_SCALE )' ), 'Histogram bins are not weighted with the declared fixed-point policy.' );
	assert( mainSource.includes( 'renderer.compute( meterDispatches )' ), 'Metered frames should submit the selected ordered compute nodes as one r185 compute group.' );
	assert( mainSource.includes( 'renderer.compute( exposureNodes.adaptExposureState )' ), 'Every rendered frame must adapt EV.' );
	assert( mainSource.includes( 'const withMeterSourceDependency = ( node ) => node.add( hdrColor.mul( float( 0 ) ) )' ), 'Storage-only diagnostics do not force the meter-source scene pass to execute.' );
	assert( mainSource.includes( 'histogram: withMeterSourceDependency( histogramDisplay )' ) && mainSource.includes( "'meter-mask': withMeterSourceDependency( meterMaskDisplay )" ), 'Storage-only diagnostic routes do not retain the validated scene dependency.' );
	assert( ! mainSource.includes( 'bypass( histogramDisplay, hdrColor )' ), 'BypassNode emits an invalid bare WGSL uniform when its callNode is a texture node in r185.' );
	assert(
		mainSource.indexOf( 'renderer.compute( exposureNodes.adaptExposureState )' ) < mainSource.indexOf( 'renderPipeline.render()' )
		&& mainSource.indexOf( 'renderPipeline.render()' ) < mainSource.indexOf( 'renderer.compute( meterDispatches )' ),
		'Runtime scheduling must adapt, render the meter source, then reduce it for a later target.'
	);
	for ( const token of [
		'exposureNodes.clearHistogram',
		'exposureNodes.binHistogram',
		'exposureNodes.buildHistogramPrefix',
		'exposureNodes.resolveHistogramPercentiles',
		'exposureNodes.reduceHdrToPartials'
	] ) assert( mainSource.includes( token ), `Runtime histogram schedule is missing ${ token }.` );
	assert( mainSource.includes( 'stratifiedJitterForMeterUpdate' ), 'Runtime meter must advance jitter by meter updates, not render-frame cadence.' );
	assert( mainSource.includes( 'meterUpdateIndex += 1' ), 'Runtime must own a dedicated meter-update sequence index.' );
	assert( mainSource.includes( 'maskedUiPanel.visible = scenario === \'masked-ui\'' ) && mainSource.includes( 'function resetMeterState( cause )' ), 'Meter-mask A/B fixture is not live or repeatable.' );
	assert( mainSource.includes( 'brightWindowMeterRegionMin' ) && mainSource.includes( 'regionMin: AUTHORED_SCENE.brightWindowMeterRegionMin' ), 'Bright-window adaptation fixture lacks an authored meter region.' );
	assert( mainSource.includes( 'EXPOSURE_EXAMPLE_CONTRACT' ), 'Runtime diagnostics must expose the claim boundary.' );
	assert( mainSource.includes( 'ColorManagement.workingColorSpace !== LinearSRGBColorSpace' ), 'Frozen luminance coefficients require an executable working-space gate.' );
	assert( readmeSource.includes( 'Claim boundary' ), 'README must retain an explicit claim boundary.' );
	for ( const token of [
		'sampled histogram path with real clear',
		'fixed-point weighted global-atomic binning',
		'Percentile ranks use those fixed-point weights',
		'second reduction',
		'INSUFFICIENT_EVIDENCE'
	] ) assert( normalizedReadmeSource.includes( token ), `README histogram claim boundary is missing ${ token }.` );
	assert( ! normalizedReadmeSource.includes( 'histogram is not implemented' ), 'README must not deny the implemented runtime histogram.' );
	assert( readmeSource.includes( 'post-render meter deliberately updates a later frame' ), 'README must state the executable meter latency.' );
	assert( referenceSource.includes( 'NeutralToneMapping' ) && referenceSource.includes( 'AgXToneMapping' ) && referenceSource.includes( 'ACESFilmicToneMapping' ), 'Reference must retain verified tone-map constants.' );

	return {
		checked: [ 'constants.js', 'exposure-nodes.js', 'main.js', 'README.md', 'scene-referred-color-pipeline.md' ]
	};

}

function validateDebugCheckpointContract() {

	const checkpoints = createCheckpointList();
	const registry = createDebugViewRegistry();

	assert( checkpoints.length === 8, 'Checkpoint list must contain the derived structural sequence.' );
	for ( let index = 0; index < checkpoints.length; index += 1 ) {

		assert( checkpoints[ index ].id === index + 1, 'Checkpoint ids must be sequential.' );
		assert( checkpoints[ index ].expected, `Checkpoint ${ checkpoints[ index ].id } needs expected evidence.` );

	}
	for ( const view of EXPOSURE_DEBUG_VIEWS ) assert( Object.hasOwn( registry, view ), `Debug registry missing ${ view }.` );

	return { checkpoints: checkpoints.length, debugViews: EXPOSURE_DEBUG_VIEWS.length };

}

export function runExposureValidation() {

	const result = {
		claimBoundary: validateClaimBoundary(),
		numericProvenance: validateNumericProvenance(),
		keyCalibration: validateKeyCalibration(),
		asymmetricEvAdaptation: validateAsymmetricEvAdaptation(),
		failedReadbackIsolation: validateFailedReadbackIsolation(),
		identityLut: validateIdentityLut(),
		outputOwnership: validateOutputOwnership( {
			outputColorTransform: false,
			outputTransformOwner: 'renderOutput',
			rendererToneMappingExposure: 1,
			dynamicExposureOwner: 'ExposureFloatState.currentEV'
		} ),
		uiExclusion: validateUiExclusionMask(),
		reductionShapeAndStorage: validateReductionShapeAndStorage(),
		offlineHistogramBoundary: validateOfflineHistogramBoundary(),
		weightedHistogramOracle: validateWeightedHistogramOracle(),
		stratifiedJitter: validateStratifiedJitter(),
		clampRange: validateClampRange(),
		apiSkeletonImports: validateApiSkeletonImports(),
		structContracts: validateExposureStructContracts(),
		readbackPolicy: validateReadbackPolicy(),
		reductionNodeConstruction: validateReductionNodeConstruction(),
		debugCheckpointContract: validateDebugCheckpointContract(),
		sourceContracts: assertSourceContracts()
	};

	result.invalidFixtures = [
		expectRejects( () => validateOutputOwnership( {
			outputColorTransform: true,
			outputTransformOwner: 'renderOutput',
			rendererToneMappingExposure: 1,
			dynamicExposureOwner: 'ExposureFloatState.currentEV'
		} ), 'Double-output fixture unexpectedly passed.' )
	];

	return result;

}

if ( import.meta.url === `file://${ process.argv[ 1 ] }` ) {

	try {

		console.log( JSON.stringify( runExposureValidation(), null, 2 ) );

	} catch ( error ) {

		console.error( error.message );
		process.exitCode = 1;

	}

}
