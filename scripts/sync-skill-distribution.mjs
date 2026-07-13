#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  symlinkSync
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distributionRoot = join(root, 'skills');

const fail = (message) => {
  console.error(`skill distribution sync failed: ${message}`);
  process.exit(1);
};

const skillNames = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('threejs-'))
  .map((entry) => entry.name)
  .sort();

const ensureDirectory = (path) => {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
  if (!lstatSync(path).isDirectory()) fail(`${relative(root, path)} is not a directory`);
};

const ensureRelativeSymlink = (linkPath, targetPath, type) => {
  const expected = relative(dirname(linkPath), targetPath);
  if (!existsSync(linkPath) && !lstatExists(linkPath)) {
    symlinkSync(expected, linkPath, type);
    return;
  }
  const stat = lstatSync(linkPath);
  if (!stat.isSymbolicLink() || readlinkSync(linkPath) !== expected) {
    fail(`${relative(root, linkPath)} is not the expected confined product link (${expected})`);
  }
};

const lstatExists = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

ensureDirectory(distributionRoot);

const unexpectedSkills = readdirSync(distributionRoot)
  .filter((name) => !skillNames.includes(name));
if (unexpectedSkills.length > 0) {
  fail(`unexpected entries require manual review: ${unexpectedSkills.join(', ')}`);
}

for (const skillName of skillNames) {
  const sourceRoot = join(root, skillName);
  const targetRoot = join(distributionRoot, skillName);
  ensureDirectory(targetRoot);

  const expectedEntries = new Set(['SKILL.md', 'references']);
  ensureRelativeSymlink(join(targetRoot, 'SKILL.md'), join(sourceRoot, 'SKILL.md'), 'file');
  ensureRelativeSymlink(join(targetRoot, 'references'), join(sourceRoot, 'references'), 'dir');

  const assetsPath = join(sourceRoot, 'assets');
  if (existsSync(assetsPath)) {
    expectedEntries.add('assets');
    ensureRelativeSymlink(join(targetRoot, 'assets'), assetsPath, 'dir');
  }

  const scriptsPath = join(sourceRoot, 'scripts');
  if (existsSync(scriptsPath)) {
    expectedEntries.add('scripts');
    const targetScriptsPath = join(targetRoot, 'scripts');
    ensureDirectory(targetScriptsPath);
    const productScripts = readdirSync(scriptsPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('test_'))
      .map((entry) => entry.name)
      .sort();
    const unexpectedScripts = readdirSync(targetScriptsPath)
      .filter((name) => !productScripts.includes(name));
    if (unexpectedScripts.length > 0) {
      fail(`${skillName}/scripts has unexpected entries requiring manual review: ${unexpectedScripts.join(', ')}`);
    }
    for (const scriptName of productScripts) {
      ensureRelativeSymlink(
        join(targetScriptsPath, scriptName),
        join(scriptsPath, scriptName),
        'file'
      );
    }
  }

  const unexpectedEntries = readdirSync(targetRoot)
    .filter((name) => !expectedEntries.has(name));
  if (unexpectedEntries.length > 0) {
    fail(`${skillName} has unexpected distributed entries: ${unexpectedEntries.join(', ')}`);
  }
}

console.log(`Synchronized ${skillNames.length} product-only skill directories under skills/`);
