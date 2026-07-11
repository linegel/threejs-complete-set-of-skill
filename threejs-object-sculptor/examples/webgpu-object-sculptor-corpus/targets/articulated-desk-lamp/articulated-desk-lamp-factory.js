import * as THREE from "three/webgpu";
import { color } from "three/tsl";
import {
  SCULPT_MODES,
  SCULPT_TIERS,
  createSculptRuntime,
  addMesh,
  addPivot,
  addSocket,
  cylinderBetween,
  addColliderConstructionInput,
  applyDiagnosticMaterials,
  disposeSculptObject,
} from "../../../shared/sculpt-runtime.js";

export const TARGET_ID = "articulated-desk-lamp";
export const TARGET_TITLE = "Articulated Desk Lamp";

const SOURCE_REVISION = "articulated-desk-lamp.corpus-v4";
const SEED_DOMAIN = Object.freeze({ kind: "uint32", min: 0, max: 0xffffffff });
const SHADE_BOUNDARY_RIB_COUNT = 8;
const SHADE_BOUNDARY_RIB_RADIUS_METERS = 0.012;
const SHADE_BOUNDARY_ERROR_METERS = 0.062;
const SHADE_NECK_COLLIDER_ERROR_METERS = 0.0017;
const HINGE_WASHER_RADIUS_METERS = 0.065;
const HINGE_WASHER_CENTER_Z_METERS = 0.058;
const HINGE_WASHER_HALF_DEPTH_METERS = 0.006;
const SPRING_ENDPOINT_Z_METERS = 0.062;
const SHADE_BOUNDARY_RIB_COLLIDER_IDS = Object.freeze(
  Array.from(
    { length: SHADE_BOUNDARY_RIB_COUNT },
    (_, index) => `shade-shell-rib-${String(index).padStart(2, "0")}-capsule`,
  ),
);

const TIER_LIMITS = Object.freeze({
  full: Object.freeze({
    radial: 32,
    hingeRadial: 24,
    tubeRadial: 8,
    springSegments: 96,
    springRadial: 6,
    springTurns: 10,
    shadeFasteners: 8,
    footRadialSegments: 8,
  }),
  budgeted: Object.freeze({
    radial: 20,
    hingeRadial: 16,
    tubeRadial: 6,
    springSegments: 56,
    springRadial: 5,
    springTurns: 8,
    shadeFasteners: 4,
    footRadialSegments: 4,
  }),
  minimum: Object.freeze({
    radial: 12,
    hingeRadial: 10,
    tubeRadial: 4,
    springSegments: 20,
    springRadial: 3,
    springTurns: 4,
    shadeFasteners: 0,
    footRadialSegments: 4,
  }),
});

const PROTECTED_COMPONENT_IDS = Object.freeze([
  "root",
  "base-pivot",
  "base-yaw-pivot",
  "shoulder-hinge-pivot",
  "elbow-hinge-pivot",
  "shade-hinge-pivot",
  "base-shell",
  "lower-arm-left",
  "lower-arm-right",
  "upper-arm-left",
  "upper-arm-right",
  "lower-spring-start-collar",
  "lower-spring-end-collar",
  "upper-spring-start-collar",
  "upper-spring-end-collar",
  "shade-shell",
  "shade-crown-annulus",
  "shade-crown-inner-annulus",
  "shade-crown-roll",
  "reflector-shell",
  "bulb",
]);

const PROTECTED_SOCKET_IDS = Object.freeze([
  "desk-contact-socket",
  "power-input-socket",
  "shoulder-joint-socket",
  "elbow-joint-socket",
  "shade-joint-socket",
  "light-emitter-socket",
  "shade-accessory-socket",
  "lower-spring-start-socket",
  "lower-spring-end-socket",
  "upper-spring-start-socket",
  "upper-spring-end-socket",
  "lower-cable-start-socket",
  "lower-cable-end-socket",
  "upper-cable-start-socket",
  "upper-cable-end-socket",
  "shade-cable-start-socket",
  "shade-cable-end-socket",
  "power-cable-start-socket",
  "power-cable-end-socket",
]);

const PROTECTED_CONSTRAINT_IDS = Object.freeze([
  "base-yaw-hinge-constraint",
  "shoulder-hinge-constraint",
  "elbow-hinge-constraint",
  "shade-hinge-constraint",
]);

const PROTECTED_COLLIDER_IDS = Object.freeze([
  "base-cylinder",
  "lower-arm-left-capsule",
  "lower-arm-right-capsule",
  "upper-arm-left-capsule",
  "upper-arm-right-capsule",
  "shade-neck-cylinder",
  ...SHADE_BOUNDARY_RIB_COLLIDER_IDS,
  "bulb-trigger",
]);

const PROTECTED_DESTRUCTION_GROUP_IDS = Object.freeze([
  "weighted-base",
  "lower-arm-assembly",
  "upper-arm-assembly",
  "lamp-head",
]);

export const TARGET_CONTRACT = Object.freeze({
  id: TARGET_ID,
  title: TARGET_TITLE,
  sourceRevision: SOURCE_REVISION,
  category: "articulated mechanical product",
  units: "metre",
  dimensionsMeters: Object.freeze([0.915, 0.94, 0.56]),
  boundsEnvelopeMeters: Object.freeze({
    min: Object.freeze([-0.445, 0, -0.28]),
    max: Object.freeze([0.47, 0.94, 0.28]),
    safetyMarginMeters: 0.01,
    measuredSampleUnion: Object.freeze({
      min: Object.freeze([-0.43230812670951124, -1.0430817667939074e-10, -0.27000001072883606]),
      max: Object.freeze([0.4559837909051156, 0.9271251630379932, 0.27000001072883606]),
      size: Object.freeze([0.8882919176146269, 0.9271251631423014, 0.5400000214576721]),
    }),
    sampleProtocol: Object.freeze({
      tiers: SCULPT_TIERS,
      seeds: Object.freeze([0, 1, 17, 23, 2147483647, 4294967295]),
      actionReadyTimeSeconds: Object.freeze({ start: 0, end: 60, step: 0.25 }),
      boundsMethod: "THREE.Box3.setFromObject(root, true) after deterministic absolute-time pose evaluation",
    }),
    derivation: "sampled union plus >=0.01 m per-axis authored safety margin; contact-plane tolerance handles floating-point epsilon",
  }),
  coordinateFrame: Object.freeze({
    handedness: "right-handed",
    up: "+Y",
    front: "+Z",
    origin: "center of the weighted base at the desk-contact plane",
  }),
  modes: SCULPT_MODES,
  tierIds: SCULPT_TIERS,
  tiers: TIER_LIMITS,
  protectedComponentIds: PROTECTED_COMPONENT_IDS,
  protectedSocketIds: PROTECTED_SOCKET_IDS,
  protectedConstraintIds: PROTECTED_CONSTRAINT_IDS,
  protectedColliderIds: PROTECTED_COLLIDER_IDS,
  protectedDestructionGroupIds: PROTECTED_DESTRUCTION_GROUP_IDS,
  identityInvariants: Object.freeze([
    "weighted circular base with an offset shoulder",
    "serial base-yaw, shoulder, elbow, and shade hinge pivots",
    "paired lower and upper structural arm rails",
    "bell reflector with a readable rim and exposed warm bulb",
    "all protected semantic IDs and collider construction inputs survive every visual tier",
  ]),
  boundedSeedVariation: Object.freeze({
    enamelHueOffset: Object.freeze([-0.008, 0.008]),
    elbowRestAngleRadians: Object.freeze([-0.018, 0.018]),
    shadeRestAngleRadians: Object.freeze([-0.025, 0.025]),
  }),
  seedDomain: SEED_DOMAIN,
  shadeTopology: Object.freeze({
    crown: "paired FrontSide enamel and BackSide reflector annuli close the crown with rolled overlap into shade-shell",
    exteriorCrownMeshId: "shade-crown-annulus",
    interiorCrownMeshId: "shade-crown-inner-annulus",
    interiorMaterialSide: "BackSide",
    undersideVisibleThroughLowerAperture: true,
    lowerAperture: "intentionally open at shade local Y=-0.275 m",
    lowerApertureRadiusMeters: 0.18,
  }),
  colliderErrorContracts: Object.freeze({
    "base-cylinder": Object.freeze({ minimumSurfaceDeviationMeters: 0.015, declaredMeters: 0.021 }),
    "shade-shell-ribs": Object.freeze({
      colliderIds: SHADE_BOUNDARY_RIB_COLLIDER_IDS,
      ribCount: SHADE_BOUNDARY_RIB_COUNT,
      ribRadiusMeters: SHADE_BOUNDARY_RIB_RADIUS_METERS,
      sampledVisualToProxyLowerBoundMeters: 0.0574,
      declaredBidirectionalMeters: SHADE_BOUNDARY_ERROR_METERS,
      samplingConvergenceAllowanceMeters: 0.002,
      lowerApertureClearRadiusMeters: 0.168,
      collisionRole: "boundary",
    }),
    "shade-neck-cylinder": Object.freeze({
      meshId: "shade-neck",
      shapeKind: "cylinder",
      startMeters: Object.freeze([0, -0.015, 0]),
      endMeters: Object.freeze([0, -0.075, 0]),
      radiusMeters: 0.032,
      includesVisualAndProxyCaps: true,
      minimumTierSampledLowerBoundMeters: 0.00155,
      declaredBidirectionalMeters: SHADE_NECK_COLLIDER_ERROR_METERS,
      collisionRole: "solid",
    }),
    "bulb-trigger": Object.freeze({ triggerRadiusMeters: 0.075, visualSurfaceDeviationMeters: 0.023 }),
    "arm-capsules": Object.freeze({ capExtensionMeters: 0.017, declaredMeters: 0.017 }),
  }),
  materialClaims: Object.freeze({
    coating: "dielectric powder-coat/enamel; exposed hardware uses separate metal materials",
    powderCoatSurfaceDetailStatus: "incomplete-pending-bounded-TSL-micro-normal-and-grazing-light-browser-evidence",
    bulb: "stylized opaque emissive envelope; no glass transmission, IOR, or optical-thickness claim",
  }),
  performanceEvidence: Object.freeze({
    status: "incomplete",
    reason: "no sustained named-device CPU/GPU timing or draw-submission acceptance gate",
  }),
  physics: Object.freeze({
    authoringUnits: "SI metres and radians",
    solverAuthority: false,
    colliderStatus: "construction-input-only",
    dynamicRigidBodyClaim: "blocked pending mass, inertia, contact-law, and selected-adapter evidence",
    visualTierPolicy: "visual tessellation never mutates protected physical identity or proxy dimensions",
  }),
  motion: Object.freeze({
    owner: "authored diagnostic transform timeline",
    solverAuthority: false,
    channels: Object.freeze([
      "base-yaw-pivot.rotation.y",
      "shoulder-hinge-pivot.rotation.z",
      "elbow-hinge-pivot.rotation.z",
      "shade-hinge-pivot.rotation.z",
    ]),
    resetContract: "resetPose(), setTime(_, false), and leaving action-ready restore exact seed-specific rest angles",
  }),
  continuity: Object.freeze({
    signatureSchema: "sculpt-continuity-signature-v1",
    identityInputs: Object.freeze(["targetId", "sourceRevision", "seed", "baseContinuityToken"]),
    excludedVisualInputs: Object.freeze(["tier"]),
    policy: "same base token, source revision, and seed preserve generation across visual tiers; changed source or seed changes the effective signature",
  }),
  destructionMembership: Object.freeze({
    "weighted-base": Object.freeze(["base-pivot", "base-shell", "base-upper-bezel", "base-rubber-foot"]),
    "lower-arm-assembly": Object.freeze([
      "base-yaw-pivot",
      "shoulder-hinge-pivot",
      "lower-arm-left",
      "lower-arm-right",
      "lower-spring-start-collar",
      "lower-spring-end-collar",
    ]),
    "upper-arm-assembly": Object.freeze([
      "elbow-hinge-pivot",
      "upper-arm-left",
      "upper-arm-right",
      "upper-spring-start-collar",
      "upper-spring-end-collar",
    ]),
    "lamp-head": Object.freeze([
      "shade-hinge-pivot",
      "shade-shell",
      "shade-crown-annulus",
      "shade-crown-inner-annulus",
      "shade-crown-roll",
      "bulb",
    ]),
  }),
});

