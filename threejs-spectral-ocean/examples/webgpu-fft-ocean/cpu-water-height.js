import {
	CAPILLARY_SURFACE_TENSION_OVER_DENSITY,
	TAU,
	createCascadeDescriptors,
	hashOceanSeedUnit,
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
		peakOmega: 22 * ( lobe.windSpeed * lobe.fetchMeters / ( gravity * gravity ) ) ** ( - 1 / 3 )
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
	const forwardCosine = Math.max( Math.cos( theta - directionAngle ), 0 );
	const broad = ( 2 / Math.PI ) * forwardCosine ** 2;
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

function gaussianPairCpu( x, y, seed ) {
	const u1 = hashOceanSeedUnit( x, y, seed, 17 );
	const u2 = hashOceanSeedUnit( x, y, seed, 53 );
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
	return Math.sqrt( Math.max( energy * 0.25 * derivative * deltaK * deltaK / kSafe, 0 ) ) * inBand;
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
	const phase = [ Math.cos( bin.omega * timeSeconds ), - Math.sin( bin.omega * timeSeconds ) ];
	return complexAdd(
		complexMul( bin.h0, phase ),
		complexMul( complexConjugate( bin.mirroredH0 ), complexConjugate( phase ) )
	);
}

function evaluateBinsAtParameter( bins, qx, qz, timeSeconds, choppiness ) {
	const fields = { height: 0, dx: 0, dz: 0, hx: 0, hz: 0, dxx: 0, dzz: 0, dxz: 0 };

	for ( const bin of bins ) {
		const h = evolveBin( bin, timeSeconds );
		const phaseAngle = bin.kx * qx + bin.kz * qz;
		const spatialPhase = [ Math.cos( phaseAngle ), Math.sin( phaseAngle ) ];
		const spatialHeight = complexMul( h, spatialPhase )[ 0 ];
		const iH = [ - h[ 1 ], h[ 0 ] ];
		const xOddMask = bin.x === 0 ? 0 : 1;
		const zOddMask = bin.y === 0 ? 0 : 1;
		const crossMask = xOddMask * zOddMask;
		const spatialReal = ( spectrum ) => complexMul( spectrum, spatialPhase )[ 0 ];

		fields.height += spatialHeight;
		fields.dx += spatialReal( [ iH[ 0 ] * bin.kx / bin.k * xOddMask, iH[ 1 ] * bin.kx / bin.k * xOddMask ] );
		fields.dz += spatialReal( [ iH[ 0 ] * bin.kz / bin.k * zOddMask, iH[ 1 ] * bin.kz / bin.k * zOddMask ] );
		fields.hx += spatialReal( [ iH[ 0 ] * bin.kx * xOddMask, iH[ 1 ] * bin.kx * xOddMask ] );
		fields.hz += spatialReal( [ iH[ 0 ] * bin.kz * zOddMask, iH[ 1 ] * bin.kz * zOddMask ] );
		fields.dxx += - bin.kx * bin.kx / bin.k * spatialHeight;
		fields.dzz += - bin.kz * bin.kz / bin.k * spatialHeight;
		fields.dxz += - bin.kx * bin.kz / bin.k * spatialHeight * crossMask;
	}

	const a = 1 + choppiness * fields.dxx;
	const b = choppiness * fields.dxz;
	const c = 1 + choppiness * fields.dzz;
	const jacobian = a * c - b * b;
	const normalRaw = [ fields.hz * b - c * fields.hx, jacobian, b * fields.hx - fields.hz * a ];
	const normalLength = Math.hypot( ...normalRaw );
	const normal = normalLength > 0 ? normalRaw.map( ( value ) => value / normalLength ) : [ 0, 1, 0 ];

	return {
		parameter: [ qx, qz ],
		position: [ qx + choppiness * fields.dx, fields.height, qz + choppiness * fields.dz ],
		height: fields.height,
		normal,
		jacobian,
		fields
	};
}

function evaluateBinsAtWorldXZ( bins, x, z, timeSeconds, choppiness, {
	maxIterations = 12,
	horizontalTolerance = 1e-6,
	minimumJacobianMagnitude = 1e-6
} = {} ) {
	let qx = x;
	let qz = z;
	let sample = null;
	let residual = Infinity;
	let lastIteration = 0;

	for ( let iteration = 0; iteration <= maxIterations; iteration += 1 ) {
		lastIteration = iteration;
		sample = evaluateBinsAtParameter( bins, qx, qz, timeSeconds, choppiness );
		const residualX = sample.position[ 0 ] - x;
		const residualZ = sample.position[ 2 ] - z;
		residual = Math.hypot( residualX, residualZ );
		if ( residual <= horizontalTolerance ) {
			return { ...sample, iterations: iteration, horizontalResidual: residual, status: 'converged' };
		}
		if ( iteration === maxIterations || Math.abs( sample.jacobian ) < minimumJacobianMagnitude ) break;

		const a = 1 + choppiness * sample.fields.dxx;
		const b = choppiness * sample.fields.dxz;
		const c = 1 + choppiness * sample.fields.dzz;
		const inverseDeterminant = 1 / sample.jacobian;
		qx -= ( c * residualX - b * residualZ ) * inverseDeterminant;
		qz -= ( - b * residualX + a * residualZ ) * inverseDeterminant;
	}

	return {
		...sample,
		iterations: lastIteration,
		horizontalResidual: residual,
		status: Math.abs( sample?.jacobian ?? 0 ) < minimumJacobianMagnitude ? 'singular-horizontal-map' : 'iteration-limit'
	};
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

function compareBinRank( a, b ) {
	if ( a.coefficientBound !== b.coefficientBound ) return a.coefficientBound - b.coefficientBound;
	if ( a.y !== b.y ) return b.y - a.y;
	return b.x - a.x;
}

function heapPushLowestFirst( heap, bin ) {
	heap.push( bin );
	let index = heap.length - 1;
	while ( index > 0 ) {
		const parent = Math.floor( ( index - 1 ) / 2 );
		if ( compareBinRank( heap[ index ], heap[ parent ] ) >= 0 ) break;
		[ heap[ index ], heap[ parent ] ] = [ heap[ parent ], heap[ index ] ];
		index = parent;
	}
}

function heapReplaceLowest( heap, bin ) {
	heap[ 0 ] = bin;
	let index = 0;
	while ( true ) {
		const left = index * 2 + 1;
		const right = left + 1;
		let lowest = index;
		if ( left < heap.length && compareBinRank( heap[ left ], heap[ lowest ] ) < 0 ) lowest = left;
		if ( right < heap.length && compareBinRank( heap[ right ], heap[ lowest ] ) < 0 ) lowest = right;
		if ( lowest === index ) break;
		[ heap[ index ], heap[ lowest ] ] = [ heap[ lowest ], heap[ index ] ];
		index = lowest;
	}
}

function selectDominantCascadeBins( cascade, requestedCount ) {
	const count = Math.min( requestedCount, cascade.resolution * cascade.resolution );
	const heap = [];
	let totalAmplitudeBound = 0;
	let totalSlopeBound = 0;

	for ( let y = 0; y < cascade.resolution; y += 1 ) {
		for ( let x = 0; x < cascade.resolution; x += 1 ) {
			const bin = makeFrequencyBin( cascade, x, y );
			totalAmplitudeBound += bin.coefficientBound;
			totalSlopeBound += bin.k * bin.coefficientBound;
			if ( heap.length < count ) {
				heapPushLowestFirst( heap, bin );
			} else if ( compareBinRank( bin, heap[ 0 ] ) > 0 ) {
				heapReplaceLowest( heap, bin );
			}
		}
	}

	const selected = heap.sort( ( a, b ) => compareBinRank( b, a ) );
	const selectedAmplitudeBound = selected.reduce( ( sum, bin ) => sum + bin.coefficientBound, 0 );
	const selectedSlopeBound = selected.reduce( ( sum, bin ) => sum + bin.k * bin.coefficientBound, 0 );
	return {
		selected,
		generatedBinCount: cascade.resolution * cascade.resolution,
		omittedAmplitudeBound: Math.max( 0, totalAmplitudeBound - selectedAmplitudeBound ),
		omittedSlopeBound: Math.max( 0, totalSlopeBound - selectedSlopeBound ),
		totalSlopeBound
	};
}

export function createCpuWaterHeightSampler( options = {} ) {
	const config = mergeOceanConfig( options );
	const dominantBinCount = options.dominantBinCount ?? DEFAULT_DOMINANT_BIN_COUNT;
	if ( ! Number.isInteger( dominantBinCount ) || dominantBinCount < 1 ) {
		throw new Error( `dominantBinCount must be a positive integer; got ${ dominantBinCount }.` );
	}
	const cascades = createCascadeDescriptors( config );
	const selectedBins = [];
	let omittedAmplitudeBound = 0;
	let omittedSlopeBound = 0;
	let allGradientBound = 0;
	const truncationByCascade = [];

	for ( const [ cascadeIndex, cascade ] of cascades.entries() ) {
		const selection = selectDominantCascadeBins( cascade, dominantBinCount );
		const selected = selection.selected;
		const cascadeOmittedBound = selection.omittedAmplitudeBound;
		const cascadeOmittedSlopeBound = selection.omittedSlopeBound;
		selectedBins.push( ...selected );
		omittedAmplitudeBound += cascadeOmittedBound;
		omittedSlopeBound += cascadeOmittedSlopeBound;
		allGradientBound += selection.totalSlopeBound;
		truncationByCascade.push( {
			cascadeIndex,
			selectedBinCount: selected.length,
			omittedBinCount: selection.generatedBinCount - selected.length,
			omittedAmplitudeBound: cascadeOmittedBound,
			omittedSlopeBound: cascadeOmittedSlopeBound
		} );
	}
	const contractionBound = config.choppiness * allGradientBound;
	const worldHeightBound = contractionBound < 1
		? omittedAmplitudeBound + allGradientBound * config.choppiness * omittedAmplitudeBound / ( 1 - contractionBound )
		: null;
	const solverOptions = {
		maxIterations: options.maxIterations,
		horizontalTolerance: options.horizontalTolerance,
		minimumJacobianMagnitude: options.minimumJacobianMagnitude
	};

	return {
		model: 'dominant-bin-truncated-spectrum-with-eulerian-inversion',
		config,
		dominantBinCount,
		selectedBins,
		sampleAtParameter( qx, qz, timeSeconds ) {
			return evaluateBinsAtParameter( selectedBins, qx, qz, timeSeconds, config.choppiness );
		},
		sampleAtWorldXZ( x, z, timeSeconds ) {
			return evaluateBinsAtWorldXZ( selectedBins, x, z, timeSeconds, config.choppiness, solverOptions );
		},
		getParametricWaterHeight( qx, qz, timeSeconds ) {
			return evaluateBinsAtParameter( selectedBins, qx, qz, timeSeconds, config.choppiness ).height;
		},
		getWaterHeight( x, z, timeSeconds ) {
			const sample = evaluateBinsAtWorldXZ( selectedBins, x, z, timeSeconds, config.choppiness, solverOptions );
			if ( sample.status !== 'converged' ) throw new Error( `Spectral water horizontal inversion failed: ${ sample.status }.` );
			return sample.height;
		},
		estimateTruncationError() {
			return {
				parameterHeightBound: omittedAmplitudeBound,
				parameterSlopeBound: omittedSlopeBound,
				worldHeightBound,
				contractionBound,
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
	const solverOptions = {
		maxIterations: options.maxIterations,
		horizontalTolerance: options.horizontalTolerance,
		minimumJacobianMagnitude: options.minimumJacobianMagnitude
	};

	return {
		model: 'full-pure-js-dft-spectrum-mirror',
		config,
		bins,
		sampleAtParameter( qx, qz, timeSeconds ) {
			return evaluateBinsAtParameter( bins, qx, qz, timeSeconds, config.choppiness );
		},
		sampleAtWorldXZ( x, z, timeSeconds ) {
			return evaluateBinsAtWorldXZ( bins, x, z, timeSeconds, config.choppiness, solverOptions );
		},
		getParametricWaterHeight( qx, qz, timeSeconds ) {
			return evaluateBinsAtParameter( bins, qx, qz, timeSeconds, config.choppiness ).height;
		},
		getWaterHeight( x, z, timeSeconds ) {
			const sample = evaluateBinsAtWorldXZ( bins, x, z, timeSeconds, config.choppiness, solverOptions );
			if ( sample.status !== 'converged' ) throw new Error( `Full spectral mirror inversion failed: ${ sample.status }.` );
			return sample.height;
		}
	};
}
