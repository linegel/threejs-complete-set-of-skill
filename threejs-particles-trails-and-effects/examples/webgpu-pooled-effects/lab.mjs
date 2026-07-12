import {
  AgXToneMapping,
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardNodeMaterial,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  UnsignedByteType,
  WebGPURenderer,
  RenderPipeline,
} from "three/webgpu";
import {
  emissive,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

import { EFFECT_TIERS } from "./effect-pool.js";
import { createReentryEffectVisuals } from "./effect-visuals.js";
import {
  GPUCompactionEffectPool,
  integrateLinearDragExact,
  validateCompactionReadback,
} from "./gpu-compaction-pool.js";

export const PARTICLE_SCENARIOS = Object.freeze([
  "reentry-shell-and-wake",
  "impact-sparks",
  "debris-dissolve",
  "gpu-pool-and-compaction",
  "indirect-draws",
  "hdr-emissive-and-depth",
  "tier-benchmark",
]);

export const PARTICLE_MODES = Object.freeze([
  "final",
  "no-post",
  "raw-emissive",
  "bloom-only",
  "normal",
]);

export const PARTICLE_TIERS = Object.freeze(["ultra", "high", "medium"]);
export const POOLED_EFFECTS_LAB_ID = "webgpu-pooled-effects";

export const POOLED_EFFECT_MECHANISM_CLAIMS = Object.freeze([
  "gpuPoolCompaction",
  "stableIdentityFreeList",
  "indirectCountPublication",
  "indirectDrawConsumption",
  "hullConformity",
  "debrisDissolveShadowParity",
  "softDepthOcclusion",
  "emissiveIsolation",
]);

const INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE";

function requireMember(value, members, kind) {
  if (!members.includes(value)) throw new RangeError(`Unknown ${kind}: ${value}`);
  return value;
}

function proofVerdict(value) {
  if (value === true) return "PASS";
  if (value === false) return "FAIL";
  return INSUFFICIENT_EVIDENCE;
}

/**
 * Keep pool-state evidence separate from visual/render-consumption evidence.
 * A valid identity/count readback cannot promote hull, dissolve, depth, or MRT
 * claims that were never independently measured.
 */
export function derivePooledEffectsMechanismVerdicts({
  gpuReadback = null,
  runtimeProofs = {},
} = {}) {
  const poolVerdict = gpuReadback === null || gpuReadback === undefined
    ? INSUFFICIENT_EVIDENCE
    : proofVerdict(gpuReadback.allValid === true);
  const indirectCountsMatch = gpuReadback?.sparks?.indirectInstanceCount === gpuReadback?.sparks?.liveCount &&
    gpuReadback?.debris?.indirectInstanceCount === gpuReadback?.debris?.liveCount;
  const claims = {
    gpuPoolCompaction: poolVerdict,
    stableIdentityFreeList: poolVerdict,
    indirectCountPublication: gpuReadback == null
      ? INSUFFICIENT_EVIDENCE
      : proofVerdict(gpuReadback.allValid === true && indirectCountsMatch),
    indirectDrawConsumption: proofVerdict(runtimeProofs.indirectDrawConsumption),
    hullConformity: proofVerdict(runtimeProofs.hullConformity),
    debrisDissolveShadowParity: proofVerdict(runtimeProofs.debrisDissolveShadowParity),
    softDepthOcclusion: proofVerdict(runtimeProofs.softDepthOcclusion),
    emissiveIsolation: proofVerdict(runtimeProofs.emissiveIsolation),
  };
  const verdicts = POOLED_EFFECT_MECHANISM_CLAIMS.map((id) => claims[id]);
  const overall = verdicts.includes("FAIL")
    ? "FAIL"
    : verdicts.every((verdict) => verdict === "PASS")
      ? "PASS"
      : INSUFFICIENT_EVIDENCE;
  return { overall, claims };
}

function scenarioVisibility(scenario) {
  const table = {
    "reentry-shell-and-wake": { reentry: true, sparks: false, debris: false },
    "impact-sparks": { reentry: false, sparks: true, debris: false },
    "debris-dissolve": { reentry: false, sparks: false, debris: true },
    "gpu-pool-and-compaction": { reentry: false, sparks: true, debris: true },
    "indirect-draws": { reentry: false, sparks: true, debris: true },
    "hdr-emissive-and-depth": { reentry: true, sparks: true, debris: true },
    "tier-benchmark": { reentry: true, sparks: true, debris: true },
  };
  return table[requireMember(scenario, PARTICLE_SCENARIOS, "scenario")];
}

function poolRuntimeDispatches(pool, owner) {
  return pool.describePipeline().dispatchOrder.map((id) => {
    const scalar = ["reset-counters", "exclusive-scan-block-sums", "publish-indirect-count"]
      .includes(id);
    return {
      id: `${pool.kind}:${id}`,
      owner,
      workgroups: {
        values: [scalar ? 1 : pool.blockCount, 1, 1],
        unit: "workgroups",
        label: "Derived",
        source: scalar ? "single-workgroup control dispatch" : "capacity / workgroupSize",
      },
    };
  });
}

function runtimePassInventory(lab) {
  const bloomMips = lab.bloomPass?._nMips ?? 5;
  const bloomReachable = lab.mode === undefined || lab.mode === "final" || lab.mode === "bloom-only";
  const passes = [
    { id: "directional-shadow-map", owner: "directional-light-shadow", kind: "shadow-scene", count: 1 },
    { id: "scene-pass", owner: "webgpu-pooled-effects", kind: "lit-scene", count: 1, mrt: ["output", "normal", "emissive"] },
  ];
  if (bloomReachable) {
    passes.push(
      { id: "bloom-high-pass", owner: "BloomNode", kind: "fullscreen-post", count: 1 },
      { id: "bloom-horizontal-blur", owner: "BloomNode", kind: "fullscreen-post", count: bloomMips },
      { id: "bloom-vertical-blur", owner: "BloomNode", kind: "fullscreen-post", count: bloomMips },
      { id: "bloom-composite", owner: "BloomNode", kind: "fullscreen-post", count: 1 },
    );
  }
  passes.push({ id: "final-render-output", owner: "RenderPipeline", kind: "fullscreen-presentation", count: 1 });
  return passes;
}

function textureResource({ id, owner, kind, width, height, bytesPerPixel, texture = null }) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  return {
    id,
    owner,
    kind,
    dimensions: [safeWidth, safeHeight],
    format: texture?.format ?? null,
    type: texture?.type ?? null,
    residentBytes: {
      value: safeWidth * safeHeight * bytesPerPixel,
      unit: "bytes",
      label: "Derived",
      source: `${safeWidth} * ${safeHeight} * ${bytesPerPixel} bytes/texel`,
    },
  };
}

