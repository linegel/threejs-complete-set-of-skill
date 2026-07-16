---
name: threejs-rain-snow-and-wet-surfaces
description: Couple Three.js WebGPU/TSL rain, snow, and wet surfaces. Use for airborne precipitation motion, physical surface deposition, persistent snow or wetness state, weather-driven ripple normals, or impact splashes.
---

# Rain, Snow, and Wet Surfaces

Couple appearance to causes: one time source and wind field drive airborne
precipitation, while one owner per receiver integrates deposited rain or snow.
Visual particle count samples the weather; it never sets the deposited mass.

Use Three.js r185 `WebGPURenderer`, TSL, storage nodes, node materials, and the
node post stack. Initialize the renderer before allocating compute or storage:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error('This weather path requires the WebGPU backend.');
}
```

For cross-system precipitation or receiver state, declare its units, frame,
time interval, authority/version, support, validity, and reset semantics;
invoke `$threejs-choose-skills` when ownership spans skills.

## Build sequence

### 1. Name the owners and units

Declare:

- one monotonically sampled time source and update interval in seconds;
- one air-velocity field in world metres per second, including its frame,
  support, cadence, and validity;
- temperature in kelvin and a named humidity convention when phase, melt, or
  evaporation depends on them;
- precipitation forcing as liquid/ice mass-area flux in
  `kg m^-2 s^-1` over a physical receiver support;
- one receiver-state owner for each liquid or snow inventory;
- one owner for HDR presentation, tone mapping, and output conversion.

Treat cloud appearance and causal precipitation as separate branches. An
appearance-only cloud may coordinate art direction. A causal cloud source
publishes a mass flux or airborne inventory with a fall-delay/transport model;
rain transports it to receivers on a later ordered stage.

This step is complete when every cause and persistent state has exactly one
owner, every exchanged quantity has units and a frame, and every producer is
sampled within its stated validity.

### 2. Select motion before allocating state

Use immutable seeds and analytic vertex motion when position is an exact
function of seed, time, and integrated wind. Use recurrent GPU-resident state
when turbulence, collisions, feedback, or path history affects the next state.
Authored time-varying wind remains analytic only when its displacement integral
is available; multiplying the current wind by total elapsed time makes all
particles jump when wind changes.

For unbounded visual weather, stream camera-centred cells whose identities,
spawn phases, and trajectories are hashed in stable world space. For localized
weather, use a world-anchored bounded volume with an intentional boundary.
Impacts and accumulation always use world-stable receiver cells independent of
the visual pool.

Read [precipitation motion](references/precipitation-motion.md) when choosing
analytic versus recurrent motion, implementing compute updates, generating
physical impacts, or budgeting precipitation work.

This step is complete when each requested force or collision maps to an exact
analytic term or recurrent state field, and a camera-translation test changes
only the visible cell set—not particle phase, impact position, or accumulated
receiver state.

### 3. Separate deposition from visual sampling

Integrate an intensive flux with physical-area quadrature:

```text
sum_i A_i = represented receiver area
deltaMass = deltaTime * sum_i(massFlux_i * A_i)
```

Each `A_i` includes the receiver chart Jacobian and has units of square metres.
When sparse impacts represent the already-integrated transfer, partition that
extensive mass and momentum across impacts so their sum closes the parent
transfer exactly once. Keep rendered streak/flake density, sprite size, and
visual LOD outside this calculation.

This step is complete when changing visual particle count and visual LOD under
the same forcing trace leaves deposited mass and momentum unchanged, and
changing receiver cadence leaves the time integral unchanged within the named
numerical tolerance.

### 4. Order whole-grid updates

Use this causal order:

```text
latch time, wind, and precipitation forcing
  -> advance analytic or recurrent airborne precipitation
  -> resolve and bin impacts
  -> publish deposition/impact transfer
  -> integrate receiver liquid and snow state
  -> commit receiver state
  -> build render projection
