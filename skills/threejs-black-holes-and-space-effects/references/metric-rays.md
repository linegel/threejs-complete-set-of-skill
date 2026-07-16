# Ellis and Schwarzschild Rays

Read this reference only after selecting the Ellis or Schwarzschild branch.
Both are spherically symmetric null-ray models, so each ray lies in an orbital
plane. They do not supply Kerr rotation.

## Contents

- Shared numerical contract
- Ellis ultrastatic wormhole
- Schwarzschild null rays
- Physical disk transfer

## Shared numerical contract

Normalize the photon energy to `E = 1` and carry azimuth as an integrated state
component. Use an explicit orthonormal observer frame to initialize the ray and
an explicit exterior frame to reconstruct its escaped direction. Degenerate
radial rays use a deterministic alternate axis for the orbital plane.

Each attempted step evaluates temporary stages. An accepted attempt commits
`(state, events, transfer)` once; a rejected attempt commits none of them. For
RK4 step doubling, compare one full step with two half steps:

```text
e_i     = (y_twoHalf_i - y_full_i) / 15
scale_i = atol_i + rtol_i * max(abs(y0_i), abs(y_twoHalf_i))
error   = max_i(abs(e_i) / scale_i)
```

Accept at `error <= 1`. Bound attempts separately, and classify failure at the
minimum step or attempt cap. Continuous horizon, throat, disk, shell, and
escape events are located from the pre-step state with dense output or bounded
root refinement.

## Ellis ultrastatic wormhole

Use the Ellis/Morris-Thorne metric with `c = 1`:

```text
ds^2 = -dt^2 + dl^2 + (l^2 + a^2)(dtheta^2 + sin(theta)^2 dphi^2)
```

`a` is the throat radius and `l` is signed proper radial distance. Let `lambda`
be an affine parameter and define the Mino-like parameter `s` by
`d lambda = (l^2 + a^2) ds`. Integrate the dimensionless state `L = l/a`,
`B = b/a`, and `sigma = a s`:

```text
dL/dsigma   = (L^2 + 1) p_l
dp_l/dsigma = B^2 L / (L^2 + 1)
dphi/dsigma = B
C           = p_l^2 + B^2 / (L^2 + 1) = 1
```

For a normalized ray starting at areal radius `r0 >= a` in a declared
exterior:

```text
u          = normalize(origin)
n          = normalize(cross(origin, direction))
v          = cross(n, u)
B          = length(cross(origin, direction)) / a
L          = exteriorSign * sqrt((r0/a)^2 - 1)
p_l        = exteriorSign * dot(u, direction)
```

An origin at the throat requires chart coordinates and a valid tetrad; an
arbitrary epsilon is not a chart position. Gate `C` at initialization.

For an inward initial state, `L*p_l < 0`, the invariant gives the regimes:

```text
B < 1   traverses to the opposite exterior
B > 1   turns at abs(L_turn) = sqrt(B^2 - 1)
B = 1   approaches the throat light ring and remains unresolved at finite work
```

An outward state, `L*p_l > 0`, escapes through its current exterior rather
than entering this capture/turning classification. At `L*p_l = 0`, classify
the state from the invariant and radial derivative as a turning or critical
initial condition.

Keep `escaped`, `turning`, `traversing`, `unresolved-critical`, `step-cap`,
`attempt-cap`, and `invalid` distinct. At finite escape radius reconstruct the
outgoing tangent:

```text
e_r         = u*cos(phi) + v*sin(phi)
e_phi       = -u*sin(phi) + v*cos(phi)
r_over_a    = sqrt(L^2 + 1)
q_r         = sign(L) * p_l
d_exterior  = normalize(q_r*e_r + (B/r_over_a)*e_phi)
```

Transform `d_exterior` through the selected exterior's orthonormal environment
orientation. If the proxy truncates the metric, integrate or bound the
remaining azimuth tail before applying the angular gate.

**Ellis criterion:** independent reference rays cover inward `B = 0`, both
sides of `B = 1`, the exact critical class, turning, traversal, both exteriors,
outward same-exterior escape, and escaped-tangent convergence while keeping
`C` within tolerance.

