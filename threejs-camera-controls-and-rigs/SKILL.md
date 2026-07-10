---
name: threejs-camera-controls-and-rigs
description: Build general-purpose Three.js WebGPU/TSL camera systems for product inspection, architecture, scientific visualization, geospatial scenes, and authored cinematography. Use for bounds-derived framing, perspective and orthographic projection, controls/shot ownership, temporal jitter, camera-relative coordinates, large-world precision, constraints, and lifecycle restoration.
---

# Camera Controls And Rigs

A camera system emits exactly one semantic pose, one unjittered projection, and
one coordinate-origin epoch per frame. Controls, fit solvers, authored shots,
temporal jitter, and post effects are separate owners with an explicit handoff;
they must not all mutate the camera opportunistically.

## Number Labels

Label every consequential number in an implementation or review:

- **Derived**: computed from bounds, viewport, projection, target refresh rate,
  adapter limits, or a stated equation.
- **Gated**: a hard correctness/resource limit that fails validation when
  exceeded.
- **Measured**: captured on the named device, resolution, DPR, scene, and
  sustained trace; never copied from this skill.
- **Authored**: composition or interaction intent such as occupancy, lens,
  damping, or horizon placement.

Unlabelled millisecond targets and universal camera distances are invalid.

## Choose The Framing Problem First

| Workload | First camera architecture | Primary correctness test |
| --- | --- | --- |
| Product/asset inspection | bounds-fit perspective or orthographic camera plus `OrbitControls` | every required bound remains inside the safe frame through a full rotation |
| Architecture/interior | eye- or section-plane anchors, lens shift, constrained orbit/pan/walkthrough | vertical/horizon policy, near-plane clearance, and room-scale navigation remain stable |
| Scientific/data visualization | reproducible pose records, declared axes/units, perspective or orthographic projection selected by measurement semantics | projected scale, clipping, and axis conventions are deterministic |
| Geospatial/astronomical scale | local tangent frame plus rebased or high/low camera-relative coordinates | no float32 jitter, origin pop, or temporal-history discontinuity at representative coordinates |
| Cinematic/editorial | authored pose/projection tracks with explicit cut and blend epochs | frame-rate-independent endpoints and intentional temporal-history resets |

Use planar `getViewSize()` only for centered size occupancy when subject depth
is small; it discards principal-point translation. Use `getViewBounds()` for an
asymmetric frame. For volumes, bisect only the XY occupancy residual under
fixed orientation/intrinsics and a safe frame containing the principal point,
then intersect its distance bracket with the independently Derived near/far
feasible interval. Otherwise solve frustum shift/pose too or report infeasible.
Orthographic framing changes frustum or `zoom`; dolly does not change occupancy.

## Ownership Order

1. Resolve the active semantic owner: user controls, fit solver, authored shot,
   or external/XR camera.
2. Compute the owner pose in a declared reference frame; camera local forward
   is `-Z`, right is `+X`, and up is `+Y`.
3. Apply constraints/obstruction to the desired position without changing the
   aim contract.
4. Blend once, if and only if an explicit handoff is active.
5. Write camera pose and unjittered projection once; update world and projection
   matrices.
6. Rebase camera-relative coordinates only at a declared origin epoch.
7. Let the temporal node own transient projection jitter during rendering.
8. Return control only after its target/yaw/pitch state is reconstructed from
   the delivered camera pose.

Input systems produce intents while inactive. They do not write the camera.

## Physics Presentation Boundary

When the view follows or frames simulated content, use the acyclic lifecycle
defined by the
[physics domain and interaction contract](../threejs-choose-skills/references/physics-domain-and-interaction-contract.md).
Camera follow/framing consumes the immutable `PhysicsPresentationCandidate`
created after simulation and any physics-origin transaction. That candidate is
view-independent and contains no camera, render origin, view matrix, shadow
epoch, or global-to-render mapping. The camera owner emits one immutable
`CameraViewPublication` per target/view; visibility/shadow/cache owners consume
both records and emit `ViewPreparationPublication`; only then does the assembler
seal `PhysicsPresentationSnapshot`. Do not read a solver buffer,
external-engine transform, or fixed-step endpoint directly from the camera
loop.

Validate the exact central Candidate, `CameraViewPublication`,
`ViewPreparationPublication`, Snapshot, and every referenced
`PhysicsSignalDescriptor`; do not redeclare a reduced camera-local schema. Each
phase has one writer and emits a new immutable version. Camera, culling,
shadows, velocity, post, picking, and diagnostics consume only their declared
prior publication and never independently resample physics.

