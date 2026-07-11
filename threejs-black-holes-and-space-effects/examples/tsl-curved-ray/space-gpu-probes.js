import { StorageBufferAttribute } from "three/webgpu";
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  bool,
  clamp,
  float,
  instanceIndex,
  int,
  max,
  min,
  mix,
  pow,
  storage,
  uint,
  uniform,
  uvec4,
  vec3,
  vec4,
} from "three/tsl";

export const SPACE_PROBE_TERMINATION = Object.freeze({
  inactive: 0,
  escaped: 1,
  horizon: 2,
  critical: 3,
  stepCap: 4,
  invalid: 5,
});

function rk4Step(state, step, derivative) {
  const k1 = derivative(state);
  const k2 = derivative(state.map((value, index) => value + k1[index] * step * 0.5));
  const k3 = derivative(state.map((value, index) => value + k2[index] * step * 0.5));
  const k4 = derivative(state.map((value, index) => value + k3[index] * step));
  return state.map((value, index) =>
    value + step * (k1[index] + 2 * k2[index] + 2 * k3[index] + k4[index]) / 6);
}

export function integrateEllisProbeCPU({
  L = 8,
  radialMomentum = null,
  impact = 0.4,
  azimuth = 0,
  stepSize = 0.0005,
  escapeL = Math.abs(L),
  maxSteps = 8192,
} = {}) {
  let p = radialMomentum ?? -Math.sqrt(Math.max(0, 1 - impact * impact / (L * L + 1)));
  let state = [L, p, azimuth];
  let acceptedSteps = 0;
  let maxInvariantDrift = Math.abs(p * p + impact * impact / (L * L + 1) - 1);
  const derivative = ([coordinate, momentum]) => [
    (coordinate * coordinate + 1) * momentum,
    impact * impact * coordinate / (coordinate * coordinate + 1),
    impact,
  ];
  while (acceptedSteps < maxSteps) {
    state = rk4Step(state, stepSize, derivative);
    acceptedSteps += 1;
    const invariant = state[1] * state[1] + impact * impact / (state[0] * state[0] + 1);
    maxInvariantDrift = Math.max(maxInvariantDrift, Math.abs(invariant - 1));
    if (!state.every(Number.isFinite)) {
      return { termination: "invalid", state, acceptedSteps, maxInvariantDrift };
    }
    if (Math.abs(state[0]) >= escapeL && Math.sign(state[0] || 1) * state[1] > 0) {
      return { termination: "escaped", state, acceptedSteps, maxInvariantDrift };
    }
  }
  return { termination: "step-cap", state, acceptedSteps, maxInvariantDrift };
}

export function integrateSchwarzschildProbeCPU({
  radius = 80,
  radialMomentum = null,
  impact = 8,
  azimuth = 0,
  mass = 1,
  boundaryRadius = radius,
  maxSteps = 65536,
  maxAffineStep = 0.08,
} = {}) {
  const criticalImpact = 3 * Math.sqrt(3) * mass;
  const criticalTolerance = 1e-10 * Math.max(1, criticalImpact);
  const potential = (1 - 2 * mass / radius) * impact * impact / (radius * radius);
  let state = [
    radius,
    radialMomentum ?? -Math.sqrt(Math.max(0, 1 - potential)),
    azimuth,
  ];
  let acceptedSteps = 0;
  let turned = false;
  let minimumRadius = radius;
  let maxInvariantDrift = Math.abs(state[1] * state[1] + potential - 1);
  if (Math.abs(Math.abs(impact) - criticalImpact) <= criticalTolerance) {
    return {
      termination: "unresolved-critical",
      state,
      acceptedSteps: 0,
      minimumRadius: 3 * mass,
      maxInvariantDrift,
      criticalImpact,
      criticalTolerance,
    };
  }
  const derivative = ([r, p]) => [
    p,
    impact * impact / (r * r * r) - 3 * mass * impact * impact / (r * r * r * r),
    impact / (r * r),
  ];
  while (acceptedSteps < maxSteps) {
    const previous = state;
    const previousP = previous[1];
    const stepSize = Math.min(maxAffineStep, Math.max(0.002, state[0] * 0.002));
    const candidate = rk4Step(state, stepSize, derivative);
    state = candidate;
    acceptedSteps += 1;
    minimumRadius = Math.min(minimumRadius, state[0]);
    const invariant = state[1] * state[1] +
      (1 - 2 * mass / state[0]) * impact * impact / (state[0] * state[0]);
    maxInvariantDrift = Math.max(maxInvariantDrift, Math.abs(invariant - 1));
    if (!state.every(Number.isFinite)) {
      return { termination: "invalid", state, acceptedSteps, minimumRadius, maxInvariantDrift };
    }
    if (state[0] <= 2 * mass) {
      const target = 2 * mass;
      const fraction = Math.max(0, Math.min(1,
        (target - previous[0]) / (candidate[0] - previous[0]),
      ));
      state = previous.map((value, index) => value + (candidate[index] - value) * fraction);
      state[0] = target;
      minimumRadius = target;
      return { termination: "horizon", state, acceptedSteps, minimumRadius, maxInvariantDrift };
    }
    if (previousP < 0 && state[1] >= 0) turned = true;
    if (turned && state[0] >= boundaryRadius && state[1] > 0) {
      const fraction = Math.max(0, Math.min(1,
        (boundaryRadius - previous[0]) / (candidate[0] - previous[0]),
      ));
      state = previous.map((value, index) => value + (candidate[index] - value) * fraction);
      state[0] = boundaryRadius;
      return { termination: "escaped", state, acceptedSteps, minimumRadius, maxInvariantDrift };
    }
  }
  return { termination: "step-cap", state, acceptedSteps, minimumRadius, maxInvariantDrift };
}

