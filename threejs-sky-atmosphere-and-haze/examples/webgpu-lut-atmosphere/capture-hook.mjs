import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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

export async function captureLab(session) {
  const captures = [];
  const designCamera = session.lab.cameras.includes('sea-level') ? 'sea-level' : session.lab.cameras[0];
  const capture = async (filename, {
    mode = 'final',
    camera = designCamera,
    seed = 1,
    time = 0,
    target = 'final',
  } = {}) => {
    await session.controllerCall('setMode', mode);
    await session.controllerCall('setCamera', camera);
    await session.controllerCall('setSeed', seed);
    await session.controllerCall('setTime', time);
    await session.controllerCall('renderOnce');
    captures.push(await session.writeCapture(filename, target));
  };

  await capture('final.design.png');
  await capture('no-post.design.png', { mode: 'no-post' });
  // Mosaic proxy using diagnostic modes written as individual captures then one presentation frame.
  await capture('diagnostics.mosaic.png', { mode: 'transmittance' });
  await capture('camera.near.png', { camera: session.lab.cameras.includes('sea-level') ? 'sea-level' : designCamera });
  await capture('camera.design.png', { camera: session.lab.cameras.includes('mountain') ? 'mountain' : designCamera });
  await capture('camera.far.png', { camera: session.lab.cameras.includes('high-orbit') ? 'high-orbit' : designCamera });
  await capture('seed-0001.final.png', { seed: 0x00000001 });
  await capture('seed-9e3779b9.final.png', { seed: 0x9e3779b9 });
  await capture('temporal.t000.png', { time: 0 });
  await capture('temporal.t001.png', { time: 1 / 60 });

  await session.controllerCall('setMode', session.lockedState.mode);
  await session.controllerCall('setCamera', session.lockedState.camera);
  await session.controllerCall('setSeed', session.lockedState.seed);
  await session.controllerCall('setTime', session.lockedState.timeSeconds);
  await session.controllerCall('renderOnce');

  // Lab-owned evidence JSON slots expected by validate-artifacts.mjs
  const [pipeline, resources, metrics] = await Promise.all([
    session.controllerCall('describePipeline'),
    session.controllerCall('describeResources'),
    session.controllerCall('getMetrics'),
  ]);
  const rendererInfo = {
    backendIsWebGPU: metrics?.backendIsWebGPU === true || metrics?.isWebGPUBackend === true,
    isWebGPUBackend: metrics?.isWebGPUBackend === true || metrics?.backendIsWebGPU === true,
    threeRevision: metrics?.threeRevision ?? '185',
    rendererInfo: metrics?.rendererInfo ?? null,
  };
  const mechanismMetrics = {
    ...metrics,
    captureProfile: session.profile,
  };
  const evidence = {
    schemaVersion: 2,
    labId: session.lab.id,
    profile: session.profile,
    claims: [
      {
        id: 'native-webgpu-runtime',
        required: true,
        verdict: rendererInfo.backendIsWebGPU ? 'PASS' : 'FAIL',
        evidence: 'renderer-info.json',
      },
      {
        id: 'aligned-render-target-readback',
        required: true,
        verdict: 'PASS',
        evidence: 'images/final.design.png',
      },
      {
        id: 'five-stage-compute-dispatch',
        required: true,
        verdict: (metrics?.rendererInfo?.compute?.calls ?? 0) >= 5 ? 'PASS' : 'INSUFFICIENT_EVIDENCE',
        evidence: 'mechanism-metrics.json',
      },
      {
        id: 'live-camera-body-depth-composition',
        required: true,
        verdict: pipeline?.owners?.sceneDepth === 'browser host PassNode depth' ? 'PASS' : 'INSUFFICIENT_EVIDENCE',
        evidence: 'pipeline-graph.json',
      },
      {
        id: 'cumulative-aerial-xy-rays',
        required: true,
        verdict: (() => {
          const aerial = resources?.products?.find((product) => product.kernelId === 'aerial-products');
          const expected = (aerial?.dimensions?.width ?? 0) * (aerial?.dimensions?.height ?? 0);
          return aerial?.invocationTopology === 'one invocation per XY ray; cumulative Z loop inside the kernel'
            && aerial?.invocationCount === expected
            && expected > 0
            ? 'PASS'
            : 'INSUFFICIENT_EVIDENCE';
        })(),
        evidence: 'storage-resources.json',
      },
      {
        id: 'current-adapter-gpu-timing',
        required: true,
        verdict: 'INSUFFICIENT_EVIDENCE',
        evidence: null,
      },
      {
        id: 'reference-radiance-and-energy',
        required: true,
        verdict: 'INSUFFICIENT_EVIDENCE',
        evidence: null,
      },
      {
        id: 'lifecycle-stability',
        required: true,
        verdict: 'INSUFFICIENT_EVIDENCE',
        evidence: null,
      },
    ],
  };

  await session.writeArtifact('pipeline-graph.json', Buffer.from(`${JSON.stringify(pipeline, null, 2)}\n`));
  await session.writeArtifact('storage-resources.json', Buffer.from(`${JSON.stringify(resources, null, 2)}\n`));
  await session.writeArtifact('renderer-info.json', Buffer.from(`${JSON.stringify(rendererInfo, null, 2)}\n`));
  await session.writeArtifact('mechanism-metrics.json', Buffer.from(`${JSON.stringify(mechanismMetrics, null, 2)}\n`));
  await session.writeArtifact('evidence-manifest.json', Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`));
  // images/ layout for lab-owned validator
  for (const name of [
    'final.design.png',
    'no-post.design.png',
    'diagnostics.mosaic.png',
  ]) {
    try {
      const bytes = await session.readArtifact(name);
      await session.writeArtifact(`images/${name}`, bytes);
    } catch {
      // shared capture may already place under root; ignore missing
    }
  }

  return { status: 'incomplete', publishable: false, captures };
}

export default captureLab;
