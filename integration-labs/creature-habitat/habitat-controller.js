import {
  AgXToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Frustum,
  HalfFloatType,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RenderPipeline,
  RendererUtils,
  RenderTarget,
  REVISION,
  Scene,
  Sphere,
  SphereGeometry,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGPURenderer,
} from "three/webgpu";
import {
  abs,
  clamp,
  color,
  dFdx,
  dFdy,
  emissive,
  float,
  length,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  screenUV,
  texture,
  uniform,
  vec3,
  vec4,
  velocity,
} from "three/tsl";

import { CameraDirectionController } from "../../threejs-camera-controls-and-rigs/examples/webgpu-camera-rig/CameraDirectionController.mjs";
import { createCreatureStage } from "../../threejs-procedural-creatures/examples/webgpu-procedural-creature-lab/src/runtime/creature-stage.js";
import { createDenseVegetationSceneAdapter } from "../../threejs-procedural-vegetation/examples/webgpu-dense-grass/integration-adapter.js";
import { createSharedWeatherStage } from "../../threejs-rain-snow-and-wet-surfaces/examples/webgpu-rain-snow-and-wet-surfaces/precipitation-system.js";

import { BoundedContactRegistry, fanoutContactSnapshot } from "./contact-registry.mjs";
import { createHabitatWeatherVisualStage } from "./habitat-weather-stage.js";
import { assertExclusiveOwnership } from "./ownership-audit.mjs";
import { computeGpuP95, createCreatureHabitatQualityGovernor } from "./quality-governor.mjs";
import {
  createBandwidthRecord,
  createResourceRecord,
  geometryByteLength,
  reconcileResourceLedger,
  textureByteLength,
} from "./resource-ledger.mjs";
import {
  HABITAT_CAMERAS,
  HABITAT_MECHANISMS,
  HABITAT_MODES,
  HABITAT_SCENARIOS,
  HABITAT_TIER_CONFIG,
  HABITAT_TIERS,
  requireHabitatChoice,
} from "./route-state.mjs";
import { assertStaticSpawnStorageImmutable, captureStaticSpawnStorage } from "./static-storage-audit.mjs";
import { createScaledBoundedWaterStage } from "./scaled-water-stage.js";

const LAB_ID = "creature-habitat";
const WORLD_UNITS_PER_METER = 1;
const CONTACT_CAPACITY = 8;
const MRT_TARGETS = Object.freeze(["output", "normal", "emissive", "velocity"]);
const CAMERA_MODE_BY_ID = Object.freeze({ subject: "inspection", habitat: "overview", population: "profile" });
const BIPED_SPEC_URL = new URL(
  "../../threejs-procedural-creatures/examples/webgpu-procedural-creature-lab/src/lab/specs/biped.json",
  import.meta.url,
);

const OWNER_ENTRIES = Object.freeze([
  Object.freeze({ semantic: "renderer", owner: "threejs-image-pipeline" }),
  Object.freeze({ semantic: "final-render-pipeline", owner: "threejs-image-pipeline" }),
  Object.freeze({ semantic: "tone-map", owner: "threejs-image-pipeline" }),
  Object.freeze({ semantic: "output-transform", owner: "threejs-image-pipeline" }),
  Object.freeze({ semantic: "quality-governor", owner: "threejs-image-pipeline" }),
  Object.freeze({ semantic: "timebase", owner: "threejs-rain-snow-and-wet-surfaces" }),
  Object.freeze({ semantic: "camera-jitter", owner: "threejs-camera-controls-and-rigs" }),
  Object.freeze({ semantic: "camera-state", owner: "threejs-camera-controls-and-rigs" }),
  Object.freeze({ semantic: "world-units-and-wind", owner: "threejs-rain-snow-and-wet-surfaces" }),
  Object.freeze({ semantic: "weather-state", owner: "threejs-rain-snow-and-wet-surfaces" }),
  Object.freeze({ semantic: "creature-state", owner: "threejs-procedural-creatures" }),
  Object.freeze({ semantic: "contact-event-registry", owner: "threejs-procedural-creatures" }),
  Object.freeze({ semantic: "vegetation-storage", owner: "threejs-procedural-vegetation" }),
  Object.freeze({ semantic: "bounded-water-state", owner: "threejs-water-optics" }),
  Object.freeze({ semantic: "shadow-maps", owner: "threejs-scalable-real-time-shadows" }),
]);

function finiteNonnegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and nonnegative`);
  return value;
}

export function resolveReadbackStride(pixels, width, height) {
  if (!ArrayBuffer.isView(pixels)) throw new TypeError("readback must be a typed array");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("readback dimensions must be positive integers");
  }
  const rowBytes = width * 4 * pixels.BYTES_PER_ELEMENT;
  if (height === 1 || pixels.byteLength === rowBytes * height) return rowBytes;
  const alignedBytesPerRow = Math.ceil(rowBytes / 256) * 256;
  if (
    pixels.byteLength === alignedBytesPerRow * height ||
    pixels.byteLength === alignedBytesPerRow * (height - 1) + rowBytes
  ) return alignedBytesPerRow;
  const inferred = (pixels.byteLength - rowBytes) / (height - 1);
  if (!Number.isInteger(inferred) || inferred < rowBytes || inferred % pixels.BYTES_PER_ELEMENT !== 0) {
    throw new Error(`invalid WebGPU readback stride ${inferred}; rowBytes=${rowBytes}`);
  }
  return inferred;
}

function syncWeatherAliases(weather) {
  const horizontalSpeed = Math.hypot(weather.wind.x, weather.wind.z);
  weather.windDirection ??= { x: 1, z: 0 };
  if (horizontalSpeed > 1e-9) {
    weather.windDirection.x = weather.wind.x / horizontalSpeed;
    weather.windDirection.z = weather.wind.z / horizontalSpeed;
  }
  weather.windStrength = Math.min(1.4, horizontalSpeed * 0.42);
  weather.windSpeed = 0.72 + horizontalSpeed * 0.18;
  return weather;
}

function uniqueGeometryBytes(root) {
  if (!root?.traverse) return 0;
  const seen = new Set();
  let bytes = 0;
  root.traverse((object) => {
    const geometry = object.geometry;
    const identity = geometry?.uuid ?? geometry;
    if (!geometry || seen.has(identity)) return;
    seen.add(identity);
    bytes += geometryByteLength(geometry);
  });
  return bytes;
}

function buildDebugMesh(capacity, colorValue, { wireframe = false } = {}) {
  const geometry = new SphereGeometry(1, 12, 8);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = color(colorValue);
  material.wireframe = wireframe;
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function configureShadowLight(light, mapSize) {
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.camera.left = -24;
  light.shadow.camera.right = 24;
  light.shadow.camera.top = 24;
  light.shadow.camera.bottom = -24;
  light.shadow.camera.near = 0.25;
  light.shadow.camera.far = 90;
  light.shadow.bias = -0.00025;
  light.shadow.normalBias = 0.025;
  light.shadow.camera.updateProjectionMatrix();
  if (light.shadow.map) {
    light.shadow.map.dispose();
    light.shadow.map = null;
  }
}

/** Host-only shadow adapter: it owns one real DirectionalLight shadow map. */
export function createHostShadowStage({ renderer, scene, mapSize = 1024 } = {}) {
  if (renderer?.backend?.isWebGPUBackend !== true) {
    throw new Error("Creature Habitat shadow stage requires an initialized native WebGPU renderer");
  }
  if (!scene?.add || !scene?.remove) throw new TypeError("Creature Habitat shadow stage requires a host scene");
  const light = new DirectionalLight(0xffefcf, 4.4);
  light.name = "Creature Habitat host shadow light";
  light.position.set(14, 24, 10);
  light.target.position.set(0, 0, -2);
  scene.add(light, light.target);
  configureShadowLight(light, mapSize);
  let disposed = false;
  return {
    light,
    setMapSize(nextMapSize) {
      if (disposed) throw new Error("Creature Habitat shadow stage is disposed");
      if (!Number.isInteger(nextMapSize) || nextMapSize < 1) throw new RangeError("shadow map size must be a positive integer");
      configureShadowLight(light, nextMapSize);
    },
    describeResources() {
      return {
        owner: "threejs-scalable-real-time-shadows",
        lightCount: 1,
        mapWidth: light.shadow.mapSize.x,
        mapHeight: light.shadow.mapSize.y,
        receiverConsumesActualShadowMap: true,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(light, light.target);
      light.shadow.map?.dispose();
    },
  };
}

function defaultSceneObjects(scene) {
  const groundGeometry = new PlaneGeometry(80, 80, 1, 1);
  groundGeometry.rotateX(-Math.PI * 0.5);
  const groundMaterial = new MeshStandardNodeMaterial();
  groundMaterial.colorNode = color(0x27372d);
  groundMaterial.roughnessNode = float(0.86);
  groundMaterial.metalnessNode = float(0);
  const ground = new Mesh(groundGeometry, groundMaterial);
  ground.name = "Creature Habitat ground";
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  scene.add(ground);

  const ambient = new AmbientLight(0x9fb8d4, 1.25);
  scene.add(ambient);
  return { ground, groundGeometry, groundMaterial, ambient };
}

function cloneCameraState(camera) {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    up: camera.up.clone(),
    near: camera.near,
    far: camera.far,
    fov: camera.fov,
    aspect: camera.aspect,
    zoom: camera.zoom,
    view: camera.view ? { ...camera.view } : null,
  };
}

function restoreCameraState(camera, state) {
  camera.position.copy(state.position);
  camera.quaternion.copy(state.quaternion);
  camera.up.copy(state.up);
  camera.near = state.near;
  camera.far = state.far;
  camera.fov = state.fov;
  camera.aspect = state.aspect;
  camera.zoom = state.zoom;
  camera.view = state.view ? { ...state.view } : null;
  camera.updateProjectionMatrix();
}

export class HabitatController {
  constructor({
    canvas,
    initialTier = "balanced",
    initialSeed = 1,
    initialMechanism = null,
    tierLocked = false,
    modeLocked = false,
    lockedMode = null,
  } = {}) {
    if (!canvas) throw new TypeError("HabitatController requires a canvas");
    this.canvas = canvas;
    this.tier = requireHabitatChoice(initialTier, HABITAT_TIERS, "tier");
    this.seed = Number(initialSeed) >>> 0;
    this.tierLocked = Boolean(tierLocked);
    this.modeLocked = Boolean(modeLocked);
    this.lockedMode = lockedMode;
    this.scenario = "habitat";
    this.mechanism = initialMechanism === null
      ? null
      : requireHabitatChoice(initialMechanism, HABITAT_MECHANISMS, "mechanism");
    this.mode = "final";
    this.cameraId = "habitat";
    this.timeSeconds = 0;
    this.frameIndex = 0;
    this.lastResetCause = "initialization";
    this.initialized = false;
    this.disposed = false;
    this.stageGeneration = 0;
    this.qualityGovernor = createCreatureHabitatQualityGovernor({ initialTier: this.tier });
    this.qualityApplicationTrace = [];
    this.measuredGpuFrameMs = [];
    this.lastGpuTiming = Object.freeze({
      verdict: "INSUFFICIENT_EVIDENCE",
      renderMs: null,
      computeMs: null,
      frameMs: null,
      reason: "no rendered frame has supplied GPU timestamps",
    });
    this.lastReadbackBytes = 0;
    this.contactRegistry = new BoundedContactRegistry({ capacity: CONTACT_CAPACITY });
    this.previousFootPlantState = new Map();
    this.lastWaterSequence = 0;
    this.coalescedWaterEvents = 0;
    this.sharedRootVelocity = [0, 0, 0.82];
    this.waterWindPrevious = new Vector3(-2, 0, -2);
    this.waterWindCurrent = new Vector3(-2, 0, -2);
    this.cullingProjection = new Matrix4();
    this.cullingFrustum = new Frustum();
    this.debugMatrix = new Matrix4();
    this.ownerGraphUniform = uniform(new Vector4(0, 0, 0, 1));
    this.runtimeDiagnosticUniform = uniform(new Vector4(0, 0, 0, 1));
    this.owners = assertExclusiveOwnership(OWNER_ENTRIES);
    const ownerNames = Object.values(this.owners);
    this.ownerGraphUniform.value.set(
      Math.min(1, Object.keys(this.owners).length / 16),
      Math.min(1, new Set(ownerNames).size / 8),
      ownerNames.length === Object.keys(this.owners).length ? 0 : 1,
      1,
    );
  }

  get labId() {
    return LAB_ID;
  }

  assertActive() {
    if (this.disposed) throw new Error("Creature Habitat controller is disposed");
  }

  async ready() {
    this.assertActive();
    if (this.initialized) return;

    this.renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: false,
      reversedDepthBuffer: true,
      outputBufferType: HalfFloatType,
      trackTimestamp: true,
    });
    await this.renderer.init();
    if (this.renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("Creature Habitat requires initialized native WebGPU; fallback is intentionally blocked");
    }
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = AgXToneMapping;
    this.renderer.toneMappingExposure = 1;

    const width = Math.max(1, this.canvas.clientWidth || this.canvas.width || 1200);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.height || 800);
    const tierConfig = HABITAT_TIER_CONFIG[this.tier];
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, tierConfig.dprCap));
    this.renderer.setSize(width, height, false);

    this.scene = new Scene();
    this.scene.background = new Color(0x0f1822);
    this.camera = new PerspectiveCamera(50, width / height, 0.12, 180);
    this.camera.position.set(7.5, 4.4, 11.5);
    this.camera.lookAt(0, 0.7, -1.5);
    this.cameraInitialState = cloneCameraState(this.camera);
    this.sceneObjects = defaultSceneObjects(this.scene);
    this.shadowStage = createHostShadowStage({
      renderer: this.renderer,
      scene: this.scene,
      mapSize: tierConfig.shadowMapSize,
    });

    this.contactDebug = buildDebugMesh(CONTACT_CAPACITY, 0xff5c8a);
    this.contactDebug.name = "Creature contact registry diagnostics";
    this.cullingDebug = buildDebugMesh(HABITAT_TIER_CONFIG.budgeted.creatureCapacity, 0x56e39f, { wireframe: true });
    this.cullingDebug.name = "Creature culling bounds diagnostics";
    this.scene.add(this.contactDebug, this.cullingDebug);

    this.scenePass = pass(this.scene, this.camera);
    this.scenePass.setMRT(mrt({ output, normal: normalView, emissive, velocity }));
    this.scenePass.setResolutionScale(tierConfig.sceneScale);
    const sceneColor = this.scenePass.getTextureNode("output");
    const subjectEmission = this.scenePass.getTextureNode("emissive");
    const subjectMask = clamp(length(subjectEmission.rgb).mul(18), 0, 1);
    const edge = clamp(abs(dFdx(subjectMask)).add(abs(dFdy(subjectMask))).mul(2.4), 0, 1);
    const outlineRgb = vec3(0.08, 0.78, 1.15).mul(edge);
    const outlinedScene = vec4(sceneColor.rgb.add(outlineRgb), sceneColor.a);
    const outlineOnly = vec4(outlineRgb, 1);

    this.outputs = {
      final: renderOutput(outlinedScene),
      "no-post": renderOutput(sceneColor),
      "contact-events": renderOutput(sceneColor),
      "water-ripples": renderOutput(sceneColor),
      "vegetation-trampling": renderOutput(sceneColor),
      culling: renderOutput(sceneColor),
      outline: renderOutput(outlineOnly),
      "shadow-parity": renderOutput(sceneColor),
      "owner-graph": renderOutput(this.ownerGraphUniform),
    };
    this.renderPipeline = new RenderPipeline(this.renderer);
    this.renderPipeline.outputColorTransform = false;
    this.renderPipeline.outputNode = this.outputs.final;

    const response = await fetch(BIPED_SPEC_URL);
    if (!response.ok) throw new Error(`failed to load creature habitat biped spec: ${response.status}`);
    this.creatureSpec = await response.json();
    await this.rebuildStages(this.tier);
    await this.renderer.compileAsync(this.scene, this.camera);
    await this.scenePass.compileAsync(this.renderer);
    // The shadow comparison target is allocated by a real caster/receiver
    // render, not fabricated for diagnostics.
    this.refreshShadowAtlasOutput();
    this.initialized = true;
  }

  refreshShadowAtlasOutput() {
    const previousMode = this.mode;
    this.renderPipeline.outputNode = this.outputs.final;
    this.renderPipeline.needsUpdate = true;
    this.renderPipeline.render();
    const shadowMapTexture = this.shadowStage.light.shadow.map?.texture;
    if (!shadowMapTexture) {
      throw new Error("Creature Habitat shadow diagnostic requires the real allocated shadow atlas");
    }
    this.shadowAtlasTexture = shadowMapTexture;
    if (!this.shadowAtlasTextureNode) {
      this.shadowAtlasTextureNode = texture(shadowMapTexture);
      const shadowDepth = this.shadowAtlasTextureNode.sample(screenUV).r;
      this.outputs["shadow-parity"] = renderOutput(vec4(vec3(shadowDepth), 1));
    } else {
      this.shadowAtlasTextureNode.value = shadowMapTexture;
    }
    this.applyMode(previousMode);
  }

  updateCullingFrustum() {
    this.camera.updateMatrixWorld(true);
    this.cullingProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.cullingFrustum.setFromProjectionMatrix(this.cullingProjection);
  }

  async disposeStages() {
    this.cameraController?.dispose();
    this.cameraController = null;
    if (this.creatureStage) this.creatureStage.dispose();
    this.creatureStage = null;
    if (this.vegetationStage) this.vegetationStage.dispose();
    this.vegetationStage = null;
    if (this.waterStage) {
      this.scene.remove(this.waterStage.mesh);
      this.waterStage.dispose();
    }
    this.waterStage = null;
    this.weatherVisualStage?.dispose();
    this.weatherVisualStage = null;
    this.staticSpawnBaseline = null;
  }

  async rebuildStages(tier) {
    this.assertActive();
    const tierConfig = HABITAT_TIER_CONFIG[tier];
    await this.disposeStages();
    this.contactRegistry.clear();
    this.previousFootPlantState.clear();
    this.lastWaterSequence = 0;
    this.storageAuditedAfterContact = false;
    this.stageGeneration += 1;

    this.weatherStage ??= createSharedWeatherStage({
      qualityTier: tierConfig.weatherTier,
      wind: { x: 1.45, y: 0, z: 0.52 },
      temperatureC: 0,
      forcing: 0.56,
      progress: 0.56,
      precipitationRate: 0.32,
      wetness: 0.45,
      puddleFill: 0.2,
      snowCoverage: 0.35,
    });
    this.weatherStage.weather.qualityTier = tierConfig.weatherTier;
    syncWeatherAliases(this.weatherStage.weather);
    this.sharedTimeNode ??= uniform(0);

    this.weatherVisualStage = createHabitatWeatherVisualStage({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      weatherStage: this.weatherStage,
      tier: tierConfig.weatherTier,
      seed: this.seed,
    });

    this.waterStage = await createScaledBoundedWaterStage({
      renderer: this.renderer,
      weatherState: this.weatherStage.weather,
      tier: tierConfig.waterTier,
      waterScale: tierConfig.waterScale,
      seed: this.seed,
      timeNode: this.sharedTimeNode,
      parameters: {
        worldSize: new Vector2(12 * WORLD_UNITS_PER_METER, 12 * WORLD_UNITS_PER_METER),
        dropRadius: 0.38 * WORLD_UNITS_PER_METER,
        dropStrength: 0.11,
        objectRadius: 0.5 * WORLD_UNITS_PER_METER,
        objectDisplacementScale: 0.025,
      },
    });
    this.waterStage.mesh.position.y = 0;
    this.waterStage.mesh.receiveShadow = true;
    this.scene.add(this.waterStage.mesh);

    this.vegetationStage = await createDenseVegetationSceneAdapter({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      pipeline: this.renderPipeline,
      weather: this.weatherStage.weather,
      worldUnitsPerMeter: WORLD_UNITS_PER_METER,
      tier: tierConfig.vegetationTier,
      seed: this.seed,
    });
    this.vegetationStage.system.object.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    this.staticSpawnBaseline = captureStaticSpawnStorage(this.vegetationStage.system);

    this.updateCullingFrustum();
    this.creatureStage = createCreatureStage({
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      spec: this.creatureSpec,
      tier: tierConfig.creatureTier,
      capacity: tierConfig.creatureCapacity,
      maxParts: 64,
      rootVelocity: this.sharedRootVelocity,
      waterQuery: (x, z, time) => this.waterStage.heightQuery.getWaterHeight(x, z, time),
      isVisible: (bounds) => this.cullingFrustum.intersectsSphere(bounds),
      rendererOwner: this.owners.renderer,
      cameraOwner: this.owners["camera-state"],
      weatherOwner: this.owners["world-units-and-wind"],
      waterOwner: this.owners["bounded-water-state"],
      shadowOwner: this.owners["shadow-maps"],
      pipelineOwner: this.owners["final-render-pipeline"],
      creatureOwner: this.owners["creature-state"],
      name: `creature-habitat/${tier}`,
    });
    // The emissive MRT is the exact subject mask used by the shared-pass
    // outline. All other habitat materials remain non-emissive.
    this.creatureStage.material.emissiveNode = color(0x12384a);

    const population = tierConfig.creaturePopulation;
    const columns = Math.ceil(Math.sqrt(population));
    for (let index = 0; index < population; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      this.creatureStage.spawn(this.creatureSpec, {
        seed: (this.seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0,
        position: [
          (column - (columns - 1) * 0.5) * 1.35,
          0,
          -3.3 + row * 1.15,
        ],
      });
    }
    this.creatureStage.updateStorage();

    this.cameraSubject ??= new Object3D();
    this.cameraSubject.name = "Creature Habitat camera subject proxy";
    this.updateCameraSubject();
    const firstRadius = Math.max(0.5, this.creatureStage.instances[0]?.bounds.radius ?? 1);
    this.cameraController = new CameraDirectionController(this.camera, {
      subject: this.cameraSubject,
      subjectBounds: new Sphere(new Vector3(), firstRadius),
      tier: tierConfig.cameraTier,
    });
    this.cameraController.setThrust(0.18);
    this.shadowStage.setMapSize(tierConfig.shadowMapSize);
    this.applyCameraImmediate(this.cameraId);
    this.applyMode(this.mode);
    this.renderPipeline.needsUpdate = true;
  }

  updateCameraSubject() {
    const first = this.creatureStage?.instances?.[0];
    if (!first) return;
    this.cameraSubject.position.copy(first.bounds.center);
    if (this.cameraController?.subjectBounds) this.cameraController.subjectBounds.radius = Math.max(0.5, first.bounds.radius);
  }

  applyCameraImmediate(id) {
    const cameraId = requireHabitatChoice(id, HABITAT_CAMERAS, "camera");
    const mode = CAMERA_MODE_BY_ID[cameraId];
    this.cameraController.mode = mode;
    this.cameraController.transition.active = false;
    const pose = this.cameraController.updateModePose(
      mode,
      this.cameraController.scratch.targetPosition,
      this.cameraController.scratch.targetQuaternion,
    );
    this.camera.position.copy(pose.position);
    this.camera.quaternion.copy(pose.quaternion);
    this.camera.updateMatrixWorld(true);
    this.cameraId = cameraId;
  }

  applyMode(id) {
    const mode = requireHabitatChoice(id, HABITAT_MODES, "mode");
    this.mode = mode;
    this.contactDebug.visible = mode === "contact-events" || mode === "vegetation-trampling";
    this.cullingDebug.visible = mode === "culling";
    this.waterStage?.material.userData.setDebugMode(mode === "water-ripples" ? "height" : "final");
    this.vegetationStage?.system.setDebugMode(mode === "culling" ? "lod" : "final");
    this.weatherVisualStage?.setMode(mode);
    this.renderPipeline.outputNode = this.outputs[mode];
    this.renderPipeline.needsUpdate = true;
  }

  collectFootContacts() {
    let emitted = 0;
    for (let instanceIndex = 0; instanceIndex < this.creatureStage.instances.length; instanceIndex += 1) {
      const instance = this.creatureStage.instances[instanceIndex];
      for (const foot of instance.driver.telemetry.gait?.feet ?? []) {
        const key = `${instanceIndex}:${foot.partId}`;
        const wasPlanted = this.previousFootPlantState.get(key) === true;
        if (foot.planted && !wasPlanted) {
          this.contactRegistry.push({
            x: foot.world[0] + instance.layout[0],
            z: foot.world[2] + instance.layout[2],
            radius: 0.42 * WORLD_UNITS_PER_METER,
            weight: 1,
            strength: 0.1,
            timeSeconds: this.timeSeconds,
            sourceInstance: instanceIndex,
            partId: foot.partId,
          });
          emitted += 1;
        }
        this.previousFootPlantState.set(key, foot.planted);
      }
    }
    return emitted;
  }

  consumeWaterContacts(snapshot) {
    const pending = snapshot.filter((event) => event.sequence > this.lastWaterSequence);
    if (pending.length === 0) return;
    let weightSum = 0;
    let x = 0;
    let z = 0;
    let radius = 0;
    let strength = 0;
    for (const event of pending) {
      const weight = Math.max(event.weight, 1e-6);
      weightSum += weight;
      x += event.x * weight;
      z += event.z * weight;
      radius = Math.max(radius, event.radius);
      strength += event.strength * weight;
    }
    this.waterStage.heightfield.setDrop({
      x: x / weightSum,
      z: z / weightSum,
      radius,
      strength: Math.min(0.36, strength),
    });
    this.lastWaterSequence = pending[pending.length - 1].sequence;
    this.coalescedWaterEvents += Math.max(0, pending.length - 1);
  }

  applySharedWindToWater(deltaSeconds) {
    const weather = this.weatherStage.weather;
    this.waterWindPrevious.copy(this.waterWindCurrent);
    const halfExtent = 5.5 * WORLD_UNITS_PER_METER;
    const wrap = (value) => ((value + halfExtent) % (halfExtent * 2) + halfExtent * 2) % (halfExtent * 2) - halfExtent;
    this.waterWindCurrent.set(
      wrap(-2 + weather.windDisplacement.x * 0.08),
      0,
      wrap(-2 + weather.windDisplacement.z * 0.08),
    );
    if (this.waterWindCurrent.distanceTo(this.waterWindPrevious) > 1) {
      this.waterWindPrevious.copy(this.waterWindCurrent);
    }
    this.waterStage.heightfield.setObjectImpulse({
      oldCenter: this.waterWindPrevious,
      newCenter: this.waterWindCurrent,
      radius: 0.5 * WORLD_UNITS_PER_METER,
      strength: weather.forcing * Math.min(0.028, deltaSeconds * 0.6),
    });
  }

  updateContactDebug(snapshot) {
    this.contactDebug.count = snapshot.length;
    for (let index = 0; index < snapshot.length; index += 1) {
      const event = snapshot[index];
      this.debugMatrix.makeScale(event.radius, 0.08, event.radius);
      this.debugMatrix.setPosition(event.x, 0.13, event.z);
      this.contactDebug.setMatrixAt(index, this.debugMatrix);
    }
    this.contactDebug.instanceMatrix.needsUpdate = snapshot.length > 0;
  }

  updateCullingDebug() {
    const instances = this.creatureStage.instances;
    this.cullingDebug.count = instances.length;
    for (let index = 0; index < instances.length; index += 1) {
      const bounds = instances[index].bounds;
      this.debugMatrix.makeScale(bounds.radius, bounds.radius, bounds.radius);
      this.debugMatrix.setPosition(bounds.center);
      this.cullingDebug.setMatrixAt(index, this.debugMatrix);
    }
    this.cullingDebug.instanceMatrix.needsUpdate = instances.length > 0;
  }

  async setScenario(id) {
    this.scenario = requireHabitatChoice(id, HABITAT_SCENARIOS, "scenario");
  }

  async setMode(id) {
    this.assertActive();
    if (this.modeLocked && id !== this.lockedMode) {
      throw new Error(`locked creature-habitat mechanism rejects mode "${id}"; expected "${this.lockedMode}"`);
    }
    this.applyMode(id);
  }

  async setTier(id, options = undefined) {
    this.assertActive();
    const tier = requireHabitatChoice(id, HABITAT_TIERS, "tier");
    if (this.tierLocked && tier !== this.tier) {
      throw new Error(`locked creature-habitat tier route "${this.tier}" rejects "${tier}"`);
    }
    if (tier === this.tier) return;
    const governorTransition = options?.source === "quality-governor";
    this.tier = tier;
    const config = HABITAT_TIER_CONFIG[tier];
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, config.dprCap));
    this.scenePass.setResolutionScale(config.sceneScale);
    await this.rebuildStages(tier);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.refreshShadowAtlasOutput();
    if (!governorTransition) {
      this.qualityGovernor = createCreatureHabitatQualityGovernor({ initialTier: tier });
      this.qualityApplicationTrace.push(Object.freeze({
        frameIndex: this.frameIndex,
        kind: "manual-tier-reset",
        tier,
      }));
    }
  }

  async setSeed(seed) {
    this.assertActive();
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("seed must be a u32 integer");
    const next = seed >>> 0;
    if (next === this.seed) return;
    this.seed = next;
    await this.rebuildStages(this.tier);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.refreshShadowAtlasOutput();
  }

  async setCamera(id) {
    this.assertActive();
    this.applyCameraImmediate(id);
  }

  async setTime(seconds) {
    this.assertActive();
    finiteNonnegative(seconds, "time");
    if (seconds > 30) throw new RangeError("deterministic habitat seek is capped at 30 seconds");
    await this.rebuildStages(this.tier);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.refreshShadowAtlasOutput();
    this.weatherStage.reset({
      qualityTier: HABITAT_TIER_CONFIG[this.tier].weatherTier,
      wind: { x: 1.45, y: 0, z: 0.52 },
      temperatureC: 0,
      forcing: 0.56,
      progress: 0.56,
      precipitationRate: 0.32,
      wetness: 0.45,
      puddleFill: 0.2,
      snowCoverage: 0.35,
    });
    this.weatherVisualStage.update(0);
    this.timeSeconds = 0;
    this.frameIndex = 0;
    this.coalescedWaterEvents = 0;
    this.sharedTimeNode.value = 0;
    const fixedDelta = 1 / 60;
    while (this.timeSeconds + fixedDelta <= seconds + 1e-12) await this.step(fixedDelta);
    const remainder = seconds - this.timeSeconds;
    if (remainder > 1e-12) await this.step(remainder);
  }

  async step(deltaSeconds) {
    this.assertActive();
    finiteNonnegative(deltaSeconds, "deltaSeconds");
    const weather = this.weatherStage.update({
      deltaTime: deltaSeconds,
      targetForcing: 0.56,
      targetProgress: 0.56,
      wind: { x: 1.45, y: 0, z: 0.52 },
      temperatureC: 0,
      precipitationRate: 0.32,
    });
    syncWeatherAliases(weather);
    this.timeSeconds = weather.time;
    this.sharedTimeNode.value = this.timeSeconds;
    this.sharedRootVelocity[0] = weather.wind.x * 0.018;
    this.sharedRootVelocity[1] = 0;
    this.sharedRootVelocity[2] = 0.82 + weather.wind.z * 0.018;

    this.updateCullingFrustum();
    const visibleCreatures = this.creatureStage.step(deltaSeconds);
    const emittedContacts = this.collectFootContacts();
    const snapshot = this.contactRegistry.active(this.timeSeconds);
    fanoutContactSnapshot(
      snapshot,
      (events) => this.vegetationStage.update({ contacts: events, time: this.timeSeconds }),
      (events) => this.consumeWaterContacts(events),
    );
    // Full-byte comparison is deliberately confined to the trampling
    // diagnostic; the final/performance route never hashes tens of MB in-frame.
    if (snapshot.length > 0 && !this.storageAuditedAfterContact && this.mode === "vegetation-trampling") {
      assertStaticSpawnStorageImmutable(this.vegetationStage.system, this.staticSpawnBaseline);
      this.storageAuditedAfterContact = true;
    }
    this.applySharedWindToWater(deltaSeconds);
    await Promise.resolve(this.waterStage.update(deltaSeconds));
    this.weatherVisualStage.update(deltaSeconds);

    this.updateContactDebug(snapshot);
    this.updateCullingDebug();
    this.updateCameraSubject();
    this.cameraController.update(deltaSeconds);
    this.runtimeDiagnosticUniform.value.set(
      this.creatureStage.instances.length > 0 ? visibleCreatures / this.creatureStage.instances.length : 0,
      snapshot.length / CONTACT_CAPACITY,
      emittedContacts / Math.max(1, this.creatureStage.instances.length * 2),
      1,
    );
    this.frameIndex += 1;
    return { visibleCreatures, emittedContacts, contactSnapshot: snapshot };
  }

  async resetHistory(cause) {
    this.assertActive();
    if (typeof cause !== "string" || cause.length === 0) throw new TypeError("resetHistory requires a nonempty cause");
    this.contactRegistry.clear();
    this.previousFootPlantState.clear();
    this.lastWaterSequence = 0;
    this.waterStage.heightfield.accumulator = 0;
    this.waterStage.heightfield.readIndex = 0;
    this.waterStage.heightfield.resetImpulseUniforms();
    this.waterStage.heightfield.initialize();
    this.waterStage.material.userData.syncSimulationTextures();
    this.weatherVisualStage.reset();
    this.contactDebug.count = 0;
    this.renderPipeline.needsUpdate = true;
    this.lastResetCause = cause;
  }

  async resize(width, height, dpr = 1) {
    this.assertActive();
    if (![width, height, dpr].every((value) => Number.isFinite(value) && value > 0)) {
      throw new RangeError("width, height, and dpr must be finite and positive");
    }
    const cap = HABITAT_TIER_CONFIG[this.tier].dprCap;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.renderer.setSize(width, height, false);
    this.scenePass.setSize(width, height);
    this.captureTarget?.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderPipeline.needsUpdate = true;
  }

  async renderOnce() {
    this.assertActive();
    this.renderPipeline.render();
    const timing = await this.resolveGpuFrameTiming();
    this.lastGpuTiming = Object.freeze(timing);
    if (timing.verdict === "PASS") {
      this.measuredGpuFrameMs.push(timing.frameMs);
      if (this.measuredGpuFrameMs.length > 240) this.measuredGpuFrameMs.shift();
    }

    if (this.tierLocked) return timing;
    const decision = this.qualityGovernor.recordGpuTimestamp(
      timing.verdict === "PASS" ? timing.frameMs : undefined,
      { frameIndex: this.frameIndex, renderMs: timing.renderMs, computeMs: timing.computeMs },
    );
    if (decision.kind === "evaluated-window" && decision.transition) {
      const transition = Object.freeze({
        ...decision.transition,
        appliedAtFrame: this.frameIndex,
        source: "measured-current-adapter-gpu-timestamps",
      });
      this.qualityApplicationTrace.push(transition);
      await this.setTier(decision.transition.toTier, { source: "quality-governor" });
    }
    return timing;
  }

  async resolveGpuFrameTiming() {
    if (this.renderer.hasFeature?.("timestamp-query") !== true) {
      return {
        verdict: "INSUFFICIENT_EVIDENCE",
        renderMs: null,
        computeMs: null,
        frameMs: null,
        reason: "timestamp-query feature unavailable",
      };
    }
    try {
      const renderMs = await this.renderer.resolveTimestampsAsync("render");
      const computeMs = await this.renderer.resolveTimestampsAsync("compute");
      if (![renderMs, computeMs].every((value) => Number.isFinite(value) && value >= 0)) {
        throw new Error("render/compute timestamps were not finite nonnegative durations");
      }
      const frameMs = renderMs + computeMs;
      if (!(frameMs > 0)) throw new Error("combined GPU frame timestamp was not positive");
      return { verdict: "PASS", renderMs, computeMs, frameMs, reason: null };
    } catch (error) {
      return {
        verdict: "INSUFFICIENT_EVIDENCE",
        renderMs: null,
        computeMs: null,
        frameMs: null,
        reason: error.message,
      };
    }
  }

  async capturePixels(target = "presentation") {
    this.assertActive();
    let renderTarget;
    let textureIndex;
    let colorManaged = false;
    const presentationMode = target === "presentation"
      ? this.mode
      : target === "shadow-atlas"
        ? "shadow-parity"
        : HABITAT_MODES.includes(target)
          ? target
          : null;
    if (presentationMode !== null) {
      this.captureTarget ??= new RenderTarget(
        Math.max(1, this.renderer.domElement.width),
        Math.max(1, this.renderer.domElement.height),
        { type: UnsignedByteType },
      );
      this.captureTarget.texture.name = `creature-habitat-${presentationMode}-presentation`;
      const state = RendererUtils.saveRendererState(this.renderer);
      const previousMode = this.mode;
      try {
        if (presentationMode === "shadow-parity") {
          // Update the actual caster/receiver atlas before sampling it. This
          // extra diagnostic render is capture-only and never part of the
          // production submission count.
          this.applyMode("no-post");
          this.renderPipeline.render();
          this.applyMode("shadow-parity");
        } else if (presentationMode !== previousMode) {
          this.applyMode(presentationMode);
        }
        this.renderer.setRenderTarget(this.captureTarget);
        this.renderPipeline.render();
      } finally {
        RendererUtils.restoreRendererState(this.renderer, state);
        if (presentationMode !== previousMode) this.applyMode(previousMode);
      }
      renderTarget = this.captureTarget;
      textureIndex = 0;
      colorManaged = true;
    } else {
      const mrtTarget = target === "outline-mask" ? "emissive" : target;
      textureIndex = MRT_TARGETS.indexOf(mrtTarget);
      if (textureIndex < 0) throw new RangeError(`unknown creature-habitat capture target "${target}"`);
      const previousMode = this.mode;
      try {
        this.applyMode("no-post");
        this.renderPipeline.render();
      } finally {
        this.applyMode(previousMode);
      }
      renderTarget = this.scenePass.renderTarget;
    }
    const width = renderTarget.width;
    const height = renderTarget.height;
    const pixels = await this.renderer.readRenderTargetPixelsAsync(
      renderTarget,
      0,
      0,
      width,
      height,
      textureIndex,
    );
    const rowBytes = width * 4 * pixels.BYTES_PER_ELEMENT;
    const bytesPerRow = resolveReadbackStride(pixels, width, height);
    this.lastReadbackBytes = pixels.byteLength;
    return {
      target,
      width,
      height,
      rowBytes,
      bytesPerRow,
      sourceBytesPerRow: bytesPerRow,
      sourceByteLength: pixels.byteLength,
      bytesPerPixel: 4 * pixels.BYTES_PER_ELEMENT,
      sourceElementBytes: pixels.BYTES_PER_ELEMENT,
      format: colorManaged ? "rgba8unorm" : pixels.BYTES_PER_ELEMENT === 2 ? "rgba16float" : "rgba8unorm",
      colorManaged,
      outputColorSpace: colorManaged ? this.renderer.outputColorSpace : null,
      source: colorManaged
        ? presentationMode === "shadow-parity"
          ? "render-target readback of real host shadow-atlas sample node"
          : "color-managed RenderPipeline presentation readback"
        : target === "outline-mask"
          ? "real creature-only emissive MRT attachment readback"
          : `real ${target} MRT attachment readback`,
      pixels,
    };
  }

  assertImmutableSpawnStorage() {
    return assertStaticSpawnStorageImmutable(this.vegetationStage.system, this.staticSpawnBaseline);
  }

  describeSubjectConsistency() {
    const material = this.creatureStage.material;
    const parity = material.userData.shadowCasterParity;
    return {
      visibleAndShadowSharePositionNode: parity.positionNode === parity.castShadowPositionNode,
      receiverAndShadowSharePositionNode: parity.positionNode === parity.receivedShadowPositionNode,
      outlineMaskSource: "same creature mesh emissive output in habitat primary MRT",
      outlineMaskReadbackTarget: "outline-mask (real emissive MRT attachment)",
      shadowAtlasReadbackTarget: "shadow-atlas (real host shadow comparison atlas sampled into RGBA8)",
      shadowAtlasTextureUuid: this.shadowAtlasTexture?.uuid ?? null,
      waterInteractionSource: "same creature-stage driver instances used by visible/culling/shadow paths",
    };
  }

  describePipeline() {
    const weatherMetrics = this.weatherVisualStage.describeMetrics();
    return {
      owners: { ...this.owners },
      signals: [
        { id: "habitat.world-units", producer: this.owners["world-units-and-wind"], identity: WORLD_UNITS_PER_METER },
        { id: "habitat.wind", producer: this.owners["world-units-and-wind"], consumers: ["creature-stage", "dense-vegetation-stage", "bounded-water-stage", "canonical-weather-visual-stage"] },
        { id: "habitat.weather-response", producer: this.owners["weather-state"], consumers: ["rain", "snow", "wet-road", "splash-ring"] },
        { id: "creature.contact-events", producer: this.owners["contact-event-registry"], snapshotSequence: this.contactRegistry.sequence },
        { id: "vegetation.static-spawn-storage", producer: this.owners["vegetation-storage"], immutableHash: this.staticSpawnBaseline.hash },
        { id: "habitat.scene-hdr", producer: this.owners["final-render-pipeline"] },
        { id: "creature.subject-mask", producer: "shared emissive MRT" },
      ],
      sceneSubmissions: [{ id: "habitat-primary-lit-scene", kind: "lit-mrt", count: 1, mrt: MRT_TARGETS }],
      diagnosticSubmissions: [{
        id: "shadow-atlas-capture-refresh",
        count: 1,
        reachableOnlyDuringCaptureTarget: "shadow-atlas",
        productionPerFrame: 0,
      }],
      computeDispatches: [
        { id: "vegetation-static-initialization", owner: this.owners["vegetation-storage"], dispatches: this.vegetationStage.system.patches.length, perFrame: 0 },
        { id: "bounded-water-heightfield", owner: this.owners["bounded-water-state"], ...this.waterStage.describeDispatches() },
        {
          id: "canonical-weather-precipitation-and-impacts",
          owner: this.owners["weather-state"],
          recurrentDispatches: weatherMetrics.recurrentDispatches,
          impactAgeDispatches: weatherMetrics.impactAgeDispatches,
          impactSpawnDispatches: weatherMetrics.impactSpawnDispatches,
          perFrame: {
            impactAge: 1,
            recurrent: this.weatherVisualStage.describeResources().recurrentPerFrame ? 2 : 0,
            impactSpawn: "sparse receiver-approved batches only",
          },
        },
      ],
      resources: this.describeResources(),
      subjectConsistency: this.describeSubjectConsistency(),
      fullLitOutputCount: 1,
      finalToneMapOwner: this.owners["tone-map"],
      finalOutputTransformOwner: this.owners["output-transform"],
      toneMapping: "AgXToneMapping",
      outputColorTransform: this.renderPipeline.outputColorTransform,
    };
  }

  describeResources() {
    const renderTarget = this.scenePass.renderTarget;
    const creature = this.creatureStage.describeResources();
    const vegetationRuntime = this.vegetationStage.system.getStats();
    const water = this.waterStage.describeResources();
    const weather = this.weatherVisualStage.describeResources();
    const shadowWidth = this.shadowStage.light.shadow.mapSize.x;
    const shadowHeight = this.shadowStage.light.shadow.mapSize.y;
    const resources = [];
    const bandwidth = [];
    const addResource = (record) => resources.push(createResourceRecord(record));
    const addBandwidth = (record) => bandwidth.push(createBandwidthRecord(record));

    addResource({
      id: "creature-pose-storage",
      owner: this.owners["creature-state"],
      kind: "storage-buffer",
      bytes: creature.poseStorageBytes,
      label: "Measured",
      source: "allocated pose/root typed-array byteLength sum",
    });
    addResource({
      id: "creature-candidate-storage",
      owner: this.owners["creature-state"],
      kind: "storage-buffer",
      bytes: creature.candidateStorageBytes,
      label: "Measured",
      source: "allocated candidate storage byteLength",
    });
    addResource({
      id: "creature-shell-geometry",
      owner: this.owners["creature-state"],
      kind: "geometry-buffer",
      bytes: geometryByteLength(this.creatureStage.geometry),
      label: "Measured",
      source: "live index and attribute typed-array byteLength sum",
    });
    addResource({
      id: "vegetation-static-storage",
      owner: this.owners["vegetation-storage"],
      kind: "storage-buffer",
      bytes: vegetationRuntime.storageResidentBytes,
      label: "Measured",
      source: "live dense-grass patch storage typed-array byteLength sum",
    });
    addResource({
      id: "vegetation-geometry",
      owner: this.owners["vegetation-storage"],
      kind: "geometry-buffer",
      bytes: uniqueGeometryBytes(this.vegetationStage.system.object),
      label: "Measured",
      source: "unique live dense-grass geometry index/attribute byteLength sum",
    });
    addResource({
      id: "bounded-water-storage",
      owner: this.owners["bounded-water-state"],
      kind: "storage-textures-and-buffers",
      bytes: water.totalBytes,
      label: "Derived",
      source: "canonical bounded-water runtime texture dimensions/formats and storage byteLengths",
    });
    addResource({
      id: "bounded-water-geometry",
      owner: this.owners["bounded-water-state"],
      kind: "geometry-buffer",
      bytes: water.geometryBytes,
      label: "Measured",
      source: "live scaled water mesh geometry byteLength sum",
    });
    for (const record of weather.records) {
      addResource({
        ...record,
        owner: this.owners["weather-state"],
        kind: record.id.includes("geometry") ? "geometry-buffer" : "storage-buffer",
        label: "Measured",
        source: "canonical precipitation/wet/snow live allocation byteLength",
      });
    }
    const mrtBytes = [];
    for (let index = 0; index < renderTarget.textures.length; index += 1) {
      const target = renderTarget.textures[index];
      const bytesPerTexel = target.type === HalfFloatType ? 8 : 4;
      const bytes = textureByteLength(renderTarget.width, renderTarget.height, bytesPerTexel);
      mrtBytes.push(bytes);
      addResource({
        id: `habitat-mrt-${MRT_TARGETS[index] ?? index}`,
        owner: this.owners["final-render-pipeline"],
        kind: "render-target",
        bytes,
        label: "Derived",
        source: `${renderTarget.width}x${renderTarget.height} live attachment at ${bytesPerTexel} bytes/texel`,
      });
    }
    const depthBytes = textureByteLength(renderTarget.width, renderTarget.height, 4);
    addResource({
      id: "habitat-mrt-depth",
      owner: this.owners["final-render-pipeline"],
      kind: "depth-texture",
      bytes: depthBytes,
      label: "Derived",
      source: `${renderTarget.width}x${renderTarget.height} depth attachment at 4 bytes/texel`,
    });
    const shadowBytes = textureByteLength(shadowWidth, shadowHeight, 4);
    addResource({
      id: "host-directional-shadow-atlas",
      owner: this.owners["shadow-maps"],
      kind: "comparison-texture",
      bytes: shadowBytes,
      label: "Derived",
      source: `${shadowWidth}x${shadowHeight} live tier shadow target at 4 bytes/texel`,
    });
    if (this.captureTarget) {
      addResource({
        id: "validation-rgba8-capture-target",
        owner: this.owners["final-render-pipeline"],
        kind: "render-target",
        bytes: textureByteLength(this.captureTarget.width, this.captureTarget.height, 4),
        label: "Derived",
        source: "live capture target dimensions at 4 bytes/texel",
      });
    }
    const rgba8RowBytes = renderTarget.width * 4;
    const alignedRgba8Stride = Math.ceil(rgba8RowBytes / 256) * 256;
    const derivedReadbackBytes = alignedRgba8Stride * (renderTarget.height - 1) + rgba8RowBytes;
    addResource({
      id: "validation-readback-staging-payload",
      owner: "threejs-visual-validation",
      kind: "readback-staging",
      lifetime: "transient",
      bytes: this.lastReadbackBytes > 0 ? this.lastReadbackBytes : derivedReadbackBytes,
      label: this.lastReadbackBytes > 0 ? "Measured" : "Derived",
      source: this.lastReadbackBytes > 0
        ? "last mapped typed-array byteLength including WebGPU row padding"
        : "current viewport RGBA8 short-padded readback layout at 256-byte row alignment",
    });

    const sceneWriteBytes = mrtBytes.reduce((sum, bytes) => sum + bytes, depthBytes);
    addBandwidth({
      id: "primary-mrt-and-depth-writes",
      owner: this.owners["final-render-pipeline"],
      bytesPerFrame: sceneWriteBytes,
      label: "Derived",
      source: "one lower-bound write of every live MRT/depth texel per frame",
    });
    addBandwidth({
      id: "host-shadow-atlas-write",
      owner: this.owners["shadow-maps"],
      bytesPerFrame: shadowBytes,
      label: "Derived",
      source: "one lower-bound tier shadow-atlas write per rendered frame",
    });
    addBandwidth({
      id: "creature-pose-dirty-upload",
      owner: this.owners["creature-state"],
      bytesPerFrame: Math.max(0, Math.floor(creature.lastUpload?.bytes ?? 0)),
      label: "Measured",
      source: "last live pose storage dirty upload range",
    });
    const waterSteps = this.waterStage.describeDispatches().lastStepCount;
    addBandwidth({
      id: "bounded-water-state-ping-pong-minimum",
      owner: this.owners["bounded-water-state"],
      bytesPerFrame: textureByteLength(this.waterStage.resolution, this.waterStage.resolution, 16) * waterSteps,
      label: "Derived",
      source: "per fixed step minimum one RGBA16F read plus one RGBA16F write; excludes caustic intermediates",
    });
    const weatherEventBytes = weather.records
      .filter((record) => record.id === "weather-impact-ring")
      .reduce((sum, record) => sum + record.bytes, 0);
    const recurrentBytes = weather.recurrentPerFrame
      ? weather.records
        .filter((record) => record.id.includes("recurrent"))
        .reduce((sum, record) => sum + record.bytes, 0)
      : 0;
    addBandwidth({
      id: "canonical-weather-storage-writes-minimum",
      owner: this.owners["weather-state"],
      bytesPerFrame: weatherEventBytes + recurrentBytes,
      label: "Derived",
      source: "impact aging plus enabled recurrent precipitation storage writes; excludes reads and sparse spawn uploads",
    });
    const ledger = reconcileResourceLedger({ resources, bandwidth });
    return {
      worldUnitsPerMeter: WORLD_UNITS_PER_METER,
      tierPolicy: {
        id: this.tier,
        sceneScale: this.scenePass.getResolutionScale(),
        waterScale: this.waterStage.waterScale,
        waterResolution: this.waterStage.resolution,
        waterMeshSegments: this.waterStage.meshSegments,
      },
      creature,
      vegetation: {
        runtime: vegetationRuntime,
        immutableSpawnStorage: this.staticSpawnBaseline,
      },
      water,
      weather,
      contacts: this.contactRegistry.describe(),
      shadows: {
        owner: this.owners["shadow-maps"],
        mapWidth: shadowWidth,
        mapHeight: shadowHeight,
        lightCount: 1,
        actualAtlasTextureUuid: this.shadowAtlasTexture?.uuid ?? null,
      },
      renderTargets: renderTarget.textures.map((texture, index) => ({
        id: MRT_TARGETS[index] ?? texture.name ?? `attachment-${index}`,
        width: renderTarget.width,
        height: renderTarget.height,
        type: texture.type,
        format: texture.format,
      })),
      depth: {
        id: renderTarget.depthTexture?.name || "habitat-primary-depth",
        width: renderTarget.width,
        height: renderTarget.height,
      },
      ledger,
    };
  }

  getMetrics() {
    const governor = this.qualityGovernor.describe();
    const measuredP95 = this.measuredGpuFrameMs.length > 0
      ? computeGpuP95(this.measuredGpuFrameMs)
      : null;
    return {
      labId: this.labId,
      status: "native-webgpu-runtime; acceptance incomplete pending evidence",
      rendererBackend: this.renderer.backend?.isWebGPUBackend === true ? "WebGPU" : "unsupported",
      threeRevision: REVISION,
      tier: this.tier,
      mechanism: this.mechanism,
      mode: this.mode,
      camera: this.cameraId,
      seed: this.seed,
      timeSeconds: this.timeSeconds,
      frameIndex: this.frameIndex,
      stageGeneration: this.stageGeneration,
      activeCreatures: this.creatureStage.instances.length,
      visibleCreatures: this.creatureStage.mesh.count,
      contacts: this.contactRegistry.describe(),
      waterEventsCoalesced: this.coalescedWaterEvents,
      immutableSpawnAudit: {
        baseline: this.staticSpawnBaseline,
        checkedAfterContact: this.storageAuditedAfterContact,
      },
      shadowParity: this.describeSubjectConsistency(),
      rendererInfo: this.renderer.info,
      gpuTiming: this.lastGpuTiming,
      qualityGovernor: {
        ...governor,
        routeLocked: this.tierLocked,
        enabled: !this.tierLocked,
        applicationTrace: [...this.qualityApplicationTrace],
      },
      currentAdapterPerformance: governor.evaluatedWindowCount > 0
        ? {
          verdict: "INSUFFICIENT_EVIDENCE",
          reason: "sustained runtime timestamps exist but no accepted v2 performance bundle has been captured",
          sampleCount: this.measuredGpuFrameMs.length,
          rollingP95Ms: measuredP95,
        }
        : "INSUFFICIENT_EVIDENCE",
      executedTierPolicy: {
        sceneScale: this.scenePass.getResolutionScale(),
        waterScale: this.waterStage.waterScale,
        waterResolution: this.waterStage.resolution,
        waterMeshSegments: this.waterStage.meshSegments,
      },
      weatherVisuals: this.weatherVisualStage.describeMetrics(),
      lastResetCause: this.lastResetCause,
      routeSelection: {
        scenario: this.scenario,
        mechanism: this.mechanism,
        tier: this.tier,
      },
    };
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer?.setAnimationLoop(null);
    await this.disposeStages();
    if (this.camera && this.cameraInitialState) restoreCameraState(this.camera, this.cameraInitialState);
    if (this.contactDebug) {
      this.scene.remove(this.contactDebug);
      this.contactDebug.geometry.dispose();
      this.contactDebug.material.dispose();
    }
    if (this.cullingDebug) {
      this.scene.remove(this.cullingDebug);
      this.cullingDebug.geometry.dispose();
      this.cullingDebug.material.dispose();
    }
    if (this.sceneObjects) {
      this.scene.remove(this.sceneObjects.ground, this.sceneObjects.ambient);
      this.sceneObjects.groundGeometry.dispose();
      this.sceneObjects.groundMaterial.dispose();
    }
    this.shadowStage?.dispose();
    this.captureTarget?.dispose();
    this.scenePass?.dispose?.();
    this.renderPipeline?.dispose?.();
    this.renderer?.dispose();
  }
}

export async function createHabitatController(options) {
  const controller = new HabitatController(options);
  await controller.ready();
  return controller;
}
