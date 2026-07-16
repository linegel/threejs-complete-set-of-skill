# Camera Rig And Cinematic Systems

Use this reference for the branch selected in `SKILL.md`. It targets Three.js
r185 with `WebGPURenderer` and preserves one semantic pose writer, one
unjittered projection writer, and one transient jitter owner.

## r185 contract

```js
import { WebGPURenderer, RenderPipeline } from 'three/webgpu';

const renderer = new WebGPURenderer({
  reversedDepthBuffer: true,
  antialias: false,
  trackTimestamp: true,
});

await renderer.init();
if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error('Native WebGPU is required by this camera path.');
}
```

Relevant r185 behavior:

| Surface | Consequence |
| --- | --- |
| `PerspectiveCamera.getViewBounds()` | Uses the current inverse projection and preserves principal-point translation. Update projection first. |
| `PerspectiveCamera.getViewSize()` | Returns bounds size, so principal-point translation cancels. Use it only for centered planar occupancy. |
| `PerspectiveCamera.setViewOffset()` | Replaces the full view record, changes perspective `aspect`, and updates projection. Snapshot the complete record and aspect. |
| `reversedDepthBuffer` / `logarithmicDepthBuffer` | Renderer-construction policies. Validate all depth consumers against the selected policy. |
| `renderer.highPrecision` | Computes model-view and normal-view matrices with JavaScript-number intermediates; r185 excludes `InstancedMesh` and `SkinnedMesh`. Set it before graph warmup. |
| `OrbitControls.update(deltaTime)` | `deltaTime` affects auto-rotation, while damping advances once per call. Interactive replay needs buffered intent or a dt-correct controller. |
| `TRAANode` | Requires MSAA disabled. Gate renderer construction and the source pass as single-sampled before selecting it. It temporarily owns camera view offset, expects drawing-buffer-sized inputs, does not restore an authored view record, and exposes no public history reset. |
| timestamp queries | Require `trackTimestamp: true` at construction and post-init feature support. Render timestamps exclude compute, copies, queue gaps, and presentation. |
| `RenderPipeline` | Owns one output graph plus its before/after hooks. Keep final output and jitter ownership explicit. |

## Framing and projection

### Camera basis

Three.js cameras look along local `-Z`. Given desired position `p`, target `t`,
up hint `u`, and optional previous right vector `rPrev`:

```text
f = normalize(t - p)

if rPrev projects to a valid vector perpendicular to f:
  r = normalize(rPrev - f * dot(f, rPrev))
else:
  replace a near-parallel or invalid u with a deterministic least-aligned axis
  r = normalize(cross(f, u))

v = normalize(cross(r, f))
b = -f
camera basis columns = [r, v, b]
```

Use separate entry and exit gates for the near-parallel fallback so the basis
does not chatter. A zero aim vector follows one declared policy: fail the pose
or retain the prior orientation. Validate right-handedness and roll continuity
around the degeneracy.

The delivered pose is a world pose. Prefer an identity, unit-scale camera
ancestry. Otherwise update the parent world matrix and transform position and
orientation through the inverse parent world transform before assigning local
fields. Nonuniform camera ancestry invalidates a naive `lookAt()` result.

### Planar occupancy

After `camera.updateProjectionMatrix()`:

```text
viewSize = camera.getViewSize(distance, outSize)
occupancyX = subjectPlaneWidth  / viewSize.x
occupancyY = subjectPlaneHeight / viewSize.y
```

This test is valid for centered planar size at one compatible depth. For an
asymmetric safe frame, compare subject plane bounds with
`camera.getViewBounds(distance, outMin, outMax)` so the principal-point offset remains
visible.

### Volume fit

Build the required support set from an oriented bound, conservative hull,
section extent, confidence region, or required annotations. Six axis extrema
do not conservatively project a perspective sphere; use its tangent cone or a
conservative enclosing box/hull.

For each candidate pose:

1. update world and projection matrices;
2. transform each support point independently to view and homogeneous clip
   space;
3. require finite coordinates and perspective `w > 0`;
4. divide by `w`, form the NDC envelope, and compare it with the authored safe
   frame;
5. require every point inside the independently derived near/far interval;
6. for a fixed orientation and intrinsics, bisect only a monotone XY occupancy
   residual whose safe frame contains the principal point;
7. solve lateral/frustum shift jointly when those assumptions fail, or report
   infeasibility.

A combined occupancy-and-depth boolean is not generally monotone: a fixed far
plane can reject a camera that has moved farther away. Intersect the independent
feasible intervals and validate the final pose directly. Bisection over initial
bracket width `D` and distance tolerance `epsilonD` needs at most:

