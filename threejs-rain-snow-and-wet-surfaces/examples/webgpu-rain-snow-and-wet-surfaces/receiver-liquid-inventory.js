export const RECEIVER_WETNESS_DECISION = Object.freeze({
  problemId: "surface-wetness-authority",
  axes: Object.freeze(["inventoryTruth", "singleOwner", "dryingTruth", "runoffCoupling", "mobileCost", "materialUse"]),
  selectedCandidateId: "receiver-liquid-inventory",
  candidates: Object.freeze([
    Object.freeze({ id: "instantaneous-mask", family: "instantaneous depth or rain mask", scores: [0, 3, 0, 0, 5, 3], pros: "no persistent storage", cons: "no memory, inventory, or runoff", hardGate: "fail:no-state" }),
    Object.freeze({ id: "binary-fade", family: "binary wet event plus exponential display fade", scores: [1, 4, 5, 0, 5, 4], pros: "excellent cheap shoreline memory", cons: "fade is not a liquid inventory", hardGate: "fail:no-mass-or-runoff" }),
    Object.freeze({ id: "material-private-history", family: "each material integrates a private wetness history", scores: [1, 0, 3, 0, 3, 5], pros: "direct shading control", cons: "duplicates ownership across water, weather, and materials", hardGate: "fail:multiple-state-owners" }),
    Object.freeze({ id: "maximum-inundation-age", family: "maximum inundation and time-since-wet diagnostics", scores: [2, 4, 4, 1, 4, 4], pros: "useful flood and drying evidence", cons: "cannot close deposition or runoff mass", hardGate: "fail:no-conserved-inventory" }),
    Object.freeze({ id: "thin-film-pde", family: "depth-resolved surface-film finite volume", scores: [5, 5, 5, 5, 1, 5], pros: "lateral film flow and puddle transport", cons: "extra flux state, boundaries, subcycles, and traffic exceed the baseline observable", hardGate: "pass:hero-film-escalation" }),
    Object.freeze({ id: "receiver-liquid-inventory", family: "receiver-owned liquid mass per area with derived saturation", scores: [5, 5, 5, 5, 5, 5], pros: "one SI inventory, exact losses, bounded storage, delayed runoff", cons: "does not represent lateral film flow inside the receiver", hardGate: "pass" }),
  ]),
});

