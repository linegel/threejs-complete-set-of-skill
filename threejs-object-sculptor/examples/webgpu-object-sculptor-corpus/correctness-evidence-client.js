import {
  CORPUS_CAPTURE_TARGET_IDS,
  CORPUS_NATIVE_READBACK_PLAN,
  CORPUS_STANDARD_RASTER_CONTRACT,
} from "./capture-plan.js";
import {
  CORPUS_CAPTURE_BUILD_REVISION,
  CORPUS_CAPTURE_SOURCE_HASH,
} from "./trusted-runtime-source-manifest.generated.js";

export const CORPUS_CORRECTNESS_EVIDENCE_KEY = "__CORPUS_CORRECTNESS_EVIDENCE__";
export const CORPUS_CORRECTNESS_RESULT_KEY = "__CORPUS_CORRECTNESS_EVIDENCE_RESULT__";
export const CORPUS_CORRECTNESS_ERROR_KEY = "__CORPUS_CORRECTNESS_EVIDENCE_ERROR__";
export const CORPUS_CORRECTNESS_QUERY = "?capture=1&profile=correctness&automationSurface=codex-in-app-browser";
export const CORPUS_CORRECTNESS_MAX_RETAINED_BYTES_PER_SUBJECT = 192 * 1024 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function compactCorpusCorrectnessRows(padded, width, height, bytesPerRow) {
  const rowBytes = width * 4;
  assert(Number.isInteger(bytesPerRow) && bytesPerRow >= rowBytes && bytesPerRow % 256 === 0, "normalized readback row stride must preserve WebGPU alignment");
  assert(padded.byteLength === bytesPerRow * height, "normalized readback must retain every padded row");
  const compact = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    compact.set(padded.subarray(row * bytesPerRow, row * bytesPerRow + rowBytes), row * rowBytes);
  }
  return compact;
}

function exactBootstrap(bootstrap) {
  assert(bootstrap?.enabled === true && bootstrap.surface === "correctness", "correctness evidence requires its trusted head bootstrap");
  const snapshot = bootstrap.snapshot();
  const request = corpusCorrectnessEvidenceRequest(snapshot.configuration?.search ?? "");
  assert(request.enabled === true, "correctness evidence query drifted");
  assert(snapshot.installed?.installedInHead === true && snapshot.installed?.appModulePresentAtInstall === false, "correctness observers must install in head before app.js");
  assert(snapshot.setupFailures?.length === 0, "correctness observer setup failed");
  for (const key of ["pageErrors", "consoleErrors", "unhandledRejections", "requestFailures", "gpuErrors"]) {
    assert(snapshot[key]?.events?.length === 0, `correctness evidence recorded ${key}`);
  }
  assert(snapshot.deviceLost?.monitorAttached === true, "correctness evidence did not attach a GPU device-loss monitor before renderer initialization");
  assert(snapshot.deviceLost?.events?.length === 0, "correctness evidence recorded GPU device loss");
  return snapshot;
}

export function corpusCorrectnessEvidenceRequest(search = "") {
  const params = new URLSearchParams(search);
  const allowed = new Set(["capture", "profile", "automationSurface", "subjectSegment", "autostart"]);
  for (const key of params.keys()) if (!allowed.has(key)) return Object.freeze({ enabled: false, subjectId: null, autostart: false });
  const one = (key, value) => params.getAll(key).length === 1 && params.get(key) === value;
  if (!one("capture", "1") || !one("profile", "correctness") || !one("automationSurface", "codex-in-app-browser")) {
    return Object.freeze({ enabled: false, subjectId: null, autostart: false });
  }
  const subjectId = params.get("subjectSegment");
  if (subjectId === null) {
    return Object.freeze({ enabled: params.getAll("autostart").length === 0, subjectId: null, autostart: false });
  }
  const valid = params.getAll("subjectSegment").length === 1
    && CORPUS_CAPTURE_TARGET_IDS.includes(subjectId)
    && one("autostart", "1");
  return Object.freeze({ enabled: valid, subjectId: valid ? subjectId : null, autostart: valid });
}

