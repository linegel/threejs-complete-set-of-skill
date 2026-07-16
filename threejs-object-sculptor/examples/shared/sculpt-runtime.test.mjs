import assert from "node:assert/strict";

import * as THREE from "three/webgpu";
import { color } from "three/tsl";

import {
  addColliderConstructionInput,
  addMesh,
  addPivot,
  addSocket,
  applyDiagnosticMaterials,
  createSculptRuntime,
  cylinderBetween,
  disposeSculptObject,
  registerSculptResource,
  SCULPT_MODES,
  SCULPT_TIERS,
  summarizeSculptRuntime,
} from "./sculpt-runtime.js";

function nodeMaterial(hex) {
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = color(hex);
  material.roughness = 0.7;
  return material;
}

function buildFixture(tier, { instanceId, continuityToken } = {}) {
  const materials = {
    body: nodeMaterial(0x8d5b3f),
    arm: nodeMaterial(0x3d4652),
    blockout: nodeMaterial(0xb7c2ca),
    hierarchyBody: nodeMaterial(0x25a9d8),
    hierarchyArm: nodeMaterial(0xe06075),
    interaction: nodeMaterial(0xf0b83f),
  };
  const { root, runtime } = createSculptRuntime({
    subjectId: "shared-runtime-fixture",
    instanceId,
    continuityToken,
    tier,
    seed: 7,
    physicsMaterials: [
      { id: "body-material", visualMaterialId: "body" },
      { id: "arm-material", visualMaterialId: "arm" },
    ],
  });
  const body = addPivot(runtime, "body", root, { destructionGroup: "body-shell" });
  const widthSegments = tier === "full" ? 12 : tier === "budgeted" ? 6 : 2;
  const bodyMesh = addMesh(runtime, {
    id: "body-surface",
    geometry: new THREE.BoxGeometry(1, 1.4, 0.8, widthSegments, 2, 2),
    material: materials.body,
    parent: body,
    semanticGroup: "body",
    destructionGroup: "body-shell",
  });
  const arm = addPivot(runtime, "arm", body, { destructionGroup: "arm-joint" });
  const armMesh = cylinderBetween(runtime, {
    id: "arm-surface",
    start: [0, 0.4, 0],
    end: [0.9, 1.2, 0.2],
    radius: 0.08,
    material: materials.arm,
    radialSegments: tier === "full" ? 16 : tier === "budgeted" ? 8 : 4,
    parent: arm,
    semanticGroup: "arm",
    destructionGroup: "arm-joint",
  });
  const gripSocket = addSocket(runtime, "grip-socket", arm, [0.9, 1.2, 0.2]);
  gripSocket.rotation.z = 0.2;

  addColliderConstructionInput(runtime, {
    id: "body-box",
    entityId: "body",
    shape: { kind: "box", units: "metre", centerMeters: [0, 0, 0], sizeMeters: [1, 1.4, 0.8] },
    physicsMaterialId: "body-material",
    collisionRole: "solid",
    errorMeters: 0.04,
    sourceRevision: "shared-runtime-fixture-v1",
  });
  addColliderConstructionInput(runtime, {
    id: "arm-capsule",
    entityId: "arm",
    shape: {
      kind: "capsule",
      units: "metre",
      startMeters: [0, 0.4, 0],
      endMeters: [0.9, 1.2, 0.2],
      radiusMeters: 0.09,
    },
    physicsMaterialId: runtime.physicsMaterials.get("arm-material").physicsMaterialId,
    collisionRole: "sensor",
    errorMeters: 0.02,
    sourceRevision: "shared-runtime-fixture-v1",
  });

  return { root, runtime, materials, bodyMesh, armMesh, arm, gripSocket };
}

function countDisposals(resource) {
  let count = 0;
  resource.addEventListener("dispose", () => { count += 1; });
  return () => count;
}

function makeResource(kind, salt) {
  if (kind === "geometry") return new THREE.BoxGeometry(1 + salt * 0.01, 1, 1);
  if (kind === "material") return nodeMaterial(0x334455 + salt);
  if (kind === "texture") {
    return new THREE.DataTexture(new Uint8Array([salt, 128, 255, 255]), 1, 1);
  }
  throw new Error(`Unknown test resource kind ${kind}`);
}

