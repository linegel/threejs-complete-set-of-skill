import { resolve } from "node:path";
import { validateEvidenceBundle } from "../../../scripts/lib/evidence-v2.mjs";
const index = process.argv.indexOf("--artifacts");
const directory = resolve(index >= 0 ? process.argv[index + 1] : "artifacts/visual-validation/webgpu-dense-grass");
const result = validateEvidenceBundle(directory);
if (!result.valid) throw new Error(`dense-grass v2 evidence incomplete:\n- ${result.errors.join("\n- ")}`);
console.log(JSON.stringify({ pass: true, directory }));
