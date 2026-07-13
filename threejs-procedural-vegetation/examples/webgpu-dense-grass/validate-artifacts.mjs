import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvidenceBundle } from "../../../scripts/lib/evidence-v2.mjs";
import { buildDemoRegistry } from "../../../scripts/lib/lab-registry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const index = process.argv.indexOf("--artifacts");
// Default to the shared correctness package (raw-capture-session). Full release
// projections live under docs/visual-validation/.../bundle and are a separate gate.
const directory = resolve(
  index >= 0
    ? process.argv[index + 1]
    : resolve(repoRoot, "artifacts/visual-validation/webgpu-dense-grass/correctness"),
);

const registry = buildDemoRegistry();
const lab = registry.demos.find((entry) => entry.id === "webgpu-dense-grass");
if (!lab) throw new Error("webgpu-dense-grass is absent from the shared demo registry.");

const isCorrectnessPackage = /[/\\]correctness[/\\]?$/.test(directory) || directory.endsWith("correctness");
const requireAccepted = lab.status === "accepted" && !isCorrectnessPackage;
const result = validateEvidenceBundle(directory, { requireRequiredClaimsPass: requireAccepted });
if (!result.valid) {
  throw new Error(`dense-grass v2 evidence incomplete:\n- ${result.errors.join("\n- ")}`);
}

if (isCorrectnessPackage) {
  const sessionPath = resolve(directory, "capture-session.json");
  if (!existsSync(sessionPath)) throw new Error("missing capture-session.json");
  const session = JSON.parse(readFileSync(sessionPath, "utf8"));
  if (session.labId !== lab.id) throw new Error("capture-session labId mismatch");
  if (session.sourceHash !== lab.sourceHash && session.sourceClosureHash !== lab.sourceHash) {
    throw new Error("capture-session sourceHash mismatch");
  }
}

console.log(JSON.stringify({
  pass: true,
  directory,
  requireAccepted,
  claimVerdicts: result.manifest?.claimVerdicts ?? null,
}));
