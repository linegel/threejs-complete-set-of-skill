#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
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
import { lockedRouteContract, plannedPublishedRoutes } from './lib/page-routes.mjs';
import { computePublishedBundleHash, publishedHashInputs } from './lib/published-pages.mjs';
import { labViteAliases } from './lib/vite-lab-config.mjs';

const SITE = 'https://threejs-skills.com/';
const SITE_NAME = 'Three.js WebGPU Skill Pack';
const REPOSITORY = 'https://github.com/linegel/threejs-complete-set-of-skill';
const SOCIAL_IMAGE = `${SITE}visual-validation/planet-generated-craters/final.design.png`;
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

function demoPreview(lab) {
  const candidates = [
    { path: `previews/primary/${lab.id}.png`, label: 'Canonical implementation screenshot; evidence status is reported separately' },
    { path: `visual-validation/${lab.id}/final.design.png`, label: 'Published render-target evidence or explicitly classified evidence preview' },
    { path: `previews/provider/${lab.id}.png`, label: 'Live concept-proxy screenshot; not canonical evidence' },
  ];
  const relatedProvider = registry.demos.find((entry) => (
    entry.skill === lab.skill
    && entry.status === 'secondary'
    && existsSync(join(REPO_ROOT, 'docs', 'previews', 'provider', `${entry.id}.png`))
  ));
  if (relatedProvider) {
    candidates.push({
      path: `previews/provider/${relatedProvider.id}.png`,
      label: 'Related skill concept-proxy screenshot; not evidence for this canonical lab',
    });
  }
  const selected = candidates.find((candidate) => (
    existsSync(join(REPO_ROOT, 'docs', candidate.path))
    && (!candidate.path.startsWith('previews/') || usablePreviewPaths.has(candidate.path))
  ));
  if (!selected) return {
    url: SOCIAL_IMAGE,
    width: 1200,
    height: 760,
    alt: `Generated crater-field asset preview from the ${SITE_NAME}; not evidence for ${demoTitle(lab)}`,
  };
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
        image: preview.url,
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
  <meta name="robots" content="${robots}">
  <link rel="canonical" href="${url}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/site.webmanifest">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="en_US">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${preview.url}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="${preview.width}">
  <meta property="og:image:height" content="${preview.height}">
  <meta property="og:image:alt" content="${escapeHtml(preview.alt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${preview.url}">
  <meta name="twitter:image:alt" content="${escapeHtml(preview.alt)}">
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
  <meta name="lab-${routeKind}" content="${routeId}">
  <meta name="description" content="Fixed ${routeKind} state for ${escapeHtml(demoTitle(lab))}; the canonical interactive demo contains the indexable content.">
  <meta name="robots" content="noindex, follow">
  <link rel="canonical" href="${canonicalUrl}">
  <title>${safeTitle}</title>
  <style>html,body,iframe{width:100%;height:100%;margin:0;border:0;background:#080b10;color:#ece8de}body{overflow:hidden}.route-blocker{box-sizing:border-box;max-width:760px;height:auto;margin:10vh auto;padding:28px;border:1px solid #ff6b6b;background:#111722;font:15px/1.55 system-ui,sans-serif}.route-blocker code{color:#ffb454}</style>
</head>
<body>
  <iframe id="canonical-lab" title="${safeTitle}" src="${canonicalHref}" allow="fullscreen"></iframe>
  <script type="module">
    const frame = document.querySelector('#canonical-lab');
    const startup = ${JSON.stringify(lockedStartup)};
    const setterCalls = ${JSON.stringify(lockedSetterCalls)};
    const routeKind = ${JSON.stringify(routeKind)};
    const routeId = ${JSON.stringify(routeId)};
    const acknowledgementKeys = ${JSON.stringify(acknowledgementKeys)};
    const startupAcknowledgementKeys = ${JSON.stringify(startupAcknowledgementKeys)};
    frame.addEventListener('load', async () => {
      try {
        const controller = await Promise.resolve(
          frame.contentWindow.labController
          ?? frame.contentWindow.__LAB_CONTROLLER__
          ?? frame.contentWindow.__labController
          ?? null
        );
        if (!controller) throw new Error('Canonical lab did not expose labController or __LAB_CONTROLLER__.');
        if (typeof controller.ready !== 'function') throw new Error('Canonical lab controller has no ready() method.');
        await controller.ready();
        for (const call of setterCalls) {
          if (typeof controller[call.setter] !== 'function') throw new Error('Canonical lab controller has no ' + call.setter + '() method.');
          await controller[call.setter](call.value);
        }
        if (typeof controller.renderOnce === 'function') await controller.renderOnce();
        if (typeof controller.getMetrics !== 'function') throw new Error('Canonical lab controller has no getMetrics() route acknowledgement.');
        const metrics = await controller.getMetrics();
        const nested = metrics?.routeSelection;
        const normalizeRouteValue = (value) => value && typeof value === 'object' ? (value.id ?? value.name ?? null) : value;
        const candidates = (keys, kind) => [
          ...keys.map((key) => metrics?.[key]),
          nested?.[kind],
          nested?.kind === kind ? nested.id : null
        ].map(normalizeRouteValue);
        const directAcknowledgement = candidates(acknowledgementKeys, routeKind).includes(routeId);
        const startupEntries = Object.entries(startup);
        const startupAcknowledged = startupEntries.every(([key, expected]) => (
          candidates(startupAcknowledgementKeys[key] ?? [], key).includes(expected)
        ));
        if (!startupAcknowledged) {
          throw new Error('Canonical lab setters did not apply every explicit locked startup value.');
        }
        if (!directAcknowledgement && startupEntries.length === 0) {
          throw new Error('Canonical lab did not acknowledge locked ' + routeKind + ' route "' + routeId + '" in getMetrics().');
        }
        window.labController = controller;
        window.dispatchEvent(new CustomEvent('lab-route-ready', { detail: { kind: ${JSON.stringify(routeKind)}, id: ${JSON.stringify(routeId)}, startup } }));
      } catch (error) {
        window.__LAB_ROUTE_ERROR__ = String(error?.stack ?? error);
        const message = String(error?.stack ?? error).replace(/[&<>]/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[character]));
        document.body.innerHTML = '<main class="route-blocker"><h1>Locked route failed</h1><p>This route cannot silently fall back to a default state.</p><pre><code>' + message + '</code></pre></main>';
      }
    });
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

const managedIds = new Set([
  ...bundledPrimary,
  ...placeholderPrimary,
  ...secondaryProviders,
].map((lab) => lab.id));
const previousIndexPath = join(docsDemos, 'index.json');
if (existsSync(previousIndexPath)) {
  try {
    const previous = JSON.parse(readFileSync(previousIndexPath, 'utf8'));
    for (const route of [...(previous.routes ?? []), ...(previous.pendingRoutes ?? []), ...(previous.secondaryRoutes ?? [])]) {
      if (/^[a-z0-9][a-z0-9-]*$/.test(route.id ?? '')) managedIds.add(route.id);
    }
  } catch {
    // A malformed old index is not trusted to nominate deletion paths.
  }
}
function installCompiledPages(compiledRoot) {
  for (const id of managedIds) rmSync(join(docsDemos, id), { recursive: true, force: true });
  rmSync(join(docsDemos, 'assets'), { recursive: true, force: true });
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
      const rewritten = injectDemoSeo(injectPrimaryClassification(
        normalizeHtmlDocument(rewriteEntryReferences(html, canonicalEntry, stagedEntry)),
        lab,
      ), lab);
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
      writeFileSync(stagedEntry, injectDemoSeo(providerHtml, lab));
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
        emptyOutDir: true,
        rollupOptions: { input: inputs },
      },
    });
    installCompiledPages(compiledRoot);
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
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
  writeFileSync(join(outputDir, 'index.html'), injectDemoSeo(placeholderHtml, lab, { indexable: false }));
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
