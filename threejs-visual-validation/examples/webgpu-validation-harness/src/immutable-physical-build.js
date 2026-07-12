import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build as viteBuild } from 'vite';

import { REPO_ROOT } from '../../../../scripts/lib/lab-registry.mjs';
import { computeCaptureSourceClosure, validateCaptureSourceClosure } from './capture-source-closure.js';
import { stableStringify } from './physical-evidence-common.js';

const HARNESS_ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const MANIFEST_NAME = 'immutable-build-manifest.json';

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

function isWithin( path, parent ) {

	const rel = relative( parent, path );
	return rel === '' || ( rel.startsWith( '..' ) === false && isAbsolute( rel ) === false );

}

async function listFiles( root, directory = root ) {

	const files = [];
	for ( const entry of await readdir( directory, { withFileTypes: true } ) ) {

		const path = join( directory, entry.name );
		if ( entry.isSymbolicLink() ) throw new Error( `Immutable physical build rejects symlink ${ path }.` );
		if ( entry.isDirectory() ) files.push( ...( await listFiles( root, path ) ) );
		else if ( entry.isFile() ) files.push( relative( root, path ).replaceAll( '\\', '/' ) );

	}
	return files.sort();

}

async function buildFileLedger( outputDirectory ) {

	const ledger = {};
	for ( const path of await listFiles( outputDirectory ) ) {

		if ( path === MANIFEST_NAME ) continue;
		const bytes = await readFile( join( outputDirectory, path ) );
		ledger[ path ] = { sha256: sha256( bytes ), byteLength: bytes.byteLength };

	}
	return ledger;

}

function physicalManifestIdentity() {

	const sourceClosure = computeCaptureSourceClosure();
	const contentAddress = sha256( Buffer.from( stableStringify( {
		sourceClosureHash: sourceClosure.sourceHash,
		buildRevision: sourceClosure.buildRevision,
		threeRevision: sourceClosure.threeRevision
	} ) ) );
	return { sourceClosureHash: sourceClosure.sourceHash, buildRevision: sourceClosure.buildRevision, sourceClosure, contentAddress };

}

export async function loadAndValidateImmutableBuild( outputDirectory ) {

	const manifestPath = join( outputDirectory, MANIFEST_NAME );
	const manifestBytes = await readFile( manifestPath );
	const manifest = JSON.parse( manifestBytes.toString( 'utf8' ) );
	if ( manifest.schemaVersion !== 1 || manifest.kind !== 'immutable-physical-build' || manifest.immutable !== true ) throw new Error( 'Immutable physical build manifest is invalid.' );
	validateCaptureSourceClosure( manifest.sourceClosure );
	if ( manifest.sourceClosureHash !== manifest.sourceClosure.sourceHash || manifest.buildRevision !== manifest.sourceClosure.buildRevision ) throw new Error( 'Immutable build identity differs from its source closure.' );
	const expectedContentAddress = sha256( Buffer.from( stableStringify( {
		sourceClosureHash: manifest.sourceClosureHash,
		buildRevision: manifest.buildRevision,
		threeRevision: manifest.threeRevision
	} ) ) );
	if ( manifest.contentAddress !== expectedContentAddress ) throw new Error( 'Immutable build content address does not bind source, build, and Three identities.' );
	const actualFiles = await buildFileLedger( outputDirectory );
	if ( stableStringify( actualFiles ) !== stableStringify( manifest.files ) ) throw new Error( 'Immutable physical build bytes no longer match their file ledger.' );
	const bundleHash = sha256( Buffer.from( stableStringify( actualFiles ) ) );
	if ( manifest.bundleHash !== bundleHash ) throw new Error( 'Immutable physical build bundle hash is stale.' );
	return { directory: outputDirectory, manifest, manifestBytes, manifestFileSha256: sha256( manifestBytes ) };

}

