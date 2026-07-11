function finiteVector3( value, name ) {
	if ( ! value || ! [ value.x, value.y, value.z ].every( Number.isFinite ) ) throw new Error( `${ name } must be a finite vec3.` );
	return value;
}

export function depositReceiverCaustics( samples, {
	width,
	height,
	receiverCellAreaMeters2,
	footprintAreaEpsilonMeters2
} ) {
	if ( ! Number.isInteger( width ) || width < 1 || ! Number.isInteger( height ) || height < 1 ) throw new Error( 'Receiver dimensions must be positive integers.' );
	if ( ! Number.isFinite( receiverCellAreaMeters2 ) || receiverCellAreaMeters2 <= 0 ) throw new Error( 'Receiver cell area must be positive.' );
	if ( ! Number.isFinite( footprintAreaEpsilonMeters2 ) || footprintAreaEpsilonMeters2 <= 0 ) throw new Error( 'Finite footprint epsilon must be positive.' );
	const power = new Float64Array( width * height );
	let inputPower = 0;
	let escapedPower = 0;

	for ( const sample of samples ) {
		if ( ! Number.isFinite( sample.hitX ) || ! Number.isFinite( sample.hitY ) || ! Number.isFinite( sample.power ) || sample.power < 0 ) throw new Error( 'Invalid caustic sample.' );
		inputPower += sample.power;
		const x0 = Math.floor( sample.hitX );
		const y0 = Math.floor( sample.hitY );
		let depositedWeight = 0;
		for ( let dy = 0; dy <= 1; dy += 1 ) {
			for ( let dx = 0; dx <= 1; dx += 1 ) {
				const x = x0 + dx;
				const y = y0 + dy;
				const weight = ( dx === 0 ? 1 - ( sample.hitX - x0 ) : sample.hitX - x0 )
					* ( dy === 0 ? 1 - ( sample.hitY - y0 ) : sample.hitY - y0 );
				if ( x >= 0 && x < width && y >= 0 && y < height ) {
					power[ y * width + x ] += sample.power * weight;
					depositedWeight += weight;
				}
			}
		}
		escapedPower += sample.power * Math.max( 0, 1 - depositedWeight );
	}

	const regularizedArea = Math.max( receiverCellAreaMeters2, footprintAreaEpsilonMeters2 );
	const irradiance = Float64Array.from( power, ( value ) => value / regularizedArea );
	const depositedPower = power.reduce( ( total, value ) => total + value, 0 );
	return {
		power,
		irradiance,
		inputPower,
		depositedPower,
		escapedPower,
		energyClosureError: Math.abs( inputPower - depositedPower - escapedPower ),
		regularizedArea
	};
}

export function validateRefractedRaySample( {
	waterViewPosition,
	refractedViewDirection,
	sampledViewPosition,
	candidateUv,
	maxCrossTrackMeters,
	foregroundEpsilonMeters = 1e-4
} ) {
	finiteVector3( waterViewPosition, 'waterViewPosition' );
	finiteVector3( refractedViewDirection, 'refractedViewDirection' );
	finiteVector3( sampledViewPosition, 'sampledViewPosition' );
	if ( ! candidateUv || ! [ candidateUv.x, candidateUv.y ].every( Number.isFinite ) ) throw new Error( 'candidateUv must be finite.' );
	if ( ! Number.isFinite( maxCrossTrackMeters ) || maxCrossTrackMeters < 0 ) throw new Error( 'maxCrossTrackMeters must be non-negative.' );

	if ( candidateUv.x < 0 || candidateUv.x > 1 || candidateUv.y < 0 || candidateUv.y > 1 ) return { valid: false, reason: 'off-viewport', pathLengthMeters: null, crossTrackMeters: null };
	// Three.js view-space forward is -Z. A sample with a less-negative Z than
	// the water surface is foreground and cannot be refracted as background.
	if ( sampledViewPosition.z >= waterViewPosition.z - foregroundEpsilonMeters ) return { valid: false, reason: 'foreground', pathLengthMeters: null, crossTrackMeters: null };

	const directionLength = Math.hypot( refractedViewDirection.x, refractedViewDirection.y, refractedViewDirection.z );
	if ( directionLength <= 0 ) return { valid: false, reason: 'zero-ray', pathLengthMeters: null, crossTrackMeters: null };
	const ray = {
		x: refractedViewDirection.x / directionLength,
		y: refractedViewDirection.y / directionLength,
		z: refractedViewDirection.z / directionLength
	};
	const delta = {
		x: sampledViewPosition.x - waterViewPosition.x,
		y: sampledViewPosition.y - waterViewPosition.y,
		z: sampledViewPosition.z - waterViewPosition.z
	};
	const distanceAlongRay = delta.x * ray.x + delta.y * ray.y + delta.z * ray.z;
	if ( distanceAlongRay <= 0 ) return { valid: false, reason: 'behind-ray', pathLengthMeters: null, crossTrackMeters: null };
	const residual = {
		x: delta.x - distanceAlongRay * ray.x,
		y: delta.y - distanceAlongRay * ray.y,
		z: delta.z - distanceAlongRay * ray.z
	};
	const crossTrackMeters = Math.hypot( residual.x, residual.y, residual.z );
	if ( crossTrackMeters > maxCrossTrackMeters ) return { valid: false, reason: 'cross-track', pathLengthMeters: null, crossTrackMeters };
	return { valid: true, reason: 'accepted', pathLengthMeters: distanceAlongRay, crossTrackMeters };
}

