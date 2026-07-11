import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodeGeneratedRgbaPixels,
} from "../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, "../../assets/generated-variants/manifest.json");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function channelRange(pixels, channel) {
  let min = 255;
  let max = 0;
  for (let offset = channel; offset < pixels.length; offset += 4) {
    min = Math.min(min, pixels[offset]);
    max = Math.max(max, pixels[offset]);
  }
  return { min, max };
}

async function validateAssets() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.colorSpace, "NoColorSpace");
  assert.equal(manifest.assetPreviewOnly, true);
  assert.equal(manifest.pipelineEvidence, "not-run");
  assert.equal(manifest.lifecycleEvidence, "not-run");
  for (const channel of ["r", "g", "b", "a"]) {
    assert(manifest.channelMeanings[channel], `missing ${channel} channel meaning`);
  }

  const assets = [];
  for (const asset of manifest.assets) {
    const path = resolve(dirname(manifestPath), asset.path);
    const buffer = await readFile(path);
    const decoded = decodeGeneratedRgbaPixels(buffer);
    assert.equal(decoded.width, asset.width, `${asset.id} width`);
    assert.equal(decoded.height, asset.height, `${asset.id} height`);
    assert.equal(buffer.byteLength, asset.byteLength, `${asset.id} byteLength`);
    assert.equal(sha256(buffer), asset.sha256, `${asset.id} sha256`);
    assert.equal(asset.channels, 4, `${asset.id} channel count`);
    assert.equal(asset.colorSpace, "NoColorSpace", `${asset.id} color space`);
    assert.equal(asset.minimumResidentDiagnosticOnly, true, `${asset.id} diagnostic flag`);
    const ranges = [0, 1, 2, 3].map((channel) => channelRange(decoded.pixels, channel));
    assert(ranges.every(({ min, max }) => max > min), `${asset.id} must retain nonconstant RGBA channels`);
    assets.push({ id: asset.id, sha256: asset.sha256, ranges });
  }

  return {
    pass: true,
    evidenceClass: "asset-integrity-only",
    executed: ["manifest schema", "PNG decode", "dimensions", "byte length", "SHA-256", "RGBA channel range"],
    notRun: [
      "Canvas2D preview capture",
      "WebGPU render pipeline",
      "planet displacement or material graph",
      "lifecycle/dispose loops",
      "GPU or full-frame timing",
      "visual acceptance",
    ],
    assets,
  };
}

const report = await validateAssets();
const reportPath = process.env.PLANET_CRATER_ASSET_REPORT ??
  resolve(tmpdir(), "planet-generated-crater-assets.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`generated crater asset integrity passed: ${reportPath}`);
