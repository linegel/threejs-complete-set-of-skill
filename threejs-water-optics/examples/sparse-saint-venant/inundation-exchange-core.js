export const INUNDATION_EXCHANGE_DECISION = Object.freeze({
  problemId: "water-to-receiver-wetness-exchange",
  axes: Object.freeze(["waterMassClosure", "receiverOwnership", "dryingCompatibility", "runoffCompatibility", "mobileCost", "shorelineTruth"]),
  selectedCandidateId: "limited-conservative-uptake",
  candidates: Object.freeze([
    Object.freeze({ id: "material-depth-sample", family: "material directly samples instantaneous water depth", scores: [1, 0, 0, 0, 5, 3], hardGate: "fail:material-integrates-state" }),
    Object.freeze({ id: "binary-contact-event", family: "binary inundated event with no transferred inventory", scores: [3, 4, 4, 0, 5, 4], hardGate: "fail:no-liquid-inventory" }),
    Object.freeze({ id: "fixed-film-from-depth", family: "assign a fixed receiver film whenever depth exceeds threshold", scores: [2, 4, 4, 2, 5, 3], hardGate: "fail:unbounded-water-withdrawal" }),
    Object.freeze({ id: "prescribed-one-way-wash", family: "prescribed wash mass without water reaction", scores: [1, 5, 5, 3, 5, 4], hardGate: "fail:missing-water-mass-reaction" }),
    Object.freeze({ id: "thin-film-boundary-solver", family: "coupled lateral thin-film and SWE boundary solve", scores: [5, 5, 5, 5, 1, 5], hardGate: "pass:hero-film-escalation" }),
    Object.freeze({ id: "limited-conservative-uptake", family: "capacity- and availability-limited SWE mass transfer", scores: [5, 5, 5, 5, 5, 5], hardGate: "pass" }),
  ]),
});

export const INUNDATION_MOMENTUM_DECISION = Object.freeze({
  problemId: "water-film-horizontal-momentum-disposition",
  axes: Object.freeze(["momentumClosure", "remainingVelocityTruth", "receiverTraceability", "stability", "mobileCost"]),
  selectedCandidateId: "proportional-removal-with-reaction",
  candidates: Object.freeze([
    Object.freeze({ id: "keep-discharge", family: "remove depth but retain discharge", scores: [0, 0, 0, 2, 5], hardGate: "fail:velocity-increase" }),
    Object.freeze({ id: "zero-cell-discharge", family: "zero all cell discharge after uptake", scores: [1, 0, 2, 4, 5], hardGate: "fail:unbounded-overdamping" }),
    Object.freeze({ id: "velocity-clamp", family: "clamp resulting velocity to a tier envelope", scores: [1, 2, 1, 4, 5], hardGate: "fail:unledgered-momentum-loss" }),
    Object.freeze({ id: "visual-splash-only", family: "map removed momentum only to splash or foam", scores: [0, 1, 1, 5, 4], hardGate: "fail:visual-child-has-no-authority" }),
    Object.freeze({ id: "proportional-removal-no-record", family: "preserve velocity by proportional discharge removal", scores: [3, 5, 0, 5, 5], hardGate: "fail:missing-receiver-reaction" }),
    Object.freeze({ id: "proportional-removal-with-reaction", family: "proportional discharge removal plus typed momentum transfer", scores: [5, 5, 5, 5, 5], hardGate: "pass" }),
  ]),
});

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function requireNonnegative(value, label) {
  const finite = requireFinite(value, label);
  if (finite < 0) throw new RangeError(`${label} must be nonnegative`);
  return finite;
}

function requireFloat64(value, count, label) {
  if (!(value instanceof Float64Array) || value.length !== count) throw new TypeError(`${label} must be a Float64Array(${count})`);
  for (const item of value) requireNonnegative(item, label);
  return value;
}

function requireFiniteFloat64(value, count, label) {
  if (!(value instanceof Float64Array) || value.length !== count) throw new TypeError(`${label} must be a Float64Array(${count})`);
  for (const item of value) requireFinite(item, label);
  return value;
}