assert.deepEqual(SCULPT_MODES, ["final", "blockout", "hierarchy", "materials", "action-ready"]);
assert.deepEqual(SCULPT_TIERS, ["full", "budgeted", "minimum"]);
assert.throws(
  () => createSculptRuntime({ subjectId: "bad-units", lengthUnit: "meter" }),
  /lengthUnit must be metre/,
);

const tierContracts = [];
const tierTriangles = [];
for (const tier of SCULPT_TIERS) {
  // Reusing one explicit instance after disposal proves tier rebuild identity is stable.
  const fixture = buildFixture(tier, {
    instanceId: "stable-preview",
    continuityToken: "stable-preview-tier-chain",
  });
  const { root, runtime, materials, bodyMesh, armMesh, arm, gripSocket } = fixture;
  assert.equal(runtime.root, root);
  assert.equal(runtime.lengthUnit, "metre");
  assert.equal(root.userData.sculptRuntime, runtime);
  assert.equal(root.userData.sculptInstanceId, "stable-preview");
  assert.equal(runtime.instanceGeneration, 1);
  assert.equal(root.userData.sculptInstanceGeneration, 1);
  assert.equal(gripSocket.parent, arm, "sockets must remain parent-local");
  assert.equal(gripSocket.userData.socketSpace, "parent-local");
  assert.equal(gripSocket.userData.lengthUnit, runtime.lengthUnit);
  assert.match(gripSocket.userData.positionContract, /runtime\.lengthUnit/);
  assert.equal(bodyMesh.castShadow, true);
  assert.equal(armMesh.userData.sourceDimensionsUnit, "metre");
  assert.equal(armMesh.userData.sourceDimensions.lengthUnit, runtime.lengthUnit);
  assert(bodyMesh.geometry.boundingBox && bodyMesh.geometry.boundingSphere);
  assert.equal(bodyMesh.userData.staticBounds.lengthUnit, "metre");

  const bodyProxy = runtime.colliders.get("body-box");
  assert.equal(bodyProxy.recordType, "ColliderConstructionInput");
  assert.equal(bodyProxy.claimStatus, "authoring-input");
  assert.equal(bodyProxy.solverAuthority, false);
  assert.equal(bodyProxy.solverHandoffStatus, "blocked");
  assert.equal(bodyProxy.massPropertiesStatus, "blocked-insufficient-evidence");
  assert.equal(bodyProxy.entityId.generation, 1);
  assert.match(bodyProxy.entityId.namespace, /\.instance\/stable-preview\.entity$/);
  assert.equal(bodyProxy.targetSemanticEntityId.namespace, "shared-runtime-fixture.entity");
  assert.match(bodyProxy.colliderId.namespace, /\.instance\/stable-preview\.collider$/);
  assert.equal(bodyProxy.targetSemanticColliderId.namespace, "shared-runtime-fixture.collider");
  assert.match(bodyProxy.shapeId.namespace, /\.instance\/stable-preview\.collider-shape$/);
  assert.equal(bodyProxy.targetSemanticShapeId.namespace, "shared-runtime-fixture.collider-shape");
  assert.equal(bodyProxy.shape.units, "metre");
  assert.equal(bodyProxy.localFrame.units, "metre");
  assert.equal(bodyProxy.validity.visualLodIndependent, true);
  assert.equal(bodyProxy.approximationError.quantity.unit, "metre");
  assert.equal(bodyProxy.approximationError.quantity.label, "Authored");
  assert(bodyProxy.blockingRequirements.some((entry) => entry.includes("solver integration")));
  const materialBinding = runtime.physicsMaterials.get("body-material");
  assert.equal(materialBinding.claimStatus, "insufficient-evidence");
  assert.equal(materialBinding.canonicalRegistryStatus, "blocked");
  assert.equal(materialBinding.solverAuthority, false);

  const blockoutCoverage = applyDiagnosticMaterials(runtime, "blockout", { blockout: materials.blockout });
  assert.equal(blockoutCoverage.complete, true);
  assert.equal(bodyMesh.material, materials.blockout);
  assert.equal(armMesh.material, materials.blockout);
  const hierarchyCoverage = applyDiagnosticMaterials(runtime, "hierarchy", {
    hierarchy: { body: materials.hierarchyBody, arm: materials.hierarchyArm },
  });
  assert.equal(hierarchyCoverage.complete, true);
  assert.equal(hierarchyCoverage.mappings.length, runtime.meshes.size);
  assert.equal(bodyMesh.material, materials.hierarchyBody);
  assert.equal(armMesh.material, materials.hierarchyArm);
  const actionCoverage = applyDiagnosticMaterials(runtime, "action-ready", {
    "action-ready": materials.interaction,
  });
  assert.equal(actionCoverage.complete, true);
  assert.equal(bodyMesh.material, materials.interaction);
  const materialCoverage = applyDiagnosticMaterials(runtime, "materials", {});
  assert.equal(materialCoverage.complete, true);
  assert.equal(bodyMesh.material, materials.body);
  assert.equal(armMesh.material, materials.arm);

  const summary = summarizeSculptRuntime(root);
  assert.deepEqual(summarizeSculptRuntime(runtime), summary, "summary accepts root or runtime owner");
  assert.deepEqual(
    { nodes: summary.nodes, meshes: summary.meshes, sockets: summary.sockets, colliders: summary.colliders },
    { nodes: 6, meshes: 2, sockets: 1, colliders: 2 },
  );
  assert.equal(summary.meshObjects, 2);
  assert.equal(summary.renderItems, 2);
  assert.equal(summary.drawables, summary.meshObjects);
  assert.equal(summary.vertices, summary.submittedVertices);
  assert.equal(summary.triangles, summary.submittedTriangles);
  assert.match(summary.metricDefinitions.submittedVertices, /element references/);
  tierTriangles.push(summary.submittedTriangles);
  tierContracts.push({
    nodeIds: [...runtime.nodes.keys()],
    socketIds: [...runtime.sockets.keys()],
    colliderIds: [...runtime.colliders.keys()],
    entityIds: [...runtime.entityIds.values()],
    targetSemanticEntityIds: [...runtime.targetSemanticEntityIds.values()],
    colliderIdentity: [...runtime.colliders.values()].map((value) => ({
      colliderId: value.colliderId,
      targetSemanticColliderId: value.targetSemanticColliderId,
      shapeId: value.shapeId,
      targetSemanticShapeId: value.targetSemanticShapeId,
    })),
  });

  const disposeResult = disposeSculptObject(root, materials);
  assert.equal(disposeResult.alreadyDisposed, false);
  assert.equal(disposeResult.geometries, 2);
  assert(disposeResult.materials >= 6);
  assert.deepEqual(disposeSculptObject(root, materials), { geometries: 0, materials: 0, alreadyDisposed: true });
}

