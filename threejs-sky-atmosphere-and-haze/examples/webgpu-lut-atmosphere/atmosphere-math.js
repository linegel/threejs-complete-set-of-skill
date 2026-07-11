export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function addScaled(a, b, scale) {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a) {
  const len = length(a);
  if (len === 0) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function closestPointParameterOnSegment(camera, point) {
  const ray = sub(point, camera);
  return clamp(-dot(camera, ray) / dot(ray, ray), 0, 1);
}

export function closestPointParameterOldExpression(camera, point) {
  const ray = sub(point, camera);
  return -clamp(dot(camera, ray) / dot(ray, ray), 0, 1);
}

export function segmentOutsideAtmosphere(camera, point, topRadius) {
  const ray = sub(point, camera);
  const t = closestPointParameterOnSegment(camera, point);
  return length(addScaled(camera, ray, t)) > topRadius;
}

export function segmentOutsideAtmosphereOldExpression(camera, point, topRadius) {
  const ray = sub(point, camera);
  const t = closestPointParameterOldExpression(camera, point);
  return length(addScaled(camera, ray, t)) > topRadius;
}

export function topAtmosphereDiscriminant(camera, viewRay, topRadius) {
  const radius = length(camera);
  const radiusCosine = dot(camera, viewRay);
  return radiusCosine * radiusCosine - radius * radius + topRadius * topRadius;
}

export function topAtmosphereIntersection(camera, viewRay, topRadius) {
  const radius = length(camera);
  const radiusCosine = dot(camera, viewRay);
  const discriminant = topAtmosphereDiscriminant(camera, viewRay, topRadius);

  if (radius > topRadius && discriminant < 0) {
    return {
      hit: false,
      topAtmosphereMiss: true,
      entryDistance: Number.POSITIVE_INFINITY,
      transmittance: [1, 1, 1],
      radiance: [0, 0, 0],
    };
  }

  const entryDistance = -radiusCosine - Math.sqrt(Math.max(discriminant, 0));
  if (entryDistance > 0) {
    return {
      hit: true,
      topAtmosphereMiss: false,
      entryDistance,
      transmittance: null,
      radiance: null,
    };
  }

  if (radius > topRadius) {
    return {
      hit: false,
      topAtmosphereMiss: false,
      entryDistance,
      transmittance: [1, 1, 1],
      radiance: [0, 0, 0],
    };
  }

  return {
    hit: true,
    topAtmosphereMiss: false,
    entryDistance: 0,
    transmittance: null,
    radiance: null,
  };
}

export function topAtmosphereIntersectionOldSafeSqrt(camera, viewRay, topRadius) {
  const radius = length(camera);
  const radiusCosine = dot(camera, viewRay);
  const discriminant = topAtmosphereDiscriminant(camera, viewRay, topRadius);
  const entryDistance = -radiusCosine - Math.sqrt(Math.max(discriminant, 0));
  if (entryDistance > 0) {
    return {
      hit: true,
      topAtmosphereMiss: false,
      entryDistance,
    };
  }
  if (radius > topRadius) {
    return {
      hit: false,
      topAtmosphereMiss: false,
      entryDistance,
      transmittance: [1, 1, 1],
      radiance: [0, 0, 0],
    };
  }
  return {
    hit: true,
    topAtmosphereMiss: false,
    entryDistance: 0,
  };
}

export function transmittanceUnitToPhysical({
  xMu,
  xR,
  bottomRadius,
  topRadius,
}) {
  const H = Math.sqrt(topRadius * topRadius - bottomRadius * bottomRadius);
  const rho = H * xR;
  const radius = Math.sqrt(rho * rho + bottomRadius * bottomRadius);
  const distanceMin = topRadius - radius;
  const distanceMax = rho + H;
  const distanceToTop = distanceMin + (distanceMax - distanceMin) * xMu;
  const mu =
    distanceToTop === 0
      ? 1
      : (topRadius * topRadius - radius * radius - distanceToTop * distanceToTop) /
        (2 * radius * distanceToTop);
  return { radius, mu: clamp(mu, -1, 1), distanceToTop };
}

export function transmittancePhysicalToUnit({
  radius,
  mu,
  bottomRadius,
  topRadius,
}) {
  const H = Math.sqrt(topRadius * topRadius - bottomRadius * bottomRadius);
  const rho = Math.sqrt(Math.max(radius * radius - bottomRadius * bottomRadius, 0));
  const discriminant =
    radius * radius * (mu * mu - 1) + topRadius * topRadius;
  if (discriminant < 0) {
    throw new Error("ray does not intersect the top atmosphere");
  }
  const distanceToTop = -radius * mu + Math.sqrt(discriminant);
  const distanceMin = topRadius - radius;
  const distanceMax = rho + H;
  return {
    xMu: clamp((distanceToTop - distanceMin) / (distanceMax - distanceMin), 0, 1),
    xR: clamp(rho / H, 0, 1),
  };
}

export function rayleighPhase(mu) {
  return (3 * (1 + mu * mu)) / (16 * Math.PI);
}

export function henyeyGreensteinPhase(mu, g) {
  if (!(Math.abs(g) < 1)) throw new Error("Henyey-Greenstein requires abs(g) < 1");
  if (!(mu >= -1 && mu <= 1)) throw new Error("Henyey-Greenstein requires mu in [-1, 1]");
  const denominatorBase = g >= 0
    ? (1 - g) * (1 - g) + 2 * g * (1 - mu)
    : (1 + g) * (1 + g) - 2 * g * (1 + mu);
  return (
    (1 - g * g) /
    (4 * Math.PI * Math.pow(denominatorBase, 1.5))
  );
}

export function homogeneousTransmittance(betaPerLength, distance) {
  return Math.exp(-betaPerLength * distance);
}

export function exponentialFroxelDepth(z, farDistance, exponent) {
  return (
    farDistance *
    (Math.exp(exponent * z) - 1) /
    (Math.exp(exponent) - 1)
  );
}

function finiteRgb(name, value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError(`${name} must contain three finite values`);
  }
  return value;
}

