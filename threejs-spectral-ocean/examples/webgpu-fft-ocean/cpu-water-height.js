import {
	CAPILLARY_SURFACE_TENSION_OVER_DENSITY,
	TAU,
	createCascadeDescriptors,
	mergeOceanConfig
} from './constants.js';

const DEFAULT_DOMINANT_BIN_COUNT = 32;
const MIN_K = 1e-4;

function finiteDepthDispersion( k, depthMeters, gravity, capillarySurfaceTensionOverDensity = CAPILLARY_SURFACE_TENSION_OVER_DENSITY ) {
	return Math.sqrt( ( gravity * k + capillarySurfaceTensionOverDensity * k ** 3 ) * Math.tanh( Math.min( k * depthMeters, 20 ) ) );
}

function finiteDepthDispersionDerivative( k, depthMeters, gravity, capillarySurfaceTensionOverDensity = CAPILLARY_SURFACE_TENSION_OVER_DENSITY ) {
	const kh = Math.min( k * depthMeters, 20 );
	const tanhKh = Math.tanh( kh );
	const coshKh = Math.cosh( kh );
	const gravityCapillary = gravity * k + capillarySurfaceTensionOverDensity * k ** 3;
	const gravityCapillaryDerivative = gravity + 3 * capillarySurfaceTensionOverDensity * k * k;
	const omega = Math.max( finiteDepthDispersion( k, depthMeters, gravity, capillarySurfaceTensionOverDensity ), 1e-6 );
	return ( gravityCapillaryDerivative * tanhKh + gravityCapillary * depthMeters / ( coshKh * coshKh ) ) / ( 2 * omega );
}

function tmaCorrection( omega, gravity, depthMeters ) {
	const value = omega * Math.sqrt( depthMeters / gravity );
	if ( value <= 1 ) return 0.5 * value * value;
	if ( value < 2 ) return 1 - 0.5 * ( 2 - value ) ** 2;
	return 1;
}

function spectrumParameters( lobe, gravity ) {
	return {
		...lobe,
		angle: lobe.directionDegrees * Math.PI / 180,
		alpha: 0.076 * ( gravity * lobe.fetchMeters / ( lobe.windSpeed * lobe.windSpeed ) ) ** - 0.22,
		peakOmega: 22 * ( lobe.windSpeed * lobe.fetchMeters / ( gravity * gravity ) ) ** - 0.33
	};
}

function normalizationFactor( power ) {
	const s2 = power * power;
	const s3 = s2 * power;
	const s4 = s3 * power;
	if ( power < 5 ) return - 0.000564 * s4 + 0.00776 * s3 - 0.044 * s2 + 0.192 * power + 0.163;
	return - 4.8e-8 * s4 + 1.07e-5 * s3 - 9.53e-4 * s2 + 5.9e-2 * power + 0.393;
}

function directionalSpread( theta, omega, peakOmega, directionAngle, directionality, swell ) {
	const ratio = Math.max( omega / peakOmega, 1e-4 );
	const below = 6.97 * ratio ** 5;
	const above = 9.77 * ratio ** - 2.5;
	const power = ( ratio <= 1 ? below : above ) + 16 * Math.tanh( Math.min( ratio, 20 ) ) * swell * swell;
	const broad = ( 2 / Math.PI ) * Math.cos( theta ) ** 2;
	const directed = normalizationFactor( power ) * Math.abs( Math.cos( ( theta - directionAngle ) * 0.5 ) ) ** ( power * 2 );
	return broad * ( 1 - directionality ) + directed * directionality;
}

