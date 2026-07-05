import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateField } from '../../core/field.js';
import { createLCG } from '../../core/lcg.js';
import { compileSpec } from '../../core/rig-compiler.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const specNames = ['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'];

async function loadSpec(name) {
	return JSON.parse(await readFile(resolve(root, 'src/lab/specs', `${name}.json`), 'utf8'));
}

function add(a, b) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v, s) {
	return [v[0] * s, v[1] * s, v[2] * s];
}

function length(v) {
	return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v, fallback = [0, 1, 0]) {
	const l = length(v);
	if (!Number.isFinite(l) || l < 1e-12) return fallback.slice();
	return scale(v, 1 / l);
}

function sampleSurface(slot, rng) {
	const axis = normalize(sub(slot.b, slot.a));
	const helper = Math.abs(axis[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
	const x = normalize([
		helper[1] * axis[2] - helper[2] * axis[1],
		helper[2] * axis[0] - helper[0] * axis[2],
		helper[0] * axis[1] - helper[1] * axis[0],
	], [1, 0, 0]);
	const z = [
		axis[1] * x[2] - axis[2] * x[1],
		axis[2] * x[0] - axis[0] * x[2],
		axis[0] * x[1] - axis[1] * x[0],
	];
	const t = 0.1 + rng.nextFloat() * 0.8;
	const theta = rng.nextFloat() * Math.PI * 2;
	const radius = slot.ra + (slot.rb - slot.ra) * t;
	const center = add(slot.a, scale(sub(slot.b, slot.a), t));
	const radial = normalize(add(scale(x, Math.cos(theta)), scale(z, Math.sin(theta))));
	return add(center, scale(radial, radius));
}

function bodyScale(slots) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const slot of slots) {
		const r = Math.max(slot.ra, slot.rb);
		for (const p of [slot.a, slot.b]) {
			for (let i = 0; i < 3; i++) {
				min[i] = Math.min(min[i], p[i] - r);
				max[i] = Math.max(max[i], p[i] + r);
			}
		}
	}
	return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
}

async function runCandidateSetSweep() {
	const rng = createLCG(0x5eed5e7);
	let samples = 0;
	let maxDelta = 0;
	for (const name of specNames) {
		const compiled = compileSpec(await loadSpec(name), { tier: 'hero', maxParts: 64 });
		const scaleValue = bodyScale(compiled.slots);
		const threshold = 0.02 * scaleValue;
		for (let slotIndex = 0; slotIndex < compiled.slots.length; slotIndex++) {
			for (let i = 0; i < 24; i++) {
				const point = sampleSurface(compiled.slots[slotIndex], rng);
				const full = evaluateField(compiled.slots, point).d;
				const candidates = evaluateField(compiled.slots, point, { candidates: compiled.candidateSets[slotIndex] }).d;
				const delta = Math.abs(full - candidates);
				maxDelta = Math.max(maxDelta, delta);
				if (delta > threshold) {
					return {
						status: 'fail',
						details: { message: 'candidate set deviates from full field beyond snap residual bound', name, slotIndex, delta, threshold },
					};
				}
				samples++;
			}
		}
	}
	return { status: 'pass', details: { samples, maxDelta } };
}

async function runRaiseKFixture() {
	const spec = await loadSpec('quadruped');
	const lowK = compileSpec(spec, { tier: 'background', candidateK: 1, maxParts: 64 });
	const normal = compileSpec(spec, { tier: 'hero', candidateK: 8, maxParts: 64 });
	const lowAvg = lowK.candidateSets.reduce((sum, set) => sum + set.length, 0) / lowK.candidateSets.length;
	const normalAvg = normal.candidateSets.reduce((sum, set) => sum + set.length, 0) / normal.candidateSets.length;
	if (!(normalAvg >= lowAvg)) {
		return { status: 'fail', details: { message: 'raise-K fixture did not increase candidate coverage', lowAvg, normalAvg } };
	}
	return { status: 'pass', details: { lowAvg, normalAvg } };
}

export const gates = [
	{ id: 'candidate-set-sweep', run: runCandidateSetSweep },
	{ id: 'raise-k-policy-fixture', run: runRaiseKFixture },
];
