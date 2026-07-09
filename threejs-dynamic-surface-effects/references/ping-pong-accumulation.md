# Touch-History Frost Accumulation

Use this reference for screen-space frost whose visible mask and refractive
response depend on persistent touch history, reduced-resolution scene blur,
static crystalline fields, and two-scale TSL normal refraction.

## State-Update Decision

Use full-field ping-pong only when decay, diffusion, or another evolution term
changes every texel. Sparse deposits over otherwise invariant state use dirty
rectangles or dirty tiles. For tile `t`, let `P_t` be processed pixels and
`E_t` its overlapping event list; evaluation costs `sum_t(P_t * E_t)` and
binning costs `K=sum_events tiles(event)`. Worst-case overlap remains
`O(P*E)`. Record `K` and list occupancy; cap/split lists or rasterize one
aggregate deposit field when occupancy is high. If untouched state decays, a
dirty-tile path stores time and applies analytic catch-up on every visible or
filter sample (or materializes every visible tile), not only on the next touch.
Diffusion requires global/halo-expanded evolution. Skipping these rules changes
the model.

Record per frame: event count, dirty tiles, dispatched texels, history bytes
read/written, and whether global evolution forced a full dispatch.

## Architecture

When close-inspection error gates require it, the top tier uses
full-resolution history in two ping-ponged `StorageTexture` instances, updated
by a TSL compute node before the surface composite. Otherwise select the
lowest history extent that passes the same state and reconstruction contract.
The scene color and blur chain stay in the node pipeline.

```text
input events
  -> history compute writes next StorageTexture
  -> swap previous/next history
  -> scene pass: pass(scene, camera)
  -> vertical blur pass at an error-gated reduced scale
  -> horizontal blur pass at the same measured scale
  -> frost/thaw composite from scene, blur, history, static structure
  -> two-scale normal refraction
  -> RenderPipeline output
```

This order is authoritative for same-frame interaction response. A one-frame
delayed response is allowed only when it is an intentional product decision:
sample previous history in the composite, then run the history compute, and keep
all diagnostics named so the delay is obvious.

## Capability Gate And Tiers

Full quality requires a WebGPU backend because storage texture writes are used.

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error(
    'WebGPU is required for the canonical dynamic-surface path; explicit fallback teaching belongs to threejs-compatibility-fallbacks.'
  );
}
```

Tier candidates:

| Tier | History | Blur scale | Static fields | Refraction |
| --- | --- | --- | --- | --- |
| Full | full-res RGBA16F storage ping-pong only when required | highest scale that passes blur/edge gates | all consumed data textures | two-scale normals plus Fresnel/source inset |
| Balanced | reduced history or measured RG8/RG16F | measured reduced scale | only consumed structure fields | main normals plus reduced detail |
| Budgeted | minimum error-valid history or sparse tiles | minimum scale that passes gates | one precomputed field when sufficient | tint plus single offset |

All rows are native WebGPU tiers. Teaching how to apply fallback when WebGPU is
unavailable is quarantined in `$threejs-compatibility-fallbacks`.

## Resource Ownership

Per display size, own these resources:

| Resource | Resolution | Format/domain | Lifetime | Purpose |
| --- | --- | --- | --- | --- |
| scene color node | display DPR | linear HDR | every frame | sharp source scene |
| history A/B | tier history resolution | RGBA16F data, `NoColorSpace`, or a measured adapter-supported compact storage format | persistent | interaction/thaw mask and tilt response |
| vertical blur | scaled DPR | linear HDR | every frame | first blur axis |
| horizontal blur | scaled DPR | linear HDR | every frame | broad blurred source |
| frost composite | display DPR | linear HDR | every frame | scene, blur, structure, interaction |
| frost noise | scaled DPR or authored asset | data, `NoColorSpace` | startup/resize | coarse crystalline field |
| frozen noise | display DPR or authored asset | data, `NoColorSpace` | startup/resize | dense frozen field |
| highlight noise | display DPR or authored asset | data, `NoColorSpace` | startup/resize | highlight breakup |

History textures resize together. Choose and document one resize policy:

- Clear both histories and regenerate static fields. This is the default safe
  policy.
- Preserve by remapping history into the new dimensions.
- Preserve by reprojection when camera motion and scene depth are available.

Static fields that depend on resolution must regenerate on resize or quality
tier change. Asset fields should define wrap mode, filtering, mip use, and
color-space metadata at load time.

## Persistent History Compute

History channels:

```text
R = accumulated visible interaction mask
A = accumulated tilt/refraction response mask
G/B = duplicate R or debug values only
```

The update is compute-side and read-back-free:

```text
previous = historyRead(pixel)
dt = authoritative interval under the declared suspend policy

