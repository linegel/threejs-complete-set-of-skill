const BOOLEAN_REQUIREMENTS = Object.freeze([
  "fixedPerceptualShot",
  "localInteractiveDisturbances",
  "bathymetricShoalingRefraction",
  "wetDryRunup",
  "massMomentumConservation",
  "horizonDirectionalSea",
  "islandDiffractionOrSheltering",
]);

export const WATER_ROUTE_SCORE_AXES = Object.freeze({
  observableCoverage: 5,
  physicalTruth: 5,
  controllability: 3,
  mobileBandwidth: 4,
  runtimeCost: 4,
  memoryCost: 3,
  integrationRisk: 3,
  scaleFit: 4,
});

export const WATER_ROUTE_CANDIDATES = Object.freeze([
  Object.freeze({
    id: "phase-locked-coast-bands",
    owner: "analytic coast-SDF presentation",
    capabilities: Object.freeze(["fixedPerceptualShot"]),
    forbiddenClaims: Object.freeze(["mass", "momentum", "diffraction", "runup", "interactive-wakes"]),
    base: Object.freeze({ physicalTruth: 2, controllability: 5, mobileBandwidth: 5, runtimeCost: 5, memoryCost: 5, integrationRisk: 5, scaleFit: 3 }),
    resourceModel: "coast SDF + nearest-coast coordinate + phase bands; no solver state",
  }),
  Object.freeze({
    id: "bounded-linear-heightfield",
    owner: "bounded StorageTexture wave grid",
    capabilities: Object.freeze(["fixedPerceptualShot", "localInteractiveDisturbances"]),
    forbiddenClaims: Object.freeze(["wet-dry-runup", "hydraulic-jumps", "mass-momentum-flow", "overturning"]),
    base: Object.freeze({ physicalTruth: 3, controllability: 5, mobileBandwidth: 3, runtimeCost: 4, memoryCost: 4, integrationRisk: 4, scaleFit: 2 }),
    resourceModel: "two wave-state textures + derivative state; bounded domain only",
  }),
  Object.freeze({
    id: "wave-action-mild-slope",
    owner: "depth-aware coastal wave transport",
    capabilities: Object.freeze(["fixedPerceptualShot", "bathymetricShoalingRefraction", "islandDiffractionOrSheltering"]),
    forbiddenClaims: Object.freeze(["wet-dry-runup", "bulk-current", "mass-momentum-flow"]),
    base: Object.freeze({ physicalTruth: 4, controllability: 4, mobileBandwidth: 4, runtimeCost: 3, memoryCost: 4, integrationRisk: 3, scaleFit: 4 }),
    resourceModel: "offline or reduced-cadence action/direction field + independently phase-owned crests",
  }),
  Object.freeze({
    id: "sparse-saint-venant",
    owner: "sparse conservative coastal wet/dry solver",
    capabilities: Object.freeze(["fixedPerceptualShot", "localInteractiveDisturbances", "bathymetricShoalingRefraction", "wetDryRunup", "massMomentumConservation", "islandDiffractionOrSheltering"]),
    forbiddenClaims: Object.freeze(["overturning", "breaking-jet-geometry", "deep-water-dispersion"]),
    base: Object.freeze({ physicalTruth: 5, controllability: 4, mobileBandwidth: 2, runtimeCost: 2, memoryCost: 2, integrationRisk: 2, scaleFit: 3 }),
    resourceModel: "active tiles + halos + canonical face flux + wet/dry state + transactional coupling ledgers",
  }),
  Object.freeze({
    id: "spectral-offshore-ocean",
    owner: "directional FFT cascade ocean",
    capabilities: Object.freeze(["fixedPerceptualShot", "horizonDirectionalSea"]),
    forbiddenClaims: Object.freeze(["island-diffraction", "wet-dry-runup", "bulk-flow", "local-conserved-wakes"]),
    base: Object.freeze({ physicalTruth: 4, controllability: 4, mobileBandwidth: 1, runtimeCost: 2, memoryCost: 2, integrationRisk: 3, scaleFit: 5 }),
    resourceModel: "periodic FFT cascades + spectral derivatives; homogeneous deep/open water",
  }),
  Object.freeze({
    id: "spectral-coastal-handoff",
    owner: "spectral offshore donor + sparse coastal receiver",
    capabilities: Object.freeze(BOOLEAN_REQUIREMENTS),
    forbiddenClaims: Object.freeze(["overturning", "unvalidated-two-owner-crossfade"]),
    base: Object.freeze({ physicalTruth: 5, controllability: 4, mobileBandwidth: 1, runtimeCost: 1, memoryCost: 1, integrationRisk: 1, scaleFit: 5 }),
    resourceModel: "FFT donor + conservative boundary adapter + sparse coastal state; exactly one surface/reaction owner per region",
  }),
]);