function runtimeRenderResources(lab) {
  const resources = [];
  const sceneTarget = lab.scenePass?.renderTarget;
  for (const texture of sceneTarget?.textures ?? []) {
    resources.push(textureResource({
      id: `scene-mrt-${texture.name || resources.length}`,
      owner: "scene-pass",
      kind: "rgba16f-render-target",
      width: sceneTarget.width,
      height: sceneTarget.height,
      bytesPerPixel: 8,
      texture,
    }));
  }
  if (sceneTarget?.depthTexture) {
    resources.push(textureResource({
      id: "scene-depth",
      owner: "scene-pass",
      kind: "depth-render-target",
      width: sceneTarget.width,
      height: sceneTarget.height,
      bytesPerPixel: 4,
      texture: sceneTarget.depthTexture,
    }));
  }

  const shadowMap = lab.keyLight?.shadow?.map;
  const shadowSize = lab.keyLight?.shadow?.mapSize;
  resources.push(textureResource({
    id: "directional-shadow-color",
    owner: "directional-light-shadow",
    kind: "rgba8-shadow-target",
    width: shadowMap?.width ?? shadowSize?.x ?? 1024,
    height: shadowMap?.height ?? shadowSize?.y ?? 1024,
    bytesPerPixel: 4,
    texture: shadowMap?.texture ?? null,
  }));
  resources.push(textureResource({
    id: "directional-shadow-depth",
    owner: "directional-light-shadow",
    kind: "shadow-depth-target",
    width: shadowMap?.width ?? shadowSize?.x ?? 1024,
    height: shadowMap?.height ?? shadowSize?.y ?? 1024,
    bytesPerPixel: 4,
    texture: shadowMap?.depthTexture ?? null,
  }));

  const bloomTargets = [
    lab.bloomPass?._renderTargetBright,
    ...(lab.bloomPass?._renderTargetsHorizontal ?? []),
    ...(lab.bloomPass?._renderTargetsVertical ?? []),
  ].filter(Boolean);
  bloomTargets.forEach((target, index) => {
    const texture = target.texture ?? target.textures?.[0] ?? null;
    resources.push(textureResource({
      id: `bloom-${texture?.name || index}`,
      owner: "BloomNode",
      kind: "rgba16f-post-target",
      width: target.width,
      height: target.height,
      bytesPerPixel: 8,
      texture,
    }));
  });
  return resources;
}