export function prepareInundationExchange({
  waterDepthMeters,
  xDischargeM2ps,
  zDischargeM2ps,
  receiverAvailableCapacityKgPerM2,
  receiverMask,
  width,
  height,
  cellAreaM2,
  waterDensityKgPerM3,
  uptakeRateKgPerM2S,
  dtSeconds,
  wetDepthThresholdMeters,
  minimumRetainedDepthMeters,
  waterOwnerId,
  waterStateVersion,
  receiverOwnerId,
  receiverMomentumOwnerId,
  receiverStateVersion,
  applicationIntervalKey,
  interactionSequenceStart = 0,
  commitGroupId,
} = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError("inundation grid dimensions must be positive integers");
  const count = width * height;
  requireFloat64(waterDepthMeters, count, "waterDepthMeters");
  requireFiniteFloat64(xDischargeM2ps, count, "xDischargeM2ps");
  requireFiniteFloat64(zDischargeM2ps, count, "zDischargeM2ps");
  requireFloat64(receiverAvailableCapacityKgPerM2, count, "receiverAvailableCapacityKgPerM2");
  if (!(receiverMask instanceof Uint8Array) || receiverMask.length !== count || receiverMask.some((value) => value !== 0 && value !== 1)) throw new TypeError(`receiverMask must be a binary Uint8Array(${count})`);
  const area = requireNonnegative(cellAreaM2, "cellAreaM2");
  const density = requireNonnegative(waterDensityKgPerM3, "waterDensityKgPerM3");
  const uptakeRate = requireNonnegative(uptakeRateKgPerM2S, "uptakeRateKgPerM2S");
  const dt = requireNonnegative(dtSeconds, "dtSeconds");
  const wetThreshold = requireNonnegative(wetDepthThresholdMeters, "wetDepthThresholdMeters");
  const retainedDepth = requireNonnegative(minimumRetainedDepthMeters, "minimumRetainedDepthMeters");
  if (area === 0 || density === 0) throw new RangeError("cell area and water density must be positive");
  if (retainedDepth > wetThreshold) throw new RangeError("minimum retained depth cannot exceed the wet-event threshold");
  for (const [label, value] of Object.entries({ waterOwnerId, waterStateVersion, receiverOwnerId, receiverMomentumOwnerId, receiverStateVersion, applicationIntervalKey, commitGroupId })) {
    if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be non-empty`);
  }
  if (waterOwnerId === receiverOwnerId) throw new Error("water and receiver must remain distinct state-equation owners");
  if (!Number.isInteger(interactionSequenceStart) || interactionSequenceStart < 0) throw new RangeError("interactionSequenceStart must be a nonnegative integer");

  const candidateDepthMeters = waterDepthMeters.slice();
  const candidateXDischargeM2ps = xDischargeM2ps.slice();
  const candidateZDischargeM2ps = zDischargeM2ps.slice();
  const transferredKgPerM2 = new Float64Array(count);
  const receiverMassInteractions = [];
  const momentumInteractions = [];
  let priorWaterMassKg = 0;
  let candidateWaterMassKg = 0;
  let transferredMassKg = 0;
  let wetReceiverCells = 0;
  let priorMomentumXNs = 0;
  let priorMomentumZNs = 0;
  let candidateMomentumXNs = 0;
  let candidateMomentumZNs = 0;
  let transferredMomentumXNs = 0;
  let transferredMomentumZNs = 0;
  for (let cell = 0; cell < count; cell += 1) {
    const priorDepth = waterDepthMeters[cell];
    priorWaterMassKg += priorDepth * area * density;
    priorMomentumXNs += xDischargeM2ps[cell] * area * density;
    priorMomentumZNs += zDischargeM2ps[cell] * area * density;
    if (receiverMask[cell] === 1 && priorDepth >= wetThreshold && receiverAvailableCapacityKgPerM2[cell] > 0) {
      const availableWaterKgPerM2 = Math.max(0, priorDepth - retainedDepth) * density;
      const transferKgPerM2 = Math.min(receiverAvailableCapacityKgPerM2[cell], uptakeRate * dt, availableWaterKgPerM2);
      if (transferKgPerM2 > 0) {
        const sequence = interactionSequenceStart + receiverMassInteractions.length;
        const interactionId = `inundation:${applicationIntervalKey}:${cell}:${sequence}`;
        const transferredKg = transferKgPerM2 * area;
        candidateDepthMeters[cell] = priorDepth - transferKgPerM2 / density;
        const remainingFraction = priorDepth > 0 ? candidateDepthMeters[cell] / priorDepth : 0;
        candidateXDischargeM2ps[cell] = xDischargeM2ps[cell] * remainingFraction;
        candidateZDischargeM2ps[cell] = zDischargeM2ps[cell] * remainingFraction;
        const momentumXNs = (xDischargeM2ps[cell] - candidateXDischargeM2ps[cell]) * area * density;
        const momentumZNs = (zDischargeM2ps[cell] - candidateZDischargeM2ps[cell]) * area * density;
        transferredKgPerM2[cell] = transferKgPerM2;
        transferredMassKg += transferredKg;
        wetReceiverCells += 1;
        receiverMassInteractions.push(Object.freeze({
          interactionId,
          exactOnceKey: `${waterOwnerId}:${applicationIntervalKey}:${sequence}:${interactionId}`,
          applicationLedgerKey: `${receiverOwnerId}:${applicationIntervalKey}:${sequence}:${interactionId}`,
          applicationIntervalKey,
          role: "source",
          sourceOwner: waterOwnerId,
          sourceStateVersion: waterStateVersion,
          targetOwner: receiverOwnerId,
          targetStateVersionExpected: receiverStateVersion,
          targetStateEquation: "receiver-liquid-mass-per-area",
          targetCellIndex: cell,
          footprint: Object.freeze({ distributionKind: "extensive-distributed", representedAreaM2: area }),
          payload: Object.freeze({ tag: "massTransfer", timeSemantics: "interval-integrated", applicationPhase: "interval-end", speciesPhaseMassKg: Object.freeze({ liquidWater: transferredKg }) }),
          conservationGroupId: commitGroupId,
          commitGroupId,
        }));
        momentumInteractions.push(Object.freeze({
          interactionId: `${interactionId}:momentum`,
          exactOnceKey: `${waterOwnerId}:${applicationIntervalKey}:${sequence}:${interactionId}:momentum`,
          applicationLedgerKey: `${receiverMomentumOwnerId}:${applicationIntervalKey}:${sequence}:${interactionId}:momentum`,
          applicationIntervalKey,
          role: "source",
          sourceOwner: waterOwnerId,
          sourceStateVersion: waterStateVersion,
          targetOwner: receiverMomentumOwnerId,
          targetStateVersionExpected: receiverStateVersion,
          targetStateEquation: "receiver-horizontal-momentum-or-dissipation",
          targetCellIndex: cell,
          footprint: Object.freeze({ distributionKind: "extensive-distributed", representedAreaM2: area }),
          payload: Object.freeze({ tag: "momentumTransfer", timeSemantics: "interval-integrated", linearMomentumNs: Object.freeze([momentumXNs, 0, momentumZNs]), angularMomentumNms: Object.freeze([0, 0, 0]), referencePointMeters: Object.freeze([0, 0, 0]) }),
          conservationGroupId: commitGroupId,
          commitGroupId,
        }));
        transferredMomentumXNs += momentumXNs;
        transferredMomentumZNs += momentumZNs;
      }
    }
    candidateWaterMassKg += candidateDepthMeters[cell] * area * density;
    candidateMomentumXNs += candidateXDischargeM2ps[cell] * area * density;
    candidateMomentumZNs += candidateZDischargeM2ps[cell] * area * density;
  }
  const massResidualKg = candidateWaterMassKg - priorWaterMassKg + transferredMassKg;
  const scale = Math.max(1, priorWaterMassKg, candidateWaterMassKg, transferredMassKg);
  if (Math.abs(massResidualKg) > 1e-12 * scale) throw new Error("inundation exchange failed water/receiver mass closure");
  const momentumResidualNs = Math.hypot(candidateMomentumXNs - priorMomentumXNs + transferredMomentumXNs, candidateMomentumZNs - priorMomentumZNs + transferredMomentumZNs);
  const momentumScale = Math.max(1, Math.hypot(priorMomentumXNs, priorMomentumZNs), Math.hypot(transferredMomentumXNs, transferredMomentumZNs));
  if (momentumResidualNs > 1e-12 * momentumScale) throw new Error("inundation exchange failed water/receiver momentum closure");
  return Object.freeze({
    candidateDepthMeters,
    candidateXDischargeM2ps,
    candidateZDischargeM2ps,
    transferredKgPerM2,
    surfaceExchange: Object.freeze({
      exchangeId: `inundation-exchange:${applicationIntervalKey}`,
      applicationIntervalKey,
      mode: "two-way-explicit",
      participants: Object.freeze([waterOwnerId, receiverOwnerId]),
      interactions: Object.freeze([...receiverMassInteractions, ...momentumInteractions]),
      receiverMassInteractions: Object.freeze(receiverMassInteractions),
      momentumInteractions: Object.freeze(momentumInteractions),
      conservationGroupId: commitGroupId,
      commitGroupId,
      acceptance: "water-and-receiver-all-or-none",
      runoffConsumption: "following-accepted-interval-only",
    }),
    diagnostics: Object.freeze({
      priorWaterMassKg,
      candidateWaterMassKg,
      transferredMassKg,
      massResidualKg,
      wetReceiverCells,
      interactionCount: receiverMassInteractions.length + momentumInteractions.length,
      receiverCellCount: receiverMassInteractions.length,
      priorMomentumNs: Object.freeze([priorMomentumXNs, 0, priorMomentumZNs]),
      candidateMomentumNs: Object.freeze([candidateMomentumXNs, 0, candidateMomentumZNs]),
      transferredMomentumNs: Object.freeze([transferredMomentumXNs, 0, transferredMomentumZNs]),
      momentumResidualNs,
      waterMassReactionRepresented: true,
      materialStateWriteCount: 0,
      frameCriticalReadbackCount: 0,
    }),
  });
}
