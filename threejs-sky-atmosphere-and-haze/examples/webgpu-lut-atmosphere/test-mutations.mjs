import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAtmosphereConfig, validateAtmosphereConfig } from "./atmosphere-config.js";
import {
  assertAtmosphereRouteTransition,
  resolveAtmosphereRoute,
} from "./lab-routes.js";
import {
  createDefaultAtmosphereRuntimeState,
  resolveAtmosphereDirtyProducts,
  validateAtmosphereRuntimeState,
} from "./runtime-state.js";

const here = dirname(fileURLToPath(import.meta.url));
assert.throws(() => resolveAtmosphereRoute({ pathname: "/mechanism/not-real/" }), /Unknown atmosphere mechanism/);
assert.throws(() => resolveAtmosphereRoute({ pathname: "/tier/not-real/" }), /Unknown atmosphere tier/);
assert.throws(() => resolveAtmosphereRoute({ pathname: "/scenario/not-real/" }), /Unknown atmosphere scenario/);
const locked = resolveAtmosphereRoute({ pathname: "/mechanism/aerial-perspective/" });
assert.equal(locked.state.mode, "aerial-inscattering");
assert.throws(
  () => assertAtmosphereRouteTransition(locked.lock, "mode", "final"),
  /locks mode/,
);
const invalid = createAtmosphereConfig();
invalid.radiiMeters.top = invalid.radiiMeters.bottom;
assert.equal(validateAtmosphereConfig(invalid).ok, false);
const invalidRadiometry = createAtmosphereConfig();
invalidRadiometry.solarUnit = "watts-ish";
assert.equal(validateAtmosphereConfig(invalidRadiometry).ok, false);

const dependencyConfig = createAtmosphereConfig();
const baselineRuntime = createDefaultAtmosphereRuntimeState(dependencyConfig);
const magnitudeOnly = structuredClone(baselineRuntime);
magnitudeOnly.solarNormalIrradiance = [3, 2, 1];
assert.deepEqual(resolveAtmosphereDirtyProducts(baselineRuntime, magnitudeOnly).dirty, []);
const movedCamera = structuredClone(baselineRuntime);
movedCamera.cameraRadiusKm += 2;
movedCamera.cameraPositionBodyKm[1] += 2;
assert.deepEqual(
  resolveAtmosphereDirtyProducts(baselineRuntime, movedCamera).dirty,
  ["skyView", "aerialProducts"],
);
const resized = structuredClone(baselineRuntime);
resized.viewport = [641, 359];
assert.deepEqual(
  resolveAtmosphereDirtyProducts(baselineRuntime, resized).dirty,
  ["aerialProducts"],
);
assert.throws(
  () => validateAtmosphereRuntimeState({ ...baselineRuntime, localSunMu: 2 }),
  /localSunMu/,
);

for (const mutation of [
  "output-transform",
  "fixed-final",
  "uv-ramp-diagnostics",
  "independent-aerial-prefixes",
  "unbound-live-controls",
]) {
  const result = spawnSync(
    process.execPath,
    [resolve(here, "validation.js")],
    {
      encoding: "utf8",
      env: { ...process.env, ATMOSPHERE_VALIDATION_INDUCE: mutation },
    },
  );
  assert.notEqual(result.status, 0, `mutation ${mutation} must be killed`);
}

const manifest = JSON.parse(await readFile(resolve(here, "lab.manifest.json"), "utf8"));
for (const route of [...manifest.mechanisms, ...manifest.tiers, ...manifest.scenarios]) {
  const kind = manifest.mechanisms.includes(route)
    ? "mechanism"
    : manifest.tiers.includes(route)
      ? "tier"
      : "scenario";
  const wrapper = resolve(here, kind, route.id, "index.html");
  await access(wrapper);
  const html = await readFile(wrapper, "utf8");
  assert(html.includes(`data-route-kind="${kind}"`));
  assert(html.includes(`data-route-id="${route.id}"`));
  assert(html.includes("../../route-shell.js"));
  const resolved = resolveAtmosphereRoute({ pathname: `/${kind}/${route.id}/` });
  if (kind === "mechanism") assert.equal(resolved.state.mode, route.startup.mode);
  else if (kind === "tier") assert.equal(resolved.state.tier, route.id);
  else assert.equal(resolved.state.scenario, route.id);
}

const artifactFixture = await mkdtemp(join(tmpdir(), "atmosphere-insufficient-"));
try {
  await mkdir(resolve(artifactFixture, "images"));
  await Promise.all([
    writeFile(resolve(artifactFixture, "pipeline-graph.json"), "{}"),
    writeFile(resolve(artifactFixture, "storage-resources.json"), "{}"),
    writeFile(resolve(artifactFixture, "renderer-info.json"), JSON.stringify({ backendIsWebGPU: true })),
    writeFile(resolve(artifactFixture, "mechanism-metrics.json"), JSON.stringify({ rendererInfo: { compute: { calls: 5 } } })),
    ...["final.design.png", "no-post.design.png", "diagnostics.mosaic.png"].map((name) =>
      writeFile(resolve(artifactFixture, "images", name), new Uint8Array([1])),
    ),
    writeFile(resolve(artifactFixture, "evidence-manifest.json"), JSON.stringify({
      schemaVersion: 2,
      claims: [
        { id: "native-webgpu-runtime", required: true, verdict: "PASS", evidence: "renderer-info.json" },
        { id: "aligned-render-target-readback", required: true, verdict: "PASS", evidence: "images/final.design.png" },
        { id: "five-stage-compute-dispatch", required: true, verdict: "PASS", evidence: "mechanism-metrics.json" },
        { id: "live-camera-body-depth-composition", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null },
        { id: "cumulative-aerial-xy-rays", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null },
        { id: "current-adapter-gpu-timing", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null },
        { id: "reference-radiance-and-energy", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null },
        { id: "lifecycle-stability", required: true, verdict: "INSUFFICIENT_EVIDENCE", evidence: null },
      ],
    })),
  ]);
  const result = spawnSync(process.execPath, [resolve(here, "validate-artifacts.mjs"), "--output", artifactFixture], { encoding: "utf8" });
  assert.notEqual(result.status, 0, "required INSUFFICIENT_EVIDENCE must fail artifact validation");
  assert.match(`${result.stdout}${result.stderr}`, /current-adapter-gpu-timing: INSUFFICIENT_EVIDENCE/);
} finally {
  await rm(artifactFixture, { recursive: true, force: true });
}
console.log("webgpu-lut-atmosphere mutation and route coverage tests passed");
