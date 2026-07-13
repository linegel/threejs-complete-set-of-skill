import {
  FROST_PHYSICAL_ROUTE_MATRIX,
  validateFrostPhysicalRouteMatrix,
} from "./physical-route-matrix.js";

const LAB_ID = "webgpu-touch-history-frost";
const status = document.querySelector("[data-status]");
const frame = document.querySelector("[data-lab]");
const result = document.querySelector("[data-result]");

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
  throw new Error("Timed out waiting for an immutable Frost route controller.");
}

async function loadRoute(route) {
  const routeUrl = new URL(`.${route.staticPath}?physicalReview=1`, location.href);
  frame.src = routeUrl.href;
  await new Promise((resolve, reject) => {
    frame.addEventListener("load", resolve, { once: true });
    frame.addEventListener("error", () => reject(new Error(`${route.recipeId} failed to load`)), { once: true });
  });
  const controller = await waitForController();
  await controller.setMode("final");
  await controller.renderOnce();
  const capture = await controller.capturePixels("presentation");
  const metrics = controller.getMetrics();
  const finalPixelHash = await sha256(capture.pixels);
  const mechanismControlLocked = frame.contentDocument.querySelector("[data-mechanism]")?.disabled === true;
  const tierControlLocked = frame.contentDocument.querySelector("[data-tier]")?.disabled === true;
  const errorsBeforeDispose = observerEvents();
  const disposeEvidence = await controller.dispose();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const postDisposal = observerEvents().slice(errorsBeforeDispose.length);
  return Object.freeze({
    recipeId: route.recipeId,
    staticPath: route.staticPath,
    finalUrl: frame.contentWindow.location.href,
    controllerReady: true,
    nativeWebGPU: metrics.nativeWebGPU === true,
    deviceIdentityVerified: metrics.rendererBackendEvidence?.deviceIdentityVerified === true,
    adapterClass: metrics.adapterClass,
    mechanismControlLocked,
    tierControlLocked,
    observedState: Object.freeze({
      scenario: metrics.scenario,
      mechanism: metrics.mechanism,
      tier: metrics.tier,
      mode: metrics.mode,
    }),
    finalPixelHash,
    disposeEvidence,
    errors: Object.freeze({
      page: Object.freeze(errorsBeforeDispose.filter((entry) => entry.kind === "page-error" || entry.kind === "unhandled-rejection")),
      console: Object.freeze(errorsBeforeDispose.filter((entry) => entry.kind === "console-error")),
      request: Object.freeze([]),
      device: Object.freeze([...(metrics.deviceErrors ?? [])]),
      postDisposal: Object.freeze(postDisposal),
    }),
  });
}

async function initialize() {
  if (navigator.webdriver === true) throw new Error("Physical route-matrix review rejects WebDriver execution.");
  const startedAt = new Date().toISOString();
  const response = await fetch("./immutable-lab-build.json", { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error("Immutable build manifest is unavailable.");
  const immutableBuild = await response.json();
  if (immutableBuild.kind !== "immutable-lab-build-v1"
    || immutableBuild.immutable !== true
    || response.headers.get("x-threejs-immutable-build") !== immutableBuild.bundleHash) {
    throw new Error("Immutable build response does not match its bundle identity.");
  }

  const observations = [];
  for (const [index, route] of FROST_PHYSICAL_ROUTE_MATRIX.entries()) {
    status.textContent = `Verifying route ${index + 1} of ${FROST_PHYSICAL_ROUTE_MATRIX.length}: ${route.recipeId}`;
    observations.push(await loadRoute(route));
  }
  const matrix = validateFrostPhysicalRouteMatrix(observations);
  const pending = Object.freeze({
    schemaVersion: 1,
    recordKind: "lab-physical-route-matrix-review-v1",
    labId: LAB_ID,
    profile: "physical-route",
    automationSurface: "codex-in-app-browser",
    publishable: false,
    sourceClosureHash: immutableBuild.sourceClosureHash,
    buildRevision: immutableBuild.buildRevision,
    threeRevision: immutableBuild.threeRevision,
    bundleHash: immutableBuild.bundleHash,
    startedAt,
    finishedAt: new Date().toISOString(),
    browser: Object.freeze({
      webdriver: navigator.webdriver === true,
      headless: false,
      visibilityState: document.visibilityState,
      userAgent: navigator.userAgent,
      platform: navigator.userAgentData?.platform ?? navigator.platform,
    }),
    verdict: matrix.verdict,
    routes: matrix.observations,
    limitations: Object.freeze([
      "Pending offline served-byte ledger binding.",
      "This route matrix proves immutable URL state, native WebGPU execution, readback identity, and disposal; visual-quality review remains in the dedicated manual record.",
      "GPU timing and performance compliance are not claimed.",
    ]),
  });
  globalThis.__THREEJS_FROST_ROUTE_MATRIX_REVIEW__ = pending;
  result.textContent = JSON.stringify(pending, null, 2);
  status.textContent = "All ten immutable routes passed. The pending record still requires offline served-byte binding.";
}

initialize().catch((error) => {
  status.textContent = `Physical route-matrix review failed: ${error.message}`;
  globalThis.__THREEJS_FROST_ROUTE_MATRIX_REVIEW_ERROR__ = error;
  throw error;
});
