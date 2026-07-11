import assert from "node:assert/strict";

import { alignedBytesPerRow } from "../../../labs/runtime/aligned-readback.mjs";
import { normalizePixelCapture } from "../../../scripts/capture-lab-browser.mjs";
import {
  CORPUS_CAPTURE_PLAN,
  captureLab,
  validateCorpusCaptureMetadata,
} from "./capture-hook.mjs";

const width = 641;
const height = 3;
const bytesPerPixel = 4;
const rowBytes = width * bytesPerPixel;
const sourceBytesPerRow = alignedBytesPerRow(width, bytesPerPixel);
const fullSourceByteLength = sourceBytesPerRow * height;
const padded = new Uint8Array(fullSourceByteLength);
const expected = new Uint8Array(rowBytes * height);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < rowBytes; x += 1) {
    const value = (x * 17 + y * 53) & 0xff;
    padded[y * sourceBytesPerRow + x] = value;
    expected[y * rowBytes + x] = value;
  }
}

const payload = {
  target: "presentation",
  width,
  height,
  bytesPerPixel,
  rowBytes,
  bytesPerRow: sourceBytesPerRow,
  sourceBytesPerRow,
  sourceByteLength: padded.byteLength,
  format: "rgba8unorm",
  colorManaged: true,
  outputColorSpace: "srgb",
  pixels: padded,
};
const normalized = normalizePixelCapture(payload);
assert.equal(normalized.sourceLayout, "padded");
assert.equal(normalized.bytesPerRow, rowBytes, "transport rows must normalize to compact RGBA8");
assert.equal(normalized.sourceBytesPerRow, sourceBytesPerRow, "actual aligned GPU-copy stride must remain explicit");
assert.equal(normalized.sourceByteLength, fullSourceByteLength);
assert.deepEqual([...normalized.data], [...expected], "padded rows must unpack without padding contamination");

const pipeline = {
  owner: "WebGPURenderer",
  sceneRendersPerFrame: 1,
  finalOutputOwner: "renderer",
  outputColorSpace: "srgb",
};
const evidenceRecord = validateCorpusCaptureMetadata(normalized, pipeline);
assert.equal(evidenceRecord.packedBytesPerRow, rowBytes);
assert.equal(evidenceRecord.sourceRowStride, sourceBytesPerRow);
assert.equal(evidenceRecord.outputColorSpace, "srgb");
assert.equal(evidenceRecord.captureSource, "native-webgpu-render-target-readback");

const shortPadded = padded.subarray(0, sourceBytesPerRow * (height - 1) + rowBytes);
const shortNormalized = normalizePixelCapture({
  ...payload,
  sourceByteLength: shortPadded.byteLength,
  pixels: shortPadded,
});
assert.equal(shortNormalized.sourceLayout, "padded");
validateCorpusCaptureMetadata(shortNormalized, pipeline);

const aliasOnly = { ...payload, sourceRowStride: sourceBytesPerRow };
delete aliasOnly.bytesPerRow;
delete aliasOnly.sourceBytesPerRow;
assert.throws(
  () => normalizePixelCapture(aliasOnly),
  /must report bytesPerRow or sourceBytesPerRow/,
  "a noncanonical sourceRowStride alias must not replace the capture ABI",
);

const invalidStride = sourceBytesPerRow + 1;
assert.throws(
  () => normalizePixelCapture({
    ...payload,
    bytesPerRow: invalidStride,
    sourceBytesPerRow: invalidStride,
    sourceByteLength: invalidStride * height,
    pixels: new Uint8Array(invalidStride * height),
  }),
  /does not satisfy WebGPU copy alignment/,
  "unaligned source strides must fail",
);

const compactMasquerade = normalizePixelCapture({
  ...payload,
  pixels: expected,
});
assert.equal(compactMasquerade.sourceLayout, "compacted-from-padded");
assert.throws(
  () => validateCorpusCaptureMetadata(compactMasquerade, pipeline),
  /transport length|padded render-target readback/,
  "compact pixels or screenshots must not masquerade as preserved padded readback evidence",
);

assert.throws(
  () => validateCorpusCaptureMetadata(normalized, { ...pipeline, outputColorSpace: "display-p3" }),
  /explicit sRGB metadata/,
  "capture output encoding must agree with the renderer output owner",
);

const state = {
  subjectId: "potted-bonsai",
  mode: "action-ready",
  tier: "budgeted",
  camera: "design",
  seed: 1,
  time: 0,
};
let completedFrames = 0;
let explicitRenderCalls = 0;
const written = [];
const fakeSession = {
  url: "http://127.0.0.1/corpus/?capture=1&profile=correctness",
  async controllerCall(method, ...args) {
    if (method === "setSubject") state.subjectId = args[0];
    else if (method === "setTier") state.tier = args[0];
    else if (method === "setSeed") state.seed = args[0];
    else if (method === "setCamera") state.camera = args[0];
    else if (method === "setMode") state.mode = args[0];
    else if (method === "setTime") state.time = args[0];
    else if (method === "renderOnce") {
      explicitRenderCalls += 1;
      completedFrames += 1;
    } else if (method === "getMetrics") {
      return {
        ...state,
        scenario: state.subjectId,
        backend: "webgpu",
        nativeWebGPU: true,
        initialized: true,
        firstFrameCompleted: completedFrames > 0,
        renderSubmissions: completedFrames,
        completedFrames,
        lastFrameError: null,
        rendererInfo: { rendererType: "WebGPURenderer", backendType: "WebGPUBackend", threeRevision: "185" },
      };
    } else if (method === "describePipeline") return pipeline;
    else if (method === "getRuntimeContract") {
      return {
        subjectId: state.subjectId,
        targetContractId: state.subjectId,
        mode: state.mode,
        tier: state.tier,
        nodeIds: ["root"],
        socketIds: ["socket"],
        colliderIds: ["collider"],
        destructionGroupIds: ["destruction"],
        protectedNodeIds: ["root"],
        protectedSocketIds: ["socket"],
        protectedColliderIds: ["collider"],
        protectedDestructionGroupIds: ["destruction"],
        socketBindings: [],
        colliderConstructionInputs: [{}],
        physicsMaterialBindings: [],
        destructionGroupRecords: [],
        physicsAuthority: "authoring-input-only",
        canonicalPhysicsProxyStatus: "blocked pending PhysicsContext",
        motionOwner: state.mode === "action-ready" ? "target procedural transform timeline" : "frozen authored pose",
      };
    } else throw new Error(`unexpected fake controller method ${method}`);
    return true;
  },
  async writeCapture(filename, target) {
    written.push(filename);
    completedFrames += 1;
    return { ...normalized, target };
  },
};
const hookResult = await captureLab(fakeSession);
assert.equal(hookResult.evidenceStatus, "INSUFFICIENT_EVIDENCE");
assert.equal(hookResult.frameOwnership.owner, "capture-harness");
assert.equal(hookResult.captures.length, CORPUS_CAPTURE_PLAN.length);
assert.deepEqual(written, CORPUS_CAPTURE_PLAN.map(({ filename }) => filename));
assert.equal(explicitRenderCalls, 2, "the hook may initialize and restore explicitly, but each planned image must use only writeCapture's render");
assert.equal(completedFrames, CORPUS_CAPTURE_PLAN.length + 2);

console.log(JSON.stringify({
  ok: true,
  width,
  height,
  rowBytes,
  sourceBytesPerRow,
  sourceByteLength: fullSourceByteLength,
  sourceLayout: normalized.sourceLayout,
  capturePlan: hookResult.captures.length,
  exclusiveFrameOwner: hookResult.frameOwnership.owner,
}, null, 2));
