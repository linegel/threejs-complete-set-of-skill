# Planet Solid Fields and Coast

Read this reference when implementing solid-body causal fields, cache and
CPU/TSL parity, geology, materials, normals, or a planetary coast/water
handoff.

## Contents

1. Shared fields, cache, and parity
2. Geological and material mechanisms
3. Planetary coast and water handoff
4. Materials and output

## 1. Shared Fields, Cache, and Parity

Define one field schema whose functions are shared by displacement, materials,
queries, diagnostics, and cache generation. A solid-body bundle commonly
contains:

```text
reference point and normal
height and tangent gradient
macro regions, ridges, and crater components
temperature, humidity, hydrology, snow, and ice causes
land/water and material-class causes
roughness/wetness/emission causes
debug channels
```

Keep macro silhouette, meso shape, and filtered material microdetail separate.
Material-only microdetail does not alter coast identity, query height, or body
LOD.

### Coordinates and cache

The following coordinate recipe is spherical, with a finite positive radius
and normalized direction. It is not an ellipsoid-height formula. Build its
fields from the unit surface coordinate plus physical scale:

```text
pMeters = surfaceDirection * radiusMeters
warp = fieldNoise(pMeters * frequencyPerMeter, seed)
tangentWarp = warp - surfaceDirection * dot(warp, surfaceDirection)
warpedDirection = normalize(pMeters + tangentWarp * warpMeters)
```

For an ellipsoid, use the selected body mapping's reference point p0 and normal
N0, not `radiusMeters*direction`. Normal-height displacement is `X = p0 + h*N0`;
its tangents include `p0_u + h_u*N0 + h*N0_u` and the corresponding v term.
A sphere's compact normal expression cannot be substituted for this curvature.
Tangent warps use the matching surface metric and a declared projection/retraction.

At body scales retain an anchor plus local residual or a validated cell/fraction
representation through field evaluation. Forming a large f32 world position
and then subtracting an anchor cannot recover lost centimeters. Quantify ULP
and mapping error over the accepted domain, including near-face sampling and
intermediate normalized directions, rather than claiming f32 parity is enough.

For static or slowly changing fields, compute height, validated tangent
gradient, material causes, and conservative min/max only when a patch enters or
its dependency key changes. The key includes body identity, seed, mapping,
patch ID/level, field constants, source datasets, edits, cache format, and
source versions. Camera, light, exposure, and atmosphere changes leave geology
clean.

Populate cross-face gutters from canonical neighbor ownership. Scalars may be
copied through the matched mapping, but vectors/gradients/normals need a shared
body basis or explicit face-basis transformation before interpolation.

Compose the full support of each reader path. After converting every operator's
reach to the same texel metric, sum along each serial path, then take the maximum
across independent reader paths:

```text
pathReach[p] = sum(operatorReachTexels[p,j])
g = ceil(max_p(pathReach[p]))
```

Include warp reach, derivative stencils, reconstruction filters, and anisotropic
sampling wherever they occur in that path. Nonlinear mappings need conservative
pullback/Jacobian bounds; raw radii from different domains cannot simply be added.
Two serial radius-2/radius-3 filters require radius 5, not max(2,3).

A reduction of point samples does not create a continuous bound. Bound each
finest cell from analytic/interval/derivative information or the complete support
of its admitted interpolant, with warp and quantization margins, then reduce.
Validate metric quantization error for the selected encoding. Publish only when
the frozen dependency key still matches the current required generation; retain
newer dirty state when old work completes. Use a fence-safe allocator and keep
every in-flight read tile immutable.

### CPU/TSL parity

Use one schema and one set of integer identity constants for CPU and TSL
builders. A parity-bearing lattice hash uses explicit `u32` wraparound; CPU
uses `Math.imul`/`>>> 0`, and TSL uses `uint` arithmetic with the same shifts and
multipliers. Apply declared f32 rounding in the CPU oracle where appropriate,
but do not infer exact cross-device integer-to-f32 conversion from Math.fround.
Use the procedural-fields helper's exact high-24-bit normalized value or compare
raw u32 hashes separately under a declared numeric bound. A normalization change
is a field/schema revision and invalidates dependent cached products.

Test a complete seed x direction x published-channel product, including face
edges/corners, steep gradients, coast thresholds, and cache/direct paths.
Report per-channel maximum, mean, p95, worst direction, and metric height error.
Numeric value parity does not establish derivative correctness.

## 2. Geological and Material Mechanisms

### Geodesic craters

A crater record carries center direction, angular radius, floor depth, wall and
rim parameters, ejecta, age/degradation, and stable identity. On a sphere:

```text
c = clamp(dot(n, center), -1, 1)
s = length(cross(n, center))
theta = atan2(s, c)
q = theta / angularRadius
towardCenter = (center - c*n) / s   # nondegenerate interior only
gradSphere(theta) = -towardCenter
gradSphere(q) = -towardCenter / angularRadius
```

