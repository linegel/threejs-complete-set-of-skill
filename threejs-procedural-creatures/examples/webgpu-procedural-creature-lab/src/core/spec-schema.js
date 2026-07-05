const LOCOMOTION_TYPES = new Set(['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer']);
const SHAPES = new Set(['capsule', 'sphere', 'cone', 'rope', 'leg']);
const LEG_COUNTS = {
	biped: 2,
	quadruped: 4,
	hexapod: 6,
	hopper: 0,
	swimmer: 0,
};

function fail(path, message) {
	throw new Error(`${path} ${message}`);
}

function isFiniteNumber(value) {
	return typeof value === 'number' && Number.isFinite(value);
}

function requirePositive(value, path) {
	if (!isFiniteNumber(value) || value <= 0) fail(path, 'must be > 0');
}

function requireNonNegative(value, path) {
	if (value !== undefined && (!isFiniteNumber(value) || value < 0)) fail(path, 'must be >= 0');
}

function requireVec3(value, path) {
	if (!Array.isArray(value) || value.length !== 3 || value.some((n) => !isFiniteNumber(n))) {
		fail(path, 'must be a finite [x,y,z]');
	}
}

function slotCountForPart(part) {
	if (part.shape === 'rope') return part.segments;
	if (part.shape === 'leg') return 2;
	return 1;
}

function visitParent(id, byId, visiting, visited) {
	if (visited.has(id)) return;
	if (visiting.has(id)) fail(`${id}.parent`, 'must be acyclic');
	visiting.add(id);
	const part = byId.get(id);
	if (part?.parent) visitParent(part.parent, byId, visiting, visited);
	visiting.delete(id);
	visited.add(id);
}

export function validateSpec(spec, options = {}) {
	if (!spec || typeof spec !== 'object') fail('spec.value', 'must be an object');
	if (typeof spec.name !== 'string' || spec.name.length === 0) fail('spec.name', 'must be a non-empty string');
	if (spec.seed !== undefined && !isFiniteNumber(spec.seed)) fail('spec.seed', 'must be finite');
	if (spec.scale !== undefined) requirePositive(spec.scale, 'spec.scale');
	if (!spec.locomotion || typeof spec.locomotion !== 'object') fail('locomotion.value', 'must be an object');
	if (!LOCOMOTION_TYPES.has(spec.locomotion.type)) fail('locomotion.type', 'must be a known locomotion type');

	for (const field of ['speed', 'stepLength', 'stepHeight', 'hopLength', 'hopHeight', 'altitude', 'radius', 'buoyancy', 'undulation']) {
		requireNonNegative(spec.locomotion[field], `locomotion.${field}`);
	}

	if (!Array.isArray(spec.parts) || spec.parts.length === 0) fail('spec.parts', 'must be a non-empty array');

	const ids = new Set();
	const byId = new Map();
	let slotCount = 0;
	let legCount = 0;

	for (const part of spec.parts) {
		if (!part || typeof part !== 'object') fail('part.value', 'must be an object');
		if (typeof part.id !== 'string' || part.id.length === 0) fail('part.id', 'must be a non-empty string');
		if (ids.has(part.id)) fail(`${part.id}.id`, 'must be unique');
		ids.add(part.id);
		byId.set(part.id, part);
		if (!SHAPES.has(part.shape)) fail(`${part.id}.shape`, 'must be a known shape');
		if (part.parent !== undefined && (typeof part.parent !== 'string' || part.parent.length === 0)) {
			fail(`${part.id}.parent`, 'must be a non-empty string');
		}
		if (part.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(part.color)) fail(`${part.id}.color`, 'must be #rrggbb');
		if (part.k !== undefined) requirePositive(part.k, `${part.id}.k`);
		if (part.kCap !== undefined) requirePositive(part.kCap, `${part.id}.kCap`);
		if (part.phase !== undefined && !isFiniteNumber(part.phase)) fail(`${part.id}.phase`, 'must be finite');
		if (part.flap !== undefined && !isFiniteNumber(part.flap)) fail(`${part.id}.flap`, 'must be finite');

		if (part.shape === 'capsule') {
			requireVec3(part.a, `${part.id}.a`);
			requireVec3(part.b, `${part.id}.b`);
			requirePositive(part.r, `${part.id}.r`);
		} else if (part.shape === 'cone') {
			requireVec3(part.a, `${part.id}.a`);
			requireVec3(part.b, `${part.id}.b`);
			requirePositive(part.r, `${part.id}.r`);
			requirePositive(part.r2, `${part.id}.r2`);
		} else if (part.shape === 'sphere') {
			requireVec3(part.offset, `${part.id}.offset`);
			requirePositive(part.r, `${part.id}.r`);
		} else if (part.shape === 'rope') {
			if (part.offset !== undefined) requireVec3(part.offset, `${part.id}.offset`);
			if (!Number.isInteger(part.segments) || part.segments <= 0) fail(`${part.id}.segments`, 'must be a positive integer');
			requirePositive(part.length, `${part.id}.length`);
			requirePositive(part.r, `${part.id}.r`);
			if (part.taper !== undefined) requireNonNegative(part.taper, `${part.id}.taper`);
		} else if (part.shape === 'leg') {
			requireVec3(part.hip, `${part.id}.hip`);
			requirePositive(part.upper, `${part.id}.upper`);
			requirePositive(part.lower, `${part.id}.lower`);
			requirePositive(part.r, `${part.id}.r`);
			legCount++;
		}

		slotCount += slotCountForPart(part);
	}

	for (const part of spec.parts) {
		if (part.parent && !byId.has(part.parent)) fail(`${part.id}.parent`, 'must reference an existing part');
	}
	for (const part of spec.parts) visitParent(part.id, byId, new Set(), new Set());

	const expectedLegs = spec.locomotion.type === 'flyer' ? null : LEG_COUNTS[spec.locomotion.type];
	if (expectedLegs !== null && legCount !== expectedLegs) {
		fail('locomotion.type', `requires ${expectedLegs} leg parts`);
	}

	if (options.maxParts !== undefined && slotCount > options.maxParts) {
		fail('spec.maxParts', `compiled slot count ${slotCount} exceeds maxParts ${options.maxParts}`);
	}

	return {
		...spec,
		scale: spec.scale ?? 1,
		parts: spec.parts.map((part) => ({ ...part })),
		__slotCount: slotCount,
	};
}

export const schemaConstants = {
	locomotionTypes: [...LOCOMOTION_TYPES],
	shapes: [...SHAPES],
};
