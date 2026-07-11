# Native WebGPU Node GTAO lab

This folder now has an executable browser entry, fixed mechanism/tier routes,
a `LabController`, aligned render-target readback, runtime graph/resource
descriptions, and a renderer-independent `createGTAOStage(...)` factory. Its
manifest remains `incomplete` until an authorized native-WebGPU capture run
supplies fixed-view images and current-adapter timing.

The graph is deliberately explicit:

```text
single-sampled opaque input scene pass: HDR output + normal + depth (+ velocity)
  -> GTAONode at reduced resolution
  -> DenoiseNode materialized once through a full-screen R8 rtt target
  -> visibility sampled with screenUV
  -> second lit scene pass with builtinAOContext(visibility)
  -> optional TRAANode
```

The first pass retains an HDR color output because stock r185 `PassNode` owns
one. The AO-enabled final uses the second pass, so this is a two-scene-render
architecture. It must be rejected when the complete marginal cost does not fit.
The disabled graph switches to a separate unmodified full-scene baseline pass;
because inactive node dependencies are unreachable, disabled mode renders one
scene and executes no AO work. The stage currently owns all diagnostic and
TRAA graph resources eagerly, however. `describeResources()` therefore reports
both logical allocation and per-mode reachability, including the inactive bent
normal target, baseline/lit depth attachments, and TRAA history/resolve targets.
Physical residency and allocation padding remain measured evidence and are not
inferred from logical payload bytes.

The `bent-normal` view is an experimental screen-space directional-visibility
heuristic, not an accepted r185 bent-normal GTAO implementation. It never
modulates lighting, reports `INSUFFICIENT_EVIDENCE`, and stays diagnostic-only
until the one-wall direction and camera-rotation invariance gates are measured.

The scaffold uses standard, non-reversed depth. Installed r185 `GTAONode` and
`DenoiseNode` classify background with a standard-depth `depth >= 1` test and
do not expose a reversed-depth adapter. Transparent draws are excluded from
the AO input pass because `builtinAOContext()` also skips transparent receivers.

`DenoiseNode` is inline shader code, not a stored post pass. The example wraps
it in `rtt()` before material-context use; otherwise its taps would execute per
mesh fragment and its implicit `uv()` would follow mesh unwraps. The stored
visibility is sampled with `screenUV`.

`GTAONode.useTemporalFiltering` only rotates the sampling pattern. `TRAANode`
owns full-image history. r185 exposes no public history-reset method, so
`resetTemporalHistory()` replaces and disposes the TRAA node on a camera or
projection discontinuity.

Run:

```bash
npm --prefix threejs-ambient-contact-shading/examples/webgpu-node-gtao run check
npm --prefix threejs-ambient-contact-shading/examples/webgpu-node-gtao run validate
npm --prefix threejs-ambient-contact-shading/examples/webgpu-node-gtao run test:mutations
npm --prefix threejs-ambient-contact-shading/examples/webgpu-node-gtao run validate:quick
```

`capture` launches the canonical route and writes native render-target `.raw`
readbacks plus renderer, graph, stride, and resource metadata. It never uses a
page screenshot as WebGPU proof and labels the candidate
`INSUFFICIENT_EVIDENCE`; it does not manufacture the missing PNG, timestamp,
or lifecycle evidence. `validate:artifacts` rejects a missing or structurally
incomplete v2 bundle. `validate:full` additionally requires every claim verdict
to be `PASS`.

Negative static fixtures:

```bash
node threejs-ambient-contact-shading/examples/webgpu-node-gtao/validate.js --fixture broken-screen-coordinate-contract
node threejs-ambient-contact-shading/examples/webgpu-node-gtao/validate.js --fixture unsupported-reversed-depth
node threejs-ambient-contact-shading/examples/webgpu-node-gtao/validate.js --fixture temporal-missing-velocity
node threejs-ambient-contact-shading/examples/webgpu-node-gtao/validate.js --fixture temporal-invalid-cut-policy
```

Each negative fixture must exit nonzero.

## Runtime acceptance still required

- Compile the complete graph in r185 WebGPU; static regex checks do not compile
  `rtt(denoise(...))` or prove render-target format support.
- Change/remove mesh UV attributes while holding geometry/camera fixed; AO must
  remain identical.
- Prove sky visibility is one under standard depth.
- Compare opaque-only inputs against transparent surfaces.
- Capture raw/reconstructed AO on thin silhouettes and non-square projections.
- Prove hard direct light and emission are unchanged.
- Exercise moving geometry, camera cuts, resize, and DPR changes with TRAA.
- Record input scene, GTAO, reconstruction, second lit scene, TRAA resolve/copy,
  and disabled-bypass timings separately.
- Inventory actual target formats, sample counts, bytes, and thermal behavior.

The implementation and routes are present; the missing browser evidence is an
explicit acceptance blocker, not a passing or zero-cost result.
