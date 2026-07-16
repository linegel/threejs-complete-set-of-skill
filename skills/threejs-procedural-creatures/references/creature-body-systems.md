# Creature Body Systems

Read this reference when a creature branch needs a generated continuous body,
semantic rig, field correction, support-relative locomotion, or repeated pose
storage. It specifies reusable mechanisms rather than a named animal profile.

## Contents

- Spaces and state ownership
- Spec and compiler
- Field and blend contract
- Reference surface and correction
- Pose and locomotion
- Repeated populations and rendering
- Completion evidence

## Spaces and state ownership

| Quantity | Space | Owner |
| --- | --- | --- |
| authored part endpoints, anchors, joint hints | parent-local | spec/compiler |
| compiled and posed primitives | creature-local | rig/pose state |
| root position and orientation | stable simulation frame | instance/root owner |
| support, water, air, gravity samples | provider-declared physical frame | routed provider |
| visible/cast-shadow positions | renderer local/world transforms | presentation owner |

Use metres and seconds at simulation handoffs. Root motion is applied once by
the instance transform; creature-local slots never contain that translation or
yaw. Name every transform where spaces meet.

One stable creature identity binds immutable previous/current pose snapshots,
posed bounds, visible/depth/shadow deformation, motion vectors, and temporal
history. Creation, death, teleport, reparenting, page-slot reuse, topology or
LOD change, provider discontinuity, and quality migration advance its history
generation and reset affected consumers.

## Spec and compiler

A compact spec declares stable part IDs, parent links, local endpoints/radii,
shape, material identity, optional locomotion parameters, and an explicit blend
graph. Useful primitive classes include sphere, uniform/tapered capsule, leg,
and a fixed-step rope chain. Validate in one gate:

- IDs are unique and parent/blend references resolve to an acyclic graph;
- lengths, radii, blend widths, and joint limits are finite and positive where
  required;
- each rendered part reaches exactly one declared field root unless the spec
  explicitly unions several roots;
- compiled slot count fits the selected fixed page layout;
- colors and material fields have declared color/data spaces;
- locomotion requirements match the available limbs and external providers.

Compile separate identities:

```text
compilerSignature = schema + field kernel + extraction/numeric settings + layout
topologySignature = connectivity + blend graph + slot classes + skin/frame layout
geometryDigest = rest-pose geometry-affecting values
```

A biological label or short hash is not a cache identity. Names and colors may
vary without changing topology; endpoints and radii usually change geometry.

The compiler emits a typed-array structure of arrays for primitive endpoints,
radii, blend/material data, parent/semantic IDs, pose bindings, bounds, and
closed candidate programs. Runtime pose writes update those arrays or their
GPU storage pages without rebuilding geometry or node graphs.

## Field and blend contract

Implement the same formulas in the CPU verifier and TSL emitter.

For a tapered capsule from `a,ra` to `b,rb`:

```text
ba = b - a
t = |ba|^2 < eps^2 ? 0 : clamp(dot(p-a,ba)/|ba|^2, 0, 1)
q = p - a - t ba
d = |q| - lerp(ra, rb, t)
```

This lerped-radius value is exact Euclidean distance for `ra=rb`. With taper
slope `s=(rb-ra)/|ba|`, its interior gradient magnitude is
`sqrt(1+s^2)`; strong tapers require an exact round-cone distance or an explicit
error gate.

An explicit polynomial smooth-min node with width `k` is:

```text
h = clamp(0.5 + 0.5(d_a-d_b)/k, 0, 1)
d = mix(d_a, d_b, h) - k h(1-h)
grad = mix(grad_a, grad_b, h)
```

The pair is commutative but a fold over three or more inputs is not associative.
Therefore the authored blend tree and its per-node `k` are part of the
topology/compiler identity. Renaming or reordering part records cannot change
the field. A symmetric n-ary kernel is another branch only when its
multiplicity bias and omitted-tail error are bounded.

For the tapered-capsule interior, preserve the raw analytic derivative:

```text
radial = q / max(|q|, eps)
s = (rb-ra) / max(|ba|, eps)
grad_primitive = radial - s normalize(ba)
```

Caps use their radial derivative. Blend raw derivatives and normalize only the
final shading normal. Central differences remain a CPU parity probe with a
scale/precision-relative epsilon sweep; shader evaluation uses the fused
analytic derivative.

### Candidate programs

