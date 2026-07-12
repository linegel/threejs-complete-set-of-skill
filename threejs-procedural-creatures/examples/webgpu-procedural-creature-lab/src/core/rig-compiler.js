import { validateSpec } from './spec-schema.js';
import { compileBlendDag, exactCandidateCertificate } from './blend-dag.js';

export const SCHEMA_VERSION = 'creature-lab-schema-v2';
export const COMPILER_VERSION = 'pure-core-sdf-rig-shell-v2';
export const SHADER_CONTRACT_VERSION = 'creature-field-tsl-v3-explicit-blend-dag-certificates';

export const TIER_CONFIG = {
	hero: { candidateK: 8, radial: 12, capRings: 3, vertsPerSlot: 98, trisPerSlot: 192, snapSteps: 2 },
	crowd: { candidateK: 6, radial: 10, capRings: 2, vertsPerSlot: 62, trisPerSlot: 120, snapSteps: 1 },
	background: { candidateK: 4, radial: 8, capRings: 2, vertsPerSlot: 50, trisPerSlot: 96, snapSteps: 1 },
};

function add(a, b) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v, s) {
	return [v[0] * s, v[1] * s, v[2] * s];
}

function dot(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
}

function len(v) {
	return Math.hypot(v[0], v[1], v[2]);
}

function dist(a, b) {
	return len(sub(a, b));
}

function normalize(v, fallback = [1, 0, 0]) {
	const magnitude = len(v);
	if (!(magnitude > 1e-12)) return fallback.slice();
	return scale(v, 1 / magnitude);
}

function stableStringify(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

// Four independent 32-bit lanes make cache collisions materially less likely
// than the rejected bare-32-bit spec hash while staying synchronous in both the
// browser and Node validation runner. Cache correctness also keeps the full
// canonical source string next to this digest (returned by compileSpec).
export function digest128(value) {
	const text = typeof value === 'string' ? value : stableStringify(value);
	let h1 = 0x811c9dc5;
	let h2 = 0x9e3779b9;
	let h3 = 0x85ebca6b;
	let h4 = 0xc2b2ae35;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 0x01000193);
		h2 = Math.imul(h2 ^ c, 0x27d4eb2d);
		h3 = Math.imul(h3 ^ c, 0x165667b1);
		h4 = Math.imul(h4 ^ c, 0x9e3779b1);
	}
	return [h1, h2, h3, h4]
		.map((lane) => (lane >>> 0).toString(16).padStart(8, '0'))
		.join('');
}

