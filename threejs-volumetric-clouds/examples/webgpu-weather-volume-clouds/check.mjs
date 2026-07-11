import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const file of readdirSync(here).filter((name) => /\.(?:m?js)$/u.test(name))) {
  const result = spawnSync(process.execPath, ["--check", resolve(here, file)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("webgpu-weather-volume-clouds syntax checks passed");
