# WebGPU/TSL water surface system

Use this reference for bounded or analytic water with compute heightfields,
shared TSL displacement and normals, derivative-filtered detail,
differential-area caustics, depth-aware refraction, Beer-Lambert absorption,
side-aware Fresnel, analytic sky reflection, and crest foam. Use
`$threejs-spectral-ocean` for stochastic FFT seas.

## Contents

- top-tier architecture
- renderer, nodes, and capability gate
- bounded heightfield compute chain
- analytic multi-wave TSL contract
- host integration contracts
- depth-aware refraction and absorption
- reflection, Fresnel, glints, foam, and energy
- presets, quality, buoyancy, spray, masking, and deterministic ticks
- normal filtering and normal-only limits
- quality tiers and budgets
- color and output rules
- diagnostics
- replaced techniques

## Top-Tier Architecture

Lead with the fastest architecture for this domain:

```text
input events/object bounds
  -> compute drop and object impulse into heightfield state
  -> fixed-step propagation ping-pong
  -> compute normals/slopes from the updated state
  -> compute differential-area caustics with epsilon/clamp
  -> node material water pass samples state, scene color, depth, sky, and caustics
  -> node render pipeline owns tone mapping and output conversion
```

This wins because the expensive state is bounded, coherent, and kept on the
GPU. The simulation grid is independent of canvas resolution; the optical pass
samples compact textures instead of re-solving water state per pixel.

For authored open-water surfaces that do not need local interaction, use the
same TSL wave functions without the heightfield. For large statistical oceans,
route to `$threejs-spectral-ocean`.

## Host Integration Contracts

The skill integrates water into an existing Three.js project. It does not own
the whole app.

Host-owned systems:

```text
renderer and canvas sizing
main scene and opaque refraction scene
camera and controls
asset loading
transparent object policy
physics and buoyancy bodies
network tick/authority
screen-space mask registry
post-processing and final output transform
```

Water-owned systems:

```text
GPU height/velocity/slope/caustic state
fixed-step compute updates
surface material and debug modes
scene color/depth input nodes from the host opaque pass
surface query contract for CPU consumers
drop/object/wake impulse ingress
resource and timing diagnostics
```

Minimal frame order:

```js
fixedClock.step(deltaSeconds, (fixedDt, tick) => {
  timeNode.value = tick * fixedDt;
  buoyancy.update(waterQuery, fixedDt, tick);
  spray.update(waterQuery, fixedDt, tick);
  water.update(fixedDt);
});

water.pipeline.render(); // renders opaque scene without water
renderer.render(scene, camera); // renders water and host transparent objects
```

The opaque pass must exclude the water mesh. Transparent objects normally stay
out of the opaque pass and render after water unless the project explicitly
implements order-independent transparency.

## Renderer, Nodes, And Capability Gate

Use `WebGPURenderer`, TSL, node materials, storage textures, and the node render
pipeline only:

```js
import {
  HalfFloatType,
  MeshPhysicalNodeMaterial,
  NoColorSpace,
  SRGBColorSpace,
  StorageTexture,
  WebGPURenderer,
} from "three/webgpu";
import {
  Fn,
  float,
  globalId,
  mrt,
  pass,
  renderOutput,
  texture,
  textureStore,
  uv,
  vec2,
  vec4,
} from "three/tsl";

const renderer = new WebGPURenderer({ antialias: false });
await renderer.init();

if (renderer.backend.isWebGPUBackend) {
  await renderer.computeAsync([dropNode, propagateNode, normalCausticNode]);
} else {
  // Reduced tier only: smaller grids, fewer bands, or generated variants.
}
```

Use `RenderPipeline` for the final graph. Use `pass(scene, camera)` for scene
color/depth ownership, `mrt()` when multiple outputs are needed by water and
other effects, `PassNode.setResolutionScale()` for half/quarter-resolution
refraction or caustic filtering, and one final `outputColorTransform` or
`renderOutput()` owner.

Prefer built-in nodes around the water system: `GTAONode` for ambient
occlusion, `BloomNode` for HDR glints, `TRAANode` when temporal resolve is
already part of the scene, and `CSMShadowNode` or `TileShadowNode` for large
lit water environments. Do not replace these with custom code unless the
custom path demonstrably extends the built-in for the target scene.

## Bounded Heightfield Compute Chain

Use ping-ponged `StorageTexture` state:

