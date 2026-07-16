# Body, Depth, and Composition

Read this reference when atmosphere altitude is planetary, the camera can leave
the atmosphere, the body is ellipsoidal, the host uses alternate depth
encoding, or sky/aerial ownership crosses a raster shell.

## Contents

- Body model
- Stable shell intersections
- Depth reconstruction
- Sky and surface composition
- Shell/post ownership
- Verification

## Body model

Convert the render position through one declared chain:

```text
render position
  -> floating-origin correction
  -> body/ECEF frame
  -> altitude and shell interval
  -> LUT coordinates and segment transport
```

Select one body model:

| Model | What is exact | Required evidence |
| --- | --- | --- |
| Sphere | radial altitude and axisymmetric 2D LUT symmetry | body radius and maximum accepted approximation error |
| Similar/coaxial ellipsoids | quadratic shell intersections and scaled-radial altitude | bottom/top axes and the meaning of scaled height |
| Geodetic oblate ellipsoid | height along the reference-ellipsoid normal | shared geodetic solver, axes, pole branch, and latitude/curvature treatment |

A constant-geodetic-height shell is not the quadric obtained by adding one
height to every axis. For geodetic bodies, either add latitude/curvature to the
transport parameterization, use a local osculating-radius approximation with a
bounded residual, or integrate the correction in the view product.

## Stable shell intersections

For ellipsoid semi-axes `a=(ax,ay,az)`, body-space ray `o+t*d`, and center
`c`:

```text
o' = (o-c)/a
d' = d/a
A  = dot(d',d')
B  = 2*dot(o',d')
C  = dot(o',o') - 1
D  = B^2 - 4*A*C
```

Classify a negative discriminant using a scale-aware roundoff bound. For a hit,
use stable roots:

```text
q  = -0.5 * (B + signNonZero(B)*sqrt(D))
t0 = q/A
t1 = C/q
```

Handle the tangent/`q=0` case directly, sort the roots, retain the positive
ray interval, and subtract the opaque bottom-body interval from the top-shell
interval. Use closest-point/ray-entry logic for an exterior camera; clamping an
orbital camera to a surface altitude changes both limb position and optical
depth.

## Depth reconstruction

Reuse one readable host depth/coverage signal. In Three.js r185:

- `PassNode.getViewZNode()` uses the perspective conversion and supports the
  renderer's standard or reversed depth state;
- `perspectiveDepthToViewZ()` and `orthographicDepthToViewZ()` already
  inspect `renderer.reversedDepthBuffer`;
- `PassNode.getLinearDepthNode()` returns normalized depth rather than metres
  or Euclidean ray length;
- logarithmic depth uses `logarithmicDepthToViewZ(depth, near, far)`;
- orthographic cameras require `orthographicDepthToViewZ()` and a per-pixel
  near-plane ray origin.

For normalized perspective view ray `v` with `v.z<0`:

```text
rayDistance = (-viewZ)/(-v.z)
```

Reconstruct with the same jittered or unjittered matrix convention that wrote
the depth. Use explicit coverage when available; otherwise compare against the
declared clear-depth value in the active encoding. Resolve multisample depth to
the nearest covered surface: minimum encoded depth for standard depth and
maximum for reversed depth. An averaged depth describes no real surface.

For each enabled projection/depth branch, measure reconstructed world-position
error at center, corners, near/far surfaces, sky pixels, clipped surfaces, and
oblique rays. A branch is active only while that error stays inside the
atmosphere segment tolerance.

## Sky and surface composition

Use one host scene pass:

```text
covered surface:
  segment = camera-to-surface ray intersected with top shell,
            excluding the opaque body
  C_out = C_scene*T_segment + S_segment

sky:
  L_out = sky radiance along the body-space ray
          + separately owned sun/moon disc radiance
```

Keep these causes distinct:

- atmosphere transmittance on the sun-to-sample path;
- cloud-only transmittance;
- opaque geometry visibility;
- water extinction on paths inside water;
- atmosphere transmittance and inscattering on the camera segment.

Material diffuse lighting consumes sky irradiance, while the visible sky
consumes directional sky radiance. Record whether either includes the direct
disc. Keep all terms scene-linear HDR, then pass the result to one tone-map and
one output-color owner.

## Shell/post ownership

Prefer sky-view for uncovered pixels and depth-aware aerial composition for
covered pixels. The same top-shell interval works below, inside, and above the
atmosphere.

When a raster shell is retained for fill rate or precision, assign one owner by
geometric overlap or an error estimate:

```text
segment = intersect(cameraRay, topShell) - opaqueBodyInterval
ownerWeight = smoothstep(errorLow, errorHigh, estimatedPostError)
L = mix(L_shell, L_post, ownerWeight)
```

Drive both owners from identical body axes, length units, sun direction,
density profiles, and transport basis. Verify value and first-derivative
continuity through shell entry, exit, horizon, and limb.

## Verification

| Branch | Required controls |
| --- | --- |
| Sphere | tangent, ground hit, exterior entry, horizon, and map symmetry |
| Similar ellipsoid | all principal axes, grazing roots, and scaled-height consistency |
| Geodetic ellipsoid | poles, equator, high altitude, and residual versus the exact height solver |
| Perspective standard/reversed | identical reconstructed positions and coverage |
| Logarithmic depth | near/far and oblique-ray position error |
| Orthographic | per-pixel origin plus constant direction |
| MSAA | nearest-covered resolve and sky boundary |
| Shell/post handoff | linear-HDR value/gradient continuity and single ownership |

Completion requires every enabled row to pass its position, transport, and
continuity tolerance; unsupported rows remain outside the implementation claim.
