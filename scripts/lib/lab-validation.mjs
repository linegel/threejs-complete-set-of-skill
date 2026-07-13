import {
  ACCEPTANCE_STATUSES,
  DEMO_KINDS,
  EXECUTION_CLASSES,
  PRIMARY_DEMO_KINDS,
  REPO_ROOT,
  authoritativePrimaryRoster,
  authoritativeSkillDirs,
  computeManifestSourceHash,
  deriveRegistryCounts,
  deriveRegistryPrimaryIds,
  deriveSkillCoverage,
  loadCanonicalTargets,
  validatePrimaryRosterClosure,
} from './lab-registry.mjs';
import { loadCheckedSchemas, validateCheckedJsonSchema } from './checked-json-schema.mjs';

const ID = /^[a-z0-9][a-z0-9-]*$/;
const ROUTE_ID = /^[a-z0-9](?:[a-z0-9./-]*[a-z0-9])?$/;
const RAW_MANIFEST_KEYS = new Set([
  'schemaVersion', 'id', 'title', 'skill', 'threeRevision', 'kind', 'status',
  'canonicalSource', 'browserEntry', 'publishPath', 'scenarios', 'mechanisms',
  'tiers', 'modes', 'cameras', 'seeds', 'capabilityRequirements', 'runtimeProof',
  'evidenceContract', 'evidenceBundle', 'validationCommand', 'commands',
  'sourceHash', 'proxyStatus', 'nonRenderingScenarioSuite', 'notes',
  'limitations',
]);
const RAW_ROUTE_KEYS = new Set(['id', 'title', 'route', 'startup', 'acceptanceStatus']);
const RAW_TIER_KEYS = new Set([
  'id', 'targetClass', 'frameTargetMs', 'resolutionPolicy', 'mechanismLimits',
  'resourceLimits', 'degradationFromPrevious', 'preservedInvariants', 'acceptanceStatus',
]);
const RAW_REQUIREMENT_KEYS = new Set(['id', 'required', 'evidence', 'status', 'acceptanceStatus']);
const RAW_COMMAND_KEYS = new Set([
  'check', 'test', 'mutations', 'capture', 'validateArtifacts', 'validateQuick', 'validateFull',
]);
const RAW_NUMERIC_DATUM_KEYS = new Set(['value', 'unit', 'label', 'source', 'uncertainty']);
const RAW_PROXY_STATUS_KEYS = new Set(['limitation', 'canonicalLabId']);
const NUMERIC_LABELS = new Set(['Authored', 'Derived', 'Measured', 'Gated']);
const REPO_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;

function validRouteId(value) {
  return ROUTE_ID.test(value) && !String(value).split('/').some((segment) => segment === '.' || segment === '..' || segment === '');
}

