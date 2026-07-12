import {
	AmbientLight,
	BufferAttribute,
	BufferGeometry,
	Color,
	DoubleSide,
	DirectionalLight,
	Frustum,
	HemisphereLight,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshStandardMaterial,
	OrthographicCamera,
	PCFSoftShadowMap,
	PerspectiveCamera,
	PlaneGeometry,
	Scene,
	Sphere,
} from 'three';
import { MeshBasicNodeMaterial, QuadMesh, RenderPipeline, RenderTarget, UnsignedByteType, WebGPURenderer } from 'three/webgpu';
import {
	Fn,
	attributeArray,
	color,
	emissive,
	instanceIndex,
	int,
	mrt,
	normalView,
	output,
	pass,
	renderOutput,
	screenUV,
	texture,
	vec4,
} from 'three/tsl';
import { advanceInPlace, createDriver, getPoseSnapshot, POSE_STRIDE, seek, step } from '../core/driver.js';
import { certifyCandidateCapacity } from '../core/candidate-certification.js';
import { evaluateField } from '../core/field.js';
import { createLCG } from '../core/lcg.js';
import { perceptualColorDeltaE } from '../core/locomotion/genome.js';
import { compileSpec, digest128, TIER_CONFIG } from '../core/rig-compiler.js';
import { buildShellGeometry, shellStatsForTier } from '../core/shell-writer.js';
import { validateSpec } from '../core/spec-schema.js';
import { createGenomeSpec } from './specs/genome.js';
import { evaluatePerformanceResult, PERFORMANCE_PROFILE_VERSION, performanceProfile } from './performance-profiles.js';
import {
	CREATURE_FOCI,
	CREATURE_MODES,
	CREATURE_TIERS,
	distributeCreaturePopulation,
	resolveCreatureStartup,
	startupFromDataset,
	validateCreatureFocus,
	validateCreatureMode,
	validateCreatureTier,
} from './route-config.js';
import { buildFieldNodes, createFieldParityProbe } from '../tsl/field-nodes.js';
import { createCreatureMaterial, materialCacheSize, clearMaterialVariantCache, releaseCreatureMaterial } from '../tsl/materials.js';
import { createOutlinePass } from '../tsl/outline-pass.js';
import { createCandidateStorage, createPoseStorage } from '../tsl/pose-storage.js';

const specNames = [...CREATURE_FOCI];
const debugModes = [...CREATURE_MODES];
const tiers = [...CREATURE_TIERS];
const startup = startupFromDataset(document.body?.dataset ?? {});
const specUrls = Object.freeze({
	biped: new URL('./specs/biped.json', import.meta.url),
	quadruped: new URL('./specs/quadruped.json', import.meta.url),
	hexapod: new URL('./specs/hexapod.json', import.meta.url),
	hopper: new URL('./specs/hopper.json', import.meta.url),
	flyer: new URL('./specs/flyer.json', import.meta.url),
	swimmer: new URL('./specs/swimmer.json', import.meta.url),
});
const MAX_PARTS = 64;
const MAX_CREATURES = 96;
const SPECIES_CAP = 16;
const FIXED_ROOT_VELOCITY = [0.12, 0, 0.03];
const ROOT_STEP_CONTEXT = Object.freeze({ rootVelocity: FIXED_ROOT_VELOCITY });
const IDENTITY_MATRIX = new Matrix4();

const canvas = document.getElementById('lab-canvas');
const statusEl = document.getElementById('status');

const state = {
	ready: false,
	specs: [],
	species: [],
	activeCreatures: [],
	focusIndex: Math.max(0, specNames.indexOf(startup.focus)),
	tier: startup.tier,
	debugMode: startup.mode,
	startup,
	renderer: null,
	renderPipeline: null,
	scenePass: null,
	scene: null,
	camera: null,
	ground: null,
	light: null,
	poseStorage: null,
	outline: null,
	lastFrameMs: 16.667,
	frameCount: 0,
	bootCounters: null,
	boot: {
		pipelineCompilesAfterReveal: 0,
		bufferReallocsAfterInit: 0,
		spawnMedianMs: 0,
		firstFrameRatio: 1,
	},
	timing: {
		firstFrameMs: 0,
		steadyFrameSamples: [],
	},
	certifications: new Map(),
	presentationLastMs: null,
	gpuErrors: [],
	deviceLoss: null,
	viewFrustum: new Frustum(),
	viewProjection: new Matrix4(),
	cullingEnabled: true,
	viewportOverride: null,
	activeCameraId: 'design',
	focusIsolation: startup.locked && startup.population === 1,
	culling: { totalInstances: 0, visibleInstances: 0, culledInstances: 0, submittedInstances: 0, strategy: 'cpu-frustum-compact-to-prefix' },
};

function setStatus(text) {
	if (statusEl) statusEl.textContent = text;
}

function bootNow() {
	// Boot instrumentation only: wall-clock timing is not used for simulation.
	return globalThis.performance?.['now']?.() ?? 0;
}

function instrumentationNow() {
	// Capture/validation instrumentation only; deterministic simulation never consumes wall time.
	return globalThis.performance?.['now']?.() ?? 0;
}

function fetchJson(path) {
	return fetch(path).then((response) => {
		if (!response.ok) throw new Error(`failed to fetch ${path}: ${response.status}`);
		return response.json();
	});
}

function wrapDeviceCounters(renderer) {
	const device = renderer.backend?.device;
	if (!device) throw new Error('WebGPU device unavailable after renderer.init()');
	const counters = {
		createRenderPipeline: 0,
		createRenderPipelineAsync: 0,
		createComputePipeline: 0,
		createBuffer: 0,
		countersAtInit: null,
		countersAtReveal: null,
		steadyStateDeltas: null,
		phaseMarks: [],
	};
	for (const method of ['createRenderPipeline', 'createRenderPipelineAsync', 'createComputePipeline', 'createBuffer']) {
		const original = device[method]?.bind(device);
		if (typeof original !== 'function') continue;
		device[method] = (...args) => {
			counters[method] += 1;
			return original(...args);
		};
	}
	const snapshot = () => ({
		createRenderPipeline: counters.createRenderPipeline,
		createRenderPipelineAsync: counters.createRenderPipelineAsync,
		createComputePipeline: counters.createComputePipeline,
		createBuffer: counters.createBuffer,
	});
	counters.snapshot = snapshot;
	counters.mark = (label) => counters.phaseMarks.push({ label, atMs: Number(bootNow().toFixed(3)), counters: snapshot() });
	window.__lab = { ready: false, bootCounters: counters };
	window.__lab.bootCounters = counters;
	// Instrumentation-only handle for validation probes (never used by render code).
	window.__labDevice = device;
	return counters;
}

function shellToBufferGeometry(shell) {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(shell.positions, 3));
	geometry.setAttribute('aPart', new BufferAttribute(shell.aPart, 1));
	geometry.setAttribute('aAxial', new BufferAttribute(shell.aAxial, 1));
	geometry.setAttribute('aTheta', new BufferAttribute(shell.aTheta, 1));
	geometry.setIndex(new BufferAttribute(shell.indices, 1));
	geometry.computeVertexNormals();
	geometry.computeBoundingSphere();
	geometry.userData.shell = shell;
	geometry.userData.representation = 'diagnostic-owner-masked-shell';
	return geometry;
}

function posedSphereFromPoseInto(pose, slotCount, root, layoutPosition, out) {
	let centerX = 0;
	let centerY = 0;
	let centerZ = 0;
	const count = slotCount * 2;
	let radius = 0;
	for (let slot = 0; slot < slotCount; slot++) {
		const base = slot * POSE_STRIDE;
		centerX += pose[base] + pose[base + 4];
		centerY += pose[base + 1] + pose[base + 5];
		centerZ += pose[base + 2] + pose[base + 6];
	}
	const inverseCount = count > 0 ? 1 / count : 1;
	centerX *= inverseCount;
	centerY *= inverseCount;
	centerZ *= inverseCount;
	for (let slot = 0; slot < slotCount; slot++) {
		const base = slot * POSE_STRIDE;
		const r = Math.max(pose[base + 3], pose[base + 7]);
		radius = Math.max(radius, Math.hypot(pose[base] - centerX, pose[base + 1] - centerY, pose[base + 2] - centerZ) + r);
		radius = Math.max(radius, Math.hypot(pose[base + 4] - centerX, pose[base + 5] - centerY, pose[base + 6] - centerZ) + r);
	}
	const position = root?.position ?? [0, 0, 0];
	const yaw = root?.yaw ?? 0;
	const cosine = Math.cos(yaw);
	const sine = Math.sin(yaw);
	const rotatedX = centerX * cosine + centerZ * sine;
	const rotatedZ = -centerX * sine + centerZ * cosine;
	out.center.set(
		layoutPosition[0] + (position[0] ?? 0) + rotatedX,
		layoutPosition[1] + (position[1] ?? 0) + centerY,
		layoutPosition[2] + (position[2] ?? 0) + rotatedZ,
	);
	out.radius = radius;
	return out;
}

function updateSpeciesMaterials() {
	for (const species of state.species) {
		const previousMaterial = species.mesh.material;
		const material = createCreatureMaterial({
			tier: state.tier,
			debugMode: state.debugMode,
			K: species.compiled.candidateK,
			poseStorage: state.poseStorage,
			candidateStorage: species.candidateStorage,
			maxParts: MAX_PARTS,
			maxRadius: species.compiled.maxRadius,
			instanceBase: species.creatureOffset,
			storageKey: `${species.spec.name}:${state.tier}:${state.debugMode}`,
			speciesKey: species.spec.name,
			compilerSignature: species.compiled.compilerSignature,
			topologySignature: species.compiled.topologySignature,
			geometryDigest: species.compiled.geometryDigest,
			shaderContractDigest: species.compiled.shaderContractDigest,
			blendDag: species.compiled.blendDag,
			candidateCertificateDigest: species.compiled.candidateCertificateDigest,
		});
		species.mesh.material = material;
		if (previousMaterial) releaseCreatureMaterial(previousMaterial);
		species.mesh.userData.shadowCasterParity = material.userData.shadowCasterParity;
	}
}

