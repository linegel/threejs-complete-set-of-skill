const THROAT_RADIUS = 1.2;
const DIMENSIONLESS_ESCAPE_L = 24;
const CRITICAL_TOLERANCE = 1e-12;
const ABSOLUTE_TOLERANCE = 2e-11;
const RELATIVE_TOLERANCE = 2e-10;
const MIN_STEP = 1e-6;
const MAX_STEP = 0.025;
const MAX_ATTEMPTS = 200000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function vec3(x, y, z) {
  return [x, y, z];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length3(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize(value) {
  const valueLength = length3(value);
  assert(valueLength > 0 && Number.isFinite(valueLength), "Cannot normalize a non-finite or zero vector.");
  return value.map((component) => component / valueLength);
}

function add(a, b) {
  return a.map((value, index) => value + b[index]);
}

function scale(value, scalar) {
  return value.map((component) => component * scalar);
}

function rotateY(value, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    cosine * value[0] + sine * value[2],
    value[1],
    -sine * value[0] + cosine * value[2],
  ];
}

function angularError(a, b) {
  const normalizedA = normalize(a);
  const normalizedB = normalize(b);
  // atan2(|a x b|, a dot b) remains well-conditioned for the sub-microradian
  // rotational-symmetry gate; acos(dot) magnifies one-ulp dot errors there.
  return Math.atan2(
    length3(cross(normalizedA, normalizedB)),
    Math.min(1, Math.max(-1, dot(normalizedA, normalizedB))),
  );
}

function deterministicAlternateNormal(radialAxis) {
  const alternateAxis = Math.abs(radialAxis[1]) < 0.75
    ? vec3(0, 1, 0)
    : vec3(1, 0, 0);
  return normalize(cross(radialAxis, alternateAxis));
}

function ellisInvariant([L, radialMomentum], B) {
  return radialMomentum * radialMomentum + B * B / (L * L + 1);
}

function ellisDerivative([L, radialMomentum], B) {
  const arealRadiusSquared = L * L + 1;
  return [
    arealRadiusSquared * radialMomentum,
    B * B * L / arealRadiusSquared,
    B,
  ];
}

function addScaled(state, derivative, amount) {
  return state.map((value, index) => value + derivative[index] * amount);
}

function rk4Step(state, stepSize, B) {
  const k1 = ellisDerivative(state, B);
  const k2 = ellisDerivative(addScaled(state, k1, stepSize * 0.5), B);
  const k3 = ellisDerivative(addScaled(state, k2, stepSize * 0.5), B);
  const k4 = ellisDerivative(addScaled(state, k3, stepSize), B);

  return state.map(
    (value, index) => value + stepSize *
      (k1[index] + 2 * k2[index] + 2 * k3[index] + k4[index]) / 6,
  );
}

function rk4StepDoubling(state, stepSize, B) {
  const full = rk4Step(state, stepSize, B);
  const firstHalf = rk4Step(state, stepSize * 0.5, B);
  const twoHalf = rk4Step(firstHalf, stepSize * 0.5, B);
  const error = twoHalf.map((value, index) => (value - full[index]) / 15);
  const corrected = twoHalf.map((value, index) => value + error[index]);
  const scaledError = Math.max(...error.map((value, index) => {
    const componentScale = ABSOLUTE_TOLERANCE + RELATIVE_TOLERANCE *
      Math.max(Math.abs(state[index]), Math.abs(corrected[index]));
    return Math.abs(value) / componentScale;
  }));

  return { corrected, scaledError };
}

function classifyEllisRegime(B, L, radialMomentum) {
  if (Math.sign(L || 1) * radialMomentum >= 0) {
    return "outward";
  }
  if (Math.abs(B - 1) <= CRITICAL_TOLERANCE) {
    return "critical";
  }
  return B < 1 ? "traversing" : "turning";
}

function initializeEllisRay({ origin, direction, exteriorSign = 1 }) {
  assert(exteriorSign === 1 || exteriorSign === -1, "exteriorSign must be +1 or -1.");
  const rayDirection = normalize(direction);
  const arealRadius = length3(origin);
  assert(
    arealRadius >= THROAT_RADIUS,
    "Areal-radius origins inside the throat are invalid; provide signed chart state instead.",
  );

  const radialAxis = normalize(origin);
  const impactCross = cross(origin, rayDirection);
  const dimensionalImpact = length3(impactCross);
  const B = dimensionalImpact / THROAT_RADIUS;
  const nearRadialBasis = B < 1e-10;
  const orbitalNormal = nearRadialBasis
    ? deterministicAlternateNormal(radialAxis)
    : normalize(impactCross);
  const tangentAxis = normalize(cross(orbitalNormal, radialAxis));
  const L = exteriorSign * Math.sqrt(
    Math.max(arealRadius * arealRadius / (THROAT_RADIUS * THROAT_RADIUS) - 1, 0),
  );
  const outwardMomentum = dot(radialAxis, rayDirection);
  const radialMomentum = exteriorSign * outwardMomentum;
  const invariant = ellisInvariant([L, radialMomentum], B);

  assert(Math.abs(invariant - 1) < 2e-12, `Initialization violates null invariant: ${invariant}.`);

  return {
    state: [L, radialMomentum, 0],
    B,
    dimensionalImpact,
    nearRadialBasis,
    radialAxis,
    tangentAxis,
    regime: classifyEllisRegime(B, L, radialMomentum),
  };
}

function crossedEscape(previous, candidate) {
  if (candidate[0] >= DIMENSIONLESS_ESCAPE_L && candidate[1] > 0) {
    return DIMENSIONLESS_ESCAPE_L;
  }
  if (candidate[0] <= -DIMENSIONLESS_ESCAPE_L && candidate[1] < 0) {
    return -DIMENSIONLESS_ESCAPE_L;
  }
  return null;
}

function refineEscape(previous, stepSize, B, targetL) {
  let low = 0;
  let high = 1;
  let lowValue = previous[0] - targetL;
  let result = previous;

  for (let iteration = 0; iteration < 64; iteration += 1) {
    const fraction = (low + high) * 0.5;
    const halfStep = stepSize * fraction * 0.5;
    const midpoint = rk4Step(previous, halfStep, B);
    const candidate = rk4Step(midpoint, halfStep, B);
    const value = candidate[0] - targetL;
    result = candidate;

    if (Math.sign(value) === Math.sign(lowValue)) {
      low = fraction;
      lowValue = value;
    } else {
      high = fraction;
    }
  }

  const radialSign = Math.sign(result[1]) || Math.sign(targetL);
  const radialMomentum = radialSign * Math.sqrt(
    Math.max(0, 1 - B * B / (targetL * targetL + 1)),
  );
  return [targetL, radialMomentum, result[2]];
}

function reconstructExitDirection(state, B, radialAxis, tangentAxis) {
  const [L, radialMomentum, phi] = state;
  const radialAtPhi = add(
    scale(radialAxis, Math.cos(phi)),
    scale(tangentAxis, Math.sin(phi)),
  );
  const azimuthAtPhi = add(
    scale(radialAxis, -Math.sin(phi)),
    scale(tangentAxis, Math.cos(phi)),
  );
  const arealRadius = Math.sqrt(L * L + 1);
  const outwardRadialMomentum = Math.sign(L) * radialMomentum;
  const direction = normalize(add(
    scale(radialAtPhi, outwardRadialMomentum),
    scale(azimuthAtPhi, B / arealRadius),
  ));

  return { direction, radialAtPhi, azimuthAtPhi };
}

function integrateEllisRay(initialization) {
  if (initialization.regime === "critical") {
    return {
      ...initialization,
      termination: "unresolved-critical",
      acceptedSteps: 0,
      rejectedAttempts: 0,
      maxInvariantDrift: Math.abs(ellisInvariant(initialization.state, initialization.B) - 1),
    };
  }

  let state = [...initialization.state];
  let stepSize = 0.004;
  let acceptedSteps = 0;
  let rejectedAttempts = 0;
  let attempts = 0;
  let maxInvariantDrift = Math.abs(ellisInvariant(state, initialization.B) - 1);
  let turned = false;

  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    const proposal = rk4StepDoubling(state, stepSize, initialization.B);

    if (!Number.isFinite(proposal.scaledError) || proposal.scaledError > 1) {
      rejectedAttempts += 1;
      const factor = Number.isFinite(proposal.scaledError)
        ? Math.max(0.1, Math.min(0.5, 0.9 * proposal.scaledError ** -0.2))
        : 0.1;
      stepSize = Math.max(MIN_STEP, stepSize * factor);
      assert(stepSize > MIN_STEP || proposal.scaledError <= 1, "Ellis integrator reached minimum step with excessive error.");
      continue;
    }

    const previous = state;
    const candidate = proposal.corrected;
    if (previous[1] < 0 && candidate[1] >= 0) {
      turned = true;
    }

    const escapeTarget = crossedEscape(previous, candidate);
    state = escapeTarget === null
      ? candidate
      : refineEscape(previous, stepSize, initialization.B, escapeTarget);
    acceptedSteps += 1;
    maxInvariantDrift = Math.max(
      maxInvariantDrift,
      Math.abs(ellisInvariant(state, initialization.B) - 1),
    );

    if (escapeTarget !== null) {
      const exit = reconstructExitDirection(
        state,
        initialization.B,
        initialization.radialAxis,
        initialization.tangentAxis,
      );
      return {
        ...initialization,
        state,
        termination: "escaped",
        escapeSide: state[0] < 0 ? "negative" : "positive",
        acceptedSteps,
        rejectedAttempts,
        attempts,
        turned,
        maxInvariantDrift,
        finalDirection: exit.direction,
        exitRadialDirection: exit.radialAtPhi,
      };
    }

    const factor = proposal.scaledError === 0
      ? 2
      : Math.max(0.5, Math.min(2, 0.9 * proposal.scaledError ** -0.2));
    stepSize = Math.max(MIN_STEP, Math.min(MAX_STEP, stepSize * factor));
  }

  throw new Error(`Ellis reference ray exceeded ${MAX_ATTEMPTS} bounded attempts.`);
}

