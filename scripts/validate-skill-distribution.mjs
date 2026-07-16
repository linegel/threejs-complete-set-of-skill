#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
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
  for (const match of text.matchAll(/`((?:references|scripts)\/[^`\s]+\.(?:md|py))`/g)) targets.push(match[1]);
  return targets;
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
  [/lab\.manifest\.json|labs\/schema\/evidence-bundle/i, 'repository lab contract'],
  [/\bnpm\s+--prefix\s+threejs-|\bfrom the repository root\b/i, 'repository-only command'],
  [/\bCodex(?:'s)? in-app Browser\b|Playwright capture harness/i, 'repository QA surface'],
];
const allowedRootEntries = new Set(['SKILL.md', 'LICENSE', 'agents', 'references', 'scripts']);
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
    const text = readFileSync(source, 'utf8');
    if ((text.match(/^```/gm) ?? []).length % 2) fail(`${relative(root, source)} has an unclosed code fence`);

    for (let target of localTargets(text)) {
      target = target.trim().split(/\s+["']/)[0].replace(/^<|>$/g, '').split('#')[0].split('?')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
      const path = resolve(dirname(source), decodeURIComponent(target));
      if (!within(skillRoot, path)) fail(`${relative(root, source)} links outside its installed skill: ${target}`);
      if (!existsSync(path) || !lstatSync(path).isFile()) fail(`${relative(root, source)} links to missing file: ${target}`);
      reachable.add(path);
      if (path.endsWith('.md') && !visited.has(path) && !pending.includes(path)) pending.push(path);
    }
  }

  const standalone = new Set([join(skillRoot, 'LICENSE'), uiPath]);
  const orphaned = productFiles.filter((path) => !reachable.has(path) && !standalone.has(path));
  if (orphaned.length) fail(`${skillName} contains unreachable product files: ${orphaned.map((p) => relative(skillRoot, p)).join(', ')}`);
  for (const path of productFiles) {
    const text = readFileSync(path);
    const decoded = text.toString('utf8');
    for (const [pattern, label] of forbiddenGuidance) {
      if (pattern.test(decoded)) fail(`${relative(root, path)} contains ${label}`);
    }
    for (const match of decoded.matchAll(/\$(threejs-[a-z0-9-]+)/g)) {
      if (!rosterSet.has(match[1])) fail(`${relative(root, path)} invokes unknown skill ${match[1]}`);
    }
    files += 1;
    bytes += text.byteLength;
    lines += decoded.split(/\r?\n/).length;
  }
}

console.log(`Validated ${skillNames.length} real installable skills: ${files} files, ${lines} lines, ${bytes} bytes`);
