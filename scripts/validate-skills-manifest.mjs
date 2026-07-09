#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoSlug = 'linegel/threejs-complete-set-of-skill';

const fail = (message) => {
  console.error(`skills manifest validation failed: ${message}`);
  process.exit(1);
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const parseFrontmatter = (skillMd, path) => {
  const match = skillMd.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) fail(`${path} has no YAML frontmatter`);

  const data = {};
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    data[field[1]] = field[2].replace(/^["']|["']$/g, '');
  }
  return data;
};

const skillDirs = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('threejs-'))
  .map((entry) => entry.name)
  .sort();

if (skillDirs.length === 0) fail('no top-level threejs-* skill directories found');

const frontmatterByDir = new Map();
for (const dir of skillDirs) {
  const skillPath = join(root, dir, 'SKILL.md');
  const skillText = readFileSync(skillPath, 'utf8');
  const fm = parseFrontmatter(skillText, `${dir}/SKILL.md`);
  if (fm.name !== dir) fail(`${dir}/SKILL.md name is "${fm.name}", expected "${dir}"`);
  if (!fm.description || fm.description.length < 40) fail(`${dir}/SKILL.md has a missing or too-short description`);
  if (/\b(?:latest|high-quality|high-performance|maximum-performance|production-ready)\b/i.test(fm.description)) {
    fail(`${dir}/SKILL.md description uses marketing or time-unstable language`);
  }
  frontmatterByDir.set(dir, fm);

  const referencesDir = join(root, dir, 'references');
  const markdownPaths = [skillPath];
  if (existsSync(referencesDir)) {
    for (const name of readdirSync(referencesDir).filter((entry) => entry.endsWith('.md'))) {
      markdownPaths.push(join(referencesDir, name));
    }
  }

  for (const markdownPath of markdownPaths) {
    const text = readFileSync(markdownPath, 'utf8');
    const relativePath = markdownPath.slice(root.length + 1);
    const fenceCount = (text.match(/^```/gm) ?? []).length;
    if (fenceCount % 2 !== 0) fail(`${relativePath} has unbalanced fenced code blocks`);

    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim();
      if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
      target = target.split('#')[0].split('?')[0];
      if (!target) continue;
      const absoluteTarget = resolve(dirname(markdownPath), decodeURIComponent(target));
      if (!existsSync(absoluteTarget)) fail(`${relativePath} links to missing local target ${target}`);
    }
  }
}

const rootManifestText = readFileSync(join(root, 'skills.json'), 'utf8');
const docsManifestText = readFileSync(join(root, 'docs', 'skills.json'), 'utf8');
if (rootManifestText !== docsManifestText) fail('skills.json and docs/skills.json differ');

const manifest = JSON.parse(rootManifestText);
if (manifest.source !== repoSlug) fail(`manifest source is "${manifest.source}", expected "${repoSlug}"`);
if (manifest.install?.source !== repoSlug) fail('manifest install.source is missing or incorrect');
if (!manifest.discovery?.primary?.includes(`npx skills@latest add ${repoSlug} --list`)) {
  fail('manifest discovery.primary does not expose npx skills@latest add --list');
}

const manifestNames = (manifest.skills ?? []).map((skill) => skill.name).sort();
if (JSON.stringify(manifestNames) !== JSON.stringify(skillDirs)) {
  fail('manifest skills do not match top-level threejs-* skill directories');
}

const categoryNames = new Set((manifest.categories ?? []).flatMap((category) => category.skills ?? []));
for (const name of skillDirs) {
  if (!categoryNames.has(name)) fail(`${name} is missing from manifest categories`);
}
for (const name of categoryNames) {
  if (!frontmatterByDir.has(name)) fail(`manifest category references unknown skill ${name}`);
}

for (const skill of manifest.skills) {
  const fm = frontmatterByDir.get(skill.name);
  if (!fm) fail(`manifest includes unknown skill ${skill.name}`);
  if (skill.description !== fm.description) fail(`${skill.name} manifest description differs from SKILL.md frontmatter`);
  if (!skill.raw?.endsWith(`/${skill.name}/SKILL.md`)) fail(`${skill.name} raw SKILL.md URL is missing`);
}

console.log(`Validated ${skillDirs.length} skills for ${repoSlug}`);
