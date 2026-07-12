import { compileSpec } from '../../core/rig-compiler.js';
import { extractReferenceSurface } from '../../core/reference-surface.js';
import { packReferenceAsset, unpackReferenceAsset } from '../../core/reference-asset-format.js';

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
	const surface = extractReferenceSurface(compileFixture(sphereSpec), { cellSize: 0.12, maxSamples: 200_000 });
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
	return {
		status: 'pass',
		details: {
			vertices: topology.vertexCount,
			triangles: topology.triangleCount,
			maximumVertexResidual: surface.certification.meshToFieldVertexResidual.maximum,
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

export const gates = [
	{ id: 'reference-surface-sphere', run: runReferenceSphere },
	{ id: 'reference-surface-determinism', run: runReferenceDeterminism },
	{ id: 'reference-component-policy', run: runReferenceComponentPolicy },
];
