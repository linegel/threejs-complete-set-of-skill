import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assembleValidationHarnessReleaseCandidate } from '../threejs-visual-validation/examples/webgpu-validation-harness/src/release-bundle-input.js';

const ARGUMENTS = Object.freeze( [ '--correctness', '--physical', '--performance', '--output' ] );

function fail( message ) {
  throw new Error( message );
}

export function parseValidationHarnessReleaseCli(argv, cwd = process.cwd()) {
  if (!Array.isArray(argv)) throw new TypeError('validation-harness release arguments must be an array');
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!ARGUMENTS.includes(name)) fail(`unknown validation-harness release argument ${name ?? '<missing>'}`);
    if (values.has(name)) fail(`duplicate validation-harness release argument ${name}`);
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) fail(`validation-harness release argument ${name} requires a path`);
    values.set(name, resolve(cwd, value));
  }
  const missing = ARGUMENTS.filter((name) => !values.has(name));
  if (missing.length > 0) fail(`validation-harness release assembly requires ${missing.join(', ')}`);
  if (values.get('--physical') === values.get('--performance')) fail('physical-route and performance wrapper paths must be distinct');
  return Object.freeze({
    correctnessDirectory: values.get('--correctness'),
    physicalWrapperPath: values.get('--physical'),
    performanceWrapperPath: values.get('--performance'),
    outputDirectory: values.get('--output'),
  });
}

export async function runValidationHarnessReleaseCli(argv, cwd = process.cwd()) {
  const input = parseValidationHarnessReleaseCli(argv, cwd);
  const result = await assembleValidationHarnessReleaseCandidate(input);
  return Object.freeze({
    labId: result.manifest.labId,
    outputDirectory: result.outputDirectory,
    bundleKind: result.manifest.bundleKind,
    publishable: result.manifest.publishable,
    promotionStatus: result.manifest.promotion.status,
    routeCount: result.manifest.routeSet.length,
    captureProfiles: result.manifest.captureSessions.map((session) => session.profile),
    claimVerdicts: structuredClone(result.manifest.claimVerdicts),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = await runValidationHarnessReleaseCli(process.argv.slice(2));
  console.log(JSON.stringify(summary, null, 2));
}