assert(tierTriangles[0] > tierTriangles[1] && tierTriangles[1] > tierTriangles[2], "visual tiers vary density");
for (const contract of tierContracts.slice(1)) {
  assert.deepEqual(contract, tierContracts[0], "explicit instance and semantic identities survive tier rebuilds");
}

// Automatic instances are collision-free while target-semantic IDs remain stable.
{
  const first = createSculptRuntime({ subjectId: "automatic-instance" });
  const second = createSculptRuntime({ subjectId: "automatic-instance" });
  assert.notEqual(first.runtime.instanceId, second.runtime.instanceId);
  assert.notDeepEqual(first.runtime.entityIds.get("root"), second.runtime.entityIds.get("root"));
  assert.deepEqual(
    first.runtime.targetSemanticEntityIds.get("root"),
    second.runtime.targetSemanticEntityIds.get("root"),
  );
  disposeSculptObject(first.root);
  disposeSculptObject(second.root);
}

// Explicit live-instance collisions fail, but disposal releases the stable identity.
{
  const first = buildFixture("minimum", {
    instanceId: "explicit-stable",
    continuityToken: "preview-chain-a",
  });
  const identity = first.runtime.colliders.get("body-box").colliderId;
  assert.equal(first.runtime.continuityStatus, "explicit-instance-established");
  assert.throws(
    () => createSculptRuntime({
      subjectId: "shared-runtime-fixture",
      instanceId: "explicit-stable",
      continuityToken: "preview-chain-a",
    }),
    /already live/,
  );
  disposeSculptObject(first.root, first.materials);
  const rebuilt = buildFixture("full", {
    instanceId: "explicit-stable",
    continuityToken: "preview-chain-a",
  });
  assert.equal(rebuilt.runtime.continuityStatus, "explicit-continuity-preserved");
  assert.deepEqual(rebuilt.runtime.colliders.get("body-box").colliderId, identity);
  disposeSculptObject(rebuilt.root, rebuilt.materials);

  const replacement = buildFixture("minimum", {
    instanceId: "explicit-stable",
    continuityToken: "preview-chain-b",
  });
  assert.equal(replacement.runtime.instanceGeneration, 2);
  assert.equal(replacement.runtime.continuityStatus, "explicit-continuity-changed-new-generation");
  assert.notDeepEqual(replacement.runtime.colliders.get("body-box").colliderId, identity);
  const replacementIdentity = replacement.runtime.colliders.get("body-box").colliderId;
  disposeSculptObject(replacement.root, replacement.materials);

  const replacementRebuild = buildFixture("full", {
    instanceId: "explicit-stable",
    continuityToken: "preview-chain-b",
  });
  assert.equal(replacementRebuild.runtime.instanceGeneration, 2);
  assert.deepEqual(replacementRebuild.runtime.colliders.get("body-box").colliderId, replacementIdentity);
  disposeSculptObject(replacementRebuild.root, replacementRebuild.materials);
}

