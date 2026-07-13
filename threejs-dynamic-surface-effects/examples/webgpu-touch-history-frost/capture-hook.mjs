import { createHash } from "node:crypto";

import { unpackAlignedRows } from "../../../labs/runtime/aligned-readback.mjs";
import { encodeRgbaPng } from "../../../scripts/lib/png-rgba.mjs";
import {
  FROST_CAPTURE_RECIPES,
  FROST_COVERAGE_PROBE_RECIPES,
  FROST_ROUTE_PROBE_RECIPES,
  FROST_STANDARD_OUTPUT_PLAN,
} from "./capture-recipes.js";
import { buildFrostNormativeArtifacts } from "./frost-evidence-artifacts.mjs";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DIAGNOSTIC_RECIPE_IDS = Object.freeze([
  "diagnostic.previous-history-ra",
  "diagnostic.deposit-ra",
  "diagnostic.next-history-ra",
  "diagnostic.frost-mask-after-pointer",
]);
const DIAGNOSTIC_FILENAMES = Object.freeze(DIAGNOSTIC_RECIPE_IDS.map((id) => `${id}.png`));
const DIRECT_STANDARD_FILENAME_BY_RECIPE = Object.freeze({
  "final.design": "final.design.png",
  "no-post.design": "no-post.design.png",
  "camera.near": "camera.near.png",
  "camera.design": "camera.design.png",
  "camera.far": "camera.far.png",
  "seed-0001.final": "seed-0001.final.png",
  "seed-9e3779b9.final": "seed-9e3779b9.final.png",
  "temporal.t000": "temporal.t000.png",
  "temporal.t001": "temporal.t001.png",
});
export const FROST_VISUAL_DIFFERENCE_GATES = Object.freeze({
  finalNoPostMeanRgbBytes: 2,
  seedMeanRgbBytes: 1,
  seedChangedFraction: 0.25,
  temporalChangedFraction: 0.02,
  temporalMaxRgbBytes: 5,
  cameraMeanRgbBytes: 5,
  diagnosticRgbRangeBytes: 8,
});

export const outputPlan = Object.freeze(FROST_STANDARD_OUTPUT_PLAN.map((entry) => Object.freeze({
  id: entry.id,
  status: "CAPTURED",
  filename: entry.filename,
  ...(entry.kind === "derived-mosaic" ? { sourceCaptures: DIAGNOSTIC_FILENAMES } : {}),
})));

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireSha256(value, label) {
  if (!SHA256_PATTERN.test(value ?? "")) throw new Error(`${label} must be a sha256 digest`);
  return value;
}

function approximatelyEqual(actual, expected, epsilon = 1e-12) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon;
}

