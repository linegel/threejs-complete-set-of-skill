import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const operation = process.argv[2];
const manifest = JSON.parse(readFileSync(new URL("./lab.manifest.json", import.meta.url), "utf8"));
if (operation === "capture") {
  console.error("camera GPU capture is pending the root browser runner; no synthetic artifact was generated");
  process.exit(2);
}
if (operation === "artifacts") {
  assert.equal(manifest.status, "incomplete");
  if (manifest.evidenceBundle === null) {
    console.error("camera artifact validation cannot pass: required v2 GPU evidence bundle is absent");
    process.exit(2);
  }
} else {
  throw new RangeError(`unknown local lab operation: ${operation}`);
}
