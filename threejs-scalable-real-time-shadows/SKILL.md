---
name: threejs-scalable-real-time-shadows
description: Design scalable directional cast shadows for Three.js r185 WebGPU/TSL scenes. Use for bounded shadow projections, cascades, tiled array shadows, cached clipmaps, stable texel snapping, filter/bias footprints, cache invalidation, caster parity, binding pressure, and sustained mobile budgets.
---

# Scalable Real-Time Shadows

Choose shadow topology from spatial coverage, caster change rate, receiver
pixel coverage, and adapter resources. A custom cache is justified only when
measured reuse beats the built-in WebGPU nodes.

## Number Labels

Every consequential number must be labelled:

- **Derived**: computed from bounds, texel density, workload, adapter limits,
  target refresh rate, or an equation.
- **Gated**: a hard resource/correctness ceiling enforced by validation.
- **Measured**: captured on the named device, resolution, DPR, scene, and
  sustained trace.
- **Authored**: visual intent such as coverage, softness, fade width, or
  acceptable update latency.

Unlabelled map sizes, level counts, bias constants, and millisecond claims are
invalid.

## Architecture Decision

| Spatial/change problem | First WebGPU path | Actual r185 topology |
| --- | --- | --- |
| Bounded light-space receiver/caster volume | one `DirectionalLight` shadow | one shadow view and one depth texture |
| Camera-depth coverage whose visible region changes continuously | `CSMShadowNode` from `three/addons/csm/CSMShadowNode.js` | `L` lightweight placeholder light objects with cloned shadows, views, and depth textures; no persistent coarse cache |
| Large fixed orthographic projection partitioned into rectangles | `TileShadowNode` from `three/addons/tsl/shadows/TileShadowNode.js` | one depth-array texture, one `ArrayCamera` renderer invocation, `N = tilesX * tilesY` backend layer passes, and `N` coordinate/containment branches with conditional comparison work; one union-frustum render list can draw each listed caster into every layer |
| Very large mostly persistent coverage with reusable coarse maps | custom cached clipmap attached through `light.shadow.shadowNode` | `L` persistent levels; useful only when changed casters do not force most nested full maps to redraw |
| Broadly animated/deforming caster field | one shadow or CSM, or an explicitly separated dynamic overlay | caching stale silhouettes is not a valid optimization |

The table states comparison-depth sampling topology. r185 core shadows still
allocate a color-bearing render target beside depth, and Tile allocates a red
color array beside its depth array even when transmitted shadows are disabled.
VSM adds distribution/blur targets and passes.

`TileShadowNode` is not a clipmap: it updates all tile layers together and has
no per-tile persistence scheduler. r185 builds one render list using visibility
in any subcamera, then its WebGPU backend can issue each listed object's draw in
every layer; it does not independently recull that list per tile. The array
reduces sampled-texture binding pressure, not backend layer passes, worst-case
caster draws, or receiver-side coordinate/branch/filter work.

## r185 WebGPU Gate And API Facts

```js
import { WebGPURenderer } from "three/webgpu";

await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error("This shadow architecture requires the WebGPU backend.");
}
```

r185 source verifies:

- `AnalyticLightNode` consumes `light.shadow.shadowNode` when defined;
  otherwise it creates the default shadow node.
- The selected light shadow node is cached in built material/light graphs.
  Attach before first build; changing/deleting the property later affects future
  builds only unless every affected graph/pipeline is rebuilt and lifecycle-tested.
- `ShadowNode.updateBefore()`, `updateShadow()`, `renderShadow()`,
  `setupShadowCoord()`, `setupShadowFilter()`, and `setupRenderTarget()` are the
  relevant extension points.
- `LightShadow.biasNode` overrides numeric `bias` in the node path.
- `NodeMaterial.positionNode` and `castShadowPositionNode` are local-space
  geometry hooks. `receivedShadowPositionNode` is a world-space receiver
  lookup-position hook through `shadowPositionWorld`; it is not the third copy
  of a local caster deformation node.
- r185 `CSMShadowNode` texel-snaps each cascade center. Its clone scaling changes
  numeric `bias` only, becomes inert when cloned `biasNode` is present, and the
  dynamic `filterNode` property is not copied. It fits XY but retains the source
  shadow near/far. Gate custom filtering, `normalBias`, filter support, and
  caster/receiver light-depth coverage per cascade.
