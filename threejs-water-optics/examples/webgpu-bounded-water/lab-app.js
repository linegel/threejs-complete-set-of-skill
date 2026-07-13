import {
  BoxGeometry,
  Color,
  HalfFloatType,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  RenderPipeline,
  RenderTarget,
  Scene,
  SphereGeometry,
  UnsignedByteType,
  WebGPURenderer,
} from "three/webgpu";
import {
  clamp,
  color,
  float,
  pass,
  positionWorld,
  renderOutput,
  texture,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import { alignedBytesPerRow } from "../../../labs/runtime/aligned-readback.mjs";
import {
  bindWebGPUDeviceIdentity,
  captureRuntimeProfileFields,
  markWebGPUDeviceDisposed,
  markWebGPUDeviceDisposing,
  webgpuDeviceIdentityMetrics,
} from "../../../labs/runtime/webgpu-device-identity.mjs";
import {
  BOUNDED_WATER_LAB_MANIFEST,
  WATER_DEBUG_MODES,
  WATER_MECHANISM_PROFILES,
  WATER_MECHANISM_ROUTES,
  WATER_QUALITY_TIERS,
  boundedCausticQuantizationContract,
  createWebGPUBoundedWaterSystem,
  seededDropSequence,
} from "./index.js";

const CAMERA_POSES = Object.freeze({
  near: Object.freeze({ position: [2.8, 2.1, 3.6], target: [0, -0.25, 0] }),
  design: Object.freeze({ position: [5.8, 4.4, 7.2], target: [0, -0.3, 0] }),
  far: Object.freeze({ position: [10.5, 8.5, 13.5], target: [0, -0.35, 0] }),
});
const UNDERWATER_CAMERA_POSES = Object.freeze({
  near: Object.freeze({ position: [1.6, -0.28, 2.1], target: [0, 0.12, 0] }),
  design: Object.freeze({ position: [3.0, -0.5, 4.4], target: [0, 0.08, 0] }),
  far: Object.freeze({ position: [5.4, -0.72, 7.6], target: [0, 0.02, 0] }),
});
const CANONICAL_TIERS = Object.freeze(["ultra", "high", "medium", "low"]);
const DEFAULT_MECHANISM = "buoyancy-spray-and-masks";
const RECEIVER_Y = -1.2;

function routeSelection(pathname, searchParams) {
  const mechanismMatch = pathname.match(/\/mechanism\/([^/]+)/);
  const tierMatch = pathname.match(/\/tier\/([^/]+)/);
  return {
    mechanism: mechanismMatch?.[1] ?? searchParams.get("mechanism") ?? DEFAULT_MECHANISM,
    tier: tierMatch?.[1] ?? searchParams.get("tier") ?? "low",
    mode: searchParams.get("mode"),
    seed: searchParams.has("seed") ? Number(searchParams.get("seed")) : 0x00000001,
    animate: searchParams.get("animate") !== "0",
  };
}

function makeBasicMaterial(hex) {
  const material = new MeshBasicNodeMaterial();
  material.colorNode = color(hex);
  return material;
}

function makeReceiverMaterial(system, causticsEnabledNode) {
  const material = new MeshBasicNodeMaterial();
  const causticTexture = texture(system.heightfield.receiverCaustic);
  const worldSize = system.heightfield.parameters.worldSize;
  const uv = positionWorld.xz.div(vec3(worldSize.x, 1, worldSize.y).xz).add(0.5);
  const receiver = causticTexture.sample(uv);
  const inDomain = positionWorld.x.greaterThanEqual(-worldSize.x * 0.5)
    .and(positionWorld.x.lessThanEqual(worldSize.x * 0.5))
    .and(positionWorld.z.greaterThanEqual(-worldSize.y * 0.5))
    .and(positionWorld.z.lessThanEqual(worldSize.y * 0.5));
  const intensity = clamp(receiver.r.mul(receiver.a).mul(causticsEnabledNode).mul(inDomain), 0, 4);
  const base = vec3(0.045, 0.075, 0.085);
  material.outputNode = vec4(base.add(vec3(0.32, 0.46, 0.34).mul(intensity)), 1);
  material.userData.receiverCausticTextureNode = causticTexture;
  return material;
}

function addOpaqueFixtures(scene, { receiverMaterial = null } = {}) {
  const meshes = [];
  const floor = new Mesh(new PlaneGeometry(16, 16), receiverMaterial ?? makeBasicMaterial(0x18262d));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = RECEIVER_Y;
  floor.name = receiverMaterial ? "bounded-water-caustic-receiver" : "bounded-water-opaque-input-receiver";
  scene.add(floor);
  meshes.push(floor);

  const fixtureSpecs = [
    { size: [1.1, 1.0, 1.1], position: [-1.8, -0.7, -1.15], color: 0x695f50 },
    { size: [0.75, 1.7, 0.75], position: [1.55, -0.35, 0.9], color: 0x3d4b52 },
    { size: [1.35, 0.45, 0.8], position: [0.2, -0.95, -2.1], color: 0x7b654b },
  ];
  for (const [index, spec] of fixtureSpecs.entries()) {
    const mesh = new Mesh(new BoxGeometry(...spec.size), makeBasicMaterial(spec.color));
    mesh.position.set(...spec.position);
    mesh.name = `${receiverMaterial ? "final" : "opaque-input"}-submerged-fixture-${index}`;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

function disposeMeshes(meshes) {
  for (const mesh of meshes ?? []) {
    mesh.parent?.remove(mesh);
    mesh.geometry?.dispose();
    mesh.material?.dispose();
  }
}

export class BoundedWaterLabController {
  constructor({ canvas, selection }) {
    this.canvas = canvas;
    this.selection = selection;
    this.renderer = null;
    this.scene = null;
    this.opaqueScene = null;
    this.camera = null;
    this.pipeline = null;
    this.scenePass = null;
    this.opaquePass = null;
    this.system = null;
    this.timeNode = uniform(0);
    this.causticsEnabledNode = uniform(1, "float");
    this.time = 0;
    this.seed = selection.seed >>> 0;
    this.tier = selection.tier;
    this.mechanism = selection.mechanism;
    this.profile = null;
    this.mode = selection.mode ?? "final";
    this.cameraId = "design";
    this.disposed = false;
    this.opaqueMeshes = [];
    this.finalOpaqueMeshes = [];
    this.buoyancyMeshes = [];
    this.opaqueInteractionMeshes = [];
    this.spray = null;
    this.previousBuoyancyCenter = { x: 0, y: 0, z: 0 };
    this._matrix = new Matrix4();
    this._readyPromise = this.initialize();
  }

  async initialize() {
    if (!CANONICAL_TIERS.includes(this.tier)) throw new Error(`Unknown bounded-water tier "${this.tier}".`);
    if (!WATER_MECHANISM_ROUTES.includes(this.mechanism)) throw new Error(`Unknown bounded-water mechanism "${this.mechanism}".`);
    if (this.selection.mode && !Object.hasOwn(WATER_DEBUG_MODES, this.selection.mode)) throw new Error(`Unknown bounded-water mode "${this.selection.mode}".`);

    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: false, outputBufferType: HalfFloatType });
    await this.renderer.init();
    if (this.renderer.backend?.isWebGPUBackend !== true) throw new Error("Native WebGPU is required; no alternate renderer is activated.");
    this.deviceIdentity = bindWebGPUDeviceIdentity(this.renderer);
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.setSize(Math.max(1, this.canvas.clientWidth), Math.max(1, this.canvas.clientHeight), false);

    this.scene = new Scene();
    this.opaqueScene = new Scene();
    this.scene.background = new Color(0x07131b);
    this.opaqueScene.background = new Color(0x07131b);
    this.camera = new PerspectiveCamera(48, 1, 0.05, 200);
    this.setCameraPose("design");
    this.opaqueMeshes = addOpaqueFixtures(this.opaqueScene);
    this.opaquePass = pass(this.opaqueScene, this.camera);
    await this.rebuildWater();
    this.scenePass = pass(this.scene, this.camera);
    this.pipeline = new RenderPipeline(this.renderer);
    this.pipeline.outputNode = renderOutput(this.scenePass.getTextureNode("output"));
    this.pipeline.outputColorTransform = false;
    this.resize(Math.max(1, this.canvas.clientWidth), Math.max(1, this.canvas.clientHeight), 1);
    await this.renderOnce();
    // Capture host JSON-clones ready(); never return the controller graph.
    return { ready: true, labId: BOUNDED_WATER_LAB_MANIFEST.id };
  }

  ready() {
    return this._readyPromise;
  }

  setCameraPose(id) {
    const pose = (this.profile?.underwaterView ? UNDERWATER_CAMERA_POSES : CAMERA_POSES)[id];
    if (!pose) throw new Error(`Unknown bounded-water camera "${id}".`);
    this.cameraId = id;
    this.camera.position.set(...pose.position);
    this.camera.lookAt(...pose.target);
    this.camera.updateMatrixWorld(true);
  }

  clearFinalScene() {
    if (this.system) {
      this.scene.remove(this.system.mesh);
      this.system.dispose();
      this.system = null;
    }
    disposeMeshes(this.finalOpaqueMeshes);
    disposeMeshes(this.buoyancyMeshes);
    disposeMeshes(this.opaqueInteractionMeshes);
    this.finalOpaqueMeshes = [];
    this.buoyancyMeshes = [];
    this.opaqueInteractionMeshes = [];
    if (this.spray) {
      this.scene.remove(this.spray);
      this.spray.geometry.dispose();
      this.spray.material.dispose();
      this.spray = null;
    }
  }

  buildInteractionSubjects() {
    if (!this.profile.buoyancySprayMasks) return;
    const buoyancyMaterial = makeBasicMaterial(0xffb45c);
    const buoyancy = new Mesh(new SphereGeometry(0.34, 24, 16), buoyancyMaterial);
    buoyancy.name = "bounded-water-buoyancy-subject";
    this.scene.add(buoyancy);
    this.buoyancyMeshes.push(buoyancy);
    const opaqueBuoyancy = new Mesh(new SphereGeometry(0.34, 24, 16), makeBasicMaterial(0xffb45c));
    opaqueBuoyancy.name = "bounded-water-opaque-input-buoyancy-subject";
    this.opaqueScene.add(opaqueBuoyancy);
    this.opaqueInteractionMeshes.push(opaqueBuoyancy);

    const maskMaterial = makeBasicMaterial(0x7a4055);
    const mask = new Mesh(new BoxGeometry(1.1, 0.15, 1.1), maskMaterial);
    mask.position.set(
      this.system.heightfield.parameters.eventMaskCenter.x,
      0.04,
      this.system.heightfield.parameters.eventMaskCenter.y,
    );
    mask.name = "bounded-water-no-impulse-mask";
    this.scene.add(mask);
    this.buoyancyMeshes.push(mask);
    const opaqueMask = new Mesh(new BoxGeometry(1.1, 0.15, 1.1), makeBasicMaterial(0x7a4055));
    opaqueMask.position.copy(mask.position);
    opaqueMask.name = "bounded-water-opaque-input-mask";
    this.opaqueScene.add(opaqueMask);
    this.opaqueInteractionMeshes.push(opaqueMask);

    const sprayGeometry = new SphereGeometry(0.035, 6, 4);
    const sprayMaterial = makeBasicMaterial(0xd9f7ff);
    this.spray = new InstancedMesh(sprayGeometry, sprayMaterial, 16);
    this.spray.name = "bounded-water-deterministic-spray";
    this.scene.add(this.spray);
    this.updateInteractionSubjects(0, false);
  }

  updateInteractionSubjects(timeSeconds, writeImpulse = true) {
    if (!this.profile?.buoyancySprayMasks || this.buoyancyMeshes.length === 0) return;
    const x = -1.2 + 0.65 * Math.sin(timeSeconds * 0.8);
    const z = 0.75 + 0.45 * Math.cos(timeSeconds * 0.65);
    const query = this.system.heightQuery.sampleAtWorldXZ(x, z, timeSeconds);
    if (query.status !== "converged" || !Number.isFinite(query.height)) throw new Error("Buoyancy analytic query failed.");
    const next = { x, y: query.height + 0.24, z };
    this.buoyancyMeshes[0].position.set(next.x, next.y, next.z);
    this.opaqueInteractionMeshes[0].position.copy(this.buoyancyMeshes[0].position);
    if (writeImpulse) {
      this.system.heightfield.setObjectImpulse({
        oldCenter: this.previousBuoyancyCenter,
        newCenter: next,
        radius: 0.48,
        strength: 0.55,
      });
    }
    this.previousBuoyancyCenter = next;
    for (let index = 0; index < this.spray.count; index += 1) {
      const phase = (index / this.spray.count) * Math.PI * 2;
      const age = (timeSeconds * 0.75 + index * 0.173) % 1;
      const radial = 0.15 + age * 0.35;
      this._matrix.makeTranslation(
        x + Math.cos(phase) * radial,
        next.y + 0.1 + age * (1 - age) * 0.8,
        z + Math.sin(phase) * radial,
      );
      this.spray.setMatrixAt(index, this._matrix);
    }
    this.spray.instanceMatrix.needsUpdate = true;
  }

  async rebuildWater() {
    this.clearFinalScene();
    this.profile = WATER_MECHANISM_PROFILES[this.mechanism];
    if (!this.profile) throw new Error(`Unknown bounded-water mechanism "${this.mechanism}".`);
    this.setCameraPose(this.cameraId);
    this.mode = this.selection.mode ?? this.profile.mode;
    if (!Object.hasOwn(WATER_DEBUG_MODES, this.mode)) throw new Error(`Unknown bounded-water mode "${this.mode}".`);
    this.timeNode.value = this.time;
    this.causticsEnabledNode.value = this.profile.receiverCaustics ? 1 : 0;
    const opticalInputs = this.profile.opticalTransport ? {
      sceneColorNode: this.opaquePass.getTextureNode("output"),
      sceneDepthNode: this.opaquePass.getTextureNode("depth"),
    } : null;
    this.system = await createWebGPUBoundedWaterSystem(this.renderer, {
      tier: this.tier,
      seed: this.seed,
      timeNode: this.timeNode,
      debugMode: WATER_DEBUG_MODES[this.mode],
      parameters: {
        eventMaskEnabled: this.profile.buoyancySprayMasks,
      },
      opticalInputs,
      causticsEnabled: this.profile.receiverCaustics,
      opticalTransportEnabled: this.profile.opticalTransport,
    });
    this.opaqueMeshes[0].material.dispose();
    this.opaqueMeshes[0].material = makeReceiverMaterial(this.system, this.causticsEnabledNode);
    this.system.mesh.name = "bounded-water-canonical-surface";
    this.scene.add(this.system.mesh);
    const receiverMaterial = makeReceiverMaterial(this.system, this.causticsEnabledNode);
    this.finalOpaqueMeshes = addOpaqueFixtures(this.scene, { receiverMaterial });
    this.buildInteractionSubjects();

    if (this.profile.seedDrop) {
      const [initialDrop] = seededDropSequence(this.seed, 1, this.system.heightfield.parameters);
      this.system.heightfield.setDrop({
        x: initialDrop.x * this.system.heightfield.parameters.worldSize.x * 0.25,
        z: initialDrop.z * this.system.heightfield.parameters.worldSize.y * 0.25,
        radius: Math.max(initialDrop.radius, 0.18),
        strength: initialDrop.strength,
      });
    }
    if (this.profile.objectImpulse) {
      this.system.heightfield.setObjectImpulse({
        oldCenter: { x: -0.6, y: 0, z: -0.2 },
        newCenter: { x: -0.2, y: 0, z: 0.15 },
        radius: 0.5,
        strength: 0.5,
      });
    }
  }

  async setScenario(id) {
    if (id !== "interactive-bounded-pool") throw new Error(`Unknown bounded-water scenario "${id}".`);
    await this.renderOnce();
  }

  async setMechanism(id) {
    if (!WATER_MECHANISM_ROUTES.includes(id)) throw new Error(`Unknown bounded-water mechanism "${id}".`);
    if (id === this.mechanism) return;
    this.mechanism = id;
    this.selection.mode = null;
    this.time = 0;
    this.timeNode.value = 0;
    await this.rebuildWater();
    await this.renderOnce();
  }

  async setMode(id) {
    // Builtin capture display aliases map onto distinct water debug views.
    const resolved = id === "no-post"
      ? "normals"
      : id === "diagnostics"
        ? "height"
        : id;
    if (!Object.hasOwn(WATER_DEBUG_MODES, resolved)) throw new Error(`Unknown bounded-water mode "${id}".`);
    this.mode = (id === "no-post" || id === "diagnostics") ? "final" : resolved;
    this.selection.mode = resolved;
    this.system.material.userData.setDebugMode(resolved);
    await this.renderOnce();
  }

  async setTier(id) {
    if (!CANONICAL_TIERS.includes(id)) throw new Error(`Unknown bounded-water tier "${id}".`);
    if (id === this.tier) return;
    this.tier = id;
    this.time = 0;
    this.timeNode.value = 0;
    await this.rebuildWater();
    await this.renderOnce();
  }

  async setSeed(seed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`Invalid bounded-water seed "${seed}".`);
    this.seed = seed >>> 0;
    this.time = 0;
    this.timeNode.value = 0;
    await this.rebuildWater();
    await this.renderOnce();
  }

  async setCamera(id) {
    this.setCameraPose(id);
    await this.renderOnce();
  }

  async advanceSimulation(deltaSeconds) {
    let remaining = deltaSeconds;
    const chunk = this.system.heightfield.fixedTimeStep * this.system.heightfield.maxSubsteps;
    while (remaining > 1e-12) {
      const step = Math.min(remaining, chunk);
      this.updateInteractionSubjects(this.time + (deltaSeconds - remaining) + step, this.profile.objectImpulse);
      this.system.update(step);
      remaining -= step;
    }
  }

  async setTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Bounded-water time must be finite and non-negative.");
    if (seconds < this.time) {
      this.time = 0;
      await this.rebuildWater();
    }
    await this.advanceSimulation(seconds - this.time);
    this.time = seconds;
    this.timeNode.value = this.system.heightfield.simulationTime;
    await this.renderOnce();
  }

  async step(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error("Bounded-water delta must be finite and non-negative.");
    await this.advanceSimulation(deltaSeconds);
    this.time += deltaSeconds;
    this.timeNode.value = this.system.heightfield.simulationTime;
    this.pipeline.render();
  }

  async resetHistory(cause) {
    if (typeof cause !== "string" || cause.length === 0) throw new Error("Bounded-water history reset requires a cause.");
    this.time = 0;
    await this.rebuildWater();
    await this.renderOnce();
  }

  resize(width, height, dpr) {
    if (![width, height, dpr].every(Number.isFinite) || width < 1 || height < 1 || dpr <= 0) throw new Error("Invalid bounded-water resize request.");
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  async renderOnce() {
    if (this.disposed) throw new Error("Bounded-water lab is disposed.");
    this.pipeline.render();
  }

  async capturePixels(target = "final") {
    if (target !== "final" && !Object.hasOwn(WATER_DEBUG_MODES, target)) throw new Error(`Unknown bounded-water capture target "${target}".`);
    const previousMode = this.mode;
    const captureMode = target === "final" ? "final" : target;
    if (captureMode !== this.mode) await this.setMode(captureMode);
    const width = this.renderer.domElement.width;
    const height = this.renderer.domElement.height;
    const renderTarget = new RenderTarget(width, height, { type: UnsignedByteType });
    const previousTarget = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(renderTarget);
      this.pipeline.render();
      const pixels = await this.renderer.readRenderTargetPixelsAsync(renderTarget, 0, 0, width, height);
      return {
        target,
        width,
        height,
        bytesPerPixel: 4,
        sourceElementBytes: pixels.BYTES_PER_ELEMENT,
        sourceBytesPerRow: alignedBytesPerRow(width, 4),
        bytesPerRow: alignedBytesPerRow(width, 4),
        format: "rgba8",
        outputColorSpace: "srgb",
        colorManaged: true,
        pixels,
      };
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      renderTarget.dispose();
      if (this.mode !== previousMode) await this.setMode(previousMode);
    }
  }

  async runGpuMutationProbe(id) {
    if (id === "async-impulse-loss") {
      const resolution = this.system.heightfield.resolution;
      const gridIndex = Math.floor((resolution - 1) * 0.375);
      const x = (gridIndex / (resolution - 1) - 0.5) * this.system.heightfield.parameters.worldSize.x;
      const z = ((resolution - 1 - gridIndex) / (resolution - 1) - 0.5) * this.system.heightfield.parameters.worldSize.y;
      const before = await this.system.captureGpuState();
      this.system.heightfield.setDrop({ x, z, radius: 0.7, strength: 0.25 });
      this.system.update(this.system.heightfield.fixedTimeStep);
      const after = await this.system.captureGpuState();
      return { id, before, after, consumedSnapshot: after.eventSnapshotVersion > before.eventSnapshotVersion };
    }
    if (id === "receiver-energy-closure") {
      if (!this.profile.receiverCaustics) throw new Error("Receiver energy probe requires a caustics mechanism route.");
      this.system.update(this.system.heightfield.fixedTimeStep);
      const readback = await this.system.captureGpuState();
      const diagnostics = readback.diagnostics;
      return {
        id,
        readback,
        quantization: boundedCausticQuantizationContract(this.system.heightfield.resolution),
        sourcePowerUnits: diagnostics[4],
        depositedPowerUnits: diagnostics[5],
        outOfDomainPowerUnits: diagnostics[1],
        resolvedPowerUnits: diagnostics[6],
      };
    }
    throw new Error(`Unknown bounded-water GPU mutation probe "${id}".`);
  }

  describePipeline() {
    const owner = BOUNDED_WATER_LAB_MANIFEST.id;
    const workgroupCount = Math.ceil(
      (this.system.heightfield.resolution * this.system.heightfield.resolution)
      / this.system.heightfield.tier.linearWorkgroupSize,
    );
    const workgroups = (values, source) => ({ values, unit: "workgroups", label: "Derived", source });
    return {
      schemaVersion: 2,
      ...captureRuntimeProfileFields(),
      owners: {
        renderer: owner,
        finalPipeline: owner,
        toneMap: owner,
        outputColorTransform: owner,
      },
      signals: [
        ...(this.profile.opticalTransport ? [
          { id: "opaque-color-without-water", producer: owner, consumers: ["water-refraction"], reachable: true },
          { id: "opaque-depth-without-water", producer: owner, consumers: ["water-refraction"], reachable: true },
        ] : []),
        { id: "heightfield", producer: owner, consumers: ["water-position", "surface-differential"], reachable: true },
        { id: "combined-analytic-heightfield-differential", producer: owner, consumers: ["water-normal", ...(this.profile.receiverCaustics ? ["caustic-ray"] : [])], reachable: true },
        { id: "receiver-caustics", producer: owner, consumers: ["opaque-receiver-material", "final-receiver-material"], reachable: this.profile.receiverCaustics },
        { id: "event-snapshot", producer: owner, consumers: ["heightfield-propagation"], reachable: this.profile.seedDrop || this.profile.objectImpulse || this.profile.buoyancySprayMasks },
      ],
      sceneSubmissions: [
        ...(this.profile.opticalTransport ? [{ id: "opaque-without-water", owner, kind: "prepass", purpose: "opaque color/depth input", count: 1 }] : []),
        { id: "final-water-scene", owner, kind: "lit-scene", count: 1 },
        { id: "present", owner, kind: "present", count: 1 },
      ],
      computeDispatches: [
        { id: "reset-diagnostics", owner, workgroups: workgroups([1, 1, 1], "8 diagnostic lanes / 8-lane workgroup"), cadence: "per update with fixed work" },
        { id: "heightfield-propagation", owner, workgroups: workgroups([workgroupCount, 1, 1], "ceil(N² / linearWorkgroupSize)"), cadence: "per fixed step" },
        { id: "surface-differential", owner, workgroups: workgroups([workgroupCount, 1, 1], "ceil(N² / linearWorkgroupSize)"), cadence: "once after catch-up fixed steps" },
        ...(this.profile.receiverCaustics ? [
          { id: "clear-caustic-atomic-buffer", owner, workgroups: workgroups([workgroupCount, 1, 1], "ceil(N² / linearWorkgroupSize)"), cadence: "once after catch-up fixed steps" },
          { id: "source-caustic-deposit", owner, workgroups: workgroups([workgroupCount, 1, 1], "ceil(N² / linearWorkgroupSize)"), cadence: "once after catch-up fixed steps" },
          { id: "receiver-caustic-resolve", owner, workgroups: workgroups([workgroupCount, 1, 1], "ceil(N² / linearWorkgroupSize)"), cadence: "once after catch-up fixed steps" },
        ] : []),
      ],
      resources: this.describeResources().resources,
      finalToneMapOwner: owner,
      finalOutputTransformOwner: owner,
    };
  }

  describeResources() {
    const resources = [...this.system.describeResources().textures, ...this.system.describeResources().buffers];
    const width = this.renderer.domElement.width;
    const height = this.renderer.domElement.height;
    if (this.profile.opticalTransport) resources.push(
      { name: "opaque-without-water-color", kind: "pass-color", width, height, bytes: width * height * 8 },
      { name: "opaque-without-water-depth", kind: "pass-depth", width, height, bytes: width * height * 4 },
    );
    resources.push(
      { name: "final-scene-color", kind: "pass-color", width, height, bytes: width * height * 8 },
      { name: "final-scene-depth", kind: "pass-depth", width, height, bytes: width * height * 4 },
      { name: "water-geometry", kind: "geometry", bytes: this.system.mesh.userData.geometryBytes },
    );
    const geometryBytes = (geometry) => Object.values(geometry.attributes ?? {})
      .reduce((bytes, attribute) => bytes + attribute.array.byteLength, geometry.index?.array.byteLength ?? 0);
    for (const mesh of [
      ...this.opaqueMeshes,
      ...this.finalOpaqueMeshes,
      ...this.buoyancyMeshes,
      ...this.opaqueInteractionMeshes,
    ]) {
      resources.push({
        name: `${mesh.name || "unnamed-mesh"}-geometry`,
        kind: "geometry",
        bytes: geometryBytes(mesh.geometry),
      });
    }
    if (this.spray) {
      resources.push(
        { name: "bounded-water-spray-geometry", kind: "geometry", bytes: geometryBytes(this.spray.geometry) },
        { name: "bounded-water-spray-instance-matrices", kind: "instance-buffer", bytes: this.spray.instanceMatrix.array.byteLength },
      );
    }
    for (const resource of resources) {
      resource.id ??= resource.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
      resource.owner ??= BOUNDED_WATER_LAB_MANIFEST.id;
      resource.residentBytes ??= {
        value: resource.bytes,
        unit: "bytes",
        label: "Derived",
        source: resource.width && resource.height
          ? `${resource.width}×${resource.height} format allocation`
          : "typed-array or geometry byteLength",
      };
    }
    return { schemaVersion: 2, resources, totalBytes: resources.reduce((total, resource) => total + resource.bytes, 0) };
  }

  getMetrics() {
    return {
      labId: BOUNDED_WATER_LAB_MANIFEST.id,
      ...webgpuDeviceIdentityMetrics(this.deviceIdentity, this.renderer),
      threeRevision: "0.185.1",
      scenario: "interactive-bounded-pool",
      tier: this.tier,
      mechanism: this.mechanism,
      mechanismAcknowledged: true,
      mechanismProfile: { ...this.profile },
      mode: this.mode,
      camera: this.cameraId,
      seed: this.seed,
      time: this.time,
      timeSeconds: this.time,
      viewport: {
        width: this.renderer.domElement.width,
        height: this.renderer.domElement.height,
        dpr: this.renderer.getPixelRatio(),
      },
      opaqueInputsReachable: this.system.material.userData.opticalValidation.available,
      dispatchCount: this.system.heightfield.dispatchCount,
      droppedTimeSeconds: this.system.heightfield.droppedTimeSeconds,
      eventSnapshotVersion: this.system.heightfield.eventSnapshotVersion,
      cfl: this.system.heightfield.configValidation.courant,
      cflLimit: this.system.heightfield.configValidation.maxCourant,
      resourceBytes: this.describeResources().totalBytes,
      evidenceVerdict: "INSUFFICIENT_EVIDENCE",
    };
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    markWebGPUDeviceDisposing(this.deviceIdentity);
    this.pipeline?.dispose();
    this.scenePass?.dispose();
    this.opaquePass?.dispose();
    this.clearFinalScene();
    disposeMeshes(this.opaqueMeshes);
    this.renderer?.dispose();
    markWebGPUDeviceDisposed(this.deviceIdentity);
  }
}

