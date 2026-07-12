export const CORPUS_CAPTURE_TARGET_IDS = Object.freeze([
  "articulated-desk-lamp",
  "potted-bonsai",
  "ceramic-teapot",
]);

export const CORPUS_REPRESENTATIVE_SEED = 1;
export const CORPUS_STRESS_SEED = 2654435769;

export const CORPUS_RASTER_GATES = Object.freeze({
  replay: Object.freeze({ rgbMaeMaximum: 0.01, changedPixelRatioMaximum: 0.005, maxChannelDeltaMaximum: 32 }),
  stress: Object.freeze({ rgbMaeMinimum: 0.02, changedPixelRatioMinimum: 0.01 }),
  motion: Object.freeze({ rgbMaeMinimum: 0.05, changedPixelRatioMinimum: 0.01 }),
});

export const CORPUS_STANDARD_RASTER_CONTRACT = Object.freeze({
  width: 1200,
  height: 800,
  panelCount: 3,
  panelWidth: 400,
  panelHeight: 800,
  layout: "horizontal-equal-width",
  sourcePolicy: "full-frame",
  cropPolicy: "none",
  resamplingKernel: "nearest-center-rgba8-v1",
  coordinateRule: "source=floor((destination+0.5)*sourceExtent/destinationExtent)",
  edgeMode: "clamp",
  colorDomain: "encoded-rgba8",
});

const STATE_TEMPLATES = Object.freeze([
  Object.freeze({ label: "final.full.design", mode: "final", tier: "full", camera: "design", seed: CORPUS_REPRESENTATIVE_SEED, seedPhase: "A0", seedCaseId: "final-full-design", time: 0 }),
  Object.freeze({ label: "blockout.full.design", mode: "blockout", tier: "full", camera: "design", time: 0 }),
  Object.freeze({ label: "hierarchy.full.design", mode: "hierarchy", tier: "full", camera: "design", time: 0 }),
  Object.freeze({ label: "materials.full.close-material", mode: "materials", tier: "full", camera: "close-material", time: 0 }),
  Object.freeze({ label: "action-ready.full.design.t000", mode: "action-ready", tier: "full", camera: "design", seedPhase: "A0", seedCaseId: "action-ready-t000", time: 0 }),
  Object.freeze({ label: "action-ready.full.design.t200", mode: "action-ready", tier: "full", camera: "design", seedPhase: "A0", seedCaseId: "action-ready-t200", time: 2 }),
  Object.freeze({ label: "final.budgeted.design", mode: "final", tier: "budgeted", camera: "design", time: 0 }),
  Object.freeze({ label: "final.minimum.design", mode: "final", tier: "minimum", camera: "design", time: 0 }),
  Object.freeze({ label: "final.full.profile", mode: "final", tier: "full", camera: "profile", time: 0 }),
  Object.freeze({ label: "final.full.close-material", mode: "final", tier: "full", camera: "close-material", time: 0 }),
  Object.freeze({ label: "final.full.attachment", mode: "final", tier: "full", camera: "attachment", time: 0 }),
  Object.freeze({ label: "final.full.design.stress-seed", mode: "final", tier: "full", camera: "design", seed: CORPUS_STRESS_SEED, seedPhase: "B", seedCaseId: "final-full-design", time: 0 }),
  Object.freeze({ label: "final.full.profile.stress-seed", mode: "final", tier: "full", camera: "profile", seed: CORPUS_STRESS_SEED, seedPhase: "B", seedCaseId: "final-full-profile", time: 0 }),
  Object.freeze({ label: "action-ready.full.design.stress-seed.t000", mode: "action-ready", tier: "full", camera: "design", seed: CORPUS_STRESS_SEED, seedPhase: "B", seedCaseId: "action-ready-t000", time: 0 }),
  Object.freeze({ label: "action-ready.full.design.stress-seed.t200", mode: "action-ready", tier: "full", camera: "design", seed: CORPUS_STRESS_SEED, seedPhase: "B", seedCaseId: "action-ready-t200", time: 2 }),
  Object.freeze({ label: "final.full.design.representative-replay", mode: "final", tier: "full", camera: "design", seed: CORPUS_REPRESENTATIVE_SEED, seedPhase: "A1", seedCaseId: "final-full-design", time: 0 }),
]);

