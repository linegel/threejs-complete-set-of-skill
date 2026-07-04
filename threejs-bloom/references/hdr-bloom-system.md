# HDR bloom systems

Use this reference to build bloom as a WebGPU/TSL node-pipeline effect with
MRT selective contribution, explicit HDR ordering, resolution-scale budgets,
and scene-relative emissive ranges. Bloom should enhance an already readable
form; it must not carry the underlying object silhouette by itself.

## Physics contract

Bloom approximates PSF scatter of above-threshold scene-linear HDR energy in a
camera/display imaging chain. The base image must remain readable when bloom is
disabled; bloom is valid for lens/display glare, not for volumetric light,
opaque silhouettes, fog shafts, or hidden geometry.

Wrong signature examples:

- display-space thresholding after tone mapping;
- clamped gray highlights with no scene-linear HDR headroom;
- glow-as-silhouette where bloom is the only visible object form.

## Contents

- physics contract
- highest-throughput architecture
- r185-era implementation skeleton
- capability gate and quality tiers
- signal order and color ownership
- emissive contribution authoring
- controls and lifecycle
- performance budgets
- replaced techniques
- diagnostics and acceptance

## Highest-throughput architecture

For production selective bloom, lead with one `RenderPipeline` scene pass that
writes both final scene color and bloom contribution through MRT:

```text
WebGPURenderer
  -> RenderPipeline
  -> pass(scene, camera).setMRT(mrt({ output, emissive }))
  -> output texture node
  -> emissive texture node
  -> bloom(emissive).setResolutionScale(quality.bloomScale)
  -> output + bloom
  -> renderOutput(...) as the only output transform
```

This replaces prior two-pass selection designs and temporary whole-scene
material overrides. The replacement matters because algorithm class dominates
throughput: the MRT path pays one scene traversal and one material evaluation,
while repeated selection renders multiply culling, draw submission,
skinning/morph work, material binding, transparency sorting, and render-target
writes. On large scenes the difference can be an order of magnitude before any
shader-level tuning.

Use built-in `BloomNode` first. The winning algorithm class is MRT selective
input, high-pass extraction, then a five-mip separable blur/composite pyramid
owned by `BloomNode`. Cost is O(bloom pixels times mip stack and blur kernel),
so it scales primarily with bloom resolution and mip work, not with a second
scene traversal. A custom bloom is justified only when it extends the built-in
effect in a measured way, such as a specialized anamorphic high-pass through
`highPassFn`, and still preserves the same MRT-fed signal ordering.

## r185-era implementation skeleton

Current Three.js docs show `WebGPURenderer`, `RenderPipeline`, `pass()`,
`mrt()`, `output`, `emissive`, `bloom()`, `renderOutput()`,
`setResolutionScale()`, `setSize()`, and `dispose()` for this path.

```js
import * as THREE from 'three/webgpu';
import { emissive, mrt, output, pass, renderOutput } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const renderer = new THREE.WebGPURenderer( {
  antialias: true,
  outputBufferType: THREE.HalfFloatType
} );

await renderer.init();

const renderPipeline = new THREE.RenderPipeline( renderer );
renderPipeline.outputColorTransform = false;

const scenePass = pass( scene, camera );
scenePass.setMRT( mrt( {
  output,
  emissive
} ) );

const sceneColor = scenePass.getTextureNode( 'output' );
const bloomInput = scenePass.getTextureNode( 'emissive' );
const bloomPass = bloom( bloomInput, 0.55, 0.35, 0.9 );

bloomPass.smoothWidth.value = 0.08;
bloomPass.setResolutionScale( 0.5 );

const hdrComposite = sceneColor.add( bloomPass );
renderPipeline.outputNode = renderOutput( hdrComposite );

function resize( width, height, pixelRatio ) {
  renderer.setPixelRatio( Math.min( pixelRatio, 2 ) );
  renderer.setSize( width, height, false );
  scenePass.setSize( width, height );
  bloomPass.setSize( width, height );
}

function frame() {
  renderPipeline.render();
}

function disposeBloomPipeline() {
  bloomPass.dispose();
  scenePass.dispose();
  renderPipeline.dispose();
}
```

Set `renderPipeline.needsUpdate = true` after replacing the output node graph.
Call `scenePass.compileAsync( renderer )` after `setMRT()` and texture-node
lookups when shader compilation stutter matters.

## Capability gate and quality tiers

