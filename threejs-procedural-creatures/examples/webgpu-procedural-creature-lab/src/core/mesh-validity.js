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
			if (dot(cross(sub(b, a), sub(c, a)), options.gradient(centroid)) <= 0) inwardTriangles += 1;
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
	const failures = [];
	if (!finitePositions) failures.push('non-finite positions');
	if (!finiteNormals) failures.push('non-finite normals');
	if (invalidIndices > 0) failures.push(`${invalidIndices} triangles reference invalid indices`);
	if (collapsedTriangles > 0) failures.push(`${collapsedTriangles} collapsed triangles`);
	if (duplicateTriangles > 0) failures.push(`${duplicateTriangles} duplicate triangles`);
	if (boundaryEdges > 0) failures.push(`${boundaryEdges} boundary edges`);
	if (nonManifoldEdges > 0) failures.push(`${nonManifoldEdges} non-manifold edges`);
	if (inwardTriangles > 0) failures.push(`${inwardTriangles} inward triangles`);

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
		area: {
			min: minimum(areas),
			p05: quantile(areas, 0.05),
			median: quantile(areas, 0.5),
		},
		minimumAngleRadians: {
			min: minimum(minimumAngles),
			p05: quantile(minimumAngles, 0.05),
		},
		limitations: [
			'Non-adjacent self-intersection and duplicate-coverage BVH gates are not part of this topology baseline.',
			'Acceptance promotion remains forbidden until the complete mesh-validity sweep is present.',
		],
	};
}
