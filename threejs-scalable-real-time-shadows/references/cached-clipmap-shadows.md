# Cached Clipmap Shadow System

Use this reference only for streaming directional-light worlds where built-in WebGPU shadow nodes are not enough because coarse shadow coverage must persist across frames and be invalidated by changed world chunks. The performance win comes from caching and targeted updates; claim a speedup only from a benchmark decision record captured on the target scene and device.

## Physics / Visibility Contract

This skill owns directional-light cast shadows: an orthographic light-space
depth map, normalized depth comparison, and a filter footprint whose size is
measured in world texels for the selected level. It assumes visible receivers
and shadow casters share the same world-space silhouette or an explicitly
documented simplified caster proxy. Depth bias offsets depth comparison; normal
bias offsets the receiver along its geometric normal and must scale with level
texel width.

Correct signatures: stable contact shadows under slow pan, clipped casters
only outside the committed orthographic volume, smooth boundary fade, and no
direction-dependent disappearance. Wrong signatures: acne from insufficient
bias, peter-panning or detached contact from excessive normal bias, clipped
casters from shallow depth range, crawl from unsnapped centers, and visible
level rings from mismatched containment weights.

## Benchmark Decision Record

Before a custom cached clipmap is accepted, compare one `DirectionalLightShadow`,
`CSMShadowNode`, `TileShadowNode`, and the custom cached clipmap on the same
seeded scene. Record pass count, persistent coarse map reuse, targeted
invalidation count, memory, measured GPU time, and spike time. Custom clipmaps
win only when persistent coarse coverage or targeted invalidation lowers the
measured GPU time versus the built-in alternatives.

## r185 API Hook Map

Current local r185 source verifies these custom-shadow hooks:

| Hook | Source role |
| --- | --- |
| `AnalyticLightNode` | reads `light.shadow.shadowNode` before creating the default node. |
| `ShadowNode.renderShadow()` | renders the selected shadow map. |
| `ShadowNode.updateBefore()` | schedules shadow work before lighting consumes it. |
| `ShadowNode.setupShadowFilter()` | owns comparison filtering and is where unconditional samples are preserved. |
| `ShadowNode.setupShadowCoord()` | maps world shadow position to shadow coordinates. |
| `ShadowBaseNode.setupShadowPosition()` | keeps caster deformation in the node shadow path. |
| `LightShadow.biasNode` | WebGPU/node path for receiver or level-aware bias. |
| `NodeMaterial.castShadowPositionNode` | caster-position parity for displaced/wind/instanced objects. |
| `NodeMaterial.receivedShadowNode` | material-side received-shadow customization. |
| `CSMShadowNode` | `three/addons/csm/CSMShadowNode.js`. |
| `TileShadowNode` | `three/addons/tsl/shadows/TileShadowNode.js`. |

## Binding Pressure

Each clipmap level consumes a sampled depth texture and comparison sampler in
material code. Per-level depth textures are simple and easy to debug; an array
depth texture can reduce binding pressure but makes layer ownership, previews,
and independent sizing harder. `TileShadowNode` wins when a static large
projection can be expressed as tiles without committed cache state. Reduce
level count before increasing map resolution when sampled texture or bind-group
limits approach the adapter cap.

## Canonical Example And Stepwise Checkpoints

Canonical Phase 1 path: `examples/webgpu-cached-clipmap-shadow/`.

Step 1: architecture decision. Checkpoint: chosen shadow path includes
`CSMShadowNode`, `TileShadowNode`, and custom cached clipmap comparison.
Expected debug: pass count and measured GPU-time fields. Failure symptom:
custom-first design without a measured decision record.

Step 2: level state. Checkpoint: level count, map sizes, invalid sentinels,
staggered ages, and memory are emitted by `validate.js`. Expected debug:
`levelHalfWidths` and `sampledTextureLimits`.

Step 3: texel snapping. Checkpoint: desired X/Y centers snap by world texel
width per level. Expected debug: `texelGrid`. Failure symptom: crawl under
slow pan.

