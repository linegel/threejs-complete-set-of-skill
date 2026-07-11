export const DISTRICT_ID = "procedural-district";

export const DISTRICT_WORLD_EXTENT = Object.freeze({
  minX: -96,
  maxX: 96,
  minZ: -96,
  maxZ: 96,
  y: 0,
});

export const DISTRICT_FIELD_COORDINATE_CONTRACT = Object.freeze({
  id: "district-world-xz-to-field-xz-v1",
  sourceSpace: "district-world-xz",
  targetSpace: "canonical-field-world-domain",
  worldToFieldScale: 0.125,
  jacobian: Object.freeze([
    Object.freeze([0.125, 0]),
    Object.freeze([0, 0.125]),
  ]),
  fieldDomain: Object.freeze({
    minX: -12,
    maxX: 12,
    minZ: -12,
    maxZ: 12,
    y: 0,
  }),
});

const DISTRICT_FIELD_CONSUMERS = Object.freeze([
  "gpu-field-bake",
  "material-field-sampling",
  "cpu-terrain-topology",
  "cpu-building-placement",
]);

export function createDistrictFieldCoordinateClaims() {
  return DISTRICT_FIELD_CONSUMERS.map((consumer) => ({
    consumer,
    transformId: DISTRICT_FIELD_COORDINATE_CONTRACT.id,
    sourceSpace: DISTRICT_FIELD_COORDINATE_CONTRACT.sourceSpace,
    targetSpace: DISTRICT_FIELD_COORDINATE_CONTRACT.targetSpace,
    worldToFieldScale: DISTRICT_FIELD_COORDINATE_CONTRACT.worldToFieldScale,
    jacobian: DISTRICT_FIELD_COORDINATE_CONTRACT.jacobian.map((row) => [...row]),
    fieldDomain: { ...DISTRICT_FIELD_COORDINATE_CONTRACT.fieldDomain },
  }));
}

export const DISTRICT_SCENARIOS = Object.freeze(["district"]);
export const DISTRICT_MODES = Object.freeze([
  "final",
  "no-post",
  "shared-field",
  "facade-ownership",
  "material-slots",
  "weather-state",
  "shadow-contribution",
  "ao",
  "owner-graph",
]);
export const DISTRICT_CAMERAS = Object.freeze(["street", "district", "aerial"]);
export const DISTRICT_SEEDS = Object.freeze([0x00000001, 0x9e3779b9]);
export const DISTRICT_MECHANISMS = Object.freeze([
  "shared-cause-field",
  "structural-topology",
  "facade-ownership",
  "material-slot-weather",
  "ao-shadow-order",
  "owner-graph",
]);

export const DISTRICT_MECHANISM_MODES = Object.freeze({
  "shared-cause-field": "shared-field",
  "structural-topology": "shared-field",
  "facade-ownership": "facade-ownership",
  "material-slot-weather": "weather-state",
  "ao-shadow-order": "shadow-contribution",
  "owner-graph": "owner-graph",
});

export const DISTRICT_MODE_CODES = Object.freeze(Object.fromEntries(
  DISTRICT_MODES.map((id, index) => [id, index]),
));

export const DISTRICT_TIERS = Object.freeze({
  hero: Object.freeze({
    id: "hero",
    fieldExtent: 256,
    terrainSegments: 64,
    buildingCount: 9,
    buildingTier: "hero",
    aoTier: "ultra",
    shadowTier: "ultra",
    shadowMapSize: 2048,
    dprCap: 2,
    sceneScale: 1,
  }),
  balanced: Object.freeze({
    id: "balanced",
    fieldExtent: 128,
    terrainSegments: 48,
    buildingCount: 7,
    buildingTier: "city",
    aoTier: "high",
    shadowTier: "high",
    shadowMapSize: 1024,
    dprCap: 1.5,
    sceneScale: 1,
  }),
  budgeted: Object.freeze({
    id: "budgeted",
    fieldExtent: 64,
    terrainSegments: 32,
    buildingCount: 5,
    buildingTier: "distant",
    aoTier: "medium",
    shadowTier: "reduced",
    shadowMapSize: 512,
    dprCap: 1,
    sceneScale: 0.85,
  }),
});

