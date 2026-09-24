import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureLabBrowser } from '../../../scripts/capture-lab-browser.mjs';
import { finalizeFrostRawEvidence } from './finalize-frost-evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export function parseFrostCaptureOptions(argv = []) {
  const options = { profile: 'correctness', outputDir: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--profile', '--output'].includes(flag) || seen.has(flag)) {
      throw new Error(`Unknown or repeated Frost capture argument: ${flag}`);
    }
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    seen.add(flag);
    if (flag === '--profile') options.profile = value;
    else options.outputDir = resolve(value);
  }
  if (!['correctness', 'performance'].includes(options.profile)) {
    throw new Error(`Unknown Frost capture profile: ${options.profile}`);
  }
  options.outputDir ??= resolve(here, '../../../artifacts/visual-validation/webgpu-touch-history-frost', options.profile);
  return options;
}

export async function runFrostCapture(argv = [], {
  capture = captureLabBrowser,
  finalize = finalizeFrostRawEvidence,
} = {}) {
  const options = parseFrostCaptureOptions(argv);
  const correctness = options.profile === 'correctness';
  const session = await capture({
    labId: 'webgpu-touch-history-frost',
    ...options,
    // Correctness recipes and their finalizer cannot certify performance runs.
    hookPath: correctness ? resolve(here, 'capture-hook.mjs') : null,
    target: 'final',
  });
  if (session.profile !== options.profile) throw new Error('Frost capture returned the wrong profile');
  const validation = correctness ? await finalize(session, options.outputDir) : null;
  return {
    labId: session.labId,
    profile: session.profile,
    outputDir: options.outputDir,
    ...(validation ? {
      protocol: validation.protocol,
      valid: validation.valid,
      claimVerdicts: validation.manifest.claimVerdicts,
      canonicalAcceptanceEligible: validation.canonicalAcceptanceEligible,
    } : { record: 'capture-session', canonicalAcceptanceEligible: false }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runFrostCapture(process.argv.slice(2)), null, 2));
}
