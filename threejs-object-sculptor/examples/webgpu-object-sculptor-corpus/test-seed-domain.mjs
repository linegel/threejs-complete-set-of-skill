import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { SCULPT_TIERS, summarizeSculptRuntime } from "../shared/sculpt-runtime.js";
import { SCULPT_TARGET_IDS, createSculptTarget } from "./object-catalog.js";

const VALID_UINT32_SEEDS = Object.freeze([
  0,
  1,
  2,
  0x7fffffff,
  0x80000000,
  0x9e3779b9,
  0xfffffffe,
  0xffffffff,
]);

const INVALID_SEEDS = Object.freeze([
  -1,
  0x100000000,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  "1",
  1n,
  new Number(1),
  Object.freeze({ valueOf: () => 1 }),
]);

function normalizedPlain(value) {
  if (value === undefined) return Object.freeze({ $undefined: true });
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return Object.freeze({ $number: String(value) });
    if (Object.is(value, -0)) return Object.freeze({ $number: "-0" });
    return value;
  }
  if (typeof value === "bigint") return Object.freeze({ $bigint: value.toString() });
  if (ArrayBuffer.isView(value)) return [...value].map(normalizedPlain);
  if (Array.isArray(value)) return value.map(normalizedPlain);
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [String(key), normalizedPlain(entry)])
      .sort(([a], [b]) => a.localeCompare(b));
  }
  if (value instanceof Set) return [...value].map(normalizedPlain).sort(compareNormalized);
  if (value?.isColor) return Object.freeze({ colorHex: value.getHex() });
  if (typeof value !== "object") return Object.freeze({ $type: typeof value });
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = normalizedPlain(value[key]);
  return result;
}

function compareNormalized(a, b) {
  return JSON.stringify(a).localeCompare(JSON.stringify(b));
}

function normalizedDigest(value) {
  return createHash("sha256").update(JSON.stringify(normalizedPlain(value))).digest("hex");
}

function canonicalNodeGraph(node) {
  const json = node.toJSON();
  const uuidMap = new Map();
  const collectUuids = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.uuid === "string" && !uuidMap.has(value.uuid)) {
      uuidMap.set(value.uuid, `node-${uuidMap.size}`);
    }
    if (Array.isArray(value)) {
      for (const entry of value) collectUuids(entry);
      return;
    }
    for (const key of Object.keys(value).sort()) collectUuids(value[key]);
  };
  collectUuids(json);

  const replaceUuids = (value) => {
    if (typeof value === "string") return uuidMap.get(value) ?? value;
    if (value === null || typeof value !== "object") return normalizedPlain(value);
    if (Array.isArray(value)) return value.map(replaceUuids);
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = replaceUuids(value[key]);
    return result;
  };
  return replaceUuids(json);
}

function nodeSlotInventory(material) {
  return Object.keys(material)
    .filter((key) => key.endsWith("Node") && material[key]?.isNode)
    .sort()
    .map((key) => Object.freeze({ key, graph: canonicalNodeGraph(material[key]) }));
}

function materialFingerprint(material) {
  const record = {
    type: material.type,
    name: material.name,
    isNodeMaterial: Boolean(material.isNodeMaterial),
    side: material.side,
    blending: material.blending,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    depthTest: material.depthTest,
    depthWrite: material.depthWrite,
    colorWrite: material.colorWrite,
    premultipliedAlpha: material.premultipliedAlpha,
    toneMapped: material.toneMapped,
    vertexColors: material.vertexColors,
    wireframe: material.wireframe,
    flatShading: material.flatShading,
    color: material.color?.isColor ? material.color.getHex() : null,
    emissive: material.emissive?.isColor ? material.emissive.getHex() : null,
    emissiveIntensity: material.emissiveIntensity ?? null,
    roughness: material.roughness ?? null,
    metalness: material.metalness ?? null,
    clearcoat: material.clearcoat ?? null,
    clearcoatRoughness: material.clearcoatRoughness ?? null,
    userData: normalizedPlain(material.userData),
    nodeSlots: nodeSlotInventory(material),
  };
  return Object.freeze({ ...record, digest: normalizedDigest(record) });
}

