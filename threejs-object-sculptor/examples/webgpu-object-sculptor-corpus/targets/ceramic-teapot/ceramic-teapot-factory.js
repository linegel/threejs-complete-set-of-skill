import * as THREE from "three/webgpu";
import {
  color,
  float,
  mix,
  mx_noise_float,
  positionLocal,
  smoothstep,
  vec3,
} from "three/tsl";

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
  summarizeSculptRuntime,
} from "../../../shared/sculpt-runtime.js";

export const TARGET_ID = "ceramic-teapot";
export const TARGET_TITLE = "Celadon Hinge-Lid Teapot";
export const TARGET_SOURCE_REVISION = "ceramic-teapot-corpus-v3";

const CONTINUITY_SIGNATURE_REVISION = "ceramic-teapot-continuity-v1";

const SEMANTIC_NODE_IDS = Object.freeze([
  "root",
  "body-pivot",
  "body-shell",
  "neck-rim-inner-wall",
  "body-cavity",
  "foot-ring",
  "neck-band",
  "spout-pivot",
  "spout-sweep",
  "spout-root-collar",
  "spout-lip",
  "spout-outlet-inset",
  "handle-pivot",
  "handle-sweep",
  "handle-upper-mount",
  "handle-lower-mount",
  "lid-pivot",
  "lid-surface",
  "lid-band",
  "lid-knob",
  "lid-joint-pin",
]);

const COMPONENT_IDS = Object.freeze([
  "root",
  "body-pivot",
  "spout-pivot",
  "handle-pivot",
  "lid-pivot",
]);

const SOCKET_IDS = Object.freeze([
  "lid-hinge-socket",
  "lid-detach-socket",
  "pour-outlet-socket",
  "handle-grip-socket",
  "camera-interest",
]);

const COLLIDER_IDS = Object.freeze([
  "body-envelope",
  "lid-cylinder",
  "spout-lower-capsule",
  "spout-upper-capsule",
  "handle-upper-capsule",
  "handle-outer-capsule",
  "handle-lower-capsule",
]);

const DESTRUCTION_GROUP_IDS = Object.freeze([
  "ceramic-shell",
  "foot-ring",
  "spout-assembly",
  "handle-assembly",
  "lid-assembly",
  "metal-fittings",
]);

const TIER_LIMITS = Object.freeze({
  full: Object.freeze({ latheRadial: 48, sweepLong: 42, sweepShort: 34, sweepRadial: 12, torusRadial: 10 }),
  budgeted: Object.freeze({ latheRadial: 32, sweepLong: 28, sweepShort: 24, sweepRadial: 8, torusRadial: 8 }),
  minimum: Object.freeze({ latheRadial: 20, sweepLong: 18, sweepShort: 16, sweepRadial: 6, torusRadial: 6 }),
});

const TIER_CONTRACTS = Object.freeze({
  full: Object.freeze({
    ...TIER_LIMITS.full,
    target: "close product inspection",
    degradation: Object.freeze([]),
    performanceClaim: "tessellation-only; draw count is preserved",
    preserved: "all semantic parts, sockets, colliders, material zones, and the lid transform contract",
  }),
  budgeted: Object.freeze({
    ...TIER_LIMITS.budgeted,
    target: "ordinary desktop and tablet inspection",
    degradation: Object.freeze(["reduced lathe, torus, and curve-sweep tessellation"]),
    performanceClaim: "tessellation-only; draw count is preserved",
    preserved: "all semantic parts, sockets, colliders, material zones, and the lid transform contract",
  }),
  minimum: Object.freeze({
    ...TIER_LIMITS.minimum,
    target: "low-end/mobile candidate and distant inspection; device acceptance remains evidence-gated",
    degradation: Object.freeze(["minimum silhouette-safe lathe, torus, and curve-sweep tessellation"]),
    performanceClaim: "tessellation-only; draw count is preserved",
    preserved: "all semantic parts, sockets, colliders, material zones, and the lid transform contract",
  }),
});

const COLLIDER_ERROR_LOWER_BOUNDS_METERS = Object.freeze({
  "body-envelope": 0.0625,
  "lid-cylinder": 0.0321,
  "spout-lower-capsule": 0.0269,
  "spout-upper-capsule": 0.0269,
  "handle-upper-capsule": 0.0297,
  "handle-outer-capsule": 0.0297,
  "handle-lower-capsule": 0.0297,
});

export const TARGET_CONTRACT = Object.freeze({
  id: TARGET_ID,
  title: TARGET_TITLE,
  sourceRevision: TARGET_SOURCE_REVISION,
  category: "lathed-product-form",
  units: "metre",
  dimensionsMeters: Object.freeze([0.67, 0.38, 0.32]),
  coordinateFrame: Object.freeze({ up: "+Y", front: "+Z", spout: "+X", handle: "-X" }),
  modes: SCULPT_MODES,
  tierIds: SCULPT_TIERS,
  tiers: TIER_CONTRACTS,
  semanticNodeIds: SEMANTIC_NODE_IDS,
  protectedComponentIds: COMPONENT_IDS,
  protectedNodeIds: SEMANTIC_NODE_IDS,
  socketIds: SOCKET_IDS,
  protectedSocketIds: SOCKET_IDS,
  colliderIds: COLLIDER_IDS,
  protectedColliderIds: COLLIDER_IDS,
  destructionGroupIds: DESTRUCTION_GROUP_IDS,
  protectedDestructionGroupIds: DESTRUCTION_GROUP_IDS,
  identityInvariants: Object.freeze([
    "lathed belly, foot, lid, and knob remain independently addressable",
    "the body neck remains open with a separately addressable inner wall and recessed cavity",
    "rising tapered spout retains a readable outlet and pour direction",
    "rear swept handle retains two embedded mounts and a grip socket",
    "lid retains a parent-local hinge pivot and detachable socket",
    "visual tessellation never changes semantic, socket, collider, or destruction identity",
  ]),
  boundedSeedVariation: Object.freeze({
    glazeHueTurns: Object.freeze([-0.012, 0.012]),
    glazeSaturation: Object.freeze([-0.018, 0.018]),
    glazeLightness: Object.freeze([-0.018, 0.018]),
    bodyRadiusScale: Object.freeze([0.99, 1.01]),
    spoutTipVerticalMeters: Object.freeze([-0.006, 0.006]),
    curveLateralMeters: Object.freeze([-0.004, 0.004]),
  }),
  physics: Object.freeze({
    units: "metre",
    authority: "authoring-input",
    solverAuthority: false,
    visualLodIndependent: true,
    dynamicBodyClaim: "blocked-missing-mass-inertia-and-contact-law-evidence",
    colliderErrorLowerBoundsMeters: COLLIDER_ERROR_LOWER_BOUNDS_METERS,
    colliderEvidenceMethod: "deterministic directed visual-vertex to authored-primitive surface lower-bound regression; not symmetric Hausdorff proof",
  }),
  topology: Object.freeze({
    latheWriter: "semantic-indexed-lathe-v2",
    uvSeam: "duplicated-0-1",
    boundaryPolicy: "every revolved surface and curve sweep declares open or closed ends",
    degenerateTrianglesAllowed: false,
  }),
  lodPolicy: Object.freeze({
    tessellationOnly: true,
    drawCountReduction: false,
    devicePerformanceAcceptance: "incomplete-until-sustained-named-device-evidence",
  }),
  materialPolicy: Object.freeze({
    objectSpaceProceduralVariation: true,
    implementedVariation: "one shared low-frequency object-space TSL cause couples subtle celadon base-color pooling and roughness; brass/patina uses a separate shared conductor/dielectric cause",
    structuralBands: 1,
    bandLimit: "authored single low-frequency band; no micro-normal or displacement",
    textureSamples: 0,
  }),
  continuityPolicy: Object.freeze({
    signatureRevision: CONTINUITY_SIGNATURE_REVISION,
    includedInputs: Object.freeze(["subjectId", "sourceRevision", "seed", "baseContinuityToken"]),
    excludedVisualInputs: Object.freeze(["tier"]),
    rule: "same explicit instance/base token/source revision/seed preserves generation across visual tiers; a changed source revision or seed starts a new generation",
  }),
  motion: Object.freeze({
    kind: "detachable-fixed-hinge-demonstration",
    owner: "object-sculptor-transform-preview",
    hingeOriginMeters: Object.freeze([-0.066, 0.159, 0]),
    hingeAxisLocal: Object.freeze([0, 0, 1]),
    detachApi: "setDetached(boolean)",
    fluidSimulation: false,
    exactReset: true,
  }),
});

