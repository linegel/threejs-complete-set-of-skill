# GTAO And Bent-Normal Pipeline

This reference contains branch-specific Three.js r185 WebGPU/TSL facts. Labels
mean: **Derived** from source/equations, **Gated** by target validation,
**Measured** on the named workload/device, and **Authored** as intent.

## r185 graph and API gates

The stock forward dependency is:

```text
current depth/normal -> GTAO visibility -> NodeMaterial indirect lighting
```

`pass(scene, camera)` produces current depth/normal only after its scene render;
`builtinAOContext()` is consumed during the lit render. Correct current-frame
forward AO therefore needs two scene renders. A deferred renderer with a distinct
indirect term may apply visibility there instead.

Source-verified r185 facts:

| Fact | Consequence |
| --- | --- |
| `ao(depthNode, normalNode, camera)` accepts `normalNode = null` | Start from the built-in scalar node. |
| `resolutionScale` is a property; there is no setter | Assign it directly. |
| Scalar output is `RedFormat`; default scale is `1` | Keep visibility single-channel. |
| `DenoiseNode` evaluates center plus 16 neighbors | Materialize it once before scene overdraw. |
| Depth-normal reconstruction performs 9 depth loads | Compare reconstruction with an MRT attachment. |
| `useTemporalFiltering` only rotates the GTAO pattern | A live TRAA/custom resolve owns history. |
| GTAO rejects `depth >= 1` and has no reversed-depth branch | Stock GTAO requires standard depth. |
| TRAA resets on resize but exposes no camera-cut reset | Rebuild/dispose it on discontinuity. |
| `builtinAOContext()` skips transparent materials | Transparency needs an explicit material policy. |
| A texture without coordinates uses mesh `uv()` in a material graph | Sample visibility with `screenUV`. |

Initialize and gate before constructing the graph:

```js
await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'WebGPU is required.' );
}

if ( renderer.reversedDepthBuffer === true ) {
  throw new Error( 'Stock r185 GTAO requires standard depth.' );
}
```

For standard depth, prove sky visibility is `1`, fronto-parallel view Z is
monotonic, orthographic and asymmetric projections preserve world radius, and
resize/DPR updates every target. A custom reversed-depth node must pass the same
fixtures with its own sky and ordering rules.

### Diagnostic scaffold

This is the lighting-correct stock-forward shape, not evidence that its cost
passes:

```js
import * as THREE from 'three/webgpu';
import {
  builtinAOContext, mrt, normalView, output, pass, renderOutput,
  rtt, screenUV, velocity
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

const pipeline = new THREE.RenderPipeline( renderer );
pipeline.outputColorTransform = false;

const inputPass = pass( scene, camera, { samples: 0 } );
inputPass.transparent = false;
const inputOutputs = { output, normal: normalView };
if ( temporalEnabled ) inputOutputs.velocity = velocity;
inputPass.setMRT( mrt( inputOutputs ) );

const depth = inputPass.getTextureNode( 'depth' );
const normal = inputPass.getTextureNode( 'normal' );
const motion = temporalEnabled
  ? inputPass.getTextureNode( 'velocity' )
  : null;

const gtao = ao( depth, normal, camera );
gtao.resolutionScale = 0.5; // Authored start
gtao.samples.value = 16;    // 36 depth taps, Derived
gtao.radius.value = contactRadius;
gtao.thickness.value = depthThickness;

const raw = gtao.getTextureNode();
const reconstructed = rtt( denoise( raw, depth, normal, camera ), null, null, {
  colorSpace: THREE.NoColorSpace,
  depthBuffer: false,
  format: THREE.RedFormat,
  type: THREE.UnsignedByteType
} );

const visibility = reconstructed.sample( screenUV ).r;
const separateExcludedLayers =
  temporalEnabled || externalLayerCompositorOwned;
const litPass = pass( scene, camera );
litPass.transparent = ! separateExcludedLayers;
litPass.contextNode = builtinAOContext( visibility );
let finalHDR = litPass.getTextureNode( 'output' );

if ( temporalEnabled ) {
  gtao.useTemporalFiltering = true;
  finalHDR = traa( finalHDR, depth, motion, camera );
}

if ( separateExcludedLayers ) {
  finalHDR = composeExcludedLayers(
    finalHDR,
    excludedTransparentAndRefractiveLayers
  );
}

pipeline.outputNode = renderOutput( finalHDR );
pipeline.needsUpdate = true;
```