- `LightShadow.copy()` omits `mapType`; CSM clones lose a non-default source
  color-attachment type. `FloatType` there does not select depth32float—custom
  depth precision requires an explicit `DepthTexture`/target override.
- r185 `CSMShadowNode.updateFrustums()` must be called after camera projection
  or CSM split settings change, but it does not propagate all source-shadow
  changes or rebuild cascade topology. Configure before first build or
  explicitly synchronize/rebuild children.
- r185 `TileShadowNode` uses one array depth texture and does not support VSM.
  Its source initializes array comparison with `LessCompare` without a reversed
  depth branch. **Gated:** do not combine it with `reversedDepthBuffer` unless a
  target r185 depth diagnostic proves the comparison convention or the local
  implementation is corrected. It also supplies no filter gutter between tile
  layers; test PCF/PCFSoft support at every border.
- Tile's resolution option is later overwritten by cloned source `mapSize`, and
  its shared Red color array cannot represent RGBA transmitted shadows. Set and
  verify the source map size or patch the addon; reject transmitted color.
- r185 core shadow depth defaults map to `depth24plus`; reversed depth is not a
  promise of float32 shadow precision. Core receiver containment omits
  `shadowCoord.z >= 0`; first-frame reversed matrices, layered reversed clears,
  CSM split/receiver boundaries, non-default layers, and multi-camera updates
  all require fixed-scene diagnostics before acceptance.

## Custom Cached-Clipmap Contract

Use a custom clipmap only after the decision comparison. It must:

1. define levels in one stable directional-light basis;
2. derive XY world texel widths from committed orthographic extents and map
   dimensions;
3. snap the light-space center to that grid relative to a stable global anchor;
4. distinguish desired, rendered/committed, dirty, and invalid state;
5. publish a center/extent only after its matching depth render completes;
6. choose and validate one receiver topology: a portable independent-texture
   path with unconditional level samples, or a target-proven array/atlas path
   that selects one layer (two in a cross-fade) with explicit border gutters;
7. refresh always-changing near coverage and schedule reusable levels under a
   measured update-debt gate;
8. route correctness invalidations outside the ordinary cache-age budget;
9. coalesce swept caster bounds and either refresh before sampling or mark a
   stale level invalid until repaired;
10. share local-space visible/caster deformation and coverage logic while
    keeping receiver-position overrides in world space;
11. reject transmitted-color/VSM caching unless color/distribution resources,
    filtering, blending, and their invalidation dependencies are implemented;
12. dispose the attached node, cloned shadows/lights, targets/textures,
    storage, debug resources, and listeners.

Read [references/cached-clipmap-shadows.md](references/cached-clipmap-shadows.md)
before implementing the custom path.

## Texel, Filter, And Bias Footprints

For level extent `[left,right] x [bottom,top]` and map `W x H`:

```text
dx = (right - left) / W    // Derived world units per texel
dy = (top - bottom) / H
centerX = quantize((desiredX - anchorX) / dx) * dx + anchorX
centerY = quantize((desiredY - anchorY) / dy) * dy + anchorY
```

Choose one deterministic `floor` or nearest policy and validate slow motion;
do not change quantizer or anchor between frames. Z is a light-ray coverage
problem, not the projected texel grid: fit biased receiver lookup positions and
every relevant occluder between them and the light, add a Derived/Authored
guard, and use hysteresis instead of an arbitrary XY-derived Z quantum.

r185 filter cost and footprint are algorithm-specific:

- `BasicShadowMap`: one comparison sample.
- `PCFShadowMap`: five Vogel-disk comparison samples; with supported hardware
  linear comparison the source describes an effective twenty filtered taps.
  `shadow.radius` scales by `1 / mapSize.x` for both axes, so non-square maps can
  produce anisotropic world footprints.
- `PCFSoftShadowMap`: four gather-compare operations reconstruct a weighted
  local kernel; r185 does not use `shadow.radius` in this filter.
- `VSMShadowMap`: adds two blur render passes and distribution targets; r185
  `TileShadowNode` rejects it.

For PCF, `radius * dx` is the nominal Vogel sample-center scale, not the exact
support: the outer sample lies inside that radius and hardware linear comparison
adds a bilinear texel footprint. Derive a conservative anisotropic support
`(rhoX,rhoY)` from the actual pattern/backend. Decide whether softness is
Authored constant-world-size or grows with level, then match support across
cross-fades and reserve it inside every containment/tile edge.

