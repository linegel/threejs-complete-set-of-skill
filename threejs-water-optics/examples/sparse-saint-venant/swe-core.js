export const SWE_SOLVER_DECISION = Object.freeze( {
	problemId: 'persistent-wet-dry-coastal-flow',
	axes: Object.freeze( [ 'wellBalanced', 'positivity', 'shockWetDry', 'gpuCost', 'evidenceSimplicity' ] ),
	selectedCandidateId: 'hll-hydrostatic-reconstruction',
	candidates: Object.freeze( [
		Object.freeze( { id: 'centered-finite-difference', family: 'centered finite differences', scores: [ 2, 1, 1, 5, 2 ], hardGate: 'fail:shock-and-positivity' } ),
		Object.freeze( { id: 'rusanov-hydrostatic-reconstruction', family: 'Rusanov finite volume with hydrostatic reconstruction', scores: [ 5, 5, 4, 4, 5 ], hardGate: 'fail:excess-diffusion-at-target-resolution' } ),
		Object.freeze( { id: 'hll-hydrostatic-reconstruction', family: 'HLL finite volume with hydrostatic reconstruction', scores: [ 5, 5, 5, 5, 5 ], hardGate: 'pass' } ),
		Object.freeze( { id: 'hllc-hydrostatic-reconstruction', family: 'HLLC finite volume with hydrostatic reconstruction', scores: [ 5, 4, 5, 3, 3 ], hardGate: 'fail:dry-state-branch-risk' } ),
		Object.freeze( { id: 'central-upwind', family: 'central-upwind Kurganov-Petrova finite volume', scores: [ 5, 5, 5, 3, 4 ], hardGate: 'fail:larger-first-route-surface' } ),
		Object.freeze( { id: 'dg-or-boussinesq', family: 'discontinuous-Galerkin or Boussinesq family', scores: [ 3, 2, 3, 1, 1 ], hardGate: 'fail:unjustified-dispersive-complexity' } )
	] )
} );

export function createSweState( { nx, nz, dx, dz, gravity = 9.80665, dryTolerance = 1e-6, bed = null } ) {

	if ( ! Number.isInteger( nx ) || nx < 3 || ! Number.isInteger( nz ) || nz < 3 ) throw new Error( 'SWE grid requires integer nx,nz >= 3' );
	if ( ! Number.isFinite( dx ) || dx <= 0 || ! Number.isFinite( dz ) || dz <= 0 ) throw new Error( 'SWE cell dimensions must be finite and positive' );
	const count = nx * nz;
	const bedValues = bed ? Float64Array.from( bed ) : new Float64Array( count );
	if ( bedValues.length !== count || bedValues.some( ( value ) => ! Number.isFinite( value ) ) ) throw new Error( 'SWE bed must contain one finite elevation per cell' );
	return { nx, nz, dx, dz, gravity, dryTolerance, h: new Float64Array( count ), mx: new Float64Array( count ), mz: new Float64Array( count ), bed: bedValues, timeSeconds: 0, stepCount: 0 };

}

export function cellIndex( state, x, z ) { return z * state.nx + x; }

export function setFreeSurface( state, surfaceHeight, velocity = [ 0, 0 ] ) {

	for ( let index = 0; index < state.h.length; index += 1 ) {

		const height = Math.max( 0, surfaceHeight - state.bed[ index ] );
		state.h[ index ] = height;
		state.mx[ index ] = height > state.dryTolerance ? height * velocity[ 0 ] : 0;
		state.mz[ index ] = height > state.dryTolerance ? height * velocity[ 1 ] : 0;

	}
	return state;

}

function physicalFlux( h, mn, mt, gravity ) {

	if ( h <= 0 ) return [ 0, 0, 0 ];
	const un = mn / h;
	return [ mn, mn * un + 0.5 * gravity * h * h, mt * un ];

}

function hllFlux( left, right, gravity, dryTolerance ) {

	const hL = left[ 0 ];
	const hR = right[ 0 ];
	if ( hL <= dryTolerance && hR <= dryTolerance ) return [ 0, 0, 0 ];
	const uL = hL > dryTolerance ? left[ 1 ] / hL : 0;
	const uR = hR > dryTolerance ? right[ 1 ] / hR : 0;
	const cL = Math.sqrt( gravity * Math.max( hL, 0 ) );
	const cR = Math.sqrt( gravity * Math.max( hR, 0 ) );
	const sL = Math.min( uL - cL, uR - cR );
	const sR = Math.max( uL + cL, uR + cR );
	const fL = physicalFlux( hL, left[ 1 ], left[ 2 ], gravity );
	const fR = physicalFlux( hR, right[ 1 ], right[ 2 ], gravity );
	if ( sL >= 0 ) return fL;
	if ( sR <= 0 ) return fR;
	const inverse = 1 / Math.max( sR - sL, 1e-14 );
	return [
		( sR * fL[ 0 ] - sL * fR[ 0 ] + sL * sR * ( hR - hL ) ) * inverse,
		( sR * fL[ 1 ] - sL * fR[ 1 ] + sL * sR * ( right[ 1 ] - left[ 1 ] ) ) * inverse,
		( sR * fL[ 2 ] - sL * fR[ 2 ] + sL * sR * ( right[ 2 ] - left[ 2 ] ) ) * inverse
	];

}

