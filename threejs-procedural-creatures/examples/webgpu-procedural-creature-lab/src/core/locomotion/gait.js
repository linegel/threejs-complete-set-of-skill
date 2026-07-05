import { clampReach, make2BoneIKState, solveLimbTarget2Bone, update2BoneIK } from './ik.js';

const G = 9.81;
const EPS = 1e-9;

function clamp01(v) {
	return Math.min(1, Math.max(0, v));
}

function makeVec(x = 0, y = 0, z = 0) {
	return [ x, y, z ];
}

function sub(a, b) {
	return [ a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] ];
}

function add(a, b) {
	return [ a[ 0 ] + b[ 0 ], a[ 1 ] + b[ 1 ], a[ 2 ] + b[ 2 ] ];
}

function mul(v, s) {
	return [ v[ 0 ] * s, v[ 1 ] * s, v[ 2 ] * s ];
}

function dot(a, b) {
	return a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ];
}

function length(v) {
	return Math.hypot(v[ 0 ], v[ 1 ], v[ 2 ]);
}

function normalize(v) {
	const d = length(v);
	if (!Number.isFinite(d) || d < EPS) return [ 0, 0, 0 ];
	return [ v[ 0 ] / d, v[ 1 ] / d, v[ 2 ] / d ];
}

function blend(a, b, t) {
	return add(a, mul(sub(b, a), t));
}

function resolveLegGroups(legs) {
	return legs.map((leg, index) => {
		return {
			...leg,
			group: index % 2
		};
	});
}

export function estimateSwingTime(legLength = 0.5, gravity = G) {
	const L = Math.max(legLength, 0.08);
	return 0.18 * Math.sqrt(Math.max(L, 0.08) / 0.44);
}

export function createGaitState(spec, compiler) {
	const locomotion = spec.locomotion || {};
	const g = locomotion.gait ?? {};
	const speed = Number.isFinite(locomotion.speed) ? Math.max(0.05, locomotion.speed) : 1;
	const stepLength = Number.isFinite(locomotion.stepLength) ? Math.max(0.05, locomotion.stepLength) : 0.6;
	const stepHeight = Number.isFinite(locomotion.stepHeight) ? Math.max(0.02, locomotion.stepHeight) : 0.18;
	const phase = Number.isFinite(locomotion.phase) ? locomotion.phase : 0;
	const allLegs = compiler.primitiveRecords
		.filter((primitive) => primitive.shape === 'leg-upper')
		.map((primitive) => {
			const hip = primitive.meta && primitive.meta.hip ? primitive.meta.hip : [ 0, 0, 0 ];
			const lower = compiler.primitiveRecords.find((entry) => entry.partSlot === primitive.partSlot + 1 && entry.meta && entry.meta.lower);
			return {
				slotUpper: primitive.partSlot,
				slotLower: lower ? lower.partSlot : primitive.partSlot + 1,
				upperLength: Number(primitive.meta?.upper || primitive.ra || 0.44),
				lowerLength: Number(lower?.meta?.lower || lower?.ra || 0.44),
				hip: [ ...hip ],
				phase: Number(primitive.meta?.phase || 0)
			};
		});

	const legGroups = resolveLegGroups(allLegs);
	const gaitState = {
		t: phase,
		stepLength,
		stepHeight,
		speed,
		stateTime: 0,
		swingPhase: 0,
		activeLegs: new Map(),
		lastRootVelocity: makeVec(),
		lastFootDeltaWorld: new Float32Array(legGroups.length * 3),
		legs: legGroups,
		ikStates: legGroups.map((leg) => {
			const ikState = make2BoneIKState({
				hip: leg.hip,
				upperLength: leg.upperLength,
				lowerLength: leg.lowerLength,
				hint: [ Math.sign(leg.phase || 1) * 0.2, 0, 1 ]
			});
			return ikState;
		}),
		homeCache: legGroups.map((leg) => makeVec(...leg.hip))
	};
	gaitState.swingTime = Number.isFinite(g.swingTime) ? g.swingTime : estimateSwingTime(Math.max(0.1, gaitState.legs[ 0 ]?.upperLength || 0.44));
	gaitState.swingTime = clamp01(gaitState.swingTime / Math.max(0.01, stepLength));
	return gaitState;
};

function computeTargetForLeg(leg, gaitState, rootVelocity) {
	const stepLength = gaitState.stepLength;
	const stepVec = mul(rootVelocity, 0.2);
	const home = gaitState.homeCache[ leg.legIndex ];
	const overshoot = mul(normalize( stepVec.length ? stepVec : makeVec(1, 0, 0) ), stepLength * 0.5);
	return add(home, overshoot);
}

