import { getWaterHeightAsync } from '../water-analytic.js';

function clamp01(v) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function clampPositive(v, fallback) {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function sample(pose, slot, point = 0) {
  const base = slot * 8 + (point === 1 ? 3 : 0);
  return [ pose[base], pose[base + 1], pose[base + 2] ];
}

function set(pose, slot, point, value) {
  const base = slot * 8 + (point === 1 ? 3 : 0);
  pose[base] = value[0];
  pose[base + 1] = value[1];
  pose[base + 2] = value[2];
}

function blend(a, b, t) {
  return [ a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t ];
}

export function makeSwimState(spec = {}, compiler = {}) {
  const locomotion = spec.locomotion || {};
  return {
    time: 0,
    buoyancy: clampPositive(locomotion.buoyancy, 0.9),
    undulation: clampPositive(locomotion.undulation, 0.24),
    frequency: clampPositive(locomotion.frequency, 1.2),
    drag: clampPositive(locomotion.drag ?? 0.22, 0.22),
    rootSlot: Math.max(0, compiler?.primitiveRecords?.[0]?.partSlot ?? 0),
    bodyHeight: 0,
    phaseOffset: Number.isFinite(locomotion.phaseOffset) ? locomotion.phaseOffset : 0,
    sideBias: Number.isFinite(locomotion.sideBias) ? locomotion.sideBias : 0,
    lastWaterHeight: 0
  };
}

export async function stepSwim(state, pose, locomotion = {}, dt = 1 / 60, context = {}) {
  if (!state || !pose) throw new Error('state and pose are required');
  const fixedDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
  const rootX = context.rootPosition?.[0] ?? 0;
  const rootZ = context.rootPosition?.[2] ?? 0;
  const t = state.time += fixedDt;

  const slots = pose.length / 8;
  const waveAmp = state.undulation * 0.6;
  const sway = Math.sin(t * state.frequency + state.phaseOffset) * waveAmp;
  const wave = Math.sin(t * state.frequency * 0.7 + state.phaseOffset * 1.2) * waveAmp;
  const waterHeight = await getWaterHeightAsync(rootX, rootZ, t);

  const targetOffset = clamp01(state.buoyancy);
  const targetY = waterHeight + 0.08 + targetOffset * 0.02;
  state.bodyHeight = targetY;
  state.lastWaterHeight = waterHeight;

  const rootSlot = state.rootSlot;
  const rootA = sample(pose, rootSlot, 0);
  const rootB = sample(pose, rootSlot, 1);
  const blended = blend(rootA, rootB, 0.5);

  const forward = [ 0, 0, 0.02 + state.sideBias * 0.02 ];

  for (let slot = 0; slot < slots; slot++) {
    const a = sample(pose, slot, 0);
    const b = sample(pose, slot, 1);
    const lane = slot / Math.max(1, slots - 1);
    const phase = lane * 1.3 + state.phaseOffset + t * state.frequency;
    const lift = Math.sin(phase + state.phaseOffset) * sway + wave * 0.35;

    const targetA = [
      a[0] + forward[0] * lane,
      blend([0, blended[1], 0], [0, targetY, 0], 0.08 + lane * 0.26)[1] + lift,
      a[2] + forward[2] * lane + Math.cos(phase) * 0.02
    ];
    const targetB = [
      b[0] + forward[0] * (lane + 0.3),
      blend([0, blended[1], 0], [0, targetY, 0], 0.08 + lane * 0.26)[1] + lift * 0.85,
      b[2] + forward[2] * (lane + 0.3) + Math.cos(phase + 0.4) * 0.02
    ];

    const damp = Math.exp(-state.drag * lane * fixedDt);
    set(pose, slot, 0, [
      a[0] + (targetA[0] - a[0]) * (0.35 * damp),
      a[1] + (targetA[1] - a[1]) * (0.35 * damp),
      a[2] + (targetA[2] - a[2]) * (0.35 * damp)
    ]);
    set(pose, slot, 1, [
      b[0] + (targetB[0] - b[0]) * (0.35 * damp),
      b[1] + (targetB[1] - b[1]) * (0.35 * damp),
      b[2] + (targetB[2] - b[2]) * (0.35 * damp)
    ]);
  }

  return {
    pose,
    state,
    waterHeight,
    bodyHeight: targetY,
    sway: wave,
    buoyancy: targetOffset
  };
}
