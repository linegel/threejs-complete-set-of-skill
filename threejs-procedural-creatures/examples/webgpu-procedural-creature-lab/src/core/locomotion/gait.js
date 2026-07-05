import { defaultBendHintForHip, solveTwoBoneIK } from './ik.js';

const POSE_STRIDE = 12;
const G = 9.81;
const EPS = 1e-12;

function add(a, b) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mul(v, s) {
	return [v[0] * s, v[1] * s, v[2] * s];
}

function length(v) {
	return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v, fallback = [0, 0, 1]) {
	const d = length(v);
	if (!Number.isFinite(d) || d < EPS) return fallback.slice();
	return [v[0] / d, v[1] / d, v[2] / d];
}

function rotateYaw(point, yaw) {
	const c = Math.cos(yaw);
	const s = Math.sin(yaw);
	return [point[0] * c + point[2] * s, point[1], -point[0] * s + point[2] * c];
}

function inverseRotateYaw(point, yaw) {
	return rotateYaw(point, -yaw);
}

function transformPoint(point, transform) {
	return add(rotateYaw(point, transform.yaw ?? 0), transform.position ?? [0, 0, 0]);
}

function inverseTransformPoint(point, transform) {
	return inverseRotateYaw(sub(point, transform.position ?? [0, 0, 0]), transform.yaw ?? 0);
}

function bodyToWorld(point, root, platform) {
	return transformPoint(transformPoint(point, root), platform);
}

function worldToBody(point, root, platform) {
	return inverseTransformPoint(inverseTransformPoint(point, platform), root);
}

function readA(pose, slot) {
	const base = slot * POSE_STRIDE;
	return [pose[base], pose[base + 1], pose[base + 2]];
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
	const p = ((phase % 1) + 1) % 1;
	return p >= 0.25 && p < 0.75 ? 1 : 0;
}

export function estimateSwingTime(legLength = 0.6) {
	return 0.18 * Math.sqrt(Math.max(legLength, 1e-4) / 0.6);
}

export function createGaitState(spec, compiled) {
	const records = compiled.primitiveRecords ?? compiled.slots ?? [];
	const legs = [];
	for (const upper of records) {
		if (upper.shape !== 'leg-upper') continue;
		const lower = records[upper.partSlot + 1];
		const hip = upper.meta?.hip ?? upper.a;
		const upperLength = Number(upper.meta?.upper ?? 0.4);
		const lowerLength = Number(upper.meta?.lower ?? 0.4);
		const phase = Number(upper.meta?.phase ?? 0);
		legs.push({
			partId: upper.partId,
			slotUpper: upper.partSlot,
			slotLower: lower?.partSlot ?? upper.partSlot + 1,
			restHip: hip.slice(),
			upperLength,
			lowerLength,
			phase,
			group: groupForPhase(phase),
			groundOffset: Math.min(0.92 * (upperLength + lowerLength), upperLength + lowerLength - 1e-3),
			planted: null,
			swing: null,
		});
	}
	const referenceLength = Math.max(0.1, legs.reduce((m, leg) => Math.max(m, leg.upperLength + leg.lowerLength), 0.6));
	return {
		legs,
		stepLength: Math.max(0.02, Number(spec.locomotion?.stepLength ?? 0.5)),
		stepHeight: Math.max(0.01, Number(spec.locomotion?.stepHeight ?? 0.12)),
		speed: Math.max(0, Number(spec.locomotion?.speed ?? 0)),
		swingTime: estimateSwingTime(referenceLength),
	};
}

function homeForLeg(leg, hip, root, platform) {
	const local = [hip[0], hip[1] - leg.groundOffset, hip[2]];
	return {
		local,
		world: bodyToWorld(local, root, platform),
		platform: inverseTransformPoint(bodyToWorld(local, root, platform), platform),
	};
}

function anchorWorld(leg, platform) {
	if (leg.planted.platform) return transformPoint(leg.planted.platform, platform);
	return leg.planted.world.slice();
}