export const DISTRICT_EXCLUSIVE_OWNERS = Object.freeze({
  renderer: "threejs-image-pipeline",
  "final-render-pipeline": "threejs-image-pipeline",
  "tone-map": "threejs-image-pipeline",
  "output-transform": "threejs-image-pipeline",
  "quality-governor": "threejs-image-pipeline",
  timebase: "threejs-rain-snow-and-wet-surfaces",
  "camera-jitter": "threejs-image-pipeline",
  "shared-cause-field": "threejs-procedural-fields",
  "structural-topology": "threejs-procedural-geometry",
  "building-grammar": "threejs-procedural-buildings-and-cities",
  "material-identity": "threejs-procedural-materials",
  "weather-state": "threejs-rain-snow-and-wet-surfaces",
  "shadow-maps": "threejs-scalable-real-time-shadows",
  "ao-visibility": "threejs-ambient-contact-shading",
});

export const DISTRICT_VALIDATION_CODES = Object.freeze({
  DUPLICATE_FACADE: "DUPLICATE_FACADE_OWNERSHIP",
  DUPLICATE_PASS: "DUPLICATE_FULL_SCENE_PASS",
  DUPLICATE_OWNER: "DUPLICATE_EXCLUSIVE_OWNER",
  DUPLICATE_SIGNAL: "DUPLICATE_SIGNAL_PRODUCER",
  PRIVATE_FIELD: "PRIVATE_CAUSE_FIELD",
  MATERIAL_OWNER: "CONFLICTING_MATERIAL_OWNER",
  GEOMETRY_REBUILT: "STATIC_GEOMETRY_REGENERATED",
  FIELD_DOMAIN_DRIFT: "FIELD_DOMAIN_COORDINATE_DRIFT",
  ROUTE_LOCK_BYPASS: "DISTRICT_ROUTE_LOCK_BYPASS",
});

function requireOneOf(id, values, kind) {
  if (!values.includes(id)) throw new RangeError(`Unknown district ${kind}: ${id}`);
  return id;
}

export const requireDistrictScenario = (id) => requireOneOf(id, DISTRICT_SCENARIOS, "scenario");
export const requireDistrictMode = (id) => requireOneOf(id, DISTRICT_MODES, "mode");
export const requireDistrictCamera = (id) => requireOneOf(id, DISTRICT_CAMERAS, "camera");
export const requireDistrictMechanism = (id) => requireOneOf(id, DISTRICT_MECHANISMS, "mechanism");

export function requireDistrictTier(id) {
  const tier = DISTRICT_TIERS[id];
  if (!tier) throw new RangeError(`Unknown district tier: ${id}`);
  return tier;
}

export function requireDistrictSeed(seed) {
  if (!Number.isInteger(seed) || !DISTRICT_SEEDS.includes(seed >>> 0)) {
    throw new RangeError(`Unknown district seed: ${seed}`);
  }
  return seed >>> 0;
}

export function normalizeDistrictRouteLocks(locks = {}) {
  if (!locks || typeof locks !== "object" || Array.isArray(locks)) throw new TypeError("District route locks must be an object.");
  const normalized = {};
  if (locks.scenario != null) normalized.scenario = requireDistrictScenario(locks.scenario);
  if (locks.mode != null) normalized.mode = requireDistrictMode(locks.mode);
  if (locks.tier != null) normalized.tier = requireDistrictTier(locks.tier).id;
  if (locks.mechanism != null) normalized.mechanism = requireDistrictMechanism(locks.mechanism);
  return Object.freeze(normalized);
}

