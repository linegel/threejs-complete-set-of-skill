/** Lab-specific capture modes for precipitation/image-pipeline integration. */

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

const BASELINE_SEED = 0x00000001;
const STRESS_SEED = 0x9e3779b9;
// Weather must be advanced so wetness/particles are visible; pure t=0 after
// reset is nearly empty. Use final-mode frames at well-separated times so
// temporal pairs are multi-color scene readbacks that differ from each other
// (not solid diagnostic fills, not duplicates of final.design).
const DESIGN_TIME = 2.0;
const TEMPORAL_T0 = 1.0;
const TEMPORAL_T1 = 3.0;

async function select(session, {
  mode = "final",
  camera = "design",
  tier = "high",
  seed = BASELINE_SEED,
  time = 0,
} = {}) {
  await session.controllerCall("setTier", tier);
  await session.controllerCall("setMode", mode);
  await session.controllerCall("setCamera", camera);
  await session.controllerCall("setSeed", seed);
  await session.controllerCall("setTime", time);
  await session.controllerCall("renderOnce");
}

export async function captureLab(session) {
  const captures = [];
  async function capture(filename, state) {
    await select(session, state);
    captures.push({ filename, ...(await session.writeCapture(filename, "presentation")) });
  }

  await capture("final.design.png", { mode: "final", time: DESIGN_TIME });
  // Wetness shows real road geometry/material response (not a solid diagnostic fill).
  await capture("no-post.design.png", { mode: "wetness", time: DESIGN_TIME });
  // Particles mode is a multi-color scene diagnostic (rain/snow instances over the host scene).
  await capture("diagnostics.mosaic.png", { mode: "particles", time: DESIGN_TIME });
  await capture("camera.near.png", { camera: "near", mode: "final", time: DESIGN_TIME });
  await capture("camera.design.png", { camera: "design", mode: "final", time: DESIGN_TIME });
  await capture("camera.far.png", { camera: "far", mode: "final", time: DESIGN_TIME });
  await capture("seed-0001.final.png", { seed: BASELINE_SEED, mode: "final", time: DESIGN_TIME });
  await capture("seed-9e3779b9.final.png", { seed: STRESS_SEED, mode: "final", time: DESIGN_TIME });
  // Temporal pair: final presentation at two well-separated times (must differ from each other and from final.design).
  await capture("temporal.t000.png", { mode: "final", time: TEMPORAL_T0 });
  await capture("temporal.t001.png", { mode: "final", time: TEMPORAL_T1 });

  const locked = session.lockedState;
  if (locked) {
    await select(session, {
      mode: locked.mode,
      camera: locked.camera,
      tier: locked.tier,
      seed: locked.seed,
      time: locked.timeSeconds,
    });
  } else {
    await select(session);
  }
  return {
    schemaVersion: 2,
    acceptanceStatus: "incomplete",
    captures,
    note: "Host-owned multi-color presentation readbacks (final/wetness/particles). Dependency primaries and GPU timestamps remain incomplete.",
  };
}

export default captureLab;
