import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  MirroredRepeatWrapping,
  NoColorSpace,
  RGBAFormat,
  StorageTexture,
  Vector2,
  WebGPURenderer,
  RenderPipeline,
} from "three/webgpu";
import {
  Fn,
  If,
  abs,
  clamp,
  dot,
  exp,
  float,
  globalId,
  max,
  min,
  mix,
  mrt,
  normalize,
  pass,
  pow,
  refract,
  renderOutput,
  select,
  sin,
  smoothstep,
  sqrt,
  storageTexture,
  texture,
  textureLoad,
  textureStore,
  uint,
  uvec2,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";

const tslSymbols = {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  uv,
  pass,
  mrt,
  renderOutput,
  storageTexture,
  textureStore,
  textureLoad,
  globalId,
  If,
  gaussianBlur,
};

void tslSymbols;

export const DEFAULT_FROST_SETTINGS = Object.freeze({
  decaySurvivalPerSecond: 0.92,
  depositPerSecond: 0.94,
  maxDeltaSeconds: 1 / 15,
  diffusionCoefficient: 0.08,
  diffusionEnabled: true,
  visibleNoiseStrength: 0.16,
  tiltNoiseStrength: 0.06,
  brushRadius: 0.16,
  sideFade: 0.35,
  cornerFade: 0.55,
  blurResolutionScale: 0.4,
  mainScreenPeriod: 1200,
  detailScreenPeriod: 350,
  mainNormalStrength: 0.3,
  detailNormalStrength: 2.0,
  ior: 1.31,
  thickness: 1.0,
  sourceInset: 0.17,
  opticalSide: "outside",
});

export const FROST_MECHANISMS = Object.freeze([
  "history-and-deposit",
  "diffusion",
  "blur-and-reconstruction",
  "crystal-field-and-normals",
  "refraction-and-fresnel",
  "full-vs-dirty-vs-idle",
]);

export const FROST_MECHANISM_PROFILES = Object.freeze({
  "history-and-deposit": Object.freeze({
    id: "history-and-deposit",
    diffusion: false,
    blur: false,
    crystalField: false,
    refraction: false,
    updatePolicy: "full-field",
    startupDebugView: "next history R/A",
    reachableNodes: Object.freeze(["history-read", "pointer-deposit", "history-write"]),
  }),
  diffusion: Object.freeze({
    id: "diffusion",
    diffusion: true,
    blur: false,
    crystalField: false,
    refraction: false,
    updatePolicy: "full-field",
    startupDebugView: "next history R/A",
    reachableNodes: Object.freeze(["history-read", "pointer-deposit", "laplacian-diffusion", "history-write"]),
  }),
  "blur-and-reconstruction": Object.freeze({
    id: "blur-and-reconstruction",
    diffusion: false,
    blur: true,
    crystalField: false,
    refraction: false,
    updatePolicy: "full-field",
    startupDebugView: "horizontal blur",
    reachableNodes: Object.freeze(["history-update", "scene-color", "gaussian-horizontal", "gaussian-vertical", "reconstruction"]),
  }),
  "crystal-field-and-normals": Object.freeze({
    id: "crystal-field-and-normals",
    diffusion: false,
    blur: false,
    crystalField: true,
    refraction: false,
    updatePolicy: "full-field",
    startupDebugView: "frozen structure",
    reachableNodes: Object.freeze(["history-update", "frost-noise", "frozen-structure", "highlight-structure", "surface-normal"]),
  }),
  "refraction-and-fresnel": Object.freeze({
    id: "refraction-and-fresnel",
    diffusion: false,
    blur: true,
    crystalField: true,
    refraction: true,
    updatePolicy: "full-field",
    startupDebugView: "final",
    reachableNodes: Object.freeze(["history-update", "gaussian-blur", "crystal-field", "snell-refraction", "exact-dielectric-fresnel", "final-composite"]),
  }),
  "full-vs-dirty-vs-idle": Object.freeze({
    id: "full-vs-dirty-vs-idle",
    diffusion: false,
    blur: false,
    crystalField: false,
    refraction: false,
    updatePolicy: "full-field-reference",
    benchmarkLedger: true,
    startupDebugView: "next history R/A",
    reachableNodes: Object.freeze(["event-gate", "history-read", "history-write", "dispatch-ledger"]),
  }),
});

export const FROST_QUALITY_TIERS = Object.freeze({
  full: Object.freeze({
    id: "full",
    historyScale: 1,
    blurResolutionScale: 0.5,
    twoScaleRefraction: true,
    historyFormat: "RGBA16F",
  }),
  balanced: Object.freeze({
    id: "balanced",
    historyScale: 0.5,
    blurResolutionScale: 0.33,
    twoScaleRefraction: true,
    historyFormat: "RGBA16F",
  }),
  budgeted: Object.freeze({
    id: "budgeted",
    historyScale: 0.25,
    blurResolutionScale: 0.25,
    twoScaleRefraction: false,
    historyFormat: "RGBA16F",
  }),
});

export const FROST_DEBUG_VIEWS = Object.freeze([
  "scene color",
  "vertical blur",
  "horizontal blur",
  "frost noise",
  "frozen structure",
  "highlight structure",
  "previous history R/A",
  "deposit R/A",
  "next history R/A",
  "frost mask before pointer",
  "frost mask after pointer",
  "sharp/blur mix",
  "main refraction offset",
  "detail refraction offset",
  "final without refraction",
  "final",
  "pause",
  "singleStep",
]);

export function requireFrostMechanism(mechanismId) {
  const profile = FROST_MECHANISM_PROFILES[mechanismId];
  if (!profile) throw new RangeError(`unknown frost mechanism "${mechanismId}"`);
  return profile;
}

export function computeFrostExtents({
  drawingWidth,
  drawingHeight,
  historyScale,
} = {}) {
  if (![drawingWidth, drawingHeight, historyScale].every(Number.isFinite)
      || drawingWidth <= 0 || drawingHeight <= 0 || historyScale <= 0 || historyScale > 1) {
    throw new RangeError("drawing-buffer dimensions and history scale must be finite and positive");
  }
  const displayWidth = Math.max(1, Math.trunc(drawingWidth));
  const displayHeight = Math.max(1, Math.trunc(drawingHeight));
  const historyWidth = Math.max(1, Math.round(displayWidth * historyScale));
  const historyHeight = Math.max(1, Math.round(displayHeight * historyScale));
  return Object.freeze({
    displayWidth,
    displayHeight,
    historyWidth,
    historyHeight,
    historyScale,
    realizedScale: Object.freeze({
      x: historyWidth / displayWidth,
      y: historyHeight / displayHeight,
    }),
  });
}

export function screenPeriodPhase(pixelCoordinate, periodPixels) {
  if (!Number.isFinite(pixelCoordinate) || !Number.isFinite(periodPixels) || periodPixels <= 0) {
    throw new RangeError("screen period inputs must be finite and periodPixels must be positive");
  }
  return (2 * Math.PI * pixelCoordinate) / periodPixels;
}

export function exactDielectricFresnel(cosIncident, incidentIor, transmittedIor) {
  if (![cosIncident, incidentIor, transmittedIor].every(Number.isFinite)
      || incidentIor <= 0 || transmittedIor <= 0) {
    throw new RangeError("exact Fresnel inputs must be finite with positive refractive indices");
  }
  const ci = Math.min(1, Math.max(0, cosIncident));
  const eta = incidentIor / transmittedIor;
  const sinTransmittedSquared = eta * eta * (1 - ci * ci);
  if (sinTransmittedSquared > 1) {
    return Object.freeze({ reflectance: 1, totalInternalReflection: true, cosTransmitted: 0 });
  }
  const ct = Math.sqrt(Math.max(0, 1 - sinTransmittedSquared));
  const rsDenominator = incidentIor * ci + transmittedIor * ct;
  const rpDenominator = transmittedIor * ci + incidentIor * ct;
  const rs = rsDenominator > 1e-12
    ? (incidentIor * ci - transmittedIor * ct) / rsDenominator
    : 1;
  const rp = rpDenominator > 1e-12
    ? (transmittedIor * ci - incidentIor * ct) / rpDenominator
    : 1;
  return Object.freeze({
    reflectance: Math.min(1, Math.max(0, 0.5 * (rs * rs + rp * rp))),
    totalInternalReflection: false,
    cosTransmitted: ct,
  });
}

export function computeSideAwareRefraction({
  slope = { x: 0, y: 0 },
  ior = DEFAULT_FROST_SETTINGS.ior,
  thickness = DEFAULT_FROST_SETTINGS.thickness,
  side = DEFAULT_FROST_SETTINGS.opticalSide,
  resolution = { x: 1, y: 1 },
} = {}) {
  if (![slope.x, slope.y, ior, thickness, resolution.x, resolution.y].every(Number.isFinite)
      || ior <= 1 || thickness < 0 || resolution.x <= 0 || resolution.y <= 0) {
    throw new RangeError("refraction inputs must be finite; IOR > 1, thickness >= 0, and resolution > 0");
  }
  if (side !== "outside" && side !== "inside") {
    throw new RangeError(`unknown optical side "${side}"`);
  }
  const inverseLength = 1 / Math.hypot(slope.x, slope.y, 1);
  const normal = {
    x: -slope.x * inverseLength,
    y: -slope.y * inverseLength,
    z: inverseLength,
  };
  const incidentIor = side === "outside" ? 1 : ior;
  const transmittedIor = side === "outside" ? ior : 1;
  const cosIncident = normal.z;
  const fresnel = exactDielectricFresnel(cosIncident, incidentIor, transmittedIor);
  if (fresnel.totalInternalReflection) {
    return Object.freeze({
      uvOffset: Object.freeze({ x: 0, y: 0 }),
      ...fresnel,
      incidentIor,
      transmittedIor,
    });
  }
  const eta = incidentIor / transmittedIor;
  const factor = eta * cosIncident - fresnel.cosTransmitted;
  const transmitted = {
    x: factor * normal.x,
    y: factor * normal.y,
    z: -eta + factor * normal.z,
  };
  const inverseAbsZ = 1 / Math.max(Math.abs(transmitted.z), 1e-12);
  return Object.freeze({
    uvOffset: Object.freeze({
      x: transmitted.x * inverseAbsZ * thickness / resolution.x,
      y: transmitted.y * inverseAbsZ * thickness / resolution.y,
    }),
    ...fresnel,
    incidentIor,
    transmittedIor,
  });
}

export function assertDistinctHistoryBindings({ readTexture, writeTexture, readNode, writeNode } = {}) {
  if (!readTexture || !writeTexture || readTexture === writeTexture) {
    throw new Error("history ping-pong requires distinct read and write textures");
  }
  if (!readNode || !writeNode || readNode === writeNode) {
    throw new Error("history ping-pong requires distinct read and write texture nodes");
  }
  if (readNode.value !== readTexture || writeNode.value !== writeTexture) {
    throw new Error("history texture-node bindings do not match the active ping-pong slots");
  }
  return true;
}

export function resolveFrostGraphContract(mechanismId, tierId, drawingWidth, drawingHeight) {
  const mechanism = requireFrostMechanism(mechanismId);
  const tier = FROST_QUALITY_TIERS[tierId];
  if (!tier) throw new RangeError(`unknown frost tier "${tierId}"`);
  const extents = computeFrostExtents({ drawingWidth, drawingHeight, historyScale: tier.historyScale });
  const reachableNodes = [...mechanism.reachableNodes];
  if (tier.twoScaleRefraction && mechanism.refraction) reachableNodes.push("detail-refraction-normal");
  return Object.freeze({
    mechanism: mechanism.id,
    tier: tier.id,
    updatePolicy: mechanism.updatePolicy,
    diffusion: mechanism.diffusion,
    blurPassCount: mechanism.blur ? 2 : 0,
    crystalField: mechanism.crystalField,
    refraction: mechanism.refraction,
    benchmarkLedger: mechanism.benchmarkLedger === true,
    refractionScaleCount: mechanism.refraction ? (tier.twoScaleRefraction ? 2 : 1) : 0,
    reachableNodes: Object.freeze(reachableNodes),
    extents,
  });
}

export function clampDeltaSeconds(deltaSeconds, maxDeltaSeconds = DEFAULT_FROST_SETTINGS.maxDeltaSeconds) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return 0;
  }
  return Math.min(deltaSeconds, maxDeltaSeconds);
}

