import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureLabBrowser } from '../../../scripts/capture-lab-browser.mjs';
import { finalizeFrostRawEvidence } from './finalize-frost-evidence.mjs';

const here = dirname( fileURLToPath( import.meta.url ) );
const outputDir = resolve( here, '../../../artifacts/visual-validation/webgpu-touch-history-frost/correctness' );
const session = await captureLabBrowser( {
	labId: 'webgpu-touch-history-frost',
	profile: 'correctness',
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
