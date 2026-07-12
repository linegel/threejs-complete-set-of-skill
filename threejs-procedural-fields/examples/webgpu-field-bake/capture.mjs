#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { captureLabBrowser } from "../../../scripts/capture-lab-browser.mjs";

const LAB_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ARTIFACT_DIR = resolve(
  LAB_DIR,
  "../../../artifacts/visual-validation/webgpu-field-bake/correctness",
);
export const CAPTURE_HOOK_PATH = resolve(LAB_DIR, "capture-hook.mjs");

export function validateCaptureArtifactPathContract(captureOutputDir, validatorArtifactDir) {
  const capturePath = resolve(captureOutputDir);
  const validatorPath = resolve(validatorArtifactDir);
  if (capturePath !== validatorPath) {
    throw new Error(`field capture writes ${capturePath}, but artifact validation reads ${validatorPath}`);
  }
  return capturePath;
}

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function parseArgs(argv) {
  const allowed = new Set(["--profile", "--output", "--target"]);
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    if (!allowed.has(option)) throw new Error(`unknown field capture option: ${option}`);
    if (argv[index + 1] === undefined || argv[index + 1].startsWith("--")) {
      throw new Error(`${option} requires a value`);
    }
  }
  const profile = optionValue(argv, "--profile") ?? "correctness";
  return {
    profile,
    outputDir: optionValue(argv, "--output") ?? (
      profile === "correctness"
        ? DEFAULT_ARTIFACT_DIR
        : resolve(LAB_DIR, `../../../artifacts/visual-validation/webgpu-field-bake/${profile}`)
    ),
    target: optionValue(argv, "--target") ?? "display",
  };
}

export async function captureFieldBake(options = {}) {
  const outputDir = options.outputDir ?? DEFAULT_ARTIFACT_DIR;
  validateCaptureArtifactPathContract(
    outputDir,
    options.validatorArtifactDir ?? outputDir,
  );
  return captureLabBrowser({
    labId: "webgpu-field-bake",
    profile: options.profile ?? "correctness",
    outputDir,
    hookPath: CAPTURE_HOOK_PATH,
    target: options.target ?? "display",
  });
}

async function main() {
  const result = await captureFieldBake(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify({
    labId: result.labId,
    profile: result.profile,
    outputDir: result.outputDir,
    outputPlan: result.outputPlan,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
