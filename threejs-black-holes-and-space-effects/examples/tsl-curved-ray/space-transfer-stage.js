import {
  BackSide,
  ClampToEdgeWrapping,
  DataUtils,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  NoColorSpace,
  Quaternion,
  RGBAFormat,
  SphereGeometry,
  StorageTexture,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from "three/webgpu";
import {
  Fn,
  If,
  abs,
  acos,
  atan,
  cameraPosition,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  instanceIndex,
  length,
  log,
  max,
  min,
  mix,
  modelWorldMatrixInverse,
  normalize,
  positionLocal,
  screenUV,
  select,
  sin,
  storageTexture,
  texture,
  textureStore,
  uniform,
  uint,
  uvec2,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import {
  CURVED_RAY_DEBUG_MODES,
  CURVED_RAY_QUALITY_TIERS,
  TSLCurvedRayAccretionEffect,
  configureColorTexture,
} from "./curved-ray-accretion.js";
import { traceEllisImpact, traceSchwarzschildNullRay } from "./space-integrators.js";
import { SpaceMetricProbeIntegrator } from "./space-gpu-probes.js";

export const SPACE_INTEGRATOR_MODES = Object.freeze([
  "accretion-disk",
  "ellis-wormhole",
  "schwarzschild-lensing",
  "integration-convergence",
  "temporal-reconstruction",
  "lens-cache",
]);

const PI2 = Math.PI * 2;
const ZERO_JITTER = Object.freeze([0, 0]);
const TERMINATION = Object.freeze({ escaped: 1, horizon: 2, critical: 3, capped: 4, invalid: 5 });

export function createProceduralStarTexture(seed = 1, width = 256, height = 128) {
  let state = seed >>> 0 || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const star = random() > 0.994;
    const value = star ? Math.round(150 + 105 * random()) : Math.round(1 + 5 * random());
    data[pixel * 4] = value;
    data[pixel * 4 + 1] = star ? Math.min(255, value + Math.round(18 * random())) : value;
    data[pixel * 4 + 2] = star ? Math.min(255, value + Math.round(35 * random())) : value + 2;
    data[pixel * 4 + 3] = 255;
  }
  return configureColorTexture(new DataTexture(data, width, height, RGBAFormat, UnsignedByteType));
}

function requireMode(mode) {
  if (!SPACE_INTEGRATOR_MODES.includes(mode)) throw new RangeError(`Unknown space mode: ${mode}`);
  return mode;
}

function assertUniformEffectScale(mesh, target) {
  mesh.getWorldScale(target);
  const minimumScale = Math.min(target.x, target.y, target.z);
  const maximumScale = Math.max(target.x, target.y, target.z);
  if (!(minimumScale > 1e-8) || maximumScale - minimumScale > maximumScale * 1e-5) {
    throw new Error("space integrator requires a finite uniform effect scale");
  }
}

function configureTransferTexture(data, width, name) {
  const packed = new Uint16Array(data.length);
  for (let index = 0; index < data.length; index += 1) packed[index] = DataUtils.toHalfFloat(data[index]);
  const result = new DataTexture(packed, width, 1, RGBAFormat, HalfFloatType);
  result.name = name;
  result.colorSpace = NoColorSpace;
  result.minFilter = LinearFilter;
  result.magFilter = LinearFilter;
  result.wrapS = ClampToEdgeWrapping;
  result.wrapT = ClampToEdgeWrapping;
  result.generateMipmaps = false;
  result.needsUpdate = true;
  return result;
}

function logarithmicDelta(index, resolution, epsilon, maximumDelta) {
  const q = index / (resolution - 1);
  return Math.exp(Math.log(epsilon) + q * (Math.log(maximumDelta) - Math.log(epsilon)));
}

export function createEllisTransferTextures({
  resolution = 256,
  epsilon = 1e-4,
  maximumB = null,
  initialL = 8,
} = {}) {
  const boundaryRadius = Math.sqrt(initialL * initialL + 1);
  const maximum = maximumB ?? boundaryRadius * (1 - 1e-6);
  if (!(maximum > 1 && maximum <= boundaryRadius)) {
    throw new RangeError("Ellis transfer maximumB must lie inside the finite-boundary null cone");
  }
  const below = new Float32Array(resolution * 4);
  const above = new Float32Array(resolution * 4);
  for (let index = 0; index < resolution; index += 1) {
    const belowB = Math.max(0, 1 - logarithmicDelta(index, resolution, epsilon, 1));
    const aboveB = 1 + logarithmicDelta(index, resolution, epsilon, maximum - 1);
    const traversing = traceEllisImpact({ B: belowB, initialL });
    const turning = traceEllisImpact({ B: aboveB, initialL });
    below.set([
      Math.min(traversing.azimuth, 64),
      traversing.exterior,
      TERMINATION.escaped,
      belowB,
    ], index * 4);
    above.set([
      Math.min(turning.azimuth, 64),
      turning.exterior,
      turning.termination === "escaped" ? TERMINATION.escaped : TERMINATION.invalid,
      aboveB,
    ], index * 4);
  }
  return {
    below: configureTransferTexture(below, resolution, "ellis-transfer-below-critical"),
    above: configureTransferTexture(above, resolution, "ellis-transfer-above-critical"),
    critical: 1,
    epsilon,
    maximum,
    boundaryRadius,
    model: "Ellis ultrastatic critical-split transfer",
  };
}

export function createSchwarzschildTransferTextures({
  resolution = 160,
  epsilon = 2e-3,
  maximumImpactOverM = null,
  boundaryRadiusOverM = 80,
  maxAffineStep = 0.08,
} = {}) {
  const critical = 3 * Math.sqrt(3);
  const maximum = maximumImpactOverM ?? boundaryRadiusOverM;
  if (!(maximum > critical && maximum <= boundaryRadiusOverM)) {
    throw new RangeError("Schwarzschild transfer maximum impact must lie inside the finite boundary");
  }
  const captured = new Float32Array(resolution * 4);
  const escaped = new Float32Array(resolution * 4);
  for (let index = 0; index < resolution; index += 1) {
    const belowImpact = Math.max(0, critical - logarithmicDelta(index, resolution, epsilon, critical));
    const aboveImpact = critical + logarithmicDelta(
      index,
      resolution,
      epsilon,
      maximum - critical,
    );
    const below = traceSchwarzschildNullRay({
      impact: belowImpact,
      boundaryRadius: boundaryRadiusOverM,
      maxSteps: 80000,
      maxAffineStep,
    });
    const above = traceSchwarzschildNullRay({
      impact: aboveImpact,
      boundaryRadius: boundaryRadiusOverM,
      maxSteps: 80000,
      maxAffineStep,
    });
    captured.set([
      below.azimuth ?? 0,
      below.minimumRadius ?? 2,
      below.termination === "horizon" ? TERMINATION.horizon : TERMINATION.capped,
      belowImpact,
    ], index * 4);
    escaped.set([
      Math.min(above.azimuth ?? 0, 64),
      above.minimumRadius ?? 3,
      above.termination === "escaped" ? TERMINATION.escaped : TERMINATION.capped,
      aboveImpact,
    ], index * 4);
  }
  return {
    below: configureTransferTexture(captured, resolution, "schwarzschild-transfer-captured"),
    above: configureTransferTexture(escaped, resolution, "schwarzschild-transfer-escaped"),
    critical,
    epsilon,
    maximum,
    boundaryRadius: boundaryRadiusOverM,
    model: "Schwarzschild critical-split null transfer",
    maxAffineStep,
  };
}

const equirectUv = Fn(({ direction }) => {
  const d = normalize(direction);
  return vec2(atan(d.z, d.x).div(PI2).add(0.5), acos(clamp(d.y, -1, 1)).div(Math.PI));
});

const transferCoordinate = Fn(({ impact, critical, epsilon, maximum }) => {
  const below = impact.lessThan(critical);
  const maximumDelta = select(below, critical, maximum.sub(critical));
  const delta = clamp(abs(impact.sub(critical)), epsilon, maximumDelta);
  const q = log(delta.div(epsilon)).div(log(maximumDelta.div(epsilon)));
  return vec2(clamp(q, 0, 1), 0.5);
});

const reconstructFiniteExitDirection = Fn(({
  rayOrigin,
  rayDirection,
  azimuth,
  impact,
  boundaryRadius,
  exterior,
}) => {
  const sphereB = dot(rayOrigin, rayDirection);
  const sphereC = dot(rayOrigin, rayOrigin).sub(1);
  const entryDistance = max(
    sphereB.negate().sub(max(sphereB.mul(sphereB).sub(sphereC), 0).sqrt()),
    0,
  );
  const entry = rayOrigin.add(rayDirection.mul(entryDistance));
  const radial0 = normalize(entry);
  const rawNormal = cross(entry, rayDirection);
  const fallback = cross(radial0, vec3(0, 1, 0));
  const orbitalNormal = normalize(select(length(rawNormal).greaterThan(1e-5), rawNormal, fallback));
  const tangent0 = normalize(cross(orbitalNormal, radial0));
  const radial = radial0.mul(cos(azimuth)).add(tangent0.mul(sin(azimuth)));
  const tangent = radial0.mul(sin(azimuth).negate()).add(tangent0.mul(cos(azimuth)));
  const tangentMagnitude = clamp(impact.div(boundaryRadius), 0, 0.999999);
  const radialMagnitude = max(float(1).sub(tangentMagnitude.mul(tangentMagnitude)), 0).sqrt();
  const exteriorOrientation = select(exterior.lessThan(0), -1, 1);
  return normalize(radial.mul(radialMagnitude * exteriorOrientation).add(tangent.mul(tangentMagnitude)));
});

export function createTransferMaterial({
  transfer,
  starTexture = createProceduralStarTexture(),
  modelScale,
  debugMode = 0,
  convergenceTransfer = null,
} = {}) {
  configureColorTexture(starTexture);
  const debugModeNode = uniform(debugMode, "int").setName("spaceTransferDebugMode");
  const localCamera = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
  const rayDirection = normalize(positionLocal.sub(localCamera));
  const impact = length(cross(localCamera, rayDirection)).div(modelScale);
  const critical = float(transfer.critical);
  const epsilon = float(transfer.epsilon);
  const maximum = float(transfer.maximum);
  const coordinate = transferCoordinate({ impact, critical, epsilon, maximum });
  const chosen = select(
    impact.lessThan(critical),
    texture(transfer.below, coordinate),
    texture(transfer.above, coordinate),
  );
  const nearCritical = abs(impact.sub(critical)).lessThan(epsilon);
  const termination = select(nearCritical, float(TERMINATION.critical), chosen.z);
  const escaped = termination.equal(TERMINATION.escaped);
  const bentDirection = reconstructFiniteExitDirection({
    rayOrigin: localCamera,
    rayDirection,
    azimuth: chosen.x,
    impact,
    boundaryRadius: float(transfer.boundaryRadius),
    exterior: chosen.y,
  });
  const stars = texture(starTexture, equirectUv({ direction: bentDirection })).rgb;
  const exteriorTint = select(chosen.y.lessThan(0), vec3(0.58, 0.78, 1.25), vec3(1));
  const finalColor = select(escaped, stars.mul(exteriorTint), vec3(0));
  const debugSteps = vec3(clamp(chosen.x.div(PI2 * 3), 0, 1), 0.08, 0.3);
  const debugTermination = vec3(termination.div(5), escaped, float(1).sub(escaped));
  const debugDirection = bentDirection.mul(0.5).add(0.5);
  let convergenceColor = vec3(0);
  if (convergenceTransfer) {
    const convergenceCoordinate = transferCoordinate({
      impact,
      critical: float(convergenceTransfer.critical),
      epsilon: float(convergenceTransfer.epsilon),
      maximum: float(convergenceTransfer.maximum),
    });
    const coarse = select(
      impact.lessThan(convergenceTransfer.critical),
      texture(convergenceTransfer.below, convergenceCoordinate),
      texture(convergenceTransfer.above, convergenceCoordinate),
    );
    const azimuthResidual = clamp(abs(coarse.x.sub(chosen.x)).mul(6), 0, 1);
    const terminationMismatch = abs(coarse.z.sub(chosen.z)).greaterThan(0.25);
    convergenceColor = vec3(
      azimuthResidual,
      terminationMismatch,
      float(1).sub(azimuthResidual),
    );
  }
  const selected = select(
    debugModeNode.equal(1),
    debugSteps,
    select(
      debugModeNode.equal(2),
      debugTermination,
      select(
        debugModeNode.equal(3),
        debugDirection,
        select(debugModeNode.equal(4), convergenceColor, finalColor),
      ),
    ),
  );
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthTest: true, depthWrite: false });
  material.colorNode = vec4(selected, 1);
  material.userData.transfer = transfer;
  material.userData.debugModeNode = debugModeNode;
  material.userData.starTexture = starTexture;
  material.userData.modelScale = modelScale;
  material.userData.convergenceTransfer = convergenceTransfer;
  return material;
}

