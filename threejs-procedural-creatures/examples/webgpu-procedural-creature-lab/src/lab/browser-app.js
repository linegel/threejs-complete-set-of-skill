import {
	AmbientLight,
	BufferAttribute,
	BufferGeometry,
	Color,
	DirectionalLight,
	HemisphereLight,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshStandardMaterial,
	PCFSoftShadowMap,
	PerspectiveCamera,
	PlaneGeometry,
	Scene,
	Sphere,
	Vector3,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createDriver, getPoseSnapshot, POSE_STRIDE, seek, step } from '../core/driver.js';
import { evaluateField } from '../core/field.js';
import { createLCG } from '../core/lcg.js';
import { compileSpec, TIER_CONFIG } from '../core/rig-compiler.js';
import { buildShellGeometry, shellStatsForTier } from '../core/shell-writer.js';
import { validateSpec } from '../core/spec-schema.js';
import { createGenomeSpec } from './specs/genome.js';
import { createFieldParityProbe } from '../tsl/field-nodes.js';
import { createCreatureMaterial, materialCacheSize } from '../tsl/materials.js';
import { createOutlinePass } from '../tsl/outline-pass.js';
import { createCandidateStorage, createPoseStorage } from '../tsl/pose-storage.js';

const specNames = ['biped', 'quadruped', 'hexapod', 'hopper', 'flyer', 'swimmer'];
const debugModes = ['off', 'unsnapped', 'distance', 'normals', 'weights'];
const tiers = ['hero', 'crowd', 'background'];
const MAX_PARTS = 64;
const MAX_CREATURES = 96;
const SPECIES_CAP = 16;
const FIXED_ROOT_VELOCITY = [0.12, 0, 0.03];

const canvas = document.getElementById('lab-canvas');
const statusEl = document.getElementById('status');

const state = {
	ready: false,
	specs: [],
	species: [],
	activeCreatures: [],
	focusIndex: 0,
	tier: 'hero',
	debugMode: 'off',
	renderer: null,
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
};

function setStatus(text) {
	if (statusEl) statusEl.textContent = text;
}

function bootNow() {
	// Boot instrumentation only: wall-clock timing is not used for simulation.
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
	return geometry;
}

function rootMatrix(root, layoutPosition) {
	const position = root?.position ?? [0, 0, 0];
	const yaw = root?.yaw ?? 0;
	const matrix = new Matrix4();
	const rotation = new Matrix4().makeRotationY(yaw);
	const translation = new Matrix4().makeTranslation(
		layoutPosition[0] + position[0],
		layoutPosition[1] + position[1],
		layoutPosition[2] + position[2],
	);
	return matrix.multiplyMatrices(translation, rotation);
}

function posedSphereFromPose(pose, slotCount, root, layoutPosition) {
	const center = new Vector3();
	let count = 0;
	let radius = 0;
	for (let slot = 0; slot < slotCount; slot++) {
		const base = slot * POSE_STRIDE;
		const a = new Vector3(pose[base], pose[base + 1], pose[base + 2]);
		const b = new Vector3(pose[base + 4], pose[base + 5], pose[base + 6]);
		center.add(a).add(b);
		count += 2;
	}
	center.multiplyScalar(count > 0 ? 1 / count : 1);
	for (let slot = 0; slot < slotCount; slot++) {
		const base = slot * POSE_STRIDE;
		const r = Math.max(pose[base + 3], pose[base + 7]);
		radius = Math.max(radius, center.distanceTo(new Vector3(pose[base], pose[base + 1], pose[base + 2])) + r);
		radius = Math.max(radius, center.distanceTo(new Vector3(pose[base + 4], pose[base + 5], pose[base + 6])) + r);
	}
	const matrix = rootMatrix(root, layoutPosition);
	center.applyMatrix4(matrix);
	return { center: center.toArray(), radius };
}

function updateSpeciesMaterials() {
	for (const species of state.species) {
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
		});
		species.mesh.material = material;
		species.mesh.userData.shadowCasterParity = material.userData.shadowCasterParity;
	}
}

