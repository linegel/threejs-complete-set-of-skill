export const DEFAULT_EPSILON = 1e-5;

const TIER_STEPS = {
	hero: 2,
	crowd: 2,
	background: 1,
};

function clone(v) {
	return [v[0], v[1], v[2]];
}

function dot(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

export function snapPoint(fieldEvalFn, point, options = {}) {
	const iso = Number.isFinite(options.iso) ? options.iso : 0;
	const epsilon = Number.isFinite(options.epsilon) ? options.epsilon : DEFAULT_EPSILON;
	const maxSteps = Number.isInteger(options.maxSteps) ? options.maxSteps : (TIER_STEPS[options.tier] ?? 2);
	const maxStep = Number.isFinite(options.maxStep) ? options.maxStep : 1;
	const p = clone(point);
	const moves = [];
	let residual = Number.POSITIVE_INFINITY;

	for (let step = 0; step < maxSteps; step++) {
		const field = fieldEvalFn(p);
		const d = field.d;
		const grad = field.grad ?? field.gradRaw ?? [0, 1, 0];
		residual = Math.abs(d - iso);
		if (!Number.isFinite(d) || residual < epsilon) break;
		const move = clamp((d - iso) / Math.max(dot(grad, grad), 1e-6), -maxStep, maxStep);
		p[0] -= grad[0] * move;
		p[1] -= grad[1] * move;
		p[2] -= grad[2] * move;
		moves.push(Math.abs(move));
	}

	const finalField = fieldEvalFn(p);
	residual = Math.abs(finalField.d - iso);

	return {
		position: p,
		residual,
		steps: moves.length,
		maxMove: moves.reduce((best, value) => Math.max(best, value), 0),
		moves,
	};
}
