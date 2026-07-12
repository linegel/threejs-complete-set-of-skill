export const CORRECTION_VERSION = 'creature-bounded-correction-v2';

function dot(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function distance(a, b) {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function residual(field) {
	const gradientLength = Math.hypot(...field.grad);
	return Math.abs(field.d) / Math.max(gradientLength, 1e-8);
}

export function correctPointBounded(fieldEval, skinnedPosition, options = {}) {
	if (typeof fieldEval !== 'function') throw new Error('correctPointBounded requires a field evaluator');
	if (!Array.isArray(skinnedPosition) || skinnedPosition.length !== 3 || skinnedPosition.some((value) => !Number.isFinite(value))) throw new Error('correctPointBounded requires a finite skinned vec3');
	const maximumTrials = Math.max(0, Math.floor(options.maximumTrials ?? 2));
	const maximumBacktracks = Math.max(0, Math.floor(options.maximumBacktracks ?? 4));
	const trustRadius = Number(options.trustRadius);
	if (!(trustRadius > 0 && Number.isFinite(trustRadius))) throw new Error('correction trustRadius must be finite and > 0');
	const gradientFloorSquared = options.gradientFloorSquared ?? 1e-8;
	const residualEpsilon = options.residualEpsilon ?? 1e-7;
	const original = skinnedPosition.slice();
	let position = original.slice();
	let currentField = fieldEval(position);
	let currentResidual = residual(currentField);
	const initialResidual = currentResidual;
	const acceptedMoves = [];
	let backtracks = 0;
	for (let trial = 0; trial < maximumTrials; trial++) {
		if (currentResidual <= residualEpsilon) break;
		const gradientSquared = dot(currentField.grad, currentField.grad);
		if (!(gradientSquared > gradientFloorSquared) || !Number.isFinite(currentField.d)) {
			return { position: original, applied: false, preservedSkinOnly: true, reason: 'degenerate-gradient', initialResidual, finalResidual: initialResidual, trials: trial, backtracks, acceptedMoves: [] };
		}
		const newton = currentField.grad.map((component) => component * currentField.d / gradientSquared);
		const newtonLength = Math.hypot(...newton);
		const remainingTrust = Math.max(0, trustRadius - distance(position, original));
		if (!(remainingTrust > 0)) break;
		const clampScale = newtonLength > remainingTrust ? remainingTrust / newtonLength : 1;
		let stepScale = clampScale;
		let accepted = null;
		for (let attempt = 0; attempt <= maximumBacktracks; attempt++) {
			const candidate = position.map((component, axis) => component - newton[axis] * stepScale);
			const candidateField = fieldEval(candidate);
			const candidateResidual = residual(candidateField);
			if (Number.isFinite(candidateResidual) && candidateResidual < currentResidual) {
				accepted = { candidate, candidateField, candidateResidual, move: distance(candidate, position) };
				break;
			}
			stepScale *= 0.5;
			backtracks += 1;
		}
		if (!accepted) {
			return { position: original, applied: false, preservedSkinOnly: true, reason: 'no-residual-decrease', initialResidual, finalResidual: initialResidual, trials: trial + 1, backtracks, acceptedMoves: [] };
		}
		position = accepted.candidate;
		currentField = accepted.candidateField;
		currentResidual = accepted.candidateResidual;
		acceptedMoves.push(accepted.move);
	}
	return {
		position,
		applied: acceptedMoves.length > 0,
		preservedSkinOnly: false,
		reason: acceptedMoves.length > 0 ? 'residual-decreased' : 'already-within-trust-policy',
		initialResidual,
		finalResidual: currentResidual,
		trials: acceptedMoves.length,
		backtracks,
		acceptedMoves,
		moveDistance: distance(position, original),
		trustRadius,
	};
}

function adjacency(mesh) {
	const neighbors = Array.from({ length: mesh.positions.length / 3 }, () => new Set());
	for (let offset = 0; offset < mesh.indices.length; offset += 3) {
		const triangle = [mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2]];
		for (const [left, right] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
			neighbors[left].add(right);
			neighbors[right].add(left);
		}
	}
	return neighbors;
}

export function buildCorrectionRegion(mesh, vertexWorstDistance, options = {}) {
	if (!(vertexWorstDistance instanceof Float32Array) || vertexWorstDistance.length !== mesh.positions.length / 3) throw new Error('buildCorrectionRegion requires one Float32 worst-distance value per vertex');
	const threshold = Number(options.threshold);
	if (!(threshold >= 0 && Number.isFinite(threshold))) throw new Error('correction threshold must be finite and >= 0');
	const neighbors = adjacency(mesh);
	const direct = new Uint8Array(vertexWorstDistance.length);
	for (let vertex = 0; vertex < direct.length; vertex++) if (vertexWorstDistance[vertex] > threshold) direct[vertex] = 1;
	const directCount = direct.reduce((sum, value) => sum + value, 0);
	const featherRings = Math.max(0, Math.floor(options.featherRings ?? 0));
	const growthRings = featherRings > 0 ? featherRings : 1;
	const ringDistance = new Int32Array(direct.length);
	ringDistance.fill(-1);
	let frontier = [];
	for (let vertex = 0; vertex < direct.length; vertex++) {
		if (direct[vertex] === 0) continue;
		ringDistance[vertex] = 0;
		frontier.push(vertex);
	}
	for (let ring = 1; ring <= growthRings && frontier.length > 0; ring++) {
		const next = [];
		for (const vertex of frontier) {
			for (const neighbor of neighbors[vertex]) {
				if (ringDistance[neighbor] >= 0) continue;
				ringDistance[neighbor] = ring;
				next.push(neighbor);
			}
		}
		frontier = next;
	}
	const grown = new Uint8Array(direct.length);
	const weights = new Float32Array(direct.length);
	for (let vertex = 0; vertex < direct.length; vertex++) {
		const ring = ringDistance[vertex];
		if (ring < 0) continue;
		grown[vertex] = 1;
		const cosine = featherRings > 0 ? Math.cos(ring / (featherRings + 1) * Math.PI * 0.5) : 1;
		weights[vertex] = cosine * cosine;
	}
	const minimumIslandVertices = Math.max(1, Math.floor(options.minimumIslandVertices ?? 3));
	const visited = new Uint8Array(grown.length);
	let removedIslandVertices = 0;
	for (let vertex = 0; vertex < grown.length; vertex++) {
		if (grown[vertex] === 0 || visited[vertex] !== 0) continue;
		const component = [];
		const stack = [vertex];
		visited[vertex] = 1;
		while (stack.length > 0) {
			const current = stack.pop();
			component.push(current);
			for (const neighbor of neighbors[current]) {
				if (grown[neighbor] !== 0 && visited[neighbor] === 0) { visited[neighbor] = 1; stack.push(neighbor); }
			}
		}
		if (component.length < minimumIslandVertices) {
			for (const member of component) { grown[member] = 0; weights[member] = 0; }
			removedIslandVertices += component.length;
		}
	}
	const correctionVertices = [];
	for (let vertex = 0; vertex < grown.length; vertex++) if (grown[vertex] !== 0) correctionVertices.push(vertex);
	const fraction = correctionVertices.length / grown.length;
	const maximumFraction = options.maximumFraction ?? 0.25;
	return {
		version: CORRECTION_VERSION,
		status: fraction <= maximumFraction ? 'accepted-correction-region' : 'rejected',
		mask: grown,
		weights,
		correctionVertices: new Uint32Array(correctionVertices),
		threshold,
		directCount,
		grownCount: correctionVertices.length,
		fraction,
		maximumFraction,
		removedIslandVertices,
		growthPolicy: featherRings > 0 ? `${featherRings} geodesic mesh rings with cosine-squared feather weights` : 'one binary mesh ring',
		featherRings,
	};
}

export function applyCorrectionToSurface(surface, correctionMask, fieldEval, options = {}) {
	if (!(correctionMask instanceof Uint8Array) && !(correctionMask instanceof Float32Array)) throw new Error('applyCorrectionToSurface weights must be Uint8Array or Float32Array');
	if (correctionMask.length !== surface.positions.length / 3) throw new Error('applyCorrectionToSurface weights must match surface vertices');
	const positions = surface.positions.slice();
	const normals = surface.normals.slice();
	let attemptedVertices = 0;
	let correctedVertices = 0;
	let preservedVertices = 0;
	let backtracks = 0;
	let maximumMoveDistance = 0;
	let maximumInitialResidual = 0;
	let maximumFinalResidual = 0;
	for (let vertex = 0; vertex < correctionMask.length; vertex++) {
		const correctionWeight = correctionMask[vertex];
		if (!(correctionWeight > 0 && correctionWeight <= 1)) {
			if (correctionWeight !== 0) throw new Error(`correction weight ${correctionWeight} at vertex ${vertex} is outside [0, 1]`);
			continue;
		}
		attemptedVertices += 1;
		const original = [...surface.positions.subarray(vertex * 3, vertex * 3 + 3)];
		const result = correctPointBounded(fieldEval, original, options);
		backtracks += result.backtracks;
		maximumInitialResidual = Math.max(maximumInitialResidual, result.initialResidual);
		if (!result.applied) {
			preservedVertices += 1;
			maximumFinalResidual = Math.max(maximumFinalResidual, result.finalResidual);
			continue;
		}
		correctedVertices += 1;
		const weightedPosition = original.map((component, axis) => component + (result.position[axis] - component) * correctionWeight);
		positions.set(weightedPosition, vertex * 3);
		maximumMoveDistance = Math.max(maximumMoveDistance, distance(weightedPosition, original));
		const weightedField = fieldEval(weightedPosition);
		maximumFinalResidual = Math.max(maximumFinalResidual, residual(weightedField));
		const gradient = weightedField.grad;
		const gradientLength = Math.hypot(...gradient);
		if (gradientLength > 1e-8) normals.set(gradient.map((component) => component / gradientLength), vertex * 3);
	}
	return {
		positions,
		normals,
		indices: surface.indices,
		telemetry: {
			attemptedVertices,
			correctedVertices,
			preservedVertices,
			backtracks,
			maximumMoveDistance,
			maximumInitialResidual,
			maximumFinalResidual,
		},
	};
}