export function assertDistrictRouteLock(locks, kind, value) {
  const expected = locks?.[kind];
  if (expected !== undefined && value !== expected) {
    throw new Error(`${DISTRICT_VALIDATION_CODES.ROUTE_LOCK_BYPASS}: ${kind} is locked to ${expected}; received ${value}`);
  }
  return value;
}

function numericBytes(value, source) {
  return { value, unit: "bytes", label: "Derived", source };
}

function signal(id, producer, consumers, reachable = true, encoding = undefined) {
  const record = { id, producer, consumers, reachable };
  if (encoding) record.encoding = encoding;
  return record;
}

export function createDistrictRuntimeGraph({
  mode = "final",
  tier = "balanced",
  resources = [],
  fieldDispatches = [],
} = {}) {
  requireDistrictMode(mode);
  requireDistrictTier(tier);
  const noPost = mode === "no-post";
  const usesAoLitPass = !noPost;
  const usesAoInputs = !noPost;

  const sceneSubmissions = [
    {
      id: "district-shadow-map",
      owner: "threejs-scalable-real-time-shadows",
      kind: "shadow",
      reachable: true,
      shadowViewCount: 1,
    },
    {
      id: "district-gbuffer-prepass",
      owner: "threejs-image-pipeline",
      kind: noPost ? "lit-scene" : "prepass",
      reachable: true,
      role: noPost ? "no-post full-lit output" : "AO depth/normal/velocity input",
      outputs: noPost
        ? ["district.no-post-hdr"]
        : ["district.depth", "district.normal", "district.velocity"],
    },
    {
      id: "district-ao-lit-scene",
      owner: "threejs-image-pipeline",
      kind: "lit-scene",
      reachable: usesAoLitPass,
      outputs: ["district.scene-hdr"],
    },
    {
      id: "district-gtao",
      owner: "threejs-ambient-contact-shading",
      kind: "post",
      reachable: usesAoInputs,
    },
    {
      id: "district-display-readback",
      owner: "threejs-image-pipeline",
      kind: "post",
      reachable: true,
    },
    {
      id: "district-present",
      owner: "threejs-image-pipeline",
      kind: "present",
      reachable: true,
    },
  ];

  return {
    schemaVersion: 2,
    owners: { ...DISTRICT_EXCLUSIVE_OWNERS },
    signals: [
      signal("district.cause-field", "threejs-procedural-fields", [
        "threejs-procedural-geometry",
        "threejs-procedural-buildings-and-cities",
        "threejs-procedural-materials",
        "threejs-rain-snow-and-wet-surfaces",
        "threejs-image-pipeline",
      ], true, "rgba16float packed+derived storage textures"),
      signal("district.structural-topology", "threejs-procedural-geometry", [
        "threejs-procedural-buildings-and-cities",
        "threejs-scalable-real-time-shadows",
        "threejs-image-pipeline",
      ]),
      signal("district.compiled-buildings", "threejs-procedural-buildings-and-cities", [
        "threejs-procedural-materials",
        "threejs-scalable-real-time-shadows",
        "threejs-image-pipeline",
      ]),
      signal("district.material-slots", "threejs-procedural-materials", [
        "threejs-scalable-real-time-shadows",
        "threejs-image-pipeline",
      ]),
      signal("district.weather-response", "threejs-rain-snow-and-wet-surfaces", [
        "threejs-procedural-materials",
        "threejs-image-pipeline",
      ]),
      signal("district.depth", "threejs-image-pipeline", ["threejs-ambient-contact-shading"], usesAoInputs, "depth texture"),
      signal("district.normal", "threejs-image-pipeline", ["threejs-ambient-contact-shading"], usesAoInputs, "view normal"),
      signal("district.velocity", "threejs-image-pipeline", ["threejs-ambient-contact-shading"], usesAoInputs, "current-minus-previous NDC"),
      signal("district.ao", "threejs-ambient-contact-shading", ["threejs-image-pipeline"], usesAoInputs, "scalar indirect visibility"),
      signal("district.shadow", "threejs-scalable-real-time-shadows", ["threejs-image-pipeline"], true, "comparison depth"),
      signal("district.scene-hdr", "threejs-image-pipeline", ["threejs-image-pipeline"], usesAoLitPass, "scene-linear HDR"),
      signal("district.no-post-hdr", "threejs-image-pipeline", ["threejs-image-pipeline"], noPost, "scene-linear HDR"),
    ],
    sceneSubmissions,
    computeDispatches: fieldDispatches.map((dispatch) => ({
      id: dispatch.id,
      owner: "threejs-procedural-fields",
      workgroups: {
        values: [...dispatch.workgroups],
        unit: "workgroups",
        label: "Derived",
        source: dispatch.source,
      },
      reachable: dispatch.reachable !== false,
    })),
    resources: resources.map((resource) => ({
      id: resource.id,
      owner: resource.owner,
      kind: resource.kind,
      residentBytes: resource.residentBytes ?? numericBytes(resource.bytes, resource.source),
      ...(resource.reachable === undefined ? {} : { reachable: resource.reachable }),
    })),
    finalToneMapOwner: "threejs-image-pipeline/renderOutput",
    finalOutputTransformOwner: "threejs-image-pipeline/renderOutput",
  };
}

