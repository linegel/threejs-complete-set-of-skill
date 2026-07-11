const BASELINE_SEED = 0x00000001;
const STRESS_SEED = 0x9e3779b9;

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
    captures.push({ filename, ...(await session.writeCapture(filename, target)) });
  }

  await capture("final.design.png", { mode: "final" });
  await capture("no-post.design.png", { mode: "no-post" });
  await capture("diagnostics.mosaic.png", { mode: "owner-graph" });
  await capture("camera.near.png", { mode: "final", camera: "near" });
  await capture("camera.design.png", { mode: "final", camera: "design" });
  await capture("camera.far.png", { mode: "final", camera: "far" });
  await capture("seed-0001.final.png", { mode: "final", seed: BASELINE_SEED });
  await capture("seed-9e3779b9.final.png", { mode: "final", seed: STRESS_SEED });
  await capture("temporal.t000.png", { mode: "final", time: 0 });
  await capture("temporal.t001.png", { mode: "final", time: 1 / 60 });
  await capture("tier.hero.png", { mode: "final", tier: "hero" });
  await capture("tier.balanced.png", { mode: "final", tier: "balanced" });
  await capture("tier.budgeted.png", { mode: "final", tier: "budgeted" });
  await capture("shadow-contribution.png", { mode: "shadow-contribution", tier: "balanced" });

  await select(session, { mode: "final", camera: "design", tier: "balanced", seed: BASELINE_SEED, time: 0 });
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
