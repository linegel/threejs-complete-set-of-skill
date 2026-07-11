import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import * as THREE from "three/webgpu";

import {
  TARGET_CONTRACT,
  TARGET_ID,
  TARGET_SOURCE_REVISION,
  buildCeramicTeapotContinuityToken,
  createCeramicTeapot,
  summarizeCeramicTeapot,
} from "./ceramic-teapot-factory.js";

function geometryDigest(asset) {
  const hash = createHash("sha256");
  for (const id of [...asset.runtime.meshes.keys()].sort()) {
    const geometry = asset.runtime.meshes.get(id).geometry;
    hash.update(id);
    const position = geometry.getAttribute("position")?.array;
    if (position) hash.update(new Uint8Array(position.buffer, position.byteOffset, position.byteLength));
    const index = geometry.index?.array;
    if (index) hash.update(new Uint8Array(index.buffer, index.byteOffset, index.byteLength));
  }
  return hash.digest("hex");
}

function identityContract(asset) {
  return {
    nodes: [...asset.runtime.nodes.keys()].sort(),
    sockets: [...asset.runtime.sockets.keys()].sort(),
    colliders: [...asset.runtime.colliders.keys()].sort(),
    destructionGroups: [...asset.runtime.destructionGroups.keys()].sort(),
  };
}

function assertVectorNear(actual, expected, epsilon = 1e-7, label = "vector") {
  assert.equal(actual.length, expected.length, `${label} length`);
  actual.forEach((value, index) => {
    assert(Math.abs(value - expected[index]) <= epsilon, `${label}[${index}] ${value} != ${expected[index]}`);
  });
}

function assertGeometryAttributes(geometry, label) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  assert(position?.count > 0, `${label} needs positions`);
  assert.equal(normal?.count, position.count, `${label} needs one normal per position`);
  for (let index = 0; index < position.count; index += 1) {
    const values = [
      position.getX(index), position.getY(index), position.getZ(index),
      normal.getX(index), normal.getY(index), normal.getZ(index),
    ];
    assert(values.every(Number.isFinite), `${label} has non-finite vertex data at ${index}`);
    const normalLength = Math.hypot(normal.getX(index), normal.getY(index), normal.getZ(index));
    assert(normalLength > 0.999 && normalLength < 1.001, `${label} normal ${index} has length ${normalLength}`);
  }
}

function assertDeclaredSeams(geometry, label) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  assert.equal(geometry.userData.uvSeam, "duplicated-0-1", `${label} seam policy`);
  assert(["u", "v"].includes(geometry.userData.seamUvComponent), `${label} seam UV component`);
  assert(geometry.userData.seamVertexPairs.length > 0, `${label} needs seam pairs`);
  for (const [first, duplicate] of geometry.userData.seamVertexPairs) {
    assertVectorNear(
      [position.getX(duplicate), position.getY(duplicate), position.getZ(duplicate)],
      [position.getX(first), position.getY(first), position.getZ(first)],
      0,
      `${label} seam position`,
    );
    assertVectorNear(
      [normal.getX(duplicate), normal.getY(duplicate), normal.getZ(duplicate)],
      [normal.getX(first), normal.getY(first), normal.getZ(first)],
      0,
      `${label} seam normal`,
    );
    const seamComponent = geometry.userData.seamUvComponent === "u" ? "X" : "Y";
    const continuousComponent = seamComponent === "X" ? "Y" : "X";
    assert.equal(uv[`get${continuousComponent}`](duplicate), uv[`get${continuousComponent}`](first), `${label} seam continuous UV component`);
    if (uv[`get${seamComponent}`](duplicate) !== uv[`get${seamComponent}`](first)) {
      assert.equal(uv[`get${seamComponent}`](first), 0, `${label} seam begins at 0`);
      assert.equal(uv[`get${seamComponent}`](duplicate), 1, `${label} seam ends at 1`);
    }
  }
}

function assertRawTriangleQuality(geometry, label) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.index;
  assert(index, `${label} must be indexed`);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const averageNormal = new THREE.Vector3();
  for (let offset = 0; offset < index.count; offset += 3) {
    const vertices = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    assert.equal(new Set(vertices).size, 3, `${label} triangle ${offset / 3} repeats an index`);
    a.fromBufferAttribute(position, vertices[0]);
    b.fromBufferAttribute(position, vertices[1]);
    c.fromBufferAttribute(position, vertices[2]);
    cross.crossVectors(edgeAB.subVectors(b, a), edgeAC.subVectors(c, a));
    assert(cross.length() > 1e-12, `${label} triangle ${offset / 3} is degenerate`);
    averageNormal.set(0, 0, 0);
    for (const vertex of vertices) {
      averageNormal.x += normal.getX(vertex);
      averageNormal.y += normal.getY(vertex);
      averageNormal.z += normal.getZ(vertex);
    }
    assert(cross.dot(averageNormal) > 1e-12, `${label} triangle ${offset / 3} winding opposes normals`);
  }
}

