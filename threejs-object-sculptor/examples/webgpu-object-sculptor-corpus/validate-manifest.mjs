import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three/webgpu";

import { SCULPT_MODES, SCULPT_TIERS, summarizeSculptRuntime } from "../shared/sculpt-runtime.js";
import { CORPUS_DPR_CAPS } from "./lab-controller.js";
import { SCULPT_TARGETS } from "./object-catalog.js";
import { CORPUS_CAMERAS } from "./route-state.js";
import {
  CORPUS_MOBILE_ARCHITECTURE_MODEL_PLAN,
  CORPUS_PERFORMANCE_TARGET_PLAN,
  validateCorpusArtifacts,
} from "./validate-artifacts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const manifestPath = resolve(here, "lab.manifest.json");
const corpusContractPath = resolve(here, "corpus.contract.json");
const UINT32_MAX = 0xffffffff;
const ACCEPTANCE_STATUSES = new Set(["accepted", "incomplete", "blocked"]);

const EXPECTED_TARGET_IDS = Object.freeze([
  "articulated-desk-lamp",
  "potted-bonsai",
  "ceramic-teapot",
]);
const EXPECTED_DEEP_COMMANDS = Object.freeze({
  specs: "npm --prefix threejs-object-sculptor/examples/webgpu-object-sculptor-corpus run validate:specs",
  targets: "npm --prefix threejs-object-sculptor/examples/webgpu-object-sculptor-corpus run validate:targets",
  unit: "npm --prefix threejs-object-sculptor/examples/webgpu-object-sculptor-corpus run validate:unit",
  generateRoutes: "npm --prefix threejs-object-sculptor/examples/webgpu-object-sculptor-corpus run generate:routes",
  routes: "npm --prefix threejs-object-sculptor/examples/webgpu-object-sculptor-corpus run validate:routes",
});
const ACCEPTED_STATUS_WORDS = new Set(["accepted", "complete", "completed", "pass", "passed"]);
const BONSAI_BRANCH_IDS = Object.freeze([
  "branch-left",
  "branch-right",
  "branch-back",
  "branch-left-secondary",
  "branch-right-secondary",
  "branch-back-secondary",
]);
const BONSAI_COLLIDER_VISUALS = Object.freeze({
  "pot-solid": Object.freeze(["pot-body", "pot-rim", "pot-foot"]),
  "trunk-capsule": Object.freeze(["trunk-surface"]),
  "branch-left-capsule": Object.freeze(["branch-left-surface"]),
  "branch-right-capsule": Object.freeze(["branch-right-surface"]),
  "branch-back-capsule": Object.freeze(["branch-back-surface"]),
  "canopy-trigger": Object.freeze(BONSAI_BRANCH_IDS.map((id) => `${id}-foliage`)),
});
const VISUAL_SCULPT_PASS_IDS = new Set([
  "blockout",
  "structural-pass",
  "form-refinement",
  "material-pass",
  "surface-pass",
  "lighting-pass",
  "interaction-pass",
]);

function readJson(path, label) {
  assert(existsSync(path), `missing ${label}: ${path}`);
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error.message}`);
  }
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be a JSON object`);
  return value;
}

function ids(entries, label) {
  assert(Array.isArray(entries), `${label} must be an array`);
  return entries.map((entry, index) => {
    assert(entry && typeof entry === "object" && !Array.isArray(entry), `${label}[${index}] must be an object`);
    assert.equal(typeof entry.id, "string", `${label}[${index}].id must be a string`);
    return entry.id;
  });
}

function exact(actual, expected, label) {
  assert.deepEqual([...actual], [...expected], `${label} must preserve canonical order and membership`);
}

function requireObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function exactKeys(value, expected, label) {
  requireObject(value, label);
  exact(Object.keys(value), expected, `${label} keys`);
}

function requireText(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert(value.trim().length > 0, `${label} must be nonempty`);
  return value;
}

function requireBoolean(value, label) {
  assert.equal(typeof value, "boolean", `${label} must be boolean`);
  return value;
}

function requireInteger(value, label, { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  assert(Number.isInteger(value), `${label} must be an integer`);
  assert(value >= minimum && value <= maximum, `${label} must be in [${minimum}, ${maximum}]`);
  return value;
}

function requireFiniteNumber(value, label, { minimum = -Infinity, maximum = Infinity } = {}) {
  assert(Number.isFinite(value), `${label} must be finite`);
  assert(value >= minimum && value <= maximum, `${label} must be in [${minimum}, ${maximum}]`);
  return value;
}

function requireStringArray(value, label, { nonempty = false, unique = false } = {}) {
  assert(Array.isArray(value), `${label} must be an array`);
  if (nonempty) assert(value.length > 0, `${label} must be nonempty`);
  value.forEach((entry, index) => requireText(entry, `${label}[${index}]`));
  if (unique) assert.equal(new Set(value).size, value.length, `${label} must contain unique values`);
  return value;
}

function requireRepoPath(value, label) {
  requireText(value, label);
  assert(!value.startsWith("/"), `${label} must be repository-relative`);
  assert(!value.split("/").includes(".."), `${label} must not traverse parent directories`);
  return value;
}

function requireAcceptanceStatus(value, label) {
  assert(ACCEPTANCE_STATUSES.has(value), `${label} must be accepted, incomplete, or blocked`);
  return value;
}

function colliderSignedDistance(point, shape) {
  if (shape.kind === "sphere") {
    return point.distanceTo(new THREE.Vector3(...shape.centerMeters)) - shape.radiusMeters;
  }
  const start = new THREE.Vector3(...shape.startMeters);
  const end = new THREE.Vector3(...shape.endMeters);
  const axis = end.clone().sub(start);
  const length = axis.length();
  axis.multiplyScalar(1 / length);
  if (shape.kind === "capsule") {
    const along = THREE.MathUtils.clamp(point.clone().sub(start).dot(axis), 0, length);
    return point.distanceTo(start.clone().addScaledVector(axis, along)) - shape.radiusMeters;
  }
  if (shape.kind === "cylinder") {
    const center = start.clone().add(end).multiplyScalar(0.5);
    const relative = point.clone().sub(center);
    const axialCoordinate = relative.dot(axis);
    const radialDistance = relative.addScaledVector(axis, -axialCoordinate).length();
    const radial = radialDistance - shape.radiusMeters;
    const axial = Math.abs(axialCoordinate) - length * 0.5;
    return Math.hypot(Math.max(radial, 0), Math.max(axial, 0)) + Math.min(Math.max(radial, axial), 0);
  }
  throw new Error(`unsupported collider witness shape ${shape.kind}`);
}

function sampledVisualToProxyDeviation(asset, colliderId) {
  const collider = asset.runtime.colliders.get(colliderId);
  assert(collider, `missing collider ${colliderId} while measuring directed witness`);
  const meshIds = BONSAI_COLLIDER_VISUALS[colliderId];
  assert(meshIds, `missing directed witness visual scope for ${colliderId}`);
  asset.root.updateMatrixWorld(true);
  const entity = asset.runtime.nodes.get(collider.entityId.localId);
  assert(entity, `missing collider entity ${collider.entityId.localId}`);
  const worldToEntity = entity.matrixWorld.clone().invert();
  const point = new THREE.Vector3();
  let maximum = 0;
  for (const meshId of meshIds) {
    const mesh = asset.runtime.meshes.get(meshId);
    assert(mesh, `missing directed witness mesh ${meshId}`);
    const transform = worldToEntity.clone().multiply(mesh.matrixWorld);
    const position = mesh.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(transform);
      maximum = Math.max(maximum, Math.abs(colliderSignedDistance(point, collider.shape)));
    }
  }
  return maximum;
}

function validateBonsaiColliderWitnessMeasurements(definition, witness) {
  const measured = Object.fromEntries(Object.keys(witness.valuesMeters).map((id) => [id, 0]));
  const cases = [
    ...SCULPT_TIERS.map((tier) => ({ tier, seed: witness.tierSeed })),
    ...witness.fullTierSeedCorpus.map((seed) => ({ tier: "full", seed })),
  ];
  for (const { tier, seed } of cases) {
    const asset = definition.create({ tier, seed });
    try {
      for (const colliderId of Object.keys(measured)) {
        measured[colliderId] = Math.max(measured[colliderId], sampledVisualToProxyDeviation(asset, colliderId));
      }
    } finally {
      asset.dispose();
    }
  }
  for (const [colliderId, declared] of Object.entries(witness.valuesMeters)) {
    assert(
      Math.abs(measured[colliderId] - declared) <= 1e-12,
      `potted-bonsai/${colliderId} directed lower-bound witness drifted: declared ${declared}, measured ${measured[colliderId]}`,
    );
  }
  return Object.freeze(measured);
}

function captureDigestMap(corpus) {
  const bundle = corpus.acceptancePromotion.evidenceBundle;
  const session = readJson(resolve(repositoryRoot, bundle, "capture-session.json"), "accepted capture session");
  const captures = session.hookResult?.captures;
  assert(Array.isArray(captures) && captures.length > 0, "accepted capture session needs digest-bound captures");
  return new Map(captures.map((capture, index) => {
    requireText(capture.filename, `accepted capture[${index}].filename`);
    assert.equal(capture.file?.path, capture.filename, `accepted capture[${index}] file path drifted from filename`);
    const digest = capture.file?.sha256;
    assert.match(digest ?? "", /^[a-f0-9]{64}$/, `accepted capture[${index}] needs a sha256 digest`);
    return [`${bundle}/${capture.file.path}`, digest];
  }));
}

function makeSyntheticPromotedSpecFixture(spec, definition, evidenceBundle) {
  const promoted = structuredClone(spec);
  const digest = "a".repeat(64);
  const imagePath = `${evidenceBundle}/${definition.id}.final.full.design.png`;
  const visualEvidence = {
    referenceScreenshot: "",
    renderScreenshot: imagePath,
    renderScreenshotSha256: digest,
    comparisonImage: "",
    cameraView: "design",
    notes: "Synthetic positive control for acceptance wiring only.",
    aiVisionNotes: "Synthetic positive control for acceptance wiring only.",
  };
  promoted.reviewHistory = promoted.buildPasses.map(({ id }) => ({
    passId: id,
    action: "continue",
    aiVisionScore: 1,
    visualAcceptanceThreshold: 0.8,
    ...(VISUAL_SCULPT_PASS_IDS.has(id) ? { visualEvidence: { ...visualEvidence } } : {}),
  }));
  promoted.visualEvidence = promoted.buildPasses
    .filter(({ id }) => VISUAL_SCULPT_PASS_IDS.has(id))
    .map(({ id }) => ({ passId: id, ...visualEvidence }));
  promoted.sculptPipeline.completedPasses = promoted.buildPasses.map(({ id }) => id);
  promoted.sculptPipeline.currentPass = "complete";
  promoted.sculptPipeline.lastCompletedPass = promoted.buildPasses.at(-1).id;
  promoted.sculptPipeline.blockedReason = "All acceptance evidence passed.";
  promoted.sculptPipeline.nextRequiredEvidence = [];
  return Object.freeze({ spec: promoted, artifactDigests: new Map([[imagePath, digest]]) });
}

function requireIncomplete(value, label) {
  assert.equal(value, "incomplete", `${label} must remain incomplete until accepted evidence exists`);
}

function rejectAcceptedStatus(value, path = "root") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectAcceptedStatus(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (
      typeof entry === "string"
      && (key === "status" || key.endsWith("Status"))
      && ACCEPTED_STATUS_WORDS.has(entry.toLowerCase())
    ) {
      throw new Error(`${childPath} falsely claims accepted state without evidence`);
    }
    rejectAcceptedStatus(entry, childPath);
  }
}

function validateStartupShape(startup, label, keys) {
  exactKeys(startup, keys, label);
  for (const key of keys) {
    if (key === "seed") requireInteger(startup[key], `${label}.seed`, { minimum: 0, maximum: UINT32_MAX });
    else requireText(startup[key], `${label}.${key}`);
  }
}