function updatePoseStorage() {
	state.camera.updateMatrixWorld(true);
	state.viewProjection.multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse);
	state.viewFrustum.setFromProjectionMatrix(state.viewProjection);
	let totalInstances = 0;
	let visibleInstances = 0;
	for (const species of state.species) {
		for (const creature of species.creatures) {
			const pose = creature.driver.presentPose ?? creature.driver.currentPose;
			posedSphereFromPoseInto(pose, species.compiled.slots.length, creature.driver.root, creature.layoutPosition, creature.boundingSphere);
		}
		let compactIndex = 0;
		species.unionSphere.makeEmpty();
		for (let i = 0; i < species.creatures.length; i++) {
			const creature = species.creatures[i];
			totalInstances += 1;
			const isVisible = species.mesh.visible && (!state.cullingEnabled || state.viewFrustum.intersectsSphere(creature.boundingSphere));
			creature.visible = isVisible;
			creature.visibleStorageIndex = isVisible ? species.creatureOffset + compactIndex : -1;
			if (!isVisible) continue;
			const pose = creature.driver.presentPose ?? creature.driver.currentPose;
			const creatureIndex = creature.visibleStorageIndex;
			state.poseStorage.writePose(creatureIndex, pose, species.compiled.slots.length, species.compiled.radialFrames);
			// Storage root = layout + driver root; the shader applies it once (a
			// custom positionNode clobbers instanceMatrix in r185 setupPosition, so
			// the instance matrix cannot carry root motion — see LAB_FINDINGS).
			state.poseStorage.writeRootValues(
				creatureIndex,
				creature.layoutPosition[0] + (creature.driver.root?.position?.[0] ?? 0),
				creature.layoutPosition[1] + (creature.driver.root?.position?.[1] ?? 0),
				creature.layoutPosition[2] + (creature.driver.root?.position?.[2] ?? 0),
				creature.driver.root?.yaw ?? 0,
			);
			species.mesh.setMatrixAt(compactIndex, IDENTITY_MATRIX);
			species.visibleIndices[compactIndex] = i;
			if (species.unionSphere.isEmpty()) species.unionSphere.copy(creature.boundingSphere);
			else species.unionSphere.union(creature.boundingSphere);
			compactIndex += 1;
			visibleInstances += 1;
		}
		species.visibleCount = compactIndex;
		species.mesh.count = compactIndex;
		species.mesh.instanceMatrix.needsUpdate = true;
		// Real posed bounds (doctrine: never frustumCulled=false, never a stale
		// unit-shell sphere). The displaced surface lives at storage positions,
		// so computeBoundingSphere() over the unit shell + identity matrices
		// would cull the whole population from close framings.
		if (!species.unionSphere.isEmpty()) species.mesh.boundingSphere.copy(species.unionSphere);
	}
	state.culling.totalInstances = totalInstances;
	state.culling.visibleInstances = visibleInstances;
	state.culling.culledInstances = totalInstances - visibleInstances;
	state.culling.submittedInstances = visibleInstances;
	state.lastPoseUpload = state.poseStorage.markDirty();
	return state.culling;
}

function createScene(renderer) {
	const scene = new Scene();
	scene.background = new Color(0x273039);
	const camera = new PerspectiveCamera(42, 1, 0.05, 80);
	camera.position.set(4.2, 3.0, 6.6);
	camera.lookAt(0, 0.75, 0);

	const ground = new Mesh(new PlaneGeometry(18, 14), new MeshStandardMaterial({ color: 0x56584f, roughness: 0.88 }));
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = -0.02;
	ground.receiveShadow = true;
	scene.add(ground);

	const sun = new DirectionalLight(0xffffff, 3.2);
	sun.position.set(4.5, 7.2, 4.0);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	// Bias pair (Derived): the snapped shell both casts and receives through the
	// same displaced position, so unbiased depth comparison self-shadows at
	// grazing texels (the "speckle" the visual judges flagged). bias ~1 depth
	// texel of the 16-unit ortho frustum; normalBias ~ one shadow texel in
	// world units (16/2048 = 0.0078 -> 0.02 covers PCF taps).
	sun.shadow.bias = -2e-4;
	sun.shadow.normalBias = 0.02;
	sun.shadow.camera.near = 0.5;
	sun.shadow.camera.far = 24;
	sun.shadow.camera.left = -8;
	sun.shadow.camera.right = 8;
	sun.shadow.camera.top = 8;
	sun.shadow.camera.bottom = -8;
	scene.add(sun);
	scene.add(new HemisphereLight(0x9fb8ff, 0x3b3025, 1.1));
	scene.add(new AmbientLight(0xffffff, 0.12));

	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = PCFSoftShadowMap;

	state.scene = scene;
	state.camera = camera;
	state.ground = ground;
	state.light = sun;
	state.scenePass = pass(scene, camera);
	state.scenePass.setMRT(mrt({ output, normal: normalView, emissive }));
	state.outline = createOutlinePass(state.scenePass);
	state.renderPipeline = new RenderPipeline(renderer);
	state.renderPipeline.outputColorTransform = false;
	state.renderPipeline.outputNode = state.outline.outputNode;
	state.renderPipeline.needsUpdate = true;
}

function layoutForSpecies(index) {
	const col = index % 3;
	const row = Math.floor(index / 3);
	return [(col - 1) * 2.65, 0, (row - 0.5) * 2.35];
}

function wgslSafeLabel(value) {
	return String(value).replace(/[^A-Za-z0-9_]/g, '_');
}

function certificationFor(spec, tier) {
	const identity = compileSpec(spec, { tier, maxParts: MAX_PARTS, candidateK: 1 });
	const key = `${identity.geometryDigest}:${tier}`;
	let certification = state.certifications.get(key);
	if (!certification) {
		certification = certifyCandidateCapacity(spec, { tier, maxParts: MAX_PARTS });
		if (certification.status !== 'accepted') throw new Error(certification.error);
		state.certifications.set(key, certification);
	}
	return certification;
}

function candidateSetsEqual(a, b) {
	return a.length === b.length && a.every((set, index) => (
		set.length === b[index]?.length && set.every((value, candidateIndex) => value === b[index][candidateIndex])
	));
}

function disposeCandidateStorages() {
	for (const storage of new Set(state.candidateStorages?.values?.() ?? [])) storage.dispose?.();
	state.candidateStorages?.clear();
}

function buildSpeciesRecords(specs) {
	state.species = [];
	state.activeCreatures = [];
	// ONE pose storage for the app's lifetime, sized to the hard caps. The
	// material variant cache outlives tier rebuilds and pins the storage node
	// objects it was compiled with — recreating storage per rebuild leaves
	// cached materials reading a buffer that no longer receives writes
	// (measured: blank creatures after every setTier with the render loop
	// paused).
	if (!state.poseStorage) {
		state.poseStorage = createPoseStorage({ maxCreatures: MAX_CREATURES, maxParts: MAX_PARTS, candidateK: 8 });
	}

	for (let index = 0; index < specs.length; index++) {
		const spec = validateSpec(specs[index], { maxParts: MAX_PARTS });
		const certification = certificationFor(spec, state.tier);
		const compiled = certification.compiled;
		const shell = buildShellGeometry(compiled.slots.length, state.tier);
		const geometry = shellToBufferGeometry(shell);
		// Same lifetime rule as poseStorage: the cached material variant for this
		// species+tier pins whichever candidate storage node it was compiled
		// with, so reuse one per species+tier (candidate sets are static for a
		// given spec topology + tier K).
		const candidateStorageKey = `${compiled.compilerSignature}:${compiled.topologySignature}:${compiled.geometryDigest}:${state.tier}:K${compiled.candidateK}`;
		state.candidateStorages ??= new Map();
		let candidateStorage = state.candidateStorages.get(candidateStorageKey);
		if (!candidateStorage) {
			candidateStorage = createCandidateStorage({
				candidateSets: compiled.candidateSets,
				maxParts: MAX_PARTS,
				K: compiled.candidateK,
				certificateDigest: compiled.candidateCertificateDigest,
				label: `CreatureCandidates_${wgslSafeLabel(spec.name)}_${state.tier}`,
			});
			state.candidateStorages.set(candidateStorageKey, candidateStorage);
		}
		const material = createCreatureMaterial({
			tier: state.tier,
			debugMode: state.debugMode,
			K: compiled.candidateK,
			poseStorage: state.poseStorage,
			candidateStorage,
			maxParts: MAX_PARTS,
			maxRadius: compiled.maxRadius,
			instanceBase: index * SPECIES_CAP,
			storageKey: `${spec.name}:${state.tier}:${state.debugMode}`,
			speciesKey: spec.name,
			compilerSignature: compiled.compilerSignature,
			topologySignature: compiled.topologySignature,
			geometryDigest: compiled.geometryDigest,
			shaderContractDigest: compiled.shaderContractDigest,
			blendDag: compiled.blendDag,
			candidateCertificateDigest: compiled.candidateCertificateDigest,
		});
		const mesh = new InstancedMesh(geometry, material, SPECIES_CAP);
		mesh.name = `creature:${spec.name}`;
		mesh.boundingSphere = new Sphere();
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.count = 1;
		mesh.visible = !state.focusIsolation || index === state.focusIndex;
		mesh.userData.shadowCasterParity = material.userData.shadowCasterParity;
		const driver = createDriver(spec, compiled, { seed: spec.seed ?? index + 1 });
		const species = {
			spec,
			compiled,
			certification,
			shell,
			geometry,
			candidateStorage,
			material,
			mesh,
			creatureOffset: index * SPECIES_CAP,
			visibleIndices: new Int32Array(SPECIES_CAP),
			visibleCount: 0,
			unionSphere: new Sphere(),
			creatures: [{ driver, genomeSpec: spec, genomeDigest: compiled.geometryDigest, layoutPosition: layoutForSpecies(index), boundingSphere: new Sphere() }],
		};
		candidateStorage.markDirty();
		state.species.push(species);
		state.activeCreatures.push(species.creatures[0]);
		state.scene.add(mesh);
	}
	updatePoseStorage();
}

function resizeRenderer() {
	const width = state.viewportOverride?.width ?? Math.max(640, window.innerWidth);
	const height = state.viewportOverride?.height ?? Math.max(420, window.innerHeight);
	state.camera.aspect = width / height;
	state.camera.updateProjectionMatrix();
	state.renderer.setSize(width, height, false);
	state.scenePass?.setSize?.(width, height);
}

function renderOnce() {
	resizeRenderer();
	updatePoseStorage();
	const start = instrumentationNow();
	state.renderPipeline.render();
	const elapsed = instrumentationNow() - start;
	state.frameCount += 1;
	state.lastFrameMs = Number(Math.max(0, elapsed).toFixed(4));
	if (state.frameCount === 1) state.timing.firstFrameMs = state.lastFrameMs;
	if (state.ready && state.timing.steadyFrameSamples.length < 180) state.timing.steadyFrameSamples.push(state.lastFrameMs);
	return telemetry();
}

function fixedFrame(timestampMs) {
	if (!state.holdSimulation) {
		const nowMs = Number.isFinite(timestampMs) ? timestampMs : (state.presentationLastMs ?? 0) + 1000 / 60;
		const dtSeconds = state.presentationLastMs === null
			? 1 / 60
			: Math.max(0, Math.min(0.25, (nowMs - state.presentationLastMs) / 1000));
		state.presentationLastMs = nowMs;
		for (const species of state.species) {
			for (const creature of species.creatures) advanceInPlace(creature.driver, dtSeconds, ROOT_STEP_CONTEXT);
		}
	}
	renderOnce();
}

// pauseLoop fully stops the loop (a perpetually rendering page starves other
// WebGPU pages' init in headless) AND freezes the simulation. resumeLoop
// re-registers it; rebuilt-scene captures need the live loop (headless WebGPU
// only brings freshly built resources live through loop-driven frames).
function pauseLoop() {
	state.holdSimulation = true;
	state.presentationLastMs = null;
	state.loopRegistered = false;
	state.renderer?.setAnimationLoop(null);
	return { paused: true };
}

function resumeLoop() {
	state.holdSimulation = false;
	state.presentationLastMs = null;
	state.loopRegistered = true;
	state.renderer?.setAnimationLoop(fixedFrame);
	return { paused: false };
}

