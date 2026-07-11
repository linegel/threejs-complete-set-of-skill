import {
  AdditiveBlending,
  BoxGeometry,
  IndirectStorageBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Sphere,
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
  Vector2,
  Vector3,
} from "three/webgpu";
import {
  Fn,
  If,
  Loop,
  abs,
  atomicAdd,
  atomicStore,
  atomicSub,
  cameraWorldMatrix,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  fract,
  instanceIndex,
  invocationLocalIndex,
  length,
  linearDepth,
  max,
  min,
  mix,
  normalize,
  positionLocal,
  select,
  sin,
  smoothstep,
  step,
  storage,
  uint,
  uniform,
  uvec4,
  uv,
  viewportLinearDepth,
  vec2,
  vec3,
  vec4,
  workgroupArray,
  workgroupBarrier,
} from "three/tsl";

const DEAD_ENTITY = 0xffffffff;
const DEFAULT_WORKGROUP_SIZE = 128;
const SMALL_DRAG_ARGUMENT = 1e-4;

export const GPU_EFFECT_STORAGE_BINDINGS = Object.freeze({
  resetCounters: 2,
  clearDestination: 6,
  integrateMarkAndRecycle: 6,
  scanBlocks: 3,
  scanBlockOffsets: 3,
  scatterMotion: 7,
  scatterAppearance: 7,
  scatterIdentity: 6,
  expandEventState: 5,
  expandEventIdentity: 5,
  publishIndirect: 2,
  resetState: 5,
  resetIdentity: 2,
  resetControl: 3,
  renderVertex: 8,
});
const MAX_STORAGE_BINDINGS = Math.max(...Object.values(GPU_EFFECT_STORAGE_BINDINGS));

/**
 * Exact constant-acceleration, linear-drag update used as the independent CPU
 * oracle for the GPU kernel.  `phi1` and `phi2` use their Taylor limits near
 * zero so the no-drag limit does not produce 0 / 0.
 */
export function integrateLinearDragExact({ position, velocity, acceleration, drag, dt }) {
  if (!(Number.isFinite(drag) && drag >= 0 && Number.isFinite(dt) && dt >= 0)) {
    throw new RangeError("drag and dt must be finite and non-negative");
  }

  const x = drag * dt;
  const phi1 = Math.abs(x) < SMALL_DRAG_ARGUMENT
    ? 1 - x / 2 + (x * x) / 6
    : -Math.expm1(-x) / x;
  const phi2 = Math.abs(x) < SMALL_DRAG_ARGUMENT
    ? 0.5 - x / 6 + (x * x) / 24
    : (x + Math.expm1(-x)) / (x * x);
  const decay = Math.exp(-x);
  const nextPosition = [0, 0, 0];
  const nextVelocity = [0, 0, 0];

  for (let lane = 0; lane < 3; lane += 1) {
    const v = Number(velocity[lane]);
    const a = Number(acceleration[lane]);
    nextPosition[lane] = Number(position[lane]) + v * dt * phi1 + a * dt * dt * phi2;
    nextVelocity[lane] = decay * v + a * dt * phi1;
  }

  return { position: nextPosition, velocity: nextVelocity, phi1, phi2, decay };
}

/**
 * Conservative object-space envelope for one GPU event page. The pool mesh is
 * kept at the identity transform and GPU positions are world-space, so this
 * sphere can be installed directly on the render geometry. Ignoring drag can
 * only enlarge the envelope; the lateral term includes both event-frame axes.
 */
export function computeEventEnvelopeSphere({
  position,
  lifetimeRange,
  radiusRange,
  speedRange,
  lateralSpeed,
  acceleration,
}) {
  const center = new Vector3().fromArray(position);
  if (![center.x, center.y, center.z].every(Number.isFinite)) {
    throw new RangeError("event position must contain three finite values");
  }
  const lifetime = Math.max(...lifetimeRange);
  const baseRadius = Math.max(...radiusRange);
  const axialSpeed = Math.max(...speedRange.map(Math.abs));
  const lateralMagnitude = Math.SQRT2 * lateralSpeed;
  const accelerationMagnitude = acceleration.length();
  const travel = (axialSpeed + lateralMagnitude) * lifetime +
    0.5 * accelerationMagnitude * lifetime * lifetime;
  return new Sphere(center, travel + baseRadius * 1.05);
}

export function exclusiveScanReference(marks) {
  const destinations = new Uint32Array(marks.length);
  let total = 0;
  for (let index = 0; index < marks.length; index += 1) {
    destinations[index] = total;
    total += marks[index] ? 1 : 0;
  }
  return { destinations, total };
}

export function compactSoAReference(state, marks) {
  const { destinations, total } = exclusiveScanReference(marks);
  const output = {};

  for (const [name, lane] of Object.entries(state)) {
    const itemSize = lane.itemSize;
    const array = new lane.array.constructor(total * itemSize);
    for (let source = 0; source < marks.length; source += 1) {
      if (!marks[source]) continue;
      const destination = destinations[source];
      for (let component = 0; component < itemSize; component += 1) {
        array[destination * itemSize + component] = lane.array[source * itemSize + component];
      }
    }
    output[name] = { itemSize, array };
  }

  return { output, destinations, total };
}

