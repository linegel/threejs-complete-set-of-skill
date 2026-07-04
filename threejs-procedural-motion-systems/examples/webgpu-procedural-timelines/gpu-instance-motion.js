import { StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import { Fn, instanceIndex, storage, uniform, vec4 } from "three/tsl";

export const MOTION_STORAGE_LAYOUT = {
  dynamicState: {
    itemSize: 4,
    fields: ["position.xyz", "phaseId", "velocity.xyz", "flags", "quaternion.xyzw"],
    storageBytes: 48,
  },
  staticState: {
    itemSize: 4,
    fields: ["localAnchor.xyz", "scale", "localAxis.xyz", "presetId", "seed", "rngCounter"],
    storageBytes: 48,
  },
  matrix: {
    itemSize: 16,
    fields: ["instance matrix"],
    storageBytes: 64,
  },
};

export function chooseMotionRoute({ actorCount, mixedGeometry = false }) {
  if (actorCount < 200) return "<200 Object3D";
  if (actorCount <= 10000) return mixedGeometry ? "200-10k BatchedMesh" : "200-10k InstancedMesh";
  return "10k+ StorageInstancedBufferAttribute";
}

export function createInstanceMotionBuffers(instanceCount) {
  const dynamicState = new StorageInstancedBufferAttribute(instanceCount * 3, 4);
  const staticState = new StorageBufferAttribute(instanceCount * 3, 4);
  const instanceMatrix = new StorageInstancedBufferAttribute(instanceCount, 16);
  return {
    instanceCount,
    dynamicState,
    staticState,
    instanceMatrix,
    storageBytes:
      instanceCount *
      (MOTION_STORAGE_LAYOUT.dynamicState.storageBytes +
        MOTION_STORAGE_LAYOUT.staticState.storageBytes +
        MOTION_STORAGE_LAYOUT.matrix.storageBytes),
  };
}

export function createGpuInstanceMotionPlan({ instanceCount = 1024 } = {}) {
  const buffers = createInstanceMotionBuffers(instanceCount);
  const dynamicNode = storage(buffers.dynamicState, "vec4", buffers.dynamicState.count);
  const simTime = uniform(0);
  const integratePose = Fn(() => {
    const i = instanceIndex;
    const current = dynamicNode.element(i);
    dynamicNode.element(i).assign(vec4(current.xyz, simTime));
  })().compute(buffers.dynamicState.count);

  return {
    buffers,
    dynamicNode,
    simTime,
    integratePose,
    dispatch: "renderer.compute(integratePose)",
    storageBytes: buffers.storageBytes,
  };
}