export function survivalFactor(decaySurvivalPerSecond, deltaSeconds) {
  return decaySurvivalPerSecond ** deltaSeconds;
}

export function depositScale(depositPerSecond, deltaSeconds) {
  return 1 - (1 - depositPerSecond) ** deltaSeconds;
}

export function laplacianDiffusion({
  center,
  left,
  right,
  up,
  down,
  coefficient = DEFAULT_FROST_SETTINGS.diffusionCoefficient,
  deltaSeconds,
}) {
  validateDiffusionStep(coefficient, deltaSeconds);
  const laplacian = left + right + up + down - 4 * center;
  return center + laplacian * coefficient * deltaSeconds;
}

export function validateDiffusionStep(coefficient, deltaSeconds) {
  if (!Number.isFinite(coefficient) || coefficient < 0) {
    throw new RangeError("diffusion coefficient must be finite and nonnegative");
  }
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError("diffusion delta must be finite and nonnegative");
  }
  const diffusionNumber = coefficient * deltaSeconds;
  if (diffusionNumber > 0.25 + Number.EPSILON) {
    throw new RangeError(`unstable explicit diffusion: D*dt=${diffusionNumber} exceeds 0.25`);
  }
  return diffusionNumber;
}

export function solveDecayDeposit(previous, brush, deltaSeconds, settings = DEFAULT_FROST_SETTINGS) {
  if (![previous, brush, deltaSeconds].every(Number.isFinite)) {
    throw new TypeError("history update inputs must be finite");
  }
  if (deltaSeconds < 0) throw new RangeError("history delta must be nonnegative");
  const x = Math.min(1, Math.max(0, previous));
  const b = Math.min(1, Math.max(0, brush));
  const lambda = -Math.log(settings.decaySurvivalPerSecond);
  const fillRate = -Math.log(1 - settings.depositPerSecond);
  const effectiveFill = fillRate * b;
  const totalRate = lambda + effectiveFill;
  if (deltaSeconds === 0 || totalRate === 0) return x;
  const equilibrium = effectiveFill / totalRate;
  return Math.min(1, Math.max(0, equilibrium + (x - equilibrium) * Math.exp(-totalRate * deltaSeconds)));
}

