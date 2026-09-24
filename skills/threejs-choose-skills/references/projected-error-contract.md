# Projected Error And Representation Transitions

Use this contract whenever LOD, tessellation, packing, impostors, simulation
resolution, or field-band selection is justified by screen error.

## Inputs

Record all inputs with `Authored`, `Derived`, `Gated`, or `Measured` status:

`Authored` is a chosen source value; `Derived` is reproducibly computed from
named inputs; `Gated` is an acceptance bound that must pass before selection;
`Measured` is target evidence captured from the running composition.

- actual physical viewport width/height after DPR and pass scale, not CSS
  dimensions or the full attachment extent when rendering into a subviewport;
- unjittered camera projection for stable selection, plus every eye/view;
- object-to-view linear transform and the complete static/animation/deformation
  bound;
- nearest positive support depth over that bound;
- world/object approximation error and its norm (position, silhouette, normal,
  scalar, or radiance error are different contracts);
- enter/exit thresholds, dwell, transition representation, and simultaneous
  transition memory.

## Perspective Bound

For a local positional error whose view-space component is purely transverse
to the view direction, let `M` be the object-to-view linear transform, `H` the
physical viewport height, and `z_min` the nearest positive view depth.
Use `P = camera.projectionMatrix.elements` from the actual unjittered matrix
(column-major). For Three.js's standard perspective matrix:

```text
e_view_transverse <= sigma_max(M) * e_obj
e_px_y <= e_view_transverse * H * abs(P[5]) / (2 * z_min)
```

For constant-depth displacement this scale is exact; replacing point depth
with the nearest support depth gives the bound. `P[5]` includes zoom and a
cropped view's scale. Nominal `camera.fov` alone does not. For an uncropped
symmetric camera, `P[5] = zoom / tan(fovY / 2)` with `fovY` in radians.
`getEffectiveFOV()` includes zoom but not a cropped view's scale. After camera
parameter changes, update the projection matrix before reading it. A custom
projection with cross-axis terms requires the full mapping below.

`sigma_max(M)` is the largest singular value; a maximum column norm is not a
general substitute under shear. Use nearest support depth, not object-center
depth. Expand support by skinning, wind, procedural displacement, camera-relative
reconstruction error, and the complete motion envelope during selection dwell.

## Finite Depth And General Projective Error

A depth perturbation of an off-axis point changes the perspective denominator.
For a corresponding view-space point `p` and displacement `delta`, form clip
vectors `c = P * vec4(p, 1)` and `d = P * vec4(delta, 0)`. For axis `i`
(`x` or `y`) and its physical viewport extent `extent_i`, the exact signed
pixel displacement, before viewport-origin translation, is:

```text
delta_px_i = extent_i * (c.w * d_i - c_i * d.w) / (2 * c.w * (c.w + d.w))
```

Maximize its absolute value over the admitted paired point/error set, or bound
that set conservatively. Comparing only the extents of unexpanded and expanded
bounding boxes does not bound corresponding-point error: interior features may
move while both boxes remain unchanged. Finite samples check those pairs, not
the entire continuous support.

Require positive `w` and satisfaction of the actual near-plane inequality for
both points and the admitted error support. Clip or reject crossings; never
hide a singularity with a denominator clamp. Account for the renderer's depth
convention and reversed depth when testing clip planes. Nonlinear panoramic
projection is not represented by one 4x4 matrix: use its actual mapping and
explicit seam/wrap convention instead.

## Orthographic Bound

For Three.js's standard orthographic matrix and view-space vertical error
`e_view_y`, use the current unjittered matrix scale:

```text
e_px_y = abs(e_view_y) * H * abs(P[5]) / 2
```

For an uncropped camera this equals `abs(e_view_y) * H * zoom / abs(top-bottom)`.
The raw `top-bottom` span omits zoom; a cropped view changes the scale again.
Use `P[0]` and physical width for horizontal error, or the full mapping for
custom cross-axis terms. Object transforms still apply before projection.

API conventions: [PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html)
and [OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html).
Check the installed revision's projection implementation when using these rules.

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
