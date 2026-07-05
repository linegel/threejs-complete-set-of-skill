export function createOutlinePassConfig(options = {}) {
	return {
		kind: 'population-id-normal-edge-pass',
		normalThreshold: Number.isFinite(options.normalThreshold) ? options.normalThreshold : 0.32,
		idThreshold: Number.isFinite(options.idThreshold) ? options.idThreshold : 0.5,
		widthPx: Number.isFinite(options.widthPx) ? options.widthPx : 1.5,
		crowdPath: true,
		isoOffsetHull: false,
	};
}

export function estimateOutlineCost(population, options = {}) {
	const count = Math.max(0, Math.floor(population));
	const pass = createOutlinePassConfig(options);
	return {
		draws: count > 0 ? 1 : 0,
		pixelsPerSample: pass.widthPx <= 1.5 ? 5 : 9,
		population: count,
	};
}
