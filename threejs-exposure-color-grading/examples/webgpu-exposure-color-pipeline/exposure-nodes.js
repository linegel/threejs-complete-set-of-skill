import { NoToneMapping } from 'three/webgpu';
import {
	Fn,
	float,
	mrt,
	pass,
	renderOutput,
	saturate,
	storage,
	texture3D,
	toneMapping,
	vec4,
	workgroupArray,
	workgroupBarrier
} from 'three/tsl';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';

export const EXPOSURE_PARTIAL_STRUCT = `
struct ExposurePartial {
  logSum: f32,
  weightSum: f32,
  minLogLuminance: f32,
  maxLogLuminance: f32,
}
`;

export const EXPOSURE_STATE_STRUCT = `
struct ExposureState {
  average: f32,
  target: f32,
  current: f32,
  staleSeconds: f32,
  valid: u32,
  histogramOffset: u32,
  frameIndex: u32,
  flags: u32,
}
`;

export const exposureReadbackPolicy = {
	getArrayBufferAsync: 'read ExposureState or histogram bins only at telemetry cadence',
	byteRanges: {
		state: '0..32',
		histogramBins: 'histogramOffset..histogramOffset + histogramBins * 4'
	},
	staleTelemetry: 'hold last valid target/current; never drive the current frame from a failed readback'
};

export function createExposureReductionNodes( {
	pixelCount,
	workgroupSize,
	partialBuffer,
	exposureStateBuffer,
	histogramBuffer,
	histogramBins
} ) {

	const partials = storage( partialBuffer, 'vec4', Math.ceil( pixelCount / workgroupSize ) );
	const state = storage( exposureStateBuffer, 'vec4', 2 );
	const histogram = storage( histogramBuffer, 'uint', histogramBins );

	const reduceHdrToPartials = Fn( () => {

		const localPartials = workgroupArray( 'vec4', workgroupSize );
		localPartials.element( 0 ).assign( vec4( 0, 0, 99, -99 ) );
		workgroupBarrier();

	} )().compute( pixelCount, [ workgroupSize ] );

	const resolveExposureState = Fn( () => {

		workgroupBarrier();

	} )().compute( 1, [ workgroupSize ] );

	return {
		structs: [ EXPOSURE_PARTIAL_STRUCT, EXPOSURE_STATE_STRUCT ],
		partials,
		state,
		histogram,
		reduceHdrToPartials,
		resolveExposureState
	};

}

export function createExposureOutputNode( {
	hdrColor,
	lutTexture,
	lutSize,
	lutIntensity = float( 1 ),
	mapping,
	outputColorSpace
} ) {

	const postToneMapLinear = toneMapping( mapping, 1, hdrColor );
	const graded = lut3D( vec4( saturate( postToneMapLinear ), 1 ), texture3D( lutTexture ), lutSize, lutIntensity );
	return renderOutput( graded, NoToneMapping, outputColorSpace );

}

export const apiSkeletonImports = {
	Fn,
	mrt,
	pass,
	renderOutput,
	storage,
	texture3D,
	toneMapping,
	workgroupArray,
	workgroupBarrier,
	lut3D
};
