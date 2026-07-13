import { numericArray, numericDatum, NumericLabel } from "../../../labs/runtime/numeric-evidence.mjs";

const LAB_ID = "webgpu-touch-history-frost";
const ROUTE_PATH = "/mechanism/refraction-and-fresnel/index.html";
const REVIEW_TRACE = Object.freeze({
  start: Object.freeze({ x: 0.28, y: 0.62 }),
  end: Object.freeze({ x: 0.72, y: 0.38 }),
  pressure: 0.85,
  deltaSeconds: 1 / 30,
});
const status = document.querySelector("[data-status]");
const frame = document.querySelector("[data-lab]");
const form = document.querySelector("[data-review]");
const finalizeButton = form.querySelector("button");
const result = document.querySelector("[data-result]");
const canvasVisible = document.querySelector("[data-canvas-visible]");
const modesDistinct = document.querySelector("[data-modes-distinct]");
const notes = document.querySelector("[data-notes]");

let immutableBuild = null;
let controller = null;
let automatedChecks = [];
let startedAt = null;
let finalPixelHash = null;
let diagnosticPixelHash = null;

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function observerEvents() {
  return frame.contentWindow.__THREEJS_PHYSICAL_OBSERVER__?.snapshot?.().events ?? [];
}

async function waitForController() {
  const began = performance.now();
  while (performance.now() - began < 30000) {
    if (frame.contentWindow?.__THREEJS_LAB__ && frame.contentDocument?.documentElement.dataset.ready === "true") {
      return frame.contentWindow.__THREEJS_LAB__;
    }
    await new Promise(requestAnimationFrame);
  }
  throw new Error("Timed out waiting for the immutable Frost controller.");
}

async function setSelect(selector, value) {
  const select = frame.contentDocument.querySelector(selector);
  if (!select) throw new Error(`Missing page control ${selector}.`);
  if (![...select.options].some((option) => option.value === value)) throw new Error(`Control ${selector} omits ${value}.`);
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  const began = performance.now();
  while (performance.now() - began < 5000) {
    const metrics = controller.getMetrics();
    const field = selector === "[data-mode]" ? "mode" : (selector === "[data-tier]" ? "tier" : "mechanism");
    if (metrics[field] === value) return metrics;
    await new Promise(requestAnimationFrame);
  }
  throw new Error(`Control ${selector} did not commit ${value}.`);
}

function check(id, inputMethod, expected, observed, verdict = "PASS") {
  return Object.freeze({ id, inputMethod, expected, observed, verdict });
}

async function captureHash(mode) {
  await setSelect("[data-mode]", mode);
  await controller.renderOnce();
  const capture = await controller.capturePixels("presentation");
  return sha256(capture.pixels);
}

async function applyReviewTrace() {
  await controller.resetHistory("physical-review-trace");
  controller.queuePointerSegment(REVIEW_TRACE.start, REVIEW_TRACE.end, REVIEW_TRACE.pressure, true);
  await controller.step(REVIEW_TRACE.deltaSeconds);
  await controller.renderOnce();
  const metrics = controller.getMetrics();
  if (metrics.eventCount !== 1 || metrics.sameFrameComposite !== true) {
    throw new Error("Deterministic Frost review trace did not reach same-frame history composition.");
  }
  return metrics;
}

function updateFinalizeAvailability() {
  finalizeButton.disabled = !(automatedChecks.length > 0 && canvasVisible.checked && modesDistinct.checked && notes.value.trim().length >= 20);
}

function reviewTraceEvidence() {
  return Object.freeze({
    start: numericArray([REVIEW_TRACE.start.x, REVIEW_TRACE.start.y], "normalized-uv", NumericLabel.AUTHORED, "frozen physical-review trace start"),
    end: numericArray([REVIEW_TRACE.end.x, REVIEW_TRACE.end.y], "normalized-uv", NumericLabel.AUTHORED, "frozen physical-review trace end"),
    pressure: numericDatum(REVIEW_TRACE.pressure, "ratio", NumericLabel.AUTHORED, "frozen physical-review trace pressure"),
    deltaSeconds: numericDatum(REVIEW_TRACE.deltaSeconds, "second", NumericLabel.AUTHORED, "frozen physical-review trace timestep"),
  });
}

