import { DEFAULT_WATER_PARAMETERS, WATER_QUALITY_TIERS } from "./constants.js";

function smoothstep01(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function requireSchedule(schedule) {
  if (!Array.isArray(schedule) || schedule.length === 0
      || !schedule.every((delta) => Number.isFinite(delta) && delta >= 0)) {
    throw new Error("Water replay schedule must contain finite non-negative frame deltas.");
  }
}

function hashFloatState(state) {
  const bytes = new Uint8Array(state.buffer, state.byteOffset, state.byteLength);
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function eventAtStep(stepIndex) {
  if (stepIndex === 0) {
    return Object.freeze({
      drop: Object.freeze({ x: -0.75, z: 0.5, radius: 0.55, strength: 0.12 }),
      impulse: null,
    });
  }
  if (stepIndex === 7) {
    return Object.freeze({
      drop: null,
      impulse: Object.freeze({
        oldCenter: Object.freeze({ x: -0.25, y: 0, z: -0.15 }),
        newCenter: Object.freeze({ x: 0.15, y: 0, z: 0.1 }),
        radius: 0.6,
        strength: 0.4,
      }),
    });
  }
  return Object.freeze({ drop: null, impulse: null });
}

export function replayBoundedWaterFixedSteps({
  tierId = "high",
  resolution = 24,
  schedule,
  parameters = DEFAULT_WATER_PARAMETERS,
} = {}) {
  const tier = WATER_QUALITY_TIERS[tierId];
  if (!tier) throw new Error(`Unknown deterministic replay tier "${tierId}".`);
  if (!Number.isInteger(resolution) || resolution < 8) throw new Error("Replay resolution must be an integer >= 8.");
  requireSchedule(schedule);

  const cellCount = resolution * resolution;
  let read = new Float32Array(cellCount * 2);
  let write = new Float32Array(cellCount * 2);
  const dt = tier.fixedTimeStep;
  const maxChunk = dt * tier.maxSubsteps;
  const dx = parameters.worldSize.x / (resolution - 1);
  const dz = parameters.worldSize.y / (resolution - 1);
  const c2 = parameters.waveSpeed * parameters.waveSpeed;
  const damping = Math.exp(-2 * parameters.dampingRatePerSecond * dt);
  let accumulator = 0;
  let fixedStepIndex = 0;

  function heightImpulse(x, z, event) {
    let value = 0;
    if (event.drop) {
      const distance = Math.hypot(x - event.drop.x, z - event.drop.z);
      const compact = Math.max(0, 1 - distance / event.drop.radius);
      value += (0.5 - 0.5 * Math.cos(Math.PI * compact)) * event.drop.strength;
    }
    if (event.impulse) {
      const { oldCenter, newCenter, radius, strength } = event.impulse;
      const oldT = Math.hypot(x - oldCenter.x, z - oldCenter.z) / radius;
      const newT = Math.hypot(x - newCenter.x, z - newCenter.z) / radius;
      value += (Math.exp(-Math.pow(oldT * 1.5, 6)) - Math.exp(-Math.pow(newT * 1.5, 6))) * 0.1 * strength;
    }
    const maskDistance = Math.hypot(x - parameters.eventMaskCenter.x, z - parameters.eventMaskCenter.y);
    return parameters.eventMaskEnabled && maskDistance < parameters.eventMaskRadiusMeters ? 0 : value;
  }

  function runStep() {
    const event = eventAtStep(fixedStepIndex);
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const index = y * resolution + x;
        const left = y * resolution + Math.max(0, x - 1);
        const right = y * resolution + Math.min(resolution - 1, x + 1);
        const down = Math.max(0, y - 1) * resolution + x;
        const up = Math.min(resolution - 1, y + 1) * resolution + x;
        const worldX = (x / (resolution - 1) - 0.5) * parameters.worldSize.x;
        const worldZ = (y / (resolution - 1) - 0.5) * parameters.worldSize.y;
        const centerImpulse = heightImpulse(worldX, worldZ, event);
        const centerHeight = read[index * 2] + centerImpulse;
        const impulseAt = (sampleIndex, sx, sy) => read[sampleIndex * 2] + heightImpulse(
          (sx / (resolution - 1) - 0.5) * parameters.worldSize.x,
          (sy / (resolution - 1) - 0.5) * parameters.worldSize.y,
          event,
        );
        const laplacian = (
          impulseAt(left, Math.max(0, x - 1), y) - 2 * centerHeight + impulseAt(right, Math.min(resolution - 1, x + 1), y)
        ) / (dx * dx) + (
          impulseAt(down, x, Math.max(0, y - 1)) - 2 * centerHeight + impulseAt(up, x, Math.min(resolution - 1, y + 1))
        ) / (dz * dz);
        const edgeCells = Math.min(x, y, resolution - 1 - x, resolution - 1 - y);
        const boundaryMask = smoothstep01(edgeCells / parameters.boundaryFadeCells);
        const velocity = Math.fround((read[index * 2 + 1] + dt * c2 * laplacian) * damping * boundaryMask);
        const height = Math.fround((centerHeight + dt * velocity) * boundaryMask);
        write[index * 2] = height;
        write[index * 2 + 1] = velocity;
      }
    }
    [read, write] = [write, read];
    fixedStepIndex += 1;
  }

  function advanceChunk(delta) {
    accumulator += delta;
    const steps = Math.min(tier.maxSubsteps, Math.floor((accumulator + 1e-12) / dt));
    for (let index = 0; index < steps; index += 1) runStep();
    accumulator -= steps * dt;
  }

  for (const frameDelta of schedule) {
    let remaining = frameDelta;
    while (remaining > 1e-12) {
      const chunk = Math.min(remaining, maxChunk);
      advanceChunk(chunk);
      remaining -= chunk;
    }
  }

  return Object.freeze({
    tierId,
    fixedStepIndex,
    accumulator,
    state: read,
    stateHash: hashFloatState(read),
  });
}

export function equalDurationSchedules(durationSeconds = 0.5) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Replay duration must be finite and positive.");
  return Object.freeze(Object.fromEntries([30, 60, 120].map((hz) => {
    const frames = Math.round(durationSeconds * hz);
    return [hz, Object.freeze(Array.from({ length: frames }, () => durationSeconds / frames))];
  })));
}