export function assertFrostRecipeCapture(recipe, capture, recipeSetDigest) {
  requireRecord(recipe, "Frost capture recipe");
  requireRecord(capture, `Frost capture ${recipe.id}`);
  if (capture.target !== recipe.id) throw new Error(`${recipe.id} capture target drifted to ${capture.target}`);
  if (capture.captureMode !== recipe.target) throw new Error(`${recipe.id} capture mode drifted to ${capture.captureMode}`);
  if (capture.width !== recipe.viewport.physicalWidth || capture.height !== recipe.viewport.physicalHeight) {
    throw new Error(`${recipe.id} readback does not match its frozen physical extent`);
  }

  const evidence = requireRecord(capture.evidence, `${recipe.id} evidence`);
  const recipeEvidence = requireRecord(evidence.recipe, `${recipe.id} recipe evidence`);
  if (recipeEvidence.id !== recipe.id || recipeEvidence.target !== recipe.target) {
    throw new Error(`${recipe.id} recipe evidence identity drifted`);
  }
  requireSha256(recipeEvidence.digest, `${recipe.id} recipe digest`);
  if (recipeEvidence.setDigest !== recipeSetDigest) throw new Error(`${recipe.id} recipe-set digest drifted`);

  const state = requireRecord(evidence.effectiveState, `${recipe.id} effective state`);
  for (const field of ["scenario", "mechanism", "tier", "camera", "seed"]) {
    if (state[field] !== recipe[field]) throw new Error(`${recipe.id} effective ${field} drifted`);
  }
  if (state.mode !== recipe.target) throw new Error(`${recipe.id} effective mode drifted`);
  if (!approximatelyEqual(state.timeSeconds, recipe.expectedTimeSeconds)) {
    throw new Error(`${recipe.id} effective time drifted`);
  }
  const viewport = requireRecord(state.viewport, `${recipe.id} viewport`);
  if (JSON.stringify(viewport) !== JSON.stringify(recipe.viewport)) {
    throw new Error(`${recipe.id} effective viewport drifted`);
  }

  const execution = requireRecord(evidence.execution, `${recipe.id} execution evidence`);
  if (execution.pointerSegmentCount !== recipe.trace.length
    || execution.computeDispatchDelta !== recipe.trace.length
    || execution.renderSubmissionDelta !== 1
    || execution.sameFrameComposite !== true) {
    throw new Error(`${recipe.id} execution counts do not match its frozen trace`);
  }

  const artifactTarget = requireRecord(evidence.artifactTarget, `${recipe.id} artifact target`);
  if (artifactTarget.kind !== "render-target"
    || artifactTarget.rendererDeviceGeneration !== 1
    || typeof artifactTarget.captureTargetId !== "string"
    || typeof artifactTarget.colorTextureUuid !== "string"
    || artifactTarget.width !== recipe.viewport.physicalWidth
    || artifactTarget.height !== recipe.viewport.physicalHeight
    || artifactTarget.format !== "rgba8unorm"
    || artifactTarget.depthBuffer !== false
    || artifactTarget.stencilBuffer !== false) {
    throw new Error(`${recipe.id} artifact target is incomplete or fabricated`);
  }

  const transaction = requireRecord(evidence.transaction, `${recipe.id} transaction`);
  if (transaction.status !== "COMMITTED"
    || transaction.recipeId !== recipe.id
    || transaction.restorationVerdict !== "PASS") {
    throw new Error(`${recipe.id} capture transaction did not commit`);
  }
  requireSha256(transaction.entryStateDigest, `${recipe.id} entry-state digest`);
  requireSha256(transaction.effectiveStateDigest, `${recipe.id} effective-state digest`);
  requireSha256(transaction.restoredStateDigest, `${recipe.id} restored-state digest`);
  if (transaction.entryStateDigest !== transaction.restoredStateDigest) {
    throw new Error(`${recipe.id} did not restore its parent state digest`);
  }
  return true;
}

function alignedRowBytes(width) {
  return Math.ceil((width * 4) / 256) * 256;
}

export function validateFrostCoverageEvidence(retained) {
  if (!(retained instanceof Map)) throw new TypeError("Frost coverage validation requires retained recipe captures");
  const records = FROST_COVERAGE_PROBE_RECIPES.map((recipe) => {
    const record = retained.get(recipe.id);
    if (!record) throw new Error(`Frost coverage evidence omits ${recipe.id}`);
    const capture = record.capture;
    const expectedStride = alignedRowBytes(recipe.viewport.physicalWidth);
    if (capture.sourceBytesPerRow !== expectedStride
      || capture.transport?.rendererCopy?.requestedLayout?.bytesPerRow !== expectedStride
      || capture.transport?.rendererCopy?.requestedLayout?.alignmentBytes !== 256) {
      throw new Error(`${recipe.id} aligned transport layout drifted`);
    }
    const execution = requireRecord(capture.evidence?.execution, `${recipe.id} execution evidence`);
    const historyExtent = requireRecord(execution.historyExtent, `${recipe.id} history extent`);
    const coveredExtent = requireRecord(execution.coveredExtent, `${recipe.id} covered extent`);
    if (execution.boundsChecked !== true
      || JSON.stringify(execution.workgroupSize) !== JSON.stringify([8, 8, 1])
      || !Array.isArray(execution.workgroupCount)
      || execution.workgroupCount.length !== 3
      || coveredExtent.width !== execution.workgroupCount[0] * 8
      || coveredExtent.height !== execution.workgroupCount[1] * 8
      || coveredExtent.width < historyExtent.width
      || coveredExtent.height < historyExtent.height) {
      throw new Error(`${recipe.id} compute coverage evidence is inconsistent`);
    }
    return Object.freeze({
      recipeId: recipe.id,
      viewport: recipe.viewport,
      historyExtent,
      workgroupSize: execution.workgroupSize,
      workgroupCount: execution.workgroupCount,
      coveredExtent,
      boundsChecked: execution.boundsChecked,
      alignedBytesPerRow: measured(expectedStride, "bytes-per-row", `${recipe.id} renderer transport readback`),
      transactionId: capture.evidence.transaction.transactionId,
      entryStateDigest: capture.evidence.transaction.entryStateDigest,
      restoredStateDigest: capture.evidence.transaction.restoredStateDigest,
    });
  });
  const odd = records[0];
  if (odd.historyExtent.width !== 641
    || odd.historyExtent.height !== 359
    || JSON.stringify(odd.workgroupCount) !== JSON.stringify([81, 45, 1])
    || odd.coveredExtent.width !== 648
    || odd.coveredExtent.height !== 360) {
    throw new Error("Frost odd-size probe does not prove full 641x359 dispatch coverage");
  }
  if (new Set(records.map(({ transactionId }) => transactionId)).size !== records.length) {
    throw new Error("Frost coverage probes reused a capture transaction");
  }
  return Object.freeze({
    verdict: "PASS",
    probes: Object.freeze(records),
    dprSweep: Object.freeze(records.slice(1).map(({ viewport }) => viewport.dpr)),
  });
}

