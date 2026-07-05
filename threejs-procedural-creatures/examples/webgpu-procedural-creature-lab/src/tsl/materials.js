const debugModes = new Set(['off', 'unsnapped', 'distance', 'weights', 'normals']);
const cache = new Map();

export function srgbHexToLinearTuple(hex) {
	const clean = String(hex || '#d8b780').replace('#', '');
	return [0, 2, 4].map((offset) => {
		const c = parseInt(clean.slice(offset, offset + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
}

export function materialVariantKey(options = {}) {
	const tier = options.tier ?? 'hero';
	const outline = options.outline === true ? 'outline' : 'plain';
	const debugMode = debugModes.has(options.debugMode) ? options.debugMode : 'off';
	const k = Number.isFinite(options.K) ? Math.floor(options.K) : Number.isFinite(options.candidateK) ? Math.floor(options.candidateK) : 8;
	return `${tier}|${outline}|${debugMode}|K${k}`;
}

export function createSnappedMaterialVariant(options = {}) {
	const key = materialVariantKey(options);
	if (cache.has(key)) return cache.get(key);
	const variant = {
		key,
		tier: options.tier ?? 'hero',
		outline: options.outline === true,
		debugMode: debugModes.has(options.debugMode) ? options.debugMode : 'off',
		K: Number.isFinite(options.K) ? Math.floor(options.K) : Number.isFinite(options.candidateK) ? Math.floor(options.candidateK) : 8,
		snappedPositionNode: { kind: 'shared-snapped-position', key },
		uniforms: {
			toonBands: options.toonBands ?? 4,
			outlineWidth: options.outlineWidth ?? 1.5,
			warmth: options.warmth ?? 0.3,
		},
	};
	variant.positionNode = variant.snappedPositionNode;
	variant.castShadowPositionNode = variant.snappedPositionNode;
	variant.receivedShadowPositionNode = variant.snappedPositionNode;
	cache.set(key, variant);
	return variant;
}

export function materialCacheSize() {
	return cache.size;
}

export function clearMaterialVariantCache() {
	cache.clear();
}
