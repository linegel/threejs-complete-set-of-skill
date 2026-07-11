import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Matrix4, PerspectiveCamera } from "three";

import {
  intersectSphereInterval,
  traceArtisticBoundedRay,
  traceEllisImpact,
  traceSchwarzschildNullRay,
  validateRayResult,
} from "./space-integrators.js";
import {
  SpaceIntegratorLab,
  computeRgbaReadbackLayout,
  summarizeProbeReadback,
} from "./space-lab.mjs";
import {
  createEllisTransferTextures,
  createSchwarzschildTransferTextures,
  createSpaceIntegratorStage,
  reprojectWorldPositionCPU,
} from "./space-transfer-stage.js";
import {
  SPACE_PROBE_TERMINATION,
  SpaceMetricProbeIntegrator,
  integrateEllisProbeCPU,
  integrateSchwarzschildProbeCPU,
} from "./space-gpu-probes.js";

const here = dirname(fileURLToPath(import.meta.url));

const oddRowBytes = 641 * 4;
const oddAligned = Math.ceil(oddRowBytes / 256) * 256;
assert.deepEqual(computeRgbaReadbackLayout({
  width: 641,
  height: 359,
  byteLength: oddAligned * 358 + oddRowBytes,
}), { rowBytes: oddRowBytes, sourceBytesPerRow: oddAligned, bytesPerRow: oddAligned });
assert.throws(() => computeRgbaReadbackLayout({
  width: 641,
  height: 359,
  byteLength: oddRowBytes * 359 - 1,
}), /unrecognized RGBA readback layout/);

assert.equal(intersectSphereInterval([0, 2, 0], [1, 0, 0], 1).hit, false);
const miss = traceArtisticBoundedRay({ origin: [0, 2, 0], direction: [1, 0, 0], maxSteps: 32 });
assert.deepEqual(miss, { termination: "miss", acceptedSteps: 0, transmittance: 1, radiance: 0 });
assert.equal(validateRayResult(miss, { maxSteps: 32 }), true);

const capped = traceArtisticBoundedRay({
  origin: [0, 0, 2],
  direction: [0, 0, -1],
  maxSteps: 3,
  stepLength: 0.001,
});
assert.equal(capped.acceptedSteps, 3, "step-cap semantics are exact");
assert.throws(
  () => validateRayResult(capped, { maxSteps: 3 }),
  /incomplete ray termination/,
  "step-capped work is classified but cannot serve as accepted evidence",
);

const ellisTraversal = traceEllisImpact({ B: 0.4 });
const ellisTurning = traceEllisImpact({ B: 1.4 });
const ellisCritical = traceEllisImpact({ B: 1 });
assert.equal(ellisTraversal.regime, "traversing");
assert.equal(ellisTraversal.exterior, -1);
assert.equal(ellisTurning.regime, "turning");
assert.equal(ellisTurning.exterior, 1);
assert.equal(ellisCritical.termination, "unresolved-critical");
assert(ellisTurning.azimuth > ellisTraversal.azimuth, "near-throat turning increases winding");

const mass = 1;
const criticalImpact = 3 * Math.sqrt(3) * mass;
const exactCritical = traceSchwarzschildNullRay({ impact: criticalImpact, mass, boundaryRadius: 80 });
const captured = traceSchwarzschildNullRay({ impact: criticalImpact * 0.98, mass, boundaryRadius: 80 });
const escaped = traceSchwarzschildNullRay({ impact: criticalImpact * 1.03, mass, boundaryRadius: 80 });
assert.equal(captured.termination, "horizon");
assert.equal(escaped.termination, "escaped");
assert.equal(exactCritical.termination, "unresolved-critical");
assert.equal(exactCritical.regime, "critical-separatrix");
assert.equal(exactCritical.photonSphereRadius, 3 * mass);
assert.throws(() => validateRayResult(exactCritical, { maxSteps: 200000 }), /incomplete ray termination/);
assert.equal(captured.minimumRadius, 2 * mass);
assert.equal(captured.state[0], 2 * mass);
assert.equal(captured.eventResidual, 0);
assert.equal(escaped.state[0], 80);
assert.equal(escaped.eventResidual, 0);
assert(escaped.minimumRadius > 3 * mass, "supercritical closest approach remains outside photon sphere");
assert.equal(escaped.photonSphereRadius, 3 * mass);
assert(Math.abs(escaped.criticalImpact - criticalImpact) < 1e-14);
assert.equal(validateRayResult(escaped, {
  maxSteps: 200000,
  requiredTermination: "escaped",
  invariantTolerance: 1e-8,
}), true);

