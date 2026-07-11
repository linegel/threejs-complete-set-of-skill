# Multi-Subject Algorithm And Architecture Selection

Use this guide after the pre-spec assessment and before implementing the
structural pass. It selects representations for general interactive 3D
objects—products, botanical forms, architectural props, vessels, exhibits,
scientific objects, and articulated assets. It is not game-specific.

The Tower Ship, Articulated Desk Lamp, Potted Bonsai, and Ceramic Teapot are
benchmark archetypes, not accepted visual, physical, or performance evidence.
Their value is that they expose different failure classes. A source factory or
passing CPU test does not establish reference fidelity, native-WebGPU
execution, target performance, or a canonical physics integration.

## Contents

- Selection inputs and invariants
- Geometry representation matrix
- Lathe, sweep, and botanical writer rules
- Repeated-detail representation matrix
- Hierarchy, pivots, sockets, identity, and ownership
- Physics and motion boundaries
- Material causal fields and footprint filtering
- Tier invariants and mobile/tile-GPU costs
- Exact validation contracts
- Staged visual cameras
- Benchmark archetypes and known failure signatures
- End-to-end selection workflow

## Selection Inputs And Invariants

Freeze these inputs before choosing an algorithm:

1. Semantic component tree: parts that move, detach, change material, receive a
   collider construction input, or need a stable socket remain separately
   addressable.
2. Coordinate contract: right-handed basis, up/front axes, origin, authored
   length unit, and one explicit conversion to the route's `PhysicsContext`.
3. View contract: camera class, closest inspected distance, physical viewport,
   projection, and the visual-error gate for silhouette and material response.
4. Action contract: static, authored action preview, articulated, deforming,
   detachable, or route-selected solver-driven.
5. Repetition contract: logical element count, per-element variation,
   independent motion, picking, culling, material selection, and alpha use.
6. Target contract: named device/browser/backend, sustained workload trace,
   memory and binding limits, frames in flight, thermal state, and measured
   gates. Never substitute a generic desktop/mobile frame budget.
7. Evidence contract: which values are authored `[A]`, derived `[D]`, gated
   `[G]`, or measured `[M]`. An authored-shape error or triangle target is
   not measured acceptance.

Route away when the target's defining support cannot be represented by the
object-sculptor's rigid primitives, profiles, sweeps, rings, extrusions, or
declared CSG. Generated character/fauna bodies, semantic skinning, locomotion,
morph topology, field-extracted creature surfaces, and their deformation belong
to [threejs-procedural-creatures](../../threejs-procedural-creatures/SKILL.md).
Route a non-creature implicit surface, continuously deforming support, cloth,
soft body, or domain simulation to its geometry, motion, or physics owner.
Object Sculptor may still author rigid props, sockets, attachment frames, and
visual component identity consumed by that owner. Do not approximate a routed
deforming target with rigid overlap merely to keep it inside this skill.

The following do not change across visual tiers: semantic IDs and generations,
parent relationships, socket frames, destruction membership, physics-material
bindings, construction-input and canonical-proxy identities and dimensions,
motion ownership, coordinate contract, and seed semantics. If one must change,
treat it as a versioned physical/model transition rather than visual LOD.

## Geometry Representation Matrix

Select per semantic component, not once for the whole object.

