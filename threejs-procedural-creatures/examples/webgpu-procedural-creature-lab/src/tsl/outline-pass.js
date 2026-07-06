import { pass } from 'three/tsl';

export function createOutlinePass(scene, camera, options = {}) {
	const scenePass = pass(scene, camera);
	return {
		kind: 'population-normal-depth-edge-pass',
		scenePass,
		normalThreshold: Number.isFinite(options.normalThreshold) ? options.normalThreshold : 0.32,
		depthThreshold: Number.isFinite(options.depthThreshold) ? options.depthThreshold : 0.015,
		widthPx: Number.isFinite(options.widthPx) ? options.widthPx : 1.5,
		crowdPath: true,
		isoOffsetHull: false,
		note: 'Minimal stage-6 outline contract over scene normals/depth; no iso-offset hull is built.',
	};
}

export function createOutlinePassConfig(options = {}) {
	return {
		kind: 'population-normal-depth-edge-pass',
		normalThreshold: Number.isFinite(options.normalThreshold) ? options.normalThreshold : 0.32,
		depthThreshold: Number.isFinite(options.depthThreshold) ? options.depthThreshold : 0.015,
		widthPx: Number.isFinite(options.widthPx) ? options.widthPx : 1.5,
		crowdPath: true,
		isoOffsetHull: false,
	};
}

export function estimateOutlineCost(population, options = {}) {
	const count = Math.max(0, Math.floor(population));
	const config = createOutlinePassConfig(options);
	return {
		draws: count > 0 ? 1 : 0,
		pixelsPerSample: config.widthPx <= 1.5 ? 5 : 9,
		population: count,
	};
}