const weak = traceSchwarzschildNullRay({ impact: 50, mass, boundaryRadius: 500, maxAffineStep: 0.08 });
const weakField = 4 * mass / 50;
assert(Math.abs(weak.deflection - weakField) / weakField < 0.08, "weak-field deflection approaches 4M/b");

const coarse = traceSchwarzschildNullRay({ impact: 8, boundaryRadius: 80, maxAffineStep: 0.08 });
const medium = traceSchwarzschildNullRay({ impact: 8, boundaryRadius: 80, maxAffineStep: 0.04 });
const fine = traceSchwarzschildNullRay({ impact: 8, boundaryRadius: 80, maxAffineStep: 0.02 });
assert(Math.abs(medium.deflection - fine.deflection) <= Math.abs(coarse.deflection - fine.deflection) + 1e-12);
assert(fine.maxInvariantDrift < 1e-9);

const ellisDirect = integrateEllisProbeCPU({ impact: 0.4 });
assert.equal(ellisDirect.termination, "escaped");
assert(ellisDirect.acceptedSteps <= 8192);
assert(ellisDirect.maxInvariantDrift < 1e-10);
const ellisAcceptedNearThroat = integrateEllisProbeCPU({ impact: 0.8 });
assert.equal(ellisAcceptedNearThroat.termination, "escaped");
assert(ellisAcceptedNearThroat.acceptedSteps <= 8192);
const ellisCappedNearCritical = integrateEllisProbeCPU({ impact: 0.999 });
assert.equal(ellisCappedNearCritical.termination, "step-cap");
assert.throws(
  () => validateRayResult(ellisCappedNearCritical, { maxSteps: 8192 }),
  /incomplete ray termination/,
);
const schwarzschildDirect = integrateSchwarzschildProbeCPU({ impact: 8 });
assert.equal(schwarzschildDirect.termination, "escaped");
assert.equal(schwarzschildDirect.state[0], 80);
assert(schwarzschildDirect.acceptedSteps <= 16384);
assert(schwarzschildDirect.maxInvariantDrift < 1e-9);
const completedNearCriticalReference = integrateSchwarzschildProbeCPU({
  impact: criticalImpact * 1.03,
  maxAffineStep: 0.01,
  maxSteps: 65536,
});
assert.equal(completedNearCriticalReference.termination, "escaped");
assert(completedNearCriticalReference.acceptedSteps > 16384);
assert.equal(integrateSchwarzschildProbeCPU({
  impact: criticalImpact,
}).termination, "unresolved-critical");
const cappedNearCriticalReference = integrateSchwarzschildProbeCPU({
  impact: criticalImpact * 1.03,
  maxAffineStep: 0.01,
  maxSteps: 16384,
});
assert.equal(cappedNearCriticalReference.termination, "step-cap");
assert.throws(
  () => validateRayResult(cappedNearCriticalReference, { maxSteps: 16384 }),
  /incomplete ray termination/,
);
const directProbeGraph = new SpaceMetricProbeIntegrator({ capacity: 8 });
directProbeGraph.setEllisProbes([{ impact: 0 }, { impact: 0.4 }, { impact: 1.4 }]);
assert.equal(directProbeGraph.describe().model, "ellis");
assert.equal(directProbeGraph.describe().activeProbes, 3);
directProbeGraph.setSchwarzschildProbes([{ impact: 4 }, { impact: 8 }]);
assert.equal(directProbeGraph.describe().model, "schwarzschild");
assert.equal(directProbeGraph.describe().activeProbes, 2);
assert.equal(directProbeGraph.describe().readbackPolicy, "validation-only");
directProbeGraph.dispose();
assert.equal(directProbeGraph.describe().disposed, true);