function validateCorpusDeepContractShape(corpus) {
  exactKeys(corpus, [
    "schemaVersion",
    "id",
    "manifestId",
    "manifestPath",
    "canonicalSchemaPath",
    "status",
    "acceptancePromotion",
    "defaultStartup",
    "scenarios",
    "mechanisms",
    "tiers",
    "authoredPerformanceTargets",
    "cameras",
    "corpusDiversityContract",
    "physicalRouteContract",
    "renderArchitecture",
    "physicsBoundary",
    "identityContinuity",
    "referencePolicy",
    "visualAcceptance",
    "commands",
  ], "corpus deep contract");
  requireInteger(corpus.schemaVersion, "corpus.schemaVersion", { minimum: 1, maximum: 1 });
  for (const field of ["id", "manifestId"]) requireText(corpus[field], `corpus.${field}`);
  for (const field of ["manifestPath", "canonicalSchemaPath"]) requireRepoPath(corpus[field], `corpus.${field}`);
  requireAcceptanceStatus(corpus.status, "corpus.status");

  const promotion = corpus.acceptancePromotion;
  exactKeys(promotion, [
    "validatorModule",
    "validatorExport",
    "evidenceBundle",
    "evidenceReviewState",
    "requiredClaimVerdict",
    "promotedStatus",
    "unpromotedStatus",
    "failedStatus",
    "promotedRenderClaimStatus",
    "unpromotedRenderClaimStatus",
    "failedRenderClaimStatus",
    "scope",
  ], "corpus.acceptancePromotion");
  requireRepoPath(promotion.validatorModule, "corpus.acceptancePromotion.validatorModule");
  requireText(promotion.validatorExport, "corpus.acceptancePromotion.validatorExport");
  requireRepoPath(promotion.evidenceBundle, "corpus.acceptancePromotion.evidenceBundle");
  assert.equal(
    promotion.validatorModule,
    "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/validate-artifacts.mjs",
    "acceptance promotion validator module drifted",
  );
  assert.equal(promotion.validatorExport, "validateCorpusArtifacts", "acceptance promotion validator export drifted");
  assert(["collecting", "candidate"].includes(promotion.evidenceReviewState), "acceptance evidence review state must be collecting or candidate");
  assert.equal(promotion.requiredClaimVerdict, "PASS", "acceptance promotion must require the derived PASS verdict");
  assert.equal(promotion.promotedStatus, "accepted", "accepted must be the promotion status");
  assert.equal(promotion.unpromotedStatus, "incomplete", "incomplete must be the unpromoted status");
  assert.equal(promotion.failedStatus, "blocked", "blocked must be the failed-evidence status");
  requireText(promotion.promotedRenderClaimStatus, "corpus.acceptancePromotion.promotedRenderClaimStatus");
  requireText(promotion.unpromotedRenderClaimStatus, "corpus.acceptancePromotion.unpromotedRenderClaimStatus");
  requireText(promotion.failedRenderClaimStatus, "corpus.acceptancePromotion.failedRenderClaimStatus");
  assert.equal(
    new Set([
      promotion.promotedRenderClaimStatus,
      promotion.unpromotedRenderClaimStatus,
      promotion.failedRenderClaimStatus,
    ]).size,
    3,
    "accepted, incomplete, and failed render claim statuses must differ",
  );
  requireText(promotion.scope, "corpus.acceptancePromotion.scope");

  validateStartupShape(corpus.defaultStartup, "corpus.defaultStartup", ["scenario", "mechanism", "tier", "camera", "seed"]);
  assert(Array.isArray(corpus.scenarios) && corpus.scenarios.length > 0, "corpus.scenarios must be nonempty");
  corpus.scenarios.forEach((scenario, index) => {
    const label = `corpus.scenarios[${index}]`;
    exactKeys(scenario, ["id", "route", "category", "formLanguage", "startup", "spec", "referenceManifest", "factory", "status"], label);
    for (const field of ["id", "route", "category"]) requireText(scenario[field], `${label}.${field}`);
    requireStringArray(scenario.formLanguage, `${label}.formLanguage`, { nonempty: true, unique: true });
    validateStartupShape(scenario.startup, `${label}.startup`, ["scenario", "mechanism", "tier", "camera", "seed"]);
    for (const field of ["spec", "referenceManifest", "factory"]) requireRepoPath(scenario[field], `${label}.${field}`);
    requireAcceptanceStatus(scenario.status, `${label}.status`);
  });

  assert(Array.isArray(corpus.mechanisms) && corpus.mechanisms.length > 0, "corpus.mechanisms must be nonempty");
  corpus.mechanisms.forEach((mechanism, index) => {
    const label = `corpus.mechanisms[${index}]`;
    exactKeys(mechanism, ["id", "route", "startup", "status"], label);
    requireText(mechanism.id, `${label}.id`);
    requireText(mechanism.route, `${label}.route`);
    validateStartupShape(mechanism.startup, `${label}.startup`, ["mechanism"]);
    requireAcceptanceStatus(mechanism.status, `${label}.status`);
  });

  assert(Array.isArray(corpus.tiers) && corpus.tiers.length > 0, "corpus.tiers must be nonempty");
  corpus.tiers.forEach((tier, tierIndex) => {
    const label = `corpus.tiers[${tierIndex}]`;
    exactKeys(tier, ["id", "route", "sourceWorkloadEvidence", "status"], label);
    requireText(tier.id, `${label}.id`);
    requireText(tier.route, `${label}.route`);
    exactKeys(tier.sourceWorkloadEvidence, EXPECTED_TARGET_IDS, `${label}.sourceWorkloadEvidence`);
    for (const targetId of EXPECTED_TARGET_IDS) {
      const evidence = tier.sourceWorkloadEvidence[targetId];
      const evidenceLabel = `${label}.sourceWorkloadEvidence.${targetId}`;
      exactKeys(evidence, ["seed", "storedVertices", "triangles", "renderItems", "shadowCasters"], evidenceLabel);
      requireInteger(evidence.seed, `${evidenceLabel}.seed`, { minimum: 0, maximum: UINT32_MAX });
      for (const field of ["storedVertices", "triangles", "renderItems", "shadowCasters"]) {
        requireInteger(evidence[field], `${evidenceLabel}.${field}`, { minimum: 0 });
      }
    }
    requireAcceptanceStatus(tier.status, `${label}.status`);
  });

  const performance = corpus.authoredPerformanceTargets;
  exactKeys(performance, [
    "label",
    "claimStatus",
    "currentReviewProfile",
    "profilesByTier",
    "mobileArchitectureModels",
    "legacySpecBindingTier",
    "legacySpecFieldSemantics",
    "targetsByTier",
    "requiredPerformanceCases",
    "evidenceBindingRequirement",
    "evidenceBindingStatus",
    "measurementPromotionRequirement",
  ], "corpus.authoredPerformanceTargets");
  assert.equal(performance.label, "Authored", "performance target label must be Authored");
  assert.equal(performance.claimStatus, "unmeasured-target-only", "performance targets must remain explicitly unmeasured");
  exactKeys(performance.currentReviewProfile, ["surface", "role", "canPromotePhysicalDevicePerformance", "promotionCondition"], "corpus.authoredPerformanceTargets.currentReviewProfile");
  assert.equal(performance.currentReviewProfile.surface, "Codex in-app Browser", "current review must use the Codex in-app Browser");
  requireText(performance.currentReviewProfile.role, "corpus.authoredPerformanceTargets.currentReviewProfile.role");
  requireText(performance.currentReviewProfile.promotionCondition, "corpus.authoredPerformanceTargets.currentReviewProfile.promotionCondition");
  assert.equal(performance.currentReviewProfile.canPromotePhysicalDevicePerformance, false, "attached-host review cannot promote physical-device performance");
  exactKeys(performance.profilesByTier, SCULPT_TIERS, "corpus.authoredPerformanceTargets.profilesByTier");
  const expectedProfileByTier = {
    full: CORPUS_PERFORMANCE_TARGET_PLAN[0],
    budgeted: CORPUS_PERFORMANCE_TARGET_PLAN[1],
    minimum: CORPUS_PERFORMANCE_TARGET_PLAN[1],
  };
  for (const tier of SCULPT_TIERS) {
    const profile = performance.profilesByTier[tier];
    const expectedProfile = expectedProfileByTier[tier];
    const label = `corpus.authoredPerformanceTargets.profilesByTier.${tier}`;
    exactKeys(profile, ["id", "profileRole", "allowedDevices", "allowedSocs", "operatingSystem", "browser", "backend", "refreshHz", "viewportPolicy", "dprCap"], label);
    for (const field of ["id", "profileRole", "operatingSystem", "browser", "backend", "viewportPolicy"]) requireText(profile[field], `${label}.${field}`);
    assert.equal(profile.id, expectedProfile.id, `${label}.id drifted from the artifact target plan`);
    assert.equal(profile.profileRole, expectedProfile.profileRole, `${label}.profileRole drifted from the artifact target plan`);
    assert.deepEqual(profile.allowedDevices, expectedProfile.allowedDevices, `${label}.allowedDevices drifted from the artifact target plan`);
    assert.deepEqual(profile.allowedSocs, expectedProfile.allowedSocs, `${label}.allowedSocs drifted from the artifact target plan`);
    assert.equal(profile.operatingSystem, "macOS", `${label}.operatingSystem must match the physical target matrix`);
    assert.equal(profile.browser, "Codex in-app Browser", `${label}.browser must use the physical evidence surface`);
    assert.equal(profile.backend, "native WebGPU", `${label}.backend must remain native WebGPU`);
    requireInteger(profile.refreshHz, `${label}.refreshHz`, { minimum: 1 });
    requireFiniteNumber(profile.dprCap, `${label}.dprCap`, { minimum: 0.25, maximum: 4 });
    assert.equal(profile.dprCap, CORPUS_DPR_CAPS[tier], `${tier} performance profile DPR cap drifted from runtime policy`);
  }
  assert(Array.isArray(performance.mobileArchitectureModels), "corpus mobile architecture models must be an array");
  assert.equal(performance.mobileArchitectureModels.length, CORPUS_MOBILE_ARCHITECTURE_MODEL_PLAN.length, "corpus mobile model inventory drifted");
  for (let index = 0; index < CORPUS_MOBILE_ARCHITECTURE_MODEL_PLAN.length; index += 1) {
    const expected = CORPUS_MOBILE_ARCHITECTURE_MODEL_PLAN[index];
    const model = performance.mobileArchitectureModels[index];
    const label = `corpus.authoredPerformanceTargets.mobileArchitectureModels[${index}]`;
    exactKeys(model, ["id", "tier", "deviceClass", "socClass", "status", "performanceClaim", "purpose"], label);
    for (const field of ["id", "tier", "deviceClass", "socClass"]) assert.equal(model[field], expected[field], `${label}.${field} drifted from the artifact model plan`);
    assert.equal(model.status, "MODEL_ONLY_NOT_PERFORMANCE_ACCEPTANCE", `${label}.status must exclude physical acceptance`);
    assert.equal(model.performanceClaim, "NOT_CLAIMED", `${label}.performanceClaim must remain NOT_CLAIMED`);
    requireText(model.purpose, `${label}.purpose`);
  }
  assert.equal(performance.legacySpecBindingTier, "full", "legacy spec performance fields must bind to the full authored tier");
  exactKeys(performance.legacySpecFieldSemantics, ["fpsTarget", "maxDrawCalls"], "corpus.authoredPerformanceTargets.legacySpecFieldSemantics");
  requireText(performance.legacySpecFieldSemantics.fpsTarget, "legacy fpsTarget semantics");
  requireText(performance.legacySpecFieldSemantics.maxDrawCalls, "legacy maxDrawCalls semantics");
  assert.match(performance.legacySpecFieldSemantics.fpsTarget, /Authored.*not a measured/i, "fpsTarget semantics must deny measured status");
  assert.match(performance.legacySpecFieldSemantics.maxDrawCalls, /Authored.*render items.*not a measured/i, "maxDrawCalls semantics must define render-item scope and deny measured status");
  exactKeys(performance.targetsByTier, SCULPT_TIERS, "corpus.authoredPerformanceTargets.targetsByTier");
  for (const tier of SCULPT_TIERS) {
    exactKeys(performance.targetsByTier[tier], EXPECTED_TARGET_IDS, `corpus.authoredPerformanceTargets.targetsByTier.${tier}`);
    for (const targetId of EXPECTED_TARGET_IDS) {
      const target = performance.targetsByTier[tier][targetId];
      exactKeys(target, ["fpsTarget", "maxDrawCalls"], `corpus.authoredPerformanceTargets.targetsByTier.${tier}.${targetId}`);
      requireInteger(target.fpsTarget, `${tier}/${targetId}.fpsTarget`, { minimum: 1 });
      requireInteger(target.maxDrawCalls, `${tier}/${targetId}.maxDrawCalls`, { minimum: 1 });
      assert.equal(target.fpsTarget, performance.profilesByTier[tier].refreshHz, `${tier}/${targetId} fps target must match the named profile refresh`);
    }
  }
  assert(Array.isArray(performance.requiredPerformanceCases), "corpus authored performance cases must be an array");
  assert.equal(performance.requiredPerformanceCases.length, SCULPT_TIERS.length * EXPECTED_TARGET_IDS.length, "authored performance cases must cover every subject/tier pair");
  const casePairs = new Set();
  const caseIds = new Set();
  for (const [index, performanceCase] of performance.requiredPerformanceCases.entries()) {
    const label = `corpus.authoredPerformanceTargets.requiredPerformanceCases[${index}]`;
    exactKeys(performanceCase, ["id", "scenario", "tier", "mode", "camera", "seed", "profileId"], label);
    for (const field of ["id", "scenario", "tier", "mode", "camera", "profileId"]) requireText(performanceCase[field], `${label}.${field}`);
    requireInteger(performanceCase.seed, `${label}.seed`, { minimum: 0, maximum: UINT32_MAX });
    assert(EXPECTED_TARGET_IDS.includes(performanceCase.scenario), `${label}.scenario is unknown`);
    assert(SCULPT_TIERS.includes(performanceCase.tier), `${label}.tier is unknown`);
    assert.equal(performanceCase.mode, "action-ready", `${label}.mode must exercise authored motion`);
    assert.equal(performanceCase.camera, "design", `${label}.camera must use the frozen design framing`);
    assert.equal(performanceCase.profileId, performance.profilesByTier[performanceCase.tier].id, `${label}.profileId drifted`);
    const evidence = corpus.tiers.find(({ id }) => id === performanceCase.tier).sourceWorkloadEvidence[performanceCase.scenario];
    assert.equal(performanceCase.seed, evidence.seed, `${label}.seed drifted from source workload provenance`);
    assert(!caseIds.has(performanceCase.id), `duplicate performance case ID ${performanceCase.id}`);
    caseIds.add(performanceCase.id);
    casePairs.add(`${performanceCase.scenario}/${performanceCase.tier}`);
  }
  assert.equal(casePairs.size, SCULPT_TIERS.length * EXPECTED_TARGET_IDS.length, "performance cases must cover each subject/tier pair exactly once");
  requireText(performance.evidenceBindingRequirement, "corpus.authoredPerformanceTargets.evidenceBindingRequirement");
  assert.match(performance.evidenceBindingRequirement, /Every required case.*single easy workload cannot promote/i, "performance evidence binding must reject one-workload promotion");
  assert(
    ["ready", "schema-complete-pending-distinct-m4-max-and-air-physical-sessions"].includes(performance.evidenceBindingStatus),
    "performance evidence binding status is invalid",
  );
  requireText(performance.measurementPromotionRequirement, "corpus.authoredPerformanceTargets.measurementPromotionRequirement");

  assert(Array.isArray(corpus.cameras) && corpus.cameras.length > 0, "corpus.cameras must be nonempty");
  corpus.cameras.forEach((camera, index) => {
    const label = `corpus.cameras[${index}]`;
    exactKeys(camera, ["id", "route", "purpose", "status"], label);
    for (const field of ["id", "route", "purpose"]) requireText(camera[field], `${label}.${field}`);
    requireAcceptanceStatus(camera.status, `${label}.status`);
  });

  const diversity = corpus.corpusDiversityContract;
  exactKeys(diversity, [
    "preexistingBoatBaseline",
    "boatBaselineCountsTowardMinimum",
    "minimumNonBoatTargets",
    "actualNonBoatTargets",
    "requiresOrganicTarget",
    "organicTarget",
    "requiresDistinctConstructionFamilies",
    "constructionFamilies",
    "status",
  ], "corpus.corpusDiversityContract");
  requireText(diversity.preexistingBoatBaseline, "corpus diversity boat baseline");
  requireBoolean(diversity.boatBaselineCountsTowardMinimum, "corpus diversity boat-count policy");
  requireInteger(diversity.minimumNonBoatTargets, "corpus diversity minimum non-boat targets", { minimum: 1 });
  requireInteger(diversity.actualNonBoatTargets, "corpus diversity actual non-boat targets", { minimum: 0 });
  requireBoolean(diversity.requiresOrganicTarget, "corpus diversity organic requirement");
  requireText(diversity.organicTarget, "corpus diversity organic target");
  requireBoolean(diversity.requiresDistinctConstructionFamilies, "corpus diversity construction-family requirement");
  requireStringArray(diversity.constructionFamilies, "corpus diversity construction families", { nonempty: true, unique: true });
  requireAcceptanceStatus(diversity.status, "corpus diversity status");

  const routes = corpus.physicalRouteContract;
  exactKeys(routes, ["required", "dimensions", "routeCount", "generationPolicy", "status"], "corpus.physicalRouteContract");
  requireBoolean(routes.required, "corpus physical routes required");
  exactKeys(routes.dimensions, ["scenario", "mechanism", "tier", "camera"], "corpus.physicalRouteContract.dimensions");
  for (const field of ["scenario", "mechanism", "tier", "camera"]) requireInteger(routes.dimensions[field], `physical route dimension ${field}`, { minimum: 1 });
  requireInteger(routes.routeCount, "corpus physical route count", { minimum: 1 });
  requireText(routes.generationPolicy, "corpus physical route generation policy");
  requireAcceptanceStatus(routes.status, "corpus physical route status");

  const architecture = corpus.renderArchitecture;
  exactKeys(architecture, [
    "renderer",
    "requiredBackend",
    "fallback",
    "sceneRendersPerFrame",
    "postProcessingPasses",
    "presentationOwner",
    "toneMappingOwners",
    "outputTransformOwners",
    "claimStatus",
  ], "corpus.renderArchitecture");
  for (const field of ["renderer", "requiredBackend", "fallback", "presentationOwner", "claimStatus"]) requireText(architecture[field], `corpus.renderArchitecture.${field}`);
  for (const field of ["sceneRendersPerFrame", "postProcessingPasses", "toneMappingOwners", "outputTransformOwners"]) {
    requireInteger(architecture[field], `corpus.renderArchitecture.${field}`, { minimum: 0 });
  }

  const physics = corpus.physicsBoundary;
  exactKeys(physics, [
    "assetRecordType",
    "constraintRecordType",
    "units",
    "solverAuthority",
    "solverHandoffStatus",
    "massPropertiesStatus",
    "visualLodIndependent",
    "requiredAdapterBeforePhysicalClaims",
    "authoredColliderCeilingsMeters",
    "directedColliderLowerBoundWitnesses",
    "status",
  ], "corpus.physicsBoundary");
  for (const field of ["assetRecordType", "constraintRecordType", "units", "solverHandoffStatus", "massPropertiesStatus", "requiredAdapterBeforePhysicalClaims"]) {
    requireText(physics[field], `corpus.physicsBoundary.${field}`);
  }
  requireBoolean(physics.solverAuthority, "corpus.physicsBoundary.solverAuthority");
  requireBoolean(physics.visualLodIndependent, "corpus.physicsBoundary.visualLodIndependent");
  exactKeys(physics.authoredColliderCeilingsMeters, EXPECTED_TARGET_IDS, "corpus.physicsBoundary.authoredColliderCeilingsMeters");
  for (const targetId of EXPECTED_TARGET_IDS) {
    const ceilings = physics.authoredColliderCeilingsMeters[targetId];
    requireObject(ceilings, `corpus collider ceilings ${targetId}`);
    assert(Object.keys(ceilings).length > 0, `${targetId} collider ceilings must be nonempty`);
    for (const [colliderId, ceiling] of Object.entries(ceilings)) {
      requireText(colliderId, `${targetId} collider ceiling id`);
      requireFiniteNumber(ceiling, `${targetId}/${colliderId} collider ceiling`, { minimum: 0 });
    }
  }
  exactKeys(physics.directedColliderLowerBoundWitnesses, ["potted-bonsai"], "corpus.physicsBoundary.directedColliderLowerBoundWitnesses");
  const bonsaiWitness = physics.directedColliderLowerBoundWitnesses["potted-bonsai"];
  exactKeys(bonsaiWitness, ["direction", "sourceTest", "tierSeed", "fullTierSeedCorpus", "valuesMeters", "samplingStatement"], "potted-bonsai directed collider witness");
  assert.equal(bonsaiWitness.direction, "sampled-visual-vertices-to-authored-proxy-surface", "bonsai collider witness direction drifted");
  requireRepoPath(bonsaiWitness.sourceTest, "bonsai collider witness sourceTest");
  requireInteger(bonsaiWitness.tierSeed, "bonsai collider witness tierSeed", { minimum: 0, maximum: UINT32_MAX });
  assert(Array.isArray(bonsaiWitness.fullTierSeedCorpus) && bonsaiWitness.fullTierSeedCorpus.length > 0, "bonsai collider witness seed corpus must be nonempty");
  bonsaiWitness.fullTierSeedCorpus.forEach((seed, index) => requireInteger(seed, `bonsai collider witness seed[${index}]`, { minimum: 0, maximum: UINT32_MAX }));
  assert.equal(new Set(bonsaiWitness.fullTierSeedCorpus).size, bonsaiWitness.fullTierSeedCorpus.length, "bonsai collider witness seed corpus must be unique");
  const bonsaiCeilings = physics.authoredColliderCeilingsMeters["potted-bonsai"];
  exactKeys(bonsaiWitness.valuesMeters, Object.keys(bonsaiCeilings), "potted-bonsai directed collider witness values");
  for (const [colliderId, witness] of Object.entries(bonsaiWitness.valuesMeters)) {
    requireFiniteNumber(witness, `potted-bonsai/${colliderId} directed lower-bound witness`, { minimum: Number.EPSILON });
    assert(witness <= bonsaiCeilings[colliderId], `potted-bonsai/${colliderId} witness exceeds authored ceiling`);
  }
  requireText(bonsaiWitness.samplingStatement, "bonsai collider witness samplingStatement");
  assert.match(bonsaiWitness.samplingStatement, /directed sampled lower-bound.*not bidirectional/i, "bonsai witness must deny a bidirectional proof");
  requireAcceptanceStatus(physics.status, "corpus.physicsBoundary.status");

  const identity = corpus.identityContinuity;
  exactKeys(identity, ["semanticIdsStableAcrossVisualTiers", "continuityTokenRequiredForTierRebuild", "changedSeedOrSourceRequiresNewGeneration", "solverStateContinuityClaim", "status"], "corpus.identityContinuity");
  for (const field of ["semanticIdsStableAcrossVisualTiers", "continuityTokenRequiredForTierRebuild", "changedSeedOrSourceRequiresNewGeneration"]) requireBoolean(identity[field], `corpus.identityContinuity.${field}`);
  requireText(identity.solverStateContinuityClaim, "corpus.identityContinuity.solverStateContinuityClaim");
  requireAcceptanceStatus(identity.status, "corpus.identityContinuity.status");

  const reference = corpus.referencePolicy;
  exactKeys(reference, ["sourceKind", "referenceImageAvailable", "referenceImageLicense", "referenceImageHash", "referenceSimilarityClaim", "authoredVisualAcceptanceStatus"], "corpus.referencePolicy");
  requireText(reference.sourceKind, "corpus.referencePolicy.sourceKind");
  requireBoolean(reference.referenceImageAvailable, "corpus.referencePolicy.referenceImageAvailable");
  assert(reference.referenceImageLicense === null || typeof reference.referenceImageLicense === "string", "reference image license must be string or null");
  assert(reference.referenceImageHash === null || typeof reference.referenceImageHash === "string", "reference image hash must be string or null");
  if (reference.referenceImageLicense !== null) requireText(reference.referenceImageLicense, "corpus.referencePolicy.referenceImageLicense");
  if (reference.referenceImageHash !== null) assert.match(reference.referenceImageHash, /^sha256:[a-f0-9]{64}$/, "reference image hash must be sha256-prefixed");
  requireText(reference.referenceSimilarityClaim, "corpus.referencePolicy.referenceSimilarityClaim");
  requireAcceptanceStatus(reference.authoredVisualAcceptanceStatus, "corpus.referencePolicy.authoredVisualAcceptanceStatus");

  const visual = corpus.visualAcceptance;
  exactKeys(visual, ["status", "acceptedScenarios", "reason"], "corpus.visualAcceptance");
  requireAcceptanceStatus(visual.status, "corpus.visualAcceptance.status");
  requireStringArray(visual.acceptedScenarios, "corpus.visualAcceptance.acceptedScenarios", { unique: true });
  requireText(visual.reason, "corpus.visualAcceptance.reason");

  exactKeys(corpus.commands, ["specs", "targets", "unit", "generateRoutes", "routes"], "corpus.commands");
  for (const [id, command] of Object.entries(corpus.commands)) {
    requireText(command, `corpus.commands.${id}`);
    assert.equal(command, EXPECTED_DEEP_COMMANDS[id], `corpus.commands.${id} drifted from the package script entry point`);
  }
}

