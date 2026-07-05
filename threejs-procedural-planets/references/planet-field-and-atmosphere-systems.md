# Planet Field And Atmosphere Systems

Use this reference for a WebGPU/TSL-only procedural planet system: cube-sphere
quadtree LOD, shared field functions, node-material displacement and shading,
compute-backed parity, crater and climate coupling, gas-giant representation,
atmosphere handoff, diagnostics, and performance budgets.

## Contents

1. Architecture first
2. Renderer, material, and compute baseline
3. Capability gate and quality tiers
4. Cube-sphere quadtree LOD
5. Shared planet field bundle
6. CPU query and TSL compute parity
7. Crater stamps and geological structures
8. Altitude-filtered detail
9. Climate, hydrology, and biomes
10. Solid-body material assembly
11. Gas and ice giants
12. Procedural normals and specular anti-aliasing
13. Atmosphere handoff
14. Node post pipeline
15. Diagnostics and validation
16. Replaced sub-best techniques

## 1. Architecture First

The top-tier architecture is a cube-sphere quadtree whose visible patches are
generated and bounded with compute, then displaced by shared TSL field
functions in a `NodeMaterial` vertex path. Algorithm class matters more than
micro-optimization: a static dense sphere spends most vertices where they do
not affect the image, while a quadtree concentrates topology where projected
error demands it.

Build the system in this order:

1. Planet constants: center, radius, sea level, atmosphere radii, render scale,
   seed, and body preset data.
2. Cube-face quadtree: stable patch IDs, face axes, UV rectangle, geometric
   error, min/max displacement, neighbor levels, and transition edges.
3. Shared field bundle: macro continents/basins, ridges, craters, climate,
   hydrology, ice/snow, volcanic or dusty causes, and body-specific masks.
4. TSL displacement: patch vertex direction, tangential warp, height, radial
   displacement, and analytic or derivative normal.
5. Compute support: dirty patch bounds, optional generated patch vertices,
   parity samples, crater atlases, and diagnostic storage.
6. Material outputs: albedo, roughness, metalness, clearcoat/wetness, normal,
   emission for hot surfaces, and debug modes from the same causes.
7. Atmosphere handoff: shared planet transform, surface altitude, water/ice
   identity, horizon mask, and radiance scale.
8. Node post: single output transform, temporal anti-aliasing, ambient
   occlusion, bloom only for emissive/hot bodies, and shadow nodes when needed.

## Units And Validity Range

| term | default | Validity range | notes |
| --- | ---: | ---: | --- |
| `radiusKm` | 12000 | 1200-72000 | solid bodies normally stay under 18000 km; gas giants use the band system |
| render scale | 1 / `radiusKm` | project-defined | keep one conversion boundary before atmosphere handoff |
| height amplitude | 0.018 | 0-0.08 | macro silhouette displacement fraction of radius |
| sea level | 0.04 | -0.4-0.4 | physical water classification uses the sharper coast edge |
| `worldToAtmosphereScale` | 1000 | 0.001-100000 | shared with `$threejs-sky-atmosphere-and-haze` |
| humidity/temperature | 0-1 | normalized 0-1 | clamp after body bias and altitude lapse |
| crater `angularRadius` | 0.045-0.11 | 0.003-0.18 | below range becomes texture detail; above range becomes basin geology |
| sphere/ellipsoid breakpoint | sphere | 0.5% flattening | use ellipsoid coordinates above the breakpoint |

## 2. Renderer, Material, And Compute Baseline

Use current Three.js WebGPU modules only:

```js
import {
  HalfFloatType,
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
  atomicMax,
  atomicMin,
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

import GTAONode from "three/examples/jsm/tsl/display/GTAONode.js";
import BloomNode from "three/examples/jsm/tsl/display/BloomNode.js";
import TRAANode from "three/examples/jsm/tsl/display/TRAANode.js";
import { CSMShadowNode } from "three/examples/jsm/csm/CSMShadowNode.js";
import { TileShadowNode } from "three/examples/jsm/tsl/shadows/TileShadowNode.js";
```

