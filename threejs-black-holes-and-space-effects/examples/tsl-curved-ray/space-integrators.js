const DEFAULT_MAX_STEPS = 200000;

function requireFinite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

export function intersectSphereInterval(origin, direction, radius = 1) {
  const ox = origin[0];
  const oy = origin[1];
  const oz = origin[2];
  const dx = direction[0];
  const dy = direction[1];
  const dz = direction[2];
  const a = dx * dx + dy * dy + dz * dz;
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - a * c;
  if (!(a > 0) || discriminant < 0) return { hit: false, near: 0, far: 0 };
  const root = Math.sqrt(discriminant);
  const near = (-b - root) / a;
  const far = (-b + root) / a;
  return { hit: far >= Math.max(near, 0), near, far };
}

function simpson(fn, a, b) {
  const m = (a + b) * 0.5;
  return (b - a) * (fn(a) + 4 * fn(m) + fn(b)) / 6;
}

export function adaptiveSimpson(fn, a, b, tolerance = 1e-10, maxDepth = 24) {
  const whole = simpson(fn, a, b);
  const recurse = (left, right, estimate, epsilon, depth) => {
    const middle = (left + right) * 0.5;
    const lhs = simpson(fn, left, middle);
    const rhs = simpson(fn, middle, right);
    const correction = lhs + rhs - estimate;
    if (depth <= 0 || Math.abs(correction) <= 15 * epsilon) {
      return lhs + rhs + correction / 15;
    }
    return recurse(left, middle, lhs, epsilon * 0.5, depth - 1) +
      recurse(middle, right, rhs, epsilon * 0.5, depth - 1);
  };
  return recurse(a, b, whole, tolerance, maxDepth);
}

/**
 * Independent invariant-reduced Ellis transfer. B=b/a and L=l/a. The
 * singular turning point is removed with L=sqrt(Lturn^2+u^2).
 */
export function traceEllisImpact({ B, initialL = 8, escapeL = initialL, criticalEpsilon = 1e-7 }) {
  B = Math.abs(requireFinite("B", B));
  if (!(initialL > 0 && escapeL > 0)) throw new RangeError("Ellis boundaries must be positive");
  if (Math.abs(B - 1) <= criticalEpsilon) {
    return {
      model: "Ellis ultrastatic wormhole",
      termination: "unresolved-critical",
      exterior: 0,
      B,
      azimuth: Number.POSITIVE_INFINITY,
      invariantDrift: 0,
      acceptedSteps: 0,
    };
  }
  if (B === 0) {
    return {
      model: "Ellis ultrastatic wormhole",
      termination: "escaped",
      exterior: -1,
      B,
      azimuth: 0,
      invariantDrift: 0,
      acceptedSteps: 0,
    };
  }
  if (B < 1) {
    const integrand = (L) => {
      const r2 = L * L + 1;
      return B / (r2 * Math.sqrt(Math.max(1 - B * B / r2, Number.MIN_VALUE)));
    };
    const azimuth = adaptiveSimpson(integrand, -escapeL, initialL);
    return {
      model: "Ellis ultrastatic wormhole",
      termination: "escaped",
      regime: "traversing",
      exterior: -1,
      B,
      azimuth,
      invariantDrift: 0,
      acceptedSteps: 0,
    };
  }
  if (B > Math.sqrt(initialL * initialL + 1)) {
    return {
      model: "Ellis ultrastatic wormhole",
      termination: "outside-local-null-cone",
      regime: "invalid",
      exterior: 1,
      B,
      azimuth: 0,
      invariantDrift: 0,
      acceptedSteps: 0,
    };
  }
  const turningL = Math.sqrt(B * B - 1);
  const transformed = (u) => {
    const L = Math.sqrt(turningL * turningL + u * u);
    return B / (L * Math.sqrt(L * L + 1));
  };
  const incomingU = Math.sqrt(Math.max(initialL * initialL - turningL * turningL, 0));
  const outgoingU = Math.sqrt(Math.max(escapeL * escapeL - turningL * turningL, 0));
  const azimuth = adaptiveSimpson(transformed, 0, incomingU) +
    adaptiveSimpson(transformed, 0, outgoingU);
  return {
    model: "Ellis ultrastatic wormhole",
    termination: "escaped",
    regime: "turning",
    exterior: 1,
    B,
    azimuth,
    turningL,
    invariantDrift: 0,
    acceptedSteps: 0,
  };
}

function schwarzschildDerivative(state, mass, impact) {
  const [radius, radialMomentum] = state;
  const r2 = radius * radius;
  const r3 = r2 * radius;
  const r4 = r3 * radius;
  return [
    radialMomentum,
    impact * impact / r3 - 3 * mass * impact * impact / r4,
    impact / r2,
  ];
}

