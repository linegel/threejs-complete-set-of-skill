# Procedural Field-Stack Recipes

These recipes construct coherent WebGPU/TSL field bundles for spherical
terrain, altitude-filtered detail, terrain wetness, water optics, and structured
stochastic placement. The implementation path is always one deterministic TSL
`Fn` reused by NodeMaterials, vertex nodes, compute bakes, and diagnostics.
That shared core is derivative-stage agnostic; fragment footprints and
vertex/compute LOD policies are explicit consumer wrappers.

Numerical labels used below are mandatory: **Derived** follows from a stated
equation/format, **Gated** is a pass/fail capability or acceptance threshold,
**Measured** is target-specific evidence, and **Authored** is a tunable visual
or planning choice. Unlabelled vector widths and channel counts are structural.

## Revision And Specification Proof Basis

The local dependency is Three.js `0.185.1`. Recheck these installed sources on
upgrade: `WebGPUTextureUtils.js` owns Three-format to GPU-format mapping and
byte sizes; `WebGPUBackend.js` requests a compatibility-level adapter then
enables supported features; `StorageTexture.js`, `Bindings.js`, and
`StorageTextureNode.js` own mip-update and storage/load semantics. Therefore
inspect `renderer.backend.compatibilityMode`, `device.features`, and
`device.limits`; a Three.js enum is not capability proof.