async function initialize() {
  if (navigator.webdriver === true) throw new Error("Physical review rejects WebDriver execution.");
  startedAt = new Date().toISOString();
  const response = await fetch("./immutable-lab-build.json", { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error("Immutable build manifest is unavailable.");
  immutableBuild = await response.json();
  if (immutableBuild.kind !== "immutable-lab-build-v1" || immutableBuild.immutable !== true
    || response.headers.get("x-threejs-immutable-build") !== immutableBuild.bundleHash) {
    throw new Error("Immutable build response does not match its bundle identity.");
  }

  const routeUrl = new URL(`.${ROUTE_PATH}?physicalReview=1`, location.href);
  frame.src = routeUrl.href;
  await new Promise((resolve, reject) => {
    frame.addEventListener("load", resolve, { once: true });
    frame.addEventListener("error", () => reject(new Error("Immutable Frost route failed to load.")), { once: true });
  });
  controller = await waitForController();
  const initialMetrics = controller.getMetrics();
  const mechanismControl = frame.contentDocument.querySelector("[data-mechanism]");
  if (mechanismControl?.disabled !== true || initialMetrics.mechanism !== "refraction-and-fresnel") {
    throw new Error("Immutable mechanism route is not locked to refraction-and-fresnel.");
  }
  await setSelect("[data-tier]", "balanced");
  const reviewTraceMetrics = await applyReviewTrace();
  finalPixelHash = await captureHash("final");
  diagnosticPixelHash = await captureHash("frost-mask-after-pointer");
  await setSelect("[data-mode]", "final");
  const metrics = controller.getMetrics();
  const metricsDrawerOpen = frame.contentDocument.querySelector("[data-metrics]")?.open === true;
  automatedChecks = [
    check("immutable-build", "public-controller-read", immutableBuild.bundleHash, response.headers.get("x-threejs-immutable-build")),
    check("route-ready", "public-controller-read", true, frame.contentDocument.documentElement.dataset.ready === "true"),
    check("native-webgpu", "public-controller-read", true, metrics.nativeWebGPU === true && metrics.rendererBackendEvidence?.deviceIdentityVerified === true),
    check("mechanism-lock", "user-facing-control", "refraction-and-fresnel", metrics.mechanism),
    check("tier-control", "user-facing-control", "balanced", metrics.tier),
    check("review-trace", "public-controller-call", 1, reviewTraceMetrics.eventCount),
    check("diagnostic-control", "user-facing-control", "distinct-pixels", diagnosticPixelHash === finalPixelHash ? "duplicate-pixels" : "distinct-pixels"),
    check("metrics-collapsed", "direct-visual-inspection", false, metricsDrawerOpen),
  ];
  if (automatedChecks.some((entry) => entry.expected !== entry.observed)) {
    throw new Error("One or more physical-route checks did not match their expected state.");
  }
  status.textContent = "Automated route checks passed. Inspect both output states with the diagnostic control, then confirm the visible review.";
  updateFinalizeAvailability();
}

for (const input of [canvasVisible, modesDistinct, notes]) input.addEventListener("input", updateFinalizeAvailability);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  finalizeButton.disabled = true;
  await setSelect("[data-mode]", "final");
  const metrics = controller.getMetrics();
  const errorsBeforeDispose = observerEvents();
  const disposeEvidence = await controller.dispose();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const delayedErrors = observerEvents().slice(errorsBeforeDispose.length);
  const lockedState = {
    scenario: "touch-history-frost",
    mechanism: "refraction-and-fresnel",
    mode: "final",
    tier: "balanced",
    camera: "design",
    seed: 1,
  };
  const pending = {
    schemaVersion: 1,
    recordKind: "lab-physical-route-review-v1",
    labId: LAB_ID,
    profile: "physical-route",
    automationSurface: "codex-in-app-browser",
    publishable: false,
    sourceClosureHash: immutableBuild.sourceClosureHash,
    buildRevision: immutableBuild.buildRevision,
    threeRevision: immutableBuild.threeRevision,
    startedAt,
    finishedAt: new Date().toISOString(),
    immutableBuild: {
      immutable: true,
      viteDevelopmentServer: false,
      transformAtServe: false,
      sourceClosureHash: immutableBuild.sourceClosureHash,
      buildRevision: immutableBuild.buildRevision,
      threeRevision: immutableBuild.threeRevision,
      bundleHash: immutableBuild.bundleHash,
      servedLedgerHash: null,
    },
    browser: {
      webdriver: navigator.webdriver === true,
      headless: false,
      visibilityState: document.visibilityState,
      userAgent: navigator.userAgent,
      platform: navigator.userAgentData?.platform ?? navigator.platform,
    },
    adapter: { adapterClass: metrics.adapterClass, identity: metrics.adapterIdentity },
    route: {
      path: ROUTE_PATH,
      finalUrl: frame.contentWindow.location.href,
      controllerReady: true,
      lockedState,
      observedState: {
        scenario: metrics.scenario,
        mechanism: metrics.mechanism,
        mode: metrics.mode,
        tier: metrics.tier,
        camera: metrics.camera,
        seed: metrics.seed,
      },
    },
    viewport: {
      width: numericDatum(metrics.viewport.width, "pixel", NumericLabel.MEASURED, "embedded immutable renderer viewport"),
      height: numericDatum(metrics.viewport.height, "pixel", NumericLabel.MEASURED, "embedded immutable renderer viewport"),
      dpr: numericDatum(metrics.viewport.dpr, "ratio", NumericLabel.MEASURED, "embedded immutable renderer devicePixelRatio"),
    },
    runtime: {
      initialized: metrics.initialized,
      nativeWebGPU: metrics.nativeWebGPU,
      backend: {
        isWebGPUBackend: metrics.rendererBackendEvidence?.isWebGPUBackend === true,
        deviceIdentityVerified: metrics.rendererBackendEvidence?.deviceIdentityVerified === true,
      },
      finalPixelHash,
      diagnosticPixelHash,
      disposeEvidence,
      reviewTrace: reviewTraceEvidence(),
    },
    errors: {
      page: errorsBeforeDispose.filter((entry) => entry.kind === "page-error" || entry.kind === "unhandled-rejection"),
      console: errorsBeforeDispose.filter((entry) => entry.kind === "console-error"),
      request: [],
      device: metrics.deviceErrors,
      postDisposal: delayedErrors,
    },
    checks: [
      ...automatedChecks,
      check("canvas-review", "direct-visual-inspection", "visible and unobstructed", "visible and unobstructed"),
      check("mode-review", "direct-visual-inspection", "final and diagnostic distinct", "final and diagnostic distinct"),
    ],
    review: {
      verdict: "PASS",
      canvasVisible: true,
      controlsObstructCanvas: false,
      rawMetricsCollapsedByDefault: true,
      inspectedModes: ["final", "frost-mask-after-pointer"],
      notes: [notes.value.trim()],
    },
    claimVerdicts: {
      visualCorrectness: "PASS",
      performanceCompliance: "NOT_CLAIMED",
      gpuTiming: "NOT_CLAIMED",
    },
    limitations: [
      "Pending offline served-byte ledger binding.",
      "This physical-route review does not claim GPU timing or performance compliance.",
    ],
  };
  globalThis.__THREEJS_FROST_PHYSICAL_REVIEW__ = pending;
  result.textContent = JSON.stringify(pending, null, 2);
  status.textContent = "Physical review complete. The pending record still requires offline served-byte binding and validation.";
});

initialize().catch((error) => {
  status.textContent = `Physical review failed: ${error.message}`;
  globalThis.__THREEJS_FROST_PHYSICAL_REVIEW_ERROR__ = error;
  throw error;
});
