---
name: threejs-procedural-materials
description: Author workload-selected WebGPU/TSL procedural materials in Three.js. Use for coupled terrain/coast/seabed response bundles, grass, rock, dry/wet sand and reef identities, NodeMaterial PBR fields, atlas and triplanar filtering, footprint filtering, specular AA, terrain wetness, stylized palette/facet policies, emissive or raymarched fields, per-instance dissolve, derivative normals, and explicit physical-response bundles.
---

# Procedural Materials

Build procedural materials as `WebGPURenderer` + TSL + `NodeMaterial` graphs.
The canonical physically lit lane is a `MeshStandardNodeMaterial` or
`MeshPhysicalNodeMaterial` whose node slots preserve Three.js lighting,
environment, shadow, transmission, clearcoat, sheen, anisotropy, and output
upgrades while replacing only the material causes.

## Numerical Provenance

Every numerical claim emitted from this skill carries one label:

- **Derived**: follows from a stated equation, format, or byte count.
- **Gated**: a capability or acceptance threshold that must pass.
- **Measured**: captured on the named browser, GPU, resolution, material,
  lights, camera coverage, and workload; it does not transfer automatically.
- **Authored**: a tunable appearance or planning starting point.

Unlabelled vector widths, channel counts, and API-version digits are structural,
not performance or physics claims.

Use `$threejs-choose-skills` preflight for scenes that also need atmosphere,
clouds, oceans, shadows, post, or validation ownership.

## Select Architecture From Invocation Topology

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

Texture-space/decoupled shading is a separate architecture, not the default
specular-stability path. It requires an explicit radiance-cache owner, update
and visibility model, and measured bandwidth/error contract; do not silently
replace derivative normals or specular AA with cached radiance.

The target graph writes:

- `colorNode` from linear authored identity colors or `SRGBColorSpace` color
  textures sampled through TSL.
- `roughnessNode`, `metalnessNode`, `aoNode`, `opacityNode`, and physical slots
  from the same identity weights.
- `normalNode` from `normalMap()`, `bumpMap(texture(...))` for texture height
  maps, or a surface-gradient normal built from the same scalar procedural
  height. Fragment derivatives must execute in derivative-uniform control flow;
  vertex/compute displacement uses analytic or stored gradients.
- `emissiveNode` only for actual material emission; route glow through
  `$threejs-bloom` and `BloomNode` in the node render pipeline.
- `positionNode` and `castShadowPositionNode` consume the same local-space
  displacement node when material displacement must match visible and caster
  geometry. `receivedShadowPositionNode` is a separate world-space receiver
  override in r185; leave it `null` unless a world-space replacement is
  derived and validated explicitly.
- `maskNode`, `alphaTestNode`, `castShadowNode`, or `maskShadowNode` for
  dissolve and cutout behavior, driven by the same instance fields.

Read [references/procedural-pbr-system.md](references/procedural-pbr-system.md)
for the WebGPU/TSL material system, quality tiers, budgets, atlas/triplanar
costs, derivative normals, specular AA, planet fields, wetness, emissive
ownership, per-instance dissolve, and validation.

Canonical walnut, antique-gold, ebony, and lava TSL example:
[examples/tsl-procedural-pbr/](examples/tsl-procedural-pbr/).

The example now enforces dielectric/conductor metalness endpoints, meter-valued
height through `sceneUnitsPerMeter`, footprint-filtered structural bands, and
removed material slope-energy transfer so r185 geometry roughness is not
counted twice. Its spectral-support/variance multipliers and identity ranges
remain **Authored** trial values. The Node construction validator is structural
evidence, not an energy, visual-reference, timing, or thermal acceptance proof.

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

## Coupled Terrain, Coast, And Seabed Contract

For generated islands, coasts, riverbanks, reefs, or exposed terrain, consume
one versioned field contract from `$threejs-procedural-fields`. Do not recreate
coast, slope, moisture, or substrate noise inside each material. At minimum,
the contract declares units, sign conventions, coordinate frame, generation
revision, filtering policy, and update cadence for:

