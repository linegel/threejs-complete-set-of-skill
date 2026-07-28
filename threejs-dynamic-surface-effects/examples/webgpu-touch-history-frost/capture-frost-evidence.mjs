import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureLabBrowser } from '../../../scripts/capture-lab-browser.mjs';
import { finalizeFrostRawEvidence } from './finalize-frost-evidence.mjs';

const here = dirname( fileURLToPath( import.meta.url ) );
const profileIndex = process.argv.indexOf( '--profile' );
if ( profileIndex >= 0 && !process.argv[ profileIndex + 1 ] ) throw new Error( '--profile requires correctness or performance' );
const profile = profileIndex < 0 ? 'correctness' : process.argv[ profileIndex + 1 ];
const outputDir = resolve( here, `../../../artifacts/visual-validation/webgpu-touch-history-frost/${profile}` );
const session = await captureLabBrowser( {
	labId: 'webgpu-touch-history-frost',
	profile,
	outputDir,
	hookPath: resolve( here, 'capture-hook.mjs' ),
	target: 'final'
} );
const validation = await finalizeFrostRawEvidence( session, outputDir );
console.log( JSON.stringify( {
	labId: session.labId,
	profile: session.profile,
	protocol: validation.protocol,
	valid: validation.valid,
	claimVerdicts: validation.manifest.claimVerdicts,
	canonicalAcceptanceEligible: validation.canonicalAcceptanceEligible
}, null, 2 ) );