| Representation | Select when | Reject when | Required proof |
| --- | --- | --- | --- |
| Box, cylinder, sphere, cone, torus | The component is described by one analytic support and primitive seams are intentional | Primitive overlap creates the visible silhouette, an attachment gap, an unbounded interior, or an undeclared collision cavity | Bounds match dimensions; primitive axis and cap policy are explicit; projected silhouette error passes the closest-view gate |
| Beveled primitive or rounded profile extrusion | Edge radius is silhouette-visible or controls the highlight footprint | A bevel modifier would cross a thin wall, invert faces, merge semantic seams, or spend segments below the projected error gate | Bevel radius, segment count, corner policy, and post-bevel bounds are tested; no face has negative/near-zero area |
| Lathe | The form is a surface of revolution with a stable axis and an authored radial profile | Off-axis asymmetry defines identity, the profile self-intersects unintentionally, or poles/rims are unspecified | Pole, seam, boundary, cap, winding, normal, and volume tests in the lathe section pass |
| Parallel-transport sweep | A tube, handle, cable, spout, horn, or rail follows a path and cross-section orientation matters | The path has unresolved cusps/zero-length intervals, the cross-section changes topology, or a stock frame visibly flips | Frame orthogonality, twist continuity, seam/boundary, radius, attachment, and bounds tests pass |
| Oriented-ring semantic writer | Taper, section placement, per-ring material/feature IDs, branch sockets, or exact topology must be controlled | The author cannot define expected boundary loops, winding, or junction treatment | Indexed topology, ring correspondence, winding, junction, normal, and bounds tests pass |
| Shape extrusion | A planar authored outline and constant or controlled depth define the part | Boolean-like holes, nonplanar warps, or side-wall material slots lack an explicit triangulation policy | Outline orientation, hole orientation, cap/side slots, bevel, and non-self-intersection tests pass |
| Boolean/CSG result | A subtraction or union changes identity and cannot be represented by a stable profile or assembly | The operation is used to hide interpenetration, emits unstable topology, or destroys action-ready boundaries | Deterministic topology digest, manifold/boundary contract, stable semantic remap, and worst-case build cost pass |

For a bevel or custom writer, choose tessellation from projected error. Given a
world-space deviation `e`, camera projection `P`, and closest allowed view,
measure the maximum screen-space displacement between the candidate and a
higher-resolution reference. Reduce segments only when that displacement stays
within the frozen pixel/visual-error gate in every required view. Do not infer
adequacy from triangle count.

Choose a semantic writer over stacked primitives when any of these is true:

- the outer silhouette must remain continuous across more than one primitive;
- watertightness, signed volume, material slots, or stable feature IDs matter;
- tier changes must preserve section/ring semantics;
- attachments require exact root/tip frames or parent-surface correspondence;
- primitive overlap creates false internal surfaces or incorrect shadows.

Keep primitives when their seams are real, their analytic bounds and authored
collider-construction shapes are valuable, and a custom writer would only
reproduce the same support at greater build and maintenance cost.

## Lathe Rules: Poles, Seams, And Boundaries

Classify every profile endpoint before creating vertices:

| Endpoint | Geometry rule | Topological expectation |
| --- | --- | --- |
| `radius = 0`, closed pole | Emit one pole vertex, then one triangle fan to the adjacent nonzero ring | No radial ring of coincident pole vertices; no boundary at the pole |
| `radius > 0`, open rim | Emit a ring and leave it uncapped deliberately | One boundary loop with exactly the authored radial edge count |
| `radius > 0`, capped rim | Emit a cap center or a triangulated planar/nonplanar cap with the required material slot | No boundary loop; cap normal follows the exterior convention |
| Profile seam or material break | Duplicate only the vertices required for UV/normal/material discontinuity | Topological validation welds only declared equivalent positions; semantic seam remains recorded |

Use increasing profile order along the authored axis. A deliberate fold or
return must name its inside/outside convention; an accidental reversal is a
reject. For a full revolution, either wrap radial indices without duplicating
the seam or duplicate the seam for UVs and publish a seam-equivalence map.
Never count the duplicated UV seam as a physical crack.

For every emitted triangle `(a,b,c)`, compute
`n_g = cross(p_b - p_a, p_c - p_a)`. Its winding is exterior when
`dot(n_g, radialDirectionAtCentroid) > 0`; use the authored cap-axis direction
at poles/caps. Reject zero-radius rings, repeated indices, or
`length(n_g) <= epsilonArea2`.

A decorative disk placed below a movable lid is not a valid vessel closure if
it becomes visible when the lid opens. Model the actual neck/interior boundary,
assign an interior material zone, and validate the open-lid underside camera.

## Parallel-Transport Sweep Rules

Sample path centers by arc length or by an error-controlled subdivision whose
maximum chord deviation is recorded. Reject consecutive centers whose distance
is at or below `epsilonPosition`.

Construct a rotation-minimizing frame:

1. Set normalized tangent `t_0`. Project a deterministic reference axis into
   its normal plane to produce `n_0`; set `b_0 = cross(t_0,n_0)`.
2. For ring `i > 0`, rotate `n_(i-1)` by the shortest rotation from
   `t_(i-1)` to `t_i`, remove its component along `t_i`, normalize, then set
   `b_i = cross(t_i,n_i)`.
