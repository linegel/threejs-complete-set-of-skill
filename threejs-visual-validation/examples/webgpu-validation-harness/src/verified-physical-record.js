import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { physicalLaneReference } from './physical-lane-join.js';
import { stableStringify } from './physical-evidence-common.js';
import {
	hashPhysicalRecord,
	validateHardwarePerformanceSession,
	validatePhysicalRouteSession
} from './physical-session-validator.js';

function sha256( bytes ) {

	return `sha256:${ createHash( 'sha256' ).update( bytes ).digest( 'hex' ) }`;

}

function requireObject( value, label ) {

	if ( value === null || typeof value !== 'object' || Array.isArray( value ) ) throw new Error( `${ label } must be an object.` );
	return value;

}

export function finalizeImportedPhysicalRecord( record ) {

	requireObject( record, 'Finalized physical evidence record' );
	if ( record.profile !== 'physical-route' && record.profile !== 'performance' ) throw new Error( `Unsupported finalized physical evidence profile ${ record.profile ?? '<missing>' }.` );
	if ( record.publishable !== false || record.acceptanceStatus !== 'incomplete' ) throw new Error( 'Finalized physical evidence must remain nonpublishable and incomplete before the offline join.' );
	const validation = record.profile === 'physical-route'
		? validatePhysicalRouteSession( record )
		: validateHardwarePerformanceSession( record );
	const recordSha256 = hashPhysicalRecord( record );
	return {
		record,
		validation,
		recordSha256,
		laneReference: physicalLaneReference( record, recordSha256 )
	};

}

export async function loadVerifiedImportedPhysicalRecord( path, options = {} ) {

	if ( typeof path !== 'string' || path.length === 0 || isAbsolute( path ) === false ) throw new Error( 'Finalized physical evidence requires an absolute record path.' );
	const sourceBytes = await readFile( path );
	let wrapper;
	try {

		wrapper = JSON.parse( sourceBytes.toString( 'utf8' ) );

	} catch ( error ) {

		throw new Error( `Finalized physical evidence wrapper is invalid JSON: ${ error.message }` );

	}
	requireObject( wrapper, 'Finalized physical evidence wrapper' );
	for ( const key of [ 'record', 'validation', 'recordSha256', 'laneReference' ] ) if ( Object.hasOwn( wrapper, key ) === false ) throw new Error( `Finalized physical evidence wrapper omits ${ key }.` );
	const record = requireObject( wrapper.record, 'Finalized physical evidence record' );
	const expectedProfile = options.expectedProfile ?? null;
	if ( record.profile !== 'physical-route' && record.profile !== 'performance' ) throw new Error( `Unsupported finalized physical evidence profile ${ record.profile ?? '<missing>' }.` );
	if ( expectedProfile !== null && record.profile !== expectedProfile ) throw new Error( `Expected profile ${ expectedProfile }, received ${ record.profile }.` );
	const finalized = finalizeImportedPhysicalRecord( record );
	const { validation, recordSha256, laneReference } = finalized;
	if ( stableStringify( wrapper.validation ) !== stableStringify( validation ) ) throw new Error( 'Imported validation summary no longer matches fresh physical-record validation.' );
	if ( wrapper.recordSha256 !== recordSha256 ) throw new Error( 'Imported recordSha256 no longer binds the physical record.' );
	if ( stableStringify( wrapper.laneReference ) !== stableStringify( laneReference ) ) throw new Error( 'Imported laneReference no longer binds the physical record.' );
	const servedLedgerBytes = Buffer.from( stableStringify( record.serving.entries ) );
	const servedLedgerSha256 = sha256( servedLedgerBytes );
	if ( record.serving.ledgerSha256 !== servedLedgerSha256 ) throw new Error( 'Imported served-byte ledger hash no longer binds its exact entry population.' );
	return {
		path,
		sourceBytes,
		sourceDocumentSha256: sha256( sourceBytes ),
		sourceDocumentByteLength: sourceBytes.byteLength,
		record,
		validation,
		recordSha256,
		laneReference,
		servedLedgerBytes,
		servedLedgerSha256,
		servedLedgerByteLength: servedLedgerBytes.byteLength
	};

}