```text
stateA.r = height
stateA.g = previous height or velocity
stateA.b = foam/impulse accumulator
stateA.a = validity or boundary mask

normalCaustic.rg = packed slope or normal xy
normalCaustic.b = caustic intensity
normalCaustic.a = diagnostic validity
```

Recommended dispatch chain:

1. `dropNode`: scatter local drops and object impulses into the write state.
2. `propagateNode`: fixed-step wave update from read state into write state.
3. `normalCausticNode`: reconstruct normals/slopes and differential-area
   caustics from the latest state.
4. Swap state textures; never read simulation data back to the CPU during the
   frame.

Use a fixed accumulator such as `1 / 60` or `1 / 120` seconds. Clamp the number
of catch-up steps per frame so a slow tab does not run unbounded dispatches.
Expose wave speed, damping, grid world size, boundary mode, drop radius, and
object-coupling strength as explicit parameters.

Interface spaces:

| Quantity | Space / Units | Producer | Consumer | Trap |
| --- | --- | --- | --- | --- |
| `coord` | integer sim texel, origin at storage texture corner | compute `globalId` | state load/store | off-by-one neighbor clamps create edge pulses |
| `coordUv` | texel-center UV | `uvFromCoord()` | sim-to-world conversion | sampling at texel edges shifts drops |
| `world` | local water XZ meters, Y-up surface frame | `worldFromUv()` | drops, object impulses, bounds | mixing world XZ with screen UV detaches ripples |
| `height/velocity` | meters and meters/second in RGBA16F data | ping-pong state | displacement, normals, caustics | frame-rate constants violate CFL stability |
| `normalCaustic.rg` | slope in local XZ | normal/caustic compute | material normal | unrelated normal maps imply waves absent in geometry |
| `refractedUv` | screen UV | material refraction | scene color/depth | no depth test samples foreground objects |
| depth samples | raw depth -> `linearDepth(value)` / view-Z meters | image pipeline scene pass | refraction validity/path length | raw nonlinear depth deltas are not meters |
| color samples | scene-linear HDR | image pipeline color node | water material | material must not own display encoding |
| data textures | `NoColorSpace` | storage/caustic/noise maps | compute and material | sRGB-as-data washes slopes and masks |

Compute caustics from differential area:

```text
oldArea = cellWorldArea
newArea = length(dFdx(refractedXz)) * length(dFdy(refractedXz)) with orientation guard
caustic = clamp(oldArea / max(newArea, epsilon), 0, maxIntensity)
```

The implementation detail may use finite differences in compute rather than
fragment derivatives, but the contract is the same: clamp area with epsilon,
clamp intensity, mark invalid cells, and expose invalid counts.

## Analytic Multi-Wave TSL Contract

Authored water uses a small number of Gerstner-style components. Preserve this
math because it is still the best path for art-directed bounded water that must
share displacement, normals, crests, and CPU-side camera clearance:

```text
k = 2pi / wavelength
omega = sqrt(9.81 * k)
phase = k * dot(direction, xz) - omega * time
horizontal offset = direction * steepness * amplitude * cos(phase)
vertical offset = amplitude * sin(phase)
```

A high-quality default is five displaced bands:

| Direction X/Z | Amplitude | Wavelength | Steepness |
| --- | ---: | ---: | ---: |
| `0.94, 0.32` | 0.38 | 28.0 | 0.50 |
| `-0.42, 0.91` | 0.24 | 18.0 | 0.46 |
| `0.78, -0.52` | 0.16 | 12.0 | 0.42 |
| `-0.35, -0.78` | 0.10 | 10.0 | 0.35 |
| `0.55, 0.62` | 0.06 | 9.5 | 0.28 |

The TSL normal function evaluates the same directions, amplitudes,
wavelengths, and phases as displacement:

```text
Nx += direction.x * k * amplitude * sin(phase)
Ny += steepness * k * amplitude * cos(phase)
Nz += direction.y * k * amplitude * sin(phase)
normal = normalize((-Nx, 1 - Ny, -Nz))
```

This exact parameter sharing is non-negotiable. If a wave changes, vertex
displacement, lighting normal, crest metric, foam, glints, and CPU clearance
approximations change together.

CPU coupling contract for bounded water:

```js
const query = createBoundedWaterHeightQuery();
const y = query.getWaterHeight(x, z, timeSeconds);
```