const PHYSICS_MATERIALS = Object.freeze([
  Object.freeze({ id: "cast-metal", visualMaterialId: "enamel", sourceRevision: SOURCE_REVISION }),
  Object.freeze({ id: "arm-metal", visualMaterialId: "brushed-metal", sourceRevision: SOURCE_REVISION }),
  Object.freeze({ id: "rubber", visualMaterialId: "rubber", sourceRevision: SOURCE_REVISION }),
  Object.freeze({ id: "bulb-envelope", visualMaterialId: "stylized-opaque-emissive-bulb", sourceRevision: SOURCE_REVISION }),
]);

function deterministicUnit(seed, salt) {
  let state = (Math.imul(seed ^ salt, 0x45d9f3b) + 0x9e3779b9) >>> 0;
  state = (state ^ (state >>> 16)) >>> 0;
  state = Math.imul(state, 0x45d9f3b) >>> 0;
  state = (state ^ (state >>> 16)) >>> 0;
  return state / 0x100000000;
}

export function buildArticulatedDeskLampContinuitySignature({
  baseContinuityToken,
  seed,
  sourceRevision = SOURCE_REVISION,
} = {}) {
  if (baseContinuityToken === undefined) return undefined;
  if (typeof baseContinuityToken !== "string" || baseContinuityToken.length === 0) {
    throw new TypeError("baseContinuityToken must be a nonempty string");
  }
  if (!Number.isInteger(seed) || seed < SEED_DOMAIN.min || seed > SEED_DOMAIN.max) {
    throw new RangeError(`seed must be a uint32 in [${SEED_DOMAIN.min}, ${SEED_DOMAIN.max}]`);
  }
  if (typeof sourceRevision !== "string" || sourceRevision.length === 0) {
    throw new TypeError("sourceRevision must be a nonempty string");
  }
  return JSON.stringify({
    schema: "sculpt-continuity-signature-v1",
    targetId: TARGET_ID,
    sourceRevision,
    seed,
    baseContinuityToken,
  });
}

function nodeMaterial(
  hex,
  {
    roughness = 0.65,
    metalness = 0,
    emissive = null,
    emissiveIntensity = 1,
    side = THREE.FrontSide,
    zoneId = "unspecified",
    responseModel = "TSL-compatible metal/roughness PBR",
  } = {},
) {
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = color(hex);
  material.roughness = roughness;
  material.metalness = metalness;
  material.side = side;
  material.userData.pbrZoneId = zoneId;
  material.userData.responseModel = responseModel;
  if (emissive !== null) {
    material.emissiveNode = color(emissive);
    material.emissiveIntensity = emissiveIntensity;
  }
  return material;
}

function makeMaterials(seed) {
  const enamel = new THREE.Color(0x18303a);
  enamel.offsetHSL((deterministicUnit(seed, 0x13a7) - 0.5) * 0.016, 0, 0);
  const materials = {
    enamel: nodeMaterial(enamel.getHex(), {
      roughness: 0.34,
      metalness: 0,
      zoneId: "powder-coated-steel",
      responseModel: "dielectric powder-coat over unexposed steel; no render-to-physics material inference",
    }),
    enamelEdge: nodeMaterial(0x2f5963, {
      roughness: 0.39,
      metalness: 0,
      zoneId: "dielectric-enamel-edge",
      responseModel: "dielectric enamel edge; exposed metal is represented only by separate hardware materials",
    }),
    brushedMetal: nodeMaterial(0x879399, {
      roughness: 0.38,
      metalness: 0.94,
      zoneId: "brushed-steel-hardware",
    }),
    darkMetal: nodeMaterial(0x21292d, {
      roughness: 0.46,
      metalness: 0.86,
      zoneId: "darkened-steel-hardware",
    }),
    brass: nodeMaterial(0xb48138, {
      roughness: 0.32,
      metalness: 0.9,
      zoneId: "brass-electrical-hardware",
    }),
    reflector: nodeMaterial(0xf1e8d0, {
      roughness: 0.31,
      metalness: 0,
      side: THREE.BackSide,
      zoneId: "warm-enamel-reflector",
      responseModel: "dielectric warm enamel reflector proxy",
    }),
    rubber: nodeMaterial(0x111619, {
      roughness: 0.9,
      metalness: 0,
      zoneId: "rubber-foot-and-cable",
    }),
    bulb: nodeMaterial(0xffd18c, {
      roughness: 0.22,
      metalness: 0,
      emissive: 0xff8d28,
      emissiveIntensity: 2.4,
      zoneId: "stylized-opaque-emissive-bulb",
      responseModel: "stylized opaque emissive envelope; no transmission, IOR, or physical glass claim",
    }),
    indicator: nodeMaterial(0x71f0cd, {
      roughness: 0.28,
      emissive: 0x20cfa7,
      emissiveIntensity: 1.7,
      zoneId: "power-indicator",
    }),
  };

  for (const material of [materials.enamel, materials.enamelEdge]) {
    material.userData.surfaceDetailEvidenceStatus =
      "incomplete-pending-bounded-TSL-micro-normal-and-grazing-light-browser-evidence";
  }

  materials.diagnostics = {
    blockout: nodeMaterial(0xaebcc2, { roughness: 0.82, zoneId: "diagnostic-blockout" }),
    hierarchy: {
      base: nodeMaterial(0x3da9d8, { roughness: 0.68, zoneId: "diagnostic-base" }),
      articulation: nodeMaterial(0xd65d82, { roughness: 0.68, zoneId: "diagnostic-articulation" }),
      arm: nodeMaterial(0xf0b34c, { roughness: 0.68, zoneId: "diagnostic-arm" }),
      head: nodeMaterial(0x65c18c, { roughness: 0.68, zoneId: "diagnostic-head" }),
      cable: nodeMaterial(0x8b78d2, { roughness: 0.68, zoneId: "diagnostic-cable" }),
      spring: nodeMaterial(0x5fc6c8, { roughness: 0.68, zoneId: "diagnostic-spring" }),
      detail: nodeMaterial(0xc68be2, { roughness: 0.68, zoneId: "diagnostic-detail" }),
      default: nodeMaterial(0x87949a, { roughness: 0.72, zoneId: "diagnostic-default" }),
    },
    "action-ready": {
      base: nodeMaterial(0x347d95, { roughness: 0.58, zoneId: "action-static-base" }),
      articulation: nodeMaterial(0xff4d82, { roughness: 0.52, zoneId: "action-hinges" }),
      arm: nodeMaterial(0xffb347, { roughness: 0.56, zoneId: "action-links" }),
      head: nodeMaterial(0x42d6a4, { roughness: 0.54, zoneId: "action-head" }),
      cable: nodeMaterial(0x9c7af2, { roughness: 0.6, zoneId: "action-cable" }),
      spring: nodeMaterial(0x65dbe0, { roughness: 0.55, zoneId: "action-springs" }),
      detail: nodeMaterial(0xd993f0, { roughness: 0.58, zoneId: "action-detail" }),
      default: nodeMaterial(0x95a2a8, { roughness: 0.62, zoneId: "action-default" }),
    },
  };
  return materials;
}

