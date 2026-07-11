import {
	ACESFilmicToneMapping,
	AgXToneMapping,
	NeutralToneMapping,
	StorageBufferAttribute,
	Vector2
} from 'three/webgpu';

import {
	DEFAULT_RENDER_DELTA_SECONDS,
	HISTOGRAM_BINS,
	HISTOGRAM_EXTRA_COUNTERS,
	MAX_ADAPTATION_DELTA_SECONDS,
	METER_HEIGHT,
	METER_MODES,
	METER_SAMPLE_COUNT,
	METER_WIDTH,
	WORKGROUP_SIZE,
	estimateExposureStorageBytes,
	resolveExposureTier,
	stratifiedJitterForMeterUpdate
} from './constants.js';
import { createExposureOutputGraph, createExposureReductionNodes } from './exposure-nodes.js';
import { DEFAULT_LUT_SIZE, createLutTexture } from './lut.js';

const TONE_MAPPINGS = Object.freeze( {
	Neutral: NeutralToneMapping,
	AgX: AgXToneMapping,
	ACES: ACESFilmicToneMapping
} );

export function createExposureColorStage( {
	renderer,
	meterSourceTextureNode,
	hdrColorNode,
	tierId = 'full-histogram',
	meterMode: requestedMeterMode = null,
	meterCadenceHz: requestedCadence = null,
	meterMaskNode = null,
	meterRegionMin = new Vector2( 0, 0 ),
	meterRegionMax = new Vector2( 1, 1 ),
	uiExclusionMin = new Vector2( 2, 2 ),
	uiExclusionMax = new Vector2( 2, 2 ),
	toneMappingVariant = 'Neutral',
	lutVariant: requestedLutVariant = null,
	lutSize = DEFAULT_LUT_SIZE,
	workgroupSize = WORKGROUP_SIZE
} ) {

	if ( ! renderer?.initialized ) throw new Error( 'Exposure stage requires an initialized renderer.' );
	if ( renderer.backend?.isWebGPUBackend !== true ) throw new Error( 'Exposure stage requires native WebGPU.' );
	if ( ! meterSourceTextureNode?.isNode ) throw new Error( 'Exposure stage requires a real meter-source texture node.' );
	if ( ! hdrColorNode?.isNode ) throw new Error( 'Exposure stage requires a scene-linear HDR color node.' );
	const tier = resolveExposureTier( tierId );
	const meterMode = requestedMeterMode ?? tier.meterMode;
	if ( ! Object.values( METER_MODES ).includes( meterMode ) ) throw new Error( `Unknown meter mode "${ meterMode }".` );
	const meterCadenceHz = requestedCadence ?? tier.meterCadenceHz;
	if ( meterMode !== METER_MODES.FIXED && ( ! Number.isFinite( meterCadenceHz ) || meterCadenceHz <= 0 ) ) throw new Error( 'Active exposure meter cadence must be finite and positive.' );
	const toneMapping = TONE_MAPPINGS[ toneMappingVariant ];
	if ( toneMapping === undefined ) throw new Error( `Unknown tone-map variant "${ toneMappingVariant }".` );
	const lutVariant = requestedLutVariant ?? tier.lut;
	const useHistogram = meterMode === METER_MODES.HISTOGRAM;
	const storageBytes = estimateExposureStorageBytes( METER_SAMPLE_COUNT, { workgroupSize, includeHistogram: useHistogram } );
	const partialBuffer = new StorageBufferAttribute( storageBytes.partialCount, 4, Float32Array );
	const exposureFloatStateBuffer = new StorageBufferAttribute( 1, 4, Float32Array );
	const exposureUintStateBuffer = new StorageBufferAttribute( 1, 4, Uint32Array );
	const histogramBuffer = useHistogram ? new StorageBufferAttribute( HISTOGRAM_BINS + HISTOGRAM_EXTRA_COUNTERS, 1, Uint32Array ) : null;
	const histogramPrefixBuffer = useHistogram ? new StorageBufferAttribute( HISTOGRAM_BINS, 1, Uint32Array ) : null;
	const histogramStateBuffer = useHistogram ? new StorageBufferAttribute( 2, 4, Uint32Array ) : null;
	exposureFloatStateBuffer.array.set( [ 0.18, 0, 0, 0 ] );
	exposureUintStateBuffer.array.set( [ 1, 0, 0, 0 ] );
	const reduction = createExposureReductionNodes( {
		hdrTextureNode: meterSourceTextureNode,
		meterMaskNode,
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
		meterRegionMin,
		meterRegionMax,
		uiExclusionMin,
		uiExclusionMax
	} );
	const lutTexture = createLutTexture( lutSize, { variant: lutVariant } );
	const output = createExposureOutputGraph( {
		hdrColor: hdrColorNode,
		lutTexture,
		lutSize,
		mapping: toneMapping,
		outputColorSpace: renderer.outputColorSpace,
		exposureState: reduction.state
	} );
	const meterEnabled = meterMode !== METER_MODES.FIXED;
	const meterInterval = meterEnabled ? 1 / meterCadenceHz : Infinity;
	let accumulator = meterEnabled ? meterInterval : 0;
	let sourceFrameIndex = 0;
	let meterUpdateIndex = 0;
	let disposed = false;
	const dispatchCounts = { adaptation: 0, meterStages: 0, meterUpdates: 0 };

	function beforeRender( deltaSeconds = DEFAULT_RENDER_DELTA_SECONDS ) {

		if ( disposed ) throw new Error( 'Exposure stage is disposed.' );
		const dt = Math.min( Math.max( Number.isFinite( deltaSeconds ) ? deltaSeconds : 0, 0 ), MAX_ADAPTATION_DELTA_SECONDS );
		reduction.deltaSecondsNode.value = dt;
		accumulator += dt;
		sourceFrameIndex += 1;
		renderer.compute( reduction.adaptExposureState );
		dispatchCounts.adaptation += 1;
		return dt;

	}

	function meterAfterRender() {

		if ( disposed ) throw new Error( 'Exposure stage is disposed.' );
		if ( ! meterEnabled || accumulator < meterInterval ) return false;
		accumulator %= meterInterval;
		meterUpdateIndex += 1;
		const jitter = stratifiedJitterForMeterUpdate( meterUpdateIndex );
		reduction.meterJitterNode.value.fromArray( jitter );
		reduction.sourceFrameIndexNode.value = sourceFrameIndex;
		const dispatches = useHistogram
			? [ reduction.clearHistogram, reduction.binHistogram, reduction.buildHistogramPrefix, reduction.resolveHistogramPercentiles, reduction.reduceHdrToPartials, reduction.reducePartialsToAggregate, reduction.resolveMeterTarget ]
			: [ reduction.reduceHdrToPartials, reduction.reducePartialsToAggregate, reduction.resolveMeterTarget ];
		renderer.compute( dispatches );
		dispatchCounts.meterStages += dispatches.length;
		dispatchCounts.meterUpdates += 1;
		return true;

	}

	function describe() {

		return {
			owner: 'exposure-color-stage',
			tierId,
			meterMode,
			meterCadenceHz,
			meterDispatchOrder: reduction.meterDispatchOrder,
			dispatchCounts: { ...dispatchCounts },
			storageBytes,
			toneMapOwner: 'toneMapping() node',
			outputTransformOwner: 'renderOutput() node',
			lut: { variant: lutVariant, size: lutSize, domain: lutTexture.userData.domain },
			performanceVerdict: 'INSUFFICIENT_EVIDENCE'
		};

	}

	async function readback() {

		if ( disposed ) throw new Error( 'Exposure stage is disposed.' );
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
			layout: {
				floatState: [ 'keyLuminance', 'targetEV', 'currentEV', 'invalidSeconds' ],
				uintState: [ 'valid', 'sourceFrameIndex', 'stateFrameIndex', 'flags' ],
				histogramState0: [ 'weightedTotal', 'lowBin', 'highBin', 'valid' ],
				histogramState1: [ 'underflowWeight', 'overflowWeight', 'weightedTotal', 'flags' ]
			},
			policy: 'diagnostic readback only; values never drive current-frame exposure'
		};

	}

	function dispose() {

		if ( disposed ) return false;
		disposed = true;
		for ( const buffer of [ partialBuffer, exposureFloatStateBuffer, exposureUintStateBuffer, histogramBuffer, histogramPrefixBuffer, histogramStateBuffer ] ) buffer?.dispose?.();
		lutTexture.dispose();
		return true;

	}

	return {
		outputNode: output.finalOutputNode,
		outputGraph: output,
		reduction,
		beforeRender,
		meterAfterRender,
		readback,
		describe,
		dispose
	};

}
