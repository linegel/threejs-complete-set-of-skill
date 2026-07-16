# Planet Field, LOD, and Atmosphere Systems

Read this reference when implementing body-scale routing, surface mapping,
quadtree or clipmap LOD, shared causal fields, planet materials, coast data, or
the surface-to-atmosphere handoff in Three.js r185 WebGPU/TSL.

## Contents

1. Body-scale gate and units
2. Surface mapping
3. Quadtree, clipmap, and hybrid selection
4. LOD topology and submission
5. Shared fields, cache, and parity
6. Geological and material mechanisms
7. Planetary coast and water handoff
8. Gas and cloud-deck bodies
9. Atmosphere and final output
10. Validation and failure signatures

## 1. Body-Scale Gate and Units

Use the planetary route when the accepted result exposes curvature, horizon,
global geodesy, orbit-to-ground transition, body-wide datasets, or an
atmosphere tied to the reference surface. Quantify a local tangent-plane
alternative before accepting the route.

For a spherical reference radius `R` and maximum tangent-plane radial extent
`r < R`:

```text
sagitta = R - sqrt(R^2 - r^2)
normalRotation = asin(r / R)
```

Project sagitta with the actual camera and gate physical-pixel position error,
normal error, horizon visibility, geodesic-distance error, and atmosphere
coupling. For an ellipsoid, use the principal curvature radii over the complete
domain. If all local-approximation gates pass, route to procedural fields and
geometry.

Declare the body model before building fields:

```text
center and body/world transform
radiusMeters or ellipsoidAxesMeters
metersPerWorldUnit
heightMeters and sea-level datum
sphere/ellipsoid surface-coordinate convention
render-origin and rebase policy
atmosphere bottom/top geometry in the same physical basis
```

When the source body is ellipsoidal or its shape is uncertain, treat a sphere
as a candidate approximation rather than a default. Compare the sphere with
the ellipsoid over the complete accepted surface, camera, data, and atmosphere
domain. Gate maximum:

```text
surface-position error in meters and physical pixels
reference-normal angular error
local/integrated area or Jacobian error
geodesic-distance error
horizon and limb position error for accepted views
atmosphere-altitude error under the shared surface solver
optical-depth error along accepted atmosphere rays
```

Select the spherical branch only when every product gate passes; otherwise use
the ellipsoid and its declared height/normal/geodesic semantics. Re-evaluate the
decision when axes, camera domain, dataset support, atmosphere shell, or
scattering integration changes.

Convert meters to world units once at the rendering boundary. Keep field and
query values in their declared physical units. A render-origin rebase changes
presentation transforms, not body-space field coordinates, source versions, or
stable identities.

## 2. Surface Mapping

Generate canonical `surfaceDirection` or ellipsoid surface coordinates from
face, patch, and grid metadata. Preserve them independently of displaced
position.

### Normalized cube

For `n = normalize(facePoint(u,v))`, the face-area Jacobian is proportional to

```text
(1 + u^2 + v^2)^(-3/2)
```

Therefore

```text
J_center / J_corner = 3 * sqrt(3) ~= 5.196
```

Uniform face-UV sampling is about `5.196` times denser at a corner than at the
face center. Account for this distortion in LOD and filtering.

### Spherified cube

One continuous mapping for cube point `(x,y,z)` is:

```text
sx = x*sqrt(1 - y^2/2 - z^2/2 + y^2*z^2/3)
sy = y*sqrt(1 - z^2/2 - x^2/2 + z^2*x^2/3)
sz = z*sqrt(1 - x^2/2 - y^2/2 + x^2*y^2/3)
n  = normalize(vec3(sx,sy,sz))
```

This reduces corner distortion but is not an equal-area proof. A claimed
equal-area mapping requires numerical area integration, finite Jacobians,
forward/inverse tests, and seam/corner equality.

### Ellipsoid semantics

With semi-axes `a = (ax, ay, az)`, distinguish geocentric radial direction from
reference-normal/geodetic direction:

```text
# geocentric radial direction n
t  = 1 / sqrt(sum_i(n_i^2 / a_i^2))
p0 = t*n
N0 = normalize(p0 / (a*a))

# reference-normal direction n
p0_i = a_i^2*n_i / sqrt(sum_j(a_j^2*n_j^2))
N0 = n
```