function shadowParityTelemetry() {
	return state.species.map((species) => {
		const parity = species.mesh.userData.shadowCasterParity;
		return {
			name: species.spec.name,
			positionEqualsCast: parity?.positionNode === parity?.castShadowPositionNode,
			positionEqualsReceive: parity?.receivedShadowDerivedFromPositionWorld === true,
			castEqualsReceive: parity?.receivedShadowDerivedFromPositionWorld === true,
			allEqual: parity?.sharedPositionNode === parity?.positionNode
				&& parity?.positionNode === parity?.castShadowPositionNode
				&& parity?.receivedShadowDerivedFromPositionWorld === true,
			receivedShadowSpace: 'positionWorld derived from the shared snapped position node',
		};
	});
}

function readbackLayout(width, height, pixelLength, bytesPerTexel = 4) {
	const rowBytes = width * bytesPerTexel;
	const alignedRowBytes = Math.ceil(rowBytes / 256) * 256;
	// Three r185 WebGPUTextureUtils.copyTextureToBuffer owns this exact copy
	// layout: every non-final row uses the aligned GPU stride and the final row
	// stores only its tight texels. Carry that authored/inspected backend stride
	// directly; never infer it from total buffer length divided by height.
	const bufferByteLength = alignedRowBytes * (height - 1) + rowBytes;
	if (pixelLength !== bufferByteLength) {
		throw new Error(`Unexpected WebGPU readback length ${pixelLength}; expected backend copy length ${bufferByteLength}.`);
	}
	return {
		bytesPerRow: alignedRowBytes,
		gpuCopyBytesPerRow: alignedRowBytes,
		tightBytesPerRow: rowBytes,
		bufferByteLength,
		alignment: 256,
	};
}

function bytesToBase64(bytes) {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer ?? bytes);
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < view.length; i += chunkSize) {
		binary += String.fromCharCode(...view.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}

function metricFromSamples(samples) {
	const finite = samples.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
	if (finite.length === 0) return { median: 0, p95: 0, samples: 0 };
	const nearestRank = (probability) => finite[Math.max(0, Math.ceil(probability * finite.length) - 1)];
	return {
		median: Number(nearestRank(0.5).toFixed(4)),
		p95: Number(nearestRank(0.95).toFixed(4)),
		samples: finite.length,
	};
}

function describePipeline() {
	return {
		schemaVersion: 2,
		owners: {
			renderer: 'creature-lab',
			finalRenderPipeline: 'creature-lab',
			creatureStage: 'creature-runtime',
			shadowMaps: 'directional-light',
			toneMap: 'renderOutput',
			outputColorTransform: 'renderOutput',
		},
		signals: [
			{ id: 'output', producer: 'scene-mrt', consumers: ['outline-composite'] },
			{ id: 'normal', producer: 'scene-mrt', consumers: ['outline-composite'] },
			{ id: 'depth', producer: 'scene-mrt-depth', consumers: ['outline-composite'] },
			{ id: 'emissive', producer: 'scene-mrt', consumers: [] },
		],
		sceneSubmissions: [{ id: 'scene-mrt', kind: 'lit-scene', attachments: ['output', 'normal', 'emissive', 'depth'] }],
		computeDispatches: [],
		resources: describeResources().resources,
		finalToneMapOwner: 'renderOutput',
		finalOutputTransformOwner: 'renderOutput',
		outputColorTransformDisabledOnPipeline: state.renderPipeline?.outputColorTransform === false,
		outlineReachable: state.renderPipeline?.outputNode === state.outline?.outputNode,
	};
}

function describeResources() {
	const pose = state.poseStorage;
	const candidateBytes = [...(state.candidateStorages?.values?.() ?? [])]
		.reduce((sum, storage) => sum + storage.byteLength, 0);
	const resources = [
		{ id: 'creature-pose-storage', kind: 'storage-buffer', bytes: pose?.poseArray?.byteLength ?? 0 },
		{ id: 'creature-root-storage', kind: 'storage-buffer', bytes: pose?.rootsArray?.byteLength ?? 0 },
		{ id: 'creature-radial-frame-storage', kind: 'storage-buffer', bytes: pose?.framesArray?.byteLength ?? 0 },
		{ id: 'creature-candidate-storage', kind: 'storage-buffer', bytes: candidateBytes },
		{ id: 'scene-mrt-output', kind: 'render-target', producer: 'scene-mrt' },
		{ id: 'scene-mrt-normal', kind: 'render-target', producer: 'scene-mrt' },
		{ id: 'scene-mrt-emissive', kind: 'render-target', producer: 'scene-mrt' },
		{ id: 'scene-depth', kind: 'depth-target', producer: 'scene-mrt' },
		{ id: 'directional-shadow-atlas', kind: 'depth-target', width: state.light?.shadow?.mapSize?.x ?? 0, height: state.light?.shadow?.mapSize?.y ?? 0 },
	];
	return {
		schemaVersion: 2,
		resources,
		storageBytes: resources.filter((entry) => entry.kind === 'storage-buffer').reduce((sum, entry) => sum + entry.bytes, 0),
		candidateCertificates: state.species.map((entry) => ({
			species: entry.spec.name,
			digest: entry.compiled.candidateCertificateDigest,
			status: entry.compiled.candidateCertificates.every((certificate) => certificate.status === 'accepted-exact') ? 'accepted-exact' : 'insufficient',
		})),
	};
}

function telemetry() {
	const species = state.species[state.focusIndex];
	const creature = species?.creatures[0];
	const rendererInfo = state.renderer?.info ? JSON.parse(JSON.stringify(state.renderer.info)) : null;
	return {
		ready: state.ready,
		specs: state.specs.map((spec) => spec.name),
		focus: species?.spec.name,
		tier: state.tier,
		debugMode: state.debugMode,
		route: state.startup,
		rigSlots: species?.compiled.slots.length ?? 0,
		bodyLift: species?.compiled.bodyLift ?? 0,
		geometry: species?.compiled.geometry ?? shellStatsForTier(state.tier),
		driver: creature ? getPoseSnapshot(creature.driver) : null,
		camera: state.camera ? {
			position: state.camera.position.toArray(),
			fov: state.camera.fov,
			near: state.camera.near,
			far: state.camera.far,
		} : null,
		renderer: {
			isWebGPUBackend: state.renderer?.backend?.isWebGPUBackend === true,
			info: rendererInfo,
		},
		rendererInfo,
		pipeline: describePipeline(),
		resources: describeResources(),
		lastFrameMs: state.lastFrameMs,
		totalPopulation: state.species.reduce((sum, entry) => sum + entry.creatures.length, 0),
		lastPoseUpload: state.lastPoseUpload ?? null,
		bootCounters: state.bootCounters,
		boot: state.boot,
		timing: {
			firstFrameMs: state.timing.firstFrameMs,
			revealFrameSamples: state.timing.revealFrameSamples ?? null,
			revealMedianMs: state.timing.revealMedianMs ?? null,
			steadyFrameMs: metricFromSamples(state.timing.steadyFrameSamples),
		},
		shadowParity: shadowParityTelemetry(),
		materialCacheSize: materialCacheSize(),
		outline: state.outline ? {
			kind: state.outline.kind,
			normalThreshold: state.outline.normalThreshold,
			depthThreshold: state.outline.depthThreshold,
			widthPx: state.outline.widthPx,
			isoOffsetHull: state.outline.isoOffsetHull,
		} : null,
		culling: { ...state.culling },
		creatures: state.species.map((entry) => ({
			name: entry.spec.name,
			instances: entry.creatures.length,
			genomeDigests: entry.creatures.map((creatureEntry) => creatureEntry.genomeDigest),
			rigSlots: entry.compiled.slots.length,
			candidateK: {
				semantics: 'total contributor capacity including owner',
				initial: entry.certification.kInitial,
				required: entry.certification.kRequired,
				storageCapacity: entry.candidateStorage.K,
				corpusVersion: entry.certification.corpusVersion,
				corpusDigest: entry.certification.corpusDigest,
				blendDagVersion: entry.compiled.blendDag.version,
				candidateCertificateDigest: entry.compiled.candidateCertificateDigest,
				runtimeCertification: entry.compiled.runtimeCertification ?? null,
			},
			cacheIdentity: {
				compilerSignature: entry.compiled.compilerSignature,
				topologySignature: entry.compiled.topologySignature,
				geometryDigest: entry.compiled.geometryDigest,
				shaderContractDigest: entry.compiled.shaderContractDigest,
			},
			bodyLift: entry.compiled.bodyLift,
			geometry: entry.compiled.geometry,
			visibleInstances: entry.visibleCount,
			bounds: entry.creatures.map((creatureEntry) => ({
				center: creatureEntry.boundingSphere.center.toArray(),
				radius: creatureEntry.boundingSphere.radius,
				visible: creatureEntry.visible,
				visibleStorageIndex: creatureEntry.visibleStorageIndex,
			})),
		})),
	};
}

function focus(nameOrIndex) {
	const index = typeof nameOrIndex === 'number'
		? nameOrIndex
		: specNames.indexOf(validateCreatureFocus(String(nameOrIndex)));
	if (!Number.isInteger(index) || index < 0 || index >= state.species.length) throw new Error(`unknown creature focus '${nameOrIndex}'`);
	state.focusIndex = index;
	if (state.focusIsolation) {
		for (let speciesIndex = 0; speciesIndex < state.species.length; speciesIndex++) {
			state.species[speciesIndex].mesh.visible = speciesIndex === state.focusIndex;
		}
	}
	frameCameraOnFocus();
	return renderOnce();
}

function setFocusIsolation(enabled = true) {
	state.focusIsolation = enabled === true;
	for (let speciesIndex = 0; speciesIndex < state.species.length; speciesIndex++) {
		state.species[speciesIndex].mesh.visible = !state.focusIsolation || speciesIndex === state.focusIndex;
	}
	return renderOnce();
}

// Frame the main camera on the focused creature's posed bounding sphere so
// capture evidence shows the subject, not a wide shot of the whole population.
function frameCameraOnFocus(render = false) {
	const species = state.species[state.focusIndex];
	const creature = species?.creatures?.[0];
	if (!creature) return;
	updatePoseStorage();
	const sphere = creature.boundingSphere;
	if (!sphere) return;
	const cx = sphere.center.x;
	const cy = sphere.center.y;
	const cz = sphere.center.z;
	const distance = Math.max(1.2, sphere.radius * 3.2);
	state.camera.position.set(cx + distance * 0.62, cy + distance * 0.52, cz + distance * 0.78);
	state.camera.lookAt(cx, cy, cz);
	return render ? renderOnce() : state.culling;
}

// Wide framing over every creature's bounds — used by the seed-grid capture.
function frameCameraOnPopulation(render = true) {
	updatePoseStorage();
	const spheres = state.species.flatMap((species) => species.creatures.map((creature) => creature.boundingSphere)).filter(Boolean);
	if (spheres.length === 0) return render ? renderOnce() : state.culling;
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const sphere of spheres) {
		for (let i = 0; i < 3; i++) {
			const coordinate = sphere.center.getComponent(i);
			min[i] = Math.min(min[i], coordinate - sphere.radius);
			max[i] = Math.max(max[i], coordinate + sphere.radius);
		}
	}
	const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
	const extent = Math.max(max[0] - min[0], max[2] - min[2], 1);
	const distance = Math.max(3, extent * 0.9);
	state.camera.position.set(center[0] + distance * 0.55, center[1] + distance * 0.6, center[2] + distance * 0.85);
	state.camera.lookAt(center[0], center[1], center[2]);
	return render ? renderOnce() : state.culling;
}