function createStorageTexture(width, height, name) {
  const result = new StorageTexture(width, height);
  result.name = name;
  result.format = RGBAFormat;
  result.type = HalfFloatType;
  result.colorSpace = NoColorSpace;
  result.minFilter = NearestFilter;
  result.magFilter = NearestFilter;
  result.wrapS = ClampToEdgeWrapping;
  result.wrapT = ClampToEdgeWrapping;
  result.generateMipmaps = false;
  result.mipmapsAutoUpdate = false;
  return result;
}

export class SpaceLensDirectionCache {
  constructor({ width = 256, height = 256, transfer, modelScale }) {
    this.width = width;
    this.height = height;
    this.transfer = transfer;
    this.modelScale = modelScale;
    this.texture = createStorageTexture(width, height, "space-lens-direction-cache");
    this.positionDepthTexture = createStorageTexture(width, height, "space-lens-position-depth");
    this.diagnosticTexture = createStorageTexture(width, height, "space-lens-diagnostics");
    this.cameraOriginNode = uniform(new Vector3(0, 0, 2.35), "vec3");
    this.inverseViewProjectionNode = uniform(new Matrix4(), "mat4").setName("spaceInverseViewProjection");
    this.modelWorldNode = uniform(new Matrix4(), "mat4").setName("spaceModelWorld");
    this.modelWorldInverseNode = uniform(new Matrix4(), "mat4").setName("spaceModelWorldInverse");
    this.cameraConfigured = false;
    this.hasCommittedCamera = false;
    const kernel = Fn(() => {
      const index = instanceIndex;
      const x = index.mod(uint(width));
      const y = index.div(uint(width));
      const cell = uvec2(x, y);
      const uvValue = vec2(float(x).add(0.5).div(width), float(y).add(0.5).div(height));
      const clipFar = vec4(uvValue.x.mul(2).sub(1), float(1).sub(uvValue.y.mul(2)), 1, 1);
      const worldFarH = this.inverseViewProjectionNode.mul(clipFar);
      const worldFar = worldFarH.xyz.div(worldFarH.w);
      const rayWorld = normalize(worldFar.sub(this.cameraOriginNode));
      const localCameraH = this.modelWorldInverseNode.mul(vec4(this.cameraOriginNode, 1));
      const localCamera = localCameraH.xyz.div(localCameraH.w);
      const rayLocal = normalize(this.modelWorldInverseNode.mul(vec4(rayWorld, 0)).xyz);
      const impact = length(cross(localCamera, rayLocal)).div(modelScale);
      const coordinate = transferCoordinate({
        impact,
        critical: float(transfer.critical),
        epsilon: float(transfer.epsilon),
        maximum: float(transfer.maximum),
      });
      const sampleValue = select(
        impact.lessThan(transfer.critical),
        texture(transfer.below, coordinate),
        texture(transfer.above, coordinate),
      );
      const termination = select(
        abs(impact.sub(transfer.critical)).lessThan(transfer.epsilon),
        float(TERMINATION.critical),
        sampleValue.z,
      );
      const direction = reconstructFiniteExitDirection({
        rayOrigin: localCamera,
        rayDirection: rayLocal,
        azimuth: sampleValue.x,
        impact,
        boundaryRadius: float(transfer.boundaryRadius),
        exterior: sampleValue.y,
      });
      const bentDirectionWorld = normalize(this.modelWorldNode.mul(vec4(direction, 0)).xyz);
      const sphereB = dot(localCamera, rayLocal);
      const sphereC = dot(localCamera, localCamera).sub(1);
      const discriminant = max(sphereB.mul(sphereB).sub(sphereC), 0);
      const entryDistance = max(sphereB.negate().sub(discriminant.sqrt()), 0);
      const representativeLocal = localCamera.add(rayLocal.mul(entryDistance));
      const representativeWorldH = this.modelWorldNode.mul(vec4(representativeLocal, 1));
      const representativeWorld = representativeWorldH.xyz.div(representativeWorldH.w);
      const representativeDepth = length(representativeWorld.sub(this.cameraOriginNode));
      const classification = termination.add(select(sampleValue.y.lessThan(0), 8, 0));
      textureStore(this.texture, cell, vec4(bentDirectionWorld, classification)).toWriteOnly();
      textureStore(
        this.positionDepthTexture,
        cell,
        vec4(representativeWorld, representativeDepth),
      ).toWriteOnly();
      textureStore(
        this.diagnosticTexture,
        cell,
        vec4(sampleValue.x, impact, termination, sampleValue.y),
      ).toWriteOnly();
    });
    this.computeNode = kernel().compute(width * height, [64]).setName("space:lens-cache-refresh");
    this.refreshCount = 0;
    this.skippedRefreshCount = 0;
    this.angularErrorGateRadians = 7.5e-4;
    this.lastViewProjection = new Matrix4();
    this.nextViewProjection = new Matrix4();
    this.lastCameraPosition = new Vector3();
    this.lastCameraQuaternion = new Quaternion();
    this.lastModelPosition = new Vector3();
    this.lastModelQuaternion = new Quaternion();
    this.lastModelScale = new Vector3(1, 1, 1);
    this.currentCameraPosition = new Vector3();
    this.currentCameraQuaternion = new Quaternion();
    this.currentModelPosition = new Vector3();
    this.currentModelQuaternion = new Quaternion();
    this.currentModelScale = new Vector3(1, 1, 1);
    this.lastFovRadians = 0;
    this.lastAspect = 1;
    this.currentFovRadians = 0;
    this.currentAspect = 1;
    this.dirty = true;
    this.estimatedAngularError = Number.POSITIVE_INFINITY;
    this.lastInvalidationCause = "initialization";
  }

