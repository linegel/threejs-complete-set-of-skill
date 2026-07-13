#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const fail = (message) => {
  console.error(`skill package validation failed: ${message}`);
  process.exit(1);
};

const walkFiles = (path) => {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });
};

let packOutput;
try {
  packOutput = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_cache: join(tmpdir(), 'threejs-skill-pack-npm-cache'),
    },
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (error) {
  fail(`npm pack --dry-run failed: ${error.stderr || error.message}`);
}

const report = JSON.parse(packOutput)[0];
const packaged = new Set((report?.files ?? []).map((entry) => entry.path));
const skillNames = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('threejs-'))
  .map((entry) => entry.name)
  .sort();

const forbiddenSegments = new Set([
  '.agent', 'artifacts', 'docs', 'evidence', 'examples', 'integration-labs',
  'labs', 'node_modules', 'tests',
]);
for (const path of packaged) {
  if (path.split('/').some((segment) => forbiddenSegments.has(segment))) {
    fail(`package contains non-product path ${path}`);
  }
  if (/(?:^|\/)(?:plan|review)\.md$/.test(path)) fail(`package contains development note ${path}`);
  if (/\/scripts\/test_[^/]+\.py$/.test(path)) fail(`package contains QA executable ${path}`);
}

const missing = [];
for (const skillName of skillNames) {
  for (const required of [
    join(root, skillName, 'SKILL.md'),
    ...walkFiles(join(root, skillName, 'references')),
    ...walkFiles(join(root, skillName, 'assets')),
    ...walkFiles(join(root, skillName, 'scripts')).filter((path) => {
      const relativeScript = relative(join(root, skillName, 'scripts'), path).split('\\').join('/');
      return !relativeScript.includes('/') && relativeScript.endsWith('.py') && !relativeScript.startsWith('test_');
    }),
  ]) {
    const packagePath = relative(root, required).split('\\').join('/');
    if (!packaged.has(packagePath)) missing.push(packagePath);
  }
}
if (missing.length > 0) fail(`package omits essential product resources: ${missing.join(', ')}`);

const packagedSkills = [...packaged].filter((path) => path.endsWith('/SKILL.md'));
if (packagedSkills.length !== skillNames.length) {
  fail(`package contains ${packagedSkills.length} SKILL.md files for ${skillNames.length} product skills`);
}

console.log(
  `Validated npm skill package: ${report.entryCount} files, ${report.size} packed bytes, `
  + `${report.unpackedSize} unpacked bytes`,
);
