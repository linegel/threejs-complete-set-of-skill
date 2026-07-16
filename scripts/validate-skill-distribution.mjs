#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const productRoot = join(root, 'skills');
const fail = (message) => {
  console.error(`skill product validation failed: ${message}`);
  process.exit(1);
};
const sorted = (values) => [...values].sort();
const same = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
const within = (parent, child) => child === parent || child.startsWith(`${parent}${sep}`);

const manifest = JSON.parse(readFileSync(join(root, 'skills.sh.json'), 'utf8'));
const roster = manifest.groupings.flatMap((group) => group.skills);
const rosterSet = new Set(roster);
if (roster.length !== 27 || rosterSet.size !== roster.length) {
  fail(`skills.sh.json must name 27 unique public skills; found ${roster.length}`);
}
if (roster.includes('threejs-physics-integration')) fail('experimental physics is not a public skill');
if (!existsSync(productRoot) || !lstatSync(productRoot).isDirectory() || lstatSync(productRoot).isSymbolicLink()) {
  fail('skills/ must be a real directory');
}
if (existsSync(join(root, 'plugins', 'threejs-object-sculptor'))) {
  fail('duplicate Object Sculptor plugin must remain retired');
}

const entries = readdirSync(productRoot, { withFileTypes: true });
const skillNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const invalidEntries = entries.filter((entry) => !entry.isDirectory() || entry.isSymbolicLink());
if (invalidEntries.length) fail(`skills/ contains non-directory entries: ${invalidEntries.map((e) => e.name).join(', ')}`);
if (!same(skillNames, roster)) fail('skills/ directories must exactly match the skills.sh.json roster');

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('threejs-') && existsSync(join(root, entry.name, 'SKILL.md'))) {
    fail(`${entry.name}/SKILL.md is a competing installer entrypoint`);
  }
}

const frontmatter = (text, path) => {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!block) fail(`${path} has no YAML frontmatter`);
  return Object.fromEntries(block[1].split(/\r?\n/).flatMap((line) => {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    return field ? [[field[1], field[2].replace(/^["']|["']$/g, '')]] : [];
  }));
};

const localTargets = (text) => {
  const targets = [];
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) targets.push(match[1]);
  for (const match of text.matchAll(/`((?:references|scripts|examples|assets|fixtures)\/[^`\s]+)`/g)) targets.push(match[1]);
  return targets;
};

const markdownProse = (text, path) => {
  const lines = [];
  let fence = '';
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence && marker) {
      fence = marker[1];
      continue;
    }
    if (fence && marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
      fence = '';
      continue;
    }
    if (!fence) lines.push(line);
  }
  if (fence) fail(`${path} has an unclosed code fence`);
  return lines.join('\n');
};

const textCache = new Map();
const readText = (path) => {
  if (textCache.has(path)) return textCache.get(path);
  const content = readFileSync(path);
  const text = content.includes(0) ? null : content.toString('utf8');
  const decoded = text?.includes('\uFFFD') ? null : text;
  textCache.set(path, decoded);
  return decoded;
};

const anchorCache = new Map();
const markdownAnchors = (path) => {
  if (anchorCache.has(path)) return anchorCache.get(path);
  const anchors = new Set();
  const counts = new Map();
  for (const line of markdownProse(readText(path), relative(root, path)).split(/\r?\n/)) {
    for (const match of line.matchAll(/<(?:a\s+)?(?:id|name)=["']([^"']+)["']/gi)) anchors.add(match[1]);
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (!heading) continue;
    const base = heading
      .replace(/!\[([^\]]*)\]\([^)]*\)|\[([^\]]+)\]\([^)]*\)/g, '$1$2')
      .replace(/<[^>]*>|[`*_~]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-');
    const count = counts.get(base) ?? 0;
    anchors.add(count ? `${base}-${count}` : base);
    counts.set(base, count + 1);
  }
  anchorCache.set(path, anchors);
  return anchors;
};

