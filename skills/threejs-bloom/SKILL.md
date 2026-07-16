---
name: threejs-bloom
description: Bloom scene-linear HDR in Three.js WebGPU/TSL. Use when choosing optical full-scene glare, selective or hybrid contributors, transparent contribution blending, or viewport, exposure, and performance gates for BloomNode.
---

# Bloom

Treat bloom as the broad tail of an imaging point-spread function. Its closest
built-in optical input is all scene-linear HDR radiance. Selective contribution
is an art-direction branch, not an automatic quality upgrade.

## 1. Validate the source scene

Capture scene-linear HDR, false-color pre-tone luminance, and the final image
with bloom disabled. Repair the source when highlights were clamped or when
silhouette, material, or lighting identity disappears without bloom.

This step is complete when the bloom-off scene remains readable and the input
is unclamped scene-linear HDR in a declared working basis.

## 2. Choose the signal

| Contract | Signal | Admission test |
| --- | --- | --- |
| optical glare from emission, direct response, reflection, transmission, sky, and sun | full scene HDR | a luminance threshold and knee meet contributor error limits |
| named surfaces glow differently from equally bright radiance | selective emissive contribution | full-scene threshold cannot meet those limits and the MRT delta fits |
| optical highlights plus deliberate boost | scene HDR plus selective boost | both components are required and the shared attachment is charged once |
| source scene fails without glare or all bloom tiers miss a gate | defer bloom | source is repaired or budget/viewport changes |

Stabilize exposure before comparing branches. Inspect both false-positive and
false-negative bloom energy, including bright mirrors and transmissive surfaces.

This step is complete when one source branch is named, its omissions are
accepted, and its contribution error and target-device cost meet declared
limits.

## 3. Build one scene pass

Use one HDR scene traversal for both full-scene and selective bloom. Full-scene
bloom reads the scene output. Selective bloom adds an `emissive` MRT output to
the same pass and gives it `BlendMode(MaterialBlending)` so transparent
contributions follow the material blend state.

In r185, material-level `mrtNode` merging can lose the operative blend-mode map.
Keep the canonical selective path on the regular `emissiveNode`; use a separate
measured contribution pass or source-verified custom merge only when visible
emission and bloom contribution must diverge.

Choose the final-output alpha branch before adding bloom RGB:

- opaque or already composited output: use
  `vec4(scene.rgb + bloom.rgb, 1)`;
- transparent coverage-clipped output: use
  `vec4(scene.rgb + bloom.rgb, scene.a)` and explicitly accept that glare
  outside source coverage is discarded;
- transparent output that must preserve halos outside source coverage:
  composite over the known background before `renderOutput()`, or publish
  separate glare RGB with an explicit coverage/compositing contract.

Unchanged source alpha cannot claim preserved transparent halos. Verify
transparent contribution overlap in both insertion orders and under the chosen
premultiplied/straight-alpha policy.

This step is complete when scene traversal count is known, every contribution
uses the intended depth/sort/blend/alpha state, overlapping contributors
accumulate correctly, and the final-output alpha branch states whether halo
outside source coverage is discarded, composited, or represented separately.

When implementing the full-scene, selective, or hybrid graph, or transparent
selective contribution, read
[r185 graphs and transparent blending](references/hdr-bloom-system.md#r185-graphs-and-transparent-blending).

## 4. Set threshold and footprint

Name the threshold domain:

- scene-referred: fixed in the bloom input's radiance basis;
- exposed-linear: convert from the current adapted exposure;
- display-referred: use only with a stable inverse of the declared tone/output
  path.

Convert threshold and soft-knee width together when exposure or calibration
changes. Treat `radius` as cross-mip spread, not a physical radius. Validate
minimum and maximum viewport/DPR. Stock r185's five-level chain requires:

```text
floor(bloomScale * min(drawingBufferWidth, drawingBufferHeight)) >= 16
```

This step is complete when threshold units and update owner are explicit, the
halo passes endpoint views, and the deepest mip remains valid at every shipping
extent.

When tuning spread, scale, or a nonstandard optical footprint, read
[BloomNode PSF and work](references/hdr-bloom-system.md#bloomnode-psf-and-work).

## 5. Join the final-image graph

Use this default order:

```text
stable scene-linear HDR
  -> temporal resolve, when present
  -> excluded transparent/refractive layers
  -> pre-bloom meter tap
  -> bloom extraction, blur, and RGB add
  -> adapted exposure
  -> tone map, grade, and one output conversion
```

Selective input that bypasses temporal resolve still needs a stability decision
for subpixel or discontinuous emission. Keep UI and diagnostics outside HDR
bloom unless the visual contract includes them. After changing the active
output graph, set `RenderPipeline.needsUpdate = true`.

This step is complete when bloom has one owner, every admitted meter, exposure,
tone map, alpha operation, and output conversion has one owner, the selected
output-alpha branch is preserved through presentation, and the bloom-off graph
is genuinely reachable.

When coupling threshold to exposure or selecting final output ownership, read
[Exposure, output, and lifecycle](references/hdr-bloom-system.md#exposure-output-and-lifecycle).

Use `$threejs-exposure-color-grading` for exposure-coupled thresholds, tone
mapping, grading, and output conversion. Use `$threejs-image-pipeline` when the
scene pass, MRT signals, transparent ordering, or final graph is shared with
other effects.

## 6. Measure, degrade, and dispose

Measure warmed paired graphs: scene alone, full-scene bloom, scene with
contribution MRT, and selective/hybrid bloom where applicable. Report physical
pixels, scale, attachment formats, target inventory, transparent screen
coverage, sustained timing, and marginal time. Reduce bloom scale first for a
pixel-bound miss, then remeasure; full-scene input can remove a costly
full-resolution contribution attachment. Disable bloom when the minimum-mip,
memory, thermal, or marginal-time gate still fails.

Replace the output node for the disabled path, mark the pipeline dirty, and
dispose `BloomNode` and any exclusive contribution resources after final GPU
use. Recreate evidence after renderer/device loss or format generation change.

This step is complete when every shipping tier passes fixed captures and
sustained target-device budgets, bloom-off timing loses the bloom work, and
repeated enable/disable, resize, and disposal cycles stabilize resources.

When calculating exact internal storage/work or diagnosing a failed gate, read
[Budget and acceptance](references/hdr-bloom-system.md#budget-and-acceptance).
