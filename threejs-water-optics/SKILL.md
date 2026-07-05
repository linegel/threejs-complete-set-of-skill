---
name: threejs-water-optics
description: Build production WebGPU/TSL analytic and bounded water in Three.js. Use for compute StorageTexture heightfield simulation, TSL shared multi-wave displacement and normals, local drops, object ripples, differential-area caustics, depth-aware node refraction, NodeMaterial water optics, Beer-Lambert absorption, side-aware Fresnel, derivative-filtered normal bands, analytic sky reflection, and crest foam.
---

# Water Optics

Start with `$threejs-choose-skills` preflight when water interacts with a larger
scene stack. Treat water as simulated state, geometry motion, surface
orientation, and optical transport. A blue transparent material is not a water
system.

Use this skill to integrate a WebGPU water module into an existing Three.js
project. Do not replace the host app. The host owns scenes, camera, controls,
assets, transparent ordering, post-processing, physics, networking, and masks.
The water module owns GPU-resident simulation, surface shading, depth-aware
refraction inputs, impulses, surface queries, and diagnostics.

For large stochastic seas driven by directional spectra and GPU FFTs, use
`$threejs-spectral-ocean` instead.

## Host Integration Contract

Minimum shape:

```js
const water = await createWebGPUBoundedWaterSystem(renderer, {
  sceneColorScene: opaqueSceneWithoutWater,
  camera,
  tier: "high",
  parameters: preset.simulation,
  timeNode: fixedTickTimeNode,
});

scene.add(water.mesh);

function frame(deltaSeconds) {
  fixedClock.step(deltaSeconds, (fixedDt, tick) => {
    water.update(fixedDt);
    buoyancy.update(waterQuery, fixedDt, tick);
    spray.update(waterQuery, fixedDt, tick);
  });

  water.pipeline?.render();
  renderer.render(scene, camera);
}
```

The water mesh must not be in the opaque prepass scene it samples for
refraction. Transparent host objects are normally excluded from that prepass and
rendered after water unless the project implements a separate
order-independent-transparency path.

## Mandatory Architecture

The production path is latest Three.js `WebGPURenderer` from `three/webgpu`,
TSL from `three/tsl`, `MeshPhysicalNodeMaterial` or
`MeshStandardNodeMaterial`, `StorageTexture` compute ping-pong, and the node
render pipeline. Build the highest-throughput algorithm first:

1. Simulate bounded water in ping-ponged `StorageTexture` state with
   `Fn().compute(count)` and `renderer.compute()` or
   `renderer.computeAsync()`. Use a fixed timestep, no CPU readback, no
   render-pass simulation.
2. Store height, previous height or velocity, packed normal/slope, validity,
   and caustic intensity in storage textures. Run drops, object impulses,
   propagation, normal reconstruction, and differential-area caustics in the
   same compute chain.
3. Compute caustics from the local Jacobian/differential area with
   `max(area, epsilon)`, finite intensity clamps, and invalid-value
   diagnostics.
4. Evaluate authored multi-wave displacement and analytic normals once as TSL
   functions shared by vertex displacement, lighting normals, crest metrics,
   foam, CPU-side camera clearance approximations, and debug views.
   Export the CPU coupling shape for the analytic component:
   `getWaterHeight(x, z, timeSeconds)`. This CPU evaluator imports the same
   `AUTHORED_WAVES` list used by the TSL displacement path and has zero
   analytic parity error. The compute `StorageTexture` heightfield residual is
   not read back; its coupling gap is bounded by the declared impulse budget
   `dropStrength + objectDisplacementScale` in
   `examples/webgpu-bounded-water/constants.js` and the
   `estimateWaterVerticalAmplitude()` mesh-bounds calculation in
   `examples/webgpu-bounded-water/webgpu-bounded-water.js`.
