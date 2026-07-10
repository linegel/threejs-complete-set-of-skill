import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(here, '..', 'triage-cases.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(here, 'lab.manifest.json'), 'utf8'));
const app = await readFile(join(here, 'app.mjs'), 'utf8');
const ids = catalog.cases.map((entry) => entry.id);

assert.equal(ids.length, 7);
assert.deepEqual(manifest.scenarios.map((entry) => entry.id), ids);
assert.equal(manifest.status, 'accepted');
assert.equal(manifest.nonRenderingScenarioSuite, true);
assert.deepEqual(manifest.tiers, []);
assert.match(app, /fetch\(casesUrl\)/);
assert.match(app, /Unknown debugging scenario/);
assert.equal(new Set(catalog.cases.map((entry) => entry.requiredOutcome)).size, 7);
assert.deepEqual(catalog.cases.filter((entry) => !entry.activateDebugging).map((entry) => entry.id), ['ordinary-scene-design']);

for (const entry of manifest.scenarios) {
  assert.equal(entry.acceptanceStatus, 'accepted');
  assert.equal(entry.startup.scenario, entry.id);
  await access(join(here, 'scenario', entry.id, 'index.html'));
}
for (const entry of manifest.mechanisms) {
  assert.equal(entry.acceptanceStatus, 'accepted');
  await access(join(here, 'mechanism', entry.id, 'index.html'));
}

console.log(JSON.stringify({ pass: true, scenarioCount: ids.length, mechanismCount: manifest.mechanisms.length }, null, 2));
