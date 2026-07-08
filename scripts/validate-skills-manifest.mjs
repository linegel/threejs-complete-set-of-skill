#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  const fm = parseFrontmatter(readFileSync(skillPath, 'utf8'), `${dir}/SKILL.md`);
  if (fm.name !== dir) fail(`${dir}/SKILL.md name is "${fm.name}", expected "${dir}"`);
  if (!fm.description || fm.description.length < 40) fail(`${dir}/SKILL.md has a missing or too-short description`);
  frontmatterByDir.set(dir, fm);
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
  if (skill.install?.selector !== `${repoSlug}@${skill.name}`) fail(`${skill.name} install selector is incorrect`);
  if (skill.install?.command !== `npx skills@latest add ${repoSlug} --skill ${skill.name}`) {
    fail(`${skill.name} install command is incorrect`);
  }
  if (!skill.raw?.endsWith(`/${skill.name}/SKILL.md`)) fail(`${skill.name} raw SKILL.md URL is missing`);
}

console.log(`Validated ${skillDirs.length} skills for ${repoSlug}`);