```text
signed coast distance and nearest-coast tangent/normal
terrain/seabed elevation, water-rest elevation, and water-column depth
geometric slope, curvature/cavity, drainage/moisture, and exposure
substrate/material identity and terrace/cliff/beach semantic masks
salt/spray exposure, run-up or inundation envelope, and persistent wetness
reef/rock/sand/organic-cover eligibility and authored exclusion masks
```

`water-column depth` is **Derived** from compatible elevations; it is not a
second painted shallow-water mask. Water owns dynamic free-surface, foam, and
optical transport. This skill owns the dry/wet terrain and submerged substrate
responses that those optics reveal. A white shoreline stripe painted into
terrain albedo is not foam, and cyan seabed emission is not shallow-water
transport.

Build normalized identity weights for grass/organic cover, dry rock or cliff,
dry sand, wet sand or waterline substrate, submerged sand, reef/rock, and any
project-specific identity. Preserve hard semantic exclusions separately, then
filter only the visible transition width from the projected footprint. Every
identity is a response bundle:

```text
linear base reflectance + roughness-alpha + metalness endpoint
resolved height/normal spectrum + removed-slope variance
porosity/absorption or wet-film approximation
macro color variation + microstructure scale
material-slot/semantic ID + diagnostic color
```

Blend `alpha = roughness^2`, not unrelated roughness scalars. Filter the same
weights into color, roughness, height/normal, AO/cavity, and wetness; otherwise
the grass edge, cliff normal, and sand response detach under motion. Terrain
geometry owns silhouettes and intentionally faceted normals. Material normals
add only footprint-valid detail and must not smooth away authored cliff facets.

Stylization is an authored identity transform, not license to violate material
causality. Quantize a controlled palette, macro-value families, roughness
families, and geometric facet normals before lighting while retaining
scene-linear PBR and one output transform. Do not bake light-facing highlights,
ambient occlusion, foam, or turquoise water into terrain base color. Under
shallow water, seabed color and roughness remain substrate properties; the
water owner supplies depth-dependent attenuation, refraction, surface Fresnel,
caustics, and foam.

The detailed response, filtering, and asset-channel contract is in
[references/procedural-pbr-system.md](references/procedural-pbr-system.md).

## Capability Gate And Tiers

Initialize the renderer before selecting quality. This skill has one production
path: native WebGPU.

```js
await renderer.init();
if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error("threejs-procedural-materials requires native WebGPU.");
}
```

Call `renderer.compute()`/`computeAsync()` only for a cause-map or instance
update selected by the procedural-fields amortized cost gate.
After initialization, `computeAsync()` provides no GPU-completion fence in
r185; use `compute()` for submission and an actual readback/map or timestamps
for completion evidence.

Quality tiers:

| Tier | Material architecture | Targets |
| --- | --- | --- |
| Full | TSL fields, cost-gated `StorageTexture` cause maps, storage-backed instance state, filtered normals/specular AA, projection only where UVs cannot preserve scale | **Measured** close-inspection target inside budget |
| Budgeted | same graph with packed sampled data, single-/two-axis projection where valid, fewer filtered bands, lower update cadence | **Measured** full tier misses the named target's traffic, thermal, or frame gate |
| Minimum native | precomputed generated variants, lower field resolution, filtered UV/array sampling, static instance attributes | **Gated** WebGPU exists; Budgeted still misses target |

## Performance Budgets

There is no universal desktop/mobile millisecond, map-extent, band-count, or
MiB row. The application declares whole-frame **Gated** GPU p95, CPU p95,
peak-live-byte, quality-error, and sustained-thermal limits for named workloads.
Select a tier only from **Measured** evidence for that workload.

Record output extent/DPR, covered fragments, overdraw/MSAA/helper estimate,
active procedural operations, tile extent and dirty/update cadence, per-stage
bindings, executed texture operations, producer/consumer bytes, mip/layer/
ping-pong lifetimes, and cache/effective-bandwidth evidence. Report base,
candidate, and interleaved paired-delta GPU p50/p95 plus contemporaneous
whole-frame GPU/CPU p50/p95 and peak live bytes. Mobile-class evidence includes
warmup, sustained interval, power state, and throttling result.

