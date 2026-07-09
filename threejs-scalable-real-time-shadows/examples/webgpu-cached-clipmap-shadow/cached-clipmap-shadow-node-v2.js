import {
  Object3D,
  ShadowBaseNode,
  Vector2,
  Vector3,
  VSMShadowMap,
} from "three/webgpu";
import {
  Fn,
  NodeUpdateType,
  float,
  positionWorld,
  shadow,
  smoothstep,
  uniform,
} from "three/tsl";

import {
  DIRTY_REASON_BITS,
  commitLevelRender,
  createClipmapLevels,
  directionChanged,
  invalidateAllLevels,
  invalidateSphere,
  selectLevelsForUpdateFair,
} from "./clipmap-config.js";

const _worldPosition = new Vector3();
const _lightPosition = new Vector3();
const _lightTarget = new Vector3();
const _candidateDirection = new Vector3();
const _referenceAxis = new Vector3();
const _centerWorld = new Vector3();
const _levelLightWorld = new Vector3();
const _levelLightLocal = new Vector3();
const _levelTargetLocal = new Vector3();
const _cameraLight = new Vector3();
const _relative = new Vector3();

/**
 * Runtime status deliberately separates implementation from evidence. The
 * composite below is reachable from receiver materials and delegates each
 * selected render to a real r185 ShadowNode. It is not accepted evidence until
 * the browser capture validates those resources on a WebGPU adapter.
 */
export const CACHED_CLIPMAP_V2_STATUS = Object.freeze({
  phase: "runtime-implemented-evidence-pending",
  receiverBlendImplemented: true,
  childShadowNodesOwnTargets: true,
  productionClipmapProof: false,
  evidenceBlocker:
    "no accepted v2 bundle currently combines receiver/depth proof with numeric ROI, current-adapter timing, and lifecycle evidence",
});

class ClipmapLevelLight extends Object3D {
  constructor() {
    super();
    this.target = new Object3D();
    this.castShadow = true;
  }
}

/**
 * A portable cached directional-shadow composite for Three.js r185.
 *
 * Each level is a normal r185 ShadowNode with an independent comparison-depth
 * target. The receiver graph statically includes every child node, while each
 * stock r185 ShadowNode retains its own frustum-gated comparison. The graph
 * then applies fine-to-coarse containment weights; no dynamic texture index or
 * application-authored divergent branch selects a level.
 */
export class CachedClipmapShadowNodeV2 extends ShadowBaseNode {
  constructor(light, config) {
    super(light);
    if (!light?.shadow) {
      throw new TypeError("CachedClipmapShadowNodeV2 requires a shadow-casting light");
    }

    this.config = config;
    this.status = CACHED_CLIPMAP_V2_STATUS;
    this.levels = createClipmapLevels(config);
    this.levelLights = [];
    this.childShadowNodes = [];
    this.schedulerState = { roundRobinCursor: 0 };
    this.pendingRenders = [];
    this.frameSerial = 0;
    this.basisEpoch = 0;
    this.basis = {
      valid: false,
      anchor: new Vector3(),
      direction: new Vector3(0, -1, 0),
      right: new Vector3(1, 0, 0),
      up: new Vector3(0, 0, 1),
    };
    this.basisUniforms = {
      anchor: uniform(this.basis.anchor),
      right: uniform(this.basis.right),
      up: uniform(this.basis.up),
    };
    this.levelUniforms = this.levels.map((level) => ({
      center: uniform(new Vector2(level.centerX, level.centerY)),
      valid: uniform(0),
    }));
    this.deformationVersions = new Map();
    this.worldDeformationFields = new Map();
    this.lastSelection = null;
    this.disposed = false;
    this.metrics = {
      sceneSubmissionCount: 0,
      rendererInvocationCount: 0,
      childShadowUpdateCount: 0,
      correctnessInvalidationCount: 0,
      basisEpochCount: 0,
    };
    this.lastFrameMetrics = createShadowFrameMetrics(-1);

    this.#createChildren();
  }

