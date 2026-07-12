import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { alignedBytesPerRow } from "../../../labs/runtime/aligned-readback.mjs";
import { normalizePixelCapture } from "../../../scripts/capture-lab-browser.mjs";
import { encodeRgbaPng } from "../../../scripts/lib/png-rgba.mjs";
import {
  CORPUS_CAPTURE_PLAN,
  CORPUS_STANDARD_RASTER_CONTRACT,
  CORPUS_STANDARD_OUTPUT_PLAN,
  captureLab,
  computeCorpusStandardDerivationSha256,
  computeCaptureSourceClosure,
  recomputeCaptureSourceClosure,
  retainCorpusPixelEvidence,
  validateCaptureSourceClosure,
  validateCorpusCaptureMetadata,
  validateCorpusStandardDerivation,
} from "./capture-hook.mjs";
import {
  computeCorpusExecutableSourceClosure,
  extractCorpusExecutableSourceReferences,
  generateTrustedRuntimeSourceManifest,
  validateCorpusExecutableSourceClosure,
} from "./generate-trusted-runtime-source-manifest.mjs";
import {
  assertDistinctPngRasters,
  assertMeaningfulRgbaRaster,
  decodePngRaster,
  validatePngRgbaBinding,
} from "./png-raster.mjs";

const width = 641;
const height = 3;
const SCULPT_TARGET_COUNT_FOR_TESTS = new Set(CORPUS_CAPTURE_PLAN.map(({ state }) => state.subjectId)).size;
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

function withIndependentReadbackRecords(capture, transportData, transportStride) {
  const normalizedPadded = new Uint8Array(sourceBytesPerRow * height);
  for (let row = 0; row < height; row += 1) {
    normalizedPadded.set(
      capture.data.subarray(row * rowBytes, (row + 1) * rowBytes),
      row * sourceBytesPerRow,
    );
  }
  return {
    ...capture,
    transportByteLength: transportData.byteLength,
    transport: {
      layout: {
        width,
        height,
        format: "rgba8unorm",
        origin: "top-left",
        bytesPerRow: transportStride,
        byteLength: transportData.byteLength,
      },
      data: transportData,
    },
    normalized: {
      layout: "cpu-normalized-padded-rgba8",
      alignmentBytes: 256,
      bytesPerRow: sourceBytesPerRow,
      byteLength: normalizedPadded.byteLength,
      origin: "top-left",
      orientationTransform: "none",
      compact: { bytesPerRow: rowBytes, byteLength: capture.data.byteLength },
      compactRgbaSha256: createHash("sha256").update(capture.data).digest("hex"),
      data: capture.data,
      paddedData: normalizedPadded,
    },
  };
}

const pipeline = {
  owner: "WebGPURenderer",
  sceneRendersPerFrame: 1,
  passes: ["forward-scene"],
  postprocessing: false,
  finalOutputOwner: "renderer",
  outputColorSpace: "srgb",
};
const completeMetadataCapture = withIndependentReadbackRecords(normalized, padded, sourceBytesPerRow);
const evidenceRecord = validateCorpusCaptureMetadata(completeMetadataCapture, pipeline);
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
validateCorpusCaptureMetadata(
  withIndependentReadbackRecords(shortNormalized, shortPadded, sourceBytesPerRow),
  pipeline,
);

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
  /independent transport and normalized readback records/,
  "compact pixels or screenshots must not masquerade as preserved padded readback evidence",
);

assert.throws(
  () => validateCorpusCaptureMetadata(completeMetadataCapture, { ...pipeline, outputColorSpace: "display-p3" }),
  /explicit sRGB metadata/,
  "capture output encoding must agree with the renderer output owner",
);

const constantRgba = new Uint8Array(4 * 4 * 4);
for (let offset = 3; offset < constantRgba.length; offset += 4) constantRgba[offset] = 255;
assert.throws(
  () => assertMeaningfulRgbaRaster({ width: 4, height: 4, rgba: constantRgba }, "constant fixture"),
  /blank or constant/,
  "constant readback data must not satisfy pixel evidence",
);