function acceptanceStatusEntries(manifest, corpus) {
  return [
    ["manifest.status", manifest.status],
    ...manifest.scenarios.map((entry) => [`manifest.scenarios.${entry.id}.acceptanceStatus`, entry.acceptanceStatus]),
    ...manifest.mechanisms.map((entry) => [`manifest.mechanisms.${entry.id}.acceptanceStatus`, entry.acceptanceStatus]),
    ...manifest.tiers.map((entry) => [`manifest.tiers.${entry.id}.acceptanceStatus`, entry.acceptanceStatus]),
    ...manifest.capabilityRequirements.map((entry) => [`manifest.capabilityRequirements.${entry.id}.status`, entry.status]),
    ...manifest.runtimeProof.map((entry) => [`manifest.runtimeProof.${entry.id}.status`, entry.status]),
    ["corpus.status", corpus.status],
    ...corpus.scenarios.map((entry) => [`corpus.scenarios.${entry.id}.status`, entry.status]),
    ...corpus.mechanisms.map((entry) => [`corpus.mechanisms.${entry.id}.status`, entry.status]),
    ...corpus.tiers.map((entry) => [`corpus.tiers.${entry.id}.status`, entry.status]),
    ...corpus.cameras.map((entry) => [`corpus.cameras.${entry.id}.status`, entry.status]),
    ["corpus.corpusDiversityContract.status", corpus.corpusDiversityContract.status],
    ["corpus.physicalRouteContract.status", corpus.physicalRouteContract.status],
    ["corpus.physicsBoundary.status", corpus.physicsBoundary.status],
    ["corpus.identityContinuity.status", corpus.identityContinuity.status],
    ["corpus.referencePolicy.authoredVisualAcceptanceStatus", corpus.referencePolicy.authoredVisualAcceptanceStatus],
    ["corpus.visualAcceptance.status", corpus.visualAcceptance.status],
  ];
}