  #createChildren() {
    const finestTexel = this.levels[0]?.texelWidth ?? 1;
    for (const level of this.levels) {
      const levelLight = new ClipmapLevelLight();
      levelLight.name = `CachedClipmapLevelLight${level.index}`;
      const levelShadow = this.light.shadow.clone();
      // r185 LightShadow.copy() omits these dynamic/source properties.
      levelShadow.filterNode = this.light.shadow.filterNode;
      levelShadow.mapType = this.light.shadow.mapType;
      levelShadow.mapSize.set(level.mapSize, level.mapSize);
      levelShadow.camera.left = -level.halfWidth;
      levelShadow.camera.right = level.halfWidth;
      levelShadow.camera.top = level.halfWidth;
      levelShadow.camera.bottom = -level.halfWidth;
      levelShadow.camera.near = this.config.shadowNear;
      levelShadow.camera.far = this.config.shadowFarCap;
      levelShadow.camera.updateProjectionMatrix();
      levelShadow.autoUpdate = false;
      levelShadow.needsUpdate = false;

      // Derived from the fixture's world-texel ratio and capped by an Authored
      // contact-detachment ceiling. Validation must still prove the cap through
      // the bias-sweep route before making a quality claim.
      const scaledNormalBias =
        this.config.baseNormalBias * (level.texelWidth / finestTexel);
      const normalBiasCap = this.config.maxNormalBias ?? this.config.baseNormalBias * 8;
      levelShadow.normalBias = Math.min(scaledNormalBias, normalBiasCap);
      levelShadow.bias = this.config.baseBias;
      level.normalBias = levelShadow.normalBias;
      level.bias = levelShadow.bias;

      levelLight.shadow = levelShadow;
      const childNode = shadow(levelLight, levelShadow);
      childNode.updateBeforeType = NodeUpdateType.NONE;

      level.levelLight = levelLight;
      level.childShadowNode = childNode;
      level.shadowCamera = levelShadow.camera;
      this.levelLights.push(levelLight);
      this.childShadowNodes.push(childNode);
    }
  }

  attachToLight(light = this.light) {
    if (light.shadow.shadowNode && light.shadow.shadowNode !== this) {
      throw new Error("directional light already has a different shadowNode owner");
    }
    light.shadow.shadowNode = this;
    return this;
  }

  detachFromLight(light = this.light) {
    if (light?.shadow?.shadowNode === this) delete light.shadow.shadowNode;
  }

  setup(builder) {
    if (builder.renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("CachedClipmapShadowNodeV2 requires the native WebGPU backend");
    }
    if (builder.renderer.shadowMap.transmitted === true) {
      throw new Error("cached clipmap v2 implements opaque comparison depth only");
    }
    if (builder.renderer.shadowMap.type === VSMShadowMap) {
      throw new Error("cached clipmap v2 does not implement VSM distribution/blur ownership");
    }

    return Fn((nodeBuilder) => {
      this.setupShadowPosition(nodeBuilder);

      // Semantic light coordinates are anchored in CPU-double world space. The
      // receiver uniforms contain the committed epoch basis only.
      const relative = positionWorld.sub(this.basisUniforms.anchor);
      const lightX = relative.dot(this.basisUniforms.right);
      const lightY = relative.dot(this.basisUniforms.up);
      const visibility = float(0).toVar("cachedClipmapVisibility");
      const remaining = float(1).toVar("cachedClipmapRemaining");

      for (let index = 0; index < this.childShadowNodes.length; index += 1) {
        const level = this.levels[index];
        const levelUniform = this.levelUniforms[index];
        const dx = lightX.sub(levelUniform.center.x).abs();
        const dy = lightY.sub(levelUniform.center.y).abs();
        const distance = dx.max(dy);
        const outer = float(level.sampledHalfWidth);
        const inner = float(level.sampledHalfWidth * (1 - this.config.blendRatio));
        const fade = float(1)
          .sub(smoothstep(inner, outer, distance))
          .mul(levelUniform.valid);
        const weight = fade.mul(remaining);

        // Keep every child statically reachable before weighting. Stock r185
        // ShadowNode still frustum-gates its own filter; this is not claimed as
        // eager unconditional sampling.
        visibility.addAssign(this.childShadowNodes[index].mul(weight));
        remaining.mulAssign(fade.oneMinus());
      }

      // Any domain not covered by a valid committed level is explicitly lit.
      visibility.addAssign(remaining);
      return visibility;
    })();
  }

  updateBefore(frame) {
    if (this.disposed) return false;
    if (!frame?.renderer || !frame?.scene || !frame?.camera) {
      throw new Error("clipmap updateBefore requires renderer, scene, and camera");
    }
    if (frame.renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("clipmap update requires the native WebGPU backend");
    }

    this.frameSerial += 1;
    const runtimeFrameId = this.frameSerial;
    const frameMetrics = createShadowFrameMetrics(runtimeFrameId);
    frameMetrics.nodeFrameId = Number.isInteger(frame.frameId)
      ? frame.frameId
      : null;
    frameMetrics.renderId = Number.isInteger(frame.renderId)
      ? frame.renderId
      : null;
    this.#ensureChildrenInScene();
    const basisChanged = this.#updateCommittedBasis();
    const cameraLight = this.#projectCamera(frame.camera);
    const deformationInvalidations = this.#invalidateChangedFields([
      ...(frame.shadowDeformationFields ?? []),
      ...this.#projectWorldDeformationFields(),
    ]);
    const selection = selectLevelsForUpdateFair({
      levels: this.levels,
      cameraLight,
      config: this.config,
      lightDirectionChanged: basisChanged,
      schedulerState: this.schedulerState,
      frameId: this.frameSerial,
    });
    this.pendingRenders = [...selection.selected];
    this.lastSelection = {
      ...selection,
      selected: [...selection.selected],
      diagnostics: selection.diagnostics.map((entry) => ({ ...entry })),
      basisEpoch: this.basisEpoch,
      basisChanged,
      deformationInvalidations,
    };
    frameMetrics.selectedLevelIndices = selection.selected.map(
      (entry) => entry.level.index,
    );
    frameMetrics.correctnessInvalidationCount = deformationInvalidations.reduce(
      (sum, record) => sum + record.touched.length,
      0,
    );

    for (const selected of this.pendingRenders) {
      this.#configureLevel(selected.level, selected.desired, frame);
      const child = selected.level.childShadowNode;
      if (!child.shadowMap) {
        throw new Error(
          `level ${selected.level.index} receiver graph has no child shadow target`,
        );
      }
      // r185 ShadowNode owns override material, caster filtering, target state,
      // and restoration. Sequential calls prevent overlapping renderer state.
      child.updateShadow(frame);
      this.metrics.rendererInvocationCount += 1;
      this.metrics.sceneSubmissionCount += 1;
      this.metrics.childShadowUpdateCount += 1;
      frameMetrics.rendererInvocationCount += 1;
      frameMetrics.sceneSubmissionCount += 1;
      frameMetrics.shadowViewCount += 1;
      frameMetrics.backendLayerPassCount += 1;
      this.#commitLevel(selected.level, selected.desired, child, frame);
    }
    this.pendingRenders.length = 0;
    frameMetrics.resourceTargetCount = this.levels.filter(
      (level) => level.shadowTarget != null,
    ).length;
    frameMetrics.executed = frameMetrics.sceneSubmissionCount > 0;
    this.lastFrameMetrics = freezeShadowFrameMetrics(frameMetrics);
    return true;
  }

  #ensureChildrenInScene() {
    const parent = this.light.parent;
    if (!parent) {
      throw new Error("cached clipmap source light must belong to the rendered scene");
    }
    for (const levelLight of this.levelLights) {
      if (levelLight.parent !== parent) {
        parent.add(levelLight.target);
        parent.add(levelLight);
      }
    }
  }

  #updateCommittedBasis() {
    this.light.getWorldPosition(_lightPosition);
    this.light.target.getWorldPosition(_lightTarget);
    _candidateDirection.subVectors(_lightTarget, _lightPosition);
    if (_candidateDirection.lengthSq() === 0) {
      throw new RangeError("directional light and target must not coincide");
    }
    _candidateDirection.normalize();

    if (
      this.basis.valid &&
      !directionChanged(
        this.basis.direction.dot(_candidateDirection),
        this.config.directionEpsilon,
      )
    ) {
      return false;
    }

    this.basis.direction.copy(_candidateDirection);
    deriveStableLightBasis(_candidateDirection, {
      right: this.basis.right,
      up: this.basis.up,
      reference: _referenceAxis,
    });
    this.basis.valid = true;
    this.basisEpoch += 1;
    this.metrics.basisEpochCount += 1;
    if (this.basisEpoch > 1) {
      invalidateAllLevels(
        this.levels,
        DIRTY_REASON_BITS.lightDirectionChanged,
        "light-basis-epoch",
      );
      for (const levelUniform of this.levelUniforms) {
        levelUniform.valid.value = 0;
      }
    }
    return true;
  }

  #projectCamera(camera) {
    camera.getWorldPosition(_worldPosition);
    _relative.subVectors(_worldPosition, this.basis.anchor);
    _cameraLight.set(
      _relative.dot(this.basis.right),
      _relative.dot(this.basis.up),
      _relative.dot(this.basis.direction),
    );
    return { x: _cameraLight.x, y: _cameraLight.y, z: _cameraLight.z };
  }

  #configureLevel(level, desired, frame) {
    const levelLight = level.levelLight;
    const levelShadow = levelLight.shadow;
    const camera = levelShadow.camera;
    camera.left = -level.halfWidth;
    camera.right = level.halfWidth;
    camera.top = level.halfWidth;
    camera.bottom = -level.halfWidth;
    const depthInterval = frame.shadowDepthInterval ?? {
      near: this.config.shadowNear,
      far: this.config.shadowFarCap,
    };
    if (
      !Number.isFinite(depthInterval.near) ||
      !Number.isFinite(depthInterval.far) ||
      depthInterval.near <= 0 ||
      depthInterval.far <= depthInterval.near
    ) {
      throw new RangeError("shadowDepthInterval must satisfy 0 < near < far");
    }
    camera.near = depthInterval.near;
    camera.far = depthInterval.far;
    camera.up.copy(this.basis.up);
    camera.updateProjectionMatrix();

    _centerWorld
      .copy(this.basis.anchor)
      .addScaledVector(this.basis.right, desired.x)
      .addScaledVector(this.basis.up, desired.y)
      .addScaledVector(this.basis.direction, desired.z);
    _levelLightWorld
      .copy(_centerWorld)
      .addScaledVector(this.basis.direction, -this.config.lightMargin);
    worldPositionInParentSpace(
      levelLight.target.parent,
      _centerWorld,
      _levelTargetLocal,
    );
    worldPositionInParentSpace(
      levelLight.parent,
      _levelLightWorld,
      _levelLightLocal,
    );
    levelLight.target.position.copy(_levelTargetLocal);
    levelLight.position.copy(_levelLightLocal);
    levelLight.updateMatrix();
    levelLight.updateMatrixWorld(true);
    levelLight.target.updateMatrix();
    levelLight.target.updateMatrixWorld(true);

    level.desiredCenterLight = { x: desired.x, y: desired.y, z: desired.z };
    level.desiredDepthInterval = { ...depthInterval };
  }

  #commitLevel(level, desired, child, frame) {
    const renderedReasonBits = level.dirtyReasonBits;
    commitLevelRender(level, desired);
    level.committedDepthInterval = { ...level.desiredDepthInterval };
    level.committedBasisEpoch = this.basisEpoch;
    level.renderedContentEpoch = level.contentEpoch;
    level.lastUpdateFrame = this.frameSerial;
    level.shadowTarget = child.shadowMap;
    level.depthTexture = child.shadowMap.depthTexture;
    level.depthTexture.name = `cached-clipmap-shadow-depth-${level.index}`;
    level.colorTexture = child.shadowMap.texture;
    level.colorTexture.name = `cached-clipmap-shadow-color-${level.index}`;
    this.levelUniforms[level.index].center.value.set(desired.x, desired.y);
    this.levelUniforms[level.index].valid.value = level.samplingEnabled === false ? 0 : 1;
    level.lastRenderReasonBits = renderedReasonBits;
    level.lastFrame = frame.frameId ?? this.frameSerial;
  }

  #invalidateChangedFields(fields) {
    const records = [];
    for (const field of fields) {
      const id = field.id ?? "deformation";
      const version = field.version ?? field.time;
      const bounds = validateSphere(field.boundsLightSpace);
      const previous = this.deformationVersions.get(id);
      this.deformationVersions.set(id, { version, bounds });
      if (!previous) {
        if (bounds && this.levels.some((level) => level.valid)) {
          const touched = invalidateSphere(
            this.levels,
            bounds,
            `deformation-added:${id}`,
          );
          for (const item of touched) {
            const level = this.levels[item.index];
            level.contentEpoch += 1;
            this.levelUniforms[item.index].valid.value = 0;
          }
          this.metrics.correctnessInvalidationCount += touched.length;
          records.push({
            id,
            previous: null,
            version,
            swept: bounds,
            touched,
            change: "added",
          });
        }
        continue;
      }
      if (Object.is(previous.version, version)) continue;

      const swept = previous.bounds && bounds
        ? encloseSpheres(previous.bounds, bounds)
        : null;
      const touched = swept
        ? invalidateSphere(this.levels, swept, `deformation:${id}`)
        : invalidateAllLevels(
            this.levels,
            DIRTY_REASON_BITS.deformationChanged,
            `deformation:${id}`,
          );
      for (const item of touched) {
        const level = this.levels[item.index];
        level.contentEpoch += 1;
        this.levelUniforms[item.index].valid.value = 0;
      }
      this.metrics.correctnessInvalidationCount += touched.length;
      records.push({ id, previous: previous.version, version, swept, touched });
    }
    return records;
  }

  notifyCasterBounds({ id, version, centerWorld, radius }) {
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("caster bounds require a nonempty id");
    }
    if (!Number.isFinite(version)) throw new RangeError("caster bounds version must be finite");
    const center = centerWorld?.isVector3
      ? centerWorld.clone()
      : new Vector3(centerWorld?.x, centerWorld?.y, centerWorld?.z);
    if (![center.x, center.y, center.z, radius].every(Number.isFinite) || radius < 0) {
      throw new RangeError("caster world bounds require finite center and radius >= 0");
    }
    this.worldDeformationFields.set(id, { id, version, centerWorld: center, radius });
  }

  removeCasterBounds(id, reason = "caster-removed") {
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("removed caster id must be nonempty");
    }
    const previous = this.worldDeformationFields.get(id);
    if (!previous) return [];
    this.worldDeformationFields.delete(id);
    this.deformationVersions.delete(id);
    if (!this.basis.valid) return [];
    _relative.subVectors(previous.centerWorld, this.basis.anchor);
    const touched = invalidateSphere(
      this.levels,
      {
        x: _relative.dot(this.basis.right),
        y: _relative.dot(this.basis.up),
        radius: previous.radius,
      },
      `${reason}:${id}`,
    );
    for (const item of touched) {
      const level = this.levels[item.index];
      level.contentEpoch += 1;
      this.levelUniforms[item.index].valid.value = 0;
    }
    this.metrics.correctnessInvalidationCount += touched.length;
    return touched;
  }

  setLevelSamplingEnabled(index, enabled) {
    const level = this.levels[index];
    if (!level) throw new RangeError(`unknown clipmap level: ${index}`);
    if (typeof enabled !== "boolean") throw new TypeError("enabled must be boolean");
    level.samplingEnabled = enabled;
    this.levelUniforms[index].valid.value = level.valid && enabled ? 1 : 0;
  }

  setLevelBias(index, { bias, normalBias }) {
    const level = this.levels[index];
    if (!level) throw new RangeError(`unknown clipmap level: ${index}`);
    if (!Number.isFinite(bias) || !Number.isFinite(normalBias) || normalBias < 0) {
      throw new RangeError("bias must be finite and normalBias must be finite/nonnegative");
    }
    const detachmentGate = this.config.maxNormalBias ?? this.config.baseNormalBias * 8;
    if (normalBias > detachmentGate) {
      throw new RangeError(`normalBias exceeds contact-detachment gate ${detachmentGate}`);
    }
    level.levelLight.shadow.bias = bias;
    level.levelLight.shadow.normalBias = normalBias;
    level.bias = bias;
    level.normalBias = normalBias;
  }

  invalidateAll(
    reasonBit = DIRTY_REASON_BITS.forceDirty,
    reason = "external-invalidation",
  ) {
    const touched = invalidateAllLevels(this.levels, reasonBit, reason);
    for (const item of touched) {
      this.levelUniforms[item.index].valid.value = 0;
    }
    this.metrics.correctnessInvalidationCount += touched.length;
    return touched;
  }

  #projectWorldDeformationFields() {
    if (!this.basis.valid) return [];
    const fields = [];
    for (const field of this.worldDeformationFields.values()) {
      _relative.subVectors(field.centerWorld, this.basis.anchor);
      fields.push({
        id: field.id,
        version: field.version,
        boundsLightSpace: {
          x: _relative.dot(this.basis.right),
          y: _relative.dot(this.basis.up),
          radius: field.radius,
        },
      });
    }
    return fields;
  }

  describeResources() {
    return this.levels.map((level) => ({
      level: level.index,
      valid: level.valid,
      resident: level.shadowTarget != null,
      mapSize: [
        level.shadowTarget?.width ?? level.mapSize,
        level.shadowTarget?.height ?? level.mapSize,
      ],
      colorAttachment: level.colorTexture?.name ?? null,
      depthAttachment: level.depthTexture?.name ?? null,
      colorFormat: level.colorTexture?.format ?? null,
      depthFormat: level.depthTexture?.format ?? null,
      nominalBytes:
        level.mapSize *
        level.mapSize *
        (this.config.bytesPerColorTexel + this.config.bytesPerDepthTexel),
    }));
  }

  describePipeline() {
    const resources = this.describeResources();
    return {
      owner: "CachedClipmapShadowNodeV2",
      receiverTopology: "independent-textures-static-loop-frustum-gated",
      basisEpoch: this.basisEpoch,
      childShadowNodeCount: this.childShadowNodes.length,
      selectedUpdates: this.lastSelection?.selected.map((entry) => entry.level.index) ?? [],
      sceneSubmissionCount: this.lastFrameMetrics.sceneSubmissionCount,
      rendererInvocationCount: this.lastFrameMetrics.rendererInvocationCount,
      frameMetrics: { ...this.lastFrameMetrics },
      cumulativeMetrics: { ...this.metrics },
      resourceTotals: {
        targetCount: resources.length,
        residentTargetCount: resources.filter((resource) => resource.resident).length,
        nominalBytes: resources.reduce(
          (sum, resource) => sum + resource.nominalBytes,
          0,
        ),
        transientAndStagingBytes: null,
        transientAndStagingVerdict: "INSUFFICIENT_EVIDENCE",
      },
      resources,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.detachFromLight();
    for (let index = 0; index < this.levelLights.length; index += 1) {
      const levelLight = this.levelLights[index];
      levelLight.parent?.remove(levelLight.target);
      levelLight.parent?.remove(levelLight);
      const child = this.childShadowNodes[index];
      child.dispose?.();
      levelLight.shadow.map = null;
      this.levels[index].disposed = true;
      this.levels[index].shadowTarget = null;
      this.levels[index].depthTexture = null;
      this.levels[index].colorTexture = null;
      this.levelUniforms[index].valid.value = 0;
    }
    this.pendingRenders.length = 0;
    this.deformationVersions.clear();
    this.worldDeformationFields.clear();
    super.dispose();
  }
}

