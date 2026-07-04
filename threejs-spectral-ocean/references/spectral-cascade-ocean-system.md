# Spectral cascade ocean system

Use this reference for a large, unbounded-looking ocean whose identity comes from directional spectral synthesis, compute inverse FFT cascades, frequency-space derivative maps, Jacobian whitecaps, persistent foam history, and coherent node-based optical shading.

## Contents

1. Architecture contract
2. Capability gate and quality tiers
3. Cascade partition
4. Directional spectrum and stable seeds
5. Packed frequency fields
6. Compute inverse FFT schedule
7. Hard validation gate
8. Spatial map assembly
9. Jacobian foam history
10. NodeMaterial surface shading
11. RenderPipeline, post, color, and output
12. Runtime order
13. Geometry, camera, fog, and budgets
14. Required diagnostics
15. Failure diagnosis
16. Replaced techniques

## 1. Architecture Contract

The best throughput-per-quality architecture is a compute-side multi-cascade FFT ocean:

```text
validated renderer + capability tier
  -> sea-state parameters
  -> coordinate-stable Gaussian field
  -> initial directional spectrum h0(k)
  -> conjugate packing h0(k), conj(h0(-k))
  -> time-evolved packed frequency fields
  -> frequency-space displacement, slopes, horizontal derivatives, cross derivative
  -> Stockham or Cooley-Tukey inverse FFT in StorageTexture ping-pongs
  -> centered-spectrum permutation
  -> displacement, derivative, Jacobian, and foam-history storage textures
  -> NodeMaterial displaced surface and optical shading
  -> RenderPipeline node post and one output transform
```

Algorithm class is the first decision. A compute FFT cascade with packed frequency derivatives is the default because it amortizes the expensive transform across many physically coupled fields. A raster-pass transform pipeline or post-transform finite differencing spends more work for less stable normals and weaker foam signals.

One cascade owns one patch length and one disjoint wavenumber interval. Shared sea-state uniforms and deterministic seeds keep cascades statistically related; separate storage textures prevent write aliasing.

The validated starting preset is:

```ts
const oceanPreset = {
  resolution: 256,
  patchLengthsMeters: [250, 17, 5],
  boundaryFactor: 6,
  depthMeters: 500,
  gravity: 9.81,
  choppiness: 1.3,
};
```

Treat the preset as a scale anchor. Pick the actual tier from capability, memory, and frame budget.

## 2. Capability Gate And Quality Tiers

Create one renderer path with `WebGPURenderer` and TSL. If WebGPU compute/storage is present but tight, reduce native WebGPU quality or use debug inputs; do not write a second shader backend.

```js
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer( {
  antialias: false,
  outputBufferType: THREE.HalfFloatType,
} );

await renderer.init();

if ( renderer.backend.isWebGPUBackend ) {
  oceanTier = chooseOceanTier( renderer, 'dynamic-compute' );
} else {
  throw new Error( 'WebGPU backend required for the canonical FFT ocean path.' );
}
```

Only when the user explicitly asks how to apply fallback when WebGPU is
unavailable should a static fallback-teaching branch be discussed, and that
teaching routes to `../threejs-compatibility-fallbacks/`.

Quality tiers:

```text
ultra: 512², 3 cascades, 4 packed complex fields, persistent foam, optional spray
high: 256², 3 cascades, 4 packed complex fields, persistent foam
medium: 256², 2 cascades, 4 packed complex fields, persistent foam
low: 128², 1-2 cascades, no spray, reduced native WebGPU detail
```

Every tier keeps the same representation: spectra, FFT, frequency-space derivatives, and foam history. Do not label analytic waves or scrolling normal detail as a low FFT tier; route bounded or analytic water to `$threejs-water-optics`.

## 3. Cascade Partition

For cascade `i`, define:

```text
deltaK(i) = 2π / patchLength(i)
handoff(i) = 2π / patchLength(i) * boundaryFactor
```

Use three disjoint bands for the default tier:

