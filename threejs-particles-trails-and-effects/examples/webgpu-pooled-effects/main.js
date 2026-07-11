import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from "three";
import { WebGPURenderer, RenderPipeline } from "three/webgpu";
import { renderOutput } from "three/tsl";
import { bloom } from "three/examples/jsm/tsl/display/BloomNode.js";

import {
  BLOOM_MODES,
  EFFECT_TIERS,
  EffectPool,
  createComputeDescriptors,
  createRenderPipelineContract,
  createSpawnPacket,
  validateHDRHierarchy,
} from "./effect-pool.js";
import { computeBounds, softDepthFade, validateDepthPolicy } from "./depth-policy.js";
import { createReentryShell, estimateShellBudget } from "./reentry-shell.js";

export class PooledEffectsDemo {
  constructor({
    tier = "medium",
    seed = 20260704,
    bloomMode = BLOOM_MODES.FULL_SCENE,
  } = {}) {
    this.tier = tier;
    this.seed = seed;
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(55, 16 / 9, 0.1, 200);
    this.sparkPool = new EffectPool({
      className: "spark",
      capacity: EFFECT_TIERS[tier].poolCap,
      lifetimeSeconds: 1.3,
    });
    this.debrisPool = new EffectPool({
      className: "debris",
      capacity: Math.floor(EFFECT_TIERS[tier].poolCap / 8),
      lifetimeSeconds: 3,
      drag: 0.4,
    });
    this.debugMode = "final";
    this.pipelineContract = createRenderPipelineContract({
      scene: this.scene,
      camera: this.camera,
      bloomMode,
    });
    this.computePlan = createComputeDescriptors({ capacity: EFFECT_TIERS[tier].poolCap });
    this.metrics = {
      bloomMode,
      MRT:
        bloomMode === BLOOM_MODES.SELECTIVE_EMISSIVE
          ? "beauty + emissive"
          : "none; bloom consumes scene-linear HDR output",
      emissive:
        bloomMode === BLOOM_MODES.SELECTIVE_EMISSIVE
          ? "spark/debris/wake contribution attachment"
          : "scene-linear material emission",
      spark: 0,
      debris: 0,
      wake: 0,
      rendererInfo: null,
    };
  }

  async initialize({ canvas } = {}) {
    this.renderer = new WebGPURenderer({ canvas, antialias: false });
    await this.renderer.init();
    if (this.renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("WebGPU backend unavailable for the pooled-effects scaffold.");
    }
    this.backendTier = this.tier;

    this.beautyPass = this.pipelineContract.beautyPass;
    this.gbuffer = this.pipelineContract.contributionMRT;
    if (this.gbuffer) this.beautyPass.setMRT(this.gbuffer);
    const bloomInput = this.gbuffer
      ? this.beautyPass.getTextureNode("emissive")
      : this.beautyPass;
    this.bloomNode = bloom(bloomInput);
    this.finalOutput = renderOutput;
    this.renderPipeline = new RenderPipeline(this.renderer);

    return this;
  }

  createFixtureHull() {
    const hullGeometry = new BoxGeometry(1.2, 0.7, 3.8);
    const hull = new Mesh(hullGeometry, new MeshBasicMaterial({ color: 0x444a52 }));
    this.scene.add(hull);
    return hull;
  }

  spawnEvent() {
    const packet = createSpawnPacket({
      seed: this.seed,
      count: Math.min(256, Math.floor(EFFECT_TIERS[this.tier].poolCap / 4)),
      position: [0, 8, 0],
      flowDirectionWorld: [0, -1, -0.2],
      emissionScale: 1,
    });
    this.sparkPool.spawn(packet);
    this.debrisPool.spawn({ ...packet, className: "debris", count: 24, radius: 0.45 });
    this.metrics.spark = this.sparkPool.liveCount;
    this.metrics.debris = this.debrisPool.liveCount;
  }

  attachReentryShell(hull) {
    this.shell = createReentryShell({
      hullGeometry: hull.geometry,
      matrixWorld: hull.matrixWorld,
      flowDirectionWorld: [0, -1, -0.2],
      tier: this.backendTier ?? this.tier,
    });
    this.metrics.wake = estimateShellBudget(this.shell).triangles;
  }

  setDebugMode(mode) {
    this.debugMode = mode;
  }

  update(dt) {
    this.sparkPool.update(dt);
    this.debrisPool.update(dt);
    this.sparkBounds = computeBounds(
      Array.from({ length: this.sparkPool.liveCount }, (_, index) => ({
        position: [
          this.sparkPool.startPosition.array[index * 4],
          this.sparkPool.startPosition.array[index * 4 + 1],
          this.sparkPool.startPosition.array[index * 4 + 2],
        ],
      })),
      { radius: 0.4 },
    );
    this.depthFadeProbe = softDepthFade({
      sceneDepthMeters: 14,
      effectDepthMeters: 13.5,
      fadeMeters: 0.75,
    });
    this.metrics.rendererInfo = this.renderer?.info ?? {
      render: { drawCalls: 0, triangles: 0 },
      compute: { calls: 0 },
    };
  }

  validateContracts() {
    const selective = this.pipelineContract.bloomMode === BLOOM_MODES.SELECTIVE_EMISSIVE;
    return (
      validateHDRHierarchy() &&
      validateDepthPolicy() &&
      this.pipelineContract.bloom.requiresContributionAttachment === selective &&
      (selective
        ? this.pipelineContract.contributionMRT !== null &&
          this.pipelineContract.bloom.source === "MRT emissive"
        : this.pipelineContract.contributionMRT === null &&
          this.pipelineContract.bloom.source === "scene-linear HDR output")
    );
  }

  dispose() {
    this.sparkPool.dispose();
    this.debrisPool.dispose();
    this.scene.traverse((object) => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
    this.renderer?.dispose?.();
  }
}

export function createPooledEffectsDemo(options) {
  return new PooledEffectsDemo(options);
}