function analyzeWeldedTopology(geometry, weldPairs = geometry.userData.weldPairs ?? []) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.index;
  assert(index, "topology geometry must be indexed");
  const parents = Int32Array.from({ length: position.count }, (_, vertex) => vertex);
  const find = (vertex) => {
    let root = vertex;
    while (parents[root] !== root) root = parents[root];
    while (parents[vertex] !== vertex) {
      const next = parents[vertex];
      parents[vertex] = root;
      vertex = next;
    }
    return root;
  };
  const union = (first, second) => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parents[secondRoot] = firstRoot;
  };
  for (const pair of weldPairs) union(...pair);

  const edges = new Map();
  const usedVertices = new Set();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const faceCross = new THREE.Vector3();
  const averageNormal = new THREE.Vector3();

  for (let offset = 0; offset < index.count; offset += 3) {
    const raw = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    const welded = raw.map(find);
    assert.equal(new Set(raw).size, 3, `triangle ${offset / 3} repeats a raw index`);
    assert.equal(new Set(welded).size, 3, `triangle ${offset / 3} collapses after declared welding`);
    a.fromBufferAttribute(position, raw[0]);
    b.fromBufferAttribute(position, raw[1]);
    c.fromBufferAttribute(position, raw[2]);
    faceCross.crossVectors(edgeAB.subVectors(b, a), edgeAC.subVectors(c, a));
    assert(faceCross.length() > 1e-12, `triangle ${offset / 3} is geometrically degenerate`);
    averageNormal.set(0, 0, 0);
    for (const vertex of raw) {
      averageNormal.x += normal.getX(vertex);
      averageNormal.y += normal.getY(vertex);
      averageNormal.z += normal.getZ(vertex);
    }
    assert(faceCross.dot(averageNormal) > 1e-12, `triangle ${offset / 3} winding opposes authored normals`);

    for (const vertex of welded) usedVertices.add(vertex);
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      const from = welded[edgeIndex];
      const to = welded[(edgeIndex + 1) % 3];
      const lower = Math.min(from, to);
      const upper = Math.max(from, to);
      const key = `${lower}:${upper}`;
      const edge = edges.get(key) ?? { lower, upper, count: 0, directionBalance: 0 };
      edge.count += 1;
      edge.directionBalance += from === lower ? 1 : -1;
      edges.set(key, edge);
    }
  }

  const boundaryEdges = [];
  for (const edge of edges.values()) {
    assert(edge.count <= 2, `non-manifold edge ${edge.lower}:${edge.upper} appears ${edge.count} times`);
    if (edge.count === 2) assert.equal(edge.directionBalance, 0, `interior edge ${edge.lower}:${edge.upper} has inconsistent winding`);
    else boundaryEdges.push(edge);
  }

  const boundaryAdjacency = new Map();
  for (const { lower, upper } of boundaryEdges) {
    if (!boundaryAdjacency.has(lower)) boundaryAdjacency.set(lower, []);
    if (!boundaryAdjacency.has(upper)) boundaryAdjacency.set(upper, []);
    boundaryAdjacency.get(lower).push(upper);
    boundaryAdjacency.get(upper).push(lower);
  }
  let boundaryLoops = 0;
  const visited = new Set();
  for (const vertex of boundaryAdjacency.keys()) {
    if (visited.has(vertex)) continue;
    boundaryLoops += 1;
    const stack = [vertex];
    visited.add(vertex);
    while (stack.length > 0) {
      const current = stack.pop();
      const neighbors = boundaryAdjacency.get(current);
      assert.equal(neighbors.length, 2, `boundary vertex ${current} has degree ${neighbors.length}`);
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
  }

  const faces = index.count / 3;
  return Object.freeze({
    vertices: usedVertices.size,
    edges: edges.size,
    faces,
    eulerCharacteristic: usedVertices.size - edges.size + faces,
    boundaryLoops,
    boundaryEdges: boundaryEdges.length,
  });
}

function assertLatheTopology(geometry, label) {
  assert.equal(geometry.userData.semanticWriter, "semantic-indexed-lathe-v2", `${label} writer`);
  assertGeometryAttributes(geometry, label);
  assertDeclaredSeams(geometry, label);
  assert.deepEqual(geometry.userData.weldPairs, [
    ...geometry.userData.seamVertexPairs,
    ...geometry.userData.capWeldPairs,
  ]);
  const poleSet = new Set(geometry.userData.poleVertexIndices);
  assert.equal(poleSet.size, geometry.userData.poleVertexCount, `${label} pole count`);
  const position = geometry.getAttribute("position");
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    if (Math.hypot(position.getX(vertex), position.getZ(vertex)) < 1e-8) {
      assert(poleSet.has(vertex), `${label} axis vertex ${vertex} is an undeclared pole-ring duplicate`);
    }
  }
  const topology = analyzeWeldedTopology(geometry);
  assert.equal(topology.boundaryLoops, geometry.userData.expectedGeometricBoundaryLoops, `${label} boundary loops`);
  assert.equal(topology.eulerCharacteristic, geometry.userData.expectedEulerCharacteristic, `${label} Euler characteristic`);
  assert.equal(geometry.userData.revolveTopology.expectedBoundaryLoops, topology.boundaryLoops);
  assert.equal(geometry.userData.revolveTopology.expectedEulerCharacteristic, topology.eulerCharacteristic);
  return topology;
}