```text
cascade 0: [epsilon, handoff(1)]
cascade 1: [handoff(1), handoff(2)]
cascade 2: [handoff(2), largeUpperBound]
```

Evaluate safe inputs before applying the in-band mask:

```ts
const kSafe = max( kLength, cutoffLow );
const inBand = step( cutoffLow, kLength ).mul( step( kLength, cutoffHigh ) );
```

Never rely on multiplication by zero to hide singular values. Debug every cascade as a centered spectrum heatmap. Adjacent bands may touch at a boundary; they must not broadly overlap or leave visible holes.

## 4. Directional Spectrum And Stable Seeds

Generate two independent standard-normal values per grid cell once. Seed by `(baseSeed, cascadeIndex, x, y)` or consume values for every cell before masking so cutoff edits do not shift the random field.

For each centered grid coordinate:

```text
k = (gridIndex - N/2) * deltaK
omega(k) = sqrt(g * |k| * tanh(min(|k| * depth, 20)))
```

The sea state sums local wind sea and swell:

```text
energy =
  localWindSea(omega, direction)
  + swell(omega, direction)
```

Each lobe combines:

```text
JONSWAP frequency energy
* TMA finite-depth correction
* directional spreading
* exp(-shortWaveFade² * |k|²)
```

Compute the JONSWAP peak terms from wind speed and fetch:

```text
alpha = 0.076 * (g * fetch / windSpeed²)^(-0.22)
peakOmega = 22 * (windSpeed * fetch / g²)^(-0.33)
```

Use the standard JONSWAP sigma split around the peak (`0.07` below, `0.09` above), peak enhancement `gamma`, and explicit lobe scales. Directional spreading rotates around the configured angle and tightens near the energetic range. Blend a broad cosine-squared base with a Donelan-Banner-style powered cosine lobe.

Initial complex amplitude:

```text
amplitude =
  sqrt(
    energy
    * 2
    * abs(dOmega/dk)
    / kSafe
    * deltaK²
  )

h0(k) = gaussianComplex(k) * amplitude * inBand
```

Expose local-only spectrum, swell-only spectrum, combined spectrum, in-band mask, frequency derivative, and Gaussian seed fields.

## 5. Packed Frequency Fields

Real spatial fields require conjugate symmetry:

```text
packedH0(k) = [h0(k), conjugate(h0(-k))]
```

At time `t`:

```text
h(k,t) =
  h0(k) * exp(i * omega * t)
  + conjugate(h0(-k)) * exp(-i * omega * t)
```

Compute all derivatives before the inverse transform:

```text
height: h
horizontal displacement: i * k / |k| * h
height slopes: i * [kx, kz] * h
horizontal derivatives: -[kx², kz²] / |k| * h
cross derivative: -kx * kz / |k| * h
```

Pack two real spatial fields into one complex IFFT input. A strong four-field layout is:

```text
field 0: horizontal displacement X + i horizontal displacement Z
field 1: height + i cross derivative
field 2: height slope X + i height slope Z
field 3: horizontal derivative XX + i horizontal derivative ZZ
```

Document unpacking algebra next to the field contract. A swapped real/imaginary sign can look plausible while rotating or mirroring the sea.

## 6. Compute Inverse FFT Schedule

Use TSL compute nodes and storage textures:

```js
import {
  Fn,
  instanceIndex,
  textureStore,
} from 'three/tsl';
import * as THREE from 'three/webgpu';

const source = new THREE.StorageTexture( N, N );
const scratch = new THREE.StorageTexture( N, N );

source.colorSpace = THREE.NoColorSpace;
scratch.colorSpace = THREE.NoColorSpace;
source.mipmapsAutoUpdate = false;
scratch.mipmapsAutoUpdate = false;

const butterflyStage = Fn( ( { stage, axis, inputTex, outputTex } ) => {
  const cell = computeCellFromLinearIndex( instanceIndex, N );
  // Read two source samples, apply precomputed twiddle/index data, then write output.
  textureStore( outputTex, cell, packedResult );
} )().compute( N * N );
```

