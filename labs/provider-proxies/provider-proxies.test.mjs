import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'assets.manifest.json'), 'utf8'));
const source = await readFile(join(root, 'provider-demo.mjs'), 'utf8');
const skills = JSON.parse(await readFile(join(root, '..', '..', 'skills.json'), 'utf8'));

assert.equal(manifest.kind, 'generated-asset-demo');
assert.equal(manifest.status, 'secondary');
assert.equal(manifest.license, 'ISC');
assert.match(manifest.provenance.limitation, /not native-WebGPU mechanism evidence/i);

const actualFiles = (await readdir(join(root, 'generated-variants')))
  .filter((name) => name.endsWith('.png'))
  .sort();
assert.deepEqual(manifest.assets.map((asset) => asset.file).sort(), actualFiles);

for (const asset of manifest.assets) {
  const bytes = await readFile(join(root, 'generated-variants', asset.file));
  assert.equal(bytes.toString('ascii', 1, 4), 'PNG');
  assert.equal(bytes.length, asset.bytes, `${asset.file} byte count`);
  assert.equal(bytes.readUInt32BE(16), asset.width, `${asset.file} width`);
  assert.equal(bytes.readUInt32BE(20), asset.height, `${asset.file} height`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, `${asset.file} hash`);
}

for (const required of [
  'Generated asset preview',
  'Concept proxy',
  'Secondary presentation only',
  'Open canonical lab or contract',
  'canonicalHref',
  'classification',
]) {
  assert.ok(source.includes(required), `provider runtime missing ${required}`);
}

assert.doesNotMatch(source, /QA evidence frame/);
assert.doesNotMatch(source, /QA Evidence/);

const providerDemos = skills.skills.flatMap((skill) => skill.demos ?? [])
  .filter((demo) => (demo.canonicalSource ?? []).some((path) => path.startsWith('labs/provider-proxies/')));
assert.equal(providerDemos.length, 26);
for (const demo of providerDemos) {
  assert.ok(['proxy-demo', 'generated-asset-demo'].includes(demo.kind), `${demo.id} kind`);
  assert.equal(demo.status, 'secondary', `${demo.id} status`);
  assert.ok(demo.proxyStatus?.limitation, `${demo.id} limitation`);
}

console.log(JSON.stringify({
  pass: true,
  classification: ['proxy-demo', 'generated-asset-demo'],
  status: 'secondary',
  assets: manifest.assets.length,
  demos: providerDemos.length,
}, null, 2));