function unknownKeys(value, allowed) {
  return Object.keys(value ?? {}).filter((key) => !allowed.has(key));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateRawNumericDatum(datum, path, errors) {
  if (!plainObject(datum)) {
    errors.push(`${path} must be a numeric datum object`);
    return;
  }
  const extras = unknownKeys(datum, RAW_NUMERIC_DATUM_KEYS);
  if (extras.length > 0) errors.push(`${path} has unknown properties: ${extras.join(', ')}`);
  for (const key of ['value', 'unit', 'label', 'source']) {
    if (!(key in datum)) errors.push(`${path} is missing required property ${key}`);
  }
  if (!Number.isFinite(datum.value)) errors.push(`${path}.value must be finite`);
  if (!nonEmptyString(datum.unit)) errors.push(`${path}.unit must be a non-empty string`);
  if (!NUMERIC_LABELS.has(datum.label)) errors.push(`${path}.label is invalid`);
  if (!nonEmptyString(datum.source)) errors.push(`${path}.source must be a non-empty string`);
  if (datum.uncertainty !== undefined && !nonEmptyString(datum.uncertainty)) {
    errors.push(`${path}.uncertainty must be a non-empty string`);
  }
}

function validateRawRoute(route, path, errors) {
  if (!plainObject(route)) {
    errors.push(`${path} must be a strict route object`);
    return;
  }
  const extras = unknownKeys(route, RAW_ROUTE_KEYS);
  if (extras.length > 0) errors.push(`${path} has unknown properties: ${extras.join(', ')}`);
  if (!('id' in route)) errors.push(`${path} is missing required property id`);
  if (!ROUTE_ID.test(route.id ?? '')) errors.push(`${path}.id is invalid`);
  if (route.title !== undefined && !nonEmptyString(route.title)) errors.push(`${path}.title must be a non-empty string`);
  if (route.route !== undefined && !nonEmptyString(route.route)) errors.push(`${path}.route must be a non-empty string`);
  if (route.startup !== undefined && !plainObject(route.startup)) errors.push(`${path}.startup must be an object`);
  if (route.acceptanceStatus !== undefined && !ACCEPTANCE_STATUSES.includes(route.acceptanceStatus)) {
    errors.push(`${path}.acceptanceStatus is invalid`);
  }
}

function validateRawTier(tier, path, errors) {
  if (!plainObject(tier)) {
    errors.push(`${path} must be a strict quality-tier object`);
    return;
  }
  const extras = unknownKeys(tier, RAW_TIER_KEYS);
  if (extras.length > 0) errors.push(`${path} has unknown properties: ${extras.join(', ')}`);
  for (const key of RAW_TIER_KEYS) {
    if (!(key in tier)) errors.push(`${path} is missing required property ${key}`);
  }
  if (!ROUTE_ID.test(tier.id ?? '')) errors.push(`${path}.id is invalid`);
  if (!nonEmptyString(tier.targetClass)) errors.push(`${path}.targetClass must be a non-empty string`);
  if (tier.frameTargetMs !== null) validateRawNumericDatum(tier.frameTargetMs, `${path}.frameTargetMs`, errors);
  for (const key of ['resolutionPolicy', 'mechanismLimits', 'resourceLimits']) {
    if (!plainObject(tier[key])) errors.push(`${path}.${key} must be an object`);
  }
  for (const key of ['degradationFromPrevious', 'preservedInvariants']) {
    if (!Array.isArray(tier[key]) || tier[key].some((entry) => !nonEmptyString(entry))) {
      errors.push(`${path}.${key} must be an array of non-empty strings`);
    }
  }
  if (!ACCEPTANCE_STATUSES.includes(tier.acceptanceStatus)) errors.push(`${path}.acceptanceStatus is invalid`);
}

function validateRawRequirement(requirement, path, errors) {
  if (!plainObject(requirement)) {
    errors.push(`${path} must be a strict requirement object`);
    return;
  }
  const extras = unknownKeys(requirement, RAW_REQUIREMENT_KEYS);
  if (extras.length > 0) errors.push(`${path} has unknown properties: ${extras.join(', ')}`);
  for (const key of ['id', 'required']) {
    if (!(key in requirement)) errors.push(`${path} is missing required property ${key}`);
  }
  if (!ID.test(requirement.id ?? '')) errors.push(`${path}.id is invalid`);
  if (typeof requirement.required !== 'boolean') errors.push(`${path}.required must be boolean`);
  if (requirement.evidence !== undefined && requirement.evidence !== null && typeof requirement.evidence !== 'string') {
    errors.push(`${path}.evidence must be string or null`);
  }
  if (requirement.status !== undefined && !ACCEPTANCE_STATUSES.includes(requirement.status)) {
    errors.push(`${path}.status is invalid`);
  }
  if (requirement.acceptanceStatus !== undefined && !ACCEPTANCE_STATUSES.includes(requirement.acceptanceStatus)) {
    errors.push(`${path}.acceptanceStatus is invalid`);
  }
}

export function validateRawLabManifest(raw) {
  const errors = [];
  const schemaResult = validateCheckedJsonSchema(loadCheckedSchemas().labManifest, raw);
  errors.push(...schemaResult.errors.map((error) => `lab-manifest.schema.json: ${error}`));
  for (const key of [
    'schemaVersion', 'id', 'skill', 'threeRevision', 'kind', 'status',
    'canonicalSource', 'browserEntry', 'publishPath', 'scenarios', 'mechanisms',
    'tiers', 'modes', 'cameras', 'seeds', 'capabilityRequirements', 'runtimeProof',
    'evidenceContract', 'validationCommand', 'sourceHash', 'proxyStatus',
  ]) {
    if (!(key in (raw ?? {}))) errors.push(`missing required property ${key}`);
  }
  const extras = unknownKeys(raw, RAW_MANIFEST_KEYS);
  if (extras.length > 0) errors.push(`unknown manifest properties: ${extras.join(', ')}`);
  if (raw?.schemaVersion !== 2) errors.push('schemaVersion must be 2');
  if (!ID.test(raw?.id ?? '')) errors.push('id is invalid');
  if (!/^threejs-[a-z0-9-]+$/.test(raw?.skill ?? '')) errors.push('skill is invalid');
  if (raw?.threeRevision !== '0.185.1') errors.push('threeRevision must equal 0.185.1');
  if (!DEMO_KINDS.includes(raw?.kind)) errors.push('kind is invalid');
  if (!ACCEPTANCE_STATUSES.includes(raw?.status)) errors.push('status is invalid');
  if (raw?.title !== undefined && !nonEmptyString(raw.title)) errors.push('title must be a non-empty string');
  if (!Array.isArray(raw?.canonicalSource) || raw.canonicalSource.length === 0
      || raw.canonicalSource.some((path) => !nonEmptyString(path) || !REPO_PATH.test(path))) {
    errors.push('canonicalSource must be a non-empty repository-path array');
  } else if (new Set(raw.canonicalSource).size !== raw.canonicalSource.length) {
    errors.push('canonicalSource entries must be unique');
  }
  if (raw?.browserEntry !== null && (!nonEmptyString(raw?.browserEntry) || !REPO_PATH.test(raw.browserEntry))) {
    errors.push('browserEntry must be a repository path or null');
  }
  if (raw?.publishPath !== null && !/^\/demos\/[a-z0-9][a-z0-9-]*\/$/.test(raw?.publishPath ?? '')) {
    errors.push('publishPath must match /demos/<id>/');
  }

  for (const key of ['scenarios', 'mechanisms']) {
    if (!Array.isArray(raw?.[key])) {
      errors.push(`${key} must be an array`);
      continue;
    }
    for (const [index, route] of raw[key].entries()) {
      validateRawRoute(route, `${key}[${index}]`, errors);
    }
  }

  if (!Array.isArray(raw?.tiers)) errors.push('tiers must be an array');
  for (const [index, tier] of (raw?.tiers ?? []).entries()) {
    validateRawTier(tier, `tiers[${index}]`, errors);
  }

  for (const key of ['modes', 'cameras']) {
    if (!Array.isArray(raw?.[key]) || raw[key].some((id) => !ID.test(id))) errors.push(`${key} must be an id array`);
    else if (new Set(raw[key]).size !== raw[key].length) errors.push(`${key} entries must be unique`);
  }
  if (!Array.isArray(raw?.seeds) || raw.seeds.some((seed) => !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)) {
    errors.push('seeds must be uint32 integers');
  } else if (new Set(raw.seeds).size !== raw.seeds.length) {
    errors.push('seeds entries must be unique');
  }
  for (const key of ['capabilityRequirements', 'runtimeProof']) {
    if (!Array.isArray(raw?.[key])) {
      errors.push(`${key} must be an array`);
      continue;
    }
    for (const [index, requirement] of raw[key].entries()) {
      validateRawRequirement(requirement, `${key}[${index}]`, errors);
    }
  }
  if (!['v2', 'none'].includes(raw?.evidenceContract)) errors.push('evidenceContract must be exactly v2 or none');
  if (raw?.evidenceBundle !== undefined && raw.evidenceBundle !== null
      && (!nonEmptyString(raw.evidenceBundle) || !REPO_PATH.test(raw.evidenceBundle))) {
    errors.push('evidenceBundle must be a repository path or null');
  }
  if (raw?.validationCommand !== null && !nonEmptyString(raw?.validationCommand)) errors.push('validationCommand must be a non-empty string or null');
  if (raw?.sourceHash !== null && !/^sha256:[a-f0-9]{64}$/.test(raw?.sourceHash ?? '')) errors.push('sourceHash is invalid');
  if (raw?.commands !== undefined) {
    if (!plainObject(raw.commands)) {
      errors.push('commands must be an object');
    } else {
    const commandExtras = unknownKeys(raw.commands, RAW_COMMAND_KEYS);
    if (commandExtras.length > 0) errors.push(`commands has unknown properties: ${commandExtras.join(', ')}`);
    for (const [key, value] of Object.entries(raw.commands)) {
      if (typeof value !== 'string' || value.length === 0) errors.push(`commands.${key} must be a non-empty string`);
    }
    }
  }
  if (raw?.proxyStatus !== null) {
    if (!plainObject(raw?.proxyStatus)) {
      errors.push('proxyStatus must be an object or null');
    } else {
      const proxyExtras = unknownKeys(raw.proxyStatus, RAW_PROXY_STATUS_KEYS);
      if (proxyExtras.length > 0) errors.push(`proxyStatus has unknown properties: ${proxyExtras.join(', ')}`);
      for (const key of ['limitation', 'canonicalLabId']) {
        if (!(key in raw.proxyStatus)) errors.push(`proxyStatus is missing required property ${key}`);
      }
      if (!nonEmptyString(raw.proxyStatus.limitation)) errors.push('proxyStatus.limitation must be a non-empty string');
      if (raw.proxyStatus.canonicalLabId !== null && !ID.test(raw.proxyStatus.canonicalLabId ?? '')) {
        errors.push('proxyStatus.canonicalLabId is invalid');
      }
    }
  }
  if (raw?.nonRenderingScenarioSuite !== undefined && typeof raw.nonRenderingScenarioSuite !== 'boolean') {
    errors.push('nonRenderingScenarioSuite must be boolean');
  }
  if (raw?.notes !== undefined && (!Array.isArray(raw.notes) || raw.notes.some((note) => !nonEmptyString(note)))) {
    errors.push('notes must be an array of non-empty strings');
  }
  if (raw?.limitations !== undefined && !Array.isArray(raw.limitations)) {
    errors.push('limitations must be an array when present');
  }
  return { valid: errors.length === 0, errors };
}

function duplicateIds(records) {
  const seen = new Set();
  return records.filter((record) => {
    const duplicate = seen.has(record.id);
    seen.add(record.id);
    return duplicate;
  }).map((record) => record.id);
}

function validateTier(tier, path, errors) {
  if (!validRouteId(tier?.id ?? '')) errors.push(`${path}.id is invalid`);
  if (!tier?.targetClass) errors.push(`${path}.targetClass is required`);
  if (tier?.frameTargetMs !== null) {
    const datum = tier?.frameTargetMs;
    if (!Number.isFinite(datum?.value) || datum.unit !== 'ms' || datum.label !== 'Gated' || !datum.source) {
      errors.push(`${path}.frameTargetMs must be null or a Gated numeric datum in ms`);
    }
  }
  for (const key of ['resolutionPolicy', 'mechanismLimits', 'resourceLimits']) {
    if (!tier?.[key] || typeof tier[key] !== 'object' || Array.isArray(tier[key])) errors.push(`${path}.${key} must be an object`);
  }
  for (const key of ['degradationFromPrevious', 'preservedInvariants']) {
    if (!Array.isArray(tier?.[key])) errors.push(`${path}.${key} must be an array`);
  }
  if (!ACCEPTANCE_STATUSES.includes(tier?.acceptanceStatus)) errors.push(`${path}.acceptanceStatus is invalid`);
}

export function validateLabManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== 2) errors.push('schemaVersion must be 2');
  if (!ID.test(manifest?.id ?? '')) errors.push('id must be a lowercase route slug');
  if (!/^threejs-[a-z0-9-]+$/.test(manifest?.skill ?? '')) errors.push('skill is invalid');
  if (manifest?.threeRevision !== '0.185.1') errors.push('threeRevision must equal 0.185.1');
  if (!DEMO_KINDS.includes(manifest?.kind)) errors.push('kind is invalid');
  if (!ACCEPTANCE_STATUSES.includes(manifest?.status)) errors.push('status is invalid');
  if (!Array.isArray(manifest?.canonicalSource) || manifest.canonicalSource.length === 0) errors.push('canonicalSource must be non-empty');
  if (!Array.isArray(manifest?.scenarios)) errors.push('scenarios must be an array');
  if (!Array.isArray(manifest?.mechanisms)) errors.push('mechanisms must be an array');
  if (!Array.isArray(manifest?.tiers)) errors.push('tiers must be an array');
  if (!Array.isArray(manifest?.modes)) errors.push('modes must be an array');
  if (!Array.isArray(manifest?.cameras)) errors.push('cameras must be an array');
  if (!Array.isArray(manifest?.seeds)) errors.push('seeds must be an array');
  if (!Array.isArray(manifest?.capabilityRequirements)) errors.push('capabilityRequirements must be an array');
  if (!Array.isArray(manifest?.runtimeProof)) errors.push('runtimeProof must be an array');

  for (const [key, records] of [['scenarios', manifest?.scenarios], ['mechanisms', manifest?.mechanisms]]) {
    for (const [index, record] of (records ?? []).entries()) {
      if (!validRouteId(record?.id ?? '')) errors.push(`${key}[${index}].id is invalid`);
    }
    const duplicates = duplicateIds(records ?? []);
    if (duplicates.length > 0) errors.push(`${key} has duplicate ids: ${duplicates.join(', ')}`);
  }
  for (const [index, tier] of (manifest?.tiers ?? []).entries()) validateTier(tier, `tiers[${index}]`, errors);
  const tierDuplicates = duplicateIds(manifest?.tiers ?? []);
  if (tierDuplicates.length > 0) errors.push(`tiers has duplicate ids: ${tierDuplicates.join(', ')}`);
  for (const key of ['capabilityRequirements', 'runtimeProof']) {
    const duplicates = duplicateIds(manifest?.[key] ?? []);
    if (duplicates.length > 0) errors.push(`${key} has duplicate ids: ${duplicates.join(', ')}`);
  }

  if (manifest?.publishPath !== null && !/^\/demos\/[a-z0-9][a-z0-9-]*\/$/.test(manifest.publishPath)) {
    errors.push('publishPath must be /demos/<lab-id>/');
  }
  if (manifest?.publishPath && manifest.publishPath !== `/demos/${manifest.id}/`) {
    errors.push('publishPath must use the manifest id');
  }
  if (manifest?.sourceHashInputs !== undefined
      && (!Array.isArray(manifest.sourceHashInputs) || manifest.sourceHashInputs.length === 0)) {
    errors.push('sourceHashInputs must be a non-empty array when present');
  }
  if (manifest?.sourceHash !== null && manifest.sourceHash !== computeManifestSourceHash(manifest)) {
    errors.push('sourceHash does not match sourceHashInputs');
  }

  const primary = PRIMARY_DEMO_KINDS.includes(manifest?.kind);
  if (primary) {
    if (!EXECUTION_CLASSES.includes(manifest?.executionClass)) {
      errors.push('primary demo requires an authoritative executionClass');
    } else {
      const nonRendering = manifest.executionClass === 'non-rendering';
      if ((manifest.nonRenderingScenarioSuite === true) !== nonRendering) {
        errors.push(`nonRenderingScenarioSuite disagrees with authoritative executionClass ${manifest.executionClass}`);
      }
    }
    if (typeof manifest?.flagship !== 'boolean') errors.push('primary demo requires an authoritative flagship flag');
    if (!Array.isArray(manifest?.dependencyLabIds)) errors.push('primary demo requires authoritative dependencyLabIds');
    if (manifest?.kind !== 'integration-demo' && (manifest?.dependencyLabIds?.length ?? 0) > 0) {
      errors.push('non-integration primary cannot declare dependencyLabIds');
    }
  }
  return { valid: errors.length === 0, errors };
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function validateDependencyGraph(primary, allDemos, errors) {
  const primaryById = new Map(primary.map((demo) => [demo.id, demo]));
  const allById = new Map(allDemos.map((demo) => [demo.id, demo]));
  for (const demo of primary) {
    const dependencies = demo.dependencyLabIds ?? [];
    if (demo.kind === 'integration-demo' && dependencies.length === 0) {
      errors.push(`${demo.id}: integration demo has no dependencyLabIds`);
    }
    if (dependencies.includes(demo.id)) errors.push(`${demo.id}: integration dependency cannot reference itself`);
    const duplicates = duplicateIds(dependencies.map((id) => ({ id })));
    if (duplicates.length > 0) errors.push(`${demo.id}: dependencyLabIds has duplicates: ${duplicates.join(', ')}`);
    for (const dependencyId of dependencies) {
      const dependency = allById.get(dependencyId);
      if (!dependency) {
        errors.push(`${demo.id}: dependency ${dependencyId} is missing`);
        continue;
      }
      if (!PRIMARY_DEMO_KINDS.includes(dependency.kind) || !primaryById.has(dependencyId)) {
        errors.push(`${demo.id}: dependency ${dependencyId} is secondary, not primary coverage`);
        continue;
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const reported = new Set();
  const visit = (id, stack) => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id].join(' -> ');
      if (!reported.has(cycle)) errors.push(`integration dependency cycle: ${cycle}`);
      reported.add(cycle);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const nextStack = [...stack, id];
    for (const dependencyId of primaryById.get(id)?.dependencyLabIds ?? []) {
      if (primaryById.has(dependencyId)) visit(dependencyId, nextStack);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const demo of primary) visit(demo.id, []);
}

export function validateRegistry(registry) {
  const errors = [];
  const targetData = loadCanonicalTargets();
  const roster = authoritativePrimaryRoster(targetData);
  const skills = authoritativeSkillDirs(targetData);
  const demos = registry?.demos ?? [];
  const primary = demos.filter((demo) => PRIMARY_DEMO_KINDS.includes(demo.kind));

  if (registry?.schemaVersion !== 2) errors.push('registry schemaVersion must be 2');
  if (registry?.threeRevision !== '0.185.1') errors.push('registry threeRevision must be 0.185.1');
  const ids = duplicateIds(demos);
  if (ids.length > 0) errors.push(`registry has duplicate ids: ${ids.join(', ')}`);

  const closure = validatePrimaryRosterClosure(demos, registry?.origins ?? {}, targetData);
  errors.push(...closure.errors.map((error) => `primary roster: ${error}`));
  const derivedPrimaryIds = deriveRegistryPrimaryIds(demos);
  const expectedPrimaryIds = roster.map((entry) => entry.id).sort((a, b) => a.localeCompare(b));
  if (!sameJson(registry?.primaryIds, expectedPrimaryIds)) {
    errors.push('registry primaryIds drift from the authoritative primary roster');
  }
  if (!sameJson(derivedPrimaryIds, expectedPrimaryIds)) {
    errors.push('derived primary demo ids drift from the authoritative primary roster');
  }
  const expectedIntegrationIds = roster.filter((entry) => entry.kind === 'integration-demo').map((entry) => entry.id);
  const expectedFlagshipIds = roster.filter((entry) => entry.flagship === true).map((entry) => entry.id);
  if (!sameJson(registry?.integrationPrimaryIds, expectedIntegrationIds)) {
    errors.push('registry integrationPrimaryIds drift from the authoritative primary roster');
  }
  if (!sameJson(registry?.flagshipIds, expectedFlagshipIds)) {
    errors.push('registry flagshipIds drift from the authoritative primary roster');
  }
  if (!sameJson(registry?.integrationIds, expectedFlagshipIds)) {
    errors.push('legacy registry integrationIds must remain an exact flagshipIds alias');
  }

  const expectedCounts = deriveRegistryCounts(demos, skills);
  if (!sameJson(registry?.counts, expectedCounts)) {
    errors.push(`registry counts are forged or stale; expected ${JSON.stringify(expectedCounts)}, received ${JSON.stringify(registry?.counts)}`);
  }
  const expectedCoverage = deriveSkillCoverage(demos, skills);
  if (!sameJson(registry?.coverage, expectedCoverage)) {
    errors.push('registry coverage is forged or stale; it must be derived from primary demos');
  }
  const coverageSkills = (registry?.coverage ?? []).map((entry) => entry.skill);
  const duplicateCoverage = duplicateIds(coverageSkills.map((id) => ({ id })));
  if (duplicateCoverage.length > 0) errors.push(`coverage matrix has duplicate skills: ${duplicateCoverage.join(', ')}`);
  for (const manifest of demos) {
    const result = validateLabManifest(manifest);
    errors.push(...result.errors.map((error) => `${manifest.id}: ${error}`));
  }
  validateDependencyGraph(primary, demos, errors);

  return { valid: errors.length === 0, errors };
}
