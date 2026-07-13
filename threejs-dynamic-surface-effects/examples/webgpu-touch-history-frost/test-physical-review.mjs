import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, "physical-review.html"), "utf8");
const client = readFileSync(resolve(here, "physical-review.js"), "utf8");
const entry = readFileSync(resolve(here, "main.js"), "utf8");
const observer = readFileSync(resolve(here, "physical-observer.js"), "utf8");
const wrapper = readFileSync(resolve(here, "route-wrapper.js"), "utf8");

assert(html.includes("data-canvas-visible"));
assert(html.includes("data-modes-distinct"));
assert(html.includes("data-notes required"));
assert(!html.includes("—") && !html.includes("–"), "review UI must not contain decorative dash characters");
assert(client.includes('ROUTE_PATH = "/mechanism/refraction-and-fresnel/index.html"'));
assert(client.includes('captureHash("final")'));
assert(client.includes('captureHash("frost-mask-after-pointer")'));
assert(client.includes('capturePixels("presentation")'), "review captures must read the currently selected presentation node");
assert(client.includes("servedLedgerHash: null"), "browser record must remain pending offline ledger binding");
assert(client.includes('performanceCompliance: "NOT_CLAIMED"'));
assert(client.includes("await controller.dispose()"));
assert(entry.includes("globalThis.__THREEJS_LAB__ = lab"));
assert(entry.includes('document.documentElement.dataset.ready = "true"'));
assert(observer.includes('get("physicalReview") === "1"'));
assert(wrapper.includes('import("./bootstrap.js")'), "fixed routes must use the same shell and runtime bootstrap");

console.log("frost physical review surface contract passed");
