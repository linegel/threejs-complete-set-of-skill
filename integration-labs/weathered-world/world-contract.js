export const WORLD_UNITS_PER_METER = 1;

export const WEATHERED_WORLD_MODES = Object.freeze([
  "final",
  "no-post",
  "weather-envelope",
  "atmosphere",
  "cloud-optical-depth",
  "ocean",
  "bounded-water",
  "precipitation",
  "wetness",
  "snow",
  "vegetation-wind",
  "shadow-contribution",
  "owner-graph",
]);

export const WEATHERED_WORLD_CAMERAS = Object.freeze(["orbit", "horizon", "surface"]);

export const WEATHERED_WORLD_TIERS = Object.freeze({
  hero: Object.freeze({
    id: "hero",
    sceneScale: 1,
    cloudScale: 0.5,
    dprCap: 2,
    atmosphere: "ultra",
    clouds: "ultra",
    ocean: "ultra",
    boundedWater: "ultra",
    weather: "high",
    vegetation: "ultra",
    shadowMapSize: 2048,
    stageBudgetMs: Object.freeze({ world: 4.5, atmosphere: 1.3, clouds: 3, ocean: 2.3, boundedWater: 0.8, weather: 0.8, finalImage: 1 }),
  }),
  balanced: Object.freeze({
    id: "balanced",
    sceneScale: 1,
    // The imported canonical cloud "high" tier is half-linear resolution.
    // Do not advertise a 0.33 scale while executing the unchanged high tier.
    cloudScale: 0.5,
    dprCap: 1.5,
    atmosphere: "high",
    clouds: "high",
    ocean: "high",
    boundedWater: "high",
    weather: "medium",
    vegetation: "high",
    shadowMapSize: 1024,
    stageBudgetMs: Object.freeze({ world: 3.8, atmosphere: 1, clouds: 2.4, ocean: 1.8, boundedWater: 0.6, weather: 0.6, finalImage: 0.9 }),
  }),
  budgeted: Object.freeze({
    id: "budgeted",
    sceneScale: 0.85,
    cloudScale: 0.25,
    dprCap: 1,
    atmosphere: "mobile",
    clouds: "default",
    ocean: "medium",
    boundedWater: "medium",
    weather: "budgeted",
    vegetation: "medium",
    shadowMapSize: 512,
    stageBudgetMs: Object.freeze({ world: 3.1, atmosphere: 0.8, clouds: 1.8, ocean: 1.3, boundedWater: 0.4, weather: 0.4, finalImage: 0.8 }),
  }),
});

export const WEATHERED_WORLD_OWNERS = Object.freeze({
  renderer: "threejs-image-pipeline",
  renderPipeline: "threejs-image-pipeline",
  toneMap: "threejs-image-pipeline",
  outputTransform: "threejs-image-pipeline",
  qualityGovernor: "threejs-image-pipeline",
  cameraJitter: "threejs-image-pipeline",
  timebase: "threejs-rain-snow-and-wet-surfaces",
  worldUnits: "threejs-procedural-planets",
  weatherEnvelope: "threejs-rain-snow-and-wet-surfaces",
  planetSurface: "threejs-procedural-planets",
  atmosphereTransport: "threejs-sky-atmosphere-and-haze",
  cloudTransport: "threejs-volumetric-clouds",
  cloudOpticalShadow: "threejs-volumetric-clouds",
  unboundedWater: "threejs-spectral-ocean",
  boundedWater: "threejs-water-optics",
  vegetation: "threejs-procedural-vegetation",
  opaqueShadow: "threejs-scalable-real-time-shadows",
});

export const WEATHERED_WORLD_SIGNALS = Object.freeze([
  { id: "world.units-per-meter", producer: "threejs-procedural-planets", consumers: ["threejs-sky-atmosphere-and-haze", "threejs-volumetric-clouds", "threejs-spectral-ocean", "threejs-water-optics", "threejs-rain-snow-and-wet-surfaces", "threejs-procedural-vegetation"] },
  { id: "weather.envelope", producer: "threejs-rain-snow-and-wet-surfaces", consumers: ["threejs-volumetric-clouds", "threejs-spectral-ocean", "threejs-water-optics", "threejs-procedural-vegetation", "threejs-image-pipeline"] },
  { id: "cloud.optical-depth-shadow", producer: "threejs-volumetric-clouds", consumers: ["threejs-procedural-planets", "threejs-spectral-ocean", "threejs-procedural-vegetation", "threejs-image-pipeline"] },
  { id: "opaque.shadow-visibility", producer: "threejs-scalable-real-time-shadows", consumers: ["threejs-image-pipeline"] },
  { id: "ocean.unbounded-surface", producer: "threejs-spectral-ocean", consumers: ["threejs-image-pipeline"] },
  { id: "water.bounded-heightfield", producer: "threejs-water-optics", consumers: ["threejs-image-pipeline"] },
  { id: "world.scene-linear-hdr", producer: "threejs-image-pipeline", consumers: ["threejs-sky-atmosphere-and-haze", "threejs-volumetric-clouds", "threejs-image-pipeline"] },
]);

export function requireWeatheredWorldTier(id) {
  const tier = WEATHERED_WORLD_TIERS[id];
  if (!tier) throw new Error(`Unknown Weathered World tier "${id}"`);
  return tier;
}

