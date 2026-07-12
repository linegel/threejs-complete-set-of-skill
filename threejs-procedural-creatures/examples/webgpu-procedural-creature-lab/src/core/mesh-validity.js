function point(positions, index) {
	const offset = index * 3;
	return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
}

function dot(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function triangleAreaAndAngles(a, b, c) {
	const ab = sub(b, a);
	const ac = sub(c, a);
	const bc = sub(c, b);
	const twiceArea = Math.hypot(...cross(ab, ac));
	const lengths = [Math.hypot(...bc), Math.hypot(...ac), Math.hypot(...ab)];
	const angles = lengths.map((opposite, index) => {
		const adjacentA = lengths[(index + 1) % 3];
		const adjacentB = lengths[(index + 2) % 3];
		const denominator = 2 * adjacentA * adjacentB;
		if (!(denominator > 0)) return 0;
		const cosine = Math.max(-1, Math.min(1, (adjacentA ** 2 + adjacentB ** 2 - opposite ** 2) / denominator));
		return Math.acos(cosine);
	});
	return { area: twiceArea * 0.5, minAngleRadians: Math.min(...angles) };
}

function quantile(values, probability) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}

function minimum(values) {
	let result = Number.POSITIVE_INFINITY;
	for (const value of values) result = Math.min(result, value);
	return result === Number.POSITIVE_INFINITY ? null : result;
}

function everyFinite(values) {
	for (const value of values) if (!Number.isFinite(value)) return false;
	return true;
}

function triangleBounds(positions, indices) {
	const triangleCount = indices.length / 3;
	const bounds = new Float64Array(triangleCount * 6);
	const centroids = new Float64Array(triangleCount * 3);
	for (let triangle = 0; triangle < triangleCount; triangle++) {
		const a = point(positions, indices[triangle * 3]);
		const b = point(positions, indices[triangle * 3 + 1]);
		const c = point(positions, indices[triangle * 3 + 2]);
		for (let axis = 0; axis < 3; axis++) {
			bounds[triangle * 6 + axis] = Math.min(a[axis], b[axis], c[axis]);
			bounds[triangle * 6 + 3 + axis] = Math.max(a[axis], b[axis], c[axis]);
			centroids[triangle * 3 + axis] = (a[axis] + b[axis] + c[axis]) / 3;
		}
	}
	return { bounds, centroids };
}

function boundsOverlap(bounds, left, right, epsilon) {
	for (let axis = 0; axis < 3; axis++) {
		if (bounds[left * 6 + 3 + axis] < bounds[right * 6 + axis] - epsilon
			|| bounds[right * 6 + 3 + axis] < bounds[left * 6 + axis] - epsilon) return false;
	}
	return true;
}

function buildTriangleBvh(bounds, centroids, leafSize = 8) {
	const order = Array.from({ length: bounds.length / 6 }, (_, index) => index);
	function build(start, end) {
		const nodeBounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
		for (let cursor = start; cursor < end; cursor++) {
			const triangle = order[cursor];
			for (let axis = 0; axis < 3; axis++) {
				nodeBounds[axis] = Math.min(nodeBounds[axis], bounds[triangle * 6 + axis]);
				nodeBounds[3 + axis] = Math.max(nodeBounds[3 + axis], bounds[triangle * 6 + 3 + axis]);
			}
		}
		if (end - start <= leafSize) return { bounds: nodeBounds, start, end, left: null, right: null };
		let axis = 0;
		if (nodeBounds[4] - nodeBounds[1] > nodeBounds[3] - nodeBounds[0]) axis = 1;
		if (nodeBounds[5] - nodeBounds[2] > nodeBounds[3 + axis] - nodeBounds[axis]) axis = 2;
		const sorted = order.slice(start, end).sort((left, right) => centroids[left * 3 + axis] - centroids[right * 3 + axis] || left - right);
		for (let cursor = 0; cursor < sorted.length; cursor++) order[start + cursor] = sorted[cursor];
		const middle = start + Math.floor((end - start) / 2);
		return { bounds: nodeBounds, start, end, left: build(start, middle), right: build(middle, end) };
	}
	return { root: build(0, order.length), order };
}

