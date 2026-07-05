import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const labRoot = resolve(here, '../..');
const defaultArtifactDir = resolve(labRoot, 'artifacts');

const requiredImages = [
	'images/final.design.png',
	'images/no-post.design.png',
	'images/diagnostics.mosaic.png',
	'images/final.debug.off.png',
	'images/final.debug.unsnapped.png',
	'images/final.debug.distance.png',
	'images/final.debug.normals.png',
	'images/final.debug.weights.png',
	'images/tier-switcher.png',
	'images/silhouette-shadow-composite.png',
	'images/hop-apex.png',
	'images/seed-grid.png',
];

function gate(name, passed, details = {}) {
	return { name, status: passed ? 'pass' : 'fail', details };
}

async function readJson(path, fallback = null) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch {
		return fallback;
	}
}

function hasNumber(object, key) {
	return typeof object?.[key] === 'number' && Number.isFinite(object[key]);
}

export async function validateManifestArtifacts(artifactDirArg = defaultArtifactDir) {
	const base = resolve(artifactDirArg);
	const manifestPath = resolve(base, 'manifest.json');
	const metricsPath = resolve(base, 'metrics.json');
	const snapshotPath = resolve(base, 'lab-snapshot.json');
	const reports = [];

	const manifest = await readJson(manifestPath);
	reports.push(gate('manifest.exists', manifest !== null, { path: manifestPath }));
	if (!manifest) return summarize(reports, base);

	reports.push(gate('manifest.kind', manifest.kind === 'creature-lab-artifacts', { kind: manifest.kind }));
	reports.push(gate('manifest.images-listed', Array.isArray(manifest.images) && requiredImages.every((path) => manifest.images.includes(path)), { requiredImages }));

	for (const image of requiredImages) {
		reports.push(gate(`image:${image}`, existsSync(resolve(base, image)), { path: image }));
	}

	const metrics = await readJson(metricsPath, {});
	reports.push(gate('metrics.exists', Object.keys(metrics).length > 0, { path: metricsPath }));
	reports.push(gate('row13.shadow-silhouette', hasNumber(metrics, 'silhouetteDiffTexels') && metrics.silhouetteDiffTexels <= metrics.silhouetteDiffThresholdTexels, {
		value: metrics.silhouetteDiffTexels,
		threshold: metrics.silhouetteDiffThresholdTexels,
		sharedPositionNode: metrics.sharedPositionNode,
	}));
	reports.push(gate('row15.browser-determinism', metrics.deterministicPair === true && metrics.pngHashEqual === true && metrics.poseHashEqual === true, {
		deterministicPair: metrics.deterministicPair,
		pngHashEqual: metrics.pngHashEqual,
		poseHashEqual: metrics.poseHashEqual,
	}));
	reports.push(gate('row16.pipeline-compiles-after-reveal', metrics.pipelineCompilesAfterReveal === 0, { value: metrics.pipelineCompilesAfterReveal }));
	reports.push(gate('row17.buffer-reallocs-after-init', metrics.bufferReallocsAfterInit === 0, { value: metrics.bufferReallocsAfterInit }));
	reports.push(gate('row18.spawn-cost', hasNumber(metrics, 'spawnMedianMs') && metrics.spawnMedianMs <= 0.25, { value: metrics.spawnMedianMs, threshold: 0.25 }));
	reports.push(gate('row19.first-frame-ratio', hasNumber(metrics, 'firstFrameRatio') && metrics.firstFrameRatio <= 1.5, { value: metrics.firstFrameRatio, threshold: 1.5 }));
	reports.push(gate('cpu-tsl-field-parity-artifact', hasNumber(metrics, 'cpuTslMaxError') && metrics.cpuTslMaxError <= metrics.cpuTslTolerance, {
		value: metrics.cpuTslMaxError,
		threshold: metrics.cpuTslTolerance,
	}));
	reports.push(gate('world-drift-artifact', hasNumber(metrics, 'worldDriftMax') && metrics.worldDriftMax < 1e-4, { value: metrics.worldDriftMax, threshold: 1e-4 }));
	reports.push(gate('leak-loop-flat', metrics.leakLoopFlat === true, { leakLoopFlat: metrics.leakLoopFlat }));

	const snapshot = await readJson(snapshotPath, null);
	reports.push(gate('window-lab-snapshot', snapshot !== null && snapshot.ready === true && Array.isArray(snapshot.specs), { path: snapshotPath }));

	return summarize(reports, base, manifest, metrics);
}

function summarize(reports, base, manifest = null, metrics = null) {
	const failed = reports.filter((entry) => entry.status === 'fail');
	return {
		status: failed.length === 0 ? 'pass' : 'fail',
		summary: {
			total: reports.length,
			passed: reports.length - failed.length,
			failed: failed.length,
			path: base,
		},
		gates: reports,
		manifest,
		metrics,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const artifactArg = process.argv.includes('--artifact-dir')
		? process.argv[process.argv.indexOf('--artifact-dir') + 1]
		: defaultArtifactDir;
	const result = await validateManifestArtifacts(artifactArg);
	console.log(JSON.stringify(result, null, 2));
	if (result.status !== 'pass') process.exitCode = 1;
}
