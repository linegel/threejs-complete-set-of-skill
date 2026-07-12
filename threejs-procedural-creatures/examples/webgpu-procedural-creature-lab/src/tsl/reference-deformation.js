import {
	Fn,
	If,
	attribute,
	abs,
	clamp,
	cos,
	cross,
	dot,
	exp,
	float,
	instanceIndex,
	int,
	length,
	max,
	min,
	mix,
	normalLocal,
	normalize,
	positionLocal,
	select,
	sin,
	vec3,
	vec4,
} from 'three/tsl';

import { buildFieldNodes } from './field-nodes.js';

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

function multiplyQuaternion(left, right) {
	return vec4(
		left.w.mul(right.x).add(left.x.mul(right.w)).add(left.y.mul(right.z)).sub(left.z.mul(right.y)),
		left.w.mul(right.y).sub(left.x.mul(right.z)).add(left.y.mul(right.w)).add(left.z.mul(right.x)),
		left.w.mul(right.z).add(left.x.mul(right.y)).sub(left.y.mul(right.x)).add(left.z.mul(right.w)),
		left.w.mul(right.w).sub(left.x.mul(right.x)).sub(left.y.mul(right.y)).sub(left.z.mul(right.z)),
	);
}

function rotateQuaternion(real, value) {
	const twiceCross = cross(real.xyz, value).mul(2);
	return value.add(twiceCross.mul(real.w)).add(cross(real.xyz, twiceCross));
}