function assertSweepTopology(geometry, label) {
  assert.equal(geometry.userData.framePolicy, "parallel-transport-controlled", `${label} frame policy`);
  assert.deepEqual(Object.values(geometry.userData.boundaryPolicy).map(({ kind }) => kind), ["open", "open"]);
  assert.equal(geometry.userData.openBoundaryIds.length, 2, `${label} open-end IDs`);
  assertGeometryAttributes(geometry, label);
  assertDeclaredSeams(geometry, label);
  const topology = analyzeWeldedTopology(geometry);
  assert.equal(topology.boundaryLoops, 2, `${label} boundary loops`);
  assert.equal(topology.eulerCharacteristic, 0, `${label} Euler characteristic`);
  assert(geometry.userData.frameDiagnostics.minimumFrameNormalDot > 0.95, `${label} frame flipped`);
  assert(geometry.userData.frameDiagnostics.maximumOrthonormalError < 1e-12, `${label} frame lost orthonormality`);
  return topology;
}

function assertCavityTopology(asset) {
  const cavity = asset.runtime.meshes.get("body-cavity");
  const innerWall = asset.runtime.meshes.get("neck-rim-inner-wall");
  const geometry = cavity.geometry;
  assert.equal(geometry.userData.semanticWriter, "indexed-overlapped-circle-disk-v1");
  assert.deepEqual(geometry.userData.openBoundaryIds, ["body-cavity-rim-overlap"]);
  assert.equal(geometry.userData.boundaryPolicy.rim.kind, "open-overlap");
  assert.equal(geometry.userData.expectedGeometricBoundaryLoops, 1);
  assert.equal(geometry.userData.expectedEulerCharacteristic, 1);
  assert.equal(geometry.userData.weldPairs.length, 1, "CircleGeometry seam must be welded for topology analysis");
  const [first, duplicate] = geometry.userData.weldPairs[0];
  const position = geometry.getAttribute("position");
  assertVectorNear(
    [position.getX(duplicate), position.getY(duplicate), position.getZ(duplicate)],
    [position.getX(first), position.getY(first), position.getZ(first)],
    1e-8,
    "cavity CircleGeometry duplicate rim vertex",
  );
  const topology = analyzeWeldedTopology(geometry);
  assert.equal(topology.boundaryLoops, 1, "cavity must truthfully retain one geometric rim boundary");
  assert.equal(topology.eulerCharacteristic, 1, "cavity disk Euler characteristic");

  const innerPosition = innerWall.geometry.getAttribute("position");
  const innerBottomOffset = innerWall.geometry.userData.ringVertexOffsets.at(-1);
  const innerBottomRadius = Math.hypot(
    innerPosition.getX(innerBottomOffset),
    innerPosition.getZ(innerBottomOffset),
  );
  geometry.computeBoundingSphere();
  const diskRadius = geometry.boundingSphere.radius;
  const scale = asset.runtime.seedVariation.radiusScale;
  assert(diskRadius >= 0.0505 * scale, "cavity disk must extend beneath the inner wall");
  assert(diskRadius > innerBottomRadius, "cavity disk needs positive radial overlap");
  assert(cavity.position.y > 0.136, "cavity disk must vertically overlap the inner-wall bottom");
  assert(cavity.position.y < 0.159, "cavity floor must remain recessed below the mouth");
  assert(geometry.userData.overlapContract.minimumRadialOverlapMeters > 0);
  assert(geometry.userData.overlapContract.verticalOverlapMeters > 0);
  assert(Math.abs(geometry.userData.overlapContract.diskRadiusMeters - diskRadius) < 1e-7);
  return topology;
}

function nodeGraphContains(rootNode, targetNode) {
  let found = false;
  rootNode.traverse((node) => {
    if (node === targetNode) found = true;
  });
  return found;
}

function assertProceduralMaterial(material, {
  responseBundle,
  metalnessSlotUsesCause = false,
}) {
  assert.equal(material.isMeshPhysicalNodeMaterial, true);
  assert.equal(material.colorNode?.isNode, true, `${responseBundle} colorNode`);
  assert.equal(material.roughnessNode?.isNode, true, `${responseBundle} roughnessNode`);
  assert.equal(material.proceduralCauseNode?.isNode, true, `${responseBundle} live shared cause`);
  assert(nodeGraphContains(material.colorNode, material.proceduralCauseNode), `${responseBundle} color must consume the shared cause`);
  assert(nodeGraphContains(material.roughnessNode, material.proceduralCauseNode), `${responseBundle} roughness must consume the shared cause`);
  assert.equal(material.userData.proceduralPbr.responseBundle, responseBundle);
  assert.equal(material.userData.proceduralPbr.coordinateMode, "object-space-metres");
  assert.equal(material.userData.proceduralPbr.cause, "mx_noise_float-single-band");
  assert.equal(material.userData.proceduralPbr.textureSamples, 0);
  if (metalnessSlotUsesCause) {
    assert.equal(material.metalness, 1, "brass scalar identity must remain the conductor endpoint");
    assert.equal(material.metalnessNode?.isNode, true);
    assert(nodeGraphContains(material.metalnessNode, material.proceduralCauseNode), "patina mask must select conductor/dielectric identity");
    assert.equal(material.userData.proceduralPbr.conductorMetalnessEndpoint, 1);
    assert.equal(material.userData.proceduralPbr.patinaMetalnessEndpoint, 0);
  } else {
    assert.equal(material.metalness, 0, "celadon must remain dielectric");
    assert.equal(material.userData.proceduralPbr.metalnessEndpoint, 0);
    assert.equal(material.normalNode, null, "low-frequency pooling must not invent a micro-normal claim");
  }
}

