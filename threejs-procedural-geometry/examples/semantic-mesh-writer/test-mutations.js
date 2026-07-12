import assert from "node:assert/strict";
import { BoxGeometry } from "three/webgpu";

import { createWriter } from "./mesh-writer.js";
import {
  BOUNDARY_REASONS,
  buildFrameFixture,
  buildProfileSamples,
  measureProfileApproximation,
} from "./frame-profile.js";
import {
  LOD_PRESETS,
  projectTransverseErrorPixels,
  resolvePhysicalProjectionEnvelope,
} from "./lod-presets.js";
import { buildBranchRingFixture, measureBranchApproximation } from "./branch-rings.js";
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
import { auditTopology, validateGeometry } from "./validate-geometry.js";
import {
  assertGeometryRouteTransition,
  normalizeGeometryRouteLock,
  resolveGeometryDpr,
} from "./lab-controller.js";
import {
  reconcileStorageReadback,
  reconcileStrategyDrawAudit,
  STORAGE_READBACK_PROVENANCE,
  STRATEGY_ROSTER,
} from "./batching-demo.js";
import {
  createTexturedMikkTangentFixture,
  validateTexturedMikkTangentFixture,
} from "./tangents.js";
import { assertCaptureHashesDistinct } from "./capture-hook.mjs";
import {
  assertObservedReadbackLayout,
  inferRendererReadbackLayout,
} from "./readback-layout.js";

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

detected.push(expectFailure(
  "duplicated-temporal-readback",
  () => assertCaptureHashesDistinct([
    { png: { path: "temporal.t000.png", sha256: "same-readback" } },
    { png: { path: "temporal.t001.png", sha256: "same-readback" } },
  ], "temporal.t000.png", "temporal.t001.png"),
  /falsely duplicated/,
));

assert.equal(resolveGeometryDpr("crowd", 2), 1, "crowd tier must clamp DPR to its locked cap");
assert.equal(resolveGeometryDpr("standard", 2), 1.5, "standard tier must clamp DPR to its locked cap");
assert.equal(resolveGeometryDpr("hero", 1.25), 1.25, "DPR below the tier cap must be preserved");
detected.push("tier-dpr-cap-enforced");

{
  const lock = normalizeGeometryRouteLock({ mode: "branch-rings", tier: "standard" });
  assert.equal(assertGeometryRouteTransition(lock, "mode", "branch-rings"), true);
  detected.push(expectFailure(
    "fixed-mechanism-public-setter-drift",
    () => assertGeometryRouteTransition(lock, "mode", "indirect-draw"),
    /locked to "branch-rings"/,
  ));
  detected.push(expectFailure(
    "fixed-tier-public-setter-drift",
    () => assertGeometryRouteTransition(lock, "tier", "hero"),
    /locked to "standard"/,
  ));
}

{
  const compact = inferRendererReadbackLayout({
    width: 641,
    height: 359,
    bytesPerPixel: 4,
    returnedByteLength: 641 * 4 * 359,
  });
  assert.equal(compact.requested.bytesPerRow, 2816, "odd-size requested stride must be 256-byte aligned");
  assert.equal(compact.observed.bytesPerRow, 2564, "compact renderer return must retain its actual row stride");
  assert.equal(compact.observed.padding, "renderer-normalized-compact");
  assert.equal(assertObservedReadbackLayout(compact, compact.observed.byteLength), true);
  detected.push("odd-size-requested-vs-observed-readback-layout");
  detected.push(expectFailure(
    "invalid-renderer-readback-byte-length",
    () => inferRendererReadbackLayout({
      width: 641,
      height: 359,
      bytesPerPixel: 4,
      returnedByteLength: compact.observed.byteLength + 1,
    }),
    /expected compact/,
  ));
  const forged = {
    requested: compact.requested,
    observed: { ...compact.observed, bytesPerRow: compact.requested.bytesPerRow },
  };
  detected.push(expectFailure(
    "forged-observed-readback-stride",
    () => assertObservedReadbackLayout(forged, forged.observed.byteLength),
    /cannot produce/,
  ));
}

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

{
  const preset = LOD_PRESETS.hero;
  const authoredWorldError = preset.maxNormalizedChordError * 0.75;
  const nearPlaneMutation = projectTransverseErrorPixels(authoredWorldError, {
    ...resolvePhysicalProjectionEnvelope(preset.projectionEnvelope, {
      cssHeight: preset.projectionEnvelope.referenceCssHeight,
      dpr: preset.dprCap,
    }),
    nearestSupportDepth: 0.5,
  });
  assert(
    nearPlaneMutation > preset.projectionEnvelope.maximumPositionErrorPixels,
    "nearer support depth must invalidate a previously accepted projected-error tier",
  );
  detected.push("projected-error-nearest-depth-mutation");
}

