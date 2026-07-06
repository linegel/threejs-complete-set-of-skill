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

function materialCacheKey(options) {
	const storageKey = options.storageKey ?? options.speciesKey ?? 'default';
	return `${materialVariantKey(options)}|${storageKey}`;
}

function nodeAxisBasis(axis) {
	const helper = select(abs(axis.y).lessThan(float(0.99)), vec3(0, 1, 0), vec3(1, 0, 0));
	const x = normalize(cross(helper, axis));
	const z = cross(axis, x);
	return { x, z };
}

export function createCreatureMaterial(options = {}) {
	const key = materialCacheKey(options);
	if (cache.has(key)) return cache.get(key);
	if (!options.poseStorage) throw new Error('createCreatureMaterial requires poseStorage');
	if (!options.candidateStorage) throw new Error('createCreatureMaterial requires candidateStorage');

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
		const basis = nodeAxisBasis(axis);
		const canonicalY = positionLocal.y;
		const axialT = clamp(canonicalY, 0, 1);
		const radius = mix(a4.w, b4.w, axialT);
		const capOffset = canonicalY.sub(axialT);
		const radialLength = length(positionLocal.xz);
		const radial = basis.x.mul(cos(theta)).add(basis.z.mul(sin(theta)));
		return mix(a, b, axialT).add(axis.mul(capOffset).mul(radius)).add(radial.mul(radialLength).mul(radius));
	});

	const snappedPositionNode = Fn(() => {
		const preSnap = preSnapPositionNode();
		if (debugMode === 'unsnapped') return preSnap;
		return fieldNodes.snapPosition(preSnap, creatureIndex, ownerSlot, iso);
	})();

	material.positionNode = snappedPositionNode;
	material.castShadowPositionNode = snappedPositionNode;
	material.receivedShadowPositionNode = snappedPositionNode;

	const shadeNode = Fn(() => {
		const field = fieldNodes.evaluateFieldAt(snappedPositionNode, creatureIndex, ownerSlot);
		const n = normalize(field.grad);
		const albedo = field.color;
		const ndl = clamp(dot(n, normalize(sunDir)), 0, 1);
		const bands = max(float(1), bandCount);
		const ramp = step(float(0.5), ndl.mul(bands)).div(bands).add(float(0.38));
		const warmLight = mix(vec3(0.55, 0.62, 0.72), vec3(1.08, 0.94, 0.76), warmth);
		const lit = albedo.mul(ramp).mul(warmLight);

		if (debugMode === 'distance') return vec3(abs(field.d).mul(24));
		if (debugMode === 'weights') return albedo;
		if (debugMode === 'normals') return n.mul(0.5).add(0.5);
		if (debugMode === 'unsnapped') return mix(color(0x5f6873), albedo, 0.35);
		return clamp(lit, 0, 1);
	});

	material.colorNode = shadeNode();
	material.normalNode = normalize(fieldNodes.evaluateFieldAt(snappedPositionNode, creatureIndex, ownerSlot).grad);

	material.userData.creatureUniforms = { bandCount, warmth, sunDir, instanceBase, iso };
	material.userData.variantKey = materialVariantKey(options);
	material.userData.debugMode = debugMode;
	material.userData.selfAO = 'skipped: fragment SDF self-AO costs extra bounded field passes; stage 6 keeps toon + analytic gradients only.';
	material.userData.shadowCasterParity = {
		sharedPositionNode: snappedPositionNode,
		positionNode: material.positionNode,
		castShadowPositionNode: material.castShadowPositionNode,
		receivedShadowPositionNode: material.receivedShadowPositionNode,
	};

	cache.set(key, material);
	return material;
}

export const createSnappedMaterialVariant = createCreatureMaterial;

export function materialCacheSize() {
	return cache.size;
}

export function clearMaterialVariantCache() {
	cache.clear();
}
