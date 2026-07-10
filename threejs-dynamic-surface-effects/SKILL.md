---
name: threejs-dynamic-surface-effects
description: Build dynamic screen-space surface effects in Three.js r185 WebGPU/TSL. Use for StorageTexture touch-history ping-pong, dt-correct frost/thaw masks, reduced-resolution node blur, static crystalline structure targets, and two-scale TSL normal refraction.
---

# Dynamic Surface Effects

Use this skill for screen-space surface effects whose visible mask, thaw/clear
state, or refractive response depends on persistent history. The only taught
implementation path is pinned Three.js r185 with `WebGPURenderer`, TSL,
`NodeMaterial`, `RenderPipeline`, `pass()`, storage textures, and compute.

Run `$threejs-choose-skills` before implementation when the request could also
involve world-space residue, weather accumulation, object paint, water, or a
larger post stack.

## Presentation-Only Physics Boundary

Read the shared
[physics domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md)
before showing state owned by a thermal, weather, contact, or surface solver.
This skill remains a presentation consumer: its screen-UV R/A history is not
authoritative temperature `[K]`, phase or coverage fraction, frost/ice loading
`[kg m^-2]`, wetness, traction, heat flux, precipitation, contact, or weather
state. Screen UV has no physics-frame measure.

Physics-driven frost may consume read-only signal channels described by
`PhysicsSignalDescriptor`: dimensionless coverage/phase fraction, temperature
in kelvin, and optional areal frost/ice loading, all reached through one sealed
`PhysicsPresentationSnapshot` and its exact candidate/camera/view-preparation
references. Resolve the candidate's `PresentedStatePair`; its previous and
current states have independent `PresentationSampleProvenance`. Use that
provenance and the associated
`PhysicsSignalDescriptor` footprint/filter, source clock and mapped
`PhysicsInstant`, state version, validity, and typed per-channel error. Missing
or invalid channels are
absent—not zero—and the effect either follows its declared decorative policy
or does not render the physical claim.

Keep physical appearance and UI history as separate inputs. A local pointer
mask must not subtract physical frost/ice coverage or loading unless the owner
has published the corresponding updated state. If it does, label the result a
decorative interaction overlay rather than simulated thaw.

Pointer history is UI input. If scraping, touch, deposition, or heat transfer
must change physical state, input/interaction routing sends a typed
`InteractionRecord` to the owning solver; this skill later consumes the
solver-published snapshot. It emits neither `InteractionRecord` nor
`SurfaceExchange`, and it never reads screen history back to fabricate physical
state. `NodeMaterial` frost tint, IOR, normals, and roughness are visual state,
not a `PhysicsMaterialId` or properties in `PhysicsMaterialRegistry`.

Advance visual history from the per-view
`CameraViewPublication.previousRenderSampleInstant` and
`currentRenderSampleInstant`. When current is later than previous, validate and
form their half-open `PhysicsTimeInterval` before deriving seconds through the
versioned clock mapping. Equal instants mean no elapsed interval; never invent a
zero-length `PhysicsTimeInterval`. Never derive `dt` from one timestamp or
subtract unrelated clock seconds. On seek, reversal, clock discontinuity,
invalid mapping, or missing previous instant, execute the declared scoped
reset/freeze/catch-up policy. This presentation interval is not a solver fixed
step. Reset, remap, or reproject only through the resolved
`ViewPreparationPublication.resetDependencies` when
`PhysicsContext.contextVersion`/`worldTransformRevision`, descriptor
`transformRevision`/`physicsOriginEpoch`, the camera publication's
render-origin/transform/projection state, candidate-pair provenance or lease
`resourceGeneration`, a discontinuous
`ReactivePublication.sourceVersion`, render mapping/projection, validity, or a
declared `QualityTransition` makes the history incompatible. An ordinary
`stateVersion` advance is sampled; it is not itself a reset.
A render-quality change cannot alter or rewrite the source physics signal.

## Choose The State Update First

The history representation follows the state transition, not the visual theme:

