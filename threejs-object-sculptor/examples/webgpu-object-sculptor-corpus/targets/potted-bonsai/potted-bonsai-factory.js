import * as THREE from "three/webgpu";
import { color } from "three/tsl";

import {
  SCULPT_MODES,
  SCULPT_TIERS,
  addColliderConstructionInput,
  addMesh,
  addPivot,
  addSocket,
  applyDiagnosticMaterials,
  createSculptRuntime,
  disposeSculptObject,
} from "../../../shared/sculpt-runtime.js";

export const TARGET_ID = "potted-bonsai";
export const TARGET_TITLE = "Potted Bonsai";

const SOURCE_REVISION = "potted-bonsai-authored-grammar-v2";

const COLLIDER_ERROR_METERS = Object.freeze({
  "pot-solid": 0.16,
  "trunk-capsule": 0.17,
  "branch-left-capsule": 0.1,
  "branch-right-capsule": 0.1,
  "branch-back-capsule": 0.1,
  "canopy-trigger": 0.92,
});

const LEAF_SEED_VARIATION = Object.freeze({
  azimuthRadians: 0.08,
  verticalFraction: 0.04,
  shellFraction: 0.035,
  localOffsetPerAxisMeters: 0.012,
  maxMatchedCenterDeltaMeters: 0.16,
});

const TIER_CONFIG = Object.freeze({
  full: Object.freeze({
    potRadialSegments: 24,
    trunkSections: 10,
    primarySections: 8,
    secondarySections: 6,
    trunkRadialSegments: 12,
    branchRadialSegments: 9,
    rootSections: 5,
    rootRadialSegments: 8,
    primaryFoliageElements: 16,
    secondaryFoliageElements: 12,
    foliageRepresentation: "merged-leaf-solids",
  }),
  budgeted: Object.freeze({
    potRadialSegments: 16,
    trunkSections: 7,
    primarySections: 6,
    secondarySections: 4,
    trunkRadialSegments: 9,
    branchRadialSegments: 7,
    rootSections: 4,
    rootRadialSegments: 6,
    primaryFoliageElements: 9,
    secondaryFoliageElements: 7,
    foliageRepresentation: "merged-leaf-solids",
  }),
  minimum: Object.freeze({
    potRadialSegments: 10,
    trunkSections: 5,
    primarySections: 4,
    secondarySections: 3,
    trunkRadialSegments: 7,
    branchRadialSegments: 5,
    rootSections: 3,
    rootRadialSegments: 5,
    primaryFoliageElements: 1,
    secondaryFoliageElements: 1,
    foliageRepresentation: "opaque-canopy-cluster",
  }),
});

const PRIMARY_BRANCH_IDS = Object.freeze([
  "branch-left",
  "branch-right",
  "branch-back",
]);

const SECONDARY_BRANCH_IDS = Object.freeze([
  "branch-left-secondary",
  "branch-right-secondary",
  "branch-back-secondary",
]);

const BRANCH_IDS = Object.freeze([...PRIMARY_BRANCH_IDS, ...SECONDARY_BRANCH_IDS]);

const PROTECTED_NODE_IDS = Object.freeze([
  "root",
  "pot",
  "pot-body",
  "pot-rim",
  "pot-foot",
  "soil",
  "root-flare",
  "trunk",
  ...BRANCH_IDS,
  ...BRANCH_IDS.map((id) => `${id}-foliage`),
]);

const PROTECTED_SOCKET_IDS = Object.freeze([
  "root-anchor",
  "root-flare-front",
  "root-flare-back",
  "trunk-crown",
  ...BRANCH_IDS.flatMap((id) => [`${id}-root-socket`, `${id}-tip-socket`]),
]);

const PROTECTED_COLLIDER_IDS = Object.freeze([
  "pot-solid",
  "trunk-capsule",
  "branch-left-capsule",
  "branch-right-capsule",
  "branch-back-capsule",
  "canopy-trigger",
]);