Height, crater distance, projected bounds, dataset coordinates, queries, and
atmosphere must share the selected meaning. Validate winding, edge/corner
equality, inverse face selection, Jacobian/metric, singular sets, and maximum
position/normal/area error.

## 3. Quadtree, Clipmap, and Hybrid Selection

| Camera/data domain | Representation | Required ownership |
| --- | --- | --- |
| Arbitrary orbit, horizon, and sparse close regions | six cube-face quadtrees | global surface and far/near LOD |
| Sustained bounded ground view | tangent geometry clipmap | local regular rings plus a declared far body |
| Continuous orbit-to-ground travel | hybrid | quadtree far field and clipmap near field with one transition owner |

A cube-face quadtree provides sparse global refinement but requires transformed
edge/corner adjacency and batched submission. CDLOD morphs a child toward its
parent samples across the split band.

A tangent clipmap uses a stable local tangent frame and fixed regular rings.
Recenter its integer origin at a declared quantum, preserve the body-space
field coordinate under recentering, and bound curvature plus reconstruction
error across the outer ring. The far body remains visible beyond that support.

A hybrid derives both representations from the same field functions. Assign
each spatial band one geometry owner; blend their positions from the common
displacement fields over a bounded handoff while accounting simultaneous
geometry and cache memory.

Evaluate both representations in one body frame and a common handoff
parameterization. For composite position

```text
X(u,v) = (1-w) X_global(u,v) + w X_local(u,v)
```

differentiate the composite itself:

```text
dX/dq = (1-w) dX_global/dq + w dX_local/dq
        + (X_local-X_global) dw/dq,  q in {u,v}
N = normalize(cross(dX/du, dX/dv))
```

The blend-weight derivative is part of the tangent. Interpolating endpoint
normals omits it and can create a lighting seam even when positions meet. Gate
coverage, position error, normal angle, and simultaneous residency across the
complete handoff.

## 4. LOD Topology and Submission

Apply projected error to the complete support, including:

```text
reference-surface curvature
maximum displacement and tangential warp
mapping and cache quantization error
normal/derivative reconstruction error
LOD morph and transition envelope
floating-origin reconstruction error
motion during selection dwell
```

Use the physical render-target extent and unjittered projection for every
active view. Project a conservative support through the actual matrix. A
near-plane or `w <= 0` crossing requires refinement or conservative handling;
clamping it into a finite error loses the bound. Split above `E_split`, merge
below `E_merge`, and record dwell/cadence.

Maintain a restricted global quadtree: edge-adjacent leaves differ by at most
one level across every transformed cube-face boundary. Assign canonical
edge/corner ownership so both faces evaluate the same direction, height, and
morph weight.

Reuse one indexed `N x N` grid. A patch receives four transition bits for
north/east/south/west edges adjacent to a coarser patch. Prebuild the

```text
2^4 = 16
```

index variants that collapse alternating fine-edge vertices onto the coarse
edge. Apply the same morphed direction before height and normal evaluation.

Production submission choices:

1. CPU frontier plus instanced mask bins: compact patches by transition mask
   and material, upload dirty ranges, then draw each nonempty bin.
2. GPU cull/compact plus indirect: CPU maintains a coarse candidate frontier;
   compute performs bounded culling/compaction and writes r185 indirect records.

Three.js r185 exposes `IndirectStorageBufferAttribute` and
`BufferGeometry.setIndirect()`. Indexed records contain `indexCount`,
`instanceCount`, `firstIndex`, signed `baseVertex`, and `firstInstance`. Gate
nonzero `firstInstance` on adapter support; otherwise bind each compact bin from
logical instance zero. Runtime visibility and indirect state remain GPU-resident.

Pack face/level, UV rectangle, conservative body-relative bound, morph/error,
cache index/version, and transition mask in compact aligned records. Report the
actual stride. Derived triangles are:

```text
activePatches * 2 * (gridSide - 1)^2
```

Sixteen masks bound topology bins per body/material group; they do not bound
the complete scene's draws.

## 5. Shared Fields, Cache, and Parity

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

## 6. Geological and Material Mechanisms

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

## 7. Planetary Coast and Water Handoff

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

## 8. Gas and Cloud-Deck Bodies

Use a separate field representation for an optically thick banded cloud deck.
Represent longitude continuously on the unit circle:

```text
longitude = atan(direction.z, direction.x)
advectedLongitude = longitude + time * jetSpeed(latitude)
longitudeVector = vec2(cos(advectedLongitude), sin(advectedLongitude))
gasCoordinate = vec3(longitudeVector.x, longitudeVector.y, latitude01)
```

Combine latitude-dependent advection, tangential warp, band records, turbulent
structure, bounded storm fields, limb response, and atmosphere coupling. This
branch uses cloud-deck density/color/velocity causes instead of crater, soil,
seabed, or rocky displacement fields.

Derive each storm identity from body ID, generator-schema version, stable seed,
and storm-record key rather than time, traversal, or visibility order. Version
its changing field state separately. Carry its support through the wrapped
longitude representation and publish a conservative bound over the advection/
update interval. Validate value and derivative continuity across the longitude
seam, deterministic storm replay, and bounds under the maximum declared jet
and storm motion.

## 9. Atmosphere and Final Output

Publish a narrow surface-side handoff:

```text
planet center and body/world transform
sphere radius or ellipsoid axes plus altitude convention
atmosphere bottom/top geometry
metersPerWorldUnit
sun direction in the declared frame
surface point, reference normal, and altitude meters
surface reflectance plus water/ice/wetness/material masks
scene-linear radiometric basis and field version/error
```

Surface and atmosphere share the same transform, reference-surface solver,
unit conversion, sun frame, and radiometric basis. A spherical surface pairs
with spherical shell geometry; an ellipsoid declares bottom/top axes or an
altitude model. The image pipeline owns exposure and final color conversion.
Surface reflectance is dimensionless. Light quantities declare whether they
are irradiance in `W m^-2` or radiance in `W m^-2 sr^-1`, plus any spectral or
RGB basis; a scene-linear encoding alone does not define physical units.

Use `MeshStandardNodeMaterial` for most solid surfaces and
`MeshPhysicalNodeMaterial` when clearcoat, water, ice, or richer specular
response requires it. LDR art with an sRGB transfer uses `SRGBColorSpace`;
height, normals, masks, IDs, and other data use `NoColorSpace` or their declared
linear encoding.

Use `RenderPipeline` with output-only MRT by default. Allocate normal,
velocity, emissive, or diagnostic attachments only for implemented consumers.
Keep HDR scene color linear until the single output transform.

## 10. Validation and Failure Signatures

Gate:

```text
body-scale route versus local approximation
mapping forward/inverse, winding, Jacobian, area, seams, and corners
restricted 2:1 quadtree across every cube-face transform
all 16 transition masks and continuous morph
clipmap ring/recenter error and hybrid ownership
projected support error for every view
direct/cache and CPU/TSL field parity
independent derivative value, direction, and scale
crater support/overflow and geological cause views
coast metric, sign, frame, LOD invariance, and uncertainty
atmosphere geometry, units, altitude, and radiometric basis
triangle, record-stride, cache, indirect, attachment, and peak-live bytes
full-frame plus paired planet on/off CPU/GPU p50/p95
zero frame-critical readbacks and stable resize/disposal lifetime
```

Inspect fixed orbit, horizon, and close cameras; silhouette; flat albedo without
atmosphere; grazing light; mapping distortion; face-neighbor orientation;
transition mask and crack distance; patch error; cache/version; field parity;
normal/roughness; coast; and atmosphere handoff.

| Symptom | Inspect |
| --- | --- |
| Corner density or LOD bias | mapping Jacobian and the `3*sqrt(3)` ratio |
| Cracks at a face boundary | transformed adjacency, canonical edge owner, balance, and transition mask |
| LOD pop or double surface | morph weights, hysteresis, and hybrid ownership |
| Camera movement rebuilds geology | cache dependency key |
| Displacement and shading diverge | shared height field, mapping metric, and warp chain rule |
| Coast moves with patch LOD | fixed analysis field and metric distance source |
| Atmosphere limb drifts | common reference surface, units, and altitude convention |
| GPU-driven path stalls CPU | hidden readback, synchronization, or compact-bin ownership |
| Draw count scales with patches | mask-bin submission rather than one draw per patch |

Completion requires direct evidence for every selected architecture branch and
every published field or handoff; unsupported branches remain explicit gaps.
