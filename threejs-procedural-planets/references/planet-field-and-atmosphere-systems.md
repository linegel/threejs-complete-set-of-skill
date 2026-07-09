# Planet Field And Atmosphere Systems

Use this reference for a native-WebGPU/TSL procedural planet system: explicit
surface-map choice, quadtree/CDLOD/clipmap selection, cached shared fields,
instanced or indirect patch submission, compute-backed parity, geodesic
geology, gas-giant representation, atmosphere handoff, diagnostics, and
performance budgets. The contract targets general 3D, geospatial/scientific,
cinematic, and interactive visualization rather than a game-specific loop.

## Numeric Provenance

Every implementation number is tagged:

- **[Derived]**: follows from units, geometry, mapping, or a stated equation;
- **[Gated]**: acceptance threshold/resource ceiling with a rejecting test;
- **[Measured]**: captured on a named revision/browser/device/GPU/resolution;
- **[Authored]**: visual/default quality choice, not a hardware or physics fact.

Grid sizes, active-patch ranges, update cadences, field octaves, and GPU times
are authored until target evidence replaces them. Literal constants in exact
algebra are derived.

## Contents

1. Architecture first
2. Renderer, material, and compute baseline
3. Capability gate and quality tiers
4. Surface mapping and LOD choice
5. Quadtree/CDLOD submission and crack contract
6. Shared planet field bundle and cache
7. CPU query and TSL compute parity
8. Crater stamps and geological structures
9. Altitude-filtered detail
10. Climate, hydrology, and biomes
10a. Planetary coast and water handoff
11. Solid-body material assembly
12. Gas and ice giants
13. Analytic gradients and specular anti-aliasing
14. Atmosphere handoff
15. Node post pipeline
16. Diagnostics, performance, and validation
17. Replaced sub-best techniques

## 1. Architecture First

The default globe/orbit architecture is a cube-sphere quadtree whose visible
patches are selected by projected geometric error, cached by dirty cause, and
submitted in instanced topology bins. A local tangent geometry clipmap is
better for long-lived ground views because it provides a fixed number of
regular rings and draws; a hybrid transitions from global quadtree to local
clipmap. Algorithm class matters more than micro-optimization.

Build the system in this order:

1. Planet constants: center, radius, sea level, atmosphere radii, render scale,
   seed, and body preset data.
2. Surface mapping and LOD owner: normalized/spherified/equal-area cube,
   quadtree/CDLOD/clipmap/hybrid, stable patch IDs, mapping Jacobian,
   conservative error/bounds, neighbor levels, and transition edges.
3. Shared field bundle: macro continents/basins, ridges, craters, climate,
   hydrology, ice/snow, volcanic or dusty causes, and body-specific masks.
4. Compute field cache: patch direction, tangential warp, height, tangent
   gradient, material causes, conservative bounds, and cache version.
5. Render support: one shared indexed grid, instanced patch records, optional
   r185 indirect draw arguments, parity samples, crater indices, and diagnostic
   storage. On-the-fly vertex field evaluation is reserved for rapidly changing
   bodies or a measured cheaper path.
6. Material outputs: albedo, roughness, metalness, clearcoat/wetness, normal,
   emission for hot surfaces, and debug modes from the same causes.
7. Atmosphere handoff: shared planet transform, surface altitude, water/ice
   identity, horizon mask, and radiance scale.
8. Node post: single output transform, temporal anti-aliasing, ambient
   occlusion, full-scene HDR bloom when justified by radiance, selective
   emissive bloom only when separately proven, and shadow nodes when needed.

## Units And Validity Range

Use a unit-bearing body model; never encode conversion in an ambiguously named
scalar. Recommended fields are `radiusMeters`, `metersPerWorldUnit`,
`heightMeters`, and dimensionless unit direction. Atmosphere receives the same
`metersPerWorldUnit` boundary.

| term | provenance | contract |
| --- | --- | --- |
| body radius/axes | **[Authored or measured input]** | meters; no generic planet radius is a physically meaningful default |
| render conversion | **[Derived]** | `worldPosition = meters / metersPerWorldUnit`; invert exactly once at the body boundary |
| height amplitude | **[Authored]** | meters or a declared fraction of reference radius; never mix the two in one field |
| sea level | **[Authored]** | same units as height; physical classification uses the sharp coast field |
| humidity/temperature | **[Authored model]** | normalized only if the model is dimensionless; scientific data retains its physical units |
| crater angular radius | **[Authored or dataset input]** | radians on the reference surface; convert linear radius with the declared local curvature |
| sphere/ellipsoid choice | **[Gated]** | selected by allowed position/normal/area/optical-depth error, not a universal flattening breakpoint |

A `0.5%` flattening switch is not a derivation: Earth flattening is roughly
`0.335%`, yet geospatial height and limb error can still require ellipsoid
math. Publish the maximum surface-position, area, horizon, and atmosphere
handoff error for any spherical approximation.

## 2. Renderer, Material, And Compute Baseline

Use current Three.js WebGPU modules only:

```js
import {
  HalfFloatType,
  IndirectStorageBufferAttribute,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  NoColorSpace,
  SRGBColorSpace,
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
  StorageTexture,
  WebGPURenderer,
} from "three/webgpu";

import {
  Fn,
  If,
  Loop,
  atomicAdd,
  atomicSub,
  attribute,
  cameraPosition,
  dFdx,
  dFdy,
  float,
  fwidth,
  instanceIndex,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  positionLocal,
  renderOutput,
  storage,
  storageTexture,
  textureStore,
  uniform,
  velocity,
  vec2,
  vec3,
  vec4,
  workgroupBarrier,
} from "three/tsl";

import GTAONode from "three/addons/tsl/display/GTAONode.js";
import BloomNode from "three/addons/tsl/display/BloomNode.js";
import TRAANode from "three/addons/tsl/display/TRAANode.js";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { TileShadowNode } from "three/addons/tsl/shadows/TileShadowNode.js";
```