`getWaterHeight(x, z, t)` evaluates only the authored analytic component from
the same `AUTHORED_WAVES` list used by the TSL displacement path, so its
analytic parity error is exactly zero up to floating-point roundoff. The live
compute heightfield remains GPU-resident. Its residual is the declared parity
gap for consumers and is bounded by the simulation impulse amplitude budget:
`abs(dropStrength) + abs(objectDisplacementScale)`, with those defaults in
`examples/webgpu-bounded-water/constants.js`. The mesh bounds path cites the
same budget in `estimateWaterVerticalAmplitude()` inside
`examples/webgpu-bounded-water/webgpu-bounded-water.js`, where analytic
amplitude is summed separately from drop/object displacement. Do not use GPU
readback to close this gap in the frame path.

Use additional micro bands only as derivative-filtered normal detail. A useful
normal-only bundle for close bounded water is:

```text
wavelengths = 12, 6, 2.5, 5.25, 3.0, 1.5
relative amplitudes = 1, 0.55, 0.22, 0.12, 0.08, 0.05
directions = wind, cross-wind, 45 deg, +30 deg, -30 deg, +60 deg
dispersion = sqrt(9.8 * k)
```

Use it only when silhouettes and geometric parallax are intentionally flat.
Do not claim geometry/normal parity when the mesh is not displaced.

## Presets, Quality, And Host-Owned Scene State

Presets are data, not scene ownership. A preset can set simulation, optics,
foam, spray defaults, and quality preference. It can include a sky/fog/lighting
hint, but the host applies those through its own scene systems.

Recommended shape:

```ts
type WaterPreset = {
  simulation: {
    worldSize: [number, number];
    waveSpeed: number;
    damping: number;
    dropStrength: number;
    objectDisplacementScale: number;
  };
  optics: {
    absorptionPerMeter: [number, number, number];
    refractionStrength: number;
    roughness: number;
    deepBodyColor: [number, number, number];
    shallowScatterColor: [number, number, number];
  };
  foam: {
    crestThreshold: number;
    impulseGain: number;
    decay: number;
  };
  sprayDefaults?: SprayDefaults;
  qualityPreference?: "low" | "medium" | "high" | "ultra";
  hostSkyHint?: unknown;
};
```

Quality changes rebuild GPU resources. Preserve host state across rebuilds:
authoritative tick, active preset, buoyancy registrations, spray emitters,
masks, transparent ordering, and post output ownership.

Four-tier WebGPU budgets:

| Tier | Sim grid | Mesh segments | Fixed step | Max substeps | Bands | Refraction | Caustics |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| Low | 128 | 96-128 | 1/60 | 2 | 2-3 displaced | clamped depth-aware or body color | low-res compute |
| Medium | 192-256 | 128-192 | 1/90 | 2-3 | 3-4 displaced + 1 micro | half-res depth-aware | compute |
| High | 256-512 | 192-256 | 1/120 | 3 | 4 displaced + 3 micro | depth-aware or half-res | compute |
| Ultra | 512-1024 | 256+ | 1/120-1/240 | 4 | 5 displaced + 4 micro | full-res depth-aware | compute |

Every tier must satisfy:

```text
waveSpeed * fixedDt / minCellSize <= 1 / sqrt(2)
```

If the project requires JONSWAP spectra, directional spreading, spectral
sharpness, standing-wave ratios, or persistent ocean foam, use
`$threejs-spectral-ocean` as the surface provider and keep the host integration
contract here.

## Buoyancy, Spray, And Deterministic Networking

Buoyancy belongs to host physics, but the water module must expose a stable
query:

```js
const query = createBoundedWaterHeightQuery();
const height = query.getWaterHeight(x, z, tick * stepSize);
```

Rules:

- no per-frame GPU readback;
- active sample budget defaults to 128;
- multi-point hulls use stable object-local sample points;
- single-point floats scale by object count;
- query output documents residual from live GPU impulses;
- object motion feeds the GPU through `setObjectImpulse()`.

Spray is an emitter/probe system coupled to the same query:

```text
previousSignedDistance > 0
currentSignedDistance <= 0
abs(deltaSignedDistance / dt) >= velocityThreshold
```

Probes live in object-local space. Per-probe visual settings are frozen at
spawn. Override order is system defaults, emitter values, then probe values.
Disabled probes keep their index.

Networked scenes use integer ticks:

```js
waterClock.syncToTick(authoritativeTick);
water.update(fixedStepSeconds);
```

Shader time is `tick * fixedStepSeconds`, not wall-clock time. Cap catch-up
steps per visual frame. Seed drops, spray jitter, and wakes from deterministic
integer hashes. Document tick wrap.

## Depth-Aware Refraction And Absorption

Scene color is owned by the node pipeline, not by a private capture path. Render
opaque scene data before water, expose color and depth from the pass, then run
water as a transparent or ordered surface policy chosen by the app.

Refraction contract:

1. Compute side-aware eta: air-to-water above the surface, water-to-air below.
2. Offset screen UV from refracted direction, slope, thickness, and roughness.
3. Sample scene depth at the candidate UV and reject samples in front of the
   water surface or outside the viewport.
4. Use reconstructed depth difference for path length when valid.
5. Fall back to configured bounded thickness when depth is invalid.
6. Apply Beer-Lambert transmittance in linear color:

```text
transmittance = exp(-absorptionPerMeter * pathLength)
```

Useful defaults:

```text
air/water eta = 1 / 1.333
extra Fresnel bias = 0.0-0.035 only when art direction needs it
absorption = (0.20, 0.06, 0.02) per meter
fallback depth = 4 m
refraction strength = 0.05-0.18 by scale and roughness
roughness control = 0.15-0.45
```

When depth is absent in the reduced tier, label the path length as a fallback
estimate. Never present fallback thickness as reconstructed scene thickness.

## Reflection, Fresnel, Glints, Foam, And Energy

Use side-aware Fresnel:

```text
F0 = ((etaA - etaB) / (etaA + etaB))^2
F = F0 + (1 - F0) * (1 - abs(dot(N, V)))^5
```

Reflection may sample the scene environment or the same analytic sky used by
the sky system. Analytic sun response remains valid for authored cinematic
water when it is tied to HDR and the final output transform:

```text
reflection disc = max(dot(reflection, sun), 0)^2500 * 22
reflection halo = max(dot(reflection, sun), 0)^14 * 1.5
surface glint = max(dot(normal, halfVector), 0)^1200 * 22
```

Track an energy budget:

```text
reflected = reflection * F
transmitted = refractedBody * (1 - F) * transmittance
glint = glintColor * glintMask * availableSpecularBudget
foam = foamColor * foamMask, usually replacing transmission first
```

Foam must be causally attached to the shared crest or impulse metric:

```text
foamSeed = noise(xz * 0.9 + wind * time * foamDrift)
foam = smoothstep(threshold, 1, crest * noisy modulation)
```

Persistent open-ocean foam belongs in `$threejs-spectral-ocean`; rain-driven
surface foam and splashes belong in `$threejs-rain-snow-and-wet-surfaces`.

## Transparent Objects, Masking, And Post

Transparent host objects are excluded from the opaque refraction prepass and
rendered after water by default:

```text
opaque scene/depth prepass -> water -> host transparent objects -> post stack
```

Alpha-tested cutouts may stay in the opaque pass. Physically transmitted glass
or liquid materials need a separate pipeline design because they compete for
depth/transmission ownership.

Screen-space masking requires a mask texture and material hook:

```js
const mask = water.masking.add(maskMesh, {
  space: "screen",
  channel: "hullInterior",
  dilationPixels: 1,
});
```

Mask contract:

- mask meshes are invisible in the main scene;
- host renders masks to a `NoColorSpace` screen-space texture before water;
- water material discards or fades fragments where the mask is set;
- mask pass is skipped when no masks are registered;
- validation includes a hull/interior camera where masked water is absent.

A host-side registry without a mask texture and water material hook is not
complete masking.

Host post-processing order:

1. opaque color/depth prepass;
2. water refraction, absorption, reflection, caustics, and foam;
3. depth-dependent underwater haze or fog;
4. anti-aliasing;
5. bloom/glints;
6. grading and final output transform.

Water materials output linear HDR. The host post stack owns final tone mapping
and color conversion.

## Normal Filtering And Normal-Only Limits

High-frequency normal bands must be filtered by screen footprint or an
equivalent derivative estimate:

```text
aa3 = 1 - smoothstep(0, 2.0, footprint * k3)
aa4 = 1 - smoothstep(0, 1.5, footprint * k4)
aa5 = 1 - smoothstep(0, 1.0, footprint * k5)
```