Step 4: render commit. Checkpoint: each selected level binds its own
`DepthTexture` render target, fits an orthographic light camera to the snapped
level bounds, draws the caster scene, and only then publishes material-facing
centers. Expected debug: `desiredVsCommittedCenter`, per-level render count,
and target/depth texture identity. Failure symptom: rhythmic boundary flicker
or a CPU scheduler that advances state without drawing shadow depth.

Step 5: sampling weights. Checkpoint: `setupShadowFilter` samples every level
unconditionally, then applies weights. Expected debug: `crossFadeWeights` and
`unshadowedWeight`. Failure symptom: shadows disappear by view angle.

Step 6: invalidation. Checkpoint: forced invalidation bypasses the ordinary
cached budget and targeted spheres mark only touched levels. Expected debug:
`invalidationSphere`.

Step 7: bias. Checkpoint: normal bias scales by world texel width and
`biasNode` is available for material/receiver variants. Expected debug:
`biasNodeNormalBias`.

Step 8: caster parity. Checkpoint: a displaced caster assigns the same node
object to `positionNode`, `castShadowPositionNode`, and when used
`receivedShadowPositionNode`. Expected validation: object identity, not text
similarity.

Dispose checkpoint: detach the custom node and balance disposal counters for
shadow nodes, cloned shadows, level lights, level targets, storage, and debug
textures.

## 1. Choose The Shadow Architecture First

| Need | Use | Expected cost |
| --- | --- | --- |
| Bounded receiver/caster volume | One `DirectionalLightShadow` | One shadow pass and one depth map. |
| Camera-following cascades | `CSMShadowNode` from `three/addons/csm/CSMShadowNode.js` | `cascades` passes; official split, fade, and disposal behavior. |
| Large static projection divided into squares | `TileShadowNode` from `three/addons/tsl/shadows/TileShadowNode.js` | `tilesX * tilesY` passes; simpler than owning clipmap cache state. |
| Streaming terrain/cities with persistent far coverage | Custom cached clipmap using `ShadowNode` hooks | `dynamicLevels + cachedBudget + forcedInvalidations` passes; best for amortized open-world coverage. |

Do not start with custom clipmaps. They are justified only when persistent coarse maps and targeted invalidation beat built-in cascades or tiles in measured GPU time.

## 2. WebGPU/TSL Preflight

Required baseline:

```js
import { WebGPURenderer } from 'three/webgpu';
import { Fn, storage, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { TileShadowNode } from 'three/addons/tsl/shadows/TileShadowNode.js';

await renderer.init();

const fullShadowTier = renderer.backend?.isWebGPUBackend === true;

if (!fullShadowTier) {
  // Reduced tier: fewer maps, smaller far distance, static/precomputed far casters.
}
```

Before building a custom node, record:

- Three.js revision and exact addon import paths.
- Whether the selected backend is the full WebGPU tier.
- `renderer.reversedDepthBuffer`, `renderer.logarithmicDepthBuffer`, `renderer.shadowMap` settings, and shadow map type.
- Per-device sampled texture, sampler, storage buffer, storage texture, and bind-group limits.
- Whether the project has verified the custom shadow-node attachment point in the installed Three.js source. The public docs verify `ShadowNode.renderShadow()`, `updateBefore()`, `setupShadow()`, `setupShadowCoord()`, `setupShadowFilter()`, and `LightShadow.biasNode`; they do not make every internal light attachment detail a stable contract.

## 3. Quality Tiers

Treat fallback as reduced quality, not a second renderer implementation.

| Tier | Directional shadow setup | Typical map profile | Update policy |
| --- | --- | --- | --- |
| `ultra` | Custom clipmap or `CSMShadowNode` | 4-6 maps, near maps 2048, far maps 512-1024 | Near dynamic every frame, coarse cache budget 1-2, forced invalidations immediate. |
| `high` | `CSMShadowNode`, `TileShadowNode`, or 3-4 clipmap levels | 1024-2048 near, 512 far | Budget 1 coarse level per frame, shorter far distance. |
| `reduced` | One shadow or two near levels | 512-1024 | Static/precomputed far casters, no compute queue, conservative invalidation. |