function acceptanceVerdictFromArtifact(artifactValidation, corpus = null) {
  requireObject(artifactValidation, "artifact validation result");
  if (corpus?.acceptancePromotion?.evidenceReviewState !== "candidate") return "INSUFFICIENT_EVIDENCE";
  if (artifactValidation.structuralVerdict === "FAIL") return "FAIL";
  assert.equal(artifactValidation.structuralVerdict, "PASS", "artifact structural verdict must be PASS or FAIL");
  if (
    artifactValidation.claimVerdict === "PASS"
    && corpus?.authoredPerformanceTargets?.evidenceBindingStatus !== "ready"
  ) return "INSUFFICIENT_EVIDENCE";
  return artifactValidation.claimVerdict;
}

function validateAcceptancePromotionState(manifest, corpus, claimVerdict) {
  const promotion = corpus.acceptancePromotion;
  const promoted = claimVerdict === promotion.requiredClaimVerdict;
  const failed = claimVerdict === "FAIL";
  assert(promoted || failed || claimVerdict === "INSUFFICIENT_EVIDENCE", `unknown artifact claimVerdict ${claimVerdict}`);
  const expectedStatus = promoted
    ? promotion.promotedStatus
    : failed
      ? promotion.failedStatus
      : promotion.unpromotedStatus;
  for (const [label, status] of acceptanceStatusEntries(manifest, corpus)) {
    assert.equal(status, expectedStatus, `${label} must be ${expectedStatus} while artifact claimVerdict is ${claimVerdict}`);
  }
  assert.equal(
    corpus.renderArchitecture.claimStatus,
    promoted
      ? promotion.promotedRenderClaimStatus
      : failed
        ? promotion.failedRenderClaimStatus
        : promotion.unpromotedRenderClaimStatus,
    `render architecture claim status must track artifact claimVerdict ${claimVerdict}`,
  );
  exact(
    corpus.visualAcceptance.acceptedScenarios,
    promoted ? EXPECTED_TARGET_IDS : [],
    "visual acceptance scenario closure",
  );
  if (promoted) assert.match(corpus.visualAcceptance.reason, /accepted|passed/i, "promoted visual acceptance needs an acceptance reason");
  else if (failed) assert.match(corpus.visualAcceptance.reason, /failed|invalid|malformed|blocked/i, "failed visual acceptance needs a failure reason");
  else assert.match(corpus.visualAcceptance.reason, /No .*accepted|awaiting|missing|insufficient/i, "unpromoted visual acceptance needs an evidence blocker");
  return promoted;
}

function makeSyntheticPromotedAcceptanceFixture(manifest, corpus) {
  const promotedManifest = structuredClone(manifest);
  const promotedCorpus = structuredClone(corpus);
  promotedManifest.status = promotedCorpus.acceptancePromotion.promotedStatus;
  for (const field of ["scenarios", "mechanisms", "tiers"]) {
    for (const entry of promotedManifest[field]) entry.acceptanceStatus = promotedCorpus.acceptancePromotion.promotedStatus;
  }
  for (const field of ["capabilityRequirements", "runtimeProof"]) {
    for (const entry of promotedManifest[field]) entry.status = promotedCorpus.acceptancePromotion.promotedStatus;
  }
  promotedCorpus.status = promotedCorpus.acceptancePromotion.promotedStatus;
  for (const field of ["scenarios", "mechanisms", "tiers", "cameras"]) {
    for (const entry of promotedCorpus[field]) entry.status = promotedCorpus.acceptancePromotion.promotedStatus;
  }
  for (const block of ["corpusDiversityContract", "physicalRouteContract", "physicsBoundary", "identityContinuity"]) {
    promotedCorpus[block].status = promotedCorpus.acceptancePromotion.promotedStatus;
  }
  promotedCorpus.referencePolicy.authoredVisualAcceptanceStatus = promotedCorpus.acceptancePromotion.promotedStatus;
  promotedCorpus.visualAcceptance.status = promotedCorpus.acceptancePromotion.promotedStatus;
  promotedCorpus.visualAcceptance.acceptedScenarios = [...EXPECTED_TARGET_IDS];
  promotedCorpus.visualAcceptance.reason = "All derived artifact gates passed and every authored scenario is accepted.";
  promotedCorpus.renderArchitecture.claimStatus = promotedCorpus.acceptancePromotion.promotedRenderClaimStatus;
  return Object.freeze({ manifest: promotedManifest, corpus: promotedCorpus });
}

function validateReferenceManifest(reference, definition, directory) {
  assert.equal(reference.schemaVersion, 1, `${definition.id} reference schema version drifted`);
  assert.equal(reference.targetId, definition.id, `${definition.id} reference target ID drifted`);
  assert.equal(reference.targetName, definition.title, `${definition.id} reference target name drifted`);
  assert.equal(reference.sourceKind, "authored-procedural-brief", `${definition.id} must use authored brief provenance`);
  assert.equal(reference.sourceUrl, null, `${definition.id} must not invent an external source URL`);
  assert(reference.referenceImage && typeof reference.referenceImage === "object", `${definition.id} referenceImage is required`);
  assert.equal(reference.referenceImage.available, false, `${definition.id} must not claim a reference image exists`);
  for (const field of ["path", "sha256", "mediaType", "widthPixels", "heightPixels", "license"]) {
    assert.equal(reference.referenceImage[field], null, `${definition.id} referenceImage.${field} must be null`);
  }
  assert.equal(reference.referenceImage.provenanceStatus, "unavailable", `${definition.id} image provenance must be unavailable`);
  requireIncomplete(reference.visualAcceptance?.status, `${definition.id} reference visualAcceptance.status`);
  requireIncomplete(reference.evidence?.status, `${definition.id} reference evidence.status`);
  exact(reference.evidence.imageArtifacts, [], `${definition.id} imageArtifacts`);
  exact(reference.evidence.comparisonArtifacts, [], `${definition.id} comparisonArtifacts`);
  exact(reference.evidence.reviewRecords, [], `${definition.id} reviewRecords`);
  assert(Array.isArray(reference.allowedClaims) && reference.allowedClaims.length > 0, `${definition.id} allowedClaims are required`);
  assert(Array.isArray(reference.blockedClaims) && reference.blockedClaims.length > 0, `${definition.id} blockedClaims are required`);

  const files = readdirSync(directory).sort();
  assert.deepEqual(files, ["reference.manifest.json"], `${definition.id} reference directory must not contain invented image evidence`);
  rejectAcceptedStatus(reference, `${definition.id}.reference`);
}

function validateAssessment(assessment, definition) {
  assert.equal(assessment.targetId, definition.id, `${definition.id} assessment target ID drifted`);
  assert.equal(assessment.targetName, definition.title, `${definition.id} assessment target name drifted`);
  assert.equal(assessment.sourceImage, null, `${definition.id} assessment must not name a source image`);
  assert.equal(assessment.referenceSourceKind, "authored-procedural-brief", `${definition.id} assessment provenance drifted`);
  assert.deepEqual(
    assessment.preSpecAssessment?.unknownsToResolveBeforeImplementation,
    [],
    `${definition.id} implementation-blocking unknowns must be resolved or explicitly move to evidence risks`,
  );
  assert(Array.isArray(assessment.qualityContract?.antiShallowSpecRules), `${definition.id} assessment needs anti-shallow rules`);
  assert(
    assessment.qualityContract.antiShallowSpecRules.some((rule) => /solver|canonical|physics/i.test(rule)),
    `${definition.id} assessment must block unsupported physics claims`,
  );
  assert(
    assessment.qualityContract.antiShallowSpecRules.some((rule) => /visual|evidence|acceptance/i.test(rule)),
    `${definition.id} assessment must block unsupported visual acceptance`,
  );
  rejectAcceptedStatus(assessment, `${definition.id}.assessment`);
}

function contractArray(contract, field, fallback = null) {
  const value = contract[field] ?? (fallback ? contract[fallback] : undefined);
  assert(Array.isArray(value), `factory contract ${contract.id}.${field} must be an array`);
  return value;
}

