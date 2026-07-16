import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const REQUIRED = [
  'kind', 'slug', 'title', 'description', 'h1', 'primary_query', 'query_aliases', 'summary',
  'related_skills', 'related_demos', 'related_pages', 'published', 'last_reviewed', 'sources',
];
const FAQ_FIELDS = [
  'question_source_type', 'question_sources', 'first_observed', 'last_observed',
  'canonical_route', 'evidence_status', 'faq_group',
];
const FIELDS = new Set([...REQUIRED, ...FAQ_FIELDS, 'hero_image', 'hero_source', 'subjects', 'supported_revision']);
const KINDS = new Set([
  'hub', 'audience', 'ecosystem-comparison', 'technical-comparison', 'alternatives', 'pricing',
  'user-doc', 'agent-doc', 'migration', 'industry', 'faq-answer',
]);
const LEAF_KINDS = {
  for: ['audience'],
  compare: ['ecosystem-comparison', 'technical-comparison'],
  alternatives: ['alternatives'],
  docs: ['user-doc'],
  agents: ['agent-doc'],
  migrate: ['migration'],
  industries: ['industry'],
  faq: ['faq-answer'],
};
const FAMILY_ORDER = ['guides', 'for', 'compare', 'alternatives', 'pricing', 'docs', 'agents', 'migrate', 'industries', 'faq'];
const FAQ_GROUPS = [
  ['compatibility-and-browser-support', 'Compatibility and browser support'],
  ['tsl-and-shader-migration', 'TSL and shader migration'],
  ['installation-and-supported-agents', 'Installation and supported agents'],
  ['skill-routing-and-usage', 'Skill routing and usage'],
  ['evidence-and-validation', 'Evidence and validation'],
  ['pricing-and-licensing', 'Pricing and licensing'],
  ['troubleshooting', 'Troubleshooting'],
];
const FAQ_GROUP_IDS = new Set(FAQ_GROUPS.map(([id]) => id));
const FAQ_SOURCE_TYPES = new Set([
  'customer', 'search-console', 'repository-issue', 'upstream-issue', 'forum', 'reddit',
  'stack-overflow', 'verified-local-failure',
]);
const PUBLIC_FAQ_SOURCES = new Set(['repository-issue', 'upstream-issue', 'forum', 'reddit', 'stack-overflow']);
const EVIDENCE_STATUSES = new Set(['observed', 'reproduced', 'verified']);
const ROUTE = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)+$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INTERNAL_SOURCE = /^(?:local|search-console|support):\s*\S/i;

const posix = (path) => path.split(sep).join('/');
const plainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim() === value && value.length > 0 && !/[\r\n]/.test(value);
const strings = (value, nonempty = false) => Array.isArray(value)
  && (!nonempty || value.length > 0) && value.every(text) && new Set(value).size === value.length;
const normalized = (value) => String(value).normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
const normalizedQuery = (value) => String(value).normalize('NFKC').toLocaleLowerCase('en-US')
  .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

