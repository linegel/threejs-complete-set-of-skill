import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildImmutablePhysicalSurface, loadAndValidateImmutableBuild } from './immutable-physical-build.js';

export const CAPTURE_POLICY = 'codex-in-app-browser-immutable-evidence';

const MIME_TYPES = Object.freeze( {
	'.avif': 'image/avif',
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.webp': 'image/webp'
} );

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

export function resolveImmutableRequest( rawUrl, immutableBuild ) {

	const url = new URL( rawUrl, 'http://immutable.invalid' );
	if ( url.origin !== 'http://immutable.invalid' ) return { status: 400, reason: 'cross-origin-request-target' };
	let decoded;
	try {

		decoded = decodeURIComponent( url.pathname );

	} catch {

		return { status: 400, reason: 'invalid-url-encoding' };

	}
	if ( decoded.includes( String.fromCharCode( 92 ) ) || decoded.includes( String.fromCharCode( 0 ) ) ) return { status: 400, reason: 'invalid-path' };
	const path = decoded === '/' ? 'index.html' : decoded.replace( /^\/+/, '' );
	if ( path.split( '/' ).some( ( segment ) => segment === '..' || segment === '.' ) ) return { status: 400, reason: 'path-traversal' };
	const descriptor = path === 'immutable-build-manifest.json'
		? { sha256: immutableBuild.manifestFileSha256, byteLength: immutableBuild.manifestBytes.byteLength }
		: immutableBuild.manifest.files[ path ];
	if ( descriptor === undefined ) return { status: 404, reason: 'missing-exact-static-route', resolvedPath: path, query: url.search.slice( 1 ) };
	return {
		status: 200,
		resolvedPath: path,
		query: url.search.slice( 1 ),
		descriptor,
		contentType: MIME_TYPES[ extname( path ).toLowerCase() ] ?? 'application/octet-stream'
	};

}

export async function startImmutablePhysicalServer( options = {} ) {

	const immutableBuild = options.buildDirectory
		? await loadAndValidateImmutableBuild( options.buildDirectory )
		: await buildImmutablePhysicalSurface( { outputRoot: options.outputRoot } );
	const host = options.host ?? '127.0.0.1';
	const port = options.port ?? 4177;
	const ledgerPath = options.ledgerPath ?? join( tmpdir(), `threejs-physical-served-${ process.pid }-${ Date.now() }.ndjson` );
	if ( ledgerPath.startsWith( immutableBuild.directory ) ) throw new Error( 'Served-byte ledger must remain outside the immutable build directory.' );

	const server = createServer( async ( request, response ) => {

		try {

			if ( request.method !== 'GET' && request.method !== 'HEAD' ) {

				response.writeHead( 405, { Allow: 'GET, HEAD' } );
				response.end();
				return;

			}
			const resolved = resolveImmutableRequest( request.url ?? '/', immutableBuild );
			if ( resolved.status !== 200 ) {

				await appendFile( ledgerPath, `${ JSON.stringify( {
					at: new Date().toISOString(),
					method: request.method,
					requestUrl: request.url,
					status: resolved.status,
					resolvedPath: resolved.resolvedPath ?? null,
					query: resolved.query ?? '',
					responseKind: resolved.reason,
					redirected: false,
					fallback: false,
					transformed: false
				} ) }\n` );
				response.writeHead( resolved.status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-ThreeJS-Static-Miss': resolved.reason } );
				response.end( `${ resolved.status } ${ resolved.reason }\n` );
				return;

			}
			const path = join( immutableBuild.directory, resolved.resolvedPath );
			const bytes = resolved.resolvedPath === 'immutable-build-manifest.json' ? immutableBuild.manifestBytes : await readFile( path );
			const actualHash = sha256( bytes );
			if ( actualHash !== resolved.descriptor.sha256 || bytes.byteLength !== resolved.descriptor.byteLength ) throw new Error( `Immutable byte drift for ${ resolved.resolvedPath }.` );
			await appendFile( ledgerPath, `${ JSON.stringify( {
				at: new Date().toISOString(),
				method: request.method,
				requestUrl: request.url,
				status: 200,
				resolvedPath: resolved.resolvedPath,
				query: resolved.query,
				sha256: actualHash,
				byteLength: bytes.byteLength,
				responseKind: 'exact-prebuilt-byte',
				redirected: false,
				fallback: false,
				transformed: false
			} ) }\n` );
			response.writeHead( 200, {
				'Content-Type': resolved.contentType,
				'Content-Length': bytes.byteLength,
				ETag: `"${ actualHash }"`,
				'Cache-Control': 'no-store',
				'X-Content-SHA256': actualHash,
				'X-ThreeJS-Immutable-Build': immutableBuild.manifest.bundleHash,
				'X-Content-Type-Options': 'nosniff'
			} );
			response.end( request.method === 'HEAD' ? undefined : bytes );

		} catch ( error ) {

			response.writeHead( 500, { 'Content-Type': 'text/plain; charset=utf-8' } );
			response.end( `500 immutable-server-error: ${ error.message }\n` );

		}

	} );
	await new Promise( ( resolve, reject ) => {

		server.once( 'error', reject );
		server.listen( port, host, resolve );

	} );
	return { server, host, port, ledgerPath, immutableBuild };

}

function argument( name ) {

	const index = process.argv.indexOf( name );
	return index < 0 ? null : process.argv[ index + 1 ];

}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const result = await startImmutablePhysicalServer( {
		buildDirectory: argument( '--build' ) ?? undefined,
		outputRoot: argument( '--output-root' ) ?? undefined,
		ledgerPath: argument( '--ledger' ) ?? undefined,
		host: argument( '--host' ) ?? undefined,
		port: argument( '--port' ) === null ? undefined : Number( argument( '--port' ) )
	} );
	process.stdout.write( `${ JSON.stringify( {
		url: `http://${ result.host }:${ result.port }/src/in-app-evidence.html`,
		buildDirectory: result.immutableBuild.directory,
		servedByteLedger: result.ledgerPath,
		bundleHash: result.immutableBuild.manifest.bundleHash
	}, null, 2 ) }\n` );

}