export function visibleSignatureForFrameRates(frameRates = [30, 60, 120]) {
  return frameRates.map((fps) => ({
    fps,
    expected: "same fixed pointer path converges within tolerance",
    wrongIf: "per-frame decay makes lower FPS clear faster or higher FPS over-deposit",
  }));
}

export function updateHistorySample({
  previousR,
  previousA,
  pointerActive = true,
  pressure = 1,
  visibleDeposit = 1,
  tiltDeposit = 0.65,
  deltaSeconds,
  settings = DEFAULT_FROST_SETTINGS,
}) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError("deltaSeconds must be finite and nonnegative");
  }
  const dt = deltaSeconds;
  const survival = survivalFactor(settings.decaySurvivalPerSecond, dt);
  const visibleBrush = pointerActive ? pressure * visibleDeposit : 0;
  const tiltBrush = pointerActive ? pressure * tiltDeposit : 0;
  const nextR = solveDecayDeposit(previousR, visibleBrush, dt, settings);
  const nextA = solveDecayDeposit(previousA, tiltBrush, dt, settings);

  return {
    r: nextR,
    g: nextR,
    b: nextR,
    a: nextA,
    previous: { r: previousR, a: previousA },
    deposit: { r: visibleBrush, a: tiltBrush },
    dt,
    survival,
  };
}

export function distanceToAspectCorrectedSegment(uvPoint, segmentStart, segmentEnd, aspect) {
  const bax = (segmentEnd.x - segmentStart.x) * aspect;
  const bay = segmentEnd.y - segmentStart.y;
  const pax = (uvPoint.x - segmentStart.x) * aspect;
  const pay = uvPoint.y - segmentStart.y;
  const denominator = bax * bax + bay * bay;
  const h = denominator > 1e-12
    ? Math.min(1, Math.max(0, (pax * bax + pay * bay) / denominator))
    : 0;
  return Math.hypot(pax - bax * h, pay - bay * h);
}

export class TimestampedDirtyTileHistory {
  constructor({ tileCount, initialValue = 0, initialTime = 0, settings = DEFAULT_FROST_SETTINGS } = {}) {
    if (!Number.isInteger(tileCount) || tileCount <= 0) {
      throw new RangeError("tileCount must be a positive integer");
    }
    this.settings = settings;
    this.values = new Float32Array(tileCount);
    this.values.fill(initialValue);
    this.lastUpdateTimes = new Float64Array(tileCount);
    this.lastUpdateTimes.fill(initialTime);
  }

  materialize(tileIndex, timeSeconds) {
    this.#assertTile(tileIndex);
    const elapsed = timeSeconds - this.lastUpdateTimes[tileIndex];
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      throw new RangeError("dirty-tile time must be monotone and finite");
    }
    const next = solveDecayDeposit(this.values[tileIndex], 0, elapsed, this.settings);
    this.values[tileIndex] = next;
    this.lastUpdateTimes[tileIndex] = timeSeconds;
    return next;
  }

  deposit(tileIndex, timeSeconds, brush, durationSeconds) {
    const caughtUp = this.materialize(tileIndex, timeSeconds);
    const next = solveDecayDeposit(caughtUp, brush, durationSeconds, this.settings);
    this.values[tileIndex] = next;
    this.lastUpdateTimes[tileIndex] = timeSeconds + durationSeconds;
    return next;
  }

  #assertTile(tileIndex) {
    if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= this.values.length) {
      throw new RangeError(`tile index ${tileIndex} is outside history`);
    }
  }
}

export function simulateHeldPointer({
  fps,
  seconds = 1,
  settings = DEFAULT_FROST_SETTINGS,
}) {
  const frames = Math.round(fps * seconds);
  let state = { r: 0, a: 0 };
  for (let frame = 0; frame < frames; frame += 1) {
    const next = updateHistorySample({
      previousR: state.r,
      previousA: state.a,
      deltaSeconds: 1 / fps,
      settings,
    });
    state = { r: next.r, a: next.a };
  }
  return state;
}

export function computeDispatchSize(width, height, tileSize = 8) {
  return {
    x: Math.ceil(width / tileSize),
    y: Math.ceil(height / tileSize),
    count: Math.ceil(width / tileSize) * Math.ceil(height / tileSize),
    tileSize,
  };
}

export function estimateHistoryStorageBytes(width, height) {
  const rgba16fBytes = 8;
  return {
    historyRead: width * height * rgba16fBytes,
    historyWrite: width * height * rgba16fBytes,
    total: width * height * rgba16fBytes * 2,
  };
}

export function createHistoryStorageDescriptor(width, height) {
  return {
    className: StorageTexture.name,
    width,
    height,
    type: HalfFloatType,
    format: RGBAFormat,
    colorSpace: "NoColorSpace",
    threeColorSpace: NoColorSpace,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    generateMipmaps: false,
  };
}

export function createStaticTextureDescriptor(asset) {
  return {
    id: asset.id,
    colorSpace: "NoColorSpace",
    threeColorSpace: NoColorSpace,
    wrapS: MirroredRepeatWrapping,
    wrapT: MirroredRepeatWrapping,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
  };
}

export function createTwoScaleRefractionContract(settings = DEFAULT_FROST_SETTINGS) {
  return {
    mainScreenPeriod: settings.mainScreenPeriod,
    detailScreenPeriod: settings.detailScreenPeriod,
    mainNormalStrength: settings.mainNormalStrength,
    detailNormalStrength: settings.detailNormalStrength,
    heightWeight: "detail refraction is weighted by main-normal height",
    Fresnel: "side-aware exact dielectric Fresnel with total-internal-reflection classification",
    sourceInsetPixels: settings.sourceInset,
    IOR: settings.ior,
    thickness: settings.thickness,
    opticalSide: settings.opticalSide,
    periodConvention: "phase = 2*pi*screenPixel/periodPixels",
    maskGate: "structural frost alpha * inverse visible history",
  };
}

export function createHistoryStorageTexture(width, height, name) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("history dimensions must be positive integers");
  }
  const history = new StorageTexture(width, height);
  history.name = name;
  history.type = HalfFloatType;
  history.format = RGBAFormat;
  history.colorSpace = NoColorSpace;
  history.minFilter = LinearFilter;
  history.magFilter = LinearFilter;
  history.wrapS = ClampToEdgeWrapping;
  history.wrapT = ClampToEdgeWrapping;
  history.generateMipmaps = false;
  history.mipmapsAutoUpdate = false;
  return history;
}