function setCamera(cameraId = 'design', options = {}) {
	if (!['near', 'design', 'far', 'population'].includes(cameraId)) throw new Error(`unknown creature camera '${cameraId}'`);
	state.activeCameraId = cameraId;
	if (cameraId === 'population') {
		frameCameraOnPopulation(false);
	} else {
		frameCameraOnFocus(false);
		const species = state.species[state.focusIndex];
		const sphere = species?.creatures?.[0]?.boundingSphere;
		if (sphere && cameraId !== 'design') {
			const factor = cameraId === 'near' ? 0.72 : 2.1;
			const direction = state.camera.position.clone().sub(sphere.center).normalize();
			const distance = Math.max(1.05, sphere.radius * 3.2 * factor);
			state.camera.position.copy(sphere.center).addScaledVector(direction, distance);
			state.camera.lookAt(sphere.center);
		}
	}
	return options.render === false ? state.culling : renderOnce();
}

async function setTier(value = 'hero', options = {}) {
	const tier = validateCreatureTier(value);
	if (state.startup.locked && options.overrideLock !== true && tier !== state.startup.tier) {
		throw new Error(`route locks creature tier '${state.startup.tier}', not '${tier}'`);
	}
	if (tier === state.tier) return renderOnce();
	const population = Math.max(1, state.species.reduce((sum, species) => sum + species.creatures.length, 0));
	for (const species of state.species) {
		state.scene.remove(species.mesh);
		species.geometry.dispose();
		releaseCreatureMaterial(species.mesh.material);
	}
	disposeCandidateStorages();
	state.tier = tier;
	buildSpeciesRecords(state.specs);
	spawnGrid(state.startup.seed, population, { render: false });
	renderOnce();
	// Freshly built GPU resources only come live through real loop-driven
	// frames (measured in headless WebGPU: rebuild -> capture within one JS
	// turn reads blank). Yield a few animation frames so the registered loop
	// renders the rebuilt scene before any single-shot capture.
	for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
	return renderOnce();
}

function setDebugMode(mode = 'off', options = {}) {
	const resolved = validateCreatureMode(mode);
	if (state.startup.locked && state.startup.scenario && options.overrideLock !== true && resolved !== state.startup.mode) {
		throw new Error(`route locks creature mode '${state.startup.mode}', not '${resolved}'`);
	}
	state.debugMode = resolved;
	updateSpeciesMaterials();
	return renderOnce();
}

async function setScenario(id) {
	const resolved = resolveCreatureStartup({ scenario: id });
	if (state.startup.locked && state.startup.scenario !== resolved.scenario) {
		throw new Error(`route locks creature scenario '${state.startup.scenario ?? `tier/${state.startup.tier}`}'`);
	}
	await setTier(resolved.tier, { overrideLock: true });
	state.startup = resolved;
	setDebugMode(resolved.mode, { overrideLock: true });
	state.focusIndex = specNames.indexOf(resolved.focus);
	spawnGrid(resolved.seed, resolved.population, { render: false });
	state.focusIsolation = resolved.population === 1;
	for (let speciesIndex = 0; speciesIndex < state.species.length; speciesIndex++) {
		state.species[speciesIndex].mesh.visible = !state.focusIsolation || speciesIndex === state.focusIndex;
	}
	if (resolved.population > 1) frameCameraOnPopulation(false);
	else frameCameraOnFocus(false);
	return renderOnce();
}

function seekAll(timeSeconds = 0) {
	for (const species of state.species) {
		for (const creature of species.creatures) seek(creature.driver, timeSeconds);
	}
	return renderOnce();
}

function stepAll(ticks = 1) {
	const count = Math.max(0, Math.floor(ticks));
	for (let i = 0; i < count; i++) {
		for (const species of state.species) {
			for (const creature of species.creatures) step(creature.driver, 1, { rootVelocity: FIXED_ROOT_VELOCITY });
		}
	}
	return renderOnce();
}

function advanceAll(deltaSeconds = 0) {
	const delta = Number(deltaSeconds);
	if (!Number.isFinite(delta) || delta < 0) throw new Error(`deltaSeconds must be finite and non-negative, received '${deltaSeconds}'`);
	for (const species of state.species) {
		for (const creature of species.creatures) advanceInPlace(creature.driver, delta, ROOT_STEP_CONTEXT);
	}
	return renderOnce();
}

function setSpecJSON(json) {
	try {
		const parsed = typeof json === 'string' ? JSON.parse(json) : json;
		const spec = validateSpec(parsed, { maxParts: MAX_PARTS });
		state.specs[state.focusIndex] = spec;
		for (const species of state.species) {
			state.scene.remove(species.mesh);
			species.geometry.dispose();
			releaseCreatureMaterial(species.mesh.material);
		}
		disposeCandidateStorages();
		buildSpeciesRecords(state.specs);
		return telemetry();
	} catch (error) {
		window.__lab.error = error.message;
		setStatus(`Creature Lab Spec Error: ${error.message}`);
		throw error;
	}
}

function spawnGrid(seed = 1, count = specNames.length, options = {}) {
	const totalPopulation = Math.min(MAX_CREATURES, Math.max(1, Math.floor(count)));
	const counts = distributeCreaturePopulation(totalPopulation, state.species.length, state.focusIndex);
	const gridWidth = Math.ceil(Math.sqrt(totalPopulation));
	let globalIndex = 0;
	let reboundCandidateStorage = false;
	state.activeCreatures.length = 0;
	for (const species of state.species) {
		const speciesIndex = state.species.indexOf(species);
		const speciesCount = counts[speciesIndex];
		const genomes = speciesCount > 0
			? createGenomeSpec(species.spec, { seed: Number(seed) + speciesIndex * 997, count: speciesCount })
			: [];
		const genomeCertifications = genomes.map((genomeSpec) => certificationFor(genomeSpec, state.tier));
		const runtimeK = Math.max(species.compiled.candidateK, ...genomeCertifications.map((entry) => entry.kRequired));
		const sharedCompiled = compileSpec(species.spec, { tier: state.tier, maxParts: MAX_PARTS, candidateK: runtimeK });
		sharedCompiled.runtimeCertification = Object.freeze({
			version: 'creature-runtime-genome-envelope-v3',
			digest: digest128(genomeCertifications.map((entry) => entry.certificationDigest)),
			candidateCertificateDigest: sharedCompiled.candidateCertificateDigest,
			genomeCertificationDigests: Object.freeze(genomeCertifications.map((entry) => entry.certificationDigest)),
		});
		species.compiled.runtimeCertification = sharedCompiled.runtimeCertification;
		const genomeCompilers = genomes.map((genomeSpec) => compileSpec(genomeSpec, {
			tier: state.tier,
			maxParts: MAX_PARTS,
			candidateK: runtimeK,
		}));
		for (let i = 0; i < genomeCompilers.length; i++) {
			const genomeCompiled = genomeCompilers[i];
			if (genomeCompiled.slots.length !== sharedCompiled.slots.length || !candidateSetsEqual(genomeCompiled.candidateSets, sharedCompiled.candidateSets)) {
				throw new Error(`runtime genome '${genomes[i].name}' escaped the certified shared-topology/candidate envelope at total K=${runtimeK}`);
			}
		}
		if (runtimeK !== species.compiled.candidateK) {
			species.compiled = sharedCompiled;
			species.certification = {
				...species.certification,
				kRequired: runtimeK,
				runtimeGenomeRequiredK: runtimeK,
			};
			const storageKey = `${sharedCompiled.compilerSignature}:${sharedCompiled.topologySignature}:${sharedCompiled.geometryDigest}:${state.tier}:K${runtimeK}`;
			let storage = state.candidateStorages.get(storageKey);
			if (!storage) {
				storage = createCandidateStorage({
					candidateSets: sharedCompiled.candidateSets,
					maxParts: MAX_PARTS,
					K: runtimeK,
					certificateDigest: sharedCompiled.candidateCertificateDigest,
					label: `CreatureCandidates_${wgslSafeLabel(species.spec.name)}_${state.tier}_K${runtimeK}`,
				});
				state.candidateStorages.set(storageKey, storage);
				storage.markDirty();
			}
			species.candidateStorage = storage;
			reboundCandidateStorage = true;
		}
		species.creatures = [];
		for (let i = 0; i < speciesCount; i++) {
			const genomeSpec = genomes[i];
			const genomeCompiled = genomeCompilers[i];
			const driver = createDriver(genomeSpec, genomeCompiled, { seed: Number(seed) + i + species.creatureOffset });
			const col = globalIndex % gridWidth;
			const row = Math.floor(globalIndex / gridWidth);
			const creature = {
				driver,
				genomeSpec,
				genomeDigest: genomeCompiled.geometryDigest,
				layoutPosition: [
					(col - (gridWidth - 1) * 0.5) * 0.55,
					0,
					(row - (Math.ceil(totalPopulation / gridWidth) - 1) * 0.5) * 0.55,
				],
				boundingSphere: new Sphere(),
			};
			species.creatures.push(creature);
			state.activeCreatures.push(creature);
			globalIndex += 1;
		}
	}
	if (reboundCandidateStorage) updateSpeciesMaterials();
	if (options.render === false) return updatePoseStorage();
	return renderOnce();
}

function readbackPose(creatureIndex = 0) {
	const index = Math.max(0, Math.floor(creatureIndex));
	let cursor = 0;
	for (const species of state.species) {
		if (index < cursor + species.creatures.length) return Array.from(species.creatures[index - cursor].driver.presentPose);
		cursor += species.creatures.length;
	}
	return [];
}

function creatureRecordForIndex(creatureIndex = 0) {
	const requested = Math.max(0, Math.floor(creatureIndex));
	for (const species of state.species) {
		if (requested >= species.creatureOffset && requested < species.creatureOffset + species.creatures.length) {
			const localIndex = requested - species.creatureOffset;
			const creature = species.creatures[localIndex];
			return { species, localIndex, storageIndex: creature.visibleStorageIndex >= 0 ? creature.visibleStorageIndex : requested };
		}
	}
	let cursor = 0;
	for (const species of state.species) {
		if (requested < cursor + species.creatures.length) {
			const localIndex = requested - cursor;
			const creature = species.creatures[localIndex];
			return { species, localIndex, storageIndex: creature.visibleStorageIndex >= 0 ? creature.visibleStorageIndex : species.creatureOffset + localIndex };
		}
		cursor += species.creatures.length;
	}
	const species = state.species[0];
	return { species, localIndex: 0, storageIndex: species?.creatureOffset ?? 0 };
}

function posePrimitivesFromStorage(creatureIndex, slotCount) {
	const pose = state.poseStorage.readPose(creatureIndex, slotCount);
	const primitives = [];
	for (let slot = 0; slot < slotCount; slot++) {
		const base = slot * POSE_STRIDE;
		primitives.push({
			a: [pose[base], pose[base + 1], pose[base + 2]],
			ra: pose[base + 3],
			b: [pose[base + 4], pose[base + 5], pose[base + 6]],
			rb: pose[base + 7],
			k: pose[base + 8],
			color: [pose[base + 9], pose[base + 10], pose[base + 11]],
		});
	}
	return primitives;
}