Require finite unit directions and a positive finite angular radius with a
compact support kept away from the antipodal singularity. Evaluate outside-support
and exact-center branches before division. A C1 radial profile must satisfy
`profile'(0) = 0`; merely setting its gradient to zero at one point does not
make a conical center differentiable. Join height and derivative at every
floor/wall/rim and compact-support boundary. Use analytic limits or a validated
series near zero rather than an epsilon denominator that changes the derivative.
An ellipsoid uses an inverse-geodesic or a locally gated metric approximation.
Bin crater support in a spherical or cube-face hierarchy, including cross-face overlap; publish list overflow
behavior. Deterministic overlap follows a declared commutative blend or an
ordered age-and-ID operator.

### Detail filtering

Derive represented spacing:

```text
nominalVertexSpacingMeters = patchArcLengthMeters / (gridSide - 1)
pixelFootprintMeters = worldLengthOfOnePixelAtSurface * metersPerWorldUnit
representedScaleMeters = max(actualVertexFootprintMeters, pixelFootprintMeters)
```

Use the actual two-axis mapped/warped footprint, not a single nominal arc
spacing, when cube distortion or anisotropy matters. Carry all terms in meters
before comparing wavelength. Vertex and pixel restrictions are distinct and
must both admit any displacement/shading band they consume.
Attenuate a detail wavelength before aliasing; fade amplitude and channel
participation while keeping frequency stable. Macro silhouette remains in
geometry while unresolved detail migrates to filtered normal and roughness
causes.

### Climate, hydrology, and material identity

Derive visual or scientific fields from named causes. A fixed body-wide
analysis graph owns drainage and coast topology so quadtree split/merge cannot
move rivers or shorelines. Keep a sharp physical land/water edge and, when
needed, a broader footprint-filtered visual edge.

Geometry displacement and material normals use the same height field. For a
sphere with intrinsic tangent gradient `g`:

```text
X = (R + h) * n
N = normalize(n - g / (R + h))
```

If `p = R*n`, convert a metric gradient with
`g = R*(I-n*n^T)*grad_p(h)`. Patch-UV gradients require the mapping metric.
Require positive finite `R+h` and a finite intrinsic gradient. For ellipsoids
use the differentiated normal-height map instead. For domain warp `p' = p + w(p)`,
include the chain rule:

```text
grad_p f = (I + J_w)^T * grad_p' f
```

A normalized/projected surface warp also includes that normalization/projection
Jacobian; `(I+J_w)` alone describes only the unprojected additive map.
Validate analytic or automatic gradients against an independent finite-
difference, automatic-differentiation, or symbolic oracle over seams, warps,
craters, and clamps.

Specular anti-aliasing absorbs unresolved material-normal residual variance,
not resolved body curvature or macro slope. Three.js GGX uses
`alpha = perceptualRoughness^2`; combine filtered residual slope moments in that
domain, then gate highlight energy and temporal shimmer against supersampled
references.

## 3. Planetary Coast and Water Handoff

The body owner publishes a fixed-analysis coast sample with:

```text
reference point and normal
terrain/seabed height and mean sea-surface height
signed water-column depth
metric signed coast distance
landward, seaward, and along-coast tangent frame
bathymetry gradient and seabed/material class
source resolution, filter/support, validity, version, and error
```

Define sign conventions explicitly. Water-column depth is vertical/reference-
normal clearance; it is not coast distance. Coast distance follows the declared
sphere or ellipsoid surface metric and remains stable across render LOD.
Medial axes, cusps, sub-resolution islands, and invalid dataset cells return an
ambiguous/invalid frame.

The planet owns reference surface, land/seabed height, coast zero set and
frame, hydrology regions, material classes, and uncertainty. The water system
owns time-varying free surface, waves/currents, wet/dry dynamics, breaking,
foam, and optics. A consumer records the body-field version and its resampling
footprint/error. Recompute the complete affected analysis dependency closure
after terrain/sea-level edits: drainage, connectivity, and coast distance can
change far beyond the edited patch. Invalidate consumers wherever the resulting
authoritative support or uncertainty changed, not only where the original edit
overlapped. LOD and camera motion do not rerun this fixed analysis.

## 4. Materials and Output

Use `MeshStandardNodeMaterial` for most solid surfaces and
`MeshPhysicalNodeMaterial` when clearcoat, water, ice, or richer specular
response requires it. LDR art with an sRGB transfer uses `SRGBColorSpace`;
height, normals, masks, IDs, and other data use `NoColorSpace` or their declared
linear encoding.

Use `RenderPipeline` with output-only MRT by default. Allocate normal,
velocity, emissive, or diagnostic attachments only for implemented consumers.
Keep HDR scene color linear until the single output transform.

Verify direct/cache and CPU/TSL field parity, independent derivative value and
direction, crater support/overflow, coast metric/sign/frame/LOD invariance,
cache and attachment bytes, zero frame-critical readbacks, and stable
resize/disposal lifetime.

Failure signatures:

| Symptom | Inspect |
| --- | --- |
| Camera movement rebuilds geology | cache dependency key |
| Displacement and shading diverge | shared height field, mapping metric, and warp chain rule |
| Coast moves with patch LOD | fixed analysis field and metric distance source |
