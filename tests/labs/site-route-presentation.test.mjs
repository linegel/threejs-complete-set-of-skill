import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildSiteRoutePresentation } from '../../scripts/lib/site-route-presentation.mjs';

const fixtures = JSON.parse(readFileSync(new URL(
  '../../threejs-choose-skills/examples/router-manifest-lab/router-fixtures.json',
  import.meta.url,
), 'utf8'));

test('site route presentation preserves the canonical ocean-planet route and owner', () => {
  const route = buildSiteRoutePresentation(fixtures, 'ocean-planet', {
    'threejs-procedural-planets': 'Procedural Planets',
    'threejs-spectral-ocean': 'Spectral Ocean',
    'threejs-sky-atmosphere-and-haze': 'Sky, Atmosphere, and Haze',
    'threejs-image-pipeline': 'Image Pipeline',
    'threejs-visual-validation': 'Visual Validation',
  });

  assert.equal(route.primaryOwner, 'threejs-procedural-planets');
  assert.equal(route.primaryOwnerTitle, 'Procedural Planets');
  assert.deepEqual(route.selectedSkills.map((skill) => skill.id), [
    'threejs-procedural-planets',
    'threejs-spectral-ocean',
    'threejs-sky-atmosphere-and-haze',
    'threejs-image-pipeline',
    'threejs-visual-validation',
  ]);
  assert.deepEqual(route.selectedSkills.map((skill) => skill.title), [
    'Procedural Planets',
    'Spectral Ocean',
    'Sky, Atmosphere, and Haze',
    'Image Pipeline',
    'Visual Validation',
  ]);
});

test('site route presentation rejects missing and invalid fixtures', () => {
  assert.throws(() => buildSiteRoutePresentation(fixtures, 'not-a-route'), /router fixture is missing/);
  assert.throws(() => buildSiteRoutePresentation({ routes: [{
    id: 'bad-owner',
    route: { selectedSkills: ['threejs-image-pipeline'], primaryOwner: 'threejs-bloom' },
  }] }, 'bad-owner'), /invalid primary owner/);
  assert.throws(() => buildSiteRoutePresentation({ routes: [{
    id: 'negative',
    route: { selectedSkills: ['threejs-image-pipeline'], primaryOwner: 'threejs-image-pipeline' },
    expected: { verdict: 'FAIL' },
  }] }, 'negative'), /not a positive presentation route/);
});
