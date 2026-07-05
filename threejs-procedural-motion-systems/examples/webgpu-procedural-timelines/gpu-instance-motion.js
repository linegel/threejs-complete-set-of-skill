import { StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import { Fn, cos, float, instanceIndex, mix, positionLocal, sin, storage, uniform, vec3, vec4 } from "three/tsl";

export const MOTION_STORAGE_LAYOUT = {
  dynamicState: {
    itemSize: 4,
    fields: [
      "previousPose.xyz",
      "previousPhase",
      "currentPose.xyz",
      "currentPhase",
      "velocity.xyz",
      "flags",
    ],
    storageBytes: 48,
    slotCount: 2,
  },
  staticState: {
    itemSize: 4,
    fields: ["localAnchor.xyz", "springFrequency", "localAxis.xyz", "phaseOffset", "seed", "rngCounter"],
    storageBytes: 48,
  },
  matrix: {
    itemSize: 16,
    fields: ["instance matrix"],
    storageBytes: 64,
  },
};

export const GPU_MOTION_COMPUTE_CONTRACT = {
  dispatchOwner: "fixed-step accumulator",
  renderInterpolation: "vertex positionNode reads previousPose and currentPose with alpha",
  workgroupSize: 64,
};

export function chooseMotionRoute({ actorCount, mixedGeometry = false }) {
  if (actorCount < 200) return "<200 Object3D";
  if (actorCount <= 10000) return mixedGeometry ? "200-10k BatchedMesh" : "200-10k InstancedMesh";
  return "10k+ StorageInstancedBufferAttribute";
}

function fillInstanceMotionArrays({ previousPose, currentPose, velocityState, staticState, instanceCount }) {
  for (let i = 0; i < instanceCount; i += 1) {
    const lane = i * 4;
    const ring = i / Math.max(instanceCount, 1);
    const angle = ring * Math.PI * 2;
    const radius = 2.5 + (i % 17) * 0.045;
    const anchorX = Math.cos(angle) * radius;
    const anchorY = ((i % 23) - 11) * 0.035;
    const anchorZ = Math.sin(angle) * radius;
    const phaseOffset = (i % 97) / 97;
    const springFrequency = 2.5 + (i % 13) * 0.08;

    previousPose[lane + 0] = anchorX;
    previousPose[lane + 1] = anchorY;
    previousPose[lane + 2] = anchorZ;
    previousPose[lane + 3] = phaseOffset;
    currentPose.set(previousPose.subarray(lane, lane + 4), lane);

    velocityState[lane + 0] = 0;
    velocityState[lane + 1] = 0;
    velocityState[lane + 2] = 0;
    velocityState[lane + 3] = 0;

    staticState[lane + 0] = anchorX;
    staticState[lane + 1] = anchorY;
    staticState[lane + 2] = anchorZ;
    staticState[lane + 3] = springFrequency;
  }
}

export function createInstanceMotionBuffers(instanceCount) {
  const previousPoseArray = new Float32Array(instanceCount * 4);
  const currentPoseArray = new Float32Array(instanceCount * 4);
  const velocityStateArray = new Float32Array(instanceCount * 4);
  const staticStateArray = new Float32Array(instanceCount * 4);

  fillInstanceMotionArrays({
    previousPose: previousPoseArray,
    currentPose: currentPoseArray,
    velocityState: velocityStateArray,
    staticState: staticStateArray,
    instanceCount,
  });

  const previousPose = new StorageInstancedBufferAttribute(previousPoseArray, 4);
  const currentPose = new StorageInstancedBufferAttribute(currentPoseArray, 4);
  const velocityState = new StorageInstancedBufferAttribute(velocityStateArray, 4);
  const staticState = new StorageBufferAttribute(staticStateArray, 4);
  const instanceMatrix = new StorageInstancedBufferAttribute(instanceCount, 16);

  return {
    instanceCount,
    previousPose,
    currentPose,
    velocityState,
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
  const previousPoseNode = storage(buffers.previousPose, "vec4", instanceCount);
  const currentPoseNode = storage(buffers.currentPose, "vec4", instanceCount);
  const velocityNode = storage(buffers.velocityState, "vec4", instanceCount);
  const staticNode = storage(buffers.staticState, "vec4", instanceCount);
  const fixedStep = uniform(1 / 120);
  const simulationTime = uniform(0);
  const alpha = uniform(0);

  const integrateInstanceMotion = Fn(({ previousPose, currentPose, velocity, staticMotion }) => {
    const i = instanceIndex;
    const prev = currentPose.element(i);
    const current = currentPose.element(i);
    const v = velocity.element(i);
    const anchor = staticMotion.element(i);
    const phase = simulationTime.add(anchor.w);
    const target = anchor.xyz.add(
      vec3(sin(phase.mul(float(6.283185307179586))).mul(0.35), cos(phase.mul(float(4.1887902047863905))).mul(0.18), 0),
    );
    const stiffness = anchor.w.mul(anchor.w);
    const damping = anchor.w.mul(1.85);
    const acceleration = target.sub(current.xyz).mul(stiffness).sub(v.xyz.mul(damping));
    const nextVelocity = v.xyz.add(acceleration.mul(fixedStep));
    const nextPosition = current.xyz.add(nextVelocity.mul(fixedStep));

    previousPose.element(i).assign(prev);
    currentPose.element(i).assign(vec4(nextPosition, current.w));
    velocity.element(i).assign(vec4(nextVelocity, v.w));
  });

  const computeStep = integrateInstanceMotion({
    previousPose: previousPoseNode,
    currentPose: currentPoseNode,
    velocity: velocityNode,
    staticMotion: staticNode,
  })
    .compute(instanceCount, [GPU_MOTION_COMPUTE_CONTRACT.workgroupSize])
    .setName("motion:integrate-instance-spring");

  function createInterpolatedPositionNode() {
    const previousPosition = previousPoseNode.element(instanceIndex).xyz;
    const currentPosition = currentPoseNode.element(instanceIndex).xyz;
    return positionLocal.add(mix(previousPosition, currentPosition, alpha));
  }

  function setPresentationAlpha(value) {
    alpha.value = Math.min(Math.max(value, 0), 1);
  }

  function dispatchFixedStep(renderer, dt, time) {
    fixedStep.value = dt;
    simulationTime.value = time;
    buffers.dispatchCount = (buffers.dispatchCount ?? 0) + 1;
    return renderer.compute(computeStep);
  }

  return {
    buffers,
    previousPoseNode,
    currentPoseNode,
    velocityNode,
    staticNode,
    fixedStep,
    simulationTime,
    alpha,
    computeStep,
    integrateInstanceMotion,
    createInterpolatedPositionNode,
    setPresentationAlpha,
    dispatchFixedStep,
    dispatchPolicy: GPU_MOTION_COMPUTE_CONTRACT.dispatchOwner,
    renderConsumes: ["previousPose", "currentPose", "alpha"],
    storageBytes: buffers.storageBytes,
  };
}

export function createInstanceMotionMirror({ instanceCount = 64 } = {}) {
  const previousPose = new Float32Array(instanceCount * 4);
  const currentPose = new Float32Array(instanceCount * 4);
  const velocityState = new Float32Array(instanceCount * 4);
  const staticState = new Float32Array(instanceCount * 4);
  fillInstanceMotionArrays({ previousPose, currentPose, velocityState, staticState, instanceCount });
  return { instanceCount, previousPose, currentPose, velocityState, staticState };
}

export function stepInstanceMotionMirror(mirror, fixedStep, simulationTime) {
  for (let i = 0; i < mirror.instanceCount; i += 1) {
    const lane = i * 4;
    const phase = simulationTime + mirror.staticState[lane + 3];
    const anchorX = mirror.staticState[lane + 0];
    const anchorY = mirror.staticState[lane + 1];
    const anchorZ = mirror.staticState[lane + 2];
    const springFrequency = mirror.staticState[lane + 3];
    const targetX = anchorX + Math.sin(phase * Math.PI * 2) * 0.35;
    const targetY = anchorY + Math.cos(phase * (Math.PI * 4 / 3)) * 0.18;
    const targetZ = anchorZ;
    const stiffness = springFrequency * springFrequency;
    const damping = springFrequency * 1.85;

    mirror.previousPose.set(mirror.currentPose.subarray(lane, lane + 4), lane);

    const ax = (targetX - mirror.currentPose[lane + 0]) * stiffness - mirror.velocityState[lane + 0] * damping;
    const ay = (targetY - mirror.currentPose[lane + 1]) * stiffness - mirror.velocityState[lane + 1] * damping;
    const az = (targetZ - mirror.currentPose[lane + 2]) * stiffness - mirror.velocityState[lane + 2] * damping;

    mirror.velocityState[lane + 0] += ax * fixedStep;
    mirror.velocityState[lane + 1] += ay * fixedStep;
    mirror.velocityState[lane + 2] += az * fixedStep;
    mirror.currentPose[lane + 0] += mirror.velocityState[lane + 0] * fixedStep;
    mirror.currentPose[lane + 1] += mirror.velocityState[lane + 1] * fixedStep;
    mirror.currentPose[lane + 2] += mirror.velocityState[lane + 2] * fixedStep;
  }
  return mirror;
}

export function seekInstanceMotionMirror({ instanceCount = 64, fixedStep = 1 / 120, steps = 0 } = {}) {
  const mirror = createInstanceMotionMirror({ instanceCount });
  for (let step = 0; step < steps; step += 1) {
    stepInstanceMotionMirror(mirror, fixedStep, (step + 1) * fixedStep);
  }
  return mirror;
}

export function maxPoseDifference(a, b) {
  let max = 0;
  for (let i = 0; i < a.currentPose.length; i += 1) {
    max = Math.max(max, Math.abs(a.currentPose[i] - b.currentPose[i]));
    max = Math.max(max, Math.abs(a.previousPose[i] - b.previousPose[i]));
    max = Math.max(max, Math.abs(a.velocityState[i] - b.velocityState[i]));
  }
  return max;
}
