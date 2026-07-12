import { BufferAttribute, BufferGeometry } from 'three';

const SOURCE_IDENTITY_KEYS = Object.freeze(['compilerSignature', 'topologySignature', 'geometryDigest']);

export function assertReferenceAssetIdentity(asset, compiled) {
	const manifest = asset?.manifest;
	const source = manifest?.identity?.sourceRigIdentity;
	if (!source) throw new Error('reference asset source rig identity is missing');
	if (manifest.tier !== compiled?.tier) {
		throw new Error(`reference asset tier '${manifest.tier ?? 'missing'}' does not match compiled tier '${compiled?.tier ?? 'missing'}'`);
	}
	for (const key of SOURCE_IDENTITY_KEYS) {
		if (source[key] !== compiled?.[key]) {
			throw new Error(`reference asset source rig ${key} does not match the active compiled identity`);
		}
	}
	return true;
}

export function buildReferenceBufferGeometry(asset, compiled) {
	const arrays = asset?.arrays;
	if (!arrays?.positions || !arrays?.indices || !arrays?.skinIndices || !arrays?.skinWeights) throw new Error('reference geometry requires a validated reference asset');
	assertReferenceAssetIdentity(asset, compiled);
	const vertices = arrays.positions.length / 3;
	const colors = new Float32Array(vertices * 3);
	for (let vertex = 0; vertex < vertices; vertex++) {
		for (let influence = 0; influence < 4; influence++) {
			const source = vertex * 4 + influence;
			const slot = arrays.colorIndices[source];
			const weight = arrays.colorWeights[source];
			const color = compiled.slots[slot]?.color ?? [0.85, 0.72, 0.5];
			for (let channel = 0; channel < 3; channel++) colors[vertex * 3 + channel] += color[channel] * weight;
		}
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(arrays.positions, 3));
	geometry.setAttribute('normal', new BufferAttribute(arrays.normals, 3));
	geometry.setAttribute('skinIndex', new BufferAttribute(arrays.skinIndices, 4));
	geometry.setAttribute('skinWeight', new BufferAttribute(arrays.skinWeights, 4));
	geometry.setAttribute('color', new BufferAttribute(colors, 3));
	geometry.setAttribute('correctionWeight', new BufferAttribute(arrays.correctionWeights, 1));
	geometry.setIndex(new BufferAttribute(arrays.indices, 1));
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	geometry.userData.representation = asset.manifest.representation;
	geometry.userData.acceptanceStatus = asset.manifest.acceptanceStatus;
	geometry.userData.compilerSignature = asset.manifest.identity.compilerSignature;
	geometry.userData.topologySignature = asset.manifest.identity.topologySignature;
	geometry.userData.geometryDigest = asset.manifest.identity.geometryDigest;
	geometry.userData.sha256 = asset.manifest.binary.sha256;
	geometry.userData.deformationStatus = asset.manifest.deformation?.status ?? 'missing';
	geometry.userData.skinningMethod = asset.manifest.deformation?.selectedMethod ?? 'provisional-lbs-preview';
	return geometry;
}