## Schwarzschild null rays

Use geometric units `G = c = 1` and record the conversion
`M = G M_SI / c^2` in metres. In the equatorial orbital plane with impact
parameter `b = L/E`, integrate:

```text
dr/dlambda   = p_r
dp_r/dlambda = b^2/r^3 - 3 M b^2/r^4
dphi/dlambda = b/r^2
C             = p_r^2 + (1 - 2M/r)b^2/r^2 = 1
```

For capture/scatter classification from a common outer boundary, require
`R > 3M` and initialize an incoming ray with:

```text
F_R   = 1 - 2M/R
V_R   = F_R b^2/R^2
p_r0  = -sqrt(1 - V_R)
```

Require `V_R < 1` for the inward root. `V_R = 1` is the tangent/turning state;
`V_R > 1` is inadmissible. A camera at an arbitrary finite event instead
initializes `E`, `L`, the orbital plane, and the ingoing or outgoing
radial-potential root from its local tetrad. It does not inherit the outer-
boundary capture/scatter classification. The reduced model has:

```text
horizon radius       r_h = 2M
photon-sphere radius r_p = 3M
critical impact      b_c = 3*sqrt(3)*M
```

Classify an exact critical inward ray from `R > 3M` as
`unresolved-critical`. Under the same boundary contract, a subcritical inward
ray reaches the horizon and a supercritical inward ray turns and may escape.
Refine the first crossing of `r = 2M`. Declare escape only after the radial
momentum has turned outward and the ray crosses `r = R`; refine that crossing
from the pre-step state. The accepted-step cap is `step-cap`, the attempted-step
cap is `attempt-cap`, and neither is an escape.

At the finite boundary, use the static Schwarzschild orthonormal frame. With
`F = 1 - 2M/R`, the outgoing spatial direction is:

```text
d_static = normalize(p_r*e_r + (b*sqrt(F)/R)*e_phi)
```

This follows the invariant and retains the tangential momentum omitted by a
radial-position lookup. Continue or bound the far-field deflection beyond `R`
when the claimed metric extends to infinity.

A coherent static lens may use two transfer tables split at `b_c`, sampled
dense in `log(abs(b-b_c))`. Store termination class, azimuth or tangent,
minimum radius, and optionally the direction Jacobian. Gate interpolation
against direct independent rays, especially across the critical pixel
footprint.

**Schwarzschild criterion:** independent CPU `float64` rays launched inward
from `R > 3M` cover `V_R < 1`, the `V_R = 1` tangent, inadmissible `V_R > 1`,
and impacts below, at, and above `b_c`; arbitrary finite-camera rays cover both
tetrad-derived radial roots. Valid rays agree on event class/residual, maximum
invariant drift, minimum radius, and final static-frame direction under
successive refinement.

## Physical disk transfer

A Schwarzschild thin disk names its inner/outer radius, orbital/emitter model,
surface frame, opacity, spectral basis, and observer tetrad. Preserve every
ordered geodesic crossing required by higher-order images.

For photon momentum `k_mu`, observer four-velocity `u_observer`, and emitter
four-velocity `u_emitter`:

```text
g                    = (k_mu u_observer^mu) / (k_mu u_emitter^mu)
I_nu_observed        = g^3 I_nu_emitted
I_bolometric_observed = g^4 I_bolometric_emitted
```

For a participating segment in a declared comoving basis:

```text
sigma_t  extinction                         [m^-1]
j        emission coefficient               [W m^-3 sr^-1]
tau      = sigma_t ds                        [1]
Delta L  = T (j/sigma_t) (1 - exp(-tau))    [W m^-2 sr^-1]
```

Use `T*j*ds` as `sigma_t` approaches zero. A sampled RGB ramp without the
four-velocity, tetrad, and frequency transfer is the artistic branch.

**Transfer criterion:** crossings remain ordered under refinement, each
frequency factor is applied once, and all accumulated channels resolve to the
declared radiance basis.
