import assert from "node:assert/strict";
import { validateRayResult } from "./space-integrators.js";

const mutations = [
  [{ acceptedSteps: 1 }, /missing termination/],
  [{ termination: "escaped", acceptedSteps: -1 }, /non-negative integer/],
  [{ termination: "step-cap", acceptedSteps: 17 }, /exceeds exact cap/],
  [{ termination: "step-cap", acceptedSteps: 16 }, /incomplete ray termination/],
  [{ termination: "unresolved-critical", acceptedSteps: 0 }, /incomplete ray termination/],
  [{ termination: "escaped", acceptedSteps: 0 }, /at least one accepted step/],
  [{ termination: "escaped", acceptedSteps: 2, state: [1, Number.NaN, 0] }, /finite values/],
  [{ termination: "escaped", acceptedSteps: 2, maxInvariantDrift: 1e-3 }, /invariant drift/],
  [{ termination: "horizon", acceptedSteps: 2 }, /required termination escaped/],
  [{ termination: "escaped", acceptedSteps: 2, transmittance: -0.1 }, /transmittance/],
  [{ termination: "escaped", acceptedSteps: 2, deflection: Number.NaN }, /deflection/],
  [{ termination: "horizon", acceptedSteps: 2, eventResidual: 1e-4 }, /continuous event residual/],
];

for (const [mutation, pattern] of mutations) {
  assert.throws(() => validateRayResult(mutation, {
    maxSteps: 16,
    ...(mutation.termination === "horizon" && mutation.eventResidual === undefined
      ? { requiredTermination: "escaped" }
      : {}),
  }), pattern);
}
console.log(`Space integrator mutation gates passed (${mutations.length})`);