function createHistoryComputeNodes({ width, height, historyA, historyB, settings, uniforms }) {
  const dispatch = computeDispatchSize(width, height, 8);
  const workgroupCount = [dispatch.x, dispatch.y, 1];
  const workgroupSize = [8, 8, 1];
  const widthNode = uint(width);
  const heightNode = uint(height);
  const inBounds = (coord) => coord.x.lessThan(widthNode).and(coord.y.lessThan(heightNode));

  const createClearNode = (target, name) => Fn(() => {
    const coord = globalId.xy.toVar();
    If(inBounds(coord), () => {
      textureStore(target, coord, vec4(0, 0, 0, 0)).toWriteOnly();
    });
  })().compute(workgroupCount, workgroupSize).setName(name);

  const createUpdateNode = (readTexture, writeTexture, name) => Fn(() => {
    const coord = globalId.xy.toVar();
    If(inBounds(coord), () => {
      const previous = textureLoad(readTexture, coord).toVar();
      const pixelUv = vec2(coord).add(0.5).div(uniforms.resolution).toVar();
      const aspectScale = vec2(uniforms.aspect, 1);
      const pa = pixelUv.sub(uniforms.pointerStart).mul(aspectScale).toVar();
      const ba = uniforms.pointerEnd.sub(uniforms.pointerStart).mul(aspectScale).toVar();
      const segmentT = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-8)), 0, 1).toVar();
      const distance = pa.sub(ba.mul(segmentT)).length();
      const radial = float(1).sub(smoothstep(0, uniforms.brushRadius, distance));
      const brush = radial.mul(uniforms.pressure).mul(uniforms.pointerActive).clamp(0, 1).toVar();

      const solve = (value, localBrush) => {
        const effectiveFill = uniforms.fillRate.mul(localBrush).toVar();
        const totalRate = uniforms.decayRate.add(effectiveFill).toVar();
        const equilibrium = effectiveFill.div(max(totalRate, 1e-8));
        const evolved = equilibrium.add(value.sub(equilibrium).mul(exp(totalRate.mul(uniforms.deltaTime).negate())));
        return select(totalRate.greaterThan(1e-8), evolved, value);
      };

      const nextR = solve(previous.r, brush).toVar();
      const nextA = solve(previous.a, brush.mul(0.65)).toVar();

      if (settings.diffusionEnabled) {
        const x = coord.x;
        const y = coord.y;
        const leftCoord = uvec2(max(x, uint(1)).sub(uint(1)), y);
        const rightCoord = uvec2(min(x.add(uint(1)), widthNode.sub(uint(1))), y);
        const downCoord = uvec2(x, max(y, uint(1)).sub(uint(1)));
        const upCoord = uvec2(x, min(y.add(uint(1)), heightNode.sub(uint(1))));
        const left = textureLoad(readTexture, leftCoord);
        const right = textureLoad(readTexture, rightCoord);
        const down = textureLoad(readTexture, downCoord);
        const up = textureLoad(readTexture, upCoord);
        const diffusionNumber = uniforms.diffusionCoefficient.mul(uniforms.deltaTime);
        nextR.addAssign(left.r.add(right.r).add(down.r).add(up.r).sub(previous.r.mul(4)).mul(diffusionNumber));
        nextA.addAssign(left.a.add(right.a).add(down.a).add(up.a).sub(previous.a.mul(4)).mul(diffusionNumber));
      }

      textureStore(
        writeTexture,
        coord,
        vec4(nextR.clamp(0, 1), nextR.clamp(0, 1), nextR.clamp(0, 1), nextA.clamp(0, 1)),
      ).toWriteOnly();
    });
  })().compute(workgroupCount, workgroupSize).setName(name);

  return {
    dispatch,
    workgroupCount,
    workgroupSize,
    clearA: createClearNode(historyA, "touch-history-frost:clear-a"),
    clearB: createClearNode(historyB, "touch-history-frost:clear-b"),
    updateAB: createUpdateNode(historyA, historyB, "touch-history-frost:update-a-to-b"),
    updateBA: createUpdateNode(historyB, historyA, "touch-history-frost:update-b-to-a"),
  };
}

function createBenchmarkLedgerComputeNode(target, uniforms, dispatchedTexels) {
  return Fn(() => {
    const coord = globalId.xy.toVar();
    If(coord.x.equal(uint(0)).and(coord.y.equal(uint(0))), () => {
      textureStore(target, coord, vec4(
        uniforms.pointerActive,
        uniforms.deltaTime,
        float(dispatchedTexels),
        1,
      )).toWriteOnly();
    });
  })().compute([1, 1, 1], [1, 1, 1]).setName("touch-history-frost:benchmark-ledger");
}

function exactDielectricFresnelNode(cosIncident, incidentIor, transmittedIor) {
  const eta = incidentIor.div(transmittedIor);
  const sinTransmittedSquared = eta.mul(eta).mul(float(1).sub(cosIncident.mul(cosIncident)));
  const transmissionPossible = sinTransmittedSquared.lessThanEqual(1);
  const cosTransmitted = sqrt(max(float(1).sub(sinTransmittedSquared), 0));
  const rs = incidentIor.mul(cosIncident).sub(transmittedIor.mul(cosTransmitted))
    .div(max(incidentIor.mul(cosIncident).add(transmittedIor.mul(cosTransmitted)), 1e-6));
  const rp = transmittedIor.mul(cosIncident).sub(incidentIor.mul(cosTransmitted))
    .div(max(transmittedIor.mul(cosIncident).add(incidentIor.mul(cosTransmitted)), 1e-6));
  return vec3(
    select(transmissionPossible, rs.mul(rs).add(rp.mul(rp)).mul(0.5), float(1)),
    select(transmissionPossible, float(1), float(0)),
    cosTransmitted,
  );
}

function pointerDepositField(screenUv, uniforms) {
  const aspectScale = vec2(uniforms.aspect, 1);
  const pa = screenUv.sub(uniforms.pointerStart).mul(aspectScale).toVar();
  const ba = uniforms.pointerEnd.sub(uniforms.pointerStart).mul(aspectScale).toVar();
  const segmentT = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-8)), 0, 1).toVar();
  const distance = pa.sub(ba.mul(segmentT)).length();
  const radial = float(1).sub(smoothstep(0, uniforms.brushRadius, distance));
  return radial.mul(uniforms.pressure).mul(uniforms.pointerActive).clamp(0, 1);
}

function buildOpticalInterfaceNode({ slope, displayResolution, settings }) {
  const interfaceNormal = normalize(vec3(slope.x.negate(), slope.y.negate(), 1)).toVar();
  const incident = vec3(0, 0, -1);
  const fromInside = settings.opticalSide === "inside";
  const incidentIor = float(fromInside ? settings.ior : 1);
  const transmittedIor = float(fromInside ? 1 : settings.ior);
  const cosIncident = max(dot(incident.negate(), interfaceNormal), 0).toVar();
  const fresnelTerms = exactDielectricFresnelNode(cosIncident, incidentIor, transmittedIor).toVar();
  const transmittedRay = refract(incident, interfaceNormal, incidentIor.div(transmittedIor)).toVar();
  const projectedSlope = transmittedRay.xy.div(max(abs(transmittedRay.z), 1e-6));
  const uvOffset = projectedSlope
    .mul(settings.thickness)
    .div(displayResolution)
    .mul(fresnelTerms.y)
    .toVar();
  return {
    interfaceNormal,
    fresnel: fresnelTerms.x,
    transmissionPossible: fresnelTerms.y,
    cosTransmitted: fresnelTerms.z,
    uvOffset,
  };
}

