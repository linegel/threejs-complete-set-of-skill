export const FROST_CAPTURE_RECIPE_KIND = "touch-history-frost-correctness-recipe-v1";
export const FROST_CAPTURE_RECIPE_SCHEMA_VERSION = 1;

const EXPECTED_RECIPE_IDS = Object.freeze([
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
const CAPTURE_TARGETS = Object.freeze([
  "final",
  "scene-color",
  "previous-history-ra",
  "deposit-ra",
  "next-history-ra",
  "frost-mask-after-pointer",
]);
const CAMERAS = Object.freeze(["near", "design", "far"]);
const DEFAULT_VIEWPORT = Object.freeze({
  width: 1200,
  height: 800,
  dpr: 1,
  physicalWidth: 1200,
  physicalHeight: 800,
});
const TRANSACTION = Object.freeze({
  owner: "webgpu-touch-history-frost",
  scope: "controller-owned-history",
  restorePolicy: "restore-entry-state-or-poison",
  parentRouteMutationAllowed: false,
});

const BASE_GESTURE = Object.freeze([
  Object.freeze({ start: Object.freeze({ x: 0.16, y: 0.72 }), end: Object.freeze({ x: 0.34, y: 0.61 }), pressure: 0.92, deltaSeconds: 1 / 30 }),
  Object.freeze({ start: Object.freeze({ x: 0.34, y: 0.61 }), end: Object.freeze({ x: 0.52, y: 0.69 }), pressure: 0.86, deltaSeconds: 1 / 30 }),
  Object.freeze({ start: Object.freeze({ x: 0.52, y: 0.69 }), end: Object.freeze({ x: 0.69, y: 0.53 }), pressure: 0.96, deltaSeconds: 1 / 30 }),
  Object.freeze({ start: Object.freeze({ x: 0.69, y: 0.53 }), end: Object.freeze({ x: 0.81, y: 0.35 }), pressure: 0.78, deltaSeconds: 1 / 30 }),
]);

function subdivideTrace(trace, subdivisionCount = 8) {
  return Object.freeze(trace.flatMap((step) => Array.from({ length: subdivisionCount }, (_, index) => {
    const startT = index / subdivisionCount;
    const endT = (index + 1) / subdivisionCount;
    const interpolate = (axis, t) => step.start[axis] + (step.end[axis] - step.start[axis]) * t;
    return Object.freeze({
      start: Object.freeze({ x: interpolate("x", startT), y: interpolate("y", startT) }),
      end: Object.freeze({ x: interpolate("x", endT), y: interpolate("y", endT) }),
      pressure: step.pressure,
      deltaSeconds: step.deltaSeconds,
    });
  })));
}

const BASE_TRACE = subdivideTrace(BASE_GESTURE);
const CAMERA_TRACE = Object.freeze(BASE_TRACE.slice(0, 24));
const SEED_TRACE = Object.freeze([
  ...BASE_TRACE,
  ...subdivideTrace([
    Object.freeze({ start: Object.freeze({ x: 0.26, y: 0.29 }), end: Object.freeze({ x: 0.47, y: 0.37 }), pressure: 0.81, deltaSeconds: 1 / 30 }),
  ]),
]);

const TEMPORAL_BASE_TRACE = Object.freeze([]);
const TEMPORAL_ADVANCE = Object.freeze([
  Object.freeze({ start: Object.freeze({ x: 0.52, y: 0.69 }), end: Object.freeze({ x: 0.58, y: 0.62 }), pressure: 0.91, deltaSeconds: 1 / 60 }),
]);

export const FROST_DIAGNOSTIC_RECIPE_MODES = Object.freeze([
  "previous-history-ra",
  "deposit-ra",
  "next-history-ra",
  "frost-mask-after-pointer",
]);

const DIAGNOSTIC_RECIPE_IDS = Object.freeze([
  "diagnostic.previous-history-ra",
  "diagnostic.deposit-ra",
  "diagnostic.next-history-ra",
  "diagnostic.frost-mask-after-pointer",
]);

function recipe(id, target, overrides = {}) {
  const initialTrace = overrides.initialTrace ?? overrides.trace ?? BASE_TRACE;
  const temporalTrace = overrides.temporalTrace ?? [];
  const trace = Object.freeze([...initialTrace, ...temporalTrace]);
  return Object.freeze({
    schemaVersion: FROST_CAPTURE_RECIPE_SCHEMA_VERSION,
    recipeKind: FROST_CAPTURE_RECIPE_KIND,
    id,
    filename: `${id}.png`,
    target,
    scenario: "touch-history-frost",
    mechanism: "refraction-and-fresnel",
    tier: "balanced",
    camera: overrides.camera ?? "design",
    seed: overrides.seed ?? 0x00000001,
    viewport: overrides.viewport ?? DEFAULT_VIEWPORT,
    initialTimeSeconds: 0,
    trace,
    initialTraceLength: initialTrace.length,
    temporalTraceLength: temporalTrace.length,
    expectedTimeSeconds: trace.reduce((sum, step) => sum + step.deltaSeconds, 0),
    historySource: "real pointer segments submitted through the storage-texture compute history update",
    diagnosticModes: id.startsWith("diagnostic.") ? Object.freeze([target]) : Object.freeze([]),
    transaction: TRANSACTION,
  });
}

const RECIPES = Object.freeze([
  recipe("final.design", "final"),
  recipe("no-post.design", "scene-color"),
  recipe("diagnostic.previous-history-ra", "previous-history-ra"),
  recipe("diagnostic.deposit-ra", "deposit-ra"),
  recipe("diagnostic.next-history-ra", "next-history-ra"),
  recipe("diagnostic.frost-mask-after-pointer", "frost-mask-after-pointer"),
  recipe("camera.near", "final", { camera: "near", trace: CAMERA_TRACE }),
  recipe("camera.design", "final", { trace: CAMERA_TRACE }),
  recipe("camera.far", "final", { camera: "far", trace: CAMERA_TRACE }),
  recipe("seed-0001.final", "final", { trace: SEED_TRACE }),
  recipe("seed-9e3779b9.final", "final", { seed: 0x9e3779b9, trace: SEED_TRACE }),
  recipe("temporal.t000", "final", { initialTrace: TEMPORAL_BASE_TRACE }),
  recipe("temporal.t001", "final", { initialTrace: TEMPORAL_BASE_TRACE, temporalTrace: TEMPORAL_ADVANCE }),
]);

export const FROST_COVERAGE_PROBE_RECIPES = Object.freeze([
  recipe("probe.odd-size.final", "final", {
    trace: CAMERA_TRACE,
    viewport: Object.freeze({ width: 641, height: 359, dpr: 1, physicalWidth: 641, physicalHeight: 359 }),
  }),
  recipe("probe.dpr-1.final", "final", {
    trace: CAMERA_TRACE,
    viewport: Object.freeze({ width: 400, height: 300, dpr: 1, physicalWidth: 400, physicalHeight: 300 }),
  }),
  recipe("probe.dpr-1-5.final", "final", {
    trace: CAMERA_TRACE,
    viewport: Object.freeze({ width: 400, height: 300, dpr: 1.5, physicalWidth: 600, physicalHeight: 450 }),
  }),
  recipe("probe.dpr-2.final", "final", {
    trace: CAMERA_TRACE,
    viewport: Object.freeze({ width: 400, height: 300, dpr: 2, physicalWidth: 800, physicalHeight: 600 }),
  }),
]);

export const FROST_ALL_CAPTURE_RECIPES = Object.freeze([...RECIPES, ...FROST_COVERAGE_PROBE_RECIPES]);
const RECIPE_BY_ID = new Map(FROST_ALL_CAPTURE_RECIPES.map((entry) => [entry.id, entry]));
if (RECIPE_BY_ID.size !== FROST_ALL_CAPTURE_RECIPES.length) throw new Error("frost capture recipe IDs must be unique");

export const FROST_CAPTURE_RECIPES = RECIPES;
export const FROST_CAPTURE_RECIPE_IDS = Object.freeze(RECIPES.map(({ id }) => id));
export const FROST_STANDARD_OUTPUT_PLAN = Object.freeze([
  Object.freeze({ id: "final.design", filename: "final.design.png", kind: "direct", recipeIds: Object.freeze(["final.design"]) }),
  Object.freeze({ id: "no-post.design", filename: "no-post.design.png", kind: "direct", recipeIds: Object.freeze(["no-post.design"]) }),
  Object.freeze({ id: "diagnostics.mosaic", filename: "diagnostics.mosaic.png", kind: "derived-mosaic", recipeIds: DIAGNOSTIC_RECIPE_IDS }),
  ...["camera.near", "camera.design", "camera.far", "seed-0001.final", "seed-9e3779b9.final", "temporal.t000", "temporal.t001"]
    .map((id) => Object.freeze({ id, filename: `${id}.png`, kind: "direct", recipeIds: Object.freeze([id]) })),
]);

function requireExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} keys ${actual.join(",")} do not match ${wanted.join(",")}`);
  }
}

function requireDeepFrozen(value, label) {
  if (value && typeof value === "object") {
    if (!Object.isFrozen(value)) throw new Error(`${label} must be frozen`);
    for (const [key, child] of Object.entries(value)) requireDeepFrozen(child, `${label}.${key}`);
  }
}

function validatePoint(point, label) {
  requireExactKeys(point, ["x", "y"], label);
  for (const axis of ["x", "y"]) {
    if (!Number.isFinite(point[axis]) || point[axis] < 0 || point[axis] > 1) {
      throw new RangeError(`${label}.${axis} must be a normalized history UV coordinate`);
    }
  }
}

function validateTraceStep(step, label) {
  requireExactKeys(step, ["start", "end", "pressure", "deltaSeconds"], label);
  validatePoint(step.start, `${label}.start`);
  validatePoint(step.end, `${label}.end`);
  if (!Number.isFinite(step.pressure) || step.pressure <= 0 || step.pressure > 1) {
    throw new RangeError(`${label}.pressure must be in (0, 1]`);
  }
  if (!Number.isFinite(step.deltaSeconds) || step.deltaSeconds <= 0 || step.deltaSeconds > 1 / 30) {
    throw new RangeError(`${label}.deltaSeconds must be in (0, 1/30]`);
  }
}

function validateViewport(viewport, label) {
  requireExactKeys(viewport, ["width", "height", "dpr", "physicalWidth", "physicalHeight"], label);
  for (const field of ["width", "height", "physicalWidth", "physicalHeight"]) {
    if (!Number.isInteger(viewport[field]) || viewport[field] <= 0) throw new Error(`${label}.${field} must be a positive integer`);
  }
  if (!Number.isFinite(viewport.dpr) || viewport.dpr <= 0) throw new Error(`${label}.dpr must be positive`);
  if (viewport.physicalWidth !== viewport.width * viewport.dpr
    || viewport.physicalHeight !== viewport.height * viewport.dpr) {
    throw new Error(`${label} physical extent does not equal logical extent times DPR`);
  }
}

function pointerDistance(step) {
  return Math.hypot(step.end.x - step.start.x, step.end.y - step.start.y);
}

function recipeSemanticSignature(recipeDefinition) {
  return JSON.stringify({
    target: recipeDefinition.target,
    camera: recipeDefinition.camera,
    seed: recipeDefinition.seed,
    trace: recipeDefinition.trace,
    diagnosticModes: recipeDefinition.diagnosticModes,
  });
}

export function validateFrostCaptureRecipes(recipes = FROST_CAPTURE_RECIPES, { requireFrozen = recipes === FROST_CAPTURE_RECIPES } = {}) {
  if (!Array.isArray(recipes)) throw new TypeError("frost capture recipes must be an array");
  if (recipes.length !== EXPECTED_RECIPE_IDS.length) {
    throw new Error("frost capture recipes must cover nine direct standard outputs and four diagnostic components");
  }
  const ids = recipes.map(({ id }) => id);
  if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_RECIPE_IDS)) {
    throw new Error(`frost capture recipe order ${ids.join(",")} does not match the standard output order`);
  }
  if (new Set(ids).size !== ids.length) throw new Error("frost capture recipe IDs must be unique");
  const signatures = new Set();
  for (const [index, entry] of recipes.entries()) {
    const label = `frost capture recipe ${entry?.id ?? index}`;
    requireExactKeys(entry, [
      "schemaVersion", "recipeKind", "id", "filename", "target", "scenario", "camera", "seed",
      "mechanism", "tier", "viewport",
      "initialTimeSeconds", "trace", "initialTraceLength", "temporalTraceLength", "expectedTimeSeconds",
      "historySource", "diagnosticModes", "transaction",
    ], label);
    if (entry.schemaVersion !== FROST_CAPTURE_RECIPE_SCHEMA_VERSION) throw new Error(`${label} schema version drifted`);
    if (entry.recipeKind !== FROST_CAPTURE_RECIPE_KIND) throw new Error(`${label} kind drifted`);
    if (entry.filename !== `${entry.id}.png`) throw new Error(`${label} filename is not identity-bound`);
    if (!CAPTURE_TARGETS.includes(entry.target)) throw new Error(`${label} uses unknown capture target ${entry.target}`);
    if (entry.scenario !== "touch-history-frost") throw new Error(`${label} uses another scenario`);
    if (entry.mechanism !== "refraction-and-fresnel") throw new Error(`${label} does not exercise the complete Frost mechanism`);
    if (entry.tier !== "balanced") throw new Error(`${label} does not use the frozen correctness tier`);
    if (!CAMERAS.includes(entry.camera)) throw new Error(`${label} uses unknown camera ${entry.camera}`);
    if (!Number.isInteger(entry.seed) || entry.seed < 0 || entry.seed > 0xffffffff) throw new Error(`${label} seed is not uint32`);
    validateViewport(entry.viewport, `${label}.viewport`);
    if (JSON.stringify(entry.viewport) !== JSON.stringify(DEFAULT_VIEWPORT)) throw new Error(`${label} standard viewport drifted`);
    if (entry.initialTimeSeconds !== 0) throw new Error(`${label} must begin from deterministic time zero`);
    if (!Array.isArray(entry.trace)) throw new Error(`${label} pointer trace must be an array`);
    if (entry.trace.length === 0 && entry.id !== "temporal.t000") {
      throw new Error(`${label} requires real pointer history steps`);
    }
    entry.trace.forEach((step, stepIndex) => validateTraceStep(step, `${label}.trace[${stepIndex}]`));
    if (!entry.id.startsWith("temporal.") && entry.trace.some((step) => pointerDistance(step) > 0.075)) {
      throw new Error(`${label} moves too quickly to produce legible raw history evidence`);
    }
    if (!Number.isInteger(entry.initialTraceLength) || !Number.isInteger(entry.temporalTraceLength)
      || entry.initialTraceLength + entry.temporalTraceLength !== entry.trace.length) {
      throw new Error(`${label} trace partition does not reconcile`);
    }
    const summedTime = entry.trace.reduce((sum, step) => sum + step.deltaSeconds, 0);
    if (Math.abs(summedTime - entry.expectedTimeSeconds) > 1e-12) throw new Error(`${label} expected time does not reconcile`);
    if (!entry.historySource.includes("storage-texture compute history update")) throw new Error(`${label} does not identify its GPU history source`);
    requireExactKeys(entry.transaction, ["owner", "scope", "restorePolicy", "parentRouteMutationAllowed"], `${label}.transaction`);
    if (entry.transaction.owner !== "webgpu-touch-history-frost"
      || entry.transaction.scope !== "controller-owned-history"
      || entry.transaction.restorePolicy !== "restore-entry-state-or-poison"
      || entry.transaction.parentRouteMutationAllowed !== false) {
      throw new Error(`${label} transaction contract drifted`);
    }
    const expectedDiagnostics = entry.id.startsWith("diagnostic.") ? [entry.target] : [];
    if (JSON.stringify(entry.diagnosticModes) !== JSON.stringify(expectedDiagnostics)) {
      throw new Error(`${label} diagnostic source modes drifted`);
    }
    const signature = recipeSemanticSignature(entry);
    if (signatures.has(signature)) throw new Error(`${label} semantically duplicates another standard output`);
    signatures.add(signature);
    if (requireFrozen) requireDeepFrozen(entry, label);
  }
  const byId = new Map(recipes.map((entry) => [entry.id, entry]));
  const temporal0 = byId.get("temporal.t000");
  const temporal1 = byId.get("temporal.t001");
  if (temporal0.temporalTraceLength !== 0 || temporal1.temporalTraceLength !== 1) {
    throw new Error("temporal recipes must differ by exactly one authored temporal step");
  }
  if (JSON.stringify(temporal0.trace) !== JSON.stringify(temporal1.trace.slice(0, temporal0.trace.length))) {
    throw new Error("temporal.t001 must extend the exact temporal.t000 history");
  }
  if (temporal1.trace.at(-1).deltaSeconds !== 1 / 60) throw new Error("temporal.t001 must advance exactly 1/60 second");
  const cameraRecipes = ["camera.near", "camera.design", "camera.far"].map((id) => byId.get(id));
  if (cameraRecipes.some((entry) => JSON.stringify(entry.trace) !== JSON.stringify(cameraRecipes[0].trace))) {
    throw new Error("camera recipes must share the exact authored pointer trace");
  }
  const seedBaseline = byId.get("seed-0001.final");
  const seedStress = byId.get("seed-9e3779b9.final");
  if (JSON.stringify(seedBaseline.trace) !== JSON.stringify(seedStress.trace)) {
    throw new Error("fixed-seed recipes must isolate seed as their only authored input change");
  }
  if (seedBaseline.seed === seedStress.seed) {
    throw new Error("fixed-seed recipes must declare distinct uint32 seeds");
  }
  const diagnosticTargets = DIAGNOSTIC_RECIPE_IDS.map((id) => byId.get(id)?.target);
  if (JSON.stringify(diagnosticTargets) !== JSON.stringify(FROST_DIAGNOSTIC_RECIPE_MODES)) {
    throw new Error("diagnostic component recipes must preserve the four-source mosaic order");
  }
  if (requireFrozen) requireDeepFrozen(recipes, "frost capture recipe table");
  return true;
}

export function validateFrostCoverageProbeRecipes(probes = FROST_COVERAGE_PROBE_RECIPES) {
  const expected = [
    ["probe.odd-size.final", 641, 359, 1, 641, 359],
    ["probe.dpr-1.final", 400, 300, 1, 400, 300],
    ["probe.dpr-1-5.final", 400, 300, 1.5, 600, 450],
    ["probe.dpr-2.final", 400, 300, 2, 800, 600],
  ];
  if (!Array.isArray(probes) || probes.length !== expected.length) throw new Error("Frost coverage probes must contain odd-size and three DPR recipes");
  for (const [index, entry] of probes.entries()) {
    const [id, width, height, dpr, physicalWidth, physicalHeight] = expected[index];
    if (entry.id !== id || entry.target !== "final" || entry.mechanism !== "refraction-and-fresnel" || entry.tier !== "balanced") {
      throw new Error(`Frost coverage probe ${index} identity drifted`);
    }
    validateViewport(entry.viewport, `Frost coverage probe ${id}.viewport`);
    if (JSON.stringify(entry.viewport) !== JSON.stringify({ width, height, dpr, physicalWidth, physicalHeight })) {
      throw new Error(`Frost coverage probe ${id} extent drifted`);
    }
    requireDeepFrozen(entry, `Frost coverage probe ${id}`);
  }
  return true;
}

export function validateFrostStandardOutputPlan(
  plan = FROST_STANDARD_OUTPUT_PLAN,
  { requireFrozen = plan === FROST_STANDARD_OUTPUT_PLAN } = {},
) {
  if (!Array.isArray(plan) || plan.length !== 10) throw new Error("Frost standard output plan must contain ten outputs");
  const filenames = plan.map((entry) => entry.filename);
  if (new Set(filenames).size !== filenames.length) throw new Error("Frost standard output filenames must be unique");
  for (const entry of plan) {
    requireExactKeys(entry, ["id", "filename", "kind", "recipeIds"], `Frost standard output ${entry?.id}`);
    if (entry.filename !== `${entry.id}.png`) throw new Error(`Frost standard output ${entry.id} filename drifted`);
    if (!new Set(["direct", "derived-mosaic"]).has(entry.kind)) throw new Error(`Frost standard output ${entry.id} kind drifted`);
    if (!Array.isArray(entry.recipeIds) || entry.recipeIds.length === 0) throw new Error(`Frost standard output ${entry.id} has no recipes`);
    for (const recipeId of entry.recipeIds) {
      if (!RECIPE_BY_ID.has(recipeId)) throw new Error(`Frost standard output ${entry.id} references unknown recipe ${recipeId}`);
    }
    if (entry.kind === "direct" && entry.recipeIds.length !== 1) throw new Error(`Frost direct output ${entry.id} must bind one recipe`);
    if (entry.kind === "derived-mosaic" && JSON.stringify(entry.recipeIds) !== JSON.stringify(DIAGNOSTIC_RECIPE_IDS)) {
      throw new Error("Frost diagnostics mosaic must bind all four ordered component recipes");
    }
    if (requireFrozen) requireDeepFrozen(entry, `Frost standard output ${entry.id}`);
  }
  if (requireFrozen) requireDeepFrozen(plan, "Frost standard output plan");
  return true;
}

export function resolveFrostCaptureRecipe(id) {
  const recipeDefinition = RECIPE_BY_ID.get(id);
  if (!recipeDefinition) throw new RangeError(`unknown frost capture recipe "${String(id)}"`);
  return recipeDefinition;
}

validateFrostCaptureRecipes();
validateFrostCoverageProbeRecipes();
validateFrostStandardOutputPlan();
