import { createDriver, POSE_STRIDE, seek } from './driver.js';
import { evaluateField } from './field.js';
import { createLCG } from './lcg.js';
import { compileSpec, digest128, TIER_CONFIG } from './rig-compiler.js';
import { snapPoint } from './newton-snap.js';

export const CANDIDATE_CORPUS_VERSION = 'creature-candidate-corpus-v2';

const DEFAULT_SECONDS = 8;
const DEFAULT_POSES = 60;
const DEFAULT_POINTS_PER_SLOT = 8;

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

function normalize(v, fallback = [0, 1, 0]) {
	const magnitude = length(v);
	if (!Number.isFinite(magnitude) || magnitude < 1e-12) return fallback.slice();
	return scale(v, 1 / magnitude);
}

export function posedPrimitivesFromArray(pose, slotCount, compiled = null) {
	const primitives = [];
	for (let slot = 0; slot < slotCount; slot++) {
		const base = slot * POSE_STRIDE;
		const axis = normalize(sub(
			[pose[base + 4], pose[base + 5], pose[base + 6]],
			[pose[base + 0], pose[base + 1], pose[base + 2]],
		));
		const restFrame = compiled?.radialFrames?.[slot];
		const authoredX = restFrame?.x ?? [1, 0, 0];
		let radialX = sub(authoredX, scale(axis, dot(authoredX, axis)));
		if (length(radialX) < 1e-8 && restFrame?.z) radialX = cross(restFrame.z, axis);
		radialX = normalize(radialX, [1, 0, 0]);
		primitives.push({
			a: [pose[base + 0], pose[base + 1], pose[base + 2]],
			ra: pose[base + 3],
			b: [pose[base + 4], pose[base + 5], pose[base + 6]],
			rb: pose[base + 7],
			k: pose[base + 8],
			color: [pose[base + 9], pose[base + 10], pose[base + 11]],
			radialX,
			radialZ: normalize(cross(axis, radialX), [0, 0, 1]),
		});
	}
	return primitives;
}

function posedBodyScale(primitives) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const slot of primitives) {
		const radius = Math.max(slot.ra, slot.rb);
		for (const point of [slot.a, slot.b]) {
			for (let axis = 0; axis < 3; axis++) {
				min[axis] = Math.min(min[axis], point[axis] - radius);
				max[axis] = Math.max(max[axis], point[axis] + radius);
			}
		}
	}
	return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6);
}

function surfacePoint(slot, t, theta) {
	const axis = normalize(sub(slot.b, slot.a));
	const x = slot.radialX ?? [1, 0, 0];
	const z = slot.radialZ ?? normalize(cross(axis, x), [0, 0, 1]);
	const radius = slot.ra + (slot.rb - slot.ra) * t;
	const center = add(slot.a, scale(sub(slot.b, slot.a), t));
	const radial = normalize(add(scale(x, Math.cos(theta)), scale(z, Math.sin(theta))));
	return add(center, scale(radial, radius));
}

function linearRgbToOklab(rgb) {
	const l = 0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2];
	const m = 0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2];
	const s = 0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2];
	const l_ = Math.cbrt(Math.max(l, 0));
	const m_ = Math.cbrt(Math.max(m, 0));
	const s_ = Math.cbrt(Math.max(s, 0));
	return [
		0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
		1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
		0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
	];
}

function angularError(a, b) {
	const na = normalize(a);
	const nb = normalize(b);
	return Math.acos(Math.max(-1, Math.min(1, dot(na, nb))));
}

function corpusSeed(spec, slotCount, options) {
	if (Number.isFinite(options.seed)) return Number(options.seed) >>> 0;
	const digest = digest128({
		version: CANDIDATE_CORPUS_VERSION,
		name: spec.name,
		seed: spec.seed ?? 0,
		slotCount,
		seconds: options.seconds ?? DEFAULT_SECONDS,
		poses: options.poses ?? DEFAULT_POSES,
		pointsPerSlot: options.pointsPerSlot ?? DEFAULT_POINTS_PER_SLOT,
	});
	return Number.parseInt(digest.slice(0, 8), 16) >>> 0;
}

