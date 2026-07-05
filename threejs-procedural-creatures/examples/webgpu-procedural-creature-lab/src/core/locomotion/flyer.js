const POSE_STRIDE = 12;

function rotateAroundZ(point, origin, angle) {
	const x = point[0] - origin[0];
	const y = point[1] - origin[1];
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return [
		origin[0] + x * c - y * s,
		origin[1] + x * s + y * c,
		point[2],
	];
}

export function createFlyerState(spec, compiled, rng) {
	const speed = Math.max(0.01, Number(spec.locomotion?.speed ?? 1));
	const radius = Math.max(0.1, Number(spec.locomotion?.radius ?? 2));
	const altitude = Math.max(0, Number(spec.locomotion?.altitude ?? 2));
	const phase = (rng?.nextFloat ? rng.nextFloat() : 0) * Math.PI * 2;
	const records = compiled.primitiveRecords ?? compiled.slots ?? [];
	const flaps = records
		.filter((record) => Number.isFinite(record.flap) || Number.isFinite(record.meta?.flap))
		.map((record) => ({
			slot: record.partSlot,
			amplitude: Math.abs(record.flap ?? record.meta?.flap ?? 0),
			side: record.a?.[0] >= 0 ? 1 : -1,
		}));
	return {
		speed,
		radius,
		altitude,
		phase,
		center: [0, 0, 0],
		angularSpeed: speed / radius,
		flaps,
	};
}

export function sampleFlyer(state, simTime, root) {
	const a = state.phase + simTime * state.angularSpeed;
	const bob = 0.15 * Math.sin(simTime * 1.7 + state.phase);
	root.position = [
		state.center[0] + Math.cos(a) * state.radius,
		state.altitude + bob,
		state.center[2] + Math.sin(a) * state.radius,
	];
	root.yaw = a + Math.PI * 0.5;
	root.velocity = [
		-Math.sin(a) * state.speed,
		0.15 * 1.7 * Math.cos(simTime * 1.7 + state.phase),
		Math.cos(a) * state.speed,
	];
	const bank = Math.sign(state.angularSpeed) * Math.min(0.5, state.speed * 0.35);
	const flapPhase = state.phase * 3 + simTime * (4.5 + 2 * Math.abs(state.angularSpeed)) * Math.PI;
	return {
		bank,
		telemetry: {
			angle: a,
			angularSpeed: state.angularSpeed,
			bob,
			bank,
			flapPhase,
		},
		writeFlaps(pose, records) {
			for (const flap of state.flaps) {
				const record = records[flap.slot];
				if (!record) continue;
				const base = flap.slot * POSE_STRIDE;
				const aPoint = [pose[base + 0], pose[base + 1], pose[base + 2]];
				const bPoint = [pose[base + 4], pose[base + 5], pose[base + 6]];
				const angle = Math.sin(flapPhase) * flap.amplitude * flap.side;
				const rotated = rotateAroundZ(bPoint, aPoint, angle);
				pose[base + 4] = rotated[0];
				pose[base + 5] = rotated[1];
				pose[base + 6] = rotated[2];
			}
		},
	};
}
