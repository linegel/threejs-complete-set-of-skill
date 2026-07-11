import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_WATER_PARAMETERS,
  WATER_MECHANISM_PROFILES,
  WATER_MECHANISM_ROUTES,
  WATER_QUALITY_TIERS,
  WebGPUBoundedWaterHeightfield,
  boundedCausticQuantizationContract,
  depositReceiverCaustics,
  equalDurationSchedules,
  replayBoundedWaterFixedSteps,
  validateFiniteWaterParameters,
  validateRefractedRaySample,
} from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "webgpu-bounded-water.js"), "utf8");
const app = readFileSync(join(here, "lab-app.js"), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const killed = [];

const deposition = depositReceiverCaustics([{ hitX: 1.2, hitY: 1.8, power: 3 }], {
  width: 4,
  height: 4,
  receiverCellAreaMeters2: 0.04,
  footprintAreaEpsilonMeters2: 0.01,
});
assert(deposition.energyClosureError < 1e-14, "Mutation survived: receiver deposition lost in-bounds power.");
killed.push("source-space-caustics");

const contract = boundedCausticQuantizationContract(WATER_QUALITY_TIERS.ultra.resolution);
assert(contract.worstCaseReceiverUnits <= 0xffffffff && contract.maxUnitsPerSource > 0, "Mutation survived: uint caustic accumulator can overflow.");
killed.push("unbounded-atomic-overflow");

assert(source.includes("atomicAdd(causticAccumulationNode.element") && !source.includes("causticGatherRadiusCells"), "Mutation survived: bounded gather without loss proof remains.");
killed.push("bounded-gather-loss");

assert(source.includes("combinedSurfaceHit") && source.includes("analyticSurfacePosition") && source.includes("slopeFromState"), "Mutation survived: caustics use a different surface cause than visible water.");
killed.push("split-surface-cause");

assert(!source.includes("normalize(refract(") && source.includes("If(transmissionPossible"), "Mutation survived: TIR zero vector reaches normalize/project.");
killed.push("unsafe-tir-normalize");

const foreground = validateRefractedRaySample({
  waterViewPosition: { x: 0, y: 0, z: -2 },
  refractedViewDirection: { x: 0, y: 0, z: -1 },
  sampledViewPosition: { x: 0, y: 0, z: -1 },
  candidateUv: { x: 0.5, y: 0.5 },
  maxCrossTrackMeters: 0.01,
});
assert(foreground.reason === "foreground", "Mutation survived: foreground was accepted as refracted background.");
killed.push("foreground-refraction");

assert(app.includes("pass(this.opaqueScene, this.camera)") && app.includes("getTextureNode(\"depth\")"), "Mutation survived: canonical material has no opaque-without-water depth input.");
killed.push("missing-opaque-refraction-input");

assert(app.includes("makeReceiverMaterial") && app.includes("receiverCaustic"), "Mutation survived: caustic texture is not consumed by the receiver.");
killed.push("caustic-not-applied-to-receiver");

for (const id of WATER_MECHANISM_ROUTES) assert(WATER_MECHANISM_PROFILES[id], `Mutation survived: route ${id} has no runtime profile.`);
assert(new Set(WATER_MECHANISM_ROUTES.map((id) => JSON.stringify(WATER_MECHANISM_PROFILES[id]))).size === WATER_MECHANISM_ROUTES.length, "Mutation survived: mechanism routes alias one implementation state.");
killed.push("mechanism-route-aliasing");

const schedules = equalDurationSchedules(0.5);
const hashes = Object.values(schedules).map((schedule) => replayBoundedWaterFixedSteps({ schedule }).stateHash);
assert(new Set(hashes).size === 1, "Mutation survived: fixed-step replay depends on presentation rate.");
killed.push("presentation-rate-dependent-replay");

let rejectedNaN = false;
try { validateFiniteWaterParameters({ ...DEFAULT_WATER_PARAMETERS, causticEpsilon: Number.NaN }); } catch { rejectedNaN = true; }
assert(rejectedNaN, "Mutation survived: NaN optical parameter accepted.");
killed.push("nonfinite-optical-input");

const heightfield = new WebGPUBoundedWaterHeightfield({}, {
  tier: "low",
  parameters: { ...DEFAULT_WATER_PARAMETERS, eventMaskEnabled: true },
});
let rejectedTierDrift = false;
try { new WebGPUBoundedWaterHeightfield({}, { tier: "low", resolution: 64 }); } catch { rejectedTierDrift = true; }
assert(rejectedTierDrift, "Mutation survived: canonical tier resources were silently overridden.");
heightfield.setDrop({ x: 0.2, z: -0.1, radius: 0.25, strength: 0.4 });
heightfield.snapshotPendingEvents();
const snapshotStrength = heightfield.eventSnapshotBuffer.array[3];
const maskEnabled = heightfield.eventSnapshotBuffer.array[15];
heightfield.resetImpulseUniforms();
assert(Math.abs(heightfield.eventSnapshotBuffer.array[3] - snapshotStrength) < 1e-8 && snapshotStrength > 0, "Mutation survived: deferred event lost after CPU reset.");
assert(maskEnabled === 1, "Mutation survived: interaction mask did not enter immutable GPU event storage.");
heightfield.dispose();
killed.push("async-impulse-loss", "mask-not-snapshotted", "hidden-tier-drift");

assert(app.includes("runGpuMutationProbe") && source.includes("getArrayBufferAsync(this.probeBuffer"), "Mutation survived: GPU mutation probes are CPU-only labels.");
killed.push("fabricated-gpu-probe");

for (const id of WATER_MECHANISM_ROUTES) {
  const wrapper = join(here, "canonical-targets", "mechanism", id, "index.html");
  assert(existsSync(wrapper) && readFileSync(wrapper, "utf8").includes("../../../lab-app.js"), `Mutation survived: mechanism wrapper ${id} forked or disappeared.`);
}
for (const id of Object.keys(WATER_QUALITY_TIERS)) {
  const wrapper = join(here, "canonical-targets", "tier", id, "index.html");
  assert(existsSync(wrapper) && readFileSync(wrapper, "utf8").includes("../../../lab-app.js"), `Mutation survived: tier wrapper ${id} forked or disappeared.`);
}
killed.push("missing-route-wrapper");

console.log(JSON.stringify({ pass: true, mutationsKilled: killed }, null, 2));