```text
max(0, ceil(log2(D / epsilonD)))
```

The fit cost is `O(P * I)` for `P` support points and `I` iterations. Cache
static support sets; GPU displacement needs conservative analytic or separately
computed bounds because CPU geometry bounds do not see it.

### Perspective and orthographic branches

- Perspective represents foreshortening and approach. Derive a positive near
  plane and the closest far plane that encloses the required visibility.
- Orthographic projection preserves projected scale in the declared plane.
  r185 permits `near = 0`; change frustum extent or `zoom`, because dolly does
  not change occupancy.
- A perspective-to-orthographic handoff matches the complete view-plane bounds
  at the focus distance, including horizontal and vertical principal-point
  offsets. Matrix-element interpolation is not a projection blend.
- Recompute depth range when the required envelope changes, with authored
  hysteresis where one-frame bound noise would otherwise churn the matrix.
- Reversed depth improves depth distribution but does not repair float32
  cancellation in large world coordinates.

Distinguish projection precision from transform and temporal precision:

```text
projection precision <- near, far, depth representation
transform precision  <- magnitude entering float32 math
temporal precision   <- consistency of current/previous transforms and epochs
```

Every change to `fov`, `near`, `far`, `aspect`, `zoom`, `filmGauge`,
`filmOffset`, or view offset is followed by `updateProjectionMatrix()` before
framing or rendering.

### Domain-specific constraints

- **Asset inspection:** fit visible and state-dependent bounds, including
  protrusions and open/animated states; derive orbit/zoom limits from framing
  and near-plane safety.
- **Architecture:** declare vertical and horizon policy; use lens/view shift for
  two-point perspective rather than pitching the camera. `filmOffset` is
  horizontal in `PerspectiveCamera`; use a view/frustum offset for vertical
  shift. Separate navigation collision from authored section visibility.
- **Scientific views:** record units, axes, projection, clip planes, pose,
  viewport, and zoom; include confidence regions and annotations in the fit.
- **Geospatial views:** keep global coordinates in double precision, build a
  stable local tangent frame, run horizon/global queries globally, and rebase
  render inputs from a declared precision criterion.
- **Cinematic views:** give each shot a pose, projection, safe frame, target or
  aim rule, transition, duration, and history policy. Moving shots validate
  path continuity, aim/up, obstruction, and composition between keyframes.

### Obstruction and near-plane clearance

Derive the near-plane footprint from the active asymmetric projection. For a
fixed-orientation optical-axis dolly, sweep a sphere around the near-plane
rectangle center with a radius equal to its half diagonal. With changing aim,
lateral motion, or rotation, sweep the transformed corner hull or a proven
enclosure of the complete path. Orthographic footprints come from frustum
extents, zoom, and view offset.

Resolve imminent clipping inward immediately; an authored response may smooth
outward recovery. After obstruction changes the pose, rerun safe-frame and
depth feasibility and update DOF focus from the delivered pose.

### Exact view-offset restoration

Perspective view state contains `enabled`, `fullWidth`, `fullHeight`,
`offsetX`, `offsetY`, `width`, and `height`. Snapshot whether `camera.view` was
`null`, deep-copy every field for non-null states, and snapshot perspective
`aspect`.

Restore `null` as `camera.view = null`; otherwise assign a fresh copy of the
saved record. Restore aspect and call `updateProjectionMatrix()`. Calling only
`clearViewOffset()` cannot recover the earlier null/disabled/enabled state after
TRAA has replaced its dimensions.

## Controls and handoffs

### Orbit controls

`OrbitControls` owns camera transform and `target`; with an orthographic camera
it also writes `zoom`. Before reacquisition:

1. disable the old owner;
2. apply the delivered pose/projection once;
3. restore the semantic target, or derive
   `target = position + forward * authoredRadius`;
4. recreate controls to clear latent spherical, pan, dolly, scale,
   cursor-zoom, and interaction state;
5. recreate after changing `camera.up`, whose up-to-Y transform is cached at
   construction;
6. apply saved public configuration and call one update;
7. compare delivered and post-update position, target, orientation, and
   projection.

Call `saveState()` only when the handoff intentionally changes reset semantics.
Stock damping advances per `update()` call; a fixed programmatic cadence can be
deterministic, while DOM handlers may update internally. Deterministic
interactive replay uses buffered intents and a dt-correct response such as:

```text
alpha = 1 - exp(-lambda * dt)
```

