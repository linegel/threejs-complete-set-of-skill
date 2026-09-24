import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import sharp from 'sharp';
import { responsiveDependencyHash, sha256 } from '../../scripts/lib/generated-asset-ledger.mjs';
import { encodeResponsivePreview } from '../../scripts/lib/responsive-image-encoder.mjs';

const artifacts = fileURLToPath(new URL('../../artifacts/responsive-image-tests/', import.meta.url));
const site = 'https://threejs-skills.com/';

async function fixture() {
  mkdirSync(artifacts, { recursive: true });
  const docsRoot = mkdtempSync(join(artifacts, 'case-'));
  const source = join(docsRoot, 'previews', 'primary', 'test.png');
  mkdirSync(dirname(source), { recursive: true });
  await sharp({ create: { width: 3, height: 2, channels: 4, background: '#3a7ba4' } }).png().toFile(source);
  const options = { docsRoot, site };
  const { record } = await encodeResponsivePreview(source, options);
  return { source, options, record };
}

test('unchanged input reuses byte-verified files without rewriting them', async () => {
  const { source, options, record } = await fixture();
  for (const format of ['avif', 'webp']) {
    utimesSync(source.replace('.png', `.${format}`), new Date(0), new Date(0));
  }
  const result = await encodeResponsivePreview(source, { ...options, previous: record });
  assert.equal(result.reused, true);
  assert.deepEqual(result.record, record);
  for (const format of ['avif', 'webp']) {
    const path = source.replace('.png', `.${format}`);
    assert.equal(statSync(path).mtimeMs, 0);
    assert.equal(sha256(readFileSync(path)), record.formats[format].sha256);
    const metadata = await sharp(path).metadata();
    assert.deepEqual([metadata.width, metadata.height], [3, 2]);
  }
});

test('PNG changes invalidate outputs even when dimensions stay the same', async () => {
  const { source, options, record } = await fixture();
  await sharp({ create: { width: 3, height: 2, channels: 4, background: '#ed9741' } }).png().toFile(source);
  const result = await encodeResponsivePreview(source, { ...options, previous: record });
  assert.equal(result.reused, false);
  assert.notEqual(result.record.sourceSha256, record.sourceSha256);
  assert.notEqual(result.record.formats.avif.sha256, record.formats.avif.sha256);
});

test('missing and damaged output files are rebuilt from the PNG', async () => {
  const { source, options, record } = await fixture();
  const avif = source.replace('.png', '.avif');
  renameSync(avif, `${avif}.saved`);
  assert.equal((await encodeResponsivePreview(source, { ...options, previous: record })).reused, false);
  assert.equal(sha256(readFileSync(avif)), record.formats.avif.sha256);
  const webp = source.replace('.png', '.webp');
  writeFileSync(webp, Buffer.alloc(record.formats.webp.bytes));
  assert.equal((await encodeResponsivePreview(source, { ...options, previous: record })).reused, false);
  assert.equal(sha256(readFileSync(webp)), record.formats.webp.sha256);
});

test('legacy, encoder, dimension, and destination drift cannot reuse old files', async () => {
  const { source, options, record } = await fixture();
  const mutations = [
    value => { delete value.encoderHash; },
    value => { value.encoderHash = 'different encoder'; },
    value => { value.width += 1; },
    value => { value.formats.avif.url = `${site}wrong.avif`; },
    value => { value.formats.webp.height += 1; },
  ];
  for (const mutate of mutations) {
    const previous = structuredClone(record);
    mutate(previous);
    previous.dependencyClosureHash = responsiveDependencyHash('previews/primary/test.png', previous);
    const result = await encodeResponsivePreview(source, { ...options, previous });
    assert.equal(result.reused, false);
    assert.deepEqual(result.record, record);
  }
});
