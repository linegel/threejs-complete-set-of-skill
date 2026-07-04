import {
  BackSide,
  ClampToEdgeWrapping,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  NoColorSpace,
  NoToneMapping,
  Quaternion,
  RenderPipeline,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  StorageTexture,
  TextureLoader,
  UnsignedByteType,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  acos,
  atan,
  bool,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  fract,
  int,
  length,
  max,
  min,
  mix,
  modelWorldMatrixInverse,
  normalize,
  pass,
  positionLocal,
  pow,
  renderOutput,
  screenUV,
  select,
  sin,
  smoothstep,
  step,
  texture,
  textureStore,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

export const DEFAULT_STARFIELD_TILES = Object.freeze([
  "../../assets/generated-variants/starfield-tile-a.png",
  "../../assets/generated-variants/starfield-tile-b.png",
  "../../assets/generated-variants/starfield-tile-c.png",
]);

export const CURVED_RAY_DEBUG_MODES = Object.freeze({
  final: 0,
  "step-count": 1,
  transmittance: 2,
  steering: 3,
  termination: 4,
  "invalid-state": 5,
  "bent-direction": 6,
  opacity: 7,
  "core-hit": 8,
});

export const CURVED_RAY_QUALITY_TIERS = Object.freeze({
  hero: {
    maxSteps: 160,
    baseStep: 0.0071,
    minStep: 0.0028,
    maxStep: 0.018,
    opacityCutoff: 0.01,
    extinction: 32.0,
    resolutionScale: 0.5,
  },
  standard: {
    maxSteps: 96,
    baseStep: 0.0095,
    minStep: 0.004,
    maxStep: 0.026,
    opacityCutoff: 0.03,
    extinction: 28.0,
    resolutionScale: 0.5,
  },
  background: {
    maxSteps: 48,
    baseStep: 0.014,
    minStep: 0.006,
    maxStep: 0.042,
    opacityCutoff: 0.03,
    extinction: 23.0,
    resolutionScale: 0.25,
  },
  distant: {
    maxSteps: 16,
    baseStep: 0.026,
    minStep: 0.012,
    maxStep: 0.085,
    opacityCutoff: 0.05,
    extinction: 18.0,
    resolutionScale: 0.25,
  },
});

export const AUTHORED_LEGACY_IDENTITY = Object.freeze({
  legacyIterations: 128,
  legacyStepSize: 0.0071,
  rayForwardWeight: 1.78,
  bendingPower: 0.3,
  coreRadius: 0.13,
  diskWidth: 0.03,
  rotationRadialScale: 4.27,
  rotationTimeScale: 0.1,
  noiseUvScale: 2.0,
  rampWhiteHot: 0.06,
  rampGold: 0.33,
  rampAmber: 1.0,
  emissionScale: 1.95,
  emissionAdd: [1.0, 0.72, 0.26],
  detailNoiseMin: 0.35,
  detailNoiseMax: 1.2,
  detailBoostMin: 0.75,
  detailBoostMax: 1.15,
});

const PI = Math.PI;
const TWO_PI = Math.PI * 2;
const UNIT_SPHERE_RADIUS = 1.0;
const TRANSFORM_SCALE_EPSILON = 1e-8;
const DEFAULT_UNIFORM_SCALE_TOLERANCE = 1e-4;
const DEFAULT_FAR_ORIGIN_NOTICE_DISTANCE = 100000;

const transformPosition = new Vector3();
const transformQuaternion = new Quaternion();
const transformScale = new Vector3();
const transformInverse = new Matrix4();

function sanitizeSeed(seed) {
  return (Number.isFinite(seed) ? seed : 1) >>> 0;
}

function readCameraWorldPosition(cameraOrPosition) {
  const result = new Vector3();

  if (!cameraOrPosition) {
    return result;
  }

  if (cameraOrPosition.isVector3) {
    return result.copy(cameraOrPosition);
  }

  if (typeof cameraOrPosition.getWorldPosition === "function") {
    return cameraOrPosition.getWorldPosition(result);
  }

  if (cameraOrPosition.position?.isVector3) {
    return result.copy(cameraOrPosition.position);
  }

  if (
    Number.isFinite(cameraOrPosition.x) &&
    Number.isFinite(cameraOrPosition.y) &&
    Number.isFinite(cameraOrPosition.z)
  ) {
    return result.set(cameraOrPosition.x, cameraOrPosition.y, cameraOrPosition.z);
  }

  throw new Error("Camera position must be a Vector3, Object3D camera, or finite {x,y,z} value.");
}

export function evaluateCurvedRayTransformContract(mesh, {
  camera = null,
  cameraPosition = null,
  uniformScaleTolerance = DEFAULT_UNIFORM_SCALE_TOLERANCE,
  farOriginNoticeDistance = DEFAULT_FAR_ORIGIN_NOTICE_DISTANCE,
} = {}) {
  if (!mesh?.matrixWorld) {
    throw new Error("Curved-ray transform contract requires a mesh with matrixWorld.");
  }

  mesh.updateWorldMatrix?.(true, false);
  mesh.matrixWorld.decompose(transformPosition, transformQuaternion, transformScale);

  const absScale = [
    Math.abs(transformScale.x),
    Math.abs(transformScale.y),
    Math.abs(transformScale.z),
  ];
  const minScale = Math.min(...absScale);
  const maxScale = Math.max(...absScale);
  const scaleDelta = maxScale - minScale;
  const uniformTolerance = Math.max(
    Number(uniformScaleTolerance),
    maxScale * Number(uniformScaleTolerance),
  );
  const reasons = [];

  if (
    !Number.isFinite(transformPosition.x) ||
    !Number.isFinite(transformPosition.y) ||
    !Number.isFinite(transformPosition.z) ||
    !Number.isFinite(transformScale.x) ||
    !Number.isFinite(transformScale.y) ||
    !Number.isFinite(transformScale.z)
  ) {
    reasons.push("non-finite matrixWorld decomposition");
  }

  if (minScale <= TRANSFORM_SCALE_EPSILON) {
    reasons.push("zero or near-zero proxy scale");
  }

  if (scaleDelta > uniformTolerance) {
    reasons.push("nonuniform proxy scale is unsupported by the unit-sphere local metric");
  }

  const resolvedCameraPosition = readCameraWorldPosition(camera ?? cameraPosition);
  transformInverse.copy(mesh.matrixWorld).invert();
  const localCameraPosition = resolvedCameraPosition.clone().applyMatrix4(transformInverse);
  const originDistance = transformPosition.length();

  if (
    !Number.isFinite(localCameraPosition.x) ||
    !Number.isFinite(localCameraPosition.y) ||
    !Number.isFinite(localCameraPosition.z)
  ) {
    reasons.push("non-finite local camera position");
  }

  return {
    valid: reasons.length === 0,
    reasons,
    worldPosition: transformPosition.clone(),
    worldScale: transformScale.clone(),
    uniformScale: reasons.includes("nonuniform proxy scale is unsupported by the unit-sphere local metric") === false,
    scaleRatio: minScale > TRANSFORM_SCALE_EPSILON ? maxScale / minScale : Number.POSITIVE_INFINITY,
    localCameraPosition,
    localCameraDistance: localCameraPosition.length(),
    unitSphereRadius: UNIT_SPHERE_RADIUS,
    farOriginNotice: originDistance > farOriginNoticeDistance,
    originDistance,
  };
}

export function assertCurvedRayTransformContract(mesh, options = {}) {
  const contract = evaluateCurvedRayTransformContract(mesh, options);

  if (!contract.valid) {
    throw new Error(`Invalid curved-ray proxy transform: ${contract.reasons.join("; ")}`);
  }

  return contract;
}

function clampNumber(value, minValue, maxValue) {
  return Math.min(Math.max(Number(value), minValue), maxValue);
}

function temporalStorageDimension(value, resolutionScale) {
  return Math.max(1, Math.floor(Number(value) * Number(resolutionScale)));
}

export function estimateCurvedRayTemporalHistoryBytes(width, height) {
  const rgba16fBytes = 8;
  return {
    historyRead: width * height * rgba16fBytes,
    historyWrite: width * height * rgba16fBytes,
    total: width * height * rgba16fBytes * 2,
  };
}

export function createCurvedRayHistoryStorageTexture(width, height, name) {
  const history = new StorageTexture(width, height);
  history.name = name;
  history.format = RGBAFormat;
  history.type = HalfFloatType;
  history.colorSpace = NoColorSpace;
  history.minFilter = LinearFilter;
  history.magFilter = LinearFilter;
  history.wrapS = ClampToEdgeWrapping;
  history.wrapT = ClampToEdgeWrapping;
  history.generateMipmaps = false;
  history.mipmapsAutoUpdate = false;
  history.userData.role = "curved-ray-temporal-history";
  history.userData.disposed = false;
  return history;
}

export function createCurvedRayTemporalHistoryStoreNode({
  historyWrite,
  coord,
  value,
}) {
  return textureStore(historyWrite, coord, value).toWriteOnly();
}

function disposeHistoryTexture(texture) {
  if (texture) {
    texture.userData.disposed = true;
    texture.dispose?.();
  }
}

export class CurvedRayTemporalHistory {
  constructor({
    width = 1280,
    height = 720,
    resolutionScale = CURVED_RAY_QUALITY_TIERS.standard.resolutionScale,
    depthThreshold = 0.015,
    velocityThreshold = 0.08,
    cameraCutThreshold = 0.35,
  } = {}) {
    this.settings = {
      sourceWidth: width,
      sourceHeight: height,
      resolutionScale: clampNumber(resolutionScale, 0.05, 1),
      depthThreshold,
      velocityThreshold,
      cameraCutThreshold,
    };
    this.frameIndex = 0;
    this.historyValid = false;
    this.disposed = false;
    this.allocateStorage();
  }

  allocateStorage() {
    this.width = temporalStorageDimension(this.settings.sourceWidth, this.settings.resolutionScale);
    this.height = temporalStorageDimension(this.settings.sourceHeight, this.settings.resolutionScale);
    this.historyRead = createCurvedRayHistoryStorageTexture(this.width, this.height, "curved-ray-history-read");
    this.historyWrite = createCurvedRayHistoryStorageTexture(this.width, this.height, "curved-ray-history-write");
    this.historyClearedOnResize = true;
  }

  setSize(width, height) {
    const nextWidth = temporalStorageDimension(width, this.settings.resolutionScale);
    const nextHeight = temporalStorageDimension(height, this.settings.resolutionScale);

    this.settings.sourceWidth = width;
    this.settings.sourceHeight = height;

    if (nextWidth === this.width && nextHeight === this.height) {
      return false;
    }

    disposeHistoryTexture(this.historyRead);
    disposeHistoryTexture(this.historyWrite);
    this.width = nextWidth;
    this.height = nextHeight;
    this.historyRead = createCurvedRayHistoryStorageTexture(this.width, this.height, "curved-ray-history-read");
    this.historyWrite = createCurvedRayHistoryStorageTexture(this.width, this.height, "curved-ray-history-write");
    this.historyValid = false;
    this.historyClearedOnResize = true;
    return true;
  }

  evaluateRejection({
    cameraCut = false,
    cameraDelta = 0,
    depthDelta = 0,
    velocityError = 0,
  } = {}) {
    const reasons = [];

    if (!this.historyValid) {
      reasons.push("initial-history");
    }

    if (cameraCut || Math.abs(cameraDelta) > this.settings.cameraCutThreshold) {
      reasons.push("camera-cut");
    }

    if (Math.abs(depthDelta) > this.settings.depthThreshold) {
      reasons.push("depth-disocclusion");
    }

    if (Math.abs(velocityError) > this.settings.velocityThreshold) {
      reasons.push("velocity-mismatch");
    }

    return {
      rejected: reasons.length > 0,
      reasons,
    };
  }

  accumulate({
    renderer = null,
    source = null,
    velocity = null,
    depth = null,
    camera = null,
    cameraCut = false,
    cameraDelta = 0,
    depthDelta = 0,
    velocityError = 0,
  } = {}) {
    if (this.disposed) {
      throw new Error("CurvedRayTemporalHistory cannot accumulate after dispose().");
    }

    const rejection = this.evaluateRejection({
      cameraCut,
      cameraDelta,
      depthDelta,
      velocityError,
    });
    const initialHistoryOnly = rejection.reasons.length === 1 &&
      rejection.reasons[0] === "initial-history";
    const readHistory = this.historyRead;
    const writeHistory = this.historyWrite;

    this.historyRead = writeHistory;
    this.historyWrite = readHistory;
    this.historyValid = rejection.rejected === false || initialHistoryOnly;
    this.frameIndex += 1;

    return {
      acceptedHistory: rejection.rejected === false,
      rejectionReasons: rejection.reasons,
      renderer,
      source,
      velocity,
      depth,
      camera,
      readHistory,
      writeHistory,
      storageTexture: StorageTexture.name,
      textureStore: "textureStore(historyWrite, pixelCoord, blendedRadianceDepthVelocity)",
      dispatches: 1,
    };
  }

  createResourcePlan() {
    return {
      history: {
        read: this.historyRead.name,
        write: this.historyWrite.name,
        className: StorageTexture.name,
        type: HalfFloatType,
        format: RGBAFormat,
        colorSpace: "NoColorSpace",
        width: this.width,
        height: this.height,
        bytes: estimateCurvedRayTemporalHistoryBytes(this.width, this.height),
      },
      rejectionInputs: [
        "velocity",
        "depth",
        "cameraCut",
        "cameraDelta",
        "depthDelta",
        "velocityError",
      ],
      computeWrite: "textureStore(historyWrite, pixelCoord, blendedRadianceDepthVelocity)",
    };
  }

  getDiagnostics() {
    return {
      frameIndex: this.frameIndex,
      historyValid: this.historyValid,
      width: this.width,
      height: this.height,
      disposed: this.disposed,
    };
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    disposeHistoryTexture(this.historyRead);
    disposeHistoryTexture(this.historyWrite);
    this.disposed = true;
  }
}

function seededValue(state) {
  let value = state.value >>> 0;
  value = (value * 1664525 + 1013904223) >>> 0;
  state.value = value;
  return value / 0xffffffff;
}

export function configureDataTexture(texture, { mipmaps = true } = {}) {
  texture.colorSpace = NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = mipmaps;
  texture.needsUpdate = true;
  return texture;
}

export function configureColorTexture(texture, { mipmaps = true } = {}) {
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = mipmaps;
  texture.needsUpdate = true;
  return texture;
}

export function createSeededNoiseTexture({
  seed = 1,
  size = 128,
} = {}) {
  const state = { value: sanitizeSeed(seed) || 1 };
  const data = new Uint8Array(size * size * 4);

  for (let index = 0; index < data.length; index += 4) {
    data[index] = Math.floor(seededValue(state) * 255);
    data[index + 1] = Math.floor(seededValue(state) * 255);
    data[index + 2] = Math.floor(seededValue(state) * 255);
    data[index + 3] = 255;
  }

  return configureDataTexture(
    new DataTexture(data, size, size, RGBAFormat, UnsignedByteType),
  );
}

export function selectGeneratedStarfieldTile(seed = 1) {
  const index = sanitizeSeed(seed) % DEFAULT_STARFIELD_TILES.length;
  return DEFAULT_STARFIELD_TILES[index];
}

export function loadGeneratedStarfieldTile({
  seed = 1,
  url = selectGeneratedStarfieldTile(seed),
  loader = new TextureLoader(),
} = {}) {
  const starTexture = loader.load(url);
  return configureColorTexture(starTexture);
}

export async function loadGeneratedStarfieldTileAsync({
  seed = 1,
  url = selectGeneratedStarfieldTile(seed),
  loader = new TextureLoader(),
} = {}) {
  const starTexture = await loader.loadAsync(url);
  return configureColorTexture(starTexture);
}

export function segmentSlabIntersectionZ(z0, z1, halfWidth) {
  const d0 = Number(z0);
  const d1 = Number(z1);
  const width = Math.abs(Number(halfWidth));

  if (!Number.isFinite(d0) || !Number.isFinite(d1) || !Number.isFinite(width) || width <= 0) {
    throw new Error("segmentSlabIntersectionZ requires finite z0, z1, and positive halfWidth.");
  }

  const dz = d1 - d0;
  const inside0 = Math.abs(d0) <= width;
  const inside1 = Math.abs(d1) <= width;

  if (Math.abs(dz) < 1e-8) {
    return {
      intersects: inside0 || inside1,
      enterT: inside0 ? 0 : 1,
      exitT: inside0 ? 1 : 1,
      midT: inside0 ? 0.5 : 1,
      fraction: inside0 ? 1 : 0,
    };
  }

  const tA = (-width - d0) / dz;
  const tB = (width - d0) / dz;
  const enterT = Math.max(0, Math.min(1, Math.min(tA, tB)));
  const exitT = Math.max(0, Math.min(1, Math.max(tA, tB)));
  const intersects = inside0 || inside1 || exitT > enterT;
  const fraction = intersects ? Math.max(0, exitT - enterT) : 0;

  return {
    intersects,
    enterT,
    exitT,
    midT: intersects ? (enterT + exitT) * 0.5 : 1,
    fraction,
  };
}

const remapClamped = Fn(
  ({ value, inMin, inMax, outMin, outMax }) => {
    const t = clamp(
      value.sub(inMin).div(inMax.sub(inMin)),
      0.0,
      1.0,
    );
    return mix(outMin, outMax, t);
  },
);

const smoothRange = Fn(
  ({ value, inMin, inMax, outMin, outMax }) => {
    const t = clamp(
      value.sub(inMin).div(inMax.sub(inMin)),
      0.0,
      1.0,
    ).toVar("smoothRangeT");
    t.assign(t.mul(t).mul(float(3.0).sub(t.mul(2.0))));
    return mix(outMin, outMax, t);
  },
);

const rotate2D = Fn(({ value, angle }) => {
  const sine = sin(angle);
  const cosine = cos(angle);
  return vec2(
    value.x.mul(cosine).sub(value.y.mul(sine)),
    value.x.mul(sine).add(value.y.mul(cosine)),
  );
});

const equirectUv = Fn(({ direction }) => {
  const normalizedDirection = normalize(direction);
  return vec2(
    atan(normalizedDirection.z, normalizedDirection.x)
      .div(TWO_PI)
      .add(0.5),
    acos(clamp(normalizedDirection.y, -1.0, 1.0)).div(PI),
  );
});

const colorRamp = Fn(({ value }) => {
  const whiteHot = vec3(1.0, 0.99, 0.95);
  const gold = vec3(1.0, 0.82, 0.34);
  const amber = vec3(0.42, 0.16, 0.02);
  const whiteToGold = mix(
    whiteHot,
    gold,
    smoothstep(0.06, 0.33, value),
  );
  const goldToAmber = mix(
    gold,
    amber,
    smoothstep(0.33, 1.0, value),
  );
  return mix(whiteToGold, goldToAmber, step(0.33, value));
});

const intersectUnitSphere = Fn(({ rayOrigin, rayDirection }) => {
  const b = dot(rayOrigin, rayDirection);
  const c = dot(rayOrigin, rayOrigin).sub(UNIT_SPHERE_RADIUS);
  const discriminant = b.mul(b).sub(c);
  const root = pow(max(discriminant, 0.0), 0.5);
  return vec3(
    float(0.0).sub(b).sub(root),
    float(0.0).sub(b).add(root),
    discriminant,
  );
});

const hash12 = Fn(({ value, seed }) => {
  const phase = dot(value, vec2(12.9898, 78.233)).add(seed.mul(0.371));
  return fract(sin(phase).mul(43758.5453));
});

const diskSample = Fn(
  ({ samplePosition, noiseTexture, diskWidth, time }) => {
    const radialDistance = length(samplePosition.xy);
    const rotationPhase = radialDistance
      .mul(4.27)
      .sub(time.mul(0.1));
    const noiseUv = rotate2D({
      value: samplePosition.xy,
      angle: rotationPhase,
    }).mul(2.0);
    const deepNoise = texture(noiseTexture, noiseUv).rgb;

    const distanceToBand = vec3(
      diskWidth.negate().sub(samplePosition.z),
      samplePosition.z.negate(),
      diskWidth.sub(samplePosition.z),
    );
    const quadraticBand = distanceToBand
      .mul(distanceToBand)
      .div(diskWidth);
    const diskBand = max(
      vec3(diskWidth).sub(quadraticBand).div(diskWidth),
      vec3(0.0),
    );
    const noiseAmplitude = deepNoise.mul(diskBand);
    const noiseLength = length(noiseAmplitude);
    const nearbyNoiseLength = length(
      texture(noiseTexture, noiseUv.mul(1.002)).rgb.mul(diskBand),
    );

    const rampInput = radialDistance
      .add(noiseLength.sub(0.78).mul(1.5))
      .add(noiseLength.sub(nearbyNoiseLength).mul(19.75));
    const baseColor = colorRamp({ value: rampInput });
    const detailBoost = remapClamped({
      value: nearbyNoiseLength,
      inMin: float(0.35),
      inMax: float(1.2),
      outMin: float(0.75),
      outMax: float(1.15),
    });
    const emission = baseColor.mul(1.95).mul(detailBoost).add(
      vec3(1.0, 0.72, 0.26),
    );

    const alphaNoise = noiseLength.sub(0.75).mul(-0.6);
    const alphaPre = abs(samplePosition.z).add(alphaNoise);
    const alphaRadial = smoothRange({
      value: radialDistance,
      inMin: float(1.0),
      inMax: float(0.0),
      outMin: float(0.0),
      outMax: float(1.0),
    });
    const density = smoothRange({
      value: alphaPre,
      inMin: diskWidth,
      inMax: float(0.0),
      outMin: float(0.0),
      outMax: alphaRadial,
    });

    return vec4(emission, density);
  },
);

const chooseAdaptiveStep = Fn(
  ({
    rayPosition,
    baseStep,
    minStep,
    maxStep,
    diskWidth,
    bendingPower,
  }) => {
    const radius = max(length(rayPosition), 0.001);
    const diskDistance = max(abs(rayPosition.z).sub(diskWidth), 0.0);
    const coreDistance = max(radius.sub(0.13), 0.0);
    const steeringRange = remapClamped({
      value: radius,
      inMin: float(1.0),
      inMax: float(0.5),
      outMin: float(0.0),
      outMax: float(1.0),
    });
    const curvatureEstimate = bendingPower
      .div(max(radius.mul(radius), 0.035))
      .mul(steeringRange);
    const curvatureStep = clamp(
      float(0.035).div(curvatureEstimate.add(0.04)),
      minStep,
      maxStep,
    );
    const structureStep = clamp(
      min(coreDistance.mul(0.32), diskDistance.add(diskWidth.mul(0.45))),
      minStep,
      maxStep,
    );
    const radiusStep = clamp(baseStep.add(radius.mul(0.006)), minStep, maxStep);
    return clamp(
      min(min(curvatureStep, structureStep), radiusStep),
      minStep,
      maxStep,
    );
  },
);

const marchCurvedRayAccretion = Fn(
  ({
    rayOrigin,
    rayDirection,
    noiseTexture,
    starTexture,
    time,
    seed,
    maxSteps,
    baseStep,
    minStep,
    maxStep,
    opacityCutoff,
    extinction,
    bendingPower,
    coreRadius,
    diskWidth,
    debugMode,
  }) => {
    const interval = intersectUnitSphere({ rayOrigin, rayDirection });
    const missed = interval.z.lessThan(0.0);
    const nearDistance = max(interval.x, 0.0);
    const farDistance = max(interval.y, nearDistance);
    const jitter = hash12({
      value: screenUV().mul(4096.0),
      seed,
    })
      .sub(0.5)
      .mul(baseStep);

    // Build-order steps 1-3: bounded local-space setup and explicit state.
    const position = rayOrigin
      .add(rayDirection.mul(max(nearDistance.sub(jitter), 0.0)))
      .toVar("curvedRayPosition");
    const direction = normalize(rayDirection).toVar("curvedRayDirection");
    const radiance = vec3(0.0).toVar("curvedRayRadiance");
    const transmittance = float(1.0).toVar("curvedRayTransmittance");
    const stepCount = float(0.0).toVar("curvedRayStepCount");
    const steeringAccumulated = float(0.0).toVar("curvedRaySteering");
    const terminationId = float(0.0).toVar("curvedRayTermination");
    const traveled = nearDistance.toVar("curvedRayTraveled");
    const done = bool(false).toVar("curvedRayDone");

    Loop(
      {
        start: int(0),
        end: maxSteps,
        type: "int",
        condition: "<",
      },
      () => {
        If(done, () => {
          Break();
        });

        const previousPosition = vec3(position).toVar("previousPosition");
        const radius = max(length(previousPosition), 0.001);
        const radialDirection = previousPosition.div(radius);

        // Build-order step 4: the accepted-step length comes from distance,
        // disk-density, and curvature estimators rather than a global stride.
        const stepLength = chooseAdaptiveStep({
          rayPosition: previousPosition,
          baseStep,
          minStep,
          maxStep,
          diskWidth,
          bendingPower,
        }).toVar("adaptiveStepLength");

        // The reference pseudocode bends after forming the candidate, but this
        // accretion port intentionally steers before the single advance because
        // the task requires steering to affect the accepted segment.
        const steeringRange = remapClamped({
          value: radius,
          inMin: float(1.0),
          inMax: float(0.5),
          outMin: float(0.0),
          outMax: float(1.0),
        });
        const steeringMagnitude = stepLength
          .mul(bendingPower)
          .div(max(radius.mul(radius), 0.035))
          .mul(steeringRange);
        direction.assign(
          normalize(direction.sub(radialDirection.mul(steeringMagnitude))),
        );
        steeringAccumulated.assign(
          steeringAccumulated.add(steeringMagnitude),
        );

        const candidatePosition = previousPosition
          .add(direction.mul(stepLength))
          .toVar("candidatePosition");
        const invalidState = candidatePosition.x.notEqual(candidatePosition.x)
          .or(candidatePosition.y.notEqual(candidatePosition.y))
          .or(candidatePosition.z.notEqual(candidatePosition.z))
          .or(direction.x.notEqual(direction.x))
          .or(direction.y.notEqual(direction.y))
          .or(direction.z.notEqual(direction.z))
          .or(stepLength.notEqual(stepLength))
          .or(radius.notEqual(radius))
          .or(radius.greaterThan(1e6))
          .or(stepLength.lessThanEqual(0.0));

        If(invalidState, () => {
          terminationId.assign(5.0);
          done.assign(true);
        });
        If(done, () => {
          Break();
        });

        // Build-order step 5: finite-thickness slab overlap over the accepted
        // segment instead of sample-only plane tests.
        const d0 = previousPosition.z;
        const d1 = candidatePosition.z;
        const segmentZ = d1.sub(d0);
        const safeSegmentZ = segmentZ.add(select(abs(segmentZ).lessThan(1e-5), 1e-5, 0.0));
        const insideStart = abs(d0).lessThanEqual(diskWidth);
        const insideEnd = abs(d1).lessThanEqual(diskWidth);
        const crossesLowerSlab = d0.add(diskWidth).mul(d1.add(diskWidth)).lessThanEqual(0.0);
        const crossesUpperSlab = d0.sub(diskWidth).mul(d1.sub(diskWidth)).lessThanEqual(0.0);
        const touchesDiskSlab = insideStart.or(insideEnd).or(crossesLowerSlab).or(crossesUpperSlab);
        const lowerT = clamp(diskWidth.negate().sub(d0).div(safeSegmentZ), 0.0, 1.0);
        const upperT = clamp(diskWidth.sub(d0).div(safeSegmentZ), 0.0, 1.0);
        const slabEnterT = min(lowerT, upperT);
        const slabExitT = max(lowerT, upperT);
        const slabMidT = select(touchesDiskSlab, slabEnterT.add(slabExitT).mul(0.5), 1.0);
        const slabFraction = select(touchesDiskSlab, max(slabExitT.sub(slabEnterT), 0.0), 0.0);
        const slabLength = stepLength.mul(slabFraction);
        const crossingPosition = mix(previousPosition, candidatePosition, slabMidT);
        const samplePosition = select(
          touchesDiskSlab,
          crossingPosition,
          candidatePosition,
        );
        const disk = diskSample({
          samplePosition,
          noiseTexture,
          diskWidth,
          time,
        });
        const insideCore = length(candidatePosition).lessThan(coreRadius);
        const density = select(insideCore, float(1.0), disk.a.mul(select(touchesDiskSlab, float(1.0), float(0.0))));
        const densityLength = select(insideCore, stepLength, slabLength);
        const segmentAlpha = float(1.0).sub(
          exp(density.mul(extinction).mul(densityLength).negate()),
        );
        const segmentEmission = select(insideCore, vec3(0.0), disk.rgb);

        // Build-order step 6: exactly one ray-position advance is committed.
        // The legacy source advanced at both line 197 and line 276; this port
        // keeps the accepted-step state update singular.
        position.assign(candidatePosition);
        traveled.assign(traveled.add(stepLength));
        stepCount.assign(stepCount.add(1.0));

        // Build-order step 7: linear front-to-back emission/transmittance.
        radiance.assign(
          radiance.add(transmittance.mul(segmentEmission).mul(segmentAlpha)),
        );
        transmittance.assign(
          transmittance.mul(float(1.0).sub(segmentAlpha)),
        );

        // Build-order step 8: terminate on core absorption, opacity
        // saturation, bounded-volume escape, or step-cap exhaustion.
        If(insideCore, () => {
          terminationId.assign(2.0);
          done.assign(true);
        });
        If(transmittance.lessThan(opacityCutoff), () => {
          terminationId.assign(3.0);
          done.assign(true);
        });
        If(traveled.greaterThan(farDistance.add(maxStep.mul(2.0))), () => {
          terminationId.assign(1.0);
          done.assign(true);
        });
        If(stepCount.greaterThanEqual(float(maxSteps).sub(1.0)), () => {
          terminationId.assign(4.0);
          done.assign(true);
        });
        const invalidAccumulation = radiance.x.notEqual(radiance.x)
          .or(radiance.y.notEqual(radiance.y))
          .or(radiance.z.notEqual(radiance.z))
          .or(transmittance.notEqual(transmittance));
        If(invalidAccumulation, () => {
          terminationId.assign(5.0);
          done.assign(true);
        });
      },
    );

    // Build-order step 9: the environment is sampled after integration using
    // the bent direction, not by warping an already-rendered image.
    const environment = texture(
      starTexture,
      equirectUv({
        direction: direction.mul(vec3(1.0, -1.0, 1.0)),
      }),
    ).rgb;
    const finalColor = radiance.add(environment.mul(transmittance));
    const heat = clamp(stepCount.div(float(maxSteps)), 0.0, 1.0);
    const steeringHeat = clamp(steeringAccumulated.mul(3.0), 0.0, 1.0);
    const debugStepColor = vec3(heat, heat.mul(heat), float(1.0).sub(heat));
    const debugTransmittance = vec3(transmittance);
    const debugSteering = vec3(
      steeringHeat,
      steeringHeat.mul(steeringHeat),
      float(1.0).sub(steeringHeat),
    );
    const terminationHeat = clamp(terminationId.div(5.0), 0.0, 1.0);
    const debugTermination = vec3(
      terminationHeat,
      select(terminationId.equal(0.0), float(0.0), float(1.0)),
      float(1.0).sub(terminationHeat),
    );
    const debugInvalidState = select(
      terminationId.equal(5.0),
      vec3(1.0, 0.0, 1.0),
      vec3(0.0),
    );
    const debugBentDirection = direction.mul(0.5).add(0.5);
    const debugOpacity = vec3(float(1.0).sub(transmittance));
    const debugCoreHit = select(
      terminationId.equal(2.0),
      vec3(1.0, 0.25, 0.05),
      vec3(0.0),
    );
    const debugFinal = select(
      debugMode.equal(1),
      debugStepColor,
      finalColor,
    );
    const debugTrans = select(
      debugMode.equal(2),
      debugTransmittance,
      debugFinal,
    );
    const debugSteer = select(
      debugMode.equal(3),
      debugSteering,
      debugTrans,
    );
    const debugTerm = select(
      debugMode.equal(4),
      debugTermination,
      debugSteer,
    );
    const debugInvalid = select(
      debugMode.equal(5),
      debugInvalidState,
      debugTerm,
    );
    const debugBent = select(
      debugMode.equal(6),
      debugBentDirection,
      debugInvalid,
    );
    const debugOpacityOut = select(
      debugMode.equal(7),
      debugOpacity,
      debugBent,
    );
    const debugCore = select(
      debugMode.equal(8),
      debugCoreHit,
      debugOpacityOut,
    );

    return vec4(
      select(missed, environment, debugCore),
      1.0,
    );
  },
);

function qualityWithFallback(quality) {
  if (typeof quality === "string") {
    return CURVED_RAY_QUALITY_TIERS[quality] ?? CURVED_RAY_QUALITY_TIERS.standard;
  }
  return {
    ...CURVED_RAY_QUALITY_TIERS.standard,
    ...quality,
  };
}

export function createCurvedRayAccretionMaterial({
  noiseTexture = createSeededNoiseTexture(),
  starTexture = loadGeneratedStarfieldTile(),
  seed = 1,
  quality = "standard",
  debugMode = "final",
  time = 0,
  bendingPower = AUTHORED_LEGACY_IDENTITY.bendingPower,
  coreRadius = AUTHORED_LEGACY_IDENTITY.coreRadius,
  diskWidth = AUTHORED_LEGACY_IDENTITY.diskWidth,
} = {}) {
  configureDataTexture(noiseTexture);
  configureColorTexture(starTexture);

  const tier = qualityWithFallback(quality);
  const uniforms = {
    time: uniform(time),
    seed: uniform(sanitizeSeed(seed)),
    maxSteps: uniform(tier.maxSteps, "int"),
    baseStep: uniform(tier.baseStep),
    minStep: uniform(tier.minStep),
    maxStep: uniform(tier.maxStep),
    opacityCutoff: uniform(tier.opacityCutoff),
    extinction: uniform(tier.extinction),
    bendingPower: uniform(bendingPower),
    coreRadius: uniform(coreRadius),
    diskWidth: uniform(diskWidth),
    debugMode: uniform(CURVED_RAY_DEBUG_MODES[debugMode] ?? 0, "int"),
  };

  const localCameraPosition = modelWorldMatrixInverse
    .mul(vec4(cameraPosition, 1.0))
    .xyz;
  const rayDirection = normalize(positionLocal.sub(localCameraPosition));
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: BackSide,
  });
  material.name = "TSL Curved Ray Accretion";
  material.colorNode = marchCurvedRayAccretion({
    rayOrigin: localCameraPosition,
    rayDirection,
    noiseTexture,
    starTexture,
    time: uniforms.time,
    seed: uniforms.seed,
    maxSteps: uniforms.maxSteps,
    baseStep: uniforms.baseStep,
    minStep: uniforms.minStep,
    maxStep: uniforms.maxStep,
    opacityCutoff: uniforms.opacityCutoff,
    extinction: uniforms.extinction,
    bendingPower: uniforms.bendingPower,
    coreRadius: uniforms.coreRadius,
    diskWidth: uniforms.diskWidth,
    debugMode: uniforms.debugMode,
  });

  material.userData.curvedRayUniforms = uniforms;
  material.userData.curvedRayTextures = { noiseTexture, starTexture };
  material.userData.curvedRayQuality = { ...tier };
  return material;
}

