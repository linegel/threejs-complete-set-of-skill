import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARCHITECTURE_SCENARIOS,
  createShadowArchitectureBench,
  resolveArchitectureBenchRoute,
} from "./main.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const localDirectory = "threejs-scalable-real-time-shadows/examples/webgpu-shadow-architecture-bench";
const manifest = JSON.parse(readFileSync(resolve(here, "lab.manifest.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(resolve(here, "package.json"), "utf8"));
const indexSource = readFileSync(resolve(here, "index.html"), "utf8");

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
    if (name !== "capture") assert(!command.includes("../"), `${name} must not delegate to a sibling package`);
  }
  assert.equal(
    candidate.scripts.capture,
    "node ../../../scripts/capture-lab-browser.mjs --lab webgpu-shadow-architecture-bench --target final",
    "capture must use the root self-serving harness and retain this support lab's identity",
  );
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
  assert.equal(candidate.id, "webgpu-shadow-architecture-bench");
  assert.equal(candidate.kind, "mechanism-demo");
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

  const scenarioById = new Map(candidate.scenarios.map((scenario) => [scenario.id, scenario]));
  const mechanismById = new Map(candidate.mechanisms.map((mechanism) => [mechanism.id, mechanism]));
  assert.deepEqual([...scenarioById.keys()].sort(), Object.keys(ARCHITECTURE_SCENARIOS).sort());
  for (const [scenarioId, config] of Object.entries(ARCHITECTURE_SCENARIOS)) {
    const scenario = scenarioById.get(scenarioId);
    assert.equal(scenario.startup.scenario, scenarioId);
    assert.equal(scenario.startup.tier, "high");
    assert.equal(scenario.startup.mode, "final");
    const mechanism = mechanismById.get(config.mechanism);
    assert(mechanism, `missing ${config.mechanism} mechanism`);
    assert.equal(mechanism.startup.scenario, scenarioId);
    const route = new URL(mechanism.route, "https://shadow-lab.invalid");
    assert.equal(route.searchParams.get("scenario"), scenarioId);
    assert.equal(resolveArchitectureBenchRoute(route.search).architecture, config.architecture);
    assert.equal(resolveArchitectureBenchRoute(`?mechanism=${config.mechanism}`).scenario, scenarioId);
  }
}

validatePackage(packageJson);
validateManifest(manifest);
assert.match(indexSource, /resolveArchitectureBenchRoute\(location\.search\)/);
assert.match(indexSource, /"\.\.\/\.\.\/\.\.\/node_modules\/three\/build\/three\.webgpu\.js"/);
assert.match(indexSource, /globalThis\.labController = controller/);
assert.match(indexSource, /globalThis\.__LAB_CONTROLLER__ = controller/);
assert.match(indexSource, /controller\.getMetrics\(\)\.routeSelection/);
await assert.rejects(
  () => createShadowArchitectureBench({ scenario: "not-a-shadow-scenario" }),
  /unknown shadow architecture scenario/,
);
assert.throws(() => resolveArchitectureBenchRoute("?mechanism=not-real"), /unknown shadow architecture mechanism/);
assert.throws(() => resolveArchitectureBenchRoute("?scenario=not-real"), /unknown shadow architecture scenario/);

if (process.argv.includes("--mutations")) {
  const promoted = structuredClone(manifest);
  promoted.status = "accepted";
  assert.throws(() => validateManifest(promoted), /must not claim acceptance/);

  const recursive = structuredClone(manifest);
  recursive.commands.capture = "npm run labs:capture -- --lab webgpu-shadow-architecture-bench";
  assert.throws(() => validateManifest(recursive), /manifest command capture/);

  const wrongRoute = structuredClone(manifest);
  wrongRoute.mechanisms[0].route = "/demos/webgpu-shadow-architecture-bench/?scenario=cached";
  assert.throws(() => validateManifest(wrongRoute));

  const privateStartup = structuredClone(manifest);
  privateStartup.scenarios[0].startup.architecture = "bounded";
  assert.throws(() => validateManifest(privateStartup), /unsupported public startup key architecture/);
}

console.log(JSON.stringify({
  pass: true,
  lab: manifest.id,
  scenarios: Object.keys(ARCHITECTURE_SCENARIOS),
  evidenceVerdict: "INSUFFICIENT_EVIDENCE",
}));