function buildFrostCompositeGraph({
  sceneColorNode,
  previousHistoryNode,
  currentHistoryNode,
  uniforms,
  settings,
  tierConfig,
  mechanismProfile,
}) {
  const screenUv = uv().toVar();
  const previousHistory = previousHistoryNode.sample(screenUv).toVar();
  const currentHistory = currentHistoryNode.sample(screenUv).toVar();
  const sharp = sceneColorNode.sample(screenUv).toVar();
  const deposit = pointerDepositField(screenUv, uniforms).toVar();

  let blurNode = null;
  let horizontalBlurTextureNode = null;
  let verticalBlur = sharp;
  let horizontalBlur = sharp;
  if (mechanismProfile.blur) {
    blurNode = gaussianBlur(sceneColorNode, vec2(1, 1), 4, {
      resolutionScale: tierConfig.blurResolutionScale,
      premultipliedAlpha: true,
    });
    horizontalBlurTextureNode = texture(blurNode._horizontalRT.texture);
    verticalBlur = blurNode;
    horizontalBlur = horizontalBlurTextureNode.sample(screenUv);
  }

  const screenPixels = screenUv.mul(uniforms.displayResolution).toVar();
  const mainPhase = screenPixels.mul((2 * Math.PI) / settings.mainScreenPeriod).toVar();
  const detailPhase = screenPixels.mul((2 * Math.PI) / settings.detailScreenPeriod).toVar();
  const frostNoise = sin(mainPhase.x.mul(0.73).add(sin(mainPhase.y.mul(0.59))))
    .mul(0.5).add(0.5).toVar();
  const frozenStructure = mix(
    frostNoise,
    sin(detailPhase.x.add(detailPhase.y.mul(0.87))).mul(0.5).add(0.5),
    mechanismProfile.crystalField ? 0.3 : 0,
  ).mul(0.72).add(0.28).clamp(0, 1).toVar();
  const highlightStructure = pow(frozenStructure, 5).toVar();
  const previousClear = float(1).sub(previousHistory.r).clamp(0, 1).toVar();
  const currentClear = float(1).sub(currentHistory.r).clamp(0, 1).toVar();
  const frostMaskBefore = frozenStructure.mul(previousClear).clamp(0, 1).toVar();
  const frostMaskAfter = frozenStructure.mul(currentClear).clamp(0, 1).toVar();
  const blurMix = mechanismProfile.blur
    ? frostMaskAfter.add(0.18).mul(currentClear).clamp(0, 1).toVar()
    : float(0).toVar();
  const frostedBase = mix(sharp.rgb, verticalBlur.rgb, blurMix)
    .mul(vec3(0.9, 0.92, 1.03))
    .add(vec3(0.04, 0.07, 0.12).mul(highlightStructure).mul(frostMaskAfter))
    .toVar();

  const mainSlope = vec2(
    sin(mainPhase.y.mul(0.91)),
    sin(mainPhase.x.mul(1.07)),
  ).mul(settings.mainNormalStrength).toVar();
  const detailSlope = vec2(
    sin(detailPhase.y.mul(0.73).add(1.7)),
    sin(detailPhase.x.mul(0.61).sub(0.9)),
  ).mul(mechanismProfile.refraction && tierConfig.twoScaleRefraction ? settings.detailNormalStrength : 0).toVar();
  const mainOptics = buildOpticalInterfaceNode({
    slope: mainSlope,
    displayResolution: uniforms.displayResolution,
    settings,
  });
  const combinedSlope = mainSlope.add(detailSlope.mul(frozenStructure)).toVar();
  const optics = buildOpticalInterfaceNode({
    slope: combinedSlope,
    displayResolution: uniforms.displayResolution,
    settings,
  });
  const mainRefractionOffset = mainOptics.uvOffset.mul(frostMaskAfter).toVar();
  const detailRefractionOffset = optics.uvOffset.sub(mainOptics.uvOffset).mul(frostMaskAfter).toVar();
  const refractOffset = mechanismProfile.refraction
    ? mainRefractionOffset.add(detailRefractionOffset).toVar()
    : vec2(0).toVar();
  const sourceInsetUv = abs(refractOffset)
    .add(vec2(settings.sourceInset).div(uniforms.displayResolution));
  const refractUv = clamp(screenUv.add(refractOffset), sourceInsetUv, vec2(1).sub(sourceInsetUv));
  const refracted = sceneColorNode.sample(refractUv).rgb;
  const reflectionTint = frostedBase.add(vec3(0.08, 0.12, 0.2).mul(highlightStructure));
  const interfaceColor = refracted.mul(float(1).sub(optics.fresnel))
    .add(reflectionTint.mul(optics.fresnel));
  const finalRgb = mechanismProfile.refraction
    ? mix(frostedBase, interfaceColor, frostMaskAfter)
    : frostedBase;

  const debugNodes = {
    "scene color": sharp,
    "vertical blur": verticalBlur,
    "horizontal blur": horizontalBlur,
    "frost noise": vec4(frostNoise, frostNoise, frostNoise, 1),
    "frozen structure": vec4(frozenStructure, frozenStructure, frozenStructure, 1),
    "highlight structure": vec4(highlightStructure, highlightStructure, highlightStructure, 1),
    "previous history R/A": vec4(previousHistory.rrr, previousHistory.a),
    "deposit R/A": vec4(deposit, deposit, deposit, deposit.mul(0.65)),
    "next history R/A": vec4(currentHistory.rrr, currentHistory.a),
    "frost mask before pointer": vec4(frostMaskBefore, frostMaskBefore, frostMaskBefore, 1),
    "frost mask after pointer": vec4(frostMaskAfter, frostMaskAfter, frostMaskAfter, 1),
    "sharp/blur mix": vec4(blurMix, blurMix, blurMix, 1),
    "main refraction offset": vec4(mainRefractionOffset, optics.fresnel, optics.transmissionPossible),
    "detail refraction offset": vec4(detailRefractionOffset, optics.cosTransmitted, optics.transmissionPossible),
    "final without refraction": vec4(frostedBase, 1),
    final: vec4(finalRgb, 1),
  };

  const availableDebugViews = new Set([
    "scene color",
    "previous history R/A",
    "deposit R/A",
    "next history R/A",
    "frost mask before pointer",
    "frost mask after pointer",
    "final without refraction",
    "final",
  ]);
  if (mechanismProfile.blur) {
    availableDebugViews.add("vertical blur");
    availableDebugViews.add("horizontal blur");
    availableDebugViews.add("sharp/blur mix");
  }
  if (mechanismProfile.crystalField) {
    availableDebugViews.add("frost noise");
    availableDebugViews.add("frozen structure");
    availableDebugViews.add("highlight structure");
  }
  if (mechanismProfile.refraction) {
    availableDebugViews.add("main refraction offset");
    if (tierConfig.twoScaleRefraction) availableDebugViews.add("detail refraction offset");
  }

  return {
    outputNode: debugNodes.final,
    debugNodes,
    availableDebugViews,
    blurNode,
    horizontalBlurTextureNode,
    graphDiagnostics: Object.freeze({
      previousHistoryNode,
      currentHistoryNode,
      blurNode,
      horizontalBlurTextureNode,
      reachableNodes: Object.freeze([...mechanismProfile.reachableNodes]),
      exactFresnel: mechanismProfile.refraction,
      twoScaleRefraction: mechanismProfile.refraction && tierConfig.twoScaleRefraction,
    }),
  };
}

