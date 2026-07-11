import * as THREE from "three/webgpu";

export const SCULPT_MODES = Object.freeze([
  "final",
  "blockout",
  "hierarchy",
  "materials",
  "action-ready",
]);

export const SCULPT_TIERS = Object.freeze(["full", "budgeted", "minimum"]);

const PHYSICS_MATERIAL_EVIDENCE_GAPS = Object.freeze([
  "density",
  "contact-law",
  "friction-law",
  "restitution-law",
  "compliance-damping-law",
]);

const COLLIDER_ADAPTER_REQUIREMENTS = Object.freeze([
  "PhysicsContext.metersPerWorldUnit and context version",
  "registered physics frame, origin epoch, and transform revision",
  "committed pose signal and pose state version",
  "validity interval, update cadence, collision filter, and residency",
  "selected collision/contact owner or ExternalSolverAdapter",
]);

const COLLISION_ROLES = new Set(["solid", "trigger", "sensor", "query-only", "boundary"]);
const RESOURCE_OWNERSHIP_VALUES = new Set(["owned", "external"]);

// Module-local registries make identity and disposal rules process-wide without
// exposing mutable global state to target factories.
const LIVE_RUNTIME_INSTANCES = new Map();
const NEXT_AUTOMATIC_INSTANCE = new Map();
const INSTANCE_CONTINUITY_HISTORY = new Map();
const OBJECT_RUNTIME_OWNERS = new WeakMap();
const RESOURCE_REGISTRATIONS = new WeakMap();

function requireText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

function requireRuntime(runtime) {
  if (!runtime || runtime.recordType !== "SculptRuntime" || !runtime.root?.isObject3D) {
    throw new TypeError("runtime must be created by createSculptRuntime()");
  }
  if (runtime.disposed) throw new Error(`Sculpt runtime "${runtime.subjectId}" has been disposed`);
  return runtime;
}

function requireFiniteVector(value, length, label) {
  if (!Array.isArray(value) || value.length !== length || value.some((entry) => !Number.isFinite(entry))) {
    throw new TypeError(`${label} must contain ${length} finite numbers`);
  }
  return [...value];
}

function requirePositiveVector(value, length, label) {
  const result = requireFiniteVector(value, length, label);
  if (result.some((entry) => entry <= 0)) throw new RangeError(`${label} must contain positive values`);
  return result;
}

function requirePositiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be finite and positive`);
  return value;
}

function requireLengthUnit(value, label) {
  if (value !== "metre") throw new RangeError(`${label} must be metre`);
  return value;
}

function requireResourceOwnership(value, label) {
  if (!RESOURCE_OWNERSHIP_VALUES.has(value)) {
    throw new RangeError(`${label} must be "owned" or "external"`);
  }
  return value;
}

function stableId(namespace, localId, generation = 1) {
  if (!Number.isInteger(generation) || generation < 1) {
    throw new RangeError("stable ID generation must be a positive integer");
  }
  return Object.freeze({ namespace, localId, generation });
}

function instanceNamespace(runtime, domain) {
  return `${runtime.subjectId}.instance/${runtime.instanceId}.${domain}`;
}

function targetNamespace(runtime, domain) {
  return `${runtime.subjectId}.${domain}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value) || value.isObject3D || value.isMaterial || value.isBufferGeometry) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function normalizePhysicsMaterial(subjectId, entry, index) {
  const source = typeof entry === "string" ? { id: entry, visualMaterialId: entry } : entry;
  if (!source || typeof source !== "object") {
    throw new TypeError(`physicsMaterials[${index}] must be a string or record`);
  }
  const id = requireText(source.id ?? source.physicsMaterialId?.localId, `physicsMaterials[${index}].id`);
  const visualMaterialId = requireText(source.visualMaterialId ?? id, `physicsMaterials[${index}].visualMaterialId`);
  return deepFreeze({
    recordType: "PhysicsMaterialBindingInput",
    physicsMaterialId: stableId(`${subjectId}.physics-material`, id),
    visualMaterialId,
    bindingScope: source.bindingScope ?? "semantic-asset-part",
    claimStatus: "insufficient-evidence",
    canonicalRegistryStatus: "blocked",
    solverAuthority: false,
    missingEvidence: [...PHYSICS_MATERIAL_EVIDENCE_GAPS],
    sourceRevision: source.sourceRevision ?? `${subjectId}.authoring-source.unspecified`,
    invalidation: "source evidence or explicit physics-material registry binding revision",
  });
}

function addDestructionMember(runtime, groupId, objectId) {
  if (!groupId) return;
  requireText(groupId, "destructionGroup");
  if (!runtime.destructionGroups.has(groupId)) runtime.destructionGroups.set(groupId, []);
  const members = runtime.destructionGroups.get(groupId);
  if (!members.includes(objectId)) members.push(objectId);
}

