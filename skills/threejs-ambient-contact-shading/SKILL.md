---
name: threejs-ambient-contact-shading
description: Ground indirect lighting with ambient visibility in Three.js r185 WebGPU/TSL. Use when choosing authored material AO, dynamic GTAO, forward-lighting placement, reduced-resolution reconstruction, temporal AO, or bent normals.
---

# Ambient Contact Shading

AO is visibility of indirect illumination. It may attenuate indirect diffuse and
environment/specular response. Direct light, emission, UI, and the tone-mapped
frame remain invariant.

`$threejs-choose-skills` is an optional multi-system coordinator. Use
`$threejs-image-pipeline` when AO shares depth, normals, velocity, history, or
final-output ownership.

## 1. Choose the ambient-visibility branch

Use the first branch whose gate passes:

| Gate | Branch | Consequence |
| --- | --- | --- |
| Required occlusion is static/local and can be authored in assets | material `aoMap` / `aoNode` | One forward render; no dynamic inter-object contact. |
| Dynamic screen contact is required and the renderer exposes indirect lighting separately | apply GTAO visibility to that term | One geometry pass can remain possible. |
| Stock forward `NodeMaterial` needs dynamic contact and the complete marginal cost passes | depth/normal pass -> GTAO -> optional reconstruction -> second lit pass with `builtinAOContext()` | Correct placement costs two scene traversals. |
| No previous branch meets its quality and cost gates | omit screen AO | Preserve materials, direct shadows, and silhouette readability. |

r185 `GTAONode` needs current depth/normal before AO exists, while
`builtinAOContext()` must be present during material lighting. Treat the first
pass as a full material/deformation/alpha-tested scene pass unless a parity-
proven depth/normal-only pass replaces it.

**Complete when:** the chosen branch names the indirect-light owner and either
charges every added pass/attachment or records screen AO as omitted.

## 2. Fix the input contract

- Initialize the renderer and require a WebGPU backend before graph creation.
  Stock r185 GTAO is gated to standard depth; a custom reversed-depth adapter
  must prove sky classification, reconstruction, and occluder ordering.
- Define opaque occluders, opaque receivers, alpha coverage, and one transparent
  policy: no screen AO, authored material AO, or a validated custom lighting
  model. Stock `builtinAOContext()` skips transparent materials.
- Bind AO to the active view's `screenUV`, drawing-buffer dimensions, and
  projection. Keep width and height independent for non-square/asymmetric views.
- Choose depth-reconstructed normals for reduced raw AO only when edge fixtures
  and target timing pass. Choose an MRT normal when it is shared, reconstruction
  is materialized, smooth/thin geometry fails, or its measured attachment delta
  is cheaper.
- Express physical contact radii in world units:
  `radiusRender = radiusMeters * renderUnitsPerMeter`, with the same conversion
  for dimensioned thickness and bias. An authored-look branch instead declares
  scene-unit-only controls and revalidates them after asset/world scaling.

When another system supplies scale, motion, or resources, bind units, coordinate
frame, current/previous presentation times, authority, version, resource
generation, validity, and reset conditions before using those inputs.

**Complete when:** depth convention, screen coordinates, normal source,
transparency, scale meaning, and every external producer are explicit and
dimensionally compatible.

## 3. Materialize scalar visibility

Build the selected screen-space branch in this order:

```text
shared-or-AO-owned depth + optional normal/velocity
  -> GTAO scalar visibility
  -> optional materialized edge-aware reconstruction
  -> indirect-light application
  -> optional temporal resolve over the matching admitted layers
  -> excluded-layer composition only when those layers were separated
  -> one tone-map/output-transform owner
```

- Reuse a shared scene pass; do not create a second G-buffer for AO.
- Raw reduced-resolution AO receives ordinary texture filtering, not bilateral
  reconstruction. When edges fail, evaluate `rtt(denoise(...))` once, then
  sample the materialized texture with `screenUV`.