Planet materials should be `MeshStandardNodeMaterial` for most rocky and icy
bodies, `MeshPhysicalNodeMaterial` when water, clearcoat, transmission-like ice,
or richer specular response matters. Drive `colorNode`, `roughnessNode`,
`metalnessNode`, `normalNode`, `emissiveNode`, and `positionNode` from the
shared field bundle.

Use `StorageBufferAttribute` for patch records, parity samples, and generated
vertex data. Use `StorageInstancedBufferAttribute` for instanced patch metadata
when drawing repeated patch meshes. Use `StorageTexture` with `storageTexture()`
and `textureStore()` only for field tables, crater atlases, generated
diagnostics, and cacheable tile maps where 2D access beats buffer layout. Use
`workgroupBarrier()` and atomics only for reductions such as patch min/max,
compaction, or indirect dispatch records.

## 3. Capability Gate And Quality Tiers

Compute/storage features require an initialized renderer. Gate once and choose
a quality tier:

```js
const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

const planetTier = renderer.backend.isWebGPUBackend ? "full" : "reduced";
```

Full tier:

- compute-generated patch records and bounds;
- TSL displacement through `material.positionNode`;
- parity sample buffers written by `renderer.computeAsync()`;
- node MRT diagnostics;
- dynamic crater/biome atlases and atmosphere masks.

Balanced tier:

- fewer active patch rings;
- 65-129 vertices per patch side near camera;
- cached far-field patch bounds;
- lower crater stamp count;
- disabled optional material channels beyond roughness/normal/wetness.

Reduced tier:

- static precomputed patch rings;
- small generated variant textures for crater and biome diagnostics;
- coarse material fields and no per-frame parity readback;
- the same public field contract with lower spatial fidelity.

## 4. Cube-Sphere Quadtree LOD

Create each patch from a cube face, a UV rectangle, and a level. Convert local
patch coordinates to a normalized cube-sphere direction before displacement:

```text
cube = faceOrigin + faceU * u + faceV * v
surfaceDirection = normalize(cube)
```

Store `surfaceDirection` as an attribute or derive it from compact patch
metadata in the vertex node. It is the canonical coordinate for all geology.
Do not reconstruct geology coordinates from displaced positions.

Patch selection is based on projected error:

```text
screenError = patchGeometricError * projectionScale / max(distanceToPatch, eps)
split when screenError > splitThreshold
merge when screenError < mergeThreshold
```

Use hysteresis and update at a fixed cadence, for example every second or third
frame on fast cameras and less often for orbital views. Bounds come from
compute-side min/max sampling of the same displacement `Fn`, not a guessed
amplitude. Stitch edges by clamping border samples to the coarser neighbor or
by adding transition strips; never leave level cracks to be hidden by material
noise.

Recommended starting budgets:

| Tier | Near patch side | Active patches | Patch records | Rebuild budget |
| --- | ---: | ---: | ---: | ---: |
| full | 128-257 vertices | 300-900 | 64-96 bytes each | 2-5 dispatches/frame |
| balanced | 65-129 vertices | 120-360 | 64-96 bytes each | 1-3 dispatches/frame |
| reduced | 33-65 vertices | 60-160 | CPU/static records | threshold changes only |

## 5. Shared Planet Field Bundle

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
slope
snow
ice
wetness
biomeWeights
biomeId
roughnessVariance
atmosphereMask
debugChannels
```

The field coordinate is a unit direction plus explicit scale:

```text
terrainKm = surfaceDirection * radiusKm
warp = fieldNoise(terrainKm * lowFrequency + seed)
tangentWarp = warp - surfaceDirection * dot(warp, surfaceDirection)
warpedDirection = normalize(terrainKm + tangentWarp * warpKm)
```

Tangential warp and renormalization are preserved because they prevent
region-scale coordinate dilation. The terrain stack should keep macro
silhouette fields separate from sub-patch material detail:

- macro: continents, basins, dichotomy, volcanic provinces, mountain chains;
- meso: ridges, crater rims, canyon systems, dunes, foothills;
- micro: normal-only grain, wetness breakup, frost, ash, small ejecta.

Material-only micro detail must not change biome altitude, water identity, or
collision/query height.

## 6. CPU Query And TSL Compute Parity

Planetary gameplay, camera collision, and atmosphere sampling need CPU-visible
queries. The highest-throughput path batches query directions into storage,
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
    .assign( vec4( fields.height, fields.biomeId, fields.oceanDepth, fields.slope ) );
} )().compute( queryCount );

await renderer.computeAsync( samplePlanetFields );
```