function assertProceduralMaterials(asset) {
  asset.setMode("final");
  const glaze = asset.runtime.meshes.get("body-shell").material;
  const glazeEdge = asset.runtime.meshes.get("neck-band").material;
  const brass = asset.runtime.meshes.get("lid-band").material;
  assertProceduralMaterial(glaze, { responseBundle: "celadon-glaze-dielectric" });
  assertProceduralMaterial(glazeEdge, { responseBundle: "celadon-glaze-dielectric" });
  assertProceduralMaterial(brass, {
    responseBundle: "brass-conductor-with-dielectric-patina",
    metalnessSlotUsesCause: true,
  });
}

function ringCenter(mesh, ring) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const radialSegments = geometry.userData.radialSegments;
  const offset = ring * geometry.userData.ringStride;
  const center = new THREE.Vector3();
  for (let segment = 0; segment < radialSegments; segment += 1) {
    center.x += position.getX(offset + segment);
    center.y += position.getY(offset + segment);
    center.z += position.getZ(offset + segment);
  }
  return center.multiplyScalar(1 / radialSegments).applyMatrix4(mesh.matrixWorld);
}

function assertSocketTransforms(asset) {
  asset.root.updateMatrixWorld(true);
  const spout = asset.runtime.meshes.get("spout-sweep");
  const spoutLast = ringCenter(spout, spout.geometry.userData.tubularSegments);
  const spoutBefore = ringCenter(spout, spout.geometry.userData.tubularSegments - 1);
  const pourSocket = asset.runtime.sockets.get("pour-outlet-socket");
  const pourPosition = pourSocket.getWorldPosition(new THREE.Vector3());
  assert(pourPosition.distanceTo(spoutLast) < 1e-6, "pour socket must stay on the sweep outlet center");
  const pourAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(pourSocket.getWorldQuaternion(new THREE.Quaternion()));
  assert(pourAxis.dot(spoutLast.clone().sub(spoutBefore).normalize()) > 0.99, "pour socket axis must follow outlet tangent");

  const handle = asset.runtime.meshes.get("handle-sweep");
  const middleRing = handle.geometry.userData.tubularSegments / 2;
  assert(Number.isInteger(middleRing), "all handle tiers need an exact middle ring");
  const handleCenter = ringCenter(handle, middleRing);
  const handleBefore = ringCenter(handle, middleRing - 1);
  const handleAfter = ringCenter(handle, middleRing + 1);
  const gripSocket = asset.runtime.sockets.get("handle-grip-socket");
  assert(gripSocket.getWorldPosition(new THREE.Vector3()).distanceTo(handleCenter) < 1e-6, "grip socket must stay on handle centerline");
  const gripAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(gripSocket.getWorldQuaternion(new THREE.Quaternion()));
  assert(gripAxis.dot(handleAfter.sub(handleBefore).normalize()) > 0.99, "grip socket axis must follow handle tangent");
}

function sphereSurfaceDistance(point, shape) {
  return Math.abs(point.distanceTo(new THREE.Vector3(...shape.centerMeters)) - shape.radiusMeters);
}

function capsuleSurfaceDistance(point, shape) {
  const start = new THREE.Vector3(...shape.startMeters);
  const end = new THREE.Vector3(...shape.endMeters);
  const delta = end.clone().sub(start);
  const parameter = THREE.MathUtils.clamp(point.clone().sub(start).dot(delta) / delta.lengthSq(), 0, 1);
  const closest = start.addScaledVector(delta, parameter);
  return Math.abs(point.distanceTo(closest) - shape.radiusMeters);
}

function cylinderSurfaceDistance(point, shape) {
  const start = new THREE.Vector3(...shape.startMeters);
  const end = new THREE.Vector3(...shape.endMeters);
  const axis = end.clone().sub(start);
  const length = axis.length();
  axis.multiplyScalar(1 / length);
  const relative = point.clone().sub(start);
  const axial = relative.dot(axis);
  const radial = relative.addScaledVector(axis, -axial).length();
  const side = Math.hypot(radial - shape.radiusMeters, Math.max(-axial, 0, axial - length));
  const startCap = Math.hypot(Math.max(radial - shape.radiusMeters, 0), axial);
  const endCap = Math.hypot(Math.max(radial - shape.radiusMeters, 0), axial - length);
  return Math.min(side, startCap, endCap);
}

function colliderSurfaceDistance(point, shape) {
  if (shape.kind === "sphere") return sphereSurfaceDistance(point, shape);
  if (shape.kind === "capsule") return capsuleSurfaceDistance(point, shape);
  if (shape.kind === "cylinder") return cylinderSurfaceDistance(point, shape);
  throw new RangeError(`unsupported test collider ${shape.kind}`);
}