// Explicit reuse without a continuity token is safe but always starts a new generation.
{
  const first = createSculptRuntime({ subjectId: "untracked-continuity", instanceId: "preview" });
  assert.equal(first.runtime.instanceGeneration, 1);
  assert.equal(first.runtime.continuityStatus, "explicit-instance-untracked");
  disposeSculptObject(first.root);
  const second = createSculptRuntime({ subjectId: "untracked-continuity", instanceId: "preview" });
  assert.equal(second.runtime.instanceGeneration, 2);
  assert.equal(second.runtime.continuityStatus, "explicit-reuse-untracked-new-generation");
  disposeSculptObject(second.root);
  assert.throws(
    () => createSculptRuntime({ subjectId: "token-without-instance", continuityToken: "invalid" }),
    /requires an explicit instanceId/,
  );
}

// Parent ownership is checked before an ID can be registered.
{
  const a = createSculptRuntime({ subjectId: "parent-owner-a" });
  const b = createSculptRuntime({ subjectId: "parent-owner-b" });
  const external = new THREE.Group();
  assert.throws(() => addPivot(a.runtime, "external-child", external), /same sculpt runtime/);
  assert.throws(() => addPivot(a.runtime, "cross-child", b.root), /same sculpt runtime/);
  assert.equal(a.runtime.nodes.has("external-child"), false);
  assert.equal(a.runtime.nodes.has("cross-child"), false);
  disposeSculptObject(a.root);
  disposeSculptObject(b.root);
}

// Ownership metadata alone is insufficient: registered ancestry must remain rooted and registered.
{
  const { root, runtime } = createSculptRuntime({ subjectId: "hierarchy-integrity" });
  const pivot = addPivot(runtime, "detachable", root);
  root.remove(pivot);
  assert.throws(
    () => addPivot(runtime, "child-of-detached", pivot),
    /ancestry must reach the sculpt runtime root/,
  );
  assert.equal(runtime.nodes.has("child-of-detached"), false);
  assert.throws(() => summarizeSculptRuntime(runtime), /ancestry must reach/);
  assert.throws(() => disposeSculptObject(root), /ancestry must reach/);

  root.add(pivot);
  const externalIntermediary = new THREE.Group();
  externalIntermediary.add(pivot);
  root.add(externalIntermediary);
  assert.throws(() => summarizeSculptRuntime(runtime), /outside the sculpt runtime/);
  externalIntermediary.remove(pivot);
  root.add(pivot);
  disposeSculptObject(root);
}

