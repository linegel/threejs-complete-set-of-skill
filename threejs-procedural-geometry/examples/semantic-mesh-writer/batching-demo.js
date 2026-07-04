import {
  BatchedMesh,
  BoxGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  StorageInstancedBufferAttribute,
} from "three/webgpu";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export function chooseBatchingRoute({
  topology,
  materialCount,
  update,
  staticCompatible = false,
}) {
  if (update === "gpu-instance-fields") return "StorageInstancedBufferAttribute";
  if (topology === "identical") return "InstancedMesh";
  if (staticCompatible && materialCount === 1) return "mergeGeometries(useGroups)";
  return "BatchedMesh";
}

export function createBatchingDemoDescriptors() {
  return {
    variedTopology: {
      route: chooseBatchingRoute({ topology: "varied", materialCount: 1 }),
      construct: "new BatchedMesh(maxInstances, maxVertices, maxIndices, material)",
    },
    identicalTopology: {
      route: chooseBatchingRoute({ topology: "identical", materialCount: 1 }),
      construct: "new InstancedMesh(geometry, material, count)",
    },
    hotGpuFields: {
      route: chooseBatchingRoute({
        topology: "identical",
        materialCount: 1,
        update: "gpu-instance-fields",
      }),
      construct: "new StorageInstancedBufferAttribute(count * 4, 4)",
    },
    staticMerge: {
      route: chooseBatchingRoute({
        topology: "varied",
        materialCount: 1,
        staticCompatible: true,
      }),
      construct: "mergeGeometries(geometries, true)",
    },
  };
}

export function constructSentinelObjects() {
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshBasicMaterial();
  return {
    batched: () => new BatchedMesh(4, 64, 96, material),
    instanced: () => new InstancedMesh(geometry, material, 4),
    storage: () => new StorageInstancedBufferAttribute(4 * 4, 4),
    merge: () => mergeGeometries([geometry, geometry], true),
  };
}