For latency-sensitive single queries, keep a generated scalar mirror from the
same field schema and continuously compare it against the compute result. The
parity harness must run fixed normalized directions, all body presets, and at
least three seeds. Report max error, mean error, and the worst direction. Any
change to field constants, crater stamps, or biome thresholds updates the
parity baseline deliberately.

## 7. Crater Stamps And Geological Structures

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

Compute crater influence from angular distance:

```text
d = acos(dot(surfaceDirection, centerDirection)) / angularRadius
floor = 1 - smoothstep(0.0, floorEdge, d)
wall = smoothstep(floorEdge, rimInner, d) * (1 - smoothstep(rimInner, rimOuter, d))
rim = exp(-pow((d - rimCenter) / rimWidth, 2))
ejecta = radialRayField(surfaceDirection, centerDirection, seed) * falloff(d)
```

Blend overlap by priority and age. Degraded craters reduce rim height, soften
wall slope, fill the floor, and keep faint ejecta or albedo scars. The crater
outputs feed height, roughness, color, dust retention, ice traps, and debug
views. This replaces pure cavity noise because explicit stamps provide
controllable topology and survive close approach.

Other named structures should be authored as fields, not paint layers:

- continents and basins from low-frequency warped region fields;
- tectonic ridges from anisotropic/ridged fields with uplift masks;
- volcanic provinces from radial shields, caldera masks, and lava flow age;
- canyon systems from curve-distance fields on the sphere;
- polar caps from latitude, temperature, altitude, and seasonal masks.

## 8. Altitude-Filtered Detail

Compute camera altitude from shared planet center and radius:

```text
altitude = max(length(cameraPosition - planetCenter) - radius, 0)
representedScale = patchWorldSize / patchVertexCount
```

Then derive near/mid/far weights:

```text
near = max(radius * 0.022, 6.5 world units)
mid = max(radius * 0.11, 24 world units)
far = max(radius * 0.50, 140 world units)
nearWeight = 1 - smoothstep(near, mid, altitude)
farWeight = smoothstep(mid, far, altitude)
midWeight = saturate(1 - nearWeight - farWeight)
```

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

Frequency remains stable; only amplitude and channel participation fade.

Normal queries must not central-difference the full planet field. The canonical
example uses a fused analytic gradient: `planetFields()` returns height plus two
tangent-space gradient components from the same FBM octave traversal, with
geodesic crater derivatives accumulated in the same evaluation. Cost is gated
by `validate-planet.mjs`: the old query was `2 tangent axes * 2 central samples
= 4` full `planetFields()` evaluations per normal, while the fused query is
`1` full `planetFields()` evaluation returning both gradient components.

## 9. Climate, Hydrology, And Biomes

Biome classification is derived from causes:

```text
humidity = broadMoisture * 0.65 + localMoisture * 0.35 - rainShadow
temperature = latitudeInsolation - altitudeLapse + oceanModeration
slope = 1 - abs(dot(localNormal, surfaceDirection))
oceanDepth = max(seaLevel - height, 0)
```

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
edge for water shading and atmosphere humidity masks.

## 10. Solid-Body Material Assembly

The material is a node graph assembled from field outputs:

```text
positionNode = surfaceDirection * radius * (1 + height * amplitude)
colorNode = biomeColor(fields) + crater/ejecta/lava/snow modulation
roughnessNode = baseRoughness(fields) + normalVarianceRoughness
normalNode = analyticOrDerivativePlanetNormal(fields)
metalnessNode = bodyPreset.metalness or ore/lava mask
emissiveNode = lava/hot-crack/star-field emission when present
```

Use analytic normals when the field supplies gradient information. Use
screen-space derivatives for sub-patch normal detail and roughness variance:

```text
dHx = dFdx(height)
dHy = dFdy(height)
variance = max(dot(dFdx(normal), dFdx(normal)), dot(dFdy(normal), dFdy(normal)))
filteredRoughness = sqrt(baseRoughness * baseRoughness + min(scale * variance, 1))
```

