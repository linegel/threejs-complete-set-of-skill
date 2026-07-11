import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let output = resolve(here, "../../artifacts/visual-validation/weathered-world");
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === "--output") output = resolve(process.argv[++index]);
  else throw new Error(`Unknown artifact-validation argument "${process.argv[index]}"`);
}

const requiredJson = [
  "visual-contract.json",
  "evidence-manifest.json",
  "renderer-info.json",
  "pipeline-graph.json",
  "performance-envelope.json",
  "frame-trace.json",
  "quality-governor.json",
  "render-targets.json",
  "storage-resources.json",
  "resident-resources.json",
  "bandwidth-model.json",
  "visual-errors.json",
  "leak-loop.json",
  "mechanism-metrics.json",
];
const requiredImages = [
  "final.design.png",
  "no-post.design.png",
  "diagnostics.mosaic.png",
  "camera.near.png",
  "camera.design.png",
  "camera.far.png",
  "seed-0001.final.png",
  "seed-9e3779b9.final.png",
  "temporal.t000.png",
  "temporal.t001.png",
  "tier.hero.png",
  "tier.balanced.png",
  "tier.budgeted.png",
];
const failures = [];
const documents = new Map();

for (const name of requiredJson) {
  try {
    const value = JSON.parse(await readFile(resolve(output, name), "utf8"));
    documents.set(name, value);
    if (value.schemaVersion !== 2) failures.push(`${name} is not schema v2`);
  } catch (error) {
    failures.push(`${name} missing or invalid: ${error.message}`);
  }
}
const imageBytes = new Map();
for (const name of requiredImages) {
  try {
    const bytes = await readFile(resolve(output, "images", name));
    imageBytes.set(name, bytes);
    if (bytes.length < 8 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") failures.push(`${name} is not a PNG`);
  } catch (error) {
    failures.push(`${name} missing: ${error.message}`);
  }
}
if (imageBytes.get("final.design.png")?.equals(imageBytes.get("diagnostics.mosaic.png"))) {
  failures.push("diagnostics.mosaic.png duplicates final.design.png");
}

const evidence = documents.get("evidence-manifest.json");
if (evidence) {
  for (const claim of evidence.claims ?? []) {
    if (claim.required && claim.verdict !== "PASS") failures.push(`${claim.id}: ${claim.verdict}`);
  }
}
const performance = documents.get("performance-envelope.json");
if (performance?.gpuTimingRequirement === "required" && performance?.verdict !== "PASS") {
  failures.push(`current-adapter GPU timing: ${performance?.verdict ?? "missing"}`);
}
const leakLoop = documents.get("leak-loop.json");
if (leakLoop?.verdict !== "PASS" || (leakLoop?.executedCycles?.value ?? 0) < 50) {
  failures.push("50-cycle lifecycle evidence is absent or insufficient");
}
const visualErrors = documents.get("visual-errors.json");
if (visualErrors?.verdict !== "PASS") failures.push(`visual-error evidence: ${visualErrors?.verdict ?? "missing"}`);

if (failures.length) {
  console.error(`Weathered World artifact validation failed (${failures.length} blockers):\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Weathered World artifact validation passed.");
}