5. Composite the water through a `RenderPipeline`: use `pass()`, `mrt()` where
   the scene needs shared color/depth/normal data, `PassNode.setResolutionScale()`
   for reduced-resolution effects, and one final `outputColorTransform` or
   `renderOutput()` owner.
6. Refract against scene color plus depth in TSL. Reject foreground samples,
   clamp screen UVs, fade invalid refraction to analytic sky/body color, and
   report the invalid fraction in diagnostics.
7. Blend reflection, refraction, absorption, glints, caustics, and foam through
   side-aware Fresnel and an explicit energy budget.
8. Expose integration contracts for presets, quality tiers, buoyancy queries,
   deterministic ticks, spray probes, transparent ordering, screen-space masks,
   and host-owned post-processing. These are host/module contracts, not a
   monolithic library API.

Legacy WebGL implementation (deprecated, do not extend): `examples/analytic-wave-optics/water-system.js`, `examples/interactive-pool-volume/water-volume-system.js`.

## Capability Gate

Use one renderer path and degrade by quality tier, not by alternate shader
stacks:

```js
const renderer = new WebGPURenderer({ antialias: false });
await renderer.init();

if (renderer.backend.isWebGPUBackend) {
  await renderer.computeAsync([dropNode, propagateNode, normalCausticNode]);
} else {
  throw new Error('WebGPU backend unavailable for the canonical water optics path.');
}
```

Quality tiers are resource and feature budgets inside the same WebGPU path:

| Tier | Backend condition | Heightfield | Analytic bands | Refraction | Caustics |
| --- | --- | ---: | ---: | --- | --- |
| Ultra | WebGPU discrete | 512-1024 square | 5 displaced + 4 micro | full-res depth-aware | compute differential area |
| High | WebGPU integrated/discrete | 256-512 square | 4 displaced + 3 micro | depth-aware or half-res depth-aware | compute differential area |
| Medium | WebGPU integrated | 192-256 square | 3-4 displaced + 1 micro | half-res depth-aware | compute differential area |
| Low/Budgeted | WebGPU mobile or low-power | 128-256 square | 2-3 bands | clamped depth-aware or body color | lower-resolution computed caustics |

If the user explicitly asks how to apply fallback when WebGPU is unavailable,
route that teaching to `../threejs-compatibility-fallbacks/` instead of adding
it to this flagship path.

Runtime quality changes are resource rebuilds. Preserve host-level state across
the rebuild: authoritative tick, active preset, registered buoyancy objects,
spray emitters, masks, transparent ordering, and post-processing output owner.

## Integration Features

Presets are data bundles. They configure water simulation, optics, foam, spray
defaults, and optional quality preference. Sky, lighting, fog, and grading stay
host-owned; a preset may provide host hints, but it must not take scene
ownership.

Buoyancy is host/physics code using a stable surface query:

```js
const y = waterQuery.getWaterHeight(x, z, tick * stepSize);
```

Keep active buoyancy samples under 128 unless the project states another
budget. Multi-point hulls use stable local-space samples; single-point floats
scale by object count. Do not read GPU heightfield textures back each frame.
Submit object motion back to the GPU with an impulse contract such as
`setObjectImpulse({ oldCenter, newCenter, radius, strength })`.

Deterministic multiplayer uses integer ticks:

```js
waterClock.syncToTick(authoritativeTick);
water.update(fixedStepSeconds);
```

Shader time is `tick * fixedStepSeconds`. Cap catch-up steps, hash seeded drops
and spray jitter from integers, and document tick wrap.

Spray is an emitter/probe system coupled to the surface query. Probes live in
object-local space and fire on signed-distance crossings whose impact speed
exceeds `velocityThreshold`. System defaults are overridden by emitter values,
then probe values. Probe indices stay stable when probes are disabled.

Screen-space masking requires a host-owned mask registry and a water material
mask sample. Mask meshes are invisible in the main scene, rendered into a
`NoColorSpace` screen-space texture before water, and sampled by the water
material to discard or fade masked fragments. A registry without a mask texture
and material hook is not complete masking.