3. If tangents are nearly antiparallel or the projected normal collapses,
   subdivide the path first. If the cusp is intentional, restart from a named
   deterministic axis and mark a frame seam; do not allow an implementation-
   selected flip.
4. Emit cross-section vertices from `center + r(u,v)*(cos(v)n + sin(v)b)`.
   Wrap indices or duplicate a declared UV seam. State whether each endpoint is
   open, capped, collared, or embedded.

Required frame gates for every ring are finite values,
`abs(length(t)-1) <= epsilonNormal`, the same for `n` and `b`, and
`abs(dot(t,n))`, `abs(dot(t,b))`, `abs(dot(n,b)) <= epsilonNormal`.
Also require `dot(cross(t,n),b) > 0`. A no-twist reference path (straight line,
planar arc, and a known 3D curve) must preserve the expected cross-section
orientation within its declared angular-error gate.

At a product attachment, terminate the sweep inside its parent by the authored
embed depth, and add a root collar only when the reference supports it. The
collar axis uses the first tangent, the lip/outlet axis uses the last tangent,
and the socket uses the same frame. Test all three; a visually plausible torus
rotated around another axis is a contract failure.

## Botanical Oriented Rings And Junctions

Use oriented rings for trunks, roots, and branches when taper, curvature, or
rooted motion matters. Use the parallel-transport frame above; do not rebuild a
fresh `lookAt` frame per ring.

Each branch declares:

- parent semantic ID and parent-local root socket;
- local start/end, start/end radii, embed depth, gap tolerance, and contact type;
- ring/section counts for each tier;
- root collar or flare dimensions;
- tip socket and child-frame convention;
- breakable/detachable group, or an explicit non-breakable policy.

An overlapping branch tube is not a watertight union. For an opaque visual
assembly it may be accepted only when the embedded root and flared junction
collar hide the seam in all structural cameras. If a closed volume, exact
surface distance, fluid boundary, or fracture surface is required, compile an
actual junction mesh or a versioned implicit/boolean union and validate its
topology and approximation error.

For a branch writer with duplicated radial seam vertices, preserve identical
positions at seam pairs and either identical normals or an intentional normal
discontinuity. Ring winding must be globally consistent. A crown/opaque canopy
must not contain coincident pole rings: use one vertex per pole or omit the pole
and cap the final ring. Validate the signed volume or outward-normal test on
both the woody surface and every opaque crown proxy.

## Repeated-Detail Representation Matrix

| Representation | Select when | Costs that must be counted | Reject when |
| --- | --- | --- | --- |
| Merged `BufferGeometry` per spatial/semantic cluster | Elements are static together, use compatible material slots, and do not need independent picking or motion | One logical vertex/index payload per element, cluster bounds, rebuild/upload bytes when any member changes | One changed leaf/screw forces frequent whole-cluster rebuilds, clusters become uncullably large, or semantic IDs are lost |
| `InstancedMesh` | Elements share geometry/material and differ mainly by transform/color/declared instance data | One submission per instance batch, base geometry once, instance attribute bytes, logical triangle count multiplied by instance count, culling granularity | Per-element materials, topology, transparency sorting, or independent hierarchy cannot be represented by instance attributes |
| `BatchedMesh` or material-slot batches | Several static geometries/material slots can share submissions without losing range identity | Batch tables, range bounds, material-slot/binding demand, rebuild/fragmentation cost | Moving/detaching ranges or frequent edits invalidate most of the batch |
| Opaque cluster proxy | Distant/minimum-tier botanical or dense detail is read as volume, not individual elements | Proxy triangles, opaque shaded pixels, transition error, shadow parity | The closest permitted view resolves individual silhouettes or the proxy changes identity-critical negative space |
| Alpha cards | A measured target proves lower total cost and sorting/coverage is acceptable | Fragment coverage and rejected samples, depth/shadow passes, texture bytes/mips, blending order | Tile overdraw, alpha sorting, shadow aliasing, or coverage dominates; do not assume fewer triangles is cheaper |

Publish three separate counts:

- `drawSubmissions`: actual render submissions/pass occurrences;
- `drawableObjects`: visible mesh/batch objects after culling;
- `logicalElements`, `logicalVertices`, and `logicalTriangles`: multiplicity-
  expanded content.

