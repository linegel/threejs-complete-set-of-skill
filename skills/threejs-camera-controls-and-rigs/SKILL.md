---
name: threejs-camera-controls-and-rigs
description: One-writer camera rigs for Three.js WebGPU. Use for bounds-derived perspective or orthographic framing; control and cinematic handoffs; temporal jitter and reset ownership; or camera-relative large-world coordinates.
---

# Camera Controls And Rigs

A rig publishes one semantic pose, one unjittered projection, and one origin
epoch per view and frame. Controls, fit solvers, authored shots, temporal
jitter, and coordinate rebasing own separate state and hand off explicitly.

## 1. Declare owners and spaces

Assign one writer to each channel:

| Channel | Writer |
| --- | --- |
| semantic pose | active controls, fit solver, authored shot, or external/XR owner |
| unjittered projection | active framing or shot owner |
| transient jitter | one temporal node during render |
| render origin | large-coordinate owner at an origin epoch |
| post camera data | one scene pass and its declared consumers |
| listeners/resources/restoration | scene or view lifecycle owner |

Declare units, handedness, world up, camera parent contract, and conversions
between object, world/global, local tangent, camera-relative, view, clip, and
screen space. Camera local forward is `-Z`, right `+X`, and up `+Y`. Inactive
input systems emit intent; only the active semantic owner writes the camera.

**Complete when:** every mutable camera field, matrix, temporal resource, and
listener has exactly one writer and every space crossing names its conversion.

## 2. Choose the framing branch

Choose from the image or measurement requirement:

| Requirement | Architecture |
| --- | --- |
| asset inspection | bounds-fit perspective or orthographic view plus orbit controls |
| architecture | eye/section anchors, lens shift, and constrained orbit/pan/walk |
| scientific view | reproducible pose, axes/units, and projection selected by measurement semantics |
| geospatial scale | local tangent frame plus rebased or high/low camera-relative coordinates |
| cinematography | authored pose/projection tracks with explicit cut and blend epochs |

Define the subject support points, safe frame, required depth envelope, and
authored lens/projection intent. Use orthographic projection when screen scale
must remain independent of depth; use perspective when foreshortening carries
meaning.

