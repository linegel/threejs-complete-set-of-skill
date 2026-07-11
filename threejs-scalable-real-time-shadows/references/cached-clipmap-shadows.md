# Directional Shadow Architecture And Cached Clipmaps

Use this reference for directional cast shadows on the Three.js r185
WebGPU/TSL path. A cached clipmap is the last architecture in the decision
sequence, not the default.

## Routing Map

| Decision | Read first | Then validate |
| --- | --- | --- |
| choose one shadow, CSM, Tile, or custom | Architecture Decision Record | Workload Model And Breakpoints |
| assess built-ins | Built-in CSM/Tile audit | Reversed-depth and multi-camera gates |
| implement a custom cache | Cached Clipmap Representation | Atomic Render And Hook Architecture |
| eliminate crawl/seams/acne | Stable Light Basis And Texel Anchor | Filter Footprint Audit and Bias Model |
| handle changing casters | Targeted Invalidation | Caster And Receiver Parity |
| target mobile/low-end | Binding And Memory Pressure | Sustained Mobile Budget Protocol |

Section index: [evidence](#numerical-evidence-contract) ·
[visibility](#visibility-contract) · [r185 audit](#r185-source-audit) ·
[architecture](#architecture-decision-record) · [preflight](#webgpu-preflight) ·
[workload](#workload-model-and-breakpoints) ·
[representation](#cached-clipmap-representation) ·
[basis](#stable-light-basis-and-texel-anchor) · [snapping](#texel-snapping) ·
[state](#level-state-machine) · [scheduling](#update-scheduling) ·
[render/hooks](#atomic-render-and-hook-architecture) ·
[sampling](#cross-level-containment-and-sampling) ·
[filter](#filter-footprint-audit) · [bias](#bias-model) ·
[invalidation](#targeted-invalidation) · [parity](#caster-and-receiver-parity) ·
[resources](#binding-and-memory-pressure) ·
[mobile protocol](#sustained-mobile-budget-protocol) · [diagnostics](#diagnostics) ·
[validation](#validation-matrix) · [rejected patterns](#rejected-patterns).

## Numerical Evidence Contract

Classify every consequential number:

- **Derived** — calculated from coverage, projection, map dimensions, caster
  bounds, adapter limits, target refresh rate, or a stated equation.
- **Gated** — a correctness/resource ceiling checked by validation.
- **Measured** — captured on the named device, resolution, DPR, scene, and
  sustained workload.
- **Authored** — a visual or latency choice: coverage, penumbra, fade width,
  allowable stale-to-lit interval, or quality priority.

Do not copy map sizes, cascade/level counts, biases, update counts, or timing
budgets from another scene. Unlabelled millisecond claims are invalid.

## Visibility Contract

A directional shadow map stores the first caster depth along parallel light
rays over an orthographic light-space domain. A receiver is lit when its biased
comparison depth is not behind that stored depth. Correctness requires four
independent agreements:

1. **coverage** — every required caster-to-receiver ray lies inside the
   committed light-space XY domain and fitted Z range;
2. **silhouette** — visible and shadow passes use equivalent geometry and
   alpha/mask semantics;
3. **sampling** — filter footprint, bias, containment, and cross-level weights
   use the depth map that was actually rendered;
4. **time** — cached content is invalidated when a dependency changes.

Diagnose them separately. Increasing resolution cannot repair clipped casters,
stale cache content, coordinate-space errors, or divergent sampling.

The baseline contract is opaque comparison depth. If
`renderer.shadowMap.transmitted` or VSM is enabled, a custom cache must also own
and blend color/distribution resources, filtering passes, and invalidation for
`castShadowNode` RGB/alpha and filter inputs. Reject those modes until that
additional graph is implemented and captured; depth-only invalidation is not
sufficient.

## r185 Source Audit

The installed dependency reports `REVISION = '185'` (**Gated** by runtime and
lockfile). Verified hooks and behavior:

| r185 source interface | Verified role |
| --- | --- |
| `AnalyticLightNode.setupShadow()` | if `light.shadow.shadowNode !== undefined`, wraps that custom node; otherwise creates the default `ShadowNode` |
| `ShadowBaseNode.setupShadowPosition()` | assigns `shadowPositionWorld` from `material.receivedShadowPositionNode`, builder context, or `positionWorld` |
| `ShadowNode.setupShadow()` | creates target/filter graph and adds `normalBias` in world space before light projection |
| `ShadowNode.setupShadowCoord()` | divides/projectively maps coordinates and applies `shadow.biasNode || shadow.bias`; flips the bias operation for reversed depth |
| `ShadowNode.setupShadowFilter()` | builds a conditional for `x,y in [0,1]` and `z <= 1`, with no `z >= 0` test; r185 `ConditionalNode` normally emits a real branch around the filter |
| `ShadowNode.updateBefore()` | runs from `LightShadow.needsUpdate || autoUpdate` and calls `updateShadow()` |
| `ShadowNode.updateShadow()` | owns shadow override material, caster render filtering, render-target state, optional VSM passes, and renderer/scene restoration |
| `ShadowNode.renderShadow()` | updates light matrices and renders one shadow camera into the currently selected target |
| `LightShadow.biasNode` | WebGPU node comparison-depth bias; when set, numeric `bias` is ignored |
| `NodeMaterial.positionNode` | local-space visible position override after morph, skinning, displacement, batching, and instancing setup |
| `NodeMaterial.castShadowPositionNode` | local-space shadow-pass position override; falls back to `positionNode` |
| `NodeMaterial.receivedShadowPositionNode` | world-space receiver lookup position consumed by `shadowPositionWorld` |
| `NodeMaterial.maskShadowNode` / `castShadowNode` | shadow coverage/color overrides in the r185 shadow material path |

Attachment contract:

```js
light.shadow.shadowNode = customShadowNode;

// On disposal/detach, restore the default path:
if (light.shadow.shadowNode === customShadowNode) {
  delete light.shadow.shadowNode;
}
```

Use deletion, not `null`: r185 tests only `!== undefined` before wrapping the
custom value.

Attach before the first affected light/material graph build.
`AnalyticLightNode` caches the selected `shadowNode`/`shadowColorNode`; assigning
or deleting `light.shadow.shadowNode` does not hot-swap an existing graph.
Deletion changes future selection. A runtime swap requires explicit rebuild of
every affected graph/pipeline plus a dispose/recreate proof.

These are current-source extension points, not a promise that every internal
detail is stable across revisions. Gate the exact revision and run an API smoke
test after upgrades.

## Architecture Decision Record

Benchmark all plausible paths on one seeded workload and one projection/
filter policy. Record caster draws/triangles, receiver pixels, shadow views,
filter operations, nominal/observed allocation, binding layout, update spikes,
and sustained GPU/CPU frame evidence.

| Need | Architecture | r185 cost topology |
| --- | --- | --- |
| Bounded receiver/caster volume | one `DirectionalLightShadow` | one view, one depth texture, one filter evaluation |
| View-dependent depth span | `CSMShadowNode` | `L` lightweight light placeholders with cloned shadows, `L` maps, `L` view renders; normally one active comparison filter, two across a fade |
| Fixed orthographic footprint split spatially | `TileShadowNode` | one array depth texture and one `ArrayCamera` renderer invocation, but `N = tilesX * tilesY` backend layer render passes and `N` coordinate/containment branches with conditional comparison work; one union-frustum render list can draw each listed caster in every layer |
| Persistent very large coverage with local changes | custom cached clipmap | `L` retained levels and selected view updates; receiver work is `L` unconditional samples for the portable path or one/two selected layer samples for a target-gated array/atlas path |

These are comparison-depth sampling topologies. r185 core `ShadowNode` still
allocates a color-bearing render target beside its depth texture, and Tile
allocates a red color array beside the depth array even when transmitted
colored shadows are disabled. VSM adds distribution/blur targets and passes.

Reject a clipmap when caster content changes broadly every frame, cache reuse is
low, or receiver filtering/bind pressure dominates saved shadow draws. A
localized change near the center of nested full maps can intersect all `L`
levels; level granularity alone does not make that invalidation local.

### Built-in CSM audit

r185 `CSMShadowNode`:

- defaults are source defaults, not recommendations;
- constructs one cloned shadow per cascade at first setup. Later source-shadow
  changes do not propagate automatically, and changing cascade count does not
  rebuild topology; configure before first build or explicitly synchronize and
  dirty/rebuild children;
- captures the first builder camera; use one instance per independent view
  camera. Its light fitting mixes camera world matrices with placeholder-light
  transforms, so require a root/identity-transformed light parent or patch all
  transforms into one world-space convention;
- calls `updateFrustums()` during initialization, but applications must call it
  after camera projection or CSM settings change;
- derives split breaks by uniform, logarithmic, practical, or custom policy;
- fits square cascade bounds and snaps each light-space center by cascade
  texel width/height using `floor`;
- fits XY only; cloned light-camera near/far remain source values and need an
  explicit caster-to-receiver light-depth coverage gate;
- multiplies cloned numeric `bias` by cascade index-plus-one, but cloned
  `biasNode` overrides that number. `LightShadow.copy()` shares that node by
  reference, so every cascade receives the same node unless explicitly
  replaced. It does not derive `normalBias` or world
  filter support, and dynamic `filterNode` is not copied by `LightShadow.clone()`;
- inherits another clone omission: `LightShadow.copy()` does not copy
  `mapType`, so a non-default source color-attachment type is lost. Changing
  `mapType` is not a route to depth32float; that requires an explicit
  FloatType `DepthTexture`/target override;
- derives split-frustum interpolation from normalized `d/f` breaks while the
  receiver selector compares `(d-near)/(far-near)` to those breaks. When near
  is not negligible, validate rendered/selected boundary agreement or correct
  the local addon;
- with `fade = true`, caster-bound expansion normalizes by
  `max(camera.far, maxFar)` while receiver fade uses
  `min(camera.far, maxFar)`. When those differ, patch to one span or Gate the
  rendered/selected overlap with a fixed-scene diagnostic;
- removes placeholder lights on `dispose()`, but r185 does not explicitly call
  `dispose()` on its `_shadowNodes`; base `Node.dispose()` only dispatches an
  event. Treat child-target cleanup as unproven until a renderer memory/recreate
  loop passes. If resources grow, correct the local addon lifecycle before
  deployment rather than depending on garbage collection.

Validate split occupancy, cascade overlap/fade, normal bias, and world penumbra
at each cascade. Do not treat built-in index-scaled depth bias as a complete
bias model.

### Built-in tile audit

r185 `TileShadowNode`:

- partitions the original light shadow camera's orthographic rectangle;
- allocates one depth array whose layer count is tile count;
- creates one subordinate light/shadow node per tile and renders an
  `ArrayCamera` into the array;
- initially allocates from `options.resolution`, then resizes the shared target
  from cloned source-shadow `mapSize` during update. Set the source `mapSize`
  before build and verify the resulting target, or patch the addon;
- builds one render list from objects visible in any subcamera, then r185's
  WebGPU backend loops subcameras for each listed object without a per-tile
  frustum recull; caster work can approach `N * unionVisibleCasterDraws`;
- combines subordinate shadows with `min(...)`. r185 emits `N` coordinate/
  containment tests and conditional filter branches; an interior fragment is
  normally inside one tile, but borders and subgroup divergence can execute
  more. Do not count either one or `N` filters without a target shader/profile;
- updates all tiles when the original shadow updates; it is not a per-tile
  cache;
- has no filter gutter/overlap between depth-array layers, so PCF/PCFSoft
  support can clamp and seam at tile borders;
- warns for `VSMShadowMap` and skips the required blur, so the result is not a
  supported VSM path;
- creates its depth array with strict `LessCompare`, versus core
  `LessEqualCompare`, and has no reversed-depth branch in the r185 source;
- uses a shared `RedFormat` color array and cannot preserve RGBA
  `castShadowNode` transmitted color. Reject transmitted shadows on stock Tile;
- copies layer masks to subcameras but not the outer `ArrayCamera`; validate
  non-default layers because traversal can reject them before subcamera draws;
- reads source world transforms and writes them as local transforms under the
  source parent. Require a root/identity parent or patch with `worldToLocal()`
  conversion to avoid double transforms;
- disposes the shared array target but clears child-node references without
  explicitly disposing each child. Include material/pipeline/resource counters
  in the lifecycle loop instead of assuming the shared-target dispose is the
  complete cleanup proof.

**Gated:** test non-reversed far-boundary coverage, reversed clear/ordering,
tile-filter seams, non-default layers, and multi-camera updates before using the
stock r185 tile node, or correct the local implementation. A lower binding
count does not override comparison correctness.

### Reversed-depth and multi-camera r185 gates

- Core receiver filtering checks `shadowCoord.z <= 1` but not `z >= 0`.
  Reversed-depth receivers beyond the fitted far boundary can therefore reach
  comparison sampling instead of resolving lit. Add/test the missing bound or
  reject that configuration.
- Core shadow maps default to `UnsignedIntType`, mapped by the WebGPU backend to
  `depth24plus`; reversed projection does not thereby gain float32 reversed-Z
  precision. Select a FloatType `DepthTexture`/`depth32float` through an explicit
  target override—not `light.shadow.mapType`—when its quality, filter support,
  memory, and device behavior are Measured.
- On the first reversed shadow update, light-shadow matrices can be computed
  before nested rendering flips/rebuilds the shadow camera projection. Validate
  the first visible frame after creation or projection changes.
- r185 layered depth setup uses `depthClearValue || 1`; reversed clear zero is
  replaced by one. This reinforces the stock Tile reversed-depth blocker.
- Core `ShadowNode` and Tile declare a `WeakMap` for camera/frame throttling but
  index it with bracket syntax. Do not assume correct per-camera cache semantics;
  test multi-camera/multi-viewport updates explicitly.

## WebGPU Preflight

```js
import { WebGPURenderer, ShadowNode, ShadowBaseNode } from "three/webgpu";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { TileShadowNode } from "three/addons/tsl/shadows/TileShadowNode.js";

await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error("Directional shadow contract requires WebGPU");
}
```

Capture a capability/resource manifest after initialization:

- revision and exact import paths;
- renderer depth policy and shadow-map type;
- output resolution and DPR;
- WebGPU device limits for texture dimensions/array layers, sampled textures,
  samplers, bindings per bind group, bind groups, storage resources, and
  uniform/storage alignment;
- compiled material bind layout and all non-shadow resources sharing it;
- timestamp support and the measurement method;
- caster/receiver layer policy and NodeMaterial parity audit.

The backend device is current implementation state. Treat its direct access as
version-gated diagnostics, not portable application API.

For r185 total-render GPU timing, construct `WebGPURenderer` with
`trackTimestamp: true`, then after initialization Gate
`renderer.backend.trackTimestamp === true` and
`renderer.hasFeature('timestamp-query')`. Periodically call
`await renderer.resolveTimestampsAsync('render')`; the returned milliseconds
also populate `renderer.info.render.timestamp`. Resolve before exhausting the
finite query pool, but do not synchronize every frame. This is total render
time, not automatically shadow-only time; isolate the shadow workload or use a
target profiler for pass attribution. Unsupported timing is unavailable, not
zero.

## Workload Model And Breakpoints

Before choosing topology, compute:

```text
V = number of shadow views selected for update
Dv = visible caster draws in view v
Tv = visible caster triangles in view v
Iv = vertex invocations in view v
Cv = covered depth samples in view v
Ov = mean shadow overdraw over those samples
Av = alpha/mask texture and discard work in view v
Pr = receiver pixels shaded by materials evaluating this shadow
F = comparison/gather operations per filter evaluation
E = shadow evaluations per receiver pixel

draw workload      = sum_v(Dv)                 // Derived
triangle workload  = sum_v(Tv)                 // Derived
vertex workload    = sum_v(Iv)                 // Measured/Derived
raster workload    = sum_v(Cv * Ov)            // Measured estimate
                   // or direct fragment invocations, never multiplied again
alpha workload     = sum_v(Av)                 // Measured
receiver operations= sum_pixels(sum_active_e(F_e)) // Derived model
nominal target bytes = sum(width * height * layers *
                           (bytesPerColorTexel + bytesPerDepthTexel))
frame allowance    = 1000 / targetRefreshHz    // Derived ms
```

Use these breakpoints:

- draw/triangle dominated and persistent coverage reusable: caching can win;
- receiver/filter dominated: reduce evaluated levels/tiles or filter cost;
- binding dominated: array packing may win if common dimensions/format and
  array-layer limits fit;
- traversal dominated: spatially partition/proxy caster submission; increasing
  cache levels worsens CPU work;
- raster/alpha/deformation dominated: reduce projected caster coverage,
  overdraw, vertex deformation, alpha fetch/discard, or use bounded proxies;
- broadly dynamic: cache invalidation approaches full redraw, so use one
  fitted view, CSM, or a separated dynamic/static scheme.

For stock r185 Tile, do not estimate `sum_v(independentlyCulledDraws_v)` unless
an instrumented local implementation actually performs that recull. Use the
union render-list count times active layers as the conservative draw model.

The breakpoint is **Measured** where one architecture crosses another on the
target workload; it is not a universal object count.

## Cached Clipmap Representation

A clipmap is a set of concentric or nested directional-light orthographic
domains retained across frames:

```text
ordinary clipmap:
  one persistent depth texture or array layer per level
  no page table
  no physical page allocator
  level-granular invalidation and rendering

virtual shadow map:
  page table and page-granular residency/submission
```

Do not call a level cache a virtual shadow map.

### Level derivation

Given Authored/Derived finest half-width `R0`, scale `s > 1`, and required
half-width `Rmax`:

```text
L = ceil(log(Rmax / R0) / log(s)) + 1 // Derived
Ri = min(R0 * s^i, Rmax)               // Derived
```

Derive `R0` from the smallest required receiver coverage and desired world
texel density. Derive `Rmax` in the plane orthogonal to the light from biased
receiver coordinates plus filter, snap, basis-error, and coverage guards. A
displacement along the light direction projects to zero in that XY plane; its
ray length affects the fitted Z interval, not `Rmax`. Camera far distance alone
is not a complete receiver bound.

Level count is then Gated by adapter bindings/array layers, memory, receiver
filter cost, and measured update debt. Do not start from a fixed level-count
table. `min(..., Rmax)` can create a near-duplicate final level. Gate adjacent
coverage ratio and either let the last power-of-`s` cover `Rmax` or merge the
near-duplicate.

Containment is a Derived inequality, not only an Authored blend percentage.
Define each level's valid sample half-width after subtracting its own filter
support and any additional coverage guard. Per light-space axis require:

```text
validHalfWidth_i = mapHalfWidth_i - filterSupport_i - coverageGuard_i

validHalfWidth_coarse >= validHalfWidth_fine
                         + worstRelativeSnapCenterDelta
```

Derive the snap delta from both quantizers/grid widths and reserve filter
support at every map edge. Do not subtract support into `validHalfWidth` and
then add it again on the right-hand side. Fail configuration when either axis
does not satisfy the inequality.

## Stable Light Basis And Texel Anchor

For normalized light-ray direction `d`, choose a deterministic least-aligned
reference axis `a`:

```text
xLight = normalize(cross(a, d))
yLight = normalize(cross(d, xLight))
zLight = d
```

Declare `d`'s sign; use light-to-receiver ray direction here. A Three.js shadow
camera aimed along `d` views along local `-Z`, so its world-space back axis is
`-d` and its view-space `z` is the negative of this semantic along-ray depth.
Do not silently exchange these conventions in depth fitting or comparison.

Freeze the committed direction and basis while an epoch remains cached. A basis
sign flip, reference-axis switch, or recomputed rotation invalidates every map.
If a sub-threshold direction change is intentionally reused, bound projected
error from scene depth relief and footprint rotation. For every represented
point within distance `B` of the stable anchor, a conservative rigid-basis
displacement bound is `2 * B * sin(deltaTheta / 2)` (**Derived**). Gate that
bound, the resulting light-depth error, and changing occlusion silhouettes
against reserved coverage/filter/bias error; otherwise begin a new basis epoch.
Do not recompute the basis while retaining old depth.

Project global CPU-double positions relative to a stable global/light anchor:

```text
pLight.x = dot(pWorld64 - anchorWorld64, xLight)
pLight.y = dot(pWorld64 - anchorWorld64, yLight)
pLight.z = dot(pWorld64 - anchorWorld64, zLight)
```

Do not derive snapping from a moving camera-relative renderer origin. If the
render origin changes, keep semantic light coordinates stable and update render
transforms atomically.

## Texel Snapping

For committed orthographic bounds and map dimensions:

```text
dx = (right - left) / mapWidth   // Derived world units/texel
dy = (top - bottom) / mapHeight

ix = quantize((desiredX - gridAnchorX) / dx)
iy = quantize((desiredY - gridAnchorY) / dy)

snappedX = gridAnchorX + ix * dx
snappedY = gridAnchorY + iy * dy
```

Use a fixed `floor` or nearest-integer policy. `CSMShadowNode` r185 uses
`floor`; nearest minimizes center error but either is stable when the anchor and
extent are stable. Do not mix policies between levels or frames.

XY snapping stabilizes the projected texel grid. Z does not set that grid.
Fit Z to the complete conservative light-ray envelope. If numeric
`normalBias` moves a receiver lookup from `q` to `q' = q + n * normalBias`,
include the light-space XY and Z displacement of `q'`. Include every relevant
occluder on the rays from those biased receiver positions toward the light:

```text
zNear/zFar = light-space depth interval of biased receiver lookup positions
             union relevant occluders along their required light rays
             + Derived geometric uncertainty
             + Authored/Gated safety margin
```

Reserve the corresponding `abs(normalBias * nLight.x/y)` in XY containment and
filter guards. Apply hysteresis/quantization to the fitted depth interval only
after proving it clips neither receiver lookups nor occluders. A
half-width-derived Z quantum is not generally valid.

## Level State Machine

Keep semantic state explicit:

```ts
type LevelState = {
  halfWidth: number;
  mapWidth: number;
  mapHeight: number;

  desiredCenterLight: THREE.Vector3;
  committedCenterLight: THREE.Vector3;
  committedDepthInterval: { near: number; far: number };

  valid: boolean;
  dirtyReasonBits: number;
  invalidReasonBits: number;
  ageFrames: number;
  updateDebt: number;
  contentEpoch: number;
  renderedContentEpoch: number;
};
```

State meanings:

- **clean/valid**: sampled state matches rendered depth;
- **coverage-dirty/valid**: desired center moved, but the old committed map is
  still correct within its committed domain; continue sampling committed state;
- **content-invalid**: caster content represented by the map changed; do not
  sample stale depth;
- **rendering/commit**: selected state is encoded, then all material-facing
  center/depth/epoch fields publish together.

Before first render, `valid = false`; no sentinel coordinate alone is a
sufficient validity contract.

### Acyclic presentation binding

The route-level schema is the
[physics domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
When the route declares a physics-to-render boundary, for each shadow
preparation batch latch the immutable `PhysicsPresentationCandidate` produced
after simulation and the target/view `CameraViewPublication`. Validate both
exact central schemas and derive caster poses/swept bounds from the domain's
`PresentedStatePair` plus referenced `PhysicsSignalDescriptor`; derive render
mapping and projection only from the camera publication. The
provider solver bracket explains how the current presented state was built but
is not a substitute for adjacent rendered poses.

For a physically sourced directional light, bind
`LightingTransportSnapshot.sourceDirection` through its provider-wide
`PresentedStatePair`. Validate context/provider/signal IDs, directional basis
and support, `PresentationSampleProvenance.requestedPresentationInstant:
PhysicsInstant`, bundle `sampleInstant: PhysicsInstant`, and channel
`actualPhysicsTime: PhysicsTime`, whose discriminant selects exactly one arm
consistent with the descriptor's `timeSemantics`. Validate the declared clock
mapping, maximum staleness, state/resource generations, lease, validity, and
angular error.
Reject a single directional projection when a broad source
distribution exceeds its declared approximation gate. A nonphysical route
leaves this binding `not used` and declares an authored light basis.

Cache ownership does not move to the route. This shadow system remains the sole
writer of every level's desired/dirty/invalid/rendered/committed state and keeps
`shadowContentEpoch`, `shadowCommittedEpoch`, and desired-coverage debt as
owner-internal state. Do not define a shadow-local ABI. On an accepted commit,
map them into the exact central records: return a `shadowViewPublicationRefs`
entry containing `shadowOwner`, `shadowViewId`, `cameraProjectionRevision`,
`shadowContentEpoch`, `resourceLeaseRefs`, and `boundedDelay`, plus one
`ReactivePublication` with `kind: shadow-content`, `sourceVersion` equal to the
committed epoch, canonical `affectedRegion`, `resourceLeaseId`, validity/error,
and `plannedConsumerActions`. Also return a versioned shadow-visibility factor ID;
downstream lighting/render-radiance provenance includes it exactly once in
`attenuationFactorIds` rather than mutating the already published lighting
snapshot.

The preparation owner emits a new immutable `ViewPreparationPublication` with
the shadow refs, `reactivePublications`, `resetDependencies`, and
full `resourceLeases` for newly created camera-dependent shadow/cache
generations plus `resourceLeaseRefs`; the assembler then seals
`PhysicsPresentationSnapshot`.
Visible receivers, scene radiance, temporal rejection, and diagnostics resolve
that state through `viewPreparationId`. Candidate, camera publication,
preparation publication, and Snapshot remain immutable. A cache update encoded after
sealing is both visible and publishable only for the next frame; the current
frame continues sampling the prior committed resource named by its snapshot.

That deferred schedule requires double buffering: render the update into an
inactive resource generation while the prior generation remains pinned, then
atomically publish/swap it in the next sealed snapshot. Without an inactive
generation, suppress the late update. Rendering in place through a normal
render hook would make current receivers sample content newer than their sealed
snapshot and is forbidden. Same-presentation shadow work must run and commit
before sealing.

Publications are keyed by presentation target, view/camera, light, and
projection epoch. They cannot be reused across a different camera merely
because the light and texture match. The resource generation/layout/layer and
lease remain pinned until every consumer has submitted and the central
`PresentationResourceLease.reuseProhibitedUntil` condition is satisfied;
retirement is recorded in `FrameExecutionRecord.leaseDispositionById` with its
completion join/evidence. Logical
content version, resource generation, submission epoch, GPU queue availability,
and host visibility are distinct records; `computeAsync()` or command encoding
is not a completion fence. Device loss invalidates resources and leases from
the lost generation, not the immutable publication records that reference them.

`shadowContentEpoch` advances when light, caster, alpha/deformation, resource,
or content-affecting quality dependencies change. Desired camera/snapped-center
coverage has a separate desired-coverage epoch/update debt. It does not advance
content or trigger a radiance reset while the prior committed containment
remains valid. `shadowCommittedEpoch` advances only
after a valid matching render commit. When content is invalid but not repaired,
the level remains unsampled/invalid; advancing only the content epoch cannot
authorize stale depth. On a new commit, publish conservative changed *receiver*
coverage in stable physics-frame metres or the central mask descriptor. Derive
it by extruding old and new occluder silhouettes along the light over the
committed receiver domain, then dilate for filter/normal-bias footprint,
projection/reprojection uncertainty, and the temporal neighborhood. A moved
caster's swept AABB alone is not a receiver-radiance bound. If this proof or a
leased aligned mask is absent, publish `affectedRegion: full-frame` and reset
the affected radiance history.

A render-origin change alone does not change semantic shadow content. Apply the
previous/current `RenderSimilarityTransform`s from `CameraViewPublication` and
verify identical light-space coordinates within the declared error. A
physics-origin change is different: preserve cached depth only when the
accepted `PhysicsOriginRebaseTransaction` includes caster, receiver, contact,
and cache state and passes light-space/round-trip error gates. Otherwise
invalidate the affected levels and temporal receivers. A missing/incompatible
transform or a real caster/light change also invalidates maps.

## Update Scheduling

Dirty causes are not equal:

1. **correctness invalidation** — stale caster content; refresh before sample or
   disable that level until repaired;
2. **light-basis epoch** — all maps incompatible; refresh coherently or disable
   unrefreshed levels;
3. **never rendered / invalid resource** — cannot sample;
4. **coverage miss risk** — committed domain no longer covers required
   receiver/caster rays;
5. **age/quality refresh** — still correct but below Authored freshness target.

Ordinary age refresh uses a Gated update-debt budget. Correctness invalidation
bypasses that queue but still needs spike control: coalesce changes, prioritize
visible receiver coverage, and invalidate-to-lit when a same-frame refresh
would exceed the separately Gated correction queue. Never leave stale geometry
silently shadowing.

Stagger age targets only after they are Derived/Authored. Age staggering does
not solve synchronized streaming or light-epoch invalidation.

### CPU/GPU scheduling boundary

`ShadowNode.updateBefore()` is CPU orchestration. A dirty mask written by GPU
compute cannot choose CPU render calls without readback. Valid paths:

- CPU chunk generation counters plus spatial hash/BVH produce affected level
  bits and selected renders;
- CPU selects levels, while GPU compute compacts per-level caster/instance data
  consumed without CPU readback;
- a fully GPU-driven indirect design owns both compaction and draw dispatch,
  which is a different architecture and must be validated as such.

Do not specify “GPU dirty bits consumed in `updateBefore()` with no readback.”

## Atomic Render And Hook Architecture

Two r185 implementation shapes are viable:

### Composite `ShadowBaseNode`

- create one child `ShadowNode`/cloned shadow per level;
- share or pack render targets deliberately;
- suppress independent child scheduling;
- composite `updateBefore()` selects levels and delegates state-safe shadow
  updates;
- composite `setup()` samples/blends child outputs.

This resembles the built-in CSM/tile structure and reuses r185 shadow-material,
caster, and renderer-state handling.

### Specialized `ShadowNode`

- override target/filter graph creation for multiple levels;
- override `updateShadow()` or carefully manage all state that the base method
  assumes is single-target;
- preserve override material, caster callback, MRT/velocity, camera layers,
  clear state, render target, and renderer/scene restoration.

Overriding only `renderShadow()` is insufficient when multiple targets need
independent state unless the surrounding single-target assumptions are
reconciled.

After `await renderer.init()`, use synchronous `renderer.render()` for the
scheduled shadow views; r185 deprecates `renderAsync()`. “Commit after render”
means after the commands for that map have been encoded in queue order and
state restored, not after a CPU-blocking GPU completion.

Commit sequence:

1. freeze selected desired center, depth interval, basis epoch, and content
   epoch;
2. configure level light/camera and update matrices;
3. render caster depth into the owned target/layer;
4. restore renderer/scene/camera-layer state;
5. atomically publish committed center, interval, resource identity, and
   rendered epoch;
6. set `valid = true`, clear satisfied reasons, and reset debt/age.

7. return the canonical `shadowViewPublicationRefs` entry,
   `ReactivePublication`, resource lease refs, and factor ID for a new
   `ViewPreparationPublication`; never mutate an earlier publication or sealed
   Snapshot.

Append the actual render/submit/commit/failure and reset execution to
`FrameExecutionRecord`. `ViewPreparationPublication.resetDependencies` remains
the immutable plan and is not edited to report completion.

If render submission fails, retain the previous valid commit only when it still
represents correct content and the route's declared degradation permits it;
otherwise keep the level invalid. If a required valid shadow cannot be supplied
before sealing, append a `FrameExecutionRecord` with `overallStatus: aborted`
(or `partial-failure` when another target survives), exclude the failed target
from `snapshotIds`, store typed absence in its target execution's `snapshotId`,
cancel or defer actions, retire only failed-target-exclusive preparation
leases, and retain Candidate leases until every surviving snapshot consumer
joins through `leaseDispositionById`. Device loss appends `overallStatus: device-lost` and
affected target statuses `device-lost`,
advances `deviceLossGeneration`, cancels actions, and invalidates resources and
leases from the lost generation without mutating Candidate/Snapshot records or
inventing a normal completion token. Rebuild under the new generation.

## Cross-Level Containment And Sampling

Use committed state only. In the shared light-space XY plane:

```text
di = max(abs(x - committedXi), abs(y - committedYi))
inneri = sampledHalfWidthi * (1 - authoredBlendRatioi)
fi = 1 - smoothstep(inneri, sampledHalfWidthi, di)

wi = fi * remaining
remaining *= (1 - fi)
```

Accumulate fine to coarse. `valid = false` forces `fi = 0`. Remaining weight is
fully lit unless a separately authored outer shadow representation owns it.

Choose one receiver topology explicitly:

1. **Portable independent textures** — bind `L` depth textures, evaluate all
   `L` comparison filters unconditionally, then weight. This avoids dependence
   on divergent derivative-uniformity behavior but costs `L * F` filter work.
2. **Static conditional textures** — compute all containment tests and branch
   around the active independent-texture filter(s). r185 `ConditionalNode`
   normally emits real `if/else`, but its WGSL builder disables
   `derivative_uniformity` diagnostics on common UAs. Treat this as
   revision/UA/adapter-gated; subgroup divergence can serialize levels.
3. **Array/atlas selection** — compute the fine/coarse layer indices first and
   issue one comparison call, or two during cross-fade, with dynamic layer
   selection. This reduces texture bindings and filter work but requires common
   format/dimensions, target-proven dynamic indexing, and filter gutters or
   neighbor handling at every packed boundary.

The one/two-layer claim requires a stronger nested-fade invariant than outer
containment. For each fine level and the next valid coarse level require, per
axis,

```text
fineOuter + worstRelativeSnapCenterDelta <= coarseInner
```

so the coarse weight is exactly one throughout the fine fade and terminates
the recursive remainder. Recheck against the next surviving level when an
intermediate level is invalid. If the invariant fails, three or more levels can
have nonzero weight; sample them or change the domains/fades rather than
silently dropping weight.

r185 base `ShadowNode.setupShadowFilter()` constructs a conditional for
`x,y in [0,1]` and `z <= 1`; it omits `z >= 0`. It is not evidence that every
filter is evaluated unconditionally. Validate the generated shader and add a
near-depth bound/test in custom containment.

## Filter Footprint Audit

r185 `ShadowFilterNode.js` defines:

| Renderer shadow type | Source operation count | Footprint control |
| --- | --- | --- |
| `BasicShadowMap` | one comparison sample | one lookup; hardware behavior still backend dependent |
| `PCFShadowMap` | five Vogel-disk comparison samples plus IGN and dynamic trigonometric rotation | `radius / mapSize.x`; same scalar applied to both UV axes |
| `PCFSoftShadowMap` | four gather-compare operations combined as a weighted local reconstruction | fixed by map texel grid; `shadow.radius` is not read |
| `VSMShadowMap` | receiver distribution sample plus two full-map blur passes, each performing `blurSamples` fetches per output | `radius`, `blurSamples`, distribution-map resolution; stock r185 Tile warns and skips required blur |

VSM caster submission in r185 includes `receiveShadow` objects as well as
`castShadow` objects. Include that expanded draw/raster workload and both blur
fetch loops in its budget.

With PCF hardware linear comparison, the r185 source describes five samples as
an effective twenty filtered taps. Treat that as an algorithm/source count, not
a universal physical texture-transaction count. r185 disables
`Compatibility.TEXTURE_COMPARE` for Android user agents, where PCF becomes five
nearest sampled comparisons implemented as ordinary sample-plus-step. Gate
quality, footprint, ALU, and texture cost by actual UA/adapter compatibility.

For square isotropic PCF levels:

```text
worldTexel_i = (2 * halfWidth_i) / mapSize_i                // Derived
nominalSampleScale_i = shadow.radius_i * worldTexel_i       // Derived
```

The outer Vogel center is inside the nominal scale, while hardware-linear
comparison adds its texel footprint. Derive conservative support `(rhoX,rhoY)`
from the exact pattern and backend before solving an Authored world softness,
guard, or bias. For rectangular maps/domains, use separate `dx/dy` in a custom
filter or accept and document anisotropy; r185 PCF's x-based scalar is not
isotropic by itself.

Cross-fade levels with materially different world footprints can show rings
even when containment weights are smooth. Diagnose filter footprint before
changing blend width.

## Bias Model

r185 applies:

```text
shadowPositionWorld += normalWorld * normalBias
comparisonDepth = projectedDepth +/- (biasNode || bias)
```

The comparison sign changes with reversed depth. Therefore:

- `normalBias` has world-distance units along the receiver normal;
- `bias`/`biasNode` has normalized shadow-depth units;
- `biasNode` replaces numeric `bias`;
- map fit determines how a normalized depth offset maps to world light-depth;
- filter world radius and receiver slope determine how much self-occlusion
  uncertainty a bias must cover.

A useful dimensional bound is:

```text
depthWorld_i >= abs(dz/dx) * rhoX
              + abs(dz/dy) * rhoY
              + rasterAndQuantizationError                  // Derived bound
biasMagnitude_i = depthWorld_i / (farLight_i - nearLight_i) // Derived
```

r185 adds numeric bias for normal depth with `LessEqual` and subtracts it for
reversed depth with `GreaterEqual`; negative values move the receiver toward
lit in both conventions, positive values toward shadow. Validate magnitude.
Derive any normal offset separately and Gate it with contact-detachment tests.
Clamp grazing-angle behavior; an unbounded slope is not robust. Separate tests:

- front-facing plane acne;
- grazing receiver acne;
- thin-contact detachment/peter-panning;
- cascade/level boundary consistency;
- reversed-depth ordering.

Do not increase map resolution until projection fit and bias dimensions are
correct.

## Targeted Invalidation

Maintain caster dependency versions for:

- transform and previous transform;
- geometry/buffer and LOD identity;
- visibility, layers, `castShadow`, side/cull policy;
- alpha map, threshold, mask, dissolve/coverage inputs;
- deformation time/version and conservative envelope;
- asset/chunk generation and removal.

For a changed caster:

1. compute conservative previous and current world bounds including deformation;
2. union or sweep them so vacated and newly occupied shadow depths update;
3. transform the bound to the stable light frame;
4. intersect against each level's committed and desired receiver/caster domain;
5. mark content-invalid reasons and increment content epoch;
6. coalesce overlaps before scheduling.

A projected sphere/square test is acceptable when its over-invalidation cost is
Measured below exact OBB/frustum tests. The correct breakpoint is workload
dependent.

For nested full maps, a central bound commonly intersects every level. If that
forces `L` full redraws, separate dynamic casters into a near/overlay path, use
nonoverlapping ring ownership/proxies, or move to tiled/paged partial residency;
do not call the invalidation “localized” merely because its input bound is.

Keep a dynamic overlay inside the same light/shadow node; adding a second
`DirectionalLight` duplicates illumination. For opaque binary visibility and
matched light-plane taps, exact union filtering is:

```text
V = sum_k(weight_k * Vstatic_k * Vdynamic_k)
```

Use `Vdynamic_k = 1` outside overlay coverage. Taking `min()` or multiplying
already-filtered averages is not generally equivalent and requires a declared
quality gate. Transmitted/color shadows require their own composition model.

Events and depth redraw dependency:

| Event | Redraw depth? | Other action |
| --- | --- | --- |
| receiver-only transform | no for comparison depth while committed coverage remains valid | recompute lookup/coverage; r185 VSM is exceptional because its caster submission also includes `receiveShadow` objects |
| numeric/filter bias or fade change | usually no | rebuild/update sampling graph/uniforms |
| caster transform/deformation/coverage | yes, affected levels | swept invalidation |
| light direction/basis | yes, all retained levels | new basis epoch |
| map dimensions/format | yes | recreate resources and invalidate |
| renderer origin epoch | not semantically, if transformed consistently | atomically update render transforms; invalidate temporal consumers if uncompensated |

## Caster And Receiver Parity

r185 position spaces are not interchangeable.

Correct local caster deformation:

```js
const displacedLocal = Fn(() => {
  // Return local-space position after the shared deformation inputs.
  return positionLocal.add(localOffsetNode);
})();

material.positionNode = displacedLocal;
material.castShadowPositionNode = displacedLocal;

// Normal receiver lookup already uses world-space position:
material.receivedShadowPositionNode = null;
```

If a receiver lookup truly needs modification:

```js
material.receivedShadowPositionNode = customWorldSpaceReceiverPosition;
```

That node must be world-space and is validated separately. Assigning the local
`positionLocal` deformation node to `receivedShadowPositionNode` is a space
error in r185.

Additional parity:

- NodeMaterial applies morph, skinning, displacement map, batching, and
  instancing before `positionNode`; a custom node must compose rather than
  erase required transforms.
- The r185 shadow material path falls back from `castShadowPositionNode` to
  `positionNode`, so explicit duplication is optional when both are identical;
  identity is useful as a validation assertion.
- Coverage must share alpha/map/color alpha, `alphaTest`,
  `maskNode`/`maskShadowNode`, and `castShadowNode` semantics as applicable.
- A simplified caster proxy is valid only with a documented silhouette-error
  bound and validation views.
- Separate static and dynamic caster sets when it lowers measured traversal and
  invalidation cost; do not duplicate a caster into overlapping shadow paths
  without defining composition.

## Binding And Memory Pressure

Count complete material bindings, not shadow resources in isolation.

### Per-level textures

- independent dimensions/formats and easy previews/disposal;
- at least one sampled depth-texture binding per level;
- binding/sampler deduplication depends on compiled graph/backend;
- independent render targets simplify partial update.

### Array depth texture

- one texture binding with `L` layers when dimensions/format match;
- nominal color-plus-depth target allocation still scales with layer count;
- independent per-layer update, preview, and ownership require explicit code;
- array layer and texture-dimension device limits apply;
- filter nodes need correct `depthLayer` handling.

Nominal comparison-target memory lower bound:

```text
Mtarget = sum_i(width_i * height_i * layers_i *
                (bytesPerColorTexel_i + bytesPerDepthTexel_i)) // Derived
```

r185 allocates the base color attachment even when transmitted shadows are
disabled. Add VSM distribution/blur targets, mip levels when used, debug copies,
and allocator padding. Nominal bytes are not observed GPU allocation; record
both when tooling permits.

**Gated:** leave adapter/product headroom for material textures, environment,
MRT/post, storage, and transient resources. Reaching the reported maximum is
not a safe budget.

## Sustained Mobile Budget Protocol

Absolute timings in a reference are fictitious. Establish:

1. **Authored** target resolution, DPR, refresh goal, shadow coverage, visual
   penumbra, and worst interaction/streaming trace.
2. **Derived** frame allowance `1000 / targetRefreshHz` and workload counts
   `V`, `Dv`, `Tv`, `Pr`, `E`, `F`, resource bytes, and bind usage.
3. **Gated before capture**: independent CPU, GPU, presented-frame, peak-memory,
   and spike/headroom budgets plus correctness gates for stale content,
   coverage, resources, and caster spaces. CPU and GPU time overlap; do not add
   them into one steady-frame number.
4. **Measured** after warmup and thermal stabilization: CPU/GPU frame
   quantiles, shadow update quantiles/spikes, receiver/filter coverage,
   update-debt/age distribution, invalidation burst, draw/triangle/vertex
   counts, raster coverage/overdraw, alpha/discard and filter ALU, clear/pass
   transitions, CPU traversal/cull time, allocations, and presented/dropped
   frames.
5. Compare the Measured trace against those predeclared gates. The trace cannot
   define the threshold that it is used to pass.

Exercise steady camera motion, stationary cached reuse, rapid coverage change,
localized and burst invalidation, light-basis epoch, resize/DPR change, and
dispose/recreate. A good average with periodic cache expiry spikes does not
pass.

Optimize the Measured bottleneck. Update/draw-bound traces need tighter
coverage, fewer casters/views, less overdraw, or lower valid refresh cadence.
Receiver/filter-bound traces need fewer active filters or lower texture/ALU
cost. Binding/memory-bound traces need fewer resources or different packing/
formats. Traversal-bound traces need spatial ownership/culling. Do not lower
update cadence to solve receiver cost, and do not raise resolution before fit,
snapping, support, and bias are correct.

## Diagnostics

Expose:

```text
architecture and decision-record measurements
revision, WebGPU backend, depth policy, shadow-map type
adapter limits and compiled bind layout
per view: caster draws, triangles, depth interval, render reason
per level: desired/committed center, grid anchor, dx/dy, validity, epochs
coverage-dirty versus content-invalid reason bits
update debt, age, correction queue, dropped/merged invalidations
map/layer identity, dimensions, format, nominal/observed allocation
filter type, operation count, texel/world footprint
numeric bias, biasNode output, normal bias, slope clamp
cross-level containment weights and remaining lit weight
caster local-position identity and receiver world-position override
renderer/scene state restoration and disposal counters
Measured sustained CPU/GPU frame and shadow-update quantiles
```

Failure diagnosis:

```text
slow-motion crawl:
  moving grid anchor, unsnapped center, changing extent, or basis epoch churn

boundary flicker:
  desired state published before matching map commit, invalid level selected,
  or inconsistent filter footprint/bias across the blend

detached contacts:
  excessive world normal bias or wrong comparison-depth bias sign

acne at coarse levels:
  bias/filter footprint not derived from world texel/depth span

stale silhouettes/ghost shadows:
  content invalidation treated as ordinary age refresh or previous bound omitted

caster looks correct but receives shifted shadows:
  local deformation incorrectly assigned to receivedShadowPositionNode

tile shadows invert under reversed depth:
  r185 TileShadowNode LessCompare array setup was not reconciled/validated

GPU update scheduler stalls on readback:
  GPU dirty mask was incorrectly made a prerequisite for CPU updateBefore

memory grows across view replacement:
  custom attachment, child nodes/shadows, array targets, storage, or debug
  resources were not detached/disposed
```

## Validation Matrix

- bounded-view baseline against the custom architecture at identical projection
  and filter;
- slow sub-texel and cross-texel camera motion;
- changing orthographic extent without changing grid-anchor semantics;
- caster at every XY edge and light-depth boundary;
- front-facing/grazing/thin-contact bias scenes;
- cross-level filter-footprint and fade visualization;
- localized caster transform using previous/current swept bounds;
- broad deformation proving the cache is rejected or separated;
- light-direction changes below/above the declared basis epoch;
- origin rebase while semantic light coordinates remain stable;
- CSM projection mutation followed by `updateFrustums()`;
- tile depth-order test under the selected renderer depth mode;
- adapter-limit/bind-layout manifest at every quality policy;
- sustained target-device trace including expiry and invalidation spikes;
- dispose/recreate loop with balanced resource counters.

The canonical fixture lives at
`examples/webgpu-cached-clipmap-shadow/`. Its validation must assert the r185
space contract: local `positionNode === castShadowPositionNode`, while
`receivedShadowPositionNode` is null or a separately validated world-space
node. It must also distinguish renderer-call count, shadow-view count, and
receiver filter evaluation; these are not interchangeable cost metrics.

The checked-in Phase 1 fixture is a scheduler/resource scaffold, not yet proof
of a production receiver graph: its builder-enabled `setupShadowCoord()` and
`setupShadowFilter()` currently delegate to the base single-map `ShadowNode`,
while the manually rendered level targets are exposed only to CPU diagnostics.
Do not ship or copy it as a complete clipmap until a real material graph samples
every committed level matrix/depth resource, blends the weights above, and a
visible receiver capture proves that moving/cached levels affect illumination.

## Rejected Patterns

- custom-first clipmap design;
- calling tile layers “cached tiles”;
- using renderer-call count as shadow-view cost;
- publishing desired centers before render commit;
- snapping relative to a moving camera origin;
- deriving Z quantization from XY half-width without receiver/occluder
  light-ray proof;
- fixed normal/depth bias across incompatible world texel/depth spans;
- fixed texel filter radius presented as constant world softness;
- local caster deformation in a world-space receiver hook;
- GPU dirty flags consumed by CPU scheduling without readback;
- copied millisecond budgets or map profiles without target evidence.
