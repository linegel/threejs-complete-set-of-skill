import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { startImmutableCorpusServer } from "./immutable-route-server.mjs";
import {
  CORPUS_IN_APP_ROUTE_PLAN,
  CORPUS_ROUTE_IMMUTABLE_MANIFEST_PATH,
} from "./route-evidence-plan.js";
import {
  CORPUS_CAPTURE_TARGET_IDS,
} from "./capture-plan.js";
import { corpusCorrectnessEvidenceUrl } from "./correctness-evidence-client.js";

export const CAPTURE_POLICY = "codex-in-app-browser-immutable-evidence";
export const CAPTURE_BUILD_CLASS = "immutable-physical-build";

export function parseCaptureArguments(args) {
  let profile = "correctness";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--profile") throw new Error(`Unknown Object Sculptor capture argument: ${argument}`);
    const value = args[index + 1];
    if (!new Set(["correctness", "performance"]).has(value)) throw new Error("--profile must be correctness or performance");
    profile = value;
    index += 1;
  }
  return Object.freeze({ profile });
}

export async function prepareCodexInAppCapture({ profile = "correctness" } = {}) {
  if (!new Set(["correctness", "performance"]).has(profile)) throw new Error("capture profile is invalid");
  const running = await startImmutableCorpusServer({ host: "127.0.0.1", port: 4174 });
  const runnerPath = "/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/in-app-evidence.html?capture=1";
  const runnerUrl = `${running.origin}${runnerPath}`;
  const ledgerPath = CORPUS_ROUTE_IMMUTABLE_MANIFEST_PATH;
  return Object.freeze({
    running,
    instructions: Object.freeze({
      ok: true,
      profile,
      capturePolicy: CAPTURE_POLICY,
      buildClass: CAPTURE_BUILD_CLASS,
      launchesExternalBrowser: false,
      requiredBrowserSurface: "codex-in-app-browser",
      runnerUrl,
      correctnessUrls: CORPUS_CAPTURE_TARGET_IDS.map((subjectId) => corpusCorrectnessEvidenceUrl(subjectId, `${running.origin}/threejs-object-sculptor/examples/webgpu-object-sculptor-corpus/index.html`)),
      physicalRoutes: CORPUS_IN_APP_ROUTE_PLAN.length,
      ledgerPath,
      immutableSnapshot: running.snapshot.snapshotId,
      servedByteEvidence: "Every response is bound by the immutable served-byte ledger and X-Content-SHA256 header.",
      next: profile === "correctness"
        ? "Open the runner URL in Codex's in-app Browser for the 15-route matrix, then open and save each of the three correctness segment URLs. Import all three TARs with capture:import."
        : "Open the runner URL in Codex's in-app Browser. Route timing remains diagnostic unless timestamp-query and named-device sustained evidence are separately assembled.",
    }),
  });
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    const options = parseCaptureArguments(process.argv.slice(2));
    const { running, instructions } = await prepareCodexInAppCapture(options);
    console.log(JSON.stringify(instructions, null, 2));
    await new Promise((resolveStop) => {
      let stopping = false;
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        await running.close();
        resolveStop();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
