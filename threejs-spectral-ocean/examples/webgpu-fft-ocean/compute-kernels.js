import {
	Fn,
	If,
	abs,
	atan,
	cos,
	exp,
	float,
	floor,
	fract,
	instanceIndex,
	int,
	length,
	max,
	min,
	mix,
	pow,
	select,
	sin,
	smoothstep,
	sqrt,
	step,
	storageTexture,
	texture,
	textureStore,
	uvec2,
	vec2,
	vec3,
	vec4
} from 'three/tsl';

import { PACKED_FIELD_LAYOUT, TAU } from './constants.js';

function cellFromIndex( resolution ) {
	const x = instanceIndex.mod( resolution );
	const y = instanceIndex.div( resolution );
	return uvec2( x, y );
}

function uvFromCell( cell, resolution ) {
	return vec2( cell ).add( 0.5 ).div( resolution );
}

function complexMul( a, b ) {
	return vec2(
		a.x.mul( b.x ).sub( a.y.mul( b.y ) ),
		a.x.mul( b.y ).add( a.y.mul( b.x ) )
	);
}

function complexConjugate( a ) {
	return vec2( a.x, a.y.negate() );
}

function complexI( a ) {
	return vec2( a.y.negate(), a.x );
}

function spectrumParameters( lobe, gravity ) {
	return {
		...lobe,
		angle: lobe.directionDegrees * Math.PI / 180,
		alpha: 0.076 * Math.pow( gravity * lobe.fetchMeters / ( lobe.windSpeed * lobe.windSpeed ), - 0.22 ),
		peakOmega: 22 * Math.pow( lobe.windSpeed * lobe.fetchMeters / ( gravity * gravity ), - 0.33 )
	};
}

function scalarUniformsFromCascade( cascade ) {
	const local = spectrumParameters( cascade.local, cascade.gravity );
	const swell = spectrumParameters( cascade.swell, cascade.gravity );

	return {
		resolution: cascade.resolution,
		patchLength: cascade.patchLength,
		cutoffLow: cascade.cutoffLow,
		cutoffHigh: cascade.cutoffHigh,
		seed: cascade.seed,
		gravity: cascade.gravity,
		depthMeters: cascade.depthMeters,
		choppiness: cascade.choppiness,
		foamRecovery: cascade.foamRecovery,
		foamThreshold: cascade.foamThreshold,
		foamScale: cascade.foamScale,
		localScale: local.scale,
		localAlpha: local.alpha,
		localPeakOmega: local.peakOmega,
		localPeakEnhancement: local.peakEnhancement,
		localAngle: local.angle,
		localDirectionality: local.directionality,
		localSwell: local.swell,
		localShortWaveFade: local.shortWaveFade,
		swellScale: swell.scale,
		swellAlpha: swell.alpha,
		swellPeakOmega: swell.peakOmega,
		swellPeakEnhancement: swell.peakEnhancement,
		swellAngle: swell.angle,
		swellDirectionality: swell.directionality,
		swellSwell: swell.swell,
		swellShortWaveFade: swell.shortWaveFade
	};
}

function hashUnit( x, y, seed, salt ) {
	const p = vec3( float( x ), float( y ), float( seed + salt ) );
	return fract( sin( p.dot( vec3( 12.9898, 78.233, 37.719 ) ) ).mul( 43758.5453123 ) );
}

function gaussianPair( cell, seed ) {
	const u1 = max( hashUnit( cell.x, cell.y, seed, 17 ), 1e-7 );
	const u2 = hashUnit( cell.x, cell.y, seed, 53 );
	const radius = sqrt( float( - 2.0 ).mul( u1.log() ) );
	const phase = float( TAU ).mul( u2 );
	return vec2( radius.mul( cos( phase ) ), radius.mul( sin( phase ) ) );
}

function dispersion( k, gravity, depthMeters ) {
	return sqrt( gravity.mul( k ).mul( min( k.mul( depthMeters ), 20.0 ).tanh() ) );
}