const DESTRUCTION_GROUP_IDS = Object.freeze([
  "pot-shell",
  "root-system",
  "trunk-core",
  "fracture.branch-left",
  "fracture.branch-right",
  "fracture.branch-back",
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const TARGET_CONTRACT = deepFreeze({
  id: TARGET_ID,
  title: TARGET_TITLE,
  category: "botanical-action-ready-prop",
  units: "metre",
  dimensionsMeters: {
    width: 2.16,
    height: 2.32,
    depth: 1.55,
  },
  coordinateFrame: {
    up: "+Y",
    front: "+Z",
    root: "pot-foot center on the support plane",
  },
  modes: [...SCULPT_MODES],
  tierIds: [...SCULPT_TIERS],
  tiers: Object.fromEntries(Object.entries(TIER_CONFIG).map(([tier, config]) => [tier, {
    trunkSections: config.trunkSections,
    primarySections: config.primarySections,
    secondarySections: config.secondarySections,
    trunkRadialSegments: config.trunkRadialSegments,
    branchRadialSegments: config.branchRadialSegments,
    leafCount: config.foliageRepresentation === "merged-leaf-solids"
      ? 3 * config.primaryFoliageElements + 3 * config.secondaryFoliageElements
      : 0,
    canopyClusterCount: config.foliageRepresentation === "opaque-canopy-cluster" ? 6 : 0,
    foliageElements: 3 * config.primaryFoliageElements + 3 * config.secondaryFoliageElements,
    foliageRepresentation: config.foliageRepresentation,
  }])),
  semanticNodeIds: [...PROTECTED_NODE_IDS],
  protectedComponentIds: [...PROTECTED_NODE_IDS],
  protectedNodeIds: [...PROTECTED_NODE_IDS],
  socketIds: [...PROTECTED_SOCKET_IDS],
  protectedSocketIds: [...PROTECTED_SOCKET_IDS],
  colliderIds: [...PROTECTED_COLLIDER_IDS],
  protectedColliderIds: [...PROTECTED_COLLIDER_IDS],
  destructionGroupIds: [...DESTRUCTION_GROUP_IDS],
  protectedDestructionGroupIds: [...DESTRUCTION_GROUP_IDS],
  identityInvariants: [
    "glazed oval pot, exposed soil, and radial root flare",
    "one tapered trunk with three primary and three secondary authored branches",
    "branch-root pivots and tip sockets survive every visual tier",
    "minimum tier keeps six opaque crown clusters and never substitutes alpha cards",
  ],
  proceduralScope: {
    implementation: "authored deterministic bonsai branching grammar",
    excludedClaims: [
      "botanical growth simulation",
      "ecology or placement solver",
      "environment-forced structural dynamics",
      "rigid-body contact or fracture solver",
    ],
  },
  seedPolicy: {
    domain: "uint32",
    minimum: 0,
    maximum: 0xffffffff,
    outsideDomain: "reject",
    normalization: "none",
  },
  identityContinuity: {
    signatureInputs: ["base continuity token", "target id", "source revision", "uint32 seed"],
    visualTierAffectsGeneration: false,
    changedSeedOrSourceRequiresNewGeneration: true,
  },
  boundedSeedVariation: {
    branchInteriorOffsetPerAxisMeters: 0.022,
    matchedLeafCenterDeltaMeters: LEAF_SEED_VARIATION.maxMatchedCenterDeltaMeters,
    leafSeedParameters: { ...LEAF_SEED_VARIATION },
    changesSemanticIds: false,
    changesColliderIds: false,
  },
  motion: {
    kind: "deterministic-authored-rooted-sway-preview",
    claimStatus: "authoring-preview",
    solverAuthority: false,
    environmentForcingConsumed: false,
    productionWindPhysics: false,
    rootConstraint: "pot, soil, root flare, and branch-root pivots remain attached",
    colorShadowParity: "shared Object3D transforms drive both visible and shadow passes",
    exactReset: "setTime(0) and setTime(any, false) restore authored rotations exactly",
  },
  physics: {
    authority: "authoring-input-only",
    solverAuthority: false,
    units: "metre",
    visualLodIndependent: true,
    massInertiaClaim: "blocked-until-measured",
    colliderMaxSurfaceDeviationMeters: { ...COLLIDER_ERROR_METERS },
  },
});

function createStandardNodeMaterial(name, hex, roughness) {
  const material = new THREE.MeshStandardNodeMaterial();
  material.name = name;
  material.colorNode = color(hex);
  material.roughness = roughness;
  material.metalness = 0;
  return material;
}

function createMaterials() {
  const ceramic = new THREE.MeshPhysicalNodeMaterial();
  ceramic.name = "bonsai-glazed-ceramic";
  ceramic.colorNode = color(0x1d6770);
  ceramic.roughness = 0.19;
  ceramic.metalness = 0;
  ceramic.clearcoat = 0.82;
  ceramic.clearcoatRoughness = 0.16;

  return {
    ceramic,
    ceramicFoot: createStandardNodeMaterial("bonsai-unglazed-foot", 0x69453b, 0.76),
    soil: createStandardNodeMaterial("bonsai-soil", 0x2e2118, 0.96),
    bark: createStandardNodeMaterial("bonsai-bark", 0x60442d, 0.82),
    barkLight: createStandardNodeMaterial("bonsai-root-flare-bark", 0x79573a, 0.78),
    leaves: createStandardNodeMaterial("bonsai-opaque-leaves", 0x356b32, 0.62),
    blockout: createStandardNodeMaterial("bonsai-diagnostic-blockout", 0xb7c1c4, 0.86),
    hierarchyPot: createStandardNodeMaterial("bonsai-diagnostic-pot", 0x4fb7c5, 0.74),
    hierarchyRoot: createStandardNodeMaterial("bonsai-diagnostic-root", 0xf1a857, 0.74),
    hierarchyTrunk: createStandardNodeMaterial("bonsai-diagnostic-trunk", 0xc56b55, 0.74),
    hierarchyBranch: createStandardNodeMaterial("bonsai-diagnostic-branch", 0x8e72c7, 0.74),
    hierarchyFoliage: createStandardNodeMaterial("bonsai-diagnostic-foliage", 0x62ba72, 0.74),
    actionStatic: createStandardNodeMaterial("bonsai-action-static", 0x70828b, 0.72),
    actionRoot: createStandardNodeMaterial("bonsai-action-rooted", 0x2fb6a0, 0.72),
    actionBreakable: createStandardNodeMaterial("bonsai-action-breakable", 0xe27355, 0.72),
  };
}

function hashLabel(seed, label) {
  let state = (seed >>> 0) ^ 0x9e3779b9;
  for (let index = 0; index < label.length; index += 1) {
    state ^= label.charCodeAt(index);
    state = Math.imul(state, 0x85ebca6b) >>> 0;
    state ^= state >>> 13;
  }
  return state >>> 0;
}

function createRandom(seed, label) {
  let state = hashLabel(seed, label);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1) >>> 0;
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function boundedControlPoints(controlPoints, seed, label, amplitude = 0.022) {
  const random = createRandom(seed, `branch/${label}`);
  return controlPoints.map((point, index) => {
    const value = new THREE.Vector3(...point);
    if (index > 0 && index < controlPoints.length - 1) {
      value.x += (random() * 2 - 1) * amplitude;
      value.z += (random() * 2 - 1) * amplitude;
    }
    return value;
  });
}

function createInitialFrame(tangent) {
  const reference = Math.abs(tangent.y) < 0.92
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const normal = new THREE.Vector3().crossVectors(reference, tangent).normalize();
  const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
  return { normal, binormal };
}

function buildOrientedRingGeometry({
  controlPoints,
  sections,
  radialSegments,
  startRadius,
  endRadius,
  seed,
  label,
}) {
  if (!Number.isInteger(sections) || sections < 2) throw new RangeError("branch sections must be >= 2");
  if (!Number.isInteger(radialSegments) || radialSegments < 3) throw new RangeError("branch radial segments must be >= 3");
  if (!Number.isFinite(startRadius) || startRadius <= 0 || !Number.isFinite(endRadius) || endRadius <= 0) {
    throw new RangeError("branch startRadius and endRadius must be finite and positive");
  }
  const path = boundedControlPoints(controlPoints, seed, label);
  const curve = new THREE.CatmullRomCurve3(path, false, "centripetal", 0.5);
  const ringStride = radialSegments + 1;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const arcLengths = [0];
  const centers = [];
  const tangents = [];

  for (let section = 0; section <= sections; section += 1) {
    const t = section / sections;
    const center = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    centers.push(center);
    tangents.push(tangent);
    if (section > 0) arcLengths.push(arcLengths[section - 1] + center.distanceTo(centers[section - 1]));
  }
  const totalLength = arcLengths.at(-1) || 1;
  let { normal, binormal } = createInitialFrame(tangents[0]);
  const transport = new THREE.Quaternion();
  const radialNormal = new THREE.Vector3();
  const vertex = new THREE.Vector3();

  for (let section = 0; section <= sections; section += 1) {
    const tangent = tangents[section];
    if (section > 0) {
      transport.setFromUnitVectors(tangents[section - 1], tangent);
      normal.applyQuaternion(transport);
      normal.addScaledVector(tangent, -normal.dot(tangent));
      if (normal.lengthSq() < 1e-10) ({ normal, binormal } = createInitialFrame(tangent));
      else {
        normal.normalize();
        binormal.crossVectors(tangent, normal).normalize();
      }
    }
    const t = section / sections;
    const radius = THREE.MathUtils.lerp(startRadius, endRadius, Math.pow(t, 0.92));
    for (let radial = 0; radial <= radialSegments; radial += 1) {
      const angle = radial / radialSegments * Math.PI * 2;
      radialNormal.copy(normal).multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle)).normalize();
      vertex.copy(centers[section]).addScaledVector(radialNormal, radius);
      positions.push(vertex.x, vertex.y, vertex.z);
      normals.push(radialNormal.x, radialNormal.y, radialNormal.z);
      uvs.push(radial / radialSegments, arcLengths[section] / totalLength);
    }
  }

  for (let section = 0; section < sections; section += 1) {
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const a = section * ringStride + radial;
      const b = (section + 1) * ringStride + radial;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, d, b, b, d, c);
    }
  }

  const sideIndexCount = indices.length;
  const appendCapVertices = (section, outwardSign) => {
    const center = centers[section];
    const capNormal = tangents[section].clone().multiplyScalar(outwardSign).normalize();
    const centerIndex = positions.length / 3;
    positions.push(center.x, center.y, center.z);
    normals.push(capNormal.x, capNormal.y, capNormal.z);
    uvs.push(0.5, 0.5);
    const ringStart = positions.length / 3;
    const sideRingStart = section * ringStride;
    for (let radial = 0; radial <= radialSegments; radial += 1) {
      const source = (sideRingStart + radial) * 3;
      positions.push(positions[source], positions[source + 1], positions[source + 2]);
      normals.push(capNormal.x, capNormal.y, capNormal.z);
      const angle = radial / radialSegments * Math.PI * 2;
      uvs.push(
        0.5 + Math.cos(angle) * 0.5,
        0.5 + Math.sin(angle) * 0.5 * outwardSign,
      );
    }
    return { centerIndex, ringStart, sideRingStart };
  };
  const startCap = appendCapVertices(0, -1);
  const endCap = appendCapVertices(sections, 1);
  for (let radial = 0; radial < radialSegments; radial += 1) {
    indices.push(startCap.centerIndex, startCap.ringStart + radial + 1, startCap.ringStart + radial);
    indices.push(endCap.centerIndex, endCap.ringStart + radial, endCap.ringStart + radial + 1);
  }

  const seamWeldPairs = Array.from({ length: sections + 1 }, (_, section) => [
    section * ringStride,
    section * ringStride + radialSegments,
  ]);
  const capBoundaryWeldPairs = [startCap, endCap].flatMap((cap) => [
    [cap.ringStart, cap.ringStart + radialSegments],
    ...Array.from({ length: radialSegments + 1 }, (_, radial) => [
      cap.ringStart + radial,
      cap.sideRingStart + radial,
    ]),
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = {
    writer: "rotation-minimizing-oriented-rings",
    sections,
    radialSegments,
    seam: "duplicated-radial-vertex",
    seamWeldPairs,
    capBoundaryWeldPairs,
    topologyWeldPairs: [...seamWeldPairs, ...capBoundaryWeldPairs],
    sideIndexCount,
    caps: {
      style: "flat-duplicated-perimeter",
      start: startCap,
      end: endCap,
    },
    capTriangles: radialSegments * 2,
    expectedVertices: (sections + 1) * ringStride + 2 * (radialSegments + 2),
    expectedTriangles: 2 * sections * radialSegments + 2 * radialSegments,
    closedManifoldAfterSeamWeld: true,
  };
  return geometry;
}

function buildMergedLeafGeometry({ center, count, seed, label }) {
  const random = createRandom(seed, `foliage/${label}`);
  const positions = [];
  const indices = [];
  const localVertices = [
    [-0.105, 0, 0],
    [0.105, 0, 0],
    [0, 0.042, 0],
    [0, -0.042, 0],
    [0, 0, 0.024],
    [0, 0, -0.024],
  ];
  const localIndices = [
    0, 4, 2, 0, 3, 4, 0, 5, 3, 0, 2, 5,
    1, 2, 4, 1, 4, 3, 1, 3, 5, 1, 5, 2,
  ];
  const quaternion = new THREE.Quaternion();
  const vertex = new THREE.Vector3();
  const leafCenter = new THREE.Vector3();
  const radii = new THREE.Vector3(0.34, 0.23, 0.29);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const crownPhase = hashLabel(0, `foliage-phase/${label}`) / 0x100000000 * Math.PI * 2;

  for (let leaf = 0; leaf < count; leaf += 1) {
    const baseVertical = Math.sin((leaf + 0.5) * goldenAngle) * 0.72;
    const baseShell = 0.66 + (((leaf + 0.5) * 0.7548776662466927) % 1) * 0.22;
    const azimuth = crownPhase + leaf * goldenAngle
      + (random() * 2 - 1) * LEAF_SEED_VARIATION.azimuthRadians;
    const vertical = THREE.MathUtils.clamp(
      baseVertical + (random() * 2 - 1) * LEAF_SEED_VARIATION.verticalFraction,
      -0.76,
      0.76,
    );
    const shell = baseShell + (random() * 2 - 1) * LEAF_SEED_VARIATION.shellFraction;
    const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
    leafCenter.set(
      center[0] + Math.cos(azimuth) * radii.x * radial * shell,
      center[1] + vertical * radii.y * shell,
      center[2] + Math.sin(azimuth) * radii.z * radial * shell,
    );
    leafCenter.x += (random() * 2 - 1) * LEAF_SEED_VARIATION.localOffsetPerAxisMeters;
    leafCenter.z += (random() * 2 - 1) * LEAF_SEED_VARIATION.localOffsetPerAxisMeters;
    quaternion.setFromEuler(new THREE.Euler(
      (random() * 2 - 1) * 0.65,
      random() * Math.PI * 2,
      (random() * 2 - 1) * 0.45,
    ));
    const base = positions.length / 3;
    for (const local of localVertices) {
      vertex.fromArray(local).applyQuaternion(quaternion).add(leafCenter);
      positions.push(vertex.x, vertex.y, vertex.z);
    }
    for (const index of localIndices) indices.push(base + index);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = {
    representation: "merged-leaf-solids",
    writer: "merged-closed-leaf-octahedra",
    foliageElements: count,
    verticesPerElement: localVertices.length,
    alphaSortedFragments: 0,
  };
  return geometry;
}

function buildOpaqueCanopyGeometry({ center }) {
  const radialSegments = 8;
  const verticalSegments = 4;
  const radii = new THREE.Vector3(0.33, 0.245, 0.3);
  const positions = [];
  const normals = [];
  const indices = [];
  const addVertex = (unitX, unitY, unitZ) => {
    positions.push(
      center[0] + unitX * radii.x,
      center[1] + unitY * radii.y,
      center[2] + unitZ * radii.z,
    );
    const normal = new THREE.Vector3(unitX / radii.x, unitY / radii.y, unitZ / radii.z).normalize();
    normals.push(normal.x, normal.y, normal.z);
    return positions.length / 3 - 1;
  };

  const top = addVertex(0, 1, 0);
  const rings = [];
  for (let vertical = 1; vertical < verticalSegments; vertical += 1) {
    const phi = vertical / verticalSegments * Math.PI;
    const ring = [];
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = radial / radialSegments * Math.PI * 2;
      ring.push(addVertex(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      ));
    }
    rings.push(ring);
  }
  const bottom = addVertex(0, -1, 0);

  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(top, rings[0][next], rings[0][radial]);
  }
  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    const upper = rings[ringIndex];
    const lower = rings[ringIndex + 1];
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      indices.push(
        upper[radial], upper[next], lower[radial],
        upper[next], lower[next], lower[radial],
      );
    }
  }
  const last = rings.at(-1);
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(bottom, last[radial], last[next]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = {
    representation: "opaque-canopy-cluster",
    writer: "closed-pole-ring-ellipsoid",
    foliageElements: 1,
    alphaSortedFragments: 0,
    tileGpuPolicy: "opaque minimum-tier crown",
    closedManifold: true,
    expectedVertices: 2 + (verticalSegments - 1) * radialSegments,
    expectedTriangles: 2 * radialSegments * (verticalSegments - 1),
  };
  return geometry;
}

