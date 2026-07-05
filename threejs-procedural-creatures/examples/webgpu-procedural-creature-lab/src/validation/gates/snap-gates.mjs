import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateField } from '../../core/field.js';
import { createLCG } from '../../core/lcg.js';
import { snapPoint } from '../../core/newton-snap.js';
import { compileSpec } from '../../core/rig-compiler.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const specNames = ['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'];

async function loadSpec(name) {
	return JSON.parse(await readFile(resolve(root, 'src/lab/specs', `${name}.json`), 'utf8'));
}

function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(v, s) {
	return [v[0] * s, v[1] * s, v[2] * s];
}

function cross(a, b) {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
}

function len(v) {
	return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v, fallback = [0, 1, 0]) {
	const l = len(v);
	if (!Number.isFinite(l) || l < 1e-12) return fallback.slice();
	return scale(v, 1 / l);
}

function basisForPrimitive(primitive) {
	const axis = normalize(sub(primitive.b, primitive.a));
	const helper = Math.abs(axis[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
	const x = normalize(cross(helper, axis), [1, 0, 0]);
	const z = cross(axis, x);
	return { x, z };
}

function aabb(slots) {
	const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
	const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
	for (const slot of slots) {
		const r = Math.max(slot.ra, slot.rb);
		for (const p of [slot.a, slot.b]) {
			for (let axis = 0; axis < 3; axis++) {
				min[axis] = Math.min(min[axis], p[axis] - r);
				max[axis] = Math.max(max[axis], p[axis] + r);
			}
		}
	}
	return { min, max, center: scale(add(min, max), 0.5), bodyScale: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) };
}

function randomSeedPoint(compiled, rng, bodyScale) {
	const primitive = compiled.slots[Math.floor(rng.nextFloat() * compiled.slots.length)];
	const basis = basisForPrimitive(primitive);
	const t = 0.12 + rng.nextFloat() * 0.76;
	const center = add(primitive.a, scale(sub(primitive.b, primitive.a), t));
	const theta = rng.nextFloat() * Math.PI * 2;
	const radial = normalize(add(scale(basis.x, Math.cos(theta)), scale(basis.z, Math.sin(theta))));
	const radius = primitive.ra + (primitive.rb - primitive.ra) * t;
	const jitter = rng.nextRange(-0.025 * bodyScale, 0.025 * bodyScale);
	return add(center, scale(radial, radius + jitter));
}

async function compiledSpecs() {
	const entries = [];
	for (const name of specNames) entries.push({ name, compiled: compileSpec(await loadSpec(name), { tier: 'hero', maxParts: 64 }) });
	return entries;
}

async function runSnapResidual() {
	const entries = await compiledSpecs();
	const rng = createLCG(0x5aa91e);
	let samples = 0;
	for (const { name, compiled } of entries) {
		const box = aabb(compiled.slots);
		for (let i = 0; i < 500; i++) {
			const seed = randomSeedPoint(compiled, rng, box.bodyScale);
			const result = snapPoint((p) => evaluateField(compiled.slots, p), seed, {
				maxStep: 2 * compiled.maxRadius,
				maxSteps: 2,
				epsilon: 1e-5,
			});
			if (result.residual >= 0.02 * box.bodyScale) {
				return { status: 'fail', details: { message: 'snap residual too high', name, residual: result.residual, threshold: 0.02 * box.bodyScale } };
			}
			samples++;
		}
	}
	return { status: 'pass', details: { samples } };
}

async function runSnapMoveClamp() {
	const entries = await compiledSpecs();
	const rng = createLCG(0xc1aade);
	for (const { name, compiled } of entries) {
		const box = aabb(compiled.slots);
		const seeds = [box.center];
		for (let i = 0; i < 64; i++) seeds.push(randomSeedPoint(compiled, rng, box.bodyScale));
		for (const seed of seeds) {
			const result = snapPoint((p) => evaluateField(compiled.slots, p), seed, {
				maxStep: 2 * compiled.maxRadius,
				maxSteps: 2,
				epsilon: 1e-5,
			});
			if (result.moves.some((move) => move > 2 * compiled.maxRadius + 1e-12)) {
				return { status: 'fail', details: { message: 'snap move exceeded clamp', name, maxMove: result.maxMove, clamp: 2 * compiled.maxRadius } };
			}
		}
	}
	return { status: 'pass', details: { specs: entries.length } };
}

export const gates = [
	{ id: 'snap-residual', run: runSnapResidual },
	{ id: 'snap-move-clamp', run: runSnapMoveClamp },
];