function fieldProbeCPU(creatureIndex = 0, points = []) {
	const { species, storageIndex } = creatureRecordForIndex(creatureIndex);
	const primitives = posePrimitivesFromStorage(storageIndex, species?.compiled.slots.length ?? 0);
	return points.map((entry) => {
		const point = Array.isArray(entry) ? entry : entry.point;
		const ownerSlot = Number.isInteger(entry?.ownerSlot) ? entry.ownerSlot : 0;
		const candidates = species?.compiled.candidateSets?.[ownerSlot]?.slice(0, species.compiled.candidateK) ?? null;
		const result = evaluateField(primitives, point, { candidates, blendDag: species.compiled.blendDag });
		return { d: result.d, grad: result.grad, color: result.color };
	});
}

async function gpuFieldProbes({ creatureIndex = 0, points = [] } = {}) {
	updatePoseStorage();
	const { species, storageIndex } = creatureRecordForIndex(creatureIndex);
	const probeCount = Math.max(0, points.length);
	if (probeCount === 0) {
		return {
			api: 'renderer.computeAsync + renderer.getArrayBufferAsync storage-buffer readback',
			creatureIndex: storageIndex,
			values: [],
		};
	}
	const pointNode = attributeArray(probeCount, 'vec4').setName('CreatureProbePoints');
	const outputNode = attributeArray(probeCount, 'vec4').setName('CreatureProbeOutput');
	for (let i = 0; i < probeCount; i++) {
		const entry = points[i];
		const point = Array.isArray(entry) ? entry : entry.point;
		pointNode.value.array[i * 4 + 0] = point?.[0] ?? 0;
		pointNode.value.array[i * 4 + 1] = point?.[1] ?? 0;
		pointNode.value.array[i * 4 + 2] = point?.[2] ?? 0;
		pointNode.value.array[i * 4 + 3] = Number.isInteger(entry?.ownerSlot) ? entry.ownerSlot : 0;
	}
	pointNode.value.needsUpdate = true;
	pointNode.value.addUpdateRange?.(0, pointNode.value.array.length);
	const fieldNodes = buildFieldNodes({
		poseStorage: state.poseStorage,
		candidateStorage: species.candidateStorage,
		blendDag: species.compiled.blendDag,
		maxParts: MAX_PARTS,
		tierConfig: {
			tier: state.tier,
			candidateK: species.compiled.candidateK,
			maxRadius: species.compiled.maxRadius,
			snapSteps: TIER_CONFIG[state.tier]?.snapSteps,
		},
	});
	const computeProbe = Fn(() => {
		const index = instanceIndex;
		const packedPoint = pointNode.element(index);
		const field = fieldNodes.evaluateFieldVec4(packedPoint.xyz, int(storageIndex), int(packedPoint.w));
		outputNode.element(index).assign(vec4(field.x, field.y, field.z, field.w));
	})().compute(probeCount);
	await state.renderer.computeAsync(computeProbe);
	const buffer = await state.renderer.getArrayBufferAsync(outputNode.value);
	const readback = new Float32Array(buffer);
	const values = [];
	for (let i = 0; i < probeCount; i++) {
		const entry = points[i];
		const point = Array.isArray(entry) ? entry : entry.point;
		values.push({
			point,
			ownerSlot: Number.isInteger(entry?.ownerSlot) ? entry.ownerSlot : 0,
			d: readback[i * 4 + 0],
			grad: [readback[i * 4 + 1], readback[i * 4 + 2], readback[i * 4 + 3]],
		});
	}
	return {
		api: 'renderer.computeAsync + renderer.getArrayBufferAsync storage-buffer readback using buildFieldNodes.evaluateFieldVec4 over pose/candidate storage',
		creatureIndex: storageIndex,
		values,
	};
}

function fieldProbe(creatureIndex, points) {
	return {
		bridge: 'fieldProbeCPU: storage-driven CPU eval using the exact pose buffer consumed by TSL; use gpuFieldProbes for browser GPU readback.',
		values: fieldProbeCPU(creatureIndex, points),
	};
}

function fieldParityArtifact() {
	const species = state.species[0];
	const rng = createLCG(0xc0ffee);
	const points = [];
	for (let i = 0; i < 1024; i++) {
		const slot = species.compiled.slots[i % species.compiled.slots.length];
		const t = rng.nextFloat();
		points.push([
			slot.a[0] + (slot.b[0] - slot.a[0]) * t + rng.nextRange(-slot.ra, slot.ra),
			slot.a[1] + (slot.b[1] - slot.a[1]) * t + rng.nextRange(-slot.ra, slot.ra),
			slot.a[2] + (slot.b[2] - slot.a[2]) * t + rng.nextRange(-slot.ra, slot.ra),
		]);
	}
	return createFieldParityProbe(species.compiled.slots, points, { tolerance: 3e-5 });
}

function lightCaptureCamera() {
	const camera = state.light.shadow.camera;
	state.light.updateMatrixWorld(true);
	camera.updateMatrixWorld(true);
	camera.updateProjectionMatrix();
	return camera;
}

async function captureFrame({ width = 960, height = 600, camera = 'main' } = {}) {
	const captureWidth = Math.max(1, Math.floor(width));
	const captureHeight = Math.max(1, Math.floor(height));
	const captureCamera = camera === 'light' ? lightCaptureCamera() : state.camera;
	const previousTarget = state.renderer.getRenderTarget?.() ?? null;
	const previousAspect = state.camera.aspect;
	const target = new RenderTarget(captureWidth, captureHeight, { samples: 1, type: UnsignedByteType });
	// The render loop stays registered app-wide (headless WebGPU only brings
	// rebuilt resources live through loop-driven frames), but it must not
	// interleave with the awaited capture renders below — suspend it for the
	// duration of the capture only.
	state.renderer.setAnimationLoop(null);
	try {
		if (captureCamera === state.camera) {
			state.camera.aspect = captureWidth / captureHeight;
			state.camera.updateProjectionMatrix();
		}
		updatePoseStorage();
		target.texture.generateMipmaps = false;
		// Single-shot capture: pipelines created asynchronously after a scene
		// mutation (setTier/spawnGrid rebuilds) silently skip their meshes on a
		// lone renderAsync — compile everything for this camera first.
		if (captureCamera === state.camera) {
			state.scenePass.setSize(captureWidth, captureHeight);
			await state.scenePass.compileAsync(state.renderer);
		} else {
			await state.renderer.compileAsync(state.scene, captureCamera);
		}
		state.renderer.setRenderTarget(target);
		// Warm pass: freshly REBUILT scenes (setTier) additionally need real
		// loop ticks before capture — the harness captures tiers under
		// resumeLoop() for that reason. The following readback is the completion
		// gate; an explicit queue.onSubmittedWorkDone() after RenderPipeline
		// render hangs this lab in current headless Chromium.
		if (captureCamera === state.camera) {
			state.renderPipeline.render();
		} else {
			await state.renderer.renderAsync(state.scene, captureCamera);
		}
		await state.renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1);
		updatePoseStorage();
		state.renderer.clear?.(true, true, true);
		if (captureCamera === state.camera) {
			state.renderPipeline.render();
		} else {
			await state.renderer.renderAsync(state.scene, captureCamera);
		}
		const pixels = await state.renderer.readRenderTargetPixelsAsync(target, 0, 0, captureWidth, captureHeight);
		return {
			width: captureWidth,
			height: captureHeight,
			...readbackLayout(captureWidth, captureHeight, pixels.length),
			pixelsBase64: bytesToBase64(pixels),
			camera,
		};
	} finally {
		state.renderer.setRenderTarget(previousTarget);
		if (captureCamera === state.camera) {
			state.camera.aspect = previousAspect;
			state.camera.updateProjectionMatrix();
			state.scenePass.setSize(Math.max(640, window.innerWidth), Math.max(420, window.innerHeight));
		}
		target.dispose();
		if (state.ready && state.loopRegistered) state.renderer.setAnimationLoop(fixedFrame);
	}
}

function makeCreatureOnlyVisibility(targetSpecies) {
	const previous = state.species.map((species) => ({ mesh: species.mesh, visible: species.mesh.visible }));
	for (const species of state.species) species.mesh.visible = species === targetSpecies;
	state.ground.visible = false;
	return () => {
		for (const entry of previous) entry.mesh.visible = entry.visible;
		state.ground.visible = true;
	};
}

async function captureLightMask({ creatureIndex = 1, width = 512, height = 512, mode = 'silhouette' } = {}) {
	const { species } = creatureRecordForIndex(creatureIndex);
	const restoreVisibility = makeCreatureOnlyVisibility(species);
	const material = new MeshBasicNodeMaterial();
	material.side = DoubleSide;
	material.positionNode = species.mesh.material.positionNode;
	if (mode === 'depth') {
		material.colorNode = species.mesh.material.colorNode;
	} else {
		material.colorNode = color(0xffffff);
	}
	const previousOverride = state.scene.overrideMaterial;
	state.scene.overrideMaterial = material;
	try {
		return await captureFrame({ width, height, camera: 'light' });
	} finally {
		state.scene.overrideMaterial = previousOverride;
		restoreVisibility();
		material.dispose();
	}
}

async function captureShadowAtlas({ creatureIndex = 1, width = 512, height = 512 } = {}) {
	const { species } = creatureRecordForIndex(creatureIndex);
	const restoreVisibility = makeCreatureOnlyVisibility(species);
	const previousTarget = state.renderer.getRenderTarget?.() ?? null;
	const target = new RenderTarget(width, height, { samples: 1, type: UnsignedByteType });
	const material = new MeshBasicNodeMaterial();
	const quad = new QuadMesh(material);
	state.renderer.setAnimationLoop(null);
	try {
		updatePoseStorage();
		await state.renderer.renderAsync(state.scene, state.camera);
		const shadowTarget = state.light.shadow.map;
		const depthTexture = shadowTarget?.depthTexture;
		if (!depthTexture) throw new Error('directional-light shadow atlas has no depthTexture after the canonical render');
		const depthSample = texture(depthTexture, screenUV).r;
		material.colorNode = vec4(depthSample, depthSample, depthSample, 1);
		state.renderer.setRenderTarget(target);
		quad.render(state.renderer);
		await state.renderer.backend.device.queue.onSubmittedWorkDone();
		const pixels = await state.renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
		return {
			width,
			height,
			...readbackLayout(width, height, pixels.length),
			pixelsBase64: bytesToBase64(pixels),
			source: 'DirectionalLight.shadow.map.depthTexture sampled by a fullscreen NodeMaterial',
			shadowMapSize: [state.light.shadow.mapSize.x, state.light.shadow.mapSize.y],
		};
	} finally {
		state.renderer.setRenderTarget(previousTarget);
		target.dispose();
		material.dispose();
		restoreVisibility();
		if (state.ready && state.loopRegistered) state.renderer.setAnimationLoop(fixedFrame);
	}
}

