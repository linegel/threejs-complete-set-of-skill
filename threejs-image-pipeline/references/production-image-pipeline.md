# Production Native-WebGPU/TSL Image-Pipeline Contracts

This reference coordinates a Three.js scene pass, selected shared signals,
lighting effects, temporal reconstruction, exposure, tone mapping, grading,
presentation, resource lifetimes, and adaptive resolution. It optimizes the
complete graph on its target rather than maximizing attachment count.

## Numeric Evidence Convention

Every numeric value carries one tag:

- `[Derived]`: formula, dimensions, format, or verified API consequence;
- `[Gated]`: legal only after a named capability/correctness gate;
- `[Measured]`: captured on a named browser, GPU, physical resolution, and graph;
- `[Authored]`: a quality/look/controller starting value.

A tag on a table row or code-block heading applies to every numeric literal in
that row or block. Untagged millisecond, DPR, attachment, sample, history, or
memory recommendations are invalid.

## r185 API Proof And Constraints

The local dependency resolved to `three@0.185.1` `[Measured: local package]`.

| API/behavior | Local proof | Pipeline consequence |
| --- | --- | --- |
| `RenderPipeline.render()`, `outputColorTransform`, `needsUpdate` | `node_modules/three/src/renderers/common/RenderPipeline.js` | Use synchronous `render()` after renderer init. Explicit `renderOutput()` requires `outputColorTransform = false`; graph changes require `needsUpdate = true`. |
| `PassNode` target, depth, MRT, resolution, compile order | `node_modules/three/src/nodes/display/PassNode.js` | Depth is a pass depth texture. `setMRT()` and all `getTextureNode()` calls precede `compileAsync(renderer)`. |
| named MRT textures clone the pass output texture | `PassNode.getTexture()` in the same source | Do not assume compact per-attachment formats; inspect and validate physical textures. |
| `ao(depth, normal, camera)` | `node_modules/three/examples/jsm/tsl/display/GTAONode.js` | `normal` may be `null` for depth reconstruction. Resolution is the public `resolutionScale` property. |
| `bloom(input)` | `node_modules/three/examples/jsm/tsl/display/BloomNode.js` | Resolution uses `setResolutionScale()`. Its mip targets are private and not a reusable public pyramid. |
| `traa(beauty, depth, velocity, camera)` | `node_modules/three/examples/jsm/tsl/display/TRAANode.js` | It owns jitter hooks/history, requires MSAA off, flips NDC Y when converting velocity to UV, and exposes no general public reset method. |
| `VelocityNode` output | `node_modules/three/src/nodes/accessors/VelocityNode.js` | Velocity is current NDC minus previous NDC. |
| `renderOutput()` semantics | `node_modules/three/src/nodes/display/RenderOutputNode.js` | It clamps alpha, unpremultiplies, tone maps, converts working-to-output, then premultiplies. Downstream display effects therefore receive output-encoded premultiplied color. |
| timestamps | `renderer.hasFeature('timestamp-query')`, `resolveTimestampsAsync()` in `Renderer.js` | Gate after `await renderer.init()`; unavailable timestamps do not become fabricated pass timings. |

r185 exposes no public transient render-graph allocator and no public query that
predicts whether a wider MRT is cheaper on a tile GPU. Compile candidate graphs
and measure them.

## Canonical Graph

The baseline is one primary scene pass `[Authored: baseline architecture]` with
HDR output and depth. Optional color attachments are decisions, not defaults.

```text
pass(scene, camera)
  color: HDR output
  depth: pass depth texture
  optional MRT: normal, emissive, velocity, diffuse/base color, IDs

effect-local lighting histories
  -> indirect-light AO / atmosphere and temporally valid layers
  -> stable scene-linear HDR
  -> TRAA when its contract is complete
  -> transparent/refractive layers excluded from temporal history
  -> exposure meter tap from resolved pre-bloom HDR by default
  -> bloom / glare and scene-linear optical contributions
  -> adapted exposure
  -> tone map
  -> grading in a declared domain
  -> one output conversion
  -> display-domain AA/dither/UI when required
```

Minimal public-API skeleton. Numeric/API literals are
`[Gated: installed r185 source]`:

```js
import {
  HalfFloatType,
  RenderPipeline,
  WebGPURenderer
} from 'three/webgpu';
import {
  diffuseColor,
  emissive,
  mrt,
  normalView,
  output,
  pass,
  premultiplyAlpha,
  renderOutput,
  rtt,
  unpremultiplyAlpha,
  vec4,
  velocity
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

const renderer = new WebGPURenderer( {
  antialias: false,
  outputBufferType: HalfFloatType,
  trackTimestamp: true
} );
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'Native WebGPU is required for this image pipeline.' );
}

const renderPipeline = new RenderPipeline( renderer );
const scenePass = pass( scene, camera );
scenePass.opaque = true;
scenePass.transparent = splitPostTemporalTransparency === false;

const mrtOutputs = { output };
if ( useNormal ) mrtOutputs.normal = normalView;
if ( useSelectiveBloom ) mrtOutputs.emissive = emissive;
if ( useTemporal ) mrtOutputs.velocity = velocity;
if ( useDiffuseSignal ) mrtOutputs.albedo = diffuseColor.rgb;
scenePass.setMRT( mrt( mrtOutputs ) );

// [Gated] Before compile, verify selected attachment count, the sum of bytes
// per sample against device.limits.maxColorAttachmentBytesPerSample, and each
// physical format's renderability. Compilation/error-scope evidence remains
// required; count alone does not prove a legal MRT.

const hdr = scenePass.getTextureNode( 'output' );
const depth = scenePass.getTextureNode( 'depth' );
const normal = useNormal ? scenePass.getTextureNode( 'normal' ) : null;

const gtao = useGtao ? ao( depth, normal, camera ) : null;
if ( gtao ) gtao.resolutionScale = aoScale;

// Application/material ownership must expose direct and indirect terms before
// GTAO can modulate indirect lighting correctly. A final-color multiply is
// only a diagnostic baseline.
const lightingComposite = composeLightingWithIndirectVisibility(
  hdr,
  gtao?.getTextureNode().r
);

const temporalInput = useTemporal
  ? rtt( lightingComposite, null, null, {
      type: HalfFloatType,
      depthBuffer: false
    } )
  : null;
const stableHdr = useTemporal
  ? traa(
      temporalInput,
      depth,
      scenePass.getTextureNode( 'velocity' ),
      camera
    )
  : lightingComposite;

// Application helper: when splitPostTemporalTransparency is true, render and
// include only the excluded layers after temporal resolve, but before the
// photographed meter tap. The narrow extra pass needs measured justification.
const photographedHdr = composePostTemporalTransparency( stableHdr );
const meterSource = photographedHdr; // pre-bloom by authored default
const bloomSource = useSelectiveBloom
  ? scenePass.getTextureNode( 'emissive' )
  : photographedHdr;
const bloomPass = useBloom ? bloom( bloomSource ) : null;
if ( bloomPass ) bloomPass.setResolutionScale( bloomScale );

const hdrComposite = bloomPass
  ? vec4(
      photographedHdr.rgb.add( bloomPass.getTextureNode().rgb ),
      photographedHdr.a
    )
  : photographedHdr;

renderPipeline.outputColorTransform = false;
renderPipeline.outputNode = renderOutput( hdrComposite );
renderPipeline.needsUpdate = true;

await scenePass.compileAsync( renderer );
```

`traa()` requires a texture. Passing a composite node implicitly creates the
same full-resolution `RTTNode`; spelling it out exposes its color target,
fullscreen draw, and disposal ownership. The explicit RTT disables its unused
depth attachment. Stock r185 TRAA is full-drawing-buffer resolution: require
scene color, depth, velocity, and RTT extents to match, or route to a measured
TAAU/spatial path. Dispose `temporalInput` with the temporal tier.

When post-temporal transparent layers contain emissive radiance, their emissive
contribution needs its own bloom-source policy; the opaque pass emissive MRT
cannot represent it. Bloom adds RGB and preserves photographed alpha.

`composeLightingWithIndirectVisibility()` and
`composePostTemporalTransparency()` are explicitly application helpers, not
Three.js APIs. The standard final HDR output does not expose separated direct
and indirect radiance. An albedo MRT cannot reconstruct that separation. If the
material/lighting architecture does not expose indirect light, retain
final-color AO multiplication only as a labeled diagnostic and fix the source
architecture before shipping.

## Signal And Lifetime Table

Write this table for the actual graph before allocating optional outputs:

| Signal | Producer | Consumers | Mathematical domain | Physical texture/format | Scale | First write -> last read | History | Disable path |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HDR output | primary pass | lighting composite, temporal, alternate bloom, meter | scene-linear working primaries | inspect pass output; usually RGBA + `HalfFloatType` in this setup `[Gated]` | `[Authored]` | scene pass -> final scene-linear consumer | optional color history | direct output |
| depth | pass depth texture | AO, fog, refraction, temporal rejection | renderer depth; named reconstruction | inspect `DepthTexture` and depth policy `[Gated]` | `[Authored]` | scene pass -> last depth consumer | optional previous depth | disable depth consumers |
| normal | optional MRT | AO, refraction, reconstruction | view-space unit vector/data | r185 named attachment clones output by default `[Derived]` | `[Authored]` | scene pass -> last normal consumer | none | reconstruct from depth or disable |
| emissive | optional MRT | selective bloom | scene-linear HDR contribution | inspect cloned attachment `[Gated]` | `[Authored]` | scene pass -> bloom high-pass | none | bloom HDR output or disable |
| velocity | optional MRT | TRAA/temporal denoisers | current NDC minus previous NDC | inspect cloned attachment `[Gated]` | must match temporal source `[Gated]` | scene pass -> temporal resolve | previous transforms | disable temporal |
| albedo/base | optional named `diffuseColor.rgb` MRT | authored indirect composite | scene-linear base color, not lit radiance | inspect cloned attachment `[Gated]` | `[Authored]` | scene pass -> indirect composite | none | disable tint/composite |
| exposure | exposure compute | exposure multiplier | EV/data | typed storage buffers | scalar | meter -> tone map | persistent adapted state | fixed EV |
| UI | DOM or final display pass | presentation | display/output domain | application-owned | display | after output conversion -> present | none | hide |