The r185 orthographic `zoomToCursor` path allocates temporary vectors. A
zero-allocation interaction gate therefore disables that mode or patches it to
owned scratch storage.

### Pointer look

Stock `PointerLockControls` assumes an unparented/identity-parent y-up camera
and reconstructs local `YXZ` orientation. A local tangent frame, arbitrary
data-up convention, or transformed parent needs a controller that owns yaw,
pitch, and movement in that frame. Derive yaw/pitch from the delivered
quaternion on acquisition, and clear held input on unlock, blur, owner change,
and disposal.

### Authored handoff and shot

A finite handoff captures its start once:

```text
u = clamp((now - startTime) / duration, 0, 1)
e = authoredEase(u)
p = lerp(startPosition, targetPosition, e)
q = slerpShortest(startQuaternion, targetQuaternion, e)
if u == 1: copy the target exactly
```

This is a state transition, not a complete camera path. A moving shot owns
position continuity, time or arc-length parameterization, aim/up continuity,
angular velocity, safe frame, depth, and obstruction over the complete path.
One frame contains one final semantic write; control reacquisition is a named
handoff rather than a second update loop.

## Temporal history

Stock r185 TRAA performs:

```text
before RenderPipeline:
  save unjittered projection
  set a Halton-derived camera view offset at drawing-buffer size

render and resolve:
  consume beauty, depth, velocity, current/previous matrices

after RenderPipeline:
  clear view offset
  advance jitter index
```

Consequences:

- gate renderer construction and the source pass as non-MSAA before selecting
  stock TRAA;
- complete semantic pose and unjittered projection before pipeline render;
- give `setViewOffset()` to the temporal owner during its render scope;
- use stock TRAA only at full drawing-buffer size with same-frame color, depth,
  and velocity;
- use a separate camera/pass or composed temporal node for authored/tiled view
  offsets;
- use a separately validated path for XR/ArrayCamera, resolution-scaled input,
  or cross-rebase preservation;
- recreate stock TRAA on incompatible history epochs because it has no public
  reset and does not restore prior view-offset state.

Stock r185 `TAAUNode` is experimental rather than a general substitute: its
source assumes standard perspective depth, lacks reversed/log/orthographic
branches, can copy incompatible depth formats, uses unscaled Halton jitter, and
updates the imported singleton velocity producer. Use it only after depth
format, jitter scale, velocity ownership, disocclusion, and output are validated
for that exact branch.

Define a stable history identity from camera/scene identity, projection epoch,
origin epoch, render extent/DPR, MRT layout, and velocity convention. Increment
the affected epoch before rendering when any component changes incompatibly.
Hard cuts, teleports, spawn/despawn or stable-identity changes, incompatible
projection changes, uncompensated origin changes, resize/DPR changes, and MRT
or velocity changes reset every dependent history.

Small continuous pose or lens changes preserve history only when depth and
velocity reconstruct the same previous/current mappings. Verify static detail,
motion, and disocclusion. Motion vectors use unjittered projections; each
temporal sample binds its own matching jitter once.

Minimal full-resolution graph:

```js
import { RenderPipeline } from 'three/webgpu';
import { mrt, output, pass, renderOutput, velocity } from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

const pipeline = new RenderPipeline(renderer);
const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({ output, velocity }));

const color = scenePass.getTextureNode('output');
const depth = scenePass.getTextureNode('depth');
const motion = scenePass.getTextureNode('velocity');

pipeline.outputNode = renderOutput(traa(color, depth, motion, camera));
pipeline.outputColorTransform = false;
```

Add normal, emissive, or other MRT attachments only for named consumers. In
the shown RGBA16F/depth graph, a nominal persistent lower bound is 40 bytes per
pixel: scene color `8`, velocity `8`, scene depth `4`, history color `8`,
history depth `4`, and resolve color `8`, before alignment, canvas storage,
copies, transients, and driver overhead.

## Camera-relative precision

Normal float32 spacing near magnitude `x` is approximately:

```text
ulp32(x) = 2^(floor(log2(abs(x))) - 23)
```

For a world-space error gate, require `ulp32(relativeMagnitude)` within the
allowed world error. For an image-space gate, propagate view-space error
through the active projection and viewport Jacobian. Perspective pixel error
depends on depth and off-axis position; comparing a world-unit ULP directly to
a pixel threshold is dimensionally invalid.

Choose one representation:

1. **Few ordinary meshes:** set `renderer.highPrecision = true` before compile
   and warmup; validate per-object/pass CPU cost and remember the instanced and
   skinned exclusions. This stabilizes current model-view computation; built-in
   previous matrices and velocity remain float32.