One instanced mesh is one drawable object but is not one leaf or one triangle
set. A summary that conflates these values is invalid. Minimum-tier opaque
clusters can outperform alpha cards on a tile GPU, but only target measurements
of fragment work, attachment traffic, and total frame composition may decide.

## Hierarchy, Pivots, Sockets, Identity, And Ownership

| Need | Required node boundary |
| --- | --- |
| Whole-object transform | One root pivot with a unique instance namespace and generation |
| Hinge or rotation | Pivot origin at the physical/art-directed hinge; local axis and limits recorded |
| Sliding component | Pivot/frame at the guide origin; local translation axis and range recorded |
| Flexible authored preview | Rooted parent pivot plus deterministic absolute-time transform function |
| Attachment | Parent-local socket with a named axis convention and length unit |
| Detachment/fracture | Separate pivot and destruction group; retained stable ID and explicit post-detach owner |
| Static inseparable detail | May share a mesh/batch only after motion, material, picking, collision, and destruction needs are rejected |

Every runtime instance receives a unique instance ID even when subject and seed
match. Stable entity namespaces include that instance ID; target-semantic IDs
remain separately comparable across instances. Constructing two live copies
must not collide in a process-wide registry.

Only attach a child to a parent owned by the same runtime unless an explicit
cross-asset socket adapter performs the handoff. Reject `null`, an unregistered
`Object3D`, a disposed runtime, or a parent owned by another runtime before
registering the child; invalid input must not partially mutate maps.

Store sockets in parent-local metres (or in explicit authoring units before the
single physics adapter). Tests compare both local transforms and world
transforms after parent motion. A hinge test rotates only the declared local
axis: unintended translation or rotation around another axis is a failure
unless the action contract explicitly contains that coupled channel.

## Collider Construction Versus Canonical Physics

Keep these layers distinct:

| Layer | Object Sculptor may publish | It may not claim |
| --- | --- | --- |
| Authoring collider construction input | Stable semantic entity ID, analytic/compound shape in explicit source units, local authored frame, collision role, material-binding request, source revision, and conservative authored error | Canonical frame placement, contact validity, mass/inertia, collision filtering, solver ownership, or measured contact accuracy |
| Authoring constraint construction input | Stable parent/child identities, parent- and child-local anchors, authored axis/limits/compliance intent, source units, and revision | An active constraint row, solver state, accumulated impulse, contact law, or solve ownership |
| Route adapter | One conversion through `PhysicsContext.metersPerWorldUnit`, registered frame/origin/transform revisions, stable generations, pose signal/version, cadence, validity interval, filter, residency, and measured/derived error | An implicit SI scale, implicit gravity, visual-material-derived friction, or hidden engine defaults |
| Canonical `ColliderProxy` | Context/frame/epoch/revision, shape and pose versions, swept bounds, closedness, one-sidedness, collision mode, feature policy, material ID, filters, error, and residency | Solver state or contact ownership |
| Route-native `PhysicsGraph` state owner | Explicit stage, state-equation, collision/manifold/constraint ownership; versioned state, interactions, dependencies, costs, prepare/commit records, and presentation publication | Wrapping a route-native owner in an external adapter, half-owned motion, direct render-node mutation, or hidden engine defaults |
| `ExternalSolverAdapter` | Only an external library, process, or device; exact frame/unit/handedness/clock/state maps, ownership fields, capabilities, dependencies, receipts, failure policy, and end-to-end adapter cost | Treating a local route owner as external, an opaque pointer as synchronization, or bypassing `PhysicsGraph`, interaction, commit, presentation, and evidence gates |

Missing density, center of mass, positive mass, a physically valid inertia
tensor, or contact/material laws blocks `RigidBodyProperties`. PBR roughness,
metalness, glaze, wood color, and wet-looking pixels never infer physics.

For each `ColliderConstructionInput`, call its analytic or compound candidate
the authored shape, not a canonical proxy. Compute approximation error in the
input's authored frame and units. Sample all visual surface triangles at
vertices plus an error-controlled subdivision until the distance-bound change
is below the asset's convergence gate. Record:

```text
e_visual_to_authored = max_x on visual surface distance(x, authored shape surface)
e_authored_to_visual = max_y on collision-relevant authored shape surface distance(y, visual surface)
e_declared >= max(e_visual_to_authored, e_authored_to_visual) + samplingError
```

