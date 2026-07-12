export const PERFORMANCE_PROFILE_VERSION = 'creature-performance-profile-v1';
export const PERFORMANCE_RESULT_VERSION = 1;
export const PERFORMANCE_SEED = 0x9e3779b9;

const common = Object.freeze({
	viewport: Object.freeze({ width: 1200, height: 834, dpr: 1 }),
	seed: PERFORMANCE_SEED,
	refreshHz: 60,
	frameDeadlineMs: 1000 / 60,
	allowedMissRate: 0.05,
	warmupFrames: 120,
	sampleFrames: 600,
	marginalBlocks: 10,
	marginalFramesPerBlock: 60,
	sustainedDurationMs: 60_000,
	requiredBackend: 'WebGPUBackend',
	requiredFeature: 'timestamp-query',
});

export const PERFORMANCE_PROFILES = Object.freeze({
	'hero-60hz': Object.freeze({
		...common,
		id: 'hero-60hz', tier: 'hero', population: 4, sampleCount: 4,
		outlineMode: 'shared-normal-depth-edge', shadowMapSize: 2048,
		ownedGpuResidencyLimitBytes: 256 * 1024 * 1024,
		representation: 'canonical-reference-surface',
	}),
	'crowd-60hz': Object.freeze({
		...common,
		id: 'crowd-60hz', tier: 'crowd', population: 64, sampleCount: 1,
		outlineMode: 'shared-normal-depth-edge', shadowMapSize: 1024,
		ownedGpuResidencyLimitBytes: 192 * 1024 * 1024,
		representation: 'canonical-reference-surface',
	}),
	'background-60hz': Object.freeze({
		...common,
		id: 'background-60hz', tier: 'background', population: 96, sampleCount: 1,
		outlineMode: 'none', shadowMapSize: 512,
		ownedGpuResidencyLimitBytes: 128 * 1024 * 1024,
		representation: 'canonical-reference-surface',
	}),
});

export function performanceProfile(profileId) {
	const profile = PERFORMANCE_PROFILES[profileId];
	if (!profile) throw new Error(`unknown promotable creature performance profile '${profileId}'`);
	return profile;
}

