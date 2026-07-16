import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { summarizeSculptRuntime } from "../../../shared/sculpt-runtime.js";
import {
  TARGET_CONTRACT,
  TARGET_ID,
  TARGET_TITLE,
  buildArticulatedDeskLampContinuitySignature,
  createArticulatedDeskLamp,
} from "./articulated-desk-lamp-factory.js";

const EPSILON = 1e-8;

function assertVectorClose(actual, expected, tolerance = EPSILON, label = "vector") {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `${label}[${index}] expected ${expected[index]}, received ${actual[index]}`,
    );
  }
}

function localPose(model) {
  return {
    yaw: model.runtime.nodes.get("base-yaw-pivot").rotation.y,
    shoulder: model.runtime.nodes.get("shoulder-hinge-pivot").rotation.z,
    elbow: model.runtime.nodes.get("elbow-hinge-pivot").rotation.z,
    shade: model.runtime.nodes.get("shade-hinge-pivot").rotation.z,
  };
}

function assertPoseClose(actual, expected, tolerance = EPSILON, label = "pose") {
  for (const channel of ["yaw", "shoulder", "elbow", "shade"]) {
    assert.ok(
      Math.abs(actual[channel] - expected[channel]) <= tolerance,
      `${label}.${channel} expected ${expected[channel]}, received ${actual[channel]}`,
    );
  }
}

function assertPoseInsideConstraints(model) {
  const constraintByChannel = {
    yaw: "base-yaw-hinge-constraint",
    shoulder: "shoulder-hinge-constraint",
    elbow: "elbow-hinge-constraint",
    shade: "shade-hinge-constraint",
  };
  const pose = localPose(model);
  for (const [channel, id] of Object.entries(constraintByChannel)) {
    const constraint = model.runtime.constraints.get(id);
    const minimum = constraint.angularLimit.minimum.value;
    const maximum = constraint.angularLimit.maximum.value;
    assert.ok(pose[channel] >= minimum - EPSILON, `${channel} fell below its hinge limit`);
    assert.ok(pose[channel] <= maximum + EPSILON, `${channel} exceeded its hinge limit`);
  }
}

function weldedBoundaryEdgeCount(geometry, quantum = 1e-7) {
  const position = geometry.getAttribute("position");
  const canonicalVertexIds = new Map();
  const vertexToCanonical = [];
  for (let index = 0; index < position.count; index += 1) {
    const key = [position.getX(index), position.getY(index), position.getZ(index)]
      .map((value) => Math.round(value / quantum))
      .join(":");
    if (!canonicalVertexIds.has(key)) canonicalVertexIds.set(key, canonicalVertexIds.size);
    vertexToCanonical[index] = canonicalVertexIds.get(key);
  }
  const indices = geometry.index
    ? [...geometry.index.array]
    : Array.from({ length: position.count }, (_, index) => index);
  const edgeUses = new Map();
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = indices.slice(index, index + 3).map((vertex) => vertexToCanonical[vertex]);
    for (const [a, b] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1);
    }
  }
  return [...edgeUses.values()].filter((uses) => uses === 1).length;
}

function assertAttachmentCoincidence(model, label) {
  model.root.updateMatrixWorld(true);
  for (const [id, attachment] of model.runtime.attachments) {
    const object = [...model.runtime.meshes.values()].find(
      (mesh) => mesh.userData.sculptEntityId === attachment.childId,
    );
    const startSocket = model.runtime.sockets.get(attachment.startSocketLocalId);
    const endSocket = model.runtime.sockets.get(attachment.endSocketLocalId);
    assert.ok(object, `${label}/${id} child mesh missing`);
    assert.equal(object.parent, startSocket.parent, `${label}/${id} start parent mismatch`);
    assert.equal(object.parent, endSocket.parent, `${label}/${id} end parent mismatch`);
    assert.equal(attachment.startParentId, attachment.endParentId, `${label}/${id} parent identity mismatch`);
    assert.equal(attachment.crossJoint, false);
    assert.equal(attachment.visualBehavior, "decorative-rigid-parent-local");
    assert.equal(attachment.parentLocalFrameOnly, true);
    assert.equal(attachment.dynamicEndpointRebuild, false);
    assert.match(attachment.mechanicalSemantics, /decorative only/);
    assert.equal(attachment.mechanicalLoadAuthority, false);
    assert.ok(attachment.overlapMeters > 0);
    assert.ok(attachment.gapToleranceMeters > 0);
    assertVectorClose(startSocket.position.toArray(), attachment.localStartMeters, EPSILON, `${label}/${id}/start-local`);
    assertVectorClose(endSocket.position.toArray(), attachment.localEndMeters, EPSILON, `${label}/${id}/end-local`);
    assertVectorClose(
      object.userData.sourceDimensions.startMeters,
      attachment.localStartMeters,
      EPSILON,
      `${label}/${id}/geometry-start`,
    );
    assertVectorClose(
      object.userData.sourceDimensions.endMeters,
      attachment.localEndMeters,
      EPSILON,
      `${label}/${id}/geometry-end`,
    );
    const startFromParent = new THREE.Vector3(...attachment.localStartMeters).applyMatrix4(object.parent.matrixWorld);
    const endFromParent = new THREE.Vector3(...attachment.localEndMeters).applyMatrix4(object.parent.matrixWorld);
    const startWorld = startSocket.getWorldPosition(new THREE.Vector3());
    const endWorld = endSocket.getWorldPosition(new THREE.Vector3());
    assert.ok(startFromParent.distanceTo(startWorld) <= attachment.gapToleranceMeters, `${label}/${id} start gap`);
    assert.ok(endFromParent.distanceTo(endWorld) <= attachment.gapToleranceMeters, `${label}/${id} end gap`);
  }
}

function pointToSegmentDistance(point, start, end) {
  const a = new THREE.Vector3(...start);
  const delta = new THREE.Vector3(...end).sub(a);
  const offset = new THREE.Vector3(...point).sub(a);
  const t = THREE.MathUtils.clamp(offset.dot(delta) / delta.lengthSq(), 0, 1);
  return offset.sub(delta.multiplyScalar(t)).length();
}

function pointToProfileDistance(radial, y) {
  const start = new THREE.Vector2(0.073, -0.055);
  const end = new THREE.Vector2(0.18, -0.275);
  const delta = end.clone().sub(start);
  const offset = new THREE.Vector2(radial, y).sub(start);
  const t = THREE.MathUtils.clamp(offset.dot(delta) / delta.lengthSq(), 0, 1);
  return offset.sub(delta.multiplyScalar(t)).length();
}

