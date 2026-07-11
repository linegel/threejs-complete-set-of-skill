import {
	Fn,
	If,
	Loop,
	abs,
	clamp,
	dot,
	exp,
	float,
	int,
	length,
	max,
	mix,
	normalize,
	select,
	vec3,
	vec4,
} from 'three/tsl';
import { evaluateField } from '../core/field.js';

export const FIELD_TSL_PARITY_CONTRACT = 'CPU twin: src/core/field.js — same formulas, same commit.';

function asIntNode(value) {
	return value?.isNode ? int(value) : int(value ?? 0);
}

export function buildFieldNodes({ poseStorage, candidateStorage, blendDag = null, maxParts, tierConfig = {} } = {}) {
	if (!poseStorage?.poseNode) throw new Error('buildFieldNodes requires poseStorage.poseNode');
	if (!candidateStorage?.node) throw new Error('buildFieldNodes requires candidateStorage.node');
	const partBudget = Math.max(1, Math.floor(maxParts ?? poseStorage.maxParts ?? candidateStorage.maxParts));
	const entriesPerSlot = Math.max(1, Math.floor(candidateStorage.entriesPerSlot ?? ((tierConfig.candidateK ?? 8) + 1)));
	const snapSteps = Math.max(1, Math.floor(tierConfig.snapSteps ?? (tierConfig.tier === 'background' ? 1 : 2)));
	const maxPrimitiveRadius = float(Math.max(Number(tierConfig.maxRadius) || 0.25, 1e-4));
	const poseNode = poseStorage.poseNode;
	const candidatesNode = candidateStorage.node;
	if (blendDag && blendDag.kernel !== 'polynomial-smooth-min') {
		throw new Error(`unsupported creature blend DAG kernel '${blendDag.kernel}'`);
	}

	const primitiveBase = Fn(([creatureIndex, slotIndex]) => {
		return creatureIndex.mul(int(partBudget)).add(slotIndex).mul(int(3));
	});

	const readPrimitiveA = Fn(([creatureIndex, slotIndex]) => {
		const base = primitiveBase(creatureIndex, slotIndex);
		return poseNode.element(base);
	});

	const readPrimitiveB = Fn(([creatureIndex, slotIndex]) => {
		const base = primitiveBase(creatureIndex, slotIndex);
		return poseNode.element(base.add(int(1)));
	});

	const readPrimitiveMeta = Fn(([creatureIndex, slotIndex]) => {
		const base = primitiveBase(creatureIndex, slotIndex);
		return poseNode.element(base.add(int(2)));
	});

	function capsuleDistanceGradient(pLocal, a4, b4) {
		const a = a4.xyz;
		const ra = a4.w;
		const b = b4.xyz;
		const rb = b4.w;
		const ba = b.sub(a);
		const pa = pLocal.sub(a);
		const baLen2 = dot(ba, ba);
		const t = select(baLen2.lessThan(float(1e-12)), float(0), clamp(dot(pa, ba).div(baLen2), 0, 1));
		const q = pa.sub(ba.mul(t));
		const qLen = length(q);
		const radial = q.div(max(qLen, float(1e-6)));
		const baLen = max(length(ba), float(1e-6));
		const axis = ba.div(baLen);
		const slope = rb.sub(ra).div(baLen);
		const interior = t.greaterThan(float(0)).and(t.lessThan(float(1)));
		const grad = select(interior, radial.sub(axis.mul(slope)), radial);
		const d = qLen.sub(mix(ra, rb, t));
		return vec4(d, grad);
	}

	function evaluateBlendOperation(pLocal, creatureIndex, operationIndex) {
		const operation = blendDag.operations[operationIndex];
		if (operation.kind === 'leaf') {
			return capsuleDistanceGradient(
				pLocal,
				readPrimitiveA(creatureIndex, int(operation.slot)),
				readPrimitiveB(creatureIndex, int(operation.slot)),
			);
		}
		const left = evaluateBlendOperation(pLocal, creatureIndex, operation.left);
		const right = evaluateBlendOperation(pLocal, creatureIndex, operation.right);
		const k = float(Math.max(operation.k, 1e-5));
		const h = clamp(float(0.5).add(float(0.5).mul(left.x.sub(right.x).div(k))), 0, 1);
		return vec4(
			mix(left.x, right.x, h).sub(k.mul(h).mul(float(1).sub(h))),
			mix(left.yzw, right.yzw, h),
		);
	}

	const evaluateFieldVec4 = Fn(([pLocal, creatureIndexInput, ownerSlotInput]) => {
		const creatureIndex = asIntNode(creatureIndexInput);
		if (blendDag) return evaluateBlendOperation(pLocal, creatureIndex, blendDag.root);
		const ownerSlot = asIntNode(ownerSlotInput);
		const count = candidatesNode.element(ownerSlot.mul(int(entriesPerSlot))).toVar('candidateCount');
		const d = float(1e20).toVar('fieldDistance');
		const grad = vec3(0, 1, 0).toVar('fieldGradient');
		const dMin = float(1e20).toVar('fieldDistanceMin');

		Loop({ start: int(0), end: count, type: 'int', condition: '<', name: 'candidateLoopIndex' }, ({ candidateLoopIndex }) => {
			const slot = candidatesNode.element(ownerSlot.mul(int(entriesPerSlot)).add(candidateLoopIndex).add(int(1)));
			const a4 = readPrimitiveA(creatureIndex, slot);
			const b4 = readPrimitiveB(creatureIndex, slot);
			const meta = readPrimitiveMeta(creatureIndex, slot);
			const e = capsuleDistanceGradient(pLocal, a4, b4);
			const dPrimitive = e.x;
			const gradPrimitive = e.yzw;
			dMin.assign(minNode(dMin, dPrimitive));

			If(candidateLoopIndex.equal(int(0)), () => {
				d.assign(dPrimitive);
				grad.assign(gradPrimitive);
			}).Else(() => {
				const k = max(meta.x, float(1e-5));
				const h = clamp(float(0.5).add(float(0.5).mul(d.sub(dPrimitive).div(k))), 0, 1);
				d.assign(mix(d, dPrimitive, h).sub(k.mul(h).mul(float(1).sub(h))));
				grad.assign(mix(grad, gradPrimitive, h));
			});
		});

		return vec4(d, grad);
	});

	const evaluateColorVec3 = Fn(([pLocal, creatureIndexInput, ownerSlotInput, dMinInput]) => {
		const creatureIndex = asIntNode(creatureIndexInput);
		const ownerSlot = asIntNode(ownerSlotInput);
		const count = candidatesNode.element(ownerSlot.mul(int(entriesPerSlot))).toVar('candidateColorCount');
		const primitiveMinimum = float(1e20).toVar('candidatePrimitiveMinimum');
		Loop({ start: int(0), end: count, type: 'int', condition: '<', name: 'colorMinimumLoopIndex' }, ({ colorMinimumLoopIndex }) => {
			const slot = candidatesNode.element(ownerSlot.mul(int(entriesPerSlot)).add(colorMinimumLoopIndex).add(int(1)));
			const e = capsuleDistanceGradient(
				pLocal,
				readPrimitiveA(creatureIndex, slot),
				readPrimitiveB(creatureIndex, slot),
			);
			primitiveMinimum.assign(minNode(primitiveMinimum, e.x));
		});

		const colorSum = vec3(0).toVar('fieldColorSum');
		const weightSum = float(0).toVar('fieldWeightSum');
		Loop({ start: int(0), end: count, type: 'int', condition: '<', name: 'colorLoopIndex' }, ({ colorLoopIndex }) => {
			const slot = candidatesNode.element(ownerSlot.mul(int(entriesPerSlot)).add(colorLoopIndex).add(int(1)));
			const a4 = readPrimitiveA(creatureIndex, slot);
			const b4 = readPrimitiveB(creatureIndex, slot);
			const meta = readPrimitiveMeta(creatureIndex, slot);
			const e = capsuleDistanceGradient(pLocal, a4, b4);
			const k = max(meta.x, float(1e-5));
			const w = exp(max(e.x.sub(primitiveMinimum), float(0)).negate().div(k));
			colorSum.assign(colorSum.add(meta.yzw.mul(w)));
			weightSum.assign(weightSum.add(w));
		});

		return colorSum.div(max(weightSum, float(1e-12)));
	});

	const evaluateOwnerSlot = Fn(([pLocal, creatureIndexInput, ownerSlotInput]) => {
		const creatureIndex = asIntNode(creatureIndexInput);
		const ownerSlot = asIntNode(ownerSlotInput);
		const count = candidatesNode.element(ownerSlot.mul(int(entriesPerSlot))).toVar('candidateOwnerCount');
		const bestDistance = float(1e20).toVar('candidateOwnerDistance');
		const bestSlot = int(0x7fffffff).toVar('candidateOwnerSlot');
		Loop({ start: int(0), end: count, type: 'int', condition: '<', name: 'ownerLoopIndex' }, ({ ownerLoopIndex }) => {
			const slot = candidatesNode.element(ownerSlot.mul(int(entriesPerSlot)).add(ownerLoopIndex).add(int(1)));
			const primitiveDistance = capsuleDistanceGradient(
				pLocal,
				readPrimitiveA(creatureIndex, slot),
				readPrimitiveB(creatureIndex, slot),
			).x;
			const wins = primitiveDistance.lessThan(bestDistance)
				.or(primitiveDistance.equal(bestDistance).and(slot.lessThan(bestSlot)));
			If(wins, () => {
				bestDistance.assign(primitiveDistance);
				bestSlot.assign(slot);
			});
		});
		return bestSlot;
	});

	const snapPosition = Fn(([pStart, creatureIndexInput, ownerSlotInput, isoInput]) => {
		const creatureIndex = asIntNode(creatureIndexInput);
		const ownerSlot = asIntNode(ownerSlotInput);
		const iso = float(isoInput);
		const p = vec3(pStart).toVar('snappedShellPosition');
		const done = float(0).toVar('snapDone');
		Loop({ start: int(0), end: int(snapSteps), type: 'int', condition: '<', name: 'snapStep' }, () => {
			If(done.lessThan(float(0.5)), () => {
				const field = evaluateFieldVec4(p, creatureIndex, ownerSlot);
				const residual = field.x.sub(iso);
				If(abs(residual).lessThan(float(1e-4)), () => {
					done.assign(float(1));
				}).Else(() => {
					const grad = field.yzw;
					const move = clamp(residual.div(max(dot(grad, grad), float(1e-6))), maxPrimitiveRadius.mul(-2), maxPrimitiveRadius.mul(2));
					p.assign(p.sub(grad.mul(move)));
				});
			});
		});
		return p;
	});

	function evaluateFieldAt(pLocal, creatureIndex, ownerSlot) {
		const packed = evaluateFieldVec4(pLocal, creatureIndex, ownerSlot);
		return {
			d: packed.x,
			grad: packed.yzw,
			color: evaluateColorVec3(pLocal, creatureIndex, ownerSlot, packed.x),
			packed,
		};
	}

	function snapAndShade({ pLocal, creatureIndex, ownerSlot, iso = 0, skipSnap = false } = {}) {
		const snapped = skipSnap ? pLocal : snapPosition(pLocal, creatureIndex, ownerSlot, float(iso));
		const field = evaluateFieldAt(snapped, creatureIndex, ownerSlot);
		return { position: snapped, field };
	}

	return {
		evaluateFieldAt,
		snapAndShade,
		evaluateFieldVec4,
		evaluateColorVec3,
		evaluateOwnerSlot,
		snapPosition,
		primitiveBase,
		readPrimitiveA,
		readPrimitiveB,
		readPrimitiveMeta,
		capsuleDistanceGradient,
		partBudget,
		entriesPerSlot,
		snapSteps,
	};
}

function minNode(a, b) {
	return select(a.lessThan(b), a, b);
}

export function evaluateFieldNodeTwin(primitives, point, options = {}) {
	return evaluateField(primitives, point, options);
}

export function createFieldParityProbe(primitives, points, options = {}) {
	const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 3e-5;
	let maxError = 0;
	for (const point of points) {
		const cpu = evaluateField(primitives, point, options);
		const twin = evaluateFieldNodeTwin(primitives, point, options);
		maxError = Math.max(maxError, Math.abs(cpu.d - twin.d));
		for (let i = 0; i < 3; i++) maxError = Math.max(maxError, Math.abs(cpu.gradNormalized[i] - twin.gradNormalized[i]));
	}
	return {
		status: maxError <= tolerance ? 'pass' : 'fail',
		maxError,
		tolerance,
		samples: points.length,
	};
}
