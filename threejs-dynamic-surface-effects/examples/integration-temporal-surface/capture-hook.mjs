/** Lab-specific capture modes for temporal-surface integration. */

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

async function select(session, {
  mode = "final",
  camera = "design",
  tier = "full",
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

  await capture("final.design.png", { mode: "final" });
  await capture("no-post.design.png", { mode: "host-scene-color" });
  await capture("diagnostics.mosaic.png", { mode: "owner-graph" });
  await capture("camera.near.png", { camera: "near" });
  await capture("camera.design.png", { camera: "design" });
  await capture("camera.far.png", { camera: "far" });
  await capture("seed-0001.final.png", { seed: BASELINE_SEED });
  await capture("seed-9e3779b9.final.png", { seed: STRESS_SEED });
  await capture("temporal.t000.png", { mode: "surface-history", time: 0 });
  await capture("temporal.t001.png", { mode: "surface-history", time: 1 / 60 });

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
    note: "Host temporal presentation readbacks. Frost/image-pipeline dependency accept and GPU timestamps remain incomplete.",
  };
}

export default captureLab;