export function validateCompactionReadback({
  indexToEntity,
  entityToIndex,
  liveCount,
  indirect,
  freeCount = null,
}) {
  if (!Number.isInteger(liveCount) || liveCount < 0 || liveCount > indexToEntity.length) {
    throw new RangeError("liveCount is outside the indexToEntity allocation");
  }
  if (indirect?.[1] !== liveCount) {
    throw new Error(`indirect instanceCount ${indirect?.[1]} does not equal liveCount ${liveCount}`);
  }
  const seen = new Set();
  for (let index = 0; index < liveCount; index += 1) {
    const entity = indexToEntity[index];
    if (entity === DEAD_ENTITY || entity >= entityToIndex.length) {
      throw new Error(`invalid entity ${entity} in dense range at ${index}`);
    }
    if (seen.has(entity)) throw new Error(`duplicate entity ${entity} in dense range`);
    seen.add(entity);
    if (entityToIndex[entity] !== index) {
      throw new Error(`entityToIndex mismatch for entity ${entity}`);
    }
  }
  for (let index = liveCount; index < indexToEntity.length; index += 1) {
    if (indexToEntity[index] !== DEAD_ENTITY) {
      throw new Error(`stale indexToEntity lane ${index} outside dense range`);
    }
  }
  for (let entity = 0; entity < entityToIndex.length; entity += 1) {
    if (!seen.has(entity) && entityToIndex[entity] !== DEAD_ENTITY) {
      throw new Error(`stale entityToIndex lane for dead entity ${entity}`);
    }
  }
  if (freeCount !== null && freeCount !== indexToEntity.length - liveCount) {
    throw new Error(
      `free-list count ${freeCount} does not equal capacity-liveCount ${indexToEntity.length - liveCount}`,
    );
  }
  return true;
}

function createFloatLane(capacity, itemSize = 4) {
  return new StorageInstancedBufferAttribute(capacity, itemSize);
}

function createUintLane(capacity, fill = 0) {
  const data = new Uint32Array(capacity);
  data.fill(fill >>> 0);
  return new StorageBufferAttribute(data, 1);
}

function createStateSet(capacity, name) {
  const set = {
    positionAge: createFloatLane(capacity),
    velocityLifetime: createFloatLane(capacity),
    appearance: createFloatLane(capacity),
    axisSpin: createFloatLane(capacity),
    entityId: createUintLane(capacity, DEAD_ENTITY),
  };
  for (const [laneName, attribute] of Object.entries(set)) {
    attribute.name = `${name}:${laneName}`;
  }
  return set;
}

function stateNodes(set, capacity) {
  return {
    positionAge: storage(set.positionAge, "vec4", capacity),
    velocityLifetime: storage(set.velocityLifetime, "vec4", capacity),
    appearance: storage(set.appearance, "vec4", capacity),
    axisSpin: storage(set.axisSpin, "vec4", capacity),
    entityId: storage(set.entityId, "uint", capacity),
  };
}

const hashUintNode = Fn(({ value }) => {
  const state = uint(value).toVar("effectHashState");
  state.assign(state.bitXor(state.shiftRight(uint(16))));
  state.assign(state.mul(uint(0x7feb352d)));
  state.assign(state.bitXor(state.shiftRight(uint(15))));
  state.assign(state.mul(uint(0x846ca68b)));
  state.assign(state.bitXor(state.shiftRight(uint(16))));
  return state;
});

const hashFloatNode = Fn(({ value }) =>
  float(hashUintNode({ value }).shiftRight(uint(8))).add(0.5).mul(1 / 0x1000000));

