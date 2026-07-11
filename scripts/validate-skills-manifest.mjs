#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoSlug = 'linegel/threejs-complete-set-of-skill';

const fail = (message) => {
  console.error(`skills manifest validation failed: ${message}`);
  process.exit(1);
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const sortedUnique = (values) => [...new Set(values)].sort();
const sameStringSet = (left, right) =>
  JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));

const visitJson = (value, visitor, path = '#') => {
  if (!value || typeof value !== 'object') return;
  visitor(value, path);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitJson(entry, visitor, `${path}/${index}`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const escapedKey = key.replaceAll('~', '~0').replaceAll('/', '~1');
    visitJson(entry, visitor, `${path}/${escapedKey}`);
  }
};

const resolveLocalJsonReference = (document, reference, sourcePath) => {
  if (!reference.startsWith('#')) return undefined;
  if (reference === '#') return document;

  const fragment = decodeURIComponent(reference.slice(1));
  if (!fragment.startsWith('/')) {
    const matches = [];
    visitJson(document, (node, path) => {
      if (node.$anchor === fragment || node.$dynamicAnchor === fragment) matches.push({ node, path });
    });
    if (matches.length !== 1) {
      fail(`${physicsAbiRelative} ${sourcePath} local reference ${reference} resolves to ${matches.length} anchors`);
    }
    return matches[0].node;
  }

  let cursor = document;
  for (const encodedToken of fragment.slice(1).split('/')) {
    const token = encodedToken.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!cursor || typeof cursor !== 'object' || !Object.hasOwn(cursor, token)) {
      fail(`${physicsAbiRelative} ${sourcePath} has unresolved local reference ${reference}`);
    }
    cursor = cursor[token];
  }
  return cursor;
};

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
const abiRecords = physicsAbi['x-abi-records'];
const abiEnums = physicsAbi['x-abi-enums'];
const abiAbsencePolicy = physicsAbi['x-abi-absence-policy'];
const semanticInvariants = physicsAbi['x-semantic-invariants'];
const abiRelationships = physicsAbi['x-abi-relationships'];
if (physicsAbi.type !== 'object' || !physicsAbi.$defs || typeof physicsAbi.$defs !== 'object') {
  fail(`${physicsAbiRelative} is not an executable object schema with $defs`);
}
if (!abiRecords || typeof abiRecords !== 'object' || !abiEnums || typeof abiEnums !== 'object' ||
    !Array.isArray(abiRelationships) || abiRelationships.length === 0) {
  fail(`${physicsAbiRelative} omits x-abi-records, x-abi-enums, or x-abi-relationships metadata`);
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
for (const recordName of [...canonicalYamlRecords.keys(), ...Object.keys(abiRecords)]) {
  if (!requiredAbiRecords.includes(recordName)) requiredAbiRecords.push(recordName);
}
for (const recordName of requiredAbiRecords) {
  const record = abiRecords[recordName];
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
  const executableDefinition = physicsAbi.$defs[recordName];
  if (!executableDefinition || executableDefinition.type !== 'object') {
    fail(`${physicsAbiRelative} omits executable $defs.${recordName}`);
  }
  if (JSON.stringify(executableDefinition.required) !== JSON.stringify(record.required)) {
    fail(`${physicsAbiRelative} $defs.${recordName}.required drifts from x-abi-records metadata`);
  }
  if (!executableDefinition.properties || typeof executableDefinition.properties !== 'object' ||
      Array.isArray(executableDefinition.properties)) {
    fail(`${physicsAbiRelative} $defs.${recordName} has no executable properties object`);
  }
  const executablePropertyNames = Object.keys(executableDefinition.properties);
  if (!sameStringSet(executablePropertyNames, record.required)) {
    const missing = record.required.filter((name) => !executablePropertyNames.includes(name));
    const undeclared = executablePropertyNames.filter((name) => !record.required.includes(name));
    fail(`${physicsAbiRelative} $defs.${recordName} property set differs from x-abi-records metadata ` +
      `(missing: ${missing.join(', ') || 'none'}; undeclared: ${undeclared.join(', ') || 'none'})`);
  }
  if (executableDefinition.additionalProperties !== false) {
    fail(`${physicsAbiRelative} $defs.${recordName} must set additionalProperties: false`);
  }
}

const recordNames = Object.keys(abiRecords);
const rootRecordTypes = physicsAbi.properties?.recordType?.enum;
if (!Array.isArray(rootRecordTypes) || !sameStringSet(rootRecordTypes, recordNames) ||
    rootRecordTypes.length !== recordNames.length) {
  fail(`${physicsAbiRelative} root recordType enum must dispatch every x-abi-record exactly once`);
}
if (!Array.isArray(physicsAbi.allOf)) {
  fail(`${physicsAbiRelative} root allOf dispatch table is missing`);
}
const dispatchCounts = new Map(recordNames.map((recordName) => [recordName, 0]));
const dispatchDefinitionByRecord = new Map();
for (const [index, branch] of physicsAbi.allOf.entries()) {
  const recordName = branch?.if?.properties?.recordType?.const;
  const valueReference = branch?.then?.properties?.value?.$ref;
  if (typeof recordName !== 'string' || typeof valueReference !== 'string' ||
      !branch.if?.required?.includes('recordType')) {
    fail(`${physicsAbiRelative} root allOf[${index}] is not a complete recordType/value dispatch`);
  }
  if (!dispatchCounts.has(recordName)) {
    fail(`${physicsAbiRelative} root dispatch references unknown record ${recordName}`);
  }
  const expectedReference = `#/$defs/${recordName}`;
  if (valueReference !== expectedReference) {
    fail(`${physicsAbiRelative} root dispatch for ${recordName} targets ${valueReference}, expected ${expectedReference}`);
  }
  resolveLocalJsonReference(physicsAbi, valueReference, `allOf[${index}]`);
  dispatchCounts.set(recordName, dispatchCounts.get(recordName) + 1);
  dispatchDefinitionByRecord.set(recordName, recordName);
}
for (const [recordName, count] of dispatchCounts) {
  if (count !== 1) fail(`${physicsAbiRelative} dispatches ${recordName} ${count} times, expected exactly once`);
}
if (physicsAbi.allOf.length !== recordNames.length) {
  fail(`${physicsAbiRelative} root dispatch count differs from x-abi-record count`);
}

visitJson(physicsAbi, (node, path) => {
  if (typeof node.$ref !== 'string' || !node.$ref.startsWith('#')) return;
  resolveLocalJsonReference(physicsAbi, node.$ref, path);
});

const definitionReferences = new Map(Object.keys(physicsAbi.$defs).map((name) => [name, new Set()]));
const incomingDefinitionReferences = new Map(Object.keys(physicsAbi.$defs).map((name) => [name, new Set()]));
for (const [definitionName, definition] of Object.entries(physicsAbi.$defs)) {
  visitJson(definition, (node, path) => {
    if (typeof node.$ref !== 'string' || !node.$ref.startsWith('#/$defs/')) return;
    const referencedName = decodeURIComponent(node.$ref.slice('#/$defs/'.length).split('/')[0])
      .replaceAll('~1', '/')
      .replaceAll('~0', '~');
    if (!Object.hasOwn(physicsAbi.$defs, referencedName)) {
      fail(`${physicsAbiRelative} $defs.${definitionName}${path.slice(1)} references missing $defs.${referencedName}`);
    }
    definitionReferences.get(definitionName).add(referencedName);
    incomingDefinitionReferences.get(referencedName).add(definitionName);
  });
}

const reachableDefinitions = new Set(dispatchDefinitionByRecord.values());
const pendingDefinitions = [...reachableDefinitions];
while (pendingDefinitions.length > 0) {
  const definitionName = pendingDefinitions.pop();
  for (const referencedName of definitionReferences.get(definitionName) ?? []) {
    if (reachableDefinitions.has(referencedName)) continue;
    reachableDefinitions.add(referencedName);
    pendingDefinitions.push(referencedName);
  }
}
const unreachableDefinitions = Object.keys(physicsAbi.$defs)
  .filter((definitionName) => !reachableDefinitions.has(definitionName));
if (unreachableDefinitions.length > 0) {
  fail(`${physicsAbiRelative} has $defs unreachable from root record dispatch: ${unreachableDefinitions.join(', ')}`);
}

const enumDefinitionByFamily = new Map();
for (const [definitionName, definition] of Object.entries(physicsAbi.$defs)) {
  const familyName = definition['x-abi-enum-family'];
  const hasConcreteEnum = Array.isArray(definition.enum);
  const hasConcreteConst = Object.hasOwn(definition, 'const');
  if (familyName === undefined) continue;
  if (typeof familyName !== 'string' || !Object.hasOwn(abiEnums, familyName)) {
    fail(`${physicsAbiRelative} $defs.${definitionName} names unknown x-abi-enum-family ${familyName}`);
  }
  if (hasConcreteEnum === hasConcreteConst) {
    fail(`${physicsAbiRelative} $defs.${definitionName} must define exactly one of enum or const`);
  }
  if (definition.type !== 'string') {
    fail(`${physicsAbiRelative} $defs.${definitionName} enum family ${familyName} must have type: string`);
  }
  if (enumDefinitionByFamily.has(familyName)) {
    fail(`${physicsAbiRelative} enum family ${familyName} has duplicate definitions ` +
      `${enumDefinitionByFamily.get(familyName)} and ${definitionName}`);
  }
  const executableValues = hasConcreteEnum ? definition.enum : [definition.const];
  if (JSON.stringify(executableValues) !== JSON.stringify(abiEnums[familyName])) {
    fail(`${physicsAbiRelative} $defs.${definitionName} values drift from x-abi-enums.${familyName}`);
  }
  if ((incomingDefinitionReferences.get(definitionName)?.size ?? 0) === 0) {
    fail(`${physicsAbiRelative} $defs.${definitionName} enum family ${familyName} has no live $ref usage`);
  }
  enumDefinitionByFamily.set(familyName, definitionName);
}
for (const familyName of Object.keys(abiEnums)) {
  if (!enumDefinitionByFamily.has(familyName)) {
    fail(`${physicsAbiRelative} x-abi-enums.${familyName} has no annotated executable enum/const definition`);
  }
}
const canonicalStageKinds = [
  'ingest', 'sample-forcing', 'predict', 'emit-interactions',
  'solve-subcycles', 'reduce-reactions', 'correct', 'commit',
  'publish-presentation'
];
if (JSON.stringify(abiEnums.stageKinds) !== JSON.stringify(canonicalStageKinds)) {
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
  const values = abiEnums[enumName];
  if (!Array.isArray(values) || values.length === 0 || new Set(values).size !== values.length) {
    fail(`${physicsAbiRelative} has an invalid ${enumName} enum`);
  }
}
if (abiAbsencePolicy?.typedAbsenceOnly !== true ||
    !Array.isArray(semanticInvariants) || semanticInvariants.length < 10 ||
    semanticInvariants.some((invariant) => !invariant?.id || !invariant?.validator || !Array.isArray(invariant?.appliesTo))) {
  fail(`${physicsAbiRelative} omits typed absence or cross-record relationships`);
}

const declaredAbiTargets = new Set([...recordNames, ...Object.keys(physicsAbi.$defs)]);
const semanticInvariantIds = new Set();
const semanticInvariantByValidator = new Map();
for (const [index, invariant] of semanticInvariants.entries()) {
  if (typeof invariant.id !== 'string' || invariant.id.trim() !== invariant.id || invariant.id.length < 8) {
    fail(`${physicsAbiRelative} x-semantic-invariants[${index}] has an invalid id`);
  }
  if (semanticInvariantIds.has(invariant.id)) {
    fail(`${physicsAbiRelative} repeats semantic invariant id ${invariant.id}`);
  }
  semanticInvariantIds.add(invariant.id);
  if (typeof invariant.validator !== 'string' ||
      !/^validate[A-Z][A-Za-z0-9]*$/.test(invariant.validator)) {
    fail(`${physicsAbiRelative} semantic invariant ${invariant.id} has an invalid validator name`);
  }
  if (semanticInvariantByValidator.has(invariant.validator)) {
    fail(`${physicsAbiRelative} validator ${invariant.validator} is declared by multiple semantic invariants`);
  }
  if (invariant.appliesTo.length === 0 ||
      new Set(invariant.appliesTo).size !== invariant.appliesTo.length ||
      invariant.appliesTo.some((target) => typeof target !== 'string' || !declaredAbiTargets.has(target))) {
    fail(`${physicsAbiRelative} semantic invariant ${invariant.id} has unresolved or duplicate appliesTo targets`);
  }
  semanticInvariantByValidator.set(invariant.validator, invariant);
}

const provePhysicsTimeExclusiveArms = () => {
  const time = physicsAbi.$defs.PhysicsTime;
  const absence = physicsAbi.$defs.TypedAbsence;
  if (time?.type !== 'object' || time.additionalProperties !== false ||
      !sameStringSet(time.required ?? [], ['kind', 'instant', 'interval']) ||
      !sameStringSet(Object.keys(time.properties ?? {}), ['kind', 'instant', 'interval']) ||
      !sameStringSet(abiEnums.physicsTimeKinds ?? [], ['instant', 'interval']) ||
      !Array.isArray(time.oneOf) || time.oneOf.length !== 2 ||
      absence?.type !== 'object' || absence.additionalProperties !== false ||
      absence.properties?.kind?.const !== 'absent' || !absence.required?.includes('kind')) {
    return false;
  }

  for (const presentDefinitionName of ['PhysicsInstant', 'PhysicsTimeInterval']) {
    const present = physicsAbi.$defs[presentDefinitionName];
    if (present?.type !== 'object' || present.additionalProperties !== false ||
        Object.hasOwn(present.properties ?? {}, 'kind')) return false;
  }

  const expectedArms = new Map([
    ['instant', { instant: 'PhysicsInstant', interval: 'TypedAbsence' }],
    ['interval', { instant: 'TypedAbsence', interval: 'PhysicsTimeInterval' }]
  ]);
  const observedKinds = new Set();
  for (const arm of time.oneOf) {
    if (!arm?.properties || !sameStringSet(Object.keys(arm.properties), ['kind', 'instant', 'interval'])) {
      return false;
    }
    const kind = arm.properties.kind?.const;
    const expected = expectedArms.get(kind);
    if (!expected || observedKinds.has(kind)) return false;
    if (arm.properties.instant?.$ref !== `#/$defs/${expected.instant}` ||
        arm.properties.interval?.$ref !== `#/$defs/${expected.interval}`) return false;
    observedKinds.add(kind);
  }
  return observedKinds.size === expectedArms.size;
};

const structuralOnlyRelationshipProofs = new Map([
  ['PHY-REL-TIME-ARM-001', {
    appliesTo: ['PhysicsTime'],
    prove: provePhysicsTimeExclusiveArms
  }]
]);
const relationshipIds = new Set();
const expectedRelationshipKeys = ['appliesTo', 'description', 'enforcedBy', 'id'];
for (const [index, relationship] of abiRelationships.entries()) {
  if (!relationship || typeof relationship !== 'object' || Array.isArray(relationship) ||
      !sameStringSet(Object.keys(relationship), expectedRelationshipKeys)) {
    fail(`${physicsAbiRelative} x-abi-relationships[${index}] must be one structured relationship object`);
  }
  if (typeof relationship.id !== 'string' || relationship.id.trim() !== relationship.id ||
      !/^PHY-REL-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3}$/.test(relationship.id)) {
    fail(`${physicsAbiRelative} x-abi-relationships[${index}] has an invalid id`);
  }
  if (relationshipIds.has(relationship.id)) {
    fail(`${physicsAbiRelative} repeats relationship id ${relationship.id}`);
  }
  relationshipIds.add(relationship.id);
  if (typeof relationship.description !== 'string' ||
      relationship.description.trim() !== relationship.description ||
      relationship.description.length < 16 ||
      /^(?:decorative|n\/?a|none|placeholder|tbd|todo)$/i.test(relationship.description)) {
    fail(`${physicsAbiRelative} relationship ${relationship.id} has an empty or decorative description`);
  }
  if (!Array.isArray(relationship.appliesTo) || relationship.appliesTo.length === 0 ||
      new Set(relationship.appliesTo).size !== relationship.appliesTo.length ||
      relationship.appliesTo.some((target) => typeof target !== 'string' || !declaredAbiTargets.has(target))) {
    fail(`${physicsAbiRelative} relationship ${relationship.id} has unresolved or duplicate appliesTo targets`);
  }
  if (!Array.isArray(relationship.enforcedBy) || relationship.enforcedBy.length === 0 ||
      new Set(relationship.enforcedBy).size !== relationship.enforcedBy.length ||
      relationship.enforcedBy.some((validator) => typeof validator !== 'string')) {
    fail(`${physicsAbiRelative} relationship ${relationship.id} has invalid or duplicate enforcedBy entries`);
  }

  const semanticValidators = [];
  for (const validatorName of relationship.enforcedBy) {
    if (validatorName === 'structural-schema') continue;
    const invariant = semanticInvariantByValidator.get(validatorName);
    if (!invariant) {
      fail(`${physicsAbiRelative} relationship ${relationship.id} names undeclared validator ${validatorName}`);
    }
    if (!invariant.appliesTo.some((target) => relationship.appliesTo.includes(target))) {
      fail(`${physicsAbiRelative} relationship ${relationship.id} validator ${validatorName} has no appliesTo overlap`);
    }
    semanticValidators.push(validatorName);
  }

  if (semanticValidators.length === 0) {
    const proof = structuralOnlyRelationshipProofs.get(relationship.id);
    if (!proof || !sameStringSet(relationship.appliesTo, proof.appliesTo) ||
        !sameStringSet(relationship.enforcedBy, ['structural-schema']) || !proof.prove()) {
      fail(`${physicsAbiRelative} relationship ${relationship.id} has no semantic validator or structural-only proof`);
    }
  }
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

const readPhysicsBoundaryProse = (dir) => {
  const skillText = readFileSync(join(root, dir, 'SKILL.md'), 'utf8');
  const lines = skillText.split('\n');
  const keptLines = [];
  let inFrontmatter = lines[0] === '---';
  let inFence = false;
  let excludedSectionLevel = undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (inFrontmatter) {
      if (index > 0 && line === '---') inFrontmatter = false;
      continue;
    }
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      if (excludedSectionLevel !== undefined && level <= excludedSectionLevel) {
        excludedSectionLevel = undefined;
      }
      if (/\b(?:references?|examples?|labs?)\b/i.test(heading[2])) {
        excludedSectionLevel = level;
      }
      if (excludedSectionLevel !== undefined) continue;
    } else if (excludedSectionLevel !== undefined) {
      continue;
    }

    if (/^\s*<!--/.test(line) || /^\s*\[[^\]]+\]:\s*/.test(line)) continue;
    keptLines.push(line);
  }

  return keptLines.join('\n')
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/<https?:\/\/[^>]+>/g, '')
    .replace(/`([^`]+)`/g, '$1');
};

const hasPositiveBoundaryToken = (prose, token) => {
  const exactToken = tokenPattern(token);
  const negation = /\b(?:absent|cannot|can't|deprecated|doesn't|does\s+not|forbid(?:den|s)?|missing|mustn't|never|no(?!-op\b)|not|omit(?:s|ted)?|unavailable|unnecessary|unsupported|without)\b/i;
  for (const paragraph of prose.split(/\n\s*\n/)) {
    if (!exactToken.test(paragraph)) continue;
    const clauses = paragraph.replace(/\s*\n\s*/g, ' ').split(/[.!?;|]+/);
    if (clauses.some((clause) => exactToken.test(clause) && !negation.test(clause))) return true;
  }
  return false;
};

const channelFamilyAbiToken = new Map([
  ['environment-forcing', 'EnvironmentForcingSnapshot'],
  ['precipitation-emission', 'PrecipitationEmissionSnapshot'],
  ['water-surface', 'WaterSurfaceSample'],
  ['support-surface', 'SupportSurfaceSample'],
  ['collider-proxy', 'ColliderProxy'],
  ['lighting-transport', 'LightingTransportSnapshot'],
  ['presentation-state', 'PhysicsPresentationCandidate']
]);

const physicsBoundaryMatrix = {
  'threejs-ambient-contact-shading': {
    applicability: { status: 'applicable', justification: 'AO consumes physics-scaled geometry and an immutable presented frame.' },
    coordinator: [], provider: [], consumer: [], interaction: [], graph: [],
    presentation: ['snapshot-consumer'], quality: ['presentation-only'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord']
  },
  'threejs-black-holes-and-space-effects': {
    applicability: { status: 'applicable', justification: 'Curved-ray rendering consumes routed metric, radiometry, and presentation publications.' },
    coordinator: [], provider: [], consumer: ['lighting-transport', 'presentation-state'], interaction: [], graph: ['consumer'],
    presentation: ['snapshot-consumer'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsSignalDescriptor', 'LightingTransportSnapshot', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'QualityTransition']
  },
  'threejs-bloom': {
    applicability: { status: 'applicable', justification: 'HDR emission and lighting must be read from the sealed physical presentation lineage.' },
    coordinator: [], provider: [], consumer: ['lighting-transport', 'presentation-state'], interaction: [], graph: [],
    presentation: ['snapshot-consumer'], quality: ['presentation-only'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['LightingTransportSnapshot', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord']
  },
  'threejs-camera-controls-and-rigs': {
    applicability: { status: 'applicable', justification: 'The camera consumes physical candidates and owns the per-view publication used during snapshot sealing.' },
    coordinator: [], provider: [], consumer: ['presentation-state'], interaction: [], graph: [],
    presentation: ['camera-owner'], quality: ['presentation-only'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsPresentationCandidate', 'PresentedStatePair', 'CameraViewPublication', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord']
  },
  'threejs-choose-skills': {
    applicability: { status: 'applicable', justification: 'The router selects owners and freezes the common physical route contract.' },
    coordinator: ['route', 'context', 'graph', 'interaction', 'quality'], provider: [], consumer: [], interaction: ['coordinator'], graph: ['coordinator'],
    presentation: [], quality: ['coordinator'], validation: ['route-preflight', 'contract-gate'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsGraph', 'PhysicsSignalDescriptor', 'EnvironmentForcingSnapshot', 'SurfaceExchange', 'InteractionRecord', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord', 'QualityTransition', 'PhysicsCostLedger']
  },
  'threejs-compatibility-fallbacks': {
    applicability: { status: 'applicable', justification: 'An explicitly requested fallback must preserve physical identities, state, and presentation closure.' },
    coordinator: [], provider: [], consumer: [], interaction: ['preserve'], graph: ['preserve'],
    presentation: ['preserve'], quality: ['preserve'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsGraph', 'PhysicsSignalDescriptor', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'QualityTransition']
  },
  'threejs-debugging': {
    applicability: { status: 'applicable', justification: 'Physical-route reduction must preserve the shared context, graph, interactions, and snapshot closure.' },
    coordinator: [], provider: [], consumer: [], interaction: ['observer'], graph: ['observer'],
    presentation: ['snapshot-consumer'], quality: ['observer'], validation: ['diagnostic-preservation', 'contract-gate'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsGraph', 'InteractionRecord', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord']
  },
  'threejs-dynamic-surface-effects': {
    applicability: { status: 'applicable', justification: 'The effect reads sealed physical appearance channels while keeping screen-space history presentation-only.' },
    coordinator: [], provider: [], consumer: ['presentation-state'], interaction: [], graph: [],
    presentation: ['snapshot-consumer'], quality: ['presentation-only'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsSignalDescriptor', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'QualityTransition']
  },
  'threejs-exposure-color-grading': {
    applicability: { status: 'applicable', justification: 'Exposure consumes dimensioned lighting through the immutable presentation chain.' },
    coordinator: [], provider: [], consumer: ['lighting-transport', 'presentation-state'], interaction: [], graph: [],
    presentation: ['snapshot-consumer'], quality: ['presentation-only'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['LightingTransportSnapshot', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord']
  },
  'threejs-image-pipeline': {
    applicability: { status: 'applicable', justification: 'The final-image owner consumes physical candidates and closes per-view execution.' },
    coordinator: ['presentation'], provider: [], consumer: ['lighting-transport', 'presentation-state'], interaction: [], graph: [],
    presentation: ['preparation-owner', 'snapshot-owner', 'execution-owner'], quality: ['presentation-only'], validation: ['contract-gate', 'mechanism-evidence'],
    requiredAbiTokens: ['LightingTransportSnapshot', 'PhysicsPresentationCandidate', 'CameraViewPublication', 'ViewPreparationPublication', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord']
  },
  'threejs-object-sculptor': {
    applicability: { status: 'applicable', justification: 'Action-ready generated assets adapt stable collider, body, fracture, and presentation identities into the shared physical route.' },
    coordinator: [], provider: ['collider-proxy', 'presentation-state'], consumer: [], interaction: ['adapter'], graph: [],
    presentation: ['candidate-provider', 'snapshot-consumer'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'ColliderProxy', 'RigidBodyProperties', 'ExternalSolverAdapter', 'InteractionRecord', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord', 'QualityTransition']
  },
  'threejs-particles-trails-and-effects': {
    applicability: { status: 'applicable', justification: 'Physical particles consume forcing/support and emit bounded exactly-once interactions.' },
    coordinator: [], provider: ['presentation-state'], consumer: ['environment-forcing', 'support-surface', 'collider-proxy'], interaction: ['producer', 'consumer'], graph: ['stage-owner'],
    presentation: ['candidate-provider', 'snapshot-consumer'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['EnvironmentForcingSnapshot', 'SupportSurfaceSample', 'ColliderProxy', 'ContactManifoldRecord', 'PhysicsMaterialRegistry', 'InteractionRecord', 'InteractionBatchLedger', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'PresentationResourceLease', 'FrameExecutionRecord', 'QualityTransition']
  },
  'threejs-procedural-buildings-and-cities': {
    applicability: { status: 'applicable', justification: 'Physics-facing site assets publish stable colliders, body properties, and solver adapters.' },
    coordinator: [], provider: ['collider-proxy'], consumer: [], interaction: ['adapter'], graph: [],
    presentation: ['candidate-provider'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsGraph', 'ColliderProxy', 'RigidBodyProperties', 'HydrostaticHullProperties', 'ExternalSolverAdapter', 'PhysicsPresentationCandidate', 'FrameExecutionRecord']
  },
  'threejs-procedural-creatures': {
    applicability: { status: 'applicable', justification: 'Creature locomotion couples forcing, support, water, contact, and presentation state.' },
    coordinator: [], provider: ['presentation-state'], consumer: ['environment-forcing', 'water-surface', 'support-surface'], interaction: ['producer', 'consumer'], graph: ['stage-owner'],
    presentation: ['candidate-provider', 'snapshot-consumer'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsGraph', 'EnvironmentForcingSnapshot', 'WaterSurfaceSample', 'SupportSurfaceSample', 'InteractionRecord', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord', 'QualityTransition']
  },
  'threejs-procedural-fields': {
    applicability: { status: 'applicable', justification: 'Physics fields publish versioned SI signals and immutable render projections.' },
    coordinator: [], provider: ['presentation-state'], consumer: [], interaction: [], graph: ['stage-owner'],
    presentation: ['candidate-provider'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsGraph', 'PhysicsSignalDescriptor', 'PhysicsMaterialRegistry', 'PhysicsPresentationCandidate', 'FrameExecutionRecord', 'QualityTransition']
  },
  'threejs-procedural-geometry': {
    applicability: { status: 'applicable', justification: 'Authoritative geometry supplies support and collision proxies independent of render LOD.' },
    coordinator: [], provider: ['support-surface', 'collider-proxy', 'presentation-state'], consumer: [], interaction: [], graph: [],
    presentation: ['candidate-provider'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsSignalDescriptor', 'SupportSurfaceSample', 'ContactManifoldRecord', 'ColliderProxy', 'PhysicsPresentationCandidate', 'FrameExecutionRecord', 'QualityTransition']
  },
  'threejs-procedural-materials': {
    applicability: { status: 'applicable', justification: 'Rendered surfaces bind semantic physics materials and project dynamic physical causes.' },
    coordinator: [], provider: ['presentation-state'], consumer: [], interaction: [], graph: [],
    presentation: ['candidate-provider'], quality: ['presentation-only'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsGraph', 'PhysicsSignalDescriptor', 'PhysicsMaterialRegistry', 'PhysicsPresentationCandidate', 'FrameExecutionRecord', 'QualityTransition']
  },
  'threejs-procedural-motion-systems': {
    applicability: { status: 'applicable', justification: 'Motion integrates actor state against water and interaction providers on the shared graph.' },
    coordinator: [], provider: ['presentation-state'], consumer: ['water-surface'], interaction: ['producer', 'consumer'], graph: ['stage-owner'],
    presentation: ['candidate-provider', 'snapshot-consumer'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsGraph', 'WaterSurfaceSample', 'SurfaceExchange', 'InteractionRecord', 'InteractionBatchLedger', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord', 'QualityTransition']
  },
  'threejs-procedural-planets': {
    applicability: { status: 'applicable', justification: 'Planet fields, frames, gravity, and LOD transitions are physics-facing publications.' },
    coordinator: [], provider: ['presentation-state'], consumer: ['environment-forcing'], interaction: [], graph: ['stage-owner'],
    presentation: ['candidate-provider'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsGraph', 'PhysicsSignalDescriptor', 'EnvironmentForcingSnapshot', 'PhysicsMaterialRegistry', 'PhysicsPresentationCandidate', 'FrameExecutionRecord', 'QualityTransition']
  },
  'threejs-procedural-vegetation': {
    applicability: { status: 'applicable', justification: 'Vegetation consumes shared forcing and completed contact/load records for structural response.' },
    coordinator: [], provider: ['presentation-state'], consumer: ['environment-forcing'], interaction: ['consumer'], graph: ['stage-owner'],
    presentation: ['candidate-provider', 'snapshot-consumer'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsGraph', 'EnvironmentForcingSnapshot', 'InteractionRecord', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'QualityTransition']
  },
  'threejs-rain-snow-and-wet-surfaces': {
    applicability: { status: 'applicable', justification: 'Precipitation transport and receiver storage exchange mass, momentum, and heat.' },
    coordinator: [], provider: ['presentation-state'], consumer: ['environment-forcing', 'precipitation-emission'], interaction: ['producer', 'consumer', 'exchange-owner'], graph: ['stage-owner'],
    presentation: ['candidate-provider', 'snapshot-consumer'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsGraph', 'EnvironmentForcingSnapshot', 'PrecipitationEmissionSnapshot', 'SurfaceExchange', 'InteractionRecord', 'InteractionBatchLedger', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'QualityTransition']
  },
  'threejs-scalable-real-time-shadows': {
    applicability: { status: 'applicable', justification: 'Physical motion and lighting drive bounded shadow publications and reset regions.' },
    coordinator: [], provider: [], consumer: ['lighting-transport', 'presentation-state'], interaction: [], graph: [],
    presentation: ['preparation-provider'], quality: ['presentation-only'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['LightingTransportSnapshot', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord']
  },
  'threejs-sky-atmosphere-and-haze': {
    applicability: { status: 'applicable', justification: 'Atmosphere publishes the routed lighting transport signal and consumes mechanical forcing.' },
    coordinator: [], provider: ['lighting-transport', 'presentation-state'], consumer: ['environment-forcing'], interaction: [], graph: ['stage-owner'],
    presentation: ['candidate-provider', 'snapshot-consumer'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsGraph', 'EnvironmentForcingSnapshot', 'LightingTransportSnapshot', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'QualityTransition']
  },
  'threejs-spectral-ocean': {
    applicability: { status: 'applicable', justification: 'The offshore solver publishes water state and consumes forcing and lighting providers.' },
    coordinator: [], provider: ['water-surface', 'presentation-state'], consumer: ['environment-forcing', 'lighting-transport'], interaction: [], graph: ['stage-owner'],
    presentation: ['candidate-provider', 'snapshot-consumer'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsGraph', 'PhysicsSignalDescriptor', 'EnvironmentForcingSnapshot', 'WaterSurfaceSample', 'LightingTransportSnapshot', 'SurfaceExchange', 'InteractionRecord', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord', 'QualityTransition']
  },
  'threejs-visual-validation': {
    applicability: { status: 'applicable', justification: 'Validation must falsify scheduler, interaction, presentation, and cost claims.' },
    coordinator: [], provider: [], consumer: ['lighting-transport', 'presentation-state'], interaction: ['observer'], graph: ['observer'],
    presentation: ['snapshot-consumer'], quality: ['observer'], validation: ['contract-gate', 'mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsGraph', 'LightingTransportSnapshot', 'InteractionRecord', 'InteractionBatchLedger', 'InteractionReactionGroup', 'ConservationGroup', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord', 'QualityTransition', 'PhysicsCostLedger']
  },
  'threejs-volumetric-clouds': {
    applicability: { status: 'applicable', justification: 'Causal clouds consume forcing and lighting and may publish conserved precipitation emission.' },
    coordinator: [], provider: ['precipitation-emission', 'presentation-state'], consumer: ['environment-forcing', 'lighting-transport'], interaction: [], graph: ['stage-owner'],
    presentation: ['candidate-provider', 'snapshot-consumer'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsGraph', 'EnvironmentForcingSnapshot', 'PrecipitationEmissionSnapshot', 'LightingTransportSnapshot', 'InteractionRecord', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'QualityTransition']
  },
  'threejs-water-optics': {
    applicability: { status: 'applicable', justification: 'Coastal water owns canonical free-surface queries, coupling, and optical presentation.' },
    coordinator: [], provider: ['water-surface', 'presentation-state'], consumer: ['lighting-transport'], interaction: ['producer', 'consumer', 'exchange-owner'], graph: ['stage-owner'],
    presentation: ['candidate-provider', 'snapshot-consumer'], quality: ['transition-participant'], validation: ['mechanism-evidence'],
    requiredAbiTokens: ['PhysicsContext', 'PhysicsGraph', 'PhysicsSignalDescriptor', 'WaterSurfaceSample', 'LightingTransportSnapshot', 'SurfaceExchange', 'InteractionRecord', 'InteractionBatchLedger', 'PhysicsPresentationCandidate', 'PhysicsPresentationSnapshot', 'FrameExecutionRecord', 'QualityTransition']
  }
};

const matrixDirs = Object.keys(physicsBoundaryMatrix).sort();
if (JSON.stringify(matrixDirs) !== JSON.stringify(skillDirs)) {
  const missing = skillDirs.filter((dir) => !matrixDirs.includes(dir));
  const extra = matrixDirs.filter((dir) => !skillDirs.includes(dir));
  fail(`physics boundary matrix must equal discovered skills exactly (missing: ${missing.join(', ') || 'none'}; extra/aliases: ${extra.join(', ') || 'none'})`);
}

const physicsWorkloadShapeCostRoles = {
  'threejs-choose-skills': ['coordinator'],
  'threejs-object-sculptor': ['external-adapter'],
  'threejs-particles-trails-and-effects': ['sparse-active-domain', 'contact'],
  'threejs-procedural-buildings-and-cities': ['external-adapter'],
  'threejs-procedural-creatures': ['contact'],
  'threejs-procedural-motion-systems': ['contact', 'external-adapter'],
  'threejs-procedural-vegetation': ['sparse-active-domain'],
  'threejs-rain-snow-and-wet-surfaces': ['sparse-active-domain'],
  'threejs-visual-validation': ['observer'],
  'threejs-water-optics': ['sparse-active-domain', 'external-adapter']
};
const allowedWorkloadShapeCostRoles = new Set([
  'coordinator', 'sparse-active-domain', 'contact', 'external-adapter', 'observer'
]);
const abiTokensByWorkloadShapeCostRole = {
  coordinator: ['PhysicsCostLedger'],
  'sparse-active-domain': ['PhysicsSparseActiveDomainCost'],
  contact: ['PhysicsContactCost'],
  'external-adapter': ['PhysicsExternalAdapterCost'],
  observer: ['PhysicsCostLedger']
};
for (const [dir, roles] of Object.entries(physicsWorkloadShapeCostRoles)) {
  if (!skillDirs.includes(dir)) fail(`workload-shape cost roles reference unknown skill ${dir}`);
  if (!Array.isArray(roles) || roles.length === 0 || new Set(roles).size !== roles.length) {
    fail(`${dir} has invalid or duplicate workload-shape cost roles`);
  }
  for (const role of roles) {
    if (!allowedWorkloadShapeCostRoles.has(role)) fail(`${dir} declares unknown workload-shape cost role ${role}`);
  }
}
const workloadShapeCostCoordinators = Object.entries(physicsWorkloadShapeCostRoles)
  .filter(([, roles]) => roles.includes('coordinator'))
  .map(([dir]) => dir);
if (workloadShapeCostCoordinators.length !== 1) {
  fail(`workload-shape cost coordinator must have exactly one owner; found ${workloadShapeCostCoordinators.join(', ') || 'none'}`);
}

const allowedRoleValues = {
  coordinator: new Set(['route', 'context', 'graph', 'interaction', 'presentation', 'quality']),
  interaction: new Set(['coordinator', 'producer', 'consumer', 'exchange-owner', 'adapter', 'preserve', 'observer']),
  graph: new Set(['coordinator', 'stage-owner', 'consumer', 'preserve', 'observer']),
  presentation: new Set(['coordinator', 'candidate-provider', 'camera-owner', 'preparation-owner', 'preparation-provider', 'snapshot-owner', 'snapshot-consumer', 'execution-owner', 'preserve']),
  quality: new Set(['coordinator', 'transition-participant', 'requester', 'presentation-only', 'preserve', 'observer']),
  validation: new Set(['route-preflight', 'contract-gate', 'diagnostic-preservation', 'mechanism-evidence'])
};
const abiTokensByRole = {
  coordinator: {
    route: ['PhysicsContext'],
    context: ['PhysicsContext'],
    graph: ['PhysicsGraph', 'PhysicsCoordinationAdvanceRecord'],
    interaction: ['SurfaceExchange', 'InteractionApplicationLedger'],
    presentation: ['PresentationTimeCohort', 'PresentationRenderPlan', 'FrameExecutionRecord'],
    quality: ['QualityChangeRequest', 'QualityTransition']
  },
  interaction: {
    coordinator: ['SurfaceExchange', 'InteractionApplicationLedger'],
    producer: ['InteractionRecord'],
    consumer: ['InteractionRecord', 'InteractionApplicationLedger'],
    'exchange-owner': ['SurfaceExchange', 'InteractionBatchLedger', 'InteractionApplicationLedger'],
    adapter: ['InteractionRecord', 'ExternalSolverAdapter'],
    preserve: [],
    observer: ['InteractionRecord', 'InteractionApplicationLedger']
  },
  graph: {
    coordinator: ['PhysicsGraph', 'PhysicsCoordinationAdvanceRecord'],
    'stage-owner': ['PhysicsGraph', 'PhysicsStageExecution'],
    consumer: [],
    preserve: ['PhysicsGraph'],
    observer: ['PhysicsGraph', 'PhysicsStageExecution']
  },
  presentation: {
    coordinator: ['PresentationTimeCohort', 'PresentationRenderPlan', 'FrameExecutionRecord'],
    'candidate-provider': ['PhysicsPresentationCandidate'],
    'camera-owner': ['CameraViewPublication'],
    'preparation-owner': ['ViewPreparationPublication'],
    'preparation-provider': ['ShadowViewPublicationRef'],
    'snapshot-owner': ['PhysicsPresentationSnapshot'],
    'snapshot-consumer': ['PhysicsPresentationSnapshot'],
    'execution-owner': ['PresentationRenderPlan', 'FrameExecutionRecord'],
    preserve: ['PhysicsPresentationSnapshot']
  },
  quality: {
    coordinator: ['QualityChangeRequest', 'QualityTransition'],
    'transition-participant': ['QualityTransition'],
    requester: ['QualityChangeRequest'],
    'presentation-only': [],
    preserve: ['QualityTransition'],
    observer: ['QualityTransition']
  },
  validation: {
    'route-preflight': ['PhysicsContext'],
    'contract-gate': ['PhysicsContext'],
    'diagnostic-preservation': ['PhysicsContext'],
    'mechanism-evidence': []
  }
};
const tokenPattern = (token) => new RegExp(`(?:^|[^A-Za-z0-9_])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^A-Za-z0-9_])`, 'm');
const canonicalContractRealpath = realpathSync(physicsContractPath);
const externalBoundaryProviders = new Map([
  ['environment-forcing', ['project/environment-coordinator']]
]);
const familyProviders = new Map(
  [...externalBoundaryProviders].map(([family, providers]) => [family, [...providers]])
);
const familyConsumers = new Map();

for (const [dir, boundary] of Object.entries(physicsBoundaryMatrix)) {
  const roleKeys = ['coordinator', 'provider', 'consumer', 'interaction', 'graph', 'presentation', 'quality', 'validation'];
  const expectedBoundaryKeys = ['applicability', ...roleKeys, 'requiredAbiTokens'].sort();
  if (JSON.stringify(Object.keys(boundary).sort()) !== JSON.stringify(expectedBoundaryKeys)) {
    fail(`${dir} boundary declaration has missing or unknown role fields`);
  }
  if (!boundary.applicability || !['applicable', 'not-applicable'].includes(boundary.applicability.status)) {
    fail(`${dir} has an invalid physics applicability status`);
  }
  if (JSON.stringify(Object.keys(boundary.applicability).sort()) !== JSON.stringify(['justification', 'status'])) {
    fail(`${dir} applicability declaration must contain only status and justification`);
  }
  if (typeof boundary.applicability.justification !== 'string' || boundary.applicability.justification.length < 20) {
    fail(`${dir} must justify its physics applicability status`);
  }
  for (const roleKey of roleKeys) {
    if (!Array.isArray(boundary[roleKey]) || new Set(boundary[roleKey]).size !== boundary[roleKey].length) {
      fail(`${dir} has an invalid or duplicate ${roleKey} role declaration`);
    }
  }
  if (!Array.isArray(boundary.requiredAbiTokens) ||
      new Set(boundary.requiredAbiTokens).size !== boundary.requiredAbiTokens.length) {
    fail(`${dir} has invalid requiredAbiTokens`);
  }
  if (boundary.applicability.status === 'applicable' && boundary.requiredAbiTokens.length === 0) {
    fail(`${dir} is physics-applicable but declares no required ABI tokens`);
  }
  if (boundary.applicability.status === 'not-applicable' &&
      (roleKeys.some((roleKey) => boundary[roleKey].length > 0) || boundary.requiredAbiTokens.length > 0)) {
    fail(`${dir} is not-applicable but still declares physics roles or ABI tokens`);
  }
  for (const roleKey of Object.keys(allowedRoleValues)) {
    for (const role of boundary[roleKey]) {
      if (!allowedRoleValues[roleKey].has(role)) fail(`${dir} declares unknown ${roleKey} role ${role}`);
    }
  }
  const effectiveAbiTokens = new Set(boundary.requiredAbiTokens);
  for (const [roleKey, requirementsByValue] of Object.entries(abiTokensByRole)) {
    for (const role of boundary[roleKey]) {
      for (const token of requirementsByValue[role] ?? []) effectiveAbiTokens.add(token);
    }
  }
  for (const role of physicsWorkloadShapeCostRoles[dir] ?? []) {
    for (const token of abiTokensByWorkloadShapeCostRole[role] ?? []) effectiveAbiTokens.add(token);
  }
  for (const direction of ['provider', 'consumer']) {
    for (const family of boundary[direction]) {
      const abiToken = channelFamilyAbiToken.get(family);
      if (!abiToken) fail(`${dir} declares unknown ${direction} channel family ${family}`);
      if (!boundary.requiredAbiTokens.includes(abiToken)) {
        fail(`${dir} ${direction} family ${family} does not require its ABI token ${abiToken}`);
      }
      const registry = direction === 'provider' ? familyProviders : familyConsumers;
      const owners = registry.get(family) ?? [];
      owners.push(dir);
      registry.set(family, owners);
    }
  }

  const skillPath = join(root, dir, 'SKILL.md');
  const skillText = readFileSync(skillPath, 'utf8');
  const resolvedContractLinks = [];
  for (const match of skillText.matchAll(/!\[[^\]]*\]\(([^)]+)\)|\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = (match[1] ?? match[2]).trim();
    if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    target = target.split('#')[0].split('?')[0];
    if (!target) continue;
    const absoluteTarget = resolve(dirname(skillPath), decodeURIComponent(target));
    if (existsSync(absoluteTarget)) resolvedContractLinks.push(realpathSync(absoluteTarget));
  }
  if (!resolvedContractLinks.includes(canonicalContractRealpath)) {
    fail(`${dir}/SKILL.md does not contain a resolvable link to ${physicsContractRelative}`);
  }

  const physicsBoundaryProse = readPhysicsBoundaryProse(dir);
  for (const token of effectiveAbiTokens) {
    if (!abiRecords[token]) fail(`${dir} requires unknown ABI record ${token}`);
    if (!hasPositiveBoundaryToken(physicsBoundaryProse, token)) {
      fail(`${dir}/SKILL.md physics-boundary prose omits positive exact ABI token ${token}`);
    }
  }
}

for (const role of ['route', 'context', 'graph', 'interaction', 'presentation', 'quality']) {
  const owners = Object.entries(physicsBoundaryMatrix)
    .filter(([, boundary]) => boundary.coordinator.includes(role))
    .map(([dir]) => dir);
  if (owners.length !== 1) fail(`coordinator role ${role} must have exactly one scoped owner; found ${owners.join(', ') || 'none'}`);
}
for (const role of ['camera-owner', 'preparation-owner', 'snapshot-owner', 'execution-owner']) {
  const owners = Object.entries(physicsBoundaryMatrix)
    .filter(([, boundary]) => boundary.presentation.includes(role))
    .map(([dir]) => dir);
  if (owners.length !== 1) fail(`presentation role ${role} must have exactly one scoped owner; found ${owners.join(', ') || 'none'}`);
}

for (const family of channelFamilyAbiToken.keys()) {
  const providers = familyProviders.get(family) ?? [];
  const consumers = familyConsumers.get(family) ?? [];
  if (providers.length === 0 || consumers.length === 0) {
    fail(`channel family ${family} lacks reciprocal providers or consumers (providers: ${providers.join(', ') || 'none'}; consumers: ${consumers.join(', ') || 'none'})`);
  }
}
for (const [family, externalProviders] of externalBoundaryProviders) {
  const skillProviders = Object.entries(physicsBoundaryMatrix)
    .filter(([, boundary]) => boundary.provider.includes(family))
    .map(([dir]) => dir);
  if (skillProviders.length > 0) {
    fail(`externally owned channel family ${family} is falsely claimed by skills: ${skillProviders.join(', ')}; external owners: ${externalProviders.join(', ')}`);
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

const routerContractTestPath = join(root, 'threejs-choose-skills', 'examples', 'router-contract.test.mjs');
if (!existsSync(routerContractTestPath)) fail('router contract test is missing from the normal skills gate');
try {
  execFileSync(process.execPath, [routerContractTestPath], { cwd: root, stdio: 'inherit' });
} catch (error) {
  fail(`router contract test failed with status ${error?.status ?? 'unknown'}`);
}

console.log(`Validated ${skillDirs.length} skills for ${repoSlug}`);