`computeCellFromLinearIndex()` is a small project helper that returns an integer `x/y` cell from the TSL compute invocation index.

Precompute butterfly twiddles and source indices once per `N`:

```ts
type ButterflyEntry = {
  twiddleReal: number;
  twiddleImaginary: number;
  inputA: number;
  inputB: number;
};
```

For each packed complex field:

1. execute `log2(N)` horizontal stages;
2. execute `log2(N)` vertical stages;
3. multiply by `(-1)^(x+y)` to reconcile centered frequency coordinates.

Ping-pong between a field texture and scratch texture. Never let two logical fields write the same scratch storage during a stage.

Stage ordering:

```js
for ( let stage = 0; stage < logN; stage++ ) {
  await renderer.computeAsync( horizontalNodesForStage[ stage ] );
}

for ( let stage = 0; stage < logN; stage++ ) {
  await renderer.computeAsync( verticalNodesForStage[ stage ] );
}

await renderer.computeAsync( centeringAndAssemblyNodes );
```

Batch independent fields at the same stage when resource ownership is clear. Advance to the next stage only after the whole-grid writes for the current stage are visible. Use `workgroupBarrier()` only for synchronization inside a workgroup; it is not a substitute for ordered whole-grid stage boundaries.

## 7. Hard Validation Gate

Validate the transform before connecting the spectrum:

```text
test A:
  centered DC impulse
  expected spatial result = constant complex (1, 0)

test B:
  centered one-bin X-frequency impulse
  expected spatial result =
    cos(2πx/N) + i sin(2πx/N)

test C:
  centered one-bin Y-frequency impulse
  expected spatial result =
    cos(2πy/N) + i sin(2πy/N)

test D:
  analytic horizontal displacement direction
  expected packed X/Z orientation and signs

test E:
  analytic derivative signs and Jacobian determinant
```

Measure maximum absolute error over every texel. A practical half- or single-precision gate is `1e-3`, adjusted only with captured evidence.

If any test fails, stop. Do not tune spectrum amplitude, choppiness, or shading around a broken transform.

Diagnostic causes:

```text
constant test alternates signs:
  missing or duplicated centering permutation

sine direction reversed:
  inverse twiddle sign is wrong

frequency appears on the wrong axis:
  horizontal/vertical indexing is swapped

every other stage corrupts:
  ping-pong source/destination parity is wrong

random blocks:
  missing ordered stage boundary or aliased scratch storage

foam rotates relative to waves:
  packed derivative signs or cross derivative unpacking are wrong
```

## 8. Spatial Map Assembly

Assemble filterable repeating data textures after the IFFT:

```text
displacement.rgba =
  [lambda * Dx, height, lambda * Dz, foamHistory]

derivatives.rgba =
  [dHeight/dx, dHeight/dz, lambda * dDx/dx, lambda * dDz/dz]

crossAndJacobian.rgba =
  [lambda * dDz/dx, jacobian, foamCoverage, debugMask]
```

Use half-float storage for bandwidth when the target validates storage writes and filtered sampling for the chosen format. Keep data textures in linear/no-color semantics. Generate mipmaps only when a compute pass writes them deliberately.

## 9. Jacobian Foam History

Choppy horizontal displacement can fold. Build the 2x2 horizontal mapping Jacobian from transformed derivatives:

```text
jxx = 1 + lambda * dDx/dx
jzz = 1 + lambda * dDz/dz
jxz = lambda * dDz/dx
J = jxx * jzz - jxz²
```

Low or negative `J` identifies real fold/compression regions. Store persistent per-texel history in ping-ponged storage initialized to `1`.

One effective update shape:

```text
historyNext =
  min(
    currentJacobian,
    historyPrevious
      + dt * recoveryRate / max(currentJacobian, 0.5)
  )
```

Keep simulation history separate from display threshold:

