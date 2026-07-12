function stableId(record, label, errors) {
  if (!record || typeof record !== "object") {
    errors.push(`${label} must be a generation-bearing ID`);
    return null;
  }
  if (typeof record.namespace !== "string" || !record.namespace) errors.push(`${label}.namespace is required`);
  if (typeof record.localId !== "string" || !record.localId) errors.push(`${label}.localId is required`);
  if (!Number.isInteger(record.generation) || record.generation <= 0) errors.push(`${label}.generation must be a positive integer`);
  return record.localId ?? null;
}

function finiteArray(value, length, label, errors) {
  if (!Array.isArray(value) || value.length !== length || value.some((entry) => !Number.isFinite(entry))) {
    errors.push(`${label} must contain ${length} finite values`);
    return false;
  }
  return true;
}

function validateShape(shape, label, errors) {
  if (!shape || typeof shape !== "object") {
    errors.push(`${label}.shape is required`);
    return;
  }
  if (shape.units !== "world-unit") errors.push(`${label}.shape.units must remain world-unit until a PhysicsContext adapter converts it`);
  if (shape.kind === "box") {
    finiteArray(shape.centerWorldUnits, 3, `${label}.shape.centerWorldUnits`, errors);
    if (finiteArray(shape.sizeWorldUnits, 3, `${label}.shape.sizeWorldUnits`, errors) && shape.sizeWorldUnits.some((value) => value <= 0)) {
      errors.push(`${label}.shape.sizeWorldUnits must be positive`);
    }
  } else if (shape.kind === "capsule") {
    finiteArray(shape.startWorldUnits, 3, `${label}.shape.startWorldUnits`, errors);
    finiteArray(shape.endWorldUnits, 3, `${label}.shape.endWorldUnits`, errors);
    if (!Number.isFinite(shape.radiusWorldUnits) || shape.radiusWorldUnits <= 0) errors.push(`${label}.shape.radiusWorldUnits must be positive`);
  } else if (shape.kind === "compound-boxes") {
    if (!Array.isArray(shape.boxes) || shape.boxes.length === 0) errors.push(`${label}.shape.boxes must be nonempty`);
    for (const [index, box] of (shape.boxes ?? []).entries()) {
      finiteArray(box.centerWorldUnits, 3, `${label}.shape.boxes[${index}].centerWorldUnits`, errors);
      if (finiteArray(box.sizeWorldUnits, 3, `${label}.shape.boxes[${index}].sizeWorldUnits`, errors) && box.sizeWorldUnits.some((value) => value <= 0)) {
        errors.push(`${label}.shape.boxes[${index}].sizeWorldUnits must be positive`);
      }
    }
  } else {
    errors.push(`${label}.shape.kind is unsupported`);
  }
}

function runtimeNodeId(object) {
  return object?.userData?.sculptId ?? object?.name ?? null;
}

export const TOWER_SHIP_MOTION_GATES = Object.freeze({
  oarAngularDeltaRadians: 0.12,
  sailAngularDeltaRadians: 0.04,
  sailScaleDelta: 0.05,
  riggingEndpointDisplacementWorldUnits: 0.03,
  lanternAngularDeltaRadians: 0.04,
});

function motionMetric(record, key, label, errors) {
  const value = record?.[key];
  if (!Number.isFinite(value) || value < 0) errors.push(`${label}.${key} must be finite and nonnegative`);
  return value;
}

function semanticMotionIds(record, expectedCount, label, errors) {
  const ids = record?.semanticNodeIds;
  if (!Array.isArray(ids) || ids.length !== expectedCount || ids.some((id) => typeof id !== "string" || id.length === 0)) {
    errors.push(`${label}.semanticNodeIds must contain ${expectedCount} named nodes`);
    return [];
  }
  if (new Set(ids).size !== ids.length) errors.push(`${label}.semanticNodeIds must be unique`);
  return ids;
}

