import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEvidenceLaneJoin, validateEvidenceLaneJoin } from './lib/evidence-lane-join.mjs';
import { canonicalSha256 } from './lib/evidence-manifest-contract.mjs';
import { validateEvidenceBundle } from './lib/evidence-v2.mjs';

const LAB_ID = 'webgpu-touch-history-frost';

export async function joinFrostEvidenceLanes({ correctnessDirectory, physicalReviewPath, outputPath }) {
  const rawValidation = validateEvidenceBundle(correctnessDirectory);
  if (rawValidation.valid !== true || rawValidation.protocol !== 'unified-v2') {
    throw new AggregateError(rawValidation.errors.map((error) => new Error(error)), 'Frost correctness bundle is invalid');
  }
  if (rawValidation.manifest.labId !== LAB_ID) throw new Error('correctness bundle belongs to another lab');
  const physicalReview = JSON.parse(await readFile(physicalReviewPath, 'utf8'));
  const join = createEvidenceLaneJoin({ rawManifest: rawValidation.manifest, physicalReview });
  await writeFile(outputPath, `${JSON.stringify(join, null, 2)}\n`);
  const reread = JSON.parse(await readFile(outputPath, 'utf8'));
  validateEvidenceLaneJoin(reread);
  const { joinSha256, ...body } = reread;
  if (joinSha256 !== canonicalSha256(body)) throw new Error('written Frost evidence lane join hash drifted');
  return Object.freeze({ outputPath, join: reread });
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const correctnessDirectory = resolve(argument('--correctness') ?? resolve(root, `artifacts/visual-validation/${LAB_ID}/correctness`));
  const physicalReviewPath = resolve(argument('--physical') ?? resolve(root, `artifacts/visual-validation/${LAB_ID}/physical-route/physical-review-record.json`));
  const outputPath = resolve(argument('--output') ?? resolve(root, `artifacts/visual-validation/${LAB_ID}/lane-join.json`));
  const result = await joinFrostEvidenceLanes({ correctnessDirectory, physicalReviewPath, outputPath });
  console.log(JSON.stringify({
    labId: result.join.labId,
    outputPath: result.outputPath,
    status: result.join.status,
    laneCount: result.join.performanceClaims ? 3 : 2,
    claimVerdicts: result.join.claimVerdicts,
    joinSha256: result.join.joinSha256,
    publishable: result.join.publishable,
  }, null, 2));
}
