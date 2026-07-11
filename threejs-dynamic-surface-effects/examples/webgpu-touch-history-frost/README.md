# WebGPU Touch-History Frost

Native-WebGPU canonical lab for `threejs-dynamic-surface-effects`.

The browser subject allocates two distinct RGBA16F `StorageTexture` resources
and two persistent, distinct texture-node bindings. After each compute dispatch,
the current node binds the completed write slot and the previous node binds the
prior read slot; diagnostics therefore cannot alias the same mutable node.
History uses explicit `[8,8,1]` workgroups with odd-size guards, closed-form
dt-correct decay/deposition, and a stability-gated optional Laplacian.

Mechanism routes rebuild the reachable compute/presentation graph. Tier routes
reallocate history at their declared scale, change blur resources, and remove
the detail-refraction node in the budgeted tier. Resize consumes the renderer's
actual physical drawing-buffer extent after DPR, updates the display-resolution
uniform, then reapplies the tier scale.

The optical route treats `mainScreenPeriod` and `detailScreenPeriod` as pixel
periods (`phase = 2*pi*screenPixel/periodPixels`). It constructs a normalized
interface normal, applies Snell refraction using the declared IOR and thickness,
and weights transmission/reflection with side-aware exact dielectric Fresnel,
including inside-to-outside total internal reflection. It exposes a compute-only
integration-stage factory that owns neither renderer nor output.

The manifest remains `incomplete` until the root capture runner supplies v2
native-WebGPU readback, timing, and lifecycle evidence. The local capture script
returns `INSUFFICIENT_EVIDENCE` and never fabricates output.

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

1. Storage history: two real RGBA16F `StorageTexture` resources with `NoColorSpace`.
2. History compute: a 2D `Fn().compute([gx,gy,1],[8,8,1])` dispatch writes
   next history with `textureStore` and explicit extent checks.
3. Blur: the two-pass `GaussianBlurNode` uses a measured tier-owned resolution scale.
4. Static fields: `MirroredRepeatWrapping`, `NoColorSpace`, and no implicit mips.
5. Refraction: screen-pixel periods, IOR, declared thickness scale, optical side,
   exact dielectric Fresnel/TIR, height weighting, and source inset are explicit.
6. Output: final presentation goes through one `RenderPipeline.render()` owner.
7. Debug: previous/current history read distinct resources; deposit, crystal
   fields, real blur targets, and optical offsets derive from graph nodes rather
   than copied labels. `pause` and `singleStep` remain explicit controls.

Run:

```bash
npm run validate:quick
```