function dispersionDerivative( k, gravity, depthMeters ) {
	const kh = min( k.mul( depthMeters ), 20.0 );
	const tanhKh = kh.tanh();
	const coshKh = kh.cosh();
	const omega = max( dispersion( k, gravity, depthMeters ), 1e-6 );
	return gravity.mul( tanhKh.add( depthMeters.mul( k ).div( coshKh.mul( coshKh ) ) ) ).div( omega.mul( 2.0 ) );
}

function tmaCorrection( omega, gravity, depthMeters ) {
	const value = omega.mul( sqrt( depthMeters.div( gravity ) ) );
	const shallow = value.mul( value ).mul( 0.5 );
	const midRemaining = float( 2.0 ).sub( value );
	const mid = float( 1.0 ).sub( midRemaining.mul( midRemaining ).mul( 0.5 ) );
	return select( value.lessThanEqual( 1.0 ), shallow, select( value.lessThan( 2.0 ), mid, 1.0 ) );
}

function normalizationFactor( power ) {
	const s2 = power.mul( power );
	const s3 = s2.mul( power );
	const s4 = s3.mul( power );
	const low = s4.mul( - 0.000564 ).add( s3.mul( 0.00776 ) ).sub( s2.mul( 0.044 ) ).add( power.mul( 0.192 ) ).add( 0.163 );
	const high = s4.mul( - 4.8e-8 ).add( s3.mul( 1.07e-5 ) ).sub( s2.mul( 9.53e-4 ) ).add( power.mul( 5.9e-2 ) ).add( 0.393 );
	return select( power.lessThan( 5.0 ), low, high );
}

function directionalSpread( theta, omega, peakOmega, directionAngle, directionality, swell ) {
	const ratio = max( omega.div( peakOmega ), 1e-4 );
	const below = float( 6.97 ).mul( pow( ratio, 5.0 ) );
	const above = float( 9.77 ).mul( pow( ratio, - 2.5 ) );
	const power = select( ratio.lessThanEqual( 1.0 ), below, above ).add( float( 16.0 ).mul( min( ratio, 20.0 ).tanh() ).mul( swell ).mul( swell ) );
	const broad = float( 2 / Math.PI ).mul( cos( theta ).mul( cos( theta ) ) );
	const directed = normalizationFactor( power ).mul( pow( abs( cos( theta.sub( directionAngle ).mul( 0.5 ) ) ), power.mul( 2.0 ) ) );
	return mix( broad, directed, directionality );
}

function jonswapEnergy( omega, k, theta, params, uniforms ) {
	const safeOmega = max( omega, 1e-4 );
	const sigma = select( safeOmega.lessThanEqual( params.peakOmega ), 0.07, 0.09 );
	const normalized = safeOmega.sub( params.peakOmega ).div( max( sigma.mul( params.peakOmega ).mul( Math.SQRT2 ), 1e-5 ) );
	const peakShape = exp( normalized.mul( normalized ).negate() );
	const peakRatio = params.peakOmega.div( safeOmega );
	const jonswap = params.scale
		.mul( tmaCorrection( safeOmega, uniforms.gravity, uniforms.depthMeters ) )
		.mul( params.alpha )
		.mul( uniforms.gravity ).mul( uniforms.gravity )
		.mul( pow( safeOmega, - 5.0 ) )
		.mul( exp( float( - 1.25 ).mul( pow( peakRatio, 4.0 ) ) ) )
		.mul( pow( params.peakEnhancement, peakShape ) );
	const spread = directionalSpread( theta, omega, params.peakOmega, params.angle, params.directionality, params.swell );
	const fade = exp( params.shortWaveFade.mul( params.shortWaveFade ).mul( k ).mul( k ).negate() );
	return jonswap.mul( spread ).mul( fade );
}

function lobeParams( prefix, uniforms ) {
	return {
		scale: uniforms[ `${ prefix }Scale` ],
		alpha: uniforms[ `${ prefix }Alpha` ],
		peakOmega: uniforms[ `${ prefix }PeakOmega` ],
		peakEnhancement: uniforms[ `${ prefix }PeakEnhancement` ],
		angle: uniforms[ `${ prefix }Angle` ],
		directionality: uniforms[ `${ prefix }Directionality` ],
		swell: uniforms[ `${ prefix }Swell` ],
		shortWaveFade: uniforms[ `${ prefix }ShortWaveFade` ]
	};
}

