---
name: threejs-procedural-planets
description: Author scalable procedural planetary bodies in Three.js r185 native WebGPU/TSL with explicit cube-sphere/clipmap selection, conservative error-driven LOD, balanced transitions, shared causal fields, validated normals, instanced/indirect submission, and explicit atmosphere handoff.
---

# Procedural Planets

Build a planet from an explicit surface-mapping and LOD decision, not a fixed
recipe. The default globe/orbit path is a streaming cube-sphere quadtree with
2:1-balanced neighbors, continuous LOD morphing, and instanced/indirect patch
submission. A local tangent geometry clipmap can own sustained ground-scale
views; a hybrid hands it to the global quadtree. The same planet-space causes
must drive geometry, normals, material identity, scientific/query outputs,
diagnostics, and atmosphere handoff.

Any planet output consumed by dynamics, contact, navigation, water, weather,
or another physics domain must use the route's
[physics-domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
Publish typed `PhysicsSignalDescriptor` records bound to the active
`PhysicsContext` through the canonical IDs, physics frame/origin epoch,
transform/chart, `clockId`/`samplePhase`, channels, represented-footprint/
filter, validity/`perChannelError`, residency/cadence/latency, state/resource
version, and missing-channel envelope. Every `PhysicsSampleRequest` and
returned `SampledChannel.actualPhysicsTime`, including static/analytic results,
carries a direct canonical `PhysicsInstant | PhysicsTimeInterval`, never the
generic `PhysicsTime` wrapper; time is not an extra descriptor field. A
quadtree tile, render LOD, TSL function, or cache texture is never the public
physics ABI.
The planet/body-field owner is the sole state-equation owner for its
physics-facing body, gravity, static coast/bathymetry, and hydrology-analysis
revisions. Its `PhysicsGraph` stages write provisional versions; one
exact `PhysicsStageExecution` records each attempted update or analytic/state-
hold evaluation and its read/write version resolution. Dropped graph debt is a
catch-up loss-ledger entry, not a planet execution. One
`PhysicsCommitTransaction` prepares each accepted revision and one bijective
`PhysicsCommitReceipt` plus `CommitPublicationLineage` publishes it atomically.
A project coordinator may commit those prepared
versions atomically but never becomes a second owner. Do not expose a new
descriptor revision before that commit appears in `PhysicsExecutionLedger`.
When committed state is rendered, publish the immutable
`PresentationTimeCohort -> PhysicsPresentationCandidate -> CameraViewPublication ->
ViewPreparationPublication -> PhysicsPresentationSnapshot ->
PresentationRenderPlan -> admitted frame slot -> FrameExecutionRecord` chain.
The candidate stays view-independent; field
bindings carry independent previous/current provenance and leased state
handles. Camera publication owns render mapping, view preparation owns per-view
LOD/caches/shadows/resets, and the sealed snapshot references binding IDs and
leases rather than copying state or transforms. Never mutate an earlier record
to report a later phase or completion.
Treat cube-face UV, longitude/latitude, geodetic coordinates, and tangent
parameterizations as nonlinear charts, not Cartesian frames. Publish their
metric/Jacobian, domain/seam validity, and chart version; express physical
vectors in a declared orthonormal body/world frame.
When dynamics need gravity, publish a point/time vector signal in `m s^-2`;
never substitute world `-Y`, radial up, or a normalized surface normal.

Do not load this skill merely because a scene contains islands. A bounded
archipelago, coastal site, bathymetric model, or isometric land tile whose
planetary curvature, horizon, global geodesy, and orbit-to-ground transition are
outside the visual/error contract belongs to `$threejs-procedural-fields` plus
`$threejs-procedural-geometry`, with `$threejs-procedural-materials` and the
appropriate water skill as consumers. Use this skill only when the body-scale
surface map, curvature, global LOD, georeference, or atmosphere handoff is an
observable cause.

Canonical implementation contract: `examples/webgpu-quadtree-planet/`.
Run `node examples/webgpu-quadtree-planet/validate-planet.mjs` after edits.

Legacy WebGL implementation (deprecated, do not extend): `examples/procedural-planet-surface/planet-system.js` and `examples/procedural-planet-surface/terrain-field.js`.

## Required Architecture

1. Use `WebGPURenderer` from `three/webgpu`, `MeshStandardNodeMaterial` or
   `MeshPhysicalNodeMaterial`, and TSL from `three/tsl`.
2. Choose normalized cube, spherified cube, or a verified equal-area mapping
   from distortion/error requirements. For plain normalization, the derived
   area-element ratio `J_center/J_corner = 3*sqrt(3) ~= 5.196`; uniform UV
   sampling is therefore about 5.196 times denser at a corner. Never call it
   uniform. Represent global bodies as six 2:1-balanced face quadtrees with
   stable edge/corner ownership and conservative displaced bounds.
3. Generate canonical `surfaceDirection` from face/patch/grid metadata. Preserve
   it separately from displaced position. Validated mapping derivatives feed
   projected error and normals. Apply the shared
   [physical-pixel projected-error contract](../threejs-choose-skills/references/projected-error-contract.md)
   to the complete displaced patch support and every active view; altitude or
   patch-center distance alone is not an LOD metric.
4. Define shared TSL `Fn` field functions for displacement, material causes,
   gradients, queries, and diagnostics. Compute-baked and direct dynamic paths
   call the same functions; render nodes may sample their versioned cache
   outputs instead of reevaluating them. Do not maintain duplicate field math.
   Parity-bearing value-noise corners use the `lowbias32-u32-lattice` integer
   hash family: its multipliers/shifts are an **[Authored identity]**, not a
   quality claim. CPU uses `Math.imul`/`>>> 0` wrapping, and TSL uses `uint`
   arithmetic plus the exact same identity constants. Do not use
   transcendental hashes for CPU/GPU parity paths.
5. For static or slowly changing bodies, compute-bake height, tangent gradient,
   and material causes into dirty patch tiles; rendering samples the cache
   instead of reevaluating macro geology every frame. Use
   `StorageBufferAttribute`, `StorageInstancedBufferAttribute`, and r185
   `IndirectStorageBufferAttribute`/`BufferGeometry.setIndirect()` where the
   target supports the selected indirect command contract. Do not use float
   atomics for min/max; reduce floats in workgroup memory or use a proven
   ordered-integer encoding.
6. Build crater, biome, hydrology, snow/ice, volcanic, ridge, humidity, and
   temperature fields as coupled causes. Do not author isolated color noise
   after terrain. When planetary coastlines feed a water system, export the
   mean-surface, bathymetry, metric coast-distance/frame, material, version,
   and uncertainty contract from the fixed body analysis field; do not make
   the water renderer rediscover coast topology from a transient render LOD.
   Register every physics-facing body/coast/hydrology field as a typed
   `PhysicsSignalDescriptor`; the descriptor's analysis revision and error
   bounds, not the visible patch level, determine whether a consumer may use it.
   The environment/project coordinator publishes the immutable
   `EnvironmentForcingSnapshot`. Planet fields consume its exact committed
   version through graph edges; they do not synthesize a second weather state.
   `$threejs-rain-snow-and-wet-surfaces` owns precipitation transport and
   receiver-side deposition/splash/ripple/wetness/snow effects, not
   meteorological generation.
7. Filter detail by represented vertex spacing and pixel footprint. Camera
   altitude may choose policy but is not a frequency filter. Fade contribution
   strength before aliasing; do not change procedural frequency abruptly.
8. Feed the shared world/body transform, sphere or ellipsoid surface model,
   `metersPerWorldUnit`, surface altitude, and radiometric basis to
   `$threejs-sky-atmosphere-and-haze`.
9. Use `RenderPipeline` with node passes for the final stack. Prefer built-in
   `TRAANode`, `GTAONode`, `BloomNode`, `CSMShadowNode`, and `TileShadowNode`
   when they cover the need; custom nodes must beat or extend them. Default to
   output-only `mrt({ output })`; allocate normal, velocity, emissive, or other
   attachments only for implemented consumers with measured full-frame cost.

Cache-tile gutters are not fixed. Derive the source-support radius from maximum
domain-warp displacement plus the largest reconstruction, derivative-stencil,
and projected anisotropic-footprint radius, then map the gutter through
cross-face ownership.

Submission is part of the algorithm: one indexed grid is reused for every
patch at a given topology. Bin visible patches by the four-bit transition-edge
mask and submit at most one instanced/indirect draw per non-empty mask/material
group. One draw per patch is a diagnostic implementation, not the production
mobile architecture.

Read [references/planet-field-and-atmosphere-systems.md](references/planet-field-and-atmosphere-systems.md)
for the complete field contract, quadtree LOD policy, parity harness, crater
model, material assembly, atmosphere handoff, diagnostics, and performance
budgets.

## Capability Gate And Quality Tiers

Initialize the renderer before allocating compute or storage resources:

```js
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( "threejs-procedural-planets requires a native WebGPU backend" );
}
```

- Full tier: compute-generated/cached quadtree patches, storage-backed parity
  samples, GPU patch bounds, node material displacement, node post pipeline,
  and dynamic atmosphere handoff.
- Balanced tier: same architecture with lower patch density, fewer crater
  octaves, cached far-field tiles, half-resolution diagnostics, and fewer
  active node passes.
- Minimum-resident path: native WebGPU with a smaller shared grid, cached field
  tiles, CPU quadtree updates at a gated cadence, instanced topology-mask bins,
  no runtime readback, and simpler material channels. It is the same public
  field/LOD architecture, not an alternate renderer.

Any change to physics state/equations, native cadence or coupling, represented
band/footprint/filter, physical error bound, conserved inventory, stable-ID/RNG/
event policy, or physics residency is an exact `QualityTransition`, not render
LOD. Declare source/destination `PhysicsQualityStateDescriptor`s; prepare
without publication; commit a gated `ConservativeStateMap`, inventory and
ID/RNG/event-cursor mappings atomically at a step boundary; increment the
quality epoch; and retain the old leases until the declared completion join.
Reject the transition when no conservative/error-bounded map exists.

## Workload And Performance Evidence

Numeric labels: **[Derived]** follows from equations/representation;
**[Gated]** is an acceptance bound; **[Measured]** names target evidence;
**[Authored]** is a starting visual/quality choice.

The following are **[Authored] workload trials**, not device classes, budgets,
or measured claims:

| Trial | Shared grid side | Active patches | Dirty compute policy |
| --- | ---: | ---: | ---: |
| full-detail | **[Authored]** 33-65 | **[Authored]** 120-480 | **[Authored]** 1-4 dispatches/update |
| budgeted | **[Authored]** 17-33 | **[Authored]** 80-240 | **[Authored]** 0-2 dispatches/update |
| minimum-resident | **[Authored]** 17-33 | **[Authored]** 48-160 | **[Authored]** 0-1 amortized dispatch/update |

Keep the far field static. Rebuild only newly visible/dirty patch tiles,
body-identity changes, or LOD-frontier crossings. Report the **[Derived]**
triangle count `activePatches * 2 * (gridSide - 1)^2`, cache bytes, indirect
bytes, field evaluations, and overdraw; active-patch count alone hides cost.
The **[Derived]** upper bound is 16 transition-mask draws per body/material
group, not a universal scene draw budget. The product declares full-frame GPU,
CPU-submit, presented-frame p95, and peak-live-byte budgets, then validates the
compiled scene. Avoid runtime CPU readback; parity readback belongs to
validation.

## Color And Output

- LDR color art authored in sRGB uses `SRGBColorSpace`. Calibrated reflectance,
  radiance, elevation, or spectral datasets retain their declared linear/data
  encoding; do not relabel them sRGB because they look like color.
- Data textures, masks, field LUTs, crater atlases, biome tables, and generated
  diagnostic textures use `NoColorSpace`/linear data.
- Keep HDR working buffers as `HalfFloatType` until the single tone-map owner.
- The node post pipeline owns the one output conversion through
  `RenderPipeline.outputColorTransform` or an explicit `renderOutput()` node.
  Materials and effects must not double-convert.

## Non-Negotiable Constraints

- Do not use a single static high-resolution sphere as the general
  orbit-to-ground path. Choose global quadtree, local clipmap, or their hybrid
  from camera-domain and distortion evidence.
- Do not assume `normalize(cube)` is equal-area, and do not select an
  equal-area mapping without Jacobian and inverse/seam tests.
- Restrict adjacent patch levels to one, use geomorph plus one of 16 transition
  index masks, and validate cross-face/corner adjacency. Skirts may be a
  conservative emergency guard, not the crack algorithm.
- Domain-warp tangentially and renormalize; never stretch regions by radial
  coordinate drift.
- Craters need floor, wall, rim, ejecta, age/degradation, overlap behavior, and
  shared material outputs.
- Continents and biomes are region fields derived from geological and climate
  causes, not isolated threshold bubbles.
- Geometry displacement and material normals describe the same height function.
- Do not promote a fused derivative expression to an analytic-normal path until
  an independent finite-difference, automatic-differentiation, or symbolic
  oracle gates value, direction, and scale over seams, warps, craters, and clamps.
- Domain-warp gradients include the chain rule; omitting the warp Jacobian is a
  shading/displacement mismatch.
- Macro silhouette must survive altitude changes; micro detail may fade out.
- Expose field views, patch error, parity error, detail weights, and
  displacement exaggeration.
- Reject physics queries whose `PhysicsContext`, body/world frame, origin
  epoch, analysis revision, validity, footprint, or error bound does not match;
  never convert a missing or ambiguous planet sample to a plausible zero.
- A render floating-origin rebase changes only presentation transforms and its
  render-origin epoch; it never changes `physicsOriginEpoch`, body-field
  source/state revision, stable identity, or SI values.

## Completion Test

Validate at fixed cameras and **[Authored]** at least three seeds:

- unlit silhouette;
- flat albedo with atmosphere disabled;
- grazing directional light;
- orbit, horizon, and close-approach views;
- surface-map Jacobian/area report, cross-face edge/corner equality, restricted
  neighbor invariant, and all 16 transition-mask crack tests;
- biome-mask, crater-topology, normal-only, roughness-only, and patch-error
  views;
- `PhysicsGraph` stage/edge/execution rows, commit-group atomicity, and
  publication lineage for every physics-facing body/gravity/coast/hydrology
  revision;
- prepare/commit/retire evidence for every supported runtime physics-quality
  transition, including inventory, error/filter, cadence, and stable-ID maps;
- CPU query versus TSL compute parity samples with per-channel max, mean, p95,
  worst direction, and metric height error. Report normal angular error only
  after derivative correctness is independently established;
- atmosphere handoff masks and shell/post blend from
  `$threejs-sky-atmosphere-and-haze`.
- instanced/indirect surface draw count, actual triangle count, cache hit/byte
  totals, CPU/GPU p50/p95, and zero runtime readbacks.

## Routing Boundary

Use `$threejs-choose-skills` for multi-system preflight when planets are part of
a larger scene. Local islands and coastal scenes without observable planetary
curvature/global LOD route to `$threejs-procedural-fields` and
`$threejs-procedural-geometry`, not here. Use `$threejs-procedural-fields` for reusable field bundles
without a complete body, `$threejs-procedural-materials` for standalone
material authoring, `$threejs-ambient-contact-shading` for custom GTAO
work beyond the built-in node, `$threejs-scalable-real-time-shadows` for
large-world shadow policy, `$threejs-image-pipeline` for shared gbuffer,
velocity, and output ownership, `$threejs-visual-validation` for screenshot
and GPU proof, `$threejs-exposure-color-grading` for metering and tone-map
ownership, `$threejs-water-optics` for water volume optics, `$threejs-volumetric-clouds`
for cloud volumes, `$threejs-rain-snow-and-wet-surfaces` for precipitation
transport and receiver effects, and `$threejs-sky-atmosphere-and-haze` for scattering
independent of planet generation. This skill owns the coupled planetary surface
and its LOD/parity architecture. For a planetary ocean, it owns the static
reference surface, coastline, bathymetry, seabed classes, and their error
metadata; the water skill owns the time-varying free surface, flow/wave state,
foam, and optics. The environment/project coordinator owns the shared
`EnvironmentForcingSnapshot`; neither the planet nor rain skill independently
generates meteorology.