function rk4(state, h, derivative) {
  const add = (base, slope, scale) => base.map((v, i) => v + slope[i] * scale);
  const k1 = derivative(state);
  const k2 = derivative(add(state, k1, h * 0.5));
  const k3 = derivative(add(state, k2, h * 0.5));
  const k4 = derivative(add(state, k3, h));
  return state.map((value, index) =>
    value + h * (k1[index] + 2 * k2[index] + 2 * k3[index] + k4[index]) / 6);
}

function refineRadialEvent(previous, stepSize, derivative, targetRadius, iterations = 48) {
  let low = 0;
  let high = 1;
  const initialSign = Math.sign(previous[0] - targetRadius);
  let result = previous;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const fraction = (low + high) * 0.5;
    result = rk4(previous, stepSize * fraction, derivative);
    const sign = Math.sign(result[0] - targetRadius);
    if (sign === 0) break;
    if (sign === initialSign) low = fraction;
    else high = fraction;
  }
  result[0] = targetRadius;
  return result;
}

export function schwarzschildRadialInvariant(radius, radialMomentum, impact, mass = 1) {
  return radialMomentum * radialMomentum + (1 - 2 * mass / radius) * impact * impact /
    (radius * radius);
}

/**
 * Equatorial Schwarzschild null ray in geometric units G=c=1, E=1.
 * dr/dlambda=p_r, dp_r/dlambda=b^2/r^3-3Mb^2/r^4,
 * dphi/dlambda=b/r^2. Horizon and escape are continuous event classes;
 * accepted work never exceeds maxSteps.
 */
export function traceSchwarzschildNullRay({
  impact,
  mass = 1,
  boundaryRadius = 80,
  maxSteps = DEFAULT_MAX_STEPS,
  maxAffineStep = 0.08,
}) {
  impact = Math.abs(requireFinite("impact", impact));
  mass = requireFinite("mass", mass);
  if (!(mass > 0 && boundaryRadius > 2 * mass && Number.isInteger(maxSteps) && maxSteps > 0)) {
    throw new RangeError("invalid Schwarzschild integration domain");
  }
  const criticalImpact = 3 * Math.sqrt(3) * mass;
  const criticalTolerance = 1e-10 * Math.max(1, criticalImpact);
  const potential = (1 - 2 * mass / boundaryRadius) * impact * impact /
    (boundaryRadius * boundaryRadius);
  if (potential >= 1) return { termination: "outside-local-null-cone", acceptedSteps: 0 };
  if (Math.abs(impact - criticalImpact) <= criticalTolerance) {
    return {
      model: "Schwarzschild null geodesic",
      termination: "unresolved-critical",
      regime: "critical-separatrix",
      impact,
      criticalImpact,
      criticalTolerance,
      photonSphereRadius: 3 * mass,
      acceptedSteps: 0,
      minimumRadius: 3 * mass,
      maxInvariantDrift: 0,
    };
  }
  let state = [boundaryRadius, -Math.sqrt(1 - potential), 0];
  let acceptedSteps = 0;
  let minimumRadius = boundaryRadius;
  let maxInvariantDrift = Math.abs(
    schwarzschildRadialInvariant(state[0], state[1], impact, mass) - 1,
  );
  let turned = false;
  const horizon = 2 * mass;
  const derivative = (value) => schwarzschildDerivative(value, mass, impact);

  while (acceptedSteps < maxSteps) {
    const previous = state;
    const h = Math.min(maxAffineStep, Math.max(0.002, previous[0] * 0.002));
    const candidate = rk4(previous, h, derivative);
    acceptedSteps += 1;
    if (!candidate.every(Number.isFinite)) {
      return { termination: "invalid", acceptedSteps, minimumRadius, maxInvariantDrift };
    }
    minimumRadius = Math.min(minimumRadius, candidate[0]);
    maxInvariantDrift = Math.max(
      maxInvariantDrift,
      Math.abs(schwarzschildRadialInvariant(candidate[0], candidate[1], impact, mass) - 1),
    );
    if (candidate[0] <= horizon) {
      const eventState = refineRadialEvent(previous, h, derivative, horizon);
      minimumRadius = Math.min(minimumRadius, eventState[0]);
      maxInvariantDrift = Math.max(
        maxInvariantDrift,
        Math.abs(schwarzschildRadialInvariant(
          eventState[0],
          eventState[1],
          impact,
          mass,
        ) - 1),
      );
      return {
        model: "Schwarzschild null geodesic",
        termination: "horizon",
        impact,
        criticalImpact,
        photonSphereRadius: 3 * mass,
        acceptedSteps,
        minimumRadius: eventState[0],
        maxInvariantDrift,
        state: eventState,
        eventResidual: Math.abs(eventState[0] - horizon),
      };
    }
    if (previous[1] < 0 && candidate[1] >= 0) turned = true;
    if (turned && candidate[0] >= boundaryRadius && candidate[1] > 0) {
      const eventState = refineRadialEvent(previous, h, derivative, boundaryRadius);
      const flatFiniteAngle = 2 * Math.acos(Math.min(1, impact / boundaryRadius));
      return {
        model: "Schwarzschild null geodesic",
        termination: "escaped",
        impact,
        criticalImpact,
        photonSphereRadius: 3 * mass,
        acceptedSteps,
        minimumRadius,
        maxInvariantDrift,
        azimuth: eventState[2],
        deflection: eventState[2] - flatFiniteAngle,
        state: eventState,
        eventResidual: Math.abs(eventState[0] - boundaryRadius),
      };
    }
    state = candidate;
  }
  return {
    model: "Schwarzschild null geodesic",
    termination: "step-cap",
    impact,
    criticalImpact,
    photonSphereRadius: 3 * mass,
    acceptedSteps,
    minimumRadius,
    maxInvariantDrift,
  };
}

