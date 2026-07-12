import {
	AUTHORED_WAVES,
	DEFAULT_WATER_PARAMETERS
} from './constants.js';

const TAU = Math.PI * 2;
const GRAVITY = 9.81;

function normalize3( vector ) {
	const magnitude = Math.hypot( vector[ 0 ], vector[ 1 ], vector[ 2 ] );
	return magnitude > 0 ? vector.map( ( value ) => value / magnitude ) : [ 0, 1, 0 ];
}

export function sampleAnalyticSurfaceAtParameter( qx, qz, timeSeconds, {
	waves = AUTHORED_WAVES,
	analyticBandCount = waves.length
} = {} ) {
	const position = [ qx, 0, qz ];
	const tangentX = [ 1, 0, 0 ];
	const tangentZ = [ 0, 0, 1 ];
	const surfacePointVelocityMps = [ 0, 0, 0 ];
	const surfacePointAccelerationMps2 = [ 0, 0, 0 ];

	for ( const wave of waves.slice( 0, analyticBandCount ) ) {
		const k = TAU / wave.wavelength;
		const omega = Math.sqrt( GRAVITY * k );
		const phase = k * ( wave.direction.x * qx + wave.direction.y * qz ) - omega * timeSeconds;
		const sinPhase = Math.sin( phase );
		const cosPhase = Math.cos( phase );
		const horizontalAmplitude = wave.steepness * wave.amplitude;
		const dx = wave.direction.x;
		const dz = wave.direction.y;
		const omegaSquared = omega * omega;

		position[ 0 ] += horizontalAmplitude * dx * cosPhase;
		position[ 1 ] += wave.amplitude * sinPhase;
		position[ 2 ] += horizontalAmplitude * dz * cosPhase;

		tangentX[ 0 ] -= horizontalAmplitude * k * dx * dx * sinPhase;
		tangentX[ 1 ] += wave.amplitude * k * dx * cosPhase;
		tangentX[ 2 ] -= horizontalAmplitude * k * dx * dz * sinPhase;

		tangentZ[ 0 ] -= horizontalAmplitude * k * dx * dz * sinPhase;
		tangentZ[ 1 ] += wave.amplitude * k * dz * cosPhase;
		tangentZ[ 2 ] -= horizontalAmplitude * k * dz * dz * sinPhase;

		// Exact partial derivatives of the serialized fixed-chart map r(qx,qz,t).
		// This is coordinate-surface velocity, not material current or phase speed.
		surfacePointVelocityMps[ 0 ] += horizontalAmplitude * dx * omega * sinPhase;
		surfacePointVelocityMps[ 1 ] -= wave.amplitude * omega * cosPhase;
		surfacePointVelocityMps[ 2 ] += horizontalAmplitude * dz * omega * sinPhase;
		surfacePointAccelerationMps2[ 0 ] -= horizontalAmplitude * dx * omegaSquared * cosPhase;
		surfacePointAccelerationMps2[ 1 ] -= wave.amplitude * omegaSquared * sinPhase;
		surfacePointAccelerationMps2[ 2 ] -= horizontalAmplitude * dz * omegaSquared * cosPhase;
	}

	const horizontalJacobian = tangentX[ 0 ] * tangentZ[ 2 ] - tangentZ[ 0 ] * tangentX[ 2 ];
	const normal = normalize3( [
		tangentZ[ 1 ] * tangentX[ 2 ] - tangentZ[ 2 ] * tangentX[ 1 ],
		horizontalJacobian,
		tangentZ[ 0 ] * tangentX[ 1 ] - tangentZ[ 1 ] * tangentX[ 0 ]
	] );
	const geometricNormalVelocityMps = surfacePointVelocityMps.reduce(
		( sum, component, index ) => sum + component * normal[ index ], 0
	);

	return {
		parameter: [ qx, qz ],
		position,
		height: position[ 1 ],
		tangentX,
		tangentZ,
		normal,
		surfacePointVelocityMps,
		surfacePointAccelerationMps2,
		geometricNormalVelocityMps,
		horizontalJacobian
	};
}

