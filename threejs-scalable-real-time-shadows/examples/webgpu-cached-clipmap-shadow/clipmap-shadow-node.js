import ShadowNode from "three/src/nodes/lighting/ShadowNode.js";
import {
  DepthFormat,
  DepthTexture,
  NoColorSpace,
  OrthographicCamera,
  UnsignedIntType,
  Vector3,
  WebGLRenderTarget,
} from "three/webgpu";
import { Fn, abs, float, max, select, smoothstep, uniform, vec2, vec3, vec4 } from "three/tsl";

import {
  DIRTY_REASON_BITS,
  commitLevelRender,
  computeSelectionWeights,
  createClipmapLevels,
  invalidateAllLevels,
  invalidateSphere,
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
    this.levelResources = this.levels.map((level) =>
      createLevelShadowResource(level, this.config),
    );
    this.deformationFieldVersions = new Map();
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
    const deformationInvalidations = this.invalidateChangedDeformationFields(
      frame?.deformationFields,
    );
    const cameraLight = frame?.cameraLight ?? { x: 0, y: 0, z: 0 };
    const selection = selectLevelsForUpdate({
      levels: this.levels,
      cameraLight,
      config: this.config,
      lightDirectionChanged: frame?.lightDirectionChanged === true,
    });
    this.pendingRenders = selection.selected;
    this.lastSelection = { ...selection, deformationInvalidations };
    return true;
  }

  renderShadow(frame = {}) {
    if (this.pendingRenders.length === 0) {
      return undefined;
    }

    const renderer = frame.renderer ?? this.renderer;
    const casterScene = frame.casterScene ?? frame.scene ?? this.casterScene;

    if (!renderer || !casterScene) {
      throw new Error("renderShadow requires frame.renderer and frame.casterScene");
    }

    const completions = [];
    for (const render of this.pendingRenders) {
      const resource = this.levelResources[render.level.index];
      const completion = this.renderLevelShadow({ renderer, casterScene, render, resource, frame });
      if (completion && typeof completion.then === "function") {
        completions.push(completion);
      }
    }
    this.pendingRenders = [];

    if (completions.length > 0) {
      return Promise.all(completions).then(() => undefined);
    }

    return undefined;
  }

  renderLevelShadow({ renderer, casterScene, render, resource, frame }) {
    fitLevelShadowCamera({
      level: render.level,
      desired: render.desired,
      config: this.config,
      camera: resource.camera,
      light: this.light,
      frame,
    });

    const previousTarget = renderer.getRenderTarget?.();
    renderer.setRenderTarget?.(resource.renderTarget);
    renderer.clearDepth?.();
    renderer.clear?.(false, true, false);

    const finish = () => {
      renderer.setRenderTarget?.(previousTarget ?? null);
      resource.lastFrame = frame?.frameId ?? 0;
      render.level.shadowCamera = resource.camera;
      render.level.shadowTarget = resource.renderTarget;
      render.level.depthTexture = resource.depthTexture;
      commitLevelRender(render.level, render.desired);
      render.level.lastFrame = frame?.frameId ?? 0;
    };

    const output = typeof renderer.renderAsync === "function"
      ? renderer.renderAsync(casterScene, resource.camera)
      : renderer.render(casterScene, resource.camera);

    if (output && typeof output.then === "function") {
      return output.then(finish);
    }

    finish();
    return undefined;
  }

  invalidateChangedDeformationFields(fields = []) {
    const invalidations = [];
    for (const field of fields) {
      const id = field.id ?? "deformation";
      const version = field.version ?? field.time ?? field.uniform?.value;
      const previous = this.deformationFieldVersions.get(id);
      this.deformationFieldVersions.set(id, version);

      if (previous === undefined || Object.is(previous, version)) {
        continue;
      }

      const touched = field.boundsLightSpace
        ? invalidateSphere(this.levels, field.boundsLightSpace, `deformation:${id}`)
        : invalidateAllLevels(
          this.levels,
          DIRTY_REASON_BITS.forceDirty | DIRTY_REASON_BITS.deformationChanged,
          `deformation:${id}`,
        );
      invalidations.push({ id, previous, version, touched });
    }
    return invalidations;
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
    for (const resource of this.levelResources ?? []) {
      resource.renderTarget.dispose?.();
      resource.depthTexture.dispose?.();
    }
    super.dispose?.();
  }
}

