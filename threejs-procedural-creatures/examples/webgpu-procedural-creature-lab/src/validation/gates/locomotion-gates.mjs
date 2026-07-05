import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { advance, createDriver, POSE_STRIDE, seek, step } from '../../core/driver.js';
import { createLCG } from '../../core/lcg.js';
import { solveTwoBoneIK } from '../../core/locomotion/ik.js';
import { airHeightAt, hopperApexTime } from '../../core/locomotion/hopper.js';
import { compileSpec } from '../../core/rig-compiler.js';
import { createAnalyticWater } from '../../core/water-analytic.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const gaitSpecs = ['biped', 'quadruped', 'hexapod'];
const allSpecs = ['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'];

async function loadSpec(name) {
	return JSON.parse(await readFile(resolve(root, 'src/lab/specs', `${name}.json`), 'utf8'));
}

function distance(a, b) {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function posePoint(pose, slot, endpoint) {
	const base = slot * POSE_STRIDE + (endpoint === 1 ? 4 : 0);
	return [pose[base], pose[base + 1], pose[base + 2]];
}

function f32Point(point) {
	return [Math.fround(point[0]), Math.fround(point[1]), Math.fround(point[2])];
}

function samePoseBytes(a, b) {
	return a.byteLength === b.byteLength && Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;
}

function sameRoot(a, b) {
	return a.yaw === b.yaw && a.position.length === b.position.length && a.position.every((value, i) => value === b.position[i]);
}

function finitePose(pose) {
	return pose instanceof Float32Array && pose.length > 0 && Array.from(pose).every(Number.isFinite);
}

async function runDriverStepCoverage() {
	for (const name of allSpecs) {
		const spec = await loadSpec(name);
		const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
		const driver = createDriver(spec, compiled, { waterHeightFn: createAnalyticWater({ seed: 3 }) });
		const result = step(driver, 16);
		if (!finitePose(result.pose)) return { status: 'fail', details: { message: 'driver returned non-finite pose', name } };
		if (result.pose.length !== compiled.primitiveRecords.length * POSE_STRIDE) {
			return { status: 'fail', details: { message: 'driver pose uses wrong stride', name, length: result.pose.length } };
		}
	}
	return { status: 'pass', details: { specs: allSpecs.length, stride: POSE_STRIDE } };
}

async function runStanceFootDrift() {
	let maxDrift = 0;
	for (const name of gaitSpecs) {
		const spec = await loadSpec(name);
		for (const mode of ['stationary', 'moving']) {
			const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
			const driver = createDriver(spec, compiled);
			const velocity = mode === 'moving' ? [0, 0, 0.9 * spec.locomotion.speed] : [0, 0, 0];
			const previous = new Map();
			for (let tick = 0; tick < 8 * 60; tick++) {
				const result = step(driver, 1, 1000 / 60, { rootVelocity: velocity });
				for (const foot of result.telemetry.gait?.feet ?? []) {
					const key = foot.partId;
					if (foot.planted && previous.has(key)) {
						const drift = distance(previous.get(key), foot.world);
						maxDrift = Math.max(maxDrift, drift);
						if (drift >= 1e-9) {
							return { status: 'fail', details: { message: 'planted foot drifted in world space', name, mode, key, drift, tick } };
						}
					}
					if (foot.planted) previous.set(key, foot.world.slice());
					else previous.delete(key);
				}
				if (name === 'biped' && (result.telemetry.gait?.swingCount ?? 0) > 1) {
					return { status: 'fail', details: { message: 'biped had both feet in swing', tick } };
				}
			}
		}
	}
	const spec = await loadSpec('quadruped');
	const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
	const driver = createDriver(spec, compiled);
	const previous = new Map();
	const pattern = [1 / 120, 1 / 30, 1 / 240, 1 / 20, 1 / 60];
	let elapsed = 0;
	let index = 0;
	while (elapsed < 8 - 1e-12) {
		const dt = Math.min(pattern[index % pattern.length], 8 - elapsed);
		const result = advance(driver, dt, { rootVelocity: [0, 0, 0.9 * spec.locomotion.speed] });
		elapsed += dt;
		index++;
		if (result.substeps === 0) continue;
		for (const foot of result.telemetry.gait?.feet ?? []) {
			if (foot.planted && previous.has(foot.partId)) {
				const drift = distance(previous.get(foot.partId), foot.world);
				maxDrift = Math.max(maxDrift, drift);
				if (drift >= 1e-9) {
					return { status: 'fail', details: { message: 'planted foot drifted under jittered render dt', key: foot.partId, drift } };
				}
			}
			if (foot.planted) previous.set(foot.partId, foot.world.slice());
			else previous.delete(foot.partId);
		}
	}
	if (driver.ticks !== 480) {
		return { status: 'fail', details: { message: 'fixed-step accumulator did not process every 8s tick under jittered render dt', ticks: driver.ticks, expected: 480 } };
	}
	return { status: 'pass', details: { specs: gaitSpecs.length, maxDrift, threshold: 1e-9 } };
}

async function runIkLengths() {
	const rng = createLCG(0x1cabf00d);
	const hip = [0.13, 0.47, -0.08];
	const l1 = 0.36;
	const l2 = 0.30;
	let maxUpperError = 0;
	let maxLowerError = 0;
	let inReach = 0;
	for (let i = 0; i < 260; i++) {
		const radius = i < 220
			? Math.abs(l1 - l2) + 0.02 + rng.nextFloat() * (l1 + l2 - Math.abs(l1 - l2) - 0.04)
			: l1 + l2 + 0.01 + rng.nextFloat() * 0.6;
		const theta = rng.nextFloat() * Math.PI * 2;
		const y = -0.55 + rng.nextFloat() * 0.25;
		const planar = Math.sqrt(Math.max(radius * radius - y * y, 1e-8));
		const foot = [hip[0] + Math.cos(theta) * planar, hip[1] + y, hip[2] + Math.sin(theta) * planar];
		const solved = solveTwoBoneIK(hip, foot, l1, l2, [hip[0] >= 0 ? 1 : -1, 0.33, 0.4]);
		const upperError = Math.abs(distance(hip, solved.knee) - l1);
		const lowerError = Math.abs(distance(solved.knee, solved.foot) - l2);
		if (solved.reachable) {
			inReach++;
			maxUpperError = Math.max(maxUpperError, upperError);
			maxLowerError = Math.max(maxLowerError, lowerError);
			if (upperError >= 5e-5 || lowerError >= 5e-5) {
				return { status: 'fail', details: { message: 'IK limb length reconstruction exceeded 4-decimal tolerance', upperError, lowerError, foot } };
			}
		}
	}
	return { status: 'pass', details: { inReach, maxUpperError, maxLowerError, threshold: 5e-5 } };
}

async function runSwimCoupling() {
	const spec = await loadSpec('swimmer');
	const water = createAnalyticWater({ seed: 7 });
	const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
	const driver = createDriver(spec, compiled, { waterHeightFn: water });
	let maxError = 0;
	for (let tick = 0; tick < 30 * 60; tick++) {
		const result = step(driver, 1);
		if (tick >= 2 * 60) {
			const swim = result.telemetry.swim;
			const waterY = water(result.root.position[0], result.root.position[2], result.time);
			const error = Math.abs(result.root.position[1] - (waterY + swim.restOffset));
			maxError = Math.max(maxError, error);
			if (error >= 0.09) return { status: 'fail', details: { message: 'swim coupling exceeded surface offset threshold', tick, error, maxError } };
		}
	}
	return { status: 'pass', details: { maxError, threshold: 0.09 } };
}

async function runPlatformFootSlide() {
	const spec = await loadSpec('quadruped');
	const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
	const platformFn = (t) => ({ position: [0.6 * Math.sin(0.7 * t), 0, 0], yaw: 0 });
	const driver = createDriver(spec, compiled, { platformFn });
	const previous = new Map();
	let maxSlide = 0;
	for (let tick = 0; tick < 8 * 60; tick++) {
		const result = step(driver, 1, 1000 / 60, { rootVelocity: [0, 0, 0] });
		for (const foot of result.telemetry.gait?.feet ?? []) {
			if (foot.planted && previous.has(foot.partId)) {
				const slide = distance(previous.get(foot.partId), foot.platform);
				maxSlide = Math.max(maxSlide, slide);
				if (slide >= 1e-4) return { status: 'fail', details: { message: 'platform-relative planted foot slid', partId: foot.partId, slide, tick } };
			}
			if (foot.planted) previous.set(foot.partId, foot.platform.slice());
			else previous.delete(foot.partId);
		}
	}
	return { status: 'pass', details: { maxSlide, threshold: 1e-4 } };
}

async function runSeekEqualsStep() {
	for (const name of allSpecs) {
		const spec = await loadSpec(name);
		const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
		const options = name === 'swimmer' ? { waterHeightFn: createAnalyticWater({ seed: 5 }) } : {};
		const a = createDriver(spec, compiled, options);
		const b = createDriver(spec, compiled, options);
		const seekResult = seek(a, 7.3);
		const stepResult = step(b, 438);
		if (!samePoseBytes(seekResult.pose, stepResult.pose) || !sameRoot(seekResult.root, stepResult.root)) {
			return { status: 'fail', details: { message: 'seek(7.3) differs from 438 fixed ticks', name } };
		}
	}
	return { status: 'pass', details: { specs: allSpecs.length, ticks: 438 } };
}

async function runHopApex() {
	const spec = await loadSpec('hopper');
	const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
	const driver = createDriver(spec, compiled);
	const apexTime = hopperApexTime(driver.locomotion.hopper);
	const result = seek(driver, apexTime);
	const heightError = Math.abs(result.root.position[1] - driver.locomotion.hopper.hopHeight);
	const squashError = Math.abs(result.telemetry.hopper.squash - 1);
	const symmetryError = Math.abs(airHeightAt(0.25, driver.locomotion.hopper.hopHeight) - airHeightAt(0.75, driver.locomotion.hopper.hopHeight));
	if (heightError >= 1e-9 || squashError !== 0 || symmetryError !== 0) {
		return { status: 'fail', details: { message: 'hopper apex contract failed', apexTime, heightError, squashError, symmetryError } };
	}
	return { status: 'pass', details: { apexTime, hopHeight: driver.locomotion.hopper.hopHeight, heightError, squash: result.telemetry.hopper.squash } };
}

async function runRopeBehavior() {
	const spec = await loadSpec('quadruped');
	const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
	const driver = createDriver(spec, compiled);
	let speedAtHalf = 0;
	let speedAtFour = 0;
	let maxAnchorDelta = 0;
	for (let tick = 0; tick < 4 * 60; tick++) {
		const result = step(driver, 1, 1000 / 60, { rootVelocity: [0, 0, 0] });
		const rope = result.telemetry.ropes?.groups?.[0];
		if (!rope) return { status: 'fail', details: { message: 'quadruped rope telemetry missing' } };
		maxAnchorDelta = Math.max(maxAnchorDelta, distance(rope.anchor, rope.expectedAnchor));
		if (tick === 30) speedAtHalf = rope.speedSum;
		if (tick === 239) speedAtFour = rope.speedSum;
		const slotA = posePoint(result.pose, rope.firstSlot, 0);
		const slotB = posePoint(result.pose, rope.firstSlot, 1);
		if (distance(slotA, f32Point(rope.particles[0])) !== 0 || distance(slotB, f32Point(rope.particles[1])) !== 0) {
			return { status: 'fail', details: { message: 'rope slots do not contain final particle chain', tick } };
		}
	}
	if (maxAnchorDelta >= 1e-12) return { status: 'fail', details: { message: 'rope anchor not pinned', maxAnchorDelta } };
	if (!(speedAtFour < 0.2 * speedAtHalf)) return { status: 'fail', details: { message: 'rope energy did not decay', speedAtHalf, speedAtFour } };
	return { status: 'pass', details: { speedAtHalf, speedAtFour, maxAnchorDelta } };
}

async function runFlyerDeterminism() {
	const spec = await loadSpec('flyer');
	const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
	const a = createDriver(spec, compiled);
	const b = createDriver(spec, compiled);
	const seekResult = seek(a, 3.7);
	const stepResult = step(b, Math.round(3.7 * 60));
	if (!samePoseBytes(seekResult.pose, stepResult.pose) || !sameRoot(seekResult.root, stepResult.root)) {
		return { status: 'fail', details: { message: 'flyer seek and stepped samples diverged' } };
	}
	return { status: 'pass', details: { timeSeconds: 3.7, ticks: Math.round(3.7 * 60) } };
}

export const gates = [
	{ id: 'locomotion-driver-step', run: runDriverStepCoverage },
	{ id: 'stance-foot-drift', run: runStanceFootDrift },
	{ id: 'ik-limb-length', run: runIkLengths },
	{ id: 'swim-coupling', run: runSwimCoupling },
	{ id: 'platform-foot-slide', run: runPlatformFootSlide },
	{ id: 'seek-equals-step', run: runSeekEqualsStep },
	{ id: 'hop-apex', run: runHopApex },
	{ id: 'rope-behavior', run: runRopeBehavior },
	{ id: 'flyer-determinism', run: runFlyerDeterminism },
];
