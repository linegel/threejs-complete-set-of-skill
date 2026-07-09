# Structured Ash Growth System

Use this reference when the target is a natural deciduous Ash with a stable species identity. It contains two explicit modes: a legacy-fidelity fixture whose exact counts reproduce the historical generator, and an improved workload-selected path. Do not preserve a casing bug, alternating-ring UV artifact, or incorrect per-card normal merely to satisfy the fixture. Any correction updates its own deterministic gates and is compared visually against the fixture. Implement rendering with pinned Three.js r185 `WebGPURenderer`, TSL, `NodeMaterial`, node post, and storage attributes only where their measured access pattern wins.

## Contents

1. Species table
2. Continuation and child placement
3. Branch growth and geometry
4. Leaves, materials, and rooted wind
5. Composition, budgets, and diagnostics
6. Numeric contract gate

## 1. Preserve The Species Table Before Tuning

The Ash Medium species contract is:

| Level | Length | Base radius factor | Sections | Radial segments | Child angle | Children | Child start | Gnarliness | Twist |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 trunk | 43.47 | 2.00 | 12 | 12 | - | 7 | - | 0.03 | 0.09 |
| 1 primary | 27.14 | 0.63 | 8 | 6 | 48 deg | 4 | 0.23 | 0.25 | -0.07 |
| 2 secondary | 9.51 | 0.76 | 6 | 4 | 75 deg | 3 | 0.33 | 0.20 | 0 |
| 3 terminal | 4.60 | 0.70 | 4 | 3 | 60 deg | 0 | 0 | 0.09 | 0 |

All levels use taper `0.7`. Growth force points up with strength `0.01`.

Leaves:

```text
type: ash
count per terminal branch: 16
start: 0
angle: 55 deg
double perpendicular cards
size: 2.67
size variance: +/-0.72
alpha test: 0.5
rounded normals: enabled
```

Do not replace this table with guessed tree-like ranges before the contract is reproduced. Species identity is encoded in the uneven angles, lengths, starts, and child counts.

## 2. Match The Branch Continuation Model

The generator creates two types of descendants:

1. stratified lateral children along the parent;
2. one terminal continuation branch from the parent tip for every deciduous level until the final level.

That continuation is essential to the sparse, irregular crown. A generator that creates only lateral children produces a candelabra or clipped crown.

The terminal continuation inherits:

```text
origin = final parent section origin
orientation = final parent section orientation
radius = final parent section radius
level = parent level + 1
sections and radial segments = parent values
length = next-level species length
```

The inherited section/segment counts differ from ordinary lateral children, which use the next level's table values.

## 3. Match Section Evolution

The legacy-fidelity generator contains:

```text
sectionLength =
  branchLength
  / sectionCount
  / (branchLevels - 1)
```

but guards the divisor with a comparison against the string `'Deciduous'`. The preset stores `'deciduous'`, so this build does not take that branch. Effective runtime behavior is:

```text
sectionLength = branchLength / sectionCount
```

For Ash Medium this doubles the height relative to the apparent intent. The
legacy fixture produces branch bounds near `y=80.30` and leaf bounds near
`y=83.69`; preserve those only in fidelity mode. Production mode normalizes the
species tag, uses one explicitly documented section-length equation, and
regenerates its height/bounds gates. A string-case accident is not botanical
authorship.

The following Euler/force law is fidelity-only. At every legacy section:

1. emit an XZ ring through the current Euler orientation;
2. store origin, orientation, and radius;
3. advance along rotated local +Y;
4. perturb Euler X/Z by seeded gnarliness;
5. apply level twist around local Y;
6. rotate the section toward world growth force.

Gnarliness amplification:

```text
effectiveGnarliness =
  max(1, 1 / sqrt(sectionRadius))
  * levelGnarliness
```

The force angular step is:

```text
forceStrength / sectionRadius
```

clamped to the full angle between current local up and the target direction. Thin branches therefore respond more strongly than the trunk.

Production mode does not inherit these singular laws. It parallel-transports a
rotation-minimizing quaternion frame, applies authored twist separately,
re-orthonormalizes, and bounds curvature change by arc length and local feature
scale. Tropism is a dimensioned curvature/torque input, not
`forceStrength/radius`. Enforce a species-calibrated pipe/allometry constraint

```text
rParent^p >= rContinuation^p + sum(rLateral_i^p)
```

with `p` Authored/Measured for the species, rescaling or rejecting children
when violated. Gate frame continuity, curvature, silhouette, and branch-volume
ratios across generated seeds.

Production junctions are explicit. Hero branches cut the child tube at the
parent surface and stitch a collar/zipper patch, or extract the local junction
implicitly at load. Mid/far tubes may overlap only after hidden caps/internal
faces are removed and projected seam error passes. Gate watertightness,
self-intersection, signed area, junction normal continuity, and UV policy.