function reconstructFace( hL, mnL, mtL, bedL, hR, mnR, mtR, bedR, gravity, dryTolerance ) {

	const bedFace = Math.max( bedL, bedR );
	const reconstructedHL = Math.max( 0, hL + bedL - bedFace );
	const reconstructedHR = Math.max( 0, hR + bedR - bedFace );
	const leftScale = hL > dryTolerance ? reconstructedHL / hL : 0;
	const rightScale = hR > dryTolerance ? reconstructedHR / hR : 0;
	const flux = hllFlux( [ reconstructedHL, mnL * leftScale, mtL * leftScale ], [ reconstructedHR, mnR * rightScale, mtR * rightScale ], gravity, dryTolerance );
	return {
		left: [ flux[ 0 ], flux[ 1 ] + 0.5 * gravity * ( hL * hL - reconstructedHL * reconstructedHL ), flux[ 2 ] ],
		right: [ flux[ 0 ], flux[ 1 ] + 0.5 * gravity * ( hR * hR - reconstructedHR * reconstructedHR ), flux[ 2 ] ]
	};

}

function sampleCell( state, x, z, axis ) {

	let sampleX = x;
	let sampleZ = z;
	let reflect = false;
	if ( x < 0 ) { sampleX = 0; reflect = axis === 'x'; }
	if ( x >= state.nx ) { sampleX = state.nx - 1; reflect = axis === 'x'; }
	if ( z < 0 ) { sampleZ = 0; reflect = axis === 'z'; }
	if ( z >= state.nz ) { sampleZ = state.nz - 1; reflect = axis === 'z'; }
	const index = cellIndex( state, sampleX, sampleZ );
	return { h: state.h[ index ], mx: reflect && axis === 'x' ? -state.mx[ index ] : state.mx[ index ], mz: reflect && axis === 'z' ? -state.mz[ index ] : state.mz[ index ], bed: state.bed[ index ] };

}

export function computeStableSweDt( state, cfl = 0.35 ) {

	let maximumRate = 0;
	for ( let index = 0; index < state.h.length; index += 1 ) {

		const h = state.h[ index ];
		if ( h <= state.dryTolerance ) continue;
		const waveSpeed = Math.sqrt( state.gravity * h );
		maximumRate = Math.max( maximumRate, ( Math.abs( state.mx[ index ] / h ) + waveSpeed ) / state.dx + ( Math.abs( state.mz[ index ] / h ) + waveSpeed ) / state.dz );

	}
	return maximumRate > 0 ? cfl / maximumRate : Number.POSITIVE_INFINITY;

}

export function advanceSwe( state, dt ) {

	if ( ! Number.isFinite( dt ) || dt <= 0 ) throw new Error( 'SWE dt must be finite and positive' );
	const stableDt = computeStableSweDt( state );
	if ( dt > stableDt * ( 1 + 1e-12 ) ) throw new Error( `SWE CFL exceeded: dt ${ dt } > ${ stableDt }` );
	const nextH = state.h.slice();
	const nextMx = state.mx.slice();
	const nextMz = state.mz.slice();
	for ( let z = 0; z < state.nz; z += 1 ) for ( let x = 0; x < state.nx; x += 1 ) {

		const index = cellIndex( state, x, z );
		const center = sampleCell( state, x, z, 'x' );
		const west = sampleCell( state, x - 1, z, 'x' );
		const east = sampleCell( state, x + 1, z, 'x' );
		const westFace = reconstructFace( west.h, west.mx, west.mz, west.bed, center.h, center.mx, center.mz, center.bed, state.gravity, state.dryTolerance );
		const eastFace = reconstructFace( center.h, center.mx, center.mz, center.bed, east.h, east.mx, east.mz, east.bed, state.gravity, state.dryTolerance );
		const south = sampleCell( state, x, z - 1, 'z' );
		const north = sampleCell( state, x, z + 1, 'z' );
		const southFace = reconstructFace( south.h, south.mz, south.mx, south.bed, center.h, center.mz, center.mx, center.bed, state.gravity, state.dryTolerance );
		const northFace = reconstructFace( center.h, center.mz, center.mx, center.bed, north.h, north.mz, north.mx, north.bed, state.gravity, state.dryTolerance );
		nextH[ index ] -= dt / state.dx * ( eastFace.left[ 0 ] - westFace.right[ 0 ] ) + dt / state.dz * ( northFace.left[ 0 ] - southFace.right[ 0 ] );
		nextMx[ index ] -= dt / state.dx * ( eastFace.left[ 1 ] - westFace.right[ 1 ] ) + dt / state.dz * ( northFace.left[ 2 ] - southFace.right[ 2 ] );
		nextMz[ index ] -= dt / state.dx * ( eastFace.left[ 2 ] - westFace.right[ 2 ] ) + dt / state.dz * ( northFace.left[ 1 ] - southFace.right[ 1 ] );

	}
	for ( let index = 0; index < nextH.length; index += 1 ) {

		if ( nextH[ index ] < -1e-10 ) throw new Error( `SWE positivity failed at cell ${ index }: ${ nextH[ index ] } m` );
		if ( nextH[ index ] <= state.dryTolerance ) { nextH[ index ] = Math.max( 0, nextH[ index ] ); nextMx[ index ] = 0; nextMz[ index ] = 0; }

	}
	state.h = nextH;
	state.mx = nextMx;
	state.mz = nextMz;
	state.timeSeconds += dt;
	state.stepCount += 1;
	return state;

}

export function totalWaterVolume( state ) {

	let sum = 0;
	for ( const height of state.h ) sum += height;
	return sum * state.dx * state.dz;

}

export function maximumFreeSurfaceResidual( state, expectedSurface ) {

	let maximum = 0;
	for ( let index = 0; index < state.h.length; index += 1 ) if ( state.h[ index ] > state.dryTolerance ) maximum = Math.max( maximum, Math.abs( state.h[ index ] + state.bed[ index ] - expectedSurface ) );
	return maximum;

}