```

Split solver, collision/binning, scan/compaction, indirect-argument, and
receiver passes into ordered dispatches when later stages consume earlier
whole-grid results. A workgroup barrier orders one workgroup; an explicit pass
or queue dependency orders the grid. Treat r185 `computeAsync()` as
initialization/enqueue convenience rather than a GPU-completion fence. Keep
steady-frame state on the GPU; use host readback only outside frame-critical
execution.

This step is complete when every read names the dispatch or committed snapshot
that produced it, the receiver integrates after deposition is resolved, and a
fixed forcing replay produces the same committed inventory at every supported
update cadence.

### 5. Project one committed receiver state

Read [receiver weathering](references/receiver-weathering.md) when implementing
snow accumulation, wetness, puddles, ripple normals, splashes, or their material
response.

Build all surface effects from the committed receiver snapshot:

- derive snow displacement and snow normals from the same height field;
- sample object snow in stable model space and gate it with the transformed
  world-space support normal;
- apply the early wetness response before enabling heavy-rain ripple normals;
- use one wetness/puddle mask for roughness, absorption, ripple eligibility,
  splash intensity, and mask diagnostics;
- orient splashes from world-space receiver normals and reject candidates that
  are downward-facing, unsupported, or hidden under the selected visibility
  policy.

This step is complete when the snow-position and snow-normal diagnostics agree,
wetness remains visible with ripples disabled, and transformed or occluded
receiver tests accept only supported world-space splash candidates.

### 6. Present and falsify

Use `MeshStandardNodeMaterial` or `MeshPhysicalNodeMaterial` slots for color,
roughness, normal, opacity, and displacement. Present through one
`RenderPipeline`. Tag encoded base-color textures as `SRGBColorSpace`; treat
normal, roughness, mask, noise, LUT, ripple, and weather fields as data. Keep
HDR buffers linear until the single tone-map/output conversion owner.

Expose diagnostics for forcing revision and age, motion/cells, impacts,
deposited mass, receiver terms, snow height/normals, wetness/ripples, splash
orientation/visibility, data-texture interpretation, and final output. Measure
full-frame and paired weather-on/off CPU/GPU p50/p95, transparent overdraw,
hot bytes per frame, active impact tiles, and peak live storage on the named
target.

This step is complete when the final and diagnostic views pass the observable
checks below, disabling weather restores the baseline image, resize/rebuild
preserves owners and resets transient history, and disposal releases every
weather-owned buffer, texture, material, and pass.

## Observable checks

| Observable | Failure signature and likely cause |
| --- | --- |
| Camera translation preserves precipitation phase and impacts | Cell identity or impact support is camera-relative. |
| Wind changes bend future motion without translating the whole field | Current wind was multiplied by elapsed time instead of integrated. |
| Streak length follows fall speed/exposure, and drift follows the shared wind | Sprite geometry or a surface branch uses a separate clock or wind. |
| Unbounded weather has no emitter seam; localized weather has an intentional edge | The selected visual-domain contract is incomplete. |
| Snow silhouette and lighting move together | Displacement and normals come from different fields. |
| Animated objects keep snow attached to their surfaces | Coverage is sampled in world rather than stable model space. |
| Wet surfaces change before heavy-rain ripples appear | Roughness is gated by the ripple mask instead of receiver wetness. |
| Splashes stay on supported visible faces after transforms | Candidate normals or visibility are evaluated in local/unstable space. |
| Dense recurrent weather has no per-drop object loop or full hot-buffer upload | State or presentation left the GPU-resident branch. |
| Data fields preserve values and final color has one display transform | A data texture is decoded as color, or output conversion runs twice. |

## Routing boundary

Use `$threejs-water-optics` for bounded water bodies, refraction, caustics, and
Beer-Lambert thickness. Use `$threejs-particles-trails-and-effects` for
non-weather particle systems. Use `$threejs-dynamic-surface-effects` for
screen-space touch or clearing histories. Use `$threejs-image-pipeline` for
scene-wide HDR/post ownership and `$threejs-scalable-real-time-shadows` for
large-scene shadow allocation. This skill owns precipitation transport and
weather-specific receiver projections; the route-selected receiver owner owns
the persistent liquid or snow inventory.
