import assert from "node:assert/strict";
import { advanceReceiverLiquidInventory, createReceiverLiquidState } from "../../../threejs-rain-snow-and-wet-surfaces/examples/webgpu-rain-snow-and-wet-surfaces/receiver-liquid-inventory.js";
import { INUNDATION_EXCHANGE_DECISION, prepareInundationExchange } from "./inundation-exchange-core.js";

assert.equal(INUNDATION_EXCHANGE_DECISION.candidates.length, 6);
assert.equal(new Set(INUNDATION_EXCHANGE_DECISION.candidates.map((candidate) => candidate.family)).size, 6);
assert.equal(INUNDATION_EXCHANGE_DECISION.selectedCandidateId, "limited-conservative-uptake");
assert.equal(INUNDATION_EXCHANGE_DECISION.candidates.find((candidate) => candidate.id === INUNDATION_EXCHANGE_DECISION.selectedCandidateId).hardGate, "pass");

const receiver = createReceiverLiquidState({ receiverId: "coastal-sand", cellCount: 4, capacityKgPerM2: 2 });
const priorDepth = new Float64Array([0.12, 0.004, 0.08, 0.2]);
const exchange = prepareInundationExchange({
  waterDepthMeters: priorDepth,
  receiverAvailableCapacityKgPerM2: new Float64Array([2, 2, 0.5, 0]),
  receiverMask: new Uint8Array([1, 1, 1, 0]),
  width: 2,
  height: 2,
  cellAreaM2: 0.25,
  waterDensityKgPerM3: 1000,
  uptakeRateKgPerM2S: 1,
  dtSeconds: 1,
  wetDepthThresholdMeters: 0.01,
  minimumRetainedDepthMeters: 0.005,
  waterOwnerId: "sparse-swe-water",
  waterStateVersion: "water:40",
  receiverOwnerId: receiver.receiverId,
  receiverStateVersion: receiver.stateVersion,
  applicationIntervalKey: "coastal-clock:40..41",
  interactionSequenceStart: 100,
  commitGroupId: "water-receiver:40..41",
});
assert.ok(priorDepth.every((depth, index) => depth === [0.12, 0.004, 0.08, 0.2][index]), "exchange preparation mutated committed water depth");
assert.equal(exchange.surfaceExchange.interactions.length, 2);
assert.equal(exchange.surfaceExchange.acceptance, "water-and-receiver-all-or-none");
assert.equal(exchange.surfaceExchange.interactions[0].payload.applicationPhase, "interval-end");
assert.ok(Math.abs(exchange.candidateDepthMeters[0] - 0.119) < 1e-14);
assert.ok(Math.abs(exchange.candidateDepthMeters[2] - 0.0795) < 1e-14);
assert.equal(exchange.candidateDepthMeters[1], priorDepth[1]);
assert.equal(exchange.candidateDepthMeters[3], priorDepth[3]);
assert.ok(Math.abs(exchange.diagnostics.massResidualKg) < 1e-12);
assert.equal(exchange.diagnostics.materialStateWriteCount, 0);

const receiverCandidate = advanceReceiverLiquidInventory(receiver, {
  interactions: exchange.surfaceExchange.interactions,
  cellAreaM2: 0.25,
  dtSeconds: 1,
  lossRatesPerSecond: { evaporation: 0.2 },
  applicationIntervalKey: "coastal-clock:40..41",
});
assert.equal(receiverCandidate.diagnostics.applicationPhase, "interval-end");
assert.equal(receiverCandidate.state.liquidMassKgPerM2[0], 1);
assert.equal(receiverCandidate.state.liquidMassKgPerM2[2], 0.5);
assert.ok(Math.abs(receiverCandidate.diagnostics.incomingMassKg - exchange.diagnostics.transferredMassKg) < 1e-14);

const common = {
  waterDepthMeters: new Float64Array([0.02]), receiverAvailableCapacityKgPerM2: new Float64Array([1]), receiverMask: new Uint8Array([1]),
  width: 1, height: 1, cellAreaM2: 1, waterDensityKgPerM3: 1000, uptakeRateKgPerM2S: 1, dtSeconds: 1,
  wetDepthThresholdMeters: 0.01, minimumRetainedDepthMeters: 0.005, waterOwnerId: "water", waterStateVersion: "w0",
  receiverOwnerId: "sand", receiverStateVersion: "s0", applicationIntervalKey: "clock:0..1", commitGroupId: "group:0..1",
};
assert.throws(() => prepareInundationExchange({ ...common, minimumRetainedDepthMeters: 0.02 }), /cannot exceed/);
assert.throws(() => prepareInundationExchange({ ...common, waterOwnerId: "sand" }), /distinct state-equation owners/);
assert.throws(() => prepareInundationExchange({ ...common, receiverMask: new Uint8Array([2]) }), /binary Uint8Array/);
assert.throws(() => prepareInundationExchange({ ...common, waterDepthMeters: new Float64Array([-1]) }), /nonnegative/);

console.log(`inundation exchange passed: ${INUNDATION_EXCHANGE_DECISION.candidates.length} architectures, ${exchange.diagnostics.interactionCount} exact transfers, mass residual ${exchange.diagnostics.massResidualKg.toExponential(2)}, receiver interval-end compatibility, 4 rejection controls`);
