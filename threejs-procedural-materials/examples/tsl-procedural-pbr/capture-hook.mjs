import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import {
  dirname,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

import {
  DETERMINISTIC_REPLAY_GROUP,
  EXPECTED_MATERIAL_CAPTURES,
  canonicalJson,
} from "./material-artifact-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const THREE_REVISION = "0.185.1";
const RAW_CAPTURE_TARGETS = new Set([
  "material-albedo",
  "material-params",
  "material-normal",
  "material-footprint",
  "material-normal-variance",
  "raw-emissive",
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function closurePath(path) {
  return relative(repoRoot, path).split(sep).join("/");
}

function collectFiles(path, output) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) throw new Error(`source closure rejects symlink ${closurePath(path)}`);
  if (metadata.isDirectory()) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "node_modules" || entry.name === ".DS_Store") continue;
      collectFiles(resolve(path, entry.name), output);
    }
    return;
  }
  if (!metadata.isFile()) return;
  const bytes = readFileSync(path);
  output.push(Object.freeze({
    path: closurePath(path),
    sha256: sha256(bytes),
    byteLength: bytes.byteLength,
  }));
}

export function recomputeCaptureSourceClosure() {
  const roots = [
    here,
    resolve(repoRoot, "threejs-procedural-materials/assets/generated-variants/lava-cause-a.png"),
    resolve(repoRoot, "threejs-procedural-materials/assets/generated-variants/lava-cause-b.png"),
    resolve(repoRoot, "threejs-procedural-materials/assets/generated-variants/lava-cause-c.png"),
    resolve(repoRoot, "scripts/capture-lab-browser.mjs"),
    resolve(repoRoot, "scripts/lib/page-routes.mjs"),
    resolve(repoRoot, "labs/runtime/strict-lab-controller.mjs"),
    resolve(repoRoot, "package.json"),
    resolve(repoRoot, "package-lock.json"),
  ];
  const files = [];
  for (const root of roots) collectFiles(root, files);
  files.sort((left, right) => left.path.localeCompare(right.path));
  const uniqueFiles = [...new Map(files.map((entry) => [entry.path, entry])).values()];
  const sourceHash = sha256(Buffer.from(canonicalJson({
    algorithm: "tsl-procedural-pbr-source-closure-v3",
    threeRevision: THREE_REVISION,
    files: uniqueFiles,
  })));
  const buildRevision = sha256(Buffer.from(canonicalJson({
    sourceHash,
    toolchain: uniqueFiles.filter((entry) => (
      entry.path === "package.json"
      || entry.path === "package-lock.json"
      || entry.path === "scripts/capture-lab-browser.mjs"
    )),
  })));
  return Object.freeze({
    algorithm: "tsl-procedural-pbr-source-closure-v3",
    roots: Object.freeze(roots.map(closurePath)),
    files: Object.freeze(uniqueFiles),
    threeRevision: THREE_REVISION,
    sourceHash,
    buildRevision,
  });
}

export function validateCaptureSourceClosure(candidate) {
  const current = recomputeCaptureSourceClosure();
  if (canonicalJson(candidate) !== canonicalJson(current)) {
    throw new Error("TSL Procedural PBR source closure is stale or forged");
  }
  return true;
}

export const outputPlan = Object.freeze([
  { id: "final.design", status: "CAPTURED", filename: "final.design.png" },
  { id: "no-post.design", status: "CAPTURED", filename: "no-post.design.png" },
  { id: "diagnostics.mosaic", status: "CAPTURED", filename: "diagnostics.mosaic.png" },
  { id: "camera.near", status: "CAPTURED", filename: "camera.near.png" },
  { id: "camera.design", status: "CAPTURED", filename: "camera.design.png" },
  { id: "camera.far", status: "CAPTURED", filename: "camera.far.png" },
  { id: "seed-0001.final", status: "CAPTURED", filename: "seed-0001.final.png" },
  { id: "seed-9e3779b9.final", status: "CAPTURED", filename: "seed-9e3779b9.final.png" },
  { id: "temporal.t000", status: "CAPTURED", filename: "temporal.t000.png" },
  { id: "temporal.t001", status: "CAPTURED", filename: "temporal.t001.png" },
]);

