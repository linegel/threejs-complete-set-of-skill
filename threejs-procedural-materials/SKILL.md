---
name: threejs-procedural-materials
description: Author production WebGPU/TSL procedural materials in Three.js. Use for NodeMaterial PBR identity fields, atlas and triplanar filtering, specular AA, planet-space material fields, terrain wetness, lava and hot emissive procedural surfaces, raymarched material fields, per-instance dissolve, derivative normals, and authored physical response bundles.
---

# Procedural Materials

Build procedural materials as `WebGPURenderer` + TSL + `NodeMaterial` graphs.
The only production lane is a `MeshStandardNodeMaterial` or
`MeshPhysicalNodeMaterial` whose node slots preserve Three.js lighting,
environment, shadow, transmission, clearcoat, sheen, anisotropy, and output
upgrades while replacing only the material causes.

Legacy WebGL implementation (deprecated, do not extend): `examples/lava-flow-surface/lava-surface.js`.

Use `$threejs-choose-skills` preflight for scenes that also need atmosphere,
clouds, oceans, shadows, post, or validation ownership.

## Fastest Architecture First

Algorithm class dominates material throughput. Start from one shared TSL cause
graph, not from independent texture/noise calls per PBR channel:

```text
stable coordinates
  -> structural fields
  -> material identity weights
  -> causal modifiers
  -> filtered microstructure
  -> derivative normals and specular AA
  -> NodeMaterial PBR slots
  -> node post/output
```

The target graph writes:

- `colorNode` from linear authored identity colors or `SRGBColorSpace` color
  textures sampled through TSL.
- `roughnessNode`, `metalnessNode`, `aoNode`, `opacityNode`, and physical slots
  from the same identity weights.
- `normalNode` from `normalMap()`, `bumpMap()`, or a derivative normal built
  from the same height field using `dFdx()`, `dFdy()`, and `fwidth()`.
- `emissiveNode` only for actual material emission; route glow through
  `$threejs-bloom` and `BloomNode` in the node render pipeline.
- `positionNode`, `castShadowPositionNode`, and
  `receivedShadowPositionNode` when material displacement must match visible
  and shadowed geometry.
- `maskNode`, `alphaTestNode`, `castShadowNode`, or `maskShadowNode` for
  dissolve and cutout behavior, driven by the same instance fields.

Read [references/procedural-pbr-system.md](references/procedural-pbr-system.md)
for the WebGPU/TSL material system, quality tiers, budgets, atlas/triplanar
costs, derivative normals, specular AA, planet fields, wetness, emissive
ownership, per-instance dissolve, and validation.

Canonical walnut, antique-gold, ebony, and lava TSL example:
[examples/tsl-procedural-pbr/](examples/tsl-procedural-pbr/).

Use the sibling examples as domain sources, not implementation recipes:

- `$threejs-procedural-fields` for designing shared scalar/vector causes.
- `$threejs-procedural-planets` for planet-space coordinates, altitude
  filtering, and orbit-to-close material/geometry parity.
- `$threejs-water-optics` for coupled reflection, refraction, absorption,
  crest response, and water-surface diagnostics.
- `$threejs-bloom` and `$threejs-image-pipeline` for HDR emissive extraction,
  tone mapping, output conversion, and node post ownership.
- `$threejs-scalable-real-time-shadows` when material displacement, alpha, or projected
  environmental occlusion must remain shadow-consistent.

## Capability Gate And Tiers

Initialize the renderer before selecting quality. The top tier uses native
compute/storage for generated material data and instance state; the reduced
tier uses smaller generated maps, static variants, or baked instance attributes.

```js
await renderer.init();
if (renderer.backend.isWebGPUBackend) {
  await renderer.computeAsync([buildMaterialFieldNode, buildInstanceStateNode]);
} else {
  useReducedMaterialTier({
    fieldResolution: 512,
    variants: "assets/generated-variants/",
    dynamicDissolve: false,
  });
}
```

Quality tiers:

| Tier | Material architecture | Targets |
| --- | --- | --- |
| Ultra | TSL fields, `StorageTexture` generated cause maps, `StorageInstancedBufferAttribute` dissolve/state, triplanar only where UVs cannot carry scale | desktop discrete, close inspection |
| High | TSL fields plus packed KTX2/BasisU maps, 2-axis or single-axis projection where possible, derivative normals, per-instance attributes | desktop integrated |
| Reduced | precomputed generated variants, lower field resolution, fewer octaves, disabled dynamic dissolve, no triplanar beyond hero assets | mobile or non-native backend |

