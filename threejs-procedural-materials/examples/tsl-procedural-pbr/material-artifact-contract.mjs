import assert from "node:assert/strict";

import {
  unpackReadbackRows,
  visualizeHalfFloatEmissive,
} from "./pbr-oracles.mjs";

export const EXPECTED_MATERIAL_CAPTURES = Object.freeze({
  "final.design.png": Object.freeze({ target: "final", scenario: "pbr-identity", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "no-post.design.png": Object.freeze({ target: "no-post", scenario: "pbr-identity", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "diagnostics.mosaic.png": Object.freeze({ target: "diagnostics-mosaic", scenario: "pbr-identity", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "camera.near.png": Object.freeze({ target: "final", scenario: "pbr-identity", tier: "ultra", camera: "near", seed: 1, time: 0 }),
  "camera.design.png": Object.freeze({ target: "final", scenario: "pbr-identity", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "camera.far.png": Object.freeze({ target: "final", scenario: "pbr-identity", tier: "ultra", camera: "far", seed: 1, time: 0 }),
  "seed-0001.final.png": Object.freeze({ target: "final", scenario: "pbr-identity", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "seed-9e3779b9.final.png": Object.freeze({ target: "final", scenario: "pbr-identity", tier: "ultra", camera: "design", seed: 0x9e3779b9, time: 0 }),
  "temporal.t000.png": Object.freeze({ target: "final", scenario: "pbr-identity", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "temporal.t001.png": Object.freeze({ target: "final", scenario: "pbr-identity", tier: "ultra", camera: "design", seed: 1, time: 1 }),
  "material-albedo.png": Object.freeze({ target: "material-albedo", scenario: "pbr-identity", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "material-params.png": Object.freeze({ target: "material-params", scenario: "pbr-identity", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "material-normal.png": Object.freeze({ target: "material-normal", scenario: "specular-aa-and-filtering", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "material-footprint.png": Object.freeze({ target: "material-footprint", scenario: "specular-aa-and-filtering", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "material-normal-variance.png": Object.freeze({ target: "material-normal-variance", scenario: "specular-aa-and-filtering", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "raw-emissive.png": Object.freeze({ target: "raw-emissive", scenario: "pbr-identity", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "atlas-array-triplanar.png": Object.freeze({ target: "no-post", scenario: "atlas-array-and-triplanar", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "dissolve-visible.png": Object.freeze({ target: "no-post", scenario: "instanced-dissolve", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "dissolve-shadow-parity.png": Object.freeze({ target: "final", scenario: "shadow-parity", tier: "ultra", camera: "design", seed: 1, time: 0 }),
  "wet-rock-direct-occlusion.png": Object.freeze({ target: "final", scenario: "wet-rock-and-occlusion", tier: "ultra", camera: "design", seed: 1, time: 0 }),
});

export const DETERMINISTIC_REPLAY_GROUP = Object.freeze([
  "final.design.png",
  "camera.design.png",
  "seed-0001.final.png",
  "temporal.t000.png",
]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function assertCurrentSourceIdentity(session, boundary, currentClosure) {
  assert.equal(session.threeRevision, "0.185.1", "capture session Three revision drifted");
  assert.equal(session.sourceHash, currentClosure.sourceHash, "capture session source hash is stale");
  assert.equal(session.sourceClosureHash, currentClosure.sourceHash, "capture session closure hash is stale");
  assert.equal(session.buildRevision, currentClosure.buildRevision, "capture session build revision is stale");
  assert.equal(canonicalJson(session.sourceClosure), canonicalJson(currentClosure), "capture session source closure differs from current source");
  assert.equal(boundary.sourceHash, currentClosure.sourceHash, "boundary source hash is stale");
  assert.equal(boundary.buildRevision, currentClosure.buildRevision, "boundary build revision is stale");
  assert.equal(boundary.threeRevision, "0.185.1", "boundary Three revision drifted");
  assert.equal(canonicalJson(boundary.sourceClosure), canonicalJson(currentClosure), "boundary source closure differs from current source");
}

export function assertCaptureState(capture) {
  const expected = EXPECTED_MATERIAL_CAPTURES[capture.filename];
  assert(expected, `unexpected material capture ${capture.filename}`);
  for (const key of ["target", "scenario", "tier", "camera", "seed", "time"]) {
    assert.equal(capture[key], expected[key], `${capture.filename} ${key} drifted`);
  }
}

export function assertBytesEqual(actual, expected, label) {
  assert.equal(actual.byteLength, expected.byteLength, `${label} byte length differs`);
  for (let index = 0; index < actual.byteLength; index++) {
    if (actual[index] !== expected[index]) {
      assert.fail(`${label} differs at byte ${index}: ${actual[index]} !== ${expected[index]}`);
    }
  }
}

export function compactCaptureTransport(capture, transportBytes) {
  return unpackReadbackRows({
    bytes: transportBytes,
    width: capture.width,
    height: capture.height,
    bytesPerPixel: capture.bytesPerPixel,
    bytesPerRow: capture.transport.layout.bytesPerRow,
  });
}

export function assertRawAttachmentVisualization(capture, rawBytes, decodedPng) {
  const raw = capture.rawAttachment;
  assert(raw, `${capture.filename} is missing raw attachment evidence`);
  const compact = unpackReadbackRows({
    bytes: rawBytes,
    width: raw.width,
    height: raw.height,
    bytesPerPixel: raw.bytesPerPixel,
    bytesPerRow: raw.bytesPerRow,
  });
  const expected = raw.visualization === "raw-unorm-byte-identity"
    ? compact
    : raw.visualization === "half-float-reinhard-linear-to-srgb-v1"
      ? visualizeHalfFloatEmissive({
        bytes: rawBytes,
        width: raw.width,
        height: raw.height,
        bytesPerRow: raw.bytesPerRow,
      })
      : assert.fail(`unknown raw visualization ${raw.visualization}`);
  assertBytesEqual(decodedPng, expected, `${capture.filename} raw-to-PNG visualization`);
}

export function summarizeRgba8(pixels) {
  if (!(pixels instanceof Uint8Array) && !Buffer.isBuffer(pixels)) {
    throw new TypeError("RGBA8 pixels must be byte-addressed");
  }
  if (pixels.byteLength % 4 !== 0) throw new RangeError("RGBA8 byte length is not divisible by four");
  const colors = new Set();
  const channelMin = [255, 255, 255, 255];
  const channelMax = [0, 0, 0, 0];
  for (let offset = 0; offset < pixels.byteLength; offset += 4) {
    if (colors.size <= 65536) {
      colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`);
    }
    for (let channel = 0; channel < 4; channel++) {
      channelMin[channel] = Math.min(channelMin[channel], pixels[offset + channel]);
      channelMax[channel] = Math.max(channelMax[channel], pixels[offset + channel]);
    }
  }
  return Object.freeze({ uniqueColors: colors.size, channelMin, channelMax });
}

function roiStatistics(pixels, width, height, { x0, x1, y0, y1 }) {
  const left = Math.max(0, Math.floor(width * x0));
  const right = Math.min(width, Math.ceil(width * x1));
  const top = Math.max(0, Math.floor(height * y0));
  const bottom = Math.min(height, Math.ceil(height * y1));
  let count = 0;
  let visibleCount = 0;
  let chromaSum = 0;
  let luminanceSum = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const alpha = pixels[offset + 3];
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      count++;
      if (alpha > 16 && luminance > 18) visibleCount++;
      chromaSum += Math.max(red, green, blue) - Math.min(red, green, blue);
      luminanceSum += luminance;
    }
  }
  return Object.freeze({
    count,
    visibleCount,
    visibleFraction: count === 0 ? 0 : visibleCount / count,
    meanChroma: count === 0 ? 0 : chromaSum / count,
    meanLuminance: count === 0 ? 0 : luminanceSum / count,
  });
}

export function assertMaterialImageSemantics(filename, pixels, width, height) {
  assert.equal(pixels.byteLength, width * height * 4, `${filename} decoded RGBA8 size drifted`);
  const summary = summarizeRgba8(pixels);
  assert(summary.uniqueColors >= 32, `${filename} is blank or effectively constant (${summary.uniqueColors} colors)`);

  const canonicalDesignImages = new Set([
    ...DETERMINISTIC_REPLAY_GROUP,
    "no-post.design.png",
    "seed-9e3779b9.final.png",
    "temporal.t001.png",
  ]);
  if (canonicalDesignImages.has(filename)) {
    const subjectBand = roiStatistics(pixels, width, height, { x0: 0.04, x1: 0.96, y0: 0.30, y1: 0.54 });
    assert(subjectBand.visibleFraction > 0.10, `${filename} lost the material subjects`);
    const walnut = roiStatistics(pixels, width, height, { x0: 0.065, x1: 0.235, y0: 0.34, y1: 0.54 });
    assert(walnut.meanChroma > 12, `${filename} shows a stale grayscale identity mode instead of walnut PBR`);
  }

  if (filename === "raw-emissive.png") {
    const lava = roiStatistics(pixels, width, height, { x0: 0.60, x1: 0.76, y0: 0.34, y1: 0.56 });
    const nonEmitter = roiStatistics(pixels, width, height, { x0: 0.05, x1: 0.55, y0: 0.30, y1: 0.58 });
    assert(lava.meanLuminance > 18, "raw emissive lost the authored lava signal");
    assert(nonEmitter.meanLuminance < 2, "raw emissive contains unauthored non-emitter signal");
  }

  if (filename === "material-params.png") {
    assert(summary.channelMax[0] > summary.channelMin[0], "roughness channel is constant");
    assert(summary.channelMax[1] >= 240, "metalness channel never reaches the conductor endpoint");
    assert(summary.channelMin[1] === 0, "metalness channel lost the dielectric endpoint");
    assert(summary.channelMax[2] > 0, "clearcoat channel is empty");
    assert(summary.channelMax[3] >= 240, "dissolve mask channel has no visible samples");
  }

  return summary;
}

/**
 * Validate only normals that correspond to fully covered, visibly authored
 * material pixels. The MRT clear/default value is black with alpha one for
 * classic scene materials, so neither normal alpha nor the normal value itself
 * is a valid coverage mask. The independently captured albedo attachment is
 * the producer-owned coverage witness.
 */
export function assertCoveredMaterialNormals({
  normalPixels,
  albedoPixels,
  width,
  height,
}) {
  assert.equal(normalPixels.byteLength, width * height * 4, "normal RGBA8 size drifted");
  assert.equal(albedoPixels.byteLength, width * height * 4, "albedo RGBA8 size drifted");

  let sampleCount = 0;
  let errorSum = 0;
  let maximumError = 0;
  for (let offset = 0; offset < normalPixels.byteLength; offset += 4) {
    const albedoLuminance = 0.2126 * albedoPixels[offset]
      + 0.7152 * albedoPixels[offset + 1]
      + 0.0722 * albedoPixels[offset + 2];
    const fullyCoveredVisibleMaterial = albedoPixels[offset + 3] === 255
      && albedoLuminance >= 32;
    if (!fullyCoveredVisibleMaterial) continue;

    const nx = normalPixels[offset] / 255 * 2 - 1;
    const ny = normalPixels[offset + 1] / 255 * 2 - 1;
    const nz = normalPixels[offset + 2] / 255 * 2 - 1;
    const error = Math.abs(Math.hypot(nx, ny, nz) - 1);
    sampleCount++;
    errorSum += error;
    maximumError = Math.max(maximumError, error);
  }

  assert(sampleCount > 10_000, "material normal contains too few albedo-covered subject samples");
  assert(errorSum / sampleCount < 0.01, "material normal mean length error exceeds RGBA8 tolerance");
  assert(maximumError < 0.02, "a covered material normal is not unit length within RGBA8 tolerance");
  return Object.freeze({
    sampleCount,
    meanError: errorSum / sampleCount,
    maximumError,
    coverageSource: "material-albedo-rgba8/alpha=255/luminance>=32",
  });
}