Read [framing and projection](references/camera-rig-and-cinematic-systems.md#framing-and-projection)
for asymmetric frusta, volume fitting, orthographic rules, and depth precision.

**Complete when:** the selected projection explains the visual or measurement
requirement and the support set, safe frame, and depth envelope are explicit.

## 3. Solve a valid pose and projection

Build a deterministic orthonormal basis from position, target, up hint, and a
least-aligned-axis fallback. For a deep subject, project a conservative support
set rather than fitting planar width/height alone. Reject nonfinite clip
coordinates and perspective `w <= 0`; require negative view-space `z`, NDC
inside the safe frame, and every support point inside the near/far interval.

Update world and projection matrices before reading hierarchy or frustum data.
Use an identity/unit-scale camera ancestry, or convert the delivered world pose
through the updated inverse parent transform before assigning local pose.

When obstruction changes the camera, solve the near-plane footprint against
the path and rerun safe-frame and depth feasibility. Composition and clearance
must pass together.

**Complete when:** the delivered camera has a finite right-handed basis, finite
clip coordinates with valid `w`, the full support set inside the safe frame and
depth interval, and a post-obstruction recheck when obstruction is active.

## 4. Execute one explicit handoff

Resolve the active owner before update. A finite authored handoff captures its
start once, evaluates time from seconds, writes one positional `lerp` and
shortest-path quaternion `slerp`, and copies the exact target at completion.
An authored moving shot separately owns its path continuity, aim/up fields,
timing, safe frame, and obstruction checks.

On return to controls, reconstruct their semantic state from the delivered
pose. For `OrbitControls`, restore or derive `target`, recreate the controls to
clear latent spherical/pan/dolly state, and recreate them after changing
`camera.up`. Verify the first `update()` preserves the delivered position,
target, orientation, and projection. Pointer-look controllers reconstruct
yaw/pitch in their declared up frame and clear held input on unlock, blur,
owner change, and disposal.

Read [controls and handoffs](references/camera-rig-and-cinematic-systems.md#controls-and-handoffs)
when using stock controls, blends, or authored shots.

**Complete when:** replay rates reach identical endpoints, the first control
update has no jump, and exactly one semantic owner writes each frame.

## 5. Own precision and temporal history

For simulated or live subjects, consume immutable previous/current
presentation samples at the render sample times, not raw fixed-step endpoints.
Camera follow, culling, shadows, picking, and velocity share the same sample
identity; reset them on stream or identity discontinuities.

Keep global positions in CPU double precision or an explicit high/low
representation. Select ordinary-mesh high precision, chunk-local rebasing, or
high/low instance data from object type and workload. Rebase only at a declared
precision threshold and publish immutable previous/current global-to-render
transforms together.

Key temporal state by stable camera/scene identity, projection epoch, origin
epoch, render extent/DPR, MRT layout, and velocity convention. A cut, teleport,
stable-identity change, incompatible projection, uncompensated rebase, extent
or DPR change, or velocity-layout change increments the affected history epoch
before rendering. Apply the reset to velocity, temporal AA, DOF, shadow fitting,
and every reprojection cache that consumes the changed mapping.

Stock r185 `TRAANode` owns transient `setViewOffset()` jitter, expects
drawing-buffer-sized inputs, does not preserve authored view offsets, and has
no public history reset. Recreate it at an incompatible epoch; use a separately
owned or patched node when authored/tiled offsets, XR, resolution scaling, or
cross-rebase preservation are required.

Read [temporal history](references/camera-rig-and-cinematic-systems.md#temporal-history)
for r185 jitter behavior and [camera-relative precision](references/camera-rig-and-cinematic-systems.md#camera-relative-precision)
for ULP gates, representation choices, and rebase ordering.

**Complete when:** current and previous transforms share stable identity and
declared epochs, every live subject consumer shares the render-time sample
identity, every discontinuity has a reset or proven compensation, and a
stationary object produces no false motion across a rebase.

## 6. Commit, resize, and restore owned state

Write semantic pose and unjittered projection once, then update world and
projection matrices. Let the temporal owner apply jitter only inside its render
scope. On resize or DPR change, update camera projection, drawing-buffer-sized
post resources, jitter scale, and history epoch as one transaction.

Snapshot every field the rig owns: transform, `up`, parent, layers, matrix
flags, full projection/view-offset state, controls state, output graph, temporal
nodes, origin buffers, and listeners. Disposal restores that snapshot, disposes
owned controls/post/storage/debug resources, and marks the render pipeline dirty
after output-node or output-conversion changes.

Read [lifecycle and restoration](references/camera-rig-and-cinematic-systems.md#lifecycle-and-restoration)
before modifying a borrowed camera, controls instance, or render pipeline.

**Complete when:** resize leaves projection and temporal resources coherent,
and repeated mount/dispose restores every borrowed field with no surviving
listener, GPU resource, or debug object.

## 7. Verify the rig

Exercise the applicable workload at extreme aspect ratios, full control range,
cuts and interrupted blends, projection changes, repeated rebases, resize/DPR
changes, and dispose/recreate cycles. Inspect final and diagnostic frames.

Record pose/projection/origin/history owners and epochs; target view/clip/NDC;
support-set envelope versus safe frame; near/far; current/previous origin;
maximum relative-coordinate magnitude; controls handoff state; and active MRT
and temporal resources.

**Complete when:** every selected branch passes its geometric, handoff,
precision, reset, resize, and lifecycle criteria, and each failure localizes to
one owner, space conversion, feasibility test, or history epoch.

## Routing

Use `$threejs-procedural-motion-systems` for scene-object motion,
`$threejs-scalable-real-time-shadows` for shadow fitting,
`$threejs-image-pipeline` for post/output ownership, and
`$threejs-visual-validation` for fixed-view and replay evidence.
