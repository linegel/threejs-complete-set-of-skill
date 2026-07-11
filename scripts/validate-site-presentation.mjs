#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIMARY_DEMO_KINDS, buildDemoRegistry } from './lib/lab-registry.mjs';
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
const errors = [];

const assert = (condition, message) => {
  if (!condition) errors.push(message);
};
const relativePublishPath = (path) => path.replace(/^\/+/, '');

const primary = registry.demos.filter((demo) => PRIMARY_DEMO_KINDS.includes(demo.kind));
const canonical = primary.filter((demo) => demo.kind === 'canonical-lab');
const accepted = primary.filter((demo) => demo.status === 'accepted');
const loadable = primary.filter((demo) => demo.publishPath && (
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

assert(registry.counts.skills === skillManifest.skills.length, 'registry skill count does not match the published skill manifest');
assert(primary.length === registry.counts.primary, 'primary demo count does not match registry counts');
assert(loadable.length === primary.length, `${primary.length - loadable.length} primary implementation(s) are not loadable`);
const canonicalSkillNames = new Set(canonical.map((demo) => demo.skill));
const skillsWithoutCanonicalLabs = skillManifest.skills.filter((skill) => (
  !canonicalSkillNames.has(skill.name) && !skill.attribution
));
assert(skillsWithoutCanonicalLabs.length === 0, `skills lack canonical labs: ${skillsWithoutCanonicalLabs.map((skill) => skill.name).join(', ')}`);
assert(flagships.length === 5, `expected five flagships; received ${flagships.length}`);
assert(support.length === 7, `expected seven focused support primaries; received ${support.length}`);
assert(!routes.some((route) => typeof route !== 'string' || !route.startsWith('/demos/')), 'primary route contract contains an invalid publish path');

assert(rootSkillsText === docsSkillsText, 'skills.json and docs/skills.json differ');
assert(skillManifest.coverageSummary, 'skills.json has no coverageSummary');
const summary = skillManifest.coverageSummary ?? {};
assert(summary.threeRevision === registry.threeRevision, 'coverageSummary Three.js revision drift');
assert(summary.buildRevision === registry.buildRevision, 'coverageSummary build revision drift');
assert(summary.skills === registry.counts.skills, 'coverageSummary skill count drift');
assert(summary.primaryImplementations === primary.length, 'coverageSummary primary count drift');
assert(summary.loadablePrimaryImplementations === loadable.length, 'coverageSummary loadable count drift');
assert(summary.canonicalLabs === canonical.length, 'coverageSummary canonical count drift');
assert(summary.crossSkillFlagships === flagships.length, 'coverageSummary flagship count drift');
assert(summary.focusedSupportPrimaries === support.length, 'coverageSummary support count drift');
assert(summary.acceptedPrimary === accepted.length, 'coverageSummary accepted count drift');
assert(summary.pendingPrimary === primary.length - accepted.length, 'coverageSummary pending count drift');
assert(summary.routes?.declaredContracts === routes.length, 'coverageSummary declared route count drift');
assert(summary.routes?.uniquePublishedPaths === uniqueRoutes.size, 'coverageSummary unique route count drift');

for (const route of uniqueRoutes) {
  const indexPath = join(docs, relativePublishPath(route), 'index.html');
  assert(existsSync(indexPath), `generated primary route is missing: ${route}`);
}

for (const phrase of [
  `${primary.length} primary implementations`,
  `${canonical.length} canonical labs`,
  `${flagships.length} cross-skill flagships`,
  'The matrix is built. Evidence still has veto power.',
  'Implementation ≠ acceptance',
]) {
  assert(homepage.includes(phrase), `homepage is missing truthful achievement copy: ${phrase}`);
}
assert(homepage.includes(`<dd>${uniqueRoutes.size}</dd><dt>unique primary URLs</dt>`), 'homepage unique primary URL metric drift');

assert(!/>\s*Live WebGPU\s*</i.test(homepage), 'secondary visual still claims Live WebGPU');
assert(!homepage.includes('class="live-visual'), 'homepage still uses CSS title slates instead of real preview media');
assert(!homepage.includes('class="preview-missing'), 'homepage contains a missing-preview panel');
assert((homepage.match(/data-preview-for=/g) ?? []).length >= primary.length, 'homepage does not attach preview media to every primary lab card');
assert(!homepage.includes('data-preview-classification="related-'), 'homepage reuses related-skill media as a primary preview');
assert(!/\brunnable examples\b/i.test(homepage), 'homepage still uses directory-derived runnable-example language');
assert(!/transition\s*:\s*all\b/i.test(homepage), 'homepage uses transition: all');
assert(homepage.includes('<main id="main-content"'), 'homepage has no main landmark');
assert(homepage.includes(`<meta name="skill-pack-build-revision" content="${registry.buildRevision}"`), 'homepage build-revision metadata drift');
assert(homepage.includes('class="skip-link"'), 'homepage has no skip link');
assert(homepage.includes(':focus-visible'), 'homepage has no authored focus-visible treatment');
assert(homepage.includes('prefers-reduced-motion:reduce'), 'homepage has no reduced-motion treatment');

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

for (const demo of flagships) {
  assert(homepage.includes(`>${demo.title}<`), `homepage does not name flagship ${demo.id}`);
  const origin = registry.origins[demo.id];
  assert(origin?.ownerSkills?.length > 1, `flagship ${demo.id} has no cross-skill owner set`);
}

for (const skill of skillManifest.skills) {
  const pagePath = join(docs, 'skills', `${skill.name}.html`);
  assert(existsSync(pagePath), `missing generated skill page ${skill.name}`);
  if (!existsSync(pagePath)) continue;
  const page = readFileSync(pagePath, 'utf8');
  assert(page.includes('<main id="main-content"'), `${skill.name} page has no main landmark`);
  assert(page.includes('Preview and evidence ledger'), `${skill.name} page has no preview/evidence ledger`);
  assert(
    page.includes('data-preview-classification=') || page.includes('data-evidence-state='),
    `${skill.name} page has neither classified preview media nor an evidence-status panel`,
  );
  assert(!page.includes('data-preview-classification="related-'), `${skill.name} page promotes related-skill media as primary preview`);
  for (const demo of primary.filter((entry) => entry.skill === skill.name)) {
    assert(page.includes(`href="../${relativePublishPath(demo.publishPath)}"`), `${skill.name} page does not link primary ${demo.id}`);
  }
  for (const demo of flagships.filter((entry) => registry.origins[entry.id]?.ownerSkills?.includes(skill.name))) {
    assert(page.includes(`href="../${relativePublishPath(demo.publishPath)}"`), `${skill.name} page does not link participating flagship ${demo.id}`);
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
  'router-manifest-lab',
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
  console.log(`Validated site presentation: ${registry.counts.skills} skills, ${primary.length} primary implementations, ${flagships.length} flagships, ${uniqueRoutes.size} unique primary URLs.`);
}