function metricValue(metric, key) {
	const value = metric?.[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nearestRank(samples, q) {
	if (!Array.isArray(samples) || samples.length === 0 || samples.some((value) => !Number.isFinite(value))) return null;
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}

function metricMatchesRaw(metric, samples) {
	const expected = nearestRank(samples, 0.95);
	const actual = metricValue(metric, 'p95');
	return expected !== null && actual !== null && Math.abs(expected - actual) <= 1e-6;
}

export function evaluatePerformanceResult(result) {
	const failures = [];
	let profile;
	try {
		profile = performanceProfile(result?.profileId);
	} catch (error) {
		return { verdict: 'INSUFFICIENT_EVIDENCE', failures: [error.message] };
	}
	if (result?.schemaVersion !== PERFORMANCE_RESULT_VERSION) failures.push('performance result schema mismatch');
	if (result?.performanceProfileVersion !== PERFORMANCE_PROFILE_VERSION) failures.push('performance profile version mismatch');
	if (result?.target?.refreshHz !== profile.refreshHz || result?.target?.frameDeadlineMs !== profile.frameDeadlineMs || result?.target?.allowedMissRate !== profile.allowedMissRate) failures.push('frame target contract drifted');
	if (result?.environment?.isWebGPUBackend !== true) failures.push('native WebGPU backend is not proven');
	if (result?.environment?.trackTimestamp !== true) failures.push('trackTimestamp was not enabled before renderer initialization');
	if (result?.environment?.timestampQuery !== true) failures.push('timestamp-query is unavailable');
	if (!result?.environment?.adapter) failures.push('named adapter identity is unavailable');
	if (result?.environment?.deviceLoss) failures.push('WebGPU device loss occurred');
	if ((result?.environment?.uncapturedErrors?.length ?? 0) > 0) failures.push('uncaptured WebGPU errors occurred');
	const workload = result?.workload;
	if (workload?.tier !== profile.tier) failures.push('tier drifted from the frozen profile');
	if (workload?.population !== profile.population) failures.push('population drifted from the frozen profile');
	if (workload?.seed !== profile.seed) failures.push('seed drifted from the frozen profile');
	if (workload?.viewport?.width !== profile.viewport.width || workload?.viewport?.height !== profile.viewport.height || workload?.viewport?.dpr !== profile.viewport.dpr) failures.push('viewport or DPR drifted from the frozen profile');
	if (workload?.sampleCount !== profile.sampleCount) failures.push('sample count drifted from the frozen profile');
	if (workload?.shadowMapSize !== profile.shadowMapSize) failures.push('shadow-map size drifted from the frozen profile');
	if (workload?.outlineMode !== profile.outlineMode) failures.push('outline mode drifted from the frozen profile');
	if (workload?.representation !== profile.representation) failures.push('canonical reference-surface representation is not active');
	if (!Array.isArray(workload?.topologySignatures) || workload.topologySignatures.length !== 6 || workload.topologySignatures.some((value) => typeof value !== 'string' || value.length === 0)) failures.push('six stable topology signatures are not recorded');
	if (!Array.isArray(workload?.geometryDigests) || workload.geometryDigests.length !== 6 || workload.geometryDigests.some((value) => typeof value !== 'string' || value.length === 0)) failures.push('six geometry digests are not recorded');
	if (result?.sampling?.warmupFrames !== profile.warmupFrames || result?.sampling?.sampleFrames !== profile.sampleFrames) failures.push('warm-up or sample count drifted');
	if (result?.sampling?.marginalBlocks !== profile.marginalBlocks || result?.sampling?.marginalFramesPerBlock !== profile.marginalFramesPerBlock) failures.push('marginal block contract drifted');
	if (result?.sampling?.sustainedDurationMs !== profile.sustainedDurationMs || result?.sampling?.quantile !== 'nearest-rank') failures.push('sustained presentation or quantile contract drifted');
	for (const key of ['simulation', 'storageAndCulling', 'renderSubmission', 'total']) {
		if (result?.rawSamples?.cpu?.[key]?.length !== profile.sampleFrames) failures.push(`${key} CPU sample count is incomplete`);
		else if (!metricMatchesRaw(result?.cpu?.[key], result.rawSamples.cpu[key])) failures.push(`${key} CPU p95 does not match raw samples`);
	}
	if (result?.gpu?.timestampSampleCount !== profile.sampleFrames || result?.rawSamples?.gpuRenderMs?.length !== profile.sampleFrames) failures.push('GPU timestamp sample count is incomplete');
	else if (!metricMatchesRaw(result?.gpu?.render, result.rawSamples.gpuRenderMs)) failures.push('GPU p95 does not match raw timestamp samples');
	const marginalBlocks = result?.gpu?.marginalBlocks;
	if (!Array.isArray(marginalBlocks) || marginalBlocks.length !== profile.marginalBlocks
		|| marginalBlocks.some((block, index) => block?.block !== index || block?.creaturesEnabled !== (index % 2 === 1)
			|| block?.raw?.length !== profile.marginalFramesPerBlock || !metricMatchesRaw(block?.gpuRender, block.raw))) {
		failures.push('alternating marginal GPU blocks are incomplete or inconsistent');
	}
	if ((result?.rawSamples?.pausedPresentationMs?.length ?? 0) < 90) failures.push('paused presentation baseline is too short');
	if ((result?.rawSamples?.activePresentationMs?.length ?? 0) < 3000) failures.push('active presentation sample is too short for 60 seconds at 60 Hz');
	const gpuP95 = metricValue(result?.gpu?.render, 'p95');
	const cpuP95 = metricValue(result?.cpu?.total, 'p95');
	const pausedP95 = metricValue(result?.presentation?.pausedBaseline, 'p95');
	const activeP95 = metricValue(result?.presentation?.active, 'p95');
	if (!(gpuP95 > 0 && gpuP95 <= profile.frameDeadlineMs)) failures.push('GPU render p95 is missing, zero, or over budget');
	if (!(cpuP95 >= 0 && cpuP95 <= profile.frameDeadlineMs)) failures.push('CPU frame-work p95 is missing or over budget');
	if (!(pausedP95 > 0 && pausedP95 <= profile.frameDeadlineMs)) failures.push('paused host cadence cannot prove the 60 Hz environment');
	if (!(activeP95 > 0 && activeP95 <= profile.frameDeadlineMs)) failures.push('active presentation p95 is missing or over budget');
	if (!metricMatchesRaw(result?.presentation?.pausedBaseline, result?.rawSamples?.pausedPresentationMs)) failures.push('paused presentation p95 does not match raw intervals');
	if (!metricMatchesRaw(result?.presentation?.active, result?.rawSamples?.activePresentationMs)) failures.push('active presentation p95 does not match raw intervals');
	if (!(Number.isFinite(result?.presentation?.missRate) && result.presentation.missRate <= profile.allowedMissRate)) failures.push('deadline-miss rate is missing or over budget');
	if (result?.resources?.postRevealPipelineCompiles !== 0) failures.push('post-reveal pipeline creation occurred');
	if (result?.resources?.steadyStateBufferCreates !== 0) failures.push('steady-state GPU-buffer creation occurred');
	if (!(Number.isFinite(result?.resources?.ownedGpuBytes) && result.resources.ownedGpuBytes <= profile.ownedGpuResidencyLimitBytes)) failures.push('owned GPU residency is missing or over budget');
	if (result?.quality?.settled !== true || (result?.quality?.transitions?.length ?? 0) !== 0) failures.push('quality state did not remain settled');
	return { verdict: failures.length === 0 ? 'PASS' : 'INSUFFICIENT_EVIDENCE', failures };
}
