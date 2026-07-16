# Production image-pipeline reference

Use only the section named by the active branch in `SKILL.md`. Numeric claims
are either derived from the shown equation or require a measurement on the
named browser, GPU, physical resolution, and complete graph.

## Contents

- [Graph construction and signal formats](#graph-construction-and-signal-formats)
- [Temporal admission and resets](#temporal-admission-and-resets)
- [Color, alpha, and legal endings](#color-alpha-and-legal-endings)
- [Memory, timing, and adaptive resolution](#memory-timing-and-adaptive-resolution)
- [Diagnostics and failure signatures](#diagnostics-and-failure-signatures)

## Graph construction and signal formats

### r185 surface

The following shapes are verified against Three.js r185:

- `RenderPipeline.render()`, `outputNode`, `outputColorTransform`, and
  `needsUpdate`;
- `pass()`, `mrt()`, `PassNode.setMRT()`, `setResolutionScale()`,
  `getTextureNode()`, `getViewZNode()`, `getLinearDepthNode()`, and
  `compileAsync(renderer)`;
- `ao(depth, normalOrNull, camera)` and `GTAONode.resolutionScale`;
- `bloom(input)` and `BloomNode.setResolutionScale()`;
- `traa(beautyTexture, depth, velocity, camera)` and
  `TRAANode.setViewOffset()`;
- `renderOutput()` and TSL `toneMapping()`.

Configure all MRT outputs and request every texture node before
`scenePass.compileAsync(renderer)`. Compile the complete pipeline separately;
scene-pass compilation does not warm private fullscreen materials.

```js
import { HalfFloatType, RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { diffuseColor, emissive, mrt, normalView, output, pass, velocity } from 'three/tsl';

const renderer = new WebGPURenderer( {
  antialias: false,
  outputBufferType: HalfFloatType,
  trackTimestamp: true
} );
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'Native WebGPU is required.' );
}

const pipeline = new RenderPipeline( renderer );
const scenePass = pass( scene, camera );
const outputs = { output };
if ( needNormal ) outputs.normal = normalView;
if ( needSelectiveBloom ) outputs.emissive = emissive;
if ( temporalEnabled ) outputs.velocity = velocity;
if ( needBaseColor ) outputs.albedo = diffuseColor.rgb;
scenePass.setMRT( mrt( outputs ) );

const hdr = scenePass.getTextureNode( 'output' );
const depth = scenePass.getTextureNode( 'depth' );
await scenePass.compileAsync( renderer );
```

`PassNode` creates named attachments by cloning the output texture. Verify the
actual target inventory before claiming compact storage. A compact velocity
target, for example, requires setting its format before compile and validating
renderability:

```js
import { HalfFloatType, NoColorSpace, RGFormat } from 'three/webgpu';

const texture = scenePass.getTexture( 'velocity' );
texture.format = RGFormat;
texture.type = HalfFloatType;
texture.colorSpace = NoColorSpace;
const velocityTexture = scenePass.getTextureNode( 'velocity' );
```

Changing a normal target to two channels also requires a named encoder,
decoder, and error bound; format selection alone is not packing.

### Attachment decision

For physical parent extent `W * H`, scale `s`, texel bytes `b`, sample count
`m`, layers `l`, and retained slots `k`:

```text
Wp = floor(W * s)
Hp = floor(H * s)
logicalPayloadBytes = Wp * Hp * b * m * l * k
```

When a multisampled attachment is stored and later sampled once, its explicit
uncompressed traffic lower bound is:

```text
attachmentTraffic >= Wp * Hp * b * l * (m + 1)
```

Alignment, compression, tile residency, resolves, allocator granularity, and
cache behavior require target evidence. Reject any candidate that misses the
signal's domain, error, coverage, temporal, or discard contract before timing
it. Compare only correct implementations in paired complete graphs:

```text
deltaMRT(a) = graphWithAttachment(a) - graphWithout(a)
deltaAlt(a) = graphWithAlternative(a) - graphWithoutFeature(a)
```

Normal reconstruction can beat a stored normal; several stable normal readers
can reverse that result. Full-scene bloom needs no emissive attachment.
Temporal reconstruction needs velocity only while enabled. A diffuse/base
attachment is useful only when a real indirect-light composite consumes it.
IDs need a concrete rejection or classification reader.

### Depth and visibility branches

- Declare standard, reversed, logarithmic, or orthographic depth before any
  consumer. r185 `getViewZNode()` assumes perspective reconstruction, and
  `getLinearDepthNode()` does not prove orthographic/logarithmic correctness.
- Give sky/background a shared depth class for AO, fog, refraction, and history
  rejection.
- Make alpha-tested material discard identical for output, depth, and every
  MRT signal.
- Place ordinary transparent geometry after opaque temporal/AO unless it owns
  trustworthy depth and velocity.
- Give refraction an explicit scene-color/depth snapshot and ordering; a normal
  attachment alone does not provide it.
- Admit MSAA as a separate measured branch when temporal output is absent.

## Temporal admission and resets

### Velocity convention

r185 `VelocityNode` writes:

```text
velocityNDC = currentNDC.xy - previousNDC.xy
```

r185 `TRAANode` converts that value to texture UV with a Y flip:

```js
const offsetUV = velocityTexel.xy.mul( vec2( 0.5, -0.5 ) );
const previousUV = currentUV.sub( offsetUV );
```

A symmetric `* 0.5` conversion ghosts vertical motion. Generate velocity from
independent previous/current presented state using unjittered matrices. Apply
jitter exactly once after that mapping.

For every history-bearing representation, keep stable identity and both
presented states together:

- rigid: previous/current object transform;
- instanced: previous/current transform per stable instance ID;
- skinned: previous/current palette and object transform;
- procedural deformation: previous/current parameters or positions;
- particles: identity, current state, and prior-presented state move atomically
  during compaction.

Invalidate history for spawn, despawn, teleport, reparent, incompatible LOD or
topology, slot reuse, and discontinuous deformation. A compensated render-origin
change must vanish from custom velocity, but stock TRAA still needs a reseed:
its previous-depth reconstruction has no previous-origin-to-current-origin
bridge.

### Stock TRAA limits

- input must be a texture; wrapping a composite adds a full-resolution color
  target and fullscreen draw, so disable its unused depth and own its disposal;
- input, scene color, depth, velocity, and drawing-buffer extents must match;
- MSAA must be disabled;
- previous object state is global rather than target/view keyed, so multiple
  velocity-bearing views or passes need a custom snapshot-bound path;
- resize reseeds internal targets, but cuts and other discontinuities have no
  public general `reset()`;
- there is no public reactive-mask input.

Use an evidenced node rebuild or bypass/reseed wrapper for stock TRAA. Use a
custom node only when it consumes the full previous/current transforms,
rejection signals, and reset generations required by the scene.

### History domain and order

Keep scene-radiance history before exposure. If exposed history is required,
convert the old value before blending:

```text
historyInCurrentExposure = history * currentExposure / previousExposure
```

Reject the sample when the ratio exceeds the authored validity interval. Meter
resolved pre-bloom HDR by default. Bloom follows temporal resolve so broad,
depthless glare does not enter geometry reprojection. A separate selective
emissive signal still needs stability proof when it contains subpixel or
discontinuous content.

Reset or reject affected pixels for:

| Event | Affected state |
| --- | --- |
| cut, projection change, uncompensated origin change | depth mapping, velocity, all screen histories |
| resize, DPR, target format or MRT layout | every dimension/format-dependent target and history |
| solver reset, topology, LOD, spawn/despawn, teleport | histories consuming changed geometry or identity |
| shadow, foam, emissive, wetness, refraction, absorption discontinuity | affected radiance/surface histories |
| radiance basis, primaries, calibration, quantity, or exposure-key change | radiance histories, meter, adapted exposure, threshold conversion |

An executable reset names its trigger, affected state, action, new generation,
and the phase before the first reader. Diagnostics alone do not reset history.

## Color, alpha, and legal endings

Classify PNG/JPEG-like color assets with their authored transfer, commonly
`SRGBColorSpace`. Keep linear HDR sources and render targets in the registered
working space. Treat normals, masks, velocity, depth, LUT transform data, and
non-color histories as data (`NoColorSpace`).

Three endings are legal:

```text
automatic:
  scene-linear outputNode
    -> RenderPipeline's internal tone map/output conversion
  outputColorTransform = true

tone-mapped-linear grade:
  unpremultiply HDR -> exposure -> toneMapping()
    -> linear LUT -> premultiply
    -> renderOutput(NoToneMapping, outputColorSpace)
  outputColorTransform = false

display-domain grade/effect:
  HDR -> exposure/tone map -> renderOutput(...)
    -> exact output-transfer effect -> present
  outputColorTransform = false
```

`RenderOutputNode` clamps alpha, unpremultiplies, transforms, and premultiplies
again. Nonlinear tone mapping or a cube LUT therefore operates on straight RGB;
add bloom RGB while retaining the photographed alpha. A scene-linear cube needs
a shaper for unbounded HDR. A tone-mapped-linear cube is not interchangeable
with a display-encoded cube.

## Memory, timing, and adaptive resolution

### Persistent targets

r185 built-ins retain private targets for their lifetime:

- `GTAONode`: internal AO target;
- `BloomNode`: bright target plus two five-level blur chains;
- `TRAANode`: history and resolve targets, including its copy paths;
- `PassNode`: output, depth, and every named texture requested from it.

Public constructors do not expose those targets for aliasing. Count them as
resident. Custom storage can be reused only when lifetimes do not overlap and
dimensions, format, sample count, layers, and usage match. Histories,
readback-pinned targets, external references, and diagnostic pins remain
dedicated until final GPU use.

```text
peakLive = max_t(sum(bytes(resource) for resources live at t))
```

Report both peak live logical bytes and actual resident allocations. Rebuild a
pass to reclaim old attachments, then dispose its resources after a safe graph
handoff.

### Marginal timing

Measure the warmed, complete graph and paired variants with identical scene
state:

```text
fullGraph = measured end-to-end frame scope
marginal(effect | graph) = graphWithEffect - identicalGraphWithout
estimate = measuredBase + compatibleMarginals + authoredInteractionReserve
```

Once measured, the full graph wins over the estimate. Record physical pixels,
DPR, enabled graph, warmup, statistic, browser/GPU, scene traversals,
fullscreen draws, dispatches, target inventory, and timing scope.

`timestamp-query` is gated after renderer initialization. r185 render/compute
timestamp pools sum instrumented pass durations; copies, barriers, submission
gaps, and presentation can lie outside them. Label that sum as pass-duration
evidence unless an independent scope proves end-to-end coverage.

### Adaptive DPR

Fit scalable and fixed cost from two measured scales and verify the model on a
third:

```text
A = (C_b - C_a) / (s_b^2 - s_a^2)
F = C_a - A * s_a^2
C(s) ~= F + A * s^2
sBudget = sqrt(max((gpuBudget - F) / max(A, epsilon), 0))
```

Require `A > epsilon`, `gpuBudget > F`, and acceptable third-point error.
Drive changes from sustained filtered pressure with a faster downshift, slower
upshift, asymmetric thresholds, quantized steps, and cooldown. On every DPR
change, update explicit dimensions, reseed affected histories and jitter/meter
layouts, record peak allocation churn, and remeasure the resulting tier.

## Diagnostics and failure signatures

Capture only signals present in the graph:

```text
no-post HDR baseline; raw depth and reconstructed view-Z; sky class
normal reconstruction versus MRT; emissive; velocity; IDs
transparent/refractive inclusion; current/history/rejection/jitter/reset
meter source and adapted EV; bloom source and contribution
pre-tone, post-tone, LUT input/output, final alpha/output
target format/extent/lifetime, resident and peak bytes, timing scope
```

Use these signatures to route fixes:

| Signature | Likely contract failure |
| --- | --- |
| vertical-only ghosting | velocity UV Y flip is wrong |
| ghost after cut/teleport/resize | reset action is absent or late |
| halo at alpha-tested edge | depth/MRT discard differs from output |
| transparent object ghosts or vanishes | layer entered history without valid depth/velocity |
| exposure pumps with glare | meter taps post-bloom or an unstable source |
| dark/bright final image after graph edit | tone map or output conversion has two owners |
| memory remains after disabling an MRT | old PassNode graph still owns the attachment |
| adaptive DPR oscillates | thresholds/dwell/cooldown or cost model is invalid |
| GPU time excludes visible work | timestamp scope omits copies, compute, or presentation |

Accept the graph after output isolation and the checks required by its admitted
branches: paired attachment alternatives for each selected attachment; both
velocity axes and every owned reset class for temporal history; fixed views for
each supported shipping tier; and repeated create, resize, toggle, and dispose
cycles for the resources the graph actually owns.
