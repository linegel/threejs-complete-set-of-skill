import assert from "node:assert/strict";
import { createFinalImageFlightGraph, validateFinalImageFlightGraph } from "./owner-graph.mjs";
import { createSustainedP95Governor } from "./quality-governor.mjs";

function validGraph() {
  return createFinalImageFlightGraph({
    width: 641,
    height: 359,
    tier: "balanced",
    aoScale: 0.5,
    bloomScale: 0.33,
    exposureDescription: { owner: "exposure-color-stage" },
    shadowDescription: { architecture: "bounded", frameMetrics: { frameId: 11 } },
    motionStorageBytes: 8192,
    activeEffectInstances: 128,
    effectInstanceCapacity: 256,
    activeMode: "final",
    qualityGovernor: { activeTier: "balanced", sampleSource: "renderer-timestamp-query", frameAggregationPolicy: "exactly-one-rendered-frame-per-resolve", transitionTrace: [] },
    tierConfiguration: { dprCap: 1.5, sceneScale: 1, aoTier: "high", bloomScale: 0.33, exposureTier: "balanced-log-reduction", shadowMapSize: 512, effectInstances: 128 },
    preGradeHdrSharedIdentity: true,
  });
}

const mutations = [
  {
    id: "duplicate-renderer-owner",
    pattern: /exactly one renderer owner/,
    mutate(graph) { graph.rendererOwners.push("private-renderer"); },
  },
  {
    id: "duplicate-semantic-owner",
    pattern: /duplicate ownership: outputTransform/,
    mutate(graph) { graph.ownerClaims.push({ semantic: "outputTransform", owner: "private-output" }); },
  },
  {
    id: "extra-scene-pass",
    pattern: /scene submission count must equal two/,
    mutate(graph) { graph.sceneSubmissions.push({ id: "private-beauty", owner: "private", kind: "lit-scene-pass" }); },
  },
  {
    id: "missing-lit-pass",
    pattern: /exactly one lit scene pass is required/,
    mutate(graph) { graph.sceneSubmissions = graph.sceneSubmissions.filter((entry) => entry.kind !== "lit-scene-pass"); },
  },
  {
    id: "duplicate-signal-producer",
    pattern: /duplicate signal producer: scene.emissive/,
    mutate(graph) { graph.signals.push({ id: "scene.emissive", producer: "private-emissive", consumers: ["private-bloom"] }); },
  },
  {
    id: "missing-signal-producer",
    pattern: /signal scene.velocity has no producer/,
    mutate(graph) { graph.signals.find((entry) => entry.id === "scene.velocity").producer = ""; },
  },
  {
    id: "missing-required-signal",
    pattern: /signal scene.velocity must have exactly one producer/,
    mutate(graph) { graph.signals = graph.signals.filter((entry) => entry.id !== "scene.velocity"); },
  },
  {
    id: "wrong-tone-map-owner",
    pattern: /duplicate or incorrect tone-map owner/,
    mutate(graph) { graph.finalToneMapOwner = "private-tone-map"; },
  },
  {
    id: "wrong-output-transform-owner",
    pattern: /duplicate or incorrect output-transform owner/,
    mutate(graph) { graph.finalOutputTransformOwner = "private-output-transform"; },
  },
  {
    id: "pipeline-output-transform-enabled",
    pattern: /outputColorTransform false/,
    mutate(graph) { graph.outputColorTransform = true; },
  },
  {
    id: "missing-pre-grade-signal",
    pattern: /signal scene\.pre-grade-hdr must have exactly one producer/,
    mutate(graph) { graph.signals = graph.signals.filter((entry) => entry.id !== "scene.pre-grade-hdr"); },
  },
  {
    id: "missing-pre-grade-resource",
    pattern: /pre-grade-hdr resource is required/,
    mutate(graph) { graph.resources = graph.resources.filter((entry) => entry.id !== "pre-grade-hdr"); },
  },
  {
    id: "split-exposure-inputs",
    pattern: /meter and HDR presentation must consume the same pre-grade HDR signal/,
    mutate(graph) { graph.preGradeHdrBinding.hdrColorSourceId = "scene.lit-hdr"; },
  },
  {
    id: "duplicate-pre-grade-node-identity",
    pattern: /must share one node identity/,
    mutate(graph) { graph.preGradeHdrBinding.sharedNodeIdentity = false; },
  },
  {
    id: "fake-shadow-diagnostic",
    pattern: /actual shadow-mask pass texture/,
    mutate(graph) { graph.diagnostics.find((entry) => entry.id === "shadow-contribution").nodeKind = "lit-hdr-label"; },
  },
  {
    id: "fake-owner-graph-diagnostic",
    pattern: /live-signal mosaic node/,
    mutate(graph) { graph.diagnostics.find((entry) => entry.id === "owner-graph").nodeKind = "lit-hdr-label"; },
  },
  {
    id: "missing-shadow-frame-id",
    pattern: /rendered explicit frameId/,
    mutate(graph) { delete graph.shadowFrameRecord.frameId; },
  },
  {
    id: "cpu-quality-governor",
    pattern: /renderer timestamp-query samples/,
    mutate(graph) { graph.qualityGovernor.sampleSource = "cpu-submission-time"; },
  },
  {
    id: "multi-frame-timestamp-average",
    pattern: /reject aggregate multi-frame timestamp batches/,
    mutate(graph) { graph.qualityGovernor.frameAggregationPolicy = "average-all-pending-frames"; },
  },
  {
    id: "active-count-exceeds-capacity",
    pattern: /within allocated capacity/,
    mutate(graph) { graph.effectPopulation.active = graph.effectPopulation.capacity + 1; },
  },
  {
    id: "governor-tier-drift",
    pattern: /quality governor tier must match applied runtime tier/,
    mutate(graph) { graph.qualityGovernor.activeTier = "hero"; },
  },
  {
    id: "tier-count-not-applied",
    pattern: /tier effect limit must match active InstancedMesh count/,
    mutate(graph) { graph.tierConfiguration.effectInstances = 64; },
  },
  {
    id: "hidden-shadow-diagnostic-pass",
    pattern: /diagnostic scene submission count does not match output reachability/,
    mutate(graph) { graph.activeMode = "shadow-contribution"; },
  },
];

