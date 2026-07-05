function clamp1(v) {
  return Number.isFinite(v) ? v : 0;
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

function clamp(num, min, max) {
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [ v[0] / l, v[1] / l, v[2] / l ];
}

export function makeRopeState(spec = {}, compiler = {}) {
  const locomotion = spec.locomotion || {};
  const ropeStiffness = clamp1(locomotion.ropeStiffness) || 0.65;
  const waveAmp = clamp1(locomotion.ropeAmplitude) || 0.06;
  const waveFreq = clamp1(locomotion.ropeFrequency) || 1.6;
  const damping = clamp1(locomotion.ropeDamping);
  const chainSlots = [];
  const records = compiler?.primitiveRecords || [];

  for (let i = 0; i < records.length; i++) {
    if (records[i]?.type === 'rope') {
      chainSlots.push(i);
    }
  }

  return {
    chainSlots,
    ropeStiffness,
    waveAmp,
    waveFreq,
    damping,
    phaseOffset: Number.isFinite(locomotion.phaseOffset) ? locomotion.phaseOffset : 0,
    time: 0,
    anchor: new Map()
  };
}

export function stepRope(state, pose, locomotion = {}, dt = 1 / 60) {
  if (!state || !Array.isArray(pose)) throw new Error('state and pose are required');
  const fixedDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
  const slots = state.chainSlots || [];
  if (slots.length === 0) return { pose, state };

  state.time += fixedDt;
  const k = clamp(state.ropeStiffness, 0.02, 1.2);
  const amp = clamp(state.waveAmp, 0.001, 0.4);
  const freq = Math.max(0.25, state.waveFreq);

  let rootAnchor = sample(pose, slots[0], 0);
  let prevA = rootAnchor;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const a = sample(pose, slot, 0);
    const b = sample(pose, slot, 1);

    const t = (i + 1) / Math.max(2, slots.length);
    const phase = state.time * freq + state.phaseOffset + i * 0.3;
    const wave = Math.sin(phase);

    const anchor = state.anchor.get(slot) || [ ...a ];
    const targetA = [
      anchor[0] + (i === 0 ? 0 : (a[0] - prevA[0]) * 0.08),
      anchor[1] + (i === 0 ? 0 : (a[1] - prevA[1]) * 0.08),
      anchor[2] + (i === 0 ? 0 : (a[2] - prevA[2]) * 0.08)
    ];

    const targetB = [
      b[0] + Math.cos(phase) * amp * t,
      b[1] + wave * amp * t + amp * k,
      b[2] + Math.sin(phase) * amp * t
    ];

    const dA = [ (targetA[0] - a[0]) * k, (targetA[1] - a[1]) * k, (targetA[2] - a[2]) * k ];
    const dB = [ (targetB[0] - b[0]) * k, (targetB[1] - b[1]) * k, (targetB[2] - b[2]) * k ];

    set(pose, slot, 0, [ a[0] + dA[0], a[1] + dA[1], a[2] + dA[2] ]);
    set(pose, slot, 1, [ b[0] + dB[0], b[1] + dB[1], b[2] + dB[2] ]);

    prevA = [ ...a ];
    if (!state.anchor.has(slot)) state.anchor.set(slot, [ ...a ]);
  }

  return {
    pose,
    state,
    phase: state.time,
    stiffness: state.ropeStiffness
  };
}
