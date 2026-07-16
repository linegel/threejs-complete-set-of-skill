#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIMARY_DEMO_KINDS, authoritativeSkillDirs, buildDemoRegistry } from './lib/lab-registry.mjs';
import { remoteRuntimeAssetViolations } from './lib/site-runtime-assets.mjs';
import { validateEvidenceReportManifest } from './lib/evidence-report-validation.mjs';
import { loadSiteContent } from './lib/site-content.mjs';
import { PROVIDER_DEMOS } from './provider-demos.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const site = 'https://threejs-skills.com/';
const registry = buildDemoRegistry();
const homepage = readFileSync(join(docs, 'index.html'), 'utf8');
const sitemap = readFileSync(join(docs, 'sitemap.xml'), 'utf8');
const rootSkillsText = readFileSync(join(root, 'skills.json'), 'utf8');
const docsSkillsText = readFileSync(join(docs, 'skills.json'), 'utf8');
const previewManifest = JSON.parse(readFileSync(join(docs, 'previews', 'manifest.json'), 'utf8'));
const skillManifest = JSON.parse(rootSkillsText);
const evidencePreviewConfig = JSON.parse(readFileSync(join(root, 'labs', 'runtime-evidence-previews.json'), 'utf8'));
const evidenceReportManifest = JSON.parse(readFileSync(join(docs, 'evidence', 'manifest.json'), 'utf8'));
const errors = [];

const htmlFilesUnder = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return htmlFilesUnder(path);
  return entry.isFile() && entry.name.endsWith('.html') ? [path] : [];
});