function measureShadeBoundary(shapes, { angularSteps = 128, longitudinalSteps = 24 } = {}) {
  let visualToProxyMeters = 0;
  let proxyToVisualMeters = 0;
  const capsuleSurfaceDistance = (point) => Math.min(...shapes.map((shape) => Math.abs(
    pointToSegmentDistance(point, shape.startMeters, shape.endMeters) - shape.radiusMeters
  )));
  const visitVisualPoint = (point) => {
    visualToProxyMeters = Math.max(visualToProxyMeters, capsuleSurfaceDistance(point));
  };

  for (let longitudinal = 0; longitudinal <= longitudinalSteps; longitudinal += 1) {
    const u = longitudinal / longitudinalSteps;
    const y = THREE.MathUtils.lerp(-0.055, -0.275, u);
    const radius = THREE.MathUtils.lerp(0.073, 0.18, u);
    for (let angular = 0; angular < angularSteps; angular += 1) {
      const angle = (angular / angularSteps) * Math.PI * 2;
      visitVisualPoint([Math.cos(angle) * radius, y, Math.sin(angle) * radius]);
    }
  }

  const visitRotationalBand = (majorRadius, centerY, tubeRadius, crossSteps = 12) => {
    for (let cross = 0; cross < crossSteps; cross += 1) {
      const phase = (cross / crossSteps) * Math.PI * 2;
      const radius = majorRadius + Math.cos(phase) * tubeRadius;
      const y = centerY + Math.sin(phase) * tubeRadius;
      for (let angular = 0; angular < angularSteps; angular += 1) {
        const angle = (angular / angularSteps) * Math.PI * 2;
        visitVisualPoint([Math.cos(angle) * radius, y, Math.sin(angle) * radius]);
      }
    }
  };
  visitRotationalBand(0.073, -0.055, 0.006);
  visitRotationalBand(0.176, -0.275, 0.008);

  for (let radialStep = 0; radialStep <= 12; radialStep += 1) {
    const radius = THREE.MathUtils.lerp(0.03, 0.075, radialStep / 12);
    for (let angular = 0; angular < angularSteps; angular += 1) {
      const angle = (angular / angularSteps) * Math.PI * 2;
      visitVisualPoint([Math.cos(angle) * radius, -0.055, Math.sin(angle) * radius]);
    }
  }
  const visitProxyPoint = (point) => {
    proxyToVisualMeters = Math.max(
      proxyToVisualMeters,
      pointToProfileDistance(Math.hypot(point[0], point[2]), point[1]),
    );
  };
  for (const shape of shapes) {
    const start = new THREE.Vector3(...shape.startMeters);
    const end = new THREE.Vector3(...shape.endMeters);
    const axis = end.clone().sub(start).normalize();
    const reference = Math.abs(axis.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    const side = new THREE.Vector3().crossVectors(axis, reference).normalize();
    const binormal = new THREE.Vector3().crossVectors(axis, side).normalize();
    const circumferenceSteps = 24;
    for (let longitudinal = 0; longitudinal <= longitudinalSteps; longitudinal += 1) {
      const center = start.clone().lerp(end, longitudinal / longitudinalSteps);
      for (let angular = 0; angular < circumferenceSteps; angular += 1) {
        const phase = (angular / circumferenceSteps) * Math.PI * 2;
        const point = center.clone()
          .addScaledVector(side, Math.cos(phase) * shape.radiusMeters)
          .addScaledVector(binormal, Math.sin(phase) * shape.radiusMeters);
        visitProxyPoint(point.toArray());
      }
    }
    for (const [endpoint, sign] of [[start, -1], [end, 1]]) {
      for (let latitude = 0; latitude <= 8; latitude += 1) {
        const polar = (latitude / 8) * Math.PI / 2;
        for (let angular = 0; angular < circumferenceSteps; angular += 1) {
          const phase = (angular / circumferenceSteps) * Math.PI * 2;
          const direction = axis.clone().multiplyScalar(sign * Math.cos(polar))
            .addScaledVector(side, Math.sin(polar) * Math.cos(phase))
            .addScaledVector(binormal, Math.sin(polar) * Math.sin(phase));
          visitProxyPoint(endpoint.clone().addScaledVector(direction, shape.radiusMeters).toArray());
        }
      }
    }
  }
  return { visualToProxyMeters, proxyToVisualMeters };
}

function cappedCylinderSurfaceDistance(point, shape) {
  const start = new THREE.Vector3(...shape.startMeters);
  const end = new THREE.Vector3(...shape.endMeters);
  const axis = end.clone().sub(start);
  const length = axis.length();
  axis.divideScalar(length);
  const offset = new THREE.Vector3(...point).sub(start);
  const axial = offset.dot(axis);
  const radial = offset.addScaledVector(axis, -axial).length();
  const radialDelta = Math.abs(radial - shape.radiusMeters);
  const axialOutside = axial < 0 ? -axial : Math.max(0, axial - length);
  const sideDistance = Math.hypot(radialDelta, axialOutside);
  const capDistance = (capAxial) => {
    const planeDistance = Math.abs(axial - capAxial);
    return radial <= shape.radiusMeters
      ? planeDistance
      : Math.hypot(radial - shape.radiusMeters, planeDistance);
  };
  return Math.min(sideDistance, capDistance(0), capDistance(length));
}

function trianglesInEntityFrame(mesh, entity) {
  mesh.updateWorldMatrix(true, false);
  entity.updateWorldMatrix(true, false);
  const toEntity = entity.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const position = mesh.geometry.getAttribute("position");
  const indices = mesh.geometry.index
    ? [...mesh.geometry.index.array]
    : Array.from({ length: position.count }, (_, index) => index);
  const vertex = (index) => new THREE.Vector3(
    position.getX(index),
    position.getY(index),
    position.getZ(index),
  ).applyMatrix4(toEntity);
  const triangles = [];
  for (let index = 0; index < indices.length; index += 3) {
    triangles.push(new THREE.Triangle(
      vertex(indices[index]),
      vertex(indices[index + 1]),
      vertex(indices[index + 2]),
    ));
  }
  return triangles;
}

function measureNeckColliderBidirectional(
  neckMesh,
  neckEntity,
  collider,
  { triangleSubdivisions = 4, angularSteps = 128, axialSteps = 16, radialSteps = 8 } = {},
) {
  if (!collider) throw new Error("missing protected shade-neck-cylinder collider");
  assert.equal(neckMesh.geometry.type, "CylinderGeometry");
  const triangles = trianglesInEntityFrame(neckMesh, neckEntity);
  let visualToProxyMeters = 0;
  for (const triangle of triangles) {
    for (let aStep = 0; aStep <= triangleSubdivisions; aStep += 1) {
      for (let bStep = 0; bStep <= triangleSubdivisions - aStep; bStep += 1) {
        const aWeight = aStep / triangleSubdivisions;
        const bWeight = bStep / triangleSubdivisions;
        const cWeight = 1 - aWeight - bWeight;
        const point = triangle.a.clone().multiplyScalar(aWeight)
          .addScaledVector(triangle.b, bWeight)
          .addScaledVector(triangle.c, cWeight);
        visualToProxyMeters = Math.max(
          visualToProxyMeters,
          cappedCylinderSurfaceDistance(point.toArray(), collider.shape),
        );
      }
    }
  }

  const start = new THREE.Vector3(...collider.shape.startMeters);
  const end = new THREE.Vector3(...collider.shape.endMeters);
  const axis = end.clone().sub(start).normalize();
  const reference = Math.abs(axis.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3().crossVectors(axis, reference).normalize();
  const binormal = new THREE.Vector3().crossVectors(axis, side).normalize();
  let proxyToVisualMeters = 0;
  const visitProxy = (point) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (const triangle of triangles) {
      nearest = Math.min(nearest, triangle.closestPointToPoint(point, new THREE.Vector3()).distanceTo(point));
    }
    proxyToVisualMeters = Math.max(proxyToVisualMeters, nearest);
  };
  for (let axialStep = 0; axialStep <= axialSteps; axialStep += 1) {
    const center = start.clone().lerp(end, axialStep / axialSteps);
    for (let angular = 0; angular < angularSteps; angular += 1) {
      const phase = (angular / angularSteps) * Math.PI * 2;
      visitProxy(center.clone()
        .addScaledVector(side, Math.cos(phase) * collider.shape.radiusMeters)
        .addScaledVector(binormal, Math.sin(phase) * collider.shape.radiusMeters));
    }
  }
  for (const cap of [start, end]) {
    for (let radialStep = 0; radialStep <= radialSteps; radialStep += 1) {
      const radius = collider.shape.radiusMeters * radialStep / radialSteps;
      for (let angular = 0; angular < angularSteps; angular += 1) {
        const phase = (angular / angularSteps) * Math.PI * 2;
        visitProxy(cap.clone()
          .addScaledVector(side, Math.cos(phase) * radius)
          .addScaledVector(binormal, Math.sin(phase) * radius));
      }
    }
  }
  return { visualToProxyMeters, proxyToVisualMeters, triangleCount: triangles.length };
}

function assertProtectedColliderInventory(runtime, label) {
  for (const id of TARGET_CONTRACT.protectedColliderIds) {
    const collider = runtime.colliders.get(id);
    assert.ok(collider, `${label} lost protected collider ${id}`);
    assert.equal(collider.recordType, "ColliderConstructionInput");
    assert.equal(collider.solverAuthority, false);
    assert.equal(collider.shape.units, "metre");
    assert.ok(runtime.colliderIntents.has(id), `${label} lost protected collider intent ${id}`);
  }
}

function lowerApertureClearance(shapes) {
  return Math.min(...shapes.map((shape) => {
    assert.ok(Math.abs(shape.endMeters[1] + 0.275) <= EPSILON, "shade rib endpoint left aperture plane");
    return Math.hypot(shape.endMeters[0], shape.endMeters[2]) - shape.radiusMeters;
  }));
}

function assertSpringWasherSurfaceContact(model, label) {
  model.root.updateMatrixWorld(true);
  const cases = [
    ["lower-arm-tension-spring", "lower-spring-start-collar", "shoulder-hinge-washer-front", 0],
    ["lower-arm-tension-spring", "lower-spring-end-collar", "elbow-hinge-washer-front", 1],
    ["upper-arm-tension-spring", "upper-spring-start-collar", "elbow-hinge-washer-front", 0],
    ["upper-arm-tension-spring", "upper-spring-end-collar", "shade-hinge-washer-front", 1],
  ];
  for (const [springId, collarId, washerId, endpointIndex] of cases) {
    const spring = model.runtime.meshes.get(springId);
    const collar = model.runtime.meshes.get(collarId);
    const washer = model.runtime.meshes.get(washerId);
    const endpoint = endpointIndex === 0
      ? spring.userData.sourceDimensions.startMeters
      : spring.userData.sourceDimensions.endMeters;
    const endpointWorld = spring.parent.localToWorld(new THREE.Vector3(...endpoint));
    const endpointInWasher = washer.worldToLocal(endpointWorld.clone());
    const washerRadius = washer.geometry.parameters.radiusTop;
    const washerHalfDepth = washer.geometry.parameters.height / 2;
    const wireRadius = spring.geometry.parameters.radius;
    const attachment = [...model.runtime.attachments.values()].find(
      (entry) => entry.childId === spring.userData.sculptEntityId,
    );
    const radial = Math.hypot(endpointInWasher.x, endpointInWasher.z);
    const capDistance = washerHalfDepth - Math.abs(endpointInWasher.y);
    const physicalSurfaceGap = capDistance >= 0
      ? Math.max(0, capDistance - wireRadius)
      : Math.max(0, -capDistance - wireRadius);
    assert.equal(spring.userData.sourceDimensions.radiusMeters, wireRadius, `${label}/${springId} exact wire radius`);
    assert.equal(spring.geometry.userData.tubeRadiusMeters, wireRadius, `${label}/${springId} geometry wire radius`);
    assert.equal(attachment.baseRadiusMeters, wireRadius, `${label}/${springId} attachment base radius`);
    assert.equal(attachment.endRadiusMeters, wireRadius, `${label}/${springId} attachment end radius`);
    assert.ok(attachment.receivingWasherMeshIds.includes(washerId));
    assert.equal(spring.userData.springRepresentation.dynamicEndpointRebuild, false);
    assert.ok(radial + wireRadius < washerRadius, `${label}/${springId} endpoint footprint outside washer`);
    assert.ok(capDistance >= 0, `${label}/${springId} endpoint center is not embedded`);
    assert.ok(physicalSurfaceGap <= 0.001, `${label}/${springId} physical washer gap ${physicalSurfaceGap}`);
    assert.equal(collar.userData.attachmentRole, "spring-hook-collar-embedded-through-washer-face");
    assert.ok(collar.geometry.parameters.height / 2 > capDistance, `${label}/${collarId} does not cross washer face`);
  }
  if (label === "full/rest") {
    const spring = model.runtime.meshes.get("lower-arm-tension-spring");
    const washer = model.runtime.meshes.get("shoulder-hinge-washer-front");
    const mutatedEndpoint = [...spring.userData.sourceDimensions.startMeters];
    mutatedEndpoint[2] += 0.009;
    const mutatedWorld = spring.parent.localToWorld(new THREE.Vector3(...mutatedEndpoint));
    const mutatedLocal = washer.worldToLocal(mutatedWorld);
    const mutatedCapDistance = Math.abs(mutatedLocal.y) - washer.geometry.parameters.height / 2;
    const mutatedGap = Math.max(0, mutatedCapDistance - spring.geometry.parameters.radius);
    assert.ok(mutatedGap > 0.001, `spring endpoint frame-offset mutation must fail, received ${mutatedGap}`);
  }
}

assert.equal(TARGET_ID, "articulated-desk-lamp");
assert.equal(TARGET_TITLE, "Articulated Desk Lamp");
assert.deepEqual(TARGET_CONTRACT.modes, [
  "final",
  "blockout",
  "hierarchy",
  "materials",
  "action-ready",
]);
assert.deepEqual(TARGET_CONTRACT.tierIds, ["full", "budgeted", "minimum"]);

const summaries = [];
const semanticSnapshots = [];
for (const tier of TARGET_CONTRACT.tierIds) {
  const model = createArticulatedDeskLamp({ tier, seed: 17 });
  assert.equal(model.root.userData.targetId, TARGET_ID);
  assert.equal(model.contract, TARGET_CONTRACT);

  const visibleMeshes = {};
  for (const mode of TARGET_CONTRACT.modes) {
    model.setMode(mode);
    model.setTime(1.25);
    visibleMeshes[mode] = [...model.runtime.meshes.values()].filter((mesh) => mesh.visible).length;
  }
  assert.ok(visibleMeshes.blockout < visibleMeshes.final, `${tier} blockout must remove meso/micro detail`);

  for (const id of TARGET_CONTRACT.protectedComponentIds) {
    assert.ok(model.runtime.nodes.has(id), `${tier} lost protected component ${id}`);
  }
  for (const id of TARGET_CONTRACT.protectedSocketIds) {
    assert.ok(model.runtime.sockets.has(id), `${tier} lost protected socket ${id}`);
  }
  assertProtectedColliderInventory(model.runtime, tier);
  for (const id of TARGET_CONTRACT.protectedDestructionGroupIds) {
    assert.ok(model.runtime.destructionGroups.has(id), `${tier} lost destruction group ${id}`);
  }

  for (const mode of TARGET_CONTRACT.modes) {
    assert.equal(model.runtime.diagnosticCoverageByMode.get(mode).complete, true, `${tier}/${mode} diagnostic coverage`);
  }

  const constraintExpectations = {
    "base-yaw-hinge-constraint": {
      parent: "base-pivot",
      child: "base-yaw-pivot",
      anchor: [-0.095, 0.078, -0.01],
      axis: [0, 1, 0],
    },
    "shoulder-hinge-constraint": {
      parent: "base-yaw-pivot",
      child: "shoulder-hinge-pivot",
      anchor: [0, 0.085, 0],
      axis: [0, 0, 1],
    },
    "elbow-hinge-constraint": {
      parent: "shoulder-hinge-pivot",
      child: "elbow-hinge-pivot",
      anchor: [0.13, 0.34, 0],
      axis: [0, 0, 1],
    },
    "shade-hinge-constraint": {
      parent: "elbow-hinge-pivot",
      child: "shade-hinge-pivot",
      anchor: [0.18, 0.3, 0],
      axis: [0, 0, 1],
    },
  };
  assert.equal(model.runtime.constraints.size, 4);
  assert.deepEqual([...model.runtime.constraints.keys()], TARGET_CONTRACT.protectedConstraintIds);
  for (const [id, expected] of Object.entries(constraintExpectations)) {
    const constraint = model.runtime.constraints.get(id);
    assert.equal(constraint.recordType, "ConstraintConstructionInput");
    assert.equal(constraint.constraintId.localId, id);
    assert.equal(constraint.constraintId.generation, model.runtime.instanceGeneration);
    assert.equal(constraint.targetSemanticConstraintId.localId, id);
    assert.equal(constraint.targetSemanticConstraintId.generation, 1);
    assert.equal(constraint.parentEntityId, model.runtime.entityIds.get(expected.parent));
    assert.equal(constraint.childEntityId, model.runtime.entityIds.get(expected.child));
    assert.equal(constraint.targetSemanticParentEntityId, model.runtime.targetSemanticEntityIds.get(expected.parent));
    assert.equal(constraint.targetSemanticChildEntityId, model.runtime.targetSemanticEntityIds.get(expected.child));
    assertVectorClose(constraint.parentAnchor.positionMeters, expected.anchor, EPSILON, `${tier}/${id}/parent-anchor`);
    assertVectorClose(constraint.childAnchor.positionMeters, [0, 0, 0], EPSILON, `${tier}/${id}/child-anchor`);
    assertVectorClose(constraint.axis.vector, expected.axis, EPSILON, `${tier}/${id}/axis`);
    assert.ok(Math.abs(new THREE.Vector3(...constraint.axis.vector).length() - 1) <= EPSILON);
    assert.ok(constraint.angularLimit.minimum.value < constraint.angularLimit.maximum.value);
    assert.ok(constraint.rest.value >= constraint.angularLimit.minimum.value);
    assert.ok(constraint.rest.value <= constraint.angularLimit.maximum.value);
    assert.equal(constraint.solverAuthority, false);
    assert.equal(constraint.contactAndMotionAuthority, "none");
    assert.ok(constraint.missingEvidence.some((entry) => entry.includes("compliance")));
    assert.ok(constraint.missingEvidence.some((entry) => entry.includes("damping")));
    assert.ok(constraint.blockingRequirements.some((entry) => entry.includes("solver integration")));
    assert.ok(constraint.validity.invalidation.length >= 4);
    assert.equal(constraint.sourceRevision, TARGET_CONTRACT.sourceRevision);
  }

  const restPose = model.resetPose();
  assertPoseClose(localPose(model), restPose, EPSILON, `${tier}/explicit-reset`);
  model.setMode("action-ready");
  const animatedPose = model.setTime(2.25);
  for (const channel of ["yaw", "shoulder", "elbow", "shade"]) {
    assert.ok(Math.abs(animatedPose[channel] - restPose[channel]) >= 0.08, `${tier}/${channel} motion is not visually legible`);
  }
  assertPoseInsideConstraints(model);
  const repeatedPose = model.setTime(2.25);
  assertPoseClose(repeatedPose, animatedPose, EPSILON, `${tier}/same-time-determinism`);
  model.setTime(0.5);
  model.setTime(1.5);
  const partitionedPose = model.setTime(2.25);
  assertPoseClose(partitionedPose, animatedPose, EPSILON, `${tier}/absolute-time-partition-invariance`);
  assertAttachmentCoincidence(model, `${tier}/animated`);
  assertSpringWasherSurfaceContact(model, `${tier}/animated`);
  model.setTime(0);
  assertPoseClose(localPose(model), restPose, EPSILON, `${tier}/time-zero-reset`);
  model.setTime(8, true);
  model.setMode("materials");
  assertPoseClose(localPose(model), restPose, EPSILON, `${tier}/mode-exit-reset`);
  model.setTime(99, false);
  assertPoseClose(localPose(model), restPose, EPSILON, `${tier}/explicit-rest-branch`);
  assert.throws(() => model.setTime(Number.NaN), /seconds must be finite/);
  assert.throws(() => model.setTime(Number.POSITIVE_INFINITY), /seconds must be finite/);
  assertAttachmentCoincidence(model, `${tier}/rest`);
  assertSpringWasherSurfaceContact(model, `${tier}/rest`);

  const crown = model.runtime.meshes.get("shade-crown-annulus");
  const crownInner = model.runtime.meshes.get("shade-crown-inner-annulus");
  const crownRoll = model.runtime.meshes.get("shade-crown-roll");
  const shadeShell = model.runtime.meshes.get("shade-shell");
  assert.equal(crown.geometry.type, "RingGeometry");
  assert.equal(crown.geometry.parameters.innerRadius, 0.03);
  assert.equal(crown.geometry.parameters.outerRadius, 0.075);
  assert.equal(crownInner.geometry.type, "RingGeometry");
  assert.equal(crownInner.geometry.parameters.innerRadius, crown.geometry.parameters.innerRadius);
  assert.equal(crownInner.geometry.parameters.outerRadius, crown.geometry.parameters.outerRadius);
  assert.ok(crown.geometry.parameters.innerRadius < 0.032);
  assert.ok(crown.geometry.parameters.outerRadius > 0.073);
  assert.equal(crown.position.y, -0.055);
  assertVectorClose(crownInner.position.toArray(), crown.position.toArray(), EPSILON, `${tier}/crown-face-position`);
  assertVectorClose(
    [crownInner.rotation.x, crownInner.rotation.y, crownInner.rotation.z],
    [crown.rotation.x, crown.rotation.y, crown.rotation.z],
    EPSILON,
    `${tier}/crown-face-rotation`,
  );
  assert.ok(Math.abs(crown.rotation.x + Math.PI / 2) <= EPSILON);
  assert.equal(crown.userData.originalMaterial.side, THREE.FrontSide);
  assert.equal(crownInner.userData.originalMaterial.side, THREE.BackSide);
  assert.equal(crownInner.userData.originalMaterial.userData.pbrZoneId, "warm-enamel-reflector");
  assert.equal(crownInner.userData.topologyContract.materialSide, "BackSide");
  const crownNormal = new THREE.Vector3(0, 0, 1).applyEuler(crownInner.rotation).normalize();
  const undersideDirection = new THREE.Vector3(0, -1, 0);
  const undersideFacesBack = crownNormal.dot(undersideDirection) < 0;
  assert.equal(undersideFacesBack, true);
  assert.equal(crownInner.userData.originalMaterial.side === THREE.BackSide && undersideFacesBack, true);
  assert.equal(THREE.FrontSide === THREE.BackSide && undersideFacesBack, false, `${tier}/front-side mutation`);
  assert.equal(shadeShell.geometry.parameters.openEnded, true);
  assert.equal(shadeShell.userData.apertureContract.lowerApertureOpen, true);
  assert.equal(shadeShell.userData.apertureContract.lowerRadiusMeters, 0.18);
  assert.ok(Math.abs(
    crown.position.y
    - (shadeShell.position.y + shadeShell.geometry.parameters.height / 2)
  ) <= EPSILON);
  assert.equal(weldedBoundaryEdgeCount(crown.geometry), crown.geometry.parameters.thetaSegments * 2);
  assert.equal(weldedBoundaryEdgeCount(crownInner.geometry), crownInner.geometry.parameters.thetaSegments * 2);
  assert.equal(
    weldedBoundaryEdgeCount(shadeShell.geometry),
    shadeShell.geometry.parameters.radialSegments * 2,
  );
  assert.equal(weldedBoundaryEdgeCount(crownRoll.geometry), 0);
  assert.equal(shadeShell.userData.apertureContract.lowerPlaneYMeters, -0.275);
  assert.deepEqual(
    shadeShell.userData.apertureContract.crownClosedBy,
    ["shade-crown-annulus", "shade-crown-inner-annulus"],
  );
  assert.equal(shadeShell.userData.apertureContract.crownInteriorVisibleThroughLowerAperture, true);
  assert.ok(Math.abs(
    shadeShell.userData.apertureContract.crownPlaneYMeters
    - shadeShell.userData.apertureContract.lowerPlaneYMeters
  ) >= 0.22 - EPSILON);

  const baseMaterial = model.runtime.meshes.get("base-shell").userData.originalMaterial;
  const edgeMaterial = model.runtime.meshes.get("base-upper-bezel").userData.originalMaterial;
  const reflectorMaterial = model.runtime.meshes.get("reflector-shell").userData.originalMaterial;
  const bulbMaterial = model.runtime.meshes.get("bulb").userData.originalMaterial;
  assert.equal(baseMaterial.metalness, 0);
  assert.equal(
    baseMaterial.userData.surfaceDetailEvidenceStatus,
    TARGET_CONTRACT.materialClaims.powderCoatSurfaceDetailStatus,
  );
  assert.equal(TARGET_CONTRACT.performanceEvidence.status, "incomplete");
  assert.equal(edgeMaterial.metalness, 0);
  assert.equal(reflectorMaterial.metalness, 0);
  assert.equal(bulbMaterial.userData.pbrZoneId, "stylized-opaque-emissive-bulb");
  assert.match(bulbMaterial.userData.responseModel, /opaque emissive/);
  assert.equal(bulbMaterial.transparent, false);
  assert.equal(bulbMaterial.transmission ?? 0, 0);

  const casters = [...model.runtime.meshes.entries()]
    .filter(([, mesh]) => mesh.castShadow)
    .map(([id]) => id)
    .sort();
  assert.equal(casters.length, 13);
  assert.deepEqual(casters, [...model.root.userData.shadowPolicy.casterIds].sort());
  for (const mesh of model.runtime.meshes.values()) {
    if (mesh.userData.detailRole === "micro" || ["cable", "spring"].includes(mesh.userData.semanticGroup)) {
      assert.equal(mesh.castShadow, false, `${tier}/${mesh.name} must not cast shadows`);
      assert.equal(mesh.receiveShadow, false, `${tier}/${mesh.name} must not receive shadows`);
    }
  }
  assert.equal(model.runtime.meshes.get("reflector-shell").receiveShadow, false);
  assert.equal(model.runtime.meshes.get("bulb").castShadow, false);
  assert.equal(model.runtime.meshes.get("bulb").receiveShadow, false);

  const expectedColliderErrors = {
    "base-cylinder": 0.021,
    "lower-arm-left-capsule": 0.017,
    "lower-arm-right-capsule": 0.017,
    "upper-arm-left-capsule": 0.017,
    "upper-arm-right-capsule": 0.017,
    "shade-neck-cylinder": 0.0017,
    "bulb-trigger": 0.023,
  };
  for (const [id, expectedError] of Object.entries(expectedColliderErrors)) {
    const collider = model.runtime.colliders.get(id);
    assert.equal(collider.approximationError.maxSurfaceDeviationMeters, expectedError);
    assert.equal(model.runtime.colliderIntents.get(id).solverAuthority, false);
    assert.ok(model.runtime.colliderIntents.get(id).comparisonMeshScope.length > 0);
  }
  assert.ok(model.runtime.colliders.get("base-cylinder").approximationError.maxSurfaceDeviationMeters >= 0.015);
  for (const id of Object.keys(expectedColliderErrors).filter((value) => value.includes("arm"))) {
    assert.match(model.runtime.colliderIntents.get(id).capsuleEndpointSemantics, /hemispherical caps extend radius/);
    assert.ok(model.runtime.colliders.get(id).approximationError.maxSurfaceDeviationMeters >= 0.017);
  }
  const neckErrorContract = TARGET_CONTRACT.colliderErrorContracts["shade-neck-cylinder"];
  const neckCollider = model.runtime.colliders.get("shade-neck-cylinder");
  const neckIntent = model.runtime.colliderIntents.get("shade-neck-cylinder");
  const neckMesh = model.runtime.meshes.get("shade-neck");
  const shadeEntity = model.runtime.nodes.get("shade-hinge-pivot");
  assert.equal(neckCollider.shape.kind, neckErrorContract.shapeKind);
  assertVectorClose(neckCollider.shape.startMeters, neckErrorContract.startMeters);
  assertVectorClose(neckCollider.shape.endMeters, neckErrorContract.endMeters);
  assert.equal(neckCollider.shape.radiusMeters, neckErrorContract.radiusMeters);
  assert.equal(neckCollider.collisionRole, neckErrorContract.collisionRole);
  assert.equal(neckMesh.geometry.parameters.openEnded, false);
  assert.deepEqual(neckIntent.comparisonMeshScope, ["shade-neck"]);
  assert.match(neckIntent.proxyCapPolicy, /both endpoint disks/);
  const neckCoarse = measureNeckColliderBidirectional(
    neckMesh,
    shadeEntity,
    neckCollider,
    { triangleSubdivisions: 2, angularSteps: 64, axialSteps: 8, radialSteps: 4 },
  );
  const neckFine = measureNeckColliderBidirectional(
    neckMesh,
    shadeEntity,
    neckCollider,
    { triangleSubdivisions: 4, angularSteps: 256, axialSteps: 16, radialSteps: 8 },
  );
  const neckFineError = Math.max(neckFine.visualToProxyMeters, neckFine.proxyToVisualMeters);
  const neckConvergenceDelta = Math.max(
    Math.abs(neckFine.visualToProxyMeters - neckCoarse.visualToProxyMeters),
    Math.abs(neckFine.proxyToVisualMeters - neckCoarse.proxyToVisualMeters),
  );
  assert.equal(
    neckFine.triangleCount,
    neckMesh.geometry.parameters.radialSegments * 4,
    `${tier} capped neck triangles`,
  );
  assert.ok(
    neckFineError + neckConvergenceDelta <= neckErrorContract.declaredBidirectionalMeters,
    `${tier} neck error ${neckFineError} + convergence ${neckConvergenceDelta}`,
  );
  if (tier === "minimum") {
    assert.ok(
      neckFineError >= neckErrorContract.minimumTierSampledLowerBoundMeters,
      `minimum neck sample became suspiciously weak: ${neckFineError}`,
    );
  }
  const shadeErrorContract = TARGET_CONTRACT.colliderErrorContracts["shade-shell-ribs"];
  const shadeShapes = shadeErrorContract.colliderIds.map((id, index) => {
    const collider = model.runtime.colliders.get(id);
    const intent = model.runtime.colliderIntents.get(id);
    assert.ok(collider, `${tier} lost hollow shade boundary rib ${id}`);
    assert.equal(collider.shape.kind, "capsule");
    assert.equal(collider.shape.radiusMeters, shadeErrorContract.ribRadiusMeters);
    assert.equal(collider.collisionRole, "boundary");
    assert.equal(collider.approximationError.maxSurfaceDeviationMeters, shadeErrorContract.declaredBidirectionalMeters);
    assert.equal(intent.proxySetId, "shade-hollow-boundary");
    assert.equal(intent.ribIndex, index);
    assert.equal(intent.ribCount, shadeErrorContract.ribCount);
    assert.equal(intent.adapterCanonicalBodyCount, 1);
    assert.equal(intent.independentBroadphaseOwner, false);
    assert.equal(intent.hollowAperturePreserved, true);
    assert.equal(intent.comparisonMeshScope.includes("shade-neck"), false);
    assert.deepEqual(intent.proxySetColliderIds, shadeErrorContract.colliderIds);
    return collider.shape;
  });
  const shadeCoarse = measureShadeBoundary(shadeShapes, { angularSteps: 64, longitudinalSteps: 16 });
  const shadeFine = measureShadeBoundary(shadeShapes, { angularSteps: 256, longitudinalSteps: 32 });
  const fineBidirectional = Math.max(shadeFine.visualToProxyMeters, shadeFine.proxyToVisualMeters);
  const convergenceDelta = Math.max(
    Math.abs(shadeFine.visualToProxyMeters - shadeCoarse.visualToProxyMeters),
    Math.abs(shadeFine.proxyToVisualMeters - shadeCoarse.proxyToVisualMeters),
  );
  assert.ok(
    shadeFine.visualToProxyMeters >= shadeErrorContract.sampledVisualToProxyLowerBoundMeters,
    `${tier} shade visual-to-proxy probe became suspiciously weak`,
  );
  assert.ok(
    fineBidirectional + convergenceDelta <= shadeErrorContract.declaredBidirectionalMeters,
    `${tier} shade bidirectional error ${fineBidirectional} + convergence ${convergenceDelta}`,
  );
  assert.ok(
    lowerApertureClearance(shadeShapes) >= shadeErrorContract.lowerApertureClearRadiusMeters - EPSILON,
    `${tier} shade proxy blocks the lower aperture`,
  );
  if (tier === "full") {
    const negativeControls = {
      "missing-rib": shadeShapes.slice(1),
      "shrunken-wire": shadeShapes.map((shape) => ({ ...shape, radiusMeters: 0.003 })),
      "frame-offset": shadeShapes.map((shape) => ({
        ...shape,
        startMeters: [shape.startMeters[0] + 0.03, shape.startMeters[1], shape.startMeters[2]],
        endMeters: [shape.endMeters[0] + 0.03, shape.endMeters[1], shape.endMeters[2]],
      })),
      "unit-scale": shadeShapes.map((shape) => ({
        ...shape,
        startMeters: shape.startMeters.map((value) => value * 0.01),
        endMeters: shape.endMeters.map((value) => value * 0.01),
        radiusMeters: shape.radiusMeters * 0.01,
      })),
    };
    for (const [mutation, shapes] of Object.entries(negativeControls)) {
      const measured = measureShadeBoundary(shapes, { angularSteps: 128, longitudinalSteps: 24 });
      assert.ok(
        Math.max(measured.visualToProxyMeters, measured.proxyToVisualMeters)
          > shadeErrorContract.declaredBidirectionalMeters,
        `${mutation} must fail the shade error gate`,
      );
    }
    assert.ok(0.168 > shadeErrorContract.declaredBidirectionalMeters, "old solid lower cap mutation must fail");
  }
  const bulbIntent = model.runtime.colliderIntents.get("bulb-trigger");
  assert.equal(model.runtime.colliders.get("bulb-trigger").collisionRole, "trigger");
  assert.equal(bulbIntent.purpose, "light-emitter-proximity-volume");
  assert.equal(bulbIntent.solidContactAuthority, false);
  assert.equal(bulbIntent.visualSurfaceDeviationMeters, 0.023);

  for (const [groupId, requiredMembers] of Object.entries(TARGET_CONTRACT.destructionMembership)) {
    const actualMembers = model.runtime.destructionGroups.get(groupId);
    for (const member of requiredMembers) {
      assert.ok(actualMembers.includes(member), `${tier}/${groupId} lost destruction member ${member}`);
    }
  }

  semanticSnapshots.push({
    sockets: TARGET_CONTRACT.protectedSocketIds.map((id) => {
      const socket = model.runtime.sockets.get(id);
      return { id, parent: socket.parent.name, position: socket.position.toArray() };
    }),
    colliders: TARGET_CONTRACT.protectedColliderIds.map((id) => {
      const collider = model.runtime.colliders.get(id);
      return {
        id,
        targetSemanticColliderId: collider.targetSemanticColliderId,
        targetSemanticEntityId: collider.targetSemanticEntityId,
        shape: collider.shape,
        collisionRole: collider.collisionRole,
        errorMeters: collider.approximationError.maxSurfaceDeviationMeters,
      };
    }),
    constraints: TARGET_CONTRACT.protectedConstraintIds.map((id) => {
      const constraint = model.runtime.constraints.get(id);
      return {
        id,
        targetSemanticConstraintId: constraint.targetSemanticConstraintId,
        targetSemanticParentEntityId: constraint.targetSemanticParentEntityId,
        targetSemanticChildEntityId: constraint.targetSemanticChildEntityId,
        parentAnchor: constraint.parentAnchor.positionMeters,
        childAnchor: constraint.childAnchor.positionMeters,
        axis: constraint.axis.vector,
        limits: [constraint.angularLimit.minimum.value, constraint.angularLimit.maximum.value],
        rest: constraint.rest.value,
      };
    }),
    destruction: Object.fromEntries(
      Object.entries(TARGET_CONTRACT.destructionMembership).map(([id, members]) => [id, [...members]]),
    ),
  });

  summaries.push(summarizeSculptRuntime(model.runtime));
  const disposed = model.dispose();
  assert.ok(disposed.geometries > 0);
  assert.ok(disposed.materials > 0);
  assert.equal(model.runtime.disposed, true);
  assert.equal(model.dispose().alreadyDisposed, true);
}

assert.ok(summaries[0].triangles > summaries[1].triangles);
assert.ok(summaries[1].triangles > summaries[2].triangles);
assert.ok(summaries[0].vertices > summaries[1].vertices);
assert.ok(summaries[1].vertices > summaries[2].vertices);
assert.deepEqual(semanticSnapshots[1], semanticSnapshots[0]);
assert.deepEqual(semanticSnapshots[2], semanticSnapshots[0]);

const missingNeckColliderMutation = createArticulatedDeskLamp({ tier: "minimum", seed: 17 });
assert.equal(missingNeckColliderMutation.runtime.colliders.delete("shade-neck-cylinder"), true);
assert.throws(
  () => assertProtectedColliderInventory(missingNeckColliderMutation.runtime, "missing-neck-collider mutation"),
  /missing-neck-collider mutation lost protected collider shade-neck-cylinder/,
);
missingNeckColliderMutation.dispose();

const deterministicA = createArticulatedDeskLamp({ tier: "minimum", seed: 23 });
const deterministicB = createArticulatedDeskLamp({ tier: "minimum", seed: 23 });
assert.deepEqual(deterministicA.root.userData.seedVariation, deterministicB.root.userData.seedVariation);
const variation = deterministicA.root.userData.seedVariation;
assert.ok(Math.abs(variation.enamelHueOffset) <= 0.008);
assert.ok(Math.abs(variation.elbowRestAngleRadians) <= 0.018);
assert.ok(Math.abs(variation.shadeRestAngleRadians) <= 0.025);
deterministicA.setMode("action-ready");
deterministicB.setMode("action-ready");
deterministicA.setTime(2.25);
deterministicB.setTime(2.25);
for (const id of TARGET_CONTRACT.protectedComponentIds) {
  const first = deterministicA.runtime.nodes.get(id);
  const second = deterministicB.runtime.nodes.get(id);
  first.updateWorldMatrix(true, false);
  second.updateWorldMatrix(true, false);
  assertVectorClose(first.matrixWorld.toArray(), second.matrixWorld.toArray(), EPSILON, `same-seed/${id}/world-matrix`);
}
assert.equal(
  deterministicA.runtime.constraints.get("elbow-hinge-constraint").rest.value,
  variation.elbowRestAngleRadians,
);
assert.equal(
  deterministicA.runtime.constraints.get("shade-hinge-constraint").rest.value,
  -0.16 + variation.shadeRestAngleRadians,
);
const differentSeed = createArticulatedDeskLamp({ tier: "minimum", seed: 24 });
assert.notDeepEqual(differentSeed.root.userData.seedVariation, variation);
differentSeed.dispose();
deterministicA.dispose();
deterministicB.dispose();

assert.throws(() => createArticulatedDeskLamp({ tier: "invalid" }), /Unknown sculpt tier/);
assert.throws(() => createArticulatedDeskLamp({ seed: -1 }), /seed must be a uint32/);
assert.throws(() => createArticulatedDeskLamp({ seed: 0x100000000 }), /seed must be a uint32/);
assert.throws(() => createArticulatedDeskLamp({ seed: 1.5 }), /seed must be a uint32/);
assert.throws(() => createArticulatedDeskLamp({ continuityToken: "missing-instance" }), /requires an explicit/);

const measuredUnion = new THREE.Box3().makeEmpty();
const protocol = TARGET_CONTRACT.boundsEnvelopeMeters.sampleProtocol;
for (const tier of protocol.tiers) {
  for (const seed of protocol.seeds) {
    const model = createArticulatedDeskLamp({ tier, seed });
    const footBounds = new THREE.Box3().setFromObject(model.runtime.meshes.get("base-rubber-foot"), true);
    assert.ok(Math.abs(footBounds.min.y) <= model.root.userData.contactPlane.toleranceMeters, `${tier}/${seed} foot contact`);
    const deskContact = model.runtime.sockets
      .get("desk-contact-socket")
      .getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(deskContact.y) <= model.root.userData.contactPlane.toleranceMeters, `${tier}/${seed} socket contact`);
    assert.equal(model.runtime.colliders.get("base-cylinder").shape.startMeters[1], 0);
    model.setMode("action-ready");
    const { start, end, step } = protocol.actionReadyTimeSeconds;
    for (let seconds = start; seconds <= end + EPSILON; seconds += step) {
      model.setTime(seconds);
      assertPoseInsideConstraints(model);
      const bounds = new THREE.Box3().setFromObject(model.root, true);
      const values = [...bounds.min.toArray(), ...bounds.max.toArray()];
      assert.ok(values.every(Number.isFinite), `${tier}/${seed}/${seconds} finite bounds`);
      assert.ok(
        bounds.min.y >= TARGET_CONTRACT.boundsEnvelopeMeters.min[1] - model.root.userData.contactPlane.toleranceMeters,
        `${tier}/${seed}/${seconds} crossed desk plane`,
      );
      for (let axis = 0; axis < 3; axis += 1) {
        assert.ok(
          bounds.min.getComponent(axis) >= TARGET_CONTRACT.boundsEnvelopeMeters.min[axis] - 1e-6,
          `${tier}/${seed}/${seconds} below envelope axis ${axis}`,
        );
        assert.ok(
          bounds.max.getComponent(axis) <= TARGET_CONTRACT.boundsEnvelopeMeters.max[axis] + 1e-6,
          `${tier}/${seed}/${seconds} above envelope axis ${axis}`,
        );
      }
      measuredUnion.union(bounds);
      if (Math.abs(seconds % 15) <= EPSILON) {
        assertAttachmentCoincidence(model, `${tier}/${seed}/${seconds}`);
      }
    }
    model.dispose();
  }
}
const measuredContract = TARGET_CONTRACT.boundsEnvelopeMeters.measuredSampleUnion;
assertVectorClose(measuredUnion.min.toArray(), measuredContract.min, 2e-8, "sampled-union/min");
assertVectorClose(measuredUnion.max.toArray(), measuredContract.max, 2e-8, "sampled-union/max");
assertVectorClose(
  measuredUnion.getSize(new THREE.Vector3()).toArray(),
  measuredContract.size,
  2e-8,
  "sampled-union/size",
);
const envelopeSize = TARGET_CONTRACT.boundsEnvelopeMeters.max.map(
  (maximum, axis) => maximum - TARGET_CONTRACT.boundsEnvelopeMeters.min[axis],
);
assertVectorClose(envelopeSize, TARGET_CONTRACT.dimensionsMeters, EPSILON, "contract dimensions");

