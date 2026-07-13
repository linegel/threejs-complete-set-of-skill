import assert from 'node:assert/strict';
import test from 'node:test';

import { idleRefreshMeasurementComplete, requireCaptureTargetResourceFormat } from './physical-evidence-common.js';

function resources( captureTarget = { semantic: 'capture-target', format: 'rgba8unorm-srgb' } ) {

	return { renderTargets: [ { semantic: 'output', format: 'rgba16float' }, captureTarget ] };

}

test( 'physical evidence resolves the unique semantic sRGB capture target', () => {

	assert.equal( requireCaptureTargetResourceFormat( resources() ), 'rgba8unorm-srgb' );

} );

test( 'physical evidence rejects missing, duplicate, and wrongly formatted capture targets', () => {

	assert.throws( () => requireCaptureTargetResourceFormat( { renderTargets: [] } ), /exactly one semantic capture target/ );
	assert.throws( () => requireCaptureTargetResourceFormat( { renderTargets: [ resources().renderTargets[ 1 ], resources().renderTargets[ 1 ] ] } ), /found 2/ );
	assert.throws( () => requireCaptureTargetResourceFormat( resources( { semantic: 'capture-target', format: 'rgba8unorm' } ) ), /must use rgba8unorm-srgb/ );

} );

test( 'idle refresh completes only from the retained timestamp span and interval count', () => {

	const shortPopulation = Array.from( { length: 120 }, ( _, index ) => index * ( 2000 / 120 ) );
	assert.equal( idleRefreshMeasurementComplete( shortPopulation, 2000 ), false );
	const shortDuration = Array.from( { length: 121 }, ( _, index ) => index * ( 1999.9 / 120 ) );
	assert.equal( idleRefreshMeasurementComplete( shortDuration, 2000 ), false );
	const complete = Array.from( { length: 121 }, ( _, index ) => index * ( 2000 / 120 ) );
	assert.equal( idleRefreshMeasurementComplete( complete, 2000 ), true );
	assert.throws( () => idleRefreshMeasurementComplete( complete, 0 ), /finite and positive/ );
	assert.throws( () => idleRefreshMeasurementComplete( [ 10, 9 ], 1, 1 ), /endpoints are invalid/ );

} );