async function capturePipelinePixels(targetId = 'output') {
	const width = state.viewportOverride?.width ?? 1200;
	const height = state.viewportOverride?.height ?? 800;
	if (targetId === 'output' || targetId === 'final' || targetId === 'outline') {
		const capture = await captureFrame({ width, height, camera: 'main' });
		return {
			...capture,
			target: targetId,
			format: 'rgba8unorm',
			outputColorSpace: state.renderer.outputColorSpace,
			bytesPerPixel: 4,
			pixels: Uint8Array.from(atob(capture.pixelsBase64), (character) => character.charCodeAt(0)),
		};
	}
	if (targetId === 'shadow-atlas') return captureShadowAtlas({ width, height });
	if (!['normal', 'emissive', 'depth'].includes(targetId)) throw new Error(`unknown creature capture target '${targetId}'`);
	updatePoseStorage();
	state.renderPipeline.render();
	await state.renderer.backend.device.queue.onSubmittedWorkDone();
	const source = state.scenePass.getTextureNode(targetId);
	const sampled = source.sample(screenUV);
	const displayNode = targetId === 'normal'
		? vec4(sampled.xyz.mul(0.5).add(0.5), 1)
		: targetId === 'depth'
			? vec4(sampled.rrr, 1)
			: vec4(sampled.rgb, 1);
	const material = new MeshBasicNodeMaterial();
	material.colorNode = displayNode;
	const quad = new QuadMesh(material);
	const target = new RenderTarget(width, height, { samples: 1, type: UnsignedByteType });
	const previousTarget = state.renderer.getRenderTarget?.() ?? null;
	state.renderer.setAnimationLoop(null);
	try {
		state.renderer.setRenderTarget(target);
		quad.render(state.renderer);
		await state.renderer.backend.device.queue.onSubmittedWorkDone();
		const pixels = await state.renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
		return {
			target: targetId,
			width,
			height,
			format: 'rgba8unorm',
			outputColorSpace: state.renderer.outputColorSpace,
			bytesPerPixel: 4,
			...readbackLayout(width, height, pixels.length),
			pixels,
		};
	} finally {
		state.renderer.setRenderTarget(previousTarget);
		target.dispose();
		material.dispose();
		if (state.ready && state.loopRegistered) state.renderer.setAnimationLoop(fixedFrame);
	}
}

async function shadowMapFootprint({ creatureIndex = 1, width = 512, height = 512 } = {}) {
	const silhouette = await captureLightMask({ creatureIndex, width, height, mode: 'silhouette' });
	const shadowMap = await captureShadowAtlas({ creatureIndex, width, height });
	const silhouetteBytes = Uint8Array.from(atob(silhouette.pixelsBase64), (char) => char.charCodeAt(0));
	const shadowBytes = Uint8Array.from(atob(shadowMap.pixelsBase64), (char) => char.charCodeAt(0));
	const diff = new Uint8Array(width * height * 4);
	let diffTexels = 0;
	let perimeterTexels = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const si = y * silhouette.bytesPerRow + x * 4;
			const ti = y * shadowMap.bytesPerRow + x * 4;
			const di = (y * width + x) * 4;
			const s = silhouetteBytes[si] + silhouetteBytes[si + 1] + silhouetteBytes[si + 2] > 24;
			const backgroundDepth = (shadowBytes[0] + shadowBytes[1] + shadowBytes[2]) / 3;
			const sampledDepth = (shadowBytes[ti] + shadowBytes[ti + 1] + shadowBytes[ti + 2]) / 3;
			const t = Math.abs(sampledDepth - backgroundDepth) > 2;
			if (s !== t) diffTexels += 1;
			// Legend: bright red = mask mismatch (the gated quantity), dim gray =
			// both masks agree the creature is here, black = background.
			const agree = s && t;
			diff[di + 0] = s !== t ? 255 : agree ? 40 : 0;
			diff[di + 1] = agree ? 40 : 0;
			diff[di + 2] = agree ? 40 : 0;
			diff[di + 3] = 255;
			if (s && x > 0 && y > 0 && x < width - 1 && y < height - 1) {
				const left = silhouetteBytes[si - 4] + silhouetteBytes[si - 3] + silhouetteBytes[si - 2] > 24;
				const right = silhouetteBytes[si + 4] + silhouetteBytes[si + 5] + silhouetteBytes[si + 6] > 24;
				const up = silhouetteBytes[si - silhouette.bytesPerRow] + silhouetteBytes[si - silhouette.bytesPerRow + 1] + silhouetteBytes[si - silhouette.bytesPerRow + 2] > 24;
				const down = silhouetteBytes[si + silhouette.bytesPerRow] + silhouetteBytes[si + silhouette.bytesPerRow + 1] + silhouetteBytes[si + silhouette.bytesPerRow + 2] > 24;
				if (!left || !right || !up || !down) perimeterTexels += 1;
			}
		}
	}
	const jitterTexels = 1;
	const derivedBudgetTexels = perimeterTexels * jitterTexels;
	return {
		width: silhouette.width,
		height: silhouette.height,
		silhouette,
		shadowMap,
		diff: {
			width,
			height,
			bytesPerRow: width * 4,
			pixelsBase64: bytesToBase64(diff),
		},
		diffTexels,
		perimeterTexels,
		jitterTexels,
		derivedBudgetTexels,
		derivation: `N = perimeterTexels * jitterTexels = ${perimeterTexels} * ${jitterTexels} = ${derivedBudgetTexels}; jitterTexels is fixed at 1 because both light-view masks use the same ${width}x${height} texel grid.`,
		provenance: 'silhouette is an independent light-view coverage render; shadowMap is a fullscreen readback of DirectionalLight.shadow.map.depthTexture from the canonical pipeline render',
	};
}

function spawnCostSample(count = 48) {
	const samples = [];
	const species = state.species[0];
	const slotCount = species.compiled.slots.length;
	const n = Math.max(1, Math.floor(count));
	for (let i = 0; i < n; i++) {
		const start = instrumentationNow();
		const driver = createDriver(species.spec, species.compiled, { seed: 1000 + i * 17 });
		state.poseStorage.writePose(species.creatureOffset, driver.presentPose ?? driver.currentPose, slotCount);
		state.poseStorage.writeRoot(species.creatureOffset, driver.root);
		samples.push(instrumentationNow() - start);
	}
	state.poseStorage.markDirty();
	const metric = metricFromSamples(samples);
	state.boot.spawnMedianMs = metric.median;
	return { medianMs: metric.median, samples: samples.map((sample) => Number(sample.toFixed(4))) };
}

function driftMarkers({ creatureIndex = 0, seconds = 4 } = {}) {
	const { species, localIndex } = creatureRecordForIndex(creatureIndex);
	const creature = species.creatures[localIndex];
	seek(creature.driver, 0);
	const frames = Math.max(1, Math.floor(seconds * 60));
	const planted = new Map();
	let maxWorldDisplacement = 0;
	for (let frame = 0; frame < frames; frame++) {
		step(creature.driver, 1, { rootVelocity: FIXED_ROOT_VELOCITY });
		for (const [id, foot] of creature.driver.feet?.entries?.() ?? []) {
			if (!foot.planted || !foot.world) {
				planted.delete(id);
				continue;
			}
			const previous = planted.get(id);
			if (previous) {
				const dx = foot.world[0] - previous[0];
				const dy = foot.world[1] - previous[1];
				const dz = foot.world[2] - previous[2];
				maxWorldDisplacement = Math.max(maxWorldDisplacement, Math.hypot(dx, dy, dz));
			}
			planted.set(id, foot.world.slice());
		}
	}
	renderOnce();
	return {
		creatureIndex,
		seconds,
		maxWorldDisplacement,
		threshold: 1e-4,
		space: 'world',
	};
}

function stepSimulationTick() {
	for (const species of state.species) {
		for (const creature of species.creatures) step(creature.driver, 1, { rootVelocity: FIXED_ROOT_VELOCITY });
	}
}

async function measureTimestampedPipelineFrame() {
	const frameStart = instrumentationNow();
	const simulationStart = frameStart;
	stepSimulationTick();
	const simulationEnd = instrumentationNow();
	const storageStart = simulationEnd;
	updatePoseStorage();
	const storageEnd = instrumentationNow();
	const submissionStart = storageEnd;
	state.renderPipeline.render();
	const submissionEnd = instrumentationNow();
	const gpuRenderMs = await state.renderer.resolveTimestampsAsync('render');
	return {
		cpu: {
			simulation: simulationEnd - simulationStart,
			storageAndCulling: storageEnd - storageStart,
			renderSubmission: submissionEnd - submissionStart,
			total: submissionEnd - frameStart,
		},
		gpuRenderMs: Number.isFinite(gpuRenderMs) && gpuRenderMs > 0 ? gpuRenderMs : null,
	};
}

function collectAnimationIntervals(durationMs) {
	return new Promise((resolve) => {
		const intervals = [];
		let start = null;
		let previous = null;
		function sample(timestamp) {
			if (start === null) start = timestamp;
			if (previous !== null) intervals.push(timestamp - previous);
			previous = timestamp;
			if (timestamp - start >= durationMs && intervals.length > 0) resolve(intervals);
			else requestAnimationFrame(sample);
		}
		requestAnimationFrame(sample);
	});
}

function setCreatureMeshesVisible(visible) {
	for (const species of state.species) species.mesh.visible = visible;
}

function geometryByteLength(geometry) {
	let bytes = geometry?.index?.array?.byteLength ?? 0;
	for (const attribute of Object.values(geometry?.attributes ?? {})) bytes += attribute?.array?.byteLength ?? 0;
	return bytes;
}

function performanceResourceSnapshot(profile) {
	const storageBytes = describeResources().storageBytes;
	const geometryBytes = state.species.reduce((sum, species) => sum
		+ geometryByteLength(species.geometry)
		+ (species.mesh.instanceMatrix?.array?.byteLength ?? 0), 0);
	const physicalPixels = profile.viewport.width * profile.viewport.height * profile.viewport.dpr ** 2;
	const actualSampleCount = state.scenePass?.renderTarget?.samples ?? 1;
	// PassNode defaults every MRT color target to RGBA16F (8 B/pixel). For MSAA,
	// WebGPUTextureUtils owns a single-sample resolve texture plus an N-sample
	// color attachment; depth32 is N-sample with no resolve allocation. This is
	// an app-owned attachment ledger, not a claim about driver heap residency.
	const colorBytesPerPixel = state.scenePass.renderTarget.textures.length * 8;
	const colorSampleMultiplier = actualSampleCount > 1 ? 1 + actualSampleCount : 1;
	const depthBytesPerPixel = state.scenePass.renderTarget.depthBuffer === false ? 0 : 4 * actualSampleCount;
	const renderTargetBytes = physicalPixels * (colorBytesPerPixel * colorSampleMultiplier + depthBytesPerPixel);
	const shadowBytes = state.light.shadow.mapSize.x * state.light.shadow.mapSize.y * 4;
	return {
		storageBytes,
		geometryBytes,
		renderTargetBytes,
		shadowBytes,
		ownedGpuBytes: storageBytes + geometryBytes + renderTargetBytes + shadowBytes,
		actualSampleCount,
		ledgerBasis: 'app-owned buffers plus rgba16f MRT resolve/MSAA, depth32, and depth32float shadow allocations',
		excludes: ['driver allocation granularity', 'pipeline cache', 'bind-group metadata', 'browser compositor surfaces'],
	};
}

function adapterIdentity() {
	const info = state.renderer.backend?.device?.adapterInfo ?? state.renderer.backend?.adapterInfo;
	if (!info) return null;
	const identity = {};
	for (const key of ['vendor', 'architecture', 'device', 'description', 'subgroupMinSize', 'subgroupMaxSize']) {
		if (info[key] !== undefined && info[key] !== '') identity[key] = info[key];
	}
	return Object.keys(identity).length > 0 ? identity : null;
}

function applyPerformanceGraph(profile) {
	state.scenePass.renderTarget.samples = profile.sampleCount;
	state.light.shadow.map?.dispose?.();
	state.light.shadow.map = null;
	state.light.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
	state.light.shadow.needsUpdate = true;
	state.renderPipeline.outputNode = profile.outlineMode === 'none'
		? renderOutput(state.scenePass.getTextureNode('output'))
		: state.outline.outputNode;
	state.renderPipeline.needsUpdate = true;
}

