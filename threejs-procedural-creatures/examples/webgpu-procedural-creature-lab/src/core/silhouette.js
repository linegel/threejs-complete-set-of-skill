import { evaluateField } from './field.js';

export const SILHOUETTE_VERSION = 'creature-orthographic-silhouette-v1';

function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(value, scalar) { return [value[0] * scalar, value[1] * scalar, value[2] * scalar]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(value) {
	const length = Math.hypot(...value);
	if (!(length > 1e-10)) throw new Error('silhouette view direction must be non-zero');
	return scale(value, 1 / length);
}

function posedBounds(slots, margin, mesh) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const slot of slots) {
		const support = Math.max(slot.ra, slot.rb) + Math.max(slot.k ?? 0, 0) + margin;
		for (let axis = 0; axis < 3; axis++) {
			min[axis] = Math.min(min[axis], slot.a[axis], slot.b[axis]) - support;
			max[axis] = Math.max(max[axis], slot.a[axis], slot.b[axis]) + support;
		}
	}
	for (let offset = 0; offset < mesh.positions.length; offset += 3) {
		for (let axis = 0; axis < 3; axis++) {
			min[axis] = Math.min(min[axis], mesh.positions[offset + axis] - margin);
			max[axis] = Math.max(max[axis], mesh.positions[offset + axis] + margin);
		}
	}
	return { min, max };
}

function corners(bounds) {
	const result = [];
	for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) result.push([x, y, z]);
	return result;
}

function viewFrame(bounds, direction) {
	const forward = normalize(direction);
	const up = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	const horizontal = normalize(cross(up, forward));
	const vertical = normalize(cross(forward, horizontal));
	const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) * 0.5);
	const projections = corners(bounds).map((corner) => {
		const offset = sub(corner, center);
		return [dot(offset, horizontal), dot(offset, vertical), dot(offset, forward)];
	});
	const limits = [0, 1, 2].map((axis) => ({ min: Math.min(...projections.map((value) => value[axis])), max: Math.max(...projections.map((value) => value[axis])) }));
	return { forward, horizontal, vertical, center, horizontalLimit: limits[0], verticalLimit: limits[1], depthLimit: limits[2] };
}

function pixelCoordinates(value, frame, resolution) {
	const offset = sub(value, frame.center);
	const u = (dot(offset, frame.horizontal) - frame.horizontalLimit.min) / (frame.horizontalLimit.max - frame.horizontalLimit.min) * resolution;
	const v = (dot(offset, frame.vertical) - frame.verticalLimit.min) / (frame.verticalLimit.max - frame.verticalLimit.min) * resolution;
	return [u, v];
}

function orient2d(a, b, c) {
	return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function rasterizeLine(mask, resolution, a, b) {
	const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 2));
	for (let step = 0; step <= steps; step++) {
		const x = Math.floor(a[0] + (b[0] - a[0]) * step / steps);
		const y = Math.floor(a[1] + (b[1] - a[1]) * step / steps);
		if (x >= 0 && y >= 0 && x < resolution && y < resolution) mask[y * resolution + x] = 1;
	}
}

function rasterizeMeshMask(mesh, frame, resolution) {
	const mask = new Uint8Array(resolution * resolution);
	for (let offset = 0; offset < mesh.indices.length; offset += 3) {
		const projected = [0, 1, 2].map((corner) => {
			const index = mesh.indices[offset + corner] * 3;
			return pixelCoordinates([...mesh.positions.subarray(index, index + 3)], frame, resolution);
		});
		const minX = Math.max(0, Math.floor(Math.min(...projected.map((value) => value[0]))));
		const maxX = Math.min(resolution - 1, Math.floor(Math.max(...projected.map((value) => value[0]))));
		const minY = Math.max(0, Math.floor(Math.min(...projected.map((value) => value[1]))));
		const maxY = Math.min(resolution - 1, Math.floor(Math.max(...projected.map((value) => value[1]))));
		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				const sample = [x + 0.5, y + 0.5];
				const signs = [orient2d(projected[0], projected[1], sample), orient2d(projected[1], projected[2], sample), orient2d(projected[2], projected[0], sample)];
				if (signs.every((value) => value >= 0) || signs.every((value) => value <= 0)) mask[y * resolution + x] = 1;
			}
		}
		rasterizeLine(mask, resolution, projected[0], projected[1]);
		rasterizeLine(mask, resolution, projected[1], projected[2]);
		rasterizeLine(mask, resolution, projected[2], projected[0]);
	}
	return mask;
}

