import { makeSeededRngFromString } from '../lcg.js';

function colorShift(hex, amount) {
  const normalized = hex.replace('#', '').toLowerCase();
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const v = Math.min(1, Math.max(0, amount));
  const rr = Math.min(255, Math.max(0, Math.round((r * (1 - 0.1 * v)) * 255)));
  const gg = Math.min(255, Math.max(0, Math.round((g * (1 + 0.06 * Math.sin(v * 10)) * 255))));
  const bb = Math.min(255, Math.max(0, Math.round((b * (1 + 0.1 * v) * 255))));
  const toHex = (x) => x.toString(16).padStart(2, '0');
  return `#${ toHex(rr) }${ toHex(gg) }${ toHex(bb) }`;
}

function perturbValue(value, amount, rng, mode = 1) {
  const delta = (rng.nextFloat() - 0.5) * amount;
  return Number((value * (1 + delta * 0.1 * mode)).toFixed(4));
}

export function mutateSpec(spec, seedText = 'lab-seed', variantIndex = 0) {
  const rng = makeSeededRngFromString(`${ seedText }:genome:${ variantIndex }`);
  const out = JSON.parse(JSON.stringify(spec));
  if (!Array.isArray(out.parts)) return out;

  for (let i = 0; i < out.parts.length; i++) {
    const part = out.parts[i];
    const jitter = 0.04;
    if (part.shape === 'sphere') {
      part.ra = perturbValue(part.ra ?? part.r ?? 0.2, jitter, rng, 1);
      part.rb = part.ra;
    }
    if (part.shape === 'capsule' || part.shape === 'cone') {
      part.ra = perturbValue(part.ra ?? 0.12, jitter, rng, 1);
      part.rb = perturbValue(part.rb ?? part.ra, jitter, rng, -1);
    }
    if (part.shape === 'leg') {
      part.upper = perturbValue(part.upper ?? 0.44, 0.06, rng, 1);
      part.lower = perturbValue(part.lower ?? 0.44, 0.06, rng, 1);
      part.length = (part.upper || 0) + (part.lower || 0);
    }
    if (part.shape === 'rope') {
      part.r = perturbValue(part.r ?? 0.06, jitter, rng, 1);
      part.length = perturbValue(part.length ?? 1, 0.2, rng, 1);
    }
    part.color = colorShift(part.color || '#9c6b3e', rng.nextFloat() * 0.9);
  }

  if (out.locomotion && typeof out.locomotion === 'object') {
    const l = out.locomotion;
    if (Number.isFinite(l.speed)) l.speed *= (1 + (rng.nextFloat() - 0.5) * 0.2);
    if (Number.isFinite(l.stepLength)) l.stepLength *= (1 + (rng.nextFloat() - 0.5) * 0.16);
  }

  return out;
}

export function createGenomeSpecs(baseSpec, seed = 0, count = 8) {
  const out = [];
  const max = Math.max(1, Math.floor(count));
  for (let i = 0; i < max; i++) {
    const spec = mutateSpec(baseSpec, `${ seed }`, i);
    spec.name = `${ baseSpec.name }-${ String(i).padStart(2, '0') }`;
    spec.seed = seed + i;
    out.push(spec);
  }
  return out;
}
