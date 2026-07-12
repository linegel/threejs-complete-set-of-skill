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
import {
  Fn,
  color,
  float,
  instanceIndex,
  positionLocal,
  storage,
  uniform,
  vec4,
} from "three/tsl";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { buildFrameFixture } from "./frame-profile.js";
import { createIndirectFixture } from "./indirect-fixture.js";

export const STORAGE_READBACK_PROVENANCE = "renderer.getArrayBufferAsync";

export const STRATEGY_ROSTER = Object.freeze([
  Object.freeze({
    id: "grouped",
    route: "BufferGeometry.groups",
    topologyOwner: "one-authored-indexed-geometry",
    transformOwner: "Object3D.matrixWorld",
    visibilityOwner: "Object3D.visible",
    commandOwner: "renderer-material-group-submissions",
    computeOwners: Object.freeze([]),
  }),
  Object.freeze({
    id: "batched",
    route: "BatchedMesh",
    topologyOwner: "BatchedMesh.geometry-table",
    transformOwner: "BatchedMesh.instance-matrices",
    visibilityOwner: "BatchedMesh.instance-visibility",
    commandOwner: "BatchedMesh.multi-draw-table",
    computeOwners: Object.freeze([]),
  }),
  Object.freeze({
    id: "instanced",
    route: "InstancedMesh",
    topologyOwner: "one-shared-indexed-geometry",
    transformOwner: "InstancedMesh.instanceMatrix",
    visibilityOwner: "Object3D.visible",
    commandOwner: "renderer-instanced-draw",
    computeOwners: Object.freeze([]),
  }),
  Object.freeze({
    id: "merged",
    route: "mergeGeometries",
    topologyOwner: "one-static-merged-geometry",
    transformOwner: "baked-vertex-positions",
    visibilityOwner: "Object3D.visible",
    commandOwner: "renderer-indexed-draw",
    computeOwners: Object.freeze([]),
  }),
  Object.freeze({
    id: "storage",
    route: "StorageInstancedBufferAttribute",
    topologyOwner: "one-shared-indexed-geometry",
    transformOwner: "semanticMeshWriterStorageUpdate",
    visibilityOwner: "Object3D.visible",
    commandOwner: "renderer-instanced-draw",
    computeOwners: Object.freeze(["semanticMeshWriterStorageUpdate"]),
  }),
  Object.freeze({
    id: "indirect",
    route: "IndirectStorageBufferAttribute",
    topologyOwner: "one-shared-indexed-geometry",
    transformOwner: "semanticMeshWriterIndirectCompact",
    visibilityOwner: "semanticMeshWriterIndirectCompact",
    commandOwner: "gpu-five-u32-indexed-indirect-command",
    computeOwners: Object.freeze(["semanticMeshWriterIndirectCompact"]),
  }),
]);

export const STRATEGY_IDS = Object.freeze(STRATEGY_ROSTER.map(({ id }) => id));
const STRATEGY_BY_ID = new Map(STRATEGY_ROSTER.map((entry) => [entry.id, entry]));

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
  return Object.fromEntries(STRATEGY_ROSTER.map((contract) => [contract.id, {
    ...contract,
    construct: {
      grouped: "new Mesh(indexedGeometry, semanticMaterials)",
      batched: "new BatchedMesh(maxInstances, maxVertices, maxIndices, material)",
      instanced: "new InstancedMesh(geometry, material, count)",
      merged: "mergeGeometries(staticGeometries, false)",
      storage: "matrix-free InstancedBufferGeometry + StorageInstancedBufferAttribute",
      indirect: "BufferGeometry.setIndirect(IndirectStorageBufferAttribute, 0)",
    }[contract.id],
  }]));
}

