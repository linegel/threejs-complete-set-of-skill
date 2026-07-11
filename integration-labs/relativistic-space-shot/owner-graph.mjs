const REQUIRED_OWNER = Object.freeze({
  renderer: "threejs-image-pipeline",
  finalRenderPipeline: "threejs-image-pipeline",
  cameraJitter: "threejs-image-pipeline",
  temporalHistory: "threejs-image-pipeline",
  toneMap: "threejs-image-pipeline",
  outputTransform: "threejs-image-pipeline",
  curvedRayTransport: "threejs-black-holes-and-space-effects",
  particlePools: "threejs-particles-trails-and-effects",
  motionEvents: "threejs-procedural-motion-systems",
  cameraState: "threejs-camera-controls-and-rigs",
});

function numeric(value, unit, label, source) {
  return { value, unit, label, source };
}

export function createRelativisticSpaceShotGraph({
  width,
  height,
  tier,
  activeMode,
  spaceDescription = {},
  particleDescription = {},
  bloomDescription = {},
  imageDescription = {},
  motionDescription = {},
  cameraDescription = {},
} = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("runtime graph extent must contain positive integer dimensions");
  }
  return {
    schemaVersion: 2,
    id: "relativistic-space-shot-runtime",
    tier,
    activeMode,
    rendererOwners: ["threejs-image-pipeline"],
    ownerClaims: Object.entries(REQUIRED_OWNER).map(([semantic, owner]) => ({ semantic, owner })),
    signals: [
      { id: "camera.current-previous", producer: "threejs-camera-controls-and-rigs", consumers: ["threejs-black-holes-and-space-effects", "threejs-image-pipeline"] },
      { id: "motion.event-packets", producer: "threejs-procedural-motion-systems", consumers: ["threejs-particles-trails-and-effects"] },
      { id: "scene.hdr", producer: "threejs-image-pipeline", consumers: ["threejs-image-pipeline"] },
      { id: "scene.depth", producer: "threejs-image-pipeline", consumers: ["threejs-image-pipeline"] },
      { id: "scene.velocity", producer: "threejs-image-pipeline", consumers: ["threejs-image-pipeline"] },
      { id: "scene.emissive", producer: "threejs-image-pipeline", consumers: ["threejs-bloom"] },
      { id: "scene.bloom", producer: "threejs-bloom", consumers: ["threejs-image-pipeline"] },
      { id: "scene.pregrade", producer: "threejs-image-pipeline", consumers: ["threejs-exposure-color-grading"] },
      { id: "scene.temporal", producer: "threejs-image-pipeline", consumers: ["threejs-image-pipeline"] },
      { id: "scene.exposure", producer: "threejs-exposure-color-grading", consumers: ["threejs-image-pipeline"] },
    ],
    sceneSubmissions: [
      { id: "relativistic-space-shot.primary", owner: "threejs-image-pipeline", kind: "curved-ray-and-particles", outputs: ["scene.hdr", "scene.depth", "scene.velocity", "scene.emissive"] },
    ],
    computeDispatches: [
      { id: "particles.compaction", owner: "threejs-particles-trails-and-effects", kind: "ping-pong-storage" },
      { id: "exposure.meter-adapt", owner: "threejs-exposure-color-grading", kind: "gpu-resident-meter-state" },
    ],
    resources: [
      { id: "scene.hdr", owner: "threejs-image-pipeline", dimensions: [width, height], bytes: numeric(width * height * 8, "bytes", "Derived", "RGBA16F payload") },
      { id: "scene.depth", owner: "threejs-image-pipeline", dimensions: [width, height], bytes: null, verdict: "INSUFFICIENT_EVIDENCE" },
      { id: "scene.velocity", owner: "threejs-image-pipeline", dimensions: [width, height], bytes: null, verdict: "INSUFFICIENT_EVIDENCE" },
      { id: "scene.emissive", owner: "threejs-image-pipeline", dimensions: [width, height], bytes: numeric(width * height * 8, "bytes", "Derived", "RGBA16F payload") },
      { id: "TRAA.history", owner: "threejs-image-pipeline", bytes: null, verdict: "INSUFFICIENT_EVIDENCE" },
      { id: "BloomNode.private-targets", owner: "threejs-bloom", bytes: null, verdict: "INSUFFICIENT_EVIDENCE" },
      { id: "particle-ping-pong", owner: "threejs-particles-trails-and-effects", bytes: null, verdict: "INSUFFICIENT_EVIDENCE" },
    ],
    stageOwnership: {
      space: spaceDescription,
      particles: particleDescription,
      bloom: bloomDescription,
      image: imageDescription,
      motion: motionDescription,
      camera: cameraDescription,
    },
    bloomInputSignal: bloomDescription.inputSignal ?? "scene.emissive",
    exposureMeterSourceSignal: "scene.pregrade",
    temporalOwner: "threejs-image-pipeline",
    finalToneMapOwner: "threejs-image-pipeline",
    finalOutputTransformOwner: "threejs-image-pipeline",
    outputColorTransform: false,
    compositionOrder: [
      "motion-event-update",
      "particle-compute",
      "single-primary-scene-mrt",
      "single-traa-history",
      "shared-emissive-bloom",
      "materialize-composed-pregrade-hdr",
      "gpu-exposure",
      "tone-map",
      "output-transform",
    ],
    runtimeClaims: {
      nativeWebGPU: "runtime-gated",
      gpuTiming: "INSUFFICIENT_EVIDENCE",
      lifecycle: "INSUFFICIENT_EVIDENCE",
    },
  };
}

