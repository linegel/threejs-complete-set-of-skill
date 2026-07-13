---
name: threejs-ambient-contact-shading
description: Design and implement ambient visibility in Three.js r185 WebGPU/TSL, including the forward-lighting placement cost, GTAO input/reconstruction choices, temporal gates, mobile bandwidth, and optional bent normals.
---

# Ambient Contact Shading

AO is visibility of indirect illumination. It may attenuate indirect diffuse and
environment/specular response; it must not multiply direct light, emission, UI,
or a tone-mapped frame.

Use `$threejs-choose-skills` for renderer and budget preflight. Use
`$threejs-image-pipeline` when depth, normal, velocity, history, tone mapping,
or adaptive resolution are shared.

## Numeric provenance

Tag quantities that drive an architecture decision or a correctness,
performance, or hardware claim:

- **[Derived]** follows from r185 source or an explicit formula.
- **[Gated]** is a branch condition that must pass on the target scene/device.
- **[Measured]** is recorded target-device evidence, never a portable promise.
- **[Authored]** is a starting value or planning ceiling, not a fact of hardware.

API versions, identifiers, list ordering, and illustrative values do not need
evidence labels unless they support such a claim.

## Decide whether screen AO is the right algorithm

Use the first row whose gate passes:

| Situation | Algorithm | Gate and consequence |
| --- | --- | --- |
| Static or slowly changing local occlusion can be authored in assets | material `aoMap` / `aoNode` | Prefer it: one forward scene render and correct lighting placement. Dynamic inter-object contact is absent. |
| The renderer already exposes an indirect-light term or uses deferred lighting | apply GTAO visibility to that term | One geometry pass can remain possible; the lighting decomposition owns correctness. |
| Stock r185 forward `NodeMaterial` lighting and dynamic screen contact are required | depth/normal pass -> GTAO -> optional reconstruction -> second lit pass with `builtinAOContext()` | Correct placement costs a second scene traversal and shaded scene render. Accept only when `measuredMarginalAO <= declaredMarginalAOBudget` **[Gated]**. |
| The previous rows fail their quality or budget gate | omit screen AO | Keep direct shadows, materials, and silhouette readable. Do not replace ambient visibility with a final-color multiply. |

The second lit pass is not an implementation detail. r185 `GTAONode` needs
current depth/normal before AO exists, while `builtinAOContext()` must be present
when materials are lit. A single stock forward pass cannot satisfy both
dependencies. If the first pass exists only for AO, count its color attachment,
material evaluation, deformation, alpha testing, draw submission, and depth/
normal writes; calling it a cheap prepass is incorrect.

## r185 API proof and non-negotiable constraints

Verified against installed `three@0.185.1` **[Measured]**:

| Fact | Local proof | Decision |
| --- | --- | --- |
| `ao(depthNode, normalNode, camera)` exists; `normalNode` may be `null` | `examples/jsm/tsl/display/GTAONode.js` | Use the built-in node as the scalar baseline. |
| `GTAONode.resolutionScale` is a property; it has no `setResolutionScale()` | same source | Assign the property directly. |
| Scalar AO target is `RedFormat`; its default scale is `1` **[Derived]** | same source | Scalar visibility does not need an HDR RGBA target. Start below full resolution only with a reconstruction/temporal plan. |
| `DenoiseNode` is an inline node with center plus `16` neighbor samples **[Derived]** | `DenoiseNode.js` | If inserted directly into a material context, its taps execute per shaded fragment. Materialize once with `rtt()` when a full-screen reconstruction pass is intended. |
| Depth-normal reconstruction performs `9` depth loads per normal evaluation **[Derived]** | `src/nodes/utils/PostProcessingUtils.js` | Reconstructing normals is not free; avoid it inside a `17`-sample denoise. |
| `useTemporalFiltering` only rotates the GTAO pattern; `TRAANode` supplies history/reprojection | `GTAONode.js`, `TRAANode.js` | Never enable it without a live TRAA resolve. |
| r185 `GTAONode` has no reversed-depth branch and rejects sky with `depth >= 1` **[Derived]** | `GTAONode.js` | Stock GTAO is gated to non-reversed depth. Do not claim reversed-depth support without a tested custom adapter/node. |
| `TRAANode` restarts history on resize but exposes no public camera-cut reset **[Derived]** | `TRAANode.js` | On a camera/projection discontinuity, replace and dispose the TRAA node, replace the output graph, and set `RenderPipeline.needsUpdate = true`. |
| `builtinAOContext()` skips transparent materials **[Derived]** | `src/nodes/core/ContextNode.js` | Transparent indirect occlusion needs an authored material policy; do not assume the context affects it. |
| A texture node without an explicit coordinate falls back to mesh `uv()` in a material graph **[Derived]** | `src/nodes/accessors/TextureNode.js`, `UV.js` | Feed the context `visibilityTexture.sample(screenUV).r`; using `.r` directly maps AO through each mesh's UVs. |

