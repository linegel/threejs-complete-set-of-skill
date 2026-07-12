import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import {
  BOUNDARY_REASONS,
  buildFrameFixture,
  profileSampleAt,
  profileZAt,
} from "./frame-profile.js";
import {
  estimateTierBudget,
  LOD_PRESETS,
  projectTransverseErrorPixels,
  resolvePhysicalProjectionEnvelope,
} from "./lod-presets.js";
import {
  createTexturedMikkTangentFixture,
  validateTangents,
  validateTexturedMikkTangentFixture,
} from "./tangents.js";
import {
  chooseBatchingRoute,
  createBatchingDemoDescriptors,
  createRealBatchingStrategies,
  STRATEGY_IDS,
  STRATEGY_ROSTER,
} from "./batching-demo.js";
import { createIndirectFixture } from "./indirect-fixture.js";
import {
  buildBranchRingFixture,
  measureBranchApproximation,
  validateBranchFrames,
} from "./branch-rings.js";
import {
  beginDynamicUpdateFrame,
  configureDynamicGeometry,
  updateVertexRange,
  validateDynamicUpdateRecord,
} from "./dynamic-updates.js";
import { buildDynamicComponentFixture } from "./dynamic-component-fixture.js";
import { createWriter, selectIndexArrayType } from "./mesh-writer.js";

function parseArgs(argv) {
  const args = { fixture: "frame-hero", json: false, sweep: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--fixture") args.fixture = argv[index + 1];
    if (argv[index] === "--sweep") args.sweep = argv[index + 1];
    if (argv[index] === "--json") args.json = true;
  }
  return args;
}

const subtract3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a, scalar) => [a[0] * scalar, a[1] * scalar, a[2] * scalar];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length3 = (a) => Math.hypot(a[0], a[1], a[2]);
const normalize3 = (a) => scale3(a, 1 / length3(a));

function attributeVector(attribute, index, lanes = attribute.itemSize) {
  return Array.from({ length: lanes }, (_, lane) => attribute.array[index * attribute.itemSize + lane]);
}

function storedBoundsContainAllVertices(geometry, tolerance = 1e-6) {
  const position = geometry.attributes.position;
  const box = geometry.boundingBox;
  const sphere = geometry.boundingSphere;
  if (!box || !sphere) return false;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const point = attributeVector(position, vertex, 3);
    if (
      point[0] < box.min.x - tolerance || point[0] > box.max.x + tolerance ||
      point[1] < box.min.y - tolerance || point[1] > box.max.y + tolerance ||
      point[2] < box.min.z - tolerance || point[2] > box.max.z + tolerance ||
      Math.hypot(point[0] - sphere.center.x, point[1] - sphere.center.y, point[2] - sphere.center.z) > sphere.radius + tolerance
    ) return false;
  }
  return true;
}

function weldedBoundaryProof(geometry, tolerance = 1e-6) {
  const { position, normal, tangent, uv, boundaryReason, semanticSurface } = geometry.attributes;
  const groups = new Map();
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const key = attributeVector(position, vertex, 3)
      .map((value) => Math.round(value / tolerance))
      .join(":");
    const record = {
      boundary: boundaryReason.getX(vertex),
      tuple: [
        ...attributeVector(normal, vertex, 3).map((value) => value.toFixed(5)),
        ...attributeVector(tangent, vertex, 4).map((value) => value.toFixed(5)),
        ...attributeVector(uv, vertex, 2).map((value) => value.toFixed(5)),
        semanticSurface.getX(vertex),
        boundaryReason.getX(vertex),
      ].join(":"),
    };
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  let incompatibleWeldedGroups = 0;
  let claimedBoundaryVertices = 0;
  for (const records of groups.values()) {
    const claimed = records.some((record) => record.boundary !== BOUNDARY_REASONS.smoothSkin);
    if (claimed) claimedBoundaryVertices += records.length;
    if (claimed && records.length > 1 && new Set(records.map((record) => record.tuple)).size > 1) {
      incompatibleWeldedGroups += 1;
    }
  }
  return { incompatibleWeldedGroups, claimedBoundaryVertices };
}