For one foreground Ash, CPU generation into typed arrays is acceptable because it is a one-time compile step. For forests, batch species-compatible tree instances by preset and move per-tree transform, crown tint, wind phase, and LOD state into storage instance attributes; do not rebuild branch topology per frame.

## 4. Match Taper And Child Radius Semantics

Deciduous taper:

```text
sectionRadius =
  branchStartRadius
  * (1 - levelTaper * sectionIndex / sectionCount)
```

The final section of the final level collapses to a near-zero radius.

Lateral child radius is not simply the species radius:

```text
childRadius =
  levelRadiusFactor
  * interpolatedParentSectionRadius
```

This couples the child thickness to emergence height and parent taper.

## 5. Match Stratification And Interpolation

For both lateral children and leaves:

```text
along =
  start
  + (slotIndex + seededJitter)
  * ((1 - start) / count)
```

Independently shuffle angular slot IDs with the same seeded RNG:

```text
azimuth =
  2*pi
  * (radialOffset + (permutedSlot + jitter[-0.5, 0.5]) / count)
```

Interpolate between adjacent stored sections:

- origin: linear interpolation;
- radius: linear interpolation;
- orientation: interpolation starts from section B and slerps toward section A by `alpha`, reversing the usual A-to-B expectation.

Then compose:

```text
parent orientation
  x azimuth around local Y
  x emergence angle around local X
```

In fidelity mode, do not replace that reversed interpolation: it changes the
historical roll/twist. Production mode instead uses the transported parent
frame with explicit emergence and twist; it does not preserve a legacy
interpolation artifact.

## 6. Match Ring And Bark UV Construction

Each section emits `radialSegments + 1` vertices by duplicating the first radial vertex at the seam.

Choose one integer circumference wrap count for the entire branch:

```text
wrapsX = max(1, round(branchStartRadius * barkTextureScaleX))
u = radialIndex / radialSegments * wrapsX
v = sectionIndex is even ? 0 : 1
```

The texture's runtime Y repeat is `1 / barkTextureScaleY`.

This is not a real-distance longitudinal UV. Retain it only for fidelity
captures. Production bark uses accumulated branch arc length for V and
circumference for U, with a stable seam and texel-density gate across trunk,
branches, and LODs.

## 7. Match Leaf Placement, Card Geometry, And Normals

Leaves are emitted along every final-level branch, not in synthetic clusters at branch tips.

Each leaf is a square card extending from local base `y=0` to tip `y=L`, with width `W`. The double-card mode emits a second card rotated 90 deg around local Y.

Rounded vertex normal in the fidelity fixture:

```text
normalize(cardNormal + (vertexPosition - leafOrigin))
```

The expression is dimensionally invalid because it adds a unit normal to a
length vector, and the fidelity fixture also uses one unrotated normal for both
cards. Production mode uses a dimensionless authored blend such as
`normalize(nCard + beta*(p-leafOrigin)/leafLength)` or blends `nCard` with a
normalized crown/leaf radial normal. Rotate every term by the card basis and
gate lighting invariance under uniform scale.

Use the bundled `ash.png` alpha silhouette. Replacing it with an ellipse or analytic lozenge changes crown porosity and edge frequency enough to invalidate visual comparison.

For high-density forest variants, convert leaf roots, card bases, alpha cutoff, wind phase, and crown tint to storage instance attributes. Keep the Ash foreground tree contract as the visual reference and use instanced leaf cards only after matching the numeric gate below.

## 8. Materials, Color, And Wind In TSL

The WebGPU/TSL material target is:

- bark: `MeshStandardNodeMaterial` with bark color texture in `SRGBColorSpace`, bark roughness/noise data in `NoColorSpace`, and the contract UV pattern above;
- leaves: double-sided `MeshStandardNodeMaterial` or `MeshPhysicalNodeMaterial` with `alphaTest = 0.5`, optional `alphaHash` for temporal stability, leaf color in `SRGBColorSpace`, alpha/data masks in `NoColorSpace`, and `forceSinglePass` when the double-sided card does not need separate back-face lighting;
- output: `RenderPipeline` owns tone mapping and output conversion through `outputColorTransform` or a single explicit `renderOutput()` node;
- shadows: start from an ordinary fitted directional shadow; select CSM, tiled
  arrays, or custom caching only when coverage/texel-error/invalidation and
  measured target cost reject the simpler path. `TileShadowNode` is not a
  generic large-world or tile-GPU optimization.

Exact r185 add-on imports for this scene family:

| Helper | Import path |
| --- | --- |
| `GTAONode` / `ao` | `three/addons/tsl/display/GTAONode.js` |
| `BloomNode` / `bloom` | `three/addons/tsl/display/BloomNode.js` |
| `TRAANode` / `traa` | `three/addons/tsl/display/TRAANode.js` |
| `CSMShadowNode` | `three/addons/csm/CSMShadowNode.js` |
| `TileShadowNode` | `three/addons/tsl/shadows/TileShadowNode.js` |

