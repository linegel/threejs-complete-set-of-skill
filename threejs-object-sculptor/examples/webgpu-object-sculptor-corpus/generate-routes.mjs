import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SCULPT_MODES, SCULPT_TIERS } from "../shared/sculpt-runtime.js";
import { SCULPT_TARGET_IDS } from "./object-catalog.js";
import { CORPUS_CAMERAS } from "./route-state.js";

const here = dirname(fileURLToPath(import.meta.url));

export const CORPUS_ROUTE_DIMENSIONS = Object.freeze([
  Object.freeze({ kind: "scenario", ids: SCULPT_TARGET_IDS }),
  Object.freeze({ kind: "mechanism", ids: SCULPT_MODES }),
  Object.freeze({ kind: "tier", ids: SCULPT_TIERS }),
  Object.freeze({ kind: "camera", ids: CORPUS_CAMERAS }),
]);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderCorpusRouteHtml(kind, id) {
  const subject = kind === "scenario" ? id : "potted-bonsai";
  const routeLabel = `${kind} / ${id}`.replaceAll("-", " ");
  return `<!doctype html>
<html lang="en" data-subject="${escapeHtml(subject)}" data-route-kind="${escapeHtml(kind)}" data-route-id="${escapeHtml(id)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#08100f" />
    <title>Object Sculptor Corpus · ${escapeHtml(routeLabel)}</title>
    <script src="../../route-evidence-bootstrap.js" data-surface="route"></script>
    <script type="importmap">
      {
        "imports": {
          "three": "/node_modules/three/build/three.module.js",
          "three/webgpu": "/node_modules/three/build/three.webgpu.js",
          "three/tsl": "/node_modules/three/build/three.tsl.js",
          "three/addons/": "/node_modules/three/examples/jsm/"
        }
      }
    </script>
    <link rel="stylesheet" href="../../styles.css" />
  </head>
  <body>
    <canvas id="scene" aria-label="Interactive native WebGPU inspection of generated procedural assets"></canvas>

    <header class="brand" aria-label="Corpus title">
      <span class="eyebrow">Object Sculptor / native WebGPU</span>
      <h1 id="subject-title">Potted Bonsai</h1>
      <p id="subject-description">A rooted botanical sculpture with closed branch rings, tiered opaque foliage, authored sway pivots, and a ceramic vessel.</p>
      <span class="corpus-index">01 / 03 · generated procedural asset</span>
    </header>

    <aside class="inspector" aria-label="Object Sculptor corpus controls">
      <header class="inspector-header">
        <div>
          <span class="panel-kicker">Live inspection</span>
          <h2>Corpus controls</h2>
        </div>
        <output id="status" data-state="initializing" aria-live="polite">Initializing WebGPU</output>
      </header>

      <div class="selects">
        <label>
          <span>Subject</span>
          <select id="subject" aria-label="Subject"></select>
        </label>
        <label>
          <span>Mode</span>
          <select id="mode" aria-label="Mode"></select>
        </label>
        <label>
          <span>Tier</span>
          <select id="tier" aria-label="Tier"></select>
        </label>
        <label>
          <span>Camera</span>
          <select id="camera" aria-label="Camera"></select>
        </label>
      </div>

      <section class="mode-copy" aria-live="polite">
        <strong id="mode-title">Action-ready motion</strong>
        <span id="mode-description">Named pivots move continuously while sockets and collider construction inputs remain inspectable.</span>
      </section>

      <dl class="metrics" aria-label="Live scene metrics">
        <div class="metric"><dt>Nodes</dt><dd id="metric-nodes">—</dd></div>
        <div class="metric"><dt>Triangles</dt><dd id="metric-triangles">—</dd></div>
        <div class="metric"><dt>Draws</dt><dd id="metric-draws">—</dd></div>
        <div class="metric"><dt>Submissions</dt><dd id="metric-submissions">—</dd></div>
        <div class="metric"><dt>Collider inputs</dt><dd id="metric-handoffs">—</dd></div>
        <div class="metric metric-wide"><dt>Physics handoff</dt><dd id="metric-physics-status">—</dd></div>
        <div class="metric"><dt>Motion</dt><dd id="metric-motion">—</dd></div>
        <div class="metric"><dt>Tier DPR</dt><dd id="metric-dpr">—</dd></div>
      </dl>

      <p class="claim-boundary">
        ColliderConstructionInput records are deterministic authoring handoffs. They are not solver-proven collision, contacts, mass properties, or rigid-body motion.
      </p>
    </aside>

    <div class="interaction-hint" aria-hidden="true">Drag to orbit · wheel or pinch to dolly · action-ready mode animates</div>
    <script type="module" src="../../app.js"></script>
  </body>
</html>
`;
}

export function generateCorpusRoutes({ outputDirectory = here, checkOnly = false } = {}) {
  const root = resolve(outputDirectory);
  const records = [];
  for (const { kind, ids } of CORPUS_ROUTE_DIMENSIONS) {
    for (const id of ids) {
      const directory = resolve(root, kind, id);
      const path = resolve(directory, "index.html");
      const source = renderCorpusRouteHtml(kind, id);
      const unchanged = existsSync(path) && readFileSync(path, "utf8") === source;
      if (!checkOnly) {
        mkdirSync(directory, { recursive: true });
        if (!unchanged) writeFileSync(path, source, "utf8");
      }
      records.push(Object.freeze({ kind, id, path, changed: !unchanged }));
    }
  }
  return Object.freeze(records);
}

export function parseCorpusRouteGeneratorArguments(args = []) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) {
    throw new TypeError("Corpus route generator arguments must be an array of strings");
  }
  const unknown = args.filter((value) => value !== "--check");
  if (unknown.length > 0) throw new RangeError(`Unknown corpus route generator argument: ${unknown.join(", ")}`);
  if (args.filter((value) => value === "--check").length > 1) {
    throw new RangeError("Corpus route generator --check may occur at most once");
  }
  return Object.freeze({ checkOnly: args.includes("--check") });
}

function isMainModule() {
  return Boolean(process.argv[1])
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    const { checkOnly } = parseCorpusRouteGeneratorArguments(process.argv.slice(2));
    const records = generateCorpusRoutes({ checkOnly });
    const changed = records.filter((record) => record.changed);
    if (checkOnly && changed.length > 0) {
      throw new Error(`Generated corpus routes are stale: ${changed.map(({ kind, id }) => `${kind}/${id}`).join(", ")}`);
    }
    console.log(JSON.stringify({
      ok: true,
      mode: checkOnly ? "check-only" : "generate",
      routes: records.length,
      changed: changed.length,
      staleRoutePolicy: "preserved-without-deletion",
    }, null, 2));
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