Repeated vertex evaluation may use a bounded candidate program, but it remains
an approximation to the full field. A program contains selected leaves, all
blend ancestors needed to preserve the authored graph, and a certificate for
every omitted sibling. Rest bounds may propose candidates; they are not the
acceptance proof.

For a polynomial tree, omit a sibling only when a conservative distance
interval proves the same saturated branch across the complete pose/morphology
envelope. For a log-sum-exp group, bound the omitted tail: if included and
omitted exponential sums are `A` and `B`, distance error is
`k log(1+B/A)`. Bound proximity-color weight independently because geometric
saturation does not bound material mixing; for linear RGB in `[0,1]`, the
Euclidean bound is `sqrt(3) B/(A+B)` when omitted distances cannot replace the
included minimum. Failed full-field sweeps enlarge or rebuild the candidate
program, or reject the tier.

This section is complete when CPU/TSL values and normals agree within declared
precision, part permutation/consistent renaming preserves the field, explicit
regrouping changes its signature, and every bounded program passes field,
normal, surface, and color error over the declared envelope.

## Reference surface and correction

For fixed connectivity, extract one oriented reference mesh per compatible
compiler/topology/geometry identity during load. Marching cubes, surface nets,
or dual contouring are choices with explicit ambiguity, weld, feature, and
resolution policies. Repair only defects covered by deterministic rules;
otherwise reject the surface.

The concatenated surface of individual capsule slots is diagnostic because
coincident or intersecting sheets do not form the manifold union. The shipping
surface must pass:

- zero inverted/collapsed faces from signed area or deformation Jacobian;
- zero non-adjacent self-intersections and duplicate/coincident coverage beyond
  the declared weld policy;
- minimum-angle and edge-quality tail gates;
- bidirectional mesh-to-field and field-to-mesh distance;
- normal-angle and projected silhouette error across the full envelope.

Create skin weights from semantic/geodesic or bounded-harmonic distance with
barriers where touching limbs would leak Euclidean influence. After pruning,
weights are finite, nonnegative, normalized, and within a measured influence
cap. Select linear-blend, dual-quaternion, or centre-of-rotation skinning from
bend/twist, volume, bulge, and joint-collapse sweeps.

Store a radial direction or angle in a Bishop/rotation-minimizing rest frame
along each semantic chain. Transport that frame with the rig. Selecting a new
helper axis from each posed direction creates discontinuous texture/detail
rotation.

Optional local field correction uses the raw gradient and a trust region:

```text
F = d(p) - iso
delta = clampLength(-F grad / dot(grad,grad), trustRadius)
```

Backtrack until residual decreases; reject gradient degeneracy, exhausted
trials, triangle inversion, or failed descent. Set trust radius and residual
from local edge/radius/curvature scale and projected error. Residual descent is
not topology proof, so the corrected envelope repeats the full mesh-validity
gates. On failure, retain the last proven skinned position or reject the
morphology/tier.

Surface work is complete when connectivity, weights, transported frames,
correction bounds, visible/depth/shadow positions, and mesh-validity evidence
all resolve the same geometry identity.

## Pose and locomotion

Determinism comes from a stable seed and injected simulation time. Closed-form
motion samples that time directly. Recurrent gait, springs, ropes, buoyancy, and
contact response advance on a fixed step owned either locally for a standalone
system or by the routed simulation stage. Keep immutable previous/current pose
states and interpolate only for presentation. Variable render `dt` never owns
recurrent creature state.

Pose order is explicit. A common order is morphology/squash, body-local rig,
support-relative IK, secondary chains, then one root transform at the instance.
Later writers may touch a slot only under a declared last-writer order. Update
the posed bound after final local slots and before visibility submission.

### Support-relative planted limbs

When support, water, air, gravity, or physical contacts participate, define a
handoff with units, frame/origin, sample instant or interval, cadence/phase,
producer/consumer/version, support/filter, validity/staleness/error, and
rate-versus-integrated meaning. A support sample additionally needs stable
support/feature identity, point and geometric normal, and represented point
velocity. Store a stance point in the support's local frame; reconstruct it
each step from the current support transform. A deforming support needs a named
material-coordinate extension.

For each fixed step:

1. batch required support probes at one sample instant/version;
2. form forward/side axes in the support tangent plane;
3. predict plant targets from body velocity relative to support point velocity;
4. convert target through the inverse root transform into creature-local space;
5. solve the limb and write creature-local slots;
6. update the posed bound and publish the new immutable pose state.