export function createCurvedRayAccretionMesh(options = {}) {
  const geometry = new SphereGeometry(1, 96, 48);
  const material = createCurvedRayAccretionMaterial(options);
  const mesh = new Mesh(geometry, material);
  mesh.name = "TSL Curved Ray Accretion Volume";
  mesh.frustumCulled = true;
  return mesh;
}

export function createCurvedRayRenderPipeline(renderer, scene, camera, {
  effect = null,
  resolutionScale = effect?.resolutionScale ?? CURVED_RAY_QUALITY_TIERS.standard.resolutionScale,
  outputToneMapping = NoToneMapping,
  outputColorSpace = renderer.outputColorSpace,
} = {}) {
  const scenePass = pass(scene, camera);
  scenePass.setResolutionScale(resolutionScale);

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = renderOutput(scenePass, outputToneMapping, outputColorSpace);

  return {
    pipeline,
    scenePass,
    resolutionScale,
    outputTransformOwner: "renderOutput",
    outputColorTransform: false,
    render() {
      if (effect?.mesh) {
        assertCurvedRayTransformContract(effect.mesh, { camera });
      }

      const previousTarget = renderer.getRenderTarget?.();

      try {
        pipeline.render();
      } finally {
        if (previousTarget !== undefined && renderer.setRenderTarget) {
          renderer.setRenderTarget(previousTarget);
        }
      }
    },
    diagnostics() {
      return {
        pass: "scene",
        resolutionScale: scenePass.getResolutionScale(),
        outputTransformOwner: "renderOutput",
        outputColorTransform: pipeline.outputColorTransform,
      };
    },
    dispose() {
      pipeline.dispose?.();
    },
  };
}