2. **Chunked scenes:** keep vertices chunk-local; at an origin epoch compute
   `chunkOrigin64 - cameraOrigin64` in JavaScript doubles and upload the small
   relative translation for changed chunks.
3. **Many instances or shared passes:** store relative chunk origins or split
   doubles:

```js
const high = Math.fround(value64);
const low = value64 - high;
```

Evaluate `(objectHigh - originHigh) + (objectLow - originLow)` in a shared
position path. Give that path a matching previous-position/velocity path;
stock velocity cannot infer a previous high/low origin.

Use compute rebasing only when the result is reused across enough passes or
feeds other culling/LOD work to beat a shared vertex subtraction or changed-
chunk upload on the measured workload.

### Rebase order

1. choose the new origin in CPU double precision;
2. publish immutable previous and current global-to-render transforms;
3. update chunk/group/storage relative translations;
4. update camera-relative pose and matrices;
5. update shadows, probes, culling, picking, and cached bounds;
6. reconstruct velocity from both transforms or increment history epoch;
7. render after every consumer sees the same epoch.

A tangent-frame reanchor can change rotation as well as translation; store the
complete transform. For a stationary global body, applying previous and current
global-to-render transforms to its matching stable-identity poses must produce
zero physical displacement after compensation. Stock TRAA still resets across
any origin translation or tangent-basis rebase because its history lacks that
complete cross-epoch mapping.

## Lifecycle and restoration

Snapshot only state the rig owns:

- transform, `up`, parent, layers, and matrix update flags;
- perspective `fov`, `near`, `far`, `aspect`, `zoom`, `filmGauge`,
  `filmOffset`, `focus`, and deep-copied view state;
- orthographic bounds, `near`, `far`, `zoom`, and view state;
- active owners and pose/projection/origin/history epochs;
- controls target/cursor, public configuration, enabled state, input locks, and
  listeners;
- output node/conversion owner, MRT layout, temporal nodes, and resolution;
- current/previous origin transforms and relative-buffer bindings.

Renderer depth policy is construction state rather than borrowed shot state.

On resize/DPR change, update aspect or orthographic extents, call
`updateProjectionMatrix()`, rebuild drawing-buffer-sized post/history targets,
update jitter scale, and increment the affected history epoch before render.

On disposal, release controls/listeners, temporal nodes, owned pass/post
resources, storage buffers, and debug objects. Restore borrowed state in a
`finally` path. After replacing or restoring `RenderPipeline.outputNode` or
`outputColorTransform`, set `needsUpdate = true`; warm the graph only after MRT
and post configuration is final.

## Workload and acceptance

Model cost from the selected branch:

```text
CPU = O(1) pose
    + bounds construction/update
    + O(P * I) support-point fit
    + spatial-query traversal and reported hits
    + O(Kchanged) origin updates
    + O(R) high-precision object/pass callbacks

originUploadBytes = Kchanged * bytesPerRelativeRecord
postPixelWork = sum(passPixels * samplesPerPixel)
frameAllowanceMs = 1000 / targetRefreshHz
```

Measure sustained orbit/pan, worst bounds refit, repeated owner handoffs,
origin crossings, resize/DPR changes, and the most expensive post/shadow view
after warmup and thermal stabilization. Keep CPU, GPU, presented-frame, memory,
and periodic-spike gates separate because CPU and GPU may overlap. Label GPU
timing unavailable when timestamp-query support is absent.

Acceptance checks:

- finite target clip coordinates, perspective `w > 0`, negative view-space
  `z`, and NDC inside the safe frame;
- right-handed basis and continuous roll through the up degeneracy;
- complete support-set fit and depth feasibility after obstruction;
- replay-rate-independent handoff endpoint and jump-free control reacquisition;
- exact restoration of null, disabled, and enabled view-offset states;
- matching color/depth/velocity camera frame and one jitter owner;
- resets for cuts, teleports, identity/projection/origin/extent/DPR/MRT changes;
- no pop, false velocity, or pick/cull disagreement across repeated rebases;
- resize coherence and leak-free mount/dispose cycles.

Failure signatures identify the broken contract: first-input jumps indicate
stale control state; target drift indicates owner contention; edge clipping
indicates a planar or pre-obstruction fit; projection pops indicate a missing
matrix update or epoch; large-world shimmer indicates float32 cancellation;
stationary motion across a rebase indicates mismatched previous/current
transforms; ghosting after cuts or resize indicates stale history identity;
and persistent listeners or targets indicate incomplete lifecycle ownership.