The camera owner writes the exact `CameraViewPublication`: publication,
candidate, target/view/camera and owner IDs; view scope; camera/projection
versions; previous/current render-sample instants; complete previous/current
`RenderSimilarityTransform`s; unjittered view/projection matrices; jitter;
viewport; DPR/extent; depth convention; and projection validity/error. Origin
epoch numbers alone cannot reconstruct a cross-rebase trajectory.

The sealed Snapshot is deliberately small: it references candidate binding IDs,
`cameraPublicationId`, `viewPreparationId`, lease refs, and event ranges. Render
consumers resolve the matrices/transforms through `cameraPublicationId` and the
reactive/reset plan through `viewPreparationId`; they do not copy mutable local
subsets. A separate temporal owner supplies `jitterSampleAndConvention`. Motion
vectors never use jittered projections.

Each per-binding/provider `PresentedStatePair` contains independent
`previousPresented` and `currentPresented` provenance, presented instants, state
handles, and global bindings after that signal's declared clock mapping and
interpolation/extrapolation policy. Solver brackets are provenance, not the two
rendered poses. Downstream motion vectors project the presented pair. Using
solver endpoints produces false velocity whenever render and simulation cadence
differ.

An external physics stream enters through one adapter that converts its units,
axes, origin, IDs, timestamps, and discontinuity flags into the common context,
buffers enough timestamped samples for the declared presentation policy, and
publishes bounded error or invalidity when either requested presentation
instant cannot be
represented. It never writes the Three.js camera or object transforms beside
the snapshot writer.

Spawn, despawn, teleport, reparent, incompatible LOD, stream discontinuity, or
identity change invalidates follow smoothing and temporal motion according to
the `ViewPreparationPublication.resetDependencies`; it is not interpolated as
ordinary locomotion. The reset record is a plan. Actual completion/failure belongs in the append-only
`FrameExecutionRecord`, not a mutation of the sealed snapshot.

The camera owner returns `CameraViewPublication`; preparation owners return
`ViewPreparationPublication`; neither mutates an earlier record. Same-frame
results are included only before sealing. An explicitly declared alternate
schedule may defer feedback by one frame, in which case the sealed snapshot and
render continue to name the prior committed resource/version.

If required camera/projection preparation or sealing fails, append a
`FrameExecutionRecord` with `overallStatus: aborted` (or `partial-failure` when
another target survives), exclude the failed target from `snapshotIds`, store
typed absence in its target execution's `snapshotId`, cancel or defer actions,
and retire only failed-target-exclusive `ViewPreparationPublication.resourceLeases` through
`leaseDispositionById`. Candidate/shared leases remain retained until every
surviving snapshot consumer joins. Device loss
appends `overallStatus: device-lost` and affected target statuses `device-lost`, advances
`deviceLossGeneration`, cancels dependent actions, and invalidates resources
and leases from the lost generation without mutating Candidate/Snapshot records
or inventing a completion token. Rebuild under the new backend/resource
generation.

For a rebase, transform both presented states through their respective origin
epochs. A pure coordinate change representing the same global trajectory must
leave camera-relative pose, obstruction result, and projected motion invariant.
If either epoch transform is missing or the bound is exceeded, increment the
appropriate reactive epoch and execute the declared reset dependencies before
rendering; do not encode the origin jump as physical motion.

Stock r185 `TRAANode` cannot preserve its previous-depth history across any
render-origin translation or tangent-basis rebase, even when custom velocity is
rebase-correct. Rebuild/reseed it. Only a custom/patched temporal node using
both complete global-to-render transforms may preserve history after proof.

## r185 WebGPU/TSL Contract

```js
import { WebGPURenderer, RenderPipeline } from "three/webgpu";
import { pass, mrt, output, velocity, renderOutput } from "three/tsl";
import { traa } from "three/addons/tsl/display/TRAANode.js";

const renderer = new WebGPURenderer({ reversedDepthBuffer: true });
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error("This camera architecture requires the WebGPU backend.");
}
```

r185 source establishes these constraints:

- `PerspectiveCamera.getViewSize(distance, target)` and
  `getViewBounds(distance, minTarget, maxTarget)` use the current projection
  matrix, including zoom, film offset, and active view offset.