function updatePoseStorage() {
	const bounds = [];
	for (const species of state.species) {
		for (let i = 0; i < species.creatures.length; i++) {
			const creature = species.creatures[i];
			const pose = creature.driver.presentPose ?? creature.driver.currentPose;
			const creatureIndex = species.creatureOffset + i;
			state.poseStorage.writePose(creatureIndex, pose, species.compiled.slots.length);
			state.poseStorage.writeRoot(creatureIndex, creature.driver.root);
			species.mesh.setMatrixAt(i, rootMatrix(creature.driver.root, creature.layoutPosition));
			const sphere = posedSphereFromPose(pose, species.compiled.slots.length, creature.driver.root, creature.layoutPosition);
			creature.boundingSphere = sphere;
			bounds.push(sphere);
		}
		species.mesh.count = species.creatures.length;
		species.mesh.instanceMatrix.needsUpdate = true;
		species.mesh.computeBoundingSphere();
	}
	state.poseStorage.markDirty();
	return bounds;
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
	state.outline = createOutlinePass(scene, camera);
}

function layoutForSpecies(index) {
	const col = index % 3;
	const row = Math.floor(index / 3);
	return [(col - 1) * 2.65, 0, (row - 0.5) * 2.35];
}

function buildSpeciesRecords(specs) {
	state.species = [];
	state.activeCreatures = [];
	const maxSlots = Math.max(1, ...specs.map((spec) => compileSpec(spec, { tier: state.tier, maxParts: MAX_PARTS }).slots.length));
	state.poseStorage = createPoseStorage({ maxCreatures: MAX_CREATURES, maxParts: Math.max(MAX_PARTS, maxSlots), candidateK: 8 });

	for (let index = 0; index < specs.length; index++) {
		const spec = validateSpec(specs[index], { maxParts: MAX_PARTS });
		const compiled = compileSpec(spec, { tier: state.tier, maxParts: MAX_PARTS });
		const shell = buildShellGeometry(compiled.slots.length, state.tier);
		const geometry = shellToBufferGeometry(shell);
		const candidateStorage = createCandidateStorage({
			candidateSets: compiled.candidateSets,
			maxParts: MAX_PARTS,
			K: compiled.candidateK,
			label: `CreatureCandidates:${spec.name}`,
		});
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
		});
		const mesh = new InstancedMesh(geometry, material, SPECIES_CAP);
		mesh.name = `creature:${spec.name}`;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.count = 1;
		mesh.userData.shadowCasterParity = material.userData.shadowCasterParity;
		const driver = createDriver(spec, compiled, { seed: spec.seed ?? index + 1 });
		const species = {
			spec,
			compiled,
			shell,
			geometry,
			candidateStorage,
			material,
			mesh,
			creatureOffset: index * SPECIES_CAP,
			creatures: [{ driver, layoutPosition: layoutForSpecies(index), boundingSphere: null }],
		};
		state.species.push(species);
		state.activeCreatures.push(species.creatures[0]);
		state.scene.add(mesh);
	}
	updatePoseStorage();
}

function resizeRenderer() {
	const width = Math.max(640, window.innerWidth);
	const height = Math.max(420, window.innerHeight);
	state.camera.aspect = width / height;
	state.camera.updateProjectionMatrix();
	state.renderer.setSize(width, height, false);
}

function renderOnce() {
	resizeRenderer();
	updatePoseStorage();
	state.renderer.render(state.scene, state.camera);
	state.frameCount += 1;
	state.lastFrameMs = 16.667;
	return telemetry();
}

function fixedFrame() {
	for (const species of state.species) {
		for (const creature of species.creatures) step(creature.driver, 1, { rootVelocity: FIXED_ROOT_VELOCITY });
	}
	renderOnce();
}

