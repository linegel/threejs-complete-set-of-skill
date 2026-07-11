# TSL Procedural PBR Materials

Native-WebGPU/TSL reference for shared-cause procedural materials. One field
graph owns color, roughness, physical identity masks, coating, height-derived
normal perturbation, dissolve, and emission while Three.js retains BRDF and
lighting ownership.

The numeric identity ranges in this example are **Authored trial values**, not
device or product gates. Validate them under the product light rig, exposure,
view distribution, and target hardware.

The canonical browser scene includes walnut, antique gold, ebony lacquer,
lava, wet rock, a mip-guttered atlas, a four-layer texture array, a true
three-sample triplanar material, storage-backed instanced dissolve, and an
enabled directional shadow caster/receiver fixture. Validation mode uses the
shared scene output and emissive attachments plus real material albedo,
parameter, normal, footprint, and normal-variance MRT attachments. Production
callers can disable the five material diagnostic attachments.
`lab.manifest.json` intentionally remains `incomplete` until the
current adapter supplies render-target PNGs, shadow-atlas dissolve parity,
supersampled specular-error measurements, GPU timestamps, and lifecycle proof.

## Physical Identity Contract

- Walnut and ebony use `metalness=0`. Their dielectric specular response comes
  from the renderer; dark color does not make them weakly metallic.
- Gold blends the endpoints `metalness=0` and `metalness=1` with a filtered
  exposed-conductor mask. Tarnish is a separate dielectric region. Fractional
  values exist only at the spatially filtered boundary, not as a bulk material
  identity.
- Clearcoat is a separate dielectric layer. In Three.js r185 its Fresnel F0 is
  fixed near 0.04; it is a lacquer/protective-coat approximation, not a general
  measured thin-film model.
- Height ranges are meters. `sceneUnitsPerMeter` converts them to the linear
  unit used by `positionView`; this prevents a unitless bump amplitude from
  silently changing when scene scale changes.
- `coordinateMode="object"` makes pattern wavelength follow object scale while
  meter height stays physical. Use world coordinates or update
  `coordinateScale` when the material must preserve world-space wavelength.
- Wet rock derives color darkening, roughness, clearcoat, and normal attenuation
  from the same world-height/cavity/macro wetness cause. The r185 clearcoat
  `F0=0.04` remains an explicitly authored approximation to a water film, not a
  physical claim.

## Normal Filtering and Specular AA

`createDerivativeNormalFromHeight()` implements a screen-space surface
gradient from the shared scalar height. Before that normal is formed, every
structural band is attenuated by its composed screen footprint. Removed slope
energy is transferred to the microfacet width:

```text
q      = supportMultiplier * maxComponent(fwidth(bandCoordinates))
keep   = 1 - smoothstep(q0, 0.5, q)
fscene = q / surfacePixelSpan
vband  = calibration * (2*pi*A*fscene)^2/2 * (1 - keep^2)
alpha' = alpha + k * sum(vband),       alpha = roughness^2
roughness' = sqrt(alpha')
```

The sine-band slope term is **Derived**. Noise support multipliers, noise-family
variance calibration, and the fade start are **Authored trials** that require a
measured spectrum and supersampled radiance reference.
`k=specularVarianceScale` is an **Authored trial** and must be fitted against a
supersampled radiance reference. The result may widen to roughness 1; it is not
clamped back to the authored identity interval.

The height-derived normal is not differentiated again. That would be a
derivative-of-derivative estimator with poor quad behavior, and differentiating
the full final normal would also count geometry already handled by Three.js
r185 `getRoughness()`. A texture-normal implementation must additionally retain
the unnormalized mip normal mean and its variance, and filter clearcoat normals
independently when present.

This fixture leaves `clearcoatNormalNode` unset, so r185 uses `normalView` for
the base and coat lobes; the same removed material slope variance widens both
roughness values. A distinct clearcoat normal requires its own variance path.

## Dataflow

```text
seed + stable object/world/UV coordinates
  -> shared macro/grain/ridge/cavity fields
  -> identity and causal masks
  -> footprint-filtered meter height + removed material slope variance
  -> color / roughness / metalness / coat / normal / opacity / emissive slots
  -> app-owned RenderPipeline, bloom, tone mapping, output transform
```