// Shared owned geometry/material resources are disposed only after the final owner releases them.
{
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = nodeMaterial(0x7799bb);
  const geometryDisposals = countDisposals(geometry);
  const materialDisposals = countDisposals(material);
  const a = createSculptRuntime({ subjectId: "resource-owner-a" });
  const b = createSculptRuntime({ subjectId: "resource-owner-b" });
  addMesh(a.runtime, { id: "shared", geometry, material });
  addMesh(a.runtime, { id: "shared-again", geometry, material });
  addMesh(b.runtime, { id: "shared", geometry, material });
  const releasedA = disposeSculptObject(a.root);
  assert.equal(releasedA.geometries, 0);
  assert.equal(releasedA.materials, 0);
  assert.equal(releasedA.releasedGeometries, 1, "same resource is retained once per runtime");
  assert.equal(releasedA.releasedMaterials, 1);
  assert.equal(geometryDisposals(), 0);
  assert.equal(materialDisposals(), 0);
  const releasedB = disposeSculptObject(b.root);
  assert.equal(releasedB.geometries, 1);
  assert.equal(releasedB.materials, 1);
  assert.equal(geometryDisposals(), 1);
  assert.equal(materialDisposals(), 1);
}

// External resources stay caller-owned, including when attached to a mesh.
{
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = nodeMaterial(0x554433);
  const geometryDisposals = countDisposals(geometry);
  const materialDisposals = countDisposals(material);
  const { root, runtime } = createSculptRuntime({ subjectId: "external-resources" });
  addMesh(runtime, { id: "external", geometry, material, ownership: "external" });
  const result = disposeSculptObject(root);
  assert.equal(result.geometries, 0);
  assert.equal(result.materials, 0);
  assert.equal(geometryDisposals(), 0);
  assert.equal(materialDisposals(), 0);
  geometry.dispose();
  material.dispose();
  assert.equal(geometryDisposals(), 1);
  assert.equal(materialDisposals(), 1);
}

// Global registration rejects owned/external mixing in both orders for every resource class.
for (const [kindIndex, kind] of ["geometry", "material", "texture"].entries()) {
  {
    const resource = makeResource(kind, 20 + kindIndex);
    const disposals = countDisposals(resource);
    const owned = createSculptRuntime({ subjectId: `owned-first-${kind}` });
    const external = createSculptRuntime({ subjectId: `external-second-${kind}` });
    registerSculptResource(owned.runtime, resource, { ownership: "owned", kind });
    assert.throws(
      () => registerSculptResource(external.runtime, resource, { ownership: "external", kind }),
      /Global resource ownership-mode conflict/,
    );
    disposeSculptObject(external.root);
    disposeSculptObject(owned.root);
    assert.equal(disposals(), 1, `${kind} owned-first resource must dispose once`);
  }

  {
    const resource = makeResource(kind, 40 + kindIndex);
    const disposals = countDisposals(resource);
    const external = createSculptRuntime({ subjectId: `external-first-${kind}` });
    const owned = createSculptRuntime({ subjectId: `owned-second-${kind}` });
    registerSculptResource(external.runtime, resource, { ownership: "external", kind });
    assert.throws(
      () => registerSculptResource(owned.runtime, resource, { ownership: "owned", kind }),
      /Global resource ownership-mode conflict/,
    );
    disposeSculptObject(owned.root);
    const released = disposeSculptObject(external.root);
    const releaseField = {
      geometry: "releasedExternalGeometries",
      material: "releasedExternalMaterials",
      texture: "releasedExternalTextures",
    }[kind];
    assert.equal(released[releaseField], 1);
    assert.equal(disposals(), 0, `${kind} external-first resource remains caller-owned`);
    resource.dispose();
    assert.equal(disposals(), 1);
  }
}

// A resource's kind is likewise global and order-independent while retained.
for (const [index, [firstKind, secondKind]] of [["texture", "resource"], ["resource", "texture"]].entries()) {
  const resource = makeResource("texture", 70 + index);
  const first = createSculptRuntime({ subjectId: `kind-first-${index}` });
  const second = createSculptRuntime({ subjectId: `kind-second-${index}` });
  registerSculptResource(first.runtime, resource, { ownership: "external", kind: firstKind });
  assert.throws(
    () => registerSculptResource(second.runtime, resource, { ownership: "external", kind: secondKind }),
    /Global resource kind conflict/,
  );
  disposeSculptObject(second.root);
  disposeSculptObject(first.root);
  resource.dispose();
}

