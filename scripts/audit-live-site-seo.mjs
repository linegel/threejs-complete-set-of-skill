#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authoritativeSkillDirs, buildDemoRegistry } from './lib/lab-registry.mjs';
import { loadSiteContent } from './lib/site-content.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const SITE = new URL(process.env.SITE_URL ?? 'https://threejs-skills.com/');
const RETIRED_SITE = 'https://linegel.github.io/threejs-complete-set-of-skill/';
const CONCURRENCY = 8;
const PUBLISHER_LOGO = new URL('icon-512.png', SITE).href;
const ARTICLE_IMAGE_RATIOS = ['1x1', '4x3', '16x9'];
const DEMO_REGISTRY = buildDemoRegistry();
const SKILL_IDS = new Set(authoritativeSkillDirs());
if (SKILL_IDS.size !== 27) throw new Error(`live SEO audit requires exactly 27 installable skills; received ${SKILL_IDS.size}`);
const SITE_DEMOS = DEMO_REGISTRY.demos.filter((demo) => SKILL_IDS.has(demo.skill));
const DECISION_CONTENT = loadSiteContent({
  repoRoot: ROOT,
  skillIds: SKILL_IDS,
  demos: SITE_DEMOS,
  threeRevision: DEMO_REGISTRY.threeRevision,
});
const DECISION_PAGE_BY_PATHNAME = DECISION_CONTENT.pageBySlug;
const NOINDEX_DEMOS = [
  ['demos/ambient-contact-shading-webgpu-node-gtao/', 'skills/threejs-ambient-contact-shading.html'],
  ['demos/bloom-node-selective/', 'skills/threejs-bloom.html'],
];
const errors = [];
const pageRecords = [];
const structuredImageUrls = new Set([PUBLISHER_LOGO]);
const responsiveImageTypes = new Map();

function assert(condition, message) {
  if (!condition) errors.push(message);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'threejs-skills-live-seo-audit/1.0' },
    signal: AbortSignal.timeout(20_000),
    ...options,
  });
  return response;
}

function metaValues(html, attribute, value) {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
  const get = (tag, name) => tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1];
  return tags
    .filter((tag) => get(tag, attribute)?.toLowerCase() === value.toLowerCase())
    .map((tag) => get(tag, 'content'));
}

function tagAttribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? null;
}

function canonicals(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /\brel=["'][^"']*\bcanonical\b[^"']*["']/i.test(tag))
    .map((tag) => tag.match(/\bhref=["']([^"']+)["']/i)?.[1])
    .filter(Boolean);
}

function alternateValues(html, type) {
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /\brel=["'][^"']*\balternate\b[^"']*["']/i.test(tag))
    .filter((tag) => tag.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase() === type.toLowerCase())
    .map((tag) => tag.match(/\bhref=["']([^"']+)["']/i)?.[1])
    .filter(Boolean);
}

function jsonLd(html, label) {
  const values = [];
  for (const [, source] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      values.push(JSON.parse(source));
    } catch (error) {
      errors.push(`${label}: invalid JSON-LD (${error.message})`);
    }
  }
  assert(values.length > 0, `${label}: missing JSON-LD`);
  return values;
}

function schemaTypes(values) {
  return new Set(values.flatMap((value) => {
    const graph = Array.isArray(value?.['@graph']) ? value['@graph'] : [value];
    return graph.flatMap((entry) => Array.isArray(entry?.['@type']) ? entry['@type'] : [entry?.['@type']]).filter(Boolean);
  }));
}

function schemaNodes(values) {
  return values.flatMap((value) => Array.isArray(value?.['@graph']) ? value['@graph'] : [value]);
}

function hasType(node, type) {
  const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
  return types.includes(type);
}

function decisionSchemaType(page) {
  if (page.slug === '/faq/') return 'FAQPage';
  if (page.kind === 'hub') return 'CollectionPage';
  if (['ecosystem-comparison', 'technical-comparison', 'alternatives', 'user-doc', 'agent-doc', 'migration', 'faq-answer'].includes(page.kind)) {
    return 'TechArticle';
  }
  return 'WebPage';
}

function localPng(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  if (url.origin !== SITE.origin || !/\.png$/i.test(url.pathname)) return null;
  const path = resolve(DOCS, `.${decodeURIComponent(url.pathname)}`);
  if (!path.startsWith(`${resolve(DOCS)}${sep}`) || !existsSync(path)) return null;
  const data = readFileSync(path);
  if (data.length < 24 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { path, width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
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
  return [...owners.values()].filter((ownersForValue) => ownersForValue.length > 1);
}

function internalLinks(html, baseUrl) {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter((href) => !/^(?:mailto:|tel:|javascript:)/i.test(href))
    .map((href) => {
      const url = new URL(href, baseUrl);
      url.hash = '';
      return url.href;
    });
}

function staticMarkup(html) {
  return html.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '');
}

function visibleText(html) {
  return staticMarkup(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function mapConcurrent(values, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      try {
        await worker(values[index], index);
      } catch (error) {
        errors.push(`${values[index]}: ${error.message}`);
      }
    }
  }));
}

