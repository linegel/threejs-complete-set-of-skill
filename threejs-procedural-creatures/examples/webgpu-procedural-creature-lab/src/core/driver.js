import { createLCG } from './lcg.js';
import { poseTransform } from './rig-compiler.js';
import { createFlyerState, sampleFlyer } from './locomotion/flyer.js';
import { createGaitState, stepGait } from './locomotion/gait.js';
import { createHopperState, sampleHopper, stepHopper } from './locomotion/hopper.js';
import { createRopeState, stepRopes } from './locomotion/rope.js';
import { createSwimState, stepSwim } from './locomotion/swim.js';

export const FIXED_DT = 1 / 60;
export const POSE_STRIDE = 12;
const MAX_ACCUMULATOR = 0.25;

function recordsFor(compiled) {
	return compiled?.primitiveRecords ?? compiled?.slots ?? [];
}

function finite(value, fallback = 0) {
	return Number.isFinite(value) ? value : fallback;
}

function cloneRoot(root) {
	return {
		position: root.position.slice(),
		velocity: root.velocity.slice(),
		yaw: root.yaw,
	};
}

function writeSlot(pose, slot, a, ra, b, rb, k, color) {
	const base = slot * POSE_STRIDE;
	pose[base + 0] = finite(a?.[0]);
	pose[base + 1] = finite(a?.[1]);
	pose[base + 2] = finite(a?.[2]);
	pose[base + 3] = finite(ra);
	pose[base + 4] = finite(b?.[0]);
	pose[base + 5] = finite(b?.[1]);
	pose[base + 6] = finite(b?.[2]);
	pose[base + 7] = finite(rb);
	pose[base + 8] = finite(k);
	pose[base + 9] = finite(color?.[0], 0.85);
	pose[base + 10] = finite(color?.[1], 0.72);
	pose[base + 11] = finite(color?.[2], 0.5);
}

function restPose(compiled) {
	const records = recordsFor(compiled);
	const pose = new Float32Array(records.length * POSE_STRIDE);
	for (let slot = 0; slot < records.length; slot++) {
		const record = records[slot];
		writeSlot(pose, slot, record.a, record.ra, record.b, record.rb, record.k, record.color);
	}
	return pose;
}

function writeBasePose(driver, pose) {
	const records = driver.records;
	const squash = Math.max(finite(driver.localPose.squash, 1), 1e-6);
	const bodyLift = finite(driver.compiled?.bodyLift) * Math.min(squash, 1);
	const translate = [
		finite(driver.localPose.position?.[0]),
		finite(driver.localPose.position?.[1]) + bodyLift,
		finite(driver.localPose.position?.[2]),
	];
	const transform = {
		squash,
		roll: finite(driver.localPose.roll),
		yaw: finite(driver.localPose.yaw),
		translate,
	};
	for (let slot = 0; slot < records.length; slot++) {
		const record = records[slot];
		writeSlot(
			pose,
			slot,
			poseTransform(record.a, transform),
			record.ra,
			poseTransform(record.b, transform),
			record.rb,
			record.k,
			record.color,
		);
	}
}

function interpolatePose(previous, current, alpha, out) {
	for (let i = 0; i < current.length; i++) out[i] = previous[i] + (current[i] - previous[i]) * alpha;
	return out;
}

function makePlatform(options, time) {
	const sample = typeof options.platformFn === 'function'
		? options.platformFn(time)
		: null;
	return {
		position: [
			finite(sample?.position?.[0]),
			finite(sample?.position?.[1]),
			finite(sample?.position?.[2]),
		],
		yaw: finite(sample?.yaw),
	};
}

function normalizeStepArgs(dtMsOrContext, maybeContext) {
	if (dtMsOrContext && typeof dtMsOrContext === 'object') {
		return { dtMs: 1000 / 60, context: dtMsOrContext };
	}
	return {
		dtMs: Number.isFinite(dtMsOrContext) ? dtMsOrContext : 1000 / 60,
		context: maybeContext ?? {},
	};
}

function buildLocomotion(spec, compiled, options, rng) {
	const type = spec?.locomotion?.type ?? 'none';
	return {
		type,
		gait: ['biped', 'quadruped', 'hexapod'].includes(type) ? createGaitState(spec, compiled) : null,
		hopper: type === 'hopper' ? createHopperState(spec, compiled, rng) : null,
		flyer: type === 'flyer' ? createFlyerState(spec, compiled, rng) : null,
		swim: type === 'swimmer' ? createSwimState(spec, compiled, options.waterSurfaceProvider ?? options.waterHeightFn) : null,
		ropes: createRopeState(spec, compiled),
	};
}

