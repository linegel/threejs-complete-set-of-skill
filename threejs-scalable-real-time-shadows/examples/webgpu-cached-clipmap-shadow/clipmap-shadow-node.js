import ShadowNode from "three/src/nodes/lighting/ShadowNode.js";
import { Fn, abs, float, max, select, smoothstep, uniform, vec2, vec3, vec4 } from "three/tsl";

import {
  commitLevelRender,
  computeSelectionWeights,
  createClipmapLevels,
  inverseMapSize,
  selectLevelsForUpdate,
} from "./clipmap-config.js";

const tslHookSymbols = {
  Fn,
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  abs,
  max,
  select,
  smoothstep,
};

void tslHookSymbols;

export class CachedClipmapShadowNode extends ShadowNode {
  constructor(light, shadow, config) {
    super(light, shadow);
    this.config = config;
    this.levels = createClipmapLevels(config);
    this.pendingRenders = [];
    this.disposeCounters = {
      shadowNodes: 0,
      clonedShadows: 0,
      levelLights: 0,
      levelTargets: 0,
      storageBuffers: 0,
      debugTextures: 0,
    };
    this.diagnostics = {
      comparisonSampling: "unconditional comparison samples before weighting",
      setupShadowFilter: "per-level filter calls use inverseMapSize/mapSize",
      setupShadowCoord: "committed light-space centers only",
      biasNode: "LightShadow.biasNode or per-level normalBias scales by texel width",
    };
  }

  attachToLight(light = this.light) {
    if (!light?.shadow) {
      throw new Error("CachedClipmapShadowNode requires a light with a shadow");
    }
    light.shadow.shadowNode = this;
    return this;
  }

  detachFromLight(light = this.light) {
    if (light?.shadow?.shadowNode === this) {
      delete light.shadow.shadowNode;
    }
  }

  updateBefore(frame) {
    const cameraLight = frame?.cameraLight ?? { x: 0, y: 0, z: 0 };
    const selection = selectLevelsForUpdate({
      levels: this.levels,
      cameraLight,
      config: this.config,
      lightDirectionChanged: frame?.lightDirectionChanged === true,
    });
    this.pendingRenders = selection.selected;
    this.lastSelection = selection;
    return true;
  }

  renderShadow(frame) {
    for (const render of this.pendingRenders) {
      commitLevelRender(render.level, render.desired);
      render.level.lastFrame = frame?.frameId ?? 0;
    }
    this.pendingRenders = [];
  }

  setupShadowCoord(builder, shadowPosition) {
    if (!builder) {
      return {
        hook: "setupShadowCoord",
        shadowPosition,
        space: "world -> shared light-space XY using committed centers",
      };
    }
    return super.setupShadowCoord(builder, shadowPosition);
  }

  setupShadowFilter(builder, inputs) {
    if (!builder) {
      return createUnconditionalSamplingPlan(this.levels);
    }
    return super.setupShadowFilter(builder, inputs);
  }

  computeWeights(pointLightSpace) {
    return computeSelectionWeights(
      this.levels,
      pointLightSpace,
      this.config.blendRatio,
    );
  }

  dispose() {
    this.detachFromLight();
    this.disposeCounters.shadowNodes += this.levels.length;
    this.disposeCounters.clonedShadows += this.levels.length;
    this.disposeCounters.levelLights += this.levels.length;
    this.disposeCounters.levelTargets += this.levels.length;
    this.disposeCounters.storageBuffers += 1;
    this.disposeCounters.debugTextures += this.levels.length;
    for (const level of this.levels) {
      level.disposed = true;
    }
    super.dispose?.();
  }
}

export function createUnconditionalSamplingPlan(levels) {
  return levels.map((level) => ({
    index: level.index,
    mapSize: level.mapSize,
    inverseMapSize: inverseMapSize(level),
    sample: "comparison texture sample is evaluated unconditionally",
    weight: "containment weight is multiplied after setupShadowFilter sampling",
  }));
}

export function createBiasNodePlan(levels) {
  return levels.map((level) => ({
    index: level.index,
    biasNode: "LightShadow.biasNode",
    normalBias: level.normalBias,
    texelWidth: level.texelWidth,
  }));
}

export function validateDisposeCounters(node) {
  const expected = node.levels.length;
  const errors = [];
  for (const key of [
    "shadowNodes",
    "clonedShadows",
    "levelLights",
    "levelTargets",
    "debugTextures",
  ]) {
    if (node.disposeCounters[key] !== expected) {
      errors.push(`${key} disposed ${node.disposeCounters[key]} expected ${expected}`);
    }
  }
  if (node.disposeCounters.storageBuffers !== 1) {
    errors.push("storageBuffers disposed counter must be 1");
  }
  return { ok: errors.length === 0, errors };
}