function makeKernelSet(pool, sourceSet, destinationSet, label) {
  const capacity = pool.capacity;
  const workgroupSize = pool.workgroupSize;
  const blockCount = pool.blockCount;
  const source = stateNodes(sourceSet, capacity);
  const destination = stateNodes(destinationSet, capacity);
  const marks = storage(pool.marks, "uint", capacity);
  const localDestinations = storage(pool.destinations, "uint", capacity);
  const blockCounts = storage(pool.blockCounts, "uint", blockCount);
  const blockOffsets = storage(pool.blockOffsets, "uint", blockCount);
  const entityToIndex = storage(pool.entityToIndex, "uint", capacity);
  const freeIds = storage(pool.freeIds, "uint", capacity);
  const freeCount = storage(pool.freeCount, "uint", 1);
  const counters = storage(pool.counters, "uvec4", 1);
  const indirect = storage(pool.indirect, "uint", 5);

  const reset = Fn(() => {
    counters.element(uint(0)).assign(uvec4(0));
    indirect.element(uint(0)).assign(uint(pool.indexCount));
    indirect.element(uint(1)).assign(uint(0));
    indirect.element(uint(2)).assign(uint(0));
    indirect.element(uint(3)).assign(uint(0));
    indirect.element(uint(4)).assign(uint(0));
  })().compute(1).setName(`${label}:reset-counters`);

  // Kept separate from integration so no compute entry point binds more than
  // the WebGPU-guaranteed eight storage buffers per shader stage.
  const clearDestination = Fn(() => {
    const index = instanceIndex;
    destination.positionAge.element(index).assign(vec4(0));
    destination.velocityLifetime.element(index).assign(vec4(0));
    destination.appearance.element(index).assign(vec4(0));
    destination.axisSpin.element(index).assign(vec4(0));
    destination.entityId.element(index).assign(uint(DEAD_ENTITY));
    entityToIndex.element(index).assign(uint(DEAD_ENTITY));
  })().compute(capacity, [workgroupSize]).setName(`${label}:clear-destination`);

  const integrateAndMark = Fn(() => {
    const index = instanceIndex;
    const state = source.positionAge.element(index);
    const velocityState = source.velocityLifetime.element(index);
    const age = state.w;
    const lifetime = velocityState.w;
    const wasAlive = lifetime.greaterThan(0).and(age.lessThan(lifetime));
    const nextAge = age.add(pool.deltaSecondsNode);
    const x = max(pool.dragNode.mul(pool.deltaSecondsNode), 0);
    const x2 = x.mul(x);
    const decay = exp(x.negate());
    const phi1Series = float(1).sub(x.mul(0.5)).add(x2.div(6));
    const phi2Series = float(0.5).sub(x.div(6)).add(x2.div(24));
    const safeX = max(x, SMALL_DRAG_ARGUMENT);
    const phi1 = select(
      x.lessThan(SMALL_DRAG_ARGUMENT),
      phi1Series,
      float(1).sub(decay).div(safeX),
    );
    const phi2 = select(
      x.lessThan(SMALL_DRAG_ARGUMENT),
      phi2Series,
      x.add(decay).sub(1).div(safeX.mul(safeX)),
    );
    const acceleration = pool.accelerationNode;
    const nextPosition = state.xyz
      .add(velocityState.xyz.mul(pool.deltaSecondsNode).mul(phi1))
      .add(acceleration.mul(pool.deltaSecondsNode.mul(pool.deltaSecondsNode)).mul(phi2));
    const nextVelocity = velocityState.xyz.mul(decay)
      .add(acceleration.mul(pool.deltaSecondsNode).mul(phi1));
    const survives = wasAlive.and(nextAge.lessThan(lifetime));

    If(wasAlive, () => {
      source.positionAge.element(index).assign(vec4(nextPosition, nextAge));
      source.velocityLifetime.element(index).assign(vec4(nextVelocity, lifetime));
    });
    If(wasAlive.and(survives.not()), () => {
      const freeSlot = atomicAdd(freeCount.element(uint(0)), uint(1));
      If(freeSlot.lessThan(uint(capacity)), () => {
        freeIds.element(freeSlot).assign(source.entityId.element(index));
      });
    });
    marks.element(index).assign(select(survives, uint(1), uint(0)));
  })().compute(capacity, [workgroupSize]).setName(`${label}:integrate-mark`);

  const scanBlocks = Fn(() => {
    const index = instanceIndex;
    const localIndex = invocationLocalIndex;
    const block = index.div(uint(workgroupSize));
    const shared = workgroupArray("uint", workgroupSize).setName(`${label}ScanScratch`);
    shared.element(localIndex).assign(marks.element(index));
    workgroupBarrier();

    for (let offset = 1; offset < workgroupSize; offset *= 2) {
      const stride = offset * 2;
      If(localIndex.add(1).mod(uint(stride)).equal(uint(0)), () => {
        const left = localIndex.sub(uint(offset));
        shared.element(localIndex).addAssign(shared.element(left));
      });
      workgroupBarrier();
    }

    If(localIndex.equal(uint(workgroupSize - 1)), () => {
      blockCounts.element(block).assign(shared.element(localIndex));
      shared.element(localIndex).assign(uint(0));
    });
    workgroupBarrier();

    for (let offset = workgroupSize / 2; offset >= 1; offset /= 2) {
      const stride = offset * 2;
      If(localIndex.add(1).mod(uint(stride)).equal(uint(0)), () => {
        const left = localIndex.sub(uint(offset));
        const leftValue = uint(shared.element(left)).toVar(`${label}ScanLeft${offset}`);
        shared.element(left).assign(shared.element(localIndex));
        shared.element(localIndex).addAssign(leftValue);
      });
      workgroupBarrier();
    }

    localDestinations.element(index).assign(shared.element(localIndex));
  })().compute(capacity, [workgroupSize]).setName(`${label}:exclusive-scan-blocks`);

  const scanBlockOffsets = Fn(() => {
    const running = uint(0).toVar(`${label}BlockRunningTotal`);
    Loop(
      { start: uint(0), end: uint(blockCount), type: "uint", name: "blockIndex" },
      ({ blockIndex }) => {
        blockOffsets.element(blockIndex).assign(running);
        running.addAssign(blockCounts.element(blockIndex));
      },
    );
    counters.element(uint(0)).x.assign(running);
  })().compute(1).setName(`${label}:exclusive-scan-block-sums`);

  const scatterMotion = Fn(() => {
    const sourceIndex = instanceIndex;
    const block = sourceIndex.div(uint(workgroupSize));
    If(marks.element(sourceIndex).equal(uint(1)), () => {
      const destinationIndex = localDestinations.element(sourceIndex)
        .add(blockOffsets.element(block));
      destination.positionAge.element(destinationIndex).assign(
        source.positionAge.element(sourceIndex),
      );
      destination.velocityLifetime.element(destinationIndex).assign(
        source.velocityLifetime.element(sourceIndex),
      );
    });
  })().compute(capacity, [workgroupSize]).setName(`${label}:scatter-motion-lanes`);

  const scatterAppearance = Fn(() => {
    const sourceIndex = instanceIndex;
    const block = sourceIndex.div(uint(workgroupSize));
    If(marks.element(sourceIndex).equal(uint(1)), () => {
      const destinationIndex = localDestinations.element(sourceIndex)
        .add(blockOffsets.element(block));
      destination.appearance.element(destinationIndex).assign(
        source.appearance.element(sourceIndex),
      );
      destination.axisSpin.element(destinationIndex).assign(
        source.axisSpin.element(sourceIndex),
      );
    });
  })().compute(capacity, [workgroupSize]).setName(`${label}:scatter-appearance-lanes`);

  const scatterIdentity = Fn(() => {
    const sourceIndex = instanceIndex;
    const block = sourceIndex.div(uint(workgroupSize));
    If(marks.element(sourceIndex).equal(uint(1)), () => {
      const destinationIndex = localDestinations.element(sourceIndex)
        .add(blockOffsets.element(block));
      const entity = source.entityId.element(sourceIndex);
      destination.entityId.element(destinationIndex).assign(entity);
      entityToIndex.element(entity).assign(destinationIndex);
    });
  })().compute(capacity, [workgroupSize]).setName(`${label}:scatter-stable-identity`);

  const expandEventState = Fn(() => {
    const localIndex = instanceIndex;
    const survivorCount = counters.element(uint(0)).x;
    const eventCount = min(pool.eventCountNode, uint(capacity));
    const destinationIndex = survivorCount.add(localIndex);
    const withinEvent = localIndex.lessThan(eventCount);
    const withinCapacity = destinationIndex.lessThan(uint(capacity));
    If(withinEvent.and(withinCapacity), () => {
      const baseSeed = pool.eventSeedNode.add(localIndex.mul(uint(0x9e3779b9)));
      const h0 = hashUintNode({ value: baseSeed });
      const h1 = hashUintNode({ value: h0.add(uint(0x68bc21eb)) });
      const h2 = hashUintNode({ value: h1.add(uint(0x02e5be93)) });
      const r0 = hashFloatNode({ value: h0 });
      const r1 = hashFloatNode({ value: h1 });
      const r2 = hashFloatNode({ value: h2 });
      const tangentSeed = vec3(r0.mul(2).sub(1), r1.mul(2).sub(1), r2.mul(2).sub(1));
      const flow = normalize(pool.eventFlowNode);
      const fallbackAxis = select(
        abs(flow.y).lessThan(0.95),
        vec3(0, 1, 0),
        vec3(1, 0, 0),
      );
      const right = normalize(cross(fallbackAxis, flow));
      const up = normalize(cross(flow, right));
      const lateral = right.mul(tangentSeed.x).add(up.mul(tangentSeed.y));
      const speed = mix(pool.eventSpeedRangeNode.x, pool.eventSpeedRangeNode.y, r2);
      const lifetime = mix(pool.eventLifetimeRangeNode.x, pool.eventLifetimeRangeNode.y, r1);
      const radius = mix(pool.eventRadiusRangeNode.x, pool.eventRadiusRangeNode.y, r0);
      const initialVelocity = flow.mul(speed).add(lateral.mul(pool.eventLateralSpeedNode));
      const axis = normalize(tangentSeed.add(vec3(0.001, 0.002, 0.003)));

      destination.positionAge.element(destinationIndex).assign(
        vec4(pool.eventPositionNode, float(0)),
      );
      destination.velocityLifetime.element(destinationIndex).assign(
        vec4(initialVelocity, lifetime),
      );
      destination.appearance.element(destinationIndex).assign(
        vec4(radius, pool.eventEmissionNode, float(h0), float(0)),
      );
      destination.axisSpin.element(destinationIndex).assign(
        vec4(axis, mix(1.5, 7.0, r2)),
      );
    });
  })().compute(capacity, [workgroupSize]).setName(`${label}:expand-event-state`);

  const expandEventIdentity = Fn(() => {
    const localIndex = instanceIndex;
    const survivorCount = counters.element(uint(0)).x;
    const eventCount = min(pool.eventCountNode, uint(capacity));
    const destinationIndex = survivorCount.add(localIndex);
    const withinEvent = localIndex.lessThan(eventCount);
    const withinCapacity = destinationIndex.lessThan(uint(capacity));
    If(withinEvent.and(withinCapacity), () => {
      // Exactly capacity-survivorCount ids are on the free stack after the
      // integration dispatch. Each spawn invocation performs one atomic pop;
      // therefore no two live entities can receive the same stable id.
      const previousFreeCount = atomicSub(freeCount.element(uint(0)), uint(1));
      const freeSlot = previousFreeCount.sub(uint(1));
      const entity = freeIds.element(freeSlot);
      destination.entityId.element(destinationIndex).assign(entity);
      entityToIndex.element(entity).assign(destinationIndex);
    });
  })().compute(capacity, [workgroupSize]).setName(`${label}:expand-stable-identity`);

  const publishIndirect = Fn(() => {
    const survivorCount = counters.element(uint(0)).x;
    const spawnCapacity = uint(capacity).sub(min(survivorCount, uint(capacity)));
    const spawned = min(pool.eventCountNode, spawnCapacity);
    const live = min(survivorCount.add(spawned), uint(capacity));
    counters.element(uint(0)).y.assign(spawned);
    counters.element(uint(0)).z.assign(live);
    counters.element(uint(0)).w.assign(pool.eventCountNode.sub(spawned));
    indirect.element(uint(1)).assign(live);
  })().compute(1).setName(`${label}:publish-indirect-count`);

  return {
    reset,
    clearDestination,
    integrateAndMark,
    scanBlocks,
    scanBlockOffsets,
    scatterMotion,
    scatterAppearance,
    scatterIdentity,
    expandEventState,
    expandEventIdentity,
    publishIndirect,
  };
}

