import { WebGPURenderer, RenderPipeline, StorageInstancedBufferAttribute } from "three/webgpu";
import {
  Fn,
  storage,
  instancedArray,
  pass,
  mrt,
  renderOutput,
  workgroupBarrier,
  atomicAdd,
  atomicSub,
  atomicMax,
  atomicMin,
} from "three/tsl";

export const EFFECT_TIERS = {
  ultra: {
    poolCap: 65536,
    shellLayers: 5,
    wakeFamilies: 3,
    fieldOctaves: 3,
    bloomScale: 0.5,
    gpuMs: [0.8, 1.5],
  },
  high: {
    poolCap: 24576,
    shellLayers: 4,
    wakeFamilies: 2,
    fieldOctaves: 2,
    bloomScale: 0.5,
    gpuMs: [1.5, 3.0],
  },
  medium: {
    poolCap: 8192,
    shellLayers: 2,
    wakeFamilies: 1,
    fieldOctaves: 1,
    bloomScale: 0.25,
    gpuMs: [3.0, 5.0],
  },
  compat: {
    poolCap: 2048,
    shellLayers: 1,
    wakeFamilies: 1,
    fieldOctaves: 0,
    bloomScale: 0.25,
    gpuMs: [0, 0],
  },
};

export const HDR_HIERARCHY = {
  ordinarySurface: 1,
  laser: 10,
  projectile: 30,
  sparkFlash: 80,
};

export const STORAGE_SLICES = ["startPosition", "velocity", "accelAge", "render0", "transform"];

export function hashUint(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function random01(seed, lane = 0) {
  return hashUint((seed + Math.imul(lane + 1, 0x9e3779b9)) >>> 0) / 0xffffffff;
}

export function randomSigned(seed, lane = 0) {
  return random01(seed, lane) * 2 - 1;
}

function writeSlice(attribute, index, values) {
  const offset = index * attribute.itemSize;
  for (let i = 0; i < attribute.itemSize; i += 1) {
    attribute.array[offset + i] = values[i] ?? 0;
  }
  attribute.needsUpdate = true;
}

function copySlice(attribute, from, to) {
  const itemSize = attribute.itemSize;
  attribute.array.copyWithin(to * itemSize, from * itemSize, from * itemSize + itemSize);
  attribute.needsUpdate = true;
}

function readSlice(attribute, index) {
  const offset = index * attribute.itemSize;
  return Array.from(attribute.array.slice(offset, offset + attribute.itemSize));
}

function slicesEqual(a, b, epsilon = 1e-6) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => Math.abs(value - b[index]) <= epsilon);
}

export function createSpawnPacket({
  className = "spark",
  seed = 1,
  count = 1,
  position = [0, 0, 0],
  flowDirectionWorld = [0, -1, 0],
  emissionScale = 1,
  lifetimeSeconds = 1.3,
  radius = 0.4,
} = {}) {
  return {
    className,
    seed: seed >>> 0,
    count,
    position,
    flowDirectionWorld,
    emissionScale,
    lifetimeSeconds,
    radius,
  };
}

export class EffectPool {
  constructor({
    capacity = EFFECT_TIERS.medium.poolCap,
    className = "spark",
    lifetimeSeconds = 1.3,
    drag = 16,
    gravity = [0, -9.80665, 0],
  } = {}) {
    this.capacity = capacity;
    this.className = className;
    this.lifetimeSeconds = lifetimeSeconds;
    this.drag = drag;
    this.gravity = gravity;
    this.liveCount = 0;
    this.nextEntity = 1;
    this.swapCount = 0;
    this.overflowDrops = 0;
    this.allocationCounter = 0;

    this.startPosition = new StorageInstancedBufferAttribute(capacity, 4);
    this.velocity = new StorageInstancedBufferAttribute(capacity, 4);
    this.accelAge = new StorageInstancedBufferAttribute(capacity, 4);
    this.render0 = new StorageInstancedBufferAttribute(capacity, 4);
    this.transform = new StorageInstancedBufferAttribute(capacity, 16);

    this.entityToIndex = new Map();
    this.indexToEntity = new Int32Array(capacity);
    this.indexToEntity.fill(-1);
  }