function makePotGeometry(radialSegments) {
  return new THREE.LatheGeometry([
    new THREE.Vector2(0.34, 0),
    new THREE.Vector2(0.46, 0.035),
    new THREE.Vector2(0.54, 0.16),
    new THREE.Vector2(0.59, 0.34),
    new THREE.Vector2(0.58, 0.41),
  ], radialSegments);
}

function createPhysicsMaterials() {
  return [
    { id: "glazed-ceramic", visualMaterialId: "bonsai-glazed-ceramic", sourceRevision: SOURCE_REVISION },
    { id: "botanical-wood", visualMaterialId: "bonsai-bark", sourceRevision: SOURCE_REVISION },
    { id: "organic-soil", visualMaterialId: "bonsai-soil", sourceRevision: SOURCE_REVISION },
  ];
}

function addBonsaiColliders(runtime) {
  addColliderConstructionInput(runtime, {
    id: "pot-solid",
    entityId: "pot",
    shape: {
      kind: "cylinder",
      units: "metre",
      startMeters: [0, 0.03, 0],
      endMeters: [0, 0.42, 0],
      radiusMeters: 0.61,
    },
    physicsMaterialId: "glazed-ceramic",
    collisionRole: "solid",
    errorMeters: COLLIDER_ERROR_METERS["pot-solid"],
    sourceRevision: SOURCE_REVISION,
  });
  addColliderConstructionInput(runtime, {
    id: "trunk-capsule",
    entityId: "trunk",
    shape: {
      kind: "capsule",
      units: "metre",
      startMeters: [0, -0.025, 0],
      endMeters: [0.04, 1.48, -0.03],
      radiusMeters: 0.16,
    },
    physicsMaterialId: "botanical-wood",
    collisionRole: "solid",
    errorMeters: COLLIDER_ERROR_METERS["trunk-capsule"],
    sourceRevision: SOURCE_REVISION,
  });
  const branches = [
    ["left", [0.02, -0.025, 0], [-0.74, 0.47, 0.18]],
    ["right", [-0.015, -0.025, 0], [0.68, 0.41, -0.16]],
    ["back", [0, -0.025, 0.02], [-0.12, 0.45, -0.56]],
  ];
  for (const [side, startMeters, endMeters] of branches) {
    addColliderConstructionInput(runtime, {
      id: `branch-${side}-capsule`,
      entityId: `branch-${side}`,
      shape: { kind: "capsule", units: "metre", startMeters, endMeters, radiusMeters: 0.095 },
      physicsMaterialId: "botanical-wood",
      collisionRole: "solid",
      errorMeters: COLLIDER_ERROR_METERS[`branch-${side}-capsule`],
      sourceRevision: SOURCE_REVISION,
    });
  }
  addColliderConstructionInput(runtime, {
    id: "canopy-trigger",
    entityId: "trunk",
    shape: {
      kind: "sphere",
      units: "metre",
      centerMeters: [0, 1.3, -0.04],
      radiusMeters: 0.92,
    },
    physicsMaterialId: "botanical-wood",
    collisionRole: "trigger",
    errorMeters: COLLIDER_ERROR_METERS["canopy-trigger"],
    sourceRevision: SOURCE_REVISION,
  });
}