function byteDigest(view) {
  if (!view) return null;
  return createHash("sha256")
    .update(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
    .digest("hex");
}

function geometryFingerprint(geometry) {
  const attributes = Object.keys(geometry.attributes).sort().map((name) => {
    const attribute = geometry.getAttribute(name);
    return Object.freeze({
      name,
      itemSize: attribute.itemSize,
      count: attribute.count,
      normalized: attribute.normalized,
      arrayType: attribute.array.constructor.name,
      byteLength: attribute.array.byteLength,
      digest: byteDigest(attribute.array),
    });
  });
  const morphAttributes = Object.keys(geometry.morphAttributes).sort().map((name) => Object.freeze({
    name,
    attributes: geometry.morphAttributes[name].map((attribute) => Object.freeze({
      itemSize: attribute.itemSize,
      count: attribute.count,
      normalized: attribute.normalized,
      arrayType: attribute.array.constructor.name,
      byteLength: attribute.array.byteLength,
      digest: byteDigest(attribute.array),
    })),
  }));
  const index = geometry.index
    ? Object.freeze({
      count: geometry.index.count,
      arrayType: geometry.index.array.constructor.name,
      byteLength: geometry.index.array.byteLength,
      digest: byteDigest(geometry.index.array),
    })
    : null;
  const record = {
    type: geometry.type,
    attributes,
    morphAttributes,
    morphTargetsRelative: geometry.morphTargetsRelative,
    index,
    groups: geometry.groups.map(({ start, count, materialIndex }) => ({ start, count, materialIndex })),
    drawRange: { start: geometry.drawRange.start, count: geometry.drawRange.count },
    userData: normalizedPlain(geometry.userData),
    bounds: {
      boxMin: geometry.boundingBox?.min.toArray() ?? null,
      boxMax: geometry.boundingBox?.max.toArray() ?? null,
      sphereCenter: geometry.boundingSphere?.center.toArray() ?? null,
      sphereRadius: geometry.boundingSphere?.radius ?? null,
    },
  };
  return Object.freeze({ ...record, digest: normalizedDigest(record) });
}

function renderInventory(asset) {
  const geometryResources = new Map();
  const materialResources = new Map();
  const geometries = [];
  const materials = [];
  const meshBindings = [];

  const geometryId = (geometry) => {
    if (!geometryResources.has(geometry)) {
      const id = `geometry-${geometryResources.size}`;
      geometryResources.set(geometry, id);
      geometries.push(Object.freeze({ id, ...geometryFingerprint(geometry) }));
    }
    return geometryResources.get(geometry);
  };
  const materialId = (material) => {
    if (!materialResources.has(material)) {
      const id = `material-${materialResources.size}`;
      materialResources.set(material, id);
      materials.push(Object.freeze({ id, ...materialFingerprint(material) }));
    }
    return materialResources.get(material);
  };

  for (const meshId of [...asset.runtime.meshes.keys()].sort()) {
    const mesh = asset.runtime.meshes.get(meshId);
    const materialValue = mesh.userData.originalMaterial ?? mesh.material;
    const materialIds = (Array.isArray(materialValue) ? materialValue : [materialValue]).map(materialId);
    meshBindings.push(Object.freeze({ meshId, geometryId: geometryId(mesh.geometry), materialIds }));
  }
  const record = Object.freeze({ geometries, materials, meshBindings });
  return Object.freeze({ ...record, digest: normalizedDigest(record) });
}

function stableSemanticId(value) {
  if (!value) return null;
  return Object.freeze({ localId: value.localId, generation: value.generation });
}

function colliderInventory(asset) {
  return [...asset.runtime.colliders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, collider]) => Object.freeze({
      id,
      targetSemanticColliderId: stableSemanticId(collider.targetSemanticColliderId),
      targetSemanticEntityId: stableSemanticId(collider.targetSemanticEntityId),
      targetSemanticShapeId: stableSemanticId(collider.targetSemanticShapeId),
      shape: normalizedPlain(collider.shape),
      shapeRepresentation: collider.shapeRepresentation,
      collisionRole: collider.collisionRole,
      physicsMaterialId: stableSemanticId(collider.physicsMaterialId),
      approximationErrorMeters: collider.approximationError.maxSurfaceDeviationMeters,
      claimStatus: collider.claimStatus,
      solverAuthority: collider.solverAuthority,
      sourceRevision: collider.sourceRevision,
      topologyRevision: collider.topologyRevision,
      localFrame: {
        handedness: collider.localFrame.handedness,
        units: collider.localFrame.units,
        positionMeters: [...collider.localFrame.positionMeters],
        rotationQuaternion: [...collider.localFrame.rotationQuaternion],
      },
      validity: normalizedPlain(collider.validity),
    }));
}