export function reconcileStrategyDrawAudit(records) {
  const errors = [];
  if (!Array.isArray(records) || records.length !== STRATEGY_ROSTER.length) {
    return {
      verdict: "FAIL",
      errors: [`draw audit requires the exact ${STRATEGY_ROSTER.length}-strategy roster`],
      records: Array.isArray(records) ? records.map((record) => ({ ...record })) : [],
    };
  }
  const ids = new Set();
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== "object") {
      errors.push(`draw audit record ${index} is not an object`);
      continue;
    }
    const contract = STRATEGY_ROSTER[index];
    if (typeof record.id !== "string" || record.id.length === 0 || ids.has(record.id)) {
      errors.push(`draw audit record ${index} has a missing or duplicate id`);
    } else ids.add(record.id);
    if (record.id !== contract.id) {
      errors.push(`draw audit record ${index} must be ${contract.id}, received ${record.id ?? "missing"}`);
    }
    for (const name of ["route", "topologyOwner", "transformOwner", "visibilityOwner", "commandOwner"]) {
      if (record[name] !== contract[name]) {
        errors.push(`${record.id ?? index} ${name} does not match the frozen strategy contract`);
      }
    }
    if (
      !Array.isArray(record.computeOwners) ||
      record.computeOwners.length !== contract.computeOwners.length ||
      record.computeOwners.some((owner, ownerIndex) => owner !== contract.computeOwners[ownerIndex])
    ) {
      errors.push(`${record.id ?? index} compute owners do not match the frozen strategy contract`);
    }
    for (const name of ["expectedDrawCalls", "actualDrawCalls", "computeCalls", "rendererCalls"]) {
      if (!Number.isInteger(record[name]) || record[name] < 0) {
        errors.push(`${record.id ?? index} ${name} must be a nonnegative integer`);
      }
    }
    if (!Number.isFinite(record.rendererReportedTriangles) || record.rendererReportedTriangles < 0) {
      errors.push(`${record.id ?? index} rendererReportedTriangles must be finite and nonnegative`);
    }
    if (record.triangleCountAuthority !== (
      record.id === "indirect"
        ? "renderer-known-max-plus-gpu-command-readback"
        : "renderer.info"
    )) {
      errors.push(`${record.id ?? index} has no explicit triangle-count authority`);
    }
    if (record.actualDrawCalls !== record.expectedDrawCalls) {
      errors.push(
        `${record.id ?? index} submitted ${record.actualDrawCalls} draw calls; expected ${record.expectedDrawCalls}`,
      );
    }
    if (record.computeCalls !== contract.computeOwners.length) {
      errors.push(
        `${record.id ?? index} dispatched ${record.computeCalls} compute calls; expected ${contract.computeOwners.length}`,
      );
    }
    if (record.id === "indirect") {
      if (record.indirectReadback?.verdict !== "PASS") {
        errors.push("indirect audit requires a fresh passing GPU command readback");
      }
      if (
        !Number.isFinite(record.rendererKnownMaxTriangles) ||
        record.rendererKnownMaxTriangles < 0 ||
        record.rendererReportedTriangles !== record.rendererKnownMaxTriangles
      ) {
        errors.push("indirect renderer triangles must reconcile with the CPU-known maximum envelope");
      }
      if (
        !Number.isFinite(record.commandSubmittedTriangles) ||
        record.commandSubmittedTriangles < 0 ||
        record.commandSubmittedTriangles !== record.indirectReadback?.submittedTriangles
      ) {
        errors.push("indirect submitted triangles must reconcile separately with the fresh GPU command");
      }
    } else if (record.commandSubmittedTriangles !== null) {
      errors.push(`${record.id ?? index} must not invent a GPU indirect command triangle count`);
    }
  }
  return {
    verdict: errors.length === 0 ? "PASS" : "FAIL",
    errors,
    records: records.map((record) => ({ ...record })),
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
  geometry.applyMatrix4(new Matrix4().makeTranslation(x, y, z));
  return geometry;
}

function geometryByteLength(geometry) {
  if (!geometry) return 0;
  const arrays = new Set();
  if (geometry.index?.array) arrays.add(geometry.index.array);
  for (const attribute of Object.values(geometry.attributes ?? {})) {
    const array = attribute.isInterleavedBufferAttribute ? attribute.data?.array : attribute.array;
    if (array) arrays.add(array);
  }
  return Array.from(arrays).reduce((total, array) => total + array.byteLength, 0);
}

