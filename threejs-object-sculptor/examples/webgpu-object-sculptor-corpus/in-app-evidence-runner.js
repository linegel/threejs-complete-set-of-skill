import {
  CORPUS_IN_APP_ROUTE_PLAN,
  CORPUS_ROUTE_EVIDENCE_BASE_PATH,
  CORPUS_ROUTE_EVIDENCE_ORIGIN,
  CORPUS_ROUTE_EVIDENCE_QUERY,
  CORPUS_ROUTE_EVIDENCE_RUNNER_PATH,
  CORPUS_ROUTE_IMMUTABLE_MANIFEST_PATH,
} from "./route-evidence-plan.js";
import {
  CORPUS_ROUTE_EVIDENCE_MAX_TAR_BYTES,
  CORPUS_ROUTE_EVIDENCE_TAR_FILENAME,
  buildRouteEvidenceTar,
  buildRouteEvidenceDocument,
  routeEvidenceDownloadName,
} from "./route-evidence-document.js";
import {
  CORPUS_CAPTURE_BUILD_REVISION,
  CORPUS_CAPTURE_SOURCE_HASH,
} from "./trusted-runtime-source-manifest.generated.js";
import { failClosedPhysicalRouteCollection } from "./route-evidence-client.js";

const ROUTE_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 50;

function requireElement(selector) {
  const value = document.querySelector(selector);
  if (!value) throw new Error(`Missing in-app evidence runner element "${selector}"`);
  return value;
}

const status = requireElement("#runner-status");
const bundleIdInput = requireElement("#bundle-id");
const runIdInput = requireElement("#run-id");
const startButton = requireElement("#start");
const copyButton = requireElement("#copy");
const downloadButton = requireElement("#download");
const downloadBundleButton = requireElement("#download-bundle");
const progress = requireElement("#progress");
const progressCount = requireElement("#progress-count");
const routeResults = requireElement("#route-results");
const routeFrame = requireElement("#route-frame");
const currentRoute = requireElement("#current-route");
const outputJson = requireElement("#output-json");

let running = false;
let evidenceJson = null;
let evidenceTar = null;
let evidenceArtifacts = new Map();
let immutableServerAttestation = null;

Object.defineProperty(window, "__CORPUS_ROUTE_EVIDENCE_RESULT__", {
  configurable: true,
  enumerable: false,
  writable: true,
  value: null,
});
Object.defineProperty(window, "__CORPUS_ROUTE_EVIDENCE_ERROR__", {
  configurable: true,
  enumerable: false,
  writable: true,
  value: null,
});
Object.defineProperty(window, "__CORPUS_ROUTE_EVIDENCE_ARTIFACTS__", {
  configurable: true,
  enumerable: false,
  writable: true,
  value: null,
});

function queryValue(params, key) {
  const values = params.getAll(key);
  if (values.length > 1) throw new RangeError(`Runner query ${key} must occur at most once`);
  return values[0] ?? null;
}

function defaultIdentity(prefix) {
  const uuid = crypto.randomUUID?.().replaceAll("-", "").slice(0, 12) ?? Math.random().toString(36).slice(2, 14);
  return `${prefix}-${Date.now().toString(36)}-${uuid}`;
}

function setStatus(state, text) {
  document.documentElement.dataset.evidenceState = state;
  status.dataset.state = state;
  status.textContent = text;
}

