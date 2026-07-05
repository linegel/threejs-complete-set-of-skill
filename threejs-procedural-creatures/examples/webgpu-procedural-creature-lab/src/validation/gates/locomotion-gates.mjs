import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDriver, seek, step } from '../../core/driver.js';
import { compileSpec } from '../../core/rig-compiler.js';
import { getWaterHeight } from '../../core/water-analytic.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const gaitSpecs = ['biped', 'quadruped', 'hexapod'];
const allSpecs = ['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'];

async function loadSpec(name) {
	return JSON.parse(await readFile(resolve(root, 'src/lab/specs', `${name}.json`), 'utf8'));
}

function posePoint(pose, slot, endpoint) {
	const base = slot * 8 + (endpoint === 1 ? 3 : 0);
	return [pose[base], pose[base + 1], pose[base + 2]];
}

function distance(a, b) {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function finitePose(pose) {
	return pose instanceof Float32Array && pose.length > 0 && Array.from(pose).every(Number.isFinite);
}

async function runDriverStepCoverage() {
	for (const name of allSpecs) {
		const spec = await loadSpec(name);
		const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
		const driver = createDriver(spec, compiled);
		const result = step(driver, 16, { rootVelocity: [0.15, 0, 0.05] });
		if (!finitePose(result.pose)) {
			return { status: 'fail', details: { message: 'driver returned non-finite pose', name } };
		}
	}
	return { status: 'pass', details: { specs: allSpecs.length } };
}

async function runSeekEqualsStep() {
	for (const name of allSpecs) {
		const spec = await loadSpec(name);
		const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
		const a = createDriver(spec, compiled);
		const b = createDriver(spec, compiled);
		const seekPose = seek(a, 7.3).pose;
		const stepPose = step(b, Math.floor(7.3 * 60 + 1e-6)).pose;
		if (seekPose.byteLength !== stepPose.byteLength || Buffer.compare(Buffer.from(seekPose.buffer), Buffer.from(stepPose.buffer)) !== 0) {
			return { status: 'fail', details: { message: 'seek(t) differs from step(t*60)', name } };
		}
	}
	return { status: 'pass', details: { specs: allSpecs.length, timeSeconds: 7.3 } };
}

async function runIkLengths() {
	for (const name of gaitSpecs) {
		const spec = await loadSpec(name);
		const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
		const driver = createDriver(spec, compiled);
		const pose = step(driver, 8, { rootVelocity: [0.2, 0, 0] }).pose;
		for (let i = 0; i < compiled.primitiveRecords.length; i++) {
			const upper = compiled.primitiveRecords[i];
			if (upper.shape !== 'leg-upper') continue;
			const lower = compiled.primitiveRecords[i + 1];
			if (!lower || lower.shape !== 'leg-lower') continue;
			const upperLen = distance(posePoint(pose, i, 0), posePoint(pose, i, 1));
			const lowerLen = distance(posePoint(pose, i + 1, 0), posePoint(pose, i + 1, 1));
			const expectedUpper = upper.meta.upper;
			const expectedLower = lower.meta.lower;
			if (Math.abs(upperLen - expectedUpper) > 5e-4 || Math.abs(lowerLen - expectedLower) > 5e-4) {
				return { status: 'fail', details: { message: 'IK limb length drift', name, slot: i, upperLen, expectedUpper, lowerLen, expectedLower } };
			}
		}
	}
	return { status: 'pass', details: { specs: gaitSpecs.length, tolerance: 5e-4 } };
}

async function runSwimCoupling() {
	const spec = await loadSpec('swimmer');
	const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
	const driver = createDriver(spec, compiled);
	const result = step(driver, 60, { rootPosition: [0.2, 0, -0.1] });
	const namedRoot = compiled.primitiveRecords.find((record) => /^(main|body|torso)$/i.test(record.partId ?? ''));
	const rootSlot = namedRoot?.partSlot ?? 0;
	const rootY = result.pose[rootSlot * 8 + 1];
	const water = getWaterHeight(0.2, -0.1, result.time);
	const error = Math.abs(rootY - water);
	if (error >= 0.09) return { status: 'fail', details: { message: 'swim surface coupling exceeded threshold', error, rootY, water } };
	return { status: 'pass', details: { error, threshold: 0.09 } };
}

async function runPlatformFootSlide() {
	const spec = await loadSpec('quadruped');
	const compiled = compileSpec(spec, { tier: 'hero', maxParts: 64 });
	const driver = createDriver(spec, compiled);
	step(driver, 32, { rootVelocity: [0, 0, 0] });
	const first = driver.presentPose.slice();
	const firstFeet = [];
	for (let i = 0; i < compiled.primitiveRecords.length; i++) {
		if (compiled.primitiveRecords[i].shape === 'leg-lower') firstFeet.push(posePoint(first, i, 1));
	}
	step(driver, 32, { rootVelocity: [0, 0, 0] });
	const second = driver.presentPose;
	let maxSlide = 0;
	let legIndex = 0;
	for (let i = 0; i < compiled.primitiveRecords.length; i++) {
		if (compiled.primitiveRecords[i].shape !== 'leg-lower') continue;
		maxSlide = Math.max(maxSlide, distance(firstFeet[legIndex], posePoint(second, i, 1)));
		legIndex++;
	}
	if (maxSlide >= 1e-4) return { status: 'fail', details: { message: 'stationary stance feet slid', maxSlide } };
	return { status: 'pass', details: { maxSlide, threshold: 1e-4 } };
}

export const gates = [
	{ id: 'locomotion-driver-step', run: runDriverStepCoverage },
	{ id: 'seek-equals-step', run: runSeekEqualsStep },
	{ id: 'ik-limb-length', run: runIkLengths },
	{ id: 'swim-surface-coupling', run: runSwimCoupling },
	{ id: 'platform-foot-slide', run: runPlatformFootSlide },
];
