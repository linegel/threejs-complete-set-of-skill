export const COASTAL_FOAM_DECISION = Object.freeze( {
	problemId: 'coastal-breaking-foam-state',
	axes: Object.freeze( [ 'causalSource', 'transportTruth', 'boundedness', 'mobileCost', 'handoffOwnership' ] ),
	selectedCandidateId: 'conservative-eulerian-coverage',
	candidates: Object.freeze( [
		Object.freeze( { id: 'stateless-threshold', family: 'instantaneous white threshold from slope or noise', scores: [ 2, 1, 3, 5, 1 ], hardGate: 'fail:no-history-or-transport' } ),
		Object.freeze( { id: 'screen-history', family: 'screen-space foam accumulation', scores: [ 1, 1, 2, 3, 1 ], hardGate: 'fail:not-world-anchored' } ),
		Object.freeze( { id: 'spray-particles', family: 'particle-only foam and spray markers', scores: [ 3, 2, 3, 2, 2 ], hardGate: 'fail:no-continuous-coverage-state' } ),
		Object.freeze( { id: 'semi-lagrangian-coverage', family: 'Eulerian backtrace with bounded correction', scores: [ 4, 3, 4, 4, 4 ], hardGate: 'fail:unquantified-coverage-loss-for-authoritative-state' } ),
		Object.freeze( { id: 'lagrangian-spectral-history', family: 'foam attached to offshore spectral parameter coordinates', scores: [ 4, 4, 4, 5, 2 ], hardGate: 'fail:wrong-coordinate-owner-for-coastal-SWE' } ),
		Object.freeze( { id: 'conservative-eulerian-coverage', family: 'finite-volume coverage transport plus exact reaction', scores: [ 5, 5, 5, 4, 5 ], hardGate: 'pass' } )
	] )
} );

function requireFinite( value, label ) {

	if ( ! Number.isFinite( value ) ) throw new Error( `${ label } must be finite` );
	return value;

}

function requireArray( value, length, label ) {

	if ( ! ( value instanceof Float64Array ) || value.length !== length ) throw new Error( `${ label } must be a Float64Array(${ length })` );
	for ( let index = 0; index < length; index += 1 ) if ( ! Number.isFinite( value[ index ] ) ) throw new Error( `${ label } contains a non-finite value` );
	return value;

}

export function exactFoamReaction( coverage, sourceRatePerSecond, decayRatePerSecond, dtSeconds ) {

	const f = requireFinite( coverage, 'coverage' );
	const source = requireFinite( sourceRatePerSecond, 'sourceRatePerSecond' );
	const decay = requireFinite( decayRatePerSecond, 'decayRatePerSecond' );
	const dt = requireFinite( dtSeconds, 'dtSeconds' );
	if ( f < 0 || f > 1 || source < 0 || decay < 0 || dt < 0 ) throw new Error( 'foam reaction inputs lie outside their physical domain' );
	const rate = source + decay;
	if ( rate === 0 || dt === 0 ) return f;
	const equilibrium = source / rate;
	return equilibrium + ( f - equilibrium ) * Math.exp( -rate * dt );

}

function sampleIndex( x, z, width, height, boundary ) {

	if ( boundary === 'periodic' ) return ( ( z % height + height ) % height ) * width + ( x % width + width ) % width;
	const clampedX = Math.max( 0, Math.min( width - 1, x ) );
	const clampedZ = Math.max( 0, Math.min( height - 1, z ) );
	return clampedZ * width + clampedX;

}