function socketInventory(asset) {
  return [...asset.runtime.sockets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, socket]) => Object.freeze({
      id,
      targetSemanticEntityId: stableSemanticId(socket.userData.sculptTargetSemanticEntityId),
      parentId: socket.parent?.userData?.sculptId ?? null,
      position: socket.position.toArray(),
      quaternion: socket.quaternion.toArray(),
      scale: socket.scale.toArray(),
      socketSpace: socket.userData.socketSpace,
      lengthUnit: socket.userData.lengthUnit,
    }));
}

function constraintInventory(asset) {
  if (!(asset.runtime.constraints instanceof Map)) return [];
  const anchor = (value) => Object.freeze({
    ownerEntityId: stableSemanticId(
      asset.runtime.targetSemanticEntityIds.get(value.ownerEntityId.localId),
    ),
    positionMeters: [...value.positionMeters],
    rotationQuaternion: [...value.rotationQuaternion],
    units: value.units,
  });
  return [...asset.runtime.constraints.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, constraint]) => Object.freeze({
      id,
      type: constraint.type,
      targetSemanticConstraintId: stableSemanticId(constraint.targetSemanticConstraintId),
      targetSemanticParentEntityId: stableSemanticId(constraint.targetSemanticParentEntityId),
      targetSemanticChildEntityId: stableSemanticId(constraint.targetSemanticChildEntityId),
      parentAnchor: anchor(constraint.parentAnchor),
      childAnchor: anchor(constraint.childAnchor),
      axis: normalizedPlain(constraint.axis),
      angularLimit: normalizedPlain(constraint.angularLimit),
      rest: normalizedPlain(constraint.rest),
      approximationError: normalizedPlain(constraint.approximationError),
      claimStatus: constraint.claimStatus,
      solverAuthority: constraint.solverAuthority,
      sourceRevision: constraint.sourceRevision,
    }));
}

function physicsMaterialInventory(asset) {
  return [...asset.runtime.physicsMaterials.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, binding]) => Object.freeze({
      id,
      physicsMaterialId: stableSemanticId(binding.physicsMaterialId),
      visualMaterialId: binding.visualMaterialId,
      bindingScope: binding.bindingScope,
      claimStatus: binding.claimStatus,
      solverAuthority: binding.solverAuthority,
      sourceRevision: binding.sourceRevision,
      missingEvidence: [...binding.missingEvidence],
    }));
}

