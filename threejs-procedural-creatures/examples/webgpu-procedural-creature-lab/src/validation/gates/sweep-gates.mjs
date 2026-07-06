import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateField } from '../../core/field.js';
import { createLCG } from '../../core/lcg.js';
import { snapPoint } from '../../core/newton-snap.js';
import { compileSpec } from '../../core/rig-compiler.js';
import { createDriver, seek, POSE_STRIDE } from '../../core/driver.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const specNames = ['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'];

// Sweep shape (Derived): 60 poses over an 8 s run covers > 1 full cycle of every
// locomotion mode in the six specs (gait stride ~0.5-1 s, hop cycle < 2 s, flap
// period < 1 s, swim period ~2.2 s); 8 seeded surface points per slot per pose
// keeps the whole gate under a second per spec at lab slot counts while sampling
// every slot's surface across the pose cycle.
const SWEEP_SECONDS = 8;
const SWEEP_POSES = 60;
const POINTS_PER_SLOT = 8;

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

function posedPrimitives(pose, slotCount) {
	const primitives = [];
	for (let slot = 0; slot < slotCount; slot++) {
		const base = slot * POSE_STRIDE;
		primitives.push({
			a: [pose[base + 0], pose[base + 1], pose[base + 2]],
			ra: pose[base + 3],
			b: [pose[base + 4], pose[base + 5], pose[base + 6]],
			rb: pose[base + 7],
			k: pose[base + 8],
		});
	}
	return primitives;
}

function posedBodyScale(primitives) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const slot of primitives) {
		const r = Math.max(slot.ra, slot.rb);
		for (const p of [slot.a, slot.b]) {
			for (let i = 0; i < 3; i++) {
				min[i] = Math.min(min[i], p[i] - r);
				max[i] = Math.max(max[i], p[i] + r);
			}
		}
	}
	return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6);
}

