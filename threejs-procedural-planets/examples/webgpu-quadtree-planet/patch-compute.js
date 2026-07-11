import { StorageBufferAttribute } from "three/webgpu";
import {
  Fn,
  cos,
  float,
  instanceIndex,
  max,
  min,
  sqrt,
  storage,
  uint,
  vec4,
} from "three/tsl";

import { planetFields } from "./planet-fields.js";
import { patchAngularRadius, patchCenterDirection } from "./planet-quadtree.js";

export const PATCH_COMPUTE_CONTRACT = Object.freeze({
  implementationStatus: "runtime-storage-compute",
  api: "renderer.compute(ComputeNode)",
  algorithm: [
    "consume one analytic patch record per leaf",
    "derive radial range from the global normalized-height range [-1, 1]",
    "derive a spherical-sector bounding sphere from angular support",
    "derive geometric error from sphere sagitta plus an explicit authored surface-slope bound",
  ],
  proofExclusions: [
    "the maximum-surface-slope value is Authored until a formal field Lipschitz proof is checked in",
    "native-WebGPU execution/readback remains incomplete until browser evidence is captured",
  ],
});

export function deriveTileGutterTexels({
  maximumWarpDisplacementTexels,
  reconstructionFilterRadiusTexels,
  derivativeStencilRadiusTexels,
  maximumProjectedFootprintRadiusTexels,
}) {
  const inputs = {
    maximumWarpDisplacementTexels,
    reconstructionFilterRadiusTexels,
    derivativeStencilRadiusTexels,
    maximumProjectedFootprintRadiusTexels,
  };
  for (const [name, value] of Object.entries(inputs)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be finite and non-negative`);
    }
  }
  // Warp shifts the source support; reconstruction, derivative, and projected
  // footprints compete for the largest additional radius around that support.
  return Math.ceil(
    maximumWarpDisplacementTexels + Math.max(
      reconstructionFilterRadiusTexels,
      derivativeStencilRadiusTexels,
      maximumProjectedFootprintRadiusTexels,
    ),
  );
}

export function createPatchRecordBuffer(patchCount) {
  if (!Number.isInteger(patchCount) || patchCount <= 0) {
    throw new Error("patchCount must be a positive integer");
  }
  return new StorageBufferAttribute(patchCount * 2, 4, Float32Array);
}

/**
 * Create an executable analytic-bounds kernel. Each patch uses two input and
 * two output vec4 records; there is no cross-invocation reduction or hidden
 * global barrier.
 */
export function createPatchBoundsCompute({
  patches,
  radiusWorld,
  maximumDisplacementWorld,
  maximumSurfaceSlope,
  gridSide,
} = {}) {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error("patch bounds compute requires a nonempty patch frontier");
  }
  if (!(radiusWorld > 0) || !(maximumDisplacementWorld >= 0) ||
      !(maximumSurfaceSlope >= 0) || !Number.isInteger(gridSide) || gridSide < 3) {
    throw new Error("invalid patch bounds compute configuration");
  }
  const records = createPatchRecordBuffer(patches.length);
  const bounds = new StorageBufferAttribute(patches.length * 2, 4, Float32Array);
  records.name = "PlanetPatchAnalyticRecords";
  bounds.name = "PlanetPatchComputedBounds";
  for (let patchIndex = 0; patchIndex < patches.length; patchIndex += 1) {
    const patch = patches[patchIndex];
    const center = patchCenterDirection(patch);
    const angularRadius = patchAngularRadius(patch);
    const recordLane = patchIndex * 8;
    records.array[recordLane + 0] = center[0];
    records.array[recordLane + 1] = center[1];
    records.array[recordLane + 2] = center[2];
    records.array[recordLane + 3] = angularRadius;
    records.array[recordLane + 4] = radiusWorld;
    records.array[recordLane + 5] = maximumDisplacementWorld;
    records.array[recordLane + 6] = angularRadius / (gridSide - 1);
    records.array[recordLane + 7] = maximumSurfaceSlope;
  }

  const recordNode = storage(records, "vec4", patches.length * 2).toReadOnly();
  const boundsNode = storage(bounds, "vec4", patches.length * 2);
  const kernel = Fn(() => {
    const patchIndex = uint(instanceIndex);
    const recordIndex = patchIndex.mul(uint(2));
    const directionAngular = recordNode.element(recordIndex);
    const metric = recordNode.element(recordIndex.add(uint(1)));
    const radius = metric.x;
    const amplitude = metric.y;
    const cellAngle = metric.z;
    const slope = metric.w;
    const minimumRadius = max(float(0), radius.sub(amplitude));
    const maximumRadius = radius.add(amplitude);
    const centerWorld = directionAngular.xyz.mul(radius);
    const maximumDistanceSquared = radius.mul(radius)
      .add(maximumRadius.mul(maximumRadius))
      .sub(radius.mul(maximumRadius).mul(2).mul(cos(directionAngular.w)));
    const minimumDistanceSquared = radius.mul(radius)
      .add(minimumRadius.mul(minimumRadius))
      .sub(radius.mul(minimumRadius).mul(2).mul(cos(directionAngular.w)));
    const sphereRadius = sqrt(max(maximumDistanceSquared, minimumDistanceSquared));
    const sphereSagitta = maximumRadius.mul(float(1).sub(cos(cellAngle)));
    const heightVariation = min(amplitude.mul(2), slope.mul(maximumRadius).mul(cellAngle));
    boundsNode.element(recordIndex).assign(vec4(centerWorld, sphereRadius));
    boundsNode.element(recordIndex.add(uint(1))).assign(vec4(
      minimumRadius,
      maximumRadius,
      sphereSagitta.add(heightVariation),
      directionAngular.w,
    ));
  })().compute(patches.length, [64]).setName("planet:patch-analytic-bounds");

  let dispatchCount = 0;
  let disposed = false;
  return {
    patches,
    records,
    bounds,
    recordNode,
    boundsNode,
    kernel,
    dispatch(renderer) {
      if (disposed) throw new Error("patch bounds compute is disposed");
      if (renderer?.backend?.isWebGPUBackend !== true || typeof renderer.compute !== "function") {
        throw new Error("patch bounds compute requires initialized native WebGPU");
      }
      renderer.compute(kernel);
      dispatchCount += 1;
      return dispatchCount;
    },
    async readback(renderer) {
      if (disposed) throw new Error("patch bounds compute is disposed");
      return new Float32Array(await renderer.getArrayBufferAsync(bounds));
    },
    describe() {
      return {
        kind: "analytic-patch-bounds-storage-compute",
        patchCount: patches.length,
        inputBytes: records.array.byteLength,
        outputBytes: bounds.array.byteLength,
        dispatchCount,
        workgroupSize: 64,
        dispatchWorkgroups: Math.ceil(patches.length / 64),
        maximumSurfaceSlope: {
          value: maximumSurfaceSlope,
          unit: "world-height/world-arc",
          label: "Authored",
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      records.dispose();
      bounds.dispose();
    },
  };
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
    evidenceStatus: "authored sparse CPU probe; not a conservative production bound",
    minHeight: Math.min(...heights),
    maxHeight: Math.max(...heights),
    sampleCount: samples.length,
  };
}

export function createPatchComputeDescriptors(patches) {
  return {
    implementationStatus: PATCH_COMPUTE_CONTRACT.implementationStatus,
    apiTarget: PATCH_COMPUTE_CONTRACT.api,
    dirtyPatchCount: patches.length,
    buffers: {
      dirtyPatchRecords: "StorageBufferAttribute",
      patchBounds: "StorageBufferAttribute",
      analyticPatchRecords: "StorageBufferAttribute",
    },
    reductions: "not-required-analytic-per-patch-bound",
    tileGutter:
      "derived by the field atlas from warp displacement plus max(filter, derivative, projected-footprint support)",
    source: "analytic radial range plus authored maximum-surface-slope bound",
    proofExclusions: PATCH_COMPUTE_CONTRACT.proofExclusions,
  };
}
