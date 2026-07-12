import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Vector2 } from "three/webgpu";
import {
  AUTHORED_WAVES,
  BOUNDED_WATER_LAB_MANIFEST,
  CANONICAL_WATER_TIER_IDS,
  DEFAULT_WATER_PARAMETERS,
  WATER_CFL_LIMIT,
  WATER_EXAMPLE_CLAIM_BOUNDARY,
  WATER_PHYSICS_INTEGRATION_BOUNDARY,
  WATER_MECHANISM_PROFILES,
  WATER_MECHANISM_ROUTES,
  WATER_QUALITY_TIERS,
  WebGPUBoundedWaterHeightfield,
  analyticSurfaceHeightAt,
  beerLambertTransmission,
  boundedCausticQuantizationContract,
  boundedWaterPersistentBytes,
  createBoundedWaterHeightQuery,
  createBoundedWaterMaterial,
  createBoundedWaterMesh,
  createWebGPUBoundedWaterSystem,
  depositReceiverCaustics,
  equalDurationSchedules,
  exactDielectricFresnel,
  getParametricWaterHeight,
  receiverAreaDeterminant,
  replayBoundedWaterFixedSteps,
  sampleAnalyticSurfaceAtParameter,
  validateFiniteWaterParameters,
  validateRefractedRaySample,
  validateWaterConfig,
  waterCourantNumber,
  waterGridUvForWorldCoordinate,
  waterGridWorldCoordinateForUv,
} from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "webgpu-bounded-water.js"), "utf8");
const appSource = readFileSync(join(here, "lab-app.js"), "utf8");
const captureSource = readFileSync(join(here, "capture.mjs"), "utf8");
const artifactValidatorSource = readFileSync(join(here, "validate-artifacts.mjs"), "utf8");
const manifest = JSON.parse(readFileSync(join(here, "lab.manifest.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(fn, expression, message) {
  let thrown = null;
  try { fn(); } catch (error) { thrown = error; }
  assert(thrown && expression.test(thrown.message), message);
}

function maxVectorError(a, b) {
  return Math.max(...a.map((value, index) => Math.abs(value - b[index])));
}

assert(manifest.schemaVersion === 2 && manifest.id === "webgpu-bounded-water", "Bounded-water lab manifest must use schema v2 and canonical id.");
assert(manifest.kind === "canonical-lab" && manifest.status === "incomplete", "Bounded-water must remain an incomplete canonical lab pending runtime evidence.");
assert(manifest.canonicalSource[0] === "threejs-water-optics/examples/webgpu-bounded-water"
  && manifest.canonicalSource.includes("scripts/capture-lab-browser.mjs")
  && manifest.canonicalSource.includes("scripts/lib/evidence-v2.mjs"), "Canonical source hashing must cover the whole normative directory and shared capture/evidence contracts.");
assert(JSON.stringify(BOUNDED_WATER_LAB_MANIFEST.canonicalSource) === JSON.stringify(manifest.canonicalSource), "Runtime and JSON canonicalSource declarations drifted.");
assert(packageJson.dependencies.three === "0.185.1" && packageJson.dependencies.playwright === "1.61.1", "Local dependency declarations must exactly match the root pins.");

assert(JSON.stringify(Object.keys(WATER_QUALITY_TIERS)) === JSON.stringify(CANONICAL_WATER_TIER_IDS), "No hidden or compatibility tier may extend the canonical ultra/high/medium/low set.");
assert(manifest.tiers.map((tier) => tier.id).join(",") === CANONICAL_WATER_TIER_IDS.join(","), "Manifest tier order drifted from runtime.");
const tiers = Object.fromEntries(CANONICAL_WATER_TIER_IDS.map((id) => [id, validateWaterConfig({ tier: WATER_QUALITY_TIERS[id], parameters: DEFAULT_WATER_PARAMETERS })]));
for (const [id, validation] of Object.entries(tiers)) {
  assert(validation.courant <= WATER_CFL_LIMIT, `${id} exceeds the gated CFL margin.`);
  assert(validation.persistentBytes === boundedWaterPersistentBytes(WATER_QUALITY_TIERS[id].resolution), `${id} persistent byte accounting drifted.`);
  assert(manifest.tiers.find((tier) => tier.id === id).resourceLimits.derivedPersistentGpuBytes === validation.persistentBytes, `${id} manifest bytes do not equal the runtime allocation formula.`);
}
assert(tiers.ultra.courant > 0.7 && WATER_CFL_LIMIT === 0.85, "The ultra tier must prove a real reserved CFL margin, not the exact instability boundary.");

assert(WATER_MECHANISM_ROUTES.length === 6 && new Set(WATER_MECHANISM_ROUTES).size === 6, "Water mechanism route ids must be unique.");
assert(Object.keys(WATER_MECHANISM_PROFILES).join(",") === WATER_MECHANISM_ROUTES.join(","), "Every mechanism route needs one exact runtime profile.");
assert(WATER_MECHANISM_PROFILES["heightfield-simulation"].receiverCaustics === false, "Heightfield route must not retain hidden caustic dispatches.");
assert(WATER_MECHANISM_PROFILES["differential-caustics"].receiverCaustics === true, "Caustic route must enable receiver deposition.");
assert(WATER_MECHANISM_PROFILES["refraction-and-absorption"].opticalTransport === true, "Refraction route must enable opaque color/depth consumption.");
assert(WATER_MECHANISM_PROFILES["refraction-and-absorption"].mode === "final", "Refraction route must display transported scene color rather than only a scalar label.");
assert(WATER_MECHANISM_PROFILES["fresnel-and-tir"].underwaterView === true, "TIR route requires a locked underwater camera family.");
assert(WATER_MECHANISM_PROFILES["buoyancy-spray-and-masks"].buoyancySprayMasks === true, "Interaction route must enable buoyancy, spray, and masks.");

validateFiniteWaterParameters(DEFAULT_WATER_PARAMETERS);
assertThrows(() => validateFiniteWaterParameters({ ...DEFAULT_WATER_PARAMETERS, waveSpeed: Number.NaN }), /waveSpeed/, "NaN wave speed survived finite-domain validation.");
assertThrows(() => validateFiniteWaterParameters({ ...DEFAULT_WATER_PARAMETERS, waterIor: 0 }), /waterIor/, "Non-positive IOR survived validation.");
assertThrows(() => validateFiniteWaterParameters({ ...DEFAULT_WATER_PARAMETERS, causticLightTransmission: 1.1 }), /causticLightTransmission/, "Out-of-range caustic transmission survived validation.");
assertThrows(() => validateWaterConfig({ tier: WATER_QUALITY_TIERS.high, parameters: { ...DEFAULT_WATER_PARAMETERS, worldSize: new Vector2(1, 1) } }), /CFL|Courant/, "Unsafe water config survived the CFL gate.");

for (const id of CANONICAL_WATER_TIER_IDS) {
  const tier = WATER_QUALITY_TIERS[id];
  for (const worldExtent of [3.25, DEFAULT_WATER_PARAMETERS.worldSize.x]) {
    for (const gridIndex of [0, 1, Math.floor((tier.resolution - 1) / 2), tier.resolution - 2, tier.resolution - 1]) {
      const worldCoordinate = -0.5 * worldExtent + gridIndex * worldExtent / (tier.resolution - 1);
      const uv = waterGridUvForWorldCoordinate(worldCoordinate, worldExtent, tier.resolution);
      const recovered = waterGridWorldCoordinateForUv(uv, worldExtent, tier.resolution);
      assert(Math.abs(recovered - worldCoordinate) < 2e-14, `${id} node-centred grid round trip failed.`);
    }
  }
}

const parameterProbe = { qx: 0.37, qz: -0.81, time: 0.22 };
const analytic = sampleAnalyticSurfaceAtParameter(parameterProbe.qx, parameterProbe.qz, parameterProbe.time);
const epsilon = 1e-6;
const plusX = sampleAnalyticSurfaceAtParameter(parameterProbe.qx + epsilon, parameterProbe.qz, parameterProbe.time).position;
const minusX = sampleAnalyticSurfaceAtParameter(parameterProbe.qx - epsilon, parameterProbe.qz, parameterProbe.time).position;
const plusZ = sampleAnalyticSurfaceAtParameter(parameterProbe.qx, parameterProbe.qz + epsilon, parameterProbe.time).position;
const minusZ = sampleAnalyticSurfaceAtParameter(parameterProbe.qx, parameterProbe.qz - epsilon, parameterProbe.time).position;
const finiteTangentX = plusX.map((value, index) => (value - minusX[index]) / (2 * epsilon));
const finiteTangentZ = plusZ.map((value, index) => (value - minusZ[index]) / (2 * epsilon));
const tangentError = Math.max(maxVectorError(analytic.tangentX, finiteTangentX), maxVectorError(analytic.tangentZ, finiteTangentZ));
assert(tangentError < 1e-8 && analytic.horizontalJacobian > 0, "Exact authored surface differential failed its CPU oracle.");
const timeEpsilon = 1e-6;
const future = sampleAnalyticSurfaceAtParameter(parameterProbe.qx, parameterProbe.qz, parameterProbe.time + timeEpsilon);
const past = sampleAnalyticSurfaceAtParameter(parameterProbe.qx, parameterProbe.qz, parameterProbe.time - timeEpsilon);
const finiteVelocity = future.position.map((value, index) => (value - past.position[index]) / (2 * timeEpsilon));
const finiteAcceleration = future.surfacePointVelocityMps.map((value, index) => (value - past.surfacePointVelocityMps[index]) / (2 * timeEpsilon));
const velocityError = maxVectorError(analytic.surfacePointVelocityMps, finiteVelocity);
const accelerationError = maxVectorError(analytic.surfacePointAccelerationMps2, finiteAcceleration);
const projectedNormalVelocity = analytic.surfacePointVelocityMps.reduce((sum, value, index) => sum + value * analytic.normal[index], 0);
assert(velocityError < 1e-8, "Exact fixed-chart surface velocity failed its temporal finite-difference oracle.");
assert(accelerationError < 1e-7, "Exact fixed-chart surface acceleration failed its temporal finite-difference oracle.");
assert(Math.abs(projectedNormalVelocity - analytic.geometricNormalVelocityMps) < 1e-12, "Geometric normal velocity drifted from the exact surface-velocity projection.");
assert(Math.abs(getParametricWaterHeight(parameterProbe.qx, parameterProbe.qz, parameterProbe.time) - analyticSurfaceHeightAt(parameterProbe.qx, parameterProbe.qz, parameterProbe.time)) < 1e-12, "Parametric height evaluators drifted.");
assert(AUTHORED_WAVES.every((wave) => Math.abs(wave.direction.length() - 1) < 1e-12), "Authored wave directions must be normalized.");

const query = createBoundedWaterHeightQuery();
const worldProbe = query.sampleAtWorldXZ(analytic.position[0], analytic.position[2], parameterProbe.time);
assert(worldProbe.status === "converged" && worldProbe.horizontalResidual <= 1e-7, "Eulerian authored-wave inversion failed.");

const normalFresnel = exactDielectricFresnel(1, DEFAULT_WATER_PARAMETERS.airIor, DEFAULT_WATER_PARAMETERS.waterIor);
const tirProbe = exactDielectricFresnel(0.5, DEFAULT_WATER_PARAMETERS.waterIor, DEFAULT_WATER_PARAMETERS.airIor);
assert(Math.abs(normalFresnel.reflectance - 0.02033) < 1e-4, "Normal-incidence exact Fresnel is wrong.");
assert(tirProbe.reflectance === 1 && tirProbe.totalInternalReflection, "Water-to-air TIR classification is wrong.");
const transmission = beerLambertTransmission(DEFAULT_WATER_PARAMETERS.absorptionCoefficientPerMeter, 2);
assert(transmission.x < transmission.y && transmission.y < transmission.z, "Beer-Lambert channel ordering drifted.");
assert(receiverAreaDeterminant({ x: 2, y: 1 }, { x: 1, y: 3 }) === 5, "Receiver area must use a determinant.");

const deposition = depositReceiverCaustics([
  { hitX: 1.25, hitY: 1.75, power: 2 },
  { hitX: 2.5, hitY: 2.5, power: 1 },
], { width: 5, height: 5, receiverCellAreaMeters2: 0.04, footprintAreaEpsilonMeters2: 0.01 });
assert(deposition.energyClosureError < 1e-14 && Math.abs(deposition.depositedPower - 3) < 1e-14, "CPU receiver deposition is nonconservative.");
const causticQuantization = boundedCausticQuantizationContract(WATER_QUALITY_TIERS.ultra.resolution);
assert(causticQuantization.worstCaseReceiverUnits <= 0xffffffff, "Atomic receiver accumulation can overflow uint32 under its source clamp.");
assert(causticQuantization.maxUnitsPerSource > 0 && causticQuantization.maximumRoundingLossWatts > 0, "Caustic quantization error bound is absent.");

const validRefraction = validateRefractedRaySample({
  waterViewPosition: { x: 0, y: 0, z: -2 },
  refractedViewDirection: { x: 0, y: -0.1, z: -1 },
  sampledViewPosition: { x: 0, y: -0.2, z: -4 },
  candidateUv: { x: 0.5, y: 0.5 },
  maxCrossTrackMeters: 0.01,
});
const foreground = validateRefractedRaySample({
  waterViewPosition: { x: 0, y: 0, z: -2 },
  refractedViewDirection: { x: 0, y: 0, z: -1 },
  sampledViewPosition: { x: 0, y: 0, z: -1 },
  candidateUv: { x: 0.5, y: 0.5 },
  maxCrossTrackMeters: 0.01,
});
assert(validRefraction.valid && foreground.reason === "foreground", "Refraction ray/foreground CPU gates failed.");

const schedules = equalDurationSchedules(0.5);
const replays = Object.fromEntries(Object.entries(schedules).map(([hz, schedule]) => [hz, replayBoundedWaterFixedSteps({ tierId: "high", schedule })]));
assert(replays[30].fixedStepIndex === replays[60].fixedStepIndex && replays[60].fixedStepIndex === replays[120].fixedStepIndex, "Equal-duration schedules executed different fixed-step counts.");
assert(replays[30].stateHash === replays[60].stateHash && replays[60].stateHash === replays[120].stateHash, "30/60/120 Hz fixed-step replays diverged.");

const heightfield = new WebGPUBoundedWaterHeightfield({}, { tier: "low", causticsEnabled: true });
heightfield.setDrop({ x: 0.2, z: -0.1, radius: 0.25, strength: 0.4 });
heightfield.setObjectImpulse({
  oldCenter: { x: -0.1, y: 0, z: 0 },
  newCenter: { x: 0.1, y: 0, z: 0.2 },
  radius: 0.4,
  strength: 0.7,
});
const snapshot = heightfield.snapshotPendingEvents();
const snapshotBytes = Array.from(heightfield.eventSnapshotBuffer.array);
heightfield.resetImpulseUniforms();
assert(snapshot.drop.strength === 0.4 && snapshot.impulse.strength === 0.7, "Immutable event snapshot lost submitted values.");
assert(Math.abs(snapshotBytes[3] - 0.4) < 1e-6 && Math.abs(snapshotBytes[11] - 0.7) < 1e-6, "GPU event snapshot layout drifted.");
assert(snapshotBytes[15] === 0, "Default event mask must be disabled.");
assert(heightfield.causticAccumulationBuffer.array.byteLength === WATER_QUALITY_TIERS.low.resolution ** 2 * 4, "Atomic caustic buffer allocation is wrong.");
assert(heightfield.diagnosticBuffer.array.length === 8 && heightfield.probeBuffer.array.length === 16, "GPU diagnostic/probe buffer layout is wrong.");
assertThrows(() => heightfield.setDrop({ x: 100, z: 0, radius: 1, strength: 1 }), /outside/, "Out-of-domain drop survived validation.");
assertThrows(() => heightfield.setDrop({ x: 0, z: 0, radius: Number.NaN, strength: 1 }), /finite/, "NaN drop survived validation.");
const material = createBoundedWaterMaterial({ heightfield });
const mesh = createBoundedWaterMesh({ heightfield, material });
assert(mesh.frustumCulled === false && mesh.userData.geometryBytes > 0, "Unbounded forced grid must not use an invented culling bound.");
assertThrows(() => createBoundedWaterMesh({ heightfield, width: 7, material }), /must equal/, "Mesh/simulation extent mismatch survived.");
mesh.geometry.dispose();
material.dispose();
heightfield.dispose();

assert(source.includes("causticAccumulationNode") && source.includes("atomicAdd(causticAccumulationNode.element"), "GPU caustics must use source-driven atomic receiver deposition.");
assert(!source.includes("causticGatherRadiusCells") && !source.includes("createReceiverCausticNode"), "The unbounded-loss receiver gather must not remain reachable.");
assert(source.includes("combinedSurfaceHit") && source.includes("analyticSurfacePosition") && source.includes("slopeFromState"), "Caustics must share the visible analytic+heightfield cause.");
assert(source.includes("If(transmissionPossible") && source.indexOf("If(transmissionPossible") < source.indexOf("refractedWorldRaw = refract"), "TIR must branch before refraction projection.");
assert(!source.includes("normalize(refract("), "A potentially zero TIR refracted vector must never be normalized.");
assert(source.includes("captureGpuState") && source.includes("getArrayBufferAsync(this.probeBuffer"), "Actual GPU storage readback contract is missing.");
assert(source.includes("this.dispatchCount += 3") && source.includes("clearCausticAccumulation"), "Caustic dispatch accounting must include clear/deposit/resolve.");
assert(appSource.includes("this.opaquePass = pass(this.opaqueScene, this.camera)"), "Canonical app must build a real opaque-without-water pass.");
assert(appSource.includes("getTextureNode(\"output\")") && appSource.includes("getTextureNode(\"depth\")"), "Opaque color and depth must feed the water material.");
assert(appSource.includes("makeReceiverMaterial") && appSource.includes("bounded-water-caustic-receiver"), "Receiver caustics must be applied to the receiver material.");
assert(appSource.includes("setMechanism") && appSource.includes("WATER_MECHANISM_PROFILES"), "Mechanism routes must alter runtime implementation state.");
assert(appSource.includes("runGpuMutationProbe") && appSource.includes("async-impulse-loss") && appSource.includes("receiver-energy-closure"), "GPU mutation/readback hooks are missing.");
assert(appSource.includes("alignedBytesPerRow") && appSource.includes("bytesPerPixel: 4"), "Render-target capture must use the shared aligned RGBA8 contract.");
assert(captureSource.includes("captureLabBrowser") && captureSource.includes("capture-hook.mjs"), "Local capture must delegate to the shared browser wrapper and hook.");
assert(artifactValidatorSource.includes("validateEvidenceBundle") && artifactValidatorSource.includes("requireRequiredClaimsPass: true"), "Artifact validation must use strict shared v2 validation.");

for (const id of WATER_MECHANISM_ROUTES) {
  const wrapper = join(here, "canonical-targets", "mechanism", id, "index.html");
  assert(existsSync(wrapper) && readFileSync(wrapper, "utf8").includes("../../../lab-app.js"), `Mechanism wrapper ${id} does not load the canonical app.`);
}
for (const id of CANONICAL_WATER_TIER_IDS) {
  const wrapper = join(here, "canonical-targets", "tier", id, "index.html");
  assert(existsSync(wrapper) && readFileSync(wrapper, "utf8").includes("../../../lab-app.js"), `Tier wrapper ${id} does not load the canonical app.`);
}

const fakeNonWebGpuRenderer = { backend: { isWebGPUBackend: false }, async init() {} };
let rejectedNonWebGpu = false;
try { await createWebGPUBoundedWaterSystem(fakeNonWebGpuRenderer, { tier: "ultra" }); } catch (error) { rejectedNonWebGpu = /WebGPU backend required/.test(error.message); }
assert(rejectedNonWebGpu, "Missing WebGPU must block without fallback.");

assert(WATER_EXAMPLE_CLAIM_BOUNDARY.classification === "canonical-native-webgpu-lab-incomplete", "Claim boundary must match the canonical incomplete status.");
assert(WATER_PHYSICS_INTEGRATION_BOUNDARY.canonicalPhysicsAbi === false, "Render integration shell must not claim the canonical physics ABI.");
assert(WATER_PHYSICS_INTEGRATION_BOUNDARY.forbiddenClaims.includes("InteractionRecord consumption")
  && WATER_PHYSICS_INTEGRATION_BOUNDARY.forbiddenClaims.includes("conservation or two-way coupling"), "Render integration shell must enumerate its forbidden physics claims.");
assert(appSource.includes("presentation-authored moving-boundary ripple") || readFileSync(join(here, "README.md"), "utf8").includes("presentation-authored moving-boundary ripple"), "Ad-hoc water events must be labelled presentation-authored.");

console.log(JSON.stringify({
  pass: true,
  classification: WATER_EXAMPLE_CLAIM_BOUNDARY.classification,
  tiers,
  mechanisms: WATER_MECHANISM_PROFILES,
  deterministicReplay: Object.fromEntries(Object.entries(replays).map(([hz, replay]) => [hz, { steps: replay.fixedStepIndex, hash: replay.stateHash }])),
  numericalChecks: {
    tangentError,
    velocityError,
    accelerationError,
    inversionResidual: worldProbe.horizontalResidual,
    normalIncidenceFresnel: normalFresnel.reflectance,
    tirClassified: tirProbe.totalInternalReflection,
    receiverEnergyClosureError: deposition.energyClosureError,
    causticWorstCaseUnits: causticQuantization.worstCaseReceiverUnits,
    cflLimit: WATER_CFL_LIMIT,
    highTierCourant: waterCourantNumber({
      resolution: WATER_QUALITY_TIERS.high.resolution,
      fixedTimeStep: WATER_QUALITY_TIERS.high.fixedTimeStep,
    }),
  },
  verdict: "browser-free-contract-pass; runtime evidence remains INSUFFICIENT_EVIDENCE",
}, null, 2));
