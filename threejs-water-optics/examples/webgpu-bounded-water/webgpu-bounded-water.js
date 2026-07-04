import {
  Box3,
  ClampToEdgeWrapping,
  DoubleSide,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshPhysicalNodeMaterial,
  NearestFilter,
  NoColorSpace,
  NoToneMapping,
  PlaneGeometry,
  RGBAFormat,
  RenderPipeline,
  RendererUtils,
  Sphere,
  StorageBufferAttribute,
  StorageTexture,
  Vector2,
  Vector3,
} from "three/webgpu";
import {
  Fn,
  If,
  abs,
  atomicAdd,
  atomicStore,
  cameraFar,
  cameraNear,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  faceDirection,
  float,
  globalId,
  max,
  min,
  mix,
  mrt,
  normalize,
  output,
  pass,
  positionLocal,
  positionWorld,
  pow,
  perspectiveDepthToViewZ,
  reflect,
  refract,
  renderOutput,
  screenUV,
  select,
  sin,
  smoothstep,
  storage,
  texture,
  textureLoad,
  textureStore,
  uint,
  uniform,
  uvec2,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
  viewportLinearDepth,
  viewportSharedTexture,
} from "three/tsl";
import {
  AUTHORED_WAVES,
  DEFAULT_WATER_PARAMETERS,
  MICRO_NORMAL_BANDS,
  WATER_DEBUG_MODES,
  WATER_QUALITY_TIERS,
  validateWaterConfig,
  waterStorageBytes,
} from "./constants.js";

const TAU = Math.PI * 2;
const ZERO_DROP = Object.freeze({ x: 1000, z: 1000, radius: 0.001, strength: 0 });
const ZERO_IMPULSE = Object.freeze({
  oldCenter: new Vector3(1000, 1000, 1000),
  newCenter: new Vector3(1000, 1000, 1000),
  radius: 0.001,
  strength: 0,
});

function cloneVector2(value) {
  return new Vector2(value.x, value.y);
}

function cloneVector3(value) {
  return new Vector3(value.x, value.y, value.z);
}

function createWaterStorageTexture(width, height, name) {
  const textureValue = new StorageTexture(width, height);
  textureValue.name = name;
  textureValue.format = RGBAFormat;
  textureValue.type = HalfFloatType;
  textureValue.colorSpace = NoColorSpace;
  textureValue.minFilter = NearestFilter;
  textureValue.magFilter = NearestFilter;
  textureValue.wrapS = ClampToEdgeWrapping;
  textureValue.wrapT = ClampToEdgeWrapping;
  textureValue.generateMipmaps = false;
  textureValue.mipmapsAutoUpdate = false;
  return textureValue;
}

function createSampledDebugTexture(width, height, name) {
  const textureValue = createWaterStorageTexture(width, height, name);
  textureValue.minFilter = LinearFilter;
  textureValue.magFilter = LinearFilter;
  return textureValue;
}

function makeUniforms(parameters, tier) {
  return {
    resolution: uniform(tier.resolution, "float"),
    fixedTimeStep: uniform(tier.fixedTimeStep, "float"),
    worldSize: uniform(new Vector2(parameters.worldSize.x, parameters.worldSize.y)),
    damping: uniform(parameters.damping, "float"),
    waveSpeed: uniform(parameters.waveSpeed, "float"),
    boundaryFadeCells: uniform(parameters.boundaryFadeCells, "float"),
    dropCenter: uniform(new Vector2(ZERO_DROP.x, ZERO_DROP.z)),
    dropRadius: uniform(ZERO_DROP.radius, "float"),
    dropStrength: uniform(ZERO_DROP.strength, "float"),
    oldObjectCenter: uniform(new Vector3(ZERO_IMPULSE.oldCenter.x, ZERO_IMPULSE.oldCenter.y, ZERO_IMPULSE.oldCenter.z)),
    newObjectCenter: uniform(new Vector3(ZERO_IMPULSE.newCenter.x, ZERO_IMPULSE.newCenter.y, ZERO_IMPULSE.newCenter.z)),
    objectRadius: uniform(ZERO_IMPULSE.radius, "float"),
    objectStrength: uniform(ZERO_IMPULSE.strength, "float"),
    causticEpsilon: uniform(parameters.causticEpsilon, "float"),
    causticMaxIntensity: uniform(parameters.causticMaxIntensity, "float"),
    causticScale: uniform(parameters.causticScale, "float"),
  };
}

function estimateWaterVerticalAmplitude(parameters, analyticBandCount = AUTHORED_WAVES.length) {
  const analyticAmplitude = AUTHORED_WAVES.slice(0, analyticBandCount)
    .reduce((sum, wave) => sum + Math.abs(wave.amplitude), 0);
  return analyticAmplitude + Math.abs(parameters.dropStrength) + Math.abs(parameters.objectDisplacementScale ?? 0);
}

function setUniformVector2(node, value) {
  node.value.set(value.x, value.y ?? value.z);
}

function setUniformVector3(node, value) {
  node.value.set(value.x, value.y, value.z);
}

function safeRendererCompute(renderer, computeNode) {
  const state = RendererUtils.saveRendererState(renderer);

  try {
    return renderer.compute(computeNode);
  } finally {
    RendererUtils.restoreRendererState(renderer, state);
  }
}

async function safeRendererComputeAsync(renderer, computeNode) {
  const state = RendererUtils.saveRendererState(renderer);

  try {
    return await renderer.computeAsync(computeNode);
  } finally {
    RendererUtils.restoreRendererState(renderer, state);
  }
}

function buildAnalyticWaveDisplacementTSL(baseXZ, timeNode, bandCount = AUTHORED_WAVES.length) {
  const displaced = vec3(baseXZ.x, float(0), baseXZ.y).toVar();

  for (const wave of AUTHORED_WAVES.slice(0, bandCount)) {
    const direction = vec2(wave.direction.x, wave.direction.y);
    const k = float(TAU / wave.wavelength);
    const omega = float(Math.sqrt(9.81 * (TAU / wave.wavelength)));
    const phase = k.mul(dot(direction, baseXZ)).sub(omega.mul(timeNode));
    displaced.xz.addAssign(direction.mul(wave.steepness * wave.amplitude).mul(cos(phase)));
    displaced.y.addAssign(float(wave.amplitude).mul(sin(phase)));
  }

  return displaced;
}