function resetDriver(driver) {
	const seed = driver.seed;
	const rng = createLCG(seed);
	driver.rng = rng;
	driver.time = 0;
	driver.ticks = 0;
	driver.accumulator = 0;
	driver.root = { position: [0, 0, 0], velocity: [0, 0, 0], yaw: 0 };
	driver.localPose = { squash: 1, roll: 0, yaw: 0, position: [0, 0, 0] };
	driver.telemetry = {};
	driver.locomotion = buildLocomotion(driver.spec, driver.compiled, driver.options, rng);
	writeBasePose(driver, driver.currentPose);
	driver.previousPose.set(driver.currentPose);
	driver.presentPose.set(driver.currentPose);
}

function updateRoot(driver, context) {
	const position = driver.root.position;
	const velocityOut = driver.root.velocity;
	const previousX = position[0];
	const previousY = position[1];
	const previousZ = position[2];
	const providedVelocity = context.rootVelocity;
	const hasVelocity = Array.isArray(providedVelocity);
	velocityOut[0] = hasVelocity ? finite(providedVelocity[0]) : 0;
	velocityOut[1] = hasVelocity ? finite(providedVelocity[1]) : 0;
	velocityOut[2] = hasVelocity ? finite(providedVelocity[2]) : finite(driver.spec?.locomotion?.speed);
	position[0] = previousX + velocityOut[0] * FIXED_DT;
	position[1] = previousY + velocityOut[1] * FIXED_DT;
	position[2] = previousZ + velocityOut[2] * FIXED_DT;
	if (Array.isArray(context.rootPosition)) {
		position[0] = finite(context.rootPosition[0]);
		position[1] = finite(context.rootPosition[1]);
		position[2] = finite(context.rootPosition[2]);
	}
	if (Number.isFinite(context.rootYaw)) driver.root.yaw = context.rootYaw;
	else if (Math.hypot(velocityOut[0], velocityOut[2]) > 1e-12) driver.root.yaw = Math.atan2(velocityOut[0], velocityOut[2]);
}

function applyLocomotion(driver, context) {
	const type = driver.locomotion.type;
	const platform = makePlatform(driver.options, driver.time);
	const fixedContext = {
		...context,
		time: driver.time,
		nextTime: driver.time + FIXED_DT,
		tick: driver.ticks + 1,
		fixedDt: FIXED_DT,
		root: driver.root,
		platform,
		querySupport: context.querySupport ?? driver.options.querySupport ?? null,
	};

	driver.localPose = { squash: 1, roll: 0, yaw: 0, position: [0, 0, 0] };

	if (type === 'hopper') {
		const result = stepHopper(driver.locomotion.hopper, FIXED_DT, driver.root);
		driver.localPose.squash = result.squash;
		driver.telemetry.hopper = result.telemetry;
	} else if (type === 'flyer') {
		const result = sampleFlyer(driver.locomotion.flyer, driver.time + FIXED_DT, driver.root);
		driver.localPose.roll = result.bank;
		driver.telemetry.flyer = result.telemetry;
	} else if (type === 'swimmer') {
		const result = stepSwim(driver.locomotion.swim, FIXED_DT, driver.time + FIXED_DT, driver.root);
		driver.localPose.roll = result.roll;
		driver.localPose.yaw = result.yaw;
		driver.localPose.position = [0, result.localY, 0];
		driver.telemetry.swim = result.telemetry;
	}

	writeBasePose(driver, driver.currentPose);

	if (type === 'flyer') {
		const result = sampleFlyer(driver.locomotion.flyer, driver.time + FIXED_DT, driver.root);
		result.writeFlaps(driver.currentPose, driver.records);
		driver.telemetry.flyer = result.telemetry;
	}

	if (driver.locomotion.gait) {
		const result = stepGait(driver.locomotion.gait, driver.currentPose, driver.spec.locomotion, fixedContext);
		driver.telemetry.gait = result.telemetry;
	}

	const ropeTelemetry = stepRopes(driver.locomotion.ropes, driver.currentPose, FIXED_DT);
	if (ropeTelemetry.groups.length > 0) driver.telemetry.ropes = ropeTelemetry;
}