export function validateFrostRouteMatrixEvidence(retained) {
  if (!(retained instanceof Map)) throw new TypeError("Frost route-matrix validation requires retained recipe captures");
  const routes = FROST_ROUTE_PROBE_RECIPES.map((recipe) => {
    const record = retained.get(recipe.id);
    if (!record) throw new Error(`Frost route-matrix evidence omits ${recipe.id}`);
    const { capture, data } = record;
    assertFrostRecipeCapture(recipe, capture, capture.evidence?.recipe?.setDigest);
    if (!(data instanceof Uint8Array) || data.byteLength !== capture.width * capture.height * 4) {
      throw new Error(`${recipe.id} retained route pixels do not match the captured extent`);
    }
    const state = capture.evidence?.effectiveState;
    if (JSON.stringify({
      scenario: state?.scenario,
      mechanism: state?.mechanism,
      tier: state?.tier,
      mode: state?.mode,
    }) !== JSON.stringify(recipe.route.startup)) {
      throw new Error(`${recipe.id} runtime state drifted from its fixed route startup contract`);
    }
    const range = rgbRange({ data });
    if (range < 2) throw new Error(`${recipe.id} retained route readback is blank or effectively constant`);
    return Object.freeze({
      recipeId: recipe.id,
      kind: recipe.route.kind,
      path: recipe.route.path,
      locks: recipe.route.locks,
      startup: recipe.route.startup,
      transactionId: capture.evidence.transaction.transactionId,
      normalizedRgbaSha256: capture.normalized.compactRgbaSha256,
      rgbRangeBytes: range,
    });
  });
  if (new Set(routes.map(({ transactionId }) => transactionId)).size !== routes.length) {
    throw new Error("Frost fixed routes reused a capture transaction");
  }
  return Object.freeze({ verdict: "PASS", routes: Object.freeze(routes) });
}

async function retainRecipeCapture(session, recipe, recipeSetDigest) {
  const filename = DIRECT_STANDARD_FILENAME_BY_RECIPE[recipe.id] ?? recipe.filename;
  const capture = await session.writeRecipeCapture(filename, recipe.id);
  assertFrostRecipeCapture(recipe, capture, recipeSetDigest);
  const padded = await session.readArtifact(capture.normalized.artifact.path);
  const data = unpackAlignedRows({
    source: padded,
    width: capture.width,
    height: capture.height,
    bytesPerPixel: 4,
    bytesPerRow: capture.normalized.bytesPerRow,
  });
  if (sha256(data) !== capture.normalized.compactRgbaSha256) {
    throw new Error(`${recipe.id} normalized readback changed before derivation`);
  }
  return Object.freeze({ recipe, capture, filename, width: capture.width, height: capture.height, data });
}

function diagnosticPixel(source, offset, panelIndex) {
  const r = source[offset];
  const a = source[offset + 3];
  if (panelIndex === 3) {
    const mask = Math.min(255, Math.round(r * 1.5));
    return [mask, mask, mask, 255];
  }
  return [
    Math.min(255, r * 3),
    Math.min(255, Math.abs(r - a) * 6),
    Math.min(255, a * 3),
    255,
  ];
}

