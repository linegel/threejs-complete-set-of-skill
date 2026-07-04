# WebGPU/TSL Procedural PBR Material Systems

This reference is the production path for procedural materials in latest
Three.js: `WebGPURenderer`, TSL from `three/tsl`, `MeshStandardNodeMaterial` or
`MeshPhysicalNodeMaterial`, node render pipelines, and compute/storage generated
data where it wins. The material graph preserves Three.js PBR lighting and
changes the material causes through node slots.

## Contents

- Highest-throughput material architecture
- Capability gate and quality tiers
- NodeMaterial slot contract
- Coordinate and field ownership
- Atlas, texture array, triplanar, and hex tiling
- Derivative normals and specular AA
- Authored PBR response bundles
- Planet, terrain wetness, lava, and emissive surfaces
- Per-instance dissolve and variants
- Node post, color, and output
- Budgets
- Replaced techniques
- Diagnostics and validation

## Highest-Throughput Material Architecture

The fastest durable architecture is one shared TSL field graph feeding all PBR
channels of a node material:

```text
stable coordinate
  -> structural field cache
  -> identity weights
  -> causal modifiers
  -> filtered microstructure
  -> PBR node slots
  -> node post/output owner
```

This wins because it avoids full material replacement, duplicate noise, cloned
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
if (renderer.backend.isWebGPUBackend) {
  await renderer.computeAsync([generateCauseMaps, generateInstanceState]);
} else {
  selectReducedMaterialTier({
    generatedMapSize: 512,
    dynamicStorage: false,
    triplanarTier: "hero-only",
  });
}
```

Quality tiers:

| Tier | Generated data | Material sampling | Instance state |
| --- | --- | --- | --- |
| Ultra | `StorageTexture` cause maps at 1024-2048, optional manual mip chain, generated once or on targeted invalidation | TSL fields plus texture arrays, triplanar/hex tiling only for hero surfaces, derivative normals, specular AA | `StorageInstancedBufferAttribute` or `instancedArray()` storage nodes |
| High | packed KTX2/BasisU maps or generated 512-1024 cause maps | UV/array sampling first, limited triplanar, 3-5 octave procedural fields | static instanced attributes plus small dynamic node uniforms |
| Reduced | assets from `assets/generated-variants/`, 256-512 maps, fewer variants | UV/array sampling, no manual anisotropic taps, 1-3 octave fields | baked attributes; only for an explicit request for how to apply fallback when WebGPU is unavailable |

## NodeMaterial Slot Contract

Every procedural material documents which node slots it owns:

```text
colorNode: identity base color, wetness/burn/ore/climate color shifts
roughnessNode: identity roughness plus wetness, dust, polish, heat, frost
metalnessNode: identity metalness, oxide, exposed ore, inclusions
normalNode: normalMap(), bumpMap(), or derivative normal from shared height
aoNode: authored cavity or terrain contact, never fake global lighting
opacityNode / alphaTestNode / maskNode: cutout, dissolve, erosion, cards
emissiveNode: only real material emission in HDR scene-linear units
positionNode: visible displacement when silhouette or parallax matters
castShadowPositionNode / receivedShadowPositionNode: shadow parity
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
| Normal space | `normalMap()`, `bumpMap()`, or derivative normal from shared height | normal maps and normal variance are `NoColorSpace` data |
| Instance attributes | `attribute()`, `StorageInstancedBufferAttribute`, `instancedArray()` | variant/dissolve/lifetime are data fields |
| Scene-linear material color | `colorNode`, `emissiveNode`, authored identity bundles | emission stays scene-linear HDR until post |
| Output owner boundary | `RenderPipeline.outputColorTransform` or one `renderOutput()` | forbids sRGB-as-data and forbids material-owned display encoding |

## Atlas, Texture Array, Triplanar, And Hex Tiling

Prefer the lowest-cost representation that meets the quality target:

1. UVs with correct texel density and KTX2/BasisU compression.
2. Texture arrays or packed material channels for tile sets and variants.
3. Atlas only when array textures are not practical; generate duplicated mip
   gutters offline.
4. Triplanar only for UV-less assets, terrain cuts, and close hero surfaces.
5. Hex/texture bombing when visible repetition is the bigger problem than
   projection seams.

Atlas rules:

- A tile clamp can prevent direct neighbor taps but cannot repair mip levels
  created without duplicated borders.
- Generate mip-safe padding offline; disable automatic mip generation only when
  supplying the complete chain.
- Color atlas layers use `SRGBColorSpace`; packed data layers use
  `NoColorSpace`.
- Keep tile index and material response bundle coupled so roughness, normal,
  color, and masks come from the same identity.

Triplanar cost notes:

- A full triplanar sample costs 3 samples per channel before extra filtering.
- Triplanar normal reconstruction often costs more than color; use it only when
  surface orientation changes visibly.
- Blend weights must be derivative-aware or softened enough to avoid axis
  popping.
- If only top/side separation matters, use 2-axis projection or a slope blend
  instead of full triplanar.

Use TSL `triplanarTexture()` or `triplanarTextures()` for texture projection
when it is the chosen tier. Use `fwidth()` to filter masks, tile boundaries,
and hex weights.

## Derivative Normals And Specular AA

The best default for procedural height detail is a derivative normal derived
from the same height field that creates color/roughness/cavity. Do not sample a
different high-frequency field for normals.

