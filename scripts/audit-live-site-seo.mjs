#!/usr/bin/env node

const SITE = new URL(process.env.SITE_URL ?? 'https://threejs-skills.com/');
const RETIRED_SITE = 'https://linegel.github.io/threejs-complete-set-of-skill/';
const CONCURRENCY = 8;
const errors = [];

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

function canonicals(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /\brel=["'][^"']*\bcanonical\b[^"']*["']/i.test(tag))
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
assert(urls.length > 0, 'sitemap.xml: no page URLs');
assert(new Set(urls).size === urls.length, 'sitemap.xml: duplicate page URLs');
assert(urls.every((url) => url.startsWith(SITE.href)), 'sitemap.xml: URL outside the canonical origin');
assert(!sitemap.includes(RETIRED_SITE), 'sitemap.xml: contains the retired origin');
assert(!urls.some((url) => /\/(?:scenario|mechanism|tier)\//.test(new URL(url).pathname)), 'sitemap.xml: contains state-only wrapper URLs');

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
  const schema = schemaTypes(jsonLd(html, url));

  assert(title && title.length >= 20 && title.length <= 65, `${url}: invalid title length ${title?.length ?? 0}`);
  assert(description.length === 1 && description[0].length >= 80 && description[0].length <= 165, `${url}: invalid meta description`);
  assert(robotsMeta.length === 1 && /\bindex\b/i.test(robotsMeta[0]) && !/\bnoindex\b/i.test(robotsMeta[0]), `${url}: not explicitly indexable`);
  assert(canonical.length === 1 && canonical[0] === url, `${url}: canonical mismatch (${canonical.join(', ') || 'missing'})`);
  assert(metaValues(html, 'property', 'og:url')[0] === url, `${url}: og:url mismatch`);
  assert(metaValues(html, 'name', 'twitter:card')[0] === 'summary_large_image', `${url}: missing large Twitter card`);
  assert(!html.includes(RETIRED_SITE), `${url}: contains the retired origin`);

  const pathname = new URL(url).pathname;
  const expectedType = pathname === '/' ? 'WebSite' : (pathname.startsWith('/skills/') ? 'TechArticle' : 'WebApplication');
  assert(schema.has(expectedType), `${url}: missing ${expectedType} structured data`);
  assert(schema.has('BreadcrumbList') || pathname === '/', `${url}: missing breadcrumb structured data`);
});

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
  console.log(`Live SEO audit passed: ${urls.length} sitemap pages, 3 permanent redirects, 2 LLM endpoints, and 1 crawl-safe 404.`);
}
