import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import { buildFrameFixture, BOUNDARY_REASONS } from "./frame-profile.js";
import { estimateTierBudget, LOD_PRESETS } from "./lod-presets.js";
import { validateTangents } from "./tangents.js";
import { chooseBatchingRoute, createBatchingDemoDescriptors } from "./batching-demo.js";
import { createIndirectFixture } from "./indirect-fixture.js";
import { buildBranchRingFixture, validateBranchFrames } from "./branch-rings.js";
import {
  beginDynamicUpdateFrame,
  configureDynamicGeometry,
  updateVertexRange,
  validateDynamicUpdateRecord,
} from "./dynamic-updates.js";
import { createRealBatchingStrategies } from "./batching-demo.js";
import { selectIndexArrayType } from "./mesh-writer.js";

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

  for (const attribute of [position, normal, uv, tangent]) {
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
  for (const group of geometry.groups) {
    if (group.start % 3 !== 0 || group.count % 3 !== 0) groupAlignmentErrors += 1;
    if (!Number.isInteger(group.materialIndex) || group.materialIndex < 0) groupAlignmentErrors += 1;
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
    drawCalls: geometry.groups.length,
    updateRanges: [],
  };
}

function validateLodSweep() {
  return Object.keys(LOD_PRESETS).map((tier) => {
    const geometry = buildFrameFixture({ tier });
    const budget = estimateTierBudget(tier, geometry);
    const validation = validateGeometry(geometry);
    assert.equal(validation.ok, true, validation.errors.join("\n"));
    assert.equal(budget.vertexBudgetOk, true, `${tier} vertex budget`);
    assert.equal(budget.triangleBudgetOk, true, `${tier} triangle budget`);
    assert.equal(budget.extremaPreservationOk, true, `${tier} measured stationary points preserved`);
    assert.equal(budget.profileErrorOk, true, `${tier} chord/normal approximation error gate`);
    assert.equal(geometry.groups.length, 4);
    return { ...budget, materialGroups: geometry.groups.length };
  });
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
  assert.equal(strategies.grouped.object.isMesh, true);
  assert.equal(strategies.batched.object.isBatchedMesh, true);
  assert.equal(strategies.instanced.object.isInstancedMesh, true);
  assert.equal(strategies.storage.object.userData.storageOffsets.isStorageInstancedBufferAttribute, true);
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

function runCli() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  if (args.sweep === "lod") {
    result = { lod: validateLodSweep() };
  } else if (args.sweep === "all") {
    result = {
      lod: validateLodSweep(),
      branch: validateBranchFixture(),
      strategies: validateStrategies(),
      dynamicRange: validateDynamicRange(),
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
  assert.equal(routes.hotGpuFields.route, "StorageInstancedBufferAttribute");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
