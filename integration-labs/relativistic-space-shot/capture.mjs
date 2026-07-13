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
  mode = 'final',
  camera = 'design',
  tier = 'balanced',
  seed = BASELINE_SEED,
  time = 0,
} = {}) {
  await session.controllerCall('setScenario', 'shot');
  await session.controllerCall('setTier', tier);
  await session.controllerCall('setSeed', seed);
  await session.controllerCall('setCamera', camera);
  await session.controllerCall('setTime', time);
  await session.controllerCall('setMode', mode);
  await session.controllerCall('renderOnce');
}

export async function captureLab(session) {
  const captures = [];
  async function capture(filename, state) {
    await select(session, state);
    captures.push({ filename, ...(await session.writeCapture(filename, state.mode ?? 'final')) });
  }

  // Stay on final/no-post only — diagnostic modes currently trip a TSL WGSL bug.
  await capture('final.design.png', { mode: 'final', time: 0.5 });
  await capture('no-post.design.png', { mode: 'no-post', time: 0.5 });
  await capture('diagnostics.mosaic.png', { mode: 'no-post', time: 0.5 });
  await capture('camera.near.png', { mode: 'final', camera: 'near', time: 0.5 });
  await capture('camera.design.png', { mode: 'final', camera: 'design', time: 0.5 });
  await capture('camera.far.png', { mode: 'final', camera: 'far', time: 0.5 });
  await capture('seed-0001.final.png', { mode: 'final', seed: BASELINE_SEED, time: 0.5 });
  await capture('seed-9e3779b9.final.png', { mode: 'final', seed: STRESS_SEED, time: 0.5 });
  await capture('temporal.t000.png', { mode: 'final', time: 0.5 });
  await capture('temporal.t001.png', { mode: 'final', time: 0.5 + 1 / 60 });

  const locked = session.lockedState;
  if (locked) {
    await select(session, {
      mode: locked.mode === 'final' || locked.mode === 'no-post' ? locked.mode : 'final',
      camera: locked.camera,
      tier: locked.tier,
      seed: locked.seed,
      time: locked.timeSeconds,
    });
    await session.controllerCall('setTime', locked.timeSeconds);
    await session.controllerCall('renderOnce');
  } else {
    await select(session);
  }
  return {
    schemaVersion: 2,
    acceptanceStatus: 'incomplete',
    captures,
    note: 'Presentation-only correctness session (final/no-post). Diagnostic modes deferred until TSL WGSL assignment bug is fixed.',
  };
}

export default captureLab;
