#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRIMARY_DEMO_KINDS,
  REPO_ROOT,
  buildDemoRegistry,
} from './lib/lab-registry.mjs';

const SITE = 'https://threejs-skills.com/';
const SITE_NAME = 'Three.js WebGPU Skill Pack';
const REPOSITORY = 'https://github.com/linegel/threejs-complete-set-of-skill';
const DOCS = join(REPO_ROOT, 'docs');
const OUTPUT = join(DOCS, 'evidence');
const MANIFEST_PATH = join(OUTPUT, 'manifest.json');
const registry = buildDemoRegistry();
const evidenceLabFilter = process.env.EVIDENCE_LABS
  ? new Set(process.env.EVIDENCE_LABS.split(',').map((value) => value.trim()).filter(Boolean))
  : null;
const primary = registry.demos
  .filter((demo) => PRIMARY_DEMO_KINDS.includes(demo.kind))
  .filter((demo) => evidenceLabFilter === null || evidenceLabFilter.has(demo.id))
  .sort((a, b) => a.id.localeCompare(b.id));
const skillManifest = JSON.parse(readFileSync(join(REPO_ROOT, 'skills.json'), 'utf8'));
const skillsByName = new Map(skillManifest.skills.map((skill) => [skill.name, skill]));
const previewConfig = JSON.parse(readFileSync(join(REPO_ROOT, 'labs', 'runtime-evidence-previews.json'), 'utf8'));
const configuredRuntimePreviews = new Set((previewConfig.previews ?? []).map((entry) => entry.labId));
const previewManifest = JSON.parse(readFileSync(join(DOCS, 'previews', 'manifest.json'), 'utf8'));

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const humanize = (value) => String(value).split('-').map((word) => (
  /^(ao|cpu|gpu|gtao|hdr|lod|mrt|ndc|pbr|tsl|ui|webgpu)$/i.test(word)
    ? word.toUpperCase()
    : `${word.charAt(0).toUpperCase()}${word.slice(1)}`
)).join(' ');
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const posix = (path) => path.split(sep).join('/');
const clipText = (value, maximum) => {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= maximum) return text;
  const prefix = text.slice(0, maximum - 1);
  const boundary = prefix.lastIndexOf(' ');
  return `${prefix.slice(0, Math.max(boundary, maximum - 18)).replace(/[,:;.!?\s-]+$/, '')}…`;
};
const reportPath = (labId) => `evidence/${labId}/`;
const reportUrl = (labId) => `${SITE}${reportPath(labId)}`;
const skillTitle = (demo) => skillsByName.get(demo.skill)?.title ?? humanize(demo.skill);
const demoTitle = (demo) => demo.title
  ?? skillsByName.get(demo.skill)?.primaryImplementations?.find((entry) => entry.id === demo.id)?.title
  ?? humanize(demo.id);
const required = (records) => (records ?? []).filter((record) => record.required === true);

function confined(path, base = DOCS) {
  const absolute = resolve(path);
  const root = resolve(base);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    throw new Error(`Generated evidence path escapes ${root}: ${absolute}`);
  }
  return absolute;
}