Initialize and hard-gate WebGPU before graph construction:

```js
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'threejs-ambient-contact-shading requires WebGPU.' );
}

if ( renderer.reversedDepthBuffer === true ) {
  throw new Error( 'r185 GTAONode baseline is not validated for reversed depth.' );
}
```

There is no non-WebGPU implementation in this skill.

## Production graph

```text
shared-or-AO-owned scene pass: depth + optional normal/velocity
  -> GTAONode scalar visibility
  -> optional materialized depth+normal-aware reconstruction
  -> second forward scene pass with builtinAOContext(visibility)
  -> optional TRAANode over final HDR beauty
  -> single tone-map/output-transform owner
```

Rules:

- Share an existing depth/normal/velocity pass when it is already required. Do
  not create duplicate G-buffers.
- A half-scale raw AO texture receives only ordinary texture filtering when
  sampled at full resolution; that is not bilateral reconstruction.
- Use `rtt(denoise(...))` to materialize reconstruction once before the second
  scene pass. Directly embedding `denoise(...)` in `builtinAOContext()` repeats
  its taps over scene overdraw.
- Sample the materialized texture with `screenUV` before passing it to
  `builtinAOContext()`. Pass textures default to fullscreen `uv()` only while
  evaluated by a fullscreen quad; material evaluation otherwise resolves
  ordinary mesh UV attributes.
- Use the full-resolution normal MRT when reconstruction is enabled or when
  another effect already owns normals. For raw reduced-resolution GTAO alone,
  benchmark a normal attachment against depth reconstruction.
- Keep scalar visibility in a single channel. Use `RGBA16F` only when a custom
  bent direction and scalar visibility must coexist.
- Bypass inactive AO nodes. Zeroing strength while keeping dependencies in the
  output graph still executes work.

Read [references/gtao-bent-normal-pipeline.md](references/gtao-bent-normal-pipeline.md)
for the exact graph, tap model, memory equations, temporal contract, and bent-
normal validation.

## Physics Scale And Presentation Contract

