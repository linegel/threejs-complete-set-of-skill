import { defaultBendHintForHip, solveTwoBoneIKInto } from './ik.js';

const POSE_STRIDE = 12;
const G = 9.81;
const EPS = 1e-12;

function set3(out, x, y, z) {
	out[0] = x;
	out[1] = y;
	out[2] = z;
	return out;
}

function copy3(out, value, fallback = 0) {
	return set3(out, Number(value?.[0] ?? fallback), Number(value?.[1] ?? fallback), Number(value?.[2] ?? fallback));
}

function length3(v) {
	return Math.hypot(v[0], v[1], v[2]);
}

function normalize3(out, value, fallback = [0, 1, 0]) {
	const magnitude = length3(value);
	if (!Number.isFinite(magnitude) || magnitude < EPS) return copy3(out, fallback);
	return set3(out, value[0] / magnitude, value[1] / magnitude, value[2] / magnitude);
}

function dot3(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function projectTangent(out, value, normal) {
	const normalComponent = dot3(value, normal);
	return set3(
		out,
		value[0] - normal[0] * normalComponent,
		value[1] - normal[1] * normalComponent,
		value[2] - normal[2] * normalComponent,
	);
}

function rotateYawInto(out, point, yaw) {
	const cosine = Math.cos(yaw);
	const sine = Math.sin(yaw);
	return set3(out, point[0] * cosine + point[2] * sine, point[1], -point[0] * sine + point[2] * cosine);
}

function transformPointInto(out, point, transform, scratch) {
	rotateYawInto(scratch, point, transform.yaw ?? 0);
	return set3(
		out,
		scratch[0] + (transform.position?.[0] ?? 0),
		scratch[1] + (transform.position?.[1] ?? 0),
		scratch[2] + (transform.position?.[2] ?? 0),
	);
}

function inverseTransformPointInto(out, point, transform, scratch) {
	set3(
		scratch,
		point[0] - (transform.position?.[0] ?? 0),
		point[1] - (transform.position?.[1] ?? 0),
		point[2] - (transform.position?.[2] ?? 0),
	);
	return rotateYawInto(out, scratch, -(transform.yaw ?? 0));
}

function bodyToWorldInto(out, point, root, platform, scratchA, scratchB) {
	transformPointInto(scratchA, point, root, scratchB);
	return transformPointInto(out, scratchA, platform, scratchB);
}

function worldToBodyInto(out, point, root, platform, scratchA, scratchB) {
	inverseTransformPointInto(scratchA, point, platform, scratchB);
	return inverseTransformPointInto(out, scratchA, root, scratchB);
}

function readAInto(out, pose, slot) {
	const base = slot * POSE_STRIDE;
	return set3(out, pose[base], pose[base + 1], pose[base + 2]);
}

function writeLeg(pose, leg, hip, knee, foot) {
	const upper = leg.slotUpper * POSE_STRIDE;
	const lower = leg.slotLower * POSE_STRIDE;
	pose[upper + 0] = hip[0];
	pose[upper + 1] = hip[1];
	pose[upper + 2] = hip[2];
	pose[upper + 4] = knee[0];
	pose[upper + 5] = knee[1];
	pose[upper + 6] = knee[2];
	pose[lower + 0] = knee[0];
	pose[lower + 1] = knee[1];
	pose[lower + 2] = knee[2];
	pose[lower + 4] = foot[0];
	pose[lower + 5] = foot[1];
	pose[lower + 6] = foot[2];
}

function groupForPhase(phase) {
	const normalized = ((phase % 1) + 1) % 1;
	return normalized >= 0.25 && normalized < 0.75 ? 1 : 0;
}

export function estimateSwingTime(legLength = 0.6) {
	return 0.18 * Math.sqrt(Math.max(legLength, 1e-4) / 0.6);
}

function createLegRecord(upper, lower) {
	const upperLength = Number(upper.meta?.upper ?? 0.4);
	const lowerLength = Number(upper.meta?.lower ?? 0.4);
	const phase = Number(upper.meta?.phase ?? 0);
	const telemetry = {
		partId: upper.partId,
		planted: false,
		world: [0, 0, 0],
		platform: [0, 0, 0],
		normal: [0, 1, 0],
		surfaceVelocity: [0, 0, 0],
		frameId: null,
		group: groupForPhase(phase),
	};
	const hip = upper.meta?.hip ?? upper.a;
	return {
		partId: upper.partId,
		slotUpper: upper.partSlot,
		slotLower: lower?.partSlot ?? upper.partSlot + 1,
		upperLength,
		lowerLength,
		phase,
		group: telemetry.group,
		groundOffset: Math.min(0.92 * (upperLength + lowerLength), upperLength + lowerLength - 1e-3),
		planted: false,
		swinging: false,
		swingT: 0,
		frameId: null,
		supportCoord: null,
		hip: [0, 0, 0],
		bendHint: defaultBendHintForHip(hip),
		ik: { knee: [0, 0, 0], foot: [0, 0, 0], segments: { upperLength: 0, lowerLength: 0 } },
		hipWorld: [0, 0, 0],
		homeLocal: [0, 0, 0],
		homeWorld: [0, 0, 0],
		homeNormal: [0, 1, 0],
		homeVelocity: [0, 0, 0],
		homeSupportCoord: [0, 0, 0],
		plantedWorld: [0, 0, 0],
		plantedPlatform: [0, 0, 0],
		plantedNormal: [0, 1, 0],
		plantedVelocity: [0, 0, 0],
		swingStart: [0, 0, 0],
		swingTarget: [0, 0, 0],
		swingNormal: [0, 1, 0],
		targetVelocity: [0, 0, 0],
		footWorld: [0, 0, 0],
		footBody: [0, 0, 0],
		relativeVelocity: [0, 0, 0],
		tangentDirection: [0, 0, 1],
		scratchA: [0, 0, 0],
		scratchB: [0, 0, 0],
		telemetry,
	};
}

export function createGaitState(spec, compiled) {
	const records = compiled.primitiveRecords ?? compiled.slots ?? [];
	const legs = [];
	for (const upper of records) {
		if (upper.shape !== 'leg-upper') continue;
		legs.push(createLegRecord(upper, records[upper.partSlot + 1]));
	}
	const referenceLength = Math.max(0.1, legs.reduce((maximum, leg) => Math.max(maximum, leg.upperLength + leg.lowerLength), 0.6));
	return {
		legs,
		stepLength: Math.max(0.02, Number(spec.locomotion?.stepLength ?? 0.5)),
		stepHeight: Math.max(0.01, Number(spec.locomotion?.stepHeight ?? 0.12)),
		speed: Math.max(0, Number(spec.locomotion?.speed ?? 0)),
		swingTime: estimateSwingTime(referenceLength),
		telemetry: {
			feet: legs.map((leg) => leg.telemetry),
			swingCount: 0,
			stanceCount: legs.length,
			froude: 0,
		},
	};
}

function normalizeSupportResult(leg, result, fallbackPoint) {
	const point = result?.point ?? result?.position ?? (Number.isFinite(result?.height)
		? [fallbackPoint[0], result.height, fallbackPoint[2]]
		: fallbackPoint);
	copy3(leg.homeWorld, point);
	normalize3(leg.homeNormal, result?.normal ?? [0, 1, 0]);
	copy3(leg.homeVelocity, result?.velocityAtPoint ?? result?.surfaceVelocity ?? [0, 0, 0]);
	leg.homeFrameId = result?.frameId ?? null;
	leg.homeSupportCoord = result?.supportCoord ?? null;
}

function queryHomeSupport(leg, context, root, platform) {
	set3(leg.homeLocal, leg.hip[0], leg.hip[1] - leg.groundOffset, leg.hip[2]);
	bodyToWorldInto(leg.homeWorld, leg.homeLocal, root, platform, leg.scratchA, leg.scratchB);
	if (typeof context.querySupport !== 'function') {
		set3(leg.homeNormal, 0, 1, 0);
		set3(leg.homeVelocity, 0, 0, 0);
		leg.homeFrameId = 'platform';
		inverseTransformPointInto(leg.scratchA, leg.homeWorld, platform, leg.scratchB);
		copy3(leg.homeSupportCoord, leg.scratchA);
		return;
	}
	const result = context.querySupport(leg.homeWorld, {
		frameId: leg.frameId,
		supportCoord: leg.supportCoord,
		partId: leg.partId,
		tick: context.tick,
		time: context.nextTime,
	});
	if (!result) throw new Error(`querySupport returned no support for '${leg.partId}'`);
	normalizeSupportResult(leg, result, leg.homeWorld);
}

function resolvePlantedAnchor(leg, context, platform) {
	if (typeof context.querySupport === 'function') {
		const result = context.querySupport(leg.plantedWorld, {
			frameId: leg.frameId,
			supportCoord: leg.supportCoord,
			partId: leg.partId,
			planted: true,
			tick: context.tick,
			time: context.nextTime,
		});
		if (result) {
			copy3(leg.plantedWorld, result.point ?? result.position ?? leg.plantedWorld);
			normalize3(leg.plantedNormal, result.normal ?? leg.plantedNormal);
			copy3(leg.plantedVelocity, result.velocityAtPoint ?? result.surfaceVelocity ?? leg.plantedVelocity);
			leg.frameId = result.frameId ?? leg.frameId;
			leg.supportCoord = result.supportCoord ?? leg.supportCoord;
		}
	} else {
		transformPointInto(leg.plantedWorld, leg.plantedPlatform, platform, leg.scratchA);
	}
	return leg.plantedWorld;
}

function plantAt(leg, point, normal, velocity, frameId, supportCoord, platform) {
	copy3(leg.plantedWorld, point);
	inverseTransformPointInto(leg.plantedPlatform, point, platform, leg.scratchA);
	normalize3(leg.plantedNormal, normal);
	copy3(leg.plantedVelocity, velocity);
	leg.frameId = frameId;
	leg.supportCoord = supportCoord;
	leg.planted = true;
	leg.swinging = false;
}

function startSwing(leg, rootVelocity, state, context, platform) {
	resolvePlantedAnchor(leg, context, platform);
	copy3(leg.swingStart, leg.plantedWorld);
	set3(
		leg.relativeVelocity,
		rootVelocity[0] - leg.homeVelocity[0],
		rootVelocity[1] - leg.homeVelocity[1],
		rootVelocity[2] - leg.homeVelocity[2],
	);
	projectTangent(leg.tangentDirection, leg.relativeVelocity, leg.homeNormal);
	if (length3(leg.tangentDirection) < EPS) {
		rotateYawInto(leg.tangentDirection, [0, 0, 1], (context.root?.yaw ?? 0) + (platform.yaw ?? 0));
		projectTangent(leg.tangentDirection, leg.tangentDirection, leg.homeNormal);
	}
	normalize3(leg.tangentDirection, leg.tangentDirection, [0, 0, 1]);
	set3(
		leg.swingTarget,
		leg.homeWorld[0] + leg.tangentDirection[0] * state.stepLength * 0.5,
		leg.homeWorld[1] + leg.tangentDirection[1] * state.stepLength * 0.5,
		leg.homeWorld[2] + leg.tangentDirection[2] * state.stepLength * 0.5,
	);
	if (typeof context.querySupport === 'function') {
		const result = context.querySupport(leg.swingTarget, {
			partId: leg.partId,
			tick: context.tick,
			time: context.nextTime,
			target: true,
		});
		if (result) {
			copy3(leg.swingTarget, result.point ?? result.position ?? leg.swingTarget);
			normalize3(leg.swingNormal, result.normal ?? leg.homeNormal);
			leg.targetFrameId = result.frameId ?? leg.homeFrameId;
			leg.targetSupportCoord = result.supportCoord ?? leg.homeSupportCoord;
			copy3(leg.targetVelocity, result.velocityAtPoint ?? result.surfaceVelocity ?? leg.homeVelocity);
		}
	} else {
		copy3(leg.swingNormal, leg.homeNormal);
		leg.targetFrameId = leg.homeFrameId;
		leg.targetSupportCoord = leg.homeSupportCoord;
		copy3(leg.targetVelocity, leg.homeVelocity);
	}
	leg.swingT = 0;
	leg.planted = false;
	leg.swinging = true;
}

function sampleSwing(leg, state) {
	const s = Math.min(1, leg.swingT);
	const lift = Math.sin(Math.PI * s) * state.stepHeight;
	set3(
		leg.footWorld,
		leg.swingStart[0] + (leg.swingTarget[0] - leg.swingStart[0]) * s + leg.swingNormal[0] * lift,
		leg.swingStart[1] + (leg.swingTarget[1] - leg.swingStart[1]) * s + leg.swingNormal[1] * lift,
		leg.swingStart[2] + (leg.swingTarget[2] - leg.swingStart[2]) * s + leg.swingNormal[2] * lift,
	);
	return leg.footWorld;
}

function tangentLag(a, b, normal, scratch) {
	set3(scratch, a[0] - b[0], a[1] - b[1], a[2] - b[2]);
	projectTangent(scratch, scratch, normal);
	return length3(scratch);
}

function activeGroup(time, swingTime) {
	return Math.floor(time / Math.max(swingTime, 1e-6)) % 2;
}

export function stepGait(state, pose, locomotion, context) {
	const root = context.root;
	const platform = context.platform ?? { position: [0, 0, 0], yaw: 0 };
	const rootVelocity = root?.velocity ?? [0, 0, 0];
	const group = activeGroup(context.nextTime ?? 0, state.swingTime);
	let swingCount = 0;
	let bipedSwinging = false;
	if (state.legs.length === 2) {
		for (const leg of state.legs) bipedSwinging ||= leg.swinging;
	}

	for (const leg of state.legs) {
		readAInto(leg.hip, pose, leg.slotUpper);
		bodyToWorldInto(leg.hipWorld, leg.hip, root, platform, leg.scratchA, leg.scratchB);
		queryHomeSupport(leg, context, root, platform);
		if (!leg.planted && !leg.swinging) {
			plantAt(leg, leg.homeWorld, leg.homeNormal, leg.homeVelocity, leg.homeFrameId, leg.homeSupportCoord, platform);
		}

		if (leg.planted) {
			resolvePlantedAnchor(leg, context, platform);
			const canStart = !(state.legs.length === 2 && bipedSwinging);
			if (tangentLag(leg.plantedWorld, leg.homeWorld, leg.homeNormal, leg.scratchA) > state.stepLength && leg.group === group && canStart) {
				startSwing(leg, rootVelocity, state, context, platform);
				bipedSwinging = bipedSwinging || state.legs.length === 2;
			}
		}

		let planted = leg.planted;
		if (leg.swinging) {
			leg.swingT += (context.fixedDt ?? 1 / 60) / state.swingTime;
			if (leg.swingT >= 1) {
				plantAt(
					leg,
					leg.swingTarget,
					leg.swingNormal,
					leg.targetVelocity,
					leg.targetFrameId,
					leg.targetSupportCoord,
					platform,
				);
				copy3(leg.footWorld, leg.plantedWorld);
				planted = true;
			} else {
				sampleSwing(leg, state);
				planted = false;
				swingCount += 1;
			}
		} else {
			copy3(leg.footWorld, leg.plantedWorld);
		}

		worldToBodyInto(leg.footBody, leg.footWorld, root, platform, leg.scratchA, leg.scratchB);
		const solved = solveTwoBoneIKInto(leg.ik, leg.hip, leg.footBody, leg.upperLength, leg.lowerLength, leg.bendHint);
		writeLeg(pose, leg, leg.hip, solved.knee, solved.foot);

		const telemetry = leg.telemetry;
		telemetry.planted = planted;
		copy3(telemetry.world, leg.footWorld);
		inverseTransformPointInto(telemetry.platform, leg.footWorld, platform, leg.scratchA);
		copy3(telemetry.normal, planted ? leg.plantedNormal : leg.swingNormal);
		copy3(telemetry.surfaceVelocity, planted ? leg.plantedVelocity : leg.targetVelocity);
		telemetry.frameId = planted ? leg.frameId : leg.targetFrameId;
	}

	const referenceLength = Math.max(1e-4, state.legs[0]?.upperLength + state.legs[0]?.lowerLength ?? 0.6);
	state.telemetry.swingCount = swingCount;
	state.telemetry.stanceCount = state.legs.length - swingCount;
	state.telemetry.froude = (Number(locomotion?.speed ?? state.speed) ** 2) / (G * referenceLength);
	return { pose, telemetry: state.telemetry };
}

export function gaitShouldFroudeFail(speed, limbLength) {
	const length = Math.max(Number(limbLength), 1e-4);
	return (speed * speed) / (G * length) > 1;
}