| Workload | Required path | Reject |
| --- | --- | --- |
| Global decay/diffusion changes most texels every step | Full-field ping-pong compute at the lowest history resolution that passes edge tests | Dirty rectangles that leave untouched texels at the wrong age |
| Deposits are sparse and untouched texels are invariant | Event bounding boxes or dirty tiles; dispatch only covered tiles | A full-screen dispatch for one small mark |
| Many events overlap | Bin events into screen tiles, prefix/compact bounded tile lists, then process dirty tiles or rasterize an aggregate deposit field | Claiming `O(pixels + events)` when overlap still costs `sum(P_t * E_t)` |
| The effect is fixed for long intervals | Bake the static structure once and stop history dispatches while idle | Paying a nominally disabled compute pass |

The full-field path is the canonical frost/thaw case when state must be
materialized every frame. A lazy-decay tile stores `lastUpdateTime` and applies
analytic catch-up on every visible/filter sample, not only on the next touch;
otherwise old visible tiles remain stale. Diffusion couples neighbours and
requires a global step or halo-expanded active domain—independent timestamped
tiles are not equivalent.

## Select Architecture From Update Topology

Build the high-throughput frame graph first. Do not start from a simple
per-frame visual mask and later "upgrade" to history.

```text
sealed PhysicsPresentationSnapshot
  -> resolve PhysicsPresentationCandidate bindings/leases
  -> resolve CameraViewPublication render interval/transforms
  -> resolve ViewPreparationPublication reactive/reset actions
  -> validate/project physical appearance channels ---------------------+
UI input events for this frame                                           |
  -> compute pointer deposit into next visual-history StorageTexture    |
  -> swap visual-history read/write ------------------------------------+
scene pass via pass(scene, camera)                                      |
  -> reduced-resolution vertical blur pass at a scale selected by edge/error gates
  -> reduced-resolution horizontal blur pass at the same measured scale
  -> static crystalline fields, generated once or loaded from assets
  -> full-resolution frost/thaw composite node <------------------------+
  -> two-scale TSL normal refraction node
  -> RenderPipeline output node with one output transform owner
```

History update comes before the frost composite so visible response can include
the current frame's input. If a product deliberately wants a one-frame delayed
feel, document that as a UX choice and keep the diagnostic contract identical.

When close-inspection error and target measurements require it, the top tier
uses a full-resolution RGBA `StorageTexture` ping-pong:

- `R`: accumulated visible touch/thaw mask.
- `A`: accumulated tilt/refraction response mask.
- `G/B`: optional duplicate or debug channels, never hidden state.

Use a declared dispatch shape: linear
`.compute(width * height, [64])` with `instanceIndex`, or explicit 2D
`.compute([gx, gy, 1], [wx, wy, 1])` with `globalId.xy` and extent guards.
In the latter, `[gx,gy,1]` is workgroup count. Enqueue through
`renderer.compute()`; `computeAsync()` only awaits renderer initialization in
r185 and is not a GPU-completion fence. Keep the path read-back-free. Use
`PassNode.getPreviousTextureNode()` only for temporal pass
feedback that is naturally owned by a node pass; use storage textures when the
history must be written from pointer/event data or compute.

## Capability Gate

Compute and storage are required for the full-quality path.

```js
import { WebGPURenderer, RenderPipeline, StorageTexture } from 'three/webgpu';
import { Fn, pass, storageTexture, textureStore } from 'three/tsl';

const renderer = new WebGPURenderer( { antialias: false } );
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error(
    'WebGPU is required for the canonical dynamic-surface path; route an explicit request for teaching fallback to threejs-compatibility-fallbacks.'
  );
}

// Native WebGPU tiers vary history resolution, format, event binning, blur,
// and refraction while preserving the same state transition.
```

Quality tiers:

| Tier | Required capability | History | Blur | Refraction | Intended use |
| --- | --- | --- | --- | --- | --- |
| Full | WebGPU backend with storage texture compute | full-res RGBA16F ping-pong when close inspection proves it necessary | highest measured scale required by edge/error gates | two-scale normals, height weighting, Fresnel/source inset | close inspection |
| Balanced | WebGPU backend with tighter budget | half-res history or RG8/RG16F after measurement | measured reduced scale | one full normals plus reduced detail | ordinary inspection distance |
| Budgeted | WebGPU backend with minimal storage budget | quarter-res RG8/RG16F or sparse updates | minimum scale that passes edge gates | tint plus single offset | small projected footprint or strict traffic budget |

