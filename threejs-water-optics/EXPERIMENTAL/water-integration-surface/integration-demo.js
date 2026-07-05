import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { float } from "three/tsl";
import {
  DEFAULT_WATER_PARAMETERS,
  WATER_QUALITY_TIERS,
  createBoundedWaterHeightQuery,
  createWebGPUBoundedWaterSystem,
  seededDropSequence,
  waterStorageBytes,
} from "../../examples/webgpu-bounded-water/index.js";

const STEP_SIZE = 1 / 60;
const MAX_BUOYANCY_SAMPLES = 128;
const tmpVec3A = new Vector3();
const tmpVec3B = new Vector3();

const PRESETS = Object.freeze({
  calmHarbor: {
    label: "calm harbor",
    parameters: {
      worldSize: new Vector2(18, 18),
      damping: 0.997,
      waveSpeed: 1.2,
      dropStrength: 0.045,
      objectDisplacementScale: 0.25,
      refractionStrength: 0.055,
      roughness: 0.36,
      absorptionPerMeter: new Vector3(0.14, 0.045, 0.018),
      deepBodyColor: new Vector3(0.006, 0.05, 0.10),
      shallowScatterColor: new Vector3(0.02, 0.28, 0.22),
      sunDirection: new Vector3(0.4, 1.8, -0.7).normalize(),
    },
    spray: { velocityThreshold: 1.15, size: 1.4 },
    sky: new Color(0x9bc7d5),
  },
  tropicalCoast: {
    label: "tropical coast",
    parameters: {
      worldSize: new Vector2(24, 24),
      damping: 0.994,
      waveSpeed: 1.8,
      dropStrength: 0.08,
      objectDisplacementScale: 0.42,
      refractionStrength: 0.09,
      roughness: 0.22,
      absorptionPerMeter: new Vector3(0.18, 0.055, 0.018),
      deepBodyColor: new Vector3(0.0, 0.06, 0.13),
      shallowScatterColor: new Vector3(0.0, 0.36, 0.25),
      sunDirection: new Vector3(1.1, 1.7, -0.5).normalize(),
    },
    spray: { velocityThreshold: 1.45, size: 1.9 },
    sky: new Color(0x8ec9ef),
  },
  storm: {
    label: "storm",
    parameters: {
      worldSize: new Vector2(28, 28),
      damping: 0.989,
      waveSpeed: 2.4,
      dropStrength: 0.14,
      objectDisplacementScale: 0.72,
      refractionStrength: 0.13,
      roughness: 0.42,
      absorptionPerMeter: new Vector3(0.27, 0.08, 0.025),
      deepBodyColor: new Vector3(0.004, 0.025, 0.055),
      shallowScatterColor: new Vector3(0.02, 0.12, 0.11),
      sunDirection: new Vector3(-0.7, 1.2, -0.9).normalize(),
    },
    spray: { velocityThreshold: 1.0, size: 2.8 },
    sky: new Color(0x536a78),
  },
  moonlit: {
    label: "moonlit",
    parameters: {
      worldSize: new Vector2(22, 22),
      damping: 0.996,
      waveSpeed: 1.55,
      dropStrength: 0.055,
      objectDisplacementScale: 0.32,
      refractionStrength: 0.07,
      roughness: 0.28,
      absorptionPerMeter: new Vector3(0.16, 0.045, 0.018),
      deepBodyColor: new Vector3(0.004, 0.025, 0.075),
      shallowScatterColor: new Vector3(0.025, 0.13, 0.20),
      sunDirection: new Vector3(-0.35, 1.6, 0.4).normalize(),
    },
    spray: { velocityThreshold: 1.3, size: 1.5 },
    sky: new Color(0x1b2640),
  },
});

function mergeWaterParameters(preset) {
  return {
    ...DEFAULT_WATER_PARAMETERS,
    ...preset.parameters,
    worldSize: preset.parameters.worldSize.clone(),
    absorptionPerMeter: preset.parameters.absorptionPerMeter.clone(),
    deepBodyColor: preset.parameters.deepBodyColor.clone(),
    shallowScatterColor: preset.parameters.shallowScatterColor.clone(),
    sunDirection: preset.parameters.sunDirection.clone(),
  };
}