function buildAnalyticNormalAndCrestTSL(baseXZ, worldXZ, timeNode, bandCount, microBandCount) {
  const gradient = vec2(0, 0).toVar();
  const verticalCorrection = float(0).toVar();

  for (const wave of AUTHORED_WAVES.slice(0, bandCount)) {
    const direction = vec2(wave.direction.x, wave.direction.y);
    const k = float(TAU / wave.wavelength);
    const omega = float(Math.sqrt(9.81 * (TAU / wave.wavelength)));
    const phase = k.mul(dot(direction, baseXZ)).sub(omega.mul(timeNode));
    const kA = k.mul(wave.amplitude);
    gradient.addAssign(direction.mul(kA).mul(sin(phase)));
    verticalCorrection.addAssign(float(wave.steepness).mul(kA).mul(cos(phase)));
  }

  const normalValue = normalize(vec3(gradient.x.negate(), float(1).sub(verticalCorrection), gradient.y.negate())).toVar();
  const footprint = max(abs(worldXZ.x), abs(worldXZ.y)).mul(0.0025).add(0.0005);
  const microGradient = vec2(0, 0).toVar();

  for (const band of MICRO_NORMAL_BANDS.slice(0, microBandCount)) {
    const direction = vec2(band.direction.x, band.direction.y);
    const k = float(TAU / band.wavelength);
    const omega = float(Math.sqrt(9.8 * (TAU / band.wavelength)) * band.speedScale);
    const phase = k.mul(dot(direction, worldXZ)).add(omega.mul(timeNode));
    const aa = float(1).sub(smoothstep(0, 2.0, footprint.mul(k)));
    microGradient.addAssign(direction.mul(band.relativeAmplitude * 0.08).mul(k).mul(cos(phase)).mul(aa));
  }

  normalValue.assign(normalize(vec3(
    normalValue.x.sub(microGradient.x.mul(0.8)),
    normalValue.y,
    normalValue.z.sub(microGradient.y.mul(0.8)),
  )));

  const slope = clamp(float(1).sub(normalValue.y), 0, 1);
  const crest = pow(clamp(slope.mul(5.0), 0, 1), 2.0);
  return vec4(normalValue, crest);
}

function buildSkyColorTSL(direction, sunDirection) {
  const y = direction.y;
  const below = vec3(0.35, 0.55, 0.78);
  const horizon = vec3(0.52, 0.72, 0.92);
  const lower = vec3(0.30, 0.58, 0.88);
  const middle = vec3(0.12, 0.32, 0.70);
  const zenith = vec3(0.02, 0.08, 0.36);
  const t0 = smoothstep(-0.1, 0.0, y);
  const t1 = smoothstep(0.0, 0.28, y);
  const t2 = smoothstep(0.28, 0.85, y);
  const gradient = mix(mix(below, horizon, t0), mix(lower, mix(middle, zenith, t2), t1), t1);
  const sunDot = clamp(dot(direction, sunDirection), 0, 1);
  return gradient
    .add(vec3(1.0, 0.95, 0.75).mul(pow(sunDot, 5000.0)).mul(50.0))
    .add(vec3(1.0, 0.72, 0.32).mul(pow(sunDot, 20.0)).mul(2.8))
    .add(vec3(1.0, 0.8, 0.5).mul(pow(sunDot, 4.0)).mul(0.5));
}