The contract wind deforms leaf vertices only:

```text
windPhase = simplex3(position / 70)
wind =
  0.5 * sin(t * 0.5 + phase)
  + 0.3 * sin(2t * 0.5 + 1.3phase)
  + 0.2 * sin(5t * 0.5 + 1.5phase)
displacement = leafUvY * windStrength * wind
```

Express this as TSL node math on the leaf material position path. `leafUvY` roots the card base and moves the tip. The demonstrated branch geometry is static; do not describe this mechanism as hierarchy-weighted trunk/branch wind.

Production branch motion uses a reduced-order hierarchy of damped trunk/branch
angular modes driven by the shared wind field, plus higher-frequency leaf
flutter. Remove high modes with LOD and keep display/shadow deformation
identical. For the legacy fixture only, an extension follows these minimum
rules:

1. keep the leaf-root weighting;
2. add branch-level or per-tree storage attributes separately;
3. deform color and shadow geometry with the same node function;
4. label the result as an extension to the contract.

## 9. Legacy Ash Composition Fixture

For regression against the historical Ash scene, use this named composition
fixture:

```text
startup camera: (100, 20, 0)
target: (0, 25, 0)
horizontal camera constraint near the horizon
foreground tree at origin
100 background trees using radius = 175 + random * 500 (effective 175-675)
procedural grass/dirt ground
5,000 visible grass instances
flowers and rocks
blue atmospheric fog
daylight sky and sun
```

The exact startup camera clips the leaf bound slightly because its upper vertical coverage is approximately `y=82.7` while the leaf maximum is approximately `y=83.69`. For a fixed 3:2 evaluation frame, move the camera along the same target ray to approximately `x=115`; do not alter the tree to solve a framing problem.

Isolated silhouette, alpha-coverage, card-normal, and branch-topology views are
valid mechanism diagnostics, but are insufficient alone for composition,
atmospheric depth, ground contact, or scale. They complement rather than
invalidate the named environment fixture.

Use `$threejs-procedural-fields` for the grass/dirt/flower density fields and `$threejs-image-pipeline` when the scene owns GTAO, bloom, temporal AA, tone mapping, and output conversion.

## 10. Named-fixture workload contract

All counts in this section are **Gated** only for this Ash reference fixture;
they are not general tree/forest/mobile budgets. A production-improvement
variant records measured compile/render p50/p95, projected silhouette error,
alpha coverage, hot bytes, and the exact target context separately.

Ash foreground contract:

- one-time branch and leaf generation only;
- branch geometry under 7k vertices and 10k triangles;
- leaf geometry under 22k vertices and 11k triangles;
- no per-frame branch topology work;
- one bark material and one leaf material unless diagnostics are enabled.

Ash forest contract:

- 100 background trees as identical-topology instanced assets, merged static
  pages, or `BatchedMesh` containers with per-object draw cost explicitly
  recorded; transforms, tint, wind phase, LOD, and impostor state live in
  compatible attributes;
- impostor transition before background trees exceed the stated foreground cost multiplied by visible count;
- one sun-shadow strategy selected up front, with update frequency budgeted by camera movement and wind amplitude.

Composition target:

- background trees: the fixture's under-4 draw-item gate requires instancing or
  merged pages; `BatchedMesh` alone does not satisfy it on r185 WebGPU;
- meadow grass: 5k visible contract blades for reference, higher counts only through the dense storage-buffer architecture in `SKILL.md`;
- node post: one scene pass with shared normal/depth data when AO or temporal filtering is enabled.

## 11. Required Contract Diagnostics

Capture:

```text
final composition
branch-level colors
lateral children versus terminal continuations
child longitudinal slot IDs
child angular slot IDs
leaf origins along final branches
card normals versus rounded normals
bark UV checker
wind displacement magnitude
foreground bounds and camera frustum
storage attributes for forest instances when used
shadow deformation parity
```

Report:

```text
branch jobs by level
terminal continuations by level
lateral children by level
leaf cards
vertices and triangles
seed
preset name
intentional divergences from the growth contract
renderer backend tier
post passes enabled
```

## 12. Numeric Contract Gate

For the Ash Medium contract, assert:

```text
branch vertices: 6,639
branch triangles: 9,120
leaf vertices: 21,760
leaf triangles: 10,880
branch bounds max Y: approximately 80.2981
leaf bounds max Y: approximately 83.6902
```

These exact counts/bounds gate legacy-fidelity mode only. Production mode owns a
separate versioned gate after section-length, UV, or normal corrections.
Matching only counts is insufficient; silhouette, branch-level topology,
texel density, card-normal orientation, bounds, and fixed-camera captures must
agree with the selected mode.
