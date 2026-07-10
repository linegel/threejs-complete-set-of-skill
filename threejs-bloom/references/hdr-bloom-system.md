# HDR bloom system

This reference defines bloom for Three.js r185 WebGPU/TSL. It separates
optically motivated scene-radiance bloom from art-directed selective bloom,
then makes the built-in pyramid, transparent MRT behavior, and marginal cost
explicit.

## Numeric provenance

- **[Derived]**: inspected r185 source or an equation shown here.
- **[Gated]**: a branch threshold that must pass on the target.
- **[Measured]**: target-scene/device evidence.
- **[Authored]**: a tuning start or planning ceiling.

Version numbers and list ordering are identifiers, not tuning claims.

## Imaging contract

An optical PSF convolves all sensor-reaching radiance. Real-time bloom instead
uses a bright-pass and a small multi-resolution blur pyramid. Consequently:

- full-scene HDR input is the closest built-in approximation to optical glare;
- threshold and soft knee are sparsification/art controls, not properties of a
  lens;
- an emissive-only MRT is an explicit membership override and will miss bright
  reflections, transmission, or direct radiance unless authored into it;
- bloom cannot replace geometry, volumetric scattering, occlusion, fog shafts,
  or readable base lighting.

### Lighting-transport binding

The canonical cross-skill schemas are in the
[physics domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
When the route declares a physics-to-render boundary, latch one immutable
`PhysicsPresentationCandidate` -> `CameraViewPublication` ->
`ViewPreparationPublication` ->
`PhysicsPresentationSnapshot` chain and bind the matching
`LightingTransportSnapshot` through a provider-wide `PresentedStatePair`
(`entityId: typed-absence`) in the Candidate whose binding ID is referenced by
the Snapshot. Match context/provider/signal IDs, descriptor and
state/resource generations, `PresentationStateHandle`, each state's requested
presentation instant, mapped source instant, clock-map revision/error, and the
bundle `sampleInstant`; validate channel `actualPhysicsTime`, filter/age,
maximum staleness, validity, and error. Validate the exact central
target/view and per-channel schemas; do not define a reduced bloom-local field
list.

For each lighting channel, record basis/primaries or spectral basis,
radiance/irradiance quantity, SI unit, bundle `sampleInstant`, channel
`actualPhysicsTime`, revision, validity, and error.
Canonical provider channels remain SI-valued. The route-level fields are an index,
not permission to combine incompatible channel quantities.

The bloom source is sensor-reaching scene-linear radiance after lighting and
material transport. A calibrated render basis may retain physical units. A
normalized RGB basis is a separately named render-local signal derived through
a versioned SI-to-render conversion whose reference scale, provenance, and error
cover direct light, sky/environment, atmosphere, reflection, transmission,
emission, foam, and optical effects. It is not a normalized canonical channel.
A nonphysical route leaves the router physics fields `not used`. Do not add
`directSolarIrradiance` or `skyIrradiance` directly to a radiance
buffer when the snapshot declares irradiance; the BRDF/geometry stage owns that
conversion. Do not let exposure or bloom strength hide incompatible units.

### Threshold-domain contract

Store one of these policies with the graph:

```text
scene-referred:
  thresholdScene has the same radiance basis and units as BloomNode input

exposed-linear:
  exposure = exp2(currentEV)
  thresholdScene = thresholdExposedLinear / exposure       [Derived]

display-referred:
  thresholdScene = inverseOutputAndToneMap(thresholdDisplay) / exposure
```

The display-referred form is legal only when the declared tone map/output path
has a stable, channel/basis-aware inverse over the accepted range. Otherwise
use scene-referred or exposed-linear policy. Threshold and soft-knee widths
convert together; strength is not a unit conversion.

When any consumed lighting-channel descriptor/revision, radiance calibration/
basis, primaries, quantity convention, or the exposure-key policy changes,
execute the corresponding `ViewPreparationPublication.resetDependencies` before
bloom and recompute its
threshold conversion. A known linear radiance rescale may convert the threshold
by the same scale; a spectral/primary/nonlinear change requires re-authoring or
a validated transform.

Shadow-map commits and discontinuous foam, emissive, wet-surface, absorption,
or refraction changes emit versioned radiance-reactive publications. If a temporal color or
selective-emissive history precedes bloom, reject its affected pixels with the
published mask, or reset it entirely when no conservative mask exists.
`BloomNode` owns no temporal history and therefore is not itself rebuilt for a
local radiance edit; diagnostics still record the source reactive epoch so a
stale upstream history cannot masquerade as stable bloom.

`ViewPreparationPublication.resetDependencies` remains an immutable action
plan. Record the executed
threshold conversion, upstream temporal reset/reseed, graph rebuild, queue
submission, or failure in `FrameExecutionRecord`. Logical revision and GPU
availability are distinct. Device loss appends a `FrameExecutionRecord` with
`overallStatus: device-lost`, affected target execution statuses
`device-lost`, cancelled dependent actions, and lost-generation entries in
`leaseDispositionById`; it invalidates node resources and timing evidence without
mutating the sealed snapshot. Rebuild under a new backend/resource generation.

## Signal-source decision

Stabilize exposure and capture scene-linear luminance before choosing a source.
Let `D(p)` be the authored desired-contributor mask and `B_T(p)` the pixels
accepted by a candidate scene-luminance threshold `T`.

```text
falsePositiveEnergy(T) = sum(Y(p) * B_T(p) * (1 - D(p))) / sum(Y(p))  [Derived]
falseNegativeEnergy(T) = sum(Y(p) * D(p) * (1 - B_T(p))) / sum(Y(p))  [Derived]
```

Use full-scene bloom when some `T` and soft knee satisfy the product's declared
error limits **[Gated]**. Use selective MRT only when the desired mask cannot be
represented by luminance within those limits **[Gated]**, or when a deliberate
boost must diverge from visible emission.

This test avoids two common errors: allocating an emissive attachment before
proving selectivity is required, and forcing ordinary bright radiance out of an
effect that is supposed to look optical.

## Verified full-scene path

The following APIs exist in installed `three@0.185.1` **[Measured]**:

```js
import * as THREE from 'three/webgpu';
import { pass, renderOutput, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const renderer = new THREE.WebGPURenderer( {
  antialias: false,
  outputBufferType: THREE.HalfFloatType
} );

await renderer.init();

if ( renderer.backend.isWebGPUBackend !== true ) {
  throw new Error( 'WebGPU is required.' );
}

const pipeline = new THREE.RenderPipeline( renderer );
pipeline.outputColorTransform = false;

const scenePass = pass( scene, camera, { samples: sceneSampleCount } );
const sceneHDR = scenePass.getTextureNode( 'output' );

const bloomPass = bloom(
  sceneHDR,
  0.55, // [Authored] strength start
  0.35, // [Authored] cross-mip spread start
  sceneThreshold
);
bloomPass.smoothWidth.value = softKnee;
bloomPass.setResolutionScale( 0.5 ); // [Authored] scale start

const hdrComposite = vec4( sceneHDR.rgb.add( bloomPass.rgb ), sceneHDR.a );
pipeline.outputNode = renderOutput( hdrComposite );
pipeline.needsUpdate = true;
```

This path captures emissive surfaces, bright direct response, specular
reflection, and visible transparent/transmitted radiance after the scene pass.
It allocates no bloom-membership attachment.

## Verified selective MRT path

Use this only after the source decision rejects full-scene bloom:

```js
import * as THREE from 'three/webgpu';
import { emissive, mrt, output, pass, renderOutput, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const pipeline = new THREE.RenderPipeline( renderer );
pipeline.outputColorTransform = false;

const scenePass = pass( scene, camera, { samples: sceneSampleCount } );

const sceneMRT = mrt( { output, emissive } );
sceneMRT.setBlendMode(
  'emissive',
  new THREE.BlendMode( THREE.MaterialBlending )
);
scenePass.setMRT( sceneMRT );

const sceneHDR = scenePass.getTextureNode( 'output' );
const contribution = scenePass.getTextureNode( 'emissive' );
const bloomPass = bloom( contribution, strength, spread, threshold );
bloomPass.smoothWidth.value = softKnee;
bloomPass.setResolutionScale( bloomScale );

const hdrComposite = vec4( sceneHDR.rgb.add( bloomPass.rgb ), sceneHDR.a );
pipeline.outputNode = renderOutput( hdrComposite );
pipeline.needsUpdate = true;
```

The explicit blend mode matters. r185 `MRTNode` assigns material blending only
to output named `output`; every other MRT output defaults to no blending
**[Derived]**. Opaque emissive writes are correct either way under depth test,
but overlapping transparent writes otherwise replace one another.

Do not combine this with a material-level `mrtNode` in installed r185.
`MRTNode.merge()` computes the merged mode map but assigns it to `blendings`
instead of the operative `blendModes` property **[Derived source finding]**;
the merged node therefore falls back to no blending for `emissive`. The
canonical transparent path uses the regular `emissiveNode` so no MRT merge is
invoked.

The scene MRT stays linear HDR. `renderOutput()` is the only tone-map/output
conversion owner, so `RenderPipeline.outputColorTransform` is disabled.

## Transparent contributors

For a transparent material, the visible and contribution outputs must share
depth, sorting, blend family, alpha convention, and animation state. For an
additive premultiplied emitter, use the regular material path:

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

With `BlendMode(MaterialBlending)`, both visible output and emissive target use
the material's additive premultiplied blend state; the regular emissive value
is accumulated in the contribution target. For normal alpha/transmittance or
custom factors, derive the contribution from the same alpha convention and
verify order/occlusion explicitly.

If visible emission must differ from bloom contribution, stock r185 cannot
safely combine a material `mrtNode` override with the required emissive blend
mode. Use a separately costed contribution pass or a source-verified custom
MRT merge implementation. Do not conceal that added pass in the BloomNode
budget.

Transparent acceptance fixtures:

- one layer over opaque geometry;
- two overlapping layers in both insertion orders;
- additive and alpha-blended policies tested separately;
- depth intersection and offscreen clipping;
- contribution texture compared with visible animation/deformation.

For physically motivated transparent glare, prefer full-scene input: it uses
the already composited result and avoids duplicating the transparency model in
an emissive attachment.

## What BloomNode actually computes

Installed r185 performs:

```text
bright pass
  -> five progressive mip levels
  -> horizontal + vertical Gaussian blur at every level
  -> weighted five-level composite
```

Source constants:

| Property | r185 value | Meaning |
| --- | ---: | --- |
| mip count | `5` | fixed **[Derived]** |
| kernel radii | `[6, 10, 14, 18, 22]` | fixed per level **[Derived]** |
| base level weights | `[1.0, 0.8, 0.6, 0.4, 0.2]` | fixed **[Derived]** |
| mirrored weights | `1.2 - baseWeight` | mixed by `radius` **[Derived]** |
| default internal scale | `0.5` | source default **[Derived]** |
| default smooth width | `0.01` | source default **[Derived]** |

High-pass extraction is:

```text
a = smoothstep(threshold, threshold + smoothWidth, luminance(input.rgb))
bright = mix(0, input, a)                                           [Derived]
```

`radius` is therefore a cross-mip weight interpolation. It broadens or narrows
the relative tail by moving energy between fixed levels, but it is not a PSF
sigma and does not change the per-level kernel support. `strength` multiplies
the final five-level sum.

Every blur shader writes alpha `1`, and the composite includes those alpha
channels **[Derived]**. Preserve `sceneHDR.a` explicitly when adding bloom. A
plain vec4 add is acceptable only when the output alpha is provably discarded.

`highPassFn` can replace extraction. It cannot create an anamorphic or
diffraction PSF because the subsequent blur remains the same isotropic fixed
pyramid. Anamorphic streaks, starbursts, chromatic scatter, calibrated energy
conservation, or resolution-invariant physical kernels require a custom blur/
composite implementation.

## PSF and resolution gate

BloomNode's apparent footprint depends on drawing-buffer dimensions, linear
scale, fixed kernels, and five-level mip weighting. A DPR or resolution change
does not guarantee constant CSS-pixel, angular, or sensor-space width.

Validate at minimum and maximum target DPR/aspect. If the footprint error
exceeds the authored tolerance **[Gated]**:

- choose a tier-specific scale/spread pair and remeasure; or
- implement a custom PSF whose sigma/support is expressed in the required
  coordinate domain.

The deepest target receives approximately base size divided by `16`
**[Derived]**. Require:

```text
floor(bloomScale * min(drawingBufferWidth, drawingBufferHeight)) >= 16
                                                                    [Derived/Gated]
```

This prevents a zero-sized level in the fixed chain. Thumbnails and tiny
embedded views frequently hit this gate.

## Exact fixed-pyramid budget model

Let:

```text
W, H = physical drawing-buffer dimensions
s = BloomNode linear resolution scale
A = s^2 * W * H                                                     [Derived]
K = [6, 10, 14, 18, 22]                                             [Derived]
w[i] = floor(floor(s W) / 2^i), h[i] likewise                       [Derived]
A[i] = w[i] h[i]                                                     [Derived]
```

BloomNode allocates one RGBA16F bright target and two RGBA16F blur targets at
each of five levels. With `8` bytes per RGBA16F texel **[Derived]**:

```text
internalBytes exact = 8 * (A[0] + 2 * sum(i=0..4, A[i]))            [Derived]
sumMipArea approaches 1.33203125 A[0] at large dimensions           [Derived]
internalBytes approaches 29.3125 A[0]                               [Derived]
```

It submits:

```text
1 high-pass + 2 * 5 blur + 1 composite = 12 fullscreen draws       [Derived]
```

Approximate shader texture samples, excluding cache effects:

```text
blurSamples exact = 2 * sum(i=0..4, (2 K[i] - 1) * A[i])           [Derived]
blurSamples approaches 36.3046875 A[0]                              [Derived]
totalSamples = A[0] high-pass + blurSamples + 5 A[0] composite
totalSamples approaches 42.3046875 A[0]                             [Derived]
```

Pixel writes are:

```text
totalWrites exact = 2 A[0] + 2 * sum(i=0..4, A[i])                 [Derived]
totalWrites approaches 4.6640625 A[0]                               [Derived]
```

These are shader-operation counts, not DRAM transactions: texture cache,
tiling, fusion, blend reads, and backend scheduling determine measured time.

At `1920x1080` and `s = 0.5`, internal allocation is `14.49 MiB`
**[Derived]**. Selective bloom adds one full-resolution PassNode-cloned RGBA16F
emissive target: `8WH = 15.82 MiB` **[Derived]**. The selective incremental
image allocation is therefore `30.31 MiB` before scene output, depth, MSAA,
alignment, and tile scratch **[Derived]**.

## Tile and mobile architecture

The selective attachment is a full-resolution store even when bloom itself is
quarter resolution. On a tile renderer it can reduce tile occupancy or force a
store/resolve. With multisample count `q`, resolved emissive storage remains
`8WH`, while transient sample storage can approach `8qWH` before backend
optimizations **[Derived accounting bound]**.

Decision order:

- Remove selective MRT if full-scene input passes the source test.
- Lower bloom scale; pixel-bound work scales approximately with `s^2`
  **[Derived]**.
- Bound transparent screen coverage and overdraw; count covered fragments, not
  objects.
- Compare scene MSAA against a single-sampled scene plus the selected AA owner.
- Disable bloom when the base scene remains readable and the marginal budget
  still fails.

For a pixel-bound miss:

```text
sNext = sCurrent * sqrt(declaredBudgetMs / measuredBloomMs)         [Derived]
```

Clamp to the quality and deepest-level gates, then remeasure. The estimate is
rejected when fixed submission, MRT store, or transparency dominates
**[Gated]**.

## Composable marginal ledger

```yaml
bloomBudget:
  declaredMarginalMs: <Authored>
  sourceMode: <full-scene | selective | hybrid>
  sceneMrtAttachmentDeltaMs: <Measured; zero for full-scene or genuinely shared>
  bloomHighPassMs: <Measured>
  bloomBlurPyramidMs: <Measured>
  bloomCompositeMs: <Measured>
  transparentContributionDeltaMs: <Measured>
  totalMarginalMs: <Derived sum of charged rows>
  valid: <Gated totalMarginalMs <= declaredMarginalMs>
```

Do not double-charge a contribution attachment already owned by the image
pipeline. Do not credit a pass that merely might be shared later.

Planning rejection ceilings are `0.8 ms` at `2560x1440`, scale `0.5` on
discrete desktop; `1.5 ms` at `1920x1080`, scale `0.33-0.5` on integrated
desktop; and `2.0 ms` at `1280x720`, scale `0.25-0.33` on mobile
**[Authored]**. They are product planning limits, not measured promises.

## Exposure and color ownership

- Decode color assets according to their source color space. Scene/post render
  targets and contribution buffers remain scene-linear; they are not sRGB
  textures.
- Run high-pass and bloom addition before the single tone-map/output conversion.
- Threshold is evaluated in the BloomNode input domain. If exposure adapts
  while threshold remains in fixed scene units, apparent membership can change.
  The exposure owner must specify whether threshold tracks exposure or remains
  scene-referred.
- Clamp or robustly reject pathological fireflies at their source. Early HDR
  clamp to display range destroys legitimate highlight hierarchy.
- `toneMapped = false` is a material display choice, not bloom membership.

## Lifecycle and graph mutation

- Set pixel ratio before renderer allocation and validate the resulting physical
  drawing-buffer size.
- `BloomNode.updateBefore()` derives size from the drawing buffer each frame
  **[Derived]**; explicit `setSize()` is not required for an ordinary renderer
  resize, though it is a valid public method.
- Set resolution scale before timing.
- Dispose BloomNode, PassNode, RenderPipeline, materials, and scene resources
  when replaced.
- After changing the output node, set `RenderPipeline.needsUpdate = true`.
- `scenePass.compileAsync(renderer)` warms scene material variants after MRT
  setup; it does not compile the bloom fullscreen graph. Warm the complete
  pipeline before collecting timings.

## Diagnostic contract

Required fixed views:

```text
scene-linear HDR
false-color pre-tone luminance
desired contributor mask
candidate full-scene bright pass
selective emissive contribution, when used
transparent contribution and overlap-order fixture
bloom-only output
base without bloom
final output
resolution/DPR endpoint comparison
per-stage GPU time and attachment inventory
```

Required fixtures:

| Fixture | Wrong signature | Architecture response |
| --- | --- | --- |
| Bright mirror beside emitter | mirror stays sharp only in selective mode | Use full-scene or hybrid source if optical response is required. |
| Bright transmissive pane | transmitted highlight absent from emissive target | Prefer scene-color input. |
| Overlapping transparent layers | contribution disappears or changes with insertion order unexpectedly | Fix emissive MRT blend mode and alpha convention. |
| Exposure sweep | membership pops while displayed hierarchy is stable | Couple threshold policy to the exposure owner. |
| DPR/resize sweep | halo width shifts beyond tolerance | Tier-specific scale/spread or custom PSF. |
| Tiny viewport | black/invalid deepest level | Enforce the `16`-texel base-dimension gate **[Derived/Gated]**. |
| Sparse subpixel highlight | huge unstable halo | Repair/cap firefly source; do not hide it with threshold. |
| Bloom disabled | form or material hierarchy disappears | Base scene is invalid; defer bloom. |
| Bloom disabled timing | cost remains | Bloom is still reachable; replace graph and mark pipeline dirty. |
| Transparent-canvas composite | opaque rectangle or inflated edge alpha | Add bloom RGB only and preserve scene alpha. |

Acceptance requires the source-decision error metrics, fixed captures, target-
device marginal timings, attachment bytes, thermal evidence for mobile, and
exactly one output conversion owner.
