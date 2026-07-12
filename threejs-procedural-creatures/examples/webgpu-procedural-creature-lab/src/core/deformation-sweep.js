import { createDriver, seek } from './driver.js';
import { applyCorrectionToSurface, buildCorrectionRegion } from './correction.js';
import {
	buildAffineSlotTransforms,
	buildDualQuaternionSlotTransforms,
	deformReferenceSurfaceDqs,
	deformReferenceSurfaceLbs,
} from './deformation.js';
import { evaluateField } from './field.js';
import { validateMeshTopology } from './mesh-validity.js';

export const DEFORMATION_SWEEP_VERSION = 'creature-deformation-sweep-v1';

function finitePositive(value, name) {
	if (!(Number.isFinite(value) && value > 0)) throw new Error(`${name} must be finite and > 0`);
	return value;
}

function posedSlots(compiled, pose) {
	return compiled.slots.map((slot, index) => {
		const offset = index * 12;
		return {
			...slot,
			a: [pose[offset], pose[offset + 1], pose[offset + 2]],
			ra: pose[offset + 3],
			b: [pose[offset + 4], pose[offset + 5], pose[offset + 6]],
			rb: pose[offset + 7],
			k: pose[offset + 8],
			color: [pose[offset + 9], pose[offset + 10], pose[offset + 11]],
		};
	});
}

function fieldAt(slots, blendDag, value) {
	return evaluateField(slots, value, { blendDag });
}

function angleBetween(left, right) {
	const leftLength = Math.hypot(...left);
	const rightLength = Math.hypot(...right);
	if (!(leftLength > 1e-8 && rightLength > 1e-8)) return Math.PI;
	const cosine = Math.max(-1, Math.min(1, left.reduce((sum, component, axis) => sum + component * right[axis], 0) / leftLength / rightLength));
	return Math.acos(cosine);
}

function surfaceError(deformed, slots, blendDag) {
	let maximumDistance = 0;
	let maximumNormalAngleRadians = 0;
	let maximumFieldNormalAngleRadians = 0;
	let sumDistance = 0;
	const vertexDistance = new Float32Array(deformed.positions.length / 3);
	const vertexNormalAngle = new Float32Array(deformed.positions.length / 3);
	const geometricNormals = new Float64Array(deformed.positions.length);
	for (let offset = 0; offset < deformed.indices.length; offset += 3) {
		const ids = [deformed.indices[offset], deformed.indices[offset + 1], deformed.indices[offset + 2]];
		const points = ids.map((index) => [...deformed.positions.subarray(index * 3, index * 3 + 3)]);
		const edgeA = points[1].map((component, axis) => component - points[0][axis]);
		const edgeB = points[2].map((component, axis) => component - points[0][axis]);
		const normal = [
			edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
			edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
			edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
		];
		for (const index of ids) for (let axis = 0; axis < 3; axis++) geometricNormals[index * 3 + axis] += normal[axis];
	}
	for (let vertex = 0; vertex < deformed.positions.length / 3; vertex++) {
		const value = [...deformed.positions.subarray(vertex * 3, vertex * 3 + 3)];
		const field = fieldAt(slots, blendDag, value);
		const gradientLength = Math.hypot(...field.grad);
		const distance = Math.abs(field.d) / Math.max(gradientLength, 1e-8);
		maximumDistance = Math.max(maximumDistance, distance);
		sumDistance += distance;
		vertexDistance[vertex] = distance;
		const shaderNormal = [...deformed.normals.subarray(vertex * 3, vertex * 3 + 3)];
		const normalAngle = angleBetween(shaderNormal, [...geometricNormals.subarray(vertex * 3, vertex * 3 + 3)]);
		vertexNormalAngle[vertex] = normalAngle;
		maximumNormalAngleRadians = Math.max(maximumNormalAngleRadians, normalAngle);
		maximumFieldNormalAngleRadians = Math.max(maximumFieldNormalAngleRadians, angleBetween(shaderNormal, field.grad));
	}
	return {
		samples: deformed.positions.length / 3,
		maximumDistance,
		meanDistance: sumDistance / (deformed.positions.length / 3),
		maximumNormalAngleRadians,
		maximumFieldNormalAngleRadians,
		vertexDistance,
		vertexNormalAngle,
	};
}

function countFaceInversions(surface) {
	let count = 0;
	for (let offset = 0; offset < surface.indices.length; offset += 3) {
		const indices = [surface.indices[offset], surface.indices[offset + 1], surface.indices[offset + 2]];
		const points = indices.map((index) => [...surface.positions.subarray(index * 3, index * 3 + 3)]);
		const edgeA = points[1].map((component, axis) => component - points[0][axis]);
		const edgeB = points[2].map((component, axis) => component - points[0][axis]);
		const faceNormal = [
			edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
			edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
			edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
		];
		const expected = [0, 1, 2].map((axis) => indices.reduce((sum, index) => sum + surface.normals[index * 3 + axis], 0));
		if (faceNormal.reduce((sum, component, axis) => sum + component * expected[axis], 0) <= 0) count += 1;
	}
	return count;
}

