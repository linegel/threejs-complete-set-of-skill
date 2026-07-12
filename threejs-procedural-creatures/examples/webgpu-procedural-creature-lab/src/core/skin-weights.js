import { evaluateField } from './field.js';

export const SKIN_WEIGHT_VERSION = 'creature-geodesic-skin-weights-v1';
export const MAX_SKIN_INFLUENCES = 4;

function point(positions, index) {
	const offset = index * 3;
	return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

function distance(a, b) {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function midpoint(slot) {
	return [(slot.a[0] + slot.b[0]) * 0.5, (slot.a[1] + slot.b[1]) * 0.5, (slot.a[2] + slot.b[2]) * 0.5];
}

class MinHeap {
	constructor() {
		this.items = [];
	}
	push(item) {
		let index = this.items.length;
		this.items.push(item);
		while (index > 0) {
			const parent = Math.floor((index - 1) / 2);
			if (this.items[parent].distance <= item.distance) break;
			this.items[index] = this.items[parent];
			index = parent;
		}
		this.items[index] = item;
	}
	pop() {
		if (this.items.length === 0) return null;
		const root = this.items[0];
		const tail = this.items.pop();
		if (this.items.length === 0) return root;
		let index = 0;
		while (true) {
			const left = index * 2 + 1;
			const right = left + 1;
			if (left >= this.items.length) break;
			let child = left;
			if (right < this.items.length && this.items[right].distance < this.items[left].distance) child = right;
			if (this.items[child].distance >= tail.distance) break;
			this.items[index] = this.items[child];
			index = child;
		}
		this.items[index] = tail;
		return root;
	}
	get size() {
		return this.items.length;
	}
}

function buildAdjacency(mesh) {
	const vertexCount = mesh.positions.length / 3;
	const maps = Array.from({ length: vertexCount }, () => new Map());
	for (let offset = 0; offset < mesh.indices.length; offset += 3) {
		const triangle = [mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2]];
		for (const [a, b] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
			const length = distance(point(mesh.positions, a), point(mesh.positions, b));
			if (!(length > 0)) continue;
			maps[a].set(b, Math.min(length, maps[a].get(b) ?? Number.POSITIVE_INFINITY));
			maps[b].set(a, Math.min(length, maps[b].get(a) ?? Number.POSITIVE_INFINITY));
		}
	}
	return maps.map((neighbors) => [...neighbors].map(([to, length]) => ({ to, length })).sort((a, b) => a.to - b.to));
}

function ancestorSet(semanticParts, partIndex) {
	const ancestors = new Set();
	let current = partIndex;
	while (current !== null && current !== undefined && !ancestors.has(current)) {
		ancestors.add(current);
		current = semanticParts[current]?.parentIndex ?? null;
	}
	return ancestors;
}

function relatedParts(ancestorSets, left, right) {
	return left === right || ancestorSets[left]?.has(right) || ancestorSets[right]?.has(left);
}

function dijkstra(adjacency, seeds, canVisit) {
	const distances = new Float64Array(adjacency.length);
	distances.fill(Number.POSITIVE_INFINITY);
	const heap = new MinHeap();
	for (const seed of seeds) {
		distances[seed] = 0;
		heap.push({ vertex: seed, distance: 0 });
	}
	while (heap.size > 0) {
		const current = heap.pop();
		if (current.distance !== distances[current.vertex]) continue;
		for (const edge of adjacency[current.vertex]) {
			if (!canVisit(edge.to)) continue;
			const candidate = current.distance + edge.length;
			if (candidate >= distances[edge.to]) continue;
			distances[edge.to] = candidate;
			heap.push({ vertex: edge.to, distance: candidate });
		}
	}
	return distances;
}

function fallbackSeed(mesh, slot) {
	const handle = midpoint(slot);
	let best = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
		const candidate = distance(point(mesh.positions, vertex), handle);
		if (candidate < bestDistance) {
			bestDistance = candidate;
			best = vertex;
		}
	}
	return best;
}

