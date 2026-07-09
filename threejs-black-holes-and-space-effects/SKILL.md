---
name: threejs-black-holes-and-space-effects
description: Build WebGPU/TSL black holes, wormholes, accretion disks, and curved-ray space effects in Three.js. Use for black-hole lensing, accretion disks, wormholes, curved-ray integration, procedural star fields, relativistic-looking distortion, bounded volumetric structures, and GPU effects that need controlled numerical integration.
---

# Black Holes and Space Effects

Treat these effects as numerical renderers with explicit integration state. The
implementation path is pinned Three.js r185 with `WebGPURenderer` from `three/webgpu`,
TSL from `three/tsl`, `NodeMaterial` materials, `RenderPipeline`, node passes,
and compute/storage where caching or diagnostics need GPU-written data. State
whether a shot uses a geodesic model, a radiative-transfer approximation, or an
art-directed deformation; numerical integration does not by itself make a
model physical.

## Model Claim Gate

| Model | Defensible claim | Required evidence |
| --- | --- | --- |
| Null geodesics derived from a named metric | Physical within that metric and its stated idealizations | Equations, units/nondimensionalization, conserved quantities, CPU `float64` reference rays, convergence |
| Ellis/Morris-Thorne ultrastatic throat in the reference | Physical geodesics for that wormhole metric; not a black-hole solution | Hamiltonian invariant and exterior-side/tetrad mapping |
| Inverse-square direction steering or UV distortion | Artistic lens-like deformation | Fixed-view visual contract and step-halving stability; no GR claim |
| Procedural disk density/emission | Art-directed participating medium | Explicit extinction/emission units and bounded integration error |
| Screen-space swirl | Image distortion | Never label it gravitational lensing |

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
5. Choose step length from distance, density, curvature, or a real local-error
   estimator. A curvature heuristic controls sampling but is not an RK error
   estimate. Use continuous event tests for disks and shells even when the step
   is clamped.
6. Accumulate radiance front-to-back with transmittance and terminate on escape,
   core absorption, saturated opacity, invalid state, or max-step cap.
7. Keep opaque scene/depth at its required resolution. A small projected bound
   may use a full-resolution scissor; broad coverage may use a measured reduced
   target away from critical curves. Reconstruct with lens-specific history
   validity and edge/Jacobian masks. Temporal history reduces stochastic/
   interleaved sampling noise; it does not repair deterministic ODE truncation
   bias.
8. Use `StorageTexture`, `StorageBufferAttribute`, or
   `StorageInstancedBufferAttribute` with `renderer.compute()` /
   `renderer.computeAsync()` for lens-map caches, per-tile bounds, temporal
   history, and diagnostics that are expensive to rebuild in a material node.
   After initialization prefer `renderer.compute()`; r185 `computeAsync()` is
   not a GPU-completion fence.
9. Compose through `RenderPipeline`, `pass()`, `mrt()`,
   `PassNode.setResolutionScale()`, `outputColorTransform`, and
   `renderOutput()`. `PostProcessing` is the renamed deprecated predecessor;
   use `RenderPipeline`. `setResolutionScale()` scales the entire pass, so do
   not apply it to the full host scene merely to reduce the lens effect.

Algorithm class dominates this skill. A fixed full-budget ray loop is the
reference cost ceiling; bounded work, accepted-step control, early termination,
and temporal amortization are the production architecture.

## Capability Gate