export async function buildImmutablePhysicalSurface( options = {} ) {

	const outputRoot = resolve( options.outputRoot ?? process.env.THREEJS_PHYSICAL_BUILD_ROOT ?? join( tmpdir(), 'threejs-webgpu-physical-builds' ) );
	if ( isWithin( outputRoot, REPO_ROOT ) ) throw new Error( 'Immutable physical builds must be written outside the repository.' );
	const identity = physicalManifestIdentity();
	const outputDirectory = join( outputRoot, identity.contentAddress.replace( 'sha256:', 'sha256-' ) );
	const manifestPath = join( outputDirectory, MANIFEST_NAME );
	if ( existsSync( manifestPath ) ) {

		const existing = await loadAndValidateImmutableBuild( outputDirectory );
		if ( existing.manifest.sourceClosureHash !== identity.sourceClosureHash || existing.manifest.buildRevision !== identity.buildRevision ) throw new Error( 'Existing immutable build identity does not match current source.' );
		return existing;

	}
	await mkdir( outputRoot, { recursive: true } );
	if ( existsSync( outputDirectory ) ) throw new Error( `Refusing to overwrite incomplete immutable build directory ${ outputDirectory }.` );
	const stagingDirectory = join( outputRoot, `.${ basename( outputDirectory ) }.staging-${ process.pid }-${ randomUUID() }` );
	await mkdir( stagingDirectory );

	await viteBuild( {
		root: HARNESS_ROOT,
		publicDir: false,
		logLevel: options.logLevel ?? 'warn',
		build: {
			outDir: stagingDirectory,
			emptyOutDir: false,
			assetsDir: 'assets',
			sourcemap: false,
			manifest: false,
			rollupOptions: {
				input: {
					index: join( HARNESS_ROOT, 'index.html' ),
					'in-app-evidence': join( HARNESS_ROOT, 'src/in-app-evidence.html' )
				}
			}
		}
	} );

	const files = await buildFileLedger( stagingDirectory );
	if ( files[ 'index.html' ] === undefined || files[ 'src/in-app-evidence.html' ] === undefined ) throw new Error( 'Immutable physical build omitted a required browser entry.' );
	const manifest = {
		schemaVersion: 1,
		kind: 'immutable-physical-build',
		immutable: true,
		viteDevelopmentServer: false,
		transformAtServe: false,
		redirects: false,
		spaFallback: false,
		contentAddress: identity.contentAddress,
		sourceClosureHash: identity.sourceClosureHash,
		buildRevision: identity.buildRevision,
		sourceClosure: identity.sourceClosure,
		threeRevision: '0.185.1',
		bundleHash: sha256( Buffer.from( stableStringify( files ) ) ),
		files
	};
	const stagingManifestPath = join( stagingDirectory, MANIFEST_NAME );
	await writeFile( stagingManifestPath, `${ JSON.stringify( manifest, null, 2 ) }\n`, { flag: 'wx' } );
	await loadAndValidateImmutableBuild( stagingDirectory );
	try {

		await rename( stagingDirectory, outputDirectory );

	} catch ( error ) {

		if ( ( error.code === 'EEXIST' || error.code === 'ENOTEMPTY' ) && existsSync( manifestPath ) ) return loadAndValidateImmutableBuild( outputDirectory );
		error.message = `${ error.message } Staged immutable bytes were retained at ${ stagingDirectory } for forensic inspection; no deletion was attempted.`;
		throw error;

	}
	return loadAndValidateImmutableBuild( outputDirectory );

}

function argument( name ) {

	const index = process.argv.indexOf( name );
	return index < 0 ? null : process.argv[ index + 1 ];

}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const result = await buildImmutablePhysicalSurface( { outputRoot: argument( '--output-root' ) ?? undefined } );
	process.stdout.write( `${ JSON.stringify( {
		buildDirectory: result.directory,
		sourceClosureHash: result.manifest.sourceClosureHash,
		buildRevision: result.manifest.buildRevision,
		bundleHash: result.manifest.bundleHash
	}, null, 2 ) }\n` );

}
