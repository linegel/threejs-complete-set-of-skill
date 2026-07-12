import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT } from '../../../../scripts/lib/lab-registry.mjs';
import { loadAndValidateImmutableBuild } from './immutable-physical-build.js';
import { physicalLaneReference } from './physical-lane-join.js';
import {
	hashPhysicalRecord,
	validateHardwarePerformanceSession,
	validatePhysicalRouteSession
} from './physical-session-validator.js';

function isWithin( path, parent ) {

	const rel = relative( parent, path );
	return rel === '' || ( rel.startsWith( '..' ) === false && isAbsolute( rel ) === false );

}

function parseLedger( source ) {

	return source.split( /\r?\n/ ).filter( Boolean ).map( ( line, index ) => {

		try {

			return JSON.parse( line );

		} catch ( error ) {

			throw new Error( `Served-byte ledger line ${ index + 1 } is invalid JSON: ${ error.message }` );

		}

	} );

}

function sessionEntries( entries, session ) {

	const start = Date.parse( session.servedLedgerStartedAt ?? session.startedAt );
	const finish = Date.parse( session.finishedAt );
	if ( Number.isFinite( start ) === false || Number.isFinite( finish ) === false || finish < start ) throw new Error( 'Session has no valid served-ledger time interval.' );
	return entries.filter( ( entry ) => {

		const timestamp = Date.parse( entry.at );
		return Number.isFinite( timestamp ) && timestamp >= start && timestamp <= finish;

	} );

}

export async function importInAppEvidenceRecord( { recordPath, ledgerPath, buildDirectory } ) {

	if ( ! recordPath || ! ledgerPath || ! buildDirectory ) throw new Error( 'Physical evidence import requires recordPath, ledgerPath, and buildDirectory.' );
	const record = JSON.parse( await readFile( recordPath, 'utf8' ) );
	if ( record.profile === 'correctness' ) throw new Error( 'Correctness records come from the shared Playwright capture runner, not the Codex in-app Browser importer.' );
	if ( record.profile !== 'physical-route' && record.profile !== 'performance' ) throw new Error( `Unsupported in-app evidence profile ${ record.profile ?? '<missing>' }.` );
	const immutableBuild = await loadAndValidateImmutableBuild( buildDirectory );
	if ( JSON.stringify( record.immutableBuild ) !== JSON.stringify( immutableBuild.manifest ) ) throw new Error( 'Session immutable-build identity differs from the exact build directory.' );
	const ledgerSource = await readFile( ledgerPath, 'utf8' );
	const entries = sessionEntries( parseLedger( ledgerSource ), record );
	if ( entries.length === 0 ) throw new Error( 'No served-byte ledger entries fall inside the physical session interval.' );
	const served = entries.map( ( entry ) => ( {
		status: entry.status,
		resolvedPath: entry.resolvedPath,
		query: entry.query ?? '',
		sha256: entry.sha256 ?? null,
		byteLength: entry.byteLength ?? null,
		responseKind: entry.responseKind,
		redirected: entry.redirected,
		fallback: entry.fallback,
		transformed: entry.transformed
	} ) );
	const imported = {
		...record,
		serving: {
			status: 'FINALIZED_EXACT_STATIC_BYTES',
			ledgerSha256: hashPhysicalRecord( served ),
			buildManifestFileSha256: immutableBuild.manifestFileSha256,
			entries: served
		},
		publishable: false,
		acceptanceStatus: 'incomplete'
	};
	const validation = imported.profile === 'physical-route'
		? validatePhysicalRouteSession( imported )
		: validateHardwarePerformanceSession( imported );
	const recordSha256 = hashPhysicalRecord( imported );
	return { record: imported, validation, recordSha256, laneReference: physicalLaneReference( imported, recordSha256 ) };

}

function argument( name ) {

	const index = process.argv.indexOf( name );
	return index < 0 ? null : process.argv[ index + 1 ];

}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const outputPath = argument( '--out' );
	if ( outputPath !== null && isWithin( resolve( outputPath ), REPO_ROOT ) ) throw new Error( 'Physical session import output must remain outside the repository until separate promotion review.' );
	const result = await importInAppEvidenceRecord( {
		recordPath: argument( '--record' ),
		ledgerPath: argument( '--ledger' ),
		buildDirectory: argument( '--build' )
	} );
	const serialized = `${ JSON.stringify( result, null, 2 ) }\n`;
	if ( outputPath === null ) process.stdout.write( serialized );
	else await writeFile( outputPath, serialized, { flag: 'wx' } );

}