Every signal has one writer. "First write -> last read" is a scheduling
interval, while resident allocation may persist for the node's whole lifetime.

## MRT On Tile And Bandwidth-Limited GPUs

### Cost Model

For parent physical width `W`, height `H`, pass scale `s`, texel bytes `b`,
sample count `m`, array layers `l`, and retained allocation slots `k`:

```text
Wp = floor(W*s)                                            [Derived: r185 PassNode]
Hp = floor(H*s)                                            [Derived: r185 PassNode]
logicalPayloadBytes = Wp * Hp * b * m * l * k              [Derived]
```

Use the dimensions reported by the allocated target because other node types
may round differently. This is a logical payload lower bound; backend alignment,
compression, resolve targets, and allocator granularity require `[Measured]` or
platform tooling.

If an attachment is stored once and sampled once by a later pass, the explicit
traffic lower bound is:

```text
attachmentTraffic >= Wp * Hp * b * l * (m + 1)             [Derived]
```

The expression counts `m` stored samples and one later single-sample read; for
`m = 1` it reduces to one write plus one read. Explicit resolves, tile spills,
cache behavior, blending, and extra consumers can increase it. If the backend
keeps a multisample attachment compressed/on-chip, treat this only as a
conservative uncompressed-payload model and use target counters. A wide MRT can
save vertex/fragment work yet lose on memory traffic and thermal behavior.

### Candidate Decision

Measure paired variants after warmup:

```text
deltaMRT(a) = graphWithAttachment(a) - graphWithout(a)      [Measured]
deltaAlt(a) = graphWithReconstructionOrNarrowPass
              - graphWithoutFeature                         [Measured]
```

Keep attachment `a` only if:

```text
deltaMRT(a) < deltaAlt(a)                                  [Derived decision]
peakResidentWithMRT <= declaredPeakBudget                  [Gated]
```

Measure time, resident logical bytes, bandwidth counters when available, and
sustained/thermal behavior. A device label such as "mobile" is not evidence.

### Useful Candidate Graphs

- Minimal bandwidth graph: HDR output + depth. `ao(depth, null, camera)`
  reconstructs normals; bloom reads HDR color; temporal is disabled.
- Selective bloom graph: HDR output + emissive + depth.
- Temporal graph: HDR output + depth + velocity, adding normal only when its
  consumers beat reconstruction.
- Rich diagnostic graph: requested signals only while capturing. Recreate and
  dispose the pass when attachments must be reclaimed; removing an MRT key does
  not automatically remove a texture previously created by
  `getTextureNode(name)`.

Do not use an attachment-count heuristic as the final decision. Fragment-heavy
scenes may prefer MRT; geometry-light full-screen scenes often prefer
reconstruction.

When a compact attachment wins, configure the physical texture before compile
and verify the resulting render-target inventory. Example for native
two-component velocity; symbols and format choice are
`[Gated: r185 compile plus target validation]`:

```js
import {
  HalfFloatType,
  NoColorSpace,
  RGFormat
} from 'three/webgpu';

const velocityTexture = scenePass.getTexture( 'velocity' );
velocityTexture.format = RGFormat;
velocityTexture.type = HalfFloatType;
velocityTexture.colorSpace = NoColorSpace;
const velocityTextureNode = scenePass.getTextureNode( 'velocity' );
```

Packing a view normal into two channels additionally requires a declared
octahedral encoder/decoder and error validation; changing only the texture
format is not normal packing.

## Depth, Normals, Transparency, And MSAA

- Declare standard, reversed, logarithmic, or orthographic depth before any
  consumer. Use the pass helper appropriate to the camera and validate view-Z;
  do not mix raw depth from one policy with thresholds authored for another.
- In r185, `PassNode.getViewZNode()` uses perspective reconstruction and
  `getLinearDepthNode()` carries a source TODO for camera-type selection. These
  helpers are not proof for orthographic or logarithmic depth. Gate standard
  perspective explicitly; provide and validate the correct inverse mapping for
  orthographic/logarithmic policies.
- Give sky/background an explicit depth class. AO, fog, refraction, and
  temporal rejection must agree that it is not nearby geometry.
- Alpha-tested geometry must write matching MRT/depth signals. Otherwise cutout
  edges halo.
- Ordinary transparent objects usually do not provide trustworthy depth and
  velocity. Choose: composite after opaque temporal/AO, write an approximation,
  or exclude them from affected effects.
- Refraction needs an explicit scene-color/depth snapshot and ordering. It is
  not solved by adding a normal MRT.
- Particles and sprites require bloom and meter policies; small HDR sprites can
  dominate exact exposure or disappear from a sparse meter.
- TRAA requires MSAA disabled `[Gated: r185 source]`. Without TRAA, MSAA is a
  separate `[Gated]` choice whose multisample attachment cost must be measured.

