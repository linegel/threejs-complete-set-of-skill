import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { canonicalSha256 } from '../../scripts/lib/evidence-manifest-contract.mjs';
import {
  finalizeImmutableServedLedger,
  resolveImmutableLabRequest,
} from '../../scripts/lib/immutable-lab-server.mjs';

const hash = (value) => canonicalSha256(value);

function buildFixture() {
  const manifestBytes = Buffer.from('{"fixture":true}\n');
  return {
    manifest: {
      files: {
        'index.html': { sha256: hash('index'), byteLength: 10 },
        'assets/app.js': { sha256: hash('app'), byteLength: 20 },
      },
    },
    manifestBytes,
    manifestSha256: `sha256:${'a'.repeat(64)}`,
  };
}

test('immutable lab request resolver serves only exact prebuilt paths', () => {
  const build = buildFixture();
  assert.equal(resolveImmutableLabRequest('/', build).resolvedPath, 'index.html');
  assert.equal(resolveImmutableLabRequest('/assets/app.js?x=1', build).query, 'x=1');
  assert.equal(resolveImmutableLabRequest('/missing', build).status, 404);
  assert.equal(resolveImmutableLabRequest('/%2e%2e/secret', build).status, 400);
  assert.equal(resolveImmutableLabRequest('https://example.com/index.html', build).status, 400);
});

test('immutable served ledger finalizer binds exact response records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'immutable-served-ledger-test-'));
  const path = join(directory, 'served.ndjson');
  const entries = [
    { status: 200, responseKind: 'exact-prebuilt-byte', resolvedPath: 'index.html', sha256: hash('index') },
    { status: 404, responseKind: 'missing-exact-static-route', resolvedPath: 'missing' },
  ];
  await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  const finalized = await finalizeImmutableServedLedger(path);
  assert.deepEqual(finalized.entries, entries);
  assert.equal(finalized.ledgerSha256, hash(entries));

  const invalidPath = join(directory, 'invalid.ndjson');
  await writeFile(invalidPath, '{not-json}\n');
  await assert.rejects(finalizeImmutableServedLedger(invalidPath), /invalid JSON/);
});