function implicitMask(slots, blendDag, frame, resolution, rayStep) {
	const mask = new Uint8Array(resolution * resolution);
	const depthLength = frame.depthLimit.max - frame.depthLimit.min;
	const steps = Math.max(2, Math.ceil(depthLength / rayStep));
	for (let y = 0; y < resolution; y++) {
		const v = frame.verticalLimit.min + (y + 0.5) / resolution * (frame.verticalLimit.max - frame.verticalLimit.min);
		for (let x = 0; x < resolution; x++) {
			const u = frame.horizontalLimit.min + (x + 0.5) / resolution * (frame.horizontalLimit.max - frame.horizontalLimit.min);
			const transverse = add(frame.center, add(scale(frame.horizontal, u), scale(frame.vertical, v)));
			for (let step = 0; step <= steps; step++) {
				const depth = frame.depthLimit.min + step / steps * depthLength;
				const value = add(transverse, scale(frame.forward, depth));
				const sample = evaluateField(slots, value, { blendDag });
				const distanceBound = sample.d / Math.max(Math.hypot(...sample.grad), 1e-8);
				// A ray sample can straddle a thin surface without landing inside it.
				// Treat a point within half the actual ray step as an intersection;
				// this is the deterministic nearest-sample bound, not arbitrary mask
				// dilation, and keeps the reference comparison stable as rayStep varies.
				if (distanceBound <= depthLength / steps * 0.5) {
					mask[y * resolution + x] = 1;
					break;
				}
			}
		}
	}
	return mask;
}

function boundaryPixels(mask, resolution) {
	const result = [];
	for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
		const value = mask[y * resolution + x];
		let boundary = false;
		for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
			const nx = x + dx;
			const ny = y + dy;
			if (nx < 0 || ny < 0 || nx >= resolution || ny >= resolution || mask[ny * resolution + nx] !== value) { boundary = true; break; }
		}
		if (boundary && value !== 0) result.push([x, y]);
	}
	return result;
}

function directedBoundaryDistances(source, target) {
	if (source.length === 0 || target.length === 0) return [Infinity];
	return source.map((point) => {
		let best = Infinity;
		// Pixel masks have square support. Chebyshev distance reports whether a
		// boundary stays within the same one-pixel footprint in both axes; using
		// center-to-center Euclidean distance would mislabel a diagonal neighbor
		// as sqrt(2) pixels even though both boundaries occupy adjacent pixels.
		for (const candidate of target) best = Math.min(best, Math.max(Math.abs(point[0] - candidate[0]), Math.abs(point[1] - candidate[1])));
		return best;
	});
}

function nearestRank(values, probability) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(sorted.length * probability) - 1)];
}

export function compareProjectedSilhouettes(mesh, slots, blendDag, options = {}) {
	const resolution = Math.max(16, Math.floor(options.resolution ?? 64));
	const rayStep = Number(options.rayStep);
	if (!(rayStep > 0 && Number.isFinite(rayStep))) throw new Error('silhouette rayStep must be finite and > 0');
	const bounds = posedBounds(slots, rayStep * 2, mesh);
	const directions = options.directions ?? [[0, 0, 1], [1, 0, 0], [1, 0.45, 0.8]];
	const views = [];
	let maximumErrorPx = 0;
	let maximumP95ErrorPx = 0;
	let maximumDisagreementFraction = 0;
	for (let index = 0; index < directions.length; index++) {
		const frame = viewFrame(bounds, directions[index]);
		const meshMask = rasterizeMeshMask(mesh, frame, resolution);
		const fieldMask = implicitMask(slots, blendDag, frame, resolution, rayStep);
		const meshBoundary = boundaryPixels(meshMask, resolution);
		const fieldBoundary = boundaryPixels(fieldMask, resolution);
		const distances = [...directedBoundaryDistances(meshBoundary, fieldBoundary), ...directedBoundaryDistances(fieldBoundary, meshBoundary)];
		let disagreements = 0;
		for (let pixel = 0; pixel < meshMask.length; pixel++) if (meshMask[pixel] !== fieldMask[pixel]) disagreements += 1;
		const record = {
			id: `view-${index}`,
			direction: [...directions[index]],
			maximumErrorPx: Math.max(...distances),
			p95ErrorPx: nearestRank(distances, 0.95),
			disagreementPixels: disagreements,
			disagreementFraction: disagreements / maskLength(meshMask),
			meshBoundaryPixels: meshBoundary.length,
			fieldBoundaryPixels: fieldBoundary.length,
		};
		maximumErrorPx = Math.max(maximumErrorPx, record.maximumErrorPx);
		maximumP95ErrorPx = Math.max(maximumP95ErrorPx, record.p95ErrorPx);
		maximumDisagreementFraction = Math.max(maximumDisagreementFraction, record.disagreementFraction);
		views.push(record);
	}
	return { version: SILHOUETTE_VERSION, resolution, rayStep, maximumErrorPx, maximumP95ErrorPx, maximumDisagreementFraction, views };
}

function maskLength(mask) {
	return mask.length;
}