## Performance Budgets

Default targets for one hero procedural material family:

- Desktop discrete: <= 0.8 ms material overhead at 1440p, <= 2 full-rate node
  passes, <= 1 initialization compute dispatch per generated field, <= 128 MB
  total material textures/storage.
- Desktop integrated: <= 1.4 ms material overhead at 1080p, <= 1 full-rate
  pass plus reduced-resolution bloom/AO as needed, <= 64 MB material
  textures/storage.
- Mobile: <= 2.0 ms material overhead at 720p internal resolution, no dynamic
  triplanar on repeated props, <= 32 MB material textures/storage.

Per-material budgets:

- TSL noise/octaves: 3-5 octave bands for hero surfaces, 1-3 for repeats;
  cache or precompute anything shared across many draws.
- Triplanar: 3 texture samples per channel before filtering; reserve it for
  UV-less or hero surfaces. Prefer UVs, texture arrays, packed channels, or
  hex/texture bombing when they reach the same quality cheaper.
- Atlas/array sampling: use duplicated mip gutters or texture arrays before
  adding manual sample clamps. Manual anisotropic taps are a hero-tier cost.
- Derivative normals: one height evaluation plus derivative math where
  possible; do not reevaluate unrelated height fields for color, roughness, and
  normal.
- Instances: use one material graph and per-instance node attributes; never
  clone a material per object for color, dissolve, wetness, or variant choice.

## Color And Output

- Color textures use `SRGBColorSpace`; generated color fields stay linear until
  the output owner.
- Normal, roughness, metalness, masks, noise, height, LUT, weather, and
  generated variant textures use `NoColorSpace` unless the channel is explicitly
  color.
- HDR material and post buffers stay `HalfFloatType` until tone mapping.
- The app has one tone-map owner and one output conversion owner:
  `RenderPipeline.outputColorTransform` or one explicit `renderOutput()` node.
- Materials do not manually encode display color and do not hide unstable
  highlights with post.

`RenderPipeline`, `pass()`, `mrt()`, `PassNode.setResolutionScale()`,
`outputColorTransform`, and `renderOutput()` are the current node post path.

## Required Controls

- coordinate mode: UV, object, world, planet radial, or generated texture space;
- real-world or perceptual texture scale, in meters or documented art units;
- material identity weights and authored response bundles;
- roughness range, micro-normal strength, and specular AA strength;
- causal fields for wetness, burn, erosion, lava exposure, climate, or dissolve;
- texture-array/atlas tile index, mip gutter status, anisotropy tier, and
  triplanar or hex-tiling cost mode;
- derivative filtering thresholds and height-to-normal scale;
- emissive intensity in HDR scene-linear units, plus bloom contribution debug;
- instance variant, wetness, dissolve threshold, and lifetime when instanced;
- channel, mask, footprint, roughness-before/after-AA, normal variance, and
  no-post debug views.

## Failure Conditions

- PBR channels sample unrelated noise or unrelated coordinate spaces;
- roughness is a scalar afterthought instead of identity-driven;
- high-frequency normals survive below one pixel;
- triplanar or hex tiling hides seams by spending samples everywhere;
- atlas padding is ignored under mipmapping;
- material displacement and shadow/collision position diverge;
- emissive color owns both lighting and bloom without a raw-emission debug;
- projected environmental occlusion darkens emission or all ambient response;
- output conversion is duplicated in material and post;
- per-instance material state creates cloned materials instead of node
  attributes or storage-backed attributes.

## Routing Boundary

Use `$threejs-procedural-fields` when the hard part is the shared scalar/vector
cause design. Use `$threejs-procedural-planets` for complete planet bodies and
geometry/material parity. Use `$threejs-water-optics` for physically coupled
water. Use `$threejs-bloom`, `$threejs-image-pipeline`, and
`$threejs-exposure-color-grading` when the material requires HDR extraction,
tone mapping, or final image ownership. Use `$threejs-scalable-real-time-shadows` for
`CSMShadowNode`, `TileShadowNode`, or material-aware shadow decisions.
