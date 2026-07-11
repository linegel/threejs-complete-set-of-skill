import {
  BatchedMesh,
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  SphereGeometry,
  StorageInstancedBufferAttribute,
} from "three/webgpu";
import { color, instanceIndex, positionLocal, storage } from "three/tsl";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { buildFrameFixture } from "./frame-profile.js";
import { createIndirectFixture } from "./indirect-fixture.js";

export function chooseBatchingRoute({
  topology,
  materialCount,
  update,
  staticCompatible = false,
  gpuVisibility = false,
}) {
  if (gpuVisibility) return "IndirectStorageBufferAttribute";
  if (update === "gpu-instance-fields") return "StorageInstancedBufferAttribute";
  if (topology === "identical") return "InstancedMesh";
  if (staticCompatible && materialCount === 1) return "mergeGeometries(useGroups)";
  return "BatchedMesh";
}

export function createBatchingDemoDescriptors() {
  return {
    grouped: {
      route: "BufferGeometry.groups",
      invariant: "one authored indexed geometry; every index is covered by one semantic material group",
    },
    variedTopology: {
      route: chooseBatchingRoute({ topology: "varied", materialCount: 1 }),
      construct: "new BatchedMesh(maxInstances, maxVertices, maxIndices, material)",
      rendererTruth: "r185 WebGPU submits one backend draw item per visible multi-draw entry",
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
      construct: "matrix-free InstancedBufferGeometry + StorageInstancedBufferAttribute",
    },
    staticMerge: {
      route: chooseBatchingRoute({
        topology: "varied",
        materialCount: 1,
        staticCompatible: true,
      }),
      construct: "mergeGeometries(geometries, true)",
    },
    indirect: {
      route: chooseBatchingRoute({ topology: "identical", materialCount: 1, gpuVisibility: true }),
      construct: "BufferGeometry.setIndirect(IndirectStorageBufferAttribute, 0)",
    },
  };
}

function defaultMaterial(hex = 0xa9b8c6) {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = color(hex);
  material.roughness = 0.58;
  material.metalness = 0.08;
  return material;
}

function translatedGeometry(geometry, x, y, z) {
  const clone = geometry.clone();
  clone.applyMatrix4(new Matrix4().makeTranslation(x, y, z));
  return clone;
}

