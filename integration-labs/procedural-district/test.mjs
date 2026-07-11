import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CPU_FIELD_ALGORITHM,
  TSL_FIELD_ALGORITHM,
  sampleFieldCPU,
} from "../../threejs-procedural-fields/examples/webgpu-field-bake/field-bundle.mjs";
import {
  DISTRICT_CAMERAS,
  DISTRICT_FIELD_COORDINATE_CONTRACT,
  DISTRICT_MECHANISMS,
  DISTRICT_MODES,
  DISTRICT_SCENARIOS,
  DISTRICT_SEEDS,
  DISTRICT_TIERS,
  createDistrictRuntimeGraph,
  createDistrictValidationSnapshot,
  validateDistrictSnapshot,
} from "./district-contract.js";
import { DISTRICT_MATERIAL_ADAPTER_CONTRACT } from "./district-materials.js";
import { inferDistrictPaddedLayout } from "./main.js";
import { resolveDistrictRoute } from "./routes.js";
import {
  DISTRICT_CAUSE_FIELD_ID,
  sampleDistrictCauseCPU,
  worldToFieldCoordinate,
  worldToFieldUv,
} from "./shared-cause-field.js";
import { createDistrictTerrainGeometry } from "./terrain-geometry.js";
import { validateDistrictRuntimeGraph, validateProceduralDistrict } from "./validate.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(await readFile(join(here, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(here, "lab.manifest.json"), "utf8"));
const captureHookSource = await readFile(join(here, "capture-hook.mjs"), "utf8");
const standardScripts = ["check", "validate:unit", "test:mutations", "capture", "validate:artifacts", "validate:quick", "validate:full"];

await validateProceduralDistrict();
assert.deepEqual(standardScripts.filter((id) => typeof packageJson.scripts[id] !== "string"), []);
assert.deepEqual(manifest.scenarios.map((entry) => entry.id), DISTRICT_SCENARIOS);
assert.deepEqual(manifest.mechanisms.map((entry) => entry.id), DISTRICT_MECHANISMS);
assert.deepEqual(manifest.tiers.map((entry) => entry.id), Object.keys(DISTRICT_TIERS));
assert.deepEqual(manifest.modes, DISTRICT_MODES);
assert.deepEqual(manifest.cameras, DISTRICT_CAMERAS);
assert.deepEqual(manifest.seeds, DISTRICT_SEEDS);

for (const mechanism of DISTRICT_MECHANISMS) {
  const path = join(here, "mechanism", mechanism, "index.html");
  await access(path);
  const source = await readFile(path, "utf8");
  assert.match(source, /src="\.\.\/\.\.\/browser\.js"/);
  assert.match(source, new RegExp(`locked-mechanism" content="${mechanism}"`));
}
for (const tier of Object.keys(DISTRICT_TIERS)) {
  const path = join(here, "tier", tier, "index.html");
  await access(path);
  const source = await readFile(path, "utf8");
  assert.match(source, new RegExp(`locked-tier" content="${tier}"`));
  assert.match(source, /src="\.\.\/\.\.\/browser\.js"/);
}
for (const mode of DISTRICT_MODES) {
  await access(join(here, "mode", mode, "index.html"));
}

assert.deepEqual(resolveDistrictRoute("/demos/procedural-district/", "?mode=ao&tier=hero&camera=street&seed=2654435769&time=2"), {
  scenario: "district", tier: "hero", mode: "ao", camera: "street", seed: 2654435769, time: 2, mechanism: null,
  routeLocks: { tier: "hero", mode: "ao" },
});
assert.equal(resolveDistrictRoute("/demos/procedural-district/mechanism/material-slot-weather/").mode, "weather-state");
assert.deepEqual(resolveDistrictRoute("/demos/procedural-district/", "?mechanism=material-slot-weather").routeLocks, {
  mode: "weather-state", mechanism: "material-slot-weather",
});
assert.equal(resolveDistrictRoute("/demos/procedural-district/tier/budgeted/").tier, "budgeted");
assert.deepEqual(resolveDistrictRoute("/demos/procedural-district/tier/budgeted/").routeLocks, { tier: "budgeted" });
assert.equal(resolveDistrictRoute("/demos/procedural-district/mode/owner-graph/").mode, "owner-graph");
assert.throws(() => resolveDistrictRoute("/demos/procedural-district/mode/not-real/"), /Unknown district mode/);
assert.throws(() => resolveDistrictRoute("/demos/procedural-district/tier/not-real/"), /Unknown district tier/);
assert.throws(() => resolveDistrictRoute("/demos/procedural-district/mechanism/"), /missing an id/);
assert.throws(() => resolveDistrictRoute("/", "?seed=2"), /Unknown district seed/);
assert.throws(() => resolveDistrictRoute("/", "?mechanism=not-real"), /Unknown district mechanism/);