This keeps procedural sparkle controlled without increasing mesh density.

## 11. Gas And Ice Giants

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
- 16-24 band records;
- turbulent ridge fields;
- sparse storm centers with swirl coordinates;
- limb darkening and limb haze;
- wrapped diffuse lighting for optically thick cloud decks.

Do not route gas giants through rocky crater, ocean, or soil biome fields.

## 12. Procedural Normals And Specular Anti-Aliasing

Normals must correspond to the same displacement field used for geometry.
Preferred order:

1. analytic field gradients in TSL for macro displacement;
2. patch-space finite differences in compute for cached bounds/diagnostics;
3. screen-space derivative bump only for sub-patch detail.

Roughness must absorb unresolved normal variance:

```text
normalVariance = max(dot(dFdx(N), dFdx(N)), dot(dFdy(N), dFdy(N)))
roughness = sqrt(baseRoughness^2 + min(roughnessScale * normalVariance, 1))
```

Use this for water glints, ice, dust, ejecta, lava crust, and polished exposed
rock. It is cheaper than chasing sparkle by over-tessellating.

## 13. Atmosphere Handoff

The planet surface owns only the surface-side contract. The atmosphere model
belongs to `$threejs-sky-atmosphere-and-haze` and receives:

```text
planetCenter
radius
atmosphereInnerRadius
atmosphereOuterRadius
worldToAtmosphereScale
sunDirection
surfaceAltitude
surfaceAlbedo
water/ice/wetness masks
horizon and limb masks
camera altitude
```

Surface and atmosphere must use the same center, radius, sun direction, scale,
and exposure basis. Limb clipping should be computed from the ray against the
base sphere or ellipsoid and faded by camera altitude; do not tune shell and
post colors independently.

## 14. Node Post Pipeline

Use `RenderPipeline` and node passes:

```js
const scenePass = pass( scene, camera );
scenePass.setMRT( mrt( {
  output,
  normal: packNormalToRGB( normalView ),
  velocity,
} ) );

const colorNode = scenePass.getTextureNode( "output" );
renderPipeline.outputNode = renderOutput( colorNode );
```

Use `PassNode.setResolutionScale()` for reduced-resolution diagnostics or
expensive screen effects. Built-in nodes are the first choice:

- `TRAANode` for temporal anti-aliasing of subpixel patch edges;
- `GTAONode` for contact and crater/ridge grounding;
- `BloomNode` for lava, aurora, city lights, or stellar emission;
- `CSMShadowNode` for near-planet directional shadows;
- `TileShadowNode` for large scenes where tiled shadow updates are a better
  fit.

Keep one tone-map owner and one output conversion owner.

## 15. Diagnostics And Validation

Expose these views as node-material branches or MRT/debug outputs:

```text
height
macroHeight
patch level
patch error
patch min/max displacement
CPU-query vs TSL-compute absolute difference
tangential warp magnitude
near/mid/far detail weights
crater floor/wall/rim/ejecta
continent and coast widths
humidity and temperature
biome weights
rock/snow/ice/wetness
water depth and physical classification
normal variance roughness
atmosphere handoff masks
limb clip and shell/post blend
```

Validation harness:

- fixed orbit, horizon, and close-approach cameras;
- unlit silhouette and flat albedo captures;
- grazing light capture;
- biome, crater, normal, roughness, and patch-error captures;
- three seeds minimum per body preset;
- always-run structural parity confirming CPU and TSL builders import the same
  shared field constants object, plus golden `planetFields()` fixtures;
- optional browser-readback parity from `planet-readback.json`, reporting
  max/mean error and worst sample direction, with missing artifacts failing
  unless the validator is run with `--allow-missing-gpu`;
- GPU timestamp or frame-budget capture for each quality tier.

## 16. Replaced Sub-Best Techniques

- Replaced static high-density sphere meshes with cube-sphere quadtree LOD,
  because projected-error patching spends vertices where they change pixels and
  supports close approach.
- Replaced four whole-body mesh level switches with patch-level split/merge and
  neighbor stitching, because whole-body swaps rebuild too much and cannot
  maintain ground-scale density.
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