export function auditTopology(geometry, tolerance = 1e-6) {
  const position = geometry.attributes.position;
  const topologyVertex = geometry.attributes.topologyVertex;
  const index = geometry.index;
  const expected = geometry.userData.fixture?.topology ?? null;
  const errors = [];
  if (!topologyVertex || topologyVertex.count !== position.count) {
    return {
      ok: false,
      errors: ["topologyVertex must exist for every render vertex"],
      vertices: 0,
      edges: 0,
      faces: 0,
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      orientationMismatches: 0,
      eulerCharacteristic: null,
      signedVolume: null,
    };
  }

  const authoredPositions = new Map();
  const referencedVertices = new Set();
  const edgeLedger = new Map();
  const faceLedger = new Set();
  let signedVolume6 = 0;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const topologyId = topologyVertex.getX(vertex);
    if (!Number.isInteger(topologyId) || topologyId < 0) {
      errors.push(`render vertex ${vertex} has an invalid topology id`);
      continue;
    }
    const point = attributeVector(position, vertex, 3);
    const prior = authoredPositions.get(topologyId);
    if (prior && Math.hypot(...subtract3(point, prior)) > tolerance) {
      errors.push(`topology vertex ${topologyId} has divergent render positions`);
    } else if (!prior) {
      authoredPositions.set(topologyId, point);
    }
  }

  for (let component = 0; component < index.count; component += 3) {
    const renderVertices = [
      index.getX(component),
      index.getX(component + 1),
      index.getX(component + 2),
    ];
    const topologyIds = renderVertices.map((vertex) => topologyVertex.getX(vertex));
    topologyIds.forEach((id) => referencedVertices.add(id));
    if (new Set(topologyIds).size !== 3) {
      errors.push(`triangle ${component / 3} collapses after semantic-boundary welding`);
      continue;
    }
    const faceKey = [...topologyIds].sort((a, b) => a - b).join(":");
    if (faceLedger.has(faceKey)) errors.push(`duplicate topological face ${faceKey}`);
    faceLedger.add(faceKey);
    for (const [start, end] of [
      [topologyIds[0], topologyIds[1]],
      [topologyIds[1], topologyIds[2]],
      [topologyIds[2], topologyIds[0]],
    ]) {
      const low = Math.min(start, end);
      const high = Math.max(start, end);
      const key = `${low}:${high}`;
      const entry = edgeLedger.get(key) ?? { count: 0, orientation: 0 };
      entry.count += 1;
      entry.orientation += start === low ? 1 : -1;
      edgeLedger.set(key, entry);
    }
    const [a, b, c] = renderVertices.map((vertex) => attributeVector(position, vertex, 3));
    signedVolume6 += dot3(a, cross3(b, c));
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let orientationMismatches = 0;
  for (const edge of edgeLedger.values()) {
    if (edge.count === 1) boundaryEdges += 1;
    if (edge.count > 2) nonManifoldEdges += 1;
    if (edge.count === 2 && edge.orientation !== 0) orientationMismatches += 1;
  }
  const faces = index.count / 3;
  const eulerCharacteristic = referencedVertices.size - edgeLedger.size + faces;
  if (nonManifoldEdges > 0) errors.push(`${nonManifoldEdges} topological edges have more than two incident faces`);
  if (orientationMismatches > 0) errors.push(`${orientationMismatches} shared edges have equal rather than opposite winding`);
  if (expected) {
    if (referencedVertices.size !== expected.topologyVertexCount) {
      errors.push(
        `topology vertex count ${referencedVertices.size} does not match planned ${expected.topologyVertexCount}`,
      );
    }
    if (boundaryEdges !== expected.expectedBoundaryEdgeCount) {
      errors.push(
        `topological boundary edge count ${boundaryEdges} does not match planned ${expected.expectedBoundaryEdgeCount}`,
      );
    }
    if (eulerCharacteristic !== expected.expectedEulerCharacteristic) {
      errors.push(
        `Euler characteristic ${eulerCharacteristic} does not match planned ${expected.expectedEulerCharacteristic}`,
      );
    }
    if (expected.declaredClosed && boundaryEdges !== 0) {
      errors.push("declared closed fixture contains topological boundary edges");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    vertices: referencedVertices.size,
    edges: edgeLedger.size,
    faces,
    boundaryEdges,
    nonManifoldEdges,
    orientationMismatches,
    eulerCharacteristic,
    signedVolume: signedVolume6 / 6,
  };
}

export function validateGeometry(geometry) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const tangent = geometry.attributes.tangent;
  const index = geometry.index;
  const errors = [];
  let degenerateTriangles = 0;
  let degenerateUvTriangles = 0;
  let windingMismatches = 0;
  let uvJacobianMismatches = 0;
  let uvScaleMismatches = 0;
  const uvDensities = [];
  const expectedUvDensity = geometry.userData.fixture?.expectedUvDensity ?? geometry.userData.fixture?.texelsPerWorldUnit ?? null;

  for (const attribute of [position, normal, uv, tangent, geometry.attributes.debugUv]) {
    for (const value of attribute.array) {
      if (!Number.isFinite(value)) errors.push(`${attribute.name ?? "attribute"} non-finite`);
    }
  }

  for (let component = 0; component < index.count; component += 1) {
    if (index.getX(component) >= position.count) errors.push(`index ${component} out of range`);
  }

  for (let component = 0; component < index.count; component += 3) {
    const vertices = [index.getX(component), index.getX(component + 1), index.getX(component + 2)];
    const points = vertices.map((vertex) => attributeVector(position, vertex, 3));
    const uvPoints = vertices.map((vertex) => attributeVector(uv, vertex, 2));
    const edge1 = subtract3(points[1], points[0]);
    const edge2 = subtract3(points[2], points[0]);
    const faceCross = cross3(edge1, edge2);
    const area2 = length3(faceCross);
    if (!(area2 > 1e-10)) {
      degenerateTriangles += 1;
      continue;
    }
    const faceNormal = scale3(faceCross, 1 / area2);
    for (const vertex of vertices) {
      if (!(dot3(faceNormal, attributeVector(normal, vertex, 3)) > 1e-4)) windingMismatches += 1;
    }

    const du1 = uvPoints[1][0] - uvPoints[0][0];
    const dv1 = uvPoints[1][1] - uvPoints[0][1];
    const du2 = uvPoints[2][0] - uvPoints[0][0];
    const dv2 = uvPoints[2][1] - uvPoints[0][1];
    const uvDeterminant = du1 * dv2 - dv1 * du2;
    const uvScale = Math.max(1, Math.abs(du1), Math.abs(dv1), Math.abs(du2), Math.abs(dv2));
    if (!(Math.abs(uvDeterminant) > 1e-10 * uvScale * uvScale)) {
      degenerateUvTriangles += 1;
      continue;
    }

    const dPositionDu = scale3(subtract3(scale3(edge1, dv2), scale3(edge2, dv1)), 1 / uvDeterminant);
    const dPositionDv = scale3(subtract3(scale3(edge2, du1), scale3(edge1, du2)), 1 / uvDeterminant);
    const metricU = dot3(dPositionDu, dPositionDu);
    const metricV = dot3(dPositionDv, dPositionDv);
    const metricUV = dot3(dPositionDu, dPositionDv);
    const trace = metricU + metricV;
    const discriminant = Math.sqrt(Math.max(0, (metricU - metricV) ** 2 + 4 * metricUV ** 2));
    const sigmaMax = Math.sqrt(Math.max(0, (trace + discriminant) * 0.5));
    const sigmaMin = Math.sqrt(Math.max(0, (trace - discriminant) * 0.5));
    if (!(sigmaMin > 1e-10) || !Number.isFinite(sigmaMax)) {
      degenerateUvTriangles += 1;
      continue;
    }
    const densityMin = 1 / sigmaMax;
    const densityMax = 1 / sigmaMin;
    uvDensities.push(densityMin, densityMax);
    if (expectedUvDensity !== null && (
      densityMin < expectedUvDensity * 0.4 ||
      densityMax > expectedUvDensity * 2.0
    )) uvScaleMismatches += 1;

    const uvTangent = normalize3(dPositionDu);
    const uvBitangent = normalize3(dPositionDv);
    for (const vertex of vertices) {
      const storedNormal = attributeVector(normal, vertex, 3);
      const storedTangent = attributeVector(tangent, vertex, 3);
      const reconstructedBitangent = scale3(
        cross3(storedNormal, storedTangent),
        tangent.getW(vertex),
      );
      if (
        dot3(storedTangent, uvTangent) < 0.35 ||
        dot3(reconstructedBitangent, uvBitangent) < 0.35
      ) uvJacobianMismatches += 1;
    }
  }

  for (let vertex = 0; vertex < normal.count; vertex += 1) {
    const storedNormal = attributeVector(normal, vertex, 3);
    const storedTangent = attributeVector(tangent, vertex, 3);
    if (Math.abs(length3(storedNormal) - 1) > 1e-4) errors.push(`normal length ${vertex}`);
    if (Math.abs(length3(storedTangent) - 1) > 1e-4) errors.push(`tangent length ${vertex}`);
    if (Math.abs(dot3(storedTangent, storedNormal)) > 1e-4) errors.push(`tangent not orthogonal ${vertex}`);
  }

  const groupCoverage = new Array(index.count).fill(0);
  let groupAlignmentErrors = 0;
  for (const [groupIndex, group] of geometry.groups.entries()) {
    if (group.start % 3 !== 0 || group.count % 3 !== 0) groupAlignmentErrors += 1;
    if (
      !Number.isInteger(group.materialIndex) ||
      group.materialIndex < 0 ||
      group.materialIndex >= geometry.userData.writer.materialSlots.length
    ) groupAlignmentErrors += 1;
    const semanticGroup = geometry.userData.writer.groups[groupIndex];
    if (
      !semanticGroup ||
      semanticGroup.start !== group.start ||
      semanticGroup.count !== group.count ||
      semanticGroup.materialIndex !== group.materialIndex
    ) groupAlignmentErrors += 1;
    for (let component = group.start; component < group.start + group.count; component += 1) {
      if (component >= 0 && component < groupCoverage.length) groupCoverage[component] += 1;
    }
  }
  const groupHoles = groupCoverage.filter((count) => count === 0).length;
  const groupOverlaps = groupCoverage.filter((count) => count > 1).length;
  if (groupHoles || groupOverlaps) errors.push("group coverage invalid");
  if (groupAlignmentErrors) errors.push("group ranges must be triangle-aligned with valid material indices");

  const boundary = geometry.attributes.boundaryReason;
  const hardEdgeVertices = Array.from(boundary.array).filter(
    (value) => value === BOUNDARY_REASONS.hardEdge || value === BOUNDARY_REASONS.cap,
  ).length;
  const hardEdgeProof = weldedBoundaryProof(geometry);
  if (hardEdgeVertices > 0 && hardEdgeProof.incompatibleWeldedGroups === 0) {
    errors.push("hard-edge labels have no welded-position incompatible tuples");
  }

  const tangentValidation = validateTangents(geometry);
  errors.push(...tangentValidation.errors);

  const topologyAudit = auditTopology(geometry);
  errors.push(...topologyAudit.errors);

  for (const name of ["semanticSurface", "boundaryReason", "smoothingGroup", "uvChart", "topologyVertex"]) {
    const attribute = geometry.attributes[name];
    if (!attribute || attribute.count !== position.count) {
      errors.push(`${name} must exist for every render vertex`);
      continue;
    }
    for (const value of attribute.array) {
      if (!Number.isInteger(value) || value < 0) errors.push(`${name} contains an invalid integer lane`);
    }
  }

  const boundsContainment = storedBoundsContainAllVertices(geometry);
  if (!boundsContainment) errors.push("stored bounds are stale or do not contain all vertices");
  if (windingMismatches) errors.push(`${windingMismatches} corner winding/normal mismatches`);
  if (degenerateUvTriangles) errors.push(`${degenerateUvTriangles} degenerate UV triangles`);
  if (uvJacobianMismatches) errors.push(`${uvJacobianMismatches} tangent/UV Jacobian mismatches`);
  if (uvScaleMismatches) errors.push(`${uvScaleMismatches} 2D physical UV scale mismatches`);
  if (geometry.userData.writer.exactCapacity !== true) errors.push("capacity is not exact");

  const uvDensityRange = {
    min: uvDensities.length ? Math.min(...uvDensities) : null,
    max: uvDensities.length ? Math.max(...uvDensities) : null,
  };
  return {
    ok: errors.length === 0 && degenerateTriangles === 0,
    errors,
    vertices: position.count,
    triangles: index.count / 3,
    groups: geometry.groups.length,
    bytes: geometry.userData.writer.bytes,
    degenerateTriangles,
    degenerateUvTriangles,
    windingMismatches,
    uvJacobianMismatches,
    uvScaleMismatches,
    uvDensityRange,
    groupHoles,
    groupOverlaps,
    groupAlignmentErrors,
    hardEdgeVertices,
    hardEdgeProof,
    boundsContainment,
    topologyAudit,
    drawCalls: geometry.groups.length,
    updateRanges: [],
  };
}