function liveFrameId(runtime, domain, localId) {
  return `${runtime.subjectId}.instance/${runtime.instanceId}/generation-${runtime.instanceGeneration}.${domain}/${localId}`;
}

function targetSemanticFrameId(runtime, domain, localId) {
  return `${runtime.subjectId}.${domain}/${localId}`;
}

function makeEffectiveContinuityToken(baseToken, seed) {
  if (baseToken === undefined) return undefined;
  if (typeof baseToken !== "string" || baseToken.length === 0) {
    throw new TypeError("Potted Bonsai continuityToken must be a nonempty string");
  }
  return JSON.stringify({
    schema: "potted-bonsai-identity-continuity-v1",
    baseToken,
    targetId: TARGET_ID,
    sourceRevision: SOURCE_REVISION,
    seed,
  });
}

function createDestructionContracts(runtime) {
  const branchRows = PRIMARY_BRANCH_IDS.map((branchId) => [
    `fracture.${branchId}`,
    {
      breakableCandidate: true,
      seam: {
        kind: "authored-branch-root-cross-section",
        socketId: `${branchId}-root-socket`,
        localFrameId: liveFrameId(runtime, "attachment-frame", branchId),
        targetSemanticFrameId: targetSemanticFrameId(runtime, "attachment-frame", branchId),
      },
      releasePolicy: {
        mode: "external-solver-or-explicit-authorized-script",
        automaticRelease: false,
        breakImpulseNewtonSeconds: null,
        thresholdStatus: "blocked-insufficient-evidence",
      },
    },
  ]);
  const staticRows = [
    ["pot-shell", "root-anchor"],
    ["root-system", "root-anchor"],
    ["trunk-core", "trunk-crown"],
  ].map(([groupId, socketId]) => [groupId, {
    breakableCandidate: false,
    seam: {
      kind: "not-authored",
      socketId,
      localFrameId: null,
      targetSemanticFrameId: null,
    },
    releasePolicy: {
      mode: "none",
      automaticRelease: false,
      breakImpulseNewtonSeconds: null,
      thresholdStatus: "not-applicable",
    },
  }]);

  return new Map([...staticRows, ...branchRows].map(([groupId, policy]) => [groupId, deepFreeze({
    recordType: "AuthoredFractureGroupInput",
    groupId,
    claimStatus: "authoring-input",
    solverAuthority: false,
    contactAuthority: false,
    members: [...(runtime.destructionGroups.get(groupId) ?? [])],
    ...policy,
    sourceRevision: SOURCE_REVISION,
  })]));
}