Gate after initialization because the full architecture depends on the modern
backend path:

```js
await renderer.init();

const quality = renderer.backend.isWebGPUBackend
  ? {
      name: 'full',
      bloomScale: 0.5,
      contributionMode: 'mrt-emissive',
      dynamicContribution: true
    }
  : {
      name: 'reduced',
      bloomScale: 0.25,
      contributionMode: 'authored-static-or-disabled',
      dynamicContribution: false
    };
```

Quality tiers:

```text
full:
  MRT output + emissive, dynamic emissive NodeMaterial authoring,
  bloomScale 0.5-0.67, live diagnostics enabled on demand.

balanced:
  same MRT path, bloomScale 0.33-0.5, tighter threshold,
  fewer transparent contribution surfaces.

reduced:
  static glow cards or generated contribution textures,
  bloomScale 0.25-0.33, static emissive hierarchy, optional bloom disable.
```

The reduced tier is a quality reduction, not a second renderer recipe. Prefer
static contribution detail, smaller transparent effect counts, or a disabled
bloom node with the base scene still readable. Broad compatibility assets or
explicit requests for how to apply fallback when WebGPU is unavailable belong in `../threejs-compatibility-fallbacks/`.

## Signal order and color ownership

Keep HDR until final output:

```text
scene MRT output + emissive
  -> optional built-in GTAONode / atmosphere / image-pipeline systems
  -> BloomNode from emissive contribution
  -> HDR add to scene color
  -> exposure and grading ownership
  -> one renderOutput / outputColorTransform owner
```

Rules:

- working buffers stay `HalfFloatType` until tone mapping;
- color textures use `SRGBColorSpace`;
- data maps, masks, LUT data, noise, and contribution-control textures use
  `NoColorSpace` or other linear data treatment;
- decide mipmaps per texture role instead of enabling them globally;
- `RenderPipeline` owns the final output transform through either its default
  `outputColorTransform` or one explicit `renderOutput(...)`, never both;
- material nodes and effects must not apply display conversion internally;
- `toneMapped = false` is a narrow display-like material choice and is not
  bloom membership. Membership is the authored emissive contribution target.

Use `$threejs-exposure-color-grading` when exposure adaptation, LUTs, or display
looks are part of the frame. Use `$threejs-image-pipeline` when bloom shares
depth, normals, AO, TAA, or other post resources.

## Emissive contribution authoring

Author contribution as scene-relative luminance:

```text
short spark flash
  > projectile core
  > persistent laser
  > practical lamp filament
  > ordinary lit surface
```

The hierarchy matters more than raw multipliers. Calibrate values against the
actual camera exposure and pre-tone-map false-color luminance view.

Use `MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`,
`MeshBasicNodeMaterial`, `SpriteNodeMaterial`, or another `NodeMaterial` family
member. Route bloom contribution through material emissive nodes so MRT writes a
clean `emissive` target. For sprites, particles, instanced meshes, batched
meshes, skinned meshes, and morphed meshes, keep contribution data in the same
material or per-instance attributes that drive the visible object so bloom
cannot diverge from animation state.

Transparent emitters need explicit validation because sorting and blending can
make contribution look correct in the final frame while the emissive target is
wrong. Inspect the `emissive` texture node directly before tuning bloom.

For material-level visible-emissive versus bloom-contribution divergence, use
`NodeMaterial.mrtNode` as a narrow override instead of a second render:

```js
import { color, emissive, mrt, output, vec4 } from 'three/tsl';

const material = new THREE.MeshStandardNodeMaterial();
material.colorNode = color( 0x223344 );
material.emissiveNode = color( 0x66ccff ).mul( 2.0 ); // visible emissive
material.mrtNode = mrt( {
  output,
  emissive: vec4( color( 0x66ccff ).mul( 12.0 ), 1 )
} );
```

This material-level bloom contribution recipe is for exceptional cases where
the object should appear modestly emissive but contribute stronger HDR bloom.
Keep the default path as regular emissive authoring.

## Controls and lifecycle

Expose controls against `BloomNode`:

```text
strength: artistic bloom energy, default authored from scene exposure
radius: blur spread in [0, 1]
threshold: pre-tone-map luminance cutoff
smoothWidth: soft knee around threshold
resolutionScale: pass cost and radius stability control
```

Starting points for authored scenes:

