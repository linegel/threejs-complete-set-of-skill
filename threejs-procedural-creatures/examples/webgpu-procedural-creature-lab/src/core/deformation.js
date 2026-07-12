export const DEFORMATION_VERSION = 'creature-affine-lbs-v1';
export const SLOT_TRANSFORM_FLOATS = 24;
export const SLOT_POSE_FLOATS = 12;

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
