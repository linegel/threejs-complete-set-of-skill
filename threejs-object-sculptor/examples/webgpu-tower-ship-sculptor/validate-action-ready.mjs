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
  if (shape.units !== "metre") errors.push(`${label}.shape.units must be metre`);
  if (shape.kind === "box") {
    finiteArray(shape.centerMeters, 3, `${label}.shape.centerMeters`, errors);
    if (finiteArray(shape.sizeMeters, 3, `${label}.shape.sizeMeters`, errors) && shape.sizeMeters.some((value) => value <= 0)) {
      errors.push(`${label}.shape.sizeMeters must be positive`);
    }
  } else if (shape.kind === "capsule") {
    finiteArray(shape.startMeters, 3, `${label}.shape.startMeters`, errors);
    finiteArray(shape.endMeters, 3, `${label}.shape.endMeters`, errors);
    if (!Number.isFinite(shape.radiusMeters) || shape.radiusMeters <= 0) errors.push(`${label}.shape.radiusMeters must be positive`);
  } else if (shape.kind === "compound-boxes") {
    if (!Array.isArray(shape.boxes) || shape.boxes.length === 0) errors.push(`${label}.shape.boxes must be nonempty`);
    for (const [index, box] of (shape.boxes ?? []).entries()) {
      finiteArray(box.centerMeters, 3, `${label}.shape.boxes[${index}].centerMeters`, errors);
      if (finiteArray(box.sizeMeters, 3, `${label}.shape.boxes[${index}].sizeMeters`, errors) && box.sizeMeters.some((value) => value <= 0)) {
        errors.push(`${label}.shape.boxes[${index}].sizeMeters must be positive`);
      }
    }
  } else {
    errors.push(`${label}.shape.kind is unsupported`);
  }
}

function runtimeNodeId(object) {
  return object?.userData?.sculptId ?? object?.name ?? null;
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
    if (proxy.recordType !== "ColliderProxy") errors.push(`${label}.recordType must be ColliderProxy`);
    if (proxy.claimStatus !== "authoring-input" || proxy.solverAuthority !== false) errors.push(`${label} must remain a non-solver authoring input`);
    const colliderLocalId = stableId(proxy.colliderId, `${label}.colliderId`, errors);
    const entityLocalId = stableId(proxy.entityId, `${label}.entityId`, errors);
    stableId(proxy.shapeId, `${label}.shapeId`, errors);
    if (colliderLocalId !== mapId) errors.push(`${label}.colliderId.localId must match its map key`);
    if (entityLocalId) colliderEntityIds.add(entityLocalId);
    if (entityLocalId && !runtime.nodes.has(entityLocalId)) errors.push(`${label}.entityId ${entityLocalId} does not resolve to a runtime node`);
    if (!proxy.localFrame || typeof proxy.localFrame.frameId !== "string") errors.push(`${label}.localFrame.frameId is required`);
    finiteArray(proxy.localFrame?.positionMeters, 3, `${label}.localFrame.positionMeters`, errors);
    finiteArray(proxy.localFrame?.rotationQuaternion, 4, `${label}.localFrame.rotationQuaternion`, errors);
    validateShape(proxy.shape, label, errors);
    const materialId = stableId(proxy.physicsMaterialId, `${label}.physicsMaterialId`, errors);
    if (materialId && !runtime.physicsMaterials.has(materialId)) errors.push(`${label}.physicsMaterialId ${materialId} does not resolve`);
    if (!Number.isFinite(proxy.approximationError?.maxSurfaceDeviationMeters) || proxy.approximationError.maxSurfaceDeviationMeters < 0) {
      errors.push(`${label}.approximationError must be finite and nonnegative`);
    }
    if (proxy.validity?.visualLodIndependent !== true) errors.push(`${label}.validity must be visual-LOD independent`);
    if (proxy.sourceRevision !== "tower-ship-object-sculpt-spec-v2") errors.push(`${label}.sourceRevision is stale`);
  }

  for (const material of runtime.physicsMaterials.values()) {
    const materialId = stableId(material.physicsMaterialId, "physics material ID", errors);
    if (materialId && material.claimStatus !== "insufficient-evidence") errors.push(`physics material ${materialId} must not invent constitutive evidence`);
  }
  for (const component of components) {
    if (component.actionProfile?.collider?.type === "none") continue;
    if (!colliderEntityIds.has(component.id)) errors.push(`physics-relevant component ${component.id} has no ColliderProxy`);
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