- Inside a mesh material graph, sample both raw and reconstructed visibility
  explicitly with `screenUV`; implicit texture coordinates resolve to mesh UVs.
- Keep stock transparent/transmission rendering in the non-temporal lit pass;
  `builtinAOContext()` already skips transparent materials. Use an opaque-only
  lit pass plus separate layer composition only for a temporal resolve or an
  already-owned external compositor. Account for its full cost; charge AO only
  the marginal delta when that compositor is shared.
- Keep scalar visibility single-channel. Replace the output graph and mark the
  `RenderPipeline` dirty when AO is disabled so inactive work is unreachable.

When implementing GTAO or choosing reconstruction, read
[the r185 GTAO pipeline](references/gtao-bent-normal-pipeline.md#r185-graph-and-api-gates)
and [its reconstruction tradeoff](references/gtao-bent-normal-pipeline.md#reconstruction-and-cost).

**Complete when:** the active graph has one depth/normal owner, visibility is
sampled in screen space, AO reaches only indirect lighting, and AO-off removes
every AO pass and dependency.

## 4. Admit temporal filtering only with valid history

`GTAONode.useTemporalFiltering` rotates samples; it does not create or reproject
history. Enable it only with a live TRAA/custom resolve, valid camera and object
motion (including deformation/instancing/alpha coverage), matching beauty/depth/
velocity dimensions and layer membership, rejection, and reset behavior. Resolve
only layers represented by those depth and velocity signals. Composite excluded
transparent or refractive layers afterward; admit them to the resolve only when
their matching depth, motion, coverage, and rejection behavior are proven.

Reset or reseed on camera/projection cuts, uncompensated rebases, geometry or
coverage discontinuities, AO parameter/scale/resolution changes, and quality
migration. r185 `TRAANode` has no public camera-cut reset: rebuild and dispose
the node, replace the output graph, and mark the pipeline dirty.

When temporal AO is selected, read the
[temporal contract](references/gtao-bent-normal-pipeline.md#temporal-contract)
before constructing history.

**Complete when:** beauty, depth, and velocity cover the same admitted layers;
any excluded transparent/refractive layers are composed after the resolve; and
moving-occluder, disocclusion, camera-cut, resize, and AO-parameter-change
fixtures either pass with explicit rejection/reset or temporal AO is disabled.

## 5. Add bent normals only after scalar AO passes

A bent normal is the visibility-weighted mean unoccluded direction. Add this
branch only when scalar AO already passes, directional environment response is
visible and required, and the one-wall fixture proves the direction points away
from the blocked hemisphere.

When bent normals are selected, read the
[bent-normal contract](references/gtao-bent-normal-pipeline.md#bent-normal-extension)
for basis, filtering, normalization, storage, and sign checks.

**Complete when:** scalar visibility remains independently available, the
direction is transformed exactly once, and the one-wall fixture passes; otherwise
directional use stays disabled.

## 6. Verify the finished graph

For an active screen-space branch, capture raw depth, the selected normal input,
raw/reconstructed AO when admitted, indirect contribution, direct/emissive
residuals, velocity/history rejection when temporal filtering is present, and
AO off. Exercise UV-invariance, thin silhouettes, transparent crossings, smooth
curves, screen edges, asymmetric projections, motion when present, resize, and
disposal/recreation.

For authored material AO, validate the authored UV set, asset/world scaling, and
indirect-only placement instead. For omitted screen AO, record that no screen-AO
pass, attachment, history, or dependency is reachable.

**Complete when:** direct light and emission are invariant; every fixture for
the selected branch passes; an active screen-space branch has no unintended
UV-following, cross-edge halo, crawl, or trail; AO-off or omission shows zero
screen-AO work; target-device marginal time and resource use pass; and
recreation returns resource counters to baseline.

## Ownership

This skill owns scalar GTAO, reconstruction choice, indirect-light placement,
temporal eligibility, bent normals, and AO diagnostics. The image-pipeline owner
owns shared MRTs, global pass order, history infrastructure, tone mapping, output
conversion, and adaptive resolution.
