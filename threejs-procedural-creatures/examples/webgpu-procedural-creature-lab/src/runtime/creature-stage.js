import {
	BufferAttribute,
	BufferGeometry,
	InstancedMesh,
	Matrix4,
	Sphere,
} from 'three';

import { certifyCandidateCapacity } from '../core/candidate-certification.js';
import { advanceInPlace, createDriver, POSE_STRIDE } from '../core/driver.js';
import { compileSpec, digest128 } from '../core/rig-compiler.js';
import { buildShellGeometry } from '../core/shell-writer.js';
import { validateSpec } from '../core/spec-schema.js';
import { createCreatureMaterial, releaseCreatureMaterial } from '../tsl/materials.js';
import { createCandidateStorage, createPoseStorage } from '../tsl/pose-storage.js';

const IDENTITY_MATRIX = new Matrix4();

function shellToGeometry(shell) {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(shell.positions, 3));
	geometry.setAttribute('aPart', new BufferAttribute(shell.aPart, 1));
	geometry.setAttribute('aAxial', new BufferAttribute(shell.aAxial, 1));
	geometry.setAttribute('aTheta', new BufferAttribute(shell.aTheta, 1));
	geometry.setIndex(new BufferAttribute(shell.indices, 1));
	geometry.computeVertexNormals();
	geometry.computeBoundingSphere();
	geometry.userData.representation = 'diagnostic-owner-masked-shell';
	return geometry;
}

function candidateSetsEqual(a, b) {
	return a.length === b.length && a.every((set, index) => (
		set.length === b[index]?.length && set.every((value, candidateIndex) => value === b[index][candidateIndex])
	));
}

function updateSphere(pose, slotCount, root, layout, out) {
	let cx = 0;
	let cy = 0;
	let cz = 0;
	for (let slot = 0; slot < slotCount; slot++) {
		const base = slot * POSE_STRIDE;
		cx += pose[base] + pose[base + 4];
		cy += pose[base + 1] + pose[base + 5];
		cz += pose[base + 2] + pose[base + 6];
	}
	const inverseCount = slotCount > 0 ? 1 / (slotCount * 2) : 1;
	cx *= inverseCount;
	cy *= inverseCount;
	cz *= inverseCount;
	let radius = 0;
	for (let slot = 0; slot < slotCount; slot++) {
		const base = slot * POSE_STRIDE;
		const r = Math.max(pose[base + 3], pose[base + 7]);
		radius = Math.max(radius, Math.hypot(pose[base] - cx, pose[base + 1] - cy, pose[base + 2] - cz) + r);
		radius = Math.max(radius, Math.hypot(pose[base + 4] - cx, pose[base + 5] - cy, pose[base + 6] - cz) + r);
	}
	const yaw = root.yaw ?? 0;
	const cosine = Math.cos(yaw);
	const sine = Math.sin(yaw);
	out.center.set(
		layout[0] + root.position[0] + cx * cosine + cz * sine,
		layout[1] + root.position[1] + cy,
		layout[2] + root.position[2] - cx * sine + cz * cosine,
	);
	out.radius = radius;
}

function waterHeightProvider(query) {
	if (!query) return undefined;
	if (typeof query === 'function') return query;
	if (typeof query.getWaterSurface === 'function') {
		return (x, z, time) => query.getWaterSurface(x, z, time);
	}
	throw new Error('waterQuery must be a function or expose getWaterSurface(x,z,time)');
}

/**
 * Reusable creature scene adapter. It never constructs a renderer, camera,
 * scene, RenderPipeline, tone mapper, shadow system, weather clock, or water
 * simulation. Those owners are injected by the host integration.
 */