- `PerspectiveCamera.setViewOffset()` stores `offsetX`/`offsetY`, changes
  `aspect`, and updates projection; orthographic view offset does not own
  aspect. Snapshot the complete `camera.view` object.
- `reversedDepthBuffer` and `logarithmicDepthBuffer` are read-only renderer
  construction options, not per-shot state. Choose once and validate the whole
  depth/post/shadow pipeline.
- `renderer.highPrecision = true` computes model-view and normal-view matrices
  in JavaScript number precision before upload, but r185 explicitly excludes
  `InstancedMesh` and `SkinnedMesh` from that path. Choose it before compile/
  warmup; late changes require graph invalidation/recompile.
- r185 `TRAANode` installs `RenderPipeline` before/after hooks, calls its own
  `camera.setViewOffset()`, then calls `camera.clearViewOffset()`. It does not
  compose or restore an authored nonzero view offset and exposes no public
  history-reset method. On `PerspectiveCamera` it also overwrites aspect; it
  assumes drawing-buffer-sized inputs for depth history and is not an
  XR/ArrayCamera contract.
- r185 `OrbitControls.update(deltaTime)` reconstructs camera orientation from
  `position`, `target`, and an up-basis cached at construction. `deltaTime`
  affects auto-rotate but not damping. A handoff must reconstruct `target`,
  recreate/flush latent control state, and recreate controls if `camera.up`
  changed; copying a quaternion then calling `update()` is not a contract.

Therefore one projection owner supplies the unjittered matrix before
`RenderPipeline.render()`. Do not manually jitter the same camera. Do not use
the stock r185 `TRAANode` on a camera that simultaneously needs authored,
tiled, or multi-viewport `view` offsets; use a separately owned camera/pass or
an explicitly composed WebGPU temporal node. Recreate and dispose the temporal
node at hard cuts or incompatible origin/projection epochs when history cannot
remain valid. Do not resolution-scale stock TRAA inputs. Stock r185 `TAAUNode`
is not a canonical alternative: it lacks reversed/logarithmic/orthographic
depth paths, can copy incompatible depth formats, does not scale jitter to
output pixels as documented, and mutates the singleton velocity node rather
than an arbitrary supplied producer. Gate it to a standard non-log
perspective/canonical-velocity experiment, or patch and validate depth format,
jitter, velocity, and history.

## Non-Negotiable Geometry And Projection Rules

- Derive framing from `Box3`, `Sphere`, oriented bounds, or declared data
  extents. Never reuse one fixed distance across differently scaled content.
  Six axis extrema are not a conservative perspective projection of a sphere;
  use its tangent cone or a conservative enclosing box/hull.
- Rebuild an orthonormal basis with a deterministic near-parallel up fallback.
  Do not use `lookAt()` through non-uniformly scaled parents.
- Call `updateWorldMatrix()` before hierarchy reads and use
  `localToWorld()`, `worldToLocal()`, `getWorldPosition()`, and
  `getWorldQuaternion()` at space boundaries.
- Gate the active camera to an identity parent/ancestry scale of one, or convert
  the delivered world pose through the updated inverse parent world transform
  and rotation before assigning local `position`/`quaternion`.
- Perspective `near` must be positive and as large as visibility permits.
  r185 `OrthographicCamera` permits `near = 0`; fit its near/far interval to the
  required view volume. Reversed depth improves float-depth distribution; it
  does not excuse an unbounded projection or imprecise world coordinates.
- Call `updateProjectionMatrix()` after changing `fov`, `near`, `far`,
  `aspect`, `zoom`, `filmGauge`, `filmOffset`, or view offset.
- Use `lerp` for translation and shortest-path `slerp` for orientation. Clamp
  stalled `dt`; use `1 - exp(-lambda * dt)` or a substepped bounded spring only
  when inertia is Authored.
- A cut, projection discontinuity, camera-origin epoch, or render-size change
  is also a temporal-history event. Propagate it to TRAA, motion vectors, DOF,
  shadow fitting, and any reprojection cache.
- After an obstruction solve changes camera pose, rerun safe-frame and depth
  feasibility. Clearance and composition are coupled constraints.

## Camera-Relative Precision

Never subtract two large float32 world positions in a vertex node. Keep global
coordinates as JavaScript doubles on the CPU, then use one of these paths:

- Few ordinary meshes with small local vertices: enable r185
  `renderer.highPrecision` before compile/warmup and verify object types. It
  stabilizes current CPU-composed model-view only; built-in velocity and TRAA
  previous/world matrices remain float32.
