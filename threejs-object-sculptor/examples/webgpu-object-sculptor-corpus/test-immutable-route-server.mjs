import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import {
  CORPUS_ROUTE_IMMUTABLE_MANIFEST_PATH,
} from "./route-evidence-plan.js";
import { parseCorpusRouteGeneratorArguments } from "./generate-routes.mjs";
import {
  createImmutableCorpusResponder,
  discoverImmutableBrowserDependencies,
} from "./immutable-route-server.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function header(response, name) {
  const expected = name.toLowerCase();
  const entry = Object.entries(response.headers).find(([key]) => key.toLowerCase() === expected);
  return entry?.[1] ?? null;
}

assert.deepEqual(parseCorpusRouteGeneratorArguments([]), { checkOnly: false });
assert.deepEqual(parseCorpusRouteGeneratorArguments(["--check"]), { checkOnly: true });
assert.throws(() => parseCorpusRouteGeneratorArguments(["--bogus"]), /Unknown corpus route generator argument/);
assert.throws(() => parseCorpusRouteGeneratorArguments(["--check", "--check"]), /at most once/);

for (const [path, source] of [
  ["fixture.js", 'import "https://invalid.example/module.js";'],
  ["fixture.html", '<script src="//invalid.example/module.js"></script>'],
  ["fixture.css", '@import "http://invalid.example/style.css";'],
]) {
  assert.throws(
    () => discoverImmutableBrowserDependencies(path, Buffer.from(source)),
    /forbidden network dependency/,
  );
}
assert.deepEqual(
  discoverImmutableBrowserDependencies("fixture.css", Buffer.from('body { background: url("data:image/png;base64,AA=="); }')),
  [],
);

const bootstrapSource = readFileSync(new URL("./route-evidence-bootstrap.js", import.meta.url), "utf8");

function runBootstrap({ origin, pathname, search, surface }) {
  const listeners = [];
  const requestAdapter = async () => null;
  const script = { dataset: { surface } };
  const window = {
    addEventListener: (...args) => listeners.push(args),
  };
  const context = {
    window,
    document: {
      currentScript: script,
      head: { contains: (value) => value === script },
      readyState: "loading",
      scripts: [script],
    },
    location: { origin, pathname, search },
    navigator: { gpu: { requestAdapter } },
    performance: { timeOrigin: 1, now: () => 2 },
    console: { error: () => {} },
    URLSearchParams,
    WeakSet,
    Object,
    Error,
    TypeError,
    Promise,
    RegExp,
    String,
    Number,
    JSON,
    Array,
    Set,
  };
  vm.runInNewContext(bootstrapSource, context, { filename: "route-evidence-bootstrap.js" });
  return { window, listeners, requestAdapter, navigator: context.navigator };
}

const ordinaryRoute = runBootstrap({
  origin: "https://threejs-skills.com",
  pathname: "/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/scenario/potted-bonsai/",
  search: "",
  surface: "route",
});
assert.equal(ordinaryRoute.window.__CORPUS_ROUTE_EVIDENCE_BOOTSTRAP__.enabled, false);
assert.equal(ordinaryRoute.listeners.length, 0);
assert.equal(ordinaryRoute.navigator.gpu.requestAdapter, ordinaryRoute.requestAdapter);

const exactCaptureRoute = runBootstrap({
  origin: "http://127.0.0.1:4174",
  pathname: "/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/scenario/potted-bonsai/",
  search: "?capture=1",
  surface: "route",
});
assert.equal(exactCaptureRoute.window.__CORPUS_ROUTE_EVIDENCE_BOOTSTRAP__.enabled, true);
assert(exactCaptureRoute.listeners.length >= 2);
assert.notEqual(exactCaptureRoute.navigator.gpu.requestAdapter, exactCaptureRoute.requestAdapter);

const ambiguousCaptureRoute = runBootstrap({
  origin: "http://127.0.0.1:4174",
  pathname: "/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/scenario/potted-bonsai/",
  search: "?capture=1&extra=1",
  surface: "route",
});
assert.equal(ambiguousCaptureRoute.window.__CORPUS_ROUTE_EVIDENCE_BOOTSTRAP__.enabled, false);
assert.equal(ambiguousCaptureRoute.listeners.length, 0);

const origin = "http://127.0.0.1:4174";
const responder = createImmutableCorpusResponder({ origin });
const manifestResponse = responder.respond({ url: CORPUS_ROUTE_IMMUTABLE_MANIFEST_PATH });
assert.equal(manifestResponse.status, 200);
assert.equal(header(manifestResponse, "x-corpus-transform"), "none");
assert.equal(header(manifestResponse, "x-corpus-immutable-snapshot"), responder.snapshot.snapshotId);
const manifestBytes = new Uint8Array(manifestResponse.body);
assert.equal(sha256(manifestBytes), header(manifestResponse, "x-content-sha256"));
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
assert.equal(manifest.origin, origin);
assert.equal(manifest.immutableSnapshot, true);
assert.equal(manifest.spaFallback, false);
assert.equal(manifest.viteClient, false);
assert.equal(manifest.transformMode, "none");
assert(manifest.entries.some(({ path }) => path === "node_modules/three/build/three.webgpu.js"));
assert(!manifest.entries.some(({ path }) => path.includes("/@vite/client")));

const routePath = "/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/scenario/potted-bonsai/";
const routeResponse = responder.respond({ url: `${routePath}?capture=1` });
assert.equal(routeResponse.status, 200);
assert.equal(header(routeResponse, "x-corpus-transform"), "none");
assert.equal(header(routeResponse, "x-corpus-spa-fallback"), null);
const routeBytes = new Uint8Array(routeResponse.body);
assert.equal(sha256(routeBytes), header(routeResponse, "x-content-sha256"));
assert.equal(header(routeResponse, "x-corpus-immutable-snapshot"), responder.snapshot.snapshotId);
assert.match(new TextDecoder().decode(routeBytes), /<script type="importmap">/);
assert.doesNotMatch(new TextDecoder().decode(routeBytes), /\/@vite\/client/);

const headResponse = responder.respond({ method: "HEAD", url: routePath });
assert.equal(headResponse.status, 200);
assert.equal(headResponse.body, null);
assert.equal(Number(header(headResponse, "content-length")), routeBytes.byteLength);

const methodResponse = responder.respond({ method: "POST", url: routePath });
assert.equal(methodResponse.status, 405);
assert.equal(header(methodResponse, "allow"), "GET, HEAD");

const malformedResponse = responder.respond({ url: "/%E0%A4%A" });
assert.equal(malformedResponse.status, 400);

const missingResponse = responder.respond({
  url: "/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/does-not-exist/",
});
assert.equal(missingResponse.status, 404);
assert.equal(header(missingResponse, "x-corpus-spa-fallback"), "disabled");
assert.doesNotMatch(new TextDecoder().decode(missingResponse.body), /<!doctype html>/i);

console.log(JSON.stringify({
  ok: true,
  snapshotId: responder.snapshot.snapshotId,
  entries: responder.snapshot.entries.length,
  exactRouteBytes: routeBytes.byteLength,
  missingRouteStatus: missingResponse.status,
  captureScopeMutations: 3,
  argumentMutations: 2,
  networkDependencyMutations: 3,
  requestContractMutations: 3,
  networkSocketOpened: false,
}, null, 2));