function place(object, { position, rotation, scale } = {}) {
  if (position) object.position.fromArray(position);
  if (rotation) object.rotation.fromArray(rotation);
  if (scale) object.scale.fromArray(scale);
  return object;
}

function addPart(runtime, {
  id,
  geometry,
  material,
  parent,
  semanticGroup,
  destructionGroup,
  position,
  rotation,
  scale,
  detailRole = "structural",
  castShadow = true,
  receiveShadow = true,
}) {
  const value = addMesh(runtime, {
    id,
    geometry,
    material,
    parent,
    semanticGroup,
    destructionGroup,
    castShadow,
    receiveShadow,
  });
  place(value, { position, rotation, scale });
  value.userData.detailRole = detailRole;
  return value;
}

function deepFreezeRecord(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreezeRecord(entry);
  return Object.freeze(value);
}

function stableAuthoringId(namespace, localId, generation = 1) {
  return Object.freeze({ namespace, localId, generation });
}

function addHingeConstraint(runtime, pivot, {
  id,
  parentEntityId,
  childEntityId,
  parentAnchorPositionMeters,
  axis,
  minRadians,
  maxRadians,
  restRadians,
  amplitudeRadians,
  angularFrequencyRadPerS,
}) {
  if (runtime.constraints.has(id)) throw new Error(`Duplicate lamp constraint "${id}"`);
  const previewBindingId = stableAuthoringId(
    `${TARGET_ID}.instance/${runtime.instanceId}.motion-preview`,
    id,
    runtime.instanceGeneration,
  );
  const constraint = deepFreezeRecord({
    recordType: "ConstraintConstructionInput",
    constraintId: stableAuthoringId(
      `${TARGET_ID}.instance/${runtime.instanceId}.constraint`,
      id,
      runtime.instanceGeneration,
    ),
    targetSemanticConstraintId: stableAuthoringId(`${TARGET_ID}.constraint`, id),
    type: "hinge",
    claimStatus: "authoring-input",
    solverAuthority: false,
    contactAndMotionAuthority: "none",
    parentEntityId: runtime.entityIds.get(parentEntityId),
    childEntityId: runtime.entityIds.get(childEntityId),
    targetSemanticParentEntityId: runtime.targetSemanticEntityIds.get(parentEntityId),
    targetSemanticChildEntityId: runtime.targetSemanticEntityIds.get(childEntityId),
    parentAnchor: {
      frameId: `${TARGET_ID}.instance/${runtime.instanceId}/generation-${runtime.instanceGeneration}.constraint-anchor/${id}/parent`,
      ownerEntityId: runtime.entityIds.get(parentEntityId),
      positionMeters: [...parentAnchorPositionMeters],
      rotationQuaternion: [0, 0, 0, 1],
      units: "metre",
    },
    childAnchor: {
      frameId: `${TARGET_ID}.instance/${runtime.instanceId}/generation-${runtime.instanceGeneration}.constraint-anchor/${id}/child`,
      ownerEntityId: runtime.entityIds.get(childEntityId),
      positionMeters: [0, 0, 0],
      rotationQuaternion: [0, 0, 0, 1],
      units: "metre",
    },
    axis: {
      frame: "child-anchor-local",
      vector: [...axis],
      normalized: true,
    },
    angularLimit: {
      minimum: { value: minRadians, unit: "radian", label: "Authored", source: SOURCE_REVISION },
      maximum: { value: maxRadians, unit: "radian", label: "Authored", source: SOURCE_REVISION },
      wrapPolicy: "bounded-no-wrap",
    },
    rest: { value: restRadians, unit: "radian", label: "Authored", source: SOURCE_REVISION },
    previewBindingId,
    canonicalConstraintStatus: "blocked",
    missingEvidence: [
      "parent and child rigid-body mass and inertia",
      "compliance law",
      "damping law",
      "motor or drive law",
      "solver tolerance and iteration policy",
    ],
    blockingRequirements: [
      "PhysicsContext and registered frames/origin/transform revisions",
      "committed parent and child pose versions",
      "selected constraint and motion owner or ExternalSolverAdapter",
      "validity interval and clock mapping",
      "body, inertia, compliance, damping, and material evidence",
    ],
    approximationError: {
      maximumAnchorPlacementErrorMeters: 0.001,
      label: "Authored",
      source: `${SOURCE_REVISION}: semantic hinge centers; not measured solver evidence`,
    },
    validity: {
      tiers: [...SCULPT_TIERS],
      visualLodIndependent: true,
      canonicalValidityIntervalStatus: "blocked",
      invalidation: [
        "parent or child entity generation revision",
        "attachment-frame or hinge-axis revision",
        "source geometry or dimensions revision",
        "physics material or body-property revision",
      ],
    },
    sourceRevision: SOURCE_REVISION,
  });

  const previewBinding = deepFreezeRecord({
    recordType: "AuthoredMotionPreviewBinding",
    bindingId: previewBindingId,
    nodeId: childEntityId,
    channel: axis[1] === 1 ? "rotation.y" : "rotation.z",
    axisLocal: [...axis],
    restRadians,
    amplitudeRadians,
    angularFrequencyRadPerS,
    limitRadians: [minRadians, maxRadians],
    equation: "angle(t) = rest + amplitude * sin(angularFrequencyRadPerS * t)",
    equationRevision: `${SOURCE_REVISION}.motion-preview-v1`,
    solverAuthority: false,
  });

  runtime.constraints.set(id, constraint);
  runtime.motionPreviewBindings.set(id, previewBinding);
  pivot.userData.animationRole = "articulated";
  pivot.userData.constraint = constraint;
  pivot.userData.motionPreview = previewBinding;
  return constraint;
}