function validateSpec(spec, definition, { acceptancePromoted = false, artifactDigests = null } = {}) {
  const { contract } = definition;
  assert.equal(spec.targetId, definition.id, `${definition.id} spec target ID drifted`);
  assert.equal(spec.targetName, definition.title, `${definition.id} spec target name drifted`);
  assert.equal(spec.sourceImage, null, `${definition.id} spec must not name a source image`);
  assert.equal(spec.referenceSourceKind, "authored-procedural-brief", `${definition.id} spec provenance drifted`);
  if (typeof contract.sourceRevision === "string") {
    assert.equal(spec.runtimeContract?.sourceRevision, contract.sourceRevision, `${definition.id} source revision drifted`);
  }
  exact(spec.runtimeContract?.modes, SCULPT_MODES, `${definition.id} spec modes`);
  exact(spec.runtimeContract?.tiers, SCULPT_TIERS, `${definition.id} spec tiers`);
  exact(spec.runtimeContract?.cameras, CORPUS_CAMERAS, `${definition.id} spec cameras`);
  exact(
    spec.runtimeContract?.protectedComponentIds,
    contractArray(contract, "protectedComponentIds", "semanticNodeIds"),
    `${definition.id} protected component IDs`,
  );
  exact(
    spec.runtimeContract?.protectedNodeIds,
    contractArray(contract, "protectedNodeIds", "protectedComponentIds"),
    `${definition.id} protected node IDs`,
  );
  exact(spec.runtimeContract?.protectedSocketIds, contractArray(contract, "protectedSocketIds", "socketIds"), `${definition.id} protected socket IDs`);
  exact(spec.runtimeContract?.protectedColliderIds, contractArray(contract, "protectedColliderIds", "colliderIds"), `${definition.id} protected collider IDs`);
  exact(
    spec.runtimeContract?.protectedDestructionGroupIds,
    contractArray(contract, "protectedDestructionGroupIds", "destructionGroupIds"),
    `${definition.id} protected destruction-group IDs`,
  );
  if (Array.isArray(contract.protectedConstraintIds)) {
    exact(spec.runtimeContract?.protectedConstraintIds, contract.protectedConstraintIds, `${definition.id} protected constraint IDs`);
  }

  assert.equal(spec.physicsHandoff?.recordType, "ColliderConstructionInput", `${definition.id} physics record type drifted`);
  assert.equal(spec.physicsHandoff?.authority, "authoring-input-only", `${definition.id} physics authority drifted`);
  assert.equal(spec.physicsHandoff?.solverAuthority, false, `${definition.id} must not claim solver authority`);
  assert.equal(spec.physicsHandoff?.solverHandoffStatus, "blocked", `${definition.id} solver handoff must remain blocked`);
  assert.match(spec.physicsHandoff?.massPropertiesStatus ?? "", /^blocked/, `${definition.id} mass-property evidence must remain blocked`);
  assert.equal(spec.physicsHandoff?.visualLodIndependent, true, `${definition.id} visual LOD must not mutate physics authoring identity`);
  assert.equal(spec.motionContract?.enabledMode, "action-ready", `${definition.id} motion must be exposed in action-ready mode`);
  assert.equal(spec.motionContract?.exactReset, true, `${definition.id} action preview must define exact reset`);
  assert.equal(spec.motionContract?.solverAuthority, false, `${definition.id} motion preview must not claim solver authority`);
  if (typeof contract.motion?.kind === "string") {
    assert.equal(spec.motionContract.kind, contract.motion.kind, `${definition.id} motion kind drifted`);
  }
  if (Array.isArray(contract.motion?.channels)) {
    exact(spec.motionContract.channels, contract.motion.channels, `${definition.id} motion channels`);
    assert.equal(spec.motionContract.resetContract, contract.motion.resetContract, `${definition.id} motion reset contract drifted`);
  }
  if (contract.topology) {
    assert.equal(spec.topologyContract?.writer, contract.topology.latheWriter, `${definition.id} topology writer drifted`);
    assert.equal(spec.topologyContract?.uvSeam, contract.topology.uvSeam, `${definition.id} topology seam policy drifted`);
    assert.equal(spec.topologyContract?.degenerateTrianglesAllowed, contract.topology.degenerateTrianglesAllowed, `${definition.id} topology degeneracy policy drifted`);
  }
  if (contract.lodPolicy) {
    assert.equal(spec.visualLodContract?.policy, contract.lodPolicy.tessellationOnly ? "tessellation-only" : "representation-changing", `${definition.id} LOD policy drifted`);
    assert.equal(spec.visualLodContract?.drawCountPreserved, !contract.lodPolicy.drawCountReduction, `${definition.id} draw-count LOD claim drifted`);
  }
  if (contract.materialPolicy) {
    assert.equal(spec.materialImplementationContract?.objectSpaceProceduralShader, contract.materialPolicy.objectSpaceProceduralVariation, `${definition.id} material variation claim drifted`);
    assert.equal(spec.materialImplementationContract?.textureSamples, contract.materialPolicy.textureSamples, `${definition.id} material texture-sample claim drifted`);
    assert.equal(spec.materialImplementationContract?.structuralBands, contract.materialPolicy.structuralBands, `${definition.id} material band-count claim drifted`);
    assert.equal(spec.materialImplementationContract?.bandLimit, contract.materialPolicy.bandLimit, `${definition.id} material band-limit claim drifted`);
  }
  if (contract.continuityPolicy) {
    assert.deepEqual(
      {
        signatureRevision: spec.continuityContract?.signatureRevision,
        includedInputs: spec.continuityContract?.includedInputs,
        excludedVisualInputs: spec.continuityContract?.excludedVisualInputs,
        rule: spec.continuityContract?.rule,
      },
      contract.continuityPolicy,
      `${definition.id} continuity policy drifted`,
    );
    assert.match(spec.continuityContract?.solverStateContinuityClaim ?? "", /^blocked/, `${definition.id} solver continuity claim must remain blocked`);
  }
  if (contract.physics?.colliderErrorLowerBoundsMeters) {
    assert.deepEqual(
      spec.physicsHandoff?.colliderEvidenceLowerBoundsMeters,
      contract.physics.colliderErrorLowerBoundsMeters,
      `${definition.id} collider evidence lower bounds drifted`,
    );
  }
  if (contract.boundsEnvelopeMeters) {
    assert.deepEqual(spec.boundsContract?.dimensionsMeters, Array.isArray(contract.dimensionsMeters)
      ? contract.dimensionsMeters
      : [contract.dimensionsMeters.width, contract.dimensionsMeters.height, contract.dimensionsMeters.depth], `${definition.id} dimensions drifted`);
    assert.deepEqual(spec.boundsContract?.envelopeMinMeters, contract.boundsEnvelopeMeters.min, `${definition.id} minimum bounds drifted`);
    assert.deepEqual(spec.boundsContract?.envelopeMaxMeters, contract.boundsEnvelopeMeters.max, `${definition.id} maximum bounds drifted`);
    assert.deepEqual(spec.boundsContract?.sampledUnionMinMeters, contract.boundsEnvelopeMeters.measuredSampleUnion.min, `${definition.id} sampled minimum bounds drifted`);
    assert.deepEqual(spec.boundsContract?.sampledUnionMaxMeters, contract.boundsEnvelopeMeters.measuredSampleUnion.max, `${definition.id} sampled maximum bounds drifted`);
  }
  if (contract.shadeTopology) {
    assert.equal(spec.shadeTopologyContract?.crown, contract.shadeTopology.crown, `${definition.id} shade crown claim drifted`);
    assert.equal(spec.shadeTopologyContract?.lowerApertureRadiusMeters, contract.shadeTopology.lowerApertureRadiusMeters, `${definition.id} shade aperture drifted`);
    assert.equal(spec.shadeTopologyContract?.exteriorCrownMeshId, contract.shadeTopology.exteriorCrownMeshId, `${definition.id} exterior crown identity drifted`);
    assert.equal(spec.shadeTopologyContract?.interiorCrownMeshId, contract.shadeTopology.interiorCrownMeshId, `${definition.id} interior crown identity drifted`);
    assert.equal(spec.shadeTopologyContract?.interiorMaterialSide, contract.shadeTopology.interiorMaterialSide, `${definition.id} interior crown side drifted`);
    assert.equal(spec.shadeTopologyContract?.undersideVisibleThroughLowerAperture, contract.shadeTopology.undersideVisibleThroughLowerAperture, `${definition.id} underside visibility contract drifted`);
  }
  if (contract.materialClaims) {
    assert.equal(spec.materialImplementationContract?.coating, contract.materialClaims.coating, `${definition.id} coating claim drifted`);
    assert.equal(spec.materialImplementationContract?.bulb, contract.materialClaims.bulb, `${definition.id} bulb claim drifted`);
  }
  if (contract.colliderErrorContracts) {
    assert.equal(spec.physicsHandoff.colliderMaxSurfaceDeviationMeters["base-cylinder"], contract.colliderErrorContracts["base-cylinder"].declaredMeters);
    assert.equal(spec.physicsHandoff.colliderMaxSurfaceDeviationMeters["bulb-trigger"], contract.colliderErrorContracts["bulb-trigger"].visualSurfaceDeviationMeters);
    for (const id of ["lower-arm-left-capsule", "lower-arm-right-capsule", "upper-arm-left-capsule", "upper-arm-right-capsule"]) {
      assert.equal(spec.physicsHandoff.colliderMaxSurfaceDeviationMeters[id], contract.colliderErrorContracts["arm-capsules"].declaredMeters, `${definition.id}/${id} collider ceiling drifted`);
    }
    if (contract.colliderErrorContracts["shade-neck-cylinder"]) {
      const neck = contract.colliderErrorContracts["shade-neck-cylinder"];
      const authoredNeck = spec.physicsHandoff.shadeNeckProxy;
      assert(authoredNeck, `${definition.id} shade-neck proxy contract is required`);
      assert.equal(authoredNeck.colliderId, "shade-neck-cylinder", `${definition.id} shade-neck collider ID drifted`);
      assert.equal(authoredNeck.meshId, neck.meshId, `${definition.id} shade-neck mesh ID drifted`);
      assert.equal(authoredNeck.shapeKind, neck.shapeKind, `${definition.id} shade-neck shape drifted`);
      assert.deepEqual(authoredNeck.startMeters, neck.startMeters, `${definition.id} shade-neck start drifted`);
      assert.deepEqual(authoredNeck.endMeters, neck.endMeters, `${definition.id} shade-neck end drifted`);
      assert.equal(authoredNeck.radiusMeters, neck.radiusMeters, `${definition.id} shade-neck radius drifted`);
      assert.equal(authoredNeck.includesVisualAndProxyCaps, neck.includesVisualAndProxyCaps, `${definition.id} shade-neck cap policy drifted`);
      assert.equal(authoredNeck.minimumTierSampledLowerBoundMeters, neck.minimumTierSampledLowerBoundMeters, `${definition.id} shade-neck sampled lower bound drifted`);
      assert.equal(authoredNeck.declaredBidirectionalMeters, neck.declaredBidirectionalMeters, `${definition.id} shade-neck declared bound drifted`);
      assert.equal(authoredNeck.collisionRole, neck.collisionRole, `${definition.id} shade-neck collision role drifted`);
      assert.equal(spec.physicsHandoff.colliderMaxSurfaceDeviationMeters[authoredNeck.colliderId], neck.declaredBidirectionalMeters, `${definition.id} shade-neck collider ceiling drifted`);
    }
    if (contract.colliderErrorContracts["shade-shell-ribs"]) {
      const ribs = contract.colliderErrorContracts["shade-shell-ribs"];
      exact(ribs.colliderIds, contract.protectedColliderIds.filter((id) => id.startsWith("shade-shell-rib-")), `${definition.id} shade-rib collider IDs`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.ribCount, ribs.ribCount, `${definition.id} shade-rib count drifted`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.includesSolidNeck, false, `${definition.id} shade ribs must exclude the solid neck`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.ribRadiusMeters, ribs.ribRadiusMeters, `${definition.id} shade-rib radius drifted`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.sampledVisualToProxyLowerBoundMeters, ribs.sampledVisualToProxyLowerBoundMeters, `${definition.id} shade-rib sampled bound drifted`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.declaredBidirectionalMeters, ribs.declaredBidirectionalMeters, `${definition.id} shade-rib declared bound drifted`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.samplingConvergenceAllowanceMeters, ribs.samplingConvergenceAllowanceMeters, `${definition.id} shade-rib convergence allowance drifted`);
      assert.equal(spec.physicsHandoff.shadeBoundaryProxy?.lowerApertureClearRadiusMeters, ribs.lowerApertureClearRadiusMeters, `${definition.id} shade clear aperture drifted`);
      for (const id of ribs.colliderIds) {
        assert.equal(spec.physicsHandoff.colliderMaxSurfaceDeviationMeters[id], ribs.declaredBidirectionalMeters, `${definition.id}/${id} shade-rib collider ceiling drifted`);
      }
    }
  }
  if (contract.seedDomain) {
    assert.equal(spec.seedContract?.kind, contract.seedDomain.kind, `${definition.id} seed kind drifted`);
    assert.equal(spec.seedContract?.minimum, contract.seedDomain.min, `${definition.id} seed minimum drifted`);
    assert.equal(spec.seedContract?.maximum, contract.seedDomain.max, `${definition.id} seed maximum drifted`);
  }
  if (contract.seedPolicy) {
    assert.equal(spec.seedContract?.domain, contract.seedPolicy.domain, `${definition.id} seed domain drifted`);
    assert.equal(spec.seedContract?.minimum, contract.seedPolicy.minimum, `${definition.id} seed minimum drifted`);
    assert.equal(spec.seedContract?.maximum, contract.seedPolicy.maximum, `${definition.id} seed maximum drifted`);
    assert.equal(spec.seedContract?.outsideDomain, contract.seedPolicy.outsideDomain, `${definition.id} seed rejection policy drifted`);
    assert.equal(spec.seedContract?.normalization, contract.seedPolicy.normalization, `${definition.id} seed normalization claim drifted`);
  }
  if (contract.identityContinuity) {
    assert.deepEqual(spec.seedContract?.identityContinuity, contract.identityContinuity, `${definition.id} identity continuity contract drifted`);
  }
  if (contract.continuity) {
    assert.deepEqual(
      {
        signatureSchema: spec.continuityContract?.signatureSchema,
        identityInputs: spec.continuityContract?.identityInputs,
        excludedVisualInputs: spec.continuityContract?.excludedVisualInputs,
        policy: spec.continuityContract?.policy,
      },
      contract.continuity,
      `${definition.id} continuity contract drifted`,
    );
    assert.match(spec.continuityContract?.solverStateContinuityClaim ?? "", /^blocked/, `${definition.id} solver continuity claim must remain blocked`);
  }
  if (contract.proceduralScope) {
    assert.equal(spec.proceduralScope?.implementation, contract.proceduralScope.implementation, `${definition.id} procedural scope drifted`);
    assert.deepEqual(spec.proceduralScope?.excludedClaims, contract.proceduralScope.excludedClaims, `${definition.id} excluded procedural claims drifted`);
  }

  assert(Array.isArray(spec.viewEvidence) && spec.viewEvidence.length > 0, `${definition.id} authored brief traceability is required`);
  for (const [index, evidence] of spec.viewEvidence.entries()) {
    assert.equal(evidence.sourceKind, "authored-procedural-brief", `${definition.id} viewEvidence[${index}] source kind drifted`);
    assert.equal(evidence.evidenceStatus, "authoring-intent-only", `${definition.id} viewEvidence[${index}] must not claim visual proof`);
    assert.equal(evidence.imageRegion ?? null, null, `${definition.id} viewEvidence[${index}] must not invent image regions`);
  }
  assert(Array.isArray(spec.visualEvidence), `${definition.id} visualEvidence must be an array`);
  assert(Array.isArray(spec.reviewHistory), `${definition.id} reviewHistory must be an array`);
  const passIds = spec.buildPasses.map(({ id }) => id);
  if (acceptancePromoted) {
    assert(artifactDigests instanceof Map && artifactDigests.size > 0, `${definition.id} accepted spec needs validated artifact digests`);
    assert(spec.visualEvidence.length > 0, `${definition.id} accepted spec needs visual evidence`);
    assert(spec.reviewHistory.length > 0, `${definition.id} accepted spec needs review history`);
    for (const passId of passIds) {
      const matchingReviews = spec.reviewHistory.filter((review) => review?.passId === passId && review?.action === "continue");
      assert.equal(matchingReviews.length, 1, `${definition.id}/${passId} needs exactly one passing continue review`);
      if (!VISUAL_SCULPT_PASS_IDS.has(passId)) continue;
      const review = matchingReviews[0];
      assert(Number.isFinite(review.aiVisionScore), `${definition.id}/${passId} needs an AI-vision score`);
      assert(Number.isFinite(review.visualAcceptanceThreshold), `${definition.id}/${passId} needs a visual threshold`);
      assert(review.aiVisionScore >= review.visualAcceptanceThreshold, `${definition.id}/${passId} visual review failed its threshold`);
      const visual = review.visualEvidence;
      requireObject(visual, `${definition.id}/${passId}.visualEvidence`);
      const artifactPath = requireRepoPath(visual.renderScreenshot, `${definition.id}/${passId}.renderScreenshot`);
      assert(artifactDigests.has(artifactPath), `${definition.id}/${passId}.renderScreenshot is not in the accepted digest-bound capture set`);
      assert.equal(visual.renderScreenshotSha256, artifactDigests.get(artifactPath), `${definition.id}/${passId}.renderScreenshotSha256 drifted from accepted capture bytes`);
      assert.equal(visual.comparisonImage ?? "", "", `${definition.id}/${passId} must not invent a reference comparison image for an authored brief`);
      const historyRows = spec.visualEvidence.filter((entry) => entry?.passId === passId);
      assert.equal(historyRows.length, 1, `${definition.id}/${passId} needs exactly one visualEvidence history row`);
      assert.equal(historyRows[0].renderScreenshot, visual.renderScreenshot, `${definition.id}/${passId} render history path drifted`);
      assert.equal(historyRows[0].renderScreenshotSha256, visual.renderScreenshotSha256, `${definition.id}/${passId} render history digest drifted`);
      assert.equal(historyRows[0].comparisonImage ?? "", "", `${definition.id}/${passId} visual history must not invent a comparison image`);
    }
    exact(spec.sculptPipeline?.completedPasses, passIds, `${definition.id} accepted completed sculpt passes`);
    assert.equal(spec.sculptPipeline?.currentPass, "complete", `${definition.id} accepted sculpt pipeline must be complete`);
    assert.equal(spec.sculptPipeline?.lastCompletedPass, passIds.at(-1), `${definition.id} accepted last completed pass drifted`);
    exact(spec.sculptPipeline?.nextRequiredEvidence, [], `${definition.id} accepted next required evidence`);
    assert.doesNotMatch(spec.sculptPipeline?.blockedReason ?? "", /awaiting|pending/i, `${definition.id} accepted pipeline must not retain an evidence blocker`);
  } else {
    exact(spec.visualEvidence, [], `${definition.id} unpromoted visualEvidence`);
    exact(spec.reviewHistory, [], `${definition.id} unpromoted reviewHistory`);
    exact(spec.sculptPipeline?.completedPasses, [], `${definition.id} unpromoted completed sculpt passes`);
    assert.equal(spec.sculptPipeline?.currentPass, "blockout", `${definition.id} unpromoted initial sculpt pass must remain blockout`);
    assert.match(spec.sculptPipeline?.blockedReason ?? "", /awaiting|pending/i, `${definition.id} unpromoted pipeline must state its evidence blocker`);
    rejectAcceptedStatus(spec, `${definition.id}.spec`);
  }
  assert(
    spec.proceduralStrategy.some((rule) => /one scene render/i.test(rule))
      && spec.proceduralStrategy.some((rule) => /no post-processing/i.test(rule)),
    `${definition.id} spec must preserve one-render/no-post architecture`,
  );
}

