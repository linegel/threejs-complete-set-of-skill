import { makeSeededRngFromString } from '../lcg.js';

function clamp01(value) {
	return Math.max(0, Math.min(1, value));
}

function srgbToLinear(value) {
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value) {
	const clamped = Math.max(0, value);
	return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * (clamped ** (1 / 2.4)) - 0.055;
}

function decodeHex(hex) {
	const normalized = String(hex).replace('#', '').toLowerCase();
	if (!/^[0-9a-f]{6}$/.test(normalized)) throw new Error(`invalid genome color '${hex}'`);
	return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255);
}

function encodeHex(rgb) {
	const channel = (value) => Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');
	return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

export function hexToOklab(hex) {
	const [sr, sg, sb] = decodeHex(hex);
	const r = srgbToLinear(sr);
	const g = srgbToLinear(sg);
	const b = srgbToLinear(sb);
	const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
	const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
	const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
	const lRoot = Math.cbrt(l);
	const mRoot = Math.cbrt(m);
	const sRoot = Math.cbrt(s);
	return [
		0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
		1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
		0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
	];
}

function oklabToLinearRgb(lab) {
	const lRoot = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
	const mRoot = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
	const sRoot = lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2];
	const l = lRoot ** 3;
	const m = mRoot ** 3;
	const s = sRoot ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

function inGamut(rgb) {
	return rgb.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
}

export function oklabToHex(lab) {
	const target = [clamp01(lab[0]), lab[1], lab[2]];
	let rgb = oklabToLinearRgb(target);
	if (!inGamut(rgb)) {
		// Deterministic chroma compression preserves perceptual lightness and hue
		// instead of independently clamping RGB channels.
		let lower = 0;
		let upper = 1;
		for (let iteration = 0; iteration < 18; iteration++) {
			const scale = 0.5 * (lower + upper);
			const candidate = oklabToLinearRgb([target[0], target[1] * scale, target[2] * scale]);
			if (inGamut(candidate)) {
				lower = scale;
				rgb = candidate;
			} else {
				upper = scale;
			}
		}
	}
	return encodeHex(rgb.map((value) => linearToSrgb(value)));
}

export function perceptualColorDeltaE(aHex, bHex) {
	const a = hexToOklab(aHex);
	const b = hexToOklab(bHex);
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function mutatePerceptualColor(baseHex, maxDeltaE, rng) {
	const base = hexToOklab(baseHex);
	const radius = Math.max(0, Number(maxDeltaE)) * Math.sqrt(rng.nextFloat());
	const azimuth = rng.nextFloat() * Math.PI * 2;
	const lightnessShare = (rng.nextFloat() - 0.5) * 0.7;
	const chromaScale = Math.sqrt(Math.max(0, 1 - lightnessShare * lightnessShare));
	const mutated = [
		clamp01(base[0] + radius * lightnessShare),
		base[1] + radius * chromaScale * Math.cos(azimuth),
		base[2] + radius * chromaScale * Math.sin(azimuth),
	];
	return oklabToHex(mutated);
}

function perturbValue(value, amount, rng, direction = 1) {
	const delta = (rng.nextFloat() - 0.5) * amount;
	return Number((value * (1 + delta * 0.1 * direction)).toFixed(4));
}

export function mutateSpec(spec, seedText = 'lab-seed', variantIndex = 0) {
	const rng = makeSeededRngFromString(`${seedText}:genome:${variantIndex}`);
	const out = JSON.parse(JSON.stringify(spec));
	if (!Array.isArray(out.parts)) return out;

	for (const part of out.parts) {
		const jitter = 0.04;
		if (part.shape === 'sphere' || part.shape === 'capsule' || part.shape === 'leg' || part.shape === 'rope') {
			part.r = perturbValue(part.r ?? 0.12, jitter, rng, 1);
		}
		if (part.shape === 'cone') {
			part.r = perturbValue(part.r ?? 0.12, jitter, rng, 1);
			part.r2 = perturbValue(part.r2 ?? part.r, jitter, rng, -1);
		}
		if (part.shape === 'leg') {
			part.upper = perturbValue(part.upper ?? 0.44, 0.06, rng, 1);
			part.lower = perturbValue(part.lower ?? 0.44, 0.06, rng, 1);
		}
		if (part.shape === 'rope') part.length = perturbValue(part.length ?? 1, 0.2, rng, 1);
		part.color = mutatePerceptualColor(part.color || '#9c6b3e', 0.055, rng);
	}

	if (out.locomotion && typeof out.locomotion === 'object') {
		const locomotion = out.locomotion;
		if (Number.isFinite(locomotion.speed)) locomotion.speed *= 1 + (rng.nextFloat() - 0.5) * 0.2;
		if (Number.isFinite(locomotion.stepLength)) locomotion.stepLength *= 1 + (rng.nextFloat() - 0.5) * 0.16;
	}

	return out;
}

export function createGenomeSpecs(baseSpec, seed = 0, count = 8) {
	const out = [];
	const maximum = Math.max(1, Math.floor(count));
	for (let index = 0; index < maximum; index++) {
		const spec = mutateSpec(baseSpec, `${seed}`, index);
		spec.name = `${baseSpec.name}-${String(index).padStart(2, '0')}`;
		spec.seed = seed + index;
		out.push(spec);
	}
	return out;
}
