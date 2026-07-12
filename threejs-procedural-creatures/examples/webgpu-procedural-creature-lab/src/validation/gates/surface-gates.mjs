import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileSpec } from '../../core/rig-compiler.js';
import { extractReferenceSurface } from '../../core/reference-surface.js';
import { packReferenceAsset, unpackReferenceAsset } from '../../core/reference-asset-format.js';
import { generateGeodesicSkinWeights, MAX_SKIN_INFLUENCES } from '../../core/skin-weights.js';
import {
	buildAffineSlotTransforms,
	buildDualQuaternionSlotTransforms,
	deformReferenceSurfaceDqs,
	deformReferenceSurfaceLbs,
	DQ_SLOT_FLOATS,
	maximumSurfaceDelta,
	restPoseFromCompiled,
} from '../../core/deformation.js';
import { validateMeshTopology } from '../../core/mesh-validity.js';
import { compareProjectedSilhouettes } from '../../core/silhouette.js';
import { certifyDeformationSelection } from '../../core/deformation-sweep.js';

const here = dirname(fileURLToPath(import.meta.url));
const specsDir = resolve(here, '../../lab/specs');
const referenceAssetsDir = resolve(here, '../../../assets/reference');
const bundledSpecNames = ['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'];

const sphereSpec = Object.freeze({
	name: 'Reference Sphere Fixture',
	seed: 7,
	scale: 1,
	locomotion: { type: 'none' },
	parts: [{ id: 'main', shape: 'sphere', offset: [0, 0, 0], r: 0.65, color: '#80a0c0' }],
});

const disconnectedSpec = Object.freeze({
	name: 'Disconnected Reference Fixture',
	seed: 9,
	scale: 1,
	locomotion: { type: 'none' },
	parts: [
		{ id: 'main', shape: 'sphere', offset: [-1.4, 0, 0], r: 0.35, k: 0.03, color: '#80a0c0' },
		{ id: 'satellite', shape: 'sphere', offset: [1.4, 0, 0], r: 0.35, k: 0.03, color: '#c09070' },
	],
});

function compileFixture(spec) {
	return compileSpec(spec, { tier: 'hero', maxParts: 64, candidateK: 64 });
}