export const RECEIVER_TRANSFER_PHASE_DECISION = Object.freeze({
  problemId: "interval-integrated-liquid-transfer-phase",
  axes: Object.freeze(["timeTruth", "cadenceInvariance", "lossCoupling", "schemaClarity", "runtimeCost"]),
  selectedCandidateId: "explicit-declared-phase",
  candidates: Object.freeze([
    Object.freeze({ id: "ignore-phase", family: "apply transfer without temporal phase", scores: [0, 0, 1, 1, 5], hardGate: "fail:undefined-loss-overlap" }),
    Object.freeze({ id: "force-interval-start", family: "treat every integral as interval-start", scores: [2, 2, 2, 3, 5], hardGate: "fail:water-postsolve-transfer-decays-early" }),
    Object.freeze({ id: "force-midpoint", family: "treat every integral as midpoint impulse", scores: [2, 3, 3, 2, 5], hardGate: "fail:authored-phase-erasure" }),
    Object.freeze({ id: "force-interval-end", family: "treat every integral as interval-end", scores: [2, 2, 2, 3, 5], hardGate: "fail:presolve-deposition-decays-late" }),
    Object.freeze({ id: "uniform-rate-reconstruction", family: "reinterpret every integral as a uniform rate", scores: [3, 4, 5, 2, 4], hardGate: "fail:changes-time-semantics" }),
    Object.freeze({ id: "explicit-declared-phase", family: "preserve declared interval-start or interval-end phase", scores: [5, 5, 5, 5, 5], hardGate: "pass" }),
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

function requireMassArray(value, count, label) {
  if (!(value instanceof Float64Array) || value.length !== count) {
    throw new TypeError(`${label} must be a Float64Array(${count})`);
  }
  for (const mass of value) requireNonnegative(mass, label);
  return value;
}

export function createReceiverLiquidState({
  receiverId,
  cellCount,
  capacityKgPerM2,
  initialLiquidMassKgPerM2 = new Float64Array(cellCount),
  generation = 0,
  applicationLedgerKeys = [],
} = {}) {
  if (typeof receiverId !== "string" || receiverId.length === 0) throw new TypeError("receiverId must be non-empty");
  if (!Number.isInteger(cellCount) || cellCount <= 0) throw new RangeError("cellCount must be a positive integer");
  const capacity = requireNonnegative(capacityKgPerM2, "capacityKgPerM2");
  if (capacity === 0) throw new RangeError("capacityKgPerM2 must be positive");
  requireMassArray(initialLiquidMassKgPerM2, cellCount, "initialLiquidMassKgPerM2");
  if (initialLiquidMassKgPerM2.some((mass) => mass > capacity)) throw new RangeError("initial receiver liquid mass exceeds capacity");
  if (!Number.isInteger(generation) || generation < 0) throw new RangeError("generation must be a nonnegative integer");
  if (!Array.isArray(applicationLedgerKeys) || applicationLedgerKeys.some((key) => typeof key !== "string")) throw new TypeError("applicationLedgerKeys must be a string array");
  if (new Set(applicationLedgerKeys).size !== applicationLedgerKeys.length) throw new Error("receiver application ledger contains duplicate keys");
  return {
    receiverId,
    generation,
    stateVersion: `receiver-liquid:${receiverId}:${generation}`,
    capacityKgPerM2: capacity,
    liquidMassKgPerM2: initialLiquidMassKgPerM2.slice(),
    applicationLedgerKeys: Object.freeze([...applicationLedgerKeys]),
  };
}

function prepareMassTransfer(interaction, prior, cellAreaM2, knownKeys, batchKeys) {
  if (interaction?.role !== "source") throw new Error("receiver liquid integration accepts source records only");
  if (interaction.targetOwner !== prior.receiverId) throw new Error("liquid transfer targets the wrong receiver owner");
  if (interaction.targetStateEquation !== "receiver-liquid-mass-per-area") throw new Error("liquid transfer targets the wrong state equation");
  if (interaction.targetStateVersionExpected !== prior.stateVersion) throw new Error("liquid transfer targets a stale receiver state version");
  if (typeof interaction.applicationLedgerKey !== "string" || interaction.applicationLedgerKey.length === 0) throw new Error("liquid transfer requires an applicationLedgerKey");
  if (knownKeys.has(interaction.applicationLedgerKey) || batchKeys.has(interaction.applicationLedgerKey)) throw new Error(`duplicate exact-once liquid transfer '${interaction.applicationLedgerKey}'`);
  batchKeys.add(interaction.applicationLedgerKey);
  if (typeof interaction.applicationIntervalKey !== "string" || interaction.applicationIntervalKey.length === 0) throw new Error("liquid transfer requires one canonical application interval identity");
  if (!Number.isInteger(interaction.targetCellIndex) || interaction.targetCellIndex < 0 || interaction.targetCellIndex >= prior.liquidMassKgPerM2.length) throw new RangeError("liquid transfer target cell lies outside the receiver");
  if (interaction.footprint?.distributionKind !== "extensive-distributed" || interaction.footprint.representedAreaM2 !== cellAreaM2) throw new Error("liquid transfer footprint must represent exactly one physical receiver cell area");
  const payload = interaction.payload;
  if (payload?.tag !== "massTransfer" || payload.timeSemantics !== "interval-integrated" || !["interval-start", "interval-end"].includes(payload.applicationPhase)) throw new Error("receiver requires an explicitly phased, interval-integrated massTransfer payload");
  const liquidMassKg = requireNonnegative(payload.speciesPhaseMassKg?.liquidWater, "liquidWater mass transfer");
  return Object.freeze({ interaction, liquidMassKg, applicationPhase: payload.applicationPhase });
}

export function advanceReceiverLiquidInventory(prior, {
  interactions = [],
  cellAreaM2,
  dtSeconds,
  lossRatesPerSecond = {},
  applicationIntervalKey,
} = {}) {
  if (!prior || typeof prior !== "object") throw new TypeError("prior receiver liquid state is required");
  const cellCount = prior.liquidMassKgPerM2?.length;
  requireMassArray(prior.liquidMassKgPerM2, cellCount, "prior.liquidMassKgPerM2");
  const area = requireNonnegative(cellAreaM2, "cellAreaM2");
  const dt = requireNonnegative(dtSeconds, "dtSeconds");
  if (area === 0) throw new RangeError("cellAreaM2 must be positive");
  if (typeof applicationIntervalKey !== "string" || applicationIntervalKey.length === 0) throw new Error("receiver advance requires one canonical application interval identity");
  if (!Array.isArray(interactions)) throw new TypeError("interactions must be an array");
  const rates = Object.freeze({
    drainage: requireNonnegative(lossRatesPerSecond.drainage ?? 0, "drainage rate"),
    infiltration: requireNonnegative(lossRatesPerSecond.infiltration ?? 0, "infiltration rate"),
    evaporation: requireNonnegative(lossRatesPerSecond.evaporation ?? 0, "evaporation rate"),
  });
  const totalLossRate = rates.drainage + rates.infiltration + rates.evaporation;
  const knownKeys = new Set(prior.applicationLedgerKeys);
  const batchKeys = new Set();
  const prepared = interactions.map((interaction) => prepareMassTransfer(interaction, prior, area, knownKeys, batchKeys));
  const applicationPhases = new Set(prepared.map((item) => item.applicationPhase));
  if (applicationPhases.size > 1) throw new Error("receiver liquid batch mixes incompatible integral application phases");
  const applicationPhase = prepared[0]?.applicationPhase ?? "interval-start";
  const incomingKgByCell = new Float64Array(cellCount);
  for (const item of prepared) incomingKgByCell[item.interaction.targetCellIndex] += item.liquidMassKg;

  const nextMass = new Float64Array(cellCount);
  const saturation = new Float64Array(cellCount);
  let priorMassKg = 0;
  let incomingMassKg = 0;
  let storedAfterInputKg = 0;
  let overflowRunoffKg = 0;
  let drainageKg = 0;
  let infiltrationKg = 0;
  let evaporationKg = 0;
  let finalMassKg = 0;
  const decay = Math.exp(-totalLossRate * dt);
  for (let cell = 0; cell < cellCount; cell += 1) {
    const priorKg = prior.liquidMassKgPerM2[cell] * area;
    const incomingKg = incomingKgByCell[cell];
    const priorAfterLossKgPerM2 = prior.liquidMassKgPerM2[cell] * decay;
    const startAvailableKgPerM2 = prior.liquidMassKgPerM2[cell] + incomingKg / area;
    const endAvailableKgPerM2 = priorAfterLossKgPerM2 + incomingKg / area;
    const availableKgPerM2 = applicationPhase === "interval-start" ? startAvailableKgPerM2 : endAvailableKgPerM2;
    const storedAtCapacityKgPerM2 = Math.min(prior.capacityKgPerM2, availableKgPerM2);
    const overflowKg = Math.max(0, availableKgPerM2 - prior.capacityKgPerM2) * area;
    const retainedKgPerM2 = applicationPhase === "interval-start" ? storedAtCapacityKgPerM2 * decay : storedAtCapacityKgPerM2;
    const lossBasisKgPerM2 = applicationPhase === "interval-start" ? storedAtCapacityKgPerM2 : prior.liquidMassKgPerM2[cell];
    const lossKg = lossBasisKgPerM2 * (1 - decay) * area;
    const rateScale = totalLossRate === 0 ? 0 : lossKg / totalLossRate;
    nextMass[cell] = retainedKgPerM2;
    saturation[cell] = retainedKgPerM2 / prior.capacityKgPerM2;
    priorMassKg += priorKg;
    incomingMassKg += incomingKg;
    storedAfterInputKg += storedAtCapacityKgPerM2 * area;
    overflowRunoffKg += overflowKg;
    drainageKg += rateScale * rates.drainage;
    infiltrationKg += rateScale * rates.infiltration;
    evaporationKg += rateScale * rates.evaporation;
    finalMassKg += retainedKgPerM2 * area;
  }
  const totalOutputsKg = overflowRunoffKg + drainageKg + infiltrationKg + evaporationKg;
  const massResidualKg = finalMassKg - priorMassKg - incomingMassKg + totalOutputsKg;
  const scale = Math.max(1, priorMassKg, incomingMassKg, finalMassKg, totalOutputsKg);
  if (Math.abs(massResidualKg) > 1e-12 * scale) throw new Error("receiver liquid inventory failed mass closure");
  const nextGeneration = prior.generation + 1;
  const applicationLedgerKeys = Object.freeze([...prior.applicationLedgerKeys, ...prepared.map((item) => item.interaction.applicationLedgerKey)]);
  return Object.freeze({
    state: {
      receiverId: prior.receiverId,
      generation: nextGeneration,
      stateVersion: `receiver-liquid:${prior.receiverId}:${nextGeneration}`,
      capacityKgPerM2: prior.capacityKgPerM2,
      liquidMassKgPerM2: nextMass,
      applicationLedgerKeys,
    },
    saturation,
    outgoingForNextInterval: Object.freeze({
      earliestApplicationInterval: "following-accepted-interval",
      sourceStateVersion: `receiver-liquid:${prior.receiverId}:${nextGeneration}`,
      runoffMassKg: overflowRunoffKg + drainageKg,
      infiltrationMassKg: infiltrationKg,
      evaporationMassKg: evaporationKg,
    }),
    diagnostics: Object.freeze({
      applicationIntervalKey,
      applicationPhase,
      interactionCount: prepared.length,
      priorMassKg,
      incomingMassKg,
      storedAfterInputKg,
      overflowRunoffKg,
      drainageKg,
      infiltrationKg,
      evaporationKg,
      finalMassKg,
      massResidualKg,
      exactDecayFactor: decay,
      visualParticleCountAuthority: false,
      frameCriticalReadbackCount: 0,
    }),
  });
}