  setCamera(camera, mesh, options = null) {
    const force = options?.force === true;
    if (!camera?.projectionMatrix || !mesh?.matrixWorld) {
      throw new TypeError("SpaceLensDirectionCache.setCamera requires camera and effect mesh");
    }
    camera.updateWorldMatrix(true, false);
    mesh.updateWorldMatrix(true, false);
    const viewProjection = this.nextViewProjection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    camera.getWorldPosition(this.currentCameraPosition);
    camera.getWorldQuaternion(this.currentCameraQuaternion);
    mesh.getWorldPosition(this.currentModelPosition);
    mesh.getWorldQuaternion(this.currentModelQuaternion);
    mesh.getWorldScale(this.currentModelScale);
    assertUniformEffectScale(mesh, this.currentModelScale);
    const fovRadians = Number.isFinite(camera.fov) ? camera.fov * Math.PI / 180 : 0;
    const aspect = Number.isFinite(camera.aspect) ? camera.aspect : 1;
    let estimatedAngularError = this.hasCommittedCamera ? 0 : Number.POSITIVE_INFINITY;
    if (this.hasCommittedCamera) {
      const cameraDistance = Math.max(
        this.currentCameraPosition.distanceTo(this.currentModelPosition),
        1e-6,
      );
      const cameraMotionAngle = this.currentCameraPosition.distanceTo(this.lastCameraPosition) /
        cameraDistance;
      const modelMotionAngle = this.currentModelPosition.distanceTo(this.lastModelPosition) /
        cameraDistance;
      const projectionChange = Math.abs(fovRadians - this.lastFovRadians) +
        Math.abs(Math.log(aspect / this.lastAspect));
      const maximumScaleRatio = Math.max(
        this.currentModelScale.x / this.lastModelScale.x,
        this.currentModelScale.y / this.lastModelScale.y,
        this.currentModelScale.z / this.lastModelScale.z,
        this.lastModelScale.x / this.currentModelScale.x,
        this.lastModelScale.y / this.currentModelScale.y,
        this.lastModelScale.z / this.currentModelScale.z,
      );
      estimatedAngularError = this.lastCameraQuaternion.angleTo(this.currentCameraQuaternion) +
        this.lastModelQuaternion.angleTo(this.currentModelQuaternion) +
        cameraMotionAngle + modelMotionAngle + projectionChange +
        Math.abs(Math.log(maximumScaleRatio));
    }
    this.estimatedAngularError = estimatedAngularError;
    this.dirty ||= force || estimatedAngularError > this.angularErrorGateRadians;
    this.inverseViewProjectionNode.value.copy(viewProjection).invert();
    this.modelWorldNode.value.copy(mesh.matrixWorld);
    this.modelWorldInverseNode.value.copy(mesh.matrixWorld).invert();
    this.cameraOriginNode.value.copy(this.currentCameraPosition);
    this.currentFovRadians = fovRadians;
    this.currentAspect = aspect;
    this.cameraConfigured = true;
    return this.dirty;
  }