function validateLodSweep() {
  return Object.keys(LOD_PRESETS).map((tier) => {
    const preset = LOD_PRESETS[tier];
    const geometry = buildFrameFixture({ tier });
    const dprSweep = [1, 1.5, 2].map((requestedDpr) => {
      const appliedDpr = Math.min(requestedDpr, preset.dprCap);
      const measured = estimateTierBudget(tier, geometry, {
        cssHeight: preset.projectionEnvelope.referenceCssHeight,
        dpr: appliedDpr,
      });
      assert.equal(
        measured.projectedErrorOk,
        true,
        `${tier} physical-pixel positional error at requested DPR ${requestedDpr} (applied ${appliedDpr})`,
      );
      return {
        requestedDpr,
        appliedDpr,
        physicalTargetHeight: measured.projectionEnvelope.physicalTargetHeight,
        projectedPositionErrorPixels: measured.projectedPositionErrorPixels,
        projectedErrorOk: measured.projectedErrorOk,
      };
    });
    const budget = estimateTierBudget(tier, geometry, {
      cssHeight: preset.projectionEnvelope.referenceCssHeight,
      dpr: preset.dprCap,
    });
    const validation = validateGeometry(geometry);
    assert.equal(validation.ok, true, validation.errors.join("\n"));
    assert.equal(budget.vertexBudgetOk, true, `${tier} vertex budget`);
    assert.equal(budget.triangleBudgetOk, true, `${tier} triangle budget`);
    assert.equal(budget.extremaPreservationOk, true, `${tier} measured stationary points preserved`);
    assert.equal(budget.profileErrorOk, true, `${tier} chord/normal approximation error gate`);
    assert.equal(budget.projectedErrorOk, true, `${tier} physical-pixel positional error gate`);
    assert.equal(geometry.groups.length, 4);
    assert.deepEqual(
      geometry.userData.writer.materialSlots,
      ["top", "backing", "wall", "cap"],
      `${tier} material slot order`,
    );
    assert.equal(validation.topologyAudit.ok, true, validation.topologyAudit.errors.join("\n"));
    assert.equal(validation.topologyAudit.eulerCharacteristic, 2, `${tier} closed rail Euler characteristic`);
    return {
      ...budget,
      dprSweep,
      materialGroups: geometry.groups.length,
      topology: validation.topologyAudit,
    };
  });
}

