# Node selective bloom

Canonical WebGPU/TSL selective bloom example for `threejs-bloom`.

## Demonstrates

- `WebGPURenderer` with `RenderPipeline`.
- One `pass( scene, camera )` configured with `mrt( { output, emissive } )`.
- `BloomNode` from `bloom()` fed by `scenePass.getTextureNode( 'emissive' )`.
- No material swapping, no second scene render, and no whole-scene override pass.
- Scene-relative HDR emissive tiers authored with `MeshStandardNodeMaterial.emissiveNode`.
- One explicit `renderOutput(...)` owner with `renderPipeline.outputColorTransform = false`.
- Runtime controls for `strength`, `radius`, `threshold`, `smoothWidth`, and bloom `resolutionScale`.
- Debug outputs: `combined`, `emissive-only`, `bloom-only`, `no-post-baseline`, `false-color-luminance`, `resolution-scale-overlay`, and `transparent-emitter`.

## Pipeline graph

```text
WebGPURenderer { outputBufferType: HalfFloatType }
  -> await renderer.init()
  -> quality gate from renderer.backend.isWebGPUBackend
  -> RenderPipeline { outputColorTransform: false }
  -> scenePass = pass( scene, camera )
  -> scenePass.setMRT( mrt( { output, emissive } ) )
  -> sceneColor = scenePass.getTextureNode( 'output' )
  -> emissiveContribution = scenePass.getTextureNode( 'emissive' )
  -> bloomPass = bloom( emissiveContribution, strength, radius, threshold )
  -> bloomPass.smoothWidth + bloomPass.setResolutionScale( tier.bloomScale )
  -> combined = sceneColor + bloomPass.getTextureNode()
  -> renderOutput( combined )
```

Debug graph switches only replace the final output node:

```text
combined                 -> renderOutput( sceneColor + bloomOutput )
emissive-only            -> renderOutput( emissiveContribution )
bloom-only               -> renderOutput( bloomOutput )
no-post-baseline         -> renderOutput( sceneColor )
false-color-luminance    -> renderOutput( pre-tone-map luminance view )
resolution-scale-overlay -> renderOutput( tier bloomScale overlay )
transparent-emitter      -> renderOutput( transparent emitter contribution diagnostic )
```

## Authored luminance hierarchy

```text
short spark flash:        32
projectile core:          16
persistent laser:          8
practical lamp filament:   4
ordinary lit surface:      0
```

The bright metal block intentionally has no emissive node, so threshold alone does not make it a bloom member.

## Quality tiers

```text
full:
  bloomScale 0.5, pixelRatioCap 2, dynamic MRT emissive contribution

balanced:
  bloomScale 0.33, pixelRatioCap 1.5, fewer transparent/effect contributors

reduced:
  bloomScale 0.25, pixelRatioCap 1, dynamicMrt false, authored-static-or-disabled contribution policy
```

The reduced tier is a quality reduction with `dynamicMrt:false`; it keeps the base scene readable without a live MRT-dependent bloom path.

## Checkpoints

1. Checkpoint: MRT contribution.
   must see only authored emissive members in `emissive-only`.
   if you see bright metal, mistake: scene luminance is being used as bloom membership.
2. Checkpoint: bloom-only.
   must see soft high-pass glare around authored emitters.
   if you see hard silhouettes, mistake: the high-pass/five-mip blur path is bypassed.
3. Checkpoint: false-color luminance.
   must see scene-linear HDR ordering before output conversion.
   if you see display-clamped gray, mistake: threshold is being tuned after tone mapping.
4. Checkpoint: resolution-scale overlay.
   must see the selected tier's bloom scale reflected in diagnostics.
   if you see unchanged overlay after tier change, mistake: `setResolutionScale()` was not applied.
5. Checkpoint: transparent emitter.
   must see the `transparent-emitter` sprite contribution in diagnostics.
   if you see final glow but no emissive target signal, mistake: transparent depth/blend policy is wrong.
6. Checkpoint: reduced mode.
   must see `dynamicMrt:false` and no bloom-only signal.
   if you see reduced mode reading `emissive`, mistake: reduced mode still depends on full MRT resources.

## Budgets

```text
scene render count: 1
MRT targets: output + emissive
extra scene traversals for bloom: 0
temporary whole-scene overrides per frame: 0
HDR output target format: HalfFloatType / RGBA16F-equivalent
bloom resolution: 0.25-0.5 of renderer size by tier
draw-call multiplier from bloom selection: 1x
```

At 1920x1080, two RGBA16F full-resolution MRT targets are about 31.6 MiB before depth and BloomNode internals. Keep bloom-related transient targets under about 64 MiB at 1080p by running bloom below full resolution.

Target bloom GPU time:

```text
desktop-discrete: <= 0.8 ms at 1440p with bloomScale 0.5
desktop-integrated: <= 1.5 ms at 1080p with bloomScale 0.33-0.5
mobile: <= 2.0 ms at 720p-1080p with bloomScale 0.25-0.33
```

## Minimal usage

```js
import {
	DEBUG_MODES,
	createNodeSelectiveBloomExample
} from './examples/node-selective-bloom/index.js';

const canvas = document.querySelector( 'canvas' );

const bloomDemo = await createNodeSelectiveBloomExample( {
	canvas,
	seed: 0xB1004D,
	width: window.innerWidth,
	height: window.innerHeight,
	pixelRatio: window.devicePixelRatio
} );

bloomDemo.setBloomControls( {
	strength: 0.55,
	radius: 0.35,
	threshold: 0.9,
	smoothWidth: 0.08,
	resolutionScale: 0.5
} );

bloomDemo.setDebugMode( DEBUG_MODES.COMBINED );
bloomDemo.start();

window.addEventListener( 'resize', () => {

	bloomDemo.resize( window.innerWidth, window.innerHeight, window.devicePixelRatio );

} );

// Later:
// bloomDemo.dispose();
```
