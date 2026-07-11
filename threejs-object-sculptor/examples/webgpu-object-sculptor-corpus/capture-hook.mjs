import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SCULPT_TARGET_IDS } from "./object-catalog.js";
import { objectSculptorCorpusFrameOwner } from "./frame-driver.js";
import { comparePngRgb, decodePngRaster } from "./png-raster.mjs";
import { CORPUS_PHYSICAL_ROUTE_PLAN } from "./validate-routes.mjs";

export const CORPUS_REPRESENTATIVE_SEED = 1;
export const CORPUS_STRESS_SEED = 2654435769;
export const CORPUS_RASTER_GATES = Object.freeze({
  replay: Object.freeze({ rgbMaeMaximum: 0.01, changedPixelRatioMaximum: 0.005, maxChannelDeltaMaximum: 32 }),
  stress: Object.freeze({ rgbMaeMinimum: 0.02, changedPixelRatioMinimum: 0.01 }),
  motion: Object.freeze({ rgbMaeMinimum: 0.05, changedPixelRatioMinimum: 0.01 }),
});

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
  Object.freeze({ label: "final.full.attachment", mode: "final", tier: "full", camera: "attachment", time: 0 }),
  Object.freeze({ label: "final.full.design.stress-seed", mode: "final", tier: "full", camera: "design", seed: CORPUS_STRESS_SEED, seedPhase: "B", seedCaseId: "final-full-design", time: 0 }),
  Object.freeze({ label: "action-ready.full.design.stress-seed.t000", mode: "action-ready", tier: "full", camera: "design", seed: CORPUS_STRESS_SEED, seedPhase: "B", seedCaseId: "action-ready-t000", time: 0 }),
  Object.freeze({ label: "action-ready.full.design.stress-seed.t200", mode: "action-ready", tier: "full", camera: "design", seed: CORPUS_STRESS_SEED, seedPhase: "B", seedCaseId: "action-ready-t200", time: 2 }),
  Object.freeze({ label: "final.full.design.representative-replay", mode: "final", tier: "full", camera: "design", seed: CORPUS_REPRESENTATIVE_SEED, seedPhase: "A1", seedCaseId: "final-full-design", time: 0 }),
  Object.freeze({ label: "action-ready.full.design.representative-replay.t000", mode: "action-ready", tier: "full", camera: "design", seed: CORPUS_REPRESENTATIVE_SEED, seedPhase: "A1", seedCaseId: "action-ready-t000", time: 0 }),
  Object.freeze({ label: "action-ready.full.design.representative-replay.t200", mode: "action-ready", tier: "full", camera: "design", seed: CORPUS_REPRESENTATIVE_SEED, seedPhase: "A1", seedCaseId: "action-ready-t200", time: 2 }),
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

function captureFilename(subjectId, fragment) {
  const filename = `${subjectId}.${fragment}.png`;
  if (!CORPUS_CAPTURE_PLAN.some((entry) => entry.filename === filename)) throw new Error(`missing raster comparison capture ${filename}`);
  return filename;
}