```text
foamCoverage =
  smoothstep(lowCoverage, highCoverage,
    sum(saturate((foamThreshold - history) * foamScale)))
```

Do not let the finest cascade produce constant speckle merely because it exists. Validate each cascade's foam contribution independently.

## 10. NodeMaterial Surface Shading

Use a `MeshStandardNodeMaterial` or `MeshPhysicalNodeMaterial` graph for the ocean surface. Vertex position samples the displacement storage textures by world `xz` and patch length. Normals come from summed derivative maps:

```text
slopeX = sum(dHeight/dx) / (1 + sum(lambda * dDx/dx))
slopeZ = sum(dHeight/dz) / (1 + sum(lambda * dDz/dz))
normal = normalize([-slopeX, 1, -slopeZ])
```

Horizontal compression changes the height-slope denominator; height-only normals miss fold behavior. Add sub-grid normal detail only after the resolved normal exists, at low enough strength that it cannot rewrite the swell direction.

Use one sky-radiance node graph for both the visible sky and reflected ray:

```text
sky(direction) =
  horizon-to-zenith gradient
  + narrow sun disc
  + broad sun halo
```

Water-air Fresnel:

```text
F = 0.02 + 0.98 * (1 - saturate(N dot V))^5
```

Build the body term from deep color plus crest scatter. Use a view/sun/normal half-vector response weighted by crest height:

```text
water = mix(body, sky(reflect(-V, N)), F)
```

Foam changes the final response rather than adding a detached white mask. Shade it with sun/sky incidence and modulate brightness with a separate bubbly detail field.

Above/below and clear-water variants preserve the same spectral displacement and derivative maps. Underwater absorption uses Beer-Lambert depth, shared sun/sky, and scene depth/thickness from the node pass. Sand-bed caustics and shallow refraction belong in the node graph or in `$threejs-water-optics` when the water is bounded.

## 11. RenderPipeline, Post, Color, And Output

Create a single node render pipeline:

```js
import * as THREE from 'three/webgpu';
import {
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

const pipeline = new THREE.RenderPipeline( renderer );
const scenePass = pass( scene, camera );

scenePass.setMRT( mrt( {
  output,
  normal: normalView,
} ) );

const colorNode = scenePass.getTextureNode( 'output' );
const normalNode = scenePass.getTextureNode( 'normal' );
const depthNode = scenePass.getTextureNode( 'depth' );

const bloomNode = bloom( colorNode, 0.25, 0.2, 1.4 ).setResolutionScale( 0.5 );
const aoNode = ao( depthNode, normalNode, camera );
aoNode.resolutionScale = 0.5;

pipeline.outputColorTransform = true;
pipeline.outputNode = colorNode.add( bloomNode );
```

Use built-in nodes first when they are needed: `BloomNode` for sun glints or crest sparkle, `GTAONode` for scene contact around hulls/shore objects, and `TRAANode` for temporal anti-aliasing when velocity/depth rejection is available. Do not add post effects to hide simulation errors.

Color and output rules:

```text
color textures: SRGBColorSpace
simulation/data textures: NoColorSpace or linear semantics
HDR working buffers: HalfFloatType until tone map
tone-map owner: RenderPipeline
output conversion owner: RenderPipeline outputColorTransform or renderOutput()
```

Never double-convert in a material node and the pipeline. If an effect must run after tone mapping, disable `outputColorTransform` and place `renderOutput()` explicitly at the correct point.

## 12. Runtime Order

Use this order each frame:

```text
update time and dt uniforms
update sea-state changes only when settled
compute time-evolved packed frequency fields
submit horizontal FFT stage 0..logN-1
submit vertical FFT stage 0..logN-1
submit centering, assembly, Jacobian, and foam-history nodes
update optional spray or interaction effects
render scene through RenderPipeline
resolve GPU timing asynchronously
```

Sea-state changes that alter `h0` should recompute the initial spectrum on interaction release, not continuously while dragging a control.

