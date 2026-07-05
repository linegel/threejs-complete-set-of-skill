import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { centralDiffGradient, evaluateCapsulePrimitive, evaluateField, hardMin } from '../../core/field.js';
import { createLCG } from '../../core/lcg.js';
import { compileSpec } from '../../core/rig-compiler.js';
import { snapPoint } from '../../core/newton-snap.js';
import { validateSpec } from '../../core/spec-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const specNames = ['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'];

async function loadSpec(name) {
	return JSON.parse(await readFile(resolve(root, 'src/lab/specs', `${name}.json`), 'utf8'));
}

async function compiledSpecs() {
	const entries = [];
	for (const name of specNames) {
		const spec = await loadSpec(name);
		validateSpec(spec, { maxParts: 64 });
		entries.push({ name, spec, compiled: compileSpec(spec, { tier: 'hero', maxParts: 64 }) });
	}
	return entries;
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

function dot(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
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
	return { axis, x, z };
}

function surfacePointForPrimitive(primitive, rng, jitterScale = 0) {
	const basis = basisForPrimitive(primitive);
	const t = 0.15 + rng.nextFloat() * 0.7;
	const theta = rng.nextFloat() * Math.PI * 2;
	const center = add(primitive.a, scale(sub(primitive.b, primitive.a), t));
	const radial = normalize(add(scale(basis.x, Math.cos(theta)), scale(basis.z, Math.sin(theta))));
	const radius = primitive.ra + (primitive.rb - primitive.ra) * t;
	const jitter = jitterScale === 0 ? 0 : rng.nextRange(-jitterScale, jitterScale);
	return add(center, scale(radial, radius + jitter));
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
	return { min, max, scale: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) };
}

function nearSurfacePoint(compiled, rng) {
	const box = aabb(compiled.slots);
	const primitive = compiled.slots[Math.floor(rng.nextFloat() * compiled.slots.length)];
	const seed = surfacePointForPrimitive(primitive, rng, box.scale * 0.05);
	return snapPoint((p) => evaluateField(compiled.slots, p), seed, {
		maxStep: 2 * compiled.maxRadius,
		maxSteps: 4,
		epsilon: 1e-5,
	}).position;
}

function assertThrowsMessage(spec, expected) {
	try {
		validateSpec(spec, { maxParts: 64 });
	} catch (error) {
		if (String(error.message).includes(expected)) return;
		throw new Error(`expected ${expected}, got ${error.message}`);
	}
	throw new Error(`expected ${expected}, got pass`);
}

async function runSpecSchemaGate() {
	for (const name of specNames) validateSpec(await loadSpec(name), { maxParts: 64 });

	const base = {
		name: 'Fixture',
		locomotion: { type: 'hopper', hopHeight: 1, hopLength: 1 },
		parts: [{ id: 'body', shape: 'sphere', offset: [0, 1, 0], r: 0.2, color: '#ffffff' }],
	};
	assertThrowsMessage({ ...base, parts: [{ ...base.parts[0], id: '' }] }, 'part.id');
	assertThrowsMessage({ ...base, locomotion: { type: 'crawler' } }, 'locomotion.type');
	assertThrowsMessage({ ...base, parts: [{ ...base.parts[0], color: 'white' }] }, 'body.color');
	assertThrowsMessage({ ...base, parts: [{ ...base.parts[0], r: -1 }] }, 'body.r');
	assertThrowsMessage({ ...base, parts: [{ ...base.parts[0], parent: 'missing' }] }, 'body.parent');
	assertThrowsMessage({
		...base,
		parts: [
			{ id: 'a', shape: 'sphere', offset: [0, 0, 0], r: 0.1, parent: 'b' },
			{ id: 'b', shape: 'sphere', offset: [0, 0, 0], r: 0.1, parent: 'a' },
		],
	}, 'a.parent');
	assertThrowsMessage({
		...base,
		locomotion: { type: 'biped', speed: 1 },
		parts: [base.parts[0]],
	}, 'locomotion.type');
	assertThrowsMessage({
		...base,
		parts: [{ id: 'rope', shape: 'rope', segments: 65, length: 1, r: 0.02 }],
	}, 'spec.maxParts');

	return { status: 'pass', details: { specs: specNames.length, fixtures: 8 } };
}