const status = document.querySelector("#message");
const error = document.querySelector("#error");
const selection = routeSelection(location.pathname, new URLSearchParams(location.search));
const controller = new BoundedWaterLabController({ canvas: document.querySelector("#lab-canvas"), selection });
window.__LAB_CONTROLLER__ = controller;
window.__LAB_MANIFEST__ = BOUNDED_WATER_LAB_MANIFEST;
window.__LAB_STATE__ = { ready: false, error: null };

controller.ready().then(() => {
  window.__LAB_STATE__.ready = true;
  status.textContent = `WebGPU active · tier ${controller.tier} · mechanism ${controller.mechanism} · evidence remains incomplete`;
  const underCapture = globalThis.__LAB_CAPTURE_PROFILE__ != null
    || new URLSearchParams(location.search).get("capture") === "1";
  if (selection.animate && !underCapture) {
    let previous = performance.now();
    let busy = false;
    const frame = async (now) => {
      if (controller.disposed) return;
      const frameNow = Number.isFinite(now) ? now : performance.now();
      if (!busy) {
        busy = true;
        try { await controller.step(Math.max(0, Math.min((frameNow - previous) / 1000, 1 / 30))); } finally { busy = false; }
      }
      previous = frameNow;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}).catch((cause) => {
  window.__LAB_STATE__.error = cause instanceof Error ? cause.message : String(cause);
  error.textContent = `\nBLOCKED: ${window.__LAB_STATE__.error}`;
});