function makeComputeNodes(owner) {
  // Build order 1-3: ping-ponged StorageTexture state, fixed-step kernels,
  // then normal reconstruction plus epsilon/clamped differential-area caustics.
  const {
    resolution,
    stateA,
    stateB,
    normalCaustic,
    diagnosticBufferNode,
    uniforms,
    tier,
  } = owner;

  const cellCount = resolution * resolution;
  const workgroupSize = tier.workgroupSize;

  const texelCoord = Fn(() => {
    const x = globalId.x.mod(uint(resolution)).toVar();
    const y = globalId.x.div(uint(resolution)).toVar();
    return uvec2(x, y);
  });

  const uvFromCoord = Fn(([coord]) => {
    return vec2(float(coord.x).add(0.5).div(uniforms.resolution), float(coord.y).add(0.5).div(uniforms.resolution));
  });

  const worldFromUv = Fn(([coordUv]) => {
    return vec2(coordUv.x.sub(0.5).mul(uniforms.worldSize.x), coordUv.y.sub(0.5).mul(uniforms.worldSize.y));
  });

  const causticCompressionFromSlope = (slope, xSlope, zSlope, coordUv) => {
    const lightIncident = normalize(vec3(-0.42, -1.0, -0.28));
    const etaAirToWater = float(1.0 / 1.333);
    const cells = max(uniforms.resolution.sub(1.0), 1.0);
    const dxMeters = uniforms.worldSize.x.div(cells);
    const dzMeters = uniforms.worldSize.y.div(cells);
    const receiverDepth = max(min(uniforms.worldSize.x, uniforms.worldSize.y).mul(0.35), 0.25);
    const world = worldFromUv(coordUv);

    const centerNormal = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
    const xNormal = normalize(vec3(xSlope.x.negate(), 1, xSlope.y.negate()));
    const zNormal = normalize(vec3(zSlope.x.negate(), 1, zSlope.y.negate()));
    const centerRay = refract(lightIncident, centerNormal, etaAirToWater).toVar();
    const xRay = refract(lightIncident, xNormal, etaAirToWater);
    const zRay = refract(lightIncident, zNormal, etaAirToWater);

    const centerScale = receiverDepth.div(max(abs(centerRay.y), uniforms.causticEpsilon));
    const xScale = receiverDepth.div(max(abs(xRay.y), uniforms.causticEpsilon));
    const zScale = receiverDepth.div(max(abs(zRay.y), uniforms.causticEpsilon));
    const centerHit = world.add(centerRay.xz.mul(centerScale));
    const xHit = world.add(vec2(dxMeters, 0)).add(xRay.xz.mul(xScale));
    const zHit = world.add(vec2(0, dzMeters)).add(zRay.xz.mul(zScale));
    const bundleX = xHit.sub(centerHit);
    const bundleZ = zHit.sub(centerHit);
    const projectedArea = abs(bundleX.x.mul(bundleZ.y).sub(bundleX.y.mul(bundleZ.x)));
    const sourceArea = max(dxMeters.mul(dzMeters), uniforms.causticEpsilon);
    const rawArea = projectedArea.div(sourceArea);
    const orientationValid = centerRay.y.lessThan(uniforms.causticEpsilon.negate());

    return vec2(rawArea, select(orientationValid, float(1), float(0)));
  };

  const boundaryMask = Fn(([coord]) => {
    const x = min(float(coord.x), uniforms.resolution.sub(1).sub(float(coord.x)));
    const y = min(float(coord.y), uniforms.resolution.sub(1).sub(float(coord.y)));
    return smoothstep(0.0, uniforms.boundaryFadeCells, min(x, y));
  });

  const readState = Fn(([stateTexture, coord]) => {
    return textureLoad(stateTexture, coord);
  });

  const resetDiagnostics = Fn(() => {
    If(globalId.x.equal(uint(0)), () => {
      atomicStore(diagnosticBufferNode.element(uint(0)), uint(0));
      atomicStore(diagnosticBufferNode.element(uint(1)), uint(0));
      atomicStore(diagnosticBufferNode.element(uint(2)), uint(0));
      atomicStore(diagnosticBufferNode.element(uint(3)), uint(0));
    });
  })().compute(1);

  const dropAndImpulseAB = Fn(() => {
    const coord = texelCoord().toVar();
    const coordUv = uvFromCoord(coord).toVar();
    const world = worldFromUv(coordUv).toVar();
    const info = readState(stateA, coord).toVar();
    const dropDistance = world.sub(uniforms.dropCenter).length();
    const drop = max(float(0), float(1).sub(dropDistance.div(max(uniforms.dropRadius, 0.0001)))).toVar();
    drop.assign(float(0.5).sub(cos(drop.mul(Math.PI)).mul(0.5)).mul(uniforms.dropStrength));

    const oldToCenter = vec3(world.x, 0, world.y).sub(uniforms.oldObjectCenter);
    const newToCenter = vec3(world.x, 0, world.y).sub(uniforms.newObjectCenter);
    const oldT = oldToCenter.length().div(max(uniforms.objectRadius, 0.0001));
    const newT = newToCenter.length().div(max(uniforms.objectRadius, 0.0001));
    const oldVolume = exp(oldT.mul(1.5).pow(6.0).negate()).mul(0.1).mul(uniforms.objectStrength);
    const newVolume = exp(newT.mul(1.5).pow(6.0).negate()).mul(0.1).mul(uniforms.objectStrength);
    const impulse = drop.add(oldVolume).sub(newVolume);
    const maskedHeight = info.r.add(impulse).mul(boundaryMask(coord));
    textureStore(stateB, coord, vec4(maskedHeight, info.g, max(info.b, abs(impulse)), boundaryMask(coord)));
  })().compute(cellCount, [workgroupSize]);

  const dropAndImpulseBA = Fn(() => {
    const coord = texelCoord().toVar();
    const coordUv = uvFromCoord(coord).toVar();
    const world = worldFromUv(coordUv).toVar();
    const info = readState(stateB, coord).toVar();
    const dropDistance = world.sub(uniforms.dropCenter).length();
    const drop = max(float(0), float(1).sub(dropDistance.div(max(uniforms.dropRadius, 0.0001)))).toVar();
    drop.assign(float(0.5).sub(cos(drop.mul(Math.PI)).mul(0.5)).mul(uniforms.dropStrength));

    const oldToCenter = vec3(world.x, 0, world.y).sub(uniforms.oldObjectCenter);
    const newToCenter = vec3(world.x, 0, world.y).sub(uniforms.newObjectCenter);
    const oldT = oldToCenter.length().div(max(uniforms.objectRadius, 0.0001));
    const newT = newToCenter.length().div(max(uniforms.objectRadius, 0.0001));
    const oldVolume = exp(oldT.mul(1.5).pow(6.0).negate()).mul(0.1).mul(uniforms.objectStrength);
    const newVolume = exp(newT.mul(1.5).pow(6.0).negate()).mul(0.1).mul(uniforms.objectStrength);
    const impulse = drop.add(oldVolume).sub(newVolume);
    const maskedHeight = info.r.add(impulse).mul(boundaryMask(coord));
    textureStore(stateA, coord, vec4(maskedHeight, info.g, max(info.b, abs(impulse)), boundaryMask(coord)));
  })().compute(cellCount, [workgroupSize]);

  const propagateAB = Fn(() => {
    const coord = texelCoord().toVar();
    const x = coord.x;
    const y = coord.y;
    const left = uvec2(max(x, uint(1)).sub(uint(1)), y);
    const right = uvec2(min(x.add(uint(1)), uint(resolution - 1)), y);
    const down = uvec2(x, max(y, uint(1)).sub(uint(1)));
    const up = uvec2(x, min(y.add(uint(1)), uint(resolution - 1)));
    const info = textureLoad(stateA, coord).toVar();
    const cells = max(uniforms.resolution.sub(1.0), 1.0);
    const dxMeters = uniforms.worldSize.x.div(cells);
    const dzMeters = uniforms.worldSize.y.div(cells);
    const laplacianX = textureLoad(stateA, left).r
      .sub(info.r.mul(2.0))
      .add(textureLoad(stateA, right).r)
      .div(dxMeters.mul(dxMeters));
    const laplacianZ = textureLoad(stateA, down).r
      .sub(info.r.mul(2.0))
      .add(textureLoad(stateA, up).r)
      .div(dzMeters.mul(dzMeters));
    const acceleration = laplacianX.add(laplacianZ).mul(uniforms.waveSpeed.mul(uniforms.waveSpeed));
    const velocity = info.g.add(acceleration.mul(uniforms.fixedTimeStep)).mul(uniforms.damping);
    const height = info.r.add(velocity.mul(uniforms.fixedTimeStep)).mul(boundaryMask(coord));
    textureStore(stateB, coord, vec4(height, velocity, info.b.mul(0.97), boundaryMask(coord)));
  })().compute(cellCount, [workgroupSize]);

  const propagateBA = Fn(() => {
    const coord = texelCoord().toVar();
    const x = coord.x;
    const y = coord.y;
    const left = uvec2(max(x, uint(1)).sub(uint(1)), y);
    const right = uvec2(min(x.add(uint(1)), uint(resolution - 1)), y);
    const down = uvec2(x, max(y, uint(1)).sub(uint(1)));
    const up = uvec2(x, min(y.add(uint(1)), uint(resolution - 1)));
    const info = textureLoad(stateB, coord).toVar();
    const cells = max(uniforms.resolution.sub(1.0), 1.0);
    const dxMeters = uniforms.worldSize.x.div(cells);
    const dzMeters = uniforms.worldSize.y.div(cells);
    const laplacianX = textureLoad(stateB, left).r
      .sub(info.r.mul(2.0))
      .add(textureLoad(stateB, right).r)
      .div(dxMeters.mul(dxMeters));
    const laplacianZ = textureLoad(stateB, down).r
      .sub(info.r.mul(2.0))
      .add(textureLoad(stateB, up).r)
      .div(dzMeters.mul(dzMeters));
    const acceleration = laplacianX.add(laplacianZ).mul(uniforms.waveSpeed.mul(uniforms.waveSpeed));
    const velocity = info.g.add(acceleration.mul(uniforms.fixedTimeStep)).mul(uniforms.damping);
    const height = info.r.add(velocity.mul(uniforms.fixedTimeStep)).mul(boundaryMask(coord));
    textureStore(stateA, coord, vec4(height, velocity, info.b.mul(0.97), boundaryMask(coord)));
  })().compute(cellCount, [workgroupSize]);

  const normalCausticFromA = Fn(() => {
    const coord = texelCoord().toVar();
    const x = coord.x;
    const y = coord.y;
    const left = uvec2(max(x, uint(1)).sub(uint(1)), y);
    const right = uvec2(min(x.add(uint(1)), uint(resolution - 1)), y);
    const down = uvec2(x, max(y, uint(1)).sub(uint(1)));
    const up = uvec2(x, min(y.add(uint(1)), uint(resolution - 1)));
    const center = textureLoad(stateA, coord).toVar();
    const leftHeight = textureLoad(stateA, left).r;
    const rightHeight = textureLoad(stateA, right).r;
    const downHeight = textureLoad(stateA, down).r;
    const upHeight = textureLoad(stateA, up).r;
    const dx = rightHeight.sub(leftHeight);
    const dz = upHeight.sub(downHeight);
    const slope = vec2(dx.div(uniforms.worldSize.x), dz.div(uniforms.worldSize.y)).mul(uniforms.resolution).toVar();
    const xSlope = vec2(rightHeight.sub(center.r).div(uniforms.worldSize.x), slope.y.div(uniforms.resolution)).mul(uniforms.resolution);
    const zSlope = vec2(slope.x.div(uniforms.resolution), upHeight.sub(center.r).div(uniforms.worldSize.y)).mul(uniforms.resolution);
    const causticAreaValid = causticCompressionFromSlope(slope, xSlope, zSlope, uvFromCoord(coord)).toVar();
    const area = max(causticAreaValid.x, uniforms.causticEpsilon);
    const caustic = clamp(float(1).div(area).mul(uniforms.causticScale), 0, uniforms.causticMaxIntensity);
    const valid = causticAreaValid.y.mul(select(causticAreaValid.x.greaterThan(uniforms.causticEpsilon), float(1), float(0)));
    If(valid.lessThan(1), () => {
      atomicAdd(diagnosticBufferNode.element(uint(0)), uint(1));
    });
    textureStore(normalCaustic, coord, vec4(clamp(slope, -0.999, 0.999), caustic, valid.mul(center.a)));
  })().compute(cellCount, [workgroupSize]);

  const normalCausticFromB = Fn(() => {
    const coord = texelCoord().toVar();
    const x = coord.x;
    const y = coord.y;
    const left = uvec2(max(x, uint(1)).sub(uint(1)), y);
    const right = uvec2(min(x.add(uint(1)), uint(resolution - 1)), y);
    const down = uvec2(x, max(y, uint(1)).sub(uint(1)));
    const up = uvec2(x, min(y.add(uint(1)), uint(resolution - 1)));
    const center = textureLoad(stateB, coord).toVar();
    const leftHeight = textureLoad(stateB, left).r;
    const rightHeight = textureLoad(stateB, right).r;
    const downHeight = textureLoad(stateB, down).r;
    const upHeight = textureLoad(stateB, up).r;
    const dx = rightHeight.sub(leftHeight);
    const dz = upHeight.sub(downHeight);
    const slope = vec2(dx.div(uniforms.worldSize.x), dz.div(uniforms.worldSize.y)).mul(uniforms.resolution).toVar();
    const xSlope = vec2(rightHeight.sub(center.r).div(uniforms.worldSize.x), slope.y.div(uniforms.resolution)).mul(uniforms.resolution);
    const zSlope = vec2(slope.x.div(uniforms.resolution), upHeight.sub(center.r).div(uniforms.worldSize.y)).mul(uniforms.resolution);
    const causticAreaValid = causticCompressionFromSlope(slope, xSlope, zSlope, uvFromCoord(coord)).toVar();
    const area = max(causticAreaValid.x, uniforms.causticEpsilon);
    const caustic = clamp(float(1).div(area).mul(uniforms.causticScale), 0, uniforms.causticMaxIntensity);
    const valid = causticAreaValid.y.mul(select(causticAreaValid.x.greaterThan(uniforms.causticEpsilon), float(1), float(0)));
    If(valid.lessThan(1), () => {
      atomicAdd(diagnosticBufferNode.element(uint(0)), uint(1));
    });
    textureStore(normalCaustic, coord, vec4(clamp(slope, -0.999, 0.999), caustic, valid.mul(center.a)));
  })().compute(cellCount, [workgroupSize]);

  return {
    resetDiagnostics,
    dropAndImpulseAB,
    dropAndImpulseBA,
    propagateAB,
    propagateBA,
    normalCausticFromA,
    normalCausticFromB,
  };
}

