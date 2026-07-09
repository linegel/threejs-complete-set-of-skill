# WebGPU/TSL Procedural PBR Material Systems

This reference is the canonical physically lit path for procedural materials in
pinned Three.js r185: `WebGPURenderer`, TSL from `three/tsl`, `MeshStandardNodeMaterial` or
`MeshPhysicalNodeMaterial`, node render pipelines, and compute/storage generated
data where it wins. The material graph preserves Three.js PBR lighting and
changes the material causes through node slots.

Numerical labels used below are mandatory: **Derived** follows from a stated
equation/format, **Gated** is a capability or acceptance threshold,
**Measured** is evidence tied to a named browser/GPU/resolution/workload, and
**Authored** is a tunable appearance or planning choice. Unlabelled vector
widths, channel counts, and API-version digits are structural.

## Contents

- Shared-cause material architecture
- Capability gate and quality tiers
- NodeMaterial slot contract
- Coordinate and field ownership
- Atlas, texture array, triplanar, and hex tiling
- Derivative normals and specular AA
- Authored PBR response bundles
- Coupled terrain, coast, and seabed materials
- Planet, terrain wetness, lava, and emissive surfaces
- Per-instance dissolve and variants
- Node post, color, and output
- Budgets
- Replaced techniques
- Diagnostics and validation

## Shared-Cause Material Architecture

Start from one shared cause graph feeding the PBR channels that depend on those
causes; direct textures or constants remain valid for independent measured
inputs:

```text
stable coordinate
  -> structural field cache
  -> identity weights
  -> causal modifiers
  -> filtered microstructure
  -> PBR node slots
  -> node post/output owner
```

This avoids full material replacement, duplicate noise, cloned
materials, independent channel sampling, and extra render passes. It keeps
environment lighting, punctual lights, shadows, physical extensions, alpha,
transmission, clearcoat, and renderer upgrades in the engine path.

Use `MeshStandardNodeMaterial` for opaque or emissive standard PBR. Use
`MeshPhysicalNodeMaterial` when clearcoat, transmission, thickness, anisotropy,
sheen, specular color/intensity, iridescence, attenuation, or dispersion are
part of the surface identity.

## Capability Gate And Quality Tiers

Use the same authored graph across tiers. Only the data resolution, generated
variant count, dynamic storage, and sample budgets change.

```js
await renderer.init();
if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error("threejs-procedural-materials requires native WebGPU.");
}
```

Dispatch `generateCauseMaps` or `generateInstanceState` only when the
invocation/update/bandwidth model selects that path.

Quality tiers:

| Tier | Generated data | Material sampling | Instance state |
| --- | --- | --- | --- |
| Full | extent and cadence selected by projected texel error plus the bake cost model; required filtered mips | cost-gated TSL fields/arrays; triplanar or custom hex only when **Measured** value exceeds cost; filtered normals and specular AA | storage-backed state when its measured update/access pattern wins |
| Budgeted | smaller/packed/dirty-tiled data selected by the same error and traffic model | UV/array sampling first, reduced projection multiplicity, fewer footprint-valid bands | static attributes plus small dynamic node uniforms |
| Minimum native | precomputed data retaining identity/silhouette-critical causes | filtered UV/array sampling, no unmeasured manual anisotropic taps | baked attributes on native WebGPU |

## NodeMaterial Slot Contract

Every procedural material documents which node slots it owns:

```text
colorNode: identity base color, wetness/burn/ore/climate color shifts
roughnessNode: identity roughness plus wetness, dust, polish, heat, frost
metalnessNode: identity metalness, oxide, exposed ore, inclusions
normalNode: normalMap(), bumpMap(texture(...)), or derivative normal from shared scalar height
aoNode: authored cavity or terrain contact, never fake global lighting
opacityNode / alphaTestNode / maskNode: cutout, dissolve, erosion, cards
emissiveNode: only real material emission in HDR scene-linear units
positionNode: local-space visible displacement when silhouette or parallax matters
castShadowPositionNode: the same local-space caster displacement
receivedShadowPositionNode: optional world-space receiver position; normally null
castShadowNode / maskShadowNode: alpha and dissolve parity in shadows
mrtNode: explicit material diagnostics or selective effects
```

Prefer modifying existing material inputs with `materialColor`,
`materialRoughness`, `materialMetalness`, `materialNormal`,
`materialEmissive`, and physical material property nodes when the material
should retain maps or scalar values already assigned on the material.

Use `fragmentNode` or `outputNode` only when the material intentionally replaces
the material output. That is a rare stylized-material decision; it must still
keep color/output ownership in the node pipeline.

### Installed r185 API proof

The local dependency is Three.js `0.185.1`. Before copying these claims to a
different revision, recheck:

- `src/materials/nodes/NodeMaterial.js`: `maskNode`, `alphaTestNode`,
  `maskShadowNode`, position/shadow-position nodes, `castShadowNode`, and
  `mrtNode` exist.
- `src/nodes/display/BumpMapNode.js`: `bumpMap()` resamples a texture at
  derivative-offset UVs and applies Mikkelsen's surface-gradient perturbation;
  it is not an arbitrary scalar-height wrapper.
- `src/nodes/utils/TriplanarTextures.js`: `triplanarTexture()` performs exactly
  three projected texture samples with absolute-normal blend weights; it does
  not reorient tangent-space normals or implement stochastic hex tiling.
- `src/nodes/functions/PhysicalLightingModel.js`,
  `src/nodes/functions/material/getRoughness.js`, and
  `src/materials/nodes/MeshStandardNodeMaterial.js`: GGX uses
  `alpha = roughness^2`, multiscattering stays in the engine path, and the
  standard material calls `getRoughness()`, which already adds
  geometric-normal variation from `normalViewGeometry`.

Use the primary [Mikkelsen surface-gradient
paper](https://mmikk.github.io/papers3d/mm_sfgrad_bump.pdf), [WebGPU device
limits](https://gpuweb.github.io/gpuweb/#limits), and [WGSL derivative and
floating-point rules](https://gpuweb.github.io/gpuweb/wgsl/#derivatives) when
the installed revision or target browser changes.

## Coordinate And Field Ownership

Choose one stable coordinate system before writing any channel:

- UV: cheapest and best when unwraps have stable texel density.
- Object space: good for sculpted assets and generated local patterns.
- World space: good for terrain, wetness, snow, dust, and projected fields.
- Planet radial space: required for seam-free planetary sampling.
- Generated texture space: best for cached cause maps shared across draws.

Normalize scale in meters or documented art units. A material may mix coordinate
systems only when the cause is physically different, such as world-height
wetness over object-space wood grain.

Structural fields are shared values, not per-channel noise:

```text
height/ridge/cavity
grain/fiber/strata
waterline/wetness
heat/burn/lava exposure
oxide/patina/dust
biome/climate/snow
dissolve/lifetime/variant
```

The identity weights blend authored PBR response bundles first; causal
modifiers then adjust those bundles.

Interface-space and color-space ownership:

| Boundary | Transform or node helper | Color/data rule |
| --- | --- | --- |
| UV space | `uv()`, texture arrays, atlas tile index | color textures use `SRGBColorSpace`; roughness/normal/masks use `NoColorSpace` |
| Object space | `positionLocal`, local scale in documented art units | generated fields stay scene-linear data |
| World space | `positionWorld`, world height/slope/cavity masks | weather/wetness maps are `NoColorSpace` data |
| Planet radial space | undeformed radial attributes, longitude circle coordinates | biome colors convert as color; climate masks stay data |
| Generated texture space | `texture(causeMap, coords.uv)` and cached cause maps | lava and variant cause maps are `NoColorSpace` RGBA data |
| Height units | authored meters or documented material units | height is data; never treat it as color |
| Normal space | `normalMap()`, `bumpMap(texture(...))`, or derivative normal from shared scalar height | normal maps and normal variance are `NoColorSpace` data |
| Instance attributes | `attribute()`, `StorageInstancedBufferAttribute`, `instancedArray()` | variant/dissolve/lifetime are data fields |
| Scene-linear material color | `colorNode`, `emissiveNode`, authored identity bundles | emission stays scene-linear HDR until post |
| Output owner boundary | `RenderPipeline.outputColorTransform` or one `renderOutput()` | forbids sRGB-as-data and forbids material-owned display encoding |

## Atlas, Texture Array, Triplanar, And Hex Tiling

Choose by parameterization defect, repetition defect, and compiled
sample/binding cost:

1. UVs when seams and texel-density distortion pass the fixed-view gate.
2. Texture arrays when layers share dimensions, format, mip count, color-space
   semantics, and sampler policy. A layer selection does not multiply sample
   operations and normally keeps one sampled-texture binding.
3. Atlas when those array constraints fail or an atlas is demonstrably better
   for distribution. It keeps one binding but requires a mip-safe gutter at
   every level.
4. Single-/two-axis projection when only a dominant direction or top/side split
   is required.
5. Full triplanar when no UV parameterization preserves scale and three-way
   seams would otherwise be visible.
6. Custom stochastic hex/texture bombing only for UV-parameterized surfaces
   whose dominant defect is repetition. It does not remove UV seams and has no
   built-in r185 TSL owner.

Count hot-path texture operations as **Derived**
`S = sum(projectionCount * boundTextureLookups * manualTaps)`. A packed data
texture can share one lookup only when its lanes have the same coordinate,
filter, precision, and update cadence. Color and non-color data need separate
textures because `colorSpace` belongs to the texture, so a full triplanar color
plus packed-data material adds **Derived** `3 + 3 = 6` filtered samples. A
separate projected normal map raises that to **Derived** `9` before shadows,
environment, or manual filtering.

For static sampled maps, benchmark a KTX2/BasisU delivery path and record the
actual device transcode format, bytes/block, mip bytes, decode quality, and
max/RMS error per semantic channel. Compression choice is **Gated** by visible
and numerical error; do not assume a color-oriented mode preserves normal,
roughness, height, or threshold masks. Compute-written `StorageTexture` data is
not block-compressed, so include its full format bandwidth in the cost model.

Atlas rules:

- A tile clamp can prevent a base-level coordinate from leaving the tile but
  cannot repair mip levels created by filtering across tile boundaries.
- For mip level `l`, extrude a gutter of at least **Derived**
  `g_l >= ceil(r_l)` texels, where `r_l` is the maximum filter support radius
  at that level, including anisotropic/manual taps. Generate each tile's mip
  chain before atlas assembly or use an equivalent border-preserving process.
- Transform gradients with the tile scale (`dUV_atlas = tileScale * dUV`) so
  LOD represents texel density. Clamp-after-derivative and implicit whole-atlas
  mips do not fix bleeding.
- Color atlas layers use `SRGBColorSpace`; packed data layers use
  `NoColorSpace`.
- Keep tile index and material response bundle coupled so roughness, normal,
  color, and masks come from the same identity.

Triplanar cost notes:

- Installed r185 `triplanarTexture()` costs **Derived** three texture samples
  per bound texture and blends with normalized absolute local-normal weights.
  Its implicit gradients follow each projected coordinate, but the blend
  weights are not a footprint filter.
- Tangent-space normal maps require per-axis basis reorientation and a stable
  normal blend; the built-in color projection does not provide that. Prefer a
  shared projected height/gradient or implement and validate the bases.
- Sharpened blend weights can axis-pop; filter any custom weight thresholds with
  `fwidth()` and show the weights as a debug view.
- If only top/side separation matters, use 2-axis projection or a slope blend
  instead of full triplanar.

Use TSL `triplanarTexture()` or `triplanarTextures()` for texture projection
only when those exact r185 semantics are sufficient. Custom hex tiling must
state its candidate count, texture operations, explicit gradients, blend PDF,
and temporal/anisotropic validation. Use `fwidth()` to filter masks and blend
boundaries; it does not repair an invalid mip chain.

One admissible **Authored** stochastic-hex baseline uses the three neighboring
triangular-lattice candidates around the point. It therefore adds **Derived**
three samples per bound texture, like triplanar, but solves repetition rather
than projection. Its contract is:

```text
candidate transforms: deterministic from integer cell IDs
weights: nonnegative, footprint-filtered, sum exactly to one
gradients: transform dUVdx/dUVdy with each candidate rotation/scale
PBR identity: same candidate IDs and weights for color/data/height
normal detail: blend heights or surface gradients, not tangent normals directly
```

Random rotation is invalid for directionally meaningful grain unless the
allowed symmetry group is authored. Linear blending narrows contrast and
changes the texture histogram; compare mean, variance, spectrum, and seams with
the source distribution and apply an explicitly validated distribution-
preserving transform if required. Do not switch candidates with a hard winner
under motion. Three-candidate color plus packed data consumes **Derived** six
added filtered operations; a separately sampled normal field adds three more.
Whether that fits follows from the compiled binding/sample ledger, traffic,
paired timings, and whole-frame/thermal gates—not a device-class sample count.

## Derivative Normals And Specular AA

The best default for procedural height detail is a surface-gradient normal from
the same filtered height that creates color/roughness/cavity. For view-space
position `P`, base unit normal `N`, and scalar height `h`, Mikkelsen's
parameterization-free construction is:

```text
sigmaX = dFdx(P)
sigmaY = dFdy(P)
R1 = cross(sigmaY, N)
R2 = cross(N, sigmaX)
det = dot(sigmaX, R1)
surfaceGradient = sign(det) * (dFdx(h) * R1 + dFdy(h) * R2)
Nperturbed = normalize(abs(det) * N - heightScale * surfaceGradient)
```

The formula is **Derived** from the local surface differential. Evaluate it in
fragment-stage derivative-uniform control flow. It is not valid in vertex or
compute stages; those consumers require analytic/stored field gradients. For a
texture height map, r185 `bumpMap(texture(heightMap))` performs the necessary
offset resampling. Do not pass an already evaluated scalar to `bumpMap()`.

Filter before perturbation:

- Height mips retain mean height; carry removed slope/normal variance in an
  auxiliary lane or cone statistic.
- Normal-map mips retain the vector mean and its length/second moment. Decode,
  reconstruct, and normalize only after sampling; discarding mean length makes
  distant highlights too sharp. For unit source normals and an unnormalized
  arithmetic mip mean `m`, **Derived** vector variance is
  `v_mip = max(1 - dot(m,m), 0)`. If the mip generator renormalizes each level,
  store a separate cone/variance statistic.
- Stop inline procedural bands with the field-footprint gate. `fwidth(h)` is a
  footprint estimate, not a band-limit by itself.

### Specular anti-aliasing

Three.js r185 already adds a geometric-normal roughness term based on
`normalViewGeometry`. Compute custom AA from material-detail normal/slope
variation only; differentiating the final view normal double-counts geometry.
For locally linear unit-normal detail over a one-pixel box, the variance proxy
is **Derived**:

```text
v_box = (dot(dFdx(Ndetail), dFdx(Ndetail))
       + dot(dFdy(Ndetail), dFdy(Ndetail))) / 12
v_detail = v_mip + v_box
alpha = roughness * roughness
alphaFiltered = clamp(alpha + kVariance * v_detail, alpha, 1)
filteredRoughness = sqrt(alphaFiltered)
```

The `1/12` is the variance of a unit-width box under a linear signal.
`kVariance` is **Authored**, then **Measured** against a supersampled ground
truth because GGX has no finite untruncated slope variance and there is no
universal mapping from this proxy to its `alpha`. Clamp both the added alpha
and final roughness; sweep close/mid/far camera distances, grazing angles, and
motion. For anisotropic materials, project the detail covariance into tangent
and bitangent and broaden `alphaT`/`alphaB` separately. Clearcoat needs its own
normal/roughness variance path. Expose unfiltered/filtered roughness, detail
variance, mip/cone statistic, and the supersampled error view.

For procedural height whose perturbed normal already contains `dFdx(h)`/
`dFdy(h)`, differentiating that normal again is a poor quad-scale curvature
estimator. Prefer analytic gradients, or footprint-filter each spectral band
and transfer its removed slope energy. For a random-phase sinusoid with height
half-amplitude `A_j`, support frequency `f_j`, and retained amplitude weight
`w_j`, **Derived**

```text
v_removed,j = (2*pi*A_j*f_j)^2 / 2 * (1 - w_j^2)
v_detail = sum_j v_removed,j
```

For noise and nonlinear remaps, the support multiplier and slope-variance
coefficient are **Authored**, then **Measured** from the spectrum/reference.
Do not add this and mip/box variance for the same removed energy.

## Authored PBR Response Bundles

Use response bundles instead of unrelated scalar sliders. Dielectric
normal-incidence Fresnel is **Derived**
`F0 = ((n2 - n1)/(n2 + n1))^2`. Against air (`n1 = 1`), `ior = n2 = 1.5`
gives `F0 = 0.04`; water at `ior ~= 1.333` gives `F0 ~= 0.0204`. Use physical-material
IOR/specular slots rather than adding Fresnel to base color.

Metalness is a material identity endpoint, not a dirt or highlight slider:

| Region | **Authored** roughness start | **Gated** metalness identity | Layer/cause rule |
| --- | ---: | ---: | --- |
| oiled walnut substrate | `0.38-0.55` | `0` | grain changes color/roughness/height coherently; a finish is a separate coat response |
| exposed antique gold | `0.20-0.34` | `1` | metal base color carries the conductor tint; tarnish/dirt are separate dielectric masks |
| ebony substrate under lacquer | `0.36-0.55` | `0` | dark substrate and clearcoat remain distinct causes |
| plaster | `0.88-0.98` | `0` | pores/cavity broaden normals and roughness; no invented metallic fraction |
| rock substrate, dry/wet regions | dry `0.55-0.90`; wet `0.18-0.42` | `0` | wetness changes a coupled response; metallic inclusions require a separate mask |

Height/normal amplitude is absent from the table deliberately: it must be in
declared physical units or as a ratio to pattern wavelength, then gated against
silhouette, footprint, and measured reference. Broad fractional metalness is
allowed only as an explicitly documented subpixel mixture approximation.

Normalize identity weights. A single GGX approximation may blend
`alpha = roughness^2` and recover `roughness = sqrt(alpha)`, but a weighted
mixture of different GGX lobes is not exactly a GGX lobe; keep visibly separate
regions discrete or use explicit material layers. Three.js retains direct and
IBL multiscattering only while the graph stays in PBR node slots.

Installed r185 clearcoat uses fixed **Gated** `F0 = 0.04`. It is therefore not
an exact water-film interface (`F0 ~= 0.0204`); using it for wetness is an
**Authored** appearance approximation that must be stated and compared with the
required optics.

The checked-in `examples/tsl-procedural-pbr/` enforces endpoint metalness,
meter-valued height with a scene-unit conversion, footprint-filtered bands, and
transfer of removed material slope energy into roughness. Its support, noise-
variance, response-range, and roughness-transfer factors are explicitly
**Authored** trials. Its validator proves node-slot/config structure; it does
not prove energy, supersampled specular error, timing, or thermal acceptance.

Visible correctness signatures:

| Surface | Visible signature | Classic wrongness |
| --- | --- | --- |
| Walnut | Visible signature: warm oiled grain, energy-conserving highlights, roughness AA suppresses distant sparkle | classic wrong: double color conversion, sparkle from unfiltered normals, washed fields |
| Antique gold | Visible signature: metallic energy, tarnish raises roughness while worn edges stay bright | classic wrong: waxy metal, nonmetallic gray response, roughness unrelated to patina |
| Ebony lacquer | Visible signature: dark body color with clearcoat glints and filtered micrograin | classic wrong: crushed black with no energy, plastic clearcoat, sparkle at grazing angles |
| Lava crust/heat | Visible signature: crust remains PBR while exposed heat emits scene-linear HDR into bloom | classic wrong: gray emission, display-space glow, crushed lava with no raw emissive debug |
| Wet rock | Visible signature: wetness lowers roughness, darkens color, and changes normal response together | classic wrong: wetness as a washed overlay or roughness-only scalar |
| Wetness fields | Visible signature: waterline/cavity/slope causes align across color, roughness, normal, and clearcoat | classic wrong: washed fields, sRGB-as-data masks, material-owned display encoding |

## Coupled Terrain, Coast, And Seabed Materials

### Provider interface

An archipelago or shoreline material consumes a single versioned surface-field
record. The field owner may generate it analytically, rasterize it into a
texture hierarchy, or stream it by chunk; the material interface is unchanged:

```yaml
surfaceFieldContract:
  revision: ""
  coordinateFrame: ""
  sceneUnitsPerMeter: ""
  sampleToWorld: ""
  coastDistance:
    units: meters
    sign: land-positive-water-negative
    filter: signed-distance-preserving
  terrainElevation: { units: meters, datum: "" }
  waterRestElevation: { units: meters, datum: "" }
  waterColumnDepth: { units: meters, derivation: "max(waterRest-terrain,0)" }
  coastFrame: { channels: [nearestCoastNormal, nearestCoastTangent] }
  geomorphology: { channels: [slope, curvature, cavity, drainage, exposure] }
  surfaceState: { channels: [moisture, saltExposure, runupEnvelope, wetness] }
  identity: { channels: [substrateId, semanticRegionId, authoredExclusion] }
  encoding: ""
  extentAndTexelSize: ""
  mipOrLodPolicy: ""
  updateCadence: ""
  invalidationKey: ""
  missingDataPolicy: ""
```

All numerical values in a produced manifest use the repository evidence labels.
The **Derived** still-water depth is
`h0(x)=max(zWaterRest-zTerrain(x),0)` only when both elevations share datum,
units, and position. A dynamic water owner may expose instantaneous depth or a
run-up envelope separately; never overwrite the static bathymetry lane with a
temporally filtered visual mask.

Signed distance must remain monotone through its required transition support.
If a mip chain averages signed distances across disconnected coasts, nearest-
coast direction and band width become invalid. Either re-distance the
downsampled zero set, retain conservative min/max distance bounds, or sample a
level whose texel support cannot merge distinct shore components. Expose
distance, nearest-coast direction, and selected level as diagnostics.

### Identity synthesis

Separate semantic membership from visual transition. Let `H_i` be hard
eligibility for material identity `i` and `R_i` be its continuous response from
coast distance, slope, elevation, drainage, moisture, salt, and substrate. The
normalized **Derived** blend is:

```text
q_i = H_i * max(R_i, 0)
s = sum_j(q_j)
w_i = q_i/s                  when s > epsilon
w_fallback = oneHot(fallbackIdentity) when s <= epsilon.       [D]
```

`epsilon` and every response length are **Authored** until fitted to reference
or source data. Dividing by `max(s,epsilon)` would produce weights summing below
one for `0<s<epsilon`; the explicit fallback keeps the bundle normalized and
emits a diagnostic bit. Preserve `H_i` for semantic IDs,
placement exclusions, and picking. Filter `w_i` by footprint for shading, but
never blur a hard water/land ownership boundary into a false third material.

Typical response bundles are causal, not universal presets:

| Identity | Required causes | Response bundle constraints | Common invalid shortcut |
| --- | --- | --- | --- |
| grass or organic cap | land, low/moderate slope, substrate, moisture, disturbance, ecology coverage | dielectric endpoint; organic macro color, fiber/leaf micro-normal, soil exposure in sparse cover | green height-only band independent of ecology |
| cliff or exposed rock | slope/exposed-face semantics, strata/fracture, weather exposure | rock palette family, broad roughness, facet-preserving resolved normals, filtered strata detail | triplanar noise that rounds every cliff edge |
| dry beach sand | coast distance, low slope, sediment eligibility, dry side of run-up | dielectric granular response, broad filtered micro-normal, dry value family | constant yellow shoreline ring |
| wet sand/waterline substrate | run-up/wetness history, drainage, substrate | darker absorption, lower micro-normal contrast, roughness/film response changed together | dark color stripe with dry roughness |
| submerged sand/silt | bathymetry, substrate, current/deposition cause if available | substrate remains non-emissive; microstructure filtered by projected seabed footprint | cyan emission used to fake shallow water |
| reef or submerged rock | substrate/geology or ecology eligibility, depth/light envelope, exposure | discrete rock/biogenic identities, stable macro breakup, filtered close detail | arbitrary colored noise visible only through water |

Use a material palette table containing linear reflectance families, not sampled
display colors from a tone-mapped screenshot. If the reference is the only
source, record its unknown illumination, camera response, and compression as
uncertainty; fit palette and lighting jointly against no-post diagnostic
renders instead of declaring the screenshot pixels to be base color.

For deliberate low-poly or illustrated styling:

- geometric face normals or authored weighted normals own the large faceted
  response; the material may add a separately filtered micro-normal but may not
  average away the facet normal;
- palette family selection is stable by semantic patch or deterministic cell,
  then filtered only where subpixel transitions require it; do not choose a new
  swatch per fragment from white noise;
- roughness and micro-normal amplitude remain coupled to the chosen identity,
  so palette quantization does not create glittering response discontinuities;
- baked cavity can modulate the material's ambient/cavity term, but directional
  illumination, cast shadows, water foam, and caustic illumination retain their
  actual owners.

### Coast-band filtering and wet-line state

For a coast-distance threshold `d0`, a fragment transition half-width may be
estimated from derivatives as **Derived**
`b=max(abs(dFdx(d)),abs(dFdy(d)),bMin)` in the same distance units. `bMin` is an
**Authored** stability floor. Use a monotone smooth transition over this support
instead of `step(d,d0)`. This filters the visual boundary; it does not replace
semantic land/water classification or an actual shoreline solver.

Persistent wet sand needs state or a supplied history, not a symmetric color
band around the instantaneous waterline. Its provider contract distinguishes:

```text
inundation/run-up source -> wetting event
drainage/evaporation model -> asymmetric drying
terrain permeability/cavity -> spatial retention
material wetness -> color, roughness, micro-normal, and optional film response
```

If no history is required by the visual contract, a static authored run-up
envelope is the cheaper valid approximation. Label it as such. Do not allocate
history because the term "wet" appears in the brief.

### Seabed handoff to water optics

The material and water graphs meet at explicit signals:

| Producer | Signal | Consumer |
| --- | --- | --- |
| terrain/fields | seabed position, normal, static depth, substrate and semantic IDs | seabed material, water optics, placement |
| seabed material | scene-linear reflected radiance under ordinary lighting | water transmission/refraction path |
| water | dynamic surface position/normal, optical path length, transmittance, in-scatter, caustic irradiance, foam coverage | water composition and optionally seabed direct-light modulation |
| wetness provider | wetting age or retained wetness, invalidation key | terrain material |

Caustics modulate incident illumination on submerged surfaces; they do not
change seabed albedo. Foam attenuates the view of the seabed in the water path;
it is not copied into the beach identity. If the water implementation cannot
provide a valid underwater transport path, report the limitation rather than
compensating with emissive substrate or painted turquoise rings.

### Supplemental material assets

A production surface pack may include authored or generated macro-albedo,
height/normal, roughness/cone-variance, and semantic masks for rock, sand,
soil, reef, wood, masonry, and vegetation. Each asset manifest records:

```text
stable asset/version ID and provenance
physical texel scale or documented art-unit scale
color versus data encoding
channel semantics, units, range, neutral value, and invalid value
source and runtime formats, mip policy, gutters, and compression error
allowed projection/UV modes and directional symmetry
material response-bundle ID and legal substrate IDs
close/mid/far representation and projected-error evidence
generation seed/tool revision when generated
```

Assets lacking scale, channel meaning, or color-space metadata are not accepted
into the procedural response graph. A collection of visually compatible maps
without semantic IDs and shared causes does not close the terrain system.
Every material family required by the composition resolves to a licensed
source pack with validated metadata or a tested procedural generator with
reference/error fixtures. Missing grass/soil, cliff/rock, dry/wet sand,
seabed/reef, wood, masonry, vegetation, or hull identities are blockers. A
flat color plus unrelated noise is a diagnostic placeholder, not a completed
response bundle.

## Planet, Terrain Wetness, Lava, And Emissive Surfaces

Planet surfaces:

- Use undeformed radial/object attributes for geological sampling.
- Represent longitude without seams by using a circle coordinate
  `(cos(longitude + advection), sin(longitude + advection))` plus latitude.
- Fade high-frequency bump and optical detail by camera altitude and pixel
  footprint.
- Keep geometry displacement and material height parity; close bump cannot
  substitute for silhouette parity.

Terrain and wetness:

- Wetness comes from world height, slope, cavity, weather, and broad noise.
- Wetness changes color/absorption, micro-normal visibility, and roughness as a
  coupled response. Do not raise specular intensity independently: derive the
  interface `F0` from IOR. If r185 clearcoat is used as a water-film proxy,
  record its fixed `0.04` F0 mismatch and gate it visually.
- Waterline and puddle masks use `fwidth()` filtering to avoid subpixel shimmer.

Lava and emissive procedural surfaces:

- Use TSL fields for crust, fracture, flow, exposure, heat, and ember masks.
- Assign crust/rock to PBR slots and exposed heat to `emissiveNode` in HDR
  scene-linear units.
- Emission is the only material term here allowed to add radiance. Keep the
  crust response energy-conserving and expose raw emission before bloom; do not
  encode glow by overbrightening base color and emission together.
- Put glow in `BloomNode` through `$threejs-bloom`; keep raw emissive and
  bloom-isolated debug views.
- Use reduced step or octave budgets as quality tiers; do not spend fixed heavy
  ray steps on every device.

Projected environmental occlusion:

- Attach projected cloud, smoke, canopy, or weather shadow terms to direct-light
  modulation through material/shadow nodes.
- Do not darken emission or all ambient/environment response with the same
  projected term.

## Per-Instance Dissolve And Variants

Use one material graph for the whole batch. Instance fields drive variants,
wetness, burn, lifetime, and dissolve.

Preferred data paths:

- `StorageInstancedBufferAttribute` or `instancedArray()` for computed instance
  state.
- `storage()` nodes to read/write structured instance data in compute.
- static `InstancedBufferAttribute` for the minimum native tier or immutable
  data.

Per-instance dissolve:

```text
instance seed + lifetime + object/world noise -> dissolve threshold
threshold -> opacityNode / alphaTestNode / maskNode
threshold -> castShadowNode / maskShadowNode
threshold -> emissive edge only when physically/stylistically justified
```

The dissolve mask must be stable in object or world space. Screen-space noise
is reserved for debug views, not material identity.

## Node Post, Color, And Output

Use `RenderPipeline` for the final graph. Use `pass(scene, camera)` as the
beauty pass and `mrt()` when material diagnostics, normals, masks, or emissive
outputs must be shared with post without re-rendering. Use
`PassNode.setResolutionScale()` for reduced-resolution effects.

Built-in nodes first:

- `BloomNode` for authored HDR emission.
- `GTAONode` for contact grounding when material normal/depth output feeds AO.
- `TRAANode` when alpha cutouts, dissolve, or subpixel normal detail shimmer.
- `CSMShadowNode` or `TileShadowNode` through `$threejs-scalable-real-time-shadows` before
  custom shadow logic.

Color rules:

- Color textures: `SRGBColorSpace`.
- Data maps: `NoColorSpace`.
- HDR buffers: `HalfFloatType` until tone map.
- One tone-map owner and one output conversion owner:
  `RenderPipeline.outputColorTransform` or a single `renderOutput()`.
- Generated colors remain scene-linear until the output owner.

## Budgets

Do not publish portable device-class milliseconds, extents, bands, dispatches,
or MiB caps. The application declares whole-frame **Gated** GPU/CPU p95,
peak-live-byte, image-error, and sustained-thermal limits for a named workload.
The material record contains:

```text
frame: output extent/DPR, view distribution, covered fragments, overdraw/MSAA/helpers
fields: active bands, operation classes, dependent chains, direct/cache decision
tiles: tile extent, total/dirty count, dirty texels, dispatch geometry, cadence
layout: sampled textures, samplers, storage textures/buffers by shader stage
samples: hot-path projected lookups * manual taps, including branch maxima
traffic: bytes/texel, mip/layer/ping-pong writes and reads, cache/BW evidence
timing: base/candidate/paired-delta GPU p50/p95, whole-frame GPU/CPU p50/p95
memory: aligned extents and simultaneous lifetime; thermal: warmup/sustained state
```

Interleave matched frames and form
`delta_k=tGPU_k(G+material)-tGPU_k(G)` before computing p50/p95; independent
quantile subtraction is invalid. Marginal evidence diagnoses the material;
acceptance uses contemporaneous whole-frame gates. CPU frame intervals do not
satisfy a GPU gate.

Bloom, AO, grading, and other post passes have sibling owners and separate
timing/binding ledgers. Material integration is **Gated** against an undeclared
extra full-scene render; reuse shared MRT outputs and count every attachment
byte, or explicitly budget the additional scene pass at application level.

Micro accounting:

- Noise: retain bands that pass the projected-footprint and reference-error
  gates; the field cost equation, not a band count, selects caching.
- Texture operations: count projection multiplicity, branch maxima, implicit
  filtered operations, and manual taps. No count is accepted without paired,
  whole-frame, traffic, and thermal evidence.
- Compute: generated cause maps should be initialization or targeted
  invalidation work unless the material changes; select it with the
  procedural-fields amortized ALU/bandwidth equation.
- Storage: pack scalar causes only when coordinate, precision, filtering,
  update cadence, and consumer locality all match.
- Draws: one material per identity family; variants come from node attributes.

### Binding gate

WebGPU core defaults are **Gated** `16` sampled textures, `16` samplers, and
`4` storage textures per shader stage. Compatibility-mode devices may expose
**Gated** zero storage textures/buffers in the vertex stage even while fragment
and compute remain available. Query the stage-specific
`renderer.backend.device.limits`, then inspect the compiled pipeline layout:

```text
Bmaterial = Bdevice - Brenderer - BsharedScene
Smaterial = sum(activePath projectionCount * textureLookups * manualTaps)
```

Bindings are not sample operations. An array/atlas can reduce `Bmaterial`
without reducing `Smaterial`; triplanar multiplies samples without necessarily
adding bindings. Reject any graph that fits the nominal WebGPU minimum only by
ignoring environment, shadow, AO, transmission, or other bindings in that
material pipeline. Post passes own separate pipeline layouts and separate
binding ledgers.

## Replaced Techniques

- Full custom material replacement was replaced by `MeshStandardNodeMaterial`
  and `MeshPhysicalNodeMaterial` slots because the engine retains PBR lighting,
  physical extensions, shadows, and environment integration.
- Manual atlas anisotropic sampling as a default was replaced by texture arrays,
  compressed packed channels, mip-safe gutters, and TSL projection only where
  needed. Manual taps remain a measured close-inspection cost.
- Separate noise per PBR channel was replaced by shared structural fields and
  identity bundles because it gives better quality and fewer evaluations.
- Fixed heavy raymarch/ember loops for emissive lava were replaced by TSL
  fields, quality-tiered step/octave budgets, and node bloom ownership.
- Per-object material cloning was replaced by instanced node attributes and
  storage-backed instance data.
- Manual output conversion in materials was replaced by `RenderPipeline`
  output ownership.

## Diagnostics And Validation

Expose debug outputs for:

```text
coordinate mode and scale
identity weights
structural height/ridge/cavity
wetness, burn, lava exposure, climate, dissolve
atlas tile, mip level, footprint, gutter status
triplanar/hex weights and sample count
roughness before/after specular AA
material-detail variance, geometric roughness contribution, mip/cone statistic
filtered normal and supersampled specular error
dielectric F0, metal/dielectric identity mask, clearcoat approximation flag
sampled-texture/sampler/storage binding ledger and active-path sample operations
raw emissive contribution
bloom-isolated contribution
shadow/dissolve parity
MRT material masks
no-post beauty baseline
```

Validation:

- capture fixed-camera no-post, post, channel, normal variance, emissive, and
  footprint views;
- compare at close, mid, and far camera distances;
- compare filtered-normal/specular output with a supersampled reference and
  reject distance-dependent sharpening or grazing-angle sparkle; the reference
  integrates subpixel material evaluations before averaging radiance with post
  disabled, and reports mean specular energy, peak, and temporal variance;
- sweep material scale, anisotropy tier, roughness, normal strength, wetness,
  and dissolve;
- assert conductor regions use metalness `1`, dielectric regions use `0`, and
  any fractional transition is declared as a filtered subpixel mixture;
- verify every atlas mip gutter under maximum selected anisotropy and motion;
- record compiled per-stage sampled-texture, sampler, storage-texture, and
  storage-buffer bindings against `renderer.backend.device.limits`; separately
  count active hot-path texture operations;
- verify color-space flags on every texture;
- verify generated variants from `assets/generated-variants/` load as data maps
  unless a channel is explicitly color;
- record GPU frame time for each quality tier with resolution, DPR, camera
  coverage, lighting/shadows, adapter/browser, and sustained thermal interval;
  reject material graphs that exceed the declared **Gated** budgets.
