import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SCIENCE } from '../../scripts/science-cards.mjs';

test('science-card math cannot emit raw HTML tag delimiters', () => {
  for (const [skill, html] of Object.entries(SCIENCE)) {
    const mathSegments = [...html.matchAll(/\$\$[\s\S]*?\$\$|\$[^$\n]*?\$/g)].map((match) => match[0]);
    assert.ok(mathSegments.length > 0, skill + ' has no math segment');
    for (const segment of mathSegments) {
      assert.equal(segment.includes('<'), false, skill + ' math contains a raw less-than delimiter');
    }
  }
});
