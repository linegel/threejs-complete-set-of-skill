import { createWriter } from "./mesh-writer.js";
import { BOUNDARY_REASONS } from "./frame-profile.js";

const EPSILON = 1e-10;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (v) => Math.hypot(v[0], v[1], v[2]);

function normalize(v, label = "vector") {
  const magnitude = length(v);
  if (!(magnitude > EPSILON)) throw new Error(`${label} is degenerate`);
  return scale(v, 1 / magnitude);
}

function projectNormal(normal, tangent) {
  const projected = sub(normal, scale(tangent, dot(normal, tangent)));
  if (length(projected) > EPSILON) return normalize(projected);
  const axis = Math.abs(tangent[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
  return normalize(cross(tangent, axis), "authored initial normal fallback");
}

function rotateAroundAxis(vector, axis, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return add(
    add(scale(vector, cosine), scale(cross(axis, vector), sine)),
    scale(axis, dot(axis, vector) * (1 - cosine)),
  );
}

function transportNormal(previousTangent, tangent, previousNormal) {
  const axisRaw = cross(previousTangent, tangent);
  const sine = length(axisRaw);
  const cosine = Math.max(-1, Math.min(1, dot(previousTangent, tangent)));
  let transported;
  if (sine > EPSILON) {
    transported = rotateAroundAxis(previousNormal, scale(axisRaw, 1 / sine), Math.atan2(sine, cosine));
  } else if (cosine >= 0) {
    transported = previousNormal;
  } else {
    // A deterministic axis is mandatory for a 180-degree turn because the
    // minimal quaternion is otherwise undefined.
    const fallback = projectNormal([1, 0, 0], previousTangent);
    transported = rotateAroundAxis(previousNormal, fallback, Math.PI);
  }
  return projectNormal(transported, tangent);
}

function tangentAt(centers, index) {
  if (index === 0) return normalize(sub(centers[1], centers[0]), "first branch tangent");
  if (index === centers.length - 1) {
    return normalize(sub(centers[index], centers[index - 1]), "last branch tangent");
  }
  return normalize(sub(centers[index + 1], centers[index - 1]), "branch tangent");
}

function radialDirection(frame, angle) {
  return add(scale(frame.normal, Math.cos(angle)), scale(frame.binormal, Math.sin(angle)));
}

function angularDerivative(frame, radius, angle) {
  return scale(
    add(scale(frame.normal, -Math.sin(angle)), scale(frame.binormal, Math.cos(angle))),
    radius,
  );
}

function ringPosition(frames, radii, section, angle) {
  return add(frames[section].center, scale(radialDirection(frames[section], angle), radii[section]));
}

function sectionDerivative(frames, radii, section, angle) {
  const previous = Math.max(0, section - 1);
  const next = Math.min(frames.length - 1, section + 1);
  const deltaArc = frames[next].arcLength - frames[previous].arcLength;
  if (!(deltaArc > EPSILON)) throw new Error("branch sections require strictly increasing arc length");
  return {
    position: scale(
      sub(ringPosition(frames, radii, next, angle), ringPosition(frames, radii, previous, angle)),
      1 / deltaArc,
    ),
    radius: (radii[next] - radii[previous]) / deltaArc,
  };
}

function surfaceFrame(frames, radii, section, angle, metersPerRepeat) {
  const frame = frames[section];
  const radius = radii[section];
  const dPositionDTheta = angularDerivative(frame, radius, angle);
  const derivative = sectionDerivative(frames, radii, section, angle);

  // Production coordinates are U=s/repeat and V=theta*r(s)/repeat. Invert
  // that 2D Jacobian before constructing the tangent so taper does not leak
  // into the normal-map basis. The transported-frame derivative above also
  // captures centerline curvature and authored twist.
  const duDs = 1 / metersPerRepeat;
  const dvDs = angle * derivative.radius / metersPerRepeat;
  const dvDTheta = radius / metersPerRepeat;
  const determinant = duDs * dvDTheta;
  if (!(Math.abs(determinant) > EPSILON)) throw new Error("branch UV Jacobian is degenerate");
  const dPositionDu = scale(
    sub(scale(derivative.position, dvDTheta), scale(dPositionDTheta, dvDs)),
    1 / determinant,
  );
  const dPositionDv = scale(dPositionDTheta, duDs / determinant);
  const normal = normalize(cross(dPositionDv, dPositionDu), "tapered branch surface normal");
  const outward = radialDirection(frame, angle);
  if (!(dot(normal, outward) > 0.05)) {
    throw new Error("branch surface Jacobian inverted relative to the authored radial direction");
  }
  const tangent = normalize(
    sub(dPositionDu, scale(normal, dot(dPositionDu, normal))),
    "branch UV tangent",
  );
  const handedness = dot(cross(normal, tangent), dPositionDv) >= 0 ? 1 : -1;
  return { normal, tangent: [...tangent, handedness] };
}

export function computeRotationMinimizingFrames(
  centers,
  { initialNormal = [0, 0, 1], twists = [] } = {},
) {
  if (!Array.isArray(centers) || centers.length < 2) {
    throw new TypeError("at least two branch centers are required");
  }
  const frames = [];
  let arcLength = 0;
  for (let index = 0; index < centers.length; index += 1) {
    if (index > 0) arcLength += length(sub(centers[index], centers[index - 1]));
    const tangent = tangentAt(centers, index);
    let normal = index === 0
      ? projectNormal(initialNormal, tangent)
      : transportNormal(frames[index - 1].tangent, tangent, frames[index - 1].normalUntwisted);
    const normalUntwisted = normal;
    const twist = twists[index] ?? 0;
    if (twist !== 0) normal = rotateAroundAxis(normal, tangent, twist);
    const binormal = normalize(cross(tangent, normal), "branch binormal");
    normal = normalize(cross(binormal, tangent), "branch normal");
    frames.push({ center: [...centers[index]], tangent, normal, normalUntwisted, binormal, arcLength, twist });
  }
  return frames;
}

export function branchRingCapacity(sectionCount, radialSegments, capEnds = true) {
  const ringVertices = radialSegments + 1;
  return Object.freeze({
    vertices: sectionCount * ringVertices + (capEnds ? 2 * (ringVertices + 1) : 0),
    indices:
      (sectionCount - 1) * radialSegments * 6 +
      (capEnds ? 2 * radialSegments * 3 : 0),
  });
}

export function buildBranchRingFixture({
  centers = [
    [0, 0, 0],
    [0.18, 0.7, 0.05],
    [-0.08, 1.45, 0.16],
    [0.16, 2.2, 0.08],
    [0.03, 3.0, -0.05],
  ],
  radii,
  radialSegments = 12,
  metersPerRepeat = 0.75,
  capEnds = true,
  twists = [],
} = {}) {
  if (!Number.isInteger(radialSegments) || radialSegments < 3) {
    throw new RangeError("radialSegments must be an integer >= 3");
  }
  if (!(Number.isFinite(metersPerRepeat) && metersPerRepeat > 0)) {
    throw new RangeError("metersPerRepeat must be finite and positive");
  }
  const resolvedRadii = radii ?? centers.map((_, index) => 0.22 * (1 - 0.58 * index / (centers.length - 1)));
  if (resolvedRadii.length !== centers.length || resolvedRadii.some((radius) => !(radius > 0))) {
    throw new RangeError("one positive radius is required per branch section");
  }
  const frames = computeRotationMinimizingFrames(centers, { twists });
  const capacity = branchRingCapacity(centers.length, radialSegments, capEnds);
  const writer = createWriter(capacity, ["bark", "cap"]);
  const rings = [];

  for (let section = 0; section < frames.length; section += 1) {
    const frame = frames[section];
    const radius = resolvedRadii[section];
    rings[section] = [];
    for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
      const angle = radialIndex / radialSegments * Math.PI * 2;
      const direction = radialDirection(frame, angle);
      const basis = surfaceFrame(frames, resolvedRadii, section, angle, metersPerRepeat);
      rings[section][radialIndex] = writer.addVertex({
        position: add(frame.center, scale(direction, radius)),
        normal: basis.normal,
        tangent: basis.tangent,
        uv: [frame.arcLength / metersPerRepeat, angle * radius / metersPerRepeat],
        debug: [section / (frames.length - 1), radialIndex / radialSegments],
        surface: 10,
        boundary: radialIndex === radialSegments ? BOUNDARY_REASONS.uvSeam : BOUNDARY_REASONS.smoothSkin,
      });
    }
  }

  const barkStart = writer.indexCount;
  for (let section = 0; section < frames.length - 1; section += 1) {
    for (let radial = 0; radial < radialSegments; radial += 1) {
      writer.addQuad(
        rings[section][radial],
        rings[section][radial + 1],
        rings[section + 1][radial],
        rings[section + 1][radial + 1],
      );
    }
  }
  writer.addGroup(barkStart, writer.indexCount - barkStart, "bark");

  if (capEnds) {
    const capStart = writer.indexCount;
    for (const [section, sign] of [[0, -1], [frames.length - 1, 1]]) {
      const frame = frames[section];
      const capNormal = scale(frame.tangent, sign);
      const capCenter = writer.addVertex({
        position: frame.center,
        normal: capNormal,
        tangent: [...frame.normal, sign],
        uv: [0, 0],
        debug: [section === 0 ? 0 : 1, 0.5],
        surface: 11,
        boundary: BOUNDARY_REASONS.cap,
      });
      const capRing = [];
      for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
        const angle = radialIndex / radialSegments * Math.PI * 2;
        const direction = radialDirection(frame, angle);
        capRing.push(writer.addVertex({
          position: add(frame.center, scale(direction, resolvedRadii[section])),
          normal: capNormal,
          tangent: [...frame.normal, sign],
          uv: [
            Math.cos(angle) * resolvedRadii[section] / metersPerRepeat,
            Math.sin(angle) * resolvedRadii[section] / metersPerRepeat,
          ],
          debug: [section === 0 ? 0 : 1, radialIndex / radialSegments],
          surface: 11,
          boundary: BOUNDARY_REASONS.cap,
        }));
      }
      for (let radial = 0; radial < radialSegments; radial += 1) {
        if (sign < 0) writer.addTriangle(capCenter, capRing[radial + 1], capRing[radial]);
        else writer.addTriangle(capCenter, capRing[radial], capRing[radial + 1]);
      }
    }
    writer.addGroup(capStart, writer.indexCount - capStart, "cap");
  }

  const geometry = writer.finishGeometry();
  geometry.userData.fixture = {
    type: "oriented-branch-rings",
    sectionCount: centers.length,
    radialSegments,
    metersPerRepeat,
    expectedUvDensity: 1 / metersPerRepeat,
    frames,
  };
  return geometry;
}

export function validateBranchFrames(frames, tolerance = 1e-6) {
  const errors = [];
  for (const [index, frame] of frames.entries()) {
    for (const [name, vector] of [["tangent", frame.tangent], ["normal", frame.normal], ["binormal", frame.binormal]]) {
      if (Math.abs(length(vector) - 1) > tolerance) errors.push(`${index}:${name}:unit`);
    }
    if (Math.abs(dot(frame.tangent, frame.normal)) > tolerance) errors.push(`${index}:t.n`);
    if (Math.abs(dot(frame.tangent, frame.binormal)) > tolerance) errors.push(`${index}:t.b`);
    if (Math.abs(dot(frame.normal, frame.binormal)) > tolerance) errors.push(`${index}:n.b`);
    if (dot(cross(frame.tangent, frame.normal), frame.binormal) < 1 - tolerance) errors.push(`${index}:handedness`);
  }
  return { ok: errors.length === 0, errors };
}
