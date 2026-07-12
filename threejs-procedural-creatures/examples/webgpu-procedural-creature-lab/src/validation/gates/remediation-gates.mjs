import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateBlendSchema } from '../../core/blend-dag.js';
import { advance, createDriver } from '../../core/driver.js';
import { mutateSpec, perceptualColorDeltaE } from '../../core/locomotion/genome.js';
import { compileSpec } from '../../core/rig-compiler.js';
import { validateSpec } from '../../core/spec-schema.js';
import {
	CREATURE_TIER_ROUTES,
	distributeCreaturePopulation,
} from '../../lab/route-config.js';
import { createGenomeSpec } from '../../lab/specs/genome.js';
import {
	clearMaterialVariantCache,
	createCreatureMaterial,
	materialCacheSize,
	materialCacheSnapshot,
	releaseCreatureMaterial,
} from '../../tsl/materials.js';
import { createCandidateStorage, createPoseStorage } from '../../tsl/pose-storage.js';

const here = dirname(fileURLToPath(import.meta.url));
const labRoot = resolve(here, '../../..');

function fixture() {
	return {
		name: 'blend-dag-mutation-fixture',
		seed: 7,
		locomotion: { type: 'none' },
		parts: [
			{ id: 'a', shape: 'sphere', offset: [-0.31, 0.52, 0], r: 0.28, k: 0.11, color: '#6b7fd7' },
			{ id: 'b', shape: 'sphere', offset: [0.12, 0.62, 0.08], r: 0.24, k: 0.13, color: '#d77f6b' },
			{ id: 'c', shape: 'sphere', offset: [0.38, 0.42, -0.06], r: 0.2, k: 0.09, color: '#75b47a' },
		],
		blend: {
			mode: 'tree',
			nodes: [
				{ id: 'ab', left: { part: 'a' }, right: { part: 'b' }, k: 0.12 },
				{ id: 'root', left: { node: 'ab' }, right: { part: 'c' }, k: 0.08 },
			],
			roots: [{ node: 'root' }],
		},
	};
}

function renamedAndReordered(spec) {
	const clone = structuredClone(spec);
	const names = new Map([['a', 'torso-renamed'], ['b', 'head-renamed'], ['c', 'tail-renamed']]);
	clone.parts = clone.parts.reverse().map((part) => ({
		...part,
		id: names.get(part.id),
		parent: part.parent ? names.get(part.parent) : undefined,
	}));
	clone.blend.nodes = clone.blend.nodes.reverse().map((node) => ({
		...node,
		left: node.left.part ? { part: names.get(node.left.part) } : { ...node.left },
		right: node.right.part ? { part: names.get(node.right.part) } : { ...node.right },
	}));
	return clone;
}

function throws(callback, pattern) {
	try {
		callback();
	} catch (error) {
		if (!pattern.test(String(error?.message ?? error))) throw error;
		return String(error.message);
	}
	throw new Error(`mutation was accepted; expected ${pattern}`);
}

async function runBlendDagMutations() {
	const authored = compileSpec(fixture(), { tier: 'hero', maxParts: 16, candidateK: 3 });
	const renamed = compileSpec(renamedAndReordered(fixture()), { tier: 'hero', maxParts: 16, candidateK: 3 });
	if (authored.blendDag.canonicalSource !== renamed.blendDag.canonicalSource || authored.topologySignature !== renamed.topologySignature) {
		return { status: 'fail', details: { message: 'part/node rename or input order changed the canonical blend program' } };
	}
	const regrouped = fixture();
	regrouped.blend.nodes = [
		{ id: 'bc', left: { part: 'b' }, right: { part: 'c' }, k: 0.12 },
		{ id: 'root', left: { part: 'a' }, right: { node: 'bc' }, k: 0.08 },
	];
	const regroupedCompiled = compileSpec(regrouped, { tier: 'hero', maxParts: 16, candidateK: 3 });
	if (regroupedCompiled.blendDag.canonicalSource === authored.blendDag.canonicalSource) {
		return { status: 'fail', details: { message: 'a non-associative blend regrouping did not change the canonical program' } };
	}
	const duplicate = fixture();
	duplicate.blend.nodes[0].right = { part: 'a' };
	const duplicateReason = throws(() => validateSpec(duplicate), /exactly once|does not reach/);
	const shared = fixture();
	shared.blend.nodes.push({ id: 'shared-parent', left: { node: 'ab' }, right: { part: 'c' }, k: 0.1 });
	shared.blend.roots = [{ node: 'shared-parent' }];
	shared.blend.nodes.find((node) => node.id === 'root').left = { node: 'ab' };
	const sharedReason = throws(() => validateBlendSchema(shared.blend, new Set(['a', 'b', 'c'])), /exactly one parent/);
	return {
		status: 'pass',
		details: {
			canonicalSource: authored.blendDag.canonicalSource,
			renameOrderInvariant: true,
			regroupingDetected: true,
			duplicateReason,
			sharedReason,
		},
	};
}

