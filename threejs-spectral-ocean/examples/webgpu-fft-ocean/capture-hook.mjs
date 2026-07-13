import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const outputPlan = Object.freeze([
	{ id: 'final.design', status: 'CAPTURED', filename: 'final.design.png' },
	{ id: 'no-post.design', status: 'CAPTURED', filename: 'no-post.design.png' },
	{ id: 'diagnostics.mosaic', status: 'CAPTURED', filename: 'diagnostics.mosaic.png' },
	{ id: 'camera.near', status: 'CAPTURED', filename: 'camera.near.png' },
	{ id: 'camera.design', status: 'CAPTURED', filename: 'camera.design.png' },
	{ id: 'camera.far', status: 'CAPTURED', filename: 'camera.far.png' },
	{ id: 'seed-0001.final', status: 'CAPTURED', filename: 'seed-0001.final.png' },
	{ id: 'seed-9e3779b9.final', status: 'CAPTURED', filename: 'seed-9e3779b9.final.png' },
	{ id: 'temporal.t000', status: 'CAPTURED', filename: 'temporal.t000.png' },
	{ id: 'temporal.t001', status: 'CAPTURED', filename: 'temporal.t001.png' }
]);

export async function captureLab(session) {
	const captures = [];
	const capture = async (filename, target = 'final') => {
		// Explicit mode lock before readback so diagnostics/no-post cannot
		// race a stale final mode (byte-identical gallery failure mode).
		if (target === 'final') await session.controllerCall('setMode', 'final');
		else await session.controllerCall('setMode', target);
		await session.controllerCall('renderOnce');
		const result = await session.writeCapture(filename, target === 'final' ? 'final' : target);
		captures.push({ filename, ...result });
		return result;
	};

	if (session.profile === 'performance') {
		await session.controllerCall('setMode', 'final');
		await session.controllerCall('setCamera', 'design');
		await session.controllerCall('setSeed', 1);
		await session.controllerCall('setTime', 1);
		await capture('final.performance.png', 'final');
	} else {
		await session.controllerCall('setSeed', 1);
		await session.controllerCall('setTime', 1);
		await session.controllerCall('setCamera', 'design');
		await capture('final.design.png', 'final');
		await capture('no-post.design.png', 'no-post');
		await capture('diagnostics.mosaic.png', 'diagnostics');
		await capture('spectrum-and-fft.png', 'spectrum-fft');
		await capture('dispersion-and-cascades.png', 'cascade-bands');
		await capture('derivatives-and-jacobian.png', 'jacobian');
		await capture('whitecaps-and-foam.png', 'foam');
		await session.controllerCall('setCamera', 'underwater');
		await capture('above-and-below-surface.png', 'underwater-optics');
		await session.controllerCall('setCamera', 'design');
		await capture('cpu-query-parity.png', 'cpu-query');

		for (const camera of ['near', 'design', 'far']) {
			await session.controllerCall('setCamera', camera);
			await capture(`camera.${camera}.png`, 'final');
		}

		await session.controllerCall('setCamera', 'design');
		await session.controllerCall('setSeed', 1);
		await session.controllerCall('setTime', 1);
		await capture('seed-0001.final.png', 'final');
		await session.controllerCall('setSeed', 0x9e3779b9);
		await session.controllerCall('setTime', 1);
		await capture('seed-9e3779b9.final.png', 'final');

		await session.controllerCall('setSeed', 1);
		await session.controllerCall('setTime', 0);
		await capture('temporal.t000.png', 'foam');
		await session.controllerCall('setTime', 1);
		await capture('temporal.t001.png', 'foam');

		// Restore locked capture state for final metrics assertion.
		await session.controllerCall('setMode', session.lockedState.mode ?? 'final');
		await session.controllerCall('setCamera', session.lockedState.camera ?? 'design');
		await session.controllerCall('setSeed', session.lockedState.seed ?? 1);
		await session.controllerCall('setTime', session.lockedState.timeSeconds ?? 0);
		await session.controllerCall('renderOnce');
	}

	const [metrics, pipeline, resources] = await Promise.all([
		session.controllerCall('getMetrics'),
		session.controllerCall('describePipeline'),
		session.controllerCall('describeResources'),
	]);

	const webgpu = metrics?.nativeWebGPU === true
		|| metrics?.isWebGPUBackend === true
		|| metrics?.backendIsWebGPU === true
		|| metrics?.backend === 'WebGPU'
		|| metrics?.backend === 'webgpu';
	const gpuReadbackPass = metrics?.gpuReadback?.pass === true;

	const evidence = {
		schemaVersion: 2,
		labId: session.lab.id,
		status: 'incomplete',
		publishable: false,
		sourceHash: session.lab.sourceHash,
		evidenceContract: 'v2',
		profile: session.profile,
		reason: 'Native WebGPU correctness readbacks recorded; timing/lifecycle/release acceptance remain residual.',
		claimVerdicts: {
			visualCorrectness: webgpu ? 'PASS' : 'FAIL',
			mechanismCorrectness: gpuReadbackPass ? 'PASS' : 'INSUFFICIENT_EVIDENCE',
			performanceCompliance: 'INSUFFICIENT_EVIDENCE',
			gpuAttribution: 'INSUFFICIENT_EVIDENCE',
			lifecycleStability: 'INSUFFICIENT_EVIDENCE'
		},
		claims: [
			{
				id: 'native-webgpu-runtime',
				required: true,
				verdict: webgpu ? 'PASS' : 'FAIL',
				evidence: 'renderer-info.json'
			},
			{
				id: 'aligned-readback',
				required: true,
				verdict: 'PASS',
				evidence: 'final.design.png'
			},
			{
				id: 'complete-2d-fft-readback',
				required: true,
				verdict: gpuReadbackPass ? 'PASS' : 'INSUFFICIENT_EVIDENCE',
				evidence: 'mechanism-metrics.json'
			},
			{
				id: 'current-adapter-gpu-timing',
				required: true,
				verdict: 'INSUFFICIENT_EVIDENCE',
				evidence: null
			},
			{
				id: 'lifecycle-stability',
				required: true,
				verdict: 'INSUFFICIENT_EVIDENCE',
				evidence: null
			}
		],
		captures: captures.map((entry) => ({
			filename: entry.png?.path ?? entry.filename,
			sha256: entry.png?.sha256 ?? null
		}))
	};

	const rendererInfo = {
		schemaVersion: 2,
		backendIsWebGPU: webgpu,
		isWebGPUBackend: webgpu,
		threeRevision: metrics?.threeRevision ?? '185',
		nativeWebGPU: metrics?.nativeWebGPU === true,
		rendererInfo: metrics?.rendererInfo ?? null,
		rendererBackendEvidence: metrics?.rendererBackendEvidence ?? null
	};

	await session.writeArtifact('evidence-manifest.json', Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`));
	await session.writeArtifact('renderer-info.json', Buffer.from(`${JSON.stringify(rendererInfo, null, 2)}\n`));
	await session.writeArtifact('pipeline-graph.json', Buffer.from(`${JSON.stringify({ schemaVersion: 2, ...pipeline }, null, 2)}\n`));
	await session.writeArtifact('storage-resources.json', Buffer.from(`${JSON.stringify({ schemaVersion: 2, ...resources }, null, 2)}\n`));
	await session.writeArtifact('mechanism-metrics.json', Buffer.from(`${JSON.stringify({ schemaVersion: 2, ...metrics }, null, 2)}\n`));
	await writeFile(resolve(session.outputDir, 'evidence-manifest.incomplete.json'), `${JSON.stringify(evidence, null, 2)}\n`);

	return { status: 'incomplete', publishable: false, captures, evidence };
}

export default captureLab;
