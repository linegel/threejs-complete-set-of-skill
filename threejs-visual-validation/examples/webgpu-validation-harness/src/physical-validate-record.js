import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { validateHardwarePerformanceSession, validatePhysicalRouteSession } from './physical-session-validator.js';

export async function validatePhysicalEvidenceRecordFile( path ) {

	if ( typeof path !== 'string' || path.length === 0 ) throw new Error( 'Physical evidence validation requires a record path.' );
	const parsed = JSON.parse( await readFile( path, 'utf8' ) );
	const record = parsed.record ?? parsed;
	if ( record.profile === 'correctness' ) throw new Error( 'Use the shared correctness capture-session validator for Playwright evidence.' );
	if ( record.profile !== 'physical-route' && record.profile !== 'performance' ) throw new Error( `Unsupported physical evidence profile ${ record.profile ?? '<missing>' }.` );
	const validation = record.profile === 'physical-route'
		? validatePhysicalRouteSession( record )
		: validateHardwarePerformanceSession( record );
	return { validation, profile: record.profile, publishable: false, acceptanceStatus: 'incomplete' };

}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const index = process.argv.indexOf( '--record' );
	const result = await validatePhysicalEvidenceRecordFile( index < 0 ? null : process.argv[ index + 1 ] );
	process.stdout.write( `${ JSON.stringify( result, null, 2 ) }\n` );

}
