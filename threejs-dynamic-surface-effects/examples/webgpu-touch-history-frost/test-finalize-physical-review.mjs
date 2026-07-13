import assert from "node:assert/strict";

import { numericDatum, NumericLabel } from "../../../labs/runtime/numeric-evidence.mjs";
import { canonicalSha256 } from "../../../scripts/lib/evidence-manifest-contract.mjs";
import { joinFrostPhysicalReview } from "./finalize-physical-review.mjs";

const hash = (value) => canonicalSha256(value);

function pendingFixture() {
  const state = { scenario: "touch-history-frost", mechanism: "refraction-and-fresnel", mode: "final", tier: "balanced", camera: "design", seed: 1 };
  return {
    schemaVersion: 1,
    recordKind: "lab-physical-route-review-v1",
    labId: "webgpu-touch-history-frost",
    profile: "physical-route",
    automationSurface: "codex-in-app-browser",
    publishable: false,
    sourceClosureHash: hash("source"),
    buildRevision: hash("build"),
    threeRevision: "0.185.1",
    startedAt: "2026-07-13T04:00:00.000Z",
    finishedAt: "2026-07-13T04:02:00.000Z",
    immutableBuild: {
      immutable: true,
      viteDevelopmentServer: false,
      transformAtServe: false,
      sourceClosureHash: hash("source"),
      buildRevision: hash("build"),
      threeRevision: "0.185.1",
      bundleHash: hash("bundle"),
      servedLedgerHash: null,
    },
    browser: { webdriver: false, headless: false, visibilityState: "visible", userAgent: "fixture", platform: "macOS" },
    adapter: { adapterClass: "hardware", identity: { source: "renderer.backend.device.adapterInfo", info: { vendor: "apple" } } },
    route: {
      path: "/mechanism/refraction-and-fresnel/index.html",
      finalUrl: "http://127.0.0.1:4323/mechanism/refraction-and-fresnel/index.html?physicalReview=1",
      controllerReady: true,
      lockedState: state,
      observedState: structuredClone(state),
    },
    viewport: {
      width: numericDatum(1180, "pixel", NumericLabel.MEASURED, "fixture"),
      height: numericDatum(664, "pixel", NumericLabel.MEASURED, "fixture"),
      dpr: numericDatum(2, "ratio", NumericLabel.MEASURED, "fixture"),
    },
    runtime: { initialized: true, nativeWebGPU: true, backend: { isWebGPUBackend: true, deviceIdentityVerified: true } },
    errors: { page: [], console: [], request: [], device: [], postDisposal: [] },
    checks: [
      "immutable-build", "route-ready", "native-webgpu", "mechanism-lock", "tier-control",
      "diagnostic-control", "metrics-collapsed", "canvas-review", "mode-review",
    ].map((id) => ({ id, inputMethod: id.includes("review") ? "direct-visual-inspection" : "public-controller-read", expected: true, observed: true, verdict: "PASS" })),
    review: {
      verdict: "PASS",
      canvasVisible: true,
      controlsObstructCanvas: false,
      rawMetricsCollapsedByDefault: true,
      inspectedModes: ["final", "frost-mask-after-pointer"],
      notes: ["The final and diagnostic modes are distinct and the scene remains visible."],
    },
    claimVerdicts: { visualCorrectness: "PASS", performanceCompliance: "NOT_CLAIMED", gpuTiming: "NOT_CLAIMED" },
    limitations: ["Pending offline served-byte ledger binding."],
  };
}

function servedFixture() {
  const entries = [
    "physical-review.html",
    "immutable-lab-build.json",
    "mechanism/refraction-and-fresnel/index.html",
  ].map((resolvedPath) => ({ status: 200, responseKind: "exact-prebuilt-byte", redirected: false, fallback: false, transformed: false, resolvedPath }));
  return { entries, ledgerSha256: hash(entries), documentSha256: hash("document"), byteLength: 1000 };
}

const finalized = joinFrostPhysicalReview(pendingFixture(), servedFixture());
assert.equal(finalized.validation.valid, true);
assert.equal(finalized.record.immutableBuild.servedLedgerHash, servedFixture().ledgerSha256);
assert.equal(finalized.serving.status, "FINALIZED_EXACT_STATIC_BYTES");
assert.equal(finalized.record.publishable, false);

const fallback = servedFixture();
fallback.entries[0].fallback = true;
assert.throws(() => joinFrostPhysicalReview(pendingFixture(), fallback), /failed, redirected, fallback, or transformed/);

const missingRoute = servedFixture();
missingRoute.entries = missingRoute.entries.slice(0, 2);
assert.throws(() => joinFrostPhysicalReview(pendingFixture(), missingRoute), /omits mechanism/);

console.log("frost physical review finalizer contract passed");