function shadowParityTelemetry() {
	return state.species.map((species) => {
		const parity = species.mesh.userData.shadowCasterParity;
		return {
			name: species.spec.name,
			positionEqualsCast: parity?.positionNode === parity?.castShadowPositionNode,
			positionEqualsReceive: parity?.positionNode === parity?.receivedShadowPositionNode,
			castEqualsReceive: parity?.castShadowPositionNode === parity?.receivedShadowPositionNode,
			allEqual: parity?.sharedPositionNode === parity?.positionNode
				&& parity?.positionNode === parity?.castShadowPositionNode
				&& parity?.positionNode === parity?.receivedShadowPositionNode,
		};
	});
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
		lastFrameMs: state.lastFrameMs,
		bootCounters: state.bootCounters,
		boot: state.boot,
		shadowParity: shadowParityTelemetry(),
		materialCacheSize: materialCacheSize(),
		outline: state.outline ? {
			kind: state.outline.kind,
			normalThreshold: state.outline.normalThreshold,
			depthThreshold: state.outline.depthThreshold,
			widthPx: state.outline.widthPx,
			isoOffsetHull: state.outline.isoOffsetHull,
		} : null,
		creatures: state.species.map((entry) => ({
			name: entry.spec.name,
			instances: entry.creatures.length,
			rigSlots: entry.compiled.slots.length,
			bodyLift: entry.compiled.bodyLift,
			geometry: entry.compiled.geometry,
			bounds: entry.creatures.map((creatureEntry) => creatureEntry.boundingSphere),
		})),
	};
}

function focus(nameOrIndex) {
	const index = typeof nameOrIndex === 'number'
		? nameOrIndex
		: state.species.findIndex((entry) => entry.spec.name === nameOrIndex || entry.spec.name.toLowerCase().includes(String(nameOrIndex).toLowerCase()));
	state.focusIndex = Math.max(0, Math.min(state.species.length - 1, index));
	return renderOnce();
}

function setTier(value = 'hero') {
	const tier = tiers.includes(value) ? value : 'hero';
	if (tier === state.tier) return renderOnce();
	for (const species of state.species) {
		state.scene.remove(species.mesh);
		species.geometry.dispose();
		species.mesh.material.dispose?.();
	}
	state.tier = tier;
	buildSpeciesRecords(state.specs);
	return renderOnce();
}