segment = timestamped pointer p0,t0 -> p1,t1 with pressure endpoints
distance = aspect-corrected distance to the swept segment/capsule
edgeMask = side/corner fade to avoid clipped circular deposits
brush = radial coverage * time-average pressure over this subinterval
        * edgeMask * procedural breakup

lambda = -log(decaySurvivalPerSecond)
r = -log(1 - depositPerSecond)
a = lambda + r*brush
xEq = (a > 0) ? r*brush/a : previous
xNext = (a > 0) ? xEq + (previous-xEq)*exp(-a*dt) : previous

Rnext = solve channel with visible brush
Anext = solve channel with smoother tilt brush
store(nextHistory, pixel, vec4(Rnext, Rnext, Rnext, Anext))
```

This solves `dx/dt = -lambda*x + r*b*(1-x)` for dimensionless,
piecewise-constant brush coverage `b`. If input supplies integrated pressure
`I = integral p(t)dt`, first form the interval average `pBar=I/dt`; do not feed
`I` into the update and multiply by `dt` again. Subdivide timestamped swept
segments when coverage/pressure varies enough to exceed the spatial or
temporal error gate. A per-frame endpoint stamp or additive
`x += b*(1-exp(-r*dt))` does not compose under timestep partition.

Authored trial constants for the frost fixture (not portable gates):

| Parameter | Start value | Notes |
| --- | --- | --- |
| `decaySurvivalPerSecond` | `0.88-0.96` | lower clears faster |
| `depositPerSecond` | `0.85-0.98` | keeps held input independent of frame count |
| suspend policy | explicit freeze, analytic catch-up, or bounded substeps | never implied by a delta clamp |
| visible noise strength | `0.12-0.18` | irregular thaw/frost edge |
| tilt noise strength | `0.04-0.08` | smoother device tilt response |
| radius | `0.15-0.17` screen units | aspect-corrected |
| corner fade | `0.50-0.60` | avoids edge clipping |
| side fade | `0.00-0.50` | preserve broad gestures near bounds |

The tilt channel deliberately uses a smoother brush than the visible channel so
device tilt can react smoothly while the frost boundary remains irregular.

Optional diffusion:

```text
r_x = D * dt / dx^2
r_y = D * dt / dy^2
next = center + r_x * (left - 2*center + right)
              + r_y * (down - 2*center + up)
```

For explicit Euler require `r_x + r_y <= 1/2`; on an isotropic texel grid this
is `D * dt / dx^2 <= 1/4`. Substep or use an implicit/closed-form filter when
the declared physical/artistic diffusion violates that bound. State the units
of `D` and whether `dx,dy` are world, UV, or texel distances. Use diffusion only
when the mechanism needs it; gate edge displacement and frame-rate convergence
rather than trusting visual smoothness.

Clamping `dt` discards elapsed evolution. Declare whether suspension freezes
the effect clock, analytically catches up exponential decay on resume, or
substeps bounded deposition/diffusion; do not silently mix these semantics.

## Blur Chain

Use a separable blur at reduced resolution. The pass scale is the quality knob,
not the kernel rewritten per device.

```text
scene color
  -> vertical blur at selected reduced scale
  -> horizontal blur at the same scale
