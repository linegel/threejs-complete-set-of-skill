---
name: threejs-black-holes-and-space-effects
description: Build WebGPU/TSL black holes, wormholes, accretion disks, and curved-ray space effects in Three.js. Use for black-hole lensing, accretion disks, wormholes, curved-ray integration, procedural star fields, relativistic-looking distortion, bounded volumetric structures, and GPU effects that need controlled numerical integration.
---

# Black Holes and Space Effects

Treat these effects as numerical renderers with explicit integration state. The
implementation path is latest Three.js with `WebGPURenderer` from `three/webgpu`,
TSL from `three/tsl`, `NodeMaterial` materials, `RenderPipeline`, node passes,
and compute/storage where caching or diagnostics need GPU-written data.

## Performance-First Build Order

1. Use `$threejs-choose-skills` preflight when the request also touches
   atmosphere, bloom, temporal reconstruction, shadows, or validation.
2. Define a bounded effect volume in local space and intersect the camera ray
   with that volume before any march work.
3. Run the raymarch as a TSL `Fn` attached to a `MeshBasicNodeMaterial` or a
   compute pass; keep the integrator and disk/throat/shell shading as separate
   node functions.
4. Advance the ray exactly once per accepted iteration. Do not copy the
   historical double-advance defect from the legacy example.
5. Choose step length from distance, density, curvature, or error estimators.
   Clamp by thin-structure crossing distance so disks and shells cannot be
   skipped.
6. Accumulate radiance front-to-back with transmittance and terminate on escape,
   core absorption, saturated opacity, invalid state, or max-step cap.
7. March the hero effect at half or quarter resolution by default, then use
   depth/velocity-aware temporal accumulation and upsample into the node post
   pipeline.
8. Use `StorageTexture`, `StorageBufferAttribute`, or
   `StorageInstancedBufferAttribute` with `renderer.compute()` /
   `renderer.computeAsync()` for lens-map caches, per-tile bounds, temporal
   history, and diagnostics that are expensive to rebuild in a material node.
9. Compose through `RenderPipeline`, `pass()`, `mrt()`,
   `PassNode.setResolutionScale()`, `outputColorTransform`, and
   `renderOutput()`. `PostProcessing` is the renamed deprecated predecessor;
   use `RenderPipeline`.

Algorithm class dominates this skill. A fixed full-budget ray loop is the slow
baseline; bounded adaptive marching plus early termination and temporal
amortization is the production architecture.

## Capability Gate

Any compute, storage, MRT, or reduced-resolution path starts with an explicit
backend gate:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend) {
  // Full path: TSL raymarch, compute/storage caches, MRT diagnostics.
} else {
  throw new Error("WebGPU backend unavailable for the canonical path.");
}
```

Only when the user explicitly asks how to apply fallback when WebGPU is
unavailable, route that teaching to `../threejs-compatibility-fallbacks/` after
the canonical WebGPU/TSL owner and visual contract are known. Do not make
fallback for unavailable WebGPU a default branch in this skill.

## Quality Tiers And Budgets

| Tier | Resolution | Steps | Temporal frames | Target cost |
| --- | --- | --- | --- | --- |
| Hero | half res, optional full-res center | 96-160 adaptive accepted steps | 8-16 with velocity/depth rejection | 1.8-2.8 ms desktop discrete, 4-6 ms integrated, 7-9 ms mobile |
| Standard | half res | 48-96 adaptive accepted steps | 8-12 | 0.8-1.5 ms desktop discrete, 2-3 ms integrated, 4-5 ms mobile |
| Background | quarter res or cached lens map | 24-48 accepted steps or low-rate compute refresh | 12-24 | 0.3-0.7 ms desktop discrete, 0.8-1.4 ms integrated, 1.5-3 ms mobile |
| Distant | impostor, cubemap, or precomputed `assets/generated-variants/` texture | 0-16 | optional | under 0.25 ms desktop discrete, under 0.75 ms integrated/mobile |

Budget storage explicitly: two half-resolution `HalfFloatType` history textures
for radiance/transmittance, one reduced-resolution velocity/depth validity
input, optional one-channel step-count/termination texture for diagnostics, and
one bounded lens-map `StorageTexture` per cached view or probe.

## Numerical Rules

- Do not call a UV swirl gravitational lensing. Lensing changes the final lookup
  direction after numerical integration.
- Bound the domain first; never march the full camera range for a local space
  effect.
- Use continuous segment crossing tests for thin disks, shells, throats, and
  event boundaries.
- Keep integration independent from frame rate; animated fields are inputs, not
  variable time steps.
- Use deterministic star/environment data for validation, then replace only
  after fixed-camera tests pass.
- Track termination reason, accepted step count, accumulated opacity,
  remaining transmittance, final environment direction, and invalid-state mask.
- Run CPU reference rays for wormhole or physical-parity claims before treating
  the result as more than an artistic approximation.

## Color And Output

- Color textures such as star fields and environment maps use `SRGBColorSpace`.
- Noise, density, masks, lens maps, LUTs, step counts, and termination IDs use
  `NoColorSpace` or linear data settings.
- Accumulate radiance and transmittance in linear HDR buffers. Use
  `HalfFloatType` working targets until tone mapping.
- The app has exactly one tone-map owner and one output conversion owner. The
  node pipeline owns output conversion through `outputColorTransform` or an
  explicit `renderOutput()` node.

## References

Read [references/curved-ray-integrators.md](references/curved-ray-integrators.md)
for the WebGPU/TSL architecture, RK4 wormhole state reduction, artistic
curved-ray accretion integrator, continuous disk crossing, compute/storage
caches, diagnostics, and validation requirements.

Canonical WebGPU/TSL example: `examples/tsl-curved-ray/`

Legacy WebGL implementation (deprecated, do not extend): `examples/curved-ray-accretion-volume/curved-ray-effect.js`

## Routing Boundary

Use `$threejs-particles-trails-and-effects` for ordinary particles, trails, plasma, and event
effects. Use `$threejs-volumetric-clouds` for weather-density volumes,
`$threejs-sky-atmosphere-and-haze` for planetary scattering,
`$threejs-bloom` and `$threejs-exposure-color-grading` for post effects, and
`$threejs-visual-validation` for fixed-view visual contracts. This skill owns
per-pixel numerical ray integration through curved or bounded space-effect
domains.