function pngDimensions(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`Evidence media is not PNG: ${path}`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function runtimeSummary(demo) {
  if (!configuredRuntimePreviews.has(demo.id)) return null;
  const path = join(DOCS, 'visual-validation', demo.id, 'evidence-summary.json');
  if (!existsSync(path)) throw new Error(`Configured runtime evidence summary is missing: ${demo.id}`);
  const summary = JSON.parse(readFileSync(path, 'utf8'));
  if (
    summary.schemaVersion !== 1
    || summary.labId !== demo.id
    || summary.classification !== 'inspected-runtime-evidence-preview'
    || summary.acceptanceStatus !== demo.status
    || summary.canonicalSourceHash !== demo.sourceHash
    || summary.runtime?.isWebGPUBackend !== true
    || !Array.isArray(summary.images)
    || !Array.isArray(summary.limitations)
  ) throw new Error(`Runtime evidence summary is invalid or stale: ${demo.id}`);
  for (const image of summary.images) {
    const imagePath = confined(join(DOCS, 'visual-validation', demo.id, image.file));
    if (!existsSync(imagePath)) throw new Error(`Runtime evidence image is missing: ${demo.id}/${image.file}`);
    const bytes = readFileSync(imagePath);
    if (sha256(bytes) !== image.outputSha256) throw new Error(`Runtime evidence image hash drift: ${demo.id}/${image.file}`);
    const dimensions = pngDimensions(imagePath);
    if (dimensions.width !== image.width || dimensions.height !== image.height) {
      throw new Error(`Runtime evidence image dimensions drift: ${demo.id}/${image.file}`);
    }
  }
  return summary;
}

function publishedSourceManifest(demo) {
  const path = join(DOCS, demo.publishPath.replace(/^\/+/, ''), 'source-manifest.json');
  if (!existsSync(path)) throw new Error(`Published source manifest is missing: ${demo.id}`);
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (
    manifest.schemaVersion !== 2
    || manifest.labId !== demo.id
    || manifest.sourceHash !== demo.sourceHash
    || manifest.threeRevision !== demo.threeRevision
    || manifest.buildRevision !== registry.buildRevision
  ) throw new Error(`Published source manifest is stale: ${demo.id}`);
  return { path, manifest };
}

function releaseBundle(demo) {
  const path = join(DOCS, 'visual-validation', demo.id, 'bundle', 'evidence-manifest.json');
  if (!existsSync(path)) return null;
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  return { path, manifest };
}

function nonRenderingPreview(demo) {
  if (!demo.nonRenderingScenarioSuite) return null;
  const record = previewManifest.results?.find((entry) => (
    entry.id === demo.id
    && entry.verdict === 'PREVIEW_CAPTURED'
    && entry.classification === 'non-rendering-lab-preview'
    && entry.canonicalEvidence === false
  ));
  if (!record?.image) return null;
  const path = confined(join(DOCS, record.image));
  if (!existsSync(path)) throw new Error(`Non-rendering preview is missing: ${demo.id}`);
  const bytes = readFileSync(path);
  const dimensions = pngDimensions(path);
  if (dimensions.width !== record.width || dimensions.height !== record.height) {
    throw new Error(`Non-rendering preview dimensions drift: ${demo.id}`);
  }
  return {
    file: record.image,
    meaning: 'Deterministic contract-lab presentation screenshot; not GPU render evidence.',
    outputSha256: sha256(bytes),
    width: dimensions.width,
    height: dimensions.height,
    classification: record.classification,
  };
}

function mediaFor(demo, summary) {
  if (summary) return summary.images.map((image) => ({
    ...image,
    file: `visual-validation/${demo.id}/${image.file}`,
    classification: summary.classification,
  }));
  const preview = nonRenderingPreview(demo);
  return preview ? [preview] : [];
}

function routeRows(demo) {
  const groups = [
    ['scenario', demo.scenarios],
    ['mechanism', demo.mechanisms],
    ['tier', demo.tiers],
  ];
  return groups.flatMap(([kind, records]) => records.map((record) => ({
    kind,
    id: record.id,
    path: `demos/${demo.id}/${kind}/${record.id}/`,
    startup: record.startup ?? (kind === 'tier' ? { tier: record.id } : { [kind]: record.id }),
    status: record.acceptanceStatus,
  })));
}

function verdictRows(demo, summary) {
  if (summary) return Object.entries(summary.claimVerdicts ?? {}).map(([claim, verdict]) => ({ claim, verdict }));
  if (demo.nonRenderingScenarioSuite) {
    return [
      { claim: 'contractCorrectness', verdict: demo.status === 'accepted' ? 'PASS' : 'INSUFFICIENT_EVIDENCE' },
      { claim: 'GPUAttribution', verdict: 'NOT_CLAIMED' },
      { claim: 'hardwarePerformance', verdict: 'NOT_CLAIMED' },
      { claim: 'renderLifecycle', verdict: 'NOT_APPLICABLE' },
    ];
  }
  return [
    { claim: 'canonicalAcceptance', verdict: demo.status === 'accepted' ? 'PASS' : 'INSUFFICIENT_EVIDENCE' },
    { claim: 'hardwarePerformance', verdict: 'NOT_CLAIMED' },
  ];
}

function limitationsFor(demo, summary, bundle) {
  if (summary) return [...summary.limitations];
  if (demo.nonRenderingScenarioSuite) {
    return ['This is a non-rendering contract suite; GPU render, readback, timestamp, and render-lifecycle claims are structurally not applicable.'];
  }
  const limitations = [];
  if (!bundle) limitations.push('No tracked accepted v2 runtime bundle is published for this source hash.');
  const missingCapabilities = required(demo.capabilityRequirements).filter((entry) => entry.status !== 'accepted');
  const missingProofs = required(demo.runtimeProof).filter((entry) => entry.status !== 'accepted');
  if (missingCapabilities.length) limitations.push(`${missingCapabilities.length} required capability record${missingCapabilities.length === 1 ? '' : 's'} remain incomplete.`);
  if (missingProofs.length) limitations.push(`${missingProofs.length} required runtime-proof record${missingProofs.length === 1 ? '' : 's'} remain incomplete.`);
  limitations.push('No current-hardware performance claim is published without named-adapter timestamp evidence.');
  return limitations;
}

function responsivePicture(image, title) {
  const src = `/${image.file}`;
  return `<picture class="responsive-preview">
          <source type="image/avif" srcset="${escapeHtml(src.replace(/\.png$/i, '.avif'))}" />
          <source type="image/webp" srcset="${escapeHtml(src.replace(/\.png$/i, '.webp'))}" />
          <img data-responsive-preview src="${escapeHtml(src)}" alt="${escapeHtml(`${title}: ${image.meaning}`)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async" />
        </picture>`;
}

function reportModel(demo) {
  const summary = runtimeSummary(demo);
  const source = publishedSourceManifest(demo);
  const bundle = releaseBundle(demo);
  if (demo.status === 'accepted' && !demo.nonRenderingScenarioSuite && !bundle) {
    throw new Error(`Accepted rendering lab has no tracked release bundle: ${demo.id}`);
  }
  return {
    demo,
    summary,
    source,
    bundle,
    media: mediaFor(demo, summary),
    routes: routeRows(demo),
    verdicts: verdictRows(demo, summary),
    limitations: limitationsFor(demo, summary, bundle),
  };
}

const commonCss = `
@font-face{font-family:'Evidence Sans';src:url('/assets/vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'Evidence Sans';src:url('/assets/vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2') format('woff2');font-weight:700;font-display:swap}
@font-face{font-family:'Evidence Mono';src:url('/assets/vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2') format('woff2');font-weight:400;font-display:swap}
:root{--bg:#080a0e;--panel:#0e1218;--panel2:#121821;--ink:#f0ede5;--dim:#aaa99f;--line:#29313c;--cyan:#7fd4c1;--amber:#ffb454;--pass:#b6de82;--fail:#ff927a;--mono:'Evidence Mono',ui-monospace,monospace;--sans:'Evidence Sans',ui-sans-serif,sans-serif}
*{box-sizing:border-box}html{background:var(--bg);color:var(--ink);scroll-behavior:smooth}body{margin:0;font:16px/1.65 var(--sans);-webkit-font-smoothing:antialiased}a{color:var(--cyan);text-underline-offset:3px}a:focus-visible,summary:focus-visible{outline:2px solid var(--amber);outline-offset:4px}.wrap{width:min(1160px,calc(100% - 40px));margin-inline:auto}.site-nav{border-bottom:1px solid var(--line)}.site-nav .wrap{min-height:58px;display:flex;align-items:center;justify-content:space-between;gap:24px}.site-nav a{text-decoration:none}.site-nav nav{display:flex;align-items:center;gap:18px;font:12px/1 var(--mono)}.site-nav nav a{min-height:44px;display:inline-flex;align-items:center;white-space:nowrap}main{padding:clamp(48px,8vw,92px) 0 100px}.crumbs{font:11px/1.5 var(--mono);color:var(--dim)}.crumbs a{color:inherit}h1,h2,h3,p{margin-top:0}h1{max-width:900px;margin:18px 0 16px;font-size:clamp(38px,7vw,76px);line-height:.98;letter-spacing:-.045em;text-wrap:balance}h2{margin-bottom:18px;font-size:clamp(24px,3vw,36px);line-height:1.1}.lede{max-width:780px;color:var(--dim);font-size:18px}.status{display:inline-flex;padding:6px 9px;border:1px solid currentColor;border-radius:999px;font:10px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase}.status--accepted,.verdict--pass{color:var(--pass)}.status--incomplete,.status--blocked,.verdict--insufficient-evidence{color:var(--amber)}.verdict--fail{color:var(--fail)}.verdict--not-claimed,.verdict--not-applicable{color:var(--dim)}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.actions a{min-height:42px;display:inline-flex;align-items:center;padding:9px 12px;border:1px solid var(--line);border-radius:9px;text-decoration:none}.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:48px 0;border-top:1px solid var(--line);border-left:1px solid var(--line)}.facts div{min-width:0;padding:16px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}dt{font:10px/1.4 var(--mono);color:var(--dim);text-transform:uppercase;letter-spacing:.06em}dd{margin:6px 0 0;overflow-wrap:anywhere}.section{margin-top:72px}.claim-grid,.requirement-grid,.report-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.claim,.requirement,.report-card{padding:17px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.claim{display:flex;align-items:center;justify-content:space-between;gap:16px}.claim code,.requirement code,.report-card code{font:11px/1.45 var(--mono);color:var(--cyan)}.claim span{font:10px/1.2 var(--mono)}.requirement p{margin:8px 0 0;color:var(--dim);font-size:14px}.requirement header{display:flex;align-items:center;justify-content:space-between;gap:12px}.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.gallery figure{margin:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel)}.gallery img{width:100%;height:auto;display:block}.gallery figcaption{padding:13px 15px}.gallery strong,.gallery span{display:block}.gallery span{margin-top:4px;color:var(--dim);font:10px/1.5 var(--mono);overflow-wrap:anywhere}.empty{padding:22px;border:1px dashed var(--line);border-radius:12px;color:var(--dim)}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:11px 13px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font:10px/1.4 var(--mono);color:var(--dim);text-transform:uppercase}tr:last-child td{border-bottom:0}td code{font:10px/1.45 var(--mono);color:var(--cyan);overflow-wrap:anywhere}details{border:1px solid var(--line);border-radius:12px;background:var(--panel)}details+details{margin-top:9px}summary{cursor:pointer;padding:13px 15px;font-weight:700}details pre{margin:0;padding:0 15px 15px;color:var(--dim);white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.55 var(--mono)}.limitations{padding-left:20px;color:var(--dim)}.report-card{text-decoration:none;color:var(--ink)}.report-card header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.report-card h2{margin:10px 0 6px;font-size:20px}.report-card p{margin:0;color:var(--dim);font-size:14px}.report-card footer{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);font:10px/1.45 var(--mono);color:var(--dim)}footer.site-footer{margin-top:80px;padding-top:24px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:24px;color:var(--dim);font-size:13px}
@media(max-width:820px){.facts{grid-template-columns:repeat(2,minmax(0,1fr))}.claim-grid,.requirement-grid,.report-grid,.gallery{grid-template-columns:1fr}.site-nav .wrap{min-height:auto;display:grid;grid-template-columns:1fr;gap:4px;padding-block:10px 6px}.site-nav nav{width:100%;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-width:none}.site-nav nav::-webkit-scrollbar{display:none}}
@media(max-width:480px){.wrap{width:min(100% - 24px,1160px)}.facts{grid-template-columns:1fr}h1{font-size:40px}.claim{align-items:flex-start;flex-direction:column}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;

function head({ title, description, url, image = null, imageAlt = '' }) {
  const social = image ? `
<meta property="og:image" content="${escapeHtml(`${SITE}${image.file}`)}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="${image.width}" />
<meta property="og:image:height" content="${image.height}" />
<meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />
<meta name="twitter:image" content="${escapeHtml(`${SITE}${image.file}`)}" />
<meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}" />` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<link rel="canonical" href="${escapeHtml(url)}" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="${SITE_NAME}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${escapeHtml(url)}" />${social}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<style>${commonCss}</style>`;
}