If the user explicitly asks how to apply fallback when WebGPU is unavailable,
route that teaching to `../threejs-compatibility-fallbacks/` instead of adding
a non-WebGPU path here.

## Implementation Rules

- Treat both ping-pong slots as renderer-owned presentation resources. They are
  never registered as authoritative physics signals and have no physics
  readback path.
- Keep persistent history, scene color, and static structure textures separate.
- Record `eventCount`, dirty-tile count, texels dispatched, and the asymptotic
  update cost. A storage dispatch over the complete drawing buffer is not
  automatically efficient merely because it runs on the GPU.
- Integrate decay and saturating deposition together. For channel state `x`,
  brush coverage `b`, decay rate `lambda=-log(survivalPerSecond)`, and fill rate
  `r=-log(1-depositPerSecond)`, use
  `a=lambda+r*b`, `xEq=r*b/a`,
  `xNext=xEq+(x-xEq)*exp(-a*dt)` (with the zero-rate limit handled explicitly).
  Consume timestamped pointer segments and rasterize a swept capsule; one
  endpoint stamp per render frame is not frame-rate invariant. Suspension
  policy is explicit rather than silently clamping away elapsed state.
- Preserve separate visible-mask and tilt-response channels. The tilt channel
  should use smoother/noise-reduced deposit than the visible channel.
- Update history with aspect from the history texture dimensions, not from a
  reduced blur target.
- Use `HalfFloatType`/RGBA16F-equivalent history when accumulated precision
  needs it. Before selecting `RG8`, `RGBA8`, or another compact storage format,
  prove that the exact format is storage-writable and filterable on the target
  adapter and that quantization/decay remain stable at 30, 60, and 120 Hz.
- Optional diffusion must be stable and explicit: apply a small Laplacian term
  to the R/A history after decay/deposit only when the visible signature
  improves edge cohesion without same-UV smearing. Validate disabled diffusion
  and enabled diffusion at 30, 60, and 120 FPS.
- Use reduced-resolution separable blur with `PassNode.setResolutionScale()` or
  an equivalent node blur whose resolution scale is owned by the pass. Normalize
  alpha separately from RGB and guard zero-weight neighborhoods with an epsilon.
- Generate static crystalline fields once at startup or on resize/quality
  change. Asset/data textures are `NoColorSpace`, repeat or mirrored-repeat
  wrap as authored, and only generate mipmaps when the sampling path needs them.
- Build the final surface as TSL nodes feeding `RenderPipeline.outputNode`.
  Node materials for any helper meshes use the `NodeMaterial` family.
- Screen-period uniforms must be named as periods, not texture sizes. Derive
  real texel dimensions from texture metadata when needed.
- Define resize policy explicitly: clear, preserve by remapping, or preserve by
  reprojection. The default safe policy is to clear history and regenerate static
  structure textures.

## Color And Output

- Scene color entering the surface pipeline stays linear/HDR until the final
  output transform. Working buffers use `HalfFloatType` where precision matters.
- LDR color assets encoded as sRGB use `SRGBColorSpace`; HDR/EXR radiance
  remains loader-declared linear. Data textures, normal maps, masks, noise, and
  LUTs use `NoColorSpace`.
- The app has exactly one tone-map owner and one output conversion owner.
  Prefer `RenderPipeline.outputColorTransform = true`; if disabled, end the node
  graph with `renderOutput()`. Do not output-convert inside the effect.
- Frost tint, brightness, saturation, blur mix, and normal-refraction math are
  all linear-light operations before final output conversion.

## Performance Contract

Set budgets before tuning visuals:

| Work item | Accounted cost |
| --- | --- |
| Pass graph | one existing scene input, one state update when dirty/decaying, two separable blur passes only when enabled, one composite/refraction output |
| History storage | Derived: `2 * width * height * bytesPerTexel`; full-res RGBA16F is about 31.6 MiB at 1920x1080, before alignment |
| Static storage | exact sum of selected data textures; generate once and share by content hash |
| Dispatch | `ceil(activeWidth / wx) * ceil(activeHeight / wy)` workgroups; record active texels and measured workgroup choice |
| Draw calls | no extra scene redraws beyond the source pass |
| Bandwidth lower bound | bytes read + written by state, blur, and composite, including both ping-pong slots and any resolve/copy |

The subsystem ceiling is allocated by `$threejs-choose-skills` from the whole
frame; these rows are not permission to consume the entire mobile frame.
Start native low-power trials at reduced history scale, but select the scale
from projected feature error, peak-live memory, tile attachment behavior, and
sustained p50/p95 target timing—not a universal pixel count. Report
contemporaneous full-frame timing and paired marginal cost; raise
blur/refraction quality only after state update and reconstruction fit the
allocation.

## Diagnostics And Validation

Expose debug outputs for:

```text
scene color
vertical blur
horizontal blur
each static structure field
previous history R/A
current deposit R/A
next history R/A
frost mask before pointer application
frost mask after pointer application
sharp/blur mix
main refraction offset
detail refraction offset
final without refraction
final
```

Add pause and single-step controls. Validate:

- The same pointer path produces matching accumulated masks at 30, 60, and
  120 FPS.
- Resize follows the documented clear/preserve policy.
- Repeat or mirrored-repeat normal sampling is visible at boundaries.
- `RenderPipeline.render()` owns presentation when the node pipeline is active.
- Output screenshots are neither double-converted nor left in linear display
  space.
- Optional physical inputs reject stale, unsupported, invalid, or incompatible
  candidate-pair provenance; context, transform/origin, lease generation,
  per-view camera interval, view-preparation reactive source,
  render-mapping/projection, and quality discontinuities take the declared
  scoped reset/remap/reprojection path, and the snapshot resolves rather than
  copies those exact publications.
- The steady frame loop performs zero readbacks from presentation history and
  emits zero physical interaction, exchange, material, force, or contact state.

Interface anchors:

| Interface | Contract |
| --- | --- |
| Pointer NDC | Convert `[-1, 1]` input to history UV explicitly. |
| Texel center | Compute dispatches address storage texel centers, not CSS pixels. |
| Drawing-buffer size | Storage dimensions use physical drawing-buffer pixels after DPR. |
| CSS size / DPR | CSS size and DPR are metadata for resize policy, never hidden scale factors. |
| Screen period | `mainScreenPeriod` and `detailScreenPeriod` are screen periods, not texture dimensions. |
| UV origin | Name Y-up/Y-down assumptions before sampling history or normal maps. |

## Replaced Techniques

- Replaced time-only procedural masks with storage-backed history because
  accumulation is stateful and must survive visual noise changes.
- Replaced per-frame decay constants with exponential dt-correct survival so
  30/60/120 FPS behavior matches.
- Replaced full-resolution broad blur with reduced-resolution separable blur
  because it preserves the same broad frost feel at far lower bandwidth.
- Replaced single-scale offset refraction with two-scale TSL normal refraction
  using height-weighted detail, Fresnel/source inset, and mask gating because it
  gives better frozen-surface structure per sample.

## Routing Boundary

Use `$threejs-particles-trails-and-effects` for world- or object-space residue, particles, and
dissolves. Use `$threejs-rain-snow-and-wet-surfaces` for rain wetness, puddles,
snow accumulation, and weather-surface coupling. Use `$threejs-water-optics`
for physically bounded water refraction/ripples. Use `$threejs-image-pipeline`
when the work is mostly full-frame post ownership, tone mapping, bloom, GTAO, or
anti-aliasing.

This skill owns screen-space persistent surface history and its composite.
It does not own thermal phase, frost mass, wetness, friction, or physical
contact even when those signals drive the composite.

Legacy WebGL implementation (deprecated, do not extend): `examples/touch-history-frost/frost-surface-effect.js`.
