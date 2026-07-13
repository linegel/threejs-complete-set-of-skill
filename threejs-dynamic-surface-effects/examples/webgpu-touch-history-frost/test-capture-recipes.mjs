import assert from "node:assert/strict";

import {
  FROST_ALL_CAPTURE_RECIPES,
  FROST_CAPTURE_RECIPES,
  FROST_CAPTURE_RECIPE_IDS,
  FROST_COVERAGE_PROBE_RECIPES,
  FROST_DIAGNOSTIC_RECIPE_MODES,
  FROST_STANDARD_OUTPUT_PLAN,
  resolveFrostCaptureRecipe,
  validateFrostCaptureRecipes,
  validateFrostCoverageProbeRecipes,
  validateFrostStandardOutputPlan,
} from "./capture-recipes.js";

function mutableRecipes() {
  return structuredClone(FROST_CAPTURE_RECIPES);
}

assert.equal(validateFrostCaptureRecipes(), true);
assert.equal(validateFrostCoverageProbeRecipes(), true);
assert.equal(validateFrostStandardOutputPlan(), true);
assert.deepEqual(FROST_CAPTURE_RECIPE_IDS, [
  "final.design",
  "no-post.design",
  "diagnostic.previous-history-ra",
  "diagnostic.deposit-ra",
  "diagnostic.next-history-ra",
  "diagnostic.frost-mask-after-pointer",
  "camera.near",
  "camera.design",
  "camera.far",
  "seed-0001.final",
  "seed-9e3779b9.final",
  "temporal.t000",
  "temporal.t001",
]);
assert.equal(Object.isFrozen(FROST_CAPTURE_RECIPES), true);
assert.equal(FROST_ALL_CAPTURE_RECIPES.length, 17);
assert.deepEqual(FROST_COVERAGE_PROBE_RECIPES.map(({ id }) => id), [
  "probe.odd-size.final",
  "probe.dpr-1.final",
  "probe.dpr-1-5.final",
  "probe.dpr-2.final",
]);
assert.deepEqual(resolveFrostCaptureRecipe("probe.odd-size.final").viewport, {
  width: 641,
  height: 359,
  dpr: 1,
  physicalWidth: 641,
  physicalHeight: 359,
});
assert.equal(Object.isFrozen(resolveFrostCaptureRecipe("final.design").trace[0].start), true);
assert.deepEqual(
  FROST_CAPTURE_RECIPE_IDS.slice(2, 6).map((id) => resolveFrostCaptureRecipe(id).target),
  FROST_DIAGNOSTIC_RECIPE_MODES,
);
assert.deepEqual(FROST_STANDARD_OUTPUT_PLAN[2], {
  id: "diagnostics.mosaic",
  filename: "diagnostics.mosaic.png",
  kind: "derived-mosaic",
  recipeIds: FROST_CAPTURE_RECIPE_IDS.slice(2, 6),
});
assert.equal(resolveFrostCaptureRecipe("no-post.design").target, "scene-color");
assert.equal(resolveFrostCaptureRecipe("final.design").mechanism, "refraction-and-fresnel");
assert.equal(resolveFrostCaptureRecipe("final.design").tier, "balanced");
assert.equal(resolveFrostCaptureRecipe("final.design").trace.length, 32);
assert.equal(resolveFrostCaptureRecipe("final.design").expectedTimeSeconds, 32 / 30);
assert(resolveFrostCaptureRecipe("final.design").trace.every((step) => (
  Math.hypot(step.end.x - step.start.x, step.end.y - step.start.y) <= 0.075
)));
assert.deepEqual(
  resolveFrostCaptureRecipe("camera.near").trace,
  resolveFrostCaptureRecipe("camera.design").trace,
);
assert.deepEqual(
  resolveFrostCaptureRecipe("camera.design").trace,
  resolveFrostCaptureRecipe("camera.far").trace,
);
assert.deepEqual(
  resolveFrostCaptureRecipe("seed-0001.final").trace,
  resolveFrostCaptureRecipe("seed-9e3779b9.final").trace,
);
assert.equal(resolveFrostCaptureRecipe("temporal.t000").trace.length, 0);
assert.equal(resolveFrostCaptureRecipe("temporal.t001").temporalTraceLength, 1);
assert.equal(resolveFrostCaptureRecipe("temporal.t001").trace.at(-1).deltaSeconds, 1 / 60);
assert.throws(() => resolveFrostCaptureRecipe("invented"), /unknown frost capture recipe/);

