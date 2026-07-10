#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const SITE = new URL('https://threejs-skills.com/');
const MANIFEST_PATH = join(DOCS, 'seo', 'responsive-images.json');

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? null;
}

function pageFiles() {
  return [
    join(DOCS, 'index.html'),
    ...readdirSync(join(DOCS, 'skills'))
      .filter((name) => name.endsWith('.html'))
      .sort()
      .map((name) => join(DOCS, 'skills', name)),
  ];
}

function localSourcePath(pagePath, src) {
  const url = new URL(src, new URL(relative(DOCS, pagePath).split(sep).join('/'), SITE));
  if (url.origin !== SITE.origin) throw new Error(`${pagePath}: responsive source is outside ${SITE.origin}: ${src}`);
  const path = resolve(dirname(pagePath), decodeURIComponent(src).split(/[?#]/, 1)[0]);
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
      encode: (pipeline) => pipeline.avif({ quality: 60, effort: 7, chromaSubsampling: '4:4:4' }),
    },
    {
      format: 'webp',
      path: sourcePath.replace(/\.png$/i, '.webp'),
      encode: (pipeline) => pipeline.webp({ quality: 80, effort: 6, smartSubsample: true }),
    },
  ];
  manifest[relativeSource] = {
    url: new URL(relativeSource, SITE).href,
    width: sourceMetadata.width,
    height: sourceMetadata.height,
    bytes: sourceBytes,
    formats: {},
  };

  for (const output of outputs) {
    await output.encode(sharp(sourcePath)).toFile(output.path);
    const outputMetadata = await sharp(output.path).metadata();
    const relativeOutput = relative(DOCS, output.path).split(sep).join('/');
    manifest[relativeSource].formats[output.format] = {
      url: new URL(relativeOutput, SITE).href,
      width: outputMetadata.width,
      height: outputMetadata.height,
      bytes: statSync(output.path).size,
    };
  }
}

mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
writeFileSync(MANIFEST_PATH, `${JSON.stringify({
  generatedBy: 'scripts/generate-responsive-images.mjs',
  sources: manifest,
}, null, 2)}\n`);
console.log(`Generated AVIF and WebP variants for ${sources.size} visible PNG previews.`);
