import {
  BoxGeometry,
  IndirectStorageBufferAttribute,
  InstancedBufferGeometry,
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
} from "three/webgpu";
import { Fn, If, Loop, storage, uint, vec4 } from "three/tsl";

export const INDIRECT_DEAD_ID = 0xffffffff;
export const INDIRECT_READBACK_PROVENANCE = "renderer.getArrayBufferAsync";

function createNonoverlappingOffsets(maxInstances, spacing = 0.62) {
  const columns = Math.ceil(Math.sqrt(maxInstances));
  const rows = Math.ceil(maxInstances / columns);
  const values = new Float32Array(maxInstances * 4);
  for (let index = 0; index < maxInstances; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    values.set([
      (column - (columns - 1) * 0.5) * spacing,
      (row - (rows - 1) * 0.5) * spacing,
      0,
      1,
    ], index * 4);
  }
  return values;
}

function validateVisibilityMask(mask, maxInstances) {
  if ((!Array.isArray(mask) && !ArrayBuffer.isView(mask)) || mask.length !== maxInstances) {
    throw new TypeError(`visibility mask must contain exactly ${maxInstances} entries`);
  }
  return Uint32Array.from(mask, (value) => Number(Boolean(value)));
}

export function expectedVisibleIndices(visibilityMask) {
  const visible = [];
  for (let index = 0; index < visibilityMask.length; index += 1) {
    if (visibilityMask[index] === 1) visible.push(index);
  }
  return visible;
}