// Diagnostic materials participate in the same cross-runtime ownership table.
{
  const diagnostic = nodeMaterial(0xff44aa);
  const diagnosticDisposals = countDisposals(diagnostic);
  const a = createSculptRuntime({ subjectId: "diagnostic-owner-a" });
  const b = createSculptRuntime({ subjectId: "diagnostic-owner-b" });
  addMesh(a.runtime, {
    id: "surface",
    geometry: new THREE.BoxGeometry(1, 1, 1),
    material: nodeMaterial(0x111111),
    semanticGroup: "body",
  });
  addMesh(b.runtime, {
    id: "surface",
    geometry: new THREE.BoxGeometry(1, 1, 1),
    material: nodeMaterial(0x222222),
    semanticGroup: "body",
  });
  assert.equal(applyDiagnosticMaterials(a.runtime, "blockout", { blockout: diagnostic }).complete, true);
  assert.equal(applyDiagnosticMaterials(b.runtime, "blockout", { blockout: diagnostic }).complete, true);
  disposeSculptObject(a.root);
  assert.equal(diagnosticDisposals(), 0);
  disposeSculptObject(b.root);
  assert.equal(diagnosticDisposals(), 1);
}

// NodeMaterial textures are explicit resources; two runtimes share one refcount.
{
  const texture = new THREE.DataTexture(new Uint8Array([255, 128, 64, 255]), 1, 1);
  const textureDisposals = countDisposals(texture);
  const a = createSculptRuntime({ subjectId: "texture-owner-a" });
  const b = createSculptRuntime({ subjectId: "texture-owner-b" });
  const registration = registerSculptResource(a.runtime, texture, { ownership: "owned", kind: "texture" });
  registerSculptResource(a.runtime, texture, { ownership: "owned", kind: "texture" });
  registerSculptResource(b.runtime, texture, { ownership: "owned", kind: "texture" });
  assert.equal(registration.resource, texture);
  assert.equal(disposeSculptObject(a.root).textures, 0);
  assert.equal(textureDisposals(), 0);
  assert.equal(disposeSculptObject(b.root).textures, 1);
  assert.equal(textureDisposals(), 1);
}

// Material arrays and geometry groups expand to separate render items while storage stays unique.
{
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    1, 0, 0, 1, 1, 0, 0, 1, 0,
  ], 3));
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  const materials = [nodeMaterial(0xff0000), nodeMaterial(0x0000ff)];
  const { root, runtime } = createSculptRuntime({ subjectId: "group-summary" });
  addMesh(runtime, { id: "grouped-a", geometry, material: materials });
  addMesh(runtime, { id: "grouped-b", geometry, material: materials });
  const summary = summarizeSculptRuntime(runtime);
  assert.deepEqual({
    meshObjects: summary.meshObjects,
    renderItems: summary.renderItems,
    storedVertices: summary.storedVertices,
    submittedVertices: summary.submittedVertices,
    storedTriangles: summary.storedTriangles,
    submittedTriangles: summary.submittedTriangles,
  }, {
    meshObjects: 2,
    renderItems: 4,
    storedVertices: 6,
    submittedVertices: 12,
    storedTriangles: 2,
    submittedTriangles: 4,
  });
  disposeSculptObject(root);
}