export function validateRelativisticSpaceShotGraph(graph) {
  const errors = [];
  if (graph.rendererOwners?.length !== 1 || graph.rendererOwners[0] !== REQUIRED_OWNER.renderer) {
    errors.push("runtime graph requires exactly one renderer owner");
  }
  const seenOwners = new Map();
  for (const claim of graph.ownerClaims ?? []) {
    if (seenOwners.has(claim.semantic)) errors.push(`duplicate ownership: ${claim.semantic}`);
    seenOwners.set(claim.semantic, claim.owner);
  }
  for (const [semantic, owner] of Object.entries(REQUIRED_OWNER)) {
    if (seenOwners.get(semantic) !== owner) errors.push(`incorrect or missing owner: ${semantic}`);
  }
  if (graph.sceneSubmissions?.length !== 1) errors.push("runtime graph requires exactly one primary scene submission");
  const signalProducers = new Map();
  for (const signal of graph.signals ?? []) {
    if (!signal.producer) errors.push(`signal ${signal.id} has no producer`);
    if (signalProducers.has(signal.id)) errors.push(`duplicate signal producer: ${signal.id}`);
    signalProducers.set(signal.id, signal.producer);
  }
  for (const id of ["scene.hdr", "scene.depth", "scene.velocity", "scene.emissive", "scene.bloom", "scene.pregrade", "scene.temporal", "scene.exposure"]) {
    if (!signalProducers.has(id)) errors.push(`required signal is missing: ${id}`);
  }
  if (graph.bloomInputSignal !== "scene.emissive") errors.push("BloomNode must consume the shared scene.emissive signal");
  if (graph.exposureMeterSourceSignal !== "scene.pregrade") errors.push("exposure must meter the composed pre-grade signal");
  if (graph.temporalOwner !== REQUIRED_OWNER.temporalHistory) errors.push("temporal history must have one image-pipeline owner");
  if (graph.finalToneMapOwner !== REQUIRED_OWNER.toneMap) errors.push("tone map must have one image-pipeline owner");
  if (graph.finalOutputTransformOwner !== REQUIRED_OWNER.outputTransform) errors.push("output transform must have one image-pipeline owner");
  if (graph.outputColorTransform !== false) errors.push("explicit renderOutput ownership requires RenderPipeline.outputColorTransform false");
  for (const [id, stage] of Object.entries(graph.stageOwnership ?? {})) {
    if (["space", "particles"].includes(id) && (stage.rendererOwner !== "host" || stage.outputOwner !== "host")) {
      errors.push(`${id} stage attempted private renderer or output ownership`);
    }
  }
  return { valid: errors.length === 0, errors };
}
