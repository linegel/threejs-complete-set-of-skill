export const FINAL_IMAGE_FLIGHT_OWNERS = Object.freeze({
  renderer: "final-image-flight:image-pipeline-host",
  renderPipeline: "final-image-flight:image-pipeline-host",
  gbuffer: "final-image-flight:image-pipeline-host",
  preGradeComposite: "final-image-flight:image-pipeline-host",
  camera: "threejs-camera-controls-and-rigs",
  motion: "threejs-procedural-motion-systems",
  ao: "threejs-ambient-contact-shading",
  bloom: "threejs-bloom",
  exposure: "threejs-exposure-color-grading",
  shadows: "threejs-scalable-real-time-shadows",
  validation: "threejs-visual-validation",
  toneMap: "final-image-flight:image-pipeline/exposure-stage",
  outputTransform: "final-image-flight:image-pipeline/exposure-stage",
});

const REQUIRED_SEMANTICS = Object.freeze(Object.keys(FINAL_IMAGE_FLIGHT_OWNERS));
const REQUIRED_SIGNAL_PRODUCERS = Object.freeze({
  "scene.output": FINAL_IMAGE_FLIGHT_OWNERS.gbuffer,
  "scene.depth": FINAL_IMAGE_FLIGHT_OWNERS.gbuffer,
  "scene.normal": FINAL_IMAGE_FLIGHT_OWNERS.gbuffer,
  "scene.emissive": FINAL_IMAGE_FLIGHT_OWNERS.gbuffer,
  "scene.velocity": FINAL_IMAGE_FLIGHT_OWNERS.gbuffer,
  "ao.visibility": FINAL_IMAGE_FLIGHT_OWNERS.ao,
  "scene.lit-hdr": FINAL_IMAGE_FLIGHT_OWNERS.ao,
  "bloom.hdr": FINAL_IMAGE_FLIGHT_OWNERS.bloom,
  "scene.pre-grade-hdr": FINAL_IMAGE_FLIGHT_OWNERS.preGradeComposite,
  "exposure.state": FINAL_IMAGE_FLIGHT_OWNERS.exposure,
  "shadow.visibility": FINAL_IMAGE_FLIGHT_OWNERS.shadows,
});

function datum(value, unit, label, source) {
  return { value, unit, label, source };
}

function valueOf(datumOrNumber) {
  return typeof datumOrNumber === "number" ? datumOrNumber : datumOrNumber?.value;
}

function duplicates(values) {
  const seen = new Set();
  const result = new Set();
  for (const value of values) {
    if (seen.has(value)) result.add(value);
    seen.add(value);
  }
  return [...result];
}

function findById(entries, id) {
  return (entries ?? []).find((entry) => entry.id === id);
}

