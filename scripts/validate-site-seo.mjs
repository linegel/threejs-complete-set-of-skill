#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const SITE = 'https://threejs-skills.com/';
const OLD_SITE = 'https://linegel.github.io/threejs-complete-set-of-skill/';
const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function walk(directory, predicate = () => true) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path, predicate));
    else if (predicate(path)) files.push(path);
  }
  return files;
}

function matches(html, pattern) {
  return [...html.matchAll(pattern)];
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? null;
}

function headValue(html, key, value) {
  const tags = matches(html, /<meta\b[^>]*>/gi);
  return tags.filter(([tag]) => attribute(tag, key)?.toLowerCase() === value.toLowerCase())
    .map(([tag]) => attribute(tag, 'content'));
}

function canonicalValues(html) {
  return matches(html, /<link\b[^>]*>/gi)
    .filter(([tag]) => attribute(tag, 'rel')?.toLowerCase().split(/\s+/).includes('canonical'))
    .map(([tag]) => attribute(tag, 'href'));
}

function alternateValues(html, type) {
  return matches(html, /<link\b[^>]*>/gi)
    .filter(([tag]) => attribute(tag, 'rel')?.toLowerCase().split(/\s+/).includes('alternate'))
    .filter(([tag]) => attribute(tag, 'type')?.toLowerCase() === type.toLowerCase())
    .map(([tag]) => attribute(tag, 'href'));
}

function localPathForUrl(urlString) {
  const url = new URL(urlString);
  if (url.origin !== new URL(SITE).origin) return null;
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') return join(DOCS, 'index.html');
  if (pathname.endsWith('/')) return join(DOCS, pathname, 'index.html');
  return join(DOCS, pathname);
}

