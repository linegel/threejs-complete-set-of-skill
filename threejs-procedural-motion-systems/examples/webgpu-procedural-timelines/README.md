# Native WebGPU Procedural Timelines

Canonical r185 motion lab with three runtime scenarios sharing one semantic
motion core: launch/staging, spin docking, and timed debris release. Additional
fixed routes isolate quaternion/reparent, compute storage, and interpolation/
velocity mechanisms.

The core now enforces:

- `sceneUnitsPerMeter` exactly once at the physical-to-scene boundary;
- world-transform-preserving reparenting under arbitrary rotated/non-uniformly
  scaled parents, retaining an affine local matrix when TRS would add shear;
- exact terminal docking position/quaternion with zero linear and angular
  velocity;
- deterministic one-shot event phases and fixed-step replay;
- analytically integrated spin angle, independent of presentation frame count;
- versioned previous/current position and quaternion storage;
- actual storage inventory from allocated typed arrays (`144 bytes/instance`);
- a real scenario-specific compute node whose parity lane evaluates the same
  launch, docking, or debris timeline as the CPU core, plus ordered fixed-step
  dispatch, explicit GPU reset/reseed/seek, storage readback, and an f32 oracle;
- vertex interpolation of both position and orientation;
- distinct previous/current camera, projection, model, position, and
  quaternion state for velocity;
- disposal of all nine storage attributes and the compute node;
- explicit NodeMaterial color/emissive nodes and a shared
  `output + normal + emissive + velocity` render pass;
- one `renderOutput(...)` owner with `outputColorTransform = false`;
- fixed mechanism and tier routes; unknown IDs throw.

Mechanism routes:

```text
launch-and-staging
spin-docking
debris-release
quaternion-and-reparent
compute-storage
interpolation-and-velocity
```

Tier routes are `full`, `balanced`, and `test-minimum`. They lock instance
capacity and DPR cap at startup so reported resource counts cannot silently
change. Every active instance retains the same fixed-step solver.

Run:

```sh
npm run check
npm run validate:unit
npm run test:mutations
```

The Node suite proves the CPU contract, TSL graph construction, storage byte
reconciliation, and mutation rejection. It does not claim browser/GPU execution
or timing. The manifest remains `incomplete` until root capture produces a real
v2 bundle with WebGPU readback and current-adapter timestamps.