// Host-safe scene-linear adapter. It creates effect-local blur targets and
// nodes, but never constructs a renderer, scene pass, RenderPipeline,
// RenderOutputNode, tone map, or output transform.
export function createTouchHistoryFrostCompositeNode({
  sceneColorNode,
  historyNode,
  previousHistoryNode = historyNode?.previousHistoryNode,
  width,
  height,
  settings = DEFAULT_FROST_SETTINGS,
  tier = "full",
} = {}) {
  if (!sceneColorNode?.sample || !historyNode?.sample || !previousHistoryNode?.sample) {
    throw new TypeError("sceneColorNode and distinct previous/current history nodes must be sampleable");
  }
  if (historyNode === previousHistoryNode) throw new Error("previous and current history nodes must be distinct");
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new RangeError("composite dimensions must be positive");
  }
  const tierConfig = FROST_QUALITY_TIERS[tier];
  if (!tierConfig) throw new RangeError(`unknown frost tier "${tier}"`);
  const mechanismProfile = requireFrostMechanism("refraction-and-fresnel");
  const resolutionNode = uniform(new Vector2(width, height));
  const adapterUniforms = {
    displayResolution: resolutionNode,
    aspect: uniform(width / height, "float"),
    pointerStart: uniform(new Vector2(0.5, 0.5)),
    pointerEnd: uniform(new Vector2(0.5, 0.5)),
    pointerActive: uniform(0, "float"),
    pressure: uniform(0, "float"),
    brushRadius: uniform(settings.brushRadius, "float"),
  };
  const graph = buildFrostCompositeGraph({
    sceneColorNode,
    previousHistoryNode,
    currentHistoryNode: historyNode,
    uniforms: adapterUniforms,
    settings,
    tierConfig,
    mechanismProfile,
  });
  return {
    outputNode: graph.outputNode,
    debugNodes: graph.debugNodes,
    graphDiagnostics: graph.graphDiagnostics,
    blurNode: graph.blurNode,
    horizontalBlurTextureNode: graph.horizontalBlurTextureNode,
    resolutionNode,
    ownership: Object.freeze({ renderer: false, renderPipeline: false, outputTransform: false }),
    setSize(nextWidth, nextHeight) {
      if (![nextWidth, nextHeight].every(Number.isFinite) || nextWidth <= 0 || nextHeight <= 0) {
        throw new RangeError("composite dimensions must be positive");
      }
      resolutionNode.value.set(nextWidth, nextHeight);
      adapterUniforms.aspect.value = nextWidth / nextHeight;
    },
    dispose() {
      graph.blurNode?.dispose();
    },
  };
}

export class WebGPUTouchHistoryFrostEffect {
  constructor({
    width = 1920,
    height = 1080,
    settings = DEFAULT_FROST_SETTINGS,
    renderer,
    renderPipeline,
    scene,
    camera,
    tier = "full",
    mechanism = "refraction-and-fresnel",
  } = {}) {
    this.tier = this.#requireTier(tier);
    this.mechanismProfile = requireFrostMechanism(mechanism);
    const extents = computeFrostExtents({
      drawingWidth: width,
      drawingHeight: height,
      historyScale: this.tier.historyScale,
    });
    this.displayWidth = extents.displayWidth;
    this.displayHeight = extents.displayHeight;
    this.width = extents.historyWidth;
    this.height = extents.historyHeight;
    this.settings = {
      ...settings,
      blurResolutionScale: this.tier.blurResolutionScale,
      diffusionEnabled: this.mechanismProfile.diffusion,
    };
    if (!Number.isFinite(this.settings.ior) || this.settings.ior <= 1) {
      throw new RangeError("frost IOR must be finite and greater than one");
    }
    if (!Number.isFinite(this.settings.thickness) || this.settings.thickness < 0) {
      throw new RangeError("frost thickness must be finite and nonnegative");
    }
    if (![this.settings.mainScreenPeriod, this.settings.detailScreenPeriod].every((value) => Number.isFinite(value) && value > 0)) {
      throw new RangeError("frost screen periods must be finite positive pixel periods");
    }
    if (!Number.isFinite(this.settings.sourceInset) || this.settings.sourceInset < 0) {
      throw new RangeError("frost source inset must be finite nonnegative pixels");
    }
    if (this.settings.opticalSide !== "outside" && this.settings.opticalSide !== "inside") {
      throw new RangeError(`unknown optical side "${this.settings.opticalSide}"`);
    }
    this.renderer = renderer;
    this.renderPipeline = renderPipeline;
    this.ownsRenderPipeline = !renderPipeline;
    this.scene = scene;
    this.camera = camera;
    this.historyA = createHistoryStorageTexture(this.width, this.height, "touch-history-frost:history-a");
    this.historyB = createHistoryStorageTexture(this.width, this.height, "touch-history-frost:history-b");
    this.historyRead = this.historyA;
    this.historyWrite = this.historyB;
    this.readSlot = "A";
    this.historyReadTextureNode = texture(this.historyRead);
    this.historyWriteTextureNode = texture(this.historyWrite);
    this.historyReadTextureNode.name = "touch-history-frost:current-history-node";
    this.historyWriteTextureNode.name = "touch-history-frost:previous-history-node";
    this.historyReadTextureNode.previousHistoryNode = this.historyWriteTextureNode;
    this.historyTextureNode = this.historyReadTextureNode;
    assertDistinctHistoryBindings({
      readTexture: this.historyRead,
      writeTexture: this.historyWrite,
      readNode: this.historyReadTextureNode,
      writeNode: this.historyWriteTextureNode,
    });
    this.uniforms = {
      resolution: uniform(new Vector2(this.width, this.height)),
      displayResolution: uniform(new Vector2(this.displayWidth, this.displayHeight)),
      aspect: uniform(this.width / this.height, "float"),
      deltaTime: uniform(0, "float"),
      pointerStart: uniform(new Vector2(0.5, 0.5)),
      pointerEnd: uniform(new Vector2(0.5, 0.5)),
      pressure: uniform(0, "float"),
      pointerActive: uniform(0, "float"),
      brushRadius: uniform(this.settings.brushRadius, "float"),
      decayRate: uniform(-Math.log(this.settings.decaySurvivalPerSecond), "float"),
      fillRate: uniform(-Math.log(1 - this.settings.depositPerSecond), "float"),
      diffusionCoefficient: uniform(this.settings.diffusionCoefficient, "float"),
    };
    this.computeNodes = createHistoryComputeNodes({
      width: this.width,
      height: this.height,
      historyA: this.historyA,
      historyB: this.historyB,
      settings: this.settings,
      uniforms: this.uniforms,
    });
    this.#configureMechanismResources();
    this.debugView = "final";
    this.pause = false;
    this.singleStep = false;
    this.initialized = false;
    this.frame = 0;
    this.metrics = {
      eventCount: 0,
      dirtyTiles: 0,
      dispatchedTexels: 0,
      historyBytesRead: 0,
      historyBytesWritten: 0,
      fullFieldDispatch: true,
      sameFrameComposite: true,
    };
  }

  static async createRenderer(options = {}) {
    const renderer = new WebGPURenderer(options);
    await renderer.init();
    if (renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("WebGPU is required for the canonical dynamic-surface path");
    }
    return renderer;
  }

  async initialize() {
    if (!this.renderer) throw new Error("a WebGPURenderer owner is required");
    await this.renderer.init();
    if (this.renderer.backend?.isWebGPUBackend !== true) {
      throw new Error("WebGPU is required for the canonical dynamic-surface path");
    }
    this.renderer.compute([
      this.computeNodes.clearA,
      this.computeNodes.clearB,
      ...(this.benchmarkLedgerNode ? [this.benchmarkLedgerNode] : []),
    ]);
    if (this.scene && this.camera) this.attachPipeline(this.scene, this.camera);
    this.initialized = true;
    return this;
  }

