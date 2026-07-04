---
name: threejs-rain-snow-and-wet-surfaces
description: Build coupled WebGPU/TSL rain, snow, and wet-surface systems in Three.js. Use for compute-driven falling snow, rain streaks, snow accumulation, model snow caps, wet asphalt puddles, procedural or generated ripple normals, splash flipbooks, shared weather envelopes, and surface wetness or coverage transitions.
---

# Rain, Snow, and Wet Surfaces

Treat weather as one coupled GPU system: a shared weather envelope drives
precipitation particles, surface masks, normals, roughness, residue, lighting,
and diagnostics. The first design decision is algorithm class, because a
compute/storage architecture can be orders of magnitude faster than per-object
or per-frame CPU mutation at the same visual quality.

Run `threejs-choose-skills` preflight for backend, budget, and resource owner
decisions when precipitation joins a larger scene.

## Required Architecture

Build new work on latest Three.js with `WebGPURenderer` from `three/webgpu`,
TSL from `three/tsl`, `NodeMaterial` classes such as
`MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`, and
`SpriteNodeMaterial`, and the node post stack with `RenderPipeline`, `pass()`,
`mrt()`, `PassNode.setResolutionScale()`, `outputColorTransform`, and
`renderOutput()`.

The highest-throughput architecture for this domain is:

```text
shared weather envelope
  -> compute-updated StorageInstancedBufferAttribute precipitation volume
  -> camera-wrapped instance positions and per-instance random/static fields
  -> TSL surface masks for snow, wetness, puddles, roughness, and normals
  -> GPU impact/splash event buffers or generated ripple-normal quality tier
  -> node presentation with one tone-map and one output transform owner
```

Legacy WebGL implementations (deprecated, do not extend): `examples/snow-accumulation/snow-system.js`, `examples/wet-puddle-rain/rain-puddle-system.js`.

Canonical Phase 1 WebGPU/TSL contract:
`examples/webgpu-rain-snow-and-wet-surfaces/`. Run
`node examples/webgpu-rain-snow-and-wet-surfaces/validate.js` after edits.

Read
[references/precipitation-surface-systems.md](references/precipitation-surface-systems.md)
for the full contracts, quality tiers, budgets, diagnostics, and replacement
notes.

## Capability Gate

