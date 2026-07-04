# GTAO and bent-normal pipeline

Use this reference for production ambient visibility in latest Three.js with
`WebGPURenderer`, TSL, `RenderPipeline`, built-in `GTAONode`, optional
`TRAANode` temporal filtering, and a narrowly justified custom bent-normal
extension.

## Contents

1. Build order
2. Integration contract
3. Capability gate and quality tiers
4. Built-in GTAO baseline
5. Temporal and denoise integration
6. Custom bent-normal extension
7. Reversed-depth and reconstruction rules
8. Application to lighting
9. Performance budgets
10. Validation and diagnostics
11. Replaced techniques

## 1. Build order

Algorithm class comes first. For this domain the fastest correct architecture
is the official node GTAO path:

1. One `RenderPipeline` owns the frame.
2. One `pass(scene, camera)` owns the scene render and exposes color, depth,
   and view normals through MRT when available.
3. `ao(depthNode, normalNode, camera)` creates the `GTAONode` scalar
   visibility pass.
4. AO runs at half linear resolution unless a fixed-view benchmark proves full
   resolution is required.
5. Temporal filtering is integrated through `TRAANode` only when the pipeline
   has valid velocity, depth rejection, and camera-cut reset.
6. `DenoiseNode` is an optional quality setting when temporal filtering is not
   active or when the scene cannot tolerate temporal artifacts.
7. A custom TSL bent-normal/horizon path is an extension, not the default. It
   must beat the built-in path for a documented use case such as directional
   ambient tint or specialized diagnostics.

This replaces the old custom-first RGBA16F horizon pass. The old path was
useful for bent-normal experiments, but it paid extra bandwidth and carried
known risks: scalar projection reach, scalar texel offsets, depth-only upsample,
uncertain bent-normal sign, and no managed temporal integration.

## 2. Integration contract

Use the node pipeline and node materials throughout:

```js
import * as THREE from 'three/webgpu';
import {
  ambientOcclusion,
  builtinAOContext,
  materialAO,
  mrt,
  normalView,
  output,
  pass,
  vec4
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

const renderer = new THREE.WebGPURenderer( {
  antialias: false,
  outputBufferType: THREE.HalfFloatType
} );

await renderer.init();

const renderPipeline = new THREE.RenderPipeline( renderer );
const scenePass = pass( scene, camera );

scenePass.setMRT( mrt( {
  output,
  normal: normalView
} ) );

const sceneColor = scenePass.getTextureNode( 'output' );
const sceneDepth = scenePass.getTextureNode( 'depth' );
const sceneNormal = scenePass.getTextureNode( 'normal' );

const gtao = ao( sceneDepth, sceneNormal, camera );
gtao.resolutionScale = 0.5;
gtao.radius.value = 0.5;
gtao.distanceExponent.value = 1.6;
gtao.distanceFallOff.value = 0.35;
gtao.thickness.value = 0.35;

const visibility = gtao.getTextureNode().r;
const materialContextOutput = builtinAOContext( visibility, sceneColor );

// Keep the material AO slot and ambientOcclusion lighting property in the graph.
// builtinAOContext multiplies existing materialAO by the screen-space visibility
// before the lighting model applies ambientOcclusion to indirect energy.
const lightingContract = {
  contextNode: materialContextOutput,
  materialSlot: materialAO,
  lightingProperty: ambientOcclusion
};

renderPipeline.outputNode = materialContextOutput;
```

The canonical path is material-context AO: `builtinAOContext()` lets
`NodeMaterial.setupAmbientOcclusion()` combine material AO with screen-space
visibility, and the physical lighting model applies `ambientOcclusion` to
indirect diffuse and indirect specular occlusion before output conversion.
Direct lights and emission are not multiplied.

A final color multiply is only failure or compatibility-compromise text in this
reference. If the app cannot pass AO through material or lighting context, use
the residual indirect split in Section 8 as an explicit compatibility
compromise and keep direct/emissive exclusion tests mandatory.

Use `renderPipeline.render()` in the animation loop. Dispose `RenderPipeline`,
`PassNode`, `GTAONode`, `DenoiseNode`, `TRAANode`, and any custom storage
resources when the effect is removed.

## 3. Capability gate and quality tiers

Gate once after renderer initialization:

```js
await renderer.init();

if ( renderer.backend.isWebGPUBackend ) {
  // Full tier: MRT normals, GTAONode, TRAANode/DenoiseNode, optional storage extension.
} else {
  // Reduced tier: scalar AO only, fewer samples, static material AO, or disabled AO.
}
```