export function createSpectrumInitNode( cascade, targets ) {
	const constants = scalarUniformsFromCascade( cascade );

	const kernel = Fn( ( { h0, gaussianDebug, spectrumDebug, maskDebug } ) => {
		const cell = cellFromIndex( constants.resolution );
		const centered = vec2( cell ).sub( constants.resolution * 0.5 );
		const deltaK = float( TAU / constants.patchLength );
		const kVec = centered.mul( deltaK );
		const kLength = length( kVec );
		const kSafe = max( kLength, constants.cutoffLow );
		const inBand = step( constants.cutoffLow, kLength ).mul( step( kLength, constants.cutoffHigh ) );
		const uniforms = Object.fromEntries( Object.entries( constants ).map( ( [ key, value ] ) => [ key, float( value ) ] ) );
		const omega = dispersion( kSafe, uniforms.gravity, uniforms.depthMeters );
		const theta = atan( kVec.y, kVec.x );
		const localEnergy = jonswapEnergy( omega, kSafe, theta, lobeParams( 'local', uniforms ), uniforms );
		const swellEnergy = jonswapEnergy( omega, kSafe, theta, lobeParams( 'swell', uniforms ), uniforms );
		const energy = localEnergy.add( swellEnergy );
		const derivative = abs( dispersionDerivative( kSafe, uniforms.gravity, uniforms.depthMeters ) );
		const amplitude = sqrt( max( energy.mul( 2.0 ).mul( derivative ).mul( deltaK ).mul( deltaK ).div( kSafe ), 0.0 ) ).mul( inBand );
		const gaussian = gaussianPair( cell, constants.seed );
		const h = gaussian.mul( amplitude );

		const mirrored = uvec2(
			int( constants.resolution ).sub( int( cell.x ) ).mod( constants.resolution ),
			int( constants.resolution ).sub( int( cell.y ) ).mod( constants.resolution )
		);

		const mirroredCentered = vec2( mirrored ).sub( constants.resolution * 0.5 );
		const mirroredKVec = mirroredCentered.mul( deltaK );
		const mirroredKLength = length( mirroredKVec );
		const mirroredKSafe = max( mirroredKLength, constants.cutoffLow );
		const mirroredInBand = step( constants.cutoffLow, mirroredKLength ).mul( step( mirroredKLength, constants.cutoffHigh ) );
		const mirroredOmega = dispersion( mirroredKSafe, uniforms.gravity, uniforms.depthMeters );
		const mirroredTheta = atan( mirroredKVec.y, mirroredKVec.x );
		const mirroredLocalEnergy = jonswapEnergy( mirroredOmega, mirroredKSafe, mirroredTheta, lobeParams( 'local', uniforms ), uniforms );
		const mirroredSwellEnergy = jonswapEnergy( mirroredOmega, mirroredKSafe, mirroredTheta, lobeParams( 'swell', uniforms ), uniforms );
		const mirroredEnergy = mirroredLocalEnergy.add( mirroredSwellEnergy );
		const mirroredDerivative = abs( dispersionDerivative( mirroredKSafe, uniforms.gravity, uniforms.depthMeters ) );
		const mirroredAmplitude = sqrt( max( mirroredEnergy.mul( 2.0 ).mul( mirroredDerivative ).mul( deltaK ).mul( deltaK ).div( mirroredKSafe ), 0.0 ) ).mul( mirroredInBand );
		const mirroredGaussian = gaussianPair( mirrored, constants.seed );
		const mirroredH = mirroredGaussian.mul( mirroredAmplitude );

		textureStore( h0, cell, vec4( h, mirroredH.x, mirroredH.y.negate() ) ).toWriteOnly();
		textureStore( gaussianDebug, cell, vec4( gaussian, 0.0, 1.0 ) ).toWriteOnly();
		textureStore( spectrumDebug, cell, vec4( localEnergy, swellEnergy, energy, derivative ) ).toWriteOnly();
		textureStore( maskDebug, cell, vec4( inBand, kLength, constants.cutoffLow, constants.cutoffHigh ) ).toWriteOnly();
	} );

	return kernel( targets ).compute( constants.resolution * constants.resolution, [ 64 ] ).setName( `ocean:h0:cascade-${ cascade.index }` );
}