export class WebGPUBoundedWaterHeightfield {
  constructor(renderer, options = {}) {
    const tierName = options.tier ?? "high";
    this.renderer = renderer;
    this.tier = { ...WATER_QUALITY_TIERS[tierName], ...(options.tierOverrides ?? {}) };
    this.resolution = options.resolution ?? this.tier.resolution;
    this.tier.resolution = this.resolution;
    this.parameters = {
      ...DEFAULT_WATER_PARAMETERS,
      ...(options.parameters ?? {}),
      worldSize: cloneVector2(options.parameters?.worldSize ?? DEFAULT_WATER_PARAMETERS.worldSize),
    };
    this.configValidation = validateWaterConfig({ tier: this.tier, parameters: this.parameters });

    this.accumulator = 0;
    this.fixedTimeStep = this.tier.fixedTimeStep;
    this.maxSubsteps = this.tier.maxSubsteps;
    this.pendingDrop = { ...ZERO_DROP };
    this.pendingImpulse = {
      oldCenter: ZERO_IMPULSE.oldCenter.clone(),
      newCenter: ZERO_IMPULSE.newCenter.clone(),
      radius: ZERO_IMPULSE.radius,
      strength: ZERO_IMPULSE.strength,
    };
    this.readIndex = 0;
    this.dispatchCount = 0;
    this.lastStepCount = 0;

    this.stateA = createWaterStorageTexture(this.resolution, this.resolution, "bounded-water-state-a");
    this.stateB = createWaterStorageTexture(this.resolution, this.resolution, "bounded-water-state-b");
    this.normalCaustic = createSampledDebugTexture(this.resolution, this.resolution, "bounded-water-normal-caustic");
    this.diagnosticBuffer = new StorageBufferAttribute(4, 1, Uint32Array);
    this.diagnosticBuffer.name = "bounded-water-diagnostics";
    this.diagnosticBufferNode = storage(this.diagnosticBuffer, "uint", 4).toAtomic();
    this.uniforms = makeUniforms(this.parameters, this.tier);
    this.computeNodes = makeComputeNodes(this);

    this.resetImpulseUniforms();
  }

  get currentTexture() {
    return this.readIndex === 0 ? this.stateA : this.stateB;
  }

  get writeTexture() {
    return this.readIndex === 0 ? this.stateB : this.stateA;
  }

  get diagnostics() {
    return {
      invalidCausticCounter: this.diagnosticBuffer,
      lastStepCount: this.lastStepCount,
      dispatchCount: this.dispatchCount,
      storageBytes: waterStorageBytes(this.resolution, 3),
    };
  }

  async initialize({ async = true } = {}) {
    if (async) {
      await safeRendererComputeAsync(this.renderer, this.computeNodes.resetDiagnostics);
      await safeRendererComputeAsync(this.renderer, this.computeNodes.normalCausticFromA);
    } else {
      safeRendererCompute(this.renderer, this.computeNodes.resetDiagnostics);
      safeRendererCompute(this.renderer, this.computeNodes.normalCausticFromA);
    }
  }

