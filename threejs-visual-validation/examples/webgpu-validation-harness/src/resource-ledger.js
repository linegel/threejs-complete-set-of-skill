function requireDimension( value, label ) {

	if ( Number.isInteger( value ) === false || value <= 0 ) throw new Error( `${ label } must be a positive integer.` );
	return value;

}

function target( name, owner, width, height, format, bytesPerTexel ) {

	return {
		name,
		owner,
		width,
		height,
		format,
		bytesPerTexel,
		bytes: width * height * bytesPerTexel,
		byteAccounting: 'exact logical uncompressed allocation'
	};

}

export function buildValidationResourceLedger( dimensions ) {

	const sceneWidth = requireDimension( dimensions.sceneWidth, 'sceneWidth' );
	const sceneHeight = requireDimension( dimensions.sceneHeight, 'sceneHeight' );
	const captureWidth = requireDimension( dimensions.captureWidth, 'captureWidth' );
	const captureHeight = requireDimension( dimensions.captureHeight, 'captureHeight' );

	return {
		renderTargets: [
			target( 'output', 'scene-pass', sceneWidth, sceneHeight, 'rgba16float', 8 ),
			target( 'normal', 'scene-pass', sceneWidth, sceneHeight, 'rgba16float', 8 ),
			target( 'emissive', 'scene-pass', sceneWidth, sceneHeight, 'rgba16float', 8 ),
			target( 'depth', 'scene-pass', sceneWidth, sceneHeight, 'depth32float', 4 ),
			target( 'capture-target', 'validation-capture', captureWidth, captureHeight, 'rgba8unorm', 4 )
		],
		storageResources: [],
		readbackPolicy: 'render target copy with 256-byte aligned rows; unpacked after map completion'
	};

}
