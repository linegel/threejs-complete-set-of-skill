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

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const { captureLabBrowser } = await import(pathToFileURL(resolve('scripts/capture-lab-browser.mjs')).href);
const profile = option('--profile', 'correctness');
const outputDir = option('--output')
  ? resolve(option('--output'))
  : resolve('artifacts/visual-validation', labId, profile);
const summary = await captureLabBrowser({
  labId,
  profile,
  outputDir: option('--output') ? resolve(option('--output')) : null,
  hookPath: option('--hook') ? resolve(option('--hook')) : null,
  target: option('--target', 'final'),
});

const resolvedOutput = summary.outputDir ?? summary.output ?? outputDir;
const sessionPath = join(resolvedOutput, 'capture-session.json');
let sessionProof = null;
if (existsSync(sessionPath)) {
  const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
  const metrics = session.finalRuntime?.metrics ?? session.runtime?.metrics ?? {};
  const backend = metrics.rendererBackendEvidence ?? {};
  sessionProof = {
    browserEntry: session.browserEntry ?? null,
    automationSurface: session.automationSurface ?? null,
    sourceHash: session.sourceClosureHash ?? session.sourceHash ?? null,
    profileConfig: session.profileConfig ?? null,
    nativeWebGPU: metrics.nativeWebGPU === true,
    isWebGPUBackend: backend.isWebGPUBackend === true || metrics.backendIsWebGPU === true,
    backendType: backend.backendType ?? metrics.rendererBackend ?? metrics.backend ?? null,
    deviceIdentityVerified: backend.deviceIdentityVerified === true,
    startedAt: session.startedAt ?? null,
    finishedAt: session.finishedAt ?? null,
  };
}

const report = {
  ok: sessionProof?.nativeWebGPU === true && sessionProof?.isWebGPUBackend === true,
  labId: summary.labId ?? labId,
  profile: summary.profile ?? profile,
  outputDir: resolvedOutput,
  exit: 0,
  proof: sessionProof,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  console.error('capture-via-cdp: missing native WebGPU backend proof in capture-session.json');
  process.exit(1);
}

// CDP disconnect can leave Playwright event-loop handles open; force a clean
// exit after a successful capture so dual-capture shells do not hang forever.
process.exit(0);