function makeNodeStandardMaterial({ color, roughness = 0.7, metalness = 0.0, transparent = false, opacity = 1.0 }) {
  const material = new MeshStandardNodeMaterial({
    color,
    roughness,
    metalness,
    transparent,
    opacity,
    depthWrite: !transparent,
  });
  material.colorNode = null;
  return material;
}

function createPlumeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(64, 82, 4, 64, 70, 58);
  gradient.addColorStop(0.0, "rgba(255,255,255,0.92)");
  gradient.addColorStop(0.28, "rgba(216,245,255,0.62)");
  gradient.addColorStop(0.68, "rgba(158,220,240,0.20)");
  gradient.addColorStop(1.0, "rgba(158,220,240,0.0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  for (let i = 0; i < 34; i += 1) {
    const angle = (i * 12.9898) % (Math.PI * 2);
    const radius = 10 + ((i * 37) % 42);
    const x = 64 + Math.cos(angle) * radius * 0.65;
    const y = 78 + Math.sin(angle) * radius;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + (i % 5) * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.name = "experimental-procedural-spray-plume";
  return texture;
}

class DeterministicWaterClock {
  constructor({ stepSize = STEP_SIZE, deterministic = true } = {}) {
    this.stepSize = stepSize;
    this.deterministic = deterministic;
    this.tick = 0;
    this.elapsed = 0;
    this.accumulator = 0;
  }

  step(deltaSeconds, callback) {
    if (!this.deterministic) {
      this.elapsed += deltaSeconds;
      callback(deltaSeconds, this.elapsed, this.tick);
      return 1;
    }

    this.accumulator = Math.min(this.accumulator + deltaSeconds, this.stepSize * 4);
    let steps = 0;
    while (this.accumulator >= this.stepSize && steps < 4) {
      this.tick += 1;
      this.elapsed = this.tick * this.stepSize;
      callback(this.stepSize, this.elapsed, this.tick);
      this.accumulator -= this.stepSize;
      steps += 1;
    }
    return steps;
  }

  syncToTick(tick) {
    if (!Number.isFinite(tick) || Math.floor(tick) !== tick) {
      throw new Error(`syncToTick requires an integer tick, got ${tick}.`);
    }
    this.tick = tick;
    this.elapsed = tick * this.stepSize;
    this.accumulator = 0;
  }
}

class HostBuoyancySystem {
  constructor({ waterHeightQuery, waterSystem, scene, opaqueScene }) {
    this.waterHeightQuery = waterHeightQuery;
    this.waterSystem = waterSystem;
    this.scene = scene;
    this.opaqueScene = opaqueScene;
    this.objects = [];
    this.totalSamplePoints = 0;
    this.impulsesSubmitted = 0;
    this.maxSamples = MAX_BUOYANCY_SAMPLES;
  }

  addObject(mesh, {
    opaqueCopy = null,
    samplePoints = [new Vector3(0, 0, 0)],
    rideHeight = 0.15,
    stiffness = 0.18,
    impulseRadius = 0.65,
    impulseStrength = 0.45,
  } = {}) {
    if (this.totalSamplePoints + samplePoints.length > this.maxSamples) {
      throw new Error(`Buoyancy sample budget exceeded: ${this.totalSamplePoints + samplePoints.length} > ${this.maxSamples}.`);
    }
    this.scene.add(mesh);
    if (opaqueCopy) {
      this.opaqueScene.add(opaqueCopy);
    }
    const record = {
      mesh,
      opaqueCopy,
      samplePoints,
      rideHeight,
      stiffness,
      impulseRadius,
      impulseStrength,
      previousCenter: mesh.position.clone(),
      sampleHeights: new Array(samplePoints.length).fill(0),
    };
    this.objects.push(record);
    this.totalSamplePoints += samplePoints.length;
    return record;
  }

