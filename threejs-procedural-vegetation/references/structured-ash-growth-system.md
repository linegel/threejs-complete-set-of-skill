# Structured Ash Growth System

Use this reference when the target is a natural deciduous Ash with a stable species identity. Preserve the species table, continuation model, branch geometry, foliage placement, rooted wind, composition contract, diagnostics, and numeric gates before tuning. Implement the rendering side with latest Three.js `WebGPURenderer`, TSL, `NodeMaterial`, node post, and storage attributes where the instance count is high.

## Contents

1. Species table
2. Continuation and child placement
3. Branch growth and geometry
4. Leaves, materials, and rooted wind
5. Composition, budgets, and diagnostics
6. Numeric contract gate

## 1. Preserve The Exact Species Table Before Tuning

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

The authored generator contains:

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

For Ash Medium this doubles the height relative to the apparent intent. The complete build produces branch bounds reaching roughly `y=80.30` and leaf bounds reaching `y=83.69`. Preserve the actual behavior. Do not infer behavior from one line without executing the complete growth path.

At every section:

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

Do not derive child orientation from a newly constructed tangent frame; that changes the characteristic branch roll and twist.

## 6. Match Ring And Bark UV Construction

Each section emits `radialSegments + 1` vertices by duplicating the first radial vertex at the seam.

Choose one integer circumference wrap count for the entire branch:

```text
wrapsX = max(1, round(branchStartRadius * barkTextureScaleX))
u = radialIndex / radialSegments * wrapsX
v = sectionIndex is even ? 0 : 1
```

The texture's runtime Y repeat is `1 / barkTextureScaleY`.

This is not a real-distance longitudinal UV. If adapting the visual exactly, retain the alternating ring V pattern. If improving it, record the change as an intentional divergence and re-evaluate bark scale across trunk and twigs.

## 7. Match Leaf Placement, Card Geometry, And Normals

Leaves are emitted along every final-level branch, not in synthetic clusters at branch tips.

Each leaf is a square card extending from local base `y=0` to tip `y=L`, with width `W`. The double-card mode emits a second card rotated 90 deg around local Y.

Rounded vertex normal:

```text
normalize(cardNormal + (vertexPosition - leafOrigin))
```

Use the same unrotated card normal for both perpendicular cards before adding the vertex direction. Preserve that quirk when reproducing the contract. A corrected per-card normal is a legitimate extension but changes canopy lighting and must be documented.

Use the bundled `ash.png` alpha silhouette. Replacing it with an ellipse or analytic lozenge changes crown porosity and edge frequency enough to invalidate visual comparison.

For high-density forest variants, convert leaf roots, card bases, alpha cutoff, wind phase, and crown tint to storage instance attributes. Keep the Ash foreground tree contract as the visual reference and use instanced leaf cards only after matching the numeric gate below.

## 8. Materials, Color, And Wind In TSL

The WebGPU/TSL material target is:

- bark: `MeshStandardNodeMaterial` with bark color texture in `SRGBColorSpace`, bark roughness/noise data in `NoColorSpace`, and the contract UV pattern above;
- leaves: double-sided `MeshStandardNodeMaterial` or `MeshPhysicalNodeMaterial` with `alphaTest = 0.5`, optional `alphaHash` for temporal stability, leaf color in `SRGBColorSpace`, alpha/data masks in `NoColorSpace`, and `forceSinglePass` when the double-sided card does not need separate back-face lighting;
- output: `RenderPipeline` owns tone mapping and output conversion through `outputColorTransform` or a single explicit `renderOutput()` node;
- shadows: `CSMShadowNode` for the sunlit foreground and mid-ground trees; use `TileShadowNode` when the forest spans large world tiles.

Exact r185 add-on imports for this scene family:

| Helper | Import path |
| --- | --- |
| `GTAONode` / `ao` | `three/examples/jsm/tsl/display/GTAONode.js` |
| `BloomNode` / `bloom` | `three/examples/jsm/tsl/display/BloomNode.js` |
| `TRAANode` / `traa` | `three/examples/jsm/tsl/display/TRAANode.js` |
| `CSMShadowNode` | `three/examples/jsm/csm/CSMShadowNode.js` |
| `TileShadowNode` | `three/examples/jsm/tsl/shadows/TileShadowNode.js` |

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

If extending it with branch motion:

1. keep the leaf-root weighting;
2. add branch-level or per-tree storage attributes separately;
3. deform color and shadow geometry with the same node function;
4. label the result as an extension to the contract.

## 9. Match Composition Before Judging The Generator

Present the tree in a complete environment:

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

A black-background isolated tree is not a valid quality test. It removes foliage edge contrast, atmospheric depth, ground contact, and scale cues.

Use `$threejs-procedural-fields` for the grass/dirt/flower density fields and `$threejs-image-pipeline` when the scene owns GTAO, bloom, temporal AA, tone mapping, and output conversion.

## 10. Budgets

Ash foreground contract:

- one-time branch and leaf generation only;
- branch geometry under 7k vertices and 10k triangles;
- leaf geometry under 22k vertices and 11k triangles;
- no per-frame branch topology work;
- one bark material and one leaf material unless diagnostics are enabled.

Ash forest contract:

- 100 background trees as instanced or batched assets with per-instance transform, tint, wind phase, LOD, and impostor state in storage attributes;
- impostor transition before background trees exceed the stated foreground cost multiplied by visible count;
- one sun-shadow strategy selected up front, with update frequency budgeted by camera movement and wind amplitude.

Composition target:

- background trees: under 4 draw calls per LOD band;
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

Matching only counts is insufficient; the earlier half-height implementation matched all counts while violating runtime section-length behavior.