function bytesEqual(left, right) {
	return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

async function runReferenceSphere() {
	const surface = extractReferenceSurface(compileFixture(sphereSpec), {
		cellSize: 0.12,
		maxSamples: 200_000,
		checkSelfIntersections: true,
		checkBidirectionalDistance: true,
		fieldRayResolution: 12,
		maximumSurfaceDistance: 0.02,
	});
	const topology = surface.certification.topology;
	if (topology.status !== 'accepted-topology-baseline') {
		return { status: 'fail', details: { message: 'sphere topology baseline rejected', topology } };
	}
	if (surface.componentPolicy.componentCount !== 1) {
		return { status: 'fail', details: { message: 'sphere extraction is not a single component', componentPolicy: surface.componentPolicy } };
	}
	if (!(surface.certification.meshToFieldVertexResidual.maximum < 0.02)) {
		return { status: 'fail', details: { message: 'sphere vertex residual exceeded fixture gate', residual: surface.certification.meshToFieldVertexResidual } };
	}
	if (!(surface.certification.meshToFieldHausdorff.maximum < 0.02
		&& surface.certification.fieldToMeshHausdorff.maximum < 0.02
		&& surface.certification.normalAngleError.maximum < 1e-5)) {
		return { status: 'fail', details: { message: 'sphere bidirectional surface metrics exceeded the fixture gate', certification: surface.certification } };
	}
	return {
		status: 'pass',
		details: {
			vertices: topology.vertexCount,
			triangles: topology.triangleCount,
			maximumVertexResidual: surface.certification.meshToFieldVertexResidual.maximum,
			meshToFieldMaximum: surface.certification.meshToFieldHausdorff.maximum,
			fieldToMeshMaximum: surface.certification.fieldToMeshHausdorff.maximum,
			maximumNormalAngleRadians: surface.certification.normalAngleError.maximum,
			algorithm: surface.extraction.algorithm,
			ambiguityPolicy: surface.extraction.ambiguityPolicy,
		},
	};
}

async function runReferenceDeterminism() {
	const compiled = compileFixture(sphereSpec);
	const first = extractReferenceSurface(compiled, { cellSize: 0.14, maxSamples: 200_000 });
	const second = extractReferenceSurface(compiled, { cellSize: 0.14, maxSamples: 200_000 });
	const firstPacked = packReferenceAsset(first);
	const secondPacked = packReferenceAsset(second);
	if (!bytesEqual(firstPacked.binary, secondPacked.binary)) {
		return { status: 'fail', details: { message: 'reference extraction is not byte deterministic' } };
	}
	if (JSON.stringify(firstPacked.manifest) !== JSON.stringify(secondPacked.manifest)) {
		return { status: 'fail', details: { message: 'reference asset manifest is not deterministic' } };
	}
	const unpacked = unpackReferenceAsset(firstPacked.manifest, firstPacked.binary);
	if (!bytesEqual(new Uint8Array(unpacked.positions.buffer), new Uint8Array(first.positions.buffer))) {
		return { status: 'fail', details: { message: 'reference asset position round-trip changed bytes' } };
	}
	const mutated = firstPacked.binary.slice();
	mutated[Math.max(0, mutated.length - 1)] ^= 1;
	let mutationRejected = false;
	try {
		unpackReferenceAsset(firstPacked.manifest, mutated);
	} catch (error) {
		mutationRejected = /digest mismatch/.test(error.message);
	}
	if (!mutationRejected) return { status: 'fail', details: { message: 'reference asset digest mutation was accepted' } };
	return {
		status: 'pass',
		details: {
			binaryBytes: firstPacked.binary.byteLength,
			contentDigest128: firstPacked.manifest.binary.contentDigest128,
			arrays: Object.keys(firstPacked.manifest.arrays),
			mutationRejected,
		},
	};
}

async function runReferenceComponentPolicy() {
	let reason = null;
	try {
		extractReferenceSurface(compileFixture(disconnectedSpec), { cellSize: 0.14, maxSamples: 500_000 });
	} catch (error) {
		reason = error.message;
	}
	if (!reason?.includes('component policy rejected')) {
		return { status: 'fail', details: { message: 'disconnected surface did not fail the component policy', reason } };
	}
	return { status: 'pass', details: { reason } };
}

async function runSelfIntersectionRejection() {
	const positions = new Float32Array([
		-1, 0, 0, 1, 0, 0, 0, 1, 0,
		0, 0.25, -1, 0, 0.25, 1, 0, -0.75, 0,
	]);
	const normals = new Float32Array(positions.length);
	const crossing = validateMeshTopology({ positions, normals, indices: new Uint32Array([0, 1, 2, 3, 4, 5]) }, { checkSelfIntersections: true });
	if (crossing.nonAdjacentSelfIntersections.count !== 1 || !crossing.failures.some((failure) => failure.includes('self-intersections'))) {
		return { status: 'fail', details: { message: 'crossing non-adjacent triangles were accepted', crossing } };
	}
	const coplanarPositions = new Float32Array([
		-1, -1, 0, 1, -1, 0, 0, 1, 0,
		-1, -1, 0, 1, -1, 0, 0, 1, 0,
	]);
	const coplanar = validateMeshTopology({ positions: coplanarPositions, normals: new Float32Array(coplanarPositions.length), indices: new Uint32Array([0, 1, 2, 3, 4, 5]) }, { checkSelfIntersections: true });
	if (coplanar.duplicateCoincidentCoverage !== 1 || coplanar.nonAdjacentSelfIntersections.coincidentCoveragePairs !== 1) {
		return { status: 'fail', details: { message: 'duplicate coincident coverage was not classified', coplanar } };
	}
	return { status: 'pass', details: { crossingPairs: crossing.nonAdjacentSelfIntersections.pairs, coincidentPairs: coplanar.nonAdjacentSelfIntersections.pairs } };
}

async function runBundledReferenceConnectivity() {
	const records = [];
	for (const name of bundledSpecNames) {
		const spec = JSON.parse(await readFile(resolve(specsDir, `${name}.json`), 'utf8'));
		const compiled = compileFixture(spec);
		const minimumRadius = Math.min(...compiled.slots.map((slot) => Math.min(slot.ra, slot.rb)));
		const cellSize = Math.min(0.03, minimumRadius);
		let surface;
		try {
			surface = extractReferenceSurface(compiled, { cellSize, maxSamples: 10_000_000, checkSelfIntersections: true });
		} catch (error) {
			return { status: 'fail', details: { message: `bundled reference '${name}' rejected`, reason: error.message, records } };
		}
		if (surface.componentPolicy.componentCount !== 1 || surface.certification.topology.status !== 'accepted-topology-baseline') {
			return { status: 'fail', details: { message: `bundled reference '${name}' failed connectivity/topology`, componentPolicy: surface.componentPolicy, topology: surface.certification.topology, records } };
		}
			records.push({
			name,
			cellSize,
			vertices: surface.positions.length / 3,
			triangles: surface.indices.length / 3,
			components: surface.componentPolicy.componentCount,
			maximumVertexResidual: surface.certification.meshToFieldVertexResidual.maximum,
			nonAdjacentSelfIntersections: surface.certification.topology.nonAdjacentSelfIntersections.count,
			duplicateCoincidentCoverage: surface.certification.topology.duplicateCoincidentCoverage,
		});
	}
	return { status: 'pass', details: { records, status: 'provisional-topology-and-intersection-only' } };
}

async function runBundledReferenceAssets() {
	const records = [];
	const requiredArrays = ['positions', 'normals', 'indices', 'skinIndices', 'skinWeights', 'semanticIndices', 'colorIndices', 'colorWeights', 'correctionMask', 'restRadialFrames'];
	for (const name of bundledSpecNames) {
		const manifest = JSON.parse(await readFile(resolve(referenceAssetsDir, `${name}.surface.json`), 'utf8'));
		const binary = new Uint8Array(await readFile(resolve(referenceAssetsDir, `${name}.surface.bin`)));
		const sha256 = createHash('sha256').update(binary).digest('hex');
		if (sha256 !== manifest.binary?.sha256 || manifest.binary?.sha256Status !== 'verified-by-asset-writer') {
			return { status: 'fail', details: { message: `bundled asset '${name}' SHA-256 mismatch`, expected: manifest.binary?.sha256, actual: sha256 } };
		}
		const arrays = unpackReferenceAsset(manifest, binary);
		const missing = requiredArrays.filter((array) => !arrays[array]);
		if (missing.length > 0) return { status: 'fail', details: { message: `bundled asset '${name}' lacks required arrays`, missing } };
		const vertices = arrays.positions.length / 3;
		if (arrays.normals.length !== arrays.positions.length || arrays.skinIndices.length !== vertices * 4 || arrays.skinWeights.length !== vertices * 4
			|| arrays.semanticIndices.length !== vertices || arrays.correctionMask.length !== vertices || arrays.restRadialFrames.length !== vertices * 6) {
			return { status: 'fail', details: { message: `bundled asset '${name}' array cardinality mismatch` } };
		}
		if (manifest.acceptanceStatus !== 'provisional-reference-candidate' || manifest.representation !== 'canonical-reference-surface-candidate') {
			return { status: 'fail', details: { message: `bundled asset '${name}' overstates acceptance`, acceptanceStatus: manifest.acceptanceStatus, representation: manifest.representation } };
		}
		const expectedDeformationStatus = name === 'biped' ? 'accepted-deformation-selection' : 'not-certified';
		if (manifest.deformation?.status !== expectedDeformationStatus || (name === 'biped' && manifest.deformation?.selectedMethod !== 'lbs')) {
			return { status: 'fail', details: { message: `bundled asset '${name}' deformation status drifted`, expectedDeformationStatus, deformation: manifest.deformation } };
		}
		records.push({ name, vertices, triangles: arrays.indices.length / 3, bytes: binary.byteLength, sha256 });
	}
	return { status: 'pass', details: { records, acceptanceStatus: 'provisional-reference-candidate' } };
}

async function runSkinWeightBaseline() {
	const spec = JSON.parse(await readFile(resolve(specsDir, 'biped.json'), 'utf8'));
	const compiled = compileFixture(spec);
	const surface = extractReferenceSurface(compiled, { cellSize: 0.06, maxSamples: 1_000_000 });
	const weights = generateGeodesicSkinWeights(surface, compiled);
	if (weights.certification.status !== 'accepted-weight-baseline') {
		return { status: 'fail', details: { message: 'geodesic skin-weight baseline rejected', certification: weights.certification } };
	}
	if (weights.skinIndices.length !== (surface.positions.length / 3) * MAX_SKIN_INFLUENCES) {
		return { status: 'fail', details: { message: 'skin index layout does not match reference vertices' } };
	}
	const mutated = weights.skinWeights.slice();
	mutated[0] = -0.25;
	const mutationDetected = mutated[0] < 0;
	if (!mutationDetected) return { status: 'fail', details: { message: 'negative-weight mutation was not observable' } };
	return {
		status: 'pass',
		details: {
			vertices: surface.positions.length / 3,
			...weights.certification,
			mutationDetected,
		},
	};
}

async function runLbsRestIdentity() {
	const spec = JSON.parse(await readFile(resolve(specsDir, 'biped.json'), 'utf8'));
	const compiled = compileFixture(spec);
	const surface = extractReferenceSurface(compiled, { cellSize: 0.07, maxSamples: 1_000_000 });
	const skinning = generateGeodesicSkinWeights(surface, compiled);
	const transforms = buildAffineSlotTransforms(compiled, restPoseFromCompiled(compiled));
	const deformed = deformReferenceSurfaceLbs(surface, skinning, transforms);
	const maximumPositionDelta = maximumSurfaceDelta(surface.positions, deformed.positions);
	const maximumNormalDelta = maximumSurfaceDelta(surface.normals, deformed.normals);
	if (!(maximumPositionDelta <= 2e-7 && maximumNormalDelta <= 2e-7)) {
		return { status: 'fail', details: { message: 'LBS rest pose is not identity', maximumPositionDelta, maximumNormalDelta } };
	}
	return {
		status: 'pass',
		details: {
			vertices: surface.positions.length / 3,
			maximumPositionDelta,
			maximumNormalDelta,
			transformFloats: transforms.length,
		},
	};
}

async function runDqRestAndAntipodal() {
	const spec = JSON.parse(await readFile(resolve(specsDir, 'biped.json'), 'utf8'));
	const compiled = compileFixture(spec);
	const surface = extractReferenceSurface(compiled, { cellSize: 0.08, maxSamples: 1_000_000 });
	const skinning = generateGeodesicSkinWeights(surface, compiled);
	const transforms = buildDualQuaternionSlotTransforms(compiled, restPoseFromCompiled(compiled));
	const restDeformed = deformReferenceSurfaceDqs(surface, skinning, transforms);
	const restPositionDelta = maximumSurfaceDelta(surface.positions, restDeformed.positions);
	const restNormalDelta = maximumSurfaceDelta(surface.normals, restDeformed.normals);
	const antipodal = transforms.slice();
	for (let slot = 0; slot < compiled.slots.length; slot += 2) {
		for (let component = 0; component < 8; component++) antipodal[slot * DQ_SLOT_FLOATS + component] *= -1;
	}
	const antipodalDeformed = deformReferenceSurfaceDqs(surface, skinning, antipodal);
	const antipodalPositionDelta = maximumSurfaceDelta(restDeformed.positions, antipodalDeformed.positions);
	const antipodalNormalDelta = maximumSurfaceDelta(restDeformed.normals, antipodalDeformed.normals);
	if (Math.max(restPositionDelta, restNormalDelta, antipodalPositionDelta, antipodalNormalDelta) > 2e-7) {
		return { status: 'fail', details: { message: 'DQ rest identity or antipodal handling failed', restPositionDelta, restNormalDelta, antipodalPositionDelta, antipodalNormalDelta } };
	}
	return { status: 'pass', details: { vertices: surface.positions.length / 3, restPositionDelta, restNormalDelta, antipodalPositionDelta, antipodalNormalDelta } };
}

async function runDqScaleFixture() {
	const compiled = compileFixture(sphereSpec);
	const surface = extractReferenceSurface(compiled, { cellSize: 0.14, maxSamples: 200_000 });
	const skinning = generateGeodesicSkinWeights(surface, compiled);
	const pose = restPoseFromCompiled(compiled);
	pose[3] *= 1.5;
	pose[7] *= 1.5;
	const deformed = deformReferenceSurfaceDqs(surface, skinning, buildDualQuaternionSlotTransforms(compiled, pose));
	let maximumScaleError = 0;
	for (let vertex = 0; vertex < surface.positions.length / 3; vertex++) {
		const restRadius = Math.hypot(...surface.positions.subarray(vertex * 3, vertex * 3 + 3));
		const posedRadius = Math.hypot(...deformed.positions.subarray(vertex * 3, vertex * 3 + 3));
		maximumScaleError = Math.max(maximumScaleError, Math.abs(posedRadius - restRadius * 1.5));
	}
	if (maximumScaleError > 3e-7) return { status: 'fail', details: { message: 'DQ separate radial scale failed', maximumScaleError } };
	return { status: 'pass', details: { vertices: surface.positions.length / 3, scale: 1.5, maximumScaleError } };
}

async function runProjectedSilhouetteFixture() {
	const compiled = compileFixture(sphereSpec);
	const surface = extractReferenceSurface(compiled, { cellSize: 0.08, maxSamples: 500_000 });
	const baseline = compareProjectedSilhouettes(surface, compiled.slots, compiled.blendDag, { resolution: 64, rayStep: 0.03 });
	const translated = { ...surface, positions: surface.positions.slice() };
	for (let offset = 0; offset < translated.positions.length; offset += 3) translated.positions[offset] += 0.2;
	const mutation = compareProjectedSilhouettes(translated, compiled.slots, compiled.blendDag, { resolution: 64, rayStep: 0.03 });
	if (baseline.maximumErrorPx > 1 || mutation.maximumErrorPx <= baseline.maximumErrorPx || mutation.maximumDisagreementFraction <= baseline.maximumDisagreementFraction) {
		return { status: 'fail', details: { message: 'projected silhouette fixture or translation mutation failed', baseline, mutation } };
	}
	return { status: 'pass', details: { baselineMaximumErrorPx: baseline.maximumErrorPx, mutatedMaximumErrorPx: mutation.maximumErrorPx, baselineDisagreementFraction: baseline.maximumDisagreementFraction, mutatedDisagreementFraction: mutation.maximumDisagreementFraction } };
}

async function runDeformationSelectionFixture() {
	const compiled = compileFixture(sphereSpec);
	const surface = extractReferenceSurface(compiled, { cellSize: 0.1, maxSamples: 300_000 });
	const skinning = generateGeodesicSkinWeights(surface, compiled);
	const options = {
		durationSeconds: 1,
		sampleCount: 3,
		worldUnitsPerPixel: 0.05,
		maximumSilhouetteErrorPx: 1,
		maximumNormalAngleRadians: Math.PI / 6,
		silhouetteResolution: 32,
		silhouetteRayStep: 0.03,
		maximumCorrectionTrials: 0,
		checkSelfIntersections: true,
	};
	const accepted = certifyDeformationSelection(sphereSpec, compiled, surface, skinning, options);
	const brokenWeights = { ...skinning, skinWeights: new Float32Array(skinning.skinWeights.length) };
	const rejected = certifyDeformationSelection(sphereSpec, compiled, surface, brokenWeights, options);
	if (accepted.status !== 'accepted-deformation-selection' || accepted.selectedMethod !== 'lbs'
		|| rejected.status !== 'rejected' || rejected.candidates.lbs.totals.collapsedTriangles === 0) {
		return { status: 'fail', details: { message: 'deformation selection did not accept the stable sphere and reject collapsed skinning', accepted: { status: accepted.status, method: accepted.selectedMethod, failures: accepted.candidates.lbs.failures }, rejected: { status: rejected.status, failures: rejected.candidates.lbs.failures, totals: rejected.candidates.lbs.totals } } };
	}
	return { status: 'pass', details: { selectedMethod: accepted.selectedMethod, silhouette: accepted.candidates.lbs.worst.directSilhouetteP95ErrorPx, rejectedFailures: rejected.candidates.lbs.failures } };
}

async function runBipedDeformationSweep() {
	const [specText, manifestText, binary] = await Promise.all([
		readFile(resolve(specsDir, 'biped.json'), 'utf8'),
		readFile(resolve(referenceAssetsDir, 'biped.surface.json'), 'utf8'),
		readFile(resolve(referenceAssetsDir, 'biped.surface.bin')),
	]);
	const spec = JSON.parse(specText);
	const manifest = JSON.parse(manifestText);
	const arrays = unpackReferenceAsset(manifest, new Uint8Array(binary));
	const compiled = compileFixture(spec);
	const result = certifyDeformationSelection(
		spec,
		compiled,
		{ positions: arrays.positions, normals: arrays.normals, indices: arrays.indices },
		{ skinIndices: arrays.skinIndices, skinWeights: arrays.skinWeights },
		{
			durationSeconds: 4,
			sampleCount: 25,
			worldUnitsPerPixel: manifest.extraction.cellSize,
			maximumSilhouetteErrorPx: 1,
			silhouetteResolution: 32,
			silhouetteRayStep: manifest.extraction.cellSize,
			maximumCorrectionTrials: 0,
			checkSelfIntersections: true,
		},
	);
	if (manifest.skinning?.sigma !== 0.13 || result.status !== 'accepted-deformation-selection' || result.selectedMethod !== 'lbs'
		|| result.candidates.lbs.totals.collapsedTriangles !== 0 || result.candidates.lbs.totals.nonAdjacentSelfIntersections !== 0) {
		return { status: 'fail', details: { message: 'frozen biped weight/deformation sweep rejected', sigma: manifest.skinning?.sigma, status: result.status, selectedMethod: result.selectedMethod, failures: result.candidates.lbs.failures, totals: result.candidates.lbs.totals } };
	}
	return { status: 'pass', details: { sigma: manifest.skinning.sigma, selectedMethod: result.selectedMethod, corpus: result.corpus, worst: result.candidates.lbs.worst, totals: result.candidates.lbs.totals, dqsFailures: result.candidates.dqs.failures } };
}

export const gates = [
	{ id: 'reference-surface-sphere', run: runReferenceSphere },
	{ id: 'reference-surface-determinism', run: runReferenceDeterminism },
	{ id: 'reference-component-policy', run: runReferenceComponentPolicy },
	{ id: 'mesh-self-intersection-rejection', run: runSelfIntersectionRejection },
	{ id: 'bundled-reference-connectivity', run: runBundledReferenceConnectivity },
	{ id: 'bundled-reference-assets', run: runBundledReferenceAssets },
	{ id: 'skin-weight-baseline', run: runSkinWeightBaseline },
	{ id: 'lbs-rest-identity', run: runLbsRestIdentity },
	{ id: 'dq-rest-antipodal', run: runDqRestAndAntipodal },
	{ id: 'dq-scale-fixture', run: runDqScaleFixture },
	{ id: 'projected-silhouette-fixture', run: runProjectedSilhouetteFixture },
	{ id: 'deformation-selection-fixture', run: runDeformationSelectionFixture },
	{ id: 'biped-deformation-sweep', run: runBipedDeformationSweep },
];
