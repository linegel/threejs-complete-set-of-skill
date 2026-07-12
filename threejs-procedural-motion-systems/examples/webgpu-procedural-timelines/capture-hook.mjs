import { createHash } from "node:crypto";

import {
  WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT,
  alignedBytesPerRow,
  unpackAlignedRows,
} from "../../../labs/runtime/aligned-readback.mjs";
import { encodeRgbaPng } from "../../../scripts/lib/png-rgba.mjs";
import { MOTION_ORIGIN_METADATA, createMotionState, motionEventBitmask, stepTimelineState } from "./timeline.js";
import { MOTION_STORAGE_FLAG_BITS } from "./gpu-instance-motion.js";

export const MOTION_DIAGNOSTIC_CAPTURE_MODES = Object.freeze([
  "final",
  "normal",
  "emissive",
  "velocity",
]);

export const MOTION_DIAGNOSTIC_SOURCE_CAPTURES = Object.freeze([
  "final.design.png",
  "diagnostic.normal.png",
  "diagnostic.emissive.png",
  "diagnostic.velocity.png",
]);

export const MOTION_STORAGE_PARITY_CHECKPOINTS = Object.freeze([
  Object.freeze({ id: "launch-mid", scenario: "launch-and-staging", timeSeconds: 12 }),
  Object.freeze({ id: "launch-stage-event", scenario: "launch-and-staging", timeSeconds: 24 }),
  Object.freeze({ id: "docking-capture-event", scenario: "spin-docking", timeSeconds: 6 }),
  Object.freeze({ id: "docking-mid", scenario: "spin-docking", timeSeconds: 7.5 }),
  Object.freeze({ id: "docking-terminal-event", scenario: "spin-docking", timeSeconds: 10 }),
  Object.freeze({ id: "debris-release-event", scenario: "debris-release", timeSeconds: 2 }),
  Object.freeze({ id: "debris-mid", scenario: "debris-release", timeSeconds: 3.25 }),
  Object.freeze({ id: "quaternion-antiparallel", scenario: "quaternion-and-reparent", timeSeconds: 4 }),
  Object.freeze({ id: "compute-storage-live", scenario: "compute-storage", timeSeconds: 2.75 }),
  Object.freeze({ id: "interpolation-velocity-live", scenario: "interpolation-and-velocity", timeSeconds: 3.5 }),
]);

export const MOTION_MECHANISM_CAPTURE_STATES = Object.freeze([
  Object.freeze({ scenario: "launch-and-staging", time: 25.5 }),
  Object.freeze({ scenario: "spin-docking", time: 7.5 }),
  Object.freeze({ scenario: "debris-release", time: 3.25 }),
  Object.freeze({ scenario: "quaternion-and-reparent", time: 4 }),
  Object.freeze({ scenario: "compute-storage", time: 2.75 }),
  Object.freeze({ scenario: "interpolation-and-velocity", time: 3.5 }),
]);

export const MOTION_STORAGE_READBACK_FIELDS = Object.freeze([
  Object.freeze({ id: "previousPose", type: "f32" }),
  Object.freeze({ id: "currentPose", type: "f32" }),
  Object.freeze({ id: "velocityState", type: "f32" }),
  Object.freeze({ id: "previousQuaternion", type: "f32" }),
  Object.freeze({ id: "currentQuaternion", type: "f32" }),
  Object.freeze({ id: "angularVelocity", type: "f32" }),
  Object.freeze({ id: "previousPresentedPose", type: "f32" }),
  Object.freeze({ id: "currentPresentedPose", type: "f32" }),
  Object.freeze({ id: "previousPresentedQuaternion", type: "f32" }),
  Object.freeze({ id: "currentPresentedQuaternion", type: "f32" }),
  Object.freeze({ id: "anchorFrequency", type: "f32" }),
  Object.freeze({ id: "axisPhase", type: "f32" }),
  Object.freeze({ id: "seedFlags", type: "u32" }),
]);

export const MOTION_STORAGE_PARITY_GATES = Object.freeze({
  positionSceneUnits: 0.002,
  velocitySceneUnitsPerSecond: 0.0002,
  quaternionAngleRadians: 0.0002,
  quaternionNormError: 0.0001,
  endpointComponentError: 0.000001,
});

const MOTION_DIAGNOSTIC_MIN_NON_DOMINANT_FRACTION = 0.001;