export function validateFinalImageFlightGraph(graph) {
  const errors = [];
  if (graph?.schemaVersion !== 2) errors.push("runtime graph must use schemaVersion 2");
  const claims = graph?.ownerClaims ?? [];
  const duplicateOwners = duplicates(claims.map((claim) => claim.semantic));
  if (duplicateOwners.length > 0) errors.push(`duplicate ownership: ${duplicateOwners.join(", ")}`);
  for (const semantic of REQUIRED_SEMANTICS) {
    const matches = claims.filter((claim) => claim.semantic === semantic);
    if (matches.length !== 1) errors.push(`semantic ${semantic} must have exactly one owner`);
    else if (matches[0].owner !== FINAL_IMAGE_FLIGHT_OWNERS[semantic]) {
      errors.push(`semantic ${semantic} owner must be ${FINAL_IMAGE_FLIGHT_OWNERS[semantic]}`);
    }
  }
  const duplicateSignals = duplicates((graph?.signals ?? []).map((signal) => signal.id));
  if (duplicateSignals.length > 0) errors.push(`duplicate signal producer: ${duplicateSignals.join(", ")}`);
  for (const signal of graph?.signals ?? []) {
    if (typeof signal.producer !== "string" || signal.producer.length === 0) errors.push(`signal ${signal.id} has no producer`);
    if (!Array.isArray(signal.consumers) || signal.consumers.length === 0) errors.push(`signal ${signal.id} has no consumer`);
  }
  for (const [id, producer] of Object.entries(REQUIRED_SIGNAL_PRODUCERS)) {
    const matches = (graph?.signals ?? []).filter((signal) => signal.id === id);
    if (matches.length !== 1) errors.push(`signal ${id} must have exactly one producer`);
    else if (matches[0].producer !== producer) errors.push(`signal ${id} producer must be ${producer}`);
  }
  const scenePasses = graph?.sceneSubmissions ?? [];
  if (scenePasses.length !== 2) errors.push("scene submission count must equal two");
  if (scenePasses.filter((entry) => entry.kind === "gbuffer-prepass").length !== 1) errors.push("exactly one gbuffer prepass is required");
  if (scenePasses.filter((entry) => entry.kind === "lit-scene-pass").length !== 1) errors.push("exactly one lit scene pass is required");
  if (valueOf(graph?.submissionCounts?.gbufferPrepassCount) !== 1) errors.push("gbufferPrepassCount must equal one");
  if (valueOf(graph?.submissionCounts?.litScenePassCount) !== 1) errors.push("litScenePassCount must equal one");
  if (valueOf(graph?.submissionCounts?.sceneSubmissionCount) !== 2) errors.push("sceneSubmissionCount must equal two");
  if (valueOf(graph?.submissionCounts?.fullLitOutputCount) !== 1) errors.push("fullLitOutputCount must equal one");
  if (graph?.finalToneMapOwner !== FINAL_IMAGE_FLIGHT_OWNERS.toneMap) errors.push("duplicate or incorrect tone-map owner");
  if (graph?.finalOutputTransformOwner !== FINAL_IMAGE_FLIGHT_OWNERS.outputTransform) errors.push("duplicate or incorrect output-transform owner");
  if (graph?.outputColorTransform !== false) errors.push("explicit renderOutput requires outputColorTransform false");
  if ((graph?.rendererOwners ?? []).length !== 1) errors.push("exactly one renderer owner is required");
  if ((graph?.renderPipelineOwners ?? []).length !== 1) errors.push("exactly one RenderPipeline owner is required");
  const preGradeResource = findById(graph?.resources, "pre-grade-hdr");
  if (!preGradeResource) errors.push("pre-grade-hdr resource is required");
  else if (preGradeResource.owner !== FINAL_IMAGE_FLIGHT_OWNERS.preGradeComposite) errors.push("pre-grade-hdr resource has the wrong owner");
  const binding = graph?.preGradeHdrBinding;
  if (binding?.resourceId !== "pre-grade-hdr") errors.push("exposure must bind the pre-grade-hdr resource");
  if (binding?.meterSourceId !== "scene.pre-grade-hdr" || binding?.hdrColorSourceId !== "scene.pre-grade-hdr") {
    errors.push("exposure meter and HDR presentation must consume the same pre-grade HDR signal");
  }
  if (binding?.sharedNodeIdentity !== true) errors.push("pre-grade HDR meter and presentation must share one node identity");
  const shadowDiagnostic = findById(graph?.diagnostics, "shadow-contribution");
  if (shadowDiagnostic?.nodeKind !== "ShadowNodeMaterial-pass-texture") errors.push("shadow-contribution must use the actual shadow-mask pass texture");
  if (!shadowDiagnostic?.sourceIds?.includes("shadow.visibility")) errors.push("shadow-contribution diagnostic must consume shadow.visibility");
  const expectedDiagnosticSubmissions = graph?.activeMode === "shadow-contribution" ? 1 : 0;
  if (valueOf(graph?.diagnosticSceneSubmissionCount) !== expectedDiagnosticSubmissions) errors.push("diagnostic scene submission count does not match output reachability");
  if (shadowDiagnostic && shadowDiagnostic.reachable !== (graph?.activeMode === "shadow-contribution")) errors.push("shadow diagnostic reachability does not match active mode");
  const ownerDiagnostic = findById(graph?.diagnostics, "owner-graph");
  if (ownerDiagnostic?.nodeKind !== "live-signal-mosaic") errors.push("owner-graph must be a live-signal mosaic node");
  if ((ownerDiagnostic?.sourceIds ?? []).length < 5) errors.push("owner-graph diagnostic must consume at least five live signals");
  if (!Number.isInteger(graph?.shadowFrameRecord?.frameId) || graph.shadowFrameRecord.frameId < 0) errors.push("shadow owner must report a rendered explicit frameId");
  if (graph?.qualityGovernor?.sampleSource !== "renderer-timestamp-query") errors.push("quality governor must use renderer timestamp-query samples");
  if (graph?.qualityGovernor?.frameAggregationPolicy !== "exactly-one-rendered-frame-per-resolve") errors.push("quality governor must reject aggregate multi-frame timestamp batches");
  if (!Array.isArray(graph?.qualityGovernor?.transitionTrace)) errors.push("quality governor transition trace is required");
  if (graph?.qualityGovernor?.activeTier !== graph?.tier) errors.push("quality governor tier must match applied runtime tier");
  if (!Number.isInteger(graph?.effectPopulation?.active) || !Number.isInteger(graph?.effectPopulation?.capacity)) {
    errors.push("effect population must report integer active and capacity counts");
  } else if (graph.effectPopulation.active < 0 || graph.effectPopulation.active > graph.effectPopulation.capacity) {
    errors.push("active effect count must remain within allocated capacity");
  }
  if (valueOf(graph?.tierConfiguration?.effectInstances) !== graph?.effectPopulation?.active) errors.push("tier effect limit must match active InstancedMesh count");
  for (const field of ["dprCap", "sceneScale", "bloomScale", "shadowMapSize", "effectInstances"]) {
    if (!Number.isFinite(valueOf(graph?.tierConfiguration?.[field]))) errors.push(`tier configuration ${field} must be numeric`);
  }
  if (typeof graph?.tierConfiguration?.aoTier !== "string" || typeof graph?.tierConfiguration?.exposureTier !== "string") {
    errors.push("tier configuration must select concrete AO and exposure tiers");
  }
  return { valid: errors.length === 0, errors };
}