export function requireWeatheredWorldMode(id) {
  if (!WEATHERED_WORLD_MODES.includes(id)) throw new Error(`Unknown Weathered World mode "${id}"`);
  return id;
}

export function requireWeatheredWorldCamera(id) {
  if (!WEATHERED_WORLD_CAMERAS.includes(id)) throw new Error(`Unknown Weathered World camera "${id}"`);
  return id;
}

export function validateWeatheredWorldContract({
  owners = WEATHERED_WORLD_OWNERS,
  signals = WEATHERED_WORLD_SIGNALS,
  tier = WEATHERED_WORLD_TIERS.balanced,
  worldUnitsPerMeter = WORLD_UNITS_PER_METER,
  stageWorldUnits = {},
  sharedSurfaceRadiusMeters = null,
  stageSurfaceRadii = {},
  sharedWeatherEnvelope = null,
  stageWeatherEnvelopes = {},
} = {}) {
  const errors = [];
  const ownerEntries = Object.entries(owners);
  const exclusiveSemantics = new Set([
    "renderer", "renderPipeline", "toneMap", "outputTransform", "worldUnits",
    "weatherEnvelope", "cloudOpticalShadow", "opaqueShadow", "unboundedWater", "boundedWater",
  ]);
  for (const semantic of exclusiveSemantics) {
    const owner = owners[semantic];
    if (typeof owner !== "string" || owner.length === 0) errors.push(`${semantic} requires exactly one owner`);
    if (Array.isArray(owner)) errors.push(`${semantic} has duplicate owners`);
  }
  if (owners.cloudOpticalShadow === owners.opaqueShadow) {
    errors.push("cloud optical-depth shadows and opaque shadow maps require separate owners");
  }
  if (owners.unboundedWater === owners.boundedWater) {
    errors.push("unbounded ocean and bounded water require separate owners");
  }
  if (!(Number.isFinite(worldUnitsPerMeter) && worldUnitsPerMeter > 0)) {
    errors.push("worldUnitsPerMeter must be finite and positive");
  }
  for (const [stage, value] of Object.entries(stageWorldUnits)) {
    if (value !== worldUnitsPerMeter) errors.push(`${stage} worldUnitsPerMeter ${value} differs from ${worldUnitsPerMeter}`);
  }
  if (sharedSurfaceRadiusMeters !== null) {
    if (!(Number.isFinite(sharedSurfaceRadiusMeters) && sharedSurfaceRadiusMeters > 0)) {
      errors.push("sharedSurfaceRadiusMeters must be finite and positive");
    }
    for (const [stage, value] of Object.entries(stageSurfaceRadii)) {
      if (value !== sharedSurfaceRadiusMeters) errors.push(`${stage} surface radius ${value} differs from ${sharedSurfaceRadiusMeters}`);
    }
  }
  if (sharedWeatherEnvelope !== null) {
    for (const [stage, envelope] of Object.entries(stageWeatherEnvelopes)) {
      if (envelope !== sharedWeatherEnvelope) errors.push(`${stage} consumes a private weather envelope`);
    }
  }
  const signalIds = new Set();
  const knownOwners = new Set(Object.values(owners).flat());
  for (const signal of signals) {
    if (signalIds.has(signal.id)) errors.push(`duplicate signal ${signal.id}`);
    signalIds.add(signal.id);
    if (typeof signal.producer !== "string" || signal.producer.length === 0) errors.push(`${signal.id} has no producer`);
    else if (!knownOwners.has(signal.producer)) errors.push(`${signal.id} producer ${signal.producer} is not a declared owner`);
    if (!Array.isArray(signal.consumers)) errors.push(`${signal.id} consumers must be an array`);
  }
  if (owners.renderer !== owners.renderPipeline || owners.renderer !== owners.toneMap || owners.renderer !== owners.outputTransform) {
    errors.push("renderer, RenderPipeline, tone map, and output transform must share the image-pipeline host owner");
  }
  const budgetSumMs = Object.values(tier.stageBudgetMs ?? {}).reduce((sum, value) => sum + value, 0);
  if (budgetSumMs > 16.67 + 1e-9) errors.push(`${tier.id} stage budget sum ${budgetSumMs} exceeds 16.67 ms`);
  return {
    ok: errors.length === 0,
    errors,
    ownerEntries,
    budgetSumMs,
    finalHdrEquation: "sceneAtmosphereHDR * cloudTransmittance + cloudRadiance",
  };
}

export function createOwnerGraphManifest({ tier, resources = [], dispatches = [], sceneSubmissions = [] }) {
  return {
    owners: { ...WEATHERED_WORLD_OWNERS },
    signals: WEATHERED_WORLD_SIGNALS.map((signal) => ({ ...signal })),
    sceneSubmissions,
    computeDispatches: dispatches,
    resources,
    tier: tier.id,
    worldUnitsPerMeter: {
      value: WORLD_UNITS_PER_METER,
      unit: "world-units-per-meter",
      label: "Authored",
      source: "Weathered World shared physical-scale contract",
    },
    outputColorTransform: false,
    finalToneMapOwner: "threejs-image-pipeline",
    finalOutputTransformOwner: "threejs-image-pipeline",
    finalHdrEquation: "sceneAtmosphereHDR * cloudTransmittance + cloudRadiance",
  };
}
