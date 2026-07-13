import assert from 'node:assert/strict';
import test from 'node:test';

import { requireCaptureTargetResourceFormat } from './physical-evidence-common.js';

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
