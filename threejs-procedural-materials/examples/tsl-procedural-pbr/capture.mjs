import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { captureLabBrowser } from "../../../scripts/capture-lab-browser.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const record = await captureLabBrowser({
  labId: "tsl-procedural-pbr",
  profile: option("--profile", "correctness"),
  outputDir: option("--output") ? resolve(option("--output")) : null,
  target: option("--target", "final"),
  hookPath: fileURLToPath(new URL("./capture-hook.mjs", import.meta.url)),
});

console.log(JSON.stringify({
  labId: record.labId,
  profile: record.profile,
  status: record.hookResult?.status,
  output: record.hookResult?.captures,
}, null, 2));
