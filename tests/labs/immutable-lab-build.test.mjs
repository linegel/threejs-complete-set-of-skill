import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { canonicalSha256 } from '../../scripts/lib/evidence-manifest-contract.mjs';
import {
  IMMUTABLE_LAB_BUILD_CONTRACT,
  IMMUTABLE_LAB_BUILD_MANIFEST,
  loadAndValidateImmutableLabBuild,
} from '../../scripts/lib/immutable-lab-build.mjs';

const hash = (value) => canonicalSha256(value);

async function fixture({ drift = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'immutable-lab-build-test-'));
  const indexBytes = Buffer.from('<!doctype html><title>fixture</title>');
  await writeFile(join(directory, 'index.html'), drift ? Buffer.from('drift') : indexBytes);
  const files = {
    'index.html': { sha256: `sha256:${createHash('sha256').update(indexBytes).digest('hex')}`, byteLength: indexBytes.byteLength },
  };
  const sourceClosure = {
    algorithm: 'demo-registry-transitive-source-closure-v2',
    roots: [ 'fixture' ],
    files: null,
    sourceHash: hash('source'),
    buildRevision: hash('build'),
    threeRevision: '0.185.1',
  };
  const manifest = {
    schemaVersion: 1,
    kind: 'immutable-lab-build-v1',
    builderContract: IMMUTABLE_LAB_BUILD_CONTRACT,
    labId: 'fixture-lab',
    immutable: true,
    viteDevelopmentServer: false,
    transformAtServe: false,
    redirects: false,
    spaFallback: false,
    contentAddress: hash({
      builderContract: IMMUTABLE_LAB_BUILD_CONTRACT,
      entrypointPlan: [ 'index.html' ],
      labId: 'fixture-lab',
      sourceClosureHash: sourceClosure.sourceHash,
      buildRevision: sourceClosure.buildRevision,
      threeRevision: sourceClosure.threeRevision,
    }),
    sourceClosureHash: sourceClosure.sourceHash,
    buildRevision: sourceClosure.buildRevision,
    sourceClosure,
    threeRevision: '0.185.1',
    bundleHash: hash(files),
    entrypoints: [ 'index.html' ],
    files,
  };
  await writeFile(join(directory, IMMUTABLE_LAB_BUILD_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return directory;
}

test('immutable lab build validator binds exact prebuilt bytes and source identity', async () => {
  const directory = await fixture();
  const result = await loadAndValidateImmutableLabBuild(directory, { expectedLabId: 'fixture-lab' });
  assert.equal(result.manifest.bundleHash, hash(result.manifest.files));
  assert.equal(result.manifest.viteDevelopmentServer, false);
  assert.equal(result.manifest.entrypoints[0], 'index.html');
});

test('immutable lab build validator rejects drifted bytes and swapped lab identity', async () => {
  await assert.rejects(loadAndValidateImmutableLabBuild(await fixture({ drift: true })), /file ledger drifted/);
  await assert.rejects(
    loadAndValidateImmutableLabBuild(await fixture(), { expectedLabId: 'another-lab' }),
    /belongs to another lab/,
  );
});