function assertWorkload(workload) {
  if (!workload || typeof workload !== "object") throw new Error("Water workload must be an object.");
  for (const key of BOOLEAN_REQUIREMENTS) {
    if (workload[key] !== undefined && workload[key] !== true && workload[key] !== false) {
      throw new Error(`Water workload ${key} must be boolean when present.`);
    }
  }
  if (workload.preferLowBandwidth !== undefined && typeof workload.preferLowBandwidth !== "boolean") {
    throw new Error("Water workload preferLowBandwidth must be boolean when present.");
  }
  if (workload.offlinePrecomputeAllowed !== undefined && typeof workload.offlinePrecomputeAllowed !== "boolean") {
    throw new Error("Water workload offlinePrecomputeAllowed must be boolean when present.");
  }
}

function requiredObservables(workload) {
  return BOOLEAN_REQUIREMENTS.filter((name) => workload[name] === true);
}

function scoreCandidate(candidate, workload, required) {
  const missing = required.filter((name) => !candidate.capabilities.includes(name));
  const hardRejected = missing.length > 0;
  const axis = {
    observableCoverage: required.length === 0 ? 5 : 5 * (required.length - missing.length) / required.length,
    ...candidate.base,
  };

  if (workload.preferLowBandwidth === true) {
    axis.mobileBandwidth = Math.min(5, axis.mobileBandwidth + (candidate.id === "phase-locked-coast-bands" || candidate.id === "wave-action-mild-slope" ? 1 : 0));
  }
  if (workload.offlinePrecomputeAllowed === false && candidate.id === "wave-action-mild-slope") {
    axis.runtimeCost = Math.max(0, axis.runtimeCost - 2);
    axis.integrationRisk = Math.max(0, axis.integrationRisk - 1);
  }
  if (workload.fixedPerceptualShot === true && required.length === 1 && candidate.id === "phase-locked-coast-bands") {
    axis.scaleFit = 5;
    axis.physicalTruth = 4;
  }

  const weightedTotal = Object.entries(WATER_ROUTE_SCORE_AXES)
    .reduce((total, [name, weight]) => total + axis[name] * weight, 0);
  const maximumTotal = Object.values(WATER_ROUTE_SCORE_AXES).reduce((total, weight) => total + 5 * weight, 0);
  return Object.freeze({
    id: candidate.id,
    owner: candidate.owner,
    hardRejected,
    missing: Object.freeze(missing),
    score: Number((100 * weightedTotal / maximumTotal).toFixed(2)),
    axes: Object.freeze(Object.fromEntries(Object.entries(axis).map(([key, value]) => [key, Number(value.toFixed(2))]))),
    resourceModel: candidate.resourceModel,
    forbiddenClaims: candidate.forbiddenClaims,
  });
}

export function selectWaterArchitecture(workload = {}) {
  assertWorkload(workload);
  const required = requiredObservables(workload);
  const ranking = WATER_ROUTE_CANDIDATES
    .map((candidate) => scoreCandidate(candidate, workload, required))
    .sort((a, b) => Number(a.hardRejected) - Number(b.hardRejected) || b.score - a.score || a.id.localeCompare(b.id));
  const selected = ranking.find((entry) => !entry.hardRejected) ?? null;
  if (!selected) {
    throw new Error(`No canonical water architecture covers required observables: ${required.join(", ") || "none"}.`);
  }

  const composite = selected.id === "spectral-coastal-handoff";
  return Object.freeze({
    evidenceClass: "recommendation-from-explicit-observable-and-relative-cost-model",
    requiredObservables: Object.freeze(required),
    weights: WATER_ROUTE_SCORE_AXES,
    ranking: Object.freeze(ranking),
    selected,
    runnerUp: ranking.find((entry) => entry.id !== selected.id) ?? null,
    handoff: composite ? Object.freeze({
      offshoreOwner: "spectral-offshore-ocean",
      coastalOwner: "sparse-saint-venant",
      transfer: "dimensioned boundary elevation/discharge or action/phase adapter at a shared clocked sample instant",
      ownership: "partition of unity for presentation; exactly one reaction owner; no geometric double surface",
      requiredEvidence: Object.freeze(["phase-and-energy-transfer-error", "handoff-reflection", "provider-version-coherence", "zero-frame-readback"]),
    }) : null,
  });
}
