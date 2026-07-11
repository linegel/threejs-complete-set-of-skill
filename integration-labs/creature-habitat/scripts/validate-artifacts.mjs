import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const accepted = path.join(root, "artifacts", "evidence-manifest.json");
if (!fs.existsSync(accepted)) {
  process.stderr.write(
    "INSUFFICIENT_EVIDENCE: no Creature Habitat v2 evidence bundle exists; runtime implementation remains incomplete.\n",
  );
  process.exitCode = 2;
} else {
  const manifest = JSON.parse(fs.readFileSync(accepted, "utf8"));
  if (manifest.schemaVersion !== 2 || manifest.labId !== "creature-habitat") {
    throw new Error("Creature Habitat artifact manifest is not a matching v2 bundle");
  }
}

