#!/usr/bin/env node

import {
  X_OK,
  accessSync,
  existsSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_TOOLCHAIN = Object.freeze({
  node: '22.22.0',
  npm: '10.9.4',
  packageManager: 'npm@10.9.4',
  three: '0.185.1',
  threeRevision: '185',
  playwright: '1.61.1',
  vite: '8.1.3',
  sharp: '0.35.3',
});

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGE_LOCATIONS = Object.freeze({
  three: 'dependencies',
  playwright: 'devDependencies',
  vite: 'devDependencies',
  sharp: 'devDependencies',
});

function failure(code, message) {
  return `[${code}] ${message}`;
}

function received(value) {
  return value === undefined ? 'missing' : JSON.stringify(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isWithin(parent, child) {
  const pathFromParent = relative(resolve(parent), resolve(child));
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent));
}

export function validateToolchainDeclarations({ packageJson, packageLock, nodeVersion }) {
  const errors = [];
  const lockRoot = packageLock?.packages?.[''];

  if (packageJson?.packageManager !== REQUIRED_TOOLCHAIN.packageManager) {
    errors.push(failure(
      'PACKAGE_MANAGER_MISMATCH',
      `packageManager must equal ${REQUIRED_TOOLCHAIN.packageManager}; received ${received(packageJson?.packageManager)}.`,
    ));
  }

  for (const runtime of ['node', 'npm']) {
    const expected = REQUIRED_TOOLCHAIN[runtime];
    if (packageJson?.engines?.[runtime] !== expected) {
      errors.push(failure(
        `ENGINE_${runtime.toUpperCase()}_MISMATCH`,
        `engines.${runtime} must equal ${expected}; received ${received(packageJson?.engines?.[runtime])}.`,
      ));
    }
    if (lockRoot?.engines?.[runtime] !== expected) {
      errors.push(failure(
        `LOCK_ENGINE_${runtime.toUpperCase()}_MISMATCH`,
        `package-lock packages[""].engines.${runtime} must equal ${expected}; received ${received(lockRoot?.engines?.[runtime])}.`,
      ));
    }
  }

  if (nodeVersion.trim() !== REQUIRED_TOOLCHAIN.node) {
    errors.push(failure(
      'NODE_VERSION_FILE_MISMATCH',
      `.node-version must contain ${REQUIRED_TOOLCHAIN.node}; received ${received(nodeVersion.trim())}.`,
    ));
  }

  for (const [name, section] of Object.entries(PACKAGE_LOCATIONS)) {
    const expected = REQUIRED_TOOLCHAIN[name];
    const declared = packageJson?.[section]?.[name];
    if (declared !== expected) {
      errors.push(failure(
        'PACKAGE_DECLARATION_MISMATCH',
        `${section}.${name} must equal ${expected}; received ${received(declared)}.`,
      ));
    }
    const lockDeclared = lockRoot?.[section]?.[name];
    if (lockDeclared !== expected) {
      errors.push(failure(
        'LOCK_DECLARATION_MISMATCH',
        `package-lock packages[""].${section}.${name} must equal ${expected}; received ${received(lockDeclared)}.`,
      ));
    }
    const lockResolved = packageLock?.packages?.[`node_modules/${name}`]?.version;
    if (lockResolved !== expected) {
      errors.push(failure(
        'LOCK_RESOLUTION_MISMATCH',
        `package-lock node_modules/${name} must resolve to ${expected}; received ${received(lockResolved)}.`,
      ));
    }
  }

  return errors;
}

export function validateInstalledPackageVersions(installedVersions) {
  const errors = [];
  for (const name of Object.keys(PACKAGE_LOCATIONS)) {
    const expected = REQUIRED_TOOLCHAIN[name];
    if (installedVersions?.[name] !== expected) {
      errors.push(failure(
        'INSTALLED_PACKAGE_MISMATCH',
        `node_modules/${name}/package.json must report ${expected}; received ${received(installedVersions?.[name])}. Run npm ci.`,
      ));
    }
  }
  return errors;
}

export function validateRuntimeVersions({ nodeVersion, npmVersion, threeRevision }) {
  const errors = [];
  if (nodeVersion !== REQUIRED_TOOLCHAIN.node) {
    errors.push(failure(
      'NODE_RUNTIME_MISMATCH',
      `running Node must be ${REQUIRED_TOOLCHAIN.node}; received ${received(nodeVersion)}. Activate .node-version before running repository commands.`,
    ));
  }
  if (npmVersion !== REQUIRED_TOOLCHAIN.npm) {
    errors.push(failure(
      'NPM_RUNTIME_MISMATCH',
      `the npm executable must be ${REQUIRED_TOOLCHAIN.npm}; received ${received(npmVersion)}. Use ${REQUIRED_TOOLCHAIN.packageManager}.`,
    ));
  }
  if (threeRevision !== REQUIRED_TOOLCHAIN.threeRevision) {
    errors.push(failure(
      'THREE_REVISION_MISMATCH',
      `the installed Three.js module must expose REVISION ${REQUIRED_TOOLCHAIN.threeRevision}; received ${received(threeRevision)}. Run npm ci.`,
    ));
  }
  return errors;
}

export function validateChromiumInstallation({
  executablePath,
  localBrowsersRoot,
  repositoryRoot = resolve(localBrowsersRoot, '..', '..', '..'),
  pathExists = existsSync,
  pathIsExecutable = (path) => {
    try {
      accessSync(path, X_OK);
      return true;
    } catch {
      return false;
    }
  },
  realPath = realpathSync,
}) {
  if (!isWithin(localBrowsersRoot, executablePath)) {
    return [failure(
      'PLAYWRIGHT_CHROMIUM_OUTSIDE_ROOT',
      `pinned Chromium must live under ${localBrowsersRoot}; Playwright resolved ${executablePath}. Run npm run browser:install.`,
    )];
  }
  if (!pathExists(executablePath)) {
    return [failure(
      'PLAYWRIGHT_CHROMIUM_MISSING',
      `pinned Playwright Chromium is not installed at ${executablePath}. Run npm run browser:install.`,
    )];
  }
  if (!pathIsExecutable(executablePath)) {
    return [failure(
      'PLAYWRIGHT_CHROMIUM_NOT_EXECUTABLE',
      `pinned Playwright Chromium is not executable at ${executablePath}. Re-run npm run browser:install and inspect filesystem permissions.`,
    )];
  }

  const resolvedRepositoryRoot = realPath(repositoryRoot);
  const resolvedBrowserRoot = realPath(localBrowsersRoot);
  if (!isWithin(resolvedRepositoryRoot, resolvedBrowserRoot)) {
    return [failure(
      'PLAYWRIGHT_BROWSER_ROOT_SYMLINK_ESCAPE',
      `Playwright's local browser directory resolves outside ${resolvedRepositoryRoot}: ${resolvedBrowserRoot}. Re-run npm run browser:install in a non-symlinked dependency tree.`,
    )];
  }
  const resolvedExecutable = realPath(executablePath);
  if (!isWithin(resolvedBrowserRoot, resolvedExecutable)) {
    return [failure(
      'PLAYWRIGHT_CHROMIUM_SYMLINK_ESCAPE',
      `pinned Chromium resolves outside ${resolvedBrowserRoot}: ${resolvedExecutable}. Re-run npm run browser:install in a clean dependency tree.`,
    )];
  }
  return [];
}

export function probeNpmVersion({ npmExecPath = process.env.npm_execpath } = {}) {
  const command = npmExecPath ? process.execPath : 'npm';
  const args = npmExecPath ? [npmExecPath, '--version'] : ['--version'];
  const probe = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    shell: false,
  });
  if (probe.error || probe.status !== 0) {
    const detail = probe.error?.message ?? String(probe.stderr ?? '').trim() ?? `exit ${probe.status}`;
    return {
      error: failure(
        'NPM_EXECUTABLE_FAILED',
        `could not execute npm --version${npmExecPath ? ` through ${npmExecPath}` : ''}: ${detail || `exit ${probe.status}`}.`,
      ),
      executable: npmExecPath ?? 'npm',
      version: null,
    };
  }
  return {
    error: null,
    executable: npmExecPath ?? 'npm',
    version: probe.stdout.trim(),
  };
}

