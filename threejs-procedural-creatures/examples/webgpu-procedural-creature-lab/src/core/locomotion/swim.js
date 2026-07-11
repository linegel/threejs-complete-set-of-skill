function clamp(value, lower, upper) {
	return Math.max(lower, Math.min(upper, value));
}

function finite(value, fallback = 0) {
	return Number.isFinite(value) ? Number(value) : fallback;
}

function normalizeInto(out, value, fallback = [0, 1, 0]) {
	const x = finite(value?.[0]);
	const y = finite(value?.[1]);
	const z = finite(value?.[2]);
	const magnitude = Math.hypot(x, y, z);
	if (magnitude < 1e-12) {
		out[0] = fallback[0];
		out[1] = fallback[1];
		out[2] = fallback[2];
	} else {
		out[0] = x / magnitude;
		out[1] = y / magnitude;
		out[2] = z / magnitude;
	}
}

function copyInto(out, value) {
	out[0] = finite(value?.[0]);
	out[1] = finite(value?.[1]);
	out[2] = finite(value?.[2]);
}

function sampleSurface(state, x, z, time) {
	const raw = state.getWaterSurface(x, z, time);
	const height = Number.isFinite(raw)
		? Number(raw)
		: finite(raw?.height ?? raw?.surfacePoint?.[1] ?? raw?.point?.[1]);
	const point = raw?.surfacePoint ?? raw?.point;
	state.surfacePoint[0] = finite(point?.[0], x);
	state.surfacePoint[1] = height;
	state.surfacePoint[2] = finite(point?.[2], z);
	normalizeInto(state.surfaceNormal, raw?.surfaceNormal ?? raw?.normal ?? [0, 1, 0]);
	state.surfaceVelocityProvided = Boolean(raw && typeof raw === 'object' && (raw.velocityAtPoint || raw.surfaceVelocity));
	copyInto(state.surfaceVelocity, raw?.velocityAtPoint ?? raw?.surfaceVelocity ?? [0, 0, 0]);
	copyInto(state.materialCurrentVelocity, raw?.materialCurrentVelocity ?? raw?.currentVelocity ?? [0, 0, 0]);
	return height;
}

export function createSwimState(spec, compiled, waterSurfaceProvider) {
	const records = compiled.primitiveRecords ?? compiled.slots ?? [];
	const rootRecord = records.find((record) => /^(main|body|torso|core)$/i.test(record.partId ?? '')) ?? records[0];
	const restCenterY = ((rootRecord?.a?.[1] ?? 0) + (rootRecord?.b?.[1] ?? 0)) * 0.5;
	const buoyancy = clamp(Number(spec.locomotion?.buoyancy ?? 1), 0.05, 4);
	const omega = clamp(7.5 * Math.sqrt(buoyancy), 2, 18);
	return {
		getWaterSurface: typeof waterSurfaceProvider === 'function' ? waterSurfaceProvider : (() => 0),
		omega,
		undulation: Number(spec.locomotion?.undulation ?? 0),
		restOffset: Math.max(0.04, restCenterY),
		bodyY: 0,
		bodyVelocityY: 0,
		lastTargetY: null,
		surfacePoint: [0, 0, 0],
		surfaceNormal: [0, 1, 0],
		surfaceVelocity: [0, 0, 0],
		surfaceVelocityProvided: false,
		materialCurrentVelocity: [0, 0, 0],
		telemetry: {
			waterY: 0,
			targetY: 0,
			bodyY: 0,
			bodyVelocityY: 0,
			restOffset: Math.max(0.04, restCenterY),
			error: 0,
			phase: 0,
			omega,
			surfaceNormal: [0, 1, 0],
			surfaceVelocity: [0, 0, 0],
			materialCurrentVelocity: [0, 0, 0],
		},
	};
}

export function stepSwim(state, dtInput, simTime, root) {
	const dt = Math.max(finite(dtInput, 1 / 60), 1e-9);
	const waterY = sampleSurface(state, root.position[0], root.position[2], simTime);
	const targetY = waterY + state.surfaceNormal[1] * state.restOffset;
	if (state.lastTargetY === null) state.lastTargetY = targetY;
	const measuredTargetVelocity = (targetY - state.lastTargetY) / dt;
	const targetVelocityY = state.surfaceVelocityProvided && Number.isFinite(state.surfaceVelocity[1])
		? state.surfaceVelocity[1]
		: measuredTargetVelocity;

	// Closed-form critical damping for a target moving at constant velocity over
	// the fixed step. This is invariant to presentation cadence because only the
	// simulation's fixed dt reaches this equation.
	const error0 = state.bodyY - state.lastTargetY;
	const relativeVelocity0 = state.bodyVelocityY - targetVelocityY;
	const c = relativeVelocity0 + state.omega * error0;
	const decay = Math.exp(-state.omega * dt);
	const error1 = (error0 + c * dt) * decay;
	const relativeVelocity1 = (relativeVelocity0 - state.omega * c * dt) * decay;
	state.bodyY = targetY + error1;
	state.bodyVelocityY = targetVelocityY + relativeVelocity1;
	state.lastTargetY = targetY;

	root.position[1] = state.bodyY;
	root.velocity[1] = state.bodyVelocityY;
	const phase = simTime * 2 * Math.PI * 0.45;
	const telemetry = state.telemetry;
	telemetry.waterY = waterY;
	telemetry.targetY = targetY;
	telemetry.bodyY = state.bodyY;
	telemetry.bodyVelocityY = state.bodyVelocityY;
	telemetry.error = Math.abs(state.bodyY - targetY);
	telemetry.phase = phase;
	telemetry.omega = state.omega;
	copyInto(telemetry.surfaceNormal, state.surfaceNormal);
	copyInto(telemetry.surfaceVelocity, state.surfaceVelocity);
	copyInto(telemetry.materialCurrentVelocity, state.materialCurrentVelocity);
	return {
		localY: Math.sin(phase) * state.undulation * 0.04,
		roll: Math.sin(phase) * state.undulation * 0.28,
		yaw: Math.sin(phase + Math.PI * 0.5) * state.undulation * 0.08,
		telemetry,
	};
}