Planet materials should be `MeshStandardNodeMaterial` for most rocky and icy
bodies, `MeshPhysicalNodeMaterial` when water, clearcoat, transmission-like ice,
or richer specular response matters. Drive `colorNode`, `roughnessNode`,
`metalnessNode`, `normalNode`, `emissiveNode`, and `positionNode` from the
shared field bundle.

These imports are verified against installed Three.js `0.185.1`. Use
`StorageBufferAttribute` for patch records, parity samples, and generated data;
use `StorageInstancedBufferAttribute` for repeated patch metadata. r185 exposes
`IndirectStorageBufferAttribute` from `three/webgpu` and
`BufferGeometry.setIndirect(attribute, byteOffsetOrOffsets)` for native-WebGPU
indirect draws. The indexed record is
`{indexCount:u32, instanceCount:u32, firstIndex:u32, baseVertex:i32, firstInstance:u32}`.
Because the Three attribute uses `Uint32Array` storage, encode a negative
`baseVertex` as its i32 two's-complement bit pattern or gate it to zero; keep
`firstInstance=0` unless the adapter's `indirect-first-instance` capability is
explicitly recorded.

Use `StorageTexture` for field/crater tile atlases when filtered 2D access beats
buffer layout. `workgroupBarrier()` is valid in compute workgroups. WGSL atomics
are integer atomics: do not call `atomicMin`/`atomicMax` on float heights. Reduce
float min/max in workgroup memory and emit one record, or prove a monotone
float-to-uint ordering transform including negative values, NaN rejection, and
inverse decoding. Integer atomics remain suitable for counters/compaction.

r185 source proofs in the installed package:

| contract | proof target |
| --- | --- |
| `IndirectStorageBufferAttribute` export/layout | `node_modules/three/src/Three.WebGPU.js` and `renderers/common/IndirectStorageBufferAttribute.js` |
| `BufferGeometry.setIndirect(attribute, offsets)` | `node_modules/three/src/core/BufferGeometry.js` |
| `drawIndexedIndirect`/`drawIndirect` submission | `node_modules/three/src/renderers/webgpu/WebGPUBackend.js` |
| integer atomic and `workgroupBarrier` TSL exports | `node_modules/three/src/Three.TSL.js` |
| node-effect export shapes | installed `node_modules/three/examples/jsm/tsl/` and `examples/jsm/csm/` modules |

LDR color art encoded with an sRGB transfer uses `SRGBColorSpace`; procedural
causes, height, normals, IDs, cache tiles, and masks use `NoColorSpace`.
Calibrated reflectance/radiance/spectral datasets keep their declared linear
basis and unit metadata. Convert material color to scene-linear working RGB
once; neither cache storage nor diagnostics applies display transfer.

## 3. Capability Gate And Quality Tiers

Compute/storage features require an initialized renderer. Gate once and choose
a quality tier:

```js
const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( "threejs-procedural-planets requires a native WebGPU backend" );
}
```

Full tier:

- compute-generated patch records, conservative bounds, and dirty field tiles;
- `material.positionNode` reconstructs/samples cached displacement, or evaluates
  the shared field live only when a measured dynamic-body path requires it;
- parity sample buffers enqueued by `renderer.compute()` and completed by an
  explicit validation readback/fence operation; r185 `computeAsync()` is not a
  GPU-completion fence;
- node MRT diagnostics;
- dynamic crater/biome atlases and atmosphere masks.

Balanced tier:

- fewer active patch rings;
- **[Authored]** 17-33 vertices per shared patch-grid side;
- cached far-field patch bounds;
- lower crater stamp count;
- disabled optional material channels beyond roughness/normal/wetness.

Minimum-resident path, still native WebGPU:

- smaller shared grids and cached patch tiles;
- CPU frontier selection at a gated cadence plus instanced transition-mask bins;
- coarse material fields, no runtime parity readback, and no hidden per-patch draws;
- the same public field/LOD contract with lower spatial fidelity.

## 4. Surface Mapping And LOD Choice

Create a canonical unit direction from face, patch UV rectangle, and shared
grid coordinate. Never reconstruct geology coordinates from displaced
positions. The mapping is an algorithm choice:

| mapping | strengths | costs/failure modes | choose when |
| --- | --- | --- | --- |
| normalized cube `n=normalize(face(u,v))` | cheapest, simple inverse face selection, analytic derivatives | **[Derived]** area Jacobian on a face is proportional to `(1+u^2+v^2)^(-3/2)`; `J_center/J_corner=3*sqrt(3) ~= 5.196`, so uniform UV samples are about 5.196 times denser at corners | budgets dominate and Jacobian-aware LOD/filtering passes the visual/area gates |
| spherified cube | lower corner distortion for modest extra ALU; continuous when one shared formula owns all faces | not exactly equal-area; square roots and derivative chain must be shared by CPU/TSL | general visual planets when normalized-cube distortion is visible |
| quadrilateralized/equal-area cube | near-uniform area weights useful for scientific integration, sampling, and consistent texel density | more expensive map/inverse, sensitive face orientation and seams; “equal area” must be demonstrated numerically | conserved-area datasets, statistics, or strict sampling uniformity |

One common spherified-cube map for cube point `(x,y,z)` is:

```text
sx = x*sqrt(1 - y^2/2 - z^2/2 + y^2*z^2/3)
sy = y*sqrt(1 - z^2/2 - x^2/2 + z^2*x^2/3)
sz = z*sqrt(1 - x^2/2 - y^2/2 + x^2*y^2/3)
n  = normalize(vec3(sx,sy,sz))
```

The coefficients are **[Derived]** from this selected map, not universal
planet constants. Validate finite Jacobian, consistent winding, exact shared
edge positions, corner ownership, inverse face selection, and area-ratio
histograms. Precompute directions/derivatives once when an expensive mapping is
static; do not pay its inverse or Jacobian in every fragment.

For an ellipsoid, declare what the unit direction means. With semi-axes
`a=(ax,ay,az)`:

```text
# geocentric radial direction n
t  = 1 / sqrt(sum_i(n_i^2/a_i^2))
p0 = t*n
N0 = normalize(p0/(a*a))

# reference-normal/geodetic direction n
p0_i = a_i^2*n_i / sqrt(sum_j(a_j^2*n_j^2))
N0 = n
```

These **[Derived]** maps coincide on a sphere but not on a flattened body.
Height along `N0`, crater distance, latitude, dataset coordinates, projected
error, and atmosphere handoff must all use the selected semantic. Calling a
geocentric radial displacement “geodetic height” is a contract violation.

Choose LOD by camera domain:

- **cube-face quadtree**: best for arbitrary orbit-to-horizon visibility and
  sparse close regions; requires balanced neighbors and submission batching;
- **CDLOD on the quadtree**: adds distance-continuous morphing to parent sample
  positions, reducing split/merge popping while keeping discrete topology;
- **tangent geometry clipmap**: fixed regular rings and few draws for sustained
  local/ground views, but needs floating-origin recentering, curvature mapping,
  and a far-globe owner;
- **hybrid**: global quadtree supplies horizon/orbit while a local clipmap owns
  the near footprint. Cross-fade displacement and normals from the same field;
  do not render both at full weight.

Apply the shared
[physical-pixel projected-error contract](../../threejs-choose-skills/references/projected-error-contract.md).
The support includes base-map curvature, displacement, warp, cache
quantization, LOD morph, floating-origin reconstruction, and the motion envelope
during dwell. Use the actual physical render-target extent and unjittered
projection for every eye/view. A center-distance formula with
`max(distance-boundRadius, cameraNear)` is not conservative for off-axis depth
error: perspective-denominator motion can dominate. Project the expanded
support through the actual matrix and reject near-plane/`w<=0` crossings; do
not clamp them into a finite error.

The fixture's matrix helper computes a maximum over a finite supplied support
witness. It does not prove that the witness covers the continuous displaced
patch. Production bounds require interval/analytic support or an independently
validated conservative enclosure. Split above `E_split`, merge below a lower
`E_merge`, and record hysteresis/cadence. Recompute the frontier only when the
camera crosses a predicted error boundary or a dependency changes, not on an
unconditional frame modulus.

## 5. Quadtree/CDLOD Submission And Crack Contract

Maintain a restricted quadtree: edge-adjacent leaves differ by at most one
level, including transformed adjacency across cube faces. Assign canonical
edge/corner ownership so both sides evaluate identical direction, height, and
morph weight.

Use one shared indexed `(N x N)` grid per topology. For each patch, derive a
four-bit mask for north/east/south/west edges adjacent to a coarser patch.
Prebuild the **[Derived]** `2^4 = 16` index variants that collapse every other
fine edge vertex onto the coarse edge. CDLOD morph snaps interior vertices
toward their parent-grid sample continuously over the error band; transition
indices guarantee topology at the boundary. Apply the same morphed direction
before height evaluation, or position and normal will diverge. Skirts are only
a conservative guard for unresolved data gaps and must have a debug view.

Production submission paths:

1. CPU frontier + instanced bins: bin compact patch records by transition mask
   and material/preset, upload dirty contiguous ranges, issue one instanced draw
   per nonempty bin. This is usually the lowest-risk mobile path.
2. GPU cull/compact + indirect: CPU maintains a coarse candidate frontier;
   compute performs frustum/horizon/optional occlusion culling, compacts patch
   indices, and writes r185 indirect records. Bind with
   `BufferGeometry.setIndirect()`. Avoid recursive GPU quadtree traversal and
   avoid readback.

When `indirect-first-instance` is unavailable, each mask bin uses a binding or
compact buffer whose logical instance zero is the bin start, or uses the CPU
instanced-count path. Do not write a nonzero `firstInstance` and hope the
backend emulates it.

Pack hot patch data as aligned `vec4`/SoA records: face/level/UV rectangle,
body-relative bound, morph/error, cache index/version, transition mask, and
crater-list range. A nominal “64-byte record” is **[Authored]** until the actual
typed-array/storage layout reports bytes. Do not upload full matrices when
face basis plus UV scale/offset reconstructs the patch.

Starting workload trials, all **[Authored]**:

| trial | shared grid side | active patches | dirty dispatches/update | derived triangle formula |
| --- | ---: | ---: | ---: | --- |
| full-detail | 33-65 | 120-480 | 1-4 | `P*2*(N-1)^2` |
| budgeted | 17-33 | 80-240 | 0-2 | `P*2*(N-1)^2` |
| minimum-resident | 17-33 | 48-160 | 0-1 amortized | `P*2*(N-1)^2` |

The four transition bits give a **[Derived]** maximum of 16 mask bins per
body/material group. This is not a universal scene draw budget.

A dispatch is one command; a workgroup is an execution subdivision selected by
the compute node/backend. Report both dispatch count and derived/observed
workgroup count. Calling dispatches “groups” obscures command overhead and
occupancy.

At the **[Authored]** minimum-resident endpoint `P=160,N=33`, the
**[Derived]** count is
`327,680` triangles, not an opaque “160 patches.” Record vertex invocations,
cache misses, overdraw, CPU submit time, and GPU time alongside it.

## 6. Shared Planet Field Bundle And Cache

Every body exposes one `planetFields(direction, preset)` TSL `Fn` returning a
structured bundle:

```text
height
macroHeight
ridge
craterFloor
craterWall
craterRim
ejecta
continent
oceanDepth
humidity
temperature
ruggednessProxy
snow
ice
wetness
biomeWeights
biomeId
roughnessCause
atmosphereMask
debugChannels
```

This list is a target schema, not automatic CPU/TSL proof. The bundled fixture
machine-separates CPU key presence, CPU golden channels, conditional GPU parity
channels, and excluded channels. Its `ruggednessProxy` is an authored blend of
ridge/crater/material causes; it is not metric slope. Its `roughnessCause` is a
base-material cause; it is not unresolved normal variance.

The field coordinate is a unit direction plus explicit metric scale:

```text
terrainMeters = surfaceDirection * radiusMeters
warp = fieldNoise(terrainMeters * frequencyPerMeter, seed)
tangentWarp = warp - surfaceDirection * dot(warp, surfaceDirection)
warpedDirection = normalize(terrainMeters + tangentWarp * warpMeters)
```

Tangential warp and renormalization are preserved because they prevent
region-scale coordinate dilation. The terrain stack should keep macro
silhouette fields separate from sub-patch material detail:

- macro: continents, basins, dichotomy, volcanic provinces, mountain chains;
- meso: ridges, crater rims, canyon systems, dunes, foothills;
- micro: normal-only grain, wetness breakup, frost, ash, small ejecta.

Material-only micro detail must not change biome altitude, water identity, or
query/analysis height.

### Dirty patch cache

For static or slowly changing bodies, evaluate macro/meso height, a
**validated** tangent derivative, conservative min/max, and material causes once when a patch enters or
its dependency hash changes. Store a cache version in the patch record.
Rendering reconstructs direction from the shared grid and samples the cached
field tile; only unresolved micro detail runs per fragment. This avoids paying
all fBm, crater, climate, and warp work in every vertex every frame and then
again in every fragment.

Use texel gutters populated from the canonical neighboring face/patch mapping,
not duplicated face-local noise, so filtered values and derivatives match
across seams. Derive the integer gutter:

```text
g = ceil(maximumWarpDisplacementTexels
       + max(reconstructionFilterRadiusTexels,
             derivativeStencilRadiusTexels,
             maximumProjectedFootprintRadiusTexels))
```

The projected radius includes the admitted anisotropic footprint at the cache
LOD. For a logical `N x N` RGBA16F height/derivative tile, payload is
**[Derived]** `8*(N+2*g)^2` bytes. A one-texel gutter is valid only when the
derived `g<=1`; it is not a default. Report all companion cause tiles,
atlas fragmentation, double-buffering, and alignment rather than quoting only
this channel. Half-float meters may quantize high relief too coarsely: encode a
per-patch affine height residual (`h=offset+scale*hEncoded`) or use a measured
format whose maximum metric height and normal error pass the gate. Format size
alone does not authorize RGBA16F.

Cache dependency keys include body seed/preset revision, mapping revision,
patch ID/level, field constants, crater-list version, climate/dataset revision,
and cache format. Camera pose, light, exposure, and atmosphere do not dirty
geology. Use an LRU/fence-safe allocator; never overwrite a tile still consumed
by an in-flight render. A parent and child can share coarse causes, but a child
must own the residual/error needed by its LOD gate.

## 7. CPU Query And TSL Compute Parity

Picking, geospatial analysis, measurement, camera constraints, and atmosphere
sampling may need CPU-visible queries. The throughput path batches query
directions into storage,
runs the same TSL field `Fn` in compute, and reads back only the requested
sample buffer outside the frame-critical path:

```js
const queryDirections = new StorageBufferAttribute( queryCount, 4 );
const queryResults = new StorageBufferAttribute( queryCount, 4 );

const samplePlanetFields = Fn( () => {
  const direction = storage( queryDirections, "vec4", queryCount )
    .element( instanceIndex )
    .xyz
    .normalize();
  const fields = planetFields( direction, planetPreset );
  storage( queryResults, "vec4", queryCount )
    .element( instanceIndex )
    .assign( vec4( fields.height, fields.oceanDepth,
                   fields.ruggednessProxy, fields.roughnessCause ) );
} )().compute( queryCount );

await renderer.init();
renderer.compute( samplePlanetFields );
const resultBytes = await renderer.getArrayBufferAsync( queryResults );
```

For latency-sensitive scalar queries, generate a CPU/WASM mirror from the same
schema. `computeAsync()` is not a completion fence in r185; the asynchronous
`getArrayBufferAsync()` operation above is the CPU-visible completion point.
Do not continuously read GPU results in production; parity readback is an
asynchronous validation path. The harness runs fixed directions, face
edges/corners, crater centers/rims, biome/coast thresholds, all presets, and
**[Authored]** at least three seeds. Require the exact declared Cartesian
product, nonempty input, unique keys, and no extra/missing channels; sampling a
convenient subset is not parity evidence. Report per-channel max, mean, p95,
worst direction, and height error in meters. Report normal angular error only
after derivative correctness passes an independent oracle. Any field or format
revision deliberately updates a versioned baseline.

Parity-bearing scalar fields use integer lattice value noise, not a
transcendental hash. The canonical family is `lowbias32-u32-lattice`; selecting
its multipliers, shifts, and seed decorrelators is an **[Authored identity]**,
not a statistical-quality or performance claim. CPU
corner hashes use `Math.imul` plus `>>> 0` wrapping, and TSL corner hashes use
`uint` arithmetic, `bitXor`, shifts, and the same lowbias32 finalizer. The
`u32 -> f32` conversion is the shared corner-value generator. The integer hash
can be bit-exact; the floating result is not bit-exact unless the CPU mirror
applies f32 rounding (`Math.fround` at every specified operation or a WASM f32
reference). Transcendentals, fused multiply-add behavior, interpolation, fBm,
crater shaping, and gradients require numeric tolerances. Derive starting
tolerances from f32/half-cache quantization and field Lipschitz/error bounds,
then tighten them with measured golden fixtures; do not declare one tolerance
for height, categorical IDs, and normals.

## 8. Crater Stamps And Geological Structures

Replace crater-like noise with geodesic crater stamps for bodies where craters
affect silhouette or biome identity. Each crater record contains:

```text
centerDirection
angularRadius
floorDepth
wallSlope
rimHeight
ejectaStrength
age
erosion
seed
```

Compute crater influence from stable geodesic distance and return its tangent
gradient in the same traversal:

```text
c     = clamp(dot(n, craterCenter), -1, 1)
s     = length(cross(n, craterCenter))
theta = atan2(s, c)
q     = theta / angularRadius
towardCenter = (craterCenter - c*n) / max(s, eps)
gradSphere(theta) = -towardCenter
gradSphere(q)     = -towardCenter / angularRadius

floor  = 1 - smoothstep(0, floorEdge, q)
wall   = smoothstep(floorEdge, rimInner, q)
       * (1 - smoothstep(rimInner, rimOuter, q))
rim    = exp(-((q-rimCenter)/rimWidth)^2)
ejecta = radialRayField(n, craterCenter, seed) * falloff(q)
```

`atan2(s,c)` retains precision for small and near-antipodal angles better than
`acos(c)`. At `s<eps`, require the radial height profile derivative to approach
zero and return zero tangent gradient; do not normalize an undefined tangent.
Profiles that affect displacement are at least C1 at floor/wall/rim support
boundaries, or grazing-light normals will reveal rings.

This is exact great-circle distance on a sphere. On an ellipsoid, unit-sphere
angular distance is only a parameter-space approximation. Use an ellipsoidal
inverse-geodesic solver for data-accurate crater radii, or a local first/second
fundamental-form metric for small stamps and gate distance/circularity error
over the full support. The render cube mapping must not distort crater distance;
evaluate stamps in the declared physical surface metric. Prefer a
Karney-class ellipsoidal inverse for robust near-antipodal data; Vincenty-style
iteration requires a convergence failure path.

Do not loop over every global crater per vertex/texel. Bin records in the same
cube-face hierarchy (with cross-face overlap) or another declared spherical
index. Each patch record stores a range into a compact crater-index buffer.
Large basins live in the macro field; active meso craters are evaluated
analytically; old/small crater populations can be baked into a residual tile.
Conservatively include a crater when its geodesic support intersects the patch
normal cone. Publish maximum list length and overflow policy; silently dropping
stamps changes both silhouette and scientific counts.

Make overlap deterministic. For a purely compositional surface, excavation may
take the deepest signed floor while rims/ejecta use bounded additive weights.
For chronological geology, sort by age then stable ID and declare the
noncommutative erosion/deposition operator. A generic “priority blend” is not a
reproducible model. Degraded craters reduce rim height, soften wall slope, fill
the floor, and keep faint ejecta or albedo scars. The crater
outputs feed height, roughness, color, dust retention, ice traps, and debug
views. This replaces pure cavity noise because explicit stamps provide
controllable topology and survive close approach.

Other named structures should be authored as fields, not paint layers:

- continents and basins from low-frequency warped region fields;
- tectonic ridges from anisotropic/ridged fields with uplift masks;
- volcanic provinces from radial shields, caldera masks, and lava flow age;
- canyon systems from curve-distance fields on the sphere;
- polar caps from latitude, temperature, altitude, and seasonal masks.

## 9. Altitude-Filtered Detail

Camera altitude is useful for policy, but it is not a spatial-frequency filter.
Derive represented spacing from patch geometry and screen footprint:

```text
vertexSpacing = patchArcLength / (gridSide - 1)
pixelFootprint = worldLengthOfOnePixelAtSurface
representedScale = max(vertexSpacing, pixelFootprint)
```

For a field octave/detail wavelength `lambda`, attenuate before it aliases:

```text
detailWeight = smoothstep(kReject*representedScale,
                          kFull*representedScale,
                          lambda)
```

`vertexSpacing` and projected footprint are **[Derived]**. The starting
`kReject>=2` Nyquist boundary and a wider full-strength transition are
**[Gated]** by alias-energy and temporal-shimmer captures, not fixed world
distances. Use derivative-aware analytic filtering or octave attenuation in
fragments; do not evaluate then clamp aliased noise.

Apply those weights to contribution strength for:

- normal perturbation;
- bump height;
- coastline width;
- water detail;
- snow/frost breakup;
- clearcoat/wetness;
- roughness variance;
- biome jitter;
- crater micro-ejecta.

Frequency remains stable; only amplitude and channel participation fade. Macro
silhouette wavelengths stay in the displacement cache at every altitude where
their projected error exceeds the LOD gate. Micro detail migrates to filtered
normal/roughness channels instead of forcing tessellation.

Normal queries must not central-difference the full planet field in the render
path. `planetFields()` returns height plus two tangent-gradient components from
one fBm/crater traversal, then the dirty cache stores them. The call-count
reduction from four central samples to one fused value/gradient evaluation is
**[Derived]**; the speedup is **[Measured]**, because gradient ALU and cache
traffic are not free. `validate-planet.mjs` gates both value and gradient error.

## 10. Climate, Hydrology, And Biomes

Biome classification is derived from causes:

```text
humidity = broadMoisture * 0.65 + localMoisture * 0.35 - rainShadow
temperature = latitudeInsolation - altitudeLapse + oceanModeration
slope = 1 - abs(dot(localNormal, surfaceDirection))
oceanDepth = max(seaLevel - height, 0)
```

This is an **[Authored visual climate model]**, not a validated climate solver.
For drainage that must remain stable as render LOD changes, solve on a separate
fixed spherical analysis graph or equal-area raster: fill/route depressions,
compute downhill flow and contributing area, then sample the result in render
patches. Never derive river topology independently on transient quadtree
leaves. Rain shadow integrates moisture along the declared prevailing wind;
white noise named `rainShadow` is not a cause. Scientific scenes ingest or
solve unit-bearing temperature/precipitation fields and record resampling error
rather than relabeling normalized noise as physical data.

Generic masks:

- snow: cold plus altitude plus low slope;
- ice: temperature, latitude, oceanDepth, and seasonal mask;
- arid: low humidity plus warmth plus rain shadow;
- lush: humidity, temperature, low aridity, and moderate slope;
- rock: slope, ridges, low soil depth, and crater freshness;
- beach/coast: physical land-water boundary plus altitude-filtered visual
  width.

Keep two coast widths: a broader visual color edge for orbit stability and a
sharper physical land/water edge for material classification. Use the physical
edge for water shading and atmosphere humidity masks. Derive visual width from
pixel footprint and cache resolution; a fixed normalized threshold changes
apparent coastline width across LOD.

### 10a. Planetary coast and water handoff