Any compute, storage, MRT, or reduced-resolution path starts with an explicit
backend gate:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend) {
  // Canonical path: TSL raymarch, compute/storage caches, MRT diagnostics.
} else {
  throw new Error("WebGPU backend unavailable for the canonical path.");
}
```

Do not add a second renderer branch to this flagship specification. A missing
WebGPU backend is a reported capability failure.

### r185 API Verification

Verified against the repository's installed Three.js `REVISION === "185"`:
`WebGPURenderer`, `RenderPipeline`, `StorageTexture`, and `Storage3DTexture` are
exports of `three/webgpu`; `Fn`, `Loop`, `pass`, `mrt`, `renderOutput`,
`storage`, `storageTexture`, `storageTexture3D`, and `textureStore` are exports
of `three/tsl`. `TRAANode`, `BloomNode`, and `DepthOfFieldNode` are default
exports from their `three/addons/tsl/display/*Node.js` modules. Re-run import
smoke tests when the pinned revision changes.
For temporal upscaling, r185 provides default `TAAUNode` and named `taau` from
`three/addons/tsl/display/TAAUNode.js`; `TRAANode`/`traa` is temporal AA, not an
upscaler. Explicitly configure storage texture format/type/filter/mipmap policy.

## Quality Tiers And Budgets

| Workload | Resolution | Numerical work | History/cache | Cost status |
| --- | --- | --- | --- | --- |
| Artistic accretion hero | half, full-res edge/critical mask | 96-160 midpoint/RK steps (**Authored**) | lens-valid history | Must be **Measured** per target |
| Static Ellis lens | full or reduced away from critical curve | nonuniform 1D transfer lookup plus footprint refinement | transfer LUT + optional Jacobian | Must be **Measured** per target |
| Varying metric | selected by angular/invariant/event error | adaptive accepted/rejected work is **Gated**, not tier-fixed | optional tile cache | Must be **Measured** per target |
| Background coherent lens | quarter or cached | low-rate direction-map refresh | angular invalidation | Must be **Measured** per target |
| Distant authored effect | impostor/cubemap | no geodesic claim | optional asset | Must be **Measured** per target |

Treat authored counts as initial configuration only. A tier becomes **Measured** only
when its GPU timestamp distribution, resolution, renderer revision, device,
browser, thermal state, and scene are recorded. A quality threshold is
**Gated** when it is computed from a screen-space or radiance-error limit.
Memory arithmetic and analytic error bounds are **Derived**.

Report whole-frame p50/p95 and paired marginal p50/p95 from matched frames with
the effect enabled/disabled. Do not sum pass percentiles or subtract unpaired
percentile summaries.

At half-linear 1080p, 920-step RK4 costs
`960*540*920*4 = 1,907,712,000` derivative evaluations before shading
(**Derived**). This rules out a universal mobile-time promise and motivates a
transfer LUT for the static spherical Ellis model.

Budget storage explicitly: two half-resolution `HalfFloatType` history textures
for radiance/transmittance, one reduced-resolution velocity/depth validity
input, optional one-channel step-count/termination texture for diagnostics, and
one bounded lens-map `StorageTexture` per cached view or probe. Compute bytes as
`ceil(W*s) * ceil(H*s) * bytesPerTexel * liveTextureCount` (**Derived**); do not
infer mobile feasibility from resolution scale alone.

## Algorithm Selection

| Error requirement | Occupancy/coherence | Select | Reject or escalate when |
| --- | --- | --- | --- |
| Art-directed bending; only stable silhouette required | Local bound, moderate temporal coherence | Heun/midpoint direction update, structure-limited step, segment events | Step-halving changes a fixed-view edge or termination class |
| Static spherical Ellis lens | High coherence | Nonuniform 1D transfer LUT split/refined around critical `B=1` | Interpolation or footprint angular gate fails |
| Static Schwarzschild lens | High coherence | Critical-split impact-parameter quadrature/transfer LUT plus footprint refinement | Strong-deflection interpolation or disk-event gate fails |
| Static Kerr metric and fixed view | High coherence | Separated radial/polar geodesic transfer or validated 2D screen map | Caustic/event/redshift error or camera invalidation gate fails |
| Metric geodesic; ordinary rays | Bounded domain, per-pixel evaluation | RK4 with invariant monitoring, or embedded RK pair when curvature varies | Invariant/final-direction gate fails |
| Metric geodesic near a separatrix or critical orbit | Small image region, high view coherence | Higher-accuracy compute lens map, then interpolate and invalidate by camera error | Per-pixel rejection divergence or `float32` cannot meet the angular gate |
| Static or slowly changing lens | High view/probe coherence | Cached direction/depth/Jacobian map | Camera/projection change moves the mapped direction beyond the texel-error gate |
| Sparse emitting volume | Low occupancy | Conservative tile/brick bounds plus empty-space skip | Bound lookup and divergence cost exceed saved field evaluations |
| Rapid camera/effect change | Low coherence | Current-frame march at reduced history weight | History rejection rate removes the expected amortization |

## Numerical Rules

- Do not call a UV swirl gravitational lensing. Lensing changes the final lookup
  direction after numerical integration.
- Bound the domain first; never march the full camera range for a local space
  effect.
- Use continuous segment crossing tests for thin disks, shells, throats, and
  event boundaries.
- Keep integration independent from frame rate; animated fields are inputs, not
  variable time steps.
- Nondimensionalize geodesic state with a declared length scale. Keep rendering
  distances and medium coefficients in one consistent unit system.
- For RK4 step-doubling, estimate the fine-solution local error with
  `(y_twoHalf - y_full) / 15`, scale each state component by
  `atol + rtol * max(abs(y0), abs(y1))`, and accept only when the resulting norm
  is at most one. Rejected attempts do not advance state or event accumulators.
- A heuristic such as `errorTarget / curvature` is not dimensional error
  control. Use it only as a step proposal and validate it by convergence.
- Reconstruct the escaped environment ray from the integrated tangent in an
  explicit exterior tetrad. Orbital position angle alone is not the outgoing
  ray direction.
- Root-refine escape/core/disk events and bound any metric tail outside the
  proxy. A step that overshoots the boundary is not an accurate exit state.
- For the dimensionless Ellis model `B=b/a`, classify `B<1` traversal, `B>1`
  turning, and the critical `B=1` light ring. A capped critical ray is not an
  escaped ray.
- Use deterministic star/environment data for validation, then replace only
  after fixed-camera tests pass.
- Track termination reason, accepted step count, accumulated opacity,
  remaining transmittance, final environment direction, and invalid-state mask.
- Run independent CPU `float64` reference rays for numerical parity with a
  declared metric before treating the result as more than an artistic
  approximation.
- Gate the GPU against termination class, exterior side, invariant drift,
  event count/location, and final angular error. A capped or minimum-step ray is
  invalid evidence, not a visually plausible success.
- Reject temporal history across termination/exterior changes, critical/Jacobian
  discontinuities, disk animation, or large bent-direction residuals. Generic
  mesh velocity/depth alone is insufficient for a lens.

For emitting media, let `sigma_t` be extinction in inverse scene-length units,
`j` emission/source density in radiance per scene-length, and
`tau = sigma_t * ds` dimensionless. A constant segment contributes
`T * (j / sigma_t) * (1 - exp(-tau))`; use the `j * ds` limit as `sigma_t`
approaches zero. If code instead multiplies `segmentEmission` by alpha, document
that value as the source function `j / sigma_t`, not an emission coefficient.

## Color And Output

- LDR PNG/JPEG star/environment color authored in sRGB uses `SRGBColorSpace`.
  HDR/EXR or procedurally generated radiance remains in the declared linear
  working color space; do not tag every environment as sRGB.
- Noise, density, masks, lens maps, LUTs, step counts, and termination IDs use
  `NoColorSpace` or linear data settings.
- Accumulate radiance and transmittance in linear HDR buffers. Use
  `HalfFloatType` working targets until tone mapping.
- The app has exactly one tone-map owner and one output conversion owner. The
  node pipeline owns output conversion through `outputColorTransform` or an
  explicit `renderOutput()` node. With explicit `renderOutput()`, set
  `renderPipeline.outputColorTransform = false`; set
  `renderPipeline.needsUpdate = true` after changing diagnostic `outputNode`.

## References

Read [references/curved-ray-integrators.md](references/curved-ray-integrators.md)
for the WebGPU/TSL architecture, RK4 wormhole state reduction, artistic
curved-ray accretion integrator, continuous disk crossing, compute/storage
caches, diagnostics, and validation requirements.

Canonical WebGPU lab: `examples/tsl-curved-ray/`. It retains the artistic
bounded accretion shader and adds GPU-sampled, critical-split Ellis and
Schwarzschild direction-transfer stages, a compute direction cache, and
termination-aware temporal ping-pong. Independent float64 Ellis quadrature and
Schwarzschild Hamiltonian rays gate the generated tables. These CPU/source
checks do not replace the native-browser readback/timestamp evidence required
by `lab.manifest.json`.

Legacy WebGL implementation (deprecated, do not extend): `examples/curved-ray-accretion-volume/curved-ray-effect.js`

## Routing Boundary

Use `$threejs-particles-trails-and-effects` for ordinary particles, trails, plasma, and event
effects. Use `$threejs-volumetric-clouds` for weather-density volumes,
`$threejs-sky-atmosphere-and-haze` for planetary scattering,
`$threejs-bloom` and `$threejs-exposure-color-grading` for post effects, and
`$threejs-visual-validation` for fixed-view visual contracts. This skill owns
per-pixel numerical ray integration through curved or bounded space-effect
domains.