const HINGE_POSITION = Object.freeze([-0.066, 0.159, 0]);
const DETACHED_POSITION = Object.freeze([-0.066, 0.234, 0.035]);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function boundedUnit(seed, salt) {
  let state = ((Number(seed) >>> 0) ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  state ^= state >>> 16;
  state = Math.imul(state, 0x7feb352d) >>> 0;
  state ^= state >>> 15;
  state = Math.imul(state, 0x846ca68b) >>> 0;
  state = (state ^ (state >>> 16)) >>> 0;
  return state / 0x100000000;
}

function signedVariation(seed, salt, amplitude) {
  return (boundedUnit(seed, salt) * 2 - 1) * amplitude;
}

function requireUint32Seed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new TypeError("seed must be a uint32 integer");
  }
  return seed;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

export function buildCeramicTeapotContinuityToken({
  baseContinuityToken,
  seed,
  sourceRevision = TARGET_SOURCE_REVISION,
} = {}) {
  requireText(baseContinuityToken, "baseContinuityToken");
  requireUint32Seed(seed);
  requireText(sourceRevision, "sourceRevision");
  return JSON.stringify([
    CONTINUITY_SIGNATURE_REVISION,
    TARGET_ID,
    sourceRevision,
    seed,
    baseContinuityToken,
  ]);
}

function makeNodeMaterial(hex, {
  roughness = 0.5,
  metalness = 0,
  clearcoat = 0,
  clearcoatRoughness = 0.2,
  side = THREE.FrontSide,
} = {}) {
  const material = new THREE.MeshPhysicalNodeMaterial();
  material.colorNode = color(hex);
  material.roughness = roughness;
  material.metalness = metalness;
  material.clearcoat = clearcoat;
  material.clearcoatRoughness = clearcoatRoughness;
  material.side = side;
  return material;
}

function attachProceduralCause(material, causeNode, metadata) {
  Object.defineProperty(material, "proceduralCauseNode", {
    configurable: true,
    value: causeNode,
  });
  material.userData.proceduralPbr = Object.freeze(metadata);
  return material;
}

function makeCeladonMaterial(baseColor, seed, {
  roughnessRange,
  clearcoat,
  clearcoatRoughness,
  frequencyPerMeter,
  causeId,
}) {
  const material = new THREE.MeshPhysicalNodeMaterial();
  const lowColor = baseColor.clone().offsetHSL(-0.004, -0.012, -0.03);
  const highColor = baseColor.clone().offsetHSL(0.004, 0.008, 0.024);
  const seedOffset = [
    boundedUnit(seed, 101) * 11,
    boundedUnit(seed, 103) * 11,
    boundedUnit(seed, 107) * 11,
  ];
  const rawCause = mx_noise_float(
    positionLocal.mul(frequencyPerMeter).add(vec3(...seedOffset)),
  ).mul(0.5).add(0.5);
  const pooling = smoothstep(0.24, 0.78, rawCause).toVar(causeId);
  material.color = baseColor.clone();
  material.colorNode = mix(color(lowColor.getHex()), color(highColor.getHex()), pooling);
  material.roughness = (roughnessRange[0] + roughnessRange[1]) * 0.5;
  material.roughnessNode = mix(float(roughnessRange[0]), float(roughnessRange[1]), pooling);
  material.metalness = 0;
  material.metalnessNode = float(0);
  material.clearcoat = clearcoat;
  material.clearcoatRoughness = clearcoatRoughness;
  return attachProceduralCause(material, pooling, {
    responseBundle: "celadon-glaze-dielectric",
    causeId,
    coordinateMode: "object-space-metres",
    cause: "mx_noise_float-single-band",
    frequencyPerMeter,
    sharedSlots: Object.freeze(["colorNode", "roughnessNode"]),
    metalnessEndpoint: 0,
    textureSamples: 0,
    normalOrDisplacement: false,
    filteringClaim: "authored low-frequency single band; no micro-normal spectrum",
  });
}

function makeBrassMaterial(seed) {
  const material = new THREE.MeshPhysicalNodeMaterial();
  const seedOffset = [
    boundedUnit(seed, 109) * 7,
    boundedUnit(seed, 113) * 7,
    boundedUnit(seed, 127) * 7,
  ];
  const rawCause = mx_noise_float(
    positionLocal.mul(11).add(vec3(...seedOffset)),
  ).mul(0.5).add(0.5);
  const patina = smoothstep(0.68, 0.82, rawCause).toVar("brassPatinaCause");
  material.color = new THREE.Color(0xb58a42);
  material.colorNode = mix(color(0xb58a42), color(0x416b5c), patina);
  material.roughness = 0.28;
  material.roughnessNode = mix(float(0.28), float(0.64), patina);
  material.metalness = 1;
  material.metalnessNode = mix(float(1), float(0), patina);
  material.clearcoat = 0;
  return attachProceduralCause(material, patina, {
    responseBundle: "brass-conductor-with-dielectric-patina",
    causeId: "brass-patina",
    coordinateMode: "object-space-metres",
    cause: "mx_noise_float-single-band",
    frequencyPerMeter: 11,
    sharedSlots: Object.freeze(["colorNode", "roughnessNode", "metalnessNode"]),
    conductorMetalnessEndpoint: 1,
    patinaMetalnessEndpoint: 0,
    transition: "smooth filtered subpixel identity mixture",
    textureSamples: 0,
  });
}