export function traceArtisticBoundedRay({
  origin,
  direction,
  boundRadius = 1,
  maxSteps = 96,
  stepLength = 0.01,
  bendingPower = 0.3,
  coreRadius = 0.13,
}) {
  const interval = intersectSphereInterval(origin, direction, boundRadius);
  if (!interval.hit) {
    return { termination: "miss", acceptedSteps: 0, transmittance: 1, radiance: 0 };
  }
  let position = origin.map((value, lane) => value + direction[lane] * Math.max(interval.near, 0));
  let rayDirection = [...direction];
  let transmittance = 1;
  let radiance = 0;
  let acceptedSteps = 0;
  while (acceptedSteps < maxSteps) {
    const radius = Math.hypot(...position);
    if (radius <= coreRadius) return { termination: "core", acceptedSteps, transmittance, radiance };
    const radial = position.map((v) => v / radius);
    const projection = radial.reduce((sum, v, lane) => sum + v * rayDirection[lane], 0);
    const transverse = radial.map((v, lane) => v - projection * rayDirection[lane]);
    const magnitude = stepLength * bendingPower / Math.max(radius * radius, 0.035);
    rayDirection = rayDirection.map((v, lane) => v - transverse[lane] * magnitude);
    const norm = Math.hypot(...rayDirection);
    rayDirection = rayDirection.map((v) => v / norm);
    position = position.map((v, lane) => v + rayDirection[lane] * stepLength);
    acceptedSteps += 1;
    if (Math.hypot(...position) >= boundRadius && position.reduce(
      (sum, v, lane) => sum + v * rayDirection[lane], 0,
    ) > 0) return { termination: "escaped", acceptedSteps, transmittance, radiance };
  }
  return { termination: "step-cap", acceptedSteps, transmittance, radiance };
}

export function validateRayResult(result, {
  maxSteps,
  requireFiniteTransfer = true,
  eventTolerance = 1e-10,
  requiredTermination = null,
  invariantTolerance = 1e-6,
} = {}) {
  if (!result || typeof result.termination !== "string") throw new Error("missing termination class");
  if (!Number.isInteger(result.acceptedSteps) || result.acceptedSteps < 0) {
    throw new Error("acceptedSteps must be a non-negative integer");
  }
  if (Number.isInteger(maxSteps) && result.acceptedSteps > maxSteps) {
    throw new Error(`acceptedSteps ${result.acceptedSteps} exceeds exact cap ${maxSteps}`);
  }
  if (["invalid", "step-cap", "unresolved-critical", "outside-local-null-cone"]
    .includes(result.termination)) {
    throw new Error(`incomplete ray termination is not valid evidence: ${result.termination}`);
  }
  if (requiredTermination !== null && result.termination !== requiredTermination) {
    throw new Error(`required termination ${requiredTermination}; received ${result.termination}`);
  }
  if (["escaped", "horizon"].includes(result.termination) && result.acceptedSteps === 0) {
    throw new Error(`${result.termination} evidence requires at least one accepted step`);
  }
  if (result.state !== undefined &&
      (!Array.isArray(result.state) || result.state.length === 0 || !result.state.every(Number.isFinite))) {
    throw new Error("ray state must contain finite values");
  }
  if (result.maxInvariantDrift !== undefined &&
      (!Number.isFinite(result.maxInvariantDrift) || result.maxInvariantDrift > invariantTolerance)) {
    throw new Error(`invariant drift ${result.maxInvariantDrift} exceeds ${invariantTolerance}`);
  }
  if (result.transmittance !== undefined &&
      (!Number.isFinite(result.transmittance) || result.transmittance < 0 || result.transmittance > 1)) {
    throw new Error("transmittance must be finite and in [0,1]");
  }
  if (requireFiniteTransfer && result.termination === "escaped" && result.deflection !== undefined &&
      !Number.isFinite(result.deflection)) {
    throw new Error("escaped deflection must be finite");
  }
  if (result.eventResidual !== undefined &&
      (!Number.isFinite(result.eventResidual) || result.eventResidual > eventTolerance)) {
    throw new Error(`continuous event residual ${result.eventResidual} exceeds ${eventTolerance}`);
  }
  return true;
}