  refresh(renderer, { force = false } = {}) {
    if (!this.cameraConfigured) throw new Error("configure cache camera before refresh");
    if (!force && !this.dirty) {
      this.skippedRefreshCount += 1;
      return false;
    }
    renderer.compute(this.computeNode);
    this.refreshCount += 1;
    this.dirty = false;
    this.lastViewProjection.copy(this.nextViewProjection);
    this.lastCameraPosition.copy(this.currentCameraPosition);
    this.lastCameraQuaternion.copy(this.currentCameraQuaternion);
    this.lastModelPosition.copy(this.currentModelPosition);
    this.lastModelQuaternion.copy(this.currentModelQuaternion);
    this.lastModelScale.copy(this.currentModelScale);
    this.lastFovRadians = this.currentFovRadians;
    this.lastAspect = this.currentAspect;
    this.hasCommittedCamera = true;
    return true;
  }

  invalidate(cause = "explicit-reset") {
    this.dirty = true;
    this.lastInvalidationCause = String(cause);
  }

  describe() {
    return {
      dimensions: [this.width, this.height],
      bytes: this.width * this.height * 8 * 3,
      refreshCount: this.refreshCount,
      skippedRefreshCount: this.skippedRefreshCount,
      angularErrorGateRadians: this.angularErrorGateRadians,
      estimatedAngularError: this.estimatedAngularError,
      lastInvalidationCause: this.lastInvalidationCause,
      payload: "bent direction + termination; world position + depth; azimuth + impact + termination + exterior",
      cameraRaySource: "inverse current view-projection and current effect transform",
      cachedToneMappedColor: false,
    };
  }