  setDrop({ x, z, radius = this.parameters.dropRadius, strength = this.parameters.dropStrength }) {
    this.pendingDrop = { x, z, radius, strength };
  }

  setObjectImpulse({
    oldCenter,
    newCenter,
    radius = this.parameters.objectRadius,
    strength = this.parameters.objectDisplacementScale,
  }) {
    this.pendingImpulse = {
      oldCenter: cloneVector3(oldCenter),
      newCenter: cloneVector3(newCenter),
      radius,
      strength,
    };
  }

  updateUniforms() {
    setUniformVector2(this.uniforms.dropCenter, this.pendingDrop);
    this.uniforms.dropRadius.value = this.pendingDrop.radius;
    this.uniforms.dropStrength.value = this.pendingDrop.strength;
    setUniformVector3(this.uniforms.oldObjectCenter, this.pendingImpulse.oldCenter);
    setUniformVector3(this.uniforms.newObjectCenter, this.pendingImpulse.newCenter);
    this.uniforms.objectRadius.value = this.pendingImpulse.radius;
    this.uniforms.objectStrength.value = this.pendingImpulse.strength;
  }

  resetImpulseUniforms() {
    this.pendingDrop = { ...ZERO_DROP };
    this.pendingImpulse = {
      oldCenter: ZERO_IMPULSE.oldCenter.clone(),
      newCenter: ZERO_IMPULSE.newCenter.clone(),
      radius: ZERO_IMPULSE.radius,
      strength: ZERO_IMPULSE.strength,
    };
    this.updateUniforms();
  }

  runFixedStep({ async = false } = {}) {
    this.updateUniforms();

    const dropNode = this.readIndex === 0 ? this.computeNodes.dropAndImpulseAB : this.computeNodes.dropAndImpulseBA;
    const propagateNode = this.readIndex === 0 ? this.computeNodes.propagateBA : this.computeNodes.propagateAB;
    const normalNode = this.readIndex === 0 ? this.computeNodes.normalCausticFromA : this.computeNodes.normalCausticFromB;

    const run = async ? safeRendererComputeAsync : safeRendererCompute;

    // Diagnostic reset is a deliberate prepass so the invalid counter is
    // frame-local; the simulation chain itself remains drop -> propagate ->
    // normal/caustic as specified by the reference build order.
    const result = run(this.renderer, this.computeNodes.resetDiagnostics);
    const runChain = async
      ? result
        .then(() => run(this.renderer, dropNode))
        .then(() => {
          this.readIndex = 1 - this.readIndex;
          return run(this.renderer, propagateNode);
        })
        .then(() => {
          this.readIndex = 1 - this.readIndex;
          return run(this.renderer, normalNode);
        })
      : (run(this.renderer, dropNode), this.readIndex = 1 - this.readIndex, run(this.renderer, propagateNode), this.readIndex = 1 - this.readIndex, run(this.renderer, normalNode));

    this.dispatchCount += 4;
    this.resetImpulseUniforms();
    return runChain;
  }

  step(deltaSeconds, { async = false } = {}) {
    this.accumulator = Math.min(this.accumulator + deltaSeconds, this.fixedTimeStep * this.maxSubsteps);
    const steps = Math.min(this.maxSubsteps, Math.floor(this.accumulator / this.fixedTimeStep));
    this.lastStepCount = steps;

    if (async) {
      let chain = Promise.resolve();
      for (let i = 0; i < steps; i += 1) {
        chain = chain.then(() => this.runFixedStep({ async: true }));
      }
      this.accumulator -= steps * this.fixedTimeStep;
      return chain;
    }

    for (let i = 0; i < steps; i += 1) {
      this.runFixedStep({ async: false });
    }

    this.accumulator -= steps * this.fixedTimeStep;
    return undefined;
  }

  dispose() {
    this.stateA.dispose();
    this.stateB.dispose();
    this.normalCaustic.dispose();
    this.diagnosticBuffer.dispose();
  }
}