function leastAlignedAxis(direction, target) {
  const ax = Math.abs(direction.x);
  const ay = Math.abs(direction.y);
  const az = Math.abs(direction.z);
  if (ax <= ay && ax <= az) return target.set(1, 0, 0);
  if (ay <= az) return target.set(0, 1, 0);
  return target.set(0, 0, 1);
}

export function deriveStableLightBasis(
  direction,
  {
    right = new Vector3(),
    up = new Vector3(),
    reference = new Vector3(),
  } = {},
) {
  if (
    ![direction?.x, direction?.y, direction?.z].every(Number.isFinite) ||
    direction.lengthSq() === 0
  ) {
    throw new RangeError("light direction must be finite and nonzero");
  }
  _candidateDirection.copy(direction).normalize();
  leastAlignedAxis(_candidateDirection, reference);
  right.crossVectors(reference, _candidateDirection).normalize();
  up.crossVectors(_candidateDirection, right).normalize();
  return { direction: _candidateDirection.clone(), right, up };
}

export function worldPositionInParentSpace(
  parent,
  worldPosition,
  target = new Vector3(),
) {
  if (
    !worldPosition?.isVector3 ||
    ![worldPosition.x, worldPosition.y, worldPosition.z].every(Number.isFinite)
  ) {
    throw new RangeError("world position must be a finite Vector3");
  }
  target.copy(worldPosition);
  if (parent === null || parent === undefined) return target;
  if (parent.isObject3D !== true) {
    throw new TypeError("parent must be an Object3D or null");
  }
  parent.updateWorldMatrix(true, false);
  const determinant = parent.matrixWorld.determinant();
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new RangeError("parent world transform must be finite and invertible");
  }
  return parent.worldToLocal(target);
}

