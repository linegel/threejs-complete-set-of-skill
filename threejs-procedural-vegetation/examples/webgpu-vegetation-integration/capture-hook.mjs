export const outputPlan = Object.freeze([
  { id: "final.design", status: "CAPTURED", filename: "final.design.png" },
  {
    id: "no-post.design",
    status: "NOT_APPLICABLE",
    filename: null,
    reason: "Vegetation integration always presents through host RenderPipeline renderOutput with no optional post stack.",
    graphProof: { finalOwner: "renderOutput", optionalPostNodes: 0 },
  },
  { id: "diagnostics.mosaic", status: "CAPTURED", filename: "diagnostics.mosaic.png" },
  {
    id: "camera.near",
    status: "NOT_APPLICABLE",
    filename: null,
    reason: "Integration lab owns a single host-camera; near/far multi-camera sweeps are not part of this host contract.",
    graphProof: { cameraIds: ["host-camera"] },
  },
  { id: "camera.design", status: "CAPTURED", filename: "camera.design.png" },
  {
    id: "camera.far",
    status: "NOT_APPLICABLE",
    filename: null,
    reason: "Integration lab owns a single host-camera; near/far multi-camera sweeps are not part of this host contract.",
    graphProof: { cameraIds: ["host-camera"] },
  },
  { id: "seed-0001.final", status: "CAPTURED", filename: "seed-0001.final.png" },
  { id: "seed-9e3779b9.final", status: "CAPTURED", filename: "seed-9e3779b9.final.png" },
  { id: "temporal.t000", status: "CAPTURED", filename: "temporal.t000.png" },
  { id: "temporal.t001", status: "CAPTURED", filename: "temporal.t001.png" },
]);

const SEED_A = 1;
const SEED_B = 0x9e3779b9;
const CAMERA = "host-camera";

async function select(session, {
  mode = "final",
  camera = CAMERA,
  seed = SEED_A,
  time = 0,
  scenario = null,
  tier = null,
} = {}) {
  if (scenario) await session.controllerCall("setScenario", scenario);
  if (tier) await session.controllerCall("setTier", tier);
  await session.controllerCall("setMode", mode);
  await session.controllerCall("setCamera", camera);
  await session.controllerCall("setSeed", seed);
  await session.controllerCall("setTime", time);
  await session.controllerCall("renderOnce");
}

async function capture(session, filename, state) {
  await select(session, state);
  return { filename, state, ...(await session.writeCapture(filename, "final")) };
}

export async function captureLab(session) {
  const captures = [];
  captures.push(await capture(session, "final.design.png", { mode: "final", camera: CAMERA }));
  captures.push(await capture(session, "diagnostics.mosaic.png", {
    mode: "weather-diagnostics", camera: CAMERA,
  }));
  captures.push(await capture(session, "camera.design.png", { mode: "final", camera: CAMERA }));
  captures.push(await capture(session, "seed-0001.final.png", { mode: "final", seed: SEED_A }));
  captures.push(await capture(session, "seed-9e3779b9.final.png", { mode: "final", seed: SEED_B }));
  captures.push(await capture(session, "temporal.t000.png", { mode: "final", time: 0 }));
  captures.push(await capture(session, "temporal.t001.png", { mode: "final", time: 1 / 60 }));
  await select(session, { mode: "final", camera: CAMERA, seed: SEED_A, time: 0 });
  return {
    schemaVersion: 2,
    captures,
    evidenceStatus: "INCOMPLETE",
    note: "Host-owned vegetation integration correctness readbacks. Release-bundle and dependency acceptance remain separate gates.",
  };
}

export default captureLab;
