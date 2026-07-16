# Procedural Field Mechanics

Read only the section selected by the parent skill. Equations marked **Derived**
follow from the stated model; thresholds marked **Gated** must be supplied and
tested for the target; visual parameters are **Authored**; timings are
**Measured** on a named workload.

## Contents

- [Stage-portable causes and spectra](#stage-portable-causes-and-spectra)
- [Metric signed distance and coastal analysis](#metric-signed-distance-and-coastal-analysis)
- [Filtering, derivatives, and parity](#filtering-derivatives-and-parity)
- [Storage, precision, and invalidation](#storage-precision-and-invalidation)
- [Diagnostics and failure signatures](#diagnostics-and-failure-signatures)

## Stage-portable causes and spectra

A field bundle has one causal direction:

```text
stable coordinates -> optional domain warp -> primary fields
  -> derived causes -> named outputs -> consumer adapters
```

Use an integer lattice hash for CPU/TSL parity. Floor the lattice coordinate,
gate it to `[-2^31, 2^31-1]`, reinterpret i32 bits as u32, mix with odd u32
multipliers and the u32 seed, and normalize with an explicitly shared rule.
JavaScript uses `Math.imul`; TSL uses wrapping `uint` arithmetic. A sine-dot hash
does not form a cross-implementation parity contract.

For octave `i`, a useful authored spectrum is

```text
f_i = f_0 * lambda^i
a_i = a_0 * lambda^(-H i)
```

so gradient amplitude scales as `a_i f_i`. Keep physical displacement
amplitudes explicit. Divide by `sum(abs(a_i))` only when the desired output is
a normalized mask; changing octave count must not silently rescale a physical
height field.

If `p' = p + w(p)`, propagate the warp:

```text
J' = (I + J_w) J
grad_p n(p') = (I + J_w)^T grad n(p')
```

Gate folds where `det(I + J_w)` approaches zero unless folding is the intended
observable. Nonlinear remaps such as `abs`, ridges, hard thresholds, powers,
and products create harmonics; record a conservative support multiplier or a
measured spectral envelope for the exact remap.

At large coordinate magnitude `|x|`, f32 spacing is approximately **Derived**

```text
ulp32(x) ~= 2^(floor(log2(|x|)) - 23)
```

Gate phase error `2*pi*f*ulp32(x)`. When it fails, use integer tile identity
plus tile-local coordinates, a camera-relative presentation mapping, or a
high/low split while keeping the physical field identity stable.

## Metric signed distance and coastal analysis

Use this section when a consumer interprets a boundary field as length, needs a
normal/tangent frame, derives cross-shore profiles, or compiles contours.

### Signed-distance contract

For a land-positive field in world/tile-local XZ coordinates:

```text
d(p) > 0  inside support
d(p) = 0  boundary
d(p) < 0  outside support

nIn = grad(d) / |grad(d)|
t = (-nIn.z, nIn.x)
kappa = divergence(nIn)
```

The frame is valid only where the closest feature is unique and the gradient
passes a conditioning floor. At a medial axis, corner tie, or near-zero
gradient, retain the closest-feature vector/ID or mark the frame invalid;
normalizing the gradient there invents a direction.

Select the boundary representation from the required property:

| Required property | Representation | Acceptance evidence |
| --- | --- | --- |
| supplied outline and holes | robust winding classification plus closest polygon-segment distance | orientation/nesting, closest-distance error, and zero-set Hausdorff error |
| small analytic support set | bounded ellipse/capsule/polygon implicits, followed by metric re-distance when distance is consumed | component/hole topology and `abs(|grad d|-1)` in the valid band |
| painted, edited, or simulated support | signed Euclidean distance transform, or jump flooding plus exact narrow-band refinement | distance and frame-angle error against exact probes |
| topology intentionally follows a height crossing | one shared scalar `height-waterLevel` | seed/resolution/level topology drift is explicitly allowed |

`max(d_i)` preserves an analytic union's zero set but is not generally metric
near overlaps. Smooth union and coordinate warp may move the zero set or change
the metric. Re-distance any implicit whose values will be treated as meters.
For tiled raster distance, key edge/site samples by global lattice identity,
include the refinement halo, and make one owner resolve ties.

Gate both:

```text
max narrow-band abs(|grad(d)| - 1)
zero-contour Hausdorff error
```

Neither gate implies the other. Curvature is computed only after filtering at
the physical scale consumed downstream.

### Cross-shore shared causes

Land and bed share the boundary:

```text
zBase(p) = waterLevel + C(d(p))
         + L(d(p)) * rLand(p)
         + S(-d(p)) * rBed(p)
```

`L(s)=S(s)=0` for `s<=0`; residual relief cannot cross the boundary. For a
smooth shore, gate `C(0)=0` and the intended one-sided derivative match. If
`|rLand|<=R_L` and `|rBed|<=R_B`, preserve an error margin outside a declared
uncertainty tube:

```text
d > 0: C(d) - L(d) R_L(d) >=  m_z(d)
d < 0: C(d) + S(-d) R_B(-d) <= -m_z(d)

deltaCoast >= epsilon_d + (epsilon_z + crossingGate) / s_min
```

Inside `|d|<=deltaCoast`, the authoritative contour owns classification. A
vertical cliff is not a singular heightfield: emit contour, top, and toe causes
for geometry to close with a wall.

Hard terraces retain continuous relief and expose topology-driving values:

```text
u = (zRaw - zRef) / terraceStep
terraceIndex = floor(u)
terracePhase = u - floor(u)
Gamma_k = { p : zRaw(p) = zRef + k*terraceStep }
```

Classify a threshold only when its distance from the computed value exceeds the
propagated direct/sample/store error; otherwise refine or mark it uncertain.

### Drainage, exposure, and downstream ownership

Establish a depression policy before routing drainage: retain declared basins,
or fill/breach them deterministically; then resolve flats, build an acyclic D8,
D-infinity, or multiple-flow receiver graph, and accumulate in topological
order. With source area `a_i` and routing weights,

```text
A_i = a_i + sum_(j -> i)(w_ji * A_j)
```

is **Derived** from area conservation. Gate outlet area plus retained basin
area against total domain area. Compute exposure from declared incident
directions, coast orientation, and unobstructed fetch; an unrelated noise field
is not exposure.

Fields publish causal factors, hard eligibility, exclusions, and stable
contour/feature IDs. Geometry owns topology and anchors; placement systems own
candidate identity and conflict resolution; water owns free surface, foam, and
transport; a receiver-state owner integrates wetness or snow. Preserve those
owners through every quality tier.

For a classifier `g` with value error `epsilon_g` and gradient floor `m`, the
boundary-position error is **Derived**

```text
epsilon_boundary <= epsilon_g / m
```

Where `m` approaches zero, refine or declare the contour ill-conditioned.

Tile seams require global lattice keys, a halo covering the largest filter,
derivative, drainage, or distance stencil, shared edge/site identities, and
versioned seed/algorithm/water-level/encoding inputs.

## Filtering, derivatives, and parity

### Footprint gate

For screen footprint `J`, post-warp footprint `J'=(I+J_w)J`, and effective band
support `f_support`, use

```text
q_screen = f_support * sigmaMax(J')
q_mesh = f * maxProjectedEdgeInFieldUnits
q = max(q_screen, q_mesh)
```

The sampling bound is **Derived** `q <= 0.5`. Choose a smooth authored fade
ending no later than that bound. Keep coordinates stable while attenuating the
band. For independent bands, transfer removed variance using squared
amplitudes, not their sum.

For a random-phase height sinusoid `a*sin(k·p+phi)`, mean-square slope is
**Derived** `a^2*|k|^2/2`. A material can consume the removed slope energy for
normal-cone or roughness filtering. Silhouette bands remain in geometry;
sub-footprint bands move to filtered material response or disappear.

Fragment derivatives execute in derivative-uniform control flow. Geometry,
vertex, placement, and compute branches use analytic/symbolic gradients or a
declared stored/supplied footprint. For normalization `r=x/|x|`, propagate

```text
D normalize(x) = (I - r*r^T) / |x|
```

Central differences have **Derived** `O(delta^2)` truncation and
`O(u/delta)` roundoff amplification; choose `delta` by a scale-aware convergence
sweep.

### Parity budget

Keep these errors separate:

```text
epsilon_direct = hash/algebra/builtin error
epsilon_sample = epsilon_direct + interpolation + LOD selection
epsilon_stored = epsilon_sample + encoding quantization
epsilon_gradient = derivative error + sampled/stored amplification
```

For a smooth scalar sampled on grid spacing `hx,hy`, a bilinear base-level
bound is **Derived**

```text
epsilon_interp <= hx^2/8 * sup|f_xx| + hy^2/8 * sup|f_yy|
```

Central differencing bounded sampled values adds at most
`epsilon_value/delta` to derivative error. Use an f32 CPU oracle with explicit
rounding boundaries to distinguish JavaScript f64 drift from the intended f32
path; it does not prove every WGSL rounding choice or builtin.

For decision `g>=tau`, compare bits only outside `|g-tau|<=epsilon_g`. Validate
direct GPU output first, then sampled/stored output, then classifications.
Mean image error does not close a worst-case threshold contract.

## Storage, precision, and invalidation

Installed r185 storage candidates:

| Three.js format/type | WebGPU format | bytes/texel | gate |
| --- | --- | ---: | --- |
| `RGBAFormat + HalfFloatType` | `rgba16float` | 8 | baseline writable/filterable storage |
| `RGFormat + HalfFloatType` | `rg16float` | 4 | `texture-formats-tier1` |
| `RedFormat + FloatType` | `r32float` | 4 | linear filtering needs `float32-filterable` |
| `RGFormat + FloatType` | `rg32float` | 8 | core/non-compatibility storage; filtering separately gated |
| `RGBAFormat + UnsignedByteType` | `rgba8unorm` | 4 | normalized data, not exact category IDs |

For fp16 normal values, unit roundoff is **Derived** `2^-11`; the maximum
rounding below one is `2^-12`. Largest finite is `65504`, smallest normal
`2^-14`, and smallest subnormal `2^-24`; do not rely on subnormal survival.
For linear decoding, propagate the encoded half-ulp through the decode scale,
then add interpolation and mip error.

Exact IDs use an integer/storage-buffer representation or nearest exact loads
with explicit encode/decode. Never linearly filter category identity.

A full 2D mip chain approaches **Derived** `4/3` of base bytes before alignment;
ping-pong doubles simultaneous allocation. Set `mipmapsAutoUpdate` according to
the actual ownership: when false, write every sampled level; when true, verify
automatic generation for the selected format after compute. Storage writes and
filtered reads occur in separate usage scopes.

Invalidation is dependency-driven:

```text
seed/algorithm/coordinate change -> all values and derivatives
source edit -> dirty support + filter/derivative halo
encoding or mip-policy change -> every stored consumer
threshold or classification change -> contours, anchors, and category caches
resize/domain change -> storage, dispatch geometry, and diagnostics
```

Increment the source revision before publishing the replacement. Keep previous
and current resources immutable until every consuming frame completes; reset or
invalidate histories that cannot map the old representation to the new one.

## Diagnostics and failure signatures

Expose coordinates, warp, each primary band, derived causes, gradients/frames,
validity, packed lanes, mip/footprint, direct-versus-sampled error, thresholds,
and final consumers. Metric-boundary work additionally exposes signed distance,
`abs(|grad d|-1)`, closest-feature ID, invalid medial axes, contours, cross-shore
profile, drainage conservation, and tile-border differences.

Reject the field system when:

- claimed shared features are evaluated by different functions;
- a coordinate changes with camera or LOD when the physical cause does not;
- a warped implicit is treated as metric distance without re-distance evidence;
- a medial-axis gradient is normalized into a fabricated frame;
- high-frequency energy survives its screen or mesh footprint;
- a threshold consumes values inside its unresolved error guard;
- categorical IDs are filtered or carried through imprecise seed/ID lanes;
- a bake lacks lower amortized cost, required reuse, or a complete lifetime;
- dirty updates omit a dependent halo, mip, contour, anchor, or diagnostic;
- a frame-critical consumer requires synchronous CPU readback.