export function createShadowFrameMetrics(frameId) {
  if (!Number.isInteger(frameId)) {
    throw new TypeError("shadow frame id must be an integer");
  }
  return {
    scope: "single-render-frame",
    provenance: "Measured-runtime-counter",
    frameId,
    nodeFrameId: null,
    renderId: null,
    executed: false,
    sceneSubmissionCount: 0,
    rendererInvocationCount: 0,
    shadowViewCount: 0,
    backendLayerPassCount: 0,
    resourceTargetCount: 0,
    correctnessInvalidationCount: 0,
    selectedLevelIndices: [],
  };
}

function freezeShadowFrameMetrics(metrics) {
  return Object.freeze({
    ...metrics,
    selectedLevelIndices: Object.freeze([...metrics.selectedLevelIndices]),
  });
}

function validateSphere(sphere) {
  if (sphere == null) return null;
  if (
    ![sphere.x, sphere.y, sphere.radius].every(Number.isFinite) ||
    sphere.radius < 0
  ) {
    throw new RangeError("light-space bounds require finite x/y and radius >= 0");
  }
  return { x: sphere.x, y: sphere.y, radius: sphere.radius };
}

function encloseSpheres(a, b) {
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
  return { x: a.x + dx * t, y: a.y + dy * t, radius };
}
