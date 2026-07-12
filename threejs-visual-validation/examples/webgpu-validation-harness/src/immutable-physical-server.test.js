import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveImmutableRequest } from './immutable-physical-server.js';

const HASH = `sha256:${ 'a'.repeat( 64 ) }`;
const build = {
	manifest: {
		files: {
			'index.html': { sha256: HASH, byteLength: 100 },
			'assets/app.js': { sha256: HASH, byteLength: 200 }
		}
	},
	manifestFileSha256: HASH,
	manifestBytes: new Uint8Array( 50 )
};

test( 'immutable request resolver serves exact files without redirect or fallback', () => {

	assert.deepEqual( resolveImmutableRequest( '/?lockKind=tier&lockId=target-performance', build ), {
		status: 200,
		resolvedPath: 'index.html',
		query: 'lockKind=tier&lockId=target-performance',
		descriptor: build.manifest.files[ 'index.html' ],
		contentType: 'text/html; charset=utf-8'
	} );
	assert.equal( resolveImmutableRequest( '/assets/app.js', build ).status, 200 );
	const missing = resolveImmutableRequest( '/missing-route', build );
	assert.equal( missing.status, 404 );
	assert.equal( missing.reason, 'missing-exact-static-route' );

} );

test( 'immutable request resolver rejects encoded traversal', () => {

	const result = resolveImmutableRequest( '/assets/%2e%2e/secrets.json', build );
	assert.notEqual( result.status, 200 );
	assert.equal( resolveImmutableRequest( '//other-origin.invalid/index.html', build ).status, 400 );
	assert.equal( resolveImmutableRequest( '/assets/%00app.js', build ).status, 400 );

} );
