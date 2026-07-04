# Production WebGPU/TSL Image-Pipeline Contracts

Use this reference to compose shared scene buffers, lighting effects,
atmosphere, bloom, exposure, tone mapping, grading, temporal history,
diagnostics, and feature-local targets with explicit ownership.

## Contents

- Canonical node pipeline
- Signal and ownership table
- Output ownership and color domains
- Temporal opt-in contract
- Depth, normal, alpha, and transparency policy
- Resolution and quality tiers
- Replaced techniques
- Lifecycle and diagnostics

## Canonical Node Pipeline

The fastest general architecture is one `WebGPURenderer`, one `RenderPipeline`,
one primary scene `pass()`, and shared `mrt()` outputs. Build this graph first:

```text
pass(scene, camera)
  mrt:
    output: scene-linear HDR color
    normal: view-space normal
    albedo: scene-linear diffuse/base color when an indirect composite needs it
    emissive: HDR bloom contribution
    velocity: optional screen-space motion for temporal nodes
  depth: pass depth texture

shared nodes:
  GTAONode(depth, normal, camera) at quality scale
  lighting composite from output, AO.r, bent/normal data, optional albedo
  atmosphere/fog/refractive resolve from shared depth and normal policy
  BloomNode(emissive or HDR color) with setResolutionScale()
  optional TRAANode(beauty, depth, velocity, camera)
  exposure meter from reduced HDR luminance
  tone-map owner
  LUT/grading in the selected color domain
  output conversion owner
  display-referred presentation nodes and UI-safe overlay
```

Minimal skeleton:

```js
import { WebGPURenderer, RenderPipeline, HalfFloatType } from 'three/webgpu';
import { pass, mrt, output, normalView, emissive, renderOutput } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const renderer = new WebGPURenderer( { antialias: false, outputBufferType: HalfFloatType } );
await renderer.init();

const renderPipeline = new RenderPipeline( renderer );
const scenePass = pass( scene, camera );

scenePass.setMRT( mrt( {
  output,
  normal: normalView,
  emissive
} ) );

const hdrColor = scenePass.getTextureNode( 'output' );
const normalTex = scenePass.getTextureNode( 'normal' );
const emissiveTex = scenePass.getTextureNode( 'emissive' );
const depthTex = scenePass.getTextureNode( 'depth' );

const gtao = ao( depthTex, normalTex, camera );
gtao.resolutionScale = 0.5;

const bloomPass = bloom( emissiveTex );
bloomPass.setResolutionScale( 0.5 );

const indirectVisibility = gtao.getTextureNode().r;
const debugFinalColorMultiplyBaseline = hdrColor.mul( indirectVisibility ); // debug baseline only
const applyIndirectVisibilityOnly = ( color, visibility ) => {
  // Local helper, not a Three.js API: replace with separated indirect lighting
  // when the scene exposes direct/indirect terms. Until then, preserve direct,
  // emissive, atmosphere, and UI signal instead of darkening final color.
  void visibility;
  return color;
};
const lightingAwareComposite = applyIndirectVisibilityOnly( hdrColor, indirectVisibility );
const hdrComposite = lightingAwareComposite.add( bloomPass.getTextureNode() );

renderPipeline.outputColorTransform = false;
renderPipeline.outputNode = renderOutput( hdrComposite );
```

Adjust the composite to separate direct, indirect, emissive, atmosphere, and UI
terms when the material model exposes them. Blind final-color multiplication is
only acceptable as the named `debugFinalColorMultiplyBaseline`; it must not be
the canonical final path.

## Signal And Ownership Table

Before implementation, write this table for the actual scene:

| Signal | Producer | Consumers | Space/type | Color space | Resolution | History | Disable path |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HDR color | scene `pass()` MRT `output` | AO composite, atmosphere, alternate bloom source, exposure | RGBA16F | scene-linear HDR | 1.0 | no | direct output |
| depth | scene `pass()` | AO, fog, refraction, temporal rejection | depth texture plus linear/view-Z node | data | 1.0 | optional previous | disable depth effects |
| normal | scene `pass()` MRT `normal` | AO, upsample, debug, refraction | view-space vec3 | data | 1.0 | no | reconstruct from depth only as reduced tier |
| albedo | scene `pass()` MRT `albedo` when needed | indirect-light AO/tint | RGBA8 or RGBA16F by material range | scene-linear/data by use | 1.0 | no | skip indirect tint |
| emissive | scene `pass()` MRT `emissive` | `BloomNode` | RGBA16F | scene-linear HDR | 1.0 source, bloom pyramid reduced | no | bloom from HDR color or off |
| velocity | scene `pass()` MRT `velocity` | `TRAANode`, motion blur, temporal denoise | RG16F screen pixels or UV delta | data | 1.0 | previous matrices | disable temporal nodes |
| exposure | luminance compute or node meter | tone-map owner | scalar/storage buffer or tiny texture | data | 64x36 or smaller | adapted | fixed exposure |
| UI overlay | DOM or post-output pass | final presentation | display-referred | sRGB | display | no | hide overlay |