export function buildReferenceDeformationNodes(options = {}) {
	const storage = options.storage;
	const slotCount = Math.floor(Number(options.slotCount));
	const skinningMethod = options.skinningMethod ?? 'lbs';
	const correctionLayout = options.correctionLayout ?? 'none';
	if (!storage?.transformsNode || !storage?.posesNode || !storage?.rootsNode || !storage?.visibleSlotsNode) throw new Error('reference deformation requires page storage bindings');
	if (!(slotCount > 0)) throw new Error('reference deformation slotCount must be positive');
	if (skinningMethod !== 'lbs' && skinningMethod !== 'dqs-log-scale') throw new Error(`unsupported reference skinning method '${skinningMethod}'`);
	if (correctionLayout !== 'none' && correctionLayout !== 'bounded-static-feather') throw new Error(`unsupported reference correction layout '${correctionLayout}'`);
	if (correctionLayout !== 'none' && !options.blendDag) throw new Error('reference correction requires the certified blend DAG');
	const skinIndex = attribute(options.skinIndexAttribute ?? 'skinIndex', 'uvec4');
	const skinWeight = attribute(options.skinWeightAttribute ?? 'skinWeight', 'vec4');
	const correctionWeight = attribute(options.correctionWeightAttribute ?? 'correctionWeight', 'float');
	const stableSlot = int(storage.visibleSlotsNode.element(int(instanceIndex)));
	const root = storage.rootsNode.element(stableSlot);

	function rowsFor(slotNode, normal = false) {
		const base = stableSlot.mul(int(slotCount * 6)).add(slotNode.mul(int(6))).add(int(normal ? 3 : 0));
		return [0, 1, 2].map((row) => storage.transformsNode.element(base.add(int(row))));
	}

	const lbsPosition = Fn(() => {
		const result = vec3(0).toVar();
		for (let influence = 0; influence < 4; influence++) {
			const slotNode = int(skinIndex[COMPONENTS[influence]]);
			const weightNode = float(skinWeight[COMPONENTS[influence]]);
			result.addAssign(affinePosition(rowsFor(slotNode), positionLocal).mul(weightNode));
		}
		return result;
	})();

	function dqSlot(slotNode) {
		const base = stableSlot.mul(int(slotCount * 6)).add(slotNode.mul(int(6)));
		return {
			real: storage.transformsNode.element(base),
			dual: storage.transformsNode.element(base.add(int(1))),
			logScale: storage.transformsNode.element(base.add(int(2))).xyz,
			center: storage.transformsNode.element(base.add(int(3))).xyz,
			radialX: storage.transformsNode.element(base.add(int(4))).xyz,
			radialZ: storage.transformsNode.element(base.add(int(5))).xyz,
		};
	}

	function scaledAboutSlot(value, slot) {
		const offset = value.sub(slot.center);
		const axis = normalize(cross(slot.radialZ, slot.radialX));
		return slot.center
			.add(slot.radialX.mul(dot(offset, slot.radialX)).mul(exp(slot.logScale.x)))
			.add(axis.mul(dot(offset, axis)).mul(exp(slot.logScale.y)))
			.add(slot.radialZ.mul(dot(offset, slot.radialZ)).mul(exp(slot.logScale.z)));
	}

	const dqsPosition = Fn(() => {
		const firstSlot = int(skinIndex.x);
		const referenceReal = dqSlot(firstSlot).real;
		const realSum = vec4(0).toVar();
		const dualSum = vec4(0).toVar();
		const scaledPosition = vec3(0).toVar();
		for (let influence = 0; influence < 4; influence++) {
			const slotNode = int(skinIndex[COMPONENTS[influence]]);
			const weightNode = float(skinWeight[COMPONENTS[influence]]);
			const slot = dqSlot(slotNode);
			const sign = select(dot(referenceReal, slot.real).lessThan(0), float(-1), float(1));
			realSum.addAssign(slot.real.mul(weightNode).mul(sign));
			dualSum.addAssign(slot.dual.mul(weightNode).mul(sign));
			scaledPosition.addAssign(scaledAboutSlot(positionLocal, slot).mul(weightNode));
		}
		const realLength = max(length(realSum), float(1e-8));
		const real = realSum.div(realLength).toVar();
		const dualNormalized = dualSum.div(realLength);
		const dual = dualNormalized.sub(real.mul(dot(real, dualNormalized))).toVar();
		const translation = multiplyQuaternion(dual, vec4(real.xyz.negate(), real.w)).xyz.mul(2);
		return rotateQuaternion(real, scaledPosition).add(translation);
	})();

	const skinOnlyPosition = skinningMethod === 'dqs-log-scale' ? dqsPosition : lbsPosition;
	let localPosition = skinOnlyPosition;
	if (correctionLayout === 'bounded-static-feather') {
		const trustRadius = Number(options.correctionTrustRadius);
		const trials = Math.floor(Number(options.correctionTrials));
		if (!(trustRadius > 0 && Number.isFinite(trustRadius))) throw new Error('reference correction trust radius must be finite and > 0');
		if (!(trials > 0 && trials <= 2)) throw new Error('reference correction trials must be 1 or 2');
		const fieldNodes = buildFieldNodes({
			poseStorage: { poseNode: storage.posesNode, maxParts: slotCount },
			candidateStorage: { node: storage.transformsNode, maxParts: slotCount, entriesPerSlot: 1 },
			blendDag: options.blendDag,
			maxParts: slotCount,
		});
		localPosition = Fn(() => {
			const original = vec3(skinOnlyPosition).toVar();
			const corrected = vec3(skinOnlyPosition).toVar();
			for (let trial = 0; trial < trials; trial++) {
				const field = fieldNodes.evaluateFieldVec4(corrected, stableSlot, int(0));
				const gradientSquared = max(dot(field.yzw, field.yzw), float(1e-8));
				const newton = field.yzw.mul(field.x.div(gradientSquared));
				const remainingTrust = max(float(trustRadius).sub(length(corrected.sub(original))), float(0));
				const stepScale = min(float(1), remainingTrust.div(max(length(newton), float(1e-8))));
				const candidate = corrected.sub(newton.mul(stepScale));
				const candidateField = fieldNodes.evaluateFieldVec4(candidate, stableSlot, int(0));
				const currentResidual = abs(field.x).div(max(length(field.yzw), float(1e-8)));
				const candidateResidual = abs(candidateField.x).div(max(length(candidateField.yzw), float(1e-8)));
				If(candidateResidual.lessThan(currentResidual), () => corrected.assign(candidate));
			}
			return mix(original, corrected, clamp(correctionWeight, 0, 1));
		})();
	}

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

	return Object.freeze({ stableSlot, localPosition, localNormal, worldPosition, worldNormal, root, skinningMethod, correctionLayout });
}
