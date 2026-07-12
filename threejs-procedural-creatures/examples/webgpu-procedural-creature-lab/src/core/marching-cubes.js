const CUBE_CORNERS = Object.freeze([
	[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
	[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
]);

// A globally consistent Kuhn subdivision resolves face/interior ambiguity by
// construction. The extractor is deliberately identified as a marching-cubes
// baseline with tetrahedral ambiguity resolution, rather than claiming MC33.
// Promotion to the canonical asset contract remains gated on the topology and
// bidirectional-error sweeps in surface-gates.mjs.
const KUHN_TETRAHEDRA = Object.freeze([
	[0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6],
	[0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6],
]);

export const MARCHING_CUBES_ALGORITHM = 'marching-cubes-kuhn-ambiguity-v1';
export const MARCHING_CUBES_AMBIGUITY_POLICY = 'globally-consistent-kuhn-tetrahedral-subdivision';

function finiteVec3(value, name) {
	if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => !Number.isFinite(entry))) {
		throw new Error(`${name} must be a finite vec3`);
	}
	return value.map(Number);
}

function clamp01(value) {
	return Math.max(0, Math.min(1, value));
}

function add(a, b) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(value, scalar) {
	return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
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

function normalize(value, fallback = [0, 1, 0]) {
	const length = Math.hypot(value[0], value[1], value[2]);
	return length > 1e-12 ? scale(value, 1 / length) : fallback.slice();
}

function edgeKey(a, b) {
	return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}

function interpolateEdge(a, b, iso) {
	const denominator = b.value - a.value;
	const t = Math.abs(denominator) <= 1e-20 ? 0.5 : clamp01((iso - a.value) / denominator);
	return { position: add(a.position, scale(sub(b.position, a.position), t)), t };
}

function tetraTriangles(vertices, iso) {
	const inside = [];
	const outside = [];
	for (const vertex of vertices) (vertex.value < iso ? inside : outside).push(vertex);
	if (inside.length === 0 || inside.length === 4) return [];

	if (inside.length === 1 || inside.length === 3) {
		const minority = inside.length === 1 ? inside[0] : outside[0];
		const majority = inside.length === 1 ? outside : inside;
		const triangle = majority.map((vertex) => [minority, vertex]);
		return inside.length === 1 ? [triangle] : [[triangle[0], triangle[2], triangle[1]]];
	}

	const [a, b] = inside;
	const [c, d] = outside;
	const ac = [a, c];
	const ad = [a, d];
	const bc = [b, c];
	const bd = [b, d];
	return [
		[ac, ad, bd],
		[ac, bd, bc],
	];
}

function orientTriangle(indices, positions, gradient) {
	const point = (index) => positions[index];
	const a = point(indices[0]);
	const b = point(indices[1]);
	const c = point(indices[2]);
	const centroid = scale(add(add(a, b), c), 1 / 3);
	const normal = cross(sub(b, a), sub(c, a));
	const outward = gradient(centroid);
	if (dot(normal, outward) < 0) [indices[1], indices[2]] = [indices[2], indices[1]];
	return indices;
}

function weldExactFloat32Vertices(positionVectors, normalVectors, sourceIndices) {
	const positions = [];
	const normalSums = [];
	const remap = new Uint32Array(positionVectors.length);
	const byPosition = new Map();
	for (let index = 0; index < positionVectors.length; index++) {
		const value = positionVectors[index];
		const f32 = [Math.fround(value[0]), Math.fround(value[1]), Math.fround(value[2])];
		const key = `${f32[0]},${f32[1]},${f32[2]}`;
		let target = byPosition.get(key);
		if (target === undefined) {
			target = positions.length;
			byPosition.set(key, target);
			positions.push(f32);
			normalSums.push([0, 0, 0]);
		}
		remap[index] = target;
		normalSums[target] = add(normalSums[target], normalVectors[index]);
	}
	const indices = [];
	let collapsedByWeld = 0;
	for (let offset = 0; offset < sourceIndices.length; offset += 3) {
		const triangle = [remap[sourceIndices[offset]], remap[sourceIndices[offset + 1]], remap[sourceIndices[offset + 2]]];
		if (new Set(triangle).size !== 3) {
			collapsedByWeld += 1;
			continue;
		}
		indices.push(...triangle);
	}
	return {
		positions: new Float32Array(positions.flat()),
		normals: new Float32Array(normalSums.map((value) => normalize(value)).flat()),
		indices: new Uint32Array(indices),
		weldedVertices: positionVectors.length - positions.length,
		collapsedByWeld,
	};
}

export function extractMarchingCubes(options = {}) {
	if (typeof options.sample !== 'function') throw new Error('extractMarchingCubes requires sample(point)');
	if (typeof options.gradient !== 'function') throw new Error('extractMarchingCubes requires gradient(point)');
	const min = finiteVec3(options.bounds?.min, 'bounds.min');
	const max = finiteVec3(options.bounds?.max, 'bounds.max');
	const requestedCellSize = Number(options.cellSize);
	if (!(requestedCellSize > 0)) throw new Error('cellSize must be finite and > 0');
	if (max.some((value, axis) => value <= min[axis])) throw new Error('bounds.max must exceed bounds.min on every axis');
	const iso = Number.isFinite(options.iso) ? options.iso : 0;
	const cells = max.map((value, axis) => Math.max(1, Math.ceil((value - min[axis]) / requestedCellSize)));
	const gridPoints = cells.map((count) => count + 1);
	const step = max.map((value, axis) => (value - min[axis]) / cells[axis]);
	const maxSamples = Math.max(8, Math.floor(options.maxSamples ?? 16_777_216));
	const latticeId = (x, y, z) => x + gridPoints[0] * (y + gridPoints[1] * z);
	const cellId = (x, y, z) => x + cells[0] * (y + cells[1] * z);
	const decodeCellId = (id) => {
		const plane = cells[0] * cells[1];
		const z = Math.floor(id / plane);
		const remainder = id - z * plane;
		const y = Math.floor(remainder / cells[0]);
		return [remainder - y * cells[0], y, z];
	};
	const latticePosition = (x, y, z) => [
		min[0] + x * step[0],
		min[1] + y * step[1],
		min[2] + z * step[2],
	];

	const activeCells = new Set();
	if (Array.isArray(options.activeRegions) && options.activeRegions.length > 0) {
		for (const region of options.activeRegions) {
			const regionMin = finiteVec3(region.min, 'activeRegions[].min');
			const regionMax = finiteVec3(region.max, 'activeRegions[].max');
			const begin = regionMin.map((value, axis) => Math.max(0, Math.floor((value - min[axis]) / step[axis]) - 1));
			const end = regionMax.map((value, axis) => Math.min(cells[axis] - 1, Math.floor((value - min[axis]) / step[axis]) + 1));
			for (let z = begin[2]; z <= end[2]; z++) {
				for (let y = begin[1]; y <= end[1]; y++) {
					for (let x = begin[0]; x <= end[0]; x++) activeCells.add(cellId(x, y, z));
				}
			}
		}
	} else {
		for (let z = 0; z < cells[2]; z++) {
			for (let y = 0; y < cells[1]; y++) {
				for (let x = 0; x < cells[0]; x++) activeCells.add(cellId(x, y, z));
			}
		}
	}
	const values = new Map();
	function sampleLattice(x, y, z) {
		const id = latticeId(x, y, z);
		if (values.has(id)) return values.get(id);
		if (values.size >= maxSamples) throw new Error(`reference extraction exceeds maximum ${maxSamples} sampled lattice points`);
		const value = Number(options.sample(latticePosition(x, y, z)));
		if (!Number.isFinite(value)) throw new Error(`field sample is non-finite at lattice ${x},${y},${z}`);
		values.set(id, value);
		return value;
	}

	const positions = [];
	const normals = [];
	const indices = [];
	const edgeVertices = new Map();
	const triangleKeys = new Set();
	let intersectedCells = 0;
	let rejectedDegenerateTriangles = 0;

	function vertexForEdge(edge) {
		const intersection = interpolateEdge(edge[0], edge[1], iso);
		// When the iso-surface lands exactly on a lattice vertex, every incident
		// edge must reuse one vertex. Keying by the edge in this case creates
		// coincident vertices and zero-area triangles at analytically exact roots.
		const key = intersection.t <= 1e-10
			? `v:${edge[0].id}`
			: intersection.t >= 1 - 1e-10
				? `v:${edge[1].id}`
				: edgeKey(edge[0], edge[1]);
		const cached = edgeVertices.get(key);
		if (cached !== undefined) return cached;
		const position = intersection.position;
		const normal = normalize(options.gradient(position));
		if (position.some((entry) => !Number.isFinite(entry)) || normal.some((entry) => !Number.isFinite(entry))) {
			throw new Error(`non-finite extracted vertex on edge ${key}`);
		}
		const index = positions.length;
		positions.push(position);
		normals.push(normal);
		edgeVertices.set(key, index);
		return index;
	}

	for (const activeCell of [...activeCells].sort((a, b) => a - b)) {
				const [x, y, z] = decodeCellId(activeCell);
				const corners = CUBE_CORNERS.map(([dx, dy, dz]) => {
					const gx = x + dx;
					const gy = y + dy;
					const gz = z + dz;
					const id = latticeId(gx, gy, gz);
					return { id, value: sampleLattice(gx, gy, gz), position: latticePosition(gx, gy, gz) };
				});
				const insideCount = corners.reduce((count, corner) => count + (corner.value < iso ? 1 : 0), 0);
				if (insideCount === 0 || insideCount === 8) continue;
				intersectedCells += 1;
				for (const tetrahedron of KUHN_TETRAHEDRA) {
					for (const triangleEdges of tetraTriangles(tetrahedron.map((corner) => corners[corner]), iso)) {
						const triangle = triangleEdges.map(vertexForEdge);
						if (new Set(triangle).size !== 3) {
							rejectedDegenerateTriangles += 1;
							continue;
						}
						orientTriangle(triangle, positions, options.gradient);
						const canonical = [...triangle].sort((a, b) => a - b).join(':');
						if (triangleKeys.has(canonical)) continue;
						triangleKeys.add(canonical);
						indices.push(...triangle);
					}
				}
	}

	const welded = weldExactFloat32Vertices(positions, normals, indices);
	return {
		algorithm: MARCHING_CUBES_ALGORITHM,
		ambiguityPolicy: MARCHING_CUBES_AMBIGUITY_POLICY,
		positions: welded.positions,
		normals: welded.normals,
		indices: welded.indices,
		bounds: { min, max },
		grid: {
			cells,
			points: gridPoints,
			step,
			requestedCellSize,
				sampleCount: values.size,
				activeCellCount: activeCells.size,
			intersectedCells,
		},
		rejectedDegenerateTriangles,
		weldPolicy: 'exact-equal-f32-position',
		weldedVertices: welded.weldedVertices,
		collapsedByWeld: welded.collapsedByWeld,
	};
}
