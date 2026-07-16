# Receiver Weathering

Use this reference after the skill selects persistent snow/wetness, material
response, ripple normals, or splash presentation.

## Contents

- State ownership and accumulation
- Snow fields and object caps
- Wetness and puddles
- Ripple representation
- Splash orientation and visibility
- Three.js r185 materials and output
- Lifecycle and diagnostics

## State ownership and accumulation

Assign one owner to each receiver's liquid and snow inventories. A terrain,
water solver, application domain, or this weather system may own them; material
nodes consume a committed snapshot from that owner. For a non-water surface,
mass per area in `kg m^-2` is a useful authoritative representation:

```text
d m_liquid / dt = rain + runup + melt
                  - drainage - infiltration - evaporation - exportedRunoff
d m_snow / dt   = snowfall + refreeze
                  - melt - sublimation - transport - inundationWash
```

Every term has units `kg m^-2 s^-1`, a sign, support, cadence, producer, and
valid interval. Clamp only at a declared capacity/positivity boundary and
report rejected or exported mass. Integrate the complete elapsed interval when
the receiver runs more slowly than airborne precipitation.

Derive display quantities from the conserved inventory:

```text
waterEquivalentDepth = m_snow / rho_water
geometricSnowHeight  = m_snow / rho_bulkSnow
wetnessCoverage      = receiverModel(m_liquid, capacity, age, material)
```

Water equivalent, geometric height, and display coverage are derived views,
not separately integrated copies. A water solver may instead own depth or
volume; declare its density and derive mass consistently.

Receiver integration is complete when the term-by-term mass balance closes
within tolerance and water, weather, and material code all consume the same
committed owner revision.

## Snow fields and object caps

Use one snow height field `h` for coverage, displacement, normal
reconstruction, material blend, and diagnostic contours. On a horizontal
tangent chart,

```text
n_snow = normalize((-dh/dx, 1, -dh/dz))
```

Evaluate derivatives analytically or from the same sampled field and filtering
used by displacement. A separately authored normal texture creates lighting
that detaches from the silhouette.

For object snow, evaluate coverage in stable model coordinates so animation
does not make the cap slide. Transform the support normal to world space and
gate it against the local up direction:

```text
upHat   = -normalize(gravityWorld)
topMask = smoothstep(flatThreshold, 1,
                     saturate(dot(worldNormal, upHat)))
coverage = topMask * modelSpaceCoverage(modelPosition)
```

Planetary or local-gravity scenes provide `gravityWorld` per sample. Convert
world snow thickness to the object's displacement units, and displace along
the host surface normal. A physically claimed accumulation model also includes
exposure/occlusion, adhesion/slope, transport or melt, and capacity; the
up-normal gate alone is a stylized cap.

Snow projection is complete when height and normal diagnostics share the same
field/sample/filter, the cap remains fixed under object animation, and vertical
or sheltered surfaces follow the declared support policy.

## Wetness and puddles

Project committed liquid state in this order:

1. early wetness changes absorption/base color and roughness;
2. puddle eligibility/capacity selects low or retained areas;
3. committed fill selects the visible puddle amount;
4. heavy-rain impacts enable ripple normals and splashes.

Keep dry material identity intact. Wet dielectric layering changes absorption,
roughness, clearcoat/IOR, and normal response; metalness remains the dry
material's property. Use one wetness/puddle mask for material response, ripple
eligibility, splash intensity, and mask diagnostics so those observables cannot
drift.

Define the mask in a declared stable world, terrain-chart, or decal space with
an explicit UV origin and texel-center convention. Use receiver state for
actual fill; procedural low-area noise supplies eligibility rather than a
second liquid inventory.

Wetness projection is complete when the wet material response remains visible
with ripple and splash branches disabled, and identical committed receiver
state produces identical masks independent of camera and particle density.

## Ripple representation

Choose representation by the requested interaction and projected frequency:

- **Dynamic field:** derive rings from stable impact events for hero puddles or
  interactive closeups. Bound the support and update only active tiles.
- **Prefiltered normal field:** use a generic tiling/animated data texture for
  broad stylized wet surfaces where individual impact causality is not visible.
- **Disabled:** retain wetness and puddle response without ripple normals.

A dynamic ring is a bounded surface-response approximation, not a water
solver. Its centre, start time, radius/speed, decay, and receiver tangent frame
come from the impact. Filter derivatives before converting them to a normal,
and stop evaluating bands above pixel Nyquist or below visible contrast.