export async function captureLab(session) {
  const sourceClosure = recomputeCaptureSourceClosure();
  const captures = [];
  let sequenceIndex = 0;
  async function capture(filename, target, {
    scenario = null,
    tier = "ultra",
    camera = "design",
    seed = 0x00000001,
    time = 0,
  } = {}) {
    if (scenario) await session.controllerCall("setScenario", scenario);
    await session.controllerCall("setTier", tier);
    await session.controllerCall("setCamera", camera);
    await session.controllerCall("setSeed", seed);
    await session.controllerCall("setTime", time);
    const result = await session.writeCapture(filename, target);
    let rawAttachment = null;
    if (RAW_CAPTURE_TARGETS.has(target)) {
      const raw = await session.controllerCall("getRawCaptureArtifact", target);
      const bytes = Buffer.from(raw.dataBase64, "base64");
      if (bytes.byteLength !== raw.byteLength) {
        throw new Error(`${filename} raw attachment byte length drifted`);
      }
      const stem = filename.slice(0, -4);
      const path = `raw-mrt/${stem}.${raw.format}.bin`;
      await session.writeArtifact(path, bytes);
      const { dataBase64, ...metadata } = raw;
      rawAttachment = Object.freeze({
        ...metadata,
        artifact: Object.freeze({
          path,
          sha256: sha256(bytes),
          byteLength: bytes.byteLength,
        }),
      });
    }
    const expected = EXPECTED_MATERIAL_CAPTURES[filename];
    if (!expected || expected.target !== target) throw new Error(`capture contract drifted for ${filename}`);
    captures.push({
      filename,
      scenario,
      tier,
      camera,
      seed,
      time,
      sequenceIndex: sequenceIndex++,
      ...result,
      ...(rawAttachment ? { rawAttachment } : {}),
    });
  }

  await capture("final.design.png", "final", { scenario: "pbr-identity" });
  await capture("no-post.design.png", "no-post", { scenario: "pbr-identity" });
  await capture("diagnostics.mosaic.png", "diagnostics-mosaic", { scenario: "pbr-identity" });
  await capture("camera.near.png", "final", { scenario: "pbr-identity", camera: "near" });
  await capture("camera.design.png", "final", { scenario: "pbr-identity", camera: "design" });
  await capture("camera.far.png", "final", { scenario: "pbr-identity", camera: "far" });
  await capture("seed-0001.final.png", "final", { scenario: "pbr-identity", seed: 0x00000001 });
  await capture("seed-9e3779b9.final.png", "final", { scenario: "pbr-identity", seed: 0x9e3779b9 });
  await capture("temporal.t000.png", "final", { scenario: "pbr-identity", time: 0 });
  await capture("temporal.t001.png", "final", { scenario: "pbr-identity", time: 1 });

  await capture("material-albedo.png", "material-albedo", { scenario: "pbr-identity" });
  await capture("material-params.png", "material-params", { scenario: "pbr-identity" });
  await capture("material-normal.png", "material-normal", { scenario: "specular-aa-and-filtering" });
  await capture("material-footprint.png", "material-footprint", { scenario: "specular-aa-and-filtering" });
  await capture("material-normal-variance.png", "material-normal-variance", { scenario: "specular-aa-and-filtering" });
  await capture("raw-emissive.png", "raw-emissive", { scenario: "pbr-identity" });
  await capture("atlas-array-triplanar.png", "no-post", { scenario: "atlas-array-and-triplanar" });
  await capture("dissolve-visible.png", "no-post", { scenario: "instanced-dissolve" });
  await capture("dissolve-shadow-parity.png", "final", { scenario: "shadow-parity" });
  await capture("wet-rock-direct-occlusion.png", "final", { scenario: "wet-rock-and-occlusion" });

  const incompleteBoundary = {
    schemaVersion: 2,
    labId: session.lab.id,
    status: "incomplete",
    publishable: false,
    evidenceContract: "v2",
    sourceHash: sourceClosure.sourceHash,
    sourceClosure,
    buildRevision: sourceClosure.buildRevision,
    threeRevision: THREE_REVISION,
    reason: "Capture session is not an accepted evidence bundle until current-adapter GPU timestamps, shadow-depth readback, supersampled specular error, and 50-cycle lifecycle evidence exist.",
    claims: {
      nativeWebGPUCorrectness: "INSUFFICIENT_EVIDENCE",
      currentAdapterTiming: "INSUFFICIENT_EVIDENCE",
      shadowDissolveParity: "INSUFFICIENT_EVIDENCE",
      supersampledSpecularError: "INSUFFICIENT_EVIDENCE",
      lifecycle: "INSUFFICIENT_EVIDENCE",
    },
    deterministicReplayGroups: [DETERMINISTIC_REPLAY_GROUP],
    captures,
  };
  await writeFile(
    resolve(session.outputDir, "evidence-manifest.incomplete.json"),
    `${JSON.stringify(incompleteBoundary, null, 2)}\n`,
  );
  return {
    status: "incomplete",
    publishable: false,
    sourceClosure,
    captures,
  };
}

export default captureLab;
