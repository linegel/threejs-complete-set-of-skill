# Directional Shadow Architecture And Cached Clipmaps

This reference contains branch-specific Three.js r185 WebGPU/TSL mechanisms.
A cached clipmap is the last architecture in the decision sequence. Labels mean:
**Derived** from bounds/equations, **Authored** intent, **Gated** limits, and
target **Measured** evidence.

The baseline is opaque comparison depth. A transmitted-color or VSM cache also
owns its color/distribution targets, blur/filter passes, blending, and every
content invalidation; reject that branch until the complete graph is captured.

## r185 source gates

```js
import { WebGPURenderer, ShadowBaseNode, ShadowNode } from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { TileShadowNode } from 'three/addons/tsl/shadows/TileShadowNode.js';
```

The installed r185 path exposes these contracts:

| Interface | Contract |
| --- | --- |
| `AnalyticLightNode.setupShadow()` | Uses `light.shadow.shadowNode` when defined; otherwise builds the default node. |
| `ShadowBaseNode.setupShadowPosition()` | Resolves world-space receiver lookup through `receivedShadowPositionNode` or `positionWorld`. |
| `ShadowNode.setupShadow()` | Creates the target/filter graph and applies `normalBias` before projection. |
| `setupShadowCoord()` / `setupShadowFilter()` | Apply `biasNode || bias` and receiver containment/filtering. |
| `updateBefore()` / `updateShadow()` / `renderShadow()` | Schedule, preserve renderer state, submit casters, update matrices, and render the selected target. |
| `positionNode` / `castShadowPositionNode` | Local-space visible/caster geometry hooks. |
| `receivedShadowPositionNode` | World-space receiver lookup hook. |
| `maskShadowNode` / `castShadowNode` | Shadow coverage/color overrides. |

Attach a custom node before the first affected graph builds:

```js
light.shadow.shadowNode = customShadowNode;

// Restore default selection during detach.
if ( light.shadow.shadowNode === customShadowNode ) {
  delete light.shadow.shadowNode;
}
```

Deletion matters because r185 tests `!== undefined`; `null` is still selected.
`AnalyticLightNode` caches the selected shadow graph, so runtime attach/detach
requires every affected material/light graph and pipeline to rebuild, followed
by a disposal/recreation check.

### Core and depth convention

- Core receiver containment tests `x,y in [0,1]` and `z <= 1`, but omits
  `z >= 0`. Add and test the missing bound in custom filtering.
- Numeric `bias` is ignored when `biasNode` exists. Reversed depth flips the
  comparison-bias operation.
- Default core shadow depth maps to `depth24plus`; `light.shadow.mapType` does
  not request `depth32float`. A float-depth path needs an explicit target/depth
  texture plus filter/device evidence.
- First-use reversed matrices, far-boundary containment, non-default layers, and
  multi-camera updates need fixed-scene diagnostics. r185 camera throttling uses
  a `WeakMap` through bracket indexing, so per-camera behavior is not assumed.
- Core targets retain a color attachment beside depth. VSM adds distribution
  targets and two blur passes; its caster submission also includes
  `receiveShadow` objects.

### `CSMShadowNode` audit

- It builds `L` placeholder lights with cloned shadows/views/targets and captures
  the first builder camera. Use one CSM instance per independent view.
- It snaps cascade centers, fits XY, and retains source near/far. Validate every
  caster-to-receiver light-depth ray per cascade.
- Call `updateFrustums()` after camera projection or split settings change.
  Later source-shadow changes and cascade-count changes do not fully propagate;
  configure before build or synchronize and rebuild children.
- Clone scaling changes numeric `bias` only. A cloned `biasNode` overrides it;
  the same node reference is shared across clones; `filterNode` is not cloned;
  `normalBias` and world filter support are not derived.
- `LightShadow.copy()` omits `mapType`; non-default source color-target type is
  lost. Depth precision still requires an explicit depth target.
- A transformed light parent mixes world and local assumptions. Require a root/
  identity parent or patch all fitting into one world convention.
- Breaks are stored as distance/`far`, while receiver selection normalizes
  `(distance - near) / (far - near)`; non-negligible `near` can misalign rendered
  and selected spans. Fade fitting uses `max(camera.far, maxFar)` while receiver
  selection uses `min(camera.far, maxFar)`. Align each pair to one span or reject
  the configuration.
- Disposal removes placeholder lights but does not prove child target cleanup.
  A dispose/recreate plateau is the lifecycle gate.

