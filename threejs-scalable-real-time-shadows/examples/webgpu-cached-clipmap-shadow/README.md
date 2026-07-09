# WebGPU Cached Clipmap Shadow

This directory now contains two deliberately separate subjects:

- `canonical.html` + `cached-clipmap-shadow-node-v2.js` are the receiver-backed
  native-WebGPU implementation. The light owns one composite
  `ShadowBaseNode`; each level is a real child r185 `ShadowNode`, selected
  children update sequentially through `ShadowNode.updateShadow()`, and the
  receiver keeps every committed child node statically reachable before
  applying fine-to-coarse containment weights. Each stock r185 child still
  frustum-gates its own comparison work; this is not an eager-L-sample claim.
- `browser.html` + `clipmap-shadow-node.js` retain the earlier Phase-1
  scheduler/resource scaffold as a contract fixture. They are not canonical
  receiver proof.

The v2 runtime is implemented but remains `incomplete`: candidate native-WebGPU
render-target/depth capture is available through `npm run capture`, while the
full current-adapter numeric ROI, timing, and lifecycle evidence required for
acceptance has not been promoted. Static tests must not promote that missing
evidence to a pass.

The architecture still keeps built-ins first and uses the custom cached
clipmap only for large scenes with measured persistent coarse-shadow reuse.

Run the implementation/contract checks:

```bash
npm run check
npm run validate:v2
```

Run a real candidate render-target capture and its structural validator:

```bash
npm run capture -- --profile correctness --output /tmp/webgpu-cached-clipmap-shadow
npm run validate:artifacts -- --output /tmp/webgpu-cached-clipmap-shadow
```

`validate:full` intentionally remains nonzero until the complete v2 image,
numeric ROI, timestamp, lifecycle, and leak-loop claims are present and pass.

Locked route state is declared in `routes.js` for all architecture,
mechanism, and `ultra`/`high`/`reduced` tier pages. Unknown mechanisms or tiers
throw instead of falling back silently.

## Retained Phase-1 contract fixture

Phase 1 validates CPU scheduling, controlled-fixture per-level target
render-command issuance,
committed state, nominal color-plus-depth target-byte estimation, actual dispose
method calls for the target (including its attached depth resource) and fixture
geometry/material, and caster-position parity. It does not prove backend memory
balance without a real-renderer dispose/recreate loop.
It is not yet a production receiver
implementation: the manually rendered level targets are not sampled by a
visible receiver material, and builder-enabled setup fails fast. Promotion
requires a real per-level TSL sampling/blend graph, r185 shadow-pass state and
caster filtering, and a lit receiver capture.

`createCachedClipmapShadowSystem()` leaves the incomplete node detached by
default. The CPU fixture can schedule its controlled target renders directly;
only the validator opts into `attachPhase1Scaffold: true` to exercise explicit
attachment/detachment lifecycle. Do not attach the scaffold to a production
light.

## Build Checkpoints

1. Architecture decision: compare one `DirectionalLightShadow`, `CSMShadowNode`,
   `TileShadowNode`, and the custom cached clipmap on the same seeded scene.
   Expected debug: selected built-in path, Phase-1 custom-candidate status, and
   explicit measurement-evidence fields. Missing measurements remain null and
   cannot select the custom path.
2. Promotion requirement: derive and commit one directional light-space basis
   epoch with each map. Phase 1 accepts caller-supplied basis inputs but does not
   prove basis/matrix parity in a receiver graph.
3. Level state: create half-widths, map sizes, sampled half-widths, staggered
   ages, committed invalid sentinels, and texture/memory budgets.
4. Snapping: snap X/Y by each level's world texel width relative to one stable
   light-space anchor. Phase 1 carries the supplied Z unchanged and uses an
   explicitly Authored fixture depth interval. Production code must replace
   that interval with conservative biased-receiver/relevant-occluder light-ray
   depth fitting plus guarded hysteresis;
   Z is not part of the projected texel grid. Expected debug: the XY texel grid
   remains fixed during `slowPan`.
5. Phase-1 render commit: bind the selected level's `DepthTexture` render
   target, configure an orthographic fixture camera, draw the controlled caster
   scene, then publish its center. Production promotion must additionally fit
   and commit conservative depth intervals, light basis, shadow matrices, and
   content epochs atomically.
6. Promotion requirement, not a Phase-1 proof: implement `setupShadowFilter`
   so a real material graph samples every committed level in uniform control
   flow and applies containment weights afterward. The current validator checks
   only a CPU sampling plan.
7. Invalidation: `invalidateSphere` marks only levels touched in light-space XY
   and forced invalidation bypasses the ordinary cached budget.
8. Promotion requirement, not a Phase-1 proof: wire per-level `normalBias`,
   comparison bias/filter state, and world filter support into the real receiver
   graph. Phase 1 only computes a diagnostic bias plan.
9. Caster parity: the displaced example caster assigns one shared local-space
   node object to `positionNode` and `castShadowPositionNode`.
   `receivedShadowPositionNode` remains null so r185 derives the receiver lookup
   from world-space `positionWorld`.
10. Phase-1 dispose checkpoint: when the validator explicitly attaches the
    custom node, detach it and dispose the level render targets/depth textures
    actually created by the scaffold. Cloned
    shadows, child lights, storage, and debug textures are production-promotion
    resources and are not falsely counted before they exist.

Run:

```bash
node threejs-scalable-real-time-shadows/examples/webgpu-cached-clipmap-shadow/validate.js --claim phase-1-scaffold --allow-missing-gpu
```

`--claim production-clipmap` intentionally fails. The scaffold cannot produce
that proof until its per-level receiver graph and lit receiver capture exist.

The GPU artifact layer now has a browser producer. From this example directory,
run:

```bash
node capture-shadow-depth.mjs
```

The capture harness serves the repo root, opens `browser.html` under Playwright
Chromium with WebGPU flags, writes `artifacts/shadow-map.png`,
`artifacts/silhouette.png`, and `artifacts/shadow-capture.json`, then runs:

```bash
node validate.js --artifacts artifacts
```

Without either `--allow-missing-gpu` or produced artifacts, validation exits
non-zero because the artifact layer is intentionally required.

Evidence provenance, stated precisely: `shadow-map.png` is a light-view
depth-ramp re-render of the caster scene through the SAME shared displaced
`positionNode` the controlled fixture uses, and `silhouette.png` is the
light-view binary coverage mask. Neither is a texel readback of a cached level
depth texture (a raw sample readback on this page returned zeros). The separate
validator proves only that renderer commands were issued to named per-level
targets and CPU state committed afterward; it is not GPU-completion or atlas-
content evidence. The PNGs prove the shared displaced caster is visible from
the light camera. Do not cite them as cached-depth contents or receiver proof.