This interface exists only when body curvature, global geodesy, or
orbit-to-ground LOD is observable. A bounded archipelago or coastal site whose
working domain is adequately planar uses the procedural-fields/geometry path;
wrapping it around a planet adds cube-face seams, global cache traffic, and LOD
state without improving the accepted image or data contract.

Make “adequately planar” an error test. For a spherical reference of radius
`R` and maximum tangent-plane radial extent `r<R`, the omitted curvature has
**[Derived]** sagitta `s = R - sqrt(R^2-r^2)` and normal rotation
`theta = asin(r/R)`. Project `s` with the actual camera and gate world/physical-
pixel position error, normal error, horizon visibility, geodesic-distance error,
and any atmosphere coupling. For an ellipsoid, use the local principal radii
of curvature over the complete domain rather than substituting one global
radius. If all gates pass, the planet route is rejected even when the subject
is narratively an island on a planet.

For a planetary ocean, the body owner publishes an immutable/versioned mean
surface and seabed query. A minimal sample is:

```text
planetCoastSample(direction, analysisVersion) -> {
  referencePointMeters, referenceNormal,
  terrainHeightMeters, meanSeaSurfaceHeightMeters,
  signedWaterColumnMeters,                 # positive below mean sea surface
  coastGeodesicDistanceMeters,             # land-positive, water-negative
  coastLandwardTangent, coastSeawardTangent, coastAlongTangent,
  bathymetryGradientPerMeter,
  seabedMaterialWeights, hydrologyRegionId,
  sourceResolutionMeters, maxHeightErrorMeters,
  maxCoastDistanceErrorMeters, validityMask, version
}
```

`signedWaterColumn = meanSeaSurfaceHeight - terrainHeight` is vertical/reference-
normal clearance; it is not coast distance. `coastGeodesicDistance` is
land-positive/water-negative distance along the declared sphere/ellipsoid
metric to the zero set and therefore remains
stable when render patches split. Compute it on the fixed analysis graph/raster
or from a separately validated distance field, including cross-face propagation;
normalizing the height gradient does not turn height into a metric distance.
`coastLandwardTangent` is the normalized intrinsic gradient of that distance,
`coastSeawardTangent=-coastLandwardTangent`, and
`coastAlongTangent=normalize(cross(referenceNormal,coastSeawardTangent))`
fixes the handed frame. At cusps, medial axes, tiny islands below source resolution, and invalid
dataset regions, return an invalid/ambiguous frame rather than a fabricated
direction.

The query declares whether the mean sea surface is constant reference altitude,
an equipotential/geoid, a dataset, or another unit-bearing model. The water
system adds time-varying displacement about that mean and consumes bathymetry at
its own solver/sample footprint. It must not change the body coastline by
sampling a lower render LOD, and the planet material must not add a second wave
displacement to the seabed. A local water tile records the planet-field version,
input footprint, and resampling/error bound; a body-field or sea-level revision
invalidates only overlapping tiles.

Ownership is explicit:

- planet: reference surface, land/seabed height, physical coast zero set,
  metric coast frame, hydrology regions, seabed classes, and uncertainty;
- water: free-surface state, waves/currents, wet/dry dynamics, breaking/foam,
  refraction/absorption, and water-side temporal history;
- material/vegetation/building consumers: placement and appearance masks only;
  they never redefine the physical land/water partition.

Validate the handoff with cross-face coast loops, island/strait fixtures near
the analysis resolution, sea-level perturbations, finite-difference bathymetry
gradients, coast-frame orientation, direct-versus-resampled depth error, and
render-LOD invariance. Report any unresolved sub-cell island or channel as an
error/coverage limit rather than preserving it with material color alone.

## 11. Solid-Body Material Assembly

The material is a node graph assembled from field outputs:

```text
basePointMeters = referenceSurface(surfaceDirection, bodyAxes)
positionNode = (basePointMeters + baseNormal*heightMeters) / metersPerWorldUnit
colorNode = biomeColor(fields) + crater/ejecta/lava/snow modulation
roughnessNode = baseRoughness(fields) + normalVarianceRoughness
normalNode = analyticOrDerivativePlanetNormal(fields)
metalnessNode = bodyPreset.metalness or ore/lava mask
emissiveNode = lava/hot-crack/star-field emission when present
```

For a sphere, `basePoint=radiusMeters*n` and `baseNormal=n`. For an ellipsoid,
radial direction, surface point, and geodetic normal are different; use the same
reference-surface mapping as atmosphere and queries. A radial displacement
formula silently changes the meaning of geodetic height.

Use analytic normals when the field supplies independently validated gradient information. Filter
sub-patch normal detail and increase microfacet roughness in the BRDF's alpha
domain as specified in Section 13; do not over-tessellate to chase procedural
sparkle.

## 12. Gas And Ice Giants

Gas and ice giants use a separate field representation from solid terrain.
Avoid longitude seams by representing longitude on a unit circle:

```text
longitude = atan(direction.z, direction.x)
advectedLongitude = longitude + time * jetSpeed(latitude)
longitudeVector = vec2(cos(advectedLongitude), sin(advectedLongitude))
gasCoordinate = vec3(longitudeVector.x, longitudeVector.y, latitude01)
```

The band system combines:

- latitude-dependent advection;
- low-frequency tangential warp;
- **[Authored]** 16-24 band records;
- turbulent ridge fields;
- sparse storm centers with swirl coordinates;
- limb darkening and limb haze;
- wrapped diffuse lighting for optically thick cloud decks.

Do not route gas giants through rocky crater, ocean, or soil biome fields.

## 13. Analytic Gradients And Specular Anti-Aliasing

Normals must correspond to the same displacement field used for geometry.
Preferred order:

1. independently validated analytic/automatic field gradients in TSL for macro displacement;
2. patch-space finite differences in compute for cached bounds/diagnostics;
3. screen-space derivative bump only for sub-patch detail.