export const MOTION_STANDARD_OUTPUT_PLAN = Object.freeze([
  Object.freeze({ id: "final.design", status: "CAPTURED", filename: "final.design.png" }),
  Object.freeze({
    id: "no-post.design",
    status: "NOT_APPLICABLE",
    filename: null,
    reason: "The motion lab presents one selected MRT signal through renderOutput and has no post-processing stage to disable.",
    graphProof: Object.freeze({
      renderPipelineOwner: "webgpu-procedural-timelines",
      presentationGraphKind: "direct-render-output",
      reachableOutputNodes: Object.freeze(["final", "normal", "emissive", "velocity"]),
      postProcessingStages: Object.freeze([]),
      finalToneMapOwner: "renderOutput",
      finalOutputTransformOwner: "renderOutput",
    }),
  }),
  Object.freeze({
    id: "diagnostics.mosaic",
    status: "CAPTURED",
    filename: "diagnostics.mosaic.png",
    sourceCaptures: MOTION_DIAGNOSTIC_SOURCE_CAPTURES,
  }),
  Object.freeze({ id: "camera.near", status: "CAPTURED", filename: "camera.near.png" }),
  Object.freeze({ id: "camera.design", status: "CAPTURED", filename: "camera.design.png" }),
  Object.freeze({ id: "camera.far", status: "CAPTURED", filename: "camera.far.png" }),
  Object.freeze({ id: "seed-0001.final", status: "CAPTURED", filename: "seed-0001.final.png" }),
  Object.freeze({ id: "seed-9e3779b9.final", status: "CAPTURED", filename: "seed-9e3779b9.final.png" }),
  Object.freeze({ id: "temporal.t000", status: "CAPTURED", filename: "temporal.t000.png" }),
  Object.freeze({ id: "temporal.t001", status: "CAPTURED", filename: "temporal.t001.png" }),
]);

export const outputPlan = MOTION_STANDARD_OUTPUT_PLAN;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function requireRgbaRaster(raster, label) {
  if (!raster || !Number.isInteger(raster.width) || raster.width <= 0) {
    throw new TypeError(`${label} requires a positive integer width`);
  }
  if (!Number.isInteger(raster.height) || raster.height <= 0) {
    throw new TypeError(`${label} requires a positive integer height`);
  }
  if (!ArrayBuffer.isView(raster.data) || raster.data.byteLength !== raster.width * raster.height * 4) {
    throw new RangeError(`${label} requires one compact RGBA8 raster`);
  }
  return raster;
}

export function composeMotionDiagnosticMosaic(sources) {
  if (!Array.isArray(sources) || sources.length !== MOTION_DIAGNOSTIC_CAPTURE_MODES.length) {
    throw new RangeError("motion diagnostic mosaic requires final, normal, emissive, and velocity rasters");
  }
  const validated = sources.map((source, index) => requireRgbaRaster(
    source,
    `motion diagnostic ${MOTION_DIAGNOSTIC_CAPTURE_MODES[index]}`,
  ));
  const [{ width, height }] = validated;
  if (validated.some((source) => source.width !== width || source.height !== height)) {
    throw new RangeError("motion diagnostic source dimensions must agree");
  }
  const splitX = Math.floor(width / 2);
  const splitY = Math.floor(height / 2);
  if (splitX === 0 || splitY === 0) throw new RangeError("motion diagnostic mosaic requires at least 2x2 pixels");
  const output = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = y < splitY ? 0 : 1;
    const panelY = row === 0 ? y : y - splitY;
    const panelHeight = row === 0 ? splitY : height - splitY;
    for (let x = 0; x < width; x += 1) {
      const column = x < splitX ? 0 : 1;
      const panelX = column === 0 ? x : x - splitX;
      const panelWidth = column === 0 ? splitX : width - splitX;
      const source = validated[row * 2 + column];
      const sourceX = Math.min(source.width - 1, Math.floor((panelX + 0.5) * source.width / panelWidth));
      const sourceY = Math.min(source.height - 1, Math.floor((panelY + 0.5) * source.height / panelHeight));
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const outputOffset = (y * width + x) * 4;
      output.set(source.data.subarray(sourceOffset, sourceOffset + 4), outputOffset);
    }
  }
  return Object.freeze({ width, height, data: output });
}

export function requireDistinctMotionDiagnosticHashes(hashes) {
  if (!Array.isArray(hashes) || hashes.length !== MOTION_DIAGNOSTIC_CAPTURE_MODES.length) {
    throw new RangeError("motion diagnostic hash proof requires four source hashes");
  }
  if (hashes.some((hash) => typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(hash))) {
    throw new TypeError("motion diagnostic source hashes must be normalized SHA-256 values");
  }
  if (new Set(hashes).size !== hashes.length) {
    throw new Error("motion diagnostic routes produced duplicate retained pixels");
  }
  return Object.freeze([...hashes]);
}

