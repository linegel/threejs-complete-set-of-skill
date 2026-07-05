const TWO_PI = Math.PI * 2;

function clamp01(v) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function makeVec(x = 0, y = 0, z = 0) {
  return [ x, y, z ];
}

function add(a, b) {
  return [ a[0] + b[0], a[1] + b[1], a[2] + b[2] ];
}

function mul(v, s) {
  return [ v[0] * s, v[1] * s, v[2] * s ];
}

function len(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
  const l = len(v);
  if (!Number.isFinite(l) || l < 1e-9) return [0, 0, 0];
  return [v[0] / l, v[1] / l, v[2] / l];
}

function clamp(v, min, max) {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;
}

function samplePoseSlot(pose, slot, point = 0) {
  const base = slot * 8 + (point === 1 ? 3 : 0);
  return [ pose[base], pose[base + 1], pose[base + 2] ];
}

function setPoseSlot(pose, slot, point, value) {
  const base = slot * 8 + (point === 1 ? 3 : 0);
  pose[base] = value[0];
  pose[base + 1] = value[1];
  pose[base + 2] = value[2];
}

export function makeFlyerState(spec = {}, compiler = {}) {
  const locomotion = spec.locomotion || {};
  const altitude = Number.isFinite(locomotion.altitude) ? Math.max(0.35, locomotion.altitude) : 2.5;
  const radius = Number.isFinite(locomotion.radius) ? Math.max(0.25, locomotion.radius) : 2;
  const angularSpeed = Number.isFinite(locomotion.angularSpeed) ? locomotion.angularSpeed : 0.45;
  const flap = Number.isFinite(locomotion.flapAmplitude) ? Math.max(0.02, locomotion.flapAmplitude) : 0.28;
  const flapFrequency = Number.isFinite(locomotion.flapFrequency) ? Math.max(0.6, locomotion.flapFrequency) : 4;
  const bank = Number.isFinite(locomotion.bank) ? locomotion.bank : 0.2;
  return {
    altitude,
    radius,
    angularSpeed,
    flap,
    flapFrequency,
    bank,
    orbitAngle: 0,
    targetAltitude: altitude,
    coreSlot: Math.max(0, compiler?.primitiveRecords?.[0]?.partSlot ?? 0),
    baselineAltitude: 0,
    phaseOffset: Number.isFinite(locomotion.phaseOffset) ? locomotion.phaseOffset : 0,
    time: 0,
    bankDir: bank === 0 ? 1 : Math.sign(bank)
  };
}

export function stepFlyer(state, pose, locomotion = {}, dt = 1 / 60, context = {}) {
  if (!state || !pose) throw new Error('state and pose are required');
  const fixedDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
  const rootVel = context.rootVelocity || [ 0, 0, 0 ];
  const baseHeight = Number.isFinite(context.rootPosition?.[1]) ? context.rootPosition[1] : 0;
  const slotCount = Math.max(1, pose.length / 8);

  state.time += fixedDt;
  state.orbitAngle += state.angularSpeed * fixedDt;

  const orbit = add([state.radius, 0, 0], [0, 0, 0]);
  const forward = normalize([ rootVel[0], 0, rootVel[2] ]);
  const speed = Math.hypot(rootVel[0], rootVel[2]);
  const radiusScale = 1 + Math.min(1, speed * 0.1);

  const x = Math.cos(state.orbitAngle + state.phaseOffset) * orbit[0] * radiusScale;
  const z = Math.sin(state.orbitAngle + state.phaseOffset) * orbit[0] * radiusScale;
  const y = baseHeight + state.targetAltitude + Math.sin(state.time * state.flapFrequency) * state.flap;

  const wingPhase = clamp01(Math.sin(state.time * state.flapFrequency));
  const wingLift = wingPhase * state.flap;

  const core = Math.max(0, Math.floor(slotCount * 0.5));
  const center = samplePoseSlot(pose, core, 0);

  setPoseSlot(pose, core, 0, [ x, y, z ]);
  setPoseSlot(pose, core, 1, [ x + Math.cos(state.orbitAngle) * 0.2, y + wingLift * 0.4, z + Math.sin(state.orbitAngle) * 0.2 ]);

  for (let slot = 0; slot < slotCount; slot += 1) {
    if (slot === core) continue;
    const t = slot / Math.max(1, slotCount - 1);
    const phase = t * TWO_PI + state.time * 1.4 + state.phaseOffset;
    const wobble = Math.sin(phase) * (state.flap * 0.35) * (1 - t);
    const a = samplePoseSlot(pose, slot, 0);
    const b = samplePoseSlot(pose, slot, 1);
    const blend = state.time * state.angularSpeed + t;
    const px = x + Math.cos(phase) * 0.12 * (1 + t) + wobble;
    const pz = z + Math.sin(phase) * 0.12 * (1 + t) - wobble;
    const py = y + Math.cos(phase) * 0.06 + wingLift * state.bankDir * (t - 0.5);
    setPoseSlot(pose, slot, 0, [ px, py, pz ]);
    setPoseSlot(pose, slot, 1, [ b[0] + 0.01, b[1] + 0.01, b[2] + 0.01 ]);
  }

  if (Number.isFinite(state.altitude)) {
    const target = clamp(baseHeight + Math.abs(state.altitude), state.targetAltitude, state.targetAltitude + 8);
    state.targetAltitude = target;
  }

  return {
    pose,
    state,
    altitude: y,
    center,
    wingLift,
    bank: state.bank
  };
}