function registerObject(runtime, object, { id, kind = "node", destructionGroup = null } = {}) {
  requireRuntime(runtime);
  requireText(id, "object id");
  if (!object?.isObject3D) throw new TypeError(`Object "${id}" must be a THREE.Object3D`);
  if (runtime.nodes.has(id)) throw new Error(`Duplicate sculpt runtime ID "${id}"`);
  if (destructionGroup !== null) requireText(destructionGroup, "destructionGroup");

  const entityId = stableId(instanceNamespace(runtime, "entity"), id, runtime.instanceGeneration);
  const targetSemanticEntityId = stableId(targetNamespace(runtime, "entity"), id);
  object.name = id;
  object.userData.sculptId = id;
  object.userData.sculptEntityId = entityId;
  object.userData.sculptTargetSemanticEntityId = targetSemanticEntityId;
  object.userData.sculptKind = kind;
  object.userData.visualLodIndependentIdentity = true;
  OBJECT_RUNTIME_OWNERS.set(object, runtime);
  runtime.nodes.set(id, object);
  runtime.entityIds.set(id, entityId);
  runtime.targetSemanticEntityIds.set(id, targetSemanticEntityId);
  if (object.isMesh) runtime.meshes.set(id, object);
  if (kind === "socket") runtime.sockets.set(id, object);
  addDestructionMember(runtime, destructionGroup, id);
  return object;
}

function requireParent(runtime, parent, label) {
  if (!parent?.isObject3D) throw new TypeError(`${label} parent must be a THREE.Object3D`);
  validateAncestryToRoot(runtime, parent, `${label} parent`);
  finiteObjectTransform(parent, label);
  return parent;
}

function validateAncestryToRoot(runtime, object, label) {
  if (OBJECT_RUNTIME_OWNERS.get(object) !== runtime) {
    throw new Error(`${label} must belong to the same sculpt runtime`);
  }
  const localId = object.userData?.sculptId;
  if (!localId || runtime.nodes.get(localId) !== object) {
    throw new Error(`${label} must be registered in the sculpt runtime node map`);
  }

  const visited = new Set();
  let current = object;
  while (current !== runtime.root) {
    if (visited.has(current)) throw new Error(`${label} ancestry contains a cycle`);
    visited.add(current);
    current = current.parent;
    if (!current) throw new Error(`${label} ancestry must reach the sculpt runtime root`);
    if (current !== runtime.root && OBJECT_RUNTIME_OWNERS.get(current) !== runtime) {
      throw new Error(`${label} ancestry contains an object outside the sculpt runtime`);
    }
    if (current !== runtime.root) {
      const ancestorId = current.userData?.sculptId;
      if (!ancestorId || runtime.nodes.get(ancestorId) !== current) {
        throw new Error(`${label} ancestry contains an unregistered sculpt object`);
      }
    }
  }
  if (OBJECT_RUNTIME_OWNERS.get(runtime.root) !== runtime || runtime.nodes.get("root") !== runtime.root) {
    throw new Error(`${label} resolves to an invalid sculpt runtime root registration`);
  }
}

function validateRegisteredHierarchy(runtime, operation) {
  requireRuntime(runtime);
  if (runtime.nodes.get("root") !== runtime.root || runtime.root.userData?.sculptId !== "root") {
    throw new Error(`${operation} requires the registered sculpt runtime root`);
  }
  for (const [id, object] of runtime.nodes) {
    if (object.userData?.sculptId !== id) {
      throw new Error(`${operation} found node-map identity mismatch for "${id}"`);
    }
    validateAncestryToRoot(runtime, object, `${operation} node "${id}"`);
  }
  return true;
}

function attach(parent, object) {
  parent.add(object);
  return object;
}

function isNodeMaterial(value) {
  return Boolean(value?.isMaterial && value?.isNodeMaterial);
}

function requireDisposableResource(resource, label) {
  if (!resource || typeof resource !== "object" || typeof resource.dispose !== "function") {
    throw new TypeError(`${label} must expose dispose()`);
  }
  return resource;
}

function inferResourceKind(resource) {
  if (resource.isBufferGeometry) return "geometry";
  if (resource.isMaterial) return "material";
  if (resource.isTexture) return "texture";
  return "resource";
}

function validateResourceRegistration(runtime, resource, {
  ownership = "owned",
  kind = inferResourceKind(resource),
} = {}) {
  requireRuntime(runtime);
  requireDisposableResource(resource, "resource");
  requireText(kind, "resource kind");
  requireResourceOwnership(ownership, "resource ownership");

  const runtimeRecord = runtime.resources.get(resource);
  if (runtimeRecord) {
    if (runtimeRecord.ownership !== ownership || runtimeRecord.kind !== kind) {
      throw new Error(
        `Resource registration conflict in sculpt runtime "${runtime.subjectId}/${runtime.instanceId}": `
        + `${runtimeRecord.ownership}/${runtimeRecord.kind} versus ${ownership}/${kind}`,
      );
    }
  }

  const globalRecord = RESOURCE_REGISTRATIONS.get(resource);
  if (globalRecord?.kind !== undefined && globalRecord.kind !== kind) {
    throw new Error(`Global resource kind conflict: ${globalRecord.kind} versus ${kind}`);
  }
  if (globalRecord?.ownershipMode !== undefined && globalRecord.ownershipMode !== ownership) {
    throw new Error(
      `Global resource ownership-mode conflict: ${globalRecord.ownershipMode} versus ${ownership}`,
    );
  }
  return Object.freeze({ ownership, kind, runtimeRecord, globalRecord });
}

