import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('Frost release adapter declares the exact reviewed fixed route and remains pending signoff', () => {
  const source = readFileSync(resolve('scripts/assemble-frost-release.mjs'), 'utf8');
  for (const token of [
    'assemblePendingReleaseBundle({',
    '/mechanism/refraction-and-fresnel/',
    "mechanism: 'refraction-and-fresnel'",
    "tier: 'balanced'",
    "seed: '0x00000001'",
    "NumericLabel.AUTHORED",
    "id: 'hardware-performance-not-claimed'",
    "id: 'opaque-renderer-residency-not-claimed'",
    'promotionStatus: result.manifest.promotion.status',
  ]) assert(source.includes(token), `Frost release adapter omits ${token}`);
  assert(!source.includes('publishable: true'), 'Frost adapter must not approve its own visual signoff');
  assert(!source.includes("performanceCompliance: 'PASS'"), 'Frost adapter must not invent performance acceptance');
});
