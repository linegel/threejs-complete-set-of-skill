import {
  AgXToneMapping,
  Color,
  PerspectiveCamera,
  RenderTarget,
  RenderPipeline,
  Scene,
  UnsignedByteType,
  WebGPURenderer,
} from "three/webgpu";
import { pass, renderOutput } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

import { CURVED_RAY_QUALITY_TIERS } from "./curved-ray-accretion.js";
import {
  SPACE_PROBE_TERMINATION,
  integrateSchwarzschildProbeCPU,
} from "./space-gpu-probes.js";
import { SPACE_INTEGRATOR_MODES, createSpaceIntegratorStage } from "./space-transfer-stage.js";

export const SPACE_LAB_MODES = Object.freeze([
  "final",
  "no-post",
  "step-count",
  "termination",
  "bent-direction",
]);
export const SPACE_LAB_TIERS = Object.freeze(Object.keys(CURVED_RAY_QUALITY_TIERS));

function requireMember(value, values, kind) {
  if (!values.includes(value)) throw new RangeError(`Unknown ${kind}: ${value}`);
  return value;
}

const SCHWARZSCHILD_PROBE_IMPACTS = Object.freeze([
  4,
  3 * Math.sqrt(3) * 0.99,
  3 * Math.sqrt(3) * 1.03,
  8,
]);

