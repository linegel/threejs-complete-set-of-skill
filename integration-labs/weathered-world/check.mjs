import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateWeatheredWorldStatic } from "./validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.(?:mjs|js)$/.test(entry.name)) files.push(path);
  }
  return files;
}

for (const file of await sourceFiles(here)) {
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
}
const result = await validateWeatheredWorldStatic();
console.log(`Weathered World check passed (${result.modes} modes, ${result.tiers} tiers).`);