When the route declares physical metre-scale contact, resolve AO distances
through `PhysicsContext` and the current presentation transform in the
[physics domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
Let `sRender` be `CameraViewPublication.globalToRenderCurrent.renderUnitsPerMeter`:

```text
radiusRender    = radiusMeters    * sRender                  [Derived]
thicknessRender = thicknessMeters * sRender                  [Derived]
biasRender      = biasMeters      * sRender                  [Derived]
```

For the ordinary authored-world mapping, gate
`sRender = 1 / PhysicsContext.metersPerWorldUnit`; a deliberate visualization
rescale declares a new `RenderSimilarityTransform.transformRevision` and uses
its exact dimensioned transform. `biasRender` applies only to a custom AO bias that is dimensionally a world
distance; normalized-depth or angular biases retain their own declared units.
If the route intentionally uses perceptual scene units, label radius,
thickness, and bias as scene-unit-only and do not compare them across scaled
assets, physics contexts, or rebases as metres. A static/stylistic route may use
this mode without instantiating the physics ABI.

Latch the immutable central `PhysicsPresentationSnapshot` and resolve its exact
Candidate, `CameraViewPublication`, and `ViewPreparationPublication`; do not
define an AO-local subset. AO, depth, velocity, camera, and downstream history
consume candidate pair refs/signal descriptors, camera transforms/matrices, and
the preparation reactive/reset plan from the same chain. Temporal velocity uses adjacent
presented poses, never fixed-step endpoints. A compensated origin rebase keeps
AO radius, depth, and motion invariant only when previous/current uniform scales
are equal. A scale change converts AO parameters and resets/reseeds history; it
is not an origin rebase.

The Candidate supplies pose/deformation pairs, the camera publication supplies
complete render transforms/matrices, and the Snapshot references both plus the
preparation publication. Depth, normal, and velocity are target/view render-pass
resources produced after sealing and carry their image-pipeline resource
versions; never misclassify those attachments as physics provider signals.

Reset/reject AO history for changed geometry/deformation/coverage, camera or
projection discontinuity, uncompensated rebase, AO scale/parameter change, or
quality/resolution migration. A shadow or emissive-only radiance change does
not change scalar ambient visibility; preserve AO history, but propagate its
radiance-reactive mask to a downstream color history only when that temporal
implementation supports it. Stock r185 `TRAANode` does not; use evidenced
rebuild/bypass/reseed or a conservative full reset. When no local mask can
bound a geometry discontinuity, reset the affected history conservatively.
`ViewPreparationPublication.resetDependencies` is immutable; append executed actions to
`FrameExecutionRecord`. Device loss appends a `FrameExecutionRecord` with
`overallStatus: device-lost`, affected target execution statuses
`device-lost`, cancelled dependent actions, and lost-generation entries in
`leaseDispositionById`; it invalidates AO/history resources and timing proof without
mutating the sealed snapshot. Rebuild under the new backend/resource generation.

## Quality gates

| Tier | Authored start | Mandatory gate |
| --- | --- | --- |
| Full | scale `0.5`, samples `16`, MRT normal, materialized denoise, optional TRAA **[Authored]** | Complete marginal cost including the second scene pass fits; thin silhouettes and camera cuts pass. |
| Balanced | scale `0.5`, samples `8-12`, MRT normal if shared, no temporal history **[Authored]** | Raw/denoised edge error passes fixed-view comparison; no cross-edge halo. |
| Constrained WebGPU | scale `0.25-0.33`, samples `8`, depth-reconstructed normal only if it beats the MRT attachment **[Authored]** | Target-device GPU time and tile bandwidth pass; otherwise omit screen AO. |

`samples` is not the number of depth taps. In r185:

```text
D = samples < 30 ? 3 : 5                         [Derived]
S = floor((samples + D - 1) / D)                [Derived]
horizon depth taps per GTAO pixel = 2 * D * S    [Derived]
samples = 16 -> 36 depth taps                    [Derived]
samples = 8  -> 18 depth taps                    [Derived]
```

Increase samples only after scale, radius, reconstruction, and temporal policy
have been validated.

## Composable marginal budget

Measure toggles with the same camera path and warmed pipelines:

```text
deltaAO = time(complete AO graph) - time(no-screen-AO graph)       [Measured]
deltaNormal = time(scene pass with normal) - time(without normal)  [Measured]
deltaVelocity = analogous velocity attachment delta               [Measured]
deltaSecondScene = time(second lit pass)                           [Measured]
route valid iff deltaAO <= declaredMarginalAOBudget                [Gated]
```

Do not add the shared scene pass twice in a composed budget. Charge only its
measured attachment delta to AO when another selected system already owns that
pass; charge the entire first pass when AO created it.

For the stock half-float `PassNode` MRT, each extra full-resolution normal or
velocity attachment is `8 * width * height` bytes **[Derived]** before MSAA,
backend padding, and tile scratch. The built-in scalar GTAO target is
approximately `scale^2 * width * height` bytes for R8 **[Derived]**. On a tile
GPU, an extra MRT attachment can reduce tile residency or force stores; this is
a measured architecture decision, not a desktop assumption.

Do not seed the search with adapter-class millisecond tables. They hide scene
complexity, DPR, attachment traffic, browser state, and thermal drift. Start
from the cheapest representation that can meet the declared contact-radius and
edge-error gates, then measure `deltaAO`, `deltaNormal`,
`deltaVelocity`, and any `deltaSecondScene` separately on each named target.
The product's marginal AO budget is **[Gated]**; only matched, warmed A/B traces
are **[Measured]**.

## Visual wrongness signatures

| Signature | Cause / action |
| --- | --- |
| Direct highlights or emitters turn gray | Final-color multiply. Move AO into indirect lighting. |
| Dark fringe around a foreground silhouette | Reduced AO crossed a depth discontinuity; materialize depth+normal-aware reconstruction or reduce thickness/radius. |
| Creases look inked at every scale | Radius/thickness are image-style controls rather than scene-scale contact visibility. |
| Contact vanishes at the screen edge or when an occluder leaves view | Screen-space information loss; accept explicitly or use authored/baked visibility. |
| Crawling grain on a static camera | Too few samples without denoise, or temporal rotation enabled without TRAA. |
| Trails behind deforming or alpha-masked geometry | Invalid velocity/history rejection; disable temporal AO or repair motion vectors. |
| Faceted or unstable AO on smooth thin surfaces | Depth-reconstructed normals failed; use MRT normals or omit AO for that tier. |
| AO follows UV seams, stretches per object, or differs across meshes | The visibility texture used mesh `uv()`; sample it explicitly with `screenUV`. |
| Camera rotation changes bent tint twice or not at all | View/world transform or bent-direction sign is wrong. Keep directional tint disabled. |
| AO-off timing is unchanged | The output graph still depends on AO. Replace the graph and mark the pipeline dirty. |

## Ownership boundary

This skill owns scalar GTAO, reconstruction choice, ambient-light placement,
temporal eligibility, optional bent normals, and AO diagnostics. The image-
pipeline owner controls shared MRTs, global pass order, history, tone mapping,
output conversion, and adaptive resolution.