// The corpus contains only tick/parametric surface coordinates. It is created
// once before any candidate-K attempt and its digest is carried into every
// result, so changing K cannot silently change the samples being compared.
export function createFrozenCandidateCorpus(spec, slotCount, options = {}) {
	const seconds = Math.max(1 / 60, Number(options.seconds ?? DEFAULT_SECONDS));
	const poseCount = Math.max(1, Math.floor(options.poses ?? DEFAULT_POSES));
	const pointsPerSlot = Math.max(1, Math.floor(options.pointsPerSlot ?? DEFAULT_POINTS_PER_SLOT));
	const tickStride = Math.max(1, Math.floor((seconds * 60) / poseCount));
	const seed = corpusSeed(spec, slotCount, { ...options, seconds, poses: poseCount, pointsPerSlot });
	const rng = createLCG(seed);
	const samples = new Float32Array(poseCount * slotCount * pointsPerSlot * 2);
	let cursor = 0;
	for (let poseIndex = 0; poseIndex < poseCount; poseIndex++) {
		for (let slot = 0; slot < slotCount; slot++) {
			for (let pointIndex = 0; pointIndex < pointsPerSlot; pointIndex++) {
				samples[cursor++] = 0.1 + rng.nextFloat() * 0.8;
				samples[cursor++] = rng.nextFloat() * Math.PI * 2;
			}
		}
	}
	const digest = digest128({
		version: CANDIDATE_CORPUS_VERSION,
		seed,
		seconds,
		poseCount,
		pointsPerSlot,
		tickStride,
		samples: Array.from(samples),
	});
	return Object.freeze({
		version: CANDIDATE_CORPUS_VERSION,
		seed,
		seconds,
		poseCount,
		pointsPerSlot,
		tickStride,
		slotCount,
		samples,
		digest,
	});
}

export function sweepCandidateProgram(spec, compiled, corpus, options = {}) {
	if (compiled.slots.length !== corpus.slotCount) {
		throw new Error(`candidate corpus slot count ${corpus.slotCount} does not match compiler slot count ${compiled.slots.length}`);
	}
	const driver = createDriver(spec, compiled, { seed: spec.seed ?? 1 });
	let maxDelta = 0;
	let maxNormalizedDelta = 0;
	let maxNormalAngularError = 0;
	let maxPerceptualColorDeltaE = 0;
	let samples = 0;
	let cursor = 0;
	for (let poseIndex = 0; poseIndex < corpus.poseCount; poseIndex++) {
		const tick = (poseIndex + 1) * corpus.tickStride;
		const { pose } = seek(driver, tick / 60);
		const primitives = posedPrimitivesFromArray(pose, compiled.slots.length, compiled);
		const bodyScale = posedBodyScale(primitives);
		const threshold = (options.relativeThreshold ?? 0.02) * bodyScale;
		for (let slot = 0; slot < compiled.slots.length; slot++) {
			const candidates = compiled.candidateSets[slot];
			const certificate = compiled.candidateCertificates?.[slot];
			if (!certificate || certificate.status !== 'accepted-exact' || !certificate.preservesBlendAncestry) {
				return {
					pass: false,
					error: `candidate set ${slot} has no finite blend-aware distance/normal/color tail certificate`,
					certificate,
					corpusDigest: corpus.digest,
				};
			}
			if (candidates.length > compiled.candidateK || !candidates.includes(slot)) {
				return {
					pass: false,
					error: `candidate set ${slot} violates total-K=${compiled.candidateK} owner-inclusive contract`,
					corpusDigest: corpus.digest,
				};
			}
			for (let pointIndex = 0; pointIndex < corpus.pointsPerSlot; pointIndex++) {
				const t = corpus.samples[cursor++];
				const theta = corpus.samples[cursor++];
				const seedPoint = surfacePoint(primitives[slot], t, theta);
				const snapped = snapPoint(
					(point) => evaluateField(primitives, point, { candidates, blendDag: compiled.blendDag }),
					seedPoint,
					{ maxStep: 2 * compiled.maxRadius, maxSteps: 2, epsilon: 1e-5 },
				);
				const candidateResult = evaluateField(primitives, snapped.position, { candidates, blendDag: compiled.blendDag });
				const fullResult = evaluateField(primitives, snapped.position, { blendDag: compiled.blendDag });
				const candidateDistance = candidateResult.d;
				const fullDistance = fullResult.d;
				const delta = Math.abs(candidateDistance - fullDistance);
				const normalError = angularError(candidateResult.grad, fullResult.grad);
				const candidateLab = linearRgbToOklab(candidateResult.color);
				const fullLab = linearRgbToOklab(fullResult.color);
				const colorDelta = length(sub(candidateLab, fullLab));
				maxDelta = Math.max(maxDelta, delta);
				maxNormalizedDelta = Math.max(maxNormalizedDelta, delta / bodyScale);
				maxNormalAngularError = Math.max(maxNormalAngularError, normalError);
				maxPerceptualColorDeltaE = Math.max(maxPerceptualColorDeltaE, colorDelta);
				samples += 1;
				if (delta >= threshold) {
					return {
						pass: false,
						maxDelta,
						maxNormalizedDelta,
						samples,
						threshold,
						failedSlot: slot,
						tick,
						corpusDigest: corpus.digest,
					};
				}
			}
		}
	}
	return {
		pass: true,
		maxDelta,
		maxNormalizedDelta,
		maxNormalAngularError,
		maxPerceptualColorDeltaE,
		tailBounds: { distance: 0, normalRadians: 0, colorWeight: 0, perceptualDeltaE: 0 },
		samples,
		corpusDigest: corpus.digest,
	};
}

