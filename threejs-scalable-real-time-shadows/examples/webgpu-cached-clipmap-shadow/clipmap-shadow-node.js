import {
  DepthFormat,
  DepthTexture,
  NoColorSpace,
  OrthographicCamera,
  RenderTarget,
  RendererUtils,
  ShadowNode,
  UnsignedIntType,
  Vector3,
} from "three/webgpu";
import { Fn, abs, float, max, select, smoothstep, uniform, vec2, vec3, vec4 } from "three/tsl";

import {
  CLIPMAP_IMPLEMENTATION_STATUS,
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

const lightUpParallelGate = 0.999999; // Gated deterministic-fixture singularity check.

export class CachedClipmapShadowNode extends ShadowNode {
  constructor(light, shadow, config) {
    super(light, shadow);
    this.config = config;
    this.implementationStatus = CLIPMAP_IMPLEMENTATION_STATUS;
    this.levels = createClipmapLevels(config);
    this.pendingRenders = [];
    this.disposeCounters = {
      attachmentDetaches: 0,
      levelTargets: 0,
    };
    this.levelResources = this.levels.map((level) =>
      createLevelShadowResource(level, this.config),
    );
    this.deformationFieldVersions = new Map();
    this.disposed = false;
    this.diagnostics = {
      comparisonSampling: "all child nodes statically reachable; stock r185 child comparison is frustum-gated before weighting",
      setupShadowFilter: "per-level filter calls use inverseMapSize/mapSize",
      setupShadowCoord: "committed light-space centers only",
      biasNode:
        "unwired Phase-1 hypothesis; production bias needs receiver-plane gradients, filter support, depth span, and detachment caps",
    };
  }

  setup(builder) {
    if (builder && this.implementationStatus.receiverBlendImplemented !== true) {
      throw new Error(
        "CachedClipmapShadowNode is a Phase-1 scheduler scaffold; production receiver setup is not implemented",
      );
    }
    return super.setup(builder);
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

    let rendererState;

    // The renderer is initialized by the owner. r185 deprecates renderAsync();
    // RendererUtils resets autoClear to true, so render() performs exactly one
    // target clear while preserving target face/mip, MRT, clear, and callback
    // state for the owner.
    try {
      rendererState = RendererUtils.resetRendererState(renderer, rendererState);
      renderer.setRenderTarget(resource.renderTarget);
      renderer.render(casterScene, resource.camera);
    } finally {
      if (rendererState) RendererUtils.restoreRendererState(renderer, rendererState);
    }

    resource.lastFrame = frame?.frameId ?? 0;
    render.level.shadowCamera = resource.camera;
    render.level.shadowTarget = resource.renderTarget;
    render.level.depthTexture = resource.depthTexture;
    commitLevelRender(render.level, render.desired);
    render.level.lastFrame = frame?.frameId ?? 0;
    return undefined;
  }

  invalidateChangedDeformationFields(fields = []) {
    const invalidations = [];
    for (const field of fields) {
      const id = field.id ?? "deformation";
      const version = field.version ?? field.time ?? field.uniform?.value;
      const currentBounds = cloneLightSpaceSphere(field.boundsLightSpace);
      const previous = this.deformationFieldVersions.get(id);
      this.deformationFieldVersions.set(id, { version, bounds: currentBounds });

      if (previous === undefined || Object.is(previous.version, version)) {
        continue;
      }

      const sweptBounds = previous.bounds && currentBounds
        ? encloseLightSpaceSpheres(previous.bounds, currentBounds)
        : null;
      const touched = sweptBounds
        ? invalidateSphere(this.levels, sweptBounds, `deformation:${id}`)
        : invalidateAllLevels(
          this.levels,
          DIRTY_REASON_BITS.forceDirty | DIRTY_REASON_BITS.deformationChanged,
          `deformation:${id}`,
        );
      invalidations.push({
        id,
        previous: previous.version,
        version,
        previousBounds: previous.bounds,
        currentBounds,
        sweptBounds,
        touched,
      });
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
      return createStaticChildSamplingPlan(this.levels);
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
    if (this.disposed) return;
    this.disposed = true;
    const wasAttached = this.light?.shadow?.shadowNode === this;
    this.detachFromLight();
    if (wasAttached) this.disposeCounters.attachmentDetaches += 1;
    for (const level of this.levels) {
      level.disposed = true;
    }
    for (const resource of this.levelResources ?? []) {
      resource.renderTarget.dispose?.();
      this.disposeCounters.levelTargets += 1;
    }
    this.pendingRenders.length = 0;
    this.deformationFieldVersions.clear();
    super.dispose?.();
  }
}

function cloneLightSpaceSphere(sphere) {
  if (!sphere) return null;
  if (
    ![sphere.x, sphere.y, sphere.radius].every(Number.isFinite) ||
    sphere.radius < 0
  ) {
    throw new RangeError("deformation bounds require finite x/y and radius >= 0");
  }
  return {
    x: sphere.x,
    y: sphere.y,
    radius: sphere.radius,
  };
}

function encloseLightSpaceSpheres(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (a.radius >= distance + b.radius) return { ...a };
  if (b.radius >= distance + a.radius) return { ...b };
  if (distance === 0) {
    return { x: a.x, y: a.y, radius: Math.max(a.radius, b.radius) };
  }
  const radius = 0.5 * (distance + a.radius + b.radius);
  const t = (radius - a.radius) / distance;
  return {
    x: a.x + dx * t,
    y: a.y + dy * t,
    radius,
  };
}

export function createLevelShadowResource(level, config) {
  const renderTarget = new RenderTarget(level.mapSize, level.mapSize, {
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
  const depthInterval = frame.shadowDepthInterval ?? {
    near: config.shadowNear,
    far: config.shadowFarCap,
  };
  if (
    !Number.isFinite(depthInterval.near) ||
    !Number.isFinite(depthInterval.far) ||
    !(depthInterval.near > 0 && depthInterval.far > depthInterval.near)
  ) {
    throw new Error("shadowDepthInterval must satisfy 0 < near < far");
  }
  camera.near = depthInterval.near;
  camera.far = depthInterval.far;

  const center = resolveLightSpaceToWorld(desired, frame);
  const lightDirection = resolveLightDirection(light, frame);
  const position = center.clone().addScaledVector(lightDirection, -config.lightMargin);

  camera.position.copy(position);
  const lightUp = frame.lightUp
    ? requireFiniteNonzeroVector(toVector3(frame.lightUp), "lightUp").normalize()
    : leastAlignedAxis(lightDirection);
  if (Math.abs(lightUp.dot(lightDirection)) >= lightUpParallelGate) {
    throw new RangeError("lightUp must not be parallel to lightDirection");
  }
  camera.up.copy(lightUp);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  return camera;
}

export function computeShadowFar(level, config) {
  void level;
  return config.shadowFarCap;
}

function resolveLightSpaceToWorld(point, frame) {
  const target = new Vector3(point.x, point.y, point.z);
  if (typeof frame.lightSpaceToWorld === "function") {
    return requireFiniteVector(
      frame.lightSpaceToWorld(point, target) ?? target,
      "lightSpaceToWorld result",
    );
  }
  if (frame.lightBasis) {
    const origin = toVector3(frame.lightBasis.origin ?? { x: 0, y: 0, z: 0 });
    const right = toVector3(frame.lightBasis.right ?? { x: 1, y: 0, z: 0 });
    const up = toVector3(frame.lightBasis.up ?? { x: 0, y: 1, z: 0 });
    const forward = toVector3(frame.lightBasis.forward ?? { x: 0, y: 0, z: 1 });
    return requireFiniteVector(origin
      .add(right.multiplyScalar(point.x))
      .add(up.multiplyScalar(point.y))
      .add(forward.multiplyScalar(point.z)), "lightBasis transform");
  }
  return requireFiniteVector(target, "light-space point");
}

function resolveLightDirection(light, frame) {
  if (frame.lightDirection) {
    return requireFiniteNonzeroVector(
      toVector3(frame.lightDirection),
      "lightDirection",
    ).normalize();
  }
  const target = light?.target?.getWorldPosition
    ? light.target.getWorldPosition(new Vector3())
    : light?.target?.position;
  const position = light?.getWorldPosition
    ? light.getWorldPosition(new Vector3())
    : light?.position;
  if (target && position) {
    const direction = new Vector3().subVectors(target, position);
    return requireFiniteNonzeroVector(direction, "light world direction").normalize();
  }
  throw new RangeError("a finite nonzero lightDirection or world-space light/target is required");
}

function requireFiniteVector(value, label) {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new RangeError(`${label} must be finite`);
  }
  return value;
}

function requireFiniteNonzeroVector(value, label) {
  requireFiniteVector(value, label);
  if (value.lengthSq() === 0) throw new RangeError(`${label} must be nonzero`);
  return value;
}

function leastAlignedAxis(direction) {
  const ax = Math.abs(direction.x);
  const ay = Math.abs(direction.y);
  const az = Math.abs(direction.z);
  if (ax <= ay && ax <= az) return new Vector3(1, 0, 0);
  if (ay <= az) return new Vector3(0, 1, 0);
  return new Vector3(0, 0, 1);
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

export function createStaticChildSamplingPlan(levels) {
  return levels.map((level) => ({
    index: level.index,
    mapSize: level.mapSize,
    inverseMapSize: inverseMapSize(level),
    sample: "child node remains statically reachable; stock r185 comparison is frustum-gated",
    weight: "containment weight is multiplied after setupShadowFilter sampling",
  }));
}

// Backward-compatible Phase-1 API name. The returned contract is intentionally
// truthful about r185 child-node frustum gating.
export const createUnconditionalSamplingPlan = createStaticChildSamplingPlan;

export function createBiasNodePlan(levels) {
  return levels.map((level) => ({
    index: level.index,
    status: "unwired-hypothesis",
    biasNode: null,
    normalBias: null,
    normalBiasHypothesis: level.normalBiasHypothesis,
    texelWidth: level.texelWidth,
  }));
}

export function validateDisposeCounters(node) {
  const expected = node.levels.length;
  const errors = [];
  if (node.disposeCounters.levelTargets !== expected) {
    errors.push(
      `levelTargets disposed ${node.disposeCounters.levelTargets} expected ${expected}`,
    );
  }
  if (node.disposeCounters.attachmentDetaches !== 1) {
    errors.push("the attached custom node must detach exactly once");
  }
  return { ok: errors.length === 0, errors };
}
