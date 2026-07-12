#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { build } from 'vite';
import {
  PRIMARY_DEMO_KINDS,
  REPO_ROOT,
  buildDemoRegistry,
  registryJson,
} from './lib/lab-registry.mjs';
import {
  LAB_CONTROLLER_GLOBALS,
  awaitLockedRouteController,
  lockedRouteContract,
  lockedRouteSelectionMatchesWithKeys,
  plannedPublishedRoutes,
} from './lib/page-routes.mjs';
import { computePublishedBundleHash, publishedHashInputs } from './lib/published-pages.mjs';
import { labViteAliases } from './lib/vite-lab-config.mjs';
import { buildDemoRoadmap } from './lib/demo-roadmap.mjs';

const SITE = 'https://threejs-skills.com/';
const SITE_NAME = 'Three.js WebGPU Skill Pack';
const REPOSITORY = 'https://github.com/linegel/threejs-complete-set-of-skill';
const runtimeEvidencePreviewConfig = JSON.parse(readFileSync(join(REPO_ROOT, 'labs', 'runtime-evidence-previews.json'), 'utf8'));
const configuredRuntimeEvidencePreviews = new Set(
  (runtimeEvidencePreviewConfig.previews ?? []).map((preview) => preview.labId),
);
const skillManifest = JSON.parse(readFileSync(join(REPO_ROOT, 'skills.json'), 'utf8'));
const skillsByName = new Map(skillManifest.skills.map((skill) => [skill.name, skill]));
const registry = buildDemoRegistry();
const previewManifestPath = join(REPO_ROOT, 'docs', 'previews', 'manifest.json');
const previewManifest = existsSync(previewManifestPath)
  ? JSON.parse(readFileSync(previewManifestPath, 'utf8'))
  : { results: [] };
const usablePreviewPaths = new Set((previewManifest.results ?? [])
  .filter((entry) => entry.verdict === 'PREVIEW_CAPTURED' && entry.image)
  .map((entry) => entry.image));
const publishedDemoTitles = new Map(skillManifest.skills.flatMap((skill) => [
  ...(skill.primaryImplementations ?? []),
  ...(skill.flagshipParticipation ?? []),
  ...(skill.demos ?? []),
].filter((demo) => demo.id && demo.title).map((demo) => [demo.id, demo.title])));