async function runCertifiedRuntimeBindingMutation() {
	const spec = fixture();
	const insufficient = compileSpec(spec, { tier: 'hero', maxParts: 16, candidateK: 1 });
	if (insufficient.candidateCertificates.some((certificate) => certificate.status !== 'insufficient' || Number.isFinite(certificate.distanceTailBound))) {
		return { status: 'fail', details: { message: 'under-capacity candidate program fabricated a finite tail certificate' } };
	}
	const compiled = compileSpec(spec, { tier: 'hero', maxParts: 16, candidateK: 3 });
	if (compiled.candidateCertificates.some((certificate) => certificate.status !== 'accepted-exact'
		|| certificate.distanceTailBound !== 0
		|| certificate.normalAngularBoundRadians !== 0
		|| certificate.perceptualColorDeltaEBound !== 0)) {
		return { status: 'fail', details: { message: 'full blend ancestry did not produce exact distance/normal/color certificates' } };
	}
	const pose = createPoseStorage({ maxCreatures: 2, maxParts: 16 });
	const wrong = createCandidateStorage({
		candidateSets: compiled.candidateSets,
		maxParts: 16,
		K: 3,
		certificateDigest: 'mutated-certificate-digest',
	});
	const reason = throws(() => createCreatureMaterial({
		tier: 'hero',
		K: 3,
		poseStorage: pose,
		candidateStorage: wrong,
		maxParts: 16,
		maxRadius: compiled.maxRadius,
		blendDag: compiled.blendDag,
		candidateCertificateDigest: compiled.candidateCertificateDigest,
		compilerSignature: compiled.compilerSignature,
		topologySignature: compiled.topologySignature,
		geometryDigest: compiled.geometryDigest,
		shaderContractDigest: compiled.shaderContractDigest,
	}), /does not match/);
	wrong.dispose();
	pose.dispose();
	return { status: 'pass', details: { reason, exactCertificates: compiled.candidateCertificates.length } };
}

async function runCacheBindingMutation() {
	if (materialCacheSize() !== 0) clearMaterialVariantCache({ force: true });
	const compiled = compileSpec(fixture(), { tier: 'hero', maxParts: 16, candidateK: 3 });
	const poseA = createPoseStorage({ maxCreatures: 1, maxParts: 16 });
	const poseB = createPoseStorage({ maxCreatures: 1, maxParts: 16 });
	const candidates = createCandidateStorage({
		candidateSets: compiled.candidateSets,
		maxParts: 16,
		K: 3,
		certificateDigest: compiled.candidateCertificateDigest,
	});
	const options = {
		tier: 'hero', K: 3, candidateStorage: candidates, maxParts: 16, maxRadius: compiled.maxRadius,
		blendDag: compiled.blendDag, candidateCertificateDigest: compiled.candidateCertificateDigest,
		compilerSignature: compiled.compilerSignature, topologySignature: compiled.topologySignature,
		geometryDigest: compiled.geometryDigest, shaderContractDigest: compiled.shaderContractDigest,
	};
	const a0 = createCreatureMaterial({ ...options, poseStorage: poseA });
	const a1 = createCreatureMaterial({ ...options, poseStorage: poseA });
	const b = createCreatureMaterial({ ...options, poseStorage: poseB });
	if (a0 !== a1 || a0 === b) return { status: 'fail', details: { message: 'cache ignored binding identity or failed to share an identical binding' } };
	const snapshot = materialCacheSnapshot();
	if (snapshot.length !== 2 || !snapshot.some((entry) => entry.refCount === 2)) {
		return { status: 'fail', details: { message: 'cache reference counts do not match live material handles', snapshot } };
	}
	const liveClearReason = throws(() => clearMaterialVariantCache(), /live referenced/);
	releaseCreatureMaterial(a0);
	releaseCreatureMaterial(a1);
	releaseCreatureMaterial(b);
	if (materialCacheSize() !== 0) return { status: 'fail', details: { message: 'material variants survived their final release' } };
	candidates.dispose();
	poseA.dispose();
	poseB.dispose();
	return { status: 'pass', details: { variants: snapshot.length, sharedRefCount: 2, liveClearReason } };
}