  dispose() {
    this.texture.dispose();
    this.positionDepthTexture.dispose();
    this.diagnosticTexture.dispose();
  }
}

export function reprojectWorldPositionCPU({
  worldPosition,
  previousViewProjection,
  previousJitter = [0, 0],
  currentJitter = [0, 0],
  width,
  height,
}) {
  const clip = new Vector4(...worldPosition, 1).applyMatrix4(previousViewProjection);
  if (!(clip.w > 0) || !Number.isFinite(clip.w)) {
    return { inBounds: false, uv: [0, 0], cell: [-1, -1] };
  }
  const uv = [
    clip.x / clip.w * 0.5 + 0.5 + previousJitter[0] - currentJitter[0],
    0.5 - clip.y / clip.w * 0.5 + previousJitter[1] - currentJitter[1],
  ];
  const inBounds = uv[0] >= 0 && uv[0] < 1 && uv[1] >= 0 && uv[1] < 1;
  return {
    inBounds,
    uv,
    cell: inBounds
      ? [Math.min(width - 1, Math.floor(uv[0] * width)), Math.min(height - 1, Math.floor(uv[1] * height))]
      : [-1, -1],
  };
}

export class SpaceTemporalDirectionHistory {
  constructor({ source, sourcePositionDepth, width, height, currentWeight = 0.18 }) {
    this.source = source;
    this.sourcePositionDepth = sourcePositionDepth;
    this.width = width;
    this.height = height;
    this.historyA = createStorageTexture(width, height, "space-history-A");
    this.historyB = createStorageTexture(width, height, "space-history-B");
    this.historyPositionDepthA = createStorageTexture(width, height, "space-history-position-depth-A");
    this.historyPositionDepthB = createStorageTexture(width, height, "space-history-position-depth-B");
    this.rejectionMask = createStorageTexture(width, height, "space-history-rejection-mask");
    this.resetNode = uniform(1, "uint");
    this.cameraCutNode = uniform(1, "uint");
    this.currentWeightNode = uniform(currentWeight);
    this.depthThresholdNode = uniform(0.08).setName("spaceTemporalDepthThreshold");
    this.positionThresholdNode = uniform(0.12).setName("spaceTemporalPositionThreshold");
    this.previousViewProjectionNode = uniform(new Matrix4(), "mat4").setName(
      "spacePreviousViewProjection",
    );
    this.previousJitterNode = uniform(new Vector2(), "vec2").setName("spacePreviousJitter");
    this.currentJitterNode = uniform(new Vector2(), "vec2").setName("spaceCurrentJitter");
    this.activeNode = uniform(0, "uint").setName("spaceTemporalActiveHistory");
    this.active = 0;
    this.frameIndex = 0;
    this.currentViewProjection = null;
    this.nextViewProjection = new Matrix4();
    this.kernels = [
      this.makeKernel(
        this.historyA,
        this.historyPositionDepthA,
        this.historyB,
        this.historyPositionDepthB,
        "A-to-B",
      ),
      this.makeKernel(
        this.historyB,
        this.historyPositionDepthB,
        this.historyA,
        this.historyPositionDepthA,
        "B-to-A",
      ),
    ];
  }

