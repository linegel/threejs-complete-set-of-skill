import assert from "node:assert/strict";
import { BoxGeometry } from "three/webgpu";

import { createWriter } from "./mesh-writer.js";
import {
  BOUNDARY_REASONS,
  buildFrameFixture,
  buildProfileSamples,
  measureProfileApproximation,
} from "./frame-profile.js";
import { buildBranchRingFixture } from "./branch-rings.js";
import {
  beginDynamicUpdateFrame,
  configureDynamicGeometry,
  endDynamicUpdateFrame,
  updateVertexRange,
  validateDynamicUpdateBatch,
} from "./dynamic-updates.js";
import {
  createIndirectFixture,
  INDIRECT_READBACK_PROVENANCE,
  reconcileIndirectReadback,
} from "./indirect-fixture.js";
import { validateGeometry } from "./validate-geometry.js";
import { resolveGeometryDpr } from "./lab-controller.js";

function expectFailure(label, operation, pattern) {
  assert.throws(operation, pattern, label);
  return label;
}

function expectValidationFailure(label, geometry, pattern) {
  const validation = validateGeometry(geometry);
  assert.equal(validation.ok, false, `${label} must fail validation`);
  assert.match(validation.errors.join("\n"), pattern, label);
  geometry.dispose();
  return label;
}

const detected = [];

assert.equal(resolveGeometryDpr("crowd", 2), 1, "crowd tier must clamp DPR to its locked cap");
assert.equal(resolveGeometryDpr("standard", 2), 1.5, "standard tier must clamp DPR to its locked cap");
assert.equal(resolveGeometryDpr("hero", 1.25), 1.25, "DPR below the tier cap must be preserved");
detected.push("tier-dpr-cap-enforced");

detected.push(expectFailure(
  "lod-cannot-drop-stationary-points",
  () => buildProfileSamples(0.75, { profileSamples: 2 }),
  /profile extrema are mandatory/,
));

{
  const profile = buildProfileSamples(0.75, { profileSamples: 40 });
  const approximation = measureProfileApproximation([profile[0], profile.at(-1)], 0.75);
  assert(approximation.maximumNormalAngleError > 0.23, "under-sampled profile must violate crowd normal error gate");
  detected.push("under-sampled-profile-error-gate");
}

detected.push(expectFailure(
  "underfilled-capacity",
  () => {
    const writer = createWriter({ vertices: 4, indices: 3 }, ["slot"]);
    const a = writer.addVertex({ position: [0, 0, 0] });
    const b = writer.addVertex({ position: [1, 0, 0] });
    const c = writer.addVertex({ position: [0, 1, 0] });
    writer.addTriangle(a, b, c);
    writer.addGroup(0, 3, "slot");
    writer.finishGeometry();
  },
  /vertex capacity mismatch/,
));

detected.push(expectFailure(
  "group-hole",
  () => {
    const writer = createWriter({ vertices: 3, indices: 3 }, ["slot"]);
    const a = writer.addVertex({ position: [0, 0, 0] });
    const b = writer.addVertex({ position: [1, 0, 0] });
    const c = writer.addVertex({ position: [0, 1, 0] });
    writer.addTriangle(a, b, c);
    writer.finishGeometry();
  },
  /group coverage invalid/,
));

detected.push(expectFailure(
  "out-of-range-index",
  () => {
    const writer = createWriter({ vertices: 3, indices: 3 }, ["slot"]);
    writer.addVertex({ position: [0, 0, 0] });
    writer.addTriangle(0, 1, 2);
  },
  /triangle index/,
));

detected.push(expectFailure(
  "writer-rejects-triangle-splitting-group",
  () => {
    const writer = createWriter({ vertices: 3, indices: 3 }, ["slot"]);
    const a = writer.addVertex({ position: [0, 0, 0] });
    const b = writer.addVertex({ position: [1, 0, 0] });
    const c = writer.addVertex({ position: [0, 1, 0] });
    writer.addTriangle(a, b, c);
    writer.addGroup(0, 2, "slot");
  },
  /triangle boundaries/,
));

{
  const geometry = buildFrameFixture({ tier: "crowd" });
  geometry.groups[0].count -= 1;
  geometry.groups[1].start -= 1;
  geometry.groups[1].count += 1;
  detected.push(expectValidationFailure(
    "post-build-triangle-splitting-group",
    geometry,
    /triangle-aligned/,
  ));
}

