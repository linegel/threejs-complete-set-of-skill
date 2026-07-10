import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';

const EXCLUDED_PUBLISHED_FILES = new Set(['.DS_Store', 'source-manifest.json']);

function toPosix(path) {
  return path.split(sep).join('/');
}

function walk(path) {
  if (!existsSync(path)) return [];
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return EXCLUDED_PUBLISHED_FILES.has(path.split(sep).at(-1)) ? [] : [path];
  if (!stat.isDirectory()) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => !EXCLUDED_PUBLISHED_FILES.has(entry.name))
    .flatMap((entry) => walk(join(path, entry.name)));
}

export function publishedHashInputs(repoRoot, labId) {
  return [`docs/demos/${labId}`, 'docs/demos/assets']
    .filter((path) => existsSync(join(repoRoot, path)));
}

export function computePublishedBundleHash(repoRoot, inputs) {
  const files = [...new Set(inputs.flatMap((path) => walk(join(repoRoot, path))))]
    .sort((a, b) => toPosix(relative(repoRoot, a)).localeCompare(toPosix(relative(repoRoot, b))));
  if (files.length === 0) return null;
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(toPosix(relative(repoRoot, file)));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}