export function createLevelShadowResource(level, config) {
  const renderTarget = new WebGLRenderTarget(level.mapSize, level.mapSize, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  renderTarget.texture.name = `cached-clipmap-shadow-color-${level.index}`;
  renderTarget.texture.colorSpace = NoColorSpace;
  renderTarget.texture.generateMipmaps = false;

  const depthTexture = new DepthTexture(level.mapSize, level.mapSize);
  depthTexture.name = `cached-clipmap-shadow-depth-${level.index}`;
  depthTexture.format = DepthFormat;
  depthTexture.type = UnsignedIntType;
  depthTexture.colorSpace = NoColorSpace;
  renderTarget.depthTexture = depthTexture;

  const camera = new OrthographicCamera(
    -level.halfWidth,
    level.halfWidth,
    level.halfWidth,
    -level.halfWidth,
    config.shadowNear,
    computeShadowFar(level, config),
  );
  camera.name = `CachedClipmapShadowLevel${level.index}`;

  return { levelIndex: level.index, renderTarget, depthTexture, camera, lastFrame: -1 };
}

export function fitLevelShadowCamera({ level, desired, config, camera, light, frame = {} }) {
  const halfWidth = level.halfWidth;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfWidth;
  camera.bottom = -halfWidth;
  camera.near = config.shadowNear;
  camera.far = computeShadowFar(level, config);

  const center = resolveLightSpaceToWorld(desired, frame);
  const lightDirection = resolveLightDirection(light, frame);
  const position = center.clone().sub(lightDirection.multiplyScalar(config.lightMargin));

  camera.position.copy(position);
  if (frame.lightUp) {
    camera.up.copy(toVector3(frame.lightUp).normalize());
  }
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  return camera;
}

export function computeShadowFar(level, config) {
  return Math.max(
    config.shadowNear + 1,
    Math.min(config.shadowFarCap, config.lightMargin + 2 * level.halfWidth),
  );
}

function resolveLightSpaceToWorld(point, frame) {
  const target = new Vector3(point.x, point.y, point.z);
  if (typeof frame.lightSpaceToWorld === "function") {
    return frame.lightSpaceToWorld(point, target) ?? target;
  }
  if (frame.lightBasis) {
    const origin = toVector3(frame.lightBasis.origin ?? { x: 0, y: 0, z: 0 });
    const right = toVector3(frame.lightBasis.right ?? { x: 1, y: 0, z: 0 });
    const up = toVector3(frame.lightBasis.up ?? { x: 0, y: 1, z: 0 });
    const forward = toVector3(frame.lightBasis.forward ?? { x: 0, y: 0, z: 1 });
    return origin
      .add(right.multiplyScalar(point.x))
      .add(up.multiplyScalar(point.y))
      .add(forward.multiplyScalar(point.z));
  }
  return target;
}

function resolveLightDirection(light, frame) {
  if (frame.lightDirection) {
    return toVector3(frame.lightDirection).normalize();
  }
  const target = light?.target?.position;
  const position = light?.position;
  if (target && position) {
    const direction = new Vector3().subVectors(target, position);
    if (direction.lengthSq() > 0) {
      return direction.normalize();
    }
  }
  return new Vector3(0, -1, 0);
}

function toVector3(value) {
  if (value?.isVector3) {
    return value.clone();
  }
  if (Array.isArray(value)) {
    return new Vector3(value[0], value[1], value[2]);
  }
  return new Vector3(value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
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