export function buildDeformationPoseCorpus(spec, compiled, options = {}) {
	const durationSeconds = finitePositive(options.durationSeconds ?? 4, 'durationSeconds');
	const sampleCount = Math.max(3, Math.floor(options.sampleCount ?? 25));
	const driver = createDriver(spec, compiled);
	const records = [];
	for (let sample = 0; sample < sampleCount; sample++) {
		const seconds = sample / (sampleCount - 1) * durationSeconds;
		const snapshot = seek(driver, seconds);
		records.push({
			id: `locomotion-${sample.toString().padStart(3, '0')}`,
			seconds,
			tick: Math.round(seconds * 60),
			pose: snapshot.pose.slice(),
			telemetry: structuredClone(snapshot.telemetry ?? {}),
		});
	}
	return {
		version: DEFORMATION_SWEEP_VERSION,
		locomotionType: spec.locomotion?.type ?? 'none',
		durationSeconds,
		sampleCount,
		records,
		deterministicSampling: 'integer 60 Hz ticks addressed by seek()',
	};
}

function evaluateCandidate(method, surface, skinning, compiled, corpus, options) {
	const worldUnitsPerPixel = finitePositive(options.worldUnitsPerPixel, 'worldUnitsPerPixel');
	const maximumSilhouetteErrorPx = finitePositive(options.maximumSilhouetteErrorPx, 'maximumSilhouetteErrorPx');
	const maximumSurfaceErrorWorld = options.maximumSurfaceErrorWorld ?? worldUnitsPerPixel * maximumSilhouetteErrorPx;
	const maximumNormalAngleRadians = options.maximumNormalAngleRadians ?? Math.PI / 9;
	const poseRecords = [];
	let worstSurfaceDistance = 0;
	let worstNormalAngleRadians = 0;
	let collapsedTriangles = 0;
	let invertedTriangles = 0;
	let nonAdjacentSelfIntersections = 0;
	const vertexWorstDistance = new Float32Array(surface.positions.length / 3);
	const vertexWorstNormalAngle = new Float32Array(surface.positions.length / 3);
	for (const record of corpus.records) {
		const transforms = method === 'lbs'
			? buildAffineSlotTransforms(compiled, record.pose)
			: buildDualQuaternionSlotTransforms(compiled, record.pose);
		const deformed = method === 'lbs'
			? deformReferenceSurfaceLbs(surface, skinning, transforms)
			: deformReferenceSurfaceDqs(surface, skinning, transforms);
		const slots = posedSlots(compiled, record.pose);
		const topology = validateMeshTopology(deformed, {
			checkSelfIntersections: options.checkSelfIntersections === true,
			stopAfter: options.stopAfterSelfIntersections ?? 64,
		});
		const faceInversions = countFaceInversions(deformed);
		const error = surfaceError(deformed, slots, compiled.blendDag);
		for (let vertex = 0; vertex < vertexWorstDistance.length; vertex++) {
			vertexWorstDistance[vertex] = Math.max(vertexWorstDistance[vertex], error.vertexDistance[vertex]);
			vertexWorstNormalAngle[vertex] = Math.max(vertexWorstNormalAngle[vertex], error.vertexNormalAngle[vertex]);
		}
		worstSurfaceDistance = Math.max(worstSurfaceDistance, error.maximumDistance);
		worstNormalAngleRadians = Math.max(worstNormalAngleRadians, error.maximumNormalAngleRadians);
		collapsedTriangles += topology.collapsedTriangles;
		invertedTriangles += faceInversions;
		nonAdjacentSelfIntersections += topology.nonAdjacentSelfIntersections.count ?? 0;
		poseRecords.push({
			id: record.id,
			seconds: record.seconds,
			tick: record.tick,
				surface: { ...error, vertexDistance: undefined, vertexNormalAngle: undefined },
			topology: {
				status: topology.status,
				collapsedTriangles: topology.collapsedTriangles,
				inwardTriangles: faceInversions,
				nonAdjacentSelfIntersections: topology.nonAdjacentSelfIntersections.count,
				minimumArea: topology.area.min,
				minimumAngleRadians: topology.minimumAngleRadians.min,
			},
		});
	}
	const projectedSilhouetteErrorBoundPx = worstSurfaceDistance / worldUnitsPerPixel;
	const failures = [];
	if (collapsedTriangles > 0) failures.push(`${collapsedTriangles} collapsed pose triangles`);
	if (invertedTriangles > 0) failures.push(`${invertedTriangles} inverted pose triangles`);
	if (nonAdjacentSelfIntersections > 0) failures.push(`${nonAdjacentSelfIntersections} pose self-intersections`);
	if (worstSurfaceDistance > maximumSurfaceErrorWorld) failures.push(`surface-distance bound ${worstSurfaceDistance} exceeds ${maximumSurfaceErrorWorld} world units`);
	if (worstNormalAngleRadians > maximumNormalAngleRadians) failures.push(`normal error ${worstNormalAngleRadians} exceeds ${maximumNormalAngleRadians} radians`);
	if (projectedSilhouetteErrorBoundPx > maximumSilhouetteErrorPx) failures.push(`projected surface-distance bound ${projectedSilhouetteErrorBoundPx} exceeds ${maximumSilhouetteErrorPx} px`);
	return {
		method,
		status: failures.length === 0 ? 'accepted-candidate' : 'rejected',
		failures,
		thresholds: { worldUnitsPerPixel, maximumSurfaceErrorWorld, maximumSilhouetteErrorPx, maximumNormalAngleRadians },
		worst: { surfaceDistance: worstSurfaceDistance, normalAngleRadians: worstNormalAngleRadians, projectedSilhouetteErrorBoundPx },
		totals: { collapsedTriangles, invertedTriangles, nonAdjacentSelfIntersections },
		vertexWorstDistance,
		vertexWorstNormalAngle,
		poseRecords,
	};
}