const COLLIDER_GROUPS = Object.freeze([
  Object.freeze({ id: "body", entityId: "body-pivot", colliderIds: Object.freeze(["body-envelope"]) }),
  Object.freeze({ id: "lid", entityId: "lid-pivot", colliderIds: Object.freeze(["lid-cylinder"]) }),
  Object.freeze({ id: "spout", entityId: "spout-pivot", colliderIds: Object.freeze(["spout-lower-capsule", "spout-upper-capsule"]) }),
  Object.freeze({ id: "handle", entityId: "handle-pivot", colliderIds: Object.freeze(["handle-upper-capsule", "handle-outer-capsule", "handle-lower-capsule"]) }),
]);

function isDescendantOf(object, ancestor) {
  for (let current = object; current; current = current.parent) if (current === ancestor) return true;
  return false;
}

function measureDirectedColliderDeviation(asset, group) {
  asset.setMode("final");
  asset.root.updateMatrixWorld(true);
  const entity = asset.runtime.nodes.get(group.entityId);
  const entityFromWorld = entity.matrixWorld.clone().invert();
  const colliders = group.colliderIds.map((id) => asset.runtime.colliders.get(id));
  let maximum = Object.freeze({ distance: -Infinity, meshId: null, vertex: -1 });
  const point = new THREE.Vector3();
  const entityFromMesh = new THREE.Matrix4();
  for (const meshId of [...asset.runtime.meshes.keys()].sort()) {
    const mesh = asset.runtime.meshes.get(meshId);
    if (!isDescendantOf(mesh, entity)) continue;
    entityFromMesh.multiplyMatrices(entityFromWorld, mesh.matrixWorld);
    const position = mesh.geometry.getAttribute("position");
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      point.fromBufferAttribute(position, vertex).applyMatrix4(entityFromMesh);
      const distance = Math.min(...colliders.map(({ shape }) => colliderSurfaceDistance(point, shape)));
      if (distance > maximum.distance) maximum = Object.freeze({ distance, meshId, vertex });
    }
  }
  return maximum;
}

function assertColliderDeviation(asset, ceilingOverride = null) {
  const results = {};
  for (const group of COLLIDER_GROUPS) {
    const measured = measureDirectedColliderDeviation(asset, group);
    results[group.id] = measured;
    for (const colliderId of group.colliderIds) {
      const collider = asset.runtime.colliders.get(colliderId);
      const declared = ceilingOverride ?? collider.approximationError.maxSurfaceDeviationMeters;
      assert(
        declared + 1e-8 >= measured.distance,
        `${colliderId} error ${declared} understates directed vertex lower bound ${measured.distance} at ${measured.meshId}[${measured.vertex}]`,
      );
      assert(
        collider.approximationError.maxSurfaceDeviationMeters + 1e-8
          >= TARGET_CONTRACT.physics.colliderErrorLowerBoundsMeters[colliderId],
        `${colliderId} regressed below the frozen deterministic floor`,
      );
    }
  }
  return Object.freeze(results);
}

