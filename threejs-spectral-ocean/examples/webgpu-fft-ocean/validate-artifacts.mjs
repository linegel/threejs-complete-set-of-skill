import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT, buildDemoRegistry } from '../../../scripts/lib/lab-registry.mjs';

const labId = 'webgpu-fft-ocean';
const artifactDir = resolve(
	process.env.LAB_ARTIFACT_DIR ?? resolve(REPO_ROOT, 'artifacts', 'visual-validation', labId, 'correctness')
);
const registry = buildDemoRegistry();
const lab = registry.demos.find((entry) => entry.id === labId);
if (!lab) throw new Error(`${labId} is absent from the demo registry.`);

const requiredImages = [
	'final.design.png',
	'no-post.design.png',
	'diagnostics.mosaic.png',
	'camera.near.png',
	'camera.design.png',
	'camera.far.png',
	'seed-0001.final.png',
	'seed-9e3779b9.final.png',
	'temporal.t000.png',
	'temporal.t001.png',
];
const requiredJson = [
	'capture-session.json',
	'evidence-manifest.json',
	'renderer-info.json',
	'mechanism-metrics.json',
	'pipeline-graph.json',
];

function sha256(path) {
	return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function pngDimensions(bytes) {
	if (bytes.byteLength < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') throw new Error('not a PNG');
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const errors = [];
for (const name of requiredJson) {
	if (!existsSync(resolve(artifactDir, name))) errors.push(`missing ${name}`);
}
const imageHashes = {};
for (const name of requiredImages) {
	const path = resolve(artifactDir, name);
	if (!existsSync(path)) {
		errors.push(`missing ${name}`);
		continue;
	}
	try {
		const dims = pngDimensions(readFileSync(path));
		if (dims.width !== 1200 || dims.height !== 800) {
			errors.push(`${name} must be 1200x800; received ${dims.width}x${dims.height}`);
		}
		imageHashes[name] = sha256(path);
	} catch (error) {
		errors.push(`${name}: ${error.message}`);
	}
}

if (imageHashes['final.design.png'] && imageHashes['diagnostics.mosaic.png']
	&& imageHashes['final.design.png'] === imageHashes['diagnostics.mosaic.png']) {
	errors.push('final.design.png and diagnostics.mosaic.png are falsely identical');
}
if (imageHashes['seed-0001.final.png'] && imageHashes['seed-9e3779b9.final.png']
	&& imageHashes['seed-0001.final.png'] === imageHashes['seed-9e3779b9.final.png']) {
	errors.push('seed variants are falsely identical');
}

let evidence = null;
let session = null;
let renderer = null;
let metrics = null;
try {
	evidence = JSON.parse(readFileSync(resolve(artifactDir, 'evidence-manifest.json'), 'utf8'));
	session = JSON.parse(readFileSync(resolve(artifactDir, 'capture-session.json'), 'utf8'));
	renderer = JSON.parse(readFileSync(resolve(artifactDir, 'renderer-info.json'), 'utf8'));
	metrics = JSON.parse(readFileSync(resolve(artifactDir, 'mechanism-metrics.json'), 'utf8'));
} catch (error) {
	errors.push(`json parse failure: ${error.message}`);
}

if (evidence) {
	if (evidence.labId !== labId) errors.push(`evidence labId ${evidence.labId} does not match ${labId}`);
	if (evidence.sourceHash !== lab.sourceHash) {
		errors.push(`evidence sourceHash ${evidence.sourceHash ?? '(missing)'} does not match registry ${lab.sourceHash}`);
	}
	if (evidence.schemaVersion !== 2) errors.push('evidence-manifest schemaVersion must be 2');
}
if (session) {
	if (session.labId !== labId) errors.push(`capture-session labId mismatch`);
	const webgpu = session.runtime?.metrics?.nativeWebGPU === true
		|| session.runtime?.metrics?.isWebGPUBackend === true
		|| session.runtime?.metrics?.backendIsWebGPU === true
		|| session.runtime?.metrics?.backend === 'WebGPU'
		|| session.runtime?.metrics?.backend === 'webgpu';
	if (!webgpu) errors.push('capture-session lacks native WebGPU proof');
}
if (renderer && renderer.backendIsWebGPU !== true && renderer.isWebGPUBackend !== true && renderer.nativeWebGPU !== true) {
	errors.push('renderer-info.json does not prove native WebGPU');
}
if (metrics && metrics.gpuReadback?.pass !== true) {
	errors.push('mechanism-metrics.json gpuReadback.pass is not true');
}

// Correctness claims that this capture can honestly settle must PASS.
// Timing and lifecycle remain residual incomplete without failing the gate.
if (evidence?.claimVerdicts) {
	if (evidence.claimVerdicts.visualCorrectness !== 'PASS') {
		errors.push(`visualCorrectness must be PASS; got ${evidence.claimVerdicts.visualCorrectness}`);
	}
	if (evidence.claimVerdicts.mechanismCorrectness !== 'PASS') {
		errors.push(`mechanismCorrectness must be PASS; got ${evidence.claimVerdicts.mechanismCorrectness}`);
	}
	for (const residual of ['performanceCompliance', 'gpuAttribution', 'lifecycleStability']) {
		const verdict = evidence.claimVerdicts[residual];
		if (verdict === 'PASS') continue;
		if (verdict !== 'INSUFFICIENT_EVIDENCE' && verdict !== 'NOT_CLAIMED') {
			errors.push(`${residual} has unexpected verdict ${verdict}`);
		}
	}
}

if (errors.length > 0) {
	console.error(JSON.stringify({
		pass: false,
		verdict: 'INSUFFICIENT_EVIDENCE',
		labId,
		artifactDir,
		expectedSourceHash: lab.sourceHash,
		errors
	}, null, 2));
	process.exitCode = 1;
} else {
	console.log(JSON.stringify({
		pass: true,
		verdict: 'PASS',
		acceptanceStatus: lab.status,
		labId,
		artifactDir,
		sourceHash: lab.sourceHash,
		imageHashes,
		residuals: ['performanceCompliance', 'gpuAttribution', 'lifecycleStability']
	}, null, 2));
}
