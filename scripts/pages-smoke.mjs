#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { join } from 'node:path';
import { PRIMARY_DEMO_KINDS, REPO_ROOT, buildDemoRegistry } from './lib/lab-registry.mjs';

const server = await preview({
  root: REPO_ROOT,
  logLevel: 'warn',
  build: { outDir: 'docs' },
  preview: { host: '127.0.0.1', port: 4173, strictPort: false },
});
const baseUrl = server.resolvedUrls?.local?.[0];
if (!baseUrl) {
  await server.httpServer.close();
  throw new Error('Vite preview did not expose a local URL');
}

let browser = null;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage();
  const registry = buildDemoRegistry();
  const routes = new Set([
    '/',
    '/about/',
    '/skills.json',
    '/llms.txt',
    '/robots.txt',
    '/sitemap.xml',
    '/demos/registry.json',
  ]);
  for (const directory of readdirSync(REPO_ROOT)) {
    if (directory.startsWith('threejs-') && existsSync(join(REPO_ROOT, directory, 'SKILL.md'))) {
      routes.add(`/skills/${directory}.html`);
    }
  }
  for (const lab of registry.demos) {
    if (lab.publishPath && (PRIMARY_DEMO_KINDS.includes(lab.kind) || lab.status === 'secondary')) {
      routes.add(lab.publishPath);
    }
  }
  for (const route of routes) {
    const response = await page.goto(new URL(route.replace(/^\//, ''), baseUrl).href, { waitUntil: 'domcontentloaded' });
    if (!response?.ok()) throw new Error(`${route} returned ${response?.status() ?? 'no response'}`);
  }
  console.log(`Pages smoke passed for ${routes.size} routes.`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
}