export function reconcileIndirectReadback({
  readback,
  indexCount,
  maxInstances,
  visibilityMask,
  sourceOffsets,
  tolerance = 1e-6,
}) {
  const errors = [];
  if (readback?.provenance !== INDIRECT_READBACK_PROVENANCE) {
    errors.push("indirect validation requires fresh renderer.getArrayBufferAsync GPU readback");
  }
  const command = readback?.command;
  const visibleIds = readback?.visibleIds;
  const visibleOffsets = readback?.visibleOffsets;
  if (!(command instanceof Uint32Array) || command.length !== 5) {
    errors.push("indexed indirect command readback must contain five u32 words");
  }
  if (!(visibleIds instanceof Uint32Array) || visibleIds.length !== maxInstances) {
    errors.push("visible ID readback has the wrong length");
  }
  if (!(visibleOffsets instanceof Float32Array) || visibleOffsets.length !== maxInstances * 4) {
    errors.push("visible transform readback has the wrong length");
  }
  if (errors.length > 0) return { ok: false, errors, verdict: "FAIL" };

  const expected = expectedVisibleIndices(visibilityMask);
  const visibleCount = command[1];
  if (command[0] !== indexCount) errors.push("indirect indexCount does not match geometry");
  if (visibleCount > maxInstances) errors.push("indirect instanceCount exceeds maxInstances");
  if (command[2] !== 0 || command[3] !== 0 || command[4] !== 0) {
    errors.push("indirect firstIndex/baseVertex/firstInstance must remain zero");
  }
  if (visibleCount !== expected.length) {
    errors.push(`indirect instanceCount ${visibleCount} does not match expected ${expected.length}`);
  }

  const actualIds = Array.from(visibleIds.slice(0, Math.min(visibleCount, maxInstances)));
  if (new Set(actualIds).size !== actualIds.length) errors.push("compacted visible IDs contain duplicates");
  if (actualIds.some((id) => id >= maxInstances)) errors.push("compacted visible ID is out of range");
  if (actualIds.length === expected.length && actualIds.some((id, index) => id !== expected[index])) {
    errors.push("compacted visible IDs do not match deterministic source order");
  }

  for (let destination = 0; destination < Math.min(actualIds.length, maxInstances); destination += 1) {
    const source = actualIds[destination];
    for (let lane = 0; lane < 4; lane += 1) {
      const actual = visibleOffsets[destination * 4 + lane];
      const authored = sourceOffsets[source * 4 + lane];
      if (!Number.isFinite(actual) || Math.abs(actual - authored) > tolerance) {
        errors.push(`compacted transform ${destination}:${lane} does not match source ${source}`);
        break;
      }
    }
  }
  for (let destination = visibleCount; destination < maxInstances; destination += 1) {
    if (visibleIds[destination] !== INDIRECT_DEAD_ID) {
      errors.push("inactive compacted ID tail was not cleared");
      break;
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    verdict: errors.length === 0 ? "PASS" : "FAIL",
    visibleCount,
    visibleIds: actualIds,
    expectedVisibleIds: expected,
    submittedTriangles: visibleCount * indexCount / 3,
  };
}

export function createIndirectFixture({
  geometry = new BoxGeometry(0.32, 0.32, 0.32),
  maxInstances = 8,
  instanceCount = Math.max(0, maxInstances - 2),
  sourceOffsetValues = null,
} = {}) {
  if (!Number.isInteger(maxInstances) || maxInstances <= 0) {
    throw new RangeError("maxInstances must be a positive integer");
  }
  if (!Number.isInteger(instanceCount) || instanceCount < 0 || instanceCount > maxInstances) {
    throw new RangeError("instanceCount must be in [0, maxInstances]");
  }
  if (!geometry.index) {
    throw new TypeError("the canonical indirect fixture requires indexed geometry and a five-u32 command");
  }

  const instancedGeometry = new InstancedBufferGeometry().copy(geometry);
  // r185 still needs a CPU-known maximum envelope. The GPU-written indirect
  // command below is the only owner of submitted instanceCount.
  instancedGeometry.instanceCount = maxInstances;
  const indexCount = instancedGeometry.index.count;
  const sourceArray = sourceOffsetValues
    ? new Float32Array(sourceOffsetValues)
    : createNonoverlappingOffsets(maxInstances);
  if (sourceArray.length !== maxInstances * 4 || Array.from(sourceArray).some((value) => !Number.isFinite(value))) {
    throw new TypeError(`sourceOffsetValues must contain ${maxInstances * 4} finite floats`);
  }
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const minimumSeparation = geometry.boundingSphere.radius * 2 + 1e-5;
  for (let a = 0; a < maxInstances; a += 1) {
    for (let b = a + 1; b < maxInstances; b += 1) {
      const distance = Math.hypot(
        sourceArray[a * 4] - sourceArray[b * 4],
        sourceArray[a * 4 + 1] - sourceArray[b * 4 + 1],
        sourceArray[a * 4 + 2] - sourceArray[b * 4 + 2],
      );
      if (!(distance > minimumSeparation)) {
        throw new RangeError("indirect source transforms overlap and cannot prove instanceCount visually");
      }
    }
  }
  const initialMask = new Uint32Array(maxInstances);
  initialMask.fill(1, 0, instanceCount);

  const sourceOffsets = new StorageInstancedBufferAttribute(sourceArray, 4);
  const visibility = new StorageBufferAttribute(initialMask, 1);
  const compactedOffsets = new StorageInstancedBufferAttribute(maxInstances, 4);
  const compactedIds = new StorageBufferAttribute(new Uint32Array(maxInstances).fill(INDIRECT_DEAD_ID), 1);
  // Safe-zero initialization is deliberate: skipping compute must submit no
  // primitives, so runtime reachability can be falsified by mutation.
  const indirect = new IndirectStorageBufferAttribute(new Uint32Array(5), 1);
  instancedGeometry.setIndirect(indirect, 0);

  const sourceNode = storage(sourceOffsets, "vec4", maxInstances);
  const visibilityNode = storage(visibility, "uint", maxInstances);
  const compactedNode = storage(compactedOffsets, "vec4", maxInstances);
  const idNode = storage(compactedIds, "uint", maxInstances);
  const commandNode = storage(indirect, "uint", 5);

  // This correctness fixture is intentionally serial and deterministic. It
  // proves GPU-owned visibility, compaction, and draw-command reachability for
  // a tiny record set without misrepresenting itself as a scalable scan.
  const compactVisibleCompute = Fn(() => {
    const visibleCount = uint(0).toVar("indirectVisibleCount");
    Loop(
      { start: uint(0), end: uint(maxInstances), type: "uint", name: "clearIndex" },
      ({ clearIndex }) => {
        compactedNode.element(clearIndex).assign(vec4(0));
        idNode.element(clearIndex).assign(uint(INDIRECT_DEAD_ID));
      },
    );
    Loop(
      { start: uint(0), end: uint(maxInstances), type: "uint", name: "sourceIndex" },
      ({ sourceIndex }) => {
        If(visibilityNode.element(sourceIndex).equal(uint(1)), () => {
          compactedNode.element(visibleCount).assign(sourceNode.element(sourceIndex));
          idNode.element(visibleCount).assign(sourceIndex);
          visibleCount.addAssign(uint(1));
        });
      },
    );
    commandNode.element(uint(0)).assign(uint(indexCount));
    commandNode.element(uint(1)).assign(visibleCount);
    commandNode.element(uint(2)).assign(uint(0));
    commandNode.element(uint(3)).assign(uint(0));
    commandNode.element(uint(4)).assign(uint(0));
  })().compute(1).setName("compact-visible-indexed-indirect-command");

  function setVisibilityMask(mask) {
    const next = validateVisibilityMask(mask, maxInstances);
    visibility.array.set(next);
    visibility.needsUpdate = true;
  }

  async function captureGpuReadback(renderer) {
    if (!renderer?.backend?.isWebGPUBackend) {
      throw new Error("native WebGPU renderer is required for indirect readback");
    }
    const [commandBuffer, idBuffer, offsetBuffer] = await Promise.all([
      renderer.getArrayBufferAsync(indirect, null, 0, indirect.array.byteLength),
      renderer.getArrayBufferAsync(compactedIds, null, 0, compactedIds.array.byteLength),
      renderer.getArrayBufferAsync(compactedOffsets, null, 0, compactedOffsets.array.byteLength),
    ]);
    return {
      provenance: INDIRECT_READBACK_PROVENANCE,
      command: new Uint32Array(commandBuffer.slice(0)),
      visibleIds: new Uint32Array(idBuffer.slice(0)),
      visibleOffsets: new Float32Array(offsetBuffer.slice(0)),
    };
  }

  function reconcile(readback) {
    return reconcileIndirectReadback({
      readback,
      indexCount,
      maxInstances,
      visibilityMask: visibility.array,
      sourceOffsets: sourceOffsets.array,
    });
  }

  return {
    geometry: instancedGeometry,
    indirect,
    sourceOffsets,
    visibility,
    compactedOffsets,
    compactedIds,
    getOffsetNode(indexNode) {
      return compactedNode.element(indexNode).xyz;
    },
    computeNodes: [compactVisibleCompute],
    compactVisibleCompute,
    indexCount,
    maxInstances,
    setVisibilityMask,
    captureGpuReadback,
    reconcile,
    api: "BufferGeometry.setIndirect(indirect, indirectOffset)",
    attribute: "IndirectStorageBufferAttribute",
    proofStatus: "INCOMPLETE_UNTIL_NATIVE_WEBGPU_READBACK",
    resourceBytes: {
      indirect: indirect.array.byteLength,
      sourceOffsets: sourceOffsets.array.byteLength,
      visibility: visibility.array.byteLength,
      compactedOffsets: compactedOffsets.array.byteLength,
      compactedIds: compactedIds.array.byteLength,
    },
    dispose() {
      compactVisibleCompute.dispose();
      sourceNode.dispose();
      visibilityNode.dispose();
      compactedNode.dispose();
      idNode.dispose();
      commandNode.dispose();
    },
  };
}