function motionInventory(asset) {
  if (asset.runtime.motionPreviewBindings instanceof Map) {
    return [...asset.runtime.motionPreviewBindings.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, binding]) => Object.freeze({
        id,
        nodeId: binding.nodeId,
        channel: binding.channel,
        axisLocal: [...binding.axisLocal],
        restRadians: binding.restRadians,
        amplitudeRadians: binding.amplitudeRadians,
        angularFrequencyRadPerS: binding.angularFrequencyRadPerS,
        limitRadians: [...binding.limitRadians],
        equationRevision: binding.equationRevision,
        solverAuthority: binding.solverAuthority,
      }));
  }
  if (Array.isArray(asset.runtime.previewMotionBindings)) {
    return asset.runtime.previewMotionBindings
      .map((binding) => Object.freeze({
        id: binding.id,
        nodeId: binding.node.userData.sculptId,
        amplitude: binding.amplitude,
        frequency: binding.frequency,
        phase: binding.phase,
        baseRotation: [...binding.baseRotation],
        solverAuthority: binding.solverAuthority,
        environmentForcingConsumed: binding.environmentForcingConsumed,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  if (asset.runtime.motionContract) return [normalizedPlain(asset.runtime.motionContract)];
  return [];
}

function semanticInventory(asset) {
  const nodes = [...asset.runtime.nodes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, node]) => Object.freeze({
      id,
      kind: node.userData.sculptKind,
      targetSemanticEntityId: stableSemanticId(node.userData.sculptTargetSemanticEntityId),
      parentId: node.parent?.userData?.sculptId ?? null,
      position: node.position.toArray(),
      quaternion: node.quaternion.toArray(),
      scale: node.scale.toArray(),
      visible: node.visible,
      semanticGroup: node.userData.semanticGroup ?? null,
      detailRole: node.userData.detailRole ?? null,
    }));
  const destructionGroups = [...asset.runtime.destructionGroups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, members]) => Object.freeze({ id, members: [...members].sort() }));
  return Object.freeze({
    targetId: asset.root.userData.targetId,
    category: asset.contract.category,
    units: asset.contract.units,
    nodes,
    destructionGroups,
  });
}

function protectedIds(contract, ...keys) {
  return [...new Set(keys.flatMap((key) => contract[key] ?? []))].sort();
}

function protectedIdentityInventory(asset) {
  const nodeIds = protectedIds(asset.contract, "protectedComponentIds", "protectedNodeIds");
  const socketIds = protectedIds(asset.contract, "protectedSocketIds", "socketIds");
  const colliderIds = protectedIds(asset.contract, "protectedColliderIds", "colliderIds");
  const constraintIds = protectedIds(asset.contract, "protectedConstraintIds");
  const destructionGroupIds = protectedIds(
    asset.contract,
    "protectedDestructionGroupIds",
    "destructionGroupIds",
  );
  return Object.freeze({
    nodes: nodeIds.map((id) => Object.freeze({
      id,
      targetSemanticEntityId: stableSemanticId(asset.runtime.targetSemanticEntityIds.get(id)),
    })),
    sockets: socketIds.map((id) => Object.freeze({
      id,
      targetSemanticEntityId: stableSemanticId(
        asset.runtime.sockets.get(id)?.userData.sculptTargetSemanticEntityId,
      ),
    })),
    colliders: colliderIds.map((id) => Object.freeze({
      id,
      targetSemanticColliderId: stableSemanticId(
        asset.runtime.colliders.get(id)?.targetSemanticColliderId,
      ),
    })),
    constraints: constraintIds.map((id) => Object.freeze({
      id,
      targetSemanticConstraintId: stableSemanticId(
        asset.runtime.constraints?.get(id)?.targetSemanticConstraintId,
      ),
    })),
    destructionGroups: destructionGroupIds,
  });
}

function protectedContractInventory(asset, fullSnapshot) {
  const socketIds = new Set(protectedIds(asset.contract, "protectedSocketIds", "socketIds"));
  const colliderIds = new Set(protectedIds(asset.contract, "protectedColliderIds", "colliderIds"));
  const constraintIds = new Set(protectedIds(asset.contract, "protectedConstraintIds"));
  const protectedNodeIds = new Set(protectedIds(
    asset.contract,
    "protectedComponentIds",
    "protectedNodeIds",
  ));
  const protectedMaterialBindings = fullSnapshot.render.meshBindings
    .filter(({ meshId }) => protectedNodeIds.has(meshId))
    .map(({ meshId, materialIds }) => Object.freeze({
      meshId,
      materials: materialIds.map((materialId) => {
        const material = fullSnapshot.render.materials.find(({ id }) => id === materialId);
        return Object.freeze({ digest: material.digest, type: material.type, userData: material.userData });
      }),
    }));
  return Object.freeze({
    identity: fullSnapshot.protectedIdentity,
    sockets: fullSnapshot.sockets.filter(({ id }) => socketIds.has(id)),
    colliders: fullSnapshot.colliders.filter(({ id }) => colliderIds.has(id)),
    constraints: fullSnapshot.constraints.filter(({ id }) => constraintIds.has(id)),
    protectedMaterialBindings,
  });
}