Interleave matched frames and compute
`delta_k=tGPU_k(graph+material)-tGPU_k(graph)` before taking p50/p95; never
subtract independent quantiles. Marginal evidence diagnoses the material;
whole-frame gates accept it. CPU frame intervals are not GPU timings.

The material integration is **Gated** to avoid an undeclared extra full-scene
render. Reuse the scene owner's MRT and account for every attachment byte, or
declare and budget the additional scene pass at application level. Bloom, AO,
grading, and other post passes retain sibling ownership and separate ledgers.

Per-material accounting:

- TSL noise/octaves: retain only bands passing the projected-footprint and
  quality-error gates; choose direct versus cached evaluation with the
  procedural-fields cost equation, not an octave count.
- Installed r185 `triplanarTexture()` issues **Derived** three filtered samples
  per texture and uses simple absolute-normal weights. Two separately bound
  color/data textures therefore add six samples; a separate normal texture adds
  three more before any manual taps. Reserve this path for UV-less surfaces
  after measuring it. Arrays/atlases reduce bindings, not sample operations;
  custom hex tiling has its own measured sample count and does not solve seams.
- Atlas/array sampling: use duplicated mip gutters or texture arrays before
  adding manual sample clamps. Manual anisotropic taps require measured
  close-inspection value.
- Derivative normals: one height evaluation plus derivative math where
  possible; do not reevaluate unrelated height fields for color, roughness, and
  normal.
- Instances: use one material graph and per-instance node attributes; never
  clone a material per object for color, dissolve, wetness, or variant choice.

### Mobile sample and binding ledger

Count bindings and executed sample operations separately. WebGPU device
defaults are **Gated** at `16` sampled textures, `16` samplers, and `4` storage
textures per shader stage; query `renderer.backend.device.limits` because the
actual device may expose more and Three.js lighting, environment, shadows, and
other bindings in the same material pipeline spend from those stage limits.
Post passes have separate pipeline layouts and need separate ledgers; they do
not reduce the material pipeline's binding limit. Compatibility-mode devices
can expose zero vertex-stage storage resources, so query the stage-specific
limits rather than the aggregate compute limit. The material allowance is:

```text
B_material = B_device - B_renderer - B_scene_shared
S_material = sum(active-path projectionCount * textureLookups * manualTaps)
```

`B_*` comes from the compiled pipeline layout; `S_material` comes from generated
WGSL/graph inspection and includes the worst hot branch. As an **Authored**
trial, teams may record a candidate sample ceiling in the workload manifest,
but it has no portable acceptance status. Any sample count requires **Measured**
A/B, whole-frame, traffic, and thermal evidence on the target.
Pack lanes only when color space, coordinates, derivatives, precision, filter,
and update cadence agree.

## PBR Energy And Normal-Filtering Contract

- Dielectric normal-incidence Fresnel is **Derived**
  `F0 = ((n2 - n1) / (n2 + n1))^2`; against air (`n1 = 1`), `ior = n2 = 1.5`
  gives `F0 = 0.04`, and water at `ior ~= 1.333` gives `F0 ~= 0.0204`. Drive
  `MeshPhysicalNodeMaterial` IOR/specular slots and let Three.js retain its GGX
  and multiscattering energy path. Do not multiply a second Fresnel lobe into
  `colorNode`.
- Metalness is identity, not highlight strength. Homogeneous dielectrics use
  `0`; exposed homogeneous metal uses `1`. Oxide, dirt, coating, and substrate
  are separate masks/response bundles. Fractional metalness is only a declared
  subpixel-mixture approximation; broad fractional values make metals waxy.
- Blend normalized identity weights. If one GGX lobe approximates a subpixel
  roughness mixture, blend `alpha = roughness^2` then take `sqrt`; a weighted
  mixture of distinct lobes is not exactly another GGX lobe, so keep visible
  material regions discrete or use explicit layers.
- Filter height/normal content before specular AA. Store/sample normal mean plus
  variance (or a cone/Toksvig statistic) across mips; normalizing the averaged
  normal and discarding its length falsely sharpens the BRDF. For unit normals
  whose mip stores the unnormalized vector mean `m`, **Derived** unresolved
  vector variance is `max(1 - dot(m,m), 0)`; combine it with within-pixel
  derivative variance.
