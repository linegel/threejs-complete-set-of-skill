import { Box3, BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from "three";

const scratchA = new Vector3();
const scratchB = new Vector3();
const scratchC = new Vector3();

export const REENTRY_LAYER_ROLES = ["hullShell", "wakeCore", "wakeHaze", "shearLobe"];

function setVector(target, value) {
  if (Array.isArray(value)) return target.fromArray(value);
  return target.copy(value);
}

export function smoothstep(edge0, edge1, value) {
  const x = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return x * x * (3 - 2 * x);
}

export function createHullSampleCache(hullGeometry) {
  const position = hullGeometry?.attributes?.position;
  if (!position) {
    throw new Error("hullSample cache requires a geometry with position attributes");
  }

  const hullSamples = [];
  for (let i = 0; i < position.count; i += 1) {
    hullSamples.push(new Vector3(position.getX(i), position.getY(i), position.getZ(i)));
  }

  const bounds = new Box3().setFromPoints(hullSamples);
  return { hullSamples, bounds };
}

export function flowFacingMask(normalWorld, flowDirectionWorld) {
  const normal = setVector(scratchA, normalWorld).normalize();
  const flow = setVector(scratchB, flowDirectionWorld).normalize();
  const facing = Math.max(normal.dot(flow.multiplyScalar(-1)), 0);
  return smoothstep(0.18, 0.96, facing);
}

export function computeSupportPoint({
  hullSampleCache,
  flowDirectionWorld,
  matrixWorld = new Matrix4(),
}) {
  const flow = setVector(scratchA, flowDirectionWorld).normalize();
  let bestScore = -Infinity;
  let supportPoint = null;
  let supportIndex = -1;

  hullSampleCache.hullSamples.forEach((hullSample, index) => {
    const world = hullSample.clone().applyMatrix4(matrixWorld);
    const score = world.dot(flow);
    if (score > bestScore) {
      bestScore = score;
      supportPoint = world;
      supportIndex = index;
    }
  });

  return { supportPoint, supportIndex, score: bestScore };
}

export function buildEventFrame({
  flowDirectionWorld,
  localUp = [0, 1, 0],
  localRight = [1, 0, 0],
}) {
  const wakeForward = setVector(scratchA, flowDirectionWorld).normalize();
  const up = scratchB.fromArray(localUp).normalize();
  const rightFallback = scratchC.fromArray(localRight).normalize();
  const projectedUp = up.sub(wakeForward.clone().multiplyScalar(up.dot(wakeForward)));

  if (projectedUp.lengthSq() < 1e-5) {
    projectedUp.copy(rightFallback);
    projectedUp.sub(wakeForward.clone().multiplyScalar(projectedUp.dot(wakeForward)));
  }

  projectedUp.normalize();
  const wakeRight = new Vector3().crossVectors(projectedUp, wakeForward).normalize();
  return {
    flowDirectionWorld: wakeForward.toArray(),
    eventFrame: {
      wakeForward: wakeForward.toArray(),
      wakeUp: projectedUp.toArray(),
      wakeRight: wakeRight.toArray(),
    },
  };
}

export function createCapsuleWakeGeometry({
  length = 5.9,
  radius = 0.42,
  expansion = 1.9,
  radialSegments = 52,
  lengthSegments = 26,
  half = false,
} = {}) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const thetaMax = half ? Math.PI : Math.PI * 2;

  for (let slice = 0; slice <= lengthSegments; slice += 1) {
    const t = slice / lengthSegments;
    const radialSpread = 1 + Math.pow(t, 1.24) * expansion;
    const axialSpread = 1 + 0.1 * t;
    for (let segment = 0; segment <= radialSegments; segment += 1) {
      const u = segment / radialSegments;
      const theta = u * thetaMax;
      const profileTurbulence = 1 + Math.sin(theta * 3.3 + t * 8.7) * 0.1 * t;
      const x = Math.cos(theta) * radius * radialSpread * profileTurbulence;
      const y = Math.sin(theta) * radius * axialSpread * profileTurbulence;
      const z = -length * t;
      positions.push(x, y, z);
      normals.push(Math.cos(theta), Math.sin(theta), 0.08 * t);
      uvs.push(u, t);
    }
  }

  const stride = radialSegments + 1;
  for (let slice = 0; slice < lengthSegments; slice += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const a = slice * stride + segment;
      const b = a + stride;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createReentryShell({
  hullGeometry,
  matrixWorld = new Matrix4(),
  flowDirectionWorld = [0, -1, 0],
  shipLength = 3.8,
  tier = "ultra",
} = {}) {
  const hullSampleCache = createHullSampleCache(hullGeometry);
  const support = computeSupportPoint({ hullSampleCache, flowDirectionWorld, matrixWorld });
  const frame = buildEventFrame({ flowDirectionWorld });
  const wakeOrigin = support.supportPoint.toArray();

  const segmentScale = tier === "medium" ? 0.5 : tier === "high" ? 0.75 : 1;
  const wakeCore = createCapsuleWakeGeometry({
    length: shipLength * 1.55,
    radius: shipLength * 0.068,
    expansion: 1.9,
    radialSegments: Math.max(16, Math.round(52 * segmentScale)),
    lengthSegments: Math.max(10, Math.round(26 * segmentScale)),
  });
  const wakeHaze = createCapsuleWakeGeometry({
    length: shipLength * 1.55 * 1.05,
    radius: shipLength * 0.068 * 1.2,
    expansion: 2.2,
    radialSegments: Math.max(14, Math.round(40 * segmentScale)),
    lengthSegments: Math.max(8, Math.round(20 * segmentScale)),
  });
  const shearLobe = createCapsuleWakeGeometry({
    length: shipLength * 1.55 * 0.88,
    radius: shipLength * 0.068 * 0.9,
    expansion: 1.55,
    radialSegments: Math.max(10, Math.round(28 * segmentScale)),
    lengthSegments: Math.max(6, Math.round(14 * segmentScale)),
    half: true,
  });

  return {
    hullSampleCache,
    hullSampleCount: hullSampleCache.hullSamples.length,
    supportPoint: wakeOrigin,
    flowDirectionWorld: frame.flowDirectionWorld,
    eventFrame: frame.eventFrame,
    wakeOrigin,
    flowFacingMask,
    roles: {
      hullShell: {
        source: "duplicated local hull topology",
        depthTest: true,
        mask: "flowFacingMask(normalWorld, flowDirectionWorld)",
      },
      wakeCore: { geometry: wakeCore, depthTest: true },
      wakeHaze: { geometry: wakeHaze, depthTest: true },
      shearLobe: { geometry: shearLobe, depthTest: true },
    },
    debugModes: ["final", "flowFacingMask", "coreHeat", "wakeFields", "MRT emissive"],
  };
}

export function estimateShellBudget(shell) {
  return Object.values(shell.roles)
    .filter((role) => role.geometry)
    .reduce(
      (total, role) => ({
        vertices: total.vertices + role.geometry.attributes.position.count,
        triangles: total.triangles + role.geometry.index.count / 3,
      }),
      { vertices: shell.hullSampleCount, triangles: 0 },
    );
}