- Chunked scenes: store vertices in chunk-local float coordinates; subtract the
  double-precision origin from each chunk origin on the CPU only when the
  origin epoch changes, then upload the small relative translation.
- Many instances or shared multi-pass data: store high/low split origins or
  already-relative chunk origins in `StorageBufferAttribute` /
  `StorageInstancedBufferAttribute` and consume them in one shared
  `positionNode`/caster path.

Rebase at cell/threshold crossings, not automatically every frame. Carry both
current and previous global-to-local transforms, including tangent-frame basis
rotation, into velocity reconstruction or invalidate temporal history at the
epoch. Stock velocity/TRAA require small current and previous camera-relative
matrices; a custom high/low position path also needs matching previous-position
velocity logic.

## Optional Full-Resolution TRAA Contract

```js
const renderPipeline = new RenderPipeline(renderer);
const scenePass = pass(scene, camera);

scenePass.setMRT(mrt({
  output,
  velocity,
}));

const colorTexture = scenePass.getTextureNode("output");
const depthTexture = scenePass.getTextureNode("depth");
const velocityTexture = scenePass.getTextureNode("velocity");
const temporalColor = traa(colorTexture, depthTexture, velocityTexture, camera);

renderPipeline.outputNode = renderOutput(temporalColor);
renderPipeline.outputColorTransform = false;
```

This minimal TRAA graph deliberately omits normal and emissive attachments.
Add MRT channels only when another declared consumer needs them. Do not combine
TRAA with MSAA or scale its input pass below drawing-buffer resolution in r185.
Treat it as one AA candidate—not the mobile default—against a patched/gated
TAAU, MSAA, spatial AA, or none using Measured quality, bandwidth, persistent
memory, copies, and resolve cost. Keep one tone-map owner and one output-
transform owner.

## Workload Breakpoints And Sustained Budgets

- **Gated** pose/control steady state: one active pose owner, one projection
  writer, zero transient allocations, zero pose/control-added draws. Temporal
  post draws/copies are budgeted separately.
- **Derived** fit work: proportional to the number of required bound points,
  not scene triangle count; cache static bounds and update only changed sets.
- **Derived** rebase upload: `changedChunks * bytesPerRelativeOrigin`; choose
  CPU group transforms, storage updates, or high/low evaluation from this
  workload and Measured transfer/vertex cost.
- **Derived/Measured** high-precision CPU work: one model-view/normal-view
  callback per rendered object/pass pair; multi-pass visibility can dominate.
- **Gated** temporal work: one jitter owner and one history epoch. A cut or
  origin discontinuity cannot reuse incompatible history.
- **Gated before capture**: independent CPU, GPU, presented-frame, peak-memory,
  and spike/headroom budgets derived from the product target; CPU and GPU time
  overlap and are not added.
- **Measured** sustained mobile evidence: target resolution/DPR, refresh goal,
  longest navigation/shot trace, thermal steady state, CPU and GPU frame
  percentiles, allocation/GC trace, origin-rebase spike, and post/shadow
  invalidation spike. Derive the frame allowance as `1000 / targetHz` and test
  the predeclared gates; the trace cannot define its own threshold. GPU claims
  require timestamp-query support and resolved timestamps, otherwise mark them
  unavailable. r185 render timestamps cover timestamped render passes, not
  compute, copies, queue gaps, or presentation; use a target profiler for
  end-to-end claims.

Select degradation from evidence: cache/accelerate when CPU-bound; remove MRT
and AA/post bandwidth when GPU-memory-bound; reduce overdraw/LOD when raster-
bound; change DPR/refresh policy when thermally or presentation-bound. Preserve
declared measurement, framing, and authorship invariants instead of applying a
universal reduction order.

Read [references/camera-rig-and-cinematic-systems.md](references/camera-rig-and-cinematic-systems.md)
for the detailed frame contracts, occupancy solvers, projection precision,
controls handoff, temporal jitter, large-coordinate representations, budgets,
and validation matrix.

## Routing Boundary

Use `$threejs-procedural-motion-systems` for motion of scene objects. Use this
skill for view pose, framing, projection, control ownership, temporal camera
state, and camera-relative coordinates. Route shadow fitting to
`$threejs-scalable-real-time-shadows`, post ownership to
`$threejs-image-pipeline`, and fixed-view/replay evidence to
`$threejs-visual-validation`.