async function runPartialUploadLifecycleMutation() {
	const storage = createPoseStorage({ maxCreatures: 96, maxParts: 64 });
	const pose = new Float32Array(3 * 12);
	for (let slot = 0; slot < 3; slot++) {
		pose[slot * 12 + 1] = slot * 0.2;
		pose[slot * 12 + 3] = 0.1;
		pose[slot * 12 + 5] = slot * 0.2 + 0.1;
		pose[slot * 12 + 7] = 0.1;
	}
	storage.writePose(17, pose, 3);
	storage.writeRootValues(17, 1, 2, 3, 0.2);
	const upload = storage.markDirty();
	const fullBytes = storage.poseArray.byteLength + storage.rootsArray.byteLength + storage.framesArray.byteLength;
	if (!(upload.bytes > 0 && upload.bytes < fullBytes) || upload.pose.count !== pose.length || upload.roots.count !== 4 || upload.frames.count !== 12) {
		return { status: 'fail', details: { message: 'single-creature write uploaded a full page or wrong exact ranges', upload, fullBytes } };
	}
	const idle = storage.markDirty();
	if (idle.bytes !== 0) return { status: 'fail', details: { message: 'idle storage re-uploaded unchanged data', idle } };
	storage.dispose();
	return { status: 'pass', details: { uploadBytes: upload.bytes, fullBytes, idleBytes: idle.bytes } };
}

async function runSupportSpringGenomeMutation() {
	const biped = JSON.parse(await readFile(resolve(labRoot, 'src/lab/specs/biped.json'), 'utf8'));
	const bipedCompiled = compileSpec(biped, { tier: 'hero', maxParts: 64 });
	const slope = 0.22;
	const normalLength = Math.hypot(slope, 1);
	const expectedNormal = [-slope / normalLength, 1 / normalLength, 0];
	const supportVelocity = [0.14, 0, 0.03];
	const querySupport = (point, metadata) => ({
		point: [point[0], slope * point[0], point[2]],
		normal: expectedNormal,
		velocityAtPoint: supportVelocity,
		frameId: 'moving-slope',
		supportCoord: metadata.supportCoord ?? [point[0], point[2]],
	});
	const walker = createDriver(biped, bipedCompiled, { querySupport });
	let result;
	for (let frame = 0; frame < 180; frame++) result = advance(walker, 1 / 60, { rootVelocity: [0, 0, 0.7] });
	const feet = result.telemetry.gait.feet;
	if (feet.some((foot) => foot.frameId !== 'moving-slope'
		|| Math.hypot(...foot.normal.map((value, axis) => value - expectedNormal[axis])) > 1e-9
		|| Math.hypot(...foot.surfaceVelocity.map((value, axis) => value - supportVelocity[axis])) > 1e-9)) {
		return { status: 'fail', details: { message: 'gait ignored support normal/frame/surface velocity', feet } };
	}

	const swimmer = JSON.parse(await readFile(resolve(labRoot, 'src/lab/specs/swimmer.json'), 'utf8'));
	const swimmerCompiled = compileSpec(swimmer, { tier: 'hero', maxParts: 64 });
	const water = (x, z, time) => ({
		height: 0.18 * Math.sin(time * 0.7 + x * 0.2),
		normal: [-0.036 * Math.cos(time * 0.7 + x * 0.2), 1, 0],
		surfaceVelocity: [0, 0.126 * Math.cos(time * 0.7 + x * 0.2), 0],
		materialCurrentVelocity: [0.25, 0, -0.08],
	});
	const swimA = createDriver(swimmer, swimmerCompiled, { waterSurfaceProvider: water });
	const swimB = createDriver(swimmer, swimmerCompiled, { waterSurfaceProvider: water });
	for (let frame = 0; frame < 180; frame++) advance(swimA, 1 / 60);
	for (let frame = 0; frame < 360; frame++) advance(swimB, 1 / 120);
	if (Math.abs(swimA.root.position[1] - swimB.root.position[1]) > 1e-12
		|| swimA.telemetry.swim.materialCurrentVelocity[0] !== 0.25) {
		return { status: 'fail', details: { message: 'critical swim spring is presentation-rate dependent or dropped material current', a: swimA.root, b: swimB.root } };
	}

	const mutatedA = mutateSpec(biped, 'perceptual-mutation', 3);
	const mutatedB = mutateSpec(biped, 'perceptual-mutation', 3);
	const deltaE = perceptualColorDeltaE(biped.parts[0].color, mutatedA.parts[0].color);
	const runtimeGenome = createGenomeSpec(biped, { seed: 1234, count: 1 })[0];
	if (JSON.stringify(mutatedA) !== JSON.stringify(mutatedB) || !(deltaE > 0 && deltaE <= 0.065)
		|| mutatedA.parts[0].r === undefined || runtimeGenome.parts[0].color === biped.parts[0].color) {
		return { status: 'fail', details: { message: 'genome mutation is nondeterministic, non-perceptual, or mutates ignored radius fields', deltaE } };
	}
	return { status: 'pass', details: { supportNormal: expectedNormal, swimY: swimA.root.position[1], deltaE } };
}