function validateRuntimeContract(definition, spec, corpusTiers) {
  const contract = definition.contract;
  assert.equal(contract.id, definition.id, `${definition.id} factory contract ID drifted`);
  assert.equal(contract.title, definition.title, `${definition.id} factory title drifted`);
  exact(contract.modes, SCULPT_MODES, `${definition.id} factory modes`);
  exact(contract.tierIds, SCULPT_TIERS, `${definition.id} factory tiers`);
  assert.equal(contract.physics?.solverAuthority, false, `${definition.id} factory must not claim solver authority`);

  for (const tier of SCULPT_TIERS) {
    const sourceEvidence = corpusTiers.find(({ id }) => id === tier)?.sourceWorkloadEvidence?.[definition.id];
    assert(sourceEvidence, `${definition.id}/${tier} source workload evidence is required`);
    const asset = definition.create({ tier, seed: sourceEvidence.seed });
    try {
      assert.equal(asset.runtime.subjectId, definition.id, `${definition.id}/${tier} runtime subject drifted`);
      assert.equal(asset.runtime.seed, sourceEvidence.seed, `${definition.id}/${tier} workload provenance seed drifted`);
      for (const id of contractArray(contract, "protectedComponentIds", "semanticNodeIds")) {
        assert(asset.runtime.nodes.has(id), `${definition.id}/${tier} missing protected component ${id}`);
      }
      if (spec.topologyContract?.bodyCavityOverlap) {
        const cavity = asset.runtime.nodes.get("body-cavity");
        const geometry = cavity?.geometry;
        const authored = spec.topologyContract.bodyCavityOverlap;
        assert(geometry, `${definition.id}/${tier} body cavity geometry is required`);
        assert.equal(geometry.userData.semanticWriter, authored.writer, `${definition.id}/${tier} cavity writer drifted`);
        assert.equal(geometry.userData.boundaryPolicy?.rim?.kind, authored.boundaryKind, `${definition.id}/${tier} cavity boundary kind drifted`);
        assert.equal(geometry.userData.boundaryPolicy?.rim?.id, authored.boundaryId, `${definition.id}/${tier} cavity boundary ID drifted`);
        assert.equal(geometry.userData.expectedGeometricBoundaryLoops, authored.expectedGeometricBoundaryLoops, `${definition.id}/${tier} cavity boundary-loop count drifted`);
        assert.equal(geometry.userData.expectedEulerCharacteristic, authored.expectedEulerCharacteristic, `${definition.id}/${tier} cavity Euler characteristic drifted`);
        assert.equal(geometry.userData.seamVertexPairs?.length > 0, authored.seamVertexPairWelded, `${definition.id}/${tier} cavity seam-weld declaration drifted`);
        assert.equal(cavity.position.y, authored.diskYMeters, `${definition.id}/${tier} cavity height drifted`);
        assert.equal(geometry.userData.overlapContract?.innerWallBottomYMeters, authored.innerWallBottomYMeters, `${definition.id}/${tier} cavity wall height drifted`);
        assert(
          Math.abs(geometry.userData.overlapContract.verticalOverlapMeters - authored.verticalOverlapMeters) <= 1e-12,
          `${definition.id}/${tier} cavity vertical overlap drifted`,
        );
        const measuredRadialOverlap = geometry.userData.overlapContract.diskRadiusMeters
          - geometry.userData.overlapContract.innerWallBottomRadiusMeters;
        assert(
          Math.abs(measuredRadialOverlap - geometry.userData.overlapContract.minimumRadialOverlapMeters) <= 1e-12,
          `${definition.id}/${tier} cavity radial overlap drifted`,
        );
      }
      if (Array.isArray(spec.materialImplementationContract?.executedResponseBundles)) {
        const [celadonBundle, brassBundle] = spec.materialImplementationContract.executedResponseBundles;
        for (const [nodeId, frequencyPerMeter] of [["body-shell", 7.5], ["neck-band", 8.5]]) {
          const metadata = asset.runtime.nodes.get(nodeId)?.material?.userData?.proceduralPbr;
          assert(metadata, `${definition.id}/${tier}/${nodeId} procedural material evidence is required`);
          assert.equal(metadata.responseBundle, celadonBundle.id, `${definition.id}/${tier}/${nodeId} response bundle drifted`);
          assert.equal(metadata.coordinateMode, "object-space-metres", `${definition.id}/${tier}/${nodeId} material coordinates drifted`);
          assert.equal(metadata.cause, "mx_noise_float-single-band", `${definition.id}/${tier}/${nodeId} material cause drifted`);
          assert.equal(metadata.frequencyPerMeter, frequencyPerMeter, `${definition.id}/${tier}/${nodeId} material frequency drifted`);
          assert.deepEqual(metadata.sharedSlots, celadonBundle.sharedSlots, `${definition.id}/${tier}/${nodeId} shared response slots drifted`);
          assert.equal(metadata.metalnessEndpoint, celadonBundle.metalnessEndpoint, `${definition.id}/${tier}/${nodeId} dielectric endpoint drifted`);
          assert.equal(metadata.textureSamples, 0, `${definition.id}/${tier}/${nodeId} texture-sample claim drifted`);
          assert.equal(metadata.normalOrDisplacement, false, `${definition.id}/${tier}/${nodeId} normal/displacement claim drifted`);
        }
        const brassMetadata = asset.runtime.nodes.get("lid-joint-pin")?.material?.userData?.proceduralPbr;
        assert(brassMetadata, `${definition.id}/${tier}/lid-joint-pin procedural material evidence is required`);
        assert.equal(brassMetadata.responseBundle, brassBundle.id, `${definition.id}/${tier} brass response bundle drifted`);
        assert.equal(brassMetadata.coordinateMode, "object-space-metres", `${definition.id}/${tier} brass material coordinates drifted`);
        assert.equal(brassMetadata.cause, "mx_noise_float-single-band", `${definition.id}/${tier} brass material cause drifted`);
        assert.equal(brassMetadata.frequencyPerMeter, brassBundle.frequenciesPerMeter[0], `${definition.id}/${tier} brass material frequency drifted`);
        assert.deepEqual(brassMetadata.sharedSlots, brassBundle.sharedSlots, `${definition.id}/${tier} brass shared response slots drifted`);
        assert.equal(brassMetadata.conductorMetalnessEndpoint, brassBundle.conductorMetalnessEndpoint, `${definition.id}/${tier} brass conductor endpoint drifted`);
        assert.equal(brassMetadata.patinaMetalnessEndpoint, brassBundle.patinaMetalnessEndpoint, `${definition.id}/${tier} brass patina endpoint drifted`);
        assert.equal(brassMetadata.textureSamples, 0, `${definition.id}/${tier} brass texture-sample claim drifted`);
      }
      for (const id of contractArray(contract, "protectedSocketIds", "socketIds")) {
        assert(asset.runtime.sockets.has(id), `${definition.id}/${tier} missing protected socket ${id}`);
      }
      for (const id of contractArray(contract, "protectedColliderIds", "colliderIds")) {
        const collider = asset.runtime.colliders.get(id);
        assert(collider, `${definition.id}/${tier} missing protected collider construction input ${id}`);
        assert.equal(collider.recordType, "ColliderConstructionInput", `${definition.id}/${tier}/${id} record type drifted`);
        assert.equal(collider.claimStatus, "authoring-input", `${definition.id}/${tier}/${id} claim status drifted`);
        assert.equal(collider.solverAuthority, false, `${definition.id}/${tier}/${id} must not own solve`);
        assert.equal(collider.solverHandoffStatus, "blocked", `${definition.id}/${tier}/${id} solver handoff must remain blocked`);
        assert.match(collider.massPropertiesStatus, /^blocked/, `${definition.id}/${tier}/${id} mass-property evidence must remain blocked`);
        assert.equal(collider.shape.units, "metre", `${definition.id}/${tier}/${id} collider units drifted`);
        assert.equal(collider.validity.visualLodIndependent, true, `${definition.id}/${tier}/${id} must be visual-LOD-independent`);
        assert.equal(
          collider.approximationError.maxSurfaceDeviationMeters,
          spec.physicsHandoff.colliderMaxSurfaceDeviationMeters[id],
          `${definition.id}/${tier}/${id} authored collider ceiling drifted`,
        );
      }
      if (spec.physicsHandoff?.shadeNeckProxy) {
        const authoredNeck = spec.physicsHandoff.shadeNeckProxy;
        const neckCollider = asset.runtime.colliders.get(authoredNeck.colliderId);
        const neckMesh = asset.runtime.meshes.get(authoredNeck.meshId);
        const neckIntent = asset.runtime.colliderIntents?.get(authoredNeck.colliderId);
        assert.equal(asset.runtime.colliders.size, contract.protectedColliderIds.length, `${definition.id}/${tier} collider inventory must be exact`);
        assert(neckCollider && neckMesh && neckIntent, `${definition.id}/${tier} exact shade-neck collider evidence is required`);
        assert.equal(neckCollider.shape.kind, authoredNeck.shapeKind, `${definition.id}/${tier} shade-neck runtime shape drifted`);
        assert.deepEqual(neckCollider.shape.startMeters, authoredNeck.startMeters, `${definition.id}/${tier} shade-neck runtime start drifted`);
        assert.deepEqual(neckCollider.shape.endMeters, authoredNeck.endMeters, `${definition.id}/${tier} shade-neck runtime end drifted`);
        assert.equal(neckCollider.shape.radiusMeters, authoredNeck.radiusMeters, `${definition.id}/${tier} shade-neck runtime radius drifted`);
        assert.equal(neckCollider.collisionRole, authoredNeck.collisionRole, `${definition.id}/${tier} shade-neck runtime collision role drifted`);
        assert.equal(neckMesh.geometry.parameters.openEnded, false, `${definition.id}/${tier} shade-neck visual caps drifted`);
        assert.deepEqual(neckIntent.comparisonMeshScope, [authoredNeck.meshId], `${definition.id}/${tier} shade-neck comparison scope drifted`);
        assert.match(neckIntent.proxyCapPolicy, /both endpoint disks/, `${definition.id}/${tier} shade-neck proxy cap policy drifted`);
        assert.match(neckIntent.errorMetric, /bidirectional.*capped-cylinder/i, `${definition.id}/${tier} shade-neck error metric drifted`);
      }
      if (Array.isArray(contract.protectedConstraintIds)) {
        assert(asset.runtime.constraints instanceof Map, `${definition.id}/${tier} runtime constraints map is required`);
        for (const id of contract.protectedConstraintIds) {
          const constraint = asset.runtime.constraints.get(id);
          assert(constraint, `${definition.id}/${tier} missing protected constraint construction input ${id}`);
          assert.equal(constraint.recordType, "ConstraintConstructionInput", `${definition.id}/${tier}/${id} constraint type drifted`);
          assert.equal(constraint.claimStatus, "authoring-input", `${definition.id}/${tier}/${id} constraint claim drifted`);
          assert.equal(constraint.solverAuthority, false, `${definition.id}/${tier}/${id} constraint must not own solve`);
          assert.equal(constraint.canonicalConstraintStatus, "blocked", `${definition.id}/${tier}/${id} canonical constraint claim must remain blocked`);
          assert.equal(constraint.validity.visualLodIndependent, true, `${definition.id}/${tier}/${id} constraint must be visual-LOD-independent`);
        }
        assert(asset.runtime.motionPreviewBindings instanceof Map, `${definition.id}/${tier} motion preview map is required`);
        for (const bindingSpec of spec.motionContract.bindings) {
          const binding = asset.runtime.motionPreviewBindings.get(bindingSpec.constraintId);
          assert(binding, `${definition.id}/${tier} missing motion binding ${bindingSpec.constraintId}`);
          assert.equal(binding.nodeId, bindingSpec.nodeId);
          assert.equal(binding.channel, bindingSpec.channel);
          assert.deepEqual(binding.axisLocal, bindingSpec.axisLocal);
          assert.equal(binding.amplitudeRadians, bindingSpec.amplitudeRadians);
          assert.equal(binding.angularFrequencyRadPerS, bindingSpec.angularFrequencyRadPerS);
          assert.equal(binding.solverAuthority, false);
        }
        assert(asset.runtime.attachments instanceof Map, `${definition.id}/${tier} attachment map is required`);
        for (const attachmentSpec of spec.attachmentConstructionContract.attachments) {
          const attachment = asset.runtime.attachments.get(attachmentSpec.id);
          assert(attachment, `${definition.id}/${tier} missing attachment ${attachmentSpec.id}`);
          assert.equal(attachment.recordType, "SculptAttachmentInput");
          assert.equal(attachment.startSocketLocalId, attachmentSpec.startSocketId);
          assert.equal(attachment.endSocketLocalId, attachmentSpec.endSocketId);
          assert.equal(attachment.crossJoint, false);
          assert.equal(attachment.mechanicalLoadAuthority, false);
          assert.equal(attachment.solverAuthority, false);
        }
        const springContact = spec.attachmentConstructionContract.springSurfaceContactContract;
        if (springContact) {
          for (const contactCase of springContact.cases) {
            const spring = asset.runtime.meshes.get(contactCase.springId);
            const collar = asset.runtime.meshes.get(contactCase.collarId);
            const washer = asset.runtime.meshes.get(contactCase.washerId);
            assert(spring && collar && washer, `${definition.id}/${tier} incomplete spring-contact case ${contactCase.collarId}`);
            const endpointMeters = contactCase.endpointIndex === 0
              ? spring.userData.sourceDimensions.startMeters
              : spring.userData.sourceDimensions.endMeters;
            assert.equal(endpointMeters[2], springContact.springEndpointZMeters, `${definition.id}/${tier}/${contactCase.springId} endpoint Z drifted`);
            assert.equal(spring.userData.sourceDimensions.radiusMeters, spring.geometry.parameters.radius, `${definition.id}/${tier}/${contactCase.springId} wire-radius evidence drifted`);
            assert.equal(spring.geometry.parameters.radius, springContact.wireRadiiMeters[contactCase.springId], `${definition.id}/${tier}/${contactCase.springId} authored wire radius drifted`);
            const springAttachment = asset.runtime.attachments.get(springContact.attachmentIdsBySpring[contactCase.springId]);
            assert(springAttachment, `${definition.id}/${tier}/${contactCase.springId} spring attachment is required`);
            assert.equal(springAttachment.baseRadiusMeters, spring.geometry.parameters.radius, `${definition.id}/${tier}/${contactCase.springId} attachment radius drifted`);
            assert.equal(springAttachment.overlapMeters, springContact.attachmentOverlapMeters, `${definition.id}/${tier}/${contactCase.springId} attachment overlap drifted`);
            assert.equal(spring.userData.springRepresentation.receivingWasherMeshIds[contactCase.endpointIndex], contactCase.washerId, `${definition.id}/${tier}/${contactCase.springId} washer identity drifted`);
            assert.equal(spring.userData.springRepresentation.washerFrontFaceZMeters, springContact.washerFrontFaceZMeters, `${definition.id}/${tier}/${contactCase.springId} washer face drifted`);
            assert(
              Math.abs(spring.userData.springRepresentation.endpointCenterEmbedDepthMeters - springContact.endpointCenterEmbedDepthMeters) <= 1e-12,
              `${definition.id}/${tier}/${contactCase.springId} endpoint embed drifted`,
            );
            assert.equal(spring.userData.springRepresentation.endpointBoundaryPolicy, springContact.endpointBoundaryPolicy, `${definition.id}/${tier}/${contactCase.springId} endpoint boundary drifted`);
            assert.equal(washer.position.z, springContact.washerCenterZMeters, `${definition.id}/${tier}/${contactCase.washerId} washer center drifted`);
            assert.equal(washer.geometry.parameters.height / 2, springContact.washerHalfDepthMeters, `${definition.id}/${tier}/${contactCase.washerId} washer depth drifted`);
            assert.equal(collar.userData.attachmentRole, springContact.collarRole, `${definition.id}/${tier}/${contactCase.collarId} collar role drifted`);
            assert.equal(collar.geometry.parameters.radiusTop, springContact.collarRadiusMeters, `${definition.id}/${tier}/${contactCase.collarId} collar radius drifted`);
            assert.equal(collar.geometry.parameters.height, springContact.collarDepthMeters, `${definition.id}/${tier}/${contactCase.collarId} collar depth drifted`);
          }
        }
      }
      for (const id of contractArray(contract, "protectedDestructionGroupIds", "destructionGroupIds")) {
        assert(asset.runtime.destructionGroups.has(id), `${definition.id}/${tier} missing protected destruction group ${id}`);
      }
      if (spec.workloadContract?.[tier]) {
        const summary = summarizeSculptRuntime(asset.runtime);
        assert.equal(summary.renderItems, spec.workloadContract[tier].renderItems, `${definition.id}/${tier} render-item evidence drifted`);
        assert.equal(summary.storedVertices, spec.workloadContract[tier].storedVertices, `${definition.id}/${tier} stored-vertex evidence drifted`);
        assert.equal(summary.storedTriangles, spec.workloadContract[tier].triangles, `${definition.id}/${tier} triangle evidence drifted`);
        assert.equal(summary.renderItems, sourceEvidence.renderItems, `${definition.id}/${tier} manifest render-item provenance drifted`);
        assert.equal(summary.storedVertices, sourceEvidence.storedVertices, `${definition.id}/${tier} manifest stored-vertex provenance drifted`);
        assert.equal(summary.storedTriangles, sourceEvidence.triangles, `${definition.id}/${tier} manifest triangle provenance drifted`);
        const shadowCasters = [...asset.runtime.meshes.values()].filter((mesh) => mesh.castShadow).length;
        assert.equal(shadowCasters, sourceEvidence.shadowCasters, `${definition.id}/${tier} manifest shadow-caster provenance drifted`);
      }
    } finally {
      asset.dispose();
    }
  }
}

