# Curved-Ray Numerical Integrators

Use this reference for WebGPU/TSL ray integration of black-hole, wormhole,
accretion-disk, and bounded space-volume effects. The fastest acceptable
architecture is bounded adaptive marching with a single ray advance per
iteration, transmittance early termination, reduced-resolution temporal
reconstruction, and optional compute/storage caches.

## Contents

- Production architecture
- TSL material and compute ownership
- Capability gate
- Wormhole state reduction
- Wormhole RK4 integration
- Accretion-disk curved-ray integration
- Continuous disk and shell crossings
- Background lensing and star fields
- Quality tiers and budgets
- Color and texture rules
- Diagnostics and validation
- Replaced techniques

## Production Architecture

Build the effect as a bounded local-space numerical renderer:

1. Transform the camera origin and ray direction into effect space.
2. Intersect the ray with the bounded proxy volume and reject misses before the
   march.
3. Initialize position, direction, throughput, transmittance, accumulated
   radiance, accepted-step count, and termination ID.
4. For each accepted step, estimate a step length from distance to important
   structures, local density, curvature, and numerical error.
5. Evaluate continuous crossings over the segment from previous position to
   candidate position.
6. Commit exactly one position advance per accepted step.
7. Accumulate emission and absorption front-to-back.
8. Break on core hit, escape, opacity saturation, invalid state, or step cap.
9. Sample the background environment only after integration terminates.
10. Reconstruct the reduced-resolution result with velocity/depth rejection.

The important performance win is not syntax; it is avoiding wasted iterations.
Bounded adaptive marching, early termination, temporal reuse, and reduced
resolution can be tens of times faster than an unconditional fixed-step loop at
the same perceived quality.

## TSL Material And Compute Ownership

Use `WebGPURenderer` from `three/webgpu`, TSL from `three/tsl`, and a
`MeshBasicNodeMaterial` or another `NodeMaterial` variant for the proxy volume.
The main raymarch is a TSL `Fn` that returns linear radiance, opacity or
transmittance, termination ID, and optional diagnostics.

```js
const marchSpaceEffect = Fn(({ rayOrigin, rayDirection, quality }) => {
  const state = initRayState(rayOrigin, rayDirection, quality);

  Loop({ start: int(0), end: quality.maxSteps }, () => {
    If(state.done, () => Break());

    const previousPosition = state.position;
    const stepLength = chooseAdaptiveStep(state);
    const candidatePosition = previousPosition.add(state.direction.mul(stepLength));

    accumulateSegment(state, previousPosition, candidatePosition, stepLength);
    bendRayDirection(state, candidatePosition, stepLength);

    state.position.assign(candidatePosition); // The only position advance.
    updateTermination(state);
  });

  return finalizeIntegratedRadiance(state);
});
```

Use `renderer.compute()` or `renderer.computeAsync()` with
`Fn().compute(count)` when a field is reused across pixels or frames:

- cached lens maps for background and distant tiers;
- per-tile occupied bounds or empty-space skipping tables;
- temporal history and variance data in `StorageTexture`;
- diagnostic textures for step count, termination ID, and invalid state;
- compacted probe lists or impostor updates in storage buffers.

Use `textureStore()` for compute-written textures and `storage()` nodes for
storage buffer access. Keep GPU diagnostics on the GPU except for deliberate
validation readbacks.

Compose through `RenderPipeline`, `pass()`, `mrt()`,
`PassNode.setResolutionScale()`, `BloomNode`, `TRAANode`, and
`DepthOfFieldNode` where those nodes are part of the shot. For space scenes
with large shadowed geometry, prefer `CSMShadowNode` or `TileShadowNode` before
custom shadow systems.

