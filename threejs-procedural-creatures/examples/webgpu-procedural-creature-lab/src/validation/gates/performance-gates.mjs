import {
	evaluatePerformanceResult,
	PERFORMANCE_PROFILE_VERSION,
	PERFORMANCE_PROFILES,
	PERFORMANCE_SEED,
} from '../../lab/performance-profiles.js';

const six = Array.from({ length: 6 }, (_, index) => `digest-${index}`);

function metric(value, count) {
	return { count, min: value, p50: value, p95: value, max: value, mean: value };
}

function passingFixture(profileId = 'hero-60hz') {
	const profile = PERFORMANCE_PROFILES[profileId];
	const cpuRaw = Array(profile.sampleFrames).fill(1);
	const gpuRaw = Array(profile.sampleFrames).fill(5);
	const pausedRaw = Array(120).fill(16);
	const activeRaw = Array(3600).fill(16);
	return {
		schemaVersion: 1,
		performanceProfileVersion: PERFORMANCE_PROFILE_VERSION,
		profileId,
		environment: {
			adapter: { vendor: 'fixture-vendor', architecture: 'fixture-architecture' },
			isWebGPUBackend: true,
			trackTimestamp: true,
			timestampQuery: true,
			deviceLoss: null,
			uncapturedErrors: [],
		},
		target: { refreshHz: 60, frameDeadlineMs: profile.frameDeadlineMs, allowedMissRate: profile.allowedMissRate },
		workload: {
			tier: profile.tier,
			population: profile.population,
			seed: PERFORMANCE_SEED,
			viewport: { ...profile.viewport },
			sampleCount: profile.sampleCount,
			shadowMapSize: profile.shadowMapSize,
			outlineMode: profile.outlineMode,
			representation: profile.representation,
			topologySignatures: [...six],
			geometryDigests: [...six],
		},
		sampling: {
			warmupFrames: profile.warmupFrames,
			sampleFrames: profile.sampleFrames,
			marginalBlocks: profile.marginalBlocks,
			marginalFramesPerBlock: profile.marginalFramesPerBlock,
			sustainedDurationMs: profile.sustainedDurationMs,
			quantile: 'nearest-rank',
		},
		cpu: {
			simulation: metric(1, profile.sampleFrames),
			storageAndCulling: metric(1, profile.sampleFrames),
			renderSubmission: metric(1, profile.sampleFrames),
			total: metric(1, profile.sampleFrames),
		},
		gpu: {
			render: metric(5, profile.sampleFrames),
			timestampSampleCount: profile.sampleFrames,
			marginalBlocks: Array.from({ length: profile.marginalBlocks }, (_, block) => ({
				block,
				creaturesEnabled: block % 2 === 1,
				gpuRender: metric(5, profile.marginalFramesPerBlock),
				raw: Array(profile.marginalFramesPerBlock).fill(5),
			})),
		},
		presentation: {
			pausedBaseline: metric(16, pausedRaw.length),
			active: metric(16, activeRaw.length),
			deadlineMisses: 0,
			missRate: 0,
		},
		resources: {
			ownedGpuBytes: 64 * 1024 * 1024,
			postRevealPipelineCompiles: 0,
			steadyStateBufferCreates: 0,
		},
		quality: { selectedTier: profile.tier, transitions: [], settled: true },
		rawSamples: {
			cpu: {
				simulation: [...cpuRaw],
				storageAndCulling: [...cpuRaw],
				renderSubmission: [...cpuRaw],
				total: [...cpuRaw],
			},
			gpuRenderMs: gpuRaw,
			pausedPresentationMs: pausedRaw,
			activePresentationMs: activeRaw,
		},
	};
}