function fixedTick(driver, context = {}) {
	driver.previousPose.set(driver.currentPose);
	updateRoot(driver, context);
	applyLocomotion(driver, context);
	driver.time = (driver.ticks + 1) * FIXED_DT;
	driver.ticks += 1;
	driver.presentPose.set(driver.currentPose);
}

export function createDriver(spec, compiled, options = {}) {
	const records = recordsFor(compiled);
	if (records.length === 0) throw new Error('createDriver requires at least one compiled primitive slot');
	const seed = Number.isFinite(options.seed) ? options.seed : (Number.isFinite(spec?.seed) ? spec.seed : 1);
	const pose = restPose(compiled);
	const driver = {
		spec,
		compiled,
		records,
		options,
		seed,
		rng: createLCG(seed),
		time: 0,
		ticks: 0,
		accumulator: 0,
		root: { position: [0, 0, 0], velocity: [0, 0, 0], yaw: 0 },
		localPose: { squash: 1, roll: 0, yaw: 0, position: [0, 0, 0] },
		previousPose: pose.slice(),
		currentPose: pose.slice(),
		presentPose: pose.slice(),
		telemetry: {},
		locomotion: null,
	};
	driver.locomotion = buildLocomotion(spec, compiled, options, driver.rng);
	writeBasePose(driver, driver.currentPose);
	driver.previousPose.set(driver.currentPose);
	driver.presentPose.set(driver.currentPose);
	return driver;
}

export function advanceInPlace(driver, dtSeconds, context = {}) {
	if (!driver) throw new Error('advance requires a driver');
	const dt = Math.min(Math.max(finite(dtSeconds), 0), MAX_ACCUMULATOR);
	driver.accumulator = Math.min(driver.accumulator + dt, MAX_ACCUMULATOR);
	let substeps = 0;
	while (driver.accumulator + 1e-15 >= FIXED_DT) {
		fixedTick(driver, context);
		driver.accumulator -= FIXED_DT;
		substeps += 1;
	}
	const alpha = Math.max(0, Math.min(1, driver.accumulator / FIXED_DT));
	if (substeps > 0 && alpha === 0) driver.presentPose.set(driver.currentPose);
	else interpolatePose(driver.previousPose, driver.currentPose, alpha, driver.presentPose);
	driver.lastAdvanceAlpha = alpha;
	driver.lastAdvanceSubsteps = substeps;
	return substeps;
}

export function advance(driver, dtSeconds, context = {}) {
	const substeps = advanceInPlace(driver, dtSeconds, context);
	return getPose(driver, { alpha: driver.lastAdvanceAlpha, substeps });
}

export function step(driver, nTicks, dtMs = 1000 / 60, maybeContext = {}) {
	const { dtMs: normalizedDtMs, context } = normalizeStepArgs(dtMs, maybeContext);
	const ticks = Math.max(0, Math.floor(finite(nTicks)));
	let result = getPose(driver);
	for (let i = 0; i < ticks; i++) result = advance(driver, normalizedDtMs / 1000, context);
	return result;
}

export function seek(driver, tSeconds) {
	if (!driver) throw new Error('seek requires a driver');
	const targetTicks = Math.max(0, Math.round(finite(tSeconds) * 60));
	if (targetTicks < driver.ticks) resetDriver(driver);
	while (driver.ticks < targetTicks) fixedTick(driver, {});
	driver.accumulator = 0;
	driver.presentPose.set(driver.currentPose);
	return getPose(driver, { alpha: 0, substeps: 0 });
}

export function getPose(driver, extra = {}) {
	return {
		time: driver.time,
		pose: driver.presentPose,
		root: cloneRoot(driver.root),
		telemetry: driver.telemetry,
		...extra,
	};
}

export function getPoseSnapshot(driver) {
	const snapshot = getPose(driver);
	return {
		...snapshot,
		pose: Array.from(snapshot.pose),
	};
}

export function rootTransformSingleApplication(driver) {
	const pose = driver.currentPose;
	const root = driver.root;
	const rootPlanar = Math.hypot(root.position[0], root.position[2]);
	if (rootPlanar < 1e-12 && Math.abs(root.yaw) < 1e-12) return true;
	for (let slot = 0; slot < driver.records.length; slot++) {
		const base = slot * POSE_STRIDE;
		for (const offset of [0, 4]) {
			const x = pose[base + offset + 0];
			const z = pose[base + offset + 2];
			if (Math.abs(x - root.position[0]) < 1e-9 && Math.abs(z - root.position[2]) < 1e-9 && rootPlanar > 1e-6) return false;
		}
	}
	return true;
}

export { sampleHopper };
