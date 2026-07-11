import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureLabBrowser } from '../../../scripts/capture-lab-browser.mjs';

function option( name, fallback = null ) {
	const index = process.argv.indexOf( name );
	return index >= 0 ? process.argv[ index + 1 ] : fallback;
}

const output = option( '--output' );
const record = await captureLabBrowser( {
	labId: 'webgpu-fft-ocean',
	profile: option( '--profile', 'correctness' ),
	outputDir: output ? resolve( output ) : null,
	target: option( '--target', 'final' ),
	hookPath: fileURLToPath( new URL( './capture-hook.mjs', import.meta.url ) )
} );

console.log( JSON.stringify( {
	labId: record.labId,
	profile: record.profile,
	status: record.hookResult?.status,
	captures: record.hookResult?.captures
}, null, 2 ) );
