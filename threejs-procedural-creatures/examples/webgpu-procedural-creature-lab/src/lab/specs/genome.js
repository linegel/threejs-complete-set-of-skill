import { makeSeededRngFromString } from '../../core/lcg.js';
import { mutatePerceptualColor } from '../../core/locomotion/genome.js';
import { validateSpec } from '../../core/spec-schema.js';

export function mutateLabColor(baseHex, amount, rng) {
	return mutatePerceptualColor(baseHex, amount, rng);
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