export function validateTowerShipMotionEvidence(resetRecord, animatedRecord) {
  const errors = [];
  if (resetRecord?.timeSeconds !== 0 || resetRecord?.animationEnabled !== true) errors.push("reset record must be an animation-enabled exact t0 sample");
  if (!(animatedRecord?.timeSeconds > 0) || animatedRecord?.animationEnabled !== true) errors.push("animated record must be sampled at a positive fixed time");
  const reset = resetRecord?.systems ?? {};
  const animated = animatedRecord?.systems ?? {};
  semanticMotionIds(animated.oars, 24, "animated.oars", errors);
  semanticMotionIds(animated.sail, 2, "animated.sail", errors);
  semanticMotionIds(animated.rigging, 4, "animated.rigging", errors);
  semanticMotionIds(animated.lanterns, 4, "animated.lanterns", errors);
  for (const [system, keys] of Object.entries({
    oars: ["maxAngularDeltaRadians"],
    sail: ["maxAngularDeltaRadians", "maxScaleDelta"],
    rigging: ["maxEndpointDisplacementWorldUnits"],
    lanterns: ["maxAngularDeltaRadians"],
  })) {
    for (const key of keys) {
      const value = motionMetric(reset[system], key, `reset.${system}`, errors);
      if (value !== 0) errors.push(`reset.${system}.${key} must be exactly zero`);
      motionMetric(animated[system], key, `animated.${system}`, errors);
    }
  }
  if ((animated.oars?.maxAngularDeltaRadians ?? 0) < TOWER_SHIP_MOTION_GATES.oarAngularDeltaRadians) errors.push("animated oars do not clear the angular motion gate");
  if ((animated.sail?.maxAngularDeltaRadians ?? 0) < TOWER_SHIP_MOTION_GATES.sailAngularDeltaRadians) errors.push("animated sail does not clear the angular motion gate");
  if ((animated.sail?.maxScaleDelta ?? 0) < TOWER_SHIP_MOTION_GATES.sailScaleDelta) errors.push("animated sail does not clear the cloth-depth motion gate");
  if ((animated.rigging?.maxEndpointDisplacementWorldUnits ?? 0) < TOWER_SHIP_MOTION_GATES.riggingEndpointDisplacementWorldUnits) errors.push("animated rigging does not clear the endpoint-displacement gate");
  if ((animated.lanterns?.maxAngularDeltaRadians ?? 0) < TOWER_SHIP_MOTION_GATES.lanternAngularDeltaRadians) errors.push("animated lanterns do not clear the angular motion gate");
  if (errors.length) throw new Error(`Tower Ship motion validation failed:\n- ${errors.join("\n- ")}`);
  return Object.freeze({
    resetTimeSeconds: resetRecord.timeSeconds,
    animatedTimeSeconds: animatedRecord.timeSeconds,
    semanticNodeCounts: Object.freeze({ oars: 24, sail: 2, rigging: 4, lanterns: 4 }),
    gates: TOWER_SHIP_MOTION_GATES,
  });
}