export function composeFrostDiagnosticMosaic(sources) {
  if (!Array.isArray(sources) || sources.length !== 4) {
    throw new Error("Frost diagnostic mosaic requires four ordered recipe readbacks");
  }
  const [{ width, height }] = sources;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Frost diagnostic source dimensions are invalid");
  }
  for (const [index, source] of sources.entries()) {
    if (source.width !== width || source.height !== height || source.data?.byteLength !== width * height * 4) {
      throw new Error(`Frost diagnostic source ${index} dimensions or pixels drifted`);
    }
  }

  const data = new Uint8Array(width * height * 4);
  const splitX = Math.floor(width / 2);
  const splitY = Math.floor(height / 2);
  for (let y = 0; y < height; y += 1) {
    const bottom = y >= splitY;
    const localHeight = bottom ? height - splitY : splitY;
    const localY = bottom ? y - splitY : y;
    const sourceY = Math.min(height - 1, Math.floor(localY * height / localHeight));
    for (let x = 0; x < width; x += 1) {
      const right = x >= splitX;
      const localWidth = right ? width - splitX : splitX;
      const localX = right ? x - splitX : x;
      const sourceX = Math.min(width - 1, Math.floor(localX * width / localWidth));
      const panelIndex = (bottom ? 2 : 0) + (right ? 1 : 0);
      const sourceOffset = (sourceY * width + sourceX) * 4;
      const outputOffset = (y * width + x) * 4;
      data.set(diagnosticPixel(sources[panelIndex].data, sourceOffset, panelIndex), outputOffset);
    }
  }
  return Object.freeze({
    width,
    height,
    data,
    recipe: Object.freeze({
      kind: "frost-diagnostic-mosaic-v1",
      layout: "two-by-two-nearest",
      panelOrder: DIAGNOSTIC_RECIPE_IDS,
      historyTransform: "R*3, abs(R-A)*6, A*3, opaque",
      maskTransform: "R*1.5 grayscale, opaque",
      sourcePixels: "retained normalized native-WebGPU readbacks",
    }),
  });
}

export function rgbDifferenceMetrics(reference, candidate) {
  if (reference?.width !== candidate?.width
    || reference?.height !== candidate?.height
    || reference?.data?.byteLength !== candidate?.data?.byteLength) {
    throw new Error("Frost RGB comparison inputs must have equal dimensions and byte lengths");
  }
  let total = 0;
  let maximum = 0;
  let changedPixels = 0;
  const pixelCount = reference.width * reference.height;
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    const difference = (
      Math.abs(reference.data[offset] - candidate.data[offset])
      + Math.abs(reference.data[offset + 1] - candidate.data[offset + 1])
      + Math.abs(reference.data[offset + 2] - candidate.data[offset + 2])
    ) / 3;
    total += difference;
    maximum = Math.max(maximum, difference);
    if (difference > 0) changedPixels += 1;
  }
  return Object.freeze({
    meanRgbBytes: total / pixelCount,
    maxRgbBytes: maximum,
    changedPixels,
    changedFraction: changedPixels / pixelCount,
  });
}

function rgbRange(source) {
  let minimum = 255;
  let maximum = 0;
  for (let offset = 0; offset < source.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      minimum = Math.min(minimum, source.data[offset + channel]);
      maximum = Math.max(maximum, source.data[offset + channel]);
    }
  }
  return maximum - minimum;
}

function measured(value, unit, source) {
  return Object.freeze({ value, unit, label: "Measured", source });
}

function gated(value, unit, source) {
  return Object.freeze({ value, unit, label: "Gated", source });
}

