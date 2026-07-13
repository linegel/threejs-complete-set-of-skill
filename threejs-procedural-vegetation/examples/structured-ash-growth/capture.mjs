import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { captureLabBrowser } from "../../../scripts/capture-lab-browser.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

await captureLabBrowser({
  labId: "structured-ash-growth",
  profile: option("--profile", "correctness"),
  outputDir: option("--output") ? resolve(option("--output")) : null,
  target: option("--target", "final"),
  hookPath: fileURLToPath(new URL("./capture-hook.mjs", import.meta.url)),
});
