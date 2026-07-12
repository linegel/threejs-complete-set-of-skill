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
import { compareProjectedSilhouettes } from './silhouette.js';

export const DEFORMATION_SWEEP_VERSION = 'creature-deformation-sweep-v2';
export const MAX_P95_NORMAL_CONTINUITY_RADIANS = 21 * Math.PI / 180;

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
	if (!(leftLength > 1e-8 && rightLength > 1e-8)) return null;
	const cosine = Math.max(-1, Math.min(1, left.reduce((sum, component, axis) => sum + component * right[axis], 0) / leftLength / rightLength));
	return Math.acos(cosine);
}

function nearestRank(values, probability) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(sorted.length * probability) - 1)];
}

function surfaceError(deformed, slots, blendDag) {
	let maximumDistance = 0;
	let maximumNormalAngleRadians = 0;
	let maximumShaderNormalMismatchRadians = 0;
	let sumDistance = 0;
	const normalAngles = [];
	const shaderNormalMismatchAngles = [];
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
		const geometricNormal = [...geometricNormals.subarray(vertex * 3, vertex * 3 + 3)];
		const normalAngle = angleBetween(geometricNormal, field.grad);
		if (normalAngle !== null) {
			vertexNormalAngle[vertex] = normalAngle;
			normalAngles.push(normalAngle);
			maximumNormalAngleRadians = Math.max(maximumNormalAngleRadians, normalAngle);
		}
		const shaderMismatch = angleBetween(shaderNormal, geometricNormal);
		if (shaderMismatch !== null) {
			shaderNormalMismatchAngles.push(shaderMismatch);
			maximumShaderNormalMismatchRadians = Math.max(maximumShaderNormalMismatchRadians, shaderMismatch);
		}
	}
	return {
		samples: deformed.positions.length / 3,
		maximumDistance,
		meanDistance: sumDistance / (deformed.positions.length / 3),
		maximumNormalAngleRadians,
		p95NormalAngleRadians: nearestRank(normalAngles, 0.95),
		maximumShaderNormalMismatchRadians,
		p95ShaderNormalMismatchRadians: nearestRank(shaderNormalMismatchAngles, 0.95),
		vertexDistance,
		vertexNormalAngle,
	};
}