function validateJsonLd(html, label) {
  const scripts = matches(html, /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  assert(scripts.length > 0, `${label}: missing JSON-LD`);
  const parsed = [];
  for (const [, source] of scripts) {
    try {
      parsed.push(JSON.parse(source));
    } catch (error) {
      errors.push(`${label}: invalid JSON-LD (${error.message})`);
    }
  }
  return parsed;
}

function graphNodes(values) {
  return values.flatMap((value) => Array.isArray(value?.['@graph']) ? value['@graph'] : [value]);
}

function hasType(node, type) {
  const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
  return types.includes(type);
}

function validateIndexablePage(path, expectedUrl, {
  requireH1 = false,
  validateImages = false,
  requireDiscovery = false,
  requireArticle = false,
  requireCatalog = false,
} = {}) {
  const label = relative(ROOT, path);
  const html = readFileSync(path, 'utf8');
  const titles = matches(html, /<title>([\s\S]*?)<\/title>/gi).map((match) => match[1].replace(/<[^>]+>/g, '').trim());
  const descriptions = headValue(html, 'name', 'description');
  const robots = headValue(html, 'name', 'robots');
  const canonicals = canonicalValues(html);

  assert(/<html\b[^>]*\blang=["']en["']/i.test(html), `${label}: missing html lang="en"`);
  assert(titles.length === 1, `${label}: expected one title, found ${titles.length}`);
  if (titles[0]) assert(titles[0].length >= 20 && titles[0].length <= 65, `${label}: title length ${titles[0].length} is outside 20–65 characters`);
  assert(descriptions.length === 1, `${label}: expected one meta description, found ${descriptions.length}`);
  if (descriptions[0]) assert(descriptions[0].length >= 80 && descriptions[0].length <= 165, `${label}: description length ${descriptions[0].length} is outside 80–165 characters`);
  assert(robots.length === 1 && /\bindex\b/i.test(robots[0]) && !/\bnoindex\b/i.test(robots[0]), `${label}: page is not explicitly indexable`);
  assert(robots[0]?.includes('max-image-preview:large'), `${label}: large image previews are not enabled`);
  assert(canonicals.length === 1, `${label}: expected one canonical URL, found ${canonicals.length}`);
  assert(canonicals[0] === expectedUrl, `${label}: canonical ${canonicals[0] ?? '(missing)'} does not match ${expectedUrl}`);
  assert(headValue(html, 'property', 'og:title').length === 1, `${label}: missing or duplicate og:title`);
  assert(headValue(html, 'property', 'og:description').length === 1, `${label}: missing or duplicate og:description`);
  assert(headValue(html, 'property', 'og:url')[0] === expectedUrl, `${label}: og:url is not self-referential`);
  assert(headValue(html, 'property', 'og:image').length === 1, `${label}: missing or duplicate og:image`);
  assert(headValue(html, 'name', 'twitter:card')[0] === 'summary_large_image', `${label}: twitter card is not summary_large_image`);
  assert(!html.includes(OLD_SITE), `${label}: contains the retired GitHub Pages origin`);
  const structuredData = validateJsonLd(html, label);
  const nodes = graphNodes(structuredData);

  if (requireDiscovery) {
    assert(alternateValues(html, 'text/plain')[0] === `${SITE}llms.txt`, `${label}: missing canonical llms.txt discovery link`);
    assert(alternateValues(html, 'application/json')[0] === `${SITE}skills.json`, `${label}: missing canonical skills.json discovery link`);
  }
  if (requireCatalog) {
    for (const type of ['Organization', 'WebSite', 'CollectionPage', 'SoftwareSourceCode', 'ItemList']) {
      assert(nodes.some((node) => hasType(node, type)), `${label}: missing ${type} structured-data node`);
    }
  }
  if (requireArticle) {
    const article = nodes.find((node) => hasType(node, 'Article'));
    assert(article && hasType(article, 'TechArticle'), `${label}: article is not typed as Article and TechArticle`);
    const publisher = nodes.find((node) => hasType(node, 'Organization') && node['@id'] === `${SITE}#publisher`);
    assert(publisher?.url === SITE && publisher?.sameAs === 'https://github.com/linegel/threejs-complete-set-of-skill', `${label}: publisher identity is incomplete`);
    assert(article?.author?.['@id'] === `${SITE}#publisher` && article?.publisher?.['@id'] === `${SITE}#publisher`, `${label}: article author/publisher references are inconsistent`);
    const published = Date.parse(article?.datePublished ?? '');
    const modified = Date.parse(article?.dateModified ?? '');
    assert(Number.isFinite(published), `${label}: missing or invalid datePublished`);
    assert(Number.isFinite(modified), `${label}: missing or invalid dateModified`);
    assert(!Number.isFinite(published) || !Number.isFinite(modified) || published <= modified, `${label}: datePublished is later than dateModified`);
    assert(headValue(html, 'property', 'article:published_time')[0] === article?.datePublished, `${label}: Open Graph publication time differs from JSON-LD`);
    assert(headValue(html, 'property', 'article:modified_time')[0] === article?.dateModified, `${label}: Open Graph modification time differs from JSON-LD`);
  }

  if (requireH1) {
    const h1 = matches(html, /<h1\b[^>]*>/gi).length;
    assert(h1 === 1, `${label}: expected one h1, found ${h1}`);
  }
  if (validateImages) {
    for (const [tag] of matches(html, /<img\b[^>]*>/gi)) {
      assert(attribute(tag, 'alt') !== null, `${label}: image lacks alt text (${tag.slice(0, 100)})`);
      assert(/^\d+$/.test(attribute(tag, 'width') ?? ''), `${label}: image lacks intrinsic width (${attribute(tag, 'src')})`);
      assert(/^\d+$/.test(attribute(tag, 'height') ?? ''), `${label}: image lacks intrinsic height (${attribute(tag, 'src')})`);
    }
  }
  return {
    title: titles[0],
    description: descriptions[0],
    html,
  };
}

function duplicateValues(records, key) {
  const owners = new Map();
  for (const record of records) {
    const value = record[key];
    if (!value) continue;
    const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!owners.has(normalized)) owners.set(normalized, []);
    owners.get(normalized).push(record.url);
  }
  return [...owners.values()].filter((urls) => urls.length > 1);
}

const sitemapPath = join(DOCS, 'sitemap.xml');
const sitemap = readFileSync(sitemapPath, 'utf8');
const sitemapUrls = matches(sitemap, /<loc>([^<]+)<\/loc>/g).map((match) => match[1]);
const pageUrls = sitemapUrls.filter((url) => !/\.(?:png|jpg|jpeg|webp|avif|gif)$/i.test(new URL(url).pathname));
const sitemapSet = new Set(pageUrls);
const pageRecords = [];
assert(sitemap.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'), 'sitemap.xml: image namespace is missing');
assert(!sitemap.includes('<changefreq>') && !sitemap.includes('<priority>'), 'sitemap.xml: contains ignored changefreq or priority hints');
assert(new Set(pageUrls).size === pageUrls.length, 'sitemap.xml: contains duplicate page URLs');
assert(pageUrls.every((url) => url.startsWith(SITE)), 'sitemap.xml: contains a URL outside the canonical origin');
assert(!sitemap.includes(OLD_SITE), 'sitemap.xml: contains the retired GitHub Pages origin');
for (const [, lastmod] of matches(sitemap, /<lastmod>([^<]+)<\/lastmod>/g)) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(lastmod), `sitemap.xml: invalid lastmod ${lastmod}`);
}

for (const url of pageUrls) {
  const path = localPathForUrl(url);
  assert(path && existsSync(path) && statSync(path).isFile(), `sitemap.xml: ${url} has no generated file`);
  if (!path || !existsSync(path)) continue;
  const isHome = url === SITE;
  const isSkill = new URL(url).pathname.startsWith('/skills/');
  const record = validateIndexablePage(path, url, {
    requireH1: isHome || isSkill,
    validateImages: isHome || isSkill,
    requireDiscovery: isHome || isSkill,
    requireArticle: isSkill,
    requireCatalog: isHome,
  });
  pageRecords.push({ url, ...record });
}

for (const [key, label] of [['title', 'title'], ['description', 'meta description']]) {
  for (const urls of duplicateValues(pageRecords, key)) {
    errors.push(`duplicate ${label}: ${urls.join(', ')}`);
  }
}

const inboundLinks = new Map(pageUrls.map((url) => [url, 0]));
for (const record of pageRecords) {
  for (const [tag] of matches(record.html, /<a\b[^>]*href=["'][^"']+["'][^>]*>/gi)) {
    const href = attribute(tag, 'href');
    if (!href || /^(?:mailto:|tel:|javascript:)/i.test(href)) continue;
    const target = new URL(href, record.url);
    target.hash = '';
    if (target.origin !== new URL(SITE).origin || !sitemapSet.has(target.href) || target.href === record.url) continue;
    inboundLinks.set(target.href, inboundLinks.get(target.href) + 1);
  }
}
for (const [url, count] of inboundLinks) {
  if (url !== SITE) assert(count > 0, `sitemap.xml: orphaned indexable URL ${url}`);
}

for (const path of walk(DOCS, (file) => file.endsWith('.html'))) {
  const relativePath = relative(DOCS, path).split('\\').join('/');
  const html = readFileSync(path, 'utf8');
  if (relativePath === '404.html') {
    assert(headValue(html, 'name', 'robots')[0]?.includes('noindex'), '404.html: missing noindex');
    continue;
  }
  if (/\/demos\/[^/]+\/(?:scenario|mechanism|tier)\//.test(`/${relativePath}`)) {
    const robots = headValue(html, 'name', 'robots');
    const canonicals = canonicalValues(html);
    assert(robots.length === 1 && /\bnoindex\b/i.test(robots[0]) && /\bfollow\b/i.test(robots[0]), `${relativePath}: state wrapper must be noindex, follow`);
    assert(canonicals.length === 1 && /^https:\/\/threejs-skills\.com\/demos\/[^/]+\/$/.test(canonicals[0]), `${relativePath}: wrapper canonical must point to its base demo`);
    const wrapperUrl = `${SITE}${relativePath.replace(/index\.html$/, '')}`;
    assert(!sitemapSet.has(wrapperUrl), `${relativePath}: state wrapper must not be in sitemap`);
  }
}

for (const path of [join(DOCS, 'index.html'), ...walk(join(DOCS, 'skills'), (file) => file.endsWith('.html'))]) {
  const label = relative(ROOT, path);
  const html = readFileSync(path, 'utf8');
  assert(!/href=["'][^"']*index\.html(?:[#"'])/i.test(html), `${label}: internal navigation reinforces duplicate index.html URLs`);
  const base = canonicalValues(html)[0];
  if (!base) continue;
  for (const [tag] of matches(html, /<a\b[^>]*href=["'][^"']+["'][^>]*>/gi)) {
    const href = attribute(tag, 'href');
    if (!href || /^(?:mailto:|tel:|javascript:)/i.test(href) || href.startsWith('#')) continue;
    const resolved = new URL(href, base);
    if (resolved.origin !== new URL(SITE).origin) continue;
    const target = localPathForUrl(resolved.href);
    assert(target && existsSync(target), `${label}: broken internal link ${href}`);
  }
}

const robotsText = readFileSync(join(DOCS, 'robots.txt'), 'utf8');
assert(/User-agent:\s*\*/i.test(robotsText) && /Allow:\s*\//i.test(robotsText), 'robots.txt: crawlers are not allowed');
assert(robotsText.includes(`Sitemap: ${SITE}sitemap.xml`), 'robots.txt: sitemap points at the wrong origin');
assert(!robotsText.includes(OLD_SITE), 'robots.txt: contains the retired GitHub Pages origin');
assert(readFileSync(join(DOCS, 'CNAME'), 'utf8').trim() === 'threejs-skills.com', 'CNAME: custom domain does not match the canonical origin');

for (const name of ['llm.txt', 'llms.txt', 'skills.json', 'site.webmanifest', 'robots.txt', 'sitemap.xml']) {
  const text = readFileSync(join(DOCS, name), 'utf8');
  assert(!text.includes(OLD_SITE), `${name}: contains the retired GitHub Pages origin`);
}

if (errors.length) {
  console.error(`Site SEO validation failed (${errors.length} errors):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated SEO for ${pageUrls.length} indexable pages and ${walk(DOCS, (file) => file.endsWith('.html')).length} generated HTML files.`);
}