Treat ripple normals as data with stable filtering. Compute-written textures
need explicit mip ownership; pregenerated fields need a declared tiling and mip
policy. Blend ripple normals only after the wetness gate, in the same tangent
frame as the base normal.

Ripple projection is complete when the disabled branch preserves wetness,
dynamic rings remain fixed to their receiver under camera motion, and the
prefiltered branch has stable frequency and normal interpretation across mip
levels.

## Splash orientation and visibility

Store a bounded splash/event pool with only fields consumed by presentation:

- world impact position and stable receiver/event identity;
- world normal or a complete tangent frame;
- start time, progress/lifetime, atlas/variant, and opacity;
- visibility/occlusion state when the selected policy requires it.

Generate candidates from physical impacts or reference them as visual events;
one event path deposits the mass. Weight or gate candidates with
`dot(worldNormal, upHat)` using normals transformed by the normal matrix.
Reject downward-facing or unsupported surfaces. Add depth, receiver ID, or
acceleration-structure visibility when residue hidden beneath geometry would
be visible as an error.

Orient the splash around its world-space receiver normal or declared tangent
frame. Camera-facing rotation may occur around that support axis, preserving
contact with sloped and transformed receivers. Animate progress in the node
material or GPU storage instead of rewriting one object transform per splash.

Splash presentation is complete when rotating/scaling the receiver preserves
contact and orientation, hidden/downward mutation cases produce no visible
splash, and event-pool overflow is counted rather than silently reassigned.

## Three.js r185 materials and output

Use `MeshStandardNodeMaterial` for the standard PBR response and
`MeshPhysicalNodeMaterial` when clearcoat, IOR, or layered specular controls
are visible. Assign node slots directly:

```js
import { MeshPhysicalNodeMaterial, RenderPipeline } from 'three/webgpu';
import { pass, renderOutput } from 'three/tsl';

const material = new MeshPhysicalNodeMaterial({ metalness: dryMetalness });
material.colorNode = wetColorNode;
material.roughnessNode = wetRoughnessNode;
material.normalNode = combinedNormalNode;
material.opacityNode = opacityNode;
```

Render rain/snow/splashes through an instanced node material appropriate to the
geometry. Keep one draw per compatible visible page/family rather than one
object per drop. Use one `RenderPipeline` for presentation:

```js
const pipeline = new RenderPipeline(renderer);
const scenePass = pass(scene, camera);
pipeline.outputColorTransform = false;
pipeline.outputNode = renderOutput(scenePass);
pipeline.needsUpdate = true;
```

For pipeline-owned conversion, assign `scenePass` directly and set
`outputColorTransform = true`. Every change to `pipeline.outputNode` or
conversion ownership, including restoring either, sets
`pipeline.needsUpdate = true`.

Use MRT only when later nodes reuse the same scene pass's depth, normal,
velocity, or weather mask. Set reduced node-post resolution with
`PassNode.setResolutionScale()`.

Color interpretation is part of correctness:

- encoded LDR base-color textures use `SRGBColorSpace`;
- normal, roughness, AO, mask, noise, LUT, ripple, and receiver fields use
  `NoColorSpace` or equivalent linear data treatment;
- HDR/radiance buffers remain linear, normally half-float, until presentation;
- choose one conversion owner: enabled `outputColorTransform`, or explicit
  `renderOutput()` with `outputColorTransform = false`.

Presentation is complete when data probes preserve authored values and a
single neutral-gray/color-bar control confirms one display transform.

## Lifecycle and diagnostics

On receiver extent or resolution changes, allocate a new field generation,
initialize its inventory by an explicit conservative remap or reset, then
retire the previous generation after its consumers finish. Reset world-space
or receiver ripple/splash event state only for discontinuous time, receiver
support, stable identity, or event-model changes. Camera-projection or
viewport-extent changes preserve committed impacts and events; reset only view
temporal/reprojection history and recreate size-dependent targets. Keep
committed receiver inventory unless the receiver contract itself resets.
Dispose all owned textures, storage/event buffers, materials, and post nodes.

Expose these views:

| View | Required evidence |
| --- | --- |
| `receiver` | Owner/revision, liquid and snow inventories, each source/sink term, residual |
| `snow-height` / `snow-normal` | Same field identity, support, filter, and sample time |
| `wetness` / `puddle` | Committed receiver revision and mask coordinate space |
| `ripple` | Disabled/dynamic/prefiltered branch, impacts or texture/filter policy |
| `splash` | Event ID, world frame, support normal, visibility result, overflow |
| `data-color` | Texture color-space interpretation and sampled values |
| `final` | One HDR/tone-map/output owner and weather-on/off comparison |