const convergenceImpacts = [4, criticalImpact * 0.99, criticalImpact * 1.03, 8];
const convergenceReadback = {
  count: convergenceImpacts.length,
  maxSteps: 16384,
  output: new Float32Array(convergenceImpacts.length * 4),
  diagnostics: new Float32Array(convergenceImpacts.length * 4),
  results: new Uint32Array(convergenceImpacts.length * 4),
};
for (let index = 0; index < convergenceImpacts.length; index += 1) {
  const result = integrateSchwarzschildProbeCPU({
    impact: convergenceImpacts[index],
    maxAffineStep: 0.02,
    maxSteps: convergenceReadback.maxSteps,
  });
  convergenceReadback.output.set(
    [result.state[0], result.state[1], convergenceImpacts[index], result.state[2]],
    index * 4,
  );
  convergenceReadback.diagnostics[index * 4] = result.maxInvariantDrift;
  convergenceReadback.results.set([
    result.termination === "escaped"
      ? SPACE_PROBE_TERMINATION.escaped
      : SPACE_PROBE_TERMINATION.horizon,
    result.acceptedSteps,
    1,
    0,
  ], index * 4);
}
assert.equal(summarizeProbeReadback(convergenceReadback, 0.02).allValid, true);
convergenceReadback.results[2 * 4] = SPACE_PROBE_TERMINATION.stepCap;
assert.equal(
  summarizeProbeReadback(convergenceReadback, 0.02).allValid,
  false,
  "step-capped convergence probes cannot pass",
);
const cappedEllisEvidence = await SpaceIntegratorLab.prototype.readMechanismEvidence.call({
  renderer: {},
  stage: {
    async readProbeEvidence() {
      return {
        model: "ellis",
        count: 1,
        maxSteps: 8192,
        output: new Float32Array([0.012, -0.001, 0.999, 8]),
        diagnostics: new Float32Array([1e-6, 0.012, 0, 0]),
        results: new Uint32Array([SPACE_PROBE_TERMINATION.stepCap, 8192, 1, 0]),
      };
    },
  },
});
assert.equal(cappedEllisEvidence.allValid, false, "capped Ellis direct probes cannot pass evidence");

const centerReprojection = reprojectWorldPositionCPU({
  worldPosition: [0, 0, 0],
  previousViewProjection: new Matrix4(),
  width: 641,
  height: 359,
});
assert.equal(centerReprojection.inBounds, true);
assert.deepEqual(centerReprojection.uv, [0.5, 0.5]);
assert.deepEqual(centerReprojection.cell, [320, 179]);
const jitteredReprojection = reprojectWorldPositionCPU({
  worldPosition: [0, 0, 0],
  previousViewProjection: new Matrix4(),
  previousJitter: [0.01, -0.02],
  currentJitter: [-0.03, 0.04],
  width: 100,
  height: 100,
});
assert.deepEqual(jitteredReprojection.uv, [0.54, 0.44]);
assert.equal(reprojectWorldPositionCPU({
  worldPosition: [3, 0, 0],
  previousViewProjection: new Matrix4(),
  width: 100,
  height: 100,
}).inBounds, false);

const ellisTransfer = createEllisTransferTextures({ resolution: 24 });
const schwarzschildTransfer = createSchwarzschildTransferTextures({ resolution: 24 });
assert(ellisTransfer.maximum > ellisTransfer.boundaryRadius * 0.99);
assert.equal(schwarzschildTransfer.maximum, schwarzschildTransfer.boundaryRadius);
for (const table of [ellisTransfer, schwarzschildTransfer]) {
  for (const texture of [table.below, table.above]) {
    assert.equal(texture.colorSpace, "");
    assert.equal(texture.type, (await import("three/webgpu")).HalfFloatType);
    assert(Array.from(texture.image.data).every(Number.isFinite), `${texture.name} finite`);
    texture.dispose();
  }
}