### `TileShadowNode` audit

- Tile partitions one orthographic footprint into `N = tilesX * tilesY` array
  layers. One `ArrayCamera` renderer invocation still produces `N` backend layer
  passes.
- r185 builds one union-frustum render list, then can draw each listed caster in
  every layer. It does not independently recull that list per tile.
- Receiver code emits `N` containment/conditional filter branches. One interior
  fragment normally selects one tile, but borders and subgroup divergence can
  execute more. Inspect the generated shader/profile before counting filters.
- All layers update together. There is no per-tile persistence scheduler.
- The depth array has no filter gutter. Validate PCF/PCFSoft at every border.
- Stock Tile rejects VSM, uses a shared Red color array, and cannot preserve RGBA
  transmitted shadows.
- Its depth array starts with `LessCompare` and has no reversed-depth branch.
  Layered clear uses `depthClearValue || 1`, so reversed zero becomes one.
  Stock reversed-depth Tile remains rejected until corrected and captured.
- `options.resolution` is later overwritten by the cloned source `mapSize`.
  Set/verify the source size or patch the addon.
- Layer masks copy to subcameras but not the outer `ArrayCamera`; test non-default
  layers. Source world transforms are written under the source parent as local
  transforms; use a root/identity parent or correct with world-to-local mapping.
- Shared target disposal does not prove child-node cleanup; include child graph,
  material, and target counters in the lifecycle loop.

### Capability and timing gate

After `renderer.init()`, record the exact revision/imports, depth policy, target
types, output resolution/DPR, texture/binding/sampler/layer limits, compiled
material bind layout, non-shadow resources sharing it, layer policy, and caster
parity. Backend device access is version-gated diagnostic state.

For r185 total-render GPU timing, construct `WebGPURenderer` with
`trackTimestamp: true` before initialization, then require both backend tracking
and `timestamp-query`. Resolve periodically with
`renderer.resolveTimestampsAsync('render')`; it is total render time, not
automatic shadow-pass attribution. Unsupported timing is unavailable, not zero.

## Projection, filter, and bias

A directional map stores the first caster depth along parallel rays. Correctness
requires independent agreement in coverage, caster silhouette, sampling, and
time. Resolution cannot repair a clipped ray, stale content, coordinate error,
or divergent alpha coverage.

A source whose angular support exceeds the declared single-direction
approximation gate needs a different light/shadow model; one orthographic
direction cannot silently represent it.

### Stable basis and coverage

For normalized light-to-receiver direction `d`, choose a deterministic least-
aligned axis `a`:

```text
xLight = normalize(cross(a, d))
yLight = normalize(cross(d, xLight))
zLight = d
```

Declare the direction sign. A Three.js shadow camera looks along local `-Z`, so
its view-space depth sign differs from semantic along-ray depth. Freeze basis and
sign while maps remain cached. A basis/reference-axis switch invalidates every
map. For an intentionally reused small rotation `deltaTheta`, a point within
distance `B` moves by at most:

```text
2 * B * sin(deltaTheta / 2)
```

Gate that displacement, light-depth error, and silhouette change against
reserved support; otherwise start a new basis epoch.

Project global positions relative to one stable double-precision anchor:

```text
pLight.x = dot(pWorld - anchorWorld, xLight)
pLight.y = dot(pWorld - anchorWorld, yLight)
pLight.z = dot(pWorld - anchorWorld, zLight)
```

A renderer-origin rebase updates render transforms atomically while semantic
light coordinates remain stable. A scale or physical-frame change is a content
change unless an exact handoff proves equivalent coordinates.

### Level sizing and texel snapping

For finest half-width `R0`, scale `s > 1`, and required `Rmax`:

```text
L  = ceil(log(Rmax / R0) / log(s)) + 1
Ri = min(R0 * s^i, Rmax)
```

Derive `R0` from required receiver coverage and world texel density. Derive
`Rmax` from biased receiver coordinates plus filter, snap, basis-error, and
coverage guards. Merge a near-duplicate last level. Gate `L` by bindings/layers,
memory, receiver cost, and update debt.

For committed bounds and map size:

```text
dx = (right - left) / W
dy = (top - bottom) / H

centerX = anchorX + quantize((desiredX - anchorX) / dx) * dx
centerY = anchorY + quantize((desiredY - anchorY) / dy) * dy
```

Use one `floor` or nearest policy across levels and frames. XY snapping controls
the projected grid. Fit Z independently to biased receiver lookup positions and
every relevant occluder on their rays:

```text
z interval = receiver lookups union required occluders
             + geometric uncertainty + declared guard
```

Include the XY/Z displacement caused by `normalBias`. Apply Z hysteresis only
after proving it clips neither receiver nor occluder.

### Filter support

| r185 type | Source work | Footprint |
| --- | --- | --- |
| `BasicShadowMap` | one comparison sample | backend comparison behavior |
| `PCFShadowMap` | five Vogel comparison samples; hardware linear comparison is described as twenty filtered taps | `radius / mapSize.x` for both UV axes |
| `PCFSoftShadowMap` | four gather-compare operations | fixed by texel grid; ignores `radius` |
| `VSMShadowMap` | receiver distribution sample plus two `blurSamples` fetch loops | distribution target, radius, blur count |

Android compatibility can replace PCF hardware comparison with ordinary sample-
plus-step. Validate the actual UA/adapter. For PCF:

```text
worldTexelX = domainWidth / mapWidth
worldTexelY = domainHeight / mapHeight
nominalSampleScale = radius * worldTexelX
```

The outer Vogel center lies inside the nominal scale and hardware-linear compare
adds a bilinear footprint. Derive conservative anisotropic support `(rhoX,rhoY)`
from the active pattern/backend. Match Authored world softness across fades and
reserve support inside each level/tile boundary. Rectangular r185 PCF is
anisotropic because its scalar uses map width; use a custom two-axis filter or
accept the measured result explicitly.

### Bias model

r185 applies world normal offset before projection, then normalized depth bias:

```text
shadowPositionWorld += normalWorld * normalBias
comparisonDepth = projectedDepth +/- (biasNode || bias)
```

`normalBias` has world-distance units; `bias` has normalized light-depth units.
For receiver-plane slopes:

```text
depthWorld >= abs(dz/dx) * rhoX
              + abs(dz/dy) * rhoY
              + rasterAndQuantizationError
biasMagnitude = depthWorld / (farLight - nearLight)
```

In r185, negative numeric bias moves toward lit for both normal and reversed
comparison conventions; validate sign and magnitude. Clamp grazing behavior and
derive normal offset separately. Test front-facing acne, grazing acne, thin-
contact detachment, cross-level consistency, and reversed ordering.

## Cached clipmap state and sampling

An ordinary clipmap retains one full depth map/layer per level. It has no page
table or page allocator; page-granular residency is a different architecture.

### State machine

Keep material-facing state explicit:

```ts
type ShadowResourceState = {
  targetId: string;
  generation: number;
  layer: number;
  matrix: Mat4;
  basisEpoch: number;
};

type LevelState = {
  coverageOwner: CoverageOwner;
  desiredCenterLight: Vec3;
  renderedCenterLight?: Vec3;
  committedCenterLight?: Vec3;
  desiredDepthInterval: Interval;
  renderedDepthInterval?: Interval;
  committedDepthInterval?: Interval;
  renderedResource?: ShadowResourceState;
  committedResource?: ShadowResourceState;
  dirtyReasonBits: number;
  invalidReasonBits: number;
  contentEpoch: number;
  renderedContentEpoch?: number;
  committedContentEpoch?: number;
  valid: boolean;
  ageFrames: number;
  updateDebt: number;
};
```

`coverageOwner` is one target/view/light key or an explicit shared-union domain
covering every consumer. One view's valid commit does not authorize another
unless its required rays and projection/filter contract are covered.

- **clean/valid:** committed state matches sampled depth.
- **coverage-dirty/valid:** desired coverage moved while the old committed domain
  still covers required rays; keep sampling committed values.
- **content-invalid:** light/caster/resource content changed, or required rays
  escaped committed coverage; remove the level from containment immediately.
- **rendered/uncommitted:** an inactive generation contains the selected request
  but is not material-visible.
- **committed:** center, interval, matrix, target/layer, and content epoch publish
  atomically.

First-use state is invalid. A desired or scheduled center is never sampled as
committed state.

### Scheduling and atomic commit

Priority is:

1. content correctness invalidation;
2. light-basis epoch;
3. never-rendered or invalid resource;
4. coverage miss risk;
5. age/quality refresh.

Correctness repair bypasses ordinary age debt. Coalesce changes and prioritize
visible receiver coverage; when the bounded correction queue cannot refresh in
time, mark coverage invalid-to-lit rather than sample stale depth.