const bindingRgba = Uint8Array.from([
  10, 20, 30, 255,
  40, 50, 60, 255,
  70, 80, 90, 255,
  100, 110, 120, 255,
]);
const bindingPng = encodeRgbaPng({ width: 2, height: 2, data: bindingRgba });
validatePngRgbaBinding(bindingPng, bindingRgba, "valid binding fixture");
const mismatchedRgba = Uint8Array.from(bindingRgba);
mismatchedRgba[0] ^= 0xff;
assert.throws(
  () => validatePngRgbaBinding(bindingPng, mismatchedRgba, "mutated binding fixture"),
  /do not match retained raw RGBA/,
  "a PNG/raw pixel mismatch must fail",
);
assert.throws(
  () => assertDistinctPngRasters(bindingPng, bindingPng, "duplicated diagnostic fixture"),
  /duplicated or materially indistinguishable/,
  "a renamed duplicate must not satisfy final/diagnostic evidence",
);

const mismatchedPaddedBytesPerRow = 256;
const mismatchedPadded = new Uint8Array(mismatchedPaddedBytesPerRow * 2);
for (let row = 0; row < 2; row += 1) {
  mismatchedPadded.set(mismatchedRgba.subarray(row * 8, (row + 1) * 8), row * mismatchedPaddedBytesPerRow);
}
const mismatchArtifacts = new Map([["mismatch.png", bindingPng]]);
await assert.rejects(
  () => retainCorpusPixelEvidence({
    async readArtifact(path) {
      const bytes = mismatchArtifacts.get(path);
      if (!bytes) throw new Error(`missing mismatch fixture ${path}`);
      return bytes;
    },
    async writeArtifact(path, bytes) {
      mismatchArtifacts.set(path, Buffer.from(bytes));
    },
  }, {
    filename: "mismatch.png",
    capture: {
      width: 2,
      height: 2,
      bytesPerPixel: 4,
      bytesPerRow: 8,
      origin: "top-left",
      transport: {
        layout: { width: 2, height: 2, format: "rgba8unorm", origin: "top-left", bytesPerRow: 8, byteLength: mismatchedRgba.byteLength },
        data: mismatchedRgba,
      },
      normalized: {
        layout: "cpu-normalized-padded-rgba8",
        bytesPerRow: mismatchedPaddedBytesPerRow,
        byteLength: mismatchedPadded.byteLength,
        origin: "top-left",
        compact: { bytesPerRow: 8, byteLength: mismatchedRgba.byteLength },
        compactRgbaSha256: createHash("sha256").update(mismatchedRgba).digest("hex"),
        data: mismatchedRgba,
        paddedData: mismatchedPadded,
      },
    },
  }),
  /PNG pixels do not match retained raw RGBA/,
  "a valid nonconstant PNG must fail when it differs from independently retained normalized GPU pixels",
);

