import { createHash } from 'node:crypto';

const SHA256 = /^sha256:[a-f0-9]{64}$/;

function fail( message ) {

	throw new Error( message );

}

function requireObject( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) fail( `${ label } must be an object.` );
	return value;

}

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

export function parseLedgerBoundCanonicalJson( input ) {

	const label = input?.label ?? 'JSON evidence';
	const bytes = input?.bytes;
	if ( bytes instanceof Uint8Array === false || bytes.byteLength < 1 ) fail( `${ label } bytes are missing.` );
	const ledger = requireObject( input?.ledgerEntry, `${ label } ledger entry` );
	if ( ledger.path !== input.expectedPath || ledger.status !== ( input.expectedStatus ?? 'captured' ) || ledger.kind !== input.expectedKind ) fail( `${ label } ledger identity is invalid.` );
	if ( ledger.byteLength !== bytes.byteLength || SHA256.test( ledger.sha256 ?? '' ) === false || ledger.sha256 !== sha256( bytes ) ) fail( `${ label } bytes differ from the correctness ledger.` );
	let document;
	try {

		document = JSON.parse( Buffer.from( bytes ).toString( 'utf8' ) );

	} catch ( error ) {

		fail( `${ label } is invalid JSON: ${ error.message }` );

	}
	const canonicalBytes = Buffer.from( `${ JSON.stringify( document, null, 2 ) }\n` );
	if ( canonicalBytes.equals( Buffer.from( bytes ) ) === false ) fail( `${ label } is not canonical two-space JSON.` );
	return { document, sha256: ledger.sha256, byteLength: ledger.byteLength };

}
