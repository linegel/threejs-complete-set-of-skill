import {
	AUTHORED_WAVES,
	DEFAULT_WATER_PARAMETERS
} from './constants.js';

const TAU = Math.PI * 2;
const GRAVITY = 9.81;

export function getWaterHeight( x, z, timeSeconds, {
	waves = AUTHORED_WAVES,
	analyticBandCount = waves.length
} = {} ) {
	let height = 0;

	for ( const wave of waves.slice( 0, analyticBandCount ) ) {
		const k = TAU / wave.wavelength;
		const omega = Math.sqrt( GRAVITY * k );
		const phase = k * ( wave.direction.x * x + wave.direction.y * z ) - omega * timeSeconds;
		height += wave.amplitude * Math.sin( phase );
	}

	return height;
}

export function estimateAnalyticParityError() {
	return 0;
}

export function estimateHeightfieldResidualBound( {
	parameters = DEFAULT_WATER_PARAMETERS
} = {} ) {
	return Math.abs( parameters.dropStrength ) + Math.abs( parameters.objectDisplacementScale ?? 0 );
}

export function createBoundedWaterHeightQuery( {
	waves = AUTHORED_WAVES,
	analyticBandCount = waves.length,
	parameters = DEFAULT_WATER_PARAMETERS
} = {} ) {
	return {
		model: 'bounded-water-analytic-component',
		getWaterHeight( x, z, timeSeconds ) {
			return getWaterHeight( x, z, timeSeconds, { waves, analyticBandCount } );
		},
		estimateAnalyticParityError,
		estimateHeightfieldResidualBound() {
			return estimateHeightfieldResidualBound( { parameters } );
		}
	};
}