for (const image of ["final.design.png", "no-post.design.png", "diagnostics.mosaic.png", "camera.near.png", "camera.design.png", "camera.far.png"]) {
  assert.ok(captureHookSource.includes(image), `capture hook must declare ${image}`);
}

assert.deepEqual(inferDistrictPaddedLayout(4864 * 799 + 4800, 1200, 800), {
  bytesPerTexel: 4, rowBytes: 4800, bytesPerRow: 4864,
});
assert.deepEqual(inferDistrictPaddedLayout(2816 * 358 + 2564, 641, 359), {
  bytesPerTexel: 4, rowBytes: 2564, bytesPerRow: 2816,
});
assert.throws(() => inferDistrictPaddedLayout(123, 641, 359), /Cannot infer an integer WebGPU row stride/);

assert.equal(CPU_FIELD_ALGORITHM, TSL_FIELD_ALGORITHM);
const baseline = sampleDistrictCauseCPU(-22, 55, 1);
const repeat = sampleDistrictCauseCPU(-22, 55, 1);
const stress = sampleDistrictCauseCPU(-22, 55, 0x9e3779b9);
assert.deepEqual(baseline, repeat);
assert.notDeepEqual(baseline.packedChannels, stress.packedChannels);
assert.deepEqual(worldToFieldCoordinate(-22, 55), [-2.75, 6.875]);
assert.deepEqual(worldToFieldUv(-96, -96), [0, 0]);
assert.deepEqual(worldToFieldUv(96, 96), [1, 1]);
assert.deepEqual(baseline, sampleFieldCPU({
  domain: "world",
  coordinate: [-2.75, DISTRICT_FIELD_COORDINATE_CONTRACT.fieldDomain.y, 6.875],
  seed: 1,
}));
assert.equal(DISTRICT_MATERIAL_ADAPTER_CONTRACT.canonicalHostStage, false);
assert.equal(DISTRICT_MATERIAL_ADAPTER_CONTRACT.acceptanceStatus, "incomplete");

const cpuCause = {
  id: DISTRICT_CAUSE_FIELD_ID,
  sampleCPU(x, z) { return sampleDistrictCauseCPU(x, z, 1); },
};
const terrain = createDistrictTerrainGeometry({ causeField: cpuCause, segments: 8 });
assert.equal(terrain.userData.writer.exactCapacity, true);
assert.equal(terrain.userData.writer.vertexCount, 81);
assert.equal(terrain.userData.writer.indexCount, 384);
assert.equal(terrain.groups.length, 1);
assert.equal(terrain.userData.causeFieldId, DISTRICT_CAUSE_FIELD_ID);
terrain.dispose();

const finalGraph = createDistrictRuntimeGraph({ mode: "final", tier: "balanced" });
validateDistrictRuntimeGraph(finalGraph);
assert.equal(finalGraph.sceneSubmissions.filter((entry) => entry.reachable !== false && ["prepass", "lit-scene"].includes(entry.kind)).length, 2);
const noPostGraph = createDistrictRuntimeGraph({ mode: "no-post", tier: "balanced" });
assert.equal(noPostGraph.sceneSubmissions.filter((entry) => entry.reachable !== false && ["prepass", "lit-scene"].includes(entry.kind)).length, 1);
assert.equal(noPostGraph.sceneSubmissions.find((entry) => entry.id === "district-gbuffer-prepass").kind, "lit-scene");

const snapshot = createDistrictValidationSnapshot({
  facadeOwnershipKeys: ["building-a|front|0:1"],
  fieldIdentity: DISTRICT_CAUSE_FIELD_ID,
  geometryBuildCount: 1,
  geometryDigest: "fnv32:1234abcd",
});
assert.equal(validateDistrictSnapshot(snapshot).ok, true);

console.log("procedural-district unit contracts: passed");