function normalizedAssetSnapshot(asset) {
  asset.setMode("final");
  asset.setTime(0, false);
  asset.root.updateMatrixWorld(true);
  const render = renderInventory(asset);
  const measured = summarizeSculptRuntime(asset.runtime);
  const summary = Object.freeze({
    subjectId: measured.subjectId,
    tier: measured.tier,
    seed: measured.seed,
    lengthUnit: measured.lengthUnit,
    mode: measured.mode,
    nodes: measured.nodes,
    meshes: measured.meshes,
    sockets: measured.sockets,
    colliders: measured.colliders,
    physicsMaterials: measured.physicsMaterials,
    destructionGroups: measured.destructionGroups,
    meshObjects: measured.meshObjects,
    renderItems: measured.renderItems,
    storedVertices: measured.storedVertices,
    submittedVertices: measured.submittedVertices,
    storedTriangles: measured.storedTriangles,
    submittedTriangles: measured.submittedTriangles,
  });
  const snapshot = {
    render,
    colliders: colliderInventory(asset),
    sockets: socketInventory(asset),
    constraints: constraintInventory(asset),
    physicsMaterials: physicsMaterialInventory(asset),
    motion: motionInventory(asset),
    semantics: semanticInventory(asset),
    protectedIdentity: protectedIdentityInventory(asset),
    summary,
  };
  return Object.freeze({ ...snapshot, digest: normalizedDigest(snapshot) });
}

function assertStrictTierReduction(subjectId, seed, tierRows) {
  for (let index = 1; index < tierRows.length; index += 1) {
    const previous = tierRows[index - 1];
    const current = tierRows[index];
    assert(
      previous.snapshot.summary.storedTriangles > current.snapshot.summary.storedTriangles,
      `${subjectId}/${seed} ${previous.tier}->${current.tier} must reduce stored triangles`,
    );
    assert(
      previous.snapshot.summary.storedVertices > current.snapshot.summary.storedVertices,
      `${subjectId}/${seed} ${previous.tier}->${current.tier} must reduce stored vertices`,
    );
    assert.notEqual(
      previous.snapshot.render.digest,
      current.snapshot.render.digest,
      `${subjectId}/${seed} ${previous.tier}->${current.tier} must change the visual representation`,
    );
  }
}

const snapshots = new Map();
const variationWitnessesByTarget = {};
let deterministicPairs = 0;
let continuityTransitions = 0;