export function createBoundedWaterMaterial({
  heightfield,
  timeNode = float(0),
  debugMode = WATER_DEBUG_MODES.final,
  sceneColorNode = viewportSharedTexture(),
  sceneDepthNode = viewportDepthTexture(),
  parameters = DEFAULT_WATER_PARAMETERS,
  analyticBandCount = AUTHORED_WAVES.length,
  microBandCount = 4,
} = {}) {
  // Build order 4, 6, and 7: shared authored TSL waves feed displacement,
  // normals, crest/foam, and the water output combines depth-aware refraction,
  // analytic fallback, absorption, side-aware Fresnel, caustics, and foam.
  const material = new MeshPhysicalNodeMaterial({
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    roughness: parameters.roughness,
    metalness: 0,
    transmission: 0,
  });

  const waterState = texture(heightfield.currentTexture);
  const normalCaustic = texture(heightfield.normalCaustic);
  const debugModeNode = uniform(debugMode, "int");
  const worldSize = vec2(parameters.worldSize.x, parameters.worldSize.y);
  const sunDirection = vec3(parameters.sunDirection.x, parameters.sunDirection.y, parameters.sunDirection.z);
  const absorption = vec3(parameters.absorptionPerMeter.x, parameters.absorptionPerMeter.y, parameters.absorptionPerMeter.z);
  const deepBody = vec3(parameters.deepBodyColor.x, parameters.deepBodyColor.y, parameters.deepBodyColor.z);
  const shallowScatter = vec3(parameters.shallowScatterColor.x, parameters.shallowScatterColor.y, parameters.shallowScatterColor.z);
  const foamColor = vec3(parameters.foamColor.x, parameters.foamColor.y, parameters.foamColor.z);

  const surfaceUvFromLocal = Fn(([localXZ]) => {
    return clamp(vec2(localXZ.x.div(worldSize.x).add(0.5), localXZ.y.div(worldSize.y).add(0.5)), 0.001, 0.999);
  });

  const sampledState = Fn(([localXZ]) => {
    return texture(waterState, surfaceUvFromLocal(localXZ));
  });

  const sampledNormalCaustic = Fn(([localXZ]) => {
    return texture(normalCaustic, surfaceUvFromLocal(localXZ));
  });

  material.positionNode = Fn(() => {
    const baseXZ = positionLocal.xz;
    const state = sampledState(baseXZ);
    const analytic = buildAnalyticWaveDisplacementTSL(baseXZ, timeNode, analyticBandCount);
    return vec3(
      positionLocal.x.add(analytic.x),
      positionLocal.y.add(analytic.y).add(state.r),
      positionLocal.z.add(analytic.z),
    );
  })();

  const waterOutput = Fn(() => {
    const localXZ = positionLocal.xz;
    const state = sampledState(localXZ).toVar();
    const packedNormal = sampledNormalCaustic(localXZ).toVar();
    const analyticNormalCrest = buildAnalyticNormalAndCrestTSL(localXZ, positionWorld.xz, timeNode, analyticBandCount, microBandCount).toVar();
    const dynamicSlopeNormal = normalize(vec3(packedNormal.r.negate(), 1, packedNormal.g.negate()));
    const normalValue = normalize(mix(analyticNormalCrest.xyz, dynamicSlopeNormal, clamp(abs(state.r).mul(3.0).add(abs(state.g).mul(5.0)), 0, 0.75))).toVar();
    normalValue.assign(normalValue.mul(faceDirection));

    const viewDirection = normalize(cameraPosition.sub(positionWorld));
    const underwater = dot(normalValue, viewDirection).lessThan(0);
    const eta = select(underwater, float(parameters.waterIor / parameters.airIor), float(parameters.airIor / parameters.waterIor));
    const f0 = pow(float(parameters.airIor).sub(parameters.waterIor).div(float(parameters.airIor).add(parameters.waterIor)), 2.0);
    const nDotV = abs(dot(normalValue, viewDirection));
    const fresnel = clamp(f0.add(float(1).sub(f0).mul(pow(float(1).sub(nDotV), 5.0))), 0, 1);
    const refracted = refract(viewDirection.negate(), normalValue, eta);
    const screen = screenUV;
    const refractionOffset = refracted.xz
      .add(packedNormal.rg.mul(0.5))
      .mul(parameters.refractionStrength)
      .mul(float(1).sub(fresnel))
      .mul(0.1);
    const refractedUv = clamp(screen.add(refractionOffset), 0.002, 0.998).toVar();
    const sampledDepth = texture(sceneDepthNode, refractedUv).r;
    const currentDepth = texture(sceneDepthNode, screen).r;
    const sampledLinearDepth = viewportLinearDepth(sampledDepth);
    const currentLinearDepth = viewportLinearDepth(currentDepth);
    const sampledViewZ = perspectiveDepthToViewZ(sampledDepth, cameraNear, cameraFar);
    const currentViewZ = perspectiveDepthToViewZ(currentDepth, cameraNear, cameraFar);
    const inBounds = refractedUv.x.greaterThan(0.001)
      .and(refractedUv.x.lessThan(0.999))
      .and(refractedUv.y.greaterThan(0.001))
      .and(refractedUv.y.lessThan(0.999));
    const notForeground = sampledLinearDepth.greaterThanEqual(currentLinearDepth.sub(0.0004));
    const refractionValid = inBounds.and(notForeground);
    const pathLength = select(refractionValid, max(abs(sampledViewZ.sub(currentViewZ)), 0.15), float(parameters.fallbackDepthMeters));
    const transmittance = exp(absorption.mul(pathLength).negate());
    const sceneRefraction = texture(sceneColorNode, refractedUv).rgb;
    const fallbackBody = mix(deepBody, shallowScatter, clamp(normalValue.y, 0, 1));
    const refractedBody = mix(fallbackBody, sceneRefraction, select(refractionValid, float(0.74), float(0.0)));

    const reflected = reflect(viewDirection.negate(), normalValue);
    const reflection = buildSkyColorTSL(reflected, sunDirection);
    const reflectedSun = clamp(dot(reflected, sunDirection), 0, 1);
    const reflectionGlint = vec3(1.0, 0.95, 0.72).mul(pow(reflectedSun, 2500.0)).mul(14.0)
      .add(vec3(1.0, 0.7, 0.36).mul(pow(reflectedSun, 14.0)).mul(1.1));
    const halfVector = normalize(viewDirection.add(sunDirection));
    const specular = pow(clamp(dot(normalValue, halfVector), 0, 1), 1200.0).mul(12.0);
    const crest = max(analyticNormalCrest.w, state.b);
    const foam = smoothstep(0.05, 0.45, crest.mul(1.1));
    const caustic = packedNormal.b.mul(packedNormal.a);

    const transmitted = refractedBody.mul(float(1).sub(fresnel)).mul(transmittance);
    const reflectedEnergy = reflection.add(reflectionGlint).mul(fresnel);
    const availableSpecular = float(1).sub(fresnel).mul(0.35);
    const colorValue = transmitted
      .add(reflectedEnergy)
      .add(vec3(1.0, 0.96, 0.8).mul(specular).mul(availableSpecular))
      .add(vec3(caustic).mul(vec3(0.85, 0.95, 1.0)).mul(float(1).sub(fresnel)).mul(0.12));
    const finalColor = mix(colorValue, foamColor, foam.mul(0.34));

    If(debugModeNode.equal(WATER_DEBUG_MODES.height), () => {
      finalColor.assign(mix(vec3(0.03, 0.08, 0.14), vec3(0.8, 0.25, 0.08), clamp(state.r.mul(5.0).add(0.5), 0, 1)));
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES.velocity), () => {
      finalColor.assign(vec3(abs(state.g).mul(12.0)));
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES.normals), () => {
      finalColor.assign(normalValue.mul(0.5).add(0.5));
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES.caustics), () => {
      finalColor.assign(vec3(caustic.div(parameters.causticMaxIntensity)));
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES.refractionValidity), () => {
      finalColor.assign(mix(vec3(0.75, 0.06, 0.02), vec3(0.02, 0.78, 0.45), select(refractionValid, float(1), float(0))));
    });

    return vec4(finalColor, 0.88);
  });

  material.outputNode = waterOutput();
  material.userData.waterStateTextureNode = waterState;
  material.userData.normalCausticTextureNode = normalCaustic;
  material.userData.debugModeNode = debugModeNode;
  material.userData.setDebugMode = (mode) => {
    debugModeNode.value = typeof mode === "string" ? WATER_DEBUG_MODES[mode] : mode;
    material.needsUpdate = true;
  };
  material.userData.syncSimulationTextures = () => {
    waterState.value = heightfield.currentTexture;
    normalCaustic.value = heightfield.normalCaustic;
  };

  return material;
}