`composeExcludedLayers(...)`, `excludedTransparentAndRefractiveLayers`, and
`externalLayerCompositorOwned` are application-owned placeholders, not r185
exports. The ordinary non-temporal
stock-forward branch leaves `litPass.transparent` enabled, so r185 keeps its
built-in transparent/transmission rendering and no extra composition is added.
A temporal resolve, or an already-owned external compositor, renders only the
admitted layers and composes excluded layers afterward with the declared alpha
and ordering contract. Do not send excluded layers through TRAA unless beauty,
depth, velocity, coverage, and rejection describe the same membership. Charge
their separate rendering and composition whenever `separateExcludedLayers` is
true; when an external compositor is shared, charge AO only its marginal delta.

The non-temporal graph omits the velocity MRT output and its full-resolution
attachment. Add it only when the selected temporal resolve consumes motion, or
reuse a compatible velocity attachment already owned by the shared scene pass.

With no reconstruction, use `raw.sample(screenUV).r`. Embedding `raw.r` or the
materialized texture's `.r` directly in a mesh material samples through mesh UVs.
`inputPass.compileAsync(renderer)` warms scene variants only; warm and time the
complete GTAO/reconstruction/temporal/output graph.

A custom depth/normal-only input pass may remove the unused HDR color write only
after visible-pass parity passes for deformation, instancing, alpha test/discard,
sidedness, and depth. A generic override material does not prove that parity.

## Reconstruction and cost

r185 converts `samples` into directions and steps:

```text
D = samples < 30 ? 3 : 5
S = floor((samples + D - 1) / D)
horizon depth taps = 2 * D * S

samples 8  -> 18 taps
samples 16 -> 36 taps
samples 32 -> 70 taps
```

If `normalNode` is null, the center normal adds 9 depth loads per AO pixel.
Half-scale AO has `0.25WH` pixels. Upsampling it with ordinary texture filtering
does not inspect depth or normals.

Choose reconstruction by observable error:

| Observation | Decision |
| --- | --- |
| Raw reduced AO passes silhouette and gap fixtures | Sample raw visibility with `screenUV`. |
| Halos or block structure fail | Materialize `rtt(denoise(...))` once. |
| Reconstruction is active | Prefer MRT normals: about 17 AO + 17 depth + 17 normal + 1 noise fetch = 52 fetches/output pixel. Reconstructing every normal adds `17 * 9 = 153` depth loads, about 188 total. |
| Thin/alpha-masked surfaces still fail | Reduce radius/thickness, use MRT normals, or omit AO for that tier. |

Use depth reconstruction when AO is the only normal consumer, raw AO is
reduced-resolution, silhouettes pass, and the target-device comparison beats
the MRT delta. Use an MRT normal when shared, when materialized reconstruction
needs it, when smooth/thin geometry fails, or when its measured delta wins.
Keep the AO input pass single-sampled unless another count is explicitly proven.

Radius is a world-space distance, not pixels. For physical scale:

```text
radiusRender    = radiusMeters    * renderUnitsPerMeter
thicknessRender = thicknessMeters * renderUnitsPerMeter
biasRender      = biasMeters      * renderUnitsPerMeter  // only dimensioned bias
```

Normalized-depth, angular, and unitless controls retain their own dimensions.
An authored-look radius is explicitly scene-unit-only and is re-authored or
validated after scaling. Establish radius from the largest intended contact gap;
reject any value that darkens across a known open gap.
After radius and thickness pass, keep r185 `distanceExponent` in its `[1, 2]`
domain and `distanceFallOff` in `[0, 1]`; tune them against the same gap fixture.

`builtinAOContext(visibility)` affects material AO/indirect response; direct
light and emission stay outside the multiply. Transparent materials require one
declared branch: no screen AO, authored `aoNode`, or a transmittance-aware custom
lighting model.

### Resource equations

For physical drawing-buffer `W x H` and AO scale `s`, r185 lower bounds are:

