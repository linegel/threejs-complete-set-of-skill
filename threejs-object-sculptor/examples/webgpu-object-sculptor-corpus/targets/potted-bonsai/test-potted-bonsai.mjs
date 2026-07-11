import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three/webgpu";

import {
  TARGET_CONTRACT,
  TARGET_ID,
  createPottedBonsai,
} from "./potted-bonsai-factory.js";

const BRANCH_IDS = [
  "branch-left",
  "branch-right",
  "branch-back",
  "branch-left-secondary",
  "branch-right-secondary",
  "branch-back-secondary",
];

const COLLIDER_VISUALS = Object.freeze({
  "pot-solid": ["pot-body", "pot-rim", "pot-foot"],
  "trunk-capsule": ["trunk-surface"],
  "branch-left-capsule": ["branch-left-surface"],
  "branch-right-capsule": ["branch-right-surface"],
  "branch-back-capsule": ["branch-back-surface"],
  "canopy-trigger": BRANCH_IDS.map((id) => `${id}-foliage`),
});

function triangleIndices(geometry) {
  const count = geometry.index?.count ?? geometry.getAttribute("position").count;
  const read = geometry.index
    ? (offset) => geometry.index.getX(offset)
    : (offset) => offset;
  return { count, read };
}

function assertOutwardFaces(geometry, label, {
  closed = false,
  minAlignment = 1e-4,
  capMinAlignment = 0.9,
} = {}) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  assert(position && normal, `${label} requires independent position and normal attributes`);
  const { count, read } = triangleIndices(geometry);
  assert.equal(count % 3, 0, `${label} index count must be triangular`);
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const n0 = new THREE.Vector3();
  const n1 = new THREE.Vector3();
  const n2 = new THREE.Vector3();
  const edge01 = new THREE.Vector3();
  const edge02 = new THREE.Vector3();
  const edge12 = new THREE.Vector3();
  const face = new THREE.Vector3();
  const summedNormal = new THREE.Vector3();
  const edgeCounts = new Map();

  for (let offset = 0; offset < count; offset += 3) {
    const ids = [read(offset), read(offset + 1), read(offset + 2)];
    p0.fromBufferAttribute(position, ids[0]);
    p1.fromBufferAttribute(position, ids[1]);
    p2.fromBufferAttribute(position, ids[2]);
    edge01.subVectors(p1, p0);
    edge02.subVectors(p2, p0);
    edge12.subVectors(p2, p1);
    face.crossVectors(edge01, edge02);
    const maxEdgeSq = Math.max(edge01.lengthSq(), edge02.lengthSq(), edge12.lengthSq());
    assert(Number.isFinite(maxEdgeSq) && maxEdgeSq > 0, `${label} triangle ${offset / 3} has invalid edges`);
    assert(face.length() / maxEdgeSq > 1e-6, `${label} triangle ${offset / 3} is degenerate`);
    n0.fromBufferAttribute(normal, ids[0]);
    n1.fromBufferAttribute(normal, ids[1]);
    n2.fromBufferAttribute(normal, ids[2]);
    summedNormal.copy(n0).add(n1).add(n2);
    assert(summedNormal.lengthSq() > 1e-8, `${label} triangle ${offset / 3} has invalid authored normals`);
    const alignment = face.dot(summedNormal) / (face.length() * summedNormal.length());
    const requiredAlignment = Number.isInteger(geometry.userData.sideIndexCount)
      && offset >= geometry.userData.sideIndexCount
      ? capMinAlignment
      : minAlignment;
    assert(alignment > requiredAlignment, `${label} triangle ${offset / 3} is inverted (${alignment})`);
    if (closed) {
      for (const [a, b] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
    }
  }
  if (closed) {
    for (const [edge, uses] of edgeCounts) assert.equal(uses, 2, `${label} edge ${edge} is used ${uses} times`);
  }
}

