import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDemoRegistry } from "../../scripts/lib/lab-registry.mjs";
import {
  INTEGRATION_REASON,
  loadAvailableAdapterFactories,
  validateIntegrationContract,
} from "../shared/integration-contract-core.mjs";
import { validateLabManifest, validateRawLabManifest } from "../../scripts/lib/lab-validation.mjs";
import { plannedPublishedRoutes } from "../../scripts/lib/page-routes.mjs";
import { sampleRelativisticMotion } from "./host-stages.mjs";
import { RELATIVISTIC_TIER_CONFIG } from "./main.mjs";
import {
  createRelativisticSpaceShotGraph,
  validateRelativisticSpaceShotGraph,
} from "./owner-graph.mjs";
import {
  createRelativisticQualityGovernor,
  validateRelativisticTierPolicy,
} from "./quality-governor.mjs";
import {
  RELATIVISTIC_CAMERAS,
  RELATIVISTIC_MECHANISMS,
  RELATIVISTIC_MODES,
  RELATIVISTIC_SCENARIOS,
  RELATIVISTIC_TIERS,
  assertRelativisticRouteLock,
  parseRelativisticRoute,
} from "./routes.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "../..");
const manifest = JSON.parse(readFileSync(join(root, "lab.manifest.json"), "utf8"));
const contract = JSON.parse(readFileSync(join(root, "contract.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const targets = JSON.parse(readFileSync(join(repoRoot, "labs/canonical-targets.json"), "utf8"));
const target = targets.integrations.find((entry) => entry.id === "relativistic-space-shot");

const raw = validateRawLabManifest(manifest);
assert.deepEqual(raw.errors, [], raw.errors.join("\n"));
const registryManifest = buildDemoRegistry().demos.find((entry) => entry.id === manifest.id);
assert(registryManifest, `registry contains ${manifest.id}`);
const normalized = validateLabManifest(registryManifest, { root: repoRoot, validateEvidence: false });
assert.deepEqual(normalized.errors, [], normalized.errors.join("\n"));
assert.equal(manifest.status, "incomplete");
assert.equal(manifest.evidenceBundle, null);
assert.equal(manifest.evidenceContract, "v2");

assert(target, "relativistic-space-shot frozen target is absent");
assert.deepEqual(RELATIVISTIC_SCENARIOS, target.scenarios);
assert.deepEqual(RELATIVISTIC_MECHANISMS, target.mechanisms);
assert.deepEqual(RELATIVISTIC_TIERS, target.tiers);
assert.deepEqual(RELATIVISTIC_MODES, target.modes);
assert.deepEqual(manifest.cameras, [...RELATIVISTIC_CAMERAS]);
assert.deepEqual(contract.modes, target.modes);

const routeCases = [
  ["/demos/relativistic-space-shot/", "", { tier: "balanced", mode: "final", mechanism: null }],
  ["/demos/relativistic-space-shot/tier/hero/", "", { tier: "hero", mode: "final", mechanism: null }],
  ["/demos/relativistic-space-shot/mechanism/curved-ray-hdr/", "", { tier: "balanced", mode: "curved-ray", mechanism: "curved-ray-hdr" }],
  ["/demos/relativistic-space-shot/", "?mechanism=shared-emissive-bloom&tier=budgeted", { tier: "budgeted", mode: "bloom", mechanism: "shared-emissive-bloom" }],
];
for (const [pathname, search, expected] of routeCases) {
  const route = parseRelativisticRoute({ pathname, search });
  assert.equal(route.tier, expected.tier);
  assert.equal(route.mode, expected.mode);
  assert.equal(route.mechanism, expected.mechanism);
}
assert.throws(() => parseRelativisticRoute({ pathname: "/tier/fabricated/", search: "" }), /unknown Relativistic Space Shot tier/);
assert.throws(() => parseRelativisticRoute({ pathname: "/mechanism/private-pass/", search: "" }), /unknown Relativistic Space Shot mechanism/);
assert.throws(() => parseRelativisticRoute({ pathname: "/", search: "?mode=private-output" }), /unknown Relativistic Space Shot mode/);
const locked = parseRelativisticRoute({ pathname: "/mechanism/shared-emissive-bloom/", search: "?tier=hero" });
assert.throws(() => assertRelativisticRouteLock(locked, { mode: "final" }), /mechanism mode is locked/);
assert.throws(() => assertRelativisticRouteLock(locked, { tier: "budgeted" }), /tier route is locked/);

const integration = validateIntegrationContract(contract);
assert.equal(integration.verdict, "PASS", integration.message);
assert.equal(integration.code, INTEGRATION_REASON.INCOMPLETE);
assert.equal(integration.details.missingAdapters.length, 0);
assert.equal(integration.details.availableAdapters.length, 7);
const adapters = await loadAvailableAdapterFactories(contract);
assert.equal(adapters.ready, true, JSON.stringify(adapters.errors));
assert.equal(adapters.loaded.size, 7);

const tierPolicy = validateRelativisticTierPolicy({
  manifestTiers: manifest.tiers,
  contractTiers: contract.tiers,
  runtimeTiers: RELATIVISTIC_TIER_CONFIG,
});
assert.deepEqual(tierPolicy.errors, []);
for (const tierRecord of manifest.tiers) {
  assert.equal(tierRecord.resolutionPolicy.sceneScale, 1);
  assert.equal(tierRecord.resolutionPolicy.rayScale, 1);
}
assert.match(contract.integrationConstraints.resolutionConstraint, /TRAANode requires scene color, depth, and velocity at drawing-buffer extent/);

const graph = createRelativisticSpaceShotGraph({
  width: 1200,
  height: 800,
  tier: "balanced",
  activeMode: "final",
  spaceDescription: { rendererOwner: "host", outputOwner: "host" },
  particleDescription: { rendererOwner: "host", outputOwner: "host" },
  bloomDescription: { inputSignal: "scene.emissive" },
  imageDescription: { owner: "host-image-pipeline-stage" },
});
assert.deepEqual(validateRelativisticSpaceShotGraph(graph).errors, []);
assert.equal(graph.rendererOwners.length, 1);
assert.equal(graph.sceneSubmissions.length, 1);
assert.equal(graph.outputColorTransform, false);
assert.equal(graph.bloomInputSignal, "scene.emissive");
assert.equal(graph.exposureMeterSourceSignal, "scene.pregrade");
assert.equal(graph.temporalOwner, "threejs-image-pipeline");

const atZero = sampleRelativisticMotion(0);
const atZeroAgain = sampleRelativisticMotion(0);
assert.deepEqual(atZero, atZeroAgain);
assert(atZero.velocity.every(Number.isFinite));
assert.notDeepEqual(sampleRelativisticMotion(3.5).position, atZero.position);
assert.throws(() => sampleRelativisticMotion(-1), /nonnegative/);

const governorTransitions = [];
const governor = createRelativisticQualityGovernor({
  initialTier: "hero",
  windowSize: 4,
  downgradePersistence: 2,
  upgradePersistence: 2,
  cooldownWindows: 1,
  locked: false,
  onTransition: (transition) => governorTransitions.push(transition),
});
for (let index = 0; index < 8; index += 1) governor.record(22);
assert.equal(governor.describe().activeTier, "balanced");
assert.equal(governorTransitions[0].reason, "sustained-p95-overrun");
for (let index = 0; index < 12; index += 1) governor.record(8);
assert.equal(governor.describe().activeTier, "hero");
assert.equal(governorTransitions.at(-1).reason, "sustained-p95-headroom");
assert(governor.describe().windows.every((window) => Number.isFinite(window.p95Ms)));

const routes = plannedPublishedRoutes(manifest);
assert.equal(routes.length, manifest.scenarios.length + manifest.mechanisms.length + manifest.tiers.length);
for (const mechanism of manifest.mechanisms) {
  assert(routes.some((route) => route.kind === "mechanism" && route.id === mechanism.id));
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
  assert.match(command, /^npm --prefix integration-labs\/relativistic-space-shot run /, `manifest command ${name} is not local`);
}
assert(manifest.canonicalSource.every((source) => existsSync(join(repoRoot, source))), "canonicalSource contains a missing file");
assert(manifest.canonicalSource.every((source) => !source.includes("integration-labs/shared/browser-controller")));

const mainSource = readFileSync(join(root, "main.mjs"), "utf8");
assert.equal((mainSource.match(/new WebGPURenderer\s*\(/g) ?? []).length, 1, "host must construct one renderer");
assert.equal((mainSource.match(/new RenderPipeline\s*\(/g) ?? []).length, 1, "host must construct one RenderPipeline");
assert.match(mainSource, /await renderer\.init\(\)/);
assert.match(mainSource, /isWebGPUBackend !== true/);
assert.match(mainSource, /createSpaceIntegratorStage\(\{/);
assert.match(mainSource, /createPooledEffectsStage\(\{/);
assert.match(mainSource, /createImagePipelineStage\(\{/);
assert.match(mainSource, /scenePass\.setMRT\(sceneMrt\)/);
assert.match(mainSource, /setBlendMode\("emissive", new BlendMode\(MaterialBlending\)\)/);
assert.match(mainSource, /createSharedEmissiveBloomStage\(\{/);
assert.match(mainSource, /unpackAlignedReadback\(/);
assert.match(mainSource, /function replayParticleState\(seconds\)/);
assert.match(mainSource, /particleStage\.sparkPool\.reset\(renderer\)/);
assert.match(mainSource, /particleStage\.debrisPool\.reset\(renderer\)/);
assert.match(mainSource, /renderer\.toneMapping = NoToneMapping/);
assert.match(mainSource, /renderPipeline\.outputColorTransform = false/);
assert.match(mainSource, /async ready\(\) \{\s*cameraStage\.update\(\);\s*await this\.renderOnce\(\);\s*\}/);
assert.doesNotMatch(mainSource, /cameraStage\.update\(deltaSeconds\)/);
assert.doesNotMatch(mainSource, /WebGLRenderer|automatic fallback|fallbackRenderer/);

console.log("Relativistic Space Shot strict manifest, exact routes, live adapters, single-owner graph, deterministic motion, and browser-free contracts validated");
