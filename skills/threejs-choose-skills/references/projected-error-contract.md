# Projected Error And Representation Transitions

Use this contract whenever LOD, tessellation, packing, impostors, simulation
resolution, or field-band selection is justified by screen error.

## Inputs

Record all inputs with `Authored`, `Derived`, `Gated`, or `Measured` status:

`Authored` is a chosen source value; `Derived` is reproducibly computed from
named inputs; `Gated` is an acceptance bound that must pass before selection;
`Measured` is target evidence captured from the running composition.

- actual physical render-target width/height after DPR and pass scale, not CSS
  dimensions;
- unjittered camera projection for stable selection, plus every eye/view;
- object-to-view linear transform and the complete static/animation/deformation
  bound;
- nearest positive support depth over that bound;
- world/object approximation error and its norm (position, silhouette, normal,
  scalar, or radiance error are different contracts);
- enter/exit thresholds, dwell, transition representation, and simultaneous
  transition memory.

## Perspective Bound

For a local positional error whose view-space component is known to be purely
transverse to the view direction, object-to-view linear part `M`, physical
target height `H`, vertical field of view `fovY`, and nearest positive view
depth `z_min`, the first-order vertical pixel bound is

```text
e_view_transverse <= sigma_max(M) * e_obj
e_px_y <= e_view_transverse * H / (2 * z_min * tan(fovY / 2))
```

`sigma_max(M)` is the largest singular value; a maximum column norm is not a
general substitute under shear. This short formula is not conservative for a
depth perturbation of an off-axis point: changing the perspective denominator
also moves the image. For any error with a view-depth component, or for
off-axis, asymmetric, panoramic, strongly wide-angle, near-plane-crossing, or
large perturbations, expand the complete support by the error set, project its
extrema through the actual unjittered view-projection matrix, divide by `w`,
map NDC to physical pixels, and take the maximum displacement from the
unexpanded support. Reject or clip support that crosses `w <= 0`/the near
plane; do not hide it with a denominator clamp.

Use nearest support depth, not object-center depth. Expand support by skinning,
wind, procedural displacement, camera-relative reconstruction error, and the
complete motion envelope used during the selection dwell.

## Orthographic Bound

For orthographic vertical span `top-bottom` and world/view-space vertical error
`e_view_y`:

```text
e_px_y = abs(e_view_y) * H / abs(top - bottom)
```

Use the corresponding physical width/span for horizontal error, or project
support endpoints exactly. Object transforms still apply before this equation.

## What To Gate

- Geometry/LOD: maximum silhouette and positional displacement in pixels;
  normal-angle and shading error are separate.
- Displacement fields: projected height error plus derivative/normal error.
- Textures/procedural bands: transform the footprint into the field domain and
  reject frequencies above the sampled Nyquist limit; anisotropy requires the
  full footprint/Jacobian, not distance alone.
- Impostors: silhouette/depth/radiance error across the admitted view cone.
- Simulation grids: conserved quantity or state error first, then projected
  appearance; screen error alone cannot excuse broken dynamics.

## Stable Transitions

Select with the unjittered projection. Use distinct enter/exit error thresholds
and a declared dwell/cooldown; change one representation transaction at a time.
During cross-fade/morph transitions, record both representations' peak live
bytes, draws, attachment/history state, and shadow/depth parity. Reset or
reproject affected histories explicitly. A transition passes only when error,
memory, full-frame p50/p95, and oscillation gates all pass on the target.

Never route from triangle count, distance, CSS pixels, or a device label alone.