function retainResource(runtime, resource, options = {}) {
  const validation = validateResourceRegistration(runtime, resource, options);
  if (validation.runtimeRecord) return validation.runtimeRecord;

  let globalRecord = validation.globalRecord;
  if (!globalRecord) {
    globalRecord = {
      kind: validation.kind,
      ownershipMode: validation.ownership,
      retainers: new Set(),
    };
    RESOURCE_REGISTRATIONS.set(resource, globalRecord);
  }
  globalRecord.retainers.add(runtime);
  const runtimeRecord = Object.freeze({
    ownership: validation.ownership,
    ownershipMode: validation.ownership,
    kind: validation.kind,
  });
  runtime.resources.set(resource, runtimeRecord);
  return runtimeRecord;
}

function retainMaterialValue(runtime, material, ownership) {
  if (Array.isArray(material)) {
    for (const entry of material) retainResource(runtime, entry, { ownership, kind: "material" });
    return;
  }
  retainResource(runtime, material, { ownership, kind: "material" });
}

function finiteObjectTransform(object, label) {
  const values = [
    ...object.position.toArray(),
    object.quaternion.x,
    object.quaternion.y,
    object.quaternion.z,
    object.quaternion.w,
    ...object.scale.toArray(),
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError(`${label} transform must contain only finite values`);
  }
}