  attachPipeline(scene = this.scene, camera = this.camera) {
    if (!scene || !camera) throw new Error("scene and camera are required for frost presentation");
    this.scene = scene;
    this.camera = camera;
    this.scenePass ??= pass(scene, camera);
    this.sceneColorNode = this.scenePass.getTextureNode("output");
    this.blurNode?.dispose?.();
    const graph = buildFrostCompositeGraph({
      sceneColorNode: this.sceneColorNode,
      previousHistoryNode: this.historyWriteTextureNode,
      currentHistoryNode: this.historyReadTextureNode,
      uniforms: this.uniforms,
      settings: this.settings,
      tierConfig: this.tier,
      mechanismProfile: this.mechanismProfile,
    });
    this.debugNodes = graph.debugNodes;
    this.availableDebugViews = graph.availableDebugViews;
    this.blurNode = graph.blurNode;
    this.horizontalBlurTextureNode = graph.horizontalBlurTextureNode;
    this.graphDiagnostics = graph.graphDiagnostics;
    const requestedDebugView = this.availableDebugViews.has(this.debugView)
      ? this.debugView
      : this.mechanismProfile.startupDebugView;
    this.debugView = this.availableDebugViews.has(requestedDebugView) ? requestedDebugView : "final";
    this.outputNode = renderOutput(this.debugNodes.final);
    this.renderPipeline ??= new RenderPipeline(this.renderer);
    this.renderPipeline.outputColorTransform = false;
    this.renderPipeline.outputNode = renderOutput(this.debugNodes[this.debugView]);
    this.renderPipeline.needsUpdate = true;
    return this.renderPipeline;
  }

  createFrameGraph() {
    const graph = [
      "input events for this frame",
      "Fn().compute([ceil(width/8), ceil(height/8), 1], [8,8,1]) history update writes StorageTexture with textureStore",
      "swap history read/write",
      "scene pass via pass(scene, camera)",
    ];
    if (this.mechanismProfile.diffusion) graph.splice(2, 0, "stable five-point Laplacian diffusion reads previous history");
    if (this.mechanismProfile.blur) {
      graph.push("GaussianBlurNode horizontal pass at tier resolutionScale");
      graph.push("GaussianBlurNode vertical pass at the same tier resolutionScale");
    }
    if (this.mechanismProfile.crystalField) graph.push("screen-period crystalline field graph");
    graph.push("full-resolution frost/thaw composite");
    if (this.mechanismProfile.refraction) {
      graph.push(this.tier.twoScaleRefraction
        ? "two-scale Snell refraction plus side-aware exact dielectric Fresnel"
        : "single-scale Snell refraction plus side-aware exact dielectric Fresnel");
    }
    graph.push("one RenderPipeline.render() owner");
    return graph;
  }

  createResourcePlan() {
    const graph = resolveFrostGraphContract(
      this.mechanismProfile.id,
      this.tier.id,
      this.displayWidth,
      this.displayHeight,
    );
    return {
      graph,
      historyRead: createHistoryStorageDescriptor(this.width, this.height),
      historyWrite: createHistoryStorageDescriptor(this.width, this.height),
      historyBindings: {
        readTexture: this.historyRead.name,
        writeTexture: this.historyWrite.name,
        distinctTextures: this.historyRead !== this.historyWrite,
        distinctNodes: this.historyReadTextureNode !== this.historyWriteTextureNode,
      },
      dispatch: computeDispatchSize(this.width, this.height),
      storageBytes: estimateHistoryStorageBytes(this.width, this.height),
      benchmarkLedger: this.benchmarkLedgerTexture ? {
        ...createHistoryStorageDescriptor(1, 1),
        name: this.benchmarkLedgerTexture.name,
        bytes: 8,
      } : null,
      residentStorageBytes: estimateHistoryStorageBytes(this.width, this.height).total
        + (this.benchmarkLedgerTexture ? 8 : 0),
      blur: this.mechanismProfile.blur ? {
        passCount: 2,
        vertical: { resolutionScale: this.tier.blurResolutionScale },
        horizontal: { resolutionScale: this.tier.blurResolutionScale },
      } : null,
      refraction: this.mechanismProfile.refraction ? {
        ...createTwoScaleRefractionContract(this.settings),
        scaleCount: this.tier.twoScaleRefraction ? 2 : 1,
      } : null,
      debugViews: [...(this.availableDebugViews ?? ["final"])],
      diagnostics: {
        previousHistory: {
          node: this.historyWriteTextureNode.name,
          resource: this.historyWrite.name,
          slot: this.readSlot === "A" ? "B" : "A",
        },
        currentHistory: {
          node: this.historyReadTextureNode.name,
          resource: this.historyRead.name,
          slot: this.readSlot,
        },
        deposit: { source: "pointerDepositField(screenUv, uniforms)" },
        blur: this.blurNode ? {
          horizontalResource: this.blurNode._horizontalRT.texture.name,
          verticalResource: this.blurNode._verticalRT.texture.name,
        } : null,
        opticalInterface: this.mechanismProfile.refraction ? {
          source: "buildOpticalInterfaceNode",
          exactDielectricFresnel: true,
          side: this.settings.opticalSide,
        } : null,
      },
    };
  }

  dispatchHistoryCompute(computeNode) {
    if (!this.initialized) throw new Error("initialize() must complete before compute dispatch");
    return this.renderer.compute(computeNode);
  }

