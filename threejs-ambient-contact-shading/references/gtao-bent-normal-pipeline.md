# GTAO and bent-normal pipeline

This reference specifies a WebGPU/TSL ambient-visibility graph for Three.js
r185. It covers the forward-lighting dependency, GTAO cost model, spatial and
temporal reconstruction, mobile bandwidth, and the narrow case for bent
normals.

## Numeric provenance

- **[Derived]**: obtained from the installed r185 source or a displayed
  equation.
- **[Gated]**: a branch threshold that must pass validation.
- **[Measured]**: evidence from the target scene/device.
- **[Authored]**: a starting value or planning ceiling.

Version numbers and list ordering are identifiers rather than tuning claims.

## Forward-lighting dependency

The stock forward graph has this dependency:

```text
current depth/normal -> GTAO visibility -> NodeMaterial indirect lighting
```

`builtinAOContext()` is evaluated while materials are shaded, so visibility
must already exist. r185 `pass(scene, camera)` produces depth/normal only after
rendering the scene. Therefore correct current-frame material-context AO needs
two scene renders:

```text
input scene pass -> GTAO/reconstruction -> context-lit scene pass
```

The input pass is not a free depth prepass: stock `PassNode` renders the normal
scene materials, creates an HDR color target, and optionally adds normal and
velocity MRT targets. If the application already has a deferred/indirect-light
buffer, apply AO there and avoid the second forward render. Otherwise, screen
AO is accepted only when the complete measured delta fits the declared budget
**[Gated]**. A final-color multiply is not an acceptable cost reduction.

The stock skeleton below disables transparent draws and MSAA on the AO input
pass. Transparent surfaces are neither reliable solid occluders nor receivers
of `builtinAOContext()` in r185. A custom depth/normal-only prepass can remove
the unused HDR color write, but it is accepted only after deformation,
instancing, alpha-test/discard, sidedness, and depth parity match the lit pass
**[Gated]**. A generic override material does not prove that parity.

## Source-verified r185 diagnostic scaffold

The following skeleton uses APIs present in installed `three@0.185.1`
**[Measured]**. Static source proof does not establish WebGPU graph compilation,
R8 renderability on the target, visual correctness, or speed. Treat it as a
diagnostic scaffold until the runtime gates pass. It shows the expensive,
lighting-correct forward dependency; do not copy it before passing the budget
gate.

```js
import * as THREE from 'three/webgpu';
import {
  builtinAOContext,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  rtt,
  screenUV,
  velocity
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

const renderer = new THREE.WebGPURenderer( {
  antialias: false,
  reversedDepthBuffer: false,
  outputBufferType: THREE.HalfFloatType
} );

await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'WebGPU is required.' );
}

const pipeline = new THREE.RenderPipeline( renderer );
pipeline.outputColorTransform = false;

const inputPass = pass( scene, camera, { samples: 0 } ); // [Authored] no MSAA
inputPass.transparent = false;
inputPass.setMRT( mrt( {
  output,
  normal: normalView,
  velocity
} ) );

const depthTexture = inputPass.getTextureNode( 'depth' );
const normalTexture = inputPass.getTextureNode( 'normal' );
const velocityTexture = inputPass.getTextureNode( 'velocity' );

const gtao = ao( depthTexture, normalTexture, camera );
gtao.resolutionScale = 0.5; // [Authored] starting scale
gtao.samples.value = 16; // [Authored] -> 36 depth taps [Derived]
gtao.radius.value = contactRadius;
gtao.thickness.value = acceptedDepthThickness;

const rawVisibility = gtao.getTextureNode();
const reconstructedNode = denoise(
  rawVisibility,
  depthTexture,
  normalTexture,
  camera
);

// Materialize the 17-sample [Derived] denoise once, at full output scale.
const visibilityTexture = rtt( reconstructedNode, null, null, {
  colorSpace: THREE.NoColorSpace,
  depthBuffer: false,
  format: THREE.RedFormat,
  type: THREE.UnsignedByteType
} );

// Critical: material graphs otherwise resolve TextureNode coordinates to mesh UVs.
const visibility = visibilityTexture.sample( screenUV ).r;

const litPass = pass( scene, camera );
litPass.contextNode = builtinAOContext( visibility );
const hdrBeauty = litPass.getTextureNode( 'output' );

const temporalEnabled = false; // [Authored] enable only after the gates below
let finalHDR = hdrBeauty;

if ( temporalEnabled ) {
  gtao.useTemporalFiltering = true;
  finalHDR = traa( hdrBeauty, depthTexture, velocityTexture, camera );
}

pipeline.outputNode = renderOutput( finalHDR );
pipeline.needsUpdate = true;
```

