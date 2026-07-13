export const SUBCELL_OBSTACLE_DECISION = Object.freeze({
  problemId: "thin-obstacle-depth-averaged-coupling",
  axes: Object.freeze(["momentumReaction", "boundaryGeometry", "stability", "mobileCost", "sparseCompatibility", "wakeTruth"]),
  selectedCandidateId: "exact-porosity-drag",
  candidates: Object.freeze([
    Object.freeze({ id: "stair-step-mask", family: "binary cell-centre solid mask", scores: [4, 2, 5, 5, 5, 2], hardGate: "fail:subcell-pile-disappears-or-overblocks" }),
    Object.freeze({ id: "conservative-enlargement", family: "inflate thin obstacle to solid face-aligned cells", scores: [5, 3, 5, 4, 5, 3], hardGate: "pass:minimum-tier-alternative" }),
    Object.freeze({ id: "empirical-wake-overlay", family: "prescribed downstream velocity or foam wake", scores: [1, 2, 3, 5, 5, 3], hardGate: "fail:no-obstacle-reaction" }),
    Object.freeze({ id: "brinkman-penalty", family: "immersed-boundary velocity penalization", scores: [5, 4, 3, 3, 4, 4], hardGate: "pass" }),
    Object.freeze({ id: "moving-cut-cell", family: "geometric cut-cell flux and moving-boundary conservation", scores: [5, 5, 3, 1, 2, 5], hardGate: "pass:hero-boundary-escalation" }),
    Object.freeze({ id: "exact-porosity-drag", family: "subcell porosity with exact anisotropic drag reaction", scores: [5, 4, 5, 5, 5, 4], hardGate: "pass" }),
  ]),
});

function requireFloat64(value, count, label) {
  if (!(value instanceof Float64Array) || value.length !== count) throw new TypeError(`${label} must be a Float64Array(${count})`);
  for (const item of value) if (!Number.isFinite(item)) throw new TypeError(`${label} contains a non-finite value`);
  return value;
}

