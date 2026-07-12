import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CORPUS_IN_APP_ROUTE_PLAN,
  CORPUS_ROUTE_EVIDENCE_ORIGIN,
  CORPUS_ROUTE_IMMUTABLE_MANIFEST_PATH,
} from "./route-evidence-plan.js";
import {
  computeCorpusExecutableSourceClosure,
  validateCorpusExecutableSourceClosure,
} from "./generate-trusted-runtime-source-manifest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const serverSourcePath = "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/immutable-route-server.mjs";
const runnerPaths = Object.freeze([
  "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/in-app-evidence.html",
  "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/in-app-evidence.css",
  "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/in-app-evidence-runner.js",
]);
const bareImportTargets = Object.freeze({
  three: "node_modules/three/build/three.module.js",
  "three/webgpu": "node_modules/three/build/three.webgpu.js",
  "three/tsl": "node_modules/three/build/three.tsl.js",
});
const bareImportPrefixes = Object.freeze({
  "three/addons/": "node_modules/three/examples/jsm/",
});
const mimeByExtension = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function confinedRepositoryPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\\") || path.startsWith("/")) {
    throw new TypeError(`Immutable server path is not repository-relative: ${path}`);
  }
  const absolute = resolve(repositoryRoot, path);
  const relation = relative(repositoryRoot, absolute);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || resolve(repositoryRoot, relation) !== absolute) {
    throw new Error(`Immutable server path escaped the repository: ${path}`);
  }
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Immutable server source is not a regular file: ${path}`);
  const real = realpathSync(absolute);
  const realRelation = relative(realpathSync(repositoryRoot), real);
  if (realRelation === ".." || realRelation.startsWith(`..${sep}`)) {
    throw new Error(`Immutable server source resolves outside the repository: ${path}`);
  }
  return Object.freeze({ path: relation.split(sep).join("/"), absolute });
}

function resolveImportSpecifier(specifier, importerPath) {
  if (specifier.startsWith("node:")) return null;
  if (/^data:/i.test(specifier)) return null; // Inline bytes are not a network dependency.
  if (/^(?:https?:)?\/\//i.test(specifier)) {
    throw new Error(`Immutable browser source ${importerPath} references forbidden network dependency ${specifier}`);
  }
  if (/^blob:/i.test(specifier)) {
    throw new Error(`Immutable browser source ${importerPath} references unbound blob dependency ${specifier}`);
  }
  const exact = bareImportTargets[specifier];
  if (exact) return exact;
  for (const [prefix, target] of Object.entries(bareImportPrefixes)) {
    if (specifier.startsWith(prefix)) return `${target}${specifier.slice(prefix.length)}`;
  }
  if (specifier.startsWith("/")) return specifier.slice(1);
  if (specifier.startsWith(".")) {
    return relative(repositoryRoot, resolve(repositoryRoot, dirname(importerPath), specifier)).split(sep).join("/");
  }
  throw new Error(`Immutable server cannot resolve bare import "${specifier}" from ${importerPath}`);
}

function maskJavaScriptComments(source) {
  const output = [...source];
  let state = "code";
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (character === "\n" || character === "\r") state = "code";
      else output[index] = " ";
      continue;
    }
    if (state === "block-comment") {
      output[index] = character === "\n" || character === "\r" ? character : " ";
      if (character === "*" && next === "/") {
        output[index + 1] = " ";
        index += 1;
        state = "code";
      }
      continue;
    }
    if (state === "string") {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) {
        state = "code";
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      state = "string";
      quote = character;
    } else if (character === "/" && next === "/") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      output[index] = " ";
      output[index + 1] = " ";
      index += 1;
      state = "block-comment";
    }
  }
  return output.join("");
}

export function discoverImmutableBrowserDependencies(path, bytes) {
  const extension = extname(path);
  const rawSource = bytes.toString("utf8");
  const source = extension === ".js" || extension === ".mjs"
    ? maskJavaScriptComments(rawSource)
    : extension === ".html"
      ? rawSource.replace(/<!--[\s\S]*?-->/g, "")
      : extension === ".css"
        ? rawSource.replace(/\/\*[\s\S]*?\*\//g, "")
        : rawSource;
  const dependencies = new Set();
  if (extension === ".js" || extension === ".mjs") {
    const patterns = [
      /\b(?:import|export)\s+(?:[^"']*?\s+from\s*)?["']([^"']+)["']/g,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const dependency = resolveImportSpecifier(match[1], path);
        if (dependency) dependencies.add(dependency);
      }
    }
  } else if (extension === ".html") {
    for (const match of source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier.startsWith("#")) continue;
      const dependency = resolveImportSpecifier(specifier, path);
      if (dependency) dependencies.add(dependency);
    }
  } else if (extension === ".css") {
    for (const match of source.matchAll(/(?:@import\s+|url\(\s*)["']?([^"')\s]+)["']?\s*\)?/g)) {
      const specifier = match[1];
      if (specifier.startsWith("#")) continue;
      const dependency = resolveImportSpecifier(specifier, path);
      if (dependency) dependencies.add(dependency);
    }
  }
  return [...dependencies].sort();
}

function routeHtmlPaths() {
  return CORPUS_IN_APP_ROUTE_PLAN.map(({ urlPath }) => (
    `threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/${urlPath}index.html`
  ));
}

export function buildImmutableCorpusSnapshot() {
  const sourceClosure = computeCorpusExecutableSourceClosure();
  validateCorpusExecutableSourceClosure(sourceClosure);
  const expectedByPath = new Map(sourceClosure.files.map((entry) => [entry.repositoryPath, entry]));
  const pending = [
    ...[...expectedByPath.keys(), serverSourcePath].map((path) => ({ path, browser: false })),
    ...[...runnerPaths, ...routeHtmlPaths()].map((path) => ({ path, browser: true })),
  ];
  const resources = new Map();
  const executionPaths = new Set();
  const browserParsed = new Set();
  while (pending.length > 0) {
    const { path: requested, browser } = pending.shift();
    const { path, absolute } = confinedRepositoryPath(requested);
    let resource = resources.get(path);
    if (!resource) {
      const bytes = readFileSync(absolute);
      const digest = sha256(bytes);
      const expected = expectedByPath.get(path);
      if (expected && expected.sha256 !== digest) {
        throw new Error(`Canonical executable source closure drifted for immutable source ${path}`);
      }
      resource = {
        path,
        urlPath: `/${path}`,
        bytes,
        sha256: digest,
        byteLength: bytes.byteLength,
        mediaType: mimeByExtension[extname(path)] ?? "application/octet-stream",
        dependencies: [],
      };
      resources.set(path, resource);
    }
    if (browser) {
      executionPaths.add(path);
      if (!browserParsed.has(path)) {
        browserParsed.add(path);
        resource.dependencies = discoverImmutableBrowserDependencies(path, resource.bytes);
        for (const dependency of resource.dependencies) pending.push({ path: dependency, browser: true });
      }
    }
  }
  for (const [path, resource] of resources) resources.set(path, Object.freeze({ ...resource, dependencies: Object.freeze(resource.dependencies) }));
  const entries = Object.freeze([...resources.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((resource) => Object.freeze({
      path: resource.path,
      urlPath: resource.urlPath,
      sha256: resource.sha256,
      byteLength: resource.byteLength,
      mediaType: resource.mediaType,
      executionClass: executionPaths.has(resource.path) ? "browser-executable-closure" : "attested-source-input",
      dependencies: resource.dependencies,
    })));
  const closureSha256 = sha256(`object-sculptor-immutable-browser-closure-v1\n${canonicalJson(entries)}`);
  return Object.freeze({
    schemaVersion: 1,
    resources,
    entries,
    sourceClosure,
    closureSha256,
    snapshotId: `source-sha256:${closureSha256}`,
  });
}

function responseHeaders({ contentType, contentSha256, sourcePath, snapshotId, contentLength }) {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Length": String(contentLength),
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-SHA256": contentSha256,
    "X-Corpus-Immutable-Snapshot": snapshotId,
    "X-Corpus-Source-Path": sourcePath,
    "X-Corpus-Transform": "none",
    "X-Content-Type-Options": "nosniff",
  };
}

function immutableManifest(snapshot, origin) {
  return Object.freeze({
    schemaVersion: 1,
    server: "object-sculptor-immutable-static-server",
    origin,
    transformMode: "none",
    immutableSnapshot: true,
    spaFallback: false,
    viteClient: false,
    snapshotId: snapshot.snapshotId,
    closureSha256: snapshot.closureSha256,
    sourceClosure: snapshot.sourceClosure,
    entries: snapshot.entries,
  });
}

export async function startImmutableCorpusServer({ host = "127.0.0.1", port = 4174 } = {}) {
  if (typeof host !== "string" || host.length === 0) throw new TypeError("Immutable server host is required");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError("Immutable server port is invalid");
  const snapshot = buildImmutableCorpusSnapshot();
  let manifest = null;
  let manifestBytes = null;
  let manifestSha256 = null;
  const routeAliases = new Map(routeHtmlPaths().map((path) => [`/${dirname(path)}/`, path]));
  const server = createServer((request, response) => {
    try {
      if (!new Set(["GET", "HEAD"]).has(request.method)) {
        response.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
        response.end("Method not allowed\n");
        return;
      }
      const requestUrl = new URL(request.url, manifest.origin);
      let pathname;
      try {
        pathname = decodeURIComponent(requestUrl.pathname);
      } catch {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Malformed URL path\n");
        return;
      }
      if (pathname === CORPUS_ROUTE_IMMUTABLE_MANIFEST_PATH) {
        response.writeHead(200, responseHeaders({
          contentType: "application/json; charset=utf-8",
          contentSha256: manifestSha256,
          sourcePath: CORPUS_ROUTE_IMMUTABLE_MANIFEST_PATH,
          snapshotId: snapshot.snapshotId,
          contentLength: manifestBytes.byteLength,
        }));
        response.end(request.method === "HEAD" ? undefined : manifestBytes);
        return;
      }
      const sourcePath = routeAliases.get(pathname) ?? (pathname.startsWith("/") ? pathname.slice(1) : null);
      const resource = sourcePath ? snapshot.resources.get(sourcePath) : null;
      if (!resource) {
        const body = Buffer.from("Not found\n", "utf8");
        response.writeHead(404, {
          "Cache-Control": "no-store",
          "Content-Length": String(body.byteLength),
          "Content-Type": "text/plain; charset=utf-8",
          "X-Corpus-Immutable-Snapshot": snapshot.snapshotId,
          "X-Corpus-SPA-Fallback": "disabled",
        });
        response.end(request.method === "HEAD" ? undefined : body);
        return;
      }
      response.writeHead(200, responseHeaders({
        contentType: resource.mediaType,
        contentSha256: resource.sha256,
        sourcePath: resource.path,
        snapshotId: snapshot.snapshotId,
        contentLength: resource.byteLength,
      }));
      response.end(request.method === "HEAD" ? undefined : resource.bytes);
    } catch (error) {
      const body = Buffer.from(`Immutable server failure: ${error.message}\n`, "utf8");
      response.writeHead(500, { "Content-Length": String(body.byteLength), "Content-Type": "text/plain; charset=utf-8" });
      response.end(body);
    }
  });
  await new Promise((resolveStart, rejectStart) => {
    const onError = (error) => rejectStart(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.removeListener("error", onError);
      resolveStart();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Immutable server did not expose a TCP address");
  const origin = `http://${host}:${address.port}`;
  manifest = immutableManifest(snapshot, origin);
  manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  manifestSha256 = sha256(manifestBytes);
  let closed = false;
  return Object.freeze({
    origin,
    snapshot,
    manifest,
    manifestSha256,
    close: async () => {
      if (closed) return false;
      closed = true;
      await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
      return true;
    },
  });
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    const running = await startImmutableCorpusServer();
    if (running.origin !== CORPUS_ROUTE_EVIDENCE_ORIGIN) {
      throw new Error(`Immutable evidence origin drifted: ${running.origin}`);
    }
    console.log(JSON.stringify({
      ok: true,
      origin: running.origin,
      runnerUrl: `${running.origin}/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/in-app-evidence.html?capture=1`,
      immutableSnapshot: running.snapshot.snapshotId,
      entries: running.snapshot.entries.length,
      transformMode: "none",
      spaFallback: false,
    }, null, 2));
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