function makeMaterials(seed) {
  const glazeColor = new THREE.Color(0x3f8f87);
  glazeColor.offsetHSL(
    signedVariation(seed, 11, 0.012),
    signedVariation(seed, 17, 0.018),
    signedVariation(seed, 23, 0.018),
  );
  const glazeEdgeColor = glazeColor.clone().offsetHSL(-0.008, 0.025, -0.065);

  return {
    glaze: makeCeladonMaterial(glazeColor, seed, {
      roughnessRange: [0.27, 0.19],
      clearcoat: 0.72,
      clearcoatRoughness: 0.13,
      frequencyPerMeter: 7.5,
      causeId: "celadonPoolingCause",
    }),
    glazeEdge: makeCeladonMaterial(glazeEdgeColor, seed, {
      roughnessRange: [0.34, 0.24],
      clearcoat: 0.58,
      clearcoatRoughness: 0.17,
      frequencyPerMeter: 8.5,
      causeId: "celadonEdgePoolingCause",
    }),
    clay: makeNodeMaterial(0x8e5d43, { roughness: 0.78, clearcoat: 0.04, clearcoatRoughness: 0.65 }),
    outlet: makeNodeMaterial(0x302821, { roughness: 0.86, side: THREE.DoubleSide }),
    brass: makeBrassMaterial(seed),
  };
}

function makeDiagnosticMaterials() {
  const hierarchyDefault = makeNodeMaterial(0x8e79ce, { roughness: 0.68 });
  const hierarchyBody = makeNodeMaterial(0x42a5b3, { roughness: 0.68 });
  const hierarchySpout = makeNodeMaterial(0xf0a64b, { roughness: 0.68 });
  const hierarchyHandle = makeNodeMaterial(0x68ba7f, { roughness: 0.68 });
  const hierarchyLid = makeNodeMaterial(0xcf6685, { roughness: 0.68 });
  const interactionDefault = makeNodeMaterial(0x5c6570, { roughness: 0.68 });
  const interactionStatic = makeNodeMaterial(0x4c92a6, { roughness: 0.64 });
  const interactionMovable = makeNodeMaterial(0xffb24b, { roughness: 0.58 });
  const interactionSocketZone = makeNodeMaterial(0x69c989, { roughness: 0.58 });
  const interactionMetal = makeNodeMaterial(0xd8779a, { roughness: 0.48, metalness: 0.42 });
  return {
    blockout: makeNodeMaterial(0xb9c4c7, { roughness: 0.84 }),
    hierarchy: {
      default: hierarchyDefault,
      body: hierarchyBody,
      clay: hierarchyBody,
      spout: hierarchySpout,
      handle: hierarchyHandle,
      lid: hierarchyLid,
      metal: hierarchyDefault,
    },
    "action-ready": {
      default: interactionDefault,
      body: interactionStatic,
      clay: interactionStatic,
      spout: interactionSocketZone,
      handle: interactionSocketZone,
      lid: interactionMovable,
      metal: interactionMetal,
    },
  };
}

function normalizeBoundaryPolicy(policy, side, boundaryY, epsilon) {
  if (!policy || typeof policy !== "object") throw new TypeError(`${side} lathe boundary policy is required`);
  if (!new Set(["open", "closed-disk", "closed-pole"]).has(policy.kind)) {
    throw new RangeError(`Unknown ${side} lathe boundary kind "${policy.kind}"`);
  }
  if (typeof policy.id !== "string" || policy.id.length === 0) {
    throw new TypeError(`${side} lathe boundary id is required`);
  }
  if (policy.kind === "closed-pole") {
    if (!Number.isFinite(policy.poleY) || Math.abs(policy.poleY - boundaryY) <= epsilon) {
      throw new RangeError(`${side} closed-pole boundary needs a distinct finite poleY`);
    }
    if ((side === "start" && policy.poleY > boundaryY - epsilon) || (side === "end" && policy.poleY < boundaryY + epsilon)) {
      throw new RangeError(`${side} closed-pole boundary must extend outward from the profile`);
    }
  }
  return Object.freeze({ kind: policy.kind, id: policy.id, ...(policy.kind === "closed-pole" ? { poleY: policy.poleY } : {}) });
}

