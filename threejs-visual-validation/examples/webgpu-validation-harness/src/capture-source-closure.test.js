import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CAPTURE_CLOSURE_ROOTS,
	computeCaptureSourceClosure,
	validateCaptureSourceClosure
} from './capture-source-closure.js';

test( 'capture source closure includes shared runner, schemas, locks, and exact per-file hashes', () => {

	const closure = computeCaptureSourceClosure();
	for ( const required of [
		'labs/runtime/aligned-readback.mjs',
		'labs/schema/evidence-bundle-v2.schema.json',
		'labs/schema/runtime-graph.schema.json',
		'package.json',
		'package-lock.json'
	] ) assert.ok( CAPTURE_CLOSURE_ROOTS.includes( required ) );
	assert.ok( closure.files.some( ( file ) => file.repositoryPath.endsWith( '/src/in-app-evidence-client.js' ) ) );
	assert.ok( closure.files.every( ( file ) => file.repositoryPath !== 'scripts/capture-lab-browser.mjs' ) );
	assert.ok( closure.files.every( ( file ) => /^sha256:[0-9a-f]{64}$/.test( file.sha256 ) && Number.isInteger( file.byteLength ) && file.byteLength > 0 ) );
	assert.match( closure.sourceHash, /^sha256:[0-9a-f]{64}$/ );
	assert.equal( validateCaptureSourceClosure( closure ), true );
	assert.throws( () => validateCaptureSourceClosure( { ...closure, files: closure.files.slice( 1 ) } ), /does not match current/ );

} );
