import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	defaultArtifactDir,
	loadArtifacts,
	parityDerivationIsValid,
	validateManifestArtifacts,
} from '../validate-lab-artifacts.mjs';

function missing(relativePath) {
	return {
		status: 'skipped',
		details: {
			reason: `missing artifact ${relativePath}`,
			path: resolve(defaultArtifactDir, relativePath),
		},
	};
}

function requireFile(relativePath) {
	return existsSync(resolve(defaultArtifactDir, relativePath)) ? null : missing(relativePath);
}

function pass(details = {}) {
	return { status: 'pass', details };
}

function fail(message, details = {}) {
	return { status: 'fail', details: { message, ...details } };
}

async function runArtifactManifest() {
	const skipped = requireFile('manifest.json') ?? requireFile('manifest.schema.json');
	if (skipped) return skipped;
	const result = await validateManifestArtifacts(defaultArtifactDir, { checkFiles: false });
	if (result.status !== 'pass') {
		return fail('artifact manifest is missing required WebGPU evidence', {
			summary: result.summary,
			failures: result.gates.filter((gate) => gate.status === 'fail'),
		});
	}
	return pass(result.summary);
}

async function runShadowSilhouetteParity() {
	const skipped = requireFile('silhouette.json') ?? requireFile('lab-snapshot.json');
	if (skipped) return skipped;
	const artifacts = await loadArtifacts();
	const shadowParity = artifacts.snapshot?.shadowParity ?? artifacts.manifest?.labSnapshot?.shadowParity;
	const allEqual = Array.isArray(shadowParity) && shadowParity.every((entry) => entry.allEqual === true);
	const diffOk = artifacts.silhouette?.diffTexels <= artifacts.silhouette?.derivedBudgetTexels;
	if (!diffOk || !allEqual) {
		return fail('shadow/silhouette parity exceeded derived budget or node identity parity failed', {
			diffTexels: artifacts.silhouette?.diffTexels,
			derivedBudgetTexels: artifacts.silhouette?.derivedBudgetTexels,
			shadowParity,
		});
	}
	return pass({
		diffTexels: artifacts.silhouette.diffTexels,
		derivedBudgetTexels: artifacts.silhouette.derivedBudgetTexels,
		derivation: artifacts.silhouette.derivation,
	});
}

async function runBrowserDeterminism() {
	const skipped = requireFile('determinism.json');
	if (skipped) return skipped;
	const { determinism } = await loadArtifacts();
	if (determinism?.byteEqual !== true || determinism?.pngHashEqual !== true) {
		return fail('browser reload determinism failed', {
			byteEqual: determinism?.byteEqual,
			pngHashEqual: determinism?.pngHashEqual,
			poseHashA: determinism?.poseHashA,
			poseHashB: determinism?.poseHashB,
			pngHashA: determinism?.pngHashA,
			pngHashB: determinism?.pngHashB,
		});
	}
	return pass({
		byteEqual: determinism.byteEqual,
		pngHashEqual: determinism.pngHashEqual,
		pngHash: determinism.pngHashA,
	});
}

async function runPipelinesAfterReveal() {
	const skipped = requireFile('boot.json');
	if (skipped) return skipped;
	const { boot } = await loadArtifacts();
	if (boot?.pipelinesAfterReveal !== 0) return fail('post-reveal steady frames created render pipelines', { value: boot?.pipelinesAfterReveal });
	return pass({ value: boot.pipelinesAfterReveal });
}

async function runBufferReallocsAfterInit() {
	const skipped = requireFile('boot.json');
	if (skipped) return skipped;
	const { boot } = await loadArtifacts();
	if (boot?.buffersAfterInitDelta !== 0) return fail('steady frames created GPU buffers after reveal/init', { value: boot?.buffersAfterInitDelta });
	return pass({ value: boot.buffersAfterInitDelta });
}

