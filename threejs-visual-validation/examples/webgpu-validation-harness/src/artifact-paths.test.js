import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
	canonicalRawBundleDirectory,
	canonicalReleaseBundleDirectory,
	resolveValidationBundleDirectory,
	VALIDATION_HARNESS_REPOSITORY_ROOT
} from './artifact-paths.js';

test( 'raw and release evidence paths are anchored at the repository root', () => {

	assert.equal(
		canonicalRawBundleDirectory( 'correctness' ),
		join( VALIDATION_HARNESS_REPOSITORY_ROOT, 'artifacts/visual-validation/webgpu-validation-harness/correctness' )
	);
	assert.equal(
		canonicalRawBundleDirectory( 'performance' ),
		join( VALIDATION_HARNESS_REPOSITORY_ROOT, 'artifacts/visual-validation/webgpu-validation-harness/performance' )
	);
	assert.equal(
		canonicalReleaseBundleDirectory(),
		join( VALIDATION_HARNESS_REPOSITORY_ROOT, 'docs/visual-validation/webgpu-validation-harness/bundle' )
	);

} );

test( 'relative overrides resolve from the repository instead of npm prefix cwd', () => {

	assert.equal(
		resolveValidationBundleDirectory( { override: 'artifacts/custom-validation-bundle' } ),
		join( VALIDATION_HARNESS_REPOSITORY_ROOT, 'artifacts/custom-validation-bundle' )
	);
	assert.equal( resolveValidationBundleDirectory(), canonicalReleaseBundleDirectory() );
	assert.equal(
		resolveValidationBundleDirectory( { bundle: 'raw', profile: 'performance' } ),
		canonicalRawBundleDirectory( 'performance' )
	);
	assert.throws( () => resolveValidationBundleDirectory( { bundle: 'raw', profile: 'typo' } ), /Unknown raw capture profile/ );
	assert.throws( () => resolveValidationBundleDirectory( { bundle: 'shadow' } ), /Unknown bundle kind/ );

} );