- Three.js r185 already adds geometric-normal variation in `getRoughness()`
  from `normalViewGeometry`. Custom specular AA must add only unresolved
  material-detail variance, or it double counts geometric roughness.
- For small-angle material-detail variation, a one-pixel box model gives
  **Derived** `v_box ~= (|dNdx|^2 + |dNdy|^2)/12`. Map that statistic into GGX
  `alpha = roughness^2` with an **Authored** calibration, then replace it with
  a **Measured** fit to a supersampled reference; there is no universal
  multiplier. Clamp and expose pre/post roughness and variance views.
- For inline procedural height whose normal already uses screen derivatives,
  do not blindly differentiate that normal again. Band-limit each component
  and transfer removed slope energy instead. For a random-phase sinusoid,
  **Derived** `v_j=(2*pi*A_j*f_j)^2/2 * (1-w_j^2)`; sum independent bands.
  Noise support and variance coefficients start **Authored** and become
  **Measured** only after spectrum/reference fitting. Do not add both this term
  and a mip/box statistic for the same unresolved energy.
- Installed r185 clearcoat fixes its lobe at **Gated** `F0 = 0.04`; it is not an
  exact water-film lobe (`F0 ~= 0.0204`). If wetness uses clearcoat, label that
  an **Authored** approximation and validate the mismatch under grazing light.

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
- roughness range, micro-normal strength, specular-variance mapping calibration,
  and clamp;
- causal fields for wetness, burn, erosion, lava exposure, climate, or dissolve;
- terrain/coast input revision, coast-distance sign, water-rest elevation,
  substrate IDs, wet-line/run-up envelope, and missing-data behavior;
- per-identity grass, cliff, dry/wet sand, submerged substrate, and reef
  response bundles plus palette family and facet-normal policy;
- texture-array/atlas tile index, mip gutter status, anisotropy tier, and
  triplanar or hex-tiling cost mode;
- static-map device transcode format, mip bytes, and per-channel compression
  error; dynamic storage remains uncompressed;
- derivative filtering thresholds and height-to-normal scale;
- emissive intensity in HDR scene-linear units, plus bloom contribution debug;
- instance variant, wetness, dissolve threshold, and lifetime when instanced;
- channel, mask, footprint, roughness-before/after-AA, normal variance, and
  no-post debug views.

## Failure Conditions

- PBR channels sample unrelated noise or unrelated coordinate spaces;
- roughness is a scalar afterthought instead of identity-driven;
- height/normal bands survive after violating the projected-footprint gate, or
  their removed variance is discarded;
- triplanar or hex tiling hides seams by spending samples everywhere;
- atlas padding is ignored under mipmapping;
- static compression is selected without max/RMS error gates for normal,
  roughness, height, or threshold channels;
- material displacement and shadow/collision position diverge;
- emissive color owns both lighting and bloom without a raw-emission debug;
- projected environmental occlusion darkens emission or all ambient response;
- output conversion is duplicated in material and post;
- per-instance material state creates cloned materials instead of node
  attributes or storage-backed attributes.
- broad fractional metalness is used for tarnish, dirt, or coating instead of
  separate conductor/dielectric identities;
- shallow-water color is faked with emissive/cyan terrain, foam is baked into
  shore albedo, or material-local noise produces a second coastline;
- terrain identity transitions disagree across color, roughness, normals,
  semantic IDs, and wetness, or authored cliff facets are erased by material
  normal blending;

## Routing Boundary

Use `$threejs-procedural-fields` when the hard part is the shared scalar/vector
cause design. Use `$threejs-procedural-planets` for complete planet bodies and
geometry/material parity. Use `$threejs-water-optics` for physically coupled
water. Use `$threejs-bloom`, `$threejs-image-pipeline`, and
`$threejs-exposure-color-grading` when the material requires HDR extraction,
tone mapping, or final image ownership. Use `$threejs-scalable-real-time-shadows` for
`CSMShadowNode`, `TileShadowNode`, or material-aware shadow decisions.