export function createClearTextureNode( textureTarget, resolution, value = [ 0, 0, 0, 0 ], name = 'ocean:clear' ) {
	const kernel = Fn( ( { outputTex } ) => {
		const cell = cellFromIndex( resolution );
		textureStore( outputTex, cell, vec4( value[ 0 ], value[ 1 ], value[ 2 ], value[ 3 ] ) ).toWriteOnly();
	} );

	return kernel( { outputTex: textureTarget } ).compute( resolution * resolution, [ 64 ] ).setName( name );
}

export function createEvolutionNode( cascade, fieldIndex, targets ) {
	const constants = scalarUniformsFromCascade( cascade );
	const layoutName = Object.entries( PACKED_FIELD_LAYOUT ).find( ( [ , value ] ) => value === fieldIndex )?.[ 0 ] ?? `field-${ fieldIndex }`;

	const kernel = Fn( ( { h0, outputTex, time } ) => {
		const cell = cellFromIndex( constants.resolution );
		const initial = storageTexture( h0, cell ).toReadOnly();
		const centered = vec2( cell ).sub( constants.resolution * 0.5 );
		const kVec = centered.mul( TAU / constants.patchLength );
		const kLength = max( length( kVec ), 1e-4 );
		const omega = dispersion( kLength, float( constants.gravity ), float( constants.depthMeters ) );
		const phase = vec2( cos( omega.mul( time ) ), sin( omega.mul( time ) ) );
		const h = complexMul( initial.xy, phase ).add( complexMul( initial.zw, complexConjugate( phase ) ) );
		const ih = complexI( h );
		const kx = kVec.x;
		const kz = kVec.y;
		const dx = ih.mul( kx.div( kLength ) );
		const dz = ih.mul( kz.div( kLength ) );
		const slopeX = ih.mul( kx );
		const slopeZ = ih.mul( kz );
		const dxx = h.mul( kx.mul( kx ).div( kLength ).negate() );
		const dzz = h.mul( kz.mul( kz ).div( kLength ).negate() );
		const cross = h.mul( kx.mul( kz ).div( kLength ).negate() );
		const packed = vec4().toVar();

		If( int( fieldIndex ).equal( PACKED_FIELD_LAYOUT.horizontalDisplacement ), () => {
			packed.assign( vec4( dx.x, dz.x, dx.y, dz.y ) );
		} ).ElseIf( int( fieldIndex ).equal( PACKED_FIELD_LAYOUT.heightAndCrossDerivative ), () => {
			packed.assign( vec4( h.x, cross.x, h.y, cross.y ) );
		} ).ElseIf( int( fieldIndex ).equal( PACKED_FIELD_LAYOUT.heightSlopes ), () => {
			packed.assign( vec4( slopeX.x, slopeZ.x, slopeX.y, slopeZ.y ) );
		} ).Else( () => {
			packed.assign( vec4( dxx.x, dzz.x, dxx.y, dzz.y ) );
		} );

		textureStore( outputTex, cell, packed ).toWriteOnly();
	} );

	return kernel( targets ).compute( constants.resolution * constants.resolution, [ 64 ] ).setName( `ocean:evolve:${ layoutName }:cascade-${ cascade.index }` );
}

export function createBitReverseNode( resolution, axis, targets ) {
	const kernel = Fn( ( { inputTex, outputTex, bitReverseTex } ) => {
		const cell = cellFromIndex( resolution );
		const source = uvec2( cell ).toVar();
		const reverseX = texture( bitReverseTex, vec2( float( cell.x ).add( 0.5 ).div( resolution ), 0.5 ) ).r.mul( resolution - 1 ).round().toUint();
		const reverseY = texture( bitReverseTex, vec2( float( cell.y ).add( 0.5 ).div( resolution ), 0.5 ) ).r.mul( resolution - 1 ).round().toUint();

		If( int( axis ).equal( 0 ), () => {
			source.x.assign( reverseX );
		} ).Else( () => {
			source.y.assign( reverseY );
		} );

		textureStore( outputTex, cell, storageTexture( inputTex, source ).toReadOnly() ).toWriteOnly();
	} );

	return kernel( targets ).compute( resolution * resolution, [ 64 ] ).setName( `ocean:fft:bit-reverse:${ axis === 0 ? 'x' : 'y' }` );
}

