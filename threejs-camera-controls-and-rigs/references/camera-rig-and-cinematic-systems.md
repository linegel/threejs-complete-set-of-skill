# General Camera, Controls, And Authored-Shot Systems

This reference defines camera architecture for product inspection,
architecture, scientific visualization, geospatial content, and authored
cinematography on the Three.js r185 WebGPU/TSL stack.

## Routing Map

| Requirement | Read first | Then validate |
| --- | --- | --- |
| fit arbitrary subjects or datasets | Bounds-Derived Framing | Obstruction And Near-Plane Clearance |
| interactive inspection or walkthrough | Controls And Handoffs | One-Writer Architecture |
| editorial/cinematic motion | Authored cinematography | Temporal Jitter And History Ownership |
| large coordinates | Camera-Relative Coordinates | Space Contract and temporal history |
| anti-aliasing/post | Temporal Jitter And History Ownership | Node Post, Depth, And Output |
| mobile/low-end delivery | Workload Breakpoints | Sustained Mobile Budget Protocol |

Section index: [evidence](#numerical-evidence-contract) ·
[r185 API](#r185-api-audit) · [ownership](#one-writer-architecture) ·
[spaces](#space-contract) · [basis](#canonical-camera-basis) ·
[framing](#bounds-derived-framing) · [domain contracts](#domain-framing-contracts) ·
[projection/depth](#projection-and-depth-precision) ·
[controls](#controls-and-handoffs) · [obstruction](#obstruction-and-near-plane-clearance) ·
[temporal](#temporal-jitter-and-history-ownership) ·
[large coordinates](#camera-relative-coordinates) ·
[post/output](#node-post-depth-and-output) · [lifecycle](#lifecycle-and-restoration) ·
[workload](#workload-breakpoints) · [mobile protocol](#sustained-mobile-budget-protocol) ·
[validation](#validation-matrix) · [rejected patterns](#rejected-patterns).

## Numerical Evidence Contract

Every consequential number is one of:

- **Derived** — follows from bounds, projection, viewport, IEEE-754 precision,
  adapter limits, target refresh rate, or an explicit equation.
- **Gated** — a hard correctness/resource threshold checked by validation.
- **Measured** — captured on a named device at a named resolution, DPR, scene,
  and sustained workload.
- **Authored** — composition or interaction intent: occupancy, lens, safe frame,
  damping, horizon, focus, or transition duration.

Do not copy millisecond targets, distances, near/far planes, FOVs, or damping
constants between scenes. Derive them, measure them, or label them Authored.

## r185 API Audit

The installed source is Three.js revision `185` (**Gated** by package lock and
runtime `REVISION`). The following interfaces are verified in that source:

| r185 interface | Verified behavior | Consequence |
| --- | --- | --- |
| `WebGPURenderer` | may internally select a WebGL backend unless checked after `await renderer.init()` | require `renderer.backend.isWebGPUBackend === true` for this architecture |
| `PerspectiveCamera.getViewBounds(distance, min, max)` | writes the lower-left and upper-right view-plane coordinates from `projectionMatrixInverse` | call `updateProjectionMatrix()` first; it is perspective-camera-only |
| `PerspectiveCamera.getViewSize(distance, target)` | returns `max - min` from `getViewBounds()`, cancelling principal-point translation | valid for centered planar size only; use bounds for asymmetric framing |
| `PerspectiveCamera.setViewOffset()` | writes `camera.view.{fullWidth,fullHeight,offsetX,offsetY,width,height}`, changes `aspect`, updates projection | snapshot the complete object, including `offsetX`/`offsetY` and prior aspect; orthographic setViewOffset does not own aspect |
| `reversedDepthBuffer`, `logarithmicDepthBuffer` | read-only renderer construction options | never switch or restore them per shot; reconstruct the renderer to change policy |
| `renderer.highPrecision` | CPU-computes model-view/normal-view matrices in JavaScript number precision | useful for non-instanced, non-skinned objects; r185 explicitly excludes `InstancedMesh` and `SkinnedMesh` |
| `traa(beauty, depth, velocity, camera)` | creates `TRAANode`; MSAA is disallowed by its r185 contract | provide same-frame depth and velocity from the scene pass |
| `TRAANode` jitter | before `RenderPipeline`, calls its own `camera.setViewOffset()`; afterward calls `camera.clearViewOffset()` | it does not compose or restore an authored view offset |
| `TRAANode` history | no public reset method; `dispose()` releases history/resolve targets and material | recreate at incompatible cuts/origin epochs or implement an explicitly owned temporal node |
| `TRAANode` sizing | jitter uses drawing-buffer size; depth history is copied only when that size equals the TRAA history target | stock r185 TRAA is a full-drawing-buffer path, not an arbitrary resolution-scaled input |
| `OrbitControls.update(deltaTime)` | `deltaTime` affects auto-rotation only; damping multiplies latent deltas once per call | stock damping is update-rate-dependent; use a fixed update cadence or a custom dt-correct controller when deterministic response matters |
| `OrbitControls` orientation | every update reconstructs quaternion from `position`, `target`, and the `up` basis cached at construction | a delivered quaternion alone is not a valid handoff; recreate controls after changing `camera.up` |
| timestamp queries | renderer option `trackTimestamp: true`, post-init `hasFeature('timestamp-query')`, and `resolveTimestampsAsync('render')` | returns timestamped render-pass samples, not compute/copy/presentation time; unsupported is unavailable, not zero |
| `RenderPipeline` | owns `outputNode`, `outputColorTransform`, and before/after pipeline callbacks | one final-output owner and one temporal-jitter owner |

Canonical initialization:

```js
import { WebGPURenderer, RenderPipeline } from "three/webgpu";

const renderer = new WebGPURenderer({
  reversedDepthBuffer: true, // Authored policy; validate every depth consumer.
  antialias: false,          // Gated when r185 TRAA is active.
  trackTimestamp: true,      // Measured when timestamp-query is available.
});

await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error("WebGPU backend required by the camera/render contract");
}
```

## One-Writer Architecture

Treat camera state as six independently owned channels:

| Channel | Sole writer during a frame |
| --- | --- |
| semantic pose | active controls, fit solver, authored shot, or external/XR owner |
| unjittered projection | active framing/shot owner |
| transient jitter | one temporal node during render only |
| coordinate origin | large-coordinate owner at an origin epoch |
| post camera data | one scene pass and its MRT/temporal nodes |
| lifecycle | scene/view manager |

Inactive controls emit intent or remain disabled; they do not write camera
transform. A handoff stage writes the delivered pose once and returns. A
temporal node never decides semantic framing.

Recommended state shape:

```ts
type CameraFrameState = {
  poseOwner: "controls" | "fit" | "authored" | "external";
  projectionOwner: string;
  temporalOwner: "none" | "traa" | "custom";
  positionWorld64: THREE.Vector3;
  orientation: THREE.Quaternion;
  targetWorld64?: THREE.Vector3;
  upConvention: "world" | "object" | "local-tangent" | "data-axis";
  projectionEpoch: number;
  originEpoch: number;
  historyEpoch: number;
};
```

Epochs are integer state versions (**Derived** from discontinuities), not frame
numbers. Increment only when the represented mapping changes incompatibly.

## Space Contract

| Space | Representation | Owner |
| --- | --- | --- |
| object local | asset/data coordinates | object/material |
| object world | JavaScript-number transform | scene/data model |
| global/geocentric | JavaScript doubles or explicit high/low split | coordinate system |
| local tangent | stable orthonormal frame at an anchor | geospatial/scientific owner |
| camera-relative | small float translation after origin removal | camera-origin owner |
| view | `camera.matrixWorldInverse` | camera |
| clip/NDC | `camera.projectionMatrix` | projection owner |
| screen/viewport | NDC plus viewport and DPR | application shell |
| jittered clip | temporary r185 TRAA view offset | temporal owner |

Document units, handedness, axis directions, and the exact point where each
conversion occurs. Do not mix global and rebased values in bounds, culling,
ray queries, shadow invalidation, or velocity reconstruction.

## Canonical Camera Basis

Three.js cameras view along local `-Z`. Given a desired position `p`, target
`t`, and up hint `u`:

```text
f = normalize(t - p)                    // visual forward
if previous right rPrev is valid and not parallel to f:
  r = normalize(rPrev - f * dot(f, rPrev)) // Gram-Schmidt continuity
else:
  if |dot(f, u)| crosses the entry gate:
    u = deterministicLeastAlignedAxis(f)  // not a random axis
  r = normalize(cross(f, u))
v = normalize(cross(r, f))
b = -f
camera basis columns = [r, v, b]
```

```ts
function computeCameraPose(
  outPosition,
  outQuaternion,
  target,
  desiredPosition,
  upHint,
  previousRight,
  basisState,
  scratch,
) {
  outPosition.copy(desiredPosition);
  scratch.forward.subVectors(target, desiredPosition);
  if (scratch.forward.lengthSq() <= basisState.aimLengthSqGate) {
    throw new Error("camera target and position are degenerate");
  }
  scratch.forward.normalize();

  let reusedRight = false;
  if (previousRight) {
    scratch.right.copy(previousRight).addScaledVector(
      scratch.forward,
      -previousRight.dot(scratch.forward),
    );
    if (scratch.right.lengthSq() > basisState.rightLengthSqGate) {
      scratch.right.normalize();
      reusedRight = true;
    }
  }

  if (!reusedRight) {
    scratch.up.copy(upHint);
    if (scratch.up.lengthSq() <= basisState.upLengthSqGate) {
      chooseLeastAlignedAxis(scratch.up, scratch.forward);
    } else {
      scratch.up.normalize();
    }
    const parallel = Math.abs(scratch.forward.dot(scratch.up));
    const useFallback = basisState.fallbackActive
      ? parallel > basisState.exitParallelGate
      : parallel > basisState.entryParallelGate;
    if (useFallback) chooseLeastAlignedAxis(scratch.up, scratch.forward);
    basisState.fallbackActive = useFallback;
    scratch.right.crossVectors(scratch.forward, scratch.up).normalize();
  }

  scratch.up.crossVectors(scratch.right, scratch.forward).normalize();
  scratch.back.copy(scratch.forward).negate();
  scratch.matrix.makeBasis(scratch.right, scratch.up, scratch.back);
  outQuaternion.setFromRotationMatrix(scratch.matrix).normalize();
  previousRight?.copy(scratch.right);
}
```

All length and parallelism gates are **Gated** from numerical-error tests for
the chosen precision; do not cargo-cult constants. Require
`exitParallelGate < entryParallelGate` so fallback does not chatter. A zero aim
vector must fail or explicitly retain the prior orientation. When reusing
`rPrev`, project it onto the new forward-orthogonal plane as shown; copying it
unchanged produces a non-orthonormal basis.

Validate the target in two distinct spaces. Transform a copy with
`camera.matrixWorldInverse` and require negative view-space `z`. Separately
project the target and require finite clip/NDC coordinates inside the Authored
target region. Avoid camera/control parents with non-uniform scale. Call
`updateWorldMatrix(true, false)` before mount reads and use `localToWorld()`,
`worldToLocal()`, `getWorldPosition()`, and `getWorldQuaternion()` at hierarchy
boundaries.

The routine above produces a world pose. Either Gate the active camera to an
identity parent with unit-scaled ancestry, or update the parent world matrix and
convert world position/orientation through its inverse world transform/rotation
before assigning the camera's local properties.

## Bounds-Derived Framing

### Planar fit

After `camera.updateProjectionMatrix()`:

```text
viewSize = camera.getViewSize(distance, outSize)
centeredOccupancyX = subjectPlaneWidth  / viewSize.x
centeredOccupancyY = subjectPlaneHeight / viewSize.y

[viewMin, viewMax] = camera.getViewBounds(distance, min, max)
require subjectPlaneMin/Max inside viewMin/Max for asymmetric framing
```

`getViewSize()` subtracts max-minus-min, so film/view offsets cancel. Its ratio
is **Derived** and exact only for centered size occupancy on a perpendicular
plane with a compatible centered safe frame. `getViewBounds()` retains
principal-point translation. Neither planar test is sufficient for a deep
object, oblique building, volume dataset, or multiple depths.

### Volume fit

Build the required point set from an oriented bound, convex hull support
points, section extent, or selected annotations. A bounding sphere's six axis
extrema are not a conservative perspective projection of the sphere; use its
analytic tangent cone or project a conservative enclosing box/hull. For a
candidate pose:

1. update camera world and projection matrices;
2. transform each point to view space and separately to homogeneous clip;
3. reject non-finite clip values and perspective `w <= 0`;
4. divide by `w`, compute the NDC envelope, and compare it with the Authored
   safe frame including any principal-point/view-offset shift;
5. for a fixed-axis perspective dolly, derive the independent distance interval
   satisfying `-far <= viewZ <= -near` for every point and intersect it with an
   all-positive-`w` occupancy bracket;
6. bisect only the XY occupancy residual while orientation, lateral shift,
   intrinsics, and a principal-point-containing safe frame remain fixed;
7. otherwise solve the lateral/frustum shift jointly or report the framing
   constraints infeasible; add only a documented Authored margin.

The fit cost is **Derived** `O(P * I)`, where `P` is required support points and
`I` is solver iterations. Cache static support points; do not project every
mesh vertex. For a distance bracket width `D` and distance tolerance
`epsilonD`, bisection needs at most
`max(0, ceil(log2(D / epsilonD)))` iterations;
alternatively stop on a predeclared NDC-envelope error. Validate the final pose
directly rather than trusting only solver convergence.

The combined occupancy-plus-depth predicate is not generally monotone: fixed
`far` eventually rejects an otherwise smaller image, and a safe frame excluding
the principal point can become invalid again. Never bisect that combined
boolean.

An obstruction solve changes the candidate pose and can invalidate framing.
Run the safe-frame/depth test again after moving the camera; iterate the coupled
solve to a declared convergence gate or report that clearance and framing
cannot both be satisfied.

### Perspective versus orthographic

- Perspective is correct when foreshortening, approach, or human-scale depth is
  part of interpretation.
- Orthographic is correct when parallelism, scale comparison, diagrams, plans,
  elevations, or slice inspection must not vary with distance.
- Changing an orthographic camera's distance does not change occupancy. Change
  frustum extent or `zoom`, then call `updateProjectionMatrix()`.
- For a perspective-to-orthographic handoff, match the complete view-plane
  bounds at the focus distance, including horizontal/vertical principal-point
  offset (**Derived**), before blending. Matching height alone changes framing
  for asymmetric projections. Do not interpolate projection matrices
  element-wise.

## Domain Framing Contracts

### Product and asset inspection

- Use visible geometry bounds, not an origin-centered guessed radius.
- Separate turntable object motion from camera orbit ownership.
- Fit protrusions and open/animated states with state-dependent bounds.
- Keep the near plane outside the subject under the complete allowed orbit and
  zoom range.
- Choose perspective lens or orthographic inspection as Authored intent; record
  it with the view.
- Use background/environment rotation independently of camera roll.

### Architecture and spatial design

- Declare the vertical axis and horizon policy.
- For two-point perspective, keep camera roll zero and optical axis level;
  frame tall content with lens shift/view offset instead of pitching the camera.
- `filmOffset` is horizontal only in `PerspectiveCamera`; vertical shift needs
  a view-offset/frustum policy.
- Derive near-plane clearance from the actual projection and route bounds; do
  not clip walls or section planes to hide a framing error.
- Distinguish navigation collision from visibility obstruction. An authored
  overview may intentionally see through a section plane; an interior route may
  require conservative clearance.

### Scientific and engineering visualization

- Record data units, axis mapping, projection type, clipping planes, and camera
  pose with every reproducible view.
- Use orthographic projection when screen distance must represent projected
  data distance in a declared plane; it does not preserve depth-axis distance.
  Record viewport size and zoom because pixels-per-unit changes with both.
- Use perspective when depth relationships are part of the phenomenon, but
  expose scale bars or reference geometry rather than implying metric screen
  distance.
- Fit required confidence regions/annotations, not only the mean geometry.
- Keep camera smoothing out of measurement capture unless it is explicitly
  Authored and the capture time is recorded.

### Geospatial and very large coordinates

- Maintain global coordinates in CPU double precision or a documented integer
  cell plus local-coordinate representation.
- Build a local east/north/up or other tangent basis at the anchor; use a stable
  pole/axis degeneracy rule.
- Perform horizon/visibility and global spatial queries in the global frame;
  convert only render inputs to camera-relative coordinates.
- Rebase on precision/error criteria, not an arbitrary travel distance.
- Treat origin changes as temporal, shadow-cache, probe, and picking epochs.

### Authored cinematography and editorial views

A shot record owns:

```ts
type Shot = {
  pose: { position: THREE.Vector3; quaternion: THREE.Quaternion };
  projection: PerspectiveRecord | OrthographicRecord;
  target?: THREE.Vector3;
  safeFrame: { minX: number; maxX: number; minY: number; maxY: number };
  focusDistance?: number;
  transition: "cut" | "blend";
  duration?: number; // Authored seconds when transition === "blend"
  historyPolicy: "auto" | "force-reset";
};
```

Express layout offsets in the shot basis, not unrelated global axes. A cut
always increments `historyEpoch`; authorship cannot override that correctness
event. `auto` preserves history only for a continuous compatible
pose/projection/origin/velocity mapping. A blend captures its start pose once, evaluates an
Authored time curve, writes one `lerp`/shortest-path `slerp`, and returns. This
is a state handoff, not a production camera path. Authored moving shots require
at least C1 position continuity (C2 where acceleration continuity matters), a
controlled time or arc-length parameterization, and separately constrained aim
and up fields. Validate safe frame, depth interval, angular velocity, and
obstruction continuously along the path, including between sampled keyframes.

## Projection And Depth Precision

Projection policy is part of the renderer contract:

- A perspective camera requires `near > 0`; r185 `OrthographicCamera` permits
  `near = 0`. In both cases place the near plane as far from the eye as the
  required visibility envelope permits.
- `far` is as close as the required visible envelope permits.
- Recompute per view/shot when the envelope changes, but add Authored/Gated
  hysteresis so the matrix does not oscillate with one-frame bounds noise.
- `reversedDepthBuffer` and `logarithmicDepthBuffer` are renderer-construction
  choices in r185. Do not toggle them on an existing renderer.
- Prefer reversed floating depth after verifying every post, shadow, readback,
  and custom depth node. Use logarithmic depth only from a measured need and
  validate derivatives, transparency, shadows, and reconstruction explicitly.

For standard perspective depth, representable resolution degrades rapidly with
distance and with the `far / near` ratio. Reversed depth improves distribution
but does not repair float32 world-coordinate cancellation. Track separately:

```text
projection precision  <- near, far, depth representation
transform precision   <- magnitude of coordinates entering float32 math
temporal precision    <- consistency of current/previous origin and matrices
```

Never hide transform jitter by widening the temporal filter.

### View-offset state

The r185 view state is:

```ts
type PerspectiveView = {
  enabled: boolean;
  fullWidth: number;
  fullHeight: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};
```

Snapshot `aspect` and preserve whether `view` was null; otherwise deep-copy all
view fields, including a disabled record's dimensions. Exact restoration is:
assign `camera.view = null` for a null snapshot or a fresh copy of the saved
record, restore the saved perspective `aspect`, then call
`updateProjectionMatrix()`. Calling only `clearViewOffset()` cannot restore a
prior disabled record because TRAA has overwritten its dimensions. Directly
replacing `camera.view` without the final projection update is insufficient.

## Controls And Handoffs

### OrbitControls

`OrbitControls` owns both camera transform and `target`. For product,
architecture, and data inspection:

- derive min/max distance or zoom from bounds and near/far safety;
- require an unparented camera or a parent whose transform is identity;
- restore the delivered semantic target when recorded; otherwise reconstruct
  `target = deliveredPosition + deliveredForward * authoredRadius`. Set
  `cursor` where used and validate the result against target/distance, polar,
  azimuth, and zoom constraints;
- recreate the controls, or explicitly flush every latent spherical, pan,
  dolly, scale, cursor-zoom, and interaction state before reacquisition. Public
  r185 API does not expose all of that latent state, so recreation is the
  robust boundary;
- recreate controls after changing `camera.up`; its up-to-Y quaternion is
  cached at construction;
- call one update and verify the resulting position, target, quaternion, and
  projection against the delivered handoff, not merely that no event fired;
- call `saveState()` only when reset semantics should change;
- snapshot public configuration and dispose event listeners on exit.

Disable it during authored blends. Do not run `controls.update()` after a shot
write in the same frame unless control reacquisition is the declared handoff.
`OrbitControls.update(deltaTime)` uses `deltaTime` for auto-rotation only;
damping applies once per update call. For deterministic damping across replay
rates, a fixed cadence is sufficient only for programmatic/no-DOM use: stock
pointer/wheel handlers call `update()` internally. Deterministic interactive
replay requires buffered intents and a custom dt-correct controller such as
`1 - exp(-lambda * dt)`. With an orthographic camera, OrbitControls is also a
projection writer because dolly changes `camera.zoom`. Its r185 orthographic
`zoomToCursor` path allocates temporary `Vector3`s during update; disable that
mode or patch it to owned scratch storage when zero transient allocation is a
Gated sustained-interaction requirement.

### Pointer-look / constrained walkthrough

Stock `PointerLockControls` requires an unparented/identity-parent conventional
y-up camera: mouse orientation is reconstructed with local `YXZ` Euler angles,
not arbitrary `camera.up`, and movement is local-matrix based. For a local
tangent, arbitrary data-up frame, or transformed parent, own yaw/pitch and
movement in that frame and build the camera basis explicitly.

On acquisition, derive controller yaw/pitch from the delivered camera
quaternion. Clear held-input state on unlock, blur, owner change, and disposal.
Pointer movement is input intent; spatial constraints and camera pose remain
separate stages.

### Frame-rate-independent handoff

For a time-bounded Authored blend:

```text
u = clamp((now - startTime) / authoredDuration, 0, 1)
e = authoredEase(u)
p = lerp(startPosition, targetPosition, e)
q = slerpShortest(startQuaternion, targetQuaternion, e)
if u == 1: copy target exactly
```

This interpolation is appropriate for a finite handoff. It is not a substitute
for the C1/C2 path, timing, aim/up, obstruction, and composition constraints of
an authored moving shot.

For continuous response, use:

```text
alpha = 1 - exp(-lambda * dt) // lambda is Authored; response is Derived
```

Do not stack continuous smoothing after an explicit transition. Clamp stalled
`dt`; substep a second-order spring when its stability region requires it.

## Obstruction And Near-Plane Clearance

When the subject must remain visible, cast from the aim point to the desired
camera position using the scene acceleration structure. A center ray alone
does not protect the near plane.

Derive the near-plane footprint from the active projection. For perspective,
`camera.getViewBounds(camera.near, min, max)` yields the asymmetric XY bounds.
For a fixed-orientation optical-axis dolly, sweep a sphere centered at the
near-plane rectangle center, offset from the eye by that center and `near`; its
radius is the rectangle half-diagonal. If the sweep center is constrained to
the eye path instead, the enclosing radius must include the near-axis offset as
well. With changing aim/orientation or lateral motion, sweep the transformed
near-plane corner hull/convex volume or a proven enclosure of the actual path.
For orthographic projection, derive the same footprint from frustum extents,
zoom, and view offset. Include an Authored clearance margin only after this
Derived footprint.

Resolve obstruction inward immediately when clipping would occur; recover
outward with a frame-rate-independent Authored response if desired. Keep aim
and obstruction solves separate. An explicit shot may disable obstruction only
as declared authorship, not accidentally through owner contention.

After obstruction changes the delivered pose, rerun safe-frame and depth
validation. A collision-free pose is not automatically a valid composition.

Update DOF focus from the delivered, post-obstruction pose.

## Temporal Jitter And History Ownership

r185 `TRAANode` performs this sequence:

```text
RenderPipeline before hook:
  camera.updateProjectionMatrix()
  save unjittered projection matrix internally
  camera.setViewOffset(fullSize, Halton-derived subpixel offset)

RenderPipeline render and TRAA resolve:
  consume beauty, depth, velocity, current/previous matrices

RenderPipeline after hook:
  camera.clearViewOffset()
  advance jitter index
```

Consequences:

1. The framing owner must finish the unjittered camera before pipeline render.
2. No other owner may call `setViewOffset()` between TRAA's hooks.
3. Stock r185 TRAA does not compose an existing asymmetric, tiled, or
   multi-viewport offset and does not restore it afterward.
4. Stock r185 TRAA exposes no public history reset.
5. One `RenderPipeline.context` callback pair implies one temporal-jitter owner.
6. `setViewOffset()` overwrites any existing view record and, on
   `PerspectiveCamera`, also overwrites `aspect`; `clearViewOffset()` disables
   the new record but restores neither a prior view nor perspective aspect.
7. Test three pre-render states separately: `view === null`, a non-null
   disabled view, and an enabled view. Stock TRAA preserves none exactly.
8. Jitter uses drawing-buffer dimensions. Previous depth is copied only when
   TRAA history dimensions equal drawing-buffer dimensions, so stock r185 TRAA
   is not an arbitrary-resolution temporal input path.
9. It is not an XR/multiview temporal owner: the scene pass may substitute an
   XR array camera while TRAA jitters the constructor camera.

If an authored view offset is required, render it through a separate camera /
pass without stock TRAA or implement one WebGPU temporal node that composes the
base frustum and jitter in a single owner. Do not patch the camera from two
independent loops.

Do not resolution-scale stock TRAA beauty/depth/velocity inputs. Stock r185
`TAAUNode` is experimental, not a general replacement: its source assumes
standard perspective depth, lacks reversed/log/orthographic branches, can copy
incompatible current/history depth formats, applies unscaled Halton jitter, and
updates the imported singleton velocity node rather than an arbitrary supplied
producer. Gate it to standard non-log perspective depth with the canonical
velocity node, or patch and validate depth format, jitter scale, custom
velocity, disocclusion, and output contracts. Otherwise choose among
full-resolution TRAA, Measured MSAA, spatial AA, or no AA; temporal AA is not a
universal mobile default.

Invalidate or recreate history when any of these change incompatibly:

- hard camera cut;
- projection type or discontinuous lens/near/far/view change;
- coordinate-origin epoch without previous-origin compensation;
- render size/DPR or MRT layout;
- scene identity or velocity convention.

Small continuous pose and projection changes may preserve history only when
velocity and depth reconstruction represent them correctly. Verify with
disocclusion and static-detail tests, not assumption.

## Camera-Relative Coordinates

### Float32 error criterion

The spacing of normal float32 values near magnitude `x` is approximately:

```text
ulp32(x) = 2^(floor(log2(|x|)) - 23)  // Derived
```

Keep world and image criteria dimensionally separate. For world-space tolerance
`epsilonWorld`, Gate relative magnitudes with `ulp32(xRelative) <=
epsilonWorld`. For a pixel tolerance, propagate a candidate view-space error
through the active projection and viewport:

```text
||deltaPixel|| <= || J_(viewport o projection)(xView) * deltaView ||
```

The orthographic Jacobian is constant for a fixed projection. The perspective
Jacobian varies with depth and off-axis position; for example its horizontal
term contains both `deltaX / -z` and `x * deltaZ / z^2`. Evaluate the worst
required visible envelope. Comparing a world-unit ULP directly with a pixel
tolerance is invalid.

### Representation choices

1. **Few ordinary meshes**: set `renderer.highPrecision = true` before graph
   compilation and warmup. The r185 setter changes renderer context nodes but
   does not version already-built graphs; rebuild owned pipelines/materials if
   the policy changes. It CPU-computes model-view; validate uniform/update
   cost. Do not use this as the instanced/skinned solution.
2. **Chunk-local geometry**: keep vertices small in each chunk. On an origin
   epoch, compute `chunkOrigin64 - cameraOrigin64` in JavaScript and upload the
   small translation once per changed chunk.
3. **Many instances**: store local float positions plus relative chunk origin,
   or split each double component:

```js
const high = Math.fround(value64);
const low = value64 - high;
```

   Evaluate `(objectHigh - originHigh) + (objectLow - originLow)` in a shared
   TSL position path. Keep high terms near each other; a high/low split is not a
   license to subtract unrelated astronomical magnitudes.

A custom high/low or rebased `positionNode` needs a matching previous-position
path for velocity. Stock r185 `VelocityNode` multiplies float32 previous
model-world and previous camera-view matrices by `positionPrevious`; it does
not infer the previous high/low origin. Supply compatible previous state/custom
velocity or invalidate temporal history.

Do not run a compute pass merely to subtract one uniform origin from every
instance. A vertex node or per-chunk epoch update is usually less bandwidth.
Use compute only when the relative result is reused across enough passes or
feeds additional culling/LOD work and the target trace Measures a win.

### Origin epoch ordering

On rebase:

1. choose the new global origin in CPU double precision;
2. update current and previous origin records;
3. update relative chunk/group/storage translations;
4. update camera relative pose and matrices;
5. update shadow/probe/culling/picking transforms;
6. either reconstruct velocity with both origin epochs or increment history
   epoch;
7. render only after every consumer sees the same epoch.

A local-tangent reanchor can change both translation and rotation. Store the
complete previous and current global-to-local transforms, not origins alone,
and make the coordinate-frame epoch visible to velocity, temporal history,
shadows, culling, picking, probes, and cached bounds.

Keeping `camera.position = 0` is optional. What matters is that camera and
renderable coordinates share the same small relative frame. This alone is not
enough for stock velocity/TRAA: their previous model/view and camera world/view
matrices remain float32 shader uniforms. Keep current and previous
camera-relative transforms small and mutually consistent.

## Node Post, Depth, And Output

Use one scene pass and request only needed MRT channels:

```js
import { RenderPipeline } from "three/webgpu";
import {
  pass, mrt, output, velocity, renderOutput,
} from "three/tsl";
import { traa } from "three/addons/tsl/display/TRAANode.js";

const renderPipeline = new RenderPipeline(renderer);
const scenePass = pass(scene, camera);

scenePass.setMRT(mrt({
  output,
  velocity,
}));

const color = scenePass.getTextureNode("output");
const depth = scenePass.getTextureNode("depth");
const motion = scenePass.getTextureNode("velocity");
const temporal = traa(color, depth, motion, camera);

renderPipeline.outputNode = renderOutput(temporal);
renderPipeline.outputColorTransform = false;
```

`renderOutput()` owns tone mapping/output conversion in this form, so
`outputColorTransform` is false. If the pipeline owns conversion instead, do
not wrap the same signal in another output conversion. This minimal TRAA graph
does not allocate normal or emissive attachments; add them only for declared
consumers such as GTAO or selective bloom.

For the shown RGBA16F output/velocity graph, a persistent nominal lower bound
is:

```text
scene output 8 + velocity 8 + scene depth 4
+ TRAA history 8 + history depth 4 + resolve 8 = 40 bytes/pixel // Derived
```

That is `40 * W * H` bytes: approximately `79.1 MiB` at `1920 * 1080`, before
canvas storage, alignment, mip levels, driver bookkeeping, and transients.
TRAA also adds a full-screen resolve draw, a presentation draw in this graph,
color-history copies, depth-history copies when dimensions match, and their
texture reads. Gate it by Measured bandwidth, memory, motion, disocclusion, and
static-detail quality on the target—not by the label "temporal" alone.

The r185 resolve graph has a **Derived source-level floor** of 21 texture-read
node operations per output pixel: nine current-depth loads, eight neighboring
beauty loads, and one each for velocity, previous depth, current beauty, and
history color. These are graph operations, not guaranteed physical memory
transactions; cache/coalescing is adapter-dependent. Account for history
copies and presentation separately.

Built-in camera-dependent nodes:

- `GTAONode` consumes depth and normal;
- `TRAANode` consumes color, depth, velocity, and camera;
- `DepthOfFieldNode` consumes view depth plus delivered focus state;
- `CSMShadowNode.updateFrustums()` must be called after camera projection or CSM
  settings change;
- `TileShadowNode` partitions the configured light-shadow projection; camera
  changes matter only when application code derives that projection from it.

Resolution scale is an Authored starting point followed by Measured evidence.
Do not declare a universal half-resolution policy, and do not apply arbitrary
scales to stock TRAA inputs. Transient depth, velocity, normal, and masks use
linear/no-color data handling. HDR color stays `HalfFloatType` until the single
tone-map owner.

## Lifecycle And Restoration

Snapshot:

- transform, `up`, parent, layers mask, matrix auto-update flags;
- perspective: `fov`, `near`, `far`, `aspect`, `zoom`, `filmGauge`,
  `filmOffset`, `focus`, and deep-copied `view`; `focus` affects stereo camera
  derivation even though it is distinct from post-process focus distance;
- orthographic: `left`, `right`, `top`, `bottom`, `near`, `far`, `zoom`, view
  state when applicable;
- active pose/projection/temporal/origin owners and their epochs;
- controls public state, target/cursor, enabled flag, input locks/listeners;
- RenderPipeline `outputNode`, `outputColorTransform`, MRT layout, resolution
  scales, and owned post nodes;
- current/previous camera origin and relative-buffer bindings.

Do not snapshot renderer `reversedDepthBuffer` or `logarithmicDepthBuffer` as
mutable shot state; r185 declares them read-only construction options.

Dispose controls/listeners, `TRAANode`, owned pass/post resources, storage
buffers, and debug objects. Set `renderPipeline.needsUpdate = true` after
changing or restoring either `outputNode` or `outputColorTransform`, including
temporal-node replacement. Warm only after MRT/post configuration is final;
restore camera/projection/controls in a `finally` block if warmup moves them.

## Workload Breakpoints

Model camera cost explicitly:

```text
CPU camera work = O(1) pose
                + Cbounds construction/update
                + O(P * I) projected-bound fit
                + sum(q spatial-query traversal + Hq reported hits)
                + O(Kchanged) origin-epoch updates
                + O(R) high-precision matrix callbacks when enabled

origin upload bytes = Kchanged * bytesPerRelativeRecord         // Derived
post pixel work      = sum(passPixels * samplesPerPixel)         // Derived
frame allowance      = 1000 / targetRefreshHz                    // Derived ms
```

Where:

- `P` = required bound/support points, not mesh vertices;
- `I` = monotone fit iterations;
- a balanced static BVH query is expected `O(log N + Hq)` but can be `O(N)`
  in the worst case; dynamic refit/rebuild maintenance is additional;
- `Kchanged` = chunks/records updated at an origin epoch.
- `R` = rendered object/pass pairs; r185 high precision CPU-composes model-view
  and normal-view matrices per pair, not once per camera.

Do not hide bound construction inside `P`. Cached analytic/asset bounds can be
`O(1)` per fit; exact `Box3.expandByObject(object, true)` may inspect vertices
and become vertex-linear. GPU-only displacement requires conservative analytic
or separately computed bounds because CPU geometry bounds do not see it.

Selection rules:

- If static bounds suffice, fit once and update only on bounds/view changes.
- If `Kchanged` is small, CPU group/chunk translations avoid compute setup and
  full-instance writes.
- If instanced/high-cardinality coordinates dominate, compare high/low vertex
  evaluation, storage epoch update, and compute reuse with Measured GPU and
  upload evidence.
- If post dominates, remove unused MRT channels and lower only the Measured
  expensive nodes; camera math is not the likely bottleneck.

## Sustained Mobile Budget Protocol

No fixed millisecond table is portable. Establish:

1. **Authored** target refresh rate, resolution, DPR, visual safe frame, and
   navigation/shot set.
2. **Derived** total frame allowance `1000 / targetRefreshHz`.
3. Before tracing, predeclare independent CPU, GPU, presented-frame,
   resident/transient-memory, periodic-spike, and headroom gates from the
   product's end-to-end allowance and concurrency requirements. CPU and GPU can
   overlap; do not add their durations as if they were serial.
4. **Gated** invariants: one pose writer, one projection writer, one jitter
   owner, zero steady-state allocations, no incompatible history reuse, and
   zero draws added by pose/control math. Temporal resolve/presentation draws
   are real post cost and are not covered by that zero-draw invariant.
5. **Measured** sustained traces after shader/pipeline warmup and thermal
   stabilization: CPU/GPU frame quantiles, camera-update quantiles,
   allocation/GC events, rebase upload/spike, temporal reset spike, post and
   shadow invalidation, memory, and dropped/presented frames.
6. Pass/fail against the predeclared gates; use the trace to select architecture,
   not to retroactively loosen the threshold.

For r185 GPU evidence, request `trackTimestamp: true` at renderer construction,
then after `await renderer.init()` Gate both
`renderer.backend.trackTimestamp === true` and
`renderer.hasFeature('timestamp-query')`. Periodically call
`await renderer.resolveTimestampsAsync('render')`; the returned milliseconds
also populate `renderer.info.render.timestamp`. Label it a timestamped
render-pass sample: it excludes compute-pool work, texture copies, queue gaps,
and presentation, and periodic resolution does not sample every intervening
frame. Resolve compute separately when present, declare sampling cadence, and
use an external target profiler for end-to-end GPU/presentation evidence.
Resolve often enough not to exhaust the finite query pool, but not synchronously
every frame. If the gate fails, report timing unavailable—never zero.

Test steady orbit/pan, worst bounds refit, repeated owner handoffs, repeated
origin crossings, resize/DPR changes, and the most expensive post/shadow view.
An average that hides periodic rebase or history-reset spikes is insufficient.

Choose degradation from the measured bottleneck while preserving declared
visual/scientific invariants:

- CPU bound: event-drive fits/rebases, cache analytic bounds, improve spatial
  acceleration, and remove duplicate writers;
- GPU bandwidth/memory bound: remove unused MRT channels, choose a cheaper
  validated AA path, and reduce only the expensive post buffers/passes;
- geometry/raster bound: reduce delivered visibility, LOD, overdraw, or
  displacement complexity without violating required annotations/measurements;
- presented-frame/thermal bound: reduce sustainable DPR/refresh workload with
  an explicit product policy;
- response complexity: simplify Authored motion only when its quality is the
  negotiable invariant.

## Validation Matrix

### Cross-cutting invariants

- target has finite clip coordinates, positive perspective clip `w`, negative
  view-space `z`, and NDC inside the Authored region;
- basis remains right-handed and roll-continuous near up degeneracy; zero aim
  follows the declared fail/retain-prior policy;
- world/local pose agrees under the declared identity-parent or inverse-parent
  conversion contract, with unit ancestry scale;
- pose/projection endpoint is identical at multiple replay rates;
- controls reacquire without first-update/first-input jumps and obey the
  delivered target/up/projection contract;
- every projection mutation updates the matrix before framing or render;
- null, disabled, and enabled view-offset states restore exactly;
- depth, normal, velocity, and color correspond to the same camera frame;
- stock TRAA is full drawing-buffer size and absent from XR/ArrayCamera paths;
- stock TAAU is absent from reversed/log/orthographic/custom-velocity paths
  unless a patched implementation passes its explicit depth/jitter gate;
- hard cuts and origin epochs do not blend incompatible temporal history;
- repeated origin crossings show no instance pop, false velocity, or pick/cull
  disagreement;
- dispose/recreate loops leave no controls, post targets, or storage resources.

### Workload cases

| Workload | Required test |
| --- | --- |
| Product | extreme aspect assets, protrusions, open/animated states, full allowed orbit, orthographic/perspective switch |
| Architecture | tall facade without vertical convergence when required, constrained interior route, section plane, asymmetric frame |
| Scientific | reproducible pose serialization, axis/unit change, orthographic scale check, annotation/confidence-region fit |
| Geospatial | representative global coordinates, tangent-frame degeneracy, multiple origin epochs, horizon transition |
| Cinematic | cut, interrupted blend, projection change, focus update, return to controls, temporal reset |

Expose diagnostics:

```text
pose/projection/temporal/origin owner and epoch
camera basis, target camera-space z, target NDC
required bound points and NDC envelope versus safe frame
projection type and all projection parameters
unjittered and jittered projection identity
current/previous origin and maximum relative-coordinate magnitude
derived float32 ULP bound versus allowed error
MRT channels, post scales, temporal-history state
controls target/cursor/yaw/pitch and handoff state
obstruction hit and derived near-plane footprint
CPU/GPU workload counts and measured sustained quantiles
```

## Rejected Patterns

- fixed camera distance for arbitrary assets;
- one camera loop for controls plus another for authored shots;
- non-uniformly scaled camera parents and blind `lookAt()`;
- planar `getViewSize()` used as a deep-volume fit;
- huge global near/far defaults;
- per-shot mutation of read-only renderer depth policy;
- stock r185 TRAA combined with an independently authored view offset;
- stock r185 TRAA on resolution-scaled inputs or XR/ArrayCamera rendering;
- reusing temporal history across a hard cut or uncompensated origin epoch;
- copying an authored quaternion into OrbitControls without reconstructing its
  target and latent state;
- changing `renderer.highPrecision` after graph warmup without rebuilding owned
  graph state;
- subtracting large global float32 positions in the vertex shader;
- compute-updating every instance each frame when an origin-epoch update or
  shared vertex subtraction is sufficient;
- copied millisecond budgets without a sustained target-device trace.
