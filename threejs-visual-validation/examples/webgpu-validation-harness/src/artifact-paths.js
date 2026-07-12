import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VALIDATION_HARNESS_LAB_ID = 'webgpu-validation-harness';
export const VALIDATION_HARNESS_REPOSITORY_ROOT = fileURLToPath( new URL( '../../../../', import.meta.url ) );

const RAW_PROFILES = new Set( [ 'correctness' ] );
const BUNDLE_KINDS = new Set( [ 'raw', 'release' ] );

function requireChoice( choices, value, label ) {

	if ( choices.has( value ) === false ) throw new Error( `Unknown ${ label } "${ value }".` );
	return value;

}
export function canonicalRawBundleDirectory( profile = 'correctness' ) {

	requireChoice( RAW_PROFILES, profile, 'raw capture profile' );
	return join( VALIDATION_HARNESS_REPOSITORY_ROOT, 'artifacts', 'visual-validation', VALIDATION_HARNESS_LAB_ID, profile );

}

export function canonicalReleaseBundleDirectory() {

	return join( VALIDATION_HARNESS_REPOSITORY_ROOT, 'docs', 'visual-validation', VALIDATION_HARNESS_LAB_ID, 'bundle' );

}

/**
 * Resolve evidence paths against the repository, never process.cwd(). npm
 * --prefix changes the child working directory, which previously made the
 * package validator inspect a package-local shadow artifacts/ tree while the
 * shared runner wrote the repository-root tree.
 */
export function resolveValidationBundleDirectory( options = {} ) {

	const override = options.override ?? null;
	if ( override !== null ) {

		if ( typeof override !== 'string' || override.length === 0 ) throw new Error( 'Evidence directory override must be a non-empty string.' );
		return isAbsolute( override ) ? resolve( override ) : resolve( VALIDATION_HARNESS_REPOSITORY_ROOT, override );

	}

	const bundle = requireChoice( BUNDLE_KINDS, options.bundle ?? 'release', 'bundle kind' );
	return bundle === 'release'
		? canonicalReleaseBundleDirectory()
		: canonicalRawBundleDirectory( options.profile ?? 'correctness' );

}
