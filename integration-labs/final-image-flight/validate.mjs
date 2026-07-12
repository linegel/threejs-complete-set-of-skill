import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDemoRegistry } from "../../scripts/lib/lab-registry.mjs";
import { validateIntegrationContract, INTEGRATION_REASON } from "../shared/integration-contract-core.mjs";
import { validateLabManifest, validateRawLabManifest } from "../../scripts/lib/lab-validation.mjs";
import { plannedPublishedRoutes } from "../../scripts/lib/page-routes.mjs";
import {
  createFinalImageFlightGraph,
  validateFinalImageFlightGraph,
} from "./owner-graph.mjs";
import {
  FINAL_IMAGE_FLIGHT_CAMERAS,
  FINAL_IMAGE_FLIGHT_MECHANISMS,
  FINAL_IMAGE_FLIGHT_MODES,
  FINAL_IMAGE_FLIGHT_SCENARIOS,
  FINAL_IMAGE_FLIGHT_TIERS,
  assertFinalImageFlightRouteLock,
  parseFinalImageFlightRoute,
} from "./routes.mjs";
import { createSustainedP95Governor } from "./quality-governor.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "../..");
const manifest = JSON.parse(readFileSync(join(root, "lab.manifest.json"), "utf8"));
const contract = JSON.parse(readFileSync(join(root, "contract.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const targets = JSON.parse(readFileSync(join(repoRoot, "labs/canonical-targets.json"), "utf8"));
const target = targets.integrations.find((entry) => entry.id === "final-image-flight");

const raw = validateRawLabManifest(manifest);
assert.deepEqual(raw.errors, [], raw.errors.join("\n"));
const registryManifest = buildDemoRegistry().demos.find((entry) => entry.id === manifest.id);
assert(registryManifest, `registry contains ${manifest.id}`);
const normalized = validateLabManifest(registryManifest, { root: repoRoot, validateEvidence: false });
assert.deepEqual(normalized.errors, [], normalized.errors.join("\n"));
assert.equal(manifest.status, "incomplete");
assert.equal(manifest.evidenceBundle, null);
assert.equal(manifest.evidenceContract, "v2");

assert(target, "final-image-flight frozen target is absent");
assert.deepEqual(FINAL_IMAGE_FLIGHT_SCENARIOS, target.scenarios);
assert.deepEqual(FINAL_IMAGE_FLIGHT_MECHANISMS, target.mechanisms);
assert.deepEqual(FINAL_IMAGE_FLIGHT_TIERS, target.tiers);
assert.deepEqual(FINAL_IMAGE_FLIGHT_MODES, target.modes);
assert.deepEqual(manifest.cameras, [...FINAL_IMAGE_FLIGHT_CAMERAS]);

const routeCases = [
  ["/demos/final-image-flight/", "", { tier: "balanced", mode: "final", mechanism: null, tierLocked: false, modeLocked: false }],
  ["/demos/final-image-flight/tier/hero/", "", { tier: "hero", mode: "final", mechanism: null, tierLocked: true, modeLocked: false }],
  ["/demos/final-image-flight/mechanism/ao-prepass-lit-pair/", "", { tier: "balanced", mode: "ao", mechanism: "ao-prepass-lit-pair", tierLocked: false, modeLocked: true }],
  ["/demos/final-image-flight/mechanism/shared-emissive-bloom/", "?tier=budgeted", { tier: "budgeted", mode: "bloom", mechanism: "shared-emissive-bloom", tierLocked: true, modeLocked: true }],
  ["/demos/final-image-flight/", "?mechanism=exposure-output-order&tier=hero", { tier: "hero", mode: "exposure", mechanism: "exposure-output-order", tierLocked: true, modeLocked: true }],
];
for (const [pathname, search, expected] of routeCases) {
  const route = parseFinalImageFlightRoute({ pathname, search });
  assert.equal(route.tier, expected.tier);
  assert.equal(route.mode, expected.mode);
  assert.equal(route.mechanism, expected.mechanism);
  assert.equal(route.tierLocked, expected.tierLocked);
  assert.equal(route.modeLocked, expected.modeLocked);
}
assert.throws(() => parseFinalImageFlightRoute({ pathname: "/tier/fabricated/", search: "" }), /unknown Final Image Flight tier/);
assert.throws(() => parseFinalImageFlightRoute({ pathname: "/mechanism/private-pass/", search: "" }), /unknown Final Image Flight mechanism/);
assert.throws(() => parseFinalImageFlightRoute({ pathname: "/", search: "?mode=private-output" }), /unknown Final Image Flight mode/);
assert.throws(() => parseFinalImageFlightRoute({ pathname: "/tier/", search: "" }), /missing Final Image Flight tier route id/);
assert.throws(() => parseFinalImageFlightRoute({ pathname: "/", search: "?tier=hero&tier=budgeted" }), /duplicate Final Image Flight tier query lock/);
assert.throws(() => parseFinalImageFlightRoute({ pathname: "/mechanism/owner-graph/", search: "?mechanism=shadow-contribution" }), /conflicting Final Image Flight mechanism locks/);
assert.throws(() => parseFinalImageFlightRoute({ pathname: "/mechanism/owner-graph/", search: "?mode=final" }), /conflicting Final Image Flight mechanism\/mode locks/);
const locked = parseFinalImageFlightRoute({ pathname: "/mechanism/shared-emissive-bloom/", search: "?tier=hero" });
assert.throws(() => assertFinalImageFlightRouteLock(locked, { mode: "final" }), /mechanism mode is locked/);
assert.throws(() => assertFinalImageFlightRouteLock(locked, { tier: "budgeted" }), /tier route is locked/);

const integration = validateIntegrationContract(contract);
assert.equal(integration.verdict, "PASS", integration.message);
assert.equal(integration.code, INTEGRATION_REASON.INCOMPLETE);
assert.equal(integration.details.missingAdapters.length, 0);
assert.equal(integration.details.availableAdapters.length, 8);

const graph = createFinalImageFlightGraph({
  width: 1200,
  height: 800,
  tier: "balanced",
  aoScale: 0.5,
  bloomScale: 0.33,
  exposureDescription: { owner: "exposure-color-stage" },
  shadowDescription: { architecture: "bounded", frameMetrics: { frameId: 7 } },
  motionStorageBytes: 16384,
  activeEffectInstances: 128,
  effectInstanceCapacity: 256,
  activeMode: "final",
  qualityGovernor: { activeTier: "balanced", sampleSource: "renderer-timestamp-query", frameAggregationPolicy: "exactly-one-rendered-frame-per-resolve", transitionTrace: [] },
  tierConfiguration: { dprCap: 1.5, sceneScale: 1, aoTier: "high", bloomScale: 0.33, exposureTier: "balanced-log-reduction", shadowMapSize: 512, effectInstances: 128 },
  preGradeHdrSharedIdentity: true,
});
assert.deepEqual(validateFinalImageFlightGraph(graph).errors, []);
assert.equal(graph.sceneSubmissions.length, 2);
assert.equal(graph.sceneSubmissions.filter((entry) => entry.kind === "gbuffer-prepass").length, 1);
assert.equal(graph.sceneSubmissions.filter((entry) => entry.kind === "lit-scene-pass").length, 1);
assert.equal(graph.submissionCounts.sceneSubmissionCount.value, 2);
assert.equal(graph.submissionCounts.fullLitOutputCount.value, 1);
assert.equal(graph.rendererOwners.length, 1);
assert.equal(graph.renderPipelineOwners.length, 1);
assert.equal(graph.outputColorTransform, false);
for (const signal of ["scene.output", "scene.depth", "scene.normal", "scene.emissive", "scene.velocity"]) {
  assert.equal(graph.signals.filter((entry) => entry.id === signal).length, 1, `${signal} needs exactly one producer`);
}
assert.equal(graph.signals.filter((entry) => entry.id === "scene.pre-grade-hdr").length, 1);
assert.equal(graph.resources.filter((entry) => entry.id === "pre-grade-hdr").length, 1);
assert.equal(graph.preGradeHdrBinding.meterSourceId, graph.preGradeHdrBinding.hdrColorSourceId);
assert.equal(graph.diagnostics.find((entry) => entry.id === "shadow-contribution").nodeKind, "ShadowNodeMaterial-pass-texture");
assert.equal(graph.diagnostics.find((entry) => entry.id === "owner-graph").nodeKind, "live-signal-mosaic");
assert.equal(graph.shadowFrameRecord.frameId, 7);

const appliedGovernorTiers = [];
const governor = createSustainedP95Governor({
  initialTier: "hero",
  policy: { windowSize: 4, downgradeWindows: 2, upgradeWindows: 2, cooldownWindows: 2 },
  onTransition: async (nextTier) => { appliedGovernorTiers.push(nextTier); },
});
for (let frameId = 0; frameId < 4; frameId += 1) {
  await governor.recordTimestampSample({ frameId, renderMs: 18, computeMs: 2 });
}
assert.equal(governor.tier, "hero", "one overrun window must not change tier");
await governor.recordTimestampSample({ frameId: 4, renderMs: null, computeMs: null });
assert.equal(governor.tier, "hero", "absent timestamps must not change tier");
for (let frameId = 5; frameId < 9; frameId += 1) {
  await governor.recordTimestampSample({ frameId, renderMs: 18, computeMs: 2 });
}
assert.equal(governor.tier, "balanced", "two sustained overrun windows must apply one tier transition");
assert.deepEqual(appliedGovernorTiers, ["balanced"]);
assert.equal(governor.describe().unavailableSampleCount.value, 1);
assert.equal(governor.describe().transitionTrace.at(-1).decision, "transition-applied");

const lockedGovernor = createSustainedP95Governor({
  initialTier: "hero",
  tierLocked: true,
  policy: { windowSize: 2, downgradeWindows: 1, upgradeWindows: 1, cooldownWindows: 1 },
});
await lockedGovernor.recordTimestampSample({ frameId: 0, renderMs: 20, computeMs: 2 });
await lockedGovernor.recordTimestampSample({ frameId: 1, renderMs: 20, computeMs: 2 });
assert.equal(lockedGovernor.tier, "hero", "locked tier route must reject governor transitions");
assert.equal(lockedGovernor.describe().transitionTrace.at(-1).decision, "route-locked");

const wrappers = plannedPublishedRoutes(manifest);
assert.equal(wrappers.length, manifest.scenarios.length + manifest.mechanisms.length + manifest.tiers.length);
for (const mechanism of manifest.mechanisms) {
  const path = join(root, mechanism.route, "index.html");
  assert(existsSync(path), `missing mechanism wrapper ${mechanism.id}`);
  const source = readFileSync(path, "utf8");
  assert.match(source, new RegExp(`name="locked-mode" content="${mechanism.startup.mode}"`));
  assert.match(source, /src="\.\.\/\.\.\/browser\.mjs"/);
  assert.doesNotMatch(source, /new\s+WebGPURenderer/);
}
for (const tier of manifest.tiers) {
  const path = join(root, "tier", tier.id, "index.html");
  assert(existsSync(path), `missing tier wrapper ${tier.id}`);
  const source = readFileSync(path, "utf8");
  assert.match(source, new RegExp(`name="locked-tier" content="${tier.id}"`));
  assert.match(source, /src="\.\.\/\.\.\/browser\.mjs"/);
  assert.doesNotMatch(source, /new\s+WebGPURenderer/);
}

const standardScripts = ["check", "validate:unit", "test:mutations", "capture", "validate:artifacts", "validate:quick", "validate:full"];
for (const script of standardScripts) assert.equal(typeof packageJson.scripts[script], "string", `missing ${script}`);
assert.match(packageJson.scripts["validate:full"], /validate:artifacts/);
assert.doesNotMatch(packageJson.scripts["validate:quick"], /capture|playwright|browser/i);
for (const [name, command] of Object.entries(manifest.commands)) {
  assert.match(command, /^npm --prefix integration-labs\/final-image-flight run /, `manifest command ${name} is not local`);
}
assert(manifest.canonicalSource.every((source) => existsSync(join(repoRoot, source))), "canonicalSource contains a missing file");
assert(manifest.canonicalSource.every((source) => !source.includes("integration-labs/shared/browser-controller")));

const mainSource = readFileSync(join(root, "main.mjs"), "utf8");
const captureSource = readFileSync(join(root, "capture.mjs"), "utf8");
assert.equal((mainSource.match(/new WebGPURenderer\s*\(/g) ?? []).length, 1, "host must construct one renderer");
assert.equal((mainSource.match(/new RenderPipeline\s*\(/g) ?? []).length, 1, "host must construct one RenderPipeline");
assert.match(mainSource, /await renderer\.init\(\)/);
assert.match(mainSource, /isWebGPUBackend !== true/);
assert.match(mainSource, /gbufferPass\.setMRT\(mrt\(\{ output, normal: normalView, emissive, velocity \}\)\)/);
assert.match(mainSource, /createSharedEmissiveBloomStage\(\{/);
assert.match(mainSource, /createExposureColorStage\(\{/);
assert.match(mainSource, /const preGradeHdr = rtt\(combinedHdr/);
assert.match(mainSource, /const exposureMeterSource = preGradeHdr/);
assert.match(mainSource, /const exposureHdrSource = preGradeHdr/);
assert.match(mainSource, /meterSourceTextureNode: exposureMeterSource/);
assert.match(mainSource, /hdrColorNode: exposureHdrSource/);
assert.match(mainSource, /preGradeHdrSharedIdentity: exposureMeterSource === exposureHdrSource/);
assert.match(mainSource, /preGradeHdr\.renderTarget\?\.dispose\?\.\(\)/);
assert.match(mainSource, /createShadowArchitectureOwner\(\{/);
assert.match(mainSource, /new ShadowNodeMaterial\(/);
assert.match(mainSource, /shadowOwner\.recordFrame\(frameId\)/);
assert.match(mainSource, /createSustainedP95Governor\(\{/);
assert.match(mainSource, /timestampFrameCount !== 1/);
assert.match(mainSource, /aoStage\.setTier\(tierConfig\.aoTier\)/);
assert.match(mainSource, /bloomStage\.setResolutionScale\(tierConfig\.bloomScale\)/);
assert.match(mainSource, /effectMesh\.count = tierConfig\.effectInstances/);
assert.match(mainSource, /unpackAlignedReadback\(/);
assert.match(mainSource, /renderPipeline\.outputColorTransform = false/);
assert.match(mainSource, /motionCore\.motionPlan\.beginFrameMatrices\(\)/);
assert.match(mainSource, /motionCore\.motionPlan\.captureFrameMatrices\(camera, effectMesh\)/);
assert.match(mainSource, /motionCore\.motionPlan\.resetState\(/);
assert.match(mainSource, /motionCore\.motionPlan\.seek\(renderer,/);
assert.match(mainSource, /motionCore\.motionPlan\.dispose\(\)/);
assert.doesNotMatch(mainSource, /simulationTime \+ fixedStep\) %/);
assert.match(packageJson.scripts.capture, /scripts\/capture-lab-browser\.mjs/);
assert.match(packageJson.scripts.capture, /--hook capture\.mjs/);
assert.doesNotMatch(packageJson.scripts.capture, /--profile/, "capture script must forward an optional caller profile instead of hard-locking one");
assert.match(captureSource, /session\.writeCapture\(/);
for (const image of ["final.design.png", "no-post.design.png", "diagnostics.mosaic.png", "camera.near.png", "camera.design.png", "camera.far.png", "seed-0001.final.png", "seed-9e3779b9.final.png", "temporal.t000.png", "temporal.t001.png"]) {
  assert.match(captureSource, new RegExp(image.replaceAll(".", "\\.")), `capture hook omits ${image}`);
}

console.log("Final Image Flight strict locks, materialized pre-grade HDR, live diagnostics, tier governor, shared capture hook, and browser-free contracts validated");
