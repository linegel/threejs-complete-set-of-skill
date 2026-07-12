const PNG_SIGNATURE = Buffer.from( [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] );

export function readPngDimensions( bytes, label = 'PNG artifact' ) {

	if ( Buffer.isBuffer( bytes ) === false || bytes.byteLength < 24 ) throw new Error( `${ label } is not a complete PNG header.` );
	if ( bytes.subarray( 0, PNG_SIGNATURE.byteLength ).equals( PNG_SIGNATURE ) === false ) throw new Error( `${ label } has an invalid PNG signature.` );
	if ( bytes.subarray( 12, 16 ).toString( 'ascii' ) !== 'IHDR' ) throw new Error( `${ label } does not begin with an IHDR chunk.` );
	const width = bytes.readUInt32BE( 16 );
	const height = bytes.readUInt32BE( 20 );
	if ( width === 0 || height === 0 ) throw new Error( `${ label } has zero PNG dimensions.` );
	return Object.freeze( { width, height } );

}
