import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAffineSlotTransforms, restPoseFromCompiled } from '../../core/deformation.js';
import { unpackReferenceAsset } from '../../core/reference-asset-format.js';
import { compileSpec } from '../../core/rig-compiler.js';
import { buildReferenceBufferGeometry } from '../../lab/reference-geometry.js';
import { IdentityPagePool } from '../../runtime/identity-pages.js';
import { createReferencePageStorage } from '../../tsl/reference-page-storage.js';
import { createReferenceCreatureMaterial } from '../../tsl/reference-material.js';

const here = dirname(fileURLToPath(import.meta.url));

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

async function runReferencePageStorage() {
	const storage = createReferencePageStorage({ capacity: 4, slotCount: 2 });
	const transform = new Float32Array(2 * 24);
	transform.fill(0.25);
	storage.writeTransforms(2, transform);
	storage.writeRoot(2, 1, 2, 3, 0.5);
	storage.writeVisibleSlots([2]);
	const upload = storage.markDirty();
	const expectedTransformBytes = transform.byteLength;
	if (upload.transforms.bytes !== expectedTransformBytes || upload.roots.bytes !== 16 || upload.visibleSlots.bytes !== 4
		|| upload.totalBytes !== expectedTransformBytes + 20 || storage.visibleSlotsArray[0] !== 2 || storage.visibleCount !== 1) {
		return { status: 'fail', details: { message: 'reference page storage layout or exact dirty bytes drifted', upload } };
	}
	const idle = storage.markDirty();
	if (idle.totalBytes !== 0) return { status: 'fail', details: { message: 'idle reference page storage scheduled an upload', idle } };
	let duplicateRejected = false;
	try { storage.writeVisibleSlots([1, 1]); } catch (error) { duplicateRejected = /duplicated/.test(error.message); }
	storage.dispose();
	if (!duplicateRejected) return { status: 'fail', details: { message: 'duplicate visible stable slots were accepted' } };
	return { status: 'pass', details: { upload, idle, duplicateRejected } };
}

async function runReferenceRenderBindings() {
	const labRoot = resolve(here, '../../..');
	const [manifestText, binary, specText] = await Promise.all([
		readFile(resolve(labRoot, 'assets/reference/biped.surface.json'), 'utf8'),
		readFile(resolve(labRoot, 'assets/reference/biped.surface.bin')),
		readFile(resolve(labRoot, 'src/lab/specs/biped.json'), 'utf8'),
	]);
	const manifest = JSON.parse(manifestText);
	const arrays = unpackReferenceAsset(manifest, new Uint8Array(binary));
	const compiled = compileSpec(JSON.parse(specText), { tier: 'hero', maxParts: 64, candidateK: 64 });
	const geometry = buildReferenceBufferGeometry({ manifest, arrays }, compiled);
	const storage = createReferencePageStorage({ capacity: 4, slotCount: compiled.slots.length });
	storage.writeTransforms(0, buildAffineSlotTransforms(compiled, restPoseFromCompiled(compiled)));
	storage.writeRoot(0, 0, 0, 0, 0);
	storage.writeVisibleSlots([0]);
	const material = createReferenceCreatureMaterial({ storage, slotCount: compiled.slots.length, tier: 'hero' });
	const valid = geometry.attributes.position.count === manifest.certification.topology.vertexCount
		&& geometry.index.count === manifest.certification.topology.triangleCount * 3
		&& geometry.userData.representation === 'canonical-reference-surface-candidate'
		&& material.positionNode === material.castShadowPositionNode
		&& material.userData.fieldEvaluation === 'none in canonical fragment shading';
	const details = { vertices: geometry.attributes.position.count, triangles: geometry.index.count / 3, representation: geometry.userData.representation, sharedShadowNode: material.positionNode === material.castShadowPositionNode };
	material.dispose();
	geometry.dispose();
	storage.dispose();
	if (!valid) return { status: 'fail', details: { message: 'reference render bindings drifted', ...details } };
	return { status: 'pass', details };
}

async function runReferenceIdentityMutation() {
	const labRoot = resolve(here, '../../..');
	const [manifestText, binary, specText] = await Promise.all([
		readFile(resolve(labRoot, 'assets/reference/biped.surface.json'), 'utf8'),
		readFile(resolve(labRoot, 'assets/reference/biped.surface.bin')),
		readFile(resolve(labRoot, 'src/lab/specs/biped.json'), 'utf8'),
	]);
	const manifest = JSON.parse(manifestText);
	const arrays = unpackReferenceAsset(manifest, new Uint8Array(binary));
	const compiled = compileSpec(JSON.parse(specText), { tier: 'hero', maxParts: 64, candidateK: 64 });
	const mutations = [
		['compilerSignature', { ...compiled, compilerSignature: `${compiled.compilerSignature}-mutated` }],
		['topologySignature', { ...compiled, topologySignature: `${compiled.topologySignature}-mutated` }],
		['geometryDigest', { ...compiled, geometryDigest: `${compiled.geometryDigest}-mutated` }],
		['tier', { ...compiled, tier: 'crowd' }],
	];
	const rejected = [];
	for (const [name, mutated] of mutations) {
		try {
			buildReferenceBufferGeometry({ manifest, arrays }, mutated).dispose();
		} catch (error) {
			rejected.push({ name, message: error.message });
		}
	}
	if (rejected.length !== mutations.length) {
		return { status: 'fail', details: { message: 'reference asset identity mutation was accepted', rejected, expected: mutations.map(([name]) => name) } };
	}
	return { status: 'pass', details: { rejected } };
}

export const gates = [
	{ id: 'stable-identity-pages', run: runStableIdentityPages },
	{ id: 'page-reuse-generation', run: runPageReuseGeneration },
	{ id: 'reference-page-storage', run: runReferencePageStorage },
	{ id: 'reference-render-bindings', run: runReferenceRenderBindings },
	{ id: 'reference-identity-mutation', run: runReferenceIdentityMutation },
];
