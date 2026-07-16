#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  ownerIdForResponsiveSource,
  responsiveDependencyHash,
  sha256,
  staleManifestOwnedOutputPaths,
} from './lib/generated-asset-ledger.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const SITE = new URL('https://threejs-skills.com/');
const MANIFEST_PATH = join(DOCS, 'seo', 'responsive-images.json');

function parseManifest(source, label) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

const previousManifests = [];
if (existsSync(MANIFEST_PATH)) {
  previousManifests.push(parseManifest(readFileSync(MANIFEST_PATH, 'utf8'), MANIFEST_PATH));
}
try {
  const tracked = execFileSync('git', ['show', 'HEAD:docs/seo/responsive-images.json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  previousManifests.push(parseManifest(tracked, 'tracked responsive image manifest'));
} catch {
  // A source archive may not contain Git metadata; the on-disk manifest remains authoritative there.
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? null;
}

function htmlFilesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return htmlFilesUnder(path);
    return entry.isFile() && entry.name.endsWith('.html') ? [path] : [];
  });
}

const EXCLUDED_INDEX_SUBTREES = new Set([
  join(DOCS, 'demos'),
  join(DOCS, 'labs'),
]);

function indexFilesUnder(directory) {
  if (!existsSync(directory) || EXCLUDED_INDEX_SUBTREES.has(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return indexFilesUnder(path);
    return entry.isFile() && entry.name === 'index.html' ? [path] : [];
  });
}

function pageFiles() {
  return [...new Set([
    ...indexFilesUnder(DOCS),
    ...htmlFilesUnder(join(DOCS, 'skills')),
    ...htmlFilesUnder(join(DOCS, 'evidence')),
  ])].sort();
}

function localSourcePath(pagePath, src) {
  const url = new URL(src, new URL(relative(DOCS, pagePath).split(sep).join('/'), SITE));
  if (url.origin !== SITE.origin) throw new Error(`${pagePath}: responsive source is outside ${SITE.origin}: ${src}`);
  const path = resolve(DOCS, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  if (!path.startsWith(`${resolve(DOCS)}${sep}`)) throw new Error(`${pagePath}: responsive source escapes docs/: ${src}`);
  if (!existsSync(path)) throw new Error(`${pagePath}: responsive source does not exist: ${src}`);
  if (!/\.png$/i.test(path)) throw new Error(`${pagePath}: responsive source must be PNG: ${src}`);
  return path;
}

const sources = new Set();
for (const pagePath of pageFiles()) {
  const html = readFileSync(pagePath, 'utf8');
  for (const [tag] of html.matchAll(/<img\b[^>]*\bdata-responsive-preview\b[^>]*>/gi)) {
    const src = attribute(tag, 'src');
    if (!src) throw new Error(`${pagePath}: responsive preview is missing src`);
    sources.add(localSourcePath(pagePath, src));
  }
}

const manifest = {};
for (const sourcePath of [...sources].sort()) {
  const relativeSource = relative(DOCS, sourcePath).split(sep).join('/');
  const sourceMetadata = await sharp(sourcePath).metadata();
  const sourceBytes = statSync(sourcePath).size;
  const outputs = [
    {
      format: 'avif',
      path: sourcePath.replace(/\.png$/i, '.avif'),
      candidates: [
        { id: 'quality-60', encode: (pipeline) => pipeline.avif({ quality: 60, effort: 7, chromaSubsampling: '4:4:4' }) },
      ],
    },
    {
      format: 'webp',
      path: sourcePath.replace(/\.png$/i, '.webp'),
      candidates: [
        { id: 'quality-80', encode: (pipeline) => pipeline.webp({ quality: 80, effort: 6, smartSubsample: true }) },
        { id: 'lossless', encode: (pipeline) => pipeline.webp({ lossless: true, effort: 6 }) },
      ],
    },
  ];
  manifest[relativeSource] = {
    ownerId: ownerIdForResponsiveSource(relativeSource),
    url: new URL(relativeSource, SITE).href,
    width: sourceMetadata.width,
    height: sourceMetadata.height,
    bytes: sourceBytes,
    sourceSha256: sha256(readFileSync(sourcePath)),
    formats: {},
  };

  for (const output of outputs) {
    const candidates = await Promise.all(output.candidates.map(async (candidate) => ({
      id: candidate.id,
      bytes: await candidate.encode(sharp(sourcePath)).toBuffer(),
    })));
    const selected = candidates.reduce((smallest, candidate) => (
      candidate.bytes.byteLength < smallest.bytes.byteLength ? candidate : smallest
    ));
    writeFileSync(output.path, selected.bytes);
    const outputMetadata = await sharp(output.path).metadata();
    const relativeOutput = relative(DOCS, output.path).split(sep).join('/');
    manifest[relativeSource].formats[output.format] = {
      url: new URL(relativeOutput, SITE).href,
      width: outputMetadata.width,
      height: outputMetadata.height,
      bytes: statSync(output.path).size,
      encoding: selected.id,
      sha256: sha256(selected.bytes),
    };
  }
  manifest[relativeSource].dependencyClosureHash = responsiveDependencyHash(
    relativeSource,
    manifest[relativeSource],
  );
}

mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
const outputManifest = {
  schemaVersion: 2,
  generatedBy: 'scripts/generate-responsive-images.mjs',
  sources: manifest,
};
let pruned = 0;
for (const stalePath of staleManifestOwnedOutputPaths(previousManifests, outputManifest, DOCS, SITE)) {
  if (!existsSync(stalePath)) continue;
  unlinkSync(stalePath);
  pruned += 1;
}
writeFileSync(MANIFEST_PATH, `${JSON.stringify(outputManifest, null, 2)}\n`);
console.log(`Generated AVIF and WebP variants for ${sources.size} visible PNG previews; pruned ${pruned} stale manifest-owned output(s).`);