Normal-only water is a reduced geometry class. It is acceptable for flat pools,
distant strips, and performance tiers where silhouette motion is not visible.
It is not acceptable for close crest silhouettes, object intersection
parallax, or wave-camera clearance.

## Quality Tiers And Budgets

| Tier | Simulation | Dispatches | Storage | Optical passes | Target |
| --- | --- | ---: | --- | --- | ---: |
| Ultra | 512-1024 square fixed-step | 2-4/frame | 3-5 RGBA half-float storage textures | full-res water, optional half-res caustic filter | 0.6-1.5 ms desktop discrete |
| High | 256-512 square fixed-step | 2-3/frame | 3-4 RGBA half-float storage textures | half-res refraction where acceptable | 1.0-2.5 ms desktop integrated |
| Reduced | 128-256 square or static variants | 0-2/frame | 2-3 compact textures | clamped or static refraction | 1.5-3.5 ms mobile / explicit request to apply fallback when WebGPU is unavailable |

Rules:

- cap catch-up fixed steps to 2-4 per visual frame;
- keep water draw calls at 1-3 for the surface, caustic receiver, and debug;
- keep simulation state under about 10 MiB at 512 square unless the scene
  budget explicitly allows more;
- use half/quarter-resolution passes with `PassNode.setResolutionScale()` for
  blurred caustics or low-frequency refraction;
- use `mrt()` when color, depth, normals, or velocity are shared with other
  node effects instead of rendering the scene multiple times.

## Color And Output Rules

- Color images and environment maps: `SRGBColorSpace`.
- Height, velocity, normal/slope, caustic, mask, noise, and LUT textures:
  `NoColorSpace`/linear data.
- Working color stays HDR, normally `HalfFloatType`, until the final pipeline
  output.
- The app has one tone-map owner and one output conversion owner:
  `outputColorTransform` on the pipeline or a final `renderOutput()` node.
- Water node materials output linear HDR values and never perform their own
  final conversion.
- Pregenerated caustic variants in `assets/generated-variants/` are reduced-tier
  sources or diagnostics; they do not replace compute caustics when simulation
  state is live.

## Diagnostics

Expose debug views for:

```text
height and previous height/velocity
drop and object impulse accumulation
boundary mask and invalid cells
per-wave displaced position and analytic normal
normal-only versus displaced comparison
derivative attenuation per micro band
crest metric before noise
Fresnel and side classification
raw refraction UV, depth comparison, and validity
approximate path length and transmittance
caustic area ratio before clamp and after clamp
reflection, body scatter, glint, caustics, and foam separately
fixed-step count, dispatch count, storage size, and pass timings
CPU versus GPU surface height approximation at camera position
```

Fail the validation harness if caustics produce NaN/Inf, refraction validity is
unexpectedly low for a stable camera, output conversion happens twice, or fixed
steps exceed the tier budget.

Integration validation must also fail on:

```text
browser GPUValidationError
blank page screenshot accepted as WebGPU evidence
render-target readback with invalid row stride
water mesh present in its own opaque refraction prepass
transparent object present in the opaque depth inputs by default
buoyancy sample count above the project budget
spray probes that never fire under a forced crossing
syncToTick() that does not land on the next fixed step
screen-space masking claimed without mask texture and material hook
```

For WGSL validity, compute Fresnel `F0` with multiplication:

```js
const r = etaA.sub(etaB).div(etaA.add(etaB));
const f0 = r.mul(r);
```

Do not emit `pow(negativeAbstractFloat, 2.0)`.

## Replaced Techniques

- Fragment-pass heightfield ping-pong was replaced by compute ping-pong
  `StorageTexture` state because it avoids render-pass overhead, keeps data in
  the compute pipeline, and scales cleanly with fixed-step simulation.
- Unchecked area division for caustics was replaced by epsilon-clamped,
  intensity-clamped differential area with invalid-value diagnostics.
- Screen-offset refraction without depth tests was replaced by depth-aware
  refraction with foreground rejection and an explicit branch for teaching how
  to apply fallback when WebGPU is unavailable.
- Normal-only water as the main recipe was replaced by shared TSL displacement
  and normals; normal-only water remains a deliberate reduced geometry tier.
- Private scene-color ownership was replaced by node pipeline ownership through
  `pass()`, optional `mrt()`, and a single output transform owner.