  spawn(packet = createSpawnPacket()) {
    const spawned = [];
    for (let local = 0; local < packet.count; local += 1) {
      if (this.liveCount >= this.capacity) {
        this.overflowDrops += 1;
        break;
      }

      const index = this.liveCount;
      const entity = this.nextEntity;
      this.nextEntity += 1;
      this.liveCount += 1;

      const seed = hashUint(packet.seed + local);
      const lateralX = randomSigned(seed, 1) * 2;
      const lateralZ = randomSigned(seed, 2) * 2;
      const flow = packet.flowDirectionWorld;
      const flowBoost = 8 + random01(seed, 3) * 6;
      const radius = packet.radius * (0.7 + random01(seed, 4) * 0.6);
      const brightness = HDR_HIERARCHY.sparkFlash * packet.emissionScale;

      writeSlice(this.startPosition, index, [
        packet.position[0],
        packet.position[1],
        packet.position[2],
        0,
      ]);
      writeSlice(this.velocity, index, [
        flow[0] * flowBoost + lateralX,
        flow[1] * flowBoost,
        flow[2] * flowBoost + lateralZ,
        this.drag,
      ]);
      writeSlice(this.accelAge, index, [
        this.gravity[0],
        this.gravity[1],
        this.gravity[2],
        0,
      ]);
      writeSlice(this.render0, index, [radius, brightness, seed, 0]);
      writeSlice(this.transform, index, [
        1,
        0,
        0,
        packet.position[0],
        0,
        1,
        0,
        packet.position[1],
        0,
        0,
        1,
        packet.position[2],
        0,
        0,
        0,
        1,
      ]);

      this.entityToIndex.set(entity, index);
      this.indexToEntity[index] = entity;
      spawned.push(entity);
    }
    return spawned;
  }

  snapshotEntity(entity) {
    const index = this.entityToIndex.get(entity);
    if (index === undefined) return null;
    return {
      entity,
      index,
      startPosition: readSlice(this.startPosition, index),
      velocity: readSlice(this.velocity, index),
      accelAge: readSlice(this.accelAge, index),
      render0: readSlice(this.render0, index),
      transform: readSlice(this.transform, index),
    };
  }

  removeAt(index) {
    if (index < 0 || index >= this.liveCount) {
      throw new RangeError(`removeAt index ${index} outside live range ${this.liveCount}`);
    }

    const last = this.liveCount - 1;
    const removedEntity = this.indexToEntity[index];
    const movedEntity = this.indexToEntity[last];

    if (index !== last) {
      for (const key of STORAGE_SLICES) {
        copySlice(this[key], last, index);
      }
      this.indexToEntity[index] = movedEntity;
      this.entityToIndex.set(movedEntity, index);
      this.swapCount += 1;
    }

    this.entityToIndex.delete(removedEntity);
    this.indexToEntity[last] = -1;
    this.liveCount -= 1;
    return { removedEntity, movedEntity: index === last ? null : movedEntity, from: last, to: index };
  }