async function measurePerformanceProfile(profileId) {
	const profile = performanceProfile(profileId);
	await setTier(profile.tier, { overrideLock: true });
	state.viewportOverride = { ...profile.viewport };
	state.renderer.setPixelRatio(profile.viewport.dpr);
	applyPerformanceGraph(profile);
	spawnGrid(profile.seed, profile.population, { render: false });
	state.focusIsolation = false;
	setCreatureMeshesVisible(true);
	frameCameraOnPopulation(false);
	resizeRenderer();
	const timestampSupported = state.renderer.backend?.trackTimestamp === true
		&& state.renderer.hasFeature?.('timestamp-query') === true;
	if (!timestampSupported) {
		return {
			schemaVersion: 1,
			performanceProfileVersion: PERFORMANCE_PROFILE_VERSION,
			profileId,
			verdict: 'INSUFFICIENT_EVIDENCE',
			unavailableReason: 'INSUFFICIENT_EVIDENCE_GPU_TIMING: timestamp-query is unavailable or trackTimestamp was not enabled before initialization',
		};
	}
	pauseLoop();
	try {
		await state.renderer.resolveTimestampsAsync('render');
		for (let frame = 0; frame < profile.warmupFrames; frame++) await measureTimestampedPipelineFrame();
		await state.renderer.resolveTimestampsAsync('render');
		const beforeCounters = state.bootCounters.snapshot();
		const cpuSamples = { simulation: [], storageAndCulling: [], renderSubmission: [], total: [] };
		const gpuSamples = [];
		for (let frame = 0; frame < profile.sampleFrames; frame++) {
			const sample = await measureTimestampedPipelineFrame();
			for (const key of Object.keys(cpuSamples)) cpuSamples[key].push(sample.cpu[key]);
			if (sample.gpuRenderMs !== null) gpuSamples.push(sample.gpuRenderMs);
		}

		const marginalBlocks = [];
		for (let block = 0; block < profile.marginalBlocks; block++) {
			const enabled = block % 2 === 1;
			setCreatureMeshesVisible(enabled);
			const samples = [];
			for (let frame = 0; frame < profile.marginalFramesPerBlock; frame++) {
				const sample = await measureTimestampedPipelineFrame();
				if (sample.gpuRenderMs !== null) samples.push(sample.gpuRenderMs);
			}
			marginalBlocks.push({ block, creaturesEnabled: enabled, gpuRender: metricFromSamples(samples), raw: samples });
		}
		setCreatureMeshesVisible(true);
		const pausedBaselineSamples = await collectAnimationIntervals(2_000);
		resumeLoop();
		const activePresentationSamples = await collectAnimationIntervals(profile.sustainedDurationMs);
		pauseLoop();
		const afterCounters = state.bootCounters.snapshot();
		const resourceSnapshot = performanceResourceSnapshot(profile);
		const activeMetric = metricFromSamples(activePresentationSamples);
		const deadlineMisses = activePresentationSamples.filter((value) => value > profile.frameDeadlineMs).length;
		const actualRepresentation = state.species.every((species) => species.geometry.userData.representation === 'canonical-reference-surface')
			? 'canonical-reference-surface'
			: 'diagnostic-owner-masked-shell';
		const actualOutlineMode = state.renderPipeline.outputNode === state.outline?.outputNode ? 'shared-normal-depth-edge' : 'none';
		const result = {
			schemaVersion: 1,
			performanceProfileVersion: PERFORMANCE_PROFILE_VERSION,
			profileId,
			environment: {
				threeRevision: '185',
				browser: navigator.userAgent,
				platform: navigator.userAgentData?.platform ?? navigator.platform ?? null,
				adapter: adapterIdentity(),
				features: state.renderer.backend?.device?.features ? [...state.renderer.backend.device.features] : [],
				limits: state.renderer.backend?.device?.limits ? { ...state.renderer.backend.device.limits } : {},
				isWebGPUBackend: state.renderer.backend?.isWebGPUBackend === true,
				trackTimestamp: state.renderer.backend?.trackTimestamp === true,
				timestampQuery: state.renderer.hasFeature?.('timestamp-query') === true,
				deviceLoss: state.deviceLoss,
				uncapturedErrors: [...state.gpuErrors],
			},
			target: { refreshHz: profile.refreshHz, frameDeadlineMs: profile.frameDeadlineMs, allowedMissRate: profile.allowedMissRate },
			workload: {
				tier: state.tier,
				population: state.species.reduce((sum, species) => sum + species.creatures.length, 0),
				speciesMix: state.species.map((species) => ({ name: species.spec.name, instances: species.creatures.length })),
				seed: profile.seed,
				viewport: { width: profile.viewport.width, height: profile.viewport.height, dpr: state.renderer.getPixelRatio() },
				sampleCount: resourceSnapshot.actualSampleCount,
				shadowMapSize: state.light.shadow.mapSize.x,
				outlineMode: actualOutlineMode,
				representation: actualRepresentation,
				topologySignatures: state.species.map((species) => species.compiled.topologySignature),
				geometryDigests: state.species.map((species) => species.compiled.geometryDigest),
				pages: state.species.length,
				visibleInstances: state.culling.visibleInstances,
			},
			sampling: {
				warmupFrames: profile.warmupFrames,
				sampleFrames: profile.sampleFrames,
				marginalBlocks: profile.marginalBlocks,
				marginalFramesPerBlock: profile.marginalFramesPerBlock,
				sustainedDurationMs: profile.sustainedDurationMs,
				quantile: 'nearest-rank',
			},
			cpu: {
				simulation: metricFromSamples(cpuSamples.simulation),
				storageAndCulling: metricFromSamples(cpuSamples.storageAndCulling),
				renderSubmission: metricFromSamples(cpuSamples.renderSubmission),
				total: metricFromSamples(cpuSamples.total),
			},
			gpu: { render: metricFromSamples(gpuSamples), timestampSampleCount: gpuSamples.length, marginalBlocks },
			presentation: {
				pausedBaseline: metricFromSamples(pausedBaselineSamples),
				active: activeMetric,
				deadlineMisses,
				missRate: activePresentationSamples.length > 0 ? deadlineMisses / activePresentationSamples.length : 1,
			},
			resources: {
				...resourceSnapshot,
				postRevealPipelineCompiles: afterCounters.createRenderPipeline + afterCounters.createRenderPipelineAsync - beforeCounters.createRenderPipeline - beforeCounters.createRenderPipelineAsync,
				steadyStateBufferCreates: afterCounters.createBuffer - beforeCounters.createBuffer,
				dirtyUploadBytes: state.lastPoseUpload?.bytes ?? 0,
			},
			quality: { selectedTier: state.tier, transitions: [], settled: true },
			rawSamples: { cpu: cpuSamples, gpuRenderMs: gpuSamples, pausedPresentationMs: pausedBaselineSamples, activePresentationMs: activePresentationSamples },
		};
		Object.assign(result, evaluatePerformanceResult(result));
		return result;
	} finally {
		setCreatureMeshesVisible(true);
		resumeLoop();
	}
}

async function measureSteadyFrames(count = 120) {
	// Fairness contract: the first-frame ratio compares like with like. The first
	// frame is timed as an awaited renderAsync at reveal (init), so steady frames
	// are timed the same way — sync CPU dispatch time of render() is NOT frame
	// time on an async GPU queue and produced a spurious 9x ratio.
	const samples = [];
	const before = state.bootCounters.snapshot();
	// Same persistent offscreen target as the init first-frame timing: awaited
	// canvas renders outside rAF hang once the swapchain runs dry in headless.
	const wasRegistered = state.loopRegistered === true;
	state.renderer.setAnimationLoop(null);
	state.renderer.setRenderTarget(state.measureTarget);
	for (let i = 0; i < count; i++) {
		if (!state.holdSimulation) {
			for (const species of state.species) {
				for (const creature of species.creatures) step(creature.driver, 1, { rootVelocity: FIXED_ROOT_VELOCITY });
			}
		}
		updatePoseStorage();
		const start = instrumentationNow();
		await state.renderer.renderAsync(state.scene, state.camera);
		samples.push(instrumentationNow() - start);
	}
	state.renderer.setRenderTarget(null);
	if (wasRegistered) state.renderer.setAnimationLoop(fixedFrame);
	const after = state.bootCounters.snapshot();
	state.boot.pipelineCompilesAfterReveal = after.createRenderPipeline + after.createRenderPipelineAsync - before.createRenderPipeline - before.createRenderPipelineAsync;
	state.boot.bufferReallocsAfterInit = after.createBuffer - before.createBuffer;
	state.bootCounters.steadyStateDeltas = {
		createRenderPipeline: after.createRenderPipeline - before.createRenderPipeline,
		createRenderPipelineAsync: after.createRenderPipelineAsync - before.createRenderPipelineAsync,
		createComputePipeline: after.createComputePipeline - before.createComputePipeline,
		createBuffer: after.createBuffer - before.createBuffer,
	};
	const steady = metricFromSamples(samples);
	state.boot.firstFrameRatio = Number((Math.max(state.timing.revealMedianMs ?? state.timing.firstFrameMs, steady.median) / Math.max(steady.median, 1e-6)).toFixed(4));
	return {
		metricKind: 'cpu-submission-proxy',
		acceptanceEligible: false,
		gpuTiming: null,
		deprecation: 'Use measurePerformanceProfile(profileId); renderAsync submission latency is not GPU completion time.',
		samples: samples.map((sample) => Number(sample.toFixed(4))),
		steady,
		deltas: state.bootCounters.steadyStateDeltas,
	};
}

async function leakLoop(cycles = 50) {
	// REAL dispose/recreate cycles (reference §10 leak-loop row): each cycle tears
	// the renderer, scene, geometries, materials, and the material-variant cache
	// down and re-runs init(). Flatness is judged on per-cycle reveal state —
	// counters accumulated by each fresh device wrap, renderer.info memory, and
	// the variant-cache size — which grows monotonically if dispose leaks.
	const loops = [];
	for (let i = 0; i < Math.max(50, Math.floor(cycles)); i++) {
		dispose();
		await init();
		renderOnce();
		loops.push({
			cycle: i,
			rendererInfo: JSON.parse(JSON.stringify(state.renderer.info)),
			counters: state.bootCounters.snapshot(),
			countersAtReveal: state.bootCounters.countersAtReveal,
			materialCacheSize: materialCacheSize(),
		});
	}
	return {
		note: 'Full dispose/recreate per cycle; flatness = identical reveal-time counters, renderer.info memory, and material-variant cache size across cycles.',
		loops,
	};
}

function dispose() {
	state.renderer?.setAnimationLoop(null);
	for (const species of state.species) {
		state.scene?.remove(species.mesh);
		species.geometry.dispose();
		releaseCreatureMaterial(species.mesh.material);
	}
	state.ground?.geometry?.dispose?.();
	state.ground?.material?.dispose?.();
	state.outline?.dispose?.();
	state.scenePass?.dispose?.();
	state.renderPipeline?.dispose?.();
	state.measureTarget?.dispose?.();
	state.poseStorage?.dispose?.();
	disposeCandidateStorages();
	state.renderer?.dispose?.();
	clearMaterialVariantCache();
	state.measureTarget = null;
	state.poseStorage = null;
	state.scenePass = null;
	state.renderPipeline = null;
	state.outline = null;
	state.renderer = null;
	state.scene = null;
	state.camera = null;
	state.ground = null;
	state.light = null;
	state.certifications.clear();
	state.species.length = 0;
	state.activeCreatures.length = 0;
	state.ready = false;
	if (state.resizeListenerRegistered) {
		window.removeEventListener('resize', onWindowResize);
		state.resizeListenerRegistered = false;
	}
	if (window.__lab) window.__lab.ready = false;
	setStatus('Creature Lab Disposed');
	return { disposed: true };
}

