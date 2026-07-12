import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { encodeRgbaPng } from "../../../scripts/lib/png-rgba.mjs";
import {
  CORPUS_CAPTURE_TARGET_IDS,
  CORPUS_NATIVE_READBACK_PLAN,
  CORPUS_STANDARD_OUTPUT_PLAN,
  CORPUS_STANDARD_RASTER_CONTRACT,
} from "./capture-plan.js";
import {
  compactCorpusCorrectnessRows,
  corpusCorrectnessEvidenceUrl,
} from "./correctness-evidence-client.js";
import {
  CORPUS_CORRECTNESS_MAX_TAR_BYTES,
  parseCorpusCorrectnessTar,
  validateCorpusCorrectnessSegment,
} from "./correctness-evidence-bundle.js";
import { assertMeaningfulRgbaRaster } from "./png-raster.mjs";
import { decodeBinaryTargetMask } from "./mask-raster.mjs";
import {
  CORPUS_CAPTURE_BUILD_REVISION,
  CORPUS_CAPTURE_SOURCE_HASH,
  CORPUS_EXECUTABLE_SOURCE_CLOSURE_THREE_REVISION,
} from "./trusted-runtime-source-manifest.generated.js";

const here = dirname(fileURLToPath(import.meta.url));
const defaultOutput = resolve(here, "../../../artifacts/visual-validation/webgpu-object-sculptor-corpus/correctness-in-app-import");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseCorpusCorrectnessImportArguments(args) {
  const segments = [];
  let outputDir = defaultOutput;
  let prepare = false;
  let checkOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--prepare") prepare = true;
    else if (argument === "--check") checkOnly = true;
    else if (argument === "--segment") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--segment requires a TAR path");
      segments.push(resolve(value));
      index += 1;
    } else if (argument === "--output") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--output requires a directory path");
      outputDir = resolve(value);
      index += 1;
    } else throw new Error(`Unknown correctness import argument: ${argument}`);
  }
  if (prepare && (segments.length > 0 || checkOnly)) throw new Error("--prepare cannot be combined with import arguments");
  if (!prepare && segments.length !== 3) throw new Error("correctness import requires exactly three --segment TAR paths");
  if (new Set(segments).size !== segments.length) throw new Error("correctness import segment paths must be unique");
  return Object.freeze({ prepare, checkOnly, segments: Object.freeze(segments), outputDir });
}

function normalizeArtifactRelativePath(relativePath) {
  if (
    typeof relativePath !== "string"
    || !/^[a-z0-9][a-z0-9._/-]*$/.test(relativePath)
    || relativePath.startsWith("/")
    || relativePath.includes("\\")
    || relativePath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError(`unsafe correctness artifact path ${relativePath}`);
  }
  return relativePath;
}

