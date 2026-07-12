export const DEFORMATION_VERSION = 'creature-affine-lbs-v1';
export const SLOT_TRANSFORM_FLOATS = 24;
export const SLOT_POSE_FLOATS = 12;
export const DQ_SLOT_FLOATS = 24;

function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(value, scalar) {
	return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function dot(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function dot4(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

function cross(a, b) {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
}

function normalize(value, fallback) {
	const length = Math.hypot(value[0], value[1], value[2]);
	return length > 1e-10 ? scale(value, 1 / length) : fallback.slice();
}

function transportedFrame(restSlot, posedA, posedB) {
	const restY = restSlot.restAxis;
	const posedY = normalize(sub(posedB, posedA), restY);
	const projectedX = sub(restSlot.radialX, scale(posedY, dot(restSlot.radialX, posedY)));
	const posedX = normalize(projectedX, restSlot.radialX);
	const posedZ = normalize(cross(posedY, posedX), restSlot.radialZ);
	return {
		rest: [restSlot.radialX, restY, restSlot.radialZ],
		posed: [posedX, posedY, posedZ],
	};
}

function basisMatrix(restAxes, posedAxes, scales) {
	const matrix = new Float64Array(9);
	for (let row = 0; row < 3; row++) {
		for (let column = 0; column < 3; column++) {
			matrix[row * 3 + column] = posedAxes[0][row] * scales[0] * restAxes[0][column]
				+ posedAxes[1][row] * scales[1] * restAxes[1][column]
				+ posedAxes[2][row] * scales[2] * restAxes[2][column];
		}
	}
	return matrix;
}

function transformPoint(matrix, point, translation) {
	return [
		matrix[0] * point[0] + matrix[1] * point[1] + matrix[2] * point[2] + translation[0],
		matrix[3] * point[0] + matrix[4] * point[1] + matrix[5] * point[2] + translation[1],
		matrix[6] * point[0] + matrix[7] * point[1] + matrix[8] * point[2] + translation[2],
	];
}

function transformVector(matrix, vector) {
	return [
		matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
		matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
		matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
	];
}

function quaternionFromAxes(restAxes, posedAxes) {
	const rotation = basisMatrix(restAxes, posedAxes, [1, 1, 1]);
	const trace = rotation[0] + rotation[4] + rotation[8];
	let quaternion;
	if (trace > 0) {
		const scaleValue = Math.sqrt(trace + 1) * 2;
		quaternion = [(rotation[7] - rotation[5]) / scaleValue, (rotation[2] - rotation[6]) / scaleValue, (rotation[3] - rotation[1]) / scaleValue, scaleValue * 0.25];
	} else if (rotation[0] > rotation[4] && rotation[0] > rotation[8]) {
		const scaleValue = Math.sqrt(1 + rotation[0] - rotation[4] - rotation[8]) * 2;
		quaternion = [scaleValue * 0.25, (rotation[1] + rotation[3]) / scaleValue, (rotation[2] + rotation[6]) / scaleValue, (rotation[7] - rotation[5]) / scaleValue];
	} else if (rotation[4] > rotation[8]) {
		const scaleValue = Math.sqrt(1 + rotation[4] - rotation[0] - rotation[8]) * 2;
		quaternion = [(rotation[1] + rotation[3]) / scaleValue, scaleValue * 0.25, (rotation[5] + rotation[7]) / scaleValue, (rotation[2] - rotation[6]) / scaleValue];
	} else {
		const scaleValue = Math.sqrt(1 + rotation[8] - rotation[0] - rotation[4]) * 2;
		quaternion = [(rotation[2] + rotation[6]) / scaleValue, (rotation[5] + rotation[7]) / scaleValue, scaleValue * 0.25, (rotation[3] - rotation[1]) / scaleValue];
	}
	const length = Math.hypot(...quaternion);
	return quaternion.map((component) => component / length);
}

function multiplyQuaternion(left, right) {
	return [
		left[3] * right[0] + left[0] * right[3] + left[1] * right[2] - left[2] * right[1],
		left[3] * right[1] - left[0] * right[2] + left[1] * right[3] + left[2] * right[0],
		left[3] * right[2] + left[0] * right[1] - left[1] * right[0] + left[2] * right[3],
		left[3] * right[3] - left[0] * right[0] - left[1] * right[1] - left[2] * right[2],
	];
}

function conjugateQuaternion(value) {
	return [-value[0], -value[1], -value[2], value[3]];
}

function rotateByQuaternion(quaternion, value) {
	const rotated = multiplyQuaternion(multiplyQuaternion(quaternion, [value[0], value[1], value[2], 0]), conjugateQuaternion(quaternion));
	return rotated.slice(0, 3);
}

function dualQuaternionTranslation(real, dual) {
	const value = multiplyQuaternion(dual, conjugateQuaternion(real));
	return [value[0] * 2, value[1] * 2, value[2] * 2];
}

export function restPoseFromCompiled(compiled) {
	const pose = new Float32Array(compiled.slots.length * SLOT_POSE_FLOATS);
	for (let slot = 0; slot < compiled.slots.length; slot++) {
		const source = compiled.slots[slot];
		const offset = slot * SLOT_POSE_FLOATS;
		pose.set([source.a[0], source.a[1], source.a[2], source.ra, source.b[0], source.b[1], source.b[2], source.rb, source.k, ...source.color], offset);
	}
	return pose;
}

export function buildAffineSlotTransforms(compiled, pose) {
	if (!(pose instanceof Float32Array) || pose.length < compiled.slots.length * SLOT_POSE_FLOATS) {
		throw new Error('buildAffineSlotTransforms requires complete Float32Array slot pose data');
	}
	const transforms = new Float32Array(compiled.slots.length * SLOT_TRANSFORM_FLOATS);
	for (let slot = 0; slot < compiled.slots.length; slot++) {
		const rest = compiled.slots[slot];
		const poseOffset = slot * SLOT_POSE_FLOATS;
		const posedA = [pose[poseOffset], pose[poseOffset + 1], pose[poseOffset + 2]];
		const posedB = [pose[poseOffset + 4], pose[poseOffset + 5], pose[poseOffset + 6]];
		const frame = transportedFrame(rest, posedA, posedB);
		const restLength = Math.hypot(...sub(rest.b, rest.a));
		const posedLength = Math.hypot(...sub(posedB, posedA));
		const restRadius = Math.max((rest.ra + rest.rb) * 0.5, 1e-8);
		const posedRadius = Math.max((pose[poseOffset + 3] + pose[poseOffset + 7]) * 0.5, 1e-8);
		const radialScale = posedRadius / restRadius;
		const axialScale = restLength > 1e-8 ? posedLength / restLength : radialScale;
		const positionMatrix = basisMatrix(frame.rest, frame.posed, [radialScale, axialScale, radialScale]);
		const normalMatrix = basisMatrix(frame.rest, frame.posed, [1 / radialScale, 1 / axialScale, 1 / radialScale]);
		const mappedRestA = transformPoint(positionMatrix, rest.a, [0, 0, 0]);
		const translation = sub(posedA, mappedRestA);
		const output = slot * SLOT_TRANSFORM_FLOATS;
		for (let row = 0; row < 3; row++) {
			transforms[output + row * 4] = positionMatrix[row * 3];
			transforms[output + row * 4 + 1] = positionMatrix[row * 3 + 1];
			transforms[output + row * 4 + 2] = positionMatrix[row * 3 + 2];
			transforms[output + row * 4 + 3] = translation[row];
			const normalOffset = output + 12 + row * 4;
			transforms[normalOffset] = normalMatrix[row * 3];
			transforms[normalOffset + 1] = normalMatrix[row * 3 + 1];
			transforms[normalOffset + 2] = normalMatrix[row * 3 + 2];
			transforms[normalOffset + 3] = 0;
		}
	}
	return transforms;
}

export function buildDualQuaternionSlotTransforms(compiled, pose) {
	if (!(pose instanceof Float32Array) || pose.length < compiled.slots.length * SLOT_POSE_FLOATS) {
		throw new Error('buildDualQuaternionSlotTransforms requires complete Float32Array slot pose data');
	}
	const transforms = new Float32Array(compiled.slots.length * DQ_SLOT_FLOATS);
	for (let slot = 0; slot < compiled.slots.length; slot++) {
		const rest = compiled.slots[slot];
		const poseOffset = slot * SLOT_POSE_FLOATS;
		const posedA = [pose[poseOffset], pose[poseOffset + 1], pose[poseOffset + 2]];
		const posedB = [pose[poseOffset + 4], pose[poseOffset + 5], pose[poseOffset + 6]];
		const frame = transportedFrame(rest, posedA, posedB);
		const real = quaternionFromAxes(frame.rest, frame.posed);
		const rigidRestA = rotateByQuaternion(real, rest.a);
		const translation = sub(posedA, rigidRestA);
		const dual = multiplyQuaternion([translation[0], translation[1], translation[2], 0], real).map((component) => component * 0.5);
		const restLength = Math.hypot(...sub(rest.b, rest.a));
		const posedLength = Math.hypot(...sub(posedB, posedA));
		const restRadius = Math.max((rest.ra + rest.rb) * 0.5, 1e-8);
		const posedRadius = Math.max((pose[poseOffset + 3] + pose[poseOffset + 7]) * 0.5, 1e-8);
		const radialScale = posedRadius / restRadius;
		const axialScale = restLength > 1e-8 ? posedLength / restLength : radialScale;
		const output = slot * DQ_SLOT_FLOATS;
		transforms.set(real, output);
		transforms.set(dual, output + 4);
		transforms.set([Math.log(radialScale), Math.log(axialScale), Math.log(radialScale), 0], output + 8);
		transforms.set(rest.a, output + 12);
		transforms.set(rest.radialX, output + 16);
		transforms.set(rest.radialZ, output + 20);
	}
	return transforms;
}

function dualQuaternionSlot(transforms, slot) {
	const offset = slot * DQ_SLOT_FLOATS;
	return {
		real: [...transforms.subarray(offset, offset + 4)],
		dual: [...transforms.subarray(offset + 4, offset + 8)],
		logScale: [...transforms.subarray(offset + 8, offset + 11)],
		center: [...transforms.subarray(offset + 12, offset + 15)],
		radialX: [...transforms.subarray(offset + 16, offset + 19)],
		radialZ: [...transforms.subarray(offset + 20, offset + 23)],
	};
}

function scaledAboutSlot(value, slot, inverse = false) {
	const offset = sub(value, slot.center);
	const axis = normalize(cross(slot.radialZ, slot.radialX), [0, 1, 0]);
	const basis = [slot.radialX, axis, slot.radialZ];
	let result = slot.center.slice();
	for (let component = 0; component < 3; component++) {
		const factor = Math.exp((inverse ? -1 : 1) * slot.logScale[component]);
		result = add(result, scale(basis[component], dot(offset, basis[component]) * factor));
	}
	return result;
}

function blendDualQuaternion(skinning, transforms, vertex) {
	let reference = null;
	let real = [0, 0, 0, 0];
	let dual = [0, 0, 0, 0];
	for (let influence = 0; influence < 4; influence++) {
		const skinOffset = vertex * 4 + influence;
		const weight = skinning.skinWeights[skinOffset];
		if (!(weight > 0)) continue;
		const slot = dualQuaternionSlot(transforms, skinning.skinIndices[skinOffset]);
		if (!reference) reference = slot.real;
		const sign = dot4(reference, slot.real) < 0 ? -1 : 1;
		for (let component = 0; component < 4; component++) {
			real[component] += slot.real[component] * weight * sign;
			dual[component] += slot.dual[component] * weight * sign;
		}
	}
	const realLength = Math.hypot(...real);
	if (!(realLength > 1e-10)) return { real: [0, 0, 0, 1], dual: [0, 0, 0, 0] };
	real = real.map((component) => component / realLength);
	dual = dual.map((component) => component / realLength);
	const projection = dot4(real, dual);
	dual = dual.map((component, index) => component - real[index] * projection);
	return { real, dual };
}

export function deformReferenceSurfaceDqs(surface, skinning, transforms) {
	const vertexCount = surface.positions.length / 3;
	if (skinning.skinIndices.length !== vertexCount * 4 || skinning.skinWeights.length !== vertexCount * 4) {
		throw new Error('deformReferenceSurfaceDqs skin layout does not match the reference surface');
	}
	const positions = new Float32Array(surface.positions.length);
	const normals = new Float32Array(surface.normals.length);
	for (let vertex = 0; vertex < vertexCount; vertex++) {
		const restPosition = [...surface.positions.subarray(vertex * 3, vertex * 3 + 3)];
		const restNormal = [...surface.normals.subarray(vertex * 3, vertex * 3 + 3)];
		let scaleAdjustedPosition = [0, 0, 0];
		let scaleAdjustedNormal = [0, 0, 0];
		for (let influence = 0; influence < 4; influence++) {
			const skinOffset = vertex * 4 + influence;
			const weight = skinning.skinWeights[skinOffset];
			if (!(weight > 0)) continue;
			const slot = dualQuaternionSlot(transforms, skinning.skinIndices[skinOffset]);
			scaleAdjustedPosition = add(scaleAdjustedPosition, scale(scaledAboutSlot(restPosition, slot), weight));
			const normalEndpoint = add(slot.center, restNormal);
			scaleAdjustedNormal = add(scaleAdjustedNormal, scale(sub(scaledAboutSlot(normalEndpoint, slot, true), slot.center), weight));
		}
		const blended = blendDualQuaternion(skinning, transforms, vertex);
		const translation = dualQuaternionTranslation(blended.real, blended.dual);
		positions.set(add(rotateByQuaternion(blended.real, scaleAdjustedPosition), translation), vertex * 3);
		normals.set(normalize(rotateByQuaternion(blended.real, scaleAdjustedNormal), restNormal), vertex * 3);
	}
	return { positions, normals, indices: surface.indices };
}

function applyPositionTransform(transforms, slot, value) {
	const offset = slot * SLOT_TRANSFORM_FLOATS;
	return [
		transforms[offset] * value[0] + transforms[offset + 1] * value[1] + transforms[offset + 2] * value[2] + transforms[offset + 3],
		transforms[offset + 4] * value[0] + transforms[offset + 5] * value[1] + transforms[offset + 6] * value[2] + transforms[offset + 7],
		transforms[offset + 8] * value[0] + transforms[offset + 9] * value[1] + transforms[offset + 10] * value[2] + transforms[offset + 11],
	];
}

function applyNormalTransform(transforms, slot, value) {
	const offset = slot * SLOT_TRANSFORM_FLOATS + 12;
	return [
		transforms[offset] * value[0] + transforms[offset + 1] * value[1] + transforms[offset + 2] * value[2],
		transforms[offset + 4] * value[0] + transforms[offset + 5] * value[1] + transforms[offset + 6] * value[2],
		transforms[offset + 8] * value[0] + transforms[offset + 9] * value[1] + transforms[offset + 10] * value[2],
	];
}

export function deformReferenceSurfaceLbs(surface, skinning, transforms) {
	const vertexCount = surface.positions.length / 3;
	if (skinning.skinIndices.length !== vertexCount * 4 || skinning.skinWeights.length !== vertexCount * 4) {
		throw new Error('deformReferenceSurfaceLbs skin layout does not match the reference surface');
	}
	const positions = new Float32Array(surface.positions.length);
	const normals = new Float32Array(surface.normals.length);
	for (let vertex = 0; vertex < vertexCount; vertex++) {
		const restPosition = [...surface.positions.subarray(vertex * 3, vertex * 3 + 3)];
		const restNormal = [...surface.normals.subarray(vertex * 3, vertex * 3 + 3)];
		let position = [0, 0, 0];
		let normal = [0, 0, 0];
		for (let influence = 0; influence < 4; influence++) {
			const skinOffset = vertex * 4 + influence;
			const weight = skinning.skinWeights[skinOffset];
			if (!(weight > 0)) continue;
			position = add(position, scale(applyPositionTransform(transforms, skinning.skinIndices[skinOffset], restPosition), weight));
			normal = add(normal, scale(applyNormalTransform(transforms, skinning.skinIndices[skinOffset], restNormal), weight));
		}
		positions.set(position, vertex * 3);
		normals.set(normalize(normal, restNormal), vertex * 3);
	}
	return { positions, normals, indices: surface.indices };
}

export function maximumSurfaceDelta(left, right) {
	if (left.length !== right.length) throw new Error('surface arrays must have equal lengths');
	let maximum = 0;
	for (let offset = 0; offset < left.length; offset += 3) {
		maximum = Math.max(maximum, Math.hypot(left[offset] - right[offset], left[offset + 1] - right[offset + 1], left[offset + 2] - right[offset + 2]));
	}
	return maximum;
}