for (const [name, mutate, pattern] of [
  ["duplicate-id", (recipes) => { recipes[1].id = recipes[0].id; }, /standard output order|unique/],
  ["filename-drift", (recipes) => { recipes[0].filename = "renamed.png"; }, /filename is not identity-bound/],
  ["non-normalized-pointer", (recipes) => { recipes[0].trace[0].start.x = 1.1; }, /normalized history UV/],
  ["zero-pressure", (recipes) => { recipes[0].trace[0].pressure = 0; }, /pressure must be/],
  ["oversized-step", (recipes) => { recipes[0].trace[0].deltaSeconds = 0.1; }, /deltaSeconds must be/],
  ["illegibly-fast-gesture", (recipes) => { recipes[0].trace[0].end = { x: 0.5, y: 0.5 }; }, /moves too quickly/],
  ["fake-history-source", (recipes) => { recipes[0].historySource = "page screenshot"; }, /GPU history source/],
  ["mechanism-drift", (recipes) => { recipes[0].mechanism = "history-and-deposit"; }, /complete Frost mechanism/],
  ["tier-drift", (recipes) => { recipes[0].tier = "budgeted"; }, /frozen correctness tier/],
  ["automatic-parent-mutation", (recipes) => { recipes[0].transaction.parentRouteMutationAllowed = true; }, /transaction contract drifted/],
  ["diagnostic-source-loss", (recipes) => { recipes[2].diagnosticModes.pop(); }, /diagnostic source modes drifted/],
  ["temporal-extra-step", (recipes) => {
    recipes[12].trace.push(structuredClone(recipes[12].trace.at(-1)));
    recipes[12].temporalTraceLength += 1;
    recipes[12].expectedTimeSeconds += 1 / 60;
  }, /exactly one authored temporal step/],
  ["semantic-duplicate", (recipes) => {
    recipes[7].target = recipes[0].target;
    recipes[7].camera = recipes[0].camera;
    recipes[7].seed = recipes[0].seed;
    recipes[7].trace = structuredClone(recipes[0].trace);
    recipes[7].initialTraceLength = recipes[0].initialTraceLength;
    recipes[7].temporalTraceLength = recipes[0].temporalTraceLength;
    recipes[7].expectedTimeSeconds = recipes[0].expectedTimeSeconds;
  }, /semantically duplicates/],
  ["camera-trace-confound", (recipes) => {
    recipes[7].trace = structuredClone(recipes[7].trace);
    recipes[7].trace[0].pressure = 0.5;
  }, /camera recipes must share the exact authored pointer trace/],
  ["seed-trace-confound", (recipes) => {
    recipes[10].trace = structuredClone(recipes[10].trace);
    recipes[10].trace[0].pressure = 0.5;
  }, /fixed-seed recipes must isolate seed/],
]) {
  const recipes = mutableRecipes();
  mutate(recipes);
  assert.throws(
    () => validateFrostCaptureRecipes(recipes, { requireFrozen: false }),
    pattern,
    `${name} mutation must fail`,
  );
}

const outputPlanMutation = structuredClone(FROST_STANDARD_OUTPUT_PLAN);
outputPlanMutation[2].recipeIds.pop();
assert.throws(
  () => validateFrostStandardOutputPlan(outputPlanMutation, { requireFrozen: false }),
  /bind all four ordered component recipes/,
);

console.log("frost capture recipe contract passed");