const ellisDerivativeNode = Fn(({ state, impact }) => {
  const radiusSquared = state.x.mul(state.x).add(1);
  return vec3(
    radiusSquared.mul(state.y),
    impact.mul(impact).mul(state.x).div(radiusSquared),
    impact,
  );
});

const schwarzschildDerivativeNode = Fn(({ state, impact, mass }) => {
  const radius2 = state.x.mul(state.x);
  const radius3 = radius2.mul(state.x);
  const radius4 = radius3.mul(state.x);
  return vec3(
    state.y,
    impact.mul(impact).div(radius3).sub(mass.mul(3).mul(impact.mul(impact)).div(radius4)),
    impact.div(radius2),
  );
});

function rk4Node(state, stepSize, impact, derivative, mass = null) {
  const args = (value) => mass
    ? derivative({ state: value, impact, mass })
    : derivative({ state: value, impact });
  const k1 = args(state);
  const k2 = args(state.add(k1.mul(stepSize.mul(0.5))));
  const k3 = args(state.add(k2.mul(stepSize.mul(0.5))));
  const k4 = args(state.add(k3.mul(stepSize)));
  return state.add(k1.add(k2.mul(2)).add(k3.mul(2)).add(k4).mul(stepSize.div(6)));
}

/**
 * Small direct GPU integrator used for physical probe parity. The coherent
 * image path remains a critical-split transfer table; this path executes the
 * metric ODE on GPU storage and is deliberately read back only by validation.
 */
export class SpaceMetricProbeIntegrator {
  constructor({ capacity = 16, ellisMaxSteps = 8192, schwarzschildMaxSteps = 16384 } = {}) {
    this.capacity = capacity;
    this.ellisMaxSteps = ellisMaxSteps;
    this.schwarzschildMaxSteps = schwarzschildMaxSteps;
    this.input = new StorageBufferAttribute(capacity, 4);
    this.output = new StorageBufferAttribute(capacity, 4);
    this.diagnostics = new StorageBufferAttribute(capacity, 4);
    this.results = new StorageBufferAttribute(new Uint32Array(capacity * 4), 4);
    this.activeCountNode = uniform(0, "uint").setName("spaceProbeActiveCount");
    this.ellisStepNode = uniform(0.0005).setName("ellisProbeStep");
    this.ellisEscapeNode = uniform(8).setName("ellisProbeEscapeL");
    this.schwarzschildMassNode = uniform(1).setName("schwarzschildProbeMass");
    this.schwarzschildBoundaryNode = uniform(80).setName("schwarzschildProbeBoundary");
    this.schwarzschildMaxStepNode = uniform(0.08).setName("schwarzschildProbeMaxStep");
    this.model = null;
    this.dispatchCount = 0;
    this.disposed = false;
    this.createKernels();
  }