function horizontalLag(a, b) {
	return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function activeGroup(time, swingTime) {
	return Math.floor(time / Math.max(swingTime, 1e-6)) % 2;
}

function startSwing(leg, home, rootVelocity, state, platform) {
	const dir = normalize([rootVelocity[0], 0, rootVelocity[2]], [0, 0, 1]);
	const targetWorld = add(home.world, mul(dir, state.stepLength * 0.5));
	const startWorld = anchorWorld(leg, platform);
	leg.swing = {
		t: 0,
		startWorld,
		targetWorld,
		startPlatform: inverseTransformPoint(startWorld, platform),
		targetPlatform: inverseTransformPoint(targetWorld, platform),
	};
	leg.planted = null;
}

function sampleSwing(leg, state, platform) {
	const s = Math.min(1, leg.swing.t);
	const start = leg.swing.startPlatform ? transformPoint(leg.swing.startPlatform, platform) : leg.swing.startWorld;
	const target = leg.swing.targetPlatform ? transformPoint(leg.swing.targetPlatform, platform) : leg.swing.targetWorld;
	const p = [
		start[0] + (target[0] - start[0]) * s,
		start[1] + (target[1] - start[1]) * s + Math.sin(Math.PI * s) * state.stepHeight,
		start[2] + (target[2] - start[2]) * s,
	];
	return { world: p, platform: inverseTransformPoint(p, platform) };
}

function plantAt(leg, point, platform) {
	leg.planted = {
		world: point.world.slice(),
		platform: point.platform ? point.platform.slice() : inverseTransformPoint(point.world, platform),
	};
	leg.swing = null;
}

export function stepGait(state, pose, locomotion, context) {
	const root = context.root;
	const platform = context.platform ?? { position: [0, 0, 0], yaw: 0 };
	const rootVelocity = context.root?.velocity ?? [0, 0, 0];
	const group = activeGroup(context.nextTime ?? 0, state.swingTime);
	const bipedSwinging = state.legs.length === 2 && state.legs.some((leg) => leg.swing);
	const feet = [];
	let swingCount = 0;

	for (const leg of state.legs) {
		const hip = readA(pose, leg.slotUpper);
		const home = homeForLeg(leg, hip, root, platform);
		if (!leg.planted && !leg.swing) plantAt(leg, home, platform);

		if (leg.planted) {
			const lagSpace = leg.planted.platform ? leg.planted.platform : leg.planted.world;
			const homeSpace = leg.planted.platform ? home.platform : home.world;
			const canStart = !(state.legs.length === 2 && bipedSwinging);
			if (horizontalLag(lagSpace, homeSpace) > state.stepLength && leg.group === group && canStart) {
				startSwing(leg, home, rootVelocity, state, platform);
			}
		}

		let foot;
		let planted = Boolean(leg.planted);
		if (leg.swing) {
			leg.swing.t += (context.fixedDt ?? 1 / 60) / state.swingTime;
			if (leg.swing.t >= 1) {
				plantAt(leg, { world: leg.swing.targetWorld, platform: leg.swing.targetPlatform }, platform);
				foot = anchorWorld(leg, platform);
				planted = true;
			} else {
				const sampled = sampleSwing(leg, state, platform);
				foot = sampled.world;
				planted = false;
				swingCount += 1;
			}
		} else {
			foot = anchorWorld(leg, platform);
		}

		const footBody = worldToBody(foot, root, platform);
		const solved = solveTwoBoneIK(hip, footBody, leg.upperLength, leg.lowerLength, defaultBendHintForHip(hip));
		writeLeg(pose, leg, hip, solved.knee, solved.foot);
		feet.push({
			partId: leg.partId,
			planted,
			world: foot.slice(),
			platform: inverseTransformPoint(foot, platform),
			group: leg.group,
		});
	}

	const referenceLength = Math.max(1e-4, state.legs[0]?.upperLength + state.legs[0]?.lowerLength ?? 0.6);
	return {
		pose,
		telemetry: {
			feet,
			swingCount,
			stanceCount: state.legs.length - swingCount,
			froude: (Number(locomotion?.speed ?? state.speed) ** 2) / (G * referenceLength),
		},
	};
}

export function gaitShouldFroudeFail(speed, limbLength) {
	const L = Math.max(Number(limbLength), 1e-4);
	return (speed * speed) / (G * L) > 1;
}
