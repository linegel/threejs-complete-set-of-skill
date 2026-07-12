#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import {
  basename,
  join,
  resolve,
} from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  PRIMARY_DEMO_KINDS,
  REPO_ROOT,
  buildDemoRegistry,
} from './lib/lab-registry.mjs';

export const ROUTER_CAPTURE_POLICY_ID = 'router-manifest-lab';
export const FALLBACK_CAPTURE_POLICY_ID = 'browser-fallback-harness';
export const FALLBACK_CAPTURE_POLICY_MARKER = 'explicit-fallback-harness';
export const NON_RENDERING_CAPTURE_POLICY = 'non-rendering-fixture-suite';
export const CODEX_IN_APP_CAPTURE_POLICY = 'codex-in-app-browser-immutable-evidence';

const EXTERNAL_CAPTURE_PATTERNS = Object.freeze([
  { pattern: /requires\s+--(?:url|base-url)/i, reason: 'requires an externally served URL' },
  { pattern: /set\s+LAB_URL/i, reason: 'requires LAB_URL' },
  { pattern: /127\.0\.0\.1:4173/, reason: 'depends on a fixed external development server' },
]);

function unquote(value) {
  if (!value) return value;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function nodeProgram(command) {
  const match = /(?:^|\s)node\s+(?:--[^\s]+\s+)*("[^"]+"|'[^']+'|[^\s]+)/.exec(command ?? '');
  return match ? unquote(match[1]) : null;
}

function readIfPresent(path) {
  return path && existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function captureFiles(packageDir) {
  if (!existsSync(packageDir)) return [];
  return readdirSync(packageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /capture.*\.(?:mjs|js)$/i.test(entry.name))
    .map((entry) => join(packageDir, entry.name));
}

function hasExternalDependency(source) {
  return EXTERNAL_CAPTURE_PATTERNS.find(({ pattern }) => pattern.test(source)) ?? null;
}

function hasSelfServingServer(source) {
  return /\bcreateServer\b/.test(source)
    && /(?:\.listen\s*\(|await\s+[^\n;]*\.listen\s*\()/.test(source);
}

function hasProfileDimensions(source) {
  return /(?:1200[^\n]{0,80}800|width\s*:\s*1200[\s\S]{0,120}height\s*:\s*800)/.test(source)
    && /(?:1920[^\n]{0,80}1080|width\s*:\s*1920[\s\S]{0,120}height\s*:\s*1080)/.test(source);
}

function sharedCaptureKind(command, source, programPath) {
  if (basename(programPath ?? '') === 'capture-lab-browser.mjs') return 'shared-direct';
  if (/capture-lab-browser\.mjs/.test(source)) return 'shared-wrapper';
  return null;
}

function isStatusOnlyCapture(source, programPath) {
  if (/(?:capture-status|evidence-status)\.(?:mjs|js)$/i.test(programPath ?? '')) return true;
  if (source.length >= 2000 || /(?:capturePixels|readRenderTargetPixelsAsync|captureLabBrowser)/.test(source)) return false;
  return /(?:INSUFFICIENT_EVIDENCE|pending the root browser runner|no synthetic artifact)/i.test(source);
}

function hookSources(packageDir, command, captureSource) {
  const sources = [];
  const commandHook = /--hook\s+("[^"]+"|'[^']+'|[^\s]+)/.exec(command ?? '');
  if (commandHook) {
    const path = resolve(packageDir, unquote(commandHook[1]));
    sources.push({ path, source: readIfPresent(path) });
  }
  if (/\bhookPath\s*[:=]/.test(captureSource)) {
    for (const path of captureFiles(packageDir)) {
      if (!sources.some((entry) => entry.path === path) && /captureLab\s*\(/.test(readIfPresent(path))) {
        sources.push({ path, source: readIfPresent(path) });
      }
    }
  }
  return sources;
}

/** Pure per-lab policy check used by the pack scan and browser-free tests. */
export function checkCaptureImplementation({
  id,
  nonRendering = false,
  packageCapture = '',
  captureSource = '',
  captureProgramPath = null,
  hookSourceRecords = [],
} = {}) {
  const errors = [];
  if (nonRendering) {
    if (!packageCapture) {
      errors.push(`${id}: non-rendering suite has no executable capture command`);
    } else if (!/(?:test|fixture|contract)/i.test(`${packageCapture}\n${captureSource}`)) {
      errors.push(`${id}: non-rendering capture must execute a fixture-driven contract suite`);
    }
    return errors;
  }

  if (!packageCapture) return [`${id}: local package.json has no capture script`];
  if (/^\s*npm\b/.test(packageCapture)) {
    errors.push(`${id}: capture delegates through another npm package instead of capturing its own browser entry`);
  }
  const external = hasExternalDependency(captureSource);
  if (external) errors.push(`${id}: capture ${external.reason}`);
  if (isStatusOnlyCapture(captureSource, captureProgramPath)) {
    errors.push(`${id}: capture is status-only and cannot produce a render-target PNG`);
  }

  if (id === FALLBACK_CAPTURE_POLICY_ID) {
    if (!captureSource.includes(FALLBACK_CAPTURE_POLICY_MARKER)) {
      errors.push(`${id}: specialized capture must declare ${FALLBACK_CAPTURE_POLICY_MARKER}`);
    }
    if (!hasSelfServingServer(captureSource)) errors.push(`${id}: specialized fallback capture must self-serve its routes`);
    if (!/--profile/.test(captureSource)) errors.push(`${id}: specialized fallback capture must accept --profile`);
    return errors;
  }

  if (captureSource.includes(CODEX_IN_APP_CAPTURE_POLICY)) {
    if (!hasSelfServingServer(captureSource)) errors.push(`${id}: Codex Browser capture must self-serve immutable bytes`);
    if (!/immutable-physical-build/.test(captureSource)) errors.push(`${id}: Codex Browser capture does not bind an immutable physical build`);
    if (!/in-app-evidence\.html/.test(captureSource)) errors.push(`${id}: Codex Browser capture does not expose the in-app evidence runner`);
    if (!/(?:served-byte|ledgerPath)/.test(captureSource)) errors.push(`${id}: Codex Browser capture does not retain a served-byte ledger`);
    if (/(?:from\s+['"]playwright|chromium\.launch|chrome-launcher)/i.test(captureSource)) errors.push(`${id}: Codex Browser capture must not launch an external browser`);
    return errors;
  }

  const sharedKind = sharedCaptureKind(packageCapture, captureSource, captureProgramPath);
  if (sharedKind) {
    if (/--profile\s+(?:correctness|performance)/.test(packageCapture)) {
      errors.push(`${id}: shared capture command hard-codes a profile and overrides root profile forwarding`);
    }
    if (sharedKind === 'shared-wrapper' && !/--profile/.test(captureSource)) {
      errors.push(`${id}: shared wrapper does not accept the forwarded --profile argument`);
    }
    const hookRequested = /--hook\b/.test(packageCapture) || (sharedKind === 'shared-wrapper' && /\bhookPath\s*[:=]/.test(captureSource));
    if (hookRequested) {
      if (hookSourceRecords.length === 0 || hookSourceRecords.some(({ source }) => source.length === 0)) {
        errors.push(`${id}: shared capture hook is missing`);
      } else if (!hookSourceRecords.some(({ source }) => /final\.design\.png/.test(source))) {
        errors.push(`${id}: shared capture hook does not write final.design.png`);
      }
    }
    return errors;
  }

  if (!hasSelfServingServer(captureSource)) errors.push(`${id}: bespoke capture does not self-serve its browser entry`);
  if (!/(?:playwright|chromium)/i.test(captureSource)) errors.push(`${id}: bespoke capture does not launch the pinned browser toolchain`);
  if (!/--profile/.test(captureSource)) errors.push(`${id}: bespoke capture does not accept --profile`);
  if (!hasProfileDimensions(captureSource)) errors.push(`${id}: bespoke capture does not define both 1200x800 and 1920x1080 profiles`);
  if (!/final\.design\.png/.test(captureSource)) errors.push(`${id}: bespoke capture does not write final.design.png`);
  if (!/(?:capturePixels|readRenderTargetPixelsAsync)/.test(captureSource)) {
    errors.push(`${id}: bespoke capture has no render-target readback path`);
  }
  if (!/(?:bytesPerRow|sourceBytesPerRow|rowStrideBytes|readbackLayout)/.test(captureSource)) {
    errors.push(`${id}: bespoke capture does not account for readback row stride`);
  }
  if (!/(?:encodeRgbaPng|createRgbaPng|PNG|pngFrom)/.test(captureSource)) {
    errors.push(`${id}: bespoke capture does not encode a standard PNG`);
  }
  return errors;
}

export function auditCaptureWiring({ registry = buildDemoRegistry() } = {}) {
  const errors = [];
  const records = [];
  const primary = registry.demos.filter((demo) => PRIMARY_DEMO_KINDS.includes(demo.kind));
  for (const demo of primary) {
    const canonicalDir = registry.origins?.[demo.id]?.canonicalDir;
    const packageDir = canonicalDir ? join(REPO_ROOT, canonicalDir) : null;
    const packagePath = packageDir ? join(packageDir, 'package.json') : null;
    if (!packagePath || !existsSync(packagePath)) {
      errors.push(`${demo.id}: primary demo has no local package.json`);
      continue;
    }
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    const packageCapture = packageJson.scripts?.capture ?? '';
    const program = nodeProgram(packageCapture);
    const captureProgramPath = program ? resolve(packageDir, program) : null;
    const captureSource = readIfPresent(captureProgramPath);
    if (program && !captureSource) errors.push(`${demo.id}: capture program does not exist: ${program}`);
    const hookSourceRecords = hookSources(packageDir, packageCapture, captureSource);
    const implementationErrors = checkCaptureImplementation({
      id: demo.id,
      nonRendering: demo.nonRenderingScenarioSuite === true,
      packageCapture,
      captureSource,
      captureProgramPath,
      hookSourceRecords,
    });
    errors.push(...implementationErrors);
    records.push({
      id: demo.id,
      policy: demo.nonRenderingScenarioSuite === true
        ? NON_RENDERING_CAPTURE_POLICY
        : demo.id === FALLBACK_CAPTURE_POLICY_ID
          ? FALLBACK_CAPTURE_POLICY_MARKER
          : captureSource.includes(CODEX_IN_APP_CAPTURE_POLICY)
            ? CODEX_IN_APP_CAPTURE_POLICY
            : sharedCaptureKind(packageCapture, captureSource, captureProgramPath) ?? 'bespoke-self-serving',
      captureProgram: captureProgramPath,
      hookPrograms: hookSourceRecords.map(({ path }) => path),
    });
  }
  return { errors, records, primaryCount: primary.length };
}

async function main() {
  const result = auditCaptureWiring();
  if (result.errors.length > 0) {
    console.error(`capture wiring incomplete (${result.errors.length} errors across ${result.primaryCount} primary demos):`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  const policies = Object.groupBy(result.records, ({ policy }) => policy);
  console.log(JSON.stringify({
    pass: true,
    primaryDemos: result.primaryCount,
    policies: Object.fromEntries(Object.entries(policies).map(([policy, entries]) => [policy, entries.length])),
    note: 'Capture wiring proves executable session plumbing only; it does not grant v2 evidence acceptance.',
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
