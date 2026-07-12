import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CORPUS_PHYSICAL_ROUTE_PLAN,
  buildTrustedCorpusRuntimeSourceManifest,
  computeCorpusTrustedRuntimeSourceManifestHash,
} from "./validate-routes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const outputPath = resolve(here, "trusted-runtime-source-manifest.generated.js");
const closureAlgorithm = "object-sculptor-executable-source-closure-v1";
const expectedThreeRevision = "0.185.1";
const corpusBase = "threejs-object-sculptor/examples/webgpu-object-sculptor-corpus";
const CORPUS_DERIVED_RUNTIME_OUTPUTS = Object.freeze([
  Object.freeze({
    repositoryPath: `${corpusBase}/trusted-runtime-source-manifest.generated.js`,
    owner: `${corpusBase}/generate-trusted-runtime-source-manifest.mjs`,
    reason: "self-attestation output is validated against its generator and served-byte route digest instead of recursively hashing itself",
  }),
]);

export const CORPUS_EXECUTABLE_SOURCE_ROOTS = Object.freeze([
  `${corpusBase}/in-app-evidence.html`,
  `${corpusBase}/immutable-route-server.mjs`,
  ...CORPUS_PHYSICAL_ROUTE_PLAN.map(({ urlPath }) => `${corpusBase}/${urlPath}index.html`),
]);

const CORPUS_DECLARED_RUNTIME_INPUTS = Object.freeze([
  "package.json",
  "package-lock.json",
  `${corpusBase}/corpus.contract.json`,
  `${corpusBase}/targets/articulated-desk-lamp/object-sculpt-spec.json`,
  `${corpusBase}/targets/potted-bonsai/object-sculpt-spec.json`,
  `${corpusBase}/targets/ceramic-teapot/object-sculpt-spec.json`,
]);

const SOURCE_EXTENSIONS = Object.freeze([".js", ".mjs", ".json", ".css", ".html"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function toRepositoryPath(absolutePath, root = repositoryRoot) {
  const result = relative(root, absolutePath).split(sep).join("/");
  if (result === "" || result === ".." || result.startsWith("../") || isAbsolute(result)) {
    throw new Error(`executable source escaped the repository: ${absolutePath}`);
  }
  return result;
}

function regularRepositoryFile(repositoryPath, root = repositoryRoot) {
  if (
    typeof repositoryPath !== "string"
    || repositoryPath.length === 0
    || repositoryPath.includes("\\")
    || repositoryPath.includes("\0")
    || isAbsolute(repositoryPath)
    || posix.normalize(repositoryPath) !== repositoryPath
    || repositoryPath === "."
    || repositoryPath === ".."
    || repositoryPath.startsWith("../")
  ) {
    throw new Error(`invalid executable source path: ${repositoryPath}`);
  }
  const absolutePath = resolve(root, repositoryPath);
  const stat = lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`executable source is not a regular file: ${repositoryPath}`);
  }
  const rootRealPath = realpathSync(root);
  const fileRealPath = realpathSync(absolutePath);
  const realRelative = relative(rootRealPath, fileRealPath);
  if (realRelative === ".." || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) {
    throw new Error(`executable source resolved outside the repository: ${repositoryPath}`);
  }
  return absolutePath;
}

