#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRIMARY_DEMO_KINDS,
  REPO_ROOT,
  buildDemoRegistry,
  computeManifestSourceHash,
  registryJson,
} from './lib/lab-registry.mjs';
import { computePublishedBundleHash, publishedHashInputs } from './lib/published-pages.mjs';

const registry = buildDemoRegistry();
const errors = [];
const publishedRegistryPath = join(REPO_ROOT, 'docs', 'demos', 'registry.json');
if (!existsSync(publishedRegistryPath)) errors.push('missing docs/demos/registry.json');
else if (readFileSync(publishedRegistryPath, 'utf8') !== registryJson(registry)) {
  errors.push('published demo registry drift');
}
const publishedIndexPath = join(REPO_ROOT, 'docs', 'demos', 'index.json');
let publishedIndex = null;
if (!existsSync(publishedIndexPath)) errors.push('missing docs/demos/index.json');
else {
  try {
    publishedIndex = JSON.parse(readFileSync(publishedIndexPath, 'utf8'));
  } catch (error) {
    errors.push(`docs/demos/index.json is invalid JSON: ${error.message}`);
  }
}
const indexedRoutes = [
  ...(publishedIndex?.routes ?? []),
  ...(publishedIndex?.pendingRoutes ?? []),
  ...(publishedIndex?.secondaryRoutes ?? []),
];
if (new Set(indexedRoutes.map((route) => route.id)).size !== indexedRoutes.length) {
  errors.push('docs/demos/index.json contains duplicate route ids');
}
for (const lab of registry.demos) {
  const primaryAccepted = PRIMARY_DEMO_KINDS.includes(lab.kind) && lab.status === 'accepted';
  const primaryPending = PRIMARY_DEMO_KINDS.includes(lab.kind) && ['incomplete', 'blocked'].includes(lab.status);
  const classifiedSecondary = ['proxy-demo', 'generated-asset-demo'].includes(lab.kind) && lab.status === 'secondary';
  if (!primaryAccepted && !primaryPending && !classifiedSecondary) continue;
  const path = join(REPO_ROOT, 'docs', 'demos', lab.id, 'source-manifest.json');
  if (!existsSync(path)) {
    errors.push(`${lab.id}: missing published source-manifest.json`);
    continue;
  }
  const published = JSON.parse(readFileSync(path, 'utf8'));
  if (published.labId !== lab.id || published.kind !== lab.kind || published.status !== lab.status) {
    errors.push(`${lab.id}: published classification metadata drift`);
  }
  if (published.browserEntry !== lab.browserEntry
      || JSON.stringify(published.canonicalSource) !== JSON.stringify(lab.canonicalSource)) {
    errors.push(`${lab.id}: published canonical-source metadata drift`);
  }
  const indexPath = join(REPO_ROOT, 'docs', 'demos', lab.id, 'index.html');
  if (!existsSync(indexPath)) errors.push(`${lab.id}: missing published index.html`);
  else if (/https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|esm\.sh)\//i.test(readFileSync(indexPath, 'utf8'))) {
    errors.push(`${lab.id}: published entry contains a CDN dependency`);
  }
  const current = computeManifestSourceHash(lab);
  if (published.sourceHash !== current) errors.push(`${lab.id}: published source hash drift`);
  if (JSON.stringify(published.sourceHashInputs) !== JSON.stringify(lab.sourceHashInputs)) {
    errors.push(`${lab.id}: published source-hash input ledger drift`);
  }
  const currentPublishedInputs = publishedHashInputs(REPO_ROOT, lab.id);
  if (JSON.stringify(published.publishedHashInputs) !== JSON.stringify(currentPublishedInputs)) {
    errors.push(`${lab.id}: published-output input ledger drift`);
  }
  const currentPublishedHash = computePublishedBundleHash(REPO_ROOT, currentPublishedInputs);
  if (published.publishedBundleHash !== currentPublishedHash) {
    errors.push(`${lab.id}: published HTML/JS/CSS/asset digest drift`);
  }
  const indexed = indexedRoutes.find((route) => route.id === lab.id);
  if (!indexed) errors.push(`${lab.id}: missing from docs/demos/index.json`);
  else {
    if (indexed.path !== lab.publishPath) errors.push(`${lab.id}: published index path drift`);
    if (indexed.sourceHash !== lab.sourceHash) errors.push(`${lab.id}: published index source hash drift`);
    if (indexed.publishedBundleHash !== currentPublishedHash) errors.push(`${lab.id}: published index bundle hash drift`);
  }
  if (published.threeRevision !== '0.185.1') errors.push(`${lab.id}: published Three revision drift`);
  if (published.buildRevision !== registry.buildRevision) errors.push(`${lab.id}: published build revision drift`);
}

if (errors.length > 0) {
  console.error(`Pages source-hash validation failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('Published canonical lab source hashes match the current registry.');