Two-bone IK with upper/lower lengths `l1,l2` and root-target distance `d` uses:

```text
d = clamp(d, |l1-l2|+eps, l1+l2-eps)
a = (l1^2-l2^2+d^2)/(2d)
h = sqrt(max(l1^2-a^2,0))
knee = hip + direction*a + orthonormalBendHint*h
```

Construct the bend hint with full 3D Gram-Schmidt. Gate relative segment-length
residual, reach classification, support-relative stance drift, normal/frame
discontinuities, and explicit replant behaviour. A kinematic support sample
does not imply a physical impulse; two-way contact belongs to the authoritative
solver named by the handoff.

### Other locomotion branches

- **Hopper/jumper:** fixed-step state machine with a dimensioned ballistic or
  explicitly styled flight curve; preserve volume under squash when claimed.
- **Flyer:** closed-form patrol is seekable; force-based flight consumes air
  velocity relative to body-point velocity and air density from one versioned
  forcing sample.
- **Rope appendage:** fixed-step Verlet positions, damping, bounded substeps,
  relaxation passes, root anchoring, and a declared write order after the base
  pose.
- **Swimmer:** consume distinct free-surface point/normal, geometric surface
  velocity, material current, depth, and density channels only when represented.
  A critically damped tracking state may use
  `eNew=(e+(v+omega*e)dt)exp(-omega dt)` and
  `vNew=(v-omega(v+omega*e)dt)exp(-omega dt)`. Force-based buoyancy instead
  passes a step-halving convergence gate.

Provider channels retain their support/filter, time, validity, error, and
version. Missing current is absence, not zero. Frame-critical GPU readback is
replaced by an analytic mirror, shared deterministic field, or batched service
with declared latency/error. One-way coupling returns no physical reaction;
two-way coupling sends source/reaction quantities through the routed owner.

Locomotion is complete when equal seed/tick/inputs reproduce pose, fixed-step
convergence and hitch tests pass, planted limbs remain support-relative,
required provider channels/errors are present, and visible/bounds/shadow state
uses the same accepted previous/current pose pair.

## Repeated populations and rendering

Share geometry only under compatible compiler/topology/geometry/tier identity.
Use fixed-capacity pages for local pose storage, root transforms, bounds,
stable identity, representation, and history generation. Allocate, recycle,
defer, or reject pages at controlled lifecycle boundaries rather than resizing
one live global buffer. Upload coalesced dirty ranges; static and closed-form
unchanged poses perform no recurrent integration or redundant upload. In r185,
pose records use `instancedArray()`/`storage()` nodes indexed by instance and
slot; the CPU `Float32Array` is a staging/backing store, not a persistently
mapped WebGPU buffer.

Shader loops are bounded by the actual part or candidate count. For corrected
vertices, count primitive evaluations as `(trials+1)*K`, plus separate color
or self-occlusion samples when enabled. Population cost includes visible and
submitted instances/pages, vertices, correction trials, skin influences,
shadow passes, output extent, dirty bytes, and peak live memory.

Use a shared ID/normal/depth edge pass for repeated outlines. A second
iso-offset body is a close hero branch whose duplicate deformation cost is
measured. Display and cast-shadow paths reuse the same local deformed position;
received shadows derive the correct world position. Decode authored sRGB color
once before linear storage; one scene pipeline owns tone mapping and output
conversion.

Boot compiles reference meshes, weights, candidates, page layouts, and every
shipping display/depth/shadow/output variant before first visibility. Spawn is
validation plus an O(active-slots) write. Disposal releases pages, geometry,
materials, pipelines, and recurrent state owned by the system.

## Completion evidence

Inspect field/normal/candidate diagnostics, extracted topology, skin weights,
radial frames, correction residual and inversion views, locomotion contacts,
posed bounds, visible/shadow/depth parity, page occupancy, LOD transitions, and
final/no-post output. Exercise seed replay, tick seek versus stepping, pose and
morphology envelopes, frame hitches, moving/sloped support, provider absence or
discontinuity, spawn/death/teleport/reparent/slot reuse, resize, and disposal.

Report geometry and field counts, CPU/TSL parity error, bidirectional surface
error, drift and IK residuals, dirty upload bytes, visible/submitted work,
whole-frame and paired-marginal CPU/GPU p50/p95, peak live bytes, and first-
visible pipeline events. Completion requires every selected representation,
rig/locomotion, population, output, reset, and lifecycle gate to pass; an
unselected branch carries no mandatory payload.