async function checkRedirect(from, expected) {
  const response = await request(from, { redirect: 'manual' });
  assert([301, 308].includes(response.status), `${from}: expected permanent redirect, received ${response.status}`);
  const location = response.headers.get('location');
  assert(location && new URL(location, from).href === expected, `${from}: redirects to ${location ?? '(missing)'}, expected ${expected}`);
}

await Promise.all([
  checkRedirect(`http://${SITE.host}/`, SITE.href),
  checkRedirect(`https://www.${SITE.host}/`, SITE.href),
  checkRedirect(RETIRED_SITE, SITE.href),
]);

const [robotsResponse, sitemapResponse, llmResponse, llmsResponse] = await Promise.all([
  request(new URL('robots.txt', SITE)),
  request(new URL('sitemap.xml', SITE)),
  request(new URL('llm.txt', SITE)),
  request(new URL('llms.txt', SITE)),
]);
const [robots, sitemap, llm, llms] = await Promise.all([
  robotsResponse.text(),
  sitemapResponse.text(),
  llmResponse.text(),
  llmsResponse.text(),
]);

assert(robotsResponse.status === 200 && robotsResponse.headers.get('content-type')?.startsWith('text/plain'), 'robots.txt: invalid response');
assert(robots.includes(`Sitemap: ${new URL('sitemap.xml', SITE).href}`), 'robots.txt: sitemap URL is not canonical');
assert(!robots.includes(RETIRED_SITE), 'robots.txt: contains the retired origin');
assert(sitemapResponse.status === 200 && sitemapResponse.headers.get('content-type')?.includes('xml'), 'sitemap.xml: invalid response');
assert(llmResponse.status === 200 && llmResponse.headers.get('content-type')?.startsWith('text/plain'), 'llm.txt: invalid response');
assert(llmsResponse.status === 200 && llmsResponse.headers.get('content-type')?.startsWith('text/plain'), 'llms.txt: invalid response');
assert(llm === llms, 'llm.txt and llms.txt differ');
assert(llm.includes(`Website: ${SITE.href}`), 'LLM discovery file does not name the canonical website');