function queueKernelSet(renderer, kernels) {
  renderer.compute(kernels.reset);
  renderer.compute(kernels.clearDestination);
  renderer.compute(kernels.integrateAndMark);
  renderer.compute(kernels.scanBlocks);
  renderer.compute(kernels.scanBlockOffsets);
  renderer.compute(kernels.scatterMotion);
  renderer.compute(kernels.scatterAppearance);
  renderer.compute(kernels.scatterIdentity);
  renderer.compute(kernels.expandEventState);
  renderer.compute(kernels.expandEventIdentity);
  renderer.compute(kernels.publishIndirect);
}

function makeResetKernels(pool) {
  const clearState = (set, label) => {
    const state = stateNodes(set, pool.capacity);
    return Fn(() => {
      const index = instanceIndex;
      state.positionAge.element(index).assign(vec4(0));
      state.velocityLifetime.element(index).assign(vec4(0));
      state.appearance.element(index).assign(vec4(0));
      state.axisSpin.element(index).assign(vec4(0));
      state.entityId.element(index).assign(uint(DEAD_ENTITY));
    })().compute(pool.capacity, [pool.workgroupSize]).setName(`${pool.kind}:reset-${label}`);
  };
  const entityToIndex = storage(pool.entityToIndex, "uint", pool.capacity);
  const freeIds = storage(pool.freeIds, "uint", pool.capacity);
  const resetIdentity = Fn(() => {
    const index = instanceIndex;
    entityToIndex.element(index).assign(uint(DEAD_ENTITY));
    freeIds.element(index).assign(index);
  })().compute(pool.capacity, [pool.workgroupSize]).setName(`${pool.kind}:reset-identity-free-stack`);
  const freeCount = storage(pool.freeCount, "uint", 1);
  const counters = storage(pool.counters, "uvec4", 1);
  const indirect = storage(pool.indirect, "uint", 5);
  const resetControl = Fn(() => {
    atomicStore(freeCount.element(uint(0)), uint(pool.capacity));
    counters.element(uint(0)).assign(uvec4(0));
    indirect.element(uint(0)).assign(uint(pool.indexCount));
    indirect.element(uint(1)).assign(uint(0));
    indirect.element(uint(2)).assign(uint(0));
    indirect.element(uint(3)).assign(uint(0));
    indirect.element(uint(4)).assign(uint(0));
  })().compute(1).setName(`${pool.kind}:reset-control`);
  return {
    stateA: clearState(pool.stateA, "state-A"),
    stateB: clearState(pool.stateB, "state-B"),
    identity: resetIdentity,
    control: resetControl,
  };
}