function lifecycleCycleSnapshot(snapshot, index) {
  const beforeResources = requireRecord(snapshot.resourcesBeforeDispose, `Frost lifecycle cycle ${index} resources before dispose`);
  const afterResources = requireRecord(snapshot.resourcesAfterDispose, `Frost lifecycle cycle ${index} resources after dispose`);
  const beforeMetrics = requireRecord(snapshot.beforeDispose, `Frost lifecycle cycle ${index} metrics before dispose`);
  const afterMetrics = requireRecord(snapshot.afterDispose, `Frost lifecycle cycle ${index} metrics after dispose`);
  const dispose = requireRecord(snapshot.dispose, `Frost lifecycle cycle ${index} dispose result`);
  const disposeEvidence = requireRecord(dispose.evidence, `Frost lifecycle cycle ${index} dispose evidence`);
  const settle = requireRecord(snapshot.settle, `Frost lifecycle cycle ${index} settle result`);
  if (snapshot.rowType !== "settled-lifecycle-cycle-v2" || snapshot.cycle !== index) {
    throw new Error(`Frost lifecycle cycle ${index} is not a continuous typed row`);
  }
  if (dispose.status !== "PASS" || dispose.completed !== true || disposeEvidence.status !== "PASS") {
    throw new Error(`Frost lifecycle cycle ${index} did not dispose successfully`);
  }
  if (settle.status !== "PASS" || settle.observedAnimationFrames < 2 || settle.queueSettled !== true
    || !Array.isArray(settle.delayedErrors) || settle.delayedErrors.length !== 0) {
    throw new Error(`Frost lifecycle cycle ${index} did not settle without delayed errors`);
  }
  if (afterMetrics.disposed !== true || afterMetrics.storageBytes !== 0
    || afterMetrics.labOwnedListenerCount !== 0 || afterMetrics.deviceLostObserved !== false
    || !Array.isArray(afterMetrics.deviceErrors) || afterMetrics.deviceErrors.length !== 0) {
    throw new Error(`Frost lifecycle cycle ${index} retained runtime state or device errors`);
  }
  for (const [key, value] of [
    ["retainedTargetBytes", afterResources.retainedTargetBytes],
    ["retainedStorageBytes", afterResources.retainedStorageBytes],
    ["retainedMaterialCount", afterResources.retainedMaterialCount],
    ["retainedControlCount", afterResources.retainedControlCount],
    ["retainedListenerCount", afterResources.retainedListenerCount],
  ]) {
    if (value !== 0) throw new Error(`Frost lifecycle cycle ${index} has nonzero ${key}`);
  }
  requireSha256(disposeEvidence.rendererStateBeforeDigest, `Frost lifecycle cycle ${index} renderer-state before digest`);
  requireSha256(disposeEvidence.rendererStateAfterDigest, `Frost lifecycle cycle ${index} renderer-state after digest`);
  if (disposeEvidence.rendererStateDisposition !== "OWNED_RENDERER_DISPOSED") {
    throw new Error(`Frost lifecycle cycle ${index} did not dispose its owned renderer`);
  }
  if (beforeResources.opaqueRendererInternalResidency !== "NOT_CLAIMED"
    || afterResources.opaqueRendererInternalResidency !== "NOT_CLAIMED") {
    throw new Error(`Frost lifecycle cycle ${index} overclaims opaque renderer residency`);
  }
  const storageBytes = beforeResources.residentStorageBytes;
  if (!Number.isFinite(storageBytes) || storageBytes <= 0 || beforeMetrics.storageBytes !== storageBytes) {
    throw new Error(`Frost lifecycle cycle ${index} storage inventory does not reconcile`);
  }
  return Object.freeze({
    rowType: "settled-lifecycle-cycle-v2",
    disposeStatus: "PASS",
    cycle: measured(index, "cycle-index", "fresh Frost lifecycle controller sequence"),
    beforeRendererBytes: measured(storageBytes, "bytes", "enumerated lab-owned Frost storage before disposal; opaque renderer residency not claimed"),
    afterRendererBytes: measured(0, "bytes", "enumerated lab-owned Frost resources after owned-renderer disposal"),
    targetBytes: measured(0, "bytes", "no explicit persistent lab-owned render target; renderer internals not claimed"),
    storageBytes: measured(storageBytes, "bytes", "runtime Frost storage resource plan"),
    retainedTargetBytes: measured(0, "bytes", "post-disposal Frost resource snapshot"),
    retainedStorageBytes: measured(0, "bytes", "post-disposal Frost resource snapshot"),
    retainedListenerCount: measured(0, "count", "post-disposal Frost listener snapshot"),
    retainedControlCount: measured(0, "count", "post-disposal Frost control snapshot"),
    retainedMaterialCount: measured(0, "count", "post-disposal Frost material snapshot"),
    postDisposeErrorCount: measured(0, "count", "two-frame settled device and page error observation"),
    settleAnimationFrames: measured(settle.observedAnimationFrames, "animation-frame-count", "browser requestAnimationFrame settlement"),
    rendererStateDisposition: disposeEvidence.rendererStateDisposition,
    rendererStateBeforeDigest: disposeEvidence.rendererStateBeforeDigest,
    rendererStateAfterDigest: disposeEvidence.rendererStateAfterDigest,
    deviceLossObserved: false,
  });
}