export function advanceFoamCoverage( {
	coverage,
	sourceRatePerSecond,
	velocityXMps,
	velocityZMps,
	width,
	height,
	cellSizeMeters,
	dtSeconds,
	decayRatePerSecond,
	diffusionM2ps = 0,
	boundary = 'closed'
} ) {

	if ( ! Number.isInteger( width ) || ! Number.isInteger( height ) || width < 2 || height < 2 ) throw new Error( 'foam grid dimensions must be integers >= 2' );
	if ( boundary !== 'closed' && boundary !== 'periodic' ) throw new Error( `unknown foam boundary '${ boundary }'` );
	const cellCount = width * height;
	requireArray( coverage, cellCount, 'coverage' );
	requireArray( sourceRatePerSecond, cellCount, 'sourceRatePerSecond' );
	requireArray( velocityXMps, cellCount, 'velocityXMps' );
	requireArray( velocityZMps, cellCount, 'velocityZMps' );
	const dx = requireFinite( cellSizeMeters, 'cellSizeMeters' );
	const dt = requireFinite( dtSeconds, 'dtSeconds' );
	const decay = requireFinite( decayRatePerSecond, 'decayRatePerSecond' );
	const diffusion = requireFinite( diffusionM2ps, 'diffusionM2ps' );
	if ( dx <= 0 || dt <= 0 || decay < 0 || diffusion < 0 ) throw new Error( 'foam step inputs lie outside their physical domain' );
	for ( let index = 0; index < cellCount; index += 1 ) {

		if ( coverage[ index ] < 0 || coverage[ index ] > 1 ) throw new Error( 'foam coverage must remain in [0, 1]' );
		if ( sourceRatePerSecond[ index ] < 0 ) throw new Error( 'foam source rate must be nonnegative' );

	}
	let maximumUnsplitCfl = 0;
	for ( let index = 0; index < cellCount; index += 1 ) maximumUnsplitCfl = Math.max( maximumUnsplitCfl, ( Math.abs( velocityXMps[ index ] ) + Math.abs( velocityZMps[ index ] ) ) * dt / dx );
	if ( maximumUnsplitCfl > 1 + 1e-12 ) throw new Error( `foam unsplit advection CFL ${ maximumUnsplitCfl } exceeds 1` );
	const diffusionNumber = diffusion * dt * ( 2 / dx ** 2 );
	if ( diffusionNumber > 0.5 + 1e-12 ) throw new Error( `foam explicit diffusion number ${ diffusionNumber } exceeds 0.5` );

	const transported = new Float64Array( cellCount );
	let priorCoverageSum = 0;
	let transportedCoverageSum = 0;
	for ( let z = 0; z < height; z += 1 ) for ( let x = 0; x < width; x += 1 ) {

		const centerIndex = z * width + x;
		const westIndex = sampleIndex( x - 1, z, width, height, boundary );
		const eastIndex = sampleIndex( x + 1, z, width, height, boundary );
		const southIndex = sampleIndex( x, z - 1, width, height, boundary );
		const northIndex = sampleIndex( x, z + 1, width, height, boundary );
		const westVelocity = 0.5 * ( velocityXMps[ westIndex ] + velocityXMps[ centerIndex ] );
		const eastVelocity = 0.5 * ( velocityXMps[ centerIndex ] + velocityXMps[ eastIndex ] );
		const southVelocity = 0.5 * ( velocityZMps[ southIndex ] + velocityZMps[ centerIndex ] );
		const northVelocity = 0.5 * ( velocityZMps[ centerIndex ] + velocityZMps[ northIndex ] );
		const westFlux = Math.max( westVelocity, 0 ) * coverage[ westIndex ] + Math.min( westVelocity, 0 ) * coverage[ centerIndex ];
		const eastFlux = Math.max( eastVelocity, 0 ) * coverage[ centerIndex ] + Math.min( eastVelocity, 0 ) * coverage[ eastIndex ];
		const southFlux = Math.max( southVelocity, 0 ) * coverage[ southIndex ] + Math.min( southVelocity, 0 ) * coverage[ centerIndex ];
		const northFlux = Math.max( northVelocity, 0 ) * coverage[ centerIndex ] + Math.min( northVelocity, 0 ) * coverage[ northIndex ];
		const laplacian = ( coverage[ westIndex ] + coverage[ eastIndex ] + coverage[ southIndex ] + coverage[ northIndex ] - 4 * coverage[ centerIndex ] ) / dx ** 2;
		const next = coverage[ centerIndex ] - dt / dx * ( eastFlux - westFlux + northFlux - southFlux ) + diffusion * dt * laplacian;
		if ( next < -1e-12 || next > 1 + 1e-12 ) throw new Error( `foam transport lost boundedness at cell ${ centerIndex }: ${ next }` );
		transported[ centerIndex ] = Math.max( 0, Math.min( 1, next ) );
		priorCoverageSum += coverage[ centerIndex ];
		transportedCoverageSum += transported[ centerIndex ];

	}

	const nextCoverage = new Float64Array( cellCount );
	let finalCoverageSum = 0;
	let sourceGain = 0;
	let decayLoss = 0;
	for ( let index = 0; index < cellCount; index += 1 ) {

		const sourceOnly = exactFoamReaction( transported[ index ], sourceRatePerSecond[ index ], 0, dt );
		const reacted = exactFoamReaction( transported[ index ], sourceRatePerSecond[ index ], decay, dt );
		nextCoverage[ index ] = reacted;
		finalCoverageSum += reacted;
		sourceGain += sourceOnly - transported[ index ];
		decayLoss += sourceOnly - reacted;

	}
	return Object.freeze( {
		coverage: nextCoverage,
		diagnostics: Object.freeze( {
			priorCoverageSum,
			transportedCoverageSum,
			finalCoverageSum,
			transportResidual: transportedCoverageSum - priorCoverageSum,
			sourceGain,
			decayLoss,
			maximumUnsplitCfl,
			diffusionNumber,
			boundary,
			clampCount: 0
		} )
	} );

}