Initialize the renderer before allocating compute or storage resources. The
high tier requires the WebGPU backend; the reduced tiers keep the same weather
envelope and switch quality, not implementation doctrine.

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend) {
  // High tier: compute/storage precipitation and dynamic surface fields.
} else {
  // Reduced tier: fewer instances, static masks, and generated ripple normals.
}
```

Quality tiers:

- `high`: compute-updated rain or snow positions in storage instanced buffers;
  dynamic TSL wetness, snow, puddle, and ripple fields; GPU event buffers for
  impact residue when needed.
- `medium`: same storage-instanced precipitation with lower counts and cheaper
  material field octaves; ripple normals come from preloaded variants in
  `assets/generated-variants/`.
- `reduced`: no custom backend rewrite; keep shared weather uniforms, use lower
  instance counts or static precipitation, static coverage masks, and generated
  ripple-normal variants.

## Build Order

1. Define one shared weather envelope with time, delta time, wind, coverage,
   wetness, precipitation rate, and debug mode. Particles and surfaces must
   read the same nodes or uniform references.
2. Allocate static per-instance seeds once. Update only dynamic particle state
   with `renderer.compute()` or `renderer.computeAsync()` into
   `StorageInstancedBufferAttribute` or storage nodes created with
   `instancedArray()`.
3. Keep precipitation in a camera-wrapped volume. Wrap positions in compute or
   TSL from camera position, volume size, wind, fall speed, and seed; never let
   an emitter edge enter the shot.
4. Author surfaces as `MeshStandardNodeMaterial` or
   `MeshPhysicalNodeMaterial`. Drive color, roughness, metalness, normal,
   opacity, and displacement through node slots, not string patching.
5. Use one field per phenomenon: one snow height function feeds both
   displacement and normals; one wetness/puddle mask gates roughness, ripple
   normals, splash intensity, and debug output.
6. For rain surfaces, split early wetness from heavy-rain ripple response.
   Roughness should change before ripple normals appear.
7. For splashes, generate or compact impact candidates on the GPU when counts
   are high. Weight by world-space upward normals, reject hidden/downward
   surfaces, and animate flipbook progress without per-splash CPU rewrites.
8. Present with `RenderPipeline`. Use built-in nodes first: `GTAONode` or
   `ao()` for contact grounding, `BloomNode` or `bloom()` only for bright
   splash highlights, `TRAANode` or `traa()` when temporal stability matters,
   and `CSMShadowNode` or `TileShadowNode` for large precipitation-lit scenes.

## Required Controls

- precipitation density, rate, speed, and quality tier;
- wind direction, strength, and gust phase;
- shared weather coverage or wetness progress;
- wrapped volume size and camera-follow offset;
- wetness, snow, or puddle mask threshold and softness;
- ripple source: dynamic field, generated variant A/B/C, or disabled;
- ripple or drift normal strength;
- surface roughness and color response;
- particle, residue, and splash opacity;
- debug modes for masks, normals, particles, event buffers, and weather
  progress.

## Performance Budgets

Target these as starting budgets, then tighten for the product scene:

- Desktop discrete GPU: 100k to 300k precipitation instances, one compute
  dispatch per precipitation family, one optional event dispatch, 1 to 2 weather
  surface fields, 1.5 ms precipitation, 1.0 ms material overhead, 0.8 ms post.
- Desktop integrated GPU: 40k to 100k instances, one dispatch per family,
  generated ripple-normal variants for medium rain, 2.5 ms precipitation,
  1.5 ms material overhead, 1.0 ms post.
- Mobile or reduced tier: 8k to 40k instances, static or lower-rate compute,
  generated ripple-normal variants, <= 2 dynamic field octaves, 3.0 ms total
  weather budget.
- Storage: keep dynamic instance buffers packed to position, velocity/life, and
  seed/flags. A 100k instance system with three `vec4` storage records is about
  4.8 MB before alignment and render-target overhead.
- Passes: one beauty pass, optional MRT only when later nodes reuse depth,
  normals, wetness, or velocity; reduced-resolution post effects must use
  `PassNode.setResolutionScale()`.
- Draw calls: one draw per precipitation family, one draw per splash pool, and
  no per-drop or per-splash object allocation.

## Color And Output

- Color textures use `SRGBColorSpace`.
- Data textures, normal maps, roughness maps, masks, noise, LUTs, and weather
  fields use `NoColorSpace` or linear treatment.
- Decide mipmaps per use: pregenerated ripple-normal variants should have
  stable filtering; storage textures written by compute need explicit mip
  ownership.
- Keep HDR working buffers as `HalfFloatType` until the tone-map step.
- The node pipeline owns exactly one tone map and one output conversion through
  `outputColorTransform` or an explicit `renderOutput()` node.

## Replacement Doctrine

- Replace per-frame CPU attribute and instance-matrix rewrites with
  compute-updated storage instance data. This removes upload bandwidth and
  scales to high particle counts.
- Replace disconnected particle clocks and surface clocks with one weather
  envelope. This prevents rain, splashes, puddles, and snow coverage from
  drifting apart.
- Replace string-injected material customization with TSL node slots on
  `NodeMaterial` classes. This is the current renderer path and keeps material
  fields composable.
- Replace expensive analytic ripple evaluation on every wet pixel with dynamic
  fields only when justified; otherwise use the generated normal variants under
  `assets/generated-variants/` as the cheap tier.
- Replace local-space splash weighting with world-space normal tests and
  optional depth or occlusion rejection.

## Failure Conditions

- falling precipitation ignores the wind, time, or progress used by surfaces;
- instance positions or splash progress are rewritten on the CPU every frame;
- the precipitation volume exposes emitter edges instead of wrapping around the
  camera;
- snow height and snow normals come from different fields;
- model snow slides in world space or sticks to vertical faces;
- puddles only lower roughness without a mask, normal response, or ripple tier;
- splashes appear on downward, vertical, hidden, or transformed faces because
  normals were not evaluated in world space;
- temporal wetness is faked with unrelated noise instead of shared weather
  progress;
- color textures and data textures use the same color-space settings;
- the node pipeline double-applies tone mapping or output conversion.

## Routing Boundary

Use `$threejs-water-optics` for bounded pool simulation, caustics, Fresnel,
refraction, and Beer-Lambert water volumes. Use `$threejs-particles-trails-and-effects` for
general sparks, plasma, trails, and non-weather particles. Use
`$threejs-dynamic-surface-effects` for screen-space touch history or frost clearing.
Use `$threejs-image-pipeline` for full-frame post ownership when precipitation
is part of a larger HDR pipeline. Use `$threejs-scalable-real-time-shadows` when weather
visibility depends on large-scene shadow budgets. This skill owns
precipitation events and the surfaces they visibly alter.
