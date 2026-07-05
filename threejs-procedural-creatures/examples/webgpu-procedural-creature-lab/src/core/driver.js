const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 4;
const MAX_ACCUMULATOR = 0.25;

import { createGaitState, stepGait } from './locomotion/gait.js';
import { makeHopperState, stepHopper } from './locomotion/hopper.js';
import { makeFlyerState, stepFlyer } from './locomotion/flyer.js';
import { makeRopeState, stepRope } from './locomotion/rope.js';
import { makeSwimState, stepSwim } from './locomotion/swim.js';

function primitiveRecordsFor(compiler) {
	return compiler?.primitiveRecords ?? compiler?.slots ?? [];
}

function clonePoseFloat32(source) {
	if (source instanceof Float32Array) return source.slice();
	if (Array.isArray(source)) return new Float32Array(source);
	return new Float32Array(0);
}

function createZeroPose(slotCount) {
	return new Float32Array(slotCount * 8);
}

function poseFromCompiler(compiler) {
	const primitiveRecords = primitiveRecordsFor(compiler);
	const slotCount = primitiveRecords.length;
	const pose = createZeroPose(slotCount);
	for (let slot = 0; slot < slotCount; slot++) {
		const slotData = primitiveRecords[slot];
		const base = slot * 8;
		pose[base + 0] = slotData.a?.[0] ?? 0;
		pose[base + 1] = slotData.a?.[1] ?? 0;
		pose[base + 2] = slotData.a?.[2] ?? 0;
		pose[base + 3] = slotData.b?.[0] ?? 0;
		pose[base + 4] = slotData.b?.[1] ?? 0;
		pose[base + 5] = slotData.b?.[2] ?? 0;
		pose[base + 6] = 1;
		pose[base + 7] = 1;
	}
	return pose;
}

function allocateTransform(slotCount, target, source) {
	if (!target || target.length !== source.length) return clonePoseFloat32(source);
	const dst = target;
	dst.set(source);
	if (slotCount > 0) {
		for (let slot = 0; slot < slotCount; slot++) {
			const base = slot * 8;
			dst[base + 6] = dst[base + 6] || 1;
			dst[base + 7] = dst[base + 7] || 1;
		}
	}
	return dst;
}

function lerp(a, b, t) {
	return a * (1 - t) + b * t;
}

function interpolatePoses(previous, next, alpha, out) {
	if (previous.length !== next.length || out.length !== previous.length) {
		throw new Error('Interpolation buffers must share exact pose length');
	}
	for (let i = 0; i < previous.length; i++) {
		out[i] = lerp(previous[i], next[i], alpha);
	}
	return out;
}

function makePoseTransform(compiler, options = {}) {
	const slotCount = primitiveRecordsFor(compiler).length;
	const pose = poseFromCompiler(compiler);
	return applyBiomeTransform(pose, slotCount, options);
}

function applyBiomeTransform(pose, slotCount, options = {}) {
	const squash = Number.isFinite(options.squash) ? Math.max(1e-6, options.squash) : 1;
	const yaw = Number.isFinite(options.yaw) ? options.yaw : 0;
	const roll = Number.isFinite(options.roll) ? options.roll : 0;
	const tx = options.translation?.[0] || 0;
	const ty = options.translation?.[1] || 0;
	const tz = options.translation?.[2] || 0;
	const cy = Math.cos(yaw);
	const sy = Math.sin(yaw);
	const cr = Math.cos(roll);
	const sr = Math.sin(roll);
	const out = new Float32Array(pose.length);

	for (let slot = 0; slot < slotCount; slot++) {
		const base = slot * 8;
		for (let endpoint = 0; endpoint < 2; endpoint++) {
			const p = endpoint === 0 ? base : base + 3;
			const x = pose[p + 0];
			const y = pose[p + 1];
			const z = pose[p + 2];
			const ry = cy * x + sy * z;
			const rz = -sy * x + cy * z;
			const rx = cr * ry - sr * y;
			const ry2 = sr * ry + cr * y;
			out[p + 0] = rx / Math.sqrt(squash) + tx;
			out[p + 1] = ry2 * squash + ty;
			out[p + 2] = rz / Math.sqrt(squash) + tz;
		}
		out[base + 6] = pose[base + 6];
		out[base + 7] = pose[base + 7];
	}

	for (let i = 0; i < out.length; i += 1) {
		if (!Number.isFinite(out[i])) out[i] = pose[i];
	}
	return out;
}

