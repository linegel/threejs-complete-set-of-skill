# Procedural Field-Stack Recipes

These recipes construct coherent WebGPU/TSL field bundles for spherical
terrain, altitude-filtered detail, terrain wetness, water optics, and structured
stochastic placement. The implementation path is always one deterministic TSL
`Fn` reused by NodeMaterials, vertex nodes, compute bakes, and diagnostics.

## Contents

- Architecture first
- Stable coordinate ownership
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

The CPU port exists for geometry generation, offline assets, reduced tiers, and
parity checks. It is not a separate look-development path. Constants, seeds,
hashes, remaps, wrapping, and normalization must match the TSL function.

## Coherent Noise Spectrum

Approved families for canonical examples:

| family | output range | use |
| --- | --- | --- |
| deterministic value hash | 0-1 | CPU parity fixtures, reduced-tier assets |
| gradient/simplex-style noise | -1 to 1 or remapped 0-1 | smooth macro and meso fields |
| ridged transform `1 - abs(2n - 1)` | 0-1 | ridge, vein, wrinkle, crest fields |
| stratified jitter | bounded cell-local range | authored placement, craters, branches |

Normalize octave sums by accumulated amplitude. Keep lacunarity in `1.7-2.35`
and gain in `0.42-0.62` unless the field contract records a measured reason.
Use seed wrapping so large or negative seeds stay deterministic across CPU and
TSL implementations.

Default spectralSlope by band:

```text
macro: broad regions and silhouette, low frequency, geometry-safe
meso: ridges, cavity, shore, wear, visible in material and sometimes geometry
micro: normal/roughness only, derivative filtered, never macro displacement
```

validity range:

```text
sphere domains: radius 1-72000 km
world domains: 0.001-1000000 world units
object domains: 0.0001-10000 object units
normalized masks: clamp to 0-1 after all causal bias
```

Choose bake versus evaluation by read count:

| Reads per frame | Architecture |
| --- | --- |
| 1 | Direct TSL `Fn` evaluation. |
| 2-4 | Evaluate once in a local node bundle and reuse named outputs. |
| 5-12 | Compute-bake packed fields to `StorageTexture`. |
| 12+ or placement/culling consumers | Compute-bake to `StorageTexture` plus storage buffers. |
| Static field | Bake once; update only after parameter or seed changes. |
| Local edits | Tile the storage texture and invalidate dirty tiles. |

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

## Spherical Terrain Field Bundle

Use tangential warp for radial domains:

```text
warp = seededVectorField(surfaceDirection, seed) - 0.5
tangentWarp = warp - radial * dot(warp, radial)
warpAmplitudeKm = max(radiusKm * 0.012, 36)
warpedDirection = normalize(radial * radiusKm + tangentWarp * warpAmplitudeKm)
terrainKm = warpedDirection * radiusKm
```

Separate bands by purpose:

```text
continent band -> broad regions and silhouette support
highland band  -> regional altitude variation
ridge band     -> directional structure and erosion-like emphasis
cavity band    -> craters, pockets, and dirt collection
micro band     -> material normal and roughness only
```

Preserve useful ratios from the historical planet recipe as starting points,
then tune them from physical scale and budget:

```text
macro A frequency = 0.00034, weight 0.52
macro B frequency = 0.00092, internal scale 0.52, weight 0.33
ridge frequency = 0.0029, weight 0.25
cavity frequency = 0.0069, exponent about 3
```

The reviewed planet example now aligns its base terrain height between CPU and
the material path more than the older reference claimed. Treat any remaining
material-only climate, biome, roughness, or normal logic as a parity gap to
close: the new path must share one TSL field bundle and a deterministic CPU
port for all fields that geometry, diagnostics, or tests compare.

Derived climate causes:

```text
humidity =
  0.65 * broadMoistureBand
  + 0.35 * detailMoistureBand

temperature =
  (1 - abs(latitude)^1.35) * 0.85
  + 0.15
  - macroHeight * 0.32

slope =
  1 - abs(dot(localNormal, radialDirection))
```

Snow, arid, lush, and rock masks combine altitude, ridges, humidity,
temperature, slope, and a small jitter field. The important mechanism is causal
reuse, not a fixed palette.

## Altitude And Projected-Footprint Filtering

Keep coordinates stable and fade contribution:

```text
cameraAltitude = max(distance(camera, center) - radius, 0)
detailAltitude = min(cameraAltitude, externally supplied detail altitude)

near = max(radius * 0.022, 6.5)
mid  = max(radius * 0.11, 24)
far  = max(radius * 0.50, 140)

nearWeight = 1 - smoothstep(near, mid, detailAltitude)
farWeight = smoothstep(mid, far, detailAltitude)
midWeight = clamp(1 - nearWeight - farWeight, 0, 1)
```

Use these weights to attenuate bump, coastline sharpness, wave detail,
clearcoat, and micro material variation. Do not shift frequency with camera
distance.

Projected-footprint rule:

```text
fieldWavelengthWorld >= max(2 * projectedPixelWorldSize, 2 * meshEdgeWorldSize)
```

If a band violates the rule, it must move to a filtered baked field, fade out,
or become roughness/normal variance compensation rather than displacement.

## Derivative Correctness

Use `analyticGradient` when the field owns geometry displacement or collision.
For TSL material normals, derive `heightGradient` from the same field bundle or
from compute-stored gradients. Screen derivatives are legal only for sub-patch
micro detail whose absence does not change silhouette, biome identity, water
classification, or placement.

Tangential warp derivatives must stay in the tangent plane before
renormalization. If a compute bake is sampled by geometry, material, and post
passes, store at least height and gradient lanes or provide a paired gradient
atlas.

Gradient parity requirements:

```text
max scalar field error <= 1e-3
mean scalar field error <= 1e-4
max gradient error <= 2e-3
mean gradient error <= 5e-4
```

If `max gradient error` is exceeded, do not tune material color to hide it;
fix the field constants, derivative path, or bake precision.

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

A useful compact wave set:

```text
wavelengths: 12, 6, 2.5, 5.25, 3.0, 1.5 world units
amplitudes: 1.0, 0.55, 0.22, 0.12, 0.08, 0.05 relative to base
```

Foam consumes the crest metric derived from the same slope and phase. Do not
sample unrelated scrolling masks for foam that should be caused by waves.

Attenuate small bands from projected footprint and wavenumber. If water is read
by surface material, shoreline wetness, foam, caustics, and post passes in the
same frame, bake the packed wave field to `StorageTexture` at the required tile
resolution and sample it; direct re-evaluation is only for low read counts.

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
| CPU deterministic port | mesh generation, offline assets, parity expected values, reduced tier | Same constants and seeds as TSL; no in-frame readback loop. |
| Geometry attribute | stable low-frequency coordinates or IDs | Write once, keep compact, recompute bounds after geometry changes. |
| Direct material node | cheap low-read fields | Reuse one local field bundle; no hidden per-channel noise. |
| `StorageTexture` | hot scalar/vector fields read many times | Pack by access pattern, choose mips deliberately, update static fields once. |
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
- Use half-float storage for smooth scalar/vector fields unless memory budgets
  require normalized packing.
- Put fields sampled together in the same texture to reduce bandwidth.
- Do not pack fields with different update cadence into the same hot resource
  unless the bandwidth tradeoff is measured and accepted.

Concrete storage texture setup:

```js
const texture = new StorageTexture(width, height);
texture.format = RGBAFormat;       // or RGFormat for compact paired fields
texture.type = HalfFloatType;      // or UnsignedByteType for categorical masks
texture.colorSpace = NoColorSpace;
texture.minFilter = LinearFilter;
texture.magFilter = LinearFilter;
texture.mipmapsAutoUpdate = false;
```

Use `RGBAFormat` for four coupled scalar lanes, `RGFormat` for height/gradient
pairs or two masks, `HalfFloatType` for smooth scalar/vector fields, and
`UnsignedByteType` only for validated categorical or variant masks.

## Parity Harness

Create fixed probes before visual tuning:

```text
seed = fixed integer
probe coordinates = deterministic list of sphere directions, world positions,
  water UVs, and placement cells
expected CPU fields = JSON or typed-array fixture
TSL diagnostic path = bake or render packed fields for the same probes
tolerance = per field, usually 1e-4 to 1e-3 for scalar masks
```

Checks:

- CPU and TSL match for primary fields and derived causes.
- Tangential warp remains tangent before renormalization.
- Geometry height and material height share the same macro function.
- Categorical masks are broad enough and sum/clip as intended.
- Baked texture channels decode to the same values as direct evaluation.
- No in-frame readback is used outside the explicit parity test.

## Performance Budgets And Lifecycle

Default field budgets:

| Target | Inline bands | Bake resolution | Dispatches | Hot memory | Time budget |
| --- | --- | --- | --- | --- | --- |
| Desktop discrete | up to 8 cheap bands | up to 2048^2 packed atlas | 1-3 | <= 64 MB | <= 1.5 ms |
| Desktop integrated | up to 5 bands | up to 1024^2 | 1-2 | <= 32 MB | <= 2.5 ms |
| Mobile/lower tier | up to 3 bands | 512^2-1024^2 | 0-1 | <= 16 MB | <= 3.5 ms |

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
bake-vs-evaluate decision
storage format and channel pack
CPU parity requirement
seed ownership
quality tier behavior
performance budget
resource owner and disposal point
```

Reject a field stack when:

- color, roughness, and normal use unrelated structure;
- geometry and material claim the same feature but evaluate different functions;
- a categorical mask is only a narrow threshold over noise;
- high-frequency terms survive after their projected footprint is subpixel;
- world effects use object coordinates or planetary effects use flat world Y;
- random placement has no strata, budget, or semantic constraints;
- a field is baked without enough read count or reuse to justify it;
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