function validateBranchLodSweep() {
  return Object.keys(LOD_PRESETS).map((tier) => {
    const preset = LOD_PRESETS[tier];
    const geometry = buildBranchRingFixture({ radialSegments: preset.branchRadialSegments });
    const approximation = measureBranchApproximation({
      frames: geometry.userData.fixture.frames,
      radii: geometry.userData.fixture.radii,
      radialSegments: geometry.userData.fixture.radialSegments,
    });
    const dprSweep = [1, 1.5, 2].map((requestedDpr) => {
      const appliedDpr = Math.min(requestedDpr, preset.dprCap);
      const projectionEnvelope = resolvePhysicalProjectionEnvelope(preset.projectionEnvelope, {
        cssHeight: preset.projectionEnvelope.referenceCssHeight,
        dpr: appliedDpr,
      });
      const projectedPositionErrorPixels = projectTransverseErrorPixels(
        approximation.maximumRadialChordError,
        projectionEnvelope,
      );
      assert(
        projectedPositionErrorPixels <= preset.branchErrorEnvelope.maximumPositionErrorPixels,
        `${tier} branch radial error exceeds its physical-pixel gate at requested DPR ${requestedDpr}`,
      );
      return { requestedDpr, appliedDpr, projectedPositionErrorPixels };
    });
    assert(
      approximation.maximumRadialNormalAngleError <=
        preset.branchErrorEnvelope.maximumRadialNormalAngleError,
      `${tier} branch radial normal error gate`,
    );
    assert(
      approximation.maximumAdjacentFrameAngle <= preset.branchErrorEnvelope.maximumAdjacentFrameAngle,
      `${tier} branch adjacent-frame angle gate`,
    );
    const validation = validateGeometry(geometry);
    assert.equal(validation.ok, true, validation.errors.join("\n"));
    const result = {
      tier,
      radialSegments: preset.branchRadialSegments,
      approximation,
      gates: { ...preset.branchErrorEnvelope },
      dprSweep,
    };
    geometry.dispose();
    return result;
  });
}

