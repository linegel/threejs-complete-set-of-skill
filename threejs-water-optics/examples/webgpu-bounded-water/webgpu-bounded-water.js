import {
  ClampToEdgeWrapping,
  DoubleSide,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  NoColorSpace,
  PlaneGeometry,
  RGBAFormat,
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
  atomicLoad,
  atomicStore,
  cameraProjectionMatrix,
  cameraProjectionMatrixInverse,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  cos,
  cross,
  dFdx,
  dFdy,
  dot,
  exp,
  float,
  floor,
  getScreenPosition,
  getViewPosition,
  globalId,
  int,
  length,
  max,
  min,
  mix,
  modelNormalMatrix,
  normalize,
  positionGeometry,
  positionView,
  positionWorld,
  pow,
  reflect,
  refract,
  select,
  sin,
  smoothstep,
  sqrt,
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
} from "three/tsl";
import {
  AUTHORED_WAVES,
  DEFAULT_WATER_PARAMETERS,
  MICRO_NORMAL_BANDS,
  WATER_DEBUG_MODES,
  WATER_EXAMPLE_CLAIM_BOUNDARY,
  WATER_MECHANISM_ROUTES,
  WATER_QUALITY_TIERS,
  CAUSTIC_POWER_QUANTIZATION_UNITS_PER_WATT,
  boundedCausticQuantizationContract,
  boundedWaterPersistentBytes,
  validateWaterConfig,
} from "./constants.js";
import { createBoundedWaterHeightQuery } from "./cpu-water-height.js";

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

function createWaterStorageTexture(width, height, name, { linearSampling = false } = {}) {
  const textureValue = new StorageTexture(width, height);
  textureValue.name = name;
  textureValue.format = RGBAFormat;
  textureValue.type = HalfFloatType;
  textureValue.colorSpace = NoColorSpace;
  textureValue.minFilter = linearSampling ? LinearFilter : NearestFilter;
  textureValue.magFilter = linearSampling ? LinearFilter : NearestFilter;
  textureValue.wrapS = ClampToEdgeWrapping;
  textureValue.wrapT = ClampToEdgeWrapping;
  textureValue.generateMipmaps = false;
  textureValue.mipmapsAutoUpdate = false;
  return textureValue;
}

function createSampledDebugTexture(width, height, name) {
  return createWaterStorageTexture(width, height, name, { linearSampling: true });
}

function makeUniforms(parameters, tier) {
  return {
    resolution: uniform(tier.resolution, "float"),
    causticResolution: uniform(tier.causticResolution, "float"),
    fixedTimeStep: uniform(tier.fixedTimeStep, "float"),
    worldSize: uniform(new Vector2(parameters.worldSize.x, parameters.worldSize.y)),
    dampingRatePerSecond: uniform(parameters.dampingRatePerSecond, "float"),
    waveSpeed: uniform(parameters.waveSpeed, "float"),
    boundaryFadeCells: uniform(parameters.boundaryFadeCells, "float"),
    simulationTime: uniform(0, "float"),
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
    causticReceiverDepthMeters: uniform(parameters.causticReceiverDepthMeters, "float"),
    causticFootprintAreaEpsilonMeters2: uniform(parameters.causticFootprintAreaEpsilonMeters2, "float"),
    causticLightTransmission: uniform(parameters.causticLightTransmission, "float"),
    causticPowerUnitsPerWatt: uniform(CAUSTIC_POWER_QUANTIZATION_UNITS_PER_WATT, "float"),
    causticMaxUnitsPerSource: uniform(boundedCausticQuantizationContract(tier.resolution).maxUnitsPerSource, "float"),
  };
}

function setUniformVector2(node, value) {
  node.value.set(value.x, value.y ?? value.z);
}

function setUniformVector3(node, value) {
  node.value.set(value.x, value.y, value.z);
}

