---
name: threejs-procedural-materials
description: Procedural materials for coherent NodeMaterial PBR systems in Three.js WebGPU/TSL. Use when a task needs shared identities across PBR channels, must select UV, array, atlas, or projected mapping, needs footprint-filtered normals and specular AA, or needs dynamic per-instance material state with explicit output ownership.
---

# Procedural Materials

Build a cause graph, not a collection of channel effects:

```text
stable coordinates -> structural causes -> identity weights
  -> causal modifiers -> filtered microstructure
  -> NodeMaterial PBR slots -> final-image owner
```

Use `MeshStandardNodeMaterial` for standard opaque/emissive PBR and
`MeshPhysicalNodeMaterial` only when its extra lobes or transport properties are
part of the surface. Keep Three.js lighting, environment, shadows, and energy
handling by assigning node slots instead of replacing the whole fragment output.

For multi-system scenes, `$threejs-choose-skills` is an optional coordinator.
Fields own shared scalar/vector causes, geometry owns silhouettes, water owns
surface/transport, and the final-image pipeline owns tone mapping and display
conversion. Consume each dynamic or cross-system cause with declared units,
coordinate/frame convention, producer and consumer owners, revision,
spatial/temporal support and filter, validity domain, error bound, update
cadence, and staleness rule. A visual material state does not become another
simulation owner.

Initialize and gate the renderer before allocating storage, dispatching
compute-written cause maps, or compiling storage-backed material branches:

```js
await renderer.init();
if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error('Native WebGPU is required for procedural material GPU branches.');
}
const { features, limits } = renderer.backend.device;
```

Select sampled/storage bindings, writable formats, and filtering from those
initialized features and limits.

## 1. Freeze coordinates, causes, and identities

Choose UV, object, world, radial, or generated-texture space from the physical
or authored cause. Record scale in meters or declared art units. Mixing spaces
is valid only for distinct causes, such as world-height wetness over object-space
grain.

Define normalized material identity weights and a response bundle per identity:

```text
linear base reflectance
roughness alpha and metal/dielectric endpoint
resolved height/normal spectrum plus removed variance
causal modifiers such as wetness, wear, heat, or coverage
semantic/material ID and diagnostic color
```

All channels use the same filtered weights. Hard semantic eligibility remains
separate from visible blend width. Blend `alpha=roughness^2`, then recover
roughness with `sqrt(alpha)` when one GGX lobe approximates a subpixel mixture.