Host-owned post-processing order is: opaque color/depth prepass, water
refraction/absorption/reflection/foam, depth-dependent underwater haze or fog,
anti-aliasing, bloom/glints, grading, final output transform.

## Performance Budgets

Budget the water before styling it:

| Target | Simulation | Storage | Passes | Draws | Frame budget |
| --- | --- | --- | --- | ---: | ---: |
| Desktop discrete | 512 square, 2-4 compute dispatches, 8x8 or 16x16 workgroups | 3-5 RGBA half-float storage textures, about 6-10 MiB at 512 | scene MRT + water + caustic/lighting + output | 1-3 | 0.6-1.5 ms |
| Desktop integrated | 256-384 square, 2-3 dispatches | 3-4 RGBA half-float storage textures, about 1.5-4.5 MiB | half-res refraction/caustics where possible | 1-3 | 1.0-2.5 ms |
| Mobile WebGPU | 128-256 square | 2-3 compact textures | reduced refraction, lower-resolution caustics | 1-2 | 1.5-3.5 ms |

Keep simulation resolution independent of canvas resolution. Update static
parameters once, then update only drops, object impulses, propagation, normals,
and caustics per fixed step. Prefer fewer, fused compute dispatches over many
single-purpose passes when storage hazards allow it.

## Color And Output

- Color textures and environment maps use `SRGBColorSpace`.
- Height, velocity, normals, slope, caustic fields, masks, LUTs, and noise use
  `NoColorSpace`/linear data.
- Keep HDR working buffers as `HalfFloatType` until tone mapping.
- The node pipeline owns the only tone mapping and output conversion through
  `outputColorTransform` or a final `renderOutput()` node.
- Water materials and caustic nodes must not apply their own output conversion.
- Generate mipmaps only for sampled color/environment or prefiltered caustic
  variants; storage state used by compute normally keeps mipmaps disabled or
  explicitly generated by compute.

## Reference

Read [references/water-surface-system.md](references/water-surface-system.md)
for the exact WebGPU/TSL build contract: storage heightfields, analytic
multi-wave functions, normal filtering, differential-area caustics,
depth-aware refraction, quality tiers, diagnostics, and replacement notes.

Canonical WebGPU/TSL example: [examples/webgpu-bounded-water](examples/webgpu-bounded-water).

## Failure Conditions

- simulation state is read back to the CPU each frame;
- normal texture motion does not agree with displaced crests;
- bounded caustics are decorative projections detached from simulated height
  normals and differential area;
- caustic area division lacks epsilon clamps and finite-value diagnostics;
- refraction samples foreground objects without rejection and a documented
  invalid-sample policy;
- approximate path length is presented as reconstructed scene thickness;
- micro-waves alias into sparkling noise because derivative filtering is absent;
- foam is a scrolling texture unrelated to the shared crest metric;
- buoyancy uses per-frame GPU readback instead of an analytic or budgeted
  surface query;
- deterministic mode uses wall-clock time or uncapped catch-up instead of
  authoritative integer ticks;
- spray emitters are visual-only particles detached from surface crossings;
- transparent objects are included in the opaque refraction prepass by default;
- screen-space masks are claimed without a mask texture and water material hook;
- post-processing lets water own the final output transform inside a host stack;
- Fresnel is replaced by constant opacity;
- reflection, refraction, glints, crest tint, transparency, and foam are added
  without an energy budget;
- tone mapping or color conversion is applied more than once.

## Routing Boundary

Use `$threejs-spectral-ocean` for stochastic directional spectra, FFT cascades,
Jacobian breaking, and persistent ocean foam. Use
`$threejs-rain-snow-and-wet-surfaces` for rain-driven puddle wetness, ripple masks,
and weather-coupled splashes on ground surfaces. This skill owns authored
analytic waves, bounded compute heightfield simulation, differential-area
caustics, pool-volume optical cues, and bounded-water optics.
