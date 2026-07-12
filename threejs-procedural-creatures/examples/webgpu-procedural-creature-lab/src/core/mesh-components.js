function triangleVertices(indices, triangle) {
	const offset = triangle * 3;
	return [indices[offset], indices[offset + 1], indices[offset + 2]];
}

function componentDistanceSquared(component, positions, point) {
	let best = Number.POSITIVE_INFINITY;
	for (const vertex of component.vertices) {
		const offset = vertex * 3;
		const dx = positions[offset] - point[0];
		const dy = positions[offset + 1] - point[1];
		const dz = positions[offset + 2] - point[2];
		best = Math.min(best, dx * dx + dy * dy + dz * dz);
	}
	return best;
}

export function findMeshComponents(mesh) {
	const { indices } = mesh;
	if (!(indices instanceof Uint32Array) && !(indices instanceof Uint16Array)) {
		throw new Error('findMeshComponents requires an integer index array');
	}
	if (indices.length % 3 !== 0) throw new Error('mesh index count must be divisible by 3');
	const triangleCount = indices.length / 3;
	const byEdge = new Map();
	const neighbors = Array.from({ length: triangleCount }, () => new Set());
	const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

	for (let triangle = 0; triangle < triangleCount; triangle++) {
		const vertices = triangleVertices(indices, triangle);
		for (const [a, b] of [[vertices[0], vertices[1]], [vertices[1], vertices[2]], [vertices[2], vertices[0]]]) {
			const key = edgeKey(a, b);
			const owners = byEdge.get(key) ?? [];
			for (const owner of owners) {
				neighbors[triangle].add(owner);
				neighbors[owner].add(triangle);
			}
			owners.push(triangle);
			byEdge.set(key, owners);
		}
	}

	const seen = new Uint8Array(triangleCount);
	const components = [];
	for (let start = 0; start < triangleCount; start++) {
		if (seen[start]) continue;
		const queue = [start];
		seen[start] = 1;
		const triangles = [];
		const vertices = new Set();
		while (queue.length > 0) {
			const triangle = queue.pop();
			triangles.push(triangle);
			for (const vertex of triangleVertices(indices, triangle)) vertices.add(vertex);
			for (const neighbor of neighbors[triangle]) {
				if (seen[neighbor]) continue;
				seen[neighbor] = 1;
				queue.push(neighbor);
			}
		}
		components.push({
			triangles: triangles.sort((a, b) => a - b),
			vertices: [...vertices].sort((a, b) => a - b),
		});
	}
	return components.sort((a, b) => b.triangles.length - a.triangles.length || a.triangles[0] - b.triangles[0]);
}

export function selectComponentByHandle(mesh, components, handle) {
	if (!Array.isArray(handle) || handle.length !== 3 || handle.some((entry) => !Number.isFinite(entry))) {
		throw new Error('component handle must be a finite vec3');
	}
	if (components.length === 0) throw new Error('cannot select a component from an empty mesh');
	return components
		.map((component, index) => ({ index, distanceSquared: componentDistanceSquared(component, mesh.positions, handle) }))
		.sort((a, b) => a.distanceSquared - b.distanceSquared || a.index - b.index)[0];
}

export function isolateMeshComponent(mesh, component) {
	const oldToNew = new Map();
	const positions = [];
	const normals = [];
	for (const oldIndex of component.vertices) {
		oldToNew.set(oldIndex, oldToNew.size);
		positions.push(...mesh.positions.subarray(oldIndex * 3, oldIndex * 3 + 3));
		normals.push(...mesh.normals.subarray(oldIndex * 3, oldIndex * 3 + 3));
	}
	const indices = [];
	for (const triangle of component.triangles) {
		for (const oldIndex of triangleVertices(mesh.indices, triangle)) indices.push(oldToNew.get(oldIndex));
	}
	return {
		...mesh,
		positions: new Float32Array(positions),
		normals: new Float32Array(normals),
		indices: new Uint32Array(indices),
	};
}
