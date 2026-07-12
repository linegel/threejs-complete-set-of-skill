export const TIER_RENDER_GRAPH_VERSION = 'creature-tier-render-graph-v1';

function graph(tier, colorAttachments, outlineMode, sampleCount, shadowMapSize) {
	return Object.freeze({
		version: TIER_RENDER_GRAPH_VERSION,
		tier,
		colorAttachments: Object.freeze([...colorAttachments]),
		depthAttachment: true,
		outlineMode,
		sampleCount,
		shadowMapSize,
		sceneSubmissions: 1,
		finalOutputOwner: 'renderOutput',
	});
}

export const TIER_RENDER_GRAPHS = Object.freeze({
	hero: graph('hero', ['output', 'normal'], 'shared-normal-depth-edge', 4, 2048),
	crowd: graph('crowd', ['output', 'normal'], 'shared-normal-depth-edge', 1, 1024),
	background: graph('background', ['output'], 'none', 1, 512),
});

export function tierRenderGraph(tier) {
	const result = TIER_RENDER_GRAPHS[tier];
	if (!result) throw new Error(`unknown creature tier render graph '${tier}'`);
	return result;
}

export function renderGraphMatchesProfile(graphContract, profile) {
	return graphContract?.tier === profile?.tier
		&& graphContract?.outlineMode === profile?.outlineMode
		&& graphContract?.sampleCount === profile?.sampleCount
		&& graphContract?.shadowMapSize === profile?.shadowMapSize
		&& graphContract?.depthAttachment === profile?.depthAttachment
		&& JSON.stringify(graphContract?.colorAttachments) === JSON.stringify(profile?.colorAttachments);
}