function jonswapEnergy( omega, k, theta, params, cascade ) {
	const safeOmega = Math.max( omega, MIN_K );
	const sigma = safeOmega <= params.peakOmega ? 0.07 : 0.09;
	const normalized = ( safeOmega - params.peakOmega ) / Math.max( sigma * params.peakOmega * Math.SQRT2, 1e-5 );
	const peakShape = Math.exp( - normalized * normalized );
	const peakRatio = params.peakOmega / safeOmega;
	const fade = Math.exp( - params.shortWaveFade * params.shortWaveFade * k * k );

	return params.scale
		* tmaCorrection( safeOmega, cascade.gravity, cascade.depthMeters )
		* params.alpha
		* cascade.gravity * cascade.gravity
		* safeOmega ** - 5
		* Math.exp( - 1.25 * peakRatio ** 4 )
		* params.peakEnhancement ** peakShape
		* directionalSpread( theta, omega, params.peakOmega, params.angle, params.directionality, params.swell )
		* fade;
}

function fract( value ) {
	return value - Math.floor( value );
}

function hashUnitCpu( x, y, seed, salt ) {
	return fract( Math.sin( x * 12.9898 + y * 78.233 + ( seed + salt ) * 37.719 ) * 43758.5453123 );
}

function gaussianPairCpu( x, y, seed ) {
	const u1 = Math.max( hashUnitCpu( x, y, seed, 17 ), 1e-7 );
	const u2 = hashUnitCpu( x, y, seed, 53 );
	const radius = Math.sqrt( - 2 * Math.log( u1 ) );
	const phase = TAU * u2;
	return [ radius * Math.cos( phase ), radius * Math.sin( phase ) ];
}

function complexAdd( a, b ) {
	return [ a[ 0 ] + b[ 0 ], a[ 1 ] + b[ 1 ] ];
}

function complexMul( a, b ) {
	return [
		a[ 0 ] * b[ 0 ] - a[ 1 ] * b[ 1 ],
		a[ 0 ] * b[ 1 ] + a[ 1 ] * b[ 0 ]
	];
}

function complexConjugate( a ) {
	return [ a[ 0 ], - a[ 1 ] ];
}

function complexMagnitude( a ) {
	return Math.hypot( a[ 0 ], a[ 1 ] );
}

function halfOpenBandMask( k, low, high ) {
	return k >= low && k < high ? 1 : 0;
}

function spectrumAmplitude( cascade, k, theta, deltaK ) {
	const kSafe = Math.max( k, cascade.cutoffLow );
	const omega = finiteDepthDispersion( kSafe, cascade.depthMeters, cascade.gravity, cascade.capillarySurfaceTensionOverDensity );
	const local = spectrumParameters( cascade.local, cascade.gravity );
	const swell = spectrumParameters( cascade.swell, cascade.gravity );
	const energy = jonswapEnergy( omega, kSafe, theta, local, cascade )
		+ jonswapEnergy( omega, kSafe, theta, swell, cascade );
	const derivative = Math.abs( finiteDepthDispersionDerivative( kSafe, cascade.depthMeters, cascade.gravity, cascade.capillarySurfaceTensionOverDensity ) );
	const inBand = halfOpenBandMask( k, cascade.cutoffLow, cascade.cutoffHigh );
	return Math.sqrt( Math.max( energy * 2 * derivative * deltaK * deltaK / kSafe, 0 ) ) * inBand;
}

function h0ForCell( cascade, x, y, deltaK ) {
	const resolution = cascade.resolution;
	const centeredX = x - resolution / 2;
	const centeredY = y - resolution / 2;
	const kx = centeredX * deltaK;
	const kz = centeredY * deltaK;
	const k = Math.hypot( kx, kz );
	const theta = Math.atan2( kz, kx );
	const amplitude = spectrumAmplitude( cascade, k, theta, deltaK );
	const gaussian = gaussianPairCpu( x, y, cascade.seed );
	return {
		value: [ gaussian[ 0 ] * amplitude, gaussian[ 1 ] * amplitude ],
		amplitude
	};
}

