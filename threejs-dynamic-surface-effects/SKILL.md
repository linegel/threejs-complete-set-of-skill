---
name: threejs-dynamic-surface-effects
description: Build dynamic screen-space surface effects in latest Three.js WebGPU/TSL. Use for StorageTexture touch-history ping-pong, dt-correct frost/thaw masks, reduced-resolution node blur, static crystalline structure targets, and two-scale TSL normal refraction.
---

# Dynamic Surface Effects

Use this skill for screen-space surface effects whose visible mask, thaw/clear
state, or refractive response depends on persistent history. The only taught
implementation path is latest Three.js with `WebGPURenderer`, TSL,
`NodeMaterial`, `RenderPipeline`, `pass()`, storage textures, and compute.

Run `$threejs-choose-skills` before implementation when the request could also
involve world-space residue, weather accumulation, object paint, water, or a
larger post stack.

## Best Architecture First

Build the high-throughput frame graph first. Do not start from a simple
per-frame visual mask and later "upgrade" to history.

```text
input events for this frame
  -> compute pointer deposit into next history StorageTexture
  -> swap history read/write
  -> scene pass via pass(scene, camera)
  -> reduced-resolution vertical blur pass, setResolutionScale(0.35-0.5)
  -> reduced-resolution horizontal blur pass, setResolutionScale(0.35-0.5)
  -> static crystalline fields, generated once or loaded from assets
  -> full-resolution frost/thaw composite node
  -> two-scale TSL normal refraction node
  -> RenderPipeline output node with one output transform owner
```

History update comes before the frost composite so visible response can include
the current frame's input. If a product deliberately wants a one-frame delayed
feel, document that as a UX choice and keep the diagnostic contract identical.

The top-tier representation is a full-resolution RGBA `StorageTexture`
ping-pong:

- `R`: accumulated visible touch/thaw mask.
- `A`: accumulated tilt/refraction response mask.
- `G/B`: optional duplicate or debug channels, never hidden state.

Use `Fn().compute(count)` with `renderer.compute()` or `renderer.computeAsync()`
to write history using `storageTexture()` or `textureStore()`. Keep the path
read-back-free. Use `PassNode.getPreviousTextureNode()` only for temporal pass
feedback that is naturally owned by a node pass; use storage textures when the
history must be written from pointer/event data or compute.

## Capability Gate

Compute and storage are required for the full-quality path.

```js
import { WebGPURenderer, RenderPipeline, StorageTexture } from 'three/webgpu';
import { Fn, pass, storageTexture, textureStore } from 'three/tsl';

const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

const tier = renderer.backend.isWebGPUBackend ? 'full' : 'degraded';

if (tier === 'full') {
  // StorageTexture ping-pong, compute deposit/decay, node post pipeline.
} else {
  // Reduced-quality tier: static frost mask, lower-resolution precomputed
  // structures, no custom parallel renderer path.
}
```

Quality tiers:

| Tier | Required capability | History | Blur | Refraction | Intended use |
| --- | --- | --- | --- | --- | --- |
| Full | WebGPU backend with storage texture compute | full-res RGBA16F ping-pong | 0.35-0.5 scale separable | two-scale normals, height weighting, Fresnel/source inset | shipping target |
| Balanced | WebGPU backend with tighter budget | half-res history or RG8/RG16F after measurement | 0.25-0.4 scale separable | one full normals plus half detail | integrated GPUs |
| Budgeted | WebGPU backend with minimal storage budget | quarter-res RG8/RG16F or sparse updates | lower-scale separable blur | tint plus single offset | low-power WebGPU devices |

If the user explicitly asks how to apply fallback when WebGPU is unavailable,
route that teaching to `../threejs-compatibility-fallbacks/` instead of adding
a non-WebGPU path here.

## Implementation Rules

- Keep persistent history, scene color, and static structure textures separate.
- Use exponential time behavior: `survival = pow(k, dtSeconds)` for decay, and
  scale deposits with `1 - pow(1 - depositPerSecond, dtSeconds)`. Clamp invalid
  or suspended-tab deltas to a documented maximum such as `1 / 15`.
- Preserve separate visible-mask and tilt-response channels. The tilt channel
  should use smoother/noise-reduced deposit than the visible channel.
- Update history with aspect from the history texture dimensions, not from a
  reduced blur target.
- Use `HalfFloatType`/RGBA16F-equivalent history unless a measured cheaper
  format matches at 30, 60, and 120 FPS and through resize/reset cases.
- Optional diffusion must be stable and explicit: apply a small Laplacian term
  to the R/A history after decay/deposit only when the visible signature
  improves edge cohesion without same-UV smearing. Validate disabled diffusion
  and enabled diffusion at 30, 60, and 120 FPS.