export function createReducedBoundedWaterMaterial({
  timeNode = float(0),
  debugMode = WATER_DEBUG_MODES.final,
  sceneColorNode = viewportSharedTexture(),
  sceneDepthNode = viewportDepthTexture(),
  parameters = DEFAULT_WATER_PARAMETERS,
  analyticBandCount = WATER_QUALITY_TIERS.reduced.analyticBands,
  microBandCount = WATER_QUALITY_TIERS.reduced.microBands,
} = {}) {
  // This material is only for explicit teaching on how to apply fallback when
  // WebGPU is unavailable. It deliberately avoids StorageTexture sampling.
  const material = new MeshPhysicalNodeMaterial({
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    roughness: parameters.roughness,
    metalness: 0,
    transmission: 0,
  });

  const debugModeNode = uniform(debugMode, "int");
  const sunDirection = vec3(parameters.sunDirection.x, parameters.sunDirection.y, parameters.sunDirection.z);
  const absorption = vec3(parameters.absorptionPerMeter.x, parameters.absorptionPerMeter.y, parameters.absorptionPerMeter.z);
  const deepBody = vec3(parameters.deepBodyColor.x, parameters.deepBodyColor.y, parameters.deepBodyColor.z);
  const shallowScatter = vec3(parameters.shallowScatterColor.x, parameters.shallowScatterColor.y, parameters.shallowScatterColor.z);
  const foamColor = vec3(parameters.foamColor.x, parameters.foamColor.y, parameters.foamColor.z);

  material.positionNode = Fn(() => {
    const baseXZ = positionLocal.xz;
    const analytic = buildAnalyticWaveDisplacementTSL(baseXZ, timeNode, analyticBandCount);
    return vec3(
      positionLocal.x.add(analytic.x),
      positionLocal.y.add(analytic.y),
      positionLocal.z.add(analytic.z),
    );
  })();

  const waterOutput = Fn(() => {
    const localXZ = positionLocal.xz;
    const analytic = buildAnalyticWaveDisplacementTSL(localXZ, timeNode, analyticBandCount).toVar();
    const analyticNormalCrest = buildAnalyticNormalAndCrestTSL(localXZ, positionWorld.xz, timeNode, analyticBandCount, microBandCount).toVar();
    const normalValue = normalize(analyticNormalCrest.xyz).toVar();
    normalValue.assign(normalValue.mul(faceDirection));

    const viewDirection = normalize(cameraPosition.sub(positionWorld));
    const underwater = dot(normalValue, viewDirection).lessThan(0);
    const eta = select(underwater, float(parameters.waterIor / parameters.airIor), float(parameters.airIor / parameters.waterIor));
    const f0 = pow(float(parameters.airIor).sub(parameters.waterIor).div(float(parameters.airIor).add(parameters.waterIor)), 2.0);
    const nDotV = abs(dot(normalValue, viewDirection));
    const fresnel = clamp(f0.add(float(1).sub(f0).mul(pow(float(1).sub(nDotV), 5.0))), 0, 1);
    const refracted = refract(viewDirection.negate(), normalValue, eta);
    const screen = screenUV;
    const refractionOffset = refracted.xz
      .mul(parameters.refractionStrength * 0.55)
      .mul(float(1).sub(fresnel))
      .mul(0.1);
    const unclampedUv = screen.add(refractionOffset).toVar();
    const refractedUv = clamp(unclampedUv, 0.002, 0.998).toVar();
    const sampledDepth = texture(sceneDepthNode, refractedUv).r;
    const currentDepth = texture(sceneDepthNode, screen).r;
    const sampledLinearDepth = viewportLinearDepth(sampledDepth);
    const currentLinearDepth = viewportLinearDepth(currentDepth);
    const sampledViewZ = perspectiveDepthToViewZ(sampledDepth, cameraNear, cameraFar);
    const currentViewZ = perspectiveDepthToViewZ(currentDepth, cameraNear, cameraFar);
    const inBounds = unclampedUv.x.greaterThan(0.001)
      .and(unclampedUv.x.lessThan(0.999))
      .and(unclampedUv.y.greaterThan(0.001))
      .and(unclampedUv.y.lessThan(0.999));
    const notForeground = sampledLinearDepth.greaterThanEqual(currentLinearDepth.sub(0.0004));
    const refractionValid = inBounds.and(notForeground);
    const pathLength = select(refractionValid, max(abs(sampledViewZ.sub(currentViewZ)), 0.15), float(parameters.fallbackDepthMeters));
    const transmittance = exp(absorption.mul(pathLength).negate());
    const sceneRefraction = texture(sceneColorNode, refractedUv).rgb;
    const fallbackBody = mix(deepBody, shallowScatter, clamp(normalValue.y, 0, 1));
    const refractedBody = mix(fallbackBody, sceneRefraction, select(refractionValid, float(0.5), float(0.0)));

    const reflected = reflect(viewDirection.negate(), normalValue);
    const reflection = buildSkyColorTSL(reflected, sunDirection);
    const reflectedSun = clamp(dot(reflected, sunDirection), 0, 1);
    const reflectionGlint = vec3(1.0, 0.95, 0.72).mul(pow(reflectedSun, 1800.0)).mul(8.0)
      .add(vec3(1.0, 0.7, 0.36).mul(pow(reflectedSun, 12.0)).mul(0.8));
    const halfVector = normalize(viewDirection.add(sunDirection));
    const specular = pow(clamp(dot(normalValue, halfVector), 0, 1), 900.0).mul(8.0);
    const crest = analyticNormalCrest.w;
    const foam = smoothstep(0.18, 0.55, crest);
    const causticProxy = clamp(crest.mul(1.7).add(max(float(0), normalValue.y).mul(0.05)), 0, 1);

    const transmitted = refractedBody.mul(float(1).sub(fresnel)).mul(transmittance);
    const reflectedEnergy = reflection.add(reflectionGlint).mul(fresnel);
    const finalColor = mix(
      transmitted
        .add(reflectedEnergy)
        .add(vec3(1.0, 0.96, 0.8).mul(specular).mul(float(1).sub(fresnel).mul(0.25)))
        .add(vec3(0.55, 0.72, 0.95).mul(causticProxy).mul(float(1).sub(fresnel)).mul(0.045)),
      foamColor,
      foam.mul(0.25),
    );

    If(debugModeNode.equal(WATER_DEBUG_MODES.height), () => {
      finalColor.assign(mix(vec3(0.03, 0.08, 0.14), vec3(0.8, 0.25, 0.08), clamp(analytic.y.mul(2.0).add(0.5), 0, 1)));
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES.velocity), () => {
      finalColor.assign(vec3(0.0, 0.08, 0.14));
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES.normals), () => {
      finalColor.assign(normalValue.mul(0.5).add(0.5));
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES.caustics), () => {
      finalColor.assign(vec3(causticProxy));
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES.refractionValidity), () => {
      finalColor.assign(mix(vec3(0.75, 0.06, 0.02), vec3(0.02, 0.78, 0.45), select(refractionValid, float(1), float(0))));
    });

    return vec4(finalColor, 0.84);
  });

  material.outputNode = waterOutput();
  material.userData.reducedTier = true;
  material.userData.usesStorageTexture = false;
  material.userData.reason = "Explicit request to teach how to apply fallback when WebGPU is unavailable.";
  material.userData.debugModeNode = debugModeNode;
  material.userData.setDebugMode = (mode) => {
    debugModeNode.value = typeof mode === "string" ? WATER_DEBUG_MODES[mode] : mode;
    material.needsUpdate = true;
  };
  material.userData.syncSimulationTextures = () => undefined;

  return material;
}

