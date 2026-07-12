import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEvidenceReportManifest } from '../../scripts/lib/evidence-report-validation.mjs';

const hash = (character) => `sha256:${character.repeat(64)}`;
const demos = [
  {
    id: 'render-lab',
    status: 'incomplete',
    sourceHash: hash('1'),
    nonRenderingScenarioSuite: false,
  },
  {
    id: 'contract-lab',
    status: 'accepted',
    sourceHash: hash('2'),
    nonRenderingScenarioSuite: true,
  },
];
const baseline = {
  schemaVersion: 1,
  generatedBy: 'scripts/build-evidence-pages.mjs',
  buildRevision: hash('3'),
  indexSha256: hash('4'),
  reports: [
    {
      labId: 'render-lab',
      path: 'evidence/render-lab/',
      status: 'incomplete',
      sourceHash: hash('1'),
      publishedBundleHash: hash('5'),
      htmlSha256: hash('6'),
      media: [{
        file: 'visual-validation/render-lab/final.design.png',
        outputSha256: hash('7'),
        classification: 'inspected-runtime-evidence-preview',
      }],
    },
    {
      labId: 'contract-lab',
      path: 'evidence/contract-lab/',
      status: 'accepted',
      sourceHash: hash('2'),
      publishedBundleHash: hash('8'),
      htmlSha256: hash('9'),
      media: [{
        file: 'previews/primary/contract-lab.png',
        outputSha256: hash('a'),
        classification: 'non-rendering-lab-preview',
      }],
    },
  ],
};

const validate = (manifest, configuredRuntimePreviewIds = new Set(['render-lab'])) => validateEvidenceReportManifest({
  manifest,
  demos,
  buildRevision: hash('3'),
  configuredRuntimePreviewIds,
});

test('evidence report manifest closes every primary and same-lab media owner', () => {
  assert.deepEqual(validate(baseline), []);
});

test('evidence report manifest rejects missing, duplicate, and unexpected reports', () => {
  const missing = structuredClone(baseline);
  missing.reports.pop();
  assert(validate(missing).some((error) => error.includes('missing report contract-lab')));

  const duplicate = structuredClone(baseline);
  duplicate.reports[1] = structuredClone(duplicate.reports[0]);
  assert(validate(duplicate).some((error) => error.includes('report ids are duplicated')));

  const unexpected = structuredClone(baseline);
  unexpected.reports[1].labId = 'foreign-lab';
  assert(validate(unexpected).some((error) => error.includes('unexpected report foreign-lab')));
});

test('evidence report manifest rejects source, status, path, build, and hash drift', () => {
  const mutations = [
    ['build revision', (value) => { value.buildRevision = hash('b'); }, 'buildRevision drift'],
    ['source hash', (value) => { value.reports[0].sourceHash = hash('b'); }, 'source hash drift'],
    ['status', (value) => { value.reports[0].status = 'accepted'; }, 'status drift'],
    ['path', (value) => { value.reports[0].path = 'evidence/elsewhere/'; }, 'path drift'],
    ['HTML hash', (value) => { value.reports[0].htmlSha256 = 'not-a-hash'; }, 'HTML hash is invalid'],
    ['bundle hash', (value) => { value.reports[0].publishedBundleHash = 'not-a-hash'; }, 'published bundle hash is invalid'],
  ];
  for (const [label, mutate, expected] of mutations) {
    const value = structuredClone(baseline);
    mutate(value);
    assert(validate(value).some((error) => error.includes(expected)), `${label} mutation was not rejected`);
  }
});

test('evidence report manifest rejects foreign, duplicated, and unconfigured media', () => {
  const foreign = structuredClone(baseline);
  foreign.reports[0].media[0].file = 'visual-validation/other-lab/final.design.png';
  assert(validate(foreign).some((error) => error.includes('unrelated or unconfigured media')));

  const duplicated = structuredClone(baseline);
  duplicated.reports[0].media.push(structuredClone(duplicated.reports[0].media[0]));
  assert(validate(duplicated).some((error) => error.includes('duplicate media')));

  assert(validate(baseline, new Set()).some((error) => error.includes('render-lab: unrelated or unconfigured media')));

  const badContractPreview = structuredClone(baseline);
  badContractPreview.reports[1].media[0].file = 'previews/primary/render-lab.png';
  assert(validate(badContractPreview).some((error) => error.includes('contract-lab: unrelated or unconfigured media')));
});