function assertMouthAndMotion(asset) {
  const body = asset.runtime.meshes.get("body-shell");
  const innerWall = asset.runtime.meshes.get("neck-rim-inner-wall");
  const cavity = asset.runtime.meshes.get("body-cavity");
  assert.deepEqual(body.geometry.userData.openBoundaryIds, ["body-neck-mouth"]);
  assert.deepEqual(innerWall.geometry.userData.openBoundaryIds, ["neck-outer-overlap", "neck-inner-wall-bottom"]);
  assert.equal(cavity.geometry.userData.boundaryPolicy.rim.id, "body-cavity-rim-overlap");
  assert(cavity.position.y < 0.159, "cavity floor must be recessed below the mouth");
  assert.equal(cavity.userData.semanticGroup, "clay");

  const lid = asset.runtime.nodes.get("lid-pivot");
  const hingeSocket = asset.runtime.sockets.get("lid-hinge-socket");
  const detachSocket = asset.runtime.sockets.get("lid-detach-socket");
  asset.setMode("final");
  const closedDetachPosition = detachSocket.getWorldPosition(new THREE.Vector3()).toArray();
  const hingeWorld = hingeSocket.getWorldPosition(new THREE.Vector3()).toArray();
  assertVectorNear(lid.position.toArray(), TARGET_CONTRACT.motion.hingeOriginMeters, 0, "closed hinge origin");
  assertVectorNear([lid.rotation.x, lid.rotation.y, lid.rotation.z], [0, 0, 0], 0, "closed hinge rotation");

  for (const mode of TARGET_CONTRACT.modes) {
    asset.setMode(mode);
    assert.equal(asset.runtime.mode, mode);
    assertVectorNear(lid.position.toArray(), TARGET_CONTRACT.motion.hingeOriginMeters, 0, `${mode} hinge origin`);
    assert.equal(lid.rotation.x, 0, `${mode} hinge X rotation`);
    assert.equal(lid.rotation.y, 0, `${mode} hinge Y rotation`);
    if (mode === "action-ready") {
      assert(lid.rotation.z > 0.5, "action-ready must rotate about local +Z");
      assert.equal(cavity.visible, true, "action-ready must reveal the cavity");
    } else {
      assert.equal(lid.rotation.z, 0, `${mode} must reset hinge rotation`);
    }
  }

  asset.setMode("action-ready");
  asset.setTime(2.5, true);
  assertVectorNear(lid.position.toArray(), TARGET_CONTRACT.motion.hingeOriginMeters, 0, "animated hinge origin");
  assert.equal(lid.rotation.x, 0);
  assert.equal(lid.rotation.y, 0);
  assertVectorNear(hingeSocket.getWorldPosition(new THREE.Vector3()).toArray(), hingeWorld, 1e-8, "hinge socket remains fixed");

  asset.setDetached(true);
  const detachedPosition = lid.position.toArray();
  assert.equal(asset.runtime.lidDetached, true);
  assert(detachedPosition[1] > TARGET_CONTRACT.motion.hingeOriginMeters[1]);
  assert(detachedPosition[2] > TARGET_CONTRACT.motion.hingeOriginMeters[2]);
  assert.equal(lid.rotation.x, 0);
  assert.equal(lid.rotation.y, 0);
  const detachedSocketPosition = detachSocket.getWorldPosition(new THREE.Vector3()).toArray();
  assert.notDeepEqual(detachedSocketPosition, closedDetachPosition);
  asset.setTime(4, true);
  assertVectorNear(lid.position.toArray(), detachedPosition, 0, "detached pose persists while animated");
  asset.setDetached(false);
  assert.equal(asset.runtime.lidDetached, false);
  assertVectorNear(lid.position.toArray(), TARGET_CONTRACT.motion.hingeOriginMeters, 0, "reattached hinge origin");
  assertVectorNear([lid.rotation.x, lid.rotation.y, lid.rotation.z], [0, 0, 0], 0, "reattached rotation");
  assertVectorNear(detachSocket.getWorldPosition(new THREE.Vector3()).toArray(), closedDetachPosition, 1e-8, "reattached socket reset");

  lid.position.set(9, 9, 9);
  lid.rotation.set(1, 1, 1);
  asset.setMode("final");
  assertVectorNear(lid.position.toArray(), TARGET_CONTRACT.motion.hingeOriginMeters, 0, "final position reset");
  assertVectorNear([lid.rotation.x, lid.rotation.y, lid.rotation.z], [0, 0, 0], 0, "final rotation reset");
  assert.throws(() => asset.setDetached("yes"), /boolean/);
}

