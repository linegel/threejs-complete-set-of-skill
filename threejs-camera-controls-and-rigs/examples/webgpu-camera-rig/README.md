# Native WebGPU Camera Rig Lab

Canonical r185 camera/control fixture with one camera owner and one final
`RenderPipeline`. The runtime initializes `WebGPURenderer`, rejects a non-WebGPU
backend, uses explicit NodeMaterial color/emissive nodes, and exposes a shared
`output + normal + emissive + velocity` scene pass. `renderOutput(...)` owns
presentation, so `RenderPipeline.outputColorTransform` is false.

Implemented mechanisms:

- robust body-relative tangent frames with deterministic near-parallel fallback;
- scale-derived overview/chase, body-profile, and inspection/orbit poses;
- exact critically damped thrust lag and bounded-delta pose response;
- one position lerp and one shortest-path quaternion slerp per handoff;
- hard-safe inward obstruction response on entry and every persistent frame,
  with smooth outward recovery only after clearance;
- pointer-look and orbit intent adapters wired into the inspection pose, with
  complete listener disposal;
- high/low storage-backed current/previous origin and object coordinates;
- subtract-high/subtract-low reconstruction that preserves low lanes before
  f32 cancellation, plus distinct previous/current projection, view, and model
  matrices for velocity;
- one storage identity shared by visible offsets, previous offsets, velocity,
  diagnostics, and resource accounting;
- inverse-linear local offset conversion so shader-only rebasing and the CPU
  camera target share one world-relative frame;
- exact projection/view-state and parented-camera snapshot/restoration;
- aligned render-target readback with odd-size `641 x 359` stride validation;
- fixed mechanism and tier routes whose unknown values throw.

Mechanism route IDs:

```text
scale-aware-framing
handoff-and-replay
pointer-orbit-and-collision
floating-origin
projection-and-depth
shared-jitter-and-velocity
```

Tier route IDs are `full`, `budgeted`, and `minimum`. They use the same
implementation; only declared collision/lag availability and DPR caps change.

Run static and CPU-contract validation:

```sh
node --check CameraDirectionController.mjs
node --check CameraRelativeOrigin.mjs
node --check routeState.mjs
node --check main.mjs
node cameraValidation.mjs
```

The Node validation does not claim browser/GPU execution or target-device
timing. Until the root browser capture runs this lab and promotes a v2 bundle,
`lab.manifest.json` remains `incomplete` and GPU timing is
`INSUFFICIENT_EVIDENCE`.