export function corpusCorrectnessEvidenceUrl(subjectId, base = "http://127.0.0.1:4174/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/index.html") {
  if (!CORPUS_CAPTURE_TARGET_IDS.includes(subjectId)) throw new RangeError(`unknown correctness subject ${subjectId}`);
  const url = new URL(base);
  url.search = CORPUS_CORRECTNESS_QUERY;
  url.searchParams.set("subjectSegment", subjectId);
  url.searchParams.set("autostart", "1");
  return url.href;
}

function appliedState(metrics, expected, filename) {
  for (const field of ["subjectId", "mode", "tier", "camera", "seed", "time"]) {
    assert(metrics[field] === expected[field], `${filename} applied ${field}=${metrics[field]} instead of ${expected[field]}`);
  }
  assert(metrics.runtimeProfile === "correctness", `${filename} did not use the correctness runtime profile`);
  assert(metrics.backendKind === "webgpu" && metrics.nativeWebGPU === true && metrics.initialized === true, `${filename} did not use initialized native WebGPU`);
  assert(metrics.lastFrameError == null && metrics.lastLifecycleError == null, `${filename} recorded a frame or lifecycle error`);
}

function identityEvidence(contract) {
  const list = (value) => Object.freeze([...(value ?? [])]);
  return Object.freeze({
    instanceId: contract.instanceId ?? null,
    instanceGeneration: contract.instanceGeneration ?? null,
    continuityStatus: contract.continuityStatus ?? contract.continuity?.status ?? null,
    effectiveToken: contract.continuityEvidence?.effectiveToken ?? contract.continuity?.token ?? null,
    nodeIds: list(contract.nodeIds),
    socketIds: list(contract.socketIds),
    colliderIds: list(contract.colliderIds),
    destructionGroupIds: list(contract.destructionGroupIds),
    protectedNodeIds: list(contract.protectedNodeIds),
    protectedSocketIds: list(contract.protectedSocketIds),
    protectedColliderIds: list(contract.protectedColliderIds),
    protectedDestructionGroupIds: list(contract.protectedDestructionGroupIds),
  });
}

async function retainCapture({ capture, filename, kind, state, artifacts }) {
  assert(capture?.target === kind, `${filename} capture target drifted`);
  assert(capture.backendKind === "webgpu" && capture.nativeWebGPU === true, `${filename} readback was not native WebGPU`);
  assert(capture.width === CORPUS_STANDARD_RASTER_CONTRACT.width && capture.height === CORPUS_STANDARD_RASTER_CONTRACT.height, `${filename} readback must be exactly 1200x800; received ${capture.width}x${capture.height}`);
  assert(capture.format === "rgba8unorm" && capture.bytesPerPixel === 4 && capture.origin === "top-left", `${filename} readback format/origin drifted`);
  assert(capture.outputColorSpace === "srgb" && capture.colorEncoding === "srgb", `${filename} output encoding drifted`);
  const transport = Uint8Array.from(capture.transport?.pixels ?? []);
  const normalized = Uint8Array.from(capture.normalized?.pixels ?? []);
  const transportLayout = capture.transport?.layout;
  const normalizedLayout = capture.normalized?.layout;
  assert(transportLayout?.byteLength === transport.byteLength && transport.byteLength > 0, `${filename} transport layout drifted`);
  assert(normalizedLayout?.byteLength === normalized.byteLength && normalized.byteLength > 0, `${filename} normalized layout drifted`);
  assert(transport.buffer !== normalized.buffer, `${filename} transport and normalized allocations alias`);
  const compact = compactCorpusCorrectnessRows(normalized, capture.width, capture.height, normalizedLayout.bytesPerRow);
  for (let row = 0; row < capture.height; row += 1) {
    const visibleTransportOffset = row * transportLayout.bytesPerRow;
    const compactOffset = row * capture.rowBytes;
    assert(transportLayout.bytesPerRow * row + capture.rowBytes <= transport.byteLength, `${filename} transport row ${row} is truncated`);
    for (let column = 0; column < capture.rowBytes; column += 1) {
      if (transport[visibleTransportOffset + column] !== compact[compactOffset + column]) {
        throw new Error(`${filename} transport and normalized visible bytes diverged at row ${row}, byte ${column}`);
      }
    }
  }
  const stem = filename.replace(/\.png$/, "");
  const paths = Object.freeze({
    transport: `correctness-readbacks/${state.subjectId}/transport/${stem}.rgba8unorm.bin`,
    normalized: `correctness-readbacks/${state.subjectId}/normalized/${stem}.rgba8unorm.padded.bin`,
  });
  for (const [path, bytes] of [[paths.transport, transport], [paths.normalized, normalized]]) {
    assert(!artifacts.has(path), `duplicate correctness artifact ${path}`);
    artifacts.set(path, bytes);
  }
  const [transportSha256, normalizedSha256, compactSha256] = await Promise.all([
    sha256Hex(transport),
    sha256Hex(normalized),
    sha256Hex(compact),
  ]);
  return Object.freeze({
    filename,
    kind,
    state,
    maskKind: capture.maskKind ?? null,
    semanticNodeIds: Object.freeze([...(capture.semanticNodeIds ?? [])]),
    width: capture.width,
    height: capture.height,
    format: capture.format,
    bytesPerPixel: capture.bytesPerPixel,
    origin: capture.origin,
    outputColorSpace: capture.outputColorSpace,
    transport: Object.freeze({ ...transportLayout, path: paths.transport, sha256: transportSha256 }),
    normalized: Object.freeze({ ...normalizedLayout, path: paths.normalized, sha256: normalizedSha256 }),
    compact: Object.freeze({
      bytesPerRow: capture.rowBytes,
      byteLength: compact.byteLength,
      sha256: compactSha256,
      retained: false,
      derivation: "row-pack exact retained normalized artifact using its recorded integer bytesPerRow",
    }),
  });
}