Shared CPU/TSL values do not prove derivative correctness. Gate candidate
derivatives against an independent central-difference, automatic-
differentiation, or symbolic oracle over face edges/corners, warp extrema,
crater centers/rims, and clamp transitions. Report metric magnitude and normal
angle. The bundled fixture labels its fused derivative as candidate-only and
excludes it from production-normal and GPU-parity claims.

For a sphere with unit direction `n`, metric radius `R`, height `h(n)` in
meters, and intrinsic unit-sphere tangent gradient `g` defined by
`dh = dot(g,dn)`, the displaced surface is `X=(R+h)n` and its **[Derived]**
normal is:

```text
N = normalize(n - g/(R+h))
```

If the field gradient is with respect to metric coordinate `p=R*n`, convert it
with `g = R*(I-n*n^T)*grad_p(h)`. If gradients begin in patch `(u,v)`, solve in
the metric induced by mapping Jacobian `[dn/du,dn/dv]`; treating UV derivatives
as an orthonormal tangent basis is wrong, especially near normalized-cube
corners.

Domain warp requires the chain rule. For `p'=p+w(p)` and scalar field `f(p')`:

```text
grad_p f = (I + J_w)^T * grad_p' f
```

Tangential projection itself depends on `n`; include that derivative when the
warp is constructed as `w_t=(I-n*n^T)w`. A normal that omits `J_w` can be
visibly inconsistent even when height parity passes. For a general ellipsoid,
differentiate the common reference-surface map and construct
`N=normalize(cross(dX/du,dX/dv))`; the spherical shortcut is not valid.

At nonsmooth categorical thresholds, do not differentiate biome IDs. Gradients
come from the continuous causal fields before classification. At crater centers
and other coordinate singularities, define the limiting zero gradient for a C1
radial profile.

Roughness must absorb only **unresolved material-normal residual** variance in
the microfacet parameter domain. Do not feed resolved planetary curvature,
mesh-normal changes, analytic macro slope, or the authored `roughnessCause`
field into the specular-AA variance term. Three.js r185's GGX uses
`alpha = perceptualRoughness^2`. Prefer filtered first/second moments of the
micro-normal slope `m`: `v=E[|m|^2]-|E[m]|^2`. When those moments are
unavailable, a calibrated screen-derivative fallback uses the residual
`r=N_material-N_resolved` after footprint band rejection:

```text
v = roughnessScale * max(dot(dFdx(r),dFdx(r)), dot(dFdy(r),dFdy(r)))
alphaEff^2 = clamp(baseRoughness^4 + v, alphaMin^2, 1)
roughnessEff = pow(alphaEff^2, 0.25)
```

`roughnessScale` and `alphaMin` are **[Authored/Gated]**, not derived from the
derivative estimator. Calibrate them with supersampled reference images and
grazing-angle temporal sweeps; gate highlight energy and shimmer, not only
pixel variance. Use this for water glints, ice, dust, ejecta, lava crust, and
polished exposed rock.

## 14. Atmosphere Handoff

The planet surface owns only the surface-side contract. The atmosphere model
belongs to `$threejs-sky-atmosphere-and-haze` and receives:

```text
planetCenter
worldToBody/bodyToWorld transform (including floating-origin convention)
reference surface: sphere radius or ellipsoid axes/geodetic model
atmosphere bottom/top geometry
metersPerWorldUnit
sunDirection
surface point, reference normal, and altitude in meters
surfaceAlbedo
water/ice/wetness masks
surface coverage/material class when needed
```

Surface and atmosphere use the same transform, reference-surface solver,
integration-unit conversion, normalized sun frame, and scene-linear radiance
basis. The atmosphere derives horizon/limb intervals from that geometry;
passing independently tuned masks creates disagreement. A spherical surface
must not hand off to a claimed geodetic ellipsoid atmosphere, and ellipsoid
height must not silently become radial height. The image pipeline owns
exposure; surface and atmosphere do not compensate independently.

For a spherical body, `atmosphereBottomRadius == referenceSurfaceRadius`
unless a unit-bearing physical offset is explicitly modeled. If a body-radius
override is allowed, rebase the atmosphere bottom and top in the same config
transaction; do not retain preset shell radii around the old body. The bundled
fixture preserves the authored shell thickness while rebasing both surface and
atmosphere bottom. Ellipsoidal shells instead require declared bottom/top axes
or an altitude model; a scalar radius is not an ellipsoid handoff.

## 15. Node Post Pipeline

Use `RenderPipeline` and node passes:

```js
const scenePass = pass( scene, camera );
scenePass.setMRT( mrt( {
  output,
} ) );

const colorNode = scenePass.getTextureNode( "output" );
renderPipeline.outputNode = renderOutput( colorNode );
```

`output` is the default and only unconditional attachment. Add packed normals
only for a proven AO/diagnostic consumer. Add velocity only for an implemented
temporal consumer with cut/reset/reprojection ownership. Add emissive only when
selective bloom beats full-scene HDR bloom in paired full-frame evidence. Every
attachment carries bandwidth, memory, clear/load/store, and shader-output cost;
an imported node is not a consumer.

Use `PassNode.setResolutionScale()` for reduced-resolution diagnostics or
expensive screen effects. Built-in nodes are the first choice:

- `TRAANode` for temporal anti-aliasing of subpixel patch edges;
- `GTAONode` for contact and crater/ridge grounding;
- `BloomNode` for lava, aurora, city lights, or stellar emission;
- `CSMShadowNode` for near-planet directional shadows;
- `TileShadowNode` for large scenes where tiled shadow updates are a better
  fit.

Keep one tone-map owner and one output conversion owner.

## 16. Diagnostics, Performance, And Validation

Expose these views as node-material branches or MRT/debug outputs:

```text
height
macroHeight
patch level
patch error
patch min/max displacement
surface-map area/Jacobian distortion
cross-face neighbor ID and edge orientation
transition mask, geomorph weight, and crack distance
visible/cull reason and submission bin
cache tile/version/age and field-evaluation count
CPU-query vs TSL-compute absolute difference
tangential warp magnitude
represented scale and per-band detail weights
crater floor/wall/rim/ejecta
continent and coast widths
humidity and temperature
biome weights
rock/snow/ice/wetness
water depth and physical classification
normal variance roughness
atmosphere reference-surface and unit handoff
```