export function createPottedBonsai({
  tier = "full",
  seed = 1,
  instanceId,
  continuityToken,
} = {}) {
  if (!SCULPT_TIERS.includes(tier)) throw new RangeError(`Unknown sculpt tier "${tier}"`);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError("Potted Bonsai seed must be a uint32 integer in [0, 0xffffffff]");
  }
  const effectiveContinuityToken = makeEffectiveContinuityToken(continuityToken, seed);
  const config = TIER_CONFIG[tier];
  const created = createSculptRuntime({
    subjectId: TARGET_ID,
    instanceId,
    continuityToken: effectiveContinuityToken,
    tier,
    seed,
    lengthUnit: "metre",
    physicsMaterials: createPhysicsMaterials(),
  });
  const runtime = created.runtime ?? created;
  const root = created.root ?? runtime.root;
  if (!root?.isObject3D) throw new Error("Shared sculpt runtime did not provide a Three.js root object");
  const materials = createMaterials();
  root.userData.targetId = TARGET_ID;
  root.userData.targetContract = TARGET_CONTRACT;
  runtime.targetContract = TARGET_CONTRACT;
  runtime.identityContinuity = deepFreeze({
    schema: "PottedBonsaiIdentityContinuity",
    baseToken: continuityToken ?? null,
    effectiveToken: effectiveContinuityToken ?? null,
    targetId: TARGET_ID,
    sourceRevision: SOURCE_REVISION,
    seed,
    visualTierAffectsGeneration: false,
    changedSeedOrSourceRequiresNewGeneration: true,
  });
  root.userData.identityContinuity = runtime.identityContinuity;
  runtime.attachmentContracts = new Map();
  runtime.previewMotionBindings = [];

  const pot = addPivot(runtime, "pot", root, { destructionGroup: "pot-shell" });
  const potBody = addMesh(runtime, {
    id: "pot-body",
    geometry: makePotGeometry(config.potRadialSegments),
    material: materials.ceramic,
    parent: pot,
    semanticGroup: "pot",
    destructionGroup: "pot-shell",
    castShadow: true,
    receiveShadow: true,
  });
  potBody.scale.z = 0.78;
  const potRim = addMesh(runtime, {
    id: "pot-rim",
    geometry: new THREE.TorusGeometry(0.59, 0.045, Math.max(4, Math.floor(config.potRadialSegments / 3)), config.potRadialSegments),
    material: materials.ceramic,
    parent: pot,
    semanticGroup: "pot",
    destructionGroup: "pot-shell",
    castShadow: true,
    receiveShadow: true,
  });
  potRim.rotation.x = Math.PI / 2;
  potRim.scale.y = 0.78;
  potRim.position.y = 0.415;
  const potFoot = addMesh(runtime, {
    id: "pot-foot",
    geometry: new THREE.CylinderGeometry(0.36, 0.39, 0.055, config.potRadialSegments),
    material: materials.ceramicFoot,
    parent: pot,
    semanticGroup: "pot",
    destructionGroup: "pot-shell",
    castShadow: true,
    receiveShadow: true,
  });
  potFoot.scale.z = 0.78;
  potFoot.position.y = 0.0275;
  const soil = addMesh(runtime, {
    id: "soil",
    geometry: new THREE.CylinderGeometry(0.525, 0.51, 0.055, config.potRadialSegments),
    material: materials.soil,
    parent: pot,
    semanticGroup: "soil",
    destructionGroup: "root-system",
    castShadow: false,
    receiveShadow: true,
  });
  soil.scale.z = 0.78;
  soil.position.y = 0.407;

  addSocket(runtime, "root-anchor", root, [0, 0.435, 0]);
  const rootFlare = addPivot(runtime, "root-flare", root, { destructionGroup: "root-system" });
  rootFlare.position.y = 0.43;
  const rootPaths = [
    ["front", [[0, 0, 0], [0.05, 0.015, 0.18], [0.08, -0.005, 0.38]], 0.075],
    ["back", [[0, 0, 0], [-0.03, 0.012, -0.17], [-0.11, -0.005, -0.34]], 0.068],
    ["left", [[0, 0, 0], [-0.16, 0.014, 0.015], [-0.38, -0.004, 0.07]], 0.072],
    ["right", [[0, 0, 0], [0.16, 0.012, -0.02], [0.36, -0.006, -0.09]], 0.066],
  ];
  for (const [side, controlPoints, radius] of rootPaths) {
    addMesh(runtime, {
      id: `root-flare-${side}-surface`,
      geometry: buildOrientedRingGeometry({
        controlPoints,
        sections: config.rootSections,
        radialSegments: config.rootRadialSegments,
        startRadius: radius,
        endRadius: 0.018,
        seed,
        label: `root-${side}`,
      }),
      material: materials.barkLight,
      parent: rootFlare,
      semanticGroup: "root",
      destructionGroup: "root-system",
      castShadow: true,
      receiveShadow: true,
    });
  }
  addSocket(runtime, "root-flare-front", rootFlare, [0.08, -0.005, 0.38]);
  addSocket(runtime, "root-flare-back", rootFlare, [-0.11, -0.005, -0.34]);

  function addPreviewSwayBinding(node, id, amplitude, frequency) {
    runtime.previewMotionBindings.push({
      recordType: "AuthoredMotionPreviewBinding",
      claimStatus: "authoring-preview",
      solverAuthority: false,
      environmentForcingConsumed: false,
      id,
      node,
      amplitude,
      frequency,
      phase: (hashLabel(seed, `wind/${id}`) / 0x100000000) * Math.PI * 2,
      baseRotation: Object.freeze([node.rotation.x, node.rotation.y, node.rotation.z]),
    });
  }

  function addBranch({
    id,
    parent,
    parentId,
    position,
    controlPoints,
    startRadius,
    endRadius,
    sections,
    radialSegments,
    destructionGroup,
    foliageElements,
    windAmplitude,
    windFrequency,
  }) {
    addSocket(runtime, `${id}-root-socket`, parent, position);
    const branch = addPivot(runtime, id, parent, { destructionGroup });
    branch.position.fromArray(position);
    const attachment = deepFreeze({
      recordType: "SculptAttachmentInput",
      claimStatus: "authoring-input",
      solverAuthority: false,
      childId: id,
      parentId,
      parentSocketId: `${id}-root-socket`,
      localFrame: {
        frameId: liveFrameId(runtime, "attachment-frame", id),
        parentFrameId: liveFrameId(runtime, "entity-frame", parentId),
        targetSemanticFrameId: targetSemanticFrameId(runtime, "attachment-frame", id),
        targetSemanticParentFrameId: targetSemanticFrameId(runtime, "entity-frame", parentId),
        units: runtime.lengthUnit,
        positionMeters: [...position],
        rotationQuaternion: [0, 0, 0, 1],
      },
      localStartMeters: [...controlPoints[0]],
      localEndMeters: [...controlPoints.at(-1)],
      baseRadius: startRadius,
      endRadius,
      overlapMeters: 0.025,
      contactType: "embedded",
      gapToleranceMeters: 0.006,
      sourceRevision: SOURCE_REVISION,
    });
    branch.userData.attachment = attachment;
    runtime.attachmentContracts.set(id, attachment);
    addMesh(runtime, {
      id: `${id}-surface`,
      geometry: buildOrientedRingGeometry({
        controlPoints,
        sections,
        radialSegments,
        startRadius,
        endRadius,
        seed,
        label: id,
      }),
      material: materials.bark,
      parent: branch,
      semanticGroup: "branch",
      destructionGroup,
      castShadow: true,
      receiveShadow: true,
    });
    const tip = controlPoints.at(-1);
    addSocket(runtime, `${id}-tip-socket`, branch, tip);
    const foliageGeometry = config.foliageRepresentation === "opaque-canopy-cluster"
      ? buildOpaqueCanopyGeometry({ center: tip })
      : buildMergedLeafGeometry({ center: tip, count: foliageElements, seed, label: id });
    addMesh(runtime, {
      id: `${id}-foliage`,
      geometry: foliageGeometry,
      material: materials.leaves,
      parent: branch,
      semanticGroup: "foliage",
      destructionGroup,
      castShadow: true,
      receiveShadow: false,
    });
    addPreviewSwayBinding(branch, id, windAmplitude, windFrequency);
    return branch;
  }

  const trunk = addPivot(runtime, "trunk", root, { destructionGroup: "trunk-core" });
  trunk.position.set(0, 0.43, 0);
  const trunkControlPoints = [[0, -0.025, 0], [0.025, 0.49, 0.018], [-0.055, 1.01, 0.005], [0.04, 1.48, -0.03]];
  addMesh(runtime, {
    id: "trunk-surface",
    geometry: buildOrientedRingGeometry({
      controlPoints: trunkControlPoints,
      sections: config.trunkSections,
      radialSegments: config.trunkRadialSegments,
      startRadius: 0.155,
      endRadius: 0.068,
      seed,
      label: "trunk",
    }),
    material: materials.bark,
    parent: trunk,
    semanticGroup: "trunk",
    destructionGroup: "trunk-core",
    castShadow: true,
    receiveShadow: true,
  });
  addSocket(runtime, "trunk-crown", trunk, trunkControlPoints.at(-1));
  addPreviewSwayBinding(trunk, "trunk", 0.018, 0.62);

  const branchLeft = addBranch({
    id: "branch-left",
    parent: trunk,
    parentId: "trunk",
    position: [-0.02, 0.67, 0],
    controlPoints: [[0.02, -0.025, 0], [-0.3, 0.13, 0.025], [-0.55, 0.31, 0.1], [-0.74, 0.47, 0.18]],
    startRadius: 0.09,
    endRadius: 0.032,
    sections: config.primarySections,
    radialSegments: config.branchRadialSegments,
    destructionGroup: "fracture.branch-left",
    foliageElements: config.primaryFoliageElements,
    windAmplitude: 0.035,
    windFrequency: 0.86,
  });
  const branchRight = addBranch({
    id: "branch-right",
    parent: trunk,
    parentId: "trunk",
    position: [0.015, 0.91, -0.005],
    controlPoints: [[-0.015, -0.025, 0], [0.25, 0.12, -0.035], [0.5, 0.27, -0.1], [0.68, 0.41, -0.16]],
    startRadius: 0.083,
    endRadius: 0.03,
    sections: config.primarySections,
    radialSegments: config.branchRadialSegments,
    destructionGroup: "fracture.branch-right",
    foliageElements: config.primaryFoliageElements,
    windAmplitude: 0.033,
    windFrequency: 0.91,
  });
  const branchBack = addBranch({
    id: "branch-back",
    parent: trunk,
    parentId: "trunk",
    position: [0, 1.14, -0.005],
    controlPoints: [[0, -0.025, 0.02], [-0.05, 0.15, -0.2], [-0.11, 0.31, -0.39], [-0.12, 0.45, -0.56]],
    startRadius: 0.076,
    endRadius: 0.028,
    sections: config.primarySections,
    radialSegments: config.branchRadialSegments,
    destructionGroup: "fracture.branch-back",
    foliageElements: config.primaryFoliageElements,
    windAmplitude: 0.03,
    windFrequency: 0.82,
  });

  addBranch({
    id: "branch-left-secondary",
    parent: branchLeft,
    parentId: "branch-left",
    position: [-0.42, 0.24, 0.07],
    controlPoints: [[0.018, -0.018, 0], [-0.12, 0.09, 0.08], [-0.25, 0.18, 0.17], [-0.36, 0.27, 0.22]],
    startRadius: 0.043,
    endRadius: 0.017,
    sections: config.secondarySections,
    radialSegments: config.branchRadialSegments,
    destructionGroup: "fracture.branch-left",
    foliageElements: config.secondaryFoliageElements,
    windAmplitude: 0.055,
    windFrequency: 1.08,
  });
  addBranch({
    id: "branch-right-secondary",
    parent: branchRight,
    parentId: "branch-right",
    position: [0.37, 0.2, -0.07],
    controlPoints: [[-0.015, -0.018, 0], [0.1, 0.09, 0.08], [0.19, 0.18, 0.19], [0.26, 0.27, 0.28]],
    startRadius: 0.04,
    endRadius: 0.016,
    sections: config.secondarySections,
    radialSegments: config.branchRadialSegments,
    destructionGroup: "fracture.branch-right",
    foliageElements: config.secondaryFoliageElements,
    windAmplitude: 0.052,
    windFrequency: 1.13,
  });
  addBranch({
    id: "branch-back-secondary",
    parent: branchBack,
    parentId: "branch-back",
    position: [-0.075, 0.25, -0.32],
    controlPoints: [[0, -0.018, 0.015], [0.12, 0.08, -0.08], [0.22, 0.17, -0.13], [0.3, 0.25, -0.18]],
    startRadius: 0.038,
    endRadius: 0.015,
    sections: config.secondarySections,
    radialSegments: config.branchRadialSegments,
    destructionGroup: "fracture.branch-back",
    foliageElements: config.secondaryFoliageElements,
    windAmplitude: 0.05,
    windFrequency: 1.04,
  });

  addBonsaiColliders(runtime);
  runtime.destructionContracts = createDestructionContracts(runtime);

  const diagnosticMaterials = {
    blockout: materials.blockout,
    hierarchy: {
      default: materials.hierarchyBranch,
      pot: materials.hierarchyPot,
      soil: materials.hierarchyRoot,
      root: materials.hierarchyRoot,
      trunk: materials.hierarchyTrunk,
      branch: materials.hierarchyBranch,
      foliage: materials.hierarchyFoliage,
    },
    "action-ready": {
      default: materials.actionBreakable,
      pot: materials.actionStatic,
      soil: materials.actionStatic,
      root: materials.actionRoot,
      trunk: materials.actionRoot,
      branch: materials.actionBreakable,
      foliage: materials.actionBreakable,
    },
  };

  function setMode(mode) {
    if (!SCULPT_MODES.includes(mode)) throw new RangeError(`Unknown sculpt mode "${mode}"`);
    runtime.mode = mode;
    applyDiagnosticMaterials(runtime, mode, diagnosticMaterials);
    if (mode !== "action-ready") setTime(0, false);
  }

  function setTime(seconds, animate = runtime.mode === "action-ready") {
    if (!Number.isFinite(seconds)) throw new TypeError("Potted Bonsai time must be finite");
    for (const binding of runtime.previewMotionBindings) {
      const [baseX, baseY, baseZ] = binding.baseRotation;
      if (!animate || seconds === 0) {
        binding.node.rotation.set(baseX, baseY, baseZ);
        continue;
      }
      const primary = Math.sin(seconds * binding.frequency + binding.phase) - Math.sin(binding.phase);
      const secondary = Math.sin(seconds * binding.frequency * 1.93 + binding.phase * 0.71) - Math.sin(binding.phase * 0.71);
      binding.node.rotation.set(
        baseX + secondary * binding.amplitude * 0.34,
        baseY,
        baseZ + primary * binding.amplitude,
      );
    }
    root.updateMatrixWorld(true);
  }

  function dispose() {
    return disposeSculptObject(root, materials);
  }

  setMode("final");
  setTime(0, false);
  runtime.foliageContract = Object.freeze({
    representation: config.foliageRepresentation,
    elements: 3 * config.primaryFoliageElements + 3 * config.secondaryFoliageElements,
    alphaSortedFragments: 0,
  });
  runtime.motionContract = TARGET_CONTRACT.motion;
  runtime.actionReadiness = deepFreeze({
    claimStatus: "authoring-input",
    solverAuthority: false,
    attachmentContractIds: [...runtime.attachmentContracts.keys()],
    fractureGroupContractIds: [...runtime.destructionContracts.keys()],
    scope: TARGET_CONTRACT.proceduralScope,
    sourceRevision: SOURCE_REVISION,
  });
  root.userData.actionReadiness = runtime.actionReadiness;
  root.updateMatrixWorld(true);

  return { root, runtime, contract: TARGET_CONTRACT, setMode, setTime, dispose };
}