Quality knobs change level count, map size, far distance, and update cadence. They do not switch to raw backend source strings or hand-authored backend code.
For custom clipmaps, the table values are starting profiles. The exact level
count is derived by `computeLevelCount()`, memory by
`estimateShadowMemoryBytes()`, and scheduled draw count by
`selectLevelsForUpdate()`; `validate.js` enforces those derived counts for the
canonical example.

## 4. Representation

A cached clipmap is a set of concentric light-space square shadow maps centered around the camera in the directional light's frame.

It is not a virtual shadow map:

```text
no page table
no physical page cache
no page-granular caster submission
one ordinary shadow texture per level
```

Each level consumes one sampled comparison depth texture in the material graph. Check sampled texture and comparison sampler limits before increasing level count. Prefer fewer levels with correct caching over many levels that exceed binding pressure.

## 5. Starting Profile And Bounds

Use this as a starting profile, not a universal default:

```text
first half-width       12 m
scale factor           2.5
maximum distance       2000 m
light margin           100 m
shadow near            1 m
shadow far cap         3000 m
guard band             0.15
cross-fade ratio       0.15
dynamic near levels    2
cached update budget   1-2 per frame
maximum cache age      64 frames
direction epsilon      0.002 radians
```

Level count:

```text
ceil(log(maxDistance / firstRadius) / log(scaleFactor)) + 1
```

Half-width per level:

```text
min(firstRadius * scaleFactor^level, maxDistance)
```

The last level is forced to `maxDistance` exactly.

Clamp authoring controls:

```text
firstRadius >= 1
scaleFactor >= 1.5
guardBand in [0.02, 0.5]
blendRatio in [0.01, 0.9]
dynamicLevels in [0, levelCount]
updateBudget >= 1
maxCacheAge >= 0
```

Performance knobs: level count, map size, update budget, dynamic near count, far distance.

Quality/safety knobs: guard band, blend ratio, near/far depth fit, bias and `biasNode`, caster parity.

## 6. Level State And Committed-Center Invariant

Each level owns CPU-side state and matching TSL uniforms/storage entries:

```ts
type LevelState = {
  halfWidth: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  mapSize: number;
  valid: boolean;
  forceDirty: boolean;
  age: number;
  dirtyReasonBits: number;
};
```

The material-facing vector stores:

```text
x = committed light-space center X
y = committed light-space center Y
z = sampled half-width = halfWidth * (1 - guardBand)
w = valid flag or level index metadata
```

Publish centers from the last completed shadow render, not the camera's desired center while a cached level waits for its budget slot. This committed-center invariant is the main fix for rhythmic boundary flicker.

Before a level renders once, park it outside selection:

```text
center = (1e9, 1e9)
sample half-width = 1e-6
valid = 0
```

An invalid level must never win selection.

## 7. Stable Light-Space Basis

Each frame, derive a robust light frame once:

```text
lightDirection = normalize(light.target.position - light.position)
upCandidate = abs(dot(lightDirection, worldUp)) > 0.98 ? alternateUp : worldUp
right = normalize(cross(upCandidate, lightDirection))
lightUp = normalize(cross(lightDirection, right))
worldToLight = inverse(makeBasis(right, lightUp, lightDirection))
cameraLight = worldToLight * cameraWorld
```

The direction is considered changed when:

```text
dot(currentDirection, lastCommittedDirection) < cos(directionEpsilon)
```

A direction change grants enough budget to refresh all levels coherently. If art direction requires continuous sun motion, reduce level count or accept the cost; do not mix cached maps rendered from different light directions.

## 8. Texel Snapping

Per level:

```text
texelWidth =
  (orthographicRight - orthographicLeft)
  / mapWidth

desiredX = round(cameraLightX / texelWidth) * texelWidth
desiredY = round(cameraLightY / texelWidth) * texelWidth
```

