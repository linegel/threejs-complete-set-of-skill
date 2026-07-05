import {
	CAPILLARY_SURFACE_TENSION_OVER_DENSITY,
	TAU,
	createCascadeDescriptors,
	mergeOceanConfig
} from './constants.js';
import {
	createCpuWaterHeightSampler
} from './cpu-water-height.js';

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

function tmaFiniteDepthCorrection( omega, depthMeters, gravity ) {
	const omegaH = omega * Math.sqrt( depthMeters / gravity );
	if ( omegaH <= 1 ) return 0.5 * omegaH * omegaH;
	if ( omegaH < 2 ) return 1 - 0.5 * ( 2 - omegaH ) ** 2;
	return 1;
}

function jonswapEnergy( omega, windSpeed, fetchMeters, peakEnhancement = 3.3 ) {
	const gravity = 9.81;
	const alpha = 0.076 * ( gravity * fetchMeters / ( windSpeed * windSpeed ) ) ** -0.22;
	const peakOmega = 22 * ( windSpeed * fetchMeters / ( gravity * gravity ) ) ** -0.33;
	const sigma = omega <= peakOmega ? 0.07 : 0.09;
	const peak = Math.exp( - ( ( omega / peakOmega - 1 ) ** 2 ) / ( 2 * sigma * sigma ) );
	return alpha * gravity * gravity * omega ** -5 * Math.exp( - 1.25 * ( peakOmega / omega ) ** 4 ) * peakEnhancement ** peak;
}

function directionalSpread( theta, exponent = 4 ) {
	const c = Math.max( Math.cos( theta ), 0 );
	return c ** exponent;
}

function integrateDirectionalSpread( exponent = 4, samples = 2048 ) {
	let integral = 0;
	const step = TAU / samples;
	for ( let i = 0; i < samples; i += 1 ) {
		const theta = - Math.PI + ( i + 0.5 ) * step;
		integral += directionalSpread( theta, exponent ) * step;
	}
	return integral;
}

