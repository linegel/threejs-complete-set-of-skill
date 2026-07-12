import {
	Fn,
	attribute,
	cos,
	float,
	instanceIndex,
	int,
	normalLocal,
	normalize,
	positionLocal,
	sin,
	vec3,
} from 'three/tsl';

const COMPONENTS = ['x', 'y', 'z', 'w'];

function affinePosition(rows, value) {
	return vec3(
		rows[0].xyz.dot(value).add(rows[0].w),
		rows[1].xyz.dot(value).add(rows[1].w),
		rows[2].xyz.dot(value).add(rows[2].w),
	);
}

function affineNormal(rows, value) {
	return vec3(rows[0].xyz.dot(value), rows[1].xyz.dot(value), rows[2].xyz.dot(value));
}

export function buildReferenceDeformationNodes(options = {}) {
	const storage = options.storage;
	const slotCount = Math.floor(Number(options.slotCount));
	if (!storage?.transformsNode || !storage?.rootsNode || !storage?.visibleSlotsNode) throw new Error('reference deformation requires page storage bindings');
	if (!(slotCount > 0)) throw new Error('reference deformation slotCount must be positive');
	const skinIndex = attribute(options.skinIndexAttribute ?? 'skinIndex', 'uvec4');
	const skinWeight = attribute(options.skinWeightAttribute ?? 'skinWeight', 'vec4');
	const stableSlot = int(storage.visibleSlotsNode.element(int(instanceIndex)));
	const root = storage.rootsNode.element(stableSlot);

	function rowsFor(slotNode, normal = false) {
		const base = stableSlot.mul(int(slotCount * 6)).add(slotNode.mul(int(6))).add(int(normal ? 3 : 0));
		return [0, 1, 2].map((row) => storage.transformsNode.element(base.add(int(row))));
	}

	const localPosition = Fn(() => {
		const result = vec3(0).toVar();
		for (let influence = 0; influence < 4; influence++) {
			const slotNode = int(skinIndex[COMPONENTS[influence]]);
			const weightNode = float(skinWeight[COMPONENTS[influence]]);
			result.addAssign(affinePosition(rowsFor(slotNode), positionLocal).mul(weightNode));
		}
		return result;
	})();

	const localNormal = Fn(() => {
		const result = vec3(0).toVar();
		for (let influence = 0; influence < 4; influence++) {
			const slotNode = int(skinIndex[COMPONENTS[influence]]);
			const weightNode = float(skinWeight[COMPONENTS[influence]]);
			result.addAssign(affineNormal(rowsFor(slotNode, true), normalLocal).mul(weightNode));
		}
		return normalize(result);
	})();

	const worldPosition = Fn(() => {
		const cy = cos(root.w);
		const sy = sin(root.w);
		return vec3(
			localPosition.x.mul(cy).add(localPosition.z.mul(sy)),
			localPosition.y,
			localPosition.x.negate().mul(sy).add(localPosition.z.mul(cy)),
		).add(root.xyz);
	})();

	const worldNormal = Fn(() => {
		const cy = cos(root.w);
		const sy = sin(root.w);
		return normalize(vec3(
			localNormal.x.mul(cy).add(localNormal.z.mul(sy)),
			localNormal.y,
			localNormal.x.negate().mul(sy).add(localNormal.z.mul(cy)),
		));
	})();

	return Object.freeze({ stableSlot, localPosition, localNormal, worldPosition, worldNormal, root });
}
