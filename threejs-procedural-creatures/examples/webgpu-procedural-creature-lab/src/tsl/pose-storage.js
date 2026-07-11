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

function markAttributeDirty(attribute, start = 0, count = null) {
	if (!attribute) return;
	attribute.needsUpdate = true;
	if (typeof attribute.addUpdateRange === 'function') {
		attribute.addUpdateRange(start, count ?? (attribute.array?.length ?? attribute.value?.length ?? 0));
	}
}

function safeNodeName(label) {
	return String(label ?? 'CreatureStorage')
		.replace(/[^A-Za-z0-9_]/g, '_')
		.replace(/^[^A-Za-z_]+/, 'Creature_');
}

export function slotVec4Offset(creatureIndex, maxParts, slotIndex) {
	return (creatureIndex * maxParts + slotIndex) * POSE_VEC4S_PER_SLOT;
}

export function slotFloatOffset(creatureIndex, maxParts, slotIndex) {
	return slotVec4Offset(creatureIndex, maxParts, slotIndex) * 4;
}

export function createCandidateStorage({ candidateSets, maxParts, K, certificateDigest = null, label = 'CreatureCandidateStorage' } = {}) {
	const partCount = positiveInteger(maxParts, 'maxParts');
	const candidateK = positiveInteger(K ?? 1, 'K');
	const entriesPerSlot = candidateK + 1;
	const node = instancedArray(partCount * entriesPerSlot, 'int').setName(safeNodeName(label));
	const { attribute, array } = storageArray(node);
	array.fill(0);

	if (candidateSets) {
		for (let slot = 0; slot < Math.min(partCount, candidateSets.length); slot++) {
			const set = candidateSets[slot] ?? [];
			if (set.length > candidateK) {
				throw new Error(`candidate storage slot ${slot} has ${set.length} contributors, exceeding total K=${candidateK}`);
			}
			if (!set.includes(slot)) {
				throw new Error(`candidate storage slot ${slot} omits its owning primitive from total K=${candidateK}`);
			}
			const count = set.length;
			const base = slot * entriesPerSlot;
			array[base] = count;
			for (let i = 0; i < count; i++) array[base + 1 + i] = set[i] | 0;
		}
	}

	let pendingUpload = true;
	markAttributeDirty(attribute);

	return {
		node,
		attribute,
		array,
		maxParts: partCount,
		K: candidateK,
		entriesPerSlot,
		byteLength: array.byteLength,
		certificateDigest,
		markDirty(force = false) {
			if (!pendingUpload && force !== true) return { bytes: 0, range: null };
			attribute.clearUpdateRanges?.();
			markAttributeDirty(attribute);
			pendingUpload = false;
			return { bytes: array.byteLength, range: { start: 0, count: array.length } };
		},
		dispose() {
			node.dispose?.();
		},
	};
}

function writeTransportedRadialFrame(pose, base, restFrame, target, targetOffset) {
	let axisX = pose[base + 4] - pose[base + 0];
	let axisY = pose[base + 5] - pose[base + 1];
	let axisZ = pose[base + 6] - pose[base + 2];
	let magnitude = Math.hypot(axisX, axisY, axisZ);
	if (!(magnitude > 1e-10)) {
		axisX = 0;
		axisY = 1;
		axisZ = 0;
		magnitude = 1;
	}
	axisX /= magnitude;
	axisY /= magnitude;
	axisZ /= magnitude;
	const restX = restFrame?.x ?? [1, 0, 0];
	const projection = restX[0] * axisX + restX[1] * axisY + restX[2] * axisZ;
	let x = restX[0] - projection * axisX;
	let y = restX[1] - projection * axisY;
	let z = restX[2] - projection * axisZ;
	magnitude = Math.hypot(x, y, z);
	if (!(magnitude > 1e-10)) {
		const restZ = restFrame?.z ?? [0, 0, 1];
		x = restZ[1] * axisZ - restZ[2] * axisY;
		y = restZ[2] * axisX - restZ[0] * axisZ;
		z = restZ[0] * axisY - restZ[1] * axisX;
		magnitude = Math.hypot(x, y, z);
		if (!(magnitude > 1e-10)) {
			x = 1;
			y = 0;
			z = 0;
			magnitude = 1;
		}
	}
	target[targetOffset + 0] = x / magnitude;
	target[targetOffset + 1] = y / magnitude;
	target[targetOffset + 2] = z / magnitude;
	target[targetOffset + 3] = 1;
}

