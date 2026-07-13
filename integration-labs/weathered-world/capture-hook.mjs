/**
 * Weathered World capture hook.
 *
 * Lab cameras are orbit / horizon / surface. The shared harness maps near/design/far
 * only when those ids exist, which collapses all three slots onto the first camera.
 * Map the standard image slots onto the authored poses used by capture.mjs.
 */

export const outputPlan = Object.freeze([
  { id: 'final.design', status: 'CAPTURED', filename: 'final.design.png' },
  { id: 'no-post.design', status: 'CAPTURED', filename: 'no-post.design.png' },
  { id: 'diagnostics.mosaic', status: 'CAPTURED', filename: 'diagnostics.mosaic.png' },
  { id: 'camera.near', status: 'CAPTURED', filename: 'camera.near.png' },
  { id: 'camera.design', status: 'CAPTURED', filename: 'camera.design.png' },
  { id: 'camera.far', status: 'CAPTURED', filename: 'camera.far.png' },
  { id: 'seed-0001.final', status: 'CAPTURED', filename: 'seed-0001.final.png' },
  { id: 'seed-9e3779b9.final', status: 'CAPTURED', filename: 'seed-9e3779b9.final.png' },
  { id: 'temporal.t000', status: 'CAPTURED', filename: 'temporal.t000.png' },
  { id: 'temporal.t001', status: 'CAPTURED', filename: 'temporal.t001.png' },
]);

const BASELINE_SEED = 0x00000001;
const STRESS_SEED = 0x9e3779b9;

async function select(session, {
  mode = 'final',
  camera = 'horizon',
  tier = 'balanced',
  seed = BASELINE_SEED,
  time = 0,
} = {}) {
  await session.controllerCall('setTier', tier);
  await session.controllerCall('setSeed', seed);
  await session.controllerCall('setCamera', camera);
  await session.controllerCall('setTime', time);
  await session.controllerCall('setMode', mode);
  await session.controllerCall('renderOnce');
}

export async function captureLab(session) {
  const captures = [];
  const capture = async (filename, state, target = 'final') => {
    await select(session, state);
    captures.push(await session.writeCapture(filename, target));
  };

  await capture('final.design.png', { mode: 'final', camera: 'horizon' });
  await capture('no-post.design.png', { mode: 'no-post', camera: 'horizon' });
  // owner-graph is the stable diagnostic alias for this integration host.
  await capture('diagnostics.mosaic.png', { mode: 'owner-graph', camera: 'horizon' });
  await capture('camera.near.png', { mode: 'final', camera: 'surface' });
  await capture('camera.design.png', { mode: 'final', camera: 'horizon' });
  await capture('camera.far.png', { mode: 'final', camera: 'orbit' });
  await capture('seed-0001.final.png', { mode: 'final', camera: 'horizon', seed: BASELINE_SEED });
  await capture('seed-9e3779b9.final.png', { mode: 'final', camera: 'horizon', seed: STRESS_SEED });
  await capture('temporal.t000.png', { mode: 'final', camera: 'horizon', time: 0 });
  await capture('temporal.t001.png', { mode: 'final', camera: 'horizon', time: 1 / 60 });

  // Restore locked public state before session close metrics.
  await select(session, {
    mode: session.lockedState?.mode ?? 'final',
    camera: session.lockedState?.camera ?? 'horizon',
    tier: session.lockedState?.tier ?? 'balanced',
    seed: session.lockedState?.seed ?? BASELINE_SEED,
    time: session.lockedState?.time ?? 0,
  });

  return Object.freeze({ captures: Object.freeze(captures) });
}

export default captureLab;
