import assert from "node:assert/strict";

import {
  DEFAULT_FROST_SETTINGS,
  evaluateFrostCrystalField,
} from "./frost-surface-effect.js";

const baseline = [];
const stress = [];
for (let y = 0; y < 800; y += 40) {
  for (let x = 0; x < 1200; x += 40) {
    baseline.push(evaluateFrostCrystalField({ pixelX: x, pixelY: y, seed: 0x00000001 }));
    stress.push(evaluateFrostCrystalField({ pixelX: x, pixelY: y, seed: 0x9e3779b9 }));
  }
}

for (const sample of [...baseline, ...stress]) {
  for (const value of Object.values(sample)) assert(Number.isFinite(value) && value >= 0 && value <= 1);
}

const range = (key, samples) => Math.max(...samples.map((sample) => sample[key]))
  - Math.min(...samples.map((sample) => sample[key]));
assert(range("frozenStructure", baseline) > 0.2, "frost density must not collapse to a flat overlay");
assert(range("crystalVein", baseline) > 0.8, "crystal veins must retain high-contrast branches");
assert(range("highlightStructure", baseline) > 0.7, "highlight reconstruction must expose crystalline structure");

const seedDifference = baseline.reduce((sum, sample, index) => (
  sum + Math.abs(sample.highlightStructure - stress[index].highlightStructure)
), 0) / baseline.length;
assert(seedDifference > 0.08, "fixed seeds must materially change the crystal field");

const repeat = evaluateFrostCrystalField({ pixelX: 173, pixelY: 291, seed: 1 });
assert.deepEqual(repeat, evaluateFrostCrystalField({ pixelX: 173, pixelY: 291, seed: 1 }));
const neighbor = evaluateFrostCrystalField({
  pixelX: 174,
  pixelY: 291,
  seed: 1,
  settings: DEFAULT_FROST_SETTINGS,
});
assert(Math.abs(repeat.frozenStructure - neighbor.frozenStructure) < 0.05, "one-pixel field samples must remain continuous");

console.log("frost crystal field oracle passed");