export class TSLCurvedRayAccretionEffect {
  constructor(options = {}) {
    this.mesh = createCurvedRayAccretionMesh(options);
    this.material = this.mesh.material;
    this.uniforms = this.material.userData.curvedRayUniforms;
    this.textures = this.material.userData.curvedRayTextures;
    this.resolutionScale =
      qualityWithFallback(options.quality).resolutionScale;
    this.temporalHistory = options.temporalHistory === true
      ? new CurvedRayTemporalHistory({
        width: options.width ?? 1280,
        height: options.height ?? 720,
        resolutionScale: this.resolutionScale,
      })
      : options.temporalHistory ?? null;
    this.temporalAccumulator = options.temporalAccumulator ?? this.temporalHistory;
    this.disposed = false;
  }

  setQuality(quality) {
    const tier = qualityWithFallback(quality);
    this.uniforms.maxSteps.value = tier.maxSteps;
    this.uniforms.baseStep.value = tier.baseStep;
    this.uniforms.minStep.value = tier.minStep;
    this.uniforms.maxStep.value = tier.maxStep;
    this.uniforms.opacityCutoff.value = tier.opacityCutoff;
    this.uniforms.extinction.value = tier.extinction;
    this.resolutionScale = tier.resolutionScale;
    this.material.userData.curvedRayQuality = { ...tier };
  }