function validateAnalyticProfileDerivative() {
  const railWidth = 0.75;
  const step = 1e-7;
  let maximumAbsoluteError = 0;
  for (let probe = 1; probe < 1000; probe += 1) {
    const t = probe / 1000;
    const centralDifference = (
      profileZAt(t + step, railWidth) - profileZAt(t - step, railWidth)
    ) / (2 * step);
    maximumAbsoluteError = Math.max(
      maximumAbsoluteError,
      Math.abs(profileSampleAt(t, railWidth).derivative - centralDifference),
    );
  }
  assert(maximumAbsoluteError <= 1e-5, "analytic profile derivative must match an f64 central-difference oracle");
  return {
    probeCount: 999,
    maximumAbsoluteError,
    gate: 1e-5,
    normalSource: "analytic profile derivative",
  };
}

function validateBranchFixture() {
  const geometry = buildBranchRingFixture();
  const validation = validateGeometry(geometry);
  const frameValidation = validateBranchFrames(geometry.userData.fixture.frames);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.equal(frameValidation.ok, true, frameValidation.errors.join("\n"));
  assert.equal(geometry.groups.length, 2, "branch bark/cap groups");
  return { ...validation, frameValidation };
}

function validateStrategies() {
  const demo = createRealBatchingStrategies({ count: 4 });
  const strategies = demo.strategies;
  assert.deepEqual(Object.keys(strategies), STRATEGY_IDS, "runtime must expose the exact ordered six-strategy roster");
  assert.equal(STRATEGY_ROSTER.length, 6, "canonical batching comparison has exactly six strategies");
  assert.equal(strategies.grouped.object.isMesh, true);
  assert.equal(strategies.batched.object.isBatchedMesh, true);
  assert.equal(strategies.instanced.object.isInstancedMesh, true);
  assert.equal(strategies.storage.object.userData.storageOffsets.isStorageInstancedBufferAttribute, true);
  assert.equal(demo.resources.baseOffsets.isStorageInstancedBufferAttribute, true);
  assert.equal(demo.computeNodes[0].name, "semanticMeshWriterStorageUpdate");
  assert.equal(demo.computeNodes[1].name, "semanticMeshWriterIndirectCompact");
  assert(demo.computeNodes.every((node) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(node.name)), "compute names must be safe WGSL identifiers");
  for (const [id, entry] of Object.entries(strategies)) {
    assert(entry.geometryBytes > 0, `${id} must report live geometry bytes`);
    const contract = STRATEGY_ROSTER.find((candidate) => candidate.id === id);
    assert(contract, `${id} has no frozen strategy contract`);
    for (const field of ["route", "topologyOwner", "transformOwner", "visibilityOwner", "commandOwner"]) {
      assert.equal(entry[field], contract[field], `${id} ${field} contract drift`);
    }
    assert.deepEqual(entry.computeOwners, contract.computeOwners, `${id} compute ownership drift`);
    assert.deepEqual(entry.computeNodes.map((node) => node.name), contract.computeOwners, `${id} compute graph isolation`);
  }
  assert.equal(
    strategies.storage.bytes,
    demo.resources.baseOffsets.array.byteLength + demo.resources.offsets.array.byteLength,
    "storage instance bytes must reconcile with both transform buffers",
  );
  assert.equal(
    strategies.indirect.storageBytes,
    Object.values(strategies.indirect.fixture.resourceBytes).reduce((sum, bytes) => sum + bytes, 0),
    "indirect storage bytes must reconcile with every live command/compaction buffer",
  );
  assert.equal(strategies.indirect.object.geometry.indirect.isIndirectStorageBufferAttribute, true);
  assert.deepEqual(
    Array.from(strategies.indirect.object.geometry.indirect.array),
    [0, 0, 0, 0, 0],
    "skipping the GPU compute stage must leave an inert command",
  );
  assert.equal(strategies.indirect.proofStatus, "INCOMPLETE_UNTIL_NATIVE_WEBGPU_READBACK");
  assert(strategies.indirect.fixture.computeNodes.length > 0, "indirect route requires a reachable GPU compaction kernel");
  const sourceOffsets = strategies.indirect.fixture.sourceOffsets.array;
  const uniquePositions = new Set();
  for (let index = 0; index < strategies.indirect.fixture.maxInstances; index += 1) {
    uniquePositions.add(`${sourceOffsets[index * 4]}:${sourceOffsets[index * 4 + 1]}:${sourceOffsets[index * 4 + 2]}`);
  }
  assert.equal(uniquePositions.size, strategies.indirect.fixture.maxInstances, "indirect proof transforms must not overlap");
  const report = Object.fromEntries(Object.entries(strategies).map(([id, entry]) => [id, {
    type: entry.object.constructor.name,
    backendDrawItems: entry.backendDrawItems,
    runtimeVerdict: id === "indirect" ? "INSUFFICIENT_EVIDENCE" : "NOT_CLAIMED",
  }]));
  demo.dispose();
  return report;
}