  makeKernel(read, readPositionDepth, write, writePositionDepth, label) {
    const kernel = Fn(() => {
      const index = instanceIndex;
      const cell = uvec2(index.mod(uint(this.width)), index.div(uint(this.width)));
      const current = storageTexture(this.source, cell).toReadOnly();
      const currentPositionDepth = storageTexture(this.sourcePositionDepth, cell).toReadOnly();
      const previousClip = this.previousViewProjectionNode.mul(vec4(currentPositionDepth.xyz, 1));
      const previousUv = vec2(
        previousClip.x.div(previousClip.w).mul(0.5).add(0.5),
        float(0.5).sub(previousClip.y.div(previousClip.w).mul(0.5)),
      ).add(this.previousJitterNode.sub(this.currentJitterNode));
      const inBounds = previousClip.w.greaterThan(0)
        .and(previousUv.x.greaterThanEqual(0)).and(previousUv.x.lessThan(1))
        .and(previousUv.y.greaterThanEqual(0)).and(previousUv.y.lessThan(1));
      const safeUv = clamp(previousUv, vec2(0), vec2(0.999999));
      const historyCell = uvec2(
        uint(safeUv.x.mul(this.width)),
        uint(safeUv.y.mul(this.height)),
      );
      const history = storageTexture(read, historyCell).toReadOnly();
      const historyPositionDepth = storageTexture(readPositionDepth, historyCell).toReadOnly();
      const sameClassification = abs(current.w.sub(history.w)).lessThan(0.25);
      const angularAgreement = dot(normalize(current.xyz), normalize(history.xyz)).greaterThan(0.9995);
      const depthDelta = abs(currentPositionDepth.w.sub(historyPositionDepth.w));
      const positionDelta = length(currentPositionDepth.xyz.sub(historyPositionDepth.xyz));
      const accepted = this.resetNode.equal(uint(0))
        .and(this.cameraCutNode.equal(uint(0)))
        .and(inBounds)
        .and(sameClassification)
        .and(angularAgreement)
        .and(depthDelta.lessThanEqual(this.depthThresholdNode))
        .and(positionDelta.lessThanEqual(this.positionThresholdNode));
      const direction = normalize(select(
        accepted,
        mix(history.xyz, current.xyz, this.currentWeightNode),
        current.xyz,
      ));
      textureStore(write, cell, vec4(direction, current.w)).toWriteOnly();
      textureStore(writePositionDepth, cell, currentPositionDepth).toWriteOnly();
      textureStore(
        this.rejectionMask,
        cell,
        vec4(
          select(accepted, 0, 1),
          depthDelta,
          positionDelta,
          select(inBounds, 1, 0),
        ),
      ).toWriteOnly();
    });
    return kernel().compute(this.width * this.height, [64]).setName(`space:temporal-${label}`);
  }

  setCamera(camera, options = null) {
    const jitter = options?.jitter ?? ZERO_JITTER;
    const forceCut = options?.forceCut === true;
    camera.updateWorldMatrix(true, false);
    const next = this.nextViewProjection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    if (this.currentViewProjection === null) {
      this.currentViewProjection = next.clone();
      this.previousViewProjectionNode.value.copy(next);
      this.cameraCutNode.value = 1;
    } else {
      let maxDelta = 0;
      for (let index = 0; index < 16; index += 1) {
        maxDelta = Math.max(
          maxDelta,
          Math.abs(next.elements[index] - this.currentViewProjection.elements[index]),
        );
      }
      this.previousViewProjectionNode.value.copy(this.currentViewProjection);
      this.currentViewProjection.copy(next);
      this.cameraCutNode.value = forceCut || maxDelta > 0.5 ? 1 : 0;
    }
    this.previousJitterNode.value.copy(this.currentJitterNode.value);
    this.currentJitterNode.value.fromArray(jitter);
  }

  resolve(renderer) {
    renderer.compute(this.kernels[this.active]);
    this.active = 1 - this.active;
    this.activeNode.value = this.active;
    this.resetNode.value = 0;
    this.cameraCutNode.value = 0;
    this.frameIndex += 1;
  }

  reset() {
    this.resetNode.value = 1;
    this.cameraCutNode.value = 1;
  }

  get output() {
    return this.active === 0 ? this.historyA : this.historyB;
  }

  describe() {
    return {
      frameIndex: this.frameIndex,
      owner: "SpaceTemporalDirectionHistory",
      reprojection: "representative world position -> previous view-projection + jitter delta",
      rejection: [
        "reset",
        "camera-cut",
        "out-of-bounds",
        "termination-and-exterior-classification",
        "bent-direction-angular-residual",
        "representative-depth-disocclusion",
        "representative-position-disocclusion",
      ],
      historyBytes: this.width * this.height * 8 * 5,
    };
  }

  dispose() {
    this.historyA.dispose();
    this.historyB.dispose();
    this.historyPositionDepthA.dispose();
    this.historyPositionDepthB.dispose();
    this.rejectionMask.dispose();
  }
}