function nav() {
  return `<header class="site-nav"><div class="wrap"><a href="/">${SITE_NAME}</a><nav aria-label="Primary navigation"><a href="/#flagships">Examples</a><a href="/#skills">Skills</a><a href="/guides/">Guides</a><a href="/evidence/">Evidence</a><a href="/#install">Install</a><a href="${REPOSITORY}">GitHub</a></nav></div></header>`;
}

function requirementHtml(record, domain) {
  return `<article class="requirement"><header><code>${escapeHtml(record.id)}</code><span class="status status--${record.status === 'accepted' ? 'accepted' : 'incomplete'}">${escapeHtml(record.status)}</span></header><p>${escapeHtml(record.evidence ?? `No ${domain} evidence is recorded.`)}</p></article>`;
}

function reportHtml(model) {
  const { demo, summary, source, bundle, media, routes, verdicts, limitations } = model;
  const title = demoTitle(demo);
  const url = reportUrl(demo.id);
  const pageTitle = clipText(`Evidence: ${title} | WebGPU Lab`, 64);
  const description = clipText(`Evidence report for ${title}: ${demo.status} ${demo.kind}, source hash, Three.js revision, claim verdicts, required proofs, routes, media hashes, and limitations.`, 164);
  const primaryImage = media.find((entry) => summary && entry.file.endsWith(`/${summary.primaryImage}`)) ?? media[0] ?? null;
  const schema = {
    '@context': 'https://schema.org',
    '@type': ['TechArticle', 'Dataset'],
    '@id': `${url}#report`,
    name: `Evidence report: ${title}`,
    description,
    url,
    inLanguage: 'en',
    isPartOf: { '@id': `${SITE}#software` },
    about: [demo.skill, demo.id, 'Three.js', 'WebGPU', 'TSL'],
    ...(primaryImage ? { image: `${SITE}${primaryImage.file}` } : {}),
  };
  const capabilityRows = required(demo.capabilityRequirements);
  const runtimeRows = required(demo.runtimeProof);
  const captureFacts = [
    ['Primary route', demo.publishPath],
    ['Cameras', demo.cameras?.length ? demo.cameras.join(', ') : 'Not declared'],
    ['Seeds', demo.seeds?.length ? demo.seeds.map((seed) => `0x${Number(seed).toString(16).padStart(8, '0')}`).join(', ') : 'Not declared'],
    ['Modes', demo.modes?.length ? demo.modes.join(', ') : 'Not declared'],
    ['Capture time', 'Not present in the promoted report data'],
    ['Adapter identity', summary?.runtime?.adapterIdentity ? JSON.stringify(summary.runtime.adapterIdentity) : 'Not promoted'],
    ['Raw readback hashes', summary ? 'Not present in the promoted preview summary' : 'Not promoted'],
  ];
  const links = [
    [`/${demo.publishPath.replace(/^\/+/, '')}`, 'Open demo'],
    [`/skills/${demo.skill}.html`, 'Owning skill'],
    [`/demos/${demo.id}/source-manifest.json`, 'Published source manifest'],
    ['/demos/registry.json', 'Registry JSON'],
    ...(summary ? [[`/visual-validation/${demo.id}/evidence-summary.json`, 'Promoted evidence summary']] : []),
    ...(bundle ? [[`/visual-validation/${demo.id}/bundle/evidence-manifest.json`, 'Tracked v2 bundle manifest']] : []),
    [`${REPOSITORY}/tree/main/${demo.canonicalSource[0]?.split('/examples/')[0] ?? demo.skill}`, 'Canonical source'],
  ];
  return `${head({
    title: pageTitle,
    description,
    url,
    image: primaryImage,
    imageAlt: primaryImage ? `${title}: ${primaryImage.meaning}` : '',
  })}
<script type="application/ld+json">${JSON.stringify(schema)}</script>
</head>
<body>
${nav()}
<main><div class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Skill Pack</a> / <a href="/evidence/">Evidence</a> / ${escapeHtml(demo.id)}</nav>
  <p><span class="status status--${demo.status === 'accepted' ? 'accepted' : 'incomplete'}">${escapeHtml(demo.status)}</span></p>
  <h1>${escapeHtml(title)}</h1>
  <p class="lede">This report separates published implementation state from accepted evidence. Every value below comes from the schema-v2 registry, the emitted source manifest, or promoted same-lab artifacts.</p>
  <div class="actions">${links.map(([href, label]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join('')}</div>
  <dl class="facts">
    <div><dt>Lab id</dt><dd><code>${escapeHtml(demo.id)}</code></dd></div>
    <div><dt>Kind</dt><dd>${escapeHtml(humanize(demo.kind))}</dd></div>
    <div><dt>Owning skill</dt><dd>${escapeHtml(skillTitle(demo))}</dd></div>
    <div><dt>Execution</dt><dd>${escapeHtml(demo.executionClass ?? (demo.nonRenderingScenarioSuite ? 'non-rendering' : 'rendering'))}</dd></div>
    <div><dt>Three.js</dt><dd>${escapeHtml(demo.threeRevision)}</dd></div>
    <div><dt>Source hash</dt><dd><code>${escapeHtml(demo.sourceHash)}</code></dd></div>
    <div><dt>Published bundle hash</dt><dd><code>${escapeHtml(source.manifest.publishedBundleHash)}</code></dd></div>
    <div><dt>Build revision</dt><dd><code>${escapeHtml(registry.buildRevision)}</code></dd></div>
    <div><dt>Renderer</dt><dd>${escapeHtml(summary?.runtime?.renderer ?? (demo.nonRenderingScenarioSuite ? 'Not applicable' : 'Not promoted'))}</dd></div>
    <div><dt>Backend</dt><dd>${escapeHtml(summary?.runtime?.backend ?? (demo.nonRenderingScenarioSuite ? 'Not applicable' : 'Not promoted'))}</dd></div>
    <div><dt>Evidence contract</dt><dd>${escapeHtml(demo.evidenceContract)}</dd></div>
    <div><dt>Tracked release bundle</dt><dd>${bundle ? 'Present' : 'Absent'}</dd></div>
  </dl>

  <section class="section" aria-labelledby="claims-title"><h2 id="claims-title">Claim verdicts</h2><div class="claim-grid">${verdicts.map(({ claim, verdict }) => `<div class="claim"><code>${escapeHtml(claim)}</code><span class="verdict--${escapeHtml(verdict.toLowerCase().replaceAll('_', '-'))}">${escapeHtml(verdict)}</span></div>`).join('')}</div></section>

  <section class="section" aria-labelledby="media-title"><h2 id="media-title">Promoted same-lab media</h2>${media.length ? `<div class="gallery">${media.map((image) => `<figure>${responsivePicture(image, title)}<figcaption><strong>${escapeHtml(image.meaning)}</strong><span>${escapeHtml(image.classification)} · ${escapeHtml(image.outputSha256)}</span></figcaption></figure>`).join('')}</div>` : '<p class="empty">No same-lab evidence image is promoted for this report. The page intentionally shows status and proof requirements instead of substitute art.</p>'}</section>

  <section class="section" aria-labelledby="requirements-title"><h2 id="requirements-title">Required capability and runtime proof</h2><h3>Capabilities</h3><div class="requirement-grid">${capabilityRows.length ? capabilityRows.map((record) => requirementHtml(record, 'capability')).join('') : '<p class="empty">No required capability records are declared.</p>'}</div><h3 style="margin-top:28px">Runtime proof</h3><div class="requirement-grid">${runtimeRows.length ? runtimeRows.map((record) => requirementHtml(record, 'runtime')).join('') : '<p class="empty">No required runtime-proof records are declared.</p>'}</div></section>

  <section class="section" aria-labelledby="capture-title"><h2 id="capture-title">Capture state</h2><div class="table-wrap"><table><thead><tr><th>Field</th><th>Published value</th></tr></thead><tbody>${captureFacts.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td><code>${escapeHtml(value)}</code></td></tr>`).join('')}</tbody></table></div></section>

  <section class="section" aria-labelledby="routes-title"><h2 id="routes-title">Fixed routes</h2>${routes.length ? `<div class="table-wrap"><table><thead><tr><th>Kind</th><th>Id</th><th>Startup state</th><th>Status</th></tr></thead><tbody>${routes.map((route) => `<tr><td>${escapeHtml(route.kind)}</td><td><a href="/${escapeHtml(route.path)}"><code>${escapeHtml(route.id)}</code></a></td><td><code>${escapeHtml(JSON.stringify(route.startup))}</code></td><td>${escapeHtml(route.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">This primary declares no fixed scenario, mechanism, or tier routes.</p>'}</section>

  <section class="section" aria-labelledby="tiers-title"><h2 id="tiers-title">Locked tier contracts</h2>${demo.tiers.length ? demo.tiers.map((tier) => `<details><summary>${escapeHtml(tier.id)} · ${escapeHtml(tier.acceptanceStatus)}</summary><pre>${escapeHtml(JSON.stringify({ targetClass: tier.targetClass, frameTargetMs: tier.frameTargetMs, resolutionPolicy: tier.resolutionPolicy, mechanismLimits: tier.mechanismLimits, resourceLimits: tier.resourceLimits, degradationFromPrevious: tier.degradationFromPrevious, preservedInvariants: tier.preservedInvariants }, null, 2))}</pre></details>`).join('') : '<p class="empty">No renderer quality tiers apply to this primary.</p>'}</section>

  <section class="section" aria-labelledby="limitations-title"><h2 id="limitations-title">Limitations</h2><ul class="limitations">${limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join('')}</ul></section>
  <footer class="site-footer"><span>${escapeHtml(demo.id)} · ${escapeHtml(demo.sourceHash.slice(0, 19))}</span><span><a href="/evidence/">All evidence reports</a></span></footer>
</div></main>
</body>
</html>
`;
}

function indexHtml(models) {
  const accepted = models.filter(({ demo }) => demo.status === 'accepted').length;
  const description = `Index of ${models.length} source-hash-bound Three.js WebGPU lab evidence reports, including ${accepted} accepted contracts and explicit pending runtime proof.`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Three.js WebGPU evidence reports',
    description,
    url: `${SITE}evidence/`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: models.length,
      itemListElement: models.map(({ demo }, index) => ({
        '@type': 'ListItem', position: index + 1, name: demoTitle(demo), url: reportUrl(demo.id),
      })),
    },
  };
  return `${head({ title: 'Three.js WebGPU Evidence Reports', description, url: `${SITE}evidence/` })}
<script type="application/ld+json">${JSON.stringify(schema)}</script>
</head>
<body>
${nav()}
<main><div class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Skill Pack</a> / Evidence</nav>
  <h1>Evidence reports</h1>
  <p class="lede">${models.length} reports expose the current source hash, route contracts, claim verdicts, required proofs, promoted same-lab media, and explicit limitations. A report with no image shows no placeholder.</p>
  <dl class="facts"><div><dt>Primary reports</dt><dd>${models.length}</dd></div><div><dt>Accepted</dt><dd>${accepted}</dd></div><div><dt>Pending</dt><dd>${models.length - accepted}</dd></div><div><dt>Build revision</dt><dd><code>${escapeHtml(registry.buildRevision)}</code></dd></div></dl>
  <section class="section" aria-labelledby="reports-title"><h2 id="reports-title">Complete primary matrix</h2><div class="report-grid">${models.map(({ demo, media }) => `<a class="report-card" href="/${reportPath(demo.id)}"><header><code>${escapeHtml(demo.id)}</code><span class="status status--${demo.status === 'accepted' ? 'accepted' : 'incomplete'}">${escapeHtml(demo.status)}</span></header><h2>${escapeHtml(demoTitle(demo))}</h2><p>${escapeHtml(skillTitle(demo))}</p><footer>${demo.scenarios.length} scenarios · ${demo.mechanisms.length} mechanisms · ${demo.tiers.length} tiers · ${media.length} promoted images</footer></a>`).join('')}</div></section>
  <footer class="site-footer"><span>${models.length} source-hash-bound reports</span><span><a href="/about/">Acceptance method</a></span></footer>
</div></main>
</body>
</html>
`;
}

mkdirSync(OUTPUT, { recursive: true });
const models = primary.map(reportModel);
const reportRecords = [];
for (const model of models) {
  const directory = confined(join(OUTPUT, model.demo.id), OUTPUT);
  mkdirSync(directory, { recursive: true });
  const outputPath = join(directory, 'index.html');
  const html = reportHtml(model);
  writeFileSync(outputPath, html);
  reportRecords.push({
    labId: model.demo.id,
    path: reportPath(model.demo.id),
    status: model.demo.status,
    sourceHash: model.demo.sourceHash,
    publishedBundleHash: model.source.manifest.publishedBundleHash,
    evidenceBundleId: model.summary?.evidenceBundleId ?? model.demo.evidenceBundle ?? null,
    media: model.media.map((image) => ({
      file: image.file,
      outputSha256: image.outputSha256,
      classification: image.classification,
    })),
    htmlSha256: sha256(Buffer.from(html)),
  });
}
const index = indexHtml(models);
writeFileSync(join(OUTPUT, 'index.html'), index);

const outputManifest = {
  schemaVersion: 1,
  generatedBy: 'scripts/build-evidence-pages.mjs',
  buildRevision: registry.buildRevision,
  indexSha256: sha256(Buffer.from(index)),
  reports: reportRecords,
};
let prior = null;
if (existsSync(MANIFEST_PATH)) {
  prior = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}
const currentIds = new Set(reportRecords.map((record) => record.labId));
for (const record of prior?.reports ?? []) {
  if (currentIds.has(record.labId)) continue;
  const stale = confined(join(OUTPUT, record.labId, 'index.html'), OUTPUT);
  if (existsSync(stale) && statSync(stale).isFile()) unlinkSync(stale);
}
writeFileSync(MANIFEST_PATH, `${JSON.stringify(outputManifest, null, 2)}\n`);
console.log(`Built ${reportRecords.length} evidence reports and the evidence index.`);