  update(timeSeconds) {
    for (const object of this.objects) {
      let heightSum = 0;
      let frontHeight = 0;
      let rearHeight = 0;
      let leftHeight = 0;
      let rightHeight = 0;

      object.mesh.updateMatrixWorld();
      for (let i = 0; i < object.samplePoints.length; i += 1) {
        tmpVec3A.copy(object.samplePoints[i]).applyMatrix4(object.mesh.matrixWorld);
        const height = this.waterHeightQuery.getWaterHeight(tmpVec3A.x, tmpVec3A.z, timeSeconds);
        object.sampleHeights[i] = height;
        heightSum += height;
        if (object.samplePoints[i].z < -0.1) frontHeight += height;
        if (object.samplePoints[i].z > 0.1) rearHeight += height;
        if (object.samplePoints[i].x < -0.1) leftHeight += height;
        if (object.samplePoints[i].x > 0.1) rightHeight += height;
      }

      const targetY = heightSum / object.samplePoints.length + object.rideHeight;
      object.mesh.position.y = MathUtils.lerp(object.mesh.position.y, targetY, object.stiffness);
      const pitch = MathUtils.clamp((rearHeight - frontHeight) * 0.12, -0.22, 0.22);
      const roll = MathUtils.clamp((rightHeight - leftHeight) * 0.10, -0.20, 0.20);
      object.mesh.rotation.x = MathUtils.lerp(object.mesh.rotation.x, pitch, 0.08);
      object.mesh.rotation.z = MathUtils.lerp(object.mesh.rotation.z, roll, 0.08);

      if (object.opaqueCopy) {
        object.opaqueCopy.position.copy(object.mesh.position);
        object.opaqueCopy.rotation.copy(object.mesh.rotation);
        object.opaqueCopy.scale.copy(object.mesh.scale);
      }

      if (object.previousCenter.distanceToSquared(object.mesh.position) > 0.0001) {
        this.waterSystem.heightfield.setObjectImpulse({
          oldCenter: object.previousCenter,
          newCenter: object.mesh.position,
          radius: object.impulseRadius,
          strength: object.impulseStrength,
        });
        this.impulsesSubmitted += 1;
      }
      object.previousCenter.copy(object.mesh.position);
    }
  }
}

class HostSpraySystem {
  constructor({ scene, waterHeightQuery, texture }) {
    this.scene = scene;
    this.waterHeightQuery = waterHeightQuery;
    this.texture = texture;
    this.emitters = [];
    this.plumes = [];
    this.velocityThreshold = 1.25;
    this.duration = 1.35;
    this.fadeOutTime = 0.45;
    this.size = 1.7;
    this.events = 0;
  }

  addEmitter(object, { probes, velocityThreshold = this.velocityThreshold, size = this.size } = {}) {
    const emitter = {
      object,
      velocityThreshold,
      size,
      probes: probes.map((probe) => ({
        local: probe.local.clone(),
        enabled: probe.enabled !== false,
        previousSignedDistance: null,
        cooldown: 0,
      })),
    };
    this.emitters.push(emitter);
    return emitter;
  }

  spawn(position, speed, size) {
    const material = new SpriteNodeMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const plume = new Sprite(material);
    plume.position.copy(position);
    plume.position.y += 0.18;
    const scale = size * MathUtils.clamp(speed / this.velocityThreshold, 0.75, 2.0);
    plume.scale.set(scale * 0.8, scale * 1.35, 1);
    plume.userData.age = 0;
    plume.userData.duration = this.duration;
    this.scene.add(plume);
    this.plumes.push(plume);
    this.events += 1;
  }

  update(deltaSeconds, timeSeconds) {
    for (const emitter of this.emitters) {
      emitter.object.updateMatrixWorld();
      for (const probe of emitter.probes) {
        if (!probe.enabled) continue;
        probe.cooldown = Math.max(0, probe.cooldown - deltaSeconds);
        tmpVec3A.copy(probe.local).applyMatrix4(emitter.object.matrixWorld);
        const surface = this.waterHeightQuery.getWaterHeight(tmpVec3A.x, tmpVec3A.z, timeSeconds);
        const signedDistance = tmpVec3A.y - surface;
        if (probe.previousSignedDistance !== null && probe.cooldown === 0) {
          const speed = Math.abs(signedDistance - probe.previousSignedDistance) / Math.max(deltaSeconds, 1e-5);
          const crossed = signedDistance <= 0 && probe.previousSignedDistance > 0;
          if (crossed && speed >= emitter.velocityThreshold) {
            tmpVec3B.copy(tmpVec3A);
            tmpVec3B.y = surface;
            this.spawn(tmpVec3B, speed, emitter.size);
            probe.cooldown = 0.9;
          }
        }
        probe.previousSignedDistance = signedDistance;
      }
    }

    for (let i = this.plumes.length - 1; i >= 0; i -= 1) {
      const plume = this.plumes[i];
      plume.userData.age += deltaSeconds;
      const remaining = plume.userData.duration - plume.userData.age;
      plume.position.y += deltaSeconds * 0.42;
      plume.material.opacity = MathUtils.clamp(remaining / this.fadeOutTime, 0, 0.72);
      plume.scale.multiplyScalar(1 + deltaSeconds * 0.18);
      if (remaining <= 0) {
        this.scene.remove(plume);
        plume.material.dispose();
        this.plumes.splice(i, 1);
      }
    }
  }
}

