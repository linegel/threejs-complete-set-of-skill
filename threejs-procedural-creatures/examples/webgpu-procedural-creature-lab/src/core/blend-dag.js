const K_FLOOR = 1e-5;

function stableStringify(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function fail(path, message) {
	throw new Error(`${path} ${message}`);
}

function validateRef(ref, partIds, nodeIds, path) {
	if (!ref || typeof ref !== 'object' || Array.isArray(ref)) fail(path, 'must be {part} or {node}');
	const hasPart = typeof ref.part === 'string';
	const hasNode = typeof ref.node === 'string';
	if (hasPart === hasNode) fail(path, 'must contain exactly one of part or node');
	if (hasPart && !partIds.has(ref.part)) fail(`${path}.part`, `references unknown part '${ref.part}'`);
	if (hasNode && !nodeIds.has(ref.node)) fail(`${path}.node`, `references unknown node '${ref.node}'`);
}

export function validateBlendSchema(blend, partIdsInput) {
	if (blend === undefined || blend === null) return null;
	const partIds = partIdsInput instanceof Set ? partIdsInput : new Set(partIdsInput);
	if (!blend || typeof blend !== 'object' || Array.isArray(blend)) fail('blend.value', 'must be an object');
	if (blend.mode !== 'tree') fail('blend.mode', "must be 'tree' for the polynomial canonical path");
	if (!Array.isArray(blend.nodes) || blend.nodes.length === 0) fail('blend.nodes', 'must be a non-empty array');
	if (!Array.isArray(blend.roots) || blend.roots.length !== 1) fail('blend.roots', 'must contain exactly one explicit root');

	const nodeIds = new Set();
	for (const node of blend.nodes) {
		if (!node || typeof node !== 'object') fail('blend.nodes[].value', 'must be an object');
		if (typeof node.id !== 'string' || node.id.length === 0) fail('blend.nodes[].id', 'must be non-empty');
		if (nodeIds.has(node.id)) fail(`${node.id}.id`, 'must be unique');
		nodeIds.add(node.id);
		if (!(Number.isFinite(node.k) && node.k > 0)) fail(`${node.id}.k`, 'must be finite and > 0');
	}
	for (const node of blend.nodes) {
		validateRef(node.left, partIds, nodeIds, `${node.id}.left`);
		validateRef(node.right, partIds, nodeIds, `${node.id}.right`);
	}
	validateRef(blend.roots[0], partIds, nodeIds, 'blend.roots[0]');

	const byId = new Map(blend.nodes.map((node) => [node.id, node]));
	const visiting = new Set();
	const visited = new Set();
	const reachedParts = new Map();
	const nodeReferenceCounts = new Map(blend.nodes.map((node) => [node.id, 0]));
	for (const node of blend.nodes) {
		for (const ref of [node.left, node.right]) {
			if (ref.node) nodeReferenceCounts.set(ref.node, nodeReferenceCounts.get(ref.node) + 1);
		}
	}
	if (blend.roots[0].node) {
		nodeReferenceCounts.set(blend.roots[0].node, nodeReferenceCounts.get(blend.roots[0].node) + 1);
	}
	for (const [nodeId, referenceCount] of nodeReferenceCounts) {
		if (referenceCount !== 1) fail(`${nodeId}.node`, `must have exactly one parent/root reference, received ${referenceCount}`);
	}
	function visitRef(ref) {
		if (ref.part) {
			reachedParts.set(ref.part, (reachedParts.get(ref.part) ?? 0) + 1);
			return;
		}
		if (visiting.has(ref.node)) fail(`${ref.node}.node`, 'must be acyclic');
		if (visited.has(ref.node)) return;
		visiting.add(ref.node);
		const node = byId.get(ref.node);
		visitRef(node.left);
		visitRef(node.right);
		visiting.delete(ref.node);
		visited.add(ref.node);
	}
	visitRef(blend.roots[0]);
	for (const partId of partIds) {
		const count = reachedParts.get(partId) ?? 0;
		if (count === 0) fail('blend.roots', `does not reach rendered part '${partId}'`);
		if (count !== 1) fail('blend.roots', `reaches rendered part '${partId}' ${count} times; expected exactly once`);
	}
	if (reachedParts.size !== partIds.size) fail('blend.roots', 'must reach every rendered part exactly once');
	return {
		mode: 'tree',
		roots: blend.roots.map((ref) => ({ ...ref })),
		nodes: blend.nodes.map((node) => ({ ...node, left: { ...node.left }, right: { ...node.right } })),
	};
}

function balanced(items, combine) {
	if (items.length === 0) throw new Error('blend DAG cannot be empty');
	let level = items.slice();
	while (level.length > 1) {
		const next = [];
		for (let index = 0; index < level.length; index += 2) {
			next.push(index + 1 < level.length ? combine(level[index], level[index + 1]) : level[index]);
		}
		level = next;
	}
	return level[0];
}

export function compileBlendDag({ spec, parts, slots, partSlotIndices }) {
	const operations = [];
	const partRoots = new Map();
	const canonicalByOperation = [];

	function leaf(slot) {
		const primitive = slots[slot];
		const canonical = stableStringify({
			kind: 'leaf',
			a: primitive.a,
			b: primitive.b,
			ra: primitive.ra,
			rb: primitive.rb,
			k: primitive.k,
			slotClass: primitive.slotClass,
		});
		const index = operations.length;
		operations.push({ kind: 'leaf', slot });
		canonicalByOperation.push(canonical);
		return index;
	}

	function combine(leftInput, rightInput, kInput, source = 'authored') {
		let left = leftInput;
		let right = rightInput;
		if (canonicalByOperation[right] < canonicalByOperation[left]) [left, right] = [right, left];
		const k = Math.max(Number(kInput), K_FLOOR);
		const canonical = stableStringify({
			kind: 'smin',
			k,
			left: canonicalByOperation[left],
			right: canonicalByOperation[right],
		});
		const index = operations.length;
		operations.push({ kind: 'smin', left, right, k, source });
		canonicalByOperation.push(canonical);
		return index;
	}

	for (const part of parts) {
		const indices = partSlotIndices.get(part.id) ?? [];
		const leaves = indices.map(leaf);
		const partK = Math.max(K_FLOOR, ...indices.map((slot) => slots[slot].k));
		partRoots.set(part.id, balanced(leaves, (left, right) => combine(left, right, partK, 'part-slot-chain')));
	}

	const authored = validateBlendSchema(spec.blend, new Set(parts.map((part) => part.id)));
	let root;
	let source;
	if (authored) {
		const byId = new Map(authored.nodes.map((node) => [node.id, node]));
		const compiledNodes = new Map();
		function compileRef(ref) {
			if (ref.part) return partRoots.get(ref.part);
			if (compiledNodes.has(ref.node)) return compiledNodes.get(ref.node);
			const node = byId.get(ref.node);
			const index = combine(compileRef(node.left), compileRef(node.right), node.k, 'authored-tree');
			compiledNodes.set(ref.node, index);
			return index;
		}
		root = compileRef(authored.roots[0]);
		source = 'authored-tree';
	} else {
		const roots = parts.map((part) => partRoots.get(part.id));
		const k = Math.max(K_FLOOR, ...slots.map((slot) => slot.k));
		root = balanced(roots, (left, right) => combine(left, right, k, 'generated-explicit-tree'));
		source = 'generated-explicit-tree';
	}

	const reachedLeaves = new Set();
	function visit(index) {
		const operation = operations[index];
		if (operation.kind === 'leaf') {
			reachedLeaves.add(operation.slot);
			return;
		}
		visit(operation.left);
		visit(operation.right);
	}
	visit(root);
	if (reachedLeaves.size !== slots.length) {
		throw new Error(`blend DAG reaches ${reachedLeaves.size}/${slots.length} primitive slots`);
	}

	return Object.freeze({
		version: 'creature-blend-dag-v3',
		kernel: 'polynomial-smooth-min',
		source,
		operations: Object.freeze(operations.map((operation) => Object.freeze({ ...operation }))),
		root,
		leafSlots: Object.freeze([...reachedLeaves].sort((a, b) => a - b)),
		canonicalSource: canonicalByOperation[root],
	});
}

export function exactCandidateCertificate(blendDag, candidates) {
	const included = new Set(candidates);
	const omittedLeaves = blendDag.leafSlots.filter((slot) => !included.has(slot));
	const exact = omittedLeaves.length === 0;
	return Object.freeze({
		version: 'creature-candidate-certificate-v3',
		status: exact ? 'accepted-exact' : 'insufficient',
		blendDagVersion: blendDag.version,
		preservesBlendAncestry: exact,
		omittedLeaves: Object.freeze(omittedLeaves),
		distanceTailBound: exact ? 0 : Number.POSITIVE_INFINITY,
		normalAngularBoundRadians: exact ? 0 : Number.POSITIVE_INFINITY,
		colorWeightBound: exact ? 0 : 1,
		perceptualColorDeltaEBound: exact ? 0 : Number.POSITIVE_INFINITY,
	});
}

export { stableStringify as stableBlendStringify };
