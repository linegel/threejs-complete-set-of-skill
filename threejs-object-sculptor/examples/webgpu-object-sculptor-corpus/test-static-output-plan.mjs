import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CORPUS_CAPTURE_PLAN,
  CORPUS_CAPTURE_TARGET_IDS,
  CORPUS_NATIVE_READBACK_PLAN,
  CORPUS_RASTER_COMPARISON_PLAN,
  CORPUS_STANDARD_OUTPUT_PLAN,
  CORPUS_TARGET_MASK_PLAN,
} from "./capture-plan.js";
import { SCULPT_TARGET_IDS } from "./object-catalog.js";

const source = readFileSync(new URL("./capture-plan.js", import.meta.url), "utf8");
assert(!/from\s+["']node:/.test(source), "browser-safe capture plan must not import Node built-ins");
assert(!/\b(Buffer|process|require)\b/.test(source), "browser-safe capture plan must not depend on Node globals");
assert.deepEqual(CORPUS_CAPTURE_TARGET_IDS, SCULPT_TARGET_IDS);
assert.equal(CORPUS_CAPTURE_PLAN.length, 48);
assert.equal(CORPUS_TARGET_MASK_PLAN.length, 15);
assert.equal(CORPUS_NATIVE_READBACK_PLAN.length, 63);
assert.equal(CORPUS_STANDARD_OUTPUT_PLAN.length, 10);
assert.equal(CORPUS_RASTER_COMPARISON_PLAN.length, 18);
assert.equal(new Set(CORPUS_NATIVE_READBACK_PLAN.map(({ filename }) => filename)).size, 63);

for (const subjectId of CORPUS_CAPTURE_TARGET_IDS) {
  assert.equal(CORPUS_CAPTURE_PLAN.filter(({ state }) => state.subjectId === subjectId).length, 16);
  assert.equal(CORPUS_TARGET_MASK_PLAN.filter((mask) => mask.subjectId === subjectId).length, 5);
}

const presentationFilenames = new Set(CORPUS_CAPTURE_PLAN.map(({ filename }) => filename));
for (const mask of CORPUS_TARGET_MASK_PLAN) {
  assert(presentationFilenames.has(mask.sourceCaptureFilename), `${mask.id} must bind a declared presentation source`);
}
for (const output of CORPUS_STANDARD_OUTPUT_PLAN.filter(({ status }) => status === "CAPTURED")) {
  assert.equal(output.sourceCaptures.length, 3, `${output.id} must compose one panel per subject`);
  assert(output.sourceCaptures.every((filename) => presentationFilenames.has(filename)), `${output.id} uses an undeclared source capture`);
}

console.log(JSON.stringify({
  ok: true,
  browserSafe: true,
  targets: CORPUS_CAPTURE_TARGET_IDS.length,
  presentations: CORPUS_CAPTURE_PLAN.length,
  masks: CORPUS_TARGET_MASK_PLAN.length,
  nativeReadbacks: CORPUS_NATIVE_READBACK_PLAN.length,
  standardOutputs: CORPUS_STANDARD_OUTPUT_PLAN.length,
  rasterComparisons: CORPUS_RASTER_COMPARISON_PLAN.length,
}, null, 2));
