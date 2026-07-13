import {
  WATER_ROUTE_CANDIDATES,
  WATER_ROUTE_SCORE_AXES,
  selectWaterArchitecture,
} from "./water-route-selector.js";

const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(WATER_ROUTE_CANDIDATES.length === 6, "The decision must compare at least five materially different architectures.");
assert(Object.keys(WATER_ROUTE_SCORE_AXES).length === 8, "Route scoring axes drifted.");

const fixedShot = selectWaterArchitecture({ fixedPerceptualShot: true, preferLowBandwidth: true });
assert(fixedShot.selected.id === "phase-locked-coast-bands", "A fixed perceptual shot should not pay for a PDE solver.");

const pool = selectWaterArchitecture({ localInteractiveDisturbances: true, preferLowBandwidth: true });
assert(pool.selected.id === "bounded-linear-heightfield", "A bounded ripple pool should select the local wave grid.");

const transformedCoast = selectWaterArchitecture({
  bathymetricShoalingRefraction: true,
  islandDiffractionOrSheltering: true,
  offlinePrecomputeAllowed: true,
  preferLowBandwidth: true,
});
assert(transformedCoast.selected.id === "wave-action-mild-slope", "Depth-transformed non-inundating waves should select the reduced coastal field.");

const runup = selectWaterArchitecture({
  localInteractiveDisturbances: true,
  wetDryRunup: true,
  massMomentumConservation: true,
  preferLowBandwidth: true,
});
assert(runup.selected.id === "sparse-saint-venant", "Conserved wet/dry run-up requires sparse Saint-Venant state.");

const openOcean = selectWaterArchitecture({ horizonDirectionalSea: true });
assert(openOcean.selected.id === "spectral-offshore-ocean", "A horizon-scale open sea should select the spectral route.");

const archipelago = selectWaterArchitecture({
  horizonDirectionalSea: true,
  bathymetricShoalingRefraction: true,
  wetDryRunup: true,
  massMomentumConservation: true,
  islandDiffractionOrSheltering: true,
});
assert(archipelago.selected.id === "spectral-coastal-handoff", "A full archipelago requires explicit offshore/coastal ownership.");
assert(archipelago.runnerUp?.hardRejected && archipelago.runnerUp.missing.length > 0, "The runner-up must retain the hard-gate reason it lost.");
assert(archipelago.handoff?.offshoreOwner === "spectral-offshore-ocean"
  && archipelago.handoff?.coastalOwner === "sparse-saint-venant", "Composite handoff owners drifted.");
assert(archipelago.ranking.every((candidate) => candidate.axes.observableCoverage >= 0 && candidate.axes.observableCoverage <= 5), "Observable scores escaped [0,5].");
assert(archipelago.ranking.find((candidate) => candidate.id === "spectral-offshore-ocean").hardRejected, "FFT-only water survived an island run-up requirement.");

let rejectedInvalid = false;
try { selectWaterArchitecture({ wetDryRunup: "sometimes" }); } catch { rejectedInvalid = true; }
assert(rejectedInvalid, "Non-boolean workload requirements survived validation.");

console.log(JSON.stringify({
  pass: true,
  decisions: {
    fixedShot: fixedShot.selected.id,
    pool: pool.selected.id,
    transformedCoast: transformedCoast.selected.id,
    runup: runup.selected.id,
    openOcean: openOcean.selected.id,
    archipelago: archipelago.selected.id,
  },
  archipelagoRanking: archipelago.ranking.map(({ id, score, hardRejected, missing }) => ({ id, score, hardRejected, missing })),
}, null, 2));