```text
strength = 0.35-0.75
radius = 0.25-0.45
threshold = 0.8-1.2
smoothWidth = 0.05-0.12
resolutionScale = 0.5 desktop, 0.33 integrated, 0.25-0.33 mobile
```

These are not portable defaults. They are a tuning bracket after exposure,
emissive hierarchy, and display transform are already stable.

Lifecycle requirements:

- resize the renderer, scene pass, and bloom node together;
- cap pixel ratio by quality tier before allocating pass targets;
- call `setResolutionScale()` before measuring GPU time;
- call `dispose()` on bloom, pass, and pipeline resources when replacing the
  pipeline;
- precompile after MRT configuration when first-frame stutter matters.

## Performance budgets

Budget from algorithm and pixel count first:

```text
scene render count: 1
MRT targets: output + emissive
extra scene traversals for bloom: 0
temporary whole-scene overrides per frame: 0
HDR output target format: RGBA16F-equivalent HalfFloatType
bloom resolution: 0.25-0.67 of renderer size by tier
draw-call multiplier from bloom selection: 1x, never 2x+
```

At 1920x1080, two RGBA16F full-resolution MRT targets are about 31.6 MiB
before depth and internal bloom levels. Keep total bloom-related transient
targets under about 64 MiB at 1080p by using half-resolution bloom on desktop
and lower scales on integrated or mobile devices.

Target bloom GPU time, measured with the app's GPU timing tooling:

```text
desktop-discrete: <= 0.8 ms at 1440p with bloomScale 0.5
desktop-integrated: <= 1.5 ms at 1080p with bloomScale 0.33-0.5
mobile: <= 2.0 ms at 720p-1080p with bloomScale 0.25-0.33
```

If a target misses budget, reduce algorithmic cost first: lower bloom
resolution, narrow the contribution target, reduce transparent emitters, or use
static contribution textures. Do not add a second scene render to regain
selectivity.

## Replaced techniques

Replaced prior two-pass selection with MRT emissive-output bloom because MRT
keeps selectivity in the primary scene pass and avoids repeat traversal, draw
submission, material evaluation, animation deformation, and transparency
sorting.

Replaced temporary whole-scene material overrides with authored emissive
contribution because overrides are fragile around material arrays, dynamic
objects, sprites, particles, instancing, batching, skinning, morphing, and
render errors. The restoration invariant remains useful only as historical
context; do not teach it as a build step.

Replaced custom bloom pyramids and pass wrappers with built-in `BloomNode`
because the current node pipeline already owns resolution scaling, size
updates, disposal, and TSL integration. Add custom logic only through measured
extensions such as `highPassFn`.

Replaced low-threshold whole-scene bloom calibration with an explicit emissive
hierarchy because ordinary bright albedo should not become bloom membership.

## Diagnostics and acceptance

Checkpointed build order:

1. Checkpoint: MRT output and emissive contribution.
   must see only authored lamps, laser, projectile, sparks, and transparent emitter in emissive.
   if you see bright metal or white floor contribution, mistake: threshold is being used as membership.
2. Checkpoint: high-pass and bloom-only.
   must see high-pass rejection of low-energy pixels and a five-mip separable blur footprint.
   if you see hard silhouettes or no halo falloff, mistake: high-pass or blur pyramid is bypassed.
3. Checkpoint: final HDR composite before output.
   must see base readability preserved with bloom disabled and one output transform owner.
   if you see gray highlights or washed base color, mistake: output conversion or HDR clamp happened too early.
4. Checkpoint: reduced mode.
   must see `dynamicMrt:false` and no live MRT-dependent bloom path.
   if you see reduced mode calling the emissive MRT texture, mistake: quality downgrade still depends on full-tier resources.

Expose fixed diagnostic views:

```text
MRT output scene color
MRT emissive contribution
false-color pre-tone-map luminance
bloom-only texture node
base without bloom
final output
transparent-emitter contribution
resolution-scale overlay
GPU time per pass
```

Acceptance checks:

- disabling bloom leaves the scene form, material hierarchy, and effects readable;
- emissive contribution contains only authored bloom members;
- ordinary sunlit, white, or metallic surfaces do not bloom unless explicitly
  authored to contribute;
- threshold and smooth width are tuned before tone mapping;
- radius remains visually stable across resize and pixel-ratio caps;
- the full tier meets the scene-render multiplier of 1x;
- reduced tiers degrade gracefully through resolution or authored assets, not
  a parallel renderer;
- final output has exactly one tone-map and output color conversion owner.
