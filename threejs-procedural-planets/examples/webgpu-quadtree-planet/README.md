# Native WebGPU Quadtree Planet Lab

This directory contains the canonical six-face planet implementation and its
browser-free numerical gates. Its acceptance status remains **incomplete** until
the native-WebGPU browser capture, readback, lifecycle, and timing bundle passes.

## What the fixture proves

| Claim | Evidence | Status |
|---|---|---|
| CPU `planetFields()` schema | Key-presence assertions only | **Executed structural check** |
| CPU golden regression | Exact preset x seed x direction Cartesian product over `PLANET_PARITY_CHANNELS` | **Executed numeric fixture** |
| CPU/TSL field parity | Exact, nonempty, duplicate-free Cartesian-product WebGPU readback, when `planet-readback.json` is supplied | **Conditional numeric evidence** |
| Stable spherical crater distance | `atan2(length(cross(n,c)), dot(n,c))` CPU/TSL fixtures | **Executed equation** |
| Six-face frontier, adjacency, and 2:1 balance | Horizon-aware camera selection plus indexed cube-edge matching over the complete leaf set | **Executed CPU numeric fixture** |
| Projected error and altitude behavior | Physical-pixel projection of analytic sector bounds; close/far level selection and max-level saturation gates | **Executed CPU numeric fixture** |
| Transition stitching/geomorphing | Four-sample next-coarser bilinear stencils; transition edges force the exact coarse chord | **Executed topology/numeric fixture** |
| Patch bounds compute | Real `ComputeNode` with storage input/output records and reconciled byte/dispatch accounting | **Graph executed; native GPU readback incomplete** |
| Field atlas | Derived gutters, patch-local mips, dirty patch indices, real compute nodes, and live NodeMaterial consumption | **Graph executed; native GPU readback incomplete** |
| Patch submission | One indexed geometry group per selected leaf, with one shared material graph | **Executed resource/draw-range fixture; browser draw proof incomplete** |
| Gas and ice giants | Independent live body modes; combined route creates both materials/meshes simultaneously | **Graph executed; browser image proof incomplete** |
| Atmosphere handoff | Shared metric radii, body/world matrices, ECEF, altitude, and world-up queries | **Executed CPU numeric fixture** |
| Generated crater-mask integrity | PNG dimensions, byte lengths, hashes, nonconstant channels, and `NoColorSpace` | **Executed asset checks only** |
| Native-WebGPU render/readback, crack-free raster output, lifecycle, and timing | Requires the canonical browser capture profile | **Not run in this remediation** |

The optional WebGPU readback proves only the eight channels enumerated by
`PLANET_PARITY_CHANNELS`; full CPU schema coverage is explicitly machine-demoted.
It does not prove native-adapter timing, rendered crack freedom, derivative
normal correctness, or full-frame visual acceptance.

## Physical and numerical contracts

- Body and atmosphere radii are authored in kilometres. Convert scattering
  coefficients and integration lengths to one common unit before coupling the
  atmosphere. A radius override rebases the spherical atmosphere bottom to the
  same reference radius and preserves the preset shell thickness. Rendering
  scale is explicit through `metresPerRenderUnit`.
- Height is a signed dimensionless field. The example displacement relation is
  `height * terrainAmplitudeRadiusFraction * radiusKm`.
- Solid-body fields use normalized 3D directions, not latitude/longitude, so
  there is no polar coordinate singularity.
- Spherical crater distance uses stable `atan2`; exact coincidence and antipode
  select a documented zero subgradient because geodesic distance is not
  differentiable there.
- CPU/GPU parity thresholds are **Gated** regression tolerances, not derived
  global accuracy bounds.
- Detail-band filtering depends on vertex spacing and projected pixel footprint,
  not fixed camera altitude. The `2`/`4` sample transition is an **Authored**
  reconstruction trial that products must tune with aliasing sweeps.
- The fused derivative candidate reduces full-field calls from four to one.
  That is only a **Derived call-count fact**. The candidate is excluded from
  GPU parity and production normals because an independent derivative gate has
  not passed.
- Cache gutters are derived as
  `ceil(warpReach + max(reconstructionRadius, derivativeRadius, projectedFootprintRadius))`.
  One texel is not a universal gutter.
- The default pass descriptor is output-only `mrt({ output })`. Normal and
  velocity attachments require an implemented consumer and measured cost.
- GGX specular AA combines only unresolved material-normal residual variance:
  `roughness = pow(clamp(baseRoughness^4 + variance, alphaMin^2, 1), 0.25)`.
  `roughnessCause` is an authored material cause, not measured normal variance.

## LOD and submission obligations

The CPU quadtree helper matches edge segments in cube space, including adjacent
cube faces, and derives the four-bit transition mask (`north=1`, `east=2`,
`south=4`, `west=8`). Sixteen masks are therefore the complete representation
for one body/material identity; they are not a universal scene draw budget.

The canonical runtime now:

1. selects every visible leaf from physical render-target height and unjittered camera parameters;
2. bounds the spherical sector and the explicit `[-amplitude,+amplitude]` radial range;
3. globally enforces reciprocal cross-face adjacency and 2:1 balance;
4. morphs child vertices to the next-coarser bilinear representation between split/merge thresholds;
5. forces transition-edge odd vertices onto the same coarse chord;
6. submits one indexed draw group per leaf while sharing one material graph.

The remaining evidence obligation is native-WebGPU raster/readback, lifecycle,
resource, and p50/p95 validation. The authored maximum-surface-slope value also
remains an explicit input until a formal field Lipschitz bound is checked in.

`WORKLOAD_TRIALS` contains **Authored** full-detail, budgeted, and
minimum-resident starting points. They are workload inputs, not desktop/mobile
device classes and not acceptance budgets.

## Validation

Run structural/equation checks while explicitly allowing absent GPU evidence:

```sh
node threejs-procedural-planets/examples/webgpu-quadtree-planet/validate-planet.mjs --allow-missing-gpu
```

`npm run validate:unit` executes the browser-free topology, bounds, atlas,
material graph, unit-handoff, routing, and field checks. `npm run
test:mutations` corrupts numeric invariants independently. `npm run
validate:strict` still requires current native-WebGPU readback.

Generate native-WebGPU numeric parity evidence and validate it strictly:

```sh
cd threejs-procedural-planets/examples/webgpu-quadtree-planet
node capture-planet-readback.mjs
```

The capture renders two raw TSL field packs into a 1x1 float target for the
exact preset x seed x direction product and writes `artifacts/planet-readback.json`.
Strict validation fails on missing, duplicate, or extra probes; extra field
channels; an artifact from another algorithm version; or a channel-specific
**Gated** tolerance violation.

Static crater-asset checks run separately:

```sh
node threejs-procedural-planets/examples/webgpu-quadtree-planet/validate-generated-craters.mjs
```

This checks bytes and channel ranges only. `generated-craters.html` is a manual
Canvas2D asset preview; it does not produce WebGPU, pipeline, lifecycle, timing,
or visual-acceptance evidence.

## Required product evidence

Before promotion to `accepted`, capture the existing browser controller with
fixed camera, seed, time, tier, viewport, and DPR contracts; validate final,
LOD, transition, atlas, gas, and ice targets; run cross-face/altitude sweeps,
50–100 lifecycle cycles, renderer/resource inventories, and current-adapter
p50/p95 timing. Generated crater masks remain secondary asset diagnostics.