function assertClosedAfterDeclaredSeamWeld(geometry, label) {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const parent = Array.from({ length: position.count }, (_, index) => index);
  const find = (value) => {
    let current = value;
    while (parent[current] !== current) current = parent[current];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = current;
      value = next;
    }
    return current;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  const pointA = new THREE.Vector3();
  const pointB = new THREE.Vector3();
  assert(Array.isArray(geometry.userData.seamWeldPairs) && geometry.userData.seamWeldPairs.length > 0);
  for (const [a, b] of geometry.userData.seamWeldPairs) {
    pointA.fromBufferAttribute(position, a);
    pointB.fromBufferAttribute(position, b);
    assert(pointA.distanceTo(pointB) < 1e-7, `${label} declared seam pair differs in position`);
    assert(Math.abs(uv.getY(a) - uv.getY(b)) < 1e-7, `${label} declared seam pair differs in longitudinal UV`);
    assert(Math.abs(Math.abs(uv.getX(a) - uv.getX(b)) - 1) < 1e-7, `${label} seam pair must span U=0..1`);
    union(a, b);
  }
  assert(Array.isArray(geometry.userData.capBoundaryWeldPairs));
  for (const [a, b] of geometry.userData.capBoundaryWeldPairs) {
    pointA.fromBufferAttribute(position, a);
    pointB.fromBufferAttribute(position, b);
    assert(pointA.distanceTo(pointB) < 1e-7, `${label} cap boundary pair differs in position`);
    union(a, b);
  }

  const edgeCounts = new Map();
  const directedEdgeCounts = new Map();
  const triangleKeys = new Set();
  const adjacency = new Map();
  const vertexLinks = new Map();
  const usedVertices = new Set();
  const { count, read } = triangleIndices(geometry);
  for (let offset = 0; offset < count; offset += 3) {
    const ids = [find(read(offset)), find(read(offset + 1)), find(read(offset + 2))];
    assert.equal(new Set(ids).size, 3, `${label} seam welding collapses a triangle`);
    const triangleKey = [...ids].sort((a, b) => a - b).join(":");
    assert(!triangleKeys.has(triangleKey), `${label} contains a duplicate welded triangle ${triangleKey}`);
    triangleKeys.add(triangleKey);
    ids.forEach((id) => usedVertices.add(id));
    for (const [a, b] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      const directedKey = `${a}:${b}`;
      directedEdgeCounts.set(directedKey, (directedEdgeCounts.get(directedKey) ?? 0) + 1);
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a).add(b);
      adjacency.get(b).add(a);
    }
    for (const [vertex, oppositeA, oppositeB] of [
      [ids[0], ids[1], ids[2]],
      [ids[1], ids[2], ids[0]],
      [ids[2], ids[0], ids[1]],
    ]) {
      if (!vertexLinks.has(vertex)) vertexLinks.set(vertex, []);
      vertexLinks.get(vertex).push([oppositeA, oppositeB]);
    }
  }
  for (const [edge, uses] of edgeCounts) {
    assert.equal(uses, 2, `${label} welded edge ${edge} has ${uses} uses`);
    const [a, b] = edge.split(":");
    assert.equal(directedEdgeCounts.get(`${a}:${b}`), 1, `${label} edge ${edge} lacks one forward use`);
    assert.equal(directedEdgeCounts.get(`${b}:${a}`), 1, `${label} edge ${edge} lacks one reverse use`);
  }
  for (const vertex of usedVertices) {
    const linkAdjacency = new Map();
    const linkEdges = new Set();
    for (const [a, b] of vertexLinks.get(vertex) ?? []) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      assert(!linkEdges.has(key), `${label} vertex ${vertex} has duplicate link edge ${key}`);
      linkEdges.add(key);
      if (!linkAdjacency.has(a)) linkAdjacency.set(a, new Set());
      if (!linkAdjacency.has(b)) linkAdjacency.set(b, new Set());
      linkAdjacency.get(a).add(b);
      linkAdjacency.get(b).add(a);
    }
    assert(linkAdjacency.size >= 3, `${label} vertex ${vertex} has an invalid link`);
    for (const [neighbor, adjacent] of linkAdjacency) {
      assert.equal(adjacent.size, 2, `${label} vertex ${vertex} link neighbor ${neighbor} has degree ${adjacent.size}`);
    }
    const first = linkAdjacency.keys().next().value;
    const linkVisited = new Set([first]);
    const linkPending = [first];
    while (linkPending.length > 0) {
      const current = linkPending.pop();
      for (const next of linkAdjacency.get(current) ?? []) {
        if (linkVisited.has(next)) continue;
        linkVisited.add(next);
        linkPending.push(next);
      }
    }
    assert.equal(linkVisited.size, linkAdjacency.size, `${label} vertex ${vertex} has a disconnected link`);
  }
  const [startVertex] = usedVertices;
  const visited = new Set([startVertex]);
  const pending = [startVertex];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      pending.push(next);
    }
  }
  assert.equal(visited.size, usedVertices.size, `${label} welded topology is disconnected`);
  const eulerCharacteristic = usedVertices.size - edgeCounts.size + count / 3;
  assert.equal(eulerCharacteristic, 2, `${label} welded topology is not a closed genus-zero manifold`);
}