const canonicalSourceClosure = computeCorpusExecutableSourceClosure();
assert.equal(canonicalSourceClosure.threeRevision, "0.185.1");
assert.equal(validateCorpusExecutableSourceClosure(canonicalSourceClosure), true);
assert.deepEqual(
  computeCaptureSourceClosure(),
  canonicalSourceClosure,
  "the capture hook must expose the canonical executable source closure without a parallel implementation",
);
assert.deepEqual(
  recomputeCaptureSourceClosure(),
  canonicalSourceClosure,
  "the shared capture runner must be able to recompute the source closure before and after capture",
);
assert.equal(validateCaptureSourceClosure(canonicalSourceClosure), true);
const checkedGeneratedModule = await generateTrustedRuntimeSourceManifest({ checkOnly: true });
const generatedModuleBytes = readFileSync(new URL("./trusted-runtime-source-manifest.generated.js", import.meta.url));
assert.equal(
  checkedGeneratedModule.generatedModuleSha256,
  createHash("sha256").update(generatedModuleBytes).digest("hex"),
  "generator status must hash the exact module bytes verified after write or during --check",
);
assert(canonicalSourceClosure.files.some(({ repositoryPath }) => repositoryPath.endsWith("immutable-route-server.mjs")));
assert.equal(
  canonicalSourceClosure.files.filter(({ repositoryPath }) => /\/(scenario|mechanism|tier|camera)\/.+\/index\.html$/.test(repositoryPath)).length,
  15,
  "all immutable physical wrapper bytes belong to the canonical closure",
);
assert.equal(
  canonicalSourceClosure.files.some(({ repositoryPath }) => repositoryPath.endsWith("trusted-runtime-source-manifest.generated.js")),
  false,
  "self-attestation output cannot recursively hash itself",
);
for (const mutableAcceptancePath of [
  "labs/demo-registry.json",
  "labs/canonical-targets.json",
  "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/lab.manifest.json",
]) {
  assert.equal(
    canonicalSourceClosure.files.some(({ repositoryPath }) => repositoryPath === mutableAcceptancePath),
    false,
    `${mutableAcceptancePath} is mutable acceptance metadata and cannot change the executable source closure`,
  );
}
const requiredTransitivePath = "labs/runtime/aligned-readback.mjs";
assert(canonicalSourceClosure.files.some(({ repositoryPath }) => repositoryPath === requiredTransitivePath));
assert.throws(
  () => validateCorpusExecutableSourceClosure({
    ...canonicalSourceClosure,
    files: canonicalSourceClosure.files.filter(({ repositoryPath }) => repositoryPath !== requiredTransitivePath),
  }),
  /omitted transitive dependencies/,
  "omitting a transitive readback dependency must invalidate source provenance",
);
assert.throws(
  () => extractCorpusExecutableSourceReferences("fixture.mjs", 'import "https://cdn.example.invalid/runtime.js";'),
  /forbidden external executable reference/,
  "HTTP executable dependencies must not escape the source closure",
);
assert.throws(
  () => extractCorpusExecutableSourceReferences("fixture.html", '<script src="//cdn.example.invalid/runtime.js"></script>'),
  /forbidden external executable reference/,
  "protocol-relative executable dependencies must not escape the source closure",
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
const artifacts = new Map();

function filenameSeed(filename) {
  return Number.parseInt(createHash("sha256").update(filename).digest("hex").slice(0, 8), 16) >>> 0;
}

function fakeReadback(filename) {
  const seed = filenameSeed(filename);
  const compact = new Uint8Array(rowBytes * height);
  const transport = new Uint8Array(fullSourceByteLength);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      compact[offset] = (x * 17 + y * 31 + seed) & 0xff;
      compact[offset + 1] = (x * 7 + y * 53 + (seed >>> 8)) & 0xff;
      compact[offset + 2] = (x * 3 + y * 97 + (seed >>> 16)) & 0xff;
      compact[offset + 3] = 255;
      transport.set(compact.subarray(offset, offset + 4), y * sourceBytesPerRow + x * 4);
    }
  }
  return { compact, transport };
}

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
    const readback = fakeReadback(filename);
    const normalizedCapture = normalizePixelCapture({
      ...payload,
      origin: "top-left",
      pixels: readback.transport,
    });
    artifacts.set(filename, encodeRgbaPng({ width, height, data: normalizedCapture.data }));
    const normalizedPadded = new Uint8Array(sourceBytesPerRow * height);
    for (let row = 0; row < height; row += 1) {
      normalizedPadded.set(
        normalizedCapture.data.subarray(row * rowBytes, (row + 1) * rowBytes),
        row * sourceBytesPerRow,
      );
    }
    const normalizedPaddedSha256 = createHash("sha256").update(normalizedPadded).digest("hex");
    return {
      ...normalizedCapture,
      target,
      transportByteLength: readback.compact.byteLength,
      readbackSourceBytesPerRow: rowBytes,
      readbackSourceByteLength: readback.compact.byteLength,
      transport: {
        artifact: {
          path: `transport-readbacks/${filename.slice(0, -4)}.rgba8.bin`,
          sha256: `sha256:${createHash("sha256").update(readback.compact).digest("hex")}`,
          byteLength: readback.compact.byteLength,
        },
        layout: {
          width,
          height,
          format: "rgba8unorm",
          origin: "top-left",
          bytesPerRow: rowBytes,
          byteLength: readback.compact.byteLength,
        },
        data: readback.compact,
      },
      normalized: {
        artifact: {
          path: `normalized-readbacks/${filename.slice(0, -4)}.rgba8.padded.bin`,
          sha256: `sha256:${normalizedPaddedSha256}`,
          byteLength: normalizedPadded.byteLength,
        },
        layout: "cpu-normalized-padded-rgba8",
        alignmentBytes: 256,
        bytesPerRow: sourceBytesPerRow,
        byteLength: normalizedPadded.byteLength,
        origin: "top-left",
        orientationTransform: "none",
        compact: {
          bytesPerRow: rowBytes,
          byteLength: normalizedCapture.data.byteLength,
        },
        compactRgbaSha256: `sha256:${createHash("sha256").update(normalizedCapture.data).digest("hex")}`,
        data: normalizedCapture.data,
        paddedData: normalizedPadded,
      },
    };
  },
  async readArtifact(path) {
    const bytes = artifacts.get(path);
    if (!bytes) throw new Error(`missing fake artifact ${path}`);
    return bytes;
  },
  async writeArtifact(path, bytes) {
    artifacts.set(path, Buffer.from(bytes));
  },
};
const hookResult = await captureLab(fakeSession);
assert.equal(hookResult.evidenceStatus, "INSUFFICIENT_EVIDENCE");
assert.equal(hookResult.frameOwnership.owner, "capture-harness");
assert.equal(hookResult.captures.length, CORPUS_CAPTURE_PLAN.length);
assert.deepEqual(written, CORPUS_CAPTURE_PLAN.map(({ filename }) => filename));
assert.equal(explicitRenderCalls, 2, "the hook may initialize and restore explicitly, but each planned image must use only writeCapture's render");
assert.equal(completedFrames, CORPUS_CAPTURE_PLAN.length + 2);
assert.equal(hookResult.sourceClosure.sourceHash, canonicalSourceClosure.sourceHash);
assert.equal(hookResult.sourceClosure.files.length, canonicalSourceClosure.files.length);
assert.equal(hookResult.subjectFinals.length, SCULPT_TARGET_COUNT_FOR_TESTS);
assert.equal(hookResult.standardOutputs.length, CORPUS_STANDARD_OUTPUT_PLAN.length);
assert.deepEqual(
  [...new Set(CORPUS_STANDARD_OUTPUT_PLAN.map(({ status }) => status))].sort(),
  ["CAPTURED", "NOT_APPLICABLE"],
  "standard output plan forbids copied/renamed aliases",
);
assert.equal(
  CORPUS_STANDARD_OUTPUT_PLAN.filter(({ status }) => status === "NOT_APPLICABLE")
    .every(({ reason, graphProof }) => typeof reason === "string" && reason.length > 0 && graphProof),
  true,
  "every structural N/A needs a reason and graph proof",
);
for (const output of CORPUS_STANDARD_OUTPUT_PLAN.filter(({ status }) => status === "CAPTURED")) {
  assert(artifacts.has(output.filename), `${output.filename} must be written`);
  const standardRaster = decodePngRaster(artifacts.get(output.filename));
  assert.equal(standardRaster.width, CORPUS_STANDARD_RASTER_CONTRACT.width, `${output.filename} must be exactly 1200 pixels wide`);
  assert.equal(standardRaster.height, CORPUS_STANDARD_RASTER_CONTRACT.height, `${output.filename} must be exactly 800 pixels high`);
}
assert.equal(hookResult.captures.every(({ pixelEvidence }) => pixelEvidence.transport.retentionStatus === "retained"), true);
assert.equal(hookResult.captures.every(({ pixelEvidence }) => pixelEvidence.transport.rawArtifact?.sha256), true);
assert.equal(hookResult.captures.every((capture) => capture.data === undefined && capture.transport === undefined && capture.normalized === undefined), true, "serialized hook results retain refs and hashes, not duplicate byte arrays");
const firstPixelEvidence = hookResult.captures[0].pixelEvidence;
assert.equal(firstPixelEvidence.transport.bytesPerRow, rowBytes, "renderer-returned compact transport stride stays exact");
assert.equal(firstPixelEvidence.transport.origin, "top-left", "r185 native transport preserves top-left row origin");
assert.equal(firstPixelEvidence.normalized.paddedBytesPerRow, sourceBytesPerRow, "CPU-normalized padding is recorded separately");
assert.equal(firstPixelEvidence.normalized.orientationTransform, "none");
assert.notEqual(firstPixelEvidence.transport.rawArtifact.sha256, firstPixelEvidence.normalized.rawArtifact.sha256);
const finalPng = artifacts.get("final.design.png");
const diagnosticsPng = artifacts.get("diagnostics.mosaic.png");
const finalRaster = decodePngRaster(finalPng);
assert.equal(finalRaster.width, 1200);
assert.equal(finalRaster.height, 800);
assertDistinctPngRasters(finalPng, diagnosticsPng, "captured final/diagnostics", { minimumChangedPixelRatio: 0.01 });
const capturedSourceByFilename = new Map(hookResult.captures.map((capture) => [capture.filename, capture]));
for (const output of hookResult.standardOutputs.filter(({ status }) => status === "CAPTURED")) {
  assert.equal(validateCorpusStandardDerivation(output, capturedSourceByFilename), true);
  assert.equal(output.derivation.inputs.length, SCULPT_TARGET_COUNT_FOR_TESTS);
  assert.equal(output.derivation.layout.panelWidth, 400);
  assert.equal(output.derivation.resampling.kernel, "nearest-center-rgba8-v1");
  assert.equal(output.composition.byteForByteNativeBinding, false);
  assert.equal(output.composition.nativeTransportBinding, "not-applicable-derived-output");
  assert.equal(output.composition.syntheticFillPixels, 0);
  assert.equal(output.pixelEvidence.transport.retentionStatus, "not-applicable-derived-composite");
}