  update(dt) {
    const decay = Math.exp(-this.drag * dt);
    let index = 0;
    while (index < this.liveCount) {
      const positionOffset = index * this.startPosition.itemSize;
      const velocityOffset = index * this.velocity.itemSize;
      const accelOffset = index * this.accelAge.itemSize;
      const transformOffset = index * this.transform.itemSize;

      this.velocity.array[velocityOffset] =
        (this.velocity.array[velocityOffset] + this.accelAge.array[accelOffset] * dt) * decay;
      this.velocity.array[velocityOffset + 1] =
        (this.velocity.array[velocityOffset + 1] + this.accelAge.array[accelOffset + 1] * dt) *
        decay;
      this.velocity.array[velocityOffset + 2] =
        (this.velocity.array[velocityOffset + 2] + this.accelAge.array[accelOffset + 2] * dt) *
        decay;

      this.startPosition.array[positionOffset] += this.velocity.array[velocityOffset] * dt;
      this.startPosition.array[positionOffset + 1] +=
        this.velocity.array[velocityOffset + 1] * dt;
      this.startPosition.array[positionOffset + 2] +=
        this.velocity.array[velocityOffset + 2] * dt;
      this.accelAge.array[accelOffset + 3] += dt / this.lifetimeSeconds;

      this.transform.array[transformOffset + 3] = this.startPosition.array[positionOffset];
      this.transform.array[transformOffset + 7] = this.startPosition.array[positionOffset + 1];
      this.transform.array[transformOffset + 11] = this.startPosition.array[positionOffset + 2];

      if (this.accelAge.array[accelOffset + 3] >= 1) {
        this.removeAt(index);
      } else {
        index += 1;
      }
    }

    for (const key of STORAGE_SLICES) {
      this[key].needsUpdate = true;
    }
  }

  assertDenseRange() {
    for (let i = 0; i < this.liveCount; i += 1) {
      const entity = this.indexToEntity[i];
      if (entity < 0) throw new Error(`hole in live range at ${i}`);
      if (this.entityToIndex.get(entity) !== i) {
        throw new Error(`entityToIndex mismatch for ${entity}`);
      }
    }
    for (let i = this.liveCount; i < this.capacity; i += 1) {
      if (this.indexToEntity[i] !== -1) throw new Error(`stale entity outside live range ${i}`);
    }
    return true;
  }

  assertSnapshot(entity, snapshot) {
    const current = this.snapshotEntity(entity);
    if (!current) throw new Error(`missing entity ${entity}`);
    for (const key of STORAGE_SLICES) {
      if (!slicesEqual(current[key], snapshot[key])) {
        throw new Error(`dense-swap slice ${key} did not move with entity ${entity}`);
      }
    }
    return true;
  }

  dispose() {
    for (const key of STORAGE_SLICES) {
      this[key].array.fill(0);
    }
    this.entityToIndex.clear();
    this.indexToEntity.fill(-1);
    this.liveCount = 0;
  }
}

export function validateHDRHierarchy(hierarchy = HDR_HIERARCHY) {
  return (
    hierarchy.sparkFlash > hierarchy.projectile &&
    hierarchy.projectile > hierarchy.laser &&
    hierarchy.laser > hierarchy.ordinarySurface
  );
}

export async function createEffectRenderer(options = {}) {
  const renderer = new WebGPURenderer(options);
  await renderer.init();
  const tier = renderer.backend?.isWebGPUBackend ? "ultra" : "compat";
  return { renderer, tier, budget: EFFECT_TIERS[tier] };
}

export function createComputeDescriptors({ capacity = EFFECT_TIERS.medium.poolCap } = {}) {
  const startPositionNode = instancedArray(capacity, "vec4");
  const velocityNode = instancedArray(capacity, "vec4");
  const countersNode = storage(new StorageInstancedBufferAttribute(4, 4), "vec4", 4);
  const spawnUpdateCompactKernel = Fn(() => {
    workgroupBarrier();
  })().compute(capacity);

  return {
    startPositionNode,
    velocityNode,
    countersNode,
    spawnUpdateCompactKernel,
    atomics: [atomicAdd, atomicSub, atomicMax, atomicMin],
    dispatch: "renderer.computeAsync(spawnUpdateCompactKernel)",
    api: "renderer.computeAsync",
  };
}

export function createRenderPipelineContract({ scene, camera } = {}) {
  return {
    renderer: "WebGPURenderer",
    RenderPipeline,
    beautyPass: pass(scene ?? null, camera ?? null),
    mrt: mrt({
      output: "beauty",
      emissive: "effect emissive MRT target",
    }),
    emissive: {
      source: "MRT emissive",
      bloomInput: "BloomNode(emissive)",
    },
    final: renderOutput,
    toneMapOwner: "RenderPipeline outputColorTransform",
  };
}