function evaluateCorrectedCandidate(method, rawCandidate, surface, skinning, compiled, corpus, options) {
	const thresholds = rawCandidate.thresholds;
	const maximumTrials = Math.max(0, Math.floor(options.maximumCorrectionTrials ?? 2));
	if (maximumTrials === 0) return { method, status: 'disabled', failures: ['live correction is disabled for this tier'], region: null, poseRecords: [] };
	const correctionBasis = rawCandidate.vertexWorstDistance.slice();
	for (let vertex = 0; vertex < correctionBasis.length; vertex++) {
		const normalEquivalent = thresholds.maximumSurfaceErrorWorld * rawCandidate.vertexWorstNormalAngle[vertex] / thresholds.maximumNormalAngleRadians;
		correctionBasis[vertex] = Math.max(correctionBasis[vertex], normalEquivalent);
	}
	const region = buildCorrectionRegion(surface, correctionBasis, {
		threshold: thresholds.maximumSurfaceErrorWorld,
		maximumFraction: options.maximumCorrectionFraction ?? 0.25,
		minimumIslandVertices: options.minimumCorrectionIslandVertices ?? 3,
	});
	if (region.status !== 'accepted-correction-region') {
		return { method, status: 'rejected', failures: [`correction region fraction ${region.fraction} exceeds ${region.maximumFraction}`], region, poseRecords: [] };
	}
	const trustRadius = finitePositive(options.correctionTrustRadius ?? thresholds.maximumSurfaceErrorWorld * 4, 'correctionTrustRadius');
	let worstSurfaceDistance = 0;
	let worstNormalAngleRadians = 0;
	let collapsedTriangles = 0;
	let invertedTriangles = 0;
	let nonAdjacentSelfIntersections = 0;
	let preservedVertices = 0;
	let correctedVertices = 0;
	let backtracks = 0;
	const poseRecords = [];
	for (const record of corpus.records) {
		const transforms = method === 'lbs'
			? buildAffineSlotTransforms(compiled, record.pose)
			: buildDualQuaternionSlotTransforms(compiled, record.pose);
		const skinOnly = method === 'lbs'
			? deformReferenceSurfaceLbs(surface, skinning, transforms)
			: deformReferenceSurfaceDqs(surface, skinning, transforms);
		const slots = posedSlots(compiled, record.pose);
		const fieldEval = (value) => fieldAt(slots, compiled.blendDag, value);
		const corrected = applyCorrectionToSurface(skinOnly, region.mask, fieldEval, {
			trustRadius,
			maximumTrials,
			maximumBacktracks: options.maximumCorrectionBacktracks ?? 4,
		});
		const topology = validateMeshTopology(corrected, {
			checkSelfIntersections: options.checkSelfIntersections === true,
			stopAfter: options.stopAfterSelfIntersections ?? 64,
		});
		const faceInversions = countFaceInversions(corrected);
		const error = surfaceError(corrected, slots, compiled.blendDag);
		worstSurfaceDistance = Math.max(worstSurfaceDistance, error.maximumDistance);
		worstNormalAngleRadians = Math.max(worstNormalAngleRadians, error.maximumNormalAngleRadians);
		collapsedTriangles += topology.collapsedTriangles;
		invertedTriangles += faceInversions;
		nonAdjacentSelfIntersections += topology.nonAdjacentSelfIntersections.count ?? 0;
		preservedVertices += corrected.telemetry.preservedVertices;
		correctedVertices += corrected.telemetry.correctedVertices;
		backtracks += corrected.telemetry.backtracks;
		poseRecords.push({
			id: record.id,
			seconds: record.seconds,
			tick: record.tick,
				surface: { ...error, vertexDistance: undefined, vertexNormalAngle: undefined },
			topology: {
				status: topology.status,
				collapsedTriangles: topology.collapsedTriangles,
				inwardTriangles: faceInversions,
				nonAdjacentSelfIntersections: topology.nonAdjacentSelfIntersections.count,
			},
			correction: corrected.telemetry,
		});
	}
	const projectedSilhouetteErrorBoundPx = worstSurfaceDistance / thresholds.worldUnitsPerPixel;
	const failures = [];
	if (collapsedTriangles > 0) failures.push(`${collapsedTriangles} collapsed corrected triangles`);
	if (invertedTriangles > 0) failures.push(`${invertedTriangles} inverted corrected triangles`);
	if (nonAdjacentSelfIntersections > 0) failures.push(`${nonAdjacentSelfIntersections} corrected self-intersections`);
	if (worstSurfaceDistance > thresholds.maximumSurfaceErrorWorld) failures.push(`corrected surface-distance bound ${worstSurfaceDistance} exceeds ${thresholds.maximumSurfaceErrorWorld} world units`);
	if (worstNormalAngleRadians > thresholds.maximumNormalAngleRadians) failures.push(`corrected normal error ${worstNormalAngleRadians} exceeds ${thresholds.maximumNormalAngleRadians} radians`);
	return {
		method,
		status: failures.length === 0 ? 'accepted-corrected-candidate' : 'rejected',
		failures,
		region,
		thresholds: { ...thresholds, trustRadius, maximumTrials },
		worst: { surfaceDistance: worstSurfaceDistance, normalAngleRadians: worstNormalAngleRadians, projectedSilhouetteErrorBoundPx },
		totals: { collapsedTriangles, invertedTriangles, nonAdjacentSelfIntersections, preservedVertices, correctedVertices, backtracks },
		poseRecords,
	};
}

