import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { finalizeImmutableServedLedger } from "../../../scripts/lib/immutable-lab-server.mjs";
import { finalizePhysicalReviewRecord } from "../../../scripts/lib/physical-review-record.mjs";
import { canonicalSha256 } from "../../../scripts/lib/evidence-manifest-contract.mjs";
import {
  FROST_PHYSICAL_ROUTE_MATRIX,
  validateFrostPhysicalRouteMatrix,
} from "./physical-route-matrix.js";

const LAB_ID = "webgpu-touch-history-frost";
const REQUIRED_CHECKS = Object.freeze([
  "immutable-build",
  "route-ready",
  "native-webgpu",
  "mechanism-lock",
  "tier-control",
  "diagnostic-control",
  "metrics-collapsed",
  "canvas-review",
  "mode-review",
  "route-matrix",
]);
const REQUIRED_SERVED_PATHS = Object.freeze([
  "physical-review.html",
  "physical-route-matrix-review.html",
  "immutable-lab-build.json",
  ...FROST_PHYSICAL_ROUTE_MATRIX.map(({ staticPath }) => staticPath.slice(1)),
]);

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

export function joinFrostPhysicalReview(pendingRecord, routeMatrixRecord, servedLedger) {
  const pending = structuredClone(requireObject(pendingRecord, "pending Frost physical review"));
  const routeMatrix = structuredClone(requireObject(routeMatrixRecord, "pending Frost route-matrix review"));
  const served = requireObject(servedLedger, "finalized served ledger");
  if (pending.labId !== LAB_ID) throw new Error("physical review belongs to another lab");
  if (routeMatrix.labId !== LAB_ID
    || routeMatrix.recordKind !== "lab-physical-route-matrix-review-v1"
    || routeMatrix.profile !== "physical-route"
    || routeMatrix.automationSurface !== "codex-in-app-browser"
    || routeMatrix.publishable !== false
    || routeMatrix.verdict !== "PASS") {
    throw new Error("route-matrix review identity or verdict is invalid");
  }
  for (const field of ["sourceClosureHash", "buildRevision", "threeRevision"]) {
    if (routeMatrix[field] !== pending[field]) throw new Error(`route-matrix review ${field} drifted from manual review`);
  }
  if (routeMatrix.bundleHash !== pending.immutableBuild?.bundleHash) {
    throw new Error("route-matrix review bundle hash drifted from manual review");
  }
  const validatedRouteMatrix = validateFrostPhysicalRouteMatrix(routeMatrix.routes);
  if (pending.immutableBuild?.servedLedgerHash !== null) throw new Error("pending physical review already contains a served-ledger claim");
  const entries = Array.isArray(served.entries) ? served.entries : [];
  const requestErrors = entries.filter((entry) => entry.status !== 200
    || entry.responseKind !== "exact-prebuilt-byte"
    || entry.redirected !== false
    || entry.fallback !== false
    || entry.transformed !== false);
  if (requestErrors.length > 0) throw new Error("physical review served ledger contains failed, redirected, fallback, or transformed requests");
  const servedPaths = new Set(entries.map((entry) => entry.resolvedPath));
  for (const path of REQUIRED_SERVED_PATHS) {
    if (!servedPaths.has(path)) throw new Error(`physical review served ledger omits ${path}`);
  }
  pending.immutableBuild.servedLedgerHash = served.ledgerSha256;
  pending.routeMatrix = {
    recordKind: routeMatrix.recordKind,
    profile: routeMatrix.profile,
    automationSurface: routeMatrix.automationSurface,
    startedAt: routeMatrix.startedAt,
    finishedAt: routeMatrix.finishedAt,
    verdict: validatedRouteMatrix.verdict,
    routes: validatedRouteMatrix.observations,
  };
  pending.checks.push({
    id: "route-matrix",
    inputMethod: "public-controller-read",
    expected: "PASS",
    observed: validatedRouteMatrix.verdict,
    verdict: "PASS",
  });
  pending.errors.request = [];
  pending.limitations = pending.limitations
    .filter((entry) => entry !== "Pending offline served-byte ledger binding.")
    .concat("Raw physical review remains nonpublishable until the independent correctness and release joins pass.");
  const finalized = finalizePhysicalReviewRecord(pending, { requiredChecks: REQUIRED_CHECKS });
  return Object.freeze({
    ...finalized,
    serving: Object.freeze({
      status: "FINALIZED_EXACT_STATIC_BYTES",
      ledgerSha256: served.ledgerSha256,
      documentSha256: served.documentSha256,
      byteLength: served.byteLength,
      entryCount: entries.length,
      requiredPaths: REQUIRED_SERVED_PATHS,
    }),
  });
}

export async function finalizeFrostPhysicalReview({ pendingPath, routeMatrixPath, servedLedgerPath, outputDirectory }) {
  const pending = JSON.parse(await readFile(pendingPath, "utf8"));
  const routeMatrix = JSON.parse(await readFile(routeMatrixPath, "utf8"));
  const served = await finalizeImmutableServedLedger(servedLedgerPath);
  const finalized = joinFrostPhysicalReview(pending, routeMatrix, served);
  await mkdir(outputDirectory, { recursive: true });
  const ledgerDocument = {
    schemaVersion: 1,
    labId: LAB_ID,
    status: finalized.serving.status,
    ledgerSha256: served.ledgerSha256,
    documentSha256: served.documentSha256,
    byteLength: served.byteLength,
    entries: served.entries,
  };
  const recordPath = resolve(outputDirectory, "physical-review-record.json");
  const ledgerPath = resolve(outputDirectory, "served-byte-ledger.json");
  await writeFile(recordPath, `${JSON.stringify(finalized, null, 2)}\n`);
  await writeFile(ledgerPath, `${JSON.stringify(ledgerDocument, null, 2)}\n`);
  const reread = JSON.parse(await readFile(recordPath, "utf8"));
  if (reread.recordSha256 !== canonicalSha256(reread.record)) throw new Error("written Frost physical review record hash drifted");
  return Object.freeze({ recordPath, ledgerPath, finalized });
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const pendingPath = argument("--pending");
  const routeMatrixPath = argument("--route-matrix");
  const servedLedgerPath = argument("--served-ledger");
  const outputDirectory = resolve(argument("--output") ?? resolve(here, `../../../artifacts/visual-validation/${LAB_ID}/physical-route`));
  if (!pendingPath || !routeMatrixPath || !servedLedgerPath) {
    throw new Error("usage: node finalize-physical-review.mjs --pending <json> --route-matrix <json> --served-ledger <ndjson> [--output <dir>]");
  }
  const result = await finalizeFrostPhysicalReview({
    pendingPath: resolve(pendingPath),
    routeMatrixPath: resolve(routeMatrixPath),
    servedLedgerPath: resolve(servedLedgerPath),
    outputDirectory,
  });
  console.log(JSON.stringify({
    labId: LAB_ID,
    recordPath: result.recordPath,
    ledgerPath: result.ledgerPath,
    verdict: result.finalized.validation.valid ? "PASS" : "FAIL",
    publishable: result.finalized.record.publishable,
    recordSha256: result.finalized.recordSha256,
  }, null, 2));
}