function setLegFromIK(leg, segment, pose) {
	const upperBase = leg.slotUpper * 8;
	const lowerBase = leg.slotLower * 8;
	pose[ upperBase + 0 ] = segment.hip[ 0 ];
	pose[ upperBase + 1 ] = segment.hip[ 1 ];
	pose[ upperBase + 2 ] = segment.hip[ 2 ];
	pose[ upperBase + 3 ] = segment.knee[ 0 ];
	pose[ upperBase + 4 ] = segment.knee[ 1 ];
	pose[ upperBase + 5 ] = segment.knee[ 2 ];

	pose[ lowerBase + 0 ] = segment.knee[ 0 ];
	pose[ lowerBase + 1 ] = segment.knee[ 1 ];
	pose[ lowerBase + 2 ] = segment.knee[ 2 ];
	pose[ lowerBase + 3 ] = segment.foot[ 0 ];
	pose[ lowerBase + 4 ] = segment.foot[ 1 ];
	pose[ lowerBase + 5 ] = segment.foot[ 2 ];
}

export function stepGait(state, pose, locomotion, dt, context = {}) {
	if (!state || !pose) {
		throw new Error("gait state and pose are required");
	}
	const fixedDt = Number.isFinite(dt) ? Math.max(0, dt) : 1 / 60;
	const speed = Number.isFinite(state.speed) ? state.speed : 1;
	const stepLength = Number.isFinite(state.stepLength) ? state.stepLength : 0.6;
	const stepHeight = Number.isFinite(state.stepHeight) ? state.stepHeight : 0.18;
	const swingTarget = Math.min(0.5, state.swingTime);
	const rootVelocity = context.rootVelocity || [ 0, 0, 0 ];
	const groundY = context.groundY ?? 0;
	const strideT = clamp01(state.t + fixedDt / Math.max(1e-6, swingTarget));
	state.t = strideT % 1;

	let movingLegCount = 0;
	const frenet = normalize(rootVelocity);
	const sideSign = frenet[ 0 ] >= 0 ? 1 : -1;
	const canLiftAnyButBoth = state.legs.length === 2 ? 1 : Infinity;
	for (let i = 0; i < state.legs.length; i += 1) {
		const leg = state.legs[ i ];
		leg.legIndex = i;
		const upperBase = leg.slotUpper * 8;
		const hip = [ pose[ upperBase ], pose[ upperBase + 1 ], pose[ upperBase + 2 ] ];
		const swing = state.activeLegs.get(i);
		const legVelocity = [ rootVelocity[ 0 ], rootVelocity[ 1 ], rootVelocity[ 2 ] ];
		const lag = length(sub(hip, state.homeCache[i]));
		const shouldLift = (
			!swing &&
			lag > stepLength &&
			state.legs.length > 1 &&
			(state.activeLegs.size < canLiftAnyButBoth || canLiftAnyButBoth === 1 && state.legs.length === 2) &&
			(leg.group === Math.floor(state.t > 0.5 ? 1 : 0))
		);

		if (shouldLift) {
			state.activeLegs.set(i, {
				phase: 0,
				phaseOffset: leg.group * 0.5,
				group: leg.group
			});
		}

		if (swing) {
			swing.phase += fixedDt / Math.max(0.01, state.swingTime * 0.18);
			const s = clamp01(swing.phase);
			movingLegCount += 1;
			if (s >= 1) {
				state.activeLegs.delete(i);
				state.homeCache[ i ] = computeTargetForLeg(leg, state, rootVelocity);
				state.lastFootDeltaWorld.set([ 0, 0, 0 ], i * 3);
			} else {
				const arc = Math.sin(Math.PI * s) * stepHeight;
				const forward = mul(legVelocityVector(legVelocity, sideSign), 0.5);
				const target = add(state.homeCache[i], forward);
				const swingPos = [
					blend(state.homeCache[i][0], target[0], s),
					groundY + arc,
					blend(state.homeCache[i][2], target[2], s)
				];
				const ik = update2BoneIK({
					...state.ikStates[i],
					hip,
					upperLength: clampReach(leg.upperLength, 0.01, 2),
					lowerLength: clampReach(leg.lowerLength, 0.01, 2)
				}, swingPos, true);
				setLegFromIK(leg, ik, pose);
			}
		} else {
			const knee = solveLimbTarget2Bone(
				hip,
				state.homeCache[i],
				clampReach(leg.upperLength, 0.01, 2),
				clampReach(leg.lowerLength, 0.01, 2),
				state.ikStates[i].hint
			);
			setLegFromIK(leg, knee, pose);
		}
	}

	state.lastRootVelocity = [ rootVelocity[ 0 ], rootVelocity[ 1 ], rootVelocity[ 2 ] ];
	state.stateTime += fixedDt;
	return {
		pose,
		stanceLegCount: Math.max(0, state.legs.length - movingLegCount),
		movingLegCount,
		footDeltaWorld: Array.from(state.lastFootDeltaWorld)
	};
}

function legVelocityVector(velocity, sideSign = 1) {
	return [
		velocity[ 0 ] * sideSign * 0.5,
		0,
		velocity[ 2 ] * sideSign * 0.5
	];
}

export function gaitShouldFroudeFail(speed, limbLength) {
	const L = Math.max(Number(limbLength), 1e-4);
	return (speed * speed) / (9.81 * L) > 1;
}