function addAttachmentContract(runtime, object, {
  id,
  startSocketId,
  endSocketId,
  localStart,
  localEnd,
  radiusMeters,
  overlapMeters,
  gapToleranceMeters,
  receivingWasherMeshIds = [],
}) {
  if (runtime.attachments.has(id)) throw new Error(`Duplicate lamp attachment "${id}"`);
  const startSocket = runtime.sockets.get(startSocketId);
  const endSocket = runtime.sockets.get(endSocketId);
  if (!startSocket || !endSocket) throw new Error(`Attachment "${id}" requires registered sockets`);
  if (startSocket.parent !== endSocket.parent || object.parent !== startSocket.parent) {
    throw new Error(`Attachment "${id}" is limited to one decorative parent-local frame`);
  }
  const attachment = deepFreezeRecord({
    recordType: "SculptAttachmentInput",
    attachmentId: stableAuthoringId(
      `${TARGET_ID}.instance/${runtime.instanceId}.attachment`,
      id,
      runtime.instanceGeneration,
    ),
    targetSemanticAttachmentId: stableAuthoringId(`${TARGET_ID}.attachment`, id),
    childId: object.userData.sculptEntityId,
    targetSemanticChildId: object.userData.sculptTargetSemanticEntityId,
    startParentId: startSocket.parent.userData.sculptEntityId,
    endParentId: endSocket.parent.userData.sculptEntityId,
    startSocketId: startSocket.userData.sculptEntityId,
    endSocketId: endSocket.userData.sculptEntityId,
    startSocketLocalId: startSocketId,
    endSocketLocalId: endSocketId,
    localStartMeters: [...localStart],
    localEndMeters: [...localEnd],
    baseRadiusMeters: radiusMeters,
    endRadiusMeters: radiusMeters,
    contactType: "socket",
    overlapMeters,
    gapToleranceMeters,
    crossJoint: false,
    visualBehavior: "decorative-rigid-parent-local",
    parentLocalFrameOnly: true,
    dynamicEndpointRebuild: false,
    endpointRebuildPolicy: "static-authored-endpoints; rebuild the factory after socket-layout revision",
    mechanicalSemantics: "decorative only; no load, extension, force, or cross-joint constraint claim",
    receivingWasherMeshIds: [...receivingWasherMeshIds],
    mechanicalLoadAuthority: false,
    solverAuthority: false,
    sourceRevision: SOURCE_REVISION,
    evidenceRefs: ["authored-corpus-lamp-mechanical-layout"],
    invalidation: [
      "socket transform revision",
      "child geometry revision",
      "source dimensions revision",
      ...(receivingWasherMeshIds.length > 0
        ? ["receiving-washer geometry or hinge-axis revision"]
        : []),
    ],
  });
  runtime.attachments.set(id, attachment);
  object.userData.attachment = attachment;
  return attachment;
}

function buildHelixGeometry(start, end, coilRadius, turns, tubularSegments, radialSegments) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const axis = b.clone().sub(a);
  const length = axis.length();
  const tangent = axis.clone().normalize();
  const reference = Math.abs(tangent.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3().crossVectors(tangent, reference).normalize();
  const binormal = new THREE.Vector3().crossVectors(tangent, side).normalize();
  const pointCount = Math.max(8, tubularSegments + 1);
  const points = [];
  for (let index = 0; index < pointCount; index += 1) {
    const u = index / (pointCount - 1);
    const envelope = Math.min(1, u * 7, (1 - u) * 7);
    const phase = u * turns * Math.PI * 2;
    points.push(
      a.clone()
        .addScaledVector(axis, u)
        .addScaledVector(side, Math.cos(phase) * coilRadius * envelope)
        .addScaledVector(binormal, Math.sin(phase) * coilRadius * envelope),
    );
  }
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const tubeRadiusMeters = Math.min(0.0045, length * 0.012);
  const geometry = new THREE.TubeGeometry(
    curve,
    tubularSegments,
    tubeRadiusMeters,
    radialSegments,
    false,
  );
  geometry.userData.tubeRadiusMeters = tubeRadiusMeters;
  geometry.userData.radiusContract = "exact TubeGeometry.parameters.radius in metres";
  return geometry;
}

function addSpringCollar(runtime, parent, id, position, material, limits, destructionGroup) {
  const collar = addPart(runtime, {
    id,
    geometry: new THREE.CylinderGeometry(0.009, 0.009, 0.008, limits.hingeRadial, 1),
    material,
    parent,
    semanticGroup: "spring",
    destructionGroup,
    position,
    rotation: [Math.PI / 2, 0, 0],
    detailRole: "meso",
    castShadow: false,
    receiveShadow: false,
  });
  collar.userData.attachmentRole = "spring-hook-collar-embedded-through-washer-face";
  collar.userData.sourceDimensions = Object.freeze({
    radiusMeters: 0.009,
    depthMeters: 0.008,
    lengthUnit: "metre",
  });
  return collar;
}

function addJointHardware(runtime, parent, id, materials, limits, destructionGroup) {
  const barrel = addPart(runtime, {
    id: `${id}-barrel`,
    geometry: new THREE.CylinderGeometry(0.052, 0.052, 0.105, limits.hingeRadial, 1),
    material: materials.darkMetal,
    parent,
    semanticGroup: "articulation",
    destructionGroup,
    rotation: [Math.PI / 2, 0, 0],
  });
  barrel.userData.jointAxisLocal = Object.freeze([0, 0, 1]);

  for (const side of [-1, 1]) {
    addPart(runtime, {
      id: `${id}-washer-${side > 0 ? "front" : "back"}`,
      geometry: new THREE.CylinderGeometry(
        HINGE_WASHER_RADIUS_METERS,
        HINGE_WASHER_RADIUS_METERS,
        HINGE_WASHER_HALF_DEPTH_METERS * 2,
        limits.hingeRadial,
        1,
      ),
      material: side > 0 ? materials.brass : materials.brushedMetal,
      parent,
      semanticGroup: "articulation",
      destructionGroup,
      position: [0, 0, side * HINGE_WASHER_CENTER_Z_METERS],
      rotation: [Math.PI / 2, 0, 0],
      detailRole: "meso",
    });
  }
}

