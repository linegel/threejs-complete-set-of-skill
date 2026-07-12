import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { computeCorpusSourceProvenance } from "./validate-artifacts.mjs";
import {
  buildTrustedCorpusRuntimeSourceManifest,
  computeCorpusTrustedRuntimeSourceManifestHash,
  parseActiveHtmlElements,
  validateRouteHtml,
} from "./validate-routes.mjs";
import {
  CORPUS_IN_APP_ROUTE_PLAN,
  CORPUS_ROUTE_EVIDENCE_QUERY,
  CORPUS_ROUTE_EVIDENCE_RUNNER_URL,
} from "./route-evidence-plan.js";
import {
  CORPUS_CAPTURE_BUILD_REVISION,
  CORPUS_CAPTURE_SOURCE_HASH,
  CORPUS_TRUSTED_ROUTE_HTML_SHA256_BY_ROUTE_ID,
  CORPUS_TRUSTED_RUNTIME_SOURCE_MANIFEST,
  CORPUS_TRUSTED_RUNTIME_SOURCE_MANIFEST_SHA256,
} from "./trusted-runtime-source-manifest.generated.js";

const here = dirname(fileURLToPath(import.meta.url));
const MANUAL_URL = CORPUS_ROUTE_EVIDENCE_RUNNER_URL;

function source(path) {
  return readFileSync(resolve(here, path), "utf8");
}

