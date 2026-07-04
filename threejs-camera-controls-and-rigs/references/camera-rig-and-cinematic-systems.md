# Camera Rig And Cinematic Systems

Use this reference for WebGPU/TSL camera direction: scale-aware chase, side,
orbit, authored-shot, pointer-look, floating-origin, projection/depth, node
post-pipeline, collision, and lifecycle systems.

## Contents

- Architecture and renderer contract
- Capability gate and quality tiers
- Space and interface contract
- Camera contract
- Canonical camera basis
- Visible correctness signatures
- Screen occupancy and projection
- Scale-aware chase mount
- Thrust-lag spring
- Side and orbit camera
- Explicit camera handoffs
- Authored cinematic shots
- Pointer-look and orbit controls
- Camera collision and obstruction
- Floating origin and storage-buffer world offsets
- Node post, depth, color, and output ownership
- Lifecycle restoration
- Performance budgets
- Validation and diagnostics

## Architecture And Renderer Contract

The best-in-class camera architecture is a single, explicit camera owner that
emits one pose and one projection contract per frame. Camera code stays mostly
CPU-side because semantic framing, handoffs, and input constraints are branchy
and low-cardinality. The WebGPU/TSL work is in the rendering contract that the
camera drives: camera-relative coordinates, storage-buffer world offsets,
MRT depth/normal/velocity outputs, node post, and depth precision.

Use only this baseline:

```ts
import { WebGPURenderer, RenderPipeline } from "three/webgpu";
import {
  pass,
  mrt,
  output,
  normalView,
  emissive,
  renderOutput,
} from "three/tsl";
```

Construct node post with `const renderPipeline = new RenderPipeline(renderer);`.

Materials that need camera-relative deformation or per-instance offsets should
be `MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`,
`MeshBasicNodeMaterial`, `SpriteNodeMaterial`, or another `NodeMaterial`
family member. Per-instance large-world offsets belong in
`StorageInstancedBufferAttribute` or `StorageBufferAttribute` and are consumed
through TSL `storage()` nodes. Large dynamic fields are updated with
`renderer.compute()` or `renderer.computeAsync()`; small camera pose math is
not moved to compute.

## Capability Gate And Quality Tiers

Initialize once before choosing any compute, storage, or MRT path:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error("WebGPU backend required for the canonical camera rig path. If the user explicitly asks how to apply fallback when WebGPU is unavailable, route to threejs-compatibility-fallbacks.");
}

