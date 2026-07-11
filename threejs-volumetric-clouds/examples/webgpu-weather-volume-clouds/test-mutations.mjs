import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDefaultCloudConfig, validateCloudConfig } from "./cloud-config.js";
import { intersectPlanarSlab } from "./cloud-domains.js";
import { assertCloudRouteTransition, resolveCloudRoute } from "./lab-routes.js";

const here = dirname(fileURLToPath(import.meta.url));
assert.throws(() => resolveCloudRoute({ pathname: "/mechanism/not-real/" }), /Unknown cloud mechanism/);
assert.throws(() => resolveCloudRoute({ pathname: "/tier/not-real/" }), /Unknown cloud tier/);
assert.throws(() => resolveCloudRoute({ pathname: "/scenario/not-real/" }), /Unknown cloud scenario/);
const locked = resolveCloudRoute({ pathname: "/tier/mobile/" });
assert.equal(locked.state.tier, "mobile");
assert.throws(() => assertCloudRouteTransition(locked.lock, "tier", "high"), /locked/);
const invalid = createDefaultCloudConfig();
invalid.domain.outerRadiusMeters = invalid.domain.innerRadiusMeters;
assert.equal(validateCloudConfig(invalid).ok, false);

const outsideSlab = intersectPlanarSlab({
  origin: [90000, 1200, 0],
  direction: [0, 1, 0],
  minimumHeight: 750,
  maximumHeight: 8000,
  horizontalHalfExtent: 60000,
});
assert.equal(outsideSlab.hit, false, "planar slab must reject rays outside X/Z extent");

const sourceBundle = {
  nodes: await readFile(resolve(here, "cloud-nodes.js"), "utf8"),
  history: await readFile(resolve(here, "cloud-history.js"), "utf8"),
  system: await readFile(resolve(here, "webgpu-weather-volume-clouds.js"), "utf8"),
  browser: await readFile(resolve(here, "browser-app.js"), "utf8"),
  composite: await readFile(resolve(here, "cloud-composite.js"), "utf8"),
};
function portableSourceErrors(bundle) {
  const errors = [];
  const required = [
    ["nodes", "cloudStorageTextureBindingCount = 3", "beauty binding declaration"],
    ["nodes", "cloudStorageTextureBindingCount = 2", "auxiliary binding declaration"],
    ["nodes", "texture(sceneDepthTexture, uv)", "sampled host depth"],
    ["nodes", "domain.horizontalHalfExtent", "bounded slab extent"],
    ["history", "createTemporalResolveNodes", "split temporal dispatches"],
    ["history", "cloud:temporal-resolve-color-depth-rejection", "color/depth temporal pass"],
    ["history", "cloud:temporal-resolve-auxiliary-history", "auxiliary temporal pass"],
    ["system", "async dispatchFrame", "ordered persistent dispatch"],
    ["system", "maximumStorageTextureBindings", "portable binding gate"],
    ["composite", "cloudOpticalDepthNode", "cloud shadow consumer"],
  ];
  for (const [file, token, label] of required) if (!bundle[file].includes(token)) errors.push(label);
  if (bundle.nodes.includes("frame * constants.timeSecondsPerFrame")) errors.push("frame-derived time");
  if (bundle.system.includes("cloud-host-scene-depth-r32f-meters")) errors.push("private constant scene depth");
  if (bundle.browser.includes("clearSceneDepthNode")) errors.push("browser fake-depth clear");
  return errors;
}
assert.deepEqual(portableSourceErrors(sourceBundle), []);
const sourceMutations = [
  ["nodes", "cloudStorageTextureBindingCount = 3"],
  ["nodes", "texture(sceneDepthTexture, uv)"],
  ["nodes", "domain.horizontalHalfExtent"],
  ["history", "createTemporalResolveNodes"],
  ["history", "cloud:temporal-resolve-auxiliary-history"],
  ["system", "async dispatchFrame"],
  ["system", "maximumStorageTextureBindings"],
  ["composite", "cloudOpticalDepthNode"],
];
for (const [file, token] of sourceMutations) {
  const mutant = { ...sourceBundle, [file]: sourceBundle[file].split(token).join("__MUTATED__") };
  assert(portableSourceErrors(mutant).length > 0, `mutation survived: ${file}:${token}`);
}

const manifest = JSON.parse(await readFile(resolve(here, "lab.manifest.json"), "utf8"));
for (const route of [...manifest.mechanisms, ...manifest.tiers]) {
  const kind = manifest.mechanisms.includes(route) ? "mechanism" : "tier";
  const wrapper = resolve(here, kind, route.id, "index.html");
  await access(wrapper);
  const html = await readFile(wrapper, "utf8");
  assert(html.includes(`data-route-kind="${kind}"`));
  assert(html.includes(`data-route-id="${route.id}"`));
  assert(html.includes("../../route-shell.js"));
  const resolved = resolveCloudRoute({ pathname: `/${kind}/${route.id}/` });
  if (kind === "mechanism") assert.equal(resolved.state.mode, route.startup.mode);
  else assert.equal(resolved.state.tier, route.id);
}

const artifactFixture = await mkdtemp(join(tmpdir(), "cloud-insufficient-"));
await mkdir(resolve(artifactFixture, "images"));
await Promise.all([
  writeFile(resolve(artifactFixture, "pipeline-graph.json"), "{}"),
  writeFile(resolve(artifactFixture, "storage-resources.json"), JSON.stringify({ representativeDepthFormat: "R32F meters" })),
  writeFile(resolve(artifactFixture, "renderer-info.json"), JSON.stringify({ backendIsWebGPU: true })),
  writeFile(resolve(artifactFixture, "mechanism-metrics.json"), JSON.stringify({ rendererInfo: { compute: { calls: 3 } } })),
  ...["final.design.png", "no-post.design.png", "diagnostics.mosaic.png"].map((name) =>
    writeFile(resolve(artifactFixture, "images", name), new Uint8Array([1])),
  ),
  writeFile(resolve(artifactFixture, "evidence-manifest.json"), JSON.stringify({
    schemaVersion: 2,
    claims: [
      { id: "native-webgpu-runtime", required: true, verdict: "PASS", evidence: "renderer-info.json" },
      { id: "aligned-render-target-readback", required: true, verdict: "PASS", evidence: "images/final.design.png" },
      { id: "bounded-compute-dispatch", required: true, verdict: "PASS", evidence: "mechanism-metrics.json" },
      { id: "metric-r32f-depth-resource", required: true, verdict: "PASS", evidence: "storage-resources.json" },
      { id: "current-adapter-gpu-timing", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null },
      { id: "temporal-disocclusion-error", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null },
      { id: "high-step-transport-reference", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null },
      { id: "lifecycle-stability", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null },
    ],
  })),
]);
const result = spawnSync(process.execPath, [resolve(here, "validate-artifacts.mjs"), "--output", artifactFixture], { encoding: "utf8" });
assert.notEqual(result.status, 0, "required INSUFFICIENT_EVIDENCE must fail artifact validation");
assert.match(`${result.stdout}${result.stderr}`, /current-adapter-gpu-timing: INSUFFICIENT_EVIDENCE/);
console.log(`webgpu-weather-volume-clouds mutation and route coverage tests passed; retained fixture: ${artifactFixture}`);