export function validateFrostLifecycleEvidence(profile) {
  requireRecord(profile, "Frost lifecycle profile");
  if (profile.cycles !== 50 || !Array.isArray(profile.snapshots) || profile.snapshots.length !== 50) {
    throw new Error("Frost lifecycle evidence requires exactly 50 fresh-controller snapshots");
  }
  const cycleSnapshots = Object.freeze(profile.snapshots.map(lifecycleCycleSnapshot));
  const storageBefore = cycleSnapshots[0].storageBytes.value;
  const deviceErrors = profile.snapshots.flatMap((snapshot) => snapshot.afterDispose?.deviceErrors ?? []);
  if (deviceErrors.length !== 0) throw new Error("Frost lifecycle evidence contains device errors");
  return Object.freeze({
    verdict: "PASS",
    operations: Object.freeze(["create", "render", "resize", "mode", "tier", "dispose"]),
    cycles: measured(50, "cycle-count", "fresh native-WebGPU Frost controller lifecycle run"),
    cycleSnapshots,
    before: Object.freeze({
      targetBytes: measured(0, "bytes", "explicit persistent lab-owned targets before cycle sequence"),
      storageBytes: measured(storageBefore, "bytes", "first fresh-controller Frost storage inventory"),
    }),
    after: Object.freeze({
      targetBytes: measured(0, "bytes", "settled post-disposal retained target bytes"),
      storageBytes: measured(0, "bytes", "settled post-disposal retained storage bytes"),
    }),
    gates: Object.freeze({
      targetBytes: gated(0, "bytes", "no retained lab-owned target growth allowed"),
      storageBytes: gated(0, "bytes", "no retained lab-owned storage growth allowed"),
    }),
    trend: Object.freeze({
      targetBytesPerCycle: measured(0, "bytes-per-cycle", "linear slope of 50 retained-target snapshots"),
      storageBytesPerCycle: measured(0, "bytes-per-cycle", "linear slope of 50 retained-storage snapshots"),
    }),
    deviceErrors: Object.freeze([]),
    limitations: Object.freeze(["Opaque renderer-internal byte residency is NOT_CLAIMED."]),
  });
}