const cameraTier = "full";
```

Full tier:

- storage-buffer world offsets for instanced star fields, terrain chunks,
  city tiles, debris, or other large camera-relative sets;
- compute updates for dynamic instance offsets or velocity/history fields;
- `pass(scene, camera)` with MRT outputs for color, depth, normal, emissive,
  and velocity where post nodes need them;
- `TRAANode` camera jitter, `GTAONode`, `BloomNode`, `DepthOfFieldNode`,
  `CSMShadowNode`, and `TileShadowNode` where the shot requires them.

Budgeted WebGPU tier:

- same camera owner and projection rules;
- smaller LOD sets and lower update cadence inside the WebGPU architecture;
- lower `setResolutionScale()` values for post;
- no parallel renderer recipe and no custom material-language rewrite.

Teaching how to apply fallback when WebGPU is unavailable belongs only in
`../threejs-compatibility-fallbacks/` when the user explicitly asks for it.

## Space And Interface Contract

| Space | Conversion API | Owner |
| --- | --- | --- |
| subject local | `updateWorldMatrix`, `localToWorld` | subject rig or imported asset |
| mount local | `updateWorldMatrix`, `getWorldPosition`, `getWorldQuaternion` | camera owner |
| world | `worldToLocal`, `localToWorld` | scene simulation |
| camera-relative world | subtract floating-origin storage origin | large-world camera owner |
| view | `matrixWorldInverse` | camera |
| clip/NDC | `projectionMatrix` | projection owner |
| screen UV | NDC remap and viewport state | app shell |
| view depth | scene pass depth/view-z node | node post pipeline |
| storage-buffer origin | `StorageBufferAttribute`/`StorageInstancedBufferAttribute` camera origin | compute/storage owner |
| view offset | `setViewOffset` / `clearViewOffset` | camera or TRAA owner |

## Camera Contract

Record before implementation:

```ts
type CameraDirectionContract = {
  subject: THREE.Object3D;
  subjectBounds: THREE.Box3 | THREE.Sphere;
  subjectScale: number;
  projection: {
    fov: number;
    near: number;
    far: number;
    zoom?: number;
    viewOffset?: {
      fullWidth: number;
      fullHeight: number;
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
  };
  depthMode: "standard" | "reversed" | "logarithmic";
  positionMode: "authored" | "mount" | "body-relative" | "floating-origin";
  upMode: "world" | "subject" | "dominant-body";
  inputMode: "locked" | "pointer-look" | "orbit-offset";
  postNeeds: ("depth" | "normal" | "velocity" | "emissive")[];
  handoffOwner: string;
  spatialConstraints: string[];
};
```

Do not combine modes until each can produce a valid position and quaternion
independently. The camera owner writes the final pose once.

## Canonical Camera Basis

Three.js cameras look along local `-Z`. Build basis math around that fact.
Let `visualForward = normalize(target - position)`, then the camera local
columns are:

```text
right = normalize(cross(visualForward, upHint))
up = normalize(cross(right, visualForward))
back = -visualForward
matrix basis columns = right, up, back
quaternion = setFromRotationMatrix(matrix)
```

If `visualForward` and `upHint` are nearly parallel, replace `upHint` with a
stable tangent fallback before computing `right`. Normalize the final
quaternion. Validate every new rig by projecting the look target; it should be
inside a small screen-center tolerance.

## Visible Correctness Signatures

| Signature | Must see | If wrong |
| --- | --- | --- |
| basis center | target in front and near screen center | forward sign error means target is behind the camera or blank |
| orbit handedness | yaw right moves the view around the subject consistently | cross-order error creates mirrored orbit motion |
| up degeneracy | near-pole or vertical shots keep stable roll | up degeneracy creates a roll flip |
| handoff smoothing | 30/60/120 FPS handoff reaches the same endpoint | fixed-alpha smoothing causes FPS divergence |
| depth envelope | tight near/far has clean depth/post outputs | excessive far creates z-fighting or depth bands |
| floating origin | origin shifts keep instances stable | origin-order error causes instance popping |

Canonical helper shape:

```ts
function computeCameraPose(
  outPosition: THREE.Vector3,
  outQuaternion: THREE.Quaternion,
  target: THREE.Vector3,
  desiredPosition: THREE.Vector3,
  upHint: THREE.Vector3,
  scratch: CameraScratch,
) {
  outPosition.copy(desiredPosition);

  scratch.forward.subVectors(target, desiredPosition).normalize();
  if (Math.abs(scratch.forward.dot(upHint)) > 0.985) {
    chooseStableUpFallback(scratch.upHint, scratch.forward);
  } else {
    scratch.upHint.copy(upHint);
  }

  scratch.right.crossVectors(scratch.forward, scratch.upHint).normalize();
  scratch.up.crossVectors(scratch.right, scratch.forward).normalize();
  scratch.back.copy(scratch.forward).multiplyScalar(-1);

  scratch.matrix.makeBasis(scratch.right, scratch.up, scratch.back);
  outQuaternion.setFromRotationMatrix(scratch.matrix).normalize();
}
```

Avoid camera/control parents with non-uniform scale. `lookAt()` and rotation
extraction from matrices are unreliable under non-uniform parent chains. Call
`updateWorldMatrix(true, false)` before reading mounts, then use
`localToWorld()`, `worldToLocal()`, `getWorldPosition()`, and
`getWorldQuaternion()` for crossings.

## Screen Occupancy And Projection

Start from subject bounds and desired occupancy, not a guessed distance.

```text
subjectRadius = boundingSphere.radius
viewSize = camera.getViewSize(distance, scratch.viewSize)
verticalOccupancy = (subjectRadius * 2) / viewSize.y
horizontalOccupancy = (subjectRadius * 2) / viewSize.x
```

Use `camera.getViewSize(distance, scratch.viewSize)`. For asymmetric framing,
use `camera.getViewBounds(distance, scratch.minView, scratch.maxView)` and
place the target in the desired normalized region. For multi-viewport,
split-screen, tiled display, or TRAA jitter, snapshot and restore
`setViewOffset()` / `clearViewOffset()` state with the shot.

Projection policy:

- keep `near > 0` and as large as the shot allows;
- keep `far` as small as the visible envelope allows;
- use separate near/far envelopes per chase, cockpit, orbital, cinematic, and
  debug mode;
- update `camera.updateProjectionMatrix()` after any change to `fov`, `near`,
  `far`, `aspect`, `zoom`, `filmGauge`, `filmOffset`, or view offset;
- prefer `reversedDepthBuffer: true` on `WebGPURenderer` for large depth
  ranges when post/shadow validation passes;
- use `logarithmicDepthBuffer` only for measured cases where
  camera-relative rendering plus reversed depth is insufficient.

Scene-specific values may be useful presets, not defaults. Huge far planes
must be justified by the current shot and validated against node post and
shadow nodes.

## Scale-Aware Chase Mount

Derive the chase mount from subject dimensions:

```text
height = subjectLength * 0.5
back = subjectLength * 1.3
mount local position = (0, height, -back)

look target local:
  up = subjectLength * 0.0001
  forward = subjectLength * 0.35
```

Read the mount world pose after `subject.updateWorldMatrix(true, true)`.
Apply `computeCameraPose()` with the target and stable up frame. If a model
requires a final 180-degree correction, treat it as an asset import fix on the
mount, not a camera convention.

The mount may be parented to the subject root for authored offsets, but the
runtime camera should still receive an explicit world position/quaternion. Do
not let a non-uniform parent chain own the camera.

## Thrust-Lag Spring

Use a bounded scalar spring only when acceleration weight is part of the shot.
Keep rotation lag separate unless there is an authored reason to smear aim.

Example tuned values from the previous planet-space rig:

```text
throttle max = 3.8
boost max = 5.8
combined max = 8.2

drive acceleration:
  throttle 12
  boost 22.8

held stiffness:
  throttle 6
  boost 7.5

return stiffness = 34
held damping ratio = 1.04
return damping ratio = 1.30
```

Per component:

```text
damping = 2 * dampingRatio * sqrt(stiffness)
acceleration = activeDrive - stiffness * distance - damping * velocity
velocity += acceleration * dt
distance += velocity * dt
distance = clamp(distance, 0, maxDistance)
```

Clamp tab-stall `dt` before integration. If clamping blocks velocity in the
same direction, zero it. For stronger stiffness or lower frame rates, substep
the spring with a fixed maximum substep. Apply total lag along negative
subject forward after reading the chase mount’s world pose.

For first-order follow smoothing, use exp decay:

```text
response = 1 - exp(-lambda * dt)
value = lerp(value, target, response)
```

This is frame-rate independent. Do not replace it with a fixed per-frame
alpha.

## Side And Orbit Camera

Scale-aware offsets after the subject model loads:

```text
side = (
  subjectLength * 3.2,
  subjectLength * 1.0,
  -subjectLength * 1.35
)

orbit = (
  subjectLength * 4.85,
  subjectLength * 1.35,
  -subjectLength * 2.15
)
```

For planetary scenes, use the dominant-body radial vector as up:

```text
bodyUp = normalize(subjectPosition - bodyPosition)
```

For orbit lock, forward comes from relative velocity when speed is valid;
otherwise it comes from subject orientation. Project forward onto the body
tangent plane:

```text
tangent = forward - bodyUp * dot(forward, bodyUp)
```

If tangent degenerates, rebuild it from a stable tangent fallback. Then rebuild
the frame:

```text
right = normalize(cross(bodyUp, tangent))
tangent = normalize(cross(right, bodyUp))
offset =
  right * offset.x
  + bodyUp * offset.y
  + tangent * offset.z
```

Example response rates:

```text
side forward lambda = 6.5
offset lambda = 3.6
mode blend lambda = 3.2
```

Convert these to `1 - exp(-lambda * dt)` each frame.

Yaw rotates the offset around `bodyUp`. Pitch rotates around
`cross(bodyUp, offset)`. Bound pitch per flight mode and enforce camera height
above subject:

```text
landed minimum = subjectLength * 0.42
other side-camera minimum = subjectLength * 0.20
```

Look target:

```text
target = subjectPosition + bodyUp * subjectLength * 0.12
pose = computeCameraPose(cameraPosition, cameraQuaternion, target, position, bodyUp)
```

Keep coordinate ownership explicit. If the side camera is stored in
subject-root-local coordinates, convert once at the boundary and document it.

## Explicit Camera Handoffs

Capture position and quaternion at transition start. Blend once:

```text
eased = 1 - (1 - t)^1.8
position = lerp(startPosition, targetPosition, eased)
orientation = slerp(startQuaternion, targetQuaternion, eased)
```

Critical invariant:

```text
explicit transition active
  -> write camera directly from one lerp/slerp
  -> update projection only if the shot owns it
  -> return from camera update
```

Do not apply the normal follow smoother after this interpolation. Stacked
smoothing causes mid-transition stalls and inconsistent 30/60/120 FPS results.

Outside explicit transitions, follow the final chase/side pose with exp decay.
At effectively zero blend, copy the target pose exactly to prevent a permanent
subpixel tail.

If `TRAANode` is active, update the jittered view offset in the same projection
ownership block as the camera handoff. Do not let TRAA jitter leak into a
different camera owner.

## Authored Cinematic Shots

Each cinematic scene owns its shot and projection values. Example presets from
the previous implementation:

```text
Saturn approach:
  FOV 40
  near 12
  far 360000

spin docking:
  FOV 46
  near 35
  far 90000
```

Save and restore full projection state, not just FOV/near/far.

Use authored anchors to define the camera frame:

```text
visualForward = normalize(lookTarget - cameraPosition)
right = normalize(cross(visualForward, worldUp))
up = normalize(cross(right, visualForward))

staging center = cameraPosition + visualForward * shotDistance
```

Subject offsets should be expressed in this shot basis. This is more robust
than retuning independent world coordinates after the camera is framed.

Hard anchoring to a rapidly accelerating subject is correct when composition
is more important than inertial feel. Use thrust lag or springs only when the
shot calls for camera weight.

## Pointer-Look And Orbit Controls

Use stock `PointerLockControls` for ordinary y-up first-person scenes. Its
movement helpers assume y-up motion, so use a custom body-relative controller
for spherical planets, walkable ships with custom gravity, or any dominant-body
up frame.

Custom pointer-look rules:

```text
Euler order = YXZ
pitch clamp = +/- (Math.PI / 2 - 0.01)
yaw -= mouseDeltaX * sensitivityX
pitch -= mouseDeltaY * sensitivityY
```

Re-sync yaw/pitch from the camera quaternion whenever pointer lock is
acquired. Clear movement keys on pointer-lock exit, window blur, and any
update while unlocked.

Movement is a separate layer from spatial constraints:

```text
forward = camera world direction projected to allowed movement plane
right = normalize(cross(forward, up))
distance = movementSpeed * dt
```

`OrbitControls` owns a target. After manual camera changes, set the target,
sync cursor/state where used, and call `controls.update()`. Disable controls
during authored shots and handoffs, then re-enable only after the camera and
controls agree on target, distance, azimuth, polar angle, and damping state.
Dispose listeners when the camera owner exits.

## Camera Collision And Obstruction

Collision is part of camera direction, not physics ownership. Use the scene’s
broadphase or a bounded ray/sphere cast from target to desired camera:

```text
cast origin = look target
cast direction = desiredCamera - target
cast length = distance(target, desiredCamera)
camera radius = max(nearPlaneWorldRadius, authoredCollisionRadius)
```

Clamp to the nearest non-penetrating position with near-plane clearance. Keep
the obstruction solve separate from aim. Smooth recovery outward with exp
decay; snap inward when needed to prevent clipping. Never allow collision
recovery to fight an explicit handoff stage.

For `DepthOfFieldNode`, update focus distance from the post-collision camera
pose, not the desired unobstructed pose.

## Floating Origin And Storage-Buffer World Offsets

For large scenes, compute a virtual camera pose in world coordinates, then
render camera-relative coordinates:

```text
virtualCameraPosition = world-space authored camera
camera.position = (0, 0, 0)
camera.quaternion = virtualCameraQuaternion
floatingOrigin = virtualCameraPosition
renderableRelativePosition = renderableWorldPosition - floatingOrigin
```

For a few large groups, update group positions CPU-side. For many chunks or
instances, store world origins in `StorageBufferAttribute` or
`StorageInstancedBufferAttribute` and subtract the camera origin in TSL:

```ts
// Conceptual node graph: instance world origin and per-frame origin uniform.
relativeWorldOffset = storageWorldOrigin.sub(cameraOriginUniform);
```

Use `renderer.compute()` / `renderer.computeAsync()` when dynamic camera-
relative data must be regenerated for many instances. Static chunk origins are
computed once; per-frame work should only update fields that actually depend
on camera origin, velocity, wind, streaming, or LOD.

Stars and infinite backgrounds should be camera-relative when they represent
non-parallax backgrounds. Nearby debris, sky layers, reflection probes, XR
anchors, and physical atmosphere volumes may need distinct ownership.

Storage textures and data buffers for offsets, masks, velocity, depth helpers,
and LUTs use `NoColorSpace`/linear data. Color textures use `SRGBColorSpace`.

## Node Post, Depth, Color, And Output Ownership

The camera owner must define the post stack’s camera dependencies. Use one
scene pass and share data through MRT where possible:

```ts
const renderPipeline = new RenderPipeline(renderer);
const scenePass = pass(scene, camera);

scenePass.setMRT(mrt({
  output,
  normal: normalView,
  emissive,
}));

const colorNode = scenePass.getTextureNode("output");
const depthNode = scenePass.getTextureNode("depth");
const normalNode = scenePass.getTextureNode("normal");
const viewZNode = scenePass.getViewZNode("depth");

renderPipeline.outputNode = renderOutput(colorNode);
```

Use built-in nodes before custom effects:

- `GTAONode`: import `ao` from `three/addons/tsl/display/GTAONode.js` for
  ambient occlusion from depth and normals; run at
  `resolutionScale = 0.5` unless inspection requires full resolution.
- `BloomNode`: import `bloom` from `three/addons/tsl/display/BloomNode.js` for
  bloom, using the emissive MRT output for selective bloom.
- `TRAANode`: import `traa` from `three/addons/tsl/display/TRAANode.js` for
  temporal reprojection; it owns camera jitter/view offsets and
  requires depth and velocity.
- `DepthOfFieldNode`: import `dof` from
  `three/addons/tsl/display/DepthOfFieldNode.js` for DOF from `viewZNode` and
  camera-derived focus.
- `CSMShadowNode`: import `CSMShadowNode` from
  `three/addons/csm/CSMShadowNode.js` for cascaded directional shadows.
- `TileShadowNode`: import `TileShadowNode` from
  `three/addons/tsl/shadows/TileShadowNode.js` for tiled shadowing in large
  scenes. Update frustums or tiles after camera projection changes.

Color/output rules:

- HDR working buffers stay `HalfFloatType` until tone mapping.
- There is one tone-map owner and one output conversion owner. The node
  pipeline owns final conversion through `outputColorTransform` or explicit
  `renderOutput()`.
- Do not double-convert inside materials or effects.
- Color textures use `SRGBColorSpace`; data maps use `NoColorSpace`/linear.
- Decide mipmap generation per data use. Do not auto-mipmap transient
  velocity, depth, or mask data unless the node graph samples it that way.

Depth validation:

- test reversed depth against all depth-consuming nodes in the post stack;
- compare shadow stability before/after projection changes;
- verify logarithmic depth only when used intentionally;
- inspect depth, normal, velocity, and color outputs from the same camera
  frame after every shot handoff.

## Lifecycle Restoration

Snapshot and restore:

- camera transform, `up`, layers, parent ownership, and matrix update flags;
- projection: `fov`, `near`, `far`, `aspect`, `zoom`, `filmGauge`,
  `filmOffset`, `view`, and active jitter;
- controls: enabled state, target/cursor, damping state, pointer-lock state,
  key state, event listeners, and any custom yaw/pitch;
- render pipeline output node, `outputColorTransform`, pass layers, MRT
  layout, resolution scales, and node resources owned by the shot;
- renderer depth assumptions: `reversedDepthBuffer`, `logarithmicDepthBuffer`,
  output buffer type, and post nodes that depend on depth;
- floating-origin offset, storage-buffer bindings, and camera-relative
  background state.

Scene manager pattern:

```text
dispose active camera owner
dispose active scene post nodes and controls
clear scene-root children owned by scene
create next scene
await init
restore or apply projection and post contract
```

Precompile/warm only after the pass/MRT/post configuration is complete. If a
warmup temporarily moves the camera, restore position, quaternion, projection,
view offset, and controls in `finally`.

## Performance Budgets

Camera update budgets are strict because camera code runs every frame and
competes with post and simulation:

```text
one active camera owner CPU update:
  desktop discrete GPU target: <= 0.10 ms
  desktop integrated target: <= 0.20 ms
  mobile target: <= 0.35 ms

allocations during steady update: 0
explicit handoff pose blends: 1
camera-added production draw calls: 0
debug draw calls: toggleable only
```

Large-world storage path:

```text
static offset generation: once per loaded chunk
dynamic camera-relative compute: <= 1 dispatch per dynamic field
storage offset target:
  desktop discrete: <= 0.15 ms
  desktop integrated: <= 0.35 ms
  mobile: <= 0.70 ms
```

Node post path:

```text
scene passes: 1 primary pass with MRT where possible
AO: 0.5 resolution scale default
bloom: reduced resolution unless final hero shot needs full resolution
DOF: reduced resolution where acceptable
TRAA: no MSAA at the same time
shadow updates: only after camera/light/frustum invalidation
```

Use `renderer.info`, browser GPU profiling, and fixed camera replay traces for
evidence. Algorithm class dominates micro-optimizations: camera-relative
rendering plus tight depth ranges beats trying to hide enormous coordinates in
post.

## Validation And Diagnostics

## Build Order Checkpoints

- Checkpoint: basis debug. Must see target centered and camera-space z
  negative; if you see a blank frame, inspect forward sign and basis columns.
- Checkpoint: screen-occupancy box. Must see desired subject bounds inside the
  frame; if you see crop drift, inspect `getViewSize`/`getViewBounds` targets.
- Checkpoint: handoff replay. Must see the same endpoint at 30/60/120 FPS; if
  you see divergence, inspect stacked smoothing or fixed-alpha follow.
- Checkpoint: controls reacquire. Must see yaw/pitch or orbit target match the
  camera; if you see a jump on input return, inspect control sync.
- Checkpoint: obstruction clamp. Must see near-plane clearance; if you see
  wall clipping, inspect ray/sphere cast distance and camera radius.
- Checkpoint: depth/post outputs. Must see one consistent depth/normal/velocity
  frame; if you see z-fighting, inspect near/far, reversed depth, and pass
  ownership.
- Checkpoint: floating-origin pop test. Must see stable instances after origin
  shifts; if you see instance popping, inspect storage origin update order.

Run these cases before considering a camera rig complete:

- 30/60/120 FPS replay of chase, side, orbit, and explicit handoffs;
- interrupted transitions and immediate return to user controls;
- pointer-lock exit/reacquire with yaw/pitch sync;
- orbit handoff with target/cursor sync and `controls.update()`;
- resize, DPR change, tab restore, and view-offset changes;
- non-uniform camera/control parent absence;
- large-coordinate jitter at representative world positions;
- subject screen-occupancy checks with `getViewSize()` / `getViewBounds()`;
- reversed-depth, logarithmic-depth, shadow, AO, DOF, bloom, and TRAA
  compatibility under every projection mode used by the shot;
- storage-buffer origin changes without visible instance popping;
- lifecycle disposal with no leaked controls, post nodes, or scene-owned
  projection state.

Expose debug diagnostics:

```text
camera mode and owner
design-frame guides and subject screen bounds
camera local basis and projected target
body-up/tangent/right vectors
chase mount and thrust-lag distance/velocity
side/orbit target pose and blend
handoff start, target, t, and easing
FOV/near/far/zoom/view offset and depth mode
MRT outputs and node post resolution scales
constraint contacts and obstruction distance
floating-origin offset and storage-buffer update count
camera-relative background state
```

## Replaced Techniques

- Risky `makeBasis(right, up, forward)` plus a model-specific 180-degree
  correction was replaced with a canonical `-Z` camera basis and asset-level
  mount fixes.
- Huge global near/far defaults were replaced with per-mode tight projection
  envelopes, camera-relative rendering, and measured reversed-depth use.
- Fixed per-frame smoothing was rejected in favor of exp-decay smoothing and
  bounded springs with `dt` clamp/substeps.
- CPU-updated per-instance large-world offsets at scale were replaced with
  storage-buffer offsets and compute updates for dynamic fields.
- Multi-pass post recipes were replaced with one `RenderPipeline` scene
  `pass()` using MRT and built-in nodes.
