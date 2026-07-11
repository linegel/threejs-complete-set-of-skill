import {
	abs,
	dot,
	float,
	max,
	normalize,
	renderOutput,
	screenUV,
	vec2,
	vec3,
	vec4,
	viewportSize,
} from 'three/tsl';

export function createOutlinePass(scenePass, options = {}) {
	if (!scenePass?.getTextureNode) throw new Error('createOutlinePass requires the host scene PassNode');
	const config = createOutlinePassConfig(options);
	const beauty = scenePass.getTextureNode('output');
	const normalTexture = scenePass.getTextureNode('normal');
	const depthTexture = scenePass.getTextureNode('depth');
	const texelX = vec2(float(config.widthPx).div(viewportSize.x), 0);
	const texelY = vec2(0, float(config.widthPx).div(viewportSize.y));
	const centerNormal = normalize(normalTexture.sample(screenUV).xyz);
	const centerDepth = depthTexture.sample(screenUV).r;
	const normalEdge = max(
		float(1).sub(dot(centerNormal, normalize(normalTexture.sample(screenUV.add(texelX)).xyz))),
		float(1).sub(dot(centerNormal, normalize(normalTexture.sample(screenUV.add(texelY)).xyz))),
	);
	const depthEdge = max(
		abs(depthTexture.sample(screenUV.add(texelX)).r.sub(centerDepth)),
		abs(depthTexture.sample(screenUV.add(texelY)).r.sub(centerDepth)),
	);
	const edge = normalEdge.greaterThan(float(config.normalThreshold))
		.or(depthEdge.greaterThan(float(config.depthThreshold)));
	const source = beauty.sample(screenUV);
	const outlined = edge.select(vec3(0.008, 0.01, 0.014), source.rgb);
	return {
		...config,
		outputNode: renderOutput(vec4(outlined, source.a)),
		scenePass,
		inputs: Object.freeze({ beauty: 'output', normal: 'normal', depth: 'depth' }),
		dispose() {},
	};
}

export function createOutlinePassConfig(options = {}) {
	return {
		kind: 'population-normal-depth-edge-pass',
		normalThreshold: Number.isFinite(options.normalThreshold) ? options.normalThreshold : 0.12,
		depthThreshold: Number.isFinite(options.depthThreshold) ? options.depthThreshold : 0.0025,
		widthPx: Number.isFinite(options.widthPx) ? options.widthPx : 1.5,
		crowdPath: true,
		isoOffsetHull: false,
		note: 'Host MRT normal/depth edge composite; no duplicate creature beauty render or iso-offset hull.',
	};
}

export function estimateOutlineCost(population, options = {}) {
	const count = Math.max(0, Math.floor(population));
	const config = createOutlinePassConfig(options);
	return {
		draws: 0,
		fullscreenPasses: count > 0 ? 1 : 0,
		pixelsPerSample: 5,
		population: count,
		widthPx: config.widthPx,
	};
}
