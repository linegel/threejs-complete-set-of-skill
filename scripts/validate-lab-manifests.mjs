#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import {
  REPO_ROOT,
  REGISTRY_PATH,
  buildDemoRegistry,
  listRawLabManifestPaths,
  loadCanonicalTargets,
  readJson,
  registryJson,
} from './lib/lab-registry.mjs';
import { validateRawLabManifest, validateRegistry } from './lib/lab-validation.mjs';

const args = new Set(process.argv.slice(2));
const write = args.has('--write-registry');
const requireComplete = args.has('--require-complete');
const skipRegistryDrift = args.has('--skip-registry-drift');

try {
  loadCanonicalTargets();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const rawErrors = [];
for (const path of listRawLabManifestPaths()) {
  const label = relative(REPO_ROOT, path).split('\\').join('/');
  try {
    const result = validateRawLabManifest(readJson(path));
    rawErrors.push(...result.errors.map((error) => `${label}: ${error}`));
  } catch (error) {
    rawErrors.push(`${label}: invalid JSON: ${error.message}`);
  }
}

if (rawErrors.length > 0) {
  console.error(`raw lab manifest validation failed (${rawErrors.length} errors):`);
  for (const error of rawErrors) console.error(`- ${error}`);
  process.exit(1);
}

const registry = buildDemoRegistry();
const result = validateRegistry(registry, { requireComplete });

if (!result.valid) {
  console.error(`lab registry validation failed (${result.errors.length} errors):`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}

const expected = registryJson(registry);
if (write) writeFileSync(REGISTRY_PATH, expected);
if (!skipRegistryDrift && !write) {
  if (!existsSync(REGISTRY_PATH)) {
    console.error('lab registry validation failed: labs/demo-registry.json is missing; run with --write-registry');
    process.exit(1);
  }
  const checked = readFileSync(REGISTRY_PATH, 'utf8');
  if (checked !== expected) {
    console.error('lab registry validation failed: labs/demo-registry.json is stale; run npm run labs:registry');
    process.exit(1);
  }
}

const status = requireComplete ? 'complete matrix' : 'migration matrix';
console.log(
  `Validated ${status}: ${registry.counts.skills} skills, ${registry.counts.primary} primary targets, `
  + `${registry.counts.acceptedPrimary} accepted primary, ${registry.counts.secondary} secondary.`,
);
