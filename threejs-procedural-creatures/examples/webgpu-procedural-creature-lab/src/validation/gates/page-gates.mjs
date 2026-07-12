import { IdentityPagePool } from '../../runtime/identity-pages.js';

const identity = Object.freeze({ compilerSignature: 'compiler', topologySignature: 'topology', geometryDigest: 'geometry', tier: 'hero', skinningMethod: 'lbs', correctionLayout: 'none' });

async function runStableIdentityPages() {
	const pool = new IdentityPagePool({ capacity: 2, maximumPagesPerIdentity: 2, bytesPerSlot: { pose: 48, transform: 96, root: 16, bounds: 16, correctionPose: 32 } });
	const first = pool.allocate(identity);
	const second = pool.allocate(identity);
	const third = pool.allocate(identity);
	if (first.pageId !== second.pageId || third.pageId === first.pageId || first.slot !== 0 || second.slot !== 1 || third.slot !== 0) {
		return { status: 'fail', details: { message: 'fixed-page allocation or controlled overflow drifted', first, second, third } };
	}
	pool.consumeUploads(first.pageId);
	pool.markDirty(first, 'pose');
	pool.markDirty(second, 'pose');
	pool.markDirty(first, 'root');
	const upload = pool.consumeUploads(first.pageId);
	if (upload.uploads.pose.ranges.length !== 1 || upload.uploads.pose.ranges[0].count !== 2 || upload.uploads.pose.bytes !== 96 || upload.uploads.root.bytes !== 16 || upload.totalBytes !== 112) {
		return { status: 'fail', details: { message: 'dirty page ranges or exact byte accounting drifted', upload } };
	}
	const visibility = pool.setVisible([second, third]);
	const stableUpload = pool.consumeUploads(first.pageId);
	if (visibility.length !== 2 || stableUpload.totalBytes !== 0 || pool.snapshot().find((page) => page.id === first.pageId).visibleSlots[0] !== second.slot) {
		return { status: 'fail', details: { message: 'visibility indirection rewrote stable pose storage', visibility, stableUpload, snapshot: pool.snapshot() } };
	}
	return { status: 'pass', details: { handles: [first, second, third], upload, visibility, snapshot: pool.snapshot() } };
}

async function runPageReuseGeneration() {
	const pool = new IdentityPagePool({ capacity: 1, maximumPagesPerIdentity: 1 });
	const first = pool.allocate(identity);
	const nextGeneration = pool.release(first);
	const reused = pool.allocate(identity);
	let staleRejected = false;
	try { pool.markDirty(first, 'pose'); } catch (error) { staleRejected = /stale/.test(error.message); }
	if (reused.slot !== first.slot || reused.generation !== nextGeneration || !staleRejected) {
		return { status: 'fail', details: { message: 'slot reuse did not invalidate stale temporal identity', first, reused, nextGeneration, staleRejected } };
	}
	let exhausted = false;
	try { pool.allocate(identity); } catch (error) { exhausted = /budget exhausted/.test(error.message); }
	if (!exhausted) return { status: 'fail', details: { message: 'page budget exhaustion silently resized an active page' } };
	return { status: 'pass', details: { first, reused, nextGeneration, staleRejected, exhausted } };
}

export const gates = [
	{ id: 'stable-identity-pages', run: runStableIdentityPages },
	{ id: 'page-reuse-generation', run: runPageReuseGeneration },
];
