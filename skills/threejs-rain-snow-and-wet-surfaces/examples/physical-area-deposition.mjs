// CPU oracle only. The receiver owner supplies extensive totals; visual
// particles, sprites, and LOD never enter these calculations.

function nonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and nonnegative`);
  }
  return value;
}

function values(input, name) {
  if (!Array.isArray(input) && !ArrayBuffer.isView(input)) {
    throw new TypeError(`${name} must be an array or typed array`);
  }
  return Array.from(input, (value) => nonnegative(value, name));
}

function compensatedSum(input) {
  let sum = 0;
  let correction = 0;
  for (const value of input) {
    const adjusted = value - correction;
    const next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next;
  }
  return sum;
}

function massTolerance(input) {
  return {
    absoluteKg: nonnegative(input?.absoluteKg, "tolerance.absoluteKg"),
    relative: nonnegative(input?.relative, "tolerance.relative"),
  };
}

function assertMassClose(observedKg, expectedKg, limits, label) {
  const residualKg = observedKg - expectedKg;
  const allowedKg = nonnegative(
    limits.absoluteKg
      + limits.relative * Math.max(Math.abs(observedKg), Math.abs(expectedKg)),
    `${label} allowed error`,
  );
  if (Math.abs(residualKg) > allowedKg) {
    throw new Error(`${label} residual ${residualKg} kg exceeds ${allowedKg} kg`);
  }
  return { residualKg, allowedKg };
}

export function integratePhysicalAreaFlux({
  fluxKgPerM2S,
  areaM2BySample,
  dtSeconds,
} = {}) {
  const flux = values(fluxKgPerM2S, "fluxKgPerM2S");
  const area = values(areaM2BySample, "areaM2BySample");
  const dt = nonnegative(dtSeconds, "dtSeconds");
  if (flux.length === 0 || flux.length !== area.length) {
    throw new RangeError("flux and varying-area arrays must have equal nonzero length");
  }
  const representedAreaM2 = nonnegative(compensatedSum(area), "representedAreaM2");
  const integratedFluxKgPerS = nonnegative(
    compensatedSum(flux.map((rate, i) => rate * area[i])),
    "integratedFluxKgPerS",
  );
  return Object.freeze({
    representedAreaM2,
    transferredMassKg: nonnegative(dt * integratedFluxKgPerS, "transferredMassKg"),
  });
}

export function partitionExtensiveTransfer({
  parentMassKg,
  fractions,
  limits,
  fractionTolerance,
} = {}) {
  const parent = nonnegative(parentMassKg, "parentMassKg");
  const weights = values(fractions, "fractions");
  const accepted = massTolerance(limits);
  const acceptedFraction = nonnegative(fractionTolerance, "fractionTolerance");
  if (weights.length === 0) throw new RangeError("fractions must be nonempty");
  const fractionResidual = compensatedSum(weights) - 1;
  if (Math.abs(fractionResidual) > acceptedFraction) {
    throw new Error(`partition fraction residual ${fractionResidual}; no normalization was applied`);
  }
  const childMassKg = weights.map((weight) => nonnegative(parent * weight, "childMassKg"));
  const closure = assertMassClose(
    compensatedSum(childMassKg),
    parent,
    accepted,
    "partition",
  );
  return Object.freeze({ childMassKg: Object.freeze(childMassKg), fractionResidual, ...closure });
}

export function closeReceiverMassLedger({
  priorMassKg,
  incomingMassKg,
  outgoingMassKg,
  finalMassKg,
  limits,
} = {}) {
  const prior = nonnegative(priorMassKg, "priorMassKg");
  const incoming = nonnegative(incomingMassKg, "incomingMassKg");
  const outgoing = nonnegative(outgoingMassKg, "outgoingMassKg");
  const final = nonnegative(finalMassKg, "finalMassKg");
  const availableMassKg = nonnegative(prior + incoming, "availableMassKg");
  if (outgoing > availableMassKg) throw new RangeError("outgoingMassKg exceeds available mass");
  const expectedFinalKg = availableMassKg - outgoing;
  const closure = assertMassClose(final, expectedFinalKg, massTolerance(limits), "receiver ledger");
  return Object.freeze({
    priorMassKg: prior,
    incomingMassKg: incoming,
    outgoingMassKg: outgoing,
    finalMassKg: final,
    ...closure,
  });
}
