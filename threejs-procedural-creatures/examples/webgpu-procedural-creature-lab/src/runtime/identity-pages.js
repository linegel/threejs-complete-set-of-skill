export const IDENTITY_PAGE_VERSION = 'creature-identity-pages-v1';
export const PAGE_DIRTY_KINDS = Object.freeze(['pose', 'transform', 'root', 'bounds', 'correctionPose']);

function positiveInteger(value, name) {
	const result = Math.floor(Number(value));
	if (!(result > 0)) throw new Error(`${name} must be a positive integer`);
	return result;
}

export function creatureIdentityKey(identity) {
	const keys = ['compilerSignature', 'topologySignature', 'geometryDigest', 'tier', 'skinningMethod', 'correctionLayout'];
	for (const key of keys) if (typeof identity?.[key] !== 'string' || identity[key].length === 0) throw new Error(`creature page identity '${key}' is missing`);
	return keys.map((key) => `${key}=${identity[key]}`).join('|');
}

function coalesceSlots(slots) {
	const sorted = [...slots].sort((a, b) => a - b);
	const ranges = [];
	for (const slot of sorted) {
		const previous = ranges[ranges.length - 1];
		if (previous && previous.start + previous.count === slot) previous.count += 1;
		else ranges.push({ start: slot, count: 1 });
	}
	return ranges;
}

function createPage(key, identity, pageIndex, capacity, bytesPerSlot) {
	return {
		id: `${key}#${pageIndex}`,
		key,
		identity: Object.freeze({ ...identity }),
		pageIndex,
		capacity,
		resourceGeneration: 1,
		slots: Array.from({ length: capacity }, (_, slot) => ({ slot, allocated: false, generation: 1, versions: Object.fromEntries(PAGE_DIRTY_KINDS.map((kind) => [kind, 0])) })),
		freeSlots: Array.from({ length: capacity }, (_, slot) => capacity - 1 - slot),
		dirty: Object.fromEntries(PAGE_DIRTY_KINDS.map((kind) => [kind, new Set()])),
		visibleSlots: [],
		visibilityVersion: 0,
		bytesPerSlot: { ...bytesPerSlot },
	};
}

export class IdentityPagePool {
	constructor(options = {}) {
		this.capacity = positiveInteger(options.capacity ?? 64, 'page capacity');
		this.maximumPagesPerIdentity = positiveInteger(options.maximumPagesPerIdentity ?? 4, 'maximumPagesPerIdentity');
		this.bytesPerSlot = Object.freeze({
			pose: positiveInteger(options.bytesPerSlot?.pose ?? 4, 'pose bytesPerSlot'),
			transform: positiveInteger(options.bytesPerSlot?.transform ?? 4, 'transform bytesPerSlot'),
			root: positiveInteger(options.bytesPerSlot?.root ?? 16, 'root bytesPerSlot'),
			bounds: positiveInteger(options.bytesPerSlot?.bounds ?? 16, 'bounds bytesPerSlot'),
			correctionPose: positiveInteger(options.bytesPerSlot?.correctionPose ?? 4, 'correctionPose bytesPerSlot'),
		});
		this.pagesByKey = new Map();
		this.pagesById = new Map();
	}

	allocate(identity) {
		const key = creatureIdentityKey(identity);
		const pages = this.pagesByKey.get(key) ?? [];
		let page = pages.find((candidate) => candidate.freeSlots.length > 0);
		if (!page) {
			if (pages.length >= this.maximumPagesPerIdentity) throw new Error(`creature page budget exhausted for '${key}'`);
			page = createPage(key, identity, pages.length, this.capacity, this.bytesPerSlot);
			pages.push(page);
			this.pagesByKey.set(key, pages);
			this.pagesById.set(page.id, page);
		}
		const slot = page.freeSlots.pop();
		const record = page.slots[slot];
		record.allocated = true;
		for (const kind of PAGE_DIRTY_KINDS) {
			record.versions[kind] += 1;
			page.dirty[kind].add(slot);
		}
		return Object.freeze({ pageId: page.id, key, slot, generation: record.generation, resourceGeneration: page.resourceGeneration });
	}

	#record(handle) {
		const page = this.pagesById.get(handle?.pageId);
		const record = page?.slots?.[handle?.slot];
		if (!page || !record?.allocated || record.generation !== handle.generation || page.resourceGeneration !== handle.resourceGeneration) throw new Error('stale or invalid creature page handle');
		return { page, record };
	}

	markDirty(handle, kind) {
		if (!PAGE_DIRTY_KINDS.includes(kind)) throw new Error(`unknown page dirty kind '${kind}'`);
		const { page, record } = this.#record(handle);
		record.versions[kind] += 1;
		page.dirty[kind].add(record.slot);
		return record.versions[kind];
	}

	release(handle) {
		const { page, record } = this.#record(handle);
		record.allocated = false;
		record.generation += 1;
		for (const kind of PAGE_DIRTY_KINDS) page.dirty[kind].delete(record.slot);
		page.visibleSlots = page.visibleSlots.filter((slot) => slot !== record.slot);
		page.visibilityVersion += 1;
		page.freeSlots.push(record.slot);
		page.freeSlots.sort((a, b) => b - a);
		return record.generation;
	}

	setVisible(handles) {
		const visibleByPage = new Map();
		for (const handle of handles) {
			const { page, record } = this.#record(handle);
			const slots = visibleByPage.get(page.id) ?? [];
			slots.push(record.slot);
			visibleByPage.set(page.id, slots);
		}
		const changes = [];
		for (const page of this.pagesById.values()) {
			const next = (visibleByPage.get(page.id) ?? []).sort((a, b) => a - b);
			if (next.length === page.visibleSlots.length && next.every((slot, index) => slot === page.visibleSlots[index])) continue;
			page.visibleSlots = next;
			page.visibilityVersion += 1;
			changes.push({ pageId: page.id, slots: [...next], visibilityVersion: page.visibilityVersion, bytes: next.length * 4 });
		}
		return changes;
	}

	consumeUploads(pageId) {
		const page = this.pagesById.get(pageId);
		if (!page) throw new Error(`unknown creature page '${pageId}'`);
		const uploads = {};
		let totalBytes = 0;
		for (const kind of PAGE_DIRTY_KINDS) {
			const ranges = coalesceSlots(page.dirty[kind]);
			const bytes = ranges.reduce((sum, range) => sum + range.count * page.bytesPerSlot[kind], 0);
			uploads[kind] = { ranges, bytes };
			totalBytes += bytes;
			page.dirty[kind].clear();
		}
		return { pageId, uploads, totalBytes };
	}

	snapshot() {
		return [...this.pagesById.values()].map((page) => ({
			id: page.id,
			key: page.key,
			capacity: page.capacity,
			allocated: page.slots.filter((slot) => slot.allocated).length,
			free: page.freeSlots.length,
			visibleSlots: [...page.visibleSlots],
			visibilityVersion: page.visibilityVersion,
			resourceGeneration: page.resourceGeneration,
		}));
	}
}