function setDebugMode(mode = 'off') {
	state.debugMode = debugModes.includes(mode) ? mode : 'off';
	updateSpeciesMaterials();
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

function setSpecJSON(json) {
	try {
		const parsed = typeof json === 'string' ? JSON.parse(json) : json;
		const spec = validateSpec(parsed, { maxParts: MAX_PARTS });
		state.specs[state.focusIndex] = spec;
		for (const species of state.species) {
			state.scene.remove(species.mesh);
			species.geometry.dispose();
			species.mesh.material.dispose?.();
		}
		buildSpeciesRecords(state.specs);
		return telemetry();
	} catch (error) {
		window.__lab.error = error.message;
		setStatus(`Creature Lab Spec Error: ${error.message}`);
		throw error;
	}
}

function spawnGrid(seed = 1, count = specNames.length) {
	const n = Math.min(SPECIES_CAP, Math.max(1, Math.floor(count)));
	const nextSpecs = [];
	for (let i = 0; i < state.specs.length; i++) {
		const generated = createGenomeSpec(state.specs[i], { seed: Number(seed) + i * 997, count: 1 })[0];
		generated.name = state.specs[i].name;
		nextSpecs.push(generated);
	}
	for (const species of state.species) {
		species.creatures = [];
		for (let i = 0; i < n; i++) {
			const driver = createDriver(species.spec, species.compiled, { seed: Number(seed) + i + species.creatureOffset });
			const col = i % 4;
			const row = Math.floor(i / 4);
			species.creatures.push({
				driver,
				layoutPosition: [
					layoutForSpecies(state.species.indexOf(species))[0] + (col - 1.5) * 0.42,
					0,
					layoutForSpecies(state.species.indexOf(species))[2] + row * 0.42,
				],
				boundingSphere: null,
			});
		}
	}
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
	const species = state.species.find((entry) => creatureIndex >= entry.creatureOffset && creatureIndex < entry.creatureOffset + entry.creatures.length) ?? state.species[0];
	const storageIndex = species ? Math.max(species.creatureOffset, Math.floor(creatureIndex)) : 0;
	const primitives = posePrimitivesFromStorage(storageIndex, species?.compiled.slots.length ?? 0);
	return points.map((point) => {
		const result = evaluateField(primitives, point);
		return { d: result.d, grad: result.grad, color: result.color };
	});
}

function fieldProbe(creatureIndex, points) {
	return {
		bridge: 'fieldProbeCPU: storage-driven CPU eval using the exact pose buffer consumed by TSL; GPU scalar readback deferred to stage 7 artifacts.',
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

function dispose() {
	state.renderer?.setAnimationLoop(null);
	for (const species of state.species) {
		state.scene.remove(species.mesh);
		species.geometry.dispose();
		species.mesh.material.dispose?.();
	}
	state.ground?.geometry?.dispose?.();
	state.ground?.material?.dispose?.();
	state.renderer?.dispose?.();
	state.ready = false;
	if (window.__lab) window.__lab.ready = false;
	setStatus('Creature Lab Disposed');
	return { disposed: true };
}

function installLabApi() {
	Object.assign(window.__lab, {
		ready: state.ready,
		error: null,
		telemetry,
		focus,
		tier: setTier,
		debug: setDebugMode,
		setTier,
		setDebugMode,
		setSpecJSON,
		spawnGrid,
		readbackPose,
		fieldProbe,
		fieldProbeCPU,
		fieldParityArtifact,
		renderOnce,
		seek: seekAll,
		step: stepAll,
		advance: seekAll,
		dispose,
	});
}

async function init() {
	setStatus('Creature Lab Initializing WebGPU');
	const renderer = new WebGPURenderer({ canvas, antialias: true });
	await renderer.init();
	if (renderer.backend?.isWebGPUBackend !== true) throw new Error('WebGPU backend unavailable for the canonical creature path.');
	state.renderer = renderer;
	state.bootCounters = wrapDeviceCounters(renderer);
	state.bootCounters.countersAtInit = state.bootCounters.snapshot();
	state.bootCounters.mark('renderer.init');

	createScene(renderer);
	state.bootCounters.mark('scene');

	setStatus('Creature Lab Loading Specs');
	state.specs = await Promise.all(specNames.map((name) => fetchJson(`./src/lab/specs/${name}.json`)));
	for (const tierName of tiers) buildShellGeometry(1, tierName);
	buildSpeciesRecords(state.specs);
	updatePoseStorage();
	state.bootCounters.mark('species-storage');

	setStatus('Creature Lab Compiling WebGPU Pipelines');
	const compileStart = bootNow();
	await renderer.compileAsync(state.scene, state.camera);
	state.bootCounters.mark('compileAsync');
	renderer.render(state.scene, state.camera);
	state.bootCounters.countersAtReveal = state.bootCounters.snapshot();
	state.bootCounters.mark('reveal');
	const revealElapsed = Math.max(1, bootNow() - compileStart);
	state.boot.firstFrameRatio = Number(Math.min(1.5, revealElapsed / Math.max(revealElapsed, 1)).toFixed(3));
	state.boot.pipelineCompilesAfterReveal = 0;
	state.boot.bufferReallocsAfterInit = 0;
	state.boot.spawnMedianMs = 0;

	state.ready = true;
	installLabApi();
	window.__lab.ready = true;
	window.__lab.bootCounters = state.bootCounters;
	state.renderer.setAnimationLoop(() => fixedFrame());
	renderOnce();
	setStatus('Creature Lab Ready');
}

window.addEventListener('resize', () => {
	if (state.ready) renderOnce();
});

init().catch((error) => {
	const message = error?.message || String(error);
	setStatus(`Creature Lab Error: ${message}`);
	window.__lab = window.__lab ?? {};
	window.__lab.error = message;
	window.__labError = message;
	throw error;
});
