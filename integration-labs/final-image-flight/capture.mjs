const BASELINE_SEED = 0x00000001;
const STRESS_SEED = 0x9e3779b9;

export const outputPlan = Object.freeze([
  { id: "final.design", status: "CAPTURED", filename: "final.design.png" },
  { id: "no-post.design", status: "CAPTURED", filename: "no-post.design.png" },
  { id: "diagnostics.mosaic", status: "CAPTURED", filename: "diagnostics.mosaic.png" },
  { id: "camera.near", status: "CAPTURED", filename: "camera.near.png" },
  { id: "camera.design", status: "CAPTURED", filename: "camera.design.png" },
  { id: "camera.far", status: "CAPTURED", filename: "camera.far.png" },
  { id: "seed-0001.final", status: "CAPTURED", filename: "seed-0001.final.png" },
  { id: "seed-9e3779b9.final", status: "CAPTURED", filename: "seed-9e3779b9.final.png" },
  { id: "temporal.t000", status: "CAPTURED", filename: "temporal.t000.png" },
  { id: "temporal.t001", status: "CAPTURED", filename: "temporal.t001.png" },
]);

async function select(session, {
  mode = "final",
  camera = "design",
  tier = "balanced",
  seed = BASELINE_SEED,
  time = 0,
} = {}) {
  await session.controllerCall("setScenario", "flight");
  await session.controllerCall("setTier", tier);
  await session.controllerCall("setSeed", seed);
  await session.controllerCall("setCamera", camera);
  await session.controllerCall("setTime", time);
  await session.controllerCall("setMode", mode);
  await session.controllerCall("renderOnce");
}

/**
 * Hook for scripts/capture-lab-browser.mjs. The shared runner owns Vite,
 * Playwright, native-WebGPU gating, aligned RGBA8 normalization, PNG encoding,
 * output confinement, and the capture-session record.
 */
export async function captureLab(session) {
  const captures = [];
  async function capture(filename, state, target = state.mode ?? "final") {
    await select(session, state);
    captures.push(await session.writeCapture(filename, target));
  }

  // Warm the motion/exposure path before the first standard slot so the
  // initial presentation readback is not an empty pre-meter frame.
  await select(session, { mode: "final", camera: "design", tier: "balanced", seed: BASELINE_SEED, time: 0 });
  await session.controllerCall("renderOnce");
  await session.controllerCall("renderOnce");

  // Prefer presentation RGBA8 for final/no-post frames; mode diagnostics use mode targets.
  await capture("final.design.png", { mode: "final" }, "presentation");
  await capture("no-post.design.png", { mode: "no-post" }, "presentation");
  await capture("diagnostics.mosaic.png", { mode: "owner-graph" }, "presentation");
  await capture("camera.near.png", { mode: "final", camera: "near" }, "presentation");
  await capture("camera.design.png", { mode: "final", camera: "design" }, "presentation");
  await capture("camera.far.png", { mode: "final", camera: "far" }, "presentation");
  await capture("seed-0001.final.png", { mode: "final", seed: BASELINE_SEED }, "presentation");
  await capture("seed-9e3779b9.final.png", { mode: "final", seed: STRESS_SEED }, "presentation");
  await capture("temporal.t000.png", { mode: "final", time: 0 }, "presentation");
  await capture("temporal.t001.png", { mode: "final", time: 1 / 60 }, "presentation");

  const locked = session.lockedState ?? {};
  await select(session, {
    mode: locked.mode ?? "final",
    camera: locked.camera ?? "design",
    tier: locked.tier ?? "balanced",
    seed: locked.seed ?? BASELINE_SEED,
    time: locked.timeSeconds ?? 0,
  });
  return {
    acceptanceStatus: "incomplete",
    captures,
    pipeline: await session.controllerCall("describePipeline"),
    resources: await session.controllerCall("describeResources"),
    metrics: await session.controllerCall("getMetrics"),
    note: "Standard render-target PNG candidates only; the complete v2 bundle, sustained timing, visual-error gates, and lifecycle loop remain uncaptured.",
  };
}

export default captureLab;