function https(value) {
  if (!text(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const ageInDays = (from, to) => Math.floor(
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
);

function onlyKeys(value, allowed, label, errors) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${label}: unknown property "${key}"`);
}

function bodyH1(body) {
  let fence = null;
  let priorText = false;
  for (const [index, line] of body.split('\n').entries()) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1]?.[0];
    if (marker) {
      fence = fence === marker ? null : (fence ?? marker);
      priorText = false;
      continue;
    }
    if (fence) continue;
    if (/^#(?:\s|$)/.test(line) || /<h1\b/i.test(line) || (priorText && /^=+\s*$/.test(line))) return index + 1;
    priorText = Boolean(line.trim());
  }
  return null;
}

function walk(directory, repoRoot, errors) {
  if (!existsSync(directory)) {
    errors.push('site-content: content directory is missing');
    return [];
  }
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.name === '_data') continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) errors.push(`${posix(relative(repoRoot, path))}: symbolic links are not allowed`);
    else if (entry.isDirectory()) files.push(...walk(path, repoRoot, errors));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') files.push(path);
  }
  return files.sort((a, b) => posix(relative(repoRoot, a)).localeCompare(posix(relative(repoRoot, b)), 'en'));
}

function routeFromFile(contentRoot, file) {
  const parts = posix(relative(contentRoot, file)).split('/');
  const stem = parts.pop().replace(/\.md$/i, '');
  if (stem !== 'index') parts.push(stem);
  return `/${parts.join('/')}/`;
}

function parse(file, repoRoot, errors) {
  const label = posix(relative(repoRoot, file));
  const source = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!source.startsWith('---\n')) {
    errors.push(`${label}: frontmatter must begin with ---`);
    return null;
  }
  const end = source.indexOf('\n---\n', 4);
  if (end < 0) {
    errors.push(`${label}: missing closing frontmatter delimiter`);
    return null;
  }
  const metadata = Object.create(null);
  const lines = source.slice(4, end).split('\n');
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-z][a-z0-9_]*):[ \t]*(.*)$/);
    if (!match) {
      errors.push(`${label}:${index + 2}: expected one flat key: value pair`);
      continue;
    }
    const [, key, raw] = match;
    if (Object.hasOwn(metadata, key)) {
      errors.push(`${label}:${index + 2}: duplicate field "${key}"`);
      continue;
    }
    const value = raw.trim();
    if (!value) {
      errors.push(`${label}:${index + 2}: field "${key}" is empty`);
      continue;
    }
    if (/^[|>&*!]/.test(value)) {
      errors.push(`${label}:${index + 2}: field "${key}" uses unsupported YAML syntax`);
      continue;
    }
    if (/^[\[{\"]/.test(value)) {
      try { metadata[key] = JSON.parse(value); } catch (error) {
        errors.push(`${label}:${index + 2}: field "${key}" is invalid one-line JSON (${error.message})`);
      }
    } else metadata[key] = value;
  }
  const body = source.slice(end + 5);
  if (!body.trim()) errors.push(`${label}: Markdown body is empty`);
  const h1 = bodyH1(body);
  if (h1) errors.push(`${label}: Markdown body contains an H1 at body line ${h1}`);
  return { metadata, body, sourceFile: label };
}

function validateDate(page, field, today, errors) {
  const value = page[field];
  if (!date(value)) errors.push(`${page.sourceFile}: "${field}" must be a real YYYY-MM-DD date`);
  else if (value > today) errors.push(`${page.sourceFile}: "${field}" cannot be in the future (${value})`);
  return date(value) ? value : null;
}

function validateKindAndRoute(page, expectedSlug, errors) {
  if (!KINDS.has(page.kind)) errors.push(`${page.sourceFile}: unsupported kind "${page.kind}"`);
  if (!ROUTE.test(page.slug ?? '')) errors.push(`${page.sourceFile}: slug "${page.slug}" is not a safe directory route`);
  if (page.slug !== expectedSlug) errors.push(`${page.sourceFile}: slug "${page.slug}" must match source route "${expectedSlug}"`);
  if (!ROUTE.test(page.slug ?? '')) return;
  const segments = page.slug.split('/').filter(Boolean);
  const [family] = segments;
  const allowed = segments.length === 1
    ? (family === 'pricing' ? ['pricing'] : (family === 'guides' || Object.hasOwn(LEAF_KINDS, family) ? ['hub'] : []))
    : (segments.length === 2 ? LEAF_KINDS[family] ?? [] : []);
  if (!allowed.length) errors.push(`${page.sourceFile}: slug "${page.slug}" is outside supported content families`);
  else if (!allowed.includes(page.kind)) errors.push(`${page.sourceFile}: kind "${page.kind}" is invalid for ${page.slug}; expected ${allowed.join(' or ')}`);
}

function validateFaq(page, threeRevision, today, reviewed, errors) {
  for (const field of FAQ_FIELDS) if (!Object.hasOwn(page, field)) errors.push(`${page.sourceFile}: FAQ answer is missing "${field}"`);
  if (text(page.h1) && !page.h1.endsWith('?')) errors.push(`${page.sourceFile}: FAQ h1 must end with ?`);
  if (text(page.summary)) {
    const count = page.summary.split(/\s+/).length;
    if (count < 40 || count > 100) errors.push(`${page.sourceFile}: FAQ summary must contain 40-100 words (found ${count})`);
  }
  if (!FAQ_SOURCE_TYPES.has(page.question_source_type)) errors.push(`${page.sourceFile}: invalid question_source_type "${page.question_source_type}"`);
  if (!strings(page.question_sources, true)) errors.push(`${page.sourceFile}: question_sources must be a nonempty unique JSON string array`);
  else {
    for (const source of page.question_sources) {
      if (!https(source) && !INTERNAL_SOURCE.test(source)) errors.push(`${page.sourceFile}: invalid FAQ source: ${source}`);
    }
    if (PUBLIC_FAQ_SOURCES.has(page.question_source_type) && !page.question_sources.some(https)) {
      errors.push(`${page.sourceFile}: ${page.question_source_type} provenance requires a public HTTPS source`);
    }
    if (page.question_source_type === 'verified-local-failure' && !page.question_sources.some((source) => /^local:\s*\S/i.test(source))) {
      errors.push(`${page.sourceFile}: verified-local-failure provenance requires a local: source`);
    }
  }
  if (!EVIDENCE_STATUSES.has(page.evidence_status)) errors.push(`${page.sourceFile}: invalid evidence_status "${page.evidence_status}"`);
  if (page.question_source_type === 'verified-local-failure' && !['reproduced', 'verified'].includes(page.evidence_status)) {
    errors.push(`${page.sourceFile}: verified-local-failure evidence must be reproduced or verified`);
  }
  if (!FAQ_GROUP_IDS.has(page.faq_group)) errors.push(`${page.sourceFile}: invalid faq_group "${page.faq_group}"`);
  if (page.canonical_route !== page.slug) errors.push(`${page.sourceFile}: FAQ canonical_route must equal its slug "${page.slug}"`);
  const first = validateDate(page, 'first_observed', today, errors);
  const last = validateDate(page, 'last_observed', today, errors);
  if (first && last && first > last) errors.push(`${page.sourceFile}: first_observed is later than last_observed`);
  if (last && reviewed && last > reviewed) errors.push(`${page.sourceFile}: last_observed is later than last_reviewed`);
  if (Object.hasOwn(page, 'supported_revision') && page.supported_revision !== threeRevision) {
    errors.push(`${page.sourceFile}: supported_revision "${page.supported_revision}" must equal "${threeRevision}"`);
  }
}

function validatePage(page, expectedSlug, threeRevision, today, errors) {
  onlyKeys(page, [...FIELDS, 'body', 'sourceFile', 'family', 'isHub'], page.sourceFile, errors);
  for (const field of REQUIRED) if (!Object.hasOwn(page, field)) errors.push(`${page.sourceFile}: missing required field "${field}"`);
  for (const field of ['kind', 'slug', 'title', 'description', 'h1', 'primary_query', 'summary']) {
    if (Object.hasOwn(page, field) && !text(page[field])) errors.push(`${page.sourceFile}: "${field}" must be a nonempty one-line string`);
  }
  validateKindAndRoute(page, expectedSlug, errors);
  if (text(page.title) && (page.title.length < 20 || page.title.length > 65)) errors.push(`${page.sourceFile}: title length ${page.title.length} is outside 20-65`);
  if (text(page.description) && (page.description.length < 80 || page.description.length > 165)) errors.push(`${page.sourceFile}: description length ${page.description.length} is outside 80-165`);
  for (const field of ['query_aliases', 'related_skills', 'related_demos', 'related_pages']) {
    if (Object.hasOwn(page, field) && !strings(page[field])) errors.push(`${page.sourceFile}: "${field}" must be a unique one-line JSON string array`);
  }
  if (Object.hasOwn(page, 'sources')) {
    if (!strings(page.sources, true)) errors.push(`${page.sourceFile}: sources must be a nonempty unique JSON string array`);
    else for (const source of page.sources) if (!https(source)) errors.push(`${page.sourceFile}: source is not HTTPS: ${source}`);
  }
  const hasImage = Object.hasOwn(page, 'hero_image');
  const hasSource = Object.hasOwn(page, 'hero_source');
  if (hasImage !== hasSource) errors.push(`${page.sourceFile}: hero_image and hero_source must be declared together`);
  if (hasImage && (!text(page.hero_image) || !text(page.hero_source))) errors.push(`${page.sourceFile}: hero fields must be nonempty one-line strings`);
  const published = validateDate(page, 'published', today, errors);
  const reviewed = validateDate(page, 'last_reviewed', today, errors);
  if (published && reviewed && published > reviewed) errors.push(`${page.sourceFile}: published is later than last_reviewed`);

  if (page.kind === 'ecosystem-comparison') {
    if (!strings(page.subjects, true)) errors.push(`${page.sourceFile}: ecosystem comparisons require nonempty unique subjects`);
  } else if (page.kind === 'alternatives') {
    if (Object.hasOwn(page, 'subjects') && !strings(page.subjects, true)) errors.push(`${page.sourceFile}: alternatives subjects must be a nonempty unique string array`);
  } else if (Object.hasOwn(page, 'subjects')) errors.push(`${page.sourceFile}: subjects is only allowed on ecosystem comparisons or alternatives`);

  const revisionOwner = ['technical-comparison', 'migration'].includes(page.kind);
  if (revisionOwner && !Object.hasOwn(page, 'supported_revision')) errors.push(`${page.sourceFile}: ${page.kind} requires supported_revision`);
  if (Object.hasOwn(page, 'supported_revision') && !revisionOwner && page.kind !== 'faq-answer') {
    errors.push(`${page.sourceFile}: supported_revision is not allowed on kind "${page.kind}"`);
  }
  if (revisionOwner && page.supported_revision !== threeRevision) errors.push(`${page.sourceFile}: supported_revision "${page.supported_revision}" must equal "${threeRevision}"`);

  if (page.kind === 'faq-answer') validateFaq(page, threeRevision, today, reviewed, errors);
  else for (const field of FAQ_FIELDS) if (Object.hasOwn(page, field)) errors.push(`${page.sourceFile}: "${field}" is only allowed on FAQ answers`);
}

function loadCompetitors(repoRoot, today, errors, warnings) {
  const path = join(repoRoot, 'site-content', '_data', 'competitors.json');
  const label = 'site-content/_data/competitors.json';
  if (!existsSync(path)) {
    errors.push(`${label}: required file is missing`);
    return new Map();
  }
  let data;
  try { data = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    errors.push(`${label}: invalid JSON (${error.message})`);
    return new Map();
  }
  if (!plainObject(data)) {
    errors.push(`${label}: root must be an object`);
    return new Map();
  }
  onlyKeys(data, ['schemaVersion', 'subjects'], label, errors);
  if (data.schemaVersion !== 1) errors.push(`${label}: schemaVersion must equal 1`);
  if (!plainObject(data.subjects)) {
    errors.push(`${label}: subjects must be an object`);
    return new Map();
  }
  const result = new Map();
  for (const id of Object.keys(data.subjects).sort()) {
    const subject = data.subjects[id];
    const subjectLabel = `${label}: subject "${id}"`;
    if (!ID.test(id) || id === 'this-pack') errors.push(`${subjectLabel}: invalid external subject ID`);
    if (!plainObject(subject)) {
      errors.push(`${subjectLabel}: must be an object`);
      continue;
    }
    onlyKeys(subject, ['name', 'homepage', 'facts'], subjectLabel, errors);
    if (!text(subject.name)) errors.push(`${subjectLabel}: name must be a nonempty string`);
    if (!https(subject.homepage)) errors.push(`${subjectLabel}: homepage must be HTTPS`);
    if (!plainObject(subject.facts) || !Object.keys(subject.facts).length) {
      errors.push(`${subjectLabel}: facts must be a nonempty object`);
      continue;
    }
    const facts = Object.create(null);
    for (const factId of Object.keys(subject.facts).sort()) {
      const fact = subject.facts[factId];
      const factLabel = `${subjectLabel}, fact "${factId}"`;
      if (!/^[a-z][a-z0-9_]*$/.test(factId) || !plainObject(fact)) {
        errors.push(`${factLabel}: invalid fact record`);
        continue;
      }
      onlyKeys(fact, ['value', 'source_url', 'reviewed', 'pinned_commit'], factLabel, errors);
      const validValue = text(fact.value) || typeof fact.value === 'boolean'
        || (typeof fact.value === 'number' && Number.isFinite(fact.value)) || strings(fact.value, true);
      if (!validValue) errors.push(`${factLabel}: value must be a scalar or nonempty unique string array`);
      if (!https(fact.source_url)) errors.push(`${factLabel}: source_url must be HTTPS`);
      if (!date(fact.reviewed)) errors.push(`${factLabel}: reviewed must be a real YYYY-MM-DD date`);
      else if (fact.reviewed > today) errors.push(`${factLabel}: reviewed cannot be in the future`);
      else {
        const age = ageInDays(fact.reviewed, today);
        if (age > 180) errors.push(`${factLabel}: review is stale at ${age} days`);
        else if (age > 90) warnings.push(`${factLabel}: review is ${age} days old`);
      }
      if (Object.hasOwn(fact, 'pinned_commit') && !/^[0-9a-f]{7,40}$/.test(fact.pinned_commit)) {
        errors.push(`${factLabel}: pinned_commit must be 7-40 lowercase hexadecimal characters`);
      }
      facts[factId] = { ...fact };
    }
    result.set(id, { id, name: subject.name, homepage: subject.homepage, facts });
  }
  return result;
}

function loadEvidenceReports(repoRoot, errors) {
  const path = join(repoRoot, 'docs', 'evidence', 'manifest.json');
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    errors.push(`docs/evidence/manifest.json: missing or invalid (${error.message})`);
    return new Map();
  }
  if (!Array.isArray(manifest.reports)) {
    errors.push('docs/evidence/manifest.json: reports must be an array');
    return new Map();
  }
  const reports = new Map();
  for (const report of manifest.reports) {
    if (!plainObject(report) || !text(report.labId) || reports.has(report.labId)) {
      errors.push('docs/evidence/manifest.json: every report needs a unique labId');
      continue;
    }
    reports.set(report.labId, report);
  }
  return reports;
}

function proof(page, repoRoot, demoById, evidenceReports, errors) {
  if (!Object.hasOwn(page, 'hero_image') || !Object.hasOwn(page, 'hero_source')) return;
  if (!text(page.hero_image) || !text(page.hero_source)) return;
  const demo = demoById.get(page.hero_source);
  if (!demo) {
    errors.push(`${page.sourceFile}: unknown hero_source "${page.hero_source}"`);
    return;
  }
  if (!page.related_demos?.includes(demo.id)) errors.push(`${page.sourceFile}: hero_source must appear in related_demos`);
  const report = evidenceReports.get(demo.id);
  if (!report) errors.push(`${page.sourceFile}: hero_source has no published evidence report: ${demo.id}`);
  else {
    if (report.status !== 'accepted') errors.push(`${page.sourceFile}: hero_source evidence is not accepted: ${demo.id}`);
    if (report.sourceHash !== demo.sourceHash) errors.push(`${page.sourceFile}: hero_source evidence is stale for current source: ${demo.id}`);
  }
  const image = page.hero_image;
  if (!/^\/[A-Za-z0-9._/-]+\.png$/.test(image) || image.includes('//') || image.split('/').some((part) => part === '.' || part === '..')) {
    errors.push(`${page.sourceFile}: unsafe hero_image "${image}"`);
    return;
  }
  const docs = resolve(repoRoot, 'docs');
  const path = resolve(docs, image.slice(1));
  if (!path.startsWith(`${docs}${sep}`) || !existsSync(path)) {
    errors.push(`${page.sourceFile}: hero_image does not exist inside docs/: ${image}`);
    return;
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) errors.push(`${page.sourceFile}: hero_image must be a regular nonsymlink file`);
  else if (readFileSync(path).subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') errors.push(`${page.sourceFile}: hero_image is not PNG`);
  const poster = typeof demo.poster === 'string' ? `/${demo.poster.replace(/^\/+/, '')}` : null;
  if (image !== `/previews/primary/${demo.id}.png` && image !== `/previews/provider/${demo.id}.png`
    && !image.startsWith(`/visual-validation/${demo.id}/`) && image !== poster) {
    errors.push(`${page.sourceFile}: hero_image is not attributable to "${demo.id}"`);
  }
}

function localRepositorySources(page, repoRoot, errors) {
  const values = [...(page.sources ?? []), ...(page.question_sources ?? [])];
  for (const source of values) {
    if (!source.startsWith('https://')) continue;
    const url = new URL(source);
    const match = url.pathname.match(/^\/linegel\/threejs-complete-set-of-skill\/(blob|tree)\/main\/(.+)$/);
    if (!match) continue;
    const path = resolve(repoRoot, decodeURIComponent(match[2]));
    if (!path.startsWith(`${repoRoot}${sep}`) || !existsSync(path)) {
      errors.push(`${page.sourceFile}: repository source does not exist in the current main tree: ${source}`);
      continue;
    }
    const stat = lstatSync(path);
    if ((match[1] === 'blob' && !stat.isFile()) || (match[1] === 'tree' && !stat.isDirectory())) {
      errors.push(`${page.sourceFile}: repository source type does not match ${match[1]} URL: ${source}`);
    }
  }
}

function globalOwnership(pages, errors) {
  for (const [field, label] of [['slug', 'slug'], ['title', 'title'], ['description', 'description']]) {
    const owners = new Map();
    for (const page of pages) {
      if (!text(page[field])) continue;
      const key = field === 'slug' ? page.slug : normalized(page[field]);
      const owner = owners.get(key);
      if (owner) errors.push(`${page.sourceFile}: duplicate ${label} also declared by ${owner.sourceFile}`);
      else owners.set(key, page);
    }
  }
  const owners = new Map();
  for (const page of pages) {
    const local = new Map();
    for (const raw of [page.primary_query, ...(Array.isArray(page.query_aliases) ? page.query_aliases : [])]) {
      if (!text(raw)) continue;
      const key = normalizedQuery(raw);
      if (!key) errors.push(`${page.sourceFile}: query "${raw}" normalizes to empty`);
      else if (local.has(key)) errors.push(`${page.sourceFile}: query "${raw}" duplicates "${local.get(key)}"`);
      else if (owners.has(key)) errors.push(`${page.sourceFile}: query "${raw}" collides with "${owners.get(key).raw}" on ${owners.get(key).page.slug}`);
      else {
        local.set(key, raw);
        owners.set(key, { page, raw });
      }
    }
  }
}

function relationships(pages, pageBySlug, skillSet, demoById, evidenceReports, repoRoot, competitors, errors) {
  for (const page of pages) {
    localRepositorySources(page, repoRoot, errors);
    for (const route of Array.isArray(page.related_pages) ? page.related_pages : []) {
      if (!ROUTE.test(route)) errors.push(`${page.sourceFile}: unsafe related page "${route}"`);
      else if (route === page.slug) errors.push(`${page.sourceFile}: related_pages contains its own slug`);
      else if (!pageBySlug.has(route)) errors.push(`${page.sourceFile}: related page does not exist: ${route}`);
    }
    for (const skill of Array.isArray(page.related_skills) ? page.related_skills : []) {
      if (!skillSet.has(skill)) errors.push(`${page.sourceFile}: related skill does not exist: ${skill}`);
    }
    for (const id of Array.isArray(page.related_demos) ? page.related_demos : []) {
      const demo = demoById.get(id);
      if (!demo) errors.push(`${page.sourceFile}: related demo does not exist: ${id}`);
      else if (!page.related_skills?.includes(demo.skill)) errors.push(`${page.sourceFile}: demo "${id}" is owned by omitted skill "${demo.skill}"`);
    }
    proof(page, repoRoot, demoById, evidenceReports, errors);
    page.resolvedSubjects = [];
    if (!['ecosystem-comparison', 'alternatives'].includes(page.kind) || !Array.isArray(page.subjects)) continue;
    const external = page.subjects.filter((id) => id !== 'this-pack');
    if (!external.length) errors.push(`${page.sourceFile}: subjects requires at least one external ID`);
    page.resolvedSubjects = page.subjects.map((id) => {
      if (id === 'this-pack') return { id, local: true };
      if (!ID.test(id)) errors.push(`${page.sourceFile}: invalid subject ID "${id}"`);
      const subject = competitors.get(id);
      if (!subject) {
        errors.push(`${page.sourceFile}: subject is absent from competitors.json: ${id}`);
        return null;
      }
      for (const [factId, fact] of Object.entries(subject.facts)) {
        if (date(fact.reviewed) && date(page.last_reviewed) && fact.reviewed > page.last_reviewed) {
          errors.push(`${page.sourceFile}: last_reviewed predates ${id}.${factId} (${fact.reviewed})`);
        }
      }
      return subject;
    }).filter(Boolean);
  }
}

export function loadSiteContent({ repoRoot, skillIds, demos, threeRevision, today = new Date().toISOString().slice(0, 10) }) {
  if (!text(repoRoot)) throw new TypeError('repoRoot must be a nonempty path string');
  if (!skillIds || typeof skillIds[Symbol.iterator] !== 'function') throw new TypeError('skillIds must be iterable');
  if (!Array.isArray(demos)) throw new TypeError('demos must be an array');
  if (!text(threeRevision)) throw new TypeError('threeRevision must be a nonempty string');
  if (!date(today)) throw new TypeError('today must be a real YYYY-MM-DD date');

  const root = resolve(repoRoot);
  const contentRoot = join(root, 'site-content');
  const errors = [];
  const warnings = [];
  const demoById = new Map();
  for (const demo of demos) {
    if (!plainObject(demo) || !text(demo.id)) throw new TypeError('every demo must have a nonempty id');
    if (demoById.has(demo.id)) throw new Error(`duplicate demo input: ${demo.id}`);
    demoById.set(demo.id, demo);
  }
  const competitorsById = loadCompetitors(root, today, errors, warnings);
  const evidenceReports = loadEvidenceReports(root, errors);
  const pages = walk(contentRoot, root, errors).flatMap((file) => {
    const parsed = parse(file, root, errors);
    if (!parsed) return [];
    const page = {
      ...parsed.metadata,
      body: parsed.body,
      sourceFile: parsed.sourceFile,
      family: typeof parsed.metadata.slug === 'string' ? parsed.metadata.slug.split('/').filter(Boolean)[0] : null,
      isHub: parsed.metadata.kind === 'hub',
    };
    validatePage(page, routeFromFile(contentRoot, file), threeRevision, today, errors);
    if (page.kind === 'faq-answer') page.faq = {
      question: page.h1,
      answer: page.summary,
      route: page.slug,
      group: page.faq_group,
      sourceType: page.question_source_type,
      sources: page.question_sources,
      firstObserved: page.first_observed,
      lastObserved: page.last_observed,
      canonicalRoute: page.canonical_route,
      evidenceStatus: page.evidence_status,
    };
    return [page];
  }).sort((a, b) => String(a.slug).localeCompare(String(b.slug), 'en'));

  globalOwnership(pages, errors);
  const pageBySlug = new Map();
  for (const page of pages) if (text(page.slug) && !pageBySlug.has(page.slug)) pageBySlug.set(page.slug, page);
  relationships(pages, pageBySlug, new Set(skillIds), demoById, evidenceReports, root, competitorsById, errors);
  const usedCompetitors = new Set(pages.flatMap((page) => Array.isArray(page.subjects) ? page.subjects : []).filter((id) => id !== 'this-pack'));
  for (const id of competitorsById.keys()) if (!usedCompetitors.has(id)) errors.push(`site-content/_data/competitors.json: unused subject "${id}"`);

  const rank = new Map(FAMILY_ORDER.map((family, index) => [family, index]));
  const relatedBySkill = new Map();
  for (const page of pages) for (const skill of Array.isArray(page.related_skills) ? page.related_skills : []) {
    if (!relatedBySkill.has(skill)) relatedBySkill.set(skill, []);
    relatedBySkill.get(skill).push(page);
  }
  for (const related of relatedBySkill.values()) related.sort((a, b) => (
    (rank.get(a.family) ?? 99) - (rank.get(b.family) ?? 99) || a.slug.localeCompare(b.slug, 'en')
  ));
  const faqGroups = FAQ_GROUPS.map(([id, label]) => ({
    id, label, items: pages.filter((page) => page.faq?.group === id).map((page) => page.faq),
  })).filter(({ items }) => items.length);

  const failures = [...new Set(errors)].sort();
  if (failures.length) {
    const error = new Error(`Site content validation failed (${failures.length} errors):\n${failures.map((message) => `- ${message}`).join('\n')}`);
    error.name = 'SiteContentValidationError';
    throw error;
  }
  return {
    pages,
    pageBySlug,
    relatedBySkill,
    faqGroups,
    competitorsById,
    warnings: [...new Set(warnings)].sort(),
  };
}
