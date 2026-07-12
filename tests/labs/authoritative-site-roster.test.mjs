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
    skillsExpected: 2,
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

  registry.skillsExpected = 3;
  assert.throws(
    () => authoritativeSiteSkillSlugs(registry, ['canonical-lab', 'integration-demo']),
    /authoritative skill roster count drift/,
  );
});

test('demo registry follows the authored canonical roster instead of filesystem discovery', () => {
  const targets = loadCanonicalTargets();
  const skills = authoritativeSkillDirs(targets);
  const registry = buildDemoRegistry();
  const publishedSkills = authoritativeSiteSkillSlugs(registry, PRIMARY_DEMO_KINDS);

  assert.equal(skills.length, targets.skillsExpected);
  assert.equal(registry.counts.skills, targets.skillsExpected);
  assert.deepEqual([...publishedSkills].sort(), skills);
  assert.ok(registry.demos.every((demo) => publishedSkills.has(demo.skill)));
  assert.deepEqual(validateRegistry(registry, { validateEvidence: false }).errors, []);
});