function hashUint32(values) {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function computeRgbaReadbackLayout({ width, height, byteLength, bytesPerElement = 1 }) {
  if (![width, height, byteLength, bytesPerElement].every(Number.isInteger) ||
      width <= 0 || height <= 0 || byteLength <= 0 || bytesPerElement <= 0) {
    throw new RangeError("readback layout inputs must be positive integers");
  }
  const rowBytes = width * 4 * bytesPerElement;
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
  let sourceBytesPerRow;
  if (height === 1 || byteLength === rowBytes * height) {
    sourceBytesPerRow = rowBytes;
  } else if (
    byteLength === bytesPerRow * (height - 1) + rowBytes ||
    byteLength === bytesPerRow * height
  ) {
    sourceBytesPerRow = bytesPerRow;
  } else {
    const inferred = (byteLength - rowBytes) / (height - 1);
    if (!Number.isInteger(inferred) || inferred < rowBytes) {
      throw new Error(`unrecognized RGBA readback layout: ${byteLength} bytes`);
    }
    sourceBytesPerRow = inferred;
  }
  return { rowBytes, sourceBytesPerRow, bytesPerRow };
}

export function resolvePooledEffectsRoute({
  pathname = "",
  lockedScenario = null,
  lockedTier = null,
} = {}) {
  const parts = pathname.split("/").filter(Boolean);
  const mechanismIndex = parts.lastIndexOf("mechanism");
  const tierIndex = parts.lastIndexOf("tier");
  const scenario = lockedScenario ?? (mechanismIndex >= 0
    ? parts[mechanismIndex + 1]
    : "reentry-shell-and-wake");
  const tier = lockedTier ?? (tierIndex >= 0 ? parts[tierIndex + 1] : "high");
  return {
    scenario: requireMember(scenario, PARTICLE_SCENARIOS, "scenario"),
    tier: requireMember(tier, PARTICLE_TIERS, "tier"),
    locked: Boolean(lockedScenario || lockedTier || mechanismIndex >= 0 || tierIndex >= 0),
  };
}

function routeSelection() {
  return resolvePooledEffectsRoute({
    pathname: globalThis.location?.pathname ?? "",
    lockedScenario: globalThis.document?.body?.dataset?.lockedScenario ?? null,
    lockedTier: globalThis.document?.body?.dataset?.lockedTier ?? null,
  });
}

/**
 * Integration-stage factory. It allocates no renderer or final pipeline and
 * accepts the host scene as the sole scene owner. Relativistic Space Shot can
 * feed motion event packets into `queueEvent()` and call `step(renderer, dt)`
 * inside its existing render loop.
 */
export function createPooledEffectsStage({
  scene,
  tier = "high",
  scenario = "reentry-shell-and-wake",
  seed = 1,
} = {}) {
  if (!scene?.isScene) throw new TypeError("createPooledEffectsStage requires a host Scene");
  requireMember(tier, PARTICLE_TIERS, "tier");
  requireMember(scenario, PARTICLE_SCENARIOS, "scenario");
  const reentry = createReentryEffectVisuals({ tier });
  const capacity = EFFECT_TIERS[tier].poolCap;
  const sparkPool = new GPUCompactionEffectPool({ capacity, kind: "spark" });
  const debrisPool = new GPUCompactionEffectPool({
    capacity: Math.max(128, Math.floor(capacity / 8 / 128) * 128),
    kind: "debris",
  });
  const sparkMesh = sparkPool.createRenderObject();
  const debrisMesh = debrisPool.createRenderObject();
  scene.add(reentry.group, sparkMesh, debrisMesh);
  let currentScenario = scenario;
  let currentSeed = seed >>> 0;
  let elapsed = 0;
  let disposed = false;

  const applyVisibility = () => {
    const visibility = scenarioVisibility(currentScenario);
    reentry.group.visible = visibility.reentry;
    sparkMesh.visible = visibility.sparks;
    debrisMesh.visible = visibility.debris;
  };
  const queueEvent = (event = {}) => {
    const visibility = scenarioVisibility(currentScenario);
    const sparkCount = event.sparkCount ?? (!visibility.sparks
      ? 0
      : currentScenario === "tier-benchmark"
        ? Math.floor(sparkPool.capacity * 0.72)
        : currentScenario === "indirect-draws"
          ? Math.floor(sparkPool.capacity * 0.4)
          : Math.min(sparkPool.capacity, 2048));
    const debrisCount = event.debrisCount ?? (!visibility.debris
      ? 0
      : Math.min(debrisPool.capacity, currentScenario === "debris-dissolve" ? 768 : 256));
    const shared = {
      seed: event.seed ?? currentSeed,
      position: event.position ?? [0, 1.6, -0.8],
      flowDirectionWorld: event.flowDirectionWorld ?? [0.08, -0.14, -1],
    };
    sparkPool.queueEvent({ ...shared, count: sparkCount });
    debrisPool.queueEvent({ ...shared, seed: shared.seed ^ 0xa511e9b3, count: debrisCount });
  };
  applyVisibility();
  queueEvent();

  return {
    reentry,
    sparkPool,
    debrisPool,
    sparkMesh,
    debrisMesh,
    queueEvent,
    setScenario(nextScenario) {
      currentScenario = requireMember(nextScenario, PARTICLE_SCENARIOS, "scenario");
      applyVisibility();
      queueEvent();
    },
    setSeed(nextSeed) {
      currentSeed = nextSeed >>> 0;
      queueEvent();
    },
    step(renderer, deltaSeconds) {
      elapsed += deltaSeconds;
      reentry.update(elapsed);
      sparkPool.step(renderer, deltaSeconds);
      debrisPool.step(renderer, deltaSeconds);
    },
    reset(renderer) {
      sparkPool.reset(renderer);
      debrisPool.reset(renderer);
      queueEvent();
    },
    describePipeline() {
      return {
        rendererOwner: "host",
        outputOwner: "host",
        emissiveProducer: "stage NodeMaterials -> host MRT emissive",
        compute: [sparkPool.describePipeline(), debrisPool.describePipeline()],
      };
    },
    describeResources() {
      return {
        tier,
        reentry: reentry.describe(),
        spark: sparkPool.describeResources(),
        debris: debrisPool.describeResources(),
      };
    },
    dispose() {
      if (disposed) return;
      scene.remove(reentry.group, sparkMesh, debrisMesh);
      reentry.dispose();
      for (const mesh of [sparkMesh, debrisMesh]) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      sparkPool.dispose();
      debrisPool.dispose();
      disposed = true;
    },
  };
}

export class NativePooledEffectsLab {
  constructor({ canvas, tier = "high", scenario = "reentry-shell-and-wake", seed = 1, locked = false } = {}) {
    if (!canvas) throw new Error("NativePooledEffectsLab requires a canvas");
    this.canvas = canvas;
    this.tier = requireMember(tier, PARTICLE_TIERS, "tier");
    this.scenario = requireMember(scenario, PARTICLE_SCENARIOS, "scenario");
    this.mode = "final";
    this.seed = seed >>> 0;
    this.routeLocked = Boolean(locked);
    this.time = 0;
    this.initialized = false;
    this.disposed = false;
  }

  get labId() {
    return POOLED_EFFECTS_LAB_ID;
  }

  async ready() {
    if (this.disposed) throw new Error("NativePooledEffectsLab used after dispose()");
    if (this.initialized) return;
    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: false, trackTimestamp: true });
    await this.renderer.init();
    if (this.renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("WebGPU is required for the canonical pooled-effects lab.");
    }
    this.renderer.shadowMap.enabled = true;

    this.scene = new Scene();
    this.scene.background = new Color(0x020409);
    this.camera = new PerspectiveCamera(48, 1, 0.05, 200);
    this.camera.position.set(7.6, 4.2, 10.5);
    this.camera.lookAt(0, 0.5, -1.8);
    this.scene.add(new AmbientLight(0x8aa7d8, 0.65));
    const key = new DirectionalLight(0xffffff, 4.2);
    key.position.set(6, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.keyLight = key;
    this.scene.add(key);
    const floor = new Mesh(
      new PlaneGeometry(36, 36),
      new MeshStandardNodeMaterial({ color: 0x131a25, roughness: 0.72, metalness: 0.18 }),
    );
    floor.name = "effect-depth-occluder-floor";
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.1;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const occluder = new Mesh(
      new BoxGeometry(1.7, 2.8, 1.2),
      new MeshStandardNodeMaterial({ color: 0x202b38, roughness: 0.5, metalness: 0.65 }),
    );
    occluder.name = "effect-occlusion-fixture";
    occluder.position.set(2.3, -0.7, -2.5);
    occluder.castShadow = true;
    occluder.receiveShadow = true;
    this.scene.add(occluder);

    this.reentry = createReentryEffectVisuals({ tier: this.tier });
    this.scene.add(this.reentry.group);
    this.createPools();
    this.createPipeline();
    await this.renderer.compileAsync(this.scene, this.camera);
    await this.scenePass.compileAsync(this.renderer);
    this.applyScenarioVisibility();
    this.initialized = true;
  }

  createPools() {
    const cap = EFFECT_TIERS[this.tier].poolCap;
    this.sparkPool = new GPUCompactionEffectPool({ capacity: cap, kind: "spark" });
    this.debrisPool = new GPUCompactionEffectPool({
      capacity: Math.max(128, Math.floor(cap / 8 / 128) * 128),
      kind: "debris",
    });
    this.sparkMesh = this.sparkPool.createRenderObject();
    this.debrisMesh = this.debrisPool.createRenderObject();
    this.scene.add(this.sparkMesh, this.debrisMesh);
    this.queueScenarioEvent();
  }

  destroyPools() {
    for (const mesh of [this.sparkMesh, this.debrisMesh]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.sparkPool?.dispose();
    this.debrisPool?.dispose();
  }

  createPipeline() {
    this.scenePass = pass(this.scene, this.camera);
    this.scenePass.setMRT(mrt({ output, normal: normalView, emissive }));
    const sceneColor = this.scenePass.getTextureNode("output");
    const normalNode = this.scenePass.getTextureNode("normal");
    const emissiveNode = this.scenePass.getTextureNode("emissive");
    this.bloomPass = bloom(emissiveNode, 0.7, 0.24, 0.72);
    this.bloomPass.smoothWidth.value = 0.08;
    this.bloomPass.setResolutionScale(EFFECT_TIERS[this.tier].bloomScale);
    const bloomNode = this.bloomPass.getTextureNode();
    this.outputs = {
      final: renderOutput(sceneColor.add(bloomNode), AgXToneMapping, this.renderer.outputColorSpace),
      "no-post": renderOutput(sceneColor, AgXToneMapping, this.renderer.outputColorSpace),
      "raw-emissive": renderOutput(emissiveNode, NoToneMapping, this.renderer.outputColorSpace),
      "bloom-only": renderOutput(bloomNode, NoToneMapping, this.renderer.outputColorSpace),
      normal: renderOutput(normalNode.mul(0.5).add(0.5), NoToneMapping, this.renderer.outputColorSpace),
    };
    this.renderPipeline = new RenderPipeline(this.renderer);
    this.renderPipeline.outputColorTransform = false;
    this.renderPipeline.outputNode = this.outputs.final;
  }

  queueScenarioEvent() {
    const visibility = scenarioVisibility(this.scenario);
    const sparks = !visibility.sparks
      ? 0
      : this.scenario === "tier-benchmark"
        ? Math.min(this.sparkPool.capacity, Math.floor(this.sparkPool.capacity * 0.72))
        : this.scenario === "indirect-draws"
          ? Math.min(this.sparkPool.capacity, Math.floor(this.sparkPool.capacity * 0.4))
          : this.scenario === "impact-sparks" || this.scenario === "gpu-pool-and-compaction"
            ? Math.min(this.sparkPool.capacity, 4096)
            : Math.min(this.sparkPool.capacity, 1024);
    const debris = !visibility.debris
      ? 0
      : this.scenario === "debris-dissolve"
        ? Math.min(this.debrisPool.capacity, 768)
        : Math.min(this.debrisPool.capacity, 128);
    const event = {
      seed: this.seed,
      position: [0, 1.6, -0.8],
      flowDirectionWorld: [0.08, -0.14, -1],
    };
    this.sparkPool.queueEvent({ ...event, count: sparks });
    this.debrisPool.queueEvent({ ...event, seed: this.seed ^ 0xa511e9b3, count: debris });
  }

  applyScenarioVisibility() {
    const visibility = scenarioVisibility(this.scenario);
    this.reentry.group.visible = visibility.reentry;
    this.sparkMesh.visible = visibility.sparks;
    this.debrisMesh.visible = visibility.debris;
  }

  async setScenario(id) {
    this.scenario = requireMember(id, PARTICLE_SCENARIOS, "scenario");
    this.applyScenarioVisibility();
    this.queueScenarioEvent();
  }

  async setMode(id) {
    this.mode = requireMember(id, PARTICLE_MODES, "mode");
    this.renderPipeline.outputNode = this.outputs[this.mode];
    this.renderPipeline.needsUpdate = true;
  }

  async setTier(id) {
    const tier = requireMember(id, PARTICLE_TIERS, "tier");
    if (tier === this.tier) return;
    this.tier = tier;
    this.destroyPools();
    this.scene.remove(this.reentry.group);
    this.reentry.dispose();
    this.reentry = createReentryEffectVisuals({ tier: this.tier });
    this.scene.add(this.reentry.group);
    this.createPools();
    this.bloomPass.setResolutionScale(EFFECT_TIERS[tier].bloomScale);
    this.applyScenarioVisibility();
    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.logicalWidth) {
      await this.resize(this.logicalWidth, this.logicalHeight, this.requestedDpr);
    }
  }

  async setSeed(seed) {
    this.seed = seed >>> 0;
    this.queueScenarioEvent();
  }

  async setCamera(id) {
    const cameras = {
      near: [3.8, 2.1, 5.2],
      design: [7.6, 4.2, 10.5],
      far: [13.5, 7.5, 19],
    };
    if (!Object.hasOwn(cameras, id)) throw new RangeError(`Unknown camera: ${id}`);
    this.camera.position.fromArray(cameras[id]);
    this.camera.lookAt(0, 0.5, -1.8);
  }

  async setTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("time must be non-negative");
    this.time = seconds;
    this.reentry.update(seconds);
  }

  async step(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("deltaSeconds must be non-negative");
    }
    this.sparkPool.step(this.renderer, deltaSeconds);
    this.debrisPool.step(this.renderer, deltaSeconds);
    this.time += deltaSeconds;
    this.reentry.update(this.time);
  }

  async resetHistory(cause) {
    if (typeof cause !== "string" || cause.length === 0) throw new TypeError("reset cause required");
    this.sparkPool.reset(this.renderer);
    this.debrisPool.reset(this.renderer);
    this.queueScenarioEvent();
  }

  async resize(width, height, dpr = 1) {
    if (![width, height, dpr].every((value) => Number.isFinite(value) && value > 0)) {
      throw new RangeError("width, height, and dpr must be positive");
    }
    this.logicalWidth = width;
    this.logicalHeight = height;
    this.requestedDpr = dpr;
    this.effectiveDpr = Math.min(dpr, EFFECT_TIERS[this.tier].dprCap);
    this.renderer.setPixelRatio(this.effectiveDpr);
    this.renderer.setSize(width, height, false);
    this.scenePass.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.captureTarget?.setSize(width, height);
  }

  async renderOnce() {
    this.renderPipeline.render();
  }

  async capturePixels(target = "output") {
    let renderTarget = this.scenePass.renderTarget;
    let index = renderTarget.textures.findIndex((texture) => texture.name === target);
    if (target === "presentation") {
      this.captureTarget ??= new RenderTarget(
        this.renderer.domElement.width,
        this.renderer.domElement.height,
        { type: UnsignedByteType },
      );
      this.captureTarget.texture.name = "presentation";
      const previous = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.captureTarget);
      try {
        this.renderPipeline.render();
      } finally {
        this.renderer.setRenderTarget(previous);
      }
      renderTarget = this.captureTarget;
      index = 0;
    }
    if (index < 0) throw new RangeError(`Unknown capture target: ${target}`);
    const width = renderTarget.width;
    const height = renderTarget.height;
    const pixels = await this.renderer.readRenderTargetPixelsAsync(
      renderTarget,
      0,
      0,
      width,
      height,
      index,
    );
    const { rowBytes, sourceBytesPerRow, bytesPerRow } = computeRgbaReadbackLayout({
      width,
      height,
      byteLength: pixels.byteLength,
      bytesPerElement: pixels.BYTES_PER_ELEMENT,
    });
    return {
      target,
      pixels,
      width,
      height,
      rowBytes,
      sourceBytesPerRow,
      bytesPerRow,
    };
  }

  describePipeline() {
    const sparkOwner = "spark GPUCompactionEffectPool";
    const debrisOwner = "debris GPUCompactionEffectPool";
    const sparkResources = this.sparkPool.describeResources();
    const debrisResources = this.debrisPool.describeResources();
    const renderResources = runtimeRenderResources(this);
    return {
      schemaVersion: 2,
      owners: {
        renderer: "webgpu-pooled-effects",
        renderPipeline: "webgpu-pooled-effects",
        emissive: "scene MRT emissive",
        toneMap: "renderOutput",
        outputColorTransform: "renderOutput",
        sparkState: "spark GPUCompactionEffectPool",
        debrisState: "debris GPUCompactionEffectPool",
      },
      signals: [
        { id: "scene-linear-hdr", producer: "scene-pass", consumers: ["final-output", "no-post"], reachable: true, encoding: "linear HDR" },
        { id: "normal-view", producer: "scene-pass", consumers: ["normal-diagnostic"], reachable: true, encoding: "view-space xyz" },
        { id: "authored-emissive", producer: "scene-pass", consumers: ["BloomNode", "raw-emissive"], reachable: true, encoding: "scene-linear HDR" },
        { id: "spark-indirect-count", producer: "spark:publish-indirect-count", consumers: ["spark:gpu-indirect-render"], reachable: true, encoding: "uint instanceCount" },
        { id: "debris-indirect-count", producer: "debris:publish-indirect-count", consumers: ["debris:gpu-indirect-render"], reachable: true, encoding: "uint instanceCount" },
      ],
      sceneSubmissions: runtimePassInventory(this),
      computeDispatches: [
        ...poolRuntimeDispatches(this.sparkPool, sparkOwner),
        ...poolRuntimeDispatches(this.debrisPool, debrisOwner),
      ],
      resources: [
        {
          id: "spark-pool",
          owner: sparkOwner,
          kind: "storage-buffer-set",
          residentBytes: { value: sparkResources.totalBytes, unit: "bytes", label: "Derived", source: "typed-array allocation ledger" },
        },
        {
          id: "debris-pool",
          owner: debrisOwner,
          kind: "storage-buffer-set",
          residentBytes: { value: debrisResources.totalBytes, unit: "bytes", label: "Derived", source: "typed-array allocation ledger" },
        },
        ...renderResources,
      ],
      finalToneMapOwner: "renderOutput",
      finalOutputTransformOwner: "renderOutput",
    };
  }

  describeMechanism() {
    return {
      scenario: this.scenario,
      tier: this.tier,
      outputColorTransform: this.renderPipeline.outputColorTransform,
      spark: this.sparkPool.describePipeline(),
      debris: this.debrisPool.describePipeline(),
    };
  }

  describeResources() {
    const renderResources = runtimeRenderResources(this);
    return {
      tierPolicy: { ...EFFECT_TIERS[this.tier] },
      reentry: this.reentry.describe(),
      spark: this.sparkPool.describeResources(),
      debris: this.debrisPool.describeResources(),
      renderTargets: this.scenePass.renderTarget.textures.map((texture) => ({
        name: texture.name,
        type: texture.type,
        format: texture.format,
        width: this.scenePass.renderTarget.width,
        height: this.scenePass.renderTarget.height,
      })),
      shadowTargets: renderResources.filter(({ owner }) => owner === "directional-light-shadow"),
      bloomTargets: renderResources.filter(({ owner }) => owner === "BloomNode"),
      runtimePasses: runtimePassInventory(this),
    };
  }

  async readMechanismEvidence() {
    const validateState = (state) => {
      const liveCount = state.counters[2];
      validateCompactionReadback({
        indexToEntity: state.indexToEntity,
        entityToIndex: state.entityToIndex,
        liveCount,
        indirect: state.indirect,
        freeCount: state.freeCount,
      });
      return liveCount;
    };
    const before = await Promise.all([
      this.sparkPool.readValidationState(this.renderer),
      this.debrisPool.readValidationState(this.renderer),
    ]);
    const deltaSeconds = 1 / 120;
    this.sparkPool.step(this.renderer, deltaSeconds);
    this.debrisPool.step(this.renderer, deltaSeconds);
    this.time += deltaSeconds;
    this.reentry.update(this.time);
    const after = await Promise.all([
      this.sparkPool.readValidationState(this.renderer),
      this.debrisPool.readValidationState(this.renderer),
    ]);
    const readPool = (pool, beforeState, state) => {
      const beforeLiveCount = validateState(beforeState);
      const liveCount = validateState(state);
      let maximumPositionError = 0;
      let maximumVelocityError = 0;
      let maximumAgeError = 0;
      let stableIdentitySamples = 0;
      const acceleration = pool.accelerationNode.value.toArray();
      for (let denseIndex = 0; denseIndex < Math.min(beforeLiveCount, 16); denseIndex += 1) {
        const entity = beforeState.indexToEntity[denseIndex];
        const nextIndex = state.entityToIndex[entity];
        if (nextIndex === 0xffffffff) continue;
        const beforeOffset = denseIndex * 4;
        const afterOffset = nextIndex * 4;
        const oracle = integrateLinearDragExact({
          position: Array.from(beforeState.positionAge.slice(beforeOffset, beforeOffset + 3)),
          velocity: Array.from(beforeState.velocityLifetime.slice(beforeOffset, beforeOffset + 3)),
          acceleration,
          drag: pool.dragNode.value,
          dt: deltaSeconds,
        });
        for (let lane = 0; lane < 3; lane += 1) {
          maximumPositionError = Math.max(
            maximumPositionError,
            Math.abs(state.positionAge[afterOffset + lane] - oracle.position[lane]),
          );
          maximumVelocityError = Math.max(
            maximumVelocityError,
            Math.abs(state.velocityLifetime[afterOffset + lane] - oracle.velocity[lane]),
          );
        }
        maximumAgeError = Math.max(
          maximumAgeError,
          Math.abs(
            state.positionAge[afterOffset + 3] -
            (beforeState.positionAge[beforeOffset + 3] + deltaSeconds),
          ),
        );
        stableIdentitySamples += 1;
      }
      const finiteState = [state.positionAge, state.velocityLifetime, state.appearance, state.axisSpin]
        .every((lane) => Array.from(lane.slice(0, liveCount * 4)).every(Number.isFinite));
      const tolerance = 5e-4;
      return {
        valid: finiteState && stableIdentitySamples > 0 &&
          maximumPositionError <= tolerance &&
          maximumVelocityError <= tolerance &&
          maximumAgeError <= tolerance,
        liveCount,
        spawned: beforeState.counters[1],
        overflow: beforeState.counters[3],
        indirectInstanceCount: state.indirect[1],
        identityHash: hashUint32(state.indexToEntity),
        reverseIdentityHash: hashUint32(state.entityToIndex),
        freeCount: state.freeCount,
        stableIdentitySamples,
        maximumPositionError,
        maximumVelocityError,
        maximumAgeError,
        tolerance,
      };
    };
    const sparks = readPool(this.sparkPool, before[0], after[0]);
    const debris = readPool(this.debrisPool, before[1], after[1]);
    return { allValid: sparks.valid && debris.valid, sparks, debris };
  }

  getMetrics() {
    const timestampSupported = this.renderer.hasFeature?.("timestamp-query") === true;
    return {
      labId: POOLED_EFFECTS_LAB_ID,
      backend: this.renderer.backend?.isWebGPUBackend === true ? "WebGPU" : "unsupported",
      tier: this.tier,
      scenario: this.scenario,
      mode: this.mode,
      time: this.time,
      seed: this.seed,
      routeLocked: this.routeLocked,
      requestedDpr: this.requestedDpr,
      effectiveDpr: this.effectiveDpr,
      rendererInfo: this.renderer.info,
      timestampVerdict: timestampSupported ? "available-not-yet-resolved" : "INSUFFICIENT_EVIDENCE",
    };
  }

  async dispose() {
    if (this.disposed) return;
    this.destroyPools();
    this.scene.remove(this.reentry.group);
    this.reentry.dispose();
    this.scene.traverse((object) => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
    this.bloomPass?.dispose?.();
    this.scenePass?.dispose?.();
    this.renderPipeline.dispose?.();
    this.captureTarget?.dispose();
    this.renderer.dispose();
    this.disposed = true;
  }
}

export async function mountNativePooledEffectsLab({ canvas, status, metrics, animate = true } = {}) {
  const selection = routeSelection();
  const lab = new NativePooledEffectsLab({ canvas, ...selection });
  await lab.ready();
  const width = Math.max(1, globalThis.innerWidth ?? 1200);
  const height = Math.max(1, globalThis.innerHeight ?? 800);
  await lab.resize(width, height, Math.min(globalThis.devicePixelRatio ?? 1, 2));
  globalThis.labController = lab;
  globalThis.__LAB_CONTROLLER__ = lab;
  globalThis.__THREE_LAB__ = lab;
  let previous = performance.now();
  let request = 0;
  const frame = async (now) => {
    const dt = Math.min((now - previous) / 1000, 1 / 15);
    previous = now;
    await lab.step(dt);
    await lab.renderOnce();
    if (metrics) metrics.textContent = JSON.stringify(lab.getMetrics(), null, 2);
    request = requestAnimationFrame(frame);
  };
  if (status) status.textContent = `native WebGPU · ${selection.scenario} · ${selection.tier}`;
  if (animate) request = requestAnimationFrame(frame);
  return {
    lab,
    stop: async () => {
      cancelAnimationFrame(request);
      await lab.dispose();
    },
  };
}
