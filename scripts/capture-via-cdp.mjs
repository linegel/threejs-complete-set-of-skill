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
 *     node scripts/capture-via-cdp.mjs --lab webgpu-tower-ship-sculptor ...
 */
import { chromium } from 'playwright';

const endpoint = process.env.CAPTURE_CDP_ENDPOINT;
if (typeof endpoint !== 'string' || endpoint.length === 0) {
  throw new Error('CAPTURE_CDP_ENDPOINT is required (e.g. http://127.0.0.1:9222)');
}

const originalLaunch = chromium.launch.bind(chromium);
chromium.launch = async function launchOverExistingChrome(_options = {}) {
  return chromium.connectOverCDP(endpoint);
};
// Keep original available for diagnostics.
chromium.launchDirect = originalLaunch;

// Re-export / run the standard capture CLI after the launch patch.
await import('./capture-lab-browser.mjs');
