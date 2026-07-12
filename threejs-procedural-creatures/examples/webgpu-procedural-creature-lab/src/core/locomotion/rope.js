const POSE_STRIDE = 12;
const GRAVITY = 3.5;
const DAMPING_KEEP = 0.88;
const RELAXATION_PASSES = 3;

function readA(pose, slot) {
	const base = slot * POSE_STRIDE;
	return [pose[base], pose[base + 1], pose[base + 2]];
}

function readB(pose, slot) {
	const base = slot * POSE_STRIDE;
	return [pose[base + 4], pose[base + 5], pose[base + 6]];
}

function writeSegment(pose, slot, a, b) {
	const base = slot * POSE_STRIDE;
	pose[base + 0] = a[0];
	pose[base + 1] = a[1];
	pose[base + 2] = a[2];
	pose[base + 4] = b[0];
	pose[base + 5] = b[1];
	pose[base + 6] = b[2];
}

function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function mul(v, s) {
	return [v[0] * s, v[1] * s, v[2] * s];
}

function length(v) {
	return Math.hypot(v[0], v[1], v[2]);
}

function groupRopes(records) {
	const groups = [];
	let current = null;
	for (const record of records) {
		if (record.shape !== 'rope') {
			current = null;
			continue;
		}
		if (!current || current.partId !== record.partId || record.ropeSegment === 0) {
			current = {
				partId: record.partId,
				slots: [],
				restLengths: [],
				followStrength: record.ropeFollowStrength ?? 0,
			};
			groups.push(current);
		}
		current.slots.push(record.partSlot);
		current.restLengths.push(length(sub(record.b, record.a)));
	}
	return groups;
}

export function createRopeState(spec, compiled) {
	const records = compiled.primitiveRecords ?? compiled.slots ?? [];
	return {
		groups: groupRopes(records).map((group) => ({
			...group,
			particles: null,
			previous: null,
			speedSum: 0,
		})),
	};
}

function initializeGroup(group, pose) {
	const count = group.slots.length + 1;
	group.particles = new Array(count);
	group.previous = new Array(count);
	for (let i = 0; i < count; i++) {
		const point = i === 0 ? readA(pose, group.slots[0]) : readA(pose, group.slots[i - 1] + 0).slice();
		if (i > 0) {
			const base = (i - 1) * POSE_STRIDE;
			point[0] = pose[group.slots[i - 1] * POSE_STRIDE + 4];
			point[1] = pose[group.slots[i - 1] * POSE_STRIDE + 5];
			point[2] = pose[group.slots[i - 1] * POSE_STRIDE + 6];
		}
		group.particles[i] = point.slice();
		group.previous[i] = [point[0] + 0.018 * i, point[1], point[2] - 0.006 * i];
	}
	group.previous[0] = group.particles[0].slice();
}

function verlet(group, anchor, targets, dt) {
	group.particles[0] = anchor.slice();
	group.previous[0] = anchor.slice();
	let speedSum = 0;
	for (let i = 1; i < group.particles.length; i++) {
		const p = group.particles[i];
		const prev = group.previous[i];
		const vx = (p[0] - prev[0]) * DAMPING_KEEP;
		const vy = (p[1] - prev[1]) * DAMPING_KEEP;
		const vz = (p[2] - prev[2]) * DAMPING_KEEP;
		group.previous[i] = p.slice();
		p[0] += vx;
		p[1] += vy - GRAVITY * dt * dt;
		p[2] += vz;
		const follow = group.followStrength;
		if (follow > 0) {
			p[0] += (targets[i][0] - p[0]) * follow;
			p[1] += (targets[i][1] - p[1]) * follow;
			p[2] += (targets[i][2] - p[2]) * follow;
		}
		speedSum += Math.hypot(vx / dt, vy / dt, vz / dt);
	}
	for (let pass = 0; pass < RELAXATION_PASSES; pass++) {
		group.particles[0] = anchor.slice();
		for (let i = 0; i < group.restLengths.length; i++) {
			const a = group.particles[i];
			const b = group.particles[i + 1];
			const delta = sub(b, a);
			const d = Math.max(length(delta), 1e-9);
			const diff = (d - group.restLengths[i]) / d;
			if (i === 0) {
				b[0] -= delta[0] * diff;
				b[1] -= delta[1] * diff;
				b[2] -= delta[2] * diff;
			} else {
				const correction = mul(delta, 0.5 * diff);
				group.particles[i] = add(a, correction);
				group.particles[i + 1] = sub(b, correction);
			}
		}
	}
	group.particles[0] = anchor.slice();
	group.previous[0] = anchor.slice();
	group.speedSum = speedSum;
}

export function stepRopes(state, pose, dt) {
	const telemetry = { groups: [] };
	if (!state?.groups) return telemetry;
	for (const group of state.groups) {
		if (!group.particles) initializeGroup(group, pose);
		const anchor = readA(pose, group.slots[0]);
		const targets = [anchor, ...group.slots.map((slot) => readB(pose, slot))];
		verlet(group, anchor, targets, dt);
		let maximumTargetDeviation = 0;
		for (let i = 1; i < group.particles.length; i++) {
			maximumTargetDeviation = Math.max(maximumTargetDeviation, length(sub(group.particles[i], targets[i])));
		}
		for (let i = 0; i < group.slots.length; i++) {
			writeSegment(pose, group.slots[i], group.particles[i], group.particles[i + 1]);
		}
		telemetry.groups.push({
			partId: group.partId,
			anchor: group.particles[0].slice(),
			expectedAnchor: anchor.slice(),
			speedSum: group.speedSum,
			followStrength: group.followStrength,
			maximumTargetDeviation,
			firstSlot: group.slots[0],
			lastSlot: group.slots[group.slots.length - 1],
			particles: group.particles.map((p) => p.slice()),
		});
	}
	return telemetry;
}
