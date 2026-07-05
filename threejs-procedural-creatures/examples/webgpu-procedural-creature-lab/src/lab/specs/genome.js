import { makeSeededRngFromString } from '../../core/lcg.js';
import { validateSpec } from '../../core/spec-schema.js';

function wrap01(v) {
  return Math.max(0, Math.min(1, v));
}

function decodeHex(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  };
}

function encodeHex(rgb) {
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const channel = (value) => Math.max(0, Math.min(255, Math.round(clamp(value) * 255)));
  return `#${channel(rgb.r).toString(16).padStart(2, '0')}${channel(rgb.g).toString(16).padStart(2, '0')}${channel(rgb.b).toString(16).padStart(2, '0')}`;
}

export function mutateLabColor(baseHex, amount, rng) {
  const linear = decodeHex(baseHex);
  const drift = (rng.nextFloat() - 0.5) * 2 * amount;
  const rgb = {
    r: wrap01(linear.r + drift * 0.45),
    g: wrap01(linear.g + Math.sin(drift + 0.12) * amount * 0.3),
    b: wrap01(linear.b + Math.cos(drift - 0.17) * amount * 0.3),
  };
  return encodeHex(rgb);
}

export function createGenomeSpec(baseSpec, options = {}) {
  const seed = options.seed ?? baseSpec.seed ?? 0;
  const count = Math.max(1, Number.isFinite(options.count) ? Math.floor(options.count) : 1);
  const out = [];

  for (let i = 0; i < count; i++) {
    const nameSeed = `${ seed }:${ baseSpec.name }:${ i }`;
    const rng = createLabMutationSeed(nameSeed);
    const mutated = JSON.parse(JSON.stringify(baseSpec));
    const jitter = 0.06;

    for (const part of mutated.parts ?? []) {
      if (typeof part.r === 'number') {
        part.r = Number((part.r * (1 + (rng.nextFloat() - 0.5) * jitter)).toFixed(4));
      }
      if (typeof part.ra === 'number') {
        part.ra = Number((part.ra * (1 + (rng.nextFloat() - 0.5) * jitter)).toFixed(4));
      }
      if (typeof part.rb === 'number') {
        part.rb = Number((part.rb * (1 + (rng.nextFloat() - 0.5) * jitter)).toFixed(4));
      }
      if (typeof part.upper === 'number') {
        part.upper = Number((part.upper * (1 + (rng.nextFloat() - 0.5) * jitter)).toFixed(4));
      }
      if (typeof part.lower === 'number') {
        part.lower = Number((part.lower * (1 + (rng.nextFloat() - 0.5) * jitter)).toFixed(4));
      }
      if (typeof part.length === 'number') {
        part.length = Number((part.length * (1 + (rng.nextFloat() - 0.5) * jitter * 1.2)).toFixed(4));
      }
      if (typeof part.color === 'string') {
        part.color = mutateLabColor(part.color, 0.08, rng);
      }
    }

    if (mutated.locomotion) {
      const l = mutated.locomotion;
      if (typeof l.speed === 'number') l.speed = Number((l.speed * (1 + (rng.nextFloat() - 0.5) * 0.25)).toFixed(6));
      if (typeof l.stepLength === 'number') l.stepLength = Number((l.stepLength * (1 + (rng.nextFloat() - 0.5) * 0.14)).toFixed(6));
      if (typeof l.stepHeight === 'number') l.stepHeight = Number((l.stepHeight * (1 + (rng.nextFloat() - 0.5) * 0.16)).toFixed(6));
    }

    const label = `${ baseSpec.name }-${ i.toString().padStart(2, '0') }`;
    const spec = {
      ...mutated,
      name: label,
      seed: Number.isFinite(seed) ? Number(seed) + i : i
    };

    validateSpec(spec);
    out.push(spec);
  }

  return out;
}

export function createLabMutationSeed(seedText = 'lab-locus') {
  return makeSeededRngFromString(seedText);
}
