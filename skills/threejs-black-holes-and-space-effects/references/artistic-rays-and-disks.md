# Artistic Rays and Disks

Read this reference only for bounded artistic ray bending or an artistic
accretion medium. The model produces a stable deformation, not a metric claim.

## Contents

- Bounded ray
- Continuous structures
- Artistic medium
- TSL shape
- Validation

## Bounded ray

Intersect the camera ray with a finite sphere, box, or authored SDF before
marching. For a sphere centered at the origin:

```text
a = dot(d,d)
b = dot(o,d)
c = dot(o,o) - R^2
discriminant = b^2 - a*c
t_near = (-b - sqrt(discriminant))/a
t_far  = (-b + sqrt(discriminant))/a
```

Reject a negative discriminant, a zero-length direction, or an interval behind
the camera. Start at `max(t_near, 0)` so a camera inside the proxy remains
valid.

Use a unit-direction ODE whose steering is transverse to the ray:

```text
r_hat = position / length(position)
q     = r_hat - dot(r_hat, direction) direction
ddirection/ds = -k(length(position)) q
dposition/ds  = direction
```

Midpoint or Heun integration is the useful floor when Euler refinement moves
the silhouette. Normalize the direction after the accepted update to remove
floating-point drift; refinement, not normalization, controls trajectory
error. Soften `k(r)` and terminate at a declared core instead of crossing its
singularity.

## Continuous structures

For a thin disk or shell with signed distance `D`, evaluate the accepted
candidate segment from `x0` to `x1`:

```text
d0 = D(x0)
d1 = D(x1)
crosses = abs(d0-d1) > epsilon and (abs(d0) <= epsilon or d0*d1 <= 0)
t = d0/(d0-d1)
x_cross = mix(x0, x1, clamp(t,0,1))
```

Treat a nearly parallel segment as interval overlap. A curved segment may
cross twice; subdivide when a curvature bound or a signed-distance derivative
turn permits it. Sort accepted crossings by segment parameter before shading.
Apply the same continuous treatment to core, proxy exit, and thin shells.

## Artistic medium

Declare a scene-length unit and a linear-HDR source-radiance basis. With
extinction `sigma_t`, source radiance `S`, and accepted length `ds`:

```text
tau        = sigma_t ds
segment_T  = exp(-tau)
L         += T S (1 - segment_T)
T         *= segment_T
```

If the authored quantity is an emission coefficient `j` per unit length, use
`S = j/sigma_t` and the limit `T*j*ds` at zero extinction. This keeps
brightness stable when the step size changes. A remaining-radiance bound, not
an arbitrary opacity preset, determines early termination.

Keep the medium, bent environment, and bloom input in linear HDR. The selected
render pipeline owns the single tone map and output conversion. Data textures
for noise, density, termination IDs, and lens directions use a data color
space; authored LDR color textures use their declared color space.

## TSL shape

Implement the bound, state proposal, continuous events, accepted transfer, and
commit as separate TSL `Fn` units. A material-node march suits per-pixel work;
compute suits a direction map or diagnostic field reused across frames. An
accepted loop iteration has one commit site and one accepted-step increment.

Useful outputs are linear radiance, transmittance, final direction, termination
ID, accepted/rejected counts, event count, event residual, and an invalid-state
mask. A diagnostic output that replaces the final node marks the
`RenderPipeline` graph dirty. A reduced effect pass retains full-resolution
scene depth for correct occlusion.

## Validation

Generate a seeded environment containing high-frequency directional markers.
At fixed cameras compare step sequences such as `h`, `h/2`, and `h/4`:

- silhouette and final-direction angular difference;
- miss/core/escape/step-cap agreement;
- disk crossing count, order, and location;
- accumulated radiance and transmittance;
- camera-inside, moved, scaled, and far-from-origin proxy behavior.

**Complete when:** the finest two results meet declared angular, geometric,
and radiance gates; one committed advance corresponds to every accepted step;
all event classes remain visible; and the result is labeled artistic.
