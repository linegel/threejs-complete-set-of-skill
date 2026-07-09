import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PIPELINE_INTEGRATION_MECHANISMS,
  PIPELINE_INTEGRATION_SCENARIO,
  createShadowPipelineIntegration,
  resolveShadowPipelineIntegrationRoute,
} from "./main.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const localDirectory = "threejs-scalable-real-time-shadows/examples/webgpu-shadow-pipeline-integration";
const manifest = JSON.parse(readFileSync(resolve(here, "lab.manifest.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(resolve(here, "package.json"), "utf8"));
const indexSource = readFileSync(resolve(here, "index.html"), "utf8");
const mainSource = readFileSync(resolve(here, "main.js"), "utf8");

const standardScripts = Object.freeze([
  "check",
  "validate:unit",
  "test:mutations",
  "capture",
  "validate:artifacts",
  "validate:quick",
  "validate:full",
]);
const manifestCommands = Object.freeze({
  check: "check",
  test: "validate:unit",
  mutations: "test:mutations",
  capture: "capture",
  validateArtifacts: "validate:artifacts",
  validateQuick: "validate:quick",
  validateFull: "validate:full",
});
const expectedMechanismModes = Object.freeze({
  "child-shadow-receiver-blend": "final",
  "sequential-shadow-updates": "owner-graph",
  "single-output-ownership": "owner-graph",
});
const publicStartupKeys = new Set(["scenario", "mode", "tier", "seed", "camera", "time"]);

function validatePackage(candidate) {
  assert.equal(candidate.private, true, "support package must remain private");
  assert.equal(candidate.type, "module");
  for (const script of standardScripts) {
    assert.equal(typeof candidate.scripts?.[script], "string", `missing local package script ${script}`);
  }
  for (const [name, command] of Object.entries(candidate.scripts)) {
    assert(!command.includes("npm --prefix"), `${name} must be a non-recursive local command`);
    assert(!command.includes("labs:"), `${name} must not recurse through the root lab dispatcher`);
    assert(!command.includes("../"), `${name} must not delegate to a sibling package`);
  }
  assert.equal(candidate.scripts.capture, "node evidence-status.mjs capture");
  assert.equal(candidate.scripts["validate:artifacts"], "node evidence-status.mjs validate:artifacts");
  assert.match(candidate.scripts["validate:quick"], /validate-support-lab\.mjs --mutations/);
  assert.match(candidate.scripts["validate:full"], /evidence-status\.mjs validate:artifacts/);
}

function assertIncomplete(entries, label) {
  for (const entry of entries ?? []) {
    const status = entry.acceptanceStatus ?? entry.status;
    assert.equal(status, "incomplete", `${label} ${entry.id} must remain incomplete`);
  }
}

function validateManifest(candidate) {
  assert.equal(candidate.schemaVersion, 2);
  assert.equal(candidate.id, "webgpu-shadow-pipeline-integration");
  assert.equal(candidate.kind, "integration-demo");
  assert.equal(candidate.status, "incomplete", "support lab must not claim acceptance");
  assert.equal(candidate.evidenceContract, "v2");
  assert.equal(candidate.evidenceBundle, null, "support lab has no accepted evidence bundle");
  assert.equal(candidate.sourceHash, null, "source hash remains unavailable until publication capture");
  assertIncomplete(candidate.scenarios, "scenario");
  assertIncomplete(candidate.mechanisms, "mechanism");
  assertIncomplete(candidate.tiers, "tier");
  assertIncomplete(candidate.capabilityRequirements, "capability");
  assertIncomplete(candidate.runtimeProof, "runtime proof");

  for (const record of [...candidate.scenarios, ...candidate.mechanisms, ...candidate.tiers]) {
    for (const key of Object.keys(record.startup ?? {})) {
      assert(publicStartupKeys.has(key), `unsupported public startup key ${key}`);
    }
  }

  for (const source of candidate.canonicalSource) {
    assert(existsSync(resolve(repoRoot, source)), `missing canonical source ${source}`);
  }
  assert(existsSync(resolve(repoRoot, candidate.browserEntry)), "browser entry must exist");

  for (const [field, script] of Object.entries(manifestCommands)) {
    assert.equal(
      candidate.commands?.[field],
      `npm --prefix ${localDirectory} run ${script}`,
      `manifest command ${field} must enter the local package exactly once`,
    );
  }
  assert.equal(candidate.validationCommand, candidate.commands.test);

  assert.equal(candidate.scenarios.length, 1);
  assert.equal(candidate.scenarios[0].id, PIPELINE_INTEGRATION_SCENARIO);
  assert.deepEqual(candidate.scenarios[0].startup, {
    scenario: PIPELINE_INTEGRATION_SCENARIO,
    tier: "high",
    mode: "final",
  });

  const mechanismById = new Map(candidate.mechanisms.map((mechanism) => [mechanism.id, mechanism]));
  assert.deepEqual([...mechanismById.keys()].sort(), Object.keys(expectedMechanismModes).sort());
  assert.deepEqual(expectedMechanismModes, PIPELINE_INTEGRATION_MECHANISMS);
  for (const [id, mode] of Object.entries(expectedMechanismModes)) {
    const mechanism = mechanismById.get(id);
    assert.equal(mechanism.startup.mode, mode, `${id} must select its declared fixed mode`);
    assert(candidate.modes.includes(mode), `${id} selects unsupported mode ${mode}`);
    const route = new URL(mechanism.route, "https://shadow-lab.invalid");
    assert.equal(route.pathname, candidate.publishPath, `${id} must resolve to the integration page`);
    assert.equal(route.searchParams.get("mechanism"), id);
    const selection = resolveShadowPipelineIntegrationRoute(route.search);
    assert.equal(selection.mechanism, id);
    assert.equal(selection.mode, mode);
  }
}

validatePackage(packageJson);
validateManifest(manifest);
assert.equal(typeof createShadowPipelineIntegration, "function");
assert.match(indexSource, /createShadowPipelineIntegration/);
assert.match(indexSource, /resolveShadowPipelineIntegrationRoute\(location\.search\)/);
assert.match(indexSource, /"\.\.\/\.\.\/\.\.\/node_modules\/three\/build\/three\.webgpu\.js"/);
assert.match(indexSource, /globalThis\.labController = controller/);
assert.match(indexSource, /globalThis\.__LAB_CONTROLLER__ = controller/);
assert.match(indexSource, /controller\.getMetrics\(\)\.routeSelection/);
assert.match(indexSource, /INCOMPLETE — WebGPU evidence pending/);
assert.match(mainSource, /renderPipelineOutputColorTransform !== false/);
assert.match(mainSource, /graph\.owners\.renderer !== "canonical-shadow-lab"/);
assert.match(mainSource, /graph\.owners\.finalRenderPipeline !== "canonical-shadow-lab"/);
assert.match(mainSource, /graph\.owners\.toneMap !== "renderOutput"/);
assert.match(mainSource, /graph\.owners\.finalOutputTransform !== "renderOutput"/);
assert.throws(() => resolveShadowPipelineIntegrationRoute("?scenario=not-real"), /unknown shadow pipeline scenario/);
assert.throws(() => resolveShadowPipelineIntegrationRoute("?mechanism=not-real"), /unknown shadow pipeline mechanism/);

if (process.argv.includes("--mutations")) {
  const promoted = structuredClone(manifest);
  promoted.status = "accepted";
  assert.throws(() => validateManifest(promoted), /must not claim acceptance/);

  const recursive = structuredClone(manifest);
  recursive.commands.capture = "npm run labs:capture -- --lab webgpu-shadow-pipeline-integration";
  assert.throws(() => validateManifest(recursive), /manifest command capture/);

  const unsupportedMode = structuredClone(manifest);
  unsupportedMode.mechanisms[0].startup.mode = "invented-shadow-mode";
  assert.throws(() => validateManifest(unsupportedMode), /must select its declared fixed mode/);

  const privateStartup = structuredClone(manifest);
  privateStartup.scenarios[0].startup.architecture = "cached";
  assert.throws(() => validateManifest(privateStartup), /unsupported public startup key architecture/);
}

console.log(JSON.stringify({
  pass: true,
  lab: manifest.id,
  mechanisms: Object.keys(expectedMechanismModes),
  evidenceVerdict: "INSUFFICIENT_EVIDENCE",
}));
