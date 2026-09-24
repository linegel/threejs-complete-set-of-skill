const TAU = 2 * Math.PI;
// O(N^4) fixture oracle only; not a production FFT dimension limit.
const MAX_ORACLE_SIZE = 32;
const METRICS = ["maximum", "rms", "relativeL2", "parseval", "hermitianPartner", "imaginaryLeakage"];
const FIELDS = ["D_x", "D_z", "h_x", "h_z", "D_xz", "D_xx", "D_zz"];

function requireSize(size) {
  if (!Number.isSafeInteger(size) || size < 8 || size > MAX_ORACLE_SIZE || !Number.isInteger(Math.log2(size))) {
    throw new RangeError("size must be a power-of-two integer from 8 to 32 for this CPU oracle");
  }
}

function requireField(field, size, name) {
  if (!(Array.isArray(field) || ArrayBuffer.isView(field)) || field.length !== 2 * size * size) {
    throw new RangeError(`${name} must contain 2 * size * size scalars`);
  }
  for (let index = 0; index < field.length; index++) {
    if (!Number.isFinite(field[index])) throw new RangeError(`${name}[${index}] must be a finite number`);
  }
}

const offset = (size, x, z) => 2 * (z * size + x);
const signed = (index, size) => index - size / 2;
const centered = (value, size) =>
  ((value + size / 2) % size + size) % size;
const field = (size) => new Float64Array(2 * size * size);

function setBin(target, size, sx, sz, re, im) {
  const index = offset(size, centered(sx, size), centered(sz, size));
  target[index] = re;
  target[index + 1] = im;
}

function setPair(target, size, sx, sz, re, im) {
  setBin(target, size, sx, sz, re, im);
  setBin(target, size, -sx, -sz, re, -im);
}

export function positiveInverseDft2D(spectrum, size) {
  requireSize(size);
  requireField(spectrum, size, "spectrum");
  const output = field(size);

  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      let re = 0;
      let im = 0;
      for (let iz = 0; iz < size; iz += 1) {
        for (let ix = 0; ix < size; ix += 1) {
          const source = offset(size, ix, iz);
          const angle = TAU
            * (signed(ix, size) * x + signed(iz, size) * z) / size;
          const cosine = Math.cos(angle);
          const sine = Math.sin(angle);
          re += spectrum[source] * cosine - spectrum[source + 1] * sine;
          im += spectrum[source] * sine + spectrum[source + 1] * cosine;
        }
      }
      if (!Number.isFinite(re) || !Number.isFinite(im)) throw new RangeError("DFT accumulation exceeded finite precision");
      const target = offset(size, x, z);
      output[target] = re;
      output[target + 1] = im;
    }
  }
  return output;
}

function derivativeSpectrum(height, size, name) {
  const output = field(size);
  for (let iz = 0; iz < size; iz += 1) {
    const z = signed(iz, size);
    for (let ix = 0; ix < size; ix += 1) {
      const x = signed(ix, size);
      const k = Math.hypot(x, z);
      let a = 0;
      let b = 0;
      if (k > 0) {
        if (name === "D_x" && x !== -size / 2) b = x / k;
        else if (name === "D_z" && z !== -size / 2) b = z / k;
        else if (name === "h_x" && x !== -size / 2) b = x;
        else if (name === "h_z" && z !== -size / 2) b = z;
        else if (name === "D_xx") a = -x * x / k;
        else if (name === "D_zz") a = -z * z / k;
        else if (name === "D_xz"
          && x !== -size / 2 && z !== -size / 2) a = -x * z / k;
      }
      const index = offset(size, ix, iz);
      output[index] = a * height[index] - b * height[index + 1];
      output[index + 1] = a * height[index + 1] + b * height[index];
    }
  }
  return output;
}

function pack(a, b, size) {
  const output = field(size);
  for (let index = 0; index < output.length; index += 2) {
    output[index] = a[index] - b[index + 1];
    output[index + 1] = a[index + 1] + b[index];
  }
  return output;
}

