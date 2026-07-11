import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RELATIVISTIC_TIER_CONFIG } from "./main.mjs";
import {
  createRelativisticSpaceShotGraph,
  validateRelativisticSpaceShotGraph,
} from "./owner-graph.mjs";
import { validateRelativisticTierPolicy } from "./quality-governor.mjs";

function validGraph() {
  return createRelativisticSpaceShotGraph({
    width: 641,
    height: 359,
    tier: "balanced",
    activeMode: "final",
    spaceDescription: { rendererOwner: "host", outputOwner: "host" },
    particleDescription: { rendererOwner: "host", outputOwner: "host" },
    bloomDescription: { inputSignal: "scene.emissive" },
    imageDescription: { owner: "host-image-pipeline-stage" },
  });
}

const mutations = [
  { id: "duplicate-renderer", pattern: /exactly one renderer owner/, mutate: (graph) => graph.rendererOwners.push("private-renderer") },
  { id: "duplicate-temporal-owner", pattern: /duplicate ownership: temporalHistory/, mutate: (graph) => graph.ownerClaims.push({ semantic: "temporalHistory", owner: "private-temporal" }) },
  { id: "extra-scene-pass", pattern: /exactly one primary scene submission/, mutate: (graph) => graph.sceneSubmissions.push({ id: "private-beauty", owner: "private" }) },
  { id: "duplicate-emissive", pattern: /duplicate signal producer: scene.emissive/, mutate: (graph) => graph.signals.push({ id: "scene.emissive", producer: "private", consumers: ["private"] }) },
  { id: "missing-velocity", pattern: /required signal is missing: scene.velocity/, mutate: (graph) => { graph.signals = graph.signals.filter((signal) => signal.id !== "scene.velocity"); } },
  { id: "private-bloom-input", pattern: /BloomNode must consume the shared scene.emissive/, mutate: (graph) => { graph.bloomInputSignal = "private.emissive"; } },
  { id: "post-grade-meter", pattern: /exposure must meter the composed pre-grade/, mutate: (graph) => { graph.exposureMeterSourceSignal = "scene.graded"; } },
  { id: "private-temporal", pattern: /temporal history must have one image-pipeline owner/, mutate: (graph) => { graph.temporalOwner = "private-temporal"; } },
  { id: "private-tone-map", pattern: /tone map must have one image-pipeline owner/, mutate: (graph) => { graph.finalToneMapOwner = "private-tone-map"; } },
  { id: "private-output", pattern: /output transform must have one image-pipeline owner/, mutate: (graph) => { graph.finalOutputTransformOwner = "private-output"; } },
  { id: "double-output-conversion", pattern: /outputColorTransform false/, mutate: (graph) => { graph.outputColorTransform = true; } },
  { id: "space-private-renderer", pattern: /space stage attempted private renderer/, mutate: (graph) => { graph.stageOwnership.space.rendererOwner = "space-private"; } },
  { id: "particles-private-output", pattern: /particles stage attempted private renderer or output ownership/, mutate: (graph) => { graph.stageOwnership.particles.outputOwner = "particle-private"; } },
];

for (const fixture of mutations) {
  const graph = structuredClone(validGraph());
  fixture.mutate(graph);
  const result = validateRelativisticSpaceShotGraph(graph);
  assert.equal(result.valid, false, `${fixture.id} escaped validation`);
  assert.match(result.errors.join("\n"), fixture.pattern, `${fixture.id} failed for the wrong reason`);
}

const manifest = JSON.parse(readFileSync(new URL("./lab.manifest.json", import.meta.url), "utf8"));
const contract = JSON.parse(readFileSync(new URL("./contract.json", import.meta.url), "utf8"));
const driftedManifest = structuredClone(manifest.tiers);
driftedManifest.find((tier) => tier.id === "budgeted").resolutionPolicy.rayScale = 0.5;
const drift = validateRelativisticTierPolicy({
  manifestTiers: driftedManifest,
  contractTiers: contract.tiers,
  runtimeTiers: RELATIVISTIC_TIER_CONFIG,
});
assert.equal(drift.valid, false, "tier policy drift escaped validation");
assert.match(drift.errors.join("\n"), /tier drift budgeted\.rayScale/);

console.log(`Relativistic Space Shot rejected ${mutations.length} duplicate-owner/private-pass/signal mutations plus tier-policy drift`);