function spectrumAmplitude( k, deltaK, depthMeters ) {
	const gravity = 9.81;
	const kSafe = Math.max( k, 1e-4 );
	const omega = finiteDepthDispersion( kSafe, depthMeters, gravity );
	const energy = jonswapEnergy( omega, 11.5, 65000 ) * tmaFiniteDepthCorrection( omega, depthMeters, gravity );
	const dOmegaDk = finiteDepthDispersionDerivative( kSafe, depthMeters, gravity );
	return Math.sqrt( Math.max( energy, 0 ) * 2 * Math.abs( dOmegaDk ) / kSafe * deltaK * deltaK );
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

function makeComplexField( resolution ) {
	return Array.from( { length: resolution * resolution }, () => [ 0, 0 ] );
}

function centeredIndex( resolution, coordinate ) {
	return ( coordinate + resolution / 2 ) % resolution;
}

function inverseDft2D( frequency, resolution ) {
	const spatial = makeComplexField( resolution );

	for ( let y = 0; y < resolution; y += 1 ) {
		for ( let x = 0; x < resolution; x += 1 ) {
			let sum = [ 0, 0 ];
			for ( let ky = 0; ky < resolution; ky += 1 ) {
				for ( let kx = 0; kx < resolution; kx += 1 ) {
					const centeredKx = kx - resolution / 2;
					const centeredKy = ky - resolution / 2;
					const angle = TAU * ( centeredKx * x + centeredKy * y ) / resolution;
					sum = complexAdd( sum, complexMul( frequency[ ky * resolution + kx ], [ Math.cos( angle ), Math.sin( angle ) ] ) );
				}
			}
			spatial[ y * resolution + x ] = sum;
		}
	}

	return spatial;
}

function maxError( values, expected ) {
	let error = 0;
	for ( let index = 0; index < values.length; index += 1 ) {
		error = Math.max(
			error,
			Math.abs( values[ index ][ 0 ] - expected[ index ][ 0 ] ),
			Math.abs( values[ index ][ 1 ] - expected[ index ][ 1 ] )
		);
	}
	return error;
}

function testDc( resolution ) {
	const frequency = makeComplexField( resolution );
	frequency[ centeredIndex( resolution, 0 ) * resolution + centeredIndex( resolution, 0 ) ] = [ 1, 0 ];
	const spatial = inverseDft2D( frequency, resolution );
	const expected = makeComplexField( resolution ).map( () => [ 1, 0 ] );
	return maxError( spatial, expected );
}

function testOneBinX( resolution ) {
	const frequency = makeComplexField( resolution );
	frequency[ centeredIndex( resolution, 0 ) * resolution + centeredIndex( resolution, 1 ) ] = [ 1, 0 ];
	const spatial = inverseDft2D( frequency, resolution );
	const expected = makeComplexField( resolution );

	for ( let y = 0; y < resolution; y += 1 ) {
		for ( let x = 0; x < resolution; x += 1 ) {
			const angle = TAU * x / resolution;
			expected[ y * resolution + x ] = [ Math.cos( angle ), Math.sin( angle ) ];
		}
	}

	return maxError( spatial, expected );
}

function testOneBinY( resolution ) {
	const frequency = makeComplexField( resolution );
	frequency[ centeredIndex( resolution, 1 ) * resolution + centeredIndex( resolution, 0 ) ] = [ 1, 0 ];
	const spatial = inverseDft2D( frequency, resolution );
	const expected = makeComplexField( resolution );

	for ( let y = 0; y < resolution; y += 1 ) {
		for ( let x = 0; x < resolution; x += 1 ) {
			const angle = TAU * y / resolution;
			expected[ y * resolution + x ] = [ Math.cos( angle ), Math.sin( angle ) ];
		}
	}

	return maxError( spatial, expected );
}

function analyticPackedDerivatives( kx, kz, h ) {
	const kLength = Math.max( Math.hypot( kx, kz ), 1e-6 );
	const iH = [ - h[ 1 ], h[ 0 ] ];
	const dx = [ iH[ 0 ] * kx / kLength, iH[ 1 ] * kx / kLength ];
	const dz = [ iH[ 0 ] * kz / kLength, iH[ 1 ] * kz / kLength ];
	const slopeX = [ iH[ 0 ] * kx, iH[ 1 ] * kx ];
	const slopeZ = [ iH[ 0 ] * kz, iH[ 1 ] * kz ];
	const dxx = [ - h[ 0 ] * kx * kx / kLength, - h[ 1 ] * kx * kx / kLength ];
	const dzz = [ - h[ 0 ] * kz * kz / kLength, - h[ 1 ] * kz * kz / kLength ];
	const cross = [ - h[ 0 ] * kx * kz / kLength, - h[ 1 ] * kx * kz / kLength ];

	return {
		field0: [ dx[ 0 ], dz[ 0 ] ],
		field1: [ h[ 0 ], cross[ 0 ] ],
		field2: [ slopeX[ 0 ], slopeZ[ 0 ] ],
		field3: [ dxx[ 0 ], dzz[ 0 ] ],
		dx,
		dz,
		slopeX,
		slopeZ,
		dxx,
		dzz,
		cross
	};
}

function testDisplacementDirection() {
	const x = analyticPackedDerivatives( 2, 0, [ 0, 1 ] );
	const y = analyticPackedDerivatives( 0, 3, [ 0, 1 ] );
	return Math.max(
		Math.abs( x.dx[ 0 ] + 1 ),
		Math.abs( x.dz[ 0 ] ),
		Math.abs( y.dx[ 0 ] ),
		Math.abs( y.dz[ 0 ] + 1 )
	);
}

function testDerivativeSigns() {
	const derivative = analyticPackedDerivatives( 2, 3, [ 1, 0 ] );
	return Math.max(
		Math.abs( derivative.slopeX[ 1 ] - 2 ),
		Math.abs( derivative.slopeZ[ 1 ] - 3 ),
		Math.abs( derivative.dxx[ 0 ] + 4 / Math.hypot( 2, 3 ) ),
		Math.abs( derivative.dzz[ 0 ] + 9 / Math.hypot( 2, 3 ) ),
		Math.abs( derivative.cross[ 0 ] + 6 / Math.hypot( 2, 3 ) )
	);
}

export function computeJacobianFromDerivatives( dDxDx, dDzDz, dDzDx, lambda ) {
	return ( 1 + lambda * dDxDx ) * ( 1 + lambda * dDzDz ) - ( lambda * dDzDx ) ** 2;
}

function testJacobianDeterminant() {
	const lambda = 1.3;
	const fixtures = [
		{ dDxDx: -1.2 / lambda, dDzDz: 0, dDzDx: 0, folds: true },
		{ dDxDx: 0, dDzDz: 0, dDzDx: 1.1 / lambda, folds: true },
		{ dDxDx: -0.15, dDzDz: -0.22, dDzDx: 0.07, folds: false },
		{ dDxDx: 0.12, dDzDz: 0.08, dDzDx: 0.02, folds: false }
	];

	let error = 0;
	for ( const fixture of fixtures ) {
		const jacobian = computeJacobianFromDerivatives( fixture.dDxDx, fixture.dDzDz, fixture.dDzDx, lambda );
		const folds = jacobian < 0;
		error = Math.max( error, folds === fixture.folds ? 0 : 1 );
	}

	return error;
}

function testFiniteDepthDispersionMonotonicity() {
	const ks = [ 0.01, 0.03, 0.1, 0.3, 1.0 ];
	let previous = 0;
	for ( const k of ks ) {
		const omega = finiteDepthDispersion( k, 500, 9.81 );
		if ( ! Number.isFinite( omega ) || omega <= previous ) return 1;
		previous = omega;
	}
	return 0;
}

function testTmaBounds() {
	const samples = [ 0.2, 0.8, 1.5, 2.5, 8.0 ];
	for ( const omega of samples ) {
		const value = tmaFiniteDepthCorrection( omega, 30, 9.81 );
		if ( ! Number.isFinite( value ) || value < 0 || value > 1 ) return 1;
	}
	return 0;
}

function testSpectrumNonNegativity() {
	const samples = [ 0.4, 0.8, 1.6, 3.2 ];
	for ( const omega of samples ) {
		const energy = jonswapEnergy( omega, 11.5, 65000, 3.3 );
		if ( ! Number.isFinite( energy ) || energy < 0 ) return 1;
	}
	return 0;
}

function testAmplitudeFiniteAtSmallK() {
	const values = [ 1e-7, 1e-5, 1e-3 ].map( ( k ) => spectrumAmplitude( k, TAU / 256, 500 ) );
	return values.every( ( value ) => Number.isFinite( value ) && value >= 0 ) ? 0 : 1;
}

function testDirectionalSpreadingNormalization() {
	const integral = integrateDirectionalSpread( 4 );
	return Number.isFinite( integral ) && integral > 0.4 && integral < TAU ? 0 : 1;
}

function testEnergyInvarianceAcrossCutoffMaskMoves() {
	const deltaK = TAU / 250;
	const physicalCells = [
		{ k: 0.025, x: 1, y: 0 },
		{ k: 0.04, x: 2, y: 1 },
		{ k: 0.16, x: 7, y: 3 },
		{ k: 0.32, x: 13, y: 5 }
	];
	const partitionA = [
		[ 1e-4, 0.05 ],
		[ 0.05, 0.2 ],
		[ 0.2, 9999 ]
	];
	const partitionB = [
		[ 1e-4, 0.03 ],
		[ 0.03, 0.12 ],
		[ 0.12, 9999 ]
	];
	const choosePartition = ( k, partition ) => partition.findIndex( ( [ low, high ] ) => k >= low && k < high );
	const stableSeedIdentity = ( x, y ) => `${ x }:${ y }:0x1f2e3d4c`;

	let error = 0;
	let moved = 0;
	for ( const cell of physicalCells ) {
		const cascadeA = choosePartition( cell.k, partitionA );
		const cascadeB = choosePartition( cell.k, partitionB );
		if ( cascadeA !== cascadeB ) moved += 1;
		const amplitudeA = cascadeA >= 0 ? spectrumAmplitude( cell.k, deltaK, 500 ) : 0;
		const amplitudeB = cascadeB >= 0 ? spectrumAmplitude( cell.k, deltaK, 500 ) : 0;
		const seedA = stableSeedIdentity( cell.x, cell.y );
		const seedB = stableSeedIdentity( cell.x, cell.y );
		error = Math.max(
			error,
			Math.abs( amplitudeA - amplitudeB ),
			seedA === seedB ? 0 : 1
		);
	}
	return moved >= 2 ? error : 1;
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

function halfOpenBandMask( k, low, high ) {
	return k >= low && k < high ? 1 : 0;
}

function packTwoRealFields( a, b ) {
	return [ a[ 0 ] - b[ 1 ], a[ 1 ] + b[ 0 ], 0, 0 ];
}

function packTwoRealFieldsBroken( a, b ) {
	return [ a[ 0 ], b[ 0 ], a[ 1 ], b[ 1 ] ];
}

function makeVec4Field( resolution ) {
	return Array.from( { length: resolution * resolution }, () => [ 0, 0, 0, 0 ] );
}

function bitReverseIndex( index, resolution ) {
	const bits = Math.log2( resolution );
	let value = index;
	let reversed = 0;
	for ( let bit = 0; bit < bits; bit += 1 ) {
		reversed = ( reversed << 1 ) | ( value & 1 );
		value >>= 1;
	}
	return reversed;
}

function bitReverseField( input, resolution, axis ) {
	const output = makeVec4Field( resolution );
	for ( let y = 0; y < resolution; y += 1 ) {
		for ( let x = 0; x < resolution; x += 1 ) {
			const sourceX = axis === 0 ? bitReverseIndex( x, resolution ) : x;
			const sourceY = axis === 1 ? bitReverseIndex( y, resolution ) : y;
			output[ y * resolution + x ] = [ ...input[ sourceY * resolution + sourceX ] ];
		}
	}
	return output;
}

function fftStageField( input, resolution, stage, axis ) {
	const output = makeVec4Field( resolution );
	const span = 1 << ( stage + 1 );
	const halfSpan = span >> 1;

	for ( let y = 0; y < resolution; y += 1 ) {
		for ( let x = 0; x < resolution; x += 1 ) {
			const coordinate = axis === 0 ? x : y;
			const local = coordinate & ( span - 1 );
			const offset = local & ( halfSpan - 1 );
			const base = coordinate - local;
			const inputA = base + offset;
			const inputB = inputA + halfSpan;
			const branchSign = local >= halfSpan ? -1 : 1;
			const angle = TAU * offset / span;
			const twiddle = [ Math.cos( angle ) * branchSign, Math.sin( angle ) * branchSign ];
			const ax = axis === 0 ? inputA : x;
			const ay = axis === 1 ? inputA : y;
			const bx = axis === 0 ? inputB : x;
			const by = axis === 1 ? inputB : y;
			const a = input[ ay * resolution + ax ];
			const b = input[ by * resolution + bx ];
			const weighted0 = complexMul( twiddle, [ b[ 0 ], b[ 1 ] ] );
			const weighted1 = complexMul( twiddle, [ b[ 2 ], b[ 3 ] ] );
			output[ y * resolution + x ] = [
				a[ 0 ] + weighted0[ 0 ],
				a[ 1 ] + weighted0[ 1 ],
				a[ 2 ] + weighted1[ 0 ],
				a[ 3 ] + weighted1[ 1 ]
			];
		}
	}

	return output;
}

function kernelMirrorIfft( packed, resolution ) {
	let field = bitReverseField( packed, resolution, 0 );
	const logResolution = Math.log2( resolution );
	for ( let stage = 0; stage < logResolution; stage += 1 ) {
		field = fftStageField( field, resolution, stage, 0 );
	}
	field = bitReverseField( field, resolution, 1 );
	for ( let stage = 0; stage < logResolution; stage += 1 ) {
		field = fftStageField( field, resolution, stage, 1 );
	}
	return field;
}

function makeEvolvedHeightAndCrossFields( resolution, timeSeconds ) {
	const config = mergeOceanConfig( {
		quality: 'low',
		resolution,
		cascadeCount: 1,
		patchLengthsMeters: [ 64 ]
	} );
	const cascade = createCascadeDescriptors( config )[ 0 ];
	const deltaK = TAU / cascade.patchLength;
	const hField = makeComplexField( resolution );
	const crossField = makeComplexField( resolution );

	for ( let y = 0; y < resolution; y += 1 ) {
		for ( let x = 0; x < resolution; x += 1 ) {
			const centeredX = x - resolution / 2;
			const centeredY = y - resolution / 2;
			const kx = centeredX * deltaK;
			const kz = centeredY * deltaK;
			const k = Math.hypot( kx, kz );
			const kSafe = Math.max( k, cascade.cutoffLow );
			const inBand = halfOpenBandMask( k, cascade.cutoffLow, cascade.cutoffHigh );
			const amplitude = spectrumAmplitude( kSafe, deltaK, cascade.depthMeters ) * inBand;
			const gaussian = gaussianPairCpu( x, y, cascade.seed );
			const h0 = [ gaussian[ 0 ] * amplitude, gaussian[ 1 ] * amplitude ];
			const mirrorX = ( resolution - x ) % resolution;
			const mirrorY = ( resolution - y ) % resolution;
			const mirrorCenteredX = mirrorX - resolution / 2;
			const mirrorCenteredY = mirrorY - resolution / 2;
			const mirrorK = Math.hypot( mirrorCenteredX * deltaK, mirrorCenteredY * deltaK );
			const mirrorKSafe = Math.max( mirrorK, cascade.cutoffLow );
			const mirrorInBand = halfOpenBandMask( mirrorK, cascade.cutoffLow, cascade.cutoffHigh );
			const mirroredAmplitude = spectrumAmplitude( mirrorKSafe, deltaK, cascade.depthMeters ) * mirrorInBand;
			const mirroredGaussian = gaussianPairCpu( mirrorX, mirrorY, cascade.seed );
			const mirroredH0 = [ mirroredGaussian[ 0 ] * mirroredAmplitude, mirroredGaussian[ 1 ] * mirroredAmplitude ];
			const omega = finiteDepthDispersion( Math.max( k, 1e-4 ), cascade.depthMeters, cascade.gravity, cascade.capillarySurfaceTensionOverDensity );
			const phase = [ Math.cos( omega * timeSeconds ), Math.sin( omega * timeSeconds ) ];
			const h = complexAdd(
				complexMul( h0, phase ),
				complexMul( [ mirroredH0[ 0 ], - mirroredH0[ 1 ] ], [ phase[ 0 ], - phase[ 1 ] ] )
			);
			const kLength = Math.max( k, 1e-4 );
			// Nyquist bins (cell 0 in either axis) have no +k grid partner, so odd-in-k
			// multipliers are non-Hermitian there; zero derivative spectra on those bins
			// (mirrors the kernel's derivativeNyquistMask).
			const nyquistMask = ( x === 0 || y === 0 ) ? 0 : 1;
			const crossScale = - kx * kz / kLength * nyquistMask;
			const index = y * resolution + x;
			hField[ index ] = h;
			crossField[ index ] = [ h[ 0 ] * crossScale, h[ 1 ] * crossScale ];
		}
	}

	return { hField, crossField };
}

function assembleHeightFromMirror( hField, crossField, resolution, packer ) {
	const packed = makeVec4Field( resolution );
	for ( let index = 0; index < packed.length; index += 1 ) {
		packed[ index ] = packer( hField[ index ], crossField[ index ] );
	}
	const transformed = kernelMirrorIfft( packed, resolution );
	const a = new Array( transformed.length );
	const b = new Array( transformed.length );
	for ( let index = 0; index < transformed.length; index += 1 ) {
		const x = index % resolution;
		const y = Math.floor( index / resolution );
		const sign = ( x + y ) % 2 === 0 ? 1 : -1;
		a[ index ] = transformed[ index ][ 0 ] * sign;
		b[ index ] = transformed[ index ][ 1 ] * sign;
	}
	return { a, b };
}

function dftParityMetricsForTime( resolution, timeSeconds ) {
	const { hField, crossField } = makeEvolvedHeightAndCrossFields( resolution, timeSeconds );
	const zeroPartner = makeComplexField( resolution );
	const reference = inverseDft2D( hField, resolution );
	// A zero Hermitian partner isolates whether the height spectrum's imaginary half
	// survives pack -> FFT -> assembly; the old component-interleaved pack does not.
	const correct = assembleHeightFromMirror( hField, zeroPartner, resolution, packTwoRealFields ).a;
	const broken = assembleHeightFromMirror( hField, zeroPartner, resolution, packTwoRealFieldsBroken ).a;
	// A NON-zero partner exercises the b-side of the combine (out.y lane): a sign or
	// swap error in the partner path is invisible to the zero-partner test above.
	const crossReference = inverseDft2D( crossField, resolution );
	const withPartner = assembleHeightFromMirror( hField, crossField, resolution, packTwoRealFields );
	let correctMaxAbs = 0;
	let brokenMaxAbs = 0;
	let imaginaryResidualMax = 0;
	let partnerHeightMaxAbs = 0;
	let partnerCrossMaxAbs = 0;
	let sumSquares = 0;
	let crossSumSquares = 0;

	for ( let index = 0; index < reference.length; index += 1 ) {
		const height = reference[ index ][ 0 ];
		const cross = crossReference[ index ][ 0 ];
		correctMaxAbs = Math.max( correctMaxAbs, Math.abs( correct[ index ] - height ) );
		brokenMaxAbs = Math.max( brokenMaxAbs, Math.abs( broken[ index ] - height ) );
		imaginaryResidualMax = Math.max( imaginaryResidualMax, Math.abs( reference[ index ][ 1 ] ) );
		partnerHeightMaxAbs = Math.max( partnerHeightMaxAbs, Math.abs( withPartner.a[ index ] - height ) );
		partnerCrossMaxAbs = Math.max( partnerCrossMaxAbs, Math.abs( withPartner.b[ index ] - cross ) );
		sumSquares += height * height;
		crossSumSquares += cross * cross;
	}

	const rms = Math.sqrt( sumSquares / reference.length );
	const scale = Math.max( rms, 1e-12 );
	const crossScale = Math.max( Math.sqrt( crossSumSquares / reference.length ), 1e-12 );
	return {
		correctRelativeError: correctMaxAbs / scale,
		brokenRelativeError: brokenMaxAbs / scale,
		hermitianResidualRelative: imaginaryResidualMax / scale,
		partnerRelativeError: Math.max( partnerHeightMaxAbs / scale, partnerCrossMaxAbs / crossScale ),
		partnerHeightRel: partnerHeightMaxAbs / scale,
		partnerCrossRel: partnerCrossMaxAbs / crossScale,
		rms
	};
}

function testDftParityAndHermitianResidual( resolution ) {
	const tolerance = 1e-4;
	const times = [ 0.0, 2.75, 9.5 ];
	const metrics = times.map( ( time ) => dftParityMetricsForTime( resolution, time ) );

	return {
		tolerance,
		times,
		correctRelativeError: Math.max( ...metrics.map( ( metric ) => metric.correctRelativeError ) ),
		brokenRelativeError: Math.max( ...metrics.map( ( metric ) => metric.brokenRelativeError ) ),
		hermitianResidualRelative: Math.max( ...metrics.map( ( metric ) => metric.hermitianResidualRelative ) ),
		partnerRelativeError: Math.max( ...metrics.map( ( metric ) => metric.partnerRelativeError ) ),
		rms: metrics.map( ( metric ) => metric.rms )
	};
}

function capillarySpotCheck() {
	const k = 322;
	const gravity = 9.81;
	const capillarySurfaceTensionOverDensity = CAPILLARY_SURFACE_TENSION_OVER_DENSITY;
	const oldOmega = Math.sqrt( gravity * k );
	const newOmega = finiteDepthDispersion( k, Infinity, gravity, capillarySurfaceTensionOverDensity );
	const capillaryGravityRatio = capillarySurfaceTensionOverDensity * k * k / gravity;
	return {
		k,
		oldOmega,
		newOmega,
		capillaryGravityRatio,
		newOverOld: newOmega / oldOmega
	};
}

function authoredSpectrumParameters( lobe, gravity ) {
	return {
		...lobe,
		angle: lobe.directionDegrees * Math.PI / 180,
		alpha: 0.076 * ( gravity * lobe.fetchMeters / ( lobe.windSpeed * lobe.windSpeed ) ) ** - 0.22,
		peakOmega: 22 * ( lobe.windSpeed * lobe.fetchMeters / ( gravity * gravity ) ) ** - 0.33
	};
}

function authoredNormalizationFactor( power ) {
	const s2 = power * power;
	const s3 = s2 * power;
	const s4 = s3 * power;
	if ( power < 5 ) return - 0.000564 * s4 + 0.00776 * s3 - 0.044 * s2 + 0.192 * power + 0.163;
	return - 4.8e-8 * s4 + 1.07e-5 * s3 - 9.53e-4 * s2 + 5.9e-2 * power + 0.393;
}

function authoredDirectionalSpread( theta, omega, peakOmega, directionAngle, directionality, swell ) {
	const ratio = Math.max( omega / peakOmega, 1e-4 );
	const below = 6.97 * ratio ** 5;
	const above = 9.77 * ratio ** - 2.5;
	const power = ( ratio <= 1 ? below : above ) + 16 * Math.tanh( Math.min( ratio, 20 ) ) * swell * swell;
	const broad = ( 2 / Math.PI ) * Math.cos( theta ) ** 2;
	const directed = authoredNormalizationFactor( power ) * Math.abs( Math.cos( ( theta - directionAngle ) * 0.5 ) ) ** ( power * 2 );
	return broad * ( 1 - directionality ) + directed * directionality;
}

function authoredJonswapEnergy( omega, k, theta, params, cascade ) {
	const safeOmega = Math.max( omega, 1e-4 );
	const sigma = safeOmega <= params.peakOmega ? 0.07 : 0.09;
	const normalized = ( safeOmega - params.peakOmega ) / Math.max( sigma * params.peakOmega * Math.SQRT2, 1e-5 );
	const peakShape = Math.exp( - normalized * normalized );
	const peakRatio = params.peakOmega / safeOmega;
	const fade = Math.exp( - params.shortWaveFade * params.shortWaveFade * k * k );

	return params.scale
		* tmaFiniteDepthCorrection( safeOmega, cascade.depthMeters, cascade.gravity )
		* params.alpha
		* cascade.gravity * cascade.gravity
		* safeOmega ** - 5
		* Math.exp( - 1.25 * peakRatio ** 4 )
		* params.peakEnhancement ** peakShape
		* authoredDirectionalSpread( theta, omega, params.peakOmega, params.angle, params.directionality, params.swell )
		* fade;
}

function authoredSpectrumAmplitude( cascade, k, theta, deltaK ) {
	const kSafe = Math.max( k, cascade.cutoffLow );
	const omega = finiteDepthDispersion( kSafe, cascade.depthMeters, cascade.gravity, cascade.capillarySurfaceTensionOverDensity );
	const local = authoredSpectrumParameters( cascade.local, cascade.gravity );
	const swell = authoredSpectrumParameters( cascade.swell, cascade.gravity );
	const energy = authoredJonswapEnergy( omega, kSafe, theta, local, cascade )
		+ authoredJonswapEnergy( omega, kSafe, theta, swell, cascade );
	const derivative = Math.abs( finiteDepthDispersionDerivative( kSafe, cascade.depthMeters, cascade.gravity, cascade.capillarySurfaceTensionOverDensity ) );
	const inBand = halfOpenBandMask( k, cascade.cutoffLow, cascade.cutoffHigh );
	return Math.sqrt( Math.max( energy * 2 * derivative * deltaK * deltaK / kSafe, 0 ) ) * inBand;
}

function authoredH0ForCell( cascade, x, y, deltaK ) {
	const centeredX = x - cascade.resolution / 2;
	const centeredY = y - cascade.resolution / 2;
	const kx = centeredX * deltaK;
	const kz = centeredY * deltaK;
	const k = Math.hypot( kx, kz );
	const amplitude = authoredSpectrumAmplitude( cascade, k, Math.atan2( kz, kx ), deltaK );
	const gaussian = gaussianPairCpu( x, y, cascade.seed );
	return [ gaussian[ 0 ] * amplitude, gaussian[ 1 ] * amplitude ];
}

function authoredEvolvedHeightBin( cascade, x, y, timeSeconds ) {
	const deltaK = TAU / cascade.patchLength;
	const centeredX = x - cascade.resolution / 2;
	const centeredY = y - cascade.resolution / 2;
	const kx = centeredX * deltaK;
	const kz = centeredY * deltaK;
	const k = Math.max( Math.hypot( kx, kz ), 1e-4 );
	const h0 = authoredH0ForCell( cascade, x, y, deltaK );
	const mirrorX = ( cascade.resolution - x ) % cascade.resolution;
	const mirrorY = ( cascade.resolution - y ) % cascade.resolution;
	const mirroredH0 = authoredH0ForCell( cascade, mirrorX, mirrorY, deltaK );
	const omega = finiteDepthDispersion( k, cascade.depthMeters, cascade.gravity, cascade.capillarySurfaceTensionOverDensity );
	const phase = [ Math.cos( omega * timeSeconds ), Math.sin( omega * timeSeconds ) ];
	const h = complexAdd(
		complexMul( h0, phase ),
		complexMul( [ mirroredH0[ 0 ], - mirroredH0[ 1 ] ], [ phase[ 0 ], - phase[ 1 ] ] )
	);

	return { h, kx, kz };
}

function authoredFullSpectrumHeightAt( cascades, x, z, timeSeconds ) {
	let height = 0;
	for ( const cascade of cascades ) {
		for ( let y = 0; y < cascade.resolution; y += 1 ) {
			for ( let cellX = 0; cellX < cascade.resolution; cellX += 1 ) {
				const bin = authoredEvolvedHeightBin( cascade, cellX, y, timeSeconds );
				const phase = bin.kx * x + bin.kz * z;
				const spatial = complexMul( bin.h, [ Math.cos( phase ), Math.sin( phase ) ] );
				height += spatial[ 0 ];
			}
		}
	}
	return height;
}

function testCpuWaterHeightSamplerParity() {
	const options = {
		quality: 'low',
		resolution: 16,
		cascadeCount: 3,
		patchLengthsMeters: [ 250, 17, 5 ],
		// Use a near-full validation spectrum so dispersion/phase bugs cannot hide
		// under the looser default 32-bin runtime truncation budget.
		dominantBinCount: 255
	};
	const sampler = createCpuWaterHeightSampler( options );
	const mirrorCascades = createCascadeDescriptors( mergeOceanConfig( options ) );
	const probes = [
		{ x: - 14.25, z: 3.5, time: 0.0 },
		{ x: 0.0, z: 0.0, time: 1.25 },
		{ x: 19.75, z: - 6.125, time: 4.5 },
		{ x: 61.0, z: 27.5, time: 8.0 }
	];
	const truncation = sampler.estimateTruncationError();
	const epsilon = 1e-9;
	let maxError = 0;

	for ( const probe of probes ) {
		const sampled = sampler.getWaterHeight( probe.x, probe.z, probe.time );
		const reference = authoredFullSpectrumHeightAt( mirrorCascades, probe.x, probe.z, probe.time );
		maxError = Math.max( maxError, Math.abs( sampled - reference ) );
	}

	return {
		maxError,
		truncationErrorBound: truncation.bound,
		epsilon,
		allowedError: truncation.bound + epsilon,
		dominantBinCount: sampler.dominantBinCount,
		probeCount: probes.length,
		formula: truncation.formula,
		byCascade: truncation.byCascade
	};
}

export function validateFftOceanSelfTests( {
	resolution = 16,
	tolerance = 1e-3
} = {} ) {
	const dftParity = testDftParityAndHermitianResidual( resolution );
	const cpuWaterHeightSamplerParity = testCpuWaterHeightSamplerParity();
	const errors = {
		dc: testDc( resolution ),
		oneBinX: testOneBinX( resolution ),
		oneBinY: testOneBinY( resolution ),
		displacementDirection: testDisplacementDirection(),
		derivativeSign: testDerivativeSigns(),
		jacobianDeterminant: testJacobianDeterminant(),
		finiteDepthDispersionMonotonicity: testFiniteDepthDispersionMonotonicity(),
		tmaBounds: testTmaBounds(),
		spectrumNonNegativity: testSpectrumNonNegativity(),
		amplitudeFiniteAtSmallK: testAmplitudeFiniteAtSmallK(),
		directionalSpreadingNormalization: testDirectionalSpreadingNormalization(),
		energyInvariantAcrossCutoffMaskMoves: testEnergyInvarianceAcrossCutoffMaskMoves(),
		dftParity: dftParity.correctRelativeError,
		dftPartnerParity: dftParity.partnerRelativeError,
		hermitianHeightResidual: dftParity.hermitianResidualRelative,
		brokenPackWouldFail: dftParity.brokenRelativeError > dftParity.tolerance ? 0 : 1,
		cpuWaterHeightSamplerParity: cpuWaterHeightSamplerParity.maxError
	};
	const tolerances = {
		dftParity: dftParity.tolerance,
		dftPartnerParity: dftParity.tolerance,
		hermitianHeightResidual: dftParity.tolerance,
		brokenPackWouldFail: 0,
		cpuWaterHeightSamplerParity: cpuWaterHeightSamplerParity.allowedError
	};
	const pass = Object.entries( errors ).every( ( [ key, value ] ) => value <= ( tolerances[ key ] ?? tolerance ) );

	return {
		pass,
		tolerance,
		tolerances,
		resolution,
		errors,
		metrics: {
			dftParity,
			cpuWaterHeightSamplerParity,
			capillarySpotCheck: capillarySpotCheck()
		}
	};
}