function lathe(profile, radialSegments, { id, start, end } = {}) {
  if (typeof id !== "string" || id.length === 0) throw new TypeError("lathe semantic id is required");
  if (!Number.isInteger(radialSegments) || radialSegments < 3) {
    throw new RangeError("lathe radialSegments must be an integer >= 3");
  }
  if (!Array.isArray(profile) || profile.length < 2) throw new RangeError("lathe profile needs at least two points");

  const points = profile.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
      throw new TypeError(`lathe profile[${index}] must be [positive radius, finite y]`);
    }
    const [radius, y] = point;
    if (radius <= 0) throw new RangeError(`lathe profile[${index}] radius must be positive; axis poles use boundary policy`);
    if (index > 0) {
      const [previousRadius, previousY] = profile[index - 1];
      if (Math.hypot(radius - previousRadius, y - previousY) < 1e-10) {
        throw new RangeError(`lathe profile[${index}] duplicates its predecessor`);
      }
    }
    return Object.freeze({ radius, y });
  });
  const coordinateScale = Math.max(
    1,
    ...points.map(({ radius, y }) => Math.max(Math.abs(radius), Math.abs(y))),
  );
  const topologyEpsilon = coordinateScale * 1e-7;
  for (let index = 1; index < points.length; index += 1) {
    if (Math.hypot(points[index].radius - points[index - 1].radius, points[index].y - points[index - 1].y) <= topologyEpsilon) {
      throw new RangeError(`lathe profile[${index}] is below the scale-aware topology epsilon`);
    }
  }
  const boundaryPolicy = Object.freeze({
    start: normalizeBoundaryPolicy(start, "start", points[0].y, topologyEpsilon),
    end: normalizeBoundaryPolicy(end, "end", points.at(-1).y, topologyEpsilon),
  });
  const minimumY = Math.min(...points.map(({ y }) => y));
  const maximumY = Math.max(...points.map(({ y }) => y));
  if (boundaryPolicy.start.kind !== "open" && points[0].y > minimumY + topologyEpsilon) {
    throw new RangeError("closed start boundary must be the profile minimum Y");
  }
  if (boundaryPolicy.end.kind !== "open" && points.at(-1).y < maximumY - topologyEpsilon) {
    throw new RangeError("closed end boundary must be the profile maximum Y");
  }

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const ringStride = radialSegments + 1;
  const ringVertexOffsets = [];
  const seamVertexPairs = [];
  const capWeldPairs = [];
  const poleVertexIndices = [];
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative.at(-1) + Math.hypot(
      points[index].radius - points[index - 1].radius,
      points[index].y - points[index - 1].y,
    ));
  }
  const profileLength = cumulative.at(-1);

  function addVertex(position, normal, uv) {
    const index = positions.length / 3;
    positions.push(...position);
    normals.push(...normal);
    uvs.push(...uv);
    return index;
  }

  for (let profileIndex = 0; profileIndex < points.length; profileIndex += 1) {
    const point = points[profileIndex];
    const before = points[Math.max(0, profileIndex - 1)];
    const after = points[Math.min(points.length - 1, profileIndex + 1)];
    let tangentRadius;
    let tangentY;
    if (profileIndex === 0) {
      tangentRadius = after.radius - point.radius;
      tangentY = after.y - point.y;
    } else if (profileIndex === points.length - 1) {
      tangentRadius = point.radius - before.radius;
      tangentY = point.y - before.y;
    } else {
      const incomingRadius = point.radius - before.radius;
      const incomingY = point.y - before.y;
      const outgoingRadius = after.radius - point.radius;
      const outgoingY = after.y - point.y;
      const incomingLength = Math.hypot(incomingRadius, incomingY);
      const outgoingLength = Math.hypot(outgoingRadius, outgoingY);
      tangentRadius = incomingRadius / incomingLength + outgoingRadius / outgoingLength;
      tangentY = incomingY / incomingLength + outgoingY / outgoingLength;
      if (Math.hypot(tangentRadius, tangentY) < topologyEpsilon) {
        tangentRadius = outgoingRadius / outgoingLength;
        tangentY = outgoingY / outgoingLength;
      }
    }
    const tangentLength = Math.hypot(tangentRadius, tangentY);
    const radialNormal = tangentY / tangentLength;
    const verticalNormal = -tangentRadius / tangentLength;
    const ringOffset = positions.length / 3;
    ringVertexOffsets.push(ringOffset);
    seamVertexPairs.push(Object.freeze([ringOffset, ringOffset + radialSegments]));
    for (let segment = 0; segment <= radialSegments; segment += 1) {
      const u = segment / radialSegments;
      const angle = u * Math.PI * 2;
      const cos = segment === radialSegments ? 1 : Math.cos(angle);
      const sin = segment === radialSegments ? 0 : Math.sin(angle);
      addVertex(
        [point.radius * cos, point.y, point.radius * sin],
        [radialNormal * cos, verticalNormal, radialNormal * sin],
        [u, cumulative[profileIndex] / profileLength],
      );
    }
  }

  const topologyRegions = {};
  const sideStart = indices.length;
  for (let profileIndex = 0; profileIndex < points.length - 1; profileIndex += 1) {
    const current = ringVertexOffsets[profileIndex];
    const next = ringVertexOffsets[profileIndex + 1];
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const a = current + segment;
      const b = next + segment;
      const c = next + segment + 1;
      const d = current + segment + 1;
      indices.push(a, b, d, b, c, d);
    }
  }
  topologyRegions.side = Object.freeze({ indexStart: sideStart, indexCount: indices.length - sideStart });

  let poleVertexCount = 0;
  function addClosedDisk(side, policy) {
    const isStart = side === "start";
    const point = isStart ? points[0] : points.at(-1);
    const sideRingOffset = isStart ? ringVertexOffsets[0] : ringVertexOffsets.at(-1);
    const normalY = isStart ? -1 : 1;
    const capRingOffset = positions.length / 3;
    seamVertexPairs.push(Object.freeze([capRingOffset, capRingOffset + radialSegments]));
    for (let segment = 0; segment <= radialSegments; segment += 1) {
      const u = segment / radialSegments;
      const angle = u * Math.PI * 2;
      const cos = segment === radialSegments ? 1 : Math.cos(angle);
      const sin = segment === radialSegments ? 0 : Math.sin(angle);
      addVertex(
        [point.radius * cos, point.y, point.radius * sin],
        [0, normalY, 0],
        [0.5 + cos * 0.5, 0.5 + sin * 0.5],
      );
      capWeldPairs.push(Object.freeze([sideRingOffset + segment, capRingOffset + segment]));
    }
    const pole = addVertex([0, point.y, 0], [0, normalY, 0], [0.5, 0.5]);
    poleVertexCount += 1;
    poleVertexIndices.push(pole);
    const indexStart = indices.length;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      if (isStart) indices.push(capRingOffset + segment, capRingOffset + segment + 1, pole);
      else indices.push(capRingOffset + segment, pole, capRingOffset + segment + 1);
    }
    topologyRegions[side] = Object.freeze({ id: policy.id, kind: policy.kind, indexStart, indexCount: indices.length - indexStart });
  }

  function addClosedPole(side, policy) {
    const isStart = side === "start";
    const pole = addVertex([0, policy.poleY, 0], [0, isStart ? -1 : 1, 0], [0.5, isStart ? 0 : 1]);
    poleVertexCount += 1;
    poleVertexIndices.push(pole);
    const ring = isStart ? ringVertexOffsets[0] : ringVertexOffsets.at(-1);
    const indexStart = indices.length;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      if (isStart) indices.push(pole, ring + segment, ring + segment + 1);
      else indices.push(ring + segment, pole, ring + segment + 1);
    }
    topologyRegions[side] = Object.freeze({ id: policy.id, kind: policy.kind, indexStart, indexCount: indices.length - indexStart });
  }

  for (const side of ["start", "end"]) {
    const policy = boundaryPolicy[side];
    if (policy.kind === "closed-disk") addClosedDisk(side, policy);
    else if (policy.kind === "closed-pole") addClosedPole(side, policy);
    else topologyRegions[side] = Object.freeze({ id: policy.id, kind: policy.kind, indexStart: null, indexCount: 0 });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.semanticWriter = "semantic-indexed-lathe-v2";
  geometry.userData.semanticId = id;
  geometry.userData.boundaryPolicy = boundaryPolicy;
  geometry.userData.openBoundaryIds = Object.freeze(
    Object.values(boundaryPolicy).filter(({ kind }) => kind === "open").map(({ id: boundaryId }) => boundaryId),
  );
  geometry.userData.expectedGeometricBoundaryLoops = geometry.userData.openBoundaryIds.length;
  geometry.userData.uvSeam = "duplicated-0-1";
  geometry.userData.seamUvComponent = "u";
  geometry.userData.ringStride = ringStride;
  geometry.userData.ringVertexOffsets = Object.freeze([...ringVertexOffsets]);
  geometry.userData.seamVertexPairs = Object.freeze(seamVertexPairs);
  geometry.userData.capWeldPairs = Object.freeze(capWeldPairs);
  geometry.userData.weldPairs = Object.freeze([...seamVertexPairs, ...capWeldPairs]);
  geometry.userData.poleVertexCount = poleVertexCount;
  geometry.userData.poleVertexIndices = Object.freeze([...poleVertexIndices]);
  geometry.userData.topologyRegions = Object.freeze(topologyRegions);
  geometry.userData.expectedEulerCharacteristic = 2 - geometry.userData.expectedGeometricBoundaryLoops;
  geometry.userData.revolveTopology = Object.freeze({
    radialSegments,
    ringOffsets: geometry.userData.ringVertexOffsets,
    poleVertices: geometry.userData.poleVertexIndices,
    seamPairs: geometry.userData.seamVertexPairs,
    capRimPairs: geometry.userData.capWeldPairs,
    weldPairs: geometry.userData.weldPairs,
    regions: geometry.userData.topologyRegions,
    expectedBoundaryLoops: geometry.userData.expectedGeometricBoundaryLoops,
    expectedEulerCharacteristic: geometry.userData.expectedEulerCharacteristic,
  });
  return geometry;
}