Specular AA is mandatory for procedural microstructure:

```text
normalVariance = max(dot(dFdx(N), dFdx(N)), dot(dFdy(N), dFdy(N)))
filteredRoughness = sqrt(roughness * roughness + normalVariance * strength)
```

Clamp filtered roughness into the material's authored range before assigning
`roughnessNode`. Expose roughness before/after AA and normal variance debug
views.

For texture normal maps, use `normalMap()` and keep normal textures as
`NoColorSpace`. For scalar procedural height, use `bumpMap()` when the built-in
node is sufficient; use a custom derivative normal only when it needs shared
height, distance filtering, or orientation-specific behavior.

## Authored PBR Response Bundles

Use response bundles instead of unrelated scalar sliders. Example ranges:

| Surface | Base roughness | Metalness | Clearcoat | Clearcoat roughness | Height/normal scale |
| --- | ---: | ---: | ---: | ---: | ---: |
| oiled walnut | 0.38-0.50 | 0.00-0.04 | 0.45-0.70 | 0.22-0.34 | 0.010-0.025 |
| antique gold | 0.20-0.34 | 0.72-0.90 | 0.10-0.30 | 0.16-0.28 | 0.004-0.014 |
| ebony lacquer | 0.30-0.46 | 0.00-0.05 | 0.55-0.85 | 0.18-0.32 | 0.006-0.020 |
| plaster | 0.88-0.98 | 0.00 | 0.00 | 0.00 | 0.004-0.018 |
| wet rock | 0.18-0.42 | 0.00-0.03 | 0.00-0.15 | 0.08-0.20 | 0.012-0.060 |

The former gallery-frame link was removed because the referenced file contains
geometry only. Treat this table as a local authored-material starting point and
verify with no-post captures under neutral lighting before using it as an art
target.

Visible correctness signatures:

| Surface | Visible signature | Classic wrongness |
| --- | --- | --- |
| Walnut | Visible signature: warm oiled grain, energy-conserving highlights, roughness AA suppresses distant sparkle | classic wrong: double color conversion, sparkle from unfiltered normals, washed fields |
| Antique gold | Visible signature: metallic energy, tarnish raises roughness while worn edges stay bright | classic wrong: waxy metal, nonmetallic gray response, roughness unrelated to patina |
| Ebony lacquer | Visible signature: dark body color with clearcoat glints and filtered micrograin | classic wrong: crushed black with no energy, plastic clearcoat, sparkle at grazing angles |
| Lava crust/heat | Visible signature: crust remains PBR while exposed heat emits scene-linear HDR into bloom | classic wrong: gray emission, display-space glow, crushed lava with no raw emissive debug |
| Wet rock | Visible signature: wetness lowers roughness, darkens color, and changes normal response together | classic wrong: wetness as a washed overlay or roughness-only scalar |
| Wetness fields | Visible signature: waterline/cavity/slope causes align across color, roughness, normal, and clearcoat | classic wrong: washed fields, sRGB-as-data masks, material-owned display encoding |

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
- Wetness darkens color, lowers roughness, can raise clearcoat/specular, and
  changes normal strength together.
- Waterline and puddle masks use `fwidth()` filtering to avoid subpixel shimmer.

Lava and emissive procedural surfaces:

- Use TSL fields for crust, fracture, flow, exposure, heat, and ember masks.
- Assign crust/rock to PBR slots and exposed heat to `emissiveNode` in HDR
  scene-linear units.
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
- static `InstancedBufferAttribute` only for reduced tiers or immutable data.

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

Per hero material family:

| Target | Material overhead | Generated data | Post/pass budget |
| --- | ---: | ---: | --- |
| Desktop discrete | <= 0.8 ms at 1440p | <= 128 MB, 1024-2048 maps, 1-3 init dispatches | <= 2 full-rate passes, reduced bloom/AO |
| Desktop integrated | <= 1.4 ms at 1080p | <= 64 MB, 512-1024 maps | <= 1 full-rate pass, reduced effects |
| Mobile/reduced | <= 2.0 ms at 720p internal | <= 32 MB, 256-512 maps | no optional full-rate post |

Micro budgets:

- Noise: 3-5 octaves for hero closeups, 1-3 for repeated props.
- Texture samples: keep common PBR materials under 8-12 samples per pixel;
  hero triplanar materials must justify 18+ samples with visible value.
- Compute: generated cause maps should be initialization or targeted
  invalidation work, not full-frame work unless the material itself animates.
- Storage: pack scalar causes into RGBA fields when they share update cadence.
- Draws: one material per identity family; variants come from node attributes.

## Replaced Techniques

- Full custom material replacement was replaced by `MeshStandardNodeMaterial`
  and `MeshPhysicalNodeMaterial` slots because the engine retains PBR lighting,
  physical extensions, shadows, and environment integration.
- Manual atlas anisotropic sampling as a default was replaced by texture arrays,
  compressed packed channels, mip-safe gutters, and TSL projection only where
  needed. Manual taps remain a hero-tier cost.
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
normal variance and filtered normal
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
- sweep material scale, anisotropy tier, roughness, normal strength, wetness,
  and dissolve;
- verify color-space flags on every texture;
- verify generated variants from `assets/generated-variants/` load as data maps
  unless a channel is explicitly color;
- record GPU frame time for each quality tier and reject material graphs that
  exceed the budgets above.
