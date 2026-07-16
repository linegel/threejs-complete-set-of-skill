# Articulated Hard-Shell Creatures

Read this reference when the visible body is a hierarchy of closed rigid plates
or links rather than one continuously deforming skin. Exoskeletons, shells,
armour, beaks, claws, and robotic fauna can fit this branch. Soft joints,
muscle bulges, cloth, or continuous close-up skin may instead require a unified
reference surface or a hybrid membrane.

## Contents

- Representation gate
- Semantic rig compiler
- Locomotion and support
- Population, LOD, and lifecycle
- Completion evidence

## Representation gate

Select segmented geometry only when all of these are true:

- body identity is carried by visibly separate rigid components;
- articulation can hide or explicitly model the gaps between components;
- topology stays fixed while joint transforms change;
- every visible component can be emitted as a closed oriented surface;
- the requested camera does not expose an unmodelled continuous-skin region.

The gate is complete when every visible region maps to a closed segment,
explicit membrane, or another selected representation, and the closest camera
has a stated seam/gap error bound.

## Semantic rig compiler

Define a dimensioned segment and joint graph:

```yaml
segments:
  - id: stable-semantic-id
    parent: segment-id-or-root
    localFrame: position-and-basis
    geometry: closed-generator-and-parameters
    materialZone: stable-id
    bounds: local-conservative-bound
joints:
  - id: stable-semantic-id
    parentSegment: stable-id
    childSegment: stable-id
    pivotAndAxis: parent-local
    rangeRadians: [min, max]
    restRadians: value
```

Slot IDs follow semantic IDs, not traversal order. Morphology variation may
change bounded proportions, colors, and joint ranges while preserving slot,
parent, material-zone, and storage identities. A change outside that envelope
receives a new geometry/topology identity.

Emit closed capped tubes, swept plates, palms, digits, eyes, or analogous
parts with consistent outward winding and finite normals. Overlap may hide a
joint visually, but it does not make an open segment valid. Parent-local pivots
and axes feed one transform path reused by visible geometry, depth/shadow,
bounds, picking, and motion vectors.

Compilation is complete when all graph references resolve, the graph is
acyclic, stable slots are unique, every component is closed and oriented, joint
ranges are finite, and sampled poses keep bounds and surfaces valid.

## Locomotion and support

Use an authored fixed-step gait state with deterministic phase groups. Each
stance stores stable support/feature identity plus the planted point in the
support's local frame. At a step:

1. batch all support queries for the phase at one sample instant and version;
2. reconstruct planted points from the current support transform;
3. predict swing targets in the support tangent frame using body-relative
   point velocity;
4. solve the articulated chain in body space;
5. write creature-local segment transforms, then update posed bounds;
6. publish immutable previous/current pose state for rendering.

The active and planted groups are species/gait data, not assumptions built into
the generic compiler. Partial or mixed-version query batches follow the
declared hold/replant/block policy. A moving or rotating support advects planted
anchors through its own transform; a deforming support requires a named
material-coordinate mapping.

This branch is kinematic unless a routed physics owner supplies contacts and
reactions. One-way visual water/contact effects return no reaction. Two-way
effects pass through the authoritative owner described by the cross-system
handoff.

Locomotion is complete when segment-length/joint-limit gates pass, required
stance contacts remain support-relative within tolerance, equal seed/tick/input
replays match, and no body or environment state depends on render cadence.

## Population, LOD, and lifecycle

Compatible creatures share geometry/material variants and fixed-capacity pose
pages. Store per-instance root transform, local joint pose, stable identity,
posed bound, representation, and history generation. Upload only dirty ranges.
Reduce tessellation and secondary detail before removing semantic locomotion
segments. A far simplified mesh or orientation-aware impostor must preserve
silhouette and gait identity over its accepted view cone.

Creation, death, teleport, reparenting, slot reuse, topology or LOD change,
support discontinuity, and quality migration advance the affected history
generation and reset motion/temporal consumers. Disposal releases every page,
geometry, material, and state resource owned by the branch.

## Completion evidence

Inspect closed-surface diagnostics, segment/material IDs, joint axes and limits,
extreme poses, planted-support overlays, visible/shadow/depth parity, posed
bounds, repeated-page submission, and LOD transitions. Report compiled segment
and triangle counts, pose/update traffic, visible/submitted instances, live
bytes, and whole-frame cost. Reject open geometry, traversal-derived identity,
world-space joint pivots, support drift, mixed pose generations, unmatched
shadow deformation, or LOD that removes behaviourally essential limbs.
