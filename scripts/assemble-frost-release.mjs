import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { numericDatum, NumericLabel } from '../labs/runtime/numeric-evidence.mjs';
import { assemblePendingReleaseBundle } from './lib/release-bundle-assembler.mjs';

const LAB_ID = 'webgpu-touch-history-frost';

function physicalRoute() {
  return {
    path: `/demos/${LAB_ID}/mechanism/refraction-and-fresnel/`,
    scenario: 'touch-history-frost',
    mechanism: 'refraction-and-fresnel',
    mode: 'final',
    tier: 'balanced',
    camera: 'design',
    seed: '0x00000001',
    timeSeconds: numericDatum(0, 'seconds', NumericLabel.AUTHORED, 'fixed refraction route startup state'),
  };
}

function releaseLimitations() {
  return [
    {
      id: 'hardware-performance-not-claimed',
      status: 'ACTIVE',
      statement: 'The correctness and physical-route lanes do not claim named-hardware GPU timing or presentation cadence.',
      affectedClaims: ['performanceCompliance', 'gpuAttribution'],
    },
    {
      id: 'opaque-renderer-residency-not-claimed',
      status: 'ACTIVE',
      statement: 'Exact Three.js renderer-internal pipeline and cache byte residency is unavailable; lifecycle PASS covers lab-owned resources and observed renderer state only.',
      affectedClaims: ['lifecycleStability'],
    },
  ];
}

export function assembleFrostReleaseCandidate({
  correctnessDirectory,
  physicalReviewPath,
  servedLedgerPath,
  laneJoinPath,
  outputDirectory,
}) {
  return assemblePendingReleaseBundle({
    correctnessDirectory,
    physicalReviewPath,
    servedLedgerPath,
    laneJoinPath,
    outputDirectory,
    physicalRoute: physicalRoute(),
    limitations: releaseLimitations(),
  });
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const artifactRoot = resolve(root, `artifacts/visual-validation/${LAB_ID}`);
  const result = await assembleFrostReleaseCandidate({
    correctnessDirectory: resolve(argument('--correctness') ?? resolve(artifactRoot, 'correctness')),
    physicalReviewPath: resolve(argument('--physical') ?? resolve(artifactRoot, 'physical-route/physical-review-record.json')),
    servedLedgerPath: resolve(argument('--served-ledger') ?? resolve(artifactRoot, 'physical-route/served-byte-ledger.json')),
    laneJoinPath: resolve(argument('--lane-join') ?? resolve(artifactRoot, 'lane-join.json')),
    outputDirectory: resolve(argument('--output') ?? resolve(artifactRoot, 'release-candidate')),
  });
  console.log(JSON.stringify({
    labId: result.manifest.labId,
    outputDirectory: result.outputDirectory,
    bundleKind: result.manifest.bundleKind,
    publishable: result.manifest.publishable,
    promotionStatus: result.manifest.promotion.status,
    routes: result.manifest.routeSet.map((route) => route.path),
    claimVerdicts: result.manifest.claimVerdicts,
  }, null, 2));
}
