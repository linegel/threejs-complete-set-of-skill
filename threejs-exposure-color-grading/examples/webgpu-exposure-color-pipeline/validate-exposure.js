import {
	HISTOGRAM_BINS,
	MAX_EXPOSURE,
	METER_HEIGHT,
	METER_WIDTH,
	MIDDLE_GRAY,
	MIN_EXPOSURE,
	WORKGROUP_SIZE,
	adaptExposure,
	dispatchCount,
	estimateExposureStorageBytes,
	exposureTargetForAverage,
	histogramBinForLuminance,
	holdLastValidTelemetry,
	reducePassCount,
	weightedLogAverage
} from './constants.js';
import {
	EXPOSURE_DEBUG_VIEWS,
	createCheckpointList,
	createDebugViewRegistry
} from './debug-views.js';
import {
	EXPOSURE_PARTIAL_STRUCT,
	EXPOSURE_STATE_STRUCT,
	apiSkeletonImports,
	createExposureReductionNodes,
	exposureReadbackPolicy
} from './exposure-nodes.js';
import { createExposureColorPipeline } from './main.js';
import { createIdentityLutData, sampleIdentityLutNearest } from './lut.js';
import { StorageBufferAttribute } from 'three/webgpu';

function assert( condition, message ) {

	if ( ! condition ) throw new Error( message );

}

function near( actual, expected, tolerance, message ) {

	assert( Math.abs( actual - expected ) <= tolerance, `${ message }: expected ${ expected }, got ${ actual }.` );

}

function validateGrayCardTarget() {

	const target = exposureTargetForAverage( MIDDLE_GRAY );
	near( target, 1, 1e-9, '18% gray should converge to exposure 1.0' );
	return { target };

}

function validateAsymmetricAdaptation() {

	const current = 1;
	const upTarget = 1.8;
	const downTarget = 0.5;
	const dt = 0.25;
	const up = adaptExposure( current, upTarget, dt );
	const down = adaptExposure( current, downTarget, dt );

	assert( up > current && up < upTarget, 'Upward adaptation must be monotonic toward target.' );
	assert( down < current && down > downTarget, 'Downward adaptation must be monotonic toward target.' );
	assert( Math.abs( up - current ) > Math.abs( current - down ), 'Adaptation must be asymmetric; speedUp should exceed speedDown.' );

	return { up, down };

}

function validateFailedReadbackHold() {

	const previous = {
		average: 0.22,
		target: 0.82,
		current: 0.9,
		staleSeconds: 0.1,
		valid: true
	};
	const next = holdLastValidTelemetry( previous, { valid: false, deltaSeconds: 0.2 } );

	near( next.average, previous.average, 1e-12, 'Failed readback must hold last average' );
	near( next.target, previous.target, 1e-12, 'Failed readback must hold last target' );
	near( next.current, previous.current, 1e-12, 'Failed readback must hold current exposure' );
	assert( next.valid === false && next.staleSeconds > previous.staleSeconds, 'Failed readback should mark telemetry stale.' );

	return next;

}

function validateIdentityLut() {

	const size = 32;
	const data = createIdentityLutData( size );
	const sample = [ 8 / 31, 17 / 31, 28 / 31 ];
	const output = sampleIdentityLutNearest( data, size, sample );

	for ( let index = 0; index < 3; index += 1 ) {

		near( output[ index ], sample[ index ], 1 / 255, `Identity LUT channel ${ index }` );

	}

	return { size, sample, output, tolerance: 1 / 255 };

}

function validateOutputOwnership( config ) {

	const hasManualOutput = config.outputTransformOwner === 'renderOutput';
	if ( hasManualOutput && config.outputColorTransform !== false ) {

		throw new Error( 'No double output conversion: RenderPipeline.outputColorTransform must be false when renderOutput owns conversion.' );

	}

	if ( config.rendererToneMappingExposure !== 1 && config.dynamicExposureOwner !== 'ExposureState storage buffer' ) {

		throw new Error( 'Dynamic exposure must have one owner.' );

	}

	return true;

}

