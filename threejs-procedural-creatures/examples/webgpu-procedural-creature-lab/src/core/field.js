export const GRAD_EPS = 1e-3;

const EPS = 1e-6;

function clamp(value, min = 0, max = 1) {
	return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function mixVec(a, b, t) {
	return [
		lerp(a[0], b[0], t),
		lerp(a[1], b[1], t),
		lerp(a[2], b[2], t),
	];
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

function dot(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(v) {
	return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v, fallback = [0, 1, 0]) {
	const len = length(v);
	if (!Number.isFinite(len) || len < EPS) return fallback.slice();
	return scale(v, 1 / len);
}

function orderedCandidates(primitives, candidates) {
	if (!Array.isArray(candidates)) return primitives.map((_, index) => index);
	return [...candidates]
		.filter((index) => Number.isInteger(index) && index >= 0 && index < primitives.length)
		.sort((a, b) => a - b);
}

export function selectSurfaceOwner(primitives, point, options = {}) {
	let owner = -1;
	let ownerDistance = Number.POSITIVE_INFINITY;
	for (const index of orderedCandidates(primitives, options.candidates)) {
		const distance = evaluateCapsulePrimitive(point, primitives[index]).d;
		// Stable tie rule: lower slot wins. This is independent of draw order and
		// removes coincident full-shell z-fighting from the diagnostic surface.
		if (distance < ownerDistance || (Math.abs(distance - ownerDistance) <= 1e-12 && index < owner)) {
			owner = index;
			ownerDistance = distance;
		}
	}
	return { owner, distance: ownerDistance };
}

export function evaluateCapsulePrimitive(arg0, arg1) {
	const point = Array.isArray(arg0) ? arg0 : arg1;
	const primitive = Array.isArray(arg0) ? arg1 : arg0;
	const a = primitive.a;
	const b = primitive.b;
	const ba = sub(b, a);
	const pa = sub(point, a);
	const baLen2 = dot(ba, ba);
	const t = baLen2 < 1e-12 ? 0 : clamp(dot(pa, ba) / baLen2, 0, 1);
	const q = sub(pa, scale(ba, t));
	const qLen = length(q);
	const radial = scale(q, 1 / Math.max(qLen, EPS));
	const baLen = Math.sqrt(Math.max(baLen2, 0));
	const axis = baLen > EPS ? scale(ba, 1 / baLen) : [0, 1, 0];
	const ra = primitive.ra;
	const rb = primitive.rb;
	const s = (rb - ra) / Math.max(baLen, EPS);
	let grad = radial;
	if (t > 0 && t < 1) grad = sub(radial, scale(axis, s));
	const d = qLen - lerp(ra, rb, t);
	const gradNormalized = normalize(grad);
	return {
		d,
		grad,
		gradNormalized,
		t,
		q,
		radial,
		slope: s,
		k: Math.max(primitive.k ?? 1e-5, 1e-5),
		color: primitive.color ?? [0.85, 0.72, 0.5],
	};
}

export function hardMin(primitives, point, options = {}) {
	let best = Number.POSITIVE_INFINITY;
	for (const index of orderedCandidates(primitives, options.candidates)) {
		const d = evaluateCapsulePrimitive(point, primitives[index]).d;
		if (d < best) best = d;
	}
	return best;
}

function evaluateNoAo(primitives, point, options = {}) {
	const indices = orderedCandidates(primitives, options.candidates);
	const perPrimitive = [];
	let dMin = Number.POSITIVE_INFINITY;
	const sampleBySlot = new Map();

	for (const index of indices) {
		const primitive = primitives[index];
		const e = evaluateCapsulePrimitive(point, primitive);
		const entry = { index, d: e.d, grad: e.grad, gradNormalized: e.gradNormalized, k: e.k, color: e.color, t: e.t, slope: e.slope };
		perPrimitive.push(entry);
		sampleBySlot.set(index, entry);
		if (e.d < dMin) dMin = e.d;
	}

	if (perPrimitive.length === 0) {
		return {
			d: Number.POSITIVE_INFINITY,
			grad: [0, 1, 0],
			gradNormalized: [0, 1, 0],
			color: [0.85, 0.72, 0.5],
			owner: -1,
			perPrimitive,
		};
	}

	let d = Number.POSITIVE_INFINITY;
	let grad = [0, 1, 0];
	if (options.blendDag) {
		const values = new Array(options.blendDag.operations.length);
		for (let operationIndex = 0; operationIndex < options.blendDag.operations.length; operationIndex++) {
			const operation = options.blendDag.operations[operationIndex];
			if (operation.kind === 'leaf') {
				const sample = sampleBySlot.get(operation.slot);
				if (!sample) throw new Error(`candidate program omitted blend-DAG leaf slot ${operation.slot}`);
				values[operationIndex] = { d: sample.d, grad: sample.grad };
				continue;
			}
			const left = values[operation.left];
			const right = values[operation.right];
			const k = Math.max(operation.k, 1e-5);
			const h = clamp(0.5 + 0.5 * (left.d - right.d) / k, 0, 1);
			values[operationIndex] = {
				d: lerp(left.d, right.d, h) - k * h * (1 - h),
				grad: mixVec(left.grad, right.grad, h),
			};
		}
		const root = values[options.blendDag.root];
		d = root.d;
		grad = root.grad;
	} else {
		for (const entry of perPrimitive) {
			if (d === Number.POSITIVE_INFINITY) {
				d = entry.d;
				grad = entry.grad.slice();
				continue;
			}
			const k = Math.max(entry.k, 1e-5);
			const h = clamp(0.5 + 0.5 * (d - entry.d) / k, 0, 1);
			d = lerp(d, entry.d, h) - k * h * (1 - h);
			grad = mixVec(grad, entry.grad, h);
		}
	}

	const color = [0, 0, 0];
	let weightSum = 0;
	for (const entry of perPrimitive) {
		const w = Math.exp(-Math.max(entry.d - dMin, 0) / Math.max(entry.k, 1e-5));
		entry.colorWeight = w;
		color[0] += w * entry.color[0];
		color[1] += w * entry.color[1];
		color[2] += w * entry.color[2];
		weightSum += w;
	}
	const invWeight = 1 / Math.max(weightSum, 1e-12);
	color[0] *= invWeight;
	color[1] *= invWeight;
	color[2] *= invWeight;

	return {
		d,
		grad,
		gradNormalized: normalize(grad),
		color,
		owner: perPrimitive.reduce((best, entry) => (
			entry.d < best.d || (Math.abs(entry.d - best.d) <= 1e-12 && entry.index < best.index)
				? { index: entry.index, d: entry.d }
				: best
		), { index: -1, d: Number.POSITIVE_INFINITY }).index,
		perPrimitive,
	};
}

export function evaluateField(primitives, point, options = {}) {
	const result = evaluateNoAo(primitives, point, options);
	if (options.ao || options.selfAO) {
		const bodyScale = Math.max(options.bodyScale ?? options.scale ?? 1, EPS);
		const radii = options.aoRadii ?? [0.035, 0.07, 0.14, 0.28].map((r) => r * bodyScale);
		let occlusion = 0;
		// Derived: four exponentially spaced probes cover 3.5%-28% of body scale,
		// enough to catch limb/body creases without turning AO into global lighting.
		for (let i = 0; i < radii.length; i++) {
			const r = radii[i];
			const p = add(point, scale(result.gradNormalized, r));
			const dProbe = evaluateNoAo(primitives, p, options).d;
			occlusion += Math.pow(0.5, i) * Math.max(r - dProbe, 0) / r;
		}
		const kAo = Number.isFinite(options.kAo) ? options.kAo : 1;
		result.ao = clamp(1 - kAo * occlusion, 0, 1);
	}
	return result;
}

export function centralDiffGradient(primitives, point, options = {}) {
	const eps = Number.isFinite(options.eps) ? options.eps : GRAD_EPS;
	const px = [point[0] + eps, point[1], point[2]];
	const mx = [point[0] - eps, point[1], point[2]];
	const py = [point[0], point[1] + eps, point[2]];
	const my = [point[0], point[1] - eps, point[2]];
	const pz = [point[0], point[1], point[2] + eps];
	const mz = [point[0], point[1], point[2] - eps];
	return [
		(evaluateField(primitives, px, options).d - evaluateField(primitives, mx, options).d) / (2 * eps),
		(evaluateField(primitives, py, options).d - evaluateField(primitives, my, options).d) / (2 * eps),
		(evaluateField(primitives, pz, options).d - evaluateField(primitives, mz, options).d) / (2 * eps),
	];
}

export const evaluateFieldCentralDifference = centralDiffGradient;