export const CORPUS_CAPTURE_PLAN = Object.freeze(CORPUS_CAPTURE_TARGET_IDS.flatMap((subjectId) => (
  STATE_TEMPLATES.map((template) => Object.freeze({
    filename: `${subjectId}.${template.label}.png`,
    state: Object.freeze({
      subjectId,
      mode: template.mode,
      tier: template.tier,
      camera: template.camera,
      seed: template.seed ?? CORPUS_REPRESENTATIVE_SEED,
      seedPhase: template.seedPhase ?? "representative",
      seedCaseId: template.seedCaseId ?? template.label,
      time: template.time,
    }),
  }))
)));

if (CORPUS_CAPTURE_PLAN.length !== 48) throw new Error(`Object Sculptor correctness plan must contain exactly 48 source PNGs; received ${CORPUS_CAPTURE_PLAN.length}`);
for (const subjectId of CORPUS_CAPTURE_TARGET_IDS) {
  const count = CORPUS_CAPTURE_PLAN.filter(({ state }) => state.subjectId === subjectId).length;
  if (count !== 16) throw new Error(`${subjectId} must contribute exactly 16 correctness PNGs; received ${count}`);
}

function subjectCaptureFilenames(fragment) {
  return Object.freeze(CORPUS_CAPTURE_TARGET_IDS.map((subjectId) => `${subjectId}.${fragment}.png`));
}

export const CORPUS_STANDARD_OUTPUT_PLAN = Object.freeze([
  Object.freeze({ id: "final.design", status: "CAPTURED", filename: "final.design.png", sourceCaptures: subjectCaptureFilenames("final.full.design") }),
  Object.freeze({ id: "no-post.design", status: "NOT_APPLICABLE", filename: null, reason: "The corpus has one direct forward scene pass and no post-processing graph.", graphProof: Object.freeze({ requiredPasses: Object.freeze(["forward-scene"]), requiredPostprocessing: false }) }),
  Object.freeze({ id: "diagnostics.mosaic", status: "CAPTURED", filename: "diagnostics.mosaic.png", sourceCaptures: Object.freeze(["articulated-desk-lamp.blockout.full.design.png", "potted-bonsai.hierarchy.full.design.png", "ceramic-teapot.materials.full.close-material.png"]) }),
  Object.freeze({ id: "camera.near", status: "CAPTURED", filename: "camera.near.png", sourceCaptures: subjectCaptureFilenames("final.full.close-material") }),
  Object.freeze({ id: "camera.design", status: "CAPTURED", filename: "camera.design.png", sourceCaptures: subjectCaptureFilenames("final.budgeted.design") }),
  Object.freeze({ id: "camera.far", status: "NOT_APPLICABLE", filename: null, reason: "The authored corpus camera contract has design, profile, attachment, and close-material bookmarks but no far bookmark.", graphProof: Object.freeze({ authoredCameraIds: Object.freeze(["design", "profile", "attachment", "close-material"]), omittedCameraId: "far" }) }),
  Object.freeze({ id: "seed-0001.final", status: "CAPTURED", filename: "seed-0001.final.png", sourceCaptures: subjectCaptureFilenames("final.full.profile") }),
  Object.freeze({ id: "seed-9e3779b9.final", status: "CAPTURED", filename: "seed-9e3779b9.final.png", sourceCaptures: subjectCaptureFilenames("final.full.profile.stress-seed") }),
  Object.freeze({ id: "temporal.t000", status: "CAPTURED", filename: "temporal.t000.png", sourceCaptures: subjectCaptureFilenames("action-ready.full.design.t000") }),
  Object.freeze({ id: "temporal.t001", status: "CAPTURED", filename: "temporal.t001.png", sourceCaptures: subjectCaptureFilenames("action-ready.full.design.t200") }),
]);

function captureFilename(subjectId, fragment) {
  const filename = `${subjectId}.${fragment}.png`;
  if (!CORPUS_CAPTURE_PLAN.some((entry) => entry.filename === filename)) throw new Error(`missing raster comparison capture ${filename}`);
  return filename;
}

