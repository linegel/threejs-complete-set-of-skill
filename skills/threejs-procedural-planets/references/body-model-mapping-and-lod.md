# Planet Body Model, Mapping, and LOD

Read this reference when deciding whether a body-scale representation is
required, declaring sphere or ellipsoid semantics, selecting a cube mapping,
or implementing quadtree, clipmap, or hybrid LOD and submission.

## Contents

1. Body-scale gate and units
2. Surface mapping
3. Quadtree, clipmap, and hybrid selection
4. LOD topology and submission

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

A global patch identity is
`(bodyId, mappingVersion, face, level, x, y)`. Frontier order, visibility, draw
bin, allocation slot, and cache address are not identity. Cache and history
keys use the full patch identity plus the relevant field/schema versions.

A tangent clipmap uses a stable local tangent frame and fixed regular rings.
Recenter its integer origin at a declared quantum, preserve the body-space
field coordinate under recentering, and bound curvature plus reconstruction
error across the outer ring. The far body remains visible beyond that support.
A clipmap cell identity is
`(bodyId, mappingVersion, level, bodySpaceCellCoordinates)`. A physical ring
slot is only storage: when it is rebound to a different cell identity, reset
every slot-bound temporal, simulation, query-cache, and diagnostic state before
publication.

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

Verify the body-scale route, sphere/ellipsoid approximation, mapping
forward/inverse behavior, winding, Jacobian, area, seams and corners; restricted
2:1 balance across every cube-face transform; every selected transition mask;
clipmap recentering; hybrid ownership; projected support error for every view;
triangle and aligned-record bytes; submission count; zero frame-critical
readbacks; and stable resize/disposal lifetime.

Failure signatures:

| Symptom | Inspect |
| --- | --- |
| Corner density or LOD bias | mapping Jacobian and the `3*sqrt(3)` ratio |
| Cracks at a face boundary | transformed adjacency, canonical edge owner, balance, and transition mask |
| LOD pop or double surface | morph weights, hysteresis, and hybrid ownership |
| GPU-driven path stalls CPU | hidden readback, synchronization, or compact-bin ownership |
| Draw count scales with patches | mask-bin submission rather than one draw per patch |
