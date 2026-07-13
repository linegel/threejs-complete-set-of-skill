#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distributionRoot = join(root, 'skills');

const fail = (message) => {
  console.error(`skill distribution validation failed: ${message}`);
  process.exit(1);
};

const sorted = (values) => [...values].sort();
const same = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
const isWithin = (parent, child) => child === parent || child.startsWith(`${parent}${sep}`);
const isProductResourcePath = (path) => {
  if (!isWithin(root, path)) return false;
  const segments = relative(root, path).split(sep);
  if (!skillNames.includes(segments[0])) return false;
  if (segments[1] === 'SKILL.md') return segments.length === 2;
  if (!['assets', 'references', 'scripts'].includes(segments[1])) return false;
  return !(segments[1] === 'scripts' && segments.at(-1).startsWith('test_'));
};

const skillNames = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('threejs-'))
  .map((entry) => entry.name);

if (!existsSync(distributionRoot)) fail('skills/ product projection is missing; run npm run skills:sync');
const distributedNames = readdirSync(distributionRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
if (!same(skillNames, distributedNames)) {
  fail('skills/ projection does not exactly match the top-level threejs-* product set');
}

const forbiddenProductEntries = new Set([
  '.agent', 'EXPERIMENTAL', 'examples', 'node_modules', 'plan.md', 'review.md', 'tests'
]);
const allowedEntries = new Set(['SKILL.md', 'assets', 'references', 'scripts']);

const visitProductTree = (path, sourceRoot) => {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isSymbolicLink()) fail(`${relative(root, entryPath)} contains an unapproved nested symlink`);
    if (!isWithin(sourceRoot, realpathSync(entryPath))) {
      fail(`${relative(root, entryPath)} escapes its skill product root`);
    }
    if (entry.isDirectory()) visitProductTree(entryPath, sourceRoot);
  }
};

for (const skillName of skillNames) {
  const sourceRoot = realpathSync(join(root, skillName));
  const projectedRoot = join(distributionRoot, skillName);
  for (const entry of readdirSync(projectedRoot, { withFileTypes: true })) {
    if (forbiddenProductEntries.has(entry.name) || !allowedEntries.has(entry.name)) {
      fail(`${relative(root, join(projectedRoot, entry.name))} is not a product resource`);
    }
    const entryPath = join(projectedRoot, entry.name);
    if (entry.name === 'scripts' && entry.isDirectory()) {
      for (const script of readdirSync(entryPath, { withFileTypes: true })) {
        if (!script.isSymbolicLink() || script.name.startsWith('test_')) {
          fail(`${relative(root, join(entryPath, script.name))} is not an approved product helper link`);
        }
        const resolvedScript = realpathSync(join(entryPath, script.name));
        if (!isWithin(sourceRoot, resolvedScript)) {
          fail(`${relative(root, join(entryPath, script.name))} resolves outside ${skillName}`);
        }
      }
      continue;
    } else if (!entry.isSymbolicLink()) {
      fail(`${relative(root, entryPath)} must be a generated product link`);
    }
    const resolved = realpathSync(entryPath);
    if (!isWithin(sourceRoot, resolved)) {
      fail(`${relative(root, entryPath)} resolves outside ${skillName}`);
    }
    if (lstatSync(resolved).isDirectory()) visitProductTree(resolved, sourceRoot);
  }
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (Object.hasOwn(packageJson, 'main')) fail('package.json must not advertise a nonexistent JavaScript main');
if (packageJson.scripts?.test !== 'npm run skills:check') {
  fail('root npm test must be the skill-product gate only');
}
if (packageJson.scripts?.['skills:pack'] !== 'npm run skills:check && npm pack') {
  fail('skills:pack must depend only on skills:check');
}
const packageFiles = packageJson.files ?? [];
for (const pattern of packageFiles) {
  if (/(?:^|\/)(?:examples|labs|integration-labs|tests|docs|evidence|artifacts)(?:\/|$)/.test(pattern)) {
    fail(`package allowlist leaks non-product contour: ${pattern}`);
  }
}
for (const requiredPattern of [
  'skills/**',
  'threejs-*/SKILL.md',
  'threejs-*/references/**',
  'threejs-*/assets/**',
  'skills.sh.json'
]) {
  if (!packageFiles.includes(requiredPattern)) fail(`package allowlist omits ${requiredPattern}`);
}

const forbiddenGuidance = [
  [/labs\/schema\/evidence-bundle/i, 'repo evidence schema'],
  [/lab\.manifest\.json/i, 'lab manifest acceptance contract'],
  [/\bnpm\s+--prefix\s+threejs-/i, 'repository example command'],
  [/\bfrom the repository root\b/i, 'repository-root command'],
  [/\bCodex(?:'s)? in-app Browser\b/i, 'Codex UI automation surface'],
  [/\bPlaywright capture harness\b/i, 'repository capture harness'],
  [/\bthis repository roster\b/i, 'repository roster'],
  [/\brepository's `\[Gated\]/i, 'repository release label'],
  [/\bevidence bundles? (?:the|that) [^\n]*lab emits\b/i, 'lab evidence bundle requirement'],
  [/\b(?:candidate|signoff)\s*(?:→|->)\s*(?:signoff|promotion)\b/i, 'repository promotion pipeline']
];

for (const skillName of skillNames) {
  const markdownPaths = [join(root, skillName, 'SKILL.md')];
  const referencesRoot = join(root, skillName, 'references');
  for (const entry of readdirSync(referencesRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) markdownPaths.push(join(referencesRoot, entry.name));
  }
  for (const markdownPath of markdownPaths) {
    const text = readFileSync(markdownPath, 'utf8');
    for (const [pattern, label] of forbiddenGuidance) {
      if (pattern.test(text)) fail(`${relative(root, markdownPath)} contains ${label}`);
    }
    for (const match of text.matchAll(/!?!?\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim().split('#')[0].split('?')[0];
      if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
      const resolved = resolve(dirname(markdownPath), decodeURIComponent(target));
      if (!isProductResourcePath(resolved)) {
        fail(`${relative(root, markdownPath)} links outside the distributed product: ${target}`);
      }
    }
  }
}

console.log(`Validated product boundary for ${skillNames.length} distributed skills`);
