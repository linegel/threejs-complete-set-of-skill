# Native WebGPU validation harness

This lab has one canonical evidence contract: the checked
`labs/schema/evidence-bundle-v2.schema.json` manifest plus its semantic and
byte-ledger reconciliation. Deterministic correctness capture runs through the
shared pinned Playwright runner. Physical-route inspection and hardware
performance capture run in Codex's in-app Browser from an immutable production
build.

The three capture lanes are deliberately separate:

- `correctness` (`playwright-headless-chromium`): native-WebGPU readbacks,
  fixed states, standard images and correctness diagnostics;
- `physical-route` (`codex-in-app-browser`): all 19 locked
  scenario/mechanism/tier routes, disposal and exact served-byte proof;
- `performance` (`codex-in-app-browser`): hardware-only cold, cadence,
  timestamp, sustained and governor populations.

Every raw lane remains `bundleKind: "raw-capture-session"` and
`publishable: false`. Offline promotion copies the finalized lane documents and
write ledgers into a separate `release-bundle`, reconciles source/build/Three,
route, browser, adapter, device, OS, refresh, color and limitation identities,
and binds an authored direct visual review. Capture never promotes itself.

Schema-v1 evidence remains readable only as explicitly nonpublishable migration
input. The former incompatible v2 browser-capture manifest is not dispatched by
the canonical validator.

## Commands

```bash
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run check
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run test:routes
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run test:physical
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run test:mutations
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run validate:v2
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run validate:full
```

To collect evidence:

```bash
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run capture
```

The command builds a unique sibling staging directory outside the repository,
launches the pinned Playwright Chromium correctness runner, performs native
render-target readback, and writes a nonpublishable correctness session under
`artifacts/visual-validation/webgpu-validation-harness/correctness/`.

To collect the physical-route or hardware-performance lanes, prepare and serve
the immutable build separately:

```bash
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run capture:physical
```

That command validates every staged byte, atomically renames it to its
content-addressed final directory, starts an exact-byte HTTP server, and prints
the runner URL and served-byte ledger. It does not launch a browser. Open the
printed `/src/in-app-evidence.html` URL using Codex's in-app Browser. The runner
rejects WebDriver/headless execution and offers independent physical-route and
hardware-performance buttons. Import each downloaded record with the served-byte
ledger and immutable build directory:

```bash
npm --prefix threejs-visual-validation/examples/webgpu-validation-harness run physical:import -- \
  --record /absolute/session.json \
  --ledger /absolute/served.ndjson \
  --build /absolute/sha256-build \
  --out /absolute/finalized-session.json
```

Keep imported raw records outside the repository until the offline release join
and direct visual review are complete.

## Immutable build and serving rules

- Source closure includes the lab, checked evidence/runtime-graph schemas,
  aligned-readback implementation, registry inputs and exact package locks.
- The content address binds source closure, registry build revision and Three
  revision.
- Build output is written to a unique sibling staging directory. The manifest
  and file ledger are validated there before one atomic directory rename.
- No destination is emptied or overwritten. A failed staging directory is
  retained for forensic inspection; no deletion is attempted.
- The server performs no transform, redirect, route fallback or SPA fallback.
  Every 200 response is hashed and appended to the served-byte ledger.

## Evidence contract

`validate:v2`, artifact validation and offline promotion all consume the same
checked schema and semantic contract. A release must contain:

- separate finalized correctness and physical-route sessions;
- a hardware timestamped performance session when performance or GPU
  attribution is `PASS`;
- the fourteen normative JSON artifacts;
- the ten standard image slots, each captured or structurally proved
  inapplicable;
- captured and hash-distinct final and diagnostic images;
- byte-accurate session-document, write-ledger, file and image references;
- recomputed route, limitation, claims, session-set, artifact, image, promotion
  and visual-review digests;
- approved review of every applicable standard image before publication.

Missing evidence is `INSUFFICIENT_EVIDENCE`. Contradictory, malformed, stale or
cross-bound evidence is `FAIL`. Software timing is diagnostic only, and Browser
cadence is never relabelled as GPU attribution or compositor presentation.

## Browser subject

The immutable subject initializes `WebGPURenderer`, requires the native WebGPU
backend, renders a real NodeMaterial scene through one RenderPipeline, and
exposes `window.__THREEJS_LAB__`. Fixed route wrappers live under
`mechanism/<id>/` and `tier/<id>/`; each wrapper rejects state drift.

Readbacks retain the actual integer WebGPU row stride, raw copy format, resource
format, origin, compact bytes, normalized padded bytes and hashes. Diagnostic
modes replace the actual output node and mark the graph dirty; they are not
labels over a final screenshot.