function confinedArtifactPath(outputDir, relativePath) {
  normalizeArtifactRelativePath(relativePath);
  const path = resolve(outputDir, relativePath);
  const relation = relative(outputDir, path);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`)) throw new Error(`correctness artifact escaped output: ${relativePath}`);
  return path;
}

function ensureNonsymlinkDirectoryChain(path) {
  const absolute = resolve(path);
  const { root } = parse(absolute);
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`correctness output directory chain is not a real directory: ${current}`);
    } else mkdirSync(current);
  }
  return absolute;
}

export function createExclusiveArtifactWriter(outputDir) {
  const root = resolve(outputDir);
  if (existsSync(root)) throw new Error(`correctness output tree must be absent: ${root}`);
  ensureNonsymlinkDirectoryChain(dirname(root));
  mkdirSync(root);
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || realpathSync(root) !== root) {
    throw new Error(`correctness output root is not an exact nonsymlink directory: ${root}`);
  }
  return Object.freeze({
    root,
    write(relativePath, bytes) {
      const path = confinedArtifactPath(root, relativePath);
      const parent = dirname(path);
      ensureNonsymlinkDirectoryChain(parent);
      if (realpathSync(root) !== root || !realpathSync(parent).startsWith(`${root}${sep}`) && parent !== root) {
        throw new Error(`correctness artifact parent escaped or replaced its output root: ${relativePath}`);
      }
      writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
      return Object.freeze({ path: relativePath, byteLength: bytes.byteLength, sha256: sha256(bytes) });
    },
  });
}

export function readBoundedRegularFile(path, maxBytes = CORPUS_CORRECTNESS_MAX_TAR_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("bounded file limit must be a positive safe integer");
  const before = lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error(`correctness segment must be a nonsymlink regular file: ${path}`);
  if (before.size < 1024 || before.size > maxBytes) throw new RangeError(`correctness segment size is outside 1024..${maxBytes} bytes: ${path}`);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(path, flags);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error(`correctness segment changed identity before bounded read: ${path}`);
    }
    const bytes = readFileSync(descriptor);
    if (bytes.byteLength !== opened.size) throw new Error(`correctness segment changed size during bounded read: ${path}`);
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } finally {
    closeSync(descriptor);
  }
}

export function assertUniqueCorpusCorrectnessOutputPaths(paths) {
  const seen = new Set();
  for (const path of paths) {
    normalizeArtifactRelativePath(path);
    if (seen.has(path)) throw new Error(`correctness output path collision: ${path}`);
    seen.add(path);
  }
  return true;
}

function resampleNearestCenter(raster, width, height) {
  const output = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(raster.height - 1, Math.floor(((y + 0.5) * raster.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(raster.width - 1, Math.floor(((x + 0.5) * raster.width) / width));
      const sourceOffset = (sourceY * raster.width + sourceX) * 4;
      output.set(raster.rgba.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
    }
  }
  return output;
}

function composeStandardContactSheet(rasters, label) {
  const { width, height, panelCount, panelWidth, panelHeight } = CORPUS_STANDARD_RASTER_CONTRACT;
  if (rasters.length !== panelCount) throw new Error(`${label} requires exactly ${panelCount} native readbacks`);
  const rgba = new Uint8Array(width * height * 4);
  for (let ordinal = 0; ordinal < rasters.length; ordinal += 1) {
    const panel = resampleNearestCenter(rasters[ordinal], panelWidth, panelHeight);
    for (let row = 0; row < panelHeight; row += 1) {
      rgba.set(panel.subarray(row * panelWidth * 4, (row + 1) * panelWidth * 4), (row * width + ordinal * panelWidth) * 4);
    }
  }
  assertMeaningfulRgbaRaster({ width, height, rgba }, label);
  return Object.freeze({ width, height, rgba });
}

export async function importCorpusCorrectnessSegments({ segments, outputDir = defaultOutput, checkOnly = false } = {}) {
  if (!Array.isArray(segments) || segments.length !== 3) throw new Error("correctness import requires three segment paths");
  if (new Set(segments.map((path) => resolve(path))).size !== segments.length) throw new Error("correctness import segment paths must be unique");
  const parsed = [];
  for (const path of segments) {
    const tarBytes = readBoundedRegularFile(path);
    const segment = parseCorpusCorrectnessTar(tarBytes);
    const validation = await validateCorpusCorrectnessSegment(segment.documentRecord, segment.artifacts);
    parsed.push(Object.freeze({ sourceFilename: basename(path), tarBytes, tarSha256: sha256(tarBytes), ...segment, validation }));
  }
  const subjectIds = parsed.map(({ documentRecord }) => documentRecord.subjectId);
  if (JSON.stringify(subjectIds.sort()) !== JSON.stringify([...CORPUS_CAPTURE_TARGET_IDS].sort())) {
    throw new Error(`correctness import subjects must be exactly ${CORPUS_CAPTURE_TARGET_IDS.join(", ")}`);
  }
  const sourceHashes = new Set(parsed.map(({ documentRecord }) => documentRecord.sourceHash));
  const buildRevisions = new Set(parsed.map(({ documentRecord }) => documentRecord.buildRevision));
  if (sourceHashes.size !== 1 || buildRevisions.size !== 1) throw new Error("correctness segment source/build identities disagree");
  if ([...sourceHashes][0] !== CORPUS_CAPTURE_SOURCE_HASH || [...buildRevisions][0] !== CORPUS_CAPTURE_BUILD_REVISION) {
    throw new Error("correctness segment source/build identity is stale relative to the generated importer closure");
  }
  const records = new Map(parsed.flatMap(({ documentRecord, artifacts }) => documentRecord.captures.map((capture) => [capture.filename, { capture, artifacts }])));
  if (records.size !== CORPUS_NATIVE_READBACK_PLAN.length) throw new Error("correctness import did not produce exactly 63 unique capture filenames");
  const expectedNames = CORPUS_NATIVE_READBACK_PLAN.map(({ filename }) => filename);
  if (expectedNames.some((filename) => !records.has(filename))) throw new Error("correctness import capture plan closure drifted");

  const outputs = [];
  const rasterByFilename = new Map();
  const pendingArtifacts = new Map();
  const claimArtifact = (path, bytes) => {
    normalizeArtifactRelativePath(path);
    if (pendingArtifacts.has(path)) throw new Error(`correctness output path collision: ${path}`);
    pendingArtifacts.set(path, bytes);
    return Object.freeze({ path, byteLength: bytes.byteLength, sha256: sha256(bytes) });
  };

  for (const segment of parsed) {
    const stem = segment.documentRecord.subjectId;
    claimArtifact(`segments/${stem}.tar`, segment.tarBytes);
    claimArtifact(`segments/${stem}.correctness-evidence.json`, segment.documentBytes);
  }
  for (const plan of CORPUS_NATIVE_READBACK_PLAN) {
    const { capture, artifacts } = records.get(plan.filename);
    if (capture.kind !== plan.kind || JSON.stringify(capture.state) !== JSON.stringify(plan.state)) throw new Error(`${plan.filename} capture plan state drifted`);
    const normalized = artifacts.get(capture.normalized.path);
    const compact = compactCorpusCorrectnessRows(normalized, capture.width, capture.height, capture.normalized.bytesPerRow);
    const raster = Object.freeze({ width: capture.width, height: capture.height, rgba: compact });
    if (capture.kind === "target-mask") decodeBinaryTargetMask(raster, plan.filename);
    else assertMeaningfulRgbaRaster(raster, plan.filename);
    const png = encodeRgbaPng({ width: capture.width, height: capture.height, data: compact });
    const transport = artifacts.get(capture.transport.path);
    const pngArtifact = claimArtifact(plan.filename, png);
    const transportArtifact = claimArtifact(capture.transport.path, transport);
    const normalizedArtifact = claimArtifact(capture.normalized.path, normalized);
    if (plan.kind === "presentation") rasterByFilename.set(plan.filename, raster);
    outputs.push(Object.freeze({
      filename: plan.filename,
      kind: plan.kind,
      state: plan.state,
      png: pngArtifact,
      transport: transportArtifact,
      normalized: normalizedArtifact,
      compactSha256: capture.compact.sha256,
      sourceSegmentDigest: parsed.find(({ documentRecord }) => documentRecord.subjectId === plan.state.subjectId).documentRecord.digest,
    }));
  }

  const standardOutputs = [];
  for (const plan of CORPUS_STANDARD_OUTPUT_PLAN) {
    if (plan.status !== "CAPTURED") {
      standardOutputs.push(Object.freeze({ id: plan.id, status: plan.status, filename: null, reason: plan.reason }));
      continue;
    }
    const rasters = plan.sourceCaptures.map((filename) => {
      const raster = rasterByFilename.get(filename);
      if (!raster) throw new Error(`${plan.filename} source capture is unavailable: ${filename}`);
      return raster;
    });
    const contactSheet = composeStandardContactSheet(rasters, plan.id);
    const png = encodeRgbaPng({ width: contactSheet.width, height: contactSheet.height, data: contactSheet.rgba });
    standardOutputs.push(Object.freeze({
      id: plan.id,
      status: plan.status,
      filename: plan.filename,
      sourceCaptures: plan.sourceCaptures,
      derivation: "three-panel-native-readback-contact-sheet; nearest-center-rgba8-v1; no crop; no synthetic fill",
      file: claimArtifact(plan.filename, png),
      packedRgbaSha256: sha256(contactSheet.rgba),
    }));
  }
  const manifest = Object.freeze({
    schemaVersion: 1,
    labId: "webgpu-object-sculptor-corpus",
    profile: "correctness",
    automationSurface: "codex-in-app-browser",
    sourceHash: [...sourceHashes][0],
    buildRevision: [...buildRevisions][0],
    threeRevision: CORPUS_EXECUTABLE_SOURCE_CLOSURE_THREE_REVISION,
    segments: Object.freeze(parsed.map(({ sourceFilename, tarSha256, documentBytes, documentRecord, validation }) => Object.freeze({
      sourceFilename,
      retainedTar: `segments/${documentRecord.subjectId}.tar`,
      retainedDocument: `segments/${documentRecord.subjectId}.correctness-evidence.json`,
      tarSha256,
      documentSha256: sha256(documentBytes),
      subjectId: documentRecord.subjectId,
      digest: documentRecord.digest,
      validation,
    }))),
    captures: Object.freeze(outputs),
    standardOutputs: Object.freeze(standardOutputs),
  });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  claimArtifact("correctness-in-app-import.json", manifestBytes);
  assertUniqueCorpusCorrectnessOutputPaths([...pendingArtifacts.keys()]);
  if (!checkOnly) {
    const writer = createExclusiveArtifactWriter(outputDir);
    for (const [path, bytes] of pendingArtifacts) writer.write(path, bytes);
  }
  return Object.freeze({
    ok: true,
    checkOnly,
    outputDir,
    sourceHash: manifest.sourceHash,
    buildRevision: manifest.buildRevision,
    threeRevision: manifest.threeRevision,
    subjects: subjectIds,
    captures: outputs.length,
    standardOutputs: standardOutputs.filter(({ status }) => status === "CAPTURED").length,
    retainedSegments: parsed.length,
    manifestSha256: sha256(manifestBytes),
  });
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    const options = parseCorpusCorrectnessImportArguments(process.argv.slice(2));
    if (options.prepare) {
      console.log(JSON.stringify({
        ok: true,
        mode: "codex-in-app-browser-preparation",
        launchesBrowser: false,
        requiredBrowserSurface: "codex-in-app-browser",
        urls: CORPUS_CAPTURE_TARGET_IDS.map((subjectId) => corpusCorrectnessEvidenceUrl(subjectId)),
        next: "Open each URL in Codex's in-app Browser, wait for 21 / 21, save its TAR, then run capture:import with all three --segment paths.",
      }, null, 2));
    } else {
      console.log(JSON.stringify(await importCorpusCorrectnessSegments(options), null, 2));
    }
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