Numerical portability rules come from the primary [WebGPU texture-format and
limit specification](https://gpuweb.github.io/gpuweb/#plain-color-formats) and
[WGSL floating-point evaluation
rules](https://gpuweb.github.io/gpuweb/wgsl/#floating-point-evaluation), not
desktop API assumptions.

## Contents

- Architecture first
- Stable coordinate ownership
- Local coastal land field bundle
- Spherical terrain field bundle
- Altitude and projected-footprint filtering
- Terrain wetness field coupling
- Water field coupling
- Structured stochastic placement
- Field placement decision table
- Channel packing
- Parity harness
- Performance budgets and lifecycle
- Cross-system implementation contract
- Physics signal publication
- Diagnostics

## Architecture First

Top-tier procedural fields are not independent noise stacks. They are named
causal bundles evaluated once and reused everywhere:

```text
stable coordinates
  -> domain warp
  -> primary scalar/vector fields
  -> derived causes
  -> packed channels
  -> material, placement, compute, and post consumers
```

Author the bundle as TSL:

```text
sampleField = Fn(inputs -> {
  warpedCoordinates
  macroHeight
  ridge
  cavity
  moisture
  slope
  identityMasks
  packedChannels
})
```

The CPU port exists for geometry generation, offline assets, precomputed data
for native-WebGPU tiers, and parity checks. It is not a separate
look-development path. Constants, seeds,
hashes, remaps, wrapping, and normalization must match the TSL function.
For parity-bearing value noise, use an integer lattice hash: floor cell
coordinates, reinterpret i32 cell bits as u32 for negative-coordinate wrapping,
mix odd u32 lattice multipliers and the u32 seed, then finalize with a
published integer mixer such as lowbias32. Do not use `fract(A * sin(dot()))`
for CPU-vs-GPU contracts: WGSL permits implementation-dependent floating-point
accuracy, reassociation/fusion, and subnormal handling, while the large
post-sine multiplier magnifies builtin drift into unrelated low bits.

Seed transport is part of the contract. Use a `u32` uniform/attribute/storage
lane and explicit modulo wrapping on CPU. An f32 uniform cannot encode all u32
seeds; converting that rounded float back to uint changes the entire lattice
hash. Probe negative CPU seeds, high exact u32 seeds, and octave-offset wrap.
The canonical i32-cell bitcast requires
`-2^31 <= floor(cell) <= 2^31-1`; this range is **Derived** from i32 and is a
**Gated** precondition. Crossing it requires rebasing or split integer/local
coordinates, not a saturating cast.

## Coherent Noise Spectrum

Approved families for canonical examples:

The listed ranges are **Authored** output conventions after each family's
declared remap, not universal noise bounds.

| family | output range | use |
| --- | --- | --- |
| deterministic u32 value hash | 0-1 | CPU parity fixtures, precomputed native-WebGPU assets |
| gradient/simplex-style noise | -1 to 1 or remapped 0-1 | smooth macro and meso fields |
| ridged transform `1 - abs(2n - 1)` | 0-1 | ridge, vein, wrinkle, crest fields |
| stratified jitter | bounded cell-local range | authored placement, craters, branches |

Choose the spectrum from a desired regularity, not a memorized lacunarity/gain
pair. For octave `i`:

```text
f_i = f_0 * lambda^i
a_i = a_0 * lambda^(-H i)
gain = lambda^(-H)
```

`lambda > 1` and `H` are **Authored**. `H` controls how quickly amplitude
falls with frequency. For an `E`-dimensional isotropic fBm model, the idealized
power spectral density has **Derived** exponent `beta = 2H + E`. More useful
for implementation: value amplitude scales as `a_i`, gradient amplitude as
`a_i f_i = a_0 f_0 lambda^((1-H)i)`, and curvature amplitude as `a_i f_i^2`.
Thus `H < 1` makes the highest retained octaves dominate slope; adding octaves
without filtering will destabilize normals even when value amplitude looks
small.

Do not always divide by `sum(abs(a_i))`. That is a **Derived** worst-case range
bound, useful for masks, but it changes authored physical height as octave
count changes. For decorrelated zero-mean bands with known variance
`sigma_i^2`, RMS normalization is **Derived**
`sigma_sum = sqrt(sum(a_i^2 sigma_i^2))`. Displacement in physical units should
instead retain explicit band amplitudes and publish the resulting range/RMS.
Use seed wrapping so large or negative seeds stay deterministic across CPU and
TSL implementations.

### Bandwidth after warp and nonlinear remaps

Nominal octave frequency is not the final bandwidth. If `p' = p + w(p)`, a
screen footprint `J = [dPdx dPdy]` becomes **Derived**
`J' = (I + J_w) J`; filter a band with `sigmaMax(J')`, not the unwarped
footprint. Bound or evaluate `J_w` at the sample. If the warp approaches a
fold (`det(I + J_w)` near zero or changes sign), classification/derivative
stability is a **Gated** failure unless folding is the authored mechanism.

`abs`, ridged transforms, hard thresholds, `pow`, multiplication of fields,
and sharp smoothsteps create harmonics beyond the source's nominal lattice
frequency. A lattice noise kernel is not perfectly band-limited either. Each
band therefore records a conservative spectral-support multiplier or a
**Measured** FFT/impulse-response envelope from the exact implementation.
Filter the post-warp/post-remap support. Prefer analytic integration or a
prefiltered bake when no useful bound exists; a nominal `f_i` alone is not an
anti-aliasing proof.

Default spectralSlope by band:

```text
macro: broad regions and silhouette, low frequency, geometry-safe
meso: ridges, cavity, shore, wear, visible in material and sometimes geometry
micro: normal/roughness only, derivative filtered, never macro displacement
```

Example domain stress ranges from the checked-in fixture are **Authored**, not
proof that f32 resolves all features:

```text
sphere domains: radius 1-72000 km
world domains: 0.001-1000000 world units
object domains: 0.0001-10000 object units
normalized masks: clamp to 0-1 after all causal bias
```

Before evaluating a coordinate in f32, check representability. For magnitude
`|x|` in a normal binade, spacing is approximately **Derived**
`ulp32(x) ~= 2^(floor(log2(|x|)) - 23)`. Require the resulting phase error
`2 pi f ulp32(x)` to be below the field's **Gated** phase budget. Otherwise use
an integer tile plus tile-local float coordinate, camera-relative origin, or a
high/low split. Large world coordinates and micro-scale wavelengths cannot
share one undifferentiated f32 coordinate.

Choose bake versus evaluation with the invocation/update/bandwidth equation in
the parent skill. Read count alone is forbidden: one full-screen consumer can
cost more than several sparse vertex consumers, and a static expensive field
can amortize a bake across many frames. Within one shader invocation, bind the
bundle to explicit local variables before allocating storage.

## Stable Coordinate Ownership

One stable coordinate domain owns related visual channels. Choose the domain
from the cause:

```text
planet geology -> normalized undeformed sphere direction * physical radius
water/wetness -> shared world plane
tree or branch growth -> branch-local longitudinal and radial coordinates
facade or authored kits -> stratified semantic cell coordinates
```

For planet terrain, store or derive normalized undeformed sphere direction and
sample:

```text
terrainCoordinateKm = normalize(surfaceDirection) * radiusKm
```

Do not sample displaced positions for geology. That stretches noise over steep
relief and breaks orbit-to-close filtering. World wetness and water phase use
world coordinates because the physical cause is world height or a shared water
plane.

## Local Coastal Land Field Bundle

This recipe covers local islands, archipelagos, reservoirs, river margins, and
coastal sites. It is not a planetary-surface substitute and it does not assume
a game camera. Fixed isometric presentation, free inspection, mobile delivery,
and metric analysis use the same causal fields but select different
representations and error gates.

### Source-of-truth boundary

Use world XZ or integer-tile plus tile-local XZ in physical units. Adopt one
sign convention throughout:

```text
d(p) > 0    dry-land support
d(p) = 0    authored waterline
d(p) < 0    water support
nIn = grad(d) / |grad(d)|
tCoast = (-nIn.z, nIn.x)
nSea = -nIn
kappa = divergence(nIn)
```

`nIn` points toward the land interior. The frame is defined only where the
closest boundary is unique and `|grad(d)|` exceeds the field's **Gated**
conditioning floor. At medial axes and equidistant corners, preserve the
closest-feature ID/vector returned by the distance algorithm or mark the frame
invalid; normalizing a zero gradient produces arbitrary placement and lighting
directions. Estimate curvature only after filtering the boundary at the
physical scale consumed by the asset. Grid-scale second differences of a noisy
SDF are not coast curvature.

Select the support representation before adding relief:

| Boundary contract | Algorithm | Complexity record | Failure gate |
| --- | --- | --- | --- |
| supplied polygon with holes | robust winding/sign test plus closest-segment query; accelerate many segments with a BVH or uniform bins | query count, candidate segments, acceleration bytes | loop orientation/nesting, segment-distance, and shoreline Hausdorff bounds |
| small procedural set | union of ellipses, capsules, rounded polygons, or other bounded implicits | naive work is **Derived** `Q * P` primitive evaluations for `Q` queries and `P` primitives | component/hole count and minimum-neck width survive the seed sweep |
| raster-painted, simulated, or frequently edited support | binary classification plus signed Euclidean distance transform; jump flooding is a GPU candidate | separable exact sampled-grid EDT has **Derived** linear sample work per dimension; jump flooding has **Derived** logarithmic pass count in maximum extent but target-specific error and traffic | exact or refined narrow band meets distance, frame-angle, and zero-contour bounds |
| height-is-waterline shortcut | `dImplicit = zRaw - waterLevel` | one shared scalar evaluation | only legal when topology and metric coast-distance errors are explicitly tolerated |

A procedural-island support should begin from an explicit component grammar,
not a thresholded high-octave noise image:

```text
authored domain and component-count contract
  -> deterministic component centers and stable IDs
  -> per-component skeleton of discs/capsules/rounded polygons
  -> union land lobes and subtract declared lagoons/channels
  -> bounded silhouette-scale coordinate warp
  -> classify, metric re-distance, and reject invalid topology
```

Use stratified or blue-noise center candidates when spacing is observable; use
an authored graph when island adjacency, channels, or narrative/data identity
is prescribed. Record allowed component/hole count, area/perimeter interval,
minimum dry neck, inter-island water gap, and domain clearance as **Gated** or
**Authored** product constraints. Seed rejection follows a stable candidate
order and has an explicit failure result; an unbounded retry loop is neither
deterministic latency nor a topology guarantee. Keep silhouette warp below the
scale at which it creates unplanned necks, then verify topology after warp
rather than trusting the amplitude parameter.

For positive-inside primitive distances, `max_i(d_i)` preserves the union zero
set but is generally not a metric signed distance near overlaps. Smooth maximum
can also move the zero set. A coordinate warp changes the metric by its
Jacobian. Use these results as support implicits, then re-distance whenever a
consumer interprets `d` as length, computes a coast frame, or allocates a band
in meters. Record a **Gated** sweep of `abs(|grad(d)|-1)` in the valid narrow
band and a separate zero-contour Hausdorff error; one cannot replace the other.

For raster distance, a jump-flood nearest-site result is approximate. Refine
the winning site against neighboring boundary segments/cells in the coast band,
or compare with an exact CPU distance transform at deterministic probes. The
field contract records texel spacing, site encoding, tie-breaking, refinement
radius, and worst accepted distance/frame error. Repeating edge samples must
use global lattice coordinates so adjacent tiles choose the same site and sign.

### Cross-shore elevation and bathymetry

Land and visible seabed derive from the same boundary. Write

```text
zBase(p) = zw + C(d(p))
         + L(d(p)) * rLand(p)
         + S(-d(p)) * rBed(p)
```

where `zw` is water level, `C` is an authored cross-shore profile, `L` and `S`
are nonnegative envelopes, and `rLand`/`rBed` are bounded signed residual
relief fields. Require `L(s)=S(s)=0` for `s<=0`; each residual therefore acts
only on its side of the coast. The **Gated** continuous-beach conditions are:

```text
C(0) = 0
L(0) = 0
S(0) = 0
left and right C' satisfy the authored slope-continuity gate
```

Require `C(d)` to have the sign of `d` in the protected nearshore band unless
an authored tidal-flat interval deliberately stays at water level. Sign alone
is insufficient because a residual can overpower `C` near zero. If
`|rLand|<=R_L(d)` and `|rBed|<=R_B(-d)`, require a positive propagated margin
`m_z(d)`:

```text
d > 0: C(d) - L(d) R_L(d) >=  m_z(d)
d < 0: C(d) + S(-d) R_B(-d) <= -m_z(d).                       [D,G]
```

The inequalities cannot hold arbitrarily close to `d=0` while all terms vanish.
Define an uncertainty tube

```text
deltaCoast >= epsilon_d + (epsilon_z + z_waterline_gate)/s_min, [D,G]
```

where `epsilon_d` is coast-distance error, `epsilon_z` is combined vertical
direct/sample/store error, and `s_min` is a proven lower bound on `|C'|` over
the protected crossing. Inside `|d|<=deltaCoast`, the authoritative coast
contour owns classification and residual envelopes are zero or their complete
range is retained as uncertain; do not infer land/water from rounded height.
Apply the residual inequalities only outside that tube with
`m_z>=epsilon_z`. These conditions guarantee that changing a bounded relief
seed does not tear the accepted waterline. The profile
may encode a dry berm, wet-sand runout, shallow shelf, reef shoulder, and basin
transition in physical cross-shore distance. Each breakpoint, slope, and
elevation is **Authored** or source-data-driven; none is a device tier.
Keep high-frequency bed relief out of waterline classification by forcing its
envelope to zero at the coast.

A cliff needs a multi-surface contract:

```text
shoreContour = { p : d(p) = 0 }
cliffTop(p)   = zw + hCliff(p)
cliffToe(p)   = zw + hToe(p)
```

The geometry owner closes `cliffTop` to `cliffToe` with a wall. Do not emulate
a vertical face with an unbounded derivative or a screen-space dark band. A
mixed coast exposes a broad `cliffIdentity` field so beach and cliff segments
cannot alternate at single-cell frequency.

For hard stylized terraces, retain continuous relief `zRaw` as the causal
field and emit:

```text
u = (zRaw - zRef) / deltaZ
terraceIndex = floor(u)
terracePhase = u - floor(u)
Gamma_k = { p : zRaw(p) = zRef + k * deltaZ }
```

`deltaZ` is **Authored** in physical units. The mesh compiler constructs flat
caps and explicit walls from `Gamma_k`; the material consumes the same index
and phase. A smoothed quantizer is a different visual contract and cannot prove
hard terrace topology. At every threshold `tau`, classify only if
`|zRaw-tau|` exceeds the propagated direct/sample/store error; otherwise refine,
evaluate a higher-precision CPU path, or retain an explicit uncertain cell.

### Drainage, exposure, and ecological causes

Slope and aspect come from the analytic or validated stored gradient of
`zRaw`, not the faceted display mesh. If drainage is visible in vegetation,
erosion, sediment, wetness, or structure placement, establish a depression
policy before routing flow:

1. retain closed basins when they are authored water bodies;
2. otherwise fill or breach them with a deterministic Priority-Flood-class
   algorithm;
3. route D8 for a single discrete receiver or D-infinity/multiple-flow for
   distributed flow;
4. resolve flats explicitly, build an acyclic receiver graph, and accumulate
   from upstream to downstream.

For cell source area `a_i` and routing weights whose outgoing sum is one,

```text
A_i = a_i + sum_(j routes to i)(w_ji * A_j)
```

is **Derived** from area conservation. Validate total outlet area plus retained
basin area against total domain area within the **Gated** numerical bound.
Hydraulic or stream-power erosion is not the default: add it only when the
resulting relief/drainage change is observable and can be run offline or inside
the measured update budget. A common optional incision model is
`E = K A^m |grad(z)|^n`; `K,m,n`, timestep, boundary conditions, and stability
must be source-backed or **Authored**, never inferred from appearance alone.

For an incident horizontal direction `q_j` pointing from water toward land,
define a coast exposure candidate:

```text
X(p) = sum_j E_j * Fhat(fetch_j(p))
                  * max(0, dot(q_j, nIn(p)))^pExp
```

`E_j`, the normalized fetch response `Fhat`, and exponent `pExp` are
**Authored** or source-driven. `fetch_j` is the unobstructed water distance
opposite the incident path until land or the declared open-domain boundary.
Bake exposure on shoreline samples or a narrow atlas when ray work amortizes;
do not evaluate long fetch rays per fragment. Separate wind and wave direction
distributions when they differ. This field can drive cliff weathering,
windward vegetation, sediment, and a water owner's breaking source, but it does
not itself simulate water.

An environmental placement-factor bundle should be causal:

```text
moisture = f(flowAccumulation, distanceToDrainage, aspect, exposure, substrate)
suitability = product or ruled blend of
  landSign, surfaceIdentity, slope, terraceCap, coastDistance,
  moisture, exposure, clearance, and authored inclusion regions
```

Avoid multiplying many narrow smooth masks until almost every value is zero.
Inspect each factor and measure eligible area. This field owner emits named
environmental factors, hard-validity/exclusion data, and authoritative contour
anchors; it does not choose species/assets, resolve inter-asset conflicts, or
own final placement IDs. `$threejs-procedural-vegetation` and the semantic site
asset compiler consume these factors and own their acceptance process. Asset
clearance and infrastructure footprints enter as explicit exclusion geometry
or a distance field; they are not negative noise.

Downstream placement compilers select sampling deliberately:

| Distribution contract | Candidate | Required proof |
| --- | --- | --- |
| authored rows, bays, plots, or ecological strata | one or more candidates per semantic cell with bounded jitter | stable cell ID, accepted-area coverage, and no cross-cell collision |
| minimum-separation natural scatter | oversampled deterministic candidates plus stable-priority conflict resolution in a spatial hash | pairwise clearance, density error, and invariance to thread/chunk order |
| density proportional to a smooth suitability field | stratified weighted rejection or hierarchical inverse-mass sampling | accepted density versus target and bounded rejection/work |
| coast-, path-, contour-, or drainage-bound assets | arc-length stratification on the authoritative polyline plus normal/tangent offsets | arc-length spacing, frame validity, and junction/endpoint policy |

Classic sequential dart throwing is acceptable only when its ordering is part
of the deterministic contract and generation latency passes. A GPU-parallel
scatter needs a deterministic winner key for every conflict; atomic arrival
order is not an asset identity.

### Sampling, tiles, and complexity gates

For a scalar classifier `g` with value error `epsilon_g` and a proven lower
gradient magnitude `m` across the crossing, the **Derived** boundary-position
error is

```text
epsilon_boundary <= epsilon_g / m
```

Use this for waterline, terrace, beach-band, and exclusion contours, then
project it through the shared physical-pixel contract. Where `m` approaches
zero, the contour is ill-conditioned; refine, change the field, or declare the
topology unstable. For a sampled heightfield, also apply the bilinear Hessian
bound and mesh-projection bound already defined in this reference.

Tile invariants:

- evaluate all border and ghost samples from integer global lattice keys;
- include a halo at least as wide as the largest filter, derivative, drainage,
  or distance-refinement stencil used by the tile;
- derive dirty work from the union of edited support plus that halo;
- share edge sample/site IDs across neighbors rather than reconciling two
  independently rounded boundaries;
- version the seed, algorithm constants, water level, and quantization schema;
  any change invalidates dependent contours, anchors, and storage.

For `Nx * Nz` samples and stored channels `c` with `b_c` bytes each, base
payload is **Derived** `Nx * Nz * sum_c(b_c)` before row alignment, mips,
ping-pong, and halos. Record query count, primitive/segment candidates,
distance-transform passes, drainage sort/queue work, exposure rays, dirty
samples, and consumer reads separately. These counts choose what to measure;
they are not milliseconds. Static seed variants should be precomputed when
runtime generation provides no product value, especially on low-end/mobile
targets.

Quality tiers preserve the causal boundary:

```text
full
  metric coast frame, required relief bands, drainage/exposure, and all
  placement identities at their Gated spatial errors

budgeted
  same waterline and stable IDs; coarser/precomputed relief, fewer exposure
  directions, lower drainage or bake update cadence after measured selection

minimum-native
  precomputed support/coast/height/bathymetry and only identity-critical masks;
  no procedural recomputation whose result is static
```

Never lower a tier by independently simplifying land and bathymetry. They must
sample the same coast version or the shallow-water/wet-line handoff tears.

### Local-coast diagnostics and adversarial corpus

Required views:

```text
support sign and component/hole IDs
dCoast in physical units and abs(|grad d|-1)
closest-coast ID, nIn, tCoast, filtered curvature, invalid-frame mask
cross-shore profile, zRaw, zBed, cliffTop/toe
terrace index/phase and threshold-uncertainty cells
beach/wet-line bands, slope/aspect/cavity
flow receivers, accumulation, retained basins, outlet conservation error
wind/wave exposure and fetch
each placement constraint, accepted-area density, and exclusion distance
tile-border difference and CPU/TSL/store error
```

The deterministic corpus must include tangent water-level contact, a threshold
through a lattice vertex, a narrow isthmus, two nearly touching islands, nested
holes, a flat plateau, a one-cell basin, a coastline crossing a tile corner,
large rebased coordinates, seed extremes, and a water-level sweep through a
topology event. Gate component/hole count where topology is protected;
shoreline Hausdorff distance; coast-frame angular error away from singular
sets; `C(0)` continuity; outlet-area conservation; tile-edge equality; and
repeatability after rebuild and LOD changes.

## Spherical Terrain Field Bundle

Use tangential warp for radial domains:

```text
warp = seededVectorField(surfaceDirection, seed) - 0.5
tangentWarp = warp - radial * dot(warp, radial)
warpedPointKm = radial * radiusKm + tangentWarp * warpAmplitudeKm
warpedDirection = normalize(warpedPointKm)
terrainKm = warpedDirection * radiusKm
```

`warpAmplitudeKm` is **Authored** in physical units. Gate the ratio
`warpAmplitudeKm * max(|tangentWarp|) / radiusKm`, the singular values of the
warp Jacobian, and `det(I + J_w)` over a seed/position sweep. The radial
projection is the mechanism; no fixed fraction or minimum distance is a
universal scale law.

Separate bands by purpose:

```text
continent band -> broad regions and silhouette support
highland band  -> regional altitude variation
ridge band     -> directional structure and erosion-like emphasis
cavity band    -> craters, pockets, and dirt collection
micro band     -> material normal and roughness only
```

Choose each band's wavelength from the largest visible physical feature it
owns, then derive octave amplitudes from the `H` spectrum and the displacement,
slope, or curvature budget. Historical dimensionless frequency ratios are not
portable across radius, coordinate units, mesh density, or camera scale.

The reviewed planet example now aligns its base terrain height between CPU and
the material path more than the older reference claimed. Treat any remaining
material-only climate, biome, roughness, or normal logic as a parity gap to
close: the new path must share one TSL field bundle and a deterministic CPU
port for all fields that geometry, diagnostics, or tests compare.

Example climate causes (all weights and exponents are **Authored** and must be
normalized/documented):

```text
humidity =
  wBroad * broadMoistureBand
  + wDetail * detailMoistureBand

temperature =
  latitudeResponse(abs(latitude), latitudeExponent)
  - lapseRate * macroHeight

slope =
  1 - abs(dot(localNormal, radialDirection))
```

Snow, arid, lush, and rock masks combine altitude, ridges, humidity,
temperature, slope, and a small jitter field. The important mechanism is causal
reuse, not a fixed palette.

## Altitude And Projected-Footprint Filtering

Keep coordinates stable and fade contribution. An altitude envelope is an
**Authored** work/LOD policy, not the anti-aliasing filter:

```text
cameraAltitude = max(distance(camera, center) - radius, 0)
detailAltitude = min(cameraAltitude, externally supplied detail altitude)

near = authoredNearAltitude
mid  = authoredMidAltitude
far  = authoredFarAltitude

nearWeight = 1 - smoothstep(near, mid, detailAltitude)
farWeight = smoothstep(mid, far, detailAltitude)
midWeight = clamp(1 - nearWeight - farWeight, 0, 1)
```

Altitude is only a coarse policy signal. The anti-aliasing decision comes from
the projected coordinate footprint. For a band at `f` cycles per field unit,
form the post-warp `E x 2` Jacobian `J'` from the previous section and use its
largest singular value together with the band's support multiplier:

```text
q_screen = f_support * sigmaMax(J')
q_mesh   = f * maxProjectedEdgeInFieldUnits
q        = max(q_screen, q_mesh)
```

The sampling-theorem boundary is **Derived** `q <= 0.5 cycles/sample`. Equality
is not a quality filter: choose an **Authored** transition `[q0, q1]` with
`q0 < q1 <= 0.5`, attenuate band amplitude smoothly over the interval, and
record it. For stochastic independent bands, transfer removed value/slope
energy using the sum of squared amplitudes; summing amplitudes biases the
variance. Mipmapped baked fields use texture gradients/LOD. Inline noise needs
this explicit band integration; hardware cannot infer its spectrum.

For one random-phase sinusoidal height band `a sin(k dot p + phi)`, mean-square
slope is **Derived** `a^2 |k|^2 / 2`. Independent bands add those variances.
For a noise kernel, integrate its measured/analytic gradient spectrum instead
of substituting octave count. Publish retained and removed slope variance per
footprint; the material owner consumes the removed component for normal-cone or
roughness filtering.

Use altitude weights only to cap quality or prevent distant work. Do not shift
frequency with the camera. If a band violates the footprint gate, prefilter it,
fade it with its residual variance transferred to roughness, or remove it from
displacement.

## Derivative Correctness

Use an analytic gradient when the field owns vertex displacement, geometry
generation, classification, or placement. For `p' = p + w(p)` and scalar
`h(p) = n(p')`, the chain rule is **Derived**:

```text
grad_p h = (I + J_w)^T grad n(p')
```

Dropping `J_w` is not an optimization-preserving approximation; it changes
slopes most where the warp is strongest. For `r = normalize(x)`, propagate the
**Derived** Jacobian `D normalize(x) = (I - r r^T) / |x|`. A tangential warp
`t = (I - r r^T)w(r)` also includes the derivative of the projector; merely
projecting the final gradient back to the tangent plane is not equivalent.

Screen derivatives are fragment-stage estimates only, and must execute in
derivative-uniform control flow. They are legal for filtered sub-patch material
detail whose absence does not change silhouette, identity, water
classification, or placement. Vertex/compute consumers need analytic,
automatic-symbolic, or stored gradients.

When analytic derivatives are unavailable, central difference has **Derived**
truncation `O(delta^2)` and roundoff amplification `O(u/delta)`. Choose `delta`
from field scale and a convergence sweep, not a fixed world epsilon; the
asymptotic balance is `delta = O(u^(1/3))` after nondimensionalization. A
gradient atlas must record coordinate scale, difference stencil, and storage
quantization.

### Parity error budget

For a round-to-nearest algebraic path, binary32 unit roundoff is **Derived**
`u_RN = 2^-24`. WGSL does not fix that rounding mode: a normal result may be
rounded to either adjacent representable value, so use the conservative
**Derived** one-ulp relative bound `u_WGSL ~= 2^-23` for portable basic-op
analysis. Under the standard conditioned model,
`gamma_n = n*u/(1-n*u)`. `n` is the longest dependent rounding path, not total
graph nodes; a fused FMA and separate multiply/add do not share a rounding
path. Cancellation, zero/subnormal neighborhoods, overflow, implementation
variation, contraction/reassociation, and operation-specific builtin accuracy
need interval/absolute analysis instead. `pow`, normalization, trigonometry,
and implementation noise kernels require separate **Gated** allowances or
replacement with parity-controlled algebra.

For each channel publish:

```text
epsilon_direct = epsilon_hash + kappa * gamma_n * scale + epsilon_builtin
epsilon_sample = epsilon_direct + epsilon_interpolation + epsilon_lod
epsilon_stored = epsilon_sample + 0.5 * ulp_format(decodedValue)
epsilon_grad   = epsilon_analytic_or_truncation
               + epsilon_direct_derivative
               + epsilon_storage_derivative
```

For a smooth scalar field sampled on rectangular texel spacing `hx, hy`, a
bilinear base-level bound is **Derived**
`epsilon_interpolation <= hx^2/8 sup|f_xx| + hy^2/8 sup|f_yy|` over the cell.
Add quantization and trilinear/LOD-selection terms separately. If a gradient is
formed by central differencing sampled values at spacing `delta`, bounded value
error contributes at most **Derived** `epsilon_value/delta` to that derivative,
in addition to the stencil truncation. These bounds are useful only when the
required derivative bounds exist; otherwise obtain a **Gated** empirical bound
from a dense adversarial sweep and retain margin for unseen inputs.

Use an f32 CPU oracle with explicit `Math.fround` at the intended rounding
boundaries to separate f64-vs-round-to-nearest-f32 drift from GPU variation;
it is not a proof of every WGSL rounding choice. Compare direct TSL output
before any store, then compare the stored/sample path separately.
An fp16 channel near `[0,1]` has **Derived** relative unit roundoff `2^-11` and
worst absolute rounding below one `2^-12 ~= 2.441e-4`; therefore a global
`1e-4` post-fp16-store gate is impossible in the worst case. UNORM8 contributes
**Derived** up to `1/(2*255) ~= 1.961e-3` before filtering.

For a decision `g(x) >= tau`, only assert the same bit where
`|g_cpu - tau| > epsilon_g`. If the uncertainty is expressed in input space,
the **Derived** guard is `epsilon_x >= epsilon_g / m`, where `m` is a proven
lower bound on `|dg/dx|` in the crossing interval. A mean error never replaces
the worst-case gate for classification. If a bound is exceeded, fix the
algorithm, derivative, format, or threshold; do not tune color to hide it.

## Terrain Wetness Field Coupling

For terrain interacting with water, make world height the cause and share it
across roughness, darkening, splash, and footprint consumers:

```text
soilIdentity = orientationMask * broadSoilField
grassIdentity = orientationMask * broadGrassField
heightWetness = 1 - smoothstep(wetLow, wetHigh, positionWorldY)
pooledWetness = heightWetness * lowFrequencySoilNoise
```

Use monotonic smoothstep edges. Older reversed-edge smoothstep idioms are
replaced because the portable path requires explicit increasing edges plus
`1 - smoothstep(...)` when inversion is needed.

## Water Field Coupling

Evaluate directional waves once and return coupled outputs:

```text
waveField(worldXZ, time) ->
  height
  analyticGradient
  normal
  crest
  foamSeed
```

A compact directional wave field derives all outputs from shared phase:

```text
phase_j = dot(k_j, worldXZ) - omega_j * time + phi_j
height = sum_j(a_j * sin(phase_j))
gradient = sum_j(a_j * k_j * cos(phase_j))
```

Wavelength `lambda_j = 2*pi/|k_j|`, direction, dispersion `omega_j`, amplitude,
and phase are **Authored** or supplied by the owning water model. The
**Derived** slope contribution scales as `a_j |k_j|`; cap/filter from slope
energy rather than counting waves. This recipe owns only the coherent field
interface, not a universal water spectrum.

Foam consumes the crest metric derived from the same slope and phase. Do not
sample unrelated scrolling masks for foam that should be caused by waves.

Attenuate small bands from projected footprint and wavenumber. When surface,
shoreline, foam, caustic, and post consumers share the field, evaluate the
parent cost equation with each consumer's actual invocations. Cross-system
reuse is evidence to test a bake, not an automatic bake decision.

## Structured Stochastic Placement

Constrained discrete placement is a field. Stratify before randomization:

```text
domain -> semantic cells -> valid slots -> jitter inside slot -> packed instance data
```

This applies to:

```text
branch emergence
facade variants
particle burst directions
crater distribution
cloud-cell placement
vegetation patches
```

For hot instance placement, generate transforms and masks in compute into
`StorageInstancedBufferAttribute`. Static parameters are computed once; dynamic
fields such as wind or growth phase update separately. Chunk placement by patch
bounds so frustum and distance culling remain effective.

## Field Placement Decision Table

| Field destination | Use it for | Rules |
| --- | --- | --- |
| CPU deterministic port | mesh generation, offline assets, parity expected values, precomputed native-WebGPU tier data | Same constants and seeds as TSL; no in-frame readback loop. |
| Geometry attribute | stable low-frequency coordinates or IDs | Write once, keep compact, recompute bounds after geometry changes. |
| Direct material node | fields whose measured invocation-weighted evaluation wins | Reuse one explicit local field bundle; no hidden per-channel noise. |
| `StorageTexture` | fields whose amortized bake/sample cost wins | Pack by access/filter/update pattern, choose mips deliberately, update static fields once. |
| `StorageBufferAttribute` | compute-generated per-point or mesh data | Use when compute owns updates and material/geometry consumes the buffer. |
| `StorageInstancedBufferAttribute` | dense placement transforms, masks, and LOD data | Generate and compact in compute; preserve patch-level culling. |
| Node post pipeline | diagnostics and downstream effects | Use `pass()`, `mrt()`, and reduced-resolution passes when inspecting many fields. |

## Channel Packing

Pack fields by consumer locality:

```text
terrainAtlas.r = macroHeight
terrainAtlas.g = ridge
terrainAtlas.b = cavity
terrainAtlas.a = moisture

identityAtlas.r = biomeBlend0
identityAtlas.g = biomeBlend1
identityAtlas.b = wetness
identityAtlas.a = placementMask
```

Rules:

- Scalar masks, vector fields, normals, roughness, wetness, weather, and LUT
  data are non-color data.
- Author-facing albedo inputs are color data; field masks are not.
- Pack only fields that share coordinates, filter/mip policy, precision,
  consumer locality, and update cadence. Packing unrelated lanes can increase
  bandwidth because every consumer fetches the full texel.
- Select the format from a propagated error bound and device features, then
  include base levels, mips, ping-pong, and alignment in the byte ledger.
- Store tile-local or normalized smooth values in fp16; reconstruct physical
  scale after sampling. Do not put absolute large-world coordinates in fp16.

Concrete storage texture setup:

```js
const texture = new StorageTexture(width, height);
texture.format = RGBAFormat;
texture.type = HalfFloatType;      // baseline rgba16float storage format
texture.colorSpace = NoColorSpace;
texture.minFilter = LinearFilter;
texture.magFilter = LinearFilter;
texture.mipmapsAutoUpdate = false; // no mip consumer; otherwise provide/generate a complete chain
```

Installed Three.js `0.185.1` format contract:

| Three.js format/type | WebGPU format | Bytes/texel | Capability/filter rule |
| --- | --- | ---: | --- |
| `RGBAFormat + HalfFloatType` | `rgba16float` | **Derived** 8 | Baseline writable storage and filterable sampled format. |
| `RGFormat + HalfFloatType` | `rg16float` | **Derived** 4 | **Gated** `texture-formats-tier1`; do not infer support from the Three.js enum. |
| `RedFormat + FloatType` | `r32float` | **Derived** 4 | Baseline storage; linear sampling is **Gated** `float32-filterable`. |
| `RGFormat + FloatType` | `rg32float` | **Derived** 8 | Storage is **Gated** non-compatibility/core WebGPU; compatibility mode forbids it. Linear sampling is separately **Gated** `float32-filterable`. |
| `RGBAFormat + UnsignedByteType` | `rgba8unorm` | **Derived** 4 | Baseline normalized storage; not an integer-ID texture. |

For extent `W x H` and format size `b`, base storage is **Derived** `W*H*b`;
a full 2D mip chain approaches `4/3` of that before alignment. Ping-pong doubles
the simultaneous allocation. If automatic mip generation is
used, set `mipmapsAutoUpdate = true`, select a mip filter, and verify generated
levels after compute; if false, manually write every sampled level. Use
`storageTexture()` only for exact storage loads/stores and `texture()` in a
later usage scope for filtered sampling.

fp16's **Derived** largest finite value is `65504`, smallest positive normal is
`2^-14 ~= 6.104e-5`, and smallest subnormal is `2^-24 ~= 5.960e-8`. Do not rely
on subnormal survival in a visual contract. For a linear `[decodeMin,
decodeMax]` encoding, include **Derived** decoded storage error
`(decodeMax-decodeMin) * 0.5 * ulp(encodedValue)` plus mip/interpolation error.

For exact category IDs prefer an r32uint/storage-buffer path or nearest exact
loads with an explicit normalized encoding. Linear filtering categorical IDs
is undefined semantically even when the format permits it.

## Parity Harness

Create fixed and conditioning probes before visual tuning:

```text
seed = fixed integer
probe coordinates = deterministic list of sphere directions, negative lattice
  cells, large stable world positions, and points inside/outside threshold guards
expected CPU fields = JSON or typed-array fixture
TSL diagnostic path = bake or render packed fields for the same probes
tolerance = generated epsilon_direct/epsilon_sample/epsilon_stored per channel
```

The `examples/webgpu-field-bake/` implementation uses
`field-constants.mjs` as the sole owner of u32 lattice hash multipliers,
lowbias32 mix constants, seed wrapping, octave parameters, warp offsets, and
derived-channel coefficients. CPU and TSL import the same `FIELD_ALGORITHM`
object. `validate-field-contract.mjs` first asserts that shared-object
identity, then checks `field-golden-fixtures.json` at an **Authored** `1e-12`
absolute CPU regression threshold.
Browser WebGPU readback writes `field-readback.json`;
`validate-field-contract.mjs --artifacts <dir>` compares every channel against
the CPU sampler using `FIELD_PARITY_ERROR_MANIFEST`. Its direct-f32 channel
limits and threshold guard are explicitly **Gated**, not derived from a rounded
operation count. The conditional `rgba16float` nearest-rounding term is
**Derived**, while interpolation and total stored-path error are explicitly
unvalidated. Without artifacts, the validator reports GPU parity as not run;
`--allow-missing-gpu` is CPU-diagnostic mode, never final acceptance.
Its GPU corpus also verifies the `u32` seed path and contains threshold probes
inside the declared output guard and immediately outside it on both sides.

The fixture now validates cost-model algebra, automatic-mip configuration, and
one `createFieldNodeBundle()` with named `.toVar()` intermediates. It remains a
regression fixture: its compute node is only a storage-binding smoke test and
its browser artifact is direct f32. Never use it as evidence for a real bake,
stored/filtered parity, mip contents, or production timing.

Checks:

- CPU and TSL match for primary fields and derived causes.
- Tangential warp remains tangent before renormalization.
- Geometry height and material height share the same macro function.
- Categorical masks are broad enough and sum/clip as intended.
- Baked texture channels decode to the same values as direct evaluation.
- No in-frame readback is used outside the explicit parity test.

## Performance Budgets And Lifecycle

Do not publish universal device-class rows. The application declares
whole-frame **Gated** GPU/CPU p95, peak-live-byte, quality-error, and sustained
thermal limits for each named workload. Band count, bake extent, dispatch
count, and memory are decisions produced by the spectrum and cost models, not
proxy budgets.

The workload/evidence record includes:

```text
frame: output extent, DPR, covered fragments, overdraw, MSAA, helper estimate
field: active bands, op classes, longest chains, Q_i, D, U
tiles: tile extent, total/dirty tiles, dirty texels, dispatch geometry, cadence
layout: sampled textures, samplers, storage textures/buffers by shader stage
traffic: producer/mip writes, consumer loads/samples, bytes/texel, cache/BW evidence
timing: base/candidate/paired-delta GPU p50/p95, whole-frame GPU/CPU p50/p95
memory: aligned extents, mips, layers, ping-pong/history, simultaneous lifetime
thermal: power state, warmup, sustained interval, throttling result
```

Interleave matched frames and form
`delta_k=tGPU_k(G+field)-tGPU_k(G)` before taking p50/p95; subtracting separate
quantiles is invalid. Use paired marginal evidence to diagnose the field, but
accept only against contemporaneous whole-frame gates. A timing without the
workload, tile, binding, sample, and traffic records is not **Measured**
evidence.

Lifecycle rules:

- Static fields compute once and dispose with their owning scene or asset.
- Slow fields update on cadence, not every frame.
- Editable fields use dirty tiles and targeted invalidation.
- Generated geometries, node materials, storage textures, and storage buffers
  have explicit ownership and disposal.
- Bounds are recomputed after geometry or instance extent changes.
- CPU readback is diagnostic-only.

## Cross-System Implementation Contract

Before coding, record:

```text
coordinate domain
physical/perceptual units
primary fields
derived causes
consuming channels
filtering rule
bake-vs-evaluate equation and measured A/B result
storage format and channel pack
per-channel direct/sample/store/gradient error budget
seed ownership
quality tier behavior
performance budget
resource owner and disposal point
```

### Physics signal publication

Apply the shared
[physics-domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md)
when a field drives support, contact, forcing, transport, a body solver, or
another physical interaction. A GPU resource is an implementation detail; the
portable boundary is a typed descriptor and provider:

```text
physics-facing field provider
  -> PhysicsSignalDescriptor
  -> batched PhysicsSampleRequest with requestedPhysicsTime: PhysicsTime
  -> samples carrying context/frame/footprint, state/resource versions,
     actualPhysicsTime: PhysicsTime, validity/error
```

Use the common envelope verbatim: `signalId`, `providerId`, `schemaId`,
`contextId`, owner/consumers/channels, `physicsFrameId`,
`physicsOriginEpoch`, `transformRevision`, optional `chartId`, `clockId`,
`samplePhase`, `representedFootprint`, filter, validity, `perChannelError`,
residency, cadence, latency, `stateVersion`, `resourceGeneration`, and
`missingChannelPolicy`. Channel records carry SI unit and scalar/vector/tensor
basis; errors carry unit, basis, norm, and hard-bound/measured/statistical/
unknown classification. `PhysicsSampleRequest.requestedPhysicsTime` and
`SampledChannel.actualPhysicsTime` both use the canonical discriminated
wrapper:

```yaml
PhysicsTime:
  kind: instant | interval
  instant: PhysicsInstant | TypedAbsence
  interval: PhysicsTimeInterval | TypedAbsence
```

The query semantics select the discriminant; exactly the selected arm is
present and the other arm is a canonical `TypedAbsence` record. Do not retype
either field as a raw `PhysicsInstant | PhysicsTimeInterval` or flatten the two
shapes. A packed texture channel, TSL `Fn`, CPU mirror, or render-LOD mesh may
implement the provider, but none is the ABI. The adapter performs conversion
once and returns the canonical `actualPhysicsTime` wrapper, `stateVersion`, and
`resourceGeneration` with every batch.
`stateVersion` is logical state, not GPU completion. The descriptor carries
`resourceGeneration` and `PhysicsResidencyDescriptor`; actual queue ordering
and completion use canonical `GpuStatePublication`. A host consumer needs an
explicit mirror or asynchronous completion with declared latency/error, never a
steady-frame synchronous readback. When physics-owned field state is rendered,
publish one `PresentedStatePair` with `motionBinding.kind: field` per stable
binding/provider into the view-independent `PhysicsPresentationCandidate`.
The previous and current pair arms each carry independent
`PresentationSampleProvenance`, `presentedInstant`, state handle, and field
spatial binding. The candidate owns its `PresentationResourceLease` records and no
camera or render mapping. `CameraViewPublication` owns previous/current render
sample instants and `RenderSimilarityTransform`s; `ViewPreparationPublication`
owns per-view visibility, shadows, caches, resets, and preparation lease refs.
The sealed snapshot references candidate binding IDs and lease refs rather than
copying pairs or transforms. Multi-target execution and every lease retirement,
abort, or device-loss disposition live in `FrameExecutionRecord`. Never render
from the mutable write buffer.

Optional channels not declared by the descriptor are absent; providers never
zero-fill a missing gradient, velocity, temperature, moisture, or category.

Publish separate descriptors for quantities whose dimensions or
interpolation differ. For a local coast these commonly include:

```text
terrain elevation                 m
bathymetric/bed elevation         m, same declared datum
metric coast distance             m, land-positive/water-negative
surface or bed gradient           dimensionless in the declared frame
coast-frame basis                 dimensionless, with invalid singular set
moisture/exposure                 declared physical unit or dimensionless model
categorical substrate/region ID   exact integer, nearest/no interpolation
physics material ID               exact PhysicsMaterialId, nearest/no interpolation
```

When contact or transport consumes a surface category, publish a distinct
categorical `PhysicsMaterialId` channel/reference resolved through the active
`PhysicsMaterialRegistry`. Never derive it from biome weight, visual substrate,
semantic color, filename, or PBR response.

Do not fold exact IDs, signed distance, and smoothed appearance weights into
one filtered sample. Do not publish a normal without its orientation,
conditioning mask, angular error, and footprint. A field/domain edit, storage
encoding change that changes accepted values, coast analysis revision, or datum
change increments the source revision and invalidates dependent samples. A
render floating-origin rebase emits a new `CameraViewPublication` whose
`RenderSimilarityTransform` and render-origin epoch change; it must not change `physicsFrameId`,
`physicsOriginEpoch`, stable SI identity, or source/state revision. A render-
cache LOD change likewise must not change physical signal identity.

Provider acceptance requires deterministic probes across tile seams, invalid
and medial-axis regions, threshold uncertainty, large rebased coordinates,
direct-versus-stored paths, and every supported footprint. Gate dimensional
metadata, context/frame/origin equality, version propagation, `PhysicsTime`,
per-channel value/gradient/position errors, and missing-data behavior before a
consuming solver runs. Consumer-specific smoothing belongs in an explicit adapter with
its own error record, never in a silently altered source descriptor.

Reject a field stack when:

- color, roughness, and normal use unrelated structure;
- geometry and material claim the same feature but evaluate different functions;
- a categorical mask is only a narrow threshold over noise;
- high-frequency terms survive after their projected footprint is subpixel;
- world effects use object coordinates or planetary effects use flat world Y;
- random placement has no strata, budget, or semantic constraints;
- a field is baked without a lower measured amortized cost or required
  cross-stage/frame reuse to justify it;
- a hot field requires in-frame CPU readback.

## Diagnostics

Expose:

```text
source coordinates
tangential warp vector
each frequency band
actual geometry height versus material height
humidity, temperature, slope, cavity, and identity masks
near/mid/far or projected-footprint weights
water normal and crest from the same evaluation
wetness by world height
seed and stratification cells
baked channel pack
CPU parity error
```

Use `mrt()` when multiple debug outputs share the same scene pass. Use
`PassNode.setResolutionScale()` for cheaper broad diagnostics, then inspect
single-field views at full resolution only when necessary.

Diagnostic render contracts:

Ranges below are **Authored** visualization encodings unless the field manifest
derives a tighter physical range. Error outputs use the per-channel **Gated**
bound, never a global tolerance.

| output | channel | space | expected range | visual signature | classic wrongness | screenshot assertion |
| --- | --- | --- | --- | --- | --- | --- |
| source coordinates | rgb | linear data | -1..1 or domain scaled | stable bands under camera motion | swimming/noise locked to screen | fixed camera pan changes framing, not field value |
| tangential warp | rgb | linear data | -0.5..0.5 | no radial spikes on spheres | polar swirl or radial bulge | tangent dot radial near zero |
| frequency bands | rgba | linear data | 0..1 | macro/meso/micro separated | one band drives all channels | each lane has distinct histogram |
| CPU parity error | r | linear data | 0..tolerance | mostly black with sparse bright failures | broad white drift | max error below tolerance |
| direct-vs-baked | r | linear data | 0..tolerance | black diff | stale dirty tiles | edited tile is the only changed region |
| packed atlas | rgba | NoColorSpace | 0..1 | lane meaning matches schema | sRGB-as-data contrast shift | channel medians inside manifest coverage |
| identity masks | rgba | linear data | 0..1 | broad regions | isolated bubble speckles | connected regions exceed minimum area |
| wetness/water crest | rgba | linear data | 0..1 | caused by height/waves | unrelated scrolling mask | crest aligns with wave slope |