for (const fixture of mutations) {
  const graph = structuredClone(validGraph());
  fixture.mutate(graph);
  const result = validateFinalImageFlightGraph(graph);
  assert.equal(result.valid, false, `${fixture.id} escaped validation`);
  assert.match(result.errors.join("\n"), fixture.pattern, `${fixture.id} failed for the wrong reason`);
}

let absentTransitionCount = 0;
const absentGovernor = createSustainedP95Governor({
  initialTier: "hero",
  policy: { windowSize: 1, downgradeWindows: 1, upgradeWindows: 1, cooldownWindows: 1 },
  onTransition: async () => { absentTransitionCount += 1; },
});
for (let frameId = 0; frameId < 8; frameId += 1) {
  await absentGovernor.recordTimestampSample({ frameId, renderMs: null, computeMs: null });
}
assert.equal(absentGovernor.tier, "hero", "missing timestamps mutated the tier");
assert.equal(absentTransitionCount, 0, "missing timestamps triggered a transition");
assert.equal(absentGovernor.describe().completedWindows.value, 0, "missing timestamps populated a p95 window");

const spikeGovernor = createSustainedP95Governor({
  initialTier: "hero",
  policy: { windowSize: 1, downgradeWindows: 2, upgradeWindows: 2, cooldownWindows: 1 },
});
await spikeGovernor.recordTimestampSample({ frameId: 0, renderMs: 30, computeMs: 2 });
await spikeGovernor.recordTimestampSample({ frameId: 1, renderMs: 13, computeMs: 1 });
assert.equal(spikeGovernor.tier, "hero", "one unsustained spike escaped the persistence gate");

const cooldownTransitions = [];
const cooldownGovernor = createSustainedP95Governor({
  initialTier: "balanced",
  policy: { windowSize: 1, downgradeWindows: 1, upgradeWindows: 1, cooldownWindows: 2 },
  onTransition: async (tier) => { cooldownTransitions.push(tier); },
});
await cooldownGovernor.recordTimestampSample({ frameId: 0, renderMs: 20, computeMs: 2 });
assert.equal(cooldownGovernor.tier, "budgeted");
for (let frameId = 1; frameId <= 2; frameId += 1) {
  await cooldownGovernor.recordTimestampSample({ frameId, renderMs: 8, computeMs: 1 });
  assert.equal(cooldownGovernor.tier, "budgeted", "cooldown allowed immediate tier oscillation");
}
await cooldownGovernor.recordTimestampSample({ frameId: 3, renderMs: 8, computeMs: 1 });
assert.equal(cooldownGovernor.tier, "balanced", "tier failed to recover after cooldown and sustained headroom");
assert.deepEqual(cooldownTransitions, ["budgeted", "balanced"]);

console.log(`Final Image Flight rejected ${mutations.length} graph mutations plus absent-timestamp, spike, and cooldown governor mutations`);
