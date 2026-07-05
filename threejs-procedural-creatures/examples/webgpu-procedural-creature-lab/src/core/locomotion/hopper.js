import { clampReach } from './ik.js';

const G = 9.81;

const HOP_PHASES = {
  rise: 0.34,
  fall: 0.66,
  rest: 1
};

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

function sub(a, b) {
  return [ a[0] - b[0], a[1] - b[1], a[2] - b[2] ];
}

function len(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
  const l = len(v);
  if (!Number.isFinite(l) || l < 1e-9) return [ 0, 1, 0 ];
  return [ v[0] / l, v[1] / l, v[2] / l ];
}

function estimateApexTime(height, gravity = G) {
  return 0.9 * Math.sqrt(Math.max(1e-6, (2 * Math.max(height, 0.01)) / gravity));
}

function sampleBodyPose(pose, slot, point = 0) {
  const base = slot * 8 + (point === 1 ? 3 : 0);
  return [ pose[base], pose[base + 1], pose[base + 2] ];
}

function setAnchorPoint(pose, slot, point, value) {
  const base = slot * 8 + (point === 1 ? 3 : 0);
  pose[base] = value[0];
  pose[base + 1] = value[1];
  pose[base + 2] = value[2];
}

function hopArc(height, t) {
  if (t <= 0) return 0;
  const x = clamp01(t);
  if (x < HOP_PHASES.rise) {
    const phase = x / HOP_PHASES.rise;
    return Math.sin(phase * Math.PI / 2) * height;
  }
  if (x < HOP_PHASES.fall) {
    const phase = (x - HOP_PHASES.rise) / (HOP_PHASES.fall - HOP_PHASES.rise);
    return (1 - phase) * height * Math.sin(Math.PI / 2);
  }
  return 0;
}

function ensurePositive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Number(value) : fallback;
}

export function makeHopperState(spec = {}, compiler = {}) {
  const locomotion = spec.locomotion || {};
  const hopHeight = ensurePositive(locomotion.hopHeight, 1.2);
  const hopLength = ensurePositive(locomotion.hopLength, 1.6);
  const cooldown = ensurePositive(locomotion.cooldownSeconds, 0.06);
  const rootSlot = Math.max(0, compiler?.primitiveRecords?.[0]?.partSlot ?? 0);

  return {
    time: 0,
    hopHeight,
    hopLength,
    hopPeriod: estimateApexTime(hopHeight),
    cooldown,
    phase: 0,
    cycle: 0,
    state: 'rest',
    rootSlot,
    stretch: 1,
    jumpSeed: Number.isFinite(locomotion.seed) ? locomotion.seed : 0,
    lastLaunchRootY: 0,
    lastLandingRootY: 0,
    launchDirection: [ 1, 0, 0 ],
    lastDelta: 0
  };
}

function buildLaunchDirection(velocity, rootSlot, state) {
  const baseDir = normalize([ velocity[0], 0, velocity[2 ]]);
  const x = baseDir[0] !== 0 || baseDir[2] !== 0 ? baseDir : [1, 0, 0];
  const sign = state.cycle % 2 === 0 ? 1 : -1;
  return mul(x, sign * state.hopLength * 0.25);
}

export function stepHopper(state, pose, locomotion = {}, dt = 1 / 60, context = {}) {
  if (!state || !pose) throw new Error('state and pose are required');
  const fixedDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
  const jumpInterval = Math.max(0.02, Number.isFinite(locomotion.jumpInterval) ? locomotion.jumpInterval : 1.2);
  const rootVelocity = context.rootVelocity || [ 0, 0, 0 ];
  const baseY = context.rootPosition?.[1] ?? 0;

  state.time += fixedDt;
  state.time = Math.max(0, state.time);

  const local = state.time / Math.max(0.0001, state.hopPeriod);
  const clamped = clamp01(local - Math.floor(local));
  state.phase = clamped;
  state.lastDelta = fixedDt;

  if (!state.launchDirection || !Number.isFinite(state.launchDirection[0])) {
    state.launchDirection = buildLaunchDirection(rootVelocity, state.rootSlot, state);
  }

  const hopArcY = hopArc(state.hopHeight, clamped);
  const progress = clamp01(clamped);

  const bodySlot = Math.floor(state.rootSlot);
  const bodyStart = [ ...sampleBodyPose(pose, bodySlot, 0) ];
  const bodyEnd = [ ...sampleBodyPose(pose, bodySlot, 1) ];
  const bodyMid = [
    (bodyStart[0] + bodyEnd[0]) * 0.5,
    (bodyStart[1] + bodyEnd[1]) * 0.5 + hopArcY,
    (bodyStart[2] + bodyEnd[2]) * 0.5
  ];

  const landingProgress = progress > 0.4 && clamped > HOP_PHASES.fall;

  state.state = landingProgress ? 'fall' : 'rise';
  if (state.state === 'fall' && clamped >= HOP_PHASES.rest - 1e-3) {
    state.state = 'land';
    state.time = 0;
    state.cycle += 1;
    state.stretch = clampReach(1 + state.stretch * 0.04, 0.02, 1.8);
    state.launchDirection = buildLaunchDirection(rootVelocity, state.rootSlot, state);
    state.lastLandingRootY = baseY;
    return { pose, state, phase: clamped, launch: false, hopY: hopArcY };
  }

  const stride = mul(state.launchDirection, Math.cos(progress * Math.PI * 2) * 0.5 + 0.5);
  const offset = add(bodyMid, [ stride[0], hopArcY, stride[2] ]);

  if (bodySlot < pose.length / 8) {
    const centerA = sampleBodyPose(pose, bodySlot, 0);
    const centerB = sampleBodyPose(pose, bodySlot, 1);
    const t = 0.5;
    const a = bodyStart.map((value, index) => centerA[index] + (centerB[index] - centerA[index]) * 0.1);
    const b = add(a, [ offset[0], baseY + offset[1], offset[2] ]);
    setAnchorPoint(pose, bodySlot, 0, [ a[0], baseY + hopArcY * 0.65, a[2] ]);
    setAnchorPoint(pose, bodySlot, 1, [ b[0], baseY + hopArcY * 0.65, b[2] ]);
  }

  for (let i = 0; i < Math.min(pose.length / 8, 16); i += 1) {
    if (i === bodySlot) continue;
    const offsetY = Math.sin((i + 1) * 0.19 + state.time * 3.2) * 0.02 * (1 - progress);
    const anchor = sampleBodyPose(pose, i, 0);
    const anchorB = sampleBodyPose(pose, i, 1);
    setAnchorPoint(pose, i, 0, [ anchor[0] + offsetY * 0.3, anchor[1] + offsetY, anchor[2] + offsetY * 0.1 ]);
    setAnchorPoint(pose, i, 1, [ anchorB[0] + offsetY * 0.1, anchorB[1] - offsetY, anchorB[2] + offsetY * 0.3 ]);
  }

  if (state.time >= jumpInterval) {
    state.time = state.time - jumpInterval;
    state.state = 'rest';
  }

  if (state.state === 'rest') {
    state.lastLaunchRootY = baseY;
    state.lastDelta = fixedDt;
  }

  return {
    pose,
    state,
    phase: state.time,
    launch: state.phase <= 0.08,
    hopY: hopArcY,
    stretch: state.stretch
  };
}