const continuityFirst = createArticulatedDeskLamp({
  tier: "minimum",
  seed: 7,
  instanceId: "lamp-contract-continuity",
  continuityToken: "chain-a",
});
const firstGeneration = continuityFirst.runtime.instanceGeneration;
const firstSignature = continuityFirst.runtime.effectiveContinuitySignature;
const parsedSignature = JSON.parse(firstSignature);
assert.deepEqual(parsedSignature, {
  schema: "sculpt-continuity-signature-v1",
  targetId: TARGET_ID,
  sourceRevision: TARGET_CONTRACT.sourceRevision,
  seed: 7,
  baseContinuityToken: "chain-a",
});
assert.equal(Object.hasOwn(parsedSignature, "tier"), false);
assert.equal(continuityFirst.runtime.continuityToken, firstSignature);
assert.equal(continuityFirst.runtime.continuityVisualContext.tier, "minimum");
assert.equal(continuityFirst.runtime.continuityVisualContext.identityAffecting, false);
assert.equal(
  continuityFirst.runtime.constraints.get("base-yaw-hinge-constraint").constraintId.generation,
  firstGeneration,
);
continuityFirst.dispose();
const continuityPreserved = createArticulatedDeskLamp({
  tier: "full",
  seed: 7,
  instanceId: "lamp-contract-continuity",
  continuityToken: "chain-a",
});
assert.equal(continuityPreserved.runtime.instanceGeneration, firstGeneration);
assert.equal(continuityPreserved.runtime.continuityStatus, "explicit-continuity-preserved");
assert.equal(continuityPreserved.runtime.effectiveContinuitySignature, firstSignature);
assert.equal(continuityPreserved.runtime.continuityVisualContext.tier, "full");
continuityPreserved.dispose();
const continuityChangedSeed = createArticulatedDeskLamp({
  tier: "minimum",
  seed: 8,
  instanceId: "lamp-contract-continuity",
  continuityToken: "chain-a",
});
assert.equal(continuityChangedSeed.runtime.instanceGeneration, firstGeneration + 1);
assert.equal(continuityChangedSeed.runtime.continuityStatus, "explicit-continuity-changed-new-generation");
assert.notEqual(continuityChangedSeed.runtime.effectiveContinuitySignature, firstSignature);
assert.equal(
  continuityChangedSeed.runtime.constraints.get("base-yaw-hinge-constraint").constraintId.generation,
  firstGeneration + 1,
);
continuityChangedSeed.dispose();
const continuityChangedBase = createArticulatedDeskLamp({
  tier: "budgeted",
  seed: 8,
  instanceId: "lamp-contract-continuity",
  continuityToken: "chain-b",
});
assert.equal(continuityChangedBase.runtime.instanceGeneration, firstGeneration + 2);
continuityChangedBase.dispose();
const changedSourceSignature = buildArticulatedDeskLampContinuitySignature({
  baseContinuityToken: "chain-a",
  seed: 7,
  sourceRevision: `${TARGET_CONTRACT.sourceRevision}-mutation`,
});
assert.notEqual(changedSourceSignature, firstSignature, "source revision mutation must change continuity identity");
assert.equal(JSON.parse(changedSourceSignature).sourceRevision, `${TARGET_CONTRACT.sourceRevision}-mutation`);

const invalidModeModel = createArticulatedDeskLamp();
assert.throws(() => invalidModeModel.setMode("invalid"), /Unknown sculpt mode/);
invalidModeModel.dispose();

console.log(JSON.stringify({
  targetId: TARGET_ID,
  routesExercised: TARGET_CONTRACT.modes.length * TARGET_CONTRACT.tierIds.length,
  measuredBounds: {
    min: measuredUnion.min.toArray(),
    max: measuredUnion.max.toArray(),
    size: measuredUnion.getSize(new THREE.Vector3()).toArray(),
  },
  summaries,
}, null, 2));
