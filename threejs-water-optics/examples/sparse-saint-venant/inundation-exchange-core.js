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

export function prepareInundationExchange({
  waterDepthMeters,
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
  receiverStateVersion,
  applicationIntervalKey,
  interactionSequenceStart = 0,
  commitGroupId,
} = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError("inundation grid dimensions must be positive integers");
  const count = width * height;
  requireFloat64(waterDepthMeters, count, "waterDepthMeters");
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
  for (const [label, value] of Object.entries({ waterOwnerId, waterStateVersion, receiverOwnerId, receiverStateVersion, applicationIntervalKey, commitGroupId })) {
    if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be non-empty`);
  }
  if (waterOwnerId === receiverOwnerId) throw new Error("water and receiver must remain distinct state-equation owners");
  if (!Number.isInteger(interactionSequenceStart) || interactionSequenceStart < 0) throw new RangeError("interactionSequenceStart must be a nonnegative integer");

  const candidateDepthMeters = waterDepthMeters.slice();
  const transferredKgPerM2 = new Float64Array(count);
  const interactions = [];
  let priorWaterMassKg = 0;
  let candidateWaterMassKg = 0;
  let transferredMassKg = 0;
  let wetReceiverCells = 0;
  for (let cell = 0; cell < count; cell += 1) {
    const priorDepth = waterDepthMeters[cell];
    priorWaterMassKg += priorDepth * area * density;
    if (receiverMask[cell] === 1 && priorDepth >= wetThreshold && receiverAvailableCapacityKgPerM2[cell] > 0) {
      const availableWaterKgPerM2 = Math.max(0, priorDepth - retainedDepth) * density;
      const transferKgPerM2 = Math.min(receiverAvailableCapacityKgPerM2[cell], uptakeRate * dt, availableWaterKgPerM2);
      if (transferKgPerM2 > 0) {
        const sequence = interactionSequenceStart + interactions.length;
        const interactionId = `inundation:${applicationIntervalKey}:${cell}:${sequence}`;
        const transferredKg = transferKgPerM2 * area;
        candidateDepthMeters[cell] = priorDepth - transferKgPerM2 / density;
        transferredKgPerM2[cell] = transferKgPerM2;
        transferredMassKg += transferredKg;
        wetReceiverCells += 1;
        interactions.push(Object.freeze({
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
      }
    }
    candidateWaterMassKg += candidateDepthMeters[cell] * area * density;
  }
  const massResidualKg = candidateWaterMassKg - priorWaterMassKg + transferredMassKg;
  const scale = Math.max(1, priorWaterMassKg, candidateWaterMassKg, transferredMassKg);
  if (Math.abs(massResidualKg) > 1e-12 * scale) throw new Error("inundation exchange failed water/receiver mass closure");
  return Object.freeze({
    candidateDepthMeters,
    transferredKgPerM2,
    surfaceExchange: Object.freeze({
      exchangeId: `inundation-exchange:${applicationIntervalKey}`,
      applicationIntervalKey,
      mode: "two-way-explicit",
      participants: Object.freeze([waterOwnerId, receiverOwnerId]),
      interactions: Object.freeze(interactions),
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
      interactionCount: interactions.length,
      waterMassReactionRepresented: true,
      materialStateWriteCount: 0,
      frameCriticalReadbackCount: 0,
    }),
  });
}
