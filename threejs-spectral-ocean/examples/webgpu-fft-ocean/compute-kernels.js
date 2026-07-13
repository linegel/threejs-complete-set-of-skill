import {
	Fn,
	If,
	abs,
	atan,
	cos,
	exp,
	float,
	floor,
	instanceIndex,
	int,
	ivec2,
	length,
	max,
	min,
	mix,
	normalize,
	pow,
	select,
	sin,
	smoothstep,
	sqrt,
	step,
	storageTexture,
	texture,
	textureLoad,
	textureStore,
	uint,
	uvec2,
	vec2,
	vec3,
	vec4
} from 'three/tsl';

import { PACKED_FIELD_LAYOUT, TAU } from './constants.js';

function cellFromIndex( resolution ) {
	// Storage texture load/store in WGSL expects signed integer coords.
	const x = int( instanceIndex.mod( resolution ) );
	const y = int( instanceIndex.div( resolution ) );
	return ivec2( x, y );
}

// r185: storageTexture(...).toReadOnly() does not sample prior writes; textureLoad does.
function storageLoad( textureTarget, cell ) {
	return textureLoad( textureTarget, ivec2( cell ) );
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

function packTwoRealFields( a, b ) {
	// Pack G(k)=A(k)+i*B(k); .zw is spare capacity in the current four-texture layout.
	return vec4( a.x.sub( b.y ), a.y.add( b.x ), 0.0, 0.0 );
}

function spectrumParameters( lobe, gravity ) {
	return {
		...lobe,
		angle: lobe.directionDegrees * Math.PI / 180,
		alpha: 0.076 * Math.pow( gravity * lobe.fetchMeters / ( lobe.windSpeed * lobe.windSpeed ), - 0.22 ),
		peakOmega: 22 * Math.pow( lobe.windSpeed * lobe.fetchMeters / ( gravity * gravity ), - 1 / 3 )
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
		capillarySurfaceTensionOverDensity: cascade.capillarySurfaceTensionOverDensity,
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

function hashUint( x, y, seed, salt ) {
	const state = uint( x ).mul( uint( 0x9e3779b9 ) )
		.bitXor( uint( y ).mul( uint( 0x85ebca6b ) ) )
		.bitXor( uint( seed ) )
		.bitXor( uint( salt ).mul( uint( 0xc2b2ae35 ) ) )
		.toVar();
	state.assign( state.bitXor( state.shiftRight( uint( 16 ) ) ) );
	state.assign( state.mul( uint( 0x7feb352d ) ) );
	state.assign( state.bitXor( state.shiftRight( uint( 15 ) ) ) );
	state.assign( state.mul( uint( 0x846ca68b ) ) );
	state.assign( state.bitXor( state.shiftRight( uint( 16 ) ) ) );
	return state;
}

function hashUnit( x, y, seed, salt ) {
	// Keep the high 24 hash bits so u32->f32 conversion is exact, then sample
	// the centre of each open unit-interval bin. CPU uses the identical map.
	return float( hashUint( x, y, seed, salt ).shiftRight( uint( 8 ) ) ).add( 0.5 ).mul( 1 / 0x1000000 );
}

function gaussianPair( cell, seed ) {
	const u1 = max( hashUnit( cell.x, cell.y, seed, 17 ), 1e-7 );
	const u2 = hashUnit( cell.x, cell.y, seed, 53 );
	const radius = sqrt( float( - 2.0 ).mul( u1.log() ) );
	const phase = float( TAU ).mul( u2 );
	return vec2( radius.mul( cos( phase ) ), radius.mul( sin( phase ) ) );
}

function dispersion( k, gravity, depthMeters, capillarySurfaceTensionOverDensity ) {
	const gravityCapillary = gravity.mul( k ).add( capillarySurfaceTensionOverDensity.mul( k ).mul( k ).mul( k ) );
	return sqrt( gravityCapillary.mul( min( k.mul( depthMeters ), 20.0 ).tanh() ) );
}

function dispersionDerivative( k, gravity, depthMeters, capillarySurfaceTensionOverDensity ) {
	const kh = min( k.mul( depthMeters ), 20.0 );
	const tanhKh = kh.tanh();
	const coshKh = kh.cosh();
	const gravityCapillary = gravity.mul( k ).add( capillarySurfaceTensionOverDensity.mul( k ).mul( k ).mul( k ) );
	const gravityCapillaryDerivative = gravity.add( capillarySurfaceTensionOverDensity.mul( 3.0 ).mul( k ).mul( k ) );
	const omega = max( dispersion( k, gravity, depthMeters, capillarySurfaceTensionOverDensity ), 1e-6 );
	return gravityCapillaryDerivative.mul( tanhKh )
		.add( gravityCapillary.mul( depthMeters ).div( coshKh.mul( coshKh ) ) )
		.div( omega.mul( 2.0 ) );
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
	const forwardCosine = max( cos( theta.sub( directionAngle ) ), 0.0 );
	const broad = float( 2 / Math.PI ).mul( forwardCosine.mul( forwardCosine ) );
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
		const inBand = step( constants.cutoffLow, kLength ).mul( select( kLength.lessThan( constants.cutoffHigh ), 1.0, 0.0 ) );
		const uniforms = Object.fromEntries( Object.entries( constants ).map( ( [ key, value ] ) => [ key, float( value ) ] ) );
		const omega = dispersion( kSafe, uniforms.gravity, uniforms.depthMeters, uniforms.capillarySurfaceTensionOverDensity );
		const theta = atan( kVec.y, kVec.x );
		const localEnergy = jonswapEnergy( omega, kSafe, theta, lobeParams( 'local', uniforms ), uniforms );
		const swellEnergy = jonswapEnergy( omega, kSafe, theta, lobeParams( 'swell', uniforms ), uniforms );
		const energy = localEnergy.add( swellEnergy );
		const derivative = abs( dispersionDerivative( kSafe, uniforms.gravity, uniforms.depthMeters, uniforms.capillarySurfaceTensionOverDensity ) );
		// gaussianPair has E[|xi_r+i xi_i|^2]=2. For the unnormalized inverse
		// transform, E|a_k|^2=P(k) DeltaK^2/2, hence amplitude^2=P DeltaK^2/4.
		const amplitude = sqrt( max( energy.mul( 0.25 ).mul( derivative ).mul( deltaK ).mul( deltaK ).div( kSafe ), 0.0 ) ).mul( inBand );
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
		const mirroredInBand = step( constants.cutoffLow, mirroredKLength ).mul( select( mirroredKLength.lessThan( constants.cutoffHigh ), 1.0, 0.0 ) );
		const mirroredOmega = dispersion( mirroredKSafe, uniforms.gravity, uniforms.depthMeters, uniforms.capillarySurfaceTensionOverDensity );
		const mirroredTheta = atan( mirroredKVec.y, mirroredKVec.x );
		const mirroredLocalEnergy = jonswapEnergy( mirroredOmega, mirroredKSafe, mirroredTheta, lobeParams( 'local', uniforms ), uniforms );
		const mirroredSwellEnergy = jonswapEnergy( mirroredOmega, mirroredKSafe, mirroredTheta, lobeParams( 'swell', uniforms ), uniforms );
		const mirroredEnergy = mirroredLocalEnergy.add( mirroredSwellEnergy );
		const mirroredDerivative = abs( dispersionDerivative( mirroredKSafe, uniforms.gravity, uniforms.depthMeters, uniforms.capillarySurfaceTensionOverDensity ) );
		const mirroredAmplitude = sqrt( max( mirroredEnergy.mul( 0.25 ).mul( mirroredDerivative ).mul( deltaK ).mul( deltaK ).div( mirroredKSafe ), 0.0 ) ).mul( mirroredInBand );
		const mirroredGaussian = gaussianPair( mirrored, constants.seed );
		const mirroredH = mirroredGaussian.mul( mirroredAmplitude );

		textureStore( h0, cell, vec4( h, mirroredH.x, mirroredH.y.negate() ) ).toWriteOnly();
		textureStore( gaussianDebug, cell, vec4( gaussian, 0.0, 1.0 ) ).toWriteOnly();
		textureStore( spectrumDebug, cell, vec4( localEnergy, swellEnergy, energy, derivative ) ).toWriteOnly();
		textureStore( maskDebug, cell, vec4( inBand, kLength, constants.cutoffLow, constants.cutoffHigh ) ).toWriteOnly();
	} );

	return kernel( targets ).compute( constants.resolution * constants.resolution, [ 64 ] ).setName( `ocean_h0_cascade_${ cascade.index }` );
}

export function createClearTextureNode( textureTarget, resolution, value = [ 0, 0, 0, 0 ], name = 'ocean:clear' ) {
	const kernel = Fn( ( { outputTex } ) => {
		const cell = cellFromIndex( resolution );
		textureStore( outputTex, cell, vec4( value[ 0 ], value[ 1 ], value[ 2 ], value[ 3 ] ) ).toWriteOnly();
	} );

	return kernel( { outputTex: textureTarget } ).compute( resolution * resolution, [ 64 ] ).setName( name );
}

export function createFftFixtureNode( textureTarget, resolution, fixture ) {
	const fixtures = {
		'dc-and-axis': [
			{ x: 0, y: 0, value: [ 1, 0, 0, 0 ] },
			{ x: 1, y: 0, value: [ 0, 0, 1, 0 ] }
		],
		'oblique-pair': [
			{ x: 1, y: 2, value: [ 0.5, - 0.25, 0, 0 ] },
			{ x: 2, y: 1, value: [ 0, 0, - 0.375, 0.625 ] }
		],
		'hermitian-cosines': [
			{ x: 1, y: 0, value: [ 0.5, 0, 0, 0 ] },
			{ x: resolution - 1, y: 0, value: [ 0.5, 0, 0, 0 ] },
			{ x: 0, y: 1, value: [ 0, 0, 0.5, 0 ] },
			{ x: 0, y: resolution - 1, value: [ 0, 0, 0.5, 0 ] }
		]
	};
	const coefficients = fixtures[ fixture ];
	if ( ! coefficients ) throw new Error( `Unknown FFT GPU fixture "${ fixture }".` );

	const kernel = Fn( ( { outputTex } ) => {
		const cell = cellFromIndex( resolution );
		const packed = vec4( 0, 0, 0, 0 ).toVar();
		for ( const coefficient of coefficients ) {
			const matches = cell.x.equal( int( coefficient.x ) ).and( cell.y.equal( int( coefficient.y ) ) );
			packed.assign( select( matches, vec4( ...coefficient.value ), packed ) );
		}
		textureStore( outputTex, cell, packed ).toWriteOnly();
	} );

	return kernel( { outputTex: textureTarget } )
		.compute( resolution * resolution, [ 64 ] )
		.setName( `ocean_fft_fixture_${ fixture }` );
}

export function createEvolutionNode( cascade, fieldIndex, targets ) {
	const constants = scalarUniformsFromCascade( cascade );
	const layoutName = Object.entries( PACKED_FIELD_LAYOUT ).find( ( [ , value ] ) => value === fieldIndex )?.[ 0 ] ?? `field-${ fieldIndex }`;

	const kernel = Fn( ( { h0, outputTex, time } ) => {
		const cell = cellFromIndex( constants.resolution );
		const initial = storageLoad( h0, cell  );
		const centered = vec2( cell ).sub( constants.resolution * 0.5 );
		const kVec = centered.mul( TAU / constants.patchLength );
		const kLength = max( length( kVec ), 1e-4 );
		const omega = dispersion( kLength, float( constants.gravity ), float( constants.depthMeters ), float( constants.capillarySurfaceTensionOverDensity ) );
		const phase = vec2( cos( omega.mul( time ) ), sin( omega.mul( time ) ).negate() );
		const h = complexMul( initial.xy, phase ).add( complexMul( initial.zw, complexConjugate( phase ) ) );
		const ih = complexI( h );
		const kx = kVec.x;
		const kz = kVec.y;
		const xOddMask = select( int( cell.x ).equal( 0 ), float( 0.0 ), float( 1.0 ) );
		const zOddMask = select( int( cell.y ).equal( 0 ), float( 0.0 ), float( 1.0 ) );
		const crossMask = xOddMask.mul( zOddMask );
		const dx = ih.mul( kx.div( kLength ) ).mul( xOddMask );
		const dz = ih.mul( kz.div( kLength ) ).mul( zOddMask );
		const slopeX = ih.mul( kx ).mul( xOddMask );
		const slopeZ = ih.mul( kz ).mul( zOddMask );
		const dxx = h.mul( kx.mul( kx ).div( kLength ).negate() );
		const dzz = h.mul( kz.mul( kz ).div( kLength ).negate() );
		const cross = h.mul( kx.mul( kz ).div( kLength ).negate() ).mul( crossMask );
		const packed = vec4().toVar();

		If( int( fieldIndex ).equal( PACKED_FIELD_LAYOUT.horizontalDisplacement ), () => {
			packed.assign( packTwoRealFields( dx, dz ) );
		} ).ElseIf( int( fieldIndex ).equal( PACKED_FIELD_LAYOUT.heightAndCrossDerivative ), () => {
			packed.assign( packTwoRealFields( h, cross ) );
		} ).ElseIf( int( fieldIndex ).equal( PACKED_FIELD_LAYOUT.heightSlopes ), () => {
			packed.assign( packTwoRealFields( slopeX, slopeZ ) );
		} ).Else( () => {
			packed.assign( packTwoRealFields( dxx, dzz ) );
		} );

		textureStore( outputTex, cell, packed ).toWriteOnly();
	} );

	return kernel( targets ).compute( constants.resolution * constants.resolution, [ 64 ] ).setName( `ocean_evolve_${ layoutName }_cascade_${ cascade.index }` );
}

export function createBitReverseNode( resolution, axis, targets ) {
	const kernel = Fn( ( { inputTex, outputTex, bitReverseTex } ) => {
		const cell = cellFromIndex( resolution );
		const source = ivec2( cell ).toVar();
		const reverseX = int( texture( bitReverseTex, vec2( float( cell.x ).add( 0.5 ).div( resolution ), 0.5 ) ).r.mul( resolution - 1 ).round() );
		const reverseY = int( texture( bitReverseTex, vec2( float( cell.y ).add( 0.5 ).div( resolution ), 0.5 ) ).r.mul( resolution - 1 ).round() );

		If( int( axis ).equal( 0 ), () => {
			source.x.assign( reverseX );
		} ).Else( () => {
			source.y.assign( reverseY );
		} );

		textureStore( outputTex, cell, storageLoad( inputTex, source ) ).toWriteOnly();
	} );

	return kernel( targets ).compute( resolution * resolution, [ 64 ] ).setName( `ocean_fft_bit_reverse_${ axis === 0 ? 'x' : 'y' }` );
}

export function createFftStageNode( resolution, stage, axis, targets ) {
	const logResolution = Math.log2( resolution );
	const stageUvY = ( stage + 0.5 ) / logResolution;

	const kernel = Fn( ( { inputTex, outputTex, butterflyTex } ) => {
		const cell = cellFromIndex( resolution );
		const coordinate = select( int( axis ).equal( 0 ), cell.x, cell.y );
		const butterfly = texture( butterflyTex, vec2( float( coordinate ).add( 0.5 ).div( resolution ), stageUvY ) );
		const indexA = int( butterfly.z.mul( resolution - 1 ).round() );
		const indexB = int( butterfly.w.mul( resolution - 1 ).round() );
		const twiddle = butterfly.xy;
		const cellA = ivec2( cell ).toVar();
		const cellB = ivec2( cell ).toVar();

		If( int( axis ).equal( 0 ), () => {
			cellA.x.assign( indexA );
			cellB.x.assign( indexB );
		} ).Else( () => {
			cellA.y.assign( indexA );
			cellB.y.assign( indexB );
		} );

		const a = storageLoad( inputTex, cellA  );
		const b = storageLoad( inputTex, cellB  );
		const weighted0 = complexMul( twiddle, b.xy );
		const weighted1 = complexMul( twiddle, b.zw );
		textureStore( outputTex, cell, vec4( a.xy.add( weighted0 ), a.zw.add( weighted1 ) ) ).toWriteOnly();
	} );

	return kernel( targets ).compute( resolution * resolution, [ 64 ] ).setName( `ocean_fft_stage_${ stage }_${ axis === 0 ? 'x' : 'y' }` );
}

export function createCenterAndAssembleNode( cascade, targets ) {
	const constants = scalarUniformsFromCascade( cascade );

	const kernel = Fn( ( {
		field0,
		field1,
		field2,
		field3,
		displacement,
		derivatives,
		crossJacobianFoam
	} ) => {
		const cell = cellFromIndex( constants.resolution );
		const sign = select( int( cell.x.add( cell.y ).mod( 2 ) ).equal( 0 ), 1.0, - 1.0 );
		const f0 = storageLoad( field0, cell  ).mul( sign );
		const f1 = storageLoad( field1, cell  ).mul( sign );
		const f2 = storageLoad( field2, cell  ).mul( sign );
		const f3 = storageLoad( field3, cell  ).mul( sign );
		const lambda = float( constants.choppiness );
		const dDzDx = lambda.mul( f1.y );
		const jxx = float( 1.0 ).add( lambda.mul( f3.x ) );
		const jzz = float( 1.0 ).add( lambda.mul( f3.y ) );
		const jacobian = jxx.mul( jzz ).sub( dDzDx.mul( dDzDx ) );
		textureStore( displacement, cell, vec4( lambda.mul( f0.x ), f1.x, lambda.mul( f0.y ), 1.0 ) ).toWriteOnly();
		textureStore( derivatives, cell, vec4( f2.x, f2.y, lambda.mul( f3.x ), lambda.mul( f3.y ) ) ).toWriteOnly();
		textureStore( crossJacobianFoam, cell, vec4( dDzDx, jacobian, 0.0, 0.0 ) ).toWriteOnly();
	} );

	return kernel( targets ).compute( constants.resolution * constants.resolution, [ 64 ] ).setName( `ocean_assemble_cascade_${ cascade.index }` );
}

export function createDisplacementAssemblyNode( cascade, targets ) {
	const constants = scalarUniformsFromCascade( cascade );
	const kernel = Fn( ( { field0, field1, displacement } ) => {
		const cell = cellFromIndex( constants.resolution );
		const sign = select( int( cell.x.add( cell.y ).mod( 2 ) ).equal( 0 ), 1.0, - 1.0 );
		const f0 = storageLoad( field0, cell  ).mul( sign );
		const f1 = storageLoad( field1, cell  ).mul( sign );
		const lambda = float( constants.choppiness );
		textureStore( displacement, cell, vec4( lambda.mul( f0.x ), f1.x, lambda.mul( f0.y ), 1.0 ) ).toWriteOnly();
	} );
	return kernel( targets ).compute( constants.resolution * constants.resolution, [ 64 ] ).setName( `ocean_assemble_displacement_cascade_${ cascade.index }` );
}

export function createDerivativesAssemblyNode( cascade, targets ) {
	const constants = scalarUniformsFromCascade( cascade );
	const kernel = Fn( ( { field2, field3, derivatives } ) => {
		const cell = cellFromIndex( constants.resolution );
		const sign = select( int( cell.x.add( cell.y ).mod( 2 ) ).equal( 0 ), 1.0, - 1.0 );
		const f2 = storageLoad( field2, cell  ).mul( sign );
		const f3 = storageLoad( field3, cell  ).mul( sign );
		const lambda = float( constants.choppiness );
		textureStore( derivatives, cell, vec4( f2.x, f2.y, lambda.mul( f3.x ), lambda.mul( f3.y ) ) ).toWriteOnly();
	} );
	return kernel( targets ).compute( constants.resolution * constants.resolution, [ 64 ] ).setName( `ocean_assemble_derivatives_cascade_${ cascade.index }` );
}

export function createJacobianAssemblyNode( cascade, targets ) {
	const constants = scalarUniformsFromCascade( cascade );
	const kernel = Fn( ( { field1, field3, crossJacobianFoam } ) => {
		const cell = cellFromIndex( constants.resolution );
		const sign = select( int( cell.x.add( cell.y ).mod( 2 ) ).equal( 0 ), 1.0, - 1.0 );
		const f1 = storageLoad( field1, cell  ).mul( sign );
		const f3 = storageLoad( field3, cell  ).mul( sign );
		const lambda = float( constants.choppiness );
		const dDzDx = lambda.mul( f1.y );
		const jxx = float( 1.0 ).add( lambda.mul( f3.x ) );
		const jzz = float( 1.0 ).add( lambda.mul( f3.y ) );
		const jacobian = jxx.mul( jzz ).sub( dDzDx.mul( dDzDx ) );
		textureStore( crossJacobianFoam, cell, vec4( dDzDx, jacobian, 0.0, 0.0 ) ).toWriteOnly();
	} );
	return kernel( targets ).compute( constants.resolution * constants.resolution, [ 64 ] ).setName( `ocean_assemble_jacobian_cascade_${ cascade.index }` );
}

export function createFoamHistoryNode( cascade, targets ) {
	const constants = scalarUniformsFromCascade( cascade );

	const kernel = Fn( ( {
		crossJacobian,
		previousFoam,
		foamHistory,
		dt
	} ) => {
		const cell = cellFromIndex( constants.resolution );
		const jacobian = storageLoad( crossJacobian, cell  ).g;
		const previous = storageLoad( previousFoam, cell  ).r.clamp( 0.0, 1.0 );
		const sourceRate = max( float( constants.foamThreshold ).sub( jacobian ).mul( constants.foamScale ), 0.0 );
		const decayRate = max( float( constants.foamRecovery ), 1e-6 );
		const reactionRate = sourceRate.add( decayRate );
		const equilibrium = sourceRate.div( reactionRate );
		const coverage = equilibrium.add( previous.sub( equilibrium ).mul( exp( reactionRate.mul( dt ).negate() ) ) ).clamp( 0.0, 1.0 );
		textureStore( foamHistory, cell, vec4( coverage, sourceRate, jacobian, 1.0 ) ).toWriteOnly();
	} );

	return kernel( targets ).compute( constants.resolution * constants.resolution, [ 64 ] ).setName( `ocean_foam_history_cascade_${ cascade.index }` );
}