async function runControllerPipelineContractMutation() {
	const [browser, outline, materials, tierGraphs, manifest] = await Promise.all([
		readFile(resolve(labRoot, 'src/lab/browser-app.js'), 'utf8'),
		readFile(resolve(labRoot, 'src/tsl/outline-pass.js'), 'utf8'),
		readFile(resolve(labRoot, 'src/tsl/materials.js'), 'utf8'),
		readFile(resolve(labRoot, 'src/lab/tier-render-graphs.js'), 'utf8'),
		readFile(resolve(labRoot, 'lab.manifest.json'), 'utf8'),
	]);
	const requiredBrowserTokens = [
		'new RenderPipeline(renderer)',
		'configureTierRenderGraph(state.tier)',
		'setMRT(mrt({ output, normal: normalView }))',
		'setMRT(mrt({ output }))',
		'outputColorTransform = false',
		'DirectionalLight.shadow.map.depthTexture',
		'async ready()', 'async setScenario(id)', 'async setMode(id)', 'async setTier(id)', 'async setSeed(seed)',
		'async setCamera(id)', 'async setTime(seconds)', 'async step(deltaSeconds)', 'async resetHistory(cause)',
		'async resize(width, height, dpr)', 'async renderOnce()', 'async capturePixels(target)',
		'async measurePerformanceProfile(profileId)',
		'describePipeline', 'describeResources', 'getMetrics()', 'async dispose()',
		'async function leakLoop(cycles = 50)', 'state.measureTarget?.dispose?.()',
		'species.mesh.visible && (!state.cullingEnabled',
	];
	const missing = requiredBrowserTokens.filter((token) => !browser.includes(token));
	if (missing.length > 0) return { status: 'fail', details: { message: 'canonical controller/pipeline/lifecycle tokens missing', missing } };
	const renderBody = browser.match(/function renderOnce\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
	if (!renderBody.includes('state.renderPipeline.render()') || renderBody.includes('state.renderer.render(')) {
		return { status: 'fail', details: { message: 'canonical renderOnce bypasses the host RenderPipeline' } };
	}
	if (!outline.includes("getTextureNode('normal')") || !outline.includes("getTextureNode('depth')") || !outline.includes('outputNode: renderOutput')) {
		return { status: 'fail', details: { message: 'outline remains a descriptor instead of an MRT edge graph' } };
	}
	if (!tierGraphs.includes("hero: graph('hero', ['output', 'normal'], 'shared-normal-depth-edge', 4, 2048)")
		|| !tierGraphs.includes("crowd: graph('crowd', ['output', 'normal'], 'shared-normal-depth-edge', 1, 1024)")
		|| !tierGraphs.includes("background: graph('background', ['output'], 'none', 1, 512)")
		|| browser.includes('normal: normalView, emissive')) {
		return { status: 'fail', details: { message: 'tier render graphs allocate the wrong MRT or retain the unused emissive attachment' } };
	}
	if (!materials.includes('const objectIds = new WeakMap()') || !materials.includes('entry.refCount += 1') || materials.includes('material.receivedShadowPositionNode =')) {
		return { status: 'fail', details: { message: 'material cache identity/refcount or received-shadow transform contract regressed' } };
	}
	const parsedManifest = JSON.parse(manifest);
	if (parsedManifest.status !== 'incomplete') return { status: 'fail', details: { message: 'uncaptured creature lab was promoted beyond incomplete' } };
	const populations = Object.fromEntries(Object.entries(CREATURE_TIER_ROUTES).map(([id, route]) => [id, route.population]));
	if (populations.hero !== 4 || populations.crowd !== 64 || populations.background !== 96) {
		return { status: 'fail', details: { message: 'tier populations are not exact total-route populations', populations } };
	}
	for (const [tier, total] of Object.entries(populations)) {
		const counts = distributeCreaturePopulation(total, 6, tier === 'crowd' ? 1 : 0);
		if ([...counts].reduce((sum, count) => sum + count, 0) !== total || Math.max(...counts) > 16) {
			return { status: 'fail', details: { message: 'population distribution multiplies totals per species', tier, counts: [...counts] } };
		}
	}
	return { status: 'pass', details: { controllerMethods: 17, populations, status: parsedManifest.status } };
}

export const gates = [
	{ id: 'mutation-blend-dag-structure', run: runBlendDagMutations },
	{ id: 'mutation-certified-runtime-binding', run: runCertifiedRuntimeBindingMutation },
	{ id: 'mutation-cache-binding-identity', run: runCacheBindingMutation },
	{ id: 'mutation-partial-upload-lifecycle', run: runPartialUploadLifecycleMutation },
	{ id: 'mutation-support-spring-genome', run: runSupportSpringGenomeMutation },
	{ id: 'mutation-controller-pipeline-contract', run: runControllerPipelineContractMutation },
];
