#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  articleDependencyHash,
  manifestOwnedOutputPaths,
  ownerIdForSiteImageUrl,
  ownerIdForResponsiveSource,
  responsiveDependencyHash,
  sha256,
} from './lib/generated-asset-ledger.mjs';
import { authoritativeSkillDirs, buildDemoRegistry } from './lib/lab-registry.mjs';
import { loadSiteContent } from './lib/site-content.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const SITE = 'https://threejs-skills.com/';
const OLD_SITE = 'https://linegel.github.io/threejs-complete-set-of-skill/';
const PUBLISHER_LOGO = `${SITE}icon-512.png`;
const PRIMARY_NAV = [
  ['Examples', '/#flagships'],
  ['Skills', '/#skills'],
  ['Guides', '/guides/'],
  ['Evidence', '/evidence/'],
  ['Install', '/#install'],
  ['GitHub', 'https://github.com/linegel/threejs-complete-set-of-skill'],
];
const DEMO_REGISTRY = buildDemoRegistry();
const skillIds = new Set(authoritativeSkillDirs());
if (skillIds.size !== 27) throw new Error(`site SEO requires exactly 27 installable skills; received ${skillIds.size}`);
const SITE_CONTENT = loadSiteContent({
  repoRoot: ROOT,
  skillIds,
  demos: DEMO_REGISTRY.demos.filter((demo) => skillIds.has(demo.skill)),
  threeRevision: DEMO_REGISTRY.threeRevision,
  today: '2026-07-16',
});
const contentPages = SITE_CONTENT.pages;
const contentByUrl = new Map(contentPages.map((page) => [new URL(page.slug, SITE).href, page]));
const ARTICLE_IMAGE_SPECS = [
  { id: '1x1', width: 1200, height: 1200 },
  { id: '4x3', width: 1200, height: 900 },
  { id: '16x9', width: 1200, height: 675 },
];
const errors = [];
const responsiveSourcesSeen = new Set();
let responsiveManifest = { sources: {} };
let articleManifest = { skills: {} };
try {
  responsiveManifest = JSON.parse(readFileSync(join(DOCS, 'seo', 'responsive-images.json'), 'utf8'));
} catch (error) {
  errors.push(`responsive image manifest is missing or invalid (${error.message})`);
}
try {
  articleManifest = JSON.parse(readFileSync(join(DOCS, 'seo', 'article', 'manifest.json'), 'utf8'));
} catch (error) {
  errors.push(`Article image manifest is missing or invalid (${error.message})`);
}

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

