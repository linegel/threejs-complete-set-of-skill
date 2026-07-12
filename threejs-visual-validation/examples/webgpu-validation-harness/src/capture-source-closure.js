import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDemoRegistry } from '../../../../scripts/lib/lab-registry.mjs';

export const CAPTURE_CLOSURE_REPOSITORY_ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), '../../../..' );
const LAB_ROOT = 'threejs-visual-validation/examples/webgpu-validation-harness';
const EXCLUDED_SEGMENTS = new Set( [ '.DS_Store', '.git', 'artifacts', 'node_modules' ] );

export const CAPTURE_CLOSURE_ROOTS = Object.freeze( [
	LAB_ROOT,
	'scripts/lib/lab-registry.mjs',
	'scripts/lib/png-rgba.mjs',
	'scripts/lib/vite-lab-config.mjs',
	'labs/runtime/aligned-readback.mjs',
	'labs/schema/evidence-bundle-v2.schema.json',
	'labs/schema/runtime-graph.schema.json',
	'package.json',
	'package-lock.json'
] );

function repositoryPath( absolutePath ) {

	return relative( CAPTURE_CLOSURE_REPOSITORY_ROOT, absolutePath ).split( sep ).join( '/' );

}

function walkFiles( absolutePath ) {

	if ( existsSync( absolutePath ) === false ) throw new Error( `Capture source-closure root is missing: ${ repositoryPath( absolutePath ) }.` );
	const stat = lstatSync( absolutePath );
	if ( stat.isSymbolicLink() ) throw new Error( `Capture source closure forbids symbolic links: ${ repositoryPath( absolutePath ) }.` );
	if ( stat.isFile() ) return [ absolutePath ];
	if ( stat.isDirectory() === false ) return [];
	const output = [];
	for ( const entry of readdirSync( absolutePath, { withFileTypes: true } ) ) {

		if ( EXCLUDED_SEGMENTS.has( entry.name ) ) continue;
		output.push( ...walkFiles( join( absolutePath, entry.name ) ) );

	}
	return output;

}

function hashBytes( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

function canonicalClosureHash( files ) {

	const hash = createHash( 'sha256' );
	for ( const file of files ) {

		hash.update( file.repositoryPath );
		hash.update( '\0' );
		hash.update( file.sha256 );
		hash.update( '\0' );
		hash.update( String( file.byteLength ) );
		hash.update( '\0' );

	}
	return `sha256:${ hash.digest( 'hex' ) }`;

}

export function computeCaptureSourceClosure() {

	const registry = buildDemoRegistry();
	const lab = registry.demos.find( ( candidate ) => candidate.id === 'webgpu-validation-harness' );
	if ( ! lab ) throw new Error( 'webgpu-validation-harness is absent from the current demo registry.' );
	const absoluteFiles = [ ...new Set( CAPTURE_CLOSURE_ROOTS.flatMap( ( root ) => walkFiles( join( CAPTURE_CLOSURE_REPOSITORY_ROOT, root ) ) ) ) ]
		.sort( ( left, right ) => repositoryPath( left ).localeCompare( repositoryPath( right ) ) );
	const files = absoluteFiles.map( ( absolutePath ) => {

		const bytes = readFileSync( absolutePath );
		return Object.freeze( {
			repositoryPath: repositoryPath( absolutePath ),
			sha256: hashBytes( bytes ),
			byteLength: bytes.byteLength
		} );

	} );
	return Object.freeze( {
		algorithm: 'validation-harness-codex-browser-source-closure-v4',
		roots: [ ...CAPTURE_CLOSURE_ROOTS ],
		files,
		threeRevision: '0.185.1',
		sourceHash: canonicalClosureHash( files ),
		buildRevision: registry.buildRevision,
		registrySourceHash: lab.sourceHash
	} );

}

function canonical( value ) {

	if ( Array.isArray( value ) ) return value.map( canonical );
	if ( value && typeof value === 'object' ) return Object.fromEntries( Object.keys( value ).sort().map( ( key ) => [ key, canonical( value[ key ] ) ] ) );
	return value;

}

export function validateCaptureSourceClosure( candidate ) {

	const current = computeCaptureSourceClosure();
	if ( JSON.stringify( canonical( candidate ) ) !== JSON.stringify( canonical( current ) ) ) throw new Error( 'Capture source closure does not match current canonical source and shared capture tooling.' );
	return true;

}