async function runSpawnCost() {
	const skipped = requireFile('boot.json');
	if (skipped) return skipped;
	const { boot } = await loadArtifacts();
	const medianMs = boot?.spawnCostSample?.medianMs;
	if (!(typeof medianMs === 'number' && medianMs <= 0.25)) {
		return fail('spawn cost exceeded 0.25 ms median', { medianMs, machine: boot?.machine });
	}
	return pass({ medianMs, thresholdMs: 0.25, machine: boot.machine });
}

async function runFirstFrameRatio() {
	const skipped = requireFile('boot.json');
	if (skipped) return skipped;
	const { boot } = await loadArtifacts();
	const ratio = boot?.firstFrameRatio;
	if (!(typeof ratio === 'number' && ratio <= 1.5)) return fail('first frame exceeded 1.5x steady median', { ratio });
	return pass({ ratio, threshold: 1.5, firstFrameMs: boot.firstFrameMs, steadyFrameMs: boot.steadyFrameMs });
}

async function runCpuTslFieldParity() {
	const skipped = requireFile('parity.json');
	if (skipped) return skipped;
	const { parity } = await loadArtifacts();
	if (!parityDerivationIsValid(parity)) return fail('parity tolerance derivation fields are invalid', { parity });
	if (!(parity.maxAbsError <= parity.derivedTolerance)) {
		return fail('CPU/TSL field parity exceeded derived tolerance', {
			maxAbsError: parity.maxAbsError,
			tolerance: parity.derivedTolerance,
			derivation: parity.derivation,
		});
	}
	return pass({
		maxAbsError: parity.maxAbsError,
		tolerance: parity.derivedTolerance,
		derivation: parity.derivation,
	});
}

async function runWorldDriftEvidence() {
	const skipped = requireFile('drift.json');
	if (skipped) return skipped;
	const { drift } = await loadArtifacts();
	if (!(drift?.maxWorldDisplacement < 1e-4)) {
		return fail('world-space planted-foot drift exceeded threshold', {
			maxWorldDisplacement: drift?.maxWorldDisplacement,
			threshold: 1e-4,
		});
	}
	return pass({ maxWorldDisplacement: drift.maxWorldDisplacement, threshold: 1e-4, space: drift.space });
}

async function runLeakLoopFlat() {
	const skipped = requireFile('leak.json');
	if (skipped) return skipped;
	const { leak } = await loadArtifacts();
	const loops = leak?.loops;
	if (!Array.isArray(loops) || loops.length < 50) return fail('leak loop did not record at least 50 lifecycle cycles', { cycles: loops?.length ?? 0 });
	const first = loops[0].counters;
	const growing = loops.slice(1).filter((loop) => (
		loop.counters.createRenderPipeline !== first.createRenderPipeline
		|| loop.counters.createRenderPipelineAsync !== first.createRenderPipelineAsync
		|| loop.counters.createComputePipeline !== first.createComputePipeline
		|| loop.counters.createBuffer !== first.createBuffer
	));
	if (growing.length > 0) return fail('post-reveal counters grew during leak loop', { first, growing });
	return pass({ cycles: loops.length, counters: first, note: leak.note });
}

export const gates = [
	{ id: 'shadow-silhouette-parity', run: runShadowSilhouetteParity },
	{ id: 'browser-determinism', run: runBrowserDeterminism },
	{ id: 'pipelines-after-reveal', run: runPipelinesAfterReveal },
	{ id: 'buffer-reallocs-after-init', run: runBufferReallocsAfterInit },
	{ id: 'spawn-cost', run: runSpawnCost },
	{ id: 'first-frame-ratio', run: runFirstFrameRatio },
	{ id: 'cpu-tsl-field-parity', run: runCpuTslFieldParity },
	{ id: 'world-drift-evidence', run: runWorldDriftEvidence },
	{ id: 'leak-loop-flat', run: runLeakLoopFlat },
	{ id: 'artifact-manifest', run: runArtifactManifest },
];