function computeAndValidateStaticBounds(geometry, label) {
  const position = geometry.getAttribute("position");
  if (!position || position.itemSize < 3 || position.count === 0) {
    throw new RangeError(`${label} geometry must have a nonempty position attribute`);
  }
  for (let index = 0; index < position.count; index += 1) {
    if (![position.getX(index), position.getY(index), position.getZ(index)].every(Number.isFinite)) {
      throw new RangeError(`${label} geometry positions must contain only finite values`);
    }
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const boxValues = [
    ...geometry.boundingBox.min.toArray(),
    ...geometry.boundingBox.max.toArray(),
  ];
  const sphereValues = [
    ...geometry.boundingSphere.center.toArray(),
    geometry.boundingSphere.radius,
  ];
  if (![...boxValues, ...sphereValues].every(Number.isFinite)) {
    throw new RangeError(`${label} geometry bounds must contain only finite values`);
  }

  return Object.freeze({
    boxMinMeters: Object.freeze(geometry.boundingBox.min.toArray()),
    boxMaxMeters: Object.freeze(geometry.boundingBox.max.toArray()),
    sphereCenterMeters: Object.freeze(geometry.boundingSphere.center.toArray()),
    sphereRadiusMeters: geometry.boundingSphere.radius,
    lengthUnit: "metre",
  });
}

function resolveDiagnosticMaterial(diagnosticMaterials, mode, semanticGroup) {
  const configured = diagnosticMaterials?.[mode]
    ?? (mode === "action-ready" ? diagnosticMaterials?.interaction : undefined);
  if (isNodeMaterial(configured)) return configured;
  if (configured && typeof configured === "object") {
    const selected = configured[semanticGroup] ?? configured.default;
    if (isNodeMaterial(selected)) return selected;
  }
  if (mode === "hierarchy") {
    const title = semanticGroup.replace(/(^|-)([a-z])/g, (_, prefix, letter) => letter.toUpperCase());
    const selected = diagnosticMaterials?.[`hierarchy${title}`]
      ?? diagnosticMaterials?.[semanticGroup]
      ?? diagnosticMaterials?.hierarchyDefault;
    if (isNodeMaterial(selected)) return selected;
  }
  return null;
}

function canonicalShape(shape) {
  if (!shape || typeof shape !== "object") throw new TypeError("collider shape is required");
  requireLengthUnit(shape.units, "collider shape units");
  const kind = requireText(shape.kind, "collider shape.kind");

  if (kind === "box") {
    return deepFreeze({
      kind,
      units: "metre",
      centerMeters: requireFiniteVector(shape.centerMeters, 3, "box.centerMeters"),
      sizeMeters: requirePositiveVector(shape.sizeMeters, 3, "box.sizeMeters"),
    });
  }

  if (kind === "sphere") {
    return deepFreeze({
      kind,
      units: "metre",
      centerMeters: requireFiniteVector(shape.centerMeters, 3, "sphere.centerMeters"),
      radiusMeters: requirePositiveNumber(shape.radiusMeters, "sphere.radiusMeters"),
    });
  }

  if (kind === "capsule" || kind === "cylinder") {
    const startMeters = requireFiniteVector(shape.startMeters, 3, `${kind}.startMeters`);
    const endMeters = requireFiniteVector(shape.endMeters, 3, `${kind}.endMeters`);
    const spanSquared = startMeters.reduce((sum, value, axis) => sum + (endMeters[axis] - value) ** 2, 0);
    if (spanSquared === 0) throw new RangeError(`${kind} endpoints must be distinct`);
    return deepFreeze({
      kind,
      units: "metre",
      startMeters,
      endMeters,
      radiusMeters: requirePositiveNumber(shape.radiusMeters, `${kind}.radiusMeters`),
    });
  }

  if (kind === "compound-boxes") {
    if (!Array.isArray(shape.boxes) || shape.boxes.length === 0) {
      throw new RangeError("compound-boxes.boxes must be nonempty");
    }
    return deepFreeze({
      kind,
      units: "metre",
      boxes: shape.boxes.map((box, index) => ({
        centerMeters: requireFiniteVector(box.centerMeters, 3, `compound-boxes.boxes[${index}].centerMeters`),
        sizeMeters: requirePositiveVector(box.sizeMeters, 3, `compound-boxes.boxes[${index}].sizeMeters`),
      })),
    });
  }

  throw new RangeError(`Unsupported collider shape kind "${kind}"`);
}

function resolvePhysicsMaterialId(runtime, physicsMaterialId) {
  const localId = typeof physicsMaterialId === "string" ? physicsMaterialId : physicsMaterialId?.localId;
  requireText(localId, "physicsMaterialId");
  const binding = runtime.physicsMaterials.get(localId);
  if (!binding) throw new Error(`Unknown physics material "${localId}"`);
  return binding.physicsMaterialId;
}

function collectMaterials(value, target) {
  if (!value) return;
  if (isNodeMaterial(value)) {
    target.add(value);
  } else if (Array.isArray(value) || value instanceof Set || value instanceof Map) {
    for (const entry of value instanceof Map ? value.values() : value) collectMaterials(entry, target);
  } else if (typeof value === "object") {
    for (const entry of Object.values(value)) collectMaterials(entry, target);
  }
}

function resolveRuntimeOwner(rootOrRuntime) {
  const runtime = rootOrRuntime?.recordType === "SculptRuntime"
    ? rootOrRuntime
    : rootOrRuntime?.userData?.sculptRuntime;
  if (!runtime || runtime.recordType !== "SculptRuntime" || runtime.root?.userData?.sculptRuntime !== runtime) {
    throw new TypeError("value has no sculpt runtime");
  }
  return runtime;
}

function reserveRuntimeInstance(subjectId, requestedInstanceId, continuityToken) {
  const explicit = requestedInstanceId !== undefined;
  if (continuityToken !== undefined) requireText(continuityToken, "continuityToken");
  if (!explicit && continuityToken !== undefined) {
    throw new Error("continuityToken requires an explicit instanceId");
  }
  let instanceId;
  if (explicit) {
    instanceId = requireText(requestedInstanceId, "instanceId");
  } else {
    let sequence = NEXT_AUTOMATIC_INSTANCE.get(subjectId) ?? 1;
    do {
      instanceId = `auto-${sequence}`;
      sequence += 1;
    } while (LIVE_RUNTIME_INSTANCES.has(JSON.stringify([subjectId, instanceId])));
    NEXT_AUTOMATIC_INSTANCE.set(subjectId, sequence);
  }

  const registryKey = JSON.stringify([subjectId, instanceId]);
  if (LIVE_RUNTIME_INSTANCES.has(registryKey)) {
    throw new Error(`Sculpt runtime instance "${subjectId}/${instanceId}" is already live`);
  }

  const previous = explicit ? INSTANCE_CONTINUITY_HISTORY.get(registryKey) : undefined;
  let generation = 1;
  let continuityStatus = explicit ? "explicit-instance-established" : "automatic-unique-instance";
  if (explicit && previous) {
    if (continuityToken !== undefined && continuityToken === previous.continuityToken) {
      generation = previous.generation;
      continuityStatus = "explicit-continuity-preserved";
    } else {
      generation = previous.generation + 1;
      continuityStatus = continuityToken === undefined
        ? "explicit-reuse-untracked-new-generation"
        : "explicit-continuity-changed-new-generation";
    }
  } else if (explicit && continuityToken === undefined) {
    continuityStatus = "explicit-instance-untracked";
  }

  LIVE_RUNTIME_INSTANCES.set(registryKey, true);
  return Object.freeze({
    instanceId,
    explicit,
    registryKey,
    continuityToken: continuityToken ?? null,
    continuityTokenProvided: continuityToken !== undefined,
    generation,
    continuityStatus,
    previousGeneration: previous?.generation ?? null,
  });
}

function commitRuntimeInstance(instance) {
  if (!instance.explicit) return;
  INSTANCE_CONTINUITY_HISTORY.set(instance.registryKey, Object.freeze({
    generation: instance.generation,
    continuityToken: instance.continuityTokenProvided ? instance.continuityToken : null,
  }));
}

export function registerSculptResource(runtime, resource, options = {}) {
  const record = retainResource(runtime, resource, options);
  return Object.freeze({
    resource,
    ownership: record.ownership,
    kind: record.kind,
    runtimeId: runtime.runtimeId,
  });
}

export function createSculptRuntime({
  subjectId,
  instanceId: requestedInstanceId,
  continuityToken,
  tier = "full",
  seed = 1,
  physicsMaterials = [],
  lengthUnit = "metre",
} = {}) {
  requireText(subjectId, "subjectId");
  if (!SCULPT_TIERS.includes(tier)) throw new RangeError(`Unknown sculpt tier "${tier}"`);
  if (!Number.isInteger(seed)) throw new TypeError("seed must be an integer");
  if (!Array.isArray(physicsMaterials)) throw new TypeError("physicsMaterials must be an array");
  requireLengthUnit(lengthUnit, "lengthUnit");

  const normalizedPhysicsMaterials = physicsMaterials.map((entry, index) => (
    normalizePhysicsMaterial(subjectId, entry, index)
  ));
  const instance = reserveRuntimeInstance(subjectId, requestedInstanceId, continuityToken);

  const root = new THREE.Group();
  const runtime = {
    recordType: "SculptRuntime",
    subjectId,
    instanceId: instance.instanceId,
    instanceIdWasExplicit: instance.explicit,
    instanceRegistryKey: instance.registryKey,
    instanceGeneration: instance.generation,
    continuityToken: instance.continuityToken,
    continuityTokenProvided: instance.continuityTokenProvided,
    continuityStatus: instance.continuityStatus,
    continuity: Object.freeze({
      policy: "same explicit continuityToken preserves generation; changed or omitted token on reuse increments generation",
      status: instance.continuityStatus,
      token: instance.continuityToken,
      tokenProvided: instance.continuityTokenProvided,
      generation: instance.generation,
      previousGeneration: instance.previousGeneration,
    }),
    runtimeId: stableId(`${subjectId}.runtime`, instance.instanceId, instance.generation),
    tier,
    seed,
    lengthUnit,
    root,
    mode: "final",
    nodes: new Map(),
    meshes: new Map(),
    sockets: new Map(),
    colliders: new Map(),
    physicsMaterials: new Map(),
    destructionGroups: new Map(),
    entityIds: new Map(),
    targetSemanticEntityIds: new Map(),
    resources: new Map(),
    diagnosticCoverage: null,
    diagnosticCoverageByMode: new Map(),
    semanticContract: Object.freeze({
      identityGeneration: instance.generation,
      visualLodIndependent: true,
      localSemanticIdsStableAcrossInstances: true,
      instanceQualifiedIds: true,
      lengthUnit,
      physicalRepresentationOwner: "route-selected physics adapter",
      contactAndMotionSolverAuthority: false,
    }),
    disposed: false,
  };

  for (const binding of normalizedPhysicsMaterials) {
    const localId = binding.physicsMaterialId.localId;
    if (runtime.physicsMaterials.has(localId)) {
      LIVE_RUNTIME_INSTANCES.delete(instance.registryKey);
      throw new Error(`Duplicate physics material "${localId}"`);
    }
    runtime.physicsMaterials.set(localId, binding);
  }

  try {
    registerObject(runtime, root, { id: "root", kind: "pivot" });
    root.userData.sculptRuntime = runtime;
    root.userData.sculptInstanceId = instance.instanceId;
    root.userData.sculptInstanceGeneration = instance.generation;
    root.userData.sculptContinuityStatus = instance.continuityStatus;
    root.userData.lengthUnit = lengthUnit;
    commitRuntimeInstance(instance);
  } catch (error) {
    LIVE_RUNTIME_INSTANCES.delete(instance.registryKey);
    throw error;
  }
  return { root, runtime };
}

export function addMesh(runtime, {
  id,
  geometry,
  material,
  parent = runtime?.root,
  semanticGroup = "detail",
  destructionGroup = null,
  castShadow = true,
  receiveShadow = true,
  ownership,
  resourceOwnership = ownership ?? "owned",
  geometryOwnership = resourceOwnership,
  materialOwnership = resourceOwnership,
} = {}) {
  requireRuntime(runtime);
  requireText(id, "object id");
  if (runtime.nodes.has(id)) throw new Error(`Duplicate sculpt runtime ID "${id}"`);
  const targetParent = requireParent(runtime, parent, `Mesh "${id}"`);
  if (!geometry?.isBufferGeometry) throw new TypeError(`Mesh "${id}" geometry must be a THREE.BufferGeometry`);
  if (!isNodeMaterial(material) && !(Array.isArray(material) && material.length > 0 && material.every(isNodeMaterial))) {
    throw new TypeError(`Mesh "${id}" material must be a Three.js NodeMaterial or nonempty NodeMaterial array`);
  }
  requireText(semanticGroup, "semanticGroup");
  if (destructionGroup !== null) requireText(destructionGroup, "destructionGroup");
  if (ownership !== undefined && ownership !== resourceOwnership) {
    throw new Error(`Mesh "${id}" ownership and resourceOwnership must agree`);
  }
  requireResourceOwnership(geometryOwnership, `Mesh "${id}" geometryOwnership`);
  requireResourceOwnership(materialOwnership, `Mesh "${id}" materialOwnership`);
  finiteObjectTransform(targetParent, `Mesh "${id}" parent`);
  const staticBounds = computeAndValidateStaticBounds(geometry, `Mesh "${id}"`);

  const resourceEntries = [
    { resource: geometry, ownership: geometryOwnership, kind: "geometry" },
    ...(Array.isArray(material) ? material : [material]).map((resource) => ({
      resource,
      ownership: materialOwnership,
      kind: "material",
    })),
  ];
  for (const entry of resourceEntries) validateResourceRegistration(runtime, entry.resource, entry);
  for (const entry of resourceEntries) retainResource(runtime, entry.resource, entry);

  const value = new THREE.Mesh(geometry, material);
  value.castShadow = Boolean(castShadow);
  value.receiveShadow = Boolean(receiveShadow);
  value.userData.originalMaterial = material;
  value.userData.semanticGroup = semanticGroup;
  value.userData.visualRepresentationOnly = true;
  value.userData.lengthUnit = runtime.lengthUnit;
  value.userData.staticBounds = staticBounds;
  value.userData.resourceOwnership = Object.freeze({
    geometry: geometryOwnership,
    material: materialOwnership,
  });
  registerObject(runtime, value, { id, kind: "mesh", destructionGroup });
  return attach(targetParent, value);
}

export function addPivot(runtime, id, parent = runtime?.root, { destructionGroup = null } = {}) {
  requireRuntime(runtime);
  const targetParent = requireParent(runtime, parent, `Pivot "${id}"`);
  const value = new THREE.Group();
  value.userData.actionReadyPivot = true;
  registerObject(runtime, value, { id, kind: "pivot", destructionGroup });
  return attach(targetParent, value);
}

export function addSocket(runtime, id, parent = runtime?.root, position = [0, 0, 0]) {
  requireRuntime(runtime);
  const targetParent = requireParent(runtime, parent, `Socket "${id}"`);
  const value = new THREE.Object3D();
  value.position.fromArray(requireFiniteVector(position, 3, `Socket "${id}" position`));
  value.userData.socketSpace = "parent-local";
  value.userData.lengthUnit = runtime.lengthUnit;
  value.userData.positionContract = "position is parent-local and expressed in runtime.lengthUnit";
  registerObject(runtime, value, { id, kind: "socket" });
  return attach(targetParent, value);
}

export function cylinderBetween(runtime, {
  id,
  start,
  end,
  radius,
  material,
  radialSegments = 8,
  parent = runtime?.root,
  semanticGroup = "detail",
  destructionGroup = null,
  materialOwnership = "owned",
} = {}) {
  requireRuntime(runtime);
  const startMeters = requireFiniteVector(start, 3, `Cylinder "${id}" start`);
  const endMeters = requireFiniteVector(end, 3, `Cylinder "${id}" end`);
  requirePositiveNumber(radius, `Cylinder "${id}" radius`);
  if (!Number.isInteger(radialSegments) || radialSegments < 3) {
    throw new RangeError(`Cylinder "${id}" radialSegments must be an integer >= 3`);
  }
  const a = new THREE.Vector3(...startMeters);
  const b = new THREE.Vector3(...endMeters);
  const delta = b.clone().sub(a);
  const length = delta.length();
  if (length === 0) throw new RangeError(`Cylinder "${id}" endpoints must be distinct`);
  const geometry = new THREE.CylinderGeometry(radius, radius, length, radialSegments, 1, false);
  let value;
  try {
    value = addMesh(runtime, {
      id,
      geometry,
      material,
      parent,
      semanticGroup,
      destructionGroup,
      geometryOwnership: "owned",
      materialOwnership,
    });
  } catch (error) {
    geometry.dispose();
    throw error;
  }
  value.position.copy(a).addScaledVector(delta, 0.5);
  value.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  value.userData.sourceDimensionsUnit = "metre";
  value.userData.sourceDimensions = Object.freeze({
    startMeters: Object.freeze(startMeters),
    endMeters: Object.freeze(endMeters),
    radiusMeters: radius,
    lengthUnit: runtime.lengthUnit,
    contract: "start, end, and radius are expressed in runtime.lengthUnit",
  });
  return value;
}

export function addColliderConstructionInput(runtime, {
  id,
  entityId,
  shape,
  physicsMaterialId,
  collisionRole = "solid",
  errorMeters,
  sourceRevision,
} = {}) {
  requireRuntime(runtime);
  requireText(id, "collider id");
  requireText(entityId, `Collider "${id}" entityId`);
  requireText(sourceRevision, `Collider "${id}" sourceRevision`);
  if (runtime.colliders.has(id)) throw new Error(`Duplicate collider ID "${id}"`);
  if (!runtime.nodes.has(entityId)) throw new Error(`Collider "${id}" references unknown entity "${entityId}"`);
  if (!COLLISION_ROLES.has(collisionRole)) throw new RangeError(`Collider "${id}" has unsupported collisionRole "${collisionRole}"`);
  if (!Number.isFinite(errorMeters) || errorMeters < 0) {
    throw new RangeError(`Collider "${id}" errorMeters must be finite and nonnegative`);
  }

  const canonicalPhysicsMaterialId = resolvePhysicsMaterialId(runtime, physicsMaterialId);
  const canonical = canonicalShape(shape);
  const colliderId = stableId(instanceNamespace(runtime, "collider"), id, runtime.instanceGeneration);
  const targetSemanticColliderId = stableId(targetNamespace(runtime, "collider"), id);
  const shapeId = stableId(instanceNamespace(runtime, "collider-shape"), id, runtime.instanceGeneration);
  const targetSemanticShapeId = stableId(targetNamespace(runtime, "collider-shape"), id);
  const proxy = deepFreeze({
    recordType: "ColliderConstructionInput",
    claimStatus: "authoring-input",
    solverAuthority: false,
    canonicalProxyStatus: "blocked",
    rigidBodyPropertiesStatus: "blocked-insufficient-evidence",
    contactAndMotionAuthority: "none",
    blockingRequirements: [...COLLIDER_ADAPTER_REQUIREMENTS],
    colliderId,
    targetSemanticColliderId,
    entityId: runtime.entityIds.get(entityId),
    targetSemanticEntityId: runtime.targetSemanticEntityIds.get(entityId),
    shapeId,
    targetSemanticShapeId,
    localFrame: {
      frameId: `${runtime.subjectId}.instance/${runtime.instanceId}/generation-${runtime.instanceGeneration}.collider-frame/${id}`,
      parentFrameId: `${runtime.subjectId}.instance/${runtime.instanceId}/generation-${runtime.instanceGeneration}.entity-frame/${entityId}`,
      handedness: "right-handed",
      units: runtime.lengthUnit,
      positionMeters: [0, 0, 0],
      rotationQuaternion: [0, 0, 0, 1],
      claimStatus: "authoring-local-frame",
      canonicalFrameStatus: "blocked-until-PhysicsContext-adapter",
    },
    shape: canonical,
    shapeRepresentation: canonical.kind === "compound-boxes" ? "compound" : "analytic",
    collisionRole,
    physicsMaterialId: canonicalPhysicsMaterialId,
    topologyRevision: `${runtime.subjectId}.collider-topology-v1`,
    sourceRevision,
    validity: {
      status: "authoring-input-only",
      tiers: [...SCULPT_TIERS],
      visualLodIndependent: true,
      canonicalValidityIntervalStatus: "blocked",
      invalidation: [
        "component topology revision",
        "SI source dimension revision",
        "entity attachment-frame revision",
        "physics-material binding revision",
      ],
    },
    approximationError: {
      maxSurfaceDeviationMeters: errorMeters,
      quantity: {
        value: errorMeters,
        unit: "metre",
        label: "Authored",
        source: `${sourceRevision}: conservative authoring envelope; not measured contact evidence`,
      },
      evidenceStatus: "insufficient-evidence-for-canonical-contact-acceptance",
    },
  });
  runtime.colliders.set(id, proxy);
  return proxy;
}

export function applyDiagnosticMaterials(
  runtime,
  mode,
  diagnosticMaterials = {},
  { materialOwnership = "owned" } = {},
) {
  requireRuntime(runtime);
  if (!SCULPT_MODES.includes(mode)) throw new RangeError(`Unknown sculpt mode "${mode}"`);
  requireResourceOwnership(materialOwnership, "diagnostic materialOwnership");
  const declaredDiagnosticMaterials = new Set();
  collectMaterials(diagnosticMaterials, declaredDiagnosticMaterials);
  for (const material of declaredDiagnosticMaterials) {
    validateResourceRegistration(runtime, material, { ownership: materialOwnership, kind: "material" });
  }
  for (const material of declaredDiagnosticMaterials) {
    retainResource(runtime, material, { ownership: materialOwnership, kind: "material" });
  }
  const mappings = [];
  const fallbackMeshIds = [];
  for (const [meshId, value] of runtime.meshes) {
    const semanticGroup = value.userData.semanticGroup ?? "detail";
    if (mode === "final" || mode === "materials") {
      value.material = value.userData.originalMaterial;
      mappings.push(Object.freeze({
        meshId,
        semanticGroup,
        source: "original-material",
        covered: true,
      }));
      continue;
    }
    const replacement = resolveDiagnosticMaterial(
      diagnosticMaterials,
      mode,
      semanticGroup,
    );
    if (replacement) {
      retainMaterialValue(runtime, replacement, materialOwnership);
      value.material = replacement;
      mappings.push(Object.freeze({
        meshId,
        semanticGroup,
        source: "diagnostic-material",
        covered: true,
      }));
    } else {
      value.material = value.userData.originalMaterial;
      fallbackMeshIds.push(meshId);
      mappings.push(Object.freeze({
        meshId,
        semanticGroup,
        source: "final-material-fallback",
        covered: false,
      }));
    }
  }
  runtime.mode = mode;
  const coverage = deepFreeze({
    recordType: "SculptDiagnosticCoverage",
    subjectId: runtime.subjectId,
    instanceId: runtime.instanceId,
    mode,
    meshCount: runtime.meshes.size,
    retainedDiagnosticMaterials: declaredDiagnosticMaterials.size,
    diagnosticMeshCount: mappings.filter((entry) => entry.source === "diagnostic-material").length,
    fallbackMeshIds,
    complete: fallbackMeshIds.length === 0,
    mappings,
  });
  runtime.diagnosticCoverage = coverage;
  runtime.diagnosticCoverageByMode.set(mode, coverage);
  return coverage;
}

export function summarizeSculptRuntime(rootOrRuntime) {
  const runtime = resolveRuntimeOwner(rootOrRuntime);
  validateRegisteredHierarchy(runtime, "summarizeSculptRuntime");
  const { root } = runtime;
  const storedGeometries = new Set();
  let meshObjects = 0;
  let renderItems = 0;
  let storedVertices = 0;
  let storedTriangles = 0;
  let submittedVertices = 0;
  let submittedTriangles = 0;

  root.traverse((object) => {
    if (!object.isMesh || !object.geometry?.isBufferGeometry) return;
    meshObjects += 1;
    const { geometry } = object;
    const position = geometry.getAttribute("position");
    const elementCount = geometry.index?.count ?? position?.count ?? 0;
    if (!storedGeometries.has(geometry)) {
      storedGeometries.add(geometry);
      storedVertices += position?.count ?? 0;
      storedTriangles += Math.floor(elementCount / 3);
    }

    let hierarchyVisible = true;
    for (let current = object; current; current = current.parent) {
      if (!current.visible) {
        hierarchyVisible = false;
        break;
      }
      if (current === root) break;
    }
    if (!hierarchyVisible) return;
    const multiplicity = object.isInstancedMesh ? object.count : 1;
    if (multiplicity <= 0) return;
    const drawStart = Math.max(0, geometry.drawRange?.start ?? 0);
    const requestedDrawCount = geometry.drawRange?.count ?? Infinity;
    const drawEnd = Math.min(
      elementCount,
      Number.isFinite(requestedDrawCount) ? drawStart + Math.max(0, requestedDrawCount) : elementCount,
    );

    const countSubmission = (start, count) => {
      const first = Math.max(drawStart, start);
      const last = Math.min(drawEnd, start + count);
      const submittedElements = Math.max(0, last - first);
      if (submittedElements <= 0) return;
      renderItems += 1;
      submittedVertices += submittedElements * multiplicity;
      submittedTriangles += Math.floor(submittedElements / 3) * multiplicity;
    };

    if (Array.isArray(object.material)) {
      for (const group of geometry.groups) {
        const material = object.material[group.materialIndex];
        if (material?.visible !== false) countSubmission(group.start, group.count);
      }
    } else if (object.material?.visible !== false) {
      countSubmission(0, elementCount);
    }
  });

  const metricDefinitions = deepFreeze({
    meshObjects: "Mesh or InstancedMesh objects with BufferGeometry, independent of material groups",
    renderItems: "potential visible render submissions after draw-range and material-array group expansion, before camera/frustum/occlusion culling",
    storedVertices: "position vertices across unique BufferGeometry resources",
    submittedVertices: "indexed or non-indexed element references multiplied by instance count; not post-transform-cache shader invocations",
    storedTriangles: "triangle elements across unique BufferGeometry resources",
    submittedTriangles: "draw-range triangle elements multiplied by instance count",
    drawables: "legacy alias of meshObjects",
    vertices: "legacy alias of submittedVertices",
    triangles: "legacy alias of submittedTriangles",
  });
  return Object.freeze({
    subjectId: runtime.subjectId,
    instanceId: runtime.instanceId,
    instanceGeneration: runtime.instanceGeneration,
    continuityStatus: runtime.continuityStatus,
    tier: runtime.tier,
    seed: runtime.seed,
    lengthUnit: runtime.lengthUnit,
    mode: runtime.mode,
    nodes: runtime.nodes.size,
    meshes: runtime.meshes.size,
    sockets: runtime.sockets.size,
    colliders: runtime.colliders.size,
    physicsMaterials: runtime.physicsMaterials.size,
    destructionGroups: runtime.destructionGroups.size,
    meshObjects,
    renderItems,
    storedVertices,
    submittedVertices,
    storedTriangles,
    submittedTriangles,
    drawables: meshObjects,
    vertices: submittedVertices,
    triangles: submittedTriangles,
    metricDefinitions,
  });
}

export function disposeSculptObject(root, _legacyMaterials = null) {
  const runtime = resolveRuntimeOwner(root);
  if (runtime.root !== root) throw new TypeError("disposeSculptObject requires the sculpt root");
  if (runtime.disposed) return Object.freeze({ geometries: 0, materials: 0, alreadyDisposed: true });
  validateRegisteredHierarchy(runtime, "disposeSculptObject");

  const released = { geometry: 0, material: 0, texture: 0, resource: 0 };
  const releasedExternal = { geometry: 0, material: 0, texture: 0, resource: 0 };
  const disposed = { geometry: 0, material: 0, texture: 0, resource: 0 };
  for (const [resource, record] of runtime.resources) {
    const globalRecord = RESOURCE_REGISTRATIONS.get(resource);
    if (
      !globalRecord
      || globalRecord.kind !== record.kind
      || globalRecord.ownershipMode !== record.ownership
      || !globalRecord.retainers.has(runtime)
    ) {
      throw new Error(`Registered ${record.kind} resource lost its global sculpt-runtime registration`);
    }
  }
  for (const [resource, record] of runtime.resources) {
    const globalRecord = RESOURCE_REGISTRATIONS.get(resource);
    globalRecord.retainers.delete(runtime);
    const releaseCounts = record.ownership === "owned" ? released : releasedExternal;
    releaseCounts[record.kind] = (releaseCounts[record.kind] ?? 0) + 1;
    if (globalRecord.retainers.size === 0) {
      RESOURCE_REGISTRATIONS.delete(resource);
      if (record.ownership === "owned") {
        resource.dispose();
        disposed[record.kind] = (disposed[record.kind] ?? 0) + 1;
      }
    }
  }
  runtime.resources.clear();

  for (const object of runtime.nodes.values()) {
    OBJECT_RUNTIME_OWNERS.delete(object);
  }
  LIVE_RUNTIME_INSTANCES.delete(runtime.instanceRegistryKey);
  runtime.disposed = true;
  return Object.freeze({
    geometries: disposed.geometry,
    materials: disposed.material,
    textures: disposed.texture,
    resources: disposed.resource,
    releasedGeometries: released.geometry,
    releasedMaterials: released.material,
    releasedTextures: released.texture,
    releasedResources: released.resource,
    releasedExternalGeometries: releasedExternal.geometry,
    releasedExternalMaterials: releasedExternal.material,
    releasedExternalTextures: releasedExternal.texture,
    releasedExternalResources: releasedExternal.resource,
    alreadyDisposed: false,
  });
}