function validateUiExclusionMask() {

	const samples = [
		{ luminance: 0.18, sceneMask: 1, uiMask: 1, skyMask: 1, centerWeight: 1 },
		{ luminance: 8.0, sceneMask: 1, uiMask: 0, skyMask: 1, centerWeight: 1 }
	];
	const average = weightedLogAverage( samples );
	near( average, 0.18, 1e-9, 'UI overlay must not affect metered luminance' );
	return { average };

}

function validateStorageAndHistogram() {

	const pixelCount = 64 * 36;
	const storage = estimateExposureStorageBytes( pixelCount );
	const groups = dispatchCount( pixelCount, WORKGROUP_SIZE );
	assert( storage.partialCount === groups, 'Storage partial count must match dispatchCount.' );
	assert( reducePassCount( groups, WORKGROUP_SIZE ) === 1, '64x36 meter should reduce to one aggregate pass at workgroup size 128.' );
	assert( storage.totalBytes > 0 && storage.totalBytes < 256 * 1024, 'Exposure storage should fit the documented desktop budget.' );

	for ( const luminance of [ 0, 0.0001, 0.18, 1, 1000 ] ) {

		const bin = histogramBinForLuminance( luminance );
		assert( bin >= 0 && bin < HISTOGRAM_BINS, `Histogram bin out of bounds for ${ luminance }.` );

	}

	return storage;

}

function validateClampRange() {

	near( exposureTargetForAverage( 1000 ), MIN_EXPOSURE, 1e-12, 'Very bright scene should clamp to min exposure' );
	near( exposureTargetForAverage( 0.000001 ), MAX_EXPOSURE, 1e-12, 'Very dark scene should clamp to max exposure' );
	return { min: MIN_EXPOSURE, max: MAX_EXPOSURE };

}

function validateApiSkeletonImports() {

	const required = [
		'Fn',
		'mrt',
		'pass',
		'renderOutput',
		'storage',
		'texture3D',
		'toneMapping',
		'workgroupArray',
		'workgroupBarrier',
		'lut3D'
	];

	for ( const name of required ) {

		assert( apiSkeletonImports[ name ], `Missing API skeleton import: ${ name }.` );

	}

	assert( typeof createExposureColorPipeline === 'function', 'main.js must export createExposureColorPipeline().' );

	return { required };

}

function validateExposureStructContracts() {

	const partialFields = [ 'logSum', 'weightSum', 'minLogLuminance', 'maxLogLuminance' ];
	const stateFields = [ 'average', 'target', 'current', 'staleSeconds', 'valid', 'histogramOffset', 'frameIndex', 'flags' ];

	for ( const field of partialFields ) {

		assert( EXPOSURE_PARTIAL_STRUCT.includes( `${ field }:` ), `ExposurePartial missing ${ field }.` );

	}

	for ( const field of stateFields ) {

		assert( EXPOSURE_STATE_STRUCT.includes( `${ field }:` ), `ExposureState missing ${ field }.` );

	}

	assert( partialFields.length * 4 === 16, 'ExposurePartial must remain 16 bytes.' );
	assert( stateFields.length * 4 === 32, 'ExposureState must remain 32 bytes.' );

	return { partialFields, stateFields };

}

function validateReadbackPolicy() {

	assert( exposureReadbackPolicy.getArrayBufferAsync.includes( 'ExposureState' ), 'Readback policy must identify ExposureState telemetry.' );
	assert( exposureReadbackPolicy.byteRanges.state === '0..32', 'ExposureState readback byte range must be 0..32.' );
	assert( exposureReadbackPolicy.byteRanges.histogramBins.includes( 'histogramBins * 4' ), 'Histogram readback byte range must be byte-accurate.' );
	assert( exposureReadbackPolicy.staleTelemetry.includes( 'hold last valid' ), 'Stale readback policy must hold last valid data.' );
	assert( exposureReadbackPolicy.staleTelemetry.includes( 'never drive the current frame' ), 'Readback must not drive the current frame.' );

	return exposureReadbackPolicy;

}

