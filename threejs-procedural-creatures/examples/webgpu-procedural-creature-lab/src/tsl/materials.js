import { DoubleSide, Vector3 } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
	Fn,
	abs,
	attribute,
	clamp,
	color,
	cos,
	cross,
	dot,
	float,
	instanceIndex,
	int,
	length,
	max,
	mix,
	normalize,
	positionLocal,
	select,
	sin,
	step,
	uniform,
	vec3,
} from 'three/tsl';
import { buildFieldNodes } from './field-nodes.js';

const debugModes = new Set(['off', 'unsnapped', 'distance', 'weights', 'normals', 'ownership']);
const cache = new Map();
const objectIds = new WeakMap();
let nextObjectId = 1;

function objectIdentity(value, label) {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) throw new Error(`${label} binding identity is missing`);
	let identity = objectIds.get(value);
	if (!identity) {
		identity = nextObjectId++;
		objectIds.set(value, identity);
	}
	return identity;
}

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

function materialCacheKey(options) {
	const storageIdentity = [
		objectIdentity(options.poseStorage?.poseNode, 'pose storage'),
		objectIdentity(options.poseStorage?.rootsNode, 'root storage'),
		objectIdentity(options.poseStorage?.framesNode, 'radial-frame storage'),
		objectIdentity(options.candidateStorage?.node, 'candidate storage'),
	].join(':');
	const signatures = [
		options.compilerSignature ?? 'compiler-unspecified',
		options.topologySignature ?? 'topology-unspecified',
		options.geometryDigest ?? 'geometry-unspecified',
		options.shaderContractDigest ?? 'shader-unspecified',
	].join('|');
	return `${materialVariantKey(options)}|${signatures}|bindings:${storageIdentity}`;
}