{
  const preset = LOD_PRESETS.hero;
  const geometry = buildBranchRingFixture({ radialSegments: 3 });
  const approximation = measureBranchApproximation({
    frames: geometry.userData.fixture.frames,
    radii: geometry.userData.fixture.radii,
    radialSegments: geometry.userData.fixture.radialSegments,
  });
  const projected = projectTransverseErrorPixels(
    approximation.maximumRadialChordError,
    resolvePhysicalProjectionEnvelope(preset.projectionEnvelope, {
      cssHeight: preset.projectionEnvelope.referenceCssHeight,
      dpr: preset.dprCap,
    }),
  );
  assert(
    projected > preset.branchErrorEnvelope.maximumPositionErrorPixels,
    "under-tessellated branch must fail the physical-pixel radial error gate",
  );
  assert(
    approximation.maximumRadialNormalAngleError > preset.branchErrorEnvelope.maximumRadialNormalAngleError,
    "under-tessellated branch must fail its normal-angle gate",
  );
  detected.push("under-tessellated-branch-error-gates");
  geometry.dispose();
}

detected.push(expectFailure(
  "underfilled-capacity",
  () => {
    const writer = createWriter({ vertices: 4, indices: 3 }, ["slot"]);
    const a = writer.addVertex({ position: [0, 0, 0] });
    const b = writer.addVertex({ position: [1, 0, 0] });
    const c = writer.addVertex({ position: [0, 1, 0] });
    writer.addTriangle(a, b, c, "slot");
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
    writer.addTriangle(a, b, c, "slot");
    writer.finishGeometry();
  },
  /group coverage invalid/,
));

detected.push(expectFailure(
  "triangle-without-material-slot",
  () => {
    const writer = createWriter({ vertices: 3, indices: 3 }, ["slot"]);
    const a = writer.addVertex({ position: [0, 0, 0] });
    const b = writer.addVertex({ position: [1, 0, 0] });
    const c = writer.addVertex({ position: [0, 1, 0] });
    writer.addTriangle(a, b, c);
  },
  /Unknown material slot/,
));

detected.push(expectFailure(
  "triangle-group-material-mismatch",
  () => {
    const writer = createWriter({ vertices: 3, indices: 3 }, ["surface-a", "surface-b"]);
    const a = writer.addVertex({ position: [0, 0, 0] });
    const b = writer.addVertex({ position: [1, 0, 0] });
    const c = writer.addVertex({ position: [0, 1, 0] });
    writer.addTriangle(a, b, c, "surface-a");
    writer.addGroup(0, 3, "surface-b");
    writer.finishGeometry();
  },
  /triangle 0 belongs to surface-a but group declares surface-b/,
));