  setDebugMode(mode) {
    this.uniforms.debugMode.value = CURVED_RAY_DEBUG_MODES[mode] ?? 0;
  }

  setSeed(seed) {
    this.uniforms.seed.value = sanitizeSeed(seed);
  }

  update(time) {
    this.uniforms.time.value = time;
  }

  async prepareRenderer(renderer, scene, camera) {
    await prepareCurvedRayRenderer({
      renderer,
      scene,
      camera,
      effect: this,
    });
  }

  createRenderPipeline(renderer, scene, camera, options = {}) {
    return createCurvedRayRenderPipeline(renderer, scene, camera, {
      ...options,
      effect: this,
    });
  }

  render(renderer, scene, camera, { target = null } = {}) {
    assertCurvedRayTransformContract(this.mesh, { camera });
    const previousTarget = renderer.getRenderTarget();

    try {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      if (this.temporalAccumulator) {
        this.temporalAccumulator.accumulate?.({
          renderer,
          scene,
          camera,
          source: target,
          resolutionScale: this.resolutionScale,
        });
      }
    } finally {
      renderer.setRenderTarget(previousTarget);
    }
  }

  metrics() {
    const quality = this.material.userData.curvedRayQuality;
    return {
      proxyDraws: 1,
      dispatches: this.temporalAccumulator ? 1 : 0,
      maxAcceptedSteps: this.uniforms.maxSteps.value,
      resolutionScale: this.resolutionScale,
      storage: this.temporalHistory?.createResourcePlan?.() ?? "none",
      quality,
    };
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.textures.noiseTexture?.dispose?.();
    this.textures.starTexture?.dispose?.();
    this.temporalAccumulator?.dispose?.();
    this.disposed = true;
  }
}

