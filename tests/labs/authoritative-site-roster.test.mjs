import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRIMARY_DEMO_KINDS,
  authoritativeSkillDirs,
  buildDemoRegistry,
  loadCanonicalTargets,
} from '../../scripts/lib/lab-registry.mjs';
import { authoritativeSiteSkillSlugs } from '../../scripts/lib/site-skill-roster.mjs';
import { validateRegistry } from '../../scripts/lib/lab-validation.mjs';

test('site roster excludes extra secondary-only skill directories', () => {
  const registry = {
    demos: [
      { id: 'a', skill: 'threejs-a', kind: 'canonical-lab' },
      { id: 'b', skill: 'threejs-b', kind: 'integration-demo' },
      { id: 'unfinished', skill: 'threejs-unfinished', kind: 'contract-fixture' },
    ],
  };
  assert.deepEqual(
    [...authoritativeSiteSkillSlugs(registry, ['canonical-lab', 'integration-demo'])],
    ['threejs-a', 'threejs-b'],
  );

});

test('demo owner roster is independent from the complete skill product roster', () => {
  const targets = loadCanonicalTargets();
  const skills = authoritativeSkillDirs(targets);
  const registry = buildDemoRegistry();
  const publishedSkills = authoritativeSiteSkillSlugs(registry, PRIMARY_DEMO_KINDS);

  assert.equal(registry.counts.skills, skills.length);
  assert.ok(skills.includes('threejs-physics-integration'));
  assert.equal(publishedSkills.has('threejs-physics-integration'), false);
  assert.ok([...publishedSkills].every((skill) => skills.includes(skill)));
  assert.ok(registry.demos
    .filter((demo) => PRIMARY_DEMO_KINDS.includes(demo.kind))
    .every((demo) => publishedSkills.has(demo.skill)));
  assert.deepEqual(validateRegistry(registry, { validateEvidence: false }).errors, []);
});