const urls = [...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const sitemapEntries = new Map([...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, body]) => [
  body.match(/<loc>([^<]+)<\/loc>/)?.[1],
  body,
]).filter(([url]) => Boolean(url)));
const sitemapSet = new Set(urls);
assert(urls.length > 0, 'sitemap.xml: no page URLs');
assert(sitemapSet.size === urls.length, 'sitemap.xml: duplicate page URLs');
assert(urls.every((url) => url.startsWith(SITE.href)), 'sitemap.xml: URL outside the canonical origin');
assert(!sitemap.includes(RETIRED_SITE), 'sitemap.xml: contains the retired origin');
assert(!urls.some((url) => /\/(?:scenario|mechanism|tier)\//.test(new URL(url).pathname)), 'sitemap.xml: contains state-only wrapper URLs');
for (const page of DECISION_CONTENT.pages) {
  const url = new URL(page.slug, SITE).href;
  assert(sitemapSet.has(url), `${url}: authored decision page is missing from the sitemap`);
}

await mapConcurrent(NOINDEX_DEMOS, async ([demoPath, skillPath]) => {
  const demoUrl = new URL(demoPath, SITE).href;
  const response = await request(demoUrl, { redirect: 'manual' });
  assert(response.status === 200, `${demoUrl}: expected reserved placeholder 200, received ${response.status}`);
  if (response.status !== 200) return;
  const html = await response.text();
  const robots = metaValues(html, 'name', 'robots');
  assert(robots.length === 1 && /\bnoindex\b/i.test(robots[0]) && /\bfollow\b/i.test(robots[0]), `${demoUrl}: reserved placeholder must be noindex, follow`);
  assert(canonicals(html)[0] === new URL(skillPath, SITE).href, `${demoUrl}: reserved placeholder canonical does not point to its owning skill`);
  assert(!urls.includes(demoUrl), `${demoUrl}: reserved placeholder appears in the sitemap`);
});

await mapConcurrent(urls, async (url) => {
  const response = await request(url, { redirect: 'manual' });
  assert(response.status === 200, `${url}: expected 200, received ${response.status}`);
  assert(response.headers.get('content-type')?.startsWith('text/html'), `${url}: expected HTML content type`);
  if (response.status !== 200) return;
  const html = await response.text();
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description = metaValues(html, 'name', 'description');
  const robotsMeta = metaValues(html, 'name', 'robots');
  const canonical = canonicals(html);
  const structuredData = jsonLd(html, url);
  const schema = schemaTypes(structuredData);
  const nodes = schemaNodes(structuredData);
  const pathname = new URL(url).pathname;
  const decisionPage = DECISION_PAGE_BY_PATHNAME.get(pathname) ?? null;

  assert(title && title.length >= 20 && title.length <= 65, `${url}: invalid title length ${title?.length ?? 0}`);
  assert(description.length === 1 && description[0].length >= 80 && description[0].length <= 165, `${url}: invalid meta description`);
  assert(robotsMeta.length === 1 && /\bindex\b/i.test(robotsMeta[0]) && !/\bnoindex\b/i.test(robotsMeta[0]), `${url}: not explicitly indexable`);
  assert(canonical.length === 1 && canonical[0] === url, `${url}: canonical mismatch (${canonical.join(', ') || 'missing'})`);
  assert(metaValues(html, 'property', 'og:url')[0] === url, `${url}: og:url mismatch`);
  const socialImages = metaValues(html, 'property', 'og:image');
  const socialImage = socialImages[0] ?? null;
  const twitterCards = metaValues(html, 'name', 'twitter:card');
  assert(socialImages.length <= 1, `${url}: duplicate og:image metadata`);
  assert(twitterCards.length === 1, `${url}: expected one Twitter card declaration`);
  if (socialImage) {
    const imageType = metaValues(html, 'property', 'og:image:type');
    const imageWidth = metaValues(html, 'property', 'og:image:width');
    const imageHeight = metaValues(html, 'property', 'og:image:height');
    const imageAlt = metaValues(html, 'property', 'og:image:alt');
    const twitterImage = metaValues(html, 'name', 'twitter:image');
    const twitterImageAlt = metaValues(html, 'name', 'twitter:image:alt');
    const local = localPng(socialImage);
    assert(Boolean(local), `${url}: social image must be a local published PNG`);
    assert(twitterCards[0] === 'summary_large_image', `${url}: social image requires a large Twitter card`);
    assert(imageType.length === 1 && imageType[0] === 'image/png', `${url}: social image type must be image/png`);
    assert(imageWidth.length === 1 && Number.isInteger(Number(imageWidth[0])) && Number(imageWidth[0]) > 0, `${url}: invalid social image width metadata`);
    assert(imageHeight.length === 1 && Number.isInteger(Number(imageHeight[0])) && Number(imageHeight[0]) > 0, `${url}: invalid social image height metadata`);
    assert(imageAlt.length === 1 && Boolean(imageAlt[0]?.trim()), `${url}: social image requires non-empty alt metadata`);
    assert(twitterImage.length === 1 && twitterImage[0] === socialImage, `${url}: Twitter and Open Graph image URLs disagree`);
    assert(twitterImageAlt.length === 1 && twitterImageAlt[0] === imageAlt[0], `${url}: Twitter and Open Graph image alt text disagree`);
    if (local) {
      assert(Number(imageWidth[0]) === local.width, `${url}: social image width metadata disagrees with the local PNG`);
      assert(Number(imageHeight[0]) === local.height, `${url}: social image height metadata disagrees with the local PNG`);
    }
    structuredImageUrls.add(socialImage);
  } else {
    assert(twitterCards[0] === 'summary', `${url}: a page without a social image requires a summary Twitter card`);
    for (const [attribute, name, label] of [
      ['property', 'og:image:type', 'og:image:type'],
      ['property', 'og:image:width', 'og:image:width'],
      ['property', 'og:image:height', 'og:image:height'],
      ['property', 'og:image:alt', 'og:image:alt'],
      ['name', 'twitter:image', 'twitter:image'],
      ['name', 'twitter:image:alt', 'twitter:image:alt'],
    ]) assert(metaValues(html, attribute, name).length === 0, `${url}: ${label} is present without og:image`);
  }
  assert(!html.includes(RETIRED_SITE), `${url}: contains the retired origin`);

  const rawMarkup = staticMarkup(html);
  const headings = [...rawMarkup.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const mainLandmarks = [...rawMarkup.matchAll(/<main\b[^>]*>/gi)];
  assert(headings.length === 1 && Boolean(visibleText(headings[0]?.[1] ?? '')), `${url}: expected one non-empty static h1`);
  assert(mainLandmarks.length === 1, `${url}: expected one static main landmark, found ${mainLandmarks.length}`);
  if (pathname.startsWith('/demos/')) {
    const shell = rawMarkup.match(/<(aside|main)\b[^>]*data-demo-seo-shell[^>]*>([\s\S]*?)<\/\1>/i);
    const words = visibleText(shell?.[2] ?? '').split(/\s+/).filter(Boolean).length;
    assert(Boolean(shell), `${url}: missing static demo SEO shell`);
    assert(words >= 80, `${url}: static demo SEO shell has only ${words} words`);
    assert(/\bdata-owning-skill=["'][^"']+["']/i.test(shell?.[0] ?? ''), `${url}: demo shell lacks owning-skill identity`);
    assert(/\bdata-demo-mechanisms\b/i.test(shell?.[0] ?? ''), `${url}: demo shell lacks mechanism inventory`);
    assert(/Evidence status:/i.test(visibleText(shell?.[2] ?? '')), `${url}: demo shell lacks evidence status`);
  }
  if (pathname === '/' || pathname.startsWith('/skills/') || Boolean(decisionPage?.hero_image)) {
    const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
    const pictures = [...html.matchAll(/<picture\b[^>]*class=["'][^"']*\bresponsive-preview\b[^"']*["'][^>]*>([\s\S]*?)<\/picture>/gi)];
    assert(pictures.length === imageTags.length, `${url}: expected ${imageTags.length} responsive picture wrappers, found ${pictures.length}`);
    for (const [, body] of pictures) {
      const sources = [...body.matchAll(/<source\b[^>]*>/gi)].map((match) => match[0]);
      const fallback = body.match(/<img\b[^>]*>/i)?.[0];
      assert(sources.length === 2, `${url}: responsive picture does not contain two sources`);
      assert(tagAttribute(sources[0] ?? '', 'type') === 'image/avif', `${url}: AVIF is not the first responsive source`);
      assert(tagAttribute(sources[1] ?? '', 'type') === 'image/webp', `${url}: WebP is not the second responsive source`);
      assert(/\.png$/i.test(tagAttribute(fallback ?? '', 'src') ?? ''), `${url}: responsive fallback is not PNG`);
      for (const source of sources) {
        const srcset = tagAttribute(source, 'srcset');
        const type = tagAttribute(source, 'type');
        if (srcset && type) responsiveImageTypes.set(new URL(srcset, url).href, type);
      }
    }
  }
  const expectedType = decisionPage
    ? decisionSchemaType(decisionPage)
    : (pathname === '/'
      ? 'WebSite'
      : (pathname === '/about/' ? 'AboutPage' : (pathname.startsWith('/skills/') ? 'TechArticle' : 'WebApplication')));
  assert(schema.has(expectedType), `${url}: missing ${expectedType} structured data`);
  assert(schema.has('BreadcrumbList') || pathname === '/', `${url}: missing breadcrumb structured data`);
  if (decisionPage) {
    const pageNodeId = `${url}${expectedType === 'TechArticle' ? '#article' : '#webpage'}`;
    const pageNode = nodes.find((node) => node?.['@id'] === pageNodeId);
    const actualTypes = new Set(Array.isArray(pageNode?.['@type']) ? pageNode['@type'] : [pageNode?.['@type']].filter(Boolean));
    const requiredTypes = expectedType === 'TechArticle' ? ['Article', 'TechArticle'] : [expectedType];
    assert(Boolean(pageNode), `${url}: missing canonical decision-page structured-data node`);
    assert(actualTypes.size === requiredTypes.length && requiredTypes.every((type) => actualTypes.has(type)), `${url}: decision-page type is ${[...actualTypes].join(', ') || 'missing'}, expected ${requiredTypes.join(', ')}`);

    const expectedImage = decisionPage.hero_image ? new URL(decisionPage.hero_image, SITE).href : null;
    assert(socialImage === expectedImage, `${url}: social image does not match authored decision-page provenance`);
    if (expectedImage) assert(pageNode?.image === expectedImage, `${url}: structured-data image does not match the social image`);
    else assert(!Object.hasOwn(pageNode ?? {}, 'image'), `${url}: structured data publishes an image for an image-free decision page`);

    const sitemapImages = [...(sitemapEntries.get(url) ?? '').matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map((match) => match[1]);
    if (expectedImage) assert(sitemapImages.length === 1 && sitemapImages[0] === expectedImage, `${url}: sitemap image does not match authored decision-page provenance`);
    else assert(sitemapImages.length === 0, `${url}: sitemap publishes an image for an image-free decision page`);

    if (expectedType === 'TechArticle') {
      assert(hasType(pageNode, 'Article'), `${url}: TechArticle lacks dual Article typing`);
      assert(pageNode?.mainEntityOfPage === undefined, `${url}: decision article identifies itself as its containing page`);
      assert(pageNode?.author?.['@id'] === `${SITE.href}#publisher` && pageNode?.publisher?.['@id'] === `${SITE.href}#publisher`, `${url}: decision article author/publisher references are inconsistent`);
      const published = Date.parse(pageNode?.datePublished ?? '');
      const modified = Date.parse(pageNode?.dateModified ?? '');
      assert(Number.isFinite(published), `${url}: decision article has no valid datePublished`);
      assert(Number.isFinite(modified), `${url}: decision article has no valid dateModified`);
      assert(!Number.isFinite(published) || !Number.isFinite(modified) || published <= modified, `${url}: decision article publication date is later than modification date`);
      assert(metaValues(html, 'property', 'article:published_time')[0] === pageNode?.datePublished, `${url}: decision article publication timestamps disagree`);
      assert(metaValues(html, 'property', 'article:modified_time')[0] === pageNode?.dateModified, `${url}: decision article modification timestamps disagree`);
    }
  }
  const requiresPublisherAndDiscovery = Boolean(decisionPage)
    || pathname === '/' || pathname === '/about/' || pathname.startsWith('/skills/');
  if (requiresPublisherAndDiscovery) {
    const publisher = nodes.find((node) => hasType(node, 'Organization') && node['@id'] === `${SITE.href}#publisher`);
    assert(Boolean(publisher), `${url}: missing canonical publisher Organization`);
    assert(publisher?.logo?.['@type'] === 'ImageObject', `${url}: publisher logo is not an ImageObject`);
    assert(publisher?.logo?.url === PUBLISHER_LOGO && publisher?.logo?.contentUrl === PUBLISHER_LOGO, `${url}: publisher logo URL is not canonical`);
    assert(publisher?.logo?.width === 512 && publisher?.logo?.height === 512, `${url}: publisher logo dimensions are not 512x512`);
    assert(publisher?.url === SITE.href && publisher?.sameAs === 'https://github.com/linegel/threejs-complete-set-of-skill', `${url}: publisher identity is incomplete`);
    const llmsDiscovery = alternateValues(html, 'text/plain');
    const skillsDiscovery = alternateValues(html, 'application/json');
    assert(llmsDiscovery.length === 1 && llmsDiscovery[0] === new URL('llms.txt', SITE).href, `${url}: missing canonical llms.txt discovery link`);
    assert(skillsDiscovery.length === 1 && skillsDiscovery[0] === new URL('skills.json', SITE).href, `${url}: missing canonical skills.json discovery link`);
  }
  if (pathname.startsWith('/skills/')) {
    const article = nodes.find((node) => hasType(node, 'Article'));
    const publisher = nodes.find((node) => hasType(node, 'Organization') && node['@id'] === `${SITE.href}#publisher`);
    assert(article && hasType(article, 'TechArticle'), `${url}: article lacks dual Article/TechArticle typing`);
    assert(publisher?.url === SITE.href && publisher?.sameAs === 'https://github.com/linegel/threejs-complete-set-of-skill', `${url}: incomplete publisher identity`);
    const slug = pathname.match(/^\/skills\/([^/]+)\.html$/)?.[1];
    const expectedImages = ARTICLE_IMAGE_RATIOS.map((ratio) => new URL(`seo/article/${slug}-${ratio}.png`, SITE).href);
    assert(Array.isArray(article?.image) && article.image.length === expectedImages.length, `${url}: Article image does not contain three ratios`);
    for (const [index, imageUrl] of expectedImages.entries()) {
      assert(article?.image?.[index] === imageUrl, `${url}: Article ${ARTICLE_IMAGE_RATIOS[index]} image URL is not canonical`);
      structuredImageUrls.add(imageUrl);
    }
    assert(sitemap.includes(`<image:loc>${expectedImages[2]}</image:loc>`), `${url}: sitemap is missing the 16:9 Article image`);
    const published = Date.parse(article?.datePublished ?? '');
    const modified = Date.parse(article?.dateModified ?? '');
    assert(Number.isFinite(published), `${url}: missing or invalid datePublished`);
    assert(Number.isFinite(modified), `${url}: missing or invalid dateModified`);
    assert(!Number.isFinite(published) || !Number.isFinite(modified) || published <= modified, `${url}: publication date is later than modification date`);
    assert(metaValues(html, 'property', 'article:published_time')[0] === article?.datePublished, `${url}: publication timestamps disagree`);
    assert(metaValues(html, 'property', 'article:modified_time')[0] === article?.dateModified, `${url}: modification timestamps disagree`);
  }
  pageRecords.push({ url, title, description: description[0], links: internalLinks(html, url) });
});

await mapConcurrent([...structuredImageUrls], async (url) => {
  const response = await request(url, { method: 'HEAD', redirect: 'manual' });
  assert(response.status === 200, `${url}: structured image returned ${response.status}`);
  assert(response.headers.get('content-type')?.startsWith('image/png'), `${url}: structured image is not served as PNG`);
});
await mapConcurrent([...responsiveImageTypes], async ([url, expectedType]) => {
  const response = await request(url, { method: 'HEAD', redirect: 'manual' });
  assert(response.status === 200, `${url}: responsive image returned ${response.status}`);
  assert(response.headers.get('content-type')?.startsWith(expectedType), `${url}: responsive image is not served as ${expectedType}`);
});

for (const [key, label] of [['title', 'title'], ['description', 'meta description']]) {
  for (const owners of duplicateValues(pageRecords, key)) {
    errors.push(`duplicate ${label}: ${owners.join(', ')}`);
  }
}

const inboundLinks = new Map(urls.map((url) => [url, 0]));
for (const record of pageRecords) {
  for (const target of new Set(record.links)) {
    if (!sitemapSet.has(target) || target === record.url) continue;
    inboundLinks.set(target, inboundLinks.get(target) + 1);
  }
}
for (const [url, count] of inboundLinks) {
  if (url !== SITE.href) assert(count > 0, `${url}: orphaned sitemap URL`);
}

const indexDuplicate = await request(new URL('index.html', SITE), { redirect: 'manual' });
assert(indexDuplicate.status === 200, `index.html: expected 200, received ${indexDuplicate.status}`);
if (indexDuplicate.status === 200) {
  assert(canonicals(await indexDuplicate.text())[0] === SITE.href, 'index.html: does not canonicalize to the root URL');
}

const missingUrl = new URL(`seo-audit-missing-${Date.now()}`, SITE);
const missing = await request(missingUrl);
assert(missing.status === 404, `404 probe: expected 404, received ${missing.status}`);
assert(metaValues(await missing.text(), 'name', 'robots')[0]?.includes('noindex'), '404 probe: missing noindex');

if (errors.length) {
  console.error(`Live SEO audit failed (${errors.length} errors):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Live SEO audit passed: ${urls.length} sitemap pages, ${NOINDEX_DEMOS.length} noindex demo placeholders, ${structuredImageUrls.size} structured images, ${responsiveImageTypes.size} modern preview variants, 3 permanent redirects, 2 LLM endpoints, and 1 crawl-safe 404.`);
}