Coverage motion inside the committed domain changes desired state and debt only;
it does not advance content epoch or invalidate temporal radiance until a new
map commits or containment fails.

Commit sequence:

1. freeze desired center, depth interval, basis epoch, content epoch, and target;
2. configure camera/light matrices;
3. render caster depth;
4. restore render target, scene override, clear state, camera layers, and hooks;
5. publish the matching center, interval, matrix, resource identity, and epoch;
6. mark valid and clear satisfied reasons/debt.

A changed valid commit is a radiance discontinuity. Publish or derive a
conservative affected receiver region for temporal rejection; use a full reset
when that region cannot be bounded.

Commands encoded after the current presentation seal render into an inactive
generation. The prior committed generation remains pinned for current receivers;
the new generation swaps atomically at the next publication. Without an inactive
generation, defer the update. Command encoding is not GPU completion: keep
resource reuse behind the real queue completion condition. Device loss
invalidates the lost resource generation and rebuilds before commitment.

Two r185 implementation shapes are viable:

- a composite `ShadowBaseNode` owns child `ShadowNode`s, scheduling, and blend;
- a specialized `ShadowNode` overrides target/filter/update state coherently.

Overriding only `renderShadow()` does not reconcile the base class's single-
target assumptions. After initialization, use synchronous `renderer.render()`;
r185 deprecates `renderAsync()`.

The CPU owns `updateBefore()` scheduling. GPU dirty bits require readback before
CPU render selection. A no-readback alternative keeps CPU chunk generations/
spatial indices, or makes compaction and draw dispatch fully GPU-driven.

### Containment and receiver sampling

Use committed values only:

```text
di = max(abs(x - committedXi), abs(y - committedYi))
inneri = sampledHalfWidthi * (1 - blendRatioi)
fi = 1 - smoothstep(inneri, sampledHalfWidthi, di)

wi = fi * remaining
remaining *= (1 - fi)
```

Accumulate fine to coarse. Invalid forces `fi = 0`; unresolved remainder is lit.
After subtracting filter and coverage guards, require per axis:

```text
validHalfWidthCoarse >= validHalfWidthFine
                        + worstRelativeSnapCenterDelta
```

Count each filter/coverage guard once when deriving `validHalfWidth`.

For a strict one/two-layer cross-fade, also require
`fineOuter + snapDelta <= coarseInner`, rechecked against the next valid level.
Otherwise sample every nonzero level instead of dropping weight.

Choose one topology:

1. independent textures: `L` bindings and unconditional `L * F` filters;
2. conditional independent textures: fewer active filters, but generated WGSL,
   derivative uniformity, and subgroup divergence are revision/UA/adapter gates;
3. array/atlas selection: one filter or two in a fade, with common format/size,
   validated dynamic layer selection, and filter-safe gutters.

## Swept invalidation and caster parity

Track caster previous/current transform, geometry/buffer and LOD identity,
visibility/layers/cast flags, side/cull policy, alpha/map/mask coverage,
deformation version and conservative envelope, chunk generation/removal, light
basis, and resource dimensions/format/generation.

For every changed caster:

1. compute conservative previous and current world bounds including deformation;
2. union or sweep them to include vacated and new silhouettes;
3. transform the bound to the stable light frame;
4. intersect committed and desired level domains;
5. mark intersected content invalid and advance content epoch;
6. coalesce overlaps before scheduling.

The temporal affected region is the old/new occluder silhouette extruded along
the light over the committed receiver domain and dilated by filter, normal-bias,
projection, and temporal neighborhoods. The caster's swept AABB alone is not a
receiver-radiance bound.

A central bound can intersect all nested full maps. If that cost fails, use
non-overlapping rings, caster proxies, paged/tiled residency, or a dynamic
overlay in the same shadow node. For opaque binary visibility with matched
light-plane taps, exact static/dynamic union is:

```text
V = sum_k(weight_k * Vstatic_k * Vdynamic_k)
```

Outside overlay coverage `Vdynamic = 1`. `min()` or multiplication of already-
filtered averages is an approximation requiring its own quality gate.
Transmitted color needs a separate resource/filter/composition contract.

Event dependencies:

| Event | Depth redraw | Other action |
| --- | --- | --- |
| Receiver-only motion inside committed coverage | no for opaque comparison depth | update lookup/coverage; VSM receiver submission is exceptional |
| Filter, bias, or fade change | usually no | rebuild/update sampling state |
| Caster transform/deformation/coverage | affected levels | swept invalidation |
| Light direction/basis | all retained levels | new basis epoch |
| Map dimensions/format/generation | all affected resources | recreate and invalidate |
| Compensated renderer-origin change | no semantic redraw | atomically update render transforms |