export function applySubcellObstacleDrag({
  depthMeters,
  xDischargeM2ps,
  zDischargeM2ps,
  obstacleFraction,
  obstacleNormalX,
  obstacleNormalZ,
  normalDragRatePerSecond,
  tangentDragRatePerSecond,
  dtSeconds,
  cellAreaM2,
  waterDensityKgPerM3,
  dryDepthMeters = 0.005,
} = {}) {
  const count = depthMeters?.length;
  requireFloat64(depthMeters, count, "depthMeters");
  requireFloat64(xDischargeM2ps, count, "xDischargeM2ps");
  requireFloat64(zDischargeM2ps, count, "zDischargeM2ps");
  requireFloat64(obstacleFraction, count, "obstacleFraction");
  requireFloat64(obstacleNormalX, count, "obstacleNormalX");
  requireFloat64(obstacleNormalZ, count, "obstacleNormalZ");
  for (const [label, value] of Object.entries({ normalDragRatePerSecond, tangentDragRatePerSecond, dtSeconds, cellAreaM2, waterDensityKgPerM3, dryDepthMeters })) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and nonnegative`);
  }
  if (cellAreaM2 === 0 || waterDensityKgPerM3 === 0) throw new RangeError("cell area and water density must be positive");
  const nextX = xDischargeM2ps.slice();
  const nextZ = zDischargeM2ps.slice();
  const obstacleReactionImpulseXNs = new Float64Array(count);
  const obstacleReactionImpulseZNs = new Float64Array(count);
  let priorWaterImpulseXNs = 0;
  let priorWaterImpulseZNs = 0;
  let candidateWaterImpulseXNs = 0;
  let candidateWaterImpulseZNs = 0;
  let obstacleReactionXNs = 0;
  let obstacleReactionZNs = 0;
  let dissipatedEnergyJ = 0;
  let activeObstacleCells = 0;
  for (let cell = 0; cell < count; cell += 1) {
    const h = depthMeters[cell];
    const fraction = obstacleFraction[cell];
    if (h < 0) throw new RangeError("obstacle coupling received negative water depth");
    if (fraction < 0 || fraction >= 1) throw new RangeError("subcell obstacle fraction must lie in [0, 1); fully solid cells use the wall-flux route");
    const priorMx = h > dryDepthMeters ? xDischargeM2ps[cell] : 0;
    const priorMz = h > dryDepthMeters ? zDischargeM2ps[cell] : 0;
    nextX[cell] = priorMx;
    nextZ[cell] = priorMz;
    const impulseScale = waterDensityKgPerM3 * cellAreaM2;
    priorWaterImpulseXNs += priorMx * impulseScale;
    priorWaterImpulseZNs += priorMz * impulseScale;
    if (fraction > 0 && h > dryDepthMeters && dtSeconds > 0) {
      const normalLength = Math.hypot(obstacleNormalX[cell], obstacleNormalZ[cell]);
      if (Math.abs(normalLength - 1) > 1e-10) throw new Error("active obstacle normal must be unit length in the physics XZ frame");
      const nx = obstacleNormalX[cell];
      const nz = obstacleNormalZ[cell];
      const tx = -nz;
      const tz = nx;
      const normalMomentum = priorMx * nx + priorMz * nz;
      const tangentMomentum = priorMx * tx + priorMz * tz;
      const nextNormal = normalMomentum * Math.exp(-normalDragRatePerSecond * fraction * dtSeconds);
      const nextTangent = tangentMomentum * Math.exp(-tangentDragRatePerSecond * fraction * dtSeconds);
      nextX[cell] = nextNormal * nx + nextTangent * tx;
      nextZ[cell] = nextNormal * nz + nextTangent * tz;
      obstacleReactionImpulseXNs[cell] = (priorMx - nextX[cell]) * impulseScale;
      obstacleReactionImpulseZNs[cell] = (priorMz - nextZ[cell]) * impulseScale;
      obstacleReactionXNs += obstacleReactionImpulseXNs[cell];
      obstacleReactionZNs += obstacleReactionImpulseZNs[cell];
      const priorEnergy = 0.5 * waterDensityKgPerM3 * cellAreaM2 * (priorMx ** 2 + priorMz ** 2) / h;
      const nextEnergy = 0.5 * waterDensityKgPerM3 * cellAreaM2 * (nextX[cell] ** 2 + nextZ[cell] ** 2) / h;
      dissipatedEnergyJ += priorEnergy - nextEnergy;
      activeObstacleCells += 1;
    }
    candidateWaterImpulseXNs += nextX[cell] * impulseScale;
    candidateWaterImpulseZNs += nextZ[cell] * impulseScale;
  }
  const reactionResidualXNs = candidateWaterImpulseXNs - priorWaterImpulseXNs + obstacleReactionXNs;
  const reactionResidualZNs = candidateWaterImpulseZNs - priorWaterImpulseZNs + obstacleReactionZNs;
  const reactionResidualNs = Math.hypot(reactionResidualXNs, reactionResidualZNs);
  const scale = Math.max(1, Math.hypot(priorWaterImpulseXNs, priorWaterImpulseZNs), Math.hypot(obstacleReactionXNs, obstacleReactionZNs));
  if (reactionResidualNs > 1e-12 * scale) throw new Error("obstacle water/reaction momentum failed closure");
  if (dissipatedEnergyJ < -1e-12) throw new Error("obstacle drag injected kinetic energy");
  return Object.freeze({
    xDischargeM2ps: nextX,
    zDischargeM2ps: nextZ,
    obstacleReactionImpulseXNs,
    obstacleReactionImpulseZNs,
    diagnostics: Object.freeze({
      activeObstacleCells,
      priorWaterImpulseNs: Object.freeze([priorWaterImpulseXNs, 0, priorWaterImpulseZNs]),
      candidateWaterImpulseNs: Object.freeze([candidateWaterImpulseXNs, 0, candidateWaterImpulseZNs]),
      obstacleReactionImpulseNs: Object.freeze([obstacleReactionXNs, 0, obstacleReactionZNs]),
      reactionResidualNs,
      dissipatedEnergyJ,
      massTransferKg: 0,
      frameCriticalReadbackCount: 0,
    }),
  });
}