`normalBias` is a world-space normal offset; numeric `bias`/`biasNode` is a
normalized comparison-depth offset. Scale and diagnose them separately. Bound
world depth uncertainty with anisotropic receiver-plane gradients, for example
`abs(dz/dx)*rhoX + abs(dz/dy)*rhoY + rasterQuantization`, then divide by the
orthographic light-depth span and apply the sign verified for normal/reversed
depth. Gate normal offset by a contact-detachment test. Never hide oversized
filter footprints with excessive bias.

## Cache Invalidation

### Physics presentation and reactive publication

Keep the existing shadow node/cache as sole owner of desired, invalid,
rendered, and committed map state. When the route declares a physics-to-render
boundary, bind shadow preparation to the immutable pair of
`PhysicsPresentationCandidate` and target/view `CameraViewPublication` from the
[physics domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md),
and validate its exact central per-binding/provider presented pairs, signal descriptors,
camera render transforms/projection, validity, and errors. After cache
publications return, the preparation owner emits `ViewPreparationPublication`
and the central writer seals `PhysicsPresentationSnapshot`; visible receivers
and temporal consumers resolve committed shadow refs, `reactivePublications`,
`resetDependencies`, and resource lease refs transitively through
`viewPreparationId`.

Caster invalidation uses the domain's current `PresentedStatePair`; swept
bounds use both presented states. Do not use fixed-step endpoints or poll an external physics
engine from the shadow pass. A pure render-origin rebase leaves semantic
light/caster geometry invariant when both camera transforms are applied; it
does not dirty depth content merely because float render coordinates changed.
A physics-origin rebase may preserve cached depth only after the accepted
`PhysicsOriginRebaseTransaction` transforms every caster/receiver/cache binding
and a light-space round-trip invariant passes; otherwise invalidate the cache
and its dependent temporal region.

For a physically sourced directional light, bind the canonical
`LightingTransportSnapshot.sourceDirection` through its provider-wide
`PresentedStatePair` and validate context/provider/signal IDs, basis, support,
requested `PhysicsInstant`, channel `actualPhysicsTime`, declared clock mapping,
maximum staleness,
state/resource generations, lease, validity, and angular error.
A broad directional distribution that exceeds the single-direction projection
gate cannot be silently collapsed into one shadow camera. A nonphysical route
keeps this lighting binding `not used` and declares an authored light basis.

The cache owns, but does not publish as a parallel ABI, two internal states:

- `shadowContentEpoch`: newest caster/light/alpha/deformation/resource content version that
  correct shadow content must represent;
- `shadowCommittedEpoch`: exact valid content version and map identity actually
  sampled by receivers, plus changed receiver bounds or a conservative screen
  mask.

On an accepted commit, map those states into the exact central records: return a
`shadowViewPublicationRefs` entry containing `shadowOwner`, `shadowViewId`,
`cameraProjectionRevision`, `shadowContentEpoch`, `resourceLeaseRefs`, and
`boundedDelay`, plus one `ReactivePublication` with `kind: shadow-content`,
`sourceVersion` equal to the committed epoch, canonical `affectedRegion`,
`resourceLeaseId`, validity/error, and `plannedConsumerActions`. Return a
versioned shadow-visibility factor ID as
radiometric provenance; downstream lighting/render-radiance provenance includes
that ID exactly once in `attenuationFactorIds`. Never mutate the already
published lighting snapshot to retrofit it.

That entry is the canonical `ShadowViewPublicationRef`: it identifies the
committed content, target/receiver view, camera publication and projection
revision, factor provenance, leased resource generation, and any bounded delay
consumed by this exact preparation. A desired, scheduled, or unsubmitted cache
state may not occupy the reference.

Keep `desiredCoverageEpoch` and update debt separate. Camera/snapped-center
motion may leave the prior committed map correct within its committed domain;
it is not a content/radiance change until containment fails or a new map
actually commits.

Key both records by presentation target, view/camera-projection identity, and
light; one camera's committed coverage cannot authorize another
view. Publications also pin resource generation/layout/layer and a queue-safe
lease until every receiver has submitted and its central
`reuseProhibitedUntil` condition is satisfied; append release to
`FrameExecutionRecord.leaseDispositionById` with its completion join/evidence.