`inputPass.compileAsync(renderer)` warms scene variants only. It does not prove
that `GTAONode`, reconstruction RTT, TRAA, or the final pipeline graph is
compiled; warm and time the complete graph on the target device.

When denoise is disabled, use
`rawVisibility.sample(screenUV).r`. `rawVisibility.r` is wrong inside a mesh
material graph because its implicit coordinate is the mesh UV attribute.

## Depth convention gate

Installed r185 `GTAONode`:

- samples its depth texture directly;
- converts logarithmic depth;
- discards `depth >= 1` **[Derived]**;
- contains no `renderer.reversedDepthBuffer` branch **[Derived]**.

Stock GTAO is therefore gated to standard depth. Reversed depth clears to the
opposite end and invalidates the sky test and reconstruction semantics. Do not
pass a reversed depth texture and claim support. A custom adapter must prove
sky classification, near/far reconstruction, occluder ordering, and the full
fixture suite before it replaces this gate.

For standard depth, validate:

- sky/background resolves to visibility `1` **[Derived physical bound]**;
- a fronto-parallel plane reconstructs monotonic negative view Z;
- orthographic and asymmetric projections preserve the intended world radius;
- DPR/resize changes update every target before the next accepted capture.

## GTAO sampling cost

r185 converts the exposed `samples` control into directions and steps:

```text
D = samples < 30 ? 3 : 5                              [Derived]
S = floor((samples + D - 1) / D)                     [Derived]
horizon depth taps = 2 * D * S                       [Derived]
```

Examples:

| `samples` | directions | steps | depth taps | Provenance |
| ---: | ---: | ---: | ---: | --- |
| `8` | `3` | `3` | `18` | **[Derived]** |
| `16` | `3` | `6` | `36` | **[Derived]** |
| `32` | `5` | `7` | `70` | **[Derived]** |

If `normalNode` is `null`, the center normal costs `9` additional depth loads
per GTAO pixel **[Derived]**. This is often preferable to storing a full normal
attachment for a small raw AO pass, but not automatically. Compare measured
attachment delta against measured reconstruction delta.

The radius is in scene units, not pixels or assumed meters. Let `g` be the
largest visible separation that should still read as contact. Start with
`radius in [g, 2g]` and `thickness in [0.1 radius, 0.5 radius]` **[Authored]**,
then reject any value that creates occlusion across a known open gap
**[Gated]**. `distanceExponent` is documented in `[1, 2]` and
`distanceFallOff` in `[0, 1]` by r185 **[Derived API domain]**; choose them only
after radius and thickness are fixed.

## Reconstruction choice

Half-scale GTAO reduces AO pixels to `0.25 * width * height` **[Derived]**.
Sampling that texture at full resolution invokes ordinary texture filtering;
it does not inspect depth or normals.

Decision table:

| Condition | Choice |
| --- | --- |
| Raw half/quarter AO passes edge-error fixtures | Sample raw visibility with `screenUV`; pay no denoise. |
| Edge halos or block structure fail | Materialize `rtt(denoise(...))` once, then sample its texture with `screenUV`. |
| Denoise is active | Prefer MRT normals. With MRT normals the expression performs about `17` AO, `17` depth, `17` normal, and `1` noise fetch, or `52` fetches per output pixel **[Derived shader count]**. With reconstructed normals, center plus `16` neighbors add `17 * 9 = 153` normal-reconstruction depth loads, raising the approximate total to `188` **[Derived shader count]**. |
| Full-resolution material overdraw is high | Never inline `denoise()` in `builtinAOContext()`; the `17` evaluations repeat per shaded fragment **[Derived]**. |
| Thin/alpha-masked surfaces still fail | Reduce radius/thickness, use MRT normals, or omit screen AO for those surfaces/tier. More blur is not a fix. |

