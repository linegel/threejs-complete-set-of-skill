const EPSILON = 1e-12;

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function normalize3(value) {
  const magnitude = Math.hypot(...value);
  if (!(magnitude > 0)) throw new Error("cannot normalize a zero vector");
  return value.map((component) => component / magnitude);
}

export function intersectSphere(origin, direction, center, radius) {
  if (!(radius > 0)) throw new Error("sphere radius must be positive");
  const localOrigin = subtract3(origin, center);
  const a = dot3(direction, direction);
  const b = dot3(localOrigin, direction);
  const c = dot3(localOrigin, localOrigin) - radius * radius;
  const discriminant = b * b - a * c;
  const tolerance = 64 * Number.EPSILON * Math.max(b * b, Math.abs(a * c), 1);
  if (discriminant < -tolerance) {
    return { hit: false, near: Infinity, far: -Infinity };
  }
  const root = Math.sqrt(Math.max(0, discriminant));
  const near = (-b - root) / a;
  const far = (-b + root) / a;
  return { hit: far >= Math.max(near, 0), near, far };
}

/** Return the first connected positive interval inside outer and outside inner. */
export function intersectSphericalShell({
  origin,
  direction,
  center = [0, 0, 0],
  innerRadius,
  outerRadius,
}) {
  if (!(outerRadius > innerRadius && innerRadius >= 0)) {
    throw new Error("spherical shell requires outerRadius > innerRadius >= 0");
  }
  const ray = normalize3(direction);
  const outer = intersectSphere(origin, ray, center, outerRadius);
  if (!outer.hit || outer.far < 0) return { hit: false, near: Infinity, far: -Infinity };
  const inner = innerRadius > 0
    ? intersectSphere(origin, ray, center, innerRadius)
    : { hit: false, near: Infinity, far: -Infinity };
  const radius = Math.hypot(...subtract3(origin, center));
  let near = Math.max(0, outer.near);
  let far = outer.far;

  if (radius < innerRadius - EPSILON) {
    if (!inner.hit) return { hit: false, near: Infinity, far: -Infinity };
    near = Math.max(near, inner.far);
  } else if (inner.hit && inner.near > near) {
    far = Math.min(far, inner.near);
  }
  return { hit: far > near, near, far };
}

export function intersectPlanarSlab({
  origin,
  direction,
  minimumHeight,
  maximumHeight,
  horizontalHalfExtent = Infinity,
}) {
  if (!(maximumHeight > minimumHeight)) {
    throw new Error("planar slab requires maximumHeight > minimumHeight");
  }
  const ray = normalize3(direction);
  if (Math.abs(ray[1]) < EPSILON) {
    if (origin[1] < minimumHeight || origin[1] > maximumHeight) {
      return { hit: false, near: Infinity, far: -Infinity };
    }
    return { hit: true, near: 0, far: horizontalHalfExtent * 2 };
  }
  let near = (minimumHeight - origin[1]) / ray[1];
  let far = (maximumHeight - origin[1]) / ray[1];
  if (near > far) [near, far] = [far, near];
  near = Math.max(near, 0);
  if (Number.isFinite(horizontalHalfExtent)) {
    for (const axis of [0, 2]) {
      if (Math.abs(ray[axis]) < EPSILON) {
        if (Math.abs(origin[axis]) > horizontalHalfExtent) {
          return { hit: false, near: Infinity, far: -Infinity };
        }
        continue;
      }
      let axisNear = (-horizontalHalfExtent - origin[axis]) / ray[axis];
      let axisFar = (horizontalHalfExtent - origin[axis]) / ray[axis];
      if (axisNear > axisFar) [axisNear, axisFar] = [axisFar, axisNear];
      near = Math.max(near, axisNear);
      far = Math.min(far, axisFar);
    }
  }
  return { hit: far > near, near, far };
}

function multiplyTranspose3(rows, value) {
  return rows.map((row) => dot3(row, value));
}

export function intersectObb({
  origin,
  direction,
  center,
  halfExtents,
  worldToLocalRows,
}) {
  if (!halfExtents.every((extent) => extent > 0)) {
    throw new Error("OBB half extents must be positive");
  }
  const localOrigin = multiplyTranspose3(worldToLocalRows, subtract3(origin, center));
  const localDirection = multiplyTranspose3(worldToLocalRows, normalize3(direction));
  let near = 0;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(localDirection[axis]) < EPSILON) {
      if (Math.abs(localOrigin[axis]) > halfExtents[axis]) {
        return { hit: false, near: Infinity, far: -Infinity };
      }
      continue;
    }
    let axisNear = (-halfExtents[axis] - localOrigin[axis]) / localDirection[axis];
    let axisFar = (halfExtents[axis] - localOrigin[axis]) / localDirection[axis];
    if (axisNear > axisFar) [axisNear, axisFar] = [axisFar, axisNear];
    near = Math.max(near, axisNear);
    far = Math.min(far, axisFar);
    if (far <= near) return { hit: false, near: Infinity, far: -Infinity };
  }
  return { hit: Number.isFinite(far) && far > near, near, far };
}

export function clampCloudIntervalToSceneDepth(interval, sceneDistanceMeters) {
  if (!interval.hit) return interval;
  if (!(sceneDistanceMeters >= 0)) throw new Error("scene depth must be non-negative");
  const far = Math.min(interval.far, sceneDistanceMeters);
  return { ...interval, hit: far > interval.near, far };
}

export const CLOUD_DOMAIN_FIXTURES = Object.freeze({
  shell: Object.freeze({
    type: "spherical-shell",
    center: [0, -6360000, 0],
    innerRadius: 6360750,
    outerRadius: 6368000,
  }),
  slab: Object.freeze({
    type: "planar-slab",
    minimumHeight: 750,
    maximumHeight: 8000,
    horizontalHalfExtent: 120000,
  }),
  obb: Object.freeze({
    type: "obb",
    center: [0, 3200, -40000],
    halfExtents: [26000, 2600, 42000],
    worldToLocalRows: [
      [0.9396926208, 0, -0.3420201433],
      [0, 1, 0],
      [0.3420201433, 0, 0.9396926208],
    ],
  }),
});
