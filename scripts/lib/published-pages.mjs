import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

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

function referencedValues(file, source) {
  const values = [];
  const extension = extname(file).toLowerCase();
  const collect = (pattern, group = 2) => {
    for (const match of source.matchAll(pattern)) values.push(match[group]);
  };
  if (extension === '.html') {
    collect(/\b(?:src|href|poster)=(['"])([^'"]+)\1/gi);
    for (const match of source.matchAll(/\bsrcset=(['"])([^'"]+)\1/gi)) {
      values.push(...match[2].split(',').map((candidate) => candidate.trim().split(/\s+/)[0]));
    }
  }
  if (extension === '.js' || extension === '.mjs') {
    collect(/\bfrom\s*(['"`])([^'"`]+)\1/g);
    collect(/\bimport\s*(?:\(\s*)?(['"`])([^'"`]+)\1/g);
    collect(/\bnew\s+URL\(\s*(['"`])([^'"`]+)\1\s*,\s*import\.meta\.url\s*\)/g);
  }
  if (extension === '.css') {
    collect(/\burl\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi);
    collect(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1/gi);
  }
  return values.map((value) => ({ file, value }));
}

function resolveAssetReference(repoRoot, file, value) {
  const raw = String(value ?? '').trim();
  if (!raw || /^(?:data:|blob:|https?:|#|mailto:|tel:|javascript:)/i.test(raw)) return null;
  const [path] = raw.split(/[?#]/, 1);
  if (!path) return null;
  const docsRoot = resolve(repoRoot, 'docs');
  const assetsRoot = resolve(repoRoot, 'docs', 'demos', 'assets');
  let decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error(`published asset reference is not valid URI text: ${raw}`);
  }
  const candidate = decoded.startsWith('/')
    ? resolve(docsRoot, decoded.replace(/^\/+/, ''))
    : resolve(dirname(file), decoded);
  if (candidate !== assetsRoot && !candidate.startsWith(`${assetsRoot}${sep}`)) return null;
  if (!existsSync(candidate)) {
    if (extname(candidate)) throw new Error(`published asset reference is missing: ${toPosix(relative(repoRoot, candidate))}`);
    return null;
  }
  const stat = lstatSync(candidate);
  if (stat.isSymbolicLink()) throw new Error(`published asset reference is a symlink: ${toPosix(relative(repoRoot, candidate))}`);
  return stat.isFile() ? candidate : null;
}

function parseablePublishedAsset(path) {
  return ['.css', '.html', '.js', '.mjs'].includes(extname(path).toLowerCase());
}

export function publishedAssetDependencies(repoRoot, labId) {
  const labRoot = join(repoRoot, 'docs', 'demos', labId);
  const queue = walk(labRoot).filter(parseablePublishedAsset);
  const visited = new Set();
  const assets = new Set();

  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const reference of referencedValues(file, source)) {
      const asset = resolveAssetReference(repoRoot, reference.file, reference.value);
      if (!asset || assets.has(asset)) continue;
      assets.add(asset);
      if (parseablePublishedAsset(asset)) queue.push(asset);
    }
  }

  return [...assets]
    .map((path) => toPosix(relative(repoRoot, path)))
    .sort();
}

export function allPublishedAssetFiles(repoRoot) {
  return walk(join(repoRoot, 'docs', 'demos', 'assets'))
    .map((path) => toPosix(relative(repoRoot, path)))
    .sort();
}

export function publishedHashInputs(repoRoot, labId) {
  return [`docs/demos/${labId}`, ...publishedAssetDependencies(repoRoot, labId)]
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
