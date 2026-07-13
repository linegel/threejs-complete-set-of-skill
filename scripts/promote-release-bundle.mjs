import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { promoteReleaseBundle } from './lib/offline-release-promotion.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const candidateDirectory = argument('--candidate');
const reviewPath = argument('--review');
const outputDirectory = argument('--output');
if (!candidateDirectory || !reviewPath || !outputDirectory) {
  throw new Error('usage: node scripts/promote-release-bundle.mjs --candidate <dir> --review <json> --output <dir>');
}
const visualReview = JSON.parse(await readFile(resolve(reviewPath), 'utf8'));
const result = await promoteReleaseBundle({
  candidateDirectory: resolve(candidateDirectory),
  outputDirectory: resolve(outputDirectory),
  visualReview,
});
console.log(JSON.stringify({
  labId: result.manifest.labId,
  outputDirectory: result.outputDirectory,
  status: result.manifest.promotion.status,
  publishable: result.manifest.publishable,
  bindingDigest: result.manifest.promotion.bindingDigest,
  reviewDigest: result.manifest.promotion.visualSignoff.reviewDigest,
}, null, 2));