This aligns the orthographic projection to a fixed world-space texel grid. Do not snap by a fraction of total level extent; at coarse levels that produces large visible jumps.

Quantize Z more coarsely:

```text
zQuantum = halfWidth * 0.5
desiredZ = round(cameraLightZ / zQuantum) * zQuantum
```

Z controls depth coverage and update cadence. It does not define the projected texel grid, so a coarser quantum is intentional.

## 9. Update Policy

A level is dirty when:

```text
it is in the dynamic near set
or it has never rendered
or forceDirty is set
or snapped X/Y/Z changed
or cache age expired
or light direction changed
```

Policy:

```text
dynamic near levels:
  render every frame
  do not consume cached update budget

ordinary cached levels:
  render only while budget remains

explicitly invalidated levels:
  bypass the ordinary cached budget
```

On first update or light-direction change:

```text
budget = levelCount
```

Otherwise:

```text
budget = updateBudget
```

Age increments every frame and resets after render. Stagger initial ages:

```text
age(level) = floor(-level * maxCacheAge / levelCount)
```

This prevents all coarse levels expiring together.

For very large streaming scenes, maintain changed chunk bounds in a `StorageBufferAttribute` or `StorageInstancedBufferAttribute`, run a TSL `Fn().compute(count)` pass to emit per-level dirty bits, and consume those bits in `updateBefore()`. Keep the CPU path as orchestration only; do not read back dirty buffers in the frame loop.

## 10. Atomic Render Commit

When a level renders:

1. Commit snapped X/Y/Z to `LevelState`.
2. Clear `forceDirty` and the dirty reason bits that were satisfied.
3. Reset age.
4. Place the level light at the committed light-space center plus the configured light margin.
5. Transform level light and target back to world space.
6. Force matrices current for light, target, and shadow camera.
7. Render the shadow map immediately from the committed transform.
8. Publish material-facing uniforms/storage only after the render completes.

The level's orthographic depth range is:

```text
near = configuredNear
far = max(
  near + 1,
  min(configuredFarCap, lightMargin + 2 * halfWidth)
)
```

Each level shadow uses manual ownership:

```text
autoUpdate = false
needsUpdate = false until the scheduler selects the level
```

The clipmap owner drives updates. Automatic independent updates can render from a transform different from the one later sampled.

## 11. TSL Shadow-Node Shape

Custom clipmaps should be expressed as a shadow node, not as material-specific shadow code. Use current `ShadowNode` methods deliberately:

```ts
class CachedClipmapShadowNode extends ShadowNode {
  updateBefore(frame) {
    // Run dirty-mask compute when used, choose levels under budget,
    // commit centers, and request shadow renders for selected levels.
  }

  renderShadow(frame) {
    // Render selected level maps from committed transforms.
  }

  setupShadowFilter(builder, inputs) {
    // Unconditionally evaluate every level's comparison filter,
    // then blend by TSL-computed containment weights.
  }
}
```

Use `setupShadowPosition()` behavior from `ShadowBaseNode` so node-material displacement, morphing, skinning, instancing, and batched transforms match the visible pass. Use one shared position node object for visible and shadow caster deformation; do not duplicate the formula per cascade or per shadow hook. Use `LightShadow.biasNode` for level-aware bias when a uniform numeric bias is not enough.

## 12. Cross-Level Selection And Sampling

Transform `shadowPositionWorld` to the shared light-space XY plane. For each level:

```text
distance = max(
  abs(lightX - levelCenterX),
  abs(lightY - levelCenterY)
)

fade =
  1 - smoothstep(
    sampledHalfWidth * (1 - blendRatio),
    sampledHalfWidth,
    distance
  )

weight = fade * remaining
remaining *= 1 - fade
```

Accumulate from finest to coarsest. Leftover weight resolves to unshadowed, creating a smooth fade outside the outer level.

Critical GPU contract:

```text
sample every level's comparison texture unconditionally
multiply the result by its weight afterward
```

