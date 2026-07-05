import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { decodeGeneratedRgbaPng } from '../../../threejs-visual-validation/examples/webgpu-validation-harness/src/png.js';
import { validateArtifactBundle, getRequiredImagePaths } from '../../../threejs-visual-validation/examples/webgpu-validation-harness/src/schema/artifact-schemas.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../../../../');
const defaultArtifactDir = resolve(projectRoot, 'threejs-procedural-creatures/examples/webgpu-procedural-creature-lab/artifacts');

function absDiff(a, b) {
  return Math.abs(a - b);
}

function sumDifferences(a, b) {
  const h = Math.min(a.height, b.height);
  const w = Math.min(a.width, b.width);
  let sum = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const aOffset = y * w * 4 + x * 4;
      const bOffset = y * w * 4 + x * 4;
      for (let i = 0; i < 3; i += 1) {
        sum += absDiff(a.raw[aOffset + i + 1], b.raw[bOffset + i + 1]);
      }
    }
  }
  return sum / (h * w);
}

async function readManifest(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function requireFile(path) {
  if (!existsSync(path)) {
    return false;
  }
  return true;
}

function validateGateRow(name, passed, details = null) {
  return { name, status: passed ? 'pass' : 'fail', details };
}

export async function validateManifestArtifacts(artifactDirArg = defaultArtifactDir) {
  const base = resolve(artifactDirArg);
  const requiredImages = getRequiredImagePaths('creature-lab').concat([
    'images/final.design.png',
    'images/no-post.design.png',
    'images/diagnostics.mosaic.png',
    'images/final.debug.off.png',
    'images/final.debug.unsnapped.png',
    'images/final.debug.distance.png',
    'images/final.debug.normals.png',
    'images/final.debug.weights.png',
  ]);

  const reports = [];
  let allPass = true;

  const manifestPath = resolve(base, 'manifest.json');
  const evidenceManifestPath = resolve(base, 'evidence-manifest.json');
  const metricsPath = resolve(base, 'metrics.json');
  const visualContractPath = resolve(base, 'visual-contract.json');

  if (!requireFile(manifestPath)) {
    reports.push(validateGateRow('manifest.exists', false, { path: manifestPath }));
    return {
      status: 'fail',
      summary: { passCount: reports.filter((entry) => entry.status === 'pass').length, failCount: reports.length },
      gates: reports,
    };
  }

  const manifest = await readManifest(manifestPath);
  const schemaPath = resolve(base, 'manifest.schema.json');
  if (!existsSync(schemaPath)) {
    reports.push(validateGateRow('manifest.schema-missing', false, { path: schemaPath }));
    allPass = false;
  } else {
    const schema = await readManifest(schemaPath);
    const required = validateArtifactBundle(manifest, schema);
    reports.push(validateGateRow('manifest.schema', required === null, { schema: typeof required }));
  }

  const metrics = await readManifest(metricsPath).catch(() => ({}));
  const requiredFields = [ 'spawnMedianMs', 'firstFrameRatio', 'pipelineCompilesAfterReveal', 'bufferReallocsAfterInit', 'deterministicPair', 'renderMs', 'msByTier', 'silhouetteDiffTexels' ];
  const metricPresence = requiredFields.every((field) => Object.hasOwn(metrics, field));
  reports.push(validateGateRow('artifact.metrics-presence', metricPresence));

  for (const imagePath of requiredImages) {
    const fullImage = resolve(base, imagePath);
    if (!requireFile(fullImage)) {
      reports.push(validateGateRow('artifact.image', false, { path: fullImage }));
      allPass = false;
      continue;
    }
    reports.push(validateGateRow('artifact.image', true, { path: imagePath }));
  }

  const seedGrid = resolve(base, 'images/seed-grid.png');
  if (!requireFile(seedGrid)) {
    reports.push(validateGateRow('artifact.seedGrid', false, { path: 'images/seed-grid.png' }));
  } else {
    const png = await readFileSync(seedGrid);
    const decoded = decodeGeneratedRgbaPng(png);
    reports.push(validateGateRow('artifact.seedGrid', decoded.width > 0 && decoded.height > 0, decoded));
  }

  if (Object.hasOwn(metrics, 'visualContractPath')) {
    const contractPath = resolve(projectRoot, metrics.visualContractPath);
    if (requireFile(contractPath)) {
      reports.push(validateGateRow('artifact.visual-contract', true, { path: contractPath }));
    } else {
      reports.push(validateGateRow('artifact.visual-contract', false, { path: contractPath }));
      allPass = false;
    }
  }

  if (Object.hasOwn(metrics, 'windowLabSnapshotPath')) {
    const snapPath = resolve(base, metrics.windowLabSnapshotPath);
    if (!requireFile(snapPath)) {
      reports.push(validateGateRow('artifact.lab-snapshot', false, { path: snapPath }));
      allPass = false;
    } else {
      reports.push(validateGateRow('artifact.lab-snapshot', true, { path: snapPath }));
    }
  }

  const bootstrap = {}
  return {
    status: allPass && reports.every((entry) => entry.status === 'pass') ? 'pass' : 'fail',
    gates: reports,
    summary: {
      passCount: reports.filter((entry) => entry.status === 'pass').length,
      failCount: reports.filter((entry) => entry.status === 'fail').length,
      path: base,
      artifactManifest: manifest,
      bootstrap,
      requiredImages,
    },
  };
}

if (import.meta.url === `file://${ process.argv[1] }`) {
  const artifactArg = process.argv.includes('--artifact-dir')
    ? process.argv[process.argv.indexOf('--artifact-dir') + 1]
    : defaultArtifactDir;
  const result = await validateManifestArtifacts(artifactArg);
  if (result.status !== 'pass') {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}
