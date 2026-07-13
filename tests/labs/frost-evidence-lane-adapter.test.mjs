import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('Frost lane adapter validates both inputs and rereads its hash-bound output', () => {
  const source = readFileSync(resolve('scripts/join-frost-evidence-lanes.mjs'), 'utf8');
  for (const token of [
    'validateEvidenceBundle(correctnessDirectory)',
    "rawValidation.protocol !== 'unified-v2'",
    'createEvidenceLaneJoin({ rawManifest: rawValidation.manifest, physicalReview })',
    'validateEvidenceLaneJoin(reread)',
    'joinSha256 !== canonicalSha256(body)',
    'publishable: result.join.publishable',
  ]) assert(source.includes(token), `Frost lane adapter omits ${token}`);
  assert(!source.includes('claimVerdicts.visualCorrectness ='), 'Frost adapter must not mutate verdicts outside the shared join');
});
