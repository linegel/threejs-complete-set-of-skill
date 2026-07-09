# Creature Body Systems — build contract

Exact contract for spec-driven field-derived creatures on WebGPU/TSL:
schema, field math, rig compilation, locomotion, scale architecture, quality
ladder, lab contract, boot contract, and numeric gates. Treat every formula below as a
verifiable contract: it earns trust only through CPU/TSL parity tests,
deterministic lab captures, and numeric gates in this document.

Contents:

0. [Representation selection](#0-representation-selection)
1. [Spaces and conventions](#1-spaces-and-conventions)
2. [CharacterSpec schema](#2-characterspec-schema)
3. [Field contract (the parity law)](#3-field-contract-the-parity-law)
4. [Rig compiler](#4-rig-compiler)
5. [Reference surface and diagnostic shell](#5-reference-surface-and-diagnostic-shell)
6. [Locomotion library](#6-locomotion-library)
7. [Scale architecture](#7-scale-architecture)
8. [Surface-quality ladder](#8-surface-quality-ladder)
9. [Creature lab contract](#9-creature-lab-contract)
10. [Numeric gates](#10-numeric-gates)
11. [Boot, compile, and spawn contract](#11-boot-compile-and-spawn-contract)

## 0. Representation selection

The posed-primitive field is a generative source, not automatically the
shipping representation.

| Update/reuse regime | Shipping surface | Complexity and error contract |
| --- | --- | --- |
| pose changes; surface connectivity is fixed | one extracted reference mesh per compatible `{compilerSignature, topologySignature, geometryDigest}` + skinning | meshing is boot-only; gate topology, bidirectional error, weights, and deformation |
| field parameters change inside a proven fixed-connectivity envelope | the same reference mesh + skinning + bounded local field correction | `O(VK(S+1))` only on corrected vertices; gate Jacobians, residual, and candidate error over the envelope |
| components can merge/split or holes can open/close | budgeted dynamic extraction, otherwise unsupported | gate event topology, extraction cadence, temporal transition, and complete mesh validity |
| fixed morphology with visible joint blends | skinned mesh + one local field correction | bound only the correction neighbourhood and prove shadow/depth parity |
| high instance reuse | shared topology/material + pose storage | batch by compatible compiler/topology/geometry identity; measure dirty bytes and visible submission |
| small projected extent | simplified mesh or view-constrained impostor | gate silhouette error in pixels over the accepted view cone and transition dwell |

The concatenated per-slot capsule shell is a preview/diagnostic surface. After
snapping, adjacent slots can cover the same field patch with coincident or
intersecting sheets; per-vertex residual does not make that mesh manifold. The
default stable-connectivity surface is one extracted reference mesh per
compatible compiler, topology, and rest-geometry identity, skinned and
optionally corrected locally.

Use marching cubes for a simple smooth iso-surface baseline, surface nets for
lower vertex count, or dual contouring when preserving field features is part
of the error contract. None guarantees a useful animation mesh by itself:
repair or reject non-manifold components, orient the surface, create weights,
and compare both extracted-to-field and field-to-extracted distances. The
stable-connectivity path never remeshes at spawn or steady state. A declared
topology-changing path owns a separate dynamic-extraction cadence and budget;
without that path, the operation is unsupported.

Algorithm selection is explicit. For marching cubes, resolve ambiguous faces
and cells consistently (for example with an asymptotic-decider/MC33-class
policy) or topology can change with sampling orientation. Surface nets trade
vertex count for cell-scale feature rounding and still need triangle-quality
control. Dual contouring needs Hermite samples plus a rank-aware, regularized,
cell-constrained QEF; an unconstrained minimizer can leave its cell or amplify
ill-conditioned normals. The extraction grid/octree resolution, ambiguity
policy, weld policy, and any remesher are part of `compilerSignature`.
Use the shared
[projected-error contract](../../threejs-choose-skills/references/projected-error-contract.md)
for mesh density, correction acceptance, impostor transitions, and hysteresis.

## 1. Spaces and conventions

| Quantity | Space | Convention |
| --- | --- | --- |
| `PartSpec.a/b/offset/hip` | parent-local | Y-up, +Z forward, accumulated over parent anchors |
| compiled primitive endpoints | creature-local | identity rest frame, root at the declared rest-support origin |
| posed primitive endpoints | creature-local | root motion lives in the instance transform; world-space posed primitives forfeit instanced batching and per-instance culling |
| `RigPose.position/yaw/roll` | world | yaw 0 faces +Z; pose order: squash → roll → yaw → translate |
| field distance `d` | creature-local units | `d = 0` is the skin; `iso > 0` inflates (outline shells) |
| part colors | authored sRGB hex → linear floats before upload | data buffers are `NoColorSpace` |

Never let two of these spaces touch without naming the transform. The classic
silent failure is feeding world-space primitives to a local-space shell or
vice versa: the creature renders but breathes/slides against its own outline
and shadows.

## 2. CharacterSpec schema

```ts
interface CharacterSpec {
  name: string;
  seed?: number;          // seeded LCG for per-creature variation
  scale?: number;         // uniform world scale, default 1
  locomotion?: {
    type: 'none' | 'biped' | 'quadruped' | 'hexapod' | 'hopper' | 'flyer' | 'swimmer';
    speed?: number;       // cruise, world units/s
    stepLength?: number;  // legged: stride trigger distance
    stepHeight?: number;  // legged: swing arc apex
    hopLength?: number;   hopHeight?: number;      // hopper
    altitude?: number;    radius?: number;         // flyer patrol
    buoyancy?: number;    undulation?: number;     // swimmer
  };
  parts: PartSpec[];
  blend: BlendSpec;
}

type BlendRef = { part: string } | { node: string };
type BlendSpec =
  | {
      mode: 'tree';
      roots: BlendRef[];
      nodes: { id: string; left: BlendRef; right: BlendRef; k: number }[];
    }
  | {
      mode: 'symmetric-nary';
      roots: BlendRef[];
      groups: {
        id: string;
        members: BlendRef[];
        kernel: string;
        k: number;
      }[];
    };

interface PartSpec {
  id: string;             // unique, non-empty
  shape: 'capsule' | 'sphere' | 'cone' | 'rope' | 'leg';
  parent?: string;        // anchor accumulation over parent chain
  a?: [number, number, number]; b?: [number, number, number]; // capsule/cone
  offset?: [number, number, number];  // sphere center / rope root
  r?: number; r2?: number;            // radius, cone end radius
  k?: number;             // authoring hint for incident blend-node k
  kCap?: number;          // compiler cap for generated incident-node k
  color?: string;         // #rrggbb sRGB
  segments?: number; length?: number; taper?: number;  // rope
  hip?: [number, number, number]; upper?: number; lower?: number; phase?: number; // leg
  flap?: number;          // wing-beat amplitude, radians
}
```

Validation is one gate and every error names `part.field`. Enforce: unique
ids, known shapes and locomotion types, `#rrggbb` colors, positive numerics,
valid parent references, and requested locomotion leg count (biped=2,
quadruped=4, hexapod=6; flyers may carry tucked legs). Omitted/`none`
locomotion is valid for static figures, scientific illustrations, product
visuals, and externally posed bodies. Slot budget: reject specs
whose compiled slot count exceeds the configured topology/page-layout budget `maxParts`
(implementer-chosen schema cap, not a canonical constant) — `writePose` must
throw, not clamp.
Validate that every blend-tree reference resolves, the graph is acyclic, every
rendered part reaches exactly one declared root unless a union of roots is
explicit, and each tree node or n-ary group owns a finite positive `k`. For an n-ary
kernel, require permutation/rename invariance plus declared multiplicity bias,
support, and candidate-truncation bound. An id identifies a node; its lexical
order never defines field composition.

## 3. Field contract (the parity law)

One set of formulas, two implementations — a pure CPU sampler and the TSL
emitter. They are the SAME math and change in the SAME commit. Unit tests run
against the CPU twin; the shader inherits correctness through the contract.

Tapered capsule distance (spheres are zero-length capsules):

```
t = baLen2 < epsilonLength2 ? 0 : clamp(dot(p - a, b - a) / baLen2, 0, 1)
d = |p - a - (b - a) * t| - lerp(ra, rb, t)
```

Exactness bound: this lerp-radius form is the true distance only for
`ra = rb`. The exact round-cone surface is the tangent cone of the two end
spheres, not the lerp cone; with taper slope `s = (rb - ra)/|b - a|` the
implicit value has gradient magnitude `sqrt(1 + s²)` and therefore expands
first-order Euclidean distance magnitude by that factor (4.4% at
`|s| = 0.3`). Locally, signed distance is approximately
`d_lerp / sqrt(1 + s²)`. Accept only under the explicit field-error gate; for
stronger tapers use the exact round-cone distance with its tangency case split.

Pairwise polynomial smooth-min (Quilez) at an explicit blend-tree node, with
the node's symmetric `k = max(k_node, kFloor)`:

```
h = clamp(0.5 + 0.5 * (d_left - d_right) / k, 0, 1)
d = lerp(d_left, d_right, h) - k * h * (1 - h)
```

For a fixed `k`, the pair operator is commutative, but a fold over three or
more primitives is not associative. Therefore the explicit tree is part of the
authored field and compiler/topology signature; swapping either child is
invariant, but regrouping nodes is a different field. Sorting part ids merely
makes one accidental fold deterministic: renaming a part then changes the
geometry, so sorting is rejected. For an order-independent alternative, use a
validated symmetric n-ary kernel and record its surface bias with member count
and its candidate-tail bound. Do not call an unbounded log-sum-exp truncation
local without proving the omitted-tail error.

A concrete symmetric option for one group is stabilized log-sum-exp,
`d = m - k log Σ_i exp(-(d_i-m)/k)` with `m = min_i d_i`. Its gradient is
the normalized exponential-weighted sum of primitive gradients. Coincident N
members shift the field by `-k log N`; that multiplicity bias must be intended
or compensated in the authored iso value. If included and omitted exponential
sums are `A` and `B`, candidate truncation changes distance by exactly
`k log(1+B/A)`, which supplies a usable tail gate. The explicit polynomial tree
has compact pair support and authored grouping; log-sum-exp has permutation
invariance but global tails. Select between those properties, not by taste.

Analytic gradient, fused into the same loop — never ship 6-tap finite
differences in the shader:

```
q        = p - a - (b - a) * t
radial   = q / max(|q|, epsilonLength)
s        = (rb - ra) / max(|b - a|, epsilonLength) // taper slope; 0 for uniform capsules/spheres
gradPrim = radial - s * normalize(b - a)      // axial term only while 0 < t < 1; caps are radial-only
grad     = mix(grad, gradPrim_i, h)           // through each smin
```

The axial `-s·â` term is the gradient of the `-lerp(ra, rb, t)` taper and is
NOT optional for cones: dropping it tilts normals by `atan(s)` on every
tapered part and fails the CPU gradient gate for any `|s| > ~0.05`. In the
interior region `q ⊥ (b - a)`, so `|gradPrim| = sqrt(1 + s²)`. Preserve this
raw derivative through every blend node and Newton correction; normalizing each
primitive first destroys the stated smooth-min gradient and the Newton
`grad/|grad|²` step. Normalize only the final shading normal. If the approximate
distance rescale `d_lerp/sqrt(1+s²)` is adopted, rescale its gradient
consistently and revalidate cap transitions and blend-radius semantics; never
rescale the value or gradient alone.

For the polynomial smooth-min, `mix(gradA, gradB, h)` is the EXACT gradient
in the unclamped interior, not an approximation: with
`h = 0.5 + (d_A - d_B) / (2k)`, the cross terms
`(d_B - d_A)∇h - k(1 - 2h)∇h` cancel identically, and at saturation the mix
degenerates to the surviving branch. The only approximation in the normal
path is treating per-primitive cap/interior transitions as C¹, which the
clamp on `t` makes piecewise-exact. Keep the 6-tap central difference only as a
CPU verification tap. Do not freeze `GRAD_EPS` in world units: for numeric
precision `epsilon_machine` and local scale
`ell = max(L, localRadius, |p|)` start near
`h = cbrt(epsilon_machine) * ell`, then sweep powers of two above and below it.
Reject taps that do not move the represented coordinate or cross a known field
nondifferentiability; require an angular/magnitude-error plateau across the
sweep. Run the sweep separately for the CPU precision and shader-equivalent
f32 arithmetic.

Proximity color kernel (softmax over the candidate set):

```
w_i   = exp(-max(d_i - d_min, 0) / max(k_i, kFloor))
color = Σ w_i * c_i / max(Σ w_i, weightFloor)
```

Geometry saturation does not bound this color kernel. For included weight sum
`A` and a conservative omitted sum bound `B`, each linear-RGB component changes
by at most `B/(A+B)` because colors lie in `[0,1]`; the Euclidean RGB bound is
`sqrt(3)B/(A+B)`. This bound is valid only when omitted-distance intervals prove
they cannot replace the included `d_min`; otherwise include that primitive.
Candidate compilation records this weight bound and also gates full-graph
perceptual color error (for example OKLab Delta E) over the envelope.

Newton correction onto `d = iso`, trust-region bounded and residual-aware.
Cache accepted samples; every trial, including a rejected backtrack, consumes
one field query and decrements the common trial budget:

```
sample = field(p)
trials = 0
while trials < maxTrials:
  F, grad = sample.d - iso, sample.grad
  if abs(F) <= residualTolerance: break
  if dot(grad, grad) <= gradientFloor: reject
  delta = clampLength(-F * grad / dot(grad, grad), trustRadius)
  alpha = 1
  accepted = false
  while alpha >= alphaMin and trials < maxTrials:
    trial = p + alpha * delta
    trialSample = field(trial)
    trials += 1
    if abs(trialSample.d - iso) < abs(F):
      p, sample, accepted = trial, trialSample, true
      break
    alpha *= 0.5
  if not accepted: reject
```

This is the true first-order step `Δp = -(d - iso)·∇d/|∇d|²`. The common
`/|∇d|` variant implicitly assumes `|∇d| = 1`; in blend regions `|∇s| < 1`,
so it undershoots and spends the second iteration finishing the first one's
work. Dividing by `|∇d|²` restores the full Newton step there; the clamp
bounds the move where `|∇d| → 0` near the medial axis. Set `trustRadius` from
local reference edge length, primitive radius, and a curvature bound; it is not
a global multiple copied across meshes. Backtracking provides descent, not
topology safety: the accepted correction envelope must separately pass signed
area/Jacobian, inversion, self-intersection, duplicate-coverage, and minimum-
angle gates. On failure, keep the last proven reference/skinned position or
reject the morphology/tier.

## 4. Rig compiler

- Slot allocation: capsule/cone/sphere → 1 slot; rope → `segments` slots;
  leg → 2 slots (upper, lower). Primitive record: `a.xyz, ra | b.xyz, rb |
  k, r, g, b` (12 floats).
- Anchors accumulate over parent chains in parent-local space; `scale`
  multiplies every length and radius; defaults: color `[0.85, 0.72, 0.5]`,
  authored part hint `k = r * 0.6`; compile hints into explicit blend-node
  values before field evaluation. The floor follows the scale/precision
  contract in §5.
- `bodyLift = max over legs((upper + lower) * 0.92 - hip.y)` keeps knees bent.
- Pose transform, in order: volume-preserving squash about the declared rest-support plane
  (`y *= squash`, `xz *= 1/sqrt(max(squash, 0.05))`), roll, yaw, translate
  (+ `bodyLift * min(squash, 1)` vertical).
- Compile the declared blend graph to an evaluation DAG. A per-vertex
  candidate program includes selected leaves, every internal ancestor needed
  to reach the declared root with the same per-node `k`, and a certificate for
  every omitted sibling. A polynomial-tree sibling may be omitted only when a
  conservative distance interval proves the parent stays on the same saturated
  branch over the vertex's complete motion/morphology envelope. A symmetric
  n-ary group instead carries the `k log(1+B/A)` tail bound from §3. Never take
  K nearby leaves and fold them in a new order. Expanded rest AABBs may propose
  leaves. Independently bound omitted proximity-color weight as specified in
  §3; field saturation is not a color certificate. Envelope proofs and the
  full-graph sweep in §10 supply acceptance. If
  the bound fails, enlarge the candidate program, rebuild, or reject the tier.
- Separate cache identities. `compilerSignature` includes schema/compiler,
  field kernel, extraction algorithm/settings, numeric mode, and material
  layout. `topologySignature` includes extracted connectivity, blend graph,
  slot classes, skin-influence layout, tier, and transported-frame layout.
  `geometryDigest` covers rest-pose geometry-affecting values. Names and colors
  do not affect topology; radii/endpoints usually affect the geometry digest.
  A bare 32-bit spec hash is never an identity. Only the immutable unit
  primitive preview template is global; extracted connectivity, preview-shell
  mapping, candidates, weights, and radial frames are signature-specific.

## 5. Reference surface and diagnostic shell

The shipping default is one field-extracted reference mesh per compatible
`{compilerSignature, topologySignature, geometryDigest}`. Extraction returns oriented connected components
under an explicit component policy; repair only defects covered by a
deterministic rule, otherwise reject. The following per-slot capsule is a
diagnostic preview reconstructed in the vertex stage (`aPart` selects the slot,
`aAxial` marks cap progression). It is useful for field and candidate
visualization, but concatenating slots cannot establish a manifold union:

| Tier | radialSegments | capRings | verts/slot `(2+2c)r+2` | tris/slot `r(4+4c)` |
| --- | ---: | ---: | ---: | ---: |
| hero | 12 | 3 | 98 | 192 |
| repeated | 10 | 2 | 62 | 120 |
| distant | 8 | 2 | 50 | 96 |

For both reference and preview meshes, store the rest radial direction or
`aTheta` in a stable local basis. Build a Bishop/rotation-minimizing frame along
each semantic chain, initialize it from a declared rest vector, and transport
it with the rig transform before re-orthonormalizing. Never reselect a helper
axis from the current posed direction: its branch discontinuity rotates radial
coordinates and procedural detail.

Orient preview winding outward on the CPU against the unit template. For the
reference mesh and every sampled pose/morphology, gate:

- signed triangle area and deformation Jacobian relative to rest; zero
  inverted or collapsed faces;
- zero non-adjacent self-intersections and zero duplicate/coincident surface
  coverage beyond the declared weld tolerance;
- minimum angle/edge-quality distributions, including the tail rather than
  only a mean;
- bidirectional Hausdorff distance (mesh→field and field→mesh), normal-angle
  error, and projected silhouette error.

A small field residual alone cannot pass this section.

Compute orientation/Jacobian in each rest triangle's tangent basis, not from an
unsigned area magnitude. Detect self-intersections with a BVH broad phase and a
scale-aware robust triangle predicate, excluding only true topological
neighbours. Detect duplicate coverage separately with a weld/spatial index;
intersection tests alone miss coincident sheets. For Hausdorff evidence, use
adaptive surface sampling or conservative cell/triangle bounds in both
directions and publish the sampling tolerance. Vertex-only mesh→field samples
and extraction-grid points alone are lower bounds on the maximum error.

### Skin-weight and deformation contract

Seed handles from the semantic rig, then compute weights on the reference
surface. Use geodesic distances or bounded harmonic/biharmonic weights with
Dirichlet handles and explicit barriers across contacts where Euclidean
proximity would leak weight between limbs. Enforce finite, nonnegative weights,
partition of unity, a measured maximum influence count, and renormalization
after pruning. Choose the influence cap from deformation error and storage
cost; it is not a universal constant.

Use linear-blend skinning only when its bend/twist sweep passes signed-volume,
cross-section radius, joint-collapse, and normal-continuity gates. Use
dual-quaternion skinning for large rigid rotations when its bulge and
antipodality handling pass, or center-of-rotation skinning when joint-local
rotation centres justify its precomputation/storage. Record the selected method
in the compiler signature; changing it invalidates cached deformation evidence.

`epsilonLength`, `kFloor`, `weightFloor`, `gradientFloor`, and the Newton
residual are derived from characteristic scale, numeric precision, and the
projected-error gate. Record them with the compiler signature and sweep them in
the lab; fixed world-unit magic constants are not portable across microscopic,
architectural, and planetary scenes.

## 6. Locomotion library

All deterministic: seeded LCG + injected sim clock. Run on a fixed-step
accumulator (clamp input dt, e.g. accumulate ≤ 0.25 s; step at 1/60; keep
previous+current pose; render interpolated). Variable render dt straight into
gait/hop is a known visual bug: one hitch completes half a swing in one frame.

### Environment-query boundary

The creature compiler and locomotion system do not own terrain, coastline,
bathymetry, vegetation, or fluid state. They consume explicit providers from
the world-generation/data layer. Keep three semantics separate:

```text
queryHabitat(worldPoint, tick) -> {
  validity, fieldVersion, sourceResolution, errorBound,
  signedCoastDistance, waterColumnDepth, slope,
  substrateIdOrWeights, moisture, exposure, domainChannels...
}

querySupport(worldProbe, tick) -> {
  point, normal, frameId, supportCoord, worldFromSupport,
  velocityAtPoint, angularVelocity, validity, errorBound
}

queryWaterState(worldPoint, timeSeconds, footprint) -> {
  surfacePoint, surfaceNormal, surfacePointVelocity,
  materialCurrentVelocity, waterDepth,
  representedFootprint, frameId, validity, errorBound, fieldVersion
}
```

The consumer declares which habitat channels and units it requires; unspecified
domain channels are absent, not zero. `queryHabitat` is for deterministic
placement, route selection, and behavior policy. `querySupport` owns contact
geometry and moving-frame kinematics. `queryWaterState` owns the instantaneous
free-surface sample. A field revision invalidates cached placements/routes
through an explicit policy; render-patch LOD and material-detail changes must
not move a physical habitat boundary.

`surfacePointVelocity` is the time derivative of the sampled geometric surface
point under the provider's parameterization. `materialCurrentVelocity` is
Eulerian/Lagrangian fluid transport as declared by the water model. Wave phase
velocity, group velocity, vertical `partial(eta)/partial(t)`, and material
current are not interchangeable. A simple visual-float tier may omit current,
but must mark it `not used`; a behavior or force model requiring current is
blocked when that channel is unavailable.

The water footprint is set by the body/contact response scale. Its normal is a
filtered physical free-surface normal, never a material/shading normal; otherwise
micro-normal detail can inject macroscopic roll and steering.

Providers may use an analytic CPU mirror, a deterministic shared field, or a
batched asynchronous query service with a declared latency contract. They may
not perform frame-critical GPU readback. Placement and locomotion acceptance
include provider spatial/temporal error; a precise IK solve against an
under-resolved coast or water sample is not precise world coupling.

Legged locomotion consumes
`querySupport(worldProbe, tick) -> {point, normal, frameId, supportCoord,
worldFromSupport, velocityAtPoint, angularVelocity}`. The query may represent terrain, a sloped
architectural surface, a translating/rotating platform, or another declared
support. Its normal is normalized; `velocityAtPoint` already includes the
rigid-frame `omega × r` contribution when applicable. A stance stores
`(frameId, supportCoord)`; each tick reconstructs the world plant through the
provider's current support map (a rigid provider may use `worldFromSupport`),
so zero drift is measured relative to the moving support rather than absolute
world coordinates. Loss of
support, discontinuous normals, and frame changes use explicit replant rules.

**Reactive planted gait** (2/4/6 legs, one system): feet are support-planted;
a foot lifts when it lags its queried home by more than `stepLength` and its
phase group is active. Project the hip probe along the declared gravity
direction onto the support, construct forward/side axes in the local tangent
plane, and form swing height along the support normal. Landing prediction uses
body velocity relative to `velocityAtPoint`; do not add `omega × r` again.
Authored starting values may use a swing arc
`sin(π t) * stepHeight` and forward overshoot, but they are not flat-ground
assumptions. Rescale authored timing and speed by dynamic similarity — swing time
`∝ sqrt(L/g)` (pendulum period), and keep the Froude number `v²/(gL) ≲ 1`:
above it real animals stop walking, and a planted gait reads wrong. Gate
platform-relative stance drift over the complete stance interval, normalized
by leg length and above the declared numeric precision floor; also assert that
a biped never lifts both feet unless the authored gait explicitly includes a
flight phase.

Foot solve and storage chain: support-coordinate plant → support query/map →
world contact target → inverse root instance transform → body-frame IK
target → body-frame IK solve → creature-local upper/lower leg slots →
contiguous storage upload →
posed-AABB culling-bounds update. The root transform is applied exactly once,
by the object/instance matrix after creature-local SoA upload; `rootTransformSingleApplication`
checks that no slot endpoint already contains root translation or root yaw.

**2-bone IK**: clamp reach to
`[|l1-l2|+epsL, l1+l2-epsL]`, where `epsL` is derived from characteristic
limb length and numeric precision rather than a fixed world-unit epsilon;
`a = (l1² - l2² + d²) / 2d`, `h = sqrt(max(l1² - a², 0))`; bend hint points
sideways-out + 0.4 forward in the body frame, made perpendicular to hip→foot
by full 3D Gram-Schmidt. Derived: with a fully orthogonalized unit hint, the
joint at `hip + dir·a + perp·h` reconstructs both limb lengths EXACTLY
(`a² + h² = l1²`; `(d−a)² + h² = l2²` algebraically), so residual error is
f32/f64 rounding only. A partial Gram-Schmidt that drops the Y term leaves a
non-perpendicular component and corrupts lengths in proportion to the omitted
component. Gate relative length residual across scale and precision sweeps;
decimal-string equality and one fixture's absolute threshold are not valid
contracts.

`gWorld` has units of world-length/s². If one world unit is one metre, physical
Earth gravity is `9.81` regardless of the creature's model scale. For a
geometrically similar body scaled by `lambda` under the same gravity, dynamic
similarity gives `time' = sqrt(lambda) time` and
`speed' = sqrt(lambda) speed`; multiplying gravity by `lambda` while keeping
time fixed is an authored time remapping, not physical scaling.

**Hopper**: state machine `idle → crouch → air → land`. Physics: air height
is the normalized ballistic parabola `4 t (1 - t) * hopHeight` (`t ∈ [0,1]`;
it also matches launch/landing velocity ratios, which `sin(π t)` does not),
and physical `airDuration = 2 sqrt(2 hopHeight / gWorld)`. A minimum duration
or altered parabola is styling and must be labeled as such. Example styling
constants: `crouchTime 0.16`,
`landTime 0.14`, idle `0.6–2.2 s`; squash: idle `1 + 0.015 sin(6t)`, crouch
`lerp(1, 0.72, t)`, air `1 + 0.28 cos²(π t) * (t < 0.5 ? 1 : 0.6)`, land
`lerp(0.78, 1, t)`. Squash is volume-preserving via the rig transform.

**Flyer**: closed-form patrol — position on a circle + bob from
`a = phase + simTime * angularSpeed`; yaw follows the tangent; bank
`sign * min(0.5, speed * 0.35)`; flap phase
`phase * 3 + simTime * (4.5 + 2|angularSpeed|) * π`. Sampled, not integrated:
seekable to any time for deterministic capture.

**Verlet ropes** (tails, ears): fixed step 1/60, authored gravity 3.5 and damping keep
`1 - 0.12`, 3 relaxation passes, ≤ 8 substeps per update, dt accumulation
capped at 0.25 s. `3.5` is a slow-motion styling value; a physical model uses
the same `gWorld` convention above, not `9.81 * creatureScale`. Anchor follows
the posed body; taper radius toward the tip.
Per fixed step, write order is: base body pose writes rest slots after
volume-preserving squash staging; root yaw/translation remain in the instance
transform and are not baked into SoA endpoints; body-frame IK writes leg slots
from planted targets; rope-verlet then writes its consecutive `a.xyz|b.xyz`
segment slots from the final particle chain. If stages target the same slot,
the later stage wins; rope-verlet slot cost is
`ropeSubsteps * ropeRelaxationPasses * ropeSegments`, not O(slots).

**Swimmer**: buoyancy response targets the injected water-state contract above;
legacy scalar providers may expose
`getWaterSurface(x, z, t) -> {height, normal, surfacePointVelocity?}` only for
tiers that explicitly omit material current and depth. Do not call a
first-order lerp a spring. For a critically damped vertical response with
piecewise-constant target per fixed step, `e = y-h`, `c = v+omega*e`, then
`eNew = (e+c*dt)*exp(-omega*dt)` and
`vNew = (v-omega*c*dt)*exp(-omega*dt)`; choose `omega` from a declared settling
time. A force-based buoyancy model instead integrates dimensioned acceleration
at fixed step and must pass a step-halving convergence test. Body undulation
and roll derive from the same simulation phase. The injected provider is a
water-skill contract, not a creature-side sampler. Open seas use
`threejs-spectral-ocean/examples/webgpu-fft-ocean/createCpuWaterHeightSampler()`,
which evaluates a dominant-bin truncation of the same authored FFT spectrum and
publishes `estimateTruncationError()`. Bounded pools use
`threejs-water-optics/examples/webgpu-bounded-water/createBoundedWaterHeightQuery()`,
which evaluates the exact authored analytic wave list and declares the live
StorageTexture heightfield residual as a separate budget. The provider owns the
parity-error obligation; creature locomotion treats the query as authoritative
and does not blend in asynchronous GPU readback. Gate normalized surface
tracking error, phase lag, normal error, and, when consumed, material-current
error across the declared wave-frequency/current band and fixed-step
convergence sweep.

## 7. Scale architecture

- **Share by mesh identity, not label.** One geometry may serve bodies only
  under compatible `{compilerSignature, topologySignature, geometryDigest,
  tier}`. A material may span geometry digests only when primitive layout,
  candidate indexing, skin representation, and graph/storage layout match.
  Pose lives in a storage buffer:
  `struct Prim { vec4 a; vec4 b; vec4 meta; }` indexed
  `instanceIndex * maxParts + slot`, via `instancedArray()`/`storage()` nodes
  (verify exact r185 API in installed source — `apiProof` per router). The
  rig writes into a CPU `Float32Array` backing/staging store; this is not a
  persistently mapped WebGPU buffer. Upload coalesced dirty ranges through the
  Three.js storage-attribute update mechanism and report bytes/frame. Partition
  instances into fixed-capacity topology/tier pages, each bound to one
  compatible geometry identity.
  Overflow allocates or recycles another page at a controlled boundary, or is
  deferred/rejected by policy; never resize one global population buffer and
  rebuild every binding mid-frame. For very large fully recurrent populations, compare a
  GPU-resident pose solver only when the state remains on GPU and avoids more
  upload/synchronization than it adds.
- **Bounded evaluation.** Loop over the candidate set (or at minimum a
  dynamic loop bounded by the actual part count `P`), never a masked
  compile-time unroll over the full budget. A K-leaf candidate program preserves
  the explicit blend-tree ancestry and omitted-sibling certificates from §3; it is accepted only
  by the complete-graph envelope gate, so failed sweeps reject the spec/tier or
  enlarge/rebuild that program. **Vertex field cost model** (count
  fused `d, grad` capsule evaluations per corrected vertex):

  | Symbol | Meaning |
  | --- | --- |
  | `P` | compiled primitive count for the spec (`≤ maxParts`) |
  | `K` | \|candidate set\| for the vertex (`≤` tier cap in §5) |
  | `S` | correction trial field evaluations after the initial query, including rejected backtracking trials |
  | `R` | self-occlusion offset samples along the final normal |

  Masked full-budget path (forbidden):

  ```
  E_mask(FD) = (S + 1) · 7P
  ```

  Candidate-set path (mandated):

  ```
  E_snap  = (S + 1)K
  E_color ∈ {0, K}     // reuse final primitive distances, or evaluate once
  E_AO    = RK           // R independent offset queries
  E_total = E_snap + E_color + E_AO
  ```

  ALU ratio at equal `S` (analytic good path vs FD masked path):

  ```
  E_mask(FD) / E_snap(analytic) = 7P/K
  ```

  Plug in `P`, `K`, `S` from the spec and tier table — not from any external
  project's constants. Frame ms and page capacities are lab measurements (§9),
  never asserted here.
- **Culling.** Root motion lives in the instance matrix. Static and analytic
  motions use a conservative precomputed envelope when tighter per-step bounds
  cannot change visibility; independently deforming/dirty instances refit a
  local bound from final SoA primitive AABBs, then transform it with the same
  instance matrix that renders the body. Spatial pages reject groups first;
  compact visible instances only when that compaction reduces submitted work.
  Compare CPU page/instance culling with GPU compaction on the target adapter;
  a vertex-shader visibility mask does not reduce submission or vertex work.
- **Material variants.** Cache by
  `{compilerSignature, topologySignature, shadingModel, tier, outline,
  debugMode, K}`. Ramp bands, outline width, sun direction, tint, and scalar
  visualization ranges are uniforms — changing
  them must not rebuild node graphs or instances.
- **Outline.** Repeated populations: creature-ID + normal/depth edge detection as one post
  pass over the population. Hero: iso-offset back-face hull
  (`iso = outlineWidth`) as a second material — accept that it re-runs the
  snap, and strip color/AO work from its graph.
- **Shadow parity and spaces.** The depth/shadow path must consume the same
  snapped position function as the display material. In r185 `positionNode`
  and `castShadowPositionNode` are local-space positions;
  `receivedShadowPositionNode` is world-space. Reuse the local snapped node for
  display/casting, but normally leave the received-shadow override unset so
  `positionWorld` derives from the displaced vertex. Never assign the local
  node to the world-space receiver hook. Render a posed body and compare the
  visible silhouette, shadow-map footprint, and received-shadow lookup in the
  lab.
- **Debug modes** are build-time material variants (`off | unsnapped |
  distance | weights | normals`): unsnapped shows the pre-snap shell;
  distance heat-maps `|d|` at the surface; weights shows blended albedo;
  normals shows `n * 0.5 + 0.5`. Each is an observable checkpoint in the
  build order: unsnapped must look like posed capsules; distance must be
  near-zero (dark) everywhere after snap; normals must be smooth across
  blends.

## 8. Surface-quality ladder

Ordered; each rung is optional per tier, and low tiers stop early:

1. **Analytic gradient normals** across blends (baseline — FD normals across
   12-segment tessellation shade as flat patches).
2. **SDF self-occlusion approximation**:
   `ao = clamp(1 - k_ao · Σ_i 2^{-i} · max(r_i - d(p + n·r_i), 0) / r_i, 0, 1)`
   over 3–5 exponentially spaced radii along the normal, `k_ao ≈ 1`. The
   `/r_i` makes each occlusion term dimensionless, so `k_ao` survives
   body rescale. This samples only the creature field: it can darken limb
   joins, but it cannot produce ground contact. Use the shared scene AO/shadow
   contract for external contact; do not substitute an uncalibrated blob.
3. **Scene-light integration**: the selected BRDF, illustrative ramp, or
   scientific palette owns a declared lighting policy. When lighting is used,
   integrate received shadow/contact terms; a body that ignores the scene's
   light transport reads composited rather than present.
4. **Stable surface coordinates** (semantic owner, axial `t`, transported
   radial `theta`) → procedural detail fields in creature space: fur/scale banding, wear,
   counter-shading gradients, per-part roughness/ramp identity. Author via
   `$threejs-procedural-fields` patterns.
5. **Eyes and face as authored meshes** parented to head slots: separate
   small geometry with blink/look-at controls and its own material. Smooth
   field-derived body skins do not do eyes well; do not force them to.
6. **Secondary motion**: verlet ropes for tails/ears (§6), squash
   states, flap phases; add per-part jiggle springs driven by pose
   acceleration for fleshy creatures.
7. **Reference mesh plus correction**: the stable-topology default is the
   field-extracted rest mesh from §5, semantic/geodesic or bounded-harmonic
   weights, and only the local correction count justified by projected error.
   The control rig, locomotion, and spec pipeline are unchanged.

Ceiling honesty: photoreal humans, cloth, and production animation libraries
still belong to imported skinned assets. This ladder targets stylized
creatures, fauna, generated figures, and illustrative subjects. It can match
or beat a low-poly skinned representation only when the measured morphology,
joint-continuity, and workload contract says so.

## 9. Creature lab contract

A standalone lab app (strict dev port, package-source aliases, zero app
imports) is the proving ground; the shipping scene stays a thin adapter.

- **Deterministic driver**: integer simulation ticks are authoritative;
  `seekTick(n)` and `stepTicks(n)` must produce the same state hash. Seconds are
  converted once using an explicit rounding policy. Do not require exact
  equality between independently accumulated floating-point seconds.
- **Programmatic API** (`window.__lab`): telemetry snapshot (rig slots,
  bodyLift, geometry stats, per-creature driver state, camera, renderer,
  last-frame ms), focus/tier/debug/toon controls, spec JSON editor with
  `part.field` errors, seeded generation grid, `renderOnce`, `dispose`.
- **Evidence metrics**: foot-drift markers (local-solver, world-space, and
  platform-relative displacement over a stance, each normalized by leg
  length), snap residual and pixel-error sweeps across a locomotion
  cycle, seed sweeps for generated specs, tier switcher screenshots, hop apex
  sampling (step the clock to the exact apex — temporal gaps are where QA lies).
- **Epsilon sweep**: run analytic-vs-central-gradient and Newton residual tests
  over scale/precision-relative powers-of-two perturbations. Record the stable
  error plateau, representability failures, and nondifferentiable samples; a
  single hard-coded `GRAD_EPS` result is not evidence.
- Lab evidence proves the package, never the shipping scene: keep the claim
  boundary explicit in the lab README.

Wire evidence bundles per `$threejs-visual-validation`.

## 10. Numeric gates

Pending gate: the lab that executes this table is under construction in-tree
(`examples/webgpu-procedural-creature-lab`; `HANDOFF.md` §3 item 3.9e — the
register's one open item). Until its full gate table runs green and that run
is recorded in `HANDOFF.md` §6, none of these rows may be cited as passed
evidence. CPU-derivable rows (smin, gradient, taper) are additionally checked
by the settled-math derivations in §2–§4.

Every threshold below is either an analytic invariant or a product/fixture
gate. Store `{value, unit, status: Derived|Gated|Measured|Authored, source,
context}` with the result; an authored threshold is not passed evidence.
Let `L` be the declared characteristic body length and `e_px` the projected
screen-space error computed from camera projection and nearest support depth by
the shared projected-error contract linked in §0.

| Gate | Contract |
| --- | --- |
| polynomial smooth-min | Derived: `min(a,b)-k/4 <= smin(a,b,k) <= min(a,b)`, fixed-node-`k` pair symmetry, and finite-difference C1 checks away from clamp transitions |
| blend-graph invariance | Identical field samples and compiled graph under part-array permutation and consistent id renaming; explicit regrouping must change the topology signature; n-ary kernels also gate multiplicity bias and candidate-tail error |
| thin-part blend containment (`kCap`) | Gated normalized surface deviation `|delta d|/L` over the declared pose envelope |
| primitive gradient | Derived raw magnitude `sqrt(1+s²)` in the taper interior; normalized shading normal has unit magnitude within numerical tolerance |
| analytic vs central-difference gradient | Gated angular error and relative magnitude error over stratified cap/interior/blend samples and a precision/scale-relative epsilon sweep with an error plateau |
| snap residual | Gated `|d-iso|/L` and `e_px`; the tier must satisfy both world-relative and projected limits |
| Newton safeguard | Trust radius from local edge/radius/curvature scale; record clamp and backtrack counts, gradient-floor rejects, failed descent, and final residual |
| reference-mesh validity | Zero inversions/collapses, zero non-adjacent self-intersections, zero duplicate/coincident coverage outside weld policy; signed area/Jacobian and minimum-angle tails reported over the pose/morphology envelope |
| reference mesh vs field | Bidirectional Hausdorff, normal-angle, and projected silhouette error over the complete envelope; one-sided vertex residual is insufficient |
| candidate program vs full graph | Gated bidirectional surface error, normal-angle error, omitted color-weight bound, and perceptual color Delta E; candidate program preserves declared blend ancestry |
| skin weights/deformation | Finite nonnegative partition of unity after capped-influence pruning; barrier leakage, bend/twist volume/radius, joint collapse, normal continuity, and DQ bulge/antipodality or CoR error as applicable |
| planted-foot drift | Gated platform-relative displacement normalized by leg length per stance interval; tolerance must exceed the implementation's declared f32/f64 roundoff floor |
| support-surface locomotion | Sloped, translating, and rotating supports; contact-normal continuity, support-relative plant drift, landing position/velocity residual, and explicit frame-change/loss behavior |
| habitat query | Required-channel/unit/schema validation, field-version invalidation, deterministic placement under equal inputs, and placement/classification error including provider source resolution |
| IK reconstruction | Relative upper/lower length residual plus reach-clamp classification, not decimal-string equality |
| water coupling | Gated height/normal/phase residual and, when consumed, surface-point/material-current velocity residual against the injected provider, normalized by body or wave/current scale |
| shadow/depth parity | Gated silhouette distance in pixels for display, cast shadow, received-shadow lookup, and depth output |
| geometry counts | Derived exactly from the selected compiler/topology/geometry signature; preview-shell counts are not shipping-mesh counts |
| determinism | `seekTick(n) == stepTicks(n)` state hash for equal seed, tick, inputs, and declared numeric implementation; array permutation/consistent id rename are additional field invariants; cross-device tolerance is separate |
| pipeline compilation after reveal | Measured count `0` for predeclared shipping variants; late user-authored variants are classified separately |
| buffer reallocation after init | Measured count `0` within each fixed page; controlled page allocation/recycling is recorded separately |
| spawn cost and first visible frame | Product-gated p50/p95 with workload, adapter, warm-up, allocations, and compile events recorded |

Do not publish multiple unlabeled drift thresholds in different frames. Report
the local solver residual, world-space accumulated drift, and
platform-relative drift separately, each normalized by leg length and paired
with its sampling interval and numeric precision.

## 11. Boot, compile, and spawn contract

Init-time jank is the dominant failure mode of naïve implementations:
pipeline compilation, geometry generation, and buffer allocation all land on
the frame the first creature appears. Separate costs by lifetime:

| Lifetime | Work | Where |
| --- | --- | --- |
| once globally | immutable unit primitive used only by the diagnostic shell | init; no topology/spec mapping attached |
| once per compiler/topology/geometry signature | spec and blend-graph validation, reference extraction, mesh-validity sweep, transported frames, skin weights, closed candidate programs, material variants | load/init; cacheable by the separated signatures in §4 |
| once per topology/tier/geometry page | fixed-capacity pose/instance storage, bounds, free list, visible list | controlled allocation boundary; never resize in place |
| once per body | spec/genome instantiation + first O(slots) pose write | any time; product-gated p50/p95, zero geometry/material construction |
| per frame | recurrent motion steps for active bodies + coalesced dirty-range uploads | steady state; static/analytic unchanged state performs no integration/upload |

- **Pipeline warm-up.** WebGPU compiles per material/pass state; unwarmed, that
  stall lands on the first visible frame. Compile representative display,
  depth/shadow, outline, and configured MRT variants behind the load screen.
  Use `renderer.compileAsync(scene,camera)` for the scene and
  `scenePass.compileAsync(renderer)` for each configured `PassNode`; exercise
  representative shadow casters. Debug variants (§7) are lab-only: never warm
  or ship them.
- **Spawn is a write, not a build.** Population growth touches only the pose
  page region, free list, bounds, and visible-instance list. Page buffers never
  grow in place: a measured overflow policy allocates another fixed page at a
  controlled boundary, recycles an empty page, defers spawn, or rejects it.
- **No synchronous meshing.** Reference extraction runs offline or during the
  load phase, never at spawn. Connectivity-changing morphology requires its
  separately budgeted dynamic extractor; otherwise it is unsupported.
- **Determinism makes signature artifacts cacheable.** Reference geometry,
  blend DAG, closed candidates, weights, and transported frames are pure
  functions of their §4 identities. Cache each under the identity that actually
  affects it; do not call the unit preview shell a reusable species mesh.

Boot gates (also in §10): zero pipeline compilations after reveal for the
predeclared variant set (count via `renderer.info` or a GPU capture), zero
in-page buffer reallocations, separately classified page additions, and product-gated
cold/spawn/first-visible p50/p95 with allocations and compile events recorded.

## Architecture upgrade ledger

Do not cite external implementations as authority. External code may
supply **test fixtures** only; trust comes from the formulas above and the §10
numeric gates executed in the lab.

| Rejected pattern | Mandated replacement |
| --- | --- |
| Masked compile-time unroll over all `P` primitives per vertex | Candidate set of size `K`; loop bounded by `K` or actual `P` |
| `Q = 7` FD gradient taps per shader field query | Fused analytic gradient (`Q = 1`); FD only on CPU for parity |
| Per-instance pose in material uniforms (one draw per creature) | Per-topology/tier fixed-capacity storage pages + instancing |
| `frustumCulled = false` | Local pose + root transform + per-instance posed bounds |
| Repeated-population outline = second full correction draw per body | Post ID/normal edge pass; iso-offset hull hero-only |
| Variable render `dt` into gait/hop | Fixed-step accumulator + interpolated presentation pose |
| Sorting ids to hide a non-associative smin fold | Explicit blend tree/groups with per-node symmetric `k`, or a validated permutation-invariant n-ary kernel |
| K nearby leaves folded in a fresh order | Closed candidate subgraph that preserves declared blend ancestry and passes full-graph error sweeps |
| Per-slot snapped capsule union shipped as a body mesh | One validated extracted reference mesh per compatible compiler/topology/geometry identity + skinning/local correction; dynamic extraction or explicit rejection for topology change |
| Euclidean proximity skin weights | Semantic/geodesic or bounded-harmonic weights with contact barriers, normalized capped influences, and twist/bend gates |
| Posed helper-axis radial basis | Stored rest basis transported continuously with the rig |
| One resizable global population buffer | Fixed-capacity `{topologySignature, tier}` pages with explicit overflow policy |
| Shadow pass assumes every position hook has the same space | Local snapped `positionNode`/`castShadowPositionNode`; derived world `positionWorld` for receive; lab silhouette/lookup gates |
| 32-bit spec hash as sole cache key | Separated strong compiler/topology/geometry identities from §4 |
| Debug/tier rebuild per creature | Signature-aware material-variant cache + uniform scalars |