## Temporal Ordering And Reprojection

### Immutable presentation snapshot

The canonical schema and scheduling rules live in the
[physics domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
When the route declares a physics-to-render boundary, the pre-render coordinator
first latches the view-independent immutable `PhysicsPresentationCandidate`;
the camera owner emits `CameraViewPublication`; visibility/shadow/cache owners
emit `ViewPreparationPublication`; and the assembler seals one target/view
`PhysicsPresentationSnapshot`. The image pipeline latches that exact chain
before constructing frame uniforms. Validate the candidate pairs/descriptors,
camera transforms/matrices, preparation reactive/reset plan and committed
resources, and the Snapshot reference closure. Scene, shadow receivers,
culling, MRT, history, post, picking, and diagnostics consume the same
candidate/camera/preparation/snapshot IDs. No stage mutates an earlier record. A
declared one-frame-deferred alternative may publish late cache feedback on the
next frame only; this frame keeps sampling the prior committed resource/version
named by its snapshot.

Every `PhysicsSignalDescriptor` supplies the central per-channel/frame/time/
version/residency/error metadata, and each stable binding/provider supplies its
central `PresentedStatePair` in the Candidate. The Snapshot references these by
`presentedStatePairRefs`; it does not copy them. A single route-wide alpha cannot describe providers with
different cadences. Every GPU-backed binding pins resource generation, layout,
entity map, slot/range, access, and the central `PresentationResourceLease`
until all consumers submit and its `reuseProhibitedUntil` condition is
satisfied. Retirement is recorded in
`FrameExecutionRecord.leaseDispositionById` with its completion join/evidence.

For vertex `x`, generate temporal positions from adjacent *presented* states:

```text
clipPrevious = projectionPreviousUnjittered * viewPrevious
               * globalToRenderPrevious * bind(presentedPair.previousPresented.globalBinding) * xPrevious
clipCurrent  = projectionCurrentUnjittered * viewCurrent
               * globalToRenderCurrent * bind(presentedPair.currentPresented.globalBinding) * xCurrent
velocityNDC  = ndc(clipCurrent) - ndc(clipPrevious)
```

`xPrevious`/`xCurrent` include the previous/current presented rigid, instanced,
skinned, particle, and procedural deformation. They are not the provider's two
fixed-step endpoints. Projecting endpoints while rendering an interpolated pose
creates cadence-dependent velocity, ghosting, and false disocclusion. A custom
high/low or rebased position path must apply the corresponding previous/current
global-to-render transform; a coordinate-only rebase then produces no physical
motion. Spawn, despawn, teleport, reparent, incompatible LOD, and slot reuse
carry explicit invalidity and cannot borrow history. Particle compaction moves
identity, current state, and previous-presented state atomically.

Temporal jitter is a separate mapping owned after this unjittered velocity
calculation. Do not include jitter in one endpoint only or apply it twice.

Stock r185 `VelocityNode` stores previous object state globally rather than by
presentation target/view and advances it after a velocity render. Gate it to
one presentation history and one velocity-bearing render per object per
presented frame, and only where its built-in rigid/skinned/instanced/
deformation previous-state path matches the central binding. Multiple views,
targets, or velocity passes and arbitrary prior procedural/particle state use a
custom snapshot-bound velocity path. Validate the actual GPU/CPU binding and
slot generation; schema presence alone is insufficient.

An external solver pose stream is legal only after its route adapter has
published ordered timestamps, state versions, converted frames/units, stable
IDs, discontinuities, and a bounded interpolation/extrapolation error into the
candidate's independently provenanced previous/current presented states. Render
code never polls that external engine independently.

### Lighting transport and reset DAG

Latch the central `LightingTransportSnapshot` through a provider-wide
`PresentedStatePair` (`entityId: typed-absence`) in the Candidate and require
its binding ID in the sealed Snapshot's `presentedStatePairRefs`. Match
context/provider/signal IDs, descriptor and state/resource generations,
`PresentationStateHandle`, each state's requested presentation instant, mapped
source instant and clock-map revision/error, plus the bundle `sampleInstant`;
validate channel `actualPhysicsTime`, filter/age, maximum staleness, validity,
and error. Do not
redeclare a parallel lighting record. Each canonical channel
declares its own basis/primaries or spectral basis, radiometric quantity, SI
unit, frame/time, revision, validity, and error.

The provenance `requestedPresentationInstant` and bundle `sampleInstant` are
narrow `PhysicsInstant` values. Provider `requestedPhysicsTime` and channel
`actualPhysicsTime` are `PhysicsTime` wrappers whose discriminant selects
exactly one arm consistent with the signal descriptor's `timeSemantics`; a raw
`PhysicsInstant` or `PhysicsTimeInterval` is invalid in either wrapper field.

Materials, atmosphere, meter, bloom, and diagnostics must use a compatible
channel or an explicit dimensionally valid conversion. If rendering uses a
normalized scene-linear RGB basis, expose it as a separately named render-local
signal derived by a versioned SI-to-render conversion with reference scale,
provenance, and error. It is not a normalized canonical physics channel. A
nonphysical route leaves the router physics fields `not used` and declares only
its render-local color contract.

Build executable reset edges from
`ViewPreparationPublication.reactivePublications` and
`ViewPreparationPublication.resetDependencies`:

Every reactive publication is the exact central target/view record with
source/version/epoch, typed cause, affected region (`full-frame` or a leased
mask handle), validity/error, and planned history action. Its mask descriptor
must pin extent, camera/projection/jitter mapping, encoding/format, resource
generation/layout/slot, conservative coverage/error, and retirement lease.

| Cause committed for this frame | Required consumers before use |
| --- | --- |
| uncompensated origin/projection discontinuity or camera cut | velocity/depth mapping, TRAA and every screen-reprojected history; shadow fitting/cache coordinates as declared |
| solver reset, topology change, or quality-state migration | histories and shadows whose producers depend on changed state; preserve unrelated histories only with a version proof |
| shadow content invalidation/commit | render only committed valid maps; a custom/patched temporal node may reject changed radiance pixels through a shadow mask, otherwise reset/reseed the full affected radiance history |
| foam, emissive, wetness, refraction, absorption, or other optical discontinuity | reject the affected temporal-radiance/surface history; preserve geometry history only when depth/velocity remain valid |
| radiance-basis/calibration, primaries, quantity convention, or exposure-key revision | invalidate or exactly convert scene-radiance histories, meter accumulators, adapted exposure, and bloom threshold conversion |
| size/DPR/format/MRT-layout change | recreate/reseed every dimension- or format-dependent history before graph publication |

Required order is:

```text
validate presentation candidate and lighting input
  -> CameraViewPublication with render transforms/matrices/jitter/depth
  -> ViewPreparationPublication with committed visibility/shadows/reactive/reset records
  -> seal PhysicsPresentationSnapshot references
  -> validate and latch the exact publication chain
  -> render depth, velocity, and scene-linear radiance
  -> materialize local reactive masks
  -> reject/reseed AO, volumetric, surface, and color histories
  -> resolve the photographed meter source
  -> update exposure
  -> bloom/tone-map/grade/output
```

Each immutable plan edge uses the exact canonical `ScopedResetAction.policy`:
`preserve-with-proof`, `reset`, `reject-region`, `reproject-with-proof`,
`reseed`, `rebuild`, `bypass`, `hold-prior`, or `convert-with-proof`. Actual
completion/failure and queue submission are appended to `FrameExecutionRecord`,
not written back into the preparation record or Snapshot. The graph must be acyclic for a frame; a
producer completed after its consumer is deferred to the next snapshot,
never retroactively published. Stock r185 `TRAANode` cannot consume a reactive
mask and exposes no public general reset; use a validated custom/patched node,
or an evidenced rebuild, bypass/reseed wrapper, or full reset.

For resource validity, distinguish logical state version, resource generation,
submission epoch, GPU queue availability, and host visibility. `computeAsync()`
does not establish completion. A pre-seal camera/shadow/cache or sealing failure
appends a `FrameExecutionRecord` with `overallStatus: aborted` (or
`partial-failure` when another target survives), excludes the failed target from
`snapshotIds`, stores typed absence in its target execution's `snapshotId`,
cancels or defers actions, retires only failed-target-exclusive preparation
leases, and retains Candidate leases until every surviving snapshot consumer
joins through `leaseDispositionById`. Device loss appends `overallStatus: device-lost` and
affected target statuses `device-lost`, advances the
device-loss generation, cancels actions, and invalidates lost-generation
resources/leases without fabricating normal completion. Candidate/Snapshot
records remain immutable evidence; only their lost-generation bindings become
unusable until the route rebuilds and reseeds under a new generation.

Stock r185 `TRAANode` also cannot preserve history across a render-origin
translation or tangent-basis rebase: its previous-depth world reconstruction
has no mapping from the previous render frame to the current one. Rebuild/
reseed stock TRAA on every render-origin epoch change even when custom velocity
correctly cancels the coordinate jump. Only a custom/patched temporal node that
uses both complete global-to-render transforms may preserve after proof.

### Velocity Convention

r185 `VelocityNode` computes:

```text
v_ndc = currentNDC.xy - previousNDC.xy                    [Derived]
```

r185 `TRAANode` converts NDC to texture UV as follows. All literals are
`[Derived: installed TRAANode source]`:

```js
const offsetUV = velocityTexel.xy.mul( vec2( 0.5, -0.5 ) );
const previousUV = currentUV.sub( offsetUV );
```

The negative Y factor is required by the texture-coordinate convention. A
custom history consumer must use the same conversion or prove a different
source convention.

### Opt-In Contract

Enable temporal output only when all are present:

- rigid, instanced, skinned, and procedural-deformation velocity for the
  geometry actually rendered;
- one jitter owner; whether velocity includes jitter is documented;
- previous/current camera and object transforms;
- history color domain, exposure value, physical format, and dimensions;
- depth/velocity/neighborhood rejection and out-of-bounds handling;
- reset/reseed events and visible reset reason;
- current, previous, rejected-history, velocity, and jitter diagnostics.

Run temporal resolve before exposure by default. If exposed history is required:

```text
historyInCurrentExposure = history * currentExposure / previousExposure
                                                               [Derived]
```

Reject or clamp when that ratio exceeds an authored validity range
`[Authored]`. Meter the resolved pre-bloom signal by default, then apply bloom
and exposure.

Bloom after TRAA does not automatically stabilize a separate raw emissive MRT.
If selective emissive contains subpixel geometry, stochastic shading, or rapid
material changes, temporally stabilize that source, band-limit it, or prove the
bloom result stable `[Measured]`.

r185 `TRAANode` automatically handles resize by reseeding its internal targets,
but it exposes no general public `reset()` for cuts or discontinuities. Use a
validated wrapper that bypasses/reseeds history, or dispose and rebuild the
node. Never claim a reset event is handled when no executable reset path exists.

## Color, Tone Mapping, LUT, And Alpha

### Texture Classification

- PNG/JPEG-style color textures authored with an sRGB transfer use
  `SRGBColorSpace`.
- Linear HDR sources use their registered linear color space; do not tag every
  color texture as sRGB.
- Working render targets carry scene-linear working color.
- Normal, roughness, mask, velocity, depth, histogram, LUT transform data, and
  non-color history use `NoColorSpace`/data semantics.

r185 registers linear-sRGB and sRGB by default. Wider primaries or HDR output
require `[Gated]` custom color-space registration, canvas/device support, and
captured evidence.

### Three Legal Endings

Automatic scene-linear ending:

```text
scene-linear outputNode
  -> RenderPipeline internal renderOutput(renderer tone map, output space)
outputColorTransform = true
```

Tone-mapped-linear grading ending:

```text
premultiplied HDR -> unpremultiplyAlpha -> exposure -> toneMapping()
    -> linear-domain LUT -> premultiplyAlpha
    -> renderOutput(NoToneMapping, outputColorSpace)
outputColorTransform = false
```

Display-encoded grading/effect ending:

```text
HDR -> exposure/tone map -> renderOutput(...)
    -> effect or LUT authored for exact output transfer/primaries
    -> present with no second conversion
outputColorTransform = false
```

`RenderOutputNode` unpremultiplies, transforms, and repremultiplies. Any node
after it receives output-domain premultiplied color; edge effects and UI
compositing must state whether they operate on premultiplied or unpremultiplied
values.

Therefore manual exposure/tone-map/LUT work before `renderOutput()` must operate
on straight RGB and repremultiply first. Applying nonlinear tone mapping or a
cube LUT directly to premultiplied RGB produces alpha-dependent edge colors.

A scene-linear cube needs an explicit log/shaper domain because HDR is
unbounded. A tone-mapped-linear cube is not movable before the tone map. See
`$threejs-exposure-color-grading` for the exact contracts.

## Resource Lifetimes And Transient Reuse

### r185 Reality

The built-in nodes allocate persistent private targets:

- `GTAONode`: one internal AO render target `[Derived: r185 source]`;
- `BloomNode`: one bright target plus two chains of five mip targets, for
  eleven persistent targets and twelve fullscreen draws per update
  `[Derived: r185 source]`;
- `TRAANode`: one history target with depth plus one resolve target, with color
  and depth copies `[Derived: r185 source]`;
- `PassNode`: output/depth plus every named texture ever requested from that
  pass `[Derived: r185 source]`.

Those targets cannot be aliased through public constructors in r185. Count all
of them as resident while the node exists. An effect being logically earlier
or later does not free its private allocations.

### Custom Pool Contract

Custom targets may reuse storage only when:

```text
lifetime(A) does not overlap lifetime(B)                  [Derived]
dimensions, format, sample count, layers, and usage match [Gated]
neither target is history, readback-pinned, externally exposed,
or retained by diagnostics                                      [Gated]
```

Track:

```text
firstWritePass
lastReadPass
residentBegin / residentEnd
historyPersistence
diagnosticPin
poolClass(format, size, samples, usage)
```

Peak live logical bytes are:

```text
peakLive = max_t(sum(bytes(resource) for resources live at t)) [Derived]
```

Resident bytes without actual aliasing are the sum of allocations, not
`peakLive`. Report both. Never alias current/previous history, a resource still
referenced by a node graph, or a target whose GPU use has not completed.

On tier changes, dispose removed nodes. To reclaim old PassNode attachments,
build a new pass/graph and dispose the old resources after a safe handoff; a
logical MRT toggle alone is not memory reclamation.

## Adaptive DPR With Hysteresis

### Inputs And Cost Model

Declare target frame rate `f_target` `[Authored]`:

```text
framePeriodMs = 1000 / f_target                           [Derived]
gpuBudgetMs = framePeriodMs - authoredGpuHeadroom          [Authored + Derived]
```

Use GPU timestamps when available `[Gated]`. Resolve them asynchronously at an
authored telemetry cadence. If unavailable, RAF/CPU intervals can detect
sustained missed deadlines but cannot identify pass GPU time.

r185 records render and compute timestamps in separate pools. A graph using
both must include both timing classes; render-only timestamps are not a
full-graph GPU duration. Even their sum is pass-duration evidence, not necessarily
end-to-end GPU-frame time: copies, barriers, encoder/submission gaps, and
presentation may be outside the pools. Label the timing scope and use platform
frame evidence when the acceptance gate requires end-to-end GPU latency.

Track CPU submission and presentation separately. CPU and GPU work can overlap,
so do not subtract CPU time from GPU time as though the frame were purely
serial; `authoredGpuHeadroom` is an explicit deadline/variance reserve.

Estimate scalable and fixed cost by measuring the same graph at two DPR scales
`s_a` and `s_b` `[Measured]`:

```text
A = (C_b - C_a) / (s_b^2 - s_a^2)                        [Derived]
F = C_a - A * s_a^2                                      [Derived]
C(s) ~= F + A * s^2                                      [Derived model]
s_budget = sqrt(max((gpuBudgetMs - F) / max(A, epsilon), 0)) [Derived]
```

Reject this model when its prediction error on a third measured scale exceeds
the authored tolerance `[Authored then Measured]`; geometry, culling, and cache
steps often violate a pure pixel-square model.

Require `A > epsilon` and `gpuBudgetMs > F` `[Gated: fitted model]`. Otherwise
hold the current DPR or select a cheaper quality tier; clamping an invalid fit
into the square root fabricates headroom.

### Controller

Use time-based, asymmetric hysteresis. Starting values below are all
`[Authored: controller seed, not device facts]`:

| Parameter | Starting value |
| --- | ---: |
| filtered GPU-time constant | `0.25 s` |
| downshift threshold | `1.05 * gpuBudgetMs` |
| sustained over-budget dwell | `0.25 s` |
| upshift threshold | `0.80 * gpuBudgetMs` |
| sustained under-budget dwell | `1.50 s` |
| post-change cooldown | `1.00 s` |
| downshift quantization | `1/16` DPR |
| upshift quantization | `1/32` DPR |

Required inequalities are `[Derived: hysteresis stability]`:

```text
upshiftThreshold < downshiftThreshold
upshiftDwell > downshiftDwell
upshiftStep <= downshiftStep
```

Controller pseudocode; symbolic operations are `[Derived]`, thresholds and
clamps are `[Authored then Measured]`:

```text
emaAlpha = 1 - exp(-dt / max(filteredTimeConstant, epsilon)) [Derived]
filtered += (observedGpuMs - filtered) * emaAlpha           [Derived]

if cooldownExpired and filtered > downshiftThreshold for downshiftDwell:
    dpr = quantizeDown(clamp(min(dpr - downshiftStep, s_budget), minDpr, maxDpr))
    beginCooldown()
else if cooldownExpired and filtered < upshiftThreshold for upshiftDwell:
    dpr = quantizeUp(clamp(min(s_budget, dpr + upshiftStep), minDpr, maxDpr))
    beginCooldown()
```

On DPR change:

- call `renderer.setPixelRatio()` and update size ownership;
- update explicit pass/effect/storage dimensions;
- invalidate or reseed temporal color, depth, AO, volumetric, and surface
  histories;
- reset jitter phase and meter sample layout if those depend on physical pixels;
- coalesce browser resize and DPR change to avoid double allocation churn;
- record old/new physical pixels, reason, timings, history resets, and peak
  allocation during resize.

If timestamps are unavailable, allow conservative downshift after sustained
missed frame periods, but do not aggressively upshift from vsync-quantized CPU
intervals. Maximum DPR is `[Measured]` per target, never inferred from desktop
or mobile labels.

## Full-Frame And Marginal Budgets

### Definitions

```text
C_base = complete required graph with optional effect disabled       [Measured]
Delta_i(G) = C(G with effect i) - C(G without effect i)              [Measured]
C_full = complete assembled graph                                    [Measured]
I = C_full - (C_base + sum(Delta_i(referenceGraph_i)))                [Derived]
```

`Delta_i` is conditional on its reference graph: enabling AO may add a normal
attachment; enabling selective bloom may add emissive; enabling TRAA adds
velocity and history. Therefore marginal costs are not freely commutative.
Record the exact base for each delta. If interactions are large, budget the
interacting bundle as one measured marginal.

Use deterministic camera/scene inputs, warm every candidate, and interleave
paired variants so shader compilation, thermal drift, and scene phase do not
become the reported marginal. Report a distribution and selected statistic,
not one frame.

Planning estimate:

```text
C_estimate = C_base + sum(compatible measured marginals)
             + interactionReserve                                  [Derived]
```

`interactionReserve` is `[Authored]`. Once `C_full` is measured, it is the
authority. Do not add this image coordinator's absolute full-post time to AO,
bloom, exposure, or TAA absolute times that it already includes.

### Required Timing Record

```yaml
evidence: Measured
threeRevision:
browserVersion:
gpuAdapter:
canvasCssPixels:
dpr:
canvasPhysicalPixels:
refreshTargetHz:
graphHash:
warmupPolicy:
timingStatistic:
timestampSource:
fullGraphGpuMs:
baseGraphGpuMs:
marginals:
interactions:
sceneRenders:
fullscreenDraws:
computeDispatches:
logicalResidentBytes:
peakLiveLogicalBytes:
physicalMemoryEvidence:
```

### Internal Node Accounting

For the r185 `BloomNode` five-level private chain
`[Derived: installed source]`, with base pixel count `P` and bloom scale `s`:

```text
mipPixelSum = P*s^2 * sum(i=0..4, 4^-i)                 [Derived]
logicalBloomPixelSlots = P*s^2 + 2*mipPixelSum          [Derived]
draws = 1 high-pass + 2*5 blur + 1 composite = 12       [Derived]
```

This is logical accounting, not physical allocation evidence. GTAO and TRAA
costs use their actual enabled resolution, target formats, copies, and
diagnostic branches. Never label a private target "transient" simply because
its last read is early.

## Quality Tiers

Choose tiers from measured failure pressure, not device names:

| Tier | Gate | Deterministic reductions |
| --- | --- | --- |
| Full | full graph meets time, memory, stability, and visual contracts `[Measured]` | authored full graph |
| Bandwidth-limited | wider MRT or reduced passes exceed marginal/thermal budget `[Measured]` | remove unused MRT; depth-reconstruct normal; lower AO/bloom scale; reduce meter samples |
| Temporal-off | velocity/rejection/reset contract fails or history exceeds budget `[Gated]` | remove velocity/history; use measured spatial AA/reconstruction path |
| Fixed-exposure/minimum post | compute/post marginal exceeds budget `[Measured]` | fixed EV, essential output transform, UI; retain no-post readability |
| Diagnostics | authoring/capture `[Authored]` | one pinned debug output at a time; never infer shipping residency from this tier |

The degrade order follows visual causality: remove optional post/history before
damaging source geometry, material, or lighting identity. Recompute full-graph
evidence after each tier change.

## Lifecycle

- initialize the renderer before feature tests, compute, target init, or timing;
- create pass outputs before `scenePass.compileAsync(renderer)`;
- warm the shipping graph and each allowed tier before timing;
- do not mutate an output graph without `renderPipeline.needsUpdate = true`;
- on resize/DPR, update every explicit texture/storage dimension and history;
- avoid simultaneous old/new graph residency beyond the measured peak budget;
- dispose `GTAONode`, `BloomNode`, `TRAANode`, custom targets, pass resources,
  materials, and storage when removed;
- record allocation, resize, tier switch, device-loss, and disposal events;
- test repeated create/resize/toggle/dispose loops for stable resident counts.

## Diagnostics And Acceptance

Expose stable views:

```text
no-post scene-linear baseline
raw depth, reconstructed view-Z, sky classification
normal reconstruction versus normal MRT
emissive, velocity, albedo/base, IDs actually enabled
direct/indirect separation and AO contribution
transparent/refractive inclusion policy
temporal current/history/rejected/velocity/jitter/reset reason
meter source before bloom and adapted EV
bloom source, private-chain cost summary, contribution
pre-tone-map, tone-mapped-linear, LUT input/output
output conversion and alpha premultiplication stage
resource lifetime intervals, diagnostic pins, resident/peak-live bytes
per-pass scale, physical dimensions, format, draws/dispatches, GPU time
adaptive-DPR filtered time, thresholds, dwell, cooldown, reason
```

Acceptance requires:

- paired MRT versus reconstruction/narrow-pass timings on each target
  `[Measured]`;
- full graph within declared GPU and resident budgets `[Measured]`;
- fixed-view comparison at every shipping tier `[Measured]`;
- vertical and horizontal velocity tests with no sign-dependent ghosting
  `[Derived contract, Measured result]`;
- resize, DPR, cut, projection, and deformation reset evidence `[Measured]`;
- output-transform isolation with one tone-map and one conversion owner
  `[Derived]`;
- no-post baseline preserving subject/material/lighting readability
  `[Authored, then Measured]`;
- leak loop with stable resource counts after disposal `[Measured]`.

## Rejected Architectures

- unconditional `output + normal + albedo + emissive + velocity` MRT;
- depth duplicated into a color attachment without a measured consumer need;
- normal MRT retained for one AO consumer when depth reconstruction wins;
- compact format memory claimed while r185 PassNode attachments still clone HDR
  output format;
- final-color AO multiplication presented as physically correct composition;
- bloom before temporal resolve by habit, causing broad glare history ghosts;
- exposure before temporal history without exposure-ratio compensation;
- velocity UV conversion without r185's Y flip;
- a reset-event checklist without executable reset ownership;
- built-in private targets counted as transient aliases;
- toggling MRT keys and claiming memory was reclaimed without rebuilding;
- summing absolute coordinator and atomic-effect budgets;
- adaptive DPR driven by single-frame spikes or symmetric thresholds;
- CPU RAF intervals reported as pass GPU timings;
- every color texture tagged sRGB regardless of source transfer;
- `renderOutput()` plus enabled automatic output transform;
- a display LUT moved between linear and encoded domains without rebuilding.