{
  const geometry = buildFrameFixture({ tier: "crowd" });
  const [a, b, c] = [0, 1, 2].map((offset) => geometry.index.getX(offset));
  const u = geometry.attributes.uv.getX(a);
  const v = geometry.attributes.uv.getY(a);
  geometry.attributes.uv.setXY(b, u, v);
  geometry.attributes.uv.setXY(c, u, v);
  detected.push(expectValidationFailure("collapsed-uv-triangle", geometry, /degenerate UV/));
}

{
  const geometry = buildFrameFixture({ tier: "crowd" });
  for (let vertex = 0; vertex < geometry.attributes.tangent.count; vertex += 1) {
    geometry.attributes.tangent.setW(vertex, -geometry.attributes.tangent.getW(vertex));
  }
  detected.push(expectValidationFailure("flipped-tangent-handedness", geometry, /tangent\/UV Jacobian/));
}

{
  const geometry = buildFrameFixture({ tier: "crowd" });
  const vertex = geometry.index.getX(0);
  geometry.attributes.normal.setXYZ(
    vertex,
    -geometry.attributes.normal.getX(vertex),
    -geometry.attributes.normal.getY(vertex),
    -geometry.attributes.normal.getZ(vertex),
  );
  detected.push(expectValidationFailure("one-corner-normal-inversion", geometry, /winding\/normal/));
}

{
  const writer = createWriter({ vertices: 3, indices: 3 }, ["slot"]);
  const a = writer.addVertex({ position: [0, 0, 0], uv: [0, 0], boundary: BOUNDARY_REASONS.hardEdge });
  const b = writer.addVertex({ position: [1, 0, 0], uv: [1, 0], boundary: BOUNDARY_REASONS.hardEdge });
  const c = writer.addVertex({ position: [0, 1, 0], uv: [0, 1], boundary: BOUNDARY_REASONS.hardEdge });
  writer.addTriangle(a, b, c);
  writer.addGroup(0, 3, "slot");
  detected.push(expectValidationFailure(
    "hard-edge-label-without-weld-partner",
    writer.finishGeometry(),
    /welded-position incompatible tuples/,
  ));
}

{
  const geometry = buildFrameFixture({ tier: "crowd" });
  geometry.attributes.position.setX(0, geometry.attributes.position.getX(0) + 100);
  detected.push(expectValidationFailure("stale-bounds", geometry, /stored bounds are stale/));
}

{
  const geometry = buildBranchRingFixture({
    radialSegments: 10,
    radii: [0.34, 0.29, 0.21, 0.14, 0.08],
  });
  const { frames, radialSegments } = geometry.userData.fixture;
  const ringVertices = radialSegments + 1;
  for (let section = 0; section < frames.length; section += 1) {
    const center = frames[section].center;
    for (let radial = 0; radial <= radialSegments; radial += 1) {
      const vertex = section * ringVertices + radial;
      const x = geometry.attributes.position.getX(vertex) - center[0];
      const y = geometry.attributes.position.getY(vertex) - center[1];
      const z = geometry.attributes.position.getZ(vertex) - center[2];
      const magnitude = Math.hypot(x, y, z);
      geometry.attributes.normal.setXYZ(vertex, x / magnitude, y / magnitude, z / magnitude);
    }
  }
  detected.push(expectValidationFailure(
    "radial-only-normals-on-tapered-curved-branch",
    geometry,
    /(tangent not orthogonal|tangent\/UV Jacobian|winding\/normal)/,
  ));
}

detected.push(expectFailure(
  "out-of-range-dynamic-update",
  () => {
    const geometry = buildFrameFixture({ tier: "crowd" });
    updateVertexRange(geometry, {
      startVertex: 0,
      vertexCount: geometry.attributes.position.count + 1,
      positionDelta: [0, 0, 1],
    });
  },
  /outside the geometry attributes/,
));

detected.push(expectFailure(
  "unclassified-full-buffer-interaction-update",
  () => {
    const geometry = configureDynamicGeometry(buildFrameFixture({ tier: "crowd" }));
    updateVertexRange(geometry, {
      startVertex: 0,
      vertexCount: geometry.attributes.position.count,
      positionDelta: [0, 0, 0.01],
    });
  },
  /explicit allowFullBuffer classification/,
));