class HostMaskRegistry {
  constructor() {
    this.masks = new Set();
    this.screenSpaceMaskTexture = null;
  }

  add(maskMesh) {
    maskMesh.visible = false;
    this.masks.add(maskMesh);
    return maskMesh;
  }

  remove(maskMesh) {
    this.masks.delete(maskMesh);
  }

  get contract() {
    return {
      registeredMasks: this.masks.size,
      screenSpaceMaskTexture: this.screenSpaceMaskTexture !== null,
      finding: "current skill needs a first-class mask pass contract before host masks can clip water fragments",
    };
  }
}

function createOpaquePair(geometry, material, position) {
  const mesh = new Mesh(geometry, material);
  mesh.position.copy(position);
  const copy = new Mesh(geometry, material);
  copy.position.copy(position);
  return { mesh, copy };
}

function createSceneObjects({ scene, opaqueScene, maskRegistry }) {
  const sand = makeNodeStandardMaterial({ color: 0x8c9078, roughness: 0.9 });
  const rock = makeNodeStandardMaterial({ color: 0x515d5f, roughness: 0.86 });
  const marker = new MeshBasicNodeMaterial({ color: 0x0b1518, transparent: true, opacity: 0.35, side: DoubleSide });

  const floorGeometry = new PlaneGeometry(90, 90, 1, 1);
  floorGeometry.rotateX(-Math.PI / 2);
  const floor = new Mesh(floorGeometry, sand);
  floor.position.y = -1.4;
  scene.add(floor);
  opaqueScene.add(floor.clone());

  for (let i = 0; i < 9; i += 1) {
    const angle = i * 1.9;
    const radius = 8 + (i % 3) * 2.3;
    const geometry = new SphereGeometry(0.55 + (i % 4) * 0.16, 18, 10);
    const { mesh, copy } = createOpaquePair(geometry, rock, new Vector3(Math.cos(angle) * radius, -0.82, Math.sin(angle) * radius));
    mesh.scale.y = 0.45 + (i % 2) * 0.28;
    copy.scale.copy(mesh.scale);
    scene.add(mesh);
    opaqueScene.add(copy);
  }

  const maskGeometry = new BoxGeometry(2.6, 0.9, 1.15);
  const hullMask = new Mesh(maskGeometry, marker);
  hullMask.name = "experimental-hull-interior-water-mask";
  maskRegistry.add(hullMask);
  return { hullMask };
}