  createKernels() {
    const input = storage(this.input, "vec4", this.capacity);
    const output = storage(this.output, "vec4", this.capacity);
    const diagnostics = storage(this.diagnostics, "vec4", this.capacity);
    const results = storage(this.results, "uvec4", this.capacity);

    this.ellisKernel = Fn(() => {
      const index = instanceIndex;
      If(index.lessThan(this.activeCountNode), () => {
        const packed = input.element(index);
        const state = vec3(packed.x, packed.y, packed.w).toVar("ellisProbeState");
        const impact = packed.z;
        const accepted = uint(0).toVar("ellisProbeAcceptedSteps");
        const termination = uint(SPACE_PROBE_TERMINATION.stepCap).toVar("ellisProbeTermination");
        const done = bool(false).toVar("ellisProbeDone");
        const maxDrift = float(0).toVar("ellisProbeInvariantDrift");
        Loop({ start: int(0), end: int(this.ellisMaxSteps), type: "int" }, () => {
          If(done, () => Break());
          const candidate = rk4Node(
            state,
            this.ellisStepNode,
            impact,
            ellisDerivativeNode,
          );
          state.assign(candidate);
          accepted.addAssign(uint(1));
          const radiusSquared = state.x.mul(state.x).add(1);
          const invariant = state.y.mul(state.y).add(impact.mul(impact).div(radiusSquared));
          maxDrift.assign(max(maxDrift, abs(invariant.sub(1))));
          const invalid = state.x.notEqual(state.x)
            .or(state.y.notEqual(state.y))
            .or(state.z.notEqual(state.z));
          If(invalid, () => {
            termination.assign(uint(SPACE_PROBE_TERMINATION.invalid));
            done.assign(true);
          });
          const escaped = abs(state.x).greaterThanEqual(this.ellisEscapeNode)
            .and(state.x.mul(state.y).greaterThan(0));
          If(escaped, () => {
            termination.assign(uint(SPACE_PROBE_TERMINATION.escaped));
            done.assign(true);
          });
        });
        output.element(index).assign(vec4(state.x, state.y, impact, state.z));
        diagnostics.element(index).assign(vec4(maxDrift, abs(state.x), 0, 0));
        results.element(index).assign(uvec4(
          termination,
          accepted,
          selectSign({ value: state.x }),
          selectInvalid({ value: termination }),
        ));
      });
    })().compute(this.capacity, [64]).setName("space:ellis-direct-probes");

    this.schwarzschildKernel = Fn(() => {
      const index = instanceIndex;
      If(index.lessThan(this.activeCountNode), () => {
        const packed = input.element(index);
        const state = vec3(packed.x, packed.y, packed.w).toVar("schwarzschildProbeState");
        const impact = packed.z;
        const accepted = uint(0).toVar("schwarzschildProbeAcceptedSteps");
        const termination = uint(SPACE_PROBE_TERMINATION.stepCap).toVar("schwarzschildProbeTermination");
        const done = bool(false).toVar("schwarzschildProbeDone");
        const turned = bool(false).toVar("schwarzschildProbeTurned");
        const maxDrift = float(0).toVar("schwarzschildProbeInvariantDrift");
        const minimumRadius = float(packed.x).toVar("schwarzschildProbeMinimumRadius");
        const criticalImpact = this.schwarzschildMassNode.mul(3 * Math.sqrt(3));
        const criticalTolerance = max(abs(criticalImpact), 1).mul(1e-5);
        If(abs(impact.sub(criticalImpact)).lessThanEqual(criticalTolerance), () => {
          termination.assign(uint(SPACE_PROBE_TERMINATION.critical));
          done.assign(true);
        });
        Loop({ start: int(0), end: int(this.schwarzschildMaxSteps), type: "int" }, () => {
          If(done, () => Break());
          const previousState = vec3(state).toVar("schwarzschildPreviousState");
          const previousMomentum = float(state.y).toVar("schwarzschildPreviousMomentum");
          const stepSize = clamp(
            state.x.mul(0.002),
            0.002,
            this.schwarzschildMaxStepNode,
          );
          const candidate = rk4Node(
            state,
            stepSize,
            impact,
            schwarzschildDerivativeNode,
            this.schwarzschildMassNode,
          );
          state.assign(candidate);
          accepted.addAssign(uint(1));
          minimumRadius.assign(min(minimumRadius, state.x));
          const invariant = state.y.mul(state.y).add(
            float(1).sub(this.schwarzschildMassNode.mul(2).div(state.x))
              .mul(impact.mul(impact))
              .div(state.x.mul(state.x)),
          );
          maxDrift.assign(max(maxDrift, abs(invariant.sub(1))));
          const invalid = state.x.notEqual(state.x)
            .or(state.y.notEqual(state.y))
            .or(state.z.notEqual(state.z));
          If(invalid, () => {
            termination.assign(uint(SPACE_PROBE_TERMINATION.invalid));
            done.assign(true);
          });
          If(done.not().and(state.x.lessThanEqual(this.schwarzschildMassNode.mul(2))), () => {
            const eventRadius = this.schwarzschildMassNode.mul(2);
            const fraction = clamp(
              eventRadius.sub(previousState.x).div(state.x.sub(previousState.x)),
              0,
              1,
            );
            state.assign(mix(previousState, state, fraction));
            state.x.assign(eventRadius);
            minimumRadius.assign(eventRadius);
            termination.assign(uint(SPACE_PROBE_TERMINATION.horizon));
            done.assign(true);
          });
          If(previousMomentum.lessThan(0).and(state.y.greaterThanEqual(0)), () => turned.assign(true));
          If(
            done.not().and(turned).and(state.x.greaterThanEqual(this.schwarzschildBoundaryNode))
              .and(state.y.greaterThan(0)),
            () => {
              const fraction = clamp(
                this.schwarzschildBoundaryNode.sub(previousState.x)
                  .div(state.x.sub(previousState.x)),
                0,
                1,
              );
              state.assign(mix(previousState, state, fraction));
              state.x.assign(this.schwarzschildBoundaryNode);
              termination.assign(uint(SPACE_PROBE_TERMINATION.escaped));
              done.assign(true);
            },
          );
        });
        output.element(index).assign(vec4(state.x, state.y, impact, state.z));
        diagnostics.element(index).assign(vec4(maxDrift, minimumRadius, 0, 0));
        results.element(index).assign(uvec4(
          termination,
          accepted,
          uint(1),
          selectInvalid({ value: termination }),
        ));
      });
    })().compute(this.capacity, [64]).setName("space:schwarzschild-direct-probes");
  }