function buildBodyProfile(radiusScale) {
  return [
    [0.074 * radiusScale, -0.104],
    [0.116 * radiusScale, -0.081],
    [0.151 * radiusScale, -0.028],
    [0.158 * radiusScale, 0.028],
    [0.145 * radiusScale, 0.085],
    [0.118 * radiusScale, 0.126],
    [0.082 * radiusScale, 0.148],
    [0.069 * radiusScale, 0.153],
    [0.066 * radiusScale, 0.159],
  ];
}

function buildSweptTubeGeometry(curve, {
  tubularSegments,
  radialSegments,
  radiusAt,
  referenceNormal = Y_AXIS,
  boundaryIds,
}) {
  if (!Number.isInteger(tubularSegments) || tubularSegments < 1) throw new RangeError("sweep tubularSegments must be positive");
  if (!Number.isInteger(radialSegments) || radialSegments < 3) throw new RangeError("sweep radialSegments must be >= 3");
  if (!boundaryIds || typeof boundaryIds.start !== "string" || typeof boundaryIds.end !== "string") {
    throw new TypeError("open sweep start/end boundary IDs are required");
  }
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const tangent = new THREE.Vector3();
  const previousTangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const center = new THREE.Vector3();
  const transport = new THREE.Quaternion();
  const previousNormal = new THREE.Vector3();
  let minimumFrameNormalDot = 1;
  let maximumOrthonormalError = 0;
  const ringStride = radialSegments + 1;
  const seamVertexPairs = [];

  for (let ring = 0; ring <= tubularSegments; ring += 1) {
    const u = ring / tubularSegments;
    curve.getPointAt(u, center);
    curve.getTangentAt(u, tangent).normalize();

    if (ring === 0) {
      normal.copy(referenceNormal).addScaledVector(tangent, -referenceNormal.dot(tangent));
      if (normal.lengthSq() < 1e-8) {
        normal.copy(Z_AXIS).addScaledVector(tangent, -Z_AXIS.dot(tangent));
      }
      normal.normalize();
    } else {
      transport.setFromUnitVectors(previousTangent, tangent);
      normal.applyQuaternion(transport);
      normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
      minimumFrameNormalDot = Math.min(minimumFrameNormalDot, previousNormal.dot(normal));
    }
    binormal.crossVectors(normal, tangent).normalize();
    maximumOrthonormalError = Math.max(
      maximumOrthonormalError,
      Math.abs(tangent.dot(normal)),
      Math.abs(tangent.dot(binormal)),
      Math.abs(normal.dot(binormal)),
      Math.abs(tangent.length() - 1),
      Math.abs(normal.length() - 1),
      Math.abs(binormal.length() - 1),
    );
    previousTangent.copy(tangent);
    previousNormal.copy(normal);

    const radius = radiusAt(u);
    if (!Number.isFinite(radius) || radius <= 0) throw new RangeError(`sweep radiusAt(${u}) must be positive`);
    const ringOffset = positions.length / 3;
    seamVertexPairs.push(Object.freeze([ringOffset, ringOffset + radialSegments]));
    for (let side = 0; side <= radialSegments; side += 1) {
      const v = side / radialSegments;
      const angle = v * Math.PI * 2;
      const cos = side === radialSegments ? 1 : Math.cos(angle);
      const sin = side === radialSegments ? 0 : Math.sin(angle);
      positions.push(
        center.x + radius * (normal.x * cos + binormal.x * sin),
        center.y + radius * (normal.y * cos + binormal.y * sin),
        center.z + radius * (normal.z * cos + binormal.z * sin),
      );
      normals.push(
        normal.x * cos + binormal.x * sin,
        normal.y * cos + binormal.y * sin,
        normal.z * cos + binormal.z * sin,
      );
      uvs.push(u, v);
    }
  }

  for (let ring = 0; ring < tubularSegments; ring += 1) {
    const nextRing = ring + 1;
    for (let side = 0; side < radialSegments; side += 1) {
      const a = ring * ringStride + side;
      const b = nextRing * ringStride + side;
      const c = nextRing * ringStride + side + 1;
      const d = ring * ringStride + side + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.framePolicy = "parallel-transport-controlled";
  geometry.userData.boundaryPolicy = Object.freeze({
    start: Object.freeze({ kind: "open", id: boundaryIds.start }),
    end: Object.freeze({ kind: "open", id: boundaryIds.end }),
  });
  geometry.userData.openBoundaryIds = Object.freeze([boundaryIds.start, boundaryIds.end]);
  geometry.userData.expectedGeometricBoundaryLoops = 2;
  geometry.userData.expectedEulerCharacteristic = 0;
  geometry.userData.uvSeam = "duplicated-0-1";
  geometry.userData.seamUvComponent = "v";
  geometry.userData.ringStride = ringStride;
  geometry.userData.tubularSegments = tubularSegments;
  geometry.userData.radialSegments = radialSegments;
  geometry.userData.seamVertexPairs = Object.freeze(seamVertexPairs);
  geometry.userData.weldPairs = geometry.userData.seamVertexPairs;
  geometry.userData.frameDiagnostics = Object.freeze({ minimumFrameNormalDot, maximumOrthonormalError });
  return geometry;
}

function orientDiskNormal(object, direction) {
  object.quaternion.setFromUnitVectors(Z_AXIS, direction.clone().normalize());
}

function addTeapotColliderInputs(runtime, sourceRevision) {
  const ceramic = runtime.physicsMaterials.get("glazed-ceramic").physicsMaterialId;
  const definitions = [
    {
      id: "body-envelope",
      entityId: "body-pivot",
      physicsMaterialId: ceramic,
      errorMeters: 0.07,
      shape: { kind: "sphere", units: "metre", centerMeters: [0, 0.025, 0], radiusMeters: 0.174 },
    },
    {
      id: "lid-cylinder",
      entityId: "lid-pivot",
      physicsMaterialId: ceramic,
      errorMeters: 0.036,
      shape: { kind: "cylinder", units: "metre", startMeters: [0.066, 0.002, 0], endMeters: [0.066, 0.068, 0], radiusMeters: 0.082 },
    },
    {
      id: "spout-lower-capsule",
      entityId: "spout-pivot",
      physicsMaterialId: ceramic,
      errorMeters: 0.04,
      shape: { kind: "capsule", units: "metre", startMeters: [0.105, 0.045, 0], endMeters: [0.245, 0.116, 0], radiusMeters: 0.046 },
    },
    {
      id: "spout-upper-capsule",
      entityId: "spout-pivot",
      physicsMaterialId: ceramic,
      errorMeters: 0.04,
      shape: { kind: "capsule", units: "metre", startMeters: [0.225, 0.106, 0], endMeters: [0.338, 0.213, 0], radiusMeters: 0.032 },
    },
    {
      id: "handle-upper-capsule",
      entityId: "handle-pivot",
      physicsMaterialId: ceramic,
      errorMeters: 0.04,
      shape: { kind: "capsule", units: "metre", startMeters: [-0.108, 0.096, 0], endMeters: [-0.248, 0.105, -0.012], radiusMeters: 0.031 },
    },
    {
      id: "handle-outer-capsule",
      entityId: "handle-pivot",
      physicsMaterialId: ceramic,
      errorMeters: 0.04,
      shape: { kind: "capsule", units: "metre", startMeters: [-0.248, 0.105, -0.012], endMeters: [-0.242, -0.071, -0.012], radiusMeters: 0.034 },
    },
    {
      id: "handle-lower-capsule",
      entityId: "handle-pivot",
      physicsMaterialId: ceramic,
      errorMeters: 0.04,
      shape: { kind: "capsule", units: "metre", startMeters: [-0.242, -0.071, -0.012], endMeters: [-0.111, -0.061, 0], radiusMeters: 0.03 },
    },
  ];

  for (const definition of definitions) {
    addColliderConstructionInput(runtime, {
      ...definition,
      collisionRole: "solid",
      sourceRevision,
    });
  }
}

export function createCeramicTeapot({
  tier = "full",
  seed = 1,
  instanceId,
  continuityToken,
  sourceRevision = TARGET_SOURCE_REVISION,
} = {}) {
  if (!SCULPT_TIERS.includes(tier)) throw new RangeError(`Unknown tier "${tier}"`);
  requireUint32Seed(seed);
  requireText(sourceRevision, "sourceRevision");
  const effectiveContinuityToken = continuityToken === undefined
    ? undefined
    : buildCeramicTeapotContinuityToken({ baseContinuityToken: continuityToken, seed, sourceRevision });

  const limits = TIER_LIMITS[tier];
  const { root, runtime } = createSculptRuntime({
    subjectId: TARGET_ID,
    instanceId,
    continuityToken: effectiveContinuityToken,
    tier,
    seed,
    lengthUnit: "metre",
    physicsMaterials: [
      { id: "glazed-ceramic", visualMaterialId: "glaze", sourceRevision },
      { id: "unglazed-clay", visualMaterialId: "clay", sourceRevision },
      { id: "brass-fitting", visualMaterialId: "brass", sourceRevision },
    ],
  });
  const materials = makeMaterials(seed);
  const diagnosticMaterials = makeDiagnosticMaterials();
  root.name = TARGET_ID;
  root.userData.targetId = TARGET_ID;
  root.userData.targetContract = TARGET_CONTRACT;

  const radiusScale = 1 + signedVariation(seed, 31, 0.01);
  const spoutTipLift = signedVariation(seed, 37, 0.006);
  const lateralBias = signedVariation(seed, 41, 0.004);

  const bodyPivot = addPivot(runtime, "body-pivot", root, { destructionGroup: "ceramic-shell" });
  const bodyShell = addMesh(runtime, {
    id: "body-shell",
    geometry: lathe(buildBodyProfile(radiusScale), limits.latheRadial, {
      id: "body-shell",
      start: { kind: "closed-disk", id: "body-bottom-disk" },
      end: { kind: "open", id: "body-neck-mouth" },
    }),
    material: materials.glaze,
    parent: bodyPivot,
    semanticGroup: "body",
    destructionGroup: "ceramic-shell",
  });
  bodyShell.userData.surfaceBands = Object.freeze({
    macro: "lathed-belly geometry",
    meso: "one low-frequency object-space TSL cause shared by base color and roughness",
    micro: "not synthesized; no material normal or displacement spectrum",
  });

  addMesh(runtime, {
    id: "neck-rim-inner-wall",
    geometry: lathe([
      [0.07 * radiusScale, 0.148],
      [0.072 * radiusScale, 0.159],
      [0.068 * radiusScale, 0.164],
      [0.056 * radiusScale, 0.165],
      [0.051 * radiusScale, 0.158],
      [0.05 * radiusScale, 0.136],
    ], limits.latheRadial, {
      id: "neck-rim-inner-wall",
      start: { kind: "open", id: "neck-outer-overlap" },
      end: { kind: "open", id: "neck-inner-wall-bottom" },
    }),
    material: materials.clay,
    parent: bodyPivot,
    semanticGroup: "clay",
    destructionGroup: "ceramic-shell",
  });

  const cavityRadius = 0.051 * radiusScale;
  const cavityFloorY = 0.1365;
  const cavityGeometry = new THREE.CircleGeometry(cavityRadius, limits.latheRadial);
  const cavitySeamPair = Object.freeze([1, cavityGeometry.getAttribute("position").count - 1]);
  cavityGeometry.userData.semanticWriter = "indexed-overlapped-circle-disk-v1";
  cavityGeometry.userData.boundaryPolicy = Object.freeze({
    rim: Object.freeze({ kind: "open-overlap", id: "body-cavity-rim-overlap" }),
  });
  cavityGeometry.userData.openBoundaryIds = Object.freeze(["body-cavity-rim-overlap"]);
  cavityGeometry.userData.expectedGeometricBoundaryLoops = 1;
  cavityGeometry.userData.expectedEulerCharacteristic = 1;
  cavityGeometry.userData.seamVertexPairs = Object.freeze([cavitySeamPair]);
  cavityGeometry.userData.weldPairs = cavityGeometry.userData.seamVertexPairs;
  cavityGeometry.userData.overlapContract = Object.freeze({
    innerWallBottomRadiusMeters: 0.05 * radiusScale,
    diskRadiusMeters: cavityRadius,
    minimumRadialOverlapMeters: 0.001 * radiusScale,
    innerWallBottomYMeters: 0.136,
    diskYMeters: cavityFloorY,
    verticalOverlapMeters: cavityFloorY - 0.136,
  });
  const bodyCavity = addMesh(runtime, {
    id: "body-cavity",
    geometry: cavityGeometry,
    material: materials.outlet,
    parent: bodyPivot,
    semanticGroup: "clay",
    destructionGroup: "ceramic-shell",
    castShadow: false,
  });
  bodyCavity.position.y = cavityFloorY;
  bodyCavity.rotation.x = -Math.PI / 2;

  addMesh(runtime, {
    id: "foot-ring",
    geometry: lathe([
      [0.091, -0.128], [0.111, -0.123], [0.119, -0.112],
      [0.115, -0.099], [0.087, -0.096],
    ], limits.latheRadial, {
      id: "foot-ring",
      start: { kind: "closed-disk", id: "foot-bottom-disk" },
      end: { kind: "closed-disk", id: "foot-top-disk" },
    }),
    material: materials.clay,
    parent: bodyPivot,
    semanticGroup: "clay",
    destructionGroup: "foot-ring",
  });

  const neckBand = addMesh(runtime, {
    id: "neck-band",
    geometry: new THREE.TorusGeometry(0.069 * radiusScale, 0.0038, limits.torusRadial, limits.latheRadial),
    material: materials.glazeEdge,
    parent: bodyPivot,
    semanticGroup: "body",
    destructionGroup: "ceramic-shell",
  });
  neckBand.rotation.x = Math.PI / 2;
  neckBand.position.y = 0.154;

  const spoutPivot = addPivot(runtime, "spout-pivot", root, { destructionGroup: "spout-assembly" });
  const spoutCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.108, 0.042, 0),
    new THREE.Vector3(0.163, 0.057, lateralBias * 0.2),
    new THREE.Vector3(0.218, 0.094, lateralBias * 0.55),
    new THREE.Vector3(0.272, 0.145, lateralBias * 0.82),
    new THREE.Vector3(0.318, 0.194 + spoutTipLift * 0.55, lateralBias),
    new THREE.Vector3(0.342, 0.218 + spoutTipLift, lateralBias),
  ], false, "centripetal");
  addMesh(runtime, {
    id: "spout-sweep",
    geometry: buildSweptTubeGeometry(spoutCurve, {
      tubularSegments: limits.sweepShort,
      radialSegments: limits.sweepRadial,
      radiusAt: (u) => THREE.MathUtils.lerp(0.043, 0.0185, Math.pow(u, 0.82)),
      referenceNormal: Y_AXIS,
      boundaryIds: { start: "spout-root-open", end: "spout-outlet-open" },
    }),
    material: materials.glaze,
    parent: spoutPivot,
    semanticGroup: "spout",
    destructionGroup: "spout-assembly",
  });

  const spoutStart = spoutCurve.getPointAt(0);
  const spoutStartTangent = spoutCurve.getTangentAt(0).normalize();
  const spoutRootCollar = addMesh(runtime, {
    id: "spout-root-collar",
    geometry: new THREE.TorusGeometry(0.042, 0.0045, limits.torusRadial, limits.latheRadial),
    material: materials.glazeEdge,
    parent: spoutPivot,
    semanticGroup: "spout",
    destructionGroup: "spout-assembly",
  });
  spoutRootCollar.position.copy(spoutStart).addScaledVector(spoutStartTangent, 0.008);
  orientDiskNormal(spoutRootCollar, spoutStartTangent);

  const spoutEnd = spoutCurve.getPointAt(1);
  const spoutEndTangent = spoutCurve.getTangentAt(1).normalize();
  const spoutLip = addMesh(runtime, {
    id: "spout-lip",
    geometry: new THREE.TorusGeometry(0.0185, 0.0044, limits.torusRadial, limits.latheRadial),
    material: materials.glazeEdge,
    parent: spoutPivot,
    semanticGroup: "spout",
    destructionGroup: "spout-assembly",
  });
  spoutLip.position.copy(spoutEnd);
  orientDiskNormal(spoutLip, spoutEndTangent);

  const outletInset = addMesh(runtime, {
    id: "spout-outlet-inset",
    geometry: new THREE.CircleGeometry(0.0142, limits.latheRadial),
    material: materials.outlet,
    parent: spoutPivot,
    semanticGroup: "clay",
    destructionGroup: "spout-assembly",
    castShadow: false,
  });
  outletInset.position.copy(spoutEnd).addScaledVector(spoutEndTangent, 0.0015);
  orientDiskNormal(outletInset, spoutEndTangent);

  const pourSocket = addSocket(runtime, "pour-outlet-socket", spoutPivot, spoutEnd.toArray());
  orientDiskNormal(pourSocket, spoutEndTangent);
  pourSocket.userData.axis = "+Z points along the authored pour direction";

  const handlePivot = addPivot(runtime, "handle-pivot", root, { destructionGroup: "handle-assembly" });
  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.108, 0.097, 0),
    new THREE.Vector3(-0.18, 0.132, -0.004),
    new THREE.Vector3(-0.244, 0.105, -0.012 + lateralBias * 0.35),
    new THREE.Vector3(-0.274, 0.018, -0.018 + lateralBias),
    new THREE.Vector3(-0.243, -0.071, -0.012 + lateralBias * 0.35),
    new THREE.Vector3(-0.173, -0.098, -0.004),
    new THREE.Vector3(-0.109, -0.061, 0),
  ], false, "centripetal");
  addMesh(runtime, {
    id: "handle-sweep",
    geometry: buildSweptTubeGeometry(handleCurve, {
      tubularSegments: limits.sweepLong,
      radialSegments: limits.sweepRadial,
      radiusAt: (u) => 0.019 + Math.sin(Math.PI * u) * 0.0025,
      referenceNormal: Z_AXIS,
      boundaryIds: { start: "handle-upper-attachment-open", end: "handle-lower-attachment-open" },
    }),
    material: materials.glazeEdge,
    parent: handlePivot,
    semanticGroup: "handle",
    destructionGroup: "handle-assembly",
  });

  for (const [id, position, rotationZ] of [
    ["handle-upper-mount", [-0.112, 0.096, 0], Math.PI / 2],
    ["handle-lower-mount", [-0.111, -0.061, 0], Math.PI / 2],
  ]) {
    const mount = addMesh(runtime, {
      id,
      geometry: lathe([[0.032, -0.008], [0.036, 0], [0.029, 0.009]], limits.latheRadial, {
        id,
        start: { kind: "closed-disk", id: `${id}-inner-disk` },
        end: { kind: "closed-disk", id: `${id}-outer-disk` },
      }),
      material: materials.glazeEdge,
      parent: handlePivot,
      semanticGroup: "handle",
      destructionGroup: "handle-assembly",
    });
    mount.position.fromArray(position);
    mount.rotation.z = rotationZ;
  }

  const gripPosition = handleCurve.getPointAt(0.5);
  const gripTangent = handleCurve.getTangentAt(0.5).normalize();
  const gripSocket = addSocket(runtime, "handle-grip-socket", handlePivot, gripPosition.toArray());
  gripSocket.quaternion.setFromUnitVectors(Y_AXIS, gripTangent);
  gripSocket.userData.axis = "+Y follows the local grip tangent";

  addSocket(runtime, "lid-hinge-socket", root, HINGE_POSITION);
  const lidPivot = addPivot(runtime, "lid-pivot", root, { destructionGroup: "lid-assembly" });
  lidPivot.position.fromArray(HINGE_POSITION);
  lidPivot.userData.actionProfile = Object.freeze({
    animationRole: "detachable",
    pivotMode: "hinge",
    localAxis: Object.freeze([0, 0, 1]),
    hingeTransformChannels: Object.freeze(["rotate-local-z"]),
    detachTransformChannels: Object.freeze(["translate", "rotate-local-z", "detach", "reattach"]),
    solverAuthority: false,
  });

  const lidSurface = addMesh(runtime, {
    id: "lid-surface",
    geometry: lathe([
      [0.061, 0.002], [0.075, 0.008], [0.077, 0.014],
      [0.066, 0.024], [0.041, 0.034],
    ], limits.latheRadial, {
      id: "lid-surface",
      start: { kind: "closed-disk", id: "lid-underside-disk" },
      end: { kind: "closed-pole", id: "lid-dome-pole", poleY: 0.038 },
    }),
    material: materials.glaze,
    parent: lidPivot,
    semanticGroup: "lid",
    destructionGroup: "lid-assembly",
  });
  lidSurface.position.x = 0.066;

  const lidBand = addMesh(runtime, {
    id: "lid-band",
    geometry: new THREE.TorusGeometry(0.075, 0.0035, limits.torusRadial, limits.latheRadial),
    material: materials.brass,
    parent: lidPivot,
    semanticGroup: "metal",
    destructionGroup: "metal-fittings",
  });
  lidBand.position.set(0.066, 0.011, 0);
  lidBand.rotation.x = Math.PI / 2;

  const lidKnob = addMesh(runtime, {
    id: "lid-knob",
    geometry: lathe([
      [0.017, 0.002], [0.022, 0.011], [0.019, 0.02],
      [0.012, 0.029],
    ], limits.latheRadial, {
      id: "lid-knob",
      start: { kind: "closed-pole", id: "lid-knob-lower-pole", poleY: 0 },
      end: { kind: "closed-pole", id: "lid-knob-upper-pole", poleY: 0.031 },
    }),
    material: materials.glazeEdge,
    parent: lidPivot,
    semanticGroup: "lid",
    destructionGroup: "lid-assembly",
  });
  lidKnob.position.set(0.066, 0.036, 0);

  const jointPin = addMesh(runtime, {
    id: "lid-joint-pin",
    geometry: new THREE.CylinderGeometry(0.006, 0.006, 0.028, limits.sweepRadial, 1),
    material: materials.brass,
    parent: lidPivot,
    semanticGroup: "metal",
    destructionGroup: "metal-fittings",
  });
  jointPin.rotation.x = Math.PI / 2;

  addSocket(runtime, "lid-detach-socket", lidPivot, [0.066, 0.018, 0]);
  const cameraInterest = addSocket(runtime, "camera-interest", root, [0.015, 0.035, 0]);
  cameraInterest.visible = false;

  addTeapotColliderInputs(runtime, sourceRevision);

  runtime.targetId = TARGET_ID;
  runtime.contract = TARGET_CONTRACT;
  runtime.sourceRevision = sourceRevision;
  runtime.subjectContinuity = Object.freeze({
    baseContinuityToken: continuityToken ?? null,
    effectiveContinuityToken: effectiveContinuityToken ?? null,
    signatureRevision: CONTINUITY_SIGNATURE_REVISION,
    sourceRevision,
    seed,
    visualTierExcluded: true,
  });
  runtime.motionContract = TARGET_CONTRACT.motion;
  runtime.components = Object.freeze({ bodyPivot, spoutPivot, handlePivot, lidPivot });
  runtime.seedVariation = Object.freeze({ radiusScale, spoutTipLift, lateralBias });
  runtime.mode = "final";
  runtime.lidOpenAmount = 0;
  runtime.lidDetached = false;

  const microDetailIds = [
    "neck-rim-inner-wall",
    "body-cavity",
    "neck-band",
    "spout-root-collar",
    "spout-lip",
    "spout-outlet-inset",
    "lid-band",
    "lid-joint-pin",
  ];

  function setAttachedHingePose(openAmount) {
    const amount = THREE.MathUtils.clamp(openAmount, 0, 1);
    lidPivot.position.fromArray(HINGE_POSITION);
    lidPivot.rotation.set(0, 0, amount * 0.72);
    runtime.lidOpenAmount = amount;
    runtime.lidDetached = false;
  }

  function setDetached(detached) {
    if (typeof detached !== "boolean") throw new TypeError("detached must be boolean");
    if (detached) {
      lidPivot.position.fromArray(DETACHED_POSITION);
      lidPivot.rotation.set(0, 0, 0.28);
      runtime.lidOpenAmount = 0;
      runtime.lidDetached = true;
    } else {
      setAttachedHingePose(0);
    }
    root.updateMatrixWorld(true);
  }

  function setMode(mode) {
    if (!SCULPT_MODES.includes(mode)) throw new RangeError(`Unknown mode "${mode}"`);
    runtime.mode = mode;
    applyDiagnosticMaterials(runtime, mode, diagnosticMaterials);
    for (const id of microDetailIds) runtime.nodes.get(id).visible = mode !== "blockout";
    setAttachedHingePose(mode === "action-ready" ? 0.76 : 0);
    root.updateMatrixWorld(true);
  }

  function setTime(seconds, animate = runtime.mode === "action-ready") {
    if (!Number.isFinite(seconds)) throw new TypeError("seconds must be finite");
    if (!animate) setAttachedHingePose(0);
    else if (!runtime.lidDetached) setAttachedHingePose(0.76 + Math.sin(seconds * 1.15) * 0.08);
    root.updateMatrixWorld(true);
  }

  function dispose() {
    return disposeSculptObject(root, { materials, diagnosticMaterials });
  }

  setMode("final");
  root.updateMatrixWorld(true);
  runtime.summary = summarizeSculptRuntime(root);
  return { root, runtime, contract: TARGET_CONTRACT, setMode, setTime, setDetached, dispose };
}

export function summarizeCeramicTeapot(root) {
  return {
    targetId: TARGET_ID,
    ...summarizeSculptRuntime(root),
  };
}
