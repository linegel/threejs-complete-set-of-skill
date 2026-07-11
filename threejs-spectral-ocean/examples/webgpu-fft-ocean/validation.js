import {
	TAU,
	createCascadeDescriptors,
	hashOceanSeedUint32,
	hashOceanSeedUnit,
	mergeOceanConfig
} from './constants.js';
import {
	createCpuWaterHeightSampler,
	createFullSpectrumWaterHeightMirror
} from './cpu-water-height.js';

function complexAdd( a, b ) {
	return [ a[ 0 ] + b[ 0 ], a[ 1 ] + b[ 1 ] ];
}

function complexMul( a, b ) {
	return [ a[ 0 ] * b[ 0 ] - a[ 1 ] * b[ 1 ], a[ 0 ] * b[ 1 ] + a[ 1 ] * b[ 0 ] ];
}

function makeComplexField( resolution ) {
	return Array.from( { length: resolution * resolution }, () => [ 0, 0 ] );
}

function centeredIndex( resolution, signedCoordinate ) {
	return ( signedCoordinate + resolution / 2 ) % resolution;
}

function inverseDft2D( frequency, resolution ) {
	const spatial = makeComplexField( resolution );
	for ( let y = 0; y < resolution; y += 1 ) {
		for ( let x = 0; x < resolution; x += 1 ) {
			let sum = [ 0, 0 ];
			for ( let ky = 0; ky < resolution; ky += 1 ) {
				for ( let kx = 0; kx < resolution; kx += 1 ) {
					const signedX = kx - resolution / 2;
					const signedY = ky - resolution / 2;
					const angle = TAU * ( signedX * x + signedY * y ) / resolution;
					sum = complexAdd( sum, complexMul( frequency[ ky * resolution + kx ], [ Math.cos( angle ), Math.sin( angle ) ] ) );
				}
			}
			spatial[ y * resolution + x ] = sum;
		}
	}
	return spatial;
}

function maxComplexError( actual, expected ) {
	let error = 0;
	for ( let index = 0; index < actual.length; index += 1 ) {
		error = Math.max( error, Math.abs( actual[ index ][ 0 ] - expected[ index ][ 0 ] ), Math.abs( actual[ index ][ 1 ] - expected[ index ][ 1 ] ) );
	}
	return error;
}

function testDftFixtures( resolution ) {
	const errors = {};

	const dc = makeComplexField( resolution );
	dc[ centeredIndex( resolution, 0 ) * resolution + centeredIndex( resolution, 0 ) ] = [ 1, 0 ];
	errors.dc = maxComplexError( inverseDft2D( dc, resolution ), makeComplexField( resolution ).map( () => [ 1, 0 ] ) );

	for ( const [ name, binX, binY ] of [ [ 'x', 1, 0 ], [ 'z', 0, 1 ], [ 'oblique', 1, 2 ] ] ) {
		const frequency = makeComplexField( resolution );
		frequency[ centeredIndex( resolution, binY ) * resolution + centeredIndex( resolution, binX ) ] = [ 1, 0 ];
		const expected = makeComplexField( resolution );
		for ( let y = 0; y < resolution; y += 1 ) {
			for ( let x = 0; x < resolution; x += 1 ) {
				const angle = TAU * ( binX * x + binY * y ) / resolution;
				expected[ y * resolution + x ] = [ Math.cos( angle ), Math.sin( angle ) ];
			}
		}
		errors[ name ] = maxComplexError( inverseDft2D( frequency, resolution ), expected );
	}

	const pair = makeComplexField( resolution );
	pair[ centeredIndex( resolution, 0 ) * resolution + centeredIndex( resolution, 1 ) ] = [ 0.5, 0 ];
	pair[ centeredIndex( resolution, 0 ) * resolution + centeredIndex( resolution, - 1 ) ] = [ 0.5, 0 ];
	const pairSpatial = inverseDft2D( pair, resolution );
	errors.hermitianImaginaryLeakage = Math.max( ...pairSpatial.map( ( value ) => Math.abs( value[ 1 ] ) ) );

	return errors;
}