Quality tiers:

| Tier | Inputs | AO path | Temporal | Output |
| --- | --- | --- | --- | --- |
| Ultra | MRT color, depth, normal, velocity | `GTAONode` at 0.5 scale, optional custom bent-normal extension | `TRAANode` with AO temporal filtering | scalar visibility plus validated directional ambient tint |
| High | MRT color, depth, normal | `GTAONode` at 0.5 scale | optional `DenoiseNode` | scalar visibility |
| Medium | depth plus reconstructed normal or reduced MRT | `GTAONode` at 0.5 or 0.25 scale, lower samples | off by default | scalar visibility |
| Low | static materials or static AO assets | material AO maps/static AO | none | no dynamic screen-space pass |

If a setting disables AO, bypass the AO node in the pipeline. Setting intensity
or scale to zero while still rendering the pass is not a performance win.

## 4. Built-in GTAO baseline

The baseline uses `GTAONode` because it is already integrated with the current
Three.js node post stack:

- `ao(depthNode, normalNode, camera)` consumes pass depth and normals.
- If MRT normals are unavailable, the node can reconstruct normals from depth,
  but MRT normals are preferred for quality and stability.
- `resolutionScale = 0.5` is the default production setting; full resolution is
  an ultra-quality override only after measurement.
- Tune radius in world units. Do not replace world radius with fixed pixel
  radius.
- Prefer reducing radius and samples over running a large-radius gather at full
  resolution.

Initial presets:

| Setting | Medium | High | Ultra |
| --- | ---: | ---: | ---: |
| `resolutionScale` | 0.25-0.5 | 0.5 | 0.5-1.0 after benchmark |
| `radius` | 0.25-0.45 m | 0.45-0.75 m | scene-scaled, validated in meters |
| `distanceExponent` | 1.2-1.6 | 1.4-1.8 | art-directed, measured |
| `distanceFallOff` | 0.35-0.65 | 0.25-0.5 | radius-dependent |
| `thickness` | 0.2-0.4 m | 0.3-0.6 m | scene-scaled |
| `samples` | 8-12 | 16 | 24-32 only after budget proof |

Use depth MIP/prefiltering only in a custom extension where large radii demand
it. The built-in node remains the default comparison point.

The scalar baseline breaks when a large projected radius covers broad flat
walls, foliage or thin silhouettes dominate the view, temporal ghosting appears
around moving occluders, a depth-MIP hierarchy is needed for distant reach, or
MRT bandwidth pressure makes normal/velocity targets too expensive. Record the
break condition before increasing samples or enabling a custom extension.

## 5. Temporal and denoise integration

`GTAONode.useTemporalFiltering = true` requires `TRAANode`. Treat temporal AO
as a whole-pipeline feature:

1. Disable MSAA when using `TRAANode`.
2. Provide valid beauty, depth, velocity, and camera inputs to `traa()`.
3. Let TRAA set the camera jitter/view offset for the frame.
4. Invalidate history on camera cuts, projection changes, resolution/DPR
   changes, material ID discontinuities when available, and large velocity.
5. Test moving thin geometry, foliage, particles, and skinned meshes for
   ghosting before shipping temporal AO.

When temporal filtering is off, use `DenoiseNode` as an optional quality tier:

```js
const gtaoOutput = gtao.getTextureNode();
const denoisedAO = denoise( gtaoOutput, sceneDepth, sceneNormal, camera );
```

Tune denoise as a costed option. It can improve raw AO but adds post overhead;
do not enable it blindly on mobile or integrated GPUs.

## 6. Custom bent-normal extension

Only build a custom TSL path when scalar `GTAONode` is insufficient. Valid
reasons:

- directional ambient tint from less-occluded directions;
- debug views for horizon, visibility, radius, and bent direction;
- a scene-specific extension that benchmarks faster or better than the built-in
  node at the same visual target.

Implementation rules:

- Use TSL `Fn()` nodes and node render targets or `StorageTexture` only where
  the extension genuinely needs custom storage.
- Use `textureStore()` and `renderer.compute()` / `renderer.computeAsync()` for
  compute-side prefiltering, depth MIP construction, or history maintenance.
- Output scalar AO in a single-channel target when no direction is needed.
- Use `RGBA16F` only for bent direction plus scalar visibility:
  RGB stores decoded/encoded direction, A stores scalar visibility where 1 is
  open.
- Run the gather at half linear resolution by default; quarter resolution is a
  low tier, full resolution is a measured ultra tier.