export function createRealBatchingStrategies({ material = defaultMaterial(), count = 6 } = {}) {
  const root = new Group();
  root.name = "real-batching-strategies";

  const groupedGeometry = buildFrameFixture({ tier: "crowd", railLength: 1.7, railWidth: 0.36 });
  const groupedMaterials = [0xd5ab6a, 0x59483d, 0x7d6551, 0xb88354].map(defaultMaterial);
  const grouped = new Mesh(groupedGeometry, groupedMaterials);
  grouped.name = "grouped-buffer-geometry";
  grouped.position.set(-4.2, -0.8, 0);

  const varied = [new BoxGeometry(0.7, 0.7, 0.7), new SphereGeometry(0.48, 16, 10), new CylinderGeometry(0.38, 0.55, 0.95, 12)];
  const maxVertices = varied.reduce((sum, geometry) => sum + geometry.attributes.position.count, 0);
  const maxIndices = varied.reduce((sum, geometry) => sum + (geometry.index?.count ?? geometry.attributes.position.count), 0);
  const batched = new BatchedMesh(varied.length, maxVertices, maxIndices, material);
  batched.name = "real-batched-mesh";
  varied.forEach((geometry, index) => {
    const geometryId = batched.addGeometry(geometry);
    const instanceId = batched.addInstance(geometryId);
    batched.setMatrixAt(instanceId, new Matrix4().makeTranslation(-1.5 + index * 1.1, 0, 0));
  });
  batched.computeBoundingBox();
  batched.computeBoundingSphere();

  const repeatedGeometry = new BoxGeometry(0.44, 0.44, 0.44);
  const instanced = new InstancedMesh(repeatedGeometry, material, count);
  instanced.name = "real-instanced-mesh";
  for (let index = 0; index < count; index += 1) {
    instanced.setMatrixAt(index, new Matrix4().makeTranslation(2.1 + (index % 3) * 0.58, Math.floor(index / 3) * 0.58, 0));
  }
  instanced.instanceMatrix.needsUpdate = true;

  const mergedSources = [
    translatedGeometry(new BoxGeometry(0.5, 0.5, 0.5), 4.3, 0, 0),
    translatedGeometry(new CylinderGeometry(0.3, 0.42, 0.8, 10), 5.0, 0, 0),
  ];
  const mergedGeometry = mergeGeometries(mergedSources, false);
  const merged = new Mesh(mergedGeometry, material);
  merged.name = "real-static-merge";

  const storageGeometry = new InstancedBufferGeometry().copy(new BoxGeometry(0.34, 0.34, 0.34));
  storageGeometry.instanceCount = count;
  const offsets = new StorageInstancedBufferAttribute(count, 4);
  for (let index = 0; index < count; index += 1) {
    offsets.setXYZW(index, -2.8 + index * 0.52, 1.8 + 0.18 * (index % 2), 0, 1);
  }
  offsets.needsUpdate = true;
  const offsetNode = storage(offsets, "vec4", count).element(instanceIndex).xyz;
  const storageMaterial = defaultMaterial(0x78b7a4);
  storageMaterial.positionNode = positionLocal.add(offsetNode);
  const storageMesh = new Mesh(storageGeometry, storageMaterial);
  storageMesh.name = "matrix-free-storage-instances";
  storageMesh.frustumCulled = false;
  storageMesh.userData.storageOffsets = offsets;

  const indirectSourceGeometry = new BoxGeometry(0.32, 0.32, 0.32);
  const indirect = createIndirectFixture({
    geometry: indirectSourceGeometry,
    maxInstances: count,
    instanceCount: Math.max(1, count - 2),
  });
  indirectSourceGeometry.dispose();
  const indirectMaterial = defaultMaterial(0xd06f68);
  indirectMaterial.positionNode = positionLocal.add(indirect.getOffsetNode(instanceIndex));
  const indirectMesh = new Mesh(indirect.geometry, indirectMaterial);
  indirectMesh.name = "gpu-indirect-instance-draw";
  indirectMesh.position.set(1.8, 1.75, 0);
  indirectMesh.frustumCulled = false;

  root.add(grouped, batched, instanced, merged, storageMesh, indirectMesh);
  root.userData.strategyLedger = {
    grouped: { object: grouped, backendDrawItems: groupedGeometry.groups.length },
    batched: { object: batched, backendDrawItems: batched.instanceCount },
    instanced: { object: instanced, backendDrawItems: 1 },
    merged: { object: merged, backendDrawItems: 1 },
    storage: { object: storageMesh, backendDrawItems: 1, bytes: offsets.array.byteLength },
    indirect: {
      object: indirectMesh,
      backendDrawItems: 1,
      commandBytes: indirect.indirect.array.byteLength,
      proofStatus: indirect.proofStatus,
      maxInstances: indirect.maxInstances,
      fixture: indirect,
    },
  };

  return {
    root,
    material,
    groupedMaterials,
    strategies: root.userData.strategyLedger,
    computeNodes: indirect.computeNodes,
    resources: {
      offsets,
      indirect: indirect.indirect,
      indirectSourceOffsets: indirect.sourceOffsets,
      indirectVisibility: indirect.visibility,
      indirectCompactedOffsets: indirect.compactedOffsets,
      indirectCompactedIds: indirect.compactedIds,
    },
    indirectFixture: indirect,
    dispose() {
      groupedGeometry.dispose();
      groupedMaterials.forEach((entry) => entry.dispose());
      varied.forEach((entry) => entry.dispose());
      batched.dispose();
      repeatedGeometry.dispose();
      instanced.dispose();
      mergedSources.forEach((entry) => entry.dispose());
      mergedGeometry.dispose();
      storageGeometry.dispose();
      storageMaterial.dispose();
      indirect.dispose();
      indirect.geometry.dispose();
      indirectMaterial.dispose();
      material.dispose();
    },
  };
}

export function constructSentinelObjects() {
  const strategies = createRealBatchingStrategies({ count: 4 });
  return {
    grouped: () => strategies.strategies.grouped.object,
    batched: () => strategies.strategies.batched.object,
    instanced: () => strategies.strategies.instanced.object,
    storage: () => strategies.resources.offsets,
    merge: () => strategies.strategies.merged.object.geometry,
    indirect: () => strategies.resources.indirect,
    dispose: strategies.dispose,
  };
}
