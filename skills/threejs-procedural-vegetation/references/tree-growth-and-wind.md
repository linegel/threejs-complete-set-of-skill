# Structured Tree Growth And Wind

Read this reference when a vegetation branch needs generated trunks, branches,
roots, foliage, or hierarchical wind. It describes reusable geometry and state
contracts; species-specific dimensions remain authored data.

## Contents

- Species data
- Growth compiler
- Radius and junctions
- Bark coordinates and foliage
- Hierarchical wind
- Population and lifecycle
- Completion evidence

## Species data

Define a table for every growth level:

```text
length and variance
base radius or parent-radius factor
taper law
section and radial resolution
lateral child count and emergence interval
emergence angle, azimuth policy, twist, curvature and tropism
continuation policy
leaf/root policy
```

Species identity lives in this table and in its branching rules. A seed varies
declared ranges without changing the species, topology policy, material slots,
or stable semantic IDs. Units and characteristic scale are explicit.

## Growth compiler

Compile once on the CPU or a worker. Use an iterative queue so level, branch,
vertex, and leaf budgets remain inspectable:

1. Seed the trunk/root jobs with stable branch IDs and a declared root frame.
2. Advance each branch by arc length, updating a rotation-minimizing quaternion
   frame from curvature/tropism and applying authored twist separately.
3. Emit oriented rings with one intentional UV seam and accumulate arc length.
4. Create lateral children from stratified longitudinal slots and an
   independently permuted angular sequence.
5. Create the declared terminal continuation from the parent tip.
6. Enforce the junction/allometry rule before enqueuing descendants.
7. Generate foliage after branch topology and stable branch frames are final.

The compiler is complete when every queued branch terminates, all topology
budgets and allometry constraints pass, stable IDs are unique, and emitted
buffers contain finite positions, normals, tangents, UVs, and indices.

Parallel transport avoids the visible helices and helper-axis flips produced by
reselecting a local up vector each section. Re-orthonormalize after transport,
bound curvature change by arc length and local radius, and record any frame
reset at a true geometric discontinuity.

## Radius and junctions

Use a species-calibrated pipe/allometry constraint:

```text
r_parent^p >= r_continuation^p + sum_i r_lateral_i^p
```

`p` and any tolerance are authored or measured for the species. Rescale or
reject descendants that violate the rule; hidden overlap does not repair an
impossible radius budget. Admit finite `p>0` and nonnegative radii and evaluate
the parent radius at the actual junction, not the wider trunk base. Bound queue
expansion and output capacity before allocating or enqueuing each generation.

For a close branch, cut the child tube at the parent surface and stitch a
collar/zipper patch, or extract the local junction implicitly during load. A
mid/far overlap may be used only after hidden caps/internal faces are removed
and projected seam error passes. Classify that representation as overlapping
shells rather than a watertight union; removing hidden caps does not stitch a
junction. For a claimed continuous trunk/branch union, gate watertightness,
signed triangle area, self-intersection, normal continuity, and UV continuity
at every junction.

## Bark coordinates

Use accumulated branch arc length for `v` and circumference for `u`, with a
stable seam and declared texel density. Radius changes must not silently change
longitudinal texture scale. Child branches define their own seam orientation
from the inherited frame so seed changes cannot make isolated UV flips.

## Foliage

Leaves are generated from stable branch attachment IDs. Store leaf root, card
basis, size, bend phase, alpha cutoff, and material/variant identity. A crossed
card rotates both geometry and every normal term into its own basis.

For rounded card lighting, combine dimensionless directions, for example:

```text
n = normalize(n_card + beta * (p - leaf_origin) / leaf_length)
```

Admit finite positive leaf length and use one common card frame for the unit
normal and offset. Reject or use the undeformed normal when their sum is
ill-conditioned before normalization. Gate scale invariance, view rotation,
and front/back lighting. Leaf roots remain
fixed relative to their moving parent attachment; they inherit parent pose
once. Only the plant root stays at its ground/support anchor. The leaf's own
additional bend is zero at its attachment, not at a frozen world position.
Normals follow the complete nonsingular posed transform/Jacobian; rotating
only a card basis does not handle nonuniform deformation. Dense canopies use
instanced cards or clusters after matching the close silhouette, porosity, and alpha-coverage contract.

## Hierarchical wind

Air velocity is an input; vegetation owns the structural response. Distinguish
instantaneous air motion from any static exposure field used during placement.
Use the smallest response that preserves the requested observable:

| Observable | Response |
| --- | --- |
| distant phase motion | analytic root-weighted bend |
| grass/leaf gusts | analytic bend plus higher-band flutter |
| visible trunk/branch lag | damped hierarchy modes |
| stress, loading, or breakage | explicit structural solver with force and material evidence |

A reduced branch mode may use:

```text
q_j'' + 2 zeta_j omega_j q_j' + omega_j^2 q_j = b_j dot F_external
```

State the units of generalized position and force coupling, integrator, stable
step/substep bound, and truncation error. `omega_j` is angular frequency, not
cycles per second; mass-normalized coupling contains the inverse modal mass.
A quality change must preserve or explicitly project displacement and velocity,
not silently reset the modal state.
When physical drag is claimed, consume air density and relative velocity and
derive `F = 0.5 rho C_D A |u_rel| u_rel`, with finite nonnegative density, drag
coefficient and projected area. Sample `u_rel` against material-point velocity,
including parent translation and rotation at that point; root velocity alone
does not supply it. Otherwise label the bend as an authored visual response.

Wind LOD collapses high modes before low modes and preserves displacement,
velocity, silhouette, bounds, and shadow error. Display and shadow paths use
the same deformation function and state version. Every representation expands
its bounds for maximum active bend.

## Population and lifecycle

One or a few trees may use compiled indexed buffers. Repeated compatible trees
share topology/material variants and store transform, crown tint, wind phase,
mode state, LOD, and impostor identity per instance or page. Runtime wind and
LOD loops allocate no object graphs.

Tree LOD progresses from geometry to cluster representation to a
world-up-constrained multi-azimuth or octahedral impostor. Add depth/normal
layers only when relighting or parallax error earns their memory. Transitions
use unjittered projected error, hysteresis/dwell, simultaneous memory
accounting, and a matched shadow proxy.

Creation, removal, teleport, seed/species change, page-slot reuse, topology
change, and LOD discontinuity reset motion/temporal history for the affected
stable IDs. Resize rebuilds screen-dependent resources while preserving
world-space growth state. Disposal releases geometry, materials, storage,
impostors, and structural state owned by the tree system.

## Completion evidence

Inspect branch levels, continuations, lateral slot IDs, frames, junctions, bark
UVs, leaf roots/bases/normals, deformation magnitude, swept bounds, shadow
parity, and LOD transitions. Report branch/leaf counts, compile time, buffer
bytes, submitted instances/pages, projected alpha coverage, and whole-frame
cost. The branch passes when:

- frame rotation is continuous except at declared resets;
- allometry and junction mesh-validity gates pass;
- bark texel density and foliage lighting remain stable under scale and view;
- roots stay anchored and display/shadow deformation agrees;
- LOD preserves species identity and stable instance IDs;
- fixed seed/species inputs reproduce topology and attachment IDs;
- lifecycle transitions release or reset every owned resource/state.
