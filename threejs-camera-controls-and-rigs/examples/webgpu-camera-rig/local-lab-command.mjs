import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateEvidenceBundle } from "../../../scripts/lib/evidence-v2.mjs";
import { buildDemoRegistry } from "../../../scripts/lib/lab-registry.mjs";

const operation = process.argv[2];
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const manifest = JSON.parse(readFileSync(new URL("./lab.manifest.json", import.meta.url), "utf8"));

if (operation === "capture") {
  console.error("camera GPU capture is pending the root browser runner; no synthetic artifact was generated");
  process.exit(2);
}

if (operation === "artifacts") {
  const registry = buildDemoRegistry();
  const lab = registry.demos.find((entry) => entry.id === "webgpu-camera-rig");
  if (!lab) throw new Error("webgpu-camera-rig missing from registry");

  // Primary correctness packages validate structurally even when the lab status
  // is accepted (full release-bundle gates are a separate path).
  const defaultCorrectness = "artifacts/visual-validation/webgpu-camera-rig/correctness";
  const argIndex = process.argv.indexOf("--artifacts");
  const bundlePath = argIndex >= 0
    ? process.argv[argIndex + 1]
    : defaultCorrectness;
  const resolved = resolve(repoRoot, bundlePath);
  if (!existsSync(resolved)) {
    console.error(`camera artifact validation cannot pass: evidence bundle missing at ${bundlePath}`);
    process.exit(2);
  }

  const isCorrectnessPackage = /[/\\]correctness[/\\]?$/.test(resolved) || resolved.endsWith("correctness");
  const requireAccepted = lab.status === "accepted" && !isCorrectnessPackage;
  const result = validateEvidenceBundle(resolved, {
    requireRequiredClaimsPass: requireAccepted,
  });
  if (!result.valid) {
    console.error(JSON.stringify({
      pass: false,
      labId: "webgpu-camera-rig",
      errors: result.errors,
      protocol: result.protocol,
    }, null, 2));
    process.exit(1);
  }

  const sessionPath = resolve(resolved, "capture-session.json");
  if (!existsSync(sessionPath)) {
    console.error("camera artifact validation requires capture-session.json");
    process.exit(1);
  }
  const session = JSON.parse(readFileSync(sessionPath, "utf8"));
  if (session.labId !== "webgpu-camera-rig") {
    console.error("capture-session labId mismatch");
    process.exit(1);
  }
  if (session.sourceHash !== lab.sourceHash && session.sourceClosureHash !== lab.sourceHash) {
    console.error("capture-session sourceHash mismatch");
    process.exit(1);
  }

  console.log(JSON.stringify({
    pass: true,
    labId: "webgpu-camera-rig",
    bundle: bundlePath,
    protocol: result.protocol,
    requireAccepted,
    claimVerdicts: result.manifest?.claimVerdicts ?? result.json?.["evidence-manifest.json"]?.claimVerdicts ?? null,
  }, null, 2));
} else {
  throw new RangeError(`unknown local lab operation: ${operation}`);
}
