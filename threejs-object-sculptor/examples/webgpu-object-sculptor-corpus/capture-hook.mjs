import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { alignedBytesPerRow, unpackAlignedRows } from "../../../labs/runtime/aligned-readback.mjs";
import { encodeRgbaPng } from "../../../scripts/lib/png-rgba.mjs";

import { SCULPT_TARGET_IDS } from "./object-catalog.js";
import { objectSculptorCorpusFrameOwner } from "./frame-driver.js";
import {
  CORPUS_TARGET_MASK_PLAN,
  decodeBinaryTargetMask,
} from "./mask-raster.mjs";
import {
  assertDistinctPngRasters,
  assertMeaningfulRgbaRaster,
  comparePngRgb,
  decodePngRaster,
  validatePngRgbaBinding,
} from "./png-raster.mjs";
import {
  computeCorpusExecutableSourceClosure,
  validateCorpusExecutableSourceClosure,
} from "./generate-trusted-runtime-source-manifest.mjs";
import { CORPUS_PHYSICAL_ROUTE_PLAN } from "./validate-routes.mjs";

export const CORPUS_REPRESENTATIVE_SEED = 1;
export const CORPUS_STRESS_SEED = 2654435769;
export const CORPUS_RASTER_GATES = Object.freeze({
  replay: Object.freeze({ rgbMaeMaximum: 0.01, changedPixelRatioMaximum: 0.005, maxChannelDeltaMaximum: 32 }),
  stress: Object.freeze({ rgbMaeMinimum: 0.02, changedPixelRatioMinimum: 0.01 }),
  motion: Object.freeze({ rgbMaeMinimum: 0.05, changedPixelRatioMinimum: 0.01 }),
});
export const CORPUS_STANDARD_RASTER_CONTRACT = Object.freeze({
  width: 1200,
  height: 800,
  panelCount: 3,
  panelWidth: 400,
  panelHeight: 800,
  layout: "horizontal-equal-width",
  sourcePolicy: "full-frame",
  cropPolicy: "none",
  resamplingKernel: "nearest-center-rgba8-v1",
  coordinateRule: "source=floor((destination+0.5)*sourceExtent/destinationExtent)",
  edgeMode: "clamp",
  colorDomain: "encoded-rgba8",
});

export function computeCaptureSourceClosure() {
  return computeCorpusExecutableSourceClosure();
}

export function recomputeCaptureSourceClosure() {
  return computeCorpusExecutableSourceClosure();
}

export function validateCaptureSourceClosure(candidate) {
  return validateCorpusExecutableSourceClosure(candidate);
}

const STATE_TEMPLATES = Object.freeze([
  Object.freeze({ label: "final.full.design", mode: "final", tier: "full", camera: "design", seed: CORPUS_REPRESENTATIVE_SEED, seedPhase: "A0", seedCaseId: "final-full-design", time: 0 }),
  Object.freeze({ label: "blockout.full.design", mode: "blockout", tier: "full", camera: "design", time: 0 }),
  Object.freeze({ label: "hierarchy.full.design", mode: "hierarchy", tier: "full", camera: "design", time: 0 }),
  Object.freeze({ label: "materials.full.close-material", mode: "materials", tier: "full", camera: "close-material", time: 0 }),
  Object.freeze({ label: "action-ready.full.design.t000", mode: "action-ready", tier: "full", camera: "design", seedPhase: "A0", seedCaseId: "action-ready-t000", time: 0 }),
  Object.freeze({ label: "action-ready.full.design.t200", mode: "action-ready", tier: "full", camera: "design", seedPhase: "A0", seedCaseId: "action-ready-t200", time: 2 }),
  Object.freeze({ label: "final.budgeted.design", mode: "final", tier: "budgeted", camera: "design", time: 0 }),
  Object.freeze({ label: "final.minimum.design", mode: "final", tier: "minimum", camera: "design", time: 0 }),
  Object.freeze({ label: "final.full.profile", mode: "final", tier: "full", camera: "profile", time: 0 }),
  Object.freeze({ label: "final.full.close-material", mode: "final", tier: "full", camera: "close-material", time: 0 }),
  Object.freeze({ label: "final.full.attachment", mode: "final", tier: "full", camera: "attachment", time: 0 }),
  Object.freeze({ label: "final.full.design.stress-seed", mode: "final", tier: "full", camera: "design", seed: CORPUS_STRESS_SEED, seedPhase: "B", seedCaseId: "final-full-design", time: 0 }),
  Object.freeze({ label: "final.full.profile.stress-seed", mode: "final", tier: "full", camera: "profile", seed: CORPUS_STRESS_SEED, seedPhase: "B", seedCaseId: "final-full-profile", time: 0 }),
  Object.freeze({ label: "action-ready.full.design.stress-seed.t000", mode: "action-ready", tier: "full", camera: "design", seed: CORPUS_STRESS_SEED, seedPhase: "B", seedCaseId: "action-ready-t000", time: 0 }),
  Object.freeze({ label: "action-ready.full.design.stress-seed.t200", mode: "action-ready", tier: "full", camera: "design", seed: CORPUS_STRESS_SEED, seedPhase: "B", seedCaseId: "action-ready-t200", time: 2 }),
  Object.freeze({ label: "final.full.design.representative-replay", mode: "final", tier: "full", camera: "design", seed: CORPUS_REPRESENTATIVE_SEED, seedPhase: "A1", seedCaseId: "final-full-design", time: 0 }),
]);

export const CORPUS_CAPTURE_PLAN = Object.freeze(SCULPT_TARGET_IDS.flatMap((subjectId) => (
  STATE_TEMPLATES.map((template) => Object.freeze({
    filename: `${subjectId}.${template.label}.png`,
    state: Object.freeze({
      subjectId,
      mode: template.mode,
      tier: template.tier,
      camera: template.camera,
      seed: template.seed ?? CORPUS_REPRESENTATIVE_SEED,
      seedPhase: template.seedPhase ?? "representative",
      seedCaseId: template.seedCaseId ?? template.label,
      time: template.time,
    }),
  }))
)));
if (CORPUS_CAPTURE_PLAN.length !== 48) {
  throw new Error(`Object Sculptor correctness plan must contain exactly 48 source PNGs; received ${CORPUS_CAPTURE_PLAN.length}`);
}
for (const subjectId of SCULPT_TARGET_IDS) {
  const subjectCaptureCount = CORPUS_CAPTURE_PLAN.filter(({ state }) => state.subjectId === subjectId).length;
  if (subjectCaptureCount !== 16) throw new Error(`${subjectId} must contribute exactly 16 correctness PNGs; received ${subjectCaptureCount}`);
}

function subjectCaptureFilenames(fragment) {
  return Object.freeze(SCULPT_TARGET_IDS.map((subjectId) => `${subjectId}.${fragment}.png`));
}