function assertMergedLeafSolids(geometry, label) {
  const stride = geometry.userData.verticesPerElement;
  const elements = geometry.userData.foliageElements;
  const position = geometry.getAttribute("position");
  const { count, read } = triangleIndices(geometry);
  assert.equal(position.count, stride * elements);
  const centers = [];
  const point = new THREE.Vector3();
  for (let element = 0; element < elements; element += 1) {
    const center = new THREE.Vector3();
    for (let local = 0; local < stride; local += 1) {
      point.fromBufferAttribute(position, element * stride + local);
      center.add(point);
    }
    centers.push(center.multiplyScalar(1 / stride));
  }
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const face = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const edgeCounts = new Map();
  for (let offset = 0; offset < count; offset += 3) {
    const ids = [read(offset), read(offset + 1), read(offset + 2)];
    const element = Math.floor(ids[0] / stride);
    assert(ids.every((id) => Math.floor(id / stride) === element), `${label} triangle crosses leaf elements`);
    p0.fromBufferAttribute(position, ids[0]);
    p1.fromBufferAttribute(position, ids[1]);
    p2.fromBufferAttribute(position, ids[2]);
    face.crossVectors(p1.clone().sub(p0), p2.clone().sub(p0));
    assert(face.lengthSq() > 1e-12, `${label} has a degenerate leaf triangle`);
    centroid.copy(p0).add(p1).add(p2).multiplyScalar(1 / 3).sub(centers[element]);
    assert(face.dot(centroid) > 1e-10, `${label} has an inward leaf triangle`);
    for (const [a, b] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  for (const [edge, uses] of edgeCounts) assert.equal(uses, 2, `${label} edge ${edge} is not closed`);
}

function colliderSignedDistance(point, shape) {
  if (shape.kind === "sphere") {
    return point.distanceTo(new THREE.Vector3(...shape.centerMeters)) - shape.radiusMeters;
  }
  const start = new THREE.Vector3(...shape.startMeters);
  const end = new THREE.Vector3(...shape.endMeters);
  const axis = end.clone().sub(start);
  const length = axis.length();
  axis.multiplyScalar(1 / length);
  if (shape.kind === "capsule") {
    const along = THREE.MathUtils.clamp(point.clone().sub(start).dot(axis), 0, length);
    return point.distanceTo(start.clone().addScaledVector(axis, along)) - shape.radiusMeters;
  }
  if (shape.kind === "cylinder") {
    const center = start.clone().add(end).multiplyScalar(0.5);
    const relative = point.clone().sub(center);
    const axialCoordinate = relative.dot(axis);
    const radialDistance = relative.addScaledVector(axis, -axialCoordinate).length();
    const radial = radialDistance - shape.radiusMeters;
    const axial = Math.abs(axialCoordinate) - length * 0.5;
    const outside = Math.hypot(Math.max(radial, 0), Math.max(axial, 0));
    return outside + Math.min(Math.max(radial, axial), 0);
  }
  throw new Error(`unsupported collider shape ${shape.kind}`);
}

function verticesInEntityFrame(asset, entityId, meshIds) {
  asset.root.updateMatrixWorld(true);
  const entity = asset.runtime.nodes.get(entityId);
  const worldToEntity = entity.matrixWorld.clone().invert();
  const point = new THREE.Vector3();
  const result = [];
  for (const meshId of meshIds) {
    const mesh = asset.runtime.meshes.get(meshId);
    const transform = worldToEntity.clone().multiply(mesh.matrixWorld);
    const position = mesh.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      result.push(point.fromBufferAttribute(position, index).applyMatrix4(transform).clone());
    }
  }
  return result;
}

function sampledColliderDeviation(asset, colliderId) {
  const collider = asset.runtime.colliders.get(colliderId);
  const entityId = collider.entityId.localId;
  return Math.max(...verticesInEntityFrame(asset, entityId, COLLIDER_VISUALS[colliderId])
    .map((point) => Math.abs(colliderSignedDistance(point, collider.shape))));
}

function normalizedColliderSnapshot(asset) {
  return [...asset.runtime.colliders].map(([id, collider]) => ({
    id,
    entityId: collider.entityId.localId,
    shape: collider.shape,
    collisionRole: collider.collisionRole,
    physicsMaterialId: collider.physicsMaterialId.localId,
    errorMeters: collider.approximationError.maxSurfaceDeviationMeters,
  }));
}

function ringCenter(geometry, section) {
  const radialSegments = geometry.userData.radialSegments;
  const stride = radialSegments + 1;
  const position = geometry.getAttribute("position");
  const center = new THREE.Vector3();
  const point = new THREE.Vector3();
  for (let radial = 0; radial < radialSegments; radial += 1) {
    center.add(point.fromBufferAttribute(position, section * stride + radial));
  }
  return center.multiplyScalar(1 / radialSegments);
}

function mergedLeafCenters(asset) {
  const centers = new Map();
  const point = new THREE.Vector3();
  for (const branchId of BRANCH_IDS) {
    const geometry = asset.runtime.meshes.get(`${branchId}-foliage`).geometry;
    if (geometry.userData.representation !== "merged-leaf-solids") continue;
    const stride = geometry.userData.verticesPerElement;
    const position = geometry.getAttribute("position");
    const values = [];
    for (let element = 0; element < geometry.userData.foliageElements; element += 1) {
      const center = new THREE.Vector3();
      for (let local = 0; local < stride; local += 1) {
        center.add(point.fromBufferAttribute(position, element * stride + local));
      }
      values.push(center.multiplyScalar(1 / stride));
    }
    centers.set(branchId, values);
  }
  return centers;
}

function matchedLeafCenterDelta(assetA, assetB) {
  const centersA = mergedLeafCenters(assetA);
  const centersB = mergedLeafCenters(assetB);
  let maximum = 0;
  for (const branchId of BRANCH_IDS) {
    const a = centersA.get(branchId);
    const b = centersB.get(branchId);
    assert.equal(a.length, b.length);
    for (let index = 0; index < a.length; index += 1) {
      maximum = Math.max(maximum, a[index].distanceTo(b[index]));
    }
  }
  return maximum;
}

function assertAttachmentCoincidence(asset) {
  asset.root.updateMatrixWorld(true);
  const childWorld = new THREE.Vector3();
  const socketWorld = new THREE.Vector3();
  for (const [id, attachment] of asset.runtime.attachmentContracts) {
    const child = asset.runtime.nodes.get(id);
    const parent = asset.runtime.nodes.get(attachment.parentId);
    const rootSocket = asset.runtime.sockets.get(attachment.parentSocketId);
    const tipSocket = asset.runtime.sockets.get(`${id}-tip-socket`);
    assert.equal(attachment.recordType, "SculptAttachmentInput");
    assert.equal(attachment.claimStatus, "authoring-input");
    assert.equal(attachment.solverAuthority, false);
    assert.match(attachment.sourceRevision, /potted-bonsai-authored-grammar-v2/);
    const livePrefix = `${TARGET_ID}.instance/${asset.runtime.instanceId}/generation-${asset.runtime.instanceGeneration}`;
    assert.equal(attachment.localFrame.frameId, `${livePrefix}.attachment-frame/${id}`);
    assert.equal(attachment.localFrame.parentFrameId, `${livePrefix}.entity-frame/${attachment.parentId}`);
    assert.equal(attachment.localFrame.targetSemanticFrameId, `${TARGET_ID}.attachment-frame/${id}`);
    assert.equal(attachment.localFrame.targetSemanticParentFrameId, `${TARGET_ID}.entity-frame/${attachment.parentId}`);
    assert.equal(attachment.localFrame.units, asset.runtime.lengthUnit);
    assert.equal(child.parent, parent);
    assert.equal(rootSocket.parent, parent);
    assert.equal(tipSocket.parent, child);
    assert(child.position.distanceTo(rootSocket.position) < 1e-12, `${id} pivot and root socket diverged locally`);
    assert(child.position.distanceTo(new THREE.Vector3(...attachment.localFrame.positionMeters)) < 1e-12);
    assert(tipSocket.position.distanceTo(new THREE.Vector3(...attachment.localEndMeters)) < 1e-12);
    const geometry = asset.runtime.meshes.get(`${id}-surface`).geometry;
    assert(ringCenter(geometry, 0).distanceTo(new THREE.Vector3(...attachment.localStartMeters)) < 1e-6);
    assert(ringCenter(geometry, geometry.userData.sections).distanceTo(new THREE.Vector3(...attachment.localEndMeters)) < 1e-6);
    child.getWorldPosition(childWorld);
    rootSocket.getWorldPosition(socketWorld);
    assert(childWorld.distanceTo(socketWorld) < 1e-10, `${id} pivot detached from its root socket`);
  }
}

function geometryDigest(asset) {
  const hash = createHash("sha256");
  for (const id of [...asset.runtime.meshes.keys()].sort()) {
    const mesh = asset.runtime.meshes.get(id);
    hash.update(id);
    const position = mesh.geometry.getAttribute("position")?.array;
    if (position) hash.update(new Uint8Array(position.buffer, position.byteOffset, position.byteLength));
    const index = mesh.geometry.index?.array;
    if (index) hash.update(new Uint8Array(index.buffer, index.byteOffset, index.byteLength));
  }
  return hash.digest("hex");
}

function selectedGeometryDigest(asset, ids) {
  const hash = createHash("sha256");
  for (const id of [...ids].sort()) {
    const mesh = asset.runtime.meshes.get(id);
    hash.update(id);
    const position = mesh.geometry.getAttribute("position")?.array;
    if (position) hash.update(new Uint8Array(position.buffer, position.byteOffset, position.byteLength));
    const index = mesh.geometry.index?.array;
    if (index) hash.update(new Uint8Array(index.buffer, index.byteOffset, index.byteLength));
  }
  return hash.digest("hex");
}

function geometryCounts(asset) {
  let vertices = 0;
  let triangles = 0;
  for (const mesh of asset.runtime.meshes.values()) {
    const position = mesh.geometry.getAttribute("position");
    vertices += position?.count ?? 0;
    triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : (position?.count ?? 0) / 3;
  }
  return { vertices, triangles };
}

function assertProtectedContract(asset) {
  for (const id of TARGET_CONTRACT.protectedNodeIds) {
    assert(asset.runtime.nodes.has(id), `missing protected node ${id}`);
  }
  for (const id of TARGET_CONTRACT.protectedSocketIds) {
    assert(asset.runtime.sockets.has(id), `missing protected socket ${id}`);
  }
  for (const id of TARGET_CONTRACT.protectedColliderIds) {
    assert(asset.runtime.colliders.has(id), `missing protected collider ${id}`);
  }
  for (const id of TARGET_CONTRACT.protectedDestructionGroupIds) {
    assert(asset.runtime.destructionGroups.has(id), `missing destruction group ${id}`);
  }
}

const sampledColliderLowerBounds = Object.fromEntries(TARGET_CONTRACT.protectedColliderIds.map((id) => [id, 0]));
let observedMatchedLeafCenterDelta = 0;
const tierAssets = TARGET_CONTRACT.tierIds.map((tier) => createPottedBonsai({ tier, seed: 0x5eed }));
try {
  assert.equal(TARGET_ID, "potted-bonsai");
  assert.deepEqual(TARGET_CONTRACT.modes, ["final", "blockout", "hierarchy", "materials", "action-ready"]);
  assert.deepEqual(TARGET_CONTRACT.seedPolicy, {
    domain: "uint32",
    minimum: 0,
    maximum: 0xffffffff,
    outsideDomain: "reject",
    normalization: "none",
  });
  for (const invalidSeed of [-1, 0x100000000, 1.5, NaN, Infinity, "1"]) {
    assert.throws(() => createPottedBonsai({ seed: invalidSeed }), /uint32/);
  }
  assert.throws(() => createPottedBonsai({ continuityToken: "token-without-instance" }), /requires an explicit instanceId/);

  const boundarySeeds = [0, 1, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff]
    .map((seed) => createPottedBonsai({ tier: "minimum", seed }));
  try {
    assert.deepEqual(boundarySeeds.map((asset) => asset.runtime.seed), [0, 1, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff]);
  } finally {
    for (const asset of boundarySeeds) asset.dispose();
  }

  for (const asset of tierAssets) {
    assertProtectedContract(asset);
    assertAttachmentCoincidence(asset);
    assert.equal(asset.contract, TARGET_CONTRACT);
    assert.equal(asset.runtime.nodes.get("root").name, "root");
    assert.equal(asset.root.userData.targetId, TARGET_ID);
    assert.equal(asset.runtime.lengthUnit, "metre");
    assert.equal(asset.runtime.nodes.get("trunk-surface").geometry.userData.writer, "rotation-minimizing-oriented-rings");
    assert.equal(asset.runtime.physicsMaterials.size, 3);
    for (const [id, mesh] of asset.runtime.meshes) {
      if (mesh.geometry.userData.writer === "rotation-minimizing-oriented-rings") {
        assertOutwardFaces(mesh.geometry, `${asset.runtime.tier}/${id}`, { minAlignment: 0.9 });
        assertClosedAfterDeclaredSeamWeld(mesh.geometry, `${asset.runtime.tier}/${id}`);
        assert.equal(mesh.geometry.getAttribute("position").count, mesh.geometry.userData.expectedVertices);
        assert.equal(mesh.geometry.index.count / 3, mesh.geometry.userData.expectedTriangles);
      } else if (mesh.geometry.userData.writer === "closed-pole-ring-ellipsoid") {
        assertOutwardFaces(mesh.geometry, `${asset.runtime.tier}/${id}`, { closed: true });
        assert.equal(mesh.geometry.getAttribute("position").count, mesh.geometry.userData.expectedVertices);
        assert.equal(mesh.geometry.index.count / 3, mesh.geometry.userData.expectedTriangles);
      } else if (mesh.geometry.userData.writer === "merged-closed-leaf-octahedra") {
        assertMergedLeafSolids(mesh.geometry, `${asset.runtime.tier}/${id}`);
      }
    }
    for (const collider of asset.runtime.colliders.values()) {
      assert.equal(collider.claimStatus, "authoring-input");
      assert.equal(collider.solverAuthority, false);
      assert.equal(collider.shape.units, "metre");
      assert.equal(collider.validity.visualLodIndependent, true);
    }
    for (const colliderId of TARGET_CONTRACT.protectedColliderIds) {
      const collider = asset.runtime.colliders.get(colliderId);
      const sampledLowerBound = sampledColliderDeviation(asset, colliderId);
      sampledColliderLowerBounds[colliderId] = Math.max(sampledColliderLowerBounds[colliderId], sampledLowerBound);
      assert(
        collider.approximationError.maxSurfaceDeviationMeters + 1e-6 >= sampledLowerBound,
        `${asset.runtime.tier}/${colliderId} claims ${collider.approximationError.maxSurfaceDeviationMeters}m below sampled ${sampledLowerBound}m`,
      );
    }
    for (const [colliderId, meshId] of [
      ["trunk-capsule", "trunk-surface"],
      ["branch-left-capsule", "branch-left-surface"],
      ["branch-right-capsule", "branch-right-surface"],
      ["branch-back-capsule", "branch-back-surface"],
    ]) {
      const collider = asset.runtime.colliders.get(colliderId);
      const geometry = asset.runtime.meshes.get(meshId).geometry;
      assert(ringCenter(geometry, 0).distanceTo(new THREE.Vector3(...collider.shape.startMeters)) < 1e-6);
      assert(ringCenter(geometry, geometry.userData.sections).distanceTo(new THREE.Vector3(...collider.shape.endMeters)) < 1e-6);
    }
    assert.equal(asset.runtime.motionContract.kind, "deterministic-authored-rooted-sway-preview");
    assert.equal(asset.runtime.motionContract.solverAuthority, false);
    assert.equal(asset.runtime.motionContract.environmentForcingConsumed, false);
    assert.equal(asset.runtime.actionReadiness.solverAuthority, false);
    assert.match(asset.runtime.actionReadiness.scope.implementation, /authored deterministic bonsai branching grammar/);
    for (const groupId of TARGET_CONTRACT.protectedDestructionGroupIds) {
      const contract = asset.runtime.destructionContracts.get(groupId);
      assert(contract, `missing destruction contract ${groupId}`);
      assert.equal(contract.recordType, "AuthoredFractureGroupInput");
      assert.equal(contract.claimStatus, "authoring-input");
      assert.equal(contract.solverAuthority, false);
      assert.match(contract.sourceRevision, /potted-bonsai-authored-grammar-v2/);
      assert.deepEqual(contract.members, asset.runtime.destructionGroups.get(groupId));
      if (groupId.startsWith("fracture.")) {
        const branchId = groupId.slice("fracture.".length);
        const livePrefix = `${TARGET_ID}.instance/${asset.runtime.instanceId}/generation-${asset.runtime.instanceGeneration}`;
        assert(asset.runtime.sockets.has(contract.seam.socketId));
        assert.equal(contract.seam.localFrameId, `${livePrefix}.attachment-frame/${branchId}`);
        assert.equal(contract.seam.targetSemanticFrameId, `${TARGET_ID}.attachment-frame/${branchId}`);
        assert.equal(contract.releasePolicy.automaticRelease, false);
        assert.equal(contract.releasePolicy.breakImpulseNewtonSeconds, null);
        assert.equal(contract.releasePolicy.thresholdStatus, "blocked-insufficient-evidence");
      }
    }
  }

  for (let index = 1; index < tierAssets.length; index += 1) {
    assert.deepEqual(normalizedColliderSnapshot(tierAssets[0]), normalizedColliderSnapshot(tierAssets[index]));
  }

  const summaries = tierAssets.map(geometryCounts);
  assert(summaries[0].triangles > summaries[1].triangles);
  assert(summaries[1].triangles > summaries[2].triangles);
  assert(summaries[0].vertices > summaries[1].vertices);
  assert(summaries[1].vertices > summaries[2].vertices);
  assert(TARGET_CONTRACT.tiers.full.leafCount > TARGET_CONTRACT.tiers.budgeted.leafCount);
  assert(TARGET_CONTRACT.tiers.budgeted.leafCount > TARGET_CONTRACT.tiers.minimum.leafCount);
  assert.equal(TARGET_CONTRACT.tiers.minimum.canopyClusterCount, 6);
  assert.equal(tierAssets[2].runtime.foliageContract.representation, "opaque-canopy-cluster");
  for (const id of BRANCH_IDS) {
    assert.equal(tierAssets[2].runtime.meshes.get(`${id}-foliage`).geometry.userData.alphaSortedFragments, 0);
  }

  const liveA = createPottedBonsai({
    tier: "minimum",
    seed: 7,
    instanceId: "bonsai-live-a",
    continuityToken: "continuity-a",
  });
  const liveB = createPottedBonsai({
    tier: "minimum",
    seed: 7,
    instanceId: "bonsai-live-b",
    continuityToken: "continuity-b",
  });
  const firstGeneration = liveA.runtime.instanceGeneration;
  const firstAttachmentFrame = liveA.runtime.attachmentContracts.get("branch-left").localFrame.frameId;
  const firstSemanticAttachmentFrame = liveA.runtime.attachmentContracts.get("branch-left").localFrame.targetSemanticFrameId;
  const firstEffectiveContinuityToken = liveA.runtime.identityContinuity.effectiveToken;
  try {
    assert.equal(liveA.runtime.identityContinuity.baseToken, "continuity-a");
    assert.equal(JSON.parse(firstEffectiveContinuityToken).sourceRevision, "potted-bonsai-authored-grammar-v2");
    assert.equal(JSON.parse(firstEffectiveContinuityToken).seed, 7);
    assert.notDeepEqual(liveA.runtime.runtimeId, liveB.runtime.runtimeId);
    assert.notDeepEqual(liveA.runtime.entityIds.get("branch-left"), liveB.runtime.entityIds.get("branch-left"));
    assert.notDeepEqual(liveA.runtime.colliders.get("branch-left-capsule").colliderId, liveB.runtime.colliders.get("branch-left-capsule").colliderId);
    assert.notEqual(
      liveA.runtime.attachmentContracts.get("branch-left").localFrame.frameId,
      liveB.runtime.attachmentContracts.get("branch-left").localFrame.frameId,
    );
    assert.notEqual(
      liveA.runtime.destructionContracts.get("fracture.branch-left").seam.localFrameId,
      liveB.runtime.destructionContracts.get("fracture.branch-left").seam.localFrameId,
    );
    assert.deepEqual(liveA.runtime.targetSemanticEntityIds.get("branch-left"), liveB.runtime.targetSemanticEntityIds.get("branch-left"));
    assert.equal(
      liveA.runtime.attachmentContracts.get("branch-left").localFrame.targetSemanticFrameId,
      liveB.runtime.attachmentContracts.get("branch-left").localFrame.targetSemanticFrameId,
    );
    assert.equal(
      liveA.runtime.destructionContracts.get("fracture.branch-left").seam.targetSemanticFrameId,
      liveB.runtime.destructionContracts.get("fracture.branch-left").seam.targetSemanticFrameId,
    );
    assert.throws(() => createPottedBonsai({
      instanceId: "bonsai-live-a",
      continuityToken: "continuity-a",
    }), /already live/);
  } finally {
    liveA.dispose();
    liveB.dispose();
  }

  const resumed = createPottedBonsai({
    tier: "full",
    seed: 7,
    instanceId: "bonsai-live-a",
    continuityToken: "continuity-a",
  });
  try {
    assert.equal(resumed.runtime.instanceGeneration, firstGeneration);
    assert.equal(resumed.runtime.continuityStatus, "explicit-continuity-preserved");
    assert.equal(resumed.runtime.identityContinuity.effectiveToken, firstEffectiveContinuityToken);
    assert.equal(resumed.runtime.identityContinuity.visualTierAffectsGeneration, false);
    assert.equal(resumed.runtime.attachmentContracts.get("branch-left").localFrame.frameId, firstAttachmentFrame);
    assert.equal(resumed.runtime.attachmentContracts.get("branch-left").localFrame.targetSemanticFrameId, firstSemanticAttachmentFrame);
  } finally {
    resumed.dispose();
  }

  const replaced = createPottedBonsai({
    tier: "minimum",
    seed: 8,
    instanceId: "bonsai-live-a",
    continuityToken: "continuity-a",
  });
  try {
    assert.equal(replaced.runtime.instanceGeneration, firstGeneration + 1);
    assert.equal(replaced.runtime.continuityStatus, "explicit-continuity-changed-new-generation");
    assert.notEqual(replaced.runtime.identityContinuity.effectiveToken, firstEffectiveContinuityToken);
    assert.equal(replaced.runtime.identityContinuity.baseToken, "continuity-a");
    assert.equal(replaced.runtime.identityContinuity.changedSeedOrSourceRequiresNewGeneration, true);
    assert.notEqual(replaced.runtime.attachmentContracts.get("branch-left").localFrame.frameId, firstAttachmentFrame);
    assert.equal(replaced.runtime.attachmentContracts.get("branch-left").localFrame.targetSemanticFrameId, firstSemanticAttachmentFrame);
  } finally {
    replaced.dispose();
  }

  const sameA = createPottedBonsai({ tier: "full", seed: 91 });
  const sameB = createPottedBonsai({ tier: "full", seed: 91 });
  const different = createPottedBonsai({ tier: "full", seed: 92 });
  const minimumA = createPottedBonsai({ tier: "minimum", seed: 91 });
  const minimumB = createPottedBonsai({ tier: "minimum", seed: 92 });
  try {
    assert.equal(geometryDigest(sameA), geometryDigest(sameB));
    assert.notEqual(geometryDigest(sameA), geometryDigest(different));
    assert.deepEqual([...sameA.runtime.nodes.keys()], [...different.runtime.nodes.keys()]);
    assert.deepEqual([...sameA.runtime.colliders.keys()], [...different.runtime.colliders.keys()]);
    assert.deepEqual(normalizedColliderSnapshot(sameA), normalizedColliderSnapshot(different));
    assert.equal(
      selectedGeometryDigest(sameA, ["pot-body", "pot-rim", "pot-foot", "soil"]),
      selectedGeometryDigest(different, ["pot-body", "pot-rim", "pot-foot", "soil"]),
    );
    assert.equal(
      selectedGeometryDigest(minimumA, BRANCH_IDS.map((id) => `${id}-foliage`)),
      selectedGeometryDigest(minimumB, BRANCH_IDS.map((id) => `${id}-foliage`)),
    );
    for (const asset of [sameA, different]) {
      for (const [id, mesh] of asset.runtime.meshes) {
        if (mesh.geometry.userData.writer === "rotation-minimizing-oriented-rings") {
          assertOutwardFaces(mesh.geometry, `${asset.runtime.seed}/${id}`, { minAlignment: 0.9 });
          assertClosedAfterDeclaredSeamWeld(mesh.geometry, `${asset.runtime.seed}/${id}`);
        }
      }
    }

    const maxMatchedCenterDelta = matchedLeafCenterDelta(sameA, different);
    observedMatchedLeafCenterDelta = Math.max(observedMatchedLeafCenterDelta, maxMatchedCenterDelta);
    assert(
      maxMatchedCenterDelta <= TARGET_CONTRACT.boundedSeedVariation.matchedLeafCenterDeltaMeters + 1e-6,
      `matched leaf-center delta ${maxMatchedCenterDelta} exceeds contract`,
    );

    const rotationsAtRest = sameA.runtime.previewMotionBindings.map(({ node }) => node.rotation.toArray());
    const rootAnchorAtRest = sameA.runtime.sockets.get("root-anchor").getWorldPosition(sameA.root.position.clone()).toArray();
    assertAttachmentCoincidence(sameA);
    sameA.setMode("action-ready");
    sameA.setTime(2.5);
    assert(sameA.runtime.previewMotionBindings.some(({ node }, index) =>
      node.rotation.toArray().some((value, axis) => value !== rotationsAtRest[index][axis])));
    assertAttachmentCoincidence(sameA);
    sameA.setTime(0);
    assert.deepEqual(sameA.runtime.previewMotionBindings.map(({ node }) => node.rotation.toArray()), rotationsAtRest);
    assertAttachmentCoincidence(sameA);
    assert.deepEqual(sameA.runtime.sockets.get("root-anchor").getWorldPosition(sameA.root.position.clone()).toArray(), rootAnchorAtRest);
    sameA.setTime(3.5);
    sameA.setTime(7.5, false);
    assert.deepEqual(sameA.runtime.previewMotionBindings.map(({ node }) => node.rotation.toArray()), rotationsAtRest);
  } finally {
    sameA.dispose();
    sameB.dispose();
    different.dispose();
    minimumA.dispose();
    minimumB.dispose();
  }

  const seedCorpus = [0, 1, 2, 17, 91, 92, 255, 4095, 65535, 0x7fffffff, 0xffffffff]
    .map((seed) => createPottedBonsai({ tier: "full", seed }));
  try {
    for (const asset of seedCorpus) {
      for (const colliderId of TARGET_CONTRACT.protectedColliderIds) {
        const collider = asset.runtime.colliders.get(colliderId);
        const sampledLowerBound = sampledColliderDeviation(asset, colliderId);
        sampledColliderLowerBounds[colliderId] = Math.max(sampledColliderLowerBounds[colliderId], sampledLowerBound);
        assert(collider.approximationError.maxSurfaceDeviationMeters + 1e-6 >= sampledLowerBound);
      }
    }
    for (let a = 0; a < seedCorpus.length; a += 1) {
      for (let b = a + 1; b < seedCorpus.length; b += 1) {
        const delta = matchedLeafCenterDelta(seedCorpus[a], seedCorpus[b]);
        observedMatchedLeafCenterDelta = Math.max(observedMatchedLeafCenterDelta, delta);
        assert(
          delta <= TARGET_CONTRACT.boundedSeedVariation.matchedLeafCenterDeltaMeters + 1e-6,
          `seed-corpus matched leaf-center delta ${delta} exceeds contract`,
        );
      }
    }
  } finally {
    for (const asset of seedCorpus) asset.dispose();
  }
} finally {
  for (const asset of tierAssets) asset.dispose();
}

console.log("potted-bonsai contract: ok", JSON.stringify({
  tierTriangles: tierAssets.map((asset) => geometryCounts(asset).triangles),
  sampledColliderLowerBounds,
  observedMatchedLeafCenterDelta,
}));
