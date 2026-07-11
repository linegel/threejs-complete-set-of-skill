import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateEvidenceBundle } from "../../../scripts/lib/evidence-v2.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const bundleDir = resolve(process.env.LAB_ARTIFACT_DIR ?? resolve(root, "artifacts/visual-validation/webgpu-tower-ship-sculptor"));

if (!existsSync(bundleDir)) {
  console.error(JSON.stringify({ schemaVersion: 2, labId: "webgpu-tower-ship-sculptor", verdict: "INSUFFICIENT_EVIDENCE", bundleDir, reason: "artifact bundle does not exist" }, null, 2));
  process.exit(1);
}

const result = validateEvidenceBundle(bundleDir);
const requiredImages = ["final.design.png", "blockout.design.png", "hierarchy.design.png", "materials.close.png", "interaction.design.t000.png", "interaction.design.t120.png", "camera.profile.png", "camera.bow.png"];
const errors = [...result.errors];
for (const image of requiredImages) if (!existsSync(resolve(bundleDir, image))) errors.push(`missing required image ${image}`);
console.log(JSON.stringify({ schemaVersion: 2, labId: "webgpu-tower-ship-sculptor", bundleDir, structuralVerdict: errors.length ? "FAIL" : "PASS", claimVerdict: "INCOMPLETE", errors }, null, 2));
if (errors.length) process.exitCode = 1;