### Local/world parity

Correct shared local deformation:

```js
const displacedLocal = Fn( () => positionLocal.add( localOffsetNode ) )();
material.positionNode = displacedLocal;
material.castShadowPositionNode = displacedLocal;
material.receivedShadowPositionNode = null;
```

A custom `receivedShadowPositionNode` must return world space and is validated
independently. Preserve morphing, skinning, displacement, batching, and
instancing established before `positionNode`. Share alpha/map/color alpha,
`alphaTest`, `maskNode`/`maskShadowNode`, and `castShadowNode` semantics. A proxy
needs a measured silhouette-error bound.

## Binding, workload, and validation

Count complete material bindings and target allocation, including non-shadow
resources. Independent level textures simplify ownership but use at least one
depth binding per level. Arrays reduce bindings when format/size match, while
layer limits, dynamic selection, filter gutters, per-layer update, and preview/
disposal become explicit implementation work.

Lower-bound target memory:

```text
Mtarget = sum(width * height * layers
              * (bytesPerColorTexel + bytesPerDepthTexel))
```

Add VSM targets, mips, debug copies, padding, and transient allocator pressure.
Nominal bytes are not observed allocation. Leave adapter/product headroom for
materials, environments, MRT/post, storage, and transients.

Workload accounting:

```text
shadow draw work     = sum_v(visibleCasterDraws_v)
shadow triangle work = sum_v(visibleCasterTriangles_v)
shadow vertex work   = sum_v(vertexInvocations_v)
shadow raster work   = sum_v(coveredDepthSamples_v * meanOverdraw_v)
                       // or measured fragment invocations, never both
alpha work           = sum_v(alphaFetches_v + discardedFragments_v)
receiver filter work = sum_pixels(sum_active_evaluations(filterOps))
frame allowance      = 1000 / targetRefreshHz
```

CSM uses `L` maps/views and approximately one active filter per receiver, two in
a fade. Stock Tile uses `N` layer passes, can approach
`N * unionVisibleCasterDraws`, and emits `N` containment branches. Per-level
clipmap textures use `L` bindings/portable filters unless a validated array or
atlas selects one/two layers.

Predeclare independent correctness, CPU, GPU, presented-frame, memory, update-
spike, invalid-coverage, and headroom gates. Then measure a warmed, thermal-
steady trace with camera motion, cached reuse, coverage changes, localized and
burst invalidation, light-basis changes, resize/DPR, and recreate. CPU and GPU
overlap; report them separately.

Focused validation:

- bounded one-shadow baseline under identical projection/filter;
- slow sub-texel and cross-texel motion;
- every XY edge and light-depth boundary;
- front-facing, grazing, and thin-contact bias scenes;
- cross-level filter footprint, weights, and remaining-lit visualization;
- previous/current swept invalidation and an invalid-to-coarser fallback;
- broad deformation proving cache rejection or separation;
- light-direction changes below/above the basis gate;
- origin rebase with invariant semantic light coordinates;
- CSM projection mutation followed by `updateFrustums()`;
- Tile depth ordering, seams, layers, and selected depth convention;
- adapter limits and actual compiled binding layout;
- sustained expiry/invalidation spikes;
- detach/dispose/recreate with balanced node, target, texture, storage, listener,
  and debug-resource counters.

Failure signatures:

| Signature | Cause to inspect |
| --- | --- |
| Slow-motion crawl | moving anchor, unsnapped center, changing extent, basis churn |
| Boundary flicker | desired/committed mismatch, invalid selection, filter/bias mismatch |
| Detached contact | excessive `normalBias` or wrong comparison-bias sign |
| Coarse acne | bias/support not derived from world texel and depth span |
| Ghost silhouette | content treated as age refresh or previous bound omitted |
| Shifted receiver lookup | local deformation assigned to world receiver hook |
| Reversed Tile inversion | unreconciled `LessCompare`/clear convention |
| Scheduler readback stall | GPU dirty bit made prerequisite for CPU selection |
| Memory growth | custom attachment, child node/shadow, target, storage, listener, or debug resource survives disposal |

Acceptance requires causal fixed-view diagnostics, valid fallback behavior,
actual binding/resource inventory, sustained target-device evidence, and a
lifecycle plateau.