// Mutations: incomplete diagnostics, invalid parents, units, aliases, and bounds all remain visible failures.
{
  const { root, runtime, materials, bodyMesh, armMesh } = buildFixture("minimum");
  assert.throws(() => addPivot(runtime, "body", root), /Duplicate sculpt runtime ID/);
  const nodesBeforeInvalidParent = runtime.nodes.size;
  assert.throws(() => addPivot(runtime, "orphan", null), /parent must be a THREE.Object3D/);
  assert.equal(runtime.nodes.size, nodesBeforeInvalidParent);

  const incomplete = applyDiagnosticMaterials(runtime, "hierarchy", {
    hierarchy: { body: materials.hierarchyBody },
  });
  assert.equal(incomplete.complete, false);
  assert.deepEqual(incomplete.fallbackMeshIds, ["arm-surface"]);
  assert.equal(runtime.diagnosticCoverage, incomplete);
  assert.equal(bodyMesh.material, materials.hierarchyBody);
  assert.equal(armMesh.material, materials.arm, "fallback is reported and remains visually explicit");

  const nonNodeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const nonNodeMaterial = new THREE.MeshBasicMaterial();
  assert.throws(() => addMesh(runtime, {
    id: "non-node-material",
    geometry: nonNodeGeometry,
    material: nonNodeMaterial,
  }), /NodeMaterial/);
  nonNodeGeometry.dispose();
  nonNodeMaterial.dispose();

  assert.throws(() => cylinderBetween(runtime, {
    id: "zero-cylinder",
    start: [0, 0, 0],
    end: [0, 0, 0],
    radius: 0.1,
    material: materials.body,
  }), /endpoints must be distinct/);

  const colliderBase = {
    entityId: "body",
    physicsMaterialId: "body-material",
    errorMeters: 0.1,
    sourceRevision: "shared-runtime-fixture-v1",
  };
  assert.throws(() => addColliderConstructionInput(runtime, {
    ...colliderBase,
    id: "omitted-units",
    shape: { kind: "box", centerMeters: [0, 0, 0], sizeMeters: [1, 1, 1] },
  }), /units must be metre/);
  assert.throws(() => addColliderConstructionInput(runtime, {
    ...colliderBase,
    id: "unit-alias",
    shape: { kind: "box", units: "m", centerMeters: [0, 0, 0], sizeMeters: [1, 1, 1] },
  }), /units must be metre/);
  assert.throws(() => addColliderConstructionInput(runtime, {
    ...colliderBase,
    id: "generic-shape-aliases",
    shape: { kind: "box", units: "metre", center: [0, 0, 0], size: [1, 1, 1] },
  }), /centerMeters/);
  assert.throws(() => addColliderConstructionInput(runtime, {
    ...colliderBase,
    id: "invalid-size",
    shape: { kind: "box", units: "metre", centerMeters: [0, 0, 0], sizeMeters: [1, 0, 1] },
  }), /positive values/);
  assert.throws(() => addColliderConstructionInput(runtime, {
    ...colliderBase,
    id: "unknown-entity",
    entityId: "missing",
    shape: { kind: "sphere", units: "metre", centerMeters: [0, 0, 0], radiusMeters: 1 },
  }), /unknown entity/);

  const invalidGeometry = new THREE.BufferGeometry();
  invalidGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0, Number.NaN, 1, 0, 1, 0, 0,
  ], 3));
  const invalidMaterial = nodeMaterial(0xffffff);
  assert.throws(() => addMesh(runtime, {
    id: "nonfinite-geometry",
    geometry: invalidGeometry,
    material: invalidMaterial,
  }), /positions must contain only finite values/);
  assert.equal(runtime.nodes.has("nonfinite-geometry"), false);
  invalidGeometry.dispose();
  invalidMaterial.dispose();

  root.position.x = Number.POSITIVE_INFINITY;
  const finiteGeometry = new THREE.BoxGeometry(1, 1, 1);
  const finiteMaterial = nodeMaterial(0x222222);
  assert.throws(() => addMesh(runtime, {
    id: "nonfinite-parent",
    geometry: finiteGeometry,
    material: finiteMaterial,
  }), /transform must contain only finite values/);
  assert.equal(runtime.nodes.has("nonfinite-parent"), false);
  root.position.x = 0;
  finiteGeometry.dispose();
  finiteMaterial.dispose();

  assert.throws(() => applyDiagnosticMaterials(runtime, "interaction", {}), /Unknown sculpt mode/);
  disposeSculptObject(root, materials);
}

console.log(JSON.stringify({
  ok: true,
  modes: SCULPT_MODES,
  tiers: SCULPT_TIERS,
  tierTriangles,
}, null, 2));
