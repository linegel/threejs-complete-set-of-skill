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

Build fields from a unit surface coordinate plus physical scale:

```text
pMeters = surfaceDirection * radiusMeters
warp = fieldNoise(pMeters * frequencyPerMeter, seed)
tangentWarp = warp - surfaceDirection * dot(warp, surfaceDirection)
warpedDirection = normalize(pMeters + tangentWarp * warpMeters)
```

For static or slowly changing fields, compute height, validated tangent
gradient, material causes, and conservative min/max only when a patch enters or
its dependency key changes. The key includes body identity, seed, mapping,
patch ID/level, field constants, source datasets, edits, cache format, and
source versions. Camera, light, exposure, and atmosphere changes leave geology
clean.

Populate cross-face gutters from canonical neighbor ownership. Derive the
integer gutter:

```text
g = ceil(maxWarpDisplacementTexels
       + max(reconstructionFilterRadiusTexels,
             derivativeStencilRadiusTexels,
             projectedAnisotropicFootprintRadiusTexels))
```

Validate metric quantization error for the selected cache encoding. Use a
fence-safe allocator and keep every in-flight read tile immutable.

### CPU/TSL parity

Use one schema and one set of integer identity constants for CPU and TSL
builders. A parity-bearing lattice hash uses explicit `u32` wraparound; CPU
uses `Math.imul`/`>>> 0`, and TSL uses `uint` arithmetic with the same shifts and
multipliers. Apply declared f32 rounding in the CPU oracle where bit-level
comparison matters.

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
towardCenter = (center - c*n) / max(s, eps)
gradSphere(theta) = -towardCenter
gradSphere(q) = -towardCenter / angularRadius
```

Use a C1 radial height profile at floor/wall/rim boundaries and the limiting
zero gradient at the crater center. An ellipsoid uses an inverse-geodesic or a
locally gated metric approximation. Bin crater support in a spherical or
cube-face hierarchy, including cross-face overlap; publish list overflow
behavior. Deterministic overlap follows a declared commutative blend or an
ordered age-and-ID operator.

### Detail filtering

Derive represented spacing:

```text
vertexSpacing = patchArcLength / (gridSide - 1)
pixelFootprint = worldLengthOfOnePixelAtSurface
representedScale = max(vertexSpacing, pixelFootprint)
```

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
For domain warp `p' = p + w(p)`, include the chain rule:

```text
grad_p f = (I + J_w)^T * grad_p' f
```

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
footprint/error; body or sea-level edits invalidate overlapping consumers.

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