- Use reduced-resolution separable blur with `PassNode.setResolutionScale()` or
  an equivalent node blur whose resolution scale is owned by the pass. Normalize
  alpha separately from RGB and guard zero-weight neighborhoods with an epsilon.
- Generate static crystalline fields once at startup or on resize/quality
  change. Asset/data textures are `NoColorSpace`, repeat or mirrored-repeat
  wrap as authored, and only generate mipmaps when the sampling path needs them.
- Build the final surface as TSL nodes feeding `RenderPipeline.outputNode`.
  Node materials for any helper meshes use the `NodeMaterial` family.
- Screen-period uniforms must be named as periods, not texture sizes. Derive
  real texel dimensions from texture metadata when needed.
- Define resize policy explicitly: clear, preserve by remapping, or preserve by
  reprojection. The default safe policy is to clear history and regenerate static
  structure textures.

## Color And Output

- Scene color entering the surface pipeline stays linear/HDR until the final
  output transform. Working buffers use `HalfFloatType` where precision matters.
- Color textures use `SRGBColorSpace`. Data textures, normal maps, masks, noise,
  and LUTs use `NoColorSpace`.
- The app has exactly one tone-map owner and one output conversion owner.
  Prefer `RenderPipeline.outputColorTransform = true`; if disabled, end the node
  graph with `renderOutput()`. Do not output-convert inside the effect.
- Frost tint, brightness, saturation, blur mix, and normal-refraction math are
  all linear-light operations before final output conversion.

## Budgets

Set budgets before tuning visuals:

| Target | Full tier budget |
| --- | --- |
| Pass count | 1 scene pass, 2 reduced blur passes, 1 composite/refraction output, 1 compute dispatch |
| History storage | 2 full-res RGBA16F storage textures, about 33 MB at 1920x1080 |
| Static storage | 1-3 data textures, preferably generated once and shared |
| Dispatch size | `ceil(width / 8) * ceil(height / 8)` workgroups for 8x8 history compute, or equivalent measured tile size |
| Draw calls | no extra scene redraws beyond the source pass |
| Desktop discrete | <= 1.2 ms at 1080p after scene pass |
| Desktop integrated | <= 2.5 ms at 1080p balanced tier |
| Mobile/low power | <= 4 ms at 720p degraded or balanced tier |

Raise blur/refraction quality only after the history update and reduced blur are
inside budget. Algorithm changes beat micro-optimizing node expressions.

## Diagnostics And Validation

Expose debug outputs for:

```text
scene color
vertical blur
horizontal blur
each static structure field
previous history R/A
current deposit R/A
next history R/A
frost mask before pointer application
frost mask after pointer application
sharp/blur mix
main refraction offset
detail refraction offset
final without refraction
final
```

Add pause and single-step controls. Validate:

- The same pointer path produces matching accumulated masks at 30, 60, and
  120 FPS.
- Resize follows the documented clear/preserve policy.
- Repeat or mirrored-repeat normal sampling is visible at boundaries.
- `RenderPipeline.render()` owns presentation when the node pipeline is active.
- Output screenshots are neither double-converted nor left in linear display
  space.

Interface anchors:

| Interface | Contract |
| --- | --- |
| Pointer NDC | Convert `[-1, 1]` input to history UV explicitly. |
| Texel center | Compute dispatches address storage texel centers, not CSS pixels. |
| Drawing-buffer size | Storage dimensions use physical drawing-buffer pixels after DPR. |
| CSS size / DPR | CSS size and DPR are metadata for resize policy, never hidden scale factors. |
| Screen period | `mainScreenPeriod` and `detailScreenPeriod` are screen periods, not texture dimensions. |
| UV origin | Name Y-up/Y-down assumptions before sampling history or normal maps. |

## Replaced Techniques

- Replaced time-only procedural masks with storage-backed history because
  accumulation is stateful and must survive visual noise changes.
- Replaced per-frame decay constants with exponential dt-correct survival so
  30/60/120 FPS behavior matches.
- Replaced full-resolution broad blur with reduced-resolution separable blur
  because it preserves the same broad frost feel at far lower bandwidth.
- Replaced single-scale offset refraction with two-scale TSL normal refraction
  using height-weighted detail, Fresnel/source inset, and mask gating because it
  gives better frozen-surface structure per sample.

## Routing Boundary

Use `$threejs-particles-trails-and-effects` for world- or object-space residue, particles, and
dissolves. Use `$threejs-rain-snow-and-wet-surfaces` for rain wetness, puddles,
snow accumulation, and weather-surface coupling. Use `$threejs-water-optics`
for physically bounded water refraction/ripples. Use `$threejs-image-pipeline`
when the work is mostly full-frame post ownership, tone mapping, bloom, GTAO, or
anti-aliasing.

This skill owns screen-space persistent surface history and its composite.

Legacy WebGL implementation (deprecated, do not extend): `examples/touch-history-frost/frost-surface-effect.js`.
