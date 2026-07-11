# Native WebGPU selective BloomNode lab

This folder demonstrates the art-directed selective branch of
`threejs-bloom`. Full-scene HDR bloom is the preferred optical/bandwidth path
when one luminance rule can describe the desired response. Use this example
only after the skill's false-positive/false-negative source gate requires
selectivity.

The folder has an executable browser entry, fixed mechanism/tier routes, a
`LabController`, aligned render-target readback, runtime inventory of
BloomNode's internal targets, and a renderer-independent
`createSelectiveBloomStage(...)` factory. Browser captures and current-adapter
timing remain required before its manifest can move from `incomplete`.

## Graph

```text
WebGPURenderer: WebGPU, HalfFloatType, no inherited MSAA
  -> one scene PassNode
  -> MRT output + emissive
     emissive blend mode = BlendMode(MaterialBlending)
  -> BloomNode(emissive), reduced resolution
  -> vec4(scene.rgb + bloom.rgb, scene.a)
  -> one renderOutput owner
```

The selective path adds one RGBA16F contribution attachment but no second scene
render. It is not automatically better than `bloom(sceneColor)`: reflected and
transmitted highlights are absent unless explicitly authored.

## Transparent emissive contract

r185 assigns material blending only to MRT output named `output`; other outputs
default to no blending. The example therefore calls:

```js
const materialBlend = new THREE.BlendMode( THREE.MaterialBlending );
sceneMRT.setBlendMode( 'emissive', materialBlend );
```

The two overlapping transparent emitters use additive premultiplied emission:

```text
visible base color = zero
emissiveNode = radiance * opacity
opacityNode = opacity
premultipliedAlpha = true
blending = AdditiveBlending
```

The same regular `emissiveNode` feeds the contribution MRT. Do not add a
material-level `mrtNode` in this r185 path: installed `MRTNode.merge()` stores
merged blend state under `blendings` instead of `blendModes`, so a material MRT
override drops the scene's configured emissive blend mode. If visible and bloom
emission must diverge, use a separately costed contribution pass or a source-
verified custom MRT fix; do not assume stock merge preserves blending.

The final composite adds bloom RGB and preserves scene alpha. A plain vec4 add
inflates alpha because BloomNode's blur/composite carries nonzero alpha.

## General luminance fixtures

```text
pulsed reference marker: 32       [Authored]
calibration source:       16       [Authored]
luminous instrument bar:  8       [Authored]
practical lamp filament:  4       [Authored]
ordinary lit surface:      0       [Authored]
```

The bright metal block deliberately has no emissive membership. The overlapping
transparent pair proves that contribution blending accumulates instead of
last-writer replacement.

## Quality tiers

```text
full:     bloom scale 0.5, DPR cap 2.0, selective MRT enabled       [Authored]
balanced: bloom scale 0.33, DPR cap 1.5, fewer contributors         [Authored]
mobile:   bloom scale 0.25, DPR cap 1.0, selective MRT enabled      [Authored]
reduced-readable-base: bloom and MRT unreachable                    [Authored]
```

Reduced mode selects the readable base scene and makes the bloom graph
unreachable; setting strength to zero would not be a bypass. The controller
now rebuilds the owned stage when mode or tier changes: `no-post`, luminance,
overlay, and reduced routes own only the base pass; emissive diagnostics own
only the selective MRT; combined/bloom-only routes own the MRT plus BloomNode.
The replaced stage is disposed before the new graph is published, so hidden
BloomNode targets do not survive a base-only tier switch.

`describeResources()` follows the active stage kind. It lists scene output,
emissive and validation-only attachments only when allocated, all eleven
BloomNode targets only when BloomNode exists, and the scene depth attachment.
Color payload bytes are derived; `depth24plus` physical bytes, alignment, and
resident allocation remain `INSUFFICIENT_EVIDENCE` until adapter inspection.

## Derived cost floor

At `1920x1080`, bloom scale `0.5`, BloomNode's fixed internal targets occupy
`14.49 MiB`; the selective full-resolution RGBA16F emissive attachment adds
`15.82 MiB`, for `30.31 MiB` before scene output, depth, alignment, and tile
scratch **[Derived]**. The node submits `12` fullscreen draws and approaches
`42.3047 A` texture samples plus `4.6641 A` writes for
`A = scale^2 * width * height` **[Derived]**.

Planning rejection ceilings are `0.8 ms` at `2560x1440`, scale `0.5` on
discrete desktop; `1.5 ms` at `1920x1080`, scale `0.33-0.5` on integrated
desktop; and `2.0 ms` at `1280x720`, scale `0.25-0.33` on mobile
**[Authored]**. They are not measured claims.

## Static checks

```bash
npm --prefix threejs-bloom/examples/node-selective-bloom run check
npm --prefix threejs-bloom/examples/node-selective-bloom run validate
npm --prefix threejs-bloom/examples/node-selective-bloom run test:mutations
npm --prefix threejs-bloom/examples/node-selective-bloom run validate:quick
```

`capture` writes raw scene, emissive, bright-pass, bloom, and odd-size WebGPU
render-target readbacks with aligned-stride metadata. It deliberately does not
rename those targets as a final composite or use a page screenshot. The raw
candidate remains `INSUFFICIENT_EVIDENCE` until a color-managed composite,
standard PNG set, GPU timestamps, and lifecycle evidence exist.
`validate:artifacts` rejects missing/incomplete v2 bundles; `validate:full`
also requires every claim verdict to be `PASS`.

The validator asserts:

- WebGPU-only routing;
- one scene render and no override selection pass;
- explicit emissive `MaterialBlending`;
- premultiplied regular `emissiveNode` authoring with no material `mrtNode`;
- two overlapping transparent contributors;
- bloom RGB addition with scene alpha preservation;
- no inherited renderer MSAA;
- disabled reduced tier and conditional resize handling.

Mechanism/tier Pages wrappers may select startup state through either fixed
path segments or strict query parameters. Path locks take precedence. Unknown
mechanisms, tiers, scenarios, modes, cameras, seeds, times, and diagnostic flags
throw instead of silently selecting a default. Runtime metrics report the
resolved mechanism and tier.

The PSF, non-emissive ROI, emissive hierarchy, transparent-occlusion, and
no-post-readability gates are implemented as claim-specific metric evaluators.
Without measured fixture probes each verdict remains
`INSUFFICIENT_EVIDENCE`; the lab has no aggregate shortcut to acceptance.

## Runtime acceptance still required

- Capture emissive-only output for the overlapping transparent pair in both
  insertion orders; additive energy must be invariant.
- Capture a bright mirror and transmissive surface to prove why selective input
  was chosen over scene-color bloom.
- Sweep threshold/soft knee only in pre-tone scene-linear space.
- Sweep minimum/maximum DPR and aspect; reject halo-footprint drift outside the
  authored tolerance.
- Enforce the deepest-level gate
  `floor(scale * min(drawingBufferWidth, drawingBufferHeight)) >= 16`
  **[Derived/Gated]**.
- Record scene MRT delta, BloomNode stages, transparent overdraw, attachment
  bytes, and sustained mobile thermal behavior.
- Disable bloom and prove both base readability and measured pass bypass.

The browser implementation is present, but the missing evidence remains an
explicit blocker rather than a fabricated pass.