export function analyzeMotionDiagnosticRaster(raster) {
  const { width, height, data } = requireRgbaRaster(raster, "motion diagnostic analysis");
  const counts = new Map();
  let dominantPixelCount = 0;
  for (let offset = 0; offset < data.byteLength; offset += 4) {
    const key = `${data[offset]},${data[offset + 1]},${data[offset + 2]},${data[offset + 3]}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    dominantPixelCount = Math.max(dominantPixelCount, count);
  }
  const pixelCount = width * height;
  const nonDominantPixelCount = pixelCount - dominantPixelCount;
  return Object.freeze({
    pixelCount,
    uniqueColorCount: counts.size,
    dominantPixelCount,
    nonDominantPixelCount,
    nonDominantFraction: nonDominantPixelCount / pixelCount,
  });
}

export function requireUsefulMotionDiagnosticRaster(raster, mode) {
  const analysis = analyzeMotionDiagnosticRaster(raster);
  if (analysis.uniqueColorCount < 2) {
    throw new Error(`motion ${mode} route produced a constant diagnostic`);
  }
  if (analysis.nonDominantFraction < MOTION_DIAGNOSTIC_MIN_NON_DOMINANT_FRACTION) {
    throw new Error(
      `motion ${mode} diagnostic occupancy ${analysis.nonDominantFraction} is below ${MOTION_DIAGNOSTIC_MIN_NON_DOMINANT_FRACTION}`,
    );
  }
  return analysis;
}

export function requireUsefulMotionStandardRaster(raster, id) {
  const analysis = analyzeMotionDiagnosticRaster(raster);
  if (analysis.uniqueColorCount < 2) {
    throw new Error(`motion standard capture ${id} is blank or constant`);
  }
  if (analysis.nonDominantFraction < MOTION_DIAGNOSTIC_MIN_NON_DOMINANT_FRACTION) {
    throw new Error(
      `motion standard capture ${id} occupancy ${analysis.nonDominantFraction} is below ${MOTION_DIAGNOSTIC_MIN_NON_DOMINANT_FRACTION}`,
    );
  }
  return analysis;
}

function numberArray(value, label) {
  if (Array.isArray(value)) return value.map(Number);
  if (ArrayBuffer.isView(value)) return Array.from(value, Number);
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b));
    if (keys.length > 0) return keys.map((key) => Number(value[key]));
  }
  throw new TypeError(`${label} is not a serialized numeric array`);
}

function maxAbsDifference(a, b) {
  if (a.length !== b.length) throw new RangeError("motion parity arrays have different lengths");
  let max = 0;
  for (let index = 0; index < a.length; index += 1) {
    max = Math.max(max, Math.abs(a[index] - b[index]));
  }
  return max;
}

function quaternionAngle(a, b) {
  const normA = Math.hypot(...a);
  const normB = Math.hypot(...b);
  if (!(normA > 0) || !(normB > 0)) return Number.POSITIVE_INFINITY;
  const dot = Math.abs(a.reduce((sum, value, index) => sum + value * b[index], 0) / (normA * normB));
  return 2 * Math.acos(Math.min(Math.max(dot, -1), 1));
}

function requireGate(value, gate, label) {
  if (!Number.isFinite(value) || value > gate) {
    throw new Error(`motion ${label} ${value} exceeds gate ${gate}`);
  }
}

export function createMotionStorageOracle({ scenario, timeSeconds, seed = 17 }) {
  const state = createMotionState({ scenario, seed, sceneUnitsPerMeter: 0.001 });
  stepTimelineState(state, 0, timeSeconds);
  const positionPhaseF64 = Object.freeze([...state.position.toArray(), state.phaseId]);
  const velocityFlagsF64 = Object.freeze([
    ...state.velocity.toArray(),
    motionEventBitmask(state.eventFlags) | MOTION_STORAGE_FLAG_BITS.originMetadataBound,
  ]);
  const quaternionF64 = Object.freeze(state.quaternion.toArray());
  const angularVelocitySpinF64 = Object.freeze([...state.angularVelocity.toArray(), state.spinAngle]);
  const anchorFrequency = Object.freeze([0, 0, 0, 0]);
  const axisPhase = Object.freeze([0, 1, 0, 0]);
  const seedFlags = Object.freeze([seed >>> 0, 3, 0, 1]);
  return Object.freeze({
    positionPhase: Object.freeze(Array.from(Float32Array.from(positionPhaseF64))),
    velocityFlags: Object.freeze(Array.from(Float32Array.from(velocityFlagsF64))),
    quaternion: Object.freeze(Array.from(Float32Array.from(quaternionF64))),
    angularVelocitySpin: Object.freeze(Array.from(Float32Array.from(angularVelocitySpinF64))),
    previousPresentedPose: Object.freeze(Array.from(Float32Array.from(positionPhaseF64))),
    currentPresentedPose: Object.freeze(Array.from(Float32Array.from(positionPhaseF64))),
    previousPresentedQuaternion: Object.freeze(Array.from(Float32Array.from(quaternionF64))),
    currentPresentedQuaternion: Object.freeze(Array.from(Float32Array.from(quaternionF64))),
    anchorFrequency,
    axisPhase,
    seedFlags,
    eventFlags: Object.freeze({ ...state.eventFlags }),
    f64: Object.freeze({
      positionPhase: positionPhaseF64,
      velocityFlags: velocityFlagsF64,
      quaternion: quaternionF64,
      angularVelocitySpin: angularVelocitySpinF64,
    }),
  });
}

export function evaluateMotionStorageParity({ scenario, timeSeconds, gpu, oracle }) {
  const previousPose = numberArray(gpu.previousPose, "previous pose");
  const currentPose = numberArray(gpu.currentPose, "current pose");
  const velocity = numberArray(gpu.velocityState ?? gpu.velocity, "velocity state");
  const previousQuaternion = numberArray(gpu.previousQuaternion, "previous quaternion");
  const currentQuaternion = numberArray(gpu.currentQuaternion, "current quaternion");
  const angularVelocity = numberArray(gpu.angularVelocity, "angular velocity");
  const previousPresentedPose = numberArray(gpu.previousPresentedPose, "previous presented pose");
  const currentPresentedPose = numberArray(gpu.currentPresentedPose, "current presented pose");
  const previousPresentedQuaternion = numberArray(gpu.previousPresentedQuaternion, "previous presented quaternion");
  const currentPresentedQuaternion = numberArray(gpu.currentPresentedQuaternion, "current presented quaternion");
  const anchorFrequency = numberArray(gpu.anchorFrequency, "anchor frequency");
  const axisPhase = numberArray(gpu.axisPhase, "axis phase");
  const seedFlags = numberArray(gpu.seedFlags, "seed flags");
  const expectedPosition = numberArray(oracle.positionPhase, "oracle position");
  const expectedVelocity = numberArray(oracle.velocityFlags, "oracle velocity");
  const expectedQuaternion = numberArray(oracle.quaternion, "oracle quaternion");
  const expectedAngularVelocity = numberArray(oracle.angularVelocitySpin, "oracle angular velocity");
  const f64 = oracle.f64 ?? {
    positionPhase: expectedPosition,
    velocityFlags: expectedVelocity,
    quaternion: expectedQuaternion,
  };
  const errors = Object.freeze({
    currentPositionF32MaxAbs: maxAbsDifference(currentPose, expectedPosition),
    previousPositionF32MaxAbs: maxAbsDifference(previousPose, expectedPosition),
    currentVelocityF32MaxAbs: maxAbsDifference(velocity, expectedVelocity),
    currentAngularVelocityF32MaxAbs: maxAbsDifference(angularVelocity, expectedAngularVelocity),
    previousCurrentPositionMaxAbs: maxAbsDifference(previousPose, currentPose),
    previousCurrentQuaternionMaxAbs: maxAbsDifference(previousQuaternion, currentQuaternion),
    currentPositionF64MaxAbs: maxAbsDifference(currentPose, numberArray(f64.positionPhase, "f64 position")),
    currentVelocityF64MaxAbs: maxAbsDifference(velocity, numberArray(f64.velocityFlags, "f64 velocity")),
    quaternionAngleRadians: quaternionAngle(currentQuaternion, numberArray(f64.quaternion, "f64 quaternion")),
    quaternionNormError: Math.abs(Math.hypot(...currentQuaternion) - 1),
    previousPresentedPoseMaxAbs: maxAbsDifference(previousPresentedPose, expectedPosition),
    currentPresentedPoseMaxAbs: maxAbsDifference(currentPresentedPose, expectedPosition),
    previousPresentedQuaternionMaxAbs: maxAbsDifference(previousPresentedQuaternion, expectedQuaternion),
    currentPresentedQuaternionMaxAbs: maxAbsDifference(currentPresentedQuaternion, expectedQuaternion),
    previousPresentedQuaternionAngleRadians: quaternionAngle(previousPresentedQuaternion, numberArray(f64.quaternion, "f64 quaternion")),
    currentPresentedQuaternionAngleRadians: quaternionAngle(currentPresentedQuaternion, numberArray(f64.quaternion, "f64 quaternion")),
    previousCurrentPresentedPoseMaxAbs: maxAbsDifference(previousPresentedPose, currentPresentedPose),
    previousCurrentPresentedQuaternionMaxAbs: maxAbsDifference(previousPresentedQuaternion, currentPresentedQuaternion),
    anchorFrequencyMaxAbs: maxAbsDifference(anchorFrequency, numberArray(oracle.anchorFrequency, "oracle anchor")),
    axisPhaseMaxAbs: maxAbsDifference(axisPhase, numberArray(oracle.axisPhase, "oracle axis")),
    seedFlagsMaxAbs: maxAbsDifference(seedFlags, numberArray(oracle.seedFlags, "oracle seed flags")),
  });
  requireGate(errors.currentPositionF32MaxAbs, MOTION_STORAGE_PARITY_GATES.positionSceneUnits, `${scenario} position parity`);
  requireGate(errors.previousPositionF32MaxAbs, MOTION_STORAGE_PARITY_GATES.positionSceneUnits, `${scenario} previous-position parity`);
  requireGate(errors.currentVelocityF32MaxAbs, MOTION_STORAGE_PARITY_GATES.velocitySceneUnitsPerSecond, `${scenario} velocity parity`);
  requireGate(errors.currentAngularVelocityF32MaxAbs, MOTION_STORAGE_PARITY_GATES.velocitySceneUnitsPerSecond, `${scenario} angular-velocity parity`);
  requireGate(errors.previousCurrentPositionMaxAbs, MOTION_STORAGE_PARITY_GATES.endpointComponentError, `${scenario} seek position endpoints`);
  requireGate(errors.previousCurrentQuaternionMaxAbs, MOTION_STORAGE_PARITY_GATES.endpointComponentError, `${scenario} seek quaternion endpoints`);
  requireGate(errors.quaternionAngleRadians, MOTION_STORAGE_PARITY_GATES.quaternionAngleRadians, `${scenario} quaternion parity`);
  requireGate(errors.quaternionNormError, MOTION_STORAGE_PARITY_GATES.quaternionNormError, `${scenario} quaternion norm`);
  for (const [key, gate, label] of [
    ["previousPresentedPoseMaxAbs", MOTION_STORAGE_PARITY_GATES.positionSceneUnits, "previous presented pose"],
    ["currentPresentedPoseMaxAbs", MOTION_STORAGE_PARITY_GATES.positionSceneUnits, "current presented pose"],
    ["previousPresentedQuaternionAngleRadians", MOTION_STORAGE_PARITY_GATES.quaternionAngleRadians, "previous presented quaternion"],
    ["currentPresentedQuaternionAngleRadians", MOTION_STORAGE_PARITY_GATES.quaternionAngleRadians, "current presented quaternion"],
    ["previousCurrentPresentedPoseMaxAbs", MOTION_STORAGE_PARITY_GATES.endpointComponentError, "presented pose endpoints"],
    ["previousCurrentPresentedQuaternionMaxAbs", MOTION_STORAGE_PARITY_GATES.endpointComponentError, "presented quaternion endpoints"],
    ["anchorFrequencyMaxAbs", "anchor storage"],
    ["axisPhaseMaxAbs", "axis storage"],
    ["seedFlagsMaxAbs", "seed/flags storage"],
  ].map((entry) => entry.length === 2
    ? [entry[0], MOTION_STORAGE_PARITY_GATES.endpointComponentError, entry[1]]
    : entry)) requireGate(errors[key], gate, `${scenario} ${label}`);
  if (
    gpu.previousStateVersion !== gpu.currentStateVersion
    || gpu.readbackConfirmedStateVersion !== gpu.currentStateVersion
  ) {
    throw new Error(`motion ${scenario} storage versions are not readback-confirmed seek endpoints`);
  }
  return Object.freeze({
    scenario,
    timeSeconds,
    verdict: "PASS",
    gates: MOTION_STORAGE_PARITY_GATES,
    errors,
    versions: Object.freeze({
      previous: gpu.previousStateVersion,
      current: gpu.currentStateVersion,
      readbackConfirmed: gpu.readbackConfirmedStateVersion,
    }),
    eventFlags: oracle.eventFlags,
  });
}

export function assertMotionCaptureState(requested, observed) {
  const expectedTime = Number(requested.time ?? requested.timeSeconds ?? 0) + Number(requested.stepSeconds ?? 0);
  for (const key of ["scenario", "tier", "mode", "camera", "seed"]) {
    const expected = key === "seed" ? Number(requested[key]) >>> 0 : requested[key];
    const actual = key === "seed" ? Number(observed[key]) >>> 0 : observed[key];
    if (actual !== expected) throw new Error(`motion capture ${key} ${actual} does not match requested ${expected}`);
  }
  if (!Number.isFinite(observed.timeSeconds) || Math.abs(observed.timeSeconds - expectedTime) > 1e-9) {
    throw new Error(`motion capture time ${observed.timeSeconds} does not match requested ${expectedTime}`);
  }
  return Object.freeze({
    scenario: observed.scenario,
    tier: observed.tier,
    mode: observed.mode,
    camera: observed.camera,
    seed: observed.seed,
    timeSeconds: observed.timeSeconds,
  });
}

function padRgbaRows(raster) {
  const bytesPerRow = alignedBytesPerRow(
    raster.width,
    4,
    WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT,
  );
  const padded = new Uint8Array(bytesPerRow * raster.height);
  const logicalBytesPerRow = raster.width * 4;
  for (let row = 0; row < raster.height; row += 1) {
    padded.set(
      raster.data.subarray(row * logicalBytesPerRow, (row + 1) * logicalBytesPerRow),
      row * bytesPerRow,
    );
  }
  return Object.freeze({ bytesPerRow, data: padded });
}

async function compactCaptureRaster(session, capture) {
  const padded = new Uint8Array(await session.readArtifact(capture.normalized.artifact.path));
  return Object.freeze({
    width: capture.width,
    height: capture.height,
    data: unpackAlignedRows({
      source: padded,
      width: capture.width,
      height: capture.height,
      bytesPerPixel: 4,
      bytesPerRow: capture.normalized.bytesPerRow,
    }),
  });
}

async function validateRetainedMotionCapture(session, capture, id) {
  const raster = await compactCaptureRaster(session, capture);
  return requireUsefulMotionStandardRaster(raster, id);
}

async function writeDiagnosticMosaic(session, sourceRecords) {
  const sources = await Promise.all(sourceRecords.map(({ capture }) => compactCaptureRaster(session, capture)));
  const analyses = sources.map((source, index) => requireUsefulMotionDiagnosticRaster(
    source,
    MOTION_DIAGNOSTIC_CAPTURE_MODES[index],
  ));
  const sourceHashes = requireDistinctMotionDiagnosticHashes(
    sourceRecords.map(({ capture }) => capture.normalized.compactRgbaSha256),
  );
  const raster = composeMotionDiagnosticMosaic(sources);
  const packedSha256 = sha256(raster.data);
  if (packedSha256 === sourceRecords[0].capture.normalized.compactRgbaSha256) {
    throw new Error("motion diagnostics mosaic duplicated final output pixels");
  }
  const padded = padRgbaRows(raster);
  const png = encodeRgbaPng(raster);
  const pngReference = Object.freeze({
    path: "diagnostics.mosaic.png",
    sha256: sha256(png),
    byteLength: png.byteLength,
    encoding: "png-rgba8-srgb",
    derivedFromPackedRgbaSha256: packedSha256,
  });
  const normalizedReference = Object.freeze({
    path: "diagnostics.mosaic.normalized.rgba8.bin",
    sha256: sha256(padded.data),
    byteLength: padded.data.byteLength,
  });
  const packedReference = Object.freeze({
    path: "diagnostics.mosaic.packed.rgba8.bin",
    sha256: packedSha256,
    byteLength: raster.data.byteLength,
  });
  await session.writeArtifact(normalizedReference.path, padded.data);
  await session.writeArtifact(packedReference.path, raster.data);
  await session.writeArtifact(pngReference.path, png);
  return Object.freeze({
    id: "diagnostics.mosaic",
    status: "CAPTURED",
    filename: pngReference.path,
    width: raster.width,
    height: raster.height,
    sourceCaptures: MOTION_DIAGNOSTIC_SOURCE_CAPTURES,
    composition: Object.freeze({
      layout: "two-by-two-equal-diagnostic-panels",
      labelsByPanel: Object.freeze([...MOTION_DIAGNOSTIC_CAPTURE_MODES]),
      decoration: "none",
      sourceRasterAnalysis: Object.freeze(analyses),
    }),
    derivation: Object.freeze({
      kind: "nearest-center-rgba8-mosaic-v1",
      sourcePackedRgbaSha256: sourceHashes,
      outputPackedRgbaSha256: packedSha256,
    }),
    file: pngReference,
    pixelEvidence: Object.freeze({
      normalized: Object.freeze({
        alignmentBytes: WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT,
        layout: "cpu-normalized-padded-rgba8",
        paddedBytesPerRow: padded.bytesPerRow,
        paddedByteLength: padded.data.byteLength,
        rawArtifact: normalizedReference,
        packedArtifact: packedReference,
        packedRgbaSha256: packedSha256,
        packedByteLength: raster.data.byteLength,
        origin: "top-left",
        orientationTransform: "none",
        producerOwner: "motion-capture-hook",
        packedArtifactProducerOwner: "motion-capture-hook",
      }),
      png: pngReference,
    }),
  });
}

async function applyState(session, state) {
  for (const [method, value] of [
    ["setScenario", state.scenario],
    ["setTier", state.tier],
    ["setSeed", state.seed],
    ["setCamera", state.camera],
    ["setTime", state.time],
    ["setMode", state.mode],
  ]) {
    if (value !== null && value !== undefined) await session.controllerCall(method, value);
  }
}

async function captureState(session, filename, state) {
  await applyState(session, state);
  // Reconfiguration changes the storage-driven material graph. Retain pixels
  // only after several deterministic warm-up submissions have completed.
  for (let warmup = 0; warmup < 3; warmup += 1) {
    await session.controllerCall("renderOnce");
  }
  const capture = await session.writeCapture(filename, "presentation");
  const rasterAnalysis = await validateRetainedMotionCapture(session, capture, filename);
  const metrics = await session.controllerCall("getMetrics");
  const observedState = assertMotionCaptureState(state, {
    scenario: metrics.scenario,
    tier: metrics.tier,
    mode: metrics.mode,
    camera: metrics.camera,
    seed: metrics.seed,
    timeSeconds: metrics.timeSeconds,
  });
  return Object.freeze({
    filename,
    state: Object.freeze({ ...state }),
    observedState,
    rasterAnalysis,
    originMetadata: MOTION_ORIGIN_METADATA,
    capture,
  });
}

async function captureMotionStorageParity(session) {
  const results = [];
  for (const checkpoint of MOTION_STORAGE_PARITY_CHECKPOINTS) {
    const requested = {
      scenario: checkpoint.scenario,
      tier: "test-minimum",
      seed: 17,
      camera: "design",
      mode: "final",
      time: checkpoint.timeSeconds,
    };
    await applyState(session, requested);
    await session.controllerCall("renderOnce");
    const metrics = await session.controllerCall("getMetrics");
    assertMotionCaptureState(requested, {
      scenario: metrics.scenario,
      tier: metrics.tier,
      mode: metrics.mode,
      camera: metrics.camera,
      seed: metrics.seed,
      timeSeconds: metrics.timeSeconds,
    });
    const gpu = await session.controllerCall("captureStorage", 1);
    const oracle = createMotionStorageOracle({
      scenario: checkpoint.scenario,
      timeSeconds: checkpoint.timeSeconds,
      seed: 17,
    });
    const result = evaluateMotionStorageParity({
      scenario: checkpoint.scenario,
      timeSeconds: checkpoint.timeSeconds,
      gpu,
      oracle,
    });
    const retainedArtifacts = [];
    const retainedBuffers = [];
    for (const field of MOTION_STORAGE_READBACK_FIELDS) {
      const values = numberArray(gpu[field.id], field.id);
      const typed = field.type === "u32"
        ? Uint32Array.from(values, (value) => Number(value) >>> 0)
        : Float32Array.from(values);
      const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
      const extension = field.type === "u32" ? "u32.bin" : "f32.bin";
      const path = `storage.${checkpoint.id}.${field.id}.${extension}`;
      const artifact = Object.freeze({
        id: field.id,
        path,
        scalarType: field.type,
        format: gpu.rawBufferFormats?.[field.id] ?? null,
        elementCount: typed.length,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      });
      if (artifact.format !== (field.type === "u32" ? "vec4<u32>" : "vec4<f32>")) {
        throw new Error(`motion ${checkpoint.id} readback format mismatch for ${field.id}`);
      }
      await session.writeArtifact(path, bytes);
      retainedArtifacts.push(artifact);
      retainedBuffers.push(bytes);
    }
    const retainedBytes = Buffer.concat(retainedBuffers);
    if (gpu.readbackBytes !== retainedBytes.byteLength) {
      throw new Error(`motion ${checkpoint.id} readback byte ledger does not match retained typed buffers`);
    }
    results.push(Object.freeze({
      ...result,
      checkpointId: checkpoint.id,
      readbackSha256: sha256(retainedBytes),
      readbackBytes: retainedBytes.byteLength,
      rawReadbackArtifacts: Object.freeze(retainedArtifacts),
      oracleKinds: Object.freeze(["f32-storage-oracle", "f64-semantic-oracle"]),
      originMetadata: MOTION_ORIGIN_METADATA,
    }));
  }
  return Object.freeze(results);
}

export async function captureLab(session) {
  const captures = [];
  const base = Object.freeze({
    scenario: "spin-docking",
    tier: session.lockedState.tier,
    seed: 1,
    camera: "design",
    mode: "final",
    time: 5,
  });

  // The first offscreen readback allocates the capture target and is an
  // explicit warm-up sample. It is never retained or counted as evidence.
  await applyState(session, { ...base, mode: "normal" });
  for (let warmup = 0; warmup < 3; warmup += 1) {
    await session.controllerCall("renderOnce");
  }
  await session.capturePixels("presentation");

  const storageParity = await captureMotionStorageParity(session);
  await applyState(session, base);
  for (let warmup = 0; warmup < 3; warmup += 1) {
    await session.controllerCall("renderOnce");
  }

  for (const mode of MOTION_DIAGNOSTIC_CAPTURE_MODES.slice(1, 3)) {
    captures.push(await captureState(session, `diagnostic.${mode}.png`, { ...base, mode }));
  }
  // Compile and execute the two attachment diagnostics before retaining the
  // beauty image. This prevents an initial async material-pipeline warm-up
  // frame from being misclassified as final evidence.
  captures.push(await captureState(session, "final.design.png", base));
  await applyState(session, { ...base, mode: "velocity" });
  await session.controllerCall("step", 1 / 60);
  await session.controllerCall("renderOnce");
  const velocityCapture = await session.writeCapture("diagnostic.velocity.png", "presentation");
  const velocityRasterAnalysis = await validateRetainedMotionCapture(
    session,
    velocityCapture,
    "diagnostic.velocity.png",
  );
  const velocityMetrics = await session.controllerCall("getMetrics");
  const velocityObservedState = assertMotionCaptureState(
    { ...base, mode: "velocity", stepSeconds: 1 / 60 },
    {
      scenario: velocityMetrics.scenario,
      tier: velocityMetrics.tier,
      mode: velocityMetrics.mode,
      camera: velocityMetrics.camera,
      seed: velocityMetrics.seed,
      timeSeconds: velocityMetrics.timeSeconds,
    },
  );
  captures.push(Object.freeze({
    filename: "diagnostic.velocity.png",
    state: Object.freeze({ ...base, mode: "velocity", stepSeconds: 1 / 60 }),
    observedState: velocityObservedState,
    rasterAnalysis: velocityRasterAnalysis,
    originMetadata: MOTION_ORIGIN_METADATA,
    capture: velocityCapture,
  }));

  const sourceByFilename = new Map(captures.map((record) => [record.filename, record]));
  const diagnosticOutput = await writeDiagnosticMosaic(
    session,
    MOTION_DIAGNOSTIC_SOURCE_CAPTURES.map((filename) => sourceByFilename.get(filename)),
  );

  for (const camera of ["near", "design", "far"]) {
    captures.push(await captureState(session, `camera.${camera}.png`, {
      ...base,
      mode: "final",
      camera,
      time: 5.5,
    }));
  }
  captures.push(await captureState(session, "seed-0001.final.png", {
    ...base,
    mode: "final",
    seed: 1,
    time: 7,
  }));
  captures.push(await captureState(session, "seed-9e3779b9.final.png", {
    ...base,
    mode: "final",
    seed: 0x9e3779b9,
    time: 7,
  }));
  captures.push(await captureState(session, "temporal.t000.png", {
    ...base,
    mode: "final",
    seed: 1,
    time: 6,
  }));
  await applyState(session, { ...base, mode: "final", seed: 1, time: 6 });
  await session.controllerCall("step", 1 / 60);
  await session.controllerCall("renderOnce");
  const temporalCapture = await session.writeCapture("temporal.t001.png", "presentation");
  const temporalRasterAnalysis = await validateRetainedMotionCapture(
    session,
    temporalCapture,
    "temporal.t001.png",
  );
  const temporalMetrics = await session.controllerCall("getMetrics");
  const temporalObservedState = assertMotionCaptureState(
    { ...base, mode: "final", seed: 1, time: 6, stepSeconds: 1 / 60 },
    {
      scenario: temporalMetrics.scenario,
      tier: temporalMetrics.tier,
      mode: temporalMetrics.mode,
      camera: temporalMetrics.camera,
      seed: temporalMetrics.seed,
      timeSeconds: temporalMetrics.timeSeconds,
    },
  );
  captures.push(Object.freeze({
    filename: "temporal.t001.png",
    state: Object.freeze({ ...base, mode: "final", seed: 1, time: 6, stepSeconds: 1 / 60 }),
    observedState: temporalObservedState,
    rasterAnalysis: temporalRasterAnalysis,
    originMetadata: MOTION_ORIGIN_METADATA,
    capture: temporalCapture,
  }));

  for (const mechanism of MOTION_MECHANISM_CAPTURE_STATES) {
    captures.push(await captureState(
      session,
      `mechanism.${mechanism.scenario}.png`,
      {
        ...base,
        scenario: mechanism.scenario,
        tier: "test-minimum",
        mode: "final",
        seed: 17,
        camera: "design",
        time: mechanism.time,
      },
    ));
  }

  await applyState(session, {
    scenario: session.lockedState.scenario,
    tier: session.lockedState.tier,
    seed: session.lockedState.seed,
    camera: session.lockedState.camera,
    time: session.lockedState.timeSeconds,
    mode: session.lockedState.mode,
  });
  await session.controllerCall("renderOnce");

  const pipeline = await session.controllerCall("describePipeline");
  const resources = await session.controllerCall("describeResources");
  const storageResources = resources.runtimeReachableStorageResources ?? [];
  if (storageResources.length !== MOTION_STORAGE_READBACK_FIELDS.length) {
    throw new Error("motion runtime resource ledger does not enumerate every retained storage buffer");
  }
  if (storageResources.some((resource) => (
    resource.runtimeReachable !== true
    || !Number.isInteger(resource.byteLength)
    || resource.byteLength <= 0
    || !/^vec4<(?:f32|u32)>$/.test(resource.format)
    || resource.producers?.length < 1
    || resource.consumers?.length < 1
  ))) {
    throw new Error("motion runtime resource ledger contains an unreachable or untyped storage resource");
  }
  if (storageResources.reduce((sum, resource) => sum + resource.byteLength, 0) !== resources.storageBytes) {
    throw new Error("motion runtime resource ledger byte total does not reconcile");
  }
  const noPostProof = MOTION_STANDARD_OUTPUT_PLAN[1].graphProof;
  if (
    pipeline.presentationGraph?.kind !== "direct-render-output"
    || pipeline.presentationGraph?.postProcessingStages?.length !== 0
    || pipeline.finalToneMapOwner !== noPostProof.finalToneMapOwner
    || pipeline.finalOutputTransformOwner !== noPostProof.finalOutputTransformOwner
    || JSON.stringify([...pipeline.presentationGraph.reachableOutputNodes].sort())
      !== JSON.stringify([...noPostProof.reachableOutputNodes].sort())
  ) {
    throw new Error("motion no-post structural disposition disagrees with the runtime pipeline graph");
  }

  return Object.freeze({
    status: "incomplete",
    publishable: false,
    claimBoundary: "Correctness capture only; acceptance still requires a complete v2 bundle, hardware timestamps, lifecycle evidence, and direct visual review.",
    warmup: Object.freeze({ retained: false, readbackCount: 1, reason: "offscreen capture-target allocation" }),
    captures: Object.freeze(captures),
    standardOutputs: Object.freeze([diagnosticOutput]),
    noPostDisposition: MOTION_STANDARD_OUTPUT_PLAN[1],
    storageParity,
    runtimePipelineGraph: pipeline,
    runtimeResourceLedger: resources,
    originMetadata: MOTION_ORIGIN_METADATA,
  });
}

export default captureLab;
