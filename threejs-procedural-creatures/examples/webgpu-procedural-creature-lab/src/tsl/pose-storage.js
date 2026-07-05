export const POSE_FLOATS_PER_SLOT = 8;

export function createPoseStorage(maxInstances, maxParts) {
	const instanceCount = Math.max(1, Math.floor(maxInstances));
	const partCount = Math.max(1, Math.floor(maxParts));
	const data = new Float32Array(instanceCount * partCount * POSE_FLOATS_PER_SLOT);
	return {
		instanceCount,
		partCount,
		stride: POSE_FLOATS_PER_SLOT,
		data,
		writePose(instanceIndex, pose) {
			if (!(pose instanceof Float32Array)) throw new Error('pose-storage.writePose requires Float32Array pose');
			if (instanceIndex < 0 || instanceIndex >= instanceCount) throw new Error(`pose-storage instance ${instanceIndex} out of range`);
			const slots = Math.min(partCount, Math.floor(pose.length / POSE_FLOATS_PER_SLOT));
			const offset = instanceIndex * partCount * POSE_FLOATS_PER_SLOT;
			data.fill(0, offset, offset + partCount * POSE_FLOATS_PER_SLOT);
			data.set(pose.subarray(0, slots * POSE_FLOATS_PER_SLOT), offset);
			return { offset, slots };
		},
		readPose(instanceIndex, slotCount = partCount) {
			if (instanceIndex < 0 || instanceIndex >= instanceCount) throw new Error(`pose-storage instance ${instanceIndex} out of range`);
			const slots = Math.min(partCount, Math.max(0, Math.floor(slotCount)));
			const offset = instanceIndex * partCount * POSE_FLOATS_PER_SLOT;
			return data.slice(offset, offset + slots * POSE_FLOATS_PER_SLOT);
		},
	};
}

export function slotOffset(instanceIndex, maxParts, slotIndex) {
	return (instanceIndex * maxParts + slotIndex) * POSE_FLOATS_PER_SLOT;
}