function setRunning(value) {
  running = value;
  startButton.disabled = value;
  bundleIdInput.disabled = value;
  runIdInput.disabled = value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function exactRunnerBootstrap() {
  const bootstrap = window.__CORPUS_ROUTE_EVIDENCE_BOOTSTRAP__;
  if (!bootstrap || bootstrap.enabled !== true || bootstrap.surface !== "runner") {
    throw new Error("Runner observers were not enabled by the canonical capture-origin bootstrap");
  }
  const snapshot = bootstrap.snapshot();
  if (snapshot.configuration?.origin !== CORPUS_ROUTE_EVIDENCE_ORIGIN
    || snapshot.configuration?.pathname !== CORPUS_ROUTE_EVIDENCE_RUNNER_PATH) {
    throw new Error("Runner bootstrap origin/path identity drifted");
  }
  if (snapshot.installed?.installedInHead !== true || snapshot.installed?.runnerModulePresentAtInstall !== false) {
    throw new Error("Runner observers were not installed in head before its module");
  }
  if (snapshot.setupFailures?.length > 0) throw new Error(`Runner observer setup failed: ${canonicalJson(snapshot.setupFailures)}`);
  for (const key of ["pageErrors", "consoleErrors", "unhandledRejections", "requestFailures"]) {
    if (snapshot[key]?.events?.length > 0) throw new Error(`Runner recorded ${key}: ${canonicalJson(snapshot[key].events)}`);
  }
  return snapshot;
}

async function loadImmutableServerAttestation() {
  const manifestUrl = new URL(CORPUS_ROUTE_IMMUTABLE_MANIFEST_PATH, CORPUS_ROUTE_EVIDENCE_ORIGIN);
  const response = await fetch(manifestUrl, { cache: "no-store", redirect: "error" });
  if (!response.ok || response.url !== manifestUrl.href) {
    throw new Error(`Immutable server manifest returned HTTP ${response.status} or redirected`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await sha256Hex(bytes);
  if (response.headers.get("x-content-sha256") !== digest) throw new Error("Immutable server manifest response digest drifted");
  const manifest = JSON.parse(new TextDecoder().decode(bytes));
  if (manifest.origin !== CORPUS_ROUTE_EVIDENCE_ORIGIN
    || manifest.server !== "object-sculptor-immutable-static-server"
    || manifest.transformMode !== "none"
    || manifest.immutableSnapshot !== true
    || manifest.spaFallback !== false
    || manifest.viteClient !== false) {
    throw new Error("Route evidence requires the non-transforming immutable static server");
  }
  if (response.headers.get("x-corpus-immutable-snapshot") !== manifest.snapshotId
    || response.headers.get("x-corpus-transform") !== "none") {
    throw new Error("Immutable server response headers drifted from its manifest");
  }
  if (manifest.sourceClosure?.sourceHash !== CORPUS_CAPTURE_SOURCE_HASH
    || manifest.sourceClosure?.buildRevision !== CORPUS_CAPTURE_BUILD_REVISION) {
    throw new Error("Immutable server source closure is stale relative to the generated capture identity");
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) throw new Error("Immutable server emitted no source entries");
  if (manifest.entries.some(({ path, urlPath }) => `${path}\n${urlPath}`.includes("/@vite/client"))) {
    throw new Error("Immutable server closure contains a Vite development client");
  }
  const closureSha256 = await sha256Hex(`object-sculptor-immutable-browser-closure-v1\n${canonicalJson(manifest.entries)}`);
  if (closureSha256 !== manifest.closureSha256 || manifest.snapshotId !== `source-sha256:${closureSha256}`) {
    throw new Error("Immutable server closure digest is invalid");
  }
  return Object.freeze({
    manifestPath: CORPUS_ROUTE_IMMUTABLE_MANIFEST_PATH,
    manifestSha256: digest,
    snapshotId: manifest.snapshotId,
    closureSha256,
    transformMode: manifest.transformMode,
    immutableSnapshot: manifest.immutableSnapshot,
    spaFallback: manifest.spaFallback,
    viteClient: manifest.viteClient,
    entries: Object.freeze(manifest.entries.map((entry) => Object.freeze(entry))),
    sourceClosure: Object.freeze(manifest.sourceClosure),
  });
}

async function withTimeout(promise, label, milliseconds = ROUTE_TIMEOUT_MS) {
  let handle;
  const timeout = new Promise((_, reject) => {
    handle = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds} ms`)), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(handle);
  }
}

function observeFrameNavigation() {
  const iframeErrorEvents = [];
  const installedAtMonotonicMs = performance.now();
  let settled = false;
  let disposed = false;
  let onLoad;
  let onError;
  let resolveLoaded;
  let rejectLoaded;
  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    routeFrame.removeEventListener("load", onLoad);
    routeFrame.removeEventListener("error", onError);
    return true;
  };
  const loaded = new Promise((resolve, reject) => {
    resolveLoaded = resolve;
    rejectLoaded = reject;
    onLoad = () => {
      if (settled) return;
      settled = true;
      resolveLoaded(true);
    };
    onError = () => {
      if (settled) return;
      settled = true;
      iframeErrorEvents.push(Object.freeze({ type: "iframe-error" }));
      rejectLoaded(new Error("Physical route iframe navigation failed"));
    };
    routeFrame.addEventListener("load", onLoad);
    routeFrame.addEventListener("error", onError);
  });
  return Object.freeze({
    installedAtMonotonicMs,
    iframeErrorEvents,
    loaded,
    dispose,
    state: () => Object.freeze({ settled, disposed }),
  });
}

async function assignObservedNavigation(plan, url) {
  const observation = observeFrameNavigation();
  let navigationAssignedAtMonotonicMs;
  try {
    navigationAssignedAtMonotonicMs = performance.now();
    if (navigationAssignedAtMonotonicMs <= observation.installedAtMonotonicMs) {
      await delay(0);
      navigationAssignedAtMonotonicMs = performance.now();
    }
    if (navigationAssignedAtMonotonicMs <= observation.installedAtMonotonicMs) {
      throw new Error(`${plan.routeId} parent observer clock did not advance before navigation`);
    }
    routeFrame.src = url.href;
    await withTimeout(observation.loaded, `${plan.routeId} navigation`);
  } finally {
    observation.dispose();
  }
  if (observation.state().disposed !== true) throw new Error(`${plan.routeId} navigation listeners were not removed`);
  const payload = Object.freeze({
    owner: "in-app-evidence-runner",
    target: "iframe#route-frame",
    observerIds: Object.freeze(["iframe-load", "iframe-error"]),
    installedAtMonotonicMs: observation.installedAtMonotonicMs,
    navigationAssignedAtMonotonicMs,
    installedBeforeNavigation: true,
    listenersRemoved: observation.state().disposed,
    iframeErrorEvents: Object.freeze([...observation.iframeErrorEvents]),
  });
  return Object.freeze({
    ...payload,
    digestAlgorithm: "sha256",
    digest: await sha256Hex(`object-sculptor-parent-observer-v1\n${plan.routeId}\n${canonicalJson(payload)}`),
  });
}

async function waitForProducer(contentWindow, routeId) {
  const started = performance.now();
  while (performance.now() - started < ROUTE_TIMEOUT_MS) {
    const labError = contentWindow.__LAB_ERROR__;
    if (labError) throw new Error(`${routeId} startup failed: ${labError.name}: ${labError.message}`);
    const bootstrap = contentWindow.__CORPUS_ROUTE_EVIDENCE_BOOTSTRAP__;
    const snapshot = bootstrap?.snapshot?.();
    if (snapshot?.configuration?.enabled !== true || bootstrap?.surface !== "route") {
      throw new Error(`${routeId} capture observers were not enabled for the exact origin/query`);
    }
    if (snapshot.setupFailures?.length > 0) throw new Error(`${routeId} observer setup failed: ${canonicalJson(snapshot.setupFailures)}`);
    for (const key of ["pageErrors", "consoleErrors", "unhandledRejections", "requestFailures", "gpuErrors"]) {
      if (snapshot[key]?.events?.length > 0) throw new Error(`${routeId} startup recorded ${key}: ${canonicalJson(snapshot[key].events)}`);
    }
    const producer = contentWindow.__CORPUS_ROUTE_EVIDENCE__;
    if (producer && typeof producer.collect === "function") return producer;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`${routeId} did not expose its in-app evidence producer`);
}

async function resetFrame() {
  const observation = observeFrameNavigation();
  const beforeHref = routeFrame.contentWindow?.location?.href ?? null;
  routeFrame.src = "about:blank";
  try {
    await withTimeout(observation.loaded, "iframe reset", 10_000);
  } finally {
    observation.dispose();
  }
  const afterHref = routeFrame.contentWindow?.location?.href ?? null;
  if (afterHref !== "about:blank" || observation.iframeErrorEvents.length > 0 || observation.state().disposed !== true) {
    throw new Error("Physical route iframe did not reset cleanly to about:blank");
  }
  return Object.freeze({
    owner: "in-app-evidence-runner",
    beforeHref,
    afterHref,
    loadObserved: observation.state().settled,
    listenersRemoved: observation.state().disposed,
    iframeErrorEvents: Object.freeze([...observation.iframeErrorEvents]),
  });
}

async function waitForChildAnimationFrames(contentWindow, routeId) {
  const timestampsMonotonicMs = [];
  for (let ordinal = 1; ordinal <= 2; ordinal += 1) {
    let handle = null;
    let completed = false;
    const frame = new Promise((resolve, reject) => {
      try {
        handle = contentWindow.requestAnimationFrame((timestamp) => {
          completed = true;
          timestampsMonotonicMs.push(timestamp);
          resolve(true);
        });
      } catch (error) {
        reject(error);
      }
    });
    try {
      await withTimeout(frame, `${routeId} post-disposal animation frame ${ordinal}`, 10_000);
    } finally {
      if (!completed && handle !== null) contentWindow.cancelAnimationFrame(handle);
    }
  }
  return Object.freeze({
    owner: "in-app-evidence-runner",
    type: "two-child-requestAnimationFrame-callbacks",
    requestedFrames: 2,
    observedFrames: timestampsMonotonicMs.length,
    completed: timestampsMonotonicMs.length === 2,
    timestampsMonotonicMs: Object.freeze([...timestampsMonotonicMs]),
  });
}

async function collectRoute(plan) {
  const routeUrl = new URL(`${CORPUS_ROUTE_EVIDENCE_BASE_PATH}${plan.urlPath}`, CORPUS_ROUTE_EVIDENCE_ORIGIN);
  routeUrl.search = CORPUS_ROUTE_EVIDENCE_QUERY;
  const requestedHref = routeUrl.href;
  const requestedPathname = routeUrl.pathname;
  let child = null;
  let producer = null;
  try {
    const response = await fetch(routeUrl, { cache: "no-store", redirect: "follow" });
    const responseUrl = new URL(response.url);
    if (!response.ok) throw new Error(`${plan.routeId} preflight returned HTTP ${response.status}`);
    if (response.redirected || responseUrl.href !== requestedHref || responseUrl.origin !== CORPUS_ROUTE_EVIDENCE_ORIGIN) {
      throw new Error(`${plan.routeId} preflight redirected away from its exact physical route`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) throw new Error(`${plan.routeId} preflight did not return HTML`);
    const servedBytes = new Uint8Array(await response.arrayBuffer());
    const servedSha256 = await sha256Hex(servedBytes);
    const servedRouteAttestation = Object.freeze({
      sourcePath: response.headers.get("x-corpus-source-path"),
      contentSha256: servedSha256,
      headerContentSha256: response.headers.get("x-content-sha256"),
      immutableSnapshotId: response.headers.get("x-corpus-immutable-snapshot"),
      transformMode: response.headers.get("x-corpus-transform"),
      byteLength: servedBytes.byteLength,
    });
    if (servedRouteAttestation.headerContentSha256 !== servedSha256
      || servedRouteAttestation.immutableSnapshotId !== immutableServerAttestation.snapshotId
      || servedRouteAttestation.transformMode !== "none") {
      throw new Error(`${plan.routeId} preflight bytes were not served by the immutable snapshot`);
    }
    const parentObserverAttestation = await assignObservedNavigation(plan, routeUrl);
    child = routeFrame.contentWindow;
    if (!child) throw new Error(`${plan.routeId} did not create a same-origin frame window`);
    producer = await waitForProducer(child, plan.routeId);
    const preDisposeRecord = await withTimeout(producer.collect({
      origin: child.location.origin,
      requestedHref,
      finalHref: child.location.href,
      requestedPathname,
      finalPathname: child.location.pathname,
      search: child.location.search,
      responseStatus: response.status,
      parentObserverAttestation,
      servedRouteAttestation,
      immutableServerAttestation,
    }), `${plan.routeId} runtime proof`);
    if (preDisposeRecord.routeId !== plan.routeId) throw new Error(`${plan.routeId} producer returned ${preDisposeRecord.routeId}`);
    if (typeof producer.takeArtifacts !== "function") throw new Error(`${plan.routeId} producer did not expose retained readback artifacts`);
    const artifacts = producer.takeArtifacts();
    if (!Array.isArray(artifacts) || artifacts.length !== 2) {
      throw new Error(`${plan.routeId} must retain exact transport and normalized readback artifacts`);
    }
    if (artifacts[0].bytes?.buffer === artifacts[1].bytes?.buffer || artifacts[0].path === artifacts[1].path) {
      throw new Error(`${plan.routeId} transport and normalized retained artifacts alias`);
    }
    const expectedArtifacts = new Map(Object.values(preDisposeRecord.readback.artifacts).map((artifact) => [artifact.path, artifact]));
    const retainedArtifacts = [];
    for (const { path, bytes } of artifacts) {
      const expected = expectedArtifacts.get(path);
      if (!expected || !(bytes instanceof child.Uint8Array)) {
        throw new Error(`${plan.routeId} retained artifact ${path} disagrees with its JSON reference`);
      }
      const retainedBytes = new Uint8Array(bytes);
      if (retainedBytes.byteLength !== expected.byteLength || await sha256Hex(retainedBytes) !== expected.sha256) {
        throw new Error(`${plan.routeId} retained artifact ${path} bytes/digest drifted`);
      }
      retainedArtifacts.push(Object.freeze({ path, bytes: retainedBytes }));
      expectedArtifacts.delete(path);
    }
    if (expectedArtifacts.size !== 0) throw new Error(`${plan.routeId} omitted a declared readback artifact`);
    if (!child.labController || typeof child.labController.dispose !== "function" || typeof producer.dispose !== "function") {
      throw new Error(`${plan.routeId} did not expose an explicitly disposable public controller and route lifecycle`);
    }
    const disposeResult = await withTimeout(producer.dispose(), `${plan.routeId} disposal`, 30_000);
    if (disposeResult?.listenersDetached !== true) throw new Error(`${plan.routeId} did not detach its page listeners before disposal`);
    if (typeof producer.finalizeAfterDispose !== "function") {
      throw new Error(`${plan.routeId} producer did not expose post-disposal error closure`);
    }
    const settlingBarrier = await waitForChildAnimationFrames(child, plan.routeId);
    const recordAfterDispose = await withTimeout(
      producer.finalizeAfterDispose({ disposeResult, settlingBarrier }),
      `${plan.routeId} post-disposal proof`,
      10_000,
    );
    const afterFrameReset = await resetFrame();
    const record = Object.freeze({
      ...recordAfterDispose,
      teardown: Object.freeze({
        ...recordAfterDispose.teardown,
        afterFrameReset,
      }),
    });
    exactRunnerBootstrap();
    return Object.freeze({ record, artifacts: Object.freeze(retainedArtifacts) });
  } catch (value) {
    const error = value instanceof Error ? value : new Error(String(value));
    return failClosedPhysicalRouteCollection({
      routeId: plan.routeId,
      cause: error,
      producer,
      childController: child?.labController ?? null,
      resetFrame,
    });
  }
}

function initializeRouteList() {
  routeResults.replaceChildren();
  for (const plan of CORPUS_IN_APP_ROUTE_PLAN) {
    const item = document.createElement("li");
    item.dataset.routeId = plan.routeId;
    item.dataset.state = "pending";
    item.textContent = plan.routeId;
    routeResults.append(item);
  }
}

function routeListItem(routeId) {
  return routeResults.querySelector(`[data-route-id="${CSS.escape(routeId)}"]`);
}

function downloadBlob(bytes, type, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function publishArtifactApi() {
  const retained = new Map(evidenceArtifacts);
  if (!(evidenceTar instanceof Uint8Array)) throw new Error("Route evidence TAR was not built before publication");
  const retainedTar = new Uint8Array(evidenceTar);
  window.__CORPUS_ROUTE_EVIDENCE_ARTIFACTS__ = Object.freeze({
    list: () => Object.freeze([...retained.entries()].map(([path, bytes]) => Object.freeze({ path, byteLength: bytes.byteLength }))),
    getArtifact: (path) => {
      const bytes = retained.get(path);
      if (!bytes) throw new RangeError(`Unknown route evidence artifact "${path}"`);
      return new Uint8Array(bytes);
    },
    buildTar: () => new Uint8Array(retainedTar),
  });
}

async function runEvidence() {
  if (running) return;
  setRunning(true);
  evidenceJson = null;
  evidenceTar = null;
  evidenceArtifacts = new Map();
  window.__CORPUS_ROUTE_EVIDENCE_RESULT__ = null;
  window.__CORPUS_ROUTE_EVIDENCE_ERROR__ = null;
  window.__CORPUS_ROUTE_EVIDENCE_ARTIFACTS__ = null;
  copyButton.disabled = true;
  downloadButton.disabled = true;
  downloadBundleButton.disabled = true;
  outputJson.textContent = "Evidence is withheld until all 15 physical routes pass.";
  initializeRouteList();
  progress.value = 0;
  progressCount.textContent = `0 / ${CORPUS_IN_APP_ROUTE_PLAN.length}`;

  const routes = [];
  const startedAt = new Date().toISOString();
  const startedAtMonotonicMs = performance.now();
  try {
    exactRunnerBootstrap();
    immutableServerAttestation = await loadImmutableServerAttestation();
    for (let index = 0; index < CORPUS_IN_APP_ROUTE_PLAN.length; index += 1) {
      const plan = CORPUS_IN_APP_ROUTE_PLAN[index];
      const item = routeListItem(plan.routeId);
      item.dataset.state = "running";
      item.textContent = `${plan.routeId} · verifying`;
      currentRoute.textContent = `${index + 1}/${CORPUS_IN_APP_ROUTE_PLAN.length} · ${plan.routeId}`;
      setStatus("running", `Verifying ${plan.routeId}`);
      const { record, artifacts } = await collectRoute(plan);
      routes.push(record);
      for (const artifact of artifacts) {
        if (evidenceArtifacts.has(artifact.path)) throw new Error(`Duplicate retained artifact ${artifact.path}`);
        evidenceArtifacts.set(artifact.path, artifact.bytes);
      }
      const retainedByteLength = [...evidenceArtifacts.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
      if (retainedByteLength >= CORPUS_ROUTE_EVIDENCE_MAX_TAR_BYTES) {
        throw new RangeError("Retained route readbacks exceed the bounded evidence bundle budget");
      }
      item.dataset.state = "captured";
      item.textContent = `${plan.routeId} · collected`;
      progress.value = index + 1;
      progressCount.textContent = `${index + 1} / ${CORPUS_IN_APP_ROUTE_PLAN.length}`;
    }

    const finishedAtMonotonicMs = performance.now();
    const finishedAt = new Date().toISOString();
    const rendererBackend = routes[0]?.runtime?.rendererBackendEvidence ?? null;
    const userAgentData = navigator.userAgentData
      ? Object.freeze({
        brands: Object.freeze([...(navigator.userAgentData.brands ?? [])].map((entry) => Object.freeze({ ...entry }))),
        mobile: navigator.userAgentData.mobile === true,
        platform: navigator.userAgentData.platform ?? null,
      })
      : null;
    const captureSession = Object.freeze({
      profile: "physical-route",
      automationSurface: "codex-in-app-browser",
      adapterClass: "unknown",
      adapterIdentity: Object.freeze({
        source: rendererBackend?.deviceIdentitySource ?? "renderer.backend.device-after-init",
        backendType: rendererBackend?.backendType ?? routes[0]?.runtime?.backendType ?? null,
        deviceType: rendererBackend?.deviceType ?? null,
        deviceLabel: rendererBackend?.deviceLabel ?? "",
        deviceIdentityVerified: rendererBackend?.deviceIdentityVerified === true,
      }),
      browser: Object.freeze({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        vendor: navigator.vendor,
        language: navigator.language,
        userAgentData,
      }),
      sourceClosureHash: CORPUS_CAPTURE_SOURCE_HASH,
      buildRevision: CORPUS_CAPTURE_BUILD_REVISION,
      runnerHref: location.href,
      startedAt,
      finishedAt,
      startedAtMonotonicMs: Object.freeze({
        value: startedAtMonotonicMs,
        unit: "ms",
        label: "Measured",
        source: "performance.now() on the Codex in-app Browser runner before route collection",
      }),
      finishedAtMonotonicMs: Object.freeze({
        value: finishedAtMonotonicMs,
        unit: "ms",
        label: "Measured",
        source: "performance.now() on the Codex in-app Browser runner after route teardown",
      }),
    });
    const documentRecord = buildRouteEvidenceDocument({
      bundleId: bundleIdInput.value.trim(),
      runId: runIdInput.value.trim(),
      captureSession,
      routes,
    });
    evidenceJson = `${JSON.stringify(documentRecord, null, 2)}\n`;
    if (evidenceArtifacts.size !== CORPUS_IN_APP_ROUTE_PLAN.length * 2) {
      throw new Error(`Route evidence requires exactly ${CORPUS_IN_APP_ROUTE_PLAN.length * 2} retained readback artifacts`);
    }
    evidenceTar = buildRouteEvidenceTar({ evidenceJson, artifacts: evidenceArtifacts });
    window.__CORPUS_ROUTE_EVIDENCE_RESULT__ = documentRecord;
    publishArtifactApi();
    outputJson.textContent = evidenceJson;
    copyButton.disabled = false;
    downloadButton.disabled = false;
    downloadBundleButton.disabled = false;
    currentRoute.textContent = "All routes disposed; offline artifact validation remains required";
    setStatus("complete", "15 / 15 routes collected");
  } catch (value) {
    const error = value instanceof Error ? value : new Error(String(value));
    evidenceTar = null;
    const active = routeResults.querySelector('[data-state="running"]');
    if (active) {
      active.dataset.state = "failed";
      active.textContent = `${active.dataset.routeId} · failed`;
    }
    window.__CORPUS_ROUTE_EVIDENCE_ERROR__ = Object.freeze({ name: error.name, message: error.message });
    outputJson.textContent = `No evidence document was produced.\n\n${error.name}: ${error.message}`;
    setStatus("error", `Failed · ${error.message}`);
  } finally {
    setRunning(false);
  }
}

copyButton.addEventListener("click", async () => {
  if (!evidenceJson) return;
  try {
    await navigator.clipboard.writeText(evidenceJson);
    setStatus("complete", "JSON copied · 15 / 15 routes collected");
  } catch (error) {
    setStatus("error", `Copy failed · ${error.message}`);
  }
});

downloadButton.addEventListener("click", () => {
  if (!evidenceJson) return;
  downloadBlob(evidenceJson, "application/json", routeEvidenceDownloadName());
});

downloadBundleButton.addEventListener("click", () => {
  if (!evidenceJson || evidenceArtifacts.size !== CORPUS_IN_APP_ROUTE_PLAN.length * 2 || !(evidenceTar instanceof Uint8Array)) return;
  downloadBlob(evidenceTar, "application/x-tar", CORPUS_ROUTE_EVIDENCE_TAR_FILENAME);
});

startButton.addEventListener("click", () => void runEvidence());

try {
  if (location.origin !== CORPUS_ROUTE_EVIDENCE_ORIGIN || location.pathname !== CORPUS_ROUTE_EVIDENCE_RUNNER_PATH) {
    throw new Error(`Open the runner only at ${CORPUS_ROUTE_EVIDENCE_ORIGIN}${CORPUS_ROUTE_EVIDENCE_RUNNER_PATH}`);
  }
  const params = new URLSearchParams(location.search);
  if (queryValue(params, "capture") !== "1") throw new RangeError("capture must occur exactly once with value 1");
  bundleIdInput.value = queryValue(params, "bundleId") ?? defaultIdentity("corpus-bundle");
  runIdInput.value = queryValue(params, "runId") ?? defaultIdentity("corpus-routes");
  const autostart = queryValue(params, "autostart") ?? "1";
  if (!new Set(["0", "1"]).has(autostart)) throw new RangeError("autostart must be 0 or 1");
  initializeRouteList();
  progress.max = CORPUS_IN_APP_ROUTE_PLAN.length;
  if (autostart === "1") queueMicrotask(() => void runEvidence());
} catch (value) {
  const error = value instanceof Error ? value : new Error(String(value));
  window.__CORPUS_ROUTE_EVIDENCE_ERROR__ = Object.freeze({ name: error.name, message: error.message });
  outputJson.textContent = `No evidence document was produced.\n\n${error.name}: ${error.message}`;
  setStatus("error", `Configuration failed · ${error.message}`);
  startButton.disabled = true;
}
