import { TAU } from './constants.js';

function finiteDepthDispersion( k, depthMeters, gravity ) {
	return Math.sqrt( gravity * k * Math.tanh( Math.min( k * depthMeters, 20 ) ) );
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
	const kh = Math.min( kSafe * depthMeters, 20 );
	const omega = finiteDepthDispersion( kSafe, depthMeters, gravity );
	const energy = jonswapEnergy( omega, 11.5, 65000 ) * tmaFiniteDepthCorrection( omega, depthMeters, gravity );
	const sech = 1 / Math.cosh( kh );
	const dOmegaDk = gravity * ( Math.tanh( kh ) + kSafe * depthMeters * sech * sech ) / ( 2 * Math.max( omega, 1e-6 ) );
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

export function validateFftOceanSelfTests( {
	resolution = 16,
	tolerance = 1e-3
} = {} ) {
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
		energyInvariantAcrossCutoffMaskMoves: testEnergyInvarianceAcrossCutoffMaskMoves()
	};
	const pass = Object.values( errors ).every( ( value ) => value <= tolerance );

	return {
		pass,
		tolerance,
		resolution,
		errors
	};
}
