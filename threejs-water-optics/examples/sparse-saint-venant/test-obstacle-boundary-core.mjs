import assert from "node:assert/strict";
import { SUBCELL_OBSTACLE_DECISION, applySubcellObstacleDrag } from "./obstacle-boundary-core.js";

assert.equal(SUBCELL_OBSTACLE_DECISION.candidates.length, 6);
assert.equal(new Set(SUBCELL_OBSTACLE_DECISION.candidates.map((candidate) => candidate.family)).size, 6);
assert.equal(SUBCELL_OBSTACLE_DECISION.selectedCandidateId, "exact-porosity-drag");
assert.equal(SUBCELL_OBSTACLE_DECISION.candidates.find((candidate) => candidate.id === SUBCELL_OBSTACLE_DECISION.selectedCandidateId).hardGate, "pass");

const depth = new Float64Array([0.2, 0.2, 0.001]);
const xMomentum = new Float64Array([0.08, 0.04, 99]);
const zMomentum = new Float64Array([0.02, -0.01, 99]);
const normalScale = 1 / Math.hypot(1, 1);
const applied = applySubcellObstacleDrag({
  depthMeters: depth,
  xDischargeM2ps: xMomentum,
  zDischargeM2ps: zMomentum,
  obstacleFraction: new Float64Array([0.6, 0, 0.8]),
  obstacleNormalX: new Float64Array([normalScale, 0, 1]),
  obstacleNormalZ: new Float64Array([normalScale, 0, 0]),
  normalDragRatePerSecond: 6,
  tangentDragRatePerSecond: 0.5,
  dtSeconds: 0.1,
  cellAreaM2: 0.25,
  waterDensityKgPerM3: 1025,
});
assert.ok(applied.xDischargeM2ps[0] !== xMomentum[0] && applied.zDischargeM2ps[0] !== zMomentum[0]);
assert.equal(applied.xDischargeM2ps[1], xMomentum[1]);
assert.equal(applied.zDischargeM2ps[1], zMomentum[1]);
assert.equal(applied.xDischargeM2ps[2], 0, "dry-cell momentum was not cleared before obstacle coupling");
assert.equal(applied.diagnostics.activeObstacleCells, 1);
assert.equal(applied.diagnostics.massTransferKg, 0);
assert.ok(applied.diagnostics.dissipatedEnergyJ > 0);
assert.ok(applied.diagnostics.reactionResidualNs < 1e-12);

const once = applySubcellObstacleDrag({
  depthMeters: new Float64Array([0.2]), xDischargeM2ps: new Float64Array([0.1]), zDischargeM2ps: new Float64Array([0]),
  obstacleFraction: new Float64Array([0.5]), obstacleNormalX: new Float64Array([1]), obstacleNormalZ: new Float64Array([0]),
  normalDragRatePerSecond: 4, tangentDragRatePerSecond: 0, dtSeconds: 0.2, cellAreaM2: 1, waterDensityKgPerM3: 1000,
});
const firstHalf = applySubcellObstacleDrag({
  depthMeters: new Float64Array([0.2]), xDischargeM2ps: new Float64Array([0.1]), zDischargeM2ps: new Float64Array([0]),
  obstacleFraction: new Float64Array([0.5]), obstacleNormalX: new Float64Array([1]), obstacleNormalZ: new Float64Array([0]),
  normalDragRatePerSecond: 4, tangentDragRatePerSecond: 0, dtSeconds: 0.1, cellAreaM2: 1, waterDensityKgPerM3: 1000,
});
const secondHalf = applySubcellObstacleDrag({
  depthMeters: new Float64Array([0.2]), xDischargeM2ps: firstHalf.xDischargeM2ps, zDischargeM2ps: firstHalf.zDischargeM2ps,
  obstacleFraction: new Float64Array([0.5]), obstacleNormalX: new Float64Array([1]), obstacleNormalZ: new Float64Array([0]),
  normalDragRatePerSecond: 4, tangentDragRatePerSecond: 0, dtSeconds: 0.1, cellAreaM2: 1, waterDensityKgPerM3: 1000,
});
assert.ok(Math.abs(once.xDischargeM2ps[0] - secondHalf.xDischargeM2ps[0]) < 1e-15, "exact obstacle drag changed under subcycle split");

const common = {
  depthMeters: new Float64Array([0.2]), xDischargeM2ps: new Float64Array([0.1]), zDischargeM2ps: new Float64Array([0]),
  obstacleFraction: new Float64Array([0.5]), obstacleNormalX: new Float64Array([1]), obstacleNormalZ: new Float64Array([0]),
  normalDragRatePerSecond: 4, tangentDragRatePerSecond: 0, dtSeconds: 0.1, cellAreaM2: 1, waterDensityKgPerM3: 1000,
};
assert.throws(() => applySubcellObstacleDrag({ ...common, obstacleFraction: new Float64Array([1]) }), /wall-flux route/);
assert.throws(() => applySubcellObstacleDrag({ ...common, obstacleNormalX: new Float64Array([0.5]) }), /unit length/);
assert.throws(() => applySubcellObstacleDrag({ ...common, depthMeters: new Float64Array([-1]) }), /negative water depth/);

console.log(`subcell obstacle oracle passed: ${SUBCELL_OBSTACLE_DECISION.candidates.length} architectures, exact anisotropic drag, reaction residual ${applied.diagnostics.reactionResidualNs.toExponential(2)}, cadence split, 3 rejection controls`);
