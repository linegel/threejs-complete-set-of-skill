const TAU = 2 * Math.PI;
const FIELDS = ["D_x", "D_z", "h_x", "h_z", "D_xz", "D_xx", "D_zz"];

function requireSize(size) {
  if (!Number.isInteger(size) || size < 8 || (size & (size - 1)) !== 0) {
    throw new RangeError("size must be a power-of-two integer >= 8");
  }
}

function requireField(field, size, name) {
  if (!field || field.length !== 2 * size * size) {
    throw new RangeError(`${name} must contain 2 * size * size scalars`);
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
  const expected = positiveInverseDft2D(spectrum, size);
  let maximum = 0;
  let error2 = 0;
  let expected2 = 0;
  let spatial2 = 0;
  let spectral2 = 0;
  let real2 = 0;
  let imaginary2 = 0;

  for (let index = 0; index < actual.length; index += 2) {
    const error = Math.hypot(
      actual[index] - expected[index],
      actual[index + 1] - expected[index + 1],
    );
    maximum = Math.max(maximum, error);
    error2 += error ** 2;
    expected2 += expected[index] ** 2 + expected[index + 1] ** 2;
    spatial2 += actual[index] ** 2 + actual[index + 1] ** 2;
    spectral2 += spectrum[index] ** 2 + spectrum[index + 1] ** 2;
    real2 += actual[index] ** 2;
    imaginary2 += actual[index + 1] ** 2;
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
    rms: Math.sqrt(error2 / (size * size)),
    relativeL2: Math.sqrt(error2 / Math.max(expected2, Number.EPSILON)),
    parseval: Math.abs(spatial2 - size * size * spectral2)
      / Math.max(size * size * spectral2, Number.EPSILON),
    hermitianPartner,
    imaginaryLeakage: expectReal
      ? Math.sqrt(imaginary2 / Math.max(real2, Number.EPSILON))
      : null,
  };
}

export function applyTolerances(metrics, tolerances) {
  const failures = [];
  for (const [name, limit] of Object.entries(tolerances)) {
    if (!(name in metrics)) throw new RangeError(`unknown metric: ${name}`);
    if (!Number.isFinite(limit) || limit < 0) {
      throw new RangeError(`tolerance ${name} must be finite and nonnegative`);
    }
    if (metrics[name] == null) {
      throw new RangeError(`metric ${name} is not applicable to this fixture`);
    }
    if (!Number.isFinite(metrics[name]) || metrics[name] > limit) {
      failures.push({ name, value: metrics[name], limit });
    }
  }
  return { passed: failures.length === 0, failures };
}
