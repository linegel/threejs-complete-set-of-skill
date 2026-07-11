import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const index = process.argv.indexOf("--artifacts");
const here = dirname(fileURLToPath(import.meta.url));
const artifacts = resolve(index >= 0
  ? process.argv[index + 1]
  : resolve(here, "../../../artifacts/visual-validation/tsl-procedural-pbr/correctness"));
const sessionPath = resolve(artifacts, "capture-session.json");
const boundaryPath = resolve(artifacts, "evidence-manifest.incomplete.json");
assert(existsSync(sessionPath), `missing ${sessionPath}`);
assert(existsSync(boundaryPath), `missing ${boundaryPath}`);

const session = JSON.parse(readFileSync(sessionPath, "utf8"));
const boundary = JSON.parse(readFileSync(boundaryPath, "utf8"));
assert.equal(session.schemaVersion, 2);
assert.equal(session.labId, "tsl-procedural-pbr");
assert.equal(session.runtime?.metrics?.backend?.isWebGPUBackend, true);
assert.equal(session.runtime?.pipeline?.finalToneMapOwner, "renderOutput");
assert.equal(session.runtime?.pipeline?.finalOutputTransformOwner, "renderOutput");
assert.equal(session.runtime?.pipeline?.outputColorTransformDisabledOnPipeline, true);
assert.equal(boundary.schemaVersion, 2);
assert.equal(boundary.status, "incomplete");
assert.equal(boundary.publishable, false);
assert(Object.values(boundary.claims).every((verdict) => verdict === "INSUFFICIENT_EVIDENCE"));

const required = new Set([
  "final.design.png",
  "no-post.design.png",
  "material-albedo.png",
  "material-normal.png",
  "material-footprint.png",
  "material-normal-variance.png",
  "atlas-array-triplanar.png",
  "dissolve-visible.png",
  "dissolve-shadow-parity.png",
  "wet-rock-direct-occlusion.png",
]);
const hashes = new Map();
for (const capture of boundary.captures) {
  required.delete(capture.filename);
  assert(Number.isInteger(capture.bytesPerRow) && capture.bytesPerRow % 256 === 0);
  assert.equal(capture.bytesPerPixel, 4);
  const bytes = readFileSync(resolve(artifacts, capture.filename));
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${capture.filename} is not PNG`);
  assert.equal(bytes.readUInt32BE(16), capture.width, `${capture.filename} width mismatch`);
  assert.equal(bytes.readUInt32BE(20), capture.height, `${capture.filename} height mismatch`);
  hashes.set(capture.filename, createHash("sha256").update(bytes).digest("hex"));
}
assert.equal(required.size, 0, `missing required material captures: ${[...required].join(", ")}`);
for (const [left, right] of [
  ["final.design.png", "material-footprint.png"],
  ["material-normal.png", "material-normal-variance.png"],
  ["dissolve-visible.png", "dissolve-shadow-parity.png"],
]) {
  assert.notEqual(hashes.get(left), hashes.get(right), `${left} must differ from ${right}`);
}

console.log(JSON.stringify({
  pass: true,
  status: "incomplete",
  publishable: false,
  captureCount: boundary.captures.length,
  reason: boundary.reason,
}, null, 2));
