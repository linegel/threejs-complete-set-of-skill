import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const gatesDir = resolve(here, 'gates');

function usageFailure(message) {
  return {
    id: 'gate-runner',
    status: 'fail',
    message,
    details: { reason: 'invalid-arguments' },
  };
}

function parseArgs(argv) {
  const selectedIds = [];
  const failures = [];
  let strict = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--strict') {
      strict = true;
      continue;
    }

    if (arg === '--gate') {
      const id = argv[i + 1];
      if (!id || id.startsWith('--')) {
        failures.push(usageFailure('--gate requires a gate id'));
      } else {
        selectedIds.push(id);
        i += 1;
      }
      continue;
    }

    if (arg.startsWith('--gate=')) {
      const id = arg.slice('--gate='.length);
      if (id.length === 0) {
        failures.push(usageFailure('--gate requires a gate id'));
      } else {
        selectedIds.push(id);
      }
      continue;
    }

    if (arg.startsWith('--')) {
      failures.push(usageFailure(`unknown option ${arg}`));
      continue;
    }

    selectedIds.push(arg);
  }

  return {
    strict,
    selectedIds,
    selectionMode: selectedIds.length > 0,
    failures,
  };
}

async function discoverGateFiles() {
  let entries;

  try {
    entries = await readdir(gatesDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function moduleGates(module) {
  if (Array.isArray(module.gates)) return module.gates;
  if (Array.isArray(module.default)) return module.default;
  return null;
}

function failureGate(id, message, details = {}) {
  return {
    id,
    async run() {
      return {
        status: 'fail',
        details: {
          message,
          ...details,
        },
      };
    },
  };
}

function normalizeGate(gate, fileName, index) {
  if (!gate || typeof gate !== 'object') {
    return failureGate(
      `gate-definition:${fileName}:${index}`,
      `invalid gate definition in ${fileName} at index ${index}`,
    );
  }

  if (typeof gate.id !== 'string' || gate.id.length === 0) {
    return failureGate(
      `gate-definition:${fileName}:${index}`,
      `gate in ${fileName} at index ${index} is missing a non-empty string id`,
    );
  }

  if (typeof gate.run !== 'function') {
    return failureGate(
      gate.id,
      `gate ${gate.id} in ${fileName} is missing async run()`,
    );
  }

  return gate;
}

async function loadGates() {
  const files = await discoverGateFiles();
  const gates = [];

  for (const fileName of files) {
    const filePath = resolve(gatesDir, fileName);
    let imported;

    try {
      imported = await import(pathToFileURL(filePath).href);
    } catch (error) {
      gates.push(failureGate(
        `gate-module:${fileName}`,
        `failed to import ${fileName}: ${error?.message || String(error)}`,
        { file: fileName },
      ));
      continue;
    }

    const exportedGates = moduleGates(imported);
    if (!exportedGates) {
      gates.push(failureGate(
        `gate-module:${fileName}`,
        `${fileName} must export an array named gates or default-export a gate array`,
        { file: fileName },
      ));
      continue;
    }

    exportedGates.forEach((gate, index) => {
      gates.push(normalizeGate(gate, fileName, index));
    });
  }

  return gates;
}

function resultMessage(result) {
  if (typeof result.message === 'string' && result.message.length > 0) {
    return result.message;
  }

  if (typeof result.details?.message === 'string' && result.details.message.length > 0) {
    return result.details.message;
  }

  if (typeof result.details?.reason === 'string' && result.details.reason.length > 0) {
    return result.details.reason;
  }

  return result.status === 'skipped' ? 'skipped' : 'failed';
}

function printGateLine(result) {
  if (result.status === 'pass') {
    console.log(`PASS ${result.id}`);
    return;
  }

  if (result.status === 'skipped') {
    console.log(`SKIPPED ${result.id} — ${resultMessage(result)}`);
    return;
  }

  console.log(`FAIL ${result.id} — ${resultMessage(result)}`);
}

async function runGate(gate) {
  const start = performance.now();

  try {
    const output = await gate.run();
    const status = output?.status;
    const normalizedStatus = status === 'pass' || status === 'fail' || status === 'skipped'
      ? status
      : 'fail';

    const result = {
      id: gate.id,
      status: normalizedStatus,
      elapsedMs: Number((performance.now() - start).toFixed(3)),
    };

    if (output?.details !== undefined) result.details = output.details;
    if (normalizedStatus === 'fail' && status !== 'fail') {
      result.message = `gate ${gate.id} returned invalid status ${JSON.stringify(status)}`;
    }

    return result;
  } catch (error) {
    return {
      id: gate.id,
      status: 'fail',
      elapsedMs: Number((performance.now() - start).toFixed(3)),
      message: error?.message || String(error),
    };
  }
}

function selectGates(gates, selectedIds) {
  if (selectedIds.length === 0) {
    return {
      gates,
      missing: [],
    };
  }

  const byId = new Map(gates.map((gate) => [gate.id, gate]));
  const selected = [];
  const missing = [];

  for (const id of selectedIds) {
    const gate = byId.get(id);
    if (gate) {
      selected.push(gate);
    } else {
      missing.push(id);
    }
  }

  return {
    gates: selected,
    missing,
  };
}

function summarize(results) {
  return {
    total: results.length,
    passed: results.filter((result) => result.status === 'pass').length,
    failed: results.filter((result) => result.status === 'fail').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    gates: results,
  };
}

function shouldFail(summary, options) {
  if (summary.failed > 0) return true;
  if (options.strict && summary.skipped > 0) return true;
  if (options.selectionMode && summary.skipped > 0) return true;
  return false;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const registeredGates = await loadGates();
  const selection = selectGates(registeredGates, options.selectedIds);
  const results = [];

  if (registeredGates.length === 0) {
    const result = {
      id: 'gate-runner',
      status: 'fail',
      message: '0 gates registered (suite must not pass vacuously)',
    };
    results.push(result);
    console.log('FAIL gate-runner — 0 gates registered (suite must not pass vacuously)');
  }

  for (const failure of options.failures) {
    results.push(failure);
    printGateLine(failure);
  }

  for (const id of selection.missing) {
    const result = {
      id,
      status: 'fail',
      message: 'selected gate does not exist',
    };
    results.push(result);
    printGateLine(result);
  }

  for (const gate of selection.gates) {
    const result = await runGate(gate);
    results.push(result);
    printGateLine(result);
  }

  const summary = summarize(results);
  console.log(JSON.stringify(summary, null, 2));

  if (shouldFail(summary, options)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.log(`FAIL gate-runner — ${error?.message || String(error)}`);
  console.log(JSON.stringify({
    total: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    gates: [
      {
        id: 'gate-runner',
        status: 'fail',
        message: error?.message || String(error),
      },
    ],
  }, null, 2));
  process.exitCode = 1;
});
