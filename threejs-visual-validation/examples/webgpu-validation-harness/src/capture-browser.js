import { fileURLToPath } from 'node:url';

import { captureLabBrowser } from '../../../../scripts/capture-lab-browser.mjs';
import { resolveValidationBundleDirectory } from './artifact-paths.js';

function option( name, fallback ) {

	const index = process.argv.indexOf( name );
	return index === - 1 ? fallback : process.argv[ index + 1 ];

}

const profile = option( '--profile', 'correctness' );
const outputDir = resolveValidationBundleDirectory( {
	bundle: 'raw',
	profile,
	override: option( '--out', null )
} );
const record = await captureLabBrowser( {
	labId: 'webgpu-validation-harness',
	profile,
	outputDir,
	hookPath: fileURLToPath( new URL( '../capture-hook.mjs', import.meta.url ) ),
	target: 'final'
} );

console.log( JSON.stringify( {
	labId: record.labId,
	profile: record.profile,
	outputDir,
	adapterClass: record.adapterClass,
	hookResult: record.hookResult
}, null, 2 ) );