for (const subjectId of SCULPT_TARGET_IDS) {
  for (const seed of VALID_UINT32_SEEDS) {
    const tierRows = [];
    const instanceId = `seed-domain/${subjectId}/${seed}`;
    const continuityToken = "seed-domain-tier-continuity-v1";
    let expectedGeneration = null;
    let expectedEffectiveContinuityToken = null;
    let expectedProtectedContract = null;

    for (const tier of SCULPT_TIERS) {
      const explicit = createSculptTarget(subjectId, {
        tier,
        seed,
        instanceId,
        continuityToken,
      });
      const replay = createSculptTarget(subjectId, { tier, seed });
      try {
        assert.equal(explicit.runtime.seed, seed, `${subjectId}/${tier}/${seed} seed drifted`);
        assert.equal(explicit.runtime.tier, tier, `${subjectId}/${tier}/${seed} tier drifted`);
        assert.equal(replay.runtime.seed, seed, `${subjectId}/${tier}/${seed} replay seed drifted`);
        assert.equal(replay.runtime.tier, tier, `${subjectId}/${tier}/${seed} replay tier drifted`);

        const explicitSnapshot = normalizedAssetSnapshot(explicit);
        const replaySnapshot = normalizedAssetSnapshot(replay);
        assert.deepEqual(
          replaySnapshot,
          explicitSnapshot,
          `${subjectId}/${tier}/${seed} must deterministically reproduce normalized inventories`,
        );
        deterministicPairs += 1;

        const protectedContract = protectedContractInventory(explicit, explicitSnapshot);
        if (expectedGeneration === null) {
          expectedGeneration = explicit.runtime.instanceGeneration;
          expectedEffectiveContinuityToken = explicit.runtime.continuityToken;
          expectedProtectedContract = protectedContract;
        } else {
          assert.equal(
            explicit.runtime.instanceGeneration,
            expectedGeneration,
            `${subjectId}/${seed}/${tier} visual tier changed instance generation`,
          );
          assert.equal(
            explicit.runtime.continuityStatus,
            "explicit-continuity-preserved",
            `${subjectId}/${seed}/${tier} did not preserve explicit continuity`,
          );
          assert.equal(
            explicit.runtime.continuityToken,
            expectedEffectiveContinuityToken,
            `${subjectId}/${seed}/${tier} included visual tier in effective continuity`,
          );
          assert.deepEqual(
            protectedContract,
            expectedProtectedContract,
            `${subjectId}/${seed}/${tier} changed a protected cross-tier contract`,
          );
          continuityTransitions += 1;
        }

        tierRows.push(Object.freeze({ tier, snapshot: explicitSnapshot }));
        snapshots.set(`${subjectId}/${seed}/${tier}`, explicitSnapshot);
      } finally {
        await explicit.dispose();
        await replay.dispose();
      }
    }
    assertStrictTierReduction(subjectId, seed, tierRows);
  }

  const first = snapshots.get(`${subjectId}/1/full`);
  const second = snapshots.get(`${subjectId}/2/full`);
  assert.deepEqual(
    second.protectedIdentity,
    first.protectedIdentity,
    `${subjectId} seed variation changed protected semantic identities`,
  );
  const variationWitnesses = Object.freeze({
    geometry: first.render.geometries.map(({ digest }) => digest)
      .join(":") !== second.render.geometries.map(({ digest }) => digest).join(":"),
    materials: first.render.materials.map(({ digest }) => digest)
      .join(":") !== second.render.materials.map(({ digest }) => digest).join(":"),
    constraints: normalizedDigest(first.constraints) !== normalizedDigest(second.constraints),
    motion: normalizedDigest(first.motion) !== normalizedDigest(second.motion),
    semanticTransforms: normalizedDigest(first.semantics.nodes) !== normalizedDigest(second.semantics.nodes),
  });
  assert(
    Object.values(variationWitnesses).some(Boolean),
    `${subjectId} representative distinct seeds did not affect authored output`,
  );
  variationWitnessesByTarget[subjectId] = variationWitnesses;
}

for (const subjectId of SCULPT_TARGET_IDS) {
  for (const seed of INVALID_SEEDS) {
    assert.throws(
      () => createSculptTarget(subjectId, { tier: "minimum", seed }),
      /seed|uint32|integer|finite|range/i,
      `${subjectId} must reject invalid seed ${String(seed)}`,
    );
  }
}

console.log(JSON.stringify({
  ok: true,
  targets: SCULPT_TARGET_IDS,
  tiers: SCULPT_TIERS,
  validSeeds: VALID_UINT32_SEEDS,
  invalidCasesPerTarget: INVALID_SEEDS.length,
  constructions: deterministicPairs * 2,
  deterministicPairs,
  continuityTransitions,
  variationWitnessesByTarget,
  normalizedInventories: [
    "geometry",
    "render-material",
    "physics-material",
    "collider",
    "socket",
    "constraint",
    "motion",
    "semantic",
  ],
}, null, 2));