export function createDistrictValidationSnapshot({
  facadeOwnershipKeys = [],
  fieldIdentity = "district-shared-cause-field",
  geometryBuildCount = 1,
  geometryDigest = "unbuilt",
  fieldCoordinateClaims = createDistrictFieldCoordinateClaims(),
} = {}) {
  const graph = createDistrictRuntimeGraph({ mode: "final", tier: "balanced" });
  return {
    ownerClaims: Object.entries(DISTRICT_EXCLUSIVE_OWNERS).map(([semantic, owner]) => ({ semantic, owner })),
    signalClaims: graph.signals.map(({ id, producer }) => ({ id, producer })),
    passes: graph.sceneSubmissions.map(({ id, kind, reachable }) => ({ id, kind, reachable })),
    facadeOwnershipKeys: [...facadeOwnershipKeys],
    causeFieldIdentities: [fieldIdentity],
    fieldCoordinateClaims: fieldCoordinateClaims.map((claim) => structuredClone(claim)),
    materialOwnerClaims: ["threejs-procedural-materials"],
    geometryBeforeWeather: { buildCount: geometryBuildCount, digest: geometryDigest },
    geometryAfterWeather: { buildCount: geometryBuildCount, digest: geometryDigest },
  };
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function validateDistrictSnapshot(snapshot) {
  const errors = [];
  const ownerGroups = new Map();
  for (const claim of snapshot.ownerClaims ?? []) {
    const owners = ownerGroups.get(claim.semantic) ?? new Set();
    owners.add(claim.owner);
    ownerGroups.set(claim.semantic, owners);
  }
  for (const [semantic, owners] of ownerGroups) {
    if (owners.size > 1) errors.push({ code: DISTRICT_VALIDATION_CODES.DUPLICATE_OWNER, semantic, owners: [...owners] });
  }

  const signalGroups = new Map();
  for (const claim of snapshot.signalClaims ?? []) {
    const producers = signalGroups.get(claim.id) ?? new Set();
    producers.add(claim.producer);
    signalGroups.set(claim.id, producers);
  }
  for (const [id, producers] of signalGroups) {
    if (producers.size > 1) errors.push({ code: DISTRICT_VALIDATION_CODES.DUPLICATE_SIGNAL, id, producers: [...producers] });
  }

  const duplicateFacades = duplicateValues(snapshot.facadeOwnershipKeys ?? []);
  if (duplicateFacades.length) errors.push({ code: DISTRICT_VALIDATION_CODES.DUPLICATE_FACADE, keys: duplicateFacades });

  const reachableScenePasses = (snapshot.passes ?? []).filter((entry) => entry.reachable !== false && ["prepass", "lit-scene"].includes(entry.kind));
  const prepasses = reachableScenePasses.filter((entry) => entry.kind === "prepass");
  const litPasses = reachableScenePasses.filter((entry) => entry.kind === "lit-scene");
  if (prepasses.length !== 1 || litPasses.length !== 1 || reachableScenePasses.length !== 2) {
    errors.push({
      code: DISTRICT_VALIDATION_CODES.DUPLICATE_PASS,
      prepassCount: prepasses.length,
      litScenePassCount: litPasses.length,
      sceneSubmissionCount: reachableScenePasses.length,
    });
  }

  if (new Set(snapshot.causeFieldIdentities ?? []).size !== 1 || (snapshot.causeFieldIdentities ?? []).length !== 1) {
    errors.push({ code: DISTRICT_VALIDATION_CODES.PRIVATE_FIELD, identities: snapshot.causeFieldIdentities ?? [] });
  }

  const coordinateClaims = snapshot.fieldCoordinateClaims ?? [];
  const expectedConsumers = new Set(DISTRICT_FIELD_CONSUMERS);
  const actualConsumers = new Set(coordinateClaims.map((claim) => claim.consumer));
  const coordinateSignatures = new Set(coordinateClaims.map((claim) => JSON.stringify({
    transformId: claim.transformId,
    sourceSpace: claim.sourceSpace,
    targetSpace: claim.targetSpace,
    worldToFieldScale: claim.worldToFieldScale,
    jacobian: claim.jacobian,
    fieldDomain: claim.fieldDomain,
  })));
  const expectedSignature = JSON.stringify({
    transformId: DISTRICT_FIELD_COORDINATE_CONTRACT.id,
    sourceSpace: DISTRICT_FIELD_COORDINATE_CONTRACT.sourceSpace,
    targetSpace: DISTRICT_FIELD_COORDINATE_CONTRACT.targetSpace,
    worldToFieldScale: DISTRICT_FIELD_COORDINATE_CONTRACT.worldToFieldScale,
    jacobian: DISTRICT_FIELD_COORDINATE_CONTRACT.jacobian,
    fieldDomain: DISTRICT_FIELD_COORDINATE_CONTRACT.fieldDomain,
  });
  if (
    coordinateClaims.length !== DISTRICT_FIELD_CONSUMERS.length ||
    [...expectedConsumers].some((consumer) => !actualConsumers.has(consumer)) ||
    coordinateSignatures.size !== 1 ||
    !coordinateSignatures.has(expectedSignature)
  ) {
    errors.push({
      code: DISTRICT_VALIDATION_CODES.FIELD_DOMAIN_DRIFT,
      expected: createDistrictFieldCoordinateClaims(),
      actual: coordinateClaims,
    });
  }
  if (new Set(snapshot.materialOwnerClaims ?? []).size !== 1 || (snapshot.materialOwnerClaims ?? []).length !== 1) {
    errors.push({ code: DISTRICT_VALIDATION_CODES.MATERIAL_OWNER, owners: snapshot.materialOwnerClaims ?? [] });
  }

  const before = snapshot.geometryBeforeWeather ?? {};
  const after = snapshot.geometryAfterWeather ?? {};
  if (before.buildCount !== after.buildCount || before.digest !== after.digest) {
    errors.push({ code: DISTRICT_VALIDATION_CODES.GEOMETRY_REBUILT, before, after });
  }

  return { ok: errors.length === 0, errors };
}

export function assertDistrictSnapshot(snapshot) {
  const result = validateDistrictSnapshot(snapshot);
  if (!result.ok) {
    const error = new Error(result.errors.map((entry) => entry.code).join(", "));
    error.errors = result.errors;
    throw error;
  }
  return result;
}
