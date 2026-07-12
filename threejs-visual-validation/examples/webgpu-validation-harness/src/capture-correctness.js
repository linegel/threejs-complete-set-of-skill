import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureLabBrowser } from '../../../../scripts/capture-lab-browser.mjs';
import { canonicalRawBundleDirectory } from './artifact-paths.js';
import { finalizeRawCorrectnessCapture } from './raw-capture-manifest.js';
import { getRouteLock } from './route-locks.js';

const CAPTURE_HOOK = fileURLToPath( new URL( '../capture-hook.mjs', import.meta.url ) );
const CORRECTNESS_BROWSER_ENTRY = 'threejs-visual-validation/examples/webgpu-validation-harness/tier/webgpu-correctness/index.html';

function optionValue( argv, name ) {

	const index = argv.indexOf( name );
	return index === -1 ? null : argv[ index + 1 ];

}

export function parseCorrectnessCaptureArgs( argv ) {

	const allowed = new Set( [ '--profile', '--output', '--target' ] );
	for ( let index = 0; index < argv.length; index += 2 ) {

		const option = argv[ index ];
		if ( allowed.has( option ) === false ) throw new Error( `Unknown validation-harness capture option ${ option }.` );
		if ( argv[ index + 1 ] === undefined || argv[ index + 1 ].startsWith( '--' ) ) throw new Error( `${ option } requires a value.` );

	}
	const profile = optionValue( argv, '--profile' ) ?? 'correctness';
	if ( profile !== 'correctness' ) throw new Error( 'Hardware performance capture must use the immutable Codex in-app Browser lane; the shared Playwright wrapper accepts only --profile correctness.' );
	return {
		profile,
		outputDir: resolve( optionValue( argv, '--output' ) ?? canonicalRawBundleDirectory( profile ) ),
		target: optionValue( argv, '--target' ) ?? 'presentation'
	};

}

export async function captureCorrectness( options ) {

	const session = await captureLabBrowser( correctnessCaptureRequest( options ) );
	const evidence = await finalizeRawCorrectnessCapture( session, options.outputDir );
	return { session, evidence };

}

export function correctnessCaptureRequest( options ) {

	const startup = getRouteLock( 'tier', 'webgpu-correctness' ).startup;
	const captureState = Object.fromEntries( [ 'scenario', 'mode', 'tier', 'camera', 'seed', 'timeSeconds' ].map( ( key ) => [ key, startup[ key ] ] ) );
	return {
		labId: 'webgpu-validation-harness',
		profile: options.profile,
		outputDir: options.outputDir,
		hookPath: CAPTURE_HOOK,
		target: options.target,
		browserEntryOverride: CORRECTNESS_BROWSER_ENTRY,
		captureState
	};

}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const result = await captureCorrectness( parseCorrectnessCaptureArgs( process.argv.slice( 2 ) ) );
	process.stdout.write( `${ JSON.stringify( {
		labId: result.session.labId,
		profile: result.session.profile,
		bundleKind: result.evidence.bundleKind,
		publishable: result.evidence.publishable,
		claimVerdicts: result.evidence.claimVerdicts
	}, null, 2 ) }\n` );

}
