import { buildShellGeometry, checkWinding, shellStatsForTier } from '../../core/shell-writer.js';

const expected = {
	hero: { vertsPerSlot: 98, trisPerSlot: 192 },
	crowd: { vertsPerSlot: 62, trisPerSlot: 120 },
	background: { vertsPerSlot: 50, trisPerSlot: 96 },
};

async function runShellWinding() {
	for (const tier of Object.keys(expected)) {
		const geometry = buildShellGeometry(3, tier);
		if (!checkWinding(geometry)) return { status: 'fail', details: { message: 'winding check failed', tier } };
	}
	return { status: 'pass', details: { tiers: Object.keys(expected) } };
}

async function runShellCounts() {
	for (const [tier, counts] of Object.entries(expected)) {
		const stats = shellStatsForTier(tier);
		const geometry = buildShellGeometry(2, tier);
		const verts = geometry.positions.length / 3 / geometry.slotCount;
		const tris = geometry.indices.length / 3 / geometry.slotCount;
		if (stats.vertsPerSlot !== counts.vertsPerSlot || stats.trisPerSlot !== counts.trisPerSlot) {
			return { status: 'fail', details: { message: 'stats mismatch', tier, stats, counts } };
		}
		if (verts !== counts.vertsPerSlot || tris !== counts.trisPerSlot) {
			return { status: 'fail', details: { message: 'geometry count mismatch', tier, verts, tris, counts } };
		}
	}
	return { status: 'pass', details: expected };
}

export const gates = [
	{ id: 'shell-winding', run: runShellWinding },
	{ id: 'shell-counts', run: runShellCounts },
];
