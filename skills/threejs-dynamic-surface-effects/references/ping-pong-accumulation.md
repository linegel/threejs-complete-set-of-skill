# Persistent Screen-Surface State

Branch reference for viewport-locked accumulation, blur, and refraction in
Three.js r185 WebGPU/TSL. Load only the sections selected by `SKILL.md`.

## Contents

- [Update topologies](#update-topologies)
- [dt-correct history](#dt-correct-history)
- [Resources and r185 execution](#resources-and-r185-execution)
- [External appearance signals](#external-appearance-signals)
- [Composite and refraction](#composite-and-refraction)
- [Resize, reset, and disposal](#resize-reset-and-disposal)
- [Resource accounting](#resource-accounting)
- [Diagnostics and failure signatures](#diagnostics-and-failure-signatures)

## Update Topologies

### Full field

Use full-field ping-pong when decay, diffusion, or forcing changes most texels.
Every dispatch reads the previous generation and writes the complete next
generation. The selected extent is the lowest one whose reconstructed edge,
gesture, and refraction error passes at the target view.

### Sparse tiles

Use dirty rectangles or tiles when deposits are sparse and untouched texels are
invariant. For tile `t`, let `P_t` be processed pixels and `E_t` its overlapping
event list:

```text
event binning K = sum_events tiles(event)
tile evaluation = sum_t(P_t * E_t)
```

Worst-case overlap remains `O(P*E)`. Record `K`, mean/p95/max list occupancy,
and overflow. Bound or split lists, compact them, or rasterize one aggregate
deposit field when overlap makes per-event evaluation more expensive.

If untouched state decays, store `lastUpdateTime` and analytically catch up on
every visible/filter sample, or materialize every visible tile before it is
sampled. Catching up only on the next touch leaves old visible tiles stale.

### Diffusion

Diffusion couples neighbors, so use a global step or halo-expanded active
domain. For explicit Euler:

```text
rX = D * dt / dx^2
rY = D * dt / dy^2
next = center
     + rX * (left - 2*center + right)
     + rY * (down - 2*center + up)
require rX + rY <= 1/2
```

State the units/domain of `D`, `dx`, and `dy`. On an isotropic grid the bound is
`D*dt/dx^2 <= 1/4`. Substep or choose an implicit/closed-form filter when the
declared diffusion exceeds it. Halo width must cover the stencil for every
substep.

### Idle

Dispatch nothing only when both inputs and the represented state are unchanged.
A globally decaying texture is not idle unless the effect clock is frozen or
decay is represented lazily and applied before every sample. Preserve the last
committed history generation until the next valid transition.

## dt-Correct History

For dimensionless channel state `x`, brush coverage `b in [0,1]`, decay
survival per second `s in (0,1]`, and saturating deposit fraction per second
`d in [0,1)`:

```text
lambda = -log(s)
r = -log(1 - d)
a = lambda + r*b

if a > 0:
  xEq = r*b/a
  xNext = xEq + (x - xEq)*exp(-a*dt)
else:
  xNext = x
```

This exactly integrates `dx/dt = -lambda*x + r*b*(1-x)` for constant coverage
over the interval. Use a smoother/noise-reduced `b` for a tilt/refraction
channel than for the visible edge when those roles differ.

Consume timestamped pointer segments `p0,t0 -> p1,t1` and rasterize their
aspect-corrected swept capsule. Derive aspect from the history extent. Include
pressure endpoints and edge policy. Subdivide when spatial coverage or pressure
variation exceeds the error gate.

If input supplies integrated pressure `I = integral p(t)dt`, form the interval
average `pBar = I/dt`; do not multiply the integrated value by `dt` again. An
endpoint stamp per rendered frame changes coverage with frame rate.

Derive `dt` from two ordered samples on one clock. Equal samples mean `dt=0`.
For a missing previous sample, reversal, seek, invalid mapping, or suspension,
select one policy:

- freeze the effect clock;
- reset the affected history;
- analytically catch up closed-form decay/deposition;
- run bounded substeps and retain explicit debt when the bound is reached.

A delta clamp that discards elapsed evolution is a different model and must be
named as such.

## Resources and r185 Execution

Initialize before storage allocation:

```js
import { RenderPipeline, StorageTexture, WebGPURenderer } from 'three/webgpu';
import { Fn, pass, renderOutput, storageTexture, textureStore } from 'three/tsl';

const renderer = new WebGPURenderer({ antialias: false });
await renderer.init();
if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error('WebGPU is required for this dynamic-surface path.');
}
```

Own these resources explicitly:

| Resource | Lifetime/domain | Purpose |
| --- | --- | --- |
| History A/B | persistent data, `NoColorSpace` | previous/next visible and tilt state |
| Scene color | per frame, linear HDR | one source scene pass |
| Vertical/horizontal blur | per frame when active, linear HDR | separable broad response |
| Static fields | startup or extent/quality change, data | crystalline/noise structure |
| Composite | per frame, linear HDR | history-gated appearance/refraction |

Choose history precision and extent from quantization, decay, edge, memory, and
filtering evidence. Before using `RG8`, `RGBA8`, `RG16F`, or another compact
format, verify storage writes, sampling/filtering, and 30/60/120 Hz stability on
the target adapter. Use `HalfFloatType` where accumulated precision requires it.

Keep interface conversions explicit:

| Interface | Rule |
| --- | --- |
| Pointer NDC | Convert `[-1,1]` to history UV with the named Y convention. |
| Storage texel | Address texel centers in the selected history extent. |
| Drawing buffer | Derive display storage from physical pixels after DPR, then apply the selected history scale. |
| CSS size and DPR | Use as resize metadata, not hidden shader-space factors. |
| Screen period | Name `mainScreenPeriod`/`detailScreenPeriod` as periods, never texture dimensions. |
| Transform scope | Viewport transforms may preserve screen history; route world/object paint elsewhere. |

Declare either a linear dispatch:

```text
.compute(width * height, [workgroupSize]) with instanceIndex
```

or explicit 2D workgroups:

```text
.compute([ceil(width/wx), ceil(height/wy), 1], [wx, wy, 1])
with globalId.xy and extent guards
```

Create the update with `Fn()`, sample the read texture through
`storageTexture()`, and write the other texture with `textureStore()`. Enqueue
through `renderer.compute()`. In r185 `computeAsync()` awaits initialization
and then calls compute; it is not a GPU-completion fence.

Within one queue submission, dispatch/pass order publishes the next generation
before its consumers. Swap logical read/write roles only after scheduling that
write in the owning order. A resource is never bound for read and write in the
same transition. Across frames in flight or multiple outputs, retain each
generation until every consuming GPU submission completes.

Use `PassNode.getPreviousTextureNode()` only for feedback naturally owned by a
node pass. Use storage textures when events or compute directly write the
history. Use `PassNode.setResolutionScale()` or an equivalent pass-owned extent
for reduced blur.

Graph order:

```text
history update when active
  -> current history publication
  -> pass(scene, camera) once
  -> optional vertical blur
  -> optional horizontal blur
  -> composite/refraction
  -> RenderPipeline.outputNode
```

When the output node, diagnostic branch, format/extent, or quality topology
changes, invalidate/rebuild the affected render-pipeline graph before render.
The node pipeline owns presentation; a second renderer presentation call would
repeat the scene or output transform.

The default graph updates history before the composite so current-frame input
is visible immediately. An intentional one-frame-delay branch samples the
previous generation first and schedules the update afterward; label both
generations in diagnostics so the delay cannot masquerade as stale ordering.

## External Appearance Signals

Keep external physical appearance and local UI history in separate inputs. An
external signal arrives with:

```text
quantity and units
frame/origin and projection mapping
previous/current sample times or interval
support and filter
producer, state version, and resource generation
validity, staleness, and typed error
GPU dependency/completion
```

Project only compatible, valid samples. Missing channels remain absent and
follow the declared decorative fallback or suppress the claim. A pointer-clear
overlay may change the displayed appearance without mutating or subtracting
the externally owned temperature, phase, loading, wetness, contact, or weather
quantity.

Reset, remap, or reproject history when frame/origin, transform, projection,
clock mapping, prior-sample identity, resource generation, support, or
representation becomes incompatible. A continuous source-state version advance
is sampled normally. Render-quality changes alter presentation resources only.

Screen UV has no metric world meaning. Route world/object paint and physical
touch/deposition to their owning systems, then consume their immutable result.
The dynamic-surface path performs no physical writeback.

## Composite and Refraction

### Separable blur

Use vertical then horizontal blur at the same pass-owned reduced extent. Select
the extent from projected edge/blur-radius error and measured traffic. When
alpha participates, normalize RGB and alpha separately:

```text
rgbWeighted += sample.rgb * sample.a * weight
rgbWeight += sample.a * weight
alphaWeighted += sample.a * weight
alphaWeight += weight

rgb = rgbWeight > epsilon ? rgbWeighted/rgbWeight : vec3(0)
alpha = alphaWeighted/max(alphaWeight, epsilon)
```

### Static structure and composite

Generate static crystalline/noise fields once. Define their wrap, filtering,
mip use, extent dependency, and `NoColorSpace` domain. A generic history-gated
composite is:

```text
clearAmount = 1 - history.R
tiltAmount = history.A
structure = combine(static fields, authored weights)
frostMask = shape(structure, clearAmount)
blurMix = gate(frostMask, clearAmount)
surface = mix(sharpScene, blurredScene, blurMix)
surface = applyLinearTintAndRoughness(surface, frostMask)
```

Keep structural coverage distinct from the interaction clear mask so
refraction can require both material presence and uncleared history.

### Two-scale refraction

Sample main and detail normals in screen coordinates with an explicit repeat or
mirrored-repeat policy. Name uniforms as `mainScreenPeriod` and
`detailScreenPeriod`; derive texel dimensions from the textures. Let the main
field provide broad offset and optional height weighting, and let the detail
field add bounded high-frequency offset.

Gate the combined offset by structural coverage and inverse clear history.
Define IOR/thickness as authored optical controls unless the whole renderer uses
a physical scale. Clamp offset samples inward by a declared source inset or
provide valid edge texels. Apply Fresnel as a linear-light factor before the
single final output conversion.

Scene color, blur, tint, saturation, and refraction remain linear/HDR. LDR color
assets use `SRGBColorSpace`; HDR radiance remains loader-declared linear; normal,
mask, noise, LUT, and history textures use `NoColorSpace`. Use one owner:
`RenderPipeline.outputColorTransform`, or an explicit terminal
`renderOutput()` when the pipeline transform is disabled.

## Resize, Reset, and Disposal

Choose one resize transition:

| Policy | Required action |
| --- | --- |
| Clear | allocate both new histories, initialize both identically, regenerate extent-dependent static fields |
| Remap | sample one committed old generation into both new histories with declared UV/filter semantics |
| Reproject | use compatible camera/depth mappings, reject disocclusions, then initialize both new histories |

Reset or reproject on seek/reversal, clock discontinuity, incompatible
frame/origin or projection, resource/device generation change, UV convention
change, representation change, or declared quality discontinuity. Clear both
slots together; one cleared slot produces stale history on the next swap.

Pause retains a committed generation. Resume first applies the suspension time
policy, then accepts new events. Idle means zero update dispatches; optional
blur/composite may also stop when the final image is cacheable.

Dispose both histories, blur intermediates, static generated textures,
compute/pipeline nodes, cached views, and input/resize listeners. Device loss
invalidates the old generation immediately; rebuild a fresh pair and graph
before presentation.

## Resource Accounting

| Work | Cost evidence |
| --- | --- |
| History memory | `2 * width * height * bytesPerTexel`; full-res RGBA16F is about 31.6 MiB at 1920x1080 before alignment |
| Full update | active texels, workgroups, reads/writes, format bytes |
| Sparse update | event binning `K`, dirty tiles, list occupancy/overflow, processed texels |
| Blur | both extents, kernel samples, reads/writes, peak-live intermediates |
| Composite/refraction | display pixels, static/history/scene samples, output write |
| Pass graph | one scene pass; state update when active; two blur passes only when selected; one final composite/output |

Record event count, active/dirty texels, tile occupancy, bytes read/written,
peak-live bytes, workgroup shape, dispatch timing, paired marginal cost, and
whole-frame p50/p95 on the named target. Start scaling by eliminating invalid
idle work, then compare full versus sparse topology, then reduce history/blur
extent or precision under state and image error gates.

## Diagnostics and Failure Signatures

Expose applicable views:

```text
previous history R/A
current swept deposit R/A
next history R/A
dirty tiles and event-list occupancy
scene color
vertical and horizontal blur
each static structure field
mask before and after local history
main and detail refraction offsets
final without refraction
final
```

| Symptom | Cause to falsify |
| --- | --- |
| Different history at 30/60/120 Hz | frame-count decay/deposition, endpoint stamping, or interval double-application |
| Old visible sparse tiles | catch-up applied only when touched |
| Seams around active diffusion tiles | missing halo or unstable substep |
| Same-UV smear under camera change | history survived incompatible projection/mapping |
| Alternating stale frames | read/write alias or only one slot reset |
| Clamped refraction edges | missing repeat/inset/edge policy |
| Washed or dark display | duplicate or missing output conversion |
| GPU work while unchanged | idle transition still schedules update or blur |

Required controls:

- replay the same timestamped gesture at 30, 60, and 120 Hz;
- compare full-field and valid sparse results over the same events;
- hold input and verify equal convergence across timestep partitions;
- pause, seek, resume, resize, change quality, dispose, and recreate;
- force high event overlap and check tile overflow behavior;
- toggle blur/refraction and inspect the causal intermediate;
- verify one scene render, one output conversion, and zero steady-path readback;
- invalidate an external signal and confirm the declared decorative result.

Report PASS, FAIL, or INSUFFICIENT for each selected transition. A nonblank
surface does not establish state, topology, time, lifecycle, graph, or output
correctness.
