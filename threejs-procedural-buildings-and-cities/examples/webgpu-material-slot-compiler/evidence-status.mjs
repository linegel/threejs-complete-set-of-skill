#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const operation = process.argv[2] ?? 'status';
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const artifactDir = resolve(repoRoot, 'artifacts/visual-validation/webgpu-material-slot-compiler/correctness');

function sha256(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

if (operation === 'validate:artifacts' || operation === 'validate') {
  const required = [
    'capture-session.json',
    'final.design.png',
    'diagnostics.mosaic.png',
    'camera.near.png',
    'camera.design.png',
    'camera.far.png',
    'seed-0001.final.png',
    'seed-9e3779b9.final.png',
    'temporal.t000.png',
    'temporal.t001.png',
  ];
  const missing = required.filter((name) => !existsSync(resolve(artifactDir, name)));
  if (missing.length) {
    console.error(JSON.stringify({
      verdict: 'INSUFFICIENT_EVIDENCE',
      operation,
      lab: 'webgpu-material-slot-compiler',
      reason: `missing artifacts: ${missing.join(', ')}`,
    }, null, 2));
    process.exitCode = 2;
  } else {
    const session = JSON.parse(readFileSync(resolve(artifactDir, 'capture-session.json'), 'utf8'));
    if (session.labId !== 'webgpu-material-slot-compiler') throw new Error('wrong labId in capture-session');
    if (session.runtime?.metrics?.isWebGPUBackend !== true && session.runtime?.metrics?.backendIsWebGPU !== true
      && session.runtime?.metrics?.nativeWebGPU !== true) {
      throw new Error('capture-session lacks native WebGPU proof');
    }
    const hashes = Object.fromEntries(required.filter((n) => n.endsWith('.png')).map((n) => [n, sha256(resolve(artifactDir, n))]));
    if (hashes['final.design.png'] === hashes['diagnostics.mosaic.png']) {
      throw new Error('final and diagnostics images are falsely identical');
    }
    if (hashes['seed-0001.final.png'] === hashes['seed-9e3779b9.final.png']) {
      throw new Error('seed variants are falsely identical');
    }
    console.log(JSON.stringify({
      pass: true,
      verdict: 'PASS',
      operation,
      lab: 'webgpu-material-slot-compiler',
      artifactDir,
      sourceHash: session.sourceClosureHash ?? session.sourceHash,
      imageHashes: hashes,
    }, null, 2));
  }
} else {
  console.log(JSON.stringify({
    verdict: existsSync(resolve(artifactDir, 'capture-session.json')) ? 'CAPTURED_INCOMPLETE' : 'INSUFFICIENT_EVIDENCE',
    operation,
    lab: 'webgpu-material-slot-compiler',
    artifactDir,
  }, null, 2));
}
