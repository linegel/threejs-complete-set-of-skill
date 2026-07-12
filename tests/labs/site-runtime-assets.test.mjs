import assert from 'node:assert/strict';
import { test } from 'node:test';

import { remoteRuntimeAssetViolations } from '../../scripts/lib/site-runtime-assets.mjs';

test('ordinary external navigation and metadata do not count as runtime assets', () => {
  const html = `
    <link rel="canonical" href="https://threejs-skills.com/skills/example.html">
    <meta property="og:image" content="https://threejs-skills.com/evidence.png">
    <a href="https://github.com/linegel/threejs-complete-set-of-skill">source</a>
    <script type="application/ld+json">{"url":"https://threejs-skills.com/"}</script>
  `;
  assert.deepEqual(remoteRuntimeAssetViolations(html, 'safe.html'), []);
});

test('local presentation assets pass regardless of relative depth', () => {
  const html = `
    <link href="../assets/vendor/katex/katex.min.css" rel="stylesheet">
    <link rel="preload" href="/assets/vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2" as="font">
    <script src="../assets/vendor/katex/katex.min.js"></script>
    <img src="../evidence/final.png" srcset="../evidence/final.webp 1x, ../evidence/final.avif 2x">
  `;
  assert.deepEqual(remoteRuntimeAssetViolations(html, 'local.html'), []);
});

test('each remote runtime-asset mutation is rejected independently', () => {
  const mutations = [
    '<script src="https://cdn.example/renderer.js"></script>',
    '<link href="https://cdn.example/site.css" rel="stylesheet">',
    '<link href="https://cdn.example/font.woff2" as="font" rel="preload">',
    '<link href="https://cdn.example" rel="preconnect">',
    '<link href="https://cdn.example" rel="dns-prefetch">',
    '<img src="https://cdn.example/final.png">',
    '<source srcset="https://cdn.example/final.webp 1x, local.avif 2x">',
    '<video src="https://cdn.example/temporal.mp4"></video>',
    '<audio src="https://cdn.example/telemetry.wav"></audio>',
    '<iframe src="https://cdn.example/proxy.html"></iframe>',
    '<style>.hero{background:url(https://cdn.example/fallback.png)}</style>',
    '<script>fetch("https://cdn.example/runtime.json")</script>',
    '<script>import("https://cdn.example/module.js")</script>',
  ];

  for (const mutation of mutations) {
    const violations = remoteRuntimeAssetViolations(mutation, 'mutation.html');
    assert.ok(violations.length > 0, `mutation passed: ${mutation}`);
  }
});