export function validateFrostVisualDifferences(retained) {
  if (!(retained instanceof Map)) throw new TypeError("Frost visual validation requires retained recipe captures");
  const pair = (left, right) => rgbDifferenceMetrics(retained.get(left), retained.get(right));
  const finalNoPost = pair("final.design", "no-post.design");
  const seeds = pair("seed-0001.final", "seed-9e3779b9.final");
  const temporal = pair("temporal.t000", "temporal.t001");
  const cameraNearDesign = pair("camera.near", "camera.design");
  const cameraDesignFar = pair("camera.design", "camera.far");
  const diagnosticRanges = Object.fromEntries(DIAGNOSTIC_RECIPE_IDS.map((id) => [id, rgbRange(retained.get(id))]));

  const failures = [];
  if (finalNoPost.meanRgbBytes < FROST_VISUAL_DIFFERENCE_GATES.finalNoPostMeanRgbBytes) failures.push("final/no-post mean difference");
  if (seeds.meanRgbBytes < FROST_VISUAL_DIFFERENCE_GATES.seedMeanRgbBytes) failures.push("seed mean difference");
  if (seeds.changedFraction < FROST_VISUAL_DIFFERENCE_GATES.seedChangedFraction) failures.push("seed changed-pixel coverage");
  if (temporal.changedFraction < FROST_VISUAL_DIFFERENCE_GATES.temporalChangedFraction) failures.push("temporal changed-pixel coverage");
  if (temporal.maxRgbBytes < FROST_VISUAL_DIFFERENCE_GATES.temporalMaxRgbBytes) failures.push("temporal maximum difference");
  if (cameraNearDesign.meanRgbBytes < FROST_VISUAL_DIFFERENCE_GATES.cameraMeanRgbBytes) failures.push("near/design camera difference");
  if (cameraDesignFar.meanRgbBytes < FROST_VISUAL_DIFFERENCE_GATES.cameraMeanRgbBytes) failures.push("design/far camera difference");
  for (const [id, range] of Object.entries(diagnosticRanges)) {
    if (range < FROST_VISUAL_DIFFERENCE_GATES.diagnosticRgbRangeBytes) failures.push(`${id} RGB range`);
  }
  if (failures.length > 0) throw new Error(`Frost correctness captures miss visual gates: ${failures.join(", ")}`);

  return Object.freeze({
    verdict: "PASS",
    metrics: Object.freeze({
      finalNoPostMeanRgbBytes: measured(finalNoPost.meanRgbBytes, "mean-rgb-byte-difference", "final.design versus no-post.design"),
      seedMeanRgbBytes: measured(seeds.meanRgbBytes, "mean-rgb-byte-difference", "fixed-seed final pair"),
      seedChangedFraction: measured(seeds.changedFraction, "fraction-of-pixels", "fixed-seed final pair"),
      temporalChangedFraction: measured(temporal.changedFraction, "fraction-of-pixels", "temporal.t000 versus one-step temporal.t001"),
      temporalMaxRgbBytes: measured(temporal.maxRgbBytes, "max-rgb-byte-difference", "temporal.t000 versus one-step temporal.t001"),
      cameraNearDesignMeanRgbBytes: measured(cameraNearDesign.meanRgbBytes, "mean-rgb-byte-difference", "near versus design camera"),
      cameraDesignFarMeanRgbBytes: measured(cameraDesignFar.meanRgbBytes, "mean-rgb-byte-difference", "design versus far camera"),
      diagnosticRgbRanges: Object.freeze(Object.fromEntries(Object.entries(diagnosticRanges).map(([id, value]) => (
        [id, measured(value, "rgb-byte-range", `${id} retained native-WebGPU readback`)]
      )))),
    }),
    gates: Object.freeze({
      finalNoPostMeanRgbBytes: gated(FROST_VISUAL_DIFFERENCE_GATES.finalNoPostMeanRgbBytes, "mean-rgb-byte-difference", "frozen Frost correctness gate"),
      seedMeanRgbBytes: gated(FROST_VISUAL_DIFFERENCE_GATES.seedMeanRgbBytes, "mean-rgb-byte-difference", "frozen Frost correctness gate"),
      seedChangedFraction: gated(FROST_VISUAL_DIFFERENCE_GATES.seedChangedFraction, "fraction-of-pixels", "frozen Frost correctness gate"),
      temporalChangedFraction: gated(FROST_VISUAL_DIFFERENCE_GATES.temporalChangedFraction, "fraction-of-pixels", "frozen Frost correctness gate"),
      temporalMaxRgbBytes: gated(FROST_VISUAL_DIFFERENCE_GATES.temporalMaxRgbBytes, "max-rgb-byte-difference", "frozen Frost correctness gate"),
      cameraMeanRgbBytes: gated(FROST_VISUAL_DIFFERENCE_GATES.cameraMeanRgbBytes, "mean-rgb-byte-difference", "frozen Frost correctness gate"),
      diagnosticRgbRangeBytes: gated(FROST_VISUAL_DIFFERENCE_GATES.diagnosticRgbRangeBytes, "rgb-byte-range", "frozen Frost correctness gate"),
    }),
  });
}

async function writeDerivedMosaic(session, mosaic) {
  const png = encodeRgbaPng(mosaic);
  const rowBytes = mosaic.width * 4;
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
  const padded = new Uint8Array(bytesPerRow * mosaic.height);
  for (let row = 0; row < mosaic.height; row += 1) {
    padded.set(mosaic.data.subarray(row * rowBytes, (row + 1) * rowBytes), row * bytesPerRow);
  }
  const pngPath = "diagnostics.mosaic.png";
  const rawPath = "normalized-readbacks/diagnostics.mosaic.rgba8.padded.bin";
  const packedPath = "normalized-readbacks/diagnostics.mosaic.rgba8.compact.bin";
  await session.writeArtifact(pngPath, png);
  await session.writeArtifact(rawPath, padded);
  await session.writeArtifact(packedPath, mosaic.data);
  return Object.freeze({
    id: "diagnostics.mosaic",
    status: "CAPTURED",
    filename: pngPath,
    width: mosaic.width,
    height: mosaic.height,
    sourceCaptures: DIAGNOSTIC_FILENAMES,
    derivation: mosaic.recipe,
    file: Object.freeze({ path: pngPath, sha256: sha256(png), byteLength: png.byteLength }),
    pixelEvidence: Object.freeze({
      png: Object.freeze({
        path: pngPath,
        sha256: sha256(png),
        byteLength: png.byteLength,
        derivedFromPackedRgbaSha256: sha256(mosaic.data),
      }),
      normalized: Object.freeze({
        rawArtifact: Object.freeze({ path: rawPath, sha256: sha256(padded), byteLength: padded.byteLength }),
        packedArtifact: Object.freeze({ path: packedPath, sha256: sha256(mosaic.data), byteLength: mosaic.data.byteLength }),
        packedRgbaSha256: sha256(mosaic.data),
        packedByteLength: mosaic.data.byteLength,
        paddedBytesPerRow: bytesPerRow,
        width: mosaic.width,
        height: mosaic.height,
        rowBytes,
        bytesPerRow,
        origin: "top-left",
        paddingVerifiedZero: true,
      }),
    }),
  });
}

