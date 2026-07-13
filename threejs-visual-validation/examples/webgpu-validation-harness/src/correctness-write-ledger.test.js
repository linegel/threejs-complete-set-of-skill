import assert from 'node:assert/strict';
import test from 'node:test';

import { createCorrectnessCaptureSessionFixture } from './correctness-capture-session.fixture.js';
import {
	CORRECTNESS_SESSION_PATH,
	createCorrectnessWriteLedger,
	validateCorrectnessWriteLedgerBytes
} from './correctness-write-ledger.js';

const DOCUMENT_BINDING = Object.freeze( {
	kind: 'capture-session-document',
	path: CORRECTNESS_SESSION_PATH,
	sha256: `sha256:${ 'a'.repeat( 64 ) }`,
	byteLength: 1234
} );

test( 'correctness write ledger replaces exactly one session row with its finalized byte binding', () => {

	const session = createCorrectnessCaptureSessionFixture();
	const result = createCorrectnessWriteLedger( session, DOCUMENT_BINDING );
	const row = result.value.entries.find( ( entry ) => entry.path === CORRECTNESS_SESSION_PATH );
	assert.deepEqual( row, {
		sequence: session.artifactWrites.find( ( entry ) => entry.path === CORRECTNESS_SESSION_PATH ).sequence,
		path: CORRECTNESS_SESSION_PATH,
		kind: 'capture-session-record',
		contentBinding: 'finalized-file-hash-for-offline-promotion',
		sha256: DOCUMENT_BINDING.sha256,
		byteLength: DOCUMENT_BINDING.byteLength
	} );
	const verified = validateCorrectnessWriteLedgerBytes( session, DOCUMENT_BINDING, result.bytes );
	assert.equal( verified.byteLength, result.bytes.byteLength );
	assert.match( verified.sha256, /^sha256:[0-9a-f]{64}$/ );

} );

test( 'correctness write ledger rejects byte drift and detached session bindings', () => {

	const session = createCorrectnessCaptureSessionFixture();
	const expected = createCorrectnessWriteLedger( session, DOCUMENT_BINDING );
	assert.throws( () => validateCorrectnessWriteLedgerBytes( session, DOCUMENT_BINDING, Buffer.concat( [ expected.bytes, Buffer.from( '\n' ) ] ) ), /bytes differ/ );
	assert.throws( () => createCorrectnessWriteLedger( session, { ...DOCUMENT_BINDING, sha256: 'sha256:short' } ), /SHA-256/ );
	assert.throws( () => createCorrectnessWriteLedger( session, { ...DOCUMENT_BINDING, byteLength: 0 } ), /positive byte length/ );
	const missing = structuredClone( session );
	missing.artifactWrites = missing.artifactWrites.filter( ( entry ) => entry.path !== CORRECTNESS_SESSION_PATH );
	assert.throws( () => createCorrectnessWriteLedger( missing, DOCUMENT_BINDING ), /capture-session\.json|capture-session row/ );
	const duplicate = structuredClone( session );
	duplicate.artifactWrites.push( structuredClone( duplicate.artifactWrites.find( ( entry ) => entry.path === CORRECTNESS_SESSION_PATH ) ) );
	assert.throws( () => createCorrectnessWriteLedger( duplicate, DOCUMENT_BINDING ), /capture-session\.json|capture-session row/ );

} );