export function reconcileStorageReadback({
  readback,
  authoredOffsets,
  timeSeconds,
  tolerance = 2e-5,
}) {
  const errors = [];
  if (readback?.provenance !== STORAGE_READBACK_PROVENANCE) {
    errors.push("storage validation requires fresh renderer.getArrayBufferAsync GPU readback");
  }
  if (!(readback?.offsets instanceof Float32Array)) {
    errors.push("storage transform readback must be a Float32Array");
  }
  if (!(authoredOffsets instanceof Float32Array)) {
    errors.push("authored storage offsets must be a Float32Array");
  }
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    errors.push("storage readback time must be finite and nonnegative");
  }
  if (
    readback?.offsets instanceof Float32Array &&
    authoredOffsets instanceof Float32Array &&
    readback.offsets.length !== authoredOffsets.length
  ) {
    errors.push("storage transform readback length does not match authored storage");
  }
  if (errors.length === 0) {
    for (let component = 0; component < readback.offsets.length; component += 1) {
      const instance = Math.floor(component / 4);
      const lane = component % 4;
      const expected = authoredOffsets[component] + (
        lane === 1 ? Math.sin(timeSeconds + instance * 0.41) * 0.06 : 0
      );
      const actual = readback.offsets[component];
      if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
        errors.push(`storage transform ${instance}:${lane} does not match the GPU update oracle`);
        break;
      }
    }
  }
  return {
    ok: errors.length === 0,
    verdict: errors.length === 0 ? "PASS" : "FAIL",
    errors,
    provenance: readback?.provenance ?? null,
    instanceCount: authoredOffsets instanceof Float32Array ? authoredOffsets.length / 4 : null,
    byteLength: readback?.offsets?.byteLength ?? null,
    timeSeconds,
    tolerance,
  };
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

  const storageSourceGeometry = new BoxGeometry(0.34, 0.34, 0.34);
  const storageGeometry = new InstancedBufferGeometry().copy(storageSourceGeometry);
  storageSourceGeometry.dispose();
  storageGeometry.instanceCount = count;
  const baseOffsets = new StorageInstancedBufferAttribute(count, 4);
  const offsets = new StorageInstancedBufferAttribute(count, 4);
  for (let index = 0; index < count; index += 1) {
    const tuple = [-2.8 + index * 0.52, 1.8 + 0.18 * (index % 2), 0, 1];
    baseOffsets.setXYZW(index, ...tuple);
    offsets.setXYZW(index, ...tuple);
  }
  baseOffsets.needsUpdate = true;
  offsets.needsUpdate = true;
  const baseOffsetNode = storage(baseOffsets, "vec4", count);
  const storageOffsetNode = storage(offsets, "vec4", count);
  const storageTime = uniform(0);
  const storageUpdateCompute = Fn(() => {
    const authored = baseOffsetNode.element(instanceIndex);
    const wave = storageTime
      .add(float(instanceIndex).mul(0.41))
      .sin()
      .mul(0.06);
    storageOffsetNode.element(instanceIndex).assign(authored.add(vec4(0, wave, 0, 0)));
  })().compute(count, [64]).setName("semanticMeshWriterStorageUpdate");
  const offsetNode = storageOffsetNode.element(instanceIndex).xyz;
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
  const attachContract = (id, entry, computeNodes = []) => ({
    ...entry,
    ...STRATEGY_BY_ID.get(id),
    computeNodes,
  });
  root.userData.strategyLedger = {
    grouped: attachContract("grouped", {
      object: grouped,
      backendDrawItems: groupedGeometry.groups.length,
      geometryBytes: geometryByteLength(groupedGeometry),
    }),
    batched: attachContract("batched", {
      object: batched,
      backendDrawItems: batched.instanceCount,
      geometryBytes: geometryByteLength(batched.geometry),
    }),
    instanced: attachContract("instanced", {
      object: instanced,
      backendDrawItems: 1,
      geometryBytes: geometryByteLength(repeatedGeometry) + instanced.instanceMatrix.array.byteLength,
    }),
    merged: attachContract("merged", {
      object: merged,
      backendDrawItems: 1,
      geometryBytes: geometryByteLength(mergedGeometry),
    }),
    storage: attachContract("storage", {
      object: storageMesh,
      backendDrawItems: 1,
      bytes: baseOffsets.array.byteLength + offsets.array.byteLength,
      geometryBytes: geometryByteLength(storageGeometry),
      computeOwner: "semanticMeshWriterStorageUpdate",
      proofStatus: "INCOMPLETE_UNTIL_NATIVE_WEBGPU_DRAW_AUDIT",
    }, [storageUpdateCompute]),
    indirect: attachContract("indirect", {
      object: indirectMesh,
      backendDrawItems: 1,
      commandBytes: indirect.indirect.array.byteLength,
      proofStatus: indirect.proofStatus,
      maxInstances: indirect.maxInstances,
      fixture: indirect,
      geometryBytes: geometryByteLength(indirect.geometry),
      storageBytes: Object.values(indirect.resourceBytes).reduce((sum, bytes) => sum + bytes, 0),
    }, indirect.computeNodes),
  };

  const strategyIds = Object.keys(root.userData.strategyLedger);
  if (strategyIds.some((id, index) => id !== STRATEGY_IDS[index])) {
    throw new Error("runtime strategy ledger drifted from the frozen six-strategy roster");
  }

  async function captureStorageGpuReadback(renderer) {
    if (!renderer?.backend?.isWebGPUBackend) {
      throw new Error("native WebGPU renderer is required for storage-output readback");
    }
    const buffer = await renderer.getArrayBufferAsync(offsets, null, 0, offsets.array.byteLength);
    return {
      provenance: STORAGE_READBACK_PROVENANCE,
      offsets: new Float32Array(buffer.slice(0)),
    };
  }

  function reconcileStorage(readback) {
    return reconcileStorageReadback({
      readback,
      authoredOffsets: baseOffsets.array,
      timeSeconds: storageTime.value,
    });
  }

  return {
    root,
    material,
    groupedMaterials,
    strategies: root.userData.strategyLedger,
    computeNodes: [storageUpdateCompute, ...indirect.computeNodes],
    resources: {
      baseOffsets,
      offsets,
      indirect: indirect.indirect,
      indirectSourceOffsets: indirect.sourceOffsets,
      indirectVisibility: indirect.visibility,
      indirectCompactedOffsets: indirect.compactedOffsets,
      indirectCompactedIds: indirect.compactedIds,
    },
    indirectFixture: indirect,
    captureStorageGpuReadback,
    reconcileStorage,
    strategyRoster: STRATEGY_ROSTER,
    setTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new RangeError("storage instance time must be finite and nonnegative");
      }
      storageTime.value = seconds;
    },
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
      storageUpdateCompute.dispose();
      baseOffsetNode.dispose();
      storageOffsetNode.dispose();
      baseOffsets.dispose();
      offsets.dispose();
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