export async function captureLab(session) {
  if (session?.profile !== "correctness" || session?.automationSurface !== "playwright-headless-chromium") {
    throw new Error("Frost correctness recipes require the deterministic Playwright capture lane");
  }
  const description = await session.controllerCall("describeCaptureRecipes");
  requireSha256(description?.recipeSetDigest, "Frost recipe-set digest");
  if (JSON.stringify(description.recipes?.map(({ id }) => id)) !== JSON.stringify(FROST_CAPTURE_RECIPES.map(({ id }) => id))) {
    throw new Error("Frost controller recipe inventory drifted from the hook contract");
  }
  if (JSON.stringify(description.coverageProbes?.map(({ id }) => id)) !== JSON.stringify(FROST_COVERAGE_PROBE_RECIPES.map(({ id }) => id))) {
    throw new Error("Frost controller coverage-probe inventory drifted from the hook contract");
  }
  if (JSON.stringify(description.routeProbes?.map(({ id }) => id)) !== JSON.stringify(FROST_ROUTE_PROBE_RECIPES.map(({ id }) => id))) {
    throw new Error("Frost controller route-probe inventory drifted from the hook contract");
  }

  const retained = new Map();
  const captures = [];
  for (const recipe of [...FROST_CAPTURE_RECIPES, ...FROST_COVERAGE_PROBE_RECIPES, ...FROST_ROUTE_PROBE_RECIPES]) {
    const record = await retainRecipeCapture(session, recipe, description.recipeSetDigest);
    retained.set(recipe.id, record);
    captures.push(Object.freeze({
      filename: record.filename,
      recipeId: recipe.id,
      target: record.capture.target,
      captureMode: record.capture.captureMode,
      pngSha256: record.capture.png.sha256,
      normalizedSha256: record.capture.normalized.artifact.sha256,
      transactionId: record.capture.evidence.transaction.transactionId,
    }));
  }

  const mosaic = composeFrostDiagnosticMosaic(DIAGNOSTIC_RECIPE_IDS.map((id) => retained.get(id)));
  const mosaicOutput = await writeDerivedMosaic(session, mosaic);
  const visualDifferences = validateFrostVisualDifferences(retained);
  const coverageEvidence = validateFrostCoverageEvidence(retained);
  const routeMatrixEvidence = validateFrostRouteMatrixEvidence(retained);
  const lifecycleEvidence = validateFrostLifecycleEvidence(await session.controllerCall("runLifecycleProfile", 50));
  const capturesWithEvidence = [...retained.values()].map((record) => ({
    target: record.capture.target,
    width: record.capture.width,
    height: record.capture.height,
    evidence: record.capture.evidence,
  }));
  const normativeArtifacts = buildFrostNormativeArtifacts({
    runtime: session.runtime,
    captures: capturesWithEvidence,
    visualDifferences,
    coverageEvidence,
    routeMatrixEvidence,
    lifecycleEvidence,
  });
  for (const [path, artifact] of Object.entries(normativeArtifacts)) {
    await session.writeArtifact(path, jsonBytes(artifact));
  }
  return Object.freeze({
    recipeSetDigest: description.recipeSetDigest,
    captures: Object.freeze(captures),
    standardOutputs: Object.freeze([mosaicOutput]),
    visualDifferences,
    coverageEvidence,
    routeMatrixEvidence,
    lifecycleEvidence,
    normativeArtifacts: Object.freeze(Object.keys(normativeArtifacts)),
  });
}

export default captureLab;