function connectCachedDirectionToMaterial(material, cache, temporal) {
  const uvNode = screenUV;
  const cached = temporal
    ? select(
      temporal.activeNode.equal(uint(0)),
      texture(temporal.historyA, uvNode),
      texture(temporal.historyB, uvNode),
    )
    : texture(cache.texture, uvNode);
  const cachedTermination = cached.w.mod(8);
  const escaped = cachedTermination.equal(TERMINATION.escaped);
  const diagnostic = texture(cache.diagnosticTexture, uvNode);
  const environment = texture(
    material.userData.starTexture,
    equirectUv({ direction: cached.xyz }),
  ).rgb;
  const finalColor = select(escaped, environment, vec3(0));
  const complexity = vec3(clamp(diagnostic.x.div(PI2 * 3), 0, 1), 0.08, 0.3);
  const termination = vec3(
    diagnostic.z.div(5),
    diagnostic.z.equal(TERMINATION.escaped),
    diagnostic.z.notEqual(TERMINATION.escaped),
  );
  const direction = cached.xyz.mul(0.5).add(0.5);
  const selected = select(
    material.userData.debugModeNode.equal(1),
    complexity,
    select(
      material.userData.debugModeNode.equal(2),
      termination,
      select(material.userData.debugModeNode.equal(3), direction, finalColor),
    ),
  );
  material.colorNode = vec4(selected, 1);
  material.userData.directionSource = temporal
    ? "SpaceTemporalDirectionHistory ping-pong"
    : "SpaceLensDirectionCache StorageTexture";
}

