import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PLANET_TIER_IDS,
  enforcePlanetRouteLocks,
  resolvePlanetRoute,
} from "./route-contract.js";
import { assertPlanetDpr } from "./planet-tiers.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, "lab.manifest.json"), "utf8"));
const canonicalSource = readFileSync(resolve(here, "browser-lab.js"), "utf8");
assert(canonicalSource.includes("window.labController = labControllerPromise"));
assert(canonicalSource.includes("window.__LAB_CONTROLLER__ = labControllerPromise"));

function assertWrapper(relativePath, lockName, lockValue) {
  const html = readFileSync(resolve(here, relativePath, "index.html"), "utf8");
  const expectedBase = "../".repeat(relativePath.split("/").length);
  assert(html.includes(`<base href="${expectedBase}">`));
  assert(html.includes('src="browser-lab.js"'), `${relativePath} must import canonical browser-lab.js`);
  assert(html.includes(`data-locked-${lockName}="${lockValue}"`), `${relativePath} missing startup lock`);
}

for (const mechanism of manifest.mechanisms) {
  const state = resolvePlanetRoute(`http://127.0.0.1${mechanism.route}`);
  assert.equal(state.scenario, mechanism.id);
  assertWrapper(`mechanism/${mechanism.id}`, "scenario", mechanism.id);
  assert(manifest.modes.includes(mechanism.startup.mode), `${mechanism.id} must lock a public mode`);
  if (mechanism.startup.camera) {
    assert(manifest.cameras.includes(mechanism.startup.camera), `${mechanism.id} uses unknown camera`);
  }
}
for (const tier of PLANET_TIER_IDS) {
  const state = resolvePlanetRoute(`http://127.0.0.1/demos/${manifest.id}/tier/${tier}/`);
  assert.equal(state.tier, tier);
  assert.equal(resolvePlanetRoute(`http://127.0.0.1/?tier=${encodeURIComponent(tier)}`).tier, tier);
  assertWrapper(`tier/${tier}`, "tier", tier);
}
for (const scenario of manifest.scenarios) {
  assert.equal(resolvePlanetRoute(`http://127.0.0.1${scenario.route}`).scenario, scenario.id);
}

assert.throws(() => resolvePlanetRoute("http://127.0.0.1/demos/webgpu-quadtree-planet/mechanism/not-real/"), /unknown planet scenario/);
assert.throws(() => resolvePlanetRoute("http://127.0.0.1/demos/webgpu-quadtree-planet/tier/not-real/"), /unknown planet tier/);
assert.throws(() => resolvePlanetRoute("http://127.0.0.1/demos/webgpu-quadtree-planet/?scenario=not-real"), /unknown planet scenario/);
assert.deepEqual(
  enforcePlanetRouteLocks(
    resolvePlanetRoute("http://127.0.0.1/demos/webgpu-quadtree-planet/tier/full/"),
    { lockedTier: "full" },
  ),
  {
    scenario: "solid-body-material",
    tier: "full",
    lockedScenario: null,
    lockedTier: "full",
  },
);
assert.throws(() => enforcePlanetRouteLocks(
  resolvePlanetRoute("http://127.0.0.1/demos/webgpu-quadtree-planet/tier/full/?tier=balanced"),
  { lockedTier: "full" },
), /conflicts with locked tier/);
for (const tier of manifest.tiers) {
  const dprCap = tier.resolutionPolicy.dprCap.value;
  assert.equal(assertPlanetDpr(tier.id, dprCap), dprCap);
  assert.throws(() => assertPlanetDpr(tier.id, dprCap + 0.01), /exceeds locked/);
}

if (process.argv.includes("--mutations")) {
  const mutations = [
    () => resolvePlanetRoute("http://127.0.0.1/demos/webgpu-quadtree-planet/?tier=webgl"),
    () => resolvePlanetRoute("http://127.0.0.1/demos/webgpu-quadtree-planet/mechanism/automatic-fallback/"),
    () => enforcePlanetRouteLocks(
      resolvePlanetRoute("http://127.0.0.1/demos/webgpu-quadtree-planet/?scenario=solid-body-material"),
      { lockedScenario: "gas-and-ice-giants" },
    ),
    () => assertPlanetDpr("reduced-webgpu", 2),
  ];
  for (const mutation of mutations) assert.throws(mutation);
}

console.log(JSON.stringify({ pass: true, mechanisms: manifest.mechanisms.length, tiers: PLANET_TIER_IDS.length, canonicalModule: "browser-lab.js" }));