For a conservative authored envelope also require every collision-relevant
visual sample to be inside the authored shape plus the declared inflation.
Understating the error rejects the input. Repeat after every seed and tier; the
construction-input identity and dimensions stay fixed while measured visual
deviation may change within the declared gate. A directed sampled lower bound
is a useful regression mutation, but it is not bidirectional acceptance.

Before publishing a canonical `ColliderProxy`, the route adapter repeats or
transports the accepted test into the registered physics frame and SI units,
adds `conservativeInflationMeters`, swept bounds, pose/version, filters,
validity, cadence, material, feature, and residency evidence, and reruns the
canonical mutations. A vessel eligible for hydrostatics also requires
watertightness, outward winding, positive signed volume, and a bounded volume
error; a visually closed hull is not enough.

## Action Preview Versus Solver Motion

| Mode | Owner and clock | Valid use | Required test |
| --- | --- | --- | --- |
| Authored action preview | Object factory; absolute `seconds` input; no solver authority | Demonstrate hinges, rooted wind, oars, lid travel, sockets, and transform readiness | Same seed/time produces identical matrices; `setTime(0)` and `setTime(t,false)` exactly restore the declared rest pose; limits/axes hold at sampled extrema |
| Kinematic route motion | Named route state owner and registered clock | Deterministic externally commanded motion | Published pose/version/frame/cadence agree with the route; render consumes immutable committed state |
| Dynamic solver motion | Route-selected solver or `ExternalSolverAdapter` | Contact, forces, constraints, buoyancy, fracture, two-way coupling | Fixed input trace produces bounded state/error; exactly one owner advances each state equation; interactions and commits are exact-once |

Preview motion must be a pure function of seed, authored rest state, and
absolute time. Do not integrate with render-frame `deltaTime`; frame-rate
dependence is then unavoidable. Sample every analytic extremum plus endpoints
and several interior times, validate the declared hinge axes/limits, recompute
world bounds, and confirm sockets follow the same hierarchy. Solver-driven
motion replaces the preview transform source; it does not run in addition to
it.

## Material Causal Fields And Footprint Filtering

Material metadata is not a material implementation. Each important response
bundle names and executes its causes:

| Cause | Permitted coupled outputs | Independence requirement |
| --- | --- | --- |
| Edge/corner exposure | albedo wear, roughness change, small normal rounding | Must derive from geometry/curvature or a declared authored mask, not object-space noise alone |
| Cavity/contact accumulation | dirt albedo, roughness, AO-like local response | Must not darken unoccluded convex regions under the same cause |
| Glaze pooling/thickness | base-color shift, roughness/clearcoat, subtle normal/height | A string such as `glaze-pooling` without an executed node/texture path fails |
| Wood/bark direction | anisotropic color/roughness/normal bands along local growth/material frame | Orientation follows the component frame across bends and tiers |
| Controlled manufacturing variation | bounded hue/roughness/micro-normal variation | Seed affects declared values only and preserves IDs, dimensions, and collider semantics |

Do not alias albedo pixels into roughness, normal, height, or AO. Correlate
channels through named causes while generating independent response functions.
Separate macro silhouette/form, meso marks/joints, and micro roughness/normal
bands.

Band-limit procedural detail to the pixel footprint. For a procedural
coordinate `q`, derive its screen footprint from derivatives (or an equivalent
precomputed LOD) and attenuate frequencies above the reconstructible band.
Texture paths require mipmaps and a declared UV/triplanar footprint policy;
analytic noise requires octave termination or prefiltering. Validate with a
distance sweep: the material must not increase temporal shimmer or contrast
after its feature projects below the sampling gate. Specular normal variance
requires specular antialiasing or a bounded roughness compensation.

Material review uses a neutral three-quarter view, a grazing-light close-up,
and the reference-matched view. Keep lighting and exposure fixed when comparing
material tiers. A flat color plus descriptive `userData` fails the material
pass.

## Tier Invariants And Mobile/Tile-GPU Costs