export function createCreatureMaterial(options = {}) {
	const key = materialCacheKey(options);
	if (cache.has(key)) {
		const entry = cache.get(key);
		entry.refCount += 1;
		return entry.material;
	}
	if (!options.poseStorage) throw new Error('createCreatureMaterial requires poseStorage');
	if (!options.candidateStorage) throw new Error('createCreatureMaterial requires candidateStorage');
	if (!options.blendDag) throw new Error('createCreatureMaterial requires compiled blendDag');
	if (!options.candidateCertificateDigest) throw new Error('createCreatureMaterial requires candidate certificate digest');
	if (options.candidateStorage.certificateDigest !== options.candidateCertificateDigest) {
		throw new Error('candidate storage binding does not match the certified blend-DAG program');
	}

	const debugMode = debugModes.has(options.debugMode) ? options.debugMode : 'off';
	const material = new MeshStandardNodeMaterial({
		color: 0xffffff,
		roughness: 0.72,
		metalness: 0,
	});
	material.name = `CreatureMaterial:${materialVariantKey(options)}`;
	material.side = DoubleSide;

	const fieldNodes = buildFieldNodes({
		poseStorage: options.poseStorage,
		candidateStorage: options.candidateStorage,
		blendDag: options.blendDag,
		maxParts: options.maxParts,
		tierConfig: {
			...options.tierConfig,
			tier: options.tier,
			candidateK: options.K ?? options.candidateK,
			maxRadius: options.maxRadius,
			snapSteps: options.snapSteps,
		},
	});

	const bandCount = uniform(options.bandCount ?? 3);
	const warmth = uniform(options.warmth ?? 0.28);
	const sunDir = uniform(new Vector3(0.45, 0.9, 0.35).normalize());
	const instanceBase = uniform(options.instanceBase ?? 0);
	const iso = uniform(options.iso ?? 0);

	const ownerSlot = int(attribute('aPart'));
	const theta = attribute('aTheta');
	const creatureIndex = int(instanceIndex).add(int(instanceBase));

	const preSnapPositionNode = Fn(() => {
		const slotBase = fieldNodes.primitiveBase(creatureIndex, ownerSlot);
		const a4 = options.poseStorage.poseNode.element(slotBase);
		const b4 = options.poseStorage.poseNode.element(slotBase.add(int(1)));
		const a = a4.xyz;
		const b = b4.xyz;
		const axisDelta = b.sub(a);
		const axisLength = max(length(axisDelta), float(1e-6));
		const axis = axisDelta.div(axisLength);
		const frameIndex = creatureIndex.mul(int(options.maxParts)).add(ownerSlot);
		const radialX = normalize(options.poseStorage.framesNode.element(frameIndex).xyz);
		const radialZ = normalize(cross(axis, radialX));
		const canonicalY = positionLocal.y;
		const axialT = clamp(canonicalY, 0, 1);
		const radius = mix(a4.w, b4.w, axialT);
		const capOffset = canonicalY.sub(axialT);
		const radialLength = length(positionLocal.xz);
		const radial = radialX.mul(cos(theta)).add(radialZ.mul(sin(theta)));
		return mix(a, b, axialT).add(axis.mul(capOffset).mul(radius)).add(radial.mul(radialLength).mul(radius));
	});

	// Creature-local snapped surface — the field lives in this space, so the
	// fragment field/color/normal evaluations consume THIS node.
	const localSnappedNode = Fn(() => {
		const preSnap = preSnapPositionNode();
		if (debugMode === 'unsnapped') return preSnap;
		return fieldNodes.snapPosition(preSnap, creatureIndex, ownerSlot, iso);
	})();

	// Root application, exactly once, in-shader from the roots storage (yaw
	// around Y, then translate by layout+root). NodeMaterial.setupPosition
	// applies instancedMesh() BEFORE positionLocal.assign(positionNode), so a
	// from-storage positionNode CLOBBERS the instance matrix — the instance
	// transform therefore cannot carry root motion here (r185, measured in the
	// lab; see LAB_FINDINGS). SoA slot endpoints stay creature-local, keeping
	// rootTransformSingleApplication intact.
	const rootsNode = options.poseStorage.rootsNode;
	const snappedPositionNode = Fn(() => {
		const p = localSnappedNode;
		const root = rootsNode.element(creatureIndex);
		const cy = cos(root.w);
		const sy = sin(root.w);
		const rotated = vec3(
			p.x.mul(cy).add(p.z.mul(sy)),
			p.y,
			p.x.negate().mul(sy).add(p.z.mul(cy)),
		);
		return rotated.add(root.xyz);
	})();
	const surfaceOwnerNode = fieldNodes.evaluateOwnerSlot(localSnappedNode, creatureIndex, ownerSlot);
	const ownershipMaskNode = select(surfaceOwnerNode.equal(ownerSlot), float(1), float(0));

	material.positionNode = snappedPositionNode;
	material.castShadowPositionNode = snappedPositionNode;
	// receivedShadowPositionNode is world-space in r185. Leave it derived from
	// positionWorld; assigning this local/object-space node duplicates root
	// motion and breaks received-shadow lookup under non-identity hosts.
	// The diagnostic shell contains one complete sheet per primitive. Only the
	// stable closest-primitive owner survives alpha test, eliminating draw-order
	// dependent coincident sheets without pretending the shell is manifold.
	material.opacityNode = ownershipMaskNode;
	material.alphaTestNode = float(0.5);

	const shadeNode = Fn(() => {
		const field = fieldNodes.evaluateFieldAt(localSnappedNode, creatureIndex, ownerSlot);
		const root = rootsNode.element(creatureIndex);
		const cy = cos(root.w);
		const sy = sin(root.w);
		const g = field.grad;
		const n = normalize(vec3(
			g.x.mul(cy).add(g.z.mul(sy)),
			g.y,
			g.x.negate().mul(sy).add(g.z.mul(cy)),
		));
		const albedo = field.color;
		const ndl = clamp(dot(n, normalize(sunDir)), 0, 1);
		const bands = max(float(1), bandCount);
		const ramp = step(float(0.5), ndl.mul(bands)).div(bands).add(float(0.38));
		const warmLight = mix(vec3(0.55, 0.62, 0.72), vec3(1.08, 0.94, 0.76), warmth);
		const lit = albedo.mul(ramp).mul(warmLight);

		if (debugMode === 'distance') return vec3(abs(field.d).mul(24));
		if (debugMode === 'weights') return albedo;
		if (debugMode === 'normals') return n.mul(0.5).add(0.5);
		if (debugMode === 'ownership') {
			const ownerBand = surfaceOwnerNode.toFloat().mul(0.61803398875).fract();
			return vec3(ownerBand, ownerBand.mul(1.7).fract(), ownerBand.mul(2.3).fract()).mul(ownershipMaskNode);
		}
		if (debugMode === 'unsnapped') return mix(color(0x5f6873), albedo, 0.35);
		return clamp(lit, 0, 1);
	});

	material.colorNode = shadeNode();
	const localGradient = fieldNodes.evaluateFieldAt(localSnappedNode, creatureIndex, ownerSlot).grad;
	const rootForNormal = rootsNode.element(creatureIndex);
	const normalCy = cos(rootForNormal.w);
	const normalSy = sin(rootForNormal.w);
	material.normalNode = normalize(vec3(
		localGradient.x.mul(normalCy).add(localGradient.z.mul(normalSy)),
		localGradient.y,
		localGradient.x.negate().mul(normalSy).add(localGradient.z.mul(normalCy)),
	));

	material.userData.creatureUniforms = { bandCount, warmth, sunDir, instanceBase, iso };
	material.userData.variantKey = materialVariantKey(options);
	material.userData.cacheKey = key;
	material.userData.candidateCertificateDigest = options.candidateCertificateDigest;
	material.userData.debugMode = debugMode;
	material.userData.ownership = {
		policy: 'minimum primitive distance; exact ties choose the lower slot index',
		maskNode: ownershipMaskNode,
		ownerNode: surfaceOwnerNode,
		overlappingFullShellsVisible: false,
	};
	material.userData.selfAO = 'skipped: fragment SDF self-AO costs extra bounded field passes; stage 6 keeps toon + analytic gradients only.';
	material.userData.shadowCasterParity = {
		sharedPositionNode: snappedPositionNode,
		positionNode: material.positionNode,
		castShadowPositionNode: material.castShadowPositionNode,
		receivedShadowPositionNode: null,
		receivedShadowDerivedFromPositionWorld: true,
	};

	cache.set(key, { material, refCount: 1 });
	return material;
}

export const createSnappedMaterialVariant = createCreatureMaterial;

export function materialCacheSize() {
	return cache.size;
}

export function clearMaterialVariantCache(options = {}) {
	const live = [...cache.values()].filter((entry) => entry.refCount > 0);
	if (live.length > 0 && options.force !== true) {
		throw new Error(`cannot clear creature material cache with ${live.length} live referenced variant(s)`);
	}
	for (const entry of cache.values()) entry.material.dispose?.();
	cache.clear();
}

export function releaseCreatureMaterial(material) {
	for (const [key, entry] of cache) {
		if (entry.material !== material) continue;
		entry.refCount -= 1;
		if (entry.refCount <= 0) {
			cache.delete(key);
			material.dispose?.();
			return true;
		}
		return false;
	}
	return false;
}

export function materialCacheSnapshot() {
	return Array.from(cache.entries()).map(([key, entry]) => ({ key, refCount: entry.refCount, material: entry.material.name }));
}
