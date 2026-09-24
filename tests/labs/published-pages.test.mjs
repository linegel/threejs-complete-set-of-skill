import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  allPublishedAssetFiles,
  computePublishedBundleHash,
  publishedAssetDependencies,
  publishedHashInputs,
  stageClassicScripts,
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

test('classic head scripts retain exact bytes, attributes, and execution order', () => {
  const { root } = fixture();
  const entryPath = join(root, 'index.html');
  const publicRoot = join(root, 'public');
  const bytes = 'window.surface = document.currentScript.dataset.surface;\n';
  writeFileSync(join(root, 'bootstrap.js'), bytes);
  const html = '<head><script src="./bootstrap.js" data-surface="correctness"></script><script type="module" src="./app.js"></script></head>';
  const result = stageClassicScripts(html, { entryPath, repoRoot: root, publicRoot });
  const asset = result.match(/src="(\/assets\/classic-[a-f0-9]{64}\.js)"/)[1];
  assert.equal(readFileSync(join(publicRoot, asset), 'utf8'), bytes);
  assert.match(result, /data-surface="correctness"><\/script><script type="module" src="\.\/app\.js"/);
  assert.equal(stageClassicScripts(html, { entryPath, repoRoot: root, publicRoot }), result);
  writeFileSync(join(root, 'bootstrap.js'), bytes + '// new bytes\n');
  assert.notEqual(stageClassicScripts(html, { entryPath, repoRoot: root, publicRoot }), result);
});

test('inline, module, and external scripts are not copied as classic assets', () => {
  const { root } = fixture();
  const html = '<script>window.ready=true</script><script type="module" src="./app.js"></script><script src="https://example.org/vendor.js"></script>';
  const publicRoot = join(root, 'public');
  assert.equal(stageClassicScripts(html, { entryPath: join(root, 'index.html'), repoRoot: root, publicRoot }), html);
  assert.equal(existsSync(publicRoot), false);
});

test('missing and out-of-repository classic scripts fail before publication', () => {
  const { root } = fixture();
  const repoRoot = join(root, 'source');
  mkdirSync(repoRoot);
  writeFileSync(join(root, 'outside.js'), 'window.outside=true;');
  const options = { entryPath: join(repoRoot, 'index.html'), repoRoot, publicRoot: join(root, 'public') };
  assert.throws(() => stageClassicScripts('<script src="./missing.js"></script>', options), /ENOENT/);
  assert.throws(() => stageClassicScripts('<script src="../outside.js"></script>', options), /outside its repository/);
});
