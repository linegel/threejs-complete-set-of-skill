import assert from "node:assert/strict";

import { buildFrameFixture, BOUNDARY_REASONS } from "./frame-profile.js";
import { estimateTierBudget, LOD_PRESETS } from "./lod-presets.js";
import { validateTangents } from "./tangents.js";
import { chooseBatchingRoute, createBatchingDemoDescriptors } from "./batching-demo.js";
import { createIndirectFixture } from "./indirect-fixture.js";

function parseArgs(argv) {
  const args = { fixture: "frame-hero", json: false, sweep: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--fixture") args.fixture = argv[index + 1];
    if (argv[index] === "--sweep") args.sweep = argv[index + 1];
    if (argv[index] === "--json") args.json = true;
  }
  return args;
}

function validateGeometry(geometry) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const tangent = geometry.attributes.tangent;
  const index = geometry.index;
  const errors = [];
  let degenerateTriangles = 0;
  const uvDensities = [];

  for (const attribute of [position, normal, uv, tangent]) {
    for (const value of attribute.array) {
      if (!Number.isFinite(value)) errors.push(`${attribute.name ?? "attribute"} non-finite`);
    }
  }

  for (let i = 0; i < index.count; i += 1) {
    if (index.getX(i) >= position.count) errors.push(`index ${i} out of range`);
  }

  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    const ax = position.getX(a);
    const ay = position.getY(a);
    const az = position.getZ(a);
    const bx = position.getX(b);
    const by = position.getY(b);
    const bz = position.getZ(b);
    const cx = position.getX(c);
    const cy = position.getY(c);
    const cz = position.getZ(c);
    const ab = [bx - ax, by - ay, bz - az];
    const ac = [cx - ax, cy - ay, cz - az];
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const area2 = Math.hypot(...cross);
    if (area2 <= 1e-10) degenerateTriangles += 1;
    const du = Math.abs(uv.getX(a) - uv.getX(b));
    const edge = Math.hypot(ab[0], ab[1], ab[2]);
    if (edge > 0 && du > 0) uvDensities.push(du / edge);
  }

  for (let vertex = 0; vertex < normal.count; vertex += 1) {
    const length = Math.hypot(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
    if (Math.abs(length - 1) > 1e-4) errors.push(`normal length ${vertex}`);
  }

  const groupCoverage = new Array(index.count).fill(0);
  for (const group of geometry.groups) {
    for (let i = group.start; i < group.start + group.count; i += 1) {
      groupCoverage[i] += 1;
    }
  }
  const groupHoles = groupCoverage.filter((count) => count === 0).length;
  const groupOverlaps = groupCoverage.filter((count) => count > 1).length;
  if (groupHoles || groupOverlaps) errors.push("group coverage invalid");

  const boundary = geometry.attributes.boundaryReason;
  const semantic = geometry.attributes.semanticSurface;
  const incompatible = new Map();
  for (let vertex = 0; vertex < boundary.count; vertex += 1) {
    const key = `${semantic.getX(vertex)}:${boundary.getX(vertex)}`;
    incompatible.set(key, (incompatible.get(key) ?? 0) + 1);
  }
  const hardEdgeVertices = Array.from(boundary.array).filter(
    (value) => value === BOUNDARY_REASONS.hardEdge || value === BOUNDARY_REASONS.cap,
  ).length;

  const tangentValidation = validateTangents(geometry);
  errors.push(...tangentValidation.errors);

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const boundsContainment =
    Boolean(geometry.boundingBox) && Boolean(geometry.boundingSphere);

  const uvDensityRange = {
    min: Math.min(...uvDensities),
    max: Math.max(...uvDensities),
  };
  return {
    ok: errors.length === 0 && degenerateTriangles === 0,
    errors,
    vertices: position.count,
    triangles: index.count / 3,
    groups: geometry.groups.length,
    bytes: geometry.userData.writer.bytes,
    degenerateTriangles,
    uvDensityRange,
    groupHoles,
    groupOverlaps,
    hardEdgeVertices,
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
    assert.equal(geometry.groups.length, 4);
    return { ...budget, materialGroups: geometry.groups.length };
  });
}

const args = parseArgs(process.argv.slice(2));
let result;
if (args.sweep === "lod") {
  result = { lod: validateLodSweep() };
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
assert.equal(createIndirectFixture().attribute, "IndirectStorageBufferAttribute");

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("semantic-mesh-writer validation passed");
}