function posix(path) {
  return path.split(sep).join('/');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function normalizeHtmlDocument(html) {
  if (/<html\b/i.test(html)) {
    return /<html\b[^>]*\blang=/i.test(html)
      ? html
      : html.replace(/<html\b/i, '<html lang="en"');
  }
  const content = html.replace(/^\s*<!doctype html>\s*/i, '');
  const bodyStart = content.search(/<(?:body\b|canvas\b|main\b|section\b|div\b)/i);
  const head = bodyStart >= 0 ? content.slice(0, bodyStart) : content;
  let body = bodyStart >= 0 ? content.slice(bodyStart) : '';
  if (/^<body\b/i.test(body)) {
    body = body.replace(/^<body\b[^>]*>/i, '').replace(/<\/body>\s*$/i, '');
  }
  return `<!doctype html>\n<html lang="en">\n<head>\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

function humanize(value) {
  return String(value).split('-').map((word) => word.length <= 3 && /^(ao|gpu|gtao|hdr|lod|mrt|pbr|tsl|ui|webgpu)$/i.test(word)
    ? word.toUpperCase()
    : `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ');
}

function clipText(value, maxLength = 160) {
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength - 1);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, Math.max(lastSpace, maxLength - 24)).replace(/[,:;.!?\s-]+$/, '')}…`;
}

function demoTitle(lab) {
  return lab.title ?? publishedDemoTitles.get(lab.id) ?? humanize(lab.id);
}

function demoSearchTitle(lab) {
  const full = `${demoTitle(lab)} | Three.js WebGPU Demo`;
  const compact = `${demoTitle(lab)} | WebGPU Demo`;
  return full.length <= 60 ? full : (compact.length <= 60 ? compact : clipText(compact, 60));
}

function demoDescription(lab) {
  const skill = skillsByName.get(lab.skill);
  if (lab.status === 'secondary') {
    const classification = lab.kind === 'generated-asset-demo' ? 'generated asset preview' : 'concept demo';
    return clipText(`Interactive Three.js WebGPU ${classification} for ${skill?.title ?? humanize(lab.skill)}. ${lab.proxyStatus?.limitation ?? skill?.description ?? ''}`);
  }
  const countLabel = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
  const routeSummary = `${countLabel(lab.scenarios.length, 'scenario')}, ${countLabel(lab.mechanisms.length, 'mechanism')}, and ${countLabel(lab.tiers.length, 'quality tier')}`;
  return clipText(`Interactive Three.js WebGPU/TSL demo for ${demoTitle(lab)}, with ${routeSummary} and evidence-gated validation.`);
}

function demoEvidenceSummary(lab) {
  if (lab.status === 'accepted') {
    return 'Accepted runtime evidence is available for the published contract represented by this demo.';
  }
  if (lab.status === 'secondary') {
    return `This is a secondary presentation surface, not canonical runtime evidence. ${lab.proxyStatus?.limitation ?? ''}`.trim();
  }
  if (lab.status === 'blocked') {
    return 'The implementation is blocked from accepted coverage until its declared runtime and evidence gates pass.';
  }
  return 'The implementation is available for technical review, but its native-WebGPU runtime and evidence gates remain incomplete.';
}

function transformStaticMarkup(html, transform) {
  return html.split(/(<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>)/gi)
    .map((chunk, index) => index % 2 === 0 ? transform(chunk) : chunk)
    .join('');
}

function staticMarkup(html) {
  return html.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '');
}

function normalizeStaticDemoHeadings(html, lab) {
  const title = escapeHtml(demoTitle(lab));
  let output = transformStaticMarkup(html, (markup) => markup.replace(
    /<main([^>]*)>\s*<\/main>/i,
    `<main$1><h1 class="demo-static-title">${title}</h1><p class="demo-static-loading">Interactive demonstration loading…</p></main>`,
  ));
  let headingCount = 0;
  output = transformStaticMarkup(output, (markup) => markup.replace(
    /<h1([^>]*)>([\s\S]*?)<\/h1>/gi,
    (_match, attributes, body) => {
      headingCount += 1;
      const content = body.replace(/<[^>]+>/g, '').trim() ? body : title;
      return headingCount === 1
        ? `<h1${attributes}>${content}</h1>`
        : `<h2${attributes}>${content}</h2>`;
    },
  ));
  return { html: output, hasH1: headingCount > 0 };
}

function demoSeoShell(lab, { hasH1, hasMain }) {
  const root = hasMain ? 'aside' : 'main';
  const titleTag = hasH1 ? 'h2' : 'h1';
  const sectionTag = hasH1 ? 'h3' : 'h2';
  const skill = skillsByName.get(lab.skill);
  const mechanisms = lab.mechanisms.length
    ? [
      ...lab.mechanisms.slice(0, 6).map((entry) => `<li><code>${escapeHtml(entry.id)}</code> — ${escapeHtml(humanize(entry.id))}</li>`),
      ...(lab.mechanisms.length > 6 ? [`<li>${lab.mechanisms.length - 6} additional mechanisms are listed in the registry.</li>`] : []),
    ]
    : [`<li>${escapeHtml(lab.kind === 'generated-asset-demo' ? 'Generated asset presentation and provenance review.' : 'Interactive presentation linked to the owning production skill contract.')}</li>`];
  const canonicalLabLink = lab.proxyStatus?.canonicalLabId
    ? `<a href="../${escapeHtml(lab.proxyStatus.canonicalLabId)}/">Canonical lab</a>`
    : '';
  const links = [
    `<a href="../../skills/${escapeHtml(lab.skill)}.html">Owning skill</a>`,
    canonicalLabLink,
    '<a href="../registry.json">Demo registry</a>',
    `<a href="${REPOSITORY}/tree/main/${escapeHtml(lab.skill)}">Source repository</a>`,
  ].filter(Boolean).join('');
  const roadmap = buildDemoRoadmap(lab);
  const roadmapItems = roadmap.items.length > 0
    ? roadmap.items.map((item) => `<li data-roadmap-item data-priority="${escapeHtml(item.priority)}" data-category="${escapeHtml(item.category)}">
          <div><span>${escapeHtml(item.priority)}</span><strong>${escapeHtml(item.title)}</strong></div>
          <p>${escapeHtml(item.detail)}</p>
          <code>${escapeHtml(item.source)}</code>
        </li>`).join('')
    : '<li data-roadmap-item data-priority="done" data-category="accepted"><div><span>DONE</span><strong>No open acceptance gates</strong></div><p>The declared published contract is accepted.</p><code>status.accepted</code></li>';
  return `<${root} class="demo-seo-shell" data-demo-seo-shell data-demo-id="${escapeHtml(lab.id)}" data-owning-skill="${escapeHtml(lab.skill)}">
  <details open>
    <summary>About this WebGPU demo</summary>
    <div class="demo-seo-shell__body">
      <p class="demo-seo-shell__kicker">${escapeHtml(humanize(lab.kind))} · Three.js ${escapeHtml(lab.threeRevision)}</p>
      <${titleTag}>${escapeHtml(demoTitle(lab))}</${titleTag}>
      <p>${escapeHtml(demoDescription(lab))}</p>
      <p class="demo-seo-shell__evidence"><strong>Evidence status:</strong> ${escapeHtml(demoEvidenceSummary(lab))}</p>
      <details class="demo-roadmap" data-demo-roadmap data-roadmap-status="${escapeHtml(roadmap.status)}" data-open-count="${roadmap.items.length}">
        <summary>Readiness &amp; remaining fixes <span>${roadmap.items.length}</span></summary>
        <div class="demo-roadmap__body">
          <p>${escapeHtml(roadmap.summary)}</p>
          <ol>${roadmapItems}</ol>
        </div>
      </details>
      <p>Use the linked skill, registry, and source to inspect route ownership and evidence classification before treating this presentation as an accepted implementation.</p>
      <dl>
        <div><dt>Owning skill</dt><dd>${escapeHtml(skill?.title ?? humanize(lab.skill))}</dd></div>
        <div><dt>Published routes</dt><dd>${lab.scenarios.length} scenarios · ${lab.mechanisms.length} mechanisms · ${lab.tiers.length} quality tiers</dd></div>
      </dl>
      <${sectionTag}>Supported mechanisms</${sectionTag}>
      <ul data-demo-mechanisms>${mechanisms.join('')}</ul>
      <nav aria-label="Demo documentation and provenance">${links}</nav>
    </div>
  </details>
