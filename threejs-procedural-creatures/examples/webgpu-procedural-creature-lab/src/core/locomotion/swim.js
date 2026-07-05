function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v));
}

export function createSwimState(spec, compiled, waterHeightFn) {
	const records = compiled.primitiveRecords ?? compiled.slots ?? [];
	const rootRecord = records.find((record) => /^(main|body|torso|core)$/i.test(record.partId ?? '')) ?? records[0];
	const restCenterY = ((rootRecord?.a?.[1] ?? 0) + (rootRecord?.b?.[1] ?? 0)) * 0.5;
	return {
		getWaterHeight: typeof waterHeightFn === 'function' ? waterHeightFn : (() => 0),
		stiffness: clamp(Number(spec.locomotion?.buoyancy ?? 1) * 80, 1, 80),
		undulation: Number(spec.locomotion?.undulation ?? 0),
		restOffset: Math.max(0.04, restCenterY),
		bodyY: 0,
	};
}

export function stepSwim(state, dt, simTime, root) {
	const waterY = state.getWaterHeight(root.position[0], root.position[2], simTime);
	const targetY = waterY + state.restOffset;
	const response = clamp(state.stiffness * dt, 0, 1);
	state.bodyY += (targetY - state.bodyY) * response;
	root.position[1] = state.bodyY;
	root.velocity = [root.velocity[0], (targetY - state.bodyY) / Math.max(dt, 1e-9), root.velocity[2]];
	const phase = simTime * 2 * Math.PI * 0.45;
	return {
		localY: Math.sin(phase) * state.undulation * 0.04,
		roll: Math.sin(phase) * state.undulation * 0.28,
		yaw: Math.sin(phase + Math.PI * 0.5) * state.undulation * 0.08,
		telemetry: {
			waterY,
			targetY,
			bodyY: state.bodyY,
			restOffset: state.restOffset,
			error: Math.abs(state.bodyY - targetY),
			phase,
			stiffness: state.stiffness,
		},
	};
}
