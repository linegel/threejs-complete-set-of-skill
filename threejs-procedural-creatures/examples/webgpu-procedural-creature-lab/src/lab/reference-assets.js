import { unpackReferenceAsset, verifyReferenceAssetSha256 } from '../core/reference-asset-format.js';

const REQUIRED_ARRAYS = Object.freeze(['positions', 'normals', 'indices', 'skinIndices', 'skinWeights', 'semanticIndices', 'colorIndices', 'colorWeights', 'correctionWeights', 'restRadialFrames']);

function assetUrls(name) {
	return {
		manifest: new URL(`../../assets/reference/${name}.surface.json`, import.meta.url),
		binary: new URL(`../../assets/reference/${name}.surface.bin`, import.meta.url),
	};
}

async function fetchRequired(url, kind) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`failed to load reference ${kind} '${url.pathname}': HTTP ${response.status}`);
	return response;
}

export async function loadReferenceAsset(name) {
	const urls = assetUrls(name);
	const [manifestResponse, binaryResponse] = await Promise.all([
		fetchRequired(urls.manifest, 'manifest'),
		fetchRequired(urls.binary, 'binary'),
	]);
	const manifest = await manifestResponse.json();
	const binary = new Uint8Array(await binaryResponse.arrayBuffer());
	await verifyReferenceAssetSha256(manifest, binary);
	const arrays = unpackReferenceAsset(manifest, binary);
	const missing = REQUIRED_ARRAYS.filter((key) => !arrays[key]);
	if (missing.length > 0) throw new Error(`reference asset '${name}' lacks arrays: ${missing.join(', ')}`);
	const vertices = arrays.positions.length / 3;
	if (manifest.name !== name || arrays.normals.length !== arrays.positions.length || arrays.skinIndices.length !== vertices * 4
		|| arrays.skinWeights.length !== vertices * 4 || arrays.semanticIndices.length !== vertices
		|| arrays.correctionWeights.length !== vertices || arrays.restRadialFrames.length !== vertices * 6) {
		throw new Error(`reference asset '${name}' identity or array cardinality mismatch`);
	}
	return Object.freeze({ name, manifest, arrays, binaryByteLength: binary.byteLength, acceptanceEligible: manifest.acceptanceStatus === 'accepted' });
}

export async function loadBundledReferenceAssets(names) {
	const assets = await Promise.all(names.map(loadReferenceAsset));
	return new Map(assets.map((asset) => [asset.name, asset]));
}
