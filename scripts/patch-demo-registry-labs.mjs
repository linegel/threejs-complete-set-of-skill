#!/usr/bin/env node
/**
 * Surgical refresh of frozen labs/demo-registry.json entries for selected lab IDs
 * from live buildDemoRegistry(). Does not rewrite unrelated demos.
 *
 * Usage:
 *   node scripts/patch-demo-registry-labs.mjs --lab webgpu-node-gtao --lab webgpu-pooled-effects
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildDemoRegistry, REPO_ROOT, REGISTRY_PATH, registryJson } from './lib/lab-registry.mjs';

function labsFromArgv() {
  const out = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--lab') {
      const id = process.argv[i + 1];
      if (!id || id.startsWith('--')) throw new Error('--lab requires an id');
      out.push(id);
    }
  }
  return out;
}

const labIds = labsFromArgv();
if (labIds.length === 0) {
  console.error('usage: node scripts/patch-demo-registry-labs.mjs --lab <id> [...]');
  process.exit(2);
}

const live = buildDemoRegistry();
const byId = new Map(live.demos.map((demo) => [demo.id, demo]));
for (const id of labIds) {
  if (!byId.has(id)) throw new Error(`live registry missing lab ${id}`);
}

if (!existsSync(REGISTRY_PATH)) {
  throw new Error(`missing frozen registry at ${REGISTRY_PATH}`);
}

const frozen = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
if (!Array.isArray(frozen.demos)) throw new Error('frozen registry.demos must be an array');

const requested = new Set(labIds);
let replaced = 0;
frozen.demos = frozen.demos.map((demo) => {
  if (!requested.has(demo.id)) return demo;
  replaced += 1;
  // Preserve frozen entry shape but refresh identity/hash/status/proof fields from live.
  return byId.get(demo.id);
});

// If a requested lab was missing from frozen, append it.
for (const id of labIds) {
  if (!frozen.demos.some((demo) => demo.id === id)) {
    frozen.demos.push(byId.get(id));
    replaced += 1;
  }
}

// Keep frozen top-level buildRevision aligned with live when present.
if (live.buildRevision) frozen.buildRevision = live.buildRevision;
if (live.threeRevision) frozen.threeRevision = live.threeRevision;

writeFileSync(REGISTRY_PATH, `${JSON.stringify(frozen, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  path: REGISTRY_PATH,
  replaced,
  labIds,
  hashes: Object.fromEntries(labIds.map((id) => [id, byId.get(id).sourceHash])),
  statuses: Object.fromEntries(labIds.map((id) => [id, byId.get(id).status])),
}, null, 2));

// Also refresh published docs/demos/registry.json from the same live registry so
// pages:validate-source-hashes does not see published demo registry drift for these labs.
const publishedPath = join(REPO_ROOT, 'docs', 'demos', 'registry.json');
writeFileSync(publishedPath, registryJson(live));
console.log(JSON.stringify({ ok: true, publishedRegistry: publishedPath }, null, 2));
