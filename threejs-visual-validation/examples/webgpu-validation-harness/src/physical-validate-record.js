import { fileURLToPath } from 'node:url';

import { loadVerifiedImportedPhysicalRecord } from './verified-physical-record.js';

export async function validatePhysicalEvidenceRecordFile( path ) {

	if ( typeof path !== 'string' || path.length === 0 ) throw new Error( 'Physical evidence validation requires a record path.' );
	const verified = await loadVerifiedImportedPhysicalRecord( path );
	return {
		validation: verified.validation,
		profile: verified.record.profile,
		recordSha256: verified.recordSha256,
		sourceDocumentSha256: verified.sourceDocumentSha256,
		sourceDocumentByteLength: verified.sourceDocumentByteLength,
		publishable: false,
		acceptanceStatus: 'incomplete'
	};

}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const index = process.argv.indexOf( '--record' );
	const result = await validatePhysicalEvidenceRecordFile( index < 0 ? null : process.argv[ index + 1 ] );
	process.stdout.write( `${ JSON.stringify( result, null, 2 ) }\n` );

}