## Capability Gate

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend) {
  await renderer.computeAsync(precomputeLensTiles);
  await renderer.compileAsync(scene, camera);
} else {
  quality.maxSteps = Math.min(quality.maxSteps, 32);
  quality.resolutionScale = Math.min(quality.resolutionScale, 0.5);
  quality.usePrecomputedEnvironment = true;
}
```

The non-primary branch is a lower quality tier using the same authored assets
and public controls. It must not become a separate renderer recipe.

## Wormhole State Reduction

The wormhole renderer uses a spherically symmetric throat model and reduces
each 3D ray to a two-dimensional integration state:

```text
y.x = signed radial coordinate l
y.y = radial momentum pL
impact parameter b = length(cross(rayOrigin, rayDirection))
throat radius Rth = 1.2
```

Construct an orbital plane in effect space:

```text
normal = normalize(cross(origin, direction))
u = normalize(origin)
v = cross(normal, u)
```

Near-radial rays need fallback axes so the orbital plane never starts with a
zero cross product.

Initial signed coordinate:

```text
l = sqrt(max(length(origin)^2 - Rth^2, 0.001))
pL = dot(normalize(origin), direction)
```

## Wormhole RK4 Integration

The derivative is:

```text
r2 = l^2 + Rth^2
dl/ds = r2 * pL
dpL/ds = b^2 * l / r2
```

Run RK4 as one accepted step per loop. The four sub-stages sample the
derivative, but only the accepted result updates `l`, `pL`, accumulated azimuth,
and step count.

Preserved baseline parameters:

```text
maximum hero iterations = 920
base step = 0.0042
per-ray deterministic jitter = +/- 0.00045
escape distance = abs(l) > 40
azimuth accumulation = step * b
```

Production parameters are quality-tiered and adaptive:

```text
hero accepted steps = min(920, adaptive cap)
standard accepted steps = 320-520
background accepted steps = 96-220 or cached lens map
step scale = clamp(errorTarget / curvatureEstimate, minStep, maxStep)
near-throat clamp = min(step, throatDistance * 0.25)
```

On escape:

```text
finalDirection = normalize(u * cos(phi) + v * sin(phi))
```

The sign of final `l` selects which exterior universe is visible. Failure to
escape must write a termination ID and an obvious debug color; production output
can blend to an artistic fallback, but diagnostics must reveal capped pixels.

The RK4 model is stronger than a screen distortion because the environment
direction comes from numerical integration. Do not claim physical parity until
CPU reference rays match expected values.

## Accretion-Disk Curved-Ray Integration

The accretion effect is an artistic curved-ray field unless independently
validated against a metric. The retained steering model bends the ray toward
the center inside a configured range:

```text
r = length(rayPosition)
steerMagnitude = step * power / max(r^2, epsilon)
steerRange = remapClamped(r, 1 -> 0.5, 0 -> 1)
newDirection = normalize(direction - radial * steerMagnitude * steerRange)
```

Production changes:

- use adaptive `step`, not a global constant;
- commit only one `rayPosition` advance per accepted step;
- clamp or soften the inverse-square term near the core;
- terminate on core hit instead of marching through an absorbed pixel;
- use transmittance to stop when the disk becomes opaque enough;
- retune bending, density, width, and brightness together after fixing step
  policy.

Never advance the ray position twice in one loop. The historical example did
that while computing steering from a single step size; removing the duplicate
advance changes the visual scale and requires a full retune.

## Disk Density And Color

Disk coordinates rotate around the local Z axis with radius and time:

```text
rotation phase = radialDistance * 4.27 - time * 0.1
noise UV = rotatedPosition * 2
```

A repeated deep-noise texture modulates a quadratic band across
`[-width, 0, +width]`. Radial distance, noise value, and a nearby noise sample
produce a ramp coordinate.

Retained linear emission ramp:

```text
white-hot at 0.06
gold at 0.33
dark amber at 1.0
emission scale 1.95
additional emission color (1.0, 0.72, 0.26)
```

Accumulate color with the standard emission/transmittance model:

```text
segmentAlpha = 1 - exp(-density * extinction * stepLength)
radiance += transmittance * segmentEmission * segmentAlpha
transmittance *= 1 - segmentAlpha
```

Use `transmittance < 0.01` for hero termination and `transmittance < 0.03` for
lower tiers unless the shot needs more transparent outer rings.

## Continuous Disk And Shell Crossings

Thin structures must be detected over a segment, not only at the sample point.
Track signed distance before and after the candidate step:

```text
d0 = signedDistance(previousPosition)
d1 = signedDistance(candidatePosition)
crosses = d0 == 0 or d0 * d1 <= 0
t = d0 / (d0 - d1)
crossPosition = mix(previousPosition, candidatePosition, saturate(t))
```

For finite thickness disks, split the segment at entry and exit distances or
substep only inside the band. Clamp adaptive step size by distance to the next
thin surface so hero settings do not skip structure.

## Background Lensing And Star Fields

Sample exterior universes or star fields only after integration terminates.
The final environment lookup uses the bent `finalDirection`, not a distorted
already-rendered image.

The existing deterministic star texture idea is preserved because it is useful
for validation. Use seeded star or generated-variant textures for repeatable
captures:

```text
assets/generated-variants/starfield-tile-a.png
assets/generated-variants/starfield-tile-b.png
assets/generated-variants/starfield-tile-c.png
```

Use finite-resolution star maps carefully under extreme magnification. For hero
lensing, prefer a procedural directional field or a higher-resolution
environment cache generated into a `StorageTexture`.

## Quality Tiers And Budgets

| Tier | Render scale | Accepted steps | Storage | Target |
| --- | --- | --- | --- | --- |
| Hero | 0.5 to 1.0 center window | 96-160 accretion, up to 920 RK4 wormhole | two HDR histories, diagnostics optional | 1.8-2.8 ms desktop discrete, 4-6 ms integrated, 7-9 ms mobile |
| Standard | 0.5 | 48-96 accretion, 320-520 RK4 wormhole | two HDR histories | 0.8-1.5 ms desktop discrete, 2-3 ms integrated, 4-5 ms mobile |
| Background | 0.25 or cached lens map | 24-48, low-rate refresh | one cached lens or radiance texture | 0.3-0.7 ms desktop discrete, 0.8-1.4 ms integrated, 1.5-3 ms mobile |
| Distant | impostor or cubemap | 0-16 | optional precomputed texture | under 0.25 ms desktop discrete, under 0.75 ms integrated/mobile |

Use GPU timestamp queries or renderer timing tools when available and capture
the same camera across tiers. Record dispatch count, pass count, storage size,
texture memory, draw calls, accepted-step histogram, and early-exit percentages.

## Color And Texture Rules

- Star and environment textures are color data and use `SRGBColorSpace`.
- Noise, density, masks, lens maps, step counts, and termination IDs are data
  and use `NoColorSpace` or linear settings.
- Decide mipmaps per use: color star fields usually benefit from mipmaps;
  nearest diagnostic IDs and step-count buffers do not.
- Use repeat wrapping for tileable noise and generated star tiles; use clamp for
  non-tileable diagnostic or lens-map textures.
- Keep radiance, bloom input, and history in `HalfFloatType` until the single
  tone-map/output-conversion owner in the node pipeline.

## Diagnostics And Validation

Expose these diagnostic outputs:

```text
wormhole l and pL
impact parameter and orbital-plane basis
RK4 accepted-step count and escaped/capped state
final exterior side and environment direction
accretion radius and steering magnitude
effective traveled distance
disk band, noise, ramp coordinate, and local alpha
accumulated opacity and remaining transmittance
core-hit mask
final bent background direction
termination ID
NaN/invalid-state mask
```

Validation requirements:

- CPU reference rays for wormhole cases before physical-parity claims;
- deterministic star/background captures at fixed cameras;
- debug captures for step count, termination ID, invalid state, and
  transmittance;
- proxy-transform tests for moved, uniformly scaled, nonuniformly scaled, and
  far-from-origin volumes;
- temporal rejection tests for camera cuts, disocclusion, and fast orbiting
  cameras.

For nonuniform scale, either reject the transform at setup or integrate in a
space where the metric and density are intentionally defined. For large worlds,
use a floating-origin or camera-relative effect transform so precision loss does
not dominate near the throat or disk.

## Replaced Techniques

- Replaced unconditional fixed-step loops with adaptive accepted steps,
  transmittance early exit, and termination IDs because equal visual quality
  needs far fewer iterations.
- Replaced duplicate position advancement with one committed advance per
  iteration because the duplicated step changes physical scale and hides tuning
  errors.
- Replaced sample-only thin-disk hits with continuous segment crossing because
  large adaptive steps can otherwise skip disks and shells.
- Replaced full-resolution-first marching with half/quarter-resolution
  temporal reconstruction because raymarched space effects are expensive and
  temporally coherent.
- Replaced same-pixel history blending with velocity/depth-rejected temporal
  reuse because camera motion and disocclusion otherwise smear bent detail.
- Replaced screen-image warps for lensing with final-direction environment
  lookup after integration because lensing must alter the ray, not the finished
  image.
