import { NoToneMapping } from 'three/webgpu';
import {
	Fn,
	If,
	Loop,
	clamp,
	dot,
	exp,
	float,
	instanceIndex,
	invocationLocalIndex,
	log,
	max,
	min,
	mrt,
	pass,
	renderOutput,
	saturate,
	storage,
	texture3D,
	toneMapping,
	uint,
	uniform,
	vec4,
	uvec4,
	vec2,
	vec3,
	workgroupArray,
	workgroupBarrier
} from 'three/tsl';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import {
	MAX_EXPOSURE,
	METER_HEIGHT,
	METER_WIDTH,
	MIDDLE_GRAY,
	MIN_EXPOSURE,
	SPEED_DOWN,
	SPEED_UP,
	WORKGROUP_SIZE
} from './constants.js';

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

export const EXPOSURE_STATE_BUFFER_LAYOUT = {
	floatState: 'vec4<f32>(average, target, current, staleSeconds)',
	uintState: 'uvec4<u32>(valid, histogramOffset, frameIndex, flags)'
};

export const exposureReadbackPolicy = {
	getArrayBufferAsync: 'read ExposureState or histogram bins only at telemetry cadence',
	byteRanges: {
		state: '0..32',
		histogramBins: 'histogramOffset..histogramOffset + histogramBins * 4'
	},
	staleTelemetry: 'hold last valid target/current; never drive the current frame from a failed readback'
};

export function createExposureReductionNodes( {
	hdrTextureNode,
	meterMaskNode = null,
	meterWidth = METER_WIDTH,
	meterHeight = METER_HEIGHT,
	pixelCount,
	workgroupSize = WORKGROUP_SIZE,
	partialBuffer,
	exposureFloatStateBuffer,
	exposureUintStateBuffer,
	histogramBuffer,
	histogramBins,
	deltaSeconds = 1 / 60
} ) {

	const partialCount = Math.ceil( pixelCount / workgroupSize );
	const partials = storage( partialBuffer, 'vec4', partialCount );
	const floatState = storage( exposureFloatStateBuffer, 'vec4', 1 );
	const uintState = storage( exposureUintStateBuffer, 'uvec4', 1 );
	const histogram = storage( histogramBuffer, 'uint', histogramBins );
	const deltaSecondsNode = uniform( deltaSeconds, 'float' ).setName( 'exposureDeltaSeconds' );
	const luminanceCoefficients = vec3( 0.2126, 0.7152, 0.0722 );

	const reduceHdrToPartials = Fn( () => {

		const pixelIndex = instanceIndex;
		const localIndex = invocationLocalIndex;
		const partialIndex = pixelIndex.div( uint( workgroupSize ) );
		const texelX = pixelIndex.mod( uint( meterWidth ) );
		const texelY = pixelIndex.div( uint( meterWidth ) );
		const uv = vec2(
			float( texelX ).add( 0.5 ).div( float( meterWidth ) ),
			float( texelY ).add( 0.5 ).div( float( meterHeight ) )
		);
		const hdrSample = hdrTextureNode.sample( uv ).rgb;
		const maskSample = meterMaskNode ? meterMaskNode.sample( uv ).r : float( 1 );
		const distanceFromCenter = uv.sub( vec2( 0.5 ) ).length();
		const centerWeight = clamp( float( 1 ).sub( distanceFromCenter.mul( 0.9 ) ), 0.35, 1 );
		const luminance = max( dot( hdrSample, luminanceCoefficients ), 0.0001 );
		const logLuminance = log( luminance );
		const lowLightWeight = luminance.greaterThan( 0.002 ).select( 1, 0.15 );
		const weight = saturate( maskSample ).mul( centerWeight ).mul( lowLightWeight );
		const localPartials = workgroupArray( 'vec4', workgroupSize );
		localPartials.element( localIndex ).assign( vec4(
			logLuminance.mul( weight ),
			weight,
			logLuminance,
			logLuminance
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

			partials.element( partialIndex ).assign( localPartials.element( 0 ) );

		} );

	} )().compute( pixelCount, [ workgroupSize ] );

	const reducePartialsToAggregate = Fn( () => {

		const reduceIndex = instanceIndex;
		const localIndex = invocationLocalIndex;
		const localPartials = workgroupArray( 'vec4', workgroupSize );
		const sample = reduceIndex.lessThan( uint( partialCount ) )
			.select( partials.element( reduceIndex ), vec4( 0, 0, 99, -99 ) );
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

			partials.element( 0 ).assign( localPartials.element( 0 ) );

		} );

	} )().compute( Math.max( partialCount, workgroupSize ), [ workgroupSize ] );

	const resolveExposureState = Fn( () => {

		const aggregate = partials.element( 0 );
		const average = exp( aggregate.x.div( max( aggregate.y, 0.0001 ) ) );
		const target = clamp( float( MIDDLE_GRAY ).div( max( average, 0.0001 ) ), MIN_EXPOSURE, MAX_EXPOSURE );
		const previous = floatState.element( 0 );
		const current = previous.z.greaterThan( 0 ).select( previous.z, target );
		const speed = target.greaterThan( current ).select( SPEED_UP, SPEED_DOWN );
		const amount = float( 1 ).sub( exp( deltaSecondsNode.mul( speed ).negate() ) );
		const adapted = current.add( target.sub( current ).mul( amount ) );
		floatState.element( 0 ).assign( vec4( average, target, adapted, 0 ) );
		uintState.element( 0 ).assign( uvec4( 1, histogramBins, 0, 0 ) );
		histogram.element( 0 ).assign( uint( histogramBins ) );

	} )().compute( 1, [ workgroupSize ] );

	return {
		structs: [ EXPOSURE_PARTIAL_STRUCT, EXPOSURE_STATE_STRUCT ],
		layout: EXPOSURE_STATE_BUFFER_LAYOUT,
		partials,
		state: {
			floatState,
			uintState
		},
		floatState,
		uintState,
		histogram,
		reduceHdrToPartials,
		reducePartialsToAggregate,
		resolveExposureState,
		deltaSecondsNode
	};

}

export function createExposureOutputNode( {
	hdrColor,
	lutTexture,
	lutSize,
	lutIntensity = float( 1 ),
	mapping,
	outputColorSpace,
	exposureState
} ) {

	const currentExposure = exposureState.floatState.element( 0 ).z;
	const exposedHdr = hdrColor.mul( currentExposure );
	const postToneMapLinear = toneMapping( mapping, 1, exposedHdr );
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
	instanceIndex,
	invocationLocalIndex,
	workgroupArray,
	workgroupBarrier,
	lut3D
};