function simpsonEstimate(fn, a, b) {
  const midpoint = (a + b) * 0.5;
  return (b - a) * (fn(a) + 4 * fn(midpoint) + fn(b)) / 6;
}

function adaptiveSimpson(fn, a, b, tolerance = 1e-11, maxDepth = 24) {
  const whole = simpsonEstimate(fn, a, b);

  function recurse(left, right, estimate, remainingTolerance, depth) {
    const midpoint = (left + right) * 0.5;
    const leftEstimate = simpsonEstimate(fn, left, midpoint);
    const rightEstimate = simpsonEstimate(fn, midpoint, right);
    const correction = leftEstimate + rightEstimate - estimate;

    if (depth <= 0 || Math.abs(correction) <= 15 * remainingTolerance) {
      return leftEstimate + rightEstimate + correction / 15;
    }

    return recurse(left, midpoint, leftEstimate, remainingTolerance * 0.5, depth - 1) +
      recurse(midpoint, right, rightEstimate, remainingTolerance * 0.5, depth - 1);
  }

  return recurse(a, b, whole, tolerance, maxDepth);
}

function independentAzimuth(initialization) {
  const [initialL, initialMomentum] = initialization.state;
  const { B, regime } = initialization;

  if (B === 0) {
    return 0;
  }

  if (regime === "traversing") {
    const integrand = (L) => {
      const radiusSquared = L * L + 1;
      return B / (radiusSquared * Math.sqrt(1 - B * B / radiusSquared));
    };
    return adaptiveSimpson(integrand, -DIMENSIONLESS_ESCAPE_L, initialL);
  }

  if (regime === "turning" || (regime === "outward" && B > 1)) {
    const turningL = Math.sqrt(Math.max(B * B - 1, 0));
    const integrand = (u) => {
      const L = Math.sqrt(turningL * turningL + u * u);
      return B / (L * Math.sqrt(L * L + 1));
    };
    const initialU = Math.sqrt(Math.max(initialL * initialL - turningL * turningL, 0));
    const escapeU = Math.sqrt(DIMENSIONLESS_ESCAPE_L ** 2 - turningL * turningL);
    const initialLeg = initialMomentum < 0
      ? adaptiveSimpson(integrand, 0, initialU)
      : -adaptiveSimpson(integrand, 0, initialU);
    return initialLeg + adaptiveSimpson(integrand, 0, escapeU);
  }

  const integrand = (L) => {
    const radiusSquared = L * L + 1;
    return B / (radiusSquared * Math.sqrt(1 - B * B / radiusSquared));
  };
  return adaptiveSimpson(integrand, initialL, DIMENSIONLESS_ESCAPE_L);
}