function nodeOverlapsTriangle(node, bounds, triangle, epsilon) {
	for (let axis = 0; axis < 3; axis++) {
		if (node.bounds[3 + axis] < bounds[triangle * 6 + axis] - epsilon
			|| bounds[triangle * 6 + 3 + axis] < node.bounds[axis] - epsilon) return false;
	}
	return true;
}

function sharesVertex(indices, left, right) {
	for (let a = 0; a < 3; a++) {
		for (let b = 0; b < 3; b++) {
			if (indices[left * 3 + a] === indices[right * 3 + b]) return true;
		}
	}
	return false;
}

function orient2d(a, b, c) {
	return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointStrictlyInTriangle2d(pointValue, triangle, epsilon) {
	const signs = [
		orient2d(triangle[0], triangle[1], pointValue),
		orient2d(triangle[1], triangle[2], pointValue),
		orient2d(triangle[2], triangle[0], pointValue),
	];
	return signs.every((value) => value > epsilon) || signs.every((value) => value < -epsilon);
}

function coplanarTrianglesIntersect(left, right, normal, epsilon) {
	const absolute = normal.map(Math.abs);
	const drop = absolute[0] > absolute[1] && absolute[0] > absolute[2] ? 0 : absolute[1] > absolute[2] ? 1 : 2;
	const project = (value) => value.filter((_, axis) => axis !== drop);
	const a = left.map(project);
	const b = right.map(project);
	for (let leftEdge = 0; leftEdge < 3; leftEdge++) {
		for (let rightEdge = 0; rightEdge < 3; rightEdge++) {
			const leftA = a[leftEdge];
			const leftB = a[(leftEdge + 1) % 3];
			const rightA = b[rightEdge];
			const rightB = b[(rightEdge + 1) % 3];
			const values = [orient2d(leftA, leftB, rightA), orient2d(leftA, leftB, rightB), orient2d(rightA, rightB, leftA), orient2d(rightA, rightB, leftB)];
			if (((values[0] > epsilon && values[1] < -epsilon) || (values[0] < -epsilon && values[1] > epsilon))
				&& ((values[2] > epsilon && values[3] < -epsilon) || (values[2] < -epsilon && values[3] > epsilon))) return true;
		}
	}
	const centroid = (triangle) => [(triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3, (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3];
	return a.some((vertex) => pointStrictlyInTriangle2d(vertex, b, epsilon))
		|| b.some((vertex) => pointStrictlyInTriangle2d(vertex, a, epsilon))
		|| pointStrictlyInTriangle2d(centroid(a), b, epsilon)
		|| pointStrictlyInTriangle2d(centroid(b), a, epsilon);
}

function segmentIntersectsTriangle(start, end, triangle, epsilon) {
	const direction = sub(end, start);
	const edgeA = sub(triangle[1], triangle[0]);
	const edgeB = sub(triangle[2], triangle[0]);
	const h = cross(direction, edgeB);
	const determinant = dot(edgeA, h);
	if (Math.abs(determinant) <= epsilon) return false;
	const inverse = 1 / determinant;
	const s = sub(start, triangle[0]);
	const u = inverse * dot(s, h);
	if (u < -epsilon || u > 1 + epsilon) return false;
	const q = cross(s, edgeA);
	const v = inverse * dot(direction, q);
	if (v < -epsilon || u + v > 1 + epsilon) return false;
	const t = inverse * dot(edgeB, q);
	return t >= -epsilon && t <= 1 + epsilon;
}

function trianglesIntersect(left, right, epsilon) {
	const normalLeft = cross(sub(left[1], left[0]), sub(left[2], left[0]));
	const normalRight = cross(sub(right[1], right[0]), sub(right[2], right[0]));
	const lengthLeft = Math.hypot(...normalLeft);
	const lengthRight = Math.hypot(...normalRight);
	if (!(lengthLeft > epsilon && lengthRight > epsilon)) return { intersects: false, coplanar: false };
	const normalCross = Math.hypot(...cross(normalLeft, normalRight));
	const planeDistance = Math.abs(dot(normalLeft, sub(right[0], left[0]))) / lengthLeft;
	const coplanar = normalCross <= epsilon * lengthLeft * lengthRight && planeDistance <= epsilon;
	if (coplanar) return { intersects: coplanarTrianglesIntersect(left, right, normalLeft, epsilon), coplanar: true };
	for (let edge = 0; edge < 3; edge++) {
		if (segmentIntersectsTriangle(left[edge], left[(edge + 1) % 3], right, epsilon)
			|| segmentIntersectsTriangle(right[edge], right[(edge + 1) % 3], left, epsilon)) return { intersects: true, coplanar: false };
	}
	return { intersects: false, coplanar: false };
}

export function findNonAdjacentSelfIntersections(mesh, options = {}) {
	const { positions, indices } = mesh;
	const { bounds, centroids } = triangleBounds(positions, indices);
	let diagonalSquared = 0;
	for (let axis = 0; axis < 3; axis++) {
		let min = Infinity;
		let max = -Infinity;
		for (let triangle = 0; triangle < indices.length / 3; triangle++) {
			min = Math.min(min, bounds[triangle * 6 + axis]);
			max = Math.max(max, bounds[triangle * 6 + 3 + axis]);
		}
		diagonalSquared += (max - min) ** 2;
	}
	const epsilon = options.intersectionEpsilon ?? Math.max(1e-12, Math.sqrt(diagonalSquared) * 1e-9);
	const maximumRecordedPairs = options.maximumRecordedPairs ?? 64;
	const stopAfter = options.stopAfter ?? 1024;
	const { root, order } = buildTriangleBvh(bounds, centroids, options.leafSize ?? 8);
	const pairs = [];
	let count = 0;
	let coincidentCoveragePairs = 0;
	let truncated = false;
	const trianglePoints = (triangle) => [0, 1, 2].map((corner) => point(positions, indices[triangle * 3 + corner]));
	for (let triangle = 0; triangle < indices.length / 3 && !truncated; triangle++) {
		const stack = [root];
		while (stack.length > 0 && !truncated) {
			const node = stack.pop();
			if (!nodeOverlapsTriangle(node, bounds, triangle, epsilon)) continue;
			if (node.left) {
				stack.push(node.left, node.right);
				continue;
			}
			for (let cursor = node.start; cursor < node.end; cursor++) {
				const candidate = order[cursor];
				if (candidate <= triangle || sharesVertex(indices, triangle, candidate) || !boundsOverlap(bounds, triangle, candidate, epsilon)) continue;
				const result = trianglesIntersect(trianglePoints(triangle), trianglePoints(candidate), epsilon);
				if (!result.intersects) continue;
				count += 1;
				if (result.coplanar) coincidentCoveragePairs += 1;
				if (pairs.length < maximumRecordedPairs) pairs.push({ left: triangle, right: candidate, coplanar: result.coplanar });
				if (count >= stopAfter) truncated = true;
			}
		}
	}
	return { count, coincidentCoveragePairs, pairs, truncated, epsilon, broadPhase: 'deterministic-median-bvh-v1' };
}

function pointBoundsDistanceSquared(value, bounds) {
	let result = 0;
	for (let axis = 0; axis < 3; axis++) {
		const delta = value[axis] < bounds[axis]
			? bounds[axis] - value[axis]
			: value[axis] > bounds[3 + axis] ? value[axis] - bounds[3 + axis] : 0;
		result += delta * delta;
	}
	return result;
}

function pointSegmentDistanceSquared(value, a, b) {
	const edge = sub(b, a);
	const denominator = dot(edge, edge);
	const t = denominator > 0 ? Math.max(0, Math.min(1, dot(sub(value, a), edge) / denominator)) : 0;
	const closest = [a[0] + edge[0] * t, a[1] + edge[1] * t, a[2] + edge[2] * t];
	return dot(sub(value, closest), sub(value, closest));
}

function pointTriangleDistanceSquared(value, triangle) {
	const [a, b, c] = triangle;
	const edgeA = sub(b, a);
	const edgeB = sub(c, a);
	const normal = cross(edgeA, edgeB);
	const normalLengthSquared = dot(normal, normal);
	if (!(normalLengthSquared > 0)) {
		return Math.min(pointSegmentDistanceSquared(value, a, b), pointSegmentDistanceSquared(value, b, c), pointSegmentDistanceSquared(value, c, a));
	}
	const signedPlaneScale = dot(sub(value, a), normal) / normalLengthSquared;
	const projected = sub(value, normal.map((component) => component * signedPlaneScale));
	const projectedOffset = sub(projected, a);
	const d00 = dot(edgeA, edgeA);
	const d01 = dot(edgeA, edgeB);
	const d11 = dot(edgeB, edgeB);
	const d20 = dot(projectedOffset, edgeA);
	const d21 = dot(projectedOffset, edgeB);
	const denominator = d00 * d11 - d01 * d01;
	if (Math.abs(denominator) > Number.EPSILON) {
		const v = (d11 * d20 - d01 * d21) / denominator;
		const w = (d00 * d21 - d01 * d20) / denominator;
		const u = 1 - v - w;
		if (u >= 0 && v >= 0 && w >= 0) return signedPlaneScale * signedPlaneScale * normalLengthSquared;
	}
	return Math.min(pointSegmentDistanceSquared(value, a, b), pointSegmentDistanceSquared(value, b, c), pointSegmentDistanceSquared(value, c, a));
}

export function createMeshDistanceQuery(mesh, options = {}) {
	const { positions, indices } = mesh;
	const { bounds, centroids } = triangleBounds(positions, indices);
	const { root, order } = buildTriangleBvh(bounds, centroids, options.leafSize ?? 8);
	const trianglePoints = (triangle) => [0, 1, 2].map((corner) => point(positions, indices[triangle * 3 + corner]));
	return Object.freeze({
		broadPhase: 'deterministic-median-bvh-v1',
		distanceToPoint(value) {
			if (!Array.isArray(value) || value.length !== 3 || value.some((component) => !Number.isFinite(component))) throw new Error('distanceToPoint requires a finite vec3');
			let bestSquared = Infinity;
			const stack = [root];
			while (stack.length > 0) {
				const node = stack.pop();
				if (pointBoundsDistanceSquared(value, node.bounds) > bestSquared) continue;
				if (node.left) {
					const leftDistance = pointBoundsDistanceSquared(value, node.left.bounds);
					const rightDistance = pointBoundsDistanceSquared(value, node.right.bounds);
					if (leftDistance < rightDistance) stack.push(node.right, node.left);
					else stack.push(node.left, node.right);
					continue;
				}
				for (let cursor = node.start; cursor < node.end; cursor++) {
					bestSquared = Math.min(bestSquared, pointTriangleDistanceSquared(value, trianglePoints(order[cursor])));
				}
			}
			return Math.sqrt(bestSquared);
		},
	});
}

export function validateMeshTopology(mesh, options = {}) {
	const { positions, normals, indices } = mesh;
	if (!(positions instanceof Float32Array) || positions.length % 3 !== 0) throw new Error('mesh positions must be Float32Array vec3 data');
	if (!(normals instanceof Float32Array) || normals.length !== positions.length) throw new Error('mesh normals must match positions');
	if (!(indices instanceof Uint32Array) && !(indices instanceof Uint16Array)) throw new Error('mesh indices must be an integer typed array');
	if (indices.length % 3 !== 0) throw new Error('mesh index count must be divisible by 3');
	const vertexCount = positions.length / 3;
	const edgeOwners = new Map();
	const triangleKeys = new Set();
	const areas = [];
	const minimumAngles = [];
	let collapsedTriangles = 0;
	let duplicateTriangles = 0;
	let invalidIndices = 0;
	let inwardTriangles = 0;
	const signedOrientation = [];
	// The pure topology baseline rejects exact f32 collapse. A scale/projected-
	// error-relative minimum area is a separate acceptance gate and must be
	// supplied by the complete deformation sweep rather than hidden here as a
	// world-unit magic constant.
	const areaFloor = Number.isFinite(options.areaFloor) ? options.areaFloor : 0;
	const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

	for (let offset = 0; offset < indices.length; offset += 3) {
		const triangle = [indices[offset], indices[offset + 1], indices[offset + 2]];
		if (triangle.some((index) => index >= vertexCount)) {
			invalidIndices += 1;
			continue;
		}
		const canonical = [...triangle].sort((a, b) => a - b).join(':');
		if (triangleKeys.has(canonical)) duplicateTriangles += 1;
		triangleKeys.add(canonical);
		if (new Set(triangle).size !== 3) collapsedTriangles += 1;
		const a = point(positions, triangle[0]);
		const b = point(positions, triangle[1]);
		const c = point(positions, triangle[2]);
		const metrics = triangleAreaAndAngles(a, b, c);
		areas.push(metrics.area);
		minimumAngles.push(metrics.minAngleRadians);
		if (!(metrics.area > areaFloor)) collapsedTriangles += 1;
		if (typeof options.gradient === 'function') {
			const centroid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
			const orientation = dot(cross(sub(b, a), sub(c, a)), options.gradient(centroid));
			signedOrientation.push(orientation);
			if (orientation <= 0) inwardTriangles += 1;
		}
		for (const [left, right] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
			const key = edgeKey(left, right);
			edgeOwners.set(key, (edgeOwners.get(key) ?? 0) + 1);
		}
	}

	const boundaryEdges = [...edgeOwners.values()].filter((count) => count === 1).length;
	const nonManifoldEdges = [...edgeOwners.values()].filter((count) => count > 2).length;
	const finitePositions = everyFinite(positions);
	const finiteNormals = everyFinite(normals);
	const intersections = options.checkSelfIntersections === true && invalidIndices === 0
		? findNonAdjacentSelfIntersections(mesh, options)
		: { count: null, coincidentCoveragePairs: null, pairs: [], truncated: false, epsilon: null, broadPhase: null };
	const failures = [];
	if (!finitePositions) failures.push('non-finite positions');
	if (!finiteNormals) failures.push('non-finite normals');
	if (invalidIndices > 0) failures.push(`${invalidIndices} triangles reference invalid indices`);
	if (collapsedTriangles > 0) failures.push(`${collapsedTriangles} collapsed triangles`);
	if (duplicateTriangles > 0) failures.push(`${duplicateTriangles} duplicate triangles`);
	if (boundaryEdges > 0) failures.push(`${boundaryEdges} boundary edges`);
	if (nonManifoldEdges > 0) failures.push(`${nonManifoldEdges} non-manifold edges`);
	if (inwardTriangles > 0) failures.push(`${inwardTriangles} inward triangles`);
	if ((intersections.count ?? 0) > 0) failures.push(`${intersections.count}${intersections.truncated ? '+' : ''} non-adjacent self-intersections`);

	return {
		status: failures.length === 0 ? 'accepted-topology-baseline' : 'rejected',
		failures,
		vertexCount,
		triangleCount: indices.length / 3,
		finitePositions,
		finiteNormals,
		invalidIndices,
		collapsedTriangles,
		duplicateTriangles,
		boundaryEdges,
		nonManifoldEdges,
		inwardTriangles,
		duplicateCoincidentCoverage: duplicateTriangles + (intersections.coincidentCoveragePairs ?? 0),
		nonAdjacentSelfIntersections: intersections,
		area: {
			min: minimum(areas),
			p05: quantile(areas, 0.05),
			median: quantile(areas, 0.5),
		},
		minimumAngleRadians: {
			min: minimum(minimumAngles),
			p05: quantile(minimumAngles, 0.05),
		},
		signedOrientation: {
			min: minimum(signedOrientation),
			p05: quantile(signedOrientation, 0.05),
			median: quantile(signedOrientation, 0.5),
		},
		limitations: options.checkSelfIntersections === true ? [] : [
			'Non-adjacent self-intersection and duplicate-coverage checks were not requested for this topology baseline.',
		],
	};
}