  setEllisProbes(probes, { stepSize = 0.0005, escapeL = 8 } = {}) {
    if (probes.length > this.capacity) throw new RangeError("too many Ellis probes");
    this.input.array.fill(0);
    probes.forEach((probe, index) => {
      const L = probe.L ?? escapeL;
      const impact = probe.impact;
      const momentum = probe.radialMomentum ?? -Math.sqrt(
        Math.max(0, 1 - impact * impact / (L * L + 1)),
      );
      this.input.array.set([L, momentum, impact, probe.azimuth ?? 0], index * 4);
    });
    this.input.needsUpdate = true;
    this.activeCountNode.value = probes.length;
    this.ellisStepNode.value = stepSize;
    this.ellisEscapeNode.value = escapeL;
    this.model = "ellis";
  }

  setSchwarzschildProbes(probes, { mass = 1, boundaryRadius = 80, maxAffineStep = 0.08 } = {}) {
    if (probes.length > this.capacity) throw new RangeError("too many Schwarzschild probes");
    this.input.array.fill(0);
    probes.forEach((probe, index) => {
      const radius = probe.radius ?? boundaryRadius;
      const impact = probe.impact;
      const potential = (1 - 2 * mass / radius) * impact * impact / (radius * radius);
      const momentum = probe.radialMomentum ?? -Math.sqrt(Math.max(0, 1 - potential));
      this.input.array.set([radius, momentum, impact, probe.azimuth ?? 0], index * 4);
    });
    this.input.needsUpdate = true;
    this.activeCountNode.value = probes.length;
    this.schwarzschildMassNode.value = mass;
    this.schwarzschildBoundaryNode.value = boundaryRadius;
    this.schwarzschildMaxStepNode.value = maxAffineStep;
    this.model = "schwarzschild";
  }

  dispatch(renderer) {
    if (this.disposed) throw new Error("SpaceMetricProbeIntegrator used after dispose()");
    if (renderer?.backend?.isWebGPUBackend !== true) {
      throw new Error("native WebGPU is required for direct metric probes");
    }
    if (!this.model) throw new Error("configure direct metric probes before dispatch");
    renderer.compute(this.model === "ellis" ? this.ellisKernel : this.schwarzschildKernel);
    this.dispatchCount += 1;
  }

  async readback(renderer) {
    if (this.disposed) throw new Error("SpaceMetricProbeIntegrator used after dispose()");
    const [output, diagnostics, results] = await Promise.all([
      renderer.getArrayBufferAsync(this.output),
      renderer.getArrayBufferAsync(this.diagnostics),
      renderer.getArrayBufferAsync(this.results),
    ]);
    return {
      model: this.model,
      count: this.activeCountNode.value,
      maxSteps: this.model === "ellis" ? this.ellisMaxSteps : this.schwarzschildMaxSteps,
      output: new Float32Array(output),
      diagnostics: new Float32Array(diagnostics),
      results: new Uint32Array(results),
    };
  }

  describe() {
    return {
      model: this.model,
      activeProbes: this.activeCountNode.value,
      dispatchCount: this.dispatchCount,
      ellisMaxSteps: this.ellisMaxSteps,
      schwarzschildMaxSteps: this.schwarzschildMaxSteps,
      bytes: this.input.array.byteLength + this.output.array.byteLength +
        this.diagnostics.array.byteLength + this.results.array.byteLength,
      readbackPolicy: "validation-only",
      disposed: this.disposed,
    };
  }

  dispose() {
    if (this.disposed) return;
    for (const attribute of [this.input, this.output, this.diagnostics, this.results]) {
      attribute.dispose?.();
    }
    this.disposed = true;
  }
}

const selectSign = Fn(({ value }) => value.lessThan(0).select(uint(0xffffffff), uint(1)));
const selectInvalid = Fn(({ value }) => value.equal(uint(SPACE_PROBE_TERMINATION.invalid)).select(uint(1), uint(0)));