function pngDimensions(path) {
  if (!path || !existsSync(path)) return null;
  const data = readFileSync(path);
  if (data.length < 24 || data.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
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

function decodedVisibleText(html) {
  return staticMarkup(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function visibleFaqEntries(html) {
  const article = staticMarkup(html).match(/<article\b[^>]*class=["'][^"']*\bcontent-body\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? '';
  return matches(article, /<h3\b[^>]*>\s*<a\b[^>]*href=["'](\/faq\/[^"']+\/)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h3>\s*<p>([\s\S]*?)<\/p>/gi)
    .map(([, route, question, answer]) => ({ route, question: decodedVisibleText(question), answer: decodedVisibleText(answer) }));
}

function validatePrimaryNavigation(html, label) {
  const navs = matches(html, /<nav\b([^>]*)>([\s\S]*?)<\/nav>/gi)
    .filter(([, attributes]) => attribute(`<nav ${attributes}>`, 'aria-label') === 'Primary navigation');
  assert(navs.length === 1, `${label}: expected one Primary navigation landmark, found ${navs.length}`);
  if (navs.length !== 1) return;
  const anchors = matches(navs[0][2], /<a\b[^>]*href=["'][^"']+["'][^>]*>([\s\S]*?)<\/a>/gi);
  assert(anchors.length === PRIMARY_NAV.length, `${label}: Primary navigation must contain exactly ${PRIMARY_NAV.length} links`);
  for (const [index, [expectedLabel, expectedHref]] of PRIMARY_NAV.entries()) {
    const anchor = anchors[index];
    assert(visibleText(anchor?.[1] ?? '') === expectedLabel, `${label}: primary link ${index + 1} must be labeled ${expectedLabel}`);
    assert(attribute(anchor?.[0] ?? '', 'href') === expectedHref, `${label}: ${expectedLabel} must link to ${expectedHref}`);
  }
  assert(!/class=["'][^"']*\bbrand\b/i.test(navs[0][0]), `${label}: brand must remain outside the Primary navigation landmark`);
}

function contentSchemaType(page) {
  if (page.slug === '/faq/') return 'FAQPage';
  if (page.kind === 'hub') return 'CollectionPage';
  if (['ecosystem-comparison', 'technical-comparison', 'alternatives', 'user-doc', 'agent-doc', 'migration', 'faq-answer'].includes(page.kind)) return 'TechArticle';
  return 'WebPage';
}

const escapedHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function validateIndexablePage(path, expectedUrl, {
  requireH1 = false,
  requireMain = false,
  validateImages = false,
  requireDiscovery = false,
  requireArticle = false,
  requireCatalog = false,
  requireDemoShell = false,
  requireAbout = false,
  requireResponsivePreviews = false,
  requirePrimaryNav = false,
  contentPage = null,
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
  const socialImages = headValue(html, 'property', 'og:image');
  assert(socialImages.length <= 1, `${label}: duplicate og:image`);
  assert(
    headValue(html, 'name', 'twitter:card')[0] === (socialImages.length === 1 ? 'summary_large_image' : 'summary'),
    `${label}: twitter card does not match provenance-bound image availability`,
  );
  if (socialImages.length === 1) {
    const imageUrl = socialImages[0];
    const imagePath = localPathForUrl(imageUrl);
    const dimensions = pngDimensions(imagePath);
    assert(Boolean(imagePath && dimensions), `${label}: social image is missing, external, or not PNG`);
    assert(headValue(html, 'property', 'og:image:type')[0] === 'image/png', `${label}: social image type is not image/png`);
    assert(Number(headValue(html, 'property', 'og:image:width')[0]) === dimensions?.width, `${label}: social image width metadata drift`);
    assert(Number(headValue(html, 'property', 'og:image:height')[0]) === dimensions?.height, `${label}: social image height metadata drift`);
    assert(Boolean(headValue(html, 'property', 'og:image:alt')[0]?.trim()), `${label}: social image lacks alt text`);
    assert(headValue(html, 'name', 'twitter:image')[0] === imageUrl, `${label}: Twitter image differs from Open Graph image`);
    assert(headValue(html, 'name', 'twitter:image:alt')[0] === headValue(html, 'property', 'og:image:alt')[0], `${label}: Twitter image alt differs from Open Graph alt`);
  }
  assert(!html.includes(OLD_SITE), `${label}: contains the retired GitHub Pages origin`);
  const structuredData = validateJsonLd(html, label);
  const nodes = graphNodes(structuredData);
  const publisher = nodes.find((node) => hasType(node, 'Organization') && node['@id'] === `${SITE}#publisher`);

  if (requireCatalog || requireArticle || requireAbout || contentPage) {
    assert(Boolean(publisher), `${label}: missing canonical publisher Organization`);
    assert(publisher?.logo?.['@type'] === 'ImageObject', `${label}: publisher logo is not an ImageObject`);
    assert(publisher?.logo?.url === PUBLISHER_LOGO && publisher?.logo?.contentUrl === PUBLISHER_LOGO, `${label}: publisher logo URL is not canonical`);
    assert(publisher?.logo?.width === 512 && publisher?.logo?.height === 512, `${label}: publisher logo dimensions are not declared as 512x512`);
    const logoDimensions = pngDimensions(localPathForUrl(PUBLISHER_LOGO));
    assert(logoDimensions?.width === 512 && logoDimensions?.height === 512, `${label}: publisher logo file is not a 512x512 PNG`);
  }

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
    assert(publisher?.url === SITE && publisher?.sameAs === 'https://github.com/linegel/threejs-complete-set-of-skill', `${label}: publisher identity is incomplete`);
    assert(article?.author?.['@id'] === `${SITE}#publisher` && article?.publisher?.['@id'] === `${SITE}#publisher`, `${label}: article author/publisher references are inconsistent`);
    const slug = new URL(expectedUrl).pathname.match(/^\/skills\/([^/]+)\.html$/)?.[1];
    if (socialImages.length === 1) {
      const expectedImages = ARTICLE_IMAGE_SPECS.map(({ id }) => `${SITE}seo/article/${slug}-${id}.png`);
      assert(Array.isArray(article?.image) && article.image.length === ARTICLE_IMAGE_SPECS.length, `${label}: Article image must contain 1:1, 4:3, and 16:9 variants when same-lab evidence exists`);
      for (const [index, spec] of ARTICLE_IMAGE_SPECS.entries()) {
        const imageUrl = article?.image?.[index];
        assert(imageUrl === expectedImages[index], `${label}: Article ${spec.id} image URL is not canonical`);
        const dimensions = pngDimensions(imageUrl ? localPathForUrl(imageUrl) : null);
        assert(dimensions?.width === spec.width && dimensions?.height === spec.height, `${label}: Article ${spec.id} image is not ${spec.width}x${spec.height}`);
      }
    } else {
      assert(article?.image === undefined, `${label}: Article publishes image variants without a same-lab social source`);
    }
    const published = Date.parse(article?.datePublished ?? '');
    const modified = Date.parse(article?.dateModified ?? '');
    assert(Number.isFinite(published), `${label}: missing or invalid datePublished`);
    assert(Number.isFinite(modified), `${label}: missing or invalid dateModified`);
    assert(!Number.isFinite(published) || !Number.isFinite(modified) || published <= modified, `${label}: datePublished is later than dateModified`);
    assert(headValue(html, 'property', 'article:published_time')[0] === article?.datePublished, `${label}: Open Graph publication time differs from JSON-LD`);
    assert(headValue(html, 'property', 'article:modified_time')[0] === article?.dateModified, `${label}: Open Graph modification time differs from JSON-LD`);
  }
  if (requireAbout) {
    assert(nodes.some((node) => hasType(node, 'AboutPage')), `${label}: missing AboutPage structured-data node`);
    assert(nodes.some((node) => hasType(node, 'Organization') && node['@id'] === `${SITE}#publisher`), `${label}: missing publisher identity`);
    assert(nodes.some((node) => hasType(node, 'BreadcrumbList')), `${label}: missing breadcrumb structured data`);
  }
  if (contentPage) {
    const expectedType = contentSchemaType(contentPage);
    const expectedNodeId = `${expectedUrl}${expectedType === 'TechArticle' ? '#article' : '#webpage'}`;
    const pageNode = nodes.find((node) => node?.['@id'] === expectedNodeId && hasType(node, expectedType));
    assert(Boolean(pageNode), `${label}: missing ${expectedType} structured-data node`);
    if (expectedType === 'TechArticle') {
      assert(hasType(pageNode, 'Article'), `${label}: TechArticle must also be typed Article`);
      assert(pageNode?.mainEntityOfPage === undefined, `${label}: TechArticle must not identify itself as its containing page`);
    }
    assert(pageNode?.name === contentPage.title, `${label}: schema name differs from source title`);
    assert(pageNode?.headline === contentPage.h1, `${label}: schema headline differs from source h1`);
    assert(pageNode?.description === contentPage.description, `${label}: schema description differs from source description`);
    assert(pageNode?.datePublished === contentPage.published, `${label}: schema datePublished differs from source`);
    assert(pageNode?.dateModified === contentPage.last_reviewed, `${label}: schema dateModified differs from source`);
    assert(pageNode?.publisher?.['@id'] === `${SITE}#publisher`, `${label}: schema publisher reference is not canonical`);
    const breadcrumb = nodes.find((node) => hasType(node, 'BreadcrumbList') && node?.['@id'] === `${expectedUrl}#breadcrumb`);
    const breadcrumbItems = breadcrumb?.itemListElement ?? [];
    assert(breadcrumbItems.length >= 2, `${label}: content breadcrumb is incomplete`);
    for (const [index, item] of breadcrumbItems.entries()) assert(item.position === index + 1, `${label}: breadcrumb positions are not contiguous`);
    assert(breadcrumbItems.at(-1)?.name === contentPage.h1 && breadcrumbItems.at(-1)?.item === expectedUrl, `${label}: breadcrumb does not terminate at the current source page`);
    const h1 = staticMarkup(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    assert(h1 === escapedHtml(contentPage.h1), `${label}: visible h1 differs from source`);
    const answer = staticMarkup(html).match(/<p\b[^>]*class=["'][^"']*\bcontent-answer\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
    assert(answer === escapedHtml(contentPage.summary), `${label}: visible direct answer differs from source summary`);
    const relatedRoutes = matches(html, /<a\b[^>]*data-related-route=["'][^"']+["'][^>]*>/gi).map(([tag]) => attribute(tag, 'data-related-route'));
    assert(JSON.stringify(relatedRoutes) === JSON.stringify(contentPage.related_pages), `${label}: rendered related routes differ from source order`);
    assert(/<nav\b[^>]*aria-label=["']On this page["']/i.test(html), `${label}: missing static on-page index`);
    assert(/<nav\b[^>]*aria-label=["']Machine-readable discovery["']/i.test(html), `${label}: missing visible machine discovery links`);
    const expectedImage = contentPage.hero_image ? new URL(contentPage.hero_image, SITE).href : undefined;
    assert(pageNode?.image === expectedImage, `${label}: schema image differs from provenance-bound source image`);
    if (contentPage.hero_image) {
      const source = matches(html, /<img\b[^>]*>/gi).map(([tag]) => attribute(tag, 'src')).find((src) => src === contentPage.hero_image);
      assert(Boolean(source), `${label}: declared proof image is not visible`);
      assert(socialImages[0] === expectedImage, `${label}: social image differs from declared proof image`);
      assert(html.includes(`/evidence/${contentPage.hero_source}/`), `${label}: proof image lacks its evidence report link`);
    } else assert(socialImages.length === 0, `${label}: page without declared proof publishes a social image`);
    if (expectedType === 'TechArticle') {
      assert(headValue(html, 'property', 'article:published_time')[0] === contentPage.published, `${label}: article publication metadata differs from source`);
      assert(headValue(html, 'property', 'article:modified_time')[0] === contentPage.last_reviewed, `${label}: article modification metadata differs from source`);
    }
    if (contentPage.kind === 'faq-answer') {
      const question = pageNode?.mainEntity;
      assert(question?.['@type'] === 'Question' && question?.name === contentPage.faq.question, `${label}: FAQ Question differs from visible/source question`);
      assert(question?.acceptedAnswer?.['@type'] === 'Answer' && question?.acceptedAnswer?.text === contentPage.faq.answer, `${label}: FAQ acceptedAnswer differs from visible/source answer`);
      assert(/<p\b[^>]*\bdata-faq-answer\b/i.test(html), `${label}: FAQ direct answer lacks its visible parity marker`);
      for (const source of contentPage.question_sources) {
        assert(source.startsWith('https://') ? html.includes(`href="${source}"`) : html.includes(escapedHtml(source)), `${label}: FAQ question provenance is not visible: ${source}`);
      }
    }
    if (contentPage.slug === '/faq/') {
      const questions = pageNode?.mainEntity ?? [];
      const faqPages = new Map(contentPages.filter((page) => page.kind === 'faq-answer').map((page) => [page.slug, page]));
      const visibleEntries = visibleFaqEntries(html);
      assert(visibleEntries.length === faqPages.size, `${label}: visible FAQ count differs from source leaves`);
      assert(new Set(visibleEntries.map((entry) => entry.route)).size === visibleEntries.length, `${label}: visible FAQ routes are duplicated`);
      assert(questions.length === visibleEntries.length, `${label}: FAQPage schema count differs from visible questions`);
      for (const [index, entry] of visibleEntries.entries()) {
        const child = faqPages.get(entry.route);
        assert(Boolean(child), `${label}: visible FAQ route has no authored answer: ${entry.route}`);
        assert(entry.question === child?.faq.question, `${label}: visible FAQ question ${index + 1} differs from its source leaf`);
        assert(entry.answer === child?.faq.answer, `${label}: visible FAQ answer ${index + 1} differs from its source leaf`);
        assert(questions[index]?.name === entry.question, `${label}: FAQPage question ${index + 1} differs from visible text`);
        assert(questions[index]?.url === new URL(entry.route, SITE).href, `${label}: FAQPage question ${index + 1} URL differs from visible route`);
        assert(questions[index]?.acceptedAnswer?.text === entry.answer, `${label}: FAQPage answer ${index + 1} differs from visible text`);
      }
    }
  }
  if (requirePrimaryNav) validatePrimaryNavigation(html, label);

  if (requireH1) {
    const headings = matches(staticMarkup(html), /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi);
    assert(headings.length === 1, `${label}: expected one static h1, found ${headings.length}`);
    assert(Boolean(visibleText(headings[0]?.[1] ?? '')), `${label}: static h1 has no text`);
  }
  if (requireMain) {
    const main = matches(staticMarkup(html), /<main\b[^>]*>/gi).length;
    assert(main === 1, `${label}: expected one static main landmark, found ${main}`);
  }
  if (requireDemoShell) {
    const shell = staticMarkup(html).match(/<(aside|main)\b[^>]*data-demo-seo-shell[^>]*>([\s\S]*?)<\/\1>/i);
    assert(Boolean(shell), `${label}: missing static demo SEO shell`);
    const shellWords = visibleText(shell?.[2] ?? '').split(/\s+/).filter(Boolean).length;
    assert(shellWords >= 80, `${label}: demo SEO shell is not substantial (${shellWords} words)`);
    assert(/\bdata-owning-skill=["'][^"']+["']/i.test(shell?.[0] ?? ''), `${label}: demo SEO shell lacks owning-skill identity`);
    assert(/\bdata-demo-mechanisms\b/i.test(shell?.[0] ?? ''), `${label}: demo SEO shell lacks supported mechanisms`);
    assert(/Evidence status:/i.test(visibleText(shell?.[2] ?? '')), `${label}: demo SEO shell lacks evidence status`);
    const roadmap = shell?.[0]?.match(/<details\b[^>]*data-demo-roadmap[^>]*>[\s\S]*?<\/details>/i);
    assert(Boolean(roadmap), `${label}: demo SEO shell lacks readiness and remaining fixes`);
    assert(/Readiness\s*&amp;\s*remaining fixes/i.test(roadmap?.[0] ?? ''), `${label}: demo roadmap lacks its user-facing label`);
    assert(/\bdata-roadmap-status=["'][^"']+["']/i.test(roadmap?.[0] ?? ''), `${label}: demo roadmap lacks status provenance`);
    const openCount = Number(attribute(roadmap?.[0] ?? '', 'data-open-count'));
    assert(Number.isInteger(openCount) && openCount >= 0, `${label}: demo roadmap has an invalid open-item count`);
    assert(/\bdata-roadmap-item\b/i.test(roadmap?.[0] ?? ''), `${label}: demo roadmap has no rendered closure item`);
    if (!/data-roadmap-status=["']accepted["']/i.test(roadmap?.[0] ?? '')) {
      assert(openCount > 0, `${label}: non-accepted demo roadmap reports no open items`);
    }
    assert(/<nav\b[^>]*aria-label=["']Demo documentation and provenance["']/i.test(shell?.[0] ?? ''), `${label}: demo SEO shell lacks provenance navigation`);
  }
  if (validateImages) {
    const imageTags = matches(html, /<img\b[^>]*>/gi).map(([tag]) => tag);
    for (const tag of imageTags) {
      assert(attribute(tag, 'alt') !== null, `${label}: image lacks alt text (${tag.slice(0, 100)})`);
      assert(/^\d+$/.test(attribute(tag, 'width') ?? ''), `${label}: image lacks intrinsic width (${attribute(tag, 'src')})`);
      assert(/^\d+$/.test(attribute(tag, 'height') ?? ''), `${label}: image lacks intrinsic height (${attribute(tag, 'src')})`);
    }
    if (requireResponsivePreviews) {
      const pictures = matches(html, /<picture\b[^>]*class=["'][^"']*\bresponsive-preview\b[^"']*["'][^>]*>([\s\S]*?)<\/picture>/gi);
      assert(pictures.length === imageTags.length, `${label}: expected ${imageTags.length} responsive picture wrappers, found ${pictures.length}`);
      for (const [, body] of pictures) {
        const sources = matches(body, /<source\b[^>]*>/gi).map(([tag]) => tag);
        const image = body.match(/<img\b[^>]*>/i)?.[0];
        assert(sources.length === 2, `${label}: responsive picture must contain exactly AVIF and WebP sources`);
        assert(attribute(sources[0] ?? '', 'type') === 'image/avif', `${label}: AVIF must be the first responsive source`);
        assert(attribute(sources[1] ?? '', 'type') === 'image/webp', `${label}: WebP must be the second responsive source`);
        assert(Boolean(image && /\bdata-responsive-preview(?:\s|=)/i.test(image)), `${label}: responsive PNG fallback lacks data-responsive-preview`);
        const fallback = attribute(image ?? '', 'src');
        const avif = attribute(sources[0] ?? '', 'srcset');
        const webp = attribute(sources[1] ?? '', 'srcset');
        assert(Boolean(fallback && /\.png$/i.test(fallback)), `${label}: responsive fallback is not PNG`);
        assert(avif === fallback?.replace(/\.png$/i, '.avif'), `${label}: AVIF source does not match PNG fallback ${fallback}`);
        assert(webp === fallback?.replace(/\.png$/i, '.webp'), `${label}: WebP source does not match PNG fallback ${fallback}`);
        if (!fallback) continue;
        const fallbackPath = localPathForUrl(new URL(fallback, expectedUrl).href);
        const key = fallbackPath ? relative(DOCS, fallbackPath).split('\\').join('/') : null;
        const record = key ? responsiveManifest.sources?.[key] : null;
        responsiveSourcesSeen.add(key);
        assert(Boolean(record), `${label}: ${fallback} is missing from the responsive image manifest`);
        if (!record || !fallbackPath) continue;
        const fallbackDimensions = pngDimensions(fallbackPath);
        assert(record.width === fallbackDimensions?.width && record.height === fallbackDimensions?.height, `${label}: manifest dimensions drift for ${fallback}`);
        assert(record.bytes === statSync(fallbackPath).size, `${label}: manifest PNG byte size drift for ${fallback}`);
        for (const [format, relativeUrl] of [['avif', avif], ['webp', webp]]) {
          const formatUrl = relativeUrl ? new URL(relativeUrl, expectedUrl).href : null;
          const formatPath = formatUrl ? localPathForUrl(formatUrl) : null;
          const formatRecord = record.formats?.[format];
          assert(Boolean(formatPath && existsSync(formatPath)), `${label}: ${format.toUpperCase()} file is missing for ${fallback}`);
          assert(formatRecord?.url === formatUrl, `${label}: manifest ${format.toUpperCase()} URL drift for ${fallback}`);
          assert(formatRecord?.width === record.width && formatRecord?.height === record.height, `${label}: ${format.toUpperCase()} dimensions drift for ${fallback}`);
          if (formatPath && existsSync(formatPath)) {
            assert(formatRecord?.bytes === statSync(formatPath).size, `${label}: manifest ${format.toUpperCase()} byte size drift for ${fallback}`);
            assert(statSync(formatPath).size < statSync(fallbackPath).size, `${label}: ${format.toUpperCase()} is not smaller than PNG for ${fallback}`);
          }
        }
      }
      if (/class=["'][^"']*\bskill-hero-bg\b/i.test(html)) {
        const preload = matches(html, /<link\b[^>]*>/gi).map(([tag]) => tag)
          .find((tag) => attribute(tag, 'rel') === 'preload' && attribute(tag, 'as') === 'image');
        assert(attribute(preload ?? '', 'type') === 'image/avif' && /\.avif$/i.test(attribute(preload ?? '', 'href') ?? ''), `${label}: skill hero preload is not AVIF`);
      }
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
const sitemapEntries = new Map(matches(sitemap, /<url>([\s\S]*?)<\/url>/g).map(([, body]) => [
  body.match(/<loc>([^<]+)<\/loc>/)?.[1],
  {
    lastmod: body.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1],
    images: matches(body, /<image:loc>([^<]+)<\/image:loc>/g).map((match) => match[1]),
  },
]));
const contentUrls = new Set(contentByUrl.keys());
const contentFamilies = new Set(contentPages.map((page) => page.slug.split('/').filter(Boolean)[0]));
for (const [url, page] of contentByUrl) {
  const entry = sitemapEntries.get(url);
  assert(Boolean(entry), `sitemap.xml: missing authored decision page ${url}`);
  assert(entry?.lastmod === page.last_reviewed, `sitemap.xml: ${url} lastmod differs from last_reviewed`);
  const expectedImages = page.hero_image ? [new URL(page.hero_image, SITE).href] : [];
  assert(JSON.stringify(entry?.images ?? []) === JSON.stringify(expectedImages), `sitemap.xml: ${url} proof image differs from source`);
  const output = localPathForUrl(url);
  assert(Boolean(output && existsSync(output)), `${page.sourceFile}: generated output is missing for ${url}`);
}
for (const url of pageUrls) {
  const family = new URL(url).pathname.split('/').filter(Boolean)[0];
  if (contentFamilies.has(family)) assert(contentUrls.has(url), `sitemap.xml: unknown decision-support URL ${url}`);
}

for (const url of pageUrls) {
  const path = localPathForUrl(url);
  assert(path && existsSync(path) && statSync(path).isFile(), `sitemap.xml: ${url} has no generated file`);
  if (!path || !existsSync(path)) continue;
  const isHome = url === SITE;
  const pathname = new URL(url).pathname;
  const isSkill = pathname.startsWith('/skills/');
  const isDemo = pathname.startsWith('/demos/');
  const isEvidence = pathname.startsWith('/evidence/');
  const isAbout = pathname === '/about/';
  const contentPage = contentByUrl.get(url) ?? null;
  const record = validateIndexablePage(path, url, {
    requireH1: true,
    requireMain: true,
    validateImages: true,
    requireDiscovery: isHome || isSkill || isAbout || Boolean(contentPage),
    requireArticle: isSkill,
    requireCatalog: isHome,
    requireDemoShell: isDemo,
    requireAbout: isAbout,
    requireResponsivePreviews: isHome || isSkill || isEvidence || Boolean(contentPage?.hero_image),
    requirePrimaryNav: !isDemo,
    contentPage,
  });
  pageRecords.push({ url, ...record });
}

const skillsWithArticleImages = new Set();
for (const url of pageUrls.filter((value) => new URL(value).pathname.startsWith('/skills/'))) {
  const slug = new URL(url).pathname.match(/^\/skills\/([^/]+)\.html$/)?.[1];
  const skillHtml = readFileSync(localPathForUrl(url), 'utf8');
  const hasSocialImage = headValue(skillHtml, 'property', 'og:image').length === 1;
  if (hasSocialImage) skillsWithArticleImages.add(slug);
  const sitemapImage = `<image:loc>${SITE}seo/article/${slug}-16x9.png</image:loc>`;
  assert(
    sitemap.includes(sitemapImage) === hasSocialImage,
    `sitemap.xml: ${slug} image entry does not match same-lab evidence availability`,
  );
}
assert(articleManifest.schemaVersion === 2, 'Article image manifest: schemaVersion must equal 2');
assert(articleManifest.generatedBy === 'scripts/generate-seo-images.mjs', 'Article image manifest: unexpected generator identity');
const articleManifestSkills = Object.keys(articleManifest.skills ?? {});
assert(articleManifestSkills.length === skillsWithArticleImages.size, `Article image manifest: ${articleManifestSkills.length} entries but ${skillsWithArticleImages.size} skills publish images`);
const registeredArticleOutputs = new Set();
for (const slug of articleManifestSkills) {
  const record = articleManifest.skills[slug];
  const skillPath = join(DOCS, 'skills', `${slug}.html`);
  const skillHtml = existsSync(skillPath) ? readFileSync(skillPath, 'utf8') : '';
  const sourceUrl = headValue(skillHtml, 'property', 'og:image')[0];
  assert(skillsWithArticleImages.has(slug), `Article image manifest: stale skill ${slug}`);
  assert(record.source === sourceUrl, `Article image manifest: social source drift for ${slug}`);
  if (sourceUrl) {
    const sourcePath = localPathForUrl(sourceUrl);
    assert(record.ownerId === ownerIdForSiteImageUrl(sourceUrl, SITE), `Article image manifest: owner drift for ${slug}`);
    if (sourcePath && existsSync(sourcePath)) {
      assert(record.sourceSha256 === sha256(readFileSync(sourcePath)), `Article image manifest: source hash drift for ${slug}`);
    }
  }
  assert(record.dependencyClosureHash === articleDependencyHash(slug, record), `Article image manifest: dependency closure drift for ${slug}`);
  assert(Object.keys(record.images ?? {}).length === ARTICLE_IMAGE_SPECS.length, `Article image manifest: ${slug} does not have all ratio crops`);
  for (const spec of ARTICLE_IMAGE_SPECS) {
    const output = record.images?.[spec.id];
    const outputPath = output?.url ? localPathForUrl(output.url) : null;
    assert(Boolean(outputPath && existsSync(outputPath)), `Article image manifest: missing ${slug} ${spec.id} crop`);
    if (!outputPath || !existsSync(outputPath)) continue;
    registeredArticleOutputs.add(outputPath);
    const dimensions = pngDimensions(outputPath);
    assert(dimensions?.width === spec.width && dimensions?.height === spec.height, `Article image manifest: ${slug} ${spec.id} dimensions drift`);
    assert(output.bytes === statSync(outputPath).size, `Article image manifest: ${slug} ${spec.id} byte count drift`);
    assert(output.sha256 === sha256(readFileSync(outputPath)), `Article image manifest: ${slug} ${spec.id} hash drift`);
  }
}
const publishedArticleOutputs = new Set(walk(join(DOCS, 'seo', 'article'), (file) => file.endsWith('.png')));
assert(registeredArticleOutputs.size === publishedArticleOutputs.size, `Article image manifest: ${registeredArticleOutputs.size} registered crops but ${publishedArticleOutputs.size} are published`);
for (const output of publishedArticleOutputs) {
  assert(registeredArticleOutputs.has(output), `Article image manifest: unregistered crop ${relative(DOCS, output)}`);
}
const responsiveManifestSources = Object.keys(responsiveManifest.sources ?? {});
assert(responsiveManifest.schemaVersion === 2, 'responsive image manifest: schemaVersion must equal 2');
assert(responsiveManifest.generatedBy === 'scripts/generate-responsive-images.mjs', 'responsive image manifest: unexpected generator identity');
assert(responsiveManifestSources.length > 0, 'responsive image manifest: no source images');
assert(responsiveManifestSources.length === responsiveSourcesSeen.size, `responsive image manifest: ${responsiveManifestSources.length} entries but ${responsiveSourcesSeen.size} are referenced`);
for (const source of responsiveManifestSources) {
  assert(responsiveSourcesSeen.has(source), `responsive image manifest: stale source ${source}`);
  const record = responsiveManifest.sources[source];
  const sourcePath = join(DOCS, source);
  assert(record.ownerId === ownerIdForResponsiveSource(source), `responsive image manifest: owner drift for ${source}`);
  if (existsSync(sourcePath)) {
    assert(record.sourceSha256 === sha256(readFileSync(sourcePath)), `responsive image manifest: source hash drift for ${source}`);
  }
  assert(record.dependencyClosureHash === responsiveDependencyHash(source, record), `responsive image manifest: dependency closure drift for ${source}`);
  for (const [format, output] of Object.entries(record.formats ?? {})) {
    const outputPath = localPathForUrl(output.url);
    if (outputPath && existsSync(outputPath)) {
      assert(output.sha256 === sha256(readFileSync(outputPath)), `responsive image manifest: ${format} hash drift for ${source}`);
    }
  }
}
const registeredResponsiveOutputs = manifestOwnedOutputPaths(responsiveManifest, DOCS, SITE);
const publishedResponsiveOutputs = new Set(walk(DOCS, (file) => /\.(?:avif|webp)$/i.test(file)));
assert(registeredResponsiveOutputs.size === publishedResponsiveOutputs.size, `responsive image manifest: ${registeredResponsiveOutputs.size} registered outputs but ${publishedResponsiveOutputs.size} are published`);
for (const output of publishedResponsiveOutputs) {
  assert(registeredResponsiveOutputs.has(output), `responsive image manifest: unregistered output ${relative(DOCS, output)}`);
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
    continue;
  }
  if (/^demos\/[^/]+\/index\.html$/.test(relativePath)) {
    const pageUrl = `${SITE}${relativePath.replace(/index\.html$/, '')}`;
    if (sitemapSet.has(pageUrl)) continue;
    const robots = headValue(html, 'name', 'robots');
    const owningSkill = headValue(html, 'name', 'owning-skill')[0];
    const canonical = canonicalValues(html);
    assert(robots.length === 1 && /\bnoindex\b/i.test(robots[0]) && /\bfollow\b/i.test(robots[0]), `${relativePath}: demo excluded from sitemap must be noindex, follow`);
    assert(Boolean(owningSkill), `${relativePath}: noindex demo lacks owning-skill metadata`);
    assert(canonical.length === 1 && canonical[0] === `${SITE}skills/${owningSkill}.html`, `${relativePath}: noindex demo must canonicalize to its owning skill`);
    assert(!sitemapSet.has(pageUrl), `${relativePath}: noindex demo must not appear in sitemap`);
  }
}

for (const path of [...new Set(pageRecords.map((record) => localPathForUrl(record.url)).filter(Boolean))]) {
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
assert(readFileSync(join(DOCS, 'llms.txt'), 'utf8').includes(`${SITE}about/`), 'llms.txt: missing methodology URL');
const llmsText = readFileSync(join(DOCS, 'llms.txt'), 'utf8');
assert(readFileSync(join(DOCS, 'llm.txt'), 'utf8') === llmsText, 'llm.txt: alias differs from llms.txt');
const docsSkillsJson = readFileSync(join(DOCS, 'skills.json'), 'utf8');
assert(readFileSync(join(ROOT, 'skills.json'), 'utf8') === docsSkillsJson, 'skills.json: root and docs copies differ');
const skillManifest = JSON.parse(docsSkillsJson);
assert(skillManifest.methodology === `${SITE}about/`, 'skills.json: missing canonical methodology URL');
const expectedDecisionPages = contentPages.map((page) => ({
  url: new URL(page.slug, SITE).href,
  family: page.slug.split('/').filter(Boolean)[0],
  title: page.title,
  description: page.description,
  primaryQuery: page.primary_query,
  queryAliases: page.query_aliases,
  published: page.published,
  lastReviewed: page.last_reviewed,
  relatedSkills: page.related_skills,
}));
assert(skillManifest.decisionSupport?.schemaVersion === 1, 'skills.json: decisionSupport schemaVersion must equal 1');
assert(skillManifest.decisionSupport?.hub === `${SITE}guides/`, 'skills.json: decisionSupport hub is not canonical');
assert(skillManifest.decisionSupport?.count === contentPages.length, 'skills.json: decisionSupport count differs from source');
assert(JSON.stringify(skillManifest.decisionSupport?.pages) === JSON.stringify(expectedDecisionPages), 'skills.json: decisionSupport pages differ from authored source');
for (const page of contentPages) {
  const url = new URL(page.slug, SITE).href;
  assert(llmsText.includes(`](${url})`), `llms.txt: missing decision-support URL ${url}`);
}

if (errors.length) {
  console.error(`Site SEO validation failed (${errors.length} errors):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated SEO for ${pageUrls.length} indexable pages and ${walk(DOCS, (file) => file.endsWith('.html')).length} generated HTML files.`);
}