### Performance and memory evidence

Raw payload formulas are **[Derived]**:

```text
triangles = activePatches * 2 * (gridSide-1)^2
baseIndicesPerVariant = 6 * (gridSide-1)^2
rawTransitionIndexBytes = 16 * baseIndicesPerVariant * indexBytes
rawIndirectBytes = nonemptyCommands * 5 * 4       # indexed draw commands
fieldTileBytes = residentTiles * (N+2*g)^2 * bytesPerTexel  # g from support footprint
patchRecordBytes = recordCount * actualAlignedStride
```

At `N=33` with 16 independent Uint16 transition index buffers, the raw upper
bound is **[Derived]** `192 KiB`; report actual deduplication and allocation.
Indirect arguments are tiny, but compaction, patch lists, cache atlases, double
buffers, diagnostics, and post targets are not. Record `renderer.info`, storage
attribute bytes, texture bytes, render-target bytes, compute dispatches, visible
instances, index/vertex invocations, draw calls, CPU frontier/update/submit
time, GPU timestamps, cache hit rate, and allocation churn.
For GPU-written indirect draws, r185 `renderer.info` cannot be assumed to know
the final command's instance count; supplement it with GPU timestamps and an
asynchronous validation-only counter/readback, never a frame-critical readback.
A **[Measured]** row names revision, browser/OS, adapter, power/thermal state,
CSS viewport, DPR, drawing-buffer extent, MSAA, body/seed/camera fixture, cache
warmup, sample window, and timing source. Report full-frame and paired planet
on/off GPU p50/p95 plus CPU frontier/submit p50/p95; subsystem percentile sums
are not a frame-budget proof.

Product gates come from the composed scene, not this skill. Declare
`fullFrameGpuP95BudgetMs`, `cpuSubmitP95BudgetMs`,
`presentedFrameP95BudgetMs`, and `peakLiveBytes`, then compare contemporaneous
full-frame samples. On bandwidth- or power-constrained targets, prefer CPU
frontier selection plus instanced mask bins until GPU compaction is measured
faster; GPU-driven is not automatically lower power. Capture CPU submit, GPU
work, warmup, steady state, and a sustained thermal run.

Validation harness:

- fixed orbit, horizon, and close-approach cameras;
- projection-error sweeps through every split/merge boundary, with hysteresis
  and morph velocity plotted;
- mapping forward/inverse, face-edge/corner equality, winding, Jacobian, and
  constant-field sphere-area integration tests;
- restricted-quadtree invariants across transformed cube-face neighbors and
  all 16 transition masks, with maximum world-space crack distance gated;
- unlit silhouette and flat albedo captures;
- grazing light capture;
- biome, crater, normal, roughness, and patch-error captures;
- **[Authored]** three seeds minimum per body preset plus adversarial crater and
  coast fixtures;
- always-run structural parity confirming CPU and TSL builders import the same
  shared field constants object, plus golden `planetFields()` fixtures;
- browser-readback parity from `planet-readback.json`, produced by
  `examples/webgpu-quadtree-planet/capture-planet-readback.mjs`, reporting
  max/mean error and worst sample direction, with missing artifacts failing
  unless the validator is run with `--allow-missing-gpu`;
- exact nonempty preset x seed x direction Cartesian-product equality, unique
  probe keys, and exact parity-channel keys before numeric comparison;
- independent derivative value/direction/scale gates before any analytic-normal
  claim; CPU/TSL agreement alone is insufficient;
- GPU timestamp or frame-budget capture for each quality tier.
- cache dependency/invalidation tests proving camera/light/exposure changes do
  not rebuild geology, plus fence-safe eviction/resize/disposal loops;
- direct-versus-cached field and gradient error, crater-index overflow, and
  no-missing-stamp tests;
- instanced and indirect command-layout tests, including a zero
  `firstInstance` path when the optional adapter feature is absent;
- fixed-DPR temporal captures for LOD seams, grazing specular, normal variance,
  atmosphere limb parity, and no-post readability.

Acceptance fails when normalized-cube sampling is called uniform without a
Jacobian report; adjacent leaves differ by more than one level; cross-face edge
orientation is inferred ad hoc; skirts or material noise are the only crack
policy; each patch is a separate production draw; float min/max uses WGSL
atomics; camera/light motion rebuilds geology; every crater is scanned at every
sample; CPU parity compares JavaScript float64 against WGSL float32 without a
declared rounding contract; warp gradients omit the chain rule; or a spherical
surface and ellipsoidal atmosphere disagree on altitude/limb geometry.

## 17. Replaced Sub-Best Techniques

- Replaced a universal static high-density sphere recipe with an explicit
  global-quadtree/local-clipmap/hybrid decision, because camera domain controls
  the best topology.
- Replaced unqualified normalized-cube mapping with distortion-aware selection
  among normalized, spherified, and verified equal-area mappings.
- Replaced four whole-body mesh level switches with patch-level split/merge and
  restricted neighbors, CDLOD morph, and transition indices, because whole-body
  swaps rebuild too much and edge clamps alone do not remove popping/cracks.
- Replaced one draw per patch with shared-grid instanced/indirect transition
  bins, because CPU submission dominates mobile before the field math does.
- Replaced repeated per-frame macro field evaluation with dirty patch caches
  carrying value, independently validated derivative, causes, and dependency versions.
- Replaced manually duplicated CPU/material terrain with a shared field schema
  plus TSL compute parity, because independent implementations drift.
- Replaced crater-like cavity noise with explicit geodesic crater stamps,
  because stamps provide floor, wall, rim, ejecta, age, overlap, and material
  outputs.
- Replaced material-only macro correction with shared displacement/material
  causes, because macro biome and normal identity must match silhouette.
- Replaced ad hoc post chains with `RenderPipeline` and built-in node effects,
  because the node pipeline shares buffers, preserves HDR ownership, and avoids
  redundant passes.
