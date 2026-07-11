import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DenseGrassSystem,
  denseGrassQualityTiers,
  denseGrassSpatialGridSlot,
  evaluateDenseGrassRootedDeformationCPU,
  validateDenseGrassConfig,
  validateDenseGrassSystem,
} from "./dense-grass-system.js";

const renderer = {
  initialized: true,
  backend: { isWebGPUBackend: true },
  compute() {},
  getRenderTarget() { return null; },
  setRenderTarget() {},
};

assert.throws(() => validateDenseGrassConfig({ tier: "high", worldUnitsPerMeter: 0 }), /worldUnitsPerMeter/);
assert.throws(() => evaluateDenseGrassRootedDeformationCPU({ t: -0.1, height: 1, forward: 0 }), /t in \[0,1\]/);

const columns = Math.ceil(Math.sqrt(denseGrassQualityTiers.high.bladesPerPatch));
const retained = Math.floor(denseGrassQualityTiers.high.bladesPerPatch * denseGrassQualityTiers.high.midDensity);
const rankedQuadrants = [0, 0, 0, 0];
const rowMajorQuadrants = [0, 0, 0, 0];
for (let index = 0; index < retained; index += 1) {
  for (const [slot, counts] of [[denseGrassSpatialGridSlot(index, columns), rankedQuadrants], [index, rowMajorQuadrants]]) {
    const x = slot % columns;
    const z = Math.floor(slot / columns);
    counts[(x >= columns / 2 ? 1 : 0) + (z >= columns / 2 ? 2 : 0)] += 1;
  }
}
assert(rankedQuadrants.every((count) => count >= retained * 0.18));
assert(rowMajorQuadrants.some((count) => count === 0), "row-major LOD mutation must fail quadrant coverage");

const system = await new DenseGrassSystem(renderer, { tier: "low" }).initialize();
const original = system.patches[0].storageSet.originTerrainHeight.value.array;
system.patches[0].storageSet.originTerrainHeight.value.array = new Float32Array(original.length);
assert.throws(() => validateDenseGrassSystem(system), /static placement storage/);
system.patches[0].storageSet.originTerrainHeight.value.array = original;
assert.equal(validateDenseGrassSystem(system).pass, true);
system.dispose();

const manifest = JSON.parse(readFileSync(new URL("./lab.manifest.json", import.meta.url), "utf8"));
for (const tier of manifest.tiers) {
  const runtime = denseGrassQualityTiers[tier.id.split("/")[1]];
  assert.equal(tier.resolutionPolicy.dprCap.value, runtime.dprCap,
    `${tier.id} manifest/runtime DPR lock drifted`);
}

console.log(JSON.stringify({
  pass: true,
  detected: ["invalid-world-units", "invalid-root-coordinate", "row-major-lod", "static-storage-replacement", "dpr-lock-drift"],
}));