export function makeConventionFixtures(size = 8, seed = 0x5eed1234) {
  requireSize(size);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("seed must be a uint32 integer");
  const fixtures = [];
  const single = (name, sx, sz, re, im, expectReal = false) => {
    const spectrum = field(size);
    setBin(spectrum, size, sx, sz, re, im);
    fixtures.push({ name, spectrum, expectReal });
  };

  single("dc", 0, 0, 1, 0, true);
  single("positive-x", 1, 0, 0.75, -0.25);
  single("positive-z", 0, 1, -0.2, 0.6);
  single("oblique", 1, 2, 0.4, 0.3);

  const pair = field(size);
  setPair(pair, size, 1, 2, 0.35, -0.2);
  fixtures.push({ name: "hermitian-pair", spectrum: pair, expectReal: true });

  const random = field(size);
  let state = seed >>> 0;
  for (let index = 0; index < random.length; index += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    random[index] = state / 0x100000000 - 0.5;
  }
  fixtures.push({ name: "random-complex", spectrum: random, expectReal: false });

  const height = field(size);
  setPair(height, size, 1, 2, 0.7, -0.2);
  setPair(height, size, -size / 2, 1, 0.4, 0.3);
  setPair(height, size, 1, -size / 2, -0.25, 0.15);
  setBin(height, size, -size / 2, 0, 0.2, 0);
  setBin(height, size, 0, -size / 2, -0.3, 0);
  setBin(height, size, -size / 2, -size / 2, 0.1, 0);

  const derivatives = Object.fromEntries(
    FIELDS.map((name) => [name, derivativeSpectrum(height, size, name)]),
  );
  for (const [name, spectrum] of Object.entries(derivatives)) {
    fixtures.push({ name: `nyquist-${name}`, spectrum, expectReal: true });
  }
  fixtures.push({
    name: "packed-D_x-D_z",
    spectrum: pack(derivatives.D_x, derivatives.D_z, size),
    expectReal: false,
  });
  return fixtures;
}

export function measureTransform(spectrum, actual, size, expectReal = false) {
  requireSize(size);
  requireField(spectrum, size, "spectrum");
  requireField(actual, size, "actual");
  if (typeof expectReal !== "boolean") throw new TypeError("expectReal must be boolean");
  const expected = positiveInverseDft2D(spectrum, size);
  let maximum = 0;
  let errorNorm = 0;
  let expectedNorm = 0;
  let spatialNorm = 0;
  let spectralNorm = 0;
  let realNorm = 0;
  let imaginaryNorm = 0;

  for (let index = 0; index < actual.length; index += 2) {
    const error = Math.hypot(
      actual[index] - expected[index],
      actual[index + 1] - expected[index + 1],
    );
    maximum = Math.max(maximum, error);
    errorNorm = Math.hypot(errorNorm, error);
    expectedNorm = Math.hypot(expectedNorm, expected[index], expected[index + 1]);
    spatialNorm = Math.hypot(spatialNorm, actual[index], actual[index + 1]);
    spectralNorm = Math.hypot(spectralNorm, spectrum[index], spectrum[index + 1]);
    realNorm = Math.hypot(realNorm, actual[index]);
    imaginaryNorm = Math.hypot(imaginaryNorm, actual[index + 1]);
  }

  let hermitianPartner = null;
  if (expectReal) {
    hermitianPartner = 0;
    for (let iz = 0; iz < size; iz += 1) {
      for (let ix = 0; ix < size; ix += 1) {
        const index = offset(size, ix, iz);
        const partner = offset(
          size,
          centered(-signed(ix, size), size),
          centered(-signed(iz, size), size),
        );
        hermitianPartner = Math.max(hermitianPartner, Math.hypot(
          spectrum[index] - spectrum[partner],
          spectrum[index + 1] + spectrum[partner + 1],
        ));
      }
    }
  }

  return {
    maximum,
    rms: errorNorm / size,
    relativeL2: expectedNorm === 0 ? (errorNorm === 0 ? 0 : Infinity) : errorNorm / expectedNorm,
    parseval: spectralNorm === 0 ? (spatialNorm === 0 ? 0 : Infinity)
      : Math.abs((spatialNorm / spectralNorm / size) ** 2 - 1),
    hermitianPartner,
    imaginaryLeakage: expectReal
      ? (realNorm === 0 ? (imaginaryNorm === 0 ? 0 : Infinity) : imaginaryNorm / realNorm)
      : null,
  };
}

export function applyTolerances(metrics, tolerances) {
  for (const [name, value] of Object.entries({ metrics, tolerances })) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  }
  const entries = Object.entries(tolerances);
  if (entries.length === 0) throw new RangeError("tolerances must be nonempty");
  for (const name of METRICS) {
    if (!Object.hasOwn(metrics, name)) throw new RangeError(`missing metric: ${name}`);
    if (metrics[name] == null && !["hermitianPartner", "imaginaryLeakage"].includes(name)) {
      throw new RangeError(`missing numeric metric: ${name}`);
    }
  }
  for (const [name, limit] of entries) {
    if (!METRICS.includes(name)) throw new RangeError(`unknown metric: ${name}`);
    if (!Number.isFinite(limit) || limit < 0) throw new RangeError(`tolerance ${name} must be finite and nonnegative`);
    if (metrics[name] == null) throw new RangeError(`metric ${name} is not applicable to this fixture`);
  }
  const failures = [];
  for (const name of METRICS) {
    const value = metrics[name];
    if (value == null) continue;
    if (!Number.isFinite(value) || value < 0) {
      failures.push({ name, value, limit: tolerances[name] ?? null, reason: "invalid measurement" });
    } else if (Object.hasOwn(tolerances, name) && value > tolerances[name]) {
      failures.push({ name, value, limit: tolerances[name], reason: "outside tolerance" });
    }
  }
  return { passed: failures.length === 0, failures };
}