{
  const geometry = configureDynamicGeometry(buildFrameFixture({ tier: "crowd" }));
  const basisBefore = {
    normal: geometry.attributes.normal.array.slice(),
    tangent: geometry.attributes.tangent.array.slice(),
  };
  beginDynamicUpdateFrame(geometry);
  const records = [
    updateVertexRange(geometry, { startVertex: 5, vertexCount: 3, positionDelta: [0, 0, 0.01], deferBounds: true }),
    updateVertexRange(geometry, { startVertex: 20, vertexCount: 4, positionDelta: [0, 0, -0.01], deferBounds: true }),
  ];
  const boundsTelemetry = endDynamicUpdateFrame(geometry);
  assert.equal(boundsTelemetry.recomputeCount, 1, "batched edits must finalize bounds once");
  assert.equal(geometry.attributes.position.updateRanges.length, 2, "position must retain both disjoint ranges");
  assert.equal(geometry.attributes.normal.updateRanges.length, 0, "translation must not upload unchanged normals");
  assert.equal(geometry.attributes.tangent.updateRanges.length, 0, "translation must not upload unchanged tangents");
  assert.deepEqual(geometry.attributes.normal.array, basisBefore.normal, "translation keeps normals bit-identical");
  assert.deepEqual(geometry.attributes.tangent.array, basisBefore.tangent, "translation keeps tangents bit-identical");
  assert.equal(validateDynamicUpdateBatch(geometry, records).ok, true);
  detected.push("two-disjoint-dynamic-ranges-retained");
  detected.push("translation-updates-position-only");
  geometry.attributes.position.addUpdateRange(0, geometry.attributes.position.count * 3);
  assert.equal(validateDynamicUpdateBatch(geometry, records).ok, false, "undeclared extra range must fail reconciliation");
  detected.push("undeclared-extra-dynamic-range");
  geometry.dispose();
}

{
  const fixture = createIndirectFixture({ maxInstances: 4, instanceCount: 2 });
  assert.deepEqual(Array.from(fixture.indirect.array), [0, 0, 0, 0, 0], "skipped GPU compute must remain inert");
  detected.push("skipped-indirect-compute-is-inert");
  const cpuMirror = reconcileIndirectReadback({
    readback: {
      provenance: "cpu-mirror",
      command: new Uint32Array([fixture.indexCount, 2, 0, 0, 0]),
      visibleIds: new Uint32Array([0, 1, 0xffffffff, 0xffffffff]),
      visibleOffsets: fixture.sourceOffsets.array.slice(),
    },
    indexCount: fixture.indexCount,
    maxInstances: fixture.maxInstances,
    visibilityMask: fixture.visibility.array,
    sourceOffsets: fixture.sourceOffsets.array,
  });
  assert.equal(cpuMirror.ok, false, "CPU mirror must never satisfy GPU readback acceptance");
  detected.push("cpu-mirror-indirect-proof-rejected");
  const corruptCount = reconcileIndirectReadback({
    readback: {
      provenance: INDIRECT_READBACK_PROVENANCE,
      command: new Uint32Array([fixture.indexCount, 5, 0, 0, 0]),
      visibleIds: new Uint32Array([0, 1, 2, 3]),
      visibleOffsets: fixture.sourceOffsets.array.slice(),
    },
    indexCount: fixture.indexCount,
    maxInstances: fixture.maxInstances,
    visibilityMask: fixture.visibility.array,
    sourceOffsets: fixture.sourceOffsets.array,
  });
  assert.equal(corruptCount.ok, false, "GPU command overflow mutation must fail");
  detected.push("indirect-count-overflow");
  fixture.dispose();
  fixture.geometry.dispose();
}

detected.push(expectFailure(
  "nonindexed-command-layout",
  () => {
    const indexed = new BoxGeometry(0.32, 0.32, 0.32);
    const nonindexed = indexed.toNonIndexed();
    indexed.dispose();
    try {
      createIndirectFixture({ geometry: nonindexed, maxInstances: 2, instanceCount: 1 });
    } finally {
      nonindexed.dispose();
    }
  },
  /requires indexed geometry/,
));

detected.push(expectFailure(
  "coincident-indirect-transforms",
  () => {
    const geometry = new BoxGeometry(0.32, 0.32, 0.32);
    try {
      createIndirectFixture({
        geometry,
        maxInstances: 2,
        instanceCount: 2,
        sourceOffsetValues: [0, 0, 0, 1, 0, 0, 0, 1],
      });
    } finally {
      geometry.dispose();
    }
  },
  /transforms overlap/,
));

console.log(JSON.stringify({
  ok: true,
  runtimeAcceptance: "INCOMPLETE_UNTIL_NATIVE_WEBGPU_CAPTURE_AND_READBACK",
  detected,
}, null, 2));