| May change by visual tier | Must remain invariant |
| --- | --- |
| radial/path subdivisions, bevel segments, hidden micro geometry, repeated-detail representation, texture resolution/band, shadow-caster detail | target and instance identity, semantic node hierarchy, sockets, collider inputs, physics materials, destruction groups, action ownership, rest pose, seed meaning, coordinate/unit contract |
| merged leaves to opaque canopy clusters | crown/branch semantic IDs, attachment frames, canopy envelope within its visual-error gate |
| sweep/lathe tessellation | path/profile, endpoint policy, material zones, sockets, collider dimensions |
| batched/instanced submission layout | stable per-element semantic mapping when picking/action requires it |

Every tier reports at least:

- physical and logical vertex/index bytes, including multiplicity;
- draw submissions by pass and material, binding/texture/buffer demand;
- instance/batch-table bytes and update/upload bytes per occurrence;
- opaque and alpha-covered pixel work in the named cameras;
- shadow/depth participation and extra pass breaks;
- attachment store/load/resolve traffic and tile-spill evidence when available;
- hot, peak-transient, frames-in-flight, and migration-overlap bytes;
- build, allocation, compilation, disposal, and repeated create/dispose costs.

Derive buffer bytes from exact element count, stride, index width, alignment,
and live copies. Count shared geometry once, instance records per instance, and
old/new resources simultaneously during tier migration. Do not call a reduced
triangle count a performance win when it adds alpha overdraw, more materials,
pass breaks, uploads, or bindings.

Prefer opaque geometry on constrained tile GPUs when it removes costly alpha
coverage and pass fragmentation, but require sustained measurements on the
named target. Keep static geometry and materials immutable; update only dirty
instance/parameter ranges. Avoid frame-critical GPU-to-CPU readback and
per-frame resource allocation.

Resource ownership is explicit. A runtime disposes only resources marked
`owned`; external/shared geometries, materials, textures, and pipelines use a
lease/reference-count owner and retire after all consumers complete. Disposal
is idempotent, unregisters the live instance, and never invalidates another
model. Run repeated create/use/dispose cycles and verify bounded live counts,
GPU/resource generations, and no stale registry entries.

## Exact Validation Contracts

Define these per-asset values before tests:

```text
D = diagonal length of the authored local bounding box; require D > 0
epsilonPosition = max(spec.positionTolerance, 32 * FLOAT32_EPSILON * D)
epsilonArea2 = max(spec.minimumDoubleTriangleArea, epsilonPosition * D)
epsilonNormal = spec.normalTolerance
epsilonBounds = spec.boundsTolerance
```

The spec values carry units, evidence labels, and sources. They are not hidden
universal defaults.

### Topology

For every indexed geometry:

1. Require index count divisible by three and every index in
   `[0, position.count)`.
2. Reject repeated triangle indices and
   `length(cross(p_b-p_a,p_c-p_a)) <= epsilonArea2`.
3. Count undirected edge uses after applying only the declared UV-seam vertex
   equivalence. Closed two-manifold surfaces require every edge count `2`.
   Open surfaces require exactly the authored boundary-loop count and member
   edges; counts above `2` reject.
4. Traverse directed boundary edges into loops; reject branches, open chains,
   or a loop not named by the endpoint policy.
5. For closed surfaces, require finite nonzero signed volume and the authored
   exterior sign. Mutation: remove one cap triangle, reverse one ring, and
   duplicate one pole; each mutation must fail the intended gate.

### Normals And Frames

Require every position/normal finite, every normal length within
`epsilonNormal` of one, and the geometric-face/vertex-normal dot product not
below the authored crease gate. Compare declared seam pairs and check
inverse-transpose normal handling under a nonuniform transform. For sweep/ring
frames, apply the orthonormal/right-handed tests in the sweep section. Mutation:
reverse all crown indices or rotate a hinge around the wrong local axis; the
diagnostic must fail.

### Bounds

Compute local bounding box and sphere after final positions are written.
Require every vertex inside both within `epsilonBounds`. Aggregate world bounds
from every visible child after `updateMatrixWorld(true)`, including instanced
transforms. Test rest pose, every analytic motion extremum, action-preview
samples, all tiers, and all accepted seeds. The authored construction shape and
envelope must contain the visual bounds within its declared gate. After route
adaptation, canonical `ColliderProxy.sweptBounds` must contain the corresponding
world bounds plus accepted error/inflation over the same validity interval.
Missing bounds is a hard failure for camera framing, culling, LOD, and physics
adaptation.