function runtimeCertificationEvidence() {
	return state.species.map((species) => ({
		species: species.spec.name,
		blendDag: {
			version: species.compiled.blendDag.version,
			source: species.compiled.blendDag.source,
			canonicalSource: species.compiled.blendDag.canonicalSource,
		},
		candidateCertificateDigest: species.compiled.candidateCertificateDigest,
		candidateCertificates: species.compiled.candidateCertificates,
		corpusDigest: species.certification.corpusDigest,
		certificationDigest: species.certification.certificationDigest,
		runtimeCertification: species.compiled.runtimeCertification ?? null,
	}));
}

function genomeEvidence() {
	return state.species.flatMap((species) => species.creatures.map((creature, index) => ({
		species: species.spec.name,
		index,
		genomeName: creature.genomeSpec.name,
		genomeDigest: creature.genomeDigest,
		seed: creature.genomeSpec.seed,
		perceptualColorDeltaE: (creature.genomeSpec.parts ?? []).map((part, partIndex) => ({
			part: species.spec.parts?.[partIndex]?.id ?? part.id,
			deltaE: perceptualColorDeltaE(species.spec.parts?.[partIndex]?.color ?? part.color, part.color),
		})),
		candidateCertificateDigest: species.compiled.candidateCertificateDigest,
	})));
}

function createLabController() {
	return Object.freeze({
		async ready() {
			if (!state.ready) throw new Error('creature lab is not ready');
		},
		async setScenario(id) { return setScenario(id); },
		async setMode(id) { return setDebugMode(id); },
		async setTier(id) { return setTier(id); },
		async setSeed(seed) {
			if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`invalid creature seed '${seed}'`);
			state.startup = Object.freeze({ ...state.startup, seed });
			const population = Math.max(1, state.species.reduce((sum, species) => sum + species.creatures.length, 0));
			return spawnGrid(seed, population);
		},
		async setCamera(id) { return setCamera(id); },
		async setTime(seconds) {
			if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`invalid creature time '${seconds}'`);
			return seekAll(seconds);
		},
		async step(deltaSeconds) { return advanceAll(deltaSeconds); },
		async resetHistory(cause) {
			if (typeof cause !== 'string' || cause.length === 0) throw new Error('resetHistory requires a non-empty cause');
			state.lastHistoryReset = { cause, atFrame: state.frameCount };
			return seekAll(0);
		},
		async resize(width, height, dpr) {
			if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new Error('resize requires positive integer width and height');
			if (!Number.isFinite(dpr) || dpr <= 0 || dpr > 2) throw new Error(`invalid DPR '${dpr}'`);
			state.viewportOverride = { width, height, dpr };
			state.renderer.setPixelRatio(dpr);
			return renderOnce();
		},
		async renderOnce() { return renderOnce(); },
		async capturePixels(target) { return capturePipelinePixels(target); },
		async measurePerformanceProfile(profileId) { return measurePerformanceProfile(profileId); },
		describePipeline,
		describeResources,
		getMetrics() { return telemetry(); },
		queryRuntimeCertification: runtimeCertificationEvidence,
		queryGenomeEvidence: genomeEvidence,
		async dispose() { return dispose(); },
	});
}

function installLabApi() {
	const controller = createLabController();
	window.labController = controller;
	window.__LAB_CONTROLLER__ = controller;
	Object.assign(window.__lab, {
		ready: state.ready,
		error: null,
		telemetry,
		focus,
		setFocusIsolation,
		frameCameraOnPopulation,
		setCamera,
		tier: setTier,
		debug: setDebugMode,
		setTier,
		setScenario,
		setDebugMode,
		setSpecJSON,
		spawnGrid,
		readbackPose,
		fieldProbe,
		fieldProbeCPU,
		gpuFieldProbes,
		fieldParityArtifact,
		captureFrame,
		capturePixels: capturePipelinePixels,
		captureShadowAtlas,
		shadowMapFootprint,
		spawnCostSample,
		driftMarkers,
		measureSteadyFrames,
		measurePerformanceProfile,
		leakLoop,
		pauseLoop,
		resumeLoop,
		renderOnce,
		seek: seekAll,
		step: stepAll,
		advance: advanceAll,
		advanceAll,
		describePipeline,
		describeResources,
		runtimeCertificationEvidence,
		genomeEvidence,
		controller,
		dispose,
	});
}

async function init() {
	setStatus('Creature Lab Initializing WebGPU');
	const renderer = new WebGPURenderer({ canvas, antialias: false, trackTimestamp: true });
	const inheritedOnError = renderer.onError.bind(renderer);
	const inheritedOnDeviceLost = renderer.onDeviceLost.bind(renderer);
	renderer.onError = (error) => {
		state.gpuErrors.push({ type: error?.type ?? 'GPUError', message: error?.message ?? String(error) });
		inheritedOnError(error);
	};
	renderer.onDeviceLost = (info) => {
		state.deviceLoss = { reason: info?.reason ?? null, message: info?.message ?? 'Unknown WebGPU device loss' };
		inheritedOnDeviceLost(info);
	};
	await renderer.init();
	if (renderer.backend?.isWebGPUBackend !== true) throw new Error('WebGPU backend unavailable for the canonical creature path.');
	state.renderer = renderer;
	state.frameCount = 0;
	state.timing.firstFrameMs = 0;
	state.timing.steadyFrameSamples.length = 0;
	state.bootCounters = wrapDeviceCounters(renderer);
	state.bootCounters.countersAtInit = state.bootCounters.snapshot();
	state.bootCounters.mark('renderer.init');

	createScene(renderer);
	state.bootCounters.mark('scene');

	setStatus('Creature Lab Loading Specs');
	state.specs = await Promise.all(specNames.map((name) => {
		const url = specUrls[name];
		if (!url) throw new Error(`missing browser spec URL for '${name}'`);
		return fetchJson(url);
	}));
	for (const tierName of tiers) buildShellGeometry(1, tierName);
	buildSpeciesRecords(state.specs);
	spawnGrid(startup.seed, startup.population, { render: false });
	if (startup.population > 1) frameCameraOnPopulation(false);
	else frameCameraOnFocus(false);
	updatePoseStorage();
	state.bootCounters.mark('species-storage');

	setStatus('Creature Lab Compiling WebGPU Pipelines');
	const compileStart = bootNow();
	await state.scenePass.compileAsync(renderer);
	state.bootCounters.mark('compileAsync');
	// First revealed frame, timed as an awaited render so the boot gate's ratio
	// against the awaited steady median (measureSteadyFrames) compares like with
	// like. The ratio itself is computed ONLY by measureSteadyFrames — no clamp,
	// no placeholder; until that runs, firstFrameRatio stays null (gate fails
	// closed on a missing number rather than passing on a fabricated one).
	// Both sides of the ratio render to the SAME persistent offscreen target:
	// canvas renderAsync outside rAF exhausts the swapchain after a few frames
	// in headless (measured hang in measureSteadyFrames), and like-for-like
	// timing requires identical targets anyway.
	if (!state.measureTarget) state.measureTarget = new RenderTarget(960, 600, { samples: 1, type: UnsignedByteType });
	// Bind the measurement target BEFORE compileAsync: pipeline formats are
	// target-specific, and compiling for the canvas leaves the RT pipelines to
	// compile synchronously inside the timed frame (measured: 13 sync
	// createRenderPipeline calls landing in firstFrameMs).
	renderer.setRenderTarget(state.measureTarget);
	state.scenePass.setSize(960, 600);
	await state.scenePass.compileAsync(renderer);
	state.bootCounters.mark('compileAsync-measure-target');
	// Pre-reveal warm frame (doctrine: compile EVERYTHING before reveal):
	// compileAsync does not walk the shadow pass, whose pipelines otherwise
	// compile synchronously inside the timed frame (measured: 6 sync
	// createRenderPipeline calls). This frame is untimed and happens before
	// the reveal mark, so the counters still attribute it to boot.
	await renderer.renderAsync(state.scene, state.camera);
	state.bootCounters.mark('warm-frame');
	const firstFrameStart = instrumentationNow();
	await renderer.renderAsync(state.scene, state.camera);
	state.timing.firstFrameMs = Number((instrumentationNow() - firstFrameStart).toFixed(4));
	// Reveal window: median of 10 post-warm frames. A single frame is JIT-noise
	// dominated at this scene scale (measured 2.5ms frame 1 vs 0.1ms steady on
	// an identical warm path), so the ratio uses the window median; one-shot
	// compile stalls are caught by the counter-based pipelines-after-reveal
	// gate, and sustained reveal slowness by this median. Completion barriers
	// were tried and rejected: onSubmittedWorkDone stalls ~130ms/frame in
	// steady-state headless, and a per-sample readback allocates a staging
	// buffer (tripping the buffer-reallocs gate). Raw samples ship in boot.json.
	state.timing.revealFrameSamples = [state.timing.firstFrameMs];
	for (let i = 0; i < 9; i++) {
		const t0 = instrumentationNow();
		await renderer.renderAsync(state.scene, state.camera);
		state.timing.revealFrameSamples.push(Number((instrumentationNow() - t0).toFixed(4)));
	}
	const sortedReveal = [...state.timing.revealFrameSamples].sort((a, b) => a - b);
	state.timing.revealMedianMs = sortedReveal[Math.floor(sortedReveal.length / 2)];
	renderer.setRenderTarget(null);
	state.bootCounters.countersAtReveal = state.bootCounters.snapshot();
	state.bootCounters.mark('reveal');
	state.boot.compileMs = Number((bootNow() - compileStart).toFixed(2));
	state.boot.firstFrameRatio = null;
	state.boot.pipelineCompilesAfterReveal = 0;
	state.boot.bufferReallocsAfterInit = 0;
	state.boot.spawnMedianMs = 0;

	state.ready = true;
	if (!state.resizeListenerRegistered) {
		window.addEventListener('resize', onWindowResize);
		state.resizeListenerRegistered = true;
	}
	installLabApi();
	window.__lab.ready = true;
	window.__lab.bootCounters = state.bootCounters;
	// ?paused=1 boots with the simulation frozen at tick 0: pages that need
	// bitwise pose determinism must never free-run ticks between page ready
	// and their pauseLoop call (that race is nondeterministic by nature).
	state.holdSimulation = new URLSearchParams(window.location.search).has('paused');
	state.loopRegistered = true;
	state.renderer.setAnimationLoop(fixedFrame);
	renderOnce();
	setStatus('Creature Lab Ready');
}

function onWindowResize() {
	if (state.ready) renderOnce();
}

init().catch((error) => {
	const message = error?.message || String(error);
	setStatus(`Creature Lab Error: ${message}`);
	window.__lab = window.__lab ?? {};
	window.__lab.error = message;
	window.__labError = message;
	throw error;
});