function buildLocomotionState(spec, compiler) {
	switch (spec.locomotion.type) {
		case 'biped':
		case 'quadruped':
		case 'hexapod':
			return { type: 'gait', state: createGaitState(spec, compiler) };
		case 'hopper':
			return { type: 'hopper', state: makeHopperState(spec, compiler) };
		case 'flyer':
			return { type: 'flyer', state: makeFlyerState(spec, compiler) };
		case 'swimmer':
			return { type: 'swimmer', state: makeSwimState(spec, compiler) };
		default:
			return { type: 'none', state: null };
	}
}

function stepLocomotion(system, dt, context = {}) {
	if (!system.locomotionState) return system.currentPose;
	const normalizeResult = (result) => {
		if (result instanceof Promise) {
			throw new Error('async locomotion step returned inside fixed-step driver');
		}
		if (result instanceof Float32Array) return result;
		if (result?.pose instanceof Float32Array) return result.pose;
		if (Array.isArray(result?.pose)) return new Float32Array(result.pose);
		throw new Error(`locomotion ${system.locomotionState.type} did not return a pose buffer`);
	};
	if (system.locomotionState.type === 'gait') {
		return normalizeResult(stepGait(system.locomotionState.state, system.currentPose, system.spec?.locomotion ?? {}, dt, context));
	}
	if (system.locomotionState.type === 'hopper') {
		return normalizeResult(stepHopper(system.locomotionState.state, system.currentPose, system.spec?.locomotion ?? {}, dt, context));
	}
	if (system.locomotionState.type === 'flyer') {
		return normalizeResult(stepFlyer(system.locomotionState.state, system.currentPose, system.spec?.locomotion ?? {}, dt, context));
	}
	if (system.locomotionState.type === 'swimmer') {
		return normalizeResult(stepSwim(system.locomotionState.state, system.currentPose, system.spec?.locomotion ?? {}, dt, context));
	}
	return system.currentPose;
}

export function createDriver(spec, compiler, options = {}) {
	const slotCount = primitiveRecordsFor(compiler).length;
	if (slotCount <= 0) {
		throw new Error('Driver requires at least one primitive slot.');
	}
	const fixedTransform = makePoseTransform(compiler, options.transform ?? {});
	const driver = {
		fixedDt: FIXED_DT,
		maxAccumulator: MAX_ACCUMULATOR,
		maxSubsteps: MAX_SUBSTEPS,
		spec,
		compiler,
		time: 0,
		accumulator: 0,
		stepIndex: 0,
		previousPose: allocateTransform(slotCount, null, fixedTransform),
		currentPose: allocateTransform(slotCount, null, fixedTransform),
		presentPose: allocateTransform(slotCount, null, fixedTransform),
		locomotionState: buildLocomotionState(spec, compiler),
		rootTransform: { position: [0, 0, 0], velocity: [0, 0, 0], yaw: 0 },
		lastContext: { rootPosition: [0, 0, 0], rootYaw: 0 }
	};
	return driver;
}