/**
 * Float64 reference for the GPU aerial column topology.  Each depth interval
 * is integrated exactly once, and every result is cumulative from the same
 * camera origin.  `extinctionAt` is km^-1 and `sourceAt` is relative radiance
 * per (km sr) per unit normal solar irradiance; multiplying by ds [km]
 * produces relative radiance per sr.
 */
export function integrateCumulativeAerialRay({
  sliceDepthsKm,
  samplesPerInterval = 8,
  extinctionAt,
  sourceAt,
}) {
  if (
    !Array.isArray(sliceDepthsKm) ||
    sliceDepthsKm.length < 2 ||
    !sliceDepthsKm.every(Number.isFinite) ||
    sliceDepthsKm[0] !== 0
  ) {
    throw new TypeError("sliceDepthsKm must be a finite monotone array starting at zero");
  }
  for (let index = 1; index < sliceDepthsKm.length; index += 1) {
    if (!(sliceDepthsKm[index] > sliceDepthsKm[index - 1])) {
      throw new RangeError("sliceDepthsKm must be strictly increasing after zero");
    }
  }
  if (!(Number.isInteger(samplesPerInterval) && samplesPerInterval > 0)) {
    throw new RangeError("samplesPerInterval must be a positive integer");
  }
  if (typeof extinctionAt !== "function" || typeof sourceAt !== "function") {
    throw new TypeError("extinctionAt and sourceAt callbacks are required");
  }
  const opticalDepth = [0, 0, 0];
  const radianceResponse = [0, 0, 0];
  const slices = [
    {
      depthKm: 0,
      opticalDepth: [...opticalDepth],
      radianceResponse: [...radianceResponse],
    },
  ];
  let evaluations = 0;
  for (let slice = 1; slice < sliceDepthsKm.length; slice += 1) {
    const startKm = sliceDepthsKm[slice - 1];
    const endKm = sliceDepthsKm[slice];
    const stepKm = (endKm - startKm) / samplesPerInterval;
    for (let sample = 0; sample < samplesPerInterval; sample += 1) {
      const distanceKm = startKm + (sample + 0.5) * stepKm;
      const extinction = finiteRgb("extinctionAt result", extinctionAt(distanceKm));
      const source = finiteRgb("sourceAt result", sourceAt(distanceKm));
      for (let channel = 0; channel < 3; channel += 1) {
        if (extinction[channel] < 0 || source[channel] < 0) {
          throw new RangeError("extinction and source must be non-negative");
        }
        const midpointTau = opticalDepth[channel] + 0.5 * extinction[channel] * stepKm;
        radianceResponse[channel] +=
          Math.exp(-midpointTau) * source[channel] * stepKm;
        opticalDepth[channel] += extinction[channel] * stepKm;
      }
      evaluations += 1;
    }
    slices.push({
      depthKm: endKm,
      opticalDepth: [...opticalDepth],
      radianceResponse: [...radianceResponse],
    });
  }
  return {
    slices,
    evaluations,
    topology: "one cumulative integration per XY ray",
    units: {
      extinction: "km^-1",
      source: "relative-radiance-per-km-steradian-per-unit-normal-irradiance",
      opticalDepth: "dimensionless",
      radianceResponse: "relative-radiance-per-steradian-per-unit-normal-irradiance",
    },
  };
}

export function homogeneousRadianceResponse({ extinctionPerKm, sourcePerKmSr, distanceKm }) {
  if (![extinctionPerKm, sourcePerKmSr, distanceKm].every(Number.isFinite)) {
    throw new TypeError("homogeneous radiance arguments must be finite");
  }
  if (extinctionPerKm < 0 || sourcePerKmSr < 0 || distanceKm < 0) {
    throw new RangeError("homogeneous radiance arguments must be non-negative");
  }
  if (extinctionPerKm === 0) return sourcePerKmSr * distanceKm;
  return (
    (sourcePerKmSr / extinctionPerKm) *
    (1 - Math.exp(-extinctionPerKm * distanceKm))
  );
}