async function configure(controller, state) {
  await controller.setSubject(state.subjectId);
  await controller.setTier(state.tier);
  await controller.setSeed(state.seed);
  await controller.setCamera(state.camera);
  await controller.setMode(state.mode);
  await controller.setTime(state.time);
}

export function createCorpusCorrectnessEvidenceProducer({
  controller,
  bootstrap = globalThis.window?.__CORPUS_ROUTE_EVIDENCE_BOOTSTRAP__,
  disposeCorpus,
} = {}) {
  if (!controller || typeof controller.capturePixels !== "function") throw new TypeError("correctness evidence requires the public corpus controller");
  if (typeof disposeCorpus !== "function") throw new TypeError("correctness evidence requires explicit corpus disposal ownership");
  const completedSubjects = new Set();
  let retainedArtifacts = new Map();
  let activeSubject = null;
  let disposed = false;
  let finalTeardown = null;

  async function collectSubject(subjectId) {
    if (disposed) throw new Error("correctness evidence producer is disposed");
    if (!CORPUS_CAPTURE_TARGET_IDS.includes(subjectId)) throw new RangeError(`unknown correctness subject ${subjectId}`);
    if (activeSubject !== null) throw new Error(`correctness subject ${activeSubject} is already collecting`);
    if (retainedArtifacts.size !== 0) throw new Error("takeArtifacts() must release the previous subject segment before another subject is collected");
    if (completedSubjects.has(subjectId)) throw new Error(`${subjectId} correctness segment was already collected`);
    activeSubject = subjectId;
    const startedAt = new Date().toISOString();
    const startedAtMonotonicMs = performance.now();
    try {
      const observerBefore = exactBootstrap(bootstrap);
      await controller.ready();
      await controller.resize(CORPUS_STANDARD_RASTER_CONTRACT.width, CORPUS_STANDARD_RASTER_CONTRACT.height, 1);
      let metrics = controller.getMetrics();
      if (metrics.firstFrameCompleted !== true) await controller.renderOnce();
      metrics = controller.getMetrics();
      assert(metrics.viewport?.drawingBufferWidth === 1200 && metrics.viewport?.drawingBufferHeight === 800, "correctness drawing buffer must be exactly 1200x800 at DPR 1");
      const captures = [];
      for (const plan of CORPUS_NATIVE_READBACK_PLAN.filter(({ state }) => state.subjectId === subjectId)) {
        await configure(controller, plan.state);
        const capture = await controller.capturePixels(plan.kind);
        const after = controller.getMetrics();
        appliedState(after, plan.state, plan.filename);
        const record = await retainCapture({ capture, filename: plan.filename, kind: plan.kind, state: plan.state, artifacts: retainedArtifacts });
        const contract = controller.getRuntimeContract();
        captures.push(Object.freeze({
          ...record,
          runtime: Object.freeze({
            subjectId: after.subjectId,
            mode: after.mode,
            tier: after.tier,
            camera: after.camera,
            seed: after.seed,
            time: after.time,
            renderSubmissions: after.renderSubmissions,
            completedFrames: after.completedFrames,
            motionWitness: after.motionWitness,
          }),
          identityEvidence: identityEvidence(contract),
        }));
        const retainedByteLength = [...retainedArtifacts.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
        if (retainedByteLength > CORPUS_CORRECTNESS_MAX_RETAINED_BYTES_PER_SUBJECT) {
          throw new RangeError(`${subjectId} retained correctness bytes exceeded the per-subject bound`);
        }
      }
      assert(captures.length === 21, `${subjectId} must produce exactly 16 presentations and 5 masks`);
      const finishedAtMonotonicMs = performance.now();
      const resources = controller.describeResources();
      const pipeline = controller.describePipeline();
      const observerAfter = exactBootstrap(bootstrap);
      const withoutDigest = Object.freeze({
        schemaVersion: 1,
        labId: "webgpu-object-sculptor-corpus",
        profile: "correctness",
        automationSurface: "codex-in-app-browser",
        sourceHash: CORPUS_CAPTURE_SOURCE_HASH,
        buildRevision: CORPUS_CAPTURE_BUILD_REVISION,
        subjectId,
        startedAt,
        finishedAt: new Date().toISOString(),
        startedAtMonotonicMs,
        finishedAtMonotonicMs,
        browser: Object.freeze({ userAgent: navigator.userAgent, platform: navigator.platform, webdriver: navigator.webdriver === true }),
        viewport: Object.freeze({ cssWidth: 1200, cssHeight: 800, dpr: 1 }),
        backend: Object.freeze({
          kind: metrics.backendKind,
          nativeWebGPU: metrics.nativeWebGPU,
          rendererType: metrics.rendererInfo?.rendererType ?? null,
          backendType: metrics.rendererInfo?.backendType ?? null,
          threeRevision: metrics.rendererInfo?.threeRevision ?? null,
          rendererBackendEvidence: metrics.rendererBackendEvidence ?? null,
        }),
        pipeline,
        resourceInventory: resources,
        observerBefore,
        observerAfter,
        captures: Object.freeze(captures),
      });
      const document = Object.freeze({
        ...withoutDigest,
        digestAlgorithm: "sha256",
        digest: await sha256Hex(new TextEncoder().encode(`object-sculptor-correctness-subject-v1\n${canonicalJson(withoutDigest)}`)),
      });
      completedSubjects.add(subjectId);
      globalThis.window[CORPUS_CORRECTNESS_RESULT_KEY] = document;
      return document;
    } catch (value) {
      retainedArtifacts = new Map();
      const error = value instanceof Error ? value : new Error(String(value));
      globalThis.window[CORPUS_CORRECTNESS_ERROR_KEY] = Object.freeze({ name: error.name, message: error.message, subjectId });
      throw error;
    } finally {
      activeSubject = null;
    }
  }

  function takeArtifacts() {
    if (activeSubject !== null) throw new Error("correctness artifacts cannot be taken during collection");
    if (retainedArtifacts.size !== 42) throw new Error("one subject segment must retain exactly 21 independent transport and normalized artifact pairs");
    const result = Object.freeze([...retainedArtifacts.entries()].map(([path, bytes]) => Object.freeze({ path, bytes })));
    retainedArtifacts = new Map();
    return result;
  }

  async function dispose() {
    if (disposed) return false;
    if (activeSubject !== null) throw new Error("correctness evidence cannot dispose during collection");
    if (retainedArtifacts.size !== 0) throw new Error("correctness evidence artifacts must be taken before disposal");
    disposed = true;
    finalTeardown = await disposeCorpus();
    exactBootstrap(bootstrap);
    return finalTeardown;
  }

  return Object.freeze({
    collectSubject,
    takeArtifacts,
    dispose,
    getState: () => Object.freeze({ completedSubjects: Object.freeze([...completedSubjects]), activeSubject, retainedArtifactCount: retainedArtifacts.size, disposed, finalTeardown }),
  });
}
