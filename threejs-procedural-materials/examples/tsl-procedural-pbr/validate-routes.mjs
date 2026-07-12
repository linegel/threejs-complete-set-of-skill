import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createStrictLabController } from "../../../labs/runtime/strict-lab-controller.mjs";
import { lockedRouteSelectionMatches } from "../../../scripts/lib/page-routes.mjs";
import { MATERIAL_CAMERAS, MATERIAL_MODES, MATERIAL_SCENARIOS } from "./main.js";
import { outputPlan } from "./capture-hook.mjs";
import { assertLockedRouteMutation, resolveLockedRoute } from "./route-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const targets = JSON.parse(readFileSync(resolve(repoRoot, "labs/canonical-targets.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(here, "lab.manifest.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(resolve(here, "package.json"), "utf8"));
const target = targets.targets.find((entry) => entry.id === manifest.id);
assert(target, `canonical target missing for ${manifest.id}`);
assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.status, "incomplete");
assert.deepEqual(manifest.mechanisms.map(({ id }) => id), target.mechanisms);
assert.deepEqual(manifest.tiers.map(({ id }) => id), target.tiers);
assert.deepEqual(manifest.scenarios.map(({ id }) => id), MATERIAL_SCENARIOS);
assert.deepEqual(manifest.modes, MATERIAL_MODES);
assert.deepEqual(manifest.cameras, MATERIAL_CAMERAS);
assert.equal(outputPlan.length, 10, "capture hook must classify every normative standard output");
assert(outputPlan.every((entry) => entry.status === "CAPTURED" && entry.filename === `${entry.id}.png`));

for (const [kind, ids] of [["mechanism", target.mechanisms], ["tier", target.tiers]]) {
  for (const id of ids) {
    const path = resolve(here, kind, id, "index.html");
    assert(existsSync(path), `missing physical ${kind} route ${id}`);
    const html = readFileSync(path, "utf8");
    assert(html.includes(`data-route-kind="${kind}"`), `${kind}/${id} does not lock route kind`);
    assert(html.includes(`data-route-id="${id}"`), `${kind}/${id} does not lock route id`);
    assert(html.includes("route-entry.mjs"), `${kind}/${id} does not import the canonical route entry`);
    assert(Object.isFrozen(resolveLockedRoute(manifest, kind, id)));
    assert.equal(assertLockedRouteMutation({ kind, id }, kind, id), id);
    const conflictingId = ids.find((candidate) => candidate !== id);
    if (conflictingId) {
      assert.throws(
        () => assertLockedRouteMutation({ kind, id }, kind, conflictingId),
        /Locked/,
        `${kind}/${id} did not reject a conflicting post-ready selection`,
      );
    }
    const metrics = kind === "mechanism"
      ? { scenario: id, mechanism: id, routeSelection: { scenario: id, mechanism: id } }
      : { tier: id, activeTier: id, routeSelection: { tier: id } };
    const startup = (kind === "mechanism" ? manifest.mechanisms : manifest.tiers)
      .find((entry) => entry.id === id).startup;
    assert(lockedRouteSelectionMatches(metrics, kind, id, startup), `${kind}/${id} cannot be acknowledged by Pages`);
  }
}

for (const [kind, id] of [["mechanism", "unknown"], ["tier", "unknown"], ["unknown", "unknown"]]) {
  assert.throws(() => resolveLockedRoute(manifest, kind, id), /Unknown/);
}

for (const script of [
  "check", "validate:unit", "test:mutations", "capture",
  "validate:artifacts", "validate:quick", "validate:full",
]) {
  assert.equal(typeof packageJson.scripts[script], "string", `missing standard package script ${script}`);
}

const calls = [];
const implementation = Object.fromEntries([
  "ready", "setScenario", "setMode", "setTier", "setSeed", "setCamera", "setTime",
  "step", "resetHistory", "resize", "renderOnce", "capturePixels", "describePipeline",
  "describeResources", "getMetrics", "dispose",
].map((name) => [name, (...args) => {
  calls.push([name, ...args]);
  return name === "capturePixels"
    ? { width: 1, height: 1, bytesPerPixel: 4, bytesPerRow: 256, pixels: new Uint8Array(4) }
    : undefined;
}]));
const controller = createStrictLabController(manifest, implementation);
await controller.ready();
controller.setScenario(MATERIAL_SCENARIOS[0]);
controller.setMode(MATERIAL_MODES[0]);
controller.setTier("mobile");
controller.setSeed(1);
controller.setCamera("design");
controller.setTime(0);
controller.step(1 / 60);
controller.resetHistory("route-test");
controller.resize(641, 359, 2);
controller.renderOnce();
await controller.capturePixels("final");
controller.describePipeline();
controller.describeResources();
controller.getMetrics();
await controller.dispose();
assert.equal(calls.length, 16, "strict controller did not delegate the full LabController surface");
for (const [method, value] of [
  ["setScenario", "unknown"],
  ["setMode", "unknown"],
  ["setTier", "unknown"],
  ["setSeed", 2],
  ["setCamera", "unknown"],
]) assert.throws(() => controller[method](value), /unknown/i, `${method} silently accepted an unknown value`);

console.log(`Validated ${target.mechanisms.length} material mechanisms and ${target.tiers.length} material tiers.`);