export function createFftStageNode( resolution, stage, axis, targets ) {
	const logResolution = Math.log2( resolution );
	const stageUvY = ( stage + 0.5 ) / logResolution;

	const kernel = Fn( ( { inputTex, outputTex, butterflyTex } ) => {
		const cell = cellFromIndex( resolution );
		const coordinate = select( int( axis ).equal( 0 ), cell.x, cell.y );
		const butterfly = texture( butterflyTex, vec2( float( coordinate ).add( 0.5 ).div( resolution ), stageUvY ) );
		const indexA = butterfly.z.mul( resolution - 1 ).round().toUint();
		const indexB = butterfly.w.mul( resolution - 1 ).round().toUint();
		const twiddle = butterfly.xy;
		const cellA = uvec2( cell ).toVar();
		const cellB = uvec2( cell ).toVar();

		If( int( axis ).equal( 0 ), () => {
			cellA.x.assign( indexA );
			cellB.x.assign( indexB );
		} ).Else( () => {
			cellA.y.assign( indexA );
			cellB.y.assign( indexB );
		} );

		const a = storageTexture( inputTex, cellA ).toReadOnly();
		const b = storageTexture( inputTex, cellB ).toReadOnly();
		const weighted0 = complexMul( twiddle, b.xy );
		const weighted1 = complexMul( twiddle, b.zw );
		textureStore( outputTex, cell, vec4( a.xy.add( weighted0 ), a.zw.add( weighted1 ) ) ).toWriteOnly();
	} );

	return kernel( targets ).compute( resolution * resolution, [ 64 ] ).setName( `ocean:fft:stage-${ stage }:${ axis === 0 ? 'x' : 'y' }` );
}

export function createCenterAndAssembleNode( cascade, targets ) {
	const constants = scalarUniformsFromCascade( cascade );

	const kernel = Fn( ( {
		field0,
		field1,
		field2,
		field3,
		previousFoam,
		displacement,
		derivatives,
		crossJacobianFoam,
		foamHistory,
		dt
	} ) => {
		const cell = cellFromIndex( constants.resolution );
		const sign = select( int( cell.x.add( cell.y ).mod( 2 ) ).equal( 0 ), 1.0, - 1.0 );
		const f0 = storageTexture( field0, cell ).toReadOnly().mul( sign );
		const f1 = storageTexture( field1, cell ).toReadOnly().mul( sign );
		const f2 = storageTexture( field2, cell ).toReadOnly().mul( sign );
		const f3 = storageTexture( field3, cell ).toReadOnly().mul( sign );
		const lambda = float( constants.choppiness );
		const dDzDx = lambda.mul( f1.y );
		const jxx = float( 1.0 ).add( lambda.mul( f3.x ) );
		const jzz = float( 1.0 ).add( lambda.mul( f3.y ) );
		const jacobian = jxx.mul( jzz ).sub( dDzDx.mul( dDzDx ) );
		const previous = storageTexture( previousFoam, cell ).toReadOnly().r;
		const recovered = previous.add( dt.mul( constants.foamRecovery ).div( max( jacobian, 0.5 ) ) );
		const history = min( jacobian, recovered );
		const coverage = smoothstep( 0.2, 0.9, max( float( constants.foamThreshold ).sub( history ).mul( constants.foamScale ), 0.0 ) );

		textureStore( displacement, cell, vec4( lambda.mul( f0.x ), f1.x, lambda.mul( f0.y ), history ) ).toWriteOnly();
		textureStore( derivatives, cell, vec4( f2.x, f2.y, lambda.mul( f3.x ), lambda.mul( f3.y ) ) ).toWriteOnly();
		textureStore( crossJacobianFoam, cell, vec4( dDzDx, jacobian, coverage, 0.0 ) ).toWriteOnly();
		textureStore( foamHistory, cell, vec4( history, coverage, jacobian, 1.0 ) ).toWriteOnly();
	} );

	return kernel( targets ).compute( constants.resolution * constants.resolution, [ 64 ] ).setName( `ocean:assemble:cascade-${ cascade.index }` );
}
