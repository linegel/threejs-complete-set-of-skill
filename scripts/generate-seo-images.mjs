#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const SKILLS = join(DOCS, 'skills');
const OUTPUT = join(DOCS, 'seo', 'article');
const SITE = new URL('https://threejs-skills.com/');
const RATIOS = [
  { id: '1x1', width: 1200, height: 1200 },
  { id: '4x3', width: 1200, height: 900 },
  { id: '16x9', width: 1200, height: 675 },
];

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? null;
}

function metaContent(html, property) {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attribute(tag, 'property') === property) return attribute(tag, 'content');
  }
  return null;
}

function localImagePath(urlString) {
  const url = new URL(urlString);
  if (url.origin !== SITE.origin) throw new Error(`SEO source image is outside ${SITE.origin}: ${urlString}`);
  const path = join(DOCS, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  if (!existsSync(path)) throw new Error(`SEO source image does not exist: ${path}`);
  return path;
}

mkdirSync(OUTPUT, { recursive: true });
const expectedFiles = new Set(['manifest.json']);
const manifest = {};

for (const file of readdirSync(SKILLS).filter((name) => name.endsWith('.html')).sort()) {
  const slug = file.replace(/\.html$/, '');
  const html = readFileSync(join(SKILLS, file), 'utf8');
  const sourceUrl = metaContent(html, 'og:image');
  if (!sourceUrl) continue;
  const sourcePath = localImagePath(sourceUrl);
  const sourceMetadata = await sharp(sourcePath).metadata();
  manifest[slug] = {
    source: sourceUrl,
    sourceWidth: sourceMetadata.width,
    sourceHeight: sourceMetadata.height,
    images: {},
  };

  for (const ratio of RATIOS) {
    const filename = `${slug}-${ratio.id}.png`;
    const outputPath = join(OUTPUT, filename);
    expectedFiles.add(filename);
    await sharp(sourcePath)
      .resize({
        width: ratio.width,
        height: ratio.height,
        fit: 'cover',
        position: sharp.strategy.attention,
      })
      .png({
        compressionLevel: 9,
        adaptiveFiltering: true,
        palette: true,
        quality: 92,
        colours: 256,
        effort: 10,
      })
      .toFile(outputPath);
    manifest[slug].images[ratio.id] = {
      url: new URL(`seo/article/${filename}`, SITE).href,
      width: ratio.width,
      height: ratio.height,
    };
  }
}

for (const file of readdirSync(OUTPUT)) {
  if (!expectedFiles.has(file)) unlinkSync(join(OUTPUT, file));
}

writeFileSync(join(OUTPUT, 'manifest.json'), `${JSON.stringify({ generatedBy: 'scripts/generate-seo-images.mjs', ratios: RATIOS, skills: manifest }, null, 2)}\n`);
console.log(`Generated ${Object.keys(manifest).length * RATIOS.length} Article images for ${Object.keys(manifest).length} skills.`);