### Authored Shape And Canonical Proxy Error

Run the bidirectional/conservative authored-shape test in one named authoring
frame and unit. Mutations shrink the shape, change unit scale, or move its local
frame; each must exceed `e_declared` or fail containment. After adaptation, run
the canonical `ColliderProxy` version in the registered physics frame and SI
units. Do not pass either layer because a center, AABB, or one directed sample
set is close.

### Seed Determinism

For each tier, hash sorted semantic IDs plus canonical position/index/instance
bytes. Two builds with the same seed and source revision must match exactly.
Different accepted seeds must change at least one declared variation channel,
stay within every stated amplitude, and preserve protected node/socket/
collider-construction/destruction IDs and hierarchy. Compute actual maximum
displacement from the unvaried reference; a declared `0.055 m` bound fails if
any vertex exceeds it. Test simultaneous live identical builds for namespace
collisions.

### Motion

Capture local and world matrices for protected pivots/sockets at rest,
extrema, and fixed interior times. Require deterministic replay, exact reset,
finite matrices, declared axis/limit compliance, unchanged protected IDs, and
updated bounds. Call the same times under different render-step partitions;
absolute-time previews must match exactly. Solver tests instead compare
committed versions under the same registered input trace and tolerance.

### Modes, Counts, And Lifecycle

Every diagnostic mode must either replace every in-scope material/visibility
channel or emit a visible failure naming the unsupported semantic group.
Silent fallback to final materials is forbidden because it can make a broken
diagnostic look valid. Count submissions, drawable objects, logical elements,
vertices, and triangles separately. Build two runtimes, attach a cross-runtime
parent mutation, share one explicitly external resource, dispose in both
orders, and prove registry/resource ownership remains valid.

## Staged Visual Cameras

Use fixed camera IDs, projections, bounds-derived framing, viewport/DPR,
lighting, exposure, seed, tier, and time. Capture the final image and the
matching mechanism diagnostic; inspect both directly.

| Pass | Required cameras/diagnostics | Reject signatures |
| --- | --- | --- |
| Blockout | Reference-matched; orthogonal front/side/top or the closest unoccluded substitutes; neutral three-quarter silhouette | Wrong proportions, cropped bounds, primitive family mismatch, hidden hole |
| Structural | Three-quarter; rear/underside; close-up of every identity-defining attachment; hierarchy colors | Floating children, cross-axis hinge, missing interior, interpenetration used as a joint |
| Form | Silhouette tangencies; pole/cap close-up; sweep bend close-up; normal/winding diagnostic | Pole pinching, seam crack, frame flip, reversed crown/hull, missing cap |
| Material | Neutral three-quarter; grazing close-up per important material; reference-matched | Flat metadata-only material, aliased microdetail, lighting used to hide response |
| Action | Rest; each sampled extremum; socket/axis overlay; collider-construction-input/error overlay; canonical proxy/error overlay only on an adapted physics route; fracture-group view | Motion invisible, reset drift, socket detaches, authored shape misses geometry, preview presented as solver, canonical overlay claimed without an adapter |
| Tier/performance | Same cameras at every tier; closest allowed view; alpha/overdraw and shadow diagnostics; sustained motion trace | Semantic disappearance, silhouette beyond gate, alpha cost hidden, stale bounds/resources |

For a lathed vessel, include open-lid underside and outlet-axis cameras. For a
botanical target, include root flare, every primary junction, crown pole, and a
backlit crown silhouette. For a vessel hull, include bow/stern axial views and
an underside/watertightness diagnostic. For an articulated product, include
each joint at both limits and a cable/spring bend close-up.

## Benchmark Archetypes And Known Failure Signatures

Use all four archetypes to test transfer, not to establish acceptance:

| Archetype | Algorithms it stresses | Required regression questions |
| --- | --- | --- |
| Tower Ship | station/ring hull writer, cap fans, large semantic assembly, repeated hinged oars, sail, sockets, compound collider construction inputs | Are bow/stern truly closed and outward-wound? Are oars visibly deterministic and resettable? Are collider units honestly authoring inputs until adapted? |
| Articulated Desk Lamp | analytic hard-surface parts, bevel/highlight policy, serial hinge hierarchy, tubes/cable/spring sweeps, emissive head | Do all hinge axes/limits and sockets agree and reset exactly? Is only the intended shade aperture open? Do spring/cable anchors remain connected? Are primitive seams, bevels, bounds, authored-shape errors, and submission/material/shadow costs valid at the closest view and target? |
| Potted Bonsai | oriented-ring trunk/branches/roots, junction collars, merged leaf solids, opaque minimum-tier clusters, rooted preview wind | Are ring/crown winding and poles valid? Do attachment/fracture records close? Do authored envelopes and seed displacement bounds contain measured geometry? |
| Ceramic Teapot | lathe poles/rims, spout/handle parallel-transport sweeps, collars/outlet, lid hinge, layered ceramic response | Are poles nondegenerate and boundaries explicit? Is the open-lid interior real? Does the hinge obey its axis? Are glaze fields executed and filtered? Are authored-shape errors conservative? |

Independent audits found benchmark bugs that this guide must prevent:

- Shared runtime: live-instance ID collisions; acceptance of external or
  cross-runtime parents; disposal of shared resources by the wrong model;
  implicit SI assumptions; silent diagnostic-material fallback; drawable
  counts that hid instance multiplicity; and missing bounds.
- Lamp: action motion too subtle to read and phase-offset motion that did not
  reset at `setTime(0)` or mode exit; an unintended annular hole at the shade
  crown; false base/shade/bulb/arm authored-shape error envelopes; hinge inputs
  missing stable parent/child identities and anchor frames; rigid decorative
  springs and straight cables without connected motion anchors; generated
  bounds/contact plane contradicting the contract; excessive minimum-tier
  submissions, per-instance materials, and shadow casters; PBR labels that
  conflicted with coating/glass response; and tests that omitted these failures
  from the package gate.
- Bonsai: globally reversed ring/crown winding; pole-degenerate crown
  triangles; authored envelopes/errors smaller than the geometry they claimed
  to cover; a `0.055 m` variation claim contradicted by actual displacement;
  and incomplete fracture/attachment metadata.
- Teapot: a glazed disk exposed below the lifted lid; zero-radius lathe rings
  with degenerate triangles; no explicit sweep endpoint/boundary policy;
  understated authored-shape errors; lid motion violating its declared hinge
  axis; and glaze behavior described only in metadata while rendering stayed
  flat.
- Tower Ship: an uncapped station-ring end appeared as a bow/stern hole; axial
  cameras and a boundary-edge mutation must prevent recurrence.

Treat fixes as in progress until the exact tests, native-WebGPU diagnostics,
staged images, target measurements, and lifecycle evidence pass. Do not call a
benchmark accepted merely because its source now contains the intended rule.

## End-To-End Selection Workflow

1. Run image suitability and pre-spec gates. Record uncertainty instead of
   inferring hidden backs, interiors, or rigging.
2. Partition the target into semantic components and repeated systems. Freeze
   coordinate, view, action, seed, tier-invariant, and target contracts.
3. For each component, select from the geometry matrix. Write pole/seam/cap,
   sweep endpoint, attachment, material-slot, and boundary policies before code.
4. Select repeated-detail representation from required motion, picking,
   culling, material, transparency, and measured target costs. Preserve logical
   counts independently of submission layout.
5. Author pivots/sockets/destruction groups and unique instance identity before
   merging or batching. Reject cross-runtime parenting and ambiguous axes.
6. Publish collider construction inputs only. If physics is requested, route
   them through the shared `PhysicsContext` and selected canonical adapter;
   block unsupported mass/contact/solver claims.
7. Implement blockout, structure, form, material, action, and optimization in
   locked passes. Run the exact topology/normal/bounds/collider/seed/motion
   tests and their mutations at the owning pass.
8. Capture the staged camera matrix in the Codex in-app Browser. Compare final
   and mechanism diagnostics; a nonblank render is not acceptance.
9. Derive tier candidates from visual error and resource accounting, then run
   sustained measurements on each named target. Include tile traffic,
   overdraw, bindings, uploads, frames in flight, migration overlap, and
   lifecycle—not triangles alone.
10. Report claims separately: structural contract, visual fidelity,
    action-readiness, canonical physics integration, native-WebGPU execution,
    sustained performance, and lifecycle stability. Any missing evidence stays
    `incomplete`.