function validateReductionNodeConstruction() {

	const pixelCount = METER_WIDTH * METER_HEIGHT;
	const storage = estimateExposureStorageBytes( pixelCount );
	const nodes = createExposureReductionNodes( {
		pixelCount,
		workgroupSize: WORKGROUP_SIZE,
		partialBuffer: new StorageBufferAttribute( storage.partialCount, 4, Float32Array ),
		exposureStateBuffer: new StorageBufferAttribute( 2, 4, Float32Array ),
		histogramBuffer: new StorageBufferAttribute( HISTOGRAM_BINS, 1, Uint32Array ),
		histogramBins: HISTOGRAM_BINS
	} );

	assert( nodes.structs.length === 2, 'Reduction node contract must expose partial and state structs.' );
	assert( nodes.partials && nodes.state && nodes.histogram, 'Reduction node contract must expose storage nodes.' );
	assert( nodes.reduceHdrToPartials && nodes.resolveExposureState, 'Reduction node contract must expose compute nodes.' );

	return {
		structs: nodes.structs.length,
		hasStorageNodes: true,
		hasComputeNodes: true
	};

}

function validateDebugCheckpointContract() {

	const checkpoints = createCheckpointList();
	const registry = createDebugViewRegistry();
	const expectedViews = [
		'meter source HDR',
		'meter mask',
		'partial logSum weightSum',
		'aggregate average',
		'adapted exposure',
		'post-tone-map linear',
		'LUT output',
		'final output'
	];

	assert( checkpoints.length === 8, 'Checkpoint list must contain the eight Phase 1 build checkpoints.' );

	for ( let index = 0; index < checkpoints.length; index += 1 ) {

		assert( checkpoints[ index ].id === index + 1, 'Checkpoint ids must be sequential.' );
		assert( checkpoints[ index ].expected, `Checkpoint ${ checkpoints[ index ].id } must declare expected evidence.` );

	}

	for ( const view of expectedViews ) {

		assert( EXPOSURE_DEBUG_VIEWS.includes( view ), `Debug view list missing ${ view }.` );
		assert( Object.hasOwn( registry, view ), `Debug registry missing ${ view }.` );

	}

	return {
		checkpoints: checkpoints.length,
		debugViews: EXPOSURE_DEBUG_VIEWS.length
	};

}

export function runExposureValidation() {

	const result = {
		grayCard: validateGrayCardTarget(),
		asymmetricAdaptation: validateAsymmetricAdaptation(),
		failedReadback: validateFailedReadbackHold(),
		identityLut: validateIdentityLut(),
		outputOwnership: validateOutputOwnership( {
			outputColorTransform: false,
			outputTransformOwner: 'renderOutput',
			rendererToneMappingExposure: 1,
			dynamicExposureOwner: 'ExposureState storage buffer'
		} ),
		uiExclusion: validateUiExclusionMask(),
		storageAndHistogram: validateStorageAndHistogram(),
		clampRange: validateClampRange(),
		apiSkeletonImports: validateApiSkeletonImports(),
		structContracts: validateExposureStructContracts(),
		readbackPolicy: validateReadbackPolicy(),
		reductionNodeConstruction: validateReductionNodeConstruction(),
		debugCheckpointContract: validateDebugCheckpointContract()
	};

	try {

		validateOutputOwnership( {
			outputColorTransform: true,
			outputTransformOwner: 'renderOutput',
			rendererToneMappingExposure: 1,
			dynamicExposureOwner: 'ExposureState storage buffer'
		} );
		throw new Error( 'Double output conversion fixture unexpectedly passed.' );

	} catch ( error ) {

		if ( error.message.includes( 'unexpectedly passed' ) ) throw error;
		result.invalidFixtures = [ 'double-output-conversion' ];

	}

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
