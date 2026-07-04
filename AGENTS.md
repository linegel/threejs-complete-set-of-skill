# Repository Agent Notes

## Commit Messages

After requested edits pass verification, commit the completed change. Do not
leave verified work uncommitted unless the user explicitly asked not to commit
or the only remaining changes are unrelated user work that must be left alone.

Every commit message in this repo MUST end with a short, original joke as its
final paragraph:

- One or two lines, genuinely funny: IT, gamedev, graphics, LLM/AI humor.
- Tailor it to what the commit actually touches. A shadow fix gets a shadow
  joke; a bloom tweak gets a bloom joke.
- Unique: never reuse a joke already present in `git log`. Check before
  committing.
- Optionally, and sparingly, it may wink at https://devme.me/. Keep this light;
  most jokes should stand on their own.

Structure stays conventional otherwise: `type(scope): subject`, a descriptive
body explaining what and why, then the joke as the closer.

No AI-attribution trailers in commits. Do not add `Claude-Session` or
`Co-Authored-By`.

## Three.js / WebGPU Field Notes From Local Validation

These notes are repo-local guidance from hands-on validation work in this
workspace. Treat checked-in source, examples, tests, and skill instructions as
the source of truth, but use these notes to avoid repeating known bad paths.

### What Works

- Use `WebGPURenderer` from `three/webgpu` and `await renderer.init()` before
  capability checks or rendering. After init, verify
  `renderer.backend.isWebGPUBackend === true` for canonical WebGPU examples.
- Browser examples work reliably with an import map that maps:
  - `three` and `three/webgpu` to `node_modules/three/build/three.webgpu.js`
  - `three/tsl` to `node_modules/three/build/three.tsl.js`
  - `three/addons/` to `node_modules/three/examples/jsm/`
- A canonical node post pipeline can use one `RenderPipeline`, one `pass(scene,
  camera)`, and one `scenePass.setMRT(mrt({ output, normal, emissive,
  velocity }))`. Downstream AO, bloom, temporal, and diagnostics should consume
  the shared pass textures instead of triggering another full scene render.
- When `renderOutput(...)` owns final presentation, keep
  `renderPipeline.outputColorTransform = false`. Validate this explicitly so
  tone mapping/output conversion is not split or doubled.
- `MeshStandardNodeMaterial` works for validation subjects when `colorNode` and
  `emissiveNode` are set explicitly with TSL nodes. Do not infer that classic
  material constructor fields always exercise the intended NodeMaterial path.
- Diagnostic mode switching works when `setDebugMode()` assigns
  `renderPipeline.outputNode` and then sets `renderPipeline.needsUpdate = true`.
  Without the update flag, captures can stay stuck on the previous output node.
- Playwright headless Chromium can run local WebGPU validation with flags such
  as `--enable-unsafe-webgpu`, `--enable-features=Vulkan,UseSkiaRenderer`, and
  `--disable-gpu-sandbox`. Prefer render-target readback for evidence; browser
  page screenshots may show only CSS/background even when WebGPU readback works.
- `readRenderTargetPixelsAsync()` works for PNG evidence, but WebGPU readback may
  include padded rows. Compute and carry an integer `bytesPerRow`; do not assume
  tightly packed rows.

### What Does Not Work

- Do not use `pixels.length / height` as the PNG row stride. In this session it
  produced a fractional stride and generated images with only a few horizontal
  bands even though the render target contained valid output.
- Do not trust a passing "nonblank" check that only checks min/max range and
  alpha count. A bad stride can pass weak nonblank validation. Add checks that
  important images differ from diagnostics and inspect at least one final image.
- Do not treat a headless browser screenshot of a WebGPU canvas as proof that
  the scene failed. Headless presentation can be blank while render-target
  readback is valid.
- Do not accept `diagnostics.mosaic.png` if it is just another final-frame
  capture. Build it from actual diagnostic modes and validate that it differs
  meaningfully from `final.design.png`.
- Do not route or teach fallback behavior automatically when WebGPU is
  unavailable. Missing WebGPU is a blocker for canonical flagship skills unless
  the user explicitly asks how to apply fallback when WebGPU is unavailable.

### Why These Failures Happened

- WebGPU readback row padding follows GPU alignment rules. For a 1200-wide RGBA
  image, `width * 4` is 4800 bytes, but the aligned row stride can be 4864
  bytes. The total buffer length may be `alignedStride * (height - 1) + rowBytes`
  rather than `rowBytes * height`.
- A fractional stride caused JavaScript typed-array indexing to return
  `undefined`; when encoded to PNG bytes, those became zeros. The resulting PNG
  looked like black output with a few horizontal lines.
- Render-pipeline diagnostics are graph state, not just labels. If the output
  node is changed without marking the pipeline dirty, old output can remain in
  captures.

### Failed Hypotheses From This Session

The blank/striped PNG problem took nine applied hypothesis edits before the
actual root cause was found. Record the count because this is where future
agents can save time:

1. Added scene lights. The image stayed black/striped because lighting was not
   the failure; PNG row indexing was wrong.
2. Switched the cube to explicit `colorNode` and `emissiveNode`. This was a good
   canonical NodeMaterial cleanup, but it did not change the bad capture.
3. Forced the capture target to `UnsignedByteType`. The readback still produced
   the same horizontal bands because the stride calculation was still wrong.
4. Tried `MeshBasicNodeMaterial` with a material-level `mrtNode`. The artifact
   remained bad; material output was not the root cause.
5. Removed the material-level `mrtNode`. The artifact remained bad.
6. Temporarily rendered with `renderer.renderAsync(scene, camera)` and awaited
   `app.render()`. This produced only a deprecation warning and did not prove
   the scene was failing.
7. Switched the subject to classic `MeshBasicMaterial`. The artifact still
   looked blank/striped, so material choice was not the issue.
8. Added a large validation plane in front of the camera. It still did not show
   in the encoded PNG, which pointed away from geometry/camera setup.
9. Temporarily changed direct rendering to sync `renderer.render(scene, camera)`.
   The encoded PNG still failed.

The successful fix was not a scene/material/render-pipeline change. It was:

- compute the integer WebGPU readback stride, including 256-byte row alignment;
- reject fractional or too-small strides before PNG encoding;
- then inspect regenerated `final.design.png` and `diagnostics.mosaic.png`.

After the stride fix, a separate diagnostics issue remained: the diagnostic
capture was too similar to final. That was fixed by setting
`renderPipeline.needsUpdate = true` after output-node changes, building the
mosaic from multiple real diagnostic modes, and validating that the mosaic
meaningfully differs from `final.design.png`.

### Validation Expectations

- Run `node --check` on browser/capture/validation scripts before capture.
- Run package validation and artifact validation after each capture.
- Visually inspect at least `final.design.png` and `diagnostics.mosaic.png`.
- Artifact evidence should include renderer info, render-target inventory,
  timing labels, leak-loop notes, required images, and explicit diagnostics.
- For fallback wording, use: "teaching how to apply fallback when WebGPU is
  unavailable", and only when the user explicitly asked for that.


Note: Act as PhD in Comp Sci and Physics -- go review those fucking critters. Apply all the in-depth knowledge for your review to ensure top performance of all alghorithms. Whats more important: all those skills must be written without "water" -- target audience IS REAL Comp Sci and Physics majors and PhD
