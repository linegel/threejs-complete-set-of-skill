#!/usr/bin/env node
/**
 * Capture entry that reuses an already-running Google Chrome over CDP.
 *
 * Why a separate file: harness tracked-release source-closure binds
 * scripts/capture-lab-browser.mjs by content hash. CDP connect support stays
 * outside that ledger so accepted harness projections keep validating.
 *
 * Usage:
 *   CAPTURE_CDP_ENDPOINT=http://127.0.0.1:9222 \
 *     node scripts/capture-via-cdp.mjs --lab webgpu-tower-ship-sculptor --hook path/to/capture-hook.mjs
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const endpoint = process.env.CAPTURE_CDP_ENDPOINT;
if (typeof endpoint !== 'string' || endpoint.length === 0) {
  throw new Error('CAPTURE_CDP_ENDPOINT is required (e.g. http://127.0.0.1:9222)');
}

// Reuse the already-running Google Chrome (GPU / Metal). Do not launch a second
// Playwright profile — that path injects --enable-unsafe-swiftshader and often
// has no navigator.gpu, and it fights the existing CDP session on :9222.
const connected = await chromium.connectOverCDP(endpoint);
chromium.launch = async function launchOverExistingChrome(_options = {}) {
  return connected;
};
// capture-lab-browser always browser.close()s; for CDP that must only drop the
// Playwright connection, never kill the user's Chrome.
const originalClose = connected.close.bind(connected);
connected.close = async function disconnectOnly() {
  try {
    await connected.removeAllListeners?.();
  } catch {
    // ignore
  }
  // Playwright's close() on a CDP connection disconnects; do not spawn/kill Chrome.
  return originalClose();
};
process.env.CAPTURE_AUTOMATION_SURFACE = process.env.CAPTURE_AUTOMATION_SURFACE || 'playwright-cdp-chrome';

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const labId = option('--lab');
if (!labId) throw new Error('--lab is required');

const { captureLabBrowser } = await import(pathToFileURL(resolve('scripts/capture-lab-browser.mjs')).href);
const summary = await captureLabBrowser({
  labId,
  profile: option('--profile', 'correctness'),
  outputDir: option('--output') ? resolve(option('--output')) : null,
  hookPath: option('--hook') ? resolve(option('--hook')) : null,
  target: option('--target', 'final'),
});

console.log(JSON.stringify({
  labId: summary.labId ?? labId,
  profile: summary.profile ?? option('--profile', 'correctness'),
  outputDir: summary.outputDir ?? summary.output ?? null,
}, null, 2));