- Use `vec2` projection reach from both projection axes and `vec2(1 / width,
  1 / height)` texel offsets. Scalar X-only reach and width-derived Y offsets
  are bug signatures.
- Bilateral reconstruction must weight depth and normal similarity; depth-only
  reconstruction is a debug simplification, not production.
- Bent-normal lighting is hard-gated by the one-wall receiver test.
- A bent normal is the mean unoccluded direction in the chosen view or world
  convention, coupled to scalar visibility. Always normalize bent directions
  after decode and filtering before comparison or lighting. Keep disabled directional
  tint until the one-wall fixture proves the direction turns away from the
  blocked hemisphere.

Preserved GTAO math for custom horizon integration:

```text
resolution scale     0.5 x 0.5 by default
slices               2 minimum, increase only after temporal/filter tests
steps per side       4 baseline for bounded cost
sides per slice      2
depth taps           16 per half-resolution pixel at the baseline
```

For each sample:

```text
delta = sampleViewPosition - centerViewPosition
distance = max(length(delta), 0.0001)
falloff = saturate(1 - distance / max(radius, 0.0001))
accept when abs(delta.z) < thickness
horizon = mix(-1, dot(delta, viewDirection) / distance, falloff)
```

Keep horizon angle and distance falloff separate. Mixing toward `-1` weakens a
distant occluder without corrupting the angle of a nearby one.

Custom horizon math is debug-only unless it ports the current r185 baseline:
project the normal into each slice plane with `projNRaw`, use the two-sided
horizon mapping, and evaluate the Activision GTAO cosine-weighted closed-form
integral. compare every custom result against official `GTAONode` on the
fixture manifest before using it for production lighting.

Bent-normal acceptance:

```text
place a flat receiver beside one vertical wall
show geometric normal
show decoded bent direction
show environment sample direction
verify the direction turns away from the blocked hemisphere
```

If the decoded direction turns toward the wall, the accumulator sign or basis
is wrong. Do not enable ambient tint until this passes.

## 7. Reversed-depth and reconstruction rules

Do not hard-code a single depth convention. Current renderer setup can use
standard, reversed, or logarithmic depth. Build a small compatibility matrix in
the implementation notes for the project:

| Mode | Required check |
| --- | --- |
| Standard depth | sky/background clear value, far-plane behavior, linearization curve |
| Reversed depth | near/far interpretation, sky threshold, maximum reconstruction clamp |
| Logarithmic depth | verify linearization before AO; disable custom reconstruction if uncertain |
| Depth-reconstructed normals | compare against MRT normal debug on hard edges and thin geometry |
| MRT normals | confirm view-space convention and normalize before AO |

For custom reconstruction, verify:

- camera-facing plane produces stable view Z;
- sky/background pixels early-out to visibility 1;
- non-square viewport keeps circular world radius after projection;
- asymmetric projection uses both projection axes;
- resizing and DPR changes resize all AO targets and update texel sizes.

## 8. Application to lighting

AO should modulate ambient visibility:

- material ambient occlusion slot or TSL `ambientOcclusion` when the material
  node graph can consume scalar visibility;
- indirect diffuse and environment response before tone mapping;
- optional bent-direction environment sampling only after the one-wall test.

Avoid final color darkening. If the app has only a forward scene color in post,
split the residual cautiously:

```text
indirectEstimate = albedo * environmentIntensity * irradiance
indirect = min(indirectEstimate, sceneColor)
direct = sceneColor - indirect
occludedIndirect = indirect * visibility
output = direct + occludedIndirect
```

This residual composite is an advanced compatibility compromise. It is approximate for
specular, emissive, transparent, and bloom-fed surfaces; material/node-level
integration is preferred.

## 9. Performance budgets

Benchmark with fixed camera paths, disabled-pass bypass, and GPU timings:

| Hardware tier | Output | AO work | Target |
| --- | ---: | ---: | ---: |
| Desktop discrete | 2560x1440 DPR 1 | 0.5-scale scalar `GTAONode` | 0.6-1.2 ms |
| Desktop discrete ultra | 2560x1440 DPR 1 | scalar AO plus temporal or denoise | 1.2-2.0 ms |
| Desktop integrated | 1920x1080 DPR 1 | 0.5-scale scalar AO | 0.8-1.8 ms |
| Mobile/tablet | 1920x1080 effective | 0.5 or 0.25 scale, reduced samples | 1.0-2.5 ms |

Track:

- AO target dimensions and format;
- count of scene, AO, denoise, temporal, and composite passes;
- MRT bandwidth;
- storage texture or storage buffer sizes for custom extensions;
- compute dispatch dimensions when using storage;
- disabled-AO frame cost;
- resize/DPR allocation churn.

## 10. Validation and diagnostics

Checkpointed build order:

1. Checkpoint: MRT normal and pass depth are visible.
   Expected: flat receiver shows stable view normals and monotonic view Z.
   If you see black normals or inverted depth, fix pass/MRT ownership first.
2. Checkpoint: raw `GTAONode` scalar visibility is visible.
   Expected: contact darkening appears only near occluding geometry.
   If you see full-screen gray, radius units or depth mode are wrong.
3. Checkpoint: denoise or reconstruction is enabled.
   Expected: thin silhouettes keep clean edges without thick halos.
   If you see cross-edge blur, add normal-aware weights or lower thickness.
4. Checkpoint: temporal AO is enabled only with velocity.
   Expected: moving occluders reject stale history.
   If you see ghost trails, disable temporal AO or fix velocity/rejection.
5. Checkpoint: bent-normal decode is inspected.
   Expected: one-wall bent direction turns away from the blocked hemisphere.
   If you see tint into the wall, keep directional lighting disabled.
6. Checkpoint: material-context AO is active.
   Expected: indirect contact grounds objects while hard sun and emission stay bright.
   If you see sunlit or emissive surfaces turn gray, a final color multiply is active.
7. Checkpoint: disabled AO bypass is measured.
   Expected: disabled mode removes the AO node from the active pipeline.
   If you see unchanged pass cost, intensity was zeroed without bypassing work.

Expose debug views for:

```text
raw depth and linear view Z
sky/background classification
view normal or depth-reconstructed normal
projected radius in pixels on both axes
AO resolution scale
GTAONode scalar visibility
denoised visibility
temporal history validity and rejected pixels
velocity length
bilateral depth and normal weights
custom horizon positive/negative cosine
custom thickness acceptance
custom distance falloff
custom encoded and decoded bent direction
one-wall bent-direction test
indirect contribution before and after AO
direct residual
GPU time per pass
```

Required fixtures:

- `wall-receiver`: wall plus receiver for bent-normal direction;
- `thin-silhouette`: thin foreground silhouette over far background;
- `sky-edge`: sky/background edge;
- `emissive-object`: emissive object beside occluder;
- `hard-sun`: hard direct sun over contact shadow;
- `non-square-viewport`: non-square viewport;
- `asymmetric-projection`: asymmetric projection;
- `camera-rotation`: camera rotation with static geometry;
- `moving-occluder`: moving geometry under temporal filtering;
- `resize-dpr`: resize and DPR change;
- `disabled-ao`: disabled-AO timing.

Failure diagnosis:

| Symptom | Likely cause |
| --- | --- |
| AO radius changes incorrectly with distance | world radius was replaced by pixel radius |
| Far contact vanishes | projected radius has no minimum or samples are too low |
| Thick silhouettes | thickness too high or bilateral weights cross discontinuities |
| Vertical blur differs from horizontal blur | scalar texel size used for both axes |
| Bent tint points into a wall | accumulator sign or view/world basis failed validation |
| Sunlit or emissive surfaces become gray | AO is multiplying final scene color |
| Disabled AO still costs the pass | node was left in the active pipeline |
| Camera rotation changes tint twice or not at all | bent direction transform semantics are wrong |
| Temporal AO ghosts moving objects | invalid velocity, missing rejection, or stale history |

## 11. Replaced techniques

The rewritten doctrine intentionally replaces:

| Old technique | Replacement | Reason |
| --- | --- | --- |
| Custom half-resolution RGBA16F GTAO as the first path | Built-in `GTAONode` scalar AO first | The built-in node is the fastest correct r185-era baseline and owns current node integration |
| Depth-only bilateral upsample as production default | Depth- and normal-aware reconstruction or `DenoiseNode` | Depth-only filtering leaks across hard normal discontinuities |
| Scalar X projection reach | `vec2` reach from both projection axes | Non-square and asymmetric projections need independent axes |
| Width-derived scalar texel offset | `vec2(1 / width, 1 / height)` | Prevents vertical blur errors |
| Unverified bent-normal accumulator sign | One-wall validation before lighting use | Directional ambient tint is wrong if the vector points into blocked space |
| Intensity-zero disable | Pipeline bypass | Zero intensity can still pay pass cost |
| Unmanaged temporal claims | `TRAANode` integration with velocity/depth rejection | Temporal AO without reprojection and rejection ghosts |
