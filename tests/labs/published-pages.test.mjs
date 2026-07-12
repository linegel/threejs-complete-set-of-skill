import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  allPublishedAssetFiles,
  computePublishedBundleHash,
  publishedAssetDependencies,
  publishedHashInputs,
} from '../../scripts/lib/published-pages.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'threejs-published-pages-'));
  const lab = join(root, 'docs', 'demos', 'lab');
  const assets = join(root, 'docs', 'demos', 'assets');
  mkdirSync(lab, { recursive: true });
  mkdirSync(assets, { recursive: true });
  return { root, lab, assets };
}

test('per-lab closures follow emitted dependencies without absorbing unrelated chunks', () => {
  const { root, lab, assets } = fixture();
  writeFileSync(join(lab, 'index.html'), `
    <link rel="stylesheet" href="../assets/site.css">
    <script type="module" src="../assets/entry.js"></script>
    <img src="../assets/final.png" srcset="../assets/final.webp 1x, ../assets/final.avif 2x">
  `);
  writeFileSync(join(assets, 'entry.js'), `
    import './shared.js';
    import('./lazy.js');
    const data = new URL(\`payload.bin\`, import.meta.url);
    const falsePositive = 'href="${'${new URL(`${id}/`, base).href}'}"';
    const route = new URL(location.href);
  `);
  writeFileSync(join(assets, 'shared.js'), 'export const shared = 1;\n');
  writeFileSync(join(assets, 'lazy.js'), 'export const lazy = 1;\n');
  writeFileSync(join(assets, 'payload.bin'), 'payload');
  writeFileSync(join(assets, 'site.css'), '@font-face{src:url("./font.woff2")}\n');
  writeFileSync(join(assets, 'font.woff2'), 'font');
  writeFileSync(join(assets, 'final.png'), 'png');
  writeFileSync(join(assets, 'final.webp'), 'webp');
  writeFileSync(join(assets, 'final.avif'), 'avif');
  writeFileSync(join(assets, 'unrelated.js'), 'export const unrelated = 1;\n');

  const dependencies = publishedAssetDependencies(root, 'lab');
  assert.deepEqual(dependencies, [
    'docs/demos/assets/entry.js',
    'docs/demos/assets/final.avif',
    'docs/demos/assets/final.png',
    'docs/demos/assets/final.webp',
    'docs/demos/assets/font.woff2',
    'docs/demos/assets/lazy.js',
    'docs/demos/assets/payload.bin',
    'docs/demos/assets/shared.js',
    'docs/demos/assets/site.css',
  ]);
  assert.equal(allPublishedAssetFiles(root).includes('docs/demos/assets/unrelated.js'), true);
  assert.equal(dependencies.includes('docs/demos/assets/unrelated.js'), false);

  const inputs = publishedHashInputs(root, 'lab');
  const before = computePublishedBundleHash(root, inputs);
  writeFileSync(join(assets, 'unrelated.js'), 'export const unrelated = 2;\n');
  assert.equal(computePublishedBundleHash(root, inputs), before);
  writeFileSync(join(assets, 'shared.js'), 'export const shared = 2;\n');
  assert.notEqual(computePublishedBundleHash(root, inputs), before);
});

test('missing emitted file references fail closed', () => {
  const { root, lab } = fixture();
  writeFileSync(join(lab, 'index.html'), '<script type="module" src="../assets/missing.js"></script>\n');
  assert.throws(() => publishedAssetDependencies(root, 'lab'), /published asset reference is missing/);
});