function stripSpecifierSuffix(specifier) {
  return specifier.split(/[?#]/, 1)[0];
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/", 1)[0];
}

function isBarePackageSpecifier(specifier) {
  return /^(?:@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+)(?:\/[a-z0-9._/-]+)*$/i.test(specifier);
}

function resolveLocalSource(importerPath, specifier, root = repositoryRoot) {
  const cleanSpecifier = stripSpecifierSuffix(specifier);
  if (!cleanSpecifier.startsWith(".") && !cleanSpecifier.startsWith("/")) return null;
  const importerAbsolute = resolve(root, importerPath);
  const base = cleanSpecifier.startsWith("/")
    ? resolve(root, cleanSpecifier.slice(1))
    : resolve(dirname(importerAbsolute), cleanSpecifier);
  const candidates = extname(base)
    ? [base]
    : [base, ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`), ...SOURCE_EXTENSIONS.map((extension) => resolve(base, `index${extension}`))];
  const absolutePath = candidates.find((candidate) => existsSync(candidate));
  if (!absolutePath) throw new Error(`${importerPath} references missing local source ${specifier}`);
  const repositoryPath = toRepositoryPath(absolutePath, root);
  regularRepositoryFile(repositoryPath, root);
  return repositoryPath;
}

export function extractCorpusExecutableSourceReferences(repositoryPath, source) {
  const extension = extname(repositoryPath).toLowerCase();
  const references = [];
  const add = (specifier) => {
    if (typeof specifier !== "string" || specifier.length === 0) return;
    if (specifier.startsWith("//") || (/^[a-z][a-z0-9+.-]*:/i.test(specifier) && !specifier.startsWith("node:"))) {
      throw new Error(`${repositoryPath} contains forbidden external executable reference ${specifier}`);
    }
    if (!references.includes(specifier)) references.push(specifier);
  };
  if (extension === ".js" || extension === ".mjs") {
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?["']([^"']+)["']/g)) add(match[1]);
    for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) add(match[1]);
    for (const match of source.matchAll(/\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) add(match[1]);
  } else if (extension === ".html") {
    for (const match of source.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) add(match[1]);
    for (const match of source.matchAll(/<link\b(?=[^>]*\brel\s*=\s*["']stylesheet["'])[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) add(match[1]);
  } else if (extension === ".css") {
    for (const match of source.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?/gi)) add(match[1]);
    for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(match[1]);
  }
  return Object.freeze(references);
}

function exactDependencyVersion(packageLock, name) {
  const version = packageLock?.packages?.[`node_modules/${name}`]?.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`package-lock.json has no exact installed version for ${name}`);
  }
  return version;
}

function validateThreeRevision(rootPackage, packageLock) {
  const declared = rootPackage?.dependencies?.three ?? rootPackage?.devDependencies?.three ?? null;
  const locked = exactDependencyVersion(packageLock, "three");
  if (declared !== expectedThreeRevision || locked !== expectedThreeRevision) {
    throw new Error(`Three revision drifted: expected ${expectedThreeRevision}, package=${declared}, lock=${locked}`);
  }
  return expectedThreeRevision;
}

export function computeCorpusExecutableSourceClosure({
  root = repositoryRoot,
  roots = CORPUS_EXECUTABLE_SOURCE_ROOTS,
  declaredInputs = CORPUS_DECLARED_RUNTIME_INPUTS,
} = {}) {
  const queue = [...new Set([...roots, ...declaredInputs])];
  const derivedOutputPaths = new Set(CORPUS_DERIVED_RUNTIME_OUTPUTS.map(({ repositoryPath }) => repositoryPath));
  const discovered = new Map();
  const externalSpecifiers = new Set();
  while (queue.length > 0) {
    const repositoryPath = queue.shift();
    if (discovered.has(repositoryPath)) continue;
    const absolutePath = regularRepositoryFile(repositoryPath, root);
    const bytes = readFileSync(absolutePath);
    discovered.set(repositoryPath, Object.freeze({
      repositoryPath,
      sha256: sha256Hex(bytes),
    }));
    const source = bytes.toString("utf8");
    for (const specifier of extractCorpusExecutableSourceReferences(repositoryPath, source)) {
      if (specifier.startsWith("node:")) continue;
      const local = resolveLocalSource(repositoryPath, specifier, root);
      if (local) {
        if (!derivedOutputPaths.has(local)) queue.push(local);
      } else if (isBarePackageSpecifier(specifier)) {
        externalSpecifiers.add(specifier);
      }
    }
  }

  const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  const threeRevision = validateThreeRevision(rootPackage, packageLock);
  const packages = new Map();
  for (const specifier of [...externalSpecifiers].sort()) {
    const name = packageNameFromSpecifier(specifier);
    if (!packages.has(name)) packages.set(name, []);
    packages.get(name).push(specifier);
  }
  const externalPackages = [...packages.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, specifiers]) => Object.freeze({
    name,
    version: exactDependencyVersion(packageLock, name),
    specifiers: Object.freeze([...new Set(specifiers)].sort()),
  }));
  const files = [...discovered.values()].sort((left, right) => left.repositoryPath.localeCompare(right.repositoryPath));
  const hashPayload = Object.freeze({
    algorithm: closureAlgorithm,
    roots: Object.freeze([...roots]),
    files: Object.freeze(files),
    derivedOutputs: CORPUS_DERIVED_RUNTIME_OUTPUTS,
    externalPackages: Object.freeze(externalPackages),
    threeRevision,
  });
  const sourceHash = sha256Hex(Buffer.from(canonicalJson(hashPayload)));
  return Object.freeze({
    ...hashPayload,
    sourceHash,
    buildRevision: `source-sha256:${sourceHash}`,
  });
}

export function validateCorpusExecutableSourceClosure(candidate, expected = computeCorpusExecutableSourceClosure()) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new TypeError("source closure must be an object");
  if (candidate.algorithm !== closureAlgorithm) throw new Error("source closure algorithm mismatch");
  if (candidate.threeRevision !== expectedThreeRevision) throw new Error("source closure Three revision mismatch");
  if (!SHA256_PATTERN.test(candidate.sourceHash ?? "")) throw new Error("source closure sourceHash must be lowercase SHA-256");
  if (candidate.buildRevision !== `source-sha256:${candidate.sourceHash}`) throw new Error("source closure buildRevision mismatch");
  if (canonicalJson(candidate) !== canonicalJson(expected)) {
    const expectedPaths = new Set(expected.files.map(({ repositoryPath }) => repositoryPath));
    const actualPaths = new Set(Array.isArray(candidate.files) ? candidate.files.map(({ repositoryPath }) => repositoryPath) : []);
    const missing = [...expectedPaths].filter((path) => !actualPaths.has(path));
    if (missing.length > 0) throw new Error(`source closure omitted transitive dependencies: ${missing.join(", ")}`);
    throw new Error("source closure does not match canonical transitive executable inputs");
  }
  return true;
}

export async function generateTrustedRuntimeSourceManifest({ checkOnly = false } = {}) {
  const trustedRuntimeSourceManifest = buildTrustedCorpusRuntimeSourceManifest();
  const trustedRuntimeSourceManifestSha256 = computeCorpusTrustedRuntimeSourceManifestHash(trustedRuntimeSourceManifest);
  const routeHtmlSha256ByRouteId = Object.fromEntries(CORPUS_PHYSICAL_ROUTE_PLAN.map((route) => [
    route.routeId,
    sha256Hex(readFileSync(resolve(here, route.urlPath, "index.html"))),
  ]));
  const sourceClosure = computeCorpusExecutableSourceClosure();
  const source = `// Generated by generate-trusted-runtime-source-manifest.mjs. Do not edit by hand.\n`
    + `const deepFreezeGenerated = (value) => { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreezeGenerated(child); Object.freeze(value); } return value; };\n`
    + `export const CORPUS_TRUSTED_RUNTIME_SOURCE_MANIFEST = Object.freeze(${JSON.stringify(trustedRuntimeSourceManifest, null, 2)}.map((entry) => Object.freeze(entry)));\n`
    + `export const CORPUS_TRUSTED_RUNTIME_SOURCE_MANIFEST_SHA256 = ${JSON.stringify(trustedRuntimeSourceManifestSha256)};\n`
    + `export const CORPUS_TRUSTED_ROUTE_HTML_SHA256_BY_ROUTE_ID = Object.freeze(${JSON.stringify(routeHtmlSha256ByRouteId, null, 2)});\n`
    + `export const CORPUS_EXECUTABLE_SOURCE_CLOSURE = deepFreezeGenerated(${JSON.stringify(sourceClosure, null, 2)});\n`
    + `export const CORPUS_EXECUTABLE_SOURCE_CLOSURE_SHA256 = ${JSON.stringify(sourceClosure.sourceHash)};\n`
    + `export const CORPUS_EXECUTABLE_SOURCE_CLOSURE_THREE_REVISION = ${JSON.stringify(sourceClosure.threeRevision)};\n`
    + `export const CORPUS_EXECUTABLE_SOURCE_THREE_REVISION = CORPUS_EXECUTABLE_SOURCE_CLOSURE_THREE_REVISION;\n`
    + `export const CORPUS_CAPTURE_SOURCE_HASH = ${JSON.stringify(sourceClosure.sourceHash)};\n`
    + `export const CORPUS_CAPTURE_BUILD_REVISION = ${JSON.stringify(sourceClosure.buildRevision)};\n`;
  let previous = null;
  try {
    previous = readFileSync(outputPath, "utf8");
  } catch {
    // The first generation owns creation of the output module.
  }
  if (checkOnly && previous !== source) {
    throw new Error("trusted runtime/source manifest is stale; run the generator without --check");
  }
  if (!checkOnly && previous !== source) writeFileSync(outputPath, source, "utf8");
  const generatedModuleBytes = readFileSync(outputPath);
  if (generatedModuleBytes.toString("utf8") !== source) {
    throw new Error("generated trusted runtime/source module bytes do not match the computed source");
  }
  const generatedModuleSha256 = sha256Hex(generatedModuleBytes);
  return Object.freeze({
    ok: true,
    changed: !checkOnly && previous !== source,
    checkOnly,
    outputPath,
    trustedSources: trustedRuntimeSourceManifest.length,
    executableSources: sourceClosure.files.length,
    physicalRoutes: CORPUS_PHYSICAL_ROUTE_PLAN.length,
    generatedModuleSha256,
    trustedRuntimeSourceManifestSha256,
    captureSourceHash: sourceClosure.sourceHash,
    threeRevision: sourceClosure.threeRevision,
  });
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    const args = process.argv.slice(2);
    if (args.some((argument) => argument !== "--check")) {
      throw new Error(`unknown generator option: ${args.find((argument) => argument !== "--check")}`);
    }
    console.log(JSON.stringify(await generateTrustedRuntimeSourceManifest({ checkOnly: args.includes("--check") }), null, 2));
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