The r185 denoiser weights luma, projected depth difference, and normal
similarity. It is an edge-aware spatial filter, not a temporal accumulator.
Tune it with a raw-AO and bilateral-weight view; a smooth final beauty image is
insufficient evidence.

## Normal input decision

Stock `PassNode` clones its half-float output texture for MRT attachments. A
normal attachment therefore occupies `8 * width * height` bytes **[Derived]**
before MSAA, padding, and tile scratch.

Use MRT normal when any gate passes:

- another selected effect already owns it;
- reconstruction is materialized at full resolution;
- smooth or thin geometry fails depth-normal reconstruction;
- measured MRT delta is lower than measured reconstruction delta.

Use depth reconstruction when all gates pass:

- AO is the only normal consumer;
- raw AO runs at reduced resolution;
- silhouettes/hard edges pass;
- the target tile GPU shows a net win after attachment stores are included.

On tile-based GPUs, adding a full-resolution attachment can lower tile
occupancy or cause external-memory stores. Conversely, repeated depth reads can
defeat texture cache locality. Architecture is selected by paired measurements,
not by the discrete-GPU result.

Keep the AO input pass single-sampled. If renderer-wide antialiasing selects
`4` samples **[Derived r185 default WebGPU MSAA count when enabled]**, an
unqualified `pass(scene, camera)` inherits that count; color, normal, and depth
then pay multisample tile storage and resolve traffic. Pass `{ samples: 0 }`
**[Authored gate]** explicitly, or prove a different count by target-device
timing.

## Temporal contract

`GTAONode.useTemporalFiltering = true` changes the sampling rotation over a
cycle of `6` authored source rotations **[Derived from r185 array length]**. It
does not allocate AO history or reproject visibility. `TRAANode` performs the
actual full-image temporal resolve.

Enable temporal GTAO only when all gates pass:

- MSAA is disabled, as required by `TRAANode` **[Gated]**;
- beauty, depth, and velocity have identical dimensions **[Gated]**;
- velocity includes camera, rigid, skinned/deforming, instanced, and relevant
  alpha-masked motion **[Gated]**;
- moving occluder, disocclusion, camera rotation, and resize fixtures pass
  **[Gated]**;
- TRAA was already selected or its entire marginal time/memory is charged to AO
  **[Gated]**.

r185 TRAA automatically restarts history after a size change but exposes no
public camera-cut reset **[Derived]**. On a camera cut, projection-mode change,
or teleport, create a new TRAA node, replace the pipeline output, set
`needsUpdate = true`, and dispose the old node. Do not mutate private history
targets.

Two full-resolution RGBA16F TRAA color targets account for
`16 * width * height` bytes, excluding depth/history implementation details
**[Derived lower bound]**. This is not a cheap AO-only history path.

## Lighting application

`builtinAOContext(visibility)` multiplies the material AO term. r185 physical
lighting applies it to indirect diffuse and computes specular occlusion for
indirect reflection; direct light and emission remain outside the multiply.

The context deliberately returns the unmodified AO input for transparent
materials **[Derived]**. For transparency, declare one policy:

- no screen AO for the surface;
- an authored `aoNode` appropriate to the transparent medium;
- a custom lighting model with validated transmittance/indirect visibility.

Do not silently darken transparent final color.

## Bent-normal extension

Scalar visibility is sufficient unless directional environment response is a
declared visual requirement. A bent normal is the normalized mean direction of
unoccluded incident radiance under the chosen weighting; it is not the
geometric normal and not merely the least-occluded sample.

Build a custom bent-normal gather only when all gates pass:

- the scalar baseline already passes contact and halo tests;
- directional environment tint is visible and required;
- the custom gather beats the scalar baseline at the same target quality
  **[Measured]**;
- view/world-space ownership is explicit;
- the one-wall sign fixture passes **[Gated]**.

Implementation requirements:

- Accumulate visibility-weighted directions in view space, normalize after
  filtering, and transform to world space exactly once.
- Preserve scalar visibility separately; direction is undefined near zero
  visibility and must not drive an unbounded environment lookup.