export async function runToolchainPreflight({ repoRoot = REPO_ROOT } = {}) {
  const errors = [];
  let packageJson;
  let packageLock;
  let nodeVersion;
  try {
    packageJson = readJson(join(repoRoot, 'package.json'));
    packageLock = readJson(join(repoRoot, 'package-lock.json'));
    nodeVersion = readFileSync(join(repoRoot, '.node-version'), 'utf8');
  } catch (error) {
    return {
      errors: [failure('TOOLCHAIN_METADATA_UNREADABLE', `could not read root toolchain metadata: ${error.message}.`)],
      summary: null,
    };
  }

  errors.push(...validateToolchainDeclarations({ packageJson, packageLock, nodeVersion }));

  const installedVersions = {};
  for (const name of Object.keys(PACKAGE_LOCATIONS)) {
    try {
      installedVersions[name] = readJson(join(repoRoot, 'node_modules', name, 'package.json')).version;
    } catch {
      installedVersions[name] = undefined;
    }
  }
  errors.push(...validateInstalledPackageVersions(installedVersions));

  const npmProbe = probeNpmVersion();
  if (npmProbe.error) errors.push(npmProbe.error);

  let threeRevision;
  try {
    const three = await import('three');
    threeRevision = String(three.REVISION);
  } catch (error) {
    errors.push(failure('THREE_IMPORT_FAILED', `could not import the root Three.js dependency: ${error.message}. Run npm ci.`));
  }
  errors.push(...validateRuntimeVersions({
    nodeVersion: process.versions.node,
    npmVersion: npmProbe.version,
    threeRevision,
  }));

  const localBrowsersRoot = join(repoRoot, 'node_modules', 'playwright-core', '.local-browsers');
  let chromiumExecutable = null;
  const previousBrowserPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
  try {
    const { chromium } = await import('playwright');
    chromiumExecutable = chromium.executablePath();
    errors.push(...validateChromiumInstallation({
      executablePath: chromiumExecutable,
      localBrowsersRoot,
      repositoryRoot: repoRoot,
    }));
  } catch (error) {
    errors.push(failure('PLAYWRIGHT_IMPORT_FAILED', `could not resolve pinned Playwright Chromium: ${error.message}. Run npm ci, then npm run browser:install.`));
  } finally {
    if (previousBrowserPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowserPath;
  }

  return {
    errors,
    summary: {
      chromiumExecutable,
      installedVersions,
      node: process.versions.node,
      npm: npmProbe.version,
      npmExecutable: npmProbe.executable,
      threeRevision,
    },
  };
}

async function main() {
  const result = await runToolchainPreflight();
  if (result.errors.length > 0) {
    console.error(`Toolchain preflight failed (${result.errors.length} errors):`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  const summary = result.summary;
  console.log('Toolchain preflight passed.');
  console.log(`- Node ${summary.node}`);
  console.log(`- npm ${summary.npm} (${summary.npmExecutable})`);
  console.log(`- Three ${summary.installedVersions.three} / REVISION ${summary.threeRevision}`);
  console.log(`- Playwright ${summary.installedVersions.playwright}`);
  console.log(`- Vite ${summary.installedVersions.vite}`);
  console.log(`- Sharp ${summary.installedVersions.sharp}`);
  console.log(`- Chromium ${summary.chromiumExecutable}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