Every signal has exactly one producer. If another feature wants a duplicate
prepass, it must state the saved work, extra memory, and GPU time compared with
using the shared signal.

## Interface Space Convention Table

Every implementation must declare these conventions before code:

| Interface | Required convention |
| --- | --- |
| world | Three.js Y-up; camera-authored systems state any floating-origin offset |
| view | camera looks down `-Z`; view-space normals are encoded before color conversion |
| clip / NDC | document projection owner, jitter owner, and depth range |
| depth | choose `reversedDepthBuffer`, `logarithmicDepthBuffer`, or standard depth and name the view-Z helper |
| UV / texel | document UV origin, texel-center offsets, and whether deltas are pixels or UV units |
| velocity | current-to-previous or previous-to-current sign, pixel or UV units, jitter included or excluded |
| color | scene-linear HDR, tone-mapped linear, display-referred sRGB, and data/no-color domains |

## Output Ownership And Color Domains

Use one of two endings.

Scene-linear ending:

```text
HDR composite -> exposure/tone-map -> output color transform
```

Keep `RenderPipeline.outputColorTransform = true` only when the final
`outputNode` is still scene-linear HDR and no display-referred node needs to
run later.

Manual output ending:

```text
HDR composite -> renderOutput(tone map + color transform)
  -> display-referred LUT, edge cleanup, dither, UI-safe overlay
```

Set `RenderPipeline.outputColorTransform = false` for this path. `renderOutput()`
is the only tone-map and output-conversion owner.

| Domain | Examples | Placement |
| --- | --- | --- |
| Scene-linear HDR | lighting, atmosphere, bloom, exposure meter | before tone mapping |
| Tone-mapped linear | creative looks designed before display conversion | after tone mapping but before output conversion |
| Display-referred sRGB | display LUTs, edge cleanup, dither, canvas UI pass | after `renderOutput()` |
| Data/no-color | depth, normal, velocity, masks, LUT indices, history, timers | never color converted |

Rules:

- Color textures use `SRGBColorSpace`; data textures use no color transform.
- Working HDR buffers use `HalfFloatType` until tone mapping.
- UI pixels should be DOM/CSS overlay, a post-output pass, or an explicitly
  excluded layer. They must not feed exposure or bloom unless intentionally
  authored as scene light.

## Temporal Opt-In Contract

Temporal nodes are opt-in. Do not advertise temporal quality until these
signals are complete:

- velocity buffer: screen-pixel or UV-delta convention, jitter convention, and
  sign documented;
- previous view/projection/object matrices for skinned and instanced objects;
- one jitter owner, with `TRAANode.setViewOffset()` or equivalent camera path;
- history targets for beauty and any denoised scalar that persists;
- rejection inputs: depth delta, velocity length, neighborhood clamp, material
  or object instability where available;
- reset events: resize, DPR change, camera cut, projection change, history
  format change, material ID instability, large exposure jump, and scene load;
- diagnostics: current, previous, rejected history, velocity magnitude, jitter
  sequence, and reset reason.

Use `TRAANode` first for temporal antialiasing/reprojection
(`import { traa } from 'three/addons/tsl/display/TRAANode.js'`). Custom temporal
nodes must beat it for the specific effect or provide a capability it lacks.

Compute/storage path for live meters, reductions, and history preparation:

```text
Fn().compute(count)
  -> renderer.compute() or renderer.computeAsync()
  -> StorageTexture / StorageBufferAttribute / StorageInstancedBufferAttribute
  -> storage(), storageTexture(), textureStore() where the algorithm writes data
```

Keep compute read-back-free during the frame. CPU reads are diagnostics or
offline calibration, not runtime feedback loops.

## Depth, Normal, Alpha, And Transparency Policy

Depth and normals are pipeline-owned, not effect-owned.

- Pick reversed-depth or logarithmic-depth policy at renderer creation and
  record how every consumer reconstructs view-Z.
- Sky/background must have an explicit depth classification so fog, atmosphere,
  and AO do not treat it as nearby geometry.
- Alpha-tested geometry must participate in the scene pass and matching depth
  semantics, or AO/refraction will halo around foliage and cutouts.
- Transparent and refractive objects need a named policy: composite after AO,
  write approximated depth separately, or exclude from selected screen effects.
- Particles and sprites need separate bloom/exposure rules; do not let tiny HDR
  sprites dominate metering unless desired.
- MSAA resolve points must be named before a texture is consumed by a node.

## Resolution And Quality Tiers