async function createExperiment() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("headless") === "1") document.body.classList.add("headless");

  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  await renderer.init();

  if (renderer.backend?.isWebGPUBackend !== true) {
    throw new Error("WebGPU backend required for the experimental water integration surface.");
  }

  const scene = new Scene();
  const opaqueScene = new Scene();
  const camera = new PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 160);
  camera.position.set(8.5, 4.8, 9.2);
  camera.lookAt(0, 0, 0);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);

  const sun = new DirectionalLight(0xffffff, 2.3);
  sun.position.set(5, 8, -4);
  scene.add(sun);
  scene.add(new AmbientLight(0xa8cbd3, 0.9));
  opaqueScene.add(sun.clone());
  opaqueScene.add(new AmbientLight(0xa8cbd3, 0.9));

  const timeNode = float(0);
  const waterHeightQuery = createBoundedWaterHeightQuery();
  const maskRegistry = new HostMaskRegistry();
  const hostObjects = createSceneObjects({ scene, opaqueScene, maskRegistry });
  let presetName = "tropicalCoast";
  let quality = "high";
  let water = null;
  let buoyancy = null;
  let spray = null;
  let boat = null;
  let transparentProbe = null;
  const clock = new DeterministicWaterClock();
  const plumeTexture = createPlumeTexture();
  const captureTarget = new RenderTarget(640, 400, {
    samples: 1,
    type: UnsignedByteType,
  });
  captureTarget.texture.colorSpace = SRGBColorSpace;
  renderer.initRenderTarget?.(captureTarget);
  const drops = seededDropSequence(180185, 16, { radius: 0.1, strength: 0.08 });
  let dropCursor = 0;

  function applyEnvironment() {
    const preset = PRESETS[presetName];
    scene.background = preset.sky;
    opaqueScene.background = preset.sky;
  }

  async function rebuildWater() {
    const previous = water;
    if (previous) {
      scene.remove(previous.mesh);
      previous.dispose();
    }
    applyEnvironment();
    water = await createWebGPUBoundedWaterSystem(renderer, {
      tier: quality,
      seed: 180185,
      camera,
      timeNode,
      sceneColorScene: opaqueScene,
      parameters: mergeWaterParameters(PRESETS[presetName]),
    });
    water.mesh.renderOrder = 10;
    scene.add(water.mesh);
    if (boat) {
      buoyancy.waterSystem = water;
    }
  }

  await rebuildWater();

  const hullMaterial = makeNodeStandardMaterial({ color: 0x9b4a2d, roughness: 0.62 });
  const hullGeometry = new BoxGeometry(2.8, 0.42, 1.08);
  const { mesh: hull, copy: hullCopy } = createOpaquePair(hullGeometry, hullMaterial, new Vector3(-1.2, 0.35, -0.4));
  hull.name = "host-floating-boat";
  hullCopy.name = "host-floating-boat-depth-copy";
  boat = hull;
  hostObjects.hullMask.position.copy(hull.position);
  hull.add(hostObjects.hullMask);

  const buoyMaterial = makeNodeStandardMaterial({ color: 0xf0d36a, roughness: 0.38 });
  const buoyGeometry = new SphereGeometry(0.28, 24, 16);
  const buoy = new Mesh(buoyGeometry, buoyMaterial);
  buoy.position.set(2.9, 0.2, 1.4);
  const buoyCopy = new Mesh(buoyGeometry, buoyMaterial);
  buoyCopy.position.copy(buoy.position);

  buoyancy = new HostBuoyancySystem({ waterHeightQuery, waterSystem: water, scene, opaqueScene });
  buoyancy.addObject(hull, {
    opaqueCopy: hullCopy,
    samplePoints: [
      new Vector3(0, 0, 0),
      new Vector3(-1.1, 0, -0.42),
      new Vector3(1.1, 0, -0.42),
      new Vector3(-1.1, 0, 0.42),
      new Vector3(1.1, 0, 0.42),
    ],
    rideHeight: 0.27,
    impulseRadius: 0.62,
    impulseStrength: PRESETS[presetName].parameters.objectDisplacementScale,
  });
  buoyancy.addObject(buoy, {
    opaqueCopy: buoyCopy,
    samplePoints: [new Vector3(0, 0, 0)],
    rideHeight: 0.1,
    impulseRadius: 0.28,
    impulseStrength: 0.18,
  });

  const glassMaterial = makeNodeStandardMaterial({ color: 0xbcecff, roughness: 0.05, transparent: true, opacity: 0.36 });
  const glass = new Mesh(new BoxGeometry(0.9, 1.8, 0.08), glassMaterial);
  glass.name = "host-transparent-object-after-water";
  glass.position.set(0.95, 0.35, -1.05);
  glass.rotation.y = -0.35;
  glass.renderOrder = 20;
  scene.add(glass);
  transparentProbe = glass;

  spray = new HostSpraySystem({ scene, waterHeightQuery, texture: plumeTexture });
  spray.velocityThreshold = PRESETS[presetName].spray.velocityThreshold;
  spray.size = PRESETS[presetName].spray.size;
  spray.addEmitter(hull, {
    velocityThreshold: spray.velocityThreshold,
    size: spray.size,
    probes: [
      { local: new Vector3(0, -0.26, -0.68) },
      { local: new Vector3(-1.25, -0.24, -0.48) },
      { local: new Vector3(1.25, -0.24, -0.48) },
      { local: new Vector3(-1.25, -0.24, 0.48) },
      { local: new Vector3(1.25, -0.24, 0.48) },
    ],
  });

  function issueDrop() {
    const next = drops[dropCursor % drops.length];
    dropCursor += 1;
    water.heightfield.setDrop(next);
    return next;
  }

  function updateFixed(deltaSeconds, timeSeconds, tick) {
    timeNode.value = timeSeconds;
    if (tick % 140 === 20) issueDrop();
    const orbit = timeSeconds * 0.45;
    hull.position.x = Math.cos(orbit) * 1.3 - 0.5;
    hull.position.z = Math.sin(orbit * 0.8) * 1.1 - 0.2;
    buoy.position.x = Math.sin(timeSeconds * 0.7) * 2.6;
    buoy.position.z = 1.4 + Math.cos(timeSeconds * 0.53) * 0.7;
    hostObjects.hullMask.position.set(0, 0.18, 0);
    buoyancy.update(timeSeconds);
    spray.update(deltaSeconds, timeSeconds);
    water.update(deltaSeconds);
  }

  function renderOnce() {
    controls.update();
    water.pipeline?.render();
    renderer.render(scene, camera);
    updateHud();
  }

  async function captureReadback({ width = 640, height = 400 } = {}) {
    captureTarget.setSize(width, height);
    controls.update();
    water.pipeline?.render();
    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(captureTarget);
    renderer.render(scene, camera);
    const pixels = await renderer.readRenderTargetPixelsAsync(captureTarget, 0, 0, width, height);
    renderer.setRenderTarget(previousTarget);
    renderOnce();
    return {
      width,
      height,
      pixels: Array.from(pixels),
      byteLength: pixels.length,
    };
  }

  function frame() {
    const delta = Math.min(1 / 30, renderer.info.render.frame === 0 ? STEP_SIZE : 1 / 60);
    clock.step(delta, updateFixed);
    renderOnce();
    window.__waterIntegrationDemo.animationFrame = requestAnimationFrame(frame);
  }

  const metricIds = {
    backend: document.getElementById("metric-backend"),
    tick: document.getElementById("metric-tick"),
    buoyancy: document.getElementById("metric-buoyancy"),
    spray: document.getElementById("metric-spray"),
    mask: document.getElementById("metric-mask"),
    ordering: document.getElementById("metric-ordering"),
  };

  function contractSnapshot() {
    const tier = WATER_QUALITY_TIERS[quality];
    return {
      backend: {
        renderer: "WebGPURenderer",
        isWebGPUBackend: renderer.backend?.isWebGPUBackend === true,
        threeRevision: "185",
      },
      integrationFocus: "host project owns scene, camera, controls, opaque depth scene, transparent pass, masks, post stack, buoyancy consumers, and networking tick",
      preset: {
        active: presetName,
        names: Object.keys(PRESETS),
        mapsToWaterParameters: true,
        mapsToSkySeparately: true,
      },
      quality: {
        active: quality,
        resolution: tier.resolution,
        fixedTimeStep: tier.fixedTimeStep,
        maxSubsteps: tier.maxSubsteps,
        storageBytes: waterStorageBytes(tier.resolution, 3),
      },
      buoyancy: {
        objects: buoyancy.objects.length,
        samplePointsTotal: buoyancy.totalSamplePoints,
        maxSamplePoints: MAX_BUOYANCY_SAMPLES,
        mode: "host-side analytic sampling, no GPU readback",
        impulsesSubmitted: buoyancy.impulsesSubmitted,
        residualBound: waterHeightQuery.estimateHeightfieldResidualBound(),
      },
      spray: {
        emitters: spray.emitters.length,
        probes: spray.emitters.reduce((sum, emitter) => sum + emitter.probes.length, 0),
        events: spray.events,
        livePlumes: spray.plumes.length,
        velocityThreshold: spray.velocityThreshold,
      },
      masking: maskRegistry.contract,
      transparent: {
        objectName: transparentProbe.name,
        renderOrder: transparentProbe.renderOrder,
        participatesInOpaqueDepthScene: opaqueScene.getObjectByName(transparentProbe.name) !== undefined,
        policy: "transparent host objects render after water and are excluded from water refraction depth",
      },
      postProcessing: {
        order: ["opaque scene/depth prepass", "water material refraction", "main host render", "anti-aliasing", "bloom/color grade"],
        implementedHere: "prepass plus main host render; post effects remain host-owned",
      },
      deterministic: {
        enabled: clock.deterministic,
        tick: clock.tick,
        stepSize: clock.stepSize,
        syncToTick: true,
      },
    };
  }

  function updateHud() {
    const snapshot = contractSnapshot();
    metricIds.backend.textContent = snapshot.backend.isWebGPUBackend ? "WebGPU" : "blocked";
    metricIds.tick.textContent = `${snapshot.deterministic.tick} @ ${snapshot.deterministic.stepSize.toFixed(4)}s`;
    metricIds.buoyancy.textContent = `${snapshot.buoyancy.samplePointsTotal}/${snapshot.buoyancy.maxSamplePoints} samples`;
    metricIds.spray.textContent = `${snapshot.spray.events} events, ${snapshot.spray.livePlumes} live`;
    metricIds.mask.textContent = snapshot.masking.screenSpaceMaskTexture ? "mask pass" : "registry only";
    metricIds.ordering.textContent = snapshot.transparent.participatesInOpaqueDepthScene ? "bad depth" : "transparent after";
  }

  async function setPreset(nextPreset) {
    presetName = nextPreset;
    spray.velocityThreshold = PRESETS[presetName].spray.velocityThreshold;
    spray.size = PRESETS[presetName].spray.size;
    await rebuildWater();
  }

  async function setQuality(nextQuality) {
    quality = nextQuality;
    await rebuildWater();
  }

  async function runValidationSequence() {
    for (let i = 0; i < 220; i += 1) {
      if (i === 8 || i === 64 || i === 128) issueDrop();
      clock.step(STEP_SIZE, updateFixed);
    }
    const beforeSync = contractSnapshot();
    clock.syncToTick(960);
    clock.step(STEP_SIZE, updateFixed);
    const afterSync = contractSnapshot();
    return {
      beforeSync,
      afterSync,
      checks: {
        webgpu: beforeSync.backend.isWebGPUBackend,
        presetCount: beforeSync.preset.names.length,
        sampleBudget: beforeSync.buoyancy.samplePointsTotal <= MAX_BUOYANCY_SAMPLES,
        objectImpulses: beforeSync.buoyancy.impulsesSubmitted > 0,
        sprayObserved: beforeSync.spray.events > 0 || afterSync.spray.events > 0,
        transparentExcludedFromDepth: beforeSync.transparent.participatesInOpaqueDepthScene === false,
        maskGapRecorded: beforeSync.masking.registeredMasks > 0 && beforeSync.masking.screenSpaceMaskTexture === false,
        deterministicSync: afterSync.deterministic.tick === 961,
      },
    };
  }

  const presetSelect = document.getElementById("preset-select");
  for (const [name, preset] of Object.entries(PRESETS)) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = preset.label;
    option.selected = name === presetName;
    presetSelect.append(option);
  }
  presetSelect.addEventListener("change", () => setPreset(presetSelect.value));
  document.getElementById("quality-select").addEventListener("change", (event) => setQuality(event.target.value));
  document.getElementById("drop-button").addEventListener("click", issueDrop);
  document.getElementById("sync-button").addEventListener("click", () => clock.syncToTick(clock.tick + 120));
  document.getElementById("storm-button").addEventListener("click", () => {
    presetSelect.value = "storm";
    setPreset("storm");
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  window.__waterIntegrationDemo = {
    ready: true,
    renderer,
    scene,
    opaqueScene,
    camera,
    water,
    getContractSnapshot: contractSnapshot,
    runValidationSequence,
    renderOnce,
    captureReadback,
    setPreset,
    setQuality,
    issueDrop,
    syncToTick: (tick) => clock.syncToTick(tick),
  };

  frame();
}

createExperiment().catch((error) => {
  console.error(error);
  window.__waterIntegrationDemo = {
    ready: false,
    error: error.message,
  };
});