Do not put comparison sampling behind per-pixel conditionals. A bounded level still evaluates the filter function, then selects `1` outside the level's projected range. This keeps comparison sampling in uniform control flow while preventing out-of-bounds projection from shadowing.

## 13. Bias And Depth

Capture base directional-light bias values before creating per-level shadows.

Per level:

```text
texelScale = levelTexelWidth / finestTexelWidth
shadow.bias = baseBias
shadow.normalBias = baseNormalBias * texelScale
```

Use `biasNode` when bias must vary with level, receiver slope, or material class. Keep acne and peter-panning diagnostics separate per level. A single normal bias across 12 m and 2000 m levels is not coherent.

Depth checks:

- Tighten near/far to the committed level extent plus margin.
- Log reversed-depth and logarithmic-depth settings in diagnostics.
- Treat shadow-map type and filtering choice as a quality/performance tier.
- Prefer increasing map fit quality and bias correctness before increasing map resolution.

## 14. Targeted Invalidation

`invalidate()` with no bounds sets `forceDirty` on every level.

With a world-space bounding sphere:

1. Transform its center to light space.
2. For each level compute:

```text
reach = halfWidth + sphereRadius
```

3. Invalidate when both projected X and Y distances are below `reach`.

Use this for:

- streamed terrain arrival;
- regenerated buildings;
- moving hero casters;
- vegetation chunks whose deformed silhouettes matter;
- destructible or procedural meshes that alter caster bounds.

The test is a conservative square intersection in XY. It may over-refresh, but it is cheap and safe. Move to exact projected bounds only if invalidation cost dominates measured GPU time.

## 15. Caster Parity

The visible pass and shadow pass must agree on world position and coverage:

- Alpha-tested foliage uses the same alpha mask and threshold in the node graph.
- Displacement and wind deformation feed both visible position and shadow position.
- Skinning, morph targets, instancing, batched transforms, and per-instance dissolve are represented through NodeMaterial-compatible data.
- Static caster sets and dynamic caster sets are separated so cached far levels do not redraw unchanged static geometry unnecessarily.
- Layer masks and cast/receive flags are audited per shadow level.

Working displaced-caster recipe from
`examples/webgpu-cached-clipmap-shadow/main.js`:

```js
const sharedPositionNode = Fn(() =>
  positionLocal.add(
    vec3(
      0,
      sin(positionLocal.x.mul(0.31).add(displacementTime)).mul(displacementAmplitude),
      0,
    ),
  ),
)();

material.positionNode = sharedPositionNode;
material.castShadowPositionNode = sharedPositionNode;
material.receivedShadowPositionNode = sharedPositionNode;
```

The validator asserts object identity:

```js
material.positionNode === material.castShadowPositionNode;
material.positionNode === material.receivedShadowPositionNode;
```

That identity is the contract. Recreating the same formula in a second `Fn()`
is not equivalent because it can drift in uniforms, precision, cache ownership,
or per-level scheduling.

If a visible effect cannot be represented in the shadow node path, either remove it from the caster silhouette or budget the matching shadow deformation explicitly.

## 16. Budgets

State budgets in the implementation notes and fail validation when they drift.
The canonical validator enforces level count, render-call count, memory, target
ownership, dirty-bit invalidation, and parity identity in Node. Browser GPU
timings are separate measured artifacts; do not state millisecond performance
without attaching the capture that produced it.

```text
level count:
  bounded 1
  cascades 2-4
  tiles tilesX * tilesY
  custom clipmap 3-6

per-frame shadow passes:
  custom = dynamicLevels + cachedBudget + forcedInvalidations

memory:
  depthBytes = width * height * bytesPerDepthTexel
  totalDepthBytes = sum(depthBytes per level)

sampled textures:
  one comparison depth texture per level plus debug-only previews

compute:
  zero readbacks in frame loop
  dirty-mask dispatches only for changed chunk classes
```

For the canonical example, those custom values are not freehand claims:
`validate.js` checks `computeLevelCount(config)`, memory, sampled texture limit,
and one renderer call per selected level. Built-in cascade/tile counts come
from their pass topology.

