import { instancedArray } from 'three/tsl';

export const REFERENCE_TRANSFORM_VEC4S = 6;
export const REFERENCE_PAGE_STORAGE_VERSION = 'creature-reference-page-storage-v1';

function positiveInteger(value, name) {
	const result = Math.floor(Number(value));
	if (!(result > 0)) throw new Error(`${name} must be a positive integer`);
	return result;
}

function mapped(node) {
	const attribute = node?.value;
	const array = attribute?.array ?? attribute?.value;
	if (!attribute || !array) throw new Error('reference page storage node is not mapped');
	return { node, attribute, array };
}

function dirtyTracker() {
	return { start: Infinity, end: 0 };
}

function include(tracker, start, count) {
	tracker.start = Math.min(tracker.start, start);
	tracker.end = Math.max(tracker.end, start + count);
}

function upload(attribute, array, tracker) {
	if (!(tracker.end > tracker.start)) return { range: null, bytes: 0 };
	const count = tracker.end - tracker.start;
	attribute.clearUpdateRanges?.();
	attribute.addUpdateRange?.(tracker.start, count);
	attribute.needsUpdate = true;
	const result = { range: { start: tracker.start, count }, bytes: count * array.BYTES_PER_ELEMENT };
	tracker.start = Infinity;
	tracker.end = 0;
	return result;
}

export function createReferencePageStorage(options = {}) {
	const capacity = positiveInteger(options.capacity, 'reference page capacity');
	const slotCount = positiveInteger(options.slotCount, 'reference page slotCount');
	const transformsNode = instancedArray(capacity * slotCount * REFERENCE_TRANSFORM_VEC4S, 'vec4').setName(options.transformsLabel ?? 'CreatureReferenceTransforms');
	const rootsNode = instancedArray(capacity, 'vec4').setName(options.rootsLabel ?? 'CreatureReferenceRoots');
	const visibleSlotsNode = instancedArray(capacity, 'int').setName(options.visibleLabel ?? 'CreatureReferenceVisibleSlots');
	const transforms = mapped(transformsNode);
	const roots = mapped(rootsNode);
	const visible = mapped(visibleSlotsNode);
	const transformDirty = dirtyTracker();
	const rootDirty = dirtyTracker();
	const visibleDirty = dirtyTracker();
	let visibleCount = 0;
	let disposed = false;

	function stableSlot(value) {
		const slot = Math.floor(Number(value));
		if (!Number.isFinite(slot) || slot < 0 || slot >= capacity) throw new Error(`reference page slot '${value}' is out of range`);
		return slot;
	}

	function writeTransforms(slotValue, values) {
		const slot = stableSlot(slotValue);
		const expected = slotCount * REFERENCE_TRANSFORM_VEC4S * 4;
		if (!(values instanceof Float32Array) || values.length !== expected) throw new Error(`reference transforms require ${expected} Float32 values`);
		const offset = slot * expected;
		let changed = false;
		for (let index = 0; index < expected; index++) if (transforms.array[offset + index] !== values[index]) { changed = true; break; }
		if (!changed) return { slot, offset, count: 0 };
		transforms.array.set(values, offset);
		include(transformDirty, offset, expected);
		return { slot, offset, count: expected };
	}

	function writeRoot(slotValue, x, y, z, yaw) {
		const slot = stableSlot(slotValue);
		const offset = slot * 4;
		const values = [x, y, z, yaw].map((value) => Number.isFinite(value) ? value : 0);
		if (values.every((value, index) => roots.array[offset + index] === value)) return { slot, offset, count: 0 };
		roots.array.set(values, offset);
		include(rootDirty, offset, 4);
		return { slot, offset, count: 4 };
	}

	function writeVisibleSlots(slots) {
		if (!Array.isArray(slots) && !(slots instanceof Uint32Array) && !(slots instanceof Int32Array)) throw new Error('visible slots must be an integer array');
		if (slots.length > capacity) throw new Error(`visible slot count ${slots.length} exceeds page capacity ${capacity}`);
		if (slots.length === visibleCount && slots.every((slot, index) => visible.array[index] === slot)) return visibleCount;
		const seen = new Set();
		for (let index = 0; index < slots.length; index++) {
			const slot = stableSlot(slots[index]);
			if (seen.has(slot)) throw new Error(`visible page slot '${slot}' is duplicated`);
			seen.add(slot);
			visible.array[index] = slot;
		}
		const previousCount = visibleCount;
		if (previousCount > slots.length) visible.array.fill(0, slots.length, previousCount);
		visibleCount = slots.length;
		include(visibleDirty, 0, Math.max(previousCount, visibleCount));
		return visibleCount;
	}

	function markDirty() {
		if (disposed) throw new Error('reference page storage is disposed');
		const transformUpload = upload(transforms.attribute, transforms.array, transformDirty);
		const rootUpload = upload(roots.attribute, roots.array, rootDirty);
		const visibleUpload = upload(visible.attribute, visible.array, visibleDirty);
		return {
			transforms: transformUpload,
			roots: rootUpload,
			visibleSlots: visibleUpload,
			totalBytes: transformUpload.bytes + rootUpload.bytes + visibleUpload.bytes,
		};
	}

	return {
		version: REFERENCE_PAGE_STORAGE_VERSION,
		capacity,
		slotCount,
		transformsNode: transforms.node,
		transformsArray: transforms.array,
		rootsNode: roots.node,
		rootsArray: roots.array,
		visibleSlotsNode: visible.node,
		visibleSlotsArray: visible.array,
		get visibleCount() { return visibleCount; },
		writeTransforms,
		writeRoot,
		writeVisibleSlots,
		markDirty,
		dispose() {
			if (disposed) return;
			disposed = true;
			transforms.node.dispose?.();
			roots.node.dispose?.();
			visible.node.dispose?.();
		},
	};
}
