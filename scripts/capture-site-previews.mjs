#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

import {
  PRIMARY_DEMO_KINDS,
  REPO_ROOT,
  buildDemoRegistry,
} from './lib/lab-registry.mjs';

const CONTROLLER_GLOBALS = [
  'labController',
  '__LAB_CONTROLLER__',
  '__labController',
  '__imagePipelineValidation',
  '__THREEJS_LAB__',
  '__THREE_LAB__',
];

const WIDTH = 1200;
const HEIGHT = 760;

async function waitForPrimary(page, lab) {
  if (lab.nonRenderingScenarioSuite) {
    await page.locator('#app > *').first().waitFor({ state: 'visible', timeout: 60_000 });
  } else {
    await page.waitForFunction((names) => (
      names.some((name) => window[name] !== undefined && window[name] !== null)
      || window.__LAB_ERROR__
      || window.__LAB_ROUTE_ERROR__
    ), CONTROLLER_GLOBALS, { timeout: 60_000 });
  }

  return page.evaluate(async ({ names, nonRendering }) => {
    const blocker = window.__LAB_ERROR__ ?? window.__LAB_ROUTE_ERROR__ ?? null;
    if (blocker) throw new Error(String(blocker));
    let candidate = null;
    for (const name of names) {
      if (window[name] !== undefined && window[name] !== null) {
        candidate = window[name];
        break;
      }
    }
    const controller = await Promise.resolve(candidate);
    if (!controller) {
      if (nonRendering) return { routeReady: true, controller: false, metrics: null };
      throw new Error('primary page did not expose a LabController');
    }
    const metrics = typeof controller.getMetrics === 'function'
      ? await controller.getMetrics()
      : null;
    return {
      routeReady: true,
      controller: true,
      backend: String(metrics?.backend ?? metrics?.rendererBackend ?? ''),
      nativeWebGPU: Boolean(
        metrics?.backend?.isWebGPUBackend
        ?? metrics?.rendererInfo?.backend?.isWebGPUBackend
        ?? metrics?.backendIsWebGPU
        ?? metrics?.nativeWebGPU
        ?? false
      ),
      mode: typeof metrics?.mode === 'string' ? metrics.mode : null,
      tier: typeof metrics?.tier === 'string' ? metrics.tier : null,
    };
  }, { names: CONTROLLER_GLOBALS, nonRendering: lab.nonRenderingScenarioSuite === true });
}

async function captureRoute({ page, baseUrl, id, route, outputDir, readiness, classification, captureSurface, publishable }) {
  const errors = [];
  const onPageError = (error) => errors.push(String(error.stack ?? error));
  const onConsole = (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  try {
    await page.goto(new URL(route, baseUrl).href, { waitUntil: 'load', timeout: 60_000 });
    const ready = await readiness(page);
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    if (errors.length > 0) {
      return {
        id,
        route,
        classification,
        canonicalEvidence: false,
        captureSurface,
        ready,
        pageErrors: errors,
        verdict: 'PREVIEW_FAILED',
        error: 'Page emitted one or more runtime errors during preview capture.',
      };
    }
    if (!publishable) {
      return {
        id,
        route,
        classification,
        canonicalEvidence: false,
        captureSurface,
        ready,
        pageErrors: [],
        verdict: 'PREVIEW_NOT_PROMOTED',
        note: 'Headless WebGPU canvas presentation is not reliable enough for publication; use the related interactive-Chrome preview until render-target evidence is accepted.',
      };
    }
    const path = join(outputDir, `${id}.png`);
    writeFileSync(path, screenshot);
    return {
      id,
      route,
      image: `previews/${classification === 'concept-proxy-preview' ? 'provider' : 'primary'}/${id}.png`,
      classification,
      canonicalEvidence: false,
      captureSurface,
      width: WIDTH,
      height: HEIGHT,
      ready,
      pageErrors: [],
      verdict: 'PREVIEW_CAPTURED',
    };
  } catch (error) {
    return {
      id,
      route,
      classification,
      canonicalEvidence: false,
      captureSurface,
      pageErrors: errors,
      verdict: 'PREVIEW_FAILED',
      error: String(error.stack ?? error),
    };
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }
}

export async function captureSitePreviews() {
  const docsRoot = join(REPO_ROOT, 'docs');
  const manifestPath = join(docsRoot, 'previews', 'manifest.json');
  const primaryOutput = join(docsRoot, 'previews', 'primary');
  mkdirSync(primaryOutput, { recursive: true });

  const server = await createServer({
    root: docsRoot,
    appType: 'mpa',
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  let browser;
  try {
    await server.listen();
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('preview server did not expose a TCP port');
    const baseUrl = `http://127.0.0.1:${address.port}/`;
    browser = await chromium.launch({
      headless: true,
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,UseSkiaRenderer',
        '--disable-gpu-sandbox',
      ],
    });
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const results = [];

    const registry = buildDemoRegistry();
    for (const lab of registry.demos.filter((entry) => PRIMARY_DEMO_KINDS.includes(entry.kind))) {
      results.push(await captureRoute({
        page,
        baseUrl,
        id: lab.id,
        route: lab.publishPath.replace(/^\//, ''),
        outputDir: primaryOutput,
        readiness: (capturePage) => waitForPrimary(capturePage, lab),
        classification: lab.nonRenderingScenarioSuite
          ? 'non-rendering-lab-preview'
          : 'implementation-preview',
        captureSurface: lab.nonRenderingScenarioSuite || lab.id === 'browser-fallback-harness'
          ? 'headless-playwright-html-ui'
          : 'headless-playwright',
        publishable: lab.nonRenderingScenarioSuite || lab.id === 'browser-fallback-harness',
      }));
    }

    const previousManifest = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, 'utf8'))
      : { results: [] };
    const preservedResults = previousManifest.results
      .filter((entry) => entry.image?.startsWith('previews/provider/'));
    const mergedResults = [...preservedResults, ...results];

    const manifest = {
      schemaVersion: 1,
      classification: 'site-preview-screenshot',
      canonicalEvidence: false,
      viewport: { width: WIDTH, height: HEIGHT, dpr: 1 },
      results: mergedResults,
      providerCaptureSurface: previousManifest.providerCaptureSurface
        ?? 'interactive Chrome at https://threejs-skills.com/',
      note: 'Page screenshots are presentation previews only. The default command refreshes primary routes and preserves approved interactive provider captures. Native WebGPU acceptance requires render-target readback and a schema-v2 evidence bundle.',
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return { ...manifest, capturedResults: results };
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const result = await captureSitePreviews();
  const failed = result.capturedResults.filter((entry) => entry.verdict === 'PREVIEW_FAILED');
  const promoted = result.capturedResults.filter((entry) => entry.verdict === 'PREVIEW_CAPTURED');
  const notPromoted = result.capturedResults.filter((entry) => entry.verdict === 'PREVIEW_NOT_PROMOTED');
  console.log(JSON.stringify({
    promoted: promoted.map(({ id }) => id),
    notPromoted: notPromoted.map(({ id }) => id),
    failed: failed.map(({ id, error }) => ({ id, error: error.split('\n')[0] })),
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}