export function getParametricWaterHeight( qx, qz, timeSeconds, options = {} ) {
	return sampleAnalyticSurfaceAtParameter( qx, qz, timeSeconds, options ).height;
}

export function sampleAnalyticSurfaceAtWorldXZ( x, z, timeSeconds, {
	waves = AUTHORED_WAVES,
	analyticBandCount = waves.length,
	maxIterations = 12,
	horizontalTolerance = 1e-7,
	minimumJacobianMagnitude = 1e-6
} = {} ) {
	let qx = x;
	let qz = z;
	let sample = null;
	let residual = Infinity;
	let lastIteration = 0;

	for ( let iteration = 0; iteration <= maxIterations; iteration += 1 ) {
		lastIteration = iteration;
		sample = sampleAnalyticSurfaceAtParameter( qx, qz, timeSeconds, { waves, analyticBandCount } );
		const residualX = sample.position[ 0 ] - x;
		const residualZ = sample.position[ 2 ] - z;
		residual = Math.hypot( residualX, residualZ );

		if ( residual <= horizontalTolerance ) {
			return { ...sample, iterations: iteration, horizontalResidual: residual, status: 'converged' };
		}

		if ( iteration === maxIterations || Math.abs( sample.horizontalJacobian ) < minimumJacobianMagnitude ) break;

		const inverseDeterminant = 1 / sample.horizontalJacobian;
		const deltaX = ( sample.tangentZ[ 2 ] * residualX - sample.tangentZ[ 0 ] * residualZ ) * inverseDeterminant;
		const deltaZ = ( - sample.tangentX[ 2 ] * residualX + sample.tangentX[ 0 ] * residualZ ) * inverseDeterminant;
		qx -= deltaX;
		qz -= deltaZ;
	}

	return {
		...sample,
		iterations: lastIteration,
		horizontalResidual: residual,
		status: Math.abs( sample?.horizontalJacobian ?? 0 ) < minimumJacobianMagnitude ? 'singular-horizontal-map' : 'iteration-limit'
	};
}

export function getWaterHeight( x, z, timeSeconds, options = {} ) {
	const sample = sampleAnalyticSurfaceAtWorldXZ( x, z, timeSeconds, options );
	if ( sample.status !== 'converged' ) {
		throw new Error( `Analytic water horizontal inversion failed: ${ sample.status }; residual=${ sample.horizontalResidual }.` );
	}
	return sample.height;
}

export function estimateAnalyticParityError() {
	return null;
}

export function estimateHeightfieldResidualBound( {
	parameters = DEFAULT_WATER_PARAMETERS
} = {} ) {
	void parameters;
	return null;
}

export function createBoundedWaterHeightQuery( {
	waves = AUTHORED_WAVES,
	analyticBandCount = waves.length,
	parameters = DEFAULT_WATER_PARAMETERS,
	maxIterations = 12,
	horizontalTolerance = 1e-7,
	minimumJacobianMagnitude = 1e-6
} = {} ) {
	const queryOptions = { waves, analyticBandCount, maxIterations, horizontalTolerance, minimumJacobianMagnitude };
	return {
		model: 'bounded-water-authored-eulerian-inversion',
		getWaterHeight( x, z, timeSeconds ) {
			return getWaterHeight( x, z, timeSeconds, queryOptions );
		},
		sampleAtParameter( qx, qz, timeSeconds ) {
			return sampleAnalyticSurfaceAtParameter( qx, qz, timeSeconds, queryOptions );
		},
		sampleAtWorldXZ( x, z, timeSeconds ) {
			return sampleAnalyticSurfaceAtWorldXZ( x, z, timeSeconds, queryOptions );
		},
		estimateAnalyticParityError,
		estimateHeightfieldResidualBound() {
			return estimateHeightfieldResidualBound( { parameters } );
		},
		claimBoundary: {
			gpuRoundoffBound: null,
			liveHeightfieldResidualBound: estimateHeightfieldResidualBound( { parameters } ),
			reason: 'The CPU query covers authored analytic waves only; GPU parity is measured, and the live grid is unbounded unless a hard envelope is enforced.'
		}
	};
}