function testSeedHash() {
	const seed = 0x1f2e3d4c;
	const valuesA = new Set();
	const valuesB = new Set();
	let equalSaltCount = 0;
	let meanA = 0;
	let meanB = 0;
	let cross = 0;
	const resolution = 32;
	for ( let y = 0; y < resolution; y += 1 ) {
		for ( let x = 0; x < resolution; x += 1 ) {
			const bitsA = hashOceanSeedUint32( x, y, seed, 17 );
			const bitsB = hashOceanSeedUint32( x, y, seed, 53 );
			const a = hashOceanSeedUnit( x, y, seed, 17 );
			const b = hashOceanSeedUnit( x, y, seed, 53 );
			valuesA.add( bitsA );
			valuesB.add( bitsB );
			if ( bitsA === bitsB ) equalSaltCount += 1;
			meanA += a;
			meanB += b;
			cross += a * b;
		}
	}
	const count = resolution * resolution;
	meanA /= count;
	meanB /= count;
	const covariance = cross / count - meanA * meanB;
	return { count, uniqueA: valuesA.size, uniqueB: valuesB.size, equalSaltCount, meanA, meanB, covariance };
}

function normalizationFactor( power ) {
	const s2 = power * power;
	const s3 = s2 * power;
	const s4 = s3 * power;
	if ( power < 5 ) return - 0.000564 * s4 + 0.00776 * s3 - 0.044 * s2 + 0.192 * power + 0.163;
	return - 4.8e-8 * s4 + 1.07e-5 * s3 - 9.53e-4 * s2 + 5.9e-2 * power + 0.393;
}

function directionalSpread( theta, ratio, directionAngle, directionality, swell ) {
	const below = 6.97 * ratio ** 5;
	const above = 9.77 * ratio ** - 2.5;
	const power = ( ratio <= 1 ? below : above ) + 16 * Math.tanh( Math.min( ratio, 20 ) ) * swell * swell;
	const forwardCosine = Math.max( Math.cos( theta - directionAngle ), 0 );
	const broad = ( 2 / Math.PI ) * forwardCosine ** 2;
	const directed = normalizationFactor( power ) * Math.abs( Math.cos( ( theta - directionAngle ) * 0.5 ) ) ** ( 2 * power );
	return broad * ( 1 - directionality ) + directed * directionality;
}

function testDirectionalNormalization() {
	const sampleCount = 32768;
	let maximumError = 0;
	for ( const ratio of [ 0.2, 0.5, 1, 2, 5 ] ) {
		let integral = 0;
		for ( let index = 0; index < sampleCount; index += 1 ) {
			const theta = - Math.PI + ( index + 0.5 ) * TAU / sampleCount;
			integral += directionalSpread( theta, ratio, 0.31, 0.74, 0.18 ) * TAU / sampleCount;
		}
		maximumError = Math.max( maximumError, Math.abs( integral - 1 ) );
	}
	return maximumError;
}

function testTravelDirection() {
	const k = 2;
	const omega = 3;
	const time = 0.4;
	const crestX = omega * time / k;
	const phase = [ Math.cos( omega * time ), - Math.sin( omega * time ) ];
	const spatial = [ Math.cos( k * crestX ), Math.sin( k * crestX ) ];
	return Math.abs( complexMul( phase, spatial )[ 0 ] - 1 );
}

function testNyquistParity() {
	const h = [ 0.75, - 0.2 ];
	const kx = - 4;
	const kz = 1.5;
	const k = Math.hypot( kx, kz );
	const iH = [ - h[ 1 ], h[ 0 ] ];
	const xOddMask = 0;
	const zOddMask = 1;
	const dx = iH.map( ( value ) => value * kx / k * xOddMask );
	const dz = iH.map( ( value ) => value * kz / k * zOddMask );
	const dxx = h.map( ( value ) => - value * kx * kx / k );
	const cross = h.map( ( value ) => - value * kx * kz / k * xOddMask * zOddMask );
	return Math.max( Math.hypot( ...dx ), Math.hypot( ...cross ), Math.max( 0, 1e-12 - Math.hypot( ...dz ) ), Math.max( 0, 1e-12 - Math.hypot( ...dxx ) ) );
}