const tiers = TARGET_CONTRACT.tierIds.map((tier) => createCeramicTeapot({ tier, seed: 0x5eed }));
try {
  assert.equal(TARGET_ID, "ceramic-teapot");
  assert.equal(TARGET_SOURCE_REVISION, "ceramic-teapot-corpus-v3");
  assert.equal(TARGET_CONTRACT.sourceRevision, TARGET_SOURCE_REVISION);
  assert.equal(TARGET_CONTRACT.units, "metre");
  assert.deepEqual(TARGET_CONTRACT.modes, ["final", "blockout", "hierarchy", "materials", "action-ready"]);
  assert.equal(TARGET_CONTRACT.topology.latheWriter, "semantic-indexed-lathe-v2");
  assert.equal(TARGET_CONTRACT.topology.degenerateTrianglesAllowed, false);
  assert.equal(TARGET_CONTRACT.lodPolicy.tessellationOnly, true);
  assert.equal(TARGET_CONTRACT.lodPolicy.drawCountReduction, false);
  assert.equal(TARGET_CONTRACT.materialPolicy.objectSpaceProceduralVariation, true);
  assert.equal(TARGET_CONTRACT.materialPolicy.structuralBands, 1);
  assert.equal(TARGET_CONTRACT.materialPolicy.textureSamples, 0);
  assert.deepEqual(TARGET_CONTRACT.continuityPolicy.excludedVisualInputs, ["tier"]);

  const identities = tiers.map(identityContract);
  const summaries = tiers.map(({ root }) => summarizeCeramicTeapot(root));
  const latheIds = [
    "body-shell",
    "neck-rim-inner-wall",
    "foot-ring",
    "handle-upper-mount",
    "handle-lower-mount",
    "lid-surface",
    "lid-knob",
  ];
  for (const asset of tiers) {
    for (const id of TARGET_CONTRACT.protectedNodeIds) assert(asset.runtime.nodes.has(id), `missing protected node ${id}`);
    for (const id of TARGET_CONTRACT.protectedSocketIds) assert(asset.runtime.sockets.has(id), `missing protected socket ${id}`);
    for (const id of TARGET_CONTRACT.protectedColliderIds) assert(asset.runtime.colliders.has(id), `missing protected collider ${id}`);
    for (const id of TARGET_CONTRACT.protectedDestructionGroupIds) assert(asset.runtime.destructionGroups.has(id), `missing destruction group ${id}`);
    assert.equal(asset.runtime.lengthUnit, "metre");
    for (const input of asset.runtime.colliders.values()) {
      assert.equal(input.recordType, "ColliderConstructionInput");
      assert.equal(input.canonicalProxyStatus, "blocked");
      assert.equal(input.solverAuthority, false);
      assert.equal(input.shape.units, "metre");
    }

    for (const [meshId, mesh] of asset.runtime.meshes) {
      assertGeometryAttributes(mesh.geometry, meshId);
      assertRawTriangleQuality(mesh.geometry, meshId);
    }
    for (const id of latheIds) assertLatheTopology(asset.runtime.meshes.get(id).geometry, id);
    assertSweepTopology(asset.runtime.meshes.get("spout-sweep").geometry, "spout-sweep");
    assertSweepTopology(asset.runtime.meshes.get("handle-sweep").geometry, "handle-sweep");
    assertCavityTopology(asset);
    assertSocketTransforms(asset);
    assertMouthAndMotion(asset);
    assertProceduralMaterials(asset);

    const body = asset.runtime.meshes.get("body-shell");
    const originalBodyMaterial = body.userData.originalMaterial;
    asset.setMode("blockout");
    assert.notEqual(body.material, originalBodyMaterial);
    assert.equal(asset.runtime.nodes.get("body-cavity").visible, false);
    assert.equal(asset.runtime.diagnosticCoverage.complete, true);
    asset.setMode("hierarchy");
    assert.notEqual(body.material, originalBodyMaterial);
    assert.equal(asset.runtime.diagnosticCoverage.complete, true);
    asset.setMode("materials");
    assert.equal(body.material, originalBodyMaterial);
    asset.setMode("action-ready");
    assert.notEqual(body.material, originalBodyMaterial);
    assert.equal(asset.runtime.diagnosticCoverage.complete, true);
    asset.setMode("final");
    assert.equal(body.material, originalBodyMaterial);
    assert.equal(asset.runtime.nodes.get("body-cavity").visible, true);
    assertColliderDeviation(asset);
  }
  assert.deepEqual(identities[1], identities[0]);
  assert.deepEqual(identities[2], identities[0]);
  assert(summaries[0].triangles > summaries[1].triangles && summaries[1].triangles > summaries[2].triangles);
  assert(summaries[0].storedVertices > summaries[1].storedVertices && summaries[1].storedVertices > summaries[2].storedVertices);
  assert.equal(summaries[0].renderItems, summaries[1].renderItems);
  assert.equal(summaries[1].renderItems, summaries[2].renderItems);

  const sameA = createCeramicTeapot({ tier: "full", seed: 91 });
  const sameB = createCeramicTeapot({ tier: "full", seed: 91 });
  const different = createCeramicTeapot({ tier: "full", seed: 92 });
  try {
    assert.equal(geometryDigest(sameA), geometryDigest(sameB));
    assert.notEqual(geometryDigest(sameA), geometryDigest(different));
    assert.deepEqual(identityContract(sameA), identityContract(different));

    assert.deepEqual(sameA.runtime.seedVariation, sameB.runtime.seedVariation);
    assert.notDeepEqual(sameA.runtime.seedVariation, different.runtime.seedVariation);
    assert.notEqual(
      sameA.runtime.meshes.get("body-shell").material.color.getHex(),
      different.runtime.meshes.get("body-shell").material.color.getHex(),
      "different seeds must alter the actual celadon material base color",
    );
    assert(Math.abs(different.runtime.seedVariation.radiusScale - 1) <= 0.01);
    assert(Math.abs(different.runtime.seedVariation.spoutTipLift) <= 0.006);
    assert(Math.abs(different.runtime.seedVariation.lateralBias) <= 0.004);

    const foot = sameA.runtime.meshes.get("foot-ring").geometry;
    const degenerate = foot.clone();
    degenerate.index.setX(1, degenerate.index.getX(0));
    assert.throws(() => assertRawTriangleQuality(degenerate, "degenerate mutation"), /repeats|degenerate/);
    degenerate.dispose();

    const flipped = foot.clone();
    const second = flipped.index.getX(1);
    flipped.index.setX(1, flipped.index.getX(2));
    flipped.index.setX(2, second);
    assert.throws(() => analyzeWeldedTopology(flipped), /winding|inconsistent/);
    flipped.dispose();

    assert.throws(() => {
      const spout = sameA.runtime.meshes.get("spout-sweep").geometry;
      const omitted = spout.userData.seamVertexPairs[Math.floor(spout.userData.seamVertexPairs.length / 2)];
      const withoutOneSeamWeld = spout.userData.weldPairs.filter(
        ([first, duplicate]) => first !== omitted[0] || duplicate !== omitted[1],
      );
      const topology = analyzeWeldedTopology(spout, withoutOneSeamWeld);
      assert.equal(topology.boundaryLoops, spout.userData.expectedGeometricBoundaryLoops);
    }, /boundary|degree|Expected values/);
    assert.throws(() => assertColliderDeviation(sameA, 0.001), /understates directed vertex lower bound/);
  } finally {
    sameA.dispose();
    sameB.dispose();
    different.dispose();
  }

  const observedColliderFloors = { body: 0, lid: 0, spout: 0, handle: 0 };
  for (const tier of TARGET_CONTRACT.tierIds) {
    for (const seed of [0, 1121, 1956, 2567, 0x5eed]) {
      const asset = createCeramicTeapot({ tier, seed });
      try {
        const results = assertColliderDeviation(asset);
        for (const group of Object.keys(observedColliderFloors)) {
          observedColliderFloors[group] = Math.max(observedColliderFloors[group], results[group].distance);
        }
      } finally {
        asset.dispose();
      }
    }
  }
  assert(observedColliderFloors.body >= 0.06249, `body sampler became vacuous: ${observedColliderFloors.body}`);
  assert(observedColliderFloors.lid >= 0.0319, `lid sampler became vacuous: ${observedColliderFloors.lid}`);
  assert(observedColliderFloors.spout >= 0.0261, `spout sampler became vacuous: ${observedColliderFloors.spout}`);
  assert(observedColliderFloors.handle >= 0.0291, `handle sampler became vacuous: ${observedColliderFloors.handle}`);

  const baseContinuityToken = "continuity-1";
  const expectedContinuityToken = buildCeramicTeapotContinuityToken({
    baseContinuityToken,
    seed: 7,
    sourceRevision: TARGET_SOURCE_REVISION,
  });
  assert.notEqual(
    expectedContinuityToken,
    buildCeramicTeapotContinuityToken({ baseContinuityToken, seed: 8, sourceRevision: TARGET_SOURCE_REVISION }),
    "seed must participate in continuity",
  );
  assert.notEqual(
    expectedContinuityToken,
    buildCeramicTeapotContinuityToken({ baseContinuityToken, seed: 7, sourceRevision: `${TARGET_SOURCE_REVISION}-changed` }),
    "source revision must participate in continuity",
  );
  const explicit = createCeramicTeapot({ tier: "full", seed: 7, instanceId: "teapot-continuity-fixture", continuityToken: baseContinuityToken });
  const initialGeneration = explicit.runtime.instanceGeneration;
  try {
    assert.equal(explicit.runtime.instanceId, "teapot-continuity-fixture");
    assert.equal(explicit.root.userData.sculptInstanceId, "teapot-continuity-fixture");
    assert.equal(explicit.runtime.continuityToken, expectedContinuityToken);
    assert.equal(explicit.runtime.subjectContinuity.baseContinuityToken, baseContinuityToken);
    assert.throws(
      () => createCeramicTeapot({ tier: "minimum", seed: 7, instanceId: "teapot-continuity-fixture", continuityToken: baseContinuityToken }),
      /already live/,
    );
  } finally {
    explicit.dispose();
  }
  const reused = createCeramicTeapot({ tier: "minimum", seed: 7, instanceId: "teapot-continuity-fixture", continuityToken: baseContinuityToken });
  assert.equal(reused.runtime.instanceGeneration, initialGeneration);
  assert.equal(reused.runtime.continuityStatus, "explicit-continuity-preserved");
  assert.equal(reused.runtime.continuityToken, expectedContinuityToken, "visual tier must not change continuity signature");
  reused.dispose();
  const reseeded = createCeramicTeapot({ tier: "budgeted", seed: 8, instanceId: "teapot-continuity-fixture", continuityToken: baseContinuityToken });
  assert.equal(reseeded.runtime.instanceGeneration, initialGeneration + 1);
  assert.equal(reseeded.runtime.continuityStatus, "explicit-continuity-changed-new-generation");
  reseeded.dispose();
  const changedSourceRevision = `${TARGET_SOURCE_REVISION}-fixture`;
  const revised = createCeramicTeapot({
    tier: "minimum",
    seed: 8,
    instanceId: "teapot-continuity-fixture",
    continuityToken: baseContinuityToken,
    sourceRevision: changedSourceRevision,
  });
  assert.equal(revised.runtime.instanceGeneration, initialGeneration + 2);
  assert.equal(revised.runtime.continuityStatus, "explicit-continuity-changed-new-generation");
  assert.equal(revised.runtime.sourceRevision, changedSourceRevision);
  for (const collider of revised.runtime.colliders.values()) assert.equal(collider.sourceRevision, changedSourceRevision);
  revised.dispose();

  assert.throws(() => createCeramicTeapot({ tier: "unknown" }), /Unknown tier/);
  for (const invalidSeed of [-1, 0x100000000, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1", new Number(1)]) {
    assert.throws(() => createCeramicTeapot({ seed: invalidSeed }), /uint32 integer/);
    assert.throws(
      () => buildCeramicTeapotContinuityToken({ baseContinuityToken, seed: invalidSeed }),
      /uint32 integer/,
    );
  }
  const maximumSeed = createCeramicTeapot({ tier: "minimum", seed: 0xffffffff });
  assert.equal(maximumSeed.runtime.seed, 0xffffffff);
  maximumSeed.dispose();
  assert.throws(() => buildCeramicTeapotContinuityToken({ baseContinuityToken: "", seed: 1 }), /non-empty/);
  assert.throws(() => createCeramicTeapot({ sourceRevision: "" }), /non-empty/);
} finally {
  for (const asset of tiers) {
    const first = asset.dispose();
    assert.equal(first.alreadyDisposed, false);
    assert.deepEqual(asset.dispose(), { geometries: 0, materials: 0, alreadyDisposed: true });
  }
}

console.log("ceramic-teapot contract: ok");