export function certifyDeformationSelection(spec, compiled, surface, skinning, options = {}) {
	const corpus = options.corpus ?? buildDeformationPoseCorpus(spec, compiled, options);
	const lbs = evaluateCandidate('lbs', surface, skinning, compiled, corpus, options);
	const dqs = evaluateCandidate('dqs-log-scale', surface, skinning, compiled, corpus, options);
	const lbsCorrected = lbs.status === 'accepted-candidate' ? null : evaluateCorrectedCandidate('lbs', lbs, surface, skinning, compiled, corpus, options);
	const dqsCorrected = dqs.status === 'accepted-candidate' ? null : evaluateCorrectedCandidate('dqs-log-scale', dqs, surface, skinning, compiled, corpus, options);
	const selection = lbs.status === 'accepted-candidate'
		? { method: 'lbs', correction: 'none' }
		: dqs.status === 'accepted-candidate'
			? { method: 'dqs-log-scale', correction: 'none' }
			: lbsCorrected?.status === 'accepted-corrected-candidate'
				? { method: 'lbs', correction: 'bounded-static-mask' }
				: dqsCorrected?.status === 'accepted-corrected-candidate'
					? { method: 'dqs-log-scale', correction: 'bounded-static-mask' }
					: null;
	return {
		version: DEFORMATION_SWEEP_VERSION,
		status: selection ? 'accepted-deformation-selection' : 'rejected',
		selectedMethod: selection?.method ?? null,
		correctionLayout: selection?.correction ?? null,
		selectionRule: 'Prefer skin-only LBS, then skin-only DQS; permit a static bounded correction mask only when it covers at most 25% and the corrected full sweep passes; otherwise reject.',
		corpus: {
			version: corpus.version,
			locomotionType: corpus.locomotionType,
			durationSeconds: corpus.durationSeconds,
			sampleCount: corpus.sampleCount,
			deterministicSampling: corpus.deterministicSampling,
		},
		candidates: { lbs, dqs, lbsCorrected, dqsCorrected },
		limitations: [
			'Projected surface-distance is a conservative silhouette bound; direct near/design/far image-space silhouette comparison remains a browser acceptance gate.',
			'Morphology-envelope endpoint poses are not included unless supplied through options.corpus.',
		],
	};
}