function surfacePoint(slot, rng) {
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

// One full-field locomotion sweep at a fixed K. Returns { pass, maxDelta, samples,
// threshold } — the ONLY accepted bound for the K-candidate approximation of the
// order-dependent sequential smin fold (reference §4/§10).
function sweepCompiled(spec, compiled, seedBase) {
	const slotCount = compiled.slots.length;
	const driver = createDriver(spec, compiled, { seed: spec.seed ?? 1 });
	const rng = createLCG(seedBase);
	const tickStride = Math.max(1, Math.floor((SWEEP_SECONDS * 60) / SWEEP_POSES));
	let maxDelta = 0;
	let samples = 0;
	let threshold = 0;

	for (let poseIndex = 0; poseIndex < SWEEP_POSES; poseIndex++) {
		const tick = (poseIndex + 1) * tickStride;
		const { pose } = seek(driver, tick / 60);
		const primitives = posedPrimitives(pose, slotCount);
		const bodyScale = posedBodyScale(primitives);
		threshold = 0.02 * bodyScale;

		for (let slot = 0; slot < slotCount; slot++) {
			const candidates = compiled.candidateSets[slot];
			for (let i = 0; i < POINTS_PER_SLOT; i++) {
				const seedPoint = surfacePoint(primitives[slot], rng);
				const snapped = snapPoint(
					(p) => evaluateField(primitives, p, { candidates }),
					seedPoint,
					{ maxStep: 2 * compiled.maxRadius, maxSteps: 2, epsilon: 1e-5 },
				);
				const dCand = evaluateField(primitives, snapped.position, { candidates }).d;
				const dFull = evaluateField(primitives, snapped.position).d;
				const delta = Math.abs(dCand - dFull);
				maxDelta = Math.max(maxDelta, delta);
				samples++;
				if (delta >= threshold) {
					return { pass: false, maxDelta, samples, threshold, failedSlot: slot, tick };
				}
			}
		}
	}
	return { pass: true, maxDelta, samples, threshold };
}

// The W-L(a) landed policy, executable: run the sweep at the tier default K; on
// failure raise K (+2, rebuild candidate sets) and re-run; past the cap REJECT the
// spec with a named error. Cap (Derived): the hero tier-table K is 8; the lab cap
// min(slotCount, 12) allows the raise path headroom on small rigs while still
// rejecting genuinely under-connected topologies instead of silently unbounding K.
function evaluateSpecWithPolicy(spec, tier, { initialK = null, kCap = null } = {}) {
	const first = compileSpec(spec, { tier, maxParts: 64, ...(initialK ? { candidateK: initialK } : {}) });
	const cap = kCap ?? Math.min(first.slots.length, 12);
	let k = initialK ?? first.candidateK;
	const attempts = [];

	while (true) {
		const compiled = compileSpec(spec, { tier, maxParts: 64, candidateK: k });
		const result = sweepCompiled(spec, compiled, 0x5eed5e7 ^ k);
		attempts.push({ k, maxDelta: result.maxDelta, pass: result.pass });
		if (result.pass) {
			return { status: 'pass', kInitial: attempts[0].k, kRequired: k, maxDelta: result.maxDelta, samples: result.samples, threshold: result.threshold, attempts };
		}
		const nextK = k + 2;
		if (nextK > cap) {
			return {
				status: 'reject',
				error: `candidate-set sweep REJECT: spec '${spec.name}' at tier '${tier}' still fails at K=${k} (cap ${cap}); raise-K policy exhausted`,
				kInitial: attempts[0].k,
				kRequired: null,
				attempts,
			};
		}
		k = nextK;
	}
}

async function runCandidateSetSweep() {
	const perSpec = [];
	for (const name of specNames) {
		const spec = await loadSpec(name);
		const result = evaluateSpecWithPolicy(spec, 'hero');
		if (result.status === 'reject') {
			return { status: 'fail', details: { message: result.error, spec: name, attempts: result.attempts } };
		}
		perSpec.push({ spec: name, kInitial: result.kInitial, kRequired: result.kRequired, maxDelta: result.maxDelta, threshold: result.threshold, samples: result.samples });
	}
	return { status: 'pass', details: { poses: SWEEP_POSES, seconds: SWEEP_SECONDS, perSpec } };
}

// A star of 12 fat, heavily blended capsules radiating from one hub: every arm
// blends with every other near the hub, so a K=1 candidate set (owner only)
// provably misses contributors and the sweep must fail, forcing the raise-K path.
function underConnectedFixture() {
	const parts = [{ id: 'hub', shape: 'sphere', offset: [0, 0.5, 0], r: 0.3, k: 0.25, color: '#888888' }];
	for (let i = 0; i < 12; i++) {
		const angle = (i / 12) * Math.PI * 2;
		const dir = [Math.cos(angle), 0.15 * ((i % 3) - 1), Math.sin(angle)];
		parts.push({
			id: `arm-${String(i).padStart(2, '0')}`,
			shape: 'capsule',
			a: [dir[0] * 0.1, 0.5 + dir[1] * 0.1, dir[2] * 0.1],
			b: [dir[0] * 0.55, 0.5 + dir[1] * 0.55, dir[2] * 0.55],
			r: 0.16,
			k: 0.22,
			color: '#888888',
		});
	}
	return {
		name: 'under-connected-star-fixture',
		seed: 99,
		locomotion: { type: 'hopper', hopHeight: 0.6, hopLength: 0.5 },
		parts,
	};
}

async function runRaiseKFixture() {
	const fixture = underConnectedFixture();

	// Raise path: starting at K=1 the sweep must fail, and the policy must raise K
	// (kRequired > 1) before passing under a generous cap.
	const raised = evaluateSpecWithPolicy(fixture, 'hero', { initialK: 1, kCap: 13 });
	if (raised.status !== 'pass') {
		return { status: 'fail', details: { message: 'fixture never passed even with raised K', attempts: raised.attempts } };
	}
	if (!(raised.kRequired > raised.kInitial)) {
		return {
			status: 'fail',
			details: { message: 'fixture passed at K=1 — it does not exercise the raise-K path', kInitial: raised.kInitial, kRequired: raised.kRequired, attempts: raised.attempts },
		};
	}

	// Reject path: cap the policy below the K the fixture needs; expect the named error.
	const rejected = evaluateSpecWithPolicy(fixture, 'hero', { initialK: 1, kCap: 2 });
	if (rejected.status !== 'reject' || !rejected.error.includes(fixture.name) || !rejected.error.includes('hero')) {
		return { status: 'fail', details: { message: 'reject path did not produce the named rejection error', got: rejected } };
	}

	return {
		status: 'pass',
		details: {
			kInitial: raised.kInitial,
			kRequired: raised.kRequired,
			raiseAttempts: raised.attempts,
			rejectError: rejected.error,
		},
	};
}

export const gates = [
	{ id: 'candidate-set-sweep', run: runCandidateSetSweep },
	{ id: 'raise-k-policy-fixture', run: runRaiseKFixture },
];