export const CORPUS_STANDARD_OUTPUT_PLAN = Object.freeze([
  Object.freeze({ id: "final.design", status: "CAPTURED", filename: "final.design.png", sourceCaptures: subjectCaptureFilenames("final.full.design") }),
  Object.freeze({
    id: "no-post.design",
    status: "NOT_APPLICABLE",
    filename: null,
    reason: "The corpus has one direct forward scene pass and no post-processing graph.",
    graphProof: Object.freeze({ requiredPasses: Object.freeze(["forward-scene"]), requiredPostprocessing: false }),
  }),
  Object.freeze({
    id: "diagnostics.mosaic",
    status: "CAPTURED",
    filename: "diagnostics.mosaic.png",
    sourceCaptures: Object.freeze([
      "articulated-desk-lamp.blockout.full.design.png",
      "potted-bonsai.hierarchy.full.design.png",
      "ceramic-teapot.materials.full.close-material.png",
    ]),
  }),
  Object.freeze({ id: "camera.near", status: "CAPTURED", filename: "camera.near.png", sourceCaptures: subjectCaptureFilenames("final.full.close-material") }),
  Object.freeze({ id: "camera.design", status: "CAPTURED", filename: "camera.design.png", sourceCaptures: subjectCaptureFilenames("final.budgeted.design") }),
  Object.freeze({
    id: "camera.far",
    status: "NOT_APPLICABLE",
    filename: null,
    reason: "The authored corpus camera contract has design, profile, attachment, and close-material bookmarks but no far bookmark.",
    graphProof: Object.freeze({ authoredCameraIds: Object.freeze(["design", "profile", "attachment", "close-material"]), omittedCameraId: "far" }),
  }),
  Object.freeze({ id: "seed-0001.final", status: "CAPTURED", filename: "seed-0001.final.png", sourceCaptures: subjectCaptureFilenames("final.full.profile") }),
  Object.freeze({ id: "seed-9e3779b9.final", status: "CAPTURED", filename: "seed-9e3779b9.final.png", sourceCaptures: subjectCaptureFilenames("final.full.profile.stress-seed") }),
  Object.freeze({ id: "temporal.t000", status: "CAPTURED", filename: "temporal.t000.png", sourceCaptures: subjectCaptureFilenames("action-ready.full.design.t000") }),
  Object.freeze({ id: "temporal.t001", status: "CAPTURED", filename: "temporal.t001.png", sourceCaptures: subjectCaptureFilenames("action-ready.full.design.t200") }),
]);
export const outputPlan = CORPUS_STANDARD_OUTPUT_PLAN;

function captureFilename(subjectId, fragment) {
  const filename = `${subjectId}.${fragment}.png`;
  if (!CORPUS_CAPTURE_PLAN.some((entry) => entry.filename === filename)) throw new Error(`missing raster comparison capture ${filename}`);
  return filename;
}

function buildRasterComparisonPlan() {
  const records = [];
  for (const subjectId of SCULPT_TARGET_IDS) {
    for (const [caseId, a0Fragment, bFragment] of [
      ["final-full-design", "final.full.design", "final.full.design.stress-seed"],
      ["action-ready-t000", "action-ready.full.design.t000", "action-ready.full.design.stress-seed.t000"],
      ["action-ready-t200", "action-ready.full.design.t200", "action-ready.full.design.stress-seed.t200"],
    ]) {
      const a0 = captureFilename(subjectId, a0Fragment);
      const b = captureFilename(subjectId, bFragment);
      records.push(
        Object.freeze({ id: `raster-stress:${subjectId}:${caseId}`, kind: "stress", leftFilename: a0, rightFilename: b }),
      );
    }
    records.push(Object.freeze({
      id: `raster-replay:${subjectId}:final-full-design`,
      kind: "replay",
      leftFilename: captureFilename(subjectId, "final.full.design"),
      rightFilename: captureFilename(subjectId, "final.full.design.representative-replay"),
    }));
    records.push(
      Object.freeze({
        id: `raster-motion:${subjectId}:A0`,
        kind: "motion",
        leftFilename: captureFilename(subjectId, "action-ready.full.design.t000"),
        rightFilename: captureFilename(subjectId, "action-ready.full.design.t200"),
      }),
      Object.freeze({
        id: `raster-motion:${subjectId}:B`,
        kind: "motion",
        leftFilename: captureFilename(subjectId, "action-ready.full.design.stress-seed.t000"),
        rightFilename: captureFilename(subjectId, "action-ready.full.design.stress-seed.t200"),
      }),
    );
  }
  return records;
}

export const CORPUS_RASTER_COMPARISON_PLAN = Object.freeze(buildRasterComparisonPlan());

export function computeCorpusRasterComparisons(readPng) {
  if (typeof readPng !== "function") throw new TypeError("raster comparison requires a PNG byte reader");
  const decoded = new Map();
  const raster = (filename) => {
    if (!decoded.has(filename)) decoded.set(filename, decodePngRaster(readPng(filename)));
    return decoded.get(filename);
  };
  return Object.freeze(CORPUS_RASTER_COMPARISON_PLAN.map((plan) => {
    const left = raster(plan.leftFilename);
    const right = raster(plan.rightFilename);
    return Object.freeze({
      ...plan,
      leftRgbSha256: left.rgbSha256,
      rightRgbSha256: right.rgbSha256,
      ...comparePngRgb(left, right),
    });
  }));
}