</${root}>`;
}

function injectDemoSeoShell(html, lab) {
  const normalized = normalizeStaticDemoHeadings(html, lab);
  const hasMain = /<main\b/i.test(staticMarkup(normalized.html));
  const shell = demoSeoShell(lab, { hasH1: normalized.hasH1, hasMain });
  const styles = `<style data-demo-seo-shell-style>
.demo-seo-shell{position:fixed;z-index:2147483000;left:12px;bottom:12px;display:block;box-sizing:border-box;width:min(460px,calc(100vw - 24px));max-height:min(64vh,640px);margin:0;color:#f3efe6;background:rgba(8,11,16,.94);border-radius:20px;box-shadow:0 0 0 1px rgba(255,255,255,.1),0 18px 60px rgba(0,0,0,.42);font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;backdrop-filter:blur(18px) saturate(1.15);overflow:auto}.demo-seo-shell *{box-sizing:border-box}.demo-seo-shell details{margin:0}.demo-seo-shell summary{min-height:44px;display:flex;align-items:center;padding:10px 16px;cursor:pointer;color:#ffca80;font-weight:700;text-wrap:balance;list-style:none;transition-property:color,background-color,scale;transition-duration:160ms;transition-timing-function:cubic-bezier(.2,0,0,1)}.demo-seo-shell summary::-webkit-details-marker{display:none}.demo-seo-shell summary:after{content:"+";margin-left:auto;font:700 18px/1 ui-monospace,monospace}.demo-seo-shell>details[open]>summary:after,.demo-roadmap[open]>summary:after{content:"−"}.demo-seo-shell summary:hover{color:#fff;background:rgba(255,255,255,.045)}.demo-seo-shell summary:active{scale:.96}.demo-seo-shell summary:focus-visible,.demo-seo-shell a:focus-visible{outline:2px solid #7fd4c1;outline-offset:-3px}.demo-seo-shell__body{padding:2px 16px 16px}.demo-seo-shell h1,.demo-seo-shell h2,.demo-seo-shell h3{margin:0 0 8px;color:#fff;line-height:1.14;text-wrap:balance}.demo-seo-shell h1,.demo-seo-shell h2{font-size:clamp(21px,4vw,29px)}.demo-seo-shell h3{margin-top:15px;font-size:15px;color:#ffca80}.demo-seo-shell p,.demo-seo-shell li,.demo-seo-shell dd{margin:0;text-wrap:pretty}.demo-seo-shell p+p{margin-top:9px}.demo-seo-shell strong{color:#ffca80;font:inherit;font-weight:750}.demo-seo-shell__kicker{margin-bottom:7px!important;color:#7fd4c1;font:600 10px/1.4 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}.demo-seo-shell__evidence{color:#d6d0c4}.demo-seo-shell dl{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0 0}.demo-seo-shell dl div{min-width:0;padding:9px 10px;border-radius:12px;background:rgba(255,255,255,.045);box-shadow:0 0 0 1px rgba(255,255,255,.07)}.demo-seo-shell dt{color:#9a988f;font:600 9px/1.35 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase}.demo-seo-shell dd{margin-top:3px;color:#f3efe6;font-size:12px}.demo-seo-shell ul{display:grid;gap:4px;margin:0;padding-left:18px;color:#d6d0c4}.demo-seo-shell code{color:#7fd4c1;font:600 11px/1.4 ui-monospace,monospace}.demo-roadmap{margin:14px 0!important;border-radius:14px;background:rgba(255,180,84,.055);box-shadow:0 0 0 1px rgba(255,180,84,.18)}.demo-roadmap>summary{padding:10px 12px!important;color:#fff!important}.demo-roadmap>summary span{margin-left:auto;margin-right:10px;min-width:24px;padding:3px 7px;border-radius:999px;color:#08110e;background:#ffca80;text-align:center;font:800 10px/1 ui-monospace,monospace}.demo-roadmap__body{padding:0 12px 12px}.demo-roadmap__body>p{color:#d6d0c4;font-size:12px}.demo-roadmap ol{display:grid;gap:7px;margin:10px 0 0;padding:0;list-style:none}.demo-roadmap li{padding:9px 10px;border-radius:10px;background:rgba(0,0,0,.22);box-shadow:0 0 0 1px rgba(255,255,255,.06)}.demo-roadmap li div{display:flex;gap:8px;align-items:center}.demo-roadmap li div span{flex:none;padding:3px 5px;border-radius:5px;color:#08110e;background:#ffca80;font:800 9px/1 ui-monospace,monospace}.demo-roadmap li[data-priority="P1"] div span{background:#7fd4c1}.demo-roadmap li[data-priority="P2"] div span{background:#a9b6ff}.demo-roadmap li[data-priority="done"] div span{background:#79f0b3}.demo-roadmap li strong{color:#fff;font-size:12px}.demo-roadmap li p{margin-top:5px;color:#c5c0b6;font-size:11px;line-height:1.45}.demo-roadmap li code{display:block;margin-top:5px;color:#8caea6;font-size:9px}.demo-seo-shell nav{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.demo-seo-shell a{min-height:40px;display:inline-flex;align-items:center;padding:8px 11px;border-radius:10px;color:#f3efe6;background:rgba(127,212,193,.08);box-shadow:0 0 0 1px rgba(127,212,193,.2);text-decoration:none;font-weight:650;transition-property:color,background-color,box-shadow,scale;transition-duration:160ms;transition-timing-function:cubic-bezier(.2,0,0,1)}.demo-seo-shell a:hover{color:#fff;background:rgba(127,212,193,.16);box-shadow:0 0 0 1px rgba(127,212,193,.36)}.demo-seo-shell a:active{scale:.96}@media(max-width:560px){.demo-seo-shell{max-height:58vh}.demo-seo-shell dl{grid-template-columns:1fr}.demo-seo-shell__body{padding-inline:14px}}@media(prefers-reduced-motion:reduce){.demo-seo-shell summary,.demo-seo-shell a{transition-duration:0ms}}
</style>`;
  return normalized.html
    .replace('</head>', `  ${styles}\n</head>`)
    .replace(/<body([^>]*)>/i, `<body$1>\n${shell}`);
}

function pngDimensions(path) {
  try {
    const data = readFileSync(path);
    if (data.length >= 24 && data.toString('ascii', 1, 4) === 'PNG') {
      return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    }
  } catch {
    // The generic social image remains available when a preview has not been captured.
  }
  return null;
}

function runtimeEvidencePreview(lab) {
  if (!configuredRuntimeEvidencePreviews.has(lab.id)) return null;
  const summaryPath = join(REPO_ROOT, 'docs', 'visual-validation', lab.id, 'evidence-summary.json');
  if (!existsSync(summaryPath)) return null;
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  if (
    summary.schemaVersion !== 1
    || summary.labId !== lab.id
    || summary.classification !== 'inspected-runtime-evidence-preview'
    || summary.acceptanceStatus !== lab.status
    || summary.canonicalSourceHash !== lab.sourceHash
    || summary.runtime?.isWebGPUBackend !== true
  ) throw new Error(`Runtime evidence preview summary is invalid or stale for ${lab.id}`);
  const image = summary.images?.find((entry) => entry.file === summary.primaryImage);
  if (!image) throw new Error(`Runtime evidence preview has no declared primary image for ${lab.id}`);
  return {
    path: `visual-validation/${lab.id}/${image.file}`,
    label: summary.primaryImageLabel,
  };
}

function demoPreview(lab) {
  const runtimeEvidence = runtimeEvidencePreview(lab);
  const candidates = [
    ...(runtimeEvidence ? [runtimeEvidence] : []),
    ...(lab.nonRenderingScenarioSuite
      ? [{ path: `previews/primary/${lab.id}.png`, label: 'Deterministic contract-lab screenshot; runtime evidence status is reported separately' }]
      : []),
    ...(lab.status === 'secondary'
      ? [{ path: `previews/provider/${lab.id}.png`, label: 'Same-demo secondary presentation screenshot; not canonical evidence' }]
      : []),
  ];
  const selected = candidates.find((candidate) => (
    existsSync(join(REPO_ROOT, 'docs', candidate.path))
    && (!candidate.path.startsWith('previews/') || usablePreviewPaths.has(candidate.path))
  ));
  if (!selected) return null;
  const dimensions = pngDimensions(join(REPO_ROOT, 'docs', selected.path)) ?? { width: 1200, height: 760 };
  return {
    url: `${SITE}${selected.path}`,
    ...dimensions,
    alt: `${selected.label} — ${demoTitle(lab)}`,
  };
}

function demoSeoHead(lab, { indexable = true } = {}) {
  const title = demoSearchTitle(lab);
  const description = demoDescription(lab);
  const url = `${SITE}${lab.publishPath.replace(/^\//, '')}`;
  const skill = skillsByName.get(lab.skill);
  const skillUrl = `${SITE}skills/${lab.skill}.html`;
  const preview = demoPreview(lab);
  const canonicalUrl = indexable ? url : skillUrl;
  const robots = indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow';
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        '@id': `${url}#demo`,
        name: demoTitle(lab),
        description,
        url,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Any WebGPU-capable environment',
        browserRequirements: 'WebGPU-capable browser',
        softwareVersion: `Three.js ${lab.threeRevision}`,
        isAccessibleForFree: true,
        inLanguage: 'en',
        ...(preview ? { image: preview.url } : {}),
        about: ['Three.js', 'WebGPU', 'TSL', skill?.title ?? humanize(lab.skill)],
        isPartOf: {
          '@type': 'SoftwareSourceCode',
          '@id': `${SITE}#software`,
          name: SITE_NAME,
          codeRepository: REPOSITORY,
          url: SITE,
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: SITE_NAME, item: SITE },
          { '@type': 'ListItem', position: 2, name: skill?.title ?? humanize(lab.skill), item: skillUrl },
          { '@type': 'ListItem', position: 3, name: demoTitle(lab), item: url },
        ],
      },
    ],
  };
  return `<meta name="description" content="${escapeHtml(description)}">
  <meta name="author" content="${SITE_NAME} contributors">
  <meta name="owning-skill" content="${escapeHtml(lab.skill)}">
  <meta name="robots" content="${robots}">
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/site.webmanifest">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="en_US">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonicalUrl}">
${preview ? `  <meta property="og:image" content="${preview.url}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="${preview.width}">
  <meta property="og:image:height" content="${preview.height}">
  <meta property="og:image:alt" content="${escapeHtml(preview.alt)}">` : ''}
  <meta name="twitter:card" content="${preview ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
${preview ? `  <meta name="twitter:image" content="${preview.url}">
  <meta name="twitter:image:alt" content="${escapeHtml(preview.alt)}">` : ''}
  <script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

function injectDemoSeo(html, lab, options) {
  const title = escapeHtml(demoSearchTitle(lab));
  let output = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  if (!/<title>[\s\S]*?<\/title>/i.test(output)) {
    output = output.replace(/<head([^>]*)>/i, `<head$1>\n  <title>${title}</title>`);
  }
  return output.replace('</head>', `  ${demoSeoHead(lab, options)}\n</head>`);
}

function rewriteEntryReferences(html, canonicalEntry, stagedEntry) {
  const canonicalDir = dirname(canonicalEntry);
  const stagedDir = dirname(stagedEntry);
  const rewriteValue = (value) => {
    const [path, suffix = ''] = value.split(/(?=[?#])/ , 2);
    const absolute = resolve(canonicalDir, path);
    let rewritten = posix(relative(stagedDir, absolute));
    if (!rewritten.startsWith('.')) rewritten = `./${rewritten}`;
    return `${rewritten}${suffix}`;
  };
  const attributes = html.replace(/\b(src|href)=(['"])([^'"]+)\2/g, (match, attribute, quote, value) => {
    if (!value.startsWith('./') && !value.startsWith('../')) return match;
    return `${attribute}=${quote}${rewriteValue(value)}${quote}`;
  });
  const staticImports = attributes.replace(/\b(from\s*|import\s*)(['"])(\.\.?\/[^'"]+)\2/g, (match, prefix, quote, value) => (
    `${prefix}${quote}${rewriteValue(value)}${quote}`
  ));
  return staticImports.replace(/\bimport\(\s*(['"])(\.\.?\/[^'"]+)\1\s*\)/g, (match, quote, value) => (
    `import(${quote}${rewriteValue(value)}${quote})`
  ));
}

function injectPrimaryClassification(html, lab) {
  const statusStyle = '<style>.lab-status-banner{position:fixed;z-index:2147483647;top:10px;left:50%;transform:translateX(-50%);max-width:min(800px,calc(100vw - 20px));padding:8px 12px;border:1px solid #ffb454;background:rgba(8,11,16,.95);color:#f7e7c5;font:600 12px/1.4 ui-monospace,monospace}.lab-status-banner a{color:#7fd4c1}</style>';
  let output = html.replace(
    '</head>',
    `  <meta name="lab-id" content="${lab.id}">\n  <meta name="acceptance-status" content="${lab.status}">\n${lab.status === 'accepted' ? '' : `  ${statusStyle}\n`}</head>`,
  );
  if (lab.status !== 'accepted') {
    const label = lab.status === 'blocked' ? 'blocked' : 'incomplete';
    output = output.replace(
      /<body([^>]*)>/i,
      `<body$1><aside class="lab-status-banner"><strong>Canonical lab ${label}.</strong> This implementation is loadable for review, but it is excluded from accepted coverage until native-WebGPU runtime and v2 evidence gates pass. <a href="../registry.json">Registry</a>.</aside>`,
    );
  }
  return output;
}

function metadataFor(lab, registry, published) {
  return {
    schemaVersion: 2,
    labId: lab.id,
    kind: lab.kind,
    status: lab.status,
    canonicalSource: lab.canonicalSource,
    sourceHashInputs: lab.sourceHashInputs,
    browserEntry: lab.browserEntry,
    sourceHash: lab.sourceHash,
    publishedHashInputs: published.inputs,
    publishedBundleHash: published.hash,
    threeRevision: lab.threeRevision,
    buildRevision: registry.buildRevision,
    evidenceBundleId: lab.evidenceBundle ? basename(lab.evidenceBundle) : null,
  };
}

function routeWrapper({ lab, routeKind, routeId, startup, canonicalDir }) {
  const wrapperDir = join(canonicalDir, routeKind, ...routeId.split('/'));
  mkdirSync(wrapperDir, { recursive: true });
  let canonicalHref = posix(relative(wrapperDir, canonicalDir));
  const routeContract = lockedRouteContract({
    kind: routeKind,
    id: routeId,
    startup,
    labId: lab.id,
  });
  canonicalHref = `${canonicalHref || '.'}/${routeContract.query}`;
  const title = `${lab.title ?? lab.id} — ${routeKind} ${routeId}`;
  const safeTitle = escapeHtml(title);
  const canonicalUrl = `${SITE}${lab.publishPath.replace(/^\//, '')}`;
  const lockedStartup = routeContract.startup;
  const lockedSetterCalls = routeContract.setterCalls;
  const acknowledgementKeys = routeContract.acknowledgementKeys;
  const startupAcknowledgementKeys = routeContract.startupAcknowledgementKeys;
  writeFileSync(join(wrapperDir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="lab-id" content="${escapeHtml(lab.id)}">
  <meta name="lab-${escapeHtml(routeKind)}" content="${escapeHtml(routeId)}">
  <meta name="description" content="Fixed ${routeKind} state for ${escapeHtml(demoTitle(lab))}; the canonical interactive demo contains the indexable content.">
  <meta name="robots" content="noindex, follow">
  <link rel="canonical" href="${canonicalUrl}">
  <title>${safeTitle}</title>
  <style>html,body,iframe{width:100%;height:100%;margin:0;border:0;background:#080b10;color:#ece8de}body{overflow:hidden}.route-blocker{box-sizing:border-box;max-width:760px;height:auto;margin:10vh auto;padding:28px;border:1px solid #ff6b6b;background:#111722;font:15px/1.55 system-ui,sans-serif}.route-blocker code{color:#ffb454}</style>
</head>
<body>
  <iframe id="canonical-lab" title="${safeTitle}" allow="fullscreen"></iframe>
  <script type="module">
    const frame = document.querySelector('#canonical-lab');
    const canonicalHref = ${JSON.stringify(canonicalHref)};
    const startup = ${JSON.stringify(lockedStartup)};
    const setterCalls = ${JSON.stringify(lockedSetterCalls)};
    const routeKind = ${JSON.stringify(routeKind)};
    const routeId = ${JSON.stringify(routeId)};
    const acknowledgementKeys = ${JSON.stringify(acknowledgementKeys)};
    const startupAcknowledgementKeys = ${JSON.stringify(startupAcknowledgementKeys)};
    const controllerGlobals = ${JSON.stringify(LAB_CONTROLLER_GLOBALS)};
    const awaitLockedRouteController = ${awaitLockedRouteController.toString()};
    const lockedRouteSelectionMatchesWithKeys = ${lockedRouteSelectionMatchesWithKeys.toString()};
    let routeInitializationStarted = false;
    frame.addEventListener('load', async () => {
      if (routeInitializationStarted) return;
      routeInitializationStarted = true;
      try {
        const controller = await awaitLockedRouteController(
          () => {
            for (const name of controllerGlobals) {
              const candidate = frame.contentWindow[name];
              if (candidate !== undefined && candidate !== null) return candidate;
            }
            return null;
          },
          {
            controllerGlobals,
            resolveBlocker: () => (
              frame.contentWindow.__LAB_ERROR__
              ?? frame.contentWindow.__labError
              ?? frame.contentWindow.__lab?.error
              ?? null
            ),
          },
        );
        if (typeof controller.ready !== 'function') throw new Error('Canonical lab controller has no ready() method.');
        await controller.ready();
        for (const call of setterCalls) {
          if (typeof controller[call.setter] !== 'function') throw new Error('Canonical lab controller has no ' + call.setter + '() method.');
          await controller[call.setter](call.value);
        }
        if (typeof controller.renderOnce === 'function') await controller.renderOnce();
        if (typeof controller.getMetrics !== 'function') throw new Error('Canonical lab controller has no getMetrics() route acknowledgement.');
        const metrics = await controller.getMetrics();
        if (!lockedRouteSelectionMatchesWithKeys(
          metrics,
          routeKind,
          routeId,
          startup,
          acknowledgementKeys,
          startupAcknowledgementKeys,
        )) {
          throw new Error('Canonical lab did not acknowledge locked ' + routeKind + ' route "' + routeId + '" and every explicit startup value in getMetrics().');
        }
        window.labController = controller;
        window.dispatchEvent(new CustomEvent('lab-route-ready', { detail: { kind: ${JSON.stringify(routeKind)}, id: ${JSON.stringify(routeId)}, startup } }));
      } catch (error) {
        window.__LAB_ROUTE_ERROR__ = String(error?.stack ?? error);
        const message = String(error?.stack ?? error).replace(/[&<>]/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[character]));
        document.body.innerHTML = '<main class="route-blocker"><h1>Locked route failed</h1><p>This route cannot silently fall back to a default state.</p><pre><code>' + message + '</code></pre></main>';
      }
    });
    frame.src = canonicalHref;
  </script>
</body>
</html>
`);
}

const docsDemos = join(REPO_ROOT, 'docs', 'demos');
mkdirSync(docsDemos, { recursive: true });

const bundledPrimary = registry.demos.filter((lab) => (
  PRIMARY_DEMO_KINDS.includes(lab.kind)
  && lab.browserEntry
  && existsSync(join(REPO_ROOT, lab.browserEntry))
));
const placeholderPrimary = registry.demos.filter((lab) => (
  PRIMARY_DEMO_KINDS.includes(lab.kind)
  && ['incomplete', 'blocked'].includes(lab.status)
  && (!lab.browserEntry || !existsSync(join(REPO_ROOT, lab.browserEntry)))
));
const secondaryProviders = registry.demos.filter((lab) => (
  ['proxy-demo', 'generated-asset-demo'].includes(lab.kind)
  && lab.status === 'secondary'
  && lab.publishPath
));
const plannedRoutesByLab = new Map(bundledPrimary.map((lab) => [lab.id, plannedPublishedRoutes(lab)]));

function installCompiledPages(compiledRoot) {
  if (compiledRoot) {
    for (const entry of readdirSync(compiledRoot, { withFileTypes: true })) {
      cpSync(join(compiledRoot, entry.name), join(docsDemos, entry.name), { recursive: true });
    }
  }
  writeFileSync(join(docsDemos, 'registry.json'), registryJson(registry));
}

if (bundledPrimary.length + secondaryProviders.length > 0) {
  // Vite canonicalizes macOS /var to /private/var. Use the same real path for
  // both root and Rollup inputs so emitted HTML names stay root-relative.
  const stagingRoot = realpathSync(mkdtempSync(join(tmpdir(), 'threejs-lab-pages-')));
  try {
    const compiledRoot = join(stagingRoot, '__compiled');
    const inputs = [];
    for (const lab of bundledPrimary) {
      const canonicalEntry = join(REPO_ROOT, lab.browserEntry);
      const stagedDir = join(stagingRoot, lab.id);
      const stagedEntry = join(stagedDir, 'index.html');
      mkdirSync(stagedDir, { recursive: true });
      const html = readFileSync(canonicalEntry, 'utf8');
      const rewritten = injectDemoSeoShell(injectDemoSeo(injectPrimaryClassification(
        normalizeHtmlDocument(rewriteEntryReferences(html, canonicalEntry, stagedEntry)),
        lab,
      ), lab), lab);
      writeFileSync(stagedEntry, rewritten);
      inputs.push(stagedEntry);
    }
    for (const lab of secondaryProviders) {
      const stagedDir = join(stagingRoot, lab.id);
      const stagedEntry = join(stagedDir, 'index.html');
      mkdirSync(stagedDir, { recursive: true });
      cpSync(join(REPO_ROOT, 'labs', 'provider-proxies'), stagedDir, { recursive: true });
      const classification = lab.kind === 'generated-asset-demo' ? 'Generated asset preview' : 'Concept proxy';
      const canonicalHref = lab.proxyStatus?.canonicalLabId
        ? `../${lab.proxyStatus.canonicalLabId}/`
        : `../../skills/${lab.skill}.html`;
      const providerHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="demo-kind" content="${lab.kind}">
  <title>${escapeHtml(lab.title ?? lab.id)}</title>
  <link rel="stylesheet" href="./provider-demo.css">
  <style>.classification-banner{position:fixed;z-index:20;top:12px;left:50%;transform:translateX(-50%);max-width:min(760px,calc(100vw - 24px));padding:8px 12px;border:1px solid #ffb454;background:rgba(8,11,16,.94);color:#f7e7c5;font:600 12px/1.4 ui-monospace,monospace}.classification-banner a{color:#7fd4c1}</style>
</head>
<body data-demo="${lab.id}" data-demo-kind="${lab.kind}">
  <aside class="classification-banner"><strong>${classification}.</strong> ${escapeHtml(lab.proxyStatus?.limitation ?? 'Secondary surface; not canonical evidence.')} <a href="${canonicalHref}">Canonical lab or contract</a>.</aside>
  <main>
    <canvas id="demo-canvas"></canvas>
    <section class="hud">
      <div class="panel"><p class="meta" id="demo-skill"></p><h1 class="title" id="demo-title"></h1><p class="claim" id="demo-claim"></p><div class="controls" id="demo-controls"></div></div>
      <div class="panel"><p class="status" id="demo-status">Initializing WebGPU...</p><p class="links"><a id="demo-evidence" href="${canonicalHref}">Canonical lab or contract</a></p></div>
    </section>
  </main>
  <script type="module" src="./provider-demo.mjs"></script>
</body>
</html>
`;
      writeFileSync(stagedEntry, injectDemoSeoShell(injectDemoSeo(providerHtml, lab), lab));
      inputs.push(stagedEntry);
    }

    await build({
      root: stagingRoot,
      base: './',
      logLevel: 'warn',
      resolve: {
        alias: labViteAliases(REPO_ROOT),
      },
      build: {
        outDir: compiledRoot,
        emptyOutDir: false,
        rollupOptions: { input: inputs },
      },
    });
    installCompiledPages(compiledRoot);
  } finally {
    console.log(`Retained non-destructive staging output at ${stagingRoot}.`);
  }
} else {
  installCompiledPages(null);
}

for (const lab of bundledPrimary) {
  const outputDir = join(docsDemos, lab.id);
  if (!existsSync(join(outputDir, 'index.html'))) {
    throw new Error(`Vite did not emit the canonical route for ${lab.id}`);
  }
  for (const route of plannedRoutesByLab.get(lab.id)) {
    routeWrapper({ lab, routeKind: route.kind, routeId: route.id, startup: route.startup, canonicalDir: outputDir });
  }
}

for (const lab of secondaryProviders) {
  const outputDir = join(docsDemos, lab.id);
  if (!existsSync(join(outputDir, 'index.html'))) {
    throw new Error(`Vite did not emit the classified provider route for ${lab.id}`);
  }
}

for (const lab of placeholderPrimary) {
  const outputDir = join(docsDemos, lab.id);
  mkdirSync(outputDir, { recursive: true });
  const statusLabel = lab.status === 'blocked' ? 'blocked' : 'incomplete';
  const sources = lab.canonicalSource.map((source) => `<li><code>${escapeHtml(source)}</code></li>`).join('');
  const placeholderHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="demo-kind" content="${lab.kind}"><meta name="acceptance-status" content="${lab.status}"><title>${escapeHtml(lab.title ?? lab.id)} — ${statusLabel}</title><style>body{margin:0;background:#080b10;color:#ece8de;font:16px/1.6 system-ui,sans-serif}.wrap{max-width:760px;margin:10vh auto;padding:32px;border:1px solid #353a46;background:#0f131b}h1{font-size:clamp(28px,6vw,52px);line-height:1.05}strong{color:#ffb454}code{color:#7fd4c1}a{color:#7fd4c1}</style></head><body><main class="wrap"><p><strong>Canonical lab ${statusLabel}.</strong></p><h1>${escapeHtml(lab.title ?? lab.id)}</h1><p>This route is reserved by the schema-v2 completion matrix, but it is not accepted runtime evidence. It remains excluded from primary completion counts until native-WebGPU execution, aligned readback, v2 artifacts, lifecycle validation, and source-hash equivalence pass.</p><h2>Canonical source</h2><ul>${sources}</ul><p><a href="../../skills/${lab.skill}.html">Read the owning skill contract</a> · <a href="../registry.json">Inspect the demo registry</a></p></main></body></html>\n`;
  writeFileSync(join(outputDir, 'index.html'), injectDemoSeoShell(injectDemoSeo(placeholderHtml, lab, { indexable: false }), lab));
}

const publishedById = new Map();
for (const lab of [...bundledPrimary, ...secondaryProviders, ...placeholderPrimary]) {
  const inputs = publishedHashInputs(REPO_ROOT, lab.id);
  const published = { inputs, hash: computePublishedBundleHash(REPO_ROOT, inputs) };
  if (!published.hash) throw new Error(`published output for ${lab.id} is empty`);
  publishedById.set(lab.id, published);
  writeFileSync(
    join(docsDemos, lab.id, 'source-manifest.json'),
    `${JSON.stringify(metadataFor(lab, registry, published), null, 2)}\n`,
  );
}

const index = {
  schemaVersion: 2,
  threeRevision: '0.185.1',
  buildRevision: registry.buildRevision,
  routes: bundledPrimary.map((lab) => ({
    id: lab.id,
    path: lab.publishPath,
    status: lab.status,
    sourceHash: lab.sourceHash,
    sourceHashInputs: lab.sourceHashInputs,
    publishedBundleHash: publishedById.get(lab.id).hash,
    mechanisms: lab.mechanisms.map((entry) => `${lab.publishPath}mechanism/${entry.id}/`),
    tiers: lab.tiers.map((entry) => `${lab.publishPath}tier/${entry.id}/`),
    scenarios: lab.scenarios.map((entry) => `${lab.publishPath}scenario/${entry.id}/`),
  })),
  secondaryRoutes: secondaryProviders.map((lab) => ({
    id: lab.id,
    path: lab.publishPath,
    kind: lab.kind,
    canonicalLabId: lab.proxyStatus?.canonicalLabId ?? null,
    sourceHash: lab.sourceHash,
    sourceHashInputs: lab.sourceHashInputs,
    publishedBundleHash: publishedById.get(lab.id).hash,
  })),
  pendingRoutes: placeholderPrimary.map((lab) => ({
    id: lab.id,
    path: lab.publishPath,
    kind: lab.kind,
    status: lab.status,
    sourceHash: lab.sourceHash,
    sourceHashInputs: lab.sourceHashInputs,
    publishedBundleHash: publishedById.get(lab.id).hash,
  })),
};
writeFileSync(join(docsDemos, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`Built ${bundledPrimary.length} loadable primary, ${placeholderPrimary.length} placeholder primary, and ${secondaryProviders.length} classified secondary route(s) from local sources.`);
