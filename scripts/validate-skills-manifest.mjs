#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
  const skillText = readFileSync(skillPath, 'utf8');
  const fm = parseFrontmatter(skillText, `${dir}/SKILL.md`);
  if (fm.name !== dir) fail(`${dir}/SKILL.md name is "${fm.name}", expected "${dir}"`);
  if (!fm.description || fm.description.length < 40) fail(`${dir}/SKILL.md has a missing or too-short description`);
  if (/\b(?:latest|high-quality|high-performance|maximum-performance|production-ready)\b/i.test(fm.description)) {
    fail(`${dir}/SKILL.md description uses marketing or time-unstable language`);
  }
  frontmatterByDir.set(dir, fm);

  const referencesDir = join(root, dir, 'references');
  const markdownPaths = [skillPath];
  if (existsSync(referencesDir)) {
    for (const name of readdirSync(referencesDir).filter((entry) => entry.endsWith('.md'))) {
      markdownPaths.push(join(referencesDir, name));
    }
  }

  for (const markdownPath of markdownPaths) {
    const text = readFileSync(markdownPath, 'utf8');
    const relativePath = markdownPath.slice(root.length + 1);
    const fenceCount = (text.match(/^```/gm) ?? []).length;
    if (fenceCount % 2 !== 0) fail(`${relativePath} has unbalanced fenced code blocks`);

    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim();
      if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
      target = target.split('#')[0].split('?')[0];
      if (!target) continue;
      const absoluteTarget = resolve(dirname(markdownPath), decodeURIComponent(target));
      if (!existsSync(absoluteTarget)) fail(`${relativePath} links to missing local target ${target}`);
    }
  }
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
  if (!skill.raw?.endsWith(`/${skill.name}/SKILL.md`)) fail(`${skill.name} raw SKILL.md URL is missing`);
}

const physicsContractRelative = 'threejs-choose-skills/references/physics-domain-and-interaction-contract.md';
const physicsContractPath = join(root, physicsContractRelative);
if (!existsSync(physicsContractPath)) fail(`${physicsContractRelative} is missing`);

const physicsContract = readFileSync(physicsContractPath, 'utf8');
const physicsAbiRelative = 'threejs-choose-skills/references/physics-domain-and-interaction-contract.schema.json';
const physicsAbiPath = join(root, physicsAbiRelative);
if (!existsSync(physicsAbiPath)) fail(`${physicsAbiRelative} is missing`);
const physicsAbi = readJson(physicsAbiPath);
if (physicsAbi.$id !== 'threejs-physics-domain-and-interaction-abi/v1') {
  fail(`${physicsAbiRelative} has an unexpected $id`);
}
if (!physicsContract.includes('physics-domain-and-interaction-contract.schema.json')) {
  fail(`${physicsContractRelative} does not link the machine-readable ABI vocabulary`);
}
for (const token of [
  'PhysicsContext',
  'PhysicsGraph',
  'PhysicsTime',
  'PhysicsInstant',
  'PhysicsTimeInterval',
  'PhysicsDuration',
  'PhysicsCommitGroup',
  'PhysicsSignalDescriptor',
  'EnvironmentForcingSnapshot',
  'PrecipitationEmissionSnapshot',
  'LightingTransportSnapshot',
  'WaterSurfaceSample',
  'SupportSurfaceSample',
  'SurfaceExchange',
  'InteractionRecord',
  'InteractionReactionGroup',
  'InteractionBatchLedger',
  'ContactManifoldRecord',
  'PhysicsMaterialRegistry',
  'ColliderProxy',
  'RigidBodyProperties',
  'RigidBodyState',
  'HydrostaticHullProperties',
  'ExternalSolverAdapter',
  'PhysicsPresentationCandidate',
  'PresentedStatePair',
  'CameraViewPublication',
  'ViewPreparationPublication',
  'PhysicsPresentationSnapshot',
  'FrameExecutionRecord',
  'PresentationResourceLease',
  'QualityChangeRequest',
  'QualityTransition',
  'PhysicsCostLedger',
  'PhysicsOriginRebaseTransaction',
  'AuthoritativeGpuStateRecovery'
]) {
  if (!physicsContract.includes(token)) fail(`${physicsContractRelative} omits ${token}`);
}

const requiredAbiRecords = [
  'PhysicsContext', 'PhysicsInstant', 'PhysicsTimeInterval', 'PhysicsTime',
  'PhysicsDeadline', 'PhysicsClockDescriptor', 'ClockFixedRationalMapping',
  'ClockTimestampTableMapping', 'ClockPiecewiseMapping', 'ClockExternalMapping',
  'ClockMappingTableStorage', 'PhysicsSignalDescriptor', 'SampledChannel',
  'EnvironmentForcingSnapshot', 'PrecipitationEmissionSnapshot',
  'WaterSurfaceSample', 'SupportSurfaceSample', 'LightingTransportSnapshot',
  'PhysicsGraph',
  'PhysicsGraphStage', 'PhysicsGraphEdge', 'BoundedCouplingLoop',
  'PhysicsCommitGroup', 'PhysicsExecutionLedger', 'SurfaceExchange', 'InteractionRecord',
  'InteractionReactionGroup', 'InteractionBatchLedger',
  'ContactManifoldRecord', 'ConservationGroup', 'PhysicsMaterialRegistry',
  'ColliderProxy', 'RigidBodyProperties', 'RigidBodyState',
  'HydrostaticHullProperties', 'GpuStatePublication',
  'AuthoritativeGpuStateRecovery', 'ExternalSolverAdapter',
  'PhysicsPresentationCandidate', 'PresentationSampleProvenance',
  'PresentedStatePair', 'RenderSimilarityTransform', 'CameraViewPublication',
  'ViewPreparationPublication', 'PhysicsPresentationSnapshot',
  'ReactivePublication', 'ScopedResetAction', 'ReactiveMaskDescriptor',
  'PresentationResourceLease', 'PresentationResourceLeaseRef',
  'FrameExecutionRecord', 'PhysicsOriginRebaseTransaction',
  'QualityChangeRequest', 'QualityTransition',
  'PhysicsCostLedger'
];
const canonicalYamlRecords = new Map();
for (const block of physicsContract.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)) {
  let recordName;
  let keys = [];
  const flush = () => {
    if (!recordName) return;
    const prior = canonicalYamlRecords.get(recordName);
    if (prior && JSON.stringify(prior) !== JSON.stringify(keys)) {
      fail(`${physicsContractRelative} defines conflicting ${recordName} key sets`);
    }
    canonicalYamlRecords.set(recordName, keys);
  };
  for (const line of block[1].split('\n')) {
    const record = line.match(/^([A-Z][A-Za-z0-9_]*(?:<[^>]+>)?):\s*$/);
    if (record) {
      flush();
      recordName = record[1].replace(/<.*>$/, '');
      keys = [];
      continue;
    }
    if (!recordName) continue;
    const key = line.match(/^  ([A-Za-z][A-Za-z0-9_]*):/);
    if (key) keys.push(key[1]);
  }
  flush();
}
for (const recordName of [...canonicalYamlRecords.keys(), ...Object.keys(physicsAbi.records ?? {})]) {
  if (!requiredAbiRecords.includes(recordName)) requiredAbiRecords.push(recordName);
}
for (const recordName of requiredAbiRecords) {
  const record = physicsAbi.records?.[recordName];
  if (!record || !Array.isArray(record.required) || record.required.length === 0) {
    fail(`${physicsAbiRelative} omits required keys for ${recordName}`);
  }
  if (new Set(record.required).size !== record.required.length) {
    fail(`${physicsAbiRelative} repeats a required key in ${recordName}`);
  }
  const documentedKeys = canonicalYamlRecords.get(recordName);
  if (documentedKeys && JSON.stringify(record.required) !== JSON.stringify(documentedKeys)) {
    fail(`${physicsAbiRelative} ${recordName} required keys drift from the canonical YAML record`);
  }
}
const canonicalStageKinds = [
  'ingest', 'sample-forcing', 'predict', 'emit-interactions',
  'solve-subcycles', 'reduce-reactions', 'correct', 'commit',
  'publish-presentation'
];
if (JSON.stringify(physicsAbi.enums?.stageKinds) !== JSON.stringify(canonicalStageKinds)) {
  fail(`${physicsAbiRelative} stageKinds drift from the canonical scheduler order`);
}
for (const enumName of [
  'clockMappingKinds', 'clockMappingStorageKinds', 'clockOutOfRangePolicies',
  'samplePhases', 'writeDispositions', 'nativeStepRules', 'barrierKinds',
  'interactionPayloadTags', 'surfaceExchangeModes', 'reactiveKinds',
  'affectedRegionKinds',
  'resetPolicies', 'executionStatuses', 'targetExecutionStatuses',
  'leaseDispositions', 'externalTransportKinds', 'checkpointSupportKinds'
]) {
  const values = physicsAbi.enums?.[enumName];
  if (!Array.isArray(values) || values.length === 0 || new Set(values).size !== values.length) {
    fail(`${physicsAbiRelative} has an invalid ${enumName} enum`);
  }
}
if (physicsAbi.absencePolicy?.typedAbsenceOnly !== true ||
    !Array.isArray(physicsAbi.relationships) || physicsAbi.relationships.length < 10) {
  fail(`${physicsAbiRelative} omits typed absence or cross-record relationships`);
}

const readSkillCorpus = (dir) => {
  const chunks = [readFileSync(join(root, dir, 'SKILL.md'), 'utf8')];
  const referencesDir = join(root, dir, 'references');
  if (existsSync(referencesDir)) {
    for (const name of readdirSync(referencesDir).filter((entry) => entry.endsWith('.md'))) {
      chunks.push(readFileSync(join(referencesDir, name), 'utf8'));
    }
  }
  return chunks.join('\n');
};

const physicsRequirements = new Map([
  ['threejs-black-holes-and-space-effects', ['PhysicsContext', 'PhysicsSignalDescriptor', 'PhysicsPresentationSnapshot', 'LightingTransportSnapshot']],
  ['threejs-dynamic-surface-effects', ['PhysicsSignalDescriptor', 'PhysicsPresentationSnapshot']],
  ['threejs-compatibility-fallbacks', ['PhysicsContext', 'PhysicsPresentationSnapshot', 'QualityTransition']],
  ['threejs-procedural-fields', ['PhysicsContext', 'PhysicsGraph', 'PhysicsSignalDescriptor', 'PhysicsPresentationCandidate', 'QualityTransition', 'PhysicsMaterialRegistry']],
  ['threejs-procedural-geometry', ['PhysicsSignalDescriptor', 'SupportSurfaceSample', 'ContactManifoldRecord', 'ColliderProxy', 'PhysicsPresentationCandidate', 'QualityTransition']],
  ['threejs-procedural-materials', ['PhysicsSignalDescriptor', 'PhysicsMaterialRegistry', 'PhysicsPresentationCandidate', 'QualityTransition']],
  ['threejs-procedural-buildings-and-cities', ['ColliderProxy', 'RigidBodyProperties', 'HydrostaticHullProperties', 'ExternalSolverAdapter']],
  ['threejs-procedural-planets', ['PhysicsContext', 'PhysicsSignalDescriptor', 'PhysicsPresentationCandidate', 'PhysicsMaterialRegistry']],
  ['threejs-water-optics', ['WaterSurfaceSample', 'SurfaceExchange', 'InteractionRecord', 'LightingTransportSnapshot']],
  ['threejs-spectral-ocean', ['WaterSurfaceSample', 'PhysicsSignalDescriptor', 'LightingTransportSnapshot']],
  ['threejs-procedural-motion-systems', ['WaterSurfaceSample', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'InteractionRecord', 'QualityTransition']],
  ['threejs-procedural-creatures', ['WaterSurfaceSample', 'SupportSurfaceSample', 'InteractionRecord', 'PhysicsPresentationSnapshot']],
  ['threejs-procedural-vegetation', ['EnvironmentForcingSnapshot', 'InteractionRecord', 'PhysicsPresentationSnapshot']],
  ['threejs-rain-snow-and-wet-surfaces', ['EnvironmentForcingSnapshot', 'PrecipitationEmissionSnapshot', 'SurfaceExchange', 'InteractionRecord']],
  ['threejs-volumetric-clouds', ['EnvironmentForcingSnapshot', 'PrecipitationEmissionSnapshot', 'LightingTransportSnapshot']],
  ['threejs-sky-atmosphere-and-haze', ['LightingTransportSnapshot']],
  ['threejs-particles-trails-and-effects', ['SupportSurfaceSample', 'ContactManifoldRecord', 'PhysicsMaterialRegistry', 'InteractionRecord', 'InteractionBatchLedger', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'PresentationResourceLease', 'FrameExecutionRecord', 'QualityTransition']],
  ['threejs-camera-controls-and-rigs', ['PhysicsPresentationCandidate', 'PresentedStatePair', 'PhysicsPresentationSnapshot']],
  ['threejs-scalable-real-time-shadows', ['PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot']],
  ['threejs-ambient-contact-shading', ['PhysicsContext']],
  ['threejs-image-pipeline', ['PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord']],
  ['threejs-exposure-color-grading', ['LightingTransportSnapshot']],
  ['threejs-bloom', ['LightingTransportSnapshot']],
  ['threejs-visual-validation', ['PhysicsGraph', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord', 'QualityTransition']]
]);

const nonPhysicsSkillDirs = new Set(['threejs-choose-skills', 'threejs-debugging']);
const expectedPhysicsSkillDirs = skillDirs.filter((dir) => !nonPhysicsSkillDirs.has(dir)).sort();
const linkedPhysicsSkillDirs = [...physicsRequirements.keys()].sort();
if (JSON.stringify(expectedPhysicsSkillDirs) !== JSON.stringify(linkedPhysicsSkillDirs)) {
  fail('physics linkage requirements do not cover every non-router skill exactly once');
}

for (const [dir, tokens] of physicsRequirements) {
  const skillText = readFileSync(join(root, dir, 'SKILL.md'), 'utf8');
  if (!skillText.includes('physics-domain-and-interaction-contract.md')) {
    fail(`${dir}/SKILL.md does not link the shared physics contract`);
  }
  const corpus = readSkillCorpus(dir);
  for (const token of tokens) {
    if (!corpus.includes(token)) fail(`${dir} physics linkage omits ${token}`);
  }
}

const routerRecipes = readFileSync(join(root, 'threejs-choose-skills', 'references', 'router-recipes.md'), 'utf8');
for (const token of ['physicsContext:', 'physicsGraph:', 'PhysicsPresentationSnapshot']) {
  if (!routerRecipes.includes(token)) fail(`router-recipes.md omits ${token}`);
}

for (const dir of skillDirs) {
  const corpus = readSkillCorpus(dir);
  const forbiddenPhysicsDialects = [
    [/weather-water\s+skill/i, 'routes to the nonexistent weather-water skill'],
    [/\bsampleWaterState\b/, 'uses the retired sampleWaterState dialect'],
    [/\bWaterProvider\b/, 'uses WaterProvider instead of WaterSurfaceProvider'],
    [/per-domain\s+PresentedStatePair/i, 'uses one presented pair per domain instead of per stable binding/provider'],
    [/quantityConvention|workingPrimariesOrSpectralBasis/, 'uses a bundle-wide radiometry dialect']
  ];
  for (const [pattern, message] of forbiddenPhysicsDialects) {
    if (pattern.test(corpus)) fail(`${dir} ${message}`);
  }
}

console.log(`Validated ${skillDirs.length} skills for ${repoSlug}`);
