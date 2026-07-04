import { ashMedium } from "./ash-preset.js";
import {
  compileAshTree,
  reportAshForegroundBoundsAndFrustum,
} from "./tree-system.js";

const EXPECTED = Object.freeze({
  branchVertices: 6639,
  branchTriangles: 9120,
  leafVertices: 21760,
  leafTriangles: 10880,
  branchMaxY: 80.29814147949219,
  leafMaxY: 83.69017028808594,
  branchJobs: [1, 8, 40, 160],
  continuations: [1, 1, 8, 40],
  lateralChildren: [0, 7, 32, 120],
  leafCards: 5440,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertArray(actual, expected, label) {
  assert(
    actual.length === expected.length &&
      actual.every((value, index) => value === expected[index]),
    `${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function assertNear(actual, expected, tolerance, label) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label} expected ${expected} +/- ${tolerance}, got ${actual}`,
  );
}

function summarizeGeometry(tree) {
  const branchPosition = tree.branchGeometry.getAttribute("position");
  const leafPosition = tree.leafGeometry.getAttribute("position");

  return {
    preset: "ashMedium",
    seed: ashMedium.seed,
    branchVertices: branchPosition.count,
    branchTriangles: tree.branchGeometry.index.count / 3,
    leafVertices: leafPosition.count,
    leafTriangles: tree.leafGeometry.index.count / 3,
    branchMaxY: tree.branchGeometry.boundingBox.max.y,
    leafMaxY: tree.leafGeometry.boundingBox.max.y,
    stats: tree.stats,
    attributes: {
      branch: Object.keys(tree.branchGeometry.attributes).sort(),
      leaf: Object.keys(tree.leafGeometry.attributes).sort(),
    },
    diagnostics: reportAshForegroundBoundsAndFrustum(tree),
  };
}

export function verifyAshContract() {
  const tree = compileAshTree(ashMedium);
  const summary = summarizeGeometry(tree);

  assert(summary.branchVertices === EXPECTED.branchVertices, "branch vertex count mismatch");
  assert(summary.branchTriangles === EXPECTED.branchTriangles, "branch triangle count mismatch");
  assert(summary.leafVertices === EXPECTED.leafVertices, "leaf vertex count mismatch");
  assert(summary.leafTriangles === EXPECTED.leafTriangles, "leaf triangle count mismatch");
  assertNear(summary.branchMaxY, EXPECTED.branchMaxY, 1e-5, "branch bounds max.y");
  assertNear(summary.leafMaxY, EXPECTED.leafMaxY, 1e-5, "leaf bounds max.y");
  assertArray(summary.stats.branchJobs, EXPECTED.branchJobs, "stats.branchJobs");
  assertArray(summary.stats.continuations, EXPECTED.continuations, "stats.continuations");
  assertArray(summary.stats.lateralChildren, EXPECTED.lateralChildren, "stats.lateralChildren");
  assert(summary.stats.leafCards === EXPECTED.leafCards, "stats.leafCards mismatch");

  for (const attribute of ["aChildSlot", "aAngularSlot", "barkUVChecker", "windDisplacement"]) {
    assert(
      summary.attributes.branch.includes(attribute),
      `branch geometry missing ${attribute}`,
    );
  }

  for (const attribute of ["leafRoot", "leafUvY", "windDisplacement"]) {
    assert(
      summary.attributes.leaf.includes(attribute),
      `leaf geometry missing ${attribute}`,
    );
  }

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(verifyAshContract(), null, 2));
}