function validateIndexBoundary() {
  const build = (vertices) => {
    const writer = createWriter({ vertices, indices: 3 }, ["boundary"]);
    const smoothing = writer.startSmoothingGroup("boundary-proof");
    const chart = writer.startUvChart("boundary-proof");
    for (let vertex = 0; vertex < vertices; vertex += 1) {
      writer.addVertex({
        position: [vertex, vertex % 2, 0],
        smoothing,
        chart,
        topology: vertex,
      });
    }
    writer.addTriangle(0, 1, vertices - 1, "boundary");
    writer.addGroup(0, 3, "boundary");
    return writer.finishGeometry();
  };
  const uint16 = build(65536);
  const uint32 = build(65537);
  assert(uint16.index.array instanceof Uint16Array, "vertex index 65535 must fit Uint16");
  assert.equal(uint16.index.getX(2), 65535);
  assert(uint32.index.array instanceof Uint32Array, "vertex index 65536 must use Uint32");
  assert.equal(uint32.index.getX(2), 65536);
  const result = {
    uint16: {
      vertices: uint16.attributes.position.count,
      maximumReferencedIndex: uint16.index.getX(2),
      indexType: uint16.userData.writer.indexType,
      exactCapacity: uint16.userData.writer.exactCapacity,
    },
    uint32: {
      vertices: uint32.attributes.position.count,
      maximumReferencedIndex: uint32.index.getX(2),
      indexType: uint32.userData.writer.indexType,
      exactCapacity: uint32.userData.writer.exactCapacity,
    },
  };
  uint16.dispose();
  uint32.dispose();
  return result;
}

