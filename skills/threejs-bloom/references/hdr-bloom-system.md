# HDR bloom reference

Load only the section named by the active `SKILL.md` branch. API facts are for
Three.js r185; performance claims require the named scene, browser, GPU,
physical resolution, and complete graph.

## Contents

- [r185 graphs and transparent blending](#r185-graphs-and-transparent-blending)
- [BloomNode PSF and work](#bloomnode-psf-and-work)
- [Exposure, output, and lifecycle](#exposure-output-and-lifecycle)
- [Budget and acceptance](#budget-and-acceptance)

## r185 graphs and transparent blending

### Verified node behavior

- `bloom(input, strength, radius, threshold)` and
  `BloomNode.setResolutionScale()` exist.
- The default internal linear scale is `0.5`.
- High-pass weight is
  `smoothstep(threshold, threshold + smoothWidth, luminance(input.rgb))`.
- Five mip levels use separable kernel radii `[6, 10, 14, 18, 22]`.
- `radius` mixes fixed cross-mip weights; it does not change kernel support.
- Internal bright and blur targets are RGBA16F.
- Blur stages write alpha `1`, and the composite carries nonzero alpha.
- MRT output `output` inherits material blending by default; other named
  outputs default to no blending.
- r185 `MRTNode.merge()` writes merged modes to `blendings` rather than the
  operative `blendModes` map, so a material `mrtNode` can discard the scene's
  configured emissive blend mode.
- `PassNode.compileAsync()` warms the scene pass, not BloomNode's fullscreen
  materials.

Initialize the renderer before testing the backend:

```js
await renderer.init();
if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'Native WebGPU is required.' );
}
```

### Full-scene graph

```js
import * as THREE from 'three/webgpu';
import { pass, renderOutput, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const pipeline = new THREE.RenderPipeline( renderer );
pipeline.outputColorTransform = false;

const scenePass = pass( scene, camera, { samples: sceneSampleCount } );
const sceneHDR = scenePass.getTextureNode( 'output' );
const glare = bloom( sceneHDR, strength, spread, sceneThreshold );
glare.smoothWidth.value = softKnee;
glare.setResolutionScale( bloomScale );

pipeline.outputNode = renderOutput(
  vec4( sceneHDR.rgb.add( glare.rgb ), sceneHDR.a )
);
pipeline.needsUpdate = true;
```

This path captures visible emission, direct response, reflection,
transmission, and composited transparency without a membership attachment.

### Selective graph

```js
import * as THREE from 'three/webgpu';
import { emissive, mrt, output, pass, renderOutput, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const pipeline = new THREE.RenderPipeline( renderer );
const scenePass = pass( scene, camera, { samples: sceneSampleCount } );
const sceneMRT = mrt( { output, emissive } );
sceneMRT.setBlendMode(
  'emissive',
  new THREE.BlendMode( THREE.MaterialBlending )
);
scenePass.setMRT( sceneMRT );

const sceneHDR = scenePass.getTextureNode( 'output' );
const contribution = scenePass.getTextureNode( 'emissive' );
const glare = bloom( contribution, strength, spread, threshold );
glare.smoothWidth.value = softKnee;
glare.setResolutionScale( bloomScale );

pipeline.outputColorTransform = false;
pipeline.outputNode = renderOutput(
  vec4( sceneHDR.rgb.add( glare.rgb ), sceneHDR.a )
);
pipeline.needsUpdate = true;
```

Both graphs use one scene traversal. The selective graph adds a full-resolution
HDR attachment; it does not add a selection render.

### Transparent contribution

Keep visible output and selective contribution on the same material path so
they share animation, discard, depth, sorting, blend family, and alpha
convention. For an additive premultiplied emitter:

```js
import { color, float } from 'three/tsl';

const alpha = float( authoredOpacity );
const radiance = color( authoredColor ).mul( float( authoredIntensity ) );
const material = new THREE.SpriteNodeMaterial( {
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  premultipliedAlpha: true
} );

material.colorNode = color( 0x000000 );
material.opacityNode = alpha;
material.emissiveNode = radiance.mul( alpha );
```

`BlendMode(MaterialBlending)` makes the emissive attachment use that material
blend state. For ordinary alpha/transmission or custom factors, derive the
contribution from the same alpha convention and verify order and occlusion.

When visible emission must diverge from bloom membership, use a separately
timed contribution pass or a source-verified merge fix. That branch no longer
has the one-scene-pass cost profile.

Verify:

- one transparent layer over opaque geometry;
- two overlapping layers in both insertion orders;
- additive and alpha-blended policies separately;
- depth intersection, offscreen clipping, and animated deformation;
- contribution texture against the visible material state.

## BloomNode PSF and work

BloomNode computes:

```text
bright pass
  -> five progressive mip levels
  -> horizontal and vertical Gaussian blur at every level
  -> weighted five-level composite
```

| Property | r185 value | Meaning |
| --- | ---: | --- |
| mip count | `5` | fixed chain |
| kernel radii | `[6, 10, 14, 18, 22]` | fixed support per level |
| base weights | `[1.0, 0.8, 0.6, 0.4, 0.2]` | mixed across levels |
| mirrored weights | `1.2 - baseWeight` | interpolation target for `radius` |
| default scale | `0.5` | implementation default, not a quality verdict |
| default smooth width | `0.01` | implementation default |

The high pass is:

```text
a = smoothstep(threshold, threshold + smoothWidth, luminance(input.rgb))
bright = mix(0, input, a)
```

`strength` scales the final sum. `radius` changes energy distribution between
fixed levels, so call it spread. `highPassFn` can change extraction, but the
downstream pyramid remains isotropic. Anamorphic streaks, starbursts,
chromatic scatter, calibrated energy conservation, or resolution-invariant
sensor-space support need a custom PSF.

The deepest level receives approximately `base / 16`. Require:

```text
floor(bloomScale * min(drawingBufferWidth, drawingBufferHeight)) >= 16
```

Validate halo width at minimum and maximum DPR, viewport, and aspect. When the
error exceeds tolerance, use measured tier-specific scale/spread or a custom
kernel expressed in the required coordinate domain.

## Exposure, output, and lifecycle

### Threshold domain

Store one policy with the graph:

```text
scene-referred:
  thresholdScene is in the bloom input's radiance basis

exposed-linear:
  exposure = exp2(currentEV)
  thresholdScene = thresholdExposed / exposure

display-referred:
  thresholdScene = inverseToneAndOutput(thresholdDisplay) / exposure
```

The display branch requires a stable inverse over the accepted range. Convert
the soft-knee width with the threshold. A known linear radiance rescale converts
both by the same factor; a primaries, quantity, spectral, nonlinear, or
calibration change requires a validated transform or re-authoring.

Meter resolved pre-bloom HDR by default. Apply bloom in scene-linear space,
then exposure, tone map, grade, and one output conversion. Decode source color
textures according to their transfer; keep render targets and contribution
buffers scene-linear rather than tagging them sRGB.

With explicit `renderOutput()`, set `outputColorTransform = false`. Add glare
RGB while preserving source alpha. A plain vec4 sum is valid only when alpha is
provably discarded.

### Lifecycle

- Set pixel ratio before allocation and inspect physical drawing-buffer size.
- Set BloomNode resolution scale before timing.
- Warm the complete pipeline; scene-pass compile does not warm bloom materials.
- After changing `outputNode`, set `needsUpdate = true`.
- BloomNode derives ordinary resize dimensions from the drawing buffer.
- Dispose BloomNode, any exclusive MRT/pass, pipeline, and materials when
  replaced.
- Rebuild targets and timing evidence after backend/device loss or format
  generation change.

## Budget and acceptance

Let physical drawing-buffer dimensions be `W * H`, bloom scale be `s`, and
level dimensions be:

```text
w[i] = floor(floor(s * W) / 2^i)
h[i] = floor(floor(s * H) / 2^i)
A[i] = w[i] * h[i]
```

BloomNode allocates one RGBA16F bright target and two RGBA16F blur targets at
each of five levels. With `8` bytes per texel:

```text
internalBytes = 8 * (A[0] + 2 * sum(i=0..4, A[i]))
large-image limit ~= 29.3125 * A[0] bytes
```

It submits:

```text
1 high-pass + 2 * 5 blur + 1 composite = 12 fullscreen draws
```

For kernels `K = [6, 10, 14, 18, 22]`:

```text
blurSamples = 2 * sum(i=0..4, (2*K[i] - 1) * A[i])
totalSamples = A[0] + blurSamples + 5*A[0]
totalWrites = 2*A[0] + 2*sum(i=0..4, A[i])
```

These are shader-operation and logical-storage counts, not DRAM traffic or GPU
time. Tiling, cache, blending, attachment stores, and scheduling require target
measurement. A selective RGBA16F attachment adds `8 * W * H` resolved bytes,
plus multisample/tile costs when enabled.

Measure paired warmed variants:

```text
deltaFull = time(scene + full bloom) - time(scene)
deltaMRT = time(scene with contribution) - time(scene)
deltaSelective = time(scene + contribution + bloom) - time(scene)
```

Charge a genuinely shared contribution attachment once, but accept the branch
using the complete paired delta. For a pixel-bound miss, estimate:

```text
nextScale = currentScale * sqrt(budgetMs / measuredMs)
```

Then clamp to the viewport/quality gates and remeasure. Reject the estimate when
MRT stores, fixed submission, or transparent overdraw dominate.

Capture:

```text
scene-linear HDR; false-color luminance; desired contributors
full-scene bright pass; selective contribution when present
transparent overlap orders; bloom-only; bloom-off; final output
minimum/maximum DPR and viewport; target inventory and marginal timing
```

Route visible failures by cause:

| Signature | Response |
| --- | --- |
| clipped gray highlight cores | restore unclamped HDR before high pass |
| uniform haze | narrow threshold/knee or repair the source signal |
| reflected/transmitted highlights stay sharp | use full-scene or hybrid input |
| transparent glow changes with draw order | fix MRT blend/alpha ownership |
| halo shifts across resize | tier the scale/spread or use a custom PSF |
| blocky stairs around small highlights | raise bloom scale or reject the tier |
| tiny views produce invalid output | enforce the `16`-texel base gate |
| sparse hot pixels create huge halos | repair or robustly cap fireflies upstream |
| scene form vanishes bloom-off | repair source geometry/material/lighting |
| bloom-off timing is unchanged | replace output graph and mark it dirty |
| transparent canvas gains opaque edges | preserve scene alpha during RGB add |

Accept bloom only when its source-decision error, transparent fixtures,
viewport endpoints, exposure sweep, bloom-off control, target-device marginal
time, sustained thermal behavior where relevant, and resource-disposal loop all
pass their declared limits.