export function certifyCandidateCapacity(spec, options = {}) {
	const tier = options.tier ?? 'hero';
	const maxParts = options.maxParts ?? 64;
	const initial = compileSpec(spec, {
		tier,
		maxParts,
		candidateK: options.initialK ?? TIER_CONFIG[tier]?.candidateK ?? 1,
	});
	const corpus = options.corpus ?? createFrozenCandidateCorpus(spec, initial.slots.length, options.corpusOptions);
	const cap = Math.min(initial.slots.length, Math.max(1, Math.floor(options.kCap ?? initial.slots.length)));
	let candidateK = Math.min(cap, Math.max(1, Math.floor(options.initialK ?? initial.candidateK)));
	const attempts = [];
	while (candidateK <= cap) {
		const compiled = compileSpec(spec, { tier, maxParts, candidateK });
		const sweep = sweepCandidateProgram(spec, compiled, corpus, options);
		attempts.push({
			candidateK,
			pass: sweep.pass,
			maxDelta: sweep.maxDelta ?? null,
			maxNormalizedDelta: sweep.maxNormalizedDelta ?? null,
			maxNormalAngularError: sweep.maxNormalAngularError ?? null,
			maxPerceptualColorDeltaE: sweep.maxPerceptualColorDeltaE ?? null,
			samples: sweep.samples ?? 0,
			corpusDigest: corpus.digest,
		});
		if (sweep.pass) {
			const certificationDigest = digest128({
				spec: spec.name,
				tier,
				candidateK,
				corpusDigest: corpus.digest,
				blendCanonicalSource: compiled.blendDag.canonicalSource,
				candidateCertificateDigest: compiled.candidateCertificateDigest,
				metrics: sweep,
			});
			compiled.runtimeCertification = Object.freeze({
				version: 'creature-runtime-certification-v3',
				digest: certificationDigest,
				corpusDigest: corpus.digest,
				candidateCertificateDigest: compiled.candidateCertificateDigest,
				distanceTailBound: 0,
				normalAngularBoundRadians: 0,
				colorWeightBound: 0,
				perceptualColorDeltaEBound: 0,
			});
			return {
				status: 'accepted',
				spec: spec.name,
				tier,
				kInitial: initial.candidateK,
				kRequired: candidateK,
				corpusVersion: corpus.version,
				corpusDigest: corpus.digest,
				attempts,
				certificationDigest,
				compiled,
			};
		}
		candidateK += 1;
	}
	return {
		status: 'rejected',
		spec: spec.name,
		tier,
		kInitial: initial.candidateK,
		kRequired: null,
		corpusVersion: corpus.version,
		corpusDigest: corpus.digest,
		attempts,
		error: `candidate certification REJECT: spec '${spec.name}' at tier '${tier}' failed the frozen corpus through total K=${cap}`,
	};
}