async function runPerformanceProfileContract() {
	const expected = {
		'hero-60hz': ['hero', 4, 4, 'shared-normal-depth-edge', 2048, 256],
		'crowd-60hz': ['crowd', 64, 1, 'shared-normal-depth-edge', 1024, 192],
		'background-60hz': ['background', 96, 1, 'none', 512, 128],
	};
	for (const [id, values] of Object.entries(expected)) {
		const profile = PERFORMANCE_PROFILES[id];
		const actual = [profile?.tier, profile?.population, profile?.sampleCount, profile?.outlineMode, profile?.shadowMapSize, profile?.ownedGpuResidencyLimitBytes / 1024 / 1024];
		if (JSON.stringify(actual) !== JSON.stringify(values)) return { status: 'fail', details: { message: `${id} drifted`, expected: values, actual } };
		if (profile.viewport.width !== 1200 || profile.viewport.height !== 834 || profile.viewport.dpr !== 1
			|| profile.seed !== PERFORMANCE_SEED || profile.warmupFrames !== 120 || profile.sampleFrames !== 600
			|| profile.marginalBlocks !== 10 || profile.marginalFramesPerBlock !== 60 || profile.sustainedDurationMs !== 60_000) {
			return { status: 'fail', details: { message: `${id} common measurement contract drifted` } };
		}
		const verdict = evaluatePerformanceResult(passingFixture(id));
		if (verdict.verdict !== 'PASS') return { status: 'fail', details: { message: `${id} valid fixture was rejected`, failures: verdict.failures } };
	}
	return { status: 'pass', details: { profiles: Object.keys(expected), seed: PERFORMANCE_SEED } };
}

async function runPerformanceNegativeControls() {
	const controls = [
		['profile version', (x) => { x.performanceProfileVersion = 'stale'; }],
		['backend', (x) => { x.environment.isWebGPUBackend = false; }],
		['timestamp tracking', (x) => { x.environment.trackTimestamp = false; }],
		['timestamp feature', (x) => { x.environment.timestampQuery = false; }],
		['adapter identity', (x) => { x.environment.adapter = null; }],
		['device loss', (x) => { x.environment.deviceLoss = { reason: 'unknown' }; }],
		['GPU error', (x) => { x.environment.uncapturedErrors.push({ message: 'fixture error' }); }],
		['population', (x) => { x.workload.population += 1; }],
		['viewport', (x) => { x.workload.viewport.width += 1; }],
		['sample count', (x) => { x.workload.sampleCount = 1; }],
		['outline graph', (x) => { x.workload.outlineMode = 'none'; }],
		['representation', (x) => { x.workload.representation = 'diagnostic-owner-masked-shell'; }],
		['topology inventory', (x) => { x.workload.topologySignatures.pop(); }],
		['warm-up', (x) => { x.sampling.warmupFrames = 119; }],
		['CPU sample count', (x) => { x.rawSamples.cpu.total.pop(); }],
		['CPU raw metric', (x) => { x.cpu.total.p95 = 2; }],
		['GPU sample count', (x) => { x.gpu.timestampSampleCount = 599; }],
		['GPU zero proxy', (x) => { x.gpu.render.p95 = 0; }],
		['marginal alternation', (x) => { x.gpu.marginalBlocks[0].creaturesEnabled = true; }],
		['paused 30 Hz host', (x) => { x.presentation.pausedBaseline.p95 = 33.3; x.rawSamples.pausedPresentationMs.fill(33.3); }],
		['active 30 Hz host', (x) => { x.presentation.active.p95 = 33.3; x.rawSamples.activePresentationMs.fill(33.3); }],
		['deadline misses', (x) => { x.presentation.missRate = 0.06; }],
		['late pipeline', (x) => { x.resources.postRevealPipelineCompiles = 1; }],
		['steady allocation', (x) => { x.resources.steadyStateBufferCreates = 1; }],
		['residency', (x) => { x.resources.ownedGpuBytes = 300 * 1024 * 1024; }],
		['quality transition', (x) => { x.quality.transitions.push({ from: 'hero', to: 'crowd' }); }],
	];
	for (const [name, mutate] of controls) {
		const fixture = passingFixture();
		mutate(fixture);
		const verdict = evaluatePerformanceResult(fixture);
		if (verdict.verdict !== 'INSUFFICIENT_EVIDENCE' || verdict.failures.length === 0) {
			return { status: 'fail', details: { message: `negative control passed: ${name}`, verdict } };
		}
	}
	return { status: 'pass', details: { rejectedMutations: controls.map(([name]) => name) } };
}

export const gates = [
	{ id: 'performance-profile-contract', run: runPerformanceProfileContract },
	{ id: 'performance-negative-controls', run: runPerformanceNegativeControls },
];