function buildRasterComparisonPlan() {
  const records = [];
  for (const subjectId of CORPUS_CAPTURE_TARGET_IDS) {
    for (const [caseId, a0Fragment, bFragment] of [
      ["final-full-design", "final.full.design", "final.full.design.stress-seed"],
      ["action-ready-t000", "action-ready.full.design.t000", "action-ready.full.design.stress-seed.t000"],
      ["action-ready-t200", "action-ready.full.design.t200", "action-ready.full.design.stress-seed.t200"],
    ]) records.push(Object.freeze({ id: `raster-stress:${subjectId}:${caseId}`, kind: "stress", leftFilename: captureFilename(subjectId, a0Fragment), rightFilename: captureFilename(subjectId, bFragment) }));
    records.push(
      Object.freeze({ id: `raster-replay:${subjectId}:final-full-design`, kind: "replay", leftFilename: captureFilename(subjectId, "final.full.design"), rightFilename: captureFilename(subjectId, "final.full.design.representative-replay") }),
      Object.freeze({ id: `raster-motion:${subjectId}:A0`, kind: "motion", leftFilename: captureFilename(subjectId, "action-ready.full.design.t000"), rightFilename: captureFilename(subjectId, "action-ready.full.design.t200") }),
      Object.freeze({ id: `raster-motion:${subjectId}:B`, kind: "motion", leftFilename: captureFilename(subjectId, "action-ready.full.design.stress-seed.t000"), rightFilename: captureFilename(subjectId, "action-ready.full.design.stress-seed.t200") }),
    );
  }
  return records;
}

export const CORPUS_RASTER_COMPARISON_PLAN = Object.freeze(buildRasterComparisonPlan());

const FINAL_MASK_TIERS = Object.freeze(["full", "budgeted", "minimum"]);
const ACTION_MASK_TIMES = Object.freeze([Object.freeze({ suffix: "t000", time: 0 }), Object.freeze({ suffix: "t200", time: 2 })]);

export const CORPUS_TARGET_MASK_PLAN = Object.freeze(CORPUS_CAPTURE_TARGET_IDS.flatMap((subjectId) => [
  ...FINAL_MASK_TIERS.map((tier) => Object.freeze({
    id: `target-mask:${subjectId}:final:${tier}`,
    filename: `${subjectId}.final.${tier}.target-mask.png`,
    subjectId,
    maskKind: "subject-silhouette",
    mode: "final",
    tier,
    camera: "design",
    seed: CORPUS_REPRESENTATIVE_SEED,
    time: 0,
    sourceCaptureFilename: `${subjectId}.final.${tier}.design.png`,
  })),
  ...ACTION_MASK_TIMES.map(({ suffix, time }) => Object.freeze({
    id: `target-mask:${subjectId}:action-ready:${suffix}`,
    filename: `${subjectId}.action-ready.full.design.${suffix}.target-mask.png`,
    subjectId,
    maskKind: "named-moving-semantic-regions",
    mode: "action-ready",
    tier: "full",
    camera: "design",
    seed: CORPUS_REPRESENTATIVE_SEED,
    time,
    sourceCaptureFilename: `${subjectId}.action-ready.full.design.${suffix}.png`,
  })),
]));

if (CORPUS_TARGET_MASK_PLAN.length !== 15) throw new Error(`Object Sculptor target-mask plan must contain 15 records; received ${CORPUS_TARGET_MASK_PLAN.length}`);
if (new Set(CORPUS_TARGET_MASK_PLAN.map(({ filename }) => filename)).size !== CORPUS_TARGET_MASK_PLAN.length) throw new Error("Object Sculptor target-mask filenames must be unique");

export const CORPUS_NATIVE_READBACK_PLAN = Object.freeze([
  ...CORPUS_CAPTURE_PLAN.map((capture) => Object.freeze({ kind: "presentation", filename: capture.filename, state: capture.state })),
  ...CORPUS_TARGET_MASK_PLAN.map((mask) => Object.freeze({
    kind: "target-mask",
    filename: mask.filename,
    state: Object.freeze({ subjectId: mask.subjectId, mode: mask.mode, tier: mask.tier, camera: mask.camera, seed: mask.seed, time: mask.time }),
    maskKind: mask.maskKind,
  })),
]);

if (CORPUS_NATIVE_READBACK_PLAN.length !== 63) throw new Error("Object Sculptor native readback plan must contain 63 records");