export function createFinalImageFlightGraph({
  width,
  height,
  sceneScale = 1,
  tier,
  aoScale,
  bloomScale,
  exposureDescription,
  shadowDescription,
  motionStorageBytes,
  activeEffectInstances = 0,
  effectInstanceCapacity = 0,
  activeMode,
  qualityGovernor,
  tierConfiguration = null,
  preGradeHdrSharedIdentity = false,
} = {}) {
  const pixels = width * height;
  const sceneWidth = Math.max(1, Math.round(width * sceneScale));
  const sceneHeight = Math.max(1, Math.round(height * sceneScale));
  const scenePixels = sceneWidth * sceneHeight;
  const ownerClaims = Object.entries(FINAL_IMAGE_FLIGHT_OWNERS).map(([semantic, owner]) => ({ semantic, owner }));
  const graph = {
    schemaVersion: 2,
    ownerClaims,
    rendererOwners: [FINAL_IMAGE_FLIGHT_OWNERS.renderer],
    renderPipelineOwners: [FINAL_IMAGE_FLIGHT_OWNERS.renderPipeline],
    signals: [
      { id: "scene.output", producer: FINAL_IMAGE_FLIGHT_OWNERS.gbuffer, consumers: ["no-post-diagnostic"] },
      { id: "scene.depth", producer: FINAL_IMAGE_FLIGHT_OWNERS.gbuffer, consumers: [FINAL_IMAGE_FLIGHT_OWNERS.ao, FINAL_IMAGE_FLIGHT_OWNERS.validation] },
      { id: "scene.normal", producer: FINAL_IMAGE_FLIGHT_OWNERS.gbuffer, consumers: [FINAL_IMAGE_FLIGHT_OWNERS.ao, FINAL_IMAGE_FLIGHT_OWNERS.validation] },
      { id: "scene.emissive", producer: FINAL_IMAGE_FLIGHT_OWNERS.gbuffer, consumers: [FINAL_IMAGE_FLIGHT_OWNERS.bloom, FINAL_IMAGE_FLIGHT_OWNERS.validation] },
      { id: "scene.velocity", producer: FINAL_IMAGE_FLIGHT_OWNERS.gbuffer, consumers: [FINAL_IMAGE_FLIGHT_OWNERS.ao, FINAL_IMAGE_FLIGHT_OWNERS.validation] },
      { id: "ao.visibility", producer: FINAL_IMAGE_FLIGHT_OWNERS.ao, consumers: ["builtinAOContext", FINAL_IMAGE_FLIGHT_OWNERS.validation] },
      { id: "scene.lit-hdr", producer: FINAL_IMAGE_FLIGHT_OWNERS.ao, consumers: [FINAL_IMAGE_FLIGHT_OWNERS.preGradeComposite, FINAL_IMAGE_FLIGHT_OWNERS.validation] },
      { id: "bloom.hdr", producer: FINAL_IMAGE_FLIGHT_OWNERS.bloom, consumers: ["hdr-composite", FINAL_IMAGE_FLIGHT_OWNERS.validation] },
      { id: "scene.pre-grade-hdr", producer: FINAL_IMAGE_FLIGHT_OWNERS.preGradeComposite, consumers: [FINAL_IMAGE_FLIGHT_OWNERS.exposure, FINAL_IMAGE_FLIGHT_OWNERS.validation] },
      { id: "exposure.state", producer: FINAL_IMAGE_FLIGHT_OWNERS.exposure, consumers: [FINAL_IMAGE_FLIGHT_OWNERS.toneMap, FINAL_IMAGE_FLIGHT_OWNERS.validation] },
      { id: "shadow.visibility", producer: FINAL_IMAGE_FLIGHT_OWNERS.shadows, consumers: ["lit-scene-pass", FINAL_IMAGE_FLIGHT_OWNERS.validation] },
    ],
    sceneSubmissions: [
      { id: "flight.gbuffer-prepass", owner: FINAL_IMAGE_FLIGHT_OWNERS.gbuffer, kind: "gbuffer-prepass" },
      { id: "flight.ao-context-lit", owner: FINAL_IMAGE_FLIGHT_OWNERS.ao, kind: "lit-scene-pass" },
    ],
    shadowSubmissions: [{ id: "flight.bounded-shadow", owner: FINAL_IMAGE_FLIGHT_OWNERS.shadows }],
    computeDispatches: [
      { id: "motion.previous-current-transform", owner: FINAL_IMAGE_FLIGHT_OWNERS.motion },
      { id: "exposure.meter-and-adapt", owner: FINAL_IMAGE_FLIGHT_OWNERS.exposure },
    ],
    submissionCounts: {
      gbufferPrepassCount: datum(1, "scene-submissions", "Authored", "material-context AO architecture"),
      litScenePassCount: datum(1, "scene-submissions", "Authored", "material-context AO architecture"),
      sceneSubmissionCount: datum(2, "scene-submissions", "Derived", "gbuffer prepass plus lit scene pass"),
      fullLitOutputCount: datum(1, "full-lit-outputs", "Authored", "single material-context lit pass"),
    },
    resources: [
      { id: "gbuffer-output", owner: FINAL_IMAGE_FLIGHT_OWNERS.gbuffer, bytes: datum(8 * scenePixels, "bytes", "Derived", "RGBA16F logical allocation at active scene scale") },
      { id: "gbuffer-normal", owner: FINAL_IMAGE_FLIGHT_OWNERS.gbuffer, bytes: datum(8 * scenePixels, "bytes", "Derived", "RGBA16F logical allocation at active scene scale") },
      { id: "gbuffer-emissive", owner: FINAL_IMAGE_FLIGHT_OWNERS.gbuffer, bytes: datum(8 * scenePixels, "bytes", "Derived", "RGBA16F logical allocation at active scene scale") },
      { id: "gbuffer-velocity", owner: FINAL_IMAGE_FLIGHT_OWNERS.gbuffer, bytes: datum(8 * scenePixels, "bytes", "Derived", "RGBA16F logical allocation at active scene scale") },
      { id: "gbuffer-depth", owner: FINAL_IMAGE_FLIGHT_OWNERS.gbuffer, bytes: datum(4 * scenePixels, "bytes", "Derived", "32-bit depth logical allocation at active scene scale") },
      { id: "gtao-visibility", owner: FINAL_IMAGE_FLIGHT_OWNERS.ao, bytes: datum(Math.round(sceneWidth * aoScale) * Math.round(sceneHeight * aoScale), "bytes", "Derived", "one byte per reduced-resolution visibility texel") },
      { id: "bloom-logical-output", owner: FINAL_IMAGE_FLIGHT_OWNERS.bloom, bytes: datum(8 * Math.max(1, Math.round(width * bloomScale)) * Math.max(1, Math.round(height * bloomScale)), "bytes", "Derived", "RGBA16F logical Bloom output; internal pyramid is reported by BloomNode runtime") },
      { id: "pre-grade-hdr", owner: FINAL_IMAGE_FLIGHT_OWNERS.preGradeComposite, bytes: datum(8 * pixels, "bytes", "Derived", "materialized RGBA16F lit-plus-Bloom source shared by metering and presentation") },
      { id: "shadow-diagnostic-target", owner: FINAL_IMAGE_FLIGHT_OWNERS.validation, bytes: datum(8 * pixels, "bytes", "Derived", "RGBA16F diagnostic target reachable only in shadow-contribution mode"), reachable: activeMode === "shadow-contribution" },
      { id: "motion-storage", owner: FINAL_IMAGE_FLIGHT_OWNERS.motion, bytes: datum(motionStorageBytes, "bytes", "Derived", "allocated storage attribute byteLength sum") },
    ],
    preGradeHdrBinding: {
      resourceId: "pre-grade-hdr",
      meterSourceId: "scene.pre-grade-hdr",
      hdrColorSourceId: "scene.pre-grade-hdr",
      sharedNodeIdentity: preGradeHdrSharedIdentity,
    },
    diagnostics: [
      {
        id: "shadow-contribution",
        nodeKind: "ShadowNodeMaterial-pass-texture",
        sourceIds: ["shadow.visibility"],
        reachable: activeMode === "shadow-contribution",
        extraSceneSubmissions: activeMode === "shadow-contribution" ? 1 : 0,
      },
      {
        id: "owner-graph",
        nodeKind: "live-signal-mosaic",
        sourceIds: ["scene.output", "scene.normal", "scene.emissive", "scene.velocity", "ao.visibility", "bloom.hdr", "scene.pre-grade-hdr"],
        reachable: activeMode === "owner-graph",
        extraSceneSubmissions: 0,
      },
    ],
    diagnosticSceneSubmissionCount: datum(activeMode === "shadow-contribution" ? 1 : 0, "scene-submissions", "Derived", "selected diagnostic output reachability"),
    shadowFrameRecord: {
      frameId: shadowDescription?.frameMetrics?.frameId ?? -1,
      recorded: Number.isInteger(shadowDescription?.frameMetrics?.frameId) && shadowDescription.frameMetrics.frameId >= 0,
      source: "shadowOwner.recordFrame(explicitFrameId)",
    },
    qualityGovernor,
    tierConfiguration,
    effectPopulation: {
      active: activeEffectInstances,
      capacity: effectInstanceCapacity,
      allocationStrategy: "hero-capacity-resident; tier mutates InstancedMesh.count without reallocating storage",
    },
    tier,
    activeMode,
    sceneScale: datum(sceneScale, "ratio", "Authored", `${tier} scene scale`),
    aoScale: datum(aoScale, "ratio", "Authored", `${tier} AO tier`),
    bloomScale: datum(bloomScale, "ratio", "Authored", `${tier} Bloom tier`),
    exposureDescription,
    shadowDescription,
    finalToneMapOwner: FINAL_IMAGE_FLIGHT_OWNERS.toneMap,
    finalOutputTransformOwner: FINAL_IMAGE_FLIGHT_OWNERS.outputTransform,
    outputColorTransform: false,
  };
  const result = validateFinalImageFlightGraph(graph);
  if (!result.valid) throw new Error(result.errors.join("; "));
  return graph;
}