export function createBoundedWaterMesh({
  heightfield,
  width = heightfield.parameters.worldSize.x,
  depth = heightfield.parameters.worldSize.y,
  segments = heightfield.resolution - 1,
  material = createBoundedWaterMaterial({ heightfield }),
} = {}) {
  const geometry = new PlaneGeometry(width, depth, segments, segments);
  geometry.rotateX(-Math.PI * 0.5);
  const yExtent = estimateWaterVerticalAmplitude(heightfield.parameters, heightfield.tier.analyticBands);
  geometry.boundingBox = new Box3(
    new Vector3(width * -0.5, -yExtent, depth * -0.5),
    new Vector3(width * 0.5, yExtent, depth * 0.5),
  );
  geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), Math.sqrt(width * width + depth * depth) * 0.5 + yExtent);
  const mesh = new Mesh(geometry, material);
  mesh.name = "WebGPU bounded water surface";
  return mesh;
}

export function createReducedBoundedWaterMesh({
  parameters = DEFAULT_WATER_PARAMETERS,
  tier = WATER_QUALITY_TIERS.reduced,
  material = createReducedBoundedWaterMaterial({ parameters }),
} = {}) {
  const width = parameters.worldSize.x;
  const depth = parameters.worldSize.y;
  const segments = Math.max(16, Math.min(96, tier.resolution - 1));
  const geometry = new PlaneGeometry(width, depth, segments, segments);
  geometry.rotateX(-Math.PI * 0.5);
  const yExtent = estimateWaterVerticalAmplitude(parameters, tier.analyticBands);
  geometry.boundingBox = new Box3(
    new Vector3(width * -0.5, -yExtent, depth * -0.5),
    new Vector3(width * 0.5, yExtent, depth * 0.5),
  );
  geometry.boundingSphere = new Sphere(new Vector3(0, 0, 0), Math.sqrt(width * width + depth * depth) * 0.5 + yExtent);
  const mesh = new Mesh(geometry, material);
  mesh.name = "Reduced analytic bounded water surface";
  mesh.userData.reducedTier = {
    tier: "reduced",
    usesStorageTexture: false,
    reason: "Explicit request to teach how to apply fallback when WebGPU is unavailable.",
  };
  return mesh;
}

export function createBoundedWaterRenderPipeline(renderer, scene, camera, {
  useMRT = true,
  outputToneMapping = NoToneMapping,
  outputColorSpace = renderer.outputColorSpace,
} = {}) {
  // Build order 5: scene color/depth ownership lives in the node render
  // pipeline, and renderOutput() is the single output transform owner.
  const scenePass = pass(scene, camera);

  if (useMRT) {
    scenePass.setMRT(mrt({
      output,
    }));
  }

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = renderOutput(useMRT ? scenePass.getTextureNode("output") : scenePass, outputToneMapping, outputColorSpace);

  return {
    pipeline,
    scenePass,
    colorNode: useMRT ? scenePass.getTextureNode("output") : scenePass,
    depthNode: scenePass.getTextureNode("depth"),
    render() {
      const state = RendererUtils.saveRendererState(renderer);
      try {
        pipeline.render();
      } finally {
        RendererUtils.restoreRendererState(renderer, state);
      }
    },
    dispose() {
      pipeline.dispose();
    },
  };
}

export async function createWebGPUBoundedWaterSystem(renderer, {
  tier = "high",
  seed = 1,
  scene = null,
  camera = null,
  timeNode = float(0),
  debugMode = WATER_DEBUG_MODES.final,
  parameters = {},
  explicitFallbackWhenWebGPUUnavailable = false,
} = {}) {
  await renderer.init();

  const backendIsWebGPU = renderer.backend?.isWebGPUBackend === true;
  const selectedTierName = backendIsWebGPU ? tier : "reduced";
  const selectedTier = WATER_QUALITY_TIERS[selectedTierName] ?? WATER_QUALITY_TIERS.high;
  const resolvedParameters = {
    ...DEFAULT_WATER_PARAMETERS,
    ...parameters,
    worldSize: cloneVector2(parameters.worldSize ?? DEFAULT_WATER_PARAMETERS.worldSize),
  };

  if (!backendIsWebGPU) {
    if (!explicitFallbackWhenWebGPUUnavailable) {
      throw new Error("WebGPU backend required for the canonical bounded water path. Analytic fallback teaching is opt-in and should be used only when the user explicitly asks how to apply fallback when WebGPU is unavailable.");
    }

    const configValidation = validateWaterConfig({ tier: selectedTier, parameters: resolvedParameters });
    const pipeline = scene && camera ? createBoundedWaterRenderPipeline(renderer, scene, camera) : null;
    const material = createReducedBoundedWaterMaterial({
      timeNode,
      debugMode,
      sceneColorNode: pipeline?.colorNode ?? viewportSharedTexture(),
      sceneDepthNode: pipeline?.depthNode ?? viewportDepthTexture(),
      parameters: resolvedParameters,
      analyticBandCount: selectedTier.analyticBands,
      microBandCount: selectedTier.microBands,
    });
    const mesh = createReducedBoundedWaterMesh({ parameters: resolvedParameters, tier: selectedTier, material });
    mesh.userData.sceneColorExclusion = "Create the scene pass before adding this mesh, or render opaque/background layers only, so water refraction does not sample itself.";

    return {
      renderer,
      backendIsWebGPU,
      tier: "reduced",
      seed,
      heightfield: null,
      material,
      mesh,
      pipeline,
      configValidation,
      fallbackTeachingReason: "Analytic water fallback is only for an explicit request to teach how to apply fallback when WebGPU is unavailable.",
      update() {
        return undefined;
      },
      dispose() {
        mesh.geometry.dispose();
        material.dispose();
        pipeline?.dispose();
      },
    };
  }

  const heightfield = new WebGPUBoundedWaterHeightfield(renderer, { tier: selectedTierName, parameters: resolvedParameters });
  await heightfield.initialize({ async: true });

  const pipeline = scene && camera ? createBoundedWaterRenderPipeline(renderer, scene, camera) : null;
  const material = createBoundedWaterMaterial({
    heightfield,
    timeNode,
    debugMode,
    sceneColorNode: pipeline?.colorNode ?? viewportSharedTexture(),
    sceneDepthNode: pipeline?.depthNode ?? viewportDepthTexture(),
    parameters: heightfield.parameters,
    analyticBandCount: heightfield.tier.analyticBands,
    microBandCount: heightfield.tier.microBands,
  });
  const mesh = createBoundedWaterMesh({ heightfield, material });
  mesh.userData.sceneColorExclusion = "Create the scene pass before adding this mesh, or render opaque/background layers only, so water refraction does not sample itself.";

  return {
    renderer,
    backendIsWebGPU,
    tier: selectedTierName,
    seed,
    heightfield,
    material,
    mesh,
    pipeline,
    update(deltaSeconds) {
      if (!backendIsWebGPU) {
        return undefined;
      }
      const result = heightfield.step(deltaSeconds);
      material.userData.syncSimulationTextures();
      return result;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      heightfield.dispose();
      pipeline?.dispose();
    },
  };
}

export { WATER_DEBUG_MODES, WATER_QUALITY_TIERS };