const runtimeTargets = (text, path) => {
  const extension = extname(path).toLowerCase();
  const targets = [];
  const collect = (pattern, resolution = 'exact') => {
    for (const match of text.matchAll(pattern)) targets.push({ target: match[1], resolution });
  };
  const collectJavaScript = () => {
    collect(/\bimport\s*["']([^"']+)["']/g, 'module');
    collect(/\b(?:import|export)\s+[^;]*?\sfrom\s*["']([^"']+)["']/g, 'module');
    collect(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g, 'module');
    collect(/\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g);
    collect(/\bfetch\s*\(\s*["']([^"']+)["']/g);
    collect(/\b(?:readFile|readFileSync)\s*\(\s*["']([^"']+)["']/g);
  };
  if (['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'].includes(extension)) {
    collectJavaScript();
  } else if (['.htm', '.html', '.svg'].includes(extension)) {
    collect(/\b(?:href|src)=["']([^"']+)["']/gi);
    collectJavaScript();
  } else if (extension === '.css') {
    collect(/@import\s+(?:url\(\s*)?["']([^"']+)["']/gi);
    collect(/\burl\(\s*["']?([^"')]+)["']?\s*\)/gi);
  } else if (extension === '.py') {
    for (const match of text.matchAll(/^\s*from\s+(\.+)([\w.]*)\s+import\s+([A-Za-z_]\w*)/gm)) {
      const module = match[2] || match[3];
      targets.push({
        target: `${'../'.repeat(match[1].length - 1)}${module.replaceAll('.', '/')}`,
        resolution: 'python',
      });
    }
  }
  return targets.filter(({ target, resolution }) => resolution === 'module'
    ? target.startsWith('.') || target.startsWith('/')
    : !target.startsWith('#') && !target.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(target));
};

const moduleExtensions = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.css'];
const resolvedDependency = (path, resolution, source, pointer) => {
  if (existsSync(path) && lstatSync(path).isFile()) return path;
  const candidates = resolution === 'module' && !moduleExtensions.includes(extname(path))
    ? [...moduleExtensions.map((extension) => `${path}${extension}`), ...moduleExtensions.map((extension) => join(path, `index${extension}`))]
    : resolution === 'python'
      ? [`${path}.py`, join(path, '__init__.py')]
      : [];
  const files = candidates.filter((candidate) => existsSync(candidate) && lstatSync(candidate).isFile());
  if (files.length > 1) fail(`${relative(root, source)} has an ambiguous local dependency: ${pointer}`);
  return files[0] ?? path;
};

const interfaceMetadata = (text, path) => {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines[0] !== 'interface:') fail(`${path} must contain one interface mapping`);
  const fields = Object.fromEntries(lines.slice(1).flatMap((line) => {
    const field = line.match(/^  (display_name|short_description|default_prompt):\s*["'](.+)["']$/);
    return field ? [[field[1], field[2]]] : [];
  }));
  if (lines.length !== 4 || Object.keys(fields).length !== 3) {
    fail(`${path} must define only display_name, short_description, and default_prompt`);
  }
  return fields;
};

const forbiddenGuidance = [
  [/\bPhysics(?:Context|Graph|SignalDescriptor|PresentationSnapshot|CostLedger)\b/, 'retired physics ABI'],
  [/physics-domain-and-interaction-contract|physics-interchange-abi/i, 'retired physics contract'],
  [/threejs-physics-integration/i, 'experimental skill route'],
  [/labs\/schema\/evidence-bundle/i, 'repository lab contract'],
  [/\bnpm\s+--prefix\s+threejs-|\bfrom the repository root\b/i, 'repository-only command'],
  [/\bCodex(?:'s)? in-app Browser\b|Playwright capture harness/i, 'repository QA surface'],
];
const resourceRoots = ['references', 'scripts', 'examples', 'assets', 'fixtures'];
const allowedRootEntries = new Set(['SKILL.md', 'LICENSE', 'agents', ...resourceRoots]);
let files = 0;
let bytes = 0;
let lines = 0;

for (const skillName of skillNames) {
  const skillRoot = join(productRoot, skillName);
  const rootEntries = readdirSync(skillRoot, { withFileTypes: true });
  const unexpected = rootEntries.filter((entry) => !allowedRootEntries.has(entry.name));
  if (unexpected.length) fail(`${skillName} contains non-product entries: ${unexpected.map((e) => e.name).join(', ')}`);
  for (const required of ['SKILL.md', 'LICENSE', 'agents/openai.yaml']) {
    const path = join(skillRoot, required);
    if (!existsSync(path) || !lstatSync(path).isFile()) fail(`${skillName}/${required} is missing`);
  }
  const agentEntries = readdirSync(join(skillRoot, 'agents'), { withFileTypes: true });
  if (agentEntries.length !== 1 || agentEntries[0].name !== 'openai.yaml' || !agentEntries[0].isFile()) {
    fail(`${skillName}/agents must contain only openai.yaml`);
  }

  const productFiles = [];
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) fail(`${relative(root, child)} is a symlink`);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) productFiles.push(child);
      else fail(`${relative(root, child)} is not a regular product file`);
    }
  };
  walk(skillRoot);

  const skillPath = join(skillRoot, 'SKILL.md');
  const skillText = readFileSync(skillPath, 'utf8');
  const metadata = frontmatter(skillText, `${skillName}/SKILL.md`);
  if (!same(Object.keys(metadata), ['name', 'description'])) fail(`${skillName}/SKILL.md frontmatter must contain only name and description`);
  if (metadata.name !== skillName) fail(`${skillName}/SKILL.md declares name ${metadata.name || '(missing)'}`);
  if (!metadata.description || metadata.description.length < 30) fail(`${skillName}/SKILL.md has no useful description`);
  if (metadata['disable-model-invocation'] === 'true') fail(`${skillName} must remain model-invoked`);
  const uiPath = join(skillRoot, 'agents', 'openai.yaml');
  const uiText = readFileSync(uiPath, 'utf8');
  const ui = interfaceMetadata(uiText, `${skillName}/agents/openai.yaml`);
  if (ui.short_description.length < 25 || ui.short_description.length > 64) fail(`${skillName}/agents/openai.yaml has an invalid short description`);
  if (!ui.default_prompt.startsWith(`Use $${skillName}`)) fail(`${skillName}/agents/openai.yaml does not start by invoking its skill`);

  const reachable = new Set([skillPath]);
  const visited = new Set();
  const pending = [skillPath];
  while (pending.length) {
    const source = pending.pop();
    if (visited.has(source)) continue;
    visited.add(source);
    const text = readText(source);
    if (text === null) continue;

    const markdown = extname(source).toLowerCase() === '.md';
    const targets = markdown
      ? localTargets(markdownProse(text, relative(root, source))).map((target) => ({ target, resolution: 'exact' }))
      : runtimeTargets(text, source);
    for (const { target, resolution } of targets) {
      const pointer = (markdown
        ? target.trim().split(/\s+["']/)[0]
        : target.trim()).replace(/^<|>$/g, '');
      if (!pointer || pointer.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(pointer)) continue;
      const hash = pointer.indexOf('#');
      const fragment = hash === -1 ? '' : pointer.slice(hash + 1);
      const fileTarget = (hash === -1 ? pointer : pointer.slice(0, hash)).split('?', 1)[0];
      let decodedTarget;
      let decodedFragment;
      try {
        decodedTarget = decodeURIComponent(fileTarget);
        decodedFragment = decodeURIComponent(fragment);
      } catch {
        fail(`${relative(root, source)} contains invalid percent encoding: ${pointer}`);
      }
      const unresolved = fileTarget ? resolve(dirname(source), decodedTarget) : source;
      const path = resolvedDependency(unresolved, resolution, source, pointer);
      if (!within(skillRoot, path)) fail(`${relative(root, source)} links outside its installed skill: ${pointer}`);
      if (!existsSync(path) || !lstatSync(path).isFile()) fail(`${relative(root, source)} links to missing file: ${pointer}`);
      if (decodedFragment && extname(path).toLowerCase() === '.md' && !markdownAnchors(path).has(decodedFragment)) {
        fail(`${relative(root, source)} links to missing anchor: ${pointer}`);
      }
      reachable.add(path);
      if (!visited.has(path) && !pending.includes(path)) pending.push(path);
    }
  }

  const standalone = new Set([join(skillRoot, 'LICENSE'), uiPath]);
  const orphaned = productFiles.filter((path) => !reachable.has(path) && !standalone.has(path));
  if (orphaned.length) fail(`${skillName} contains unreachable product files: ${orphaned.map((p) => relative(skillRoot, p)).join(', ')}`);
  for (const path of productFiles) {
    const content = readFileSync(path);
    const decoded = readText(path);
    if (decoded !== null) {
      for (const [pattern, label] of forbiddenGuidance) {
        if (pattern.test(decoded)) fail(`${relative(root, path)} contains ${label}`);
      }
      for (const match of decoded.matchAll(/\$(threejs-[a-z0-9-]+)/g)) {
        if (!rosterSet.has(match[1])) fail(`${relative(root, path)} invokes unknown skill ${match[1]}`);
      }
      lines += decoded.split(/\r?\n/).length;
    }
    files += 1;
    bytes += content.byteLength;
  }
}

console.log(`Validated ${skillNames.length} real installable skills: ${files} files, ${lines} lines, ${bytes} bytes`);