When terrain or seabed is involved, read
[substrate and water ownership](references/procedural-pbr-system.md#substrate-and-water-ownership)
before wiring coast distance, wetness, shallow-water, foam, or caustics.

This step is complete when every PBR channel traces to named causes and identity
weights in one coordinate/scale contract, with a hard semantic fallback for any
zero-weight region.

## 2. Select the mapping from defect and cost

Choose in this order:

1. UVs when seams and texel-density distortion pass.
2. Texture arrays when layers share dimensions, format, mips, color semantics,
   and sampler policy.
3. Atlas when array constraints fail and mip-safe gutters are owned.
4. One-/two-axis projection for a dominant direction or top/side split.
5. Triplanar only when no cheaper parameterization preserves scale.
6. Stochastic tiling only when repetition, rather than parameterization, is the
   observed defect.

Count bindings and executed samples separately. Installed r185
`triplanarTexture()` performs three projected samples per bound texture and
uses absolute-normal weights; it does not reorient tangent-space normals or
provide stochastic tiling. Arrays/atlases reduce bindings, not sample count.

Read
[mapping and filtering](references/procedural-pbr-system.md#mapping-atlas-and-projection)
before using an atlas, texture array, triplanar mapping, or stochastic tiling.

This step is complete when the selected mapping solves the observed defect,
every texture's color/data semantics and mip policy are explicit, and compiled
binding/sample counts fit the target pipeline with measured value for added taps.

## 3. Wire shared causes into NodeMaterial slots

Own only the slots required by the material:

```text
colorNode             linear identity color and causal shifts
roughnessNode         identity alpha plus filtered modifiers
metalnessNode         conductor/dielectric identity
normalNode            normalMap, texture bump, or shared-height gradient
aoNode                local cavity/contact term
opacity/mask/alphaTest cutout or dissolve
emissiveNode          actual scene-linear emitted radiance
positionNode          visible local displacement
castShadowPositionNode matching caster displacement
castShadow/maskShadow matching cutout or dissolve
```

In r185, `receivedShadowPositionNode` is a separate world-space receiver
override; leave it unset unless that replacement is explicitly derived and
validated. Visible and caster displacement share one local-space cause. Emission
feeds the HDR material result; bloom and tone mapping remain downstream owners.

Data textures use `NoColorSpace`; authored color textures use
`SRGBColorSpace`; scene-linear generated color remains linear. Keep one tone-map
and output-conversion owner through `RenderPipeline.outputColorTransform` or one
`renderOutput()`.

This step is complete when every owned slot has one cause, visible/shadow masks
and displacement agree, color/data encodings are correct, and no material node
duplicates final output conversion.

## 4. Filter microstructure and specular response

Filter height/normal bands before perturbing the normal. Fragment surface
gradients run in derivative-uniform control flow; vertex/compute displacement
uses analytic or stored gradients. Preserve normal mean plus variance across
mips instead of normalizing the mean and discarding its length.

Three.js r185 already adds geometric-normal variation in `getRoughness()`.
Custom specular AA adds only unresolved material-detail variance. Read
[derivative normals and specular AA](references/procedural-pbr-system.md#derivative-normals-and-specular-aa)
before adding procedural bump, custom normal filtering, or roughness variance.

This step is complete when all retained bands pass the projected footprint,
removed slope/normal variance is accounted for exactly once, and a no-post
close/mid/far comparison rejects distance-dependent sharpening and grazing
sparkle.

## 5. Own dynamic and per-instance state

One material graph serves a batch. Static instance variation uses attributes;
hot GPU-owned variation uses storage-backed instance data only when its measured
update/access pattern wins. Dissolve, wetness, variant, or lifetime fields drive
visible and shadow masks from the same stable object/world cause.

Cause maps use the procedural-fields direct-versus-bake gate. Static maps build
once; dynamic maps update at their owner cadence and invalidate dependent mips.
Compute submission precedes the consuming render. In r185, `computeAsync()` is
not a GPU-completion fence.

State generations remain immutable while referenced by a frame. Resize,
material identity changes, coordinate changes, map encoding changes, and device
loss invalidate their dependent history, bindings, and diagnostics. Every
material, texture, storage resource, and generated variant has a disposal owner.

This step is complete when one owner advances each dynamic cause, each instance
record has stable identity and reset behavior, and no per-object material clone
or frame-critical CPU readback is needed.

## 6. Diagnose and verify

Expose coordinate mode/scale, identity weights and fallback, each structural
cause, mapping weights/mip/gutter, binding and sample counts, roughness before
and after AA, normal mean/variance, visible/caster parity, raw emission,
no-post beauty, and final post result.

Verify close/mid/far and motion views; conductor/dielectric endpoints; atlas
gutters under selected filtering; compiled stage limits; color-space flags;
stable instance/shadow behavior; and target whole-frame timing/bytes when
performance is claimed.

This step is complete when every PBR identity, mapping branch, filtered-normal
branch, dynamic state, shadow path, color conversion, resource lifetime, and
claimed target budget has direct diagnostic evidence.

## Completion

The material system is complete when one shared cause/identity graph feeds all
owned PBR slots; mapping and filtering decisions are evidence-backed; material
detail is stable across footprint and motion; dynamic state has one owner and
reset path; and raw material output, shadows, post, and resource lifetimes agree.