export function createCreatureStage(options = {}) {
	const scene = options.scene;
	const camera = options.camera;
	const renderer = options.renderer;
	if (!scene?.add || !scene?.remove) throw new Error('createCreatureStage requires a host-owned scene');
	if (!camera) throw new Error('createCreatureStage requires a host-owned camera');
	if (!renderer) throw new Error('createCreatureStage requires a host-owned renderer');
	if (renderer.backend?.isWebGPUBackend !== true) throw new Error('createCreatureStage requires an initialized native WebGPU renderer');
	if (!options.pipelineOwner) throw new Error('createCreatureStage requires the host pipeline owner id');
	if (!options.shadowOwner) throw new Error('createCreatureStage requires the host shadow owner id');

	const tier = options.tier ?? 'hero';
	const maxParts = Math.max(1, Math.floor(options.maxParts ?? 64));
	const capacity = Math.max(1, Math.floor(options.capacity ?? 64));
	const baseSpec = validateSpec(options.spec, { maxParts });
	const envelope = [baseSpec, ...(options.genomeEnvelope ?? []).map((spec) => validateSpec(spec, { maxParts }))];
	const certifications = envelope.map((spec) => certifyCandidateCapacity(spec, { tier, maxParts }));
	const rejected = certifications.find((entry) => entry.status !== 'accepted');
	if (rejected) throw new Error(rejected.error);
	const candidateK = Math.max(...certifications.map((entry) => entry.kRequired));
	const compiled = compileSpec(baseSpec, { tier, maxParts, candidateK });
	compiled.runtimeCertification = Object.freeze({
		version: 'creature-runtime-envelope-certification-v3',
		digest: digest128(certifications.map((entry) => entry.certificationDigest)),
		candidateCertificateDigest: compiled.candidateCertificateDigest,
		genomeCertificationDigests: Object.freeze(certifications.map((entry) => entry.certificationDigest)),
	});
	for (let i = 1; i < envelope.length; i++) {
		const candidate = compileSpec(envelope[i], { tier, maxParts, candidateK });
		if (candidate.slots.length !== compiled.slots.length || !candidateSetsEqual(candidate.candidateSets, compiled.candidateSets)) {
			throw new Error(`genome envelope '${envelope[i].name}' is not compatible with the shared candidate program`);
		}
	}

	const poseStorage = createPoseStorage({ maxCreatures: capacity, maxParts, candidateK });
	const candidateStorage = createCandidateStorage({
		candidateSets: compiled.candidateSets,
		maxParts,
		K: candidateK,
		certificateDigest: compiled.candidateCertificateDigest,
		label: `CreatureStageCandidates_${compiled.geometryDigest}`,
	});
	const shell = buildShellGeometry(compiled.slots.length, tier);
	const geometry = shellToGeometry(shell);
	const material = createCreatureMaterial({
		tier,
		debugMode: options.debugMode ?? 'off',
		K: candidateK,
		poseStorage,
		candidateStorage,
		maxParts,
		maxRadius: compiled.maxRadius,
		instanceBase: 0,
		storageKey: `stage:${compiled.geometryDigest}:${candidateK}`,
		compilerSignature: compiled.compilerSignature,
		topologySignature: compiled.topologySignature,
		geometryDigest: compiled.geometryDigest,
		shaderContractDigest: compiled.shaderContractDigest,
		blendDag: compiled.blendDag,
		candidateCertificateDigest: compiled.candidateCertificateDigest,
	});
	const mesh = new InstancedMesh(geometry, material, capacity);
	mesh.name = options.name ?? `creature-stage:${baseSpec.name}`;
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.count = 0;
	mesh.boundingSphere = new Sphere();
	scene.add(mesh);

	const instances = [];
	const unionSphere = new Sphere();
	const rootContext = Object.freeze({ rootVelocity: options.rootVelocity ?? [0, 0, 0] });
	const waterSurfaceProvider = waterHeightProvider(options.waterQuery);
	let disposed = false;
	let lastUpload = { bytes: 0 };
	candidateStorage.markDirty();

	function assertActive() {
		if (disposed) throw new Error('creature stage is disposed');
	}

	function spawn(spec = baseSpec, spawnOptions = {}) {
		assertActive();
		if (instances.length >= capacity) throw new Error(`creature stage capacity ${capacity} exhausted`);
		const validated = validateSpec(spec, { maxParts });
		const certification = certifyCandidateCapacity(validated, { tier, maxParts });
		if (certification.status !== 'accepted' || certification.kRequired > candidateK) {
			throw new Error(`genome '${validated.name}' exceeds certified stage total K=${candidateK}`);
		}
		const genomeCompiled = compileSpec(validated, { tier, maxParts, candidateK });
		genomeCompiled.runtimeCertification = certification.compiled.runtimeCertification;
		if (genomeCompiled.slots.length !== compiled.slots.length || !candidateSetsEqual(genomeCompiled.candidateSets, compiled.candidateSets)) {
			throw new Error(`genome '${validated.name}' escapes the stage topology/candidate envelope`);
		}
		const driver = createDriver(validated, genomeCompiled, {
			seed: spawnOptions.seed ?? validated.seed,
			waterSurfaceProvider,
			querySupport: spawnOptions.querySupport ?? options.querySupport,
		});
		const instance = {
			driver,
			compiled: genomeCompiled,
			layout: new Float32Array(spawnOptions.position ?? [0, 0, 0]),
			bounds: new Sphere(),
			genomeDigest: genomeCompiled.geometryDigest,
			visible: true,
		};
		instances.push(instance);
		return instance;
	}

	function updateStorage() {
		assertActive();
		unionSphere.makeEmpty();
		let visibleCount = 0;
		for (const instance of instances) {
			const pose = instance.driver.presentPose ?? instance.driver.currentPose;
			updateSphere(pose, instance.compiled.slots.length, instance.driver.root, instance.layout, instance.bounds);
			instance.visible = mesh.visible && (options.isVisible ? options.isVisible(instance.bounds, camera, instance) !== false : true);
			if (!instance.visible) continue;
			poseStorage.writePose(visibleCount, pose, instance.compiled.slots.length, instance.compiled.radialFrames);
			poseStorage.writeRootValues(
				visibleCount,
				instance.layout[0] + instance.driver.root.position[0],
				instance.layout[1] + instance.driver.root.position[1],
				instance.layout[2] + instance.driver.root.position[2],
				instance.driver.root.yaw,
			);
			mesh.setMatrixAt(visibleCount, IDENTITY_MATRIX);
			if (unionSphere.isEmpty()) unionSphere.copy(instance.bounds);
			else unionSphere.union(instance.bounds);
			visibleCount += 1;
		}
		mesh.count = visibleCount;
		mesh.instanceMatrix.needsUpdate = true;
		if (!unionSphere.isEmpty()) mesh.boundingSphere.copy(unionSphere);
		lastUpload = poseStorage.markDirty();
		return visibleCount;
	}

	function step(deltaSeconds) {
		assertActive();
		const dt = Math.max(0, Math.min(0.25, Number(deltaSeconds) || 0));
		for (const instance of instances) advanceInPlace(instance.driver, dt, rootContext);
		return updateStorage();
	}

	function describeOwnership() {
		return {
			renderer: options.rendererOwner ?? 'host',
			camera: options.cameraOwner ?? 'host',
			weather: options.weatherOwner ?? 'host',
			water: options.waterOwner ?? (options.waterQuery ? 'host' : 'not-consumed'),
			shadows: options.shadowOwner,
			pipeline: options.pipelineOwner,
			creatureTransforms: options.creatureOwner ?? mesh.name,
			toneMap: 'host',
			outputTransform: 'host',
		};
	}

	function describeResources() {
		return {
			poseStorageBytes: poseStorage.poseArray.byteLength + poseStorage.rootsArray.byteLength + poseStorage.framesArray.byteLength,
			candidateStorageBytes: candidateStorage.byteLength,
			candidateCertificateDigest: candidateStorage.certificateDigest,
			runtimeCertification: compiled.runtimeCertification,
			lastUpload,
			candidateK,
			candidateKSemantics: 'total contributor capacity including owner',
			capacity,
			activeInstances: instances.length,
			visibleInstances: mesh.count,
			geometryVertices: geometry.getAttribute('position').count,
			geometryTriangles: geometry.index.count / 3,
			representation: geometry.userData.representation,
		};
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		scene.remove(mesh);
		geometry.dispose();
		releaseCreatureMaterial(material);
		candidateStorage.dispose();
		poseStorage.dispose();
		instances.length = 0;
	}

	return {
		mesh,
		material,
		geometry,
		poseStorage,
		candidateStorage,
		candidateK,
		spawn,
		step,
		updateStorage,
		describeOwnership,
		describeResources,
		dispose,
		get instances() { return instances; },
	};
}