Use global DPR for scene cost and per-node `setResolutionScale()` for bandwidth
cost. They solve different problems.

Suggested starting scales:

| Pass/effect | Full tier | Reduced tier |
| --- | ---: | ---: |
| scene `pass()` MRT | 1.0 | 0.75-1.0 by pixel budget |
| `GTAONode` | 0.5-1.0 | 0.33-0.5 or off |
| `BloomNode` | 0.5 | 0.33-0.5 |
| exposure meter | 64x36 or smaller | fixed exposure or 32x18 |
| temporal resolve | 1.0 | off unless velocity is reliable |
| display presentation | 1.0 | 1.0 |

Pixel-budget DPR:

```text
mobile budget = 0.75M-1.0M pixels, max DPR 1.25
desktop integrated budget = 1.2M-1.7M pixels, max DPR 1.5
desktop discrete budget = 2.0M-3.7M pixels, max DPR 2.0 when measured
budget DPR = sqrt(pixelBudget / CSS pixel count)
```

Per 1920x1080 memory guide:

```text
RGBA16F attachment: about 16 MB
RG16F velocity: about 8 MB
R16F scalar/history: about 4 MB
RGBA8 display/data: about 8 MB
4x RGBA16F MRT set: about 64 MB before history/pyramids
```

Target total post cost:

```text
desktop discrete: 2.0-4.0 ms at 1440p
desktop integrated: 3.0-5.5 ms at 1080p
mobile/tiled: 4.0-7.0 ms at 720p-900p
```

## Replaced Techniques

- Replaced multiple selective scene renders with emissive MRT feeding
  `BloomNode`. This removes repeated scene traversal and material swapping for
  the common selective-bloom case.
- Replaced separate depth prepass by default with the primary pass depth and
  MRT normals. A depth prepass is only kept when measurement shows it reduces
  overdraw or feeds a feature that cannot use the scene pass.
- Replaced stack-style post chains with one `RenderPipeline.outputNode`. This
  gives one output owner and lets nodes share pass textures without hidden
  scene rerenders.
- Replaced whole-frame final-color AO multiplication with lighting-aware
  composition from `GTAONode` output. Final-color multiplication hides material
  and atmosphere ownership bugs.
- Replaced frame-based temporal decay with velocity/depth-rejected history.
  Same-UV blending is not a temporal contract.
- Replaced manual shadow-cache recipes with sibling shadow skills and built-in
  node shadow systems. This skill only consumes their lit output and diagnostics.
- Replaced display-referred grading ambiguity with explicit LUT domains and a
  single `renderOutput()`/`outputColorTransform` decision.

## Lifecycle And Diagnostics

Lifecycle checklist:

- call `await renderer.init()` before compute/storage decisions;
- create node passes after renderer, scene, camera, tone mapping, and environment
  ownership are known;
- call `scenePass.compileAsync( renderer )` only after `setMRT()` and all
  `getTextureNode()` consumers are created;
- call `renderer.initRenderTarget()` after `await renderer.init()` when known
  render targets need first-frame prewarm;
- on resize or DPR change, update renderer size, pass sizes, history targets,
  storage textures, exposure meter size, and reset temporal history;
- dispose disabled or replaced pass/effect nodes and render targets;
- name every MSAA resolve point and every history swap;
- record format downgrade, memory, pass count, and GPU time for each enabled
  node.

Expose a graph inspector or equivalent stable views:

```text
scene HDR
depth raw, linear depth, and reconstructed view/world position
normal, albedo, emissive, and velocity MRT
GTAO AO.r, denoise state, and bent-normal/indirect composite
atmosphere/fog only
bloom source, mip/pyramid, and contribution
exposure meter, adapted exposure, and fixed-exposure tier
pre-tone-map, post-tone-map, LUT input/output, final output transform
temporal current, previous, rejected, and reset reason
UI mask/exclusion
pass resolution scale, format, memory, and GPU time
```

The pipeline is accepted only when every enabled pass has a named input,
output, owner, resolution scale, memory cost, GPU time, and disable path.

Build-order traps:

- Trap: AO final-color multiply darkens direct light, emissive pixels,
  atmosphere, and UI. Keep it as `debugFinalColorMultiplyBaseline` only.
- Trap: velocity sign inversion produces temporal ghosts that look like blur;
  record current-to-previous versus previous-to-current before enabling history.
- Trap: sky depth misclassification makes fog, AO, and refraction treat the
  background as nearby geometry.
- Trap: alpha-test/depth mismatch creates AO and refraction halos around foliage,
  sprites, and cutouts.
- Trap: double `outputColorTransform` or `renderOutput()` converts the final
  image twice.
- Trap: sRGB-as-data corrupts normal, roughness, mask, velocity, and history
  targets.
