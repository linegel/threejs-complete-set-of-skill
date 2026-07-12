import assert from 'node:assert/strict';
import test from 'node:test';

import {
	captureRecord,
	derivedMosaicCaptureRecord,
	DIAGNOSTIC_MOSAIC_RECIPE,
	DIAGNOSTIC_MOSAIC_SOURCES,
	reconstructDiagnosticMosaic,
	tierVisualErrorMetrics
} from '../capture-hook.mjs';

function solidReadback( width, height, rgba ) {

	const data = new Uint8Array( width * height * 4 );
	for ( let offset = 0; offset < data.length; offset += 4 ) data.set( rgba, offset );
	return { width, height, data };

}

test( 'direct and derived mosaic capture records retain their PNG hashes', () => {

	const sha = `sha256:${ '1'.repeat( 64 ) }`;
	const direct = captureRecord( 'final.design.png', {
		target: 'final', width: 2, height: 2, bytesPerPixel: 4, bytesPerRow: 8,
		sourceBytesPerRow: 256, sourceByteLength: 264, transportByteLength: 264,
		sourceLayout: 'padded', format: 'rgba8', colorEncoding: 'srgb',
		png: { sha256: sha },
		transport: { artifact: { sha256: sha }, rendererCopy: { requestedLayout: { alignment: 256 } }, layout: { layout: 'padded', bytesPerRow: 256 } },
		normalized: { artifact: { sha256: sha }, layout: { format: 'rgba8unorm' }, bytesPerRow: 256, byteLength: 512 }
	} );
	assert.equal( direct.pngSha256, sha );
	assert.deepEqual( direct.requestedLayout, { alignment: 256 } );
	assert.equal( direct.normalizedByteLength, 512 );
	assert.equal( derivedMosaicCaptureRecord( { width: 2, height: 2, file: { sha256: sha } } ).pngSha256, sha );

} );

test( 'the reference-tier edge mask is measured even when its visual error is zero', () => {

	const pixels = new Uint8Array( 4 * 4 * 4 );
	for ( let y = 0; y < 4; y ++ ) for ( let x = 0; x < 4; x ++ ) {

		const offset = ( y * 4 + x ) * 4;
		pixels.set( [ x < 2 ? 0 : 255, y < 2 ? 0 : 255, 32, 255 ], offset );

	}
	const metrics = tierVisualErrorMetrics( { width: 4, height: 4, data: pixels }, { width: 4, height: 4, data: pixels } );
	assert.ok( metrics.edgeMaskPixels > 0 );
	assert.equal( metrics.meanRgbByteDifference, 0 );
	assert.equal( metrics.edgeP95RgbByteDifference, 0 );

} );

test( 'diagnostic mosaic is reconstructed exactly from named retained readbacks', () => {

	const colors = [ [ 255, 0, 0, 255 ], [ 0, 255, 0, 255 ], [ 0, 0, 255, 255 ], [ 255, 255, 0, 255 ] ];
	const sources = new Map( DIAGNOSTIC_MOSAIC_SOURCES.map( ( filename, index ) => [ filename, solidReadback( 3, 3, colors[ index ] ) ] ) );
	const mosaic = reconstructDiagnosticMosaic( sources );
	assert.equal( mosaic.recipe.algorithm, DIAGNOSTIC_MOSAIC_RECIPE );
	assert.deepEqual( mosaic.recipe.quadrants.map( ( quadrant ) => quadrant.outputRect ), [
		{ x: 0, y: 0, width: 2, height: 2 },
		{ x: 2, y: 0, width: 1, height: 2 },
		{ x: 0, y: 2, width: 2, height: 1 },
		{ x: 2, y: 2, width: 1, height: 1 }
	] );
	const pixel = ( x, y ) => [ ...mosaic.data.subarray( ( y * 3 + x ) * 4, ( y * 3 + x + 1 ) * 4 ) ];
	assert.deepEqual( pixel( 0, 0 ), colors[ 0 ] );
	assert.deepEqual( pixel( 2, 0 ), colors[ 1 ] );
	assert.deepEqual( pixel( 0, 2 ), colors[ 2 ] );
	assert.deepEqual( pixel( 2, 2 ), colors[ 3 ] );

} );

test( 'diagnostic mosaic rejects missing, mismatched, and malformed sources', () => {

	const sources = Object.fromEntries( DIAGNOSTIC_MOSAIC_SOURCES.map( ( filename ) => [ filename, solidReadback( 2, 2, [ 0, 0, 0, 255 ] ) ] ) );
	const missing = { ...sources };
	delete missing[ DIAGNOSTIC_MOSAIC_SOURCES[ 1 ] ];
	assert.throws( () => reconstructDiagnosticMosaic( missing ), /missing named source/ );
	assert.throws( () => reconstructDiagnosticMosaic( { ...sources, [ DIAGNOSTIC_MOSAIC_SOURCES[ 2 ] ]: solidReadback( 3, 2, [ 0, 0, 0, 255 ] ) } ), /share dimensions/ );
	assert.throws( () => reconstructDiagnosticMosaic( { ...sources, [ DIAGNOSTIC_MOSAIC_SOURCES[ 3 ] ]: { width: 2, height: 2, data: new Uint8Array( 4 ) } } ), /byte length/ );

} );
