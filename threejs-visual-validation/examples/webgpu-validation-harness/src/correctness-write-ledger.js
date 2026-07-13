import { createHash } from 'node:crypto';

import { validateCorrectnessCaptureSession } from './physical-session-validator.js';

export const CORRECTNESS_SESSION_PATH = 'capture-session.json';
export const CORRECTNESS_WRITE_LEDGER_PATH = 'capture-write-ledger.json';

function fail( message ) {

	throw new Error( message );

}

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

function jsonBytes( value ) {

	return Buffer.from( `${ JSON.stringify( value, null, 2 ) }\n` );

}

function jsonSafe( value ) {

	return JSON.parse( JSON.stringify( value ) );

}

function requireDocumentBinding( binding ) {

	if ( binding?.kind !== 'capture-session-document' || binding.path !== CORRECTNESS_SESSION_PATH ) fail( 'Correctness write ledger requires the exact capture-session document binding.' );
	if ( /^sha256:[0-9a-f]{64}$/.test( binding.sha256 ?? '' ) === false ) fail( 'Correctness capture-session document binding requires a SHA-256 digest.' );
	if ( Number.isSafeInteger( binding.byteLength ) === false || binding.byteLength <= 0 ) fail( 'Correctness capture-session document binding requires a positive byte length.' );
	return binding;

}

function sourceClosureHash( session ) {

	const value = session.sourceClosureHash ?? session.sourceHash;
	if ( /^sha256:[0-9a-f]{64}$/.test( value ?? '' ) === false ) fail( 'Correctness write ledger requires the capture source-closure hash.' );
	return value;

}

export function createCorrectnessWriteLedger( session, documentBinding ) {

	validateCorrectnessCaptureSession( session );
	const document = requireDocumentBinding( documentBinding );
	const sourceHash = sourceClosureHash( session );
	const sessionRows = session.artifactWrites.filter( ( entry ) => entry.path === CORRECTNESS_SESSION_PATH );
	if ( sessionRows.length !== 1 ) fail( 'Correctness capture artifact writes must contain exactly one capture-session row.' );
	const entries = session.artifactWrites.map( ( entry ) => entry.path === CORRECTNESS_SESSION_PATH ? {
		sequence: entry.sequence,
		path: CORRECTNESS_SESSION_PATH,
		kind: 'capture-session-record',
		contentBinding: 'finalized-file-hash-for-offline-promotion',
		sha256: document.sha256,
		byteLength: document.byteLength
	} : jsonSafe( entry ) );
	const sessionId = `${ session.labId }:correctness:${ sourceHash.slice( 'sha256:'.length, 'sha256:'.length + 16 ) }`;
	const value = {
		schemaVersion: 2,
		labId: session.labId,
		sessionId,
		profile: session.profile,
		sourceClosureHash: sourceHash,
		buildRevision: session.buildRevision,
		entries
	};
	return Object.freeze( {
		sessionId,
		value: Object.freeze( value ),
		bytes: jsonBytes( value )
	} );

}

export function validateCorrectnessWriteLedgerBytes( session, documentBinding, input ) {

	if ( ! ( input instanceof Uint8Array ) ) fail( 'Correctness write-ledger bytes must be a Uint8Array.' );
	const expected = createCorrectnessWriteLedger( session, documentBinding );
	const actual = Buffer.from( input );
	if ( actual.equals( expected.bytes ) === false ) fail( 'Correctness write-ledger bytes differ from the validated capture session and exact document binding.' );
	return Object.freeze( {
		...expected,
		sha256: sha256( actual ),
		byteLength: actual.byteLength
	} );

}
