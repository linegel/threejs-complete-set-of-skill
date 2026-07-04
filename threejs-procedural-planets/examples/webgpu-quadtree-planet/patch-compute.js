import { StorageBufferAttribute } from "three/webgpu";

import { planetFields } from "./planet-fields.js";
import { patchCenterDirection } from "./planet-quadtree.js";

export const PATCH_COMPUTE_CONTRACT = `
const dirtyPatchRecords = new StorageBufferAttribute(patchCount * 4, 4);
const patchBounds = new StorageBufferAttribute(patchCount * 4, 4);
const computeDirtyPatchBounds = Fn(() => {
  const dirtyPatch = storage(dirtyPatchRecords, "vec4", patchCount).element(instanceIndex);
  const fields = planetFields(dirtyPatch.xyz.normalize(), planetPreset);
  storage(patchBounds, "vec4", patchCount)
    .element(instanceIndex)
    .assign(vec4(fields.minHeight, fields.maxHeight, fields.parityError, dirtyPatch.w));
  workgroupBarrier();
}).compute(patchCount);
await renderer.computeAsync(computeDirtyPatchBounds);
`;

export function createPatchRecordBuffer(patchCount) {
  return new StorageBufferAttribute(patchCount * 4, 4);
}

export function estimateDirtyPatchBounds(patch, {
  preset,
  seed,
  amplitudeScale = 1,
  sampleDirections = null,
} = {}) {
  const center = patchCenterDirection(patch);
  const samples = sampleDirections ?? [
    center,
    [center[0] + 0.01, center[1], center[2]],
    [center[0], center[1] + 0.01, center[2]],
    [center[0], center[1], center[2] + 0.01],
  ];
  const heights = samples.map((direction) =>
    planetFields(direction, { preset, seed }).height * amplitudeScale,
  );
  return {
    patchId: patch.id,
    dirtyPatch: true,
    minHeight: Math.min(...heights),
    maxHeight: Math.max(...heights),
    sampleCount: samples.length,
  };
}

export function createPatchComputeDescriptors(patches) {
  return {
    api: "renderer.computeAsync",
    dirtyPatchCount: patches.length,
    buffers: {
      dirtyPatchRecords: "StorageBufferAttribute",
      patchBounds: "StorageBufferAttribute",
      paritySamples: "StorageBufferAttribute",
    },
    reductions: ["minHeight", "maxHeight", "parityError"],
    source: "planetFields",
  };
}
