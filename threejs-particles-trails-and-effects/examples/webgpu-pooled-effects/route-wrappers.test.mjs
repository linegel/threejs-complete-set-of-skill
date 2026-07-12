import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NativePooledEffectsLab,
  PARTICLE_SCENARIOS,
  PARTICLE_TIERS,
  POOLED_EFFECTS_LAB_ID,
  resolvePooledEffectsRoute,
} from "./lab.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(here, "lab.manifest.json"), "utf8"));
const targets = JSON.parse(
  await readFile(resolve(here, "../../../labs/canonical-targets.json"), "utf8"),
);
const target = targets.targets.find((entry) => entry.id === manifest.id);
assert(target, `${manifest.id} canonical target exists`);

assert.equal(manifest.status, "incomplete");
assert.deepEqual(manifest.mechanisms.map(({ id }) => id), target.mechanisms);
assert.deepEqual(manifest.tiers.map(({ id }) => id), target.tiers);
assert.deepEqual([...PARTICLE_SCENARIOS], target.mechanisms);
assert.deepEqual([...PARTICLE_TIERS], target.tiers);
const controllerContract = new NativePooledEffectsLab({ canvas: {} });
assert.equal(controllerContract.labId, POOLED_EFFECTS_LAB_ID);
assert.equal(POOLED_EFFECTS_LAB_ID, manifest.id);
const labSource = await readFile(join(here, "lab.mjs"), "utf8");
assert(labSource.includes("labId: POOLED_EFFECTS_LAB_ID"), "pooled-effects metrics identity can drift");
assert(labSource.includes("globalThis.labController = lab"), "canonical controller is not published through labController");
assert(labSource.includes("globalThis.__LAB_CONTROLLER__ = lab"), "canonical controller compatibility alias is missing");
assert(labSource.includes("globalThis.__THREE_LAB__ = lab"), "legacy pooled-effects controller alias is missing");

for (const id of target.mechanisms) {
  const path = join(here, "mechanism", id, "index.html");
  await access(path);
  const html = await readFile(path, "utf8");
  assert(html.includes(`data-locked-scenario="${id}"`), `${id} locks its scenario`);
  assert(html.includes('src="browser.mjs"'), `${id} imports the canonical browser app`);
  assert(html.includes('<base href="../../">'), `${id} resolves from the canonical source root`);
  assert(!html.includes('"/node_modules/'), `${id} uses Pages-safe relative module imports`);
  assert(!html.includes("new WebGPURenderer"), `${id} does not fork renderer ownership`);
}

for (const id of target.tiers) {
  const path = join(here, "tier", id, "index.html");
  await access(path);
  const html = await readFile(path, "utf8");
  assert(html.includes(`data-locked-tier="${id}"`), `${id} locks its tier`);
  assert(html.includes('src="browser.mjs"'), `${id} imports the canonical browser app`);
  assert(!html.includes('"/node_modules/'), `${id} uses Pages-safe relative module imports`);
  assert(!html.includes("new WebGPURenderer"), `${id} does not fork renderer ownership`);
}

assert.deepEqual(
  resolvePooledEffectsRoute({ pathname: "/mechanism/impact-sparks/" }),
  { scenario: "impact-sparks", tier: "high", locked: true },
);
assert.deepEqual(
  resolvePooledEffectsRoute({ pathname: "/tier/ultra/" }),
  { scenario: "reentry-shell-and-wake", tier: "ultra", locked: true },
);
assert.deepEqual(
  resolvePooledEffectsRoute({
    pathname: "/mechanism/debris-dissolve/",
    lockedScenario: "gpu-pool-and-compaction",
    lockedTier: "medium",
  }),
  { scenario: "gpu-pool-and-compaction", tier: "medium", locked: true },
);
assert.throws(
  () => resolvePooledEffectsRoute({ pathname: "/mechanism/not-a-mechanism/" }),
  /Unknown scenario/,
);
assert.throws(
  () => resolvePooledEffectsRoute({ lockedTier: "invented-cheaper-tier" }),
  /Unknown tier/,
);

console.log(`Pooled-effects route wrappers passed (${target.mechanisms.length} mechanisms, ${target.tiers.length} tiers)`);
