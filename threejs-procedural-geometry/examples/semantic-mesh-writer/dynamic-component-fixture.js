import { Matrix4 } from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { configureDynamicGeometry } from "./dynamic-updates.js";
import { buildFrameFixture } from "./frame-profile.js";
import { buildBranchRingFixture } from "./branch-rings.js";
import { LOD_PRESETS } from "./lod-presets.js";

function offsetSemanticIdentity(staticGeometry, movingGeometry, name) {
  const staticAttribute = staticGeometry.getAttribute(name);
  const movingAttribute = movingGeometry.getAttribute(name);
  if (!staticAttribute || !movingAttribute) {
    throw new Error(`dynamic component fixture requires ${name} on both components`);
  }
  let maximumStaticId = 0;
  let maximumMovingId = 0;
  for (let vertex = 0; vertex < staticAttribute.count; vertex += 1) {
    maximumStaticId = Math.max(maximumStaticId, staticAttribute.getX(vertex));
  }
  for (let vertex = 0; vertex < movingAttribute.count; vertex += 1) {
    maximumMovingId = Math.max(maximumMovingId, movingAttribute.getX(vertex));
  }
  const offset = maximumStaticId + 1;
  const maximumRepresentable = 2 ** (movingAttribute.array.BYTES_PER_ELEMENT * 8) - 1;
  if (maximumMovingId + offset > maximumRepresentable) {
    throw new RangeError(`${name} identity offset exceeds ${movingAttribute.array.constructor.name}`);
  }
  for (let vertex = 0; vertex < movingAttribute.count; vertex += 1) {
    movingAttribute.setX(vertex, movingAttribute.getX(vertex) + offset);
  }
  return offset;
}

export function buildDynamicComponentFixture({
  tier = "hero",
  railLength = 4.2,
  railWidth = 0.72,
  componentSpacing = 1.05,
} = {}) {
  const staticGeometry = buildFrameFixture({ tier, railLength, railWidth });
  const preset = LOD_PRESETS[tier];
  if (!preset) throw new RangeError(`unknown dynamic fixture tier "${tier}"`);
  const movingGeometry = buildBranchRingFixture({
    radialSegments: preset.branchRadialSegments,
    centers: [
      [0, 0, 0],
      [0.05, 0.25, 0.02],
      [-0.03, 0.5, 0.04],
    ],
    radii: [0.1, 0.075, 0.045],
    metersPerRepeat: 0.35,
  });
  const topologyVertexCount =
    staticGeometry.userData.fixture.topology.topologyVertexCount +
    movingGeometry.userData.fixture.topology.topologyVertexCount;
  const semanticOffsets = Object.fromEntries(
    ["topologyVertex", "smoothingGroup", "uvChart"]
      .map((name) => [name, offsetSemanticIdentity(staticGeometry, movingGeometry, name)]),
  );
  movingGeometry.applyMatrix4(new Matrix4().makeTranslation(railLength * 0.45, componentSpacing, 0));
  const staticVertexCount = staticGeometry.attributes.position.count;
  const movingVertexCount = movingGeometry.attributes.position.count;
  const geometry = mergeGeometries([staticGeometry, movingGeometry], false);
  staticGeometry.dispose();
  movingGeometry.dispose();
  if (!geometry) throw new Error("dynamic semantic component merge failed");

  geometry.userData.fixture = {
    kind: "closed-static-rail-plus-local-edit-branch",
    tier,
    topology: {
      declaredClosed: true,
      topologyVertexCount,
      expectedEulerCharacteristic: 4,
      expectedBoundaryEdgeCount: 0,
    },
  };
  geometry.userData.dynamicComponentRange = Object.freeze({
    startVertex: staticVertexCount,
    vertexCount: movingVertexCount,
    semantics: "one separately closed compact branch component",
    topologyIdentity: "offset from the static component before merge",
    semanticOffsets: Object.freeze(semanticOffsets),
    steadyStateCpuRewrite: false,
    editTrigger: "explicit setTime/reset interaction only",
    maximumUpdatedVertexFraction: 0.03,
  });
  if (movingVertexCount / geometry.attributes.position.count > 0.03) {
    throw new Error("dynamic local-edit component exceeds the frozen three-percent upload envelope");
  }
  return configureDynamicGeometry(geometry);
}