The preparation owner writes those refs, publications, actions, and leases into
a new immutable `ViewPreparationPublication` before sealing the Snapshot.
Candidate, camera publication, preparation publication, and Snapshot are
immutable; a shadow node never patches an earlier record. If a render-hook update finishes after sealing, both publication
and receiver use are deferred to the next snapshot/presentation epoch; the
current scene continues sampling the prior committed resource named by its
snapshot. This requires an inactive resource generation while the prior leased
generation remains untouched, followed by an atomic next-snapshot swap.
Otherwise suppress the late update; an in-place render-hook write violates
snapshot/content agreement. Same-presentation commits run before the seal.
Never label desired or merely scheduled content as committed. A changed commit
is a radiance discontinuity: reject the affected temporal-radiance pixels, or
reset the full radiance history when no conservative mask exists. Shadow cache
age and update scheduling remain owned here; the central contract standardizes
only the published boundary and ordering.

`ViewPreparationPublication.resetDependencies` is only the immutable action
plan. Append actual shadow
renders, queue submissions, cache commits, reseeds, failures, and deferred
feedback to `FrameExecutionRecord`. Do not treat logical content epoch,
submission epoch, GPU queue availability, or host readback as equivalent.
`computeAsync()` is not a completion fence. If required shadow preparation
cannot return a valid committed or declared prior/degraded version before seal,
append a `FrameExecutionRecord` with `overallStatus: aborted` (or
`partial-failure` when another target survives), exclude the failed target from
`snapshotIds`, store typed absence in its target execution's `snapshotId`,
cancel or defer actions, retire only failed-target-exclusive preparation
leases, and retain Candidate/shared leases until all surviving snapshot
consumers join through `leaseDispositionById`. Device loss appends
`overallStatus: device-lost` and
affected target statuses `device-lost`, advances
`deviceLossGeneration`, cancels actions, and invalidates lost-generation shadow
resources/leases without mutating Candidate/Snapshot records or inventing a
normal completion token. Rebuild the cache under the new generation before
publication.

Track at least these dirty causes:

- snapped coverage center or fitted depth range changed;
- directional-light basis changed;
- caster transform, geometry, LOD, visibility, layer, `castShadow`, alpha/mask,
  or deformation envelope changed;
- caster arrival/removal or spatial-chunk generation changed;
- map resolution/format/resource identity changed.

Receiver-only motion does not change opaque comparison depth while committed
coverage remains valid; it changes lookup/coverage. r185 VSM is exceptional
because its submission includes `receiveShadow` objects. Filter, bias, or fade
changes usually rebuild sampling state, not caster depth. Do not redraw maps
for the wrong dependency.

For a moved/deformed caster, invalidate the union/swept bound of its previous
and current conservative light-space silhouette. A content invalidation cannot
wait silently behind an age refresh. Either:

- refresh the affected level before it is sampled; or
- set `valid = false`, remove that level from containment so valid coarser maps
  inherit its remaining weight, and repair it through a separately Gated
  correctness queue. Only unresolved outer remainder becomes fully lit.

Coalesce overlapping bounds before level tests. A local change near the center
of nested full maps can intersect every level and force `L` full redraws; a
level-granular clipmap does not make that update cheap. Exclude dynamic casters
into an overlay/proxy, use nonoverlapping ring ownership, or adopt paged/tiled
partial residency when measurements require locality. Continuously deforming
content otherwise defeats coarse caching.

A static-cache/dynamic-overlay design belongs inside the same light/shadow
node; a second `DirectionalLight` duplicates illumination. For opaque binary
visibility with matched light-plane taps, exact union filtering is
`sum_k(w_k * Vstatic_k * Vdynamic_k)`, with out-of-overlay coverage equal to
one. `min()` or multiplying already-filtered averages is an approximation that
needs a quality gate. Transmitted color needs a separate composition contract.

Keep the scheduler CPU-visible. A GPU dirty bit cannot be consumed by
`updateBefore()` without readback. Use CPU chunk generations/spatial indices to
select level renders; use GPU compute for caster compaction only when the render
path remains GPU-driven and a target measurement proves the benefit.

## Caster Parity

- `material.positionNode` and `material.castShadowPositionNode` may reference
  the same local-space deformation node object.
- Leave `receivedShadowPositionNode` null for the normal world-space receiver
  position. If overridden, provide an explicitly world-space node and validate
  it independently.
- Morphing, skinning, instancing, and batched transforms are already applied by
  the r185 NodeMaterial position path; custom overrides must preserve them.
- Share alpha/coverage semantics through map/color alpha, `alphaTest`,
  `maskNode`/`maskShadowNode`, and `castShadowNode` as applicable.