detected.push(expectFailure(
  "out-of-range-index",
  () => {
    const writer = createWriter({ vertices: 3, indices: 3 }, ["slot"]);
    writer.addVertex({ position: [0, 0, 0] });
    writer.addTriangle(0, 1, 2, "slot");
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
    writer.addTriangle(a, b, c, "slot");
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
  writer.addTriangle(a, b, c, "slot");
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
  const geometry = buildFrameFixture({ tier: "crowd" });
  const topology = geometry.attributes.topologyVertex;
  const firstRenderVertexByTopology = new Map();
  let duplicate = null;
  for (let vertex = 0; vertex < topology.count; vertex += 1) {
    const id = topology.getX(vertex);
    if (firstRenderVertexByTopology.has(id)) {
      duplicate = vertex;
      break;
    }
    firstRenderVertexByTopology.set(id, vertex);
  }
  assert.notEqual(duplicate, null, "closed fixture must contain semantic-boundary render duplicates");
  geometry.attributes.position.setZ(duplicate, geometry.attributes.position.getZ(duplicate) + 0.001);
  const topologyAudit = auditTopology(geometry);
  assert.equal(topologyAudit.ok, false, "divergent positions for one topology identity must fail");
  assert.match(topologyAudit.errors.join("\n"), /divergent render positions/);
  detected.push("topology-identity-position-divergence");
  geometry.dispose();
}

{
  const geometry = buildFrameFixture({ tier: "crowd" });
  const vertex = geometry.index.getX(0);
  geometry.attributes.topologyVertex.setX(vertex, 0xfffffffe);
  detected.push(expectValidationFailure(
    "topology-split-opens-closed-rail",
    geometry,
    /(topology vertex count|topological boundary edge count|Euler characteristic)/,
  ));
}

{
  const geometry = buildFrameFixture({ tier: "crowd" });
  geometry.deleteAttribute("uvChart");
  detected.push(expectValidationFailure(
    "missing-semantic-uv-chart",
    geometry,
    /uvChart must exist/,
  ));
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
      sequence: 1,
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
      sequence: 1,
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
  const unsequenced = reconcileIndirectReadback({
    readback: {
      provenance: INDIRECT_READBACK_PROVENANCE,
      command: new Uint32Array([fixture.indexCount, 2, 0, 0, 0]),
      visibleIds: new Uint32Array([0, 1, 0xffffffff, 0xffffffff]),
      visibleOffsets: fixture.sourceOffsets.array.slice(),
    },
    indexCount: fixture.indexCount,
    maxInstances: fixture.maxInstances,
    visibilityMask: fixture.visibility.array,
    sourceOffsets: fixture.sourceOffsets.array,
  });
  assert.equal(unsequenced.ok, false, "unsequenced readback must not satisfy a fresh GPU audit");
  detected.push("unsequenced-indirect-readback");
  fixture.dispose();
  fixture.geometry.dispose();
}

{
  const authored = new Float32Array([
    0, 1, 2, 1,
    3, 4, 5, 1,
  ]);
  const timeSeconds = 0.75;
  const actual = authored.slice();
  actual[1] += Math.sin(timeSeconds) * 0.06;
  actual[5] += Math.sin(timeSeconds + 0.41) * 0.06;
  const passing = reconcileStorageReadback({
    readback: { provenance: STORAGE_READBACK_PROVENANCE, offsets: actual },
    authoredOffsets: authored,
    timeSeconds,
  });
  assert.equal(passing.verdict, "PASS", passing.errors.join("\n"));
  actual[5] += 0.2;
  const corrupt = reconcileStorageReadback({
    readback: { provenance: STORAGE_READBACK_PROVENANCE, offsets: actual },
    authoredOffsets: authored,
    timeSeconds,
  });
  assert.equal(corrupt.verdict, "FAIL", "corrupt GPU storage output must fail its oracle");
  detected.push("storage-output-readback-oracle");
}

{
  const records = STRATEGY_ROSTER.map((contract) => ({
    ...contract,
    computeOwners: [...contract.computeOwners],
    expectedDrawCalls: contract.id === "grouped" ? 4 : 1,
    actualDrawCalls: contract.id === "grouped" ? 3 : 1,
    rendererReportedTriangles: contract.id === "indirect" ? 96 : 12,
    rendererKnownMaxTriangles: contract.id === "indirect" ? 96 : null,
    commandSubmittedTriangles: contract.id === "indirect" ? 72 : null,
    triangleCountAuthority: contract.id === "indirect"
      ? "renderer-known-max-plus-gpu-command-readback"
      : "renderer.info",
    computeCalls: contract.computeOwners.length,
    rendererCalls: 1,
    indirectReadback: contract.id === "indirect"
      ? { verdict: "PASS", submittedTriangles: 72 }
      : null,
  }));
  const reconciliation = reconcileStrategyDrawAudit(records);
  assert.equal(reconciliation.verdict, "FAIL", "underreported renderer draw calls must fail");
  assert.match(reconciliation.errors.join("\n"), /submitted 3 draw calls; expected 4/);
  detected.push("renderer-draw-count-mismatch");

  const missingStrategy = reconcileStrategyDrawAudit(records.slice(0, -1));
  assert.equal(missingStrategy.verdict, "FAIL", "a five-strategy audit must never satisfy the canonical roster");
  assert.match(missingStrategy.errors.join("\n"), /exact 6-strategy roster/);
  detected.push("strategy-roster-omission");
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

{
  const source = buildFrameFixture({ tier: "crowd" });
  const fixture = await createTexturedMikkTangentFixture(source, { negateSign: false });
  fixture.attributes.tangent.setW(0, 0);
  const validation = validateTexturedMikkTangentFixture(fixture);
  assert.equal(validation.ok, false, "invalid Mikk tangent handedness must fail");
  assert.match(validation.errors.join("\n"), /invalid handedness/);
  detected.push("mikk-tangent-handedness-mutation");
  source.dispose();
  fixture.dispose();
}

{
  const source = buildFrameFixture({ tier: "crowd" });
  const fixture = await createTexturedMikkTangentFixture(source, { negateSign: false });
  const originalMaterialIndex = fixture.groups[0].materialIndex;
  fixture.groups[0].materialIndex = (originalMaterialIndex + 1) % source.userData.writer.materialSlots.length;
  let validation = validateTexturedMikkTangentFixture(fixture);
  assert.equal(validation.ok, false, "Mikk group material mutation must fail exact preservation");
  assert.match(validation.errors.join("\n"), /exact start\/count\/materialIndex/);
  detected.push("mikk-group-material-preservation");
  fixture.groups[0].materialIndex = originalMaterialIndex;

  const semantic = fixture.getAttribute("semanticSurface");
  const originalSemantic = semantic.getX(0);
  semantic.setX(0, originalSemantic + 1);
  validation = validateTexturedMikkTangentFixture(fixture);
  assert.equal(validation.ok, false, "Mikk semantic attribute mutation must fail byte preservation");
  assert.match(validation.errors.join("\n"), /semanticSurface bytes differ/);
  detected.push("mikk-semantic-byte-preservation");
  semantic.setX(0, originalSemantic);

  fixture.userData.tangentFixture.representationBytes = {
    ...fixture.userData.tangentFixture.representationBytes,
    totalBytes: fixture.userData.tangentFixture.representationBytes.totalBytes + 4,
  };
  validation = validateTexturedMikkTangentFixture(fixture);
  assert.equal(validation.ok, false, "Mikk full-byte ledger mutation must fail reconciliation");
  assert.match(validation.errors.join("\n"), /full representation byte ledger/);
  detected.push("mikk-full-byte-ledger");
  source.dispose();
  fixture.dispose();
}

console.log(JSON.stringify({
  ok: true,
  runtimeAcceptance: "INCOMPLETE_UNTIL_NATIVE_WEBGPU_CAPTURE_AND_READBACK",
  detected,
}, null, 2));