function validateDynamicRange() {
  const geometry = configureDynamicGeometry(buildFrameFixture({ tier: "crowd" }));
  beginDynamicUpdateFrame(geometry);
  const before = Object.fromEntries(["position", "normal", "tangent"].map((name) => [
    name,
    geometry.attributes[name].array.slice(),
  ]));
  const record = updateVertexRange(geometry, {
    startVertex: 11,
    vertexCount: 9,
    positionDelta: [0, 0, 0.01],
    linearTransform: [1, 0, 0, 0, 1, 0, 0.08, 0, 1],
  });
  assert.deepEqual(geometry.attributes.position.updateRanges, [{ start: 33, count: 27 }]);
  assert.deepEqual(geometry.attributes.normal.updateRanges, [{ start: 33, count: 27 }]);
  assert.deepEqual(geometry.attributes.tangent.updateRanges, [{ start: 44, count: 36 }]);
  assert.equal(validateDynamicUpdateRecord(geometry, record).ok, true);
  for (const name of ["position", "normal", "tangent"]) {
    const attribute = geometry.attributes[name];
    const start = record.startVertex * attribute.itemSize;
    const end = (record.startVertex + record.vertexCount) * attribute.itemSize;
    let changedInside = false;
    for (let component = 0; component < before[name].length; component += 1) {
      const changed = attribute.array[component] !== before[name][component];
      if (component >= start && component < end) changedInside ||= changed;
      else assert.equal(changed, false, `${name} component ${component} changed outside the declared range`);
    }
    assert.equal(changedInside, true, `${name} must change inside an affine edit`);
  }
  assert.equal(record.bytes, 360);
  assert.equal(record.fullBufferUpload, false);
  geometry.dispose();
  return record;
}