- Use independent projection axes and texel size
  `(1 / width, 1 / height)` **[Derived]**. X-only projection or width-derived Y
  offsets fail non-square/asymmetric views.
- Use depth and normal weights during reconstruction. Renormalize the direction
  after filtering.
- Port the current r185 cosine-weighted horizon integral and compare it against
  `GTAONode`; a simplified dot-product horizon heuristic is diagnostic only.
- Use RGBA16F only when RGB direction plus scalar visibility are needed. Its
  reduced-resolution storage is `8 * scale^2 * width * height` bytes
  **[Derived]**.

One-wall sign fixture:

```text
receiver beside one vertical wall
  -> display geometric normal
  -> display decoded bent direction
  -> verify bent direction points away from the blocked hemisphere [Gated]
```

If environment tint points into the wall, disable directional use. More samples
cannot repair a sign or basis error.

## Composable cost ledger

Measure the complete graph and each shareable delta:

```yaml
ambientContactBudget:
  declaredMarginalMs: <Authored>
  inputScenePassMs: <Measured; zero only when genuinely shared>
  normalAttachmentDeltaMs: <Measured>
  velocityAttachmentDeltaMs: <Measured>
  gtaoMs: <Measured>
  reconstructionMs: <Measured>
  secondLitScenePassMs: <Measured>
  traaMarginalMs: <Measured; zero only when already selected>
  totalMarginalMs: <Derived sum of charged rows>
  valid: <Gated totalMarginalMs <= declaredMarginalMs>
```

Memory equations for r185 defaults:

| Resource | Bytes | Provenance |
| --- | ---: | --- |
| Each full-resolution half-float PassNode color/normal/velocity target | `8WH` | **[Derived]** |
| Built-in scalar GTAO R8 target | approximately `s^2 WH` | **[Derived]** |
| Materialized full-resolution R8 visibility | approximately `WH` | **[Derived]** |
| Reduced bent normal plus visibility RGBA16F | `8s^2 WH` | **[Derived]** |

`W` and `H` are physical drawing-buffer dimensions and `s` is AO linear scale.
MSAA storage, depth, alignment, backend padding, and tile scratch are additional.

Gather/reconstruction rejection ceilings excluding the second scene pass are
`1.2 ms` at `2560x1440` half scale on discrete desktop, `1.8 ms` at
`1920x1080` half scale on integrated desktop, and `2.0 ms` at `1280x720`
quarter-to-third scale on mobile **[Authored]**. Add every charged row above;
never compare the gather alone with the frame budget.

## Fixed-view validation

Required views:

```text
raw depth and linear view Z
sky classification
MRT and reconstructed normals
raw GTAO
reconstructed visibility
screenUV mapping test on meshes with incompatible UV layouts
history-valid/rejected pixels and velocity magnitude
indirect contribution before/after AO
direct and emissive residuals
bent direction in view and world space
per-pass GPU time and attachment inventory
```

Required fixtures and failure signatures:

| Fixture | Failure signature | Decision |
| --- | --- | --- |
| UV-seam meshes | AO stretches or follows each object's UV islands | Sample visibility with `screenUV`. |
| Thin foreground silhouette | dark exterior halo | Reconstruction crossed depth/normal discontinuity. |
| Transparent surface crossing opaque geometry | glass/smoke becomes a solid occluder or unexpectedly receives AO | Keep the input pass opaque-only and declare a transparent lighting policy. |
| Hard direct light beside emitter | either turns gray | AO is multiplying final color. |
| Screen-edge occluder | contact pops as it leaves view | Screen-space limitation; accept or use authored visibility. |
| Smooth curved surface | faceted/crawling contact | Reconstructed normal failed. |
| Moving/deforming occluder | history trail | Velocity/rejection failed; temporal mode is rejected. |
| Non-square and asymmetric projection | elliptical radius or unequal blur | Projection axes/texel size were collapsed. |
| One-wall bent normal | direction points into wall | Sign/basis error; directional tint stays disabled. |
| AO disabled | unchanged GPU time | AO remains reachable in the active node graph. |

Acceptance requires target-device timings, the complete marginal sum, fixed
captures with AO on/off, and proof that direct light and emission are invariant.