function bytesView(value, label) {
  if (value === undefined || value === null) return null;
  if (Buffer.isBuffer(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new TypeError(`${label} must be byte-addressable`);
}

function artifactStem(filename) {
  if (typeof filename !== "string" || !/^[a-z0-9][a-z0-9._-]*\.png$/.test(filename)) {
    throw new Error(`invalid corpus artifact filename ${filename}`);
  }
  return filename.slice(0, -4);
}

async function readSessionArtifact(session, relativePath) {
  if (typeof session.readArtifact === "function") return Buffer.from(await session.readArtifact(relativePath));
  if (typeof session.outputDir !== "string" || session.outputDir.length === 0) {
    throw new Error(`capture session cannot read artifact ${relativePath}`);
  }
  return readFileSync(resolve(session.outputDir, relativePath));
}

async function writeSessionArtifact(session, relativePath, bytes) {
  const value = Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength);
  if (typeof session.writeArtifact === "function") {
    await session.writeArtifact(relativePath, value);
    return;
  }
  if (typeof session.outputDir !== "string" || session.outputDir.length === 0) {
    throw new Error(`capture session cannot write artifact ${relativePath}`);
  }
  const outputPath = resolve(session.outputDir, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, value);
}

function artifactReference(path, bytes) {
  return Object.freeze({
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

function normalizeSha256(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a SHA-256 string`);
  const match = /^(?:sha256:)?([a-f0-9]{64})$/.exec(value);
  if (!match) throw new Error(`${label} must be lowercase SHA-256 with an optional sha256: prefix`);
  return match[1];
}

function padCompactRgba(rgba, width, height, paddedBytesPerRow) {
  const packedBytesPerRow = width * 4;
  const padded = new Uint8Array(paddedBytesPerRow * height);
  for (let row = 0; row < height; row += 1) {
    padded.set(
      rgba.subarray(row * packedBytesPerRow, (row + 1) * packedBytesPerRow),
      row * paddedBytesPerRow,
    );
  }
  return padded;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Canonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function requireRaster(raster, label) {
  if (
    !raster
    || typeof raster !== "object"
    || !Number.isInteger(raster.width)
    || raster.width <= 0
    || !Number.isInteger(raster.height)
    || raster.height <= 0
    || !(raster.rgba instanceof Uint8Array)
    || raster.rgba.byteLength !== raster.width * raster.height * 4
  ) {
    throw new Error(`${label} must be a positive packed RGBA8 raster`);
  }
  return raster;
}

function resampleNearestCenterRgba(raster, destinationWidth, destinationHeight, label) {
  requireRaster(raster, label);
  const rgba = new Uint8Array(destinationWidth * destinationHeight * 4);
  for (let destinationY = 0; destinationY < destinationHeight; destinationY += 1) {
    const sourceY = Math.min(
      raster.height - 1,
      Math.floor(((destinationY + 0.5) * raster.height) / destinationHeight),
    );
    for (let destinationX = 0; destinationX < destinationWidth; destinationX += 1) {
      const sourceX = Math.min(
        raster.width - 1,
        Math.floor(((destinationX + 0.5) * raster.width) / destinationWidth),
      );
      const sourceOffset = (sourceY * raster.width + sourceX) * 4;
      const destinationOffset = (destinationY * destinationWidth + destinationX) * 4;
      rgba.set(raster.rgba.subarray(sourceOffset, sourceOffset + 4), destinationOffset);
    }
  }
  return rgba;
}

function composeStandardContactSheet(rasters, label) {
  if (!Array.isArray(rasters) || rasters.length !== CORPUS_STANDARD_RASTER_CONTRACT.panelCount) {
    throw new Error(`${label} needs exactly ${CORPUS_STANDARD_RASTER_CONTRACT.panelCount} source readbacks`);
  }
  const { width, height, panelWidth, panelHeight } = CORPUS_STANDARD_RASTER_CONTRACT;
  const rgba = new Uint8Array(width * height * 4);
  const panels = rasters.map((unvalidatedRaster, ordinal) => {
    const raster = requireRaster(unvalidatedRaster, `${label} source ${ordinal}`);
    const panel = resampleNearestCenterRgba(raster, panelWidth, panelHeight, `${label} source ${ordinal}`);
    const panelRect = Object.freeze({ x: ordinal * panelWidth, y: 0, width: panelWidth, height: panelHeight });
    for (let row = 0; row < panelHeight; row += 1) {
      rgba.set(
        panel.subarray(row * panelWidth * 4, (row + 1) * panelWidth * 4),
        ((row + panelRect.y) * width + panelRect.x) * 4,
      );
    }
    return Object.freeze({
      ordinal,
      sourceRect: Object.freeze({ x: 0, y: 0, width: raster.width, height: raster.height }),
      panelRect,
    });
  });
  assertMeaningfulRgbaRaster({ width, height, rgba }, label);
  return Object.freeze({ width, height, rgba, panels: Object.freeze(panels) });
}

export async function retainCorpusPixelEvidence(session, {
  filename,
  capture,
  derivedComposite = false,
} = {}) {
  if (!capture || typeof capture !== "object") throw new TypeError(`${filename} capture metadata is required`);
  const pngBytes = await readSessionArtifact(session, filename);
  const stem = artifactStem(filename);
  const normalizedSource = capture.normalized;
  if (!normalizedSource || typeof normalizedSource !== "object") {
    throw new Error(`${filename} must retain controller-derived normalized pixels independently of the PNG`);
  }
  const normalizedCompact = bytesView(normalizedSource.data, `${filename} normalized compact pixels`);
  const normalizedPadded = bytesView(normalizedSource.paddedData, `${filename} normalized padded pixels`);
  if (!normalizedCompact || !normalizedPadded) {
    throw new Error(`${filename} must retain both compact and padded normalized pixels`);
  }
  const normalizedLayout = normalizedSource.layout && typeof normalizedSource.layout === "object"
    ? normalizedSource.layout
    : {};
  const normalizedWidth = normalizedLayout.width ?? capture.width;
  const normalizedHeight = normalizedLayout.height ?? capture.height;
  const packedBytesPerRow = normalizedSource.compact?.bytesPerRow ?? capture.bytesPerRow ?? normalizedWidth * 4;
  const paddedBytesPerRow = normalizedSource.bytesPerRow ?? normalizedLayout.bytesPerRow;
  const paddedByteLength = normalizedSource.byteLength ?? normalizedLayout.byteLength;
  if (
    normalizedWidth !== capture.width
    || normalizedHeight !== capture.height
    || packedBytesPerRow !== normalizedWidth * 4
    || normalizedCompact.byteLength !== normalizedWidth * normalizedHeight * 4
  ) {
    throw new Error(`${filename} normalized compact layout is inconsistent with the capture dimensions`);
  }
  if (
    !Number.isInteger(paddedBytesPerRow)
    || paddedBytesPerRow < packedBytesPerRow
    || paddedBytesPerRow % 256 !== 0
    || paddedByteLength !== normalizedPadded.byteLength
    || (normalizedSource.alignmentBytes !== undefined && normalizedSource.alignmentBytes !== 256)
    || (typeof normalizedSource.layout === "string" && normalizedSource.layout !== "cpu-normalized-padded-rgba8")
  ) {
    throw new Error(`${filename} normalized padded layout is not an exact 256-byte-aligned artifact`);
  }
  const unpackedNormalized = unpackAlignedRows({
    source: normalizedPadded,
    width: normalizedWidth,
    height: normalizedHeight,
    bytesPerPixel: 4,
    bytesPerRow: paddedBytesPerRow,
  });
  if (!Buffer.from(unpackedNormalized).equals(Buffer.from(normalizedCompact))) {
    throw new Error(`${filename} normalized padded bytes do not unpack to the authoritative compact pixels`);
  }
  const normalizedOrigin = normalizedSource.origin ?? capture.origin;
  if (normalizedOrigin !== "top-left") {
    throw new Error(`${filename} normalized compact pixels must preserve the r185 top-left render-target origin`);
  }
  const normalizedOrientationTransform = normalizedSource.orientationTransform ?? capture.orientationTransform ?? "none";
  if (normalizedOrientationTransform !== "none") {
    throw new Error(`${filename} must not apply an origin flip to the r185 top-left render-target readback`);
  }
  const normalizedCompactSha256 = createHash("sha256").update(normalizedCompact).digest("hex");
  if (
    normalizedSource.compactRgbaSha256 !== undefined
    && normalizeSha256(normalizedSource.compactRgbaSha256, `${filename} normalized compact hash`) !== normalizedCompactSha256
  ) {
    throw new Error(`${filename} normalized compact hash does not match retained controller pixels`);
  }
  if (
    normalizedSource.compact?.sha256 !== undefined
    && normalizeSha256(normalizedSource.compact.sha256, `${filename} normalized compact descriptor hash`) !== normalizedCompactSha256
  ) {
    throw new Error(`${filename} normalized compact descriptor hash does not match retained controller pixels`);
  }
  if (
    normalizedSource.artifact?.byteLength !== undefined
    && normalizedSource.artifact.byteLength !== normalizedPadded.byteLength
  ) {
    throw new Error(`${filename} normalized padded artifact length does not match retained controller pixels`);
  }
  if (
    normalizedSource.artifact?.sha256 !== undefined
    && normalizeSha256(normalizedSource.artifact.sha256, `${filename} normalized padded artifact hash`)
      !== createHash("sha256").update(normalizedPadded).digest("hex")
  ) {
    throw new Error(`${filename} normalized padded hash does not match retained controller pixels`);
  }
  assertMeaningfulRgbaRaster({ width: normalizedWidth, height: normalizedHeight, rgba: normalizedCompact }, filename);
  const packedBinding = validatePngRgbaBinding(pngBytes, normalizedCompact, filename);
  if (packedBinding.width !== capture.width || packedBinding.height !== capture.height) {
    throw new Error(`${filename} PNG dimensions do not match capture metadata`);
  }
  const normalizedRetainedBySharedRunner = typeof normalizedSource.artifact?.path === "string";
  const normalizedPath = normalizedSource.artifact?.path ?? `normalized-readbacks/${stem}.rgba8.padded.bin`;
  if (
    normalizedRetainedBySharedRunner
    && (
      normalizedSource.artifact.byteLength !== normalizedPadded.byteLength
      || normalizeSha256(normalizedSource.artifact.sha256, `${filename} shared normalized artifact hash`)
        !== createHash("sha256").update(normalizedPadded).digest("hex")
    )
  ) {
    throw new Error(`${filename} shared normalized artifact reference does not bind the retained bytes`);
  }
  if (!normalizedRetainedBySharedRunner) await writeSessionArtifact(session, normalizedPath, normalizedPadded);
  const normalizedRawArtifact = artifactReference(normalizedPath, normalizedPadded);
  const normalizedPackedPath = `packed-readbacks/${stem}.rgba8.bin`;
  await writeSessionArtifact(session, normalizedPackedPath, normalizedCompact);
  const normalizedPackedArtifact = artifactReference(normalizedPackedPath, normalizedCompact);

  const transportSource = capture.transport ?? null;
  const transportLayout = transportSource?.layout ?? {};
  const transportBytes = bytesView(
    transportSource?.data ?? transportSource?.pixels ?? capture.transportData ?? null,
    `${filename} renderer transport`,
  );
  const transportByteLength = transportLayout.byteLength
    ?? capture.readbackSourceByteLength
    ?? null;
  if (transportBytes && transportByteLength !== null && transportBytes.byteLength !== transportByteLength) {
    throw new Error(`${filename} renderer transport bytes do not match the declared byte length`);
  }
  const transportOrigin = transportLayout.origin ?? capture.sourceOrigin ?? transportSource?.origin ?? null;
  let transportRawArtifact = null;
  let transportRetainedBySharedRunner = false;
  if (transportBytes) {
    transportRetainedBySharedRunner = typeof transportSource?.artifact?.path === "string";
    const transportPath = transportSource?.artifact?.path ?? `transport-readbacks/${stem}.rgba8.bin`;
    if (
      transportRetainedBySharedRunner
      && (
        transportSource.artifact.byteLength !== transportBytes.byteLength
        || normalizeSha256(transportSource.artifact.sha256, `${filename} shared transport artifact hash`)
          !== createHash("sha256").update(transportBytes).digest("hex")
      )
    ) {
      throw new Error(`${filename} shared transport artifact reference does not bind the retained bytes`);
    }
    if (!transportRetainedBySharedRunner) await writeSessionArtifact(session, transportPath, transportBytes);
    transportRawArtifact = artifactReference(transportPath, transportBytes);
    if (
      transportSource?.artifact?.sha256
      && normalizeSha256(transportSource.artifact.sha256, `${filename} renderer transport artifact hash`)
        !== transportRawArtifact.sha256
    ) {
      throw new Error(`${filename} renderer transport hash does not match retained bytes`);
    }
    if (
      transportSource?.artifact?.byteLength !== undefined
      && transportSource.artifact.byteLength !== transportBytes.byteLength
    ) {
      throw new Error(`${filename} renderer transport artifact length does not match retained bytes`);
    }
  } else if (!derivedComposite) {
    throw new Error(`${filename} must retain the exact renderer transport bytes`);
  }
  if (!derivedComposite && transportOrigin !== "top-left") {
    throw new Error(`${filename} renderer transport must preserve the r185 top-left render-target origin`);
  }

  return Object.freeze({
    transport: Object.freeze({
      width: transportLayout.width ?? capture.width,
      height: transportLayout.height ?? capture.height,
      format: transportLayout.format ?? capture.sourceFormat ?? null,
      origin: transportOrigin,
      bytesPerPixel: transportLayout.bytesPerPixel ?? capture.bytesPerPixel ?? 4,
      bytesPerRow: transportLayout.bytesPerRow
        ?? capture.readbackSourceBytesPerRow
        ?? null,
      byteLength: transportByteLength,
      rawArtifact: transportRawArtifact,
      producerOwner: transportRawArtifact
        ? transportRetainedBySharedRunner
          ? "shared-capture-runner"
          : "object-sculptor-capture-hook"
        : "not-applicable-derived-output",
      retentionStatus: derivedComposite
        ? "not-applicable-derived-composite"
        : transportRawArtifact
          ? "retained"
          : "metadata-only",
    }),
    normalized: Object.freeze({
      alignmentBytes: 256,
      layout: "cpu-normalized-padded-rgba8",
      paddedBytesPerRow,
      paddedByteLength: normalizedPadded.byteLength,
      rawArtifact: normalizedRawArtifact,
      packedArtifact: normalizedPackedArtifact,
      producerOwner: normalizedRetainedBySharedRunner
        ? "shared-capture-runner"
        : "object-sculptor-capture-hook",
      packedArtifactProducerOwner: "object-sculptor-capture-hook",
      packedRgbaSha256: packedBinding.packedRgbaSha256,
      packedByteLength: packedBinding.packedByteLength,
      origin: normalizedOrigin,
      orientationTransform: normalizedOrientationTransform,
    }),
    png: Object.freeze({
      ...artifactReference(filename, pngBytes),
      producerOwner: derivedComposite
        ? "object-sculptor-capture-hook"
        : "shared-capture-runner",
      decodedRgbaSha256: packedBinding.decodedRgbaSha256,
      derivedFromPackedRgbaSha256: packedBinding.packedRgbaSha256,
    }),
  });
}

export function computeCorpusStandardDerivationSha256(derivation) {
  if (!derivation || typeof derivation !== "object" || Array.isArray(derivation)) {
    throw new TypeError("standard-output derivation must be an object");
  }
  return sha256Canonical(derivation);
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be lowercase SHA-256`);
  }
  return value;
}

function derivationSourceRecord(sourceByFilename, filename) {
  const source = sourceByFilename instanceof Map
    ? sourceByFilename.get(filename)
    : sourceByFilename?.[filename];
  if (!source || typeof source !== "object") throw new Error(`standard-output derivation has no source evidence for ${filename}`);
  return source;
}

export function validateCorpusStandardDerivation(record, sourceByFilename) {
  if (!record || typeof record !== "object" || record.status !== "CAPTURED") {
    throw new TypeError("captured standard-output record is required");
  }
  const plan = CORPUS_STANDARD_OUTPUT_PLAN.find(({ id }) => id === record.id);
  if (!plan || plan.status !== "CAPTURED" || plan.filename !== record.filename) {
    throw new Error(`${record.id ?? "unknown"} is not a canonical captured standard output`);
  }
  const derivation = record.derivation;
  if (!derivation || typeof derivation !== "object" || Array.isArray(derivation)) {
    throw new Error(`${record.filename} must publish a derivation graph`);
  }
  const expectedDerivationSha256 = computeCorpusStandardDerivationSha256(derivation);
  if (record.derivationSha256 !== expectedDerivationSha256) {
    throw new Error(`${record.filename} derivation graph hash mismatch`);
  }
  if (derivation.schemaVersion !== 1 || derivation.kind !== "three-panel-native-readback-contact-sheet") {
    throw new Error(`${record.filename} derivation graph identity mismatch`);
  }
  const expectedLayout = {
    direction: "horizontal",
    panelCount: CORPUS_STANDARD_RASTER_CONTRACT.panelCount,
    equalWidth: true,
    panelWidth: CORPUS_STANDARD_RASTER_CONTRACT.panelWidth,
    panelHeight: CORPUS_STANDARD_RASTER_CONTRACT.panelHeight,
    gapPixels: 0,
    syntheticFillPixels: 0,
  };
  const expectedResampling = {
    sourcePolicy: CORPUS_STANDARD_RASTER_CONTRACT.sourcePolicy,
    cropPolicy: CORPUS_STANDARD_RASTER_CONTRACT.cropPolicy,
    kernel: CORPUS_STANDARD_RASTER_CONTRACT.resamplingKernel,
    coordinateRule: CORPUS_STANDARD_RASTER_CONTRACT.coordinateRule,
    edgeMode: CORPUS_STANDARD_RASTER_CONTRACT.edgeMode,
    colorDomain: CORPUS_STANDARD_RASTER_CONTRACT.colorDomain,
  };
  if (canonicalJson(derivation.layout) !== canonicalJson(expectedLayout)) {
    throw new Error(`${record.filename} panel layout differs from the canonical 1200x800 contract`);
  }
  if (canonicalJson(derivation.resampling) !== canonicalJson(expectedResampling)) {
    throw new Error(`${record.filename} resampling kernel or policy differs from the canonical contract`);
  }
  if (!Array.isArray(derivation.inputs) || derivation.inputs.length !== plan.sourceCaptures.length) {
    throw new Error(`${record.filename} derivation inputs do not cover all three native source captures`);
  }
  const claimedArtifactPaths = new Set([record.filename]);
  const claimDistinctArtifactPath = (path, label) => {
    if (typeof path !== "string" || path.length === 0) throw new Error(`${label} path is missing`);
    if (claimedArtifactPaths.has(path)) throw new Error(`${label} duplicates or aliases another derivation artifact path`);
    claimedArtifactPaths.add(path);
  };
  for (let ordinal = 0; ordinal < plan.sourceCaptures.length; ordinal += 1) {
    const capturePath = plan.sourceCaptures[ordinal];
    const input = derivation.inputs[ordinal];
    const source = derivationSourceRecord(sourceByFilename, capturePath);
    const sourcePixelEvidence = source.pixelEvidence;
    const subjectId = source.subjectId ?? source.state?.subjectId ?? null;
    const expectedSourceRect = { x: 0, y: 0, width: source.width, height: source.height };
    const expectedPanelRect = {
      x: ordinal * CORPUS_STANDARD_RASTER_CONTRACT.panelWidth,
      y: 0,
      width: CORPUS_STANDARD_RASTER_CONTRACT.panelWidth,
      height: CORPUS_STANDARD_RASTER_CONTRACT.panelHeight,
    };
    if (
      !input
      || input.ordinal !== ordinal
      || input.subjectId !== subjectId
      || input.capturePath !== capturePath
      || input.capturePngProducer !== "shared-capture-runner"
      || input.normalizedRawArtifactProducer !== "shared-capture-runner"
      || input.rendererTransportArtifactProducer !== "shared-capture-runner"
      || canonicalJson(input.sourceRect) !== canonicalJson(expectedSourceRect)
      || canonicalJson(input.panelRect) !== canonicalJson(expectedPanelRect)
    ) {
      throw new Error(`${record.filename} input ${ordinal} path or panel rectangle mismatch`);
    }
    claimDistinctArtifactPath(input.capturePath, `${record.filename} input ${ordinal} PNG`);
    claimDistinctArtifactPath(input.normalizedRawArtifactPath, `${record.filename} input ${ordinal} normalized raw artifact`);
    claimDistinctArtifactPath(input.normalizedPackedArtifactPath, `${record.filename} input ${ordinal} normalized packed artifact`);
    claimDistinctArtifactPath(input.rendererTransportArtifactPath, `${record.filename} input ${ordinal} transport artifact`);
    if (
      input.capturePngSha256 !== requireSha256(sourcePixelEvidence?.png?.sha256, `${capturePath} PNG hash`)
      || input.normalizedPackedRgbaSha256 !== requireSha256(sourcePixelEvidence?.normalized?.packedRgbaSha256, `${capturePath} packed RGBA hash`)
      || input.normalizedRawArtifactPath !== sourcePixelEvidence?.normalized?.rawArtifact?.path
      || input.normalizedRawArtifactSha256 !== requireSha256(sourcePixelEvidence?.normalized?.rawArtifact?.sha256, `${capturePath} normalized raw hash`)
      || input.normalizedPackedArtifactPath !== sourcePixelEvidence?.normalized?.packedArtifact?.path
      || input.normalizedPackedArtifactSha256 !== requireSha256(sourcePixelEvidence?.normalized?.packedArtifact?.sha256, `${capturePath} normalized packed artifact hash`)
      || input.normalizedPackedArtifactProducer !== "object-sculptor-capture-hook"
      || input.rendererTransportArtifactPath !== sourcePixelEvidence?.transport?.rawArtifact?.path
      || input.rendererTransportArtifactSha256 !== requireSha256(sourcePixelEvidence?.transport?.rawArtifact?.sha256, `${capturePath} renderer transport hash`)
    ) {
      throw new Error(`${record.filename} input ${ordinal} hash binding mismatch`);
    }
  }
  const expectedOutput = {
    path: record.filename,
    width: CORPUS_STANDARD_RASTER_CONTRACT.width,
    height: CORPUS_STANDARD_RASTER_CONTRACT.height,
    normalizedPackedRgbaSha256: requireSha256(record.pixelEvidence?.normalized?.packedRgbaSha256, `${record.filename} output packed RGBA hash`),
    pngSha256: requireSha256(record.pixelEvidence?.png?.sha256, `${record.filename} output PNG hash`),
    producer: "object-sculptor-capture-hook",
  };
  if (canonicalJson(derivation.output) !== canonicalJson(expectedOutput)) {
    throw new Error(`${record.filename} derivation output dimensions or hash mismatch`);
  }
  return true;
}

async function writeCorpusComposite(session, output, rasterByFilename) {
  const rasters = output.sourceCaptures.map((filename) => {
    const raster = rasterByFilename.get(filename);
    if (!raster) throw new Error(`${output.filename} references uncaptured source ${filename}`);
    return raster;
  });
  const composite = composeStandardContactSheet(rasters, output.id);
  const pngBytes = encodeRgbaPng({
    width: composite.width,
    height: composite.height,
    data: composite.rgba,
  });
  await writeSessionArtifact(session, output.filename, pngBytes);
  const compositePaddedBytesPerRow = alignedBytesPerRow(composite.width, 4);
  const compositePadded = padCompactRgba(
    composite.rgba,
    composite.width,
    composite.height,
    compositePaddedBytesPerRow,
  );
  const pixelEvidence = await retainCorpusPixelEvidence(session, {
    filename: output.filename,
    capture: {
      width: composite.width,
      height: composite.height,
      bytesPerPixel: 4,
      bytesPerRow: composite.width * 4,
      format: "rgba8",
      origin: "top-left",
      orientationTransform: "none",
      normalized: {
        layout: "cpu-normalized-padded-rgba8",
        alignmentBytes: 256,
        bytesPerRow: compositePaddedBytesPerRow,
        byteLength: compositePadded.byteLength,
        origin: "top-left",
        orientationTransform: "none",
        compact: {
          bytesPerRow: composite.width * 4,
          byteLength: composite.rgba.byteLength,
        },
        compactRgbaSha256: createHash("sha256").update(composite.rgba).digest("hex"),
        data: composite.rgba,
        paddedData: compositePadded,
      },
    },
    derivedComposite: true,
  });
  const inputs = Object.freeze(rasters.map((raster, ordinal) => Object.freeze({
    ordinal,
    subjectId: raster.subjectId,
    capturePath: raster.filename,
    capturePngSha256: raster.pixelEvidence.png.sha256,
    capturePngProducer: raster.pixelEvidence.png.producerOwner,
    normalizedPackedRgbaSha256: raster.pixelEvidence.normalized.packedRgbaSha256,
    normalizedRawArtifactPath: raster.pixelEvidence.normalized.rawArtifact.path,
    normalizedRawArtifactSha256: raster.pixelEvidence.normalized.rawArtifact.sha256,
    normalizedRawArtifactProducer: raster.pixelEvidence.normalized.producerOwner,
    normalizedPackedArtifactPath: raster.pixelEvidence.normalized.packedArtifact.path,
    normalizedPackedArtifactSha256: raster.pixelEvidence.normalized.packedArtifact.sha256,
    normalizedPackedArtifactProducer: raster.pixelEvidence.normalized.packedArtifactProducerOwner,
    rendererTransportArtifactPath: raster.pixelEvidence.transport.rawArtifact.path,
    rendererTransportArtifactSha256: raster.pixelEvidence.transport.rawArtifact.sha256,
    rendererTransportArtifactProducer: raster.pixelEvidence.transport.producerOwner,
    sourceRect: composite.panels[ordinal].sourceRect,
    panelRect: composite.panels[ordinal].panelRect,
  })));
  const derivation = Object.freeze({
    schemaVersion: 1,
    kind: "three-panel-native-readback-contact-sheet",
    inputs,
    layout: Object.freeze({
      direction: "horizontal",
      panelCount: CORPUS_STANDARD_RASTER_CONTRACT.panelCount,
      equalWidth: true,
      panelWidth: CORPUS_STANDARD_RASTER_CONTRACT.panelWidth,
      panelHeight: CORPUS_STANDARD_RASTER_CONTRACT.panelHeight,
      gapPixels: 0,
      syntheticFillPixels: 0,
    }),
    resampling: Object.freeze({
      sourcePolicy: CORPUS_STANDARD_RASTER_CONTRACT.sourcePolicy,
      cropPolicy: CORPUS_STANDARD_RASTER_CONTRACT.cropPolicy,
      kernel: CORPUS_STANDARD_RASTER_CONTRACT.resamplingKernel,
      coordinateRule: CORPUS_STANDARD_RASTER_CONTRACT.coordinateRule,
      edgeMode: CORPUS_STANDARD_RASTER_CONTRACT.edgeMode,
      colorDomain: CORPUS_STANDARD_RASTER_CONTRACT.colorDomain,
    }),
    output: Object.freeze({
      path: output.filename,
      width: composite.width,
      height: composite.height,
      normalizedPackedRgbaSha256: pixelEvidence.normalized.packedRgbaSha256,
      pngSha256: pixelEvidence.png.sha256,
      producer: pixelEvidence.png.producerOwner,
    }),
  });
  const result = Object.freeze({
    id: output.id,
    status: output.status,
    filename: output.filename,
    file: pixelEvidence.png,
    sourceCaptures: output.sourceCaptures,
    composition: Object.freeze({
      kind: "derived-three-panel-native-readback-contact-sheet",
      resampling: CORPUS_STANDARD_RASTER_CONTRACT.resamplingKernel,
      byteForByteNativeBinding: false,
      nativeTransportBinding: "not-applicable-derived-output",
      syntheticFillPixels: 0,
    }),
    derivation,
    derivationSha256: computeCorpusStandardDerivationSha256(derivation),
    pixelEvidence,
  });
  validateCorpusStandardDerivation(result, rasterByFilename);
  return result;
}

async function buildCorpusStandardOutputs(session, rasterByFilename, pipeline) {
  const outputs = [];
  for (const output of CORPUS_STANDARD_OUTPUT_PLAN) {
    if (output.status === "CAPTURED") {
      outputs.push(await writeCorpusComposite(session, output, rasterByFilename));
      continue;
    }
    const graphProof = output.id === "no-post.design"
      ? Object.freeze({
        pipelineOwner: pipeline.owner,
        sceneRendersPerFrame: pipeline.sceneRendersPerFrame,
        postProcessPasses: pipeline.postprocessing === false ? 0 : null,
      })
      : Object.freeze({
        cameraContractOwner: "CORPUS_CAMERAS",
        availableCameraIds: Object.freeze(["design", "profile", "attachment", "close-material"]),
        omittedCameraId: "far",
      });
    outputs.push(Object.freeze({ ...output, graphProof }));
  }
  const byId = new Map(outputs.map((output) => [output.id, output]));
  const finalBytes = await readSessionArtifact(session, byId.get("final.design").filename);
  const diagnosticsBytes = await readSessionArtifact(session, byId.get("diagnostics.mosaic").filename);
  assertDistinctPngRasters(finalBytes, diagnosticsBytes, "final/diagnostics", { minimumChangedPixelRatio: 0.01 });
  const temporalStartBytes = await readSessionArtifact(session, byId.get("temporal.t000").filename);
  const temporalEndBytes = await readSessionArtifact(session, byId.get("temporal.t001").filename);
  assertDistinctPngRasters(temporalStartBytes, temporalEndBytes, "temporal endpoints", { minimumChangedPixelRatio: 0.001 });
  const standardRasterOwnerByHash = new Map();
  for (const output of outputs.filter(({ status }) => status === "CAPTURED")) {
    const raster = decodePngRaster(await readSessionArtifact(session, output.filename));
    const key = `${raster.width}x${raster.height}:${raster.rgbaSha256}`;
    const previous = standardRasterOwnerByHash.get(key);
    if (previous) throw new Error(`${output.filename} duplicates standard output ${previous}`);
    standardRasterOwnerByHash.set(key, output.filename);
  }
  return Object.freeze(outputs);
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function normalizedColorSpace(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSrgb(value) {
  return new Set(["srgb", "srgbcolorspace"]).has(normalizedColorSpace(value));
}

export function validateCorpusCaptureMetadata(capture, pipeline) {
  if (!capture || typeof capture !== "object") throw new TypeError("corpus capture metadata must be an object");
  if (!pipeline || typeof pipeline !== "object") throw new TypeError("corpus pipeline metadata must be an object");
  const width = requirePositiveInteger(capture.width, "capture width");
  const height = requirePositiveInteger(capture.height, "capture height");
  const packedBytesPerRow = width * 4;
  if (capture.bytesPerPixel !== 4 || capture.bytesPerRow !== packedBytesPerRow) {
    throw new Error("corpus capture must expose compact byte-addressed RGBA8 rows");
  }
  const transportLayout = capture.transport?.layout;
  const normalizedLayout = capture.normalized;
  if (!transportLayout || typeof transportLayout !== "object" || !normalizedLayout || typeof normalizedLayout !== "object") {
    throw new Error("corpus capture must expose independent transport and normalized readback records");
  }
  const transportBytesPerRow = requirePositiveInteger(transportLayout.bytesPerRow, "capture transport bytesPerRow");
  const transportByteLength = requirePositiveInteger(transportLayout.byteLength, "capture transport byteLength");
  if (transportBytesPerRow < packedBytesPerRow) {
    throw new Error("corpus capture transport stride is smaller than one RGBA8 row");
  }
  const shortTransportByteLength = transportBytesPerRow * (height - 1) + packedBytesPerRow;
  const fullTransportByteLength = transportBytesPerRow * height;
  if (transportByteLength !== shortTransportByteLength && transportByteLength !== fullTransportByteLength) {
    throw new Error("corpus capture transport byteLength does not match its renderer-returned row stride");
  }
  if (capture.transportByteLength !== undefined && capture.transportByteLength !== transportByteLength) {
    throw new Error("corpus capture top-level transport length drifted from its retained transport record");
  }
  const normalizedPaddedBytesPerRow = requirePositiveInteger(normalizedLayout.bytesPerRow, "capture normalized bytesPerRow");
  const normalizedPaddedByteLength = requirePositiveInteger(normalizedLayout.byteLength, "capture normalized byteLength");
  if (
    normalizedPaddedBytesPerRow < packedBytesPerRow
    || normalizedPaddedBytesPerRow % 256 !== 0
    || normalizedPaddedByteLength !== normalizedPaddedBytesPerRow * height
  ) {
    throw new Error("corpus capture normalized artifact must use exact fully padded 256-byte rows");
  }
  if (transportLayout.origin !== "top-left" || normalizedLayout.origin !== "top-left" || normalizedLayout.orientationTransform !== "none") {
    throw new Error("corpus r185 capture requires top-left transport/normalized origins with no orientation transform");
  }
  if (capture.format !== "rgba8") throw new Error(`corpus capture must normalize to rgba8, received ${capture.format}`);
  if (!isSrgb(capture.colorEncoding) || !isSrgb(pipeline.outputColorSpace)) {
    throw new Error("corpus capture and renderer output must both preserve explicit sRGB metadata");
  }
  return Object.freeze({
    ...capture,
    packedBytesPerRow,
    transportBytesPerRow,
    transportByteLength,
    normalizedPaddedBytesPerRow,
    normalizedPaddedByteLength,
    sourceRowStride: transportBytesPerRow,
    outputColorSpace: pipeline.outputColorSpace,
    captureSource: "native-webgpu-render-target-readback",
  });
}

function requireNativeBackend(metrics, pipeline) {
  const backend = String(metrics?.backend ?? metrics?.backendKind ?? "").toLowerCase();
  if (metrics?.nativeWebGPU !== true || backend !== "webgpu") {
    throw new Error("capture requires explicit native WebGPU backend proof");
  }
  if (metrics?.initialized !== true || metrics?.firstFrameCompleted !== true || metrics?.lastFrameError !== null) {
    throw new Error("capture requires an initialized, completed, error-free native WebGPU frame");
  }
  if (
    pipeline?.owner !== "WebGPURenderer"
    || pipeline?.sceneRendersPerFrame !== 1
    || pipeline?.finalOutputOwner !== "renderer"
    || !isSrgb(pipeline?.outputColorSpace)
  ) {
    throw new Error("capture requires one WebGPURenderer scene owner and one explicit sRGB output owner");
  }
}

function assertAppliedState(metrics, state) {
  const actualSubject = metrics.subjectId ?? metrics.scenario;
  for (const [label, actual, expected] of [
    ["subject", actualSubject, state.subjectId],
    ["mode", metrics.mode, state.mode],
    ["tier", metrics.tier, state.tier],
    ["camera", metrics.camera, state.camera],
    ["seed", metrics.seed, state.seed],
  ]) {
    if (actual !== expected) throw new Error(`capture ${label} drifted: expected ${expected}, received ${actual}`);
  }
  if (!Number.isFinite(metrics.time) || Math.abs(metrics.time - state.time) > 1e-9) {
    throw new Error(`capture time drifted: expected ${state.time}, received ${metrics.time}`);
  }
}

async function configureState(session, state) {
  await session.controllerCall("setSubject", state.subjectId);
  await session.controllerCall("setTier", state.tier);
  await session.controllerCall("setSeed", state.seed);
  await session.controllerCall("setCamera", state.camera);
  await session.controllerCall("setMode", state.mode);
  await session.controllerCall("setTime", state.time);
}

function runtimeStateEvidence(metrics) {
  return Object.freeze({
    subjectId: metrics.subjectId ?? metrics.scenario,
    mode: metrics.mode,
    tier: metrics.tier,
    camera: metrics.camera,
    seed: metrics.seed,
    time: metrics.time,
    backend: metrics.backend ?? metrics.backendKind,
    nativeWebGPU: metrics.nativeWebGPU,
    initialized: metrics.initialized,
    firstFrameCompleted: metrics.firstFrameCompleted,
    renderSubmissions: metrics.renderSubmissions,
    completedFrames: metrics.completedFrames,
    lastFrameError: metrics.lastFrameError,
  });
}

export async function captureLab(session) {
  if (!session || typeof session.controllerCall !== "function" || typeof session.writeCapture !== "function") {
    throw new TypeError("corpus capture hook requires controllerCall() and writeCapture()");
  }
  const url = new URL(session.url);
  const evidenceRunId = typeof session.evidenceRunId === "string" && session.evidenceRunId.length > 0
    ? session.evidenceRunId
    : `corpus-${randomUUID()}`;
  const frameOwner = objectSculptorCorpusFrameOwner(url.search);
  if (frameOwner !== "capture-harness") {
    throw new Error("corpus evidence capture must exclusively own frames through ?capture=1");
  }

  let initialMetrics = await session.controllerCall("getMetrics");
  if (initialMetrics.firstFrameCompleted !== true) {
    await session.controllerCall("renderOnce");
    initialMetrics = await session.controllerCall("getMetrics");
  }
  const initialPipeline = await session.controllerCall("describePipeline");
  requireNativeBackend(initialMetrics, initialPipeline);
  const sourceClosure = computeCorpusExecutableSourceClosure();
  const rendererReportedThreeRevision = String(initialMetrics.rendererInfo?.threeRevision ?? "");
  if (!new Set(["185", sourceClosure.threeRevision]).has(rendererReportedThreeRevision)) {
    throw new Error(`capture renderer revision ${rendererReportedThreeRevision || "missing"} does not match ${sourceClosure.threeRevision}`);
  }

  const captures = [];
  const targetMasks = [];
  const rasterByFilename = new Map();
  const standardSourceFilenames = new Set(CORPUS_STANDARD_OUTPUT_PLAN
    .filter(({ status }) => status === "CAPTURED")
    .flatMap(({ sourceCaptures }) => sourceCaptures));
  const tierContracts = Object.fromEntries(SCULPT_TARGET_IDS.map((id) => [id, {}]));
  for (const { filename, state } of CORPUS_CAPTURE_PLAN) {
    await configureState(session, state);
    let capture;
    try {
      capture = await session.writeCapture(filename, "presentation");
    } catch (error) {
      throw new Error(`native readback failed for ${filename}: ${error?.message ?? String(error)}`, { cause: error });
    }
    const metrics = await session.controllerCall("getMetrics");
    const pipeline = await session.controllerCall("describePipeline");
    const runtimeContract = await session.controllerCall("getRuntimeContract");
    requireNativeBackend(metrics, pipeline);
    assertAppliedState(metrics, state);
    const normalized = validateCorpusCaptureMetadata(capture, pipeline);
    const pixelEvidence = await retainCorpusPixelEvidence(session, { filename, capture });
    if (standardSourceFilenames.has(filename)) {
      const sourceRgba = bytesView(capture.normalized?.data, `${filename} standard-source normalized pixels`);
      if (!sourceRgba) throw new Error(`${filename} standard-source normalized pixels are unavailable`);
      rasterByFilename.set(filename, Object.freeze({
        filename,
        subjectId: state.subjectId,
        width: capture.width,
        height: capture.height,
        rgba: new Uint8Array(sourceRgba),
        pixelEvidence,
      }));
    }
    const {
      data: _discardPackedData,
      pixels: _discardPixelAlias,
      transport: _discardTransportBytes,
      normalized: _discardNormalizedBytes,
      ...normalizedMetadata
    } = normalized;
    captures.push(Object.freeze({
      filename,
      state,
      ...normalizedMetadata,
      file: pixelEvidence.png,
      pixelEvidence,
      runtimeState: runtimeStateEvidence(metrics),
      identityEvidence: Object.freeze({
        instanceId: runtimeContract.instanceId ?? null,
        instanceGeneration: runtimeContract.instanceGeneration ?? null,
        previousGeneration: runtimeContract.continuityEvidence?.previousGeneration ?? runtimeContract.continuity?.previousGeneration ?? null,
        continuityStatus: runtimeContract.continuityStatus ?? runtimeContract.continuity?.status ?? null,
        effectiveToken: runtimeContract.continuityEvidence?.effectiveToken ?? runtimeContract.continuity?.token ?? null,
        nodeIds: runtimeContract.nodeIds,
        socketIds: runtimeContract.socketIds,
        colliderIds: runtimeContract.colliderIds,
        destructionGroupIds: runtimeContract.destructionGroupIds,
        protectedNodeIds: runtimeContract.protectedNodeIds,
        protectedSocketIds: runtimeContract.protectedSocketIds,
        protectedColliderIds: runtimeContract.protectedColliderIds,
        protectedDestructionGroupIds: runtimeContract.protectedDestructionGroupIds,
      }),
    }));
    if (
      state.mode === "final"
      && state.camera === "design"
      && state.time === 0
      && state.seed === CORPUS_REPRESENTATIVE_SEED
    ) {
      tierContracts[state.subjectId][state.tier] = await session.controllerCall("getRuntimeContract");
    }
  }

  for (const plan of CORPUS_TARGET_MASK_PLAN) {
    const state = {
      subjectId: plan.subjectId,
      mode: plan.mode,
      tier: plan.tier,
      camera: plan.camera,
      seed: plan.seed,
      time: plan.time,
    };
    await configureState(session, state);
    let capture;
    try {
      capture = await session.writeCapture(plan.filename, "target-mask");
    } catch (error) {
      throw new Error(`native target-mask readback failed for ${plan.filename}: ${error?.message ?? String(error)}`, { cause: error });
    }
    const metrics = await session.controllerCall("getMetrics");
    const pipeline = await session.controllerCall("describePipeline");
    requireNativeBackend(metrics, pipeline);
    assertAppliedState(metrics, state);
    if (capture.maskKind !== plan.maskKind) throw new Error(`${plan.filename} mask kind drifted: expected ${plan.maskKind}, received ${capture.maskKind}`);
    if (plan.maskKind === "named-moving-semantic-regions" && (!Array.isArray(capture.semanticNodeIds) || capture.semanticNodeIds.length === 0)) {
      throw new Error(`${plan.filename} must bind at least one named moving semantic node`);
    }
    const normalized = validateCorpusCaptureMetadata(capture, pipeline);
    const pixelEvidence = await retainCorpusPixelEvidence(session, { filename: plan.filename, capture });
    const decoded = decodePngRaster(await readSessionArtifact(session, plan.filename));
    const binary = decodeBinaryTargetMask({ width: decoded.width, height: decoded.height, rgba: decoded.rgba }, plan.filename);
    const { data: _discardPackedData, pixels: _discardPixelAlias, transport: _discardTransportBytes, normalized: _discardNormalizedBytes, ...normalizedMetadata } = normalized;
    targetMasks.push(Object.freeze({
      ...plan,
      ...normalizedMetadata,
      semanticNodeIds: Object.freeze([...(capture.semanticNodeIds ?? [])]),
      selectedPixels: binary.selectedPixels,
      file: pixelEvidence.png,
      pixelEvidence,
      runtimeState: runtimeStateEvidence(metrics),
    }));
  }

  await configureState(session, {
    subjectId: "potted-bonsai",
    mode: "action-ready",
    tier: "budgeted",
    camera: "design",
    seed: 1,
    time: 0,
  });
  await session.controllerCall("renderOnce");

  const standardOutputs = await buildCorpusStandardOutputs(session, rasterByFilename, initialPipeline);
  const subjectFinals = Object.freeze(captures.filter(({ state }) => (
    state.mode === "final"
    && state.tier === "full"
    && state.camera === "design"
    && state.seed === CORPUS_REPRESENTATIVE_SEED
    && state.seedPhase === "A0"
    && state.time === 0
  )).map(({ filename, state, file, pixelEvidence }) => Object.freeze({
    subjectId: state.subjectId,
    filename,
    file,
    pixelEvidence,
  })));
  if (subjectFinals.length !== SCULPT_TARGET_IDS.length) {
    throw new Error("capture did not produce exactly one representative final readback per corpus subject");
  }

  const rasterComparisons = typeof session.outputDir === "string" && session.outputDir.length > 0
    ? computeCorpusRasterComparisons((filename) => readFileSync(resolve(session.outputDir, filename)))
    : Object.freeze([]);

  return Object.freeze({
    schemaVersion: 2,
    evidenceRunId,
    sourceClosure,
    captures: Object.freeze(captures),
    targetMaskPlan: CORPUS_TARGET_MASK_PLAN,
    targetMasks: Object.freeze(targetMasks),
    subjectFinals,
    standardOutputs,
    tierContracts: Object.freeze(tierContracts),
    backendProof: Object.freeze({
      backend: initialMetrics.backend ?? initialMetrics.backendKind,
      nativeWebGPU: initialMetrics.nativeWebGPU,
      initialized: initialMetrics.initialized,
      firstFrameCompleted: initialMetrics.firstFrameCompleted,
      rendererType: initialMetrics.rendererInfo?.rendererType ?? null,
      backendType: initialMetrics.rendererInfo?.backendType ?? null,
      threeRevision: sourceClosure.threeRevision,
      rendererReportedThreeRevision,
      adapterClass: initialMetrics.adapterClass ?? initialMetrics.rendererInfo?.adapterClass ?? "unknown",
      adapterIdentity: initialMetrics.adapterIdentity ?? initialMetrics.rendererInfo?.adapterIdentity ?? null,
      pipelineOwner: initialPipeline.owner,
      sceneRendersPerFrame: initialPipeline.sceneRendersPerFrame,
      finalOutputOwner: initialPipeline.finalOutputOwner,
      outputColorSpace: initialPipeline.outputColorSpace,
    }),
    frameOwnership: Object.freeze({
      owner: frameOwner,
      livePageFrameLoop: "disabled-by-capture-route",
      captureQuery: url.searchParams.get("capture"),
    }),
    physicalRoutePlan: CORPUS_PHYSICAL_ROUTE_PLAN,
    rasterComparisonPlan: CORPUS_RASTER_COMPARISON_PLAN,
    rasterComparisons,
    evidenceStatus: "INSUFFICIENT_EVIDENCE",
    note: "Native WebGPU source captures retain renderer transport and CPU-normalized layouts as separate records and bind each source PNG to retained RGBA bytes. Standard 1200x800 contact sheets are explicitly derived through hash-bound panel rectangles and deterministic resampling; they do not claim byte-for-byte renderer transport. The bundle remains insufficient without direct visual review, sustained hardware timing, resource, and lifecycle evidence.",
  });
}

export default captureLab;