function addColliderInputs(runtime) {
  const shadeBoundaryInputs = SHADE_BOUNDARY_RIB_COLLIDER_IDS.map((id, index) => {
    const angle = (index / SHADE_BOUNDARY_RIB_COUNT) * Math.PI * 2;
    const sectorHalfAngle = Math.PI / SHADE_BOUNDARY_RIB_COUNT;
    const radial = (radius, y) => [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
    return {
      id,
      entityId: "shade-hinge-pivot",
      shape: {
        kind: "capsule",
        units: "metre",
        startMeters: radial(0.073, -0.055),
        endMeters: radial(0.18, -0.275),
        radiusMeters: SHADE_BOUNDARY_RIB_RADIUS_METERS,
      },
      physicsMaterialId: "cast-metal",
      collisionRole: "boundary",
      errorMeters: SHADE_BOUNDARY_ERROR_METERS,
      intent: {
        proxySetId: "shade-hollow-boundary",
        proxySetColliderIds: [...SHADE_BOUNDARY_RIB_COLLIDER_IDS],
        proxySetComposition: "all eight sector capsules form one sparse hollow conical boundary candidate",
        ribIndex: index,
        ribCount: SHADE_BOUNDARY_RIB_COUNT,
        comparisonMeshScope: [
          "shade-crown-annulus",
          "shade-crown-inner-annulus",
          "shade-crown-roll",
          "shade-shell",
          "shade-rim",
        ],
        comparisonSectorRadians: [angle - sectorHalfAngle, angle + sectorHalfAngle],
        excludesMeshIds: [
          "reflector-shell",
          "bulb-socket",
          "bulb",
        ],
        hollowAperturePreserved: true,
        lowerAperturePlaneYMeters: -0.275,
        lowerApertureClearRadiusMeters: 0.168,
        adapterCompositionRequired: true,
        adapterCanonicalBodyCount: 1,
        independentBroadphaseOwner: false,
        errorMetric: "sampled bidirectional sector-surface Hausdorff envelope for the eight-capsule proxy set",
      },
    };
  });
  const inputs = [
    {
      id: "base-cylinder",
      entityId: "base-pivot",
      shape: { kind: "cylinder", units: "metre", startMeters: [0, 0, 0], endMeters: [0, 0.08, 0], radiusMeters: 0.255 },
      physicsMaterialId: "cast-metal",
      collisionRole: "solid",
      errorMeters: 0.021,
      intent: {
        comparisonMeshScope: ["base-shell", "base-upper-bezel", "base-rubber-foot"],
        errorMetric: "conservative directed visual-surface-to-proxy authoring bound",
        deskContactPlaneYMeters: 0,
      },
    },
    {
      id: "lower-arm-left-capsule",
      entityId: "shoulder-hinge-pivot",
      shape: { kind: "capsule", units: "metre", startMeters: [0, 0, 0.031], endMeters: [0.13, 0.34, 0.031], radiusMeters: 0.017 },
      physicsMaterialId: "arm-metal",
      collisionRole: "solid",
      errorMeters: 0.017,
      intent: {
        comparisonMeshScope: ["lower-arm-left"],
        capsuleEndpointSemantics: "sphere-centerline-endpoints; hemispherical caps extend radius beyond endpoints",
        errorMetric: "cap-extension-dominated authoring bound",
      },
    },
    {
      id: "lower-arm-right-capsule",
      entityId: "shoulder-hinge-pivot",
      shape: { kind: "capsule", units: "metre", startMeters: [0, 0, -0.031], endMeters: [0.13, 0.34, -0.031], radiusMeters: 0.017 },
      physicsMaterialId: "arm-metal",
      collisionRole: "solid",
      errorMeters: 0.017,
      intent: {
        comparisonMeshScope: ["lower-arm-right"],
        capsuleEndpointSemantics: "sphere-centerline-endpoints; hemispherical caps extend radius beyond endpoints",
        errorMetric: "cap-extension-dominated authoring bound",
      },
    },
    {
      id: "upper-arm-left-capsule",
      entityId: "elbow-hinge-pivot",
      shape: { kind: "capsule", units: "metre", startMeters: [0, 0, 0.031], endMeters: [0.18, 0.3, 0.031], radiusMeters: 0.017 },
      physicsMaterialId: "arm-metal",
      collisionRole: "solid",
      errorMeters: 0.017,
      intent: {
        comparisonMeshScope: ["upper-arm-left"],
        capsuleEndpointSemantics: "sphere-centerline-endpoints; hemispherical caps extend radius beyond endpoints",
        errorMetric: "cap-extension-dominated authoring bound",
      },
    },
    {
      id: "upper-arm-right-capsule",
      entityId: "elbow-hinge-pivot",
      shape: { kind: "capsule", units: "metre", startMeters: [0, 0, -0.031], endMeters: [0.18, 0.3, -0.031], radiusMeters: 0.017 },
      physicsMaterialId: "arm-metal",
      collisionRole: "solid",
      errorMeters: 0.017,
      intent: {
        comparisonMeshScope: ["upper-arm-right"],
        capsuleEndpointSemantics: "sphere-centerline-endpoints; hemispherical caps extend radius beyond endpoints",
        errorMetric: "cap-extension-dominated authoring bound",
      },
    },
    {
      id: "shade-neck-cylinder",
      entityId: "shade-hinge-pivot",
      shape: {
        kind: "cylinder",
        units: "metre",
        startMeters: [0, -0.015, 0],
        endMeters: [0, -0.075, 0],
        radiusMeters: 0.032,
      },
      physicsMaterialId: "cast-metal",
      collisionRole: "solid",
      errorMeters: SHADE_NECK_COLLIDER_ERROR_METERS,
      intent: {
        comparisonMeshScope: ["shade-neck"],
        visualGeometryType: "capped CylinderGeometry generated by cylinderBetween",
        proxyCapPolicy: "both endpoint disks included",
        errorMetric: "sampled bidirectional actual-BufferGeometry-to-analytic-capped-cylinder Hausdorff envelope",
      },
    },
    ...shadeBoundaryInputs,
    {
      id: "bulb-trigger",
      entityId: "shade-hinge-pivot",
      shape: { kind: "sphere", units: "metre", centerMeters: [0, -0.215, 0], radiusMeters: 0.075 },
      physicsMaterialId: "bulb-envelope",
      collisionRole: "trigger",
      errorMeters: 0.023,
      intent: {
        comparisonMeshScope: ["bulb"],
        purpose: "light-emitter-proximity-volume",
        triggerRadiusMeters: 0.075,
        renderedBulbRadialExtentMeters: 0.0533,
        renderedBulbCenterOffsetMeters: 0.003,
        visualSurfaceDeviationMeters: 0.023,
        solidContactAuthority: false,
        errorMetric: "trigger-extent versus stylized rendered envelope; not a solid glass contact proxy",
      },
    },
  ];
  for (const input of inputs) {
    const { intent, ...constructionInput } = input;
    const collider = addColliderConstructionInput(runtime, {
      ...constructionInput,
      sourceRevision: SOURCE_REVISION,
    });
    runtime.colliderIntents.set(input.id, deepFreezeRecord({
      recordType: "ColliderAuthoringIntent",
      colliderId: collider.colliderId,
      targetSemanticColliderId: collider.targetSemanticColliderId,
      collisionRole: collider.collisionRole,
      solverAuthority: false,
      ...intent,
      sourceRevision: SOURCE_REVISION,
    }));
  }
}

export function createArticulatedDeskLamp({
  tier = "full",
  seed = 1,
  instanceId,
  continuityToken,
} = {}) {
  if (!SCULPT_TIERS.includes(tier)) throw new RangeError(`Unknown sculpt tier "${tier}"`);
  if (!Number.isInteger(seed) || seed < SEED_DOMAIN.min || seed > SEED_DOMAIN.max) {
    throw new RangeError(`seed must be a uint32 in [${SEED_DOMAIN.min}, ${SEED_DOMAIN.max}]`);
  }
  if (continuityToken !== undefined && (typeof instanceId !== "string" || instanceId.length === 0)) {
    throw new Error("continuityToken requires an explicit nonempty instanceId");
  }
  if (continuityToken !== undefined && (typeof continuityToken !== "string" || continuityToken.length === 0)) {
    throw new TypeError("continuityToken must be a nonempty string");
  }
  const limits = TIER_LIMITS[tier];
  const materials = makeMaterials(seed);
  const effectiveToken = buildArticulatedDeskLampContinuitySignature({
    baseContinuityToken: continuityToken,
    seed,
  });
  const { root, runtime } = createSculptRuntime({
    subjectId: TARGET_ID,
    instanceId,
    continuityToken: effectiveToken,
    tier,
    seed,
    physicsMaterials: PHYSICS_MATERIALS,
    lengthUnit: "metre",
  });

  runtime.constraints = new Map();
  runtime.motionPreviewBindings = new Map();
  runtime.attachments = new Map();
  runtime.colliderIntents = new Map();
  runtime.baseContinuityToken = continuityToken ?? null;
  runtime.effectiveContinuitySignature = effectiveToken ?? null;
  runtime.continuityIdentityInputs = Object.freeze({
    targetId: TARGET_ID,
    sourceRevision: SOURCE_REVISION,
    seed,
  });
  runtime.continuityVisualContext = Object.freeze({ tier, identityAffecting: false });

  root.userData.targetId = TARGET_ID;
  root.userData.targetTitle = TARGET_TITLE;
  root.userData.targetContract = TARGET_CONTRACT;
  root.userData.sourceRevision = SOURCE_REVISION;
  root.userData.continuityIdentity = Object.freeze({
    schema: TARGET_CONTRACT.continuity.signatureSchema,
    baseContinuityToken: continuityToken ?? null,
    effectiveSignature: effectiveToken ?? null,
    identityInputs: Object.freeze({ targetId: TARGET_ID, sourceRevision: SOURCE_REVISION, seed }),
    excludedVisualInputs: TARGET_CONTRACT.continuity.excludedVisualInputs,
  });
  root.userData.contactPlane = Object.freeze({
    axis: "+Y",
    yMeters: 0,
    toleranceMeters: 0.000001,
    socketId: "desk-contact-socket",
    colliderId: "base-cylinder",
  });

  const variation = Object.freeze({
    enamelHueOffset: (deterministicUnit(seed, 0x13a7) - 0.5) * 0.016,
    elbowRestAngleRadians: (deterministicUnit(seed, 0x44e1) - 0.5) * 0.036,
    shadeRestAngleRadians: (deterministicUnit(seed, 0x8c31) - 0.5) * 0.05,
  });
  root.userData.seedVariation = variation;

  const base = addPivot(runtime, "base-pivot", root, { destructionGroup: "weighted-base" });
  base.userData.animationRole = "static";
  addPart(runtime, {
    id: "base-shell",
    geometry: new THREE.CylinderGeometry(0.255, 0.27, 0.058, limits.radial, 2),
    material: materials.enamel,
    parent: base,
    semanticGroup: "base",
    destructionGroup: "weighted-base",
    position: [0, 0.029, 0],
  });
  addPart(runtime, {
    id: "base-upper-bezel",
    geometry: new THREE.CylinderGeometry(0.218, 0.238, 0.026, limits.radial, 1),
    material: materials.enamelEdge,
    parent: base,
    semanticGroup: "base",
    destructionGroup: "weighted-base",
    position: [0, 0.067, 0],
  });
  addPart(runtime, {
    id: "base-rubber-foot",
    geometry: new THREE.TorusGeometry(0.22, 0.012, limits.footRadialSegments, limits.radial),
    material: materials.rubber,
    parent: base,
    semanticGroup: "base",
    destructionGroup: "weighted-base",
    position: [0, 0.012, 0],
    rotation: [Math.PI / 2, 0, 0],
    castShadow: false,
    receiveShadow: false,
  });
  const powerDial = addPart(runtime, {
    id: "base-power-dial",
    geometry: new THREE.CylinderGeometry(0.043, 0.043, 0.024, limits.hingeRadial, 1),
    material: materials.brass,
    parent: base,
    semanticGroup: "detail",
    destructionGroup: "weighted-base",
    position: [0.13, 0.075, 0.145],
    rotation: [Math.PI / 2, 0, 0],
    detailRole: "meso",
  });
  powerDial.userData.interaction = Object.freeze({ channel: "rotate", axisLocal: [0, 0, 1], units: "radian" });
  addPart(runtime, {
    id: "base-power-indicator",
    geometry: new THREE.SphereGeometry(0.012, limits.hingeRadial, Math.max(6, Math.floor(limits.hingeRadial / 2))),
    material: materials.indicator,
    parent: base,
    semanticGroup: "detail",
    destructionGroup: "weighted-base",
    position: [0.075, 0.083, 0.185],
    detailRole: "micro",
    castShadow: false,
    receiveShadow: false,
  });

  const deskContactSocket = addSocket(runtime, "desk-contact-socket", base, [0, 0, 0]);
  deskContactSocket.userData.contactPlane = root.userData.contactPlane;
  addSocket(runtime, "power-input-socket", base, [-0.225, 0.035, -0.08]);

  const yaw = addPivot(runtime, "base-yaw-pivot", base, { destructionGroup: "lower-arm-assembly" });
  yaw.position.set(-0.095, 0.078, -0.01);
  addHingeConstraint(runtime, yaw, {
    id: "base-yaw-hinge-constraint",
    parentEntityId: "base-pivot",
    childEntityId: "base-yaw-pivot",
    parentAnchorPositionMeters: [-0.095, 0.078, -0.01],
    axis: [0, 1, 0],
    minRadians: -1.35,
    maxRadians: 1.35,
    restRadians: 0,
    amplitudeRadians: 0.2,
    angularFrequencyRadPerS: 0.47,
  });
  cylinderBetween(runtime, {
    id: "base-yaw-post",
    start: [0, 0, 0],
    end: [0, 0.085, 0],
    radius: 0.038,
    material: materials.darkMetal,
    radialSegments: limits.hingeRadial,
    parent: yaw,
    semanticGroup: "articulation",
    destructionGroup: "lower-arm-assembly",
  });

  const shoulder = addPivot(runtime, "shoulder-hinge-pivot", yaw, { destructionGroup: "lower-arm-assembly" });
  shoulder.position.set(0, 0.085, 0);
  addHingeConstraint(runtime, shoulder, {
    id: "shoulder-hinge-constraint",
    parentEntityId: "base-yaw-pivot",
    childEntityId: "shoulder-hinge-pivot",
    parentAnchorPositionMeters: [0, 0.085, 0],
    axis: [0, 0, 1],
    minRadians: -0.35,
    maxRadians: 1.25,
    restRadians: 0,
    amplitudeRadians: 0.14,
    angularFrequencyRadPerS: 0.71,
  });
  addJointHardware(runtime, shoulder, "shoulder-hinge", materials, limits, "lower-arm-assembly");
  addSocket(runtime, "shoulder-joint-socket", shoulder, [0, 0, 0]);

  const lowerEnd = [0.13, 0.34, 0];
  for (const side of [-1, 1]) {
    const suffix = side > 0 ? "left" : "right";
    cylinderBetween(runtime, {
      id: `lower-arm-${suffix}`,
      start: [0, 0, side * 0.031],
      end: [lowerEnd[0], lowerEnd[1], side * 0.031],
      radius: 0.014,
      material: materials.enamel,
      radialSegments: limits.hingeRadial,
      parent: shoulder,
      semanticGroup: "arm",
      destructionGroup: "lower-arm-assembly",
    });
  }
  const lowerCableStart = [-0.012, 0.015, -0.056];
  const lowerCableEnd = [0.125, 0.33, -0.056];
  addSocket(runtime, "lower-cable-start-socket", shoulder, lowerCableStart);
  addSocket(runtime, "lower-cable-end-socket", shoulder, lowerCableEnd);
  const lowerCable = cylinderBetween(runtime, {
    id: "lower-arm-cable",
    start: lowerCableStart,
    end: lowerCableEnd,
    radius: 0.006,
    material: materials.rubber,
    radialSegments: limits.tubeRadial,
    parent: shoulder,
    semanticGroup: "cable",
    destructionGroup: "lower-arm-assembly",
  });
  addAttachmentContract(runtime, lowerCable, {
    id: "lower-arm-cable-attachment",
    startSocketId: "lower-cable-start-socket",
    endSocketId: "lower-cable-end-socket",
    localStart: lowerCableStart,
    localEnd: lowerCableEnd,
    radiusMeters: 0.006,
    overlapMeters: 0.004,
    gapToleranceMeters: 0.001,
  });

  const lowerSpringStart = [0.02, 0.035, SPRING_ENDPOINT_Z_METERS];
  const lowerSpringEnd = [0.122, 0.319, SPRING_ENDPOINT_Z_METERS];
  addSocket(runtime, "lower-spring-start-socket", shoulder, lowerSpringStart);
  addSocket(runtime, "lower-spring-end-socket", shoulder, lowerSpringEnd);
  const lowerSpring = addPart(runtime, {
    id: "lower-arm-tension-spring",
    geometry: buildHelixGeometry(
      lowerSpringStart,
      lowerSpringEnd,
      0.013,
      limits.springTurns,
      limits.springSegments,
      limits.springRadial,
    ),
    material: materials.brushedMetal,
    parent: shoulder,
    semanticGroup: "spring",
    destructionGroup: "lower-arm-assembly",
    detailRole: "meso",
  });
  lowerSpring.userData.sourceDimensions = Object.freeze({
    startMeters: Object.freeze([...lowerSpringStart]),
    endMeters: Object.freeze([...lowerSpringEnd]),
    radiusMeters: lowerSpring.geometry.parameters.radius,
    lengthUnit: "metre",
    radiusEvidence: "exact TubeGeometry.parameters.radius",
  });
  lowerSpring.userData.springRepresentation = Object.freeze({
    role: "decorative-parent-local",
    dynamicEndpointRebuild: false,
    crossJointMechanics: false,
    receivingWasherCentersMeters: Object.freeze([
      Object.freeze([0, 0, HINGE_WASHER_CENTER_Z_METERS]),
      Object.freeze([lowerEnd[0], lowerEnd[1], HINGE_WASHER_CENTER_Z_METERS]),
    ]),
    receivingWasherMeshIds: Object.freeze([
      "shoulder-hinge-washer-front",
      "elbow-hinge-washer-front",
    ]),
    endpointBoundaryPolicy: "open TubeGeometry endpoint ring embedded in collar/front-washer volume",
    washerRadiusMeters: HINGE_WASHER_RADIUS_METERS,
    washerFrontFaceZMeters: HINGE_WASHER_CENTER_Z_METERS + HINGE_WASHER_HALF_DEPTH_METERS,
    endpointCenterEmbedDepthMeters:
      HINGE_WASHER_CENTER_Z_METERS + HINGE_WASHER_HALF_DEPTH_METERS - SPRING_ENDPOINT_Z_METERS,
  });
  addSpringCollar(
    runtime,
    shoulder,
    "lower-spring-start-collar",
    lowerSpringStart,
    materials.brushedMetal,
    limits,
    "lower-arm-assembly",
  );
  addSpringCollar(
    runtime,
    shoulder,
    "lower-spring-end-collar",
    lowerSpringEnd,
    materials.brushedMetal,
    limits,
    "lower-arm-assembly",
  );
  addAttachmentContract(runtime, lowerSpring, {
    id: "lower-arm-tension-spring-attachment",
    startSocketId: "lower-spring-start-socket",
    endSocketId: "lower-spring-end-socket",
    localStart: lowerSpringStart,
    localEnd: lowerSpringEnd,
    radiusMeters: lowerSpring.geometry.parameters.radius,
    overlapMeters: 0.002,
    gapToleranceMeters: 0.001,
    receivingWasherMeshIds: ["shoulder-hinge-washer-front", "elbow-hinge-washer-front"],
  });

  const elbow = addPivot(runtime, "elbow-hinge-pivot", shoulder, { destructionGroup: "upper-arm-assembly" });
  elbow.position.fromArray(lowerEnd);
  addHingeConstraint(runtime, elbow, {
    id: "elbow-hinge-constraint",
    parentEntityId: "shoulder-hinge-pivot",
    childEntityId: "elbow-hinge-pivot",
    parentAnchorPositionMeters: lowerEnd,
    axis: [0, 0, 1],
    minRadians: -1.45,
    maxRadians: 0.65,
    restRadians: variation.elbowRestAngleRadians,
    amplitudeRadians: 0.22,
    angularFrequencyRadPerS: 0.89,
  });
  addJointHardware(runtime, elbow, "elbow-hinge", materials, limits, "upper-arm-assembly");
  addSocket(runtime, "elbow-joint-socket", elbow, [0, 0, 0]);

  const upperEnd = [0.18, 0.3, 0];
  for (const side of [-1, 1]) {
    const suffix = side > 0 ? "left" : "right";
    cylinderBetween(runtime, {
      id: `upper-arm-${suffix}`,
      start: [0, 0, side * 0.031],
      end: [upperEnd[0], upperEnd[1], side * 0.031],
      radius: 0.014,
      material: materials.enamel,
      radialSegments: limits.hingeRadial,
      parent: elbow,
      semanticGroup: "arm",
      destructionGroup: "upper-arm-assembly",
    });
  }
  const upperCableStart = [0.004, 0.01, -0.056];
  const upperCableEnd = [0.174, 0.292, -0.056];
  addSocket(runtime, "upper-cable-start-socket", elbow, upperCableStart);
  addSocket(runtime, "upper-cable-end-socket", elbow, upperCableEnd);
  const upperCable = cylinderBetween(runtime, {
    id: "upper-arm-cable",
    start: upperCableStart,
    end: upperCableEnd,
    radius: 0.006,
    material: materials.rubber,
    radialSegments: limits.tubeRadial,
    parent: elbow,
    semanticGroup: "cable",
    destructionGroup: "upper-arm-assembly",
  });
  addAttachmentContract(runtime, upperCable, {
    id: "upper-arm-cable-attachment",
    startSocketId: "upper-cable-start-socket",
    endSocketId: "upper-cable-end-socket",
    localStart: upperCableStart,
    localEnd: upperCableEnd,
    radiusMeters: 0.006,
    overlapMeters: 0.004,
    gapToleranceMeters: 0.001,
  });

  const upperSpringStart = [0.018, 0.035, SPRING_ENDPOINT_Z_METERS];
  const upperSpringEnd = [0.17, 0.282, SPRING_ENDPOINT_Z_METERS];
  addSocket(runtime, "upper-spring-start-socket", elbow, upperSpringStart);
  addSocket(runtime, "upper-spring-end-socket", elbow, upperSpringEnd);
  const upperSpring = addPart(runtime, {
    id: "upper-arm-tension-spring",
    geometry: buildHelixGeometry(
      upperSpringStart,
      upperSpringEnd,
      0.012,
      Math.max(3, limits.springTurns - 1),
      limits.springSegments,
      limits.springRadial,
    ),
    material: materials.brushedMetal,
    parent: elbow,
    semanticGroup: "spring",
    destructionGroup: "upper-arm-assembly",
    detailRole: "meso",
  });
  upperSpring.userData.sourceDimensions = Object.freeze({
    startMeters: Object.freeze([...upperSpringStart]),
    endMeters: Object.freeze([...upperSpringEnd]),
    radiusMeters: upperSpring.geometry.parameters.radius,
    lengthUnit: "metre",
    radiusEvidence: "exact TubeGeometry.parameters.radius",
  });
  upperSpring.userData.springRepresentation = Object.freeze({
    role: "decorative-parent-local",
    dynamicEndpointRebuild: false,
    crossJointMechanics: false,
    receivingWasherCentersMeters: Object.freeze([
      Object.freeze([0, 0, HINGE_WASHER_CENTER_Z_METERS]),
      Object.freeze([upperEnd[0], upperEnd[1], HINGE_WASHER_CENTER_Z_METERS]),
    ]),
    receivingWasherMeshIds: Object.freeze([
      "elbow-hinge-washer-front",
      "shade-hinge-washer-front",
    ]),
    endpointBoundaryPolicy: "open TubeGeometry endpoint ring embedded in collar/front-washer volume",
    washerRadiusMeters: HINGE_WASHER_RADIUS_METERS,
    washerFrontFaceZMeters: HINGE_WASHER_CENTER_Z_METERS + HINGE_WASHER_HALF_DEPTH_METERS,
    endpointCenterEmbedDepthMeters:
      HINGE_WASHER_CENTER_Z_METERS + HINGE_WASHER_HALF_DEPTH_METERS - SPRING_ENDPOINT_Z_METERS,
  });
  addSpringCollar(
    runtime,
    elbow,
    "upper-spring-start-collar",
    upperSpringStart,
    materials.brushedMetal,
    limits,
    "upper-arm-assembly",
  );
  addSpringCollar(
    runtime,
    elbow,
    "upper-spring-end-collar",
    upperSpringEnd,
    materials.brushedMetal,
    limits,
    "upper-arm-assembly",
  );
  addAttachmentContract(runtime, upperSpring, {
    id: "upper-arm-tension-spring-attachment",
    startSocketId: "upper-spring-start-socket",
    endSocketId: "upper-spring-end-socket",
    localStart: upperSpringStart,
    localEnd: upperSpringEnd,
    radiusMeters: upperSpring.geometry.parameters.radius,
    overlapMeters: 0.002,
    gapToleranceMeters: 0.001,
    receivingWasherMeshIds: ["elbow-hinge-washer-front", "shade-hinge-washer-front"],
  });

  const shade = addPivot(runtime, "shade-hinge-pivot", elbow, { destructionGroup: "lamp-head" });
  shade.position.fromArray(upperEnd);
  addHingeConstraint(runtime, shade, {
    id: "shade-hinge-constraint",
    parentEntityId: "elbow-hinge-pivot",
    childEntityId: "shade-hinge-pivot",
    parentAnchorPositionMeters: upperEnd,
    axis: [0, 0, 1],
    minRadians: -1.1,
    maxRadians: 0.75,
    restRadians: -0.16 + variation.shadeRestAngleRadians,
    amplitudeRadians: 0.18,
    angularFrequencyRadPerS: 1.13,
  });
  addJointHardware(runtime, shade, "shade-hinge", materials, limits, "lamp-head");
  addSocket(runtime, "shade-joint-socket", shade, [0, 0, 0]);

  cylinderBetween(runtime, {
    id: "shade-neck",
    start: [0, -0.015, 0],
    end: [0, -0.075, 0],
    radius: 0.032,
    material: materials.darkMetal,
    radialSegments: limits.hingeRadial,
    parent: shade,
    semanticGroup: "head",
    destructionGroup: "lamp-head",
  });
  const shadeCableStart = [0.03, 0, -0.047];
  const shadeCableEnd = [0.018, -0.195, -0.035];
  addSocket(runtime, "shade-cable-start-socket", shade, shadeCableStart);
  addSocket(runtime, "shade-cable-end-socket", shade, shadeCableEnd);
  const shadeCable = cylinderBetween(runtime, {
    id: "shade-cable",
    start: shadeCableStart,
    end: shadeCableEnd,
    radius: 0.006,
    material: materials.rubber,
    radialSegments: limits.tubeRadial,
    parent: shade,
    semanticGroup: "cable",
    destructionGroup: "lamp-head",
  });
  addAttachmentContract(runtime, shadeCable, {
    id: "shade-cable-attachment",
    startSocketId: "shade-cable-start-socket",
    endSocketId: "shade-cable-end-socket",
    localStart: shadeCableStart,
    localEnd: shadeCableEnd,
    radiusMeters: 0.006,
    overlapMeters: 0.004,
    gapToleranceMeters: 0.001,
  });

  const shadeCrown = addPart(runtime, {
    id: "shade-crown-annulus",
    geometry: new THREE.RingGeometry(0.03, 0.075, limits.radial, 1),
    material: materials.enamel,
    parent: shade,
    semanticGroup: "head",
    destructionGroup: "lamp-head",
    position: [0, -0.055, 0],
    rotation: [-Math.PI / 2, 0, 0],
  });
  shadeCrown.userData.topologyContract = Object.freeze({
    role: "exterior FrontSide crown closure while retaining a neck pass-through",
    innerRadiusMeters: 0.03,
    outerRadiusMeters: 0.075,
    neckOverlapMeters: 0.002,
    shellOverlapMeters: 0.002,
    exteriorMaterialSide: "FrontSide",
    interiorClosureMeshId: "shade-crown-inner-annulus",
    lowerApertureUnaffected: true,
  });
  const shadeCrownInner = addPart(runtime, {
    id: "shade-crown-inner-annulus",
    geometry: new THREE.RingGeometry(0.03, 0.075, limits.radial, 1),
    material: materials.reflector,
    parent: shade,
    semanticGroup: "head",
    destructionGroup: "lamp-head",
    position: [0, -0.055, 0],
    rotation: [-Math.PI / 2, 0, 0],
    receiveShadow: false,
  });
  shadeCrownInner.userData.topologyContract = Object.freeze({
    role: "reflector-colored BackSide crown closure visible upward through the open lower aperture",
    pairedExteriorMeshId: "shade-crown-annulus",
    innerRadiusMeters: 0.03,
    outerRadiusMeters: 0.075,
    materialSide: "BackSide",
    lowerApertureUnaffected: true,
  });
  addPart(runtime, {
    id: "shade-crown-roll",
    geometry: new THREE.TorusGeometry(0.073, 0.006, limits.tubeRadial, limits.radial),
    material: materials.enamelEdge,
    parent: shade,
    semanticGroup: "head",
    destructionGroup: "lamp-head",
    position: [0, -0.055, 0],
    rotation: [-Math.PI / 2, 0, 0],
    detailRole: "meso",
  });
  const shadeShell = addPart(runtime, {
    id: "shade-shell",
    geometry: new THREE.CylinderGeometry(0.073, 0.18, 0.22, limits.radial, 2, true),
    material: materials.enamel,
    parent: shade,
    semanticGroup: "head",
    destructionGroup: "lamp-head",
    position: [0, -0.165, 0],
  });
  shadeShell.userData.apertureContract = Object.freeze({
    crownPlaneYMeters: -0.055,
    crownClosedBy: Object.freeze(["shade-crown-annulus", "shade-crown-inner-annulus"]),
    crownInteriorVisibleThroughLowerAperture: true,
    lowerPlaneYMeters: -0.275,
    lowerRadiusMeters: 0.18,
    lowerApertureOpen: true,
  });
  addPart(runtime, {
    id: "reflector-shell",
    geometry: new THREE.CylinderGeometry(0.068, 0.17, 0.208, limits.radial, 2, true),
    material: materials.reflector,
    parent: shade,
    semanticGroup: "head",
    destructionGroup: "lamp-head",
    position: [0, -0.169, 0],
    receiveShadow: false,
  });
  addPart(runtime, {
    id: "shade-rim",
    geometry: new THREE.TorusGeometry(0.176, 0.008, limits.tubeRadial, limits.radial),
    material: materials.brushedMetal,
    parent: shade,
    semanticGroup: "head",
    destructionGroup: "lamp-head",
    position: [0, -0.275, 0],
    rotation: [Math.PI / 2, 0, 0],
    detailRole: "meso",
  });
  addPart(runtime, {
    id: "bulb-socket",
    geometry: new THREE.CylinderGeometry(0.046, 0.052, 0.07, limits.hingeRadial, 1),
    material: materials.brass,
    parent: shade,
    semanticGroup: "head",
    destructionGroup: "lamp-head",
    position: [0, -0.135, 0],
    detailRole: "meso",
  });
  addPart(runtime, {
    id: "bulb",
    geometry: new THREE.SphereGeometry(0.065, limits.radial, Math.max(8, Math.floor(limits.radial * 0.55))),
    material: materials.bulb,
    parent: shade,
    semanticGroup: "head",
    destructionGroup: "lamp-head",
    position: [0, -0.218, 0],
    scale: [0.82, 1.16, 0.82],
    detailRole: "meso",
    receiveShadow: false,
    castShadow: false,
  });

  for (let index = 0; index < limits.shadeFasteners; index += 1) {
    const angle = (index / limits.shadeFasteners) * Math.PI * 2;
    addPart(runtime, {
      id: `shade-fastener-${String(index).padStart(2, "0")}`,
      geometry: new THREE.SphereGeometry(0.008, 6, 4),
      material: materials.brass,
      parent: shade,
      semanticGroup: "detail",
      destructionGroup: "lamp-head",
      position: [Math.cos(angle) * 0.092, -0.082, Math.sin(angle) * 0.092],
      detailRole: "micro",
      castShadow: false,
      receiveShadow: false,
    });
  }

  addSocket(runtime, "light-emitter-socket", shade, [0, -0.245, 0]);
  addSocket(runtime, "shade-accessory-socket", shade, [0, -0.278, 0]);
  addColliderInputs(runtime);

  const powerCableStart = [-0.225, 0.035, -0.08];
  const powerCableEnd = [-0.43, 0.018, -0.15];
  addSocket(runtime, "power-cable-start-socket", base, powerCableStart);
  addSocket(runtime, "power-cable-end-socket", base, powerCableEnd);
  const powerCable = cylinderBetween(runtime, {
    id: "power-cable-tail",
    start: powerCableStart,
    end: powerCableEnd,
    radius: 0.007,
    material: materials.rubber,
    radialSegments: limits.tubeRadial,
    parent: base,
    semanticGroup: "cable",
    destructionGroup: "weighted-base",
  });
  powerCable.userData.flexibleAuthoringInput = true;
  addAttachmentContract(runtime, powerCable, {
    id: "power-cable-tail-attachment",
    startSocketId: "power-cable-start-socket",
    endSocketId: "power-cable-end-socket",
    localStart: powerCableStart,
    localEnd: powerCableEnd,
    radiusMeters: 0.007,
    overlapMeters: 0.004,
    gapToleranceMeters: 0.001,
  });

  const shadowCasterIds = new Set([
    "base-shell",
    "base-upper-bezel",
    "base-yaw-post",
    "shoulder-hinge-barrel",
    "elbow-hinge-barrel",
    "shade-hinge-barrel",
    "lower-arm-left",
    "lower-arm-right",
    "upper-arm-left",
    "upper-arm-right",
    "shade-neck",
    "shade-shell",
    "shade-rim",
  ]);
  for (const [id, mesh] of runtime.meshes) {
    const participates = shadowCasterIds.has(id);
    mesh.castShadow = participates;
    mesh.receiveShadow = participates;
    mesh.userData.shadowPolicy = participates
      ? "silhouette-caster-and-receiver"
      : "excluded-from-lamp-shadow-set";
  }
  root.userData.shadowPolicy = Object.freeze({
    casterIds: Object.freeze([...shadowCasterIds]),
    casterCount: shadowCasterIds.size,
    policy: "authored silhouette caster set; micro hardware, cable, spring, reflector, and emissive bulb excluded",
    timingClaim: "none",
  });

  const rest = Object.freeze({
    yaw: 0,
    shoulder: 0,
    elbow: variation.elbowRestAngleRadians,
    shade: -0.16 + variation.shadeRestAngleRadians,
  });
  root.userData.restPoseRadians = rest;

  function resetPose() {
    yaw.rotation.y = rest.yaw;
    shoulder.rotation.z = rest.shoulder;
    elbow.rotation.z = rest.elbow;
    shade.rotation.z = rest.shade;
    root.updateMatrixWorld(true);
    root.userData.motionTimeSeconds = 0;
    root.userData.motionAuthority = "authored-diagnostic-only";
    root.userData.motionPoseRadians = rest;
    return rest;
  }

  function setMode(mode) {
    if (!SCULPT_MODES.includes(mode)) throw new RangeError(`Unknown sculpt mode "${mode}"`);
    const previousMode = runtime.mode;
    applyDiagnosticMaterials(runtime, mode, materials.diagnostics);
    for (const value of runtime.meshes.values()) {
      const blockoutHiddenGroup = ["cable", "spring", "detail"].includes(value.userData.semanticGroup);
      const blockoutHiddenDetail = (value.userData.detailRole ?? "structural") !== "structural";
      value.visible = mode !== "blockout" || (!blockoutHiddenGroup && !blockoutHiddenDetail);
    }
    root.userData.activeMode = mode;
    if (mode !== "action-ready" || previousMode !== "action-ready") resetPose();
  }

  function setTime(seconds, animate = runtime.mode === "action-ready") {
    if (!Number.isFinite(seconds)) throw new TypeError("seconds must be finite");
    if (!animate || seconds === 0) return resetPose();
    const binding = (id) => runtime.motionPreviewBindings.get(id);
    const evaluate = (id) => {
      const record = binding(id);
      const raw = record.restRadians
        + record.amplitudeRadians * Math.sin(record.angularFrequencyRadPerS * seconds);
      return THREE.MathUtils.clamp(raw, record.limitRadians[0], record.limitRadians[1]);
    };
    const pose = Object.freeze({
      yaw: evaluate("base-yaw-hinge-constraint"),
      shoulder: evaluate("shoulder-hinge-constraint"),
      elbow: evaluate("elbow-hinge-constraint"),
      shade: evaluate("shade-hinge-constraint"),
    });
    yaw.rotation.y = pose.yaw;
    shoulder.rotation.z = pose.shoulder;
    elbow.rotation.z = pose.elbow;
    shade.rotation.z = pose.shade;
    root.updateMatrixWorld(true);
    root.userData.motionTimeSeconds = seconds;
    root.userData.motionAuthority = "authored-diagnostic-only";
    root.userData.motionPoseRadians = pose;
    return pose;
  }

  function dispose() {
    return disposeSculptObject(root, materials);
  }

  setMode("final");
  resetPose();
  root.updateMatrixWorld(true);

  return {
    root,
    runtime,
    contract: TARGET_CONTRACT,
    setMode,
    setTime,
    resetPose,
    dispose,
  };
}