function incomingRayForImpact(B, { initialL = 3, rotation = 0 } = {}) {
  const dimensionlessRadius = Math.sqrt(initialL * initialL + 1);
  assert(B <= dimensionlessRadius, "Impact parameter exceeds the local null cone.");
  const tangentComponent = B / dimensionlessRadius;
  const inwardComponent = -Math.sqrt(Math.max(0, 1 - tangentComponent * tangentComponent));
  const origin = rotateY(vec3(0, 0, THROAT_RADIUS * dimensionlessRadius), rotation);
  const direction = rotateY(vec3(tangentComponent, 0, inwardComponent), rotation);
  return { origin, direction };
}

function assertClose(actual, expected, tolerance, label) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}, tolerance ${tolerance}.`,
  );
}

function validateIntegratedCase(name, ray, expectedRegime) {
  const initialization = initializeEllisRay(ray);
  assert(initialization.regime === expectedRegime, `${name}: expected ${expectedRegime}, got ${initialization.regime}.`);
  const result = integrateEllisRay(initialization);
  assert(result.termination === "escaped", `${name}: expected escaped, got ${result.termination}.`);
  assert(result.maxInvariantDrift < 2e-8, `${name}: invariant drift ${result.maxInvariantDrift}.`);
  assertClose(length3(result.finalDirection), 1, 2e-12, `${name} exit tangent norm`);

  const quadratureAzimuth = independentAzimuth(initialization);
  assertClose(result.state[2], quadratureAzimuth, 2e-7, `${name} ODE/quadrature azimuth`);

  const exitRadius = Math.sqrt(result.state[0] * result.state[0] + 1);
  const expectedTangentialMagnitude = initialization.B / exitRadius;
  const radialOnlyError = angularError(result.finalDirection, result.exitRadialDirection);
  assertClose(
    radialOnlyError,
    Math.asin(Math.min(1, expectedTangentialMagnitude)),
    2e-9,
    `${name} finite-exit tangent component`,
  );

  return {
    name,
    B: initialization.B,
    regime: initialization.regime,
    termination: result.termination,
    escapeSide: result.escapeSide,
    turned: result.turned,
    acceptedSteps: result.acceptedSteps,
    rejectedAttempts: result.rejectedAttempts,
    maxInvariantDrift: result.maxInvariantDrift,
    azimuth: result.state[2],
    quadratureAzimuth,
    radialOnlyErrorRadians: radialOnlyError,
    finalDirection: result.finalDirection,
  };
}

const radialOutward = validateIntegratedCase(
  "radial-outward",
  { origin: vec3(0, 0, THROAT_RADIUS * Math.sqrt(10)), direction: vec3(0, 0, 1) },
  "outward",
);
assertClose(radialOutward.azimuth, 0, 1e-14, "radial outward azimuth");

const radialInward = validateIntegratedCase(
  "radial-traversal",
  incomingRayForImpact(0),
  "traversing",
);
assert(radialInward.escapeSide === "negative", "Radial inward ray must traverse to the negative exterior.");

const negativeExteriorOutward = validateIntegratedCase(
  "negative-exterior-outward",
  {
    origin: vec3(0, 0, THROAT_RADIUS * Math.sqrt(10)),
    direction: vec3(0, 0, 1),
    exteriorSign: -1,
  },
  "outward",
);
assert(negativeExteriorOutward.escapeSide === "negative", "Negative-exterior outward ray must remain on the negative side.");

const traversing = validateIntegratedCase(
  "subcritical-traversal",
  incomingRayForImpact(0.35),
  "traversing",
);
assert(traversing.escapeSide === "negative", "B < 1 ray must traverse the Ellis throat.");
assert(traversing.turned === false, "B < 1 ray must not turn before the throat.");

const nearCriticalTraversal = validateIntegratedCase(
  "near-critical-traversal",
  incomingRayForImpact(0.999),
  "traversing",
);
assert(nearCriticalTraversal.azimuth > traversing.azimuth, "Near-critical traversal must wind more than an ordinary traversal.");

const turning = validateIntegratedCase(
  "supercritical-turning",
  incomingRayForImpact(1.4),
  "turning",
);
assert(turning.escapeSide === "positive", "B > 1 ray must return to the positive exterior.");
assert(turning.turned === true, "B > 1 ray must cross radial-momentum zero.");

const criticalInitialization = initializeEllisRay(incomingRayForImpact(1));
const critical = integrateEllisRay(criticalInitialization);
assert(criticalInitialization.regime === "critical", "B = 1 must classify as the Ellis light-ring regime.");
assert(critical.termination === "unresolved-critical", "Critical ray must not be mislabeled capped or escaped.");

const rotatedInitialization = initializeEllisRay(incomingRayForImpact(0.35, { rotation: 0.73 }));
const rotated = integrateEllisRay(rotatedInitialization);
const rotationalSymmetryError = angularError(
  rotated.finalDirection,
  rotateY(traversing.finalDirection, 0.73),
);
assert(
  rotationalSymmetryError < 2e-9,
  `Ellis integration must preserve rotational symmetry; error=${rotationalSymmetryError}.`,
);

let rejectedInvalidArealRadius = false;
try {
  initializeEllisRay({ origin: vec3(0, 0, THROAT_RADIUS * 0.9), direction: vec3(0, 0, 1) });
} catch (error) {
  rejectedInvalidArealRadius = error instanceof Error && error.message.includes("inside the throat");
}
assert(rejectedInvalidArealRadius, "Origins with areal radius below the throat must be rejected.");

const cases = [
  radialOutward,
  radialInward,
  negativeExteriorOutward,
  traversing,
  nearCriticalTraversal,
  turning,
];

console.log(JSON.stringify({
  pass: true,
  claim: "Independent CPU float64 validation for the ultrastatic Ellis metric; the GPU transfer stage is validated separately.",
  model: {
    metric: "ds^2=-dt^2+dl^2+(l^2+a^2)dOmega^2",
    throatRadius: THROAT_RADIUS,
    dimensionlessState: ["L=l/a", "B=b/a", "sigma=a*s"],
    invariant: "p_l^2+B^2/(L^2+1)=1",
    escapeL: DIMENSIONLESS_ESCAPE_L,
    numberProvenance: {
      equationsAndInvariant: "Derived",
      tolerancesAndEscapeBoundary: "Gated/Authored",
      acceptedAndRejectedCounts: "Measured by this validation run",
    },
  },
  independentReference: "adaptive Simpson quadrature of the invariant-reduced azimuth integral",
  critical: {
    B: criticalInitialization.B,
    regime: criticalInitialization.regime,
    termination: critical.termination,
  },
  rotationalSymmetryErrorRadians: angularError(
    rotated.finalDirection,
    rotateY(traversing.finalDirection, 0.73),
  ),
  rejectedInvalidArealRadius,
  cases,
}, null, 2));