export function computeJacobianFromDerivatives( dDxDx, dDzDz, dDzDx, choppiness ) {
	return ( 1 + choppiness * dDxDx ) * ( 1 + choppiness * dDzDz ) - ( choppiness * dDzDx ) ** 2;
}

function testExactSurfaceNormal() {
	const modes = [
		{ kx: 1.1, kz: 0.7, amplitude: 0.2, phase: 0.4 },
		{ kx: - 0.6, kz: 1.8, amplitude: 0.09, phase: - 0.2 }
	];
	const choppiness = 0.8;
	const surface = ( qx, qz ) => {
		const f = { h: 0, dx: 0, dz: 0, hx: 0, hz: 0, dxx: 0, dzz: 0, dxz: 0 };
		for ( const mode of modes ) {
			const k = Math.hypot( mode.kx, mode.kz );
			const theta = mode.kx * qx + mode.kz * qz + mode.phase;
			const height = mode.amplitude * Math.cos( theta );
			const sine = mode.amplitude * Math.sin( theta );
			f.h += height;
			f.dx += - mode.kx / k * sine;
			f.dz += - mode.kz / k * sine;
			f.hx += - mode.kx * sine;
			f.hz += - mode.kz * sine;
			f.dxx += - mode.kx * mode.kx / k * height;
			f.dzz += - mode.kz * mode.kz / k * height;
			f.dxz += - mode.kx * mode.kz / k * height;
		}
		const a = 1 + choppiness * f.dxx;
		const b = choppiness * f.dxz;
		const c = 1 + choppiness * f.dzz;
		return {
			position: [ qx + choppiness * f.dx, f.h, qz + choppiness * f.dz ],
			tangentX: [ a, f.hx, b ],
			tangentZ: [ b, f.hz, c ],
			normalRaw: [ f.hz * b - c * f.hx, a * c - b * b, b * f.hx - f.hz * a ]
		};
	};
	const qx = 0.37;
	const qz = - 0.81;
	const epsilon = 1e-6;
	const sample = surface( qx, qz );
	const plusX = surface( qx + epsilon, qz ).position;
	const minusX = surface( qx - epsilon, qz ).position;
	const plusZ = surface( qx, qz + epsilon ).position;
	const minusZ = surface( qx, qz - epsilon ).position;
	const finiteX = plusX.map( ( value, index ) => ( value - minusX[ index ] ) / ( 2 * epsilon ) );
	const finiteZ = plusZ.map( ( value, index ) => ( value - minusZ[ index ] ) / ( 2 * epsilon ) );
	const finiteNormal = [
		finiteZ[ 1 ] * finiteX[ 2 ] - finiteZ[ 2 ] * finiteX[ 1 ],
		finiteZ[ 2 ] * finiteX[ 0 ] - finiteZ[ 0 ] * finiteX[ 2 ],
		finiteZ[ 0 ] * finiteX[ 1 ] - finiteZ[ 1 ] * finiteX[ 0 ]
	];
	return Math.max( ...sample.normalRaw.map( ( value, index ) => Math.abs( value - finiteNormal[ index ] ) ) );
}

function foamReaction( previous, sourceRate, decayRate, dt ) {
	const rate = sourceRate + decayRate;
	const equilibrium = sourceRate / rate;
	return equilibrium + ( previous - equilibrium ) * Math.exp( - rate * dt );
}

function testFoamTimestepPartition() {
	const previous = 0.23;
	const source = 1.7;
	const decay = 0.22;
	const dt = 1 / 30;
	const one = foamReaction( previous, source, decay, dt );
	const two = foamReaction( foamReaction( previous, source, decay, dt / 2 ), source, decay, dt / 2 );
	return Math.abs( one - two );
}

