---
name: threejs-camera-controls-and-rigs
description: Build advanced Three.js WebGPU/TSL camera controls and rigs. Use for scale-aware chase rigs, thrust lag, side/orbit cameras, body-relative up vectors, quaternion handoffs, authored cinematic framing, floating origins with storage-buffer world offsets, pointer-look controls, camera collision constraints, projection/depth ownership, node post-pipeline integration, and lifecycle restoration.
---

# Camera Controls and Rigs

Treat the camera as an authored visual system, not a passive viewport. The
fast path is renderer-agnostic camera ownership expressed on the current
Three.js WebGPU stack: `WebGPURenderer` from `three/webgpu`, TSL
(`three/tsl`), `NodeMaterial` materials, and `RenderPipeline` node post.

## Architecture First

The best architecture for camera direction is not a shader trick. It is a
single camera owner that computes a semantic pose, writes projection/depth
state once, and feeds the node render pipeline with stable camera-relative
coordinates. Keep this order:

1. Define the design frame: subject bounds, desired screen occupancy, lens,
   near/far envelope, target frame time, post stack, and horizon/up convention.
2. Build semantic target poses in subject, body, docking-axis, or
   shot-authored frames. Each mode must produce a valid position/quaternion
   without depending on another mode.
3. Use a canonical camera basis: visual forward maps to camera local `-Z`,
   right maps to `+X`, and up maps to `+Y`. Validate by projecting the target
   to screen center.
4. Derive position and orientation independently, then combine them once.
5. Add input orbit/look only inside declared yaw/pitch and spatial
   constraints.
6. Apply frame-rate-independent exp-decay smoothing or a bounded spring only
   where inertia is part of the shot. During explicit handoff, use one
   `lerp`/`slerp` stage and return.
7. Own projection, depth, view offsets, output color, node post, and controls
   lifecycle as one snapshot/restore contract.
8. For large worlds, keep the camera near the origin and move renderable
   world offsets through storage buffers or camera-relative group transforms.

Read [references/camera-rig-and-cinematic-systems.md](references/camera-rig-and-cinematic-systems.md)
for chase/side/orbit rigs, projection and depth policy, pointer/orbit
interop, floating-origin storage-buffer patterns, collision, budgets, and
validation.

## WebGPU/TSL Baseline

- Renderer: `WebGPURenderer` from `three/webgpu`; call `await renderer.init()`
  before capability decisions.
- Materials: `MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`,
  `MeshBasicNodeMaterial`, `SpriteNodeMaterial`, or another `NodeMaterial`
  family member. Put camera-relative deformation and world-offset math in TSL
  nodes.
- Post: `RenderPipeline`, `pass()`, `mrt()`, `PassNode.setResolutionScale()`,
  `outputColorTransform`, and `renderOutput()`. `PostProcessing` was renamed;
  mention it only as historical context and use `RenderPipeline` in current
  text and code.
- Built-in nodes first: use `GTAONode`, `BloomNode`, `TRAANode`,
  `DepthOfFieldNode`, `CSMShadowNode`, and `TileShadowNode` where camera
  projection/depth participates in the effect.
- GPU state: use `StorageBufferAttribute`, `StorageInstancedBufferAttribute`,
  `StorageTexture`, `storage()` nodes, and `renderer.compute()` /
  `renderer.computeAsync()` for large camera-relative fields or generated
  offsets.

## Capability Gate And Tiers

Any path that uses compute, storage, or MRT must gate once after init:

```js
await renderer.init();

if (renderer.backend.isWebGPUBackend !== true) {
  throw new Error("WebGPU backend required for the canonical camera rig path. If the user explicitly asks how to apply fallback when WebGPU is unavailable, route to threejs-compatibility-fallbacks.");
}

const tier = "full";
```

Full tier uses storage-buffer world offsets, MRT depth/normal/velocity output,
TRAA jitter, and compute-updated camera-relative instance data. Reduced tier
inside WebGPU may lower post resolution, density, update cadence, or scene
scale while preserving the same camera owner and projection contract. Do not
write a second renderer implementation here. If the user explicitly asks how to
apply fallback when WebGPU is unavailable, route that teaching to
`../threejs-compatibility-fallbacks/`.

## Non-Negotiable Rules

- Derive offsets from subject `Box3`/bounding sphere dimensions; do not tune a
  single fixed distance for differently scaled assets.
- Use `PerspectiveCamera.getViewSize(distance, scratch.viewSize)` or
  `getViewBounds(distance, scratch.minView, scratch.maxView)` to measure screen
  occupancy before changing FOV or distance.
- Keep `near` as large and `far` as small as each mode allows. Prefer
  camera-relative rendering and `reversedDepthBuffer`; use
  `logarithmicDepthBuffer` only after measuring depth/post/shadow behavior.
- Rebuild orthonormal frames with degeneracy fallbacks. Never rely on
  `lookAt()` under non-uniformly scaled parents.
- Call `updateWorldMatrix()` before reading mounts, use `localToWorld()`,
  `worldToLocal()`, `getWorldPosition()`, and `getWorldQuaternion()` for
  hierarchy crossings, and avoid non-uniform camera/control parents.
- Interpolate position with `lerp` and orientation with `slerp`; normalize
  quaternions after custom math.
- Clamp tab-stall `dt`, substep springs when required, and allocate scratch
  vectors/quaternions/matrices once in rig state.
- Re-sync yaw/pitch from the camera when pointer lock is acquired. Disable
  orbit/pointer controls during authored transitions, then sync targets and
  call `controls.update()` before returning control.
- Snapshot and restore projection (`fov`, `near`, `far`, `aspect`, `zoom`,
  `filmGauge`, `filmOffset`, view offset), `camera.up`, layers, controls,
  event listeners, pointer-lock state, render pipeline output ownership, and
  depth assumptions.
- Color textures use `SRGBColorSpace`; data maps, masks, velocity, normals,
  depth helpers, LUTs, and generated offset data use `NoColorSpace`/linear.
  Keep HDR `HalfFloatType` buffers until one tone-map owner and one output
  transform owner convert the final image.

## Performance Budgets

- Camera rig CPU update: 0 allocations and under 0.10 ms desktop-discrete,
  0.20 ms desktop-integrated, 0.35 ms mobile for one active camera owner.
- Explicit handoff: one pose blend and no extra smoothing pass.
- Storage-buffer camera-relative offset update: one compute dispatch per
  dynamic field, with static offsets computed once; target under 0.15 / 0.35 /
  0.70 ms by tier.
- Node post camera dependencies: one scene `pass()` with MRT for shared
  color/depth/normal/velocity where possible; keep AO/bloom/DOF at reduced
  resolution via `setResolutionScale()` unless close-up inspection requires
  full resolution.
- Draw calls: camera system adds zero draw calls except optional debug guides.
  Debug overlays must be toggleable and excluded from production budgets.

## Routing Boundary

Use `$threejs-procedural-motion-systems` for object motion timelines, springs,
docking, staging, and debris. Use `$threejs-camera-controls-and-rigs` for how the
scene is viewed, how camera modes hand off, and how projection/depth/post
state follows the shot. For broad graphics architecture preflight, route
through `$threejs-choose-skills`; for shadows, post, atmosphere, planets, water,
or bloom details, keep links to the relevant sibling `$threejs-...` skills.
