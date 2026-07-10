#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, buildDemoRegistry } from './lib/lab-registry.mjs';

const registry = buildDemoRegistry();
const errors = [];
let pendingMissing = 0;
for (const demo of registry.demos) {
  if (!['accepted', 'incomplete', 'blocked'].includes(demo.status)) continue;
  for (const source of demo.canonicalSource) {
    if (!existsSync(join(REPO_ROOT, source))) {
      if (demo.status === 'accepted') errors.push(`${demo.id}: missing canonical source ${source}`);
      else pendingMissing += 1;
    }
  }
  if (demo.status === 'accepted' && (!demo.browserEntry || !existsSync(join(REPO_ROOT, demo.browserEntry)))) {
    errors.push(`${demo.id}: accepted browser entry is missing`);
  }
}

if (errors.length > 0) {
  console.error(`lab source check failed (${errors.length} errors):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Checked canonical sources for ${registry.counts.primary} primary targets; ${pendingMissing} pending source path(s) remain explicitly incomplete.`);
