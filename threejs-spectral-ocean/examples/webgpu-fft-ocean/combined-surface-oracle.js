function finiteNumber( value, name ) {
	if ( ! Number.isFinite( value ) ) throw new Error( `${ name } must be finite.` );
	return value;
}

export function combineOceanSurfaceSamples( samples, {
	foamThreshold = 0.4,
	foamScale = 2.5
} = {} ) {
	if ( ! Array.isArray( samples ) || samples.length === 0 ) throw new Error( 'Combined ocean surface requires at least one cascade sample.' );
	const sum = {
		displacementX: 0,
		height: 0,
		displacementZ: 0,
		slopeX: 0,
		slopeZ: 0,
		displacementXX: 0,
		displacementZZ: 0,
		displacementXZ: 0
	};
	for ( const sample of samples ) {
		for ( const key of Object.keys( sum ) ) sum[ key ] += finiteNumber( sample[ key ], `sample.${ key }` );
	}

	const A = 1 + sum.displacementXX;
	const B = sum.displacementXZ;
	const C = 1 + sum.displacementZZ;
	const jacobian = A * C - B * B;
	const unnormalized = [
		sum.slopeZ * B - C * sum.slopeX,
		jacobian,
		B * sum.slopeX - sum.slopeZ * A
	];
	const normalLength = Math.hypot( ...unnormalized );
	if ( ! Number.isFinite( normalLength ) || normalLength <= 0 ) throw new Error( 'Combined ocean tangent frame is singular.' );
	const normal = unnormalized.map( ( component ) => component / normalLength );
	const foamSourceRate = Math.max( ( foamThreshold - jacobian ) * foamScale, 0 );

	return { ...sum, A, B, C, jacobian, normal, foamSourceRate };
}

export function advanceLagrangianOceanFoam( previousCoverage, sourceRate, deltaSeconds, decayRate ) {
	for ( const [ name, value ] of Object.entries( { previousCoverage, sourceRate, deltaSeconds, decayRate } ) ) finiteNumber( value, name );
	if ( previousCoverage < 0 || previousCoverage > 1 ) throw new Error( 'Previous foam coverage must be in [0,1].' );
	if ( sourceRate < 0 || deltaSeconds < 0 || decayRate <= 0 ) throw new Error( 'Foam rates and timestep are outside the physical domain.' );
	const reactionRate = sourceRate + decayRate;
	const equilibrium = sourceRate / reactionRate;
	return Math.min( 1, Math.max( 0, equilibrium + ( previousCoverage - equilibrium ) * Math.exp( - reactionRate * deltaSeconds ) ) );
}

