const THROAT_RADIUS = 1.2;
const BASE_STEP = 0.0042;
const JITTER_RANGE = 0.0009;
const ESCAPE_DISTANCE = 40;
const DEFAULT_MAX_STEPS = 920;

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
  const len = length3(value);
  assert(len > 0, "Cannot normalize a zero-length vector.");
  return [value[0] / len, value[1] / len, value[2] / len];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function multiplyScalar(value, scalar) {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function fallbackNormalFor(radialAxis) {
  const fallbackAxis = Math.abs(radialAxis[1]) < 0.75
    ? vec3(0, 1, 0)
    : vec3(1, 0, 0);
  return normalize(cross(radialAxis, fallbackAxis));
}

function deterministicJitter(origin, direction) {
  const phase = dot(origin, vec3(12.9898, 78.233, 37.719)) +
    dot(direction, vec3(41.233, 19.19, 83.17));
  const hashed = Math.sin(phase) * 43758.5453;
  return (hashed - Math.floor(hashed) - 0.5) * JITTER_RANGE;
}

function derivative([l, pL], impactParameter) {
  const r2 = l * l + THROAT_RADIUS * THROAT_RADIUS;
  return [
    r2 * pL,
    impactParameter * impactParameter * l / r2,
  ];
}

function rk4Step(state, step, impactParameter) {
  const k1 = derivative(state, impactParameter);
  const k2 = derivative([
    state[0] + k1[0] * step * 0.5,
    state[1] + k1[1] * step * 0.5,
  ], impactParameter);
  const k3 = derivative([
    state[0] + k2[0] * step * 0.5,
    state[1] + k2[1] * step * 0.5,
  ], impactParameter);
  const k4 = derivative([
    state[0] + k3[0] * step,
    state[1] + k3[1] * step,
  ], impactParameter);

  return [
    state[0] + step * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6,
    state[1] + step * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6,
  ];
}

function integrateReferenceRay({
  origin,
  direction,
  maxSteps = DEFAULT_MAX_STEPS,
}) {
  const rayOrigin = origin;
  const rayDirection = normalize(direction);
  const radialAxis = normalize(rayOrigin);
  const impactCross = cross(rayOrigin, rayDirection);
  const impactParameter = length3(impactCross);
  const nearRadialBasis = impactParameter < 1e-6;
  const normal = nearRadialBasis
    ? fallbackNormalFor(radialAxis)
    : normalize(impactCross);
  const tangentAxis = normalize(cross(normal, radialAxis));
  const step = BASE_STEP + deterministicJitter(rayOrigin, rayDirection);

  let l = Math.sqrt(Math.max(dot(rayOrigin, rayOrigin) - THROAT_RADIUS * THROAT_RADIUS, 0.001));
  let pL = dot(radialAxis, rayDirection);
  let phi = 0;
  let acceptedSteps = 0;
  let termination = "capped";

  for (let index = 0; index < maxSteps; index += 1) {
    [l, pL] = rk4Step([l, pL], step, impactParameter);
    phi += step * impactParameter;
    acceptedSteps += 1;

    if (!Number.isFinite(l) || !Number.isFinite(pL)) {
      termination = "invalid";
      break;
    }

    if (Math.abs(l) > ESCAPE_DISTANCE) {
      termination = "escaped";
      break;
    }
  }

  const finalDirection = normalize(add(
    multiplyScalar(radialAxis, Math.cos(phi)),
    multiplyScalar(tangentAxis, Math.sin(phi)),
  ));

  return {
    impactParameter,
    nearRadialBasis,
    step,
    acceptedSteps,
    termination,
    finalL: l,
    pL,
    phi,
    escapeSide: l < 0 ? "negative" : "positive",
    finalDirection,
  };
}

function approxEqual(actual, expected, tolerance, label) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function approxVector(actual, expected, tolerance, label) {
  assert(actual.length === expected.length, `${label}: vector length mismatch.`);
  for (let index = 0; index < actual.length; index += 1) {
    approxEqual(actual[index], expected[index], tolerance, `${label}[${index}]`);
  }
}

const cases = [
  {
    name: "outward-positive-escape",
    origin: vec3(0, 0, 3),
    direction: vec3(0, 0, 1),
    expected: {
      impactParameter: 0,
      nearRadialBasis: true,
      step: 0.004136220101740036,
      acceptedSteps: 77,
      termination: "escaped",
      finalL: 40.9014104400718,
      pL: 1,
      phi: 0,
      escapeSide: "positive",
      finalDirection: vec3(0, 0, 1),
    },
  },
  {
    name: "inward-negative-side-escape",
    origin: vec3(0, 0, 3),
    direction: vec3(0.08, 0, -1),
    expected: {
      impactParameter: 0.23923566684866998,
      nearRadialBasis: false,
      step: 0.004553870444092172,
      acceptedSteps: 500,
      termination: "escaped",
      finalL: -41.02768437362251,
      pL: -0.9999830170667069,
      phi: 0.5447241162174209,
      escapeSide: "negative",
      finalDirection: vec3(0.5181821550270598, 0, 0.8552702813798176),
    },
  },
  {
    name: "near-radial-fallback-basis",
    origin: vec3(0, 2.5, 0),
    direction: vec3(0, -1, 0),
    expected: {
      impactParameter: 0,
      nearRadialBasis: true,
      step: 0.003980763211986414,
      acceptedSteps: 547,
      termination: "escaped",
      finalL: -42.89915754358559,
      pL: -1,
      phi: 0,
      escapeSide: "negative",
      finalDirection: vec3(0, 1, 0),
    },
  },
  {
    name: "high-impact-positive-escape",
    origin: vec3(2.5, 0, 0),
    direction: vec3(0, 0, 1),
    expected: {
      impactParameter: 2.5,
      nearRadialBasis: false,
      step: 0.004039689449612342,
      acceptedSteps: 160,
      termination: "escaped",
      finalL: 42.09467708318448,
      pL: 0.9982365353591975,
      phi: 1.6158757798449397,
      escapeSide: "positive",
      finalDirection: vec3(-0.045064186512991225, 0, 0.998984093513967),
    },
  },
  {
    name: "near-throat-capped-state",
    origin: vec3(0, 0, 1.21),
    direction: vec3(1, 0, 0),
    maxSteps: 16,
    expected: {
      impactParameter: 1.21,
      nearRadialBasis: false,
      step: 0.0038207493947847978,
      acceptedSteps: 16,
      termination: "capped",
      finalL: 0.1556666574084078,
      pL: 0.009498608147840733,
      phi: 0.0739697082830337,
      escapeSide: "positive",
      finalDirection: vec3(0.07390227230597654, 0, 0.9972654882968794),
    },
  },
];

const results = cases.map((testCase) => {
  const actual = integrateReferenceRay(testCase);
  const expected = testCase.expected;

  approxEqual(actual.impactParameter, expected.impactParameter, 1e-12, `${testCase.name} impactParameter`);
  assert(actual.nearRadialBasis === expected.nearRadialBasis, `${testCase.name} nearRadialBasis mismatch.`);
  approxEqual(actual.step, expected.step, 1e-15, `${testCase.name} step`);
  assert(actual.acceptedSteps === expected.acceptedSteps, `${testCase.name} acceptedSteps mismatch.`);
  assert(actual.termination === expected.termination, `${testCase.name} termination mismatch.`);
  approxEqual(actual.finalL, expected.finalL, 1e-9, `${testCase.name} finalL`);
  approxEqual(actual.pL, expected.pL, 1e-12, `${testCase.name} pL`);
  approxEqual(actual.phi, expected.phi, 1e-12, `${testCase.name} phi`);
  assert(actual.escapeSide === expected.escapeSide, `${testCase.name} escapeSide mismatch.`);
  approxVector(actual.finalDirection, expected.finalDirection, 1e-12, `${testCase.name} finalDirection`);

  return {
    name: testCase.name,
    impactParameter: actual.impactParameter,
    nearRadialBasis: actual.nearRadialBasis,
    acceptedSteps: actual.acceptedSteps,
    termination: actual.termination,
    escapeSide: actual.escapeSide,
    finalDirection: actual.finalDirection,
  };
});

assert(results.length >= 5, "At least five wormhole reference rays are required.");

console.log(JSON.stringify({
  pass: true,
  model: {
    throatRadius: THROAT_RADIUS,
    baseStep: BASE_STEP,
    jitterRange: JITTER_RANGE,
    escapeDistance: ESCAPE_DISTANCE,
    maximumHeroIterations: DEFAULT_MAX_STEPS,
  },
  cases: results,
}, null, 2));
