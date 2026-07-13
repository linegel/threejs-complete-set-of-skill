import assert from "node:assert/strict";
import {
  RECEIVER_WETNESS_DECISION,
  advanceReceiverLiquidInventory,
  createReceiverLiquidState,
} from "./receiver-liquid-inventory.js";

assert.ok(RECEIVER_WETNESS_DECISION.candidates.length >= 5);
assert.equal(new Set(RECEIVER_WETNESS_DECISION.candidates.map((candidate) => candidate.family)).size, RECEIVER_WETNESS_DECISION.candidates.length);
assert.equal(RECEIVER_WETNESS_DECISION.selectedCandidateId, "receiver-liquid-inventory");
assert.equal(RECEIVER_WETNESS_DECISION.candidates.find((candidate) => candidate.id === RECEIVER_WETNESS_DECISION.selectedCandidateId).hardGate, "pass");

const initial = createReceiverLiquidState({ receiverId: "coastal-sand-receiver", cellCount: 4, capacityKgPerM2: 2 });
const transfer = {
  interactionId: "wash-cell-1",
  applicationLedgerKey: "wash-cell-1:40..41",
  applicationIntervalKey: "coastal-clock:40..41",
  role: "source",
  targetOwner: "coastal-sand-receiver",
  targetStateEquation: "receiver-liquid-mass-per-area",
  targetStateVersionExpected: initial.stateVersion,
  targetCellIndex: 1,
  footprint: { distributionKind: "extensive-distributed", representedAreaM2: 1 },
  payload: { tag: "massTransfer", timeSemantics: "interval-integrated", applicationPhase: "interval-start", speciesPhaseMassKg: { liquidWater: 3 } },
};
const advanced = advanceReceiverLiquidInventory(initial, {
  interactions: [transfer],
  cellAreaM2: 1,
  dtSeconds: 2,
  lossRatesPerSecond: { drainage: 0.1, infiltration: 0.06, evaporation: 0.04 },
  applicationIntervalKey: "coastal-clock:40..41",
});
assert.ok(initial.liquidMassKgPerM2.every((mass) => mass === 0), "candidate integration mutated prior committed receiver state");
assert.ok(Math.abs(advanced.state.liquidMassKgPerM2[1] - 2 * Math.exp(-0.4)) < 1e-14);
assert.ok(Math.abs(advanced.saturation[1] - Math.exp(-0.4)) < 1e-14);
assert.ok(Math.abs(advanced.diagnostics.overflowRunoffKg - 1) < 1e-14);
assert.ok(Math.abs(advanced.diagnostics.massResidualKg) < 1e-12);
assert.equal(advanced.outgoingForNextInterval.earliestApplicationInterval, "following-accepted-interval");
assert.equal(advanced.state.applicationLedgerKeys.length, 1);
assert.equal(advanced.diagnostics.visualParticleCountAuthority, false);

const decayInitial = createReceiverLiquidState({ receiverId: "rock", cellCount: 1, capacityKgPerM2: 2, initialLiquidMassKgPerM2: new Float64Array([1.5]) });
const once = advanceReceiverLiquidInventory(decayInitial, { cellAreaM2: 0.5, dtSeconds: 4, lossRatesPerSecond: { evaporation: 0.17 }, applicationIntervalKey: "clock:0..4" });
const half = advanceReceiverLiquidInventory(decayInitial, { cellAreaM2: 0.5, dtSeconds: 2, lossRatesPerSecond: { evaporation: 0.17 }, applicationIntervalKey: "clock:0..2" });
const twice = advanceReceiverLiquidInventory(half.state, { cellAreaM2: 0.5, dtSeconds: 2, lossRatesPerSecond: { evaporation: 0.17 }, applicationIntervalKey: "clock:2..4" });
assert.ok(Math.abs(once.state.liquidMassKgPerM2[0] - twice.state.liquidMassKgPerM2[0]) < 1e-14, "exact drying changed under cadence split");

assert.throws(() => advanceReceiverLiquidInventory(advanced.state, {
  interactions: [{ ...transfer, targetStateVersionExpected: advanced.state.stateVersion }], cellAreaM2: 1, dtSeconds: 1, applicationIntervalKey: "coastal-clock:41..42",
}), /duplicate exact-once/);
assert.throws(() => advanceReceiverLiquidInventory(initial, {
  interactions: [{ ...transfer, targetStateVersionExpected: "stale" }], cellAreaM2: 1, dtSeconds: 1, applicationIntervalKey: "clock:0..1",
}), /stale receiver/);
assert.throws(() => advanceReceiverLiquidInventory(initial, {
  interactions: [{ ...transfer, targetCellIndex: 99 }], cellAreaM2: 1, dtSeconds: 1, applicationIntervalKey: "clock:0..1",
}), /outside the receiver/);
assert.throws(() => advanceReceiverLiquidInventory(initial, {
  interactions: [{ ...transfer, footprint: { ...transfer.footprint, representedAreaM2: 2 } }], cellAreaM2: 1, dtSeconds: 1, applicationIntervalKey: "clock:0..1",
}), /physical receiver cell area/);
assert.throws(() => advanceReceiverLiquidInventory(initial, {
  interactions: [{ ...transfer, payload: { ...transfer.payload, speciesPhaseMassKg: { liquidWater: -1 } } }], cellAreaM2: 1, dtSeconds: 1, applicationIntervalKey: "clock:0..1",
}), /nonnegative/);

console.log(`receiver liquid inventory passed: ${RECEIVER_WETNESS_DECISION.candidates.length} architectures, exact drying, storage overflow/runoff, mass residual ${advanced.diagnostics.massResidualKg.toExponential(2)}, 5 rejection controls`);