export function summarizeProbeReadback(readback, maxAffineStep) {
  const count = readback.count;
  const output = Array.from(readback.output.slice(0, count * 4));
  const diagnostics = Array.from(readback.diagnostics.slice(0, count * 4));
  const results = Array.from(readback.results.slice(0, count * 4));
  let maximumParityError = 0;
  let maximumReferenceError = 0;
  let maximumInvariantDrift = 0;
  let allValid = true;
  const terminations = [];
  const maxSteps = readback.maxSteps ?? 16384;
  for (let index = 0; index < count; index += 1) {
    const oracle = integrateSchwarzschildProbeCPU({
      impact: SCHWARZSCHILD_PROBE_IMPACTS[index],
      maxAffineStep,
      maxSteps,
    });
    const reference = integrateSchwarzschildProbeCPU({
      impact: SCHWARZSCHILD_PROBE_IMPACTS[index],
      maxAffineStep: 0.01,
      maxSteps: 65536,
    });
    const expectedTermination = oracle.termination === "escaped"
      ? SPACE_PROBE_TERMINATION.escaped
      : oracle.termination === "horizon"
        ? SPACE_PROBE_TERMINATION.horizon
        : null;
    const base = index * 4;
    const gpuTermination = results[base];
    const acceptedSteps = results[base + 1];
    const gpuOutputFinite = output.slice(base, base + 4).every(Number.isFinite);
    maximumParityError = Math.max(
      maximumParityError,
      Math.abs(output[base] - oracle.state[0]),
      Math.abs(output[base + 1] - oracle.state[1]),
      Math.abs(output[base + 3] - oracle.state[2]),
    );
    maximumReferenceError = Math.max(
      maximumReferenceError,
      Math.abs(output[base] - reference.state[0]),
      Math.abs(output[base + 1] - reference.state[1]),
      Math.abs(output[base + 3] - reference.state[2]),
    );
    maximumInvariantDrift = Math.max(maximumInvariantDrift, diagnostics[base]);
    const oracleComplete = ["escaped", "horizon"].includes(oracle.termination);
    const referenceComplete = reference.termination === oracle.termination;
    const invariantValid = Number.isFinite(diagnostics[base]) && diagnostics[base] <= 5e-4 &&
      Number.isFinite(oracle.maxInvariantDrift) && oracle.maxInvariantDrift <= 1e-8 &&
      Number.isFinite(reference.maxInvariantDrift) && reference.maxInvariantDrift <= 1e-8;
    const valid = expectedTermination !== null && oracleComplete && referenceComplete &&
      gpuTermination === expectedTermination && acceptedSteps > 0 && acceptedSteps <= maxSteps &&
      gpuOutputFinite && invariantValid;
    terminations.push({
      impact: SCHWARZSCHILD_PROBE_IMPACTS[index],
      gpu: gpuTermination,
      oracle: oracle.termination,
      reference: reference.termination,
      acceptedSteps,
      valid,
    });
    allValid &&= valid;
  }
  return {
    count,
    maxAffineStep,
    output,
    diagnostics,
    results,
    maximumParityError,
    maximumReferenceError,
    maximumInvariantDrift,
    terminations,
    maxSteps,
    allValid,
  };
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

export function resolveSpaceIntegratorRoute({
  pathname = "",
  lockedScenario = null,
  lockedTier = null,
} = {}) {
  const parts = pathname.split("/").filter(Boolean);
  const mechanism = parts.lastIndexOf("mechanism");
  const tier = parts.lastIndexOf("tier");
  const scenario = lockedScenario ?? (mechanism >= 0 ? parts[mechanism + 1] : "accretion-disk");
  const quality = lockedTier ?? (tier >= 0 ? parts[tier + 1] : "standard");
  return {
    scenario: requireMember(scenario, SPACE_INTEGRATOR_MODES, "scenario"),
    quality: requireMember(quality, SPACE_LAB_TIERS, "tier"),
    locked: Boolean(lockedScenario || lockedTier || mechanism >= 0 || tier >= 0),
  };
}

function routeSelection() {
  return resolveSpaceIntegratorRoute({
    pathname: globalThis.location?.pathname ?? "",
    lockedScenario: globalThis.document?.body?.dataset?.lockedScenario ?? null,
    lockedTier: globalThis.document?.body?.dataset?.lockedTier ?? null,
  });
}

export class SpaceIntegratorLab {
  constructor({ canvas, scenario = "accretion-disk", quality = "standard", seed = 7, locked = false } = {}) {
    if (!canvas) throw new Error("SpaceIntegratorLab requires a canvas");
    this.canvas = canvas;
    this.scenario = requireMember(scenario, SPACE_INTEGRATOR_MODES, "scenario");
    this.quality = requireMember(quality, SPACE_LAB_TIERS, "tier");
    this.seed = seed >>> 0;
    this.routeLocked = Boolean(locked);
    this.mode = "final";
    this.time = 0;
    this.frameIndex = 0;
    this.disposed = false;
  }

  async ready() {
    if (this.disposed) throw new Error("SpaceIntegratorLab used after dispose()");
    if (this.renderer) return;
    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: false, trackTimestamp: true });
    await this.renderer.init();
    if (this.renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("WebGPU is required for the canonical Space Integrator Lab.");
    }
    this.scene = new Scene();
    this.scene.background = new Color(0x010207);
    this.camera = new PerspectiveCamera(55, 1, 0.01, 100);
    this.camera.position.set(0, 0.14, 2.35);
    this.camera.lookAt(0, 0, 0);
    this.createStage();
    this.scenePass = pass(this.scene, this.camera);
    this.scenePass.setResolutionScale(CURVED_RAY_QUALITY_TIERS[this.quality].resolutionScale);
    const sceneColor = this.scenePass.getTextureNode("output");
    this.bloomPass = bloom(sceneColor, 0.52, 0.32, 1.1);
    this.bloomPass.setResolutionScale(0.5);
    const bloomColor = this.bloomPass.getTextureNode();
    this.outputs = {
      final: renderOutput(sceneColor.add(bloomColor), AgXToneMapping, this.renderer.outputColorSpace),
      "no-post": renderOutput(sceneColor, AgXToneMapping, this.renderer.outputColorSpace),
    };
    this.renderPipeline = new RenderPipeline(this.renderer);
    this.renderPipeline.outputColorTransform = false;
    this.renderPipeline.outputNode = this.outputs.final;
    await this.stage.prepare(this.renderer, this.camera);
    await this.renderer.compileAsync(this.scene, this.camera);
    await this.scenePass.compileAsync(this.renderer);
  }

  createStage() {
    this.stage = createSpaceIntegratorStage({
      mode: this.scenario,
      quality: this.quality,
      seed: this.seed,
    });
    if (this.scenario === "integration-convergence") this.stage.setDebugMode("convergence");
    this.stage.mesh.scale.setScalar(1.18);
    this.scene.add(this.stage.mesh);
  }

  destroyStage() {
    if (!this.stage) return;
    this.scene.remove(this.stage.mesh);
    this.stage.dispose();
  }

  async replaceStage() {
    this.destroyStage();
    this.createStage();
    await this.stage.prepare(this.renderer, this.camera);
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  async setScenario(id) {
    const scenario = requireMember(id, SPACE_INTEGRATOR_MODES, "scenario");
    if (scenario === this.scenario) return;
    this.scenario = scenario;
    await this.replaceStage();
  }

  async setTier(id) {
    const quality = requireMember(id, SPACE_LAB_TIERS, "tier");
    if (quality === this.quality) return;
    this.quality = quality;
    this.scenePass.setResolutionScale(CURVED_RAY_QUALITY_TIERS[this.quality].resolutionScale);
    await this.replaceStage();
  }

  async setMode(id) {
    this.mode = requireMember(id, SPACE_LAB_MODES, "mode");
    if (id === "final" || id === "no-post") {
      this.stage.setDebugMode(
        this.scenario === "integration-convergence" && id === "final" ? "convergence" : "final",
      );
      this.renderPipeline.outputNode = this.outputs[id];
    } else {
      this.stage.setDebugMode(id);
      this.renderPipeline.outputNode = this.outputs["no-post"];
    }
    this.renderPipeline.needsUpdate = true;
  }

  async setSeed(seed) {
    const normalizedSeed = seed >>> 0;
    if (normalizedSeed === this.seed) return;
    this.seed = normalizedSeed;
    await this.replaceStage();
  }

  async setCamera(id) {
    const cameras = { near: [0, 0.08, 1.55], design: [0, 0.14, 2.35], far: [0, 0.3, 4.2] };
    if (!Object.hasOwn(cameras, id)) throw new RangeError(`Unknown camera: ${id}`);
    this.camera.position.fromArray(cameras[id]);
    this.camera.lookAt(0, 0, 0);
    this.stage.resetHistory("camera-change");
  }

  async setTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError("time must be non-negative");
    this.time = seconds;
    this.stage.update(seconds);
  }

  async step(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError("deltaSeconds must be non-negative");
    this.time += deltaSeconds;
    this.stage.update(this.time);
    this.stage.prepareFrame?.(this.renderer, this.camera);
    this.frameIndex += 1;
  }

  async resetHistory(cause) {
    if (typeof cause !== "string" || cause.length === 0) throw new TypeError("reset cause required");
    this.stage.resetHistory(cause);
  }

  async resize(width, height, dpr = 1) {
    if (![width, height, dpr].every((v) => Number.isFinite(v) && v > 0)) {
      throw new RangeError("width, height, and dpr must be positive");
    }
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.scenePass.setSize(width, height);
    this.bloomPass.setSize(width, height);
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
    const { width, height } = renderTarget;
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
    return { target, width, height, rowBytes, sourceBytesPerRow, bytesPerRow, pixels };
  }

  describePipeline() {
    const stageDescription = this.stage.describePipeline();
    const stageResources = this.stage.describeResources();
    const computeDispatches = [];
    for (let index = 0; index < (stageDescription.plannedDirectMetricProbeDispatches ?? 0); index += 1) {
      computeDispatches.push({
        id: `direct-metric-probe-${index}`,
        owner: "space integrator stage",
        workgroups: {
          values: [1, 1, 1],
          unit: "workgroups",
          label: "Derived",
          source: "ceil(8 probes / 64 threads)",
        },
      });
    }
    if (this.stage.cache) {
      computeDispatches.push({
        id: "lens-cache-refresh",
        owner: "SpaceLensDirectionCache",
        workgroups: {
          values: [Math.ceil(this.stage.cache.width * this.stage.cache.height / 64), 1, 1],
          unit: "workgroups",
          label: "Derived",
          source: "ceil(cacheWidth * cacheHeight / 64)",
        },
      });
    }
    if (this.stage.temporal) {
      computeDispatches.push({
        id: "temporal-direction-resolve",
        owner: "SpaceTemporalDirectionHistory",
        workgroups: {
          values: [Math.ceil(this.stage.temporal.width * this.stage.temporal.height / 64), 1, 1],
          unit: "workgroups",
          label: "Derived",
          source: "ceil(historyWidth * historyHeight / 64)",
        },
      });
    }
    const resources = [];
    for (const transfer of stageResources.transferTextures ?? []) {
      resources.push({
        id: transfer.name,
        owner: "space integrator stage",
        kind: "sampled-transfer-texture",
        residentBytes: { value: transfer.bytes, unit: "bytes", label: "Derived", source: "typed-array byteLength" },
      });
    }
    if (stageResources.cache) {
      resources.push({
        id: "space-lens-cache",
        owner: "SpaceLensDirectionCache",
        kind: "storage-texture-set",
        residentBytes: { value: stageResources.cache.bytes, unit: "bytes", label: "Derived", source: "dimensions * three RGBA16F textures" },
      });
    }
    if (stageResources.temporal) {
      resources.push({
        id: "space-temporal-history",
        owner: "SpaceTemporalDirectionHistory",
        kind: "storage-texture-set",
        residentBytes: { value: stageResources.temporal.historyBytes, unit: "bytes", label: "Derived", source: "dimensions * five RGBA16F textures" },
      });
    }
    if (stageResources.directMetricProbes) {
      resources.push({
        id: "space-direct-metric-probes",
        owner: "space integrator stage",
        kind: "storage-buffer-set",
        residentBytes: { value: stageResources.directMetricProbes.bytes, unit: "bytes", label: "Derived", source: "probe attribute byteLength sum" },
      });
    }
    for (const [index, probe] of (stageResources.convergenceMetricProbes ?? []).entries()) {
      resources.push({
        id: `space-convergence-probes-${index}`,
        owner: "space integrator stage",
        kind: "storage-buffer-set",
        residentBytes: { value: probe.bytes, unit: "bytes", label: "Derived", source: "probe attribute byteLength sum" },
      });
    }
    return {
      schemaVersion: 2,
      owners: {
        renderer: "SpaceIntegratorLab",
        renderPipeline: "SpaceIntegratorLab",
        curvedRay: "space integrator stage",
        toneMap: "renderOutput",
        outputColorTransform: "renderOutput",
        temporalHistory: this.stage.temporal ? "SpaceTemporalDirectionHistory" : "none",
      },
      signals: [
        { id: "scene-linear-hdr", producer: "scene-pass", consumers: ["BloomNode", "final-output", "no-post"], reachable: true, encoding: "linear HDR" },
        ...(this.stage.cache ? [{ id: "bent-direction-cache", producer: "SpaceLensDirectionCache", consumers: ["space transfer material", ...(this.stage.temporal ? ["SpaceTemporalDirectionHistory"] : [])], reachable: true, encoding: "world direction xyz + termination" }] : []),
        ...(stageDescription.plannedDirectMetricProbeDispatches > 0 ? [{ id: "metric-probe-results", producer: "space integrator stage", consumers: ["validation readback"], reachable: true, encoding: "state + invariant + termination" }] : []),
      ],
      sceneSubmissions: [
        { id: "scene-pass", owner: "SpaceIntegratorLab", kind: "lit-scene", count: 1 },
        { id: "bloom-post", owner: "SpaceIntegratorLab", kind: "post", count: 1 },
      ],
      computeDispatches,
      resources,
      finalToneMapOwner: "renderOutput",
      finalOutputTransformOwner: "renderOutput",
    };
  }

  describeMechanism() {
    return {
      scenario: this.scenario,
      quality: this.quality,
      mode: this.mode,
      outputColorTransform: this.renderPipeline.outputColorTransform,
      stage: this.stage.describePipeline(),
    };
  }

  describeResources() {
    return {
      stage: this.stage.describeResources(),
      renderTargets: this.scenePass.renderTarget.textures.map((textureValue) => ({
        name: textureValue.name,
        width: this.scenePass.renderTarget.width,
        height: this.scenePass.renderTarget.height,
        format: textureValue.format,
        type: textureValue.type,
      })),
      bloom: {
        resolutionScale: this.bloomPass.getResolutionScale?.() ?? 0.5,
        internalTargets: "runtime-owned by BloomNode; native capture remains required",
      },
    };
  }

  async readMechanismEvidence() {
    if (typeof this.stage.readProbeEvidence !== "function") {
      return {
        allValid: false,
        verdict: "INSUFFICIENT_EVIDENCE",
        reason: "Selected artistic stage has no direct metric probe readback.",
      };
    }
    const readback = await this.stage.readProbeEvidence(this.renderer);
    if (readback.model === "schwarzschild-convergence") {
      const probes = readback.probes.map((probe, index) =>
        summarizeProbeReadback(probe, readback.stepSizes[index]));
      const refinementErrors = probes.map((probe) => probe.maximumReferenceError);
      return {
        model: readback.model,
        stepSizes: readback.stepSizes,
        probes,
        refinementErrors,
        allValid: probes.every((probe) => probe.allValid &&
          probe.maximumParityError <= 0.05 && probe.maximumReferenceError <= 0.05) &&
          refinementErrors[2] <= Math.max(refinementErrors[0], refinementErrors[1]) + 1e-5,
      };
    }
    const output = Array.from(readback.output.slice(0, readback.count * 4));
    const diagnostics = Array.from(readback.diagnostics.slice(0, readback.count * 4));
    const results = Array.from(readback.results.slice(0, readback.count * 4));
    const maxSteps = readback.maxSteps ?? 0;
    const probeVerdicts = Array.from({ length: readback.count }, (_, index) => {
      const base = index * 4;
      const termination = results[base];
      const acceptedSteps = results[base + 1];
      const complete = readback.model === "ellis"
        ? termination === SPACE_PROBE_TERMINATION.escaped
        : [SPACE_PROBE_TERMINATION.escaped, SPACE_PROBE_TERMINATION.horizon].includes(termination);
      return {
        termination,
        acceptedSteps,
        invariantDrift: diagnostics[base],
        valid: complete && acceptedSteps > 0 && acceptedSteps <= maxSteps &&
          Number.isFinite(diagnostics[base]) && diagnostics[base] <= 5e-4 &&
          output.slice(base, base + 4).every(Number.isFinite),
      };
    });
    return {
      model: readback.model,
      count: readback.count,
      maxSteps,
      output,
      diagnostics,
      results,
      probeVerdicts,
      allValid: probeVerdicts.every(({ valid }) => valid),
    };
  }

  getMetrics() {
    const timestamps = this.renderer.hasFeature?.("timestamp-query") === true;
    return {
      scenario: this.scenario,
      quality: this.quality,
      mode: this.mode,
      seed: this.seed,
      routeLocked: this.routeLocked,
      frameIndex: this.frameIndex,
      backend: this.renderer.backend?.isWebGPUBackend === true ? "WebGPU" : "unsupported",
      timestampVerdict: timestamps ? "available-not-resolved" : "INSUFFICIENT_EVIDENCE",
      rendererInfo: this.renderer.info,
    };
  }

  async dispose() {
    if (this.disposed) return;
    this.destroyStage();
    this.renderPipeline.dispose?.();
    this.captureTarget?.dispose();
    this.renderer.dispose();
    this.disposed = true;
  }
}

export async function mountSpaceIntegratorLab({ canvas, status, metrics, animate = true } = {}) {
  const selection = routeSelection();
  const lab = new SpaceIntegratorLab({ canvas, ...selection });
  await lab.ready();
  await lab.resize(
    Math.max(1, globalThis.innerWidth ?? 1200),
    Math.max(1, globalThis.innerHeight ?? 800),
    Math.min(globalThis.devicePixelRatio ?? 1, 2),
  );
  globalThis.__THREE_LAB__ = lab;
  if (status) status.textContent = `native WebGPU · ${selection.scenario} · ${selection.quality}`;
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
  if (animate) request = requestAnimationFrame(frame);
  return { lab, stop: async () => { cancelAnimationFrame(request); await lab.dispose(); } };
}
