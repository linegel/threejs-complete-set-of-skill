#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO_ROOT,
  buildDemoRegistry,
  manifestSourceDirectory,
} from './lib/lab-registry.mjs';
import { appendCaptureProfile } from './lib/lab-command-policy.mjs';

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function tokenize(command) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (quote) throw new Error(`unterminated quote in command: ${command}`);
  if (escaped) current += '\\';
  if (current) tokens.push(current);
  return tokens;
}

function commandFor(manifest, operation, registry) {
  const commands = manifest.commands ?? {};
  const aliases = {
    check: 'check',
    test: 'validate:unit',
    mutations: 'test:mutations',
    capture: 'capture',
    validate: 'validate:artifacts',
    quick: 'validate:quick',
    full: 'validate:full',
  };
  const canonicalDir = registry.origins?.[manifest.id]?.canonicalDir;
  const fallback = canonicalDir ? `npm --prefix ${canonicalDir} run ${aliases[operation]}` : null;
  switch (operation) {
    case 'check': return commands.check ?? fallback;
    case 'test': return commands.test ?? fallback;
    case 'mutations': return commands.mutations ?? fallback;
    case 'capture': return commands.capture ?? fallback;
    case 'validate': return commands.validateArtifacts ?? fallback ?? manifest.validationCommand;
    case 'quick': return commands.validateQuick ?? fallback;
    case 'full': return commands.validateFull ?? fallback;
    default: throw new Error(`unknown operation: ${operation}`);
  }
}

function workingDirectory(manifest, registry, tokens) {
  if (tokens[0] === 'npm' && tokens[1] === '--prefix') {
    const prefix = tokens[2] ?? '';
    if (prefix.startsWith('threejs-') || prefix.startsWith('integration-labs/')) return REPO_ROOT;
    return manifestSourceDirectory(manifest, registry);
  }
  if (tokens.slice(1).some((argument) => argument.startsWith('threejs-') || argument.startsWith('integration-labs/'))) {
    return REPO_ROOT;
  }
  return manifestSourceDirectory(manifest, registry);
}

const operation = process.argv[2];
const allowedOperations = new Set(['check', 'test', 'mutations', 'capture', 'validate', 'quick', 'full']);
if (!allowedOperations.has(operation)) {
  console.error(`unknown operation: ${operation ?? '(missing)'}`);
  process.exit(1);
}
const requestedLab = readOption('--lab');
const profile = readOption('--profile');
const includeIncomplete = process.argv.includes('--include-incomplete');
const exerciseIncompleteByDefault = ['check', 'test', 'mutations', 'quick'].includes(operation);
const registry = buildDemoRegistry();
let labs = registry.demos.filter((manifest) => ['canonical-lab', 'mechanism-demo', 'tier-demo', 'integration-demo'].includes(manifest.kind));
if (requestedLab) {
  labs = labs.filter((manifest) => manifest.id === requestedLab);
  if (labs.length === 0) {
    console.error(`unknown lab: ${requestedLab}`);
    process.exit(1);
  }
} else if (!includeIncomplete && !exerciseIncompleteByDefault) {
  labs = labs.filter((manifest) => manifest.status === 'accepted');
}

const failures = [];
let executed = 0;
for (const manifest of labs) {
  const command = commandFor(manifest, operation, registry);
  if (!command) {
    if (requestedLab || manifest.status === 'accepted') failures.push(`${manifest.id}: no ${operation} command declared`);
    continue;
  }
  const tokens = tokenize(command);
  if (!['node', 'npm', 'npx', 'bash'].includes(tokens[0])) {
    failures.push(`${manifest.id}: command executable ${tokens[0]} is not allowed`);
    continue;
  }
  if (tokens.some((token) => [';', '&&', '||', '|', '>', '<'].includes(token))) {
    failures.push(`${manifest.id}: shell control operators are forbidden in manifest commands`);
    continue;
  }

  const cwd = workingDirectory(manifest, registry, tokens);
  if (!existsSync(cwd)) {
    failures.push(`${manifest.id}: command cwd does not exist: ${cwd}`);
    continue;
  }
  let executionTokens = tokens;
  if (profile && operation === 'capture') {
    try {
      executionTokens = appendCaptureProfile(tokens, profile);
    } catch (error) {
      failures.push(`${manifest.id}: ${error.message}`);
      continue;
    }
  }
  const args = executionTokens.slice(1);
  console.log(`[labs:${operation}] ${manifest.id}: ${tokens[0]} ${args.join(' ')}`);
  const result = spawnSync(tokens[0], args, {
    cwd,
    env: { ...process.env, LAB_ID: manifest.id },
    stdio: 'inherit',
  });
  executed += 1;
  if (result.error) failures.push(`${manifest.id}: ${result.error.message}`);
  else if (result.status !== 0) failures.push(`${manifest.id}: exited ${result.status}`);
}

if (failures.length > 0) {
  console.error(`labs:${operation} failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`labs:${operation} completed; ${executed} command${executed === 1 ? '' : 's'} executed.`);
