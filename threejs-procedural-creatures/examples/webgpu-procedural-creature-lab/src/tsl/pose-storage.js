import { instancedArray } from 'three/tsl';

export const POSE_VEC4S_PER_SLOT = 3;
export const POSE_FLOATS_PER_SLOT = 12;

function positiveInteger(value, name) {
	const n = Math.floor(Number(value));
	if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
	return n;
}

function storageArray(node) {
	const attribute = node?.value;
	const array = attribute?.array ?? attribute?.value;
	if (!(array instanceof Float32Array) && !(array instanceof Int32Array) && !(array instanceof Uint32Array)) {
		throw new Error('TSL storage node does not expose a mapped typed array');
	}
	return { attribute, array };
}

function markAttributeDirty(attribute) {
	if (!attribute) return;
	attribute.needsUpdate = true;
	if (typeof attribute.addUpdateRange === 'function') {
		attribute.addUpdateRange(0, attribute.array?.length ?? attribute.value?.length ?? 0);
	}
}

export function slotVec4Offset(creatureIndex, maxParts, slotIndex) {
	return (creatureIndex * maxParts + slotIndex) * POSE_VEC4S_PER_SLOT;
}

export function slotFloatOffset(creatureIndex, maxParts, slotIndex) {
	return slotVec4Offset(creatureIndex, maxParts, slotIndex) * 4;
}

export function createCandidateStorage({ candidateSets, maxParts, K, label = 'CreatureCandidateStorage' } = {}) {
	const partCount = positiveInteger(maxParts, 'maxParts');
	const candidateK = positiveInteger(K ?? 1, 'K');
	const entriesPerSlot = candidateK + 1;
	const node = instancedArray(partCount * entriesPerSlot, 'int').setName(label);
	const { attribute, array } = storageArray(node);
	array.fill(0);

	if (candidateSets) {
		for (let slot = 0; slot < Math.min(partCount, candidateSets.length); slot++) {
			const set = candidateSets[slot] ?? [];
			const count = Math.min(candidateK, set.length);
			const base = slot * entriesPerSlot;
			array[base] = count;
			for (let i = 0; i < count; i++) array[base + 1 + i] = set[i] | 0;
		}
	}

	markAttributeDirty(attribute);

	return {
		node,
		attribute,
		array,
		maxParts: partCount,
		K: candidateK,
		entriesPerSlot,
		markDirty() {
			markAttributeDirty(attribute);
		},
	};
}

export function createPoseStorage({ maxCreatures, maxParts, candidateK = 8 } = {}) {
	const creatureCount = positiveInteger(maxCreatures, 'maxCreatures');
	const partCount = positiveInteger(maxParts, 'maxParts');
	const poseNode = instancedArray(creatureCount * partCount * POSE_VEC4S_PER_SLOT, 'vec4').setName('CreaturePoseStorage');
	const { attribute: poseAttribute, array: poseArray } = storageArray(poseNode);

	const rootsNode = instancedArray(creatureCount, 'vec4').setName('CreatureRootStorage');
	const { attribute: rootsAttribute, array: rootsArray } = storageArray(rootsNode);

	const defaultCandidateStorage = createCandidateStorage({
		maxParts: partCount,
		K: candidateK,
		label: 'CreatureDefaultCandidateStorage',
	});

	function checkCreatureIndex(creatureIndex) {
		const index = Math.floor(Number(creatureIndex));
		if (!Number.isFinite(index) || index < 0 || index >= creatureCount) {
			throw new Error(`pose-storage creature ${creatureIndex} out of range`);
		}
		return index;
	}

	function writePose(creatureIndex, poseFloat32, slotCount) {
		const index = checkCreatureIndex(creatureIndex);
		if (!(poseFloat32 instanceof Float32Array)) throw new Error('pose-storage.writePose requires Float32Array pose');
		const slots = Math.floor(Number(slotCount ?? poseFloat32.length / POSE_FLOATS_PER_SLOT));
		if (!Number.isFinite(slots) || slots < 0 || slots > partCount) {
			throw new Error(`pose-storage slotCount ${slotCount} exceeds maxParts ${partCount}`);
		}
		if (poseFloat32.length < slots * POSE_FLOATS_PER_SLOT) {
			throw new Error(`pose-storage pose length ${poseFloat32.length} cannot cover ${slots} slots`);
		}
		const offset = index * partCount * POSE_FLOATS_PER_SLOT;
		poseArray.fill(0, offset, offset + partCount * POSE_FLOATS_PER_SLOT);
		poseArray.set(poseFloat32.subarray(0, slots * POSE_FLOATS_PER_SLOT), offset);
		return { offset, slots };
	}

	function writeRoot(creatureIndex, root = {}) {
		const index = checkCreatureIndex(creatureIndex);
		const base = index * 4;
		const position = root.position ?? [0, 0, 0];
		rootsArray[base + 0] = Number.isFinite(position[0]) ? position[0] : 0;
		rootsArray[base + 1] = Number.isFinite(position[1]) ? position[1] : 0;
		rootsArray[base + 2] = Number.isFinite(position[2]) ? position[2] : 0;
		rootsArray[base + 3] = Number.isFinite(root.yaw) ? root.yaw : 0;
	}

	function readPose(creatureIndex, slotCount = partCount) {
		const index = checkCreatureIndex(creatureIndex);
		const slots = Math.min(partCount, Math.max(0, Math.floor(slotCount)));
		const offset = index * partCount * POSE_FLOATS_PER_SLOT;
		return poseArray.slice(offset, offset + slots * POSE_FLOATS_PER_SLOT);
	}

	function markDirty() {
		markAttributeDirty(poseAttribute);
		markAttributeDirty(rootsAttribute);
	}

	return {
		maxCreatures: creatureCount,
		maxParts: partCount,
		stride: POSE_FLOATS_PER_SLOT,
		vec4sPerSlot: POSE_VEC4S_PER_SLOT,
		poseNode,
		poseAttribute,
		poseArray,
		rootsNode,
		rootsAttribute,
		rootsArray,
		candidateStorage: defaultCandidateStorage,
		writePose,
		writeRoot,
		readPose,
		markDirty,
	};
}