function mutateStandardDerivation(output, mutate) {
  const candidate = structuredClone(output);
  mutate(candidate.derivation);
  candidate.derivationSha256 = computeCorpusStandardDerivationSha256(candidate.derivation);
  return candidate;
}

const finalStandardOutput = hookResult.standardOutputs.find(({ id }) => id === "final.design");
assert.throws(
  () => validateCorpusStandardDerivation(mutateStandardDerivation(finalStandardOutput, (derivation) => {
    derivation.inputs[0].normalizedPackedRgbaSha256 = "0".repeat(64);
  }), capturedSourceByFilename),
  /input 0 hash binding mismatch/,
  "a rehashed derivation cannot forge a native input hash",
);
assert.throws(
  () => validateCorpusStandardDerivation(mutateStandardDerivation(finalStandardOutput, (derivation) => {
    derivation.inputs[1].panelRect.x += 1;
  }), capturedSourceByFilename),
  /input 1 path or panel rectangle mismatch/,
  "a rehashed derivation cannot move a panel rectangle",
);
assert.throws(
  () => validateCorpusStandardDerivation(mutateStandardDerivation(finalStandardOutput, (derivation) => {
    derivation.resampling.kernel = "bilinear-rgba8-v1";
  }), capturedSourceByFilename),
  /resampling kernel or policy differs/,
  "a rehashed derivation cannot substitute a different resampling kernel",
);
assert.throws(
  () => validateCorpusStandardDerivation(mutateStandardDerivation(finalStandardOutput, (derivation) => {
    derivation.output.pngSha256 = "f".repeat(64);
  }), capturedSourceByFilename),
  /derivation output dimensions or hash mismatch/,
  "a rehashed derivation cannot substitute a different output hash",
);
assert.throws(
  () => validateCorpusStandardDerivation(mutateStandardDerivation(finalStandardOutput, (derivation) => {
    derivation.inputs[1].normalizedRawArtifactPath = derivation.inputs[0].normalizedRawArtifactPath;
  }), capturedSourceByFilename),
  /duplicates or aliases another derivation artifact path/,
  "a rehashed derivation cannot alias two producers onto one artifact path",
);
const noPost = hookResult.standardOutputs.find(({ id }) => id === "no-post.design");
assert.equal(noPost.status, "NOT_APPLICABLE");
assert.deepEqual(noPost.graphProof, {
  pipelineOwner: "WebGPURenderer",
  sceneRendersPerFrame: 1,
  postProcessPasses: 0,
});
const cameraFar = hookResult.standardOutputs.find(({ id }) => id === "camera.far");
assert.deepEqual(cameraFar.graphProof, {
  cameraContractOwner: "CORPUS_CAMERAS",
  availableCameraIds: ["design", "profile", "attachment", "close-material"],
  omittedCameraId: "far",
});

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