| Resource | Bytes |
| --- | ---: |
| full-resolution half-float PassNode color/normal/velocity target | `8WH` each |
| built-in scalar GTAO R8 target | approximately `s^2 WH` |
| materialized full-resolution R8 visibility | approximately `WH` |
| reduced bent direction plus visibility RGBA16F | `8s^2 WH` |
| two full-resolution RGBA16F TRAA color targets | `16WH` |

MSAA, depth, alignment, backend padding, and tile scratch are additional. On a
tile GPU an MRT attachment can force stores; on another target repeated depth
reads can cost more. Measure the complete marginal graph with one camera path:

```text
deltaAO = time(complete AO graph) - time(no-screen-AO graph)
```

Attribute the input pass once. If shared, charge only AO's attachment delta;
if AO created it, charge the entire pass. Separately expose normal, velocity,
GTAO, reconstruction, second-lit-pass, and temporal deltas so a bottleneck can
be acted on.

## Temporal contract

`useTemporalFiltering` cycles six source rotations in r185; it supplies no
history. Temporal AO requires:

- MSAA disabled for r185 TRAA;
- beauty, depth, and velocity at identical dimensions;
- identical admitted layer membership across beauty, depth, and velocity;
- camera, rigid, skinned/deforming, instanced, and relevant alpha motion;
- excluded transparent/refractive layers composed after the resolve unless they
  provide matching depth, velocity, coverage, and rejection inputs;
- disocclusion rejection and passing motion/resize fixtures;
- the entire TRAA marginal cost charged when it was not already selected.

Reset or reseed on geometry/deformation/coverage changes, camera or projection
cuts, uncompensated origin changes, AO radius/thickness/bias or scale changes,
resolution/quality migration, and device/resource loss. A compensated coordinate
rebase preserves scalar AO only when previous/current transforms preserve the
same metric scale; history still needs a proven frame bridge. Shadow/emission-
only radiance changes preserve scalar visibility but must reject affected color
history.

r185 TRAA has no reactive-mask input or public general reset. Use a proven
wrapper/custom node, or conservatively rebuild/reset. On rebuild, replace the
pipeline output, set `needsUpdate = true`, dispose the old node, and verify
resource counters plateau.

## Bent-normal extension

A bent normal is the normalized visibility-weighted mean unoccluded direction.
It is neither the geometric normal nor the least-occluded sample. Add it only
after scalar AO passes and directional environment response warrants its cost.

- Accumulate directions in view space using the current r185 cosine-weighted
  horizon integral; compare scalar visibility with `GTAONode`.
- Use independent projection axes and texel size `(1 / width, 1 / height)`.
- Filter with depth and normal weights, renormalize, and transform to world
  space exactly once.
- Preserve scalar visibility separately. Direction is undefined near zero
  visibility and cannot drive an unbounded lookup.
- Use RGBA16F only when RGB direction and scalar visibility coexist.

One-wall fixture:

```text
receiver beside one vertical wall
  -> display geometric normal
  -> display decoded bent direction
  -> direction points away from the blocked hemisphere
```

A failed sign/basis fixture disables directional use; more samples cannot repair
it.

## Focused validation

| Fixture or diagnostic | Failure signature | Decision |
| --- | --- | --- |
| Meshes with incompatible UV layouts | AO follows UV islands or stretches per object | Sample visibility with `screenUV`. |
| Thin foreground silhouette | Dark exterior halo | Repair depth/normal-aware reconstruction or reduce radius/thickness. |
| Transparent crossing | Medium becomes an opaque occluder/receiver | Enforce the declared transparent policy. |
| Hard direct light and emitter | Either darkens | AO is applied after lighting; move it to indirect response. |
| Screen-edge occluder | Contact pops when the occluder leaves view | Accept screen-space loss or use authored visibility. |
| Smooth curve | Faceted/crawling contact | Use MRT normals or omit the failing tier. |
| Moving/deforming occluder | Trail | Repair velocity/rejection or disable temporal AO. |
| Non-square/asymmetric projection | Elliptical radius or unequal blur | Restore independent axes and texel sizes. |
| One-wall bent normal | Direction points into wall | Fix basis/sign; keep directional use disabled. |
| AO disabled | GPU time/work unchanged | Remove AO from the active graph and dirty the pipeline. |

Acceptance requires AO-on/off captures, direct/emissive residuals, edge and
motion fixtures for the selected branches, complete marginal target-device
timing, attachment inventory, and a disposal/recreation plateau.
