#!/usr/bin/env node
/**
 * Pure checker: one lab's distributed evidence closure surfaces must agree.
 * No writes. Exit 0 when the lab is either:
 *   - hash-bound incomplete/accepted with consistent published surfaces, or
 *   - honest incomplete with no promoted summary media and no accepted
 *     capability/proof rows without a current-hash capture binding.
 *
 * Usage:
 *   node scripts/assert-evidence-closure.mjs --lab webgpu-node-gtao
 *   node scripts/assert-evidence-closure.mjs --lab webgpu-node-gtao --json
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { REPO_ROOT, buildDemoRegistry } from './lib/lab-registry.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function firstHash(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.startsWith('sha256:')) return value;
  }
  return null;
}

function reportHit(docsManifest, labId) {
  if (!docsManifest) return null;
  for (const key of ['labs', 'reports', 'items', 'entries', 'demos']) {
    const collection = docsManifest[key];
    if (Array.isArray(collection)) {
      const hit = collection.find((entry) => (entry.id || entry.labId) === labId);
      if (hit) return hit;
    } else if (collection && typeof collection === 'object' && collection[labId]) {
      return collection[labId];
    }
  }
  return null;
}

function captureBinding(labId) {
  const correctness = join(REPO_ROOT, 'artifacts', 'visual-validation', labId, 'correctness');
  const session = readJson(join(correctness, 'capture-session.json'));
  const evidence = readJson(join(correctness, 'evidence-manifest.json'));
  const hash = firstHash(
    session?.sourceHash,
    session?.sourceClosureHash,
    evidence?.sourceClosureHash,
    evidence?.sourceHash,
  );
  return {
    correctnessDir: correctness,
    hasCorrectnessDir: existsSync(correctness),
    hasCaptureSession: Boolean(session),
    hasEvidenceManifest: Boolean(evidence),
    hash,
    session,
    evidence,
  };
}

export function assertEvidenceClosure(labId, { registry = null } = {}) {
  const errors = [];
  const warnings = [];
  const liveRegistry = registry ?? buildDemoRegistry();
  const live = liveRegistry.demos.find((demo) => demo.id === labId);
  if (!live) {
    return {
      ok: false,
      labId,
      errors: [`lab ${labId} not found in live buildDemoRegistry()`],
      warnings: [],
      snapshot: null,
    };
  }

  const manifestPath = join(REPO_ROOT, ...(Array.isArray(live.canonicalSource)
    ? [live.canonicalSource[0], 'lab.manifest.json']
    : []));
  // Prefer the path from registry origins / known example root via browserEntry parent.
  const browserEntry = live.browserEntry;
  const labDir = browserEntry ? join(REPO_ROOT, dirname(browserEntry)) : null;
  const labManifestPath = labDir ? join(labDir, 'lab.manifest.json') : manifestPath;
  const labManifest = readJson(labManifestPath);
  if (!labManifest) {
    errors.push(`missing lab.manifest.json at ${labManifestPath}`);
  }

  const frozenRegistry = readJson(join(REPO_ROOT, 'labs', 'demo-registry.json'));
  const frozen = (frozenRegistry?.demos || []).find((demo) => demo.id === labId) || null;

  const summary = readJson(join(REPO_ROOT, 'docs', 'visual-validation', labId, 'evidence-summary.json'));
  const docsEvidenceManifest = readJson(join(REPO_ROOT, 'docs', 'evidence', 'manifest.json'));
  const docsHit = reportHit(docsEvidenceManifest, labId);
  const sourceManifest = readJson(join(REPO_ROOT, 'docs', 'demos', labId, 'source-manifest.json'));
  const binding = captureBinding(labId);

  const liveHash = firstHash(live.sourceHash, live.sourceClosureHash);
  const labHash = firstHash(labManifest?.sourceHash, labManifest?.sourceClosureHash);
  const frozenHash = firstHash(frozen?.sourceHash, frozen?.sourceClosureHash);
  const summaryHash = firstHash(summary?.canonicalSourceHash, summary?.sourceHash);
  const docsHash = firstHash(docsHit?.sourceHash, docsHit?.canonicalSourceHash);
  const publishedHash = firstHash(sourceManifest?.sourceHash);
  const captureHash = binding.hash;

  const labStatus = labManifest?.status ?? null;
  const liveStatus = live.status ?? null;
  const frozenStatus = frozen?.status ?? null;
  const summaryStatus = summary?.acceptanceStatus ?? summary?.status ?? null;
  const docsStatus = docsHit?.status ?? null;
  const publishedStatus = sourceManifest?.status ?? null;

  const promotedFromSummary = Array.isArray(summary?.images) ? summary.images.length : 0;
  const diskPngs = (() => {
    const dir = join(REPO_ROOT, 'docs', 'visual-validation', labId);
    if (!existsSync(dir)) return 0;
    // avoid importing fs readdir for simplicity: count from summary only as promoted truth
    return promotedFromSummary;
  })();

  const caps = labManifest?.capabilityRequirements || [];
  const proofs = labManifest?.runtimeProof || [];
  const acceptedCaps = caps.filter((row) => row.required && row.status === 'accepted');
  const acceptedProofs = proofs.filter((row) => row.required && row.status === 'accepted');
  const incompleteRequiredCaps = caps.filter((row) => row.required && row.status !== 'accepted');
  const incompleteRequiredProofs = proofs.filter((row) => row.required && row.status !== 'accepted');

  const fabricated = [...caps, ...proofs].filter((row) => {
    const evidence = String(row.evidence || '');
    return /Accepted .+ release covers/i.test(evidence);
  });
  if (fabricated.length > 0) {
    errors.push(
      `fabricated evidence text on: ${fabricated.map((row) => row.id).join(', ')}`,
    );
  }

  // Status consistency across source + published surfaces
  const statusSet = new Set(
    [labStatus, liveStatus, frozenStatus, summaryStatus, docsStatus, publishedStatus]
      .filter((value) => typeof value === 'string' && value.length > 0),
  );
  if (statusSet.size > 1) {
    errors.push(
      `status drift across surfaces: lab=${labStatus} live=${liveStatus} frozen=${frozenStatus} ` +
      `summary=${summaryStatus} docs=${docsStatus} publishedSource=${publishedStatus}`,
    );
  }

  // Hash consistency when any hash is present for a hash-bound promote path
  const hashSet = new Set(
    [liveHash, labHash, frozenHash, summaryHash, docsHash, publishedHash, captureHash]
      .filter(Boolean),
  );
  if (hashSet.size > 1) {
    errors.push(
      `sourceHash drift: live=${liveHash} lab=${labHash} frozen=${frozenHash} ` +
      `summary=${summaryHash} docs=${docsHash} published=${publishedHash} capture=${captureHash}`,
    );
  }

  // Acceptance gate honesty: accepted only if every required row accepted
  if (labStatus === 'accepted') {
    if (incompleteRequiredCaps.length > 0 || incompleteRequiredProofs.length > 0) {
      errors.push(
        `status=accepted but incomplete required rows: ` +
        `caps=[${incompleteRequiredCaps.map((row) => row.id).join(',')}] ` +
        `proofs=[${incompleteRequiredProofs.map((row) => row.id).join(',')}]`,
      );
    }
    for (const group of ['scenarios', 'mechanisms', 'tiers']) {
      const bad = (labManifest?.[group] || []).filter(
        (row) => (row.acceptanceStatus || row.status) !== 'accepted',
      );
      if (bad.length > 0) {
        errors.push(
          `status=accepted but ${group} not all accepted: ${bad.map((row) => row.id).join(',')}`,
        );
      }
    }
  }

  // Accepted proof/cap rows require capture binding to current hash
  if (acceptedCaps.length + acceptedProofs.length > 0) {
    if (!captureHash) {
      errors.push('accepted capability/proof rows present without capture hash binding');
    } else if (labHash && captureHash !== labHash) {
      errors.push(`accepted rows require lab sourceHash === capture hash (${labHash} vs ${captureHash})`);
    } else if (summaryHash && captureHash !== summaryHash) {
      errors.push(`accepted rows require summary hash === capture hash (${summaryHash} vs ${captureHash})`);
    }
  }

  // Honest incomplete blocked labs: no promoted summary media without binding
  if (labStatus === 'incomplete' && promotedFromSummary > 0) {
    if (!captureHash || (labHash && captureHash !== labHash)) {
      errors.push(
        `incomplete lab has ${promotedFromSummary} promoted summary images without current-hash capture binding`,
      );
    }
  }

  // GPU timestamp honesty: cannot be accepted with INSUFFICIENT evidence text
  for (const row of proofs) {
    if (row.status === 'accepted' && /INSUFFICIENT_EVIDENCE/i.test(String(row.evidence || ''))) {
      errors.push(`proof ${row.id} is accepted while evidence states INSUFFICIENT_EVIDENCE`);
    }
  }

  const snapshot = {
    labId,
    labStatus,
    liveStatus,
    frozenStatus,
    summaryStatus,
    docsStatus,
    publishedStatus,
    liveHash,
    labHash,
    frozenHash,
    summaryHash,
    docsHash,
    publishedHash,
    captureHash,
    promotedImageCount: promotedFromSummary,
    acceptedRequiredCapabilities: acceptedCaps.map((row) => row.id),
    acceptedRequiredProofs: acceptedProofs.map((row) => row.id),
    incompleteRequiredCapabilities: incompleteRequiredCaps.map((row) => row.id),
    incompleteRequiredProofs: incompleteRequiredProofs.map((row) => row.id),
    hashBound: Boolean(
      captureHash
      && labHash
      && captureHash === labHash
      && (!summaryHash || summaryHash === labHash)
      && (!docsHash || docsHash === labHash)
      && (!frozenHash || frozenHash === labHash)
      && (!publishedHash || publishedHash === labHash)
      && (!liveHash || liveHash === labHash),
    ),
    statusConsistent: statusSet.size <= 1,
    captureOutcome: captureHash
      ? (labHash && captureHash === labHash ? 'captured-validated-current-hash' : 'hash-unbound')
      : (promotedFromSummary === 0 ? 'no-capture-honest-incomplete' : 'media-without-capture'),
  };

  return {
    ok: errors.length === 0,
    labId,
    errors,
    warnings,
    snapshot,
  };
}

function main() {
  const labId = option('--lab');
  if (!labId) {
    console.error('usage: node scripts/assert-evidence-closure.mjs --lab <labId> [--json]');
    process.exit(2);
  }
  const result = assertEvidenceClosure(labId);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`assert-evidence-closure ${labId}: ${result.ok ? 'PASS' : 'FAIL'}`);
    if (result.snapshot) {
      console.log(JSON.stringify(result.snapshot, null, 2));
    }
    for (const error of result.errors) console.error(`- ${error}`);
    for (const warning of result.warnings) console.warn(`! ${warning}`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