## 13. Geometry, Camera, Fog, And Budgets

Baseline presentation:

```text
camera FOV: 55 degrees
camera: (0, 16, 68)
target: (0, 0, -20)
surface: 400 m square
fog: horizon-colored exponential fog
```

Use enough mesh density that vertex displacement resolves the smallest visible cascade near the camera. Scale tessellation with camera distance and the shortest active patch length. Fog must hide the finite mesh edge before the plane ends.

Budgets:

```text
ultra desktop discrete:
  512², 3 cascades, about 102 MiB ocean storage with a 104 MiB gate
  2.5-4.0 ms simulation, 1.5-3.0 ms ocean shading/post at 1440p

standard desktop integrated:
  256², 3 cascades, under 28 MiB ocean storage
  1.5-3.0 ms simulation, 1.5-2.5 ms ocean shading/post at 1080p

mobile or reduced tier:
  128², 1-2 cascades, debug inputs when needed, under 8 MiB ocean storage
  under 2.0 ms simulation-equivalent work, no spray
```

Dispatch count estimate for one frame:

```text
cascades * (
  evolve packed fields
  + packedFields * (2 * log2(N)) FFT stages
  + centering/assembly/Jacobian/foam
)
```

Keep draw calls to one ocean surface, one sky, and optional routed effects. Keep post to one scene pass, optional MRT outputs, reduced-resolution built-in effects, and one output conversion.

## 14. Required Diagnostics

Expose:

```text
capability tier and selected format
FFT test errors
Gaussian seed field
per-cascade in-band spectrum
local-only and swell-only spectra
time-evolved frequency magnitude
packed field real/imaginary views
spatial height
horizontal displacement
height slopes
horizontal derivatives
cross derivative
Jacobian determinant
foam history
foam display coverage
resolved normal
sub-grid normal contribution
final without foam
final without detail
node pass outputs
GPU milliseconds by evolve, FFT, assembly, render, and post phase
```

Capture a fixed camera at multiple times. A single attractive frame cannot prove temporal stability, transform correctness, or foam persistence.

## 15. Failure Diagnosis

```text
periodic square tiles:
  cascade lengths or camera coverage expose repetition; add disjoint scales

all waves travel in one artificial line:
  directional spread is too narrow or wind/swell angles are identical

energy explodes near the center:
  DC/small-k singularities are evaluated before masking

surface moves but normals lag:
  derivative maps are stale or sampled with different coordinates

surface normals rotate relative to swell:
  packed field signs or cross derivative unpacking are wrong

white noise foam:
  thresholding finest-cascade compression without temporal filtering

foam disappears instantly:
  history is not persistent or recovery is interpreted as decay-to-zero

foam never clears:
  recovery sign or Jacobian denominator clamp is wrong

glitter detached from sun:
  visible sky and reflection use different sun direction or color

GPU corruption after increasing N:
  FFT stage count, butterfly table, index type, or scratch allocation is wrong

slow frame at identical visual quality:
  wrong algorithm class, missing packed fields, excess cascades, full-resolution post, or no reduced-resolution node effects
```

## 16. Replaced Techniques

- Raster-pass transform pipelines are replaced by TSL compute kernels writing `StorageTexture` ping-pongs because compute dispatches avoid screen-quad pass overhead and match the data-parallel FFT schedule.
- Post-transform finite differences are replaced by frequency-space derivative fields because the transformed slopes, horizontal derivatives, and cross derivative are more accurate and share the same FFT work.
- Fresh per-frame foam inference is replaced by persistent Jacobian history because whitecaps are temporal events with recovery, not a stateless color threshold.
- Detached material shading is replaced by `NodeMaterial` graphs fed by the same displacement and derivative textures because normals, foam, reflection, and underwater absorption must remain coupled.
- Ad hoc post stacks are replaced by `RenderPipeline` nodes with one tone-map and output-conversion owner because the ocean must stay HDR until the final output transform.