const star = new (await import("three/webgpu")).DataTexture(
  new Uint8Array([255, 255, 255, 255]),
  1,
  1,
  (await import("three/webgpu")).RGBAFormat,
  (await import("three/webgpu")).UnsignedByteType,
);
const stage = createSpaceIntegratorStage({ mode: "ellis-wormhole", quality: "background", starTexture: star });
assert.equal(stage.describePipeline().rendererOwner, "host");
assert.equal(stage.describePipeline().outputOwner, "host");
assert.equal(stage.describePipeline().transferSampling, "critical-split log(abs(b-bCritical))");
stage.dispose();

const convergenceStage = createSpaceIntegratorStage({
  mode: "integration-convergence",
  quality: "background",
});
assert.deepEqual(convergenceStage.describePipeline().convergenceStepSizes, [0.08, 0.04, 0.02]);
assert.equal(convergenceStage.describePipeline().directMetricProbeDispatches, 0);
assert.equal(convergenceStage.describePipeline().plannedDirectMetricProbeDispatches, 3);
assert.equal(convergenceStage.describeResources().transferTextures.length, 4);
assert.match(convergenceStage.describePipeline().convergenceImage, /coarse 0\.08 versus fine 0\.02/);
const convergenceRuntimeGraph = SpaceIntegratorLab.prototype.describePipeline.call({
  stage: convergenceStage,
});
assert.deepEqual(Object.keys(convergenceRuntimeGraph).sort(), [
  "computeDispatches",
  "finalOutputTransformOwner",
  "finalToneMapOwner",
  "owners",
  "resources",
  "sceneSubmissions",
  "schemaVersion",
  "signals",
]);
assert.equal(convergenceRuntimeGraph.computeDispatches.length, 3);
convergenceStage.dispose();

const cacheStage = createSpaceIntegratorStage({ mode: "lens-cache", quality: "background" });
const cacheCamera = new PerspectiveCamera(55, 1, 0.01, 100);
cacheCamera.position.set(0, 0.14, 2.35);
cacheCamera.lookAt(0, 0, 0);
cacheCamera.updateProjectionMatrix();
cacheStage.cache.setCamera(cacheCamera, cacheStage.mesh, { force: true });
assert.equal(cacheStage.cache.refresh({ compute() {} }), true);
cacheStage.cache.setCamera(cacheCamera, cacheStage.mesh);
assert.equal(cacheStage.cache.refresh({ compute() {} }), false, "unchanged lens cache must be reused");
assert.equal(cacheStage.cache.describe().skippedRefreshCount, 1);
cacheCamera.position.x = 0.0002;
cacheCamera.lookAt(0, 0, 0);
cacheStage.cache.setCamera(cacheCamera, cacheStage.mesh);
assert.equal(cacheStage.cache.refresh({ compute() {} }), false, "sub-gate motion must reuse cache");
cacheCamera.position.x = 0.001;
cacheCamera.lookAt(0, 0, 0);
cacheStage.cache.setCamera(cacheCamera, cacheStage.mesh);
assert.equal(cacheStage.cache.refresh({ compute() {} }), true, "sub-gate motion must accumulate from the last committed cache view");
cacheStage.resetHistory("test-camera-cut");
assert.equal(cacheStage.cache.refresh({ compute() {} }), true, "explicit resets invalidate the bounded cache");
assert.equal(cacheStage.cache.describe().lastInvalidationCause, "test-camera-cut");
cacheStage.mesh.scale.set(1, 1.2, 1);
assert.throws(
  () => cacheStage.cache.setCamera(cacheCamera, cacheStage.mesh),
  /finite uniform effect scale/,
);
cacheStage.dispose();

const source = readFileSync(resolve(here, "space-transfer-stage.js"), "utf8");
for (const required of [
  "SpaceLensDirectionCache",
  "SpaceTemporalDirectionHistory",
  "textureStore",
  "renderer.compute",
  "termination-and-exterior-classification",
  "bent-direction-angular-residual",
  "representative world position -> previous view-projection + jitter delta",
  "critical-split log(abs(b-bCritical))",
  "directMetricProbeDispatches",
]) assert(source.includes(required), `missing ${required}`);

console.log("Space integrator physical oracles and stage contracts passed");