function makeFrequencyBin( cascade, x, y ) {
	const resolution = cascade.resolution;
	const deltaK = TAU / cascade.patchLength;
	const centeredX = x - resolution / 2;
	const centeredY = y - resolution / 2;
	const kx = centeredX * deltaK;
	const kz = centeredY * deltaK;
	const k = Math.hypot( kx, kz );
	const h0 = h0ForCell( cascade, x, y, deltaK );
	const mirrorX = ( resolution - x ) % resolution;
	const mirrorY = ( resolution - y ) % resolution;
	const mirroredH0 = h0ForCell( cascade, mirrorX, mirrorY, deltaK );
	const coefficientBound = complexMagnitude( h0.value ) + complexMagnitude( mirroredH0.value );

	return {
		cascadeIndex: cascade.index,
		x,
		y,
		kx,
		kz,
		k: Math.max( k, MIN_K ),
		h0: h0.value,
		mirroredH0: mirroredH0.value,
		coefficientBound,
		omega: finiteDepthDispersion( Math.max( k, MIN_K ), cascade.depthMeters, cascade.gravity, cascade.capillarySurfaceTensionOverDensity )
	};
}

function evolveBin( bin, timeSeconds ) {
	const phase = [ Math.cos( bin.omega * timeSeconds ), Math.sin( bin.omega * timeSeconds ) ];
	return complexAdd(
		complexMul( bin.h0, phase ),
		complexMul( complexConjugate( bin.mirroredH0 ), complexConjugate( phase ) )
	);
}

function evaluateBins( bins, x, z, timeSeconds ) {
	let height = 0;
	for ( const bin of bins ) {
		const h = evolveBin( bin, timeSeconds );
		const phase = bin.kx * x + bin.kz * z;
		const spatial = complexMul( h, [ Math.cos( phase ), Math.sin( phase ) ] );
		height += spatial[ 0 ];
	}
	return height;
}

function makeCascadeBins( cascade ) {
	const bins = [];
	for ( let y = 0; y < cascade.resolution; y += 1 ) {
		for ( let x = 0; x < cascade.resolution; x += 1 ) {
			bins.push( makeFrequencyBin( cascade, x, y ) );
		}
	}
	return bins;
}

export function createCpuWaterHeightSampler( options = {} ) {
	const config = mergeOceanConfig( options );
	const dominantBinCount = options.dominantBinCount ?? DEFAULT_DOMINANT_BIN_COUNT;
	const cascades = createCascadeDescriptors( config );
	const cascadeBins = cascades.map( ( cascade ) => makeCascadeBins( cascade ) );
	const selectedBins = [];
	let omittedAmplitudeBound = 0;
	const truncationByCascade = [];

	for ( const [ cascadeIndex, bins ] of cascadeBins.entries() ) {
		const ranked = [ ...bins ].sort( ( a, b ) => b.coefficientBound - a.coefficientBound );
		const selected = ranked.slice( 0, dominantBinCount );
		const omitted = ranked.slice( dominantBinCount );
		const cascadeOmittedBound = omitted.reduce( ( sum, bin ) => sum + bin.coefficientBound, 0 );
		selectedBins.push( ...selected );
		omittedAmplitudeBound += cascadeOmittedBound;
		truncationByCascade.push( {
			cascadeIndex,
			selectedBinCount: selected.length,
			omittedBinCount: omitted.length,
			omittedAmplitudeBound: cascadeOmittedBound
		} );
	}

	return {
		model: 'dominant-bin-truncated-authoring-spectrum',
		config,
		dominantBinCount,
		selectedBins,
		getWaterHeight( x, z, timeSeconds ) {
			return evaluateBins( selectedBins, x, z, timeSeconds );
		},
		estimateTruncationError() {
			return {
				bound: omittedAmplitudeBound,
				formula: 'sum_{omitted bins} (|h0(k)| + |h0(-k)|)',
				byCascade: truncationByCascade
			};
		}
	};
}

export function createFullSpectrumWaterHeightMirror( options = {} ) {
	const config = mergeOceanConfig( options );
	const cascades = createCascadeDescriptors( config );
	const bins = cascades.flatMap( ( cascade ) => makeCascadeBins( cascade ) );

	return {
		model: 'full-pure-js-dft-spectrum-mirror',
		config,
		bins,
		getWaterHeight( x, z, timeSeconds ) {
			return evaluateBins( bins, x, z, timeSeconds );
		}
	};
}
