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
	return solveTwoBoneIKInto({ knee: [0, 0, 0], foot: [0, 0, 0], segments: { upperLength: 0, lowerLength: 0 } }, hip, foot, upperLength, lowerLength, bendHint);
}

export function solveTwoBoneIKInto(out, hip, foot, upperLength, lowerLength, bendHint = defaultBendHintForHip(hip)) {
	const l1 = Math.max(Number(upperLength), 1e-8);
	const l2 = Math.max(Number(lowerLength), 1e-8);
	let axisX = foot[0] - hip[0];
	let axisY = foot[1] - hip[1];
	let axisZ = foot[2] - hip[2];
	const rawDistance = Math.hypot(axisX, axisY, axisZ);
	const d = clampReach(rawDistance, Math.abs(l1 - l2), l1 + l2);
	const inverseAxisLength = rawDistance > EPS ? 1 / rawDistance : 0;
	axisX = rawDistance > EPS ? axisX * inverseAxisLength : 0;
	axisY = rawDistance > EPS ? axisY * inverseAxisLength : -1;
	axisZ = rawDistance > EPS ? axisZ * inverseAxisLength : 0;
	const clampedFoot = out.foot ??= [0, 0, 0];
	clampedFoot[0] = hip[0] + axisX * d;
	clampedFoot[1] = hip[1] + axisY * d;
	clampedFoot[2] = hip[2] + axisZ * d;
	const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
	const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
	const midpointX = hip[0] + axisX * a;
	const midpointY = hip[1] + axisY * a;
	const midpointZ = hip[2] + axisZ * a;

	// Full 3D Gram-Schmidt: project every component of the hint off the limb axis.
	const hintProjection = bendHint[0] * axisX + bendHint[1] * axisY + bendHint[2] * axisZ;
	let bendX = bendHint[0] - axisX * hintProjection;
	let bendY = bendHint[1] - axisY * hintProjection;
	let bendZ = bendHint[2] - axisZ * hintProjection;
	let bendLength = Math.hypot(bendX, bendY, bendZ);
	if (bendLength < 1e-8) {
		if (Math.abs(axisY) < 0.9) {
			bendX = -axisZ;
			bendY = 0;
			bendZ = axisX;
		} else {
			bendX = 0;
			bendY = axisZ;
			bendZ = -axisY;
		}
		bendLength = Math.hypot(bendX, bendY, bendZ);
	}
	const inverseBendLength = bendLength > EPS ? 1 / bendLength : 1;
	const knee = out.knee ??= [0, 0, 0];
	knee[0] = midpointX + bendX * inverseBendLength * h;
	knee[1] = midpointY + bendY * inverseBendLength * h;
	knee[2] = midpointZ + bendZ * inverseBendLength * h;
	out.reachable = rawDistance >= Math.abs(l1 - l2) + 1e-4 && rawDistance <= l1 + l2 - 1e-4;
	out.segments ??= { upperLength: 0, lowerLength: 0 };
	out.segments.upperLength = Math.hypot(knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]);
	out.segments.lowerLength = Math.hypot(clampedFoot[0] - knee[0], clampedFoot[1] - knee[1], clampedFoot[2] - knee[2]);
	out.a = a;
	out.h = h;
	return out;
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
