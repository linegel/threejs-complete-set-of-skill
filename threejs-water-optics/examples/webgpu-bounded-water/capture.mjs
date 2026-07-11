import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureLabBrowser } from "../../../scripts/capture-lab-browser.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const profileIndex = process.argv.indexOf("--profile");
const profile = profileIndex >= 0 ? process.argv[profileIndex + 1] : (process.env.LAB_PROFILE ?? "correctness");

await captureLabBrowser({
  labId: "webgpu-bounded-water",
  profile,
  outputDir: process.env.LAB_ARTIFACT_DIR ?? null,
  hookPath: resolve(here, "capture-hook.mjs"),
});
