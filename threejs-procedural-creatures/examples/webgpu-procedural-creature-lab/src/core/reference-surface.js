import { evaluateField } from './field.js';
import { extractMarchingCubes, MARCHING_CUBES_ALGORITHM, MARCHING_CUBES_AMBIGUITY_POLICY } from './marching-cubes.js';
import { findMeshComponents, isolateMeshComponent, selectComponentByHandle } from './mesh-components.js';
import { validateMeshTopology } from './mesh-validity.js';

export const REFERENCE_SURFACE_VERSION = 'creature-reference-surface-v1';

export const TIER_PROJECTED_ERROR_TARGETS = Object.freeze({
	hero: Object.freeze({ maxExtractionErrorPx: 0.5 }),
	crowd: Object.freeze({ maxExtractionErrorPx: 0.75 }),
	background: Object.freeze({ maxExtractionErrorPx: 1.0 }),
});

function digestBytes128(array) {
	const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
	let h1 = 0x811c9dc5;
	let h2 = 0x9e3779b9;
	let h3 = 0x85ebca6b;
	let h4 = 0xc2b2ae35;
	for (const byte of bytes) {
		h1 = Math.imul(h1 ^ byte, 0x01000193);
		h2 = Math.imul(h2 ^ byte, 0x27d4eb2d);
		h3 = Math.imul(h3 ^ byte, 0x165667b1);
		h4 = Math.imul(h4 ^ byte, 0x9e3779b1);
	}
	return [h1, h2, h3, h4].map((lane) => (lane >>> 0).toString(16).padStart(8, '0')).join('');
}

function digestText128(text) {
	return digestBytes128(new TextEncoder().encode(text));
}

function finitePositive(value, name) {
	const number = Number(value);
	if (!(number > 0) || !Number.isFinite(number)) throw new Error(`${name} must be finite and > 0`);
	return number;
}

function completeField(compiled, point) {
	return evaluateField(compiled.slots, point, { blendDag: compiled.blendDag });
}

function preferredMainSlot(compiled) {
	const preferred = ['main', 'body', 'core', 'chassis', 'torso'];
	for (const id of preferred) {
		const index = compiled.primitiveRecords.findIndex((slot) => slot.partId === id);
		if (index >= 0) return index;
	}
	let best = 0;
	for (let index = 1; index < compiled.slots.length; index++) {
		const candidate = Math.max(compiled.slots[index].ra, compiled.slots[index].rb);
		const current = Math.max(compiled.slots[best].ra, compiled.slots[best].rb);
		if (candidate > current) best = index;
	}
	return best;
}

function slotMidpoint(slot) {
	return [
		(slot.a[0] + slot.b[0]) * 0.5,
		(slot.a[1] + slot.b[1]) * 0.5,
		(slot.a[2] + slot.b[2]) * 0.5,
	];
}

export function deriveWorldUnitsPerPixel(options = {}) {
	const physicalHeight = finitePositive(options.physicalHeight, 'physicalHeight');
	const verticalFovRadians = finitePositive(options.verticalFovRadians, 'verticalFovRadians');
	const nearestPositiveDepth = finitePositive(options.nearestPositiveDepth, 'nearestPositiveDepth');
	if (!(verticalFovRadians < Math.PI)) throw new Error('verticalFovRadians must be < PI');
	return (2 * nearestPositiveDepth * Math.tan(verticalFovRadians * 0.5)) / physicalHeight;
}

export function deriveExtractionCellSize(options = {}) {
	const worldUnitsPerPixel = deriveWorldUnitsPerPixel(options);
	const maxErrorPx = finitePositive(options.maxErrorPx, 'maxErrorPx');
	const minimumRadius = finitePositive(options.minimumRadius, 'minimumRadius');
	const projectedErrorWorld = worldUnitsPerPixel * maxErrorPx;
	// [Derived] Linear edge interpolation on a smooth surface has second-order
	// curvature error. h <= sqrt(2*r*e) uses the smallest represented radius as
	// the conservative local curvature scale; the subsequent field/silhouette
	// sweeps remain authoritative and may force a smaller h.
	const cellSize = Math.sqrt(2 * minimumRadius * projectedErrorWorld);
	return {
		cellSize,
		worldUnitsPerPixel,
		projectedErrorWorld,
		formula: 'sqrt(2 * minimumRadius * worldUnitsPerPixel * maxErrorPx)',
	};
}

export function referenceBounds(compiled, options = {}) {
	if (!compiled?.slots?.length) throw new Error('referenceBounds requires a compiled creature with slots');
	const cellSize = finitePositive(options.cellSize, 'cellSize');
	const trustRadius = Number.isFinite(options.trustRadius) && options.trustRadius >= 0 ? options.trustRadius : 0;
	const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
	const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
	for (const slot of compiled.slots) {
		const support = Math.max(slot.ra, slot.rb) + Math.max(slot.k ?? 0, 0) + trustRadius + cellSize;
		for (let axis = 0; axis < 3; axis++) {
			min[axis] = Math.min(min[axis], slot.a[axis], slot.b[axis]) - support;
			max[axis] = Math.max(max[axis], slot.a[axis], slot.b[axis]) + support;
		}
	}
	if ([...min, ...max].some((value) => !Number.isFinite(value))) throw new Error('reference bounds are non-finite');
	return { min, max };
}