const assert = (condition, message) => {
  if (!condition) errors.push(message);
};
const htmlText = (value) => String(value)
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim();
const primaryNavigation = (html) => {
  const matches = [...html.matchAll(/<nav\b[^>]*\baria-label=["']Primary navigation["'][^>]*>([\s\S]*?)<\/nav>/gi)];
  if (matches.length !== 1) return { count: matches.length, links: [] };
  const links = [...matches[0][1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
    href: match[1].match(/\bhref=["']([^"']+)["']/i)?.[1] ?? null,
    label: htmlText(match[2]),
  }));
  return { count: matches.length, links };
};
const relativePublishPath = (path) => path.replace(/^\/+/, '');
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const escapedHtmlText = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const metaContent = (html, key, value) => [...html.matchAll(/<meta\b[^>]*>/gi)]
  .map((match) => match[0])
  .filter((tag) => tag.match(new RegExp(`\\b${key}=["']([^"']+)["']`, 'i'))?.[1] === value)
  .map((tag) => tag.match(/\bcontent=["']([^"']+)["']/i)?.[1])
  .filter(Boolean);
const sameLabImageSourceId = (urlString) => {
  if (!urlString) return null;
  const pathname = new URL(urlString, site).pathname;
  return pathname.match(/^\/visual-validation\/([^/]+)\//)?.[1]
    ?? pathname.match(/^\/previews\/primary\/([^/.]+)\.png$/)?.[1]
    ?? null;
};

const authoritativeSkillSlugs = new Set(authoritativeSkillDirs());
const publishedSkillSlugs = new Set(skillManifest.skills.map((skill) => skill.name));
assert(authoritativeSkillSlugs.size === 27, `site requires exactly 27 installable skills; received ${authoritativeSkillSlugs.size}`);
assert(
  JSON.stringify([...publishedSkillSlugs].sort()) === JSON.stringify([...authoritativeSkillSlugs].sort()),
  'published skill manifest does not exactly match skills/<name>/ source',
);
const siteDemos = registry.demos.filter((demo) => authoritativeSkillSlugs.has(demo.skill));
const primary = siteDemos.filter((demo) => PRIMARY_DEMO_KINDS.includes(demo.kind));
const secondary = siteDemos.filter((demo) => !PRIMARY_DEMO_KINDS.includes(demo.kind));
const canonical = primary.filter((demo) => demo.kind === 'canonical-lab');
const accepted = primary.filter((demo) => demo.status === 'accepted');
const entrypointTargets = primary.filter((demo) => demo.publishPath && (
  demo.nonRenderingScenarioSuite || (demo.browserEntry && existsSync(join(root, demo.browserEntry)))
));
const flagships = registry.integrationIds.map((id) => registry.demos.find((demo) => demo.id === id)).filter(Boolean);
const flagshipIds = new Set(flagships.map((demo) => demo.id));
const support = primary.filter((demo) => demo.kind !== 'canonical-lab' && !flagshipIds.has(demo.id));
const routes = primary.flatMap((demo) => [
  demo.publishPath,
  ...demo.scenarios.map((route) => `${demo.publishPath}scenario/${route.id}/`),
  ...demo.mechanisms.map((route) => `${demo.publishPath}mechanism/${route.id}/`),
  ...demo.tiers.map((route) => `${demo.publishPath}tier/${route.id}/`),
]);
const uniqueRoutes = new Set(routes);
const acceptedFlagshipIds = new Set(flagships.filter((demo) => demo.status === 'accepted').map((demo) => demo.id));
const requiredLocalAssets = [
  'assets/vendor/katex/NOTICE.json',
  'assets/vendor/katex/LICENSE',
  'assets/vendor/katex/katex.min.css',
  'assets/vendor/katex/katex.min.js',
  'assets/vendor/katex/auto-render.min.js',
  'assets/vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2',
  'assets/vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2',
  'assets/vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2',
];
const evidenceReportUrl = (labId) => `${site}evidence/${labId}/`;
const expectedShowcaseIds = [
  'ocean-generated-wave-seeds',
  'planet-generated-craters',
  'fields-generated-biome-maps',
  'materials-generated-lava-causes',
  'water-generated-caustics',
  'cloud-generated-weather-maps',
  'frost-generated-crystals',
  'rain-generated-ripples',
  'space-generated-starfields',
  'vegetation-generated-meadow-density',
];
const expectedPrimaryNavigation = [
  { href: '/#flagships', label: 'Examples' },
  { href: '/#skills', label: 'Skills' },
  { href: '/guides/', label: 'Guides' },
  { href: '/evidence/', label: 'Evidence' },
  { href: '/#install', label: 'Install' },
  { href: skillManifest.repository, label: 'GitHub' },
];
const assertPrimaryNavigation = (html, label) => {
  const published = primaryNavigation(html);
  assert(published.count === 1, `${label} must contain exactly one primary navigation landmark; received ${published.count}`);
  assert(
    JSON.stringify(published.links) === JSON.stringify(expectedPrimaryNavigation),
    `${label} primary navigation labels, destinations, or order drifted`,
  );
};

let contentPages = [];
try {
  ({ pages: contentPages } = loadSiteContent({
    repoRoot: root,
    skillIds: authoritativeSkillSlugs,
    demos: siteDemos,
    threeRevision: registry.threeRevision,
    today: '2026-07-16',
  }));
} catch (error) {
  errors.push(`decision-support source: ${error.message}`);
}
assert(contentPages.length === 41, `Release 1 decision support must contain 41 source routes; received ${contentPages.length}`);

const assertContentPresentation = (page, html) => {
  const label = `decision-support route ${page.slug}`;
  const heroIndex = html.indexOf('<header class="content-hero"');
  const layoutIndex = html.indexOf('<div class="content-layout"');
  const bodyIndex = html.indexOf('<article class="content-body"');
  const indexIndex = html.indexOf('<nav class="content-index" aria-label="On this page"');
  assert(html.includes(`<body data-content-kind="${escapedHtmlText(page.kind)}" data-content-route="${escapedHtmlText(page.slug)}">`), `${label} omits its source-bound body contract`);
  assert(html.includes('<main id="main-content"'), `${label} has no main landmark`);
  assert(heroIndex >= 0, `${label} has no editorial content hero`);
  assert(layoutIndex > heroIndex, `${label} content layout does not follow its editorial hero`);
  assert(bodyIndex > layoutIndex, `${label} has no article body inside its content layout`);
  assert(indexIndex > bodyIndex, `${label} has no table of contents after its article body`);
  assert(html.includes(`<h1>${escapedHtmlText(page.h1)}</h1>`), `${label} does not publish its source H1`);
  const answerAttribute = page.kind === 'faq-answer' ? ' data-faq-answer' : '';
  assert(
    html.includes(`<p class="content-answer"${answerAttribute}>${escapedHtmlText(page.summary)}</p>`),
    `${label} does not publish its source-bound direct answer`,
  );
  const toc = html.match(/<nav class="content-index" aria-label="On this page">[\s\S]*?<ol>([\s\S]*?)<\/ol><\/nav>/i)?.[1] ?? '';
  const tocTargets = [...toc.matchAll(/<a\b[^>]*\bhref="#([^"']+)"/gi)].map((match) => match[1]);
  assert(tocTargets.length > 0, `${label} table of contents has no section links`);
  for (const id of tocTargets) assert(html.includes(`id="${id}"`), `${label} table of contents points to missing section #${id}`);
  assert(html.includes('<section class="content-sources"'), `${label} omits its source and correction contract`);
  if (page.hero_image) {
    assert(html.includes('<section class="content-proof"'), `${label} omits its declared proof section`);
    assert(html.includes(`src="${escapedHtmlText(page.hero_image)}"`), `${label} omits its declared proof image`);
    assert(html.includes(`Source lab: <code>${escapedHtmlText(page.hero_source)}</code>`), `${label} omits proof provenance`);
    assert(html.includes(`href="/evidence/${escapedHtmlText(page.hero_source)}/"`), `${label} does not link the proof evidence report`);
  } else {
    assert(!html.includes('<section class="content-proof"'), `${label} invents a proof section without a declared source image`);
  }
};

const contentSurfaces = [];
for (const page of contentPages) {
  const pagePath = join(docs, relativePublishPath(page.slug), 'index.html');
  assert(existsSync(pagePath), `generated decision-support route is missing: ${page.slug}`);
  if (!existsSync(pagePath)) continue;
  const html = readFileSync(pagePath, 'utf8');
  contentSurfaces.push({ label: `decision-support route ${page.slug}`, html });
  assertContentPresentation(page, html);
}

const representativeContent = [
  ['guides hub', (page) => page.slug === '/guides/' && page.hero_image],
  ['direct comparison', (page) => page.kind === 'ecosystem-comparison' && page.hero_image],
  ['migration guide', (page) => page.kind === 'migration' && page.hero_image],
  ['pricing page', (page) => page.kind === 'pricing'],
  ['industry page', (page) => page.kind === 'industry' && page.hero_image],
  ['FAQ answer', (page) => page.kind === 'faq-answer' && page.hero_image],
];
for (const [label, select] of representativeContent) {
  const page = contentPages.find(select);
  assert(Boolean(page), `decision-support source has no proof-backed representative ${label}`);
  if (!page) continue;
  const pagePath = join(docs, relativePublishPath(page.slug), 'index.html');
  if (!existsSync(pagePath)) continue;
  const html = readFileSync(pagePath, 'utf8');
  const proofContract = page.hero_image ? 'content-proof' : 'content-sources';
  for (const contract of ['content-hero', 'content-layout', 'content-body', 'content-index', 'content-answer', proofContract]) {
    assert(html.includes(`class="${contract}"`), `${page.slug} representative ${label} omits ${contract}`);
  }
}

const indexablePresentationSurfaces = [
  { label: 'homepage', path: join(docs, 'index.html'), html: homepage },
  { label: 'about page', path: join(docs, 'about', 'index.html') },
  ...skillManifest.skills.map((skill) => ({
    label: `skill page ${skill.name}`,
    path: join(docs, 'skills', `${skill.name}.html`),
  })),
  { label: 'evidence index', path: join(docs, 'evidence', 'index.html') },
  ...(evidenceReportManifest.reports ?? []).map((report) => ({
    label: `evidence report ${report.labId}`,
    path: join(docs, 'evidence', report.labId, 'index.html'),
  })),
];
for (const surface of indexablePresentationSurfaces) {
  assert(surface.html || existsSync(surface.path), `${surface.label} is missing`);
  if (!surface.html && !existsSync(surface.path)) continue;
  assertPrimaryNavigation(surface.html ?? readFileSync(surface.path, 'utf8'), surface.label);
}
for (const surface of contentSurfaces) assertPrimaryNavigation(surface.html, surface.label);

const choosePathHeading = homepage.indexOf('<h2 id="pathfinder-title">Choose your path.</h2>');
const flagshipSection = homepage.search(/<section\b[^>]*\bid=["']flagships["']/i);
assert(choosePathHeading >= 0, 'homepage is missing the exact Choose your path heading');
assert(flagshipSection >= 0, 'homepage is missing the #flagships section');
assert(choosePathHeading >= 0 && flagshipSection >= 0 && choosePathHeading < flagshipSection, 'homepage Choose your path section must precede #flagships');

for (const asset of requiredLocalAssets) {
  assert(existsSync(join(docs, asset)), `required local presentation asset is missing: ${asset}`);
}
for (const htmlPath of htmlFilesUnder(docs)) {
  const html = readFileSync(htmlPath, 'utf8');
  const relative = htmlPath.slice(docs.length + 1);
  errors.push(...remoteRuntimeAssetViolations(html, relative));
}

assert(registry.counts.skills === skillManifest.skills.length, 'derived skill count does not match the published skill manifest');
assert(primary.length === registry.counts.primary, 'primary demo count does not match registry counts');
assert(entrypointTargets.length === primary.length, `${primary.length - entrypointTargets.length} primary target(s) lack declared entrypoints`);
assert(flagships.every((demo) => demo.kind === 'integration-demo'), 'featured integrations must be integration demos');
assert(!routes.some((route) => typeof route !== 'string' || !route.startsWith('/demos/')), 'primary route contract contains an invalid publish path');

assert(rootSkillsText === docsSkillsText, 'skills.json and docs/skills.json differ');
assert(skillManifest.coverageSummary, 'skills.json has no coverageSummary');
const summary = skillManifest.coverageSummary ?? {};
assert(summary.threeRevision === registry.threeRevision, 'coverageSummary Three.js revision drift');
assert(summary.buildRevision === registry.buildRevision, 'coverageSummary build revision drift');
assert(summary.skills === registry.counts.skills, 'coverageSummary skill count drift');
assert(summary.primaryImplementations === primary.length, 'coverageSummary primary count drift');
assert(summary.declaredEntrypointPrimaryTargets === entrypointTargets.length, 'coverageSummary declared entrypoint count drift');
assert(summary.canonicalLabs === canonical.length, 'coverageSummary canonical count drift');
assert(summary.crossSkillFlagships === flagships.length, 'coverageSummary flagship count drift');
assert(summary.focusedSupportPrimaries === support.length, 'coverageSummary support count drift');
assert(summary.acceptedPrimary === accepted.length, 'coverageSummary accepted count drift');
assert(summary.pendingPrimary === primary.length - accepted.length, 'coverageSummary pending count drift');
assert(summary.secondaryRecords === secondary.length, 'coverageSummary secondary count drift');
assert(summary.routes?.declaredContracts === routes.length, 'coverageSummary declared route count drift');
assert(summary.routes?.uniquePublishedPaths === uniqueRoutes.size, 'coverageSummary unique route count drift');

for (const route of uniqueRoutes) {
  const indexPath = join(docs, relativePublishPath(route), 'index.html');
  assert(existsSync(indexPath), `generated primary route is missing: ${route}`);
}

for (const phrase of [
  `${primary.length} primary targets`,
  `${canonical.length} canonical targets`,
  `${flagships.length} cross-skill flagships`,
  'Build ambitious <em>Three.js scenes.</em>',
  'Find the right skill',
  'From scene goal to implementation',
]) {
  assert(homepage.includes(phrase), `homepage is missing product-first copy: ${phrase}`);
}
assert(homepage.includes(`<dd>r${registry.threeRevision.replace(/^0\./, '')}</dd><dt>Three.js target</dt>`), 'homepage Three.js target metric drift');
assert(!homepage.includes('href="demos/registry.json"'), 'homepage exposes the machine registry as a visitor CTA');
assert(!homepage.includes('Open registry JSON'), 'homepage invites visitors to read raw registry JSON');

assert(!/>\s*Live WebGPU\s*</i.test(homepage), 'secondary visual still claims Live WebGPU');
assert(!homepage.includes('class="live-visual'), 'homepage still uses CSS title slates instead of real preview media');
assert(!homepage.includes('class="preview-missing'), 'homepage contains a missing-preview panel');
assert(!homepage.includes('class="preview-badge'), 'homepage overlays classification badges on evidence media');
assert(!homepage.includes('class="card-index'), 'homepage presents decorative card numbers as evidence');
assert(!homepage.includes('class="rail-track'), 'homepage presents acceptance as a decorative progress track');
assert(!homepage.includes('class="rail-fill'), 'homepage presents acceptance as a decorative progress fill');
assert(!homepage.includes('.hero:before'), 'homepage uses a decorative hero pseudo-element');
assert(!homepage.includes('.hero-showcase:before'), 'homepage uses a decorative showcase pseudo-element');
assert(!homepage.includes('demos/shared/generated-variants/caustic-field-a.png'), 'homepage uses unrelated generated caustics as hero media');
assert(!/\bworking implementations\b/i.test(homepage), 'homepage inflates primary targets into working implementations');
assert(!/\ball \d+ primary targets are loadable\b/i.test(homepage), 'homepage claims all primary targets are loadable without runtime proof');
assert(homepage.includes(`data-product-skill-count="${authoritativeSkillSlugs.size}"`), 'homepage product skill count drift');
assert(homepage.includes('data-product-source="skills/{name}/"'), 'homepage does not identify the installable skill source');
assert(homepage.includes('href="skills/threejs-choose-skills.html"'), 'homepage product entry points omit Choose Skills');
assert(homepage.includes('href="docs/install/"'), 'homepage product entry points omit installation');
assert(homepage.includes('href="evidence/"'), 'homepage product entry points omit evidence');
assert((homepage.match(/data-preview-for=/g) ?? []).length >= primary.length, 'homepage does not attach preview media to every primary lab card');
assert(!homepage.includes('data-preview-classification="related-'), 'homepage reuses related-skill media as a primary preview');
assert(!/\brunnable examples\b/i.test(homepage), 'homepage still uses directory-derived runnable-example language');
assert(!/transition\s*:\s*all\b/i.test(homepage), 'homepage uses transition: all');
assert(homepage.includes('<main id="main-content"'), 'homepage has no main landmark');
assert(homepage.includes(`<meta name="skill-pack-build-revision" content="${registry.buildRevision}"`), 'homepage build-revision metadata drift');
assert(homepage.includes('class="skip-link"'), 'homepage has no skip link');
assert(homepage.includes(':focus-visible'), 'homepage has no authored focus-visible treatment');
assert(homepage.includes('prefers-reduced-motion:reduce'), 'homepage has no reduced-motion treatment');
const publishedShowcaseIds = [...homepage.matchAll(/data-showcase-demo="([^"]+)"/g)].map((match) => match[1]);
assert(publishedShowcaseIds.length === 10, `homepage showcase must publish exactly 10 cards; received ${publishedShowcaseIds.length}`);
assert(JSON.stringify(publishedShowcaseIds) === JSON.stringify(expectedShowcaseIds), 'homepage showcase order or membership drift');
for (const id of expectedShowcaseIds) {
  const demo = siteDemos.find((entry) => entry.id === id);
  assert(Boolean(demo), `homepage showcase references an unknown demo: ${id}`);
  if (!demo) continue;
  assert(demo.kind === 'generated-asset-demo', `homepage showcase demo is not a generated-asset surface: ${id}`);
  assert(homepage.includes(`data-showcase-demo="${id}" data-showcase-skill="${demo.skill}"`), `homepage showcase skill binding drift: ${id}`);
  assert(homepage.includes(`href="${relativePublishPath(demo.publishPath)}"`), `homepage showcase does not link its demo: ${id}`);
  assert(homepage.includes(`href="skills/${demo.skill}.html"`), `homepage showcase does not link its full skill: ${id}`);
}
const homepageSocialImages = metaContent(homepage, 'property', 'og:image');
assert(homepageSocialImages.length <= 1, 'homepage publishes duplicate social images');
if (homepageSocialImages.length === 1) {
  const sourceId = sameLabImageSourceId(homepageSocialImages[0]);
  assert(sourceId !== null && acceptedFlagshipIds.has(sourceId), 'homepage social image is not accepted flagship evidence');
}

for (const demo of primary) {
  const relative = relativePublishPath(demo.publishPath);
  assert(homepage.includes(`href="${relative}"`), `homepage does not link primary route ${demo.id}`);
  assert(sitemap.includes(`<loc>${site}${relative}</loc>`), `sitemap does not include primary route ${demo.id}`);
  const visualTags = [...homepage.matchAll(new RegExp(`<span[^>]*data-preview-for="${demo.id}"[^>]*>`, 'g'))]
    .map((match) => match[0]);
  assert(visualTags.length > 0, `homepage has no preview or evidence record for ${demo.id}`);
  assert(
    visualTags.every((tag) => !tag.includes('data-preview-source=') || tag.includes(`data-preview-source="${demo.id}"`)),
    `homepage assigns unrelated preview media to ${demo.id}`,
  );
}

assert(evidencePreviewConfig.schemaVersion === 1, 'runtime evidence preview config has an unsupported schema version');
const configuredEvidencePreviewIds = new Set((evidencePreviewConfig.previews ?? []).map((preview) => preview.labId));
for (const configured of evidencePreviewConfig.previews ?? []) {
  const demo = primary.find((entry) => entry.id === configured.labId);
  assert(Boolean(demo), `runtime evidence preview references a non-primary demo: ${configured.labId}`);
  const summaryPath = join(docs, 'visual-validation', configured.labId, 'evidence-summary.json');
  assert(existsSync(summaryPath), `runtime evidence preview summary is missing: ${configured.labId}`);
  if (!demo || !existsSync(summaryPath)) continue;
  const evidence = JSON.parse(readFileSync(summaryPath, 'utf8'));
  assert(evidence.labId === demo.id, `runtime evidence preview lab id drift: ${configured.labId}`);
  assert(evidence.classification === 'inspected-runtime-evidence-preview', `runtime evidence preview classification drift: ${configured.labId}`);
  const currentEvidence = evidence.acceptanceStatus === demo.status
    && evidence.canonicalSourceHash === demo.sourceHash;
  if (!currentEvidence) {
    assert(
      !homepage.includes(`visual-validation/${configured.labId}/${evidence.primaryImage}`),
      `homepage promotes stale runtime evidence: ${configured.labId}`,
    );
    continue;
  }
  assert(evidence.runtime?.isWebGPUBackend === true, `runtime evidence preview lacks native-WebGPU proof: ${configured.labId}`);
  assert(Array.isArray(evidence.images) && evidence.images.length > 0, `runtime evidence preview has no images: ${configured.labId}`);
  assert(evidence.images?.some((image) => image.file === evidence.primaryImage), `runtime evidence preview has no declared primary image: ${configured.labId}`);
  for (const image of evidence.images ?? []) {
    const imagePath = join(docs, 'visual-validation', configured.labId, image.file);
    assert(existsSync(imagePath), `runtime evidence preview image is missing: ${configured.labId}/${image.file}`);
    if (existsSync(imagePath)) {
      assert(sha256(readFileSync(imagePath)) === image.outputSha256, `runtime evidence preview output hash drift: ${configured.labId}/${image.file}`);
    }
  }
  assert(homepage.includes(`visual-validation/${configured.labId}/${evidence.primaryImage}`), `homepage does not use the reviewed primary evidence image: ${configured.labId}`);
  assert(homepage.includes(`data-preview-classification="${evidence.classification}"`), `homepage omits runtime evidence classification: ${configured.labId}`);
  const skillPage = readFileSync(join(docs, 'skills', `${demo.skill}.html`), 'utf8');
  for (const image of evidence.images ?? []) {
    assert(skillPage.includes(`visual-validation/${configured.labId}/${image.file}`), `${demo.skill} omits evidence image ${configured.labId}/${image.file}`);
  }
  if (demo.status !== 'accepted') {
    assert(Array.isArray(evidence.limitations) && evidence.limitations.length > 0, `${configured.labId} has no explicit incomplete-evidence limitations`);
    assert(skillPage.includes('Native WebGPU runtime evidence preview'), `${demo.skill} does not classify the incomplete runtime readback`);
    for (const [claim, verdict] of Object.entries(evidence.claimVerdicts ?? {})) {
      assert(skillPage.includes(escapedHtmlText(claim)), `${demo.skill} omits runtime evidence claim: ${claim}`);
      assert(skillPage.includes(`data-verdict="${escapedHtmlText(verdict)}"`), `${demo.skill} omits runtime evidence verdict: ${claim}=${verdict}`);
    }
    for (const limitation of evidence.limitations ?? []) {
      assert(skillPage.includes(escapedHtmlText(limitation)), `${demo.skill} omits runtime evidence limitation: ${limitation}`);
    }
  }
}

for (const demo of primary.filter((entry) => !entry.nonRenderingScenarioSuite && !configuredEvidencePreviewIds.has(entry.id))) {
  assert(
    !homepage.includes(`visual-validation/${demo.id}/`),
    `homepage publishes unconfigured or stale runtime evidence for ${demo.id}`,
  );
  const demoPage = readFileSync(join(docs, relativePublishPath(demo.publishPath), 'index.html'), 'utf8');
  assert(
    !demoPage.includes(`<meta property="og:image" content="${site}visual-validation/${demo.id}/`),
    `demo social metadata publishes unconfigured or stale runtime evidence for ${demo.id}`,
  );
}

assert(homepage.includes('href="evidence/"'), 'homepage does not link the evidence report index');
errors.push(...validateEvidenceReportManifest({
  manifest: evidenceReportManifest,
  demos: primary,
  buildRevision: registry.buildRevision,
  configuredRuntimePreviewIds: configuredEvidencePreviewIds,
}).map((error) => `evidence report manifest: ${error}`));
const evidenceReportIndexPath = join(docs, 'evidence', 'index.html');
assert(existsSync(evidenceReportIndexPath), 'evidence report index is missing');
const evidenceReportIndex = existsSync(evidenceReportIndexPath) ? readFileSync(evidenceReportIndexPath) : Buffer.alloc(0);
assert(sha256(evidenceReportIndex) === evidenceReportManifest.indexSha256, 'evidence report index hash drift');
for (const demo of primary) {
  const record = evidenceReportManifest.reports?.find((entry) => entry.labId === demo.id);
  assert(Boolean(record), `evidence report manifest omits ${demo.id}`);
  if (!record) continue;
  const reportPath = join(docs, 'evidence', demo.id, 'index.html');
  assert(existsSync(reportPath), `evidence report page is missing: ${demo.id}`);
  if (!existsSync(reportPath)) continue;
  const reportBytes = readFileSync(reportPath);
  const report = reportBytes.toString('utf8');
  const publishedManifestPath = join(docs, relativePublishPath(demo.publishPath), 'source-manifest.json');
  const publishedManifest = existsSync(publishedManifestPath)
    ? JSON.parse(readFileSync(publishedManifestPath, 'utf8'))
    : null;
  assert(record.path === `evidence/${demo.id}/`, `evidence report path drift: ${demo.id}`);
  assert(record.status === demo.status, `evidence report status drift: ${demo.id}`);
  assert(record.sourceHash === demo.sourceHash, `evidence report source hash drift: ${demo.id}`);
  assert(record.publishedBundleHash === publishedManifest?.publishedBundleHash, `evidence report published bundle hash drift: ${demo.id}`);
  assert(record.htmlSha256 === sha256(reportBytes), `evidence report HTML hash drift: ${demo.id}`);
  assert(report.includes(escapedHtmlText(demo.sourceHash)), `evidence report omits source hash: ${demo.id}`);
  assert(report.includes(escapedHtmlText(registry.buildRevision)), `evidence report omits build revision: ${demo.id}`);
  assert(report.includes('id="claims-title"'), `evidence report omits claim verdicts: ${demo.id}`);
  assert(report.includes('id="limitations-title"'), `evidence report omits limitations: ${demo.id}`);
  assert(report.includes(`href="/${relativePublishPath(demo.publishPath)}"`), `evidence report does not link its demo: ${demo.id}`);
  assert(evidenceReportIndex.includes(`href="/evidence/${demo.id}/"`), `evidence report index does not link ${demo.id}`);
  assert(sitemap.includes(`<loc>${evidenceReportUrl(demo.id)}</loc>`), `sitemap omits evidence report ${demo.id}`);

  const media = record.media ?? [];
  if (!media.length) {
    assert(!/<img\b/i.test(report), `evidence report invents media for ${demo.id}`);
    assert(report.includes('No same-lab evidence image is promoted'), `evidence report lacks a plain no-media state: ${demo.id}`);
  }
  for (const image of media) {
    const imagePath = join(docs, image.file);
    assert(existsSync(imagePath), `evidence report media is missing: ${demo.id}/${image.file}`);
    if (existsSync(imagePath)) {
      assert(sha256(readFileSync(imagePath)) === image.outputSha256, `evidence report media hash drift: ${demo.id}/${image.file}`);
    }
    const allowed = configuredEvidencePreviewIds.has(demo.id)
      ? image.file.startsWith(`visual-validation/${demo.id}/`)
      : (demo.nonRenderingScenarioSuite && image.file === `previews/primary/${demo.id}.png`);
    assert(allowed, `evidence report uses unrelated or unconfigured media: ${demo.id}/${image.file}`);
    assert(report.includes(`src="/${escapedHtmlText(image.file)}"`), `evidence report omits promoted media: ${demo.id}/${image.file}`);
    assert(report.includes(escapedHtmlText(image.outputSha256)), `evidence report omits media hash: ${demo.id}/${image.file}`);
  }
}

for (const demo of flagships) {
  assert(homepage.includes(`>${demo.title}<`), `homepage does not name flagship ${demo.id}`);
  const origin = registry.origins[demo.id];
  assert(origin?.ownerSkills?.length > 1, `flagship ${demo.id} has no cross-skill owner set`);
}

for (const demo of siteDemos.filter((entry) => (
  entry.publishPath
  && (PRIMARY_DEMO_KINDS.includes(entry.kind) || ['proxy-demo', 'generated-asset-demo'].includes(entry.kind))
))) {
  const pagePath = join(docs, relativePublishPath(demo.publishPath), 'index.html');
  assert(existsSync(pagePath), `published demo page is missing: ${demo.id}`);
  if (!existsSync(pagePath)) continue;
  const page = readFileSync(pagePath, 'utf8');
  const staticPage = page.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '');
  const shell = staticPage.match(/<(aside|main)\b[^>]*data-demo-seo-shell[^>]*>[\s\S]*?<\/\1>/i)?.[0] ?? '';
  const outerDetails = shell.match(/<details\b[^>]*>/i)?.[0] ?? '';
  assert(Boolean(shell), `${demo.id} has no opt-in evidence drawer`);
  assert(Boolean(outerDetails) && !/\bopen\b/i.test(outerDetails), `${demo.id} opens its evidence drawer over the canvas by default`);
  assert(shell.includes('demo-seo-shell__summary-state'), `${demo.id} compact drawer control omits acceptance state`);
  const linkedEvidenceId = PRIMARY_DEMO_KINDS.includes(demo.kind) ? demo.id : demo.proxyStatus?.canonicalLabId;
  if (linkedEvidenceId) {
    assert(shell.includes(`href="../../evidence/${linkedEvidenceId}/"`), `${demo.id} does not link its canonical evidence report`);
  }
  assert(!page.includes('lab-status-banner'), `${demo.id} adds a second fixed primary status banner`);
  assert(!page.includes('classification-banner'), `${demo.id} adds a second fixed secondary classification banner`);
}

for (const skill of skillManifest.skills) {
  const pagePath = join(docs, 'skills', `${skill.name}.html`);
  assert(existsSync(pagePath), `missing generated skill page ${skill.name}`);
  if (!existsSync(pagePath)) continue;
  const page = readFileSync(pagePath, 'utf8');
  const primarySection = page.match(/<section\b[^>]*\bid=["']primary-implementations["'][^>]*>[\s\S]*?<\/section>/i)?.[0] ?? '';
  const firstPrimaryCard = primarySection.match(/<a\b[^>]*\bclass=["']card["'][^>]*\bhref=["']([^"']+)["'][^>]*>[\s\S]*?<span\b[^>]*\bclass=["']card-kind["'][^>]*>([^<]+)<\/span>/i);
  const ownedPrimary = primary.filter((demo) => demo.skill === skill.name);
  const ownedPrimaryIds = new Set(ownedPrimary.map((demo) => demo.id));
  const expectedCanonical = primary
    .filter((demo) => demo.skill === skill.name && demo.kind === 'canonical-lab')
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (ownedPrimary.length > 0) {
    assert(Boolean(primarySection), `${skill.name} has no primary implementation section`);
    assert(Boolean(firstPrimaryCard), `${skill.name} has no first primary implementation card`);
    if (expectedCanonical) {
      assert(firstPrimaryCard?.[2] === 'Canonical lab', `${skill.name} does not present its canonical lab first`);
      assert(
        firstPrimaryCard?.[1] === `../${relativePublishPath(expectedCanonical.publishPath)}`,
        `${skill.name} first primary card does not link its first canonical lab`,
      );
    }
  } else {
    assert(!primarySection, `${skill.name} presents a primary implementation without owning one`);
  }
  const participatingFlagshipIds = new Set(flagships
    .filter((demo) => registry.origins[demo.id]?.ownerSkills?.includes(skill.name))
    .map((demo) => demo.id));
  const allowedPreviewSources = new Set([...ownedPrimaryIds, ...participatingFlagshipIds]);
  const socialImages = metaContent(page, 'property', 'og:image');
  assert(socialImages.length <= 1, `${skill.name} publishes duplicate social images`);
  if (socialImages.length === 1) {
    const sourceId = sameLabImageSourceId(socialImages[0]);
    assert(sourceId !== null && ownedPrimaryIds.has(sourceId), `${skill.name} social image is not same-skill primary evidence`);
  }
  for (const match of page.matchAll(/\bdata-preview-source=["']([^"']+)["']/g)) {
    assert(allowedPreviewSources.has(match[1]), `${skill.name} publishes preview media from unrelated lab ${match[1]}`);
  }
  assert(page.includes('<main id="main-content"'), `${skill.name} page has no main landmark`);
  assert(!page.includes('class="preview-badge'), `${skill.name} overlays classification badges on evidence media`);
  assert(!page.includes('class="hero-preview-badge'), `${skill.name} overlays a decorative badge on hero evidence`);
  assert(!page.includes('class="preview-missing'), `${skill.name} presents missing evidence as a visual placeholder`);
  if (ownedPrimary.length > 0) {
    assert(page.includes('Preview and evidence ledger'), `${skill.name} page has no preview/evidence ledger`);
  } else {
    assert(!page.includes('Preview and evidence ledger'), `${skill.name} publishes a demo evidence ledger without owning a primary`);
    assert(!page.includes('native evidence pending'), `${skill.name} claims pending native evidence without owning a primary`);
  }
  if (ownedPrimary.length > 0 && ownedPrimary.every((demo) => demo.executionClass === 'non-rendering')) {
    assert(page.includes('non-rendering scenario suite'), `${skill.name} does not identify its non-rendering acceptance surface`);
    assert(page.includes('rather than GPU pixels'), `${skill.name} incorrectly implies that GPU pixels prove its scenario suite`);
    assert(!page.includes('rendering acceptance still requires same-lab readback'), `${skill.name} applies rendering evidence copy to a non-rendering suite`);
  }
  if (ownedPrimary.length > 0) {
    assert(
      page.includes('data-preview-classification=') || page.includes('data-evidence-state='),
      `${skill.name} page has neither classified preview media nor an evidence-status panel`,
    );
  }
  assert(!page.includes('data-preview-classification="related-'), `${skill.name} page promotes related-skill media as primary preview`);
  for (const demo of primary.filter((entry) => entry.skill === skill.name)) {
    assert(page.includes(`href="../${relativePublishPath(demo.publishPath)}"`), `${skill.name} page does not link primary ${demo.id}`);
    assert(page.includes(`href="../evidence/${demo.id}/"`), `${skill.name} page does not link evidence report ${demo.id}`);
  }
  for (const demo of flagships.filter((entry) => registry.origins[entry.id]?.ownerSkills?.includes(skill.name))) {
    assert(page.includes(`href="../${relativePublishPath(demo.publishPath)}"`), `${skill.name} page does not link participating flagship ${demo.id}`);
    assert(page.includes(`href="../evidence/${demo.id}/"`), `${skill.name} page does not link flagship evidence report ${demo.id}`);
  }
}

assert(previewManifest.classification === 'site-preview-screenshot', 'site preview manifest has the wrong classification');
assert(previewManifest.canonicalEvidence === false, 'site preview manifest must never claim canonical evidence');
const capturedPreviewIds = new Set(previewManifest.results
  .filter((entry) => entry.verdict === 'PREVIEW_CAPTURED')
  .map((entry) => entry.id));
for (const demo of PROVIDER_DEMOS.filter((entry) => !entry.poster)) {
  assert(capturedPreviewIds.has(demo.id), `provider demo preview is missing or failed: ${demo.id}`);
  const capture = previewManifest.results.find((entry) => entry.id === demo.id);
  assert(capture?.captureSurface === 'interactive-chrome', `provider preview was not approved from interactive Chrome: ${demo.id}`);
  const imagePath = join(docs, 'previews', 'provider', `${demo.id}.png`);
  assert(existsSync(imagePath), `provider preview image is absent: ${demo.id}`);
  if (existsSync(imagePath)) {
    const image = readFileSync(imagePath);
    const signature = image.subarray(1, 4).toString('ascii');
    assert(signature === 'PNG', `provider preview is not encoded as PNG: ${demo.id}`);
    if (signature === 'PNG') {
      const width = image.readUInt32BE(16);
      const height = image.readUInt32BE(20);
      assert(width === capture.width && height === capture.height, `provider preview dimensions drifted from its manifest: ${demo.id}`);
    }
  }
}

const approvedHtmlUiPreviews = new Set([
  'browser-fallback-harness',
  'debugging-contract-lab',
]);
for (const capture of previewManifest.results.filter((entry) => (
  entry.verdict === 'PREVIEW_CAPTURED'
  && entry.image?.startsWith('previews/primary/')
))) {
  assert(approvedHtmlUiPreviews.has(capture.id), `unreviewed headless primary screenshot was promoted: ${capture.id}`);
  assert(capture.captureSurface === 'headless-playwright-html-ui', `primary HTML/UI preview has the wrong capture surface: ${capture.id}`);
}

if (errors.length) {
  console.error(`site presentation validation failed (${errors.length} errors):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated site presentation: ${authoritativeSkillSlugs.size} skills, ${primary.length} primary targets, ${flagships.length} flagships, ${uniqueRoutes.size} unique primary URLs.`);
}
