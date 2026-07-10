function stripNodeSyntaxChecks(command) {
  return String(command).replace(
    /\bnode\s+--check(?:\s+(?:"[^"]*"|'[^']*'|[^\s;&|()]+))+/gi,
    ' ',
  );
}

/** Return true only when a quick-validation command can execute a browser path. */
export function quickCommandStartsBrowser(command) {
  const executable = stripNodeSyntaxChecks(command);
  return [
    /\b(?:npx|npm\s+exec|pnpm\s+exec|yarn\s+exec)?\s*(?:[^\s;&|()]*\/)?(?:playwright|chromium|firefox|webkit)\b/i,
    /\bpages:smoke\b/i,
    /\bvite\s+(?:dev|preview)\b/i,
    /\b(?:npm|pnpm|yarn)\b(?:(?![;&|()]).)*?\b(?:run\s+)?(?:labs:)?capture\b/i,
    /\b(?:bash|sh|zsh)\b(?:(?![;&|()]).)*?\b[^\s;&|()]*capture[^\s;&|()]*/i,
    /\bnode\s+(?:--[^\s;&|()]+\s+)*(?!-)[^\s;&|()]*(?:browser|capture)[^\s;&|()]*\.(?:[cm]?js|ts)\b/i,
  ].some((pattern) => pattern.test(executable));
}

export function obviousNoOpCommand(command) {
  const normalized = String(command ?? '').trim().replace(/\s+/g, ' ');
  return normalized === ''
    || /^(?:true|:|echo(?:\s+.*)?|printf(?:\s+.*)?)$/i.test(normalized)
    || /^node\s+-e\s+(['"])(?:\s*|void\s+0;?)\1$/i.test(normalized);
}

export function browserDependencyDrift(packageJson, expectedVersions) {
  const errors = [];
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, expected] of Object.entries(expectedVersions)) {
      const declared = packageJson?.[section]?.[name];
      if (declared !== undefined && declared !== expected) {
        errors.push(`${section}.${name} must equal root ${expected}; received ${declared}`);
      }
    }
  }
  return errors;
}

export function manifestCommandPrefixDrift(commands, canonicalDir) {
  const errors = [];
  for (const [name, command] of Object.entries(commands ?? {})) {
    const spaced = /(?:^|\s)--prefix\s+([^\s]+)/.exec(command);
    const assigned = /(?:^|\s)--prefix=([^\s]+)/.exec(command);
    const prefix = spaced?.[1] ?? assigned?.[1] ?? null;
    if (prefix && !['.', canonicalDir].includes(prefix)) {
      errors.push(`commands.${name} prefixes ${prefix} instead of ${canonicalDir}`);
    }
  }
  return errors;
}

export function rootBrowserToolchainDrift(packageJson, packageLock, requiredVersions) {
  const errors = [];
  for (const [name, required] of Object.entries(requiredVersions)) {
    const declared = packageJson?.dependencies?.[name] ?? packageJson?.devDependencies?.[name];
    if (declared !== required) errors.push(`root package ${name} must equal ${required}; received ${declared ?? 'missing'}`);
    const lockDeclared = packageLock?.packages?.['']?.dependencies?.[name]
      ?? packageLock?.packages?.['']?.devDependencies?.[name];
    if (lockDeclared !== required) errors.push(`root lock declaration ${name} must equal ${required}; received ${lockDeclared ?? 'missing'}`);
    const resolved = packageLock?.packages?.[`node_modules/${name}`]?.version;
    if (resolved !== required) errors.push(`root lock resolution ${name} must equal ${required}; received ${resolved ?? 'missing'}`);
  }
  return errors;
}

export function expandLocalPackageScript(packageJson, name, packageDir, stack = new Set()) {
  if (stack.has(name)) return `[recursive-script:${name}]`;
  const command = packageJson.scripts?.[name];
  if (typeof command !== 'string') return '';
  const nextStack = new Set(stack).add(name);
  return command.replace(
    /\bnpm(?<options>(?:\s+(?!run\b)[^\s;&|()]+)*)\s+run\s+(?<dependency>[a-z0-9:_-]+)/gi,
    (match, _options, _dependency, _offset, _source, groups) => {
      const options = groups.options.trim().split(/\s+/).filter(Boolean);
      const assignedPrefix = options.find((token) => token.startsWith('--prefix='))?.slice('--prefix='.length);
      const prefixIndex = options.indexOf('--prefix');
      const spacedPrefix = prefixIndex >= 0 ? options[prefixIndex + 1] : null;
      const prefix = assignedPrefix ?? spacedPrefix;
      if (prefix && resolve(packageDir, prefix) !== resolve(packageDir)) return match;
      return `${match} (${expandLocalPackageScript(packageJson, groups.dependency, packageDir, nextStack)})`;
    },
  );
}

export function appendCaptureProfile(tokens, profile) {
  const output = [...tokens];
  if (!profile) return output;
  if (!['correctness', 'performance'].includes(profile)) {
    throw new RangeError(`unknown capture profile: ${profile}`);
  }
  if (output[0] === 'npm') {
    const runIndex = output.indexOf('run');
    const separatorIndex = output.indexOf('--', runIndex + 1);
    if (runIndex >= 0 && separatorIndex < 0) output.push('--');
  }
  output.push('--profile', profile);
  return output;
}
import { resolve } from 'node:path';
