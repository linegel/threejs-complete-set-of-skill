import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('skill release commands have no lab, evidence, or site prerequisites', () => {
  assert.equal(packageJson.scripts.test, 'npm run skills:check');
  assert.equal(packageJson.scripts['skills:pack'], 'npm run skills:check && npm pack');
  for (const name of ['skills:check', 'skills:pack']) {
    assert.doesNotMatch(packageJson.scripts[name], /\b(?:labs|evidence|pages|site):/);
  }
});

test('the explicit package allowlist excludes repository QA and demo contours', () => {
  assert.ok(Array.isArray(packageJson.files));
  assert.ok(packageJson.files.includes('skills/**'));
  for (const pattern of packageJson.files) {
    assert.doesNotMatch(pattern, /(?:^|\/)(?:examples|labs|integration-labs|tests|docs|evidence|artifacts)(?:\/|$)/);
  }
});

test('the install projection contains every skill and only product resources', () => {
  const sourceSkills = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('threejs-'))
    .map((entry) => entry.name)
    .sort();
  const distributedSkills = readdirSync(join(root, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(distributedSkills, sourceSkills);
  for (const skillName of distributedSkills) {
    const entries = readdirSync(join(root, 'skills', skillName)).sort();
    assert.ok(entries.includes('SKILL.md'));
    assert.ok(entries.includes('references'));
    assert.equal(entries.some((name) => ['examples', 'tests', '.agent', 'plan.md', 'review.md'].includes(name)), false);
  }
});