/**
 * Native-WebGPU SoA pool.  A and B bindings are both constructed once; every
 * step executes ordered mark -> hierarchical exclusive scan -> scatter ->
 * bounded event expansion -> indirect-count publication and flips the active
 * set.  No CPU particle loop or live-count readback is used in the frame path.
 */
export class GPUCompactionEffectPool {
  constructor({
    capacity = 8192,
    workgroupSize = DEFAULT_WORKGROUP_SIZE,
    indexedGeometry = null,
    kind = "spark",
  } = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0 || capacity % workgroupSize !== 0) {
      throw new RangeError("capacity must be a positive multiple of workgroupSize");
    }
    if ((workgroupSize & (workgroupSize - 1)) !== 0) {
      throw new RangeError("workgroupSize must be a power of two");
    }

    this.capacity = capacity;
    this.workgroupSize = workgroupSize;
    this.blockCount = capacity / workgroupSize;
    this.kind = kind;
    this.stateA = createStateSet(capacity, `${kind}:A`);
    this.stateB = createStateSet(capacity, `${kind}:B`);
    this.entityToIndex = createUintLane(capacity, DEAD_ENTITY);
    const freeIds = new Uint32Array(capacity);
    for (let index = 0; index < capacity; index += 1) freeIds[index] = index;
    this.freeIds = new StorageBufferAttribute(freeIds, 1);
    this.freeCount = new StorageBufferAttribute(Uint32Array.of(capacity), 1);
    this.marks = createUintLane(capacity);
    this.destinations = createUintLane(capacity);
    this.blockCounts = createUintLane(this.blockCount);
    this.blockOffsets = createUintLane(this.blockCount);
    this.counters = new StorageBufferAttribute(new Uint32Array(4), 4);
    this.indirect = new IndirectStorageBufferAttribute(5, 1);
    this.activeSetNode = uniform(0, "uint").setName(`${kind}ActiveStateSet`);
    this.deltaSecondsNode = uniform(1 / 60).setName(`${kind}DeltaSeconds`);
    this.dragNode = uniform(kind === "debris" ? 0.4 : 4).setName(`${kind}Drag`);
    this.accelerationNode = uniform(new Vector3(0, -9.80665, 0), "vec3").setName(
      `${kind}Acceleration`,
    );
    this.eventCountNode = uniform(0, "uint").setName(`${kind}EventCount`);
    this.eventSeedNode = uniform(1, "uint").setName(`${kind}EventSeed`);
    this.eventPositionNode = uniform(new Vector3(), "vec3").setName(`${kind}EventPosition`);
    this.eventFlowNode = uniform(new Vector3(0, 0, -1), "vec3").setName(`${kind}EventFlow`);
    this.eventLifetimeRangeNode = uniform(
      kind === "debris" ? new Vector2(2, 4) : new Vector2(0.65, 1.3),
      "vec2",
    ).setName(`${kind}LifetimeRange`);
    this.eventRadiusRangeNode = uniform(
      kind === "debris" ? new Vector2(0.08, 0.22) : new Vector2(0.018, 0.065),
      "vec2",
    ).setName(`${kind}RadiusRange`);
    this.eventSpeedRangeNode = uniform(
      kind === "debris" ? new Vector2(1.5, 5) : new Vector2(6, 14),
      "vec2",
    ).setName(`${kind}SpeedRange`);
    this.eventLateralSpeedNode = uniform(kind === "debris" ? 2.5 : 3.5).setName(
      `${kind}LateralSpeed`,
    );
    this.eventEmissionNode = uniform(kind === "debris" ? 3 : 48).setName(
      `${kind}Emission`,
    );
    this.eventQueued = false;
    this.activeSet = 0;
    this.frameIndex = 0;
    this.disposed = false;
    this.conservativeBounds = new Sphere(new Vector3(), -1);
    this.renderGeometries = new Set();
    this.indexCount = indexedGeometry?.index?.count ?? 6;
    this.indirect.array.set([this.indexCount, 0, 0, 0, 0]);
    this.indirect.needsUpdate = true;
    this.kernelsAB = makeKernelSet(this, this.stateA, this.stateB, `${kind}:A-to-B`);
    this.kernelsBA = makeKernelSet(this, this.stateB, this.stateA, `${kind}:B-to-A`);
    this.resetKernels = makeResetKernels(this);
  }

  queueEvent({
    count,
    seed = 1,
    position = [0, 0, 0],
    flowDirectionWorld = [0, 0, -1],
    lifetimeRange = this.kind === "debris" ? [2, 4] : [0.65, 1.3],
    radiusRange = this.kind === "debris" ? [0.08, 0.22] : [0.018, 0.065],
    speedRange = this.kind === "debris" ? [1.5, 5] : [6, 14],
    lateralSpeed = this.kind === "debris" ? 2.5 : 3.5,
    emission = this.kind === "debris" ? 3 : 48,
  }) {
    if (!Number.isInteger(count) || count < 0 || count > this.capacity) {
      throw new RangeError(`event count must be an integer in [0, ${this.capacity}]`);
    }
    const flow = new Vector3().fromArray(flowDirectionWorld);
    if (flow.lengthSq() <= 1e-12) throw new RangeError("flowDirectionWorld must be nonzero");
    for (const [name, range] of Object.entries({ lifetimeRange, radiusRange, speedRange })) {
      if (!Array.isArray(range) || range.length !== 2 ||
          !range.every((value) => Number.isFinite(value) && value >= 0) || range[0] > range[1]) {
        throw new RangeError(`${name} must be an ordered finite non-negative pair`);
      }
    }
    if (!(Number.isFinite(lateralSpeed) && lateralSpeed >= 0 && Number.isFinite(emission))) {
      throw new RangeError("lateralSpeed must be non-negative and emission must be finite");
    }
    flow.normalize();
    this.eventCountNode.value = count >>> 0;
    this.eventSeedNode.value = seed >>> 0;
    this.eventPositionNode.value.fromArray(position);
    this.eventFlowNode.value.copy(flow);
    this.eventLifetimeRangeNode.value.set(...lifetimeRange);
    this.eventRadiusRangeNode.value.set(...radiusRange);
    this.eventSpeedRangeNode.value.set(...speedRange);
    this.eventLateralSpeedNode.value = lateralSpeed;
    this.eventEmissionNode.value = emission;
    this.eventQueued = true;
    if (count > 0) {
      const eventBounds = computeEventEnvelopeSphere({
        position,
        lifetimeRange,
        radiusRange,
        speedRange,
        lateralSpeed,
        acceleration: this.accelerationNode.value,
      });
      this.conservativeBounds.union(eventBounds);
      this.updateRenderBounds();
    }
  }

  updateRenderBounds() {
    const bounds = this.conservativeBounds.isEmpty()
      ? new Sphere(new Vector3(), 0)
      : this.conservativeBounds;
    for (const geometry of this.renderGeometries) {
      geometry.boundingSphere ??= new Sphere();
      geometry.boundingSphere.copy(bounds);
    }
  }

  step(renderer, deltaSeconds) {
    if (this.disposed) throw new Error("GPUCompactionEffectPool used after dispose()");
    if (!renderer?.backend?.isWebGPUBackend) {
      throw new Error("Native WebGPU is required for GPU effect compaction.");
    }
    const adapterLimit = renderer.backend?.device?.limits?.maxStorageBuffersPerShaderStage;
    if (Number.isFinite(adapterLimit) && adapterLimit < MAX_STORAGE_BINDINGS) {
      throw new Error(
        `GPU effect pool requires ${MAX_STORAGE_BINDINGS} storage buffers per shader stage; adapter exposes ${adapterLimit}`,
      );
    }
    if (!(Number.isFinite(deltaSeconds) && deltaSeconds >= 0)) {
      throw new RangeError("deltaSeconds must be finite and non-negative");
    }
    if (!this.eventQueued) this.eventCountNode.value = 0;
    this.deltaSecondsNode.value = Math.min(deltaSeconds, 1 / 15);
    queueKernelSet(renderer, this.activeSet === 0 ? this.kernelsAB : this.kernelsBA);
    this.activeSet = 1 - this.activeSet;
    this.activeSetNode.value = this.activeSet;
    this.eventQueued = false;
    this.frameIndex += 1;
  }

  reset(renderer) {
    if (this.disposed) throw new Error("GPUCompactionEffectPool used after dispose()");
    if (!renderer?.backend?.isWebGPUBackend) {
      throw new Error("Native WebGPU is required for GPU effect reset.");
    }
    renderer.compute(this.resetKernels.stateA);
    renderer.compute(this.resetKernels.stateB);
    renderer.compute(this.resetKernels.identity);
    renderer.compute(this.resetKernels.control);
    this.activeSet = 0;
    this.activeSetNode.value = 0;
    this.eventCountNode.value = 0;
    this.eventQueued = false;
    this.frameIndex = 0;
    this.conservativeBounds.makeEmpty();
    this.updateRenderBounds();
  }

  createRenderObject({ geometry = null } = {}) {
    const renderGeometry = geometry ?? (this.kind === "debris"
      ? new BoxGeometry(1, 1, 1)
      : new PlaneGeometry(0.08, 0.08));
    this.indexCount = renderGeometry.index?.count ?? renderGeometry.attributes.position.count;
    this.indirect.array[0] = this.indexCount;
    this.indirect.needsUpdate = true;
    renderGeometry.setIndirect(this.indirect, 0);
    this.renderGeometries.add(renderGeometry);
    this.updateRenderBounds();
    const a = stateNodes(this.stateA, this.capacity);
    const b = stateNodes(this.stateB, this.capacity);
    const state = {
      positionAge: select(
        this.activeSetNode.equal(uint(0)),
        a.positionAge.element(instanceIndex),
        b.positionAge.element(instanceIndex),
      ),
      appearance: select(
        this.activeSetNode.equal(uint(0)),
        a.appearance.element(instanceIndex),
        b.appearance.element(instanceIndex),
      ),
      axisSpin: select(
        this.activeSetNode.equal(uint(0)),
        a.axisSpin.element(instanceIndex),
        b.axisSpin.element(instanceIndex),
      ),
    };
    const material = this.kind === "debris"
      ? new MeshStandardNodeMaterial({
        transparent: false,
        depthTest: true,
        depthWrite: true,
        roughness: 0.62,
        metalness: 0.18,
      })
      : new MeshBasicNodeMaterial({
        transparent: true,
        depthTest: true,
        depthWrite: false,
      });
    const normalizedAge = clamp(
      state.positionAge.w.div(
        select(
          this.activeSetNode.equal(uint(0)),
          a.velocityLifetime.element(instanceIndex).w,
          b.velocityLifetime.element(instanceIndex).w,
        ),
      ),
      0,
      1,
    );
    const radius = state.appearance.x.mul(float(1).sub(normalizedAge).add(0.02));

    if (this.kind === "debris") {
      const halfAngle = state.positionAge.w.mul(state.axisSpin.w).mul(0.5);
      const quaternionVector = state.axisSpin.xyz.mul(sin(halfAngle));
      const quaternionW = cos(halfAngle);
      const local = positionLocal.mul(radius);
      const twiceCross = cross(quaternionVector, local).mul(2);
      const rotated = local.add(twiceCross.mul(quaternionW)).add(
        cross(quaternionVector, twiceCross),
      );
      material.positionNode = rotated.add(state.positionAge.xyz);
      const dissolve = smoothstep(0.55, 0.98, normalizedAge);
      const geometryCell = positionLocal.mul(11.173).add(
        float(state.appearance.z).mul(1 / 0x1000000),
      );
      const geometryHash = fract(
        sin(dot(geometryCell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453),
      );
      const cutout = step(dissolve, geometryHash);
      material.colorNode = mix(
        vec3(0.16, 0.11, 0.08),
        vec3(2.8, 0.42, 0.05),
        dissolve,
      );
      material.emissiveNode = vec3(2.8, 0.24, 0.02)
        .mul(dissolve)
        .mul(state.appearance.y)
        .mul(cutout);
      material.opacityNode = cutout;
      material.alphaTestNode = float(0.5);
      material.maskShadowNode = cutout.greaterThan(0.5);
      material.userData.dissolveContract = "geometry-space deterministic cutout; visible/shadow share mask";
    } else {
      const localBillboard = vec4(
        positionLocal.x.mul(radius),
        positionLocal.y.mul(radius),
        0,
        0,
      );
      material.positionNode = state.positionAge.xyz.add(cameraWorldMatrix.mul(localBillboard).xyz);
      const centeredUv = uv().sub(vec2(0.5));
      const radial = length(centeredUv);
      const softIntersection = smoothstep(
        0,
        0.0035,
        viewportLinearDepth.sub(linearDepth()),
      );
      const coverage = smoothstep(0.5, 0.18, radial)
        .mul(float(1).sub(normalizedAge))
        .mul(softIntersection);
      const emissionColor = mix(
        vec3(1, 0.025, 0.004),
        vec3(1, 0.27, 0.052),
        float(1).sub(normalizedAge),
      );
      const emission = emissionColor
        .mul(state.appearance.y)
        .mul(float(1).sub(normalizedAge).add(0.08));
      material.colorNode = emission.mul(0.06);
      material.emissiveNode = emission.mul(coverage);
      material.opacityNode = coverage;
      material.depthWrite = false;
      material.blending = AdditiveBlending;
      material.userData.radiusSource = "appearance.x GPU lane";
      material.userData.emissionSource = "appearance.y GPU lane";
      material.userData.softDepth = "live viewport depth versus current linear fragment depth";
    }

    const mesh = new Mesh(renderGeometry, material);
    mesh.name = `${this.kind}:gpu-indirect-render`;
    mesh.frustumCulled = true;
    mesh.castShadow = this.kind === "debris";
    mesh.receiveShadow = false;
    mesh.userData.effectPool = this;
    mesh.userData.boundsPolicy = "conservative analytic event-envelope union";
    return mesh;
  }

  describeResources() {
    const floatLanesPerSet = 4 * 4;
    const floatBytesPerSet = this.capacity * floatLanesPerSet * 4;
    const uintStateBytesPerSet = this.capacity * 4;
    const identityBytes = this.entityToIndex.array.byteLength +
      this.freeIds.array.byteLength + this.freeCount.array.byteLength;
    const scratchBytes = (this.capacity * 2 + this.blockCount * 2) * 4;
    const stateBytes = 2 * (floatBytesPerSet + uintStateBytesPerSet);
    const controlBytes = this.counters.array.byteLength + this.indirect.array.byteLength;
    return {
      stateSets: 2,
      stateBytes,
      identityBytes,
      scratchBytes,
      controlBytes,
      indirectBytes: this.indirect.array.byteLength,
      totalBytes: stateBytes + identityBytes + scratchBytes + controlBytes,
      command: "indexed indirect [indexCount, instanceCount, firstIndex, baseVertex, firstInstance]",
      compaction: "mark + two-level exclusive scan + scatter",
      hotReadback: false,
      storageBindingsByKernel: GPU_EFFECT_STORAGE_BINDINGS,
      maximumStorageBuffersInAnyKernel: MAX_STORAGE_BINDINGS,
      guaranteedWebGPUMinimum: 8,
      boundsPolicy: "conservative analytic event-envelope union; drag ignored for an upper bound",
      boundingSphere: this.conservativeBounds.isEmpty()
        ? { center: [0, 0, 0], radius: 0 }
        : {
          center: this.conservativeBounds.center.toArray(),
          radius: this.conservativeBounds.radius,
        },
    };
  }

  describePipeline() {
    return {
      activeSet: this.activeSet === 0 ? "A" : "B",
      dispatchOrder: [
        "reset-counters",
        "clear-destination",
        "integrate-mark",
        "exclusive-scan-blocks",
        "exclusive-scan-block-sums",
        "scatter-motion-lanes",
        "scatter-appearance-lanes",
        "scatter-stable-identity",
        "expand-event-state",
        "expand-stable-identity",
        "publish-indirect-count",
      ],
      dispatchesPerStep: 11,
      storageBindingsByKernel: GPU_EFFECT_STORAGE_BINDINGS,
      maximumStorageBuffersInAnyKernel: MAX_STORAGE_BINDINGS,
      frameIndex: this.frameIndex,
      indirectCountOwner: "publish-indirect-count",
      simulationReadback: "none",
      resetDispatches: 4,
    };
  }

  async readValidationState(renderer) {
    if (typeof renderer?.getArrayBufferAsync !== "function") {
      throw new Error("renderer.getArrayBufferAsync is required for validation readback");
    }
    const active = this.activeSet === 0 ? this.stateA : this.stateB;
    const [
      counterBuffer,
      indirectBuffer,
      indexToEntityBuffer,
      entityToIndexBuffer,
      freeCountBuffer,
      positionAgeBuffer,
      velocityLifetimeBuffer,
      appearanceBuffer,
      axisSpinBuffer,
    ] = await Promise.all([
      renderer.getArrayBufferAsync(this.counters),
      renderer.getArrayBufferAsync(this.indirect),
      renderer.getArrayBufferAsync(active.entityId),
      renderer.getArrayBufferAsync(this.entityToIndex),
      renderer.getArrayBufferAsync(this.freeCount),
      renderer.getArrayBufferAsync(active.positionAge),
      renderer.getArrayBufferAsync(active.velocityLifetime),
      renderer.getArrayBufferAsync(active.appearance),
      renderer.getArrayBufferAsync(active.axisSpin),
    ]);
    return {
      counters: Array.from(new Uint32Array(counterBuffer)),
      indirect: Array.from(new Uint32Array(indirectBuffer)),
      indexToEntity: new Uint32Array(indexToEntityBuffer),
      entityToIndex: new Uint32Array(entityToIndexBuffer),
      freeCount: new Uint32Array(freeCountBuffer)[0],
      positionAge: new Float32Array(positionAgeBuffer),
      velocityLifetime: new Float32Array(velocityLifetimeBuffer),
      appearance: new Float32Array(appearanceBuffer),
      axisSpin: new Float32Array(axisSpinBuffer),
    };
  }

  dispose() {
    if (this.disposed) return;
    for (const set of [this.stateA, this.stateB]) {
      for (const attribute of Object.values(set)) {
        attribute.array.fill(0);
        attribute.dispose?.();
      }
    }
    for (const attribute of [
      this.entityToIndex,
      this.freeIds,
      this.freeCount,
      this.marks,
      this.destinations,
      this.blockCounts,
      this.blockOffsets,
      this.counters,
      this.indirect,
    ]) {
      attribute.array.fill(0);
      attribute.dispose?.();
    }
    this.renderGeometries.clear();
    this.disposed = true;
  }
}

export const GPU_EFFECT_COMPACTION_CONTRACT = Object.freeze({
  state: "SoA A/B ping-pong",
  phases: [
    "reset",
    "clear destination and identity tail",
    "integrate+mark",
    "block exclusive scan",
    "block-sum exclusive scan",
    "scatter motion lanes",
    "scatter appearance lanes",
    "scatter stable identity and rebuild entityToIndex",
    "expand bounded deterministic event state",
    "atomically pop stable ids for spawned entities",
    "publish indirect instance count",
  ],
  identity: "stable entity ids survive dense compaction; an atomic GPU free stack assigns unique ids to new entities",
  maximumStorageBuffersPerKernel: MAX_STORAGE_BINDINGS,
  draw: "IndirectStorageBufferAttribute + BufferGeometry.setIndirect",
  framePathReadback: false,
});