export function createPoseStorage({ maxCreatures, maxParts, candidateK = 8 } = {}) {
	const creatureCount = positiveInteger(maxCreatures, 'maxCreatures');
	const partCount = positiveInteger(maxParts, 'maxParts');
	const poseNode = instancedArray(creatureCount * partCount * POSE_VEC4S_PER_SLOT, 'vec4').setName('CreaturePoseStorage');
	const { attribute: poseAttribute, array: poseArray } = storageArray(poseNode);

	const rootsNode = instancedArray(creatureCount, 'vec4').setName('CreatureRootStorage');
	const { attribute: rootsAttribute, array: rootsArray } = storageArray(rootsNode);
	const framesNode = instancedArray(creatureCount * partCount, 'vec4').setName('CreatureRadialFrameStorage');
	const { attribute: framesAttribute, array: framesArray } = storageArray(framesNode);
	const slotCounts = new Uint16Array(creatureCount);
	let poseDirtyStart = Number.POSITIVE_INFINITY;
	let poseDirtyEnd = 0;
	let rootDirtyStart = Number.POSITIVE_INFINITY;
	let rootDirtyEnd = 0;
	let frameDirtyStart = Number.POSITIVE_INFINITY;
	let frameDirtyEnd = 0;
	let disposed = false;

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

	function writePose(creatureIndex, poseFloat32, slotCount, radialFrames = null) {
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
		const previousSlots = slotCounts[index];
		const activeFloats = slots * POSE_FLOATS_PER_SLOT;
		poseArray.set(poseFloat32.length === activeFloats ? poseFloat32 : poseFloat32.subarray(0, activeFloats), offset);
		if (previousSlots > slots) poseArray.fill(0, offset + activeFloats, offset + previousSlots * POSE_FLOATS_PER_SLOT);
		slotCounts[index] = slots;
		poseDirtyStart = Math.min(poseDirtyStart, offset);
		poseDirtyEnd = Math.max(poseDirtyEnd, offset + Math.max(slots, previousSlots) * POSE_FLOATS_PER_SLOT);
		const frameOffset = index * partCount * 4;
		for (let slot = 0; slot < slots; slot++) {
			writeTransportedRadialFrame(
				poseFloat32,
				slot * POSE_FLOATS_PER_SLOT,
				radialFrames?.[slot],
				framesArray,
				frameOffset + slot * 4,
			);
		}
		frameDirtyStart = Math.min(frameDirtyStart, frameOffset);
		frameDirtyEnd = Math.max(frameDirtyEnd, frameOffset + slots * 4);
		return { offset, slots };
	}

	function writeRoot(creatureIndex, root = {}) {
		const index = checkCreatureIndex(creatureIndex);
		const position = root.position ?? [0, 0, 0];
		writeRootValues(index, position[0], position[1], position[2], root.yaw);
	}

	function writeRootValues(creatureIndex, x, y, z, yaw) {
		const index = checkCreatureIndex(creatureIndex);
		const base = index * 4;
		rootsArray[base + 0] = Number.isFinite(x) ? x : 0;
		rootsArray[base + 1] = Number.isFinite(y) ? y : 0;
		rootsArray[base + 2] = Number.isFinite(z) ? z : 0;
		rootsArray[base + 3] = Number.isFinite(yaw) ? yaw : 0;
		rootDirtyStart = Math.min(rootDirtyStart, base);
		rootDirtyEnd = Math.max(rootDirtyEnd, base + 4);
	}

	function readPose(creatureIndex, slotCount = partCount) {
		const index = checkCreatureIndex(creatureIndex);
		const slots = Math.min(partCount, Math.max(0, Math.floor(slotCount)));
		const offset = index * partCount * POSE_FLOATS_PER_SLOT;
		return poseArray.slice(offset, offset + slots * POSE_FLOATS_PER_SLOT);
	}

	function markDirty() {
		if (disposed) throw new Error('pose storage is disposed');
		const upload = { pose: null, roots: null, frames: null, bytes: 0 };
		if (poseDirtyEnd > poseDirtyStart) {
			poseAttribute.clearUpdateRanges?.();
			const count = poseDirtyEnd - poseDirtyStart;
			markAttributeDirty(poseAttribute, poseDirtyStart, count);
			upload.pose = { start: poseDirtyStart, count };
			upload.bytes += count * poseArray.BYTES_PER_ELEMENT;
		}
		if (rootDirtyEnd > rootDirtyStart) {
			rootsAttribute.clearUpdateRanges?.();
			const count = rootDirtyEnd - rootDirtyStart;
			markAttributeDirty(rootsAttribute, rootDirtyStart, count);
			upload.roots = { start: rootDirtyStart, count };
			upload.bytes += count * rootsArray.BYTES_PER_ELEMENT;
		}
		if (frameDirtyEnd > frameDirtyStart) {
			framesAttribute.clearUpdateRanges?.();
			const count = frameDirtyEnd - frameDirtyStart;
			markAttributeDirty(framesAttribute, frameDirtyStart, count);
			upload.frames = { start: frameDirtyStart, count };
			upload.bytes += count * framesArray.BYTES_PER_ELEMENT;
		}
		poseDirtyStart = rootDirtyStart = frameDirtyStart = Number.POSITIVE_INFINITY;
		poseDirtyEnd = rootDirtyEnd = frameDirtyEnd = 0;
		return upload;
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		poseNode.dispose?.();
		rootsNode.dispose?.();
		framesNode.dispose?.();
		defaultCandidateStorage.dispose();
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
		framesNode,
		framesAttribute,
		framesArray,
		candidateStorage: defaultCandidateStorage,
		writePose,
		writeRoot,
		writeRootValues,
		readPose,
		markDirty,
		dispose,
		bindingIdentity: Object.freeze({ poseNode, rootsNode, framesNode }),
	};
}
