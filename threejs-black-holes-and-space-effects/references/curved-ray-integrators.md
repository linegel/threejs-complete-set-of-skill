# Curved-Ray Numerical Integrators

Use this reference for WebGPU/TSL ray integration of black-hole, wormhole,
accretion-disk, and bounded space-volume effects. The production architecture
is bounded integration with one committed state update per accepted step,
explicit local-error or convergence control, transmittance early termination,
reduced-resolution temporal reconstruction, and optional compute/storage
caches.

## Contents

- Production architecture
- TSL material and compute ownership
- Capability gate
- Claim classes and number provenance
- Wormhole state reduction
- Wormhole RK4 integration
- Error control and integrator selection
- Accretion-disk curved-ray integration
- Continuous disk and shell crossings
- Background lensing and star fields
- Quality tiers and budgets
- Color and texture rules
- Diagnostics and validation
- Replaced techniques

## Routed Physics Adapter

The exact cross-domain ABI is owned by the
[physics domain and interaction contract](../../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
Use it when a lens, metric, observer, or emitter is time-varying or shared with
another domain. This reference specifies only the curved-ray projection of that
ABI.

One `PhysicsContext` owns the stable SI physics frame,
`worldToPhysicsTransform`/`worldTransformRevision`, `physicsOriginEpoch`, scale,
and clock identities. `PhysicsPresentationCandidate` owns view-independent
state pairs and leases; each `CameraViewPublication` owns its separate
global-to-render mappings. `PhysicsSignalDescriptor` records own
metric/lens/emitter model identity, physical scale, valid `PhysicsTimeInterval`,
domain support, nondimensionalization, residency, validity, and typed error.
Register the source stages and presentation consumer in `PhysicsGraph`; the
per-pixel geodesic or artistic march remains a render stage and is not inserted
as the rigid-body or environmental dynamics timestep.

Use these source roles without inventing local envelope types:

| Source role | Required physical meaning |
| --- | --- |
| Metric/lens state | Named model and revision; lens frame/worldline; chart and tetrad identities; bounded validity interval; physical length scale and conversion provenance. |
| Schwarzschild/Kerr parameters | `M [kg]` or `G M / c^2 [m]`; `J [kg m^2 s^-1]` or declared `a* = c J / (G M^2)`; never an unqualified scene-unit radius/spin. |
| Ellis parameters | Throat radius `a [m]`, exterior convention, chart/tetrad mapping, and nondimensional `L=l/a`, `B=b/a` conversion. |
| Observer/emitter state | Physics-frame pose plus four-velocity/tetrad when the transfer model needs it; a Three.js transform alone cannot establish redshift. |
| Emissive medium | Physical extinction/emission fields, or an explicitly artistic field whose non-SI claim is recorded. |

### Time and unit bases

Never alias the following independent variables:

```text
t_coord       metric chart coordinate time
t_proper      proper time on a massive observer/emitter worldline
lambda_affine null-geodesic affine parameter
sigma_solver  optional dimensionless/Mino-like reparameterization
t_source      canonical PhysicsInstant before mapping to a metric/emitter event
t_request     PhysicsPresentationCandidate.requestedPresentationInstant
t_render_prev[v] CameraViewPublication[v].previousRenderSampleInstant
t_render_current[v] CameraViewPublication[v].currentRenderSampleInstant
t_presented[b] PresentedStatePair[b].currentPresented.presentedInstant
t_previous_presented[b] the same binding's previousPresented.presentedInstant
```

The ray integrator advances `lambda_affine` or `sigma_solver`. Map the observer
event from `t_source` into the metric chart, including clock/chart conversion
and error. For a nonstationary spacetime, coordinate time is a curve component:
integrate or recover `t_coord(lambda)` and sample/interpolate metric and emitter
providers at every mapped coordinate event with their state/resource versions,
validity, and interpolation error. A single immutable metric snapshot is only a
frozen/quasi-static approximation; declare a bound on metric evolution over the
ray and forbid a general time-dependent-geodesic claim when that bound fails.

Reconstruction is requested at `t_request`, but every stable binding supplies
its own `t_presented[b]`, previous presented time, source bracket, clock,
interpolation/extrapolation policy, and error. Do not assume equality with the
request or reuse one alpha for lens, observer, disk, and emitter providers. A
view forms a half-open `PhysicsTimeInterval` only when its validated
`t_render_current[v]` is later than `t_render_prev[v]` under the same clock
mapping and discontinuity epoch. Equal instants mean no elapsed interval and
must not be encoded as a zero-length interval; reversal or discontinuity follows
the scoped reset policy. The interval never comes from the candidate request or
a source binding's clock. Neither display delta nor temporal-history weight
changes the geodesic step.

Keep conversions explicit at one adapter boundary:

```text
x_physics = R_worldToPhysics * (metersPerWorldUnit * x_world) + t_physics
x_render  = CameraViewPublication.globalToRenderCurrent(x_physics)
r_s      = 2 G M / c^2                         [m]
x_geom   = x_SI / L0
t_geom   = c * t_SI / L0
x_hat    = x_geom / L_solver
```

`L0` and `L_solver` are recorded conversion scales. A declaration `G=c=1`
does not erase dimensions; it selects a geometrized basis from which SI and
render values remain recoverable. Chart coordinates are not automatically a
Cartesian physics frame, so vectors/tetrads use the declared chart Jacobian
and frame mapping rather than a raw `Object3D.matrixWorld`.

### Presentation and radiometry

After physics commit, the route publishes one view-independent
`PhysicsPresentationCandidate`. Each camera owner consumes that candidate and
publishes a per-view `CameraViewPublication`; visibility, shadows, and caches
then publish a `ViewPreparationPublication`; only then may the route seal the
per-view `PhysicsPresentationSnapshot`. The snapshot references candidate
binding IDs and leases and the exact camera/view-preparation publications; it
does not copy pairs, transforms, or reset actions.

Resolve each relevant candidate `PresentedStatePair`: previous/current lens,
observer, and emitter/disk samples each retain their own
`PresentationSampleProvenance`, source-clock mapping, brackets, and
interpolation/extrapolation policy. Resolve previous/current global-to-render
transforms and render instants from `CameraViewPublication`, and reactive/reset
actions from `ViewPreparationPublication`. Validate source/model version,
validity, and typed error through the associated `PhysicsSignalDescriptor`. A
referenced state handle must retain its exact candidate lease generation until
the `ConsumerCompletionJoin` permits retirement; object immutability does not
make overwritten ping-pong storage immutable. Completion belongs to the
append-only multi-target `FrameExecutionRecord`, not a candidate or snapshot
mutation.

Lens-specific temporal history rejects samples across metric class or revision,
termination/exterior/event class, critical/Jacobian discontinuity,
origin/projection discontinuity, or invalid source state. Motion/reprojection
comes from adjacent *presented* states, not raw solver endpoints.

Consume environment and emitter input from the matching
`LightingTransportSnapshot`. Preserve every sampled channel's radiometric
quantity and spectral/angular basis; no bundle-wide basis overrides channel
metadata. Apply each atmosphere/cloud/visibility/medium factor once. For a
physical medium after SI conversion:

```text
sigma_t  extinction                         [m^-1]
j        emission coefficient               [W m^-3 sr^-1]
L        radiance                           [W m^-2 sr^-1]
tau      sigma_t * ds                       [1]
Delta L  T * (j / sigma_t) * (1-exp(-tau))
```

The coefficients are defined in a declared local comoving tetrad and
spectral/bolometric basis; use invariant frequency transfer for a relativistic
medium rather than treating RGB as that basis. The zero-extinction limit is
`T*j*ds`. Wavelength-resolved transport carries the corresponding
per-wavelength units and basis. An artistic scene-unit
medium may use the same algebra only after declaring its non-SI basis and
dropping the physical radiometric claim.

### Semantic exclusions and quality changes

- Ray escape, horizon/core absorption, disk/shell crossing, critical capture,
  and max-step failure are integration termination/event diagnostics. They are
  not `InteractionRecord` values and have no equal-and-opposite reaction.
- A metric, throat, accretion density, extinction field, or color ramp is not a
  `PhysicsMaterialId` in `PhysicsMaterialRegistry`. Surface contact law
  selection does not follow shader parameters.
- A visual ray renderer produces no body force. If scene bodies respond to the
  lens mass/metric, a separate dynamics owner consumes the same descriptor and
  publishes its own state/interactions.
- `QualityTransition` may change tolerance, cache/map resolution, update
  cadence, ray footprint sampling, or reconstruction only while preserving
  model class and claim. Metric/model/solver-class changes require a new truth
  contract; migrate or invalidate history explicitly.

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
10. Reconstruct the reduced-resolution effect with lens-specific validity and
    composite it against full-resolution scene depth/color.

The cost model is approximately
`marchedPixels * acceptedSteps * (fieldCost + lightCost) + reconstructionCost`.
Bounds, empty-space rejection, early termination, reduced resolution, and
temporal reuse reduce different factors in that expression. Record the factors
instead of quoting a device-independent speedup.

## TSL Material And Compute Ownership

Use `WebGPURenderer` from `three/webgpu`, TSL from `three/tsl`, and a
`MeshBasicNodeMaterial` or another `NodeMaterial` variant for the proxy volume.
The main raymarch is a TSL `Fn` that returns linear radiance, opacity or
transmittance, termination ID, and optional diagnostics.

```js
const marchSpaceEffect = Fn(({ rayOrigin, rayDirection, quality }) => {
  const state = initRayState(rayOrigin, rayDirection, quality);

  Loop({ start: int(0), end: quality.maxAttempts }, () => {
    If(state.done, () => Break());

    const proposal = proposeIntegratedState(state, state.stepLength);
    const error = estimateScaledError(state, proposal);

    If(error.greaterThan(1), () => {
      state.stepLength.assign(rejectedStepLength(state.stepLength, error));
      state.rejectedAttempts.addAssign(1);
      Continue();
    });

    evaluateSegmentEvents(state, proposal);
    accumulateAcceptedSegment(state, proposal);
    commitIntegratedState(state, proposal); // The only state advance.
    state.acceptedSteps.addAssign(1);
    updateTerminationAndNextStep(state, error);
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
validation readbacks. Explicitly set storage texture format/type/filter/color
space and set `generateMipmaps = false`, `mipmapsAutoUpdate = false` when mips
are unused; r185 `new StorageTexture(w,h)` is RGBA unsigned-byte by default, not
an RGBA16F history declaration.

Compose through `RenderPipeline`, `pass()`, `mrt()`,
`PassNode.setResolutionScale()`, `BloomNode`, `TRAANode`, and
`DepthOfFieldNode` where those nodes are part of the shot. In r185 the display
nodes are default exports from `three/addons/tsl/display/*Node.js` (with named
factory exports such as `bloom`, `traa`, and `dof`); `CSMShadowNode` and
`TileShadowNode` are named exports from `three/addons/csm/CSMShadowNode.js` and
`three/addons/tsl/shadows/TileShadowNode.js`.

`PassNode.setResolutionScale()` scales its whole pass, not one material. Keep
the opaque scene/depth at the required resolution and render the bounded effect
in a separate reduced target/pass. r185 also provides default `TAAUNode` and
named `taau` from `three/addons/tsl/display/TAAUNode.js`; TAAU can reconstruct a
reduced upstream pass, while TRAA is temporal antialiasing. Neither supplies
lens-specific history validity. Configure MRT before compilation and call
`await scenePass.compileAsync(renderer)` for the actual pass graph.

If explicit `renderOutput()` owns output conversion, set
`renderPipeline.outputColorTransform = false`. After switching diagnostic
`outputNode`, set `renderPipeline.needsUpdate = true`.

## Capability Gate

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend) {
  renderer.compute(precomputeLensTiles);
  await renderer.compileAsync(scene, camera);
} else {
  throw new Error("WebGPU backend unavailable for the canonical path.");
}
```

In r185 `computeAsync()` only initializes on demand before enqueueing and is
not a GPU-completion fence. Use a real readback/map operation or timestamps
when later CPU work or evidence requires completion.

This was import-smoke-tested against local Three.js r185. Re-run that smoke test
when upgrading Three.js; node and add-on exports are revision-sensitive.

## Claim Classes And Number Provenance

Use these labels in implementation notes and validation artifacts:

- **Derived**: follows algebraically from a declared model, format, or
  resolution, such as an invariant or byte count.
- **Gated**: a pass/fail value computed from an image-space, angular,
  radiometric, or reference-error requirement.
- **Measured**: captured on named hardware with revision, viewport, scene,
  browser, timestamp method, and percentile.
- **Authored**: a visual preset or unvalidated starting budget. It is not a
  performance or accuracy claim.

| Implementation | Claim class | Minimum validation |
| --- | --- | --- |
| Geodesic equations derived from a named metric | Physical within that metric | Conserved quantities, CPU `float64` rays, step convergence, tetrad mapping |
| Ellis ultrastatic wormhole below | Physical wormhole idealization, not a black hole | Hamiltonian invariant and correct exterior selection |
| Schwarzschild/Kerr Hamiltonian ray trace | Physical vacuum-geodesic idealization | Metric/sign conventions, constants of motion, horizon/escape events, reference integrator |
| Inverse-square steering | Artistic deformation | Step-halving image stability; never a GR claim |
| Procedural disk ramp/noise | Artistic medium | Unit-consistent transfer and fixed-view validation |
| UV swirl | Screen effect | Do not call it lensing |

| Requested result | Model/architecture |
| --- | --- |
| Decorative space distortion | Explicitly artistic bounded steering, direction map, or impostor |
| Static Ellis wormhole | Ellis invariant plus nonuniform transfer LUT split around the critical impact parameter; direct ODE only for validation/refinement |
| Static nonrotating black hole | Schwarzschild null geodesics in declared units (`G=c=1`: horizon `2M`, photon sphere `3M`, critical impact `3*sqrt(3)M`); prefer a critical-split impact-parameter transfer/quadrature map for coherent views, with direct rays as reference/refinement |
| Static rotating black hole and fixed camera/metric | Kerr null geodesics with `E`, `L_z`, Carter constant `Q`; use separated radial/polar transfer integrals or a validated 2D screen transfer map before per-pixel Hamiltonian stepping |
| Time-varying metric/camera or sparse geodesic probes | Direct Hamiltonian/ODE integration with horizon-safe coordinates, invariants, events, and adaptive error control |
| Physical thin disk image | Metric geodesics, ordered disk events, emitter four-velocity, invariant radiative transfer, redshift/beaming |
| Arbitrary foreground/background geometry | Curved-path intersection, a declared environment/probe approximation, or screen remap; these are not equivalent |

Vacuum gravitational lensing is achromatic. Dispersion requires plasma or an
explicit artistic model. Lensing preserves specific intensity/surface
brightness apart from frequency/redshift transfer; magnification changes solid
angle, not the radiance of an extended source.

## Wormhole State Reduction

The reference wormhole is the ultrastatic Ellis/Morris-Thorne metric, written
in units with `c = 1`:

```text
ds^2 = -dt^2 + dl^2 + r(l)^2 (dtheta^2 + sin(theta)^2 dphi^2)
r(l)^2 = l^2 + a^2
```

Here `a` is the throat radius and `l` is signed proper radial distance. Use `a`
as the numerical length: `L=l/a`, `B=b/a`, and dimensionless Mino parameter
`sigma=a*s`. Convert only at the render boundary. Spherical symmetry keeps
the ray in one orbital plane and reduces the null geodesic to:

```text
y.x = signed proper radial coordinate l
y.y = canonical radial momentum p_l, with photon energy E normalized to 1
impact parameter b = L / E
throat radius a
```

For a normalized ray direction and an origin represented in a chosen exterior's
areal-radius frame, require `r0 = length(origin) >= a` and construct:

```text
normal = normalize(cross(origin, direction))
u = normalize(origin)
v = cross(normal, u)
b = length(cross(origin, direction))
l = exteriorSign * sqrt(r0^2 - a^2)
p_l = exteriorSign * dot(u, direction)
```

`u` points outward in either exterior, while increasing signed `l` points
toward the throat in the negative exterior. The `exteriorSign` factor is
therefore required; omitting it reverses outward negative-exterior rays. The
initialization satisfies the null Hamiltonian invariant
`C = p_l^2 + b^2 / r^2 = 1` up to floating-point error (**Derived**). Near
radial rays need a deterministic alternate axis so the orbital plane never
normalizes a zero cross product. The exterior sign and the orientation mapping
between the two exterior environment frames are authored scene data; do not
silently force `l` positive.

Reject `r0 < a`; clamping `r0^2-a^2` to an arbitrary positive epsilon invents
a chart position. An origin at the throat must be supplied as signed chart
state with a valid tetrad. Normalize direction before computing `b`, and gate
the initialized invariant before dispatch.

If the camera is represented directly in wormhole chart coordinates, do not
re-derive `l` from an embedding-space radius. Transform its local tetrad and
initialize momentum in that chart instead.

## Wormhole RK4 Integration

With affine parameter `lambda`, energy-normalized null motion in the orbital
plane obeys:

```text
dl/dlambda = p_l
dp_l/dlambda = b^2 l / r^4
dphi/dlambda = b / r^2
```

The reference equations use the Mino-like parameter `s`, defined by
`dlambda = r^2 ds`. Therefore:

```text
r2 = l^2 + a^2
dl/ds = r2 * p_l
dp_l/ds = b^2 * l / r2
dphi/ds = b
```

The dimensionless system actually integrated should be:

```text
dL/dsigma = (L^2 + 1) * p_l
dp_l/dsigma = B^2 * L / (L^2 + 1)
dphi/dsigma = B
C = p_l^2 + B^2 / (L^2 + 1) = 1
```

This removes scene-scale conditioning from tolerances and is **Derived** from
the metric/reparameterization.

These equations conserve:

```text
C(l, p_l) = p_l^2 + b^2 / (l^2 + a^2) = 1
```

because `dC/ds = 0` analytically (**Derived**). Monitor
`epsilon_C = abs(C - 1)` on every accepted step. Conservation is necessary but
not sufficient: phase error can leave `C` small while the final direction is
wrong.

Run RK4 as one accepted step per loop. The four stages sample temporary states;
only the accepted result updates `l`, `p_l`, `phi`, event state, and accepted
step count. Integrating `phi` as part of the state is preferable to a separate
update when a different parameterization or nonspherical metric is introduced.

The example's preserved preset is **Authored**, not an error-controlled
physical budget:

```text
maximum hero iterations = 920
base step = 0.0042
escape distance = abs(l) > 40
azimuth accumulation = step * b
```

Do not jitter the integration step of a metric-faithful solver. Jitter the pixel
or initial ray for sampling and keep the numerical tolerance deterministic;
otherwise the metric result changes with the temporal sequence.

### Step-doubling control

For RK4, compute one full step `y_h` and two half steps `y_hh`. The fine
solution's local error estimate is:

```text
e = (y_hh - y_h) / 15
scale_i = atol_i + rtol_i * max(abs(y0_i), abs(y_hh_i))
err = max_i(abs(e_i) / scale_i)
```

The divisor `15 = 2^4 - 1` is **Derived** from fourth order. Accept only when
`err <= 1`; a rejected attempt changes `h` but no physical, event, opacity, or
step-count state. A conventional proposal is
`h_next = h * clamp(f_min, f_max, safety * err^(-1/5))`; `safety`, `f_min`, and
`f_max` are **Authored** stability controls. Bound attempts separately from
accepted steps so pathological rays cannot create unbounded work. Reaching
`h_min` with `err > 1` terminates as numerical failure.

Step-doubling costs twelve derivative evaluations per attempted step. An
embedded 5(4) pair usually needs fewer evaluations but more live stage storage.
Choose from measured GPU cost and divergence, not method order alone.

### Output-space gate

For each fixed reference ray, compare a candidate result with a tighter CPU
`float64` solution:

```text
delta_theta = acos(clamp(dot(d_gpu, d_ref), -1, 1))
delta_event = abs(s_event_gpu - s_event_ref)
```

Set the angular gate from the environment lookup footprint. For an angular
texel width `theta_texel`, require `delta_theta <= q * theta_texel`, where `q`
is an **Authored** fraction such as one quarter and the resulting threshold is
**Gated**. Also require identical termination class, exterior side, and event
count. Record invariant drift independently.

### Escaped tangent and exterior mapping

Orbital position angle is not the outgoing ray direction. At escape form:

```text
e_r(phi)   = u * cos(phi) + v * sin(phi)
e_phi(phi) = -u * sin(phi) + v * cos(phi)
r          = sqrt(l^2 + a^2)
q_r        = sign(l) * p_l
d_exterior = normalize(q_r * e_r + (b / r) * e_phi)
```

Then transform `d_exterior` through the selected exterior's explicit orthonormal
tetrad/environment orientation. The `sign(l)` above expresses outward radial
orientation in each exterior; a different chart convention requires the
corresponding tetrad formula. Sampling a cubemap with `e_r(phi)` alone discards
the tangential momentum and is only asymptotically close for large escape
radius.

For the example's old high-impact ray, `b=2.5`, `l=42.0947`, so
`b/r=0.05937`: radial-only lookup omits about `asin(b/r)=3.40 degrees`
(**Derived**). A self-referential golden ray that uses the same radial-only
formula cannot detect this error.

If the proxy truncates a metric that is meant to extend to infinity, integrate
or bound the far-field azimuth tail rather than pretending curvature stops at
the proxy:

```text
Delta phi_tail = integral_from_lExit_to_exteriorInfinity
                 b / ((l^2 + a^2) * p_l(l)) dl
```

Alternatively declare the metric truncated and continue from the boundary
tangent. Locate the escape event `abs(l)-l_exit=0` with dense output or bounded
root refinement; accepting an overshot RK state changes the tangent/tail. Gate
the residual tail angle against the output angular error.

### Critical regimes and static transfer

For an inward ray in the dimensionless Ellis system:

```text
B < 1: crosses the throat
B > 1: turns at abs(L_turn) = sqrt(B^2 - 1)
B = 1: asymptotically approaches the throat light ring
```

This is **Derived** from `C=1`. Track traversing, turning, critical, escaped,
and unresolved-critical as different termination classes. Near `B=1`, winding
and deflection grow without bound; a fixed iteration cap creates an unresolved
critical ring, not an ordinary escaped ray. Retain azimuth modulo `2*pi` for
trigonometry and a separate winding count for diagnostics.

For the static spherical Ellis metric, a nonuniform 1D transfer table is the
default production architecture. Parameterize by `B` (and finite camera radius
and initial radial-momentum branch when not asymptotic), split the table at
`B=1`, and concentrate samples in
`log(abs(B-1))`. Store exterior/termination, deflection/tangent, and optionally
the derivative/Jacobian. Build it with a high-accuracy CPU or compute solver and
gate interpolation against independent rays. Use per-pixel RK only for
validation, locally unresolved table regions, or genuinely varying metrics.

At a critical pixel footprint, integrate/average the transfer over the pixel or
use controlled stochastic supersampling. One point sample of a divergent map
aliases rings regardless of ODE accuracy.

### Integrator decision table

| Ray regime / error evidence | Coherence | Integrator architecture |
| --- | --- | --- |
| Static spherical Ellis mapping | High | Nonuniform 1D transfer LUT split at `B=1`; direct RK reference/refinement |
| Smooth rays in a varying model; fixed-step halving and invariant gate pass | Any | Fixed RK4; smallest control overhead |
| Curvature varies; only a minority of lanes reject | Moderate | Embedded RK 5(4) or RK4 step-doubling with bounded attempts |
| Warp-wide rejection is frequent | High spatial coherence | Quantize proposed `h` into a few bins or integrate a cached tile at a tighter common step |
| Near critical orbit/separatrix; termination changes under refinement | High view coherence, small screen region | High-accuracy compute/CPU lens map with explicit invalidation; do not hide the uncertainty in a per-pixel cap |
| Long Hamiltonian path where invariant drift dominates | Moderate | Test a symplectic method in the chosen parameterization; retain event-location convergence tests |
| GPU `float32` fails the angular gate | Any | Rescale/nondimensionalize, cache a higher-precision reference product, or narrow the physical claim |

The following old heuristic values can remain only as **Authored** reference
caps, with acceptance controlled by the gates above:

```text
hero accepted steps = min(920, adaptive cap)
standard accepted steps = 320-520
background accepted steps = 96-220 or cached lens map
```

The Ellis throat is regular; a `distanceToThroat * fraction` clamp collapses to
zero at `L=0` and is not an error rule. Bound angular increment, state increment,
event distance, and estimated local error instead.

The sign of final `l` selects the exterior. Failure to escape must write a
termination ID and an obvious diagnostic value. A production art policy may
mask capped pixels, but masked pixels remain failed numerical evidence.

## Accretion-Disk Curved-Ray Integration

The accretion effect is an artistic curved-ray field unless independently
derived from and validated against a metric. The retained steering model bends
the ray toward the center inside a configured range:

```text
r = length(rayPosition)
steerMagnitude = step * power / max(r^2, epsilon)
steerRange = remapClamped(r, 1 -> 0.5, 0 -> 1)
newDirection = normalize(direction - radial * steerMagnitude * steerRange)
```

That expression is a retained first-order preset. A better unit-direction ODE
projects the attraction perpendicular to the ray:

```text
ddirection/ds = -k(r) * (radial - dot(radial, direction) * direction)
```

Integrate position and direction together with midpoint/Heun or a higher method.
The perpendicular projection preserves direction norm analytically; explicit
renormalization corrects floating-point drift but not trajectory error.

Production changes:

- use adaptive `step`, not a global constant;
- commit only one `rayPosition` advance per accepted step;
- use midpoint or Heun integration for direction when first-order Euler error is
  visible; renormalization enforces unit length but does not remove phase error;
- clamp or soften the inverse-square term near the core;
- terminate on core hit instead of marching through an absorbed pixel;
- use transmittance to stop when the disk becomes opaque enough;
- retune bending, density, width, and brightness together after fixing step
  policy.

Never advance the ray position twice in one loop. The historical example did
that while computing steering from a single step size; removing the duplicate
advance changes the visual scale and requires a full retune. Validate this
artistic ODE by rendering the same rays with `h`, `h/2`, and `h/4`; gate final
direction, disk-event location/count, and accumulated radiance. A curvature
heuristic is only a step proposal until this convergence test passes.

## Disk Density And Color

This section's noise/ramp disk is artistic. A physical thin disk requires a
named spacetime, emitter four-velocity, inner/outer edge (including the chosen
ISCO model), ordered geodesic intersections, opacity, and frequency transfer:

```text
g = (k_mu * u_observer^mu) / (k_mu * u_emitter^mu)
I_nu_observed = g^3 * I_nu_emitted
I_bolometric_observed = g^4 * I_bolometric_emitted
```

These follow invariance of `I_nu / nu^3` along vacuum geodesics. Gravitational
redshift and Doppler beaming are not reproduced by an RGB color ramp. Keep and
shade all ordered disk crossings needed for higher-order images; terminating at
the first plane crossing deletes characteristic lensed structure.

Disk coordinates rotate around the local Z axis with radius and time:

```text
rotation phase = radialDistance * 4.27 - time * 0.1
noise UV = rotatedPosition * 2
```

A repeated deep-noise texture modulates a quadratic band across
`[-width, 0, +width]`. Radial distance, noise value, and a nearby noise sample
produce a ramp coordinate.

Retained linear emission ramp (**Authored**):

```text
white-hot at 0.06
gold at 0.33
dark amber at 1.0
emission scale 1.95
additional emission color (1.0, 0.72, 0.26)
```

Declare one length and radiometric basis before transfer integration. For a
physical claim, convert distance to metres, let `rho` be a dimensionless
density shape, `beta_t` be in `m^-1`, `sigma_t = rho * beta_t`, and `j` be in
`W m^-3 sr^-1` (or the declared spectral equivalent). An artistic medium may
use a named scene-length/radiance basis only after dropping the SI claim. For a
constant segment:

```text
tau = sigma_t * stepLength
segmentT = exp(-tau)
segmentSource = sigma_t > epsilon ? j / sigma_t : 0
radiance += transmittance * segmentSource * (1 - segmentT)
transmittance *= segmentT
```

As `sigma_t -> 0`, use the limit `radiance += transmittance * j * stepLength`.
If `segmentEmission` is directly multiplied by `(1 - segmentT)`, its units are
source radiance `j / sigma_t`, not emission per length. This distinction avoids
brightness changing accidentally when step length or extinction is retuned.

Fixed cutoffs such as `transmittance < 0.01` or `< 0.03` are **Authored**. A
radiance-error cutoff is **Derived/Gated** from a remaining source bound:
terminate when `T * L_remaining_max <= epsilon_L` in the working HDR units.

## Continuous Disk And Shell Crossings

Thin structures must be detected over a segment, not only at the sample point.
Track signed distance before and after the candidate step:

```text
d0 = signedDistance(previousPosition)
d1 = signedDistance(candidatePosition)
denom = d0 - d1
crosses = abs(denom) > eps and (abs(d0) <= eps or d0 * d1 <= 0)
t = d0 / denom
crossPosition = mix(previousPosition, candidatePosition, saturate(t))
```

Handle a coplanar/parallel segment (`abs(denom) <= eps`) as an interval-overlap
case; never evaluate `0/0`. Use dense solver output/root refinement for metric
geodesics. Apply continuous event handling to the core/horizon and proxy exit,
not only the disk.

For finite thickness disks, split the segment at entry and exit distances or
substep only inside the band. Clamp adaptive step size by distance to the next
thin surface to improve quadrature, but retain the continuous event test: a
minimum-step clamp can still cross a surface. For curved trajectories, a chord
sign test can miss two crossings inside one step; subdivide when the signed
distance derivative changes sign or when a conservative curvature bound allows
more than one crossing. Gate event position against a refined reference.

## Background Lensing And Star Fields

Sample exterior universes or star fields only after an `escaped` termination.
Core/horizon absorption, unresolved-critical, capped, and invalid rays have
separate policies and must not sample an exterior as if they escaped. The final
environment lookup uses the bent `finalDirection`, not a distorted
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

Estimate the angular mapping Jacobian/ray differentials and select an
anisotropic/mip footprint from the bent-direction footprint. Merely increasing
environment resolution does not band-limit a critical curve. Preserve radiance
for extended sources; integrate the footprint or supersample unresolved point
stars/rings instead of multiplying brightness by magnification.

Cache a direction, exterior ID, validity/termination code, and optionally the
direction Jacobian; do not cache only color if lighting/exposure or the
environment can change. Invalidate by an output-space bound: estimate the
maximum angular change caused by camera/projection/effect motion and refresh
when it exceeds the allowed fraction of an environment texel.

| Occupancy / coherence observation | Architecture | Required check |
| --- | --- | --- |
| Proxy covers few pixels | Scissor/tile classification before integration | Classification cost is smaller than rejected pixel work |
| Lens is static relative to camera | Screen-space direction cache | Angular invalidation bound and disocclusion mask |
| Lens is static in world but camera moves | Direction/probe cache parameterized by view state | Interpolation error against direct rays |
| Critical curve occupies a narrow region | High-accuracy local cache plus ordinary direct march elsewhere | Seam and termination-class agreement |
| Environment changes but geometry does not | Cache bent direction/Jacobian, resample current environment | No cached tone-mapped color |
| Low temporal coherence or camera cut | Direct current march and history reset | Rejection mask covers stale samples |

### Temporal reconstruction contract

History stores or can reconstruct: bent direction, termination ID, exterior
side, disk optical/event state, representative depth, and a critical/Jacobian
reactive mask. Reproject from the lens/effect transform and the previous camera;
proxy-mesh surface velocity does not describe a curved environment ray. Reject
on any discrete termination/exterior/event change or when angular residual
exceeds the output gate.

Temporal accumulation only amortizes work when frames provide different useful
samples: checkerboard/interleaved pixels, stochastic pixel footprints, or
low-rate cache updates. Reblending the same under-integrated deterministic ODE
does not remove truncation bias. Use one history owner; do not stack an
independent custom history with generic TRAA/TAAU. Keep critical curves and
unresolved stars on a full-resolution/reactive or supersampled path.

## Quality Tiers And Budgets

| Workload | Render scale | Numerical work | Storage | Cost status |
| --- | --- | --- | --- | --- |
| Artistic accretion hero | 0.5 plus optional full-resolution critical/edge mask | 96-160 accepted midpoint/RK steps (**Authored**) | current + lens-valid history | Must be **Measured** per target |
| Static Ellis lens | full or reduced away from critical curve | nonuniform 1D transfer lookup plus footprint refinement; no default per-pixel RK | LUT + optional direction/Jacobian history | Must be **Measured** per target |
| Varying metric/geodesic | error-gated adaptive integration | accepted/rejected work follows angular/invariant/event gates, not a tier step count | diagnostics and optional tile cache | Must be **Measured** per target |
| Background coherent lens | 0.25 or cached direction map | low-rate refresh with angular invalidation | one direction/exterior/Jacobian cache | Must be **Measured** per target |
| Distant authored effect | impostor/cubemap | no geodesic claim | optional precomputed texture | Must be **Measured** per target |

At 1920x1080 half-linear scale, a 920-step RK4 path has
`960*540*920*4 = 1,907,712,000` derivative evaluations before shading
(**Derived**). This excludes a universal mobile-time claim and is why the static
Ellis LUT is the default. Calibrate steps from error gates and scale from
measured timestamp/bandwidth limits. Use
GPU timestamp queries or renderer timing tools when available and capture the
same camera across tiers. Record device, browser, Three.js revision, viewport,
thermal state, percentile, dispatch count, pass count, live/storage bytes, draw
calls, accepted/rejected-step histograms, and early-exit percentages. Only then
label the result **Measured**.

Record whole-frame p50/p95 and paired marginal p50/p95 from matched effect-on /
effect-off frames. Compute the marginal distribution from paired frame deltas;
do not sum pass percentiles or subtract unrelated percentile summaries.

For r185 timing, construct the renderer with `{ trackTimestamp: true }`, call
`await renderer.init()`, gate on `renderer.hasFeature("timestamp-query")`, and
resolve `await renderer.resolveTimestampsAsync("render")` / `("compute")`
before reading `renderer.info.render.timestamp` and
`renderer.info.compute.timestamp`.

Budget each resource as
`ceil(W*s)*ceil(H*s)*bytesPerTexel*liveCount` (**Derived**) and record lifetime.
At 960x540, one RGBA16F texture is `3.955 MiB`; two ping-pong histories are
`7.910 MiB`, before velocity/depth, direction maps, or temporal-upscaler
history. Limit cache count explicitly on integrated/mobile devices.

## Color And Texture Rules

- LDR PNG/JPEG star/environment color authored in sRGB uses `SRGBColorSpace`.
  HDR/EXR and generated radiance uses its declared linear working color space.
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
Hamiltonian invariant C and maximum drift
RK accepted/rejected-attempt counts, step size, scaled local error
traversing/turning/critical/escaped/capped/min-step/invalid state
azimuth modulo 2*pi, winding count, escape-root and far-tail error
final exterior side, tetrad tangent, environment direction, and Jacobian
accretion radius and steering magnitude
effective traveled distance
disk band, noise, ramp coordinate, and local alpha
accumulated opacity and remaining transmittance
core-hit mask
final bent background direction
temporal history UV, angular residual, reactive/critical mask
termination ID
NaN/invalid-state mask
```

Validation requirements:

- independent CPU `float64` reference rays before numerical-parity claims;
- `h`, `h/2`, `h/4` convergence and an embedded/step-doubling local-error test;
- termination, exterior, event-count, invariant-drift, and final-angular-error
  gates rather than coordinate-only snapshots;
- Ellis `B=0`, `B=1-epsilon`, `B=1`, `B=1+epsilon`, turning/traversing,
  rotational symmetry, reversibility, winding, escape-root, and far-tail tests;
- GPU `float32` versus CPU `float64`, reported as angular and output-pixel
  error; the checked-in golden result must not be generated by the same solver;
- transfer-LUT interpolation and derivative/Jacobian error, especially around
  the critical split;
- deterministic star/background captures at fixed cameras;
- debug captures for step count, termination ID, invalid state, and
  transmittance;
- proxy-transform tests for moved, uniformly scaled, nonuniformly scaled, and
  far-from-origin volumes;
- `PhysicsContext` SI/geometrized/nondimensional/render round trips, including
  a stationary lens across render-origin rebases;
- independent sweeps of source simulation time, metric coordinate time,
  affine/reparameterized step, and presentation time to prove that none is
  accidentally driven by render delta;
- `PhysicsSignalDescriptor` validity/version/error rejection; candidate pair
  provenance, per-view `CameraViewPublication` render instants/transforms, and
  `ViewPreparationPublication` reset actions across model, signal, origin,
  projection, termination, and exterior discontinuities; sealed snapshots must
  resolve those exact publications rather than copy or mutate them;
- `LightingTransportSnapshot` basis/factor-ledger tests proving that external
  attenuation is neither omitted nor applied twice;
- `QualityTransition` mutation tests accepting only same-model tolerance,
  cache/map, cadence, footprint, or reconstruction changes; model-class swaps
  fail, numerical gates remain active, scoped history actions execute, and
  simultaneous old/new residency is recorded;
- an assertion that ray termination writes diagnostics only: no
  `InteractionRecord`, `PhysicsMaterialId`, force, impulse, or frame-critical
  physics readback is synthesized by the visual ray path;
- temporal rejection tests for camera cuts, disocclusion, and fast orbiting
  cameras, plus termination/exterior/critical-mask changes;
- full-resolution scene-depth occlusion, camera-inside proxy, and front/back
  proxy-face cases;
- GPU p50/p95 timestamps, exact live texture bytes, accepted/rejected work, and
  thermal steady-state on named integrated/mobile targets.

For nonuniform scale, either reject the transform at setup or integrate in a
space where the metric and density are intentionally defined. For large worlds,
use a floating-origin or camera-relative effect transform so precision loss does
not dominate near the throat or disk.

## Replaced Techniques

- Replaced unconditional fixed-step loops with adaptive accepted steps,
  contribution-bounded early exit, and termination IDs; verify the saved work
  and output error instead of assuming equal quality.
- Replaced duplicate position advancement with one committed advance per
  iteration because the duplicated step changes physical scale and hides tuning
  errors.
- Replaced sample-only thin-disk hits with continuous segment crossing because
  large adaptive steps can otherwise skip disks and shells.
- Replaced full-resolution-first marching with half/quarter-resolution
  effect-only reconstruction where coherence/error gates permit it; critical
  curves and discontinuities retain full-resolution/reactive treatment.
- Replaced same-pixel history blending with velocity/depth-rejected temporal
  reuse because camera motion and disocclusion otherwise smear bent detail.
- Replaced screen-image warps for lensing with final-direction environment
  lookup after integration because lensing must alter the ray, not the finished
  image.
- Replaced orbital-position-only environment lookup with escaped tangent plus
  an explicit exterior tetrad because position angle omits tangential momentum.
- Replaced curvature-labelled-as-error with embedded or step-doubling error
  estimates and output-space convergence gates because only the latter bound
  numerical error.
- Replaced default per-pixel RK for the static spherical Ellis model with a
  nonuniform critical-split transfer LUT because the mapping is coherent and
  one-dimensional.