Measured timing rows must be filled from the project capture, not copied from
this reference:

| Device tier | Average shadow GPU time | Spike budget | Memory ceiling |
| --- | ---: | ---: | ---: |
| Target device | measured from browser artifact capture | measured from browser artifact capture | enforced from `sum(width * height * bytesPerDepthTexel)` |

When over budget, reduce algorithmic cost first: fewer levels, lower far distance, smaller far maps, lower cached budget, better invalidation, tighter caster lists. Raising resolution is the last step.

## 17. Color And Output Rules

Shadow maps, dirty masks, indirection data, normal/bias maps, and debug numeric textures are data. Use linear/no-color handling for them and disable mip generation unless the data is explicitly filtered.

Color output is app-owned:

- color textures use `SRGBColorSpace`;
- data textures use no-color/linear handling;
- HDR working buffers use `HalfFloatType` until tone mapping;
- the node pipeline owns one tone-map step and one output conversion through `RenderPipeline.outputColorTransform` or `renderOutput()`.

Do not let shadow debug views perform hidden output conversion that differs from the app pipeline.

## 18. Required Diagnostics

Expose:

```text
chosen architecture and reason
full/reduced quality tier
level count and texture count
rendered half-width and sampled half-width
map size and world texel width per level
desired versus committed X/Y/Z
selected level and cross-fade weights
remaining unshadowed weight
dynamic/cached classification
dirty reason bits
valid/forceDirty/age
budget before and after updates
direction delta versus epsilon
base and scaled normal bias or biasNode output
shadow-map preview per level
invalidation sphere in light space
per-level render count and GPU time
sampled texture/sampler/storage usage versus limits
disposal counters for maps, nodes, storage, lights, and targets
```

Failure diagnosis:

```text
shadows crawl under slow camera motion:
  X/Y center is not snapped to the level's texel width

level boundaries flicker every other frame:
  desired center was published while the cached map retained its old center

shadows disappear by view angle:
  comparison samplers were evaluated in divergent control flow

coarse moving casters freeze:
  max age and targeted invalidation are both absent

all levels spike together:
  cache ages were not staggered

important streamed geometry remains unshadowed:
  explicit invalidation was incorrectly blocked by the coarse update budget

coarse levels show acne:
  normal bias or biasNode scaling does not track world texel width

memory grows after scene replacement:
  level shadows, shadow nodes, lights, targets, storage buffers, or debug textures were not disposed
```

## 19. Validation Scenes

Run these before shipping:

- Slow camera pan across snapped grid boundaries for shimmer.
- Fast teleport across several clipmap levels.
- Sun-direction delta just below and just above `directionEpsilon`.
- Streamed terrain chunk arrival with targeted invalidation.
- Moving hero caster crossing near and coarse levels.
- Alpha-tested vegetation and displaced/wind-deformed casters.
- Quality-tier smoke test on budgeted WebGPU settings.
- Dispose/recreate loop with GPU memory counters.
- Fixed-view screenshots and GPU timings through `$threejs-visual-validation`.
  In this example, `validate.js --artifacts <dir>` requires
  `shadow-map.png` and `silhouette.png` to exist and differ; without artifacts
  it exits non-zero unless `--allow-missing-gpu` is supplied.

## 20. Replaced Techniques

- Custom-first clipmaps are replaced by the decision table: one shadow, `CSMShadowNode`, or `TileShadowNode` is faster and safer until persistent coarse-map reuse is required.
- Re-rendering every cascade/level every frame is replaced by dynamic-near refresh plus cached coarse update budgets and targeted invalidation.
- Publishing desired camera centers is replaced by committed centers from the last completed shadow render.
- Fixed normal bias across all levels is replaced by texel-width-scaled `normalBias` and optional `biasNode`.
- Conditional comparison sampling is replaced by unconditional sampling followed by weighted selection.
- CPU-only large invalidation scans are replaced, when large enough to matter, by TSL compute dirty masks in storage buffers with no frame-loop readback.