function safeRendererCompute(renderer, computeNode) {
  return renderer.compute(computeNode);
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

function buildSurfaceNormalAndCrestTSL(baseXZ, worldXZ, dynamicSlope, timeNode, bandCount, microBandCount) {
  const tangentX = vec3(1, dynamicSlope.x, 0).toVar();
  const tangentZ = vec3(0, dynamicSlope.y, 1).toVar();

  for (const wave of AUTHORED_WAVES.slice(0, bandCount)) {
    const direction = vec2(wave.direction.x, wave.direction.y);
    const k = float(TAU / wave.wavelength);
    const omega = float(Math.sqrt(9.81 * (TAU / wave.wavelength)));
    const phase = k.mul(dot(direction, baseXZ)).sub(omega.mul(timeNode));
    const sinPhase = sin(phase);
    const cosPhase = cos(phase);
    const verticalDerivative = k.mul(wave.amplitude).mul(cosPhase);
    const horizontalDerivative = k.mul(wave.steepness * wave.amplitude).mul(sinPhase);

    tangentX.x.subAssign(horizontalDerivative.mul(direction.x).mul(direction.x));
    tangentX.y.addAssign(verticalDerivative.mul(direction.x));
    tangentX.z.subAssign(horizontalDerivative.mul(direction.x).mul(direction.y));
    tangentZ.x.subAssign(horizontalDerivative.mul(direction.x).mul(direction.y));
    tangentZ.y.addAssign(verticalDerivative.mul(direction.y));
    tangentZ.z.subAssign(horizontalDerivative.mul(direction.y).mul(direction.y));
  }

  const horizontalJacobian = tangentX.x.mul(tangentZ.z).sub(tangentZ.x.mul(tangentX.z));
  const normalValue = normalize(cross(tangentZ, tangentX)).toVar();
  const footprint = max(length(dFdx(worldXZ)), length(dFdy(worldXZ)));
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

  const crest = clamp(float(1).sub(horizontalJacobian), 0, 1);
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

function exactDielectricFresnelTSL(cosIncident, incidentIor, transmittedIor) {
  const eta = incidentIor.div(transmittedIor);
  const sinTransmittedSquared = eta.mul(eta).mul(float(1).sub(cosIncident.mul(cosIncident)));
  const transmissionPossible = sinTransmittedSquared.lessThanEqual(1);
  const cosTransmitted = sqrt(max(float(1).sub(sinTransmittedSquared), 0));
  const rs = incidentIor.mul(cosIncident).sub(transmittedIor.mul(cosTransmitted))
    .div(max(incidentIor.mul(cosIncident).add(transmittedIor.mul(cosTransmitted)), 1e-6));
  const rp = transmittedIor.mul(cosIncident).sub(incidentIor.mul(cosTransmitted))
    .div(max(transmittedIor.mul(cosIncident).add(incidentIor.mul(cosTransmitted)), 1e-6));
  return vec3(select(transmissionPossible, rs.mul(rs).add(rp.mul(rp)).mul(0.5), float(1)), select(transmissionPossible, float(0), float(1)), cosTransmitted);
}

function makeComputeNodes(owner) {
  const {
    resolution,
    causticResolution,
    stateA,
    stateB,
    normalCaustic,
    receiverCaustic,
    causticAccumulationNode,
    diagnosticBufferNode,
    eventSnapshotNode,
    probeBufferNode,
    uniforms,
    tier,
  } = owner;
  const cellCount = resolution * resolution;
  const causticCellCount = causticResolution * causticResolution;
  const linearWorkgroupSize = tier.linearWorkgroupSize;

  const texelCoord = Fn(() => uvec2(globalId.x.mod(uint(resolution)), globalId.x.div(uint(resolution))));
  const causticTexelCoord = Fn(() => uvec2(globalId.x.mod(uint(causticResolution)), globalId.x.div(uint(causticResolution))));
  const uvFromCoord = Fn(([coord]) => vec2(
    float(coord.x).add(0.5).div(uniforms.resolution),
    float(coord.y).add(0.5).div(uniforms.resolution),
  ));
  const worldFromUv = Fn(([coordUv]) => {
    const cells = max(uniforms.resolution.sub(1.0), 1.0);
    const gridIndex = coordUv.mul(uniforms.resolution).sub(0.5);
    return gridIndex.div(cells).sub(0.5).mul(uniforms.worldSize);
  });
  const boundaryMask = Fn(([coord]) => {
    const x = min(float(coord.x), uniforms.resolution.sub(1).sub(float(coord.x)));
    const y = min(float(coord.y), uniforms.resolution.sub(1).sub(float(coord.y)));
    return smoothstep(0.0, uniforms.boundaryFadeCells, min(x, y));
  });
  const slopeFromState = Fn(([stateTexture, coord]) => {
    const x = coord.x;
    const y = coord.y;
    const left = uvec2(max(x, uint(1)).sub(uint(1)), y);
    const right = uvec2(min(x.add(uint(1)), uint(resolution - 1)), y);
    const down = uvec2(x, max(y, uint(1)).sub(uint(1)));
    const up = uvec2(x, min(y.add(uint(1)), uint(resolution - 1)));
    const cells = max(uniforms.resolution.sub(1.0), 1.0);
    const dxMeters = uniforms.worldSize.x.div(cells);
    const dzMeters = uniforms.worldSize.y.div(cells);
    const xSpanCells = max(float(right.x.sub(left.x)), 1.0);
    const zSpanCells = max(float(up.y.sub(down.y)), 1.0);
    return vec2(
      textureLoad(stateTexture, right).r.sub(textureLoad(stateTexture, left).r).div(dxMeters.mul(xSpanCells)),
      textureLoad(stateTexture, up).r.sub(textureLoad(stateTexture, down).r).div(dzMeters.mul(zSpanCells)),
    );
  });
  const analyticSurfacePosition = Fn(([baseXZ]) => buildAnalyticWaveDisplacementTSL(
    baseXZ,
    uniforms.simulationTime,
    tier.analyticBands,
  ));
  const analyticTangentX = Fn(([baseXZ, dynamicSlope]) => {
    const tangent = vec3(1, dynamicSlope.x, 0).toVar();
    for (const wave of AUTHORED_WAVES.slice(0, tier.analyticBands)) {
      const direction = vec2(wave.direction.x, wave.direction.y);
      const k = float(TAU / wave.wavelength);
      const omega = float(Math.sqrt(9.81 * (TAU / wave.wavelength)));
      const phase = k.mul(dot(direction, baseXZ)).sub(omega.mul(uniforms.simulationTime));
      const horizontalDerivative = k.mul(wave.steepness * wave.amplitude).mul(sin(phase));
      const verticalDerivative = k.mul(wave.amplitude).mul(cos(phase));
      tangent.x.subAssign(horizontalDerivative.mul(direction.x).mul(direction.x));
      tangent.y.addAssign(verticalDerivative.mul(direction.x));
      tangent.z.subAssign(horizontalDerivative.mul(direction.x).mul(direction.y));
    }
    return tangent;
  });
  const analyticTangentZ = Fn(([baseXZ, dynamicSlope]) => {
    const tangent = vec3(0, dynamicSlope.y, 1).toVar();
    for (const wave of AUTHORED_WAVES.slice(0, tier.analyticBands)) {
      const direction = vec2(wave.direction.x, wave.direction.y);
      const k = float(TAU / wave.wavelength);
      const omega = float(Math.sqrt(9.81 * (TAU / wave.wavelength)));
      const phase = k.mul(dot(direction, baseXZ)).sub(omega.mul(uniforms.simulationTime));
      const horizontalDerivative = k.mul(wave.steepness * wave.amplitude).mul(sin(phase));
      const verticalDerivative = k.mul(wave.amplitude).mul(cos(phase));
      tangent.x.subAssign(horizontalDerivative.mul(direction.x).mul(direction.y));
      tangent.y.addAssign(verticalDerivative.mul(direction.y));
      tangent.z.subAssign(horizontalDerivative.mul(direction.y).mul(direction.y));
    }
    return tangent;
  });
  const combinedSurfaceHit = Fn(([stateTexture, coord]) => {
    const baseXZ = worldFromUv(uvFromCoord(coord));
    const state = textureLoad(stateTexture, coord);
    const slope = slopeFromState(stateTexture, coord);
    const tangentX = analyticTangentX(baseXZ, slope);
    const tangentZ = analyticTangentZ(baseXZ, slope);
    const surfaceNormal = normalize(cross(tangentZ, tangentX));
    const analyticPosition = analyticSurfacePosition(baseXZ);
    const surfacePosition = vec3(analyticPosition.x, analyticPosition.y.add(state.r), analyticPosition.z);
    const incident = normalize(vec3(-0.42, -1.0, -0.28));
    const cosineIncident = max(dot(incident.negate(), surfaceNormal), 0);
    const fresnelTerms = exactDielectricFresnelTSL(cosineIncident, float(1), float(1.333));
    const transmissionPossible = fresnelTerms.y.lessThan(0.5);
    const ray = vec3(0, -1, 0).toVar();
    If(transmissionPossible, () => {
      ray.assign(refract(incident, surfaceNormal, float(1 / 1.333)));
    });
    const rayLengthSquared = dot(ray, ray);
    const rayUsable = transmissionPossible
      .and(rayLengthSquared.greaterThan(1e-12))
      .and(ray.y.lessThan(uniforms.causticEpsilon.negate()));
    If(rayUsable, () => ray.assign(ray.div(sqrt(rayLengthSquared))));
    const travel = float(0).toVar();
    If(rayUsable, () => {
      travel.assign(float(0).sub(uniforms.causticReceiverDepthMeters).sub(surfacePosition.y).div(ray.y));
    });
    const valid = rayUsable.and(travel.greaterThan(0));
    const hit = surfacePosition.xz.add(ray.xz.mul(travel));
    const cells = max(uniforms.resolution.sub(1.0), 1.0);
    const differentialArea = length(cross(tangentZ, tangentX))
      .mul(uniforms.worldSize.x.div(cells))
      .mul(uniforms.worldSize.y.div(cells));
    const sourcePower = cosineIncident.mul(differentialArea)
      .mul(float(1).sub(fresnelTerms.x))
      .mul(uniforms.causticLightTransmission);
    return vec4(hit, select(valid, float(1), float(0)), select(valid, sourcePower, float(0)));
  });

  const resetDiagnostics = Fn(() => {
    const index = globalId.x;
    If(index.lessThan(uint(8)), () => { atomicStore(diagnosticBufferNode.element(index), uint(0)); });
  })().compute(8, [8]).setName("bounded-water:reset-diagnostics");
  const createClearTextureNode = (target, name) => Fn(() => {
    textureStore(target, texelCoord(), vec4(0, 0, 0, 0));
  })().compute(cellCount, [linearWorkgroupSize]).setName(name);
  const clearStateA = createClearTextureNode(stateA, "bounded-water:clear-state-a");
  const clearStateB = createClearTextureNode(stateB, "bounded-water:clear-state-b");
  const clearReceiverCaustic = Fn(() => {
    textureStore(receiverCaustic, causticTexelCoord(), vec4(0, 0, 0, 0));
  })().compute(causticCellCount, [linearWorkgroupSize]).setName("bounded-water:clear-receiver-caustic");
  const clearCausticAccumulation = Fn(() => {
    atomicStore(causticAccumulationNode.element(globalId.x), uint(0));
  })().compute(causticCellCount, [linearWorkgroupSize]).setName("bounded-water:clear-caustic-accumulation");

  const heightImpulseAtCoord = Fn(([coord]) => {
    const dropEvent = eventSnapshotNode.element(uint(0));
    const oldObjectEvent = eventSnapshotNode.element(uint(1));
    const newObjectEvent = eventSnapshotNode.element(uint(2));
    const eventMask = eventSnapshotNode.element(uint(3));
    const world = worldFromUv(uvFromCoord(coord));
    const dropDistance = world.sub(dropEvent.xy).length();
    const drop = max(float(0), float(1).sub(dropDistance.div(max(dropEvent.z, 0.0001)))).toVar();
    drop.assign(float(0.5).sub(cos(drop.mul(Math.PI)).mul(0.5)).mul(dropEvent.w));
    const oldT = vec3(world.x, 0, world.y).sub(oldObjectEvent.xyz).length().div(max(oldObjectEvent.w, 0.0001));
    const newT = vec3(world.x, 0, world.y).sub(newObjectEvent.xyz).length().div(max(oldObjectEvent.w, 0.0001));
    const objectImpulse = exp(oldT.mul(1.5).pow(6.0).negate()).sub(exp(newT.mul(1.5).pow(6.0).negate()))
      .mul(0.1).mul(newObjectEvent.w);
    const outsideMask = world.sub(eventMask.xy).length().greaterThanEqual(max(eventMask.z, 0));
    const maskAllowsEvent = eventMask.w.lessThan(0.5).or(outsideMask);
    return select(maskAllowsEvent, drop.add(objectImpulse), float(0));
  });
  const createPropagateWithImpulseNode = (readTexture, writeTexture, name) => Fn(() => {
    const coord = texelCoord();
    const x = coord.x;
    const y = coord.y;
    const left = uvec2(max(x, uint(1)).sub(uint(1)), y);
    const right = uvec2(min(x.add(uint(1)), uint(resolution - 1)), y);
    const down = uvec2(x, max(y, uint(1)).sub(uint(1)));
    const up = uvec2(x, min(y.add(uint(1)), uint(resolution - 1)));
    const info = textureLoad(readTexture, coord);
    const centerImpulse = heightImpulseAtCoord(coord);
    const centerHeight = info.r.add(centerImpulse);
    const leftHeight = textureLoad(readTexture, left).r.add(heightImpulseAtCoord(left));
    const rightHeight = textureLoad(readTexture, right).r.add(heightImpulseAtCoord(right));
    const downHeight = textureLoad(readTexture, down).r.add(heightImpulseAtCoord(down));
    const upHeight = textureLoad(readTexture, up).r.add(heightImpulseAtCoord(up));
    const cells = max(uniforms.resolution.sub(1.0), 1.0);
    const dxMeters = uniforms.worldSize.x.div(cells);
    const dzMeters = uniforms.worldSize.y.div(cells);
    const laplacian = leftHeight.sub(centerHeight.mul(2.0)).add(rightHeight).div(dxMeters.mul(dxMeters))
      .add(downHeight.sub(centerHeight.mul(2.0)).add(upHeight).div(dzMeters.mul(dzMeters)));
    const dampingFactor = exp(uniforms.dampingRatePerSecond.mul(uniforms.fixedTimeStep).mul(-2.0));
    const boundary = boundaryMask(coord);
    const rawVelocity = info.g.add(laplacian.mul(uniforms.waveSpeed.mul(uniforms.waveSpeed)).mul(uniforms.fixedTimeStep))
      .mul(dampingFactor).mul(boundary);
    const rawHeight = centerHeight.add(rawVelocity.mul(uniforms.fixedTimeStep)).mul(boundary);
    const finite = rawVelocity.equal(rawVelocity).and(rawHeight.equal(rawHeight))
      .and(abs(rawVelocity).lessThan(1e4)).and(abs(rawHeight).lessThan(1e4));
    If(finite.not(), () => { atomicAdd(diagnosticBufferNode.element(uint(7)), uint(1)); });
    const velocity = select(finite, rawVelocity, float(0));
    const height = select(finite, rawHeight, float(0));
    const historyDecay = exp(float(owner.parameters.impulseHistoryDecayRatePerSecond).mul(uniforms.fixedTimeStep).negate());
    const impulseHistory = max(info.b.mul(historyDecay), abs(centerImpulse));
    textureStore(writeTexture, coord, vec4(height, velocity, impulseHistory, boundary));
  })().compute(cellCount, [linearWorkgroupSize]).setName(name);
  const propagateWithImpulseAB = createPropagateWithImpulseNode(stateA, stateB, "bounded-water:propagate-with-impulse:a-to-b");
  const propagateWithImpulseBA = createPropagateWithImpulseNode(stateB, stateA, "bounded-water:propagate-with-impulse:b-to-a");

  const createNormalResolveNode = (stateTexture, name) => Fn(() => {
    const coord = texelCoord();
    const state = textureLoad(stateTexture, coord);
    const slope = slopeFromState(stateTexture, coord);
    const hit = combinedSurfaceHit(stateTexture, coord);
    textureStore(normalCaustic, coord, vec4(slope, hit.w, hit.z.mul(state.a)));
  })().compute(cellCount, [linearWorkgroupSize]).setName(name);
  const normalCausticFromA = createNormalResolveNode(stateA, "bounded-water:surface-differential:from-a");
  const normalCausticFromB = createNormalResolveNode(stateB, "bounded-water:surface-differential:from-b");

  const createCausticDepositNode = (stateTexture, name) => Fn(() => {
    const sourceHit = combinedSurfaceHit(stateTexture, texelCoord());
    const valid = sourceHit.z.greaterThan(0.5);
    If(valid.not(), () => { atomicAdd(diagnosticBufferNode.element(uint(0)), uint(1)); });
    const unclampedUnits = sourceHit.w.mul(uniforms.causticPowerUnitsPerWatt);
    const clampedUnits = min(unclampedUnits, uniforms.causticMaxUnitsPerSource);
    If(unclampedUnits.greaterThan(uniforms.causticMaxUnitsPerSource), () => {
      atomicAdd(diagnosticBufferNode.element(uint(2)), uint(1));
    });
    const sourceUnits = clampedUnits.add(0.5).toUint();
    If(valid, () => { atomicAdd(diagnosticBufferNode.element(uint(4)), sourceUnits); });
    const receiverGrid = sourceHit.xy.div(uniforms.worldSize).add(0.5).mul(uniforms.causticResolution.sub(1));
    const base = floor(receiverGrid).toVar();
    const fraction = receiverGrid.sub(base);
    for (let offsetY = 0; offsetY <= 1; offsetY += 1) {
      for (let offsetX = 0; offsetX <= 1; offsetX += 1) {
        const targetX = base.x.toInt().add(int(offsetX));
        const targetY = base.y.toInt().add(int(offsetY));
        const inBounds = targetX.greaterThanEqual(0).and(targetX.lessThan(int(causticResolution)))
          .and(targetY.greaterThanEqual(0)).and(targetY.lessThan(int(causticResolution)));
        const weightX = offsetX === 0 ? float(1).sub(fraction.x) : fraction.x;
        const weightY = offsetY === 0 ? float(1).sub(fraction.y) : fraction.y;
        const weightedUnits = float(sourceUnits).mul(weightX.mul(weightY)).add(0.5).toUint();
        If(valid.and(inBounds).and(weightedUnits.greaterThan(uint(0))), () => {
          const linearIndex = targetY.toUint().mul(uint(causticResolution)).add(targetX.toUint());
          atomicAdd(causticAccumulationNode.element(linearIndex), weightedUnits);
          atomicAdd(diagnosticBufferNode.element(uint(3)), uint(1));
          atomicAdd(diagnosticBufferNode.element(uint(5)), weightedUnits);
        });
        If(valid.and(inBounds.not()).and(weightedUnits.greaterThan(uint(0))), () => {
          atomicAdd(diagnosticBufferNode.element(uint(1)), weightedUnits);
        });
      }
    }
  })().compute(cellCount, [linearWorkgroupSize]).setName(name);
  const causticDepositFromA = createCausticDepositNode(stateA, "bounded-water:caustic-deposit:from-a");
  const causticDepositFromB = createCausticDepositNode(stateB, "bounded-water:caustic-deposit:from-b");
  const resolveReceiverCaustic = Fn(() => {
    const coord = causticTexelCoord();
    const units = atomicLoad(causticAccumulationNode.element(globalId.x));
    const cells = max(uniforms.causticResolution.sub(1), 1);
    const receiverCellArea = uniforms.worldSize.x.div(cells).mul(uniforms.worldSize.y.div(cells));
    const regularizedArea = max(receiverCellArea, uniforms.causticFootprintAreaEpsilonMeters2);
    const depositedPower = float(units).div(uniforms.causticPowerUnitsPerWatt);
    const irradiance = clamp(depositedPower.div(regularizedArea).mul(uniforms.causticScale), 0, uniforms.causticMaxIntensity);
    If(units.greaterThan(uint(0)), () => { atomicAdd(diagnosticBufferNode.element(uint(6)), units); });
    textureStore(receiverCaustic, coord, vec4(irradiance, depositedPower, regularizedArea, select(units.greaterThan(uint(0)), float(1), float(0))));
  })().compute(causticCellCount, [linearWorkgroupSize]).setName("bounded-water:resolve-receiver-caustic");

  const createProbeNode = (stateTexture, name) => Fn(() => {
    const probeIndex = globalId.x;
    const coordinate = probeIndex.mul(uint(resolution - 1)).div(uint(3));
    const coord = uvec2(coordinate, uint(resolution - 1).sub(coordinate));
    const receiverCoordinate = probeIndex.mul(uint(causticResolution - 1)).div(uint(3));
    const receiverCoord = uvec2(receiverCoordinate, uint(causticResolution - 1).sub(receiverCoordinate));
    const state = textureLoad(stateTexture, coord);
    const receiver = textureLoad(receiverCaustic, receiverCoord);
    probeBufferNode.element(probeIndex).assign(vec4(state.r, state.g, receiver.r, receiver.g));
  })().compute(4, [4]).setName(name);
  const probeFromA = createProbeNode(stateA, "bounded-water:probe:from-a");
  const probeFromB = createProbeNode(stateB, "bounded-water:probe:from-b");

  return {
    clearStateA,
    clearStateB,
    clearReceiverCaustic,
    clearCausticAccumulation,
    resetDiagnostics,
    propagateWithImpulseAB,
    propagateWithImpulseBA,
    normalCausticFromA,
    normalCausticFromB,
    causticDepositFromA,
    causticDepositFromB,
    resolveReceiverCaustic,
    probeFromA,
    probeFromB,
  };
}

export class WebGPUBoundedWaterHeightfield {
  constructor(renderer, options = {}) {
    const tierName = options.tier ?? "high";
    if (!WATER_QUALITY_TIERS[tierName]) {
      throw new Error(`Unknown bounded-water quality tier "${tierName}".`);
    }
    if (options.tierOverrides !== undefined || options.resolution !== undefined) {
      throw new Error("Canonical bounded-water tiers are locked; tierOverrides/resolution drift is forbidden.");
    }
    this.renderer = renderer;
    this.tier = { ...WATER_QUALITY_TIERS[tierName] };
    this.resolution = this.tier.resolution;
    this.causticResolution = this.tier.causticResolution;
    this.parameters = {
      ...DEFAULT_WATER_PARAMETERS,
      ...(options.parameters ?? {}),
      worldSize: cloneVector2(options.parameters?.worldSize ?? DEFAULT_WATER_PARAMETERS.worldSize),
      eventMaskCenter: cloneVector2(options.parameters?.eventMaskCenter ?? DEFAULT_WATER_PARAMETERS.eventMaskCenter),
      absorptionCoefficientPerMeter: cloneVector3(options.parameters?.absorptionCoefficientPerMeter ?? DEFAULT_WATER_PARAMETERS.absorptionCoefficientPerMeter),
      sunDirection: cloneVector3(options.parameters?.sunDirection ?? DEFAULT_WATER_PARAMETERS.sunDirection),
      deepBodyColor: cloneVector3(options.parameters?.deepBodyColor ?? DEFAULT_WATER_PARAMETERS.deepBodyColor),
      shallowScatterColor: cloneVector3(options.parameters?.shallowScatterColor ?? DEFAULT_WATER_PARAMETERS.shallowScatterColor),
      foamColor: cloneVector3(options.parameters?.foamColor ?? DEFAULT_WATER_PARAMETERS.foamColor),
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
    this.droppedTimeSeconds = 0;
    this.simulationTime = 0;
    this.fixedStepIndex = 0;
    this.lastCausticResolveFixedStep = 0;
    this.causticResolveCount = 0;
    this.causticsEnabled = options.causticsEnabled ?? true;

    this.stateA = createWaterStorageTexture(this.resolution, this.resolution, "bounded-water-state-a", { linearSampling: true });
    this.stateB = createWaterStorageTexture(this.resolution, this.resolution, "bounded-water-state-b", { linearSampling: true });
    this.normalCaustic = createSampledDebugTexture(this.resolution, this.resolution, "bounded-water-normal-caustic");
    this.receiverCaustic = createSampledDebugTexture(this.causticResolution, this.causticResolution, "bounded-water-receiver-caustic");
    this.causticAccumulationBuffer = new StorageBufferAttribute(this.causticResolution * this.causticResolution, 1, Uint32Array);
    this.causticAccumulationBuffer.name = "bounded-water-caustic-atomic-accumulation";
    this.causticAccumulationNode = storage(this.causticAccumulationBuffer, "uint", this.causticResolution * this.causticResolution).toAtomic();
    this.diagnosticBuffer = new StorageBufferAttribute(8, 1, Uint32Array);
    this.diagnosticBuffer.name = "bounded-water-diagnostics";
    this.diagnosticBufferNode = storage(this.diagnosticBuffer, "uint", 8).toAtomic();
    this.eventSnapshotBuffer = new StorageBufferAttribute(new Float32Array(16), 4);
    this.eventSnapshotBuffer.name = "bounded-water-event-snapshot";
    this.eventSnapshotNode = storage(this.eventSnapshotBuffer, "vec4", 4).toReadOnly();
    this.probeBuffer = new StorageBufferAttribute(new Float32Array(16), 4);
    this.probeBuffer.name = "bounded-water-gpu-probes";
    this.probeBufferNode = storage(this.probeBuffer, "vec4", 4);
    this.eventSnapshotVersion = 0;
    this.lastEventSnapshot = null;
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
      droppedTimeSeconds: this.droppedTimeSeconds,
      storageBytes: boundedWaterPersistentBytes(this.resolution, this.causticResolution),
      causticResolution: this.causticResolution,
      causticUpdateEverySimulationSteps: this.tier.causticUpdateEverySimulationSteps,
      causticResolveCount: this.causticResolveCount,
      eventSnapshotBytes: this.eventSnapshotBuffer.array.byteLength,
      eventSnapshotVersion: this.eventSnapshotVersion,
      causticQuantization: boundedCausticQuantizationContract(this.resolution),
      diagnosticLayout: [
        "invalid-or-tir-source-count",
        "out-of-domain-power-units",
        "source-power-saturation-count",
        "atomic-deposit-count",
        "source-power-units",
        "deposited-power-units",
        "resolved-power-units",
        "nonfinite-state-count",
      ],
    };
  }

  initialize() {
    safeRendererCompute(this.renderer, [
      this.computeNodes.clearStateA,
      this.computeNodes.clearStateB,
      this.computeNodes.clearReceiverCaustic,
      this.computeNodes.clearCausticAccumulation,
      this.computeNodes.resetDiagnostics,
      this.computeNodes.normalCausticFromA,
      ...(this.causticsEnabled ? [this.computeNodes.causticDepositFromA, this.computeNodes.resolveReceiverCaustic] : []),
    ]);
    this.dispatchCount += this.causticsEnabled ? 8 : 6;
    if (this.causticsEnabled) this.causticResolveCount += 1;
  }

  setDrop({ x, z, radius = this.parameters.dropRadius, strength = this.parameters.dropStrength }) {
    if (![x, z, radius, strength].every(Number.isFinite) || radius <= 0) {
      throw new Error("Bounded-water drops require finite x/z/strength and a positive finite radius.");
    }
    if (radius > Math.min(this.parameters.worldSize.x, this.parameters.worldSize.y) * 0.5
        || Math.abs(strength) > Math.min(this.parameters.worldSize.x, this.parameters.worldSize.y) * 0.25) {
      throw new Error("Bounded-water drop radius/strength exceeds the authored finite event domain.");
    }
    if (Math.abs(x) > this.parameters.worldSize.x * 0.5 || Math.abs(z) > this.parameters.worldSize.y * 0.5) {
      throw new Error("Bounded-water drop center lies outside the simulation domain.");
    }
    this.pendingDrop = { x, z, radius, strength };
  }

  setObjectImpulse({
    oldCenter,
    newCenter,
    radius = this.parameters.objectRadius,
    strength = this.parameters.objectDisplacementScale,
  }) {
    const values = [oldCenter?.x, oldCenter?.y, oldCenter?.z, newCenter?.x, newCenter?.y, newCenter?.z, radius, strength];
    if (!values.every(Number.isFinite) || radius <= 0) {
      throw new Error("Bounded-water object impulses require finite centers/strength and a positive finite radius.");
    }
    if (radius > Math.min(this.parameters.worldSize.x, this.parameters.worldSize.y) * 0.5
        || Math.abs(strength) > Math.min(this.parameters.worldSize.x, this.parameters.worldSize.y) * 0.25) {
      throw new Error("Bounded-water object radius/strength exceeds the authored finite event domain.");
    }
    for (const center of [oldCenter, newCenter]) {
      if (Math.abs(center.x) > this.parameters.worldSize.x * 0.5 || Math.abs(center.z) > this.parameters.worldSize.y * 0.5) {
        throw new Error("Bounded-water object impulse center lies outside the simulation domain.");
      }
    }
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

  snapshotPendingEvents() {
    const drop = Object.freeze({ ...this.pendingDrop });
    const impulse = Object.freeze({
      oldCenter: Object.freeze({
        x: this.pendingImpulse.oldCenter.x,
        y: this.pendingImpulse.oldCenter.y,
        z: this.pendingImpulse.oldCenter.z,
      }),
      newCenter: Object.freeze({
        x: this.pendingImpulse.newCenter.x,
        y: this.pendingImpulse.newCenter.y,
        z: this.pendingImpulse.newCenter.z,
      }),
      radius: this.pendingImpulse.radius,
      strength: this.pendingImpulse.strength,
    });
    const values = this.eventSnapshotBuffer.array;
    values.set([
      drop.x, drop.z, drop.radius, drop.strength,
      impulse.oldCenter.x, impulse.oldCenter.y, impulse.oldCenter.z, impulse.radius,
      impulse.newCenter.x, impulse.newCenter.y, impulse.newCenter.z, impulse.strength,
      this.parameters.eventMaskCenter.x,
      this.parameters.eventMaskCenter.y,
      this.parameters.eventMaskRadiusMeters,
      this.parameters.eventMaskEnabled ? 1 : 0,
    ]);
    this.eventSnapshotBuffer.needsUpdate = true;
    this.eventSnapshotVersion += 1;
    this.lastEventSnapshot = Object.freeze({ version: this.eventSnapshotVersion, drop, impulse });
    return this.lastEventSnapshot;
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

  runFixedStep() {
    this.snapshotPendingEvents();
    this.simulationTime += this.fixedTimeStep;
    this.fixedStepIndex += 1;
    this.uniforms.simulationTime.value = this.simulationTime;

    const propagateNode = this.readIndex === 0
      ? this.computeNodes.propagateWithImpulseAB
      : this.computeNodes.propagateWithImpulseBA;

    // Both submissions are synchronous command-encoding calls. The propagation
    // kernel reads the immutable eventSnapshotBuffer uploaded immediately
    // before this call, so clearing pending CPU events cannot erase the impulse.
    safeRendererCompute(this.renderer, propagateNode);
    this.readIndex = 1 - this.readIndex;
    this.dispatchCount += 1;
    this.resetImpulseUniforms();
  }

  resolveDerivedFields() {
    const normalNode = this.readIndex === 0
      ? this.computeNodes.normalCausticFromA
      : this.computeNodes.normalCausticFromB;
    safeRendererCompute(this.renderer, normalNode);
    this.dispatchCount += 1;
    if (!this.causticsEnabled) return false;
    if (this.fixedStepIndex - this.lastCausticResolveFixedStep < this.tier.causticUpdateEverySimulationSteps) return false;
    safeRendererCompute(this.renderer, this.computeNodes.clearCausticAccumulation);
    const depositNode = this.readIndex === 0
      ? this.computeNodes.causticDepositFromA
      : this.computeNodes.causticDepositFromB;
    safeRendererCompute(this.renderer, depositNode);
    safeRendererCompute(this.renderer, this.computeNodes.resolveReceiverCaustic);
    this.dispatchCount += 3;
    this.lastCausticResolveFixedStep = this.fixedStepIndex;
    this.causticResolveCount += 1;
    return true;
  }

  setCausticsEnabled(enabled) {
    if (enabled !== true && enabled !== false) throw new Error("causticsEnabled must be boolean.");
    const wasEnabled = this.causticsEnabled;
    this.causticsEnabled = enabled;
    if (!enabled) {
      safeRendererCompute(this.renderer, [this.computeNodes.clearCausticAccumulation, this.computeNodes.clearReceiverCaustic]);
      this.dispatchCount += 2;
    }
    if (enabled && !wasEnabled) {
      this.lastCausticResolveFixedStep = this.fixedStepIndex - this.tier.causticUpdateEverySimulationSteps;
    }
  }

  step(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new Error(`Bounded-water step requires a non-negative finite deltaSeconds; got ${deltaSeconds}.`);
    }
    const accumulatorLimit = this.fixedTimeStep * this.maxSubsteps;
    const incomingAccumulator = this.accumulator + deltaSeconds;
    this.droppedTimeSeconds += Math.max(0, incomingAccumulator - accumulatorLimit);
    this.accumulator = Math.min(incomingAccumulator, accumulatorLimit);
    const steps = Math.min(this.maxSubsteps, Math.floor((this.accumulator + 1e-12) / this.fixedTimeStep));
    this.lastStepCount = steps;

    if (steps > 0) {
      safeRendererCompute(this.renderer, this.computeNodes.resetDiagnostics);
      this.dispatchCount += 1;
    }

    for (let i = 0; i < steps; i += 1) {
      this.runFixedStep();
    }

    if (steps > 0) this.resolveDerivedFields();

    this.accumulator = Math.max(0, this.accumulator - steps * this.fixedTimeStep);
    return undefined;
  }

  describeResources() {
    const textures = [this.stateA, this.stateB, this.normalCaustic, this.receiverCaustic].map((texture) => ({
      name: texture.name,
      kind: "storage-texture",
      width: texture.image.width,
      height: texture.image.height,
      bytes: texture.image.width * texture.image.height * 8,
    }));
    const buffers = [this.causticAccumulationBuffer, this.eventSnapshotBuffer, this.diagnosticBuffer, this.probeBuffer]
      .map((buffer) => ({ name: buffer.name, kind: "storage-buffer", bytes: buffer.array.byteLength }));
    return { textures, buffers, totalBytes: [...textures, ...buffers].reduce((total, resource) => total + resource.bytes, 0) };
  }

  describeDispatches() {
    return {
      initialization: this.causticsEnabled
        ? ["clear-state-a", "clear-state-b", "clear-receiver-caustic", "clear-caustic-atomic-buffer", "reset-diagnostics", "surface-differential", "source-caustic-deposit", "receiver-caustic-resolve"]
        : ["clear-state-a", "clear-state-b", "clear-receiver-caustic", "clear-caustic-atomic-buffer", "reset-diagnostics", "surface-differential"],
      perUpdate: {
        resetDiagnostics: 1,
        perFixedStep: { propagation: 1 },
        afterFixedSteps: this.causticsEnabled
          ? { derivativeResolve: 1, clearCausticAtomicBuffer: 1, sourceCausticDeposit: 1, receiverCausticResolve: 1 }
          : { derivativeResolve: 1 },
      },
      lastStepCount: this.lastStepCount,
      fixedStepIndex: this.fixedStepIndex,
      causticResolveCount: this.causticResolveCount,
      causticUpdateEverySimulationSteps: this.tier.causticUpdateEverySimulationSteps,
      causticResolution: this.causticResolution,
      cumulativeDispatchCount: this.dispatchCount,
      receiverDeposition: "source-driven four-tap bilinear atomic deposition; no bounded gather",
      causticQuantization: boundedCausticQuantizationContract(this.resolution),
    };
  }

  async captureGpuState() {
    if (typeof this.renderer.getArrayBufferAsync !== "function") {
      throw new Error("The active renderer cannot provide diagnostic storage-buffer readback.");
    }
    const probeNode = this.readIndex === 0 ? this.computeNodes.probeFromA : this.computeNodes.probeFromB;
    safeRendererCompute(this.renderer, probeNode);
    this.dispatchCount += 1;
    const [probe, diagnostics] = await Promise.all([
      this.renderer.getArrayBufferAsync(this.probeBuffer, null, 0, this.probeBuffer.array.byteLength),
      this.renderer.getArrayBufferAsync(this.diagnosticBuffer, null, 0, this.diagnosticBuffer.array.byteLength),
    ]);
    return {
      layout: {
        probes: ["heightMeters", "velocityMetersPerSecond", "receiverIrradiance", "depositedPowerWatts"],
        diagnostics: this.diagnostics.diagnosticLayout,
      },
      probes: Array.from(new Float32Array(probe)),
      diagnostics: Array.from(new Uint32Array(diagnostics)),
      simulationTime: this.simulationTime,
      readIndex: this.readIndex,
      eventSnapshotVersion: this.eventSnapshotVersion,
    };
  }

  dispose() {
    for (const computeNode of Object.values(this.computeNodes)) {
      computeNode.dispose?.();
    }
    this.stateA.dispose();
    this.stateB.dispose();
    this.normalCaustic.dispose();
    this.receiverCaustic.dispose();
    this.causticAccumulationBuffer.dispose();
    this.diagnosticBuffer.dispose();
    this.eventSnapshotBuffer.dispose();
    this.probeBuffer.dispose();
  }
}

export function createBoundedWaterMaterial({
  heightfield,
  timeNode = float(0),
  debugMode = WATER_DEBUG_MODES.final,
  parameters = DEFAULT_WATER_PARAMETERS,
  analyticBandCount = AUTHORED_WAVES.length,
  microBandCount = 4,
  sceneColorNode = null,
  sceneDepthNode = null,
  opticalTransportEnabled = sceneColorNode !== null && sceneDepthNode !== null,
  receiverCausticsEnabled = true,
} = {}) {
  // Without host opaque color/depth this is an authored radiance preview. With
  // both nodes it validates a projected refracted-ray candidate in view space
  // before using its color or metric path length.
  const material = new MeshBasicNodeMaterial({
    side: DoubleSide,
    transparent: false,
    depthWrite: true,
  });

  const waterState = texture(heightfield.currentTexture);
  const normalCaustic = texture(heightfield.normalCaustic);
  const receiverCaustic = texture(heightfield.receiverCaustic);
  const debugModeNode = uniform(debugMode, "int");
  const opticalTransportEnabledNode = uniform(opticalTransportEnabled ? 1 : 0, "float");
  const receiverCausticsEnabledNode = uniform(receiverCausticsEnabled ? 1 : 0, "float");
  const worldSize = vec2(parameters.worldSize.x, parameters.worldSize.y);
  const gridResolution = float(heightfield.resolution);
  const gridCells = float(Math.max(1, heightfield.resolution - 1));
  const sunDirection = vec3(parameters.sunDirection.x, parameters.sunDirection.y, parameters.sunDirection.z);
  const deepBody = vec3(parameters.deepBodyColor.x, parameters.deepBodyColor.y, parameters.deepBodyColor.z);
  const shallowScatter = vec3(parameters.shallowScatterColor.x, parameters.shallowScatterColor.y, parameters.shallowScatterColor.z);
  const foamColor = vec3(parameters.foamColor.x, parameters.foamColor.y, parameters.foamColor.z);
  const absorption = vec3(
    parameters.absorptionCoefficientPerMeter.x,
    parameters.absorptionCoefficientPerMeter.y,
    parameters.absorptionCoefficientPerMeter.z,
  );

  const surfaceUvFromLocal = Fn(([localXZ]) => {
    const gridIndex = localXZ.div(worldSize).add(0.5).mul(gridCells);
    return gridIndex.add(0.5).div(gridResolution);
  });

  const sampledState = Fn(([localXZ]) => {
    return texture(waterState, surfaceUvFromLocal(localXZ));
  });

  const sampledNormalCaustic = Fn(([localXZ]) => {
    return texture(normalCaustic, surfaceUvFromLocal(localXZ));
  });

  const sampledReceiverCaustic = Fn(([localXZ]) => {
    return texture(receiverCaustic, surfaceUvFromLocal(localXZ));
  });

  material.positionNode = Fn(() => {
    const baseXZ = positionGeometry.xz;
    const state = sampledState(baseXZ);
    const analytic = buildAnalyticWaveDisplacementTSL(baseXZ, timeNode, analyticBandCount);
    return vec3(
      analytic.x,
      analytic.y.add(state.r),
      analytic.z,
    );
  })();

  const waterOutput = Fn(() => {
    const localXZ = positionGeometry.xz;
    const state = sampledState(localXZ).toVar();
    const packedNormal = sampledNormalCaustic(localXZ).toVar();
    const surfaceNormalCrest = buildSurfaceNormalAndCrestTSL(
      localXZ,
      positionWorld.xz,
      packedNormal.rg,
      timeNode,
      analyticBandCount,
      microBandCount,
    ).toVar();
    const geometricNormal = normalize(modelNormalMatrix.mul(surfaceNormalCrest.xyz));

    const viewDirection = normalize(cameraPosition.sub(positionWorld));
    const underwater = dot(geometricNormal, viewDirection).lessThan(0);
    const interfaceNormal = select(underwater, geometricNormal.negate(), geometricNormal).toVar();
    const incidentIor = select(underwater, float(parameters.waterIor), float(parameters.airIor));
    const transmittedIor = select(underwater, float(parameters.airIor), float(parameters.waterIor));
    const eta = incidentIor.div(transmittedIor);
    const cosIncident = clamp(dot(interfaceNormal, viewDirection), 0, 1);
    const fresnelTerms = exactDielectricFresnelTSL(cosIncident, incidentIor, transmittedIor);
    const fresnel = fresnelTerms.x;
    const transmissionPossible = fresnelTerms.y.lessThan(0.5);
    const cosTransmitted = fresnelTerms.z;
    const bodySource = mix(deepBody, shallowScatter, clamp(interfaceNormal.y, 0, 1));
    const transmission = exp(absorption.mul(-parameters.previewPathLengthMeters)).toVar();
    const bodyRadiancePreview = transmission.mul(bodySource)
      .add(float(1).sub(transmission).mul(shallowScatter)).toVar();
    const opticalValid = float(0).toVar();
    const opticalPathLength = float(parameters.previewPathLengthMeters).toVar();
    const opticalCrossTrack = float(-1).toVar();

    if (sceneColorNode && sceneDepthNode) {
      // TIR is classified before refract/normalize/project. This branch is
      // normative: a zero refracted vector never reaches normalize().
      If(transmissionPossible.and(opticalTransportEnabledNode.greaterThan(0.5)), () => {
        const refractedWorldRaw = refract(viewDirection.negate(), interfaceNormal, eta);
        const refractedWorldLengthSquared = dot(refractedWorldRaw, refractedWorldRaw);
        If(refractedWorldLengthSquared.greaterThan(1e-12), () => {
          const refractedWorld = refractedWorldRaw.div(sqrt(refractedWorldLengthSquared));
          const refractedViewRaw = cameraViewMatrix.transformDirection(refractedWorld);
          const refractedViewLengthSquared = dot(refractedViewRaw, refractedViewRaw);
          If(refractedViewLengthSquared.greaterThan(1e-12), () => {
            const refractedView = refractedViewRaw.div(sqrt(refractedViewLengthSquared));
            const probeViewPosition = positionView.add(refractedView.mul(parameters.refractionProbeDistanceMeters));
            const candidateUv = getScreenPosition(probeViewPosition, cameraProjectionMatrix);
            const onViewport = candidateUv.x.greaterThanEqual(0).and(candidateUv.x.lessThanEqual(1))
              .and(candidateUv.y.greaterThanEqual(0)).and(candidateUv.y.lessThanEqual(1));
            If(onViewport, () => {
              const candidateDepth = sceneDepthNode.sample(candidateUv).r;
              const sampledViewPosition = getViewPosition(candidateUv, candidateDepth, cameraProjectionMatrixInverse);
              const deltaToSample = sampledViewPosition.sub(positionView);
              const pathLength = dot(deltaToSample, refractedView);
              const crossTrack = length(deltaToSample.sub(refractedView.mul(pathLength)));
              const behindWater = sampledViewPosition.z.lessThan(positionView.z.sub(parameters.refractionForegroundEpsilonMeters));
              const rayForward = pathLength.greaterThan(0);
              const rayResidualValid = crossTrack.lessThanEqual(parameters.refractionMaxCrossTrackMeters);
              const validCandidate = behindWater.and(rayForward).and(rayResidualValid);
              opticalCrossTrack.assign(crossTrack);
              If(validCandidate, () => {
                opticalValid.assign(1);
                opticalPathLength.assign(pathLength);
                transmission.assign(exp(absorption.mul(pathLength.negate())));
                const refractedBackground = sceneColorNode.sample(candidateUv).rgb;
                bodyRadiancePreview.assign(transmission.mul(refractedBackground)
                  .add(float(1).sub(transmission).mul(shallowScatter)));
              });
            });
          });
        });
      });
    }

    const reflected = reflect(viewDirection.negate(), interfaceNormal);
    const reflection = buildSkyColorTSL(reflected, sunDirection);
    const crest = max(surfaceNormalCrest.w, state.b);
    const foam = smoothstep(0.05, 0.45, crest.mul(1.1));
    const receiverCausticSample = sampledReceiverCaustic(localXZ);
    const caustic = receiverCausticSample.r.mul(receiverCausticSample.a).mul(receiverCausticsEnabledNode);

    const colorValue = reflection.mul(fresnel).add(bodyRadiancePreview.mul(float(1).sub(fresnel)));
    const finalColor = mix(colorValue, foamColor, foam);

    If(debugModeNode.equal(WATER_DEBUG_MODES.height), () => {
      finalColor.assign(mix(vec3(0.03, 0.08, 0.14), vec3(0.8, 0.25, 0.08), clamp(state.r.mul(5.0).add(0.5), 0, 1)));
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES.velocity), () => {
      finalColor.assign(vec3(abs(state.g).mul(12.0)));
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES.normals), () => {
      finalColor.assign(interfaceNormal.mul(0.5).add(0.5));
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES.caustics), () => {
      finalColor.assign(vec3(caustic.div(parameters.causticMaxIntensity)));
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES["fresnel-and-tir"]), () => {
      finalColor.assign(vec3(fresnel, select(transmissionPossible, float(0), float(1)), cosTransmitted));
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES.absorption), () => {
      finalColor.assign(transmission);
    }).ElseIf(debugModeNode.equal(WATER_DEBUG_MODES["optical-transport-unavailable"]), () => {
      finalColor.assign(mix(vec3(0.75, 0.06, 0.02), vec3(0.03, 0.65, 0.22), opticalValid));
    });

    return vec4(finalColor, 1);
  });

  material.outputNode = waterOutput();
  material.userData.waterStateTextureNode = waterState;
  material.userData.normalCausticTextureNode = normalCaustic;
  material.userData.receiverCausticTextureNode = receiverCaustic;
  material.userData.opticalValidation = {
    available: sceneColorNode !== null && sceneDepthNode !== null,
    sceneColorNode,
    sceneDepthNode,
  };
  material.userData.claimBoundary = WATER_EXAMPLE_CLAIM_BOUNDARY;
  material.userData.requiredObjectTransform = "translation-only; identity rotation and scale so local simulation axes remain world XZ";
  material.userData.debugModeNode = debugModeNode;
  material.userData.opticalTransportEnabledNode = opticalTransportEnabledNode;
  material.userData.receiverCausticsEnabledNode = receiverCausticsEnabledNode;
  material.userData.setDebugMode = (mode) => {
    const resolved = typeof mode === "string" ? WATER_DEBUG_MODES[mode] : mode;
    if (!Object.values(WATER_DEBUG_MODES).includes(resolved)) {
      throw new Error(`Unknown bounded-water debug mode "${mode}".`);
    }
    debugModeNode.value = resolved;
  };
  material.userData.setMechanismFeatures = ({ opticalTransport, receiverCaustics }) => {
    if (opticalTransport !== true && opticalTransport !== false) throw new Error("opticalTransport feature flag must be boolean.");
    if (receiverCaustics !== true && receiverCaustics !== false) throw new Error("receiverCaustics feature flag must be boolean.");
    if (opticalTransport && (!sceneColorNode || !sceneDepthNode)) {
      throw new Error("Optical transport cannot be enabled without host opaque color and depth nodes.");
    }
    opticalTransportEnabledNode.value = opticalTransport ? 1 : 0;
    receiverCausticsEnabledNode.value = receiverCaustics ? 1 : 0;
    heightfield.setCausticsEnabled(receiverCaustics);
  };
  material.userData.syncSimulationTextures = () => {
    waterState.value = heightfield.currentTexture;
    normalCaustic.value = heightfield.normalCaustic;
    receiverCaustic.value = heightfield.receiverCaustic;
  };

  return material;
}

export function createBoundedWaterMesh({
  heightfield,
  width = heightfield.parameters.worldSize.x,
  depth = heightfield.parameters.worldSize.y,
  segments = heightfield.tier.meshSegments,
  material = createBoundedWaterMaterial({ heightfield }),
} = {}) {
  if (width !== heightfield.parameters.worldSize.x || depth !== heightfield.parameters.worldSize.y) {
    throw new Error("Bounded-water mesh extents must equal the node-centred simulation worldSize.");
  }
  if (!Number.isInteger(segments) || segments < 1) {
    throw new Error(`Bounded-water mesh segments must be a positive integer; got ${segments}.`);
  }

  const geometry = new PlaneGeometry(width, depth, segments, segments);
  geometry.rotateX(-Math.PI * 0.5);
  const mesh = new Mesh(geometry, material);
  mesh.name = "WebGPU bounded water surface";
  // The live forced grid has no enforced amplitude envelope. Any finite manual
  // bound can cull valid displacement, so this scaffold disables frustum
  // culling until a measured/enforced envelope exists.
  mesh.frustumCulled = false;
  mesh.userData.geometryBytes = Object.values(geometry.attributes)
    .reduce((bytes, attribute) => bytes + attribute.array.byteLength, geometry.index?.array.byteLength ?? 0);
  return mesh;
}

export async function createWebGPUBoundedWaterSystem(renderer, {
  tier = "high",
  seed = 1,
  timeNode = float(0),
  debugMode = WATER_DEBUG_MODES.final,
  parameters = {},
  opticalInputs = null,
  causticsEnabled = true,
  opticalTransportEnabled = Boolean(opticalInputs?.sceneColorNode && opticalInputs?.sceneDepthNode),
} = {}) {
  await renderer.init();

  const backendIsWebGPU = renderer.backend?.isWebGPUBackend === true;
  const selectedTierName = tier;
  if (!WATER_QUALITY_TIERS[selectedTierName]) {
    throw new Error(`Unknown bounded-water quality tier "${selectedTierName}".`);
  }
  const resolvedParameters = {
    ...DEFAULT_WATER_PARAMETERS,
    ...parameters,
    worldSize: cloneVector2(parameters.worldSize ?? DEFAULT_WATER_PARAMETERS.worldSize),
    eventMaskCenter: cloneVector2(parameters.eventMaskCenter ?? DEFAULT_WATER_PARAMETERS.eventMaskCenter),
    absorptionCoefficientPerMeter: cloneVector3(parameters.absorptionCoefficientPerMeter ?? DEFAULT_WATER_PARAMETERS.absorptionCoefficientPerMeter),
    sunDirection: cloneVector3(parameters.sunDirection ?? DEFAULT_WATER_PARAMETERS.sunDirection),
    deepBodyColor: cloneVector3(parameters.deepBodyColor ?? DEFAULT_WATER_PARAMETERS.deepBodyColor),
    shallowScatterColor: cloneVector3(parameters.shallowScatterColor ?? DEFAULT_WATER_PARAMETERS.shallowScatterColor),
    foamColor: cloneVector3(parameters.foamColor ?? DEFAULT_WATER_PARAMETERS.foamColor),
  };

  if (!backendIsWebGPU) {
    throw new Error("WebGPU backend required for the bounded-water integration scaffold.");
  }

  if (opticalTransportEnabled && (!opticalInputs?.sceneColorNode || !opticalInputs?.sceneDepthNode)) {
    throw new Error("Enabled bounded-water optical transport requires host opaque color and depth nodes.");
  }
  const heightfield = new WebGPUBoundedWaterHeightfield(renderer, {
    tier: selectedTierName,
    parameters: resolvedParameters,
    causticsEnabled,
  });
  heightfield.initialize();

  const material = createBoundedWaterMaterial({
    heightfield,
    timeNode,
    debugMode,
    parameters: heightfield.parameters,
    analyticBandCount: heightfield.tier.analyticBands,
    microBandCount: heightfield.tier.microBands,
    sceneColorNode: opticalInputs?.sceneColorNode ?? null,
    sceneDepthNode: opticalInputs?.sceneDepthNode ?? null,
    opticalTransportEnabled,
    receiverCausticsEnabled: causticsEnabled,
  });
  const mesh = createBoundedWaterMesh({ heightfield, material });
  const heightQuery = createBoundedWaterHeightQuery({
    analyticBandCount: heightfield.tier.analyticBands,
    parameters: heightfield.parameters,
  });
  mesh.userData.opticalTransport = opticalTransportEnabled && opticalInputs?.sceneColorNode && opticalInputs?.sceneDepthNode
    ? "depth-validated-refracted-ray-candidate"
    : "fixed-path-preview-no-host-opaque-inputs";

  return {
    renderer,
    backendIsWebGPU,
    tier: selectedTierName,
    seed,
    claimBoundary: WATER_EXAMPLE_CLAIM_BOUNDARY,
    heightfield,
    heightQuery,
    material,
    mesh,
    resourceLedger: {
      persistentGpuBytes: boundedWaterPersistentBytes(heightfield.resolution, heightfield.causticResolution),
      eventSnapshotBytes: heightfield.eventSnapshotBuffer.array.byteLength,
      causticAtomicBytes: heightfield.causticAccumulationBuffer.array.byteLength,
      gpuProbeBytes: heightfield.probeBuffer.array.byteLength,
      geometryBytes: mesh.userData.geometryBytes,
      excludesHostSceneTargets: true,
    },
    describeResources: () => heightfield.describeResources(),
    describeDispatches: () => heightfield.describeDispatches(),
    captureGpuState: () => heightfield.captureGpuState(),
    update(deltaSeconds) {
      const result = heightfield.step(deltaSeconds);
      if (timeNode && "value" in timeNode) timeNode.value = heightfield.simulationTime;
      material.userData.syncSimulationTextures();
      return result;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      heightfield.dispose();
    },
  };
}

export { WATER_DEBUG_MODES, WATER_MECHANISM_ROUTES, WATER_QUALITY_TIERS };
