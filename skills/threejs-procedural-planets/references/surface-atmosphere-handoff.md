# Planet Surface-to-Atmosphere Handoff

Read this reference when a planetary surface supplies geometry, units, masks,
or radiometric inputs to an atmosphere or aerial-perspective owner.

Publish a narrow surface-side handoff:

```text
planet center and body/world transform
sphere radius or ellipsoid axes plus altitude convention
atmosphere bottom/top geometry
metersPerWorldUnit
sun direction in the declared frame
surface point, reference normal, and altitude meters
surface reflectance plus water/ice/wetness/material masks
scene-linear radiometric basis and field version/error
```

Surface and atmosphere share the same transform, reference-surface solver,
unit conversion, sun frame, and radiometric basis. A spherical surface pairs
with spherical shell geometry; an ellipsoid declares bottom/top axes or an
altitude model. The image pipeline owns exposure and final color conversion.
Surface reflectance is dimensionless. Light quantities declare whether they
are irradiance in `W m^-2` or radiance in `W m^-2 sr^-1`, plus any spectral or
RGB basis; a scene-linear encoding alone does not define physical units.

Use `RenderPipeline` with output-only MRT by default. Allocate normal,
velocity, emissive, or diagnostic attachments only for implemented consumers.
Keep HDR scene color linear until the single output transform.

Verify atmosphere geometry, units, altitude, transform, sun frame, radiometric
basis, field version/error, and invalid/stale rejection. Inspect fixed orbit,
horizon, limb, and close cameras with flat surface albedo and atmosphere
disabled/enabled separately.

Failure signature:

| Symptom | Inspect |
| --- | --- |
| Atmosphere limb drifts | common reference surface, units, and altitude convention |

A constant-geodetic-height shell is not obtained exactly by adding height to
each ellipsoid axis. Surface and atmosphere must agree on normal height,
scaled-radial height, or an explicitly error-bounded shell approximation. Use
the shared body's metric solver and first-opaque-body ray termination; do not
let an atmosphere LUT reinterpret a radial displacement as geodetic altitude.
