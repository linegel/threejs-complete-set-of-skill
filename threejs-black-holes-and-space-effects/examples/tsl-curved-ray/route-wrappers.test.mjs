import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SPACE_LAB_TIERS,
  resolveSpaceIntegratorRoute,
} from "./space-lab.mjs";
import { SPACE_INTEGRATOR_MODES } from "./space-transfer-stage.js";

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
assert.deepEqual([...SPACE_INTEGRATOR_MODES], target.mechanisms);
assert.deepEqual([...SPACE_LAB_TIERS], target.tiers);

for (const id of target.mechanisms) {
  const path = join(here, "mechanism", id, "index.html");
  await access(path);
  const html = await readFile(path, "utf8");
  assert(html.includes(`data-locked-scenario="${id}"`), `${id} locks its scenario`);
  assert(html.includes('src="space-browser.mjs"'), `${id} imports the canonical browser app`);
  assert(html.includes('<base href="../../">'), `${id} resolves from the canonical source root`);
  assert(!html.includes('"/node_modules/'), `${id} uses Pages-safe relative module imports`);
  assert(!html.includes("new WebGPURenderer"), `${id} does not fork renderer ownership`);
}

for (const id of target.tiers) {
  const path = join(here, "tier", id, "index.html");
  await access(path);
  const html = await readFile(path, "utf8");
  assert(html.includes(`data-locked-tier="${id}"`), `${id} locks its tier`);
  assert(html.includes('src="space-browser.mjs"'), `${id} imports the canonical browser app`);
  assert(!html.includes('"/node_modules/'), `${id} uses Pages-safe relative module imports`);
  assert(!html.includes("new WebGPURenderer"), `${id} does not fork renderer ownership`);
}

assert.deepEqual(
  resolveSpaceIntegratorRoute({ pathname: "/mechanism/schwarzschild-lensing/" }),
  { scenario: "schwarzschild-lensing", quality: "standard", locked: true },
);
assert.deepEqual(
  resolveSpaceIntegratorRoute({ pathname: "/tier/hero/" }),
  { scenario: "accretion-disk", quality: "hero", locked: true },
);
assert.deepEqual(
  resolveSpaceIntegratorRoute({
    pathname: "/mechanism/accretion-disk/",
    lockedScenario: "temporal-reconstruction",
    lockedTier: "background",
  }),
  { scenario: "temporal-reconstruction", quality: "background", locked: true },
);
assert.throws(
  () => resolveSpaceIntegratorRoute({ pathname: "/mechanism/kerr-not-in-scope/" }),
  /Unknown scenario/,
);
assert.throws(
  () => resolveSpaceIntegratorRoute({ lockedTier: "fabricated-mobile" }),
  /Unknown tier/,
);

console.log(`Space-integrator route wrappers passed (${target.mechanisms.length} mechanisms, ${target.tiers.length} tiers)`);
