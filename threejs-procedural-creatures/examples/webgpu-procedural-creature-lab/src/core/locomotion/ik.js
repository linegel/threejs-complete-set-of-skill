const EPS = 1e-12;

function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function mul(v, s) {
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

function length(v) {
	return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v, fallback = [0, 1, 0]) {
	const d = length(v);
	if (!Number.isFinite(d) || d < EPS) return fallback.slice();
	return [v[0] / d, v[1] / d, v[2] / d];
}

export function clampReach(distance, lower, upper) {
	const lo = Math.max(Math.abs(lower) + 1e-4, 1e-4);
	const hi = Math.max(lo, upper - 1e-4);
	return Math.min(hi, Math.max(lo, Number.isFinite(distance) ? distance : lo));
}

export function defaultBendHintForHip(hip) {
	const side = hip[0] >= 0 ? 1 : -1;
	return [side, 0, 0.4];
}

export function solveTwoBoneIK(hip, foot, upperLength, lowerLength, bendHint = defaultBendHintForHip(hip)) {
	const l1 = Math.max(Number(upperLength), 1e-8);
	const l2 = Math.max(Number(lowerLength), 1e-8);
	const rawAxis = sub(foot, hip);
	const rawDistance = length(rawAxis);
	const d = clampReach(rawDistance, Math.abs(l1 - l2), l1 + l2);
	const axis = normalize(rawAxis, [0, -1, 0]);
	const clampedFoot = add(hip, mul(axis, d));
	const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
	const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
	const midpoint = add(hip, mul(axis, a));

	// Full 3D Gram-Schmidt: project every component of the hint off the limb axis.
	let bend = sub(bendHint, mul(axis, dot(bendHint, axis)));
	if (length(bend) < 1e-8) {
		const fallback = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
		bend = cross(axis, fallback);
	}
	bend = normalize(bend, [1, 0, 0]);
	const knee = add(midpoint, mul(bend, h));
	return {
		knee,
		foot: clampedFoot,
		reachable: rawDistance >= Math.abs(l1 - l2) + 1e-4 && rawDistance <= l1 + l2 - 1e-4,
		segments: {
			upperLength: length(sub(knee, hip)),
			lowerLength: length(sub(clampedFoot, knee)),
		},
		a,
		h,
	};
}

export function solveLimbTarget2Bone(hip, foot, upperLength, lowerLength, hint = defaultBendHintForHip(hip)) {
	const solved = solveTwoBoneIK(hip, foot, upperLength, lowerLength, hint);
	return {
		hip: hip.slice(),
		knee: solved.knee,
		foot: solved.foot,
		segments: solved.segments,
		a: solved.a,
		h: solved.h,
		reachable: solved.reachable,
		lengthReconstructionError: Math.abs(solved.segments.lowerLength - lowerLength),
	};
}

export function make2BoneIKState({ hip = [0, 0, 0], upperLength = 0.44, lowerLength = 0.44, hint = defaultBendHintForHip(hip) } = {}) {
	return {
		hip: hip.slice(),
		upperLength,
		lowerLength,
		hint: hint.slice(),
		lastTarget: hip.slice(),
		lastKnee: hip.slice(),
		lastFoot: hip.slice(),
		lastSegment: null,
	};
}

export function update2BoneIK(state, target) {
	if (!state || !Array.isArray(target)) throw new Error('update2BoneIK requires state and target');
	const segment = solveLimbTarget2Bone(state.hip, target, state.upperLength, state.lowerLength, state.hint);
	state.lastTarget = target.slice();
	state.lastKnee = segment.knee.slice();
	state.lastFoot = segment.foot.slice();
	state.lastSegment = segment;
	return segment;
}

export function reconstructLegWorldLengthMismatch(upperLength, lowerLength) {
	return clampReach(upperLength + lowerLength, Math.abs(upperLength - lowerLength), upperLength + lowerLength);
}
