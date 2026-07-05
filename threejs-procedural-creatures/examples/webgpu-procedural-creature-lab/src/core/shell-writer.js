const TWO_PI = Math.PI * 2;

export const TIER_GEOMETRY = {
	hero: { radial: 12, capRings: 3 },
	crowd: { radial: 10, capRings: 2 },
	background: { radial: 8, capRings: 2 },
};

function sub(a, b) {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(v, s) {
	return [v[0] * s, v[1] * s, v[2] * s];
}

function dot(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
}

function len(v) {
	return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v, fallback = [0, 1, 0]) {
	const l = len(v);
	if (!Number.isFinite(l) || l < 1e-12) return fallback.slice();
	return scale(v, 1 / l);
}

export function basisFromAxis(axis) {
	const y = normalize(axis, [0, 1, 0]);
	const helper = Math.abs(y[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
	const x = normalize(cross(helper, y), [1, 0, 0]);
	const z = cross(y, x);
	return { x, y, z };
}

function basisPoint(local, basis, origin) {
	return add(origin, add(scale(basis.x, local[0]), add(scale(basis.y, local[1]), scale(basis.z, local[2]))));
}

function closestAxisPoint(p) {
	const t = Math.max(0, Math.min(1, p[1]));
	return [0, t, 0];
}

function outwardForPoint(p) {
	return normalize(sub(p, closestAxisPoint(p)));
}

function faceNormal(positions, i0, i1, i2) {
	const p0 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
	const p1 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
	const p2 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];
	return cross(sub(p1, p0), sub(p2, p0));
}

function centroid(positions, i0, i1, i2) {
	return [
		(positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3,
		(positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3,
		(positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3,
	];
}

function pushTri(indices, positions, a, b, c) {
	const n = faceNormal(positions, a, b, c);
	const outward = outwardForPoint(centroid(positions, a, b, c));
	if (dot(n, outward) > 0) indices.push(a, b, c);
	else indices.push(a, c, b);
}

export function shellStatsForTier(tier = 'hero') {
	const config = TIER_GEOMETRY[tier] ?? TIER_GEOMETRY.hero;
	return {
		tier,
		radial: config.radial,
		capRings: config.capRings,
		vertsPerSlot: (2 + 2 * config.capRings) * config.radial + 2,
		trisPerSlot: config.radial * (4 + 4 * config.capRings),
	};
}

function makeRings(radial, capRings) {
	const rings = [];
	for (let i = 1; i <= capRings; i++) {
		const phi = -Math.PI / 2 + (i * (Math.PI / 2)) / (capRings + 1);
		rings.push({ y: Math.sin(phi), radius: Math.cos(phi), axial: 0 });
	}
	rings.push({ y: 0, radius: 1, axial: 0 });
	rings.push({ y: 1, radius: 1, axial: 1 });
	for (let i = 1; i <= capRings; i++) {
		const phi = (i * (Math.PI / 2)) / (capRings + 1);
		rings.push({ y: 1 + Math.sin(phi), radius: Math.cos(phi), axial: 1 });
	}
	return rings.map((ring) => {
		const vertices = [];
		for (let s = 0; s < radial; s++) {
			const theta = (TWO_PI * s) / radial;
			vertices.push({ position: [Math.cos(theta) * ring.radius, ring.y, Math.sin(theta) * ring.radius], theta, axial: ring.axial });
		}
		return vertices;
	});
}

export function buildShellGeometry(slotCountOrSlots, tier = 'hero') {
	const slotCount = Array.isArray(slotCountOrSlots) ? slotCountOrSlots.length : slotCountOrSlots;
	const stats = shellStatsForTier(tier);
	const positions = [];
	const indices = [];
	const aPart = [];
	const aAxial = [];
	const aTheta = [];
	const slotRanges = [];

	for (let slot = 0; slot < slotCount; slot++) {
		const base = positions.length / 3;
		const rings = makeRings(stats.radial, stats.capRings);
		for (const ring of rings) {
			for (const vertex of ring) {
				positions.push(vertex.position[0], vertex.position[1], vertex.position[2]);
				aPart.push(slot);
				aAxial.push(vertex.axial);
				aTheta.push(vertex.theta);
			}
		}
		const south = positions.length / 3;
		positions.push(0, -1, 0);
		aPart.push(slot);
		aAxial.push(0);
		aTheta.push(0);
		const north = positions.length / 3;
		positions.push(0, 2, 0);
		aPart.push(slot);
		aAxial.push(1);
		aTheta.push(0);

		for (let s = 0; s < stats.radial; s++) {
			const next = (s + 1) % stats.radial;
			pushTri(indices, positions, south, base + s, base + next);
		}
		for (let r = 0; r < rings.length - 1; r++) {
			const row = base + r * stats.radial;
			const nextRow = row + stats.radial;
			for (let s = 0; s < stats.radial; s++) {
				const n = (s + 1) % stats.radial;
				pushTri(indices, positions, row + s, nextRow + s, row + n);
				pushTri(indices, positions, row + n, nextRow + s, nextRow + n);
			}
		}
		const last = base + (rings.length - 1) * stats.radial;
		for (let s = 0; s < stats.radial; s++) {
			const next = (s + 1) % stats.radial;
			pushTri(indices, positions, north, last + next, last + s);
		}

		slotRanges.push({ start: base, count: stats.vertsPerSlot });
	}

	return {
		positions: new Float32Array(positions),
		indices: new Uint32Array(indices),
		aPart: new Float32Array(aPart),
		aAxial: new Float32Array(aAxial),
		aTheta: new Float32Array(aTheta),
		slotCount,
		slotRanges,
		counts: {
			vertsPerSlot: stats.vertsPerSlot,
			trisPerSlot: stats.trisPerSlot,
		},
		tier,
	};
}

export function checkWinding(geometry) {
	const positions = geometry.positions;
	const indices = geometry.indices;
	for (let i = 0; i < indices.length; i += 3) {
		const i0 = indices[i];
		const i1 = indices[i + 1];
		const i2 = indices[i + 2];
		const n = faceNormal(positions, i0, i1, i2);
		const outward = outwardForPoint(centroid(positions, i0, i1, i2));
		if (!(dot(n, outward) > 0)) return false;
	}
	return true;
}

export function estimateShellBytes(tier, slotCount) {
	const stats = shellStatsForTier(tier);
	const vertices = stats.vertsPerSlot * slotCount;
	const triangles = stats.trisPerSlot * slotCount;
	return {
		vertices,
		triangles,
		positionBytes: vertices * 12,
		attributeBytes: vertices * 12,
		totalBytes: vertices * 24 + triangles * 12,
	};
}