- Audit side, layers, cast/receive flags, deformation time/version, and caster
  proxies. Formula text equality is not parity; shared data and coordinate
  contracts are.

## Bind, Memory, And Workload Budgets

Query the initialized WebGPU device limits and inspect the compiled binding
layout. Do not assume one sampler binding per texture; deduplication is graph
and backend dependent.

```text
nominal target bytes = sum(width * height * layers *
                           (bytesPerColorTexel + bytesPerDepthTexel)) // Derived lower bound
shadow draw work     = sum_v(visibleCasterDraws_v)                   // Derived
shadow triangle work = sum_v(visibleCasterTriangles_v)               // Derived
shadow vertex work   = sum_v(vertexInvocations_v)                    // Measured/Derived
shadow raster work   = sum_v(coveredDepthSamples_v * meanOverdraw_v) // Measured estimate
                     // or direct fragment invocations, never both
alpha work           = sum_v(alphaTexelFetches_v + discardedFragments_v)
receiver filter ops  = sum_pixels(sum_activeEvaluations(filterOps))  // Derived
frame allowance      = 1000 / targetRefreshHz                        // Derived ms
```

Topology pressure:

- CSM: `L` depth-texture bindings and approximately one active cascade filter
  per receiver in its built-in selection path; `L` shadow views update.
- Tile: one array depth texture with `N` layers and `N` backend layer passes.
  With r185 union-frustum render-list construction, caster work can approach
  `N * unionVisibleCasterDraws`. The shader performs `N` transforms/tests but
  normally branches into one in-range comparison filter (two on inclusive
  borders); divergence may serialize different branches. A custom tile-array
  selector can issue one layer comparison but must solve filter-border gutters.
- Per-level clipmap textures: `L` texture bindings. The portable unconditional
  path performs `L` filters; an array/atlas selector can reduce to one or two
  filters but needs common format/dimensions, dynamic-layer validation, and
  filter-safe borders.

**Gated:** sampled textures, samplers, bindings per group, bind groups, array
layers, texture dimensions, memory ceiling, update debt, and maximum invalid
coverage stay below the target adapter/product limits. Leave headroom for all
other material and post resources.

**Measured sustained mobile evidence:** target resolution/DPR and refresh goal;
thermal-steady trace; CPU/GPU frame quantiles; shadow-view draws/triangles;
vertex invocations, depth-fragment coverage/overdraw, alpha/mask/deformation
cost, pass clears/transitions, CPU traversal/cull time, receiver filter
coverage; update spike/debt/age; bind-layout manifest; GPU allocation estimate;
streaming/invalidation bursts. Allocate shadow time from the complete measured
frame architecture, but declare independent CPU, GPU, presented-frame, memory,
and spike/headroom gates before the acceptance trace. CPU and GPU overlap; do
not sum them. The measured trace tests the gates rather than defining them.

Optimize the measured bottleneck: update/draw-bound work needs fewer views,
casters, overdraw, or refreshes; receiver-bound work needs fewer active filters
or lower filter cost; binding/memory-bound work needs packing/count/format
changes; traversal-bound work needs spatial ownership/culling. Do not lower
update cadence to solve receiver-filter cost. Increase resolution only after
projection fit, snapping, bias, and filter support are correct.

## Failure Conditions

- custom cache chosen without a same-scene comparison against one shadow, CSM,
  and tiled projection;
- desired centers published while maps still represent committed centers;
- center quantized in screen/camera space or against a moving origin;
- Z quantization clips casters or wastes the depth range;
- stale content remains sampled after explicit invalidation;
- divergent comparison branches used without target/UA shader validation or a
  portable unconditional/array-layer design;
- fixed texel-radius filters create visible world-size jumps at level borders;
- one bias constant used across incompatible world texel/depth spans;
- local caster deformation assigned to `receivedShadowPositionNode`;
- tile array selected solely to reduce bindings while view/filter cost is
  ignored;
- GPU dirty masks require hidden frame-loop readback;
- passing average timing hides periodic cache-expiry/invalidation spikes.

## Routing Boundary

Use this skill for directional cast-shadow projections. Use
`$threejs-ambient-contact-shading` for view-dependent ambient visibility,
`$threejs-image-pipeline` for shared depth/post ownership, and
`$threejs-visual-validation` for fixed-view shimmer, cache, resource, and
sustained-budget evidence.