function buildRasterComparisonPlan() {
  const records = [];
  for (const subjectId of SCULPT_TARGET_IDS) {
    for (const [caseId, a0Fragment, bFragment, a1Fragment] of [
      ["final-full-design", "final.full.design", "final.full.design.stress-seed", "final.full.design.representative-replay"],
      ["action-ready-t000", "action-ready.full.design.t000", "action-ready.full.design.stress-seed.t000", "action-ready.full.design.representative-replay.t000"],
      ["action-ready-t200", "action-ready.full.design.t200", "action-ready.full.design.stress-seed.t200", "action-ready.full.design.representative-replay.t200"],
    ]) {
      const a0 = captureFilename(subjectId, a0Fragment);
      const b = captureFilename(subjectId, bFragment);
      const a1 = captureFilename(subjectId, a1Fragment);
      records.push(
        Object.freeze({ id: `raster-replay:${subjectId}:${caseId}`, kind: "replay", leftFilename: a0, rightFilename: a1 }),
        Object.freeze({ id: `raster-stress:${subjectId}:${caseId}`, kind: "stress", leftFilename: a0, rightFilename: b }),
      );
    }
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
  const sourceBytesPerRow = requirePositiveInteger(capture.sourceBytesPerRow, "capture sourceBytesPerRow");
  if (sourceBytesPerRow < packedBytesPerRow || sourceBytesPerRow % 256 !== 0) {
    throw new Error("corpus capture sourceBytesPerRow must preserve the aligned WebGPU copy stride");
  }
  const sourceByteLength = requirePositiveInteger(capture.sourceByteLength, "capture sourceByteLength");
  const shortPaddedByteLength = sourceBytesPerRow * (height - 1) + packedBytesPerRow;
  const fullyPaddedByteLength = sourceBytesPerRow * height;
  if (sourceByteLength !== shortPaddedByteLength && sourceByteLength !== fullyPaddedByteLength) {
    throw new Error("corpus capture sourceByteLength does not match its explicit source row stride");
  }
  if (capture.transportByteLength !== undefined && capture.transportByteLength !== sourceByteLength) {
    throw new Error("padded corpus capture transport length must preserve the source readback length");
  }
  if (capture.sourceLayout !== "padded") {
    throw new Error("corpus evidence requires padded render-target readback; compact pixels are not a substitute");
  }
  if (capture.format !== "rgba8") throw new Error(`corpus capture must normalize to rgba8, received ${capture.format}`);
  if (!isSrgb(capture.colorEncoding) || !isSrgb(pipeline.outputColorSpace)) {
    throw new Error("corpus capture and renderer output must both preserve explicit sRGB metadata");
  }
  return Object.freeze({
    ...capture,
    packedBytesPerRow,
    sourceRowStride: sourceBytesPerRow,
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

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function captureFileReference(session, filename) {
  if (typeof session.outputDir !== "string" || session.outputDir.length === 0) {
    return Object.freeze({ path: filename, sha256: null });
  }
  return Object.freeze({
    path: filename,
    sha256: sha256File(resolve(session.outputDir, filename)),
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

  const captures = [];
  const tierContracts = Object.fromEntries(SCULPT_TARGET_IDS.map((id) => [id, {}]));
  for (const { filename, state } of CORPUS_CAPTURE_PLAN) {
    await configureState(session, state);
    const capture = await session.writeCapture(filename, "presentation");
    const metrics = await session.controllerCall("getMetrics");
    const pipeline = await session.controllerCall("describePipeline");
    const runtimeContract = await session.controllerCall("getRuntimeContract");
    requireNativeBackend(metrics, pipeline);
    assertAppliedState(metrics, state);
    const normalized = validateCorpusCaptureMetadata(capture, pipeline);
    captures.push(Object.freeze({
      filename,
      state,
      ...normalized,
      file: captureFileReference(session, filename),
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

  await configureState(session, {
    subjectId: "potted-bonsai",
    mode: "action-ready",
    tier: "budgeted",
    camera: "design",
    seed: 1,
    time: 0,
  });
  await session.controllerCall("renderOnce");

  const rasterComparisons = typeof session.outputDir === "string" && session.outputDir.length > 0
    ? computeCorpusRasterComparisons((filename) => readFileSync(resolve(session.outputDir, filename)))
    : Object.freeze([]);

  return Object.freeze({
    schemaVersion: 2,
    evidenceRunId,
    captures: Object.freeze(captures),
    tierContracts: Object.freeze(tierContracts),
    backendProof: Object.freeze({
      backend: initialMetrics.backend ?? initialMetrics.backendKind,
      nativeWebGPU: initialMetrics.nativeWebGPU,
      initialized: initialMetrics.initialized,
      firstFrameCompleted: initialMetrics.firstFrameCompleted,
      rendererType: initialMetrics.rendererInfo?.rendererType ?? null,
      backendType: initialMetrics.rendererInfo?.backendType ?? null,
      threeRevision: initialMetrics.rendererInfo?.threeRevision ?? null,
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
    note: "Native WebGPU render-target captures, explicit padded row-stride metadata, modes, cameras, tiers, and deterministic motion endpoints are necessary but do not replace reference comparison, AI visual review, sustained target-device timing, resource, or lifecycle evidence.",
  });
}

export default captureLab;
