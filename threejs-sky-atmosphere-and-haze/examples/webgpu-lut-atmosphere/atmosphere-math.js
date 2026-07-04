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
