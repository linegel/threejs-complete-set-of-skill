const EPS = 1e-9;

const DEFAULT_AXIS = [ 0, 1, 0 ];
const DEFAULT_HINT = [ 0, 0, 1 ];

function norm(v) {
	return Math.hypot(v[ 0 ], v[ 1 ], v[ 2 ]);
}

function normalize(v) {
	const l = norm(v);
	if (!Number.isFinite(l) || l <= EPS) return [ 0, 1, 0 ];
	return [ v[ 0 ] / l, v[ 1 ] / l, v[ 2 ] / l ];
}

function sub(a, b) {
	return [ a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] ];
}

function add(a, b) {
	return [ a[ 0 ] + b[ 0 ], a[ 1 ] + b[ 1 ], a[ 2 ] + b[ 2 ] ];
}

function mul(v, s) {
	return [ v[ 0 ] * s, v[ 1 ] * s, v[ 2 ] * s ];
}

function dot(a, b) {
	return a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ];
}

function cross(a, b) {
	return [
		a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ],
		a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ],
		a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ]
	];
}

function projectToPlane(v, normal) {
	const n = normalize(normal);
	const p = dot(v, n);
	return sub(v, mul(n, p));
}

function toLength(v, length) {
	return mul(normalize(v), length);
}

export function clampReach(distance, lower, upper) {
	const lo = Math.max(lower, 1e-4);
	const hi = Math.max(lo, upper - 1e-4);
	if (!Number.isFinite(distance)) return lo;
	return Math.min(hi, Math.max(lo, distance));
}

export function solveLimbTarget2Bone(hip, foot, upperLength, lowerLength, hint = DEFAULT_HINT) {
	const l1 = Math.max(Number(upperLength), 1e-8);
	const l2 = Math.max(Number(lowerLength), 1e-8);
	const d = clampReach(norm(sub(foot, hip)), Math.abs(l1 - l2), l1 + l2);
	const axis = normalize(sub(foot, hip));
	const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
	const hSq = Math.max(l1 * l1 - a * a, 0);
	const h = Math.sqrt(hSq);
	const midpoint = add(hip, mul(axis, a));
	const hintVector = normalize(projectToPlane(hint, axis));
	const fallbackHint = cross(axis, DEFAULT_AXIS);
	const planeAxis = norm(hintVector) > 0.1 ? hintVector : normalize(fallbackHint);
	const offset = mul(normalize(cross(axis, planeAxis)), h);
	const knee = add(midpoint, offset);
	const footPos = [
		foot[ 0 ],
		foot[ 1 ],
		foot[ 2 ]
	];
	const targetDist = norm(sub(footPos, knee));
	const lowerDir = normalize(sub(footPos, knee));
	const lowerEndpoint = add(knee, mul(lowerDir, l2));
	const lengthReconstructionError = Math.abs(targetDist - l2);
	const segment = {
		hip: [ hip[ 0 ], hip[ 1 ], hip[ 2 ] ],
		knee: [ knee[ 0 ], knee[ 1 ], knee[ 2 ] ],
		foot: [ footPos[ 0 ], footPos[ 1 ], footPos[ 2 ] ],
		segments: {
			upperLength: norm(sub(knee, hip)),
			lowerLength: norm(sub(footPos, knee))
		},
		a,
		h,
		lengthReconstructionError,
		reachable: Number.isFinite(d)
	};
	return segment;
}

export function reconstructLegWorldLengthMismatch(upperLength, lowerLength) {
	return clampReach(upperLength + lowerLength, Math.abs(upperLength - lowerLength) + 1e-4, upperLength + lowerLength);
}

export function make2BoneIKState({ hip = [ 0, 0, 0 ], upperLength = 0.44, lowerLength = 0.44, hint = DEFAULT_HINT } = {}) {
	return {
		hip: [ ...hip ],
		upperLength,
		lowerLength,
		hint: [ ...hint ],
		lastTarget: [ hip[ 0 ], hip[ 1 ], hip[ 2 ] ],
		lastKnee: [ hip[ 0 ], hip[ 1 ], hip[ 2 ] ],
		lastFoot: [ hip[ 0 ], hip[ 1 ], hip[ 2 ] ],
		lastSegment: null
	};
}

export function update2BoneIK(state, target, force = false) {
	if (!state || !Array.isArray(target) || target.length < 3) {
		throw new Error("state and target are required");
	}
	if (force) {
		state.lastTarget = [ target[ 0 ], target[ 1 ], target[ 2 ] ];
	}
	const segment = solveLimbTarget2Bone(
		state.hip,
		target,
		Number(state.upperLength),
		Number(state.lowerLength),
		state.hint
	);
	state.lastKnee = segment.knee;
	state.lastFoot = segment.foot;
	state.lastTarget = [ target[ 0 ], target[ 1 ], target[ 2 ] ];
	state.lastSegment = segment;
	return segment;
}