  setSize(width, height, { clearHistory = true } = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError("drawing-buffer dimensions must be positive integers");
    }
    this.historyA.dispose();
    this.historyB.dispose();
    const extents = computeFrostExtents({
      drawingWidth: width,
      drawingHeight: height,
      historyScale: this.tier.historyScale,
    });
    this.displayWidth = extents.displayWidth;
    this.displayHeight = extents.displayHeight;
    this.width = extents.historyWidth;
    this.height = extents.historyHeight;
    this.historyA = createHistoryStorageTexture(this.width, this.height, "touch-history-frost:history-a");
    this.historyB = createHistoryStorageTexture(this.width, this.height, "touch-history-frost:history-b");
    this.historyRead = this.historyA;
    this.historyWrite = this.historyB;
    this.readSlot = "A";
    this.uniforms.resolution.value.set(this.width, this.height);
    this.uniforms.displayResolution.value.set(this.displayWidth, this.displayHeight);
    this.uniforms.aspect.value = this.width / this.height;
    this.computeNodes = createHistoryComputeNodes({
      width: this.width,
      height: this.height,
      historyA: this.historyA,
      historyB: this.historyB,
      settings: this.settings,
      uniforms: this.uniforms,
    });
    this.#configureMechanismResources();
    this.historyReadTextureNode.value = this.historyRead;
    this.historyWriteTextureNode.value = this.historyWrite;
    this.historyTextureNode = this.historyReadTextureNode;
    assertDistinctHistoryBindings({
      readTexture: this.historyRead,
      writeTexture: this.historyWrite,
      readNode: this.historyReadTextureNode,
      writeNode: this.historyWriteTextureNode,
    });
    if (clearHistory && this.initialized) {
      this.renderer.compute([
        this.computeNodes.clearA,
        this.computeNodes.clearB,
        ...(this.benchmarkLedgerNode ? [this.benchmarkLedgerNode] : []),
      ]);
    }
    this.historyClearedOnResize = clearHistory;
    return this;
  }

  setTier(tierId) {
    this.tier = this.#requireTier(tierId);
    this.settings.blurResolutionScale = this.tier.blurResolutionScale;
    this.setSize(this.displayWidth, this.displayHeight, { clearHistory: true });
    if (this.scene && this.camera) this.attachPipeline(this.scene, this.camera);
    return this.tier;
  }

  setMechanism(mechanismId) {
    this.mechanismProfile = requireFrostMechanism(mechanismId);
    this.settings.diffusionEnabled = this.mechanismProfile.diffusion;
    this.computeNodes = createHistoryComputeNodes({
      width: this.width,
      height: this.height,
      historyA: this.historyA,
      historyB: this.historyB,
      settings: this.settings,
      uniforms: this.uniforms,
    });
    this.#configureMechanismResources();
    this.debugView = this.mechanismProfile.startupDebugView;
    if (this.scene && this.camera) this.attachPipeline(this.scene, this.camera);
    return this.mechanismProfile;
  }

  setDebugView(view) {
    if (!this.debugNodes?.[view] || !this.availableDebugViews?.has(view)) {
      throw new RangeError(`unknown frost debug view "${view}"`);
    }
    this.debugView = view;
    this.renderPipeline.outputNode = renderOutput(this.debugNodes[view]);
    this.renderPipeline.needsUpdate = true;
  }

  advanceFrame({
    deltaSeconds,
    segmentStart = { x: 0.5, y: 0.5 },
    segmentEnd = segmentStart,
    pressure = 0,
    active = false,
    render = true,
  } = {}) {
    if (!this.initialized) throw new Error("initialize() must complete before advanceFrame()");
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("deltaSeconds must be finite and nonnegative");
    }
    validateDiffusionStep(this.settings.diffusionCoefficient, deltaSeconds);
    this.uniforms.deltaTime.value = deltaSeconds;
    this.uniforms.pointerStart.value.set(segmentStart.x, segmentStart.y);
    this.uniforms.pointerEnd.value.set(segmentEnd.x, segmentEnd.y);
    this.uniforms.pressure.value = Math.min(1, Math.max(0, pressure));
    this.uniforms.pointerActive.value = active ? 1 : 0;

    const policyAllowsStep = this.mechanismProfile.updatePolicy !== "idle-suspend" || active;
    const shouldStep = ((!this.pause && policyAllowsStep) || this.singleStep);
    if (shouldStep && deltaSeconds > 0) {
      const updateNode = this.readSlot === "A" ? this.computeNodes.updateAB : this.computeNodes.updateBA;
      this.dispatchHistoryCompute(this.benchmarkLedgerNode ? [updateNode, this.benchmarkLedgerNode] : updateNode);
      [this.historyRead, this.historyWrite] = [this.historyWrite, this.historyRead];
      this.readSlot = this.readSlot === "A" ? "B" : "A";
      this.historyReadTextureNode.value = this.historyRead;
      this.historyWriteTextureNode.value = this.historyWrite;
      this.historyTextureNode = this.historyReadTextureNode;
      assertDistinctHistoryBindings({
        readTexture: this.historyRead,
        writeTexture: this.historyWrite,
        readNode: this.historyReadTextureNode,
        writeNode: this.historyWriteTextureNode,
      });
      this.frame += 1;
      this.metrics.eventCount = active ? 1 : 0;
      this.metrics.dispatchedTexels = this.width * this.height;
      this.metrics.historyBytesRead = this.width * this.height * 8;
      this.metrics.historyBytesWritten = this.width * this.height * 8;
      this.singleStep = false;
    } else {
      this.metrics.eventCount = active ? 1 : 0;
      this.metrics.dispatchedTexels = 0;
      this.metrics.historyBytesRead = 0;
      this.metrics.historyBytesWritten = 0;
    }

    if (render) this.renderPipeline?.render();
    return this.getMetrics();
  }

  getMetrics() {
    return {
      ...this.metrics,
      frame: this.frame,
      tier: this.tier.id,
      mechanism: this.mechanismProfile.id,
      updatePolicy: this.mechanismProfile.updatePolicy,
      displaySize: [this.displayWidth, this.displayHeight],
      historySize: [this.width, this.height],
      workgroupSize: [...this.computeNodes.workgroupSize],
      dispatch: { ...this.computeNodes.dispatch },
      storageBytes: estimateHistoryStorageBytes(this.width, this.height).total
        + (this.benchmarkLedgerTexture ? 8 : 0),
      reachableNodes: [...this.mechanismProfile.reachableNodes],
      availableDebugViews: [...(this.availableDebugViews ?? [])],
    };
  }

  dispose() {
    this.historyA.dispose();
    this.historyB.dispose();
    this.benchmarkLedgerTexture?.dispose();
    this.historyA.disposed = true;
    this.historyB.disposed = true;
    this.blurNode?.dispose?.();
    this.scenePass?.dispose?.();
    if (this.ownsRenderPipeline) this.renderPipeline?.dispose?.();
    this.disposed = true;
  }

  #requireTier(tierId) {
    const tier = FROST_QUALITY_TIERS[tierId];
    if (!tier) throw new RangeError(`unknown frost tier "${tierId}"`);
    return tier;
  }

  #configureMechanismResources() {
    this.benchmarkLedgerTexture?.dispose();
    this.benchmarkLedgerTexture = null;
    this.benchmarkLedgerNode = null;
    if (this.mechanismProfile.benchmarkLedger) {
      this.benchmarkLedgerTexture = createHistoryStorageTexture(1, 1, "touch-history-frost:benchmark-ledger");
      this.benchmarkLedgerNode = createBenchmarkLedgerComputeNode(
        this.benchmarkLedgerTexture,
        this.uniforms,
        this.width * this.height,
      );
    }
  }
}

export function createWebGPUTouchHistoryFrostEffect(options = {}) {
  return new WebGPUTouchHistoryFrostEffect(options);
}

export async function createTouchHistoryFrostComputeStage({
  renderer,
  width,
  height,
  tier = "full",
  settings = DEFAULT_FROST_SETTINGS,
  mechanism = "diffusion",
} = {}) {
  const effect = new WebGPUTouchHistoryFrostEffect({
    renderer,
    width,
    height,
    tier,
    settings,
    mechanism,
  });
  await effect.initialize();
  return {
    ownership: Object.freeze({ renderer: false, renderPipeline: false, output: false }),
    effect,
    get historyNode() {
      return effect.historyReadTextureNode;
    },
    get previousHistoryNode() {
      return effect.historyWriteTextureNode;
    },
    update(frame) {
      return effect.advanceFrame(frame);
    },
    resize(nextWidth, nextHeight) {
      effect.setSize(nextWidth, nextHeight, { clearHistory: true });
      return effect.createResourcePlan();
    },
    describeResources() {
      return effect.createResourcePlan();
    },
    dispose() {
      effect.dispose();
    },
  };
}

export const CANONICAL_IMPORTS = Object.freeze({
  WebGPURenderer: WebGPURenderer.name,
  RenderPipeline: RenderPipeline.name,
  StorageTexture: StorageTexture.name,
  Fn: "Fn(",
  textureStore: "textureStore",
  storageTexture: "storageTexture",
  outputNode: "outputNode",
});
