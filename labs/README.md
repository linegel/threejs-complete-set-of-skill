# Native WebGPU lab registry

`demo-registry.json` is the generated completion inventory. Regenerate it with
`npm run labs:registry`; `npm run labs:check` rejects drift.

## Source manifest

Put `lab.manifest.json` in the canonical example directory. The migration
loader also accepts `lab-manifest.json`, but generated output always follows
[`schema/lab-manifest.schema.json`](schema/lab-manifest.schema.json).

Paths are repository-relative. `publishPath` is always
`/demos/<lab-id>/`. Leave `sourceHash` as `null` in source manifests; the root
builder hashes the complete canonical target directory plus every explicitly
declared source outside that directory. Generated registry and Pages metadata
record the actual roots as `sourceHashInputs`; ignored runtime output such as
`artifacts/` and `node_modules/` is excluded. Unknown scenarios, modes, tiers,
cameras, and seeds must throw.

Pages metadata separately records `publishedHashInputs` and a
`publishedBundleHash` over emitted route HTML plus the Vite asset tree. The
builder removes only route IDs recorded by the previous/current generated
index before rebuilding, so stale generated wrappers and chunks cannot survive
while unrelated historical URLs remain untouched.

Canonical packages share the exact root browser toolchain. They may omit local
`three`, `playwright`, and `vite` declarations, but any declaration must equal
the root versions exactly; ranged or drifting versions fail the matrix gate.

`accepted` is a claim, not a progress marker. A rendering lab can use it only
with an existing browser entry, local Three.js `0.185.1`, native-WebGPU proof,
reachable render or compute work, aligned readback, all declared tiers
accepted, a v2 bundle, and a validation command. Non-rendering planning suites
set `nonRenderingScenarioSuite: true` and prove their positive and negative
routes through deterministic browser and command-line fixtures.

Proxy, generated-asset, legacy, and contract-fixture records are permanently
secondary. They cannot satisfy primary coverage.

## Root commands

```text
npm run labs:registry
npm run labs:check
npm run labs:test
npm run labs:test:mutations
npm run labs:capture -- --lab <id> --profile correctness
npm run labs:capture -- --lab <id> --profile performance
npm run labs:capture:browser -- --lab <id> --profile correctness --output artifacts/visual-validation/<id>
npm run labs:validate -- --lab <id>
npm run labs:validate:quick
npm run labs:validate:full
npm run pages:build
npm run pages:validate-source-hashes
npm run pages:smoke
```

`labs:validate:full` intentionally fails until every skill and all five
integration flagships have accepted primary coverage. Required GPU timing that
is unavailable remains `INSUFFICIENT_EVIDENCE`; it is never serialized as zero
or promoted to a pass.

`labs:capture:browser` is the shared non-dispatching capture primitive used by
local lab adapters. It starts the root-pinned Vite/Playwright toolchain, rejects
unknown profiles, waits for the lab controller, proves native WebGPU through
runtime metrics, and writes PNGs only from aligned `PixelCapture` readback.
Adapters can pass `--hook <module>` to drive mechanism-specific modes and full
v2 artifact production; the default output is deliberately only a capture
session plus `final.design.png`, never a fabricated complete evidence bundle.