function srgbChannelToLinear(c) {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function srgbHexToLinear(hex) {
	if (typeof hex !== 'string') return [0.85, 0.72, 0.5];
	const clean = hex.slice(1);
	return [0, 2, 4].map((offset) => srgbChannelToLinear(parseInt(clean.slice(offset, offset + 2), 16) / 255));
}

function canonicalPartKey(part, origin) {
	return stableStringify({
		shape: part.shape,
		origin,
		a: part.a,
		b: part.b,
		offset: part.offset,
		r: part.r,
		r2: part.r2,
		k: part.k,
		kCap: part.kCap,
		segments: part.segments,
		length: part.length,
		taper: part.taper,
		hip: part.hip,
		upper: part.upper,
		lower: part.lower,
		phase: part.phase,
		flap: part.flap,
	});
}

function canonicalParts(parts, origins) {
	const keyed = parts.map((part) => ({ part, key: canonicalPartKey(part, origins.get(part.id)) }));
	keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
	for (let index = 1; index < keyed.length; index++) {
		if (keyed[index - 1].key === keyed[index].key) {
			throw new Error('part structural identities collide; add distinct authored geometry so rename-invariant slot order is defined');
		}
	}
	return keyed.map((entry) => entry.part);
}

function partAnchor(part) {
	if (Array.isArray(part.a)) return part.a;
	if (Array.isArray(part.offset)) return part.offset;
	if (Array.isArray(part.hip)) return part.hip;
	return [0, 0, 0];
}

function resolveOrigins(parts, specScale) {
	const byId = new Map(parts.map((part) => [part.id, part]));
	const origins = new Map();

	function originFor(part) {
		if (origins.has(part.id)) return origins.get(part.id);
		let origin = [0, 0, 0];
		if (part.parent) {
			const parent = byId.get(part.parent);
			origin = add(originFor(parent), scale(partAnchor(parent), specScale));
		}
		origins.set(part.id, origin);
		return origin;
	}

	for (const part of parts) originFor(part);
	return origins;
}

function effectiveK(part, radius, scaleValue) {
	const base = Math.max((part.k ?? radius * 0.6) * scaleValue, 1e-4);
	return part.kCap === undefined ? base : Math.min(base, Math.max(part.kCap * scaleValue, 1e-4));
}

function makePrimitive(part, a, b, ra, rb, color, k, slotClass, extra = {}) {
	const axis = normalize(sub(b, a), [0, 1, 0]);
	const helper = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	const radialX = normalize(cross(helper, axis), [1, 0, 0]);
	const radialZ = normalize(cross(axis, radialX), [0, 0, 1]);
	return {
		a,
		ra,
		b,
		rb,
		k,
		color,
		partId: part.id,
		shape: part.shape,
		slotClass,
		restAxis: axis,
		radialX,
		radialZ,
		...extra,
	};
}

function compilePart(part, origin, scaleValue) {
	const color = srgbHexToLinear(part.color);
	const records = [];

	if (part.shape === 'capsule') {
		const radius = part.r * scaleValue;
		const a = add(origin, scale(part.a, scaleValue));
		const b = add(origin, scale(part.b, scaleValue));
		records.push(makePrimitive(part, a, b, radius, radius, color, effectiveK(part, part.r, scaleValue), 'capsule', { flap: part.flap }));
	}

	if (part.shape === 'cone') {
		const ra = part.r * scaleValue;
		const rb = part.r2 * scaleValue;
		const a = add(origin, scale(part.a, scaleValue));
		const b = add(origin, scale(part.b, scaleValue));
		records.push(makePrimitive(part, a, b, ra, rb, color, effectiveK(part, Math.max(part.r, part.r2), scaleValue), 'cone', { flap: part.flap }));
	}

	if (part.shape === 'sphere') {
		const radius = part.r * scaleValue;
		const center = add(origin, scale(part.offset, scaleValue));
		records.push(makePrimitive(part, center, center, radius, radius, color, effectiveK(part, part.r, scaleValue), 'sphere'));
	}

	if (part.shape === 'rope') {
		const segments = part.segments;
		const root = add(origin, scale(part.offset ?? [0, 0, 0], scaleValue));
		const lengthValue = part.length * scaleValue;
		const taper = part.taper ?? 0;
		for (let i = 0; i < segments; i++) {
			const t0 = i / segments;
			const t1 = (i + 1) / segments;
			const a = add(root, [0, 0, -lengthValue * t0]);
			const b = add(root, [0, 0, -lengthValue * t1]);
			const ra = Math.max(part.r * (1 - taper * t0), part.r * 0.15) * scaleValue;
			const rb = Math.max(part.r * (1 - taper * t1), part.r * 0.15) * scaleValue;
			records.push(makePrimitive(part, a, b, ra, rb, color, effectiveK(part, Math.max(ra, rb) / scaleValue, scaleValue), 'rope', { ropeSegment: i }));
		}
	}

	if (part.shape === 'leg') {
		const hip = add(origin, scale(part.hip, scaleValue));
		const side = part.hip[0] >= 0 ? 1 : -1;
		const forward = part.hip[2] >= 0 ? 1 : -1;
		const knee = add(hip, [0.08 * side * scaleValue, -part.upper * scaleValue, 0.05 * forward * scaleValue]);
		const foot = add(knee, [0.06 * side * scaleValue, -part.lower * scaleValue, 0.05 * forward * scaleValue]);
		const ra = part.r * scaleValue;
		const rb = part.r * 0.82 * scaleValue;
		const meta = {
			hip: hip.slice(),
			upper: part.upper * scaleValue,
			lower: part.lower * scaleValue,
			phase: part.phase ?? 0,
		};
		records.push(makePrimitive(part, hip, knee, ra, rb, color, effectiveK(part, part.r, scaleValue), 'leg-upper', { legSegment: 'upper', meta }));
		records.push(makePrimitive(part, knee, foot, rb, rb * 0.88, color, effectiveK(part, part.r, scaleValue), 'leg-lower', { legSegment: 'lower', meta }));
	}

	return records;
}

function primitiveAabb(primitive, pad) {
	return {
		min: [
			Math.min(primitive.a[0], primitive.b[0]) - pad,
			Math.min(primitive.a[1], primitive.b[1]) - pad,
			Math.min(primitive.a[2], primitive.b[2]) - pad,
		],
		max: [
			Math.max(primitive.a[0], primitive.b[0]) + pad,
			Math.max(primitive.a[1], primitive.b[1]) + pad,
			Math.max(primitive.a[2], primitive.b[2]) + pad,
		],
	};
}

function intersects(a, b) {
	return a.min[0] <= b.max[0] && a.max[0] >= b.min[0]
		&& a.min[1] <= b.max[1] && a.max[1] >= b.min[1]
		&& a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
}

function locomotionExcursion(spec) {
	const scaleValue = spec.scale ?? 1;
	const legReach = Math.max(0, ...spec.parts.filter((part) => part.shape === 'leg').map((part) => (part.upper + part.lower) * scaleValue));
	const ropeReach = Math.max(0, ...spec.parts.filter((part) => part.shape === 'rope').map((part) => part.length * scaleValue));
	if (spec.locomotion.type === 'biped' || spec.locomotion.type === 'quadruped' || spec.locomotion.type === 'hexapod') return Math.max(legReach, ropeReach);
	if (spec.locomotion.type === 'hopper') return Math.max((spec.locomotion.hopHeight ?? 0) * scaleValue, ropeReach);
	if (spec.locomotion.type === 'swimmer') return ropeReach;
	if (spec.locomotion.type === 'flyer') {
		const wingLength = Math.max(0, ...spec.parts.filter((part) => part.flap !== undefined || part.id.includes('wing')).map((part) => {
			if (part.a && part.b) return len(sub(part.b, part.a)) * scaleValue;
			return 0;
		}));
		// Derived: max flap sweep is wing arc length theta*r from authored flap radians and wing span.
		const flap = Math.max(0, ...spec.parts.map((part) => Math.abs(part.flap ?? 0)));
		return Math.max(flap * wingLength, ropeReach);
	}
	return ropeReach;
}

function buildAdjacency(slots, excursion) {
	const aabbs = slots.map((slot) => primitiveAabb(slot, Math.max(slot.ra, slot.rb) + slot.k + excursion));
	const adjacency = slots.map(() => []);
	for (let i = 0; i < slots.length; i++) {
		for (let j = i + 1; j < slots.length; j++) {
			if (intersects(aabbs[i], aabbs[j])) {
				adjacency[i].push(j);
				adjacency[j].push(i);
			}
		}
	}
	return adjacency;
}

function buildCandidateSets(slots, adjacency, candidateK) {
	return slots.map((slot, owner) => {
		const adjacent = new Set(adjacency[owner]);
		const ownerCenter = scale(add(slot.a, slot.b), 0.5);
		const ranked = slots
			.map((candidate, index) => {
				const candidateCenter = scale(add(candidate.a, candidate.b), 0.5);
				const adjacencyBias = adjacent.has(index) ? -1e-3 : 0;
				return { index, distance: dist(ownerCenter, candidateCenter) + adjacencyBias };
			})
			.filter((entry) => entry.index !== owner)
			.sort((a, b) => a.distance - b.distance || a.index - b.index)
			// K is TOTAL contributor capacity, including the owning primitive.
			// The old slice(K) + prepend(owner) built K+1 contributors and the
			// storage writer silently truncated the last one.
			.slice(0, Math.max(0, candidateK - 1))
			.map((entry) => entry.index);
		return [...new Set([owner, ...ranked])].sort((a, b) => a - b);
	});
}

function computeBodyLift(spec) {
	let bodyLift = 0;
	for (const part of spec.parts) {
		if (part.shape !== 'leg') continue;
		bodyLift = Math.max(bodyLift, ((part.upper + part.lower) * 0.92 - part.hip[1]) * spec.scale);
	}
	return bodyLift;
}

export function compileSpec(inputSpec, options = {}) {
	const tier = options.tier ?? 'hero';
	const config = TIER_CONFIG[tier] ?? TIER_CONFIG.hero;
	const spec = validateSpec(inputSpec, { maxParts: options.maxParts });
	const origins = resolveOrigins(spec.parts, spec.scale);
	const parts = canonicalParts(spec.parts, origins);
	const semanticPartIndexById = new Map(parts.map((part, index) => [part.id, index]));
	const semanticParts = parts.map((part, index) => ({
		index,
		id: part.id,
		parentIndex: part.parent ? semanticPartIndexById.get(part.parent) : null,
	}));
	const slots = [];
	const partSlotIndices = new Map();
	for (const part of parts) {
		const first = slots.length;
		const records = compilePart(part, origins.get(part.id), spec.scale);
		for (const record of records) {
			record.semanticPartIndex = semanticPartIndexById.get(part.id);
			record.semanticParentPartIndex = part.parent ? semanticPartIndexById.get(part.parent) : null;
		}
		slots.push(...records);
		partSlotIndices.set(part.id, Array.from({ length: slots.length - first }, (_, index) => first + index));
	}
	if (options.maxParts !== undefined && slots.length > options.maxParts) {
		throw new Error(`spec.maxParts compiled slot count ${slots.length} exceeds maxParts ${options.maxParts}`);
	}

	const excursion = locomotionExcursion(spec);
	const adjacency = buildAdjacency(slots, excursion);
	const requestedCandidateK = options.candidateK ?? config.candidateK;
	if (!Number.isFinite(requestedCandidateK) || requestedCandidateK < 1) {
		throw new Error(`candidateK must be a positive total contributor capacity; got ${requestedCandidateK}`);
	}
	const candidateK = Math.min(slots.length, Math.floor(requestedCandidateK));
	const candidateSets = buildCandidateSets(slots, adjacency, candidateK);
	const blendDag = compileBlendDag({ spec, parts, slots, partSlotIndices });
	const candidateCertificates = candidateSets.map((set) => exactCandidateCertificate(blendDag, set));
	const candidateCertificateDigest = digest128(candidateCertificates.map((certificate) => ({
		status: certificate.status,
		omittedLeaves: certificate.omittedLeaves,
		distanceTailBound: Number.isFinite(certificate.distanceTailBound) ? certificate.distanceTailBound : 'Infinity',
		normalAngularBoundRadians: Number.isFinite(certificate.normalAngularBoundRadians) ? certificate.normalAngularBoundRadians : 'Infinity',
		colorWeightBound: certificate.colorWeightBound,
	})));
	const maxRadius = Math.max(0, ...slots.map((slot) => Math.max(slot.ra, slot.rb)));
	const slotClasses = slots.map((slot) => slot.slotClass).join(',');
	const geometrySource = stableStringify(slots.map((slot) => ({
		a: slot.a,
		b: slot.b,
		ra: slot.ra,
		rb: slot.rb,
		k: slot.k,
		slotClass: slot.slotClass,
		restAxis: slot.restAxis,
		radialX: slot.radialX,
	})));
	const blendSource = blendDag.canonicalSource;
	const compilerSignature = digest128({ schema: SCHEMA_VERSION, compiler: COMPILER_VERSION, shader: SHADER_CONTRACT_VERSION });
	const topologySignature = digest128({
		tier,
		slotClasses,
		blendSource,
		candidateK,
		candidateCertificateDigest,
		semanticStructure: semanticParts.map((part) => ({ index: part.index, parentIndex: part.parentIndex })),
	});
	const geometryDigest = digest128(geometrySource);
	const shaderContractDigest = digest128({ shader: SHADER_CONTRACT_VERSION, maxParts: options.maxParts ?? slots.length, candidateK });
	const digest = digest128({ compilerSignature, topologySignature, geometryDigest, shaderContractDigest });
	const primitiveRecords = slots.map((slot, partSlot) => ({
		...slot,
		partSlot,
		shape: slot.slotClass,
		sourceShape: slot.shape,
		meta: slot.meta ?? {},
	}));

	return {
		slots,
		primitiveRecords,
		blendDag,
		candidateSets,
		candidateCertificates,
		candidateCertificateDigest,
		semanticParts,
		adjacency,
		bodyLift: computeBodyLift(spec),
		maxRadius,
		digest,
		compilerSignature,
		topologySignature,
		geometryDigest,
		geometrySource,
		shaderContractDigest,
		tier,
		candidateK,
		radialFrames: slots.map((slot) => ({ axis: slot.restAxis.slice(), x: slot.radialX.slice(), z: slot.radialZ.slice() })),
		geometry: {
			radial: config.radial,
			capRings: config.capRings,
			vertsPerSlot: config.vertsPerSlot,
			trisPerSlot: config.trisPerSlot,
		},
	};
}

export function poseTransform(point, pose = {}) {
	const squash = Number.isFinite(pose.squash) ? pose.squash : 1;
	const xz = 1 / Math.sqrt(Math.max(squash, 0.05));
	let x = point[0] * xz;
	let y = point[1] * squash;
	let z = point[2] * xz;

	const roll = pose.roll ?? 0;
	const cr = Math.cos(roll);
	const sr = Math.sin(roll);
	[y, z] = [y * cr - z * sr, y * sr + z * cr];

	const yaw = pose.yaw ?? 0;
	const cy = Math.cos(yaw);
	const sy = Math.sin(yaw);
	[x, z] = [x * cy + z * sy, -x * sy + z * cy];

	const t = pose.translate ?? pose.position ?? [0, 0, 0];
	return [x + t[0], y + t[1], z + t[2]];
}

export { stableStringify };