function validateDynamicComponent() {
  const geometry = buildDynamicComponentFixture({ tier: "crowd" });
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const beforePosition = position.array.slice();
  const beforeNormal = normal.array.slice();
  const range = geometry.userData.dynamicComponentRange;
  const initialTopology = auditTopology(geometry);
  assert.equal(initialTopology.ok, true, initialTopology.errors.join("\n"));
  assert.equal(initialTopology.eulerCharacteristic, 4, "two closed components must have Euler characteristic four");
  beginDynamicUpdateFrame(geometry);
  const displacement = 0.125;
  const record = updateVertexRange(geometry, {
    startVertex: range.startVertex,
    vertexCount: range.vertexCount,
    positionDelta: [0, 0, displacement],
  });
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    for (let lane = 0; lane < 3; lane += 1) {
      const before = beforePosition[vertex * 3 + lane];
      const expected = vertex < range.startVertex || lane !== 2
        ? before
        : Math.fround(before + displacement);
      assert.equal(position.array[vertex * 3 + lane], expected, `dynamic component position ${vertex}:${lane}`);
    }
  }
  assert.deepEqual(normal.array, beforeNormal, "rigid component translation must preserve its normal buffer exactly");
  assert.equal(record.fullBufferUpload, false, "local component edit must not upload the static component range");
  assert(
    record.updatedVertexFraction <= range.maximumUpdatedVertexFraction,
    "local edit must stay within the frozen three-percent vertex envelope",
  );
  assert.equal(range.steadyStateCpuRewrite, false, "rAF stepping must not rewrite CPU geometry");
  assert.equal(validateDynamicUpdateRecord(geometry, record).ok, true);
  assert.equal(storedBoundsContainAllVertices(geometry), true, "dynamic component bounds must contain translated vertices");
  const translatedTopology = auditTopology(geometry);
  assert.equal(translatedTopology.ok, true, translatedTopology.errors.join("\n"));
  const result = {
    range,
    update: record,
    initialTopology,
    translatedTopology,
    normalsBitIdentical: true,
  };
  geometry.dispose();
  return result;
}

async function validateMikkFixture() {
  const source = buildFrameFixture({ tier: "crowd" });
  const fixture = await createTexturedMikkTangentFixture(source, { negateSign: false });
  const validation = validateTexturedMikkTangentFixture(fixture);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  assert.equal(validation.deindexedVertices, source.index.count, "Mikk representation count must be explicit");
  assert.equal(validation.groups, source.groups.length, "Mikk representation preserves semantic group ranges");
  assert.equal(validation.materialSlots, source.userData.writer.materialSlots.length, "Mikk material slot count");
  assert.equal(
    validation.triangleMaterialSlots,
    source.userData.writer.triangleMaterialSlots.length,
    "Mikk per-triangle slot count",
  );
  assert.equal(
    validation.representationBytes.totalBytes,
    Object.values(validation.representationBytes.attributeBytes).reduce((sum, bytes) => sum + bytes, 0),
    "Mikk deindexed full-byte ledger",
  );
  source.dispose();
  fixture.dispose();
  return validation;
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  if (args.sweep === "lod") {
    result = { lod: validateLodSweep() };
  } else if (args.sweep === "all") {
    result = {
      lod: validateLodSweep(),
      branchLod: validateBranchLodSweep(),
      analyticProfileDerivative: validateAnalyticProfileDerivative(),
      branch: validateBranchFixture(),
      texturedTangents: await validateMikkFixture(),
      indexBoundary: validateIndexBoundary(),
      strategies: validateStrategies(),
      dynamicRange: validateDynamicRange(),
      dynamicComponent: validateDynamicComponent(),
    };
  } else if (args.fixture === "branch-rings") {
    result = validateBranchFixture();
  } else {
    const tier = args.fixture === "frame-hero" || args.fixture === "hard-edges" ? "hero" : "standard";
    const geometry = buildFrameFixture({ tier });
    result = validateGeometry(geometry);
    if (args.fixture === "hard-edges") {
      assert(result.hardEdgeVertices > 0, "hard-edge fixture must duplicate vertices");
    }
  }

  const routes = createBatchingDemoDescriptors();
  assert.notEqual(
    chooseBatchingRoute({ topology: "varied", materialCount: 1 }),
    "InstancedMesh",
  );
  assert.deepEqual(Object.keys(routes), STRATEGY_IDS, "descriptor roster must exactly match runtime roster");
  assert.equal(routes.storage.route, "StorageInstancedBufferAttribute");
  const indirectFixture = createIndirectFixture();
  assert.equal(indirectFixture.attribute, "IndirectStorageBufferAttribute");
  indirectFixture.dispose();
  indirectFixture.geometry.dispose();
  assert.equal(selectIndexArrayType(65536), Uint16Array, "highest Uint16 index is 65535");
  assert.equal(selectIndexArrayType(65537), Uint32Array, "65536 requires Uint32");

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("semantic-mesh-writer validation passed");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
