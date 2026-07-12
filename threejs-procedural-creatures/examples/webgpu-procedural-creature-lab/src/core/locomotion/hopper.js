const TICK = 1 / 60;

function quantizeSeconds(seconds, options = {}) {
	const ticks = Math.max(options.minTicks ?? 1, Math.round(seconds * 60));
	const evenTicks = options.even ? ticks + (ticks % 2) : ticks;
	return evenTicks / 60;
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function clamp01(v) {
	return Math.max(0, Math.min(1, v));
}

export function airHeightAt(t, hopHeight) {
	const u = clamp01(t);
	return 4 * u * (1 - u) * hopHeight;
}

export function squashAt(state, stateTime, phaseT) {
	if (state === 'idle') return 1 + 0.015 * Math.sin(6 * stateTime);
	if (state === 'crouch') return lerp(1, 0.72, phaseT);
	if (state === 'air') return 1 + 0.28 * (Math.cos(Math.PI * phaseT) ** 2) * (phaseT < 0.5 ? 1 : 0.6);
	if (state === 'land') return lerp(0.78, 1, phaseT);
	return 1;
}

export function createHopperState(spec, compiled, rng) {
	const hopHeight = Math.max(0.01, Number(spec.locomotion?.hopHeight ?? 0.8));
	const hopLength = Math.max(0, Number(spec.locomotion?.hopLength ?? spec.locomotion?.speed ?? 0));
	const idleRaw = 0.6 + (rng?.nextFloat ? rng.nextFloat() : 0) * 1.6;
	const idleTime = quantizeSeconds(idleRaw);
	const crouchTime = quantizeSeconds(0.16);
	const airDuration = quantizeSeconds(Math.max(0.28, 0.9 * Math.sqrt(hopHeight)), { even: true, minTicks: 2 });
	const landTime = quantizeSeconds(0.14);
	return {
		hopHeight,
		hopLength,
		squashAmplitude: spec.locomotion?.squashAmplitude ?? 1,
		idleTime,
		crouchTime,
		airDuration,
		landTime,
		cycleTime: idleTime + crouchTime + airDuration + landTime,
		state: 'idle',
		stateTime: 0,
		cycleTimeCursor: 0,
		hopStartZ: 0,
	};
}

export function hopperApexTime(state) {
	return state.idleTime + state.crouchTime + state.airDuration * 0.5;
}

export function sampleHopper(state, timeSeconds) {
	const t = ((timeSeconds % state.cycleTime) + state.cycleTime) % state.cycleTime;
	let phaseState = 'idle';
	let stateTime = t;
	let phaseT = t / state.idleTime;
	let height = 0;
	let travelT = 0;

	if (t >= state.idleTime && t < state.idleTime + state.crouchTime) {
		phaseState = 'crouch';
		stateTime = t - state.idleTime;
		phaseT = stateTime / state.crouchTime;
	} else if (t >= state.idleTime + state.crouchTime && t < state.idleTime + state.crouchTime + state.airDuration) {
		phaseState = 'air';
		stateTime = t - state.idleTime - state.crouchTime;
		phaseT = stateTime / state.airDuration;
		height = airHeightAt(phaseT, state.hopHeight);
		travelT = phaseT;
	} else if (t >= state.idleTime + state.crouchTime + state.airDuration) {
		phaseState = 'land';
		stateTime = t - state.idleTime - state.crouchTime - state.airDuration;
		phaseT = stateTime / state.landTime;
		travelT = 1;
	}

	const completedCycles = Math.floor(Math.max(0, timeSeconds) / state.cycleTime);
	const z = completedCycles * state.hopLength + state.hopLength * travelT;
	return {
		state: phaseState,
		stateTime,
		phaseT: clamp01(phaseT),
		height,
		z,
		squash: squashAt(phaseState, stateTime, clamp01(phaseT)),
	};
}

export function stepHopper(state, dt, root) {
	const sample = sampleHopper(state, state.elapsed === undefined ? dt : state.elapsed + dt);
	sample.squash = 1 + (sample.squash - 1) * state.squashAmplitude;
	state.elapsed = (state.elapsed ?? 0) + dt;
	root.position[1] = sample.height;
	root.position[2] = sample.z;
	root.velocity[0] = 0;
	root.velocity[1] = 0;
	root.velocity[2] = state.hopLength / Math.max(state.cycleTime, TICK);
	return {
		squash: sample.squash,
		telemetry: {
			...sample,
			squashAmplitude: state.squashAmplitude,
			hopHeight: state.hopHeight,
			hopLength: state.hopLength,
			apexTime: hopperApexTime(state),
			durations: {
				idle: state.idleTime,
				crouch: state.crouchTime,
				air: state.airDuration,
				land: state.landTime,
			},
		},
	};
}
