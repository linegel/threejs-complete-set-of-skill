import { applyCorrectionToSurface, buildCorrectionRegion, correctPointBounded } from '../../core/correction.js';

function sphereField(point) {
	const length = Math.hypot(...point);
	return { d: length - 1, grad: length > 1e-8 ? point.map((component) => component / length) : [0, 0, 0] };
}

async function runBoundedCorrection() {
	const corrected = correctPointBounded(sphereField, [1.2, 0, 0], { trustRadius: 0.3, maximumTrials: 2 });
	if (!corrected.applied || !(corrected.finalResidual < corrected.initialResidual) || corrected.moveDistance > 0.3) {
		return { status: 'fail', details: { message: 'bounded correction did not decrease sphere residual inside trust radius', corrected } };
	}
	const clamped = correctPointBounded(sphereField, [1.2, 0, 0], { trustRadius: 0.05, maximumTrials: 1 });
	if (Math.abs(clamped.moveDistance - 0.05) > 1e-9) return { status: 'fail', details: { message: 'correction trust-radius clamp did not activate', clamped } };
	const backed = correctPointBounded((point) => ({ d: point[0], grad: [0.1, 0, 0] }), [1, 0, 0], { trustRadius: 10, maximumTrials: 1, maximumBacktracks: 4 });
	if (!(backed.applied && backed.backtracks === 3 && backed.finalResidual < backed.initialResidual)) return { status: 'fail', details: { message: 'correction backtracking did not recover an overshoot', backed } };
	return { status: 'pass', details: { corrected, clamped, backed } };
}

async function runCorrectionFailurePreservesSkin() {
	const original = [0.7, -0.2, 0.4];
	const degenerate = correctPointBounded(() => ({ d: 1, grad: [0, 0, 0] }), original, { trustRadius: 0.2, maximumTrials: 2 });
	const noDescent = correctPointBounded((point) => ({ d: point[0] === original[0] ? 1 : 2, grad: [1, 0, 0] }), original, { trustRadius: 0.2, maximumTrials: 1, maximumBacktracks: 2 });
	for (const result of [degenerate, noDescent]) {
		if (result.applied || !result.preservedSkinOnly || JSON.stringify(result.position) !== JSON.stringify(original)) {
			return { status: 'fail', details: { message: 'failed correction changed the skin-only position', result, original } };
		}
	}
	return { status: 'pass', details: { degenerateReason: degenerate.reason, noDescentReason: noDescent.reason } };
}

async function runCorrectionRegion() {
	const mesh = {
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
		indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
	};
	const region = buildCorrectionRegion(mesh, new Float32Array([0.2, 0, 0, 0]), { threshold: 0.1, maximumFraction: 1, minimumIslandVertices: 1 });
	if (region.directCount !== 1 || region.grownCount !== 4 || region.mask.some((value) => value !== 1)) {
		return { status: 'fail', details: { message: 'correction mask did not grow by exactly one mesh ring', region } };
	}
	const rejected = buildCorrectionRegion(mesh, new Float32Array([0.2, 0, 0, 0]), { threshold: 0.1, maximumFraction: 0.25, minimumIslandVertices: 1 });
	if (rejected.status !== 'rejected') return { status: 'fail', details: { message: 'whole-body correction disguise exceeded 25% but passed', rejected } };
	const feathered = buildCorrectionRegion(mesh, new Float32Array([0.2, 0, 0, 0]), { threshold: 0.1, maximumFraction: 1, minimumIslandVertices: 1, featherRings: 2 });
	if (feathered.weights[0] !== 1 || feathered.weights.some((value, vertex) => value < 0 || value > 1 || (vertex !== 0 && value >= 1))) {
		return { status: 'fail', details: { message: 'feathered region weights are not bounded and decreasing away from the direct defect', weights: [...feathered.weights] } };
	}
	const correctedSurface = applyCorrectionToSurface(
		{ ...mesh, normals: new Float32Array(mesh.positions.length) },
		new Float32Array([0.5, 0, 0, 0]),
		(point) => ({ d: point[0] - 0.4, grad: [1, 0, 0] }),
		{ trustRadius: 1, maximumTrials: 1 },
	);
	if (Math.abs(correctedSurface.positions[0] - 0.2) > 1e-7) return { status: 'fail', details: { message: 'weighted correction did not blend the accepted displacement', position: correctedSurface.positions[0] } };
	return { status: 'pass', details: { grownCount: region.grownCount, rejectedFraction: rejected.fraction, maximumFraction: rejected.maximumFraction, featherWeights: [...feathered.weights] } };
}

export const gates = [
	{ id: 'bounded-correction', run: runBoundedCorrection },
	{ id: 'correction-failure-preserves-skin', run: runCorrectionFailurePreservesSkin },
	{ id: 'correction-region-policy', run: runCorrectionRegion },
];