No compute dispatch is mandatory for these analytic materials.
`initializeProceduralPbrMaterialData()` dispatches only caller-supplied
generated-data kernels, rejects non-WebGPU backends, and restores the prior
render target.

## Texture Projection and Accounting

The `atlas-array-and-triplanar` route executes three distinct live paths:

- the atlas has five manually authored mip levels; each tile mip is generated
  independently and its filter-support gutter is filled by nearest-interior
  extrusion before atlas assembly;
- the array is one `DataArrayTexture` binding with four distinct sRGB layers,
  selected per instance by `instanceTextureLayer`;
- the triplanar fixture invokes r185 `triplanarTexture()` and records three
  filtered operations for its one color texture.

The `instanced-dissolve` and `shadow-parity` routes use one material graph and
one instance attribute pair. `maskNode` and `maskShadowNode` reference the same
TSL node. The renderer owns an enabled directional shadow depth target; the
instanced objects cast and the ground plane receives. This is runtime graph
construction, not accepted shadow-atlas parity evidence until captured depth
and image metrics exist.

Three.js r185 `triplanarTexture()` executes three filtered texture operations
per input texture. Color plus one packed data texture therefore adds six
operations; adding a triplanar normal texture raises that to nine before any
other material textures. Count both bound sampled textures/samplers and
executed texture operations. Atlas gutters must satisfy the filter radius at
every mip; transform explicit gradients by tile scale. Do not use triplanar
normal maps without reorienting each projection before blending.

The WebGPU default limits are 16 sampled textures and 16 samplers per shader
stage, but the material owns only the residual after renderer/shared bindings.
Treat `<=8` added filtered operations as an **Authored mobile trial point**, not
an acceptance gate; any path is accepted only from measured evidence.

## Performance Evidence

For every target and representative view distribution, record:

- binding ledger: sampled textures, samplers, storage resources, uniforms;
- operation ledger: procedural ALU/noise calls and executed texture operations;
- traffic estimate: covered fragments times bytes fetched/written, adjusted by
  measured cache behavior, overdraw, MSAA, and helper invocations;
- interleaved paired A/B GPU p50/p95 for the material delta, plus whole-frame
  GPU and CPU p50/p95;
- peak material memory including every mip level and generated-data lifetime;
- a sustained thermal run on mobile-class targets.

Do not add device-class milliseconds, atlas dimensions, or MiB ceilings to the
material contract. Derive product limits from the whole-frame budget and
measured marginal cost. Post-processing is a separate pipeline ledger; it must
not be charged as a hidden material pass or trigger a second scene render.

## Debug Modes

`final`, `coordinates`, `identity`, `height`, `roughness`, `roughness-aa`,
`normal-variance`, `metalness`, `clearcoat`, `dissolve`, `emission`,
`triplanar-weights`, and `cause-map` are available through
`setProceduralPbrDebugMode()`.

Acceptance views must include identity masks, height, base and filtered
roughness, detail variance, metalness, coat, raw HDR emission, dissolve/shadow
agreement, and the final image. One final beauty image is insufficient.

The browser controller implements the complete schema-v2 interface and rejects
unknown scenarios, modes, tiers, cameras, and seeds. Tier DPR caps are reapplied
on every resize. `capturePixels()` uses the shared 256-byte-aligned WebGPU
readback contract. `npm run capture` delegates to the repository capture
runner and writes only `evidence-manifest.incomplete.json`; it cannot promote
the lab to accepted status.

## Minimal Usage

```js
const gold = createAntiqueGoldPbrMaterial({
  seed: 23,
  sceneUnitsPerMeter: 1,
  specularVarianceScale: 1, // Authored trial; calibrate against reference
});
mesh.material = gold;

const lava = createLavaEmissivePbrMaterial({
  causeMap: lavaMaps.a,
  sceneUnitsPerMeter: 1,
});
```

Run structural and asset validation with:

```sh
npm --prefix threejs-procedural-materials/examples/tsl-procedural-pbr run check
npm --prefix threejs-procedural-materials/examples/tsl-procedural-pbr run validate
```

Bloom, tone mapping, and output conversion belong to the app-level node
pipeline, not the material.
