import { evaluateField } from '../core/field.js';

export const FIELD_TSL_PARITY_CONTRACT = 'same formulas as src/core/field.js; CPU parity probes gate browser evidence';

export function evaluateFieldNodeTwin(primitives, point, options = {}) {
	return evaluateField(primitives, point, options);
}

export function createFieldParityProbe(primitives, points, options = {}) {
	const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 3e-5;
	let maxError = 0;
	for (const point of points) {
		const cpu = evaluateField(primitives, point, options);
		const twin = evaluateFieldNodeTwin(primitives, point, options);
		maxError = Math.max(maxError, Math.abs(cpu.d - twin.d));
		for (let i = 0; i < 3; i++) maxError = Math.max(maxError, Math.abs(cpu.gradNormalized[i] - twin.gradNormalized[i]));
	}
	return {
		status: maxError <= tolerance ? 'pass' : 'fail',
		maxError,
		tolerance,
		samples: points.length,
	};
}