function sourceBytes(path) {
  return readFileSync(resolve(here, path));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function activeElementsWithId(elements, id) {
  return elements.filter(({ attributes }) => attributes.get("id") === id);
}

function assertNoInlineExecution(elements, label) {
  const executableUrlAttributes = new Set(["action", "cite", "data", "formaction", "href", "longdesc", "manifest", "poster", "src", "xlink:href"]);
  for (const element of elements) {
    assert(element.name !== "style", `${label} must not contain active inline style elements`);
    for (const [name, value] of element.attributes) {
      assert(!name.startsWith("on"), `${label} must not contain inline ${name} handlers`);
      assert(name !== "srcdoc" && name !== "style", `${label} must not contain executable ${name} attributes`);
      if (executableUrlAttributes.has(name) && typeof value === "string") {
        assert(!value.includes("&"), `${label} URL attributes must not use entity-obscured executable schemes`);
        const normalized = value.replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
        assert(!/^(?:javascript|vbscript|data):/.test(normalized), `${label} must not contain executable URL schemes`);
      }
    }
    if (element.name === "meta" && (element.attributes.get("http-equiv") ?? "").toLowerCase() === "refresh") {
      assert.fail(`${label} must not contain meta refresh execution`);
    }
  }
}

function assertPhysicalRouteHtml(html, route) {
  validateRouteHtml(html, route);
  const elements = parseActiveHtmlElements(html, route.routeId);
  assertNoInlineExecution(elements, route.routeId);
  const scripts = elements.filter(({ name }) => name === "script");
  assert.equal(scripts.length, 3, `${route.routeId} active script inventory drifted`);
  const bootstrap = scripts[0];
  assert.equal(bootstrap.attributes.get("src"), "../../route-evidence-bootstrap.js", `${route.routeId} bootstrap must be the first active script`);
  assert.equal(bootstrap.attributes.get("data-surface"), "route", `${route.routeId} bootstrap surface drifted`);
  assert.equal(scripts[1].attributes.get("type"), "importmap", `${route.routeId} import map must follow the observer bootstrap`);
  assert.equal(scripts[2].attributes.get("src"), "../../app.js", `${route.routeId} app must be the third and final active script`);
  const stylesheet = elements.find(({ name, attributes }) => name === "link" && attributes.get("href") === "../../styles.css");
  assert(bootstrap && stylesheet && bootstrap.sourceIndex < stylesheet.sourceIndex, `${route.routeId} request observers must install before subresource loads`);
  const networkElements = elements.filter(({ name, attributes }) => (
    (name === "script" && attributes.has("src"))
    || (name === "link" && attributes.has("href"))
    || (["img", "iframe", "audio", "video", "source"].includes(name) && attributes.has("src"))
  ));
  assert(networkElements.every(({ sourceIndex }) => sourceIndex >= bootstrap.sourceIndex), `${route.routeId} loads a network resource before the observer bootstrap`);
}

function assertRunnerHtml(html) {
  const elements = parseActiveHtmlElements(html, "in-app-evidence.html");
  assertNoInlineExecution(elements, "in-app-evidence.html");
  const scripts = elements.filter(({ name }) => name === "script");
  assert.equal(scripts.length, 2, "runner must contain exactly its bootstrap and module scripts");
  assert.equal(elements.filter(({ name }) => name === "base").length, 0, "runner must not redefine its canonical URL base");
  const runnerScripts = scripts.filter(({ attributes }) => attributes.get("src") === "./in-app-evidence-runner.js");
  assert.equal(runnerScripts.length, 1, "runner must expose one active entry script");
  assert.deepEqual([...runnerScripts[0].attributes.keys()].sort(), ["src", "type"], "runner entry script attributes drifted");
  assert.equal(runnerScripts[0].attributes.get("type"), "module", "runner entry must be an ES module");
  assert.equal(runnerScripts[0].parentName, "body", "runner entry must be a direct body child");
  const bootstrap = scripts[0];
  assert.equal(bootstrap.attributes.get("src"), "./route-evidence-bootstrap.js", "runner bootstrap path drifted");
  assert.equal(bootstrap.attributes.get("data-surface"), "runner", "runner bootstrap surface drifted");
  assert.equal(bootstrap.parentName, "head", "runner bootstrap must be a direct head child");
  assert.equal(scripts[1], runnerScripts[0], "runner module must execute after its observer bootstrap");
  const expectedTagById = {
    "runner-status": "output",
    "bundle-id": "input",
    "run-id": "input",
    start: "button",
    copy: "button",
    download: "button",
    "download-bundle": "button",
    progress: "progress",
    "route-results": "ol",
    "route-frame": "iframe",
    "current-route": "span",
    "output-json": "pre",
  };
  for (const [id, expectedTag] of Object.entries(expectedTagById)) {
    const matches = activeElementsWithId(elements, id);
    assert.equal(matches.length, 1, `runner must expose exactly one active #${id}`);
    assert.equal(matches[0].name, expectedTag, `runner #${id} element type drifted`);
  }
  const iframe = activeElementsWithId(elements, "route-frame")[0];
  assert.equal(elements.filter(({ name }) => name === "iframe").length, 1, "runner must contain only its inert evidence iframe");
  assert.equal(iframe.attributes.has("src"), false, "runner evidence iframe must not navigate before the parent observer is installed");
  assert.equal(elements.filter(({ name }) => ["object", "embed"].includes(name)).length, 0, "runner must not contain executable embedded documents");
  const stylesheets = elements.filter(({ name, attributes }) => name === "link" && attributes.get("rel") === "stylesheet");
  assert.equal(stylesheets.length, 1, "runner must contain exactly one stylesheet link");
  assert.equal(stylesheets[0].attributes.get("href"), "./in-app-evidence.css", "runner stylesheet path drifted");
  assert(bootstrap.sourceIndex < stylesheets[0].sourceIndex, "runner observers must install before its stylesheet request");
  assert.equal(iframe.attributes.get("width"), "768", "runner evidence viewport width drifted");
  assert.equal(iframe.attributes.get("height"), "512", "runner evidence viewport height drifted");
}

export function validateInAppEvidenceRunner() {
  assert.equal(CORPUS_IN_APP_ROUTE_PLAN.length, 15, "in-app route plan must contain 15 physical routes");
  assert.equal(new Set(CORPUS_IN_APP_ROUTE_PLAN.map(({ routeId }) => routeId)).size, 15, "in-app route IDs must be unique");
  assert.equal(CORPUS_ROUTE_EVIDENCE_QUERY, "?capture=1", "in-app route query must preserve exclusive capture ownership");

  const runnerHtml = source("in-app-evidence.html");
  assertRunnerHtml(runnerHtml);

  const app = source("app.js");
  assert(app.includes("createCorpusRouteEvidenceProducer"), "corpus app must create the physical-route evidence producer");
  assert(app.includes("__CORPUS_ROUTE_EVIDENCE__"), "corpus app must expose its same-origin evidence producer");
  assert(app.includes('cameraInteractionEnabled: frameOwner === "live-page" && physicalRouteLockCount === 0'), "physical and capture routes must disable camera interaction");
  const evidenceClient = source("route-evidence-client.js");
  assert(evidenceClient.includes("object-sculptor-route-camera-v1"), "route evidence must bind the stable camera pose");
  assert(evidenceClient.includes("object-sculptor-route-source-v4"), "route evidence must bind immutable served bytes and canonical closure");
  assert(evidenceClient.includes("takeArtifacts"), "route evidence must retain native readback bytes outside JSON");
  assert(evidenceClient.includes("route-readbacks/transport/"), "route evidence must retain exact renderer transport bytes in a confined namespace");
  assert(evidenceClient.includes("route-readbacks/normalized/"), "route evidence must retain independently normalized bytes in a confined namespace");
  assert(evidenceClient.includes("independently zero-filled"), "route evidence must prove normalized row padding is zero-filled");
  assert(evidenceClient.includes("executed same-origin resource is absent from immutable manifest"), "route evidence must reject executable resources outside the immutable manifest");
  const runnerSource = source("in-app-evidence-runner.js");
  assert(runnerSource.includes("CORPUS_IN_APP_ROUTE_PLAN.length * 2"), "runner must require two retained readback artifacts per physical route");
  assert(runnerSource.includes("waitForChildAnimationFrames"), "runner must settle two child animation frames before post-disposal error closure");
  const tarBuildIndex = runnerSource.indexOf("evidenceTar = buildRouteEvidenceTar");
  const resultPublishIndex = runnerSource.indexOf("window.__CORPUS_ROUTE_EVIDENCE_RESULT__ = documentRecord");
  assert(tarBuildIndex >= 0 && resultPublishIndex > tarBuildIndex, "runner must build and validate its TAR before publishing completion");
  assert(runnerSource.includes("failClosedPhysicalRouteCollection"), "runner failure cleanup must reset the iframe even before producer acquisition");
  const bootstrapSource = source("route-evidence-bootstrap.js");
  for (const observer of ["window.addEventListener(\"error\"", "console.error =", "window.addEventListener(\"unhandledrejection\"", "uncapturederror", "device.lost"]) {
    assert(bootstrapSource.includes(observer), `route evidence bootstrap is missing ${observer}`);
  }

  const generator = source("generate-routes.mjs");
  assert(generator.includes('<script src="../../route-evidence-bootstrap.js" data-surface="route"></script>'), "route generator does not own the capture-scoped observer bootstrap tag");
  assert(generator.includes('<script type="importmap">'), "route generator must resolve browser modules without a Vite transform");
  const immutableServer = source("immutable-route-server.mjs");
  assert(immutableServer.includes('transformMode: "none"'), "immutable route server must attest no source transform");
  assert(immutableServer.includes("spaFallback: false"), "immutable route server must disable SPA fallback");
  assert(!immutableServer.includes("from \"vite\""), "immutable route server must not import Vite");
  for (const route of CORPUS_IN_APP_ROUTE_PLAN) {
    const routePath = `${route.urlPath}index.html`;
    assertPhysicalRouteHtml(source(routePath), route);
    assert.equal(
      CORPUS_TRUSTED_ROUTE_HTML_SHA256_BY_ROUTE_ID[route.routeId],
      sha256(sourceBytes(routePath)),
      `${route.routeId} generated trusted route hash is stale`,
    );
  }

  const trustedManifest = buildTrustedCorpusRuntimeSourceManifest();
  assert.deepEqual(CORPUS_TRUSTED_RUNTIME_SOURCE_MANIFEST, trustedManifest, "generated trusted runtime source manifest is stale");
  assert.equal(
    CORPUS_TRUSTED_RUNTIME_SOURCE_MANIFEST_SHA256,
    computeCorpusTrustedRuntimeSourceManifestHash(trustedManifest),
    "generated trusted runtime source manifest digest is stale",
  );
  const captureSource = computeCorpusSourceProvenance();
  assert.equal(CORPUS_CAPTURE_SOURCE_HASH, captureSource.sourceHash, "generated canonical capture source hash is stale");
  assert.equal(CORPUS_CAPTURE_BUILD_REVISION, captureSource.buildRevision, "generated canonical capture build revision is stale");

  const packageDocument = JSON.parse(source("package.json"));
  const captureCommand = packageDocument.scripts?.capture ?? "";
  assert.equal(
    captureCommand,
    "node ../../../scripts/capture-lab-browser.mjs --lab webgpu-object-sculptor-corpus --target presentation --hook capture-hook.mjs",
    "package capture must remain compatible with the root shared native-WebGPU capture harness",
  );
  const routePreparationCommand = packageDocument.scripts?.["prepare:physical-routes"] ?? "";
  assert(routePreparationCommand.includes("generate:routes") && routePreparationCommand.includes("generate:trusted-route-sources"), "physical route preparation must explicitly regenerate routes and source closure");
  assert(!/playwright|chrome|headless|capture-lab-browser/i.test(routePreparationCommand), "route evidence preparation must not launch an external browser harness");
  assert.equal(packageDocument.scripts?.["serve:routes:immutable"], "node immutable-route-server.mjs", "package must expose the immutable no-transform route server");
  assert.equal(packageDocument.scripts?.["generate:routes:check"], "node generate-routes.mjs --check", "package must expose non-mutating route generation validation");
  assert.equal(packageDocument.scripts?.["generate:trusted-route-sources:check"], "node generate-trusted-runtime-source-manifest.mjs --check", "package must expose non-mutating source-closure validation");
  const quickCommand = packageDocument.scripts?.["validate:quick"] ?? "";
  assert(quickCommand.includes("generate:routes:check") && quickCommand.includes("generate:trusted-route-sources:check"), "validate:quick must use only check-only route/source generation aliases");
  assert(!/npm run generate:routes(?:\s|$)/.test(quickCommand.replaceAll("generate:routes:check", "")), "validate:quick must not rewrite physical routes");
  assert(!/npm run generate:trusted-route-sources(?:\s|$)/.test(quickCommand.replaceAll("generate:trusted-route-sources:check", "")), "validate:quick must not rewrite trusted source output");
  assert((packageDocument.scripts?.check ?? "").includes("route-evidence-bootstrap.js"), "syntax checks must include the route observer bootstrap");
  assert((packageDocument.scripts?.check ?? "").includes("immutable-route-server.mjs"), "syntax checks must include the immutable route server");
  assert((packageDocument.scripts?.check ?? "").includes("trusted-runtime-source-manifest.generated.js"), "syntax checks must include the generated trusted-source module");
  assert((packageDocument.scripts?.["validate:in-app-runner"] ?? "").includes("validate-in-app-evidence-runner.mjs"), "package must expose static in-app runner validation");
  assert((packageDocument.scripts?.["validate:unit"] ?? "").includes("test-immutable-route-server.mjs"), "unit validation must exercise immutable exact-route serving and missing-route rejection");

  return Object.freeze({
    ok: true,
    requiredBrowserSurface: "codex-in-app-browser",
    launchesBrowser: false,
    physicalRoutes: CORPUS_IN_APP_ROUTE_PLAN.length,
    routeQuery: CORPUS_ROUTE_EVIDENCE_QUERY,
    manualUrl: MANUAL_URL,
  });
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    const result = validateInAppEvidenceRunner();
    console.log(JSON.stringify({
      ...result,
      mode: process.argv.includes("--prepare") ? "manual-open-preparation" : "static-validation",
      instruction: "Open manualUrl in Codex's in-app Browser; the page auto-runs and exposes window.__CORPUS_ROUTE_EVIDENCE_RESULT__ only after 15/15 pass.",
    }, null, 2));
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
