import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  REPO_ROOT,
  REQUIRED_TOOLCHAIN,
  probeNpmVersion,
  validateChromiumInstallation,
  validateInstalledPackageVersions,
  validateRuntimeVersions,
  validateToolchainDeclarations,
} from '../../scripts/toolchain-preflight.mjs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function declarationFixture() {
  const dependencies = { three: REQUIRED_TOOLCHAIN.three };
  const devDependencies = {
    playwright: REQUIRED_TOOLCHAIN.playwright,
    sharp: REQUIRED_TOOLCHAIN.sharp,
    vite: REQUIRED_TOOLCHAIN.vite,
  };
  const engines = {
    node: REQUIRED_TOOLCHAIN.node,
    npm: REQUIRED_TOOLCHAIN.npm,
  };
  return {
    nodeVersion: `${REQUIRED_TOOLCHAIN.node}\n`,
    packageJson: {
      packageManager: REQUIRED_TOOLCHAIN.packageManager,
      dependencies,
      devDependencies,
      engines,
    },
    packageLock: {
      packages: {
        '': {
          dependencies: { ...dependencies },
          devDependencies: { ...devDependencies },
          engines: { ...engines },
        },
        'node_modules/three': { version: REQUIRED_TOOLCHAIN.three },
        'node_modules/playwright': { version: REQUIRED_TOOLCHAIN.playwright },
        'node_modules/sharp': { version: REQUIRED_TOOLCHAIN.sharp },
        'node_modules/vite': { version: REQUIRED_TOOLCHAIN.vite },
      },
    },
  };
}

test('root metadata declares every toolchain component exactly', () => {
  const packageJson = readJson(join(REPO_ROOT, 'package.json'));
  const packageLock = readJson(join(REPO_ROOT, 'package-lock.json'));
  const nodeVersion = readFileSync(join(REPO_ROOT, '.node-version'), 'utf8');
  assert.deepEqual(validateToolchainDeclarations({ packageJson, packageLock, nodeVersion }), []);
  assert.equal(packageJson.scripts['toolchain:preflight'], 'node scripts/toolchain-preflight.mjs');
  assert.equal(
    packageJson.scripts['browser:install'],
    'PLAYWRIGHT_BROWSERS_PATH=0 playwright install chromium',
  );
});

test('declaration validation rejects ranges and lock drift with stable reasons', () => {
  const ranged = declarationFixture();
  ranged.packageJson.devDependencies.sharp = '^0.35.3';
  assert.deepEqual(validateToolchainDeclarations(ranged), [
    '[PACKAGE_DECLARATION_MISMATCH] devDependencies.sharp must equal 0.35.3; received "^0.35.3".',
  ]);

  const driftedLock = declarationFixture();
  driftedLock.packageLock.packages['node_modules/vite'].version = '8.1.2';
  assert.deepEqual(validateToolchainDeclarations(driftedLock), [
    '[LOCK_RESOLUTION_MISMATCH] package-lock node_modules/vite must resolve to 8.1.3; received "8.1.2".',
  ]);
});

test('declaration validation rejects runtime metadata drift', () => {
  const fixture = declarationFixture();
  fixture.packageJson.packageManager = 'npm@10.9.3';
  fixture.packageJson.engines.node = '>=22';
  fixture.packageLock.packages[''].engines.npm = '^10.9.4';
  fixture.nodeVersion = '22\n';
  assert.deepEqual(validateToolchainDeclarations(fixture), [
    '[PACKAGE_MANAGER_MISMATCH] packageManager must equal npm@10.9.4; received "npm@10.9.3".',
    '[ENGINE_NODE_MISMATCH] engines.node must equal 22.22.0; received ">=22".',
    '[LOCK_ENGINE_NPM_MISMATCH] package-lock packages[""].engines.npm must equal 10.9.4; received "^10.9.4".',
    '[NODE_VERSION_FILE_MISMATCH] .node-version must contain 22.22.0; received "22".',
  ]);
});