async function runSminVsHardMin() {
	const entries = await compiledSpecs();
	const rng = createLCG(0x51f1e1d);
	let samples = 0;
	for (const { compiled } of entries) {
		for (let i = 0; i < 200; i++) {
			const p = nearSurfacePoint(compiled, rng);
			const smin = evaluateField(compiled.slots, p).d;
			const hard = hardMin(compiled.slots, p);
			if (smin > hard + 1e-9) {
				return { status: 'fail', details: { message: 'smin exceeded hard min', smin, hard, sample: samples } };
			}
			samples++;
		}
	}
	return { status: 'pass', details: { samples } };
}

async function runThinPartContainment() {
	const spec = await loadSpec('hexapod');
	const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
	const antennae = compiled.slots.filter((slot) => slot.partId.includes('antenna'));
	if (antennae.length !== 2) return { status: 'fail', details: { message: 'missing antenna slots', count: antennae.length } };

	let maxExcess = 0;
	for (const slot of antennae) {
		const basis = basisForPrimitive(slot);
		for (let i = 0; i < 16; i++) {
			const theta = (i / 16) * Math.PI * 2;
			const radial = normalize(add(scale(basis.x, Math.cos(theta)), scale(basis.z, Math.sin(theta))));
			const mid = scale(add(slot.a, slot.b), 0.5);
			const radius = (slot.ra + slot.rb) * 0.5;
			const p = add(mid, scale(radial, radius));
			const d = evaluateField(compiled.slots, p).d;
			maxExcess = Math.max(maxExcess, Math.max(0, -d));
		}
	}
	if (maxExcess > 0.006) return { status: 'fail', details: { message: 'thin part excess too high', maxExcess } };
	return { status: 'pass', details: { maxExcess } };
}

async function runGradientMagnitude() {
	const entries = await compiledSpecs();
	const rng = createLCG(0x9ad1e17);
	let checked = 0;
	let foundModerateCone = false;
	for (const { compiled } of entries) {
		for (const slot of compiled.slots) {
			for (let i = 0; i < 12; i++) {
				const p = surfacePointForPrimitive(slot, rng);
				const e = evaluateCapsulePrimitive(p, slot);
				const nLen = len(e.gradNormalized);
				if (nLen < 0.95 || nLen > 1.05) return { status: 'fail', details: { message: 'normalized primitive gradient out of range', partId: slot.partId, nLen } };
				const slope = Math.abs(e.slope);
				if (slope >= 0.2 && slope <= 0.4 && slot.shape === 'cone') foundModerateCone = true;
				if (slope <= 0.32) {
					const rawLen = len(e.grad);
					const maxRaw = 1.05 * Math.sqrt(1 + 0.32 ** 2);
					if (rawLen < 0.95 || rawLen > maxRaw) return { status: 'fail', details: { message: 'raw primitive gradient out of range', partId: slot.partId, rawLen, slope } };
				}
				checked++;
			}
		}
	}
	if (!foundModerateCone) return { status: 'fail', details: { message: 'missing cone with slope in [0.2,0.4]' } };
	return { status: 'pass', details: { checked } };
}

async function runAnalyticVsCentralDiff() {
	const entries = await compiledSpecs();
	const rng = createLCG(0xce471a1);
	let checked = 0;
	for (const { compiled } of entries) {
		for (let i = 0; i < 200; i++) {
			const p = nearSurfacePoint(compiled, rng);
			const analytic = evaluateField(compiled.slots, p).grad;
			if (len(analytic) < 1e-5) continue;
			const central = centralDiffGradient(compiled.slots, p);
			const delta = len(sub(analytic, central));
			if (delta >= 5e-2) return { status: 'fail', details: { message: 'analytic-central mismatch', delta, point: p } };
			checked++;
		}
	}
	return { status: 'pass', details: { checked } };
}

export const gates = [
	{ id: 'spec-schema', run: runSpecSchemaGate },
	{ id: 'smin-vs-hardmin', run: runSminVsHardMin },
	{ id: 'thin-part-containment', run: runThinPartContainment },
	{ id: 'gradient-magnitude', run: runGradientMagnitude },
	{ id: 'analytic-vs-central-diff', run: runAnalyticVsCentralDiff },
];