export function generateGeodesicSkinWeights(mesh, compiled, options = {}) {
	if (!mesh?.positions || !mesh?.indices) throw new Error('generateGeodesicSkinWeights requires an indexed reference mesh');
	if (!compiled?.slots?.length || !compiled.semanticParts?.length) throw new Error('generateGeodesicSkinWeights requires semantic compileSpec output');
	const vertexCount = mesh.positions.length / 3;
	const adjacency = buildAdjacency(mesh);
	const ownerSlots = new Uint16Array(vertexCount);
	const ownerParts = new Uint16Array(vertexCount);
	for (let vertex = 0; vertex < vertexCount; vertex++) {
		const position = point(mesh.positions, vertex);
		const owner = evaluateField(compiled.slots, position, { blendDag: compiled.blendDag }).owner;
		ownerSlots[vertex] = Math.max(0, owner);
		ownerParts[vertex] = compiled.slots[Math.max(0, owner)]?.semanticPartIndex ?? 0;
	}
	const ancestorSets = compiled.semanticParts.map((part) => ancestorSet(compiled.semanticParts, part.index));
	const distancesBySlot = [];
	for (let slotIndex = 0; slotIndex < compiled.slots.length; slotIndex++) {
		const slot = compiled.slots[slotIndex];
		const seeds = [];
		for (let vertex = 0; vertex < vertexCount; vertex++) if (ownerSlots[vertex] === slotIndex) seeds.push(vertex);
		if (seeds.length === 0) seeds.push(fallbackSeed(mesh, slot));
		distancesBySlot.push(dijkstra(
			adjacency,
			seeds,
			(vertex) => relatedParts(ancestorSets, slot.semanticPartIndex, ownerParts[vertex]),
		));
	}

	const sigma = Number.isFinite(options.sigma) && options.sigma > 0
		? options.sigma
		: Math.max(compiled.maxRadius * 1.5, 1e-4);
	const skinIndices = new Uint16Array(vertexCount * MAX_SKIN_INFLUENCES);
	const skinWeights = new Float32Array(vertexCount * MAX_SKIN_INFLUENCES);
	let maximumPartitionError = 0;
	let maximumBarrierLeakage = 0;
	let fallbackVertices = 0;
	for (let vertex = 0; vertex < vertexCount; vertex++) {
		const ranked = compiled.slots
			.map((slot, slotIndex) => ({ slotIndex, distance: distancesBySlot[slotIndex][vertex] }))
			.filter((entry) => Number.isFinite(entry.distance))
			.sort((a, b) => a.distance - b.distance || a.slotIndex - b.slotIndex)
			.slice(0, MAX_SKIN_INFLUENCES);
		if (ranked.length === 0) {
			ranked.push({ slotIndex: ownerSlots[vertex], distance: 0 });
			fallbackVertices += 1;
		}
		let sum = 0;
		for (const entry of ranked) {
			entry.weight = Math.exp(-entry.distance / sigma);
			sum += entry.weight;
		}
		for (let influence = 0; influence < MAX_SKIN_INFLUENCES; influence++) {
			const entry = ranked[influence] ?? ranked[0];
			const weight = influence < ranked.length ? entry.weight / sum : 0;
			const offset = vertex * MAX_SKIN_INFLUENCES + influence;
			skinIndices[offset] = entry.slotIndex;
			skinWeights[offset] = weight;
			const influencePart = compiled.slots[entry.slotIndex].semanticPartIndex;
			if (!relatedParts(ancestorSets, ownerParts[vertex], influencePart)) maximumBarrierLeakage = Math.max(maximumBarrierLeakage, weight);
		}
		let f32Sum = 0;
		for (let influence = 0; influence < MAX_SKIN_INFLUENCES; influence++) f32Sum += skinWeights[vertex * MAX_SKIN_INFLUENCES + influence];
		maximumPartitionError = Math.max(maximumPartitionError, Math.abs(f32Sum - 1));
	}

	const certification = {
		status: maximumPartitionError <= 2e-5 && maximumBarrierLeakage <= 2e-5 && fallbackVertices === 0 ? 'accepted-weight-baseline' : 'rejected',
		maximumInfluences: MAX_SKIN_INFLUENCES,
		maximumPartitionError,
		maximumBarrierLeakage,
		fallbackVertices,
		sigma,
		barrierPolicy: 'same semantic part or ancestor/descendant chain only',
	};
	return {
		version: SKIN_WEIGHT_VERSION,
		skinIndices,
		skinWeights,
		ownerSlots,
		ownerParts,
		certification,
	};
}
