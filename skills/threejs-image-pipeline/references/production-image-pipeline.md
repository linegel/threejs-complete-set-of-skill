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
import { BlendMode, HalfFloatType, MaterialBlending, RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { diffuseColor, mrt, normalView, output, pass, velocity } from 'three/tsl';

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
const scenePass = pass( scene, camera, { samples: temporalEnabled ? 0 : sceneSampleCount } );
scenePass.transparent = false; // Excluded layers have a separately budgeted compositor.
const outputs = { output };
if ( needNormal ) outputs.normal = normalView;
if ( needSelectiveBloom ) outputs.emissive = selectiveContributionRGBA;
if ( temporalEnabled ) outputs.velocity = velocity;
if ( needBaseColor ) outputs.albedo = diffuseColor.rgb;
const sceneMRT = mrt( outputs );
if ( needSelectiveBloom ) sceneMRT.setBlendMode( 'emissive', new BlendMode( MaterialBlending ) );
scenePass.setMRT( sceneMRT );
const signals = {};
for ( const name of Object.keys( outputs ) ) signals[ name ] = scenePass.getTextureNode( name );
const hdr = signals.output;
const depth = scenePass.getTextureNode( 'depth' );
// Apply any compact formats below before compile, then use the guarded compile path.

```

`selectiveContributionRGBA` is the alpha-aware expression from the bloom skill,
not a built-in export or bare emissive vec3. The explicit opaque pass keeps
ordinary transparency out of history/AO; compose excluded layers with their
own depth/sort/blend policy and count any additional traversal. Merely declaring
MRT names does not allocate attachments: request each signal before compilation.

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
decoder, and error bound; format selection alone is not packing. Configure the
output type before named clones where possible, then verify every actual format
again after setup. Pass setup can replace the output's type without updating
already-cloned named attachments.

Stock pass compilation and rendering do not restore all borrowed state on an
exception. Wrap the whole exclusive operation with try/finally; for compile:

```js
const savedTarget = renderer.getRenderTarget();
const savedMRT = renderer.getMRT();
try {
  await scenePass.compileAsync( renderer );
} finally {
  renderer.setRenderTarget( savedTarget );
  renderer.setMRT( savedMRT );
}
```

Rendering additionally borrows renderer color/tone/XR/clear/layer/context state,
scene override/name, and temporal camera/jitter state. Restore the exact owned
snapshot on failure, not global defaults. Prevent concurrent mutation while
these operations borrow shared state. A resolved compile promise is not by
itself a clean shader-validation or first-frame acceptance result.

### Attachment decision

For physical parent extent `W * H`, scale `s`, texel bytes `b`, sample count
`m`, layers `l`, and retained slots `k`:

```text
Wp = floor(W * s)
Hp = floor(H * s)
logicalPayloadBytes = Wp * Hp * b * m * l * k
```

Use `m = 1` for non-multisampled storage, even when the API encodes that as
`samples: 0`. A retained multisample allocation and its resolved single-sample
texture are separate resources; count both when live. For an intentionally
uncompressed model that writes all samples, stores the resolve, then reads it
once, model each operation separately:

```text
sampleStoreBytes = Wp * Hp * b * l * m
resolveStoreBytes = multisampled ? Wp * Hp * b * l : 0
laterReadBytes = Wp * Hp * b * l
```

This is logical operation accounting, not a measured DRAM lower bound. Tile
memory, discard/store policies, compression, cache hits, resolves and allocator
padding can change external traffic and residency; require target evidence.
Reject any candidate that misses the signal's domain, error, coverage, temporal,
or discard contract before timing
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

- input must be a render-target-owned pass texture or explicit RTTNode. Stock
  update reads its owner's renderTarget; an arbitrary external TextureNode
  lacks that owner. Materialize composites explicitly, disable unused depth,
  and own the RTT target/material rather than relying on recursive disposal;
- input, scene color, depth, velocity, and drawing-buffer extents must match;
- MSAA must be disabled;
- previous object state is global rather than target/view keyed, so multiple
  velocity-bearing views or passes need a custom snapshot-bound path;
- resize reseeds internal targets, but cuts and other discontinuities have no
  public general `reset()`;
- there is no public reactive-mask input;
- stock jitter replaces a pre-existing camera view offset and clears it rather
  than restoring it. Cropped/tiled views and custom projection matrices need a
  composed-jitter adapter; use the ordinary unmodified-camera branch otherwise;
- pipeline callbacks are single slots, not automatically chained across two
  TRAA nodes or another jitter owner. Use one admitted owner per pipeline;
- stock first-use reseeding is based on a size change from 1x1. A 1x1 image does
  not trigger that path: use a verified explicit seed or bypass, and suspend
  zero-sized views. Verify initial depth/history as well as resized color;
- its 3x3 loads do not clamp the border coordinates. GPU robust-access behavior
  is not an edge policy; compile/test border strips or provide a valid adapter.

The rebuild example validates node/owner inputs and synchronous output, retains
public thresholds/subpixel policy, and returns a guarded `rollback()` plus both
resource generations. Rollback restores only output binding/transform policy;
it does not fence the GPU, undo failed rendering side effects, or dispose either
generation. The host restores borrowed state, validates the replacement, and
retires only unreachable resources after final use. A newer graph owner cannot
be overwritten by an old rollback. Compose callbacks own any additional
allocations and must release them on failure; they must not mutate pipeline
ownership during composition.

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
again. Nonlinear tone mapping or a cube LUT therefore operates on straight RGB.
A display-domain nonlinear effect also unpremultiplies encoded RGB and restores
alpha without another output conversion. Bloom uses the explicit alpha branch
from its owner: opaque/composited output, coverage-clipped unchanged alpha, or
separate halo-preserving composition. Unchanged zero alpha loses off-surface
halo energy; it is not a universally valid bloom ending. A scene-linear cube needs
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
handoff. Disposal is not graph traversal: RenderPipeline disposes its material,
not all referenced effects; RTT targets/materials and generated AO noise need
explicit ownership, as specified by their skills. Pass previous-texture slots,
external references, and any in-flight copies remain separately accounted.
Never clear shared ownership with an indiscriminate recursive dispose.

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
evidence unless an independent scope proves end-to-end coverage. Use fresh
frame/scope identities, bounded query collection, and failure handling from
visual-validation; a stale lastValue or exhausted pool is not a timing sample.

### Adaptive DPR

Fit scalable and fixed cost from two measured scales and verify the model on a
third:

```text
A = (C_b - C_a) / (s_b^2 - s_a^2)
F = C_a - A * s_a^2
C(s) ~= F + A * s^2
sBudget = sqrt(max((gpuBudget - F) / max(A, epsilon), 0))
```

Require distinct finite positive scales, positive observed costs, physically
admitted nonnegative fixed cost, `A > epsilon`, `gpuBudget > F`, and acceptable
third-point error. Cap to declared quality/device extents before allocation.
A clamp cannot repair an invalid fit or a fixed-cost budget miss.
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