export function validateTowerShipActionReady(spec, root) {
  const errors = [];
  const runtime = root?.userData?.sculptRuntime;
  if (!runtime) throw new Error("Tower Ship action-ready validation failed:\n- sculpt runtime is missing");
  const components = spec?.componentTree ?? [];
  const requiredComponentIds = components.map((component) => component.id).sort();
  for (const componentId of requiredComponentIds) {
    if (!runtime.nodes.has(componentId)) errors.push(`component ${componentId} is missing from runtime.nodes`);
  }

  const declaredSocketIds = [];
  for (const component of components) {
    const attachment = component.attachment;
    if (!attachment?.parentSocket) continue;
    declaredSocketIds.push(attachment.parentSocket);
    const attachmentSocket = runtime.sockets.get(attachment.parentSocket);
    if (!attachmentSocket) {
      errors.push(`attachment socket ${attachment.parentSocket} for ${component.id} is missing`);
      continue;
    }
    const actualParentId = runtimeNodeId(attachmentSocket.parent);
    if (actualParentId !== attachment.parentId) {
      errors.push(`attachment socket ${attachment.parentSocket} parent is ${actualParentId}; expected ${attachment.parentId}`);
    }
  }

  const declaredDestructionGroups = [...new Set(components
    .map((component) => component.actionProfile?.destruction?.fractureGroup)
    .filter(Boolean))].sort();
  for (const groupId of declaredDestructionGroups) {
    const members = runtime.destructionGroups.get(groupId);
    if (!Array.isArray(members) || members.length === 0) errors.push(`destruction group ${groupId} is missing or empty`);
    if (Array.isArray(members) && new Set(members).size !== members.length) errors.push(`destruction group ${groupId} contains duplicate members`);
  }

  const expectedOars = spec.repetitionSystems?.find((system) => system.id === "oars-24")?.count;
  if (runtime.oars.length !== expectedOars) errors.push(`oar runtime count is ${runtime.oars.length}; expected ${expectedOars}`);
  for (const oar of runtime.oars) {
    const oarSocket = runtime.sockets.get(`${oar.name}-socket`);
    if (!oarSocket || oarSocket.parent !== oar) errors.push(`oar socket ${oar.name}-socket is not parent-local`);
  }

  const colliderEntityIds = new Set();
  for (const [mapId, proxy] of runtime.colliders) {
    const label = `collider ${mapId}`;
    if (proxy.recordType !== "ColliderConstructionInput") errors.push(`${label}.recordType must be ColliderConstructionInput`);
    if (proxy.claimStatus !== "authoring-input" || proxy.solverAuthority !== false || proxy.canonicalProxyStatus !== "blocked") errors.push(`${label} must remain a blocked non-solver authoring input`);
    if (!Array.isArray(proxy.blockingRequirements) || !proxy.blockingRequirements.includes("PhysicsContext.metersPerWorldUnit")) errors.push(`${label} must name the missing PhysicsContext scale`);
    const colliderLocalId = stableId(proxy.colliderId, `${label}.colliderId`, errors);
    const entityLocalId = stableId(proxy.entityId, `${label}.entityId`, errors);
    stableId(proxy.shapeId, `${label}.shapeId`, errors);
    if (colliderLocalId !== mapId) errors.push(`${label}.colliderId.localId must match its map key`);
    if (entityLocalId) colliderEntityIds.add(entityLocalId);
    if (entityLocalId && !runtime.nodes.has(entityLocalId)) errors.push(`${label}.entityId ${entityLocalId} does not resolve to a runtime node`);
    if (!proxy.localFrame || typeof proxy.localFrame.frameId !== "string") errors.push(`${label}.localFrame.frameId is required`);
    finiteArray(proxy.localFrame?.positionWorldUnits, 3, `${label}.localFrame.positionWorldUnits`, errors);
    finiteArray(proxy.localFrame?.rotationQuaternion, 4, `${label}.localFrame.rotationQuaternion`, errors);
    validateShape(proxy.shape, label, errors);
    const materialId = stableId(proxy.physicsMaterialId, `${label}.physicsMaterialId`, errors);
    if (materialId && !runtime.physicsMaterials.has(materialId)) errors.push(`${label}.physicsMaterialId ${materialId} does not resolve`);
    if (!Number.isFinite(proxy.approximationError?.maxSurfaceDeviationWorldUnits) || proxy.approximationError.maxSurfaceDeviationWorldUnits < 0) {
      errors.push(`${label}.approximationError must be finite and nonnegative`);
    }
    if (proxy.validity?.visualLodIndependent !== true) errors.push(`${label}.validity must be visual-LOD independent`);
    if (proxy.sourceRevision !== "tower-ship-object-sculpt-spec-v2") errors.push(`${label}.sourceRevision is stale`);
  }

  for (const material of runtime.physicsMaterials.values()) {
    const materialId = stableId(material.physicsMaterialId, "physics material ID", errors);
    if (materialId && (material.recordType !== "PhysicsMaterialBindingInput" || material.claimStatus !== "insufficient-evidence" || material.canonicalRegistryStatus !== "blocked")) {
      errors.push(`physics material ${materialId} must remain a blocked binding input without invented constitutive evidence`);
    }
  }
  for (const component of components) {
    if (component.actionProfile?.collider?.type === "none") continue;
    if (!colliderEntityIds.has(component.id)) errors.push(`physics-relevant component ${component.id} has no collider construction input`);
  }

  if (errors.length) throw new Error(`Tower Ship action-ready validation failed:\n- ${errors.join("\n- ")}`);
  return Object.freeze({
    requiredComponentIds,
    declaredSocketIds: [...new Set(declaredSocketIds)].sort(),
    colliderIds: [...runtime.colliders.keys()].sort(),
    physicsMaterialIds: [...runtime.physicsMaterials.keys()].sort(),
    destructionGroupIds: [...runtime.destructionGroups.keys()].sort(),
    oarIds: runtime.oars.map((oar) => oar.name).sort(),
  });
}