/** Stable double-precision ray/ellipsoid interval used by CPU references. */
export function rayEllipsoidInterval({
  origin,
  direction,
  center = [0, 0, 0],
  axes,
  minimumDistance = 0,
}) {
  if (![origin, direction, center, axes].every(
    (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite),
  )) {
    throw new Error("rayEllipsoidInterval requires finite three-component vectors");
  }
  if (!axes.every((axis) => axis > 0)) {
    throw new Error("ellipsoid semi-axes must be positive");
  }

  const o = origin.map((value, index) => (value - center[index]) / axes[index]);
  const d = direction.map((value, index) => value / axes[index]);
  const A = dot(d, d);
  const B = 2 * dot(o, d);
  const C = dot(o, o) - 1;
  if (!(A > 0)) throw new Error("ray direction must be non-zero");
  const discriminant = B * B - 4 * A * C;
  const scale = Math.max(B * B, Math.abs(4 * A * C), 1);
  const tolerance = 64 * Number.EPSILON * scale;
  if (discriminant < -tolerance) {
    return { hit: false, near: Infinity, far: -Infinity, discriminant };
  }

  const root = Math.sqrt(Math.max(discriminant, 0));
  let t0;
  let t1;
  if (root === 0) {
    t0 = -B / (2 * A);
    t1 = t0;
  } else {
    const signB = B >= 0 ? 1 : -1;
    const q = -0.5 * (B + signB * root);
    t0 = q / A;
    t1 = C / q;
  }
  if (t0 > t1) [t0, t1] = [t1, t0];
  const near = Math.max(t0, minimumDistance);
  return {
    hit: t1 >= near,
    near,
    far: t1,
    discriminant,
  };
}

export function geodeticToEcef({
  latitudeRadians,
  longitudeRadians,
  heightMeters,
  semiMajorMeters,
  semiMinorMeters,
}) {
  const values = [
    latitudeRadians,
    longitudeRadians,
    heightMeters,
    semiMajorMeters,
    semiMinorMeters,
  ];
  if (!values.every(Number.isFinite) || !(semiMajorMeters > 0) || !(semiMinorMeters > 0)) {
    throw new Error("geodeticToEcef requires finite coordinates and positive axes");
  }
  const a2 = semiMajorMeters * semiMajorMeters;
  const b2 = semiMinorMeters * semiMinorMeters;
  const e2 = (a2 - b2) / a2;
  const sinLatitude = Math.sin(latitudeRadians);
  const cosLatitude = Math.cos(latitudeRadians);
  const primeVertical = semiMajorMeters /
    Math.sqrt(1 - e2 * sinLatitude * sinLatitude);
  return [
    (primeVertical + heightMeters) * cosLatitude * Math.cos(longitudeRadians),
    (primeVertical + heightMeters) * cosLatitude * Math.sin(longitudeRadians),
    (primeVertical * (1 - e2) + heightMeters) * sinLatitude,
  ];
}

/**
 * Newton geodetic inverse with an explicit pole branch. Returned height is
 * ellipsoid-normal height, never radial distance minus an average radius.
 */
export function ecefToGeodetic({
  position,
  semiMajorMeters,
  semiMinorMeters,
  iterations = 8,
}) {
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) {
    throw new Error("ecefToGeodetic requires a finite ECEF position");
  }
  if (!(semiMajorMeters > 0) || !(semiMinorMeters > 0)) {
    throw new Error("ecefToGeodetic requires positive ellipsoid axes");
  }
  const [x, y, z] = position;
  const p = Math.hypot(x, y);
  const longitudeRadians = p === 0 ? 0 : Math.atan2(y, x);
  if (p < semiMajorMeters * 1e-14) {
    return {
      latitudeRadians: Math.sign(z || 1) * Math.PI / 2,
      longitudeRadians,
      heightMeters: Math.abs(z) - semiMinorMeters,
      iterations: 0,
    };
  }

  const a2 = semiMajorMeters * semiMajorMeters;
  const b2 = semiMinorMeters * semiMinorMeters;
  const e2 = (a2 - b2) / a2;
  let latitudeRadians = Math.atan2(z, p * (1 - e2));
  let heightMeters = 0;
  let usedIterations = 0;
  for (let index = 0; index < iterations; index += 1) {
    const sinLatitude = Math.sin(latitudeRadians);
    const primeVertical = semiMajorMeters /
      Math.sqrt(1 - e2 * sinLatitude * sinLatitude);
    const cosLatitude = Math.cos(latitudeRadians);
    heightMeters = p / cosLatitude - primeVertical;
    const nextLatitude = Math.atan2(
      z,
      p * (1 - e2 * primeVertical / (primeVertical + heightMeters)),
    );
    usedIterations = index + 1;
    if (Math.abs(nextLatitude - latitudeRadians) <= 2e-15) {
      latitudeRadians = nextLatitude;
      break;
    }
    latitudeRadians = nextLatitude;
  }

  const sinLatitude = Math.sin(latitudeRadians);
  const primeVertical = semiMajorMeters /
    Math.sqrt(1 - e2 * sinLatitude * sinLatitude);
  heightMeters = p / Math.cos(latitudeRadians) - primeVertical;
  return {
    latitudeRadians,
    longitudeRadians,
    heightMeters,
    iterations: usedIterations,
  };
}