export function stepDriver(driver, dtSeconds, context = {}) {
	if (!driver) throw new Error('driver required');
	const dt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : FIXED_DT;
	const clampedDt = Math.min(dt, driver.maxAccumulator);
	const rootPosition = context.rootPosition ?? driver.lastContext.rootPosition;
	const rootYaw = Number.isFinite(context.rootYaw) ? context.rootYaw : driver.lastContext.rootYaw;
	const rootVel = context.rootVelocity ?? [0, 0, 0];
	const rootDelta = [
		Number.isFinite(rootPosition?.[0]) ? rootPosition[0] - driver.lastContext.rootPosition[0] : 0,
		Number.isFinite(rootPosition?.[1]) ? rootPosition[1] - driver.lastContext.rootPosition[1] : 0,
		Number.isFinite(rootPosition?.[2]) ? rootPosition[2] - driver.lastContext.rootPosition[2] : 0
	];
	driver.lastContext = {
		rootPosition: [
			Number.isFinite(rootPosition?.[0]) ? rootPosition[0] : 0,
			Number.isFinite(rootPosition?.[1]) ? rootPosition[1] : 0,
			Number.isFinite(rootPosition?.[2]) ? rootPosition[2] : 0
		],
		rootYaw
	};

	driver.rootTransform = {
		position: driver.lastContext.rootPosition,
		velocity: rootVel,
		yaw: rootYaw
	};
	driver.accumulator += clampedDt;
	let substeps = 0;
	const maxSubsteps = Math.min(Math.max(1, driver.maxSubsteps), 32);
	const fixedDt = driver.fixedDt;

	while (driver.accumulator >= fixedDt && substeps < maxSubsteps) {
		driver.currentPose = allocateTransform(driver.currentPose.length / 8, driver.currentPose, driver.currentPose);
		driver.previousPose.set(driver.currentPose);
		driver.currentPose = stepLocomotion(driver, fixedDt, {
			time: driver.time,
			fixedStep: fixedDt,
			stepIndex: substeps,
			rootPosition: driver.rootTransform.position,
			rootYaw,
			rootVelocity: [
				Number.isFinite(rootVel[0]) ? rootVel[0] : rootDelta[0] / fixedDt,
				Number.isFinite(rootVel[1]) ? rootVel[1] : rootDelta[1] / fixedDt,
				Number.isFinite(rootVel[2]) ? rootVel[2] : rootDelta[2] / fixedDt
			],
		}
		);
		driver.stepIndex += 1;
		driver.time += fixedDt;
		driver.accumulator -= fixedDt;
		substeps += 1;
	}

	if (substeps >= maxSubsteps && driver.accumulator >= fixedDt) {
		driver.accumulator = fixedDt; // deterministic clamp
	}

	const alpha = Math.min(1, driver.accumulator / fixedDt);
	driver.presentPose = interpolatePoses(driver.previousPose, driver.currentPose, alpha, new Float32Array(driver.currentPose.length));
	return {
		time: driver.time,
		alpha,
		pose: driver.presentPose,
		substeps
	};
}

export function seek(driver, timeSeconds) {
	if (!driver) throw new Error('driver required');
	const target = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
	const desiredTicks = Math.max(0, Math.floor(target / FIXED_DT + 1e-6));
	const currentTicks = Math.max(0, Math.floor((driver.time + 1e-10) / FIXED_DT));
	const deltaTicks = desiredTicks - currentTicks;
	if (deltaTicks <= 0) return { time: driver.time, pose: driver.presentPose ?? driver.currentPose, matched: true };
	stepDriver(driver, deltaTicks * FIXED_DT, { exact: true, rootVelocity: [0, 0, 0] });
	driver.accumulator = 0;
	return { time: driver.time, pose: driver.presentPose ?? driver.currentPose, ticks: deltaTicks };
}

export function step(driver, ticks, context = {}) {
	const integerTicks = Number.isFinite(ticks) ? Math.max(0, Math.floor(ticks)) : 1;
	return stepDriver(driver, integerTicks * FIXED_DT, context);
}

export function advance(driver, timeSeconds, context = {}) {
	return seek(driver, timeSeconds);
}

export function reset(driver, compiler, options = {}) {
	if (!driver) throw new Error('driver required');
	driver.time = 0;
	driver.accumulator = 0;
	driver.stepIndex = 0;
	driver.currentPose = poseFromCompiler(driver.compiler);
	driver.previousPose = poseFromCompiler(driver.compiler);
	driver.presentPose = poseFromCompiler(driver.compiler);
	driver.locomotionState = buildLocomotionState(driver.spec, driver.compiler);
	return driver;
}

export function getPoseSnapshot(driver) {
	if (!driver) throw new Error('driver required');
	return {
		time: driver.time,
		accumulator: driver.accumulator,
		stepIndex: driver.stepIndex,
		type: driver.locomotionState?.type ?? 'none',
		pose: Array.from(driver.presentPose)
	};
}