export function validateCorpusManifest() {
  const manifest = readJson(manifestPath, "corpus lab manifest");
  const corpus = readJson(corpusContractPath, "corpus deep contract");
  validateCorpusDeepContractShape(corpus);
  const artifactValidation = validateCorpusArtifacts({
    bundleDirectory: resolve(repositoryRoot, corpus.acceptancePromotion.evidenceBundle),
  });
  const effectiveArtifactVerdict = acceptanceVerdictFromArtifact(artifactValidation, corpus);
  const acceptancePromoted = validateAcceptancePromotionState(manifest, corpus, effectiveArtifactVerdict);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.id, "webgpu-object-sculptor-corpus");
  assert.equal(manifest.skill, "threejs-object-sculptor");
  assert.equal(manifest.kind, "canonical-lab");
  assert.equal(manifest.browserEntry, "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/index.html");
  assert.equal(manifest.evidenceBundle, corpus.acceptancePromotion.evidenceBundle, "canonical/deep evidence bundle path drifted");
  assert(manifest.canonicalSource.includes("threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/corpus.contract.json"), "canonical manifest must link the deep corpus contract");
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.id, "webgpu-object-sculptor-corpus-contract");
  assert.equal(corpus.manifestId, manifest.id);
  assert.equal(corpus.manifestPath, "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/lab.manifest.json");
  assert.equal(corpus.canonicalSchemaPath, "labs/schema/lab-manifest.schema.json");

  exact(ids(manifest.scenarios, "manifest scenarios"), EXPECTED_TARGET_IDS, "manifest scenarios");
  exact(ids(manifest.mechanisms, "manifest mechanisms"), SCULPT_MODES, "manifest mechanisms");
  exact(ids(manifest.tiers, "manifest tiers"), SCULPT_TIERS, "manifest tiers");
  exact(manifest.cameras, CORPUS_CAMERAS, "manifest cameras");
  exact(manifest.modes, SCULPT_MODES, "manifest modes");
  exact(ids(corpus.scenarios, "corpus scenarios"), EXPECTED_TARGET_IDS, "corpus scenarios");
  exact(ids(corpus.mechanisms, "corpus mechanisms"), SCULPT_MODES, "corpus mechanisms");
  exact(ids(corpus.tiers, "corpus tiers"), SCULPT_TIERS, "corpus tiers");
  exact(ids(corpus.cameras, "corpus cameras"), CORPUS_CAMERAS, "corpus cameras");
  assert.equal(corpus.physicalRouteContract?.routeCount, 15, "deep contract must register 15 physical routes");
  assert.equal(corpus.corpusDiversityContract?.minimumNonBoatTargets, 2);
  assert.equal(corpus.corpusDiversityContract?.preexistingBoatBaseline, "webgpu-tower-ship-sculptor");
  assert.equal(corpus.corpusDiversityContract?.boatBaselineCountsTowardMinimum, false);
  assert.equal(corpus.corpusDiversityContract?.actualNonBoatTargets, 3);
  assert.equal(corpus.corpusDiversityContract?.requiresOrganicTarget, true);
  assert.equal(corpus.corpusDiversityContract?.organicTarget, "potted-bonsai");
  assert.equal(corpus.corpusDiversityContract?.requiresDistinctConstructionFamilies, true);
  assert.equal(new Set(corpus.scenarios.map(({ category }) => category)).size, 3, "corpus scenarios must use distinct categories");
  assert(
    corpus.scenarios.find(({ id }) => id === "potted-bonsai")?.formLanguage?.includes("organic"),
    "corpus must retain one explicit organic target",
  );

  for (const [field, kind] of [["scenarios", "scenario"], ["mechanisms", "mechanism"]]) {
    for (const entry of manifest[field]) {
      const deepEntry = corpus[field].find(({ id }) => id === entry.id);
      assert(deepEntry, `deep contract missing ${kind}/${entry.id}`);
      assert.equal(entry.route, `${kind}/${entry.id}/`, `${kind}/${entry.id} canonical route drifted`);
      assert.equal(deepEntry.route, entry.route, `${kind}/${entry.id} canonical/deep route drifted`);
      if (kind === "scenario") {
        const { mechanism, ...deepStartup } = deepEntry.startup;
        assert.deepEqual(
          entry.startup,
          { ...deepStartup, mode: mechanism },
          `${kind}/${entry.id} canonical/deep startup drifted`,
        );
      } else {
        assert.deepEqual(entry.startup, { mode: deepEntry.startup.mechanism }, `${kind}/${entry.id} canonical/deep startup drifted`);
      }
    }
  }
  for (const tier of manifest.tiers) {
    const deepTier = corpus.tiers.find(({ id }) => id === tier.id);
    assert(deepTier, `deep contract missing tier/${tier.id}`);
    assert.equal(deepTier.route, `tier/${tier.id}/`, `tier/${tier.id} deep route drifted`);
    assert.equal(tier.resolutionPolicy?.dprCap, CORPUS_DPR_CAPS[tier.id], `${tier.id} manifest/controller DPR cap drifted`);
  }
  for (const camera of corpus.cameras) {
    assert.equal(camera.route, `camera/${camera.id}/`, `camera/${camera.id} deep route drifted`);
  }
  assert.equal(corpus.defaultStartup.scenario, "potted-bonsai");
  assert.equal(corpus.defaultStartup.mechanism, "action-ready");
  assert.equal(corpus.defaultStartup.tier, "budgeted");
  assert.equal(corpus.defaultStartup.camera, "design");
  assert.equal(corpus.defaultStartup.seed, 1);
  assert.deepEqual(corpus.physicalRouteContract.dimensions, { scenario: 3, mechanism: 5, tier: 3, camera: 4 });
  exact(Object.keys(corpus.commands), ["specs", "targets", "unit", "generateRoutes", "routes"], "deep command names");

  assert.equal(corpus.renderArchitecture?.renderer, "WebGPURenderer");
  assert.equal(corpus.renderArchitecture?.requiredBackend, "native WebGPU");
  assert.equal(corpus.renderArchitecture?.fallback, "none");
  assert.equal(corpus.renderArchitecture?.sceneRendersPerFrame, 1);
  assert.equal(corpus.renderArchitecture?.postProcessingPasses, 0);
  assert.equal(corpus.renderArchitecture?.toneMappingOwners, 1);
  assert.equal(corpus.renderArchitecture?.outputTransformOwners, 1);
  assert.equal(corpus.physicsBoundary?.assetRecordType, "ColliderConstructionInput");
  assert.equal(corpus.physicsBoundary?.solverAuthority, false);
  assert.equal(corpus.physicsBoundary?.solverHandoffStatus, "blocked");
  assert.match(corpus.physicsBoundary?.massPropertiesStatus ?? "", /^blocked/);
  assert.equal(corpus.identityContinuity?.semanticIdsStableAcrossVisualTiers, true);
  assert.equal(corpus.identityContinuity?.continuityTokenRequiredForTierRebuild, true);
  assert.equal(corpus.identityContinuity?.changedSeedOrSourceRequiresNewGeneration, true);
  assert.match(corpus.identityContinuity?.solverStateContinuityClaim ?? "", /^blocked/);
  assert.equal(corpus.referencePolicy?.referenceImageAvailable, false);
  assert.equal(corpus.referencePolicy?.referenceImageLicense, null);
  assert.equal(corpus.referencePolicy?.referenceImageHash, null);
  assert.equal(corpus.referencePolicy?.referenceSimilarityClaim, "blocked");
  const requiredRuntimeProofIds = new Set(manifest.runtimeProof.filter(({ required }) => required).map(({ id }) => id));
  for (const id of ["renderer-init", "backend-is-webgpu", "mechanism-reachable", "aligned-readback"]) {
    assert(requiredRuntimeProofIds.has(id), `canonical acceptance promotion requires runtime proof ${id}`);
  }
  if (acceptancePromoted) assert.match(manifest.sourceHash ?? "", /^sha256:[a-f0-9]{64}$/, "accepted manifest needs a source hash");
  else assert.equal(manifest.sourceHash, null, "unpromoted manifest sourceHash must remain null until evidence generation");
  assert.equal(manifest.proxyStatus, null, "manifest proxyStatus must remain null until evidence generation");

  exact(SCULPT_TARGETS.map(({ id }) => id), EXPECTED_TARGET_IDS, "registered target catalog");
  const acceptedArtifactDigests = acceptancePromoted ? captureDigestMap(corpus) : null;
  for (const definition of SCULPT_TARGETS) {
    const scenario = corpus.scenarios.find(({ id }) => id === definition.id);
    assert(scenario, `deep scenario missing ${definition.id}`);
    assert.equal(scenario.spec, `targets/${definition.id}/object-sculpt-spec.json`, `${definition.id} spec path drifted`);
    assert.equal(scenario.referenceManifest, `targets/${definition.id}/reference/reference.manifest.json`, `${definition.id} reference path drifted`);
    assert.equal(scenario.factory, `targets/${definition.id}/${definition.id}-factory.js`, `${definition.id} factory path drifted`);
    const specPath = resolve(here, scenario.spec);
    const referencePath = resolve(here, scenario.referenceManifest);
    const factoryPath = resolve(here, scenario.factory);
    const assessmentPath = resolve(dirname(specPath), "pre-spec-assessment.json");
    assert(existsSync(specPath), `${definition.id} spec path is missing`);
    assert(existsSync(referencePath), `${definition.id} reference path is missing`);
    assert(existsSync(factoryPath), `${definition.id} factory path is missing`);
    validateReferenceManifest(readJson(referencePath, `${definition.id} reference manifest`), definition, dirname(referencePath));
    validateAssessment(readJson(assessmentPath, `${definition.id} pre-spec assessment`), definition);
    const spec = readJson(specPath, `${definition.id} object sculpt spec`);
    validateSpec(spec, definition, { acceptancePromoted, artifactDigests: acceptedArtifactDigests });
    const promotedSpecFixture = makeSyntheticPromotedSpecFixture(spec, definition, corpus.acceptancePromotion.evidenceBundle);
    validateSpec(promotedSpecFixture.spec, definition, {
      acceptancePromoted: true,
      artifactDigests: promotedSpecFixture.artifactDigests,
    });
    if (definition.id === EXPECTED_TARGET_IDS[0]) {
      const missingPassReview = structuredClone(promotedSpecFixture.spec);
      missingPassReview.reviewHistory = missingPassReview.reviewHistory.slice(0, -1);
      assert.throws(
        () => validateSpec(missingPassReview, definition, { acceptancePromoted: true, artifactDigests: promotedSpecFixture.artifactDigests }),
        /needs exactly one passing continue review/,
      );
      const forgedRenderDigest = structuredClone(promotedSpecFixture.spec);
      forgedRenderDigest.reviewHistory[0].visualEvidence.renderScreenshotSha256 = "b".repeat(64);
      assert.throws(
        () => validateSpec(forgedRenderDigest, definition, { acceptancePromoted: true, artifactDigests: promotedSpecFixture.artifactDigests }),
        /renderScreenshotSha256 drifted/,
      );
    }
    const legacyPerformanceTier = corpus.authoredPerformanceTargets.legacySpecBindingTier;
    const authoredPerformance = corpus.authoredPerformanceTargets.targetsByTier[legacyPerformanceTier][definition.id];
    assert.equal(authoredPerformance.fpsTarget, spec.performanceBudget?.fpsTarget, `${definition.id} Authored fpsTarget binding drifted`);
    assert.equal(authoredPerformance.maxDrawCalls, spec.performanceBudget?.maxDrawCalls, `${definition.id} Authored maxDrawCalls binding drifted`);
    assert.equal(
      authoredPerformance.fpsTarget,
      corpus.authoredPerformanceTargets.profilesByTier[legacyPerformanceTier].refreshHz,
      `${definition.id} Authored fpsTarget must name the target refresh rate`,
    );
    assert.equal(
      authoredPerformance.maxDrawCalls,
      corpus.tiers.find(({ id }) => id === legacyPerformanceTier).sourceWorkloadEvidence[definition.id].renderItems,
      `${definition.id} Authored maxDrawCalls must bind to the full-tier source render-item inventory`,
    );
    assert.deepEqual(
      corpus.physicsBoundary.authoredColliderCeilingsMeters[definition.id],
      spec.physicsHandoff.colliderMaxSurfaceDeviationMeters,
      `${definition.id} manifest collider ceilings drifted from the spec`,
    );
    for (const tier of corpus.tiers) {
      const evidence = tier.sourceWorkloadEvidence[definition.id];
      const expected = spec.workloadContract?.[tier.id];
      assert(expected, `${definition.id}/${tier.id} workload contract is required`);
      assert.equal(evidence.renderItems, expected.renderItems, `${definition.id}/${tier.id} manifest render items drifted`);
      assert.equal(evidence.storedVertices, expected.storedVertices, `${definition.id}/${tier.id} manifest stored vertices drifted`);
      assert.equal(evidence.triangles, expected.triangles, `${definition.id}/${tier.id} manifest triangles drifted`);
      assert.equal(
        corpus.authoredPerformanceTargets.targetsByTier[tier.id][definition.id].maxDrawCalls,
        evidence.renderItems,
        `${definition.id}/${tier.id} Authored maxDrawCalls must bind to source render-item inventory`,
      );
      assert.equal(evidence.seed, spec.workloadContract.seed, `${definition.id}/${tier.id} manifest workload seed drifted`);
      assert.equal(evidence.shadowCasters, expected.shadowCasters, `${definition.id}/${tier.id} manifest shadow-caster inventory drifted`);
    }
    validateRuntimeContract(definition, spec, corpus.tiers);
  }

  const bonsaiWitness = corpus.physicsBoundary.directedColliderLowerBoundWitnesses["potted-bonsai"];
  assert(existsSync(resolve(repositoryRoot, bonsaiWitness.sourceTest)), "bonsai directed collider witness source test is missing");
  const bonsaiSpec = readJson(
    resolve(here, corpus.scenarios.find(({ id }) => id === "potted-bonsai").spec),
    "potted-bonsai object sculpt spec for collider witness provenance",
  );
  assert.equal(bonsaiWitness.tierSeed, bonsaiSpec.workloadContract.seed, "bonsai collider witness tier seed drifted from source workload seed");
  const bonsaiDefinition = SCULPT_TARGETS.find(({ id }) => id === "potted-bonsai");
  assert(bonsaiDefinition, "potted-bonsai target definition is missing");
  const measuredBonsaiColliderWitnesses = validateBonsaiColliderWitnessMeasurements(bonsaiDefinition, bonsaiWitness);

  const falseAcceptedManifest = structuredClone(manifest);
  falseAcceptedManifest.status = "accepted";
  assert.throws(
    () => validateAcceptancePromotionState(falseAcceptedManifest, corpus, "INSUFFICIENT_EVIDENCE"),
    /must be incomplete/,
    "manifest validator must reject accepted metadata without a PASS verdict",
  );
  assert.throws(
    () => validateAcceptancePromotionState(manifest, corpus, "FAIL"),
    /must be blocked/,
    "manifest validator must reject incomplete metadata after failed evidence",
  );
  assert.equal(
    acceptanceVerdictFromArtifact(
      { structuralVerdict: "FAIL", claimVerdict: "INSUFFICIENT_EVIDENCE" },
      {
        acceptancePromotion: { evidenceReviewState: "candidate" },
        authoredPerformanceTargets: { evidenceBindingStatus: "ready" },
      },
    ),
    "FAIL",
    "structural artifact failure must outrank missing-evidence classification",
  );
  const promotedFixture = makeSyntheticPromotedAcceptanceFixture(manifest, corpus);
  assert.equal(validateAcceptancePromotionState(promotedFixture.manifest, promotedFixture.corpus, "PASS"), true);

  const unknownFieldMutation = structuredClone(corpus);
  unknownFieldMutation.renderArchitecture.unownedField = true;
  assert.throws(() => validateCorpusDeepContractShape(unknownFieldMutation), /keys must preserve canonical order and membership/);
  const invalidSeedMutation = structuredClone(corpus);
  invalidSeedMutation.tiers[0].sourceWorkloadEvidence[EXPECTED_TARGET_IDS[0]].seed = -1;
  assert.throws(() => validateCorpusDeepContractShape(invalidSeedMutation), /must be in \[0, 4294967295\]/);
  const missingShadowMutation = structuredClone(corpus);
  missingShadowMutation.tiers[0].sourceWorkloadEvidence[EXPECTED_TARGET_IDS[0]].shadowCasters = null;
  assert.throws(() => validateCorpusDeepContractShape(missingShadowMutation), /shadowCasters must be an integer/);
  const measuredPerformanceMutation = structuredClone(corpus);
  measuredPerformanceMutation.authoredPerformanceTargets.label = "Measured";
  assert.throws(() => validateCorpusDeepContractShape(measuredPerformanceMutation), /performance target label must be Authored/);
  const substitutedPhysicalTargetMutation = structuredClone(corpus);
  substitutedPhysicalTargetMutation.authoredPerformanceTargets.profilesByTier.full.allowedSocs = ["Apple M2"];
  assert.throws(() => validateCorpusDeepContractShape(substitutedPhysicalTargetMutation), /allowedSocs drifted from the artifact target plan/);
  const promotedMobileModelMutation = structuredClone(corpus);
  promotedMobileModelMutation.authoredPerformanceTargets.mobileArchitectureModels[0].performanceClaim = "PASS";
  assert.throws(() => validateCorpusDeepContractShape(promotedMobileModelMutation), /performanceClaim must remain NOT_CLAIMED/);
  const crossTierTargetMutation = structuredClone(corpus);
  crossTierTargetMutation.authoredPerformanceTargets.requiredPerformanceCases[0].profileId = "air-m1-or-m2-60hz";
  assert.throws(() => validateCorpusDeepContractShape(crossTierTargetMutation), /profileId drifted/);
  const commandMutation = structuredClone(corpus);
  commandMutation.commands.targets = "node arbitrary-target-check.mjs";
  assert.throws(() => validateCorpusDeepContractShape(commandMutation), /commands.targets drifted/);
  const colliderWitnessMutation = structuredClone(corpus);
  colliderWitnessMutation.physicsBoundary.directedColliderLowerBoundWitnesses["potted-bonsai"].valuesMeters["pot-solid"] = 0.161;
  assert.throws(() => validateCorpusDeepContractShape(colliderWitnessMutation), /witness exceeds authored ceiling/);
  const fabricatedLowerWitnessMutation = structuredClone(bonsaiWitness);
  fabricatedLowerWitnessMutation.valuesMeters["pot-solid"] = 0.01;
  assert.throws(
    () => validateBonsaiColliderWitnessMeasurements(bonsaiDefinition, fabricatedLowerWitnessMutation),
    /directed lower-bound witness drifted/,
  );

  return Object.freeze({
    ok: true,
    manifestId: manifest.id,
    status: manifest.status,
    targets: EXPECTED_TARGET_IDS.length,
    modes: SCULPT_MODES.length,
    tiers: SCULPT_TIERS.length,
    cameras: CORPUS_CAMERAS.length,
    physicalRoutes: corpus.physicalRouteContract.routeCount,
    referenceImages: 0,
    artifactClaimVerdict: artifactValidation.claimVerdict,
    artifactStructuralVerdict: artifactValidation.structuralVerdict,
    effectiveArtifactVerdict,
    acceptancePromoted,
    acceptedScenarios: corpus.visualAcceptance.acceptedScenarios.length,
    directedColliderWitnesses: Object.keys(measuredBonsaiColliderWitnesses).length,
    positiveControls: Object.freeze(["synthetic-pass-promotion-path", "accepted-spec-review-and-digest-closure"]),
    negativeControls: Object.freeze([
      "accepted-without-pass",
      "incomplete-after-failed-evidence",
      "structural-fail-priority",
      "unknown-deep-contract-field",
      "invalid-workload-seed",
      "missing-shadow-caster-provenance",
      "measured-label-on-authored-target",
      "substituted-physical-target-soc",
      "promoted-mobile-model",
      "cross-tier-physical-target",
      "deep-command-drift",
      "accepted-spec-missing-pass-review",
      "accepted-spec-forged-render-digest",
      "collider-witness-above-ceiling",
      "fabricated-smaller-collider-witness",
    ]),
  });
}

try {
  console.log(JSON.stringify(validateCorpusManifest(), null, 2));
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}