export async function prepareCurvedRayRenderer({
  renderer = new WebGPURenderer(),
  scene,
  camera,
  effect,
  explicitFallbackWhenWebGPUUnavailable = false,
} = {}) {
  await renderer.init();

  if (effect?.mesh && camera) {
    assertCurvedRayTransformContract(effect.mesh, { camera });
  }

  const isWebGPUBackend = renderer.backend?.isWebGPUBackend === true;
  if (!isWebGPUBackend) {
    if (!explicitFallbackWhenWebGPUUnavailable) {
      throw new Error(
        "WebGPU backend unavailable. This example teaches the canonical WebGPU/TSL path; only pass explicitFallbackWhenWebGPUUnavailable when the user explicitly asks how to apply fallback when WebGPU is unavailable.",
      );
    }
    effect?.setQuality?.("background");
  }

  const textures = effect?.textures ?? effect?.material?.userData?.curvedRayTextures ?? {};
  if (renderer.initTexture) {
    for (const texture of Object.values(textures)) {
      if (texture) {
        renderer.initTexture(texture);
      }
    }
  }

  if (scene && camera && renderer.compileAsync) {
    await renderer.compileAsync(scene, camera);
  }

  return {
    renderer,
    isWebGPUBackend,
    quality: effect?.material?.userData?.curvedRayQuality ?? null,
  };
}

export function createCurvedRayTemporalHook({
  accumulate = null,
  dispose = null,
} = {}) {
  return {
    accumulate,
    dispose,
  };
}
