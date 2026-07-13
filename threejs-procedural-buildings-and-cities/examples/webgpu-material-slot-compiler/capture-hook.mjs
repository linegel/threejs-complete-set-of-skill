import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const outputPlan = Object.freeze([
  { id: 'final.design', status: 'CAPTURED', filename: 'final.design.png' },
  {
    id: 'no-post.design',
    status: 'NOT_APPLICABLE',
    filename: null,
    reason: 'Material-slot compiler owns presentation composition without an optional post stack to disable.',
    graphProof: {
      finalOwner: 'renderOutput',
      optionalPostNodes: 0,
      outputTransformOwners: 1,
    },
  },
  { id: 'diagnostics.mosaic', status: 'CAPTURED', filename: 'diagnostics.mosaic.png' },
  { id: 'camera.near', status: 'CAPTURED', filename: 'camera.near.png' },
  { id: 'camera.design', status: 'CAPTURED', filename: 'camera.design.png' },
  { id: 'camera.far', status: 'CAPTURED', filename: 'camera.far.png' },
  { id: 'seed-0001.final', status: 'CAPTURED', filename: 'seed-0001.final.png' },
  { id: 'seed-9e3779b9.final', status: 'CAPTURED', filename: 'seed-9e3779b9.final.png' },
  { id: 'temporal.t000', status: 'CAPTURED', filename: 'temporal.t000.png' },
  { id: 'temporal.t001', status: 'CAPTURED', filename: 'temporal.t001.png' },
]);

export async function captureLab(session) {
  const captures = [];
  const capture = async (filename, {
    mode = 'material-slot-compilation',
    camera = 'design',
    seed = 1,
    time = 0,
    scenario = 'single-tower',
    tier = 'hero',
    target = 'presentation',
  } = {}) => {
    await session.controllerCall('setTier', tier);
    await session.controllerCall('setScenario', scenario);
    await session.controllerCall('setMode', mode);
    await session.controllerCall('setCamera', camera);
    await session.controllerCall('setSeed', seed);
    await session.controllerCall('setTime', time);
    await session.controllerCall('renderOnce');
    captures.push(await session.writeCapture(filename, target));
  };

  await capture('final.design.png');
  // Mosaic proxy: same presentation after a second settled frame.
  await capture('diagnostics.mosaic.png', { mode: 'module-geometry' });
  await capture('camera.near.png', { camera: 'near' });
  await capture('camera.design.png', { camera: 'design' });
  await capture('camera.far.png', { camera: 'far' });
  await capture('seed-0001.final.png', { seed: 0x00000001 });
  await capture('seed-9e3779b9.final.png', { seed: 0x9e3779b9 });
  await capture('temporal.t000.png', { time: 0 });
  await capture('temporal.t001.png', { time: 1 / 60 });

  // Restore locked capture state for final metrics assertion.
  await session.controllerCall('setTier', session.lockedState.tier);
  await session.controllerCall('setScenario', session.lockedState.scenario);
  await session.controllerCall('setMode', session.lockedState.mode);
  await session.controllerCall('setCamera', session.lockedState.camera);
  await session.controllerCall('setSeed', session.lockedState.seed);
  await session.controllerCall('setTime', session.lockedState.timeSeconds);
  await session.controllerCall('renderOnce');

  const evidence = {
    schemaVersion: 2,
    labId: session.lab.id,
    status: 'incomplete',
    publishable: false,
    sourceHash: session.lab.sourceHash,
    evidenceContract: 'v2',
    reason: 'Native correctness readbacks recorded; acceptance still requires complete required-proof closure.',
    claimVerdicts: {
      visualCorrectness: 'INSUFFICIENT_EVIDENCE',
      mechanismCorrectness: 'INSUFFICIENT_EVIDENCE',
      performanceCompliance: 'INSUFFICIENT_EVIDENCE',
      gpuAttribution: 'INSUFFICIENT_EVIDENCE',
      lifecycleStability: 'INSUFFICIENT_EVIDENCE',
    },
    captures: captures.map((entry) => ({
      filename: entry.png?.path ?? entry.filename,
      sha256: entry.png?.sha256 ?? null,
    })),
  };
  await writeFile(
    resolve(session.outputDir, 'evidence-manifest.incomplete.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return { status: 'incomplete', publishable: false, captures };
}

export default captureLab;