function testCascadeRepresentability() {
	const config = mergeOceanConfig( { quality: 'low', resolution: 128, cascadeCount: 1, patchLengthsMeters: [ 5 ] } );
	const descriptor = createCascadeDescriptors( config )[ 0 ];
	return Math.max( 0, descriptor.cutoffHigh - Math.PI * descriptor.resolution / descriptor.patchLength );
}

function testCpuWorldQuery() {
	const options = { quality: 'low', resolution: 8, cascadeCount: 1, patchLengthsMeters: [ 64 ], choppiness: 0.02, dominantBinCount: 63 };
	const reduced = createCpuWaterHeightSampler( options );
	const full = createFullSpectrumWaterHeightMirror( options );
	const parameter = full.sampleAtParameter( 0.4, - 0.7, 0.3 );
	const fullWorld = full.sampleAtWorldXZ( parameter.position[ 0 ], parameter.position[ 2 ], 0.3 );
	const reducedWorld = reduced.sampleAtWorldXZ( parameter.position[ 0 ], parameter.position[ 2 ], 0.3 );
	const truncation = reduced.estimateTruncationError();
	const error = Math.abs( reducedWorld.height - fullWorld.height );
	return {
		fullStatus: fullWorld.status,
		reducedStatus: reducedWorld.status,
		fullResidual: fullWorld.horizontalResidual,
		reducedResidual: reducedWorld.horizontalResidual,
		error,
		worldHeightBound: truncation.worldHeightBound,
		boundViolation: truncation.worldHeightBound === null ? null : Math.max( 0, error - truncation.worldHeightBound )
	};
}

export function validateFftOceanSelfTests( {
	resolution = 8,
	tolerance = 1e-8
} = {} ) {
	const dft = testDftFixtures( resolution );
	const seedHash = testSeedHash();
	const cpuWorldQuery = testCpuWorldQuery();
	const errors = {
		...dft,
		seedCollisionDeficit: Math.max( 0, seedHash.count - 4 - seedHash.uniqueA, seedHash.count - 4 - seedHash.uniqueB ),
		seedSaltCollision: seedHash.equalSaltCount,
		seedMean: Math.max( Math.abs( seedHash.meanA - 0.5 ), Math.abs( seedHash.meanB - 0.5 ) ),
		seedCovariance: Math.abs( seedHash.covariance ),
		directionalNormalization: testDirectionalNormalization(),
		travelDirection: testTravelDirection(),
		nyquistParity: testNyquistParity(),
		exactSurfaceNormal: testExactSurfaceNormal(),
		foamTimestepPartition: testFoamTimestepPartition(),
		cascadeRepresentability: testCascadeRepresentability(),
		cpuFullResidual: cpuWorldQuery.fullResidual,
		cpuReducedResidual: cpuWorldQuery.reducedResidual,
		cpuWorldBoundViolation: cpuWorldQuery.boundViolation ?? 0,
	};
	const tolerances = {
		seedMean: 0.04,
		seedCovariance: 0.02,
		directionalNormalization: 0.01,
		cpuFullResidual: 1e-6,
		cpuReducedResidual: 1e-6,
	};
	const cpuScaffoldPass = Object.entries( errors ).every( ( [ key, value ] ) => value <= ( tolerances[ key ] ?? tolerance ) ) &&
		cpuWorldQuery.fullStatus === 'converged' && cpuWorldQuery.reducedStatus === 'converged';

	return {
		pass: cpuScaffoldPass,
		classification: 'cpu-numerical-scaffold-tests-only',
		acceptedAsProductionGpuOcean: false,
		tolerance,
		tolerances,
		resolution,
		errors,
		metrics: { seedHash, cpuWorldQuery },
		missingEvidence: [
			'complete GPU 2D FFT and all packed lanes',
			'exact CPU/GPU coefficient comparison after shader arithmetic',
			'float-versus-half precision',
			'multicascade surface and native per-cascade foam GPU readback',
			'real rendered and sustained-performance evidence'
		]
	};
}