```

The fixture declares any initial linear-scale trial as **Authored**. Acceptance
follows a projected edge/blur-radius error test and target bandwidth
measurement; no adapter class supplies a default scale.

Alpha-aware blur must normalize RGB and alpha separately:

```text
rgbWeighted += sample.rgb * sample.a * weight
rgbWeight += sample.a * weight
alphaWeighted += sample.a * weight
alphaWeight += weight

rgb = rgbWeight > epsilon ? rgbWeighted / rgbWeight : vec3(0)
alpha = alphaWeighted / max(alphaWeight, epsilon)
```

Use built-in TSL blur nodes when their normalization and resolution ownership
match the contract. Otherwise build the two passes as TSL nodes and keep the
same target scale and diagnostics.

## Frost Composite

The frost composite samples the current completed history:

```text
clearAmount = 1 - history.R
tiltAmount = history.A
```

Preserve these structure relationships unless measurement shows a better
quality-per-ms result:

```text
base structure = mix(frozenNoise, highlightNoise, 0.30)
coarse frost = contrast(frostNoise * 1.70 + frostAmount, 1.60)
mask = contrast(base structure + coarse frost * clearAmount, 1.80)
```

Scene treatment:

```text
blurMix = clamp(clearAmount * (mask + 0.30), 0, 1)
scene = mix(sharpScene, blurredScene, blurMix)
scene *= vec3(0.90, 0.90, 1.03)
saturation *= 1.20
brightness *= 0.70
```

Tint:

```text
thin tint = vec3(0.82, 0.86, 1.05)
thick tint = vec3(0.92, 0.96, 1.10)
frost tint strength = 0.70
highlight tint strength = 0.80
```

Composite alpha stores the structural frost mask before pointer clearing. The
final refraction node gates offsets by both structural alpha and inverse
history.

## Two-Scale Normal Refraction

Sample normal data in screen coordinates with explicit repeat or
mirrored-repeat wrapping. The period uniforms are screen periods, not texture
sizes.

```text
main screen period = 1200
main strength = 0.30
detail screen period = 350
detail strength = 2.0
IOR = 1.31
thickness = 1.0
source inset = 0.17
Fresnel strength = 0.80
```

The main normal map also produces a grayscale height weight for detail normals.
Device tilt rotates the view vector, with history `A` contributing up to `0.8`.
Apply refraction only where structural frost alpha and inverse history both
permit it.

State the source-inset behavior explicitly: offset samples may clamp inward by
`source inset` to avoid pulling undefined edge texels. Fresnel is a linear-light
mix factor before output conversion.

## Wrongness Signatures

| Symptom | Likely mistake | Debug surface |
| --- | --- | --- |
| Per-frame decay differs at 30/60/120 FPS | decay or deposit is frame-count based | next history R/A |
| Same-UV smearing trails under motion | history accepted without the screen-space contract or diffusion is too high | previous history R/A |
| Clamped normal-map edges | normal maps use clamp instead of mirrored repeat | main/detail refraction offset |
| sRGB-as-data masks | data textures decoded as color | static structure fields |
| Unintended resize clears | resize policy is implicit or only one history target cleared | previous/next history R/A |
| Double output conversion | effect performs its own display transform before pipeline output | final without refraction / final |

## Interface-Space Anchors

| Space | Conversion |
| --- | --- |
| Pointer NDC | Convert `[-1, 1]` to history UV with explicit Y convention. |
| History UV | Sample and write by texel center in storage dimensions. |
| Drawing-buffer pixels | Use physical render size after DPR for dispatch and storage. |
| CSS size / DPR | Only informs resize; it is not a shader-space scale. |
| Screen period uniforms | `mainScreenPeriod` and `detailScreenPeriod` name periods, not texture size. |
| UV origin | Document whether the host flips Y for textures or pointer input. |
| Allowed transforms | Screen-space history may follow viewport transforms only; route world/object paint elsewhere. |

## Color And Texture Rules

- Scene and composite nodes operate in linear/HDR until the final pipeline
  output.
- Working color buffers use `HalfFloatType` where precision matters.
- LDR color images encoded as sRGB use `SRGBColorSpace`; HDR/EXR radiance
  remains loader-declared linear.
- Normal maps, masks, procedural noise, LUTs, and generated structure fields use
  `NoColorSpace`.
- The application has one output transform owner: `RenderPipeline` default
  output transform or an explicit `renderOutput()` final node.
- Do not bake output conversion into frost, blur, history, or refraction nodes.

## Performance Contract

Budget the architecture before tuning constants:

| Work item | Accounted cost |
| --- | --- |
| Compute | zero when state is idle; otherwise one full-field dispatch or bounded dirty-tile dispatches with timestamp catch-up |
| Dispatch size | linear `.compute(activeWidth*activeHeight,[w])`, or 2D `.compute([ceil(activeWidth/wx),ceil(activeHeight/wy),1],[wx,wy,1])`; record active texels and measured workgroup size |
| Texture memory | `2 * width * height * bytesPerTexel`; full-res RGBA16F is about 31.6 MiB at 1920x1080 before alignment |
| Passes | scene, vertical blur, horizontal blur, composite/refraction |
| Extra scene redraws | 0 |
| Traffic lower bound | sum state/blur/composite reads and writes, history slots, and resolves/copies |

The whole-scene router allocates the subsystem ceiling. If the budget fails,
first stop idle work or use valid dirty-tile updates, then reduce blur scale,
history resolution, or precision after measuring visual equivalence. Do not
replace persistent state with a per-frame mask. Low-power trials may start at
half or quarter history, but the accepted scale follows projected feature
error, peak live memory, tile behavior, and sustained full-frame/paired-marginal
p50/p95 on the named target.

## Replaced Techniques

- Time-only procedural surface masks are replaced by storage-backed history
  because visible thaw/frost state must persist independently of changing noise.
- Per-frame decay constants are replaced by `pow(k, dtSeconds)` survival and
  dt-scaled deposit so accumulation matches across 30, 60, and 120 FPS.
- Full-resolution broad blur is replaced by reduced-resolution separable blur
  because bandwidth dominates this effect and broad frost tolerates scaled
  sampling.
- Single-scale screen offset refraction is replaced by two-scale normal
  refraction with height weighting, Fresnel/source inset, and mask gating
  because it gives more crystalline detail per sample.
- A helper that only restores the default output target is replaced by node
  pipeline ownership; if any manual pass is unavoidable, save and restore the
  previous target, viewport, scissor, clear color/alpha, and clear flags.

## Diagnostic Contract

Expose debug views for:

```text
scene color
vertical blur
horizontal blur
each static structure field
previous history R/A
current deposit R/A
next history R/A
frost mask before pointer application
frost mask after pointer application
sharp/blur mix
main refraction offset
detail refraction offset
final without refraction
final
```

Add pause and single-step controls. Run these validations:

- Fixed pointer path at 30, 60, and 120 FPS produces equivalent final history.
- Held pointer deposit converges to the same value across frame rates.
- Invalid or negative deltas are rejected. Suspended-tab intervals follow the
  declared freeze, analytic catch-up, or bounded-substep policy; a clamp must
  not silently discard elapsed evolution.
- Resize follows the documented clear/preserve policy.
- Static fields regenerate or remap after resize as documented.
- Boundary sampling confirms repeat or mirrored-repeat normal wrapping.
- Output screenshots are checked for double conversion and missing output
  conversion.

## Routing Boundary

This reference is for viewport-locked state. Do not use it for world footprints,
object-UV paint, simulation-plane wetness, puddles, rain, or snow accumulation.
Route those to `$threejs-particles-trails-and-effects`, `$threejs-rain-snow-and-wet-surfaces`, or
`$threejs-water-optics` as appropriate.
