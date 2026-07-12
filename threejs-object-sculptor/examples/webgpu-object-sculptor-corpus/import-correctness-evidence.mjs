import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { encodeRgbaPng } from "../../../scripts/lib/png-rgba.mjs";
import {
  CORPUS_CAPTURE_TARGET_IDS,
  CORPUS_NATIVE_READBACK_PLAN,
} from "./capture-plan.js";
import {
  compactCorpusCorrectnessRows,
  corpusCorrectnessEvidenceUrl,
} from "./correctness-evidence-client.js";
import {
  parseCorpusCorrectnessTar,
  validateCorpusCorrectnessSegment,
} from "./correctness-evidence-bundle.js";
import { assertMeaningfulRgbaRaster } from "./png-raster.mjs";
import { decodeBinaryTargetMask } from "./mask-raster.mjs";

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

function confinedArtifactPath(outputDir, relativePath) {
  if (typeof relativePath !== "string" || relativePath.startsWith("/") || relativePath.includes("..") || relativePath.includes("\\")) {
    throw new TypeError(`unsafe correctness artifact path ${relativePath}`);
  }
  const path = resolve(outputDir, relativePath);
  if (path !== outputDir && !path.startsWith(`${outputDir}/`)) throw new Error(`correctness artifact escaped output: ${relativePath}`);
  return path;
}

function writeArtifact(outputDir, relativePath, bytes) {
  const path = confinedArtifactPath(outputDir, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return Object.freeze({ path: relativePath, byteLength: bytes.byteLength, sha256: sha256(bytes) });
}

export async function importCorpusCorrectnessSegments({ segments, outputDir = defaultOutput, checkOnly = false } = {}) {
  if (!Array.isArray(segments) || segments.length !== 3) throw new Error("correctness import requires three segment paths");
  const parsed = [];
  for (const path of segments) {
    const tarBytes = new Uint8Array(readFileSync(path));
    const segment = parseCorpusCorrectnessTar(tarBytes);
    const validation = await validateCorpusCorrectnessSegment(segment.documentRecord, segment.artifacts);
    parsed.push(Object.freeze({ path, tarSha256: sha256(tarBytes), ...segment, validation }));
  }
  const subjectIds = parsed.map(({ documentRecord }) => documentRecord.subjectId);
  if (JSON.stringify(subjectIds.sort()) !== JSON.stringify([...CORPUS_CAPTURE_TARGET_IDS].sort())) {
    throw new Error(`correctness import subjects must be exactly ${CORPUS_CAPTURE_TARGET_IDS.join(", ")}`);
  }
  const sourceHashes = new Set(parsed.map(({ documentRecord }) => documentRecord.sourceHash));
  const buildRevisions = new Set(parsed.map(({ documentRecord }) => documentRecord.buildRevision));
  if (sourceHashes.size !== 1 || buildRevisions.size !== 1) throw new Error("correctness segment source/build identities disagree");
  const records = new Map(parsed.flatMap(({ documentRecord, artifacts }) => documentRecord.captures.map((capture) => [capture.filename, { capture, artifacts }])));
  if (records.size !== CORPUS_NATIVE_READBACK_PLAN.length) throw new Error("correctness import did not produce exactly 63 unique capture filenames");
  const expectedNames = CORPUS_NATIVE_READBACK_PLAN.map(({ filename }) => filename);
  if (expectedNames.some((filename) => !records.has(filename))) throw new Error("correctness import capture plan closure drifted");

  const outputs = [];
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
    const pngArtifact = Object.freeze({ path: plan.filename, byteLength: png.byteLength, sha256: sha256(png) });
    const transportArtifact = Object.freeze({ path: capture.transport.path, byteLength: transport.byteLength, sha256: sha256(transport) });
    const normalizedArtifact = Object.freeze({ path: capture.normalized.path, byteLength: normalized.byteLength, sha256: sha256(normalized) });
    if (!checkOnly) {
      writeArtifact(outputDir, pngArtifact.path, png);
      writeArtifact(outputDir, transportArtifact.path, transport);
      writeArtifact(outputDir, normalizedArtifact.path, normalized);
    }
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
  const manifest = Object.freeze({
    schemaVersion: 1,
    labId: "webgpu-object-sculptor-corpus",
    profile: "correctness",
    automationSurface: "codex-in-app-browser",
    sourceHash: [...sourceHashes][0],
    buildRevision: [...buildRevisions][0],
    segments: Object.freeze(parsed.map(({ path, tarSha256, documentRecord, validation }) => Object.freeze({ path, tarSha256, subjectId: documentRecord.subjectId, digest: documentRecord.digest, validation }))),
    captures: Object.freeze(outputs),
  });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (!checkOnly) writeArtifact(outputDir, "correctness-in-app-import.json", manifestBytes);
  return Object.freeze({ ok: true, checkOnly, outputDir, sourceHash: manifest.sourceHash, subjects: subjectIds, captures: outputs.length, manifestSha256: sha256(manifestBytes) });
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