export function createSpaceIntegratorStage({
  mode = "accretion-disk",
  quality = "standard",
  seed = 1,
  starTexture = null,
} = {}) {
  requireMode(mode);
  if (!Object.hasOwn(CURVED_RAY_QUALITY_TIERS, quality)) throw new RangeError(`Unknown quality: ${quality}`);
  if (mode === "accretion-disk") {
    const effect = new TSLCurvedRayAccretionEffect({ quality, seed, ...(starTexture ? { starTexture } : {}) });
    const scaleScratch = new Vector3();
    return {
      mode,
      mesh: effect.mesh,
      update: (time) => effect.update(time),
      setDebugMode(debug) {
        if (!Object.hasOwn(CURVED_RAY_DEBUG_MODES, debug)) {
          throw new RangeError(`Unknown space debug mode: ${debug}`);
        }
        effect.setDebugMode(debug);
      },
      prepare: () => assertUniformEffectScale(effect.mesh, scaleScratch),
      prepareFrame: () => assertUniformEffectScale(effect.mesh, scaleScratch),
      resetHistory: () => effect.temporalAccumulator?.reset?.(),
      describePipeline: () => ({
        model: "art-directed bounded curved-ray transfer",
        rendererOwner: "host",
        outputOwner: "host",
        missAcceptedSteps: 0,
        maxSteps: effect.metrics().maxAcceptedSteps,
      }),
      describeResources: () => effect.metrics().storage,
      dispose: () => effect.dispose(),
    };
  }

  const isEllis = mode === "ellis-wormhole" || mode === "temporal-reconstruction";
  const transfer = isEllis
    ? createEllisTransferTextures()
    : createSchwarzschildTransferTextures({
      maxAffineStep: mode === "integration-convergence" ? 0.02 : 0.08,
    });
  const convergenceTransfer = mode === "integration-convergence"
    ? createSchwarzschildTransferTextures({ maxAffineStep: 0.08 })
    : null;
  // The unit proxy sphere is the finite transfer boundary. This conversion is
  // therefore fixed by that boundary, not by an unrelated artistic scale.
  const modelScale = 1 / transfer.boundaryRadius;
  const material = createTransferMaterial({
    transfer,
    starTexture: starTexture ?? createProceduralStarTexture(seed),
    modelScale,
    convergenceTransfer,
  });
  const mesh = new Mesh(new SphereGeometry(1, 96, 48), material);
  mesh.name = isEllis ? "Ellis transfer-lens volume" : "Schwarzschild transfer-lens volume";
  const cacheEnabled = mode === "lens-cache" || mode === "temporal-reconstruction";
  const tier = CURVED_RAY_QUALITY_TIERS[quality];
  const cacheSize = quality === "hero" ? 512 : quality === "standard" ? 256 : 128;
  const cache = cacheEnabled
    ? new SpaceLensDirectionCache({ width: cacheSize, height: cacheSize, transfer, modelScale })
    : null;
  const temporal = mode === "temporal-reconstruction"
    ? new SpaceTemporalDirectionHistory({
      source: cache.texture,
      sourcePositionDepth: cache.positionDepthTexture,
      width: cacheSize,
      height: cacheSize,
    })
    : null;
  const probeIntegrator = new SpaceMetricProbeIntegrator({ capacity: 8 });
  const convergenceProbeIntegrators = [];
  if (isEllis) {
    probeIntegrator.setEllisProbes([
      { impact: 0 },
      { impact: 0.4 },
      { impact: 0.8 },
      { impact: 1.4 },
    ]);
  } else {
    const probes = [
      { impact: 4 },
      { impact: 3 * Math.sqrt(3) * 0.99 },
      { impact: 3 * Math.sqrt(3) * 1.03 },
      { impact: 8 },
    ];
    probeIntegrator.setSchwarzschildProbes(probes, {
      maxAffineStep: mode === "integration-convergence" ? 0.02 : 0.08,
    });
    if (mode === "integration-convergence") {
      for (const maxAffineStep of [0.08, 0.04]) {
        const convergenceProbe = new SpaceMetricProbeIntegrator({ capacity: 8 });
        convergenceProbe.setSchwarzschildProbes(probes, { maxAffineStep });
        convergenceProbeIntegrators.push(convergenceProbe);
      }
    }
  }
  if (cache) connectCachedDirectionToMaterial(material, cache, temporal);
  let disposed = false;
  const scaleScratch = new Vector3();

  return {
    mode,
    mesh,
    transfer,
    cache,
    temporal,
    update() {},
    setDebugMode(debug) {
      const ids = { final: 0, "step-count": 1, termination: 2, "bent-direction": 3, convergence: 4 };
      if (!Object.hasOwn(ids, debug)) throw new RangeError(`Unknown space debug mode: ${debug}`);
      material.userData.debugModeNode.value = ids[debug];
    },
    prepare(renderer, camera) {
      assertUniformEffectScale(mesh, scaleScratch);
      probeIntegrator.dispatch(renderer);
      for (const convergenceProbe of convergenceProbeIntegrators) {
        convergenceProbe.dispatch(renderer);
      }
      if (cache) {
        cache.setCamera(camera, mesh, { force: true });
        cache.refresh(renderer, { force: true });
      }
      if (temporal) {
        temporal.setCamera(camera, { forceCut: true });
        temporal.resolve(renderer);
      }
    },
    prepareFrame(renderer, camera, options = null) {
      assertUniformEffectScale(mesh, scaleScratch);
      const jitter = options?.jitter ?? ZERO_JITTER;
      const forceCut = options?.forceCut === true;
      if (cache) {
        cache.setCamera(camera, mesh);
        cache.refresh(renderer);
      }
      if (temporal) {
        temporal.setCamera(camera, { jitter, forceCut });
        temporal.resolve(renderer);
      }
    },
    resetHistory(cause = "explicit-reset") {
      temporal?.reset();
      cache?.invalidate(cause);
    },
    describePipeline() {
      return {
        model: transfer.model,
        rendererOwner: "host",
        outputOwner: "host",
        transferSampling: "critical-split log(abs(b-bCritical))",
        transferMaxAffineStep: transfer.maxAffineStep ?? null,
        cacheDispatches: cache?.refreshCount ?? 0,
        cacheRefreshPolicy: cache ? "angular-error-gated against last committed view" : null,
        temporalDispatches: temporal?.frameIndex ?? 0,
        directMetricProbeDispatches: probeIntegrator.dispatchCount +
          convergenceProbeIntegrators.reduce((sum, probe) => sum + probe.dispatchCount, 0),
        plannedDirectMetricProbeDispatches: 1 + convergenceProbeIntegrators.length,
        directMetricProbeModel: probeIntegrator.model,
        convergenceStepSizes: mode === "integration-convergence" ? [0.08, 0.04, 0.02] : null,
        convergenceImage: mode === "integration-convergence"
          ? "coarse 0.08 versus fine 0.02 transfer residual"
          : null,
        maxSteps: tier.maxSteps,
        exactStepCap: true,
      };
    },
    describeResources() {
      return {
        transferTextures: [
          transfer.below,
          transfer.above,
          ...(convergenceTransfer ? [convergenceTransfer.below, convergenceTransfer.above] : []),
        ].map((textureValue) => ({
          name: textureValue.name,
          dimensions: [textureValue.image.width, textureValue.image.height],
          format: textureValue.format,
          type: textureValue.type,
          bytes: textureValue.image.data.byteLength,
          colorSpace: textureValue.colorSpace,
        })),
        proxyGeometry: {
          vertices: mesh.geometry.attributes.position.count,
          indices: mesh.geometry.index?.count ?? 0,
          attributeBytes: Object.values(mesh.geometry.attributes)
            .reduce((sum, attribute) => sum + attribute.array.byteLength, 0),
          indexBytes: mesh.geometry.index?.array.byteLength ?? 0,
        },
        cache: cache?.describe() ?? null,
        temporal: temporal?.describe() ?? null,
        directMetricProbes: probeIntegrator.describe(),
        convergenceMetricProbes: convergenceProbeIntegrators.map((probe) => probe.describe()),
      };
    },
    async readProbeEvidence(renderer) {
      const primary = await probeIntegrator.readback(renderer);
      if (convergenceProbeIntegrators.length === 0) return primary;
      const coarseToMedium = await Promise.all(
        convergenceProbeIntegrators.map((probe) => probe.readback(renderer)),
      );
      return {
        model: "schwarzschild-convergence",
        stepSizes: [0.08, 0.04, 0.02],
        probes: [...coarseToMedium, primary],
      };
    },
    dispose() {
      if (disposed) return;
      mesh.geometry.dispose();
      material.dispose();
      material.userData.starTexture.dispose?.();
      transfer.below.dispose();
      transfer.above.dispose();
      convergenceTransfer?.below.dispose();
      convergenceTransfer?.above.dispose();
      probeIntegrator.dispose();
      for (const convergenceProbe of convergenceProbeIntegrators) convergenceProbe.dispose();
      temporal?.dispose();
      cache?.dispose();
      disposed = true;
    },
  };
}
