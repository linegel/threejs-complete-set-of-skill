import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ASH_TIER_IDS, resolveAshRoute } from "./route-contract.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(here, "lab.manifest.json"), "utf8"));
const canonicalSource = readFileSync(resolve(here, "browser-lab.js"), "utf8");
assert(canonicalSource.includes("window.labController = labControllerPromise"));
assert(canonicalSource.includes("window.__LAB_CONTROLLER__ = labControllerPromise"));
assert(canonicalSource.includes("createStrictLabController"));
assert(canonicalSource.includes("bytesPerPixel: 4"));
assert(canonicalSource.includes("viewport.actualDpr = Math.min"));

function assertWrapper(relativePath, lockName, lockValue) {
  const html = readFileSync(resolve(here, relativePath, "index.html"), "utf8");
  const expectedBase = "../".repeat(relativePath.split("/").length);
  assert(html.includes(`<base href="${expectedBase}">`));
  assert(html.includes('src="browser-lab.js"'), `${relativePath} must import canonical browser-lab.js`);
  assert(html.includes(`data-locked-${lockName}="${lockValue}"`), `${relativePath} missing startup lock`);
}

for (const mechanism of manifest.mechanisms) {
  const state = resolveAshRoute(`http://127.0.0.1${mechanism.route}`);
  assert.equal(state.scenario, mechanism.id);
  assertWrapper(`mechanism/${mechanism.id}`, "scenario", mechanism.id);
  assert(manifest.modes.includes(mechanism.startup.mode), `${mechanism.id} must lock a public mode`);
}
for (const tier of ASH_TIER_IDS) {
  const state = resolveAshRoute(`http://127.0.0.1/demos/${manifest.id}/tier/${tier}/`);
  assert.equal(state.tier, tier);
  assert.equal(resolveAshRoute(`http://127.0.0.1/?tier=${encodeURIComponent(tier)}`).tier, tier);
  assertWrapper(`tier/${tier}`, "tier", tier);
}
for (const scenario of manifest.scenarios) {
  assert.equal(resolveAshRoute(`http://127.0.0.1${scenario.route}`).scenario, scenario.id);
}

assert.throws(() => resolveAshRoute("http://127.0.0.1/demos/structured-ash-growth/mechanism/not-real/"), /unknown Ash scenario/);
assert.throws(() => resolveAshRoute("http://127.0.0.1/demos/structured-ash-growth/tier/not-real/"), /unknown Ash tier/);
assert.throws(() => resolveAshRoute("http://127.0.0.1/demos/structured-ash-growth/?scenario=not-real"), /unknown Ash scenario/);

if (process.argv.includes("--mutations")) {
  for (const mutation of [
    () => resolveAshRoute("http://127.0.0.1/demos/structured-ash-growth/?tier=renamed-full"),
    () => resolveAshRoute("http://127.0.0.1/demos/structured-ash-growth/mechanism/fake-impostor/"),
  ]) assert.throws(mutation);
}

console.log(JSON.stringify({ pass: true, mechanisms: manifest.mechanisms.length, tiers: ASH_TIER_IDS.length, canonicalModule: "browser-lab.js" }));