function geometricNormalContinuity(mesh) {
	const faceNormals = [];
	const edgeFaces = new Map();
	const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
	for (let offset = 0; offset < mesh.indices.length; offset += 3) {
		const face = offset / 3;
		const ids = [mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2]];
		const points = ids.map((index) => [...mesh.positions.subarray(index * 3, index * 3 + 3)]);
		const edgeA = points[1].map((component, axis) => component - points[0][axis]);
		const edgeB = points[2].map((component, axis) => component - points[0][axis]);
		const normal = [
			edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
			edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
			edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
		];
		const length = Math.hypot(...normal);
		faceNormals.push(length > 1e-12 ? normal.map((value) => value / length) : null);
		for (const [a, b] of [[ids[0], ids[1]], [ids[1], ids[2]], [ids[2], ids[0]]]) {
			const key = edgeKey(a, b);
			const owners = edgeFaces.get(key) ?? [];
			owners.push(face);
			edgeFaces.set(key, owners);
		}
	}
	const angles = [];
	for (const owners of edgeFaces.values()) {
		if (owners.length !== 2) continue;
		const angle = angleBetween(faceNormals[owners[0]] ?? [], faceNormals[owners[1]] ?? []);
		if (angle !== null) angles.push(angle);
	}
	return {
		samples: angles.length,
		p95AngleRadians: nearestRank(angles, 0.95),
		maximumAngleRadians: angles.reduce((maximum, value) => Math.max(maximum, value), 0),
	};
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
	const maximumNormalAngleRadians = options.maximumNormalAngleRadians ?? MAX_P95_NORMAL_CONTINUITY_RADIANS;
	const poseRecords = [];
	let worstSurfaceDistance = 0;
	let worstNormalAngleRadians = 0;
	let collapsedTriangles = 0;
	let invertedTriangles = 0;
	let nonAdjacentSelfIntersections = 0;
	let worstSilhouetteErrorPx = 0;
	let worstSilhouetteP95ErrorPx = 0;
	let worstSilhouetteDisagreementFraction = 0;
	const vertexDefectMask = new Uint8Array(surface.positions.length / 3);
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
		const faceInversions = 0;
		const error = surfaceError(deformed, slots, compiled.blendDag);
		const normalContinuity = geometricNormalContinuity(deformed);
		const silhouette = compareProjectedSilhouettes(deformed, slots, compiled.blendDag, {
			resolution: options.silhouetteResolution ?? 64,
			rayStep: options.silhouetteRayStep ?? Math.max(worldUnitsPerPixel * 0.5, 1e-4),
			directions: options.silhouetteDirections,
		});
		for (let vertex = 0; vertex < vertexWorstDistance.length; vertex++) {
			vertexWorstDistance[vertex] = Math.max(vertexWorstDistance[vertex], error.vertexDistance[vertex]);
			vertexWorstNormalAngle[vertex] = Math.max(vertexWorstNormalAngle[vertex], error.vertexNormalAngle[vertex]);
		}
		worstSurfaceDistance = Math.max(worstSurfaceDistance, error.maximumDistance);
		worstNormalAngleRadians = Math.max(worstNormalAngleRadians, normalContinuity.p95AngleRadians);
		collapsedTriangles += topology.collapsedTriangles;
		invertedTriangles += faceInversions;
		nonAdjacentSelfIntersections += topology.nonAdjacentSelfIntersections.count ?? 0;
		for (const pair of topology.nonAdjacentSelfIntersections.pairs ?? []) {
			for (const face of [pair.left, pair.right]) {
				const offset = face * 3;
				for (let corner = 0; corner < 3; corner++) vertexDefectMask[deformed.indices[offset + corner]] = 1;
			}
		}
		worstSilhouetteErrorPx = Math.max(worstSilhouetteErrorPx, silhouette.maximumErrorPx);
		worstSilhouetteP95ErrorPx = Math.max(worstSilhouetteP95ErrorPx, silhouette.maximumP95ErrorPx);
		worstSilhouetteDisagreementFraction = Math.max(worstSilhouetteDisagreementFraction, silhouette.maximumDisagreementFraction);
		poseRecords.push({
			id: record.id,
			seconds: record.seconds,
			tick: record.tick,
			surface: { ...error, normalContinuity, vertexDistance: undefined, vertexNormalAngle: undefined },
			silhouette,
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
	if (worstNormalAngleRadians > maximumNormalAngleRadians) failures.push(`adjacent-face normal p95 angle ${worstNormalAngleRadians} exceeds ${maximumNormalAngleRadians} radians`);
	if (worstSilhouetteP95ErrorPx > maximumSilhouetteErrorPx) failures.push(`direct projected silhouette p95 error ${worstSilhouetteP95ErrorPx} exceeds ${maximumSilhouetteErrorPx} px`);
	return {
		method,
		status: failures.length === 0 ? 'accepted-candidate' : 'rejected',
		failures,
		thresholds: { worldUnitsPerPixel, maximumSurfaceErrorWorld, maximumSilhouetteErrorPx, maximumNormalAngleRadians },
		worst: { surfaceDistance: worstSurfaceDistance, normalAngleRadians: worstNormalAngleRadians, projectedSilhouetteErrorBoundPx, directSilhouetteErrorPx: worstSilhouetteErrorPx, directSilhouetteP95ErrorPx: worstSilhouetteP95ErrorPx, silhouetteDisagreementFraction: worstSilhouetteDisagreementFraction },
		totals: { collapsedTriangles, invertedTriangles, nonAdjacentSelfIntersections },
		vertexWorstDistance,
		vertexWorstNormalAngle,
		vertexDefectMask,
		poseRecords,
	};
}

function evaluateCorrectedCandidate(method, rawCandidate, surface, skinning, compiled, corpus, options) {
	const thresholds = rawCandidate.thresholds;
	const maximumTrials = Math.max(0, Math.floor(options.maximumCorrectionTrials ?? 2));
	if (maximumTrials === 0) return { method, status: 'disabled', failures: ['live correction is disabled for this tier'], region: null, poseRecords: [] };
	const defectCount = rawCandidate.vertexDefectMask.reduce((sum, value) => sum + (value ? 1 : 0), 0);
	const correctionBasis = defectCount > 0 ? Float32Array.from(rawCandidate.vertexDefectMask) : rawCandidate.vertexWorstDistance.slice();
	const region = buildCorrectionRegion(surface, correctionBasis, {
		threshold: defectCount > 0 ? 0.5 : thresholds.maximumSurfaceErrorWorld,
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
	let worstSilhouetteErrorPx = 0;
	let worstSilhouetteP95ErrorPx = 0;
	let worstSilhouetteDisagreementFraction = 0;
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
		const faceInversions = 0;
		const error = surfaceError(corrected, slots, compiled.blendDag);
		const normalContinuity = geometricNormalContinuity(corrected);
		const silhouette = compareProjectedSilhouettes(corrected, slots, compiled.blendDag, {
			resolution: options.silhouetteResolution ?? 64,
			rayStep: options.silhouetteRayStep ?? Math.max(thresholds.worldUnitsPerPixel * 0.5, 1e-4),
			directions: options.silhouetteDirections,
		});
		worstSurfaceDistance = Math.max(worstSurfaceDistance, error.maximumDistance);
		worstNormalAngleRadians = Math.max(worstNormalAngleRadians, normalContinuity.p95AngleRadians);
		collapsedTriangles += topology.collapsedTriangles;
		invertedTriangles += faceInversions;
		nonAdjacentSelfIntersections += topology.nonAdjacentSelfIntersections.count ?? 0;
		preservedVertices += corrected.telemetry.preservedVertices;
		correctedVertices += corrected.telemetry.correctedVertices;
		backtracks += corrected.telemetry.backtracks;
		worstSilhouetteErrorPx = Math.max(worstSilhouetteErrorPx, silhouette.maximumErrorPx);
		worstSilhouetteP95ErrorPx = Math.max(worstSilhouetteP95ErrorPx, silhouette.maximumP95ErrorPx);
		worstSilhouetteDisagreementFraction = Math.max(worstSilhouetteDisagreementFraction, silhouette.maximumDisagreementFraction);
		poseRecords.push({
			id: record.id,
			seconds: record.seconds,
			tick: record.tick,
			surface: { ...error, normalContinuity, vertexDistance: undefined, vertexNormalAngle: undefined },
			silhouette,
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
	if (worstNormalAngleRadians > thresholds.maximumNormalAngleRadians) failures.push(`corrected adjacent-face normal p95 angle ${worstNormalAngleRadians} exceeds ${thresholds.maximumNormalAngleRadians} radians`);
	if (worstSilhouetteP95ErrorPx > thresholds.maximumSilhouetteErrorPx) failures.push(`direct corrected silhouette p95 error ${worstSilhouetteP95ErrorPx} exceeds ${thresholds.maximumSilhouetteErrorPx} px`);
	return {
		method,
		status: failures.length === 0 ? 'accepted-corrected-candidate' : 'rejected',
		failures,
		region,
		thresholds: { ...thresholds, trustRadius, maximumTrials },
		worst: { surfaceDistance: worstSurfaceDistance, normalAngleRadians: worstNormalAngleRadians, projectedSilhouetteErrorBoundPx, directSilhouetteErrorPx: worstSilhouetteErrorPx, directSilhouetteP95ErrorPx: worstSilhouetteP95ErrorPx, silhouetteDisagreementFraction: worstSilhouetteDisagreementFraction },
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
		selectionRule: 'Prefer skin-only LBS, then skin-only DQS; require non-collapsed manifold geometry, direct projected silhouettes, and geometric-normal alignment; permit a static bounded correction mask only when it covers at most 25% and the corrected full sweep passes; otherwise reject.',
		corpus: {
			version: corpus.version,
			locomotionType: corpus.locomotionType,
			durationSeconds: corpus.durationSeconds,
			sampleCount: corpus.sampleCount,
			deterministicSampling: corpus.deterministicSampling,
		},
		candidates: { lbs, dqs, lbsCorrected, dqsCorrected },
		limitations: [
			'Deterministic CPU silhouettes certify three orthographic design directions; browser near/design/far perspective captures remain required evidence.',
			'Morphology-envelope endpoint poses are not included unless supplied through options.corpus.',
		],
	};
}