function activeRegions(compiled, cellSize, trustRadius = 0) {
	return compiled.slots.map((slot) => {
		const support = Math.max(slot.ra, slot.rb) + Math.max(slot.k ?? 0, 0) + trustRadius + cellSize * 2;
		return {
			min: [0, 1, 2].map((axis) => Math.min(slot.a[axis], slot.b[axis]) - support),
			max: [0, 1, 2].map((axis) => Math.max(slot.a[axis], slot.b[axis]) + support),
		};
	});
}

function surfaceResidual(mesh, compiled) {
	let maximum = 0;
	let sum = 0;
	const samples = mesh.positions.length / 3;
	for (let index = 0; index < samples; index++) {
		const point = [...mesh.positions.subarray(index * 3, index * 3 + 3)];
		const residual = Math.abs(completeField(compiled, point).d);
		maximum = Math.max(maximum, residual);
		sum += residual;
	}
	return { samples, maximum, mean: samples > 0 ? sum / samples : null };
}

export function extractReferenceSurface(compiled, options = {}) {
	if (!compiled?.slots?.length || !compiled.blendDag) throw new Error('extractReferenceSurface requires compileSpec output');
	const tier = options.tier ?? compiled.tier ?? 'hero';
	const target = TIER_PROJECTED_ERROR_TARGETS[tier] ?? TIER_PROJECTED_ERROR_TARGETS.hero;
	const minimumRadius = Math.min(...compiled.slots.map((slot) => Math.max(1e-6, Math.min(slot.ra, slot.rb))));
	const derived = options.cellSize
		? { cellSize: finitePositive(options.cellSize, 'cellSize'), formula: 'explicit test/fixture cellSize' }
		: deriveExtractionCellSize({
			physicalHeight: options.physicalHeight,
			verticalFovRadians: options.verticalFovRadians,
			nearestPositiveDepth: options.nearestPositiveDepth,
			maxErrorPx: options.maxErrorPx ?? target.maxExtractionErrorPx,
			minimumRadius,
		});
	const bounds = referenceBounds(compiled, { cellSize: derived.cellSize, trustRadius: options.trustRadius });
	const sample = (point) => completeField(compiled, point).d;
	const gradient = (point) => completeField(compiled, point).grad;
	const extracted = extractMarchingCubes({
		sample,
		gradient,
		bounds,
		cellSize: derived.cellSize,
		maxSamples: options.maxSamples,
		activeRegions: activeRegions(compiled, derived.cellSize, options.trustRadius),
	});
	const components = findMeshComponents(extracted);
	if (components.length === 0) throw new Error('reference extraction produced no connected surface');
	const mainSlot = preferredMainSlot(compiled);
	const handle = slotMidpoint(compiled.slots[mainSlot]);
	const selected = selectComponentByHandle(extracted, components, handle);
	if (components.length !== 1 && options.allowAdditionalComponents !== true) {
		throw new Error(`reference component policy rejected ${components.length} disconnected surfaces; main handle selected component ${selected.index}`);
	}
	const mesh = isolateMeshComponent(extracted, components[selected.index]);
	const topology = validateMeshTopology(mesh, { gradient });
	const residual = surfaceResidual(mesh, compiled);
	const referenceCompilerSignature = digestText128(JSON.stringify({
		version: REFERENCE_SURFACE_VERSION,
		sourceCompilerSignature: compiled.compilerSignature,
		algorithm: MARCHING_CUBES_ALGORITHM,
		ambiguityPolicy: MARCHING_CUBES_AMBIGUITY_POLICY,
		weldPolicy: extracted.weldPolicy,
		cellSize: derived.cellSize,
		bounds,
	}));
	return {
		...mesh,
		version: REFERENCE_SURFACE_VERSION,
		representation: 'canonical-reference-surface-candidate',
		tier,
		identity: {
			compilerSignature: referenceCompilerSignature,
			topologySignature: digestBytes128(mesh.indices),
			geometryDigest: digestBytes128(mesh.positions),
			sourceRigIdentity: {
				compilerSignature: compiled.compilerSignature,
				topologySignature: compiled.topologySignature,
				geometryDigest: compiled.geometryDigest,
			},
		},
		extraction: {
			algorithm: MARCHING_CUBES_ALGORITHM,
			ambiguityPolicy: MARCHING_CUBES_AMBIGUITY_POLICY,
			cellSize: derived.cellSize,
			cellSizeDerivation: derived,
			bounds,
			grid: extracted.grid,
		},
		componentPolicy: {
			kind: 'main-semantic-handle-single-component',
			mainSlot,
			mainPartId: compiled.primitiveRecords[mainSlot]?.partId ?? null,
			handle,
			componentCount: components.length,
			selectedComponent: selected.index,
			selectedDistanceSquared: selected.distanceSquared,
		},
		certification: {
			status: topology.status === 'accepted-topology-baseline' ? 'provisional' : 'rejected',
			topology,
			meshToFieldVertexResidual: residual,
			limitations: [
				'Bidirectional Hausdorff, projected silhouette, deformation, self-intersection, and duplicate-coverage gates are still required before acceptance.',
			],
		},
	};
}