test('installed dependency and runtime probes remain claim-specific', () => {
  assert.deepEqual(validateInstalledPackageVersions({
    three: '0.185.1',
    playwright: '1.61.1',
    vite: '8.1.2',
    sharp: undefined,
  }), [
    '[INSTALLED_PACKAGE_MISMATCH] node_modules/vite/package.json must report 8.1.3; received "8.1.2". Run npm ci.',
    '[INSTALLED_PACKAGE_MISMATCH] node_modules/sharp/package.json must report 0.35.3; received missing. Run npm ci.',
  ]);

  assert.deepEqual(validateRuntimeVersions({
    nodeVersion: '22.21.0',
    npmVersion: '10.9.3',
    threeRevision: '184',
  }), [
    '[NODE_RUNTIME_MISMATCH] running Node must be 22.22.0; received "22.21.0". Activate .node-version before running repository commands.',
    '[NPM_RUNTIME_MISMATCH] the npm executable must be 10.9.4; received "10.9.3". Use npm@10.9.4.',
    '[THREE_REVISION_MISMATCH] the installed Three.js module must expose REVISION 185; received "184". Run npm ci.',
  ]);
});

test('npm probe executes the active npm and reports the pinned version', () => {
  const probe = probeNpmVersion();
  assert.equal(probe.error, null);
  assert.equal(probe.version, REQUIRED_TOOLCHAIN.npm);
});

test('Chromium validation rejects global caches, missing files, and non-executables', () => {
  const localBrowsersRoot = '/repo/node_modules/playwright-core/.local-browsers';
  const localExecutable = `${localBrowsersRoot}/chromium-1228/chrome`;

  assert.deepEqual(validateChromiumInstallation({
    executablePath: '/Users/test/Library/Caches/ms-playwright/chromium-1228/chrome',
    localBrowsersRoot,
  }), [
    '[PLAYWRIGHT_CHROMIUM_OUTSIDE_ROOT] pinned Chromium must live under /repo/node_modules/playwright-core/.local-browsers; Playwright resolved /Users/test/Library/Caches/ms-playwright/chromium-1228/chrome. Run npm run browser:install.',
  ]);

  assert.deepEqual(validateChromiumInstallation({
    executablePath: localExecutable,
    localBrowsersRoot,
    pathExists: () => false,
  }), [
    `[PLAYWRIGHT_CHROMIUM_MISSING] pinned Playwright Chromium is not installed at ${localExecutable}. Run npm run browser:install.`,
  ]);

  assert.deepEqual(validateChromiumInstallation({
    executablePath: localExecutable,
    localBrowsersRoot,
    pathExists: () => true,
    pathIsExecutable: () => false,
  }), [
    `[PLAYWRIGHT_CHROMIUM_NOT_EXECUTABLE] pinned Playwright Chromium is not executable at ${localExecutable}. Re-run npm run browser:install and inspect filesystem permissions.`,
  ]);
});

test('Chromium validation accepts only executable paths confined after realpath', () => {
  const localBrowsersRoot = '/repo/node_modules/playwright-core/.local-browsers';
  const localExecutable = `${localBrowsersRoot}/chromium-1228/chrome`;
  const common = {
    executablePath: localExecutable,
    localBrowsersRoot,
    repositoryRoot: '/repo',
    pathExists: () => true,
    pathIsExecutable: () => true,
  };

  assert.deepEqual(validateChromiumInstallation({
    ...common,
    realPath: (path) => path,
  }), []);

  assert.deepEqual(validateChromiumInstallation({
    ...common,
    realPath: (path) => (path === localExecutable ? '/tmp/escaped-chromium' : path),
  }), [
    '[PLAYWRIGHT_CHROMIUM_SYMLINK_ESCAPE] pinned Chromium resolves outside /repo/node_modules/playwright-core/.local-browsers: /tmp/escaped-chromium. Re-run npm run browser:install in a clean dependency tree.',
  ]);

  assert.deepEqual(validateChromiumInstallation({
    ...common,
    realPath: (path) => (path === localBrowsersRoot ? '/tmp/shared-browser-cache' : path),
  }), [
    "[PLAYWRIGHT_BROWSER_ROOT_SYMLINK_ESCAPE] Playwright's local browser directory resolves outside /repo: /tmp/shared-browser-cache. Re-run npm run browser:install in a non-symlinked dependency tree.",
  ]);
});
