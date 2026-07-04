# WebGPU Touch-History Frost

Canonical Phase 1 contract for `threejs-dynamic-surface-effects`.

## Interface Spaces

| Space | Owner | Notes |
| --- | --- | --- |
| pointer NDC | input system | `[-1, 1]`, converted to history UV. |
| history UV | compute pass | texel center addressing; no CSS-size math. |
| drawing-buffer pixels | renderer | physical width/height after DPR. |
| CSS size | app shell | never used for storage dispatch directly. |
| screen period uniforms | refraction | `mainScreenPeriod` and `detailScreenPeriod`, not texture sizes. |
| UV origin | node graph | document Y origin before sampling history. |
| camera/view | host image pipeline | scene color/depth/velocity stay host-owned. |

## Checkpoints

1. Storage history: two RGBA16F `StorageTexture` descriptors with `NoColorSpace`.
2. History compute: `Fn().compute(count)` dispatch writes next history with `textureStore`.
3. Blur: vertical and horizontal passes use reduced `setResolutionScale`.
4. Static fields: `MirroredRepeatWrapping`, `NoColorSpace`, and no implicit mips.
5. Refraction: `mainScreenPeriod`, `detailScreenPeriod`, `heightWeight`,
   `Fresnel`, and `sourceInset` are explicit.
6. Output: final presentation goes through one `RenderPipeline.render()` owner.
7. Debug: previous history, deposit, next history, vertical blur, detail
   refraction, `pause`, and `singleStep` are named views/states.

Run:

```bash
node threejs-dynamic-surface-effects/examples/webgpu-touch-history-frost/validate-temporal-surface.js
```
